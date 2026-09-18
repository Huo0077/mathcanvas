# 多模态数理与工程交互绘图引擎

## 实施计划

**文档版本：** v1.3（2026-09-17 状态回填：各阶段落地情况与当前门禁；同日 A1/A2 解析几何两条线与「立体几何最后一轮」四项优化并入 P6）  
**编制日期：** 2026-09-12  
**目标形态：** Web 优先，桌面端可通过 Tauri 封装  
**预计周期：** 18～22 周（小型跨职能团队）

> **当前状态（2026-09-17，「立体几何最后一轮」交付后）**：本计划除 **P4（Agent 与 Provider Router）** 与 **P5（题图解析）** 外均已落地；
> P4 / P5 由用户明确排除（右侧面板精简时收敛了多模态入口，Desktop/Tauri 打包与协同同样未做）。
> P6 立体几何在 v1 四类模板 → v2 点驱动通用拓扑 → v3 可用性修复之上，再叠加两条解析几何交付线：
> **A1 解析二次曲面与"真圆"**（精确圆锥曲线截面 + 按屏幕误差细分的真曲线 + 读数/测量/投影/导出/框选全链路适配）
> 与 **A2 交面按支撑曲面分组 + 真曲面**（50 片→3 区域、曲面∩曲面 49 片→2 区域、解析边界、按屏幕误差吸到真曲面上），
> 以及收束用的 **「立体几何最后一轮」**四件事（约束轨道 `circle3`、拖动旋转三色环、测量数字常驻画布、UI 令牌与平面几何对齐）。
> 最新一次全量门禁：4 个 workspace 类型检查通过、单测 **121 文件 / 1421 用例**、ESLint **0 error / 14 warning**、
> Web 生产构建通过、Playwright **102/102** 通过（`e2e/global-setup.mjs` 会按当前工作区重新构建后再预览）。
> 逐阶段的落地细节、每轮 RED→GREEN 证据与"明确不做"的取舍写在 `docs/project-progress.md`；
> 功能现状与限制见 `docs/feature-catalog.md`。**本文件保留为计划原文 + 状态标注，不再作为进度台账。**

---

## 1. 项目概述

本项目建设一款面向教师、学生、工程人员和数学内容创作者的多模态交互绘图引擎。系统支持输入文字题目、题目图片或手工绘图，通过 Agent 将自然语言和图像解析为结构化几何描述，再由确定性的几何与代数内核完成求解、校验和渲染。

产品覆盖四类工作区：

1. 导数与微积分
2. 圆锥曲线
3. 工程制图与 CAD 三视图
4. 立体几何

系统设计参考 GeoGebra 的工作区组织方式，同时引入类似 CCSwitch 的多供应商模型配置、路由、健康检查与降级能力。

## 2. 项目目标

### 2.1 业务目标

- 降低复杂数学图形的绘制和调试成本。
- 支持题图到可交互模型的半自动转换。
- 让公式、图形、参数、轨迹和标注保持双向联动。
- 为教学演示、作业讲解、工程草图和模型验证提供统一工作台。

### 2.2 技术目标

- 建立版本化的几何 JSON DSL。
- 建立统一 Scene Graph，隔离数据、求解和渲染。
- 使用依赖 DAG 与约束图管理自由对象和派生对象。
- 让 Agent 只能通过经过校验的 Domain Patch 修改场景。
- 支持云端模型和本地 Ollama/vLLM 模型切换。
- 支持离线编辑、文件保存、撤销重做和后续协同扩展。

## 3. 建设范围

### 3.1 首期范围（MVP）

- 2D 解析几何画布
- 点、线、圆、圆锥曲线、交点、垂线、平行线
- 坐标轴、网格、吸附、标签和属性面板
- Algebra View 与派生对象管理
- 参数滑块、动点和轨迹
- JSON DSL v0.1
- DAG 依赖计算和基础约束求解
- Agent 文本指令到 Domain Patch
- OpenAI-compatible、Anthropic、Ollama Provider
- `.mgeo` 项目文件保存与恢复

### 3.2 后续范围

- 题图视觉解析
- 立体几何和 Three.js 渲染
- 工程制图和三视图投影
- 复杂符号求解和证明辅助
- 多人协作、评论和课堂共享
- Tauri 桌面应用与离线模型包

## 4. 优化后的总体架构

