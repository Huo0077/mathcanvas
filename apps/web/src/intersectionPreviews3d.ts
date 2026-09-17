import type { GeometryDocument, PrimitiveSpec, Vector3 } from "@draw/dsl"
import { intersectConvexPolyhedra3, intersectFaceSets } from "@draw/geometry-kernel"
import { solidTopology3 } from "@draw/scene-graph"

/**
 * 3D 画布上的自动交线 / 交面预览：**文档里所有两两相交的实体**，而不是"选中两个才有预览"。
 *
 * 用户要的交互与平面画布一致：交线、交点一直在那儿，点一下就把**那个**交线 / 交面创建成独立图元。
 * 所以这里做三件事：
 * 1. 枚举所有**顶层实体**的两两组合（模板物化出来的点/棱/面/多面体不算独立实体，面与平面也不参与——
 *    一个立方体自己有 6 个面，按面两两求交只会刷出一堆噪声）；
 * 2. 用包围盒先筛掉根本不相交的对，再对剩下的算交线（面环求交）与交面（布尔交集）；
 * 3. 按"来源几何签名"缓存每一对的结果：只动了一个实体时，其余对直接沿用上一次的结论。
 *
 * 交线与交面是**两个独立预览**（key 不同、点击创建不同图元）：
 * - `intersection`：两个表面相交的那条线（公共边界）；
 * - `solid`：两个实体公共区域的整体表面（布尔交集）。
 * 完全包含时只有交面（两个表面根本不相交），只贴面时交面是一块面积不为 0 的平板。
 */

export interface IntersectionPreview3d {
  /** 稳定 key：`pair:<a>|<b>:线` / `pair:<a>|<b>:面`，增量同步与点击回传都用它。 */
  key: string
  /**
   * - `intersection`：交线（两个表面的公共边界）；
   * - `face`：**一个**交面（布尔交集的一个平面面片）；
   * - `point`：一个交点（交线的端点 / 拐点）。
   */
  kind: "intersection" | "face" | "point"
  sourceIds: [string, string]
  /** 交线：两个表面的公共边界线段。 */
  segments: { a: Vector3; b: Vector3 }[]
  /** 交面：这一面的有序顶点环（其余种类为空）。 */
  points: Vector3[]
  /** 交面：面法向（朝交集外）、面积，以及"该被建成哪一面"的形心。 */
  normal: Vector3
  area: number
  hint: Vector3
  /** 交点：位置（与 `hint` 相同；分开命名只是为了读起来直白）。 */
  position: Vector3
  classification: string
  label: string
}

interface PairRecord {
  signature: string
  previews: IntersectionPreview3d[]
  /**
   * 这一对的交面没画全（配额用尽，或面数超过单对上限）。
   *
   * 受限结果**不算完整结果**：不能按签名长期沿用，否则配额腾出来之后它也永远补不上交面
   *（实测：13 对挤掉第 13 对后，删掉前面任一对也回不来，除非移动它的来源）。
   */
  truncated: boolean
}

export interface IntersectionPreview3dCache {
  pairs: Record<string, PairRecord>
}

export interface IntersectionPreview3dOptions {
  /** 上一次的结果（增量基准）。 */
  previous?: IntersectionPreview3dCache
  /** 参与求交的顶层实体上限（超出按文档顺序截断）。 */
  maxSources?: number
  /** 单次扫描最多算多少**对**来源的布尔交集（交线不受此限；交面按面展开，这一步最贵）。 */
  maxBooleanPairs?: number
  /** 单对来源最多画多少个面（圆柱/圆锥的交集是按多边形近似的，面可能很多）。 */
  maxFacesPerPair?: number
  /** 单对来源最多画多少个交点（一圈多边形的拐点）。 */
  maxPointsPerPair?: number
}

