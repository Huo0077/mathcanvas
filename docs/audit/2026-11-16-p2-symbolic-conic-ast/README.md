# P2 / T04 证据：表达式 AST、定义域保留与符号圆锥曲线契约

- **日期**：2026-11-16
- **区块**：`B4 / P2 / T04`（`feat(parser): retain domains in symbolic conic contracts`）
- **依赖前置**：`T01`（`246b90e7`）、`T02`（`a70152aa`）、`T03`（`0143f62e`）

## 1. 解决的问题

1. **LaTeX 高次幂与嵌套分式降级（`latexNormalisation.ts`）**
   - 修复 `/\\(?:[dt]?frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g` 无法拆解内部带花括号 `\frac{x^{2}}{m^{2}}` 的缺陷，将带括号指数（`^{2}` → `²`、`^{\circ}` → `°`、`^{4}` → `^4`、`^{3}` → `^3`、`^{n}` → `^n`）移入 `lowerMathGroupsTracked` 迭代降级环内并修正闭括号 `origEnd` 追踪，同时在 `groupOperandTracked` 保留单项幂原子（`x²/m²`、`x²/a²`），确保 `$x^{4}-2x^{3}$`、`\frac{1}{1+\frac{1}{x}}` 与 `GK-P08`（`y²-x²/m²=1(m>0)`）及 `sourceMap` 往返准确。
2. **有界安全表达式 AST 与显式定义域（`packages/geometry-kernel/src/expression.ts`）**
   - 保持零动态执行（零 `eval` / `new Function`，已由 `drawingContracts.test.ts` 静态源码扫描钉住），新增长度预算（`MAX_EXPRESSION_LENGTH = 512`）与递归深度预算（`MAX_EXPRESSION_DEPTH = 24`）。
   - 扩展词法与解析支持 Unicode 上标（`²³⁴…`）、`−`/`×`/`·`/`√`/`π` 与安全隐式乘法（保留未知函数名如 `foo(x)` / `alert(x)` 拒收语义）。
   - 新增 `extractExpressionDomains`、`evaluateExpressionWithDomain`、`parseRelationConstraint` 与 `evaluateRelationConstraint`：未化简 AST 直接提取 `nonzero`（`/` 及负整数幂，严禁把 `x/x` 化简成 `1` 而丢失 `x≠0`）、`nonnegative`（`sqrt`）、`positive`（`ln/log/log10/log_b`），支持 `a>b>0` / `m>0` 链式不等式解析并拒绝混合方向不等式与 `x=0`/`sqrt(-1)`/`ln(0)` 越界求值。
3. **一般化符号圆锥曲线解析、求解与独立校验（`packages/geometry-kernel/src/conic-parameters.ts`）**
   - 新增 `parseSymbolicConicEquation` 与 `solveSymbolicConicContract`，区分椭圆（`+`）与双曲线（`-`）、识别轴向与轴对调（`x²/a²+y²/b²=1` vs `y²/a²+x²/b²=1` vs `x²/b²+y²/a²=1` 在 `a>b>0` 下的主轴归属）、拒绝 `a<=0`/`b<=0` 等非正半轴定义域、在欠定时（如仅给离心率未给尺度）明确返回 `status: "underdetermined"` 绝不替题面猜 `a=2`。
   - 对 `GK-P01`（`a=2, b=√2, c=√2`）与 `GK-P08` 等一般双曲线渐近线与圆相切问题，通过一般二次切距方程求解正参数并用内核 `conicResidualAt`、偏心率/焦距恒等式与切点代回圆方程、渐近线方程完成独立校验（零题号或固定答案硬编码）。
4. **parser / IR / verifier 全链打通（`diagramObligations.ts`、`claimEvidence.ts`、`obligationIR.ts`、`diagramVerification.ts`）**
   - 在 `resolveSymbolicConics` 中于常规正则与 `resolveFocusEccentricity` 之前处理符号圆锥曲线（纯数字圆锥曲线保持原路径零扰动），产出带原文精确区间与实体关联的 `parameterDomain` 与已解 `conicAxes` / 欠定 `symbolicConic`（`judgeability: "ambiguous"`），完整保留 `geometry.domain` 与 `geometry.symbolicConic` 并通过 `toLegacyObligationSet` 无损还原；单问 off-path 黄金基线保持零字节漂移。

## 2. RED → GREEN 实测证据

### 2.1 RED 失败基线

- 新增/扩展测试：`packages/agent-core/src/latexNormalisation.chain.test.ts`（+2）、`packages/agent-core/src/obligationIR.test.ts`（+3）、`packages/agent-core/src/symbolicConicContract.test.ts`（+8）、`scripts/reliability-eval/drawingContracts.test.ts`（+1 静态 `eval`/`new Function` 守卫）。
- 实现前运行 Vitest：`3 files failed | 1 passed (4)`，**`12 failed | 28 passed (40)`**：
  - `latexNormalisation.chain.test.ts` 2 项按预期因 `^{4}/^{3}` 与 `\frac{x^{2}}{m^{2}}` 未降级失败；
  - `symbolicConicContract.test.ts` 7 项按预期因 AST 域提取/预算/关系链/符号圆锥求解未实现失败；
  - `obligationIR.test.ts` 3 项按预期因 `GK-P01`、`GK-P08` 与欠定椭圆未识别 `parameterDomain`/`symbolicConic`/`conicAxes` 失败。

### 2.2 最终代码改动后 GREEN 与全量实测（全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd exec -- vitest run packages/agent-core/src/latexNormalisation.chain.test.ts packages/agent-core/src/latexNormalisation.test.ts packages/agent-core/src/obligationIR.test.ts packages/agent-core/src/symbolicConicContract.test.ts packages/geometry-kernel/src/expression.test.ts packages/geometry-kernel/src/conic-parameters.test.ts packages/agent-core/src/diagramObligations.test.ts packages/agent-core/src/diagramVerification.test.ts packages/agent-core/src/planCompiler.offPath.golden.test.ts --testTimeout=30000` | **9 passed (9) / 252 passed (252)**（随后将无 Node 依赖源码扫描迁至 `drawingContracts.test.ts` 并重跑全量） |
| `npm.cmd run typecheck` | **exit 0**（含 `@draw/agent-core` 无 Node 类型污染检查） |
| `npm.cmd run lint` | **exit 0**（0 errors；仅有既有 33 warnings） |
| `npm.cmd run --workspace @draw/web build` | **exit 0** |
| `npm.cmd run eval:reliability -- --offline` | **exit 0** |
| `npm.cmd test -- --testTimeout=30000` | **529 passed (529) \| 5634 passed \| 1 todo (5635)** |
| `npm.cmd run test:docs -- --testTimeout=30000` | 见提交前文档校验执行结果 |

## 3. 修改文件清单

- `packages/agent-core/src/latexNormalisation.ts`
- `packages/geometry-kernel/src/expression.ts`
- `packages/geometry-kernel/src/conic-parameters.ts`
- `packages/agent-core/src/claimEvidence.ts`
- `packages/agent-core/src/obligationIR.ts`
- `packages/agent-core/src/diagramObligations.ts`
- `packages/agent-core/src/diagramVerification.ts`
- `packages/agent-core/src/latexNormalisation.chain.test.ts`
- `packages/agent-core/src/obligationIR.test.ts`
- `packages/agent-core/src/symbolicConicContract.test.ts`（新增）
- `scripts/reliability-eval/drawingContracts.test.ts`
- `docs/audit/2026-11-16-p2-symbolic-conic-ast/README.md`（新增）
