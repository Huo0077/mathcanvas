export type Workspace = "calculus" | "conics" | "cad" | "geometry3d"

export interface Coordinate {
  x: number
  y: number
}

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface PlaneFrame {
  origin: Vector3
  u: Vector3
  v: Vector3
}

export type Point3Binding =
  | { kind: "free" }
  | { kind: "onLine"; lineId: string; parameter: number }
  | { kind: "onPlane"; planeId: string; coordinates: [number, number]; frame: PlaneFrame }
  | { kind: "derived"; sourceIds: string[]; feature: string }
  /**
   * 绑到一维宿主（直线 / 线段 / 射线 / 棱）：`parameter` 是该宿主的**自然参数**
   * （线段与棱是 [0,1]、射线是 [0,∞)、直线无界）。坐标由参数算出，不单独存储。
   */
  | { kind: "onHost"; hostId: string; parameter: number }
  /** 绑到一个面（`face3`）：`uv` 是该面自身平面内的直角坐标（环外会被夹回边界）。 */
  | { kind: "onFace"; faceId: string; uv: [number, number] }
  /** 绑到圆柱 / 圆锥的**侧面**：`uv` 是 (方位角, 轴向比例)，轴线沿世界 +Z。 */
  | { kind: "onSurface"; solidId: string; uv: [number, number] }

export interface PrimitiveStyle {
  stroke?: string
  fill?: string
  strokeWidth?: number
  opacity?: number
  dash?: string
}

export interface PrimitivePresentation {
  label?: string
  layerId?: string
  visible?: boolean
  locked?: boolean
  style?: PrimitiveStyle
}

/**
 * Euler orientation of a parameterized solid, in radians, applied X then Y then Z about the object's own
 * centre. Absent means axis-aligned, which is how every pre-existing `.mgeo` document already behaves.
 */
export interface SolidRotation {
  x: number
  y: number
  z: number
}

export interface ParameterSpec {
  id: string
  value: number
  expression?: string
  min?: number
  max?: number
  step?: number
  label?: string
  /**
   * 该参数是**某个对象自动生成的驱动参数**（例如绑定点沿曲线滑动用的 `t-<点id>`）。
   * 它只描述"谁生成了我"，用于在宿主对象被删除时回收，避免留下孤儿参数；
   * 用户手工创建并驱动的参数不带这个字段。
   */
  ownerId?: string
}

export type PointBinding =
  | { kind: "free" }
  | {
      kind: "onPath"
      pathId: string
      parameterId?: string
      /**
       * 曲线的**自然参数**：直线/射线/线段是仿射比例 t（直线与射线不截断），圆/弧/椭圆是角度（弧度），
       * 折线是按弧长归一化的比例，函数图像是 x 本身，抛物线/双曲线是轴向参数 u。
       */
      parameter: number
      /**
       * 参数域，只对**无界**自然参数的曲线（抛物线、双曲线）有意义：它们的轴向参数 u 没有天然边界，
       * 而这个域是滑块与轨迹扫描的窗口，也是「路径参数」输入框的上下界。
       * 有界曲线（线段、折线、圆、弧、椭圆）由曲线自身决定域，不需要它。
       */
      domain?: [number, number]
      /** 双曲线分支（0 / 1），其它曲线忽略。拖动时按它保持分支不跳。 */
      branch?: 0 | 1
    }
  | { kind: "derived"; sourceId: string; feature: string }

export interface PointPrimitive extends PrimitivePresentation {
  id: string
  type: "point"
  x: number
  y: number
  binding?: PointBinding
}

export interface Point3Primitive extends PrimitivePresentation {
  id: string
  type: "point3"
  position: Vector3
  binding?: Point3Binding
}

export type Line3Definition =
  | { kind: "throughPoints"; pointIds: [string, string] }
  | { kind: "pointDirection"; pointId: string; direction: Vector3 }

export interface Line3Primitive extends PrimitivePresentation {
  id: string
  type: "line3"
  definition: Line3Definition
}

export interface Segment3Primitive extends PrimitivePresentation {
  id: string
  type: "segment3"
  pointIds: [string, string]
}

export interface Ray3Primitive extends PrimitivePresentation {
  id: string
  type: "ray3"
  originId: string
  throughId: string
}

export type Plane3Definition =
  | { kind: "throughPoints"; pointIds: [string, string, string] }
  | { kind: "pointNormal"; pointId: string; normal: Vector3 }