export interface IntersectionPreview3dSweep {
  previews: IntersectionPreview3d[]
  cache: IntersectionPreview3dCache
  /** 参与求交的顶层实体数。 */
  candidates: number
  /** 本次真正算过的实体对数。 */
  computedPairs: number
  /** 直接从缓存沿用的实体对数。 */
  reusedPairs: number
  /** 被包围盒筛掉的对数。 */
  skippedPairs: number
  /** 交面没算 / 没画全的对数（每次扫描都会重新报）。 */
  truncatedPairs: number
  /** 实体对多到超过单次扫描上限、连交线都没算的对数。 */
  droppedPairs: number
  /** 因为单对上限没画出来的交点数。 */
  truncatedPoints: number
}

const CANDIDATE_TYPES = new Set<PrimitiveSpec["type"]>(["cube", "pyramid", "cylinder", "cone", "polyhedron3"])
const DEFAULT_MAX_SOURCES = 24
/** 单次扫描的布尔交集配额（状态栏的说明文案也用这个数，所以导出而不是各写一份）。 */
export const DEFAULT_MAX_BOOLEAN_PAIRS = 12
/** 单对来源的面 / 交点上限：圆柱与圆锥的交集是按多边形近似的，48 段时面数约 56–98，得留出余量。 */
export const DEFAULT_MAX_FACES_PER_PAIR = 96
export const DEFAULT_MAX_POINTS_PER_PAIR = 64
/** 实体多到两两组合失控时的硬上限：宁可少画，不要一次改动卡住画布。 */
export const MAX_PAIRS = 120

/** 顶层实体：可见、类型可求交，且不是模板物化出来的"影子"多面体。 */
function isCandidate(primitive: PrimitiveSpec): boolean {
  if (primitive.visible === false) return false
  if (!CANDIDATE_TYPES.has(primitive.type)) return false
  if (primitive.type === "polyhedron3" && primitive.construction?.kind === "template") return false
  return true
}

interface Bounds {
  min: Vector3
  max: Vector3
}

function boundsOf(vertices: Vector3[]): Bounds | null {
  if (vertices.length === 0) return null
  return vertices.reduce<Bounds>((bounds, vertex) => ({
    min: { x: Math.min(bounds.min.x, vertex.x), y: Math.min(bounds.min.y, vertex.y), z: Math.min(bounds.min.z, vertex.z) },
    max: { x: Math.max(bounds.max.x, vertex.x), y: Math.max(bounds.max.y, vertex.y), z: Math.max(bounds.max.z, vertex.z) }
  }), { min: { ...vertices[0] }, max: { ...vertices[0] } })
}

/** 包围盒是否相交（留一点容差：正好贴面的一对也算候选，它的交面是一块平板）。 */
function boxesTouch(first: Bounds, second: Bounds, epsilon: number): boolean {
  return first.min.x - epsilon <= second.max.x && second.min.x - epsilon <= first.max.x
    && first.min.y - epsilon <= second.max.y && second.min.y - epsilon <= first.max.y
    && first.min.z - epsilon <= second.max.z && second.min.z - epsilon <= first.max.z
}

interface Candidate {
  primitive: PrimitiveSpec
  topology: { vertices: Vector3[]; faces: number[][] }
  signature: string
  bounds: Bounds
  rings: Vector3[][]
}

/**
 * 枚举当前文档里所有值得预览的两两交线 / 交面。
 * 给了 `previous` 时按"来源几何签名"增量：签名没变的对直接沿用上一次的结论（包括"这一对没交集"）。
 */
