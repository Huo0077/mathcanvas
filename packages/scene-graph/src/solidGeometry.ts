import type { GeometryDocument, PrimitiveSpec, Section3Classification, Vector3 } from "@draw/dsl"
import { dihedralMarker3, sharedRingEdge3, type DihedralMarker3, type FaceRing3 } from "@draw/geometry-kernel"

/**
 * **立体与截面的几何**（从 `operations.ts` 拆出，逐字照搬）。
 *
 * ## 这一块回答的是同一个问题
 *
 * "这只实体**现在**是什么形状、我拿它的哪个视图去算" —— 模板实体自己那一套参数
 *（`origin` / `size` / `radius`…）与它物化出来的拓扑（点 / 棱 / 面 / `polyhedron3`）
 * 在这里被翻译成**顶点 + 面环**，供截面、二面角、截面物化三处消费。
 *
 * ## 为什么值得单独一个文件
 *
 * 不是因为"行数太多"，而是它此前与三种完全不同的东西挤在一个 2800 行的文件里：
 * 平面图元的平移 / 旋转、曲线的求导与切线重算、以及 `DomainOperation` 的执行与重算管线。
 * 本轮 P0 修的"Agent 造的实体改朝向、画布却不动"正落在这条链路上，
 * 而改一处要先读完整个文件才敢确认没有第二个真源 —— 那才是真正的时间成本。
 *
 * ## 搬动纪律：**逐字照搬，不做任何"顺手整理"**
 *
 * 这一段里有像 `topologyIn` 的"模板记法优先、`fromFaces` 记法兜底"、
 * `edgesBetween` 的 `if (offset > 0)`、以及 `polyhedronSectionTopology` 用
 * `polyhedron.vertexIds.indexOf`（而不是另建一张下标表）这样看着可疑、
 * 实则是刻意为之的判据。重写一遍极可能把它们"修"坏 —— 本轮实测差点如此：
 * 手抄的第一版把 `edgesBetween` 的竖棱条件、`topologyIn` 的两种记法都抄错了。
 * 所以这个文件的内容由 `git show <base>:…/operations.ts` 的原字节区间生成，
 * 只加了这一段说明。
 *
 * `operations.ts` 仍然**原样导出**这里的一切（`export * from "./solidGeometry"`），
 * 因此跨包调用点与既有 import 一个字都不用改；本文件里未加 `export` 的私有函数
 * 只有真正被 `operations.ts` 使用的那些才需要 `export`。
 */

