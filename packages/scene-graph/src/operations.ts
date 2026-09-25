import { type AnnotationSpec, type CircleRadiusRule, type ConstraintSpec, type CurveRotation, type DerivedSolidResult, type DrawingSheetSpec, type DrawingViewSpec, type EngineeringAnnotation, type GeometryDocument, type GroupSpec, type LayerSpec, type Measurement3, type Point3Binding, type Point3Primitive, type PointBinding, type PrimitiveSpec, type TangentAnchor, type Vector3 } from "@draw/dsl"
import { calculateMeasurement3, entityResolverFor, evaluateLineParameters, evaluateParameterExpressions, evaluatePlanarMeasurement, intersectSampledPrimitives, placedConic, sectionSolid3, solveCircumsphere3, solveInsphere3, solveLineConstraints, triangleCenter2, triangleRadius2, type PlanarMetric, type PlaceableConic, type SolidBoundary, type Sphere3, type WorldAxis3 } from "@draw/geometry-kernel"

export * from "./solidGeometry"

/**
 * **本文件内部也要用到它们**，所以除了"原样再导出"还要真的 import 一次。
 *
 * `export * from "./solidGeometry"` 只把那些名字挂到**模块的导出表**上，
 * **不会**在当前模块的作用域里建立局部绑定 —— 少了这一行，`operations.ts` 里
 * 凡是用到 `templateTopology` / `polyhedronSectionTopology` 的地方都会报 `Cannot find name`。
 * （拆文件时踩过：`export *` 看着像"把整个模块搬过来"，其实只搬了对外的那一面。）
 */
import { movedSectionPlane, rotatedSectionPlane } from "./solidGeometry"

// 绕定点旋转的喂料层在 `./curveRotation`（评审方案 2 拆出来的）。
import { curveRotationPivotId, placementResolver } from "./curveRotation"
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

/** 平面的 Newell 法向与面积由内核随交集一起给出（`faceNormals` / `faceAreas`），这里不再复刻。 */

/** 实体的索引化拓扑（顶点数组 + 面环下标）；非实体或拓扑未物化时返回 null。 */

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

// 三维对象的解析在 `./resolve3d`（评审方案 2 拆出来的）。
import { dragBoundPoint, resolveBoundPoint, resolveBoundPoint3, resolveIntersection, syncTemplateTopology } from "./resolve3d"
export { sectionMaterialization, solidVolumeHostFor } from "./resolve3d"

// 交面 / 交点与几个小几何辅助在 `./sectionRecompute`。
import { recomputeIntersectionFace, recomputeIntersectionPoint3 } from "./sectionRecompute"

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
import { MIN_DYNAMIC_CIRCLE_RADIUS, recomputeAnalysisSet, recomputeCurveTangent, recomputeDerivative, recomputeIntegral, recomputeSecant, recomputeTangent, sampledSource } from "./analysisRecompute"

// 路径查询与解析类图元的重算在 `./analysisRecompute`（评审方案 2 拆出来的）。
export { parameterWindow, pathConstraint } from "./analysisRecompute"

// 三维变换与可编辑性判据在 `./transforms`（评审方案 2 拆出来的）。
import { EDITABLE_GEOMETRY_TYPES, isFreeDraggable3, isRotatable3, point3Index, primitiveBounds, prismMatchesVertices, realignPrismDescriptor, rotatePrimitive3, shiftedPoint, templateTopologyIds, translateFunction, translatePrimitive, translatePrimitive3 } from "./transforms"
export { EDITABLE_GEOMETRY_TYPES, isFreeDraggable3, isRotatable3, managedPointIds, templateTopologyIds } from "./transforms"

// 截面与交的重算在 `./sectionRecompute`（评审方案 2 拆出来的）。
import { recomputeIntersectionLine, recomputeIntersectionSolid, recomputeSection, solidTopology3 } from "./sectionRecompute"
export { intersectionFaceRings, solidTopology3 } from "./sectionRecompute"

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