export function computeIntersectionPreviews3d(document: GeometryDocument, options: IntersectionPreview3dOptions = {}): IntersectionPreview3dSweep {
  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  const maxSources = options.maxSources ?? DEFAULT_MAX_SOURCES
  const candidates: Candidate[] = []
  for (const primitive of document.primitives) {
    if (candidates.length >= maxSources) break
    if (!isCandidate(primitive)) continue
    const topology = solidTopology3(primitive, primitiveMap)
    if (!topology) continue
    const bounds = boundsOf(topology.vertices)
    if (!bounds) continue
    candidates.push({
      primitive,
      topology,
      // 签名取**解析后的几何**：来源移动、模板参数变化、点驱动的顶点被拖动，都会体现在这里。
      signature: JSON.stringify(topology),
      bounds,
      rings: topology.faces.map((face) => face.map((index) => topology.vertices[index]))
    })
  }

  const maxBooleanPairs = options.maxBooleanPairs ?? DEFAULT_MAX_BOOLEAN_PAIRS
  const maxFacesPerPair = options.maxFacesPerPair ?? DEFAULT_MAX_FACES_PER_PAIR
  const maxPointsPerPair = options.maxPointsPerPair ?? DEFAULT_MAX_POINTS_PER_PAIR
  const previews: IntersectionPreview3d[] = []
  const pairs: Record<string, PairRecord> = {}
  let computedPairs = 0
  let reusedPairs = 0
  let skippedPairs = 0
  let truncatedPairs = 0
  let droppedPairs = 0
  let truncatedPoints = 0
  let booleanPairs = 0
  let considered = 0
  for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
      const first = candidates[firstIndex]
      const second = candidates[secondIndex]
      const epsilon = Math.max(boundsExtent(first.bounds), boundsExtent(second.bounds)) * 1e-9
      if (!boxesTouch(first.bounds, second.bounds, epsilon)) {
        skippedPairs += 1
        continue
      }
      considered += 1
      const key = `${first.primitive.id < second.primitive.id ? first.primitive.id : second.primitive.id}|${first.primitive.id < second.primitive.id ? second.primitive.id : first.primitive.id}`
      const signature = `${first.signature}‖${second.signature}`
      const cached = options.previous?.pairs[key]
      if (cached && cached.signature === signature && !cached.truncated) {
        previews.push(...cached.previews)
        pairs[key] = cached
        reusedPairs += 1
        // 沿用的交面同样占配额：这样"哪几对分到交面"在多次扫描之间是稳定的，
        // 截断说明也就能每一次扫描都如实报出来（而不是只有首扫可见）。
        if (cached.previews.some((item) => item.kind === "face")) booleanPairs += 1
        continue
      }
      if (considered > MAX_PAIRS) {
        // 连交线都没算：既不缓存，也不混进 `truncatedPairs`（那个计数说的是"交面没画出来"）。
        droppedPairs += 1
        continue
      }
      computedPairs += 1
      const sourceIds: [string, string] = [first.primitive.id, second.primitive.id]
      const pairPreviews: IntersectionPreview3d[] = []
      // 交线：两个表面的公共边界。相交而不穿透（完全包含）时这里是空的，那是对的。
      const crossing = intersectFaceSets(first.rings, second.rings)
      if (crossing.segments.length > 0) {
        pairPreviews.push({
          key: `pair:${key}:线`,
          kind: "intersection",
          sourceIds,
          segments: crossing.segments.map((segment) => ({ a: { ...segment.a }, b: { ...segment.b } })),
          points: [],
          normal: { x: 0, y: 0, z: 0 },
          area: 0,
          hint: { x: 0, y: 0, z: 0 },
          position: { x: 0, y: 0, z: 0 },
          classification: crossing.classification,
          label: `交线 · ${crossing.segments.length} 段`
        })
        /**
         * 交点 = 交线的**端点 / 拐点**（按模型尺度去重后每个都可以单独点一下建出来）。
         * 这里刻意不用布尔交集的顶点：完全包含时两个表面并不相交、交集却有顶点，那不是"交点"。
         */
        const corners = intersectionMarkerPoints(crossing.segments, { maxMarkers: Math.min(MAX_MARKERS_PER_PAIR, maxPointsPerPair) })
        corners.slice(0, maxPointsPerPair).forEach((corner, index) => {
          pairPreviews.push({
            key: `pair:${key}:点${index}`,
            kind: "point",
            sourceIds,
            segments: [],
            points: [],
            normal: { x: 0, y: 0, z: 0 },
            area: 0,
            hint: { ...corner },
            position: { ...corner },
            classification: crossing.classification,
            label: "交点"
          })
        })
        if (corners.length > maxPointsPerPair) truncatedPoints += corners.length - maxPointsPerPair
      }
      /**
       * 交面：布尔交集，**每一面各自是一份可点预览**（用户口径："我需要的交面只是一个表面"）。
       * 配额用尽（或面数超过单对上限）时这一对就算"交面没画全"，并**无条件**记进 `truncatedPairs`——
       * 界面据此说明"还有 N 处交面没画全"；完全包含（没有交线）的那一类同样要说明，否则就是静默少画。
       */
      if (booleanPairs >= maxBooleanPairs) {
        truncatedPairs += 1
        previews.push(...pairPreviews)
        // 受限结果标记成 `truncated`：下次扫描（哪怕几何没变）会重新尝试，配额腾出来就能补上。
        pairs[key] = { signature, previews: pairPreviews, truncated: true }
        continue
      }
      booleanPairs += 1
      const intersection = intersectConvexPolyhedra3(first.topology, second.topology)
      if (intersection.status === "polyhedron" || (intersection.status === "flat" && intersection.area > 0)) {
        const drawnFaces = intersection.faces.slice(0, maxFacesPerPair)
        drawnFaces.forEach((face, index) => {
          const ring = face.map((vertexIndex) => ({ ...intersection.vertices[vertexIndex] }))
          if (ring.length < 3) return
          const hint = centroidOfRing(ring)
          const area = intersection.faceAreas[index] ?? 0
          pairPreviews.push({
            key: `pair:${key}:面${index}`,
            kind: "face",
            sourceIds,
            segments: [],
            points: ring,
            normal: intersection.faceNormals[index] ?? { x: 0, y: 0, z: 0 },
            area,
            hint: { ...hint },
            position: { x: 0, y: 0, z: 0 },
            classification: intersection.status,
            label: `交面 · ${ring.length} 边形（面积 ${area.toFixed(2)}）`
          })
        })
        if (intersection.faces.length > drawnFaces.length) truncatedPairs += 1
      }
      previews.push(...pairPreviews)
      pairs[key] = { signature, previews: pairPreviews, truncated: false }
    }
  }
  return { previews, cache: { pairs }, candidates: candidates.length, computedPairs, reusedPairs, skippedPairs, truncatedPairs, droppedPairs, truncatedPoints }
}

