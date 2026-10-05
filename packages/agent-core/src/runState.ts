import type { DocumentHandle, RunId, ToolResult, VerificationReport } from "./contracts"

/**
 * **运行账本**（Task 2.1，设计规格 §9.1）。
 *
 * 计划原文："`RunLedger` transitions exactly through
 * `created → preflight → observing → planning → compiling → validating → awaiting_confirmation → committing → completed`,
 * or an explicit waiting/failed/cancelled/interrupted terminal path."
 *
 * 为什么要有这张显式的表，而不是散在各处的 `if`：
 * - 每条合法边都有单测，非法边**返回允许的下一步**而不是抛异常 —— 出错时能直接告诉调用方"你现在只能走这些"，
 *   而不是让它在别处炸；
 * - `waiting` 是**显式**状态：等用户补充信息（澄清）与等用户确认草稿是两件不同的事
 *   （`awaiting_confirmation` 专指后者），把它们混起来会让"用户还没确认"与"用户还没回答"分不开；
 * - 事件**只在活跃状态下累积**：已结束的运行再来一条事件，说明有迟到的模型响应或 worker 结果想写进来 ——
 *   这正是计划 Step 5 要挡的东西（"discard late events unless commit status is queried by idempotency key"）。
 */

export type RunPhase =
  | "created"
  | "preflight"
  | "observing"
  | "planning"
  /** 只读回答：计划信封是 `answer`，**没有动作**，因此不进编译/确认/提交。 */
  | "answering"
  | "compiling"
  | "validating"
  | "awaiting_confirmation"
  | "committing"
  | "completed"
  | "waiting"
  | "failed"
  | "cancelled"
  | "interrupted"

/** 一次运行真正结束的状态。到了这里就不再接受任何转移或事件。 */
export const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set<RunPhase>(["completed", "failed", "cancelled", "interrupted"])

/**
 * 合法转移表。**这是唯一的一份**：`transition` 与 UI 的"下一步能做什么"都读它。
 *
 * 几条刻意的取舍：
 * - `created → preflight` 是唯一入口：不允许从 `created` 直接进 `observing`，
 *   否则"运行前先做前置检查"（能力注册表版本、文档句柄是否还有效）会被绕过。
 * - `planning → answering → completed` 是**只读回答**的专用路径。它不能从 `planning` 直接
 *   跳到 `completed`：那样一来"这次运行有没有产生草稿"就无从判断（两种完全不同的运行
 *   会留下同一条事件序列），事后无法区分"回答完了"与"提交完了"。显式多一个状态，
 *   是为了让账本能自证"这次没有写过文档"。
 * - `compiling → validating` 不可跳过：编译出来的操作**必须**过校验才算数。
 * - `awaiting_confirmation → compiling`：用户在预览里改了要求，回到编译而不是回到规划 ——
 *   规划产物（计划信封）本身没变，变的是要编译的动作。
 * - `waiting → observing`：用户回答了澄清，需要重新观察场景才能继续。
 * - `* → cancelled` / `* → interrupted`：用户取消与应用被中断可以从任何活跃状态发生。
 * - `* → failed`：任何活跃状态都可能失败。
 */
