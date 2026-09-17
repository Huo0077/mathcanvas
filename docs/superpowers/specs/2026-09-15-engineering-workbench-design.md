# Engineering Workbench Hierarchy Design

> Status: Implemented (Task 1-7 delivered and verified; the 2026-09-16 usability amendments are recorded in "Amendments" at the end of this document). Reviewed 2026-09-17: the doc-set audit added engineering annotations (linear / angular / tolerance), full-view SVG / DXF / PDF export (no 4-view truncation) and keyboard-operable grips; see `docs/project-progress.md` for the current gate.
>
> This design follows the approved direction: 2D drafting and 3D-to-engineering-drawing workflows have equal priority, while the existing geometry and projection kernels remain reusable.

## Goal

将当前扁平的 CAD 工作区重构为经典 CAD 风格的工程制图工作台，使用户能够在同一套界面中：

1. 直接绘制和编辑 2D 工程图。
2. 从 3D 模型生成、整理和标注正交投影视图。
3. 使用模型树、图层树、图纸树和上下文属性面板快速定位对象。

## Background

当前 `apps/web/src/App.tsx` 将工具栏、对象列表、画布、属性栏和 Agent 面板直接拼接在一个工作区中。`GeometryToolbar` 同时展示创建、编辑、导入导出和多模态入口；`EngineeringDrawingView` 只渲染四张固定视图卡片；`AlgebraView` 主要承担对象列表，没有工程图纸、图层和视图布局语义。

现有 P7 已提供以下可复用能力：

- `packages/dsl` 中的 `GeometryDocument`、稳定对象 ID 和 `engineeringAnnotations`。
- `packages/geometry-kernel` 中的投影、深度排序、测量和工程标注计算。
- `apps/web/src/projectionVisuals.ts` 中 renderer-neutral 的 `ProjectedDrawing`。
- SVG、DXF、PDF 导出器以及旧 `.mgeo` 兼容解码。

本次改版不重写这些计算和导出能力，只重构其周围的工作台层次和可持久化的图纸组织。

## Research Basis

公开项目调研来源：

