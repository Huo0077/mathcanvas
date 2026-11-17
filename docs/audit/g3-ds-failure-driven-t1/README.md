# G3-DS 失败驱动 Task 1：空场景构造与已有场景观察分阶段工具发布（零付费）

- **日期**：2026-11-17
- **性质**：零新增付费 API 调用（工具协议阶段分流；**不凭回放声称 7 道历史混合题已获真实 DS 实测获救**，真实成绩仍为 `0/36`）

## 1. 交付产物

1. **纯策略模块 [modelToolPolicy.ts](../../../apps/web/src/agent/modelToolPolicy.ts)**：
   - 实现 `selectToolPhase({ intentMode, hasExistingGeometry, hasSelectedRefs, requiresSceneObservation, observationCompleted })`、`partitionPublishedTools` 与基于真实 `GeometryDocument` / `DocumentHandle` / `selectedRefs` 推导场景状态的 `hasExistingGeometryInDocument` / `deriveSceneToolContextFromRequest`（绝不依赖题号或提示词关键词）。
   - `ds_intent` 空白文档（无既有图元/参数/选区/源引用）：首轮即落 `"construct"` 阶段，**仅发布 `plan_set_plan`**，不给无意义的 `scene_inspect` / `scene_search_entities`。
   - `ds_intent` 已有画布或选区：首轮 `"observe"` **仅发布只读工具**，禁用 `plan_set_plan`；若观察无法执行（缺只读执行器）直接 fail-closed 报错而不静默跳过；只读结果回传并扣减真实预算后切换至 `"construct"`，单独发布 `plan_set_plan`。
   - `legacy_actions`：保持原全量路由语义完全兼容。
2. **规划与运行器接线**：
   - [modelPlanner.ts](../../../apps/web/src/agent/modelPlanner.ts) 在每轮模型请求前按当前 `observationCompleted` 重新计算阶段与互斥工具列表；`observe` 阶段拒收 `plan_set_plan`（返回结构化 `unexpected_tool_call`），`construct` 阶段拒收未发布的读工具；保留原有混合读+写原子拒绝守卫（0 次 `executeTool`）。
   - [agentRunner.ts](../../../apps/web/src/agent/agentRunner.ts) 从实时 `useSceneStore.getState().document` 与上下文句柄向 `createModelPlanner` 注入 `sceneContext`。

## 2. 验证结果

- `npm.cmd exec -- vitest run apps/web/src/agent/modelToolPolicy.test.ts apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/agentRunner.test.ts --testTimeout=30000`：**`3` 文件 / `145 passed (145)`**（先 RED 观测缺失模块失败后转 GREEN）：
  - [modelToolPolicy.test.ts](../../../apps/web/src/agent/modelToolPolicy.test.ts)（`6/6`）：覆盖空白场景只发 `plan_set_plan`（含 `GK-S08` 空白场景形态）、已有几何先仅发 `scene_inspect` 观测后再仅发 `plan_set_plan`、7 道历史混合批次（`GK-S08`、`JT-S02`、`JT-S09`、`GK-P06`、`JT-P01`、`JT-P05`、`JT-P07`）仍原子拒绝（0 次执行），以及取消、零预算、重复 `callId` 和观察阶段偷发 `plan_set_plan` 全数 fail-closed；
  - [modelPlanner.test.ts](../../../apps/web/src/agent/modelPlanner.test.ts)（`68/68`）与 [agentRunner.test.ts](../../../apps/web/src/agent/agentRunner.test.ts)（`71/71`，含 `ds_intent` 空场景只发布 `["plan_set_plan"]` 且主画布 `0` 写入）全过。
- `npm.cmd run typecheck`：`6` 工作区及 `e2e/tsconfig.json`、`scripts/tsconfig.json` 全过（exit `0`）。
- `npm.cmd run lint`：exit `0`（`0 errors`，`34 warnings`）。
- **`npm.cmd run test:docs`**：见本次提交前校验结果（随文档同步通过）。
- 下一步进入 **Task 2**（`DsDrawingIntent` 数学必要参数来源校验与编译 fail-closed，零付费）。
