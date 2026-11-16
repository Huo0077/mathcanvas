# P3 / T05 证据：稳定多实体绑定、同向向量比与忠实原文诊断

- **日期**：2026-11-16
- **区块**：`B4 / P3 / T05`（`fix(binding): bind obligations to stable entities and original source spans`）
- **依赖前置**：`T01`（`246b90e7`）、`T02`（`a70152aa`）、`T03`（`0143f62e`）、`T04`（`85321cec`）

## 1. 解决的问题

1. **多实体稳定绑定与歧义/跨作用域拒收（`diagramVerification.ts`、`planCompiler.ts`、`diagramObligations.ts`、`claimEvidence.ts`、`obligationIR.ts`）**
   - 用 `candidateConics` 与统一解析器 `selectConicForObligation` 取代仅取单条 `candidateConic` 的猜测路径；支持 `entityBindings` / `entityScopes` / `activeScopeId` / `activeStateId` 与题面曲线标签归并（`normalizeConicLabel` 兼容 `"双曲线C"` 与 `"C"` 写法，同时保留 `pointOnConic` 在单条异族曲线时直接判 `failed` 的语义）。
   - 对重复/未命名多候选明确返回 `unverified`（`code: "binding_ambiguous"`），对缺失绑定实体返回 `code: "entity_missing"`，对跨小问或跨状态同名实体返回 `code: "binding_scope_mismatch"`，绝不按数组顺序或尺寸挑第一条；在多椭圆调序或存在辅助圆时均绑定到稳定实体。
   - 在 `planCompiler.ts` 为新建图元提取无歧义的唯一标签映射并在 `verifyDiagramObligations` 中传递 `entityBindings` 与 `activeScopeId`。
   - 同步放宽 `x²/4+y²=1` 隐式 `1` 分母与 `P 是椭圆 C 上一点` 标签捕获，使 `JT-P03`、`JT-P07` 等带标签与省略 `/1` 的真题曲线完整通过与绑定。
2. **修复 `JT-P08` 同向向量数乘静默漏检与误读（`diagramObligations.ts`）**
   - 新增 `resolveDirectedVectorRatios`，先于 `parseLengthChains` 与常规正则消费 `向量EC=2向量CF`：正确识别为 `segmentRatio`（`targets: ["E","C","C","F"]`, `value: 2`, `splitPoint: true`），消除此前误将 `EC=2` 读成固定长度或漏检比例的漏洞，经真解/反例候选文档验证 `passed`/`failed` 分离。
3. **忠实原文诊断与无空白遮蔽残留（`diagramObligations.ts`、`obligationIR.ts`）**
   - 修复残留扫描将已消费区域替换为空格字符 `" "` 后直接当作 `sourceText` 展示给用户的缺陷（如 `"若双曲线…与圆            相切"`）；始终保留原句 `sourceText`，单独输出 contiguous `!used` `unrecognizedSpans`、`recognizedEntities` 与具体 `reasonCode`（`symbolic_conic_tangency_unverified`、`nonstandard_curve_out_of_scope`、`invalid_symbolic_domain`、`point_outside_curve` 等），并在 `GK-P08` 部分识别场景下明确给出 `"圆已识别；符号双曲线/渐近线相切尚未核验。"`。

## 2. RED → GREEN 实测证据

### 2.1 RED 失败基线

- 新增测试：`packages/agent-core/src/diagramEntityBinding.test.ts`（7 项）与 `packages/agent-core/src/diagramSourceDiagnostics.test.ts`（2 项）。
- 实现前运行 Vitest：`2 files failed (2)`，**`7 failed | 2 passed (9)`**：
  - `diagramEntityBinding.test.ts` 5 项按预期失败（多椭圆与辅助圆并发返回 `unverified`、重复椭圆缺少 `binding_ambiguous`、跨 scope 返回 `passed`、`JT-P07` 失败、`JT-P08` 误判 `EC=2`）；
  - `diagramSourceDiagnostics.test.ts` 2 项按预期失败（`sourceText` 含 `'圆            相切'` 空白残留、缺少 `reasonCode`）。

### 2.2 最终代码改动后 GREEN 与全量实测（全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd exec -- vitest run packages/agent-core/src/conicFromFocusEccentricity.test.ts packages/agent-core/src/pointOnConic.test.ts packages/agent-core/src/diagramEntityBinding.test.ts packages/agent-core/src/diagramSourceDiagnostics.test.ts packages/agent-core/src/diagramVerification.test.ts --testTimeout=30000` | **5 passed (5) / 94 passed (94)** |
| `npm.cmd run typecheck` | **exit 0** |
| `npm.cmd run lint` | **exit 0**（0 errors；仅既有 33 warnings） |
| `npm.cmd run --workspace @draw/web build` | **exit 0** |
| `npm.cmd run eval:reliability -- --offline` | **exit 0** |
| `npm.cmd test -- --testTimeout=30000` | **531 passed (531) \| 5643 passed \| 1 todo (5644)** |
| `npm.cmd run test:docs -- --testTimeout=30000` | 见提交前文档校验执行结果 |

## 3. 修改文件清单

- `packages/agent-core/src/claimEvidence.ts`
- `packages/agent-core/src/obligationIR.ts`
- `packages/agent-core/src/diagramObligations.ts`
- `packages/agent-core/src/diagramVerification.ts`
- `packages/agent-core/src/planCompiler.ts`
- `packages/agent-core/src/diagramEntityBinding.test.ts`（新增）
- `packages/agent-core/src/diagramSourceDiagnostics.test.ts`（新增）
- `docs/audit/2026-11-16-p3-entity-binding-diagnostics/README.md`（新增）
