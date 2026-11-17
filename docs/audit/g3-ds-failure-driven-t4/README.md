# G3-DS 失败驱动 Task 4：多问/多状态/多分支同版评测入口 `g3DsFrozenCaseRunner`（零付费）

- **日期**：2026-11-17
- **性质**：零新增付费 API 调用（统一多态/多分支/多小问生产证书与独立合同评测入口，去除 `MODE === "local"` 口径分叉；**不修改容差，不重写历史 `0/36` 基线**）

## 1. 交付产物与核心发现

1. **统一策略裁判入口 [drawingContracts.ts](../../../scripts/reliability-eval/drawingContracts.ts)**：
   - 新增 `evaluateDrawingContractSetByPolicy(contract, slices)`：按 `contract.displayPolicy` 自动调度 `evaluateDrawingContractStates`、`evaluateDrawingContractBranches`、`evaluateDrawingContractScopes` 或单候选 `evaluateDrawingContract`，彻底解除此前仅在 `MODE === "local"` 才核验多态/多分支的分叉，同时**零改动既有几何容差与判据**。
2. **公私严格隔离的多候选统一评测器 [g3DsFrozenCaseRunner.ts](../../../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts)**：
   - `projectPublicFrozenCaseInput` 仅白名单投影 `{ id, prompt, confirmedFigureRefs, workspace }` 传入规划器/协调器，彻底杜绝 `requiredObligations`、`expected`、`requiredEntityIds` 或黄金答案泄漏；同步收紧 [examRunCoordinated.ts](../../../apps/web/src/agent/fixtures/examRunCoordinated.ts) 公共输入边界。
   - `runFrozenDsCase` 对 `candidateSet` 每个独立切片单独在隔离文档内编译并计算 `canonicalContentHash`、调用生产级 `certifyDrawingAgainstContract`（并自动规范化 `(2)`/`(Ⅱ)` 至 `subquestion:2` 以修复多问证书在生产门禁里误落 `"各小问的条件"` 阻断的真缺陷），随后汇总送交 `evaluateDrawingContractSetByPolicy`；**只要任一切片生产证书未过或候选哈希篡改/过期，即使数学几何通过，整题仍判失败（`failed`）**。
   - `renderStatus` 与 `commitStatus` 保持诚实 `"pending"`，直到 Task 5 同候选浏览器与受控交付闭环。
   - 提供 `compareLegacySingleVsMultiSliceReplay` 进行新旧入口零成本回放对照，绝不追溯修改历史 `0/36`。

## 2. 验证结果

- RED → GREEN（先在 [g3DsFrozenCaseRunner.test.ts](../../../apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts) 观察缺模块 RED，再补齐实现并通过；期间额外实证曝光并修复了 `(2)` 作用域传给生产证书时的格式失配与单切片哈希篡改仅降 `partial` 问题）：
- `npm.cmd exec -- vitest run apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts scripts/reliability-eval/drawingContracts.test.ts apps/web/src/agent/fixtures/examRunCoordinated.test.ts --testTimeout=30000`：**`3` 文件 / `65 passed (65)`**：
  - `g3DsFrozenCaseRunner.test.ts`（`3/3`）：覆盖公有字段无泄漏投影、`GK-P06` 三分支（`zero/positive/negative`）全过及删分支（`incomplete`）/只画主图/篡改 `candidateHash` 整题 `failed`、`JT-S04` 交换 `before_fold/after_fold` 失败、`JT-S08` 缺 `t1` 判 `incomplete` 与新旧回放对照；
  - `drawingContracts.test.ts`（`46/46`）与 `examRunCoordinated.test.ts`（`16/16`）全过。
- `npm.cmd run typecheck`：6 工作区与 `e2e`/`scripts` 全过（exit `0`）。
- `npm.cmd run lint`：exit `0`（`0 errors`，`34 warnings`）。
- 下一步进入 **Task 5**（同一真实/桥接候选的浏览器渲染与隔离工作区受控交付门禁，零付费桥接）。
