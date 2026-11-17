# G3-DS 失败驱动 Task 3：零候选与错误候选失败签名驱动的能力族补齐（零付费回放）

- **日期**：2026-11-17
- **性质**：零新增付费 API 调用（针对 `summary.json` 中 `GK-S05`、`GK-P03`、`JT-P02` 等失败签名与 `GK-P08` 表面齐全反例补齐正交构造/双注册能力；真实 DS 成绩仍为 `0/36`，不等待全部 36 题即如实留存未实测失败清单）

## 1. 失败签名分析与交付产物

1. **实体 ID 与显示标签解耦缺陷（影响 `GK-S05` / `GK-P03` / `JT-P02` / `GK-P04` 等多题）**：
   - [dsDrawingIntent.ts](../../../packages/agent-core/src/dsDrawingIntent.ts) 编译期统一通过 `resolveLabel(step, p)` 回退读取 `entityById.get(step.outputEntityId)?.label`，并在 `conicRegistry`、`point2Registry`、`line2Registry`、`point3Registry`、`point3LabelRegistry` 同步登记实体 `id` 与显示标签 `label`；同时在 `parseAndValidateDsDrawingIntent` 中预登记实体的 `vertexNames`/`afterVertexNames` 于对应作用域内，解决“棱柱顶点 `M`, `M₁` 在 `givenRelations` 被误判 `undeclared_entity_ref`”与“后续线段引用点 `id` 找不到点标签 `M₂`”的问题。
2. **圆锥曲线方程直解与割线另一交点通用能力族（`GK-P03` / `JT-P02` 类）**：
   - 新增 `resolveConicFromEquation(equation, expectedType)` 支持标准圆、抛物线、椭圆与双曲线代数方程直解（无需模型手算半径/焦参数），同步纳入 `validateRequiredParameters` 守卫（绝不使用虚假 `2/1` 默认半轴）。
   - `planar_point_on_host` 新增正交 `mode: "conic_vertex"`（按圆锥参数精确取 $V_1/V_2$ 顶点）与 `mode: "other_line_conic_intersection"`（支持直线或双点 `from/through` ∩ 圆锥曲线，按 `excludePointId`/`excludePointIds` 剔除重合交点；若无第二异点返回空而不造伪点）。
3. **长方体/棱柱棱比点与表面齐全反例验证（`GK-S05` 类与 `GK-P08` 反例）**：
   - 改名变体棱柱 `MNPQ-M₁N₁P₁Q₁` 与 `M₂, N₂` 棱比点 + `M₂N₂` 连线在非题号参数下完整编译并通过；
   - 在 [drawingCertificate.test.ts](../../../packages/agent-core/src/verification/drawingCertificate.test.ts) 新增 `GK-P08`（`objCov=1, obCov=0`）表面齐全反例：双对象标签全匹配但双曲线方程违背题设时，生产证书严格拒绝通过（`missingEntities=[]`、`certificateStatus !== "passed"`、`failedObligations` 非空）。

## 2. 仍留存历史 DS 失败与未闭环清单

- 历史原生 DS 实测 `summary.json` 中 **`26` 题零候选**（除本轮已补能力族并保留 `R4` 缺图阻断的 `GK-S02/GK-S03/JT-S06/JT-S07` 外，其余立体与平面题尚待在 Task 4/5 闭环后由 Task 6 经用户新授权实测验证）及 **`10` 题非空候选**（`GK-S05`、`GK-P03`、`JT-P02`、`GK-P04`、`GK-P07`、`GK-P08`、`GK-P09`、`JT-P04`、`JT-P06`、`JT-P09`）历史记录原样保留，**不凭局部回放提前升格为 `passed`**。

## 3. 验证结果

- `npm.cmd exec -- vitest run packages/agent-core/src/dsDrawingIntent.test.ts packages/agent-core/src/verification/drawingCertificate.test.ts scripts/reliability-eval/drawingContracts.test.ts scripts/reliability-eval/planarContracts18.test.ts scripts/reliability-eval/solidContracts18.test.ts --testTimeout=30000`：**`5` 文件 / `111 passed (111)`**（含 [dsDrawingIntent.test.ts](../../../packages/agent-core/src/dsDrawingIntent.test.ts) `11/11`、[drawingCertificate.test.ts](../../../packages/agent-core/src/verification/drawingCertificate.test.ts) `9/9`、[solidContracts18.test.ts](../../../scripts/reliability-eval/solidContracts18.test.ts) `23/23`、[planarContracts18.test.ts](../../../scripts/reliability-eval/planarContracts18.test.ts) `23/23`、[drawingContracts.test.ts](../../../scripts/reliability-eval/drawingContracts.test.ts) `45/45`）。
- `npm.cmd run typecheck`：全部工作区与 `e2e`/`scripts` 通过（exit `0`）。
- `npm.cmd run lint`：exit `0`（`0 errors`，`34 warnings`）。
- 下一步进入 **Task 4**（多问/多状态/多分支的同版评测入口 `g3DsFrozenCaseRunner.ts`，零付费）。
