import { type AnnotationSpec, type CircleRadiusRule, type ConstraintSpec, type Coordinate, type CurveRotation, type DerivedSolidResult, type DrawingSheetSpec, type DrawingViewSpec, type EngineeringAnnotation, type GeometryDocument, type GroupSpec, type LayerSpec, type Measurement3, type Point3Binding, type Point3Primitive, type PointBinding, type PrimitiveSpec, type SolidConstruction, type TangentAnchor, type Vector3 } from "@draw/dsl"
import { buildSolidTemplate, calculateMeasurement3, composeEuler3, createBuilderContext, entityResolverFor, evaluateLineParameters, evaluateParameterExpressions, evaluatePlanarMeasurement, host3FromPrimitive, intersectCirclesDetailed, intersectConvexPolyhedra3, intersectFaceSets, intersectLineCircleDetailed, intersectLinesDetailed, intersectSampledPrimitives, mergeIntersectionSurfaces3, normalizeHostParameter, orderSectionPoints3, placedConic, quadric3FromPrimitive, rotatePointAboutAxis3, rotateVectorAboutAxis3, sectionConvexPolyhedron, sectionPolyhedron3, sectionQuadric3, sectionSolid3, solidVolumeHost3, solveCircumsphere3, solveInsphere3, solveLineConstraints, templateSolidPivot, triangleCenter2, triangleRadius2, type Conic3Kind, type CurvePiece3, type Host3, type IntersectionResult, type IntersectionSurfaceRegion, type PlanarMetric, type PlaceableConic, type SolidBoundary, type Sphere3, type TemplateSolidPrimitive, type WorldAxis3 } from "@draw/geometry-kernel"

export * from "./solidGeometry"

/**
 * **本文件内部也要用到它们**，所以除了"原样再导出"还要真的 import 一次。
 *
 * `export * from "./solidGeometry"` 只把那些名字挂到**模块的导出表**上，
 * **不会**在当前模块的作用域里建立局部绑定 —— 少了这一行，`operations.ts` 里
 * 凡是用到 `templateTopology` / `polyhedronSectionTopology` 的地方都会报 `Cannot find name`。
 * （拆文件时踩过：`export *` 看着像"把整个模块搬过来"，其实只搬了对外的那一面。）
 */
import { classifySectionPoints, movedSectionPlane, polyhedronSectionTopology, rotatedSectionPlane, solidSectionGeometry, templateTopology } from "./solidGeometry"

// 绕定点旋转的喂料层在 `./curveRotation`（评审方案 2 拆出来的）。
import { curveRotationOf, curveRotationPivotId, placementResolver } from "./curveRotation"
export { curveRotationPivotId, resolveCurveRotation } from "./curveRotation"

export type DomainOperation =
  | { op: "addPrimitive"; primitive: PrimitiveSpec }
  | { op: "addPrimitives"; primitives: PrimitiveSpec[] }
  | { op: "updatePrimitive"; id: string; patch: PrimitiveUpdatePatch }
  | { op: "toggleLock"; id: string; locked: boolean }
  | { op: "setParameter"; id: string; value: number; min?: number; max?: number; step?: number; label?: string; ownerId?: string }
  | { op: "deleteParameter"; id: string }
  | { op: "setParameterExpression"; id: string; expression: string }
  | { op: "addAnnotation"; annotation: AnnotationSpec }
  | { op: "deleteAnnotation"; id: string }
  | { op: "addEngineeringAnnotation"; annotation: EngineeringAnnotation }
  | { op: "deleteEngineeringAnnotation"; id: string }
  | { op: "addConstraint"; constraint: ConstraintSpec }
  | { op: "deleteConstraint"; id: string }
  | { op: "addMeasurement"; measurement: Measurement3 }
  | { op: "deleteMeasurement"; id: string }
  | { op: "deleteObject"; id: string }
  /**
   * **批量删除**（Task 0.4）：整批当作**并集**校验与级联，因此与选择顺序无关。
   * 逐项 `deleteObject` 的循环做不到这一点 —— "点 A 与依赖它的直线 AB"一起选中时，
   * 先删点会被"仍被引用"拒绝、先删线又会把点留下，谁先谁后都不对。
   */
  | { op: "deleteObjects"; ids: string[] }
  | { op: "toggleVisibility"; id: string; visible: boolean }
  | { op: "createGroup"; group: GroupSpec }
  | { op: "deleteGroup"; id: string }
  | { op: "alignPrimitives"; ids: string[]; alignment: Alignment }
  | { op: "setPrimitivesLocked"; ids: string[]; locked: boolean }
  | { op: "setPrimitivesVisible"; ids: string[]; visible: boolean }
  /**
   * 批量改外观。`style` 里出现的键才生效，值给 `undefined` 表示"清除这一项、回到默认"。
   * 与 `updatePrimitive` 的样式部分同一套字段，只是作用在整批选中对象上。
   */
  | { op: "setPrimitivesStyle"; ids: string[]; style: { stroke?: string; fill?: string; dash?: string; strokeWidth?: number; opacity?: number } }
  | { op: "addLayer"; layer: LayerSpec }
  | { op: "updateLayer"; id: string; patch: LayerUpdatePatch }
  | { op: "deleteLayer"; id: string; reassignTo?: string }
  | { op: "setActiveLayer"; id: string }
  | { op: "addDrawingSheet"; sheet: DrawingSheetSpec }
  | { op: "updateDrawingSheet"; id: string; patch: DrawingSheetUpdatePatch }
  | { op: "addDrawingView"; view: DrawingViewSpec }
  | { op: "updateDrawingView"; id: string; patch: DrawingViewUpdatePatch }
  | { op: "deleteDrawingView"; id: string }
  | { op: "translatePrimitive"; id: string; delta: { x: number; y: number } }
  /**
   * 自由拖动（立体几何）：按世界向量整体平移一个空间对象。
   * 由点驱动的对象平移它自己的点，模板实体平移自己的定位参数，生成拓扑由重算跟随。
   */
  | { op: "translatePrimitive3"; id: string; delta: Vector3 }
  /**
   * 绕**世界轴**整体旋转一个空间对象（"拖着转"与属性栏的角度输入共用）。
   *
   * 点驱动的对象（空间面 / 空间线 / 圆轨道 / 多面体）转的是它拥有的点，枢轴缺省 = 这些点的**形心**
   * （面的重心、线段中点、圆轨道的圆心），所以"绕自己转"永远不用调用方先算一次中心；
   * 模板实体写自己的欧拉角（`R_axis · R_euler`，与 `buildSolidTemplate` 同源），给 `pivot` 时连锚点一起
   * 挪，实体才会绕着那个点公转而不是原地自转。
   */
  | { op: "rotatePrimitive3"; id: string; axis: WorldAxis3; degrees: number; pivot?: Vector3 }
  /**
   * 沿自身法向平移剖切面（截面专用）。`distance` 为世界单位的有符号位移，正值朝法向方向。
   * 截面点由 `recomputeSection` 在同一事务里重算，所以"移动剖切面"和"截面形状更新"永远一致。
   */
  | { op: "moveSectionPlane"; id: string; distance: number }
  /** 绕世界轴旋转剖切面。`pivot` 省略时绕平面上离原点最近的点转；界面传实体中心，刀口才是"绕着图形摆斜"。 */
  | { op: "rotateSectionPlane"; id: string; axis: "x" | "y" | "z"; degrees: number; pivot?: Vector3 }
  /** 直接给定剖切面（例如"用某个面当剖切面"）。 */
  | { op: "setSectionPlane"; id: string; normal: Vector3; constant: number }

export type Alignment = "left" | "right" | "top" | "bottom" | "horizontalCenter" | "verticalCenter"

export type LayerUpdatePatch = Partial<Omit<LayerSpec, "id">>
export type DrawingSheetUpdatePatch = Partial<Omit<DrawingSheetSpec, "id">>
export type DrawingViewUpdatePatch = Partial<Omit<DrawingViewSpec, "id">>

export interface PrimitiveUpdatePatch {
  x?: number
  y?: number
  binding?: PointBinding
  a?: { x: number; y: number }
  b?: { x: number; y: number }
  center?: { x: number; y: number }
  vertex?: { x: number; y: number }
  radius?: number
  radiusX?: number
  radiusY?: number
  focalParameter?: number
  axis?: "x" | "y"
  startAngle?: number
  endAngle?: number
  points?: { x: number; y: number }[]
  expression?: string
  domain?: [number, number]
  samples?: number
  rotation?: number
  /** 绕定点旋转：整块替换（定点与转角一起写，避免"转了一半"的中间态）。 */
  rotationAbout?: CurveRotation
  /** 曲线切线的定位；`null` 表示去掉（切点回到读 `x`）。 */
  anchor?: TangentAnchor | null
  /** 切线的绘制半长。 */
  halfLength?: number
  /** 圆心跟随的点图元；`null` 表示去掉（圆心变回可编辑的坐标）。 */
  centerPointId?: string | null
  /** 半径随动点变化的规则；`null` 表示去掉（半径变回可编辑的数字）。 */
  radiusFrom?: CircleRadiusRule | null
  label?: string
  style?: { stroke?: string; fill?: string; strokeWidth?: number; opacity?: number; dash?: string }
  origin3?: Vector3
  size3?: Vector3
  /** Euler orientation of a parameterized solid, in radians; omitted axes keep their current angle. */
  rotation3?: Partial<Vector3>
  /** Drawn half-extent of a `plane3` patch; null returns it to automatic sizing. */
  halfSize?: number | null
  baseCenter3?: Vector3
  baseSize3?: { x: number; y: number }
  center3?: Vector3
  height?: number
  radius3?: number
  segments?: number
  position3?: Vector3
  binding3?: Point3Binding
}

/**
 * 一份文档与另一份是否**在语义上不同**（Task 0.3：no-op 不该把 revision 推高）。
 *
 * 比较时把时间戳钉成常量：`updatedAt` 每次都变，不排除的话"没改动"永远会被判成"改动了"。
 * 其余字段一律参与比较 —— 包括重算出来的派生几何，所以"显式字段没变但交点因此重算"仍算改动。
 */
/**
 * 语义规范化：把"写法不同、含义相同"的差异抹平。
 *
 * 实测发现的真实差异（诊断脚本打印）：`addPrimitive` 时没写 `visible`，事后 `toggleVisibility`
 * 设 `true`，于是文档里 `visible: undefined → true` —— 两者**都表示可见**，却让 no-op 被判成改动。
 * 同一件事在 `locked` 上也会发生。
 *
 * `revision` 与 `updatedAt` 在这里被排除：它们是**版本与时间**，不是内容。
 */
function normalizeForComparison(value: unknown, key?: string): unknown {
  if (key === "revision" || key === "updatedAt") return undefined
  if (Array.isArray(value)) return value.map((item) => normalizeForComparison(item))
  if (value === null || typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (childKey === "revision" || childKey === "updatedAt") continue
    // `visible: true` 与缺省**等价**（两者都表示"可见"），只有显式 `false` 才表示被关掉。
    // **`locked` 不能这样处理**：它的缺省是"未锁定"，`locked: true` 是一个真实的语义变化 ——
    // 把两者混为一谈会让 `toggleLock` 被判成 no-op，锁根本写不进文档（这是本任务实测踩到的坑）。
    if (childKey === "visible" && (childValue === undefined || childValue === true)) continue
    out[childKey] = normalizeForComparison(childValue, childKey)
  }
  return out
}

function documentChanged(before: GeometryDocument, after: GeometryDocument): boolean {
  return JSON.stringify(normalizeForComparison(before)) !== JSON.stringify(normalizeForComparison(after))
}

/**
 * 运行时操作守卫由 `operationNames.ts` 定义（那里有真值列表，且不会与它形成循环导入），
 * 这里再导出一份，让 `./operations` 作为操作相关 API 的统一入口保持完整。
 */
/**
 * 数值参数必须是有限数（Task 0.3 的补强）。
 *
 * 为什么必须有这道闸：`moveSectionPlane` 收到 `NaN` 时会把 `plane.constant` 写成 `NaN`，
 * 既不提前返回也不抛错 —— 于是"被拒绝的操作"看起来像一次成功提交。
 * 更糟的是 `NaN` 在 JSON 里序列化成 `null`，任何基于序列化的比较都会把它读成"内容变了"。
 * 所以**在入口拒绝**，而不是事后靠比较去猜。
 */
function requireFinite(values: Readonly<Record<string, number | undefined>>, operationName: string): string | null {
  for (const [field, value] of Object.entries(values)) {
    if (value !== undefined && !Number.isFinite(value)) return `${operationName}: ${field} must be a finite number`
  }
  return null
}

export { isDomainOperation } from "./operationNames"

/**
 * 把一次删除**计划**应用到文档上（`deleteObject` 与 `deleteObjects` 共用，避免两套语义漂移）。
 *
 * 顺序是刻意的：先解绑（宿主没了的点降级为自由点、保留位置），再过滤图元，
 * **最后**回收孤儿驱动参数 —— 若在过滤前回收，被删图元自己的绑定会被算成"仍被引用"。
 */
function applyDeletionPlan(next: GeometryDocument, ids: string[]): { plan: DeletionPlan; removedAny: boolean } {
  const plan = deletionPlan(next, ids)
  const targets = plan.primitives
  const before = next.primitives.length
  next.primitives = next.primitives.map((primitive) => unbindDeletedHost(primitive, targets)).filter((primitive) => !targets.has(primitive.id))
  const removedAny = before !== next.primitives.length

  if (plan.measurements.size > 0) next.measurements = next.measurements.filter((measurement) => !plan.measurements.has(measurement.id))
  if (plan.annotations.size > 0) next.annotations = next.annotations.filter((annotation) => !plan.annotations.has(annotation.id))
  if (plan.engineeringAnnotations.size > 0 && next.engineeringAnnotations) next.engineeringAnnotations = next.engineeringAnnotations.filter((annotation) => !plan.engineeringAnnotations.has(annotation.id))
  if (plan.constraints.size > 0) next.constraints = next.constraints.filter((constraint) => !plan.constraints.has(constraint.id))
  if (plan.groupMembers.size > 0) next.groups = next.groups
    .map((group) => group.members.some((member) => plan.groupMembers.has(member)) ? { ...group, members: group.members.filter((member) => !plan.groupMembers.has(member)) } : group)
    // 只剩一个成员（或空）的分组是无效数据：`validateDocument` 要求成员 ≥ 2，
    // 留着它会让整份文档再也存不下去（`encodeMgeo` 抛 "group has invalid members"）。直接解散。
    .filter((group) => group.members.length >= 2)

  /**
   * 回收"随对象自动生成"的驱动参数。判据是**孤儿**而不是"本次被删"：
   * 只要它带 `ownerId`（自动生成）且**没有任何图元引用它**，就是垃圾 —— 不论归属对象是否还在。
   *
   * 为什么不再要求"归属对象也没了"：宿主（曲线 / 面 / 实体）被删除时，绑定点会被**降级为自由点**
   * （见 `unbindDeletedHost`，位置保留），于是那个 `t-<点id>` 参数既没有引用者、也不再有意义，
   * 却因为归属点还在而留在文档里（实测：删掉圆之后参数列表里多出一个没人用的 "A 的路径参数"）。
   * 这里只在**删除操作**里跑，不存在"刚解绑、马上又要重绑"的中间态。
   * 用户手工创建的参数不带 `ownerId`，永远不会被这一步碰掉。
   */
  for (const [parameterId, parameter] of Object.entries(next.parameters)) {
    if (!parameter.ownerId) continue
    if (parameterIsReferenced(next, parameterId)) continue
    delete next.parameters[parameterId]
  }
  return { plan, removedAny }
}

