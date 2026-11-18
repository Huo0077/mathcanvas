# G3-DS Task F8 审计记录：真实画布哈希链统一交付与全仓终态门禁

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；当前真实 DS 36 题成绩仍为 `0/36`（[Task F0 真源基线](../../g3-final/retests/2026-11-17-92981/README.md)）；E2E 36 题浏览器渲染仍属 `bridge_replay_passed`（`dsLiveAuthorizedRun.status: pending_authorization`）；`humanReviewed` 保持 `pending`，Windows 实机桌面窗口签收仍待履行。

## 1. 本轮改动与实现核对

1. **交付包防探索混入与截图哈希核对（[dsCandidateBundle.ts](../../../packages/agent-core/src/dsCandidateBundle.ts) & [dsCandidateBundle.test.ts](../../../packages/agent-core/src/dsCandidateBundle.test.ts)）**
   - `DsCandidateBundle` 与 `BundleRenderDeliveryObservation` 新增 `speculativeOnly` 与 `screenshotCandidateHash`。
   - `verifyBundleRenderAndDelivery` 硬阻断 `speculativeOnly === true`（`speculative_candidate_rejected`）与 `screenshotCandidateHash !== candidateHash`（`screenshot_candidate_hash_mismatch`），并继续锁死 `humanReviewed` 为原始状态（严禁工程脚本自动签收）。
2. **画布渲染属性与同候选身份绑定（[canvasEvidence.ts](../../../apps/web/src/canvasEvidence.ts) & [canvasEvidence.test.ts](../../../apps/web/src/canvasEvidence.test.ts)）**
   - `canvasEvidenceAttributes` 新增 `data-candidate-hash`（严格等于 `evidence.documentHash`），并新增 `speculativeOnly`（返回 `speculative_blocked` + `accepted="false"`）与 `expectedCandidateHash` 不一致拒收（返回 `stale` / `candidate_hash_mismatch` + `accepted="false"`）。
3. **浏览器 E2E 统一哈希链断言升级（[drawing-reliability-36-render.spec.ts](../../../e2e/drawing-reliability-36-render.spec.ts) & [drawing-reliability-lifecycle.spec.ts](../../../e2e/drawing-reliability-lifecycle.spec.ts)）**
   - 强化 `DS4` 预览画布、同意面板证书、提交后主画布与重载后文档的 `data-candidate-hash` / `data-document-hash` / `data-viewport-hash` 全链一致断言。

## 2. 终态全仓验证读数（全部在最终代码修改后实测运行）

- `npm.cmd test -- --testTimeout=30000 --maxWorkers=4`：**`557 passed`（`557` 文件）**，**`5875 passed | 1 todo`（`5876` 用例）**，退出 `0`
- `npm.cmd run typecheck`：退出 `0`（全部工作区 + `e2e` + `scripts` 通过）
- `npm.cmd run lint`：**`0 errors`**（`34 warnings`）
- `npm.cmd run test:rust`：退出 `0`（各 crate 全部通过，0 失败，含默认 `#[ignore]` 的 Windows Credential Manager 交互用例与占位测试共 `4 ignored`）
- `npm.cmd exec -- playwright test e2e/drawing-reliability-36-render.spec.ts e2e/drawing-reliability-lifecycle.spec.ts --workers=1 --retries=0`：**`41 passed`（`0` 失败、`0` 重试，`2.0m`）**
- `npm.cmd run test:docs -- --testTimeout=30000`：随文档更新一并核验

## 3. 停机边界（Task F9 独立付费授权前严格停止）

- 至此 **Task F0–F8 全部零付费工程改造已完结并推送**；未发任何付费 DeepSeek API 请求。
- 按档案 §12 约定，启动 **Task F9（分层真实 DS 复测：Tier A 8 题 → Tier B 16 题 → Tier C 36 题）** 前，需用户显式授权并锁定：`revision`、`suiteHash`、`profileRevision`、`input_figure_missing` 边界、调用上限（`maxRequests` / `maxPerCase` / `maxInputBytes` / `maxOutputTokens`）、官方定价核验及 `maxUsd` 上限与熔断条件。
