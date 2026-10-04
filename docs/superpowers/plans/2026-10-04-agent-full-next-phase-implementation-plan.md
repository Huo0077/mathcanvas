# 下一阶段 Agent 完整升级实施计划

> **状态（复核）：设计已批准、尚未实施。** 本计划对应 `docs/superpowers/specs/2026-10-04-agent-full-next-phase-design.md`；每个阶段必须先写 RED，再实现 GREEN，再跑全量门禁，最后单独提交。

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

## 文件职责总表

| 责任 | 文件/目录 | 说明 |
| --- | --- | --- |
| 题设来源与 claim | `packages/agent-core/src/obligationIR.ts` | 新增唯一 IR；兼容现有 `diagramObligations.ts` |
| 几何约束 | `packages/agent-core/src/constraintIR.ts` | 统一现有 `PlanRelation` 与 3D constraints |
| 证据状态 | `packages/agent-core/src/claimEvidence.ts` | `verified_instance/sampled/formally_proved` 与 solver 状态 |
| 解析构造与候选搜索 | `packages/agent-core/src/solver/witnessSearch.ts` | 搜索编排、预算、seed、排序；不复制残差 |
| 纯几何构造/残差 | `packages/geometry-kernel/src/witness/` | 解析构造、数值残差、退化和尺度处理 |
| 编译接入 | `packages/agent-core/src/planCompiler.ts` | 现有调用点：约 299–301 的编译候选与约 358–360 的报告路径 |
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
- Create: `packages/agent-core/src/obligationIR.ts`, `constraintIR.ts`, `claimEvidence.ts` 及测试。
- Modify: `packages/agent-core/src/contracts.ts`, `index.ts`, `diagramObligations.ts`, `diagramVerification.ts`, `relations.ts`。
- Modify call sites: `packages/agent-core/src/planCompiler.ts:299-301`、验证结果回传处、`apps/web/src/agent/draftStore.ts:358-360`、`apps/web/src/agent/workerContracts.ts`、`geometryCompileStrategy.ts`。
- Test: `packages/agent-core/src/obligationIR.test.ts`、Worker 等价测试、现有 diagram/relations tests。

**Interfaces:**

```ts
export type ClaimRole = "given" | "construction" | "goal" | "free_choice"
export type Judgeability = "supported" | "unsupported" | "ambiguous"
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
  status: "verified_instance" | "sampled" | "formally_proved" | "failed" | "unknown"
  solver: SolverStatus
  residuals: Record<string, number | null>
  degreesOfFreedom: number | null
  nextActions: string[]
}
```