/** 交点标记的默认取法：转折 ≥ 18° 才算角点；一对来源最多标 12 个。 */
export const MARKER_TURN_THRESHOLD_DEGREES = 18
export const MAX_MARKERS_PER_PAIR = 12
/** 光滑交线（没有角点）时沿交线均匀取的标记点数：正是用户要的"四个点"。 */
export const MIN_MARKERS_PER_PAIR = 4

/**
 * 交线折线上"值得标一个交点"的位置。
 *
 * 旧实现把交线折线的**每个顶点**都标成一个交点：立方体↔立方体只是 8 个角（没问题），
 * 但圆柱 / 圆锥这类多边形近似的交线有几十上百个顶点，画布上就糊成一片点标记。
 * 用户口径是"当两个图形相交时…也要突出交线和交点的图元"——要标，但要标得少而有意义：
 *
 * 1. **角点**优先：相邻两段方向变化 ≥ `turnThresholdDegrees` 的顶点（立方体的 8 个角走这条，行为不变）；
 * 2. **悬挂端**（只连一段的顶点）与**分叉点**（连三段以上）也算角点；
 * 3. 一个角点都没有（光滑交线，例如圆柱↔圆柱）时，沿顶点顺序**均匀取 `minimumMarkers` 个点**，
 *    保证曲面相交也能点出交点图元，而不是只剩一条线可点；
 * 4. 结果按 `maxMarkers` 截断（调用方把超出的数量记进 `truncatedPoints`，状态栏如实说明）。
 */
