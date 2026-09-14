# 点驱动三维几何设计规格

**日期：** 2026-09-14  
**状态：** 方案 C 已确认，待分阶段实施  
**关联计划：** [`2026-09-14-point-driven-3d-geometry.md`](../plans/2026-09-14-point-driven-3d-geometry.md)  
**关联调研：** [`graphing-tools.md`](../../research/graphing-tools.md)  
**兼容目标：** Geometry DSL `schemaVersion: "0.1"`

## 1. 背景与问题

当前 P6 基线把立体建模入口集中在立方体、棱锥、圆柱和圆锥四类参数化实体上。它适合演示渲染和基础操作，但不能表达高中数学中常见的三棱柱、四棱柱、棱台、组合体、任意多面体、截面构造或由若干已知点确定的几何关系。宽、高、半径等参数也会掩盖真正决定图形的空间点位置，导致移动一个顶点时无法自然保持棱、面和派生测量的关系。

本设计将三维工作区改为“点驱动、拓扑组合、模板快捷创建”的模型。自由点、由点确定的线和面、由面组合的实体是领域真源；立方体等参数化实体只是一次性生成或持续绑定的构造模板。这样既保留课堂中快速插入常见实体的效率，也允许用户从零构造不同的立体图形。

## 2. 参考与设计决策

本次参考了公开项目的对象关系和渲染边界：

- GeoGebra 的对象标签、父子依赖和动态重算启发 Algebra View 与来源引用设计。
- JSXGraph 的“子对象引用父对象”启发点、路径、交点和构造对象的依赖表达。
- CindyJS 的约束驱动思路启发共线、共面、垂直、平行和点在线/面上的可解释约束。
- Three.js 只负责场景图、材质、射线拾取和渲染；领域对象、拓扑和计算仍由 DSL、Scene Graph 与 geometry-kernel 管理。

不复制上述项目代码、资源或对象模型，也不在本阶段引入 GPL 运行时依赖。现有调研与许可证边界记录在 `docs/research/graphing-tools.md`。

## 3. 目标与非目标

### 3.1 目标

- 用稳定 ID 表达 `point3`、`line3`、`segment3`、`ray3`、`plane3` 和 `circle3`。
- 用顶点 ID、棱 ID 和面 ID 组合出任意有限多面体，而非限制在四种实体。
- 提供点、线、面优先的课堂构造流程，并保留参数化实体快捷模板。
- 点移动后，依赖的线、面、实体拓扑、截面、展开图和测量结果自动重算。
- 提供空间拾取、视角操作、隐藏边、透明面、法向量、标签、选中高亮和来源解释。
- 支持截面、展开/折叠、二面角、长度、角度、面积、体积、距离和垂直/平行关系的可追踪结果。
- 保持 `schemaVersion: "0.1"`，旧 2D 文件和 P6 基线文件继续可读。

### 3.2 非目标

- 通用三角网格导入、CAD/DXF、三视图工程制图。
- 任意网格布尔运算、工业级曲面建模和高精度 CAD 内核。
- 通过 Agent 自动猜测或代替用户完成证明。
- 完整 CAS、符号消元和任意 JavaScript 用户脚本。

## 4. 领域模型

### 4.1 三维基础对象

```ts
type Vector3 = { x: number; y: number; z: number }

type Point3 = {
  id: string
  kind: "point3"
  label?: string
  position: Vector3
  binding?: Point3Binding
}

type Point3Binding =
  | { kind: "free" }
  | { kind: "onLine"; lineId: string; parameter: number }
  | { kind: "onPlane"; planeId: string; coordinates: [number, number]; frame: PlaneFrame }
  | { kind: "derived"; sourceIds: string[]; feature: string }

type PlaneFrame = {
  origin: Vector3
  u: Vector3
  v: Vector3
}

type Line3 =
  | { id: string; kind: "line3"; pointIds: [string, string] }
  | { id: string; kind: "line3"; pointId: string; direction: Vector3 }
type Segment3 = { id: string; kind: "segment3"; pointIds: [string, string] }
type Ray3 = { id: string; kind: "ray3"; originId: string; throughId: string }
type Plane3 =
  | { id: string; kind: "plane3"; pointIds: [string, string, string] }
  | { id: string; kind: "plane3"; pointId: string; normal: Vector3 }
type Circle3 = { id: string; kind: "circle3"; centerId: string; normal: Vector3; radius: number }
```

