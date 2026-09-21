# 端到端验收清单：桌面版 Agent 走一轮真实模型

> 这份清单存在的理由：**最后一段路只能由人在本机点**——设置表单在 WebView2 窗口里，
> 从外部驱动不了。前面所有环节都已经被自动化验证过（Rust 193 例、单测 2192 例、e2e 122 条、
> 以及对 DeepSeek 的 `provider_live` 两条真实往返），所以这一遍要确认的是**它们连起来还成不成**。
>
> 每一步都写了"该看到什么"。**如果某一步不对，先对照最后一节的"已知原因"** ——
> 有几条失败是**预期的**（尤其第 3 步的工具徽章），不是 bug。

## 0. 准备

```powershell
Set-Location D:\数学画布\mathcanvas-main
npm run build                     # 产出 release exe（内含 build-check/mathcanvas-current 那份前端）
.\apps\desktop\src-tauri\target\release\mathcanvas-desktop.exe
```

- **该看到**：`MathCanvas` 窗口起来，界面与浏览器版一致（文件/平面几何/立体几何/工程制图 + Ribbon）。
- 这一步对应 G1 Gate ①。**已经在本机验证过**（窗口起来、12/25 秒仍在运行、截图在 `D:\数学画布\desktop-shell.png`）。

## 1. 配一份服务（「服务」模块）

点左侧模块栏的「服务」→ 左上角**加号** → 填：

| 字段 | DeepSeek 的取值 |
| --- | --- |
| 协议 | `openai_compatible`（OpenAI 兼容） |
| 方言 | `deepseek` |
| Base URL | `https://api.deepseek.com/v1` |
| 模型 | `deepseek-chat` |
| 网络策略 | `cloud`（云端必须 HTTPS，且**不允许**私网地址——这是 SSRF 防线） |
| API key | 你的 `sk-…` |

- **该看到**：保存成功后那一栏**立刻**出现，并且**自动跑一次能力验证**。
- **注意**：一次验证会发**四发真请求**（文本 / JSON / 一张 1×1 PNG / 一次带工具表），按钮上写明了代价。

## 2. 看四个能力徽章（这一步是"证据"的验收）

- **预期结果（对 `deepseek-chat` 实测）**：
  - **流式** → `verified`
  - **严格 JSON** → 视服务行为而定（`verified` 或 `unknown`）
  - **图像** → 多半 `failed`（`deepseek-chat` 是纯文本模型；这是**我们拼的请求形状**被拒，如实记 `failed`）
  - **工具调用** → `failed`（"returned an empty reply to the tool request"）
- **为什么工具那条是 `failed` 而不是 bug**：`provider_live` 实测过 —— 带工具表 + `tool_choice: required` 的请求，DeepSeek 回 **HTTP 200 + usage，但既没有工具调用也没有文本**。探针把这种回法记成 `failed`（"请求是让它调工具，它什么都没调"），判定是对的。
- **该看到**：徽章只对 `verified` 亮；`unknown` 与 `failed` 分开显示（`unknown` 是"什么都没说明"，不是"不支持"）。

## 3. 点「使用」，然后走一轮 Agent

点那一栏的「使用」→ 回左侧「Agent」→ 在正中的输入框说：

```
建一个棱长 3 的立方体
```

- **该看到**（顺序）：运行状态卡逐步推进 `preflight → observing → planning → compiling → validating → awaiting_confirmation`；随后出现确认面板，写明"会新增 1 个对象"、来源与目标、假设（若有）、以及"一步撤销"的声明。
- **确认之前**：画布**一个字节都不该变**（这是 G2 Gate 第 2 条：模型不能自己写状态）。
- 点「确认并提交」→ **该看到**画布上真的出现立方体（并自动切到「立体几何」），`Ctrl+Z` **一步**回到原样。

## 3b. 如果停在 `waiting`（"需要你补充信息"）

- **该看到**：界面上写的是**模型真正问的那句话**（不再是写死的"当前没有接入模型服务"）。
- 这一条本身就是"「使用中」的那份配置被规划器消费了"的证据：模型问了什么，界面就显示什么。

## 4. 顺带验一下账本与项目包

- **运行账本**：确认面板附近的开发者详细视图（默认折叠）里应该能看到这一轮的阶段行；关掉应用再打开，`%APPDATA%\com.mathcanvas.desktop\projects.db` 的 `run_events` 表里该有这一轮的事件（**不含**推理与图像字节——那条由 `tests/run_events.rs` 把库文件当字节读一遍来守）。
- **项目包**：文件命令那一组的「项目包…」→ 填导出目的地 → 「导出 .mcanvas」→ **该看到**"已导出到 …（N 字节，1 份文档，M 个附件）"。`.mcanvas` 用 7-Zip 能打开看：manifest.json + documents/ + attachments/，**里面永远没有密钥**。

## 已知原因对照表

| 现象 | 已知原因 | 该怎么办 |
| --- | --- | --- |
| 徽章里"工具调用"是 `failed` | DeepSeek 对强制工具调用回空完成（已实测） | **不是 bug**。要试工具通道，换一家支持 function calling 的服务，或在支持工具的服务上再跑一次验证 |
| 徽章里"图像"是 `failed` | `deepseek-chat` 不支持图像输入 | 正常。图像题属 P5，尚未开工 |
| 一栏都出现不了 / 保存就报错 | 缺密钥、或 baseUrl 被网络策略拒（cloud + 私网地址会被 `private_address_denied` 拒） | 看卡片上的错误原因，改配置 |
| 验证四发都 `unknown` | 认证失败 / 连不上（对"支不支持"什么都不说明，所以留 `unknown`） | 检查 key 与网络 |
| Agent 停在 `waiting` 且说"本地规划器只认识几条固定指令" | 这一轮**走的是本地规划器**：桌面外壳没起来 / 没点「使用」/ 那一份没有密钥 | 确认三点（判据在 `agentRunner.selectPlanner`） |
| 提交被拒 `stale_source` | 预览期间文档被改过（CAS 失败） | 重新发一次；这是设计行为，不是错误 |
| 界面上出现"需要桌面版" | 你在浏览器里打开了 `127.0.0.1:5173`（开发服务器） | 正常。本地项目库/密钥库/账本都只在桌面版里 |

## 这一遍**不能**证明的事（如实）

- **Anthropic 与 Ollama 两档**没有真实往返过（只有 Rust 单测与 fixtures）。
- `vision` 探针没有对真实服务跑过。
- `tauri dev` 热重载、打包安装器（带 bundle）都还没做。
- 密钥的**手动重启验证**（存 → 重启 → 检测 → 轮换 → 删除）就是本清单第 1 步的"再走一遍"：存完之后**关掉应用再打开**，那一栏的密钥状态应该仍然是"已配置"（那才是"真的落在 Windows 凭据管理器里"的证据）。