export interface OperationResult {
  document: GeometryDocument
  changed: boolean
  error?: string
}

interface PrimitiveBounds { minX: number; maxX: number; minY: number; maxY: number }

export function createPoint3(id: string, position: Vector3, binding: Point3Binding = { kind: "free" }): Point3Primitive {
  return { id, type: "point3", position: { ...position }, binding }
}

export function createLine3(id: string, pointIds: [string, string]): Extract<PrimitiveSpec, { type: "line3" }> {
  return { id, type: "line3", definition: { kind: "throughPoints", pointIds: [...pointIds] as [string, string] } }
}

export function createFace3(id: string, pointIds: string[], edgeIds?: string[]): Extract<PrimitiveSpec, { type: "face3" }> {
  return { id, type: "face3", pointIds: [...pointIds], ...(edgeIds ? { edgeIds: [...edgeIds] } : {}) }
}

export function createPolyhedron3(id: string, vertexIds: string[], edgeIds: string[], faceIds: string[], construction: Extract<NonNullable<Extract<PrimitiveSpec, { type: "polyhedron3" }>["construction"]>, { kind: "fromPoints" | "fromFaces" }> = { kind: "fromFaces", sourceIds: [...vertexIds, ...edgeIds, ...faceIds] }): Extract<PrimitiveSpec, { type: "polyhedron3" }> {
  return { id, type: "polyhedron3", vertexIds: [...vertexIds], edgeIds: [...edgeIds], faceIds: [...faceIds], construction: { ...construction, sourceIds: [...construction.sourceIds] } }
}

export function patchPoint3(id: string, position: Vector3): Extract<DomainOperation, { op: "updatePrimitive" }> {
  return { op: "updatePrimitive", id, patch: { position3: { ...position } } }
}

function angleOnArc(angle: number, start: number, end: number): boolean {
  const full = Math.PI * 2
  const normalized = (value: number) => (value % full + full) % full
  const delta = end - start
  const direction = delta >= 0 ? 1 : -1
  const span = Math.min(Math.abs(delta), full)
  return normalized(direction * (angle - start)) <= span + 1e-10
}

function primitiveBounds(primitive: PrimitiveSpec): PrimitiveBounds | null {
  if (primitive.type === "point") return { minX: primitive.x, maxX: primitive.x, minY: primitive.y, maxY: primitive.y }
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") return {
    minX: Math.min(primitive.a.x, primitive.b.x), maxX: Math.max(primitive.a.x, primitive.b.x),
    minY: Math.min(primitive.a.y, primitive.b.y), maxY: Math.max(primitive.a.y, primitive.b.y)
  }
  if (primitive.type === "circle") return { minX: primitive.center.x - primitive.radius, maxX: primitive.center.x + primitive.radius, minY: primitive.center.y - primitive.radius, maxY: primitive.center.y + primitive.radius }
  if (primitive.type === "arc") {
    const angles = [primitive.startAngle, primitive.endAngle, 0, Math.PI / 2, Math.PI, Math.PI * 1.5].filter((angle) => angle === primitive.startAngle || angle === primitive.endAngle || angleOnArc(angle, primitive.startAngle, primitive.endAngle))
    const points = angles.map((angle) => ({ x: primitive.center.x + primitive.radius * Math.cos(angle), y: primitive.center.y + primitive.radius * Math.sin(angle) }))
    return { minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)), minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)) }
  }
  return null
}

/**
 * 平移一个图元。带"绕定点旋转"的曲线要连**定点与基准圆心一起搬**：
 * 只搬结果不搬基准，下一次重算就会用旧基准把曲线拉回去（实测过）。
 * 定点是点图元时不动它 —— 它是独立图元，由它自己的平移负责。
 */
function translatePrimitive(primitive: PrimitiveSpec, x: number, y: number): PrimitiveSpec {
  if (primitive.type === "point") return { ...primitive, x: primitive.x + x, y: primitive.y + y }
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") return {
    ...primitive,
    a: { x: primitive.a.x + x, y: primitive.a.y + y },
    b: { x: primitive.b.x + x, y: primitive.b.y + y }
  }
  if (primitive.type === "polyline") return { ...primitive, points: primitive.points.map((point) => ({ x: point.x + x, y: point.y + y })) }
  if (primitive.type === "circle" || primitive.type === "arc") return { ...primitive, center: { x: primitive.center.x + x, y: primitive.center.y + y }, ...shiftedRotationAbout(primitive, x, y) }
  if (primitive.type === "parabola") return { ...primitive, vertex: { x: primitive.vertex.x + x, y: primitive.vertex.y + y } }
  if (primitive.type === "ellipse" || primitive.type === "hyperbola") return { ...primitive, center: { x: primitive.center.x + x, y: primitive.center.y + y }, ...shiftedRotationAbout(primitive, x, y) }
  return primitive
}

/**
 * 带 `sourceIds` 的构造：`template` / `fromPoints` / `fromFaces`。
 *
 * `prism` 的构造里**没有** `sourceIds`（它的来源是自带的底面多边形与拉伸向量），所以
 * "遍历构造的来源"这种代码必须先收窄到这一支 —— 直接写 `construction?.sourceIds` 在加了
 * `prism` 之后就不成立（`tsc` 会拦，这也正是判别联合该起的作用）。
 */

/**
 * **棱柱的构造描述是否仍然与实际顶点一致**（Fix round 2 / I4）。
 *
 * 判据就是 `PrismConstruction` 自己的定义：前 `n` 个顶点是底面、`T_i = B_i + vector`。
 * 只要有一条不成立，这份描述就不再是这只实体的真相（拖走一个顶点、把底面拉得不共面……），
 * 那时必须改记成显式面环，而不是让文档继续宣称"我是按底面 + 向量拉伸出来的"。
 *
 * 判据用**相对容差**（按模型尺度），与 `validatePrismInput` 同一套口径：绝对容差在
 * 1e-6 量级的模型上会把合法的整只平移判成"变了"。
 */
function prismMatchesVertices(
  polyhedron: Extract<PrimitiveSpec, { type: "polyhedron3" }>,
  construction: Extract<SolidConstruction, { kind: "prism" }>,
  primitives: readonly PrimitiveSpec[]
): boolean {
  const base = construction.base.polygon
  if (base.length < 3 || polyhedron.vertexIds.length !== base.length * 2) return false
  const positions = polyhedron.vertexIds.map((vertexId) => {
    const vertex = primitives.find((candidate) => candidate.id === vertexId)
    return vertex?.type === "point3" ? vertex.position : null
  })
  if (positions.some((position) => position === null)) return false
  const defined = positions as Vector3[]
  const scale = Math.max(1, ...defined.flatMap((point) => [Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)]))
  const tolerance = scale * 1e-9
  const close = (first: Vector3, second: Vector3) =>
    Math.abs(first.x - second.x) <= tolerance && Math.abs(first.y - second.y) <= tolerance && Math.abs(first.z - second.z) <= tolerance
  for (let index = 0; index < base.length; index += 1) {
    if (!close(defined[index], base[index])) return false
    if (!close(defined[base.length + index], { x: base[index].x + construction.vector.x, y: base[index].y + construction.vector.y, z: base[index].z + construction.vector.z })) return false
  }
  return true
}

/**
 * **整只实体被搬动之后，让棱柱的构造描述跟上顶点**（外部审查 M1）。
 *
 * `prismMatchesVertices` 那道检查原先只在 `updatePrimitive` 的 `point3` 分支里跑 ——
 * 于是拖动 / 旋转**整只**实体之后，文档继续宣称"我是由这个底面加这个向量拉伸出来的"，
 * 而顶点已经不是了（实测：平移 `(5,0,0)` 之后描述符里的底面还在原点，顶点已经走到 x=5）。
 * 规格 §1.2 的口径是"构造描述是真源、顶点是确定性派生拓扑"，那就不能让它说假话。
 *
 * **做法是从顶点反推描述**，而不是直接降级成 `fromFaces`：搬动是**刚体变换**，
 * 所以"前 n 个顶点是底面、后 n 个是 `Ti = Bi + v`"这条结构仍然成立 ——
 * 取新的底面顶点、再取 `v = T₀ − B₀`，就得到与新顶点**完全一致**的描述。
 * 这比"整体降级"更好：保留了棱柱记法这条信息（降级会把它丢掉）。
 * 反推之后仍然用 `prismMatchesVertices` 复核一次；万一对不上（不是刚体搬动），
 * 就按同一条既有策略降级为 `fromFaces` + `sourceId`。
 */
function realignPrismDescriptor(primitive: PrimitiveSpec, primitives: readonly PrimitiveSpec[]): void {
  if (primitive.type !== "polyhedron3" || primitive.construction?.kind !== "prism") return
  const count = primitive.construction.base.polygon.length
  if (count < 3 || primitive.vertexIds.length !== count * 2) return
  const positions = primitive.vertexIds.map((vertexId) => {
    const vertex = primitives.find((candidate) => candidate.id === vertexId)
    return vertex?.type === "point3" ? vertex.position : null
  })
  if (positions.some((position) => position === null)) return
  const defined = positions as Vector3[]
  const polygon = defined.slice(0, count).map((point) => ({ x: point.x, y: point.y, z: point.z }))
  const first = defined[0]
  const top = defined[count]
  const vector = { x: top.x - first.x, y: top.y - first.y, z: top.z - first.z }
  const candidate = { ...primitive, construction: { kind: "prism" as const, base: { polygon }, vector } }
  if (prismMatchesVertices(candidate, candidate.construction, primitives)) {
    primitive.construction = candidate.construction
    return
  }
  primitive.construction = { kind: "fromFaces", sourceIds: [...primitive.faceIds], sourceId: primitive.id }
}

/**
 * 平移时同步搬动旋转的基准：基准圆心总是跟着走；定点是固定坐标时也一起搬
 * （这样"绕这个定点转了多少度"在平移前后完全一致），定点是点图元时保持原样。
 */
function shiftedRotationAbout(primitive: PrimitiveSpec, x: number, y: number): { rotationAbout?: CurveRotation } {
  const rotation = curveRotationOf(primitive)
  if (!rotation) return {}
  const baseCenter = { x: rotation.baseCenter.x + x, y: rotation.baseCenter.y + y }
  // 两种定点分开构造：合并写法会让 `pivot` 联合类型对不上（TS 的辨识联合不做隐式收窄）。
  return {
    rotationAbout: rotation.pivot.kind === "coordinate"
      ? { pivot: { kind: "coordinate", x: rotation.pivot.x + x, y: rotation.pivot.y + y }, angle: rotation.angle, baseCenter }
      : { pivot: rotation.pivot, angle: rotation.angle, baseCenter }
  }
}

function signedOffset(value: number): string {
  return value < 0 ? String(value) : `+${value}`
}

function translateFunction(primitive: Extract<PrimitiveSpec, { type: "function" }>, x: number, y: number): Extract<PrimitiveSpec, { type: "function" }> {
  const shiftedExpression = primitive.expression.replace(/\bx\b/g, `(x${signedOffset(-x)})`)
  return { ...primitive, expression: `(${shiftedExpression})${signedOffset(y)}`, domain: [primitive.domain[0] + x, primitive.domain[1] + x] }
}

function shiftedPoint(point: Vector3, delta: Vector3): Vector3 {
  return { x: point.x + delta.x, y: point.y + delta.y, z: point.z + delta.z }
}

function point3Index(document: GeometryDocument): Map<string, Point3Primitive> {
  return new Map(document.primitives.filter((candidate): candidate is Point3Primitive => candidate.type === "point3").map((point) => [point.id, point]))
}

/**
 * 允许改**几何**字段的图元类型（style / label 不受此限，任何未锁定对象都能改）。
 *
 * 为什么抽成一处：校验（`patches.ts`）与应用（本文件）各写过一份，两份一旦不同步就会出现
 * "校验通过、提交却被拒"这种最难受的失败——实测就是这么撞上的（`circle3` 只加进了一份）。
 */
export const EDITABLE_GEOMETRY_TYPES = ["point", "point3", "line", "segment", "ray", "polyline", "parabola", "ellipse", "hyperbola", "function", "circle", "arc", "tangent", "normal", "cube", "pyramid", "cylinder", "cone", "plane3", "circle3"] as const

/**
 * Point-driven objects only reference their points; those points are what a drag has to move.
 *
 * 导出给画布用：旋转手柄的枢轴（"它拥有的点的形心"）与域操作必须是**同一份**点清单，
 * 两份各写一次就会出现"环画在 A、转的是 B"。
 */
export function managedPointIds(primitive: PrimitiveSpec): string[] {
  if (primitive.type === "line3") return primitive.definition.kind === "throughPoints" ? [...primitive.definition.pointIds] : [primitive.definition.pointId]
  if (primitive.type === "segment3" || primitive.type === "edge3") return [...primitive.pointIds]
  if (primitive.type === "ray3") return [primitive.originId, primitive.throughId]
  if (primitive.type === "plane3") return primitive.definition.kind === "throughPoints" ? [...primitive.definition.pointIds] : [primitive.definition.pointId]
  if (primitive.type === "face3") return [...primitive.pointIds]
  // 空间圆轨道**自带圆心坐标**，不引用任何点：它一个点都不"拥有"（点是乘客，不是它的定义）。
  if (primitive.type === "polyhedron3") return [...primitive.vertexIds]
  return []
}

/**
 * Every point/edge/face a template solid materialised. Those children are drawn from their parent, so a drag
 * has to move the parent; letting a child move on its own would silently pull the solid apart.
 */
export function templateTopologyIds(document: GeometryDocument): Set<string> {
  const ids = new Set<string>()
  for (const primitive of document.primitives) {
    if (primitive.type !== "polyhedron3" || primitive.construction?.kind !== "template") continue
    for (const childId of [...primitive.vertexIds, ...primitive.edgeIds, ...primitive.faceIds]) ids.add(childId)
  }
  return ids
}

/**
 * Whether free dragging may move this object at all. Generated topology is excluded (above); planes and
 * point-driven lines/edges/faces only move when the points they are defined by can move; bound points belong
 * to whatever binds them.
 */
export function isFreeDraggable3(primitive: PrimitiveSpec, points: Map<string, Point3Primitive>, generated: Set<string> = new Set()): boolean {
  if (primitive.locked) return false
  if (generated.has(primitive.id)) return false
  if (primitive.type === "point3") return !primitive.binding || primitive.binding.kind === "free"
  if (primitive.type === "cube" || primitive.type === "pyramid" || primitive.type === "cylinder" || primitive.type === "cone") return true
  // 轨道圆与模板实体同类：几何是**它自己的**（圆心坐标 / 半径 / 法向），不依赖任何点能不能动。
  if (primitive.type === "circle3") return true
  if (!["line3", "segment3", "ray3", "plane3", "face3", "polyhedron3", "edge3"].includes(primitive.type)) return false
  const owned = managedPointIds(primitive)
  if (owned.length === 0) return false
  return owned.every((id) => {
    if (generated.has(id)) return false
    const point = points.get(id)
    return Boolean(point) && (!point!.binding || point!.binding.kind === "free")
  })
}

/**
 * Translate an object along a world vector. The object's own geometry is either a stored parameter (a template
 * solid's anchor, or a free point's position) or an inherited reference to its points; `movedIds` names what
 * else this drag has to move, which is also what tells the dependent recompute what to re-derive.
 */