export interface Plane3Primitive extends PrimitivePresentation {
  id: string
  type: "plane3"
  definition: Plane3Definition
  /** Half-extent of the drawn patch in world units. Absent means "fit the scene", which is the old behaviour. */
  halfSize?: number
}

export interface Circle3Primitive extends PrimitivePresentation {
  id: string
  type: "circle3"
  centerId: string
  normal: Vector3
  radius: number
}

export interface Edge3Primitive extends PrimitivePresentation {
  id: string
  type: "edge3"
  pointIds: [string, string]
  faceIds?: string[]
}

export interface Face3Primitive extends PrimitivePresentation {
  id: string
  type: "face3"
  pointIds: string[]
  edgeIds?: string[]
  planeId?: string
}

export type SolidConstruction =
  | { kind: "template"; templateId: string; parameterIds?: string[]; sourceIds: string[] }
  | { kind: "fromPoints"; sourceIds: string[] }
  | { kind: "fromFaces"; sourceIds: string[] }

export interface Polyhedron3Primitive extends PrimitivePresentation {
  id: string
  type: "polyhedron3"
  vertexIds: string[]
  edgeIds: string[]
  faceIds: string[]
  construction?: SolidConstruction
}

export interface LinePrimitive extends PrimitivePresentation {
  id: string
  type: "line"
  a: Coordinate
  b: Coordinate
  slopeParameter?: string
}

export interface SegmentPrimitive extends PrimitivePresentation {
  id: string
  type: "segment"
  a: Coordinate
  b: Coordinate
}

export interface RayPrimitive extends PrimitivePresentation {
  id: string
  type: "ray"
  a: Coordinate
  b: Coordinate
}

export interface PolylinePrimitive extends PrimitivePresentation {
  id: string
  type: "polyline"
  points: Coordinate[]
}

export interface ConnectionPrimitive extends PrimitivePresentation {
  id: string
  type: "connection"
  kind: "segment" | "line" | "ray" | "polyline" | "parabola"
  startPointId: string
  endPointId: string
  control?: {
    vertex?: Coordinate
    axis?: "x" | "y"
    focalParameter?: number
    thirdPointId?: string
  }
}

export interface LocusPrimitive extends PrimitivePresentation {
  id: string
  type: "locus"
  sourcePointId: string
  parameterId: string
  domain: [number, number]
  samples: number
}

export interface ParabolaPrimitive extends PrimitivePresentation {
  id: string
  type: "parabola"
  vertex: Coordinate
  focalParameter: number
  axis: "x" | "y"
  rotation?: number
}

export interface EllipsePrimitive extends PrimitivePresentation {
  id: string
  type: "ellipse"
  center: Coordinate
  radiusX: number
  radiusY: number
  rotation?: number
}

export interface HyperbolaPrimitive extends PrimitivePresentation {
  id: string
  type: "hyperbola"
  center: Coordinate
  radiusX: number
  radiusY: number
  axis: "x" | "y"
  rotation?: number
}

export interface FunctionPrimitive extends PrimitivePresentation {
  id: string
  type: "function"
  expression: string
  domain: [number, number]
  samples?: number
}

export interface DerivativePrimitive extends PrimitivePresentation {
  id: string
  type: "derivative"
  sourceId: string
  order: 1 | 2
  domain: [number, number]
  samples: number
  points: Coordinate[]
  status: "approximate" | "undefined" | "failed"
  diagnostic?: string
}

export interface TangentPrimitive extends PrimitivePresentation {
  id: string
  type: "tangent"
  sourceId: string
  x: number
  point: Coordinate
  slope: number
  a: Coordinate
  b: Coordinate
  status: "approximate" | "undefined" | "failed"
  vertical?: boolean
  diagnostic?: string
}

export interface NormalPrimitive extends Omit<TangentPrimitive, "type"> {
  type: "normal"
}

export interface SecantPrimitive extends PrimitivePresentation {
  id: string
  type: "secant"
  sourceId: string
  x1: number
  x2: number
  points: [Coordinate, Coordinate] | []
  slope: number
  a: Coordinate
  b: Coordinate
  status: "approximate" | "undefined" | "failed"
  vertical?: boolean
  diagnostic?: string
}

export interface AnalysisResult {
  kind: "zero" | "maximum" | "minimum" | "inflection"
  x: number
  y: number
  approximate: true
}

export interface IntegralPrimitive extends PrimitivePresentation {
  id: string
  type: "integral"
  sourceId: string
  domain: [number, number]
  steps: number
  points: Coordinate[]
  area: number | null
  status: "approximate" | "undefined" | "failed"
  diagnostic?: string
}