const TRANSITIONS: Record<RunPhase, readonly RunPhase[]> = {
  created: ["preflight", "waiting", "failed", "cancelled", "interrupted"],
  preflight: ["observing", "waiting", "failed", "cancelled", "interrupted"],
  observing: ["planning", "waiting", "failed", "cancelled", "interrupted"],
  planning: ["compiling", "answering", "waiting", "failed", "cancelled", "interrupted"],
  /**
   * `answering → waiting` 是**澄清**的必经之路：协调器先进入作答分支，问完问题就落到"等用户回答"。
   *
   * 我第一版漏了这条边，于是"问澄清问题"这条路径**永远走不到 `waiting`** ——
   * 运行会停在 `answering`（账本上看起来"答完了"，其实什么都没答），
   * 用户看到一条空的助手消息且**无处可答**。是 `agentRunner` 的用例抓出来的。
   */
  answering: ["completed", "waiting", "failed", "cancelled", "interrupted"],
  /**
   * `compiling → planning` 是**编译阶段那次一次性修复的返程边**（Agent DSL 切片 Task 4）。
   *
   * 六层编译拒绝一份计划时，编译器会给出修复请求（只带 `code`/`path`/`allowedChanges`）。
   * 把请求交回模型就是**重新规划一次**：这一次尝试既不是编译也不是失败，
   * 所以账本必须能说出"这是同一份运行里的第二次规划"。没有这条边，那次修复只能
   * 落在 `compiling` 里（一个说不清正在发生什么的相位）或者干脆不发生。
   *
   * 它**不削弱**任何既有拒绝：`compiling → validating` 仍不可跳过，
   * 而"只修一次"由协调器的 `MAX_REPAIR_ATTEMPTS` 计数守住 —— 状态机只管"这一步是什么"。
   */
  compiling: ["validating", "planning", "failed", "cancelled", "interrupted"],
  validating: ["awaiting_confirmation", "compiling", "failed", "cancelled", "interrupted"],
  awaiting_confirmation: ["committing", "compiling", "cancelled", "failed", "interrupted"],
  committing: ["completed", "failed", "cancelled", "interrupted"],
  waiting: ["observing", "planning", "cancelled", "failed", "interrupted"],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: []
}

export function nextPhases(phase: RunPhase): readonly RunPhase[] {
  return TRANSITIONS[phase]
}

/**
 * 每条事件都必须携带的标识。计划 Step 4 逐字列出：
 * "Store `runId`, `promptMessageId`, `requestId`, `attemptId`, `toolCallId`, `draftVersion`, and current document handle on every event."
 *
 * 全部**必填**（`string | null` 而不是可选）：可选字段在实现里会被忘填，
 * 而"这条事件属于哪次尝试"正是排障时唯一能用的线索。
 */
export interface RunEventIds {
  runId: RunId
  promptMessageId: string
  requestId: string | null
  attemptId: string | null
  toolCallId: string | null
  toolId: string | null
  draftVersion: number | null
  handle: DocumentHandle | null
}

export interface RunEvent extends RunEventIds {
  /** 单调递增，从 1 开始。 */
  sequence: number
  at: number
  phase: RunPhase
  from: RunPhase
  detail: string
  /**
   * **这次运行是在哪几个版本下跑的**（Phase 6 / Task 6.1）。
   *
   * 计划原话："每次运行记录 prompt version、tool registry revision、action schema revision、
   * provider capability revision."
   *
   * 为什么挂在**每一条**事件上、而不是只在第一条：事件会被单独导出、单独贴进缺陷报告，
   * 而"这条读数是在哪版提示词/哪版工具目录下产生的"正是判断"能不能复现"的第一个问题。
   * 只在首条记录，等于要求读者先去翻第一条。
   */
  revisions: RunRevisions
}

/**
 * **一次工具调用的痕迹**（Phase 6 / Task 6.1 第二条）。
 *
 * 计划原话："每个 tool call 记录输入摘要、结果摘要、diff、verification、draft version 和耗时."
 *
 * 三条纪律：
 * 1. **全部有界**：摘要有长度上限（见 `boundTrace`）。无界的日志会在真实运行里把内存和
 *    界面一起拖垮，而"日志太长"通常会以"把日志关掉"收场。
 * 2. **绝不写密钥、推理过程与完整候选文档**：这里只有摘要、状态与计数；
 *    `verification` 只带**状态与检查条数**，不带整份报告正文。
 * 3. **失败也要有痕迹**：`status` 是 `ToolResult["status"]`，
 *    所以"工具报错了"与"工具成功了"在同一列里可区分，而不是只能靠"没有记录"推断。
 */