点的 `position` 是自由点的真源；绑定点的 `position` 是可丢弃的派生缓存，加载、来源更新和参数更新时必须由 binding 重算，不能单独写入造成两个真源。`onPlane.coordinates` 使用由平面原点和正交单位基向量 `u/v` 定义的局部坐标，`frame` 必须与当前平面法向量一致。两点确定直线/线段，原点和方向或两点确定射线，三点确定平面；退化输入必须返回结构化错误，不生成零方向或零面积对象。

### 4.2 拓扑对象

```ts
type Edge3 = {
  id: string
  kind: "edge3"
  pointIds: [string, string]
  faceIds?: string[]
}

type Face3 = {
  id: string
  kind: "face3"
  pointIds: string[]
  edgeIds?: string[]
  planeId?: string
}

type Polyhedron3 = {
  id: string
  kind: "polyhedron3"
  vertexIds: string[]
  edgeIds: string[]
  faceIds: string[]
  construction?: SolidConstruction
}

type SolidConstruction = {
  kind: "template" | "fromPoints" | "fromFaces"
  templateId?: string
  parameterIds?: string[]
  sourceIds: string[]
}

type GeometryDiagnostic = {
  code: "missing-reference" | "degenerate" | "non-planar" | "self-intersection" | "open-boundary" | "no-intersection" | "insufficient-data" | "numeric-failure" | "overlap"
  severity: "info" | "warning" | "error"
  sourceIds: string[]
  message: string
  details?: Record<string, string | number>
}

type DerivedStatus =
  | "valid"
  | "invalid"
  | "noIntersection"
  | "degenerate"
  | "insufficient-data"
  | "numeric-failure"
  | "overlap"

type RenderObject3 = {
  objectId: string
  partId?: string
  kind: "point" | "line" | "edge" | "face" | "solid" | "marker"
  geometry: unknown
  style: { color: string; opacity: number; dashed?: boolean; highlighted?: boolean }
  diagnostics: GeometryDiagnostic[]
}
```

`Polyhedron3` 只保存稳定的子对象引用和构造来源，不把渲染三角网格作为文档真源。`fromPoints` 不接受无序点集直接猜测实体：它必须同时提供有序面环或明确的棱集合；若用户只提供点集，则只能显式选择“构造凸包”，凹体、组合体或多种拓扑均返回 `insufficient-data`，不自动猜测。`fromFaces` 支持组合棱柱、棱台、组合体等课堂构造。一个面可以有三边或更多边，但边界必须闭合、顶点不能重复、面不能自交，实体的边界方向必须一致。

### 4.3 参数化模板

模板是 builder 注册表中的快捷入口，不是领域类型的封闭枚举：

```ts
type SolidBuilder<Input> = {
  id: string
  label: string
  create(input: Input, context: BuilderContext): SolidBuildResult
}

type BuilderContext = {
  allocateId(namespace: string): string
  addPoint(point: Point3): string
  addEdge(edge: Edge3): string
  addFace(face: Face3): string
  diagnostics: GeometryDiagnostic[]
}

type SolidBuildResult = {
  pointIds: string[]
  edgeIds: string[]
  faceIds: string[]
  polyhedronId: string
  diagnostics: GeometryDiagnostic[]
}

builder 的 `create` 是确定性的领域转换：只接收输入和 `BuilderContext`，不访问 DOM、Three.js、相机或网络；Context 只负责事务内的 ID 分配、子对象收集和诊断，不直接提交 Scene Graph。Scene Graph 在事务成功后一次性持久化结果。`RenderObject3` 由 Scene Graph/renderer adapter 从文档对象生成，Three.js 只能消费它，不能回写 DSL。
```

首批内置 builder 包括 `cube`、`pyramid`、`cylinder` 和 `cone`，并逐步增加任意 `prism`、`frustum`、`regularPolyhedron` 和 `fromPoints`。所有 builder 都必须生成可见的点、棱、面子对象；用户随后编辑点时，模板参数只作为构造来源和可选约束，不覆盖用户明确的点编辑。圆柱、圆锥等含曲面的实体以轴端点、中心点、法向量、半径和边界采样组成可解释的教学近似，曲面网格仍是渲染产物。

