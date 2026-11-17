# G3 阶段总验收汇总与当前退出状态

- **日期**：2026-11-17
- **代码基准**：Task 6 最终代码编辑后全量验证版本（紧随 `a4469381`）

## 一、已关闭门槛矩阵

| 门槛 / 工作包 | 状态 | 实证摘要与链接 |
| --- | --- | --- |
| **P0 / T01 第四轮合同终审（36 题）** | **已退出** | `drawingContracts.test.ts` **45/45**、只读独立复核 `PASS`（[2026-11-17-g3-contract-review-r4](../2026-11-17-g3-contract-review-r4/README.md)） |
| **Task 2 生产完整数学证书接线** | **已退出** | `DrawingCertificateResult` 与 `CertificateBinding` 贯通 `stage -> preview -> consent -> commit`（[2026-11-17-g3-certificate-wiring](../2026-11-17-g3-certificate-wiring/README.md)） |
| **`G3-Math`（Task 3 + Task 4：36/36 全闭环）** | **已退出** | `eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json` **36/36 passed**（`partial=0, failed=0, incomplete=0`，平均对象/义务覆盖率 `100%`，`liveWrites=0`），`planarContracts18` **23/23** + `solidContracts18` **23/23**，独立复核 **`SOUND (PASS)`**（[2026-11-17-g3-planar-18](../2026-11-17-g3-planar-18/README.md)、[2026-11-17-g3-math-exit](../2026-11-17-g3-math-exit/README.md)） |
| **`T15` + `T16` 浏览器工程门禁与全量回归** | **已通过** | `typecheck` exit 0、`lint` 0 errors、Vitest **543 文件 / 5794 passed \| 1 todo**、`test:rust` 0 failed、Playwright 串行全量 **290/290 passed**、`@draw/desktop` `no-bundle` 构建 `826c6fc34b7bde2d23ff4620aa8e5ece6ca41630bbc361258585d901d91b9b0c`（[2026-11-17-p7-render-visibility](../2026-11-17-p7-render-visibility/README.md)、[2026-11-17-g3-interaction-exit](../2026-11-17-g3-interaction-exit/README.md)） |

## 二、未关闭 / 留待用户操作项（不夸大、不伪签）

1. **已保存 DeepSeek 真实模型画图实测**：应用户明确指示（“拿 ds 测试的任务先保留，等我后面来做”）保留给用户后续直接测试；当前沙盒环境亦未注入 `DEEPSEEK_API_KEY` 且严格遵守密钥零泄露原则。
2. **非沙盒环境下 Windows 桌面窗口实机交互走查**：当前代理沙盒窗口站隔离（`ENUM_TOTAL=0`），桌面端已产出最新同版 `mathcanvas-desktop.exe` 并通过 `cargo test` 静态/IPC 验证，实机窗口交互由用户在本地桌面端确认。
3. **教师 / 用户人工可读性签收（`humanReviewed`）**：AI 代理已抽检渲染截图（`agent_visual_review`），正式人工可读性签收需由教师或用户本人签出，不以 AI 截图检查冒充人工签收。
4. **`P8`（安装包、冷启动实机与正式发布）**：尚未开始，亦未获发布授权；当前分支仍处于开发验收状态，产品暂不正式发布。