```text
React 工作台
├── Global Header / Workspace Tabs
├── Geometry Toolbar
├── Algebra View
├── Graphics View
│   ├── Canvas 2D Renderer
│   ├── SVG Interaction Overlay
│   └── Three.js Renderer
├── Properties Bar
└── Agent Dock

统一数据层
├── Geometry Document
├── Scene Graph
├── Dependency DAG
├── Constraint Graph
├── Transaction Manager
└── Undo / Redo Command Stack

计算层
├── Expression AST
├── Math.js Numeric Layer
├── Geometry Kernel
├── Constraint Solver
└── Optional SymPy Validation Service

AI 与基础设施
├── Agent Runtime
├── DSL Compiler
├── Patch Validator
├── Provider Router
├── Health Monitor
└── Token / Cost Monitor
```

### 4.1 技术选型

| 模块 | 首选方案 | 选型理由 |
|---|---|---|
| 前端 | React + TypeScript + Vite | 生态成熟，适合复杂工作台 |
| 状态管理 | Zustand | 轻量、可拆分 slice、适合高频局部更新 |
| 2D 绘制 | Canvas 2D + SVG Overlay | Canvas 负责性能，SVG 负责标签和交互 |
| 3D 绘制 | Three.js | 相机、拾取、透明面和动画能力成熟 |
| 表达式 | Math.js | 解析和数值计算易于集成 |
| 数学向量 | gl-matrix | 适合 2D/3D 变换和矩阵运算 |
| 符号验证 | SymPy 服务或 Worker | 避免把大型符号内核强行放入主线程 |
| 桌面封装 | Tauri | 体积小，支持系统 Keychain 和本地模型 |
| 本地存储 | IndexedDB + `.mgeo` 文件 | 支持离线草稿和可迁移文件格式 |
| 后端 | Node.js/Fastify + Python Solver Service | API 路由和数学求解分别使用合适生态 |

## 5. 核心数据与协议

### 5.1 Geometry Document

```ts
interface GeometryDocument {
  schemaVersion: string
  revision: number
  workspace: "calculus" | "conics" | "cad" | "geometry3d"
  coordinateSystems: CoordinateSystemSpec[]
  parameters: Record<string, ParameterSpec>
  primitives: PrimitiveSpec[]
  constraints: ConstraintSpec[]
  dynamics: DynamicSpec[]
  annotations: AnnotationSpec[]
  metadata: DocumentMetadata
}
```

要求：

- 所有对象拥有稳定 ID。
- DSL 必须有 `schemaVersion`。
- 文件格式必须支持迁移。
- 对象、参数、约束、轨迹均可被 Agent 引用。
- 任何渲染器不得成为数据事实源。

### 5.2 Domain Patch

Agent 和 UI 都通过领域命令修改文档：

```ts
type DomainOperation =
  | { op: "addPrimitive"; primitive: PrimitiveSpec }
  | { op: "updateParameter"; id: string; value: number }
  | { op: "bindSlider"; target: string; parameter: string }
  | { op: "setStyle"; target: string; patch: StylePatch }
  | { op: "toggleVisibility"; target: string; visible: boolean }
  | { op: "createLocus"; target: string; parameter: string }
  | { op: "deleteObject"; target: string }
```

所有 Patch 都必须经过：

1. JSON Schema 校验
2. 权限和危险操作检查
3. 依赖关系检查
4. 数学约束求解
5. 预览和确认
6. 事务提交

## 6. 实施阶段与排期

