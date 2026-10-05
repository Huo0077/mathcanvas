# 下一阶段 Agent 完整升级实施计划

> **状态：N1、N2 已实施并复核（2026-10-05）；N3–N6 尚未实施。** N1 提交 `acd3bd5` / `2d62c4d` / `b5b33f9` / `f997b3f`；N2 提交 `c2314c9`…`9c5ae2f`（逐条见各阶段执行记录）。本计划对应 `docs/superpowers/specs/2026-10-04-agent-full-next-phase-design.md`；每个阶段必须先写 RED，再实现 GREEN，再跑全量门禁，最后单独提交。

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
| Provider 评测 | `scripts/agent-benchmark/` | JSONL 题集、脱敏、真实/离线模式分离 |
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
export type ClaimEvidenceStatus = "not_run" | "sampled" | "formally_proved" | "failed" | "unknown" | "inconsistent" | "timeout"
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
- [ ] **RED 命令：** `npm.cmd exec -- vitest run packages/geometry-kernel/src/constraints.test.ts packages/geometry-kernel/src/constraints3d.test.ts packages/geometry-kernel/src/planar-constraints.test.ts packages/geometry-kernel/src/reactive/constraints.test.ts packages/scene-graph/src/operations.test.ts packages/scene-graph/src/patches.test.ts packages/scene-graph/src/scene-store.test.ts --maxWorkers=1`；`npm.cmd run test:e2e -- e2e/agent-constrained-drag.spec.ts --workers=1`
  > **前半段已跑（2026-10-05）：7 文件 / 241 通过 / 0 失败。** 前半段**不是**"跑过一次"就算完 ——
  > 它是第 33 轮才第一次按这个**集合**跑过的。
  > **后半段仍然不成立**：`e2e/agent-constrained-drag.spec.ts` **不存在**，因为**没有任何产品入口能打开
  > `constrainedDrag` 开关**（见 `docs/current-status.md` §一.2 第 1 条）。这一条**不能**勾。
- [ ] **GREEN：** pointer intent → 临时约束 → solve → commit transaction；禁止直接改 render state。
- [ ] **GREEN 命令：** 上述定向测试；再跑完整 `npm.cmd run test:e2e -- --workers=3`。
> **第五步（2026-10-05）：线状 `parallel` / `perpendicular` 的投影。** 计划 RED 里点名的"垂直"
> 这一半补上了：保持**第一条**线不动、把**第二条**绕中点摆过去（最小改动），长度与中点不变。
> 与 2D `projectLineConstraint` **同一口径**，所以不需要新的产品裁决 —— 此前把它记成
> "要先决定旋转哪一侧的点"，那个顾虑其实早就有先例可依。
> **三种如实跳过**：`pointDirection`（方向显式写死）、`perpendicular` 而两条线已平行（没有唯一答案）、
> 第二条线有端点被锚住。`no-projection-rule` 这一支**从此不可达**（保留给下一个新增种类）。
>
> **本阶段仍未达成的出口**：`constrainedDrag=true` 的**浏览器正/反例** —— 它卡在
> **没有任何产品入口能把开关打开**（见 §四 D 的裁决项）。**内核侧已经做完了**。

- [ ] **N3 出口：** `constrainedDrag=false` 时旧拖动路径逐字回归；`constrainedDrag=true` 时保持约束、过约束拒绝、冲突恢复和一步撤销的浏览器用例全部通过。
- [ ] **提交检查点：** `git commit -m "feat(geometry): preserve constraints during drag"`。

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

- [ ] **RED：** 缺 `provider/model/seed/status`、包含 secret、claim 缺 evidence、模式未标识时报告生成必须失败。

