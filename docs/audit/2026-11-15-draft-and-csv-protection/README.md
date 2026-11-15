# R06 证据摘要：CSV 公式细胞转义与草稿损坏备份失败写保护

## 审计发现映射

| 严重度 | 问题摘要 | 修复边界与结论 |
| --- | --- | --- |
| Middle | CSV 导出未中和以 `=`、`+`、`-`、`@` 或前导制表/换行触发的表格公式注入，且不可信字符串前缀时不得误伤合法负数/布尔值 | 在 `apps/web/src/persistence/exporters.ts` 导出 `csvCell`，仅对命中 `/^[\s\u00a0]*[=+\-@]/` 或 `/^[\t\r\n]/` 的字符串值加单引号 `'` 前缀，数字（含负数如 `-2`）与布尔值原样输出 |
| High | 本地草稿损坏且 `:unreadable` 备份写入或回读失败时，旧 `loadDraft` 仍继续清除主键并允许后续自动保存覆盖原草稿 | 在 `apps/web/src/persistence/draftStorage.ts` 新增 `loadDraftRecovery` 与 `discardDraft`（`loadDraft` 委托前者）；`:unreadable` 写入后必须 `getItem` 校验读回一致才移除主键，否则返回 `backup_failed_readonly` 并保留主键不删 |
| High | 自动保存 hook 与页面未对备份失败的工作区启用写保护，存在覆盖用户损坏现场或跨工作区误锁定风险 | 在 `apps/web/src/useDraftPersistence.ts` 新增 `protectedDraftsRef` 与 `DraftRecoveryAction`（`download` / 需 `window.confirm` 的 `discard`），仅拦截处于只读保护中的 `workspaceId` 自动保存且不影响健康工作区，并在 `apps/web/src/App.tsx` `.footer-note` 展示恢复提示与操作按钮 |

## 冻结实现与合同边界

1. **CSV 导出合同（`apps/web/src/persistence/exporters.ts`）**：
   - 字符串单元格按 RFC 4180 转义前，先通过 `csvCell` 检查是否匹配 `/^[\s\u00a0]*[=+\-@]/` 或 `/^[\t\r\n]/`（覆盖前导空白、不间断空格 `\u00a0` 及控制字符偏移）。
   - 仅不可信字符串文本加 `'` 前缀，供 Excel / LibreOffice Calc 等电子表格读取器按纯文本解析；数值（包含 `-2`）与布尔值保持未加引号的数值语义，无损工程保存/恢复仍走 JSON `save` 通道。
2. **草稿写保护合同（`apps/web/src/persistence/draftStorage.ts`、`useDraftPersistence.ts`、`App.tsx`）**：
   - `loadDraftRecovery(storage, workspaceId, now)` 区分四种恢复结局：`recovered`、`missing`、`corrupted_backed_up`（仅在备份键成功写入并经 `getItem` 回读一致后删除主草稿键）、`backup_failed_readonly`（主键完整保留，绝不移除）。
   - `useDraftPersistence` 在初始化与工作区切换时记录只读保护集合 `protectedDraftsRef`，阻断受保护 `workspaceId` 的自动保存写入；同时提供“下载受损原始草稿（JSON）”与“放弃并解锁自动保存（需用户 `window.confirm` 确认后调用 `discardDraft`）”恢复动作。

## RED -> GREEN 实证与测试计数

- **RED 现象**：
  - 修复前 `exporters.ts` 对 `=CMD()`、`+SUM(...)`、前导空格公式文本直接原样写入 CSV，`apps/web/src/persistence/exporters.test.ts` 新增配方注入负例失败。
  - 修复前 `loadDraft` 在 `localStorage.setItem` 对 `:unreadable` 键抛出配额异常或写入内容与回读不一致时仍删除原草稿键；`useDraftPersistence` 在存储配额写满后仍继续执行 `setItem` 自动覆盖主键。
- **GREEN 验证**：
  - `npx vitest run apps/web/src/persistence/exporters.test.ts`：**19 项通过**（含 2 项 R06 CSV 公式转义及负数值/布尔值兼容测试）
  - `npx vitest run apps/web/src/persistence/draftStorage.test.ts`：**13 项通过**（含 3 项 R06 `:unreadable` 配额异常、静默篡改回读失败保护及 `discardDraft` 测试）
  - `npx vitest run apps/web/src/useDraftPersistence.test.tsx`：**17 项通过**（含 2 项 R06 损坏草稿只读保护、下载备份、二次确认解锁及跨工作区隔离测试）
  - `npm.cmd test -- --testTimeout=30000`：**522 个测试文件全部通过，5570 项通过 + 1 todo（5571）**
  - `npm.cmd run typecheck`：通过
  - `npm.cmd run lint`：通过（0 errors，32 条既有 unused 警告）
  - `npm.cmd run build --workspace @draw/web`：通过（634 modules 构建成功）

## 边界说明与安全回滚

- **边界**：CSV 转义面向电子表格消费端展示安全，不承诺在不保留 `'` 前缀的第三方纯 CSV 导入器中剥离前缀；草稿写保护仅作用于本地浏览器 `Storage` 持久层，不涉及远端同步。
- **回滚**：R06 拆分为“CSV 转义”和“草稿备份失败写保护 + 文档”两个独立小提交，分别 `git revert` 对应提交即可回滚对应保护面；回滚期间需注意重新激活 G1 阻断标记。
