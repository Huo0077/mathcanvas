# P4 / T14 最终候选绑定、过期检测、仅相机不变性与原子一次确认证据

- **任务编号**：`T14`（P4 阶段收口，遵循 `implementation-task-ledger.json` DAG：`T13, R01, R06 → T14`，至此 `B4 / P0–P6` 全部完成）
- **提交信息**：`fix(commit): bind certification to current drafts and scene revisions`
- **日期**：2026-11-16
- **目标**：将草稿与证书完整绑定到当前草稿、场景基线、题文、小问 `scope`、会话及策略版本；在双击重复确认时保证主场景零重复写入；仅移动相机视角时不使数学证书失效、也不重新向模型提问。

## 1. 交付内容

1. **证书多维新鲜度校验与仅相机变更解耦**：
   - [`packages/agent-core/src/verification/drawingCertificate.ts`](../../../packages/agent-core/src/verification/drawingCertificate.ts)：新增 `CertificateBinding` 与 `verifyCertificateFreshness`，逐项核验 `runId`、`draftId`、`conversationId`、`promptHash`、`scopeId`、`documentHash`、`baseRevision` 与 `policyVersion`；任何一项改变即返回具体失效原因（`prompt_changed`、`scope_changed`、`conversation_changed`、`document_changed` 等），旧存档或跨会话证书不能跳过提交门禁。
   - [`packages/agent-core/src/verification/renderEvidence.ts`](../../../packages/agent-core/src/verification/renderEvidence.ts)：扩展 `RenderEvidence` 与 `renderEvidenceStaleness` 支持 `cameraHash`——在 `draftId` 与 `documentHash` 均一致的前提下，相机移动仅返回 `kind: "camera_changed"`（`mathStale: false`、`visualStale: true`、`requiresReplan: false`），绝不使数学证明过期，也不重问模型。
2. **原子一次性确认锁与题文/作用域保鲜**：
   - [`packages/agent-core/src/committerAdapter.ts`](../../../packages/agent-core/src/committerAdapter.ts)：记录 `committedDraftIds` 防止同一已暂存草稿重复提交调用 `host.commit`（阻止双击并发或重放）。
   - [`apps/web/src/agent/agentRuntime.ts`](../../../apps/web/src/agent/agentRuntime.ts) 与 [`apps/web/src/agent/agentRunner.ts`](../../../apps/web/src/agent/agentRunner.ts)：新增 `committedOnce` 原子确认守卫，首次确认落盘后再次点击 `confirmDraft()` 立即返回 `status: "rejected"`（`already_committed`）而不铸造二次同意凭据，保证确认前零写入、确认后仅写入一次；`commitFailureText` 补充中文说明。
   - [`apps/web/src/agent/draftStore.ts`](../../../apps/web/src/agent/draftStore.ts)：扩展 `assertFresh(draftId, liveHandle, options)` 支持 `promptHash` 校验（新增 `FreshnessKind = "prompt"`），同步适配 `DraftStoreLike`。

## 2. RED → GREEN 与全量验证记录

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| RED（实现前） | `npm.cmd exec -- vitest run packages/agent-core/src/committerAdapter.test.ts apps/web/src/agent/draftStore.test.ts apps/web/src/agent/drawingCertificateStaleness.test.ts --testTimeout=30000` | 按预期失败：`2 failed \| 4 failed \| 44 passed (48)`（含双击重复提交、`verifyCertificateFreshness` 缺失、`camera_changed` 未分类） |
| 定向 GREEN | `npm.cmd exec -- vitest run packages/agent-core/src/committerAdapter.test.ts packages/agent-core/src/verification/renderEvidence.test.ts apps/web/src/agent/draftStore.test.ts apps/web/src/agent/drawingCertificateStaleness.test.ts apps/web/src/agent/agentRuntime.test.ts --testTimeout=30000` | `5 passed (5) \| 103 passed (103)` |
| 全量 ESLint | `npm.cmd run lint` | exit 0（0 errors，33 pre-existing warnings） |
| Web 生产构建 | `npm.cmd run --workspace @draw/web build` | exit 0 |
| 离线评测 | `npm.cmd run eval:reliability -- --offline` | `1 passed (1) \| 3 passed (3)` |
| 全量 TypeScript 类型检查 | `npm.cmd run typecheck` | exit 0 |
| 全量 Vitest 套件（最终编辑后） | `npm.cmd test -- --testTimeout=30000` | `540 passed (540) \| 5705 passed \| 1 todo (5706)` |
