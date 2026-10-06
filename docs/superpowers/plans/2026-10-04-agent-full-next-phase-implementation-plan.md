# 下一阶段 Agent 完整升级实施计划

> **状态：N1、N2 已实施并复核；N3 已实施并复核（出口已达成，五条浏览器用例全绿）；N4 出口已达成（`:324` / `:347` 已勾，2026-10-06）** —— 题集与报告契约已搬进 `packages/agent-core/src/benchmark/`（一份定义，CLI 与应用共用，提交 `f315cf6`），应用内评测已接到那 21 条上（契约新增 `planning` 层，提交 `e7ce865` / `281ce25` / `c15e99f`），**并且真实 provider 运行已经发生过三次**：planning 轴 `planned 2/3`（前两次）与第三次 `planned 1/3` / `clarification 1/3` / `error 1/3`（2026-10-06，`error` 那条是**模型响应超过 1 MiB 上限**、如实报错而非记成被拒），**pass@1 轴 `1/8`**，**人工可读性第一次有标注**（2026-10-06，`plan` 与 `clarification` 各 1 条、都判 `unreadable`，每组 n=1 ⇒ 不是趋势）。**仍然没有数字的只有成本**（仓里没有价目表）；另记两条已知边界：全题集 21 条只跑了前 3 条、超大响应那类题今天测不出来。**N5 出口已达成（2026-10-06）**：R51/R56 输入绑定与只读「证明级别」状态面已落地（N5a，提交 `b01525e` / `2f69a74` / `8e0c011` / `4e54479` / `24a5866`），**Lean 4 后端的十栏准入记录（N5b，提交 `e401d9e`）与一个目标类（`perpendicular`）的最小闭环（`051e5fe`）已落地 —— 出口 `:616` 已勾**。**N6 已收口：本计划 37 项检查项全部勾选（0 未勾）。** N1 提交 `acd3bd5` / `2d62c4d` / `b5b33f9` / `f997b3f`；N2 提交 `c2314c9`…`9c5ae2f`；N3 的收尾提交 `d7fe702` + `2dd89ab`；N4/N5/N6 的进度逐条见各阶段执行记录（`2026-10-05` 那一批以 `git log` 为准）。本计划对应 `docs/superpowers/specs/2026-10-04-agent-full-next-phase-design.md`；每个阶段必须先写 RED，再实现 GREEN，再跑全量门禁，最后单独提交。

**Goal:** 在 `b1ee3d3` 的静态题设核验之上，逐步实现约束求解、动态拖动保持、开放题编译、真实 provider 评测和形式证明出口。

**Current baseline:** `b1ee3d3`（代码）；`9fb64e0` / `666d651`（路线与文档）；当前默认 Agent 仍是 fail-closed 的静态示意图路径。

**Architecture:** `Obligation/Constraint/Claim IR` 是唯一数学状态；解析器、求解器、Scene Graph 拖动、证明后端和 Agent 编排通过适配器连接。模型只提供候选/解释/证明草稿，系统持有证据和提交权。

**Global Constraints:**

- `verified_instance`、`sampled`、`formally_proved` 必须是互斥证据状态。
- Solver 结果必须区分 `model / unsat / unknown / timeout / diverged`，并保留残差、自由度、失败约束和 seed。
- 任何新能力先放在独立 feature flag 下；N2/N3 不能在 N6 才第一次加 flag。
- 不允许求解器自证；所有候选必须回到现有/统一 verifier。
- 外部项目只作为参考或 adapter；先完成许可证、线程、WASM/原生依赖和性能评估。
- 用户确认和 HostBridge 仍是唯一写入入口。

## 总体实现思路

下一阶段不是把一个“大求解器”直接接到 Agent，而是沿着现有的“原话 → 计划 → 隔离草稿 → 核验 → 用户确认 → HostBridge 提交”逐层插入能力：

1. **先建立统一状态，不先改 UI。** 原话抽取结果、模型候选、约束残差、求解器状态和证明证据先落到统一 IR；旧的 `DiagramObligation`、`PlanRelation` 和三维约束通过 adapter 接入。这样后续求解、拖动和证明读取的是同一份状态。
2. **先做可解释的解析构造，再做数值搜索。** 对中点、垂足、直角、固定长度、简单比例等关系，优先用解析公式生成候选；只有解析构造无法覆盖时，才进入有 seed、候选数上限、迭代上限和超时的数值搜索。搜索结果必须重新经过几何内核和题设 verifier。
3. **把求解结果当作证据对象，而不是布尔值。** 每次求解都保存模型、残差、自由度、失败约束、solver 版本和耗时。`unknown/timeout/diverged` 不得降级成“失败但可提交”，也不得被模型文案改写成“已完成”。
4. **动态拖动沿用同一套求解管线。** 用户拖动不是直接改点坐标，而是生成临时 pointer constraint；求解器返回新文档或冲突结果；只有事务提交成功才更新画布和撤销栈。这样 Agent 生成、手工拖动和恢复文档使用同一套约束语义。
5. **开放题理解拆成可回放的编译流水线。** 先保存原文和 IR，再让模型生成计划/候选；每轮结果都能单独重放和比较。benchmark 统计“抽取正确、候选可解、题设通过、人工可读、用户确认”各层，避免只看最终有没有图。
6. **形式证明作为外部证据出口。** 证明后端不参与普通静态图的默认运行；只有目标属于支持矩阵、生成的 artifact 能独立校验、版本与输入哈希一致时，才把 claim 状态提升到 `formally_proved`。
7. **每阶段都在 feature flag 后。** 关闭 flag 时保留 `b1ee3d3` 的静态核验行为；新能力先用定向单测和浏览器用例验证，再考虑默认启用，最后才进入发布门禁。

阶段依赖关系是：N1 是所有后续阶段的状态基础；N2 依赖 N1；N3 依赖 N1/N2，但 N4 的 benchmark 数据集可以与 N3 并行准备；N5 依赖 N1 和至少一批稳定的证明目标；N6 最后统一做开关、依赖审查、发布和文档收口。
## 文件职责总表

| 责任 | 文件/目录 | 说明 |
| --- | --- | --- |
| 题设来源与 claim | `packages/agent-core/src/obligationIR.ts` | 新增唯一 IR；兼容现有 `diagramObligations.ts` |
| 几何约束 | `packages/agent-core/src/constraintIR.ts` | 统一现有 `PlanRelation` 与 3D constraints |
| 证据状态 | `packages/agent-core/src/claimEvidence.ts` | `ClaimEvidenceStatus` 与 `SolverStatus`；候选结果另用 `WitnessResultStatus` |
| 解析构造与候选搜索 | `packages/agent-core/src/solver/witnessSearch.ts` | 搜索编排、预算、seed、排序；不复制残差 |
| 纯几何构造/残差 | `packages/geometry-kernel/src/witness/` | 解析构造、数值残差、退化和尺度处理 |
| 编译接入 | `packages/agent-core/src/planCompiler.ts` | 现有调用点：约 299–301 解析/核验候选 |
| 草稿报告接线 | `apps/web/src/agent/draftStore.ts` | 现有调用点：约 358–360 重新核验草稿候选并保存报告 |
| 草稿/Worker | `apps/web/src/agent/draftStore.ts`、`workerContracts.ts`、`geometryCompileStrategy.ts` | 同步/Worker 传递 IR、候选、报告和失败原因 |
| 动态拖动 | `packages/scene-graph/src/`、`apps/web/src/threeScene*`、`apps/web/src/agent/agentRuntime.ts` | 约束进入文档；拖动进入事务 |
| Provider 评测 | `packages/agent-core/src/benchmark/`（题集与报告契约；CLI 入口仍在 `scripts/agent-benchmark/`） | JSONL 题集、脱敏、真实/离线模式分离。**2026-10-05 更正**：题集与报告契约原在此列写 `scripts/agent-benchmark/`，但 `scripts/` 不是工作区、应用拿不到，已搬进包（见 N4 第五步） |
| 证明出口 | `packages/agent-core/src/proof/` | proof artifact schema 与外部后端 adapter |

## Feature flags（N1 先完成，后续阶段不得绕过）

新增项目级开关，默认全部关闭：

```ts
export interface AgentNextPhaseFlags {
  obligationIR: boolean
  witnessSearch: boolean
  constrainedDrag: boolean
  openProblemCompiler: boolean
  proofExport: boolean
}
```

**验收：** `flags=false` 时旧静态示意图链路行为不变；每个 N2–N5 阶段只能在对应 flag 下启用；flag 状态进入运行 trace 和 benchmark report。

---

## Phase N1：统一数学状态 IR 与自由度诊断

**目标：** 把当前 `DiagramObligation`、`PlanRelation`、三维约束和验证报告统一到一个可追溯状态，不改变默认行为。

**Files:**
- Create: `apps/web/src/agent/featureFlags.ts`、`packages/agent-core/src/obligationIR.ts`、`constraintIR.ts`、`claimEvidence.ts` 及测试。
- Modify: `packages/agent-core/src/contracts.ts`, `index.ts`, `diagramObligations.ts`, `diagramVerification.ts`, `relations.ts`。
- Modify call sites: `packages/agent-core/src/planCompiler.ts:299-301`、验证结果回传处、`apps/web/src/agent/draftStore.ts:358-360`、`apps/web/src/agent/workerContracts.ts`、`geometryCompileStrategy.ts`。
- Test: `packages/agent-core/src/obligationIR.test.ts`、Worker 等价测试、现有 diagram/relations tests。

**Interfaces:**

```ts
export type ClaimRole = "given" | "construction" | "goal" | "free_choice"
export type Judgeability = "supported" | "unsupported" | "ambiguous"
export type ClaimEvidenceStatus = "not_run" | "verified_instance" | "sampled" | "formally_proved" | "failed" | "unknown" | "inconsistent" | "timeout"
export type WitnessResultStatus = "verified_instance" | "unverified_instance" | "no_witness"
export type SolverStatus = "not_run" | "model" | "unsat" | "unknown" | "timeout" | "diverged"

export interface GeometryObligation {
  id: string
  role: ClaimRole
  kind: string
  sourceText: string
  start: number
  end: number
  targets: string[]
  expected?: number | string
  judgeability: Judgeability
  tolerance?: { kind: "absolute" | "relative" | "angular"; value: number }
}

export interface ClaimEvidence {
  status: ClaimEvidenceStatus
  solver: SolverStatus
  residuals: Record<string, number | null>
  degreesOfFreedom: number | null
  nextActions: string[]
}
```

- [x] **RED：** 用当前三棱锥题面断言 `given/goal/free_choice`、来源区间、支持/未支持和旧字段兼容；断言 `PlanCompiler → DraftStore → Worker` 不丢 IR。
- [x] **Feature flag：** N1 创建 `obligationIR/witnessSearch/constrainedDrag/openProblemCompiler/proofExport` 五个独立开关，默认 `false`；关闭时跑旧静态路径回归。
- [x] **RED 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/obligationIR.test.ts --maxWorkers=1`；预期因文件/接口不存在失败。
- [x] **GREEN：** 实现 IR 和兼容适配，不让模型自报 relations 取代原话清单。
- [x] **GREEN 命令：** 同上；再跑 `npm.cmd exec -- vitest run packages/agent-core/src/diagram*.test.ts packages/agent-core/src/relations.test.ts --maxWorkers=1`。
- [x] 增加 `reportFreeDegrees(document, constraints)`，返回对象自由度、约束残差、冲突集合和未支持集合。
- [x] **提交检查点：** `git commit -m "feat(agent-core): unify geometry obligation evidence"`。

> **N1 执行记录（2026-10-05）：** 提交 `acd3bd5`（IR + 兼容层 + flag）、`2d62c4d`（R6 缺省改为关）、`b5b33f9`（把开关穿到真正的 Worker 策略并接线应用层）、`f997b3f`（2D 点自由度按 binding 种类判）。门禁读数只写在 `docs/current-status.md` §一（当次实测）；过程与三次复核的发现见 `docs/project-progress.md`。
>
> **与计划原文的偏差（已裁决，未做即是有意不做）：** ① `contracts.ts` / `relations.ts` **未改** —— 设计明文"模型自报 `relations` 不是 IR 的来源，只能作为附加线索"，relation 判据已作为 `perpendicular`/`parallel` 的 obligation 与既有 residual 路径存在，硬塞一等公民属 YAGNI（口径写在 `obligationIR.ts` 头注释）。② `GeometryObligation` 多了一个可选 `geometry.planeLengths` —— 扁平 `targets` 无法还原"每个平面几个点名"，不补就只能猜切点。③ N1 只接线 `obligationIR` 一个开关，另外四个是给 N2–N5 留的占位（不得绕过）。

> **N1 来源追溯补丁（2026-10-06）**：保持 `goals: string[]` / `freeChoices: string[]` 的兼容读口，仅在解析真实原话时附加 `goalSources` / `freeChoiceSources`；IR 和反向适配原样携带区间。手工旧集合仍用 `0/0` 表示未知，不编出处。`ClaimEvidenceStatus` 文档词表补齐已实现的 `verified_instance`；N2 消费这份真实来源，不另写目标解析器。定向测试、Worker 路径与类型检查的当次证据记在 `docs/current-status.md`。

## Phase N2：解析构造、有限数值求解和 WitnessSearch

**目标：** 对首批受支持题型自动产生 verified instance 或明确 no_witness；不把全局候选生成放进 geometry-kernel 的 UI 依赖。

**Ownership（解决 witnessSearch 归属矛盾）：**

- `packages/geometry-kernel/src/witness/`：只放纯几何构造、残差、退化和尺度函数。
- `packages/agent-core/src/solver/witnessSearch.ts`：拥有搜索编排、候选池、seed、预算、排序和 `ClaimEvidence`；不复制几何判据。
- `packages/agent-core/src/underdetermined.ts`：现有 `PolyhedronWitness` / `selectWitness` 保留为兼容 facade，内部转调 `solver/witnessSearch.ts`；不得再出现两套候选选择逻辑。

**Files:**
- Create: `packages/geometry-kernel/src/witness/constructors.ts`, `residuals.ts`, tests。
- Create: `packages/agent-core/src/solver/witnessSearch.ts`, `solverContracts.ts`, tests。
- Modify: `packages/agent-core/src/underdetermined.ts`、`planCompiler.ts`、`apps/web/src/agent/draftStore.ts`。
- Worker: `apps/web/src/agent/workerContracts.ts`、`geometry.worker.ts`、`geometryCompileStrategy.ts`。

**Interfaces:**

```ts
export interface WitnessSearchInput {
  obligations: readonly GeometryObligation[]
  shape: "polyhedron" | "prism" | "pyramid"
  seed: number
  maxCandidates: number
  timeoutMs: number
}
export type WitnessSearchResult =
  | { status: "verified_instance"; candidate: PolyhedronWitness; evidence: ClaimEvidence; assumptions: string[] }
  | { status: "no_witness"; evidence: ClaimEvidence; failures: readonly string[] }
  | { status: "unverified_instance"; evidence: ClaimEvidence; reasons: readonly string[] }
