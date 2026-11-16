# P4 / T07 证据：平面与圆锥曲线确定性构造与定义域裁剪相交

- **日期**：2026-11-16
- **区块**：`B4 / T07`（`feat(geometry): construct planar entities with domain-checked intersections`）
- **依赖前置**：`T04`（`85321cec`）、`T06`（`92f7f419`）、`T11`（`310d150a`）

## 1. 解决的问题

1. **几何内核（`@draw/geometry-kernel`）精确旋转焦点、切线与定义域裁剪相交**
   - `packages/geometry-kernel/src/conics.ts`：新增 `conicFoci`（严格保持中心/顶点平移与 `rotation` 旋转变换）与 `tangentLineToConicAt`（计算局部隐式梯度、旋转至世界坐标并构造精确切向直线，仅在 `conicResidualAt` 有限且残差合格时返回）。
   - `packages/geometry-kernel/src/conic-line.ts`：新增参数化直线 `P(t) = P₀ + t·d` 与定义域筛选接口 `intersectParametricLineWithConic`（统一覆盖垂直线 `x = c`、射线/线段 `t` 范围与 `x ≠ 0` / `y ≠ 0` 排除条件，返回 `filteredOutCount` 并严格区分截面剩单点 `single` 与二重切根 `tangent`）。
   - `packages/geometry-kernel/src/conic-parameters.ts`：新增 `fitOriginConicThroughPoints`（过两线性无关点反求中心在原点的椭圆/双曲线系数并附独立方程残差核验）。
   - `packages/geometry-kernel/src/curve-intersections.ts`：新增 `intersectPlanarLineAndConicExact`，将直线/线段/射线与圆锥曲线求交直接经代数通道 `intersectParametricLineWithConic` 精确求解，不以折线采样代替相切或重数判定。
2. **Agent 平面与圆锥曲线确定性求解入口（`@draw/agent-core` 与 `@draw/web` 路由接线）**
   - 新增 `packages/agent-core/src/solver/planarDrawing.ts`（`tryBuildPlanarDrawingPlan`）：复用 `parseDiagramObligations` / `solveSymbolicConicContract` / `ellipseFromFociAndPoint` / `hyperbolaFromFociAndPoint` / `fitOriginConicThroughPoints` / `conicFoci` / `tangentLineToConicAt` / `intersectParametricLineWithConic` 与 `evaluateExpressionWithDomain`（零硬编码答案或题号，不拦截 1D 函数微积分题 `T08`）。
   - 完整覆盖椭圆/双曲线/抛物线/圆解析与条件反求（`GK-P01` 离心率+长轴+面积约束弦、`GK-P08` 双曲线渐近线与圆相切、`JT-P03` 抛物线与直线交点、`JT-P06` 焦距+点及 `(2)` 当 `b > c` 诚实诊断 `PF₁⊥PF₂` 实数域无解且不伪造点 `P`、以及 `c ≥ b` 可行场景构造、`JT-P07` 两点定椭圆与 `x=3` 交点、`JT-P08` 斜率之积轨迹含 `x ≠ 0` 排除与 `EC=2CF` 线性消元弦分点）、旋转椭圆焦点切线与 `"示意图"` `free_choice` 显式披露。
   - 接入 `packages/agent-core/src/deterministicProblemRoute.ts`、`packages/agent-core/src/index.ts`、`apps/web/src/agent/agentRunner.ts` 与 `apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts`（支持 `skillIds` 与 `conics` 工作区映射）。

## 2. RED → GREEN 实测证据

### 2.1 RED 失败基线

- 在 `packages/geometry-kernel/src/conic-line.test.ts` 扩充 `3` 项参数化/旋转焦点切线/两点拟合/定义域裁剪用例，新建 `packages/agent-core/src/solver/planarDrawing.test.ts`；实现前运行 Vitest 均按预期失败（导出缺失：`conicFoci is not a function`、`fitOriginConicThroughPoints is not a function`、`intersectParametricLineWithConic is not a function`、`planarDrawing` 尚不存在）。

### 2.2 最终代码改动后 GREEN 与全量实测（全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd exec -- vitest run packages/geometry-kernel/src/conic-line.test.ts packages/agent-core/src/solver/planarDrawing.test.ts --testTimeout=30000` | `conic-line.test.ts` **16 passed**、`planarDrawing.test.ts` **9 passed** |
| `npm.cmd run typecheck` | **exit 0** |
| `npm.cmd run lint` | **exit 0**（0 errors） |
| `npm.cmd run --workspace @draw/web build` | **exit 0** |
| `npm.cmd run eval:reliability -- --offline` | **exit 0** |
| `npm.cmd test -- --testTimeout=30000` | **534 passed (534) \| 5665 passed \| 1 todo (5666)** |
| `npm.cmd run test:docs -- --testTimeout=30000` | 提交前执行确认 |

## 3. 修改文件清单

- `packages/geometry-kernel/src/conics.ts`
- `packages/geometry-kernel/src/conic-line.ts`
- `packages/geometry-kernel/src/conic-parameters.ts`
- `packages/geometry-kernel/src/curve-intersections.ts`
- `packages/geometry-kernel/src/conic-line.test.ts`
- `packages/agent-core/src/solver/planarDrawing.ts`（新增）
- `packages/agent-core/src/solver/planarDrawing.test.ts`（新增）
- `packages/agent-core/src/deterministicProblemRoute.ts`
- `packages/agent-core/src/index.ts`
- `apps/web/src/agent/agentRunner.ts`
- `apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts`
- `docs/audit/2026-11-16-p4-planar-drawing/README.md`（新增）
