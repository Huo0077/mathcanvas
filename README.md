# MathCanvas

MathCanvas 是面向数学学习与工程绘图的交互式工作台。你可以在平面画布上绘制函数和几何图形，在立体画布中构造、观察和测量三维对象，也可以制作工程图纸。项目仍在持续开发；浏览器版本可以本地运行，部分 Agent 和桌面功能仍处于验证阶段。

## 开始使用

在项目根目录安装依赖并启动浏览器工作台：

```bash
npm install
npm run dev
```

打开终端中 Vite 输出的本地地址。Windows PowerShell 中如无法直接运行 `npm`，可改用 `npm.cmd install` 和 `npm.cmd run dev`。浏览器使用不要求配置模型服务。

### 选择工作区

- **平面几何**：创建点、线、圆、圆锥曲线和函数图像；拖动图元或控制点，查看交点、轨迹和属性，使用公式框编辑函数并创建导函数、切线及积分区域。
- **立体几何**：可在画布按步骤放点、连线、建面；从「常用立体」参数面板预览正方体、长方体、三/四棱柱（可倾斜）与三/四棱锥，确认后才保存。独立空间线/棱可设教学虚线或点线；原有轨道、截面、交面、测量和 Alt 子对象选择仍可用。详见 [功能目录](docs/feature-catalog.md)。
- **工程制图**：从几何模型组织视图与图纸，使用 CAD 2D 绘图、标注及导出功能。
- **Agent 工作区**：输入自然语言请求，查看计划与隔离草稿，**由你确认后**才写入当前文档。没有可用模型服务时，仅支持本地确定性规划器能识别的有限指令；不应把它当作已完成的通用自然语言绘图助手。

顶部模块栏用于切换传统工作区与 Agent 工作区；传统工作区内再切换平面几何、立体几何和工程制图。选中图元后在右侧属性面板调整几何参数或样式。功能按钮会在画布左下方显示下一步操作提示。

### 常用操作

| 操作 | 用法 |
| --- | --- |
| 选择与编辑 | 点击图元选中，拖动图元或控制点；`Shift` 可多选。 |
| 移动画布 | 鼠标中键拖动，或按住 `Space` 再用左键拖动。 |
| 缩放视图 | 滚轮以指针为中心缩放，也可使用画布右下角的视图按钮。 |
| 撤销与重做 | 使用界面按钮或 `Ctrl+Z` / `Ctrl+Y`。 |
| 三维子对象 | 按住 `Alt` 点击实体的棱或面，按需结合 `Shift` 多选。 |
| 立体画布直接作图 | 立体几何中选「绘制空间点/线段/直线/射线/平面/面」，按画布提示逐次点击；落点平面可切换 XY/XZ/YZ，面至少三点后按 Enter 完成，Esc 取消。 |
| 常用立体与教学线型 | 立体画布「常用立体」调整参数并看「未保存预览」，确认后一步撤销；选中空间线/棱，在右侧「外观样式 → 教学线型」选实线/虚线/点线。「隐藏边」仅改变视图。 |
| 取消当前操作 | 按 `Esc`；具体构造步骤以画布提示为准。 |

### 保存与打开

在工作区标签栏使用「保存 `.mgeo`」下载当前几何文档，使用「打开 `.mgeo`」从本地文件恢复。浏览器还会保存本地草稿，便于刷新后继续编辑；这**不是云端备份**，目前没有服务端上传与跨设备同步接口。桌面端另有项目包等功能，详情见 [桌面端说明](apps/desktop/README.md)。

更多图元、测量、导出和操作细节见 [功能目录](docs/feature-catalog.md)。

## 架构与数据流

项目使用 npm workspaces；浏览器工作台由 React、TypeScript、Vite 构建，平面场景使用 SVG，三维场景使用 Three.js。桌面应用以 Tauri 承载同一份前端，不另造一套几何编辑器。

完整的分层设计、技术栈、关键数据流与代码审查发现见 [架构与技术审查](docs/architecture.md)。

| 目录 | 职责 |
| --- | --- |
| `apps/web` | 浏览器界面、画布、属性面板及 Agent 交互。 |
| `apps/desktop` | Tauri 桌面外壳、系统能力与本地存储。 |
| `packages/dsl` | 版本化几何文档、图元类型、校验及 `.mgeo` 编解码。 |
| `packages/geometry-kernel` | 数值几何、约束、交点、曲线与测量计算。 |
| `packages/scene-graph` | 操作、依赖传播、重算、事务与文档状态。 |
| `packages/agent-core` | 能力目录、规划与工具契约、草稿、验收和提交门禁的纯逻辑。 |

