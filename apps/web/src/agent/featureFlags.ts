import { loadConstrainedDragEnabled } from "../persistence/nextPhasePreferences"

/**
 * **下一阶段能力的项目级开关**（设计 2026-10-04 的 Feature flags 一节；控制器裁决 R2）。
 *
 * ## 为什么默认全部关掉
 *
 * 验收条件逐字是："`flags=false` 时旧静态示意图链路行为不变"。所以这里不是
 * "默认打开、出事再关"—— **默认全关**，每个阶段（N2–N5）只能在自己的开关下启用，
 * 而"关着的时候走的是旧路径"必须可测（`featureFlags.test.ts` + 既有的静态链路用例）。
 *
 * ## 为什么五个开关各自独立，而不是一个 `nextPhase`
 *
 * 五个阶段的风险彼此无关：IR 只是把现有核验换一种说法，证明出口却会把图交给外部后端。
 * 合成一个开关的后果是"为了试 IR 就得连证明出口一起开"。R2 也明确 flag 由 N1 创建，
 * N6 只补"每个 flag 有单元 / 浏览器 / 回退用例"。
 *
 * ## 它现在是被谁读的
 *
 * `planCompiler` 在编译期读 `obligationIR` 与 `witnessSearch`（N1 与 N2 各接了一条线）；
 * 其余三个是**占位**：N3–N5 实现时只允许在对应开关下启用，届时它们会各有一个读取点。
 * 占位在这里是刻意的 —— 阶段开始前先把开关建好，就不会出现"能力已经上线、开关还没定义"。
 */

export interface AgentNextPhaseFlags {
  /** Phase N1：统一数学状态 IR（`obligationIR.ts` / `constraintIR.ts` / `claimEvidence.ts`）。 */
  obligationIR: boolean
  /** Phase N2：小型解析求解器 + 有限预算数值后端（`solver/witnessSearch.ts`，编译期的救回路径）。 */
  witnessSearch: boolean
  /** Phase N3：拖动时保持约束。 */
  constrainedDrag: boolean
  /** Phase N4：开放式题面编译。 */
  openProblemCompiler: boolean
  /** Phase N5：形式证明出口。 */
  proofExport: boolean
}

/**
 * 开关名的**唯一来源**：每条都必须是接口里真实存在的键。
 *
 * `satisfies readonly (keyof AgentNextPhaseFlags)[]` 挡住"表里写了一个接口没有的名字"；
 * 反方向（接口加了开关、表里忘了加）由 `featureFlags.test.ts` 的等集断言挡住 ——
 * 这一条**必须是运行时断言**：TypeScript 的 `satisfies` 无法在数组这种元组上比较"键集合相等"
 *（试过 `{[K in keyof T]: K}` 的写法，它要求对象形状，对元组一律报 TS1360）。
 *
 * 为什么需要这张表：运行 trace 与 benchmark report 要记录"这一轮开了哪些开关"，
 * 而它们只能按名字遍历 —— 名字写在第二处就一定会与接口分叉。
 */
export const AGENT_NEXT_PHASE_FLAG_NAMES = [
  "obligationIR", "witnessSearch", "constrainedDrag", "openProblemCompiler", "proofExport"
] as const satisfies readonly (keyof AgentNextPhaseFlags)[]

export type AgentNextPhaseFlagName = (typeof AGENT_NEXT_PHASE_FLAG_NAMES)[number]

/** 全关的一份（默认值也按名字表**逐项**写出：漏一项就编译不过）。 */
const OFF: Record<AgentNextPhaseFlagName, false> = {
  obligationIR: false, witnessSearch: false, constrainedDrag: false, openProblemCompiler: false, proofExport: false
}

/** 全关的一份；**每次调用返回新对象**，免得调用方改了它却影响别处。 */
export function createAgentNextPhaseFlags(overrides: Partial<AgentNextPhaseFlags> = {}): AgentNextPhaseFlags {
  return { ...OFF, ...overrides }
}

/**
 * **应用层持有的那一份开关**（控制器裁决 R6："由应用层持有并显式传入 flag"）。
 *
 * 这是"开关从哪来"的**唯一答案**：`agent-core` 是纯函数库、不读它（读了就无法用测试钉住
 * "同一份输入给同一份结果"），所以应用侧必须有这么一处把开关交出去 ——
 * 而不是由 `draftStore.stage` 或 `compilePlan` 各自去猜。
 *
 * 接线方式（N1 的 `obligationIR` 与 N2 的 `witnessSearch` 各一条，走的是**同一条**通道）：
 * ```ts
 * await store.stage(draftId, actions, version, userMessage, relations, agentNextPhaseFlags().obligationIR, agentNextPhaseFlags().witnessSearch)
 * ```
 * 这两个布尔随后经 `compileInProcess`（→ `compilePlan` 的 `diagramObligationIR` /
 * `diagramWitnessSearch`）或 `compileInWorker`（→ `workerContracts` 的同名字段 → Worker 里的
 * `compilePlan`）到达编译处。两条路都**只在显式 `true` 时**开。
 *
 * N2 另有一条与本文件无关的注意点：`witnessSearch` 打开后会替换被物化的坐标与点名，
 * 所以草稿层那次再核验必须对着编译器回带的 `materialisedActions`（见 `draftStore.stage`）。
 *
 * N3–N5 的三个开关里，**`constrainedDrag` 已有用户入口**（设置 → 实验性功能，走 `loadConstrainedDragEnabled`），另外两个保持 `false`；**各阶段实现时只允许在自己的开关下启用**。
 *
 * 为什么是**函数**而不是常量对象：开关将来要能由运行配置/实验组驱动，
 * 而"每次调用现取"与"进程启动时冻结一份"在接线处看不出区别，到那时才改就要动一批调用点。
 */
export function agentNextPhaseFlags(): AgentNextPhaseFlags {
  /**
   * **只从偏好里取 `constrainedDrag` 这一个**（2026-10-05，用户批准的 N3 入口）。
   *
   * 另外四个**故意不读偏好**，理由是各不相同而都必须成立：
   *
   * - `witnessSearch` 打开后**会替换被物化的坐标与点名**（见上面的注意点），它有自己的接线前提；
   * - `openProblemCompiler` / `proofExport` 属于 N4 / N5，**还没交付**；
   * - `obligationIR` 同理。
   *
   * 一个"存了就能全开"的偏好，等于把四个未完成阶段的路一起打开 ——
   * `featureFlags.test.ts` 里那条"恶意存储"用例就是钉这件事的。
   */
  return createAgentNextPhaseFlags({ constrainedDrag: loadConstrainedDragEnabled() })
}
