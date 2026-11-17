# DS2：19 道 partial 几何义务族内核求解、作用域隔离与多态编译

- **日期**：2026-11-17
- **性质**：零新增付费 API 调用（正交求解器/内核编译、独立义务核验、篡改负例与既有回归验证）

## 1. 交付产物与正交求解补强

在 [dsDrawingIntent.ts](../../../packages/agent-core/src/dsDrawingIntent.ts)（不按题号特判、不向求解器注入合同答案）按失败家族统一打通 4 类正交几何求解与作用域编译：

1. **家族 ① / ③：圆锥曲线求参、曲线交点与函数/圆锥曲线切线**：
   - `conic_from_equation_or_properties` 新增 `foci + throughPoint`（直连 `@draw/geometry-kernel` 的 `ellipseFromFociAndPoint` / `hyperbolaFromFociAndPoint`）、`majorSemiAxis + eccentricity`（由离心率 $e$ 与长半轴 $a$ 确定短半轴 $b$）及挖点 `excludedPoints`；
   - `planar_point_on_host` 打通 `focus`（`conicFoci`）、`on_conic`、`line_conic_intersection`（`intersectPlanarLineAndConicExact`）、`midpoint`、`segment_ratio` 与 `line_intersection`；
   - `planar_line_or_segment` 打通 `tangent_to_conic`（`tangentLineToConicAt`）与 `perpendicular_bisector`；
   - `function_curve_and_tangent` 在既有 `tangent_at_x` 之外补齐过曲线外定点作切线 `tangent_from_external_point`（基于 `evaluateFunctionWithDomain` 与 `evaluateSymbolicDerivative` 数值求解切点并用 `planar.create_line` 落地）。
2. **家族 ② / ④：四棱锥垂直关系求解、立体垂足连线与多小问作用域裁剪**：
   - `solid_base_and_prism_or_pyramid` 新增 `pyramid_perp_base_quad`（在 `requireAdPerpDc` 下联立求解 $AD \perp DC$ 与底面边长闭合，覆盖 `GK-S01` 所属四边形底座类结构）；
   - `solid_point_on_edge_or_face` 打通 `perpendicular_foot_on_plane`、`perpendicular_foot_on_line`、`edge_ratio` 与 `segment`（`solid.create_segment`）；
   - `infeasible_disclosure` 支持整题不可行澄清及局部小问不可行说明与可行图元共存；新增 `resolveAllowedScopes` 与 `compileDsDrawingIntentByScope`，防止 `(2)` 问实体泄漏至 `(1)` 问或反向污染。

## 2. 验证结果

- `npm.cmd exec -- vitest run dsDrawingIntent.test.ts planarContracts18.test.ts solidContracts18.test.ts planCompiler.offPath.golden.test.ts agentRunner.test.ts --testTimeout=30000`：**`5` 文件 / `137 passed (137)`**：
  - [dsDrawingIntent.test.ts](../../../packages/agent-core/src/dsDrawingIntent.test.ts)（`7/7`）：验证离心率求椭圆+弦交点+中点/切线跨作用域隔离、四边形垂直底座四棱锥+面垂足+连线经独立 `verifyDiagramObligations` 判 `passed` 且篡改 $D$ 点破坏 $AD \perp DC$ 时判 `failed`、过外点 $(1,0)$ 对 $y=x^2$ 作切线斜率精度 $< 10^{-5}$ 且第 `(2)` 问不可行披露隔离；
  - [planarContracts18.test.ts](../../../scripts/reliability-eval/planarContracts18.test.ts)（`23/23`）、[solidContracts18.test.ts](../../../scripts/reliability-eval/solidContracts18.test.ts)（`23/23`）、[planCompiler.offPath.golden.test.ts](../../../packages/agent-core/src/planCompiler.offPath.golden.test.ts)（`13/13`）、[agentRunner.test.ts](../../../apps/web/src/agent/agentRunner.test.ts)（`71/71`）全数回归通过（既有 `GK-S08`/`GK-S09` 等无退化）。
- `npm.cmd run typecheck`：exit `0`
- `npm.cmd run lint`：exit `0`（`0 errors`，`34 warnings`）
- `npm.cmd run test:docs -- --testTimeout=30000`：`8` 文件 / **`22 passed`**

## 3. 边界与下一步

- 本区块**0 新增付费 API 调用**，所有测试均为离线/内核与既有回归检验，**不计入 `DS live pass`**（最近一次 DS 实测仍保持 `2/36`）。
- 下一步进入 **`DS3`**（修复 `draftStore.ts` 空题面/漏句假阳性放行 `GK-P09`/`JT-P09`、定位并修复 `JT-S07`/`JT-S09` 假阴性 `not_supported`，以及在 `coordinator.ts` `validating` 阶段接入有上限的逐义务局部修复环）。
