# G3-F9 内核动作修复 Task 2 审计记录：实做面/底座/折叠动作与真实只读查询（0 新增付费）

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；仅验证 22 项动作闭集已全部由真实内核执行/实测驱动，真实 DS 在线调用仍暂停。

## 1. 本轮改动与实现核对

1. **底座/面/折叠/三维点线真正执行（[dsActionTools.ts](../../../apps/web/src/agent/dsActionTools.ts) & [dsActionTools.test.ts](../../../apps/web/src/agent/dsActionTools.test.ts)）**
   - `construct_base` 校验矩形/三角参数化底面（无参数拒绝），真实生成 `solid.create_face` 并写入 `points3`。
   - `construct_point` / `construct_segment` / `construct_line` 支持 `geometry3d` 坐标与棱上定比（`solveConstraint3d`）生成 `solid.create_point` / `solid.create_segment`。
   - `construct_face` 解析已物化 3D 点，校验非重复、`planeFromPoints` 不共线与 `solveConstraint3d({ kind: "coplanar" })` 共面（拒绝 `degenerate_face` / `non_coplanar_face`），真实写入 `solid.create_face`。
   - `construct_fold_state` 基于 `foldPointAboutHinge` 生成 `solid.fold`，隔离记录 `pre_fold` 与 `post_fold` 切片（强制两者 `candidateHash` 不同，暴露 `stateSlices()`）。
2. **真实内核只读观测与 rollback 清理**
   - `query_measurement`（`distance` / `position`）与 `query_constraint_status`（`coplanar` / `fixed_distance` / `collinear`）返回真实距离、坐标、`constraintStatus` 与 `residual`；缺对象报 `undeclared_entity_ref`，未支持指标报 `blocked / unsupported_observation`。
   - `repair_entity` / `repair_constraint` 回滚时同步恢复 `pointHistory` 与 `sliceHistory` 快照栈，回滚掉的点不可再被读取。
   - 自此 `IMPLEMENTED_DS_ACTION_TOOLS` 完整对齐 22 项 `DS_ACTION_CLOSED_SET`（每一项均对应真实内核写入或结构化观测/终态）。

## 2. 实测验证结果

- `vitest run apps/web/src/agent/dsActionTools.test.ts apps/web/src/agent/speculativeCanvas.test.ts packages/agent-core/src/foldChain.sequence.test.ts packages/geometry-kernel/src/constraints3d.test.ts --testTimeout=30000`：**`4` 文件 `27 passed`**
- `npm.cmd run typecheck`：退出 `0`
- `npm.cmd run lint`：**`0 errors`**
- `npm.cmd run test:docs -- --testTimeout=30000`：随文档更新一并核验

## 3. 下一步

- 推进 [G3-F9 内核动作修复计划](../../g3-final/G3-F9-kernel-action-repair-plan.md) **Task 3（有界修复停滞与恢复放行闭环）**。