export interface AnalysisSetPrimitive extends PrimitivePresentation {
  id: string
  type: "analysisSet"
  sourceId: string
  domain: [number, number]
  samples: number
  results: AnalysisResult[]
  status: "approximate" | "undefined" | "failed"
  diagnostic?: string
}

export interface CubePrimitive extends PrimitivePresentation {
  id: string
  type: "cube"
  origin: Vector3
  size: Vector3
  rotation?: SolidRotation
}

export interface PyramidPrimitive extends PrimitivePresentation {
  id: string
  type: "pyramid"
  baseCenter: Vector3
  baseSize: { x: number; y: number }
  height: number
  rotation?: SolidRotation
}

export interface CylinderPrimitive extends PrimitivePresentation {
  id: string
  type: "cylinder"
  center: Vector3
  radius: number
  height: number
  segments: number
  rotation?: SolidRotation
}

export interface ConePrimitive extends PrimitivePresentation {
  id: string
  type: "cone"
  center: Vector3
  radius: number
  height: number
  segments: number
  rotation?: SolidRotation
}

/** Ordered-boundary classification of a plane/polyhedron section. */
export type Section3Classification = "none" | "point" | "segment" | "polygon" | "insufficient-data"

export interface SectionPrimitive extends PrimitivePresentation {
  id: string
  type: "section"
  sourceId: string
  plane: { normal: Vector3; constant: number }
  /** 周长最大的一环（外轮廓）。 */
  points: Vector3[]
  /**
   * 全部闭合环，按面积降序。带孔或分成多块的截面靠它保留完整几何；
   * 旧文档没有这个字段时按 `[points]` 处理。
   */
  loops?: Vector3[][]
  classification: Section3Classification
  status: "approximate" | "undefined" | "failed"
  diagnostic?: string
}

/**
 * 两个空间对象的公共交线（截线）。
 * `sourceIds` 恰好两个来源（实体 / 面 / 多面体），`segments` 由来源重算生成，因此**不在界面里手改**。
 * 与 `section` 的区别：`section` 是"一个平面切一个实体"，`intersectionLine` 是"两个对象相交"。
 */
export interface IntersectionLinePrimitive extends PrimitivePresentation {
  id: string
  type: "intersectionLine"
  sourceIds: [string, string]
  segments: { a: Vector3; b: Vector3 }[]
  classification: "none" | "segment" | "polyline" | "insufficient-data"
  status: "valid" | "degenerate" | "insufficient-data"
  diagnostic?: string
}

export interface CirclePrimitive extends PrimitivePresentation {
  id: string
  type: "circle"
  center: Coordinate
  radius: number
}

export interface ArcPrimitive extends PrimitivePresentation {
  id: string
  type: "arc"
  center: Coordinate
  radius: number
  startAngle: number
  endAngle: number
}

export interface IntersectionPrimitive extends PrimitivePresentation {
  id: string
  type: "intersection"
  lineA: string
  lineB: string
  x: number
  y: number
}

export interface LineCircleIntersectionPrimitive extends PrimitivePresentation {
  id: string
  type: "lineCircleIntersection"
  lineId: string
  circleId: string
  /**
   * 第几个解（非负整数）。**不设上界**——采样曲线（函数、圆锥曲线）的交点可能有任意多个，
   * 旧类型写死 `0 | 1`，第三个及以后的解会被折叠到第 2 个上（实测缺陷）。
   */
  solutionIndex?: number
  /** 用户点选时那个解的坐标：重算按"离它最近的解"匹配，解的数量或顺序变化时不会串位。 */
  hint?: Coordinate
  x: number
  y: number
}

export interface CircleCircleIntersectionPrimitive extends PrimitivePresentation {
  id: string
  type: "circleIntersection"
  circleA: string
  circleB: string
  solutionIndex?: number
  hint?: Coordinate
  x: number
  y: number
}

export interface CurveIntersectionPrimitive extends PrimitivePresentation {
  id: string
  type: "curveIntersection"
  objectA: string
  objectB: string
  solutionIndex?: number
  hint?: Coordinate
  x: number
  y: number
}

export interface IntersectionSetPrimitive extends PrimitivePresentation {
  id: string
  type: "intersectionSet"
  objectA: string
  objectB: string
  points: Coordinate[]
  selectedIndex?: number
}

