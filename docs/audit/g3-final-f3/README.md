# G3-DS Task F3 审计记录：实体图 `EntityGraph`、约束图 `ConstraintGraph` 与三态观察

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；当前真实 DS 36 题成绩仍为 `0/36`（[Task F0 真源基线](../../g3-final/retests/2026-11-17-92981/README.md)）。

## 1. 本轮改动与实现核对

1. **实体依赖图与作用域继承判定（[entityGraph.ts](../../../packages/agent-core/src/entityGraph.ts) & [entityGraph.test.ts](../../../packages/agent-core/src/entityGraph.test.ts)）**
   - 实现可序列化与可回放的 `EntityNode` / `EntityGraph`（`declared | derived | resolved | blocked`、`sourceRefs`、`candidateHash` 绑定）。
   - `resolveEntityScopeAccess` 区分合法共享/父问依赖继承（`accepted`）、附原话来源的未声明实体占位（`repairable`）与无来源或无关联跨问引用（`blocked`）。
2. **约束图、待求参数与三态内核观察（[constraintGraph.ts](../../../packages/agent-core/src/constraintGraph.ts)、[kernelObservation.ts](../../../packages/agent-core/src/kernelObservation.ts)、[constraintGraph.test.ts](../../../packages/agent-core/src/constraintGraph.test.ts)）**
   - 实现 11 类闭集 `ConstraintKind`、`6` 态 `ConstraintStatus` 与待求参数表 `PendingParameterVar`（区分可通过方程求出的 `solvable` 与无依据缺失参数），支持 JSON 序列化回放。
   - 新增 `buildKernelObservation` 汇总实体的 `status`、`constraintReadings`、残差与阻断原因。
3. **`obligationIR.ts` 与 `dsDrawingIntent.ts` 接入（[obligationIR.ts](../../../packages/agent-core/src/obligationIR.ts) & [dsDrawingIntent.ts](../../../packages/agent-core/src/dsDrawingIntent.ts)）**
   - 导出 `buildConstraintGraphFromObligationIR` 将统一数学 IR 转为 `ConstraintGraph`。
   - 导出 `classifyDsIntentTriState`，使 `DsDrawingIntent` 在不放松 `compileDsDrawingIntentToPlan` 严格执行门禁的前提下，能够区分 `accepted` / `repairable` / `blocked`（题图缺失或硬矛盾一律 `blocked`）。

## 2. 实测验证结果

- `vitest run packages/agent-core/src/entityGraph.test.ts packages/agent-core/src/constraintGraph.test.ts packages/agent-core/src/dsDrawingIntent.test.ts packages/agent-core/src/obligationIR.test.ts --testTimeout=30000`：**`4` 文件 `33 passed`**（`entityGraph.test.ts` `2`、`constraintGraph.test.ts` `2`、`obligationIR.test.ts` `17`、`dsDrawingIntent.test.ts` `12`）
- `npm.cmd run typecheck`：退出 `0`（全工作区 + `e2e` + `scripts` 通过）
- `npm.cmd run lint`：**`0 errors`**（`34 warnings`）
- `npm.cmd run test:docs -- --testTimeout=30000`：更新全量进度/门禁/CHANGELOG 后补跑核验

## 3. 下一步

- 推进 **Task F4（二维与函数内核求解器 `constraintSolve2d.ts`）**。
