# G3-DS Task F4 审计记录：二维与函数内核求解器 `constraintSolve2d`

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；当前真实 DS 36 题成绩仍为 `0/36`（[Task F0 真源基线](../../g3-final/retests/2026-11-17-92981/README.md)）。

## 1. 本轮改动与实现核对

1. **几何内核扩展（[planar-constraints.ts](../../../packages/geometry-kernel/src/planar-constraints.ts) & [function-evidence.ts](../../../packages/geometry-kernel/src/function-evidence.ts)）**
   - 在 `planar-constraints.ts` 补充纯粹平面关系与定比工具：`pointToLineDistance2d`、`solvePointOnLine2d`、`solveAffineRatioPoint2d` 与 `solveOrientedLineThroughPoint2d`（垂直/平行及残差核算）。
   - 在 `function-evidence.ts` 新增 `evaluateFunctionDomainEvidence`，基于 `functionGraphEvidence` 判定区间内 `"valid" | "partial_breaks" | "empty_domain" | "invalid_expression"`。
2. **统一 2D 与函数求解器（[constraintSolve2d.ts](../../../packages/agent-core/src/solver/constraintSolve2d.ts) & [constraintSolve2d.test.ts](../../../packages/agent-core/src/solver/constraintSolve2d.test.ts)）**
   - 实现 `solveConstraint2d`，统一输出 `{ status, roots, selectedBranch, residual, domainStatus, constraintStatus, foci?, eccentricity?, reason? }`。
   - 参数化覆盖点在线上、两线交点、三点共线、中点、线段定比、等距、垂直/平行、圆/椭圆/双曲线/抛物线与直线交点（含分支优先选择与判别式无实根 `infeasible`）、函数定义域、点处切线、外点引切线、公切线、数值与符号圆锥曲线焦点/离心率，并包含平行直线/退化点/越界定义域/非法离心率负向反例。
3. **主编译接入与导出（[dsDrawingIntent.ts](../../../packages/agent-core/src/dsDrawingIntent.ts) & [index.ts](../../../packages/agent-core/src/index.ts)）**
   - 在 `dsDrawingIntent.ts` 的 `tangent_at_x` 路径接入 `solveConstraint2d` 统一求值与导数斜率，并在 `index.ts` 导出 `solver/constraintSolve2d`。

## 2. 实测验证结果

- `vitest run packages/agent-core/src/solver/constraintSolve2d.test.ts packages/agent-core/src/dsDrawingIntent.test.ts packages/geometry-kernel/src/function-evidence.test.ts packages/geometry-kernel/src/planar-constraints.test.ts --testTimeout=30000`：**`4` 文件 `93 passed`**（`planar-constraints.test.ts` `52`、`constraintSolve2d.test.ts` `5`、`function-evidence.test.ts` `24`、`dsDrawingIntent.test.ts` `12`）
- `npm.cmd run typecheck`：退出 `0`（全工作区 + `e2e` + `scripts` 通过）
- `npm.cmd run lint`：**`0 errors`**（`34 warnings`）
- `npm.cmd run test:docs -- --testTimeout=30000`：随全套文档更新一并核验

## 3. 下一步

- 推进 **Task F5（三维几何约束内核求解器 `constraintSolve3d.ts`）**。
