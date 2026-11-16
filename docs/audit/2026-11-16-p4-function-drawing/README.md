# P4 / T08 证据：函数、符号导数定义域保留与竖直宿主动态依赖

- **日期**：2026-11-16
- **区块**：`B4 / T08`（`feat(function): preserve domains and host dependencies in drawing`）
- **依赖前置**：`T07`（`b71c813b`）、`T11`（`310d150a`）、`R07`

## 1. 解决的问题

1. **符号 AST 导数与未化简定义域保留（`packages/geometry-kernel/src/expression.ts`）**
   - 新增 `differentiateExpressionAst`（覆盖 `+ - * / ^` 与 `sin`/`cos`/`tan`/`exp`/`ln`/`log`/`log10`/`sqrt`/`sinh`/`cosh`/`tanh`/`asin`/`acos`/`atan` 复合链式法则；对 `abs`、`floor` 等不可导或未知算子返回 `null` 而不以有限差分伪装精确结果）。
   - 新增 `evaluateFunctionWithDomain` 与 `evaluateSymbolicDerivative`：保留未化简 AST 定义域（`x/x` 在 `x=0` 仍拒收、`sqrt(x)` 在 `x ≤ 0` 的导数明确报 `domain_violation`，`abs(x)` 明确报 `unsupported_derivative`）。
2. **间断拆分、外点切线边界/不可导拒收与域变更失效（`calculus.ts`、`function-evidence.ts`、`diagramVerification.ts`）**
   - `calculus.ts`：`isDiscontinuousInterval` 加密至 7 个内点探针并识别斜率/跨零极点跃变，确保奇数步长及非格点极点（如 `1/(x-0.37)` `steps=33`）与 `sqrt(x)` (`x<0`) 不跨间断连线。
   - `function-evidence.ts`：`compiledOrNull` 统一接入 `evaluateFunctionWithDomain`；`differentiabilityAt`、`tangentsFromPoint` 与 `verifyTangentLine` 绑定符号可导性与定义域检验，显式输出 `searchInterval` 并包含边界切点，同时直接拒绝 `abs(x)` 尖点伪水平切线及不支持求导算子的外点切线请求；新增 `invalidateEvidenceOnDomainChange` 在数学定义域变化时将旧证据标为 `stale: true`。
   - `diagramVerification.ts`：将 `derivativeAt` 从中心有限差分改为 `evaluateSymbolicDerivative`，确保 `tangentAt` 遇到不支持求导算子或定义域边界越界时诚实落回未核验/拒收，不拿差分值通过。
3. **竖直宿主参数锁定与渲染窗口/数学域隔离（`planar-constraints.ts`）**
   - 新增 `VerticalLineHostConstraint` 与 `verticalLineConstraint(id, xConstant, { mathDomain, displayRange })`：将 `mathDomain` 与 `displayRange` 解耦，拖动 `P(t) = (-1, t)`（`JT-P02` 双曲线 `x²/4 - y²/16 = 1` 动点）跨越 `[-8, 8]` 展示框时仍严格按参数 `t` 锁定在 `x = -1`，并通过 `createReactiveGraph` 驱动下游焦点/割线交点 `M, N` 与共线定点 `(-4, 0)` 零漂移重算。

## 2. RED → GREEN 实测证据

### 2.1 RED 失败基线

- 在 `packages/geometry-kernel/src/function-evidence.test.ts` 新增 5 项、新建 `packages/agent-core/src/solver/functionDrawing.test.ts`（4 项）；实现前运行 Vitest 均按预期失败（**2 files failed | 8 failed | 20 passed (28)**：`evaluateFunctionWithDomain`、`evaluateSymbolicDerivative`、`invalidateEvidenceOnDomainChange`、`verticalLineConstraint` 缺失及 `searchInterval` 未输出）。

### 2.2 最终代码改动后 GREEN 与全量实测（全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd exec -- vitest run packages/geometry-kernel/src/function-evidence.test.ts packages/agent-core/src/solver/functionDrawing.test.ts packages/agent-core/src/diagramVerification.test.ts --testTimeout=30000` | **3 passed (3) \| 98 passed (98)**（含 `JT-P02` 10 次跨展示窗拖拽与 `(-4, 0)` 定点零漂移） |
| `npm.cmd run typecheck` | **exit 0** |
| `npm.cmd run lint` | **exit 0**（0 errors） |
| `npm.cmd run --workspace @draw/web build` | **exit 0** |
| `npm.cmd run eval:reliability -- --offline` | **exit 0** |
| `npm.cmd test -- --testTimeout=30000` | **535 passed (535) \| 5674 passed \| 1 todo (5675)** |
| `npm.cmd run test:docs -- --testTimeout=30000` | 提交前执行确认 |

## 3. 修改文件清单

- `packages/geometry-kernel/src/expression.ts`
- `packages/geometry-kernel/src/calculus.ts`
- `packages/geometry-kernel/src/function-evidence.ts`
- `packages/geometry-kernel/src/planar-constraints.ts`
- `packages/agent-core/src/diagramVerification.ts`
- `packages/geometry-kernel/src/function-evidence.test.ts`
- `packages/agent-core/src/solver/functionDrawing.test.ts`（新增）
- `docs/audit/2026-11-16-p4-function-drawing/README.md`（新增）
