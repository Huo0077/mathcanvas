# P7 工程制图 MVP 设计规格

> **状态（2026-09-17 复核）**：**已实现**——投影内核、四视图工作台、投影线与来源切换、工程标注（线性 / 角度 / 公差）、SVG / DXF / PDF 导出都已进入产品；后续两处变化：导出不再截断到 4 个视图、PDF 对 WinAnsi 之外的字符做替换而不是整体失败。对应计划见 [`2026-09-15-p7-engineering-drawing.md`](../plans/2026-09-15-p7-engineering-drawing.md)，当前门禁见 [`docs/project-progress.md`](../../project-progress.md)。

## 目标

在现有点驱动三维模型之上增加工程制图工作区，使一个 `GeometryDocument` 可以派生主视图、俯视图、左视图和轴测图。模型点、棱、面或模板参数变化后，所有视图重新计算；用户选择视图对象时仍然回到同一个三维源对象。最终提供带工程标注的 SVG、PDF 和 DXF 输出。

## 已知基础

- `packages/dsl` 已支持 `point3`、`edge3`、`face3`、`polyhedron3`、四类参数化实体和 `.mgeo` 往返。
- `packages/geometry-kernel` 已提供向量、平面、拓扑、截面、展开和测量纯函数。
- `packages/scene-graph` 已负责 3D 源对象派生重算、稳定 ID 和删除保护。
- `apps/web` 已有 `geometry3d` 工作区、Three.js 场景、Algebra View、文件保存/打开和 `cad` 工作区标签；`cad` 目前仍使用空的平面画布。
- 当前 GitHub 调研已覆盖 GeoGebra 的多视图对象关系、Three.js 的场景/相机边界和 JSXGraph 的来源引用行为。只借鉴公开行为和架构思想，不复制代码或 GPL 对象模型。

## 范围

### 包含

1. 正交主视图、俯视图、左视图和轴测图。
2. 点、棱、面和参数化模板生成拓扑的投影派生描述。
3. `cad` 工作区的四视图布局、空状态、选择同步和模型刷新。
4. 源对象与多视图之间的投影线联动。
5. 线性尺寸、角度尺寸、基本公差、圆角/倒角的工程标注表达和失败状态。
6. 可验证的 SVG、PDF、DXF 导出。

### 不包含

- 透视工程图、隐藏线消除的完整 CAD 算法、B-rep/网格导入和布尔建模。
- 完整 GD&T 标准库、自动尺寸布局优化和参数化倒角/圆角求解。
- P4 Agent、P5 题图解析、服务端文档存储和协作编辑。
- 通过屏幕截图或 WebGL framebuffer 冒充工程图导出。

## 架构

### 三层边界

1. `geometry-kernel`：提供不依赖 DOM/Three.js 的投影基、坐标变换、深度排序辅助和几何标注数值。
2. `apps/web` 派生层：将 `GeometryDocument` 的 3D 源对象解析为 renderer-neutral 的投影图元、投影线和工程标注。
3. `apps/web` 视图层：渲染四个 SVG 视图、选择态、辅助线、状态和导出输入；视图层不重新计算几何。

### 数据流

```text
GeometryDocument
  -> Scene Graph recompute
  -> projection resolver(document, view)
  -> ProjectedDrawing { primitives, annotations, diagnostics }
  -> CAD view / SVG / PDF / DXF adapter
```

投影结果是派生数据，不写回 3D primitive，不进入 undo history。工程标注只有在用户明确创建后才进入文档；临时投影线、视图相机和面板布局不持久化。

## 视图约定

全部视图使用正交投影和右手世界坐标：

| 视图 | 屏幕水平轴 | 屏幕垂直轴 | 深度轴 |
|---|---|---|---|
| 主视图 | X | Y | Z |
| 俯视图 | X | Z | Y |
| 左视图 | Z | Y | X |
| 轴测图 | 固定等权重正交基 | 固定等权重正交基 | 固定等权重正交基 |

