# G3-DS 失败驱动 Task 2：施工单数学必要参数来源校验与编译 fail-closed（零付费）

- **日期**：2026-11-17
- **性质**：零新增付费 API 调用（`DsDrawingIntent` 参数来源核验与 DAG 编译拒绝防退回；严格拒收缺参施工单后历史 `nonzeroCandidate` 可能下降，**不得误判为能力退化或改善**，真实 DS 成绩仍为 `0/36`）

## 1. 交付产物

1. **数学必要参数表与来源核验 [dsDrawingIntent.ts](../../../packages/agent-core/src/dsDrawingIntent.ts)**：
   - 新增 `validateRequiredParameters(intent)`（并由 [index.ts](../../../packages/agent-core/src/index.ts) 重导出），针对全部 `8` 类 `DS_CONSTRUCTION_STRATEGIES` 建立数学必要参数规则与来源守卫，返回 `{ ok: true } | { ok: false, code: "missing_required_parameter" | "unsupported_construction" | "unproven_parameter", path: string }`。
   - **彻底移除静默假图默认值**：消除 `function_curve_and_tangent` 中缺失 `expression` / `x0` / `domain` 时偷偷代用 `"x"`、`0`、`[-5, 5]` / `[-3, 3]` 的旁路；无 `sourceSpan`、`assumptions` 且无合法推导来源的参数统一拒为 `unproven_parameter`。
   - **DAG 失败 fail-closed**：`compileDsDrawingIntentToPlan` 遇到 `!dag.ok`（`cyclic_dependency`、`missing_host`、`cross_scope_violation` 等）或 `!validateRequiredParameters(intent).ok` 时**严禁退回未排序的 `intent.constructionStrategies`**，直接返回带精确诊断码/路径与零动作的 `clarification` 拒绝，绝不生成看似合理的伪直线或错图。
2. **系统提示词来源约束对齐 [systemPrompt.ts](../../../apps/web/src/agent/systemPrompt.ts)**：
   - 在 `buildDsIntentPolicyText` 明确要求数学必要参数必须注明 `sourceSpan`、前序推导或显式可审查 `assumptions`，缺参先在 `unknowns` 标出并转澄清，严禁用 `0`、`"x"` 或 `[-5, 5]` 充数。

## 2. 验证结果

- RED → GREEN 定向实测（[dsDrawingIntent.test.ts](../../../packages/agent-core/src/dsDrawingIntent.test.ts)）：先观测缺失 `expression`/`x0`/`domain` 与 `cyclic_dependency` 退回原顺序 2 项 RED 失败，修复后全数转 GREEN。
- `npm.cmd exec -- vitest run packages/agent-core/src/dsDrawingIntent.test.ts packages/agent-core/src/planCompiler.subquestionCoverage.test.ts apps/web/src/agent/modelPlanner.test.ts scripts/reliability-eval/planarContracts18.test.ts --testTimeout=30000`：**`4` 文件 / `110 passed (110)`**（另 [systemPrompt.test.ts](../../../apps/web/src/agent/systemPrompt.test.ts) 在同版提示词修改后通过 **`31 passed`**）：
  - `dsDrawingIntent.test.ts`（`9/9`）：覆盖 `expression` / `x0` / `domain` 缺失拒收、`unproven_parameter`、以及 `cyclic_dependency` / `missing_host` / `cross_scope_violation` 在 `parseAndValidateDsDrawingIntent` 与 `compileDsDrawingIntentToPlan` 双层均 fail-closed；
  - `modelPlanner.test.ts`（`69/69`）：验证原生工具 `ds_intent` 缺 `x0` 精确回传 `missing_required_parameter` 及 `.params.x0` 路径给协调器；
  - `planCompiler.subquestionCoverage.test.ts`（`9/9`）与 `planarContracts18.test.ts`（`23/23`，含 `GK-P08` `objCov=1, obCov=0` 类表面图元齐全但义务未过负例守卫）全过。
- `npm.cmd run typecheck`：`6` 工作区与 `e2e/tsconfig.json`、`scripts/tsconfig.json` 全过（exit `0`）。
- `npm.cmd run lint`：exit `0`（`0 errors`，`34 warnings`）。
- 下一步进入 **Task 3**（以 26 题零候选与 10 题错误候选实际失败签名为准补全通用能力族：`GK-S05`、`GK-P03`、`JT-P02` 等与 `GK-P08` 表面齐全反例，零付费回放）。
