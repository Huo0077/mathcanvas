# G3-DS Task F5 审计记录：三维几何约束内核求解器 `constraintSolve3d`

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；当前真实 DS 36 题成绩仍为 `0/36`（[Task F0 真源基线](../../g3-final/retests/2026-11-17-92981/README.md)）。

## 1. 本轮改动与实现核对

1. **三维内核残差与闭合拓扑核验（[constraints3d.ts](../../../packages/geometry-kernel/src/constraints3d.ts) & [measurements3d.ts](../../../packages/geometry-kernel/src/measurements3d.ts)）**
   - 在 `constraints3d.ts` 新增 `evaluateLinePlaneRelation3`、`evaluatePlanePlaneRelation3`、`evaluateCoplanarPoints3`、`projectPointOntoSegmentEndpoints3` 与 `projectPointOntoPlanePoints3`。
   - 在 `measurements3d.ts` 新增 `verifyClosedPolyhedronTopology3`，严格校验流形有向半边配对（零边界边）、面片共面残差与非零有向体积。
2. **统一 3D 约束求解器（[constraintSolve3d.ts](../../../packages/agent-core/src/solver/constraintSolve3d.ts) & [constraintSolve3d.test.ts](../../../packages/agent-core/src/solver/constraintSolve3d.test.ts)）**
   - 实现 `solveConstraint3d`，统一输出 `{ status, residuals, constraintStatus, pointRegistry, vertices?, faceRings?, namedFaceRings?, topologyValid?, reason? }`。
   - 参数化覆盖一般棱柱、正四棱锥、直棱锥、四面体（按几何不等式失败关闭）、线/面垂足、线面与面面垂直/平行、四点及以上共面检验、闭合多面体流形拓扑与棱/面定比内点，并附带负高、缺面开放壳层、非共面、三角不等式违背等反例。
3. **主编译接入与导出（[dsDrawingIntent.ts](../../../packages/agent-core/src/dsDrawingIntent.ts) & [index.ts](../../../packages/agent-core/src/index.ts)）**
   - 将 `dsDrawingIntent.ts` 的 `perpendicular_foot_on_plane`、`perpendicular_foot_on_line` 与 `edge_ratio` 收拢委托给 `solveConstraint3d`，消除重复手算向量叉乘与投影，并在 `index.ts` 导出 `solver/constraintSolve3d`。

## 2. 实测验证结果

- `vitest run packages/agent-core/src/solver/constraintSolve3d.test.ts packages/agent-core/src/dsDrawingIntent.test.ts packages/geometry-kernel/src/constraints3d.test.ts packages/geometry-kernel/src/measurements3d.test.ts --testTimeout=30000`：**`4` 文件 `35 passed`**（`constraints3d.test.ts` `10`、`measurements3d.test.ts` `10`、`constraintSolve3d.test.ts` `3`、`dsDrawingIntent.test.ts` `12`）
- `npm.cmd run typecheck`：退出 `0`（全工作区 + `e2e` + `scripts` 通过）
- `npm.cmd run lint`：**`0 errors`**（`34 warnings`）
- `npm.cmd run test:docs -- --testTimeout=30000`：随全套文档更新一并核验

## 3. 下一步

- 推进 **Task F6（折叠、多状态分支与独立候选谱系绑定）**。