传统编辑遵循“界面操作 → 几何/场景计算 → 文档事务 → 画布重绘”的路径。Agent 路径会先观察场景、生成计划并编译为**隔离草稿**；只有草稿通过相应校验且用户明确确认后，宿主才会提交到文档。模型不能直接绕过确认修改现场。关于设计取舍，参见 [增量几何与多会话 Agent 设计](docs/superpowers/specs/2026-09-21-incremental-geometry-agent-and-conversations-design.md) 和 [Agent tool-loop 设计](docs/superpowers/specs/2026-09-28-agent-tool-loop-design.md)。

## 项目进度与能力边界

- **已具备**：平面和立体几何编辑、函数分析、工程制图、本地文档保存/恢复，以及“计划 → 草稿 → 人工确认”的 Agent 基础链路。具体功能范围以 [功能目录](docs/feature-catalog.md) 为准。
- **高中几何交互功能分支（未并入 v3.0 发布版）**：立体按步骤创建、常用实体参数预览和教学线型已有实现与测试；六类教学题的完整组合验收、教师试用、旋转环遮挡改善仍待完成。现状和证据见 [当前状态](docs/current-status.md)、[本专题进度](docs/research/2026-09-29-high-school-geometry-interaction-progress.md) 与 [实施计划](docs/superpowers/plans/2026-09-29-high-school-geometry-interaction-implementation-plan.md)。
- **Agent 已有阶段成果**：只读场景工具、类型化工具调用、确定性的局部验收与发布门禁已有实现和测试；离线评估可用。但工具能力和真实模型绘图质量是两回事，不能把离线得分当成真实模型准确率。
- **仍有限制**：增量草稿工具尚未作为模型可用工具开放；真实场景截图/相机证据与完整视觉检查尚未接通；代表任务的真实 provider pass@1、pass@3、成本和延迟还没有形成可用于放行的测量数据。因此类型化工具循环**尚未满足默认启用的发布门禁**。当前门禁及缺口见 [Agent 发布前门禁](docs/acceptance/agent-release-gate.md)，过程见 [Agent tool-loop 进度记录](docs/research/2026-09-28-agent-tool-loop-progress.md)。
- **其他已知边界**：没有云端同步；部分高级几何输入、精确曲面互交、DWG/B-rep 导入及自动尺寸布局尚未提供。请以界面实际可用入口和 [功能目录](docs/feature-catalog.md) 为准，不把设计文档中的规划视作已交付功能。

桌面版 [v3.0 发布说明](docs/release/v3.0.md) 记录了发布产物及尚未完成的验收；历史迭代与修复记录见 [CHANGELOG](CHANGELOG.md) 和 [项目进度归档](docs/project-progress.md)。历史记录不应直接当作当前测试结果。

## 开发者进度与参与开发

### 本地开发与验证

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run test:rust
npm run eval:agent
```

`test:e2e` 运行 Playwright 浏览器测试；`test:rust` 需要桌面端 Rust 工具链。`eval:agent` 是**离线确定性**评估，不代表真实模型通过率。按改动范围选择相关检查；提交前至少运行对应的类型检查、测试与构建。最新读数请以当次命令结果为准，不沿用历史文档中的用例总数。CI 配置见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)。

### 当前开发重点

本期高中几何交互的下一步是完成旋转手柄/教学图面检查、六类样题与教师/学生走查；下面是并行的 Agent 长期门禁，不代表几何交互已全部验收。

1. 维持 Agent 工具目录、模型可见 schema 和实际分发处理器的一致性；写入仍由宿主和用户确认控制。
2. 补齐需要候选文档与实际渲染证据的验收路径，扩大语义检查覆盖面；对不支持的验证明确标记，而不是报告“完成”。
3. 在具备真实 provider 凭据与代表性任务集后，测量通过率、工具错误率、延迟和成本，再依据 [发布门禁](docs/acceptance/agent-release-gate.md) 决定是否扩大默认使用范围。

逐阶段已完成、延期及待做事项见 [实施计划](docs/superpowers/plans/2026-09-28-agent-tool-loop-implementation-plan.md)、[进度快照](docs/research/2026-09-28-agent-tool-loop-progress.md) 和 [评估记分卡](docs/acceptance/agent-tool-loop-scorecard.md)。协作时请保持 DSL、几何内核、Scene Graph 与 UI 的边界清晰；每个可验证切片同步更新相应文档，并通过功能分支和 Pull Request 提交。