export interface ToolCallTrace {
  toolCallId: string
  toolId: string
  /** 输入摘要（有界）。**不是**完整参数体。 */
  inputSummary: string
  /** 结果摘要（有界）。 */
  resultSummary: string
  status: ToolResult<unknown>["status"]
  /** 这次调用涉及的草稿版本（没有草稿类工具时为 `null`）。 */
  draftVersion: number | null
  /** 验证结论的**概要**（状态 + 条数），不带逐条正文。 */
  verification: { status: VerificationReport["status"]; checks: number } | null
  /** 改动概要（新增/删除的对象 id，**去重且有界**）。 */
  diff: { added: number; removed: number } | null
  durationMs: number
}

/** 摘要与数组的上限。**只有一处** —— 两处上限必然漂移出两个不同的数字。 */
export const MAX_TRACE_SUMMARY = 240
export const MAX_TRACE_IDS = 8

/**
 * **这次运行是在哪几个版本下跑的**（Phase 6 / Task 6.1 第一条）。
 *
 * 四个字段对应计划点名的四样东西，取值都来自**已经存在的**常量，
 * 而不是在这里新造一份版本号（新造一份就是第二处真源）：
 * - `promptVersion` ← `apps/web/src/agent/systemPrompt.ts` 的 `SYSTEM_PROMPT_VERSION`（由 app 侧传入）；
 * - `toolRegistryRevision` ← `toolRegistry.ts` 的 `TOOL_REGISTRY_REVISION`；
 * - `actionSchemaRevision` ← `contracts.ts` 的 `PLAN_SCHEMA_VERSION`（动作信封的 schema 版本）；
 * - `providerCapabilityRevision` ← `RunContext.capabilityRevision`（调用方已经带着它）。
 *
 * `undefined` 表示**调用方没有接线**：那时如实留空，而不是编一个版本号 ——
 * 一个假版本号会让"这份读数能不能复现"变成一句无法回答的话。
 */
export interface RunRevisions {
  promptVersion: string
  toolRegistryRevision: string
  actionSchemaRevision: string
  providerCapabilityRevision: string
  /**
   * **这一轮运行是在哪组 feature flag 下跑的**（计划 N4：「flag 状态进入 trace/benchmark 记录」）。
   *
   * 为什么它属于 `RunRevisions` 而不是别处：这一节回答的就是"这次运行是在什么条件下发生的" ——
   * 而**开关状态与版本号是同一种事后对账信息**。少了它，"这份 trace / 读数是在哪组开关下取的"
   * 就**答不出来**，同一个 runId 在开关前后会有两种截然不同的含义。
   *
   * `undefined` = **调用方没有接线**，如实留空 —— 与本节其余字段同一条纪律：
   * 编一个"全关"上去，就等于把"没接线"说成"确认过是关的"。
   */
  nextPhaseFlags?: RunNextPhaseFlags
}

/**
 * 五个开关的结构声明。
 *
 * **不 import `apps/web` 的 `AgentNextPhaseFlags`**：agent-core 不依赖应用层
 *（同 `committerAdapter` 的处理），所以在这里只声明布尔形状。
 */
export interface RunNextPhaseFlags {
  obligationIR: boolean
  witnessSearch: boolean
  constrainedDrag: boolean
  openProblemCompiler: boolean
  proofExport: boolean
}

/** 把一段文本收敛成有界的摘要：先折叠空白，再截断并显式标出截断。 */
export function boundTrace(text: string, limit = MAX_TRACE_SUMMARY): string {
  const collapsed = text.replace(/\s+/g, " ").trim()
  return collapsed.length <= limit ? collapsed : `${collapsed.slice(0, limit)}…(+${collapsed.length - limit})`
}

export type TransitionRejection = { ok: false; reason: "illegal_transition" | "run_finished"; from: RunPhase; allowed: readonly RunPhase[] }
export type TransitionResult = { ok: true; event: RunEvent } | TransitionRejection