## 5. 构造、依赖与重算

Scene Graph 维护对象索引、父子引用和反向依赖索引。一次点更新遵循以下顺序：

```text
Point3 position patch
  -> bound points and lines
  -> planes, circles, edges and faces
  -> polyhedron topology and render preparation
  -> sections, unfold layouts and measurements
  -> Algebra View, properties and canvas markers
```

每个派生对象保存 `sourceIds`、计算参数、算法版本、`status: DerivedStatus` 和 `diagnostics: GeometryDiagnostic[]`。来源变化后只重算受影响的依赖分量；重算失败时保留对象和来源引用，显示 `invalid` 或 `noIntersection`，不写入过期的伪坐标。截面、展开图、约束和测量都复用这套状态与诊断模型；`no-intersection`、`non-planar`、`open-boundary` 和 `overlap` 等算法错误通过稳定 code 映射到 UI 文案。撤销/重做沿用现有 Domain Operation 和 Memento 机制，一次用户构造形成一个可撤销操作，渲染帧和相机状态不进入文档历史。

## 6. 构造工具与属性编辑

### 6.1 工具流程

- **点工具：** 在投影平面或三维辅助平面创建点；支持坐标输入、网格吸附、课堂标签和 z 值编辑。
- **线工具：** 选择两点创建直线、线段或射线；选择点和方向向量创建无限线。
- **面工具：** 选择三个不共线点创建平面；继续选择边界点创建多边形面。
- **实体工具：** 选择闭合面集合或顶点集合创建 `polyhedron3`；拓扑错误在提交前说明缺失边、非平面面或自交位置。
- **模板工具：** 通过参数快速生成点、棱、面和实体，并允许“拆解为点/棱/面”继续编辑。
- **派生工具：** 从实体与平面创建截面，从相邻面创建展开图和二面角，从对象引用创建长度、面积、体积、距离和角度测量。

### 6.2 点驱动属性栏

选中点时优先显示 `x/y/z`、标签、绑定来源、吸附和约束；选中线/面/实体时显示其点 ID、子对象树、方向/法向量、拓扑状态和测量来源。模板参数与生成点分组显示，用户可以在“编辑点”与“编辑构造参数”之间明确切换。所有自动计算字段只读并显示“由 A、B、C 计算”等来源说明。

Algebra View 展示顶层对象和可展开的顶点/棱/面子树，点击任意条目同时选中 3D 场景中的对应对象。对象标签默认使用 A、B、C、…，重复标签自动分配下一个可用标签，标签不是稳定 ID 的替代品。

## 7. 3D 渲染与交互边界

React 管理工作区、工具栏、属性栏、Algebra View、错误和教学提示。Three.js 管理单一 canvas、场景树、相机、材质、线框和 Raycaster。领域层向渲染层提供不可变 `RenderObject3`，禁止 React 组件直接计算面法向量或修改 DSL 对象。

必须支持：

- 左键旋转、中键或 Shift+左键平移、滚轮缩放和视角重置。
- Raycaster 选择点、棱、面和实体；拾取结果包含对象 ID、子部件 ID、深度和世界坐标。
- 选中高亮、点标签、透明面、隐藏边虚线、法向量箭头、网格和坐标轴。
- 相机操作不修改文档；拖动自由点或数值输入才提交 Domain Operation。
- WebGL 不可用、拾取无命中、对象不可渲染时显示明确状态和恢复操作。

隐藏边分类由视锥、面法向量和深度结果共同决定，不能只按对象创建顺序猜测。透明面仍可拾取，拾取层级允许用户选择“面优先”或“点/棱优先”。

## 8. 约束、测量与教学反馈

首批约束包括点在线、点在面上、共线、共面、平行、垂直、等长、等角和固定距离。约束保存目标 ID 与参数，求解器返回投影结果、残差、迭代次数和冲突来源。不能满足时保留用户上次合法状态并显示冲突对象，不静默移动无关点。

测量结果统一包含：

```ts
type Measurement3 = {
  id: string
  kind: "measurement3"
  sourceIds: string[]
  metric: "length" | "angle" | "area" | "volume" | "distance" | "dihedral"
  value?: number
  unit?: string
  precision: "exact-input" | "numeric-approximation"
  status: "valid" | "degenerate" | "insufficient-data" | "numeric-failure"
  explanation: string
}
```