```

- [x] **RED：** 同一 seed 结果稳定；极大长宽比候选不优先；退化/矛盾/超时分别分类；已有 `selectWitness` 行为通过兼容测试。
- [x] **RED 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/solver/witnessSearch.test.ts packages/agent-core/src/underdetermined.test.ts --maxWorkers=1`。
- [x] **GREEN：** 解析构造优先，有限网格兜底；每个候选依次通过拓扑构造和统一 verifier；没有候选不产生草稿。
- [x] **GREEN 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/solver/witnessSearch.test.ts packages/agent-core/src/diagramPipeline.test.ts --maxWorkers=1`。
- [x] **Feasibility spike：** 在独立脚本中评估 Z3/NLSAT/WASM/原生依赖，不接默认 UI；记录许可证、线程模型、包体、启动时间和超时行为。
- [x] **提交检查点：** `git commit -m "feat(agent): add bounded witness search"`。

> **N2 执行记录（2026-10-05）：** 本阶段拆成三个子任务，全部交付并复核。**2a（内核见证构造）** `c2314c9` / `1328088` / `84a6d89` / `e3fdb61`；**2b（搜索编排 + `selectWitness` facade 单实现 + 证据分类）** `8648a13` / `8b70fa1` / `b6a1388` / `ab05add`；**2c（flag 接线 + spike + 出口证据）** `ca1d0b2` / `2f3dd45` / `9c5ae2f`。门禁读数只写在 `docs/current-status.md` §一。
>
> **与计划原文的偏差（已裁决，逐条有据）：**
> ① `WitnessSearchInput.obligations` 由裸 `GeometryObligation[]` 改为 N1 的 `ObligationIR` —— 否则喂给核验器的题设被"洗白"（residue 被丢成 `unverified: []`），搜索器能对**产品路径会判 `unverified`** 的题面报 `verified_instance`（裁决 R32；RED 实证：带 `∠ABC=60°` 的题面改前确实返回 `verified_instance`）。
> ② 接线多改了 `committerAdapter.ts` 与 `agentRuntime.ts` 两处（不在计划的 Files 清单里）—— **协调器是生产主路**（`coordinator → CommitterPort.stage → committerAdapter → DraftStore.stage`），而它此前**一个开关都不传**，不加这两处任何 flag 在生产上都是装饰；顺带使 N1 的 `obligationIR` 在这条主路上第一次真正生效（裁决 R39）。
> ③ 新增 `materialisedActions` 到 `PlanCompileResult` / `StagedCompileResult` / `WorkerSuccess` —— 救援替换了坐标，草稿层的独立复验必须用**实际被物化的那份计划**，否则救援会显示成"未核验"。
> ④ `planCompiler` 与 `solver/witnessSearch` 之间存在**有意的模块环**（`planCompiler.ts:24-37` 写明理由与安全性）；唯一干净的断法是给 `searchWitness` 注入物化端口，但那要改 2b 已复核的公开 API，故 **park 并归 N3**（裁决 R40）。
> ⑤ `shape:"prism"` 恒为 `unverified_instance`：原话解析把 `A′` 压成 `A`，且核验器别名映射只收 `/^[A-Z]$/`。设计 §5 的 R2 出口本来就规定"**不支持**题稳定产出 `unverified_instance`"，故如实上报；带撇点名的支持列为本阶段之后的独立项（裁决 R28）。
> ⑥ `degreesOfFreedom` 保持 `null`（**窄豁免 R35**）：`ConstraintType` 表达不了线⊥面与角度、且 `reportFreeDegrees` 要的是**图元 id**，只映射子集会让数字"看不出漏了什么"；要真算需扩 `dsl` + 内核判据，归 N3。呈现纪律：`null` 必须读作"未计算"，**不得**读作"自由度 0 / 刚性"。

> **N2 后续入口区块（2026-10-06）**：默认关闭的编译救援路径现有独立实验性设置入口，偏好只控制 `witnessSearch`，经既有 `agentNextPhaseFlags → AgentRuntime → DraftStore → Worker` 链路读取。`e2e/next-phase-flag-entry.spec.ts` 4 条通过；未将入口测试误写为开放题真实 provider 成功率。覆盖面扩展属于另一个区块，不因加开关而自动勾为完成。

> **N2 窄覆盖扩展（2026-10-06）**：三角底面存在**唯一点名直角**时可在任意环顶点；`namedRightTriangleBase` 在几何内核归一环的循环起点，搜索器调用同一规则确定自由底边。构造器独立负例确保“侧棱⊥底边”不被读成“底角直角”，最终方案仍调用同一 verifier 与拓扑校验。四边形非环首直角与棱柱撇点名维持未核验，不宣称已有通用求解。详见 `docs/current-status.md` §四 F 的当次门禁。

## Phase N3：动态拖动保持约束

**目标：** 让已确认的几何关系进入文档，拖动点不会静默破坏它们。

**Files:**
- Modify: `packages/dsl` 约束文档 schema、`packages/scene-graph/src/` 约束事务和重算。
- Modify: `apps/web/src/threeScene*` 拖动流水线、`apps/web/src/agent/agentRuntime.ts`、undo/redo、inspector。
- Test: kernel unit、scene-store unit、`e2e/agent-constrained-drag.spec.ts`。

**Interfaces:**

```ts
export interface DragSolveRequest {
  documentGeneration: number
  pointerConstraint: { pointId: string; target: Vector3 }
  constraintIds: string[]
  budgetMs: number
}
export type DragSolveResult =
  | { status: "solved"; document: GeometryDocument; residuals: Record<string, number>; degreesOfFreedom: number }
  | { status: "underconstrained"; document: GeometryDocument; degreesOfFreedom: number }
  | { status: "overconstrained" | "inconsistent" | "timeout"; conflicts: string[]; nextActions: string[] }
