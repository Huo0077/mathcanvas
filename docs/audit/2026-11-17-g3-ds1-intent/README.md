# DS1：DS 结构化施工单、紧凑提示词瘦身与通用构造 DAG

- **日期**：2026-11-17
- **性质**：零新增付费 API 调用（结构化意图编译、协议瘦身、DAG 校验与回放/Mock 验证）

## 1. 交付产物

1. **紧凑结构化施工单协议（`mathcanvas.ds_intent.v1`）**：
   - 新增 [dsDrawingIntent.ts](../../../packages/agent-core/src/dsDrawingIntent.ts) 并在 [index.ts](../../../packages/agent-core/src/index.ts) 导出。
   - 定义 8 类正交构图策略（`conic_from_equation_or_properties`、`function_curve_and_tangent`、`planar_point_on_host`、`planar_line_or_segment`、`solid_base_and_prism_or_pyramid`、`solid_point_on_edge_or_face`、`solid_fold_along_hinge`、`infeasible_disclosure`），统一映射到底层 `ACTIONS` 与数学内核/求解器（`@draw/geometry-kernel`、`regularPyramid`、`perpendicularPyramid`、`prism`、`tetrahedron`、`rotatePointAboutHinge`）。
   - `parseAndValidateDsDrawingIntent` 严格拦截未声明引用（`undeclared_entity_ref`）、未连接小问跨作用域污染（`cross_scope_violation`）、折前/折后违规引用（`pre_fold_host_violation`）、无来源自由常数（`unsourced_constant`）及在参数化立体/折叠中使用手算顶点（`hand_computed_vertices_forbidden`）；遇到 `blocking: true` 缺失题图时自动转换为 `clarification` 而非编造坐标。
   - 在 [drawingIntent.ts](../../../packages/agent-core/src/drawingIntent.ts) 注册全部 `ds.*` 复合算子并统一折叠状态迁移判据；在 [obligationIR.ts](../../../packages/agent-core/src/obligationIR.ts) 增加不接触黄金答案的原文从句/作用域摘要 `irClauseSummaryForPrompt`。
2. **提示词与工具 Schema 瘦身及端到端接线**：
   - [systemPrompt.ts](../../../apps/web/src/agent/systemPrompt.ts) 新增 `intentMode: "ds_intent"`（`DS_INTENT_PROMPT_VERSION = "mathcanvas.ds_intent.prompt.v1"`），策略正文长度缩减至全量动作菜单的 `< 45%`，严禁手算立体顶点与隐藏思维链；
   - [modelPlanner.ts](../../../apps/web/src/agent/modelPlanner.ts) 新增 `buildDsIntentToolSchema()`（体积较全量 `buildPlanToolSchema` 缩小 `< 25%`）并共享工具/文本双向校验编译器 `resolveDsIntentOrPlanEnvelope`，未通过时产出带精确字段路径和原因码的结构化修复请求；
   - [agentRunner.ts](../../../apps/web/src/agent/agentRunner.ts) 原生支持传入 `modelPlanner.intentMode: "ds_intent"` 并走完整草稿暂存链（确认前 `sceneWrites = 0`）。

## 2. 验证结果

- `npm.cmd exec -- vitest run packages/agent-core/src/dsDrawingIntent.test.ts packages/agent-core/src/drawingIntent.test.ts packages/agent-core/src/obligationIR.test.ts apps/web/src/agent/systemPrompt.test.ts apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/agentRunner.test.ts --testTimeout=30000`：**`6` 文件 / `196 passed (196)`**。
  - 覆盖 13 题零候选家族代表结构（开放翻折、斜边直梯形翻折、函数+导数切线、圆锥曲线+切线、垂直四棱锥、正四棱锥、直三棱柱、棱柱、正四面体、棱上中点），全部零手算顶点且产出可通过 `parsePlanEnvelope`；
  - 覆盖 5 类负例拒收与 `missing_figure` 安全澄清；
  - 验证 `modelPlanner` + `agentRunner` 在 mock `ds_intent` 通道端到端生成 `awaiting_confirmation` 草稿且确认前主画布 `0` 写入。
- `npm.cmd run typecheck`：exit `0`
- `npm.cmd run lint`：exit `0`（`0 errors`，既有 `warnings`）
- `npm.cmd run test:docs -- --testTimeout=30000`：`8` 文件 / **`22 passed`**

## 3. 边界与下一步

- 本区块仅完成结构化意图协议、紧凑提示词、正交 DAG 编译器与回放/Mock 全链接线（**0 付费调用**，不计入 `DS live pass`）。
- 下一步进入 **`DS2`**（按义务族补齐 19 道 `partial` 的通用求解、构造与多作用域/折叠前后 `state` 闭环）。