export function solidSectionGeometry(primitive: Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>): { vertices: Vector3[]; edges: [number, number][] } {
  if (primitive.type === "cube") {
    const { origin, size } = primitive
    const vertices = [
      { x: origin.x, y: origin.y, z: origin.z }, { x: origin.x + size.x, y: origin.y, z: origin.z }, { x: origin.x + size.x, y: origin.y + size.y, z: origin.z }, { x: origin.x, y: origin.y + size.y, z: origin.z },
      { x: origin.x, y: origin.y, z: origin.z + size.z }, { x: origin.x + size.x, y: origin.y, z: origin.z + size.z }, { x: origin.x + size.x, y: origin.y + size.y, z: origin.z + size.z }, { x: origin.x, y: origin.y + size.y, z: origin.z + size.z }
    ]
    return { vertices, edges: [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] }
  }
  if (primitive.type === "pyramid") {
    const halfX = primitive.baseSize.x / 2
    const halfY = primitive.baseSize.y / 2
    const { baseCenter } = primitive
    // 世界是 Z 轴朝上（与 `buildSolidTemplate` 一致）：底面铺在 XY 平面、顶点沿 +Z。
    // 旧实现把底面放在 XZ、顶点沿 +Y，于是"默认剖切面取包围盒中心的 y"算到了实体之外——
    // 上一轮实测的"棱锥/圆柱/圆锥默认截面错位"就是这个坐标系不一致。
    const vertices = [
      { x: baseCenter.x - halfX, y: baseCenter.y - halfY, z: baseCenter.z },
      { x: baseCenter.x + halfX, y: baseCenter.y - halfY, z: baseCenter.z },
      { x: baseCenter.x + halfX, y: baseCenter.y + halfY, z: baseCenter.z },
      { x: baseCenter.x - halfX, y: baseCenter.y + halfY, z: baseCenter.z },
      { x: baseCenter.x, y: baseCenter.y, z: baseCenter.z + primitive.height }
    ]
    return { vertices, edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [1, 4], [2, 4], [3, 4]] }
  }
  const ring = (z: number) => Array.from({ length: primitive.segments }, (_, index) => {
    const angle = index * Math.PI * 2 / primitive.segments
    return { x: primitive.center.x + primitive.radius * Math.cos(angle), y: primitive.center.y + primitive.radius * Math.sin(angle), z }
  })
  const edgesBetween = (offset: number): [number, number][] => {
    const edges: [number, number][] = []
    for (let index = 0; index < primitive.segments; index += 1) {
      const next = (index + 1) % primitive.segments
      edges.push([offset + index, offset + next])
      if (offset > 0) edges.push([index, offset + index])
    }
    return edges
  }
  if (primitive.type === "cylinder") {
    const bottom = ring(primitive.center.z)
    const top = ring(primitive.center.z + primitive.height)
    const vertices = [...bottom, ...top]
    return { vertices, edges: [...edgesBetween(0), ...edgesBetween(primitive.segments).slice(primitive.segments)] }
  }
  // 圆锥：只有一个底面圆 + 顶点。旧实现建了上下两个同半径的环、顶点又落在上环高度上，
  // 等于"顶面被扇形封口的圆柱"——任何未被物化的圆锥文档其截面与面环都是错的。
  const vertices = [...ring(primitive.center.z), { x: primitive.center.x, y: primitive.center.y, z: primitive.center.z + primitive.height }]
  const apex = primitive.segments
  const edges: [number, number][] = []
  for (let index = 0; index < primitive.segments; index += 1) {
    edges.push([index, (index + 1) % primitive.segments], [index, apex])
  }
  return { vertices, edges }
}

export function classifySectionPoints(points: Vector3[]): Section3Classification {
  if (points.length === 0) return "none"
  if (points.length === 1) return "point"
  if (points.length === 2) return "segment"
  return "polygon"
}

/** Resolve materialized point-driven topology into ordered vertex positions and face rings. */
export function polyhedronSectionTopology(polyhedron: Extract<PrimitiveSpec, { type: "polyhedron3" }>, primitiveMap: Map<string, PrimitiveSpec>): { vertices: Vector3[]; faces: number[][] } | null {
  const vertices: Vector3[] = []
  for (const vertexId of polyhedron.vertexIds) {
    const vertex = primitiveMap.get(vertexId)
    if (vertex?.type !== "point3") return null
    vertices.push({ ...vertex.position })
  }
  const faces: number[][] = []
  for (const faceId of polyhedron.faceIds) {
    const face = primitiveMap.get(faceId)
    if (face?.type !== "face3") return null
    const ring = face.pointIds.map((pointId) => polyhedron.vertexIds.indexOf(pointId))
    if (ring.length < 3 || ring.some((index) => index < 0)) return null
    faces.push(ring)
  }
  return faces.length >= 4 ? { vertices, faces } : null
}

/**
 * **某个实体图元的物化拓扑**（点驱动的 `polyhedron3`）—— 这条规则**只有这一份**。
 *
 * 两种记法都认：模板物化是 `kind: "template"` + `sourceIds[0] === 实体 id`；
 * 而按数值改过顶点的模板（或改得对不上底面 + 向量的棱柱）会被翻成 `fromFaces`，
 * 归属改记在 `sourceId` 上 —— 不认这一种的话，那个实体会在截面 / 交线 / 交面里
 * **静默消失**（实测缺陷），还会给出"来源必须是实体"这种误导诊断。
 *
 * 同一实体同时存在两种记法时**参数化模板优先**：模板那一份才是参数真源。
 *
 * 导出这一个函数（而不是让调用方各写一遍）是因为"用户拖了一个顶点之后 topology 归谁"
 * 这个问题只能有一个答案：界面上的派生读数（Fix round 1 / I2）此前自己写了一遍、只认模板记法，
 * 于是拖一个顶点之后整块读数**无声消失**——两个实现迟早会分叉，而分叉的代价就是这个。
 */
