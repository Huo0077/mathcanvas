import type { CurveRotation, GeometryDocument, Point3Primitive, PrimitiveSpec, SolidConstruction, Vector3 } from "@draw/dsl"
import { composeEuler3, rotatePointAboutAxis3, rotateVectorAboutAxis3, templateSolidPivot, type WorldAxis3 } from "@draw/geometry-kernel"
import { curveRotationOf } from "./curveRotation"

/**
 * **图元的三维变换与可编辑性判据**（从 `operations.ts` 拆出，评审方案 2）。
 *
 * 平移与旋转怎么落到文档上，以及"这个对象能不能被拖动 / 绕定点旋转"。三条口径随代码搬过来：
 *
 * 1. **模板实体与它的物化拓扑必须一起动**：只改参数化图元会让"下一次重算"把子对象拉回旧位置；
 * 2. **棱柱的构造描述可能不再成立**（拖走一个顶点、底面被拉得不共面）：那时要改记成显式面环，
 *    而不是继续宣称"我是按底面 + 向量拉伸出来的"（`prismMatchesVertices` / `realignPrismDescriptor`）；
 * 3. **旋转的判据是"有自己的一族点"**（`centroidOfOwnedPoints`）：没有点的对象绕谁转都没有意义。
 */

/** 二维图元的包围盒（模板实体与它物化出来的子对象共用同一只）。 */
export interface PrimitiveBounds { minX: number; maxX: number; minY: number; maxY: number }

export function angleOnArc(angle: number, start: number, end: number): boolean {
  const full = Math.PI * 2
  const normalized = (value: number) => (value % full + full) % full
  const delta = end - start
  const direction = delta >= 0 ? 1 : -1
  const span = Math.min(Math.abs(delta), full)
  return normalized(direction * (angle - start)) <= span + 1e-10
}

export function primitiveBounds(primitive: PrimitiveSpec): PrimitiveBounds | null {
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
export function translatePrimitive(primitive: PrimitiveSpec, x: number, y: number): PrimitiveSpec {
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
export function prismMatchesVertices(
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
export function realignPrismDescriptor(primitive: PrimitiveSpec, primitives: readonly PrimitiveSpec[]): void {
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
export function shiftedRotationAbout(primitive: PrimitiveSpec, x: number, y: number): { rotationAbout?: CurveRotation } {
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

export function signedOffset(value: number): string {
  return value < 0 ? String(value) : `+${value}`
}

export function translateFunction(primitive: Extract<PrimitiveSpec, { type: "function" }>, x: number, y: number): Extract<PrimitiveSpec, { type: "function" }> {
  const shiftedExpression = primitive.expression.replace(/\bx\b/g, `(x${signedOffset(-x)})`)
  return { ...primitive, expression: `(${shiftedExpression})${signedOffset(y)}`, domain: [primitive.domain[0] + x, primitive.domain[1] + x] }
}

export function shiftedPoint(point: Vector3, delta: Vector3): Vector3 {
  return { x: point.x + delta.x, y: point.y + delta.y, z: point.z + delta.z }
}

export function point3Index(document: GeometryDocument): Map<string, Point3Primitive> {
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
export function translatePrimitive3(primitive: PrimitiveSpec, delta: Vector3): { primitive: PrimitiveSpec; movedIds: string[] } {
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
export function centroidOfOwnedPoints(primitive: PrimitiveSpec, points: Map<string, Point3Primitive>): Vector3 | null {
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
export function rotatedOrientationVectors(primitive: PrimitiveSpec, axis: WorldAxis3, radians: number): Partial<PrimitiveSpec> {
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
export function rotatePrimitive3(primitive: PrimitiveSpec, points: Map<string, Point3Primitive>, axis: WorldAxis3, degrees: number, pivot?: Vector3): { primitive: PrimitiveSpec; movedPoints: { id: string; position: Vector3 }[] } | null {
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
