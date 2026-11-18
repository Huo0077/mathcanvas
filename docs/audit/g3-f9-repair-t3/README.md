# G3-F9 内核动作修复 Task 3 审计记录：有界反馈、停滞熔断与预算统一（0 新增付费）

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；仅落地动作级工具回执签名、无进展停滞拦截与外/内部预算不双扣修正，真实 DS 仍未重测。

## 1. 本轮改动与实现核对

1. **工具统一回执签名（[dsActionTools.ts](../../../apps/web/src/agent/dsActionTools.ts) & [dsActionTools.test.ts](../../../apps/web/src/agent/dsActionTools.test.ts)）**
   - `DsActionExecutionResult` 新增 `toolName` 与 `progressSignature`（统一于出口 `attachTelemetry` 注入）。
2. **有界停滞熔断与外部网络预算不双扣（[modelPlanner.ts](../../../apps/web/src/agent/modelPlanner.ts) & [modelPlanner.test.ts](../../../apps/web/src/agent/modelPlanner.test.ts)）**
   - `ds_action` 循环直接以 `execRes.progressSignature` 判定停滞：连续相同错误参数或虚报推进在 `<= 2` 次内立即 `no_progress` 熔断，同时允许先缺失参数再补齐参数的合法修复正常收敛至 `finish_candidate`。
   - 当调用方通过 `beforeProviderRequest` 在每次请求前原子扣减 `network` 配额时，`ds_action` 续步不再重复二次扣减 `budget.network`（消除 `internal_budget` 伪耗尽），而硬闸仍在每一次传输前生效。

## 2. 实测验证结果

- `vitest run apps/web/src/agent/dsActionTools.test.ts apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts --testTimeout=30000`：**`3` 文件 `83 passed`**
- `npm.cmd run typecheck`：退出 `0`
- `npm.cmd run lint`：**`0 errors`**
- `npm.cmd run test:docs -- --testTimeout=30000`：随文档更新一并核验

## 3. 下一步

- 推进 [G3-F9 内核动作修复计划](../../g3-final/G3-F9-kernel-action-repair-plan.md) **Task 4（真实 Live 多问 / 多状态 / 多分支 `CandidateSet` 接线与 `Evaluator` 对齐）**。
