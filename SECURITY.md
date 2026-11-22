# 安全政策（Security Policy）

## 安全设计原则

MathCanvas 在设计上坚持最小权限与凭据隔离：

- **本地加密凭据存储**：API Key 在 Windows 上由系统凭据管理器托管，在 Android 上使用应用私有 `ChaCha20 + HMAC-SHA256` 加密本地凭据库（禁用 `android:allowBackup`），不在明文配置文件或项目文档 `.mgeo` 中落盘密钥。
- **严格网络边界**：Android 宿主通过 `network_security_config.xml` 对云端请求强制 HTTPS，仅放行本地回环（`127.0.0.1` / `*.localhost`）。
- **受控文件导出**：原生导出通道限制白名单扩展名（`.mgeo` / `.svg` / `.png` / `.csv` / `.dxf` / `.pdf` / `.html`）、大小上限与规范路径校验，防止路径穿越。
- **CI 最小权限**：GitHub Actions 全部第三方 Action 均采用完整 Commit SHA 固定，非发布工作流仅持有 `contents: read` 权限，所有发布工作流仅限 `v*` 版本标签触发。

## 漏洞报告

如果你发现任何安全漏洞（如凭据泄露、路径穿越、注入风险或签名异常），请**不要**在公开 Issue 中披露利用细节，而是直接发送邮件至：

- **安全联系邮箱**：[dogf9066@gmail.com](mailto:dogf9066@gmail.com?subject=MathCanvas%20Security%20Report)

请在邮件中附上复现步骤、影响范围与软件版本号，我们会在收到后尽快确认并发布修复版本。
