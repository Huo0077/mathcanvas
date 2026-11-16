# P5 / T11 证据：可版本化尺度感知数值策略与退化分类

- **日期**：2026-11-16
- **区块**：`B4基础 / T11`（`fix(numeric): version scale-aware residual and degeneracy policies`）
- **依赖前置**：`T02`（`a70152aa`）、`T03`（`0143f62e`）

## 1. 解决的问题

1. **三层无量纲残差与可版本化数值策略（`packages/geometry-kernel/src/numeric.ts`）**
   - 新增明确策略版本号 `NUMERIC_POLICY_VERSION = "num-policy-v1"`，区分 `topological_sign`（拓扑符号）、`metric_error`（度量误差）与 `solver_residual`（求解残差）三层，并导出 `characteristicScale`、`normalizedLengthResidual`、`normalizedPlaneDistanceResidual`、`normalizedPerpendicularResidual`、`normalizedParallelResidual` 与误差带跨阈值判定 `classifyUncertaintyInterval`。
   - 对零长方向向量、零法向、非正特征尺度及 `NaN`/`Infinity` 明确判为 `degenerate`，在误差区间跨越容差阈值时诚实返回 `unknown`，绝不强行 `satisfied`。
2. **修复 `conic-line.ts` 在大尺度（`10³`）下的相切抵消漏洞并统一尺度基准**
   - RED 实测捕获真实数值漏洞：当椭圆半轴处于 `s = 1000` 尺度且切线用单位步长端点 `((-1, 1000), (1, 1000))` 参数化时，原 `evaluate` 直接求和会先算 `2.5e-7 + 1 - 1` 丢失尾数精度，同时 `rootScale` 固定下界 `1` 未跟踪椭圆尺度，导致真切线误判为 `none`。
   - 引入 Neumaier 补偿求和 `compensatedSum`、直线最近原点投影平移与单位方向参数化，并以 `conicCharacteristicScale(conic)` 锚定 `rootScale` 与方向退化阈值，同时保持 `localEvidence` 既有单位尺度一阶残差口径（保护 `pointOnConic.test.ts` 既有 `(3,2)` 椭圆上 `(0,1)` `0.75` 精确断言不回归）。
3. **`exact-forms.ts`、`solid-builders.ts` 与 `diagramVerification.ts` 策略对齐**
   - `exact-forms.ts` 导出 `EXACT_FORM_POLICY_VERSION = "exact-form-v1"` 并保有 `NaN`/`Infinity` 非有限返回 `residual: null` 守卫。
   - `solid-builders.ts` 在整体验证四面体/多面体共面退化时改用尺度感知阈值 `span * 1e-9`（取代固定绝对 `1e-10`）。
   - `diagramVerification.ts` 导出 `DIAGRAM_NUMERIC_POLICY_VERSION` 对齐同一数值策略版本。

## 2. RED → GREEN 实测证据

### 2.1 RED 失败基线

- 新增 `packages/geometry-kernel/src/numericRobustness.test.ts`（5 项：版本与退化拒绝、`10⁻³/1/10³` 三尺度无量纲一致性、跨阈值 `unknown`、三尺度切线/浅割线/相离、`buildFromPoints` 三尺度正反例）。
- 实现前运行 Vitest 失败退出码 `1`：**`4 failed | 1 passed (5)`**（除 `NUMERIC_POLICY_VERSION` / 无量纲函数未导出外，实测确认 `tangent at scale 1000: expected 'none' to be 'tangent'`）。

### 2.2 最终代码改动后 GREEN 与全量实测（全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd exec -- vitest run packages/agent-core/src/pointOnConic.test.ts packages/geometry-kernel/src/numericRobustness.test.ts packages/geometry-kernel/src/conic-line.test.ts --testTimeout=30000` | **3 passed (3) / 22 passed (22)** |
| `npm.cmd run typecheck` | **exit 0** |
| `npm.cmd run lint` | **exit 0**（0 errors） |
| `npm.cmd run --workspace @draw/web build` | **exit 0** |
| `npm.cmd run eval:reliability -- --offline` | **exit 0** |
| `npm.cmd test -- --testTimeout=30000` | **533 passed (533) \| 5653 passed \| 1 todo (5654)** |
| `npm.cmd run test:docs -- --testTimeout=30000` | 见提交前文档校验执行结果 |

## 3. 修改文件清单

- `packages/geometry-kernel/src/numeric.ts`
- `packages/geometry-kernel/src/exact-forms.ts`
- `packages/geometry-kernel/src/conic-line.ts`
- `packages/geometry-kernel/src/solid-builders.ts`
- `packages/agent-core/src/diagramVerification.ts`
- `packages/geometry-kernel/src/numericRobustness.test.ts`（新增）
- `docs/audit/2026-11-16-p5-numeric-robustness/README.md`（新增）