function translatePrimitive3(primitive: PrimitiveSpec, delta: Vector3): { primitive: PrimitiveSpec; movedIds: string[] } {
  if (primitive.type === "point3") {
    if (primitive.binding && primitive.binding.kind !== "free") return { primitive, movedIds: [] }
    return { primitive: { ...primitive, position: shiftedPoint(primitive.position, delta) }, movedIds: [primitive.id] }
  }
  if (primitive.type === "cube") return { primitive: { ...primitive, origin: shiftedPoint(primitive.origin, delta) }, movedIds: [primitive.id] }
  if (primitive.type === "pyramid") return { primitive: { ...primitive, baseCenter: shiftedPoint(primitive.baseCenter, delta) }, movedIds: [primitive.id] }
  if (primitive.type === "cylinder" || primitive.type === "cone") return { primitive: { ...primitive, center: shiftedPoint(primitive.center, delta) }, movedIds: [primitive.id] }
  // 轨道圆平移的是**它自己的圆心**（不引用点，所以不会把任何点带走）。
  if (primitive.type === "circle3") return { primitive: { ...primitive, center: shiftedPoint(primitive.center, delta) }, movedIds: [primitive.id] }
  return { primitive, movedIds: managedPointIds(primitive) }
}

/**
 * 哪些对象**有朝向可转**。与"能不能拖"同一套边界（锁定、物化拓扑、绑定的点都排除在外），
 * 只多一条：孤立的 `point3` 没有朝向——转一个点绕它自己等于没转，真要绕定点摆它请用平移。
 */
export function isRotatable3(primitive: PrimitiveSpec, points: Map<string, Point3Primitive>, generated: Set<string> = new Set()): boolean {
  if (primitive.type === "point3") return false
  return isFreeDraggable3(primitive, points, generated)
}

/** 点驱动对象的旋转枢轴缺省值：它拥有那些点的**形心**（面的重心、线段中点、圆轨道的圆心）。 */
function centroidOfOwnedPoints(primitive: PrimitiveSpec, points: Map<string, Point3Primitive>): Vector3 | null {
  const positions: Vector3[] = []
  for (const id of managedPointIds(primitive)) {
    const position = points.get(id)?.position
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y) || !Number.isFinite(position.z)) return null
    positions.push(position)
  }
  if (positions.length === 0) return null
  const total = positions.reduce<Vector3>((sum, position) => ({ x: sum.x + position.x, y: sum.y + position.y, z: sum.z + position.z }), { x: 0, y: 0, z: 0 })
  return { x: total.x / positions.length, y: total.y / positions.length, z: total.z / positions.length }
}

/**
 * 把对象**存在文档里**的朝向向量一起转过去。
 *
 * 只转参考点是不够的：`circle3` 的法向、`pointNormal` 平面的法向、`pointDirection` 直线的方向都是
 * 独立存下来的——漏掉哪个，哪个就会"读数说转了、画面上还指着原来那边"。面的法向不在这里，
 * 它是从点算出来的，点转了它自然跟着转。
 */
function rotatedOrientationVectors(primitive: PrimitiveSpec, axis: WorldAxis3, radians: number): Partial<PrimitiveSpec> {
  if (primitive.type === "circle3") return { normal: rotateVectorAboutAxis3(primitive.normal, axis, radians) }
  if (primitive.type === "line3" && primitive.definition.kind === "pointDirection") return { definition: { ...primitive.definition, direction: rotateVectorAboutAxis3(primitive.definition.direction, axis, radians) } }
  if (primitive.type === "plane3" && primitive.definition.kind === "pointNormal") return { definition: { ...primitive.definition, normal: rotateVectorAboutAxis3(primitive.definition.normal, axis, radians) } }
  return {}
}

/**
 * 绕世界轴转过 `degrees`（右手法则）。返回值里 `movedPoints` 是"这次旋转动了哪些点、动到哪儿"，
 * 既是依赖重算的入口，也是撤销粒度的依据——一次拖动就是一次操作、一个撤销步骤。
 *
 * 返回 `null` 表示"这个对象没有可转的几何"（缺参考点、图形退化），调用方如实报错而不是写一个空改动。
 */
function rotatePrimitive3(primitive: PrimitiveSpec, points: Map<string, Point3Primitive>, axis: WorldAxis3, degrees: number, pivot?: Vector3): { primitive: PrimitiveSpec; movedPoints: { id: string; position: Vector3 }[] } | null {
  const radians = (degrees * Math.PI) / 180
  /**
   * 模板实体：只写欧拉角 + 挪锚点，物化出来的顶点由 `buildSolidTemplate` 按新角度重算
   * （与属性栏改 `rotation3` 走同一条路，所以两种入口画出来必然一致）。
   */
  if (primitive.type === "cube" || primitive.type === "pyramid" || primitive.type === "cylinder" || primitive.type === "cone") {
    const centre = templateSolidPivot(primitive)
    const target = pivot ?? centre
    const turnedCentre = rotatePointAboutAxis3(centre, target, axis, radians)
    const shift = { x: turnedCentre.x - centre.x, y: turnedCentre.y - centre.y, z: turnedCentre.z - centre.z }
    const rotation = composeEuler3(primitive.rotation ?? { x: 0, y: 0, z: 0 }, axis, radians)
    const moved = primitive.type === "cube"
      ? { ...primitive, origin: shiftedPoint(primitive.origin, shift) }
      : primitive.type === "pyramid"
        ? { ...primitive, baseCenter: shiftedPoint(primitive.baseCenter, shift) }
        : { ...primitive, center: shiftedPoint(primitive.center, shift) }
    return { primitive: { ...moved, rotation }, movedPoints: [] }
  }
  /**
   * 轨道圆：几何是它自己的（圆心 + 法向 + 半径），所以绕轴转就是**转它自己的法向**；
   * 默认枢轴就是它自己的圆心（绕自己转时圆心不动），给了 `pivot` 时圆心绕那个世界点公转。
   */
  if (primitive.type === "circle3") {
    const target = pivot ?? primitive.center
    return {
      primitive: { ...primitive, center: rotatePointAboutAxis3(primitive.center, target, axis, radians), normal: rotateVectorAboutAxis3(primitive.normal, axis, radians) },
      movedPoints: []
    }
  }
  const owned = managedPointIds(primitive)
  const target = pivot ?? centroidOfOwnedPoints(primitive, points)
  if (!target || owned.length === 0) return null
  return {
    primitive: { ...primitive, ...rotatedOrientationVectors(primitive, axis, radians) } as PrimitiveSpec,
    movedPoints: owned.map((id) => ({ id, position: rotatePointAboutAxis3(points.get(id)!.position, target, axis, radians) }))
  }
}

/**
 * 解析截面边界：源是圆柱 / 圆锥时给出**精确**圆锥曲线片段环（写进 `section.exact`）。
 *
 * 其余来源（立方体 / 棱锥 / 点驱动多面体）返回 `undefined`：它们的边界本来就是多边形，精确的，
 * 多边形路径就是答案，不需要解析层。
 */
function analyticSectionBoundary(source: PrimitiveSpec, plane: { normal: Vector3; constant: number }): { kind: Conic3Kind; loops: CurvePiece3[][] } | undefined {
  const quadric = quadric3FromPrimitive(source)
  if (!quadric) return undefined
  return sectionQuadric3(quadric, plane) ?? undefined
}

/** 边界是弯曲的（圆 / 椭圆 / 抛物线 / 双曲线）才算真的精确；直线与点走多边形路径本来就是精确的。 */
const curvedConicKinds = new Set<Conic3Kind>(["circle", "ellipse", "parabola", "hyperbola"])

function attachExactBoundary(section: Extract<PrimitiveSpec, { type: "section" }>, exact: { kind: Conic3Kind; loops: CurvePiece3[][] } | undefined): Extract<PrimitiveSpec, { type: "section" }> {
  if (exact) return { ...section, exact, status: curvedConicKinds.has(exact.kind) ? "exact" : section.status }
  // 来源不再是圆柱 / 圆锥时要把旧字段摘掉，否则会留下一份和现几何对不上的解析边界。
  const { exact: _stale, ...rest } = section
  return rest
}

function recomputeSection(primitive: Extract<PrimitiveSpec, { type: "section" }>, source: PrimitiveSpec, primitiveMap: Map<string, PrimitiveSpec>): Extract<PrimitiveSpec, { type: "section" }> {
  const exact = analyticSectionBoundary(source, primitive.plane)
  const finish = (section: Extract<PrimitiveSpec, { type: "section" }>) => attachExactBoundary(section, exact)
  const polyhedron = source.type === "polyhedron3" ? source : templateTopology(source.id, primitiveMap)
  const topology = polyhedron ? polyhedronSectionTopology(polyhedron, primitiveMap) : null
  if (topology) {
    const result = sectionPolyhedron3(topology.vertices, topology.faces, primitive.plane)
    if (result.status === "none") return finish({ ...primitive, points: [], loops: [], classification: "none", status: "undefined", visible: false, diagnostic: result.explanation })
    if (result.status === "insufficient-data") return finish({ ...primitive, points: [], loops: [], classification: "insufficient-data", status: "failed", visible: false, diagnostic: result.explanation })
    return finish({ ...primitive, points: result.points, loops: result.loops, classification: result.status, status: "approximate", visible: result.status !== "point", diagnostic: result.status === "polygon" ? undefined : result.explanation })
  }
  if (!["cube", "pyramid", "cylinder", "cone"].includes(source.type)) return finish({ ...primitive, points: [], loops: [], classification: "insufficient-data", status: "failed", visible: false, diagnostic: "截面来源不是可剖切的实体。" })
  const geometry = solidSectionGeometry(source as Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>)
  const points = orderSectionPoints3(sectionConvexPolyhedron(geometry.vertices, geometry.edges, primitive.plane), primitive.plane)
  return finish({ ...primitive, points, loops: points.length >= 3 ? [points] : [], classification: classifySectionPoints(points), status: points.length > 0 ? "approximate" : "undefined", visible: points.length > 0, diagnostic: points.length >= 3 ? undefined : "剖切平面与模板实体相切或沿棱相交。" })
}

/**
 * 交线来源的面环。
 * - `polyhedron3` / 四类模板：取物化拓扑的顶点+面环；
 * - `face3`：它自己就是一个面环；
 * - `plane3`：平面没有边界，不能作为"有界交线"的来源（返回 null，由调用方给诊断）。
 */
export function intersectionFaceRings(source: PrimitiveSpec, primitiveMap: Map<string, PrimitiveSpec>): Vector3[][] | null {
  if (source.type === "face3") {
    const points: Vector3[] = []
    for (const pointId of source.pointIds) {
      const point = primitiveMap.get(pointId)
      if (point?.type !== "point3") return null
      points.push({ ...point.position })
    }
    return points.length >= 3 ? [points] : null
  }
  const polyhedron = source.type === "polyhedron3" ? source : templateTopology(source.id, primitiveMap)
  if (!polyhedron) return null
  const topology = polyhedronSectionTopology(polyhedron, primitiveMap)
  if (!topology) return null
  return topology.faces.map((face) => face.map((index) => topology.vertices[index]))
}

/**
 * 交线随来源重算：两个来源的面环两两求交，去重合并后写回 `segments`。
 * 与截面的区别：截面是"一个平面切实体"，交线是"两个对象的公共边界"。
 */
function recomputeIntersectionLine(
  primitive: Extract<PrimitiveSpec, { type: "intersectionLine" }>,
  primitiveMap: Map<string, PrimitiveSpec>
): Extract<PrimitiveSpec, { type: "intersectionLine" }> {
  const sources = primitive.sourceIds.map((id) => primitiveMap.get(id))
  if (sources.some((source) => !source)) {
    return { ...primitive, segments: [], classification: "insufficient-data", status: "insufficient-data", visible: false, diagnostic: "交线来源对象不存在。" }
  }
  const rings = sources.map((source) => intersectionFaceRings(source!, primitiveMap))
  if (rings.some((entry) => !entry)) {
    return { ...primitive, segments: [], classification: "insufficient-data", status: "insufficient-data", visible: false, diagnostic: "交线来源缺少可用的面环（平面没有边界，模板需要已物化的拓扑）。" }
  }
  const result = intersectFaceSets(rings[0]!, rings[1]!)
  if (result.classification === "insufficient-data") {
    return { ...primitive, segments: [], classification: "insufficient-data", status: "insufficient-data", visible: false, diagnostic: result.explanation }
  }
  if (result.classification === "none") {
    return { ...primitive, segments: [], classification: "none", status: "degenerate", visible: false, diagnostic: [result.explanation, ...result.diagnostics].join(" ") }
  }
  return {
    ...primitive,
    segments: result.segments,
    classification: result.classification,
    status: "valid",
    visible: true,
    diagnostic: result.diagnostics.length > 0 ? result.diagnostics.join(" ") : undefined
  }
}

/**
 * 交面（布尔交集）随来源重算：两个实体的公共区域整体表面。
 *
 * 与 `recomputeIntersectionLine` 的区别：交线只写回"公共边界"的线段，交面写回**面集合**与体积/表面积。
 * 形态不完整时（不重叠、只贴面/贴线/贴点、来源不是实体、非凸被内核拒绝）一律给诊断而不是硬画，
 * 其中"贴面"（`flat`）仍有面积，值得画出来，所以保持可见。
 */
function recomputeIntersectionSolid(
  primitive: Extract<PrimitiveSpec, { type: "intersectionSolid" }>,
  primitiveMap: Map<string, PrimitiveSpec>
): Extract<PrimitiveSpec, { type: "intersectionSolid" }> {
  const outcome = resolveSolidIntersection(primitive.sourceIds.map((id) => primitiveMap.get(id)), primitiveMap)
  const empty = { vertices: [], faces: [], volume: 0, area: 0 }
  if (!outcome.ok) return { ...primitive, ...empty, status: "insufficient-data", visible: false, diagnostic: explainOutcome(outcome) }
  const { result } = outcome
  if (result.status === "none") return { ...primitive, ...empty, status: "none", visible: false, diagnostic: result.explanation }
  // 贴面（flat）有面积、看得见；贴线 / 贴点只是一条线或一个点，交给交线图元更合适。
  const visible = result.status === "polyhedron" || result.status === "flat"
  return {
    ...primitive,
    vertices: result.vertices,
    faces: result.faces,
    volume: result.volume,
    area: result.area,
    status: result.status,
    visible,
    diagnostic: result.diagnostics.length > 0 ? [result.explanation, ...result.diagnostics].join(" ") : undefined
  }
}

/** 两个来源的布尔交集：来源缺失 / 不是实体 / 内核拒绝非凸时给出诊断，而不是硬算。 */
type SolidIntersectionOutcome =
  | { ok: true; result: ReturnType<typeof intersectConvexPolyhedra3> }
  | { ok: false; explanation: string; diagnostics: string[] }

function resolveSolidIntersection(sources: (PrimitiveSpec | undefined)[], primitiveMap: Map<string, PrimitiveSpec>): SolidIntersectionOutcome {
  if (sources.some((source) => !source)) return { ok: false, explanation: "来源对象不存在。", diagnostics: [] }
  const topologies = sources.map((source) => solidTopology3(source!, primitiveMap))
  if (topologies.some((topology) => !topology)) return { ok: false, explanation: "来源必须是实体（立方体 / 棱锥 / 圆柱 / 圆锥 / 多面体）：面与平面没有体积。", diagnostics: [] }
  const result = intersectConvexPolyhedra3(topologies[0]!, topologies[1]!)
  if (result.status === "insufficient-data") return { ok: false, explanation: result.explanation, diagnostics: result.diagnostics }
  return { ok: true, result }
}

function explainOutcome(outcome: Extract<SolidIntersectionOutcome, { ok: false }>): string {
  return [outcome.explanation, ...outcome.diagnostics].filter(Boolean).join(" ")
}

