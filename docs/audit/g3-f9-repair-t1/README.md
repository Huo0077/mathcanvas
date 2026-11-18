# G3-F9 内核动作修复 Task 1 审计记录：参数化立体动作经 `solveConstraint3d` 真实写入（0 新增付费）

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；仅落地参数化 `construct_solid`（四族正反例经内核真实写入隔离候选），`construct_face` / `construct_base` / `construct_fold_state` / 查询工具将在 Task 2 落地。

## 1. 本轮改动与实现核对

1. **参数化立体内核物化（[dsActionTools.ts](../../../apps/web/src/agent/dsActionTools.ts) & [dsActionTools.test.ts](../../../apps/web/src/agent/dsActionTools.test.ts)）**
   - `construct_solid` 将四族参数化请求（`regular_pyramid` / `square_pyramid`、`prism` / `triangular_prism` / `rectangular_prism`、`perpendicular_pyramid`、`tetrahedron`）归一化后转交 `solveConstraint3d` 求解，按 `pointRegistry` + `namedFaceRings` 映射为已注册 `solid.create_polyhedron` 动作并经 `SpeculativeCanvas.applyAction` 真实物化入候选，同时同步记录命名 3D 顶点快照栈（支持 `repair_entity` 同步回退）。
   - 缺边长/高（`missing_required_parameter`）、无解三角形不等式（`infeasible`）、重复顶点名（`duplicate_vertex_name`）、手算 `vertices`（`hand_computed_vertices_forbidden`）或未声明底面顶点（`undeclared_entity_ref`）均 fail-closed 拒绝写入且 `snapshot().actions.length === 0`。
   - 将 `"construct_solid"` 纳入 `IMPLEMENTED_DS_ACTION_TOOLS` 发布子集。

## 2. 实测验证结果

- `vitest run apps/web/src/agent/dsActionTools.test.ts packages/agent-core/src/solver/constraintSolve3d.test.ts packages/agent-core/src/verification/drawingCertificate.test.ts --testTimeout=30000`：**`3` 文件 `17 passed`**
- `vitest run scripts/reliability-eval/solidContracts18.test.ts --testTimeout=30000`：**`1` 文件 `23 passed`**
- `npm.cmd run typecheck`：退出 `0`
- `npm.cmd run lint`：**`0 errors`**
- `npm.cmd run test:docs -- --testTimeout=30000`：随文档更新一并核验

## 3. 下一步

- 推进 [G3-F9 内核动作修复计划](../../g3-final/G3-F9-kernel-action-repair-plan.md) **Task 2（`construct_face` / `construct_base` / `construct_fold_state`、3D 点线扩展与 `query_measurement` / `query_constraint_status` 真实内核读数）**。
