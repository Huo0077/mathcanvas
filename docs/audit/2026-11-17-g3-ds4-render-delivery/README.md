# DS4：同候选真实浏览器渲染、冻结复播工件与隔离工作区受控交付

- **日期**：2026-11-17
- **性质**：零新增付费 API 调用（可复播 `ds-candidate-bundle` 工件、全链 hash 串联、浏览器 36 题同候选渲染 + 负例/受控交付 E2E、全量单测与桌面无捆绑构建通过；`DS5` 付费实测、教师人工可读性签收及桌面实机窗口 UIA 仍待执行）

## 1. 交付产物与 `DS3` 全量回归收敛

1. **零费用可复播 `ds-candidate-bundle` Schema 与双端核验**：
   - 新增 [dsCandidateBundle.ts](../../../packages/agent-core/src/dsCandidateBundle.ts) 并在 [index.ts](../../../packages/agent-core/src/index.ts) 导出，定义 `DS_CANDIDATE_BUNDLE_SCHEMA = "mathcanvas.ds_candidate_bundle.v1"`、`createDsCandidateBundle`、`parseAndValidateDsCandidateBundle` 与 `verifyBundleRenderAndDelivery`，将 `{ runId, candidateHash, documentHash, cameraHash, viewportHash }`、证书与诊断/警告绑定在同一个不可篡改工件中。
   - 新增 [dsCandidateBundle.test.ts](../../../packages/agent-core/src/dsCandidateBundle.test.ts) 验证正常构造/解析/渲染交付校验证明及篡改 `candidateHash` / 过期渲染证据拒绝。
2. **浏览器 DOM 与渲染证据 hash 串联**：
   - [canvasEvidence.ts](../../../apps/web/src/canvasEvidence.ts) 在渲染取证节点输出 `data-viewport-hash`（基于 `canonicalContentHash(evidence.viewport)`），与 `documentHash` / `cameraHash` 对齐。
   - [ConfirmationPanel.tsx](../../../apps/web/src/components/agent/ConfirmationPanel.tsx) 在 `[data-certificate-status]` 节点暴露 `data-run-id`、`data-candidate-hash` 与 `data-document-hash`，让真实浏览器交互测试可直接断言预览阶段候选与主画布确认阶段/重载文档为同一版本候选。
3. **36 题同候选浏览器渲染与隔离工作区受控交付 E2E**：
   - 扩展 [drawing-reliability-36-render.spec.ts](../../../e2e/drawing-reliability-36-render.spec.ts)：`manifest.json` 新增逐题 `runId`、`candidateHash`、`documentHash`、`viewportHash` 与 `warnings` 追踪，写入 `dsLiveAuthorizedRun: { status: "pending_authorization" }` 并保持 `agent_visual_review.status = "pending"` 与 `humanReviewed.status = "pending"`（绝不把 `warning` 或离线回放冒充人工/DS实测通过）；同时新增 `DS4 browser negative & hash-chain guard` 用例验证合法候选与被清空/异版状态拦截（`empty_canvas`）。
   - 扩展 [drawing-reliability-lifecycle.spec.ts](../../../e2e/drawing-reliability-lifecycle.spec.ts)：新增 `DS4 controlled delivery` 用例验证隔离工作区内预览 → 确认提交 → 防二次重复提交 → 丢弃草稿零迟到写入 → 工作区重载的统一 hash 链闭环。
4. **`DS3` 全量单测回归同步收敛**：
   - 在提交 `DS3` 后跑全量 `npm test` 时发现并修复 2 处既有套间语义兼容性问题：[coordinator.ts](../../../packages/agent-core/src/coordinator.ts) 恢复 `MAX_PLAN_ATTEMPTS = 1 + MAX_REPAIR_ATTEMPTS + MAX_COMPILE_REPAIR_ATTEMPTS`（`4`）；[diagramObligations.ts](../../../packages/agent-core/src/diagramObligations.ts) 将 `JT-S07` 的纯净求解问句排除收窄至 `goalQuestion` 中不含撇号的二面角求值问句（恢复 `foldedTriangleClauses.test.ts` 与 `diagramEntityBinding.test.ts` 全部原预期）。

## 2. 验证结果（全部在最终代码改动后执行）

- **`npm.cmd test`**（全量 Vitest）：**`547` 文件 / `5824 passed | 1 todo (5825)`**，`0` 失败。
- **`npm.cmd run typecheck`**：`6` 个工作区全部通过（exit `0`）。
- **`npm.cmd run lint`**：exit `0`（`0 errors`，`34 warnings` 为既有未使用变量警告）。
- **`npm.cmd run test:rust`**：exit `0`（Rust 全部测试 crate 通过，`0 failed`）。
- **`npm.cmd --workspace @draw/desktop run build`**（先清理残留无窗口测试进程后构建）：exit `0`，产物 `apps/desktop/src-tauri/target/release/mathcanvas-desktop.exe` SHA-256 为 `46EF3F1E0812E1B3CD66B8D7DA72035592598F78FF5DFAC6A0E9CD5042AD7BA5`（仅证明桌面二进制可编译打包，不等价于桌面窗口 UIA 交互验收）。
- **`npm.cmd exec -- playwright test e2e/drawing-reliability-36-render.spec.ts e2e/drawing-reliability-lifecycle.spec.ts --workers=1 --retries=0`**：**`40 passed`**（`2.3m`，零重试）：
  - `eval-results/g3-render-36/manifest.json` 实测：`denominator = 36`，`passed = 36`，`failed = 0`，`withHashes = 36`，`warnCases = 25`（视觉警告保留），`dsLiveAuthorizedRun.status = "pending_authorization"`，`agent_visual_review.status = "pending"`，`humanReviewed.status = "pending"`；
  - `DS4` 浏览器负例（异版/空画布检测）及隔离工作区受控交付全链路通过。
- **`npm.cmd run test:docs -- --testTimeout=30000`**：见提交前最后一次运行记录（随本审计与进度文档同步校验）。

## 3. 边界与下一步（停止在 `DS5` 付费授权门禁前）

- **0 新增付费 API 调用**：本区块全程未向已保存 DeepSeek 模型发起任何新的付费请求，现有 `36/36` 离线/回放渲染与生命周期验证**不计作 `DS live pass`**（历史真实 DS 实测仍为 `2/36`）。
- **进入 `DS5` 前须先由用户明确授权**：
  1. 目标模型、固定 36 题集与预检子集（1 道历史通过、1 道零候选、1 道部分正确、1 道验证分叉）以及未见题独立评估集范围；
  2. 最大请求次数上限、单题重试上限、输入/输出 token 与费用上限、触发停机的失败条件；
  3. 用户/教师逐题可读性审阅与非沙盒 Windows 桌面窗口实机签收。
