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
  kind: "intersection" | "solid"
  sourceIds: [string, string]
  /** 交线：两个表面的公共边界线段。 */
  segments: { a: Vector3; b: Vector3 }[]
  /** 交面：布尔交集的顶点与面环（`kind === "solid"` 时非空）。 */
  vertices: Vector3[]
  faces: number[][]
  volume: number
  area: number
  classification: string
  label: string
}

interface PairRecord {
  signature: string
  previews: IntersectionPreview3d[]
}

export interface IntersectionPreview3dCache {
  pairs: Record<string, PairRecord>
}

export interface IntersectionPreview3dOptions {
  /** 上一次的结果（增量基准）。 */
  previous?: IntersectionPreview3dCache
  /** 参与求交的顶层实体上限（超出按文档顺序截断）。 */
  maxSources?: number
  /** 单次扫描最多算多少个布尔交集（交线不受此限）。 */
  maxSolidPreviews?: number
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
  /** 因为布尔交集配额被跳过、只给了交线的对数。 */
  truncatedPairs: number
}

const CANDIDATE_TYPES = new Set<PrimitiveSpec["type"]>(["cube", "pyramid", "cylinder", "cone", "polyhedron3"])
const DEFAULT_MAX_SOURCES = 24
const DEFAULT_MAX_SOLID_PREVIEWS = 12
/** 实体多到两两组合失控时的硬上限：宁可少画，不要一次改动卡住画布。 */
const MAX_PAIRS = 120

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
  const maxSolidPreviews = options.maxSolidPreviews ?? DEFAULT_MAX_SOLID_PREVIEWS
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

  const previews: IntersectionPreview3d[] = []
  const pairs: Record<string, PairRecord> = {}
  let computedPairs = 0
  let reusedPairs = 0
  let skippedPairs = 0
  let truncatedPairs = 0
  let solidPreviews = 0
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
      if (cached && cached.signature === signature) {
        previews.push(...cached.previews)
        pairs[key] = cached
        reusedPairs += 1
        continue
      }
      computedPairs += 1
      if (considered > MAX_PAIRS) {
        truncatedPairs += 1
        pairs[key] = { signature, previews: [] }
        continue
      }
      const pairPreviews: IntersectionPreview3d[] = []
      // 交线：两个表面的公共边界。相交而不穿透（完全包含）时这里是空的，那是对的。
      const crossing = intersectFaceSets(first.rings, second.rings)
      if (crossing.segments.length > 0) {
        pairPreviews.push({
          key: `pair:${key}:线`,
          kind: "intersection",
          sourceIds: [first.primitive.id, second.primitive.id],
          segments: crossing.segments.map((segment) => ({ a: { ...segment.a }, b: { ...segment.b } })),
          vertices: [],
          faces: [],
          volume: 0,
          area: 0,
          classification: crossing.classification,
          label: `交线 · ${crossing.segments.length} 段`
        })
      }
      // 交面：布尔交集。配额用尽时只保留交线，并记进 `truncatedPairs`，界面据此说明"还有 N 对没画交面"。
      if (solidPreviews >= maxSolidPreviews) {
        if (crossing.segments.length > 0) truncatedPairs += 1
      } else {
        const intersection = intersectConvexPolyhedra3(first.topology, second.topology)
        if (intersection.status === "polyhedron" || (intersection.status === "flat" && intersection.area > 0)) {
          solidPreviews += 1
          pairPreviews.push({
            key: `pair:${key}:面`,
            kind: "solid",
            sourceIds: [first.primitive.id, second.primitive.id],
            segments: [],
            vertices: intersection.vertices.map((vertex) => ({ ...vertex })),
            faces: intersection.faces.map((face) => [...face]),
            volume: intersection.volume,
            area: intersection.area,
            classification: intersection.status,
            label: intersection.status === "flat" ? `交面 · 平板（面积 ${intersection.area.toFixed(2)}）` : `交面 · ${intersection.faces.length} 面`
          })
        }
      }
      previews.push(...pairPreviews)
      pairs[key] = { signature, previews: pairPreviews }
    }
  }
  return { previews, cache: { pairs }, candidates: candidates.length, computedPairs, reusedPairs, skippedPairs, truncatedPairs }
}

function boundsExtent(bounds: Bounds): number {
  return Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z)
}
