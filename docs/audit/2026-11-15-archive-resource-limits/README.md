# R05 归档预算、重叠检查与安全解码证据（2026-11-16）

| 严重度 | 原审查归并发现 | 本区块复核 |
| --- | ---: | --- |
| CRITICAL | 0 | 0 |
| HIGH | 1（H3 重复数据引用导致内存/CPU放大） | 已增加预扫描、独立预算与生产回归 |
| MEDIUM | 0 | 0 |
| LOW | 1（L3 base64/附件输入边界） | 已增加双端预算与前端预检 |

## 冻结的资源合同

`ArchiveLimits` 分离原包 `rawBytes`、未压缩聚合 `unpackedBytes`、单条 `entryBytes`、条数 `entries` 和附件 `attachmentBytes`。默认值依次为256MiB、256MiB、64MiB、4096项、32MiB。单项合法不再意味着聚合合法。

## 预扫描先于CRC和分配

- 先检查原包大小、EOCD注释、中央目录范围/数量/一致性。
- 逐条检查名称、flags、stored方法、压缩/原始大小、聚合预算、重复名字和重复local offset。
- 本地与中央的名称、flags、method、CRC和大小必须一致；本地头/数据不能重叠或覆盖中央目录。
- 所有累计大小与偏移使用checked arithmetic，目录预扫描全部通过后才允许CRC和 `to_vec`。
- 观察者测试证明元数据失败时CRC调用为0；合法边界按实际条目数调用。没有分配理论256GiB载荷。

## 原文件、附件与base64

- `read_from_file` 的metadata只做预检，实际以 `take(max+1)` 读取，增长/替换后的超限文件同样拒绝。
- manifest附件声明超过32MiB时，在读取blob和克隆之前拒绝，与64MiB归档单项上限独立。
- base64仅接受CR/LF换行和末尾至多两个padding；非法字符、空白、中间padding、长度不符均拒绝。解码前先计算输出大小，超预算不分配输出缓冲。
- 前端在 `FileReader` 前检查 `file.size`，Rust仍独立校验，不能依赖前端。

## RED → GREEN

- 低限额3个64字节条目超过128字节聚合预算，在任何CRC前拒绝；两个64字节条目的边界正例通过。
- 不同名字共享local header、重复名字、重叠记录及本地/中央字段不一致均拒绝。
- 修复本地头字段偏移时同步修正负例，未放宽生产校验。
- base64非法字符/padding/超限、实际读取超限、manifest附件超限和前端超限文件均有负例；合法往返与历史包保持通过。

## 验证

- `node scripts/toolchain.mjs cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test repository_package -- --test-threads=1`：41项通过。
- `npm exec -- vitest run apps/web/src/services/projectPackageClient.test.ts apps/web/src/components/ProjectPackagePanel.test.tsx --testTimeout=30000`：2文件、20项通过。
- `npm run test:rust -- -- --test-threads=1`：317项通过、0失败、4 ignored。
- `npm run typecheck`：通过。
- `npm run lint`：0错误、32条既有unused警告。
- `npm test -- --testTimeout=30000`：522文件、5562项通过、1 todo、0失败。
- `npm run test:docs -- --testTimeout=30000`：8文件、22项通过。
- `npm run build --workspace @draw/web`：通过；保留既有动态导入和大chunk警告。

## 边界与回滚

全部使用低限额、小型合成包、内存resolver/临时目录与本地测试流，没有执行大包、256GiB内存、恶意DNS或真实provider测试。feature分支推送不触发仅main/PR运行的远端CI。本轮为同会话自审，不替代独立人工发布签收。出现不兼容时保持有界读取或禁用导入，不恢复逐项CRC/克隆、map覆盖重复键或无界base64输出。