- [ ] **RED：** 用当前三棱锥题面断言 `given/goal/free_choice`、来源区间、支持/未支持和旧字段兼容；断言 `PlanCompiler → DraftStore → Worker` 不丢 IR。
- [ ] **RED 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/obligationIR.test.ts --maxWorkers=1`；预期因文件/接口不存在失败。
- [ ] **GREEN：** 实现 IR 和兼容适配，不让模型自报 relations 取代原话清单。
- [ ] **GREEN 命令：** 同上；再跑 `npm.cmd exec -- vitest run packages/agent-core/src/diagram*.test.ts packages/agent-core/src/relations.test.ts --maxWorkers=1`。
- [ ] 增加 `reportFreeDegrees(document, constraints)`，返回对象自由度、约束残差、冲突集合和未支持集合。
- [ ] **提交检查点：** `git commit -m "feat(agent-core): unify geometry obligation evidence"`。

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

- [ ] **RED：** 同一 seed 结果稳定；极大长宽比候选不优先；退化/矛盾/超时分别分类；已有 `selectWitness` 行为通过兼容测试。
- [ ] **RED 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/solver/witnessSearch.test.ts packages/agent-core/src/underdetermined.test.ts --maxWorkers=1`。
- [ ] **GREEN：** 解析构造优先，有限网格兜底；每个候选依次通过拓扑构造和统一 verifier；没有候选不产生草稿。
- [ ] **GREEN 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/solver/witnessSearch.test.ts packages/agent-core/src/diagramPipeline.test.ts --maxWorkers=1`。
- [ ] **Feasibility spike：** 在独立脚本中评估 Z3/NLSAT/WASM/原生依赖，不接默认 UI；记录许可证、线程模型、包体、启动时间和超时行为。
- [ ] **提交检查点：** `git commit -m "feat(agent): add bounded witness search"`。

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

- [ ] **RED：** 拖动保持中点/垂直/固定距离；过约束拒绝；欠约束显示自由度；拖动一步撤销。
- [ ] **RED 命令：** `npm.cmd exec -- vitest run packages/scene-graph/src/constraints*.test.ts packages/geometry-kernel/src/constraints3d.test.ts --maxWorkers=1`；`npm.cmd run test:e2e -- e2e/agent-constrained-drag.spec.ts --workers=1`。
- [ ] **GREEN：** pointer intent → 临时约束 → solve → commit transaction；禁止直接改 render state。
- [ ] **GREEN 命令：** 上述定向测试；再跑完整 `npm.cmd run test:e2e -- --workers=3`。
- [ ] **提交检查点：** `git commit -m "feat(geometry): preserve constraints during drag"`。

## Phase N4：开放题编译与真实 Provider Benchmark

**目标：** 把自然语言抽取、求解、验证和图面可读性分别测量；不使用 deterministic_local 冒充模型能力。

**Files:**
- Create: `scripts/agent-benchmark/dataset.schema.json`、`runner.mjs`、`redaction.mjs`、`report.mjs`、tests。
- Modify only after dataset schema is green: `apps/web/src/agent/systemPrompt.ts`、`modelPlanner.ts`、tool loop contracts。
- Docs: `docs/acceptance/agent-tool-loop-scorecard.md`、`agent-release-gate.md`。

- [ ] **RED：** 缺 `provider/model/seed/status`、包含 secret、claim 缺 evidence、模式未标识时报告生成必须失败。
- [ ] **RED 命令：** `node --test scripts/agent-benchmark/*.test.mjs`。
- [ ] 题集至少包含：欠定、矛盾、未支持表达式、点名打乱、二面角/比例、动态请求、普遍证明请求。
- [ ] 每题最多 3 轮，记录抽取率、求解率、题设覆盖率、verified/unverified/no_witness、成本、延迟和人工可读性。
- [ ] 先跑小样本真实 provider；无凭据时写 `not_measured`，不伪造数字。
- [ ] **提交检查点：** `git commit -m "feat(eval): add real provider benchmark schema"`。

## Phase N5：形式证明出口

**目标：** 让少量短目标产生可独立校验的 proof artifact，不把采样或实例通过冒充证明。

**Files:**
- Create: `packages/agent-core/src/proof/` artifact schema、verifier、adapter tests。
- Create: `scripts/proof-spike/` feasibility runner。
- Modify: `apps/web/src/components/agent/ConfirmationPanel.tsx`、`agentStore.ts`、run event schema。
- Docs: proof support matrix and release gate.

- [ ] **RED：** verified_instance/sampled 不能生成 formally_proved；伪造/缺字段/版本不匹配 artifact 拒绝。
- [ ] **RED 命令：** `npm.cmd exec -- vitest run packages/agent-core/src/proof --maxWorkers=1`。
- [ ] 先支持 5–10 个短目标：共线/共面、平行/垂直、等长、勾股；后端可选 Lean/mathlib 或 AlphaGeometry/Newclid 风格 adapter。
- [ ] **依赖审查任务（必须在 GREEN 前完成）：** 记录许可证、进程/线程边界、WASM/原生依赖、缓存/沙箱、启动时间和失败/超时行为；没有审查结论不得接入默认构建。
- [ ] **提交检查点：** `git commit -m "feat(proof): add verified proof artifact boundary"`。

## Phase N6：Feature flags、发布与维护收口

**目标：** 把前五阶段的能力安全地从实验变成可选择发布能力。

**Files:** `apps/web/src/agent/featureFlags.ts`、`packages/agent-core/src/capabilities.ts`、release gate、README、current-status、feature-catalog、CHANGELOG。

- [ ] N1 开始前先加入 `obligationIR/witnessSearch/constrainedDrag/openProblemCompiler/proofExport` 五个独立 flag，默认关闭。
- [ ] 每个 flag 有单元、浏览器和回退用例；关闭 flag 时旧路径行为逐字不变。
- [ ] 更新所有进度文档和发布门禁；统一记录真实 provider、动态拖动和 proof artifact 证据。
- [ ] 运行：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run lint`、`npm.cmd run build --workspace @draw/web`、`npm.cmd run test:e2e -- --workers=3`、`npm.cmd run test:rust`、`npm.cmd run test:perf`、`npm.cmd run eval:agent`。
- [ ] **提交检查点：** `git commit -m "docs(agent): close next-phase release gate"`。

## 计划自审与执行纪律

- 每个 Phase 开始前核对上游接口和当前调用点；不得只创建新目录而不接入 `planCompiler → draftStore → Worker → HostBridge`。
- 每个 RED 必须先失败在预期业务断言；环境错误不能算 RED。
- 每个 GREEN 结束后跑本阶段定向测试，再跑与旧功能相关的回归。
- `git diff --check`、提交文件清单和远端 SHA 必须在最后记录。
