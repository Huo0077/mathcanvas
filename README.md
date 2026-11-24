<div align="center">

<img src="apps/desktop/src-tauri/icons/icon.svg" alt="MathCanvas Logo" width="92" height="92" />

# MathCanvas

**面向中学与大学全学段数学教学、立体几何探究、高等数学可视化与工程绘图的 AI 原生交互式数学工作台**

[![Release](https://img.shields.io/github/v/release/Huo0077/mathcanvas?style=flat-square&logo=github&color=2563eb&label=Release)](https://github.com/Huo0077/mathcanvas/releases/tag/v6.0.0)
[![CI](https://img.shields.io/github/actions/workflow/status/Huo0077/mathcanvas/ci.yml?branch=main&style=flat-square&logo=githubactions&label=CI)](https://github.com/Huo0077/mathcanvas/actions/workflows/ci.yml)
[![Unified Release](https://img.shields.io/github/actions/workflow/status/Huo0077/mathcanvas/android-release.yml?style=flat-square&logo=tauri&label=Win%20%26%20Android%20Build)](https://github.com/Huo0077/mathcanvas/actions/workflows/android-release.yml)
[![Stars](https://img.shields.io/github/stars/Huo0077/mathcanvas?style=flat-square&color=f59e0b)](https://github.com/Huo0077/mathcanvas/stargazers)

![Platforms](https://img.shields.io/badge/Platforms-Windows%20x64%20%7C%20Android%20ARM64%20%7C%20Web-0ea5e9?style=flat-square)
![Stack](https://img.shields.io/badge/Stack-React%20%C2%B7%20TypeScript%20%C2%B7%20Three.js%20%C2%B7%20Tauri%202%20%C2%B7%20Rust-1e293b?style=flat-square)

<p>
  <b>简体中文</b>
  &nbsp;|&nbsp;
  <a href="README.en.md">English</a>
</p>

<p>
  <a href="#-全平台整合下载v600"><b>📥 下载整合版 v6.0.0</b></a>
  &nbsp;·&nbsp;
  <a href="#-界面展示">📸 界面展示</a>
  &nbsp;·&nbsp;
  <a href="#-为什么选择-mathcanvas">🎯 工具对比</a>
  &nbsp;·&nbsp;
  <a href="#-核心特性">✨ 核心特性</a>
  &nbsp;·&nbsp;
  <a href="#-系统架构">🏗️ 系统架构</a>
  &nbsp;·&nbsp;
  <a href="#-快速开始">🚀 快速开始</a>
  &nbsp;·&nbsp;
  <a href="https://huo0077.github.io/mathcanvas/">🌐 在线官网</a>
  &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">🤝 参与贡献</a>
</p>

</div>

---

> **MathCanvas** 将 **自然语言 AI 读题作图**、**动态几何约束联动**、**二维解析 / 函数分析**、**大学高等数学可视化实验**、**三维立体空间建模** 与 **工程制图四视图投影** 整合在同一个流畅的跨端工作台中。你可以像在传统几何软件里那样自由拖拽动点、调节参数、测量距离与二面角，也可以直接输入一道完整的数学题，由内置 AI 助手自动理解题意、构造图形、联动辅助线与空间面，并经独立数学核验证书检验后写入画布继续探索。
>
> **持续更新与问题反馈**：MathCanvas 持续高频迭代中。如遇软件 Bug 或有题目无法画出，欢迎直接提交 [GitHub Issue](https://github.com/Huo0077/mathcanvas/issues/new/choose) 或发邮件至 **[dogf9066@gmail.com](mailto:dogf9066@gmail.com)**。

---

## 📥 全平台整合下载（v6.0.0）

**`v6.0.0`** 为 **Windows x64 + Android ARM64 全平台整合正式版**（含全新「高等数学」十大模块、AI 精确求解及 Android 桌面自适应启动图标修复），所有安装包与 SHA-256 校验文件统一托管于 [GitHub Releases](https://github.com/Huo0077/mathcanvas/releases/tag/v6.0.0)：

| 平台 | 安装包类型 | 适用场景 | 直链下载 |
| --- | --- | --- | --- |
| **Windows x64** | **NSIS 标准安装程序**（推荐） | 日常使用，含开始菜单快捷方式与标准卸载 | [MathCanvas_6.0.0_x64-setup.exe](https://github.com/Huo0077/mathcanvas/releases/download/v6.0.0/MathCanvas_6.0.0_x64-setup.exe) |
| **Windows x64** | **绿色免安装便携版** | U 盘随身携带、机房免管理员权限即点即用 | [MathCanvas_6.0.0_x64.exe](https://github.com/Huo0077/mathcanvas/releases/download/v6.0.0/MathCanvas_6.0.0_x64.exe) |
| **Windows x64** | **MSI 安装包** | 学校机房域控批量分发 / 静默部署 | [MathCanvas_6.0.0_x64_en-US.msi](https://github.com/Huo0077/mathcanvas/releases/download/v6.0.0/MathCanvas_6.0.0_x64_en-US.msi) |
| **Android ARM64** | **正式签名 APK**（推荐） | Android 7.0+ 手机 / 平板，内置品牌自适应图标与 Material 3 触控重排 | [MathCanvas-6.0.0-android-arm64.apk](https://github.com/Huo0077/mathcanvas/releases/download/v6.0.0/MathCanvas-6.0.0-android-arm64.apk) |

- **校验文件**：[SHA256SUMS-windows.txt](https://github.com/Huo0077/mathcanvas/releases/download/v6.0.0/SHA256SUMS-windows.txt) · [SHA256SUMS-android.txt](https://github.com/Huo0077/mathcanvas/releases/download/v6.0.0/SHA256SUMS-android.txt) · [查看全部历史 Releases](https://github.com/Huo0077/mathcanvas/releases)
- **软件官网门户**：仓库根目录自带纯静态展示门户 [`portal/`](portal/index.html)（含使用说明、实机操作演示视频 `portal/assets/media/demo-workflow.webm`、多工作区交互画廊及 GitHub Releases 直链下载，可直接部署至任意静态 Web 服务器）。

---

## 📸 界面展示

### AI 同屏共创 · 立体几何与构造面自动联动

![MathCanvas 立体几何与 AI 助手同屏共创界面](docs/media/hero-3d-ai-aec.png)

### 四大专业工作区与模型设置中心

| 立体几何多选与视图联动 | 平面圆锥曲线与渐近线求解 |
| :---: | :---: |
| ![立体几何交互与视图联动](docs/media/workbench-3d-dihedral.png) | ![平面圆锥曲线渐近线与切圆](docs/media/workbench-2d-conics.png) |

| 工程制图（CAD 四视图自动投影） | 13 家模型预设与模型列表一键拉取 |
| :---: | :---: |
| ![工程制图四视图投影](docs/media/workbench-cad-views.png) | ![模型服务设置与预设](docs/media/settings-providers.png) |

---

## 🎯 为什么选择 MathCanvas？

| 核心能力对比 | **MathCanvas v6.0** | GeoGebra | Desmos | MATLAB / Python |
| --- | :---: | :---: | :---: | :---: |
| **自然语言数学题直接生成可交互图形** | ✅ 内置 AI 读题 + 数学核验证书门禁 | ❌ 需手动逐条输入指令 | ❌ 仅支持手工输入解析式 | ❌ 需手写绘图代码 |
| **立体几何翻折、以线推面与精确空间角** | ✅ 二面角 / 线面角 / 异面角直出根式 `sin`/`cos` | ⚠️ 偏数值近似，辅助面构造繁琐 | ❌ 3D 几何能力受限 | ❌ 静态脚本绘图 |
| **零代码大学高数 / 线代 / 概率与 60fps PDE 仿真** | ✅ 十大交互可视化实验模块 + AI 精确验算 | ⚠️ 覆盖零散，无内置 PDE 仿真 | ❌ 聚焦一维/二维函数 | ⚠️ 商业授权昂贵或需编程 |
| **3D 模型一键投影标准工程制图四视图** | ✅ 主/俯/左/轴测同步 + SVG/DXF/PDF/HTML | ❌ | ❌ | ❌ |
| **轻量级跨端原生离线安装包** | ✅ Tauri 2（~10 MB）+ Android 签名 APK | ✅ | 🌐 网页 / 移动端为主 | ❌ 桌面体积数 GB |

**🔍 高频适用人群与检索场景**：
- **高中与竞赛师生**：立体几何外接球/内切球、翻折动态轨迹、二面角与线面角根式验证、圆锥曲线渐近线与焦点弦切线探究、课堂交互课件一键导出自包含 HTML。
- **大学生与考研学子**：高等数学极值拐点、拉格朗日乘数法等高线相切、二元曲面鞍点与切平面、常微分方程斜率场与自治系统相平面、热传导/波动/泊松偏微分方程实时仿真、泰勒与傅里叶级数逼近、二重积分黎曼柱、矩阵特征值/SVD 几何变形、中心极限定理抽样实验。
- **工程制图与软件研发者**：三维多面体直出 A4 标准工程四视图（DXF/SVG/PDF），以及基于 React + TypeScript + Three.js + Tauri 2 + Rust 的确定性几何与高数内核架构实践。

---

## ✨ 核心特性

### 1. 智能 AI 读题构图与数学核验证书门禁
- **自然题干直接理解**：输入常见中学或竞赛纯文字数学题（支持单问与多小问递进题），无需手写构图指令。（*说明：识图能力将在后续版本正式接入，当前已通过 `IMAGE_READER_UI_ENABLED = false` 隐藏前端识图 UI 入口。*）
- **主动补线与「以线推面」**：自动提取并补全题设线段与动点约束（中点、定比分点、动点连线 `AE`、`CE`），自动推导构造空间面（如 `面 AEC`），并完整保留实体面内的构造子面（如底面 `ABCD` 内的 `△AEF`）。
- **预览态与提交后图元框全量可见**：Agent 完成作图后，图元框立即以独立「AI 预览图元」分组展示全部待落盘对象并支持点击检视属性；确认写入后多面体与命名折叠面默认展开，直接列出全部**顶点 / 棱 / 面**，且支持 `Ctrl+Z` 一步完整撤销。
- **跨工作区自动路由与往期回溯**：平面解析几何、圆锥曲线切线、函数导数题与立体几何题自动路由到对应维度画布；「往期」面板随时回溯完整推理与上下文。

### 2. 五大专业工作区
- **平面几何（含函数与圆锥曲线）**：点、线、圆、圆弧、椭圆/双曲线/抛物线方程直出、渐近线与切圆自动推导、函数求导/切线/定积分区域，以及曲线轨道动点实时联动与全图元自动取景。
- **立体几何（3D 实时交互）**：常用立体向导、点绑棱/面/实体、两线定面、单顶点拖拽与多面体自动三角化、透明面/隐藏边/法向量/旋转环/展开图双向联动，以及**二面角、线面角（含垂线/射影/直角标记）、空间直线夹角（含异面直线平移辅助线）** `sin` / `cos` 精确值一键复制。
- **高等数学（10 大大学数学交互模块）**：一元极值/拐点/渐近线与 Gauss–Legendre 定积分、拉格朗日乘数法等高线相切与 2D↔3D 抬升联动、ODE 斜率场 RK45 与二维自治相平面稳定性、显式 3D 曲面鞍点与切平面、WebWorker 60fps 二维热传导/波动/泊松 PDE 仿真、Jet 自动微分泰勒与傅里叶轮盘合成、直角/极坐标二重积分与散度旋度探针、二阶矩阵同伦变换/特征值/SVD 及 6 大概率分布与中心极限定理抽样实验，全部直通 AI Agent 机器精度求解。
- **工程制图（CAD）**：由 3D 文档一键自动投影生成标准四视图（主视/俯视/左视/轴测），支持图层管理、2D 工程标注及 SVG / DXF / PDF / 自包含 HTML 交互快照导出。
- **Agent 与多模型服务设置**：内置 **13 家主流模型预设**（DeepSeek、OpenAI、Claude、Gemini、通义千问、智谱 GLM、Kimi、硅基流动、豆包、OpenRouter、Ollama、LM Studio 及自定义 OpenAI 兼容接口），支持一键「自动获取」可用模型列表与丰富的偏好设置。

### 3. Android 移动端深度重构与原生集成
- **Material Design 3 画布优先布局**：窄屏自动切换底部导航栏（释放 100% 屏宽）、精简双行顶栏与单行横向滑动工具条、画布毛玻璃悬浮胶囊、圆角 Bottom Sheet 抽屉与 Android 系统返回键逐级回退。
- **全手势与原生导出分享**：2D 单指平移 / 双指捏合缩放、3D 单指旋转 / 双指缩放平移；通过受控 `@JavascriptInterface` 与 Android 10+ `MediaStore.Downloads` 零权限直出公共 `下载/MathCanvas/` 目录并唤起系统分享面板。
- **跨端本地加密存密**：Windows 使用系统凭据管理器，Android 使用应用私有 `ChaCha20 + HMAC-SHA256` 加密凭据库（禁用 `allowBackup`），API Key 绝不落明文文件。

---

## 🏗️ 系统架构

```mermaid
flowchart LR
  subgraph UI["多端交互层（apps/web · apps/desktop）"]
    Web["React + TypeScript 工作台<br/>2D SVG / 3D Three.js / CAD / 移动端 M3"]
    Host["Tauri 2 + Rust 宿主壳<br/>Windows 凭据库 · Android 加密库 · SQLite · 原生导出"]
  end

  subgraph Core["确定性几何与场景引擎（packages/*）"]
    SG["@draw/scene-graph<br/>响应式依赖图 · 事务 · 单步撤销"]
    GK["@draw/geometry-kernel<br/>2D/3D 求解器 · 圆锥曲线 · 内切球 · 二面角"]
    DSL["@draw/dsl<br/>版本化图元模型 · .mgeo 编解码"]
  end

  subgraph AI["AI 读题与可信核验层（packages/agent-core）"]
    Plan["动作协议与约束规划<br/>13 家模型预设 / 本地确定性规划"]
    Cert["数学核验证书门禁<br/>隔离草稿预览 · 题设逐条验算"]
  end

  Web <--> Host
  Web <--> SG
  SG <--> GK
  SG <--> DSL
  Web <--> Plan
  Plan --> Cert
  Cert --> SG
```

### 仓库目录结构

| 目录 | 职责说明 |
| --- | --- |
| `apps/web` | React + TypeScript 前端工作台（SVG 2D 画布、Three.js 3D 场景、对象树与属性栏、Agent 抽屉、设置中心、移动端 Material 3 适配） |
| `apps/desktop` | Tauri 2 + Rust 原生宿主壳（Windows / Android 加密凭据库、模型列表拉取、SQLite 文档持久化、原生文件导出与系统分享） |
| `packages/dsl` | 版本化几何文档模型、图元 Schema 校验与 `.mgeo` 编解码 |
| `packages/geometry-kernel` | 2D/3D 数值与解析几何求解器、圆锥曲线/导数求导、三点/多点共面、最大内切球与二面角测量引擎 |
| `packages/scene-graph` | 响应式依赖图、宿主/面片拓扑复用、文档事务与撤销/重做栈 |
| `packages/agent-core` | Agent 动作契约、约束/义务验证、离线高数规划与数学核验证书门禁 |
| `docs` | 架构文档、实时状态与版本发布归档（索引见 [`docs/README.md`](docs/README.md)） |
| `portal` | 纯静态软件官网门户（支持直接部署至任意静态 Web 服务器） |
| `e2e` & `scripts` | Playwright 全链路 E2E 测试、Android 打包加固脚本与文档一致性门禁 |

---

## 🚀 快速开始

### 方式一：本地 Web 工作台开发

需安装 Node.js（推荐 `v22+`）与 npm：

```bash
# 1. 安装依赖
npm install

# 2. 启动工作台（默认访问 http://localhost:5173）
npm run dev
```

> Windows PowerShell 若策略限制直接调用 `npm`，请使用 `npm.cmd install` 与 `npm.cmd run dev`。

### 方式二：构建多端原生应用（Windows / Android / Linux，Tauri 2）

需安装 Rust `1.77.2+` 工具链（桌面壳细节见 [桌面端说明](apps/desktop/README.md)）：

```bash
# 启动桌面端开发调试
npm run dev --workspace @draw/desktop

# 构建 Windows 安装包（NSIS + MSI + 便携版）
npm run bundle --workspace @draw/desktop

# 构建并签名 Android ARM64 APK（需 JDK 17/21、Android SDK/NDK 27+ 与 aarch64-linux-android target）
npm run android:init --workspace @draw/desktop
npm run android:build:local --workspace @draw/desktop
```

<details>
<summary><b>⌨️ 点击展开：日常快捷键与画布手势速查</b></summary>

| 功能 | 操作方式 |
| --- | --- |
| 选择与联动编辑 | 单击图元选中，直接拖动点或控制点；`Shift` 点击多选 |
| 绑定动点到线 / 面 / 立体 | 多选「点 + 目标宿主」后在右侧属性栏一键绑定；或选中面/棱点 **「在此面添加动点」** |
| 两线定面 | 在立体几何中多选两条共端点相交线段/棱，右侧属性栏点击 **「作空间面」** |
| 移动与缩放画布 | 中键拖动（2D 下 `Space`+左键拖动）；滚轮缩放；3D 下左键拖空白旋转、右键平移；触屏支持 2D/3D 双指捏合缩放与平移 |
| 测量空间角与三角值 | 选两个面点 **「测量二面角」**、选 1 线 + 1 面/平面点 **「测量线面角」**（展示垂线与射影）、选两条线点 **「测量直线夹角」**（异面直线自动平移展示），右侧查看弧度/角度、`sin`/`cos` 与精确复制 |
| 快速搜索命令 / 撤销重做 | `Ctrl+K` 调起命令搜索；`Ctrl+Z` / `Ctrl+Y` / `Esc` |
| 保存、打开与多格式导出 | 顶部菜单「文件」支持 `.mgeo` 项目文档、SVG / DXF / PDF / PNG / CSV 与自包含 HTML 交互快照 |

</details>

---

## 🧪 研发与质量门禁

```bash
npm run typecheck   # 全仓 TypeScript 类型检查
npm run test:docs   # 文档、链接与版本真值一致性门禁
npm run lint        # ESLint 静态检查
npm run build       # 构建所有工作区包
npm test            # 全量单元测试
npm run test:e2e    # Playwright 浏览器端到端测试
npm run test:rust   # Rust 原生宿主单元测试
```

CI / 发布流水线：
- [`.github/workflows/ci.yml`](.github/workflows/ci.yml)：常规 PR / 主分支构建、类型检查、Rust 测试与 E2E 门禁
- [`.github/workflows/multiplatform-build.yml`](.github/workflows/multiplatform-build.yml)：多平台构建验证
- [`.github/workflows/android-release.yml`](.github/workflows/android-release.yml)：`v*` 版本标签自动并行构建 **Windows x64 三件套 + Android ARM64 签名 APK** 并整合发布至 GitHub Releases

---

## 🤝 参与贡献与安全政策

- 欢迎阅读 [贡献指南（CONTRIBUTING.md）](CONTRIBUTING.md) 参与开发、提交 PR 或通过 [Issue 模板](https://github.com/Huo0077/mathcanvas/issues/new/choose) 反馈难以画出的数学题。
- 安全设计与漏洞报告流程请见 [安全政策（SECURITY.md）](SECURITY.md)。

---

## 📚 文档与版本导航

- **最新发布说明与版本信息**：最新版本标签为 **`v6.0.0`**（[发布说明](docs/release/v6.0.0.md)），完整变更记录见 [CHANGELOG](CHANGELOG.md)，学术与课程引用元数据见 [CITATION.cff](CITATION.cff)。
- **工程进度与技术文档**（总览见 [`docs/README.md`](docs/README.md)）：
  - [当前状态（唯一实时状态入口）](docs/current-status.md)
  - [功能目录](docs/feature-catalog.md)
  - [项目进度日志](docs/project-progress.md)
  - [下一轮工作导航](docs/agent-next-round-progress.md)
  - [Agent 发布前门禁](docs/acceptance/agent-release-gate.md)
  - [系统架构说明](docs/architecture.md)

---

## ⭐ Star History 与版权声明

如果 **MathCanvas** 对你的数学学习、课堂教学、考研复习或技术研究有所帮助，欢迎点击右上角 **Star ★** 支持作者持续迭代！

[![Star History Chart](https://api.star-history.com/svg?repos=Huo0077/mathcanvas&type=Date)](https://star-history.com/#Huo0077/mathcanvas&Date)

<p align="center"><sub>Copyright © Huo0077. All rights reserved. 著作权归作者所有。</sub></p>