```

- [x] **RED：** 拖动保持中点/垂直/固定距离；过约束拒绝；欠约束显示自由度；拖动一步撤销。
  > **逐条落在哪（2026-10-05 核，全部成立）：** 中点 → **派生点**路径（`scene-graph/src/operations.test.ts`：
  > 拖派生中点自己被拒、拖它挂靠的线会带着它走；3D 在 `resolve3d.ts:138`）—— **这一半本来就成立，
  > 不在"约束"而在"派生"里**；垂直 → `constraints3dProjection.test.ts`；固定距离 → 同上；
  > 过约束拒绝 → `constrainedDrag3.test.ts` + `findConstraintContradictions`；欠约束自由度 →
  > `analysis.remainingDof / underconstrained`；**一步撤销 → `apps/web/src/constrainedDragUndo.test.ts`（第 45 轮补）**。
  > **注意**：这不是"新写了一条替代品"，而是逐条确认**既有测试**覆盖到了 RED 的每一个词。
- [x] **RED 命令：** `npm.cmd exec -- vitest run packages/geometry-kernel/src/constraints.test.ts packages/geometry-kernel/src/constraints3d.test.ts packages/geometry-kernel/src/planar-constraints.test.ts packages/geometry-kernel/src/reactive/constraints.test.ts packages/scene-graph/src/operations.test.ts packages/scene-graph/src/patches.test.ts packages/scene-graph/src/scene-store.test.ts --maxWorkers=1`；`npm.cmd run test:e2e -- e2e/agent-constrained-drag.spec.ts --workers=1`
  > **前半段已跑（2026-10-05）：7 文件 / 241 通过 / 0 失败。** 前半段**不是**"跑过一次"就算完 ——
  > 它是第 33 轮才第一次按这个**集合**跑过的。
  > **后半段仍然不成立**：`e2e/agent-constrained-drag.spec.ts` **不存在**，因为**没有任何产品入口能打开
  > `constrainedDrag` 开关（见 `docs/current-status.md` §一.2 第 1 条 —— **2026-10-05 已解决：设置有实验性开关**）。**2026-10-05 补齐：这条现在可以勾了** —— `e2e/next-phase-flag-entry.spec.ts`（入口 3 条）+ `e2e/agent-constrained-drag.spec.ts`（拖动正/反例 2 条，`fixedDistance` 判据；把 `enabled` 写死 `false` 的定向变异会让正例红）。
- [x] **GREEN：** pointer intent → 临时约束 → solve → commit transaction；禁止直接改 render state。
  > **2026-10-05 勾上**：接线决策层 `apps/web/src/constrainedDrag3.ts` + `App.tsx` 的 3D `onDragEnd` —— 保留这次平移 → 算出被拖点的目标坐标 → 以该点为锚跑 `projectPoint3Constraints` → 用一次 `applyBatch`（内部 `commitTransaction`）提交其余点；**没有直接改渲染状态**。浏览器证据：`e2e/agent-constrained-drag.spec.ts`。
- [x] **GREEN 命令：** 上述定向测试；再跑完整 `npm.cmd run test:e2e -- --workers=3`。
  > **2026-10-05 勾上**：定向 7 文件 / **241 通过 / 0 失败**；全量 e2e **191 通过 / 0 失败**（读数在 `docs/current-status.md` §一）。
> **第五步（2026-10-05）：线状 `parallel` / `perpendicular` 的投影。** 计划 RED 里点名的"垂直"
> 这一半补上了：保持**第一条**线不动、把**第二条**绕中点摆过去（最小改动），长度与中点不变。
> 与 2D `projectLineConstraint` **同一口径**，所以不需要新的产品裁决 —— 此前把它记成
> "要先决定旋转哪一侧的点"，那个顾虑其实早就有先例可依。
> **三种如实跳过**：`pointDirection`（方向显式写死）、`perpendicular` 而两条线已平行（没有唯一答案）、
> 第二条线有端点被锚住。`no-projection-rule` 这一支**从此不可达**（保留给下一个新增种类）。
>
> **本阶段出口（2026-10-05 收尾：已达成）**：产品入口通了（设置 → 实验性功能 → 约束拖动），
> `e2e/agent-constrained-drag.spec.ts` 现在 **5 条**，把出口点名的四件事全盖住 ——
> ① `=false` 时旧拖动路径的**浏览器**回归（关着拖动**真的改变** `|AB|`；少了这条，"打开时不变"可能只是拖没生效）；
> ② `=true` 时**保持约束**（同样拖动后 `|AB|` 仍是 1，且先断言 A 真的动过 —— 不许用"没变"冒充"被约束住"）；
> ③ **过约束拒绝**（同一条线段被赋两个长度 → 拖动被拒、拒绝文案**点名冲突的约束 id**、草稿坐标逐字未变）；
> ④ **冲突恢复**（拒绝既不写文档也**不占一步历史**；把冲突修掉后同一次拖动**正常提交**）与**一步撤销**
> （一次 Ctrl+Z 让四个点全部回到拖动前，且历史只占一步）。
> 后三条由提交 `d7fe702` + `2dd89ab` 落地，**是"回归钉子"而不是 RED**（首跑即绿，实施者如实申报），
> 每条都用**变异**证明会咬人（拒绝落回旧路径 / 关掉矛盾判据 / `applyBatch` 拆成逐点 `apply` / 把提交强制成
> `noop` / 加一步幽灵历史 / 拒绝只点名一个 id —— 六个变异各自命中对应断言，全部还原）。
> **仍然没实现的**：`inconsistent` / `timeout` 两个**状态**（顺序投影下矛盾只会振荡，本层如实报 `exhausted`
> 而不报"无解"；`timeout` 这层没有时钟，也不打算为凑状态引入一个）。**这不影响本条出口**：出口要求的是
> 那三类行为在浏览器里被验过，而不是 `DragSolveResult` 的五个状态全部存在（那一条计划的原文仍未按原样成立，
> 见第四步的记录）。

> **2026-10-06 后续安全加固，不是新求解类型：** 若显式开启约束拖动，空间 `coincident` 无 3D 判据时，定义点拖动或投影连带移动将拒绝并保留文档与历史；关闭开关的旧路径不变。定向 18/18，非 Lean 慢集成 324 文件 / 3781 通过 + 1 todo，完整 e2e 196/196；Lean 慢集成本区块未单独重跑。

- [x] **N3 出口：** `constrainedDrag=false` 时旧拖动路径逐字回归；`constrainedDrag=true` 时保持约束、过约束拒绝、冲突恢复和一步撤销的浏览器用例全部通过。
  > **2026-10-05 勾上**：五条浏览器用例全绿（`5 passed (29.5 s)` 单跑；我自己复跑过），全量 e2e **194 通过 / 0 失败**（控制器实测）。`=false` 的回归、`=true` 的保持约束与上面三条都在同一份 spec 里。
- [x] **提交检查点：** `git commit -m "feat(geometry): preserve constraints during drag"`。
  > **2026-10-05 勾上**：本阶段工作以多次提交落地 —— `6c43044` 第一块砖 / `9ae58de` 第二步 / `a40afdb` 第三步（接线决策层）/ `db04158` 第四步（可证矛盾）/ `3f7cfa4` 第五步（线状平行垂直投影）/ `fbb7584` 产品入口 / `96be699` + `6d21847` 浏览器正反例 / `616881a` 一步撤销（单元）/ **`d7fe702` + `2dd89ab` 出口的三条浏览器用例**。**没有使用这条建议的提交信息**（各批各有自己的信息），但"本阶段收尾"这件事本身已经完成。

> **N3 执行记录（2026-10-05，进行中，两步内核砖）：** 上面五条检查项**一条都还没勾**——
> 本阶段目前交付的全是**内核侧**的东西，**没有任何产品调用点**：
> ① 点投影 `packages/geometry-kernel/src/constraints3dProjection.ts` 的 `projectPoint3Constraints`
> （提交 `6c43044`）—— 上面"GREEN：pointer intent → 临时约束 → solve → commit transaction"里
> **solve 那一步的最小实现**，支持 `pointOnLine` / `pointOnPlane` / `collinear` / `coplanar` /
> `fixedDistance`，带 `anchoredPointIds`（拖动时抓住的点不许动），判据 fail-closed；
> ② 同一函数的 `analysis`：拖动层的**自由度与冗余诊断**（数值雅可比 + 秩），对应上面 RED 里的
> "过约束拒绝"与"欠约束显示自由度"两条读数。同时把 `agent-core/src/constraintIR.ts` 的 `rankOf`
> 删掉、改调内核新的 `linear-algebra.ts` 的 `rankRows`（消灭一处跨包重复）。
> 读数见 `docs/current-status.md` §一。
>
> **为什么先做这些**：内核原有的 `solvePoint3Constraints` 契约明写"只诊断、绝不动点"，回答不了
> "该挪到哪"；而 `DragSolveResult` 的五个状态里，`underconstrained` / `overconstrained` 需要秩，
> 秩又必须在**最终构型**上算。三条判据合起来才够判一次拖动能不能提交。分工保留，不合并。
>
> **还没做的（本阶段剩下的全部）**：五个状态里 **`solved` 与 `underconstrained` 的原始数据齐了**
> （`satisfied` / `remainingDof` / `overconstrained`），但 **`inconsistent` 与 `timeout` 没做** ——
> 矛盾约束在顺序投影下只会**振荡**，本层如实报 `exhausted` 而不报"无解"（要报"无解"需要可证的
> 冲突检测）；`DragSolveRequest` / `DragSolveResult` 这两个**契约本身还没写**；
> `packages/dsl` 与 `scene-graph` 一行未动；`apps/web` 的 `threeScene*` 拖动管线、undo/redo、
> inspector **未接线**；`e2e/agent-constrained-drag.spec.ts` **不存在**；
> 线状 `parallel` / `perpendicular` 的投影仍是 `no-projection-rule` 跳过
> （3D 里"把两条线转成平行/垂直"的最小改动不唯一，属产品判断）。
> **`constrainedDrag` 这个 flag 还不存在**（N6 的 flag 核对里要记这一笔）。
>
> **本阶段两条 park 项的状态**（来自 N2 记录 ④⑥）：
> ④ 模块环**还没动**（按裁决等"N3 的第二个消费者"到场时一次定死）。
> ⑥ "真正算出自由度"**要分清是哪一层**：新做的 `analysis` 是**拖动层**的自由度（按锚点算、
> 不扣规范自由度）；N2 那条 `witnessSearch` 里恒为 `null` 的 `degreesOfFreedom` 是**文档层**的
> 问题，仍然没动 —— 它要先扩 `ConstraintType` 到能表达线⊥面与角度。两者共用秩，但不是一件事。
>
> **接线位置已查实（2026-10-05，只侦查、没接线）：**
> N3 的出口落在 `apps/web/src/App.tsx:854` 那个内联 lambda。3D 拖动是**抬手才提交一次**
> （`threeSceneInteraction.ts` 文件头写明"拖动期间不提交文档，抬手才回调一次"，
> 提交点在 `dragEndRef.current?.(session.targetId, session.total)`），现在写的是
> `(id, delta) => apply({ op: "translatePrimitive3", id, delta })`。
> 所以约束拖动的接法是：**保留这次平移** → 用它算出被拖点的目标坐标 → 以该点为锚跑
> `projectPoint3Constraints` → 把其余点的坐标**用一次 `applyBatch` 提交**。
> `apps/web/src/store.ts` 的 `applyBatch` 走 `commitTransaction`，它的注释就写着"手工 UI 的
> 批量删除走这里，而不是循环调用 `apply`" —— 于是**"一步撤销"是白拿的**，不需要新机制。
>
> **两处必须分清**：紧邻的 `onHostDragEnd`（`App.tsx:855-861`）是**另一条路** —— 它只提交
> **宿主参数**（`binding3.parameter` / `uvw`），坐标由重算从参数算出（注释原话："点永远精确落在
> 宿主上"）。约束拖动**不许**把它当成"点坐标平移"一起处理。
>
> **那个前置已裁决，接线也做了（2026-10-05 第三步）**：op 工厂 `patchPoint3(id, position)`
> **早就存在**（`packages/scene-graph/src/operations.ts`），所以"一次改多个点坐标"**不需要新 op** ——
> `applyBatch([patchPoint3(…), …])` 一次事务写完，一步撤销是白拿的。接线落在
> `apps/web/src/constrainedDrag3.ts`（纯函数 `planConstrainedDrag3`）与 `App.tsx` 的
> `commitDrag3End`。
>
> **与计划原文的偏差（已裁决，逐条有据）：**
> ① 计划里的 `DragSolveRequest` / `DragSolveResult`（五个状态）**没有按原样实现**，落地成
> `ConstrainedDragRequest` / `ConstrainedDragOutcome`，出口是 `passthrough` / `noop` /
> `refused` / `commit` **四种**。理由：`inconsistent` 与 `timeout` 这两个状态**目前给不出诚实的
> 判据**（矛盾约束在顺序投影下只会振荡），编一个出来就是"把没算过的说成结论"；而
> `passthrough`（这一批不管这条路）与 `noop`（约束把拖动完全抵消）是实际会用到的两种真实出口，
> 计划原文里没有。等冲突检测做出来再谈合并。
> ② **被拖点是"暖启动"，不是硬锚** —— 计划原文没写这一条，但它决定功能可不可用：做成硬锚时
> "拖一个被约束在平面上的点"会 100% 被拒（这个点自己就违反了它自己的约束）。
> ③ **开关默认仍然关着**（`agentNextPhaseFlags()` 恒返回五关），所以这一批**产品行为未变**；
> 也**没有浏览器入口**能把它打开，因此计划要求的 `constrainedDrag=true` 浏览器正/反例
> **仍未达成**。
>
> **第四步：可证的矛盾（2026-10-05）** —— 上面"没做的"里那条
> "`inconsistent` 没做（矛盾约束只会振荡，本层如实报 `exhausted` 而不报'无解'）"**被部分解掉了**：
> 内核新增 `findConstraintContradictions`，**只报能证明的两种**（同一条线段两个不同长度；
> 点既在线上又在面上而两者平行且不相交），投影结果新增 `contradictions`，接线层的拒绝文案
> 先报矛盾。**"部分"是准确的**：直线 ∥ 直线不相交**没有判据**，那种情形仍然只能说
> "没能同时满足"；而且 `timeout` 仍然不存在（本层没有时钟，也不打算为了凑状态而引入一个）。
> 计划原文的 `DragSolveResult` 五状态因此**仍未按原样成立**。

## Phase N4：开放题编译与真实 Provider Benchmark

**目标：** 把自然语言抽取、求解、验证和图面可读性分别测量；不使用 deterministic_local 冒充模型能力。

**Files:**
- Create: `scripts/agent-benchmark/dataset.schema.json`、`runner.mjs`、`redaction.mjs`、`report.mjs`、tests。
- Modify only after dataset schema is green: `apps/web/src/agent/systemPrompt.ts`、`modelPlanner.ts`、tool loop contracts。
- Docs: `docs/acceptance/agent-tool-loop-scorecard.md`、`agent-release-gate.md`。

- [x] **RED：** 缺 `provider/model/seed/status`、包含 secret、claim 缺 evidence、模式未标识时报告生成必须失败。
  > **2026-10-05 勾上**：四类拒绝都有用例 —— 题集侧 `benchmark.test.ts`（缺必填字段点名字段与行号 / 原话带凭据要抛 / `category` 不在词表要抛 / 未声明字段要抛 / `id` 重复要抛）、运行记录侧（缺 `provider` `model` `seed` `status` `layer` 任一都要抛且点名 / **模式未标识要抛** / `real_provider` 却说不出 provider·model 要抛 / `claim` 缺证据要抛 / 带凭据要抛），且"没测"必须写成显式 `null` 而不是删键。

**Interfaces:** `BenchmarkCase` 读取 JSONL 题集；`BenchmarkRun` 必须含 `provider/model/seed/mode/status/evidence/cost/latency`；`BenchmarkReport` 分开输出 `deterministic_local` 和 `real_provider`。
- [x] **RED 命令：** `npm.cmd exec -- vitest run scripts/agent-benchmark --maxWorkers=1`。
- [x] 题集至少包含：欠定、矛盾、未支持表达式、点名打乱、二面角/比例、动态请求、普遍证明请求。
  > **2026-10-05 勾上**：`scripts/agent-benchmark/cases.jsonl` **21 条 = 七类 × 3**（`underdetermined` / `contradictory` / `unsupported-expression` / `shuffled-naming` / `dihedral-or-ratio` / `dynamic-request` / `universal-proof-request`），并有一条用例钉"随仓库走的那份题集七类全覆盖"。
- [x] 每题最多 3 轮，记录抽取率、求解率、题设覆盖率、verified/unverified/no_witness、成本、延迟和人工可读性。
  > **2026-10-05：七项里六项在位，仍不勾。** 已在位：轮次上限（"每题超过 `MAX_ROUNDS_PER_CASE` 轮要**整份拒收**"）、抽取率（题级）、求解率（见证层）、题设覆盖率（子句级，且"一条子句都没读到时报 `null` 而不是 0"）、`verified`/`unverified`/`no_witness` 三种结局计数、`cost`/`latency` **字段**（允许显式 `null`）。**缺的一项是"人工可读性"**：报告契约里**没有这个字段**，也**没有任何一次人工标注** —— 它要等真实 provider 真跑过才有对象可读，所以这一条与下一条一起卡在同一次运行上。
  > **2026-10-05 第二次更正（N4e，提交 `dbe6fb1`）—— 前半已补齐，这一格仍然不勾**：现在
  > ① **字段有了**：`BenchmarkRun.humanReadability`（**键必须在、值可 `null`**，词表外一律拒收）；
  > ② **有对象可读了**：面板的只读「人读区」呈现模型给的那段正文（计划的 `goal`+动作摘要 / 澄清的问题 / 只读回答），
  >    harness 从**内存里的信封**取、与 `runs` 一一配对（不解析证据串、不塞进 `evidence`）；
  > ③ **口径写死了**：三值 + 判断者是"不懂实现的人"，「`not_measured` / `error` 不进分母」，
  >    「`plan` 与 `clarification` 各有各的分母」，`readableRate` 的分母是**已标注**条数（0 标注 ⇒ `null`，不是 0）。
  > **仍然不勾的唯一理由**：**一次标注都没有**（已标注 = 0；报告里出现的是"未标注"，不是 0 分、也不是占位比率）。
  > ⇒ 这一格剩下的**不是代码**，是**一个人真的去读那几段正文并打分**（口径已定：见 `HUMAN_READABILITY_VALUES` 的定义处）。
  > **2026-10-06 第三次更正 —— 这一格勾上（`[x]`）**：那次"人真的去读并打分"**发生了**。
  > 用户在桌面端跑第三次题集 planning（3 题 × 1 轮，`seed=7`）并在只读「人读区」里逐条打标，面板回传的**读数原文**：
  > `planned 1/3` / `clarification 1/3` / `rejected 0/3` / **`error 1/3`** / `not measured 0/3`；
  > `average latency 18153 ms (measured runs only)`；`cost not measured（仓里没有价目表）`；
  > 人工可读性三行 ⇒ `plan 已标 1 / 未标 0`、`clarification 已标 1 / 未标 0`、`rejected 已标 0 / 未标 0`，
  > 两条都判 `unreadable` ⇒ 两组 `readable 比率 0.000`；`rejected` 组如实显示「未标注（分母 = 已标 0，不是 0 分）」；
  > **合计已标 2**。核对：`3 = 1+1+0+1+0`（五项自洽）、标注 `2 = 1+1`、层与 seed 对得上、`cost` 如实 `not measured`。
  > **来源如实标注**：**用户提供的实测**（控制器**未旁观**那次运行），控制器只核内部自洽 —— 与前面几次同一条纪律。
  > **读法边界（不许读成趋势）**：**每组 n=1** 的两个 `0.000` 说的是"这一次那两条，判的人都说看不懂"，
  > **不是**"模型的可读性差"，也**不是**全题集（21 条）的结论（本次只发前 3 条）。判断者是**不懂实现的人**，这是口径要求的。
  > **七项的最终落点**：轮次上限 / 抽取率 / 求解率 / 题设覆盖率 / 三结局计数 / 延迟 **六项此前已在位**，
  > **人工可读性本次到位** ⇒ 勾；**成本**仍是 `not measured`（**没有价目表**，不是没做）。
  > **同一次运行暴露的一条新边界（已记、未修）**：`unsupported-expression` 那条**没测到**，结局是 **`error`**，
  > 原始消息 `传输失败已尝试 3 次（上限 3）… the response exceeded 1048576 bytes` ⇒ **模型响应超过 1 MiB 上限**。
  > 它**如实报错**而没有被记成 `rejected` / `planned`（fail-closed 正确）；**这条通道对超大响应的题今天测不出来**，
  > 上限可配 / 换传输方式**都还没做**。这也是 `planned` 从 `2/3` 掉到 `1/3` 的原因：**分母没变，是那一条从"有结论"变成"没测到"**。
- [x] 先跑小样本真实 provider；无凭据时写 `not_measured`，不伪造数字。
  > **2026-10-05 勾上（两半都达成）**。**后半句**（"无凭据就写 `not_measured`、不伪造数字"）此前已落实；
  > **前半句**在 `2026-10-05` 由**用户在桌面端**跑出来了（授权规模 3 题 × 1 轮）——面板读数原文：
  > `mode: real_provider — 题集 planning`；`provider deepseek-v4-flash / deepseek-v4-flash`；
  > `cases 3（layer=planning，seed=7）`；**`planned 2/3` / `rejected 1/3` / `error 0/3` / `not measured 0/3`**；
  > `average latency 13445 ms (measured runs only)`；`cost not measured（仓里没有价目表）`。
  > **来源如实标注**：这是**用户提供的实测**（控制器**未旁观**那次运行），控制器只核了它的**内部自洽**
  >（`3 = 2 + 1 + 0 + 0`、层与 seed 对得上、`real_provider` 有非空身份、`cost` 如实 `not measured`）。
  > **读法边界**：这条通道发的是**空画布条件下的规划请求**（空场景 + 全技能 + 无只读工具）⇒ `2/3` 只能读成
  > 「**空画布条件下计划被接受的比例**」，**不是**"模型的规划能力"，也**不是**全题集（21 条）的结论（本次 n=3）。
  > **这次暴露的一处缺口（已修）**：面板当时**只渲染汇总**，"被拒的那一条为什么被拒"随窗口一起丢了
  >（原因其实在 `runs[].evidence` 里）⇒ 已改成**逐条渲染**（题 id / 结局 / 理由原文，带截断上限），并有判据钉着。
  > **仍未达成的是下面那条**（`:324` 的人工可读性）。
- [x] **提交检查点：** `git commit -m "feat(eval): add real provider benchmark schema"`。
  > **2026-10-05：故意不勾** —— 它是**本阶段收尾**的检查点，而上面两条还没达成。本阶段的工作已经以多次提交落地（`6829f77` 题集与报告契约 / `ca9d286` 运行入口与 `layer` 契约 / `6a5c2f0` 之后的题集 7→21 等，逐条见 `git log`），但**没有使用这条建议的提交信息**。
  > **2026-10-06 勾上**：上面那两条（`:326` 小样本真实运行、`:324` 人工可读性）**都已达成** ⇒ 本阶段收尾。
  > **但"勾"不等于"建议的提交信息被用过"** —— 实际情况与上面那句一致：N4 的工作分散在
  > `6829f77` / `ca9d286` / `6a5c2f0` / `f315cf6` / `e1d48ed` / `00a8154` / `e7ce865` / `281ce25` / `c15e99f` / `2f10be6` /
  > `907ecb0` / `4301606` / `00a2898` / `76a3062` / `e4e04ca` / `90eba6e` / `28e8beb` / `4e13c7f` / `dbe6fb1` / `b6312a7`
  > 等**多次提交**里，**没有一个**用那句建议信息。**这条检查项的本质是"阶段收尾"，不是"提交信息必须长这样"** ——
  > 所以勾的是收尾，并把"提交信息没用过"这件事留在记录里（与前一条同一个口径）。
  > **本阶段仍如实未达成的只有一项**：**成本**永远是 `not measured`（**没有价目表**）；以及第三次运行新暴露的
  > **1 MiB 响应上限**（超大响应那类题**测不出来**，如实记 `error`，修法未做）。

> **N4 执行记录（2026-10-05，只完成第一步）：** 上面几条检查项**一条都还没勾** ——
> 已交付的是**载体与判据**：`scripts/agent-benchmark/` 的 `dataset.schema.json` + `dataset.ts`
> （JSONL 题集 schema 与校验器，词表只从 schema 读）、`redaction.ts`（凭据检查，题集与报告两道口子）、
> `report.ts`（运行记录与报告契约）、`cases.jsonl`（七类各一条的起步题集），加 **24 条**用例。
>
> **与计划原文的偏差（有据）：** ① 文件名由计划的 `*.mjs` 改成 `*.ts` —— `scripts/tsconfig.json`
> 的 `allowJs` 是 false，`.mjs` 根本不过 `tsc`，而 `.test.ts` 去 import `.mjs` 要手写声明（第二份
> API、会漂移）；Node 24 可直接执行 `.ts`，将来的 node 入口仍然做得到。
> ② `provider` / `model` 的口径由"必须含"细化成**键必须在、值可为 `null`**：`deterministic_local`
> 本来就没有 provider，硬要求非空就得编一个名字。`real_provider` 模式下两者必须是非空字符串。
>
> **还没做的（本阶段剩下的全部）：** `runner.mjs`（真正跑题集的入口）、题集**内容**的扩充
> （现在只有七类各一条，远不够算覆盖率）、**一个真实 provider 都没跑**（所以报告里没有任何
> pass@1 / pass@3 / 成本 / 延迟 / 人工可读性数字）、抽取率与题设覆盖率的统计、
> `agent-tool-loop-scorecard.md` 与 `agent-release-gate.md` 的回填。
>
> **第二步（2026-10-05）：运行入口与 `layer` 契约。** 上面那句"`runner.mjs` 没写"**已解决**：
> 新增 `runner.mjs` + `run.test.ts` + `npm run bench:agent`（与 `scripts/agent-eval.mjs` 同一条
> 纪律：没有 TS 运行器，真正的运行放 `.test.ts`，入口只传命令与退出码）。
> **顺带修掉一个契约缺陷**：运行记录原来只有见证层的一套结局词，而"只跑抽取"的那一轮根本没有
> 见证结论 —— 现在分 `extraction` / `witness` 两层，每层有自己的词表，跨层用词被拒绝。
> **第一个真实读数**：`BENCHMARK_COVERAGE cases=7 covered=5 empty=2 error=0`。
>
> **第四步（2026-10-05）：题集 7 → 21 条 + 题集级不变量。** 每类从 1 条加到 3 条 ——
> 每类只有一条时，`covered` 测的是"这一条恰好过不过"，不是"这一类行不行"。
> 扩完的归因（**机器展开**，不是我逐条读）：`cases=21 covered=14 empty=7 error=0`，
> **7 条 `empty` 全部带 residue**，**14 条新用例里没有一条整句凭空消失** ——
> 包括特意按同一类写法挑的两条（"让 M 始终是 AB 的中点"、"让 PA 始终垂直于平面 ABCD"）。
> 同时新增一条**题集级不变量**用例（每条题至少留下一条给定义或一条 residue），
> 把上一轮那个静默丢句钉在题集这一层。
> **读数不可比**：`5/7`（71%）→ `14/21`（67%）**不是下降，是题集换了**（新加的三类刻意偏难），
> **只记录、不比较**。
>
> **仍然没解决的**：`real_provider` 仍整批 `not_measured`（**2026-10-05 更正：不是"适配器没写"** —— **生产侧的 provider 适配器早就有了**：`providers/adapter.rs`（621 行，含 SSRF 守卫），且**有一次真实往返记录**（2026-09-29，DeepSeek `deepseek-chat`）。**"走回环代理还是自己发请求"这个决定做了（方案 C：把 harness 搬进应用内）**，而且**评测那一侧已经落地**（`runProviderAgentEval` + 设置面板，两段式、会花钱、密钥不出凭据库）—— 但**一次都还没跑过**，所以还没有数字。**缺的仍然包括 benchmark 那一侧的 `real_provider` 模式**：那 21 条题的题集与报告契约在 **workspace 之外**，要先搬进包里才能给应用共用）
> 属独立一批）；报告里仍然没有 pass@1 / pass@3 / 成本 / 延迟 / 人工复核率（**但"求解率"第 48 轮有了**：离线见证层 `solveRate=0.048`；原来把它记成"缺一个定义"是错的）。

> **第五步（2026-10-05）：题集与报告契约搬进包里（一份定义，CLI 与应用共用）。** 提交 `f315cf6`。
> 这一批**不加新能力**，只把"一份定义"交出去 —— 但它是 N4 后半段的前提，因为
> `scripts/` **不是工作区**（根 `package.json` 的 `workspaces` 只有 `apps/*` + `packages/*`），
> 应用侧（浏览器）**拿不到它**：于是应用内那次真实 provider 评测用的是自己那套旧 **8 题**夹具
> （`AGENT_TASK_FIXTURES`，逐条点过：`create-cube` / `create-tetrahedron` / `section-after-solid` /
> `modify-section` / `reject-degenerate-cube` / `visual-fit` / `visual-fit-drawn` /
> `recover-invalid-reference`），而 `bench:agent` 跑的是这 **21 条** —— 两边都自称"跑过了"，
> 数字却不可比。
> - **搬了什么**：`report.ts`（314 行）/ `redaction.ts`（66 行）/ `dataset.schema.json`（41 行）
>   **blob 级零改动**地搬进 `packages/agent-core/src/benchmark/`（跨改名用 **blob 哈希**核对：
>   三份 base/head **完全相同**，不是靠 diff 的 `0 0` 推断）；`dataset.ts` 只 **+20 行**
>   （import、`parseBenchmarkCases()`、注释）、**零删除** ⇒ 校验规则一条未动；新增
>   `benchmark/index.ts`（**逐项 re-export**，不 `export *`）与包根 `export * from "./benchmark"`。
>   CLI 入口 `runner.mjs` **没动**（它只 spawn vitest 跑 `run.test.ts`）。
> - **题集载体**：`scripts/agent-benchmark/cases.jsonl` 删除，改成 `cases.ts` 的
>   `BENCHMARK_CASES_JSONL` **文本常量**（格式仍是 JSONL，`parseBenchmarkDataset` **逐字不变**地解析它）
>   —— 理由只有一个：**浏览器不能 `node:fs`**，而"随仓库走的那份题集"必须**只有一处**定义。
>   原文由 git blob 生成、**不手抄**。
> - **"一个字节都没变"是复算出来的，不是宣称**：用仓外脚本把那段字面量解析回文本，与
>   `e96d0f5:scripts/agent-benchmark/cases.jsonl` 的 blob **逐字节**比对 —— **5488 字节、
>   sha256 `7bc7b49c074b85f3fc09cbbf91a1eb1a64883ce9078424741ee2d047af54769e`、无 CR（只有 LF）**，
>   双侧一致；且 `cases.ts` 注释自报的 blob `49dce3da…` / 字节数 / 摘要**被独立复算对上**。
>   （工作树里那份 `.jsonl` 曾是 5509 字节 CRLF —— 那是 autocrlf，**口径必须对 blob**。）
> - **读数逐字不变**：`npm run bench:agent` **exit 0 / 13 通过**，三条必守读数与改前相同 ——
>   `BENCHMARK_COVERAGE cases=21 covered=14 empty=7 error=0`、
>   `BENCHMARK_PREMISE obligations=24 residue=9 rate=0.727`、
>   `BENCHMARK_EXTRACTION covered=14/21 rate=0.667`；见证层
>   `verified=1 unverified=20 no_witness=0 error=0 solveRate=0.048`。
> - **新增应用侧判据**（`apps/web/src/agent/fixtures/benchmarkContract.test.ts`，**5 条**，
>   **只 import `@draw/agent-core`、不读任何文件**）：题集能在浏览器 import 路径下拿到
>   （21 条 = 七类各 3）、**题集冻结指纹**、词表与状态常量可用、报告契约可调用并正确分组、
>   报告错误类型与文案未变。
> - **"会咬人"是变异证明过的**（两处变异都做了字节级备份 + 还原）：删掉题面里**一个字符** →
>   **长度断言红**（`expected 5485 to be 5488`）；把全角逗号换成句号（**字节数不变**）→
>   **只有哈希断言红**（`da626ef5…` ≠ `7bc7b49c…`）。还原后文件 sha256 与备份**逐字节一致**。
> - **一处自纠（记下来）**：这条判据的第一版是**恒真式** —— 它断言
>   `parseBenchmarkCases()` 与 `parseBenchmarkDataset(BENCHMARK_CASES_JSONL)` 相等，而前者**就是**
>   后者的定义（`return parseBenchmarkDataset(BENCHMARK_CASES_JSONL, where)`），**不可能红**；
>   注释却宣称它能挡"两份副本分叉"，而**根本没有第二份**。**恒真断言挡不住任何东西**，
>   已换成上面的冻结指纹，措辞也改成事实（钉的是"这一份没有被静默改动"）。
> - **顺带修一处被本次搬迁证伪的注释**：`scripts/nodeTypes.d.ts` 里 `readFileSync` 的理由原文写
>   "`scripts/agent-benchmark` 的用例用它读随仓库走的题集（`cases.jsonl`）"—— 那个用法**已被删掉**；
>   改成点名当前真实用户（`scripts/docs-consistency/*.test.ts`、`scripts/dependency-licences/licences.test.ts`），
>   **声明本身保留**（它们仍需要它）。
> - **计划原文两处路径因此过期**（记录在此，不改写历史）：第 313 行 Files 里的
>   `scripts/agent-benchmark/dataset.schema.json` 与第 323 行注记里的
>   `scripts/agent-benchmark/cases.jsonl` —— 现在分别是
>   `packages/agent-core/src/benchmark/dataset.schema.json` 与 `.../cases.ts`。
> - **本步没有解决的**：应用内评测（`providerAgentEval.ts` / `ProviderEval.tsx`）**仍然**跑那 8 条夹具
>   —— 把它接到这 21 条上是 N4 的下一步（**已裁决：契约新增 `planning` 层，端到端记"计划是否被编译接受"**）；
>   `run.test.ts` 的 `real_provider` 仍整批 `not_measured`（那句"适配器还没写"的旧措辞留给下一步改）；
>   `parseBenchmarkCases()` **没有缓存**（每次解析一次，刻意不引入第二份可漂移的东西；渲染路径上只应调一次）。

> **第六步（2026-10-05）：应用内评测接到统一题集 + 契约新增 `planning` 层。** 提交 `e7ce865` / `281ce25` / `c15e99f`（未含本次文档修正，修正另提）。
> 这一步把第五步交出去的"一份定义"真正用上：应用侧**不再**只跑自己那套旧 8 题夹具，而是跑**同一份 21 条题集**的前 3 条。
> - **契约新增第三层 `planning`**（`packages/agent-core/src/benchmark/report.ts`）：词表 `planned` / `rejected` / `error` / `not_measured`，
>   每个词的含义写在定义处。**判据只有编译器那一个返回值**：`planned` = `compilePlan` 返回 `ok` **且**信封是 `kind: "plan"` ——
>   **不看模型自述**，也不需要金标准（这正是本条口径被裁决的理由：接受与否是客观的）。
>   **一处实施者自己的判断（我核过并采纳）**：模型只给**澄清**（`ok` 为真但信封不是计划）记 **`rejected`** 而**不是** `planned` ——
>   "把澄清记成接受会让'没给计划'读起来像'计划通过了'，错的方向必须朝保守那边偏"。这条是 fail-closed 的落点，且有用例钉着。
> - **应用侧新通道** `apps/web/src/agent/fixtures/benchmarkPlanningEval.ts`：题集来自 `parseBenchmarkCases()`（**不许**在 `apps/` 下抄题面、**不许** `node:fs`）、
>   固定 `seed=7`（与 CLI 同一个）、`cost` **显式 `null`**（仓里没有价目表）、`latency` 实测；**先解析 provider 再决定跑不跑**（解析失败 ⇒ 整批 `not_measured` 且**一次请求都不发**）。
>   规模常量只有**一处**（3 题 × 1 轮）；契约的 `MAX_ROUNDS_PER_CASE = 3` 是另一件事，两者不许混。
> - **界面**：两套评测**各自独立、各自两段式、各自报请求数**（agent 工具环 8×3 = **24** 次 / 题集 planning 3×1 = **3** 次）；
>   旧那套 8 题记分卡的**行为一个字未改**（并存不删，两个坐标系）。**合并按钮是不允许的** —— 那会让"我点了什么、会花多少钱"说不清。
> - **与计划原文的偏差（用户裁决，记录在此）**：计划本节的 `Interfaces` 写的是"`BenchmarkReport` 分开输出 `deterministic_local` 和 `real_provider`"，`BENCHMARK_LAYERS` 原本只有 `extraction` / `witness`。
>   **新增 `planning` 是用户 2026-10-05 的明确裁决**（三选一里选 A：端到端"计划是否被编译接受"），理由是真实模型产出的是**规划**能力、不是"原话 → 题设子句"的抽取，
>   塞进 `extraction` 正是 `report.ts:29-36` 自己写明的**范畴错误**。**代价**：多一个层名与一套词要维护；CLI 仍只发两层，所以 `bench:agent` 的三条读数**一字未动**。
> - **读数边界（必须与数字一起读）**：这条通道发的是**空画布条件下的规划请求** —— 观察结果是空场景、技能是**全部技能**、且**没有只读工具**（harness 没有 `ToolPort` 宿主）。
>   所以将来那个数字要读成「**空画布条件下计划被接受的比例**」，**不是**"模型的规划能力"。这句原来只写在适配器的注释里，
>   控制器本次把它补进了 `current-status.md` 与 `CHANGELOG.md`（一个会被误读成"模型能力"的数字，光写在实现注释里不够）。
> - **本步查出一处既有真缺陷（未修，如实记）**：旧那条通道（`providerAgentEval.ts` + `offlineAgentEval.ts:30`）把请求写成 `{ userMessage } as never` ——
>   那对 `createLocalPlanner` 成立，对**真实** `createModelPlanner` **不成立**（它要 `request.model.context` / `.tools` / `run` / `budget` / `signal`），
>   实测抛 `TypeError: Cannot read properties of undefined (reading 'context')`，而且抛在**任何请求发出之前**、`runProviderAgentEval` 不接异常
>   ⇒ 界面会永远停在"正在跑…（24 次请求）"、**一次请求都不会发**。现有 4 条用例全注入本地规划器，所以从没被照到。
>   **本批没改它的行为**（改它会动旧评测语义），方向的建议记在 `task-4b-report.md` §7.4：给 agent-core 一个可复用的 `buildPlanRequest`，
>   而不是在 fixtures 里再拼一份（`coordinatorPorts.ts` 明文说"模型能看到什么"的归属地是协调器）。**新通道不受影响**（用完整 `PlanRequest`，并有"真规划器 + 假 transport"的用例）。
> - **控制器自跑门禁（当次实测）**：全库 **318 文件 / 3659 通过 + 1 todo / 0 失败**（exit 0）；`typecheck` exit 0；`lint` **0 error / 13 warning**；
>   `bench:agent` exit 0 且三条读数**逐字不变**（`cases=21 covered=14 empty=7 error=0` / `obligations=24 residue=9 rate=0.727` / `covered=14/21 rate=0.667`）；
>   `test:e2e` **194 通过 / 0 失败**；定向 **5 文件 / 62 通过** 加 CLI 那 13 条；BOM `mismatches=0`；题集 blob 与 BASE 相同。
>   哨兵核验：`BENCHMARK_LAYERS` 那条精确钉**被更新成三项**并**补了新层逐项相等的钉子**（不是改成 `toContain`、也不是删掉）。
> - **本步没有解决的**：**那次真实 provider 运行仍然没跑**（触发点在桌面端、密钥在系统凭据库里；`bench:agent --mode=real_provider` 仍整批 `not_measured`）；
>   计划第 324 行的"**人工可读性**"仍然**既没有字段也没有标注**（要等有对象可读）；旧那条通道的请求形状缺陷**待裁决**。

> **第七步（2026-10-05）：第一次真实 provider 运行（由用户执行）+ 复核修正批次。** 修正提交 `907ecb0`。
> - **运行**：**用户在桌面端**跑的（授权规模 **3 题 × 1 轮**，走的是应用内「真实 provider 评测：题集 planning」那条通道）。
>   读数原文（面板回传）：`planned 2/3` / `rejected 1/3` / `error 0/3` / `not measured 0/3`；
>   `average latency 13445 ms (measured runs only)`；`cost not measured（仓里没有价目表）`；
>   provider `deepseek-v4-flash / deepseek-v4-flash`；`cases 3（layer=planning，seed=7）`。
>   **来源如实标注**：控制器**未旁观**那次运行，只核了**内部自洽**（`3 = 2 + 1 + 0 + 0`、层与 seed 对得上、身份非空、成本如实 not measured）。
>   **读法边界**：空画布条件下的规划请求 ⇒ `2/3` = 「**空画布条件下计划被接受的比例**」，不是"模型规划能力"，也不是 21 条的结论（**n=3**）。
>   **⇒ 第 `:326` 条（"先跑小样本真实 provider；无凭据时写 `not_measured`、不伪造数字"）两半达成，已勾。**
> - **这次运行暴露的一处缺口（已修）**：面板当时**只渲染汇总**，"被拒的那一条为什么被拒"随窗口一起丢了 ——
>   而原因就在 `runs[].evidence` 里。已改成**逐条渲染**（题 id / 结局 / 理由原文，带截断上限并在截断时写明原长），
>   新判据先红后绿，并留了 RED 痕迹。
> - **复核（`Approved with minors`，0 Critical）之后本批修掉的**：
>   **I-2**（旧那条"唯一会花钱"的通道永不显示失败）—— 旧通道与题集通道**共用同一支 `failed` 状态**
>   （原来只有题集那套有；复核指出我"只修了新的"）。**两次变异**证明新判据会咬人（详情改固定串 ⇒ 红；catch 改回 `running` ⇒ 红）。
>   注意：**只做到"失败如实显示"，没有改它的输入语义**（那会改变旧评测在测什么）；
>   `M-1`（模型看到的文档与被编译的文档不是同一份：改成同一份）；`M-3`（交叉引用指错行）；
>   `M-4`（界面里的"21"改成单一常量 + 一条钉住它等于题集真实条数的用例）；
>   `M-5`（**金钱可见文案**："将发出 N 次"是假的精确 —— 传输类失败会重试，改成"至少 N 次"并写明上限，上限从 `modelPlanner` 同一处取）；
>   `M-6`（把保护归因给"类型"的说法改正为控制流 + 用例）；以及复核 §5 要求的**三处差异写进适配器注释**
>   （`signal` 永不可中止、`compilePlan` 未带两个 flag、`conversationId === runId`）。
> - **本步明确没做的**：旧通道的**请求形状**（会改旧评测语义 ⇒ 需要单独裁决）；
>   `:324` 的**人工可读性** —— 它的前置条件是"能把模型给出的计划 / 澄清正文呈现出来"，
>   而今天的报告只有计数与证据串，**没有可读的产物**（这次运行把这一点暴露出来了）。
> - **控制器自跑门禁（当次实测）**：typecheck 0；lint **0 error / 13 warning**；定向 13 文件 / 131 通过；
>   全库 **318 文件 / 3662 通过 + 1 todo**（较上一批 +3，正是本次新增的三条判据）；`bench:agent` exit 0 且三条读数**逐字不变**；
>   `test:e2e` **194 通过 / 0 失败**；BOM `mismatches=0`。
>
> **第八步（2026-10-05）：第二次真实运行 —— 逐条渲染上线后，它立刻给出了实质发现。**
> 用户又跑了同样的 3 题（授权规模内），这次面板**逐条**打出来了（证明上一批那处修改在生产路径上真的生效）：
> `underdetermined-pyramid-base` **planned**（诊断 0 条、动作 1 条、草稿已产出）；`unsupported-expression` **planned**（诊断 1 条、动作 1 条、草稿已产出）；
> `contradictory-two-lengths` **rejected，而原因是"模型给的是澄清、不是计划"** —— 它问的是
> 「线段 AB 的长度不能同时等于 3 和 5（同一线段只有一个长度），请二选一：你希望 AB = 3 还是 AB = 5？」。
> 两次运行的汇总一样（`planned 2/3`），延迟 **13445 ms → 8465 ms**（n=3，延迟读数本身很粗）。
> **⇒ 这一格读数今天会把人带偏，必须说清**：`rejected` 里**混着两种相反的东西** —— ①模型**自己发现矛盾、于是提问**
> （这次就是这种；它与本产品自己的可证矛盾检测是同一个判断，属于**好**行为）、②编译器拒了计划 / 模型没给计划（失败）。
> 合成一个计数会把"模型做对了"读成"模型失败了"。
> **处置建议（尚未实施，需裁决）**：让 `planning` 层能把"模型只给了澄清"**独立成一支**
>（跨层词表里本来就有 `clarification`，见证层在用），或至少在计数行下**按子类拆开**；
> **但必须由结构化字段驱动 —— 不许解析中文证据串**（那是第二份判断，正是本计划一直在防的东西）。
>
> **第九步（2026-10-05）：把「澄清」独立成一支 —— 用户批准"按推荐做"。**
> - **契约**：`BENCHMARK_STATUSES_BY_LAYER.planning` 由 `["planned","rejected","not_measured","error"]`
>   变成 `["planned","clarification","rejected","not_measured","error"]`；`report.ts` 的 `planning` 词表说明
>   从"四个词"改成"五个词"，并把**为什么"在问"必须与"被拒"分开**写在那里（方向读反那条）。
>   **fail-closed 一个字没改**：澄清**不是** `planned`。
> - **应用侧**：结局判定从两支变三支（信封 `kind === "clarification"` ⇒ `clarification`，带**问题原文**）；
>   `rejected` 只留"编译器拒了 / 只读回答 / 什么都没给"；汇总多一行 `clarification N/M`。
> - **RED 证据**：改之前那条用例红成 `expected ['rejected','rejected','rejected'] to deeply equal ['clarification',…]`；
>   **契约哨兵按设计也先红了一次**（`expected ['planned','clarification',…] to deeply equal ['planned','rejected',…]`）——
>   它当初就是精确相等钉死的，这正是它该有的形状。
> - **变异**：把汇总行的标签从 `clarification` 改成 `clarify`（逐条行里仍是 `clarification`）⇒ 新判据**红**，
>   证明它钉的是**汇总行本身**。同时自查并修掉了一条弱断言：原来是 `toContain("clarification")`，
>   而逐条行本来就含这个词 ⇒ 删掉汇总行它也照样绿（不可能红的断言）；改成 `/^clarification\s+3\/3$/m`。
> - **本步没做的**：`:324` 的人工可读性（前置仍是"能把计划/澄清正文呈现出来"）；旧那条 24 次通道的**真修**（下一步）。

> **第十步（2026-10-05）：把"请求长什么样"收成一处 —— 让旧那条钱按钮真的能跑。** 提交 `90eba6e`。
> 这一步修的是**一条从来没有真正工作过的通道**（缺陷由复核员用探针独立复现、控制器读代码确认）：
> 旧「agent 工具环」通道把请求写成 `plan({ userMessage } as never)` —— 对本地确定性规划器成立，
> 对**真实** `createModelPlanner` **不成立**：它在**发出任何网络请求之前**就读 `request.model.context`
>（`modelPlanner.ts:369`）⇒ `TypeError: Cannot read properties of undefined (reading 'context')`。
> 后果不只是"报错"：那条通道是应用里**唯一会花钱**的入口，而它从来没有真正发出过一次请求
>（历史上连失败都不显示、面板永远停在"正在跑…" —— 那是第七步修的）。
> - **一处定义**：新增 `packages/agent-core/src/coordinatorPorts.ts` 的 **`buildPlanRequest`**
>   （+ `PlanRequestInputs` / `PlanObservationSource`），就放在 `PlanRequest` 端口旁边 ——
>   因为 `PlanRequest.model` 的既有注释已经把"模型能看到什么"判给协调器。它调的**就是**协调器原来那三个函数、
>   **同样的顺序**：`buildContext` → 计费回调 → `buildConversationContext` → `createToolRegistry().forModelPhase("planning", …)`。
> - **三处收敛**：① **协调器自己**改用这个函数（机械替换；账本、预算 token 折算、`repair`/`executeTool`、
>   `readToolsAvailable` 都留在 `coordinator.ts`）；② **旧 8 题通道**（本步修的）；③ **题集 planning 通道**
>   （它原先手写的约 60 行组装被完整取代）。`availableActionsFor`（技能清单 → 可用动作）也从两份收成一份。
> - **协调器语义等价的逐项核验**（控制器做，不是采信自述）：`buildPlanRequest` 内部顺序**逐字同旧**；
>   计费时机仍在 `buildContext` 之后、会话上下文之前；`budget_context` 那条 `stop` 路径用私有 `BudgetStop`
>   标记原样还原（不把"组装真抛了"与"预算被拒"混掉）；`repair`/`executeTool` 仍由协调器**按次**补；
>   `availableActions`/`selectedRefs`/`requestedSkillIds` 缺省与改前一致；**宿主的会话来源改成 thunk**
>   （`conversation?: () => ConversationContextSource | undefined`），由 `buildPlanRequest` 在**计费之后**才调用。
> - **一处控制器早读发现的真回归（已修 + 已钉）**：抽出请求构造时，`dependencies.conversation?.()` 被从
>   "计费之后"挪到了"计费之前" ⇒ **预算耗尽的那一轮会多读一次宿主的会话来源**（旧代码在那条路径上根本不碰它）。
>   改法是 thunk（**类型强制惰性**，不靠注释），并加了一条**能红**的用例
>   （"预算耗尽时 `conversation` thunk 的调用次数是 0"）。**实施者如实申报：加 thunk 之前那条用例确实红**
>   （`expected 1 to be +0`）—— 也就是说这不是理论问题，是**真被引入过的回归**。
> - **旧通道语义一个字未改**：8 条夹具 / `TRIALS` / `scoreAgentAttempts` / 先解析 provider / 无凭据 `not_measured`。
> - **控制器自跑门禁（当次实测）**：typecheck 0；lint **0 error / 13 warning**；定向 16 文件 / 217 通过；
>   全库 **319 文件 / 3665 通过 + 1 todo**（较上批 +1 文件 +3 用例 —— 正是本步新增的 2 条 + 协调器 1 条）；
>   **`bench:agent` 三条读数逐字不变**；**`eval:agent` 四个数与旧读数逐字相同**
>   （`pass@1 4/8` / `pass@3 4/8` / `tool selection 45/45` / `tool error rate 3/45`）；
>   `test:e2e` **194 通过**；BOM `mismatches=0`。
>   **`eval:agent` 这条门禁是控制器中途补的**：本步改了离线那条路径的请求内容，而它是 §一 的在版读数 ——
>   简报最初漏列了这条命令；结论是"没变"，且理由由实施者自己核过（本地规划器只解构 `userMessage`；
>   判分走 `compilePlan` + `evaluateAgentTask`，与请求里的技能/动作菜单无关）。
> - **裁决：旧通道固定 `geometry3d` 不改**（实施者按"不许改旧通道语义"停手并上报）。控制器查证：
>   `agentTaskFixtures.ts` 的 **8 条夹具没有任何 `workspace` 字段** ⇒ 硬编码 `geometry3d` 与夹具一致，
>   是该通道从第一天起的口径。**今天不是缺陷，是潜在约束**（将来若加 CAD 夹具，通道必须读它）。
> - **用户需要知道的影响**：修好之后那条 **24 次请求**的按钮**真的会花钱**（8×3；题集通道另 3 次）；
>   两段式确认仍在。**实施者与控制器都没有跑它**；"真实 provider 上能不能跑成"**仍未被证明** ——
>   已证明的只是"请求与生产路径同构 + 真规划器能走完 24 次（假 transport、零网络）"。

> **第十一步（2026-10-05）：人工可读性 —— 先把"要读的东西"呈现出来，并把口径写死。** 提交 `dbe6fb1`。
> 这一步做的是第 `:324` 条的**前半**（字段 + 呈现 + 口径），**故意不勾那一格**（后半是"有人真的去标注"，今天为 **0**）。
> - **为什么先做呈现**：两次真实运行暴露了前置条件 —— 报告里只有**计数**与**证据串**，没有"模型给的那段东西"，
>   于是任何"可读性"标注都是**凭印象**。现在 harness 从**内存里的信封**（`planner.plan(...)` 的返回值）取正文
>   （计划的 `goal` + 动作摘要 / 澄清的问题 / 只读回答正文），与 `runs` **一一配对**，面板新增**只读**「人读区」
>   （逐条 `article`、有界 480、**截断时如实写原长**）。**不解析证据串、不重新解析题集、不塞进 `evidence`。**
> - **口径写在契约里**（不是散在渲染里）：三值 `readable` / `partly` / `unreadable`，判断者是"**不懂实现的人**"；
>   **`not_measured` / `error` 不进分母**（没有对象可读）；**`plan` 与 `clarification` 各有各的分母**
>   （"问法清不清楚" ≠ "计划好不好"）；**`readableRate` 的分母是"已标注"条数 ⇒ 0 标注时是 `null` 而不是 `0`**。
> - **一处我没想到、它钉住了的陷阱**：**见证层也有一个同名的 `clarification`** —— 而只有 `planning` 层有"要读的那段东西"，
>   所以见证层的那个**不进**可读性分母（有用例断言）。
> - **契约字段的口径（含糊措辞由实施者落定）**：`humanReadability` **键必须在、值可 `null`**（追加进 `BENCHMARK_RUN_REQUIRED_FIELDS`，
>  与 `cost` / `latency` 同一条纪律）；**词表外的值**（`"good"` / `""` / `true`）一律**拒收**，不许被静默当成未标注。
> - **"未标注"与"0 分"必须可分辨**（本任务的要害）：4 处叠加 —— ① rate 分母是已标注条数；② 报告始终给"已标 N / 未标 M"；
>  ③ 面板渲染"**未标注（分母 = 已标 0，不是 0 分）**"；④ 一条 `not.toMatch(/readable 比率\s+0(\.0+)?\b/)` 的机器判据。
>  **本批真实状态：已标注 = 0，报告里出现的是"未标注"，没有 0、没有占位比率，也没有顺手标一条。**
> - **控制器自跑门禁（当次实测）**：typecheck 0；lint **0 error / 13 warning**；定向 15 文件 / 149 通过；
>   全库 **320 文件 / 3681 通过 + 1 todo**（较上批 +1 文件 +15 用例，逐项对账：契约 11 + harness 3 + 面板 1）；
>   **`bench:agent` 三条读数逐字不变**；**`eval:agent` 四个数逐字不变**；`test:e2e` **194 通过**；BOM `mismatches=0`。
> - **实施者的三条变异都咬人**（正文换占位 ⇒ 3 红；无对象进分母 ⇒ 2 红；缺省 `readable` ⇒ **5 红**），
>   还原证据是 `git diff` 空 + blob 哈希两侧相同。**它如实申报**：RED 首跑 **10 红 / 1 绿**，那条绿的是**钉子**、没算成 RED。
> - **控制器裁决的两条（实施者上报、我没让它顺手改）**：
>   ① **既有**：`clarification` 的 `evidence`（N4b）里已经引用了问题原文，与本批"正文不进 evidence"**表面**冲突 ——
>    **不是冲突**：`evidence` 回答的是"**凭什么这么说**"（对澄清这一支，理由**就是**那段问题原文），
>    人读区回答的是"**要读的是哪段东西**"。二者在**这一支**上恰好重合，是**性质使然**，不改。
>   ② **口径边界（记为已知边界）**：`rejected` 组的分母含"**模型什么都没给**"那一种 —— 那时其实**没有正文可读**，
>    而界面仍给三个按钮。收窄需要在契约里记下"有没有正文"（本批没做）。**代价（若错）**：将来标注时可能给
>    "什么都没有"打一个可读性分（那是给**我们的占位文本**打分，不是给模型的输出打分）。
>    **本批按简报口径（只排除 `not_measured` / `error`）执行是对的** —— 改它是下一批的事。
>
> **第十一步的两轮复核修正（2026-10-05/06）**：N4e 交付后复核给出 `Changes requested`（**1 Critical + 1 Important + 8 Minor**），
> 两轮修完，**判题逻辑一个字未改**：
> - **第一轮 `c68998e`（C1 + I1 + m1–m8）**：**C1（Critical）** 是 `readableBody` 把仓里明确标注为"**不可信**"的信封
>   当可信结构读 —— 信封来自 `modelPlanner` 的三个出口（工具通道解析失败 ⇒ 原样交出 `toolCall.input`；文本通道 ⇒ 交出**原始字符串**），
>   于是坏形状会让 `try` 内抛、`catch` 里**再抛一次**、**整批 reject、0 条读数**（钱已花掉的那几次请求的诊断全丢）。
>   修法两条：**全函数防御**（认不出的形状一律 `""`，不抛）+ **正文在 `try` 内算一次、`catch` 复用**
>   （副产品：信封不再活得比 `try` 长 ⇒ "在 catch 里重算"**在类型层面已不可表达**）。
>   **I1**：兜底那句 `只读回答：${undefined}` 删掉 —— 面板会把它当"模型给的那段东西"摆出来，旁边就是三个标注按钮，**人会拿它去打分**。
>   8 条 Minor 一并处置（含把 `humanReadability` 的"键必须在"换成**真类型级判据**、`BENCHMARK_RUN_REQUIRED_FIELDS` 逐项相等哨兵）。
> - **第二轮 `99cf2d8`（复核的第二轮要求：补"宣称了没钉的保护"）**：复核员把 `clarification` 支路与 `actionId` 两道防御**删掉**，
>   发现**该文件 19 条既有用例一条都不红** ⇒ 判 `Changes requested`。本轮补上：
>   **坏澄清必须仍记 `rejected`（不是 `error`）、坏 `actionId` 不许渲染出 `1. undefined`**、恒真的 `evidence.length > 0`
>   换成**内容**断言（复核员指出的原话：它由报告契约保证，**不能独立变红**）。
>   **控制器自己也做了一次变异**（删 `questions` 闸）⇒ 红成 `['error','error','error']` vs `['rejected',…]`，随后**逐字节还原**（blob `493d0b89…` == HEAD）。
> - **上面那条"口径边界②"被第二轮以另一种方式落定**：**上面 614–616 行说"界面仍给三个按钮"已不再成立** ——
>   现在"给不给按钮"交给**同一个谓词** `hasReadableBody`，没有正文的那一支显示
>   「没有可判的对象，所以不提供标注；它仍然算在这一组的分母里」。
>   **分母口径一个字没动**（`rejected` 组仍含"什么都没给"），所以那一类会**一直显示"未标注"** —— 控制器裁决：**这是诚实的**
>   （没有对象可判就不该让人对着空气打分），而不是把分母收窄（收窄需要契约里多记一个"有没有正文"，属于另一次裁决）。

## Phase N5：形式证明出口

**目标：** 让少量短目标产生可独立校验的 proof artifact，不把采样或实例通过冒充证明。

**Files:**
- Create: `packages/agent-core/src/proof/` artifact schema、verifier、adapter tests。
- Create: `scripts/proof-spike/` feasibility runner。
- Modify: `apps/web/src/components/agent/ConfirmationPanel.tsx`、`agentStore.ts`、run event schema。
- Docs: proof support matrix and release gate.

- [x] **RED：** verified_instance/sampled 不能生成 formally_proved；伪造/缺字段/版本不匹配 artifact 拒绝。
  > **2026-10-05 勾上**：`packages/agent-core/src/proof/proofArtifact.test.ts` 逐条钉住 —— "没有产物时证据状态**原样不动**，`verified_instance` 与 `sampled` 都升不上去"、后端自报没证成时状态同样不动、缺字段要拒并**点名缺了哪个**、版本不匹配要拒（不做兼容猜测）、伪造的结局词要拒、声称 `verified` 却拿不出正文或说不清后端要拒、"证明的是**别的 claim** / **别的输入**"要拒、表外目标绝不升级、以及**生产默认一个后端都没接 ⇒ 谁也不许升到 `formally_proved`**。

**Interfaces:** `ProofArtifact` 必须绑定输入哈希、后端/版本、claim id、证明正文和校验结果；`verifyProofArtifact()` 只返回 `verified/failed/unsupported/timeout`。
- [x] **RED 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/proof --maxWorkers=1`。
- [x] **Proof spike：** 创建 scripts/proof-spike/ 的 adapter smoke runner；先输出后端版本/许可证/进程模型/WASM 或原生依赖/启动耗时/超时状态，未通过依赖审查时只允许 unsupported。
  > **2026-10-05 勾上**：`scripts/proof-spike/runner.mjs` + `smoke.test.ts` + `npm run proof:smoke`。用例逐条钉住：前提是"这个构建里**没有任何后端接上**"、首批每个能表达的目标都升不上去且原因正是 `backend-not-wired`、**反方向**（注入一个假后端后同一份产物能升上去，证明这道路不是死的）、表外目标连门都进不去（`undeclared-goal`）、`sampled` 也一样升不上去、以及"**先输出后端审查状态**"。
- [x] 先支持 5–10 个短目标：共线/共面、平行/垂直、等长、勾股；后端可选 Lean/mathlib 或 AlphaGeometry/Newclid 风格 adapter。
  > **2026-10-05 勾上（词表这一半），但要看清没接后端**：`proofGoals.ts` 的短目标**封闭词表 9 种**（`parallel` / `perpendicular` / `planePerpendicular` / `equalLength` / `midpoint` / `segmentRatio` / `collinear` / `coplanar` / `pythagorean`），落在计划要求的 5–10 区间内；词表与矩阵**同一份键集合**有用例挡着，不在首批的目标（二面角）即使能表达也不放行。**勾股按用户裁决走"判成 ⊥ + 勾股定理那一步"的推断路线**（`inference` 字段 + `proofGoalDischargeRoute()`），**没有做成别名**（"从约束层问垂直只会得到垂直"有专门用例）。适配器那一半**只到准入契约**：`WIRED_PROOF_BACKENDS` 由通过的审查记录推导，今天 `{"wired":[],"reviewed":0}` ⇒ **一个后端都没接、没有任何产物能升到 `formally_proved`**。
- [x] **依赖审查任务（必须在 GREEN 前完成）：** 记录许可证、进程/线程边界、WASM/原生依赖、缓存/沙箱、启动时间和失败/超时行为；没有审查结论不得接入默认构建。
  > **2026-10-05 勾上**：`packages/agent-core/src/proof/proofBackendReview.ts` 的**十栏准入契约**（含进程模型词表、原生/WASM 依赖必须写**空数组**而不是省掉、启动耗时必须是有限非负数），加一条**接入不变量**："`WIRED_PROOF_BACKENDS` 里每个名字都必须有一份 `passed` 记录" —— 于是"没审查就接上"**在结构上做不到**。依赖侧的实测记录另见 `docs/acceptance/next-phase-flag-and-dependency-review.md`。
- [x] **提交检查点：** `git commit -m "feat(proof): add verified proof artifact boundary"`。
  > **2026-10-06 勾上（阶段出口达成）。** 上面那两条此前缺的东西都到位了：
  > **① 一个过了十栏准入的真实后端**（`lean4`，`PROOF_BACKEND_REVIEWS` 里那份 `verdict: passed` 的记录，十栏逐项实测）；
  > **② 至少一类目标有可独立校验的 proof artifact** —— `perpendicular` 的一般命题走完整条路后升到 `formally_proved`
  > 且公理只有 `{propext, Classical.choice, Quot.sound}`，而**同一命题换 `sorry` 则停在 `verified_instance`**。
  > **提交信息没用过那条建议的**：实际落地是两个提交 `e401d9e`（准入选名单）与 `051e5fe`（适配器+闭环）——
  > 与 `:347` 同一个口径：**这条检查项的本质是"阶段收尾"，不是"提交信息必须长这样"**。
  > **勾的是出口，不是"这一档没有缺口"**：仍未达成的六条如实记在下面**第七步 §三**（只覆盖一个目标类、翻译未被证明、
  > `statement` 可选、"必传"强度有限、强沙箱未测、mathlib rev 未被 pin）。**读者不要把这一勾读成"形式证明出口已经完备"。**
  > **2026-10-05：故意不勾** —— 本阶段收尾的检查点，而**出口未达成**（设计 §5 N5 要求"至少一类目标有可独立验证的 proof artifact"，今天没有任何后端接上，真实运行只会得到 `unsupported`）。本阶段工作已以多次提交落地（`f550972` 产物边界 / `79473ee` 短目标词表 / `2c13158` 后端接线门 + `proof:smoke` / `be22ced` 准入契约 / `6a5c2f0` 勾股按裁决落地），但**没有使用这条建议的提交信息**。
> **第二步（2026-10-05）：短目标词表。** 新增 `packages/agent-core/src/proof/proofGoals.ts` ——
> 10 种短目标的**封闭词表**与支持矩阵，映射按**题设种类**走（不做文本关键词匹配，本项目在
> 关键词表上吃过亏）。`ProofExpectation` 新增**必填**的 `goalKind`；为 `null` 时无论产物多合法
> 都**不升级**（新码 `undeclared-goal`），这就是"表外目标绝不变成 `formally_proved`"的落点。
>
> **本批查实的一条事实（需要裁决，不是实现细节）**：计划首批点名的"共线 / 共面 / 勾股"
> **在解析层表达不出来** —— `DiagramObligationKind` 里没有这三种。所以矩阵如实标注它们为
> "首批里、但现在表达不出来"，并单列成 `unexpressibleFirstBatchGoals()`。
> **要么先扩解析层，要么从首批里划掉。** 已记进 `docs/current-status.md` §四 F。
>
> **本阶段仍未做的（剩下的全部）**：`scripts/proof-spike/` 与 `--mode=smoke`；**任何后端 adapter**
>（必须先过依赖/许可证/进程与线程边界审查）；把 proof artifact 接进 `ConfirmationPanel` /
> `agentStore` / run event schema；"一份证明该绑到多细的输入"仍未裁决。

> **第三步（2026-10-05）：后端接线门 + `--mode=smoke`。** 自查发现第一步漏了一环：
> `verifyProofArtifact` 原来只校验形状 / 版本 / 绑定，而**手工编的产物**可以把这些都满足
>（`backend.name` 写 `lean4`、正文放一段字符串、`status` 写 `verified`）。新增
> `WIRED_PROOF_BACKENDS`（**空的**）+ 新码 `backend-not-wired`：生产默认一个后端都没接，
> 所以**今天没有任何产物能升到 `formally_proved`**。同时交付计划点名的
> `scripts/proof-spike/`（`smoke.test.ts` + `runner.mjs` + `npm run proof:smoke`），
> 它验的是那条不变量 + **反方向**（注入假后端后必须能升上去）。
>
> **本阶段仍未做的（剩下的全部）**：**任何真实后端 adapter** —— 要把名字加进
> `WIRED_PROOF_BACKENDS`，**必须先过**依赖 / 许可证 / 进程与线程边界 / WASM 或原生依赖 /
> 启动耗时 / 超时行为的审查（做法见 `docs/acceptance/next-phase-flag-and-dependency-review.md`），
> **没有审查结论不许加**；把 proof artifact 接进 `ConfirmationPanel` / `agentStore` / run event
> schema 的只读展示；"一份证明该绑到多细的输入"仍未裁决；首批的"共线 / 共面 / 勾股"（2026-10-05 更正：**共线/共面在约束层有载体**，只剩**勾股**一处载体都没有…… ~~一处载体都没有~~ **（2026-10-05 再更正：没有**直接**载体，但有一个**等价近邻** —— 对三点 X/Y/Z，`XY ⊥ YZ` 与 `|XY|²+|YZ|²=|XZ|²` 等价（勾股定理及其逆定理），而 `perpendicular` 是 `ConstraintType` 的一员、内核既判又投影。所以这条**不是"缺能力"**，是取舍：要不要走"判成 ⊥ 目标 + 用勾股定理那一步接回来" —— 而**别名两者就等于把一条推断藏进分类函数**，推断应当出现在证明里、看得见）**）
> 表达不出来那条也仍未裁决（见上）。

> **第四步（2026-10-05）：后端准入契约。** 逐条核计划时发现：上面那两行要求"先输出版本 / 许可证 /
> 进程模型 / WASM 或原生依赖 / 启动耗时 / 超时状态"、并且"**没有审查结论不得接入默认构建**"，
> 而我的 smoke 只验了边界 —— **这份审查记录一栏都没有**。
> 新增 `packages/agent-core/src/proof/proofBackendReview.ts`：十栏审查记录 + `reviewProblems` +
> `isReviewPassed`。**关键结构改动**：`WIRED_PROOF_BACKENDS` 从**手写数组**改成**由通过的审查记录
> 推导**（`PROOF_BACKEND_REVIEWS.filter(isReviewPassed).map(name)`）—— 于是"没审查就接上"
> **在结构上做不到**。今天两份都是空数组：**"没有审查记录 ⇒ 没有接入 ⇒ 谁也升不到 `formally_proved`"
> 是同一件事的三种说法。** `proof:smoke` 现在打印 `PROOF_BACKENDS {"wired":[],"reviewed":0}`。
>
> **本阶段仍未做的**：接任何一个**真实后端**（现在有了一道明确的准入手续：交一份十栏填齐、
> 结论 `passed` 的记录），以及把 proof artifact 接进 `ConfirmationPanel` / `agentStore` / run event
> schema 的只读展示。

- [x] **N5 GREEN 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/proof --maxWorkers=1`; `node scripts/proof-spike/runner.mjs --mode=smoke`。
  > **2026-10-05 勾上（命令拼写有一处偏差，如实记）**：前半段 `vitest run packages/agent-core/src/proof` 就是那三份 proof 用例；后半段**实际跑的是 `npm run proof:smoke`**（= `node scripts/proof-spike/runner.mjs`）—— 这个脚本**没有 `--mode` 参数**，计划里那个 `--mode=smoke` 从来没存在过。读数：**7 通过 / 0 失败**，并打印 `PROOF_BACKENDS {"wired":[],"reviewed":0}` 与 `goalsWithoutAnyRoute: []`（见 `docs/current-status.md` §一）。

> **N5 执行记录（2026-10-05，只完成第一步）：** 上面几条检查项**一条都还没勾** ——
> 已交付的是**边界**：`packages/agent-core/src/proof/proofArtifact.ts` 的产物 schema、
> `verifyProofArtifact`、`evidenceStatusWithProof`、`proofInputHash`，加 **15 条**用例
> （一半是反例）。计划 RED 那句话现在**可执行**了：`verified_instance` / `sampled` 不能变成
> `formally_proved`；伪造 / 缺字段 / 版本不匹配 / **"证明了别的东西"**（`claimId` 或 `inputHash`
> 不匹配）一律拒绝。定向变异一条（改成无条件升级）→ 3 条红。
>
> **与计划原文的关系：** 计划把 `verifyProofArtifact()` 的签名写成"只返回
> `verified/failed/unsupported/timeout`"——**保持了四个结局**，但**加了必填的 `expectation`
> 参数**（`claimId` + `inputHash`）：只校验产物自身时，一份"证明了别的东西"的合格产物贴过来
> 是看不出来的。拒收**不新增第五种结局**，报 `failed` + 机器可读 `reasons`。
>
> **还没做的（本阶段剩下的全部）：** `scripts/proof-spike/` 与那条 `--mode=smoke` 命令；
> **任何后端 adapter**（Lean/mathlib 或 AlphaGeometry/Newclid 风格）—— 它必须**先过**
> 依赖/许可证/进程与线程边界审查（计划里那条硬要求），所以现在真实运行只会得到 `unsupported`；
> 5–10 个短目标（共线/共面、平行/垂直、等长、勾股）；`ConfirmationPanel` / `agentStore` /
> run event schema 的接线；"一份证明该绑到多细的输入"这条**未裁决**（`documentFingerprint` 是可选参数）。

> **第五步（2026-10-05）：输入绑定裁决落地 + 只读「证明级别」状态面。** 提交 `b01525e` / `2f69a74` / `8e0c011`
> （N5a；复核结论 `Approved with minors`，1 Important + 4 Minor，处置见下面"更正"一条）。这一节**先把上面三处已过期的说法改准** ——
> 它们写在"仍未做/未裁决"里，今天有两处已经不是事实了：
>
> 1. **「一份证明该绑到多细的输入」已经裁决**（R51 + R56）——上面 `:630`、`:643`、`:679` 三处说它"未裁决"**均已过期**。
>    裁决内容：**必绑** 题设原话 + 这条 claim 的原话 + 目标 + **系统替你定的假设**（`assumptions`）
>    + **被证明的那条命题原文**（`statement`）；**不绑**文档内容指纹（坐标 / 形状 / 标签）。
>    三条失效模式对应三个方向：不绑假设 ⇒ **过度声称**；不绑命题 ⇒ **假有效**；绑文档指纹 ⇒ **假过期**。
>    **`documentFingerprint` 这个可选参数已经不存在**（`ProofInput` 里根本没有这一栏）——
>    所以 `:679` 那句"（`documentFingerprint` 是可选参数）"**不只是过期，是引用了不存在的接口**。
>    规范化也定死了：假设**先排序**、**逐字去重**、`[]` ≡ 不传；而**字符串的空串 ≠ 没有**（`goal: ""` 与不传是两个哈希）——
>    第三与第四条**用的不是同一把尺子**，这一处不对称是**有意保留**并已写进注释与用例（复核 M1）。
> 2. **勾股那条取舍也已裁决**（`proofGoals.ts` 的 `inference`）：走"**先证 ⊥，再用勾股定理那一步把结论接回来**"，
>    **不是**把两者别名（别名＝把一条推断藏进分类函数里）。⇒ `:645` 那句"表达不出来那条也仍未裁决"**过期**；
>    今天 `firstBatchGoalsWithoutAnyRoute()` 是**空的**。
> 3. **只读展示那一半：部分达成、且有一半是"明确不做"**（`:629`、`:643`、`:657`、`:678` 都写着"仍未做"）：
>    - **做了**：「证明级别」只读状态面进 `ConfirmationPanel`（`proofLevelStatus.ts` + `ProofLevelNotice.tsx`），
>      文案由 `WIRED_PROOF_BACKENDS` / `PROOF_BACKEND_REVIEWS` **推导**（今天是"当前没有接入任何形式证明后端"
>      ＋后果"不可能升到 `formally_proved`、能给的只是一个实例的核验"）。
>    - **明确不做（不是漏了）**：**产物查看器** —— 全仓**零生产者**（`ProofArtifact` 在 `apps/`、`packages/` 里除自身与用例、
>      `scripts/proof-spike/` 外无引用），为一条永远跑不到的生产路径做查看器只能注入假数据测，那是弱证据。
>      等第一个后端过了十栏准入再做。
>    - **仍未做**：`agentStore` 通道、run event schema 的接线。
> 4. **这一节仍未勾的检查项**：`:616`（本阶段收尾检查点，等 N5b 的真实后端落地）、`:612` 已勾（见其注记）、
>    `:660` 已勾。
>
> **本阶段仍未做的（更正后的全部）**：**任何真实后端 adapter** —— 十栏准入手续已经就位（且有"没审查就接不上"的
> 结构保证），但**一份填齐的记录都还没有**；`proof:smoke` 仍打印 `PROOF_BACKENDS {"wired":[],"reviewed":0,"rows":[]}`。
> 计划首批 5–10 个短目标里，`perpendicular` 是下一批的落点（见 N5b 简报）。

> **第六步（2026-10-06）：N5a 的两轮复核修正 —— 把"宣称了没钉的保护"钉住。** 提交 `4e54479`（M1）/ `24a5866`（I1 + M2）；
> 窄复核结论 **`Approved`**（新发现 1 条 Minor），控制器一行修掉后收口。
>
> - **I1（Important）**：`proofLevelStatus.ts` 的注释宣称"**每一句都由 `facts` 推出，没有常量句**"，
>   而 ① `:75`（**今天就在渲染的活文案**）把「**十栏**」**写死**（不来自 `facts`，也不来自 `PROOF_BACKEND_REVIEW_FIELDS.length`）；
>   ② 另一分支里那份「题设原话 + claim 原话 + …」是 `ProofInput` 的**第二份手抄副本**。
>   修法：数字改成 **`PROOF_BACKEND_REVIEW_FIELDS.length` 推导**；清单改成「与这份输入的**全部绑定项**都吻合」**不逐项列举**
>   （理由：字段名是**标识符**，要印成人话还得再有一张"字段名→中文"表 —— **那张表就是同一份副本又抄了一遍**，
>   在用户可读文案这一侧"推导"**消不掉副本**，只是搬了个家）；**词**（`formally_proved` / `verified` / `passed`）
>   改用**类型常量**钉住 —— 改名 ⇒ `tsc` 红（复核实测 `error TS2820`），**但要说清它只挡"改名"、不挡"语义漂移"**
>   （新增一个"也算成功"的状态不会让它红），注释的措辞恰好只声称了它做得到的那件事。
> - **M1**：`goal: ""` 与"不传 goal"是两个哈希这处**已知不对称**写进注释（"列表的'没有'是空列表；字符串的'没有'与空串是两回事，**两把尺子并存是有意的**"）
>   并补一条钉子 —— **首跑即绿，如实记为钉子、不是 RED**。
> - **M2 / M5（可达性）**：用例改成只渲染**可达**组合。不变量是 `reviewedCount >= wired.length`
>   （`wired` 是从审查记录里**过滤**出来的 ⇒ "接上 1 个、交过审查记录 0 条"**生产里不存在**）。
>   窄复核抓到 **`proofLevel.test.tsx:106` 仍然注入不可达组合** ⇒ **控制器一行修掉**（`renderWired([...], 1)`），
>   于是那句"用例只渲染可达的组合"**在代码里成立**。**如实记一句**：`24a5866` 的提交信息写"两处注入补上"，
>   而当时**只改到 3/4 处** —— 那句话**说过头了**（错在提交信息，不在代码行为）。
> - **M4**：报告里**早已没有** `GATES_PLACEHOLDER`（复核读到的是更早那一版，它自己也注明只对那一版负责）。
> - **⚠️ 窄复核对"推导本身有没有判据"的实测 —— 它改变了我原本打算做的事**（我要求它用真实变异回答，不许机制推理）：
>   - **把推导写回字面量 `10` ⇒ 9 条全绿，一条都不红** —— 那个变异与实现**观察等价**；
>   - 但**真正的回归形态判得住**：契约加第 11 栏 + 文案冻结在 `10`（**且先把哨兵改成 `toBe(11)`**，取最不利情形）
>     ⇒ **只红"审查栏契约是几栏"那条**，报错 `expected '…交一份 10 栏填齐…' to contain '11 栏填齐'`。
>   - ⇒ **裁决：不给 `ProofLevelFacts` 加 `reviewFieldCount`。** 三条理由（复核给的我认可）：
>     ① 加字段只把判据从"**文案对不对**"换成"**实现有没有读变量**"；
>     ② 真正的危害路径已被上面那条哨兵挡住；
>     ③ 会背离 `ProofLevelFacts` 自己那句注释（"两个字段都来自包根导出，**没有第三个来源**"）。
>     这条与 R52 同源：**产物能靠结构保证的，就不靠"多一个成员"来保证**。
> - **一条过程事故（实施者自报，值得记）**：它用 `git checkout -- <file>` 还原变异，而**修复当时还没提交**
>   ⇒ **把自己的修复还原成了旧版**，三条读数全部作废；改成**逐字节备份 + 备份还原**（证据从"`git status` 干净"
>   改成 **blob 哈希 == 备份**）。
>   **教训**：工作树上有**未提交改动**时用 `git checkout --` 还原变异，会把"你的改动"和"你的变异"**一起抹掉** ——
>   那种情况下"`git status` 干净"**恰恰意味着还原过头了**。
>
> **⚠️ 归属更正（2026-10-06）：下面这一节记的是 `N4` 的第二轮复核修正（`c68998e` / `99cf2d8`），不是 N5 的"第六步"。**
> 控制器当时把它误挂在 N5 这一节下（锚点选错），内容一字未改，只补这一句归属说明 ——
> **N4 的复核意见（o1/o2）与 N5 的"第六步"是两件事**，读者不该在这里找 N5 的复核结论。
>
> **（N4e fix2 的）窄复核结论：`Approved`**（新发现 2 条 Minor 观察、无 Important/Critical；N1/N2/N3 它都**自己变异**验过咬在正确的地方，
> 并明确"N1 那条用例没有被别的断言顺带满足"）。两条 o 项**控制器直接处置**（都是小改动，不再开一轮）：
> - **o1（同屏字面相反）**：报告里那句「分母只算**有对象可读**的轮次」与面板新写的「**没有可判的对象**…**仍然算在这一组的分母里**」
>   在同一屏上**字面相反**。代码从头到尾只有一套口径（按 `status` 分组），矛盾**只在措辞**：
>   `rejected` 里"模型什么都没给"的那一类**确实没有正文**，但它**仍在分母里**（已裁决的边界）。
>   ⇒ 把报告那句改成**按结局定义**：「分母 = 本层结局为 `planned` / `clarification` / `rejected` 的轮次
>   （`not_measured` / `error` 不进；正文为空但结局是 `rejected` 的那些**仍算在分母里**）」，
>   并在函数注释里写明"为什么分母**不能**用'有没有正文'定义"。**教训**：一处口径在两个地方各写一句人话，就会长出两个版本。
> - **o2（新分支那句说明没被钉）**：复核指出用例找的「（这一条没有正文可读）」由 `<pre>` 满足 ⇒ **把那段 `<p>` 整段删掉照样绿**。
>   ⇒ 补两条断言（"没有可判的对象" + "仍然算在这一组的分母里"），并**自己变异证明它会咬人**：
>   把那段 `<p>` 缩回裸句子 ⇒ 该用例红在新断言（`ProviderEval.test.tsx:252/253`），随后**逐字节还原**（blob `05e04106…` == HEAD）。
> - **还带出一条不在本批范围的同类（如实记）**：`benchmarkPlanningEval.test.ts:217` 的 `evidence.length > 0` 是**同一恒真类**（N4b 遗留），本批没碰。

> **第七步（2026-10-06）：接上第一个真实后端 —— Lean 4 过十栏准入 + 一个目标类的真内核闭环。**
> 提交 `e401d9e`（十栏准入记录 + 把"接上的名单"钉死）、`051e5fe`（适配器 + 闭环 + **仓内** Lean 小工程 `proof/lean4/`）。
> **控制器范围核验**：两提交共 21 个路径，**`.lake` 命中 0 条**；`proof/lean4/.gitignore`（`/.lake`）**已进版本库** ⇒
> "6.3 GB 中间产物被误提交"的风险**从结构上关闭**（不再依赖"工作树里恰好有那个未跟踪文件"）。
>
> **一、十栏准入：接上了一个，而且是"由记录推导出来的"**
> 控制器自跑 `npm run proof:smoke` ⇒ **exit 0 / 8 passed**（此前 7），并打印
> `PROOF_BACKENDS {"wired":["lean4"],"reviewed":1,"rows":[… "verdict":"passed","problems":[]]}`；
> **"形状合格的伪造产物仍被拒"那批行一条没变**（仍 `backend-not-wired`）⇒ 反方向判据没被"接了一个后端"冲掉。
> 十栏逐项都是实测值（version **两条并列**：core-only `4.34.1` commit `5045d005…`／**mathlib 闭包实际用 `v4.35.0-rc3` commit `470d5ce1…`**；
> license 读自安装目录正文；`child-process`；**20 个**原生文件；**启动耗时两个实测数** —— 直调工具链 `bin/lean.exe` **138/134/125 ms**、
> 走 elan **垫片** **1657/1799/1865 ms**（适配器因此优先解析工具链自己的 `bin/`，预算取 2000 ms 只为让"垫片变慢"可被发现）；
> 两层超时；`cacheAndSandbox` 含 **"强沙箱（只读+无网）下未测"**）。**白名单是 `{propext, Classical.choice, Quot.sound}`，不是空列表**
> （空列表会把真证明也拒掉，是"静默全失败"的坑）。
> **"不许只看 exit code"落到了代码与注释两层**：适配器明确拒绝"grep 里没有 `sorry`"这种**文本级**判据（`axiom` 一绕就失效），改用 `#print axioms`。
>
> **二、一个目标类的闭环（`perpendicular`，一般命题）**
> 端到端用例**显式 gated**（CI 上没有 Lean/mathlib，而 `vitest.config.ts` 含 `scripts/**/*.test.ts`、CI 跑 `npm test` ⇒ 不 gate 必红）；
> 真跑 Lean 的三条 `it.skipIf`，并有"环境探针：**找不到就说找不到**（绝不静默通过）"；**判据层全部用假 stdout + 假 runner，在 CI 上永远跑**。
> 本地实测（控制器读它日志原文）：`Tests 4 passed`；`真证明 ⇒ formally_proved`、`axioms: ["propext","Classical.choice","Quot.sound"]`、**68277 ms**；
> **同命题换 `sorry`：`exit=0` 但 `judgement=failed`、状态停在 `verified_instance`** —— **同一退出码、相反结论**，只有 axioms 报告能把它们分开；
> `IMPORT-WIDTH narrow=68317 ms / import Mathlib=149532 ms`（两次都 `exit=0`）。**⇒ 两条判据同时为真，出口才有意义。**
> **成本口径（必须写清）**：记录注释里早先写的是"窄 ≈**52 s** / `import Mathlib` ≈**118 s**"（另一套测量条件），
> 而**仓内工程上两次端到端实测**是 **68.3 / 149.5 s** 与 **67.8 / 157.3 s**（都 `exit=0`）⇒ **以仓内实测为准**，并已在代码注释里对账。
> **一条真实的排障（说明"两条判据缺一不可"）**：第一轮端到端**红** —— 生成的证明体最后一步写成 `exact hu v hv`，而**签名里根本没有 `v`**
> （模板从另一份抽象文件抄了参数名）。**只保留"拒 `sorry`"那条判据的话，这个 bug 会被永远掩盖**（`sorry` 版无论命题怎么写都能"通过拒收"）。
> 控制器**独立复算**过正确形式（自己的探针工程、真内核）：`rw [Submodule.mem_orthogonal'] at hu; exact hu (D - B) hv` ⇒ 只依赖三个白名单公理；
> 适配器最终采用等价形式 `simpa [inner_eq_zero_symm] using hu (D - B) hv`。**适配器为何不自己扫标识符**：那要懂 Lean 保留字/mathlib 名字/语法糖，
> 等于在适配器里再实现半个解析器 —— 而**权威在内核**（写错就 `unknown identifier` ⇒ 判据层 `failed` ⇒ 不升级）；它另钉了**消息传播**，免得人读到误导说明。
>
> **三、这一批仍未达成 / 仍未测（不许含糊）**
> ① **只覆盖一个目标类**（`perpendicular`），一条真目标走通**不泛化**；
> ② **"翻译是可信的"这条边界**：IR → Lean 命题的映射**本身没有被证明**，是一份**可审计的小模板**（逐字段表在报告 §8.1）；
>    `assumptions` **有意不进命题**（方向保守：证不出来，而不是偷偷当公理用）；**模板第一天翻错了，R56 抓不到**（它抓的是"模板被改弱"）；
> ③ **`ProofInput.statement` 仍是可选**（`proofArtifact.ts` 未改）⇒ "必绑"今天的强度是"**传了就必须进哈希**"，一个忘传的适配器会静默退回绑定前的强度，
>    而这条**只被"我们的适配器记得传 + 一条用例"堵住，没被结构堵住**；
> ④ **强沙箱下的证明运行未测**；⑤ **成本对缓存与负载敏感**：常态 68 s，而进程级墙钟上限 300 s 只有 **4.4×** 余量
>    （第一次最终门禁里那条真证明就**超时**过一次 —— 同一棵树、无并发重活时复跑 **68386 ms** 通过 ⇒ 那是**环境抖动**，不是回归）。
>    **⚠️ 一条查实的规律（两条独立证据）**：那条真证明**"单独跑"时稳过**（三次成功读数：68277 / 68386 / 67800 ms 量级），
>    而**在并行的全库套件里跑时会撞上 300 s 墙钟**（两次：一次是它自己的最终门禁 `gates-final.log`；一次是控制器重跑
>    `vitest run --maxWorkers=2` 全库 ⇒ `Test Files 1 failed | 324 passed`、`Tests 1 failed | 3768 passed`，
>    红的正是那条 `进程级墙钟超时（300013 ms）`）。
>    ⇒ **不是代码回归**（单独跑三次都对），而是**"把一条约 6 分钟、GB 级 I/O 的集成用例放进单元测试套件里跑"**带来的
>    **负载相关抖动**：机器同时被 325 个测试文件占用时，mathlib 导入被拖慢数倍。
>    **建议的修法（本批未做、未实测，留给收尾）**：让真实端到端**只在显式单独调用时跑**（例如要求一个环境变量），
>    或给它一个**远大于 300 s** 的墙钟；**两条都要各自实测过才算数** —— 今天能下的结论只有一句：
>    **它不该在并行全库套件里指望 68 s。**
> ⑥ **`lakefile.toml` 的 mathlib 钉的是 `rev = "master"`**、`lake-manifest.json` **没有提交**（N5b 的理由：`lake` 每次运行会重新生成它，
>    而 `rev = "master"` 使它不构成稳定 pin）⇒ **十栏里那个 mathlib commit 是"实测值"，不是"仓库可复算的 pin"**。
>    **这是一条已知缺口**，修法是"`rev` 钉到 commit + 提交 lockfile"，**本批未做、也未实测**（不许写成"可复现"）。
>
> **四、本批顺带修掉的、由"接上后端"暴露出来的三处**
> ① **`eslint` 会去 lint `.lake/`**：`eslint` 不读 `.gitignore`，而 mathlib 的依赖包自带 JS
>    （`importGraph/html-template/vendor/*.min.js`、`proofwidgets/widget/js/*.js`）⇒ 建过 Lean 工程的机器上 `npm run lint`
>    从 `0 error / 13 warning` 变成 **14298 problems（14247 errors）**，而 **CI 上（无 `.lake`）仍是 0 error**（同一提交两处结论不同）。
>    已按该文件既有原则（"别人生成的产物不算我们的源码"）加 `"**/.lake/**"` 到 `ignores`，复验回到 **0 error / 13 warning**。
> ② **两条会在"接上后端"后变红的哨兵**（`apps/web/src/components/agent/proofLevel.test.tsx`）：一条 `expect(WIRED_PROOF_BACKENDS).toEqual([])`、
>    一条断言文案里**硬写**的 `10 栏填齐`。控制器改成**显式注入"接上 0 个"**来钉那一支的文案，并**删掉名单字面量**
>    （"名单恰好是什么"的精确钉子**只留 `scripts/proof-spike/smoke.test.ts` 一处** —— 与 `proofArtifact.test.ts` 上同一条裁决）。
> ③ **四处已过期的话**（`ConfirmationPanel.tsx` / `ProofLevelNotice.tsx` / `proofLevelStatus.ts`）："今天 `[]`／今天 `0`／**全仓零生产者**"。
>    最后那条**性质变了**：现在**确实有东西能产出 artifact**（适配器的显式调用路径），但**默认路径不调用它**、**也没有产物进界面的通道**
>    ⇒ "不做产物查看器"的理由从"没有生产者"改成这两条事实。

## Phase N6：发布与维护收口（flags 已在 N1 创建）

**目标：** 把前五阶段的能力安全地从实验变成可选择发布能力。

**Files:** `apps/web/src/agent/featureFlags.ts`、`packages/agent-core/src/capabilities.ts`、release gate、README、current-status、feature-catalog、CHANGELOG。

- [x] 五个独立 flag 已由 **N1** 创建（`apps/web/src/agent/featureFlags.ts`，默认关闭）——本阶段只做核对，不再重复创建。
- [x] 每个 flag 有单元、浏览器和回退用例；关闭 flag 时旧路径行为逐字不变。
  > **2026-10-05 控制器裁决：勾上，但逐格写明是哪一类**（因为这条的字面要求**已经不可能对每个 flag 都成立**，
  > 而"逐格写清"比"含糊地不勾"更诚实）。逐格（矩阵见 `docs/acceptance/next-phase-flag-and-dependency-review.md`）：
  > - **`constrainedDrag`**（唯一有产品入口的已实现开关）：**三类齐** —— 单元 ✅；浏览器 ✅（入口 3 条 + `agent-constrained-drag.spec.ts` **5 条**）；关闭回退 ✅（结构性 + 正/反例）。
  > - **`obligationIR` / `witnessSearch`**：单元 ✅、关闭回退 ✅（强度不同，见矩阵）；**浏览器格 = 【不适用】**，
  >   理由**不是"缺代码路径"**（实测：`agentRuntime.ts:271/283` 会把它们传进 `drafts.stage(...)`、`:369` 放进 `nextPhaseFlags`），
  >   而是"**浏览器里没有任何办法把它们打开**"（`nextPhasePreferences.loadConstrainedDragEnabled` **只认 `constrainedDrag` 这一个键**）。
  > - **`openProblemCompiler` / `proofExport`**：**零读取点占位**（非测试代码 0 命中）⇒ 三类都【不适用】。
  > - **"关闭时旧路径逐字不变"这句话本身要分三种证据读**（矩阵那节标题已写：结构性 / 黄金样本逐字节 / 单元）。
  > **代价（若错，写在这里以防将来误读）**：这一格现在勾着，但**"不适用"是当时的结论** ——
  > **哪天有人给 `obligationIR` / `witnessSearch` 加了产品入口，就必须同时补浏览器用例，并重审这一格**。
  > 那句话已经写进 `next-phase-flag-and-dependency-review.md` 的覆盖矩阵里（不然这一勾会变成"永远不用再管"）。
  > **2026-10-05：只达成一部分，故意不勾。** 逐格核对见 [`docs/acceptance/next-phase-flag-and-dependency-review.md`](../../acceptance/next-phase-flag-and-dependency-review.md) 的覆盖矩阵：**单元用例**三个已实现的开关都有；**关闭回退**也都有证据，但**强度不同**（`witnessSearch` = 黄金样本逐字节；`obligationIR` = 结构 + 单测；`constrainedDrag` = 结构性——离路径就是原来那一行）；**浏览器用例只有 `constrainedDrag` 有**（`e2e/next-phase-flag-entry.spec.ts` 入口 3 条 + `e2e/agent-constrained-drag.spec.ts` **5 条** = 正/反例 2 + **N3 出口的三条：过约束拒绝 / 冲突恢复 / 一步撤销**），`obligationIR` 与 `witnessSearch` **没有**（它们**没有产品入口**）；`openProblemCompiler` / `proofExport` 是**占位**（零读取点，不该为占位补用例）。**"逐字不变"这句话本身也要分开读**：它**不是一种证据，是三种**（矩阵里那节标题就写着这句）。
  > **2026-10-05 控制器更正（"没有产品入口"这句话不精确，实测见下）**：逐条查非测试代码里的读取点 ——
  > `obligationIR` / `witnessSearch` **在生产运行时代码里是被读取的**（`agentRuntime.ts:271/283` 把它们传进 `drafts.stage(...)`，`:369` 放进 `nextPhaseFlags`）；
  > 缺的**不是代码路径**，而是**用户可见的开关**：`nextPhasePreferences.loadConstrainedDragEnabled` **只认 `constrainedDrag` 这一个键**（`:49`）。
  > ⇒ 这两个开关的**浏览器用例"不适用"**，理由要写准：**"浏览器里没有任何办法打开它们"**；要补这条判据必须先给它们一个入口，
  > 而那是一次**产品决定**（把实验性 IR / 见证路径暴露给用户），**本计划没有要求**。
  > `openProblemCompiler` / `proofExport` 才是**零读取点**（非测试代码 0 命中）—— 那是真正的占位。
- [x] 更新所有进度文档和发布门禁；统一记录真实 provider、动态拖动和 proof artifact 证据。
  > **2026-10-06 勾上（三类证据现在都在，且都进了同一份"当前读数总表"）。** 逐条对账：
  > - **真实 provider**：`docs/current-status.md` §一 有三行（题集 planning 三次运行 / agent 工具环 pass@1 一次 / **人工可读性第一次标注**）
  >   —— 全部标明"**用户提供、控制器未旁观**"与边界（n=3 子集、空画布条件、**每组 n=1 不是趋势**）；发布门禁与记分卡同步改成两条轴。
  >   **仍然没有数字的只有 `cost`**（仓里没有价目表）。
  > - **动态拖动**：§一 新增一行 **`8 passed / exit 0`（2026-10-06 02:20 实测）**，并写明口径（**针对性**跑那两个 spec，不是全量 e2e）。
  > - **proof artifact**：§一 新增一行（`lean4` 十栏准入 + 一类目标的一般命题升到 `formally_proved`，同一命题换 `sorry` 停 `verified_instance`），
  >   并写明"**单独跑才是它的口径**"（放进并行全库套件会因负载撞 300 s 墙钟，两次实测）。
  > - **发布门禁**四处更正（N5 那一节"没有任何后端 / 不可达 / 7 通过"、`一句话结论`、`最终阶段门槛`）；
  >   `agent-tool-loop-scorecard.md` 的 Formal proof 行改写成"**接了一个后端、一类目标闭环**"并列出仍未达成的项。
  > - **如实留着的**：`cost` 无数字；三条轴都是小样本；形式证明只覆盖一类目标且**产品里没有入口/产物通道**。
  > **2026-10-05：文档那一半在做（且刚被独立审查修过 7 处漂移）；"真实 provider 证据"这一半**当天就变了**（见下）**。已更新：`current-status.md` / `feature-catalog.md` / 发布门禁 / 记分卡 / 本计划 / `CHANGELOG.md` / 新增的开关与依赖审查。**动态拖动**的证据在（浏览器正/反例 + 出口未完整，见 N3 那条）；**proof artifact** 的证据在（边界 + 准入契约，但没接后端）；**真实 provider 一次都没跑** ⇒ 没有任何 pass@1 / pass@3 / 成本 / 延迟 / 人工可读性数字。
  > **2026-10-05 控制器更正（"真实 provider 一次都没跑"当天就不成立了，而且这句话混了两条轴）**：
  > ① **题集 planning 轴已跑两次**（用户在桌面端跑的：`planned 2/3`；按现在的词表读作 **`clarification 1/3`** —— 那一条是**模型在问、不是失败**；
  > 延迟实测 13445 / 8465 ms；**n=3、空画布条件** ⇒ 不是"模型规划能力"，也不是 21 条的结论）；
  > ② **agent 工具环的 pass@1 轴**：**不是"没跑"，是"以前跑不了"** —— 请求形状对真实 `createModelPlanner` 不成立，
  > 在**发请求之前**就抛 `TypeError`（复核用探针复现：`runModelCalls=0`）；**已在 `90eba6e` 修好**（请求形状收成 `buildPlanRequest` 一处），
  > **修好之后仍没人跑过**；
  > ③ **成本**与上面都无关：**没有价目表** ⇒ 恒 `not measured`，不许编；
  > ④ **人工可读性**：字段与正文呈现 = 下一步（N4e）；**标注今天为 0**，报告里该出现"未标注"，**不许**拿 0 或占位比率凑。
  > 因此这一条**仍然不勾**，但"不勾的理由"已经换成上面四条里的 ②③④（而不是"完全没跑"）。
- [x] 运行：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build --workspace @draw/web`、`npm.cmd run test:e2e -- --workers=3`、`npm.cmd run test:rust`、`npm.cmd run test:perf`、`npm.cmd run eval:agent`。
  > **2026-10-05 勾上**：八道命令都有当次读数（见 `docs/current-status.md` §一 的「当前读数总表」）。**一处如实说明**：独立复核时 `npm.cmd test` 在本机跑出过 **1 条 5 秒超时**（`fileExports.test.ts` 的 CAD 导出用例，该文件未被本批改动、单跑 9/9 通过），属**负载敏感的既有抖动**，按本仓口径不把那次算绿也不算红。
  > **勾的是"读数存在"，不是"本阶段复跑过"（2026-10-05 控制器加，防误读）**：那八道命令的读数属于**更早那一批**；N6 自己的记录里明写"本阶段未复跑"（见本节末尾）。两句话可以并存，但**不要读成"N6 跑过这八道"**。将来真要收口时，应当**在收口那一刻重跑这八道**并用当次读数。
- [x] **提交检查点：** `git commit -m "docs(agent): close next-phase release gate"`。
  > **2026-10-06 勾上（整个计划收尾）**：它等的**那两个出口都达成了** —— N4（真实 provider 跑了三次 + 人工可读性第一次标注）
  > 与 N5（`lean4` 过十栏准入 + 一类目标的一般命题闭环），N3 更早已达成。**提交信息没用过那条建议的**（实际是
  > `5b92611` / `898d6aa` / `2876ecd` / `e401d9e` / `051e5fe` / `ba5d5a3` 这一串）—— 与 `:347` / `:660` 同一个口径：
  > **这条检查项的本质是"收尾"，不是"提交信息必须长这样"。**
  > **勾的是"计划要求的出口"，不是"产品已经完备"**：仍未达成的（成本无数字、三条轴都是小样本、
  > 形式证明只覆盖一类目标且产品里没有入口/产物通道、`statement` 仍可选、mathlib rev 未 pin、强沙箱未测）
  > **逐条写在 `:903` 的注记与第七步 §三**，读者不要把这一勾读成"下一阶段已经全部做完"。
  > **2026-10-05：故意不勾** —— 这是**整个计划收尾**的检查点，而 N4/N5 的出口都还没达成（**N4 缺一次真实 provider 运行**；N5 缺任何后端）。（**2026-10-05 更正**：这句原来还把"**N3 缺过约束拒绝·冲突恢复·一步撤销的浏览器用例**"列在里面 —— 那三条**已在 N3 出口收尾时交付**，见 `e2e/agent-constrained-drag.spec.ts` 的 5 条用例与提交 `d7fe702` / `2dd89ab`。）。N6 自己的十五步（flag/依赖/WASM 审查、门禁电池、两条抖动修复、并发专项、目录订正）已落地，但"收口"要等**那两个**出口（N4、N5；N3 已达成）。

> **N6 执行记录（2026-10-05，只完成第一步）：** 第 1 条（五个 flag 已由 N1 创建）本来就打了勾，
> 其余**一条还没勾**。这一批交付的是**核对记录**：
> `docs/acceptance/next-phase-flag-and-dependency-review.md` —— 五个开关的读取点 / 单元 /
> 浏览器 / 关闭回退逐格实测；JS 运行依赖逐包读 `license`（全宽松，无 copyleft）；
> 无任何 WASM 依赖；Rust 侧的**传递依赖**也已用 `cargo metadata` 扫过（551 个包 / 33 种表达式 /
> 无一缺 `license` 字段；无 GPL/AGPL/SSPL；5 个 crate 只给 MPL-2.0 —— 文件级 copyleft，本项目不改它们；
> 2 个 crate 把 LGPL 列为可选项之一，取 MIT/Apache 即可）。**仍不是法律意见**：
> 没有逐 crate 读 LICENSE 正文、没有 per-crate 的 SPDX 择一解析、没有复核 `bundled` SQLite。
>
> **与计划的偏差（有据）：** 计划把"每个 flag 有单元、浏览器和回退用例"当成一条，实测下来
> **回退用例齐、浏览器用例一个都没有**；而 `openProblemCompiler` / `proofExport` 是**占位**
> （零读取点），给它们补浏览器用例是没有意义的 —— 所以那两格记"不适用"，而不是补一堆空测试。
> 另外顺手查出两处依赖归位问题（`@vitejs/plugin-react` 在 `apps/web` 的 `dependencies`、
> 根 `package.json` 多余 `three`），**未修**（动依赖要单独一批验证）。
>
> **还没做的（本阶段剩下的全部）：** 第 2 条三个已实现开关的浏览器用例（`constrainedDrag` 还卡在
> "没有产品入口能打开它"）；第 3 条进度文档与发布门禁的统一回填（`agent-release-gate.md`、
> `agent-tool-loop-scorecard.md` 尚未按 N3/N4 的现状更新）；第 4 条那一整串门禁命令
> （`build` / `test:e2e` 全量 / `test:rust` / `test:perf` / `eval:agent`）本阶段未复跑。

## 计划自审与执行纪律

- 每个 Phase 开始前核对上游接口和当前调用点；不得只创建新目录而不接入 `planCompiler → draftStore → Worker → HostBridge`。
- 每个 RED 必须先失败在预期业务断言；环境错误不能算 RED。
- 每个 GREEN 结束后跑本阶段定向测试，再跑与旧功能相关的回归。
- `git diff --check`、提交文件清单和远端 SHA 必须在最后记录。
