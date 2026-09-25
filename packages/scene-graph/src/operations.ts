import { type AnnotationSpec, type CircleRadiusRule, type ConstraintSpec, type CurveRotation, type DerivedSolidResult, type DrawingSheetSpec, type DrawingViewSpec, type EngineeringAnnotation, type GeometryDocument, type GroupSpec, type LayerSpec, type Measurement3, type Point3Binding, type Point3Primitive, type PointBinding, type PrimitiveSpec, type TangentAnchor, type Vector3 } from "@draw/dsl"
import { sectionSolid3, solveCircumsphere3, solveInsphere3, type SolidBoundary, type Sphere3, type WorldAxis3 } from "@draw/geometry-kernel"

export * from "./solidGeometry"

/**
 * **本文件内部也要用到它们**，所以除了"原样再导出"还要真的 import 一次。
 *
 * `export * from "./solidGeometry"` 只把那些名字挂到**模块的导出表**上，
 * **不会**在当前模块的作用域里建立局部绑定 —— 少了这一行，`operations.ts` 里
 * 凡是用到 `templateTopology` / `polyhedronSectionTopology` 的地方都会报 `Cannot find name`。
 * （拆文件时踩过：`export *` 看着像"把整个模块搬过来"，其实只搬了对外的那一面。）
 */

// 绕定点旋转的喂料层在 `./curveRotation`（评审方案 2 拆出来的）。
export { curveRotationPivotId, resolveCurveRotation } from "./curveRotation"
export { isDomainOperation } from "./operationNames"

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
export { sectionMaterialization, solidVolumeHostFor } from "./resolve3d"
export { recomputeDerivedObjects } from "./recompute"

// 交面 / 交点与几个小几何辅助在 `./sectionRecompute`。

// 删除的级联判据在 `./deletion`（评审方案 2 拆出来的）：这里只引入要用的，并把公开面转出去。
export { deletionPlan, deletionTargets, layerDescendantIds, type DeletionPlan } from "./deletion"

// 图元种类判据在 `./primitiveKinds`（deletion 也要用，放这里避免成环）。
export { isPlaceableConic, isSourceIdConstruction, type SourceIdSolidConstruction } from "./primitiveKinds"

// 依赖图那一族在 `./graph`（评审方案 2 拆出来的）：引入要用的，并把公开面转出去。
export { getAffectedPrimitiveIds, getDependencyIndex, topologicalRecomputeOrder } from "./graph"

// 解析类图元的重算在 `./analysisRecompute`（评审方案 2 拆出来的）。

// 路径查询与解析类图元的重算在 `./analysisRecompute`（评审方案 2 拆出来的）。
export { parameterWindow, pathConstraint } from "./analysisRecompute"

// 三维变换与可编辑性判据在 `./transforms`（评审方案 2 拆出来的）。
export { EDITABLE_GEOMETRY_TYPES, isFreeDraggable3, isRotatable3, managedPointIds, templateTopologyIds } from "./transforms"

// 截面与交的重算在 `./sectionRecompute`（评审方案 2 拆出来的）。
import { solidTopology3 } from "./sectionRecompute"
export { intersectionFaceRings, solidTopology3 } from "./sectionRecompute"


// 写入口那一族在 `./apply`（评审方案 2 拆出来的最后一块）：这里只转出去。
export { applyOperation, parameterIsReferenced, type OperationResult } from "./apply"
