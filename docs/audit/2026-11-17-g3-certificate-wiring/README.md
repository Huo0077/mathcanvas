# G3 Task 2：生产完整 `DrawingCertificateResult` 接线与统一评测入口

- **日期**：2026-11-17
- **代码基准**：`d32f41c5`（`T01` 终审 R4）+ Task 2（完整数学证书与 `CertificateBinding` 生产贯通）

## 一、生产全链路贯通改动

1. **`packages/agent-core/src/verification/drawingCertificate.ts`**
   - 导出 `NUMERIC_POLICY_VERSION` 并增强 `certifyDrawingAgainstContract`：基于 `normalizeGeometryPrompt`、`parseObligationWithLegacy`、实体绑定 `entityBindings`、实际 `plan` 与 `baseDocument` 独立运行 `verifyDiagramObligations`，支持 `staleEarlierObligations`（多轮追加操作未重验前禁止沿用旧通过状态）与所有 `status === "unverified"` 条目完整计入 `unresolvedSource`。
2. **`apps/web/src/agent/draftStore.ts`**
   - `DraftRecord` 与 `DraftPreview` 新增 `drawingCertificate?: DrawingCertificateResult` 与 `certificateBinding?: CertificateBinding`（包含 `runId`/`draftId`/`draftVersion`/`documentHash`/`promptHash`/`conversationId`/`baseRevision`/`policyVersion`）；关闭 `enableCompleteCertificate: false` 显式落地 `"unverified"`（`certificate_disabled`、`未完整核验`），绝不静默回退旧 `"passed"`。
3. **`packages/agent-core/src/committerAdapter.ts` 与 `apps/web/src/agent/hostBridge.ts`**
   - `CommitterAdapter.stage` 透传 `enableCompleteCertificate`/`runId`/`conversationId` 并将证书结论汇入协调器 `verification` 报告（保留首条可读题设失败细节）；
   - `HostBridge.preview`/`requestConsent`/`commit` 与 `ConsentRecord` 双向校验 `drawingCertificate` 及 `verifyCertificateFreshness`（会话切换、版本号或文档哈希漂移一律拒绝并零写入主场景）。
4. **`apps/web/src/agent/agentRuntime.ts`、`agentRunner.ts`、`agentStore.ts`、`components/agent/ConfirmationPanel.tsx`**
   - 全链透传 `drawingCertificate` 与 `certificateBinding` 至确认面板，展示 `[data-certificate-status]` 摘要并在 `blocked`/`partial`/`unverified` 时禁用「确认并提交」。
5. **`apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts`**
   - 在 `reliabilityEval` 记录每题 `drawingCertificateStatus`、`certificateBlockers` 与 `numericPolicyVersion`，并将证书门禁纳入 `verification_passed` 验收口径。

## 二、验证清单（最后一次编辑后全部退出 0）

- `npm.cmd exec -- vitest run apps/web/src/agent/drawingCertificatePipeline.test.ts ...`：**10 文件 / 183 passed**（新增 `drawingCertificatePipeline.test.ts` 与 `ConfirmationPanel.test.tsx` 证书门禁断言；先 RED `2 failed` 再全绿）。
- `npm.cmd run typecheck`：exit 0。
- `npm.cmd run lint`：exit 0（0 errors）。
- `npm.cmd run --workspace @draw/web build`：exit 0（`built in 21.01s`）。
- `npm.cmd run eval:reliability -- --offline`（报告 `eval-results/reliability/offline-2026-11-16T17-34-28.698Z-14240`）：`3/3 passed`（exit 0）。
- `npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`（报告 `eval-results/reliability/offline-2026-11-16T17-34-42.225Z-46476`）：exit 0。
- `npm.cmd exec -- playwright test e2e/drawing-reliability-render.spec.ts --workers=1 --retries=0`：**2 passed (30.5s)**（四族真画布渲染兼容无回退）。
- `npm.cmd test -- --testTimeout=30000`：**541 passed (541) | 5747 passed | 1 todo (5748)**（exit 0）。

## 三、当前边界

- 生产完整证书门禁已落盘生效，但 36 题确定性解题与构造尚在 Task 3（18 平面）与 Task 4（18 立体/折叠）推进中，**`G3-Math` 尚未退出**。
