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
  /**
   * 绑到一个**实体的内部**（用户要求："动点的约束应该可以在立方体内"）。
   *
   * `uvw` 是实体包围盒内的轴向比例（各维都在 [0,1]）：点可以在体内自由移动，但出不去——
   * 参数越界时被夹回实体表面。与线上 / 面上 / 曲面上的绑定一样，**参数是唯一真值**：
   * 实体平移或缩放时参数不变、坐标跟着走。
   */
  | { kind: "inSolid"; solidId: string; uvw: [number, number, number] }

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
  /**
   * 这是**圆类实体近似的细分顶点**（圆柱 / 圆锥的多边形近似内部顶点），不是用户创建的点。
   *
   * 它仍然参与面 / 棱 / 交线 / 布尔交集的计算（坐标是真源），但画布与对象列表都不展示它：
   * 用户要求"立体里的圆相关的内容不要这么多标点，只需要四个点就够了"，因此每个圆只保留象限点，
   * 其余顶点带这个标记且没有标签。旧文档 / 普通实体不带该字段，行为不变。
   */
  tessellation?: boolean
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
  /**
   * 圆心坐标**自己存**：轨道圆是一个独立对象，不引用任何点。
   *
   * 用户口径："我要的轨道圆是点在圆上而不是圆跟着点走，而且圆要可以缩放旋转"。
   * 早期实现存的是 `centerId`（引用一个点当圆心），于是圆成了那个点的派生物——拖点圆就跟着走、
   * 点还删不掉。点与圆的关系现在只有一条：点**绑**到圆上，沿圆周滑动。
   */
  center: Vector3
  normal: Vector3
  radius: number
}

