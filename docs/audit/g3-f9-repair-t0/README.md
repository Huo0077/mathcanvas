# G3-F9 内核动作修复 Task 0 审计记录：工具状态真实性闸（0 新增付费）

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；仅落地工具状态真实性安全闸与无进展停机保护，**尚未实现立体实际构造**，不能将 Task 0 记为立体作图能力通过。

## 1. 本轮改动与实现核对

1. **工具真实状态字段与未实装动作 fail-closed（[dsActionTools.ts](../../../apps/web/src/agent/dsActionTools.ts) & [dsActionTools.test.ts](../../../apps/web/src/agent/dsActionTools.test.ts)）**
   - `DsActionExecutionResult` 新增 `stateChanged: boolean`（仅 `SpeculativeCanvas.applyAction` 推进或 `rollback` 实际回退时为 `true`，元数据登记 `declare_entity` / `add_relation` / `choose_strategy` 显式标为 `false`）。
   - 删除尾部默认 `accepted` 兜底：尚未接通内核的 `construct_solid`、`construct_face`、`construct_base`、`construct_fold_state`、`query_measurement`、`query_constraint_status` 一律 fail-closed 返回 `ok: false, status: "blocked", blockerCode: "unsupported_action", stateChanged: false`。
   - `buildDsActionToolSchemas` 仅发布 `IMPLEMENTED_DS_ACTION_TOOLS` 已实装可执行的闭集子集。
2. **规划器无进展停机（[modelPlanner.ts](../../../apps/web/src/agent/modelPlanner.ts) & [modelPlanner.test.ts](../../../apps/web/src/agent/modelPlanner.test.ts)）**
   - 构造类动作若虚报 `ok && !stateChanged`，或同一非进展签名连续重复 ≥ 2 次，立即触发 `no_progress` 返回结构化 `PlanFailure`，避免空转耗尽 8 轮预算。

## 2. 实测验证结果

- `vitest run apps/web/src/agent/dsActionTools.test.ts apps/web/src/agent/modelPlanner.test.ts --testTimeout=30000`：**`2` 文件 `75 passed`**（含 `square_pyramid` / `triangular_prism` / `tetrahedron` 零费反例与停滞守卫）
- `npm.cmd run typecheck`：退出 `0`
- `npm.cmd run lint`：**`0 errors`**
- `npm.cmd run test:docs -- --testTimeout=30000`：**`8` 文件 `22 passed`**

## 3. 下一步

- 推进 [G3-F9 内核动作修复计划](../../g3-final/G3-F9-kernel-action-repair-plan.md) **Task 1（参数化立体动作经 `solveConstraint3d` 真正写入隔离候选）**。