| 阶段 | 周期 | 主要工作 | 阶段交付物 | 落地状态（2026-09-17） |
|---|---:|---|---|---|
| P0 技术验证 | 1 周 | 仓库、CI、DSL 草案、渲染 Demo | 可加载并显示最小场景 | **已完成** |
| P1 数学内核 | 3 周 | 表达式、点线圆、交点、DAG、撤销 | 2D 内核 v0.1 | **已完成**（含"增量重算 ≡ 全量重算"的性质测试） |
| P2 工作台 UI | 2 周 | GeoGebra 风格布局、工具栏、属性栏 | 可交互工作台 | **已完成**（Ribbon / 检查器 / 模型树 / 状态栏） |
| P3 圆锥与微积分 | 3 周 | 椭圆、抛物线、导数、轨迹、滑块 | 数学工作区 MVP | **已完成**（微积分工作区标签按用户要求退役，函数与圆锥曲线保留） |
| P4 Agent 与路由 | 3 周 | Provider、健康检查、Patch、降级 | 可对话修改画布 | **未做（用户明确排除）** |
| P5 题图解析 | 3 周 | OCR、视觉识别、置信度、DSL 编译 | 题图导入闭环 | **未做（用户明确排除）** |
| P6 立体几何 | 4 周 | Three.js、剖切、隐藏线、折叠 | 3D 工作区 Beta | **已完成**（+ 绑定宿主 / 实体内约束 / 交面交线交点 / 固定 1 单位网格；**2026-09-17 再叠加 A1 解析二次曲面与真圆、A2 交面分组与真曲面**） |
| P7 工程制图 | 3 周 | 三视图、投影、尺寸、公差 | CAD 工作区 Beta | **已完成**（尺寸 / 角度 / 公差标注、SVG/DXF/PDF 导出、2D 绘图与夹点编辑） |
| P8 稳定性发布 | 2～3 周 | 性能、安全、迁移、打包、文档 | MVP/正式版候选 | **部分完成**：性能与文档已做（含 2026-09-17 全身大体检十批）；Tauri 打包与协同未做 |

## 7. 详细任务分解

### P0：技术验证

**状态：** 已完成（npm workspaces monorepo：`apps/web` + `packages/dsl` / `geometry-kernel` / `scene-graph`；TypeScript、ESLint、Vitest、Playwright 全部在门禁里）。

任务：

- 建立 monorepo 和包边界。
- 建立 TypeScript、ESLint、Vitest、Playwright 基础配置。
- 定义 DSL v0.1 和 `.mgeo` 文件头。
- 完成点、线、圆、立方体的最小渲染。
- 建立一条从 JSON 到画布的完整链路。

完成标准：

- 能读取 JSON 并显示图形。
- 能保存和恢复场景。
- 2D、3D 渲染器均使用稳定对象 ID。

### P1：数学内核

**状态：** 已完成。表达式 AST / 变量环境、点线圆与圆锥曲线、交点（含全部解与去重尺度）、依赖 DAG 与**拓扑增量重算**、平面与空间约束求解、Undo/Redo 与事务回滚都在内核里；2026-09-17 的全身大体检额外补上"增量重算 ≡ 全量重算"的性质测试（`packages/scene-graph/src/recomputeConsistency.test.ts`）与一批容差 / 退化输入修复。

任务：

- 表达式 AST 与变量环境。
- 点、线、线段、圆、圆弧。
- 交点、垂线、平行线。
- 依赖 DAG 和局部增量重算。
- 基础约束投影。
- Undo/Redo 和事务回滚。

完成标准：

- 任意参数修改后派生对象同步更新。
- 非法约束不会污染当前文档。
- 1000 个图元下基础交互可用。

### P2：工作台 UI

**状态：** 已完成。统一 Ribbon（工作区标签 + 命令组）、工程制图工作台（命令栏 / 停靠面板 / 模型树·图层树·图纸树 / 状态栏）、上下文检查器、窄屏三档布局都已落地；右侧的约束面板与智能体面板按用户要求移除（数据保留）。

任务：

- 顶部工作区切换。
- 工具栏和快捷键。
- Algebra View 分类树。
- Graphics View 缩放、平移、吸附。
- Properties Bar 样式编辑。
- Agent Dock 占位和会话状态。

完成标准：

- 选中、隐藏、锁定和删除对象均可用。
- 属性修改可实时反映到画布。
- 支持窄屏布局，不产生横向溢出。

### P3：圆锥曲线与微积分

**状态：** 已完成（含一处刻意的范围收敛）。椭圆 / 双曲线 / 抛物线及其特征点、一阶二阶导数、切线 / 法线 / 零点 / 极值 / 拐点、积分区域、参数滑块、**动点（曲线约束 + 轨迹）**都在；"微积分"工作区标签按用户要求退役，函数与圆锥曲线能力保留在平面几何工作区。

任务：

- 椭圆、双曲线、抛物线。
- 焦点、准线、渐近线。
- 一阶和二阶导数。
- 切线、法线、极值、零点、拐点。
- 滑块、动点和轨迹。

完成标准：

- 公式和图形双向联动。
- 特征点能自动探测并高亮。
- 轨迹可保存为独立对象。

### P4：Agent 与 Provider Router

**状态：** **未做（用户明确排除）**。多模态 / 智能体入口在右侧面板精简时被收敛掉，`constraintOptionsFor` / Agent Dock 相关 UI 已删除；数据层与 Patch 校验路径（`validatePatch` + `DomainOperation`）仍然完整，因此将来若要恢复，接入点是现成的。