export interface Edge3Primitive extends PrimitivePresentation {
  id: string
  type: "edge3"
  pointIds: [string, string]
  faceIds?: string[]
  /**
   * 这是**圆类实体近似的母线**（圆柱连接上下底、圆锥连接底面与顶点）：属近似的内部细节，
   * 用户要求"母线用不上这些"，因此不上画布、不进对象列表、也点不到——但仍留在文档里
   * （剖切 / 交线 / 面环都要用它的顶点）。旧文档与其它实体不带该字段，行为不变。
   */
  tessellation?: boolean
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
  /**
   * 显式面环构造（组合体、按数值编辑过顶点的模板……）。
   *
   * `sourceId` 记的是"这条拓扑属于哪个**实体**图元"：模板物化时它由 `kind: "template"` 的
   * `sourceIds[0]` 表达，而按数值改一个模板顶点会把它翻成 `fromFaces`——不把这个归属一起记下来，
   * 那个实体就会从截面 / 交线 / 交面里静默消失（实测缺陷）。
   */
  | { kind: "fromFaces"; sourceIds: string[]; sourceId?: string }

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

/**
 * **封闭曲线绕一个定点旋转**（用户口径："圆，椭圆过一个定点"）。
 *
 * `pivot` 就是那个定点：曲线转过任意角度都仍然过它 —— 定点在曲线上的参数角从 θ₀ 变成 θ₀ + angle，
 * 这种"过定点"的性质与转角无关。`angle` 是绕定点的转角（弧度，逆时针为正）。
 *
 * `baseCenter` 是**基准图形的中心**（没转时圆心在哪）；图元的 `center` 是它的派生值。
 * 之所以要把基准单独存下来：`center` 每趟重算都会被结果覆盖，只留结果就分不清"这是基准还是转过的位置"，
 * 下一趟重算会把曲线再转一次、直接推离定点（实测缺陷）。基准与结果分开存，重算才幂等。
 *
 * 定点在文档里有两种存在方式：
 * - `coordinate`：定死在某个世界坐标（经典题型里那个定点通常在坐标轴上）；
 * - `primitiveId`：引用一个**点图元**，于是定点随手拖动（"在圆上取一个动点，圆绕它转动"）。
 */
export type CurveRotation =
  | { pivot: { kind: "coordinate"; x: number; y: number }; angle: number; baseCenter: Coordinate }
  | { pivot: { kind: "primitive"; primitiveId: string }; angle: number; baseCenter: Coordinate }

export interface EllipsePrimitive extends PrimitivePresentation {
  id: string
  type: "ellipse"
  center: Coordinate
  radiusX: number
  radiusY: number
  rotation?: number
  /** 绕定点旋转（缺省表示不绕任何定点，旧文档行为逐位不变）。 */
  rotationAbout?: CurveRotation
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

/**
 * 切线的**定位方式** —— 也就是"这条切线切在来源曲线的哪一点上"。
 *
 * - `parameter`：由曲线自己的自然参数定位。用户点一下曲线、右侧点「创建切线」得到的就是这种，
 *   之后可以在右侧拖动参数把切点沿曲线滑动。参数语义由内核约束定义（圆/椭圆是极角，抛物线/双曲线是轴向参数 u）。
 * - `point`：由**一个点图元**定位 —— 点画在哪，切线就切在哪；点动，切线跟着动。
 *   这正是"动点在轨道上画切线"的实现：动点自己沿曲线滑动，切线永远落在它当前的位置上。
 *
 * 注意"点的坐标"只是**派生缓存**：真正决定切点的是动点绑定里的那个参数。所以重算时优先读参数、
 * 只有在点没有绑定到这条曲线上时才退化成"把坐标投影到曲线"。
 */
export type TangentAnchor =
  | { kind: "parameter"; parameter: number; branch?: number }
  | { kind: "point"; pointId: string }

export interface TangentPrimitive extends PrimitivePresentation {
  id: string
  type: "tangent"
  /**
   * 来源曲线。历史上只有函数图像；现在也接受圆 / 圆弧 / 抛物线 / 椭圆 / 双曲线。
   * 缺省 `anchor` 时沿用"函数 + `x`"的旧语义，旧文档逐位不变。
   */
  sourceId: string
  /** 函数来源时是切点的横坐标；曲线来源时是切点横坐标的派生缓存（真值在 `anchor` 里）。 */
  x: number
  point: Coordinate
  slope: number
  a: Coordinate
  b: Coordinate
  status: "approximate" | "undefined" | "failed"
  vertical?: boolean
  diagnostic?: string
  /** 曲线来源的定位方式；缺省表示来源是函数（或者旧文档里"用 x 定位"的切线）。 */
  anchor?: TangentAnchor
  /** 切线的绘制半长（世界单位）。缺省按来源曲线自己的尺度自适应。 */
  halfLength?: number
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

/**
 * 平面与二次曲面（圆柱 / 圆锥）相交得到的**圆锥曲线**。
 *
 * 这是**文档数据**：由内核的解析层算出、写进 `section.exact`，所以类型定义放在 DSL 里（内核依赖 DSL，
 * 反向依赖会破坏分层）。`coefficients` 是精确真源（`PᵀQP` 的结果），其余是从它解出的规范数据，
 * 供界面与渲染使用。用户口径："我不要一个逼近的圆，我需要一个真的圆。"
 */
export type Conic3Kind = "circle" | "ellipse" | "parabola" | "hyperbola" | "line" | "lines" | "point" | "empty" | "insufficient-data"

/** 平面内二次曲线 `A s² + B s t + C t² + D s + E t + F = 0`（`s` 沿 `u`、`t` 沿 `v`）。 */
export type Conic3Coefficients = [number, number, number, number, number, number]

export interface Conic3Frame {
  /** 平面上离世界原点最近的点。 */
  origin: Vector3
  u: Vector3
  v: Vector3
  normal: Vector3
}

/** 帧内的一条直线（帧坐标是正交单位基，因此就是度量坐标）。 */
export interface Conic3Line {
  through: { s: number; t: number }
  direction: { s: number; t: number }
}

export interface Conic3 {
  kind: Conic3Kind
  frame: Conic3Frame
  /** 平面内系数——**精确真源**。 */
  coefficients: Conic3Coefficients
  /** 以下是从系数解出的规范数据。 */
  center?: Vector3
  semiMajor?: number
  semiMinor?: number
  /** 抛物线：顶点到焦点的距离 `p`。 */
  focalParameter?: number
  eccentricity?: number
  foci?: Vector3[]
  vertex?: Vector3
  /** 平面内的主轴方向（世界坐标、正交单位）：`major` 配 `semiMajor`、`minor` 配 `semiMinor`。 */
  axes?: { major: Vector3; minor: Vector3 }
  /** `lines`：一对直线（平行或相交，靠"过点是否相同"区分）；`line`：一条直线。 */
  lines?: Conic3Line[]
  point?: Vector3
  /** 闭合曲线（圆 / 椭圆）为 `true`，参数域 `[0, 2π)`。 */
  closed: boolean
}

/**
 * 截面 / 交面边界的一段：圆锥曲线的参数区间（双曲线要用 `branch` 指明哪一支），或者一条直线段。
 * 有限实体的截面会被端面裁掉，所以边界是"曲线弧 + 端面弦"拼成的闭合环，而不是单条曲线。
 */
export type CurvePiece3 =
  | { kind: "conic"; conic: Conic3; parameterRange: [number, number]; branch?: number }
  | { kind: "segment"; a: Vector3; b: Vector3 }

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
  /** `exact` 表示边界是解析圆锥曲线（圆柱 / 圆锥），其余仍是多边形的数值近似。 */
  status: "approximate" | "exact" | "undefined" | "failed"
  diagnostic?: string
  /**
   * **解析结论与解析边界**（源是圆柱 / 圆锥时写入）。旧文档没有这个字段，行为完全不变。
   *
   * 与 `classification` 的分工：后者描述的是**多边形边界**的形态（`codec` 与 `scene-graph` 都会按点数
   * 重新推导它），解析结论一律从这里读，避免两者的推导打架（见 spec §5.4）。
   */
  exact?: { kind: Conic3Kind; loops: CurvePiece3[][] }
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

/** 布尔交集（交面）的形态分类，与内核 `intersectConvexPolyhedra3` 的 status 一一对应。 */
export type IntersectionSolidStatus = "polyhedron" | "flat" | "point" | "segment" | "none" | "insufficient-data"

/**
 * 两个实体的公共部分（布尔交集）作为**独立图元**。
 *
 * 与 `intersectionLine` 的分工：交线只给出两个对象的公共**边界**，交面给出公共**区域整体表面**。
 * 与 `section` 的分工：截面是"一个平面切实体"（半空间裁剪，结果一定带平面切口），
 * 交面是"两个实体求交"（结果的两个方向都是来源自己的表面）。
 *
 * `vertices` / `faces` / `volume` / `area` 全部由来源重算生成，界面里不给手改；
 * 来源一动，这份几何就跟着动（与截线、截面同一套依赖与级联语义）。
 */
export interface IntersectionSolidPrimitive extends PrimitivePresentation {
  id: string
  type: "intersectionSolid"
  sourceIds: [string, string]
  /** 交集的顶点表；`faces` 里的下标指向它。 */
  vertices: Vector3[]
  /** 交集各面的顶点下标环（首尾不重复）。 */
  faces: number[][]
  /** 交集体积（`polyhedron` 状态下 > 0；共面/共线/共点时按序退化为面积/长度/点）。 */
  volume: number
  /** 交集表面积。 */
  area: number
  status: IntersectionSolidStatus
  diagnostic?: string
}

/**
 * 两个实体公共区域上的**一个平面面片** —— 也就是"交面"。
 *
 * 为什么是"一个面"而不是整个交集表面：用户要的是**一个表面**（"我需要的交面只是一个表面，
 * 而不是所有相交的表面"）。布尔交集是一只封闭多面体（两个交叠立方体就是 6 个面），
 * 教学上要讲的是"公共部分的这一面在这里"；所以画布上把每一面分开显示、分开可点，
 * 点哪块就建哪一块。
 *
 * `hint` 是"这一面在上一次算出来时的形心"：来源一动，面的顺序可能变，按**离它最近的形心**
 * 重新认领同一个面，而不是按下标硬套（与平面画布多解交点的 `hint` 同一套思路）。
 */
export interface IntersectionFacePrimitive extends PrimitivePresentation {
  id: string
  type: "intersectionFace"
  sourceIds: [string, string]
  /** 这一面的有序顶点环（首尾不重复），由来源重算写入。 */
  points: Vector3[]
  /** 面的法向（朝交集外部）与面积，用于读数与渲染。 */
  normal: Vector3
  area: number
  /**
   * 这个面的面积是不是**闭式精确**的（可选；旧文档没有这个字段）。
   *
   * - `true`：面积有闭式解——平面的多边形就是它自己的面积，边界是整圆时是 `πab`（圆盘 `πr²`）；
   * - `false`：曲面区域（圆柱 / 圆锥侧面）的面积是**网格面片求和**，也就是数值近似，读数必须如实标出来；
   * - 缺省：旧文档 / 还没算过的图元，不假装知道。
   */
  areaExact?: boolean
  /**
   * 曲面区域的 `points` 是"外环 + 其余环反向缝合"的多边形，这个字段是**前导外环的顶点数**
   * （可选；旧文档 / 平面区域没有这个字段）。
   *
   * 缝了不止一圈时 `points` 的第 `i` 个点与 `points[points.length - 1 - i]` 配对（`i ∈ [0, outerRingLength)`），
   * 渲染方因此能把它三角化成**环向条带**；不写这个字段就只能从 `points[0]` 扇形铺开，
   * 而扇形会把两圈之间的洞整块填掉（圆柱侧带会画成那张圆盘）。
   */
  outerRingLength?: number
  /**
   * 曲面区域的**极点**在 `points` 里的下标（可选；圆锥的侧面就是这种区域）。
   *
   * 极点待在曲面内部、**不在边界环上**：它的边界只是一圈（圆锥侧面 = 底面那圈圆），但填充必须绕极点铺开。
   * 只按边界环铺的话，"圆锥面"会被填成底面那团圆盘、形心也落在底面圆心上（与真正的底面圆盘区域重合），
   * 画布上既看不出这是曲面、点它还会认领到隔壁那张圆盘。有极点时 `points[0]` 就是它。
   */
  poleIndex?: number
  /**
   * 这块区域所在的**解析曲面**（圆柱 / 圆锥）——渲染方按屏幕误差把填充细分、并把新顶点吸到真正的曲面上，
   * 于是"圆柱面 / 圆锥面"画出来是一条光滑曲面，而不是一圈平面三角形（旧文档没有这个字段）。
   */
  surface?: IntersectionSurfaceGeometry3
  hint: Vector3
  status: "valid" | "none" | "insufficient-data"
  diagnostic?: string
  /** 交面边界里的圆弧（圆柱 ∩ 立方体那种）：与截面同一套片段表示，旧文档没有这个字段。 */
  exactLoops?: CurvePiece3[][]
}

/**
 * 一张**有限二次曲面**的定义：底圆心 + 轴向单位向量 + 底半径 + 轴向高。
 *
 * 圆柱：轴向任意高度处半径都是 `radius`；圆锥：半径随轴向线性收缩到 0（锥尖在 `origin + axis·height`）。
 * 渲染方用它把交面的填充"吸"回真正的曲面上（径向距离按这个规则定），因此曲面上任意一点都可以精确算出来。
 */
export interface IntersectionSurfaceGeometry3 {
  kind: "cylinder" | "cone"
  origin: Vector3
  axis: Vector3
  radius: number
  height: number
}

/**
 * 两个对象相交处的**一个交点**：交线的端点 / 拐点（曲面相交处那些"转弯"的地方）。
 *
 * 完全包含的两个实体表面并不相交，所以那时**没有交点**（交线也没有）——这是数学事实，不是缺省。
 */
export interface IntersectionPoint3Primitive extends PrimitivePresentation {
  id: string
  type: "intersectionPoint3"
  sourceIds: [string, string]
  position: Vector3
  hint: Vector3
  status: "valid" | "none" | "insufficient-data"
  diagnostic?: string
}

/**
 * 圆的半径由一个**点图元**驱动：r = |圆心 → 那个点| × `factor`。
 *
 * 用户口径："第二动点能够作为圆心作圆，圆的半径能够调节，也能够根据动点位置进行动态变化。" ——
 * `centerPointId` 负责"点是圆心"，这条规则负责"半径随动点走"：把另一个动点选成驱动点，
 * 圆就始终过它，它沿轨道滑动时圆的大小随之变化。`factor`（缺省 1）是留给"半径 = 2 倍距离"这类题目的倍率。
 *
 * `radius` 字段仍然是圆的**派生缓存**：重算时按这条规则写回去，于是渲染、求交、测量全都无需改动。
 */
export interface CircleRadiusRule {
  pointId: string
  factor: number
}

export interface CirclePrimitive extends PrimitivePresentation {
  id: string
  type: "circle"
  center: Coordinate
  radius: number
  /**
   * 圆自己的朝向。圆本身看不出朝向，这个角只在**绕定点旋转**时才有意义：
   * 它记录"曲线自然参数（极角）的基准"，于是"定点在曲线上的参数"在反复旋转之后依然可算。
   * 没有放置信息时它保持缺省，旧文档不受影响。
   */
  rotation?: number
  /** 绕定点旋转（见 `CurveRotation`）。 */
  rotationAbout?: CurveRotation
  /**
   * **圆心跟随一个点图元**：用户口径"第二动点作为圆心作圆"。圆心不再是死坐标，点一动圆心就跟着动。
   * 与 `rotationAbout` 是两件事，不要同时用：`rotationAbout` 是"曲线绕定点转"，这里是"圆心就是那个点"。
   */
  centerPointId?: string
  /** 半径由另一个点图元驱动（见 `CircleRadiusRule`）。缺省表示半径就是 `radius` 字段、可在右侧直接改。 */
  radiusFrom?: CircleRadiusRule
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
  | IntersectionSolidPrimitive
  | IntersectionFacePrimitive
  | IntersectionPoint3Primitive
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

/**
 * 度量名 —— 与可求交类型同理，**只在这里定义一次**：文档校验、读数名、画布文本都从它派生。
 * 以前校验那边自己抄了一份字面量列表，于是"内核能算"与"文档能存"是两件事（周长 / 半径就是这么缺的）。
 */
export const MEASUREMENT_METRICS = ["length", "angle", "area", "volume", "distance", "dihedral", "perimeter", "radius"] as const
export type Measurement3Metric = (typeof MEASUREMENT_METRICS)[number]
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
