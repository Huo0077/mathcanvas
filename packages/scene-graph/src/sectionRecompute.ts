import type { PrimitiveSpec, Vector3 } from "@draw/dsl"
import { intersectConvexPolyhedra3, intersectFaceSets, mergeIntersectionSurfaces3, orderSectionPoints3, quadric3FromPrimitive, sectionConvexPolyhedron, sectionPolyhedron3, sectionQuadric3, type Conic3Kind, type IntersectionSurfaceRegion, type CurvePiece3 } from "@draw/geometry-kernel"
import { classifySectionPoints, polyhedronSectionTopology, solidSectionGeometry, templateTopology } from "./solidGeometry"

/**
 * **截面与交的重算**（从 `operations.ts` 拆出，评审方案 2）。
 *
 * 三件事：截面（含**解析边界**：源是圆柱 / 圆锥时给出精确的圆锥曲线片段环，写进 `section.exact`）、
 * 交线 / 交体、以及交面图元（布尔交集的**一个区域**，按支撑曲面分组后的一块）。
 *
 * 两条用户口径随代码搬走：
 * 1. **"我需要的交面只是一个表面，而不是所有相交的表面"** —— 分组之前布尔交集把圆柱侧面切成 48 个
 *    细条，"点一块建一块"点出来的永远是一个小片；分组之后一块区域就是**一个表面**；
 * 2. **平面 / 棱锥这类多边形来源不需要解析层**：它们的边界本来就是多边形，精确的，
 *    解析边界只对二次曲面来源有意义。
 */

/**
 * 解析截面边界：源是圆柱 / 圆锥时给出**精确**圆锥曲线片段环（写进 `section.exact`）。
 *
 * 其余来源（立方体 / 棱锥 / 点驱动多面体）返回 `undefined`：它们的边界本来就是多边形，精确的，
 * 多边形路径就是答案，不需要解析层。
 */
export function analyticSectionBoundary(source: PrimitiveSpec, plane: { normal: Vector3; constant: number }): { kind: Conic3Kind; loops: CurvePiece3[][] } | undefined {
  const quadric = quadric3FromPrimitive(source)
  if (!quadric) return undefined
  return sectionQuadric3(quadric, plane) ?? undefined
}

/** 边界是弯曲的（圆 / 椭圆 / 抛物线 / 双曲线）才算真的精确；直线与点走多边形路径本来就是精确的。 */
export const curvedConicKinds = new Set<Conic3Kind>(["circle", "ellipse", "parabola", "hyperbola"])

export function attachExactBoundary(section: Extract<PrimitiveSpec, { type: "section" }>, exact: { kind: Conic3Kind; loops: CurvePiece3[][] } | undefined): Extract<PrimitiveSpec, { type: "section" }> {
  if (exact) return { ...section, exact, status: curvedConicKinds.has(exact.kind) ? "exact" : section.status }
  // 来源不再是圆柱 / 圆锥时要把旧字段摘掉，否则会留下一份和现几何对不上的解析边界。
  const { exact: _stale, ...rest } = section
  return rest
}

export function recomputeSection(primitive: Extract<PrimitiveSpec, { type: "section" }>, source: PrimitiveSpec, primitiveMap: Map<string, PrimitiveSpec>): Extract<PrimitiveSpec, { type: "section" }> {
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
export function recomputeIntersectionLine(
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
export function recomputeIntersectionSolid(
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

export function resolveSolidIntersection(sources: (PrimitiveSpec | undefined)[], primitiveMap: Map<string, PrimitiveSpec>): SolidIntersectionOutcome {
  if (sources.some((source) => !source)) return { ok: false, explanation: "来源对象不存在。", diagnostics: [] }
  const topologies = sources.map((source) => solidTopology3(source!, primitiveMap))
  if (topologies.some((topology) => !topology)) return { ok: false, explanation: "来源必须是实体（立方体 / 棱锥 / 圆柱 / 圆锥 / 多面体）：面与平面没有体积。", diagnostics: [] }
  const result = intersectConvexPolyhedra3(topologies[0]!, topologies[1]!)
  if (result.status === "insufficient-data") return { ok: false, explanation: result.explanation, diagnostics: result.diagnostics }
  return { ok: true, result }
}

export function explainOutcome(outcome: Extract<SolidIntersectionOutcome, { ok: false }>): string {
  return [outcome.explanation, ...outcome.diagnostics].filter(Boolean).join(" ")
}

export function solidTopology3(source: PrimitiveSpec, primitiveMap: Map<string, PrimitiveSpec>): { vertices: Vector3[]; faces: number[][] } | null {
  const polyhedron = source.type === "polyhedron3" ? source : templateTopology(source.id, primitiveMap)
  if (!polyhedron) return null
  return polyhedronSectionTopology(polyhedron, primitiveMap)
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
export function recomputeIntersectionFace(
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
export function recomputeIntersectionPoint3(
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
export function dedupePoints3(points: Vector3[]): Vector3[] {
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

export function centroidOfPoints(points: Vector3[]): Vector3 {
  const count = Math.max(points.length, 1)
  return points.reduce((sum, point) => ({ x: sum.x + point.x / count, y: sum.y + point.y / count, z: sum.z + point.z / count }), { x: 0, y: 0, z: 0 })
}

export function extentOf(points: Vector3[]): number {
  let extent = 0
  for (const point of points) extent = Math.max(extent, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z))
  return Math.max(extent, 1)
}

export function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}

export function dotBetween(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}
