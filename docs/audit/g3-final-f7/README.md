# G3-DS Task F7 审计记录：定向局部修复与单调停机闭环 `repairProgress`

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；当前真实 DS 36 题成绩仍为 `0/36`（[Task F0 真源基线](../../g3-final/retests/2026-11-17-92981/README.md)）。

## 1. 本轮改动与实现核对

1. **定向修复进度与单调停机追踪器（[repairProgress.ts](../../../packages/agent-core/src/repairProgress.ts) & [repairProgress.test.ts](../../../packages/agent-core/src/repairProgress.test.ts)）**
   - 实现 `createTargetedRepairTracker` 与 `formatTargetedRepairSummary`，显式区分 `targetEntities`、`targetConstraintIds` 与锁定不准回退的 `preservedObligationIds`。
   - 满足以下任一停机判据即终止修复并返回结构化原因：`satisfied`、`no_progress`（失败条数与残差均未单调下降）、`stagnant_signature`（重复签名）、`preserved_obligation_regressed`（新候选破坏已通过条款）或 `max_rounds_reached`（达轮次上限）。
2. **协调器、账本与规划器全链路接入（[coordinator.ts](../../../packages/agent-core/src/coordinator.ts)、[coordinatorPorts.ts](../../../packages/agent-core/src/coordinatorPorts.ts)、[runState.ts](../../../packages/agent-core/src/runState.ts)、[modelPlanner.ts](../../../apps/web/src/agent/modelPlanner.ts) & [index.ts](../../../packages/agent-core/src/index.ts)）**
   - `RunLedger` 新增有界记录 `recordRepairProgress`，在不篡改状态机转移表的前提下留痕每轮修复收敛状况。
   - `PlanRequest.repair.targetedScope` 将失败实体/约束与已锁定条款注入下一次规划提示词，防止修复阶段“拆东墙补西墙”或无限重试。

## 2. 实测验证结果

- `vitest run packages/agent-core/src/repairProgress.test.ts packages/agent-core/src/coordinator.test.ts packages/agent-core/src/runState.test.ts apps/web/src/agent/modelPlanner.test.ts --testTimeout=30000`：**`4` 文件 `154 passed`**（`repairProgress.test.ts` `4`、`runState.test.ts` `27`、`coordinator.test.ts` `53`、`modelPlanner.test.ts` `70`）
- `npm.cmd run typecheck`：退出 `0`（全工作区 + `e2e` + `scripts` 通过）
- `npm.cmd run lint`：**`0 errors`**（`34 warnings`）
- `npm.cmd run test:docs -- --testTimeout=30000`：随全套文档更新一并核验

## 3. 下一步

- 推进 **Task F8（真实画布交付一致性与 E2E/全仓终态门禁，停在 Task F9 付费授权前）**。