**Interfaces:** `BenchmarkCase` 读取 JSONL 题集；`BenchmarkRun` 必须含 `provider/model/seed/mode/status/evidence/cost/latency`；`BenchmarkReport` 分开输出 `deterministic_local` 和 `real_provider`。
- [ ] **RED 命令：** `npm.cmd exec -- vitest run scripts/agent-benchmark --maxWorkers=1`。
- [ ] 题集至少包含：欠定、矛盾、未支持表达式、点名打乱、二面角/比例、动态请求、普遍证明请求。
- [ ] 每题最多 3 轮，记录抽取率、求解率、题设覆盖率、verified/unverified/no_witness、成本、延迟和人工可读性。
- [ ] 先跑小样本真实 provider；无凭据时写 `not_measured`，不伪造数字。
- [ ] **提交检查点：** `git commit -m "feat(eval): add real provider benchmark schema"`。

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
> **仍然没解决的**：`real_provider` 仍整批 `not_measured`（**2026-10-05 更正：不是"适配器没写"** —— **生产侧的 provider 适配器早就有了**：`providers/adapter.rs`（621 行，含 SSRF 守卫），且**有一次真实往返记录**（2026-09-29，DeepSeek `deepseek-chat`）。**缺的是 benchmark 那一侧的 `real_provider` 模式**（今天只发 `not_measured`），以及"走回环代理还是自己发请求"与凭据位置这两个决定）
> 属独立一批）；报告里仍然没有 pass@1 / pass@3 / 成本 / 延迟 / 人工复核率（**但"求解率"第 48 轮有了**：离线见证层 `solveRate=0.048`；原来把它记成"缺一个定义"是错的）。

## Phase N5：形式证明出口

**目标：** 让少量短目标产生可独立校验的 proof artifact，不把采样或实例通过冒充证明。

**Files:**
- Create: `packages/agent-core/src/proof/` artifact schema、verifier、adapter tests。
- Create: `scripts/proof-spike/` feasibility runner。
- Modify: `apps/web/src/components/agent/ConfirmationPanel.tsx`、`agentStore.ts`、run event schema。
- Docs: proof support matrix and release gate.

- [ ] **RED：** verified_instance/sampled 不能生成 formally_proved；伪造/缺字段/版本不匹配 artifact 拒绝。

**Interfaces:** `ProofArtifact` 必须绑定输入哈希、后端/版本、claim id、证明正文和校验结果；`verifyProofArtifact()` 只返回 `verified/failed/unsupported/timeout`。
- [ ] **RED 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/proof --maxWorkers=1`。
- [ ] **Proof spike：** 创建 scripts/proof-spike/ 的 adapter smoke runner；先输出后端版本/许可证/进程模型/WASM 或原生依赖/启动耗时/超时状态，未通过依赖审查时只允许 unsupported。
- [ ] 先支持 5–10 个短目标：共线/共面、平行/垂直、等长、勾股；后端可选 Lean/mathlib 或 AlphaGeometry/Newclid 风格 adapter。
- [ ] **依赖审查任务（必须在 GREEN 前完成）：** 记录许可证、进程/线程边界、WASM/原生依赖、缓存/沙箱、启动时间和失败/超时行为；没有审查结论不得接入默认构建。
- [ ] **提交检查点：** `git commit -m "feat(proof): add verified proof artifact boundary"`。
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

- [ ] **N5 GREEN 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/proof --maxWorkers=1`; `node scripts/proof-spike/runner.mjs --mode=smoke`。

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

## Phase N6：发布与维护收口（flags 已在 N1 创建）

**目标：** 把前五阶段的能力安全地从实验变成可选择发布能力。

**Files:** `apps/web/src/agent/featureFlags.ts`、`packages/agent-core/src/capabilities.ts`、release gate、README、current-status、feature-catalog、CHANGELOG。

- [x] 五个独立 flag 已由 **N1** 创建（`apps/web/src/agent/featureFlags.ts`，默认关闭）——本阶段只做核对，不再重复创建。
- [ ] 每个 flag 有单元、浏览器和回退用例；关闭 flag 时旧路径行为逐字不变。
- [ ] 更新所有进度文档和发布门禁；统一记录真实 provider、动态拖动和 proof artifact 证据。
- [ ] 运行：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build --workspace @draw/web`、`npm.cmd run test:e2e -- --workers=3`、`npm.cmd run test:rust`、`npm.cmd run test:perf`、`npm.cmd run eval:agent`。
- [ ] **提交检查点：** `git commit -m "docs(agent): close next-phase release gate"`。

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
