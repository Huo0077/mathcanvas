# G3-DS 零付费加固归档：提示词/工具表冲突消除、Task 6 预检门禁与核心构图能力补全

> **边界声明（强制）**：本轮修复围绕历史 `0/36` DS5 审计与运行器离线检查发现的实际缺陷展开，**全程零新增付费 DeepSeek API 调用**。真实 DeepSeek 冻结 36 题成绩仍为 `0/36`（[2026-11-17-g3-ds5-live-36](../2026-11-17-g3-ds5-live-36/README.md)），端到端真实在线验证仍需用户显式授权后进入 **Task 6**。

## 1. 修复的真实缺陷清单

### Block R1：`ds_intent` 提示词/工具协议冲突与 `g3DsFrozenCaseRunner` 运行器接线/预算预检修复

1. **修复 `systemPrompt.ts` 中 `ds_intent` 工具指令自相矛盾与 `params` 契约空白**（[systemPrompt.ts](../../../apps/web/src/agent/systemPrompt.ts)）
   - 问题：`buildDsIntentPolicyText` 此前直接复用 `channelAdvice("native_tools")`，要求模型给 `plan_set_plan` 顶层传 `kind`、`actions`，与紧随其后的 `mathcanvas.ds_intent.v1` 形状冲突；同时 `params` 示例为空 `{}`，导致模型只能猜字段名。
   - 修复：将 `DS_INTENT_PROMPT_VERSION` 升级至 `mathcanvas.ds_intent.prompt.v2`，新增 `dsIntentChannelAdvice` 明确区分 `ds_intent` 与 `clarification`/`answer` 载荷形状，并附带全部 8 类 `DS_CONSTRUCTION_STRATEGIES` 的紧凑 `params` 速查表（保持整体策略文本显著短于 legacy 45%）。
2. **补齐 `buildDsIntentToolSchema` 策略节点字段声明**（[modelPlanner.ts](../../../apps/web/src/agent/modelPlanner.ts)）
   - 在 `constructionStrategies.items.properties` 中补齐 `nodeId`、`outputEntityId`、`outputKind`、`strategy`、`scopeId`、`stateId`、`hostEntityId`、`dependencyIds`、`foldPhase`、`params`、`assumptions`、`sourceSpan`，消除空洞对象提示。
3. **修复 `g3DsFrozenCaseRunner.ts` 对接真实 `PlannerPort` 必崩/拒批缺陷，并落地 Task 6 预算与漏斗门禁**（[g3DsFrozenCaseRunner.ts](../../../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts)）
   - 问题：此前 `buildPlanRequestForPublicInput` 既缺少 `RunContext`、`conversation`、`signal`（调用 `modelPlanner` 立即触发 `request.signal.addEventListener` 崩溃），又传 `tools: []` 导致 `planToolOfferedInRequest === false` 而无法发布 `plan_set_plan`。
   - 修复：接入 `createToolRegistry().forModelPhase("planning", ...)` 提供真实 `plan.set_plan`，补齐 `RunContext`、`conversation`、`AbortSignal` 与 `beforeProviderRequest` 预算扣减；新增 `evaluateTask6LivePreflight`（缺 `pricingSource`/`maxUsd`/超出预估上限等情况一概 fail-closed 拒发请求）及 `aggregateTask6FunnelReport`（记录漏斗计数、当场标记 `costKnown: false, costUsd: null` 并对 `mixed_read_plan` 复发或连续失败触发熔断停批）。

### Block R2：`dsDrawingIntent.ts` 函数切线/正交平行线/多点折叠/方程解析与零静默跳过修复

1. **函数公切线与单点切线接入真实 `function.create_tangent` 动作**（[dsDrawingIntent.ts](../../../packages/agent-core/src/dsDrawingIntent.ts)）
   - 新增 `function_curve_and_tangent` 的 `mode: "common_tangent"` 并修正已绑定曲线 `mode: "tangent_at_x"`，通过 `"draft:<alias>"` 引用发出标准 `function.create_tangent`（含 `{ anchor: { kind: "common", otherSourceId, branch } }`），解决 `diagramVerification` 中 `candidateTangents` / `candidateCommonTangents` 因只收到普通直线而被判 `not_supported` 的问题。
2. **平面直线策略与圆锥曲线一般系数方程补全**（[dsDrawingIntent.ts](../../../packages/agent-core/src/dsDrawingIntent.ts)）
   - `planar_line_or_segment` 新增 `perpendicular_through_point` 与 `parallel_through_point` 模式；
   - `resolveConicFromEquation` 新增一般缩放标准方程（如 `4x^2+9y^2=36`、`Ax^2-By^2=C`、`Ay^2-Bx^2=C`）。
3. **多动点铰链折叠与编译零静默跳过 fail-closed**（[dsDrawingIntent.ts](../../../packages/agent-core/src/dsDrawingIntent.ts)）
   - `solid_fold_along_hinge` 改为旋转全部 `movingVertexNames[i]` 并完整注册 `afterVertexNames[i]` 到 `point3Registry` 与 `point3LabelRegistry`；
   - 任何非披露构造步骤若因运行时宿主/依赖缺失未能产出动作，一律写入 `unresolved_construction` 诊断并 fail-closed 返回 `clarification`，严禁静默丢弃步骤后输出残缺草图。

## 2. 全仓实测验证（最终代码编辑后）

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 全仓 TypeScript 类型检查 | `npm.cmd run typecheck` | exit `0` |
| 全仓 ESLint 检查 | `npm.cmd run lint` | exit `0`（`0 errors, 34 warnings`） |
| 全仓 Vitest 单元测试 | `npm.cmd test -- --testTimeout=30000` | **`550 passed (550)` / `5850 passed | 1 todo (5851)`** |
| 文档一致性检查 | `npm.cmd run test:docs -- --testTimeout=30000` | 见提交前本次复核 |

## 3. 下一步停点

仍严格停在 **Task 6（真实 DeepSeek 最小预检 + 冻结 36 题在线复测）** 之前：需等待用户明确授权模型、`profileRevision`、首批次题目、请求/token/美元上限与熔断条件后，方可执行在线请求。
