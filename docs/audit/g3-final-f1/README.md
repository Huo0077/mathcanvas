# G3-DS Task F1 审计记录：探索候选隔离层 `speculativeCanvas`

> **边界声明**：本区块 **0 新增付费 DeepSeek API 调用**；当前真实 DS 36 题成绩仍为 `0/36`（[Task F0 真源基线](../../g3-final/retests/2026-11-17-92981/README.md)）。

## 1. 本轮改动与实现核对

1. **新增探索候选隔离层（[speculativeCanvas.ts](../../../apps/web/src/agent/speculativeCanvas.ts) & [speculativeCanvas.test.ts](../../../apps/web/src/agent/speculativeCanvas.test.ts)）**
   - `createSpeculativeCanvas(baseDocument, options)` 在独立克隆内存中维护步进构造历史（`applyAction`）、精确单步/多步回滚（`rollback` / `revertToStep`）、丢弃重置（`discard`）与内容哈希链（`candidateHash` / `historyHashes`），全程零写入主画布。
   - 失败或越界动作触发三态分类（`accepted | repairable | blocked`），且保留最近一次有效检查点不被半途破坏。
   - `promoteToDraftStore` 是探索态唯一的晋升出口：把验证过的动作序列化写入隔离 `DraftStore` 并校验 `previewHash` 与 `speculativeSnapshot.candidateHash` 逐位一致。
2. **`DraftStore` 与 `HostBridge` 探索态硬拦截（[draftStore.ts](../../../apps/web/src/agent/draftStore.ts) & [hostBridge.ts](../../../apps/web/src/agent/hostBridge.ts)）**
   - 为 `DraftRecord` / `DraftPreview` 新增可选标志 `speculativeOnly?: boolean`；
   - 在 `HostBridge.requestConsent` 与 `HostBridge.commit` 双重入口显式拦截 `artifact.speculativeOnly === true`（返回 `unverified_diagram`），确保探索候选即使流入草稿存储也绝对无法铸造授权或写入主画布。

## 2. 实测验证结果

- `vitest run apps/web/src/agent/speculativeCanvas.test.ts apps/web/src/agent/draftStore.test.ts apps/web/src/agent/hostBridge.test.ts --testTimeout=30000`：`3 passed (3)` / `47 passed (47)`
- `npm.cmd run typecheck`：exit `0`
- `npm.cmd run lint`：exit `0`（`0 errors, 34 warnings`）

## 3. 下一步

- 推进 **Task F2（动作级 DS ToolSpec `dsActionTools.ts`）**。
