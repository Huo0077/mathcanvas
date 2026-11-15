# 2026-11-15 项目目录清理记录

按用户要求清理臃肿项目目录。本次只删除经范围校验的可重建编译产物、旧安装包和缓存，不改业务代码、配置、题库或修复方案，不提交/推送。

## 实际结果

| 项目 | 清理前 | 清理后 |
| --- | --- | --- |
| 文件逻辑大小 | 24.44 GiB | 7.67 GiB |
| 文件数 | 190297 | 174139 |

目录逻辑大小减少 **16.77 GiB（68.6%）**。统计不跟随符号链接/目录联接，不代表磁盘实际分配空间；后续验证会生成少量缓存，本报告也增加少量字节。

**磁盘释放限制**：即时C盘可用空间没有相应增长，差值约-2.80 MiB。因此只确认目录减量，不能声称物理磁盘已释放16.77 GiB。原因尚未确认，不排除文件系统链接/快照或其他进程写入。本轮不清理项目外目录、系统快照或回收站。

## 删除范围

| 相对外层项目目录的路径 | 逻辑MiB | 结果 |
| --- | --- | --- |
| draw/apps/desktop/src-tauri/target/debug | 15229.57 | removed |
| draw/apps/desktop/src-tauri/target/release/deps | 1443.02 | removed |
| draw/apps/desktop/src-tauri/target/release/build | 419.83 | removed |
| draw/apps/desktop/src-tauri/target/release/.fingerprint | 0.41 | removed |
| draw/apps/desktop/src-tauri/target/release/incremental | 0.00 | removed |
| draw/apps/desktop/src-tauri/target/release/examples | 0.00 | removed |
| draw/apps/desktop/src-tauri/target/release/nsis | 0.04 | removed |
| draw/apps/desktop/src-tauri/target/release/wix | 0.41 | removed |
| draw/apps/desktop/src-tauri/target/tmp | 0.00 | removed |
| draw/apps/desktop/src-tauri/target/release/mathcanvas_desktop.pdb | 9.00 | removed |
| draw/apps/desktop/src-tauri/target/release/MathCanvas_4.1.0_x64.exe | 16.90 | removed |
| draw/apps/desktop/src-tauri/target/release/bundle/MathCanvas_4.1.0_x64.exe | 16.90 | removed |
| draw/apps/desktop/src-tauri/target/release/bundle/msi/MathCanvas_4.0.1_x64_en-US.msi | 6.84 | removed |
| draw/apps/desktop/src-tauri/target/release/bundle/msi/MathCanvas_4.1.0_x64_en-US.msi | 6.88 | removed |
| draw/apps/desktop/src-tauri/target/release/bundle/nsis/MathCanvas_4.0.1_x64-setup.exe | 5.08 | removed |
| draw/apps/desktop/src-tauri/target/release/bundle/nsis/MathCanvas_4.1.0_x64-setup.exe | 5.11 | removed |
| draw/node_modules/.vite | 0.06 | removed |
| draw/apps/web/node_modules/.vite | 10.07 | removed |
| node_modules/.vite | 0.00 | removed |
| desktop-build.log | 0.01 | removed |

另删除外层空node_modules目录。真实开发依赖位于内层draw/node_modules，完整保留。

## 明确保留

- Git历史、全部跟踪文件、未提交方案/文档、源码、配置、锁文件、测试与题库。
- 全部eval-results、test-results、build-check和历史审计证据；不删失败记录。
- 当前裸桌面程序与resources：apps/desktop/src-tauri/target/release/mathcanvas-desktop.exe。
- 当前程序SHA-256不变：18cbe9c17e04515694976e7d4b79da8a5e05d7f6c7151cb520a9d471f1c95b04。
- 4.3.0发布产物及已有4.4.0产物；后者只是回退前遗留产物，不代表当前59ea3613构建。
- Lean/mathlib依赖与缓存约7.05 GiB。删除会影响离线证明并增加恢复成本，本轮保留。
- 外层release-validation-430：存在未提交/暂存文件，HEAD不可解析；不当作可直接删除的干净重复仓库。其node_modules为联接，未递归清理。
- 外层GraphicsView.tsx、课程PDF/截图、失败截图和工具目录：用途/唯一性尚未确认，体积很小，保留。

## 安全和验证

1. 删除前逐项确认绝对路径位于外层工作区内，目标及祖先/子项不存在重解析链接，不包含Git跟踪文件或保护清单。
2. 检查无运行中的Cargo、rustc或桌面程序；使用PowerShell原生Remove-Item -LiteralPath，不跨shell拼接删除操作。
3. 4023个源码、文档、证据与当前产物SHA-256比对：0缺失、0改变。生成本报告前Git工作区状态保持不变。
4. 文档一致性：8文件、22项通过，退出0；全部workspace以及e2e/scripts类型检查退出0；git diff --check退出0。
5. 未重建Rust/桌面、未启动桌面、未跑全量功能/E2E、未调用付费模型。不据此声称画图成功率提升。

## 后续影响与恢复

- 前端缓存会在开发/测试时自动生成。
- 下一次Rust测试或桌面构建需重新编译，会比保留热缓存时更慢；源码和依赖锁不变。
- 桌面重建：在内层仓库执行 npm.cmd run build --workspace @draw/desktop。
- Rust测试产物重建：npm.cmd run test:rust。
- 旧安装包需从对应版本发行资产恢复，或在独立的对应版本检出中重建；当前HEAD构建不等于恢复旧版。本轮没有下载或发布。
- 不建议直接git clean -fdx：可能误删未提交方案、付费评测证据和依赖。后续继续采用逐项白名单，并保留当前可执行程序。

详细机器记录：[cleanup-report.json](cleanup-report.json)。