function topologyIn(primitiveMap: Map<string, PrimitiveSpec>, entityId: string): Extract<PrimitiveSpec, { type: "polyhedron3" }> | null {
  let fallback: Extract<PrimitiveSpec, { type: "polyhedron3" }> | null = null
  for (const primitive of primitiveMap.values()) {
    if (primitive.type !== "polyhedron3") continue
    const owner = ownerOfTopology(primitive)
    if (owner === undefined || owner !== entityId) continue
    if (primitive.construction?.kind === "template") return primitive
    fallback = fallback ?? primitive
  }
  return fallback
}

/**
 * **一条拓扑归属哪只实体**（上面那条规则的反方向）。
 *
 * 与 `topologyOfEntity` 是同一条规则的两个方向，所以**共用同一个出口**：
 * 两处各写一遍 `template ? sourceIds[0] : fromFaces ? sourceId : undefined`，
 * 迟早会有一处忘了 `fromFaces`（那个分支正是"拖一个顶点"之后的样子）。
 */
export function ownerOfTopology(polyhedron: Extract<PrimitiveSpec, { type: "polyhedron3" }>): string | undefined {
  const construction = polyhedron.construction
  if (!construction) return undefined
  if (construction.kind === "template") return construction.sourceIds[0]
  /**
   * **`fromPoints` 也要有归属**（2026-09-23，与下面删除那一处同源）。
   *
   * `fromPoints` 是"由一串已有点构造出来的"（Agent 的正四面体就是它），`fromFaces` 是它的另一支。
   * 漏掉 `fromPoints` 的代价实测过：那只多面体**没有归属**，于是按归属查拓扑的派生读数（体积 / 外接球…）
   * 会无声消失 —— 与上面 `topologyOfEntity` 注释里记的那次同一类。
   */
  if (construction.kind === "fromPoints") return construction.sourceIds[0]
  if (construction.kind === "fromFaces") return construction.sourceId
  return undefined
}

/** 整份文档里的版本（上面那条规则的唯一出口）。 */
export function topologyOfEntity(document: GeometryDocument, entityId: string): Extract<PrimitiveSpec, { type: "polyhedron3" }> | null {
  return topologyIn(new Map(document.primitives.map((primitive) => [primitive.id, primitive])), entityId)
}

export function templateTopology(sourceId: string, primitiveMap: Map<string, PrimitiveSpec>): Extract<PrimitiveSpec, { type: "polyhedron3" }> | null {
  return topologyIn(primitiveMap, sourceId)
}

/** Vertex positions of a section source: materialized topology first, template tessellation as fallback. */
export function sectionSourceVertices(document: GeometryDocument, sourceId: string): Vector3[] {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const source = primitiveMap.get(sourceId)
  return source ? sourceVertices(source, primitiveMap) : []
}

/**
 * 截面的剖切面平移一段距离。平面以 `normal · p + constant = 0` 表示，沿法向走 `distance` 时**只改常数项**：
 * `constant - distance * |normal|`。这里刻意不把法向单位化——同时改法向和常数项会让平面额外漂移
 * （实测：法向 (0,3,4)、距离 1 时，平面会多走 2 个单位）。
 */
export function movedSectionPlane(plane: { normal: Vector3; constant: number }, distance: number): { normal: Vector3; constant: number } {
  const length = Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z)
  if (!Number.isFinite(length) || length < 1e-9 || !Number.isFinite(distance)) return plane
  return { normal: plane.normal, constant: plane.constant - distance * length }
}