/**
 * 交面图元 = 布尔交集的**一个区域**（按支撑曲面分组后的一块）：平面区域或二次曲面区域。
 *
 * 用户口径："我需要的交面只是一个表面，而不是所有相交的表面"。分组之前，布尔交集把圆柱侧面切成 48 个
 * 细条（法向各不相同），"点一块建一块"点出来的永远是一个小片；分组之后一块区域就是**一个表面**，
 * 所以这里认领的是区域（与画布上那份预览同一个东西），把它的多边形 / 解析边界 / 面积如实写回。
 *
 * 认领方式与逐面时代同一套：按"离 `hint` 最近的区域形心"（`hint` 就是预览给出的区域形心），
 * 距离在容差内打平时才看区域法向与上一轮的取向。
 */
function recomputeIntersectionFace(
  primitive: Extract<PrimitiveSpec, { type: "intersectionFace" }>,
  primitiveMap: Map<string, PrimitiveSpec>
): Extract<PrimitiveSpec, { type: "intersectionFace" }> {
  /**
   * 解析字段是**派生**的：这一轮算不出解析边界就必须把它摘掉，
   * 否则会留下一份和现几何对不上的边界（来源移动后尤其明显）。
   * `outerRingLength` / `poleIndex` / `surface` 同理：它们描述的是当前 `points` 的填法
   *（前导外环多长、极点在哪个下标、铺完要不要吸到哪张曲面上），来源一动就可能对不上。
   */
  const withoutAnalytic = (face: Extract<PrimitiveSpec, { type: "intersectionFace" }>) => {
    const { exactLoops: _staleLoops, areaExact: _staleAreaExact, outerRingLength: _staleOuterRingLength, poleIndex: _stalePoleIndex, surface: _staleSurface, ...rest } = face
    return rest
  }
  const sources = primitive.sourceIds.map((id) => primitiveMap.get(id))
  const outcome = resolveSolidIntersection(sources, primitiveMap)
  const empty = { points: [], normal: { x: 0, y: 0, z: 0 }, area: 0 }
  if (!outcome.ok) return { ...withoutAnalytic(primitive), ...empty, status: "insufficient-data", visible: false, diagnostic: explainOutcome(outcome) }
  const { result } = outcome
  if (result.status === "none" || result.faces.length === 0) {
    return { ...withoutAnalytic(primitive), ...empty, status: "none", visible: false, diagnostic: result.explanation || "两个实体没有重叠区域。" }
  }

  // 来源各自的解析二次曲面（立方体 / 棱锥没有，函数返回 null）：分组靠它认"哪些面属于同一张曲面"。
  const regions = mergeIntersectionSurfaces3(result, sources.map((source) => ({ quadric: source ? quadric3FromPrimitive(source) ?? undefined : undefined })))
  const tolerance = Math.max(extentOf(result.vertices) * 1e-9, 1e-12)
  let bestRegion: { region: IntersectionSurfaceRegion; centroid: Vector3; distance: number; alignment: number } | null = null
  for (const region of regions) {
    if (region.points.length < 3) continue
    const centroid = centroidOfPoints(region.points)
    const distance = distanceBetween(centroid, primitive.hint)
    const alignment = dotBetween(region.normal, primitive.normal)
    // 主序是距离（"上一轮那一块还是同一块"），只有距离在容差内打平时才用法向取向打破平局。
    if (!bestRegion || distance < bestRegion.distance - tolerance || (Math.abs(distance - bestRegion.distance) <= tolerance && alignment > bestRegion.alignment)) {
      bestRegion = { region, centroid, distance, alignment }
    }
  }
  if (bestRegion) {
    const { region, centroid } = bestRegion
    return {
      ...withoutAnalytic(primitive),
      points: region.points,
      normal: region.normal,
      area: region.area,
      // 面积精度随区域如实标注（曲面区域是网格求和），解析边界有就写、没有就不写。
      areaExact: region.areaExact,
      ...(region.exactLoops ? { exactLoops: region.exactLoops } : {}),
      // 曲面区域的 `points` 缝了不止一圈时才有前导外环长度：渲染方靠它做环向条带三角化。
      ...(region.outerRingLength ? { outerRingLength: region.outerRingLength } : {}),
      // 圆锥侧面那类区域的极点（在曲面内部、不在边界环上）：渲染方靠它绕极点铺开填充。
      // `0` 是合法下标，所以判的是 `!== undefined`。
      ...(region.poleIndex !== undefined ? { poleIndex: region.poleIndex } : {}),
      // 这块区域所在的解析曲面：渲染方靠它把填充吸回真正的曲面上（画成光滑曲面而不是一圈平面三角形）。
      ...(region.surface ? { surface: region.surface } : {}),
      hint: { ...centroid },
      status: "valid",
      visible: true,
      diagnostic: undefined
    }
  }

  // 分组一个区域都没给（退化输入）而原始面片还在：退回逐面认领，而不是把这一面判成失败。
  let best: { points: Vector3[]; normal: Vector3; area: number; centroid: Vector3; distance: number; alignment: number } | null = null
  result.faces.forEach((face, index) => {
    const points = face.map((vertexIndex) => ({ ...result.vertices[vertexIndex] }))
    if (points.length < 3) return
    const centroid = centroidOfPoints(points)
    // 法向与面积由内核给出（与 `faces` 一一对应）：这里不再自己写一份 Newell 法向。
    const normal = result.faceNormals[index] ?? { x: 0, y: 0, z: 0 }
    const area = result.faceAreas[index] ?? 0
    const distance = distanceBetween(centroid, primitive.hint)
    const alignment = dotBetween(normal, primitive.normal)
    if (!best) { best = { points, normal, area, centroid, distance, alignment }; return }
    if (distance < best.distance - tolerance || (Math.abs(distance - best.distance) <= tolerance && alignment > best.alignment)) {
      best = { points, normal, area, centroid, distance, alignment }
    }
  })
  if (!best) return { ...withoutAnalytic(primitive), ...empty, status: "none", visible: false, diagnostic: "交集没有可用的面。" }
  const claimed = best as { points: Vector3[]; normal: Vector3; area: number; centroid: Vector3 }
  return { ...withoutAnalytic(primitive), points: claimed.points, normal: claimed.normal, area: claimed.area, hint: { ...claimed.centroid }, status: "valid", visible: true, diagnostic: undefined }
}

/**
 * 交点图元 = 交线的一个端点 / 拐点。
 *
 * 不用布尔交集的顶点：完全包含时两个表面并不相交、交集却有顶点——那不是"交点"。这里取的是
 * **公共边界线段的端点**（去重后），所以"有没有交点"与"有没有交线"永远一致；同样按 `hint` 最近认领。
 */
function recomputeIntersectionPoint3(
  primitive: Extract<PrimitiveSpec, { type: "intersectionPoint3" }>,
  primitiveMap: Map<string, PrimitiveSpec>
): Extract<PrimitiveSpec, { type: "intersectionPoint3" }> {
  const sources = primitive.sourceIds.map((id) => primitiveMap.get(id))
  if (sources.some((source) => !source)) {
    return { ...primitive, status: "insufficient-data", visible: false, diagnostic: "交点来源对象不存在。" }
  }
  const rings = sources.map((source) => intersectionFaceRings(source!, primitiveMap))
  if (rings.some((ring) => !ring)) {
    return { ...primitive, status: "insufficient-data", visible: false, diagnostic: "交点来源缺少可用的面环（平面没有边界，模板需要已物化的拓扑）。" }
  }
  const result = intersectFaceSets(rings[0]!, rings[1]!)
  if (result.classification === "insufficient-data") {
    return { ...primitive, status: "insufficient-data", visible: false, diagnostic: result.explanation }
  }
  const corners = dedupePoints3(result.segments.flatMap((segment) => [segment.a, segment.b]))
  if (corners.length === 0) {
    const detail = [result.explanation, ...result.diagnostics].filter(Boolean).join(" ")
    return { ...primitive, status: "none", visible: false, diagnostic: `没有交点：两个表面不相交。${detail}`.trim() }
  }
  let nearest = corners[0]
  let nearestDistance = distanceBetween(nearest, primitive.hint)
  for (const corner of corners.slice(1)) {
    const distance = distanceBetween(corner, primitive.hint)
    if (distance < nearestDistance) { nearest = corner; nearestDistance = distance }
  }
  return { ...primitive, position: { ...nearest }, hint: { ...nearest }, status: "valid", visible: true, diagnostic: undefined }
}