export type PrimitiveSpec =
  | PointPrimitive
  | Point3Primitive
  | LinePrimitive
  | Line3Primitive
  | SegmentPrimitive
  | Segment3Primitive
  | RayPrimitive
  | Ray3Primitive
  | PolylinePrimitive
  | ConnectionPrimitive
  | LocusPrimitive
  | ParabolaPrimitive
  | EllipsePrimitive
  | HyperbolaPrimitive
  | FunctionPrimitive
  | DerivativePrimitive
  | TangentPrimitive
  | NormalPrimitive
  | SecantPrimitive
  | IntegralPrimitive
  | AnalysisSetPrimitive
  | CubePrimitive
  | PyramidPrimitive
  | CylinderPrimitive
  | ConePrimitive
  | Plane3Primitive
  | Circle3Primitive
  | Edge3Primitive
  | Face3Primitive
  | Polyhedron3Primitive
  | SectionPrimitive
  | IntersectionLinePrimitive
  | CirclePrimitive
  | ArcPrimitive
  | IntersectionPrimitive
  | LineCircleIntersectionPrimitive
  | CircleCircleIntersectionPrimitive
  | CurveIntersectionPrimitive
  | IntersectionSetPrimitive

export type ConstraintType = "parallel" | "perpendicular" | "coincident" | "pointOnLine" | "pointOnPlane" | "collinear" | "coplanar" | "fixedDistance"

export interface ConstraintSpec {
  id: string
  type: ConstraintType
  targets: string[]
  value?: number
  tolerance?: number
  enabled?: boolean
}

export type Measurement3Metric = "length" | "angle" | "area" | "volume" | "distance" | "dihedral"
export type Measurement3Status = "valid" | "degenerate" | "insufficient-data" | "numeric-failure"

export interface Measurement3 {
  id: string
  kind: "measurement3"
  sourceIds: string[]
  metric: Measurement3Metric
  /** Dihedral measurements record which angle they report; defaults to the interior teaching angle. */
  dihedralKind?: "interior" | "exterior"
  value?: number
  unit?: string
  precision: "exact-input" | "numeric-approximation"
  status: Measurement3Status
  explanation: string
}

export interface GroupSpec {
  id: string
  label?: string
  members: string[]
}

export interface DynamicSpec {
  id: string
  type: "slider" | "locus"
  target: string
  parameter?: string
}

export type AnnotationFeature = "point" | "center" | "focus" | "vertex" | "intersection" | "start" | "end"

export type AnnotationAnchor =
  | { kind: "coordinate"; x: number; y: number }
  | { kind: "primitive"; primitiveId: string; feature?: AnnotationFeature; index?: number }

export interface AnnotationSpec {
  id: string
  text: string
  anchor?: AnnotationAnchor
  offset?: Coordinate
  visible?: boolean
  target?: string
  x?: number
  y?: number
}

export type EngineeringAnnotationKind = "linear" | "angular" | "tolerance" | "fillet" | "chamfer"
export type EngineeringAnnotationView = "front" | "top" | "left" | "axonometric"
export type EngineeringAnnotationStatus = "valid" | "degenerate" | "insufficient-data"

export interface EngineeringAnnotation {
  id: string
  kind: EngineeringAnnotationKind
  sourceIds: string[]
  view: EngineeringAnnotationView
  value?: number
  unit?: string
  tolerance?: { upper: number; lower: number }
  status: EngineeringAnnotationStatus
  explanation: string
}

export interface DocumentMetadata {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface LayerSpec {
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

export interface DrawingViewSpec {
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

export interface DrawingSheetSpec {
  id: string
  name: string
  paper: "A4" | "A3" | "A2" | "custom"
  orientation: "portrait" | "landscape"
  scale: number
  viewIds: string[]
}

export interface GeometryDocument {
  schemaVersion: "0.1"
  revision: number
  workspace: Workspace
  coordinateSystems: string[]
  parameters: Record<string, ParameterSpec>
  primitives: PrimitiveSpec[]
  groups: GroupSpec[]
  constraints: ConstraintSpec[]
  dynamics: DynamicSpec[]
  annotations: AnnotationSpec[]
  measurements: Measurement3[]
  engineeringAnnotations?: EngineeringAnnotation[]
  layers?: LayerSpec[]
  drawingViews?: DrawingViewSpec[]
  drawingSheets?: DrawingSheetSpec[]
  activeLayerId?: string
  activeSheetId?: string
  metadata: DocumentMetadata
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] }