/** 剖切面沿法向到原点的有符号偏移（教学读数：平面相对原点走了多远）。 */
export function sectionPlaneOffset(plane: { normal: Vector3; constant: number }): number {
  const length = Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z)
  return length < 1e-9 ? 0 : -plane.constant / length
}

function rotateVector(vector: Vector3, axis: "x" | "y" | "z", radians: number): Vector3 {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  if (axis === "x") return { x: vector.x, y: vector.y * cos - vector.z * sin, z: vector.y * sin + vector.z * cos }
  if (axis === "y") return { x: vector.x * cos + vector.z * sin, y: vector.y, z: -vector.x * sin + vector.z * cos }
  return { x: vector.x * cos - vector.y * sin, y: vector.x * sin + vector.y * cos, z: vector.z }
}

/**
 * 绕世界轴旋转剖切面，枢轴默认取平面上离原点最近的点。
 * 绕**实体中心**转才是教学上想要的"把刀口摆斜"（见 `sectionPivotFor`）；枢轴参数化是为了让调用方给出
 * 那个中心，同时保留"绕平面自身垂足转"这一纯几何语义。
 */
export function rotatedSectionPlane(plane: { normal: Vector3; constant: number }, axis: "x" | "y" | "z", degrees: number, pivot?: Vector3): { normal: Vector3; constant: number } {
  const lengthSq = plane.normal.x ** 2 + plane.normal.y ** 2 + plane.normal.z ** 2
  if (!Number.isFinite(lengthSq) || lengthSq < 1e-18 || !Number.isFinite(degrees)) return plane
  const center = pivot ?? { x: -plane.constant * plane.normal.x / lengthSq, y: -plane.constant * plane.normal.y / lengthSq, z: -plane.constant * plane.normal.z / lengthSq }
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) return plane
  const normal = rotateVector(plane.normal, axis, degrees * Math.PI / 180)
  return { normal, constant: -(normal.x * center.x + normal.y * center.y + normal.z * center.z) }
}

/** 一组点的中心：截面的剖切面绕着它转，倾斜后的刀口才会仍然穿过实体、看得见截面。 */
export function sectionPivot(points: Vector3[]): Vector3 | null {
  if (points.length === 0) return null
  const centre = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }), { x: 0, y: 0, z: 0 })
  return { x: centre.x / points.length, y: centre.y / points.length, z: centre.z / points.length }
}

/** 点到平面的有符号距离：`normal·p + constant`（法向为单位向量时就是世界距离）。 */
export function sectionDistanceToPlane(plane: { normal: Vector3; constant: number }, point: Vector3): number {
  return plane.normal.x * point.x + plane.normal.y * point.y + plane.normal.z * point.z + plane.constant
}

export interface SectionPlaneGeometry {
  normal: Vector3
  constant: number
}

/**
 * 由一组共面点求它所在的平面（前三点定法向，再用全部点校正方向）。
 * 点不共面（例如圆柱侧面那圈顶点）或退化时返回 null——调用方据此明确拒绝，而不是塞一个瞎猜的平面。
 */
export function planeThroughPoints(points: Vector3[], tolerance = 1e-6): SectionPlaneGeometry | null {  if (points.length < 3) return null
  const subtract = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
  const cross = (a: Vector3, b: Vector3): Vector3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
  const dot = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z
  const [first, second, third] = points
  const normal = cross(subtract(second, first), subtract(third, first))
  const length = Math.hypot(normal.x, normal.y, normal.z)
  if (!Number.isFinite(length) || length < 1e-9) return null
  const unit = { x: normal.x / length, y: normal.y / length, z: normal.z / length }
  const constant = -dot(unit, points[0])
  // 判据是各点到平面的**绝对**距离。把容差乘上"点集尺寸"是错的：那样点集越大越松，
  // 圆柱侧面那圈顶点就会被当成一个平面（实测）。
  return points.every((point) => Math.abs(dot(unit, point) + constant) <= tolerance) ? { normal: unit, constant } : null
}