任务：

- Provider Adapter。
- 模型配置集。
- 连通性检测与延迟统计。
- 熔断、重试和降级。
- Agent Context Builder。
- DSL Patch 生成与校验。
- Patch 预览、确认和回滚。

完成标准：

- 支持至少一个云端 Provider 和 Ollama。
- 模型输出错误不会直接破坏场景。
- 可配置跨 Provider 降级策略。
- API Key 不进入明文 localStorage。

### P5：题图解析

**状态：** **未做（用户明确排除）**。

任务：

- 图片粘贴、上传和裁剪。
- OCR 和视觉实体识别。
- 点线面、角度、平行、垂直关系提取。
- 置信度和人工确认。
- 从解析结果生成 DSL。

完成标准：

- 基础平面几何题可生成可编辑草图。
- 低置信度关系必须进入确认流程。
- 解析失败时保留中间结果和原图。

### P6：立体几何

**状态：** 已完成并超出原计划。除相机 / 空间拾取 / 点线面多面体旋转体 / 隐藏线与透明面 / 法向量 / 截面剖切 / 折叠展开 / 二面角外，还有：动点绑定宿主（线 / 面 / 曲面 / **实体内**）、交面·交线·交点三个独立图元（自动枚举 + 点击创建 + 随来源重算）、自动取景与相机跨工作区记忆、**背景网格一格恒为 1 个世界单位**、渲染管道的按签名增量同步。

任务：

- Three.js 相机和空间拾取。
- 点、线、面、多面体、旋转体。
- 隐藏线、透明面和法向量。
- 截面剖切、折叠展开、二面角。

完成标准：

- 立方体、棱锥、圆柱、圆锥可旋转和剖切。
- 3D 对象能进入 Algebra View。
- 常见教学模型保持流畅交互。

### P7：工程制图

**状态：** 已完成。世界坐标模型、四视图（主 / 俯 / 左 / 轴测）、投影线与投影来源切换、线性 / 角度 / 公差标注、图层与图纸布局、2D 直接绘图（夹点编辑 / 捕捉 / 偏移 / 修剪延伸 / 方向框选 / 坐标键入）、SVG / DXF / PDF 导出、图纸打印比例与显式缩放都在；导出现在会导出**全部**视图（不再截断到 4 个），PDF 对 WinAnsi 之外的字符做替换而不是整体失败。

任务：

- 世界坐标模型。
- 主视图、俯视图、左视图、轴测图。
- 投影线联动。
- 尺寸链、公差、圆角、倒角。
- SVG、PDF、DXF 导出。

完成标准：

- 一个 3D 模型可以生成多视图。
- 修改模型后多视图同步更新。
- 导出结果具备基本工程可读性。

## 8. 测试与验收策略

**现状（2026-09-17，「立体几何最后一轮」交付后）**：单元 / 集成 / 浏览器三层都在跑。`npm.cmd test` 覆盖 4 个 workspace 共 **121 个文件 / 1421 个用例**；`npx playwright test` 覆盖 **102 个浏览器用例**（含 Ribbon、CAD 工作台、3D 交集预览与交面分组 / 真曲面、真圆与屏幕误差细分、拖动跟手与偏移一致性读数、平面网格固定、动点拖动性能、空间圆轨道与沿轨道滑动、拖动旋转环与 15° 吸附、测量数字常驻两个画布、立体几何与平面几何的纸令牌一致）；ESLint 0 error / 14 warning；生产构建通过。**未做**：Provider 错误分类与"Agent 指令 → Patch → 预览 → 提交"、"题图 → 解析 → DSL → 画布"这三类测试随 P4 / P5 一并排除；2D 5000 图元与 3D 100000 三角面的性能指标没有专门的基准测试（只有布尔交集与拖动增量的实测记录）。

### 8.1 单元测试

- 表达式解析
- 几何基础算法
- 交点和投影
- 约束求解
- DAG 拓扑排序
- DSL 迁移
- Patch 校验
- Provider 错误分类

### 8.2 集成测试

- DSL → Scene Graph → Renderer
- 参数修改 → DAG → 约束求解 → 增量渲染
- Agent 指令 → Patch → 预览 → 提交
- 题图 → 解析 → DSL → 画布
- 3D 模型 → 三视图投影

### 8.3 性能指标

