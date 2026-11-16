# P4 / T10 折叠状态谱系、双分支见证与耦合序约束证据

- **任务编号**：`T10`（P4 阶段，遵循 `implementation-task-ledger.json` DAG：`T09 → T10`）
- **提交信息**：`feat(fold): track state lineage and verified branch witnesses`
- **日期**：2026-11-16
- **目标**：严格区分折前/折后状态谱系（`parentStateId -> stateId`）与移动/固定实体、铰链共点、边长不变及内二面角 vs 面面锐角合同；为单折与耦合多折构造提供正负对称分支枚举（`positive`/`negative`）与候选排序、未解/欠定/越界（`> 3` 折）/顺序非法回滚（不伪造“证明无解”或错误示意图）。

## 1. 交付内容

1. **内核旋转对称分支、求解状态分类与角口径隔离**：
   - [`packages/geometry-kernel/src/rotation3d.ts`](../../../packages/geometry-kernel/src/rotation3d.ts)：新增 `rotatePointAboutHinge` 与 `foldBranchesForTargetDistance`，围绕铰链矢量枚举 `positive` 与 `negative` 镜像翻折分支并输出各自目标距离残差，明确标记 `degenerate` 铰链/共线顶点。
   - [`packages/geometry-kernel/src/foldSystem.ts`](../../../packages/geometry-kernel/src/foldSystem.ts)：新增 `classifyFoldSystemResult`，将 `not-found` / `underdetermined` / `cancelled` 与数学无解严格隔离（`provenUnsat: false`）。
   - [`packages/geometry-kernel/src/solidGoalMeasurements.ts`](../../../packages/geometry-kernel/src/solidGoalMeasurements.ts)：新增 `verifyTargetAngleContract`，严格隔离 `interior_dihedral` (`[0°, 180°]`) 与 `plane_acute_angle` (`[0°, 90°]`) 口径，防止把 `120°` 与 `60°` 混淆。
2. **折叠状态谱系与耦合顺序求解**：
   - [`packages/agent-core/src/solver/foldHinges.ts`](../../../packages/agent-core/src/solver/foldHinges.ts)：新增 `validateFoldLineageStep` 与 `buildFoldLineage`，记录 `parentStateId`、`stateId`、`hingeEntityId`、`movingFaceIds`、`fixedEntities` 与 `pointMapping`；显式拦截 `zero_length_hinge`、`hinge_point_drift`、`edge_length_changed`、`dp_identity_conflation`（如把折前 `D` 与折后 `P` 混为同一点）及 `degenerate_fold_angle`。
   - [`packages/agent-core/src/solver/coupledFolds.ts`](../../../packages/agent-core/src/solver/coupledFolds.ts)：在保留 `solvePlanFoldSystem` 的同时新增 `solveCoupledFoldSequence`，强校验顺序列中每步铰链/被折点已由前序状态物化（逆序立即返回 `invalid_order`）、拒绝超过 3 步耦合折叠（`unsupported`），保留全部通过核验的分支解 `candidateSolutions` 且恒设 `complete: false`。

## 2. RED → GREEN 与全量验证记录

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| RED（实现前） | `npm.cmd exec -- vitest run packages/agent-core/src/solver/foldHinges.test.ts packages/agent-core/src/planCompiler.foldBranches.test.ts packages/agent-core/src/planCompiler.coupledFolds.test.ts` | 按预期失败：`3 failed \| 5 failed \| 11 passed (16)` |
| 定向 GREEN（最终代码后） | `npm.cmd exec -- vitest run packages/agent-core/src/solver/foldHinges.test.ts packages/agent-core/src/planCompiler.foldBranches.test.ts packages/agent-core/src/planCompiler.coupledFolds.test.ts packages/geometry-kernel/src/rotation3d.test.ts packages/geometry-kernel/src/foldSystem.test.ts --testTimeout=30000` | `5 passed (5) \| 26 passed (26)` |
| 全量 TypeScript 类型检查 | `npm.cmd run typecheck` | exit 0 |
| 全量 ESLint | `npm.cmd run lint` | exit 0（0 errors，33 pre-existing warnings） |
| Web 生产构建 | `npm.cmd run --workspace @draw/web build` | exit 0（638 modules） |
| 离线评测 | `npm.cmd run eval:reliability -- --offline` | `1 passed (1) \| 3 passed (3)` |
| 全量 Vitest 套件 | `npm.cmd test -- --testTimeout=30000` | `536 passed (536) \| 5689 passed \| 1 todo (5690)` |