/** 去重（按模型尺度量化）：交线端点会被相邻线段各报一次。 */
function dedupePoints3(points: Vector3[]): Vector3[] {
  const quantum = Math.max(extentOf(points) * 1e-9, 1e-12)
  const seen = new Set<string>()
  const unique: Vector3[] = []
  for (const point of points) {
    const key = `${Math.round(point.x / quantum)},${Math.round(point.y / quantum)},${Math.round(point.z / quantum)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push({ ...point })
  }
  return unique
}

function centroidOfPoints(points: Vector3[]): Vector3 {
  const count = Math.max(points.length, 1)
  return points.reduce((sum, point) => ({ x: sum.x + point.x / count, y: sum.y + point.y / count, z: sum.z + point.z / count }), { x: 0, y: 0, z: 0 })
}

function extentOf(points: Vector3[]): number {
  let extent = 0
  for (const point of points) extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))
  return Math.max(extent, 1)
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}

function dotBetween(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

/** 平面的 Newell 法向与面积由内核随交集一起给出（`faceNormals` / `faceAreas`），这里不再复刻。 */

/** 实体的索引化拓扑（顶点数组 + 面环下标）；非实体或拓扑未物化时返回 null。 */
export function solidTopology3(source: PrimitiveSpec, primitiveMap: Map<string, PrimitiveSpec>): { vertices: Vector3[]; faces: number[][] } | null {
  const polyhedron = source.type === "polyhedron3" ? source : templateTopology(source.id, primitiveMap)
  if (!polyhedron) return null
  return polyhedronSectionTopology(polyhedron, primitiveMap)
}

/**
 * 文档的**派生立体读数**（Fix round 2 / I5）。
 *
 * `@draw/geometry-kernel` 的 `solveCircumsphere3` / `solveInsphere3` / `sectionSolid3` 返回
 * `DerivedSolidResult`（`exact` / `undefined` / `degenerate` / `approximate`），但那个区分
 * 只有真的被**生产路径**读出来才有意义 —— 否则"精确 / 不存在 / 退化"就只是内核里的一句空话。
 * 这个函数就是那个消费者：对已提交的文档逐只实体算出派生状态，供预览与诊断使用。
 *
 * 拓扑一律经 `solidTopology3`（本文件既有的那条路径）读取，**不另建一份**；
 * 求解本身也一律调用内核那三个函数，所以报告与内核永远同源。
 */
export interface SolidDerivedStatus {
  /**
   * 这条读数**归在哪只实体上**：球体读数是那只 `polyhedron3` 自己的 id，
   * 截面读数是该截面的 `sourceId`（用户当初选中的那个实体：棱柱是它自己的多面体 id，
   * 模板实体是 `cube-1` 这样的参数源 id）。
   */
  solidId: string
  /** `derived.circumsphere` / `derived.insphere` / `derived.section`。 */
  code: string
  status: DerivedSolidResult<unknown>["status"]
  /** 给人看的一句话：为什么是这个状态（`exact` 时给出结论，其余带上原因）。 */
  message: string
  /**
   * **这条读数由哪个图元算出来**（只有 `derived.section` 有：那一刀的 `section` 图元 id）。
   *
   * 没有它，同一只实体上的两条截面产出两条一模一样的记录：界面分不清行、React key 会撞，
   * 模型也读不出"这是哪条截面的分类"。球体读数没有"哪条截面"可言，因此缺省。
   */
  sourceId?: string
}

function sphereStatusMessage(label: string, result: DerivedSolidResult<Sphere3>): string {
  if (result.status === "exact") return `${label}：半径 ${result.value.radius.toPrecision(4)}，圆心 (${result.value.center.x.toPrecision(4)}, ${result.value.center.y.toPrecision(4)}, ${result.value.center.z.toPrecision(4)})。`
  if (result.status === "approximate") return `${label}（数值近似，残差 ${result.residual.toPrecision(3)}）：半径 ${result.value.radius.toPrecision(4)}。`
  return `${label}：${result.reason}`
}

/**
 * **这份报告要算哪些实体**（外部审查 G1）。
 *
 * 不传 = 整篇文档（观察层要的正是全量：模型看到的必须是完整读数）。
 * 传了 = 只算这几只 —— 界面在**选中某个对象**时只需要它自己那几条读数，
 * 而对整篇文档求一遍是白花的（内切球那条还是迭代求解）。
 * `PropertiesBar` 的注释一直声称"按选中对象过滤"，但它原先是在**算完整篇之后**再过滤 ——
 * 那样过滤不省任何计算，只会让人以为省了。
 */
export interface SolidDerivedScope {
  /** 只算这些 `polyhedron3` 的球体读数。 */
  solidIds?: readonly string[]
  /** 只算这些 `section` 图元的截面读数（按截面**自己**的 id，不是来源实体）。 */
  sectionIds?: readonly string[]
}

export function solidStatusReport(document: GeometryDocument, scope?: SolidDerivedScope): SolidDerivedStatus[] {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const report: SolidDerivedStatus[] = []
  const solidFilter = scope?.solidIds === undefined ? null : new Set(scope.solidIds)
  const sectionFilter = scope?.sectionIds === undefined ? null : new Set(scope.sectionIds)

  for (const primitive of document.primitives) {
    if (primitive.type !== "polyhedron3") continue
    if (solidFilter && !solidFilter.has(primitive.id)) continue
    // 拓扑读不全（缺顶点 / 缺面环）时**什么都不报**：那不是"退化"，而是"这只实体还没长齐"。
    const topology = solidTopology3(primitive, primitiveMap)
    if (!topology) continue
    const boundary: SolidBoundary = { vertices: topology.vertices, faces: topology.faces }
    const circumsphere = solveCircumsphere3(boundary)
    const insphere = solveInsphere3(boundary)
    report.push({ solidId: primitive.id, code: "derived.circumsphere", status: circumsphere.status, message: sphereStatusMessage("外接球", circumsphere) })
    report.push({ solidId: primitive.id, code: "derived.insphere", status: insphere.status, message: sphereStatusMessage("内切球", insphere) })
  }

  for (const primitive of document.primitives) {
    if (primitive.type !== "section") continue
    if (sectionFilter && !sectionFilter.has(primitive.id)) continue
    const source = primitiveMap.get(primitive.sourceId)
    if (!source) continue
    const topology = solidTopology3(source, primitiveMap)
    if (!topology) continue
    const result = sectionSolid3({ vertices: topology.vertices, faces: topology.faces }, primitive.plane)
    // 三个分支都要写出来（判别联合必须穷尽）：`sectionSolid3` 目前只产出 exact，
    // 但契约允许 `approximate`（带残差的数值边界），这里如实渲染它，将来才不会静默漏一种状态。
    const message = result.status === "exact"
      ? `截面分类 ${result.value.classification}（${result.value.points.length} 个顶点）。`
      : result.status === "approximate"
        ? `截面（数值近似，残差 ${result.residual.toPrecision(3)}）：${result.value.classification}。`
        : `截面：${result.reason}`
    // `sourceId` 是**这一刀是哪条截面**（Fix round 1 / M1）：只写 `solidId` 的话，
    // 同一只实体上的两条截面会产出两条一模一样的记录 —— 界面分不清行、React key 还会撞，
    // 模型也读不出"是哪条截面的分类"。
    report.push({ solidId: primitive.sourceId, sourceId: primitive.id, code: "derived.section", status: result.status, message })
  }

  return report
}

/**
 * 拖拽一个被约束的点：把"当前位置 + 增量"投影回曲线，写回参数。
 *
 * 自由点是直接加 x/y 的，但约束点不能这么做 —— 下一个重算会立刻用旧参数把坐标覆盖回去，
 * 拖动等于没发生。参数写两处：
 *   - `binding.parameter`：点自己的参数；
 *   - 若绑定了文档参数，同时写它的值，因为 `resolveBoundPoint` 在有 `parameterId` 时只看那个参数。
 */
function dragBoundPoint(point: Extract<PrimitiveSpec, { type: "point" }>, delta: Coordinate, primitiveMap: Map<string, PrimitiveSpec>, parameters: GeometryDocument["parameters"]): { point: Extract<PrimitiveSpec, { type: "point" }>; parameterValue: { id: string; value: number } | null } | null {
  if (point.binding?.kind !== "onPath") return null
  const path = primitiveMap.get(point.binding.pathId)
  if (!path) return null
  const projected = projectOntoPath(path, { x: point.x + delta.x, y: point.y + delta.y }, parameters, point.binding.branch)
  if (projected === null) return null
  const binding: PointBinding = { ...point.binding, parameter: projected }
  return {
    point: { ...point, binding },
    parameterValue: binding.parameterId ? { id: binding.parameterId, value: projected } : null
  }
}

function resolveBoundPoint(binding: PointBinding, primitives: Map<string, PrimitiveSpec>, parameters: GeometryDocument["parameters"]): Coordinate | null {
  if (binding.kind !== "onPath") return null
  const path = primitives.get(binding.pathId)
  if (!path) return null
  const parameter = binding.parameterId ? parameters[binding.parameterId]?.value : binding.parameter
  if (parameter === undefined || !Number.isFinite(parameter)) return null
  return pathConstraint(path, parameters)?.evaluate(parameter, binding.branch ?? 0) ?? null
}

function point3Position(primitive: PrimitiveSpec | undefined, points: Map<string, Point3Primitive>): Vector3 | null {
  if (!primitive) return null
  if (primitive.type === "point3") return primitive.position
  if (primitive.type === "segment3" || primitive.type === "edge3") {
    const first = points.get(primitive.pointIds[0])
    return first?.position ?? null
  }
  if (primitive.type === "ray3") return points.get(primitive.originId)?.position ?? null
  return null
}

function resolveLine3Endpoints(primitive: Extract<PrimitiveSpec, { type: "line3" }>, points: Map<string, Point3Primitive>): { first: Vector3; second: Vector3 } | null {
  if (primitive.definition.kind === "throughPoints") {
    const first = points.get(primitive.definition.pointIds[0])
    const second = points.get(primitive.definition.pointIds[1])
    return first && second ? { first: first.position, second: second.position } : null
  }
  const point = points.get(primitive.definition.pointId)
  if (!point) return null
  return { first: point.position, second: { x: point.position.x + primitive.definition.direction.x, y: point.position.y + primitive.definition.direction.y, z: point.position.z + primitive.definition.direction.z } }
}

/**
 * 宿主参数的域语义只有一份：内核的 `normalizeHostParameter`（闭合宿主折回、有界宿主夹回、
 * 无界宿主原样）。这里曾经有一份"一律夹取"的本地实现，对空间圆轨道会把 `π/2 + 4π` 夹到 `2π`，
 * 于是同一个文档在文档层与 Reactive DAG 上给出**两个不同的点**（fix round 1 / I5）。
 */

/** 实体内约束的宿主：由实体的**物化拓扑**（顶点 + 面环）构造，解析不出来时返回 null。 */
export function solidVolumeHostFor(primitives: Map<string, PrimitiveSpec>, solidId: string): Host3 | null {
  const source = primitives.get(solidId)
  if (!source) return null
  const topology = solidTopology3(source, primitives)
  return topology ? solidVolumeHost3(topology.vertices, topology.faces) : null
}

/**
 * 3D 宿主绑定的参数真值（设计规格 §4.1）：给了 `parameterId(s)` 就**只看文档参数**，
 * 绑定里那个字面量退化成缓存。参数不存在或非有限时返回 `null`（调用方保留上一次的坐标，
 * 不静默把点挪到别处），而不是拿缓存顶替。
 */
function bindingParameterValue(parameters: GeometryDocument["parameters"], literal: number, parameterId?: string): number | null {
  if (parameterId === undefined) return Number.isFinite(literal) ? literal : null
  const resolved = parameters[parameterId]?.value
  return resolved !== undefined && Number.isFinite(resolved) ? resolved : null
}

function bindingTupleValue(parameters: GeometryDocument["parameters"], literal: readonly number[], parameterIds?: readonly string[]): number[] | null {
  if (parameterIds !== undefined) {
    if (parameterIds.length !== literal.length) return null
    const resolved = parameterIds.map((id) => parameters[id]?.value)
    return resolved.every((value) => value !== undefined && Number.isFinite(value)) ? resolved as number[] : null
  }
  return literal.every(Number.isFinite) ? [...literal] : null
}

function resolveBoundPoint3(primitive: Extract<PrimitiveSpec, { type: "point3" }>, primitives: Map<string, PrimitiveSpec>, parameters: GeometryDocument["parameters"]): Vector3 | null {
  const binding = primitive.binding
  if (!binding || binding.kind === "free") return null
  const points = new Map([...primitives.values()].filter((candidate): candidate is Point3Primitive => candidate.type === "point3").map((point) => [point.id, point]))
  if (binding.kind === "onLine") {
    const line = primitives.get(binding.lineId)
    if (!line || line.type !== "line3") return null
    const endpoints = resolveLine3Endpoints(line, points)
    if (!endpoints || !Number.isFinite(binding.parameter)) return null
    return { x: endpoints.first.x + (endpoints.second.x - endpoints.first.x) * binding.parameter, y: endpoints.first.y + (endpoints.second.y - endpoints.first.y) * binding.parameter, z: endpoints.first.z + (endpoints.second.z - endpoints.first.z) * binding.parameter }
  }
  if (binding.kind === "onPlane") {
    const plane = primitives.get(binding.planeId)
    if (!plane || plane.type !== "plane3") return null
    return { x: binding.frame.origin.x + binding.coordinates[0] * binding.frame.u.x + binding.coordinates[1] * binding.frame.v.x, y: binding.frame.origin.y + binding.coordinates[0] * binding.frame.u.y + binding.coordinates[1] * binding.frame.v.y, z: binding.frame.origin.z + binding.coordinates[0] * binding.frame.u.z + binding.coordinates[1] * binding.frame.v.z }
  }
  /**
   * 宿主绑定：坐标完全由参数算出（参数是唯一真值）。
   * 宿主解析不了时返回 null，调用方会保留点上一次的坐标——不静默把点挪到别处。
   */
  if (binding.kind === "onHost" || binding.kind === "onFace" || binding.kind === "onSurface" || binding.kind === "inSolid") {
    const solidHost = binding.kind === "inSolid" ? solidVolumeHostFor(primitives, binding.solidId) : null
    if (binding.kind === "inSolid") {
      // 实体内：参数是三个 [0,1] 比例；越界会被夹回实体表面（`solidVolumeHost3` 负责）。
      const uvw = bindingTupleValue(parameters, binding.uvw, binding.parameterIds)
      if (!solidHost || !uvw) return null
      return solidHost.evaluate({ u: uvw[0], v: uvw[1], w: uvw[2] })
    }
    const sourceId = binding.kind === "onHost" ? binding.hostId : binding.kind === "onFace" ? binding.faceId : binding.solidId
    const source = primitives.get(sourceId)
    const host = source ? host3FromPrimitive(source, primitives) : null
    if (!host) return null
    if (binding.kind === "onHost") {
      const parameter = bindingParameterValue(parameters, binding.parameter, binding.parameterId)
      if (parameter === null) return null
      return host.evaluate({ u: normalizeHostParameter(host, "u", parameter) })
    }
    const uv = bindingTupleValue(parameters, binding.uv, binding.parameterIds)
    if (!uv) return null
    return host.evaluate({ u: normalizeHostParameter(host, "u", uv[0]), v: normalizeHostParameter(host, "v", uv[1]) })
  }
  if (binding.feature === "midpoint" && binding.sourceIds.length >= 2) {
    const first = point3Position(primitives.get(binding.sourceIds[0]), points)
    const second = point3Position(primitives.get(binding.sourceIds[1]), points)
    if (first && second) return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 }
  }
  return null
}

/**
 * 把一个截面物化成**独立图元**：每一环生成 point3 + edge3 + face3。
 *
 * 刻意不写 `sourceId`——物化出来的几何与来源解耦：删掉宿主不影响它们，
 * 它们也能被移动、求交、测量（这正是"可以获取截面图元"的含义）。
 * 返回的数组顺序是"点 → 棱 → 面"，调用方用一条 `addPrimitives` 提交即可。
 */
export function sectionMaterialization(document: GeometryDocument, sectionId: string): PrimitiveSpec[] | null {
  const section = document.primitives.find((primitive) => primitive.id === sectionId)
  if (section?.type !== "section") return null
  const loops = (section.loops && section.loops.length > 0 ? section.loops : [section.points]).filter((loop) => loop.length >= 3)
  if (loops.length === 0) return null
  const label = section.label ?? section.id
  const stroke = section.style?.stroke ?? "#f97316"
  const primitives: PrimitiveSpec[] = []
  loops.forEach((loop, loopIndex) => {
    const suffix = loops.length > 1 ? ` ${loopIndex + 1}` : ""
    const pointIds = loop.map((point, pointIndex) => {
      const id = `${section.id}-p${loopIndex + 1}-${pointIndex + 1}`
      primitives.push({ id, type: "point3", position: { ...point }, binding: { kind: "free" }, label: `${label} 顶点${suffix}-${pointIndex + 1}`, style: { stroke, fill: stroke } })
      return id
    })
    const edgeIds = loop.map((_, pointIndex) => {
      const id = `${section.id}-e${loopIndex + 1}-${pointIndex + 1}`
      primitives.push({ id, type: "edge3", pointIds: [pointIds[pointIndex], pointIds[(pointIndex + 1) % loop.length]], label: `${label} 棱${suffix}-${pointIndex + 1}`, style: { stroke } })
      return id
    })
    primitives.push({ id: `${section.id}-f${loopIndex + 1}`, type: "face3", pointIds, edgeIds, label: `${label} 面${suffix}`, style: { stroke, fill: `${stroke}33` } })
  })
  return primitives
}

/**
 * 把模板实体生成的顶点位置同步回模板参数。
 *
 * `dirty` 给定时**只处理参数真的进了脏集的模板**：旧实现每次重算都无条件重跑
 * `buildSolidTemplate` 并覆盖全部生成顶点——既让每次操作都付 O(模板面数) 的开销，
 * 也会把任何绕过 `updatePrimitive` 的顶点位移静默抹掉。
 */
function syncTemplateTopology(primitives: PrimitiveSpec[], dirty?: Set<string>): void {
  const primitiveMap = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  for (const polyhedron of primitives) {
    if (polyhedron.type !== "polyhedron3" || polyhedron.construction?.kind !== "template") continue
    if (dirty && !polyhedron.construction.sourceIds.some((id) => dirty.has(id))) continue
    const source = polyhedron.construction.sourceIds.map((id) => primitiveMap.get(id)).find((candidate): candidate is TemplateSolidPrimitive => Boolean(candidate && ["cube", "pyramid", "cylinder", "cone"].includes(candidate.type)))
    if (!source || source.type !== polyhedron.construction.templateId) continue
    const result = buildSolidTemplate(source, createBuilderContext(source.id))
    const generatedPoints = new Map(result.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point3" }> => primitive.type === "point3").map((primitive) => [primitive.id, primitive.position]))
    for (let index = 0; index < primitives.length; index += 1) {
      const primitive = primitives[index]
      if (primitive.type !== "point3") continue
      const position = generatedPoints.get(primitive.id)
      if (position) primitives[index] = { ...primitive, position: { ...position } }
    }
  }
}

function resolveIntersection(primitive: Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" }>, lines: Map<string, Extract<PrimitiveSpec, { type: "line" }>>, circleOf: (id: string) => Extract<PrimitiveSpec, { type: "circle" }> | undefined): IntersectionResult {
  if (primitive.type === "intersection") {
    const first = lines.get(primitive.lineA)
    const second = lines.get(primitive.lineB)
    return first && second ? intersectLinesDetailed(first, second) : { kind: "degenerate", reason: "intersection references missing line" }
  }
  if (primitive.type === "lineCircleIntersection") {
    const line = lines.get(primitive.lineId)
    const circle = circleOf(primitive.circleId)
    return line && circle ? intersectLineCircleDetailed(line, circle) : { kind: "degenerate", reason: "line-circle intersection references missing object" }
  }
  const first = circleOf(primitive.circleA)
  const second = circleOf(primitive.circleB)
  return first && second ? intersectCirclesDetailed(first, second) : { kind: "degenerate", reason: "circle intersection references missing circle" }
}

export function recomputeDerivedObjects(document: GeometryDocument, changedIds?: string[]): GeometryDocument {
  const parameters = evaluateParameterExpressions(document.parameters)
  const evaluatedDocument = {
    ...document,
    parameters,
    primitives: document.primitives.map((primitive) => primitive.type === "line" ? evaluateLineParameters({ ...document, parameters }, primitive) : primitive)
  }
  /**
   * 把"绕定点旋转"落进曲线自己的几何，**在取快照之前**做一次。
   *
   * 这样做的好处是：后面所有消费者（路径约束、采样、包围盒、平移）读到的都是放置后的曲线，
   * 于是它们一行都不用改 —— "圆过定点"对它们就是一个普通的圆。
   * `evaluatedDocument` 是本次重算的工作副本（`...document` 的新对象），改它不会碰到调用方那份。
   */
  const placementOf = placementResolver(evaluatedDocument.primitives)
  for (let index = 0; index < evaluatedDocument.primitives.length; index += 1) {
    const primitive = evaluatedDocument.primitives[index]
    if (!isPlaceableConic(primitive)) continue
    evaluatedDocument.primitives[index] = placedConic(primitive as PlaceableConic, placementOf(primitive))
  }
  const affected = changedIds === undefined
    ? new Set(document.primitives.map((primitive) => primitive.id))
    : getAffectedPrimitiveIds(document, changedIds)
  /**
   * 定点是**点图元**时，定点动了 = 曲线动了。
   *
   * 这条边不能只写在依赖图里：`recomputeDerivedObjects(document, ["pivot-1"])` 的脏集来自
   * `getAffectedPrimitiveIds`，曲线不在里面就不会被重建一次，放置也就永远不会刷新。
   */
  if (changedIds !== undefined) {
    const changed = new Set(changedIds)
    for (const primitive of document.primitives) {
      const pivotId = curveRotationPivotId(primitive)
      if (pivotId && changed.has(pivotId)) affected.add(primitive.id)
    }
  }
  const projectedPrimitives = [...evaluatedDocument.primitives]
  const projectedLines = new Map(
    projectedPrimitives
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "line" }> => primitive.type === "line")
      .map((line) => [line.id, line])
  )
  const activeLineIds = changedIds === undefined
    ? undefined
    : new Set([...affected].filter((id) => projectedLines.has(id)))
  const activeConstraintIds = changedIds === undefined
    ? undefined
    : new Set(evaluatedDocument.constraints
      .filter((constraint) => constraint.targets.length === 2 && constraint.targets.every((target) => affected.has(target)))
      .map((constraint) => constraint.id))
  const solved = solveLineConstraints(projectedLines, evaluatedDocument.constraints, undefined, undefined, changedIds === undefined ? undefined : activeLineIds, activeConstraintIds)
  // 退化直线（两端点重合）上的平行 / 垂直 / 共线无法求解，`unsatisfiable` 会列出这些约束：
  // 求解失败时把原因说清楚，而不是笼统地报"未收敛"。
  if (!solved.converged) throw new Error(solved.unsatisfiable.length > 0
    ? `constraint solving failed: target line is degenerate (${solved.unsatisfiable.join(", ")})`
    : "constraint solving failed to converge")
  const lines = solved.lines
  const primitiveIndexById = new Map(projectedPrimitives.map((primitive, index) => [primitive.id, index]))
  for (const [id, projected] of lines) {
    const primitiveIndex = primitiveIndexById.get(id)
    if (primitiveIndex !== undefined) projectedPrimitives[primitiveIndex] = projected
  }
  // 受约束的 point3 不再需要"最多重跑 N 遍直到不动"的多趟循环：
  // 主重算按拓扑序走，且每算完一个对象就更新查找表，一趟即可收敛。
  syncTemplateTopology(projectedPrimitives, changedIds === undefined ? undefined : new Set(changedIds))
  const primitiveMap = new Map(projectedPrimitives.map((primitive) => [primitive.id, primitive]))
  /**
   * 圆的查找是**活引用**而不是快照。
   *
   * 圆心 / 半径现在可以由点图元驱动（见 `recomputePrimitive` 里的圆分支），于是圆会在主循环**当中**被改写。
   * 快照地图会让"直线与这个圆的交点"读到改写之前的旧圆 —— 用户看到的就是交点慢一帧、甚至粘在旧位置上。
   * 判据是拓扑序里圆一定排在它的驱动点之后，因此这里读到的永远是刚算出来的那一份。
   */
  const circleOf = (id: string): Extract<PrimitiveSpec, { type: "circle" }> | undefined => {
    const candidate = primitiveMap.get(id)
    return candidate?.type === "circle" ? candidate : undefined
  }
  /**
   * 重算单个对象。返回 `undefined` 表示这个类型不参与本趟重算。
   *
   * 抽成函数是为了让主循环按**拓扑序**遍历，并在每算完一个对象后立刻更新 `primitiveMap` ——
   * 这样下游读到的是刚刚算出来的上游值，而不是本趟开始前的那份快照。
   */
  /**
 * 从多解里挑一个：
 * - 有 `hint` 时取**离 hint 最近的解**——解的数量或顺序随形状变化时不会串位（吸引域语义，与 SolveSpace 一致）；
 * - 没有 hint 时退回下标；下标越界取最后一个，而不是静默回到第 0 个。
 * 调用方会把选中的解写回 `hint`，于是下一次重算继续跟着它。
 */
function pickSolution<T extends { x: number; y: number }>(points: T[], solutionIndex: number | undefined, hint: { x: number; y: number } | undefined): T | null {
  if (points.length === 0) return null
  if (hint) {
    let best = points[0]
    let bestDistance = Math.hypot(best.x - hint.x, best.y - hint.y)
    for (const candidate of points.slice(1)) {
      const distance = Math.hypot(candidate.x - hint.x, candidate.y - hint.y)
      if (distance < bestDistance) {
        best = candidate
        bestDistance = distance
      }
    }
    return best
  }
  const index = Number.isInteger(solutionIndex) && (solutionIndex ?? 0) >= 0 ? (solutionIndex as number) : 0
  return points[Math.min(index, points.length - 1)]
}

const recomputePrimitive = (primitive: PrimitiveSpec): PrimitiveSpec | undefined => {
    if (primitive.type === "point3" && primitive.binding) {
      const position = resolveBoundPoint3(primitive, primitiveMap, parameters)
      return position ? { ...primitive, position } : undefined
    }
    if (primitive.type === "point" && primitive.binding) {
      const point = resolveBoundPoint(primitive.binding, primitiveMap, parameters)
      return point ? { ...primitive, x: point.x, y: point.y } : undefined
    }
    /**
     * **由三角形派生的圆**（内切圆 / 外接圆，设计规格 §4.3）。
     *
     * 圆心与半径都从那个三角形算出来：`inradius` → 内心 + 内切半径，`circumradius` → 外心 + 外接半径。
     * 几何来自内核的 `triangleCenter2` / `triangleRadius2`，与 Reactive DAG 的三角形中心节点**同一份**。
     *
     * 顶点缺失或三点共线时**保留上一次的几何**：文档层不伪造坐标（与"宿主解析不了就保持不动"
     * 是既有约定），退化 / 缺失来源的结构化诊断由 Reactive DAG 那一层报。
     */
    if (primitive.type === "circle" && primitive.radiusFrom?.kind === "triangle") {
      const rule = primitive.radiusFrom
      const vertices = rule.triangleIds.map((id) => primitiveMap.get(id))
      const points = vertices.map((vertex) => vertex?.type === "point" ? { x: vertex.x, y: vertex.y } : null)
      if (points.every((point) => point !== null)) {
        const [first, second, third] = points as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }]
        const center = triangleCenter2(rule.metric === "inradius" ? "incenter" : "circumcenter", first, second, third)
        const radius = triangleRadius2(rule.metric, first, second, third)
        if (center.status === "exact" && radius.status === "exact") {
          const bounded = Math.max(MIN_DYNAMIC_CIRCLE_RADIUS, radius.value)
          if (center.value.x === primitive.center.x && center.value.y === primitive.center.y && bounded === primitive.radius) return primitive
          return { ...primitive, center: center.value, radius: bounded }
        }
      }
      return primitive
    }
    /**
     * 以点图元为圆心 / 半径随点图元变化的圆。
     *
     * 用户口径："第二动点能够作为圆心作圆，圆的半径能够调节，也能够根据动点位置进行动态变化。"
     * `center` 与 `radius` 在这里是**派生缓存**，真值是那两个点图元（`centerPointId` / `radiusFrom`）。
     *
     * 写在主循环里、而不是像"绕定点旋转"那样放在预扫描里，是因为它必须读到**刚算出来的**点坐标：
     * 预扫描读的是本趟开始前的快照，拖动时会慢一帧，用户看到圆心追着点跑。
     * 依赖图里已经声明了"点 → 圆"这条边，所以拓扑序保证点一定排在圆前面。
     */
    if (primitive.type === "circle" && (primitive.centerPointId || primitive.radiusFrom)) {
      const centerPoint = primitive.centerPointId ? primitiveMap.get(primitive.centerPointId) : undefined
      const center = centerPoint?.type === "point" ? { x: centerPoint.x, y: centerPoint.y } : primitive.center
      // 三角形规则在上面已经返回；这里只剩"半径 = 驱动点距离 × 倍率"这一支。
      const distanceRule = primitive.radiusFrom?.kind === "triangle" ? undefined : primitive.radiusFrom
      const driver = distanceRule ? primitiveMap.get(distanceRule.pointId) : undefined
      // 驱动点与圆心重合时半径会变成 0（圆消失），但 schema 要求 radius > 0：
      // 给一个不可见的下限，宁可画出一个极小的圆，也不要让文档存不下去。
      const radius = driver?.type === "point" && distanceRule
        ? Math.max(MIN_DYNAMIC_CIRCLE_RADIUS, Math.hypot(driver.x - center.x, driver.y - center.y) * distanceRule.factor)
        : primitive.radius
      if (center.x === primitive.center.x && center.y === primitive.center.y && radius === primitive.radius) return primitive
      return { ...primitive, center, radius }
    }
    if (primitive.type === "derivative") {
      const source = primitiveMap.get(primitive.sourceId)
      if (source?.type !== "function") return { ...primitive, points: [], status: "failed" as const, diagnostic: "derivative source function is missing" }
      return recomputeDerivative(primitive, source, parameters)
    }
    if (primitive.type === "tangent" || primitive.type === "normal" || primitive.type === "secant") {
      const source = primitiveMap.get(primitive.sourceId)
      /**
       * **有 `anchor` 就走曲线路径，与来源是不是函数无关。**
       *
       * 这一点很容易写错：函数图像也是动点可以绑定的轨道（`dynamicPointPaths` 里就有它），
       * 所以"在动点处作切线"完全可能落在一个函数图像上。如果按"来源是函数"优先分派，
       * 那条切线会被当成旧的横坐标定位切线，`anchor` 被静默忽略 ——
       * 表现就是"切出来了，但拖不动点，切线不动"。
       *
       * 判据必须写成 `type !== "secant"`（先按判别式收窄）而不是 `type === "tangent" || ...`：
       * `SecantPrimitive` 没有 `anchor` 这个字段，直接读它连类型都过不了。
       */
      if (source && primitive.type !== "secant" && primitive.anchor) return recomputeCurveTangent(primitive, source, primitiveMap, parameters)
      if (source?.type === "function") {
        return primitive.type === "secant" ? recomputeSecant(primitive, source, parameters) : recomputeTangent(primitive, source, parameters)
      }
      // 曲线来源（圆 / 圆弧 / 抛物线 / 椭圆 / 双曲线）没有 `anchor` 时无从确定切点，只能如实报错。
      return { ...primitive, status: "failed" as const, diagnostic: "derived line source curve is missing" }
    }
    if (primitive.type === "integral" || primitive.type === "analysisSet") {
      const source = primitiveMap.get(primitive.sourceId)
      if (source?.type !== "function") return { ...primitive, status: "failed" as const, diagnostic: "analysis source function is missing" }
      return primitive.type === "integral" ? recomputeIntegral(primitive, source, parameters) : recomputeAnalysisSet(primitive, source, parameters)
    }
    if (primitive.type === "section") {
      const source = primitiveMap.get(primitive.sourceId)
      if (!source) return { ...primitive, points: [], classification: "insufficient-data" as const, status: "failed" as const, visible: false, diagnostic: "截面来源实体不存在。" }
      return recomputeSection(primitive, source, primitiveMap)
    }
    if (primitive.type === "intersectionLine") return recomputeIntersectionLine(primitive, primitiveMap)
    if (primitive.type === "intersectionSolid") return recomputeIntersectionSolid(primitive, primitiveMap)
    if (primitive.type === "intersectionFace") return recomputeIntersectionFace(primitive, primitiveMap)
    if (primitive.type === "intersectionPoint3") return recomputeIntersectionPoint3(primitive, primitiveMap)
    if (primitive.type === "line") return lines.get(primitive.id)
    if (primitive.type === "intersectionSet") {
      const first = sampledSource(primitive.objectA, primitiveMap)
      const second = sampledSource(primitive.objectB, primitiveMap)
      if (!first || !second) throw new Error("intersection set references unsupported objects")
      const result = intersectSampledPrimitives(first, second)
      if (result.kind === "degenerate") throw new Error(`degenerate intersection set: ${result.reason}`)
      if (result.kind === "none" || result.kind === "coincident") return { ...primitive, points: [], visible: false }
      if (result.kind === "point" || result.kind === "tangent") return { ...primitive, points: [result.point], visible: true }
      return { ...primitive, points: result.points, visible: true }
    }
    if (primitive.type === "curveIntersection") {
      const first = sampledSource(primitive.objectA, primitiveMap)
      const second = sampledSource(primitive.objectB, primitiveMap)
      if (!first || !second) throw new Error("curve intersection references unsupported objects")
      const result = intersectSampledPrimitives(first, second)
      if (result.kind === "degenerate") throw new Error(`degenerate curve intersection: ${result.reason}`)
      if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
      if (result.kind === "point" || result.kind === "tangent") return { ...primitive, x: result.point.x, y: result.point.y, visible: true }
      const point = pickSolution(result.points, primitive.solutionIndex, primitive.hint)
      return point ? { ...primitive, x: point.x, y: point.y, hint: { x: point.x, y: point.y }, visible: true } : { ...primitive, visible: false }
    }
    if (primitive.type !== "intersection" && primitive.type !== "lineCircleIntersection" && primitive.type !== "circleIntersection") return undefined
    const result = resolveIntersection(primitive, lines, circleOf)
    if (result.kind === "degenerate") throw new Error(`degenerate intersection: ${result.reason}`)
    if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
    if (result.kind === "point" || result.kind === "tangent") return { ...primitive, x: result.point.x, y: result.point.y, visible: true }
    const point = primitive.type === "intersection" ? result.points[0] : pickSolution(result.points, primitive.solutionIndex, primitive.hint)
    if (!point) return { ...primitive, visible: false }
    return primitive.type === "intersection"
      ? { ...primitive, x: point.x, y: point.y, visible: true }
      : { ...primitive, x: point.x, y: point.y, hint: { x: point.x, y: point.y }, visible: true }
  }
  const primitives = [...projectedPrimitives]
  for (const id of topologicalRecomputeOrder(evaluatedDocument, changedIds)) {
    const index = primitiveIndexById.get(id)
    if (index === undefined) continue
    const recomputed = recomputePrimitive(primitives[index])
    if (recomputed === undefined || recomputed === primitives[index]) continue
    primitives[index] = recomputed
    // 关键：下游对象必须看到刚算出来的上游值，而不是本趟开始前的快照。
    primitiveMap.set(id, recomputed)
  }
  // 测量只在它的来源对象真的进了脏集时才重算 —— 这是依赖图剪枝在测量上的体现。
  // 来源都没变时保留上一次的读数（值本身就存在文档里），所以"拖一个和它无关的点"不会触发它。
  const measurements = evaluatedDocument.measurements.map((measurement) => {
    if (changedIds !== undefined && !measurement.sourceIds.some((id) => affected.has(id))) return measurement
    return evaluatedDocument.workspace === "geometry3d"
      ? calculateMeasurement3(measurement, primitives)
      : calculatePlanarMeasurement(measurement, primitives)
  })
  return { ...evaluatedDocument, primitives, measurements }
}

/**
 * 平面（2D）测量。
 *
 * 复用 `Measurement3` 这个既有容器，而不是新增一套 DSL 类型：`Measurement3Metric` 已经包含
 * length / distance / angle / area，状态枚举也与内核的 `MeasurementStatus` 逐字一致，
 * 因此归档格式、对象列表、检查器和导出器都不需要改动。求值则交给内核的 `evaluatePlanarMeasurement`，
 * 由它负责退化判定（重合点、零向量、三点共线）与 atan2 角度。
 *
 * 两处映射：
 * - `dihedralKind`（interior / exterior）同时承载平面角的取角方式，沿用已有的按钮签名；
 * - 平面量的值都是数值计算的，所以 `precision` 固定为 `numeric-approximation`。
 */
function calculatePlanarMeasurement(measurement: Measurement3, primitives: PrimitiveSpec[]): Measurement3 {
  /**
   * 来源解析成**实体**（点 / 线 / 圆），不再只喂点表：平面测量要能算"切线与直线的夹角""动圆的面积"。
   * `connection` 只存两个点 id，先补成一条真实线段再交给内核。
   */
  const primitiveMap = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  const resolve = entityResolverFor(
    primitives.map((primitive) => {
      if (primitive.type !== "connection") return primitive
      const start = primitiveMap.get(primitive.startPointId)
      const end = primitiveMap.get(primitive.endPointId)
      if (start?.type !== "point" || end?.type !== "point") return primitive
      return { id: primitive.id, type: "segment" as const, a: { x: start.x, y: start.y }, b: { x: end.x, y: end.y } }
    })
  )
  const reading = evaluatePlanarMeasurement({
    id: measurement.id,
    metric: measurement.metric as PlanarMetric,
    sourceIds: measurement.sourceIds,
    angleKind: measurement.dihedralKind === "exterior" ? "exterior" : "interior"
  }, resolve)
  return {
    ...measurement,
    value: reading.value ?? undefined,
    unit: reading.unit,
    status: reading.status,
    precision: "numeric-approximation",
    explanation: reading.explanation
  }
}

/**
 * 参数是否仍被某个图元引用。两个用途：回收自动生成的驱动参数时确认它真的成了孤儿，
 * 以及拒绝删除仍被绑定的参数。调用前应先完成图元的增删，这样判断的是**当前**状态。
 *
 * 3D 宿主绑定的驱动参数（`point3.binding.parameterId` / `onFace|onSurface|inSolid.parameterIds`）
 * 必须一起算进来：`schema` 把它们做成了硬校验（悬空即非法），`encodeMgeo` 对非法文档直接抛，
 * 所以漏掉它们意味着"一次普通删除就能造出一份存不下去的文档"，而回收那一步还会把仍在使用的
 * 驱动参数当垃圾删掉。
 */
export function parameterIsReferenced(document: GeometryDocument, parameterId: string): boolean {
  return document.primitives.some((primitive) => {
    if (primitive.type === "line" && primitive.slopeParameter === parameterId) return true
    if (primitive.type === "point" && primitive.binding?.kind === "onPath" && primitive.binding.parameterId === parameterId) return true
    if (primitive.type === "locus" && primitive.parameterId === parameterId) return true
    if (primitive.type === "polyhedron3" && primitive.construction?.kind === "template") return (primitive.construction.parameterIds ?? []).includes(parameterId)
    if (primitive.type === "point3" && primitive.binding) {
      const binding = primitive.binding
      if (binding.kind === "onHost" && binding.parameterId === parameterId) return true
      // 三个 uv/uvw 变体的元组长度不同，先收成 `readonly string[]` 再查，免得 `includes` 落在元组并集上。
      const driverIds: readonly string[] | undefined = binding.kind === "onFace" || binding.kind === "onSurface" || binding.kind === "inSolid" ? binding.parameterIds : undefined
      if (driverIds?.includes(parameterId)) return true
    }
    return false
  })
}

// 删除的级联判据在 `./deletion`（评审方案 2 拆出来的）：这里只引入要用的，并把公开面转出去。
import { deletionPlan, layerDescendantIds, unbindDeletedHost, type DeletionPlan } from "./deletion"
export { deletionPlan, deletionTargets, layerDescendantIds, type DeletionPlan } from "./deletion"

// 图元种类判据在 `./primitiveKinds`（deletion 也要用，放这里避免成环）。
import { isPlaceableConic } from "./primitiveKinds"
export { isPlaceableConic, isSourceIdConstruction, type SourceIdSolidConstruction } from "./primitiveKinds"

// 依赖图那一族在 `./graph`（评审方案 2 拆出来的）：引入要用的，并把公开面转出去。
import { getAffectedPrimitiveIds, topologicalRecomputeOrder } from "./graph"
export { getAffectedPrimitiveIds, getDependencyIndex, topologicalRecomputeOrder } from "./graph"

// 解析类图元的重算在 `./analysisRecompute`（评审方案 2 拆出来的）。
import { MIN_DYNAMIC_CIRCLE_RADIUS, pathConstraint, projectOntoPath, recomputeAnalysisSet, recomputeCurveTangent, recomputeDerivative, recomputeIntegral, recomputeSecant, recomputeTangent, sampledSource } from "./analysisRecompute"

// 路径查询与解析类图元的重算在 `./analysisRecompute`（评审方案 2 拆出来的）。
export { parameterWindow, pathConstraint } from "./analysisRecompute"

export function applyOperation(document: GeometryDocument, operation: DomainOperation): OperationResult {  const next = structuredClone(document) as GeometryDocument
  let changedIds: string[] = []
  if (operation.op === "addPrimitive") {
    if (next.primitives.some((primitive) => primitive.id === operation.primitive.id)) return { document, changed: false, error: "duplicate object id" }
    next.primitives.push(operation.primitive)
    changedIds = [operation.primitive.id]
  } else if (operation.op === "addPrimitives") {
    if (operation.primitives.some((primitive, index) => next.primitives.some((candidate) => candidate.id === primitive.id) || operation.primitives.slice(0, index).some((candidate) => candidate.id === primitive.id))) return { document, changed: false, error: "duplicate object id" }
    next.primitives.push(...operation.primitives)
    changedIds = operation.primitives.map((primitive) => primitive.id)
  } else if (operation.op === "updatePrimitive") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)

    const geometryPatchKeys = Object.keys(operation.patch).filter((key) => key !== "style" && key !== "label")
    if (!primitive || (geometryPatchKeys.length > 0 && !(EDITABLE_GEOMETRY_TYPES as readonly string[]).includes(primitive.type)) || primitive.locked) return { document, changed: false, error: primitive?.locked ? "object is locked" : "object is not editable" }
    if (primitive.type === "point") {
      if (operation.patch.x !== undefined) primitive.x = operation.patch.x
      if (operation.patch.y !== undefined) primitive.y = operation.patch.y
      if (operation.patch.binding !== undefined) primitive.binding = operation.patch.binding
    }
    if (primitive.type === "point3") {
      if (operation.patch.position3 !== undefined) primitive.position = { ...operation.patch.position3 }
      if (operation.patch.binding3 !== undefined) primitive.binding = operation.patch.binding3
      if (operation.patch.position3 !== undefined) {
        for (const candidate of next.primitives) {
          if (candidate.type !== "polyhedron3" || !candidate.vertexIds.includes(primitive.id)) continue
          if (candidate.construction?.kind === "template") {
            /**
             * 模板一旦有顶点被按数值改动，就不再是"参数化模板"了，改记成显式面环构造。
             * **归属要一起带走**（`sourceId`）：否则这个实体在截面 / 交线 / 交面里就找不到自己的拓扑，
             * 会被静默跳过（实测缺陷）。
             */
            candidate.construction = { kind: "fromFaces", sourceIds: [...candidate.faceIds], sourceId: candidate.construction.sourceIds[0] }
            continue
          }
          /**
           * **棱柱**（Fix round 2 / I4）：`construction` 是声明的真源（规格 §1.2），
           * 所以顶点一动就必须重新判断"这份描述还算不算数"：
           *
           * - 还能对上（每个顶点与 `底面 + 向量` 的约定一致，例如拖走整只实体）→ **保留** `prism`；
           * - 对不上（拖了某一个顶点、底座被拉得不共面……）→ 与模板同款处理，
           *   改记成显式面环 `fromFaces` 并保留归属 `sourceId`。描述与几何从此一致，
           *   也不会留下一句"我是按底面与向量拉伸出来的"这种与环境矛盾的假话。
           */
          if (candidate.construction?.kind === "prism" && !prismMatchesVertices(candidate, candidate.construction, next.primitives)) {
            candidate.construction = { kind: "fromFaces", sourceIds: [...candidate.faceIds], sourceId: candidate.id }
          }
        }
      }
    }
    if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") {
      if (operation.patch.a) primitive.a = { ...primitive.a, ...operation.patch.a }
      if (operation.patch.b) primitive.b = { ...primitive.b, ...operation.patch.b }
    }
    if (primitive.type === "polyline" && operation.patch.points) primitive.points = operation.patch.points
    if (primitive.type === "parabola") {
      if (operation.patch.vertex) primitive.vertex = { ...primitive.vertex, ...operation.patch.vertex }
      if (operation.patch.focalParameter !== undefined) primitive.focalParameter = operation.patch.focalParameter
      if (operation.patch.axis !== undefined) primitive.axis = operation.patch.axis
      if (operation.patch.rotation !== undefined) primitive.rotation = operation.patch.rotation
    }
    if (primitive.type === "ellipse" || primitive.type === "hyperbola") {
      if (operation.patch.center) primitive.center = { ...primitive.center, ...operation.patch.center }
      if (operation.patch.radiusX !== undefined) primitive.radiusX = operation.patch.radiusX
      if (operation.patch.radiusY !== undefined) primitive.radiusY = operation.patch.radiusY
      if (primitive.type === "hyperbola" && operation.patch.axis !== undefined) primitive.axis = operation.patch.axis
      if (operation.patch.rotation !== undefined) primitive.rotation = operation.patch.rotation
      if (primitive.type === "ellipse" && operation.patch.rotationAbout !== undefined) primitive.rotationAbout = operation.patch.rotationAbout
    }
    if (primitive.type === "function") {
      if (operation.patch.expression !== undefined) primitive.expression = operation.patch.expression
      if (operation.patch.domain !== undefined) primitive.domain = operation.patch.domain
      if (operation.patch.samples !== undefined) primitive.samples = operation.patch.samples
    }
    if (primitive.type === "circle" || primitive.type === "arc") {
      if (operation.patch.center) primitive.center = { ...primitive.center, ...operation.patch.center }
      if (operation.patch.radius !== undefined) primitive.radius = operation.patch.radius
      // 圆现在也有朝向（`rotation`）与"绕定点旋转"（`rotationAbout`）：见 DSL 的 `CurveRotation`。
      // 写成"整块替换"而不是只改 angle —— 定点与转角必须一起落，中间态会让曲线短暂地不再过定点。
      if (primitive.type === "circle" && operation.patch.rotation !== undefined) primitive.rotation = operation.patch.rotation
      if (primitive.type === "circle" && operation.patch.rotationAbout !== undefined) primitive.rotationAbout = operation.patch.rotationAbout
      /**
       * 圆心点 / 半径驱动规则。`null` 是"去掉这条规则"：删字段而不是写 null，
       * 因为 schema 与导出都把缺省当成"没有这条规则"，留一个 `null` 会让校验与往返都多出一个特例。
       * 圆心被点接管后 `rotationAbout` 就没有意义了（两者会争夺同一个 `center`），一并清掉。
       */
      if (primitive.type === "circle" && operation.patch.centerPointId !== undefined) {
        if (operation.patch.centerPointId === null) delete primitive.centerPointId
        else {
          primitive.centerPointId = operation.patch.centerPointId
          delete primitive.rotationAbout
        }
      }
      if (primitive.type === "circle" && operation.patch.radiusFrom !== undefined) {
        if (operation.patch.radiusFrom === null) delete primitive.radiusFrom
        else primitive.radiusFrom = operation.patch.radiusFrom
      }
    }
    /**
     * 切线 / 法线：曲线来源的定位方式与绘制半长。
     *
     * 这是"在曲线上作切线"之后唯一需要用户调的两件事：切点沿曲线滑到哪里（`anchor`）、
     * 以及画多长（`halfLength`）。函数来源的旧切线不带 `anchor`，因此完全不受影响。
     */
    if (primitive.type === "tangent" || primitive.type === "normal") {
      if (operation.patch.anchor !== undefined) {
        if (operation.patch.anchor === null) delete primitive.anchor
        else primitive.anchor = operation.patch.anchor
      }
      if (operation.patch.halfLength !== undefined) primitive.halfLength = operation.patch.halfLength
      /**
       * 函数来源的旧切线用横坐标定位：沿函数图像拖动切线就是改这个 `x`。
       * **带 `anchor` 的曲线切线不在这里**——它的切点由 `anchor` 决定，写 `x` 只会被下一趟重算覆盖掉，
       * 那种切线的拖动走 `anchor.parameter`（见 `interaction.ts` 的 `createDragAction`）。
       */
      if (!primitive.anchor && operation.patch.x !== undefined) primitive.x = operation.patch.x
    }
    if (primitive.type === "arc") {
      if (operation.patch.startAngle !== undefined) primitive.startAngle = operation.patch.startAngle
      if (operation.patch.endAngle !== undefined) primitive.endAngle = operation.patch.endAngle
    }
    if (primitive.type === "plane3" && operation.patch.halfSize !== undefined) {
      // null puts the plane back on automatic sizing; JSON.stringify then drops the field entirely.
      if (operation.patch.halfSize === null || !(operation.patch.halfSize > 0)) delete primitive.halfSize
      else primitive.halfSize = operation.patch.halfSize
    }
    if (primitive.type === "cube") {
      if (operation.patch.origin3) primitive.origin = { ...primitive.origin, ...operation.patch.origin3 }
      if (operation.patch.size3) primitive.size = { ...primitive.size, ...operation.patch.size3 }
      if (operation.patch.rotation3) primitive.rotation = { ...(primitive.rotation ?? { x: 0, y: 0, z: 0 }), ...operation.patch.rotation3 }
    }
    if (primitive.type === "pyramid") {
      if (operation.patch.baseCenter3) primitive.baseCenter = { ...primitive.baseCenter, ...operation.patch.baseCenter3 }
      if (operation.patch.baseSize3) primitive.baseSize = { ...primitive.baseSize, ...operation.patch.baseSize3 }
      if (operation.patch.height !== undefined) primitive.height = operation.patch.height
      if (operation.patch.rotation3) primitive.rotation = { ...(primitive.rotation ?? { x: 0, y: 0, z: 0 }), ...operation.patch.rotation3 }
    }
    if (primitive.type === "cylinder" || primitive.type === "cone") {
      if (operation.patch.center3) primitive.center = { ...primitive.center, ...operation.patch.center3 }
      if (operation.patch.radius3 !== undefined) primitive.radius = operation.patch.radius3
      if (operation.patch.height !== undefined) primitive.height = operation.patch.height
      if (operation.patch.segments !== undefined) primitive.segments = operation.patch.segments
      if (operation.patch.rotation3) primitive.rotation = { ...(primitive.rotation ?? { x: 0, y: 0, z: 0 }), ...operation.patch.rotation3 }
    }
    // 空间圆轨道：圆心、半径都是它自己的参数（法向由旋转操作改）。
    if (primitive.type === "circle3") {
      if (operation.patch.center3) primitive.center = { ...primitive.center, ...operation.patch.center3 }
      if (operation.patch.radius3 !== undefined) primitive.radius = operation.patch.radius3
    }
    if (operation.patch.label !== undefined) primitive.label = operation.patch.label
    // A template solid paints its generated point/edge/face children, so a template style change recolours them too.
    if (operation.patch.style !== undefined && ["cube", "pyramid", "cylinder", "cone"].includes(primitive.type)) {
      for (const candidate of next.primitives) {
        if (candidate.type !== "polyhedron3" || candidate.construction?.kind !== "template" || candidate.construction.sourceIds[0] !== primitive.id) continue
        candidate.style = { ...candidate.style, ...operation.patch.style }
        for (const childId of [...candidate.vertexIds, ...candidate.edgeIds, ...candidate.faceIds]) {
          const child = next.primitives.find((entry) => entry.id === childId)
          if (child) child.style = { ...child.style, ...operation.patch.style }
        }
      }
    }
    if (operation.patch.style !== undefined) primitive.style = { ...primitive.style, ...operation.patch.style }
    changedIds = [operation.id]
  } else if (operation.op === "translatePrimitive") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (primitive) {
      const primitiveMap = new Map(next.primitives.map((candidate) => [candidate.id, candidate]))
      const dragged = primitive.type === "point"
        ? dragBoundPoint(primitive, operation.delta, primitiveMap, next.parameters)
        : null
      if (dragged) {
        // 约束点沿曲线滑动：写回自己的参数（以及它绑定的文档参数），坐标由重算统一求出。
        next.primitives = next.primitives.map((candidate) => candidate.id === operation.id ? dragged.point : candidate)
        if (dragged.parameterValue) {
          const parameter = next.parameters[dragged.parameterValue.id]
          if (parameter) next.parameters[dragged.parameterValue.id] = { ...parameter, value: dragged.parameterValue.value }
          changedIds = [operation.id, dragged.parameterValue.id]
        } else {
          changedIds = [operation.id]
        }
      } else {
        next.primitives = next.primitives.map((candidate) => candidate.id !== operation.id
          ? candidate
          : candidate.type === "function" ? translateFunction(candidate, operation.delta.x, operation.delta.y) : translatePrimitive(candidate, operation.delta.x, operation.delta.y))
        changedIds = [operation.id]
      }
    }
  } else if (operation.op === "translatePrimitive3") {
    const deltaError = requireFinite({ x: operation.delta.x, y: operation.delta.y, z: operation.delta.z }, "translatePrimitive3: delta")
    if (deltaError) return { document, changed: false, error: deltaError }
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    if (!isFreeDraggable3(primitive, point3Index(next), templateTopologyIds(next))) return { document, changed: false, error: "object is not draggable" }
    const moved = translatePrimitive3(primitive, operation.delta)
    const movedIds = new Set(moved.movedIds)
    next.primitives = next.primitives
      .map((candidate) => candidate.id === operation.id ? moved.primitive : candidate)
      // A point-driven object is moved by moving its points; the object itself only follows through recompute.
      .map((candidate) => candidate.type === "point3" && candidate.id !== operation.id && movedIds.has(candidate.id) ? { ...candidate, position: shiftedPoint(candidate.position, operation.delta) } : candidate)
    // Sections name their source by id, so they are not in the dependency index: a moved solid has to
    // re-derive its own cuts explicitly, or the drawn section would keep the old shape while the solid moves.
    const cutIds = next.primitives.filter((candidate): candidate is Extract<PrimitiveSpec, { type: "section" }> => candidate.type === "section" && candidate.sourceId === operation.id).map((section) => section.id)
    changedIds = [...movedIds, operation.id, ...cutIds]
    // 搬完整只实体之后重检它的构造描述（外部审查 M1）：棱柱的顶点已经动了，
    // 描述符不能继续宣称旧的底面与向量。
    const movedSolid = next.primitives.find((candidate) => candidate.id === operation.id)
    if (movedSolid) realignPrismDescriptor(movedSolid, next.primitives)
  } else if (operation.op === "rotatePrimitive3") {
    const angleError = requireFinite({ degrees: operation.degrees }, "rotatePrimitive3")
    if (angleError) return { document, changed: false, error: angleError }
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    const points = point3Index(next)
    if (!isRotatable3(primitive, points, templateTopologyIds(next))) return { document, changed: false, error: "object is not rotatable" }
    const turned = rotatePrimitive3(primitive, points, operation.axis, operation.degrees, operation.pivot)
    if (!turned) return { document, changed: false, error: "object has no geometry to rotate" }
    const turnedPoints = new Map(turned.movedPoints.map((moved) => [moved.id, moved.position]))
    next.primitives = next.primitives.map((candidate) => {
      if (candidate.id === operation.id) return turned.primitive
      // 点驱动的对象由它的点带着转；模板实体的物化拓扑由 `buildSolidTemplate` 重算。
      if (candidate.type === "point3" && turnedPoints.has(candidate.id)) return { ...candidate, position: turnedPoints.get(candidate.id)! }
      return candidate
    })
    // 截面按 id 记来源、不在依赖索引里：实体转了，它的截面必须同一次提交里重算，否则刀口与形状对不上。
    const cutIds = next.primitives.filter((candidate): candidate is Extract<PrimitiveSpec, { type: "section" }> => candidate.type === "section" && candidate.sourceId === operation.id).map((section) => section.id)
    changedIds = [operation.id, ...turnedPoints.keys(), ...cutIds]
    // 同上：转完整只实体之后重检构造描述（外部审查 M1）。
    const turnedSolid = next.primitives.find((candidate) => candidate.id === operation.id)
    if (turnedSolid) realignPrismDescriptor(turnedSolid, next.primitives)
  } else if (operation.op === "moveSectionPlane") {
    const distanceError = requireFinite({ distance: operation.distance }, "moveSectionPlane")
    if (distanceError) return { document, changed: false, error: distanceError }
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || primitive.type !== "section") return { document, changed: false, error: "section not found" }
    primitive.plane = movedSectionPlane(primitive.plane, operation.distance)
    // 剖切面变了，截面点必须在同一次提交里重算，否则画布上的形状和读数会对不上。
    changedIds = [operation.id]
  } else if (operation.op === "rotateSectionPlane") {
    const angleError = requireFinite({ degrees: operation.degrees }, "rotateSectionPlane")
    if (angleError) return { document, changed: false, error: angleError }
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || primitive.type !== "section") return { document, changed: false, error: "section not found" }
    primitive.plane = rotatedSectionPlane(primitive.plane, operation.axis, operation.degrees, operation.pivot)
    changedIds = [operation.id]
  } else if (operation.op === "setSectionPlane") {
    const planeError = requireFinite({ nx: operation.normal.x, ny: operation.normal.y, nz: operation.normal.z, constant: operation.constant }, "setSectionPlane")
    if (planeError) return { document, changed: false, error: planeError }
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || primitive.type !== "section") return { document, changed: false, error: "section not found" }
    primitive.plane = { normal: { ...operation.normal }, constant: operation.constant }
    changedIds = [operation.id]
  } else if (operation.op === "toggleLock") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    primitive.locked = operation.locked
  } else if (operation.op === "setParameter") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: operation.value }
    // 只在显式给出时覆盖元数据，这样拖动滑块（只带 value）不会抹掉参数已有的 min/max/label。
    next.parameters[operation.id] = {
      ...parameter,
      value: operation.value,
      expression: undefined,
      ...(operation.min === undefined ? {} : { min: operation.min }),
      ...(operation.max === undefined ? {} : { max: operation.max }),
      ...(operation.step === undefined ? {} : { step: operation.step }),
      ...(operation.label === undefined ? {} : { label: operation.label }),
      ...(operation.ownerId === undefined ? {} : { ownerId: operation.ownerId })
    }
    changedIds = [operation.id]
  } else if (operation.op === "deleteParameter") {
    if (!next.parameters[operation.id]) return { document, changed: false, error: "parameter not found" }
    // 参数还被图元引用时不能删：绑定里的 parameterId 一旦悬空，点会静默冻住。
    if (parameterIsReferenced(next, operation.id)) return { document, changed: false, error: "parameter is referenced by an object" }
    delete next.parameters[operation.id]
  } else if (operation.op === "setParameterExpression") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: 0 }
    next.parameters[operation.id] = { ...parameter, expression: operation.expression }
    changedIds = [operation.id]
  } else if (operation.op === "addAnnotation") {
    next.annotations.push(operation.annotation)
  } else if (operation.op === "deleteAnnotation") {
    const before = next.annotations.length
    next.annotations = next.annotations.filter((annotation) => annotation.id !== operation.id)
    if (before === next.annotations.length) return { document, changed: false, error: "annotation not found" }
  } else if (operation.op === "addEngineeringAnnotation") {
    if (next.engineeringAnnotations?.some((annotation) => annotation.id === operation.annotation.id)) return { document, changed: false, error: "duplicate engineering annotation id" }
    next.engineeringAnnotations = [...(next.engineeringAnnotations ?? []), operation.annotation]
    changedIds = operation.annotation.sourceIds
  } else if (operation.op === "deleteEngineeringAnnotation") {
    const annotations = next.engineeringAnnotations ?? []
    const filtered = annotations.filter((annotation) => annotation.id !== operation.id)
    if (filtered.length === annotations.length) return { document, changed: false, error: "engineering annotation not found" }
    next.engineeringAnnotations = filtered
  } else if (operation.op === "addConstraint") {
    if (next.constraints.some((constraint) => constraint.id === operation.constraint.id)) return { document, changed: false, error: "duplicate constraint id" }
    next.constraints.push(operation.constraint)
    changedIds = operation.constraint.targets
  } else if (operation.op === "deleteObject") {
    const { plan, removedAny } = applyDeletionPlan(next, [operation.id])
    if (!removedAny) return { document, changed: false, error: "object not found" }
    changedIds = [...plan.primitives]
  } else if (operation.op === "deleteObjects") {
    // 一次算清整批的并集闭包，所以与 ids 的顺序无关（Task 0.4）。
    const { plan, removedAny } = applyDeletionPlan(next, operation.ids)
    if (!removedAny) return { document, changed: false, error: "object not found" }
    changedIds = [...plan.primitives]
  } else if (operation.op === "deleteConstraint") {
    const before = next.constraints.length
    next.constraints = next.constraints.filter((constraint) => constraint.id !== operation.id)
    if (before === next.constraints.length) return { document, changed: false, error: "constraint not found" }
  } else if (operation.op === "addMeasurement") {
    if (next.measurements.some((measurement) => measurement.id === operation.measurement.id)) return { document, changed: false, error: "duplicate measurement id" }
    next.measurements.push(operation.measurement)
    changedIds = operation.measurement.sourceIds
  } else if (operation.op === "deleteMeasurement") {
    const before = next.measurements.length
    next.measurements = next.measurements.filter((measurement) => measurement.id !== operation.id)
    if (before === next.measurements.length) return { document, changed: false, error: "measurement not found" }
  } else if (operation.op === "toggleVisibility") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    primitive.visible = operation.visible
  } else if (operation.op === "createGroup") {
    next.groups.push(operation.group)
  } else if (operation.op === "deleteGroup") {
    next.groups = next.groups.filter((group) => group.id !== operation.id)
  } else if (operation.op === "setPrimitivesLocked") {
    for (const primitive of next.primitives) if (operation.ids.includes(primitive.id)) primitive.locked = operation.locked
  } else if (operation.op === "setPrimitivesVisible") {
    for (const primitive of next.primitives) if (operation.ids.includes(primitive.id)) primitive.visible = operation.visible
  } else if (operation.op === "setPrimitivesStyle") {
    /**
     * 批量改外观（颜色 / 线宽 / 透明度 / 线型）。
     *
     * 为什么需要它：逐条 `updatePrimitive` 只能一条条提交，"选中五个对象一起改成红色"会变成五次撤销步骤，
     * 而且多选时检查器里改颜色以前只作用于**主选中**那一个（用户以为全改了，其实没有）。
     * 这里一次提交改完所有选中对象，撤销也只要一步。
     * `undefined` 表示"清除这一项、回到默认"，所以是显式赋值而不是合并。
     */
    for (const primitive of next.primitives) {
      if (!operation.ids.includes(primitive.id) || primitive.locked) continue
      // 注意：走到这里的"锁住成员"只可能来自**绕过 `validatePatch` 的直接调用**（测试 / 内部重算）。
      // 经补丁路径的批量改样式已经在 `patches.ts` 里被**整体拒绝**（与批量显隐同一条策略，
      // 外部审查 M3）—— 那条路径下不会有成员被静默跳过。
      const style = { ...primitive.style }
      // 逐项显式处理（不用 `as` 绕类型）：`undefined` 是**有意义的赋值**——清除这一项、回到默认。
      if ("stroke" in operation.style) { if (operation.style.stroke === undefined) delete style.stroke; else style.stroke = operation.style.stroke }
      if ("fill" in operation.style) { if (operation.style.fill === undefined) delete style.fill; else style.fill = operation.style.fill }
      if ("dash" in operation.style) { if (operation.style.dash === undefined) delete style.dash; else style.dash = operation.style.dash }
      if ("strokeWidth" in operation.style) { if (operation.style.strokeWidth === undefined) delete style.strokeWidth; else style.strokeWidth = operation.style.strokeWidth }
      if ("opacity" in operation.style) { if (operation.style.opacity === undefined) delete style.opacity; else style.opacity = operation.style.opacity }
      primitive.style = Object.keys(style).length > 0 ? style : undefined
    }
  } else if (operation.op === "alignPrimitives") {
    const selected = next.primitives.filter((primitive) => operation.ids.includes(primitive.id))
    const bounds = selected.map((primitive) => primitiveBounds(primitive)!)
    const target = operation.alignment === "left" ? Math.min(...bounds.map((value) => value.minX))
      : operation.alignment === "right" ? Math.max(...bounds.map((value) => value.maxX))
        : operation.alignment === "top" ? Math.max(...bounds.map((value) => value.maxY))
          : operation.alignment === "bottom" ? Math.min(...bounds.map((value) => value.minY))
            : operation.alignment === "horizontalCenter" ? bounds.reduce((sum, value) => sum + (value.minX + value.maxX) / 2, 0) / bounds.length
              : bounds.reduce((sum, value) => sum + (value.minY + value.maxY) / 2, 0) / bounds.length
    next.primitives = next.primitives.map((primitive) => {
      if (!operation.ids.includes(primitive.id)) return primitive
      const value = primitiveBounds(primitive)!
      const x = operation.alignment === "left" ? target - value.minX
        : operation.alignment === "right" ? target - value.maxX
          : operation.alignment === "horizontalCenter" ? target - (value.minX + value.maxX) / 2 : 0
      const y = operation.alignment === "top" ? target - value.maxY
        : operation.alignment === "bottom" ? target - value.minY
          : operation.alignment === "verticalCenter" ? target - (value.minY + value.maxY) / 2 : 0
      return translatePrimitive(primitive, x, y)
    })
    changedIds = operation.ids
  } else if (operation.op === "addLayer") {
    next.layers = [...(next.layers ?? []), operation.layer]
    if (!next.activeLayerId) next.activeLayerId = operation.layer.id
  } else if (operation.op === "updateLayer") {
    next.layers = (next.layers ?? []).map((layer) => layer.id === operation.id ? { ...layer, ...operation.patch, id: layer.id } : layer)
  } else if (operation.op === "deleteLayer") {
    const removedIds = layerDescendantIds(next, operation.id)
    const targetId = operation.reassignTo ?? (next.layers ?? []).find((layer) => layer.kind === "geometry" && !removedIds.has(layer.id))?.id
    if (!targetId) return { document, changed: false, error: "no replacement layer" }
    next.primitives = next.primitives.map((primitive) => removedIds.has(primitive.layerId ?? "") ? { ...primitive, layerId: targetId } : primitive)
    next.layers = (next.layers ?? []).filter((layer) => !removedIds.has(layer.id))
    if (removedIds.has(next.activeLayerId ?? "")) next.activeLayerId = targetId
  } else if (operation.op === "setActiveLayer") {
    next.activeLayerId = operation.id
  } else if (operation.op === "addDrawingSheet") {
    next.drawingSheets = [...(next.drawingSheets ?? []), operation.sheet]
    if (!next.activeSheetId) next.activeSheetId = operation.sheet.id
  } else if (operation.op === "updateDrawingSheet") {
    next.drawingSheets = (next.drawingSheets ?? []).map((sheet) => sheet.id === operation.id ? { ...sheet, ...operation.patch, id: sheet.id } : sheet)
  } else if (operation.op === "addDrawingView") {
    next.drawingViews = [...(next.drawingViews ?? []), operation.view]
  } else if (operation.op === "updateDrawingView") {
    next.drawingViews = (next.drawingViews ?? []).map((view) => view.id === operation.id ? { ...view, ...operation.patch, id: view.id } : view)
  } else if (operation.op === "deleteDrawingView") {
    next.drawingViews = (next.drawingViews ?? []).filter((view) => view.id !== operation.id)
    next.drawingSheets = (next.drawingSheets ?? []).map((sheet) => ({ ...sheet, viewIds: sheet.viewIds.filter((viewId) => viewId !== operation.id) }))
  }
  try {
    const recomputed = recomputeDerivedObjects(next, changedIds)
    /**
     * 只有**真的变了**才推进 revision（Task 0.3）。
     * 以前这里无条件 `revision += 1` 并返回 `changed: true`，于是"把已经可见的对象再设为可见"
     * 这类空操作也会在撤销栈里留下一步 —— Agent 端更糟：它会据此认为"确实改动了文档"，
     * 从而跳过"无变化"的分支。判定放在重算**之后**，所以派生几何的变化也算改动。
     */
    const mutated = documentChanged(document, recomputed)
    if (!mutated) return { document, changed: false }
    recomputed.revision += 1
    recomputed.metadata.updatedAt = new Date().toISOString()
    return { document: recomputed, changed: true }
  } catch (error) {
    return { document, changed: false, error: error instanceof Error ? error.message : "Failed to recompute document" }
  }
}