export interface RunLedger {
  readonly runId: RunId
  phase(): RunPhase
  /** 是否已到终态（终态之后 `transition` 与 `record` 都会被拒）。 */
  finished(): boolean
  ledger(): readonly RunEvent[]
  transition(to: RunPhase, detail?: string, ids?: Partial<RunEventIds>): TransitionResult
  /** 只记录不换状态（例如"工具返回了一条诊断"）。终态之后返回 null 并丢弃。 */
  record(detail: string, ids?: Partial<RunEventIds>): RunEvent | null
  /**
   * **记一次工具调用的痕迹**（Phase 6 / Task 6.1 第二条）。
   *
   * 与 `record` 分开，是因为两者的**消费者不同**：`record` 是人读的一句话，
   * 而这条是"事后能重放这次运行"的结构化记录。塞进 `detail` 字符串里会立刻丢掉结构，
   * 而结构化正是它存在的理由（评测与缺陷报告要按 `toolId` / `status` 聚合）。
   *
   * 与 `record` 同一条纪律：**终态之后不再追加** —— 迟到的工具结果不许写进一份已结束的账本。
   */
  recordToolTrace(trace: ToolCallTrace): ToolCallTrace | null
  /** 这次运行已经记下的工具痕迹（按记录顺序）。 */
  toolTraces(): readonly ToolCallTrace[]
}

export interface RunLedgerInit {
  runId: RunId
  promptMessageId: string
  handle?: DocumentHandle | null
  /**
   * 这次运行的版本标识。缺省时四个字段都留空字符串（见 `RunRevisions` 的注释：
   * 宁可留空，也不编一个假版本号）。
   */
  revisions?: RunRevisions
  now?: () => number
}

export function createRunLedger(init: RunLedgerInit): RunLedger {
  const now = init.now ?? (() => Date.now())
  let phase: RunPhase = "created"
  let sequence = 0
  const events: RunEvent[] = []
  const traces: ToolCallTrace[] = []
  const revisions: RunRevisions = init.revisions ?? { promptVersion: "", toolRegistryRevision: "", actionSchemaRevision: "", providerCapabilityRevision: "" }
  /** 随事件累积的标识：新的覆盖旧的，没给的沿用上一次（避免每个调用点都要重填一遍）。 */
  let ids: RunEventIds = {
    runId: init.runId,
    promptMessageId: init.promptMessageId,
    requestId: null,
    attemptId: null,
    toolCallId: null,
    toolId: null,
    draftVersion: null,
    handle: init.handle ?? null
  }

  const finished = () => TERMINAL_PHASES.has(phase)

  return {
    runId: init.runId,
    phase: () => phase,
    finished,
    ledger: () => [...events],

    transition(to, detail = "", patch) {
      if (finished()) return { ok: false, reason: "run_finished", from: phase, allowed: [] }
      const allowed = TRANSITIONS[phase]
      if (!allowed.includes(to)) return { ok: false, reason: "illegal_transition", from: phase, allowed }

      const from = phase
      if (patch) ids = { ...ids, ...patch, runId: init.runId, promptMessageId: patch.promptMessageId ?? ids.promptMessageId }
      phase = to
      sequence += 1
      const event: RunEvent = { ...ids, revisions, sequence, at: now(), phase: to, from, detail }
      events.push(event)
      return { ok: true, event }
    },

    record(detail, patch) {
      // 终态之后丢弃：迟到的模型响应 / worker 结果不许写进一份已经结束的账本。
      if (finished()) return null
      if (patch) ids = { ...ids, ...patch, runId: init.runId, promptMessageId: patch.promptMessageId ?? ids.promptMessageId }
      sequence += 1
      const event: RunEvent = { ...ids, revisions, sequence, at: now(), phase, from: phase, detail }
      events.push(event)
      return event
    },

    recordToolTrace(trace) {
      if (finished()) return null
      traces.push(trace)
      return trace
    },

    toolTraces: () => [...traces]
  }
}
