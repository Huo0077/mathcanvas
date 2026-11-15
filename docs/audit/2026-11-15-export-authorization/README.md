# R04 原生导出授权与原子写入证据（2026-11-15）

| 严重度 | 原审查归并发现 | 本区块复核 |
| --- | ---: | --- |
| CRITICAL | 0 | 0 |
| HIGH | 1（H2 未授权原生路径写入） | 已删除任意路径写入口并增加生产回归 |
| MEDIUM | 0 | 0 |
| LOW | 0 | 0 |

## 授权边界

- `export_package` 只接受 `fileName`，不再接受 `destination` 路径。实际根目录由 Rust 固定为应用数据目录下的 `exports`。
- 文件名采用保守ASCII合同：仅字母、数字、`-_.`，必须有 `.mcanvas` 后缀；拒绝路径分隔符、绝对/UNC路径、点段、Windows保留设备名、ADS、尾空格和错误后缀。
- `write_to_file` 任意路径函数已删除，生产与测试都只能调用受控 `write_export_file`。
- 导出根必须是绝对真实目录；symlink/junction拒绝。Windows实测通过本地 `mklink /J` 验证不会经联接写出目标外。

这里的威胁边界是被控制的renderer/IPC；没有声称能抵御同时改写应用数据目录的本地管理员或外部进程攻击。

## 原子写入与数据保护

1. 在授权根内使用不可预测的临时文件名，以 `create_new` 打开，预创建文件不能参与写入。
2. 写完并 `sync_all` 后，以同一文件系统内的 `hard_link` 创建目标。目标已存在时失败，不会覆盖旧内容。
3. 写入或链接失败只清理本次创建的临时文件；成功后删除临时文件并返回实际完整路径。
4. 前端只记住文件名，完整路径仅用于结果展示，避免下次把完整路径重新当成文件名提交。

## RED → GREEN

- 新 `write_export_file` 不存在，合法写入与拒绝矩阵先编译失败。
- 路径穿越、UNC、保留设备名、ADS、点段、错误后缀均拒绝，目录条目数不增加。
- 同名第二次导出失败，原文件字节保持 `ORIGINAL`，无临时文件残留。
- 合法包写入与读回逐字节一致；项目包原有导入/导出回归保持通过。
- 前端RED实际观察到 `destination`，改为 `fileName` 后服务与面板共18项通过；本地只记文件名。

## 验证

- `node scripts/toolchain.mjs cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test repository_package -- --test-threads=1`：33项通过；另Windows junction精确用例通过。
- `npm exec -- vitest run apps/web/src/services/projectPackageClient.test.ts apps/web/src/components/ProjectPackagePanel.test.tsx --testTimeout=30000`：2文件、18项通过。
- `npm run typecheck`：通过。
- `npm run lint`：0错误、32条既有unused警告。
- `npm run test:rust -- -- --test-threads=1`：310项通过、0失败、4 ignored（含Windows junction用例）。
- `npm test -- --testTimeout=30000`：522文件、5560项通过、1 todo、0失败。
- `npm run test:docs -- --testTimeout=30000`：8文件、22项通过。
- `npm run build --workspace @draw/web`：通过；保留既有动态导入和大chunk警告。

## 边界与回滚

全部写入均在临时测试目录，没有向用户任意目录创建文件，没有使用真实凭据或外部服务。feature分支推送不触发仅main/PR运行的远端CI。本轮为同会话自审，不替代独立人工发布签收。若受控目录或hard-link语义在目标文件系统不可用，导出应失败关闭，不回退自由文本路径或可预测覆盖式临时文件。