画布标记显示关键点、辅助线、垂足、法向量、截面交点和角度弧；每个标记可跳转来源对象。教学提示重点覆盖共面/非共面判断、遮挡关系、空间方向、点线面归属、截面边界和二面角补角混淆，结果旁必须显示计算依据而非只显示一个数字。

## 9. 截面、展开与二面角

截面、展开和其他派生对象至少采用以下持久化公共字段；各算法可以增加专用参数，但不能绕过来源和诊断：

```ts
type DerivedObject3 = {
  id: string
  sourceIds: string[]
  parameters: Record<string, number | string | boolean | string[]>
  algorithmVersion: string
  status: DerivedStatus
  diagnostics: GeometryDiagnostic[]
}

type Section3 = DerivedObject3 & {
  kind: "section3"
  planeId: string
  pointIds: string[]
  edgeIds: string[]
}

type UnfoldLayout = DerivedObject3 & {
  kind: "unfoldLayout"
  rootFaceId: string
  faceTransforms: Record<string, number[]>
  progress: number
}
```

- **截面：** 平面与实体的面/棱求交，按边界顺序返回截面点和截面边；无交、切于顶点或退化为线段时返回明确分类。
- **展开图：** 以选定面为根，沿共享棱传播局部坐标；检测重叠并报告冲突；折叠/展开动画只改变临时姿态，完成后可保存展开状态。
- **二面角：** 从相邻面的有向法向量和公共棱计算内角/外角，标明测量面、公共棱、角类型和近似精度。
- **辅助投影：** 支持向指定平面投影点、棱和面，并保留来源 ID，帮助课堂展示三视关系但不扩展为工程制图。

## 10. 持久化与兼容

文档继续使用 `schemaVersion: "0.1"`。解码器按 `kind` 判别对象：旧 2D 对象原样读取；旧 P6 的四类参数实体先创建一个稳定的 legacy namespace，再按 `legacy:<solidId>:vertex:<index>`、`legacy:<solidId>:edge:<index>` 和 `legacy:<solidId>:face:<index>` 生成确定性子对象 ID，读取为兼容的 `Polyhedron3` 视图，并保留原始 `construction.templateId` 与参数。兼容视图首次编辑时 materialize 为 canonical 点/棱/面/实体对象；导出只写 canonical 对象和原始模板元数据，不重复写旧实体，重复导入导出保持 ID 和拓扑一致。新格式写入点、棱、面和实体的稳定 ID，未知未来字段采用可忽略策略，非法引用在 codec/Scene Graph 边界拒绝。

导出 `.mgeo` 时保存源对象、派生对象和诊断状态，不保存 Three.js 几何缓存、WebGL 资源或相机临时状态。导入后先建立 ID 索引，再按依赖拓扑重算，确保保存、恢复、撤销、重做和导出结果一致。

## 11. 验收标准

- 用户可以仅通过点、棱、面创建三棱柱、棱台、组合多面体和任意闭合多面体，不依赖固定实体枚举。
- 移动任意自由点后，相关线、面、拓扑、截面、展开和测量结果按来源引用更新；无效构造显示原因且不产生虚假几何。
- 四个现有参数化模板仍可创建，并可拆解为可编辑的点、棱、面对象。
- 3D 对象在 Algebra View 中可展开、选择、隐藏、锁定、保存和恢复；派生对象拥有稳定来源 ID。
- 聚焦单测覆盖退化输入、拓扑校验、依赖重算、持久化兼容、截面、展开、测量和拾取；类型检查、生产构建和 Playwright 覆盖主要工作流。
- 文档明确区分精确输入、数值近似、无交集、采样不足和数值失败，不把渲染缓存当作数学结果。

## 12. 分阶段策略

按 [`2026-09-14-point-driven-3d-geometry.md`](../plans/2026-09-14-point-driven-3d-geometry.md) 的十个切片实施。先建立 DSL 和纯函数内核，再接入依赖重算与构造工具，最后迁移现有模板和工作区 UI。每个切片独立测试、review、commit 并推送后再进入下一切片；P4 Agent、P5 题图解析和 P7 工程制图保持排除。
