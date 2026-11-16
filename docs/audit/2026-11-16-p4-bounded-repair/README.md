# P4 / T12 有界局部修复、停滞拦截、原子资源账本与 Worker 取消证据

- **任务编号**：`T12`（P4 阶段，遵循 `implementation-task-ledger.json` DAG：`T06, T07, T08, T09, T10 → T12`）
- **提交信息**：`feat(repair): bound local graph repair and cancel stale work`
- **日期**：2026-11-16
- **目标**：建立结构化可靠性故障分类与停滞检测，防止重复候选循环、`capability_missing` 反复问模型、以及 `network`/`generation` 分步扣费导致的部分扣减；在 Geometry Worker 边界支持 `AbortSignal` 派发前拦截与在途取消，绝不把 `not-found`/`timeout`/`budget_exhausted` 映射为“数学无解”。

## 1. 交付内容

1. **结构化可靠性诊断、停滞跟踪与 SolveOutcome 口径保护**：
   - 新增 [`packages/agent-core/src/reliabilityDiagnostics.ts`](../../../packages/agent-core/src/reliabilityDiagnostics.ts)（经 [`packages/agent-core/src/index.ts`](../../../packages/agent-core/src/index.ts) 导出）：
     - 统一覆盖 `syntax_unsupported`、`missing_entity`、`binding_ambiguous`、`topology_invalid`、`residual_failed`、`unknown_numeric`、`stale`、`cancelled`、`transport_failure`、`capability_missing` 故障编码与优先修复动作；
     - `normalizeSolveOutcome` 强制固定 `provenUnsat: false`，绝不将 `timeout` / `not-found` / `budget_exhausted` 报告为无解或数学不可能；
     - `createRepairStagnationTracker` 按 `(candidateHash + failureSignature)`、残差/错误数进展以及不可恢复缺失能力判定停滞终止原因（`stagnant_candidate` / `no_progress` / `capability_missing`）。
2. **原子跨账本扣减与协调器停滞护栏**：
   - [`packages/agent-core/src/budget.ts`](../../../packages/agent-core/src/budget.ts)：新增 `Budget.consumeAll`，先校验全组账本余量与数量合法性后再统一扣减，任一项不足时零扣减；同步更新 [`apps/web/src/agent/fixtures/examRequestBudget.ts`](../../../apps/web/src/agent/fixtures/examRequestBudget.ts)、[`apps/web/src/agent/fixtures/examRunCoordinated.ts`](../../../apps/web/src/agent/fixtures/examRunCoordinated.ts) 与 [`apps/web/src/agent/modelPlanner.ts`](../../../apps/web/src/agent/modelPlanner.ts) 的重试计费。
   - [`packages/agent-core/src/coordinator.ts`](../../../packages/agent-core/src/coordinator.ts)：接入 `createRepairStagnationTracker` 与 `consumeAll`——遇到缺失能力或重复 `residual_failed` 候选签名立即终止，不再反复提问模型。
3. **Geometry Worker 取消信号与迟到响应丢弃**：
   - [`apps/web/src/agent/geometryWorkerClient.ts`](../../../apps/web/src/agent/geometryWorkerClient.ts) 与 [`apps/web/src/agent/geometryCompileStrategy.ts`](../../../apps/web/src/agent/geometryCompileStrategy.ts)：新增 `GeometryWorkerRequestEnvelope.signal` 支持：已取消请求不入队、进行中触发 `abort` 立即结算 `code: "cancelled"` 并清理挂起项，迟到回包由空的 `pending` 自动安全丢弃。

## 2. RED → GREEN 与全量验证记录

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| RED（实现前） | `npm.cmd exec -- vitest run packages/agent-core/src/coordinator.test.ts packages/agent-core/src/budget.test.ts apps/web/src/agent/geometryWorkerClient.test.ts packages/agent-core/src/reliabilityDiagnostics.test.ts --testTimeout=30000` | 按预期失败：`4 failed (4) \| 4 failed \| 70 passed (74)`（含 `reliabilityDiagnostics` 缺失、`consumeAll` 缺失、停滞/缺能力多调用与 Worker 取消超时） |
| 定向 GREEN（实现后） | 同上 4 文件 + `examRunCoordinated.test.ts` | `4 passed (4) \| 76 passed (76)` 及 `examRunCoordinated.test.ts` `15 passed (15)` |
| 全量 TypeScript 类型检查 | `npm.cmd run typecheck` | exit 0 |
| 全量 ESLint | `npm.cmd run lint` | exit 0（0 errors，33 pre-existing warnings） |
| Web 生产构建 | `npm.cmd run --workspace @draw/web build` | exit 0（639 modules） |
| 离线评测 | `npm.cmd run eval:reliability -- --offline` | `1 passed (1) \| 3 passed (3)` |
| 全量 Vitest 套件（最终编辑后） | `npm.cmd test -- --testTimeout=30000` | `537 passed (537) \| 5695 passed \| 1 todo (5696)` |