/** Vertex positions of a section source: materialized topology first, template tessellation as fallback. */
function sourceVertices(source: PrimitiveSpec, primitiveMap: Map<string, PrimitiveSpec>): Vector3[] {
  if (source.type === "polyhedron3") return polyhedronSectionTopology(source, primitiveMap)?.vertices ?? []
  if (["cube", "pyramid", "cylinder", "cone"].includes(source.type)) return solidSectionGeometry(source as Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>).vertices
  return []
}

/** Default cutting plane: horizontal through the source's bounding-box center so a new cut is actually visible. */
/** Resolved point-driven topology of one polyhedron, ready for kernel helpers such as unfolding. */
export interface PolyhedronTopology3 {
  vertices: Record<string, Vector3>
  faces: FaceRing3[]
  rootFaceId: string
}

/** Read a polyhedron's stable vertex and face rings, or null when the topology is incomplete. */
export function resolvePolyhedronTopology(document: GeometryDocument, polyhedronId: string): PolyhedronTopology3 | null {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const polyhedron = primitiveMap.get(polyhedronId)
  if (polyhedron?.type !== "polyhedron3") return null
  const vertices: Record<string, Vector3> = {}
  for (const vertexId of polyhedron.vertexIds) {
    const vertex = primitiveMap.get(vertexId)
    if (vertex?.type !== "point3") return null
    vertices[vertexId] = { ...vertex.position }
  }
  const faces: FaceRing3[] = []
  for (const faceId of polyhedron.faceIds) {
    const face = primitiveMap.get(faceId)
    if (face?.type !== "face3" || face.pointIds.length < 3) return null
    if (face.pointIds.some((pointId) => !vertices[pointId])) return null
    faces.push({ id: faceId, pointIds: [...face.pointIds] })
  }
  if (faces.length < 4) return null
  return { vertices, faces, rootFaceId: faces[0].id }
}

/** Resolve the drawable dihedral annotation for a stored dihedral measurement, or null when it cannot be drawn. */
export function resolveDihedralMarker3(document: GeometryDocument, measurementId: string): DihedralMarker3 | null {
  const measurement = document.measurements.find((candidate) => candidate.id === measurementId)
  if (!measurement || measurement.metric !== "dihedral" || measurement.sourceIds.length !== 2) return null
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const faces: Extract<PrimitiveSpec, { type: "face3" }>[] = []
  for (const sourceId of measurement.sourceIds) {
    const source = primitiveMap.get(sourceId)
    if (source?.type !== "face3") return null
    faces.push(source)
  }
  const hinge = sharedRingEdge3(faces[0].pointIds, faces[1].pointIds)
  if (!hinge) return null
  const firstPoints: Vector3[] = []
  const secondPoints: Vector3[] = []
  for (const pointId of faces[0].pointIds) {
    const point = primitiveMap.get(pointId)
    if (point?.type !== "point3") return null
    firstPoints.push({ ...point.position })
  }
  for (const pointId of faces[1].pointIds) {
    const point = primitiveMap.get(pointId)
    if (point?.type !== "point3") return null
    secondPoints.push({ ...point.position })
  }
  const hingeStart = primitiveMap.get(hinge[0])
  const hingeEnd = primitiveMap.get(hinge[1])
  if (hingeStart?.type !== "point3" || hingeEnd?.type !== "point3") return null
  return dihedralMarker3(firstPoints, secondPoints, { ...hingeStart.position }, { ...hingeEnd.position })
}

/** Default cutting plane: the **horizontal** plane (normal +Z, world is Z-up) through the source's
 * bounding-box centre. Returns null when the source vertices cannot be resolved, so callers never
 * persist a fabricated plane. */
export function sectionPlaneThroughSource(document: GeometryDocument, sourceId: string): { normal: Vector3; constant: number } | null {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const source = primitiveMap.get(sourceId)
  const vertices = source ? sourceVertices(source, primitiveMap) : []
  if (vertices.length === 0) return null
  const heights = vertices.map((vertex) => vertex.z)
  return { normal: { x: 0, y: 0, z: 1 }, constant: -(Math.min(...heights) + Math.max(...heights)) / 2 }
}
