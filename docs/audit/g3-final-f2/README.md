# G3-DS Task F2 审计记录：动作级 DS ToolSpec 与单动作闭环 `dsActionTools`

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；当前真实 DS 36 题成绩仍为 `0/36`（[Task F0 真源基线](../../g3-final/retests/2026-11-17-92981/README.md)）。

## 1. 本轮改动与实现核对

1. **动作级闭集注册表与校验（[actionRegistry.ts](../../../packages/agent-core/src/actionRegistry.ts) & [dsActionTools.ts](../../../apps/web/src/agent/dsActionTools.ts)）**
   - 在 `@draw/agent-core` 导出规范化 22 项动作闭集 `DS_ACTION_CLOSED_SET`（`declare_entity` … `finish_candidate` / `request_clarification`），并由 `dsActionTools.ts` 提供 `buildDsActionToolSchemas`、`parseDsActionToolCall` 与 `createDsActionSession`。
   - 单步执行后端挂载至 Task F1 的 `SpeculativeCanvas`，每步返回三态反馈（`accepted` / `repairable` / `blocked`）、最新 `candidateHash` 与可修复提示，严禁手算立体顶点（`hand_computed_vertices_forbidden`）且零写入主画布。
2. **`modelPlanner` 与 `systemPrompt` 对接 `ds_action` 模式（[modelPlanner.ts](../../../apps/web/src/agent/modelPlanner.ts)、[systemPrompt.ts](../../../apps/web/src/agent/systemPrompt.ts)、[modelToolPolicy.ts](../../../apps/web/src/agent/modelToolPolicy.ts)）**
   - 新增 `DS_ACTION_PROMPT_VERSION = "mathcanvas.ds_action.prompt.v1"`；`modelPlanner` 在 `intentMode === "ds_action"` 下保持阶段隔离（已有场景先只发只读工具，空场景直接发布 22 个动作工具），校验 `duplicate tool call id`、混合读+动作批次、`AbortSignal` 取消及预算扣减，直到 `finish_candidate` 产出 `PlanEnvelope` 或 `request_clarification` 返回澄清；同时保留 `ds_intent` 与 `legacy_actions` 向后兼容。

## 2. 实测验证结果

- `vitest run apps/web/src/agent/dsActionTools.test.ts apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/modelToolPolicy.test.ts apps/web/src/agent/systemPrompt.test.ts --testTimeout=30000`：`4 passed (4)` / `110 passed (110)`
- `npm.cmd run typecheck`：exit `0`
- `npm.cmd run lint`：exit `0`（`0 errors, 34 warnings`）

## 3. 下一步

- 推进 **Task F3（实体图 `EntityGraph` 与约束图 `ConstraintGraph`）**。