P7-1 的基础接口为：

```ts
type DrawingView = "front" | "top" | "left" | "axonometric"

interface ProjectedPoint {
  x: number
  y: number
  depth: number
}

function projectVector3(point: Vector3, view: DrawingView): ProjectedPoint | null
```

输入任一坐标非有限时返回 `null`；函数不修改输入。后续 resolver 过滤 `null`，不得用世界原点替代缺失数据。

## 派生对象接口

P7-2 使用新的 Web 层纯函数，不扩展 `.mgeo`：

```ts
interface ProjectedDrawing {
  view: DrawingView
  primitives: ProjectedPrimitive[]
  projectionLines: ProjectionLine[]
  annotations: ProjectedAnnotation[]
  diagnostics: string[]
}

type ProjectedPrimitive =
  | { kind: "point"; sourceId: string; point: ProjectedPoint }
  | { kind: "polyline"; sourceId: string; points: ProjectedPoint[]; closed: boolean }
  | { kind: "polygon"; sourceId: string; points: ProjectedPoint[]; depth: number }

interface ProjectionLine {
  sourceId: string
  from: ProjectedPoint
  to: ProjectedPoint
  targetView: DrawingView
}

interface ProjectedAnnotation {
  id: string
  sourceIds: string[]
  kind: "linear" | "angular" | "tolerance" | "fillet" | "chamfer"
  text: string
  position: ProjectedPoint
  status: "valid" | "degenerate" | "insufficient-data"
}
```

`sourceId` 必须是 DSL 稳定 ID；同一模板的实体和生成拓扑不得重复绘制。退化点数、缺失引用和非有限计算进入 `diagnostics`，不生成伪造线段。

## 工程标注

P7-5 的标注采用可选的向后兼容文档字段 `engineeringAnnotations`，解码旧文档时默认为空数组。每条标注携带 `id`、`sourceIds`、`kind`、`view`、数值/单位和状态；投影线和视图布局仍是临时状态。无效来源返回 `insufficient-data` 或 `degenerate`，不静默使用旧坐标。

首期标注类型：

- `linear`：两点或一条棱的长度。
- `angular`：三点或两棱的夹角。
- `tolerance`：带上下偏差的线性标注。
- `fillet` / `chamfer`：只表达已有圆角/倒角几何的工程说明，不负责改变实体拓扑。

## 导出

- SVG：每个视图是独立 `<g>`，包含源 ID、轮廓、中心线和标注文本。
- DXF：使用可读的 ASCII R12 风格实体，至少输出 `LINE`、`LWPOLYLINE`、`TEXT` 和图层名；不输出无法解释的三维缓存。
- PDF：使用受许可证审核的矢量 PDF 生成依赖，按照 SVG 同一套投影描述和标注数据写入单页或多页图纸。
- 三种导出共用 `ProjectedDrawing`，不得分别重新实现投影计算。

## 交互与可访问性

- 四个视图必须有可读标题和当前视图状态；窄屏时视图可滚动，不压缩到无法点击。
- 点击投影图元选中源对象；悬停或选择时显示源 ID/标签，不创建新的几何对象。
- 投影线是明确的辅助状态，可关闭；不参与删除、锁定或撤销。
- 空文档、无拓扑、退化几何和导出失败都显示可解释状态。
- 所有视图控制和导出按钮保持键盘可达、可见焦点和可读名称。

## 性能与验证

- 视图派生按当前文档 revision 和 view 缓存；同一 revision 不重复解析源拓扑。
- 四视图共享一次源点位置解析，不为每个视图重复扫描完整文档。
- 单元测试验证轴映射、深度排序、退化处理、标注数值和导出字符串；UI 测试验证多视图同步、源 ID 选择和空状态；Playwright 验证四视图、模型编辑刷新、投影线和导出下载。
- 每个切片必须运行聚焦测试、全量测试、类型检查、Lint、构建和相关 E2E；通过后更新进度并提交/推送。