| 指标 | 目标 |
|---|---:|
| 普通参数更新 | 95% 小于 50ms |
| 2D 5000 图元 | 基础交互保持 60 FPS |
| 3D 100000 三角面 | 保持可交互 |
| Provider 健康检查 | 3 秒内返回 |
| Patch 校验 | 100% 拦截非法操作 |
| 场景恢复 | 结果确定性一致 |

## 9. 风险与应对

| 风险 | 影响 | 应对策略 |
|---|---|---|
| Agent 生成错误几何关系 | 高 | Patch 校验、约束求解、置信度和人工确认 |
| 2D/3D 状态分裂 | 高 | 统一 Scene Graph 和稳定对象 ID |
| 复杂约束无法收敛 | 高 | Solver Group、迭代上限、回滚机制 |
| API Key 泄露 | 高 | Keychain、服务端 Vault、隐私路由策略 |
| 3D 性能不足 | 中 | 增量渲染、LOD、Worker、对象合批 |
| DSL 版本不兼容 | 中 | schemaVersion、迁移脚本和回归样例 |
| 供应商接口变化 | 中 | Provider Adapter 和契约测试 |
| 题图识别置信度低 | 中 | 中间结果展示、人工确认和可编辑草图 |

## 10. 团队分工

| 角色 | 主要职责 |
|---|---|
| 技术负责人 | 架构、协议、代码规范、里程碑管理 |
| 前端/交互工程师 | React 工作台、工具栏、Algebra View、属性栏 |
| 渲染工程师 | Canvas、SVG Overlay、Three.js、拾取和性能 |
| 数学内核工程师 | 表达式、几何算法、约束求解、数值稳定性 |
| Agent/后端工程师 | Provider Router、Agent Runtime、题图流水线 |
| QA/数学内容测试 | 数学正确性、交互回归、性能和兼容性 |

## 11. 首个可发布版本定义

首个可发布版本不追求一次覆盖全部工作区，而应确保以下闭环稳定：

```text
输入数学题目
  ↓
生成或手工编辑 DSL
  ↓
2D 画布显示对象
  ↓
拖动点或滑块
  ↓
公式、交点和轨迹同步更新
  ↓
通过自然语言修改当前场景
  ↓
Agent 生成 Patch
  ↓
预览、校验并提交
```

建议首发版本只包含：

- 2D 解析几何
- 圆锥曲线
- 基础微积分
- Algebra View
- DSL 和 DAG
- Agent Patch
- OpenAI-compatible 和 Ollama
- `.mgeo` 文件保存

立体几何和工程制图作为第二阶段 Beta，可以在核心协议稳定后加入，避免早期因 3D、CAD 和 Agent 同时建设导致项目失控。

**实际交付顺序与计划不同（2026-09-17 记录）**：立体几何与工程制图**先于** Agent 完成，而 Agent / 题图解析被用户明确排除；首发版本定义里的"Agent Patch、OpenAI-compatible 与 Ollama"两条因此不再适用。当前可发布闭环是：

```text
手工绘制 / 打开 .mgeo 或题图之外的输入
  ↓
DSL 文档（.mgeo，schemaVersion 0.1）
  ↓
2D / 3D / CAD 画布显示对象
  ↓
拖动点、滑块或夹点
  ↓
依赖图增量重算 → 交点、轨迹、截面、交面交线交点、测量与标注同步更新
  ↓
导出（.mgeo / SVG / PNG / CSV / DXF / PDF）
```

## 12. 项目启动后的第一周任务清单

**状态：** 全部完成（当时作为 P0/P1 的起点，验收标准"两条直线 + 交点 + 参数联动 + 撤销恢复"由 `App.test.tsx` 的冒烟用例覆盖）。

- 建立 monorepo 和包边界。
- 初始化 React + TypeScript + Vite。
- 创建 `packages/dsl`、`packages/scene-graph`、`packages/geometry-kernel`。
- 编写 Geometry DSL v0.1 JSON Schema。
- 实现点、线、圆三个基础图元。
- 实现一个参数滑块和一个交点派生对象。
- 建立第一条 DAG 重算链路。
- 完成 `.mgeo` 最小保存/恢复。
- 建立一条从 UI 操作到 Scene Patch 的完整测试。

**第一周的验收标准：**打开应用后，可以创建两条直线、看到交点、修改直线参数、观察交点同步移动，并且可以撤销和恢复整个操作。