export function intersectionMarkerPoints(
  segments: { a: Vector3; b: Vector3 }[],
  options: { turnThresholdDegrees?: number; minimumMarkers?: number; maxMarkers?: number } = {}
): Vector3[] {
  const threshold = options.turnThresholdDegrees ?? MARKER_TURN_THRESHOLD_DEGREES
  const minimum = Math.max(1, options.minimumMarkers ?? MIN_MARKERS_PER_PAIR)
  const maximum = Math.max(minimum, options.maxMarkers ?? MAX_MARKERS_PER_PAIR)
  if (segments.length === 0) return []

  /** 按模型尺度量化端点，得到无重复的顶点表与邻接表（相邻线段共享端点）。 */
  const extent = segments.reduce((largest, segment) => Math.max(largest, Math.abs(segment.a.x), Math.abs(segment.a.y), Math.abs(segment.a.z), Math.abs(segment.b.x), Math.abs(segment.b.y), Math.abs(segment.b.z)), 1)
  const quantum = Math.max(extent * 1e-9, 1e-12)
  const keyOf = (point: Vector3) => `${Math.round(point.x / quantum)},${Math.round(point.y / quantum)},${Math.round(point.z / quantum)}`
  const vertices = new Map<string, Vector3>()
  const neighbours = new Map<string, Set<string>>()
  const link = (from: string, to: string) => {
    const set = neighbours.get(from) ?? new Set<string>()
    set.add(to)
    neighbours.set(from, set)
  }
  for (const segment of segments) {
    const first = keyOf(segment.a)
    const second = keyOf(segment.b)
    if (first === second) continue
    if (!vertices.has(first)) vertices.set(first, { ...segment.a })
    if (!vertices.has(second)) vertices.set(second, { ...segment.b })
    link(first, second)
    link(second, first)
  }
  if (vertices.size === 0) return []

  const cornerKeys: string[] = []
  for (const [key, adjacent] of neighbours) {
    const list = [...adjacent]
    if (list.length !== 2) {
      // 悬挂端 / 分叉点：一定是"形状变了"的地方，值得标。
      cornerKeys.push(key)
      continue
    }
    const vertex = vertices.get(key)!
    const first = vertices.get(list[0])!
    const second = vertices.get(list[1])!
    const u = normalized({ x: first.x - vertex.x, y: first.y - vertex.y, z: first.z - vertex.z })
    const v = normalized({ x: second.x - vertex.x, y: second.y - vertex.y, z: second.z - vertex.z })
    if (!u || !v) continue
    const dot = Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y + u.z * v.z))
    const turnDegrees = 180 - Math.acos(dot) * 180 / Math.PI
    if (turnDegrees >= threshold) cornerKeys.push(key)
  }

  const cornerMarkers = cornerKeys.map((key) => ({ ...vertices.get(key)! }))
  // 角点够多（立方体一类）：只标角点，行为与旧实现一致。
  if (cornerMarkers.length >= minimum) return cornerMarkers.slice(0, maximum)

  /**
   * 角点不足（光滑或近乎光滑的交线）：补齐到至少 `minimum` 个。
   * 沿邻接顺序走一遍折线再等距取样，取到的是"交线上的点"而不是拐点（状态栏文案据此区分）。
   */
  const ordered: Vector3[] = []
  const visited = new Set<string>()
  for (const startKey of vertices.keys()) {
    if (visited.has(startKey)) continue
    let current: string | undefined = startKey
    while (current !== undefined && !visited.has(current)) {
      visited.add(current)
      ordered.push({ ...vertices.get(current)! })
      current = [...(neighbours.get(current) ?? [])].find((candidate) => !visited.has(candidate))
    }
  }
  if (ordered.length === 0) return cornerMarkers.slice(0, maximum)
  const wanted = Math.min(minimum, ordered.length)
  const stride = ordered.length / wanted
  const sampled = Array.from({ length: wanted }, (_, index) => ({ ...ordered[Math.min(ordered.length - 1, Math.floor(index * stride))] }))

  const merged: Vector3[] = []
  const seen = new Set<string>()
  for (const point of [...cornerMarkers, ...sampled]) {
    const key = keyOf(point)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(point)
  }
  return merged.slice(0, maximum)
}

function normalized(vector: Vector3): Vector3 | null {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  return length > 1e-12 ? { x: vector.x / length, y: vector.y / length, z: vector.z / length } : null
}

function centroidOfRing(points: Vector3[]): Vector3 {
  const count = Math.max(points.length, 1)
  return points.reduce((sum, point) => ({ x: sum.x + point.x / count, y: sum.y + point.y / count, z: sum.z + point.z / count }), { x: 0, y: 0, z: 0 })
}

function boundsExtent(bounds: Bounds): number {
  return Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z)
}