- [LibreCAD](https://github.com/LibreCAD/LibreCAD)：Layer Tree 支持树形/列表模式、过滤、拖拽重组、层级批量操作、锁定/显隐/打印标志和上下文菜单。
- [QCAD](https://github.com/qcad/qcad)：`RCadToolBar` 与 `RCadToolBarPanel` 采用堆叠式二级命令面板，进入工具类别后显示子命令，并提供返回路径。
- [FreeCAD](https://github.com/FreeCAD/FreeCAD)：Workbench 负责按工作台装配菜单、工具栏和停靠窗口；Property View 将对象属性集中在独立面板并区分不同属性页。

抽象出的共同原则：

1. 工具按任务分层，而不是一次展示全部命令。
2. 对象组织、图层组织和属性编辑必须是独立但可联动的停靠面板。
3. 当前工作台决定可见工具和面板，切换工作台不破坏文档对象。
4. 视图中的选择必须能回溯到稳定的源对象。

## Scope

### Included

- 工程制图工作台的经典 CAD 布局。
- 2D 绘图与 3D 投影两种工作模式。
- 模型树、图层树、图纸/视图树。
- 可持久化图层和图纸视图布局。
- 分层命令面板、命令提示、Esc 取消和基础快捷键。
- 投影视图与 3D 源对象之间的双向选择联动。
- 上下文属性、外观、约束和工程标注面板。
- 旧 `.mgeo` 文件迁移、现有导出能力复用和相关测试。

### Not Included

- B-rep、网格或 DWG 导入。
- 完整透视工程图和隐藏线消除算法重写。
- 完整 GD&T 标准库和自动尺寸布局优化。
- 协作编辑、服务端文件存储和用户权限系统。
- 替换现有 `geometry-kernel` 投影算法。

## User Experience Design

### Workbench Modes

保留现有 `cad` 工作区作为工程制图入口，在其中增加模式切换：

- `3D 投影`：从 3D 模型选择对象，生成或更新主视图、俯视图、左视图和轴测图。
- `2D 绘图`：直接在图纸或模型视口中创建点、线、圆、圆弧和折线，并使用当前图层管理对象。

`geometry3d` 仍作为独立的三维建模工作区；切换工作区只切换视图和工具，不清空文档。

### Shell Layout

```text
┌──────────────────────────────────────────────────────────────┐
│ 文件  撤销/重做  工作台  视图模式                 搜索/设置 │
├──────────────────────────────────────────────────────────────┤
│ 选择  创建  修改  标注  检查  导出        当前工具子面板   │
├──────────────┬───────────────────────────────┬───────────────┤
│ 模型/图层/图纸 │       主工程图画布            │ 上下文属性     │
│ 左侧停靠面板  │       图纸或当前视口          │ 数据/外观/约束 │
│              │                               │ 工程标注       │
├──────────────┴───────────────────────────────┴───────────────┤
│ 命令提示 | 捕捉 | 单位 | 比例 | 当前图层 | 诊断/错误        │
└──────────────────────────────────────────────────────────────┘
```

#### Top Command Bar

一级命令只保留任务类别：选择、创建、修改、标注、检查、导出。选择类别后显示二级命令；二级面板保留明确的返回按钮。文件、撤销、重做和保存属于全局操作，不与几何创建混排。

#### Left Dock

使用标签页切换三个树：

- **模型树**：实体、点、棱、面、派生对象和测量结果。
- **图层树**：层级、当前层、可见、锁定、打印、颜色和线型。
- **图纸树**：图纸、视图窗口、视图类型、比例和来源对象。

树节点支持单击选择、双击编辑、右键上下文菜单、展开/收起和过滤。批量显隐与锁定作用于子树。

#### Center Canvas

中心区域支持三种显示模式：

- **图纸布局**：显示纸张边界、标题栏和可移动/缩放的视口。
- **单视图**：专注编辑主视图、俯视图、左视图或轴测图。
- **四视图**：保留 P7 的四视图联动，作为布局模板而不是固定四张卡片。

投影线是临时辅助状态，可显示/隐藏，不参与删除、锁定和撤销。点击投影视图中的对象时，所有同源视图和模型树中的源对象同步高亮。

#### Right Inspector

右侧只显示当前选择适用的属性，分为：

- **数据**：名称、坐标、尺寸、来源和只读派生关系。
- **外观**：颜色、线宽、线型、可见性和当前图层。
- **约束**：相关约束、残差和删除/修复入口。
- **工程标注**：线性、角度、公差、圆角和倒角标注。

无选择时显示当前图纸、当前图层和视图设置；多选时显示批量操作，不伪造单对象字段。

#### Bottom Status Bar

固定显示命令提示、当前步骤、捕捉状态、坐标、单位、比例、当前图层和错误/诊断数量。命令进行中按 `Esc` 取消当前步骤，不撤销已经提交的对象。

## Data Model

### Persisted Document Fields

在 `GeometryDocument` 中增加向后兼容的可选字段：

```ts
interface LayerSpec {
  id: string
  name: string
  parentId?: string
  kind: "geometry" | "dimension" | "construction" | "annotation" | "reference"
  visible: boolean
  locked: boolean
  printable: boolean
  color?: string
  lineStyle?: "continuous" | "dashed" | "center"
}

interface DrawingViewSpec {
  id: string
  kind: "model" | "front" | "top" | "left" | "axonometric"
  sourceIds?: string[]
  x: number
  y: number
  width: number
  height: number
  scale: number
  visible: boolean
  showProjectionLines: boolean
}

interface DrawingSheetSpec {
  id: string
  name: string
  paper: "A4" | "A3" | "A2" | "custom"
  orientation: "portrait" | "landscape"
  scale: number
  viewIds: string[]
}
```

`GeometryDocument` 增加：

```ts
layers?: LayerSpec[]
drawingViews?: DrawingViewSpec[]
drawingSheets?: DrawingSheetSpec[]
activeLayerId?: string
activeSheetId?: string
```

这些字段采用可选形式，保持旧 `.mgeo` 可解码。解码迁移规则：

1. 缺少 `layers` 时创建默认几何层、尺寸层、辅助层和注释层。
2. 缺少 `drawingSheets` 时创建一张默认 A4 横向图纸。
3. `cad` 文档默认创建四个 P7 视图；旧对象全部放入默认几何层。
4. 现有 `engineeringAnnotations` 保持原有 ID、来源和计算状态。

### Derived Versus Persisted State

投影几何、深度排序和诊断继续由 `resolveProjectedDrawing` 派生，不写回源图元。图层归属、图纸尺寸、视口位置、比例和视图可见性属于文档状态，进入 `.mgeo` 和 undo history。当前选中的节点、展开状态和命令面板属于 UI 状态，可保存在本地工作区偏好中但不写入文档。

## Component Boundaries

### New Components

- `EngineeringWorkbench.tsx`：装配工程图工作台布局和模式切换。
- `CommandBar.tsx`：一级/二级命令导航、返回和活动命令状态。
- `DocumentTreePanel.tsx`：模型树、图层树、图纸树标签容器。
- `LayerTree.tsx`：层级显示、过滤、批量显隐/锁定和当前层。
- `DrawingSheetView.tsx`：纸张、标题栏和可布局视口。
- `DrawingViewport.tsx`：单个投影视口，复用 `ProjectedDrawing`。
- `EngineeringInspector.tsx`：上下文属性标签。
- `StatusBar.tsx`：命令、捕捉、单位、比例和诊断状态。

### Existing Components To Refactor

- `App.tsx`：从直接拼接布局改为传递工作台状态和文档操作。
- `GeometryToolbar.tsx`：拆成全局命令和工程图 `CommandBar`，去除 CAD 专属大杂烩入口。
- `AlgebraView.tsx`：保留模型树能力，迁移到 `DocumentTreePanel`。
- `EngineeringDrawingView.tsx`：从固定四卡片改为 `DrawingSheetView` 和 `DrawingViewport`。
- `PropertiesBar.tsx`：拆分为上下文 Inspector 子页，复用现有字段逻辑。
- `styles/global.css`：加入停靠面板、树、纸张和命令面板的布局 token，保持现有响应式和焦点样式。

### Core/Data Files To Update

- `packages/dsl/src/types.ts`：增加图层、图纸和视图类型。
- `packages/dsl/src/codec.ts`：默认值与旧 `.mgeo` 迁移。
- `packages/dsl/src/schema.ts`：新字段校验。
- `packages/scene-graph/src/operations.ts`：图层/图纸/视图的增删改和 undo 操作。
- `packages/scene-graph/src/patches.ts`：新操作的 patch 校验和引用保护。
- `apps/web/src/store.ts`：UI 工作台状态与文档状态边界。
- `apps/web/src/persistence/draftStorage.ts`：工作台布局偏好和文档草稿兼容。

## Key Interaction Flows

### 3D To Engineering Drawing

1. 用户在 `geometry3d` 选择实体或面。
2. 切换到 `cad` 的 `3D 投影` 模式。
3. 系统创建或更新默认图纸和四个视图窗口。
4. 用户在图纸树选择视图，在右侧调整比例、位置和投影线。
5. 用户在任意投影视图点击对象，模型树和其他同源视图同步高亮。
6. 用户添加工程标注，标注保留来源 ID，并随源对象更新重新计算。
7. 用户导出 SVG、DXF 或 PDF，导出器消费同一组 `ProjectedDrawing` 数据。

### Direct 2D Drafting

1. 用户进入 `cad` 的 `2D 绘图` 模式。
2. 用户在图层树创建或激活图层。
3. 用户从 `创建` 命令面板选择线、圆、圆弧或折线。
4. 底部命令栏显示当前步骤，例如“指定第一点”“指定第二点”。
5. 新对象写入当前图层，继承图层的默认颜色和线型。
6. 用户可通过模型树、图层树或画布选择对象，在 Inspector 中编辑属性。
7. `Esc` 取消当前未完成命令；`Ctrl/Cmd+Z` 只撤销已提交操作。

## Error Handling

- 缺少源对象的图纸视图显示“来源已删除”，不生成伪造几何。
- 无效图层引用在解码时回退到默认几何层，并在状态栏报告迁移诊断。
- 删除仍被视图、标注、约束或测量引用的对象时，沿用现有引用保护并提供可读解释。
- 无选择时禁用对象专属命令；命令进行中禁用互斥的工作台切换或明确提示取消。
- 导出失败保留当前文档和选择状态，只在状态栏及可展开诊断区域显示错误。

## Accessibility and Responsive Rules

- 所有树节点、标签页、命令按钮和视口拥有可读名称和键盘焦点。
- 图标按钮必须有 `aria-label`；选中、展开、显隐和锁定使用 `aria-pressed` 或 `aria-expanded`。
- 触控目标不小于 44px，焦点轮廓不能被面板裁剪。
- 窄屏下左侧和右侧停靠面板变为可切换抽屉，中心图纸保持可横向滚动，不压缩到不可编辑。
- 遵循现有 `prefers-reduced-motion` 规则；不依赖 hover 作为唯一操作入口。

## Performance

- `ProjectedDrawing` 按文档 `revision` 与视图 ID 缓存，图层显隐只过滤渲染结果。
- 树节点使用稳定 ID 和局部更新，避免每次选择重建全部树。
- 图纸布局拖动只更新视图布局状态，结束拖动后再触发持久化。
- 不为每个视口重复扫描完整拓扑；沿用 P7 的共享投影派生结果。

## Verification Plan

### Unit and Component Tests

- 新字段编码/解码、旧 `.mgeo` 默认迁移和非法引用诊断。
- 图层增删改、父子层级、批量显隐/锁定和 undo/redo。
- 图纸与视图布局更新、默认四视图生成和来源 ID 保持。
- 命令面板的一级/二级导航、返回、Esc 取消和禁用条件。
- Inspector 按选择类型显示正确字段，多选不泄漏单对象字段。

### E2E Acceptance

1. 进入 2D 绘图模式，创建一个图层和一条线，确认线出现在当前层并可通过层树隐藏。
2. 进入 3D 投影模式，生成四视图，点击投影对象后确认源对象和其他视图同步选中。
3. 移动或缩放视图窗口，刷新页面后确认图纸布局恢复。
4. 添加线性工程标注，修改源对象后确认标注重算且无效状态可解释。
5. 使用键盘完成选择、进入命令、Esc 取消和 Inspector 编辑。
6. 导出 SVG、DXF、PDF，确认仍使用 P7 的导出器且不生成空视图伪线。

### Regression Gate

保留现有 42 个测试文件、388 个单测和 21 个 E2E 的回归基线；新增工作台切片后按“切片测试 → 全量单测 → 类型检查 → lint → build → E2E”顺序验证。

## Rollout Phases

### Phase 1: Shell and Navigation

完成工作台布局、命令分层、树标签、Inspector 标签和底部状态栏；先复用现有文档字段，不新增复杂几何能力。

### Phase 2: Layers and Persistence

加入 `LayerSpec`、默认层、层树操作、当前层和 `.mgeo` 迁移。

### Phase 3: Sheets and Viewports

加入图纸、视图窗口、布局模式和可持久化比例/位置；将四视图迁移为默认布局模板。

### Phase 4: Linked Editing and Polish

完成 2D/3D 双向选择、上下文 Inspector、命令提示、快捷键、无障碍、导出回归和 E2E。

## Acceptance Criteria

方案完成必须满足：

1. 用户不需要在一条超长工具栏中寻找所有命令。
2. 用户能明确看到当前工作台、当前图层、当前图纸和当前视图。
3. 2D 对象可以按图层创建、显隐、锁定和编辑。
4. 3D 投影视图能回溯源对象，并在多个视图间同步选择。
5. 图纸布局刷新后保持，旧 `.mgeo` 文件仍可打开。
6. 现有工程标注和 SVG/DXF/PDF 导出功能不回归。
7. 键盘、焦点、空状态、错误状态和窄屏布局均可用。

## Amendments (2026-09-16, Task 15-18)

Task 1-7 交付后，三条用户反馈暴露出本设计里的三处不足。以下修订**不改变**上面的文档模型与组件边界，只修正交互归属与来源语义；实现与验证证据见 `docs/project-progress.md` 的「工程制图可用性修复（Task 15-18）」，截线的详细决策见 `docs/superpowers/specs/2026-09-16-section-intersection-primitives-design.md`。

1. **2D 绘图命令的归属**（原文只在「Direct 2D Drafting」流程里描述步骤，没有说明控件画在哪）：绘图命令（坐标输入、长度/角度、角度约束与栅格捕捉开关、偏移/修剪/延伸）属于**图纸之外**的那一行工具条（`DraftControlsRow` 通过 `DrawingSheetView` 的 `draftControlsSlot` 出现在图纸工具条上，与缩放控件同一行），画布内部不再有第二套控件。原来的"视口工具栏"是造成「中间的画布内容十分混乱」的直接原因——图框、视图框、命令按钮和读数挤在同一层。
2. **工具条单行是硬约束**：新增命令组必须塞进同一行（`--drawing-toolbar-height`）。实测工具条一旦换行会把纸张从 128% 压到 64%。
3. **投影来源是显式状态**：图纸默认投影 CAD 文档，也可切换为立体几何文档（`ProjectionSource = "cad" | "geometry3d"`）。两份工作区文档相互独立，因此**来源必须显式**，空状态要说明是哪一份为空、另一份里是否已有模型。**图纸布局仍只属于 CAD 文档**——切换来源不得改动纸张、视图位置或比例。
4. **读数按视图单位定尺**：捕捉标签与「长度 · 角度」读数的字号按视图 `viewBox` 跨度换算，而不是按纸张 CSS `zoom` 后的像素；否则放大图纸会把读数放大成巨大文字。
5. **截面/截线以"看得见、点得到"为准**（新增能力，跨工作区）：在 `geometry3d` 中选中含面环的对象即出现虚线预览（单个实体 = 默认剖切平面截面；两个对象 = 两实体面环的真实交线），点击预览创建持久化图元。这**扩展**了本设计第 1 条目标里的"3D 到工程图"链路：实体交线在进入图纸之前就已可提取。
