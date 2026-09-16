import type { GeometryDocument, PrimitiveSpec, Vector3 } from "@draw/dsl"
import { intersectFaceSets, sectionPolyhedron3 } from "@draw/geometry-kernel"
import { intersectionFaceRings, resolvePolyhedronTopology, sectionPlaneThroughSource } from "@draw/scene-graph"

export interface PreviewSegment {
  a: Vector3
  b: Vector3
}

/**
 * 虚线预览的解析结果。
 * `kind` 决定画布怎么画与状态栏怎么说：
 * - `intersection`：两个对象的面交线（真实交线）；
 * - `section`：单个实体的默认剖切平面截面（既有语义）；
 * - `none`：没有可预览内容；`insufficient`：条件不足，`reason` 说明原因。
 */
export interface IntersectionPreview {
  kind: "intersection" | "section" | "none" | "insufficient"
  /** 预览涉及的对象 ID（点击创建时的来源）。 */
  sourceIds: string[]
  segments: PreviewSegment[]
  /** 单个实体的截面：按既有 `section` 语义给出有序边界点。 */
  points: Vector3[]
  classification: string
  label: string
  reason?: string
  /**
   * 截面预览的剖切面与来源实体。只有边界点时画布上只看到一条交线，看不出"切在哪"；
   * 画布据此再画一块半透明剖切面片，也据此让"拖动截面 = 沿法向挪刀口"成立。
   */
  plane?: { normal: Vector3; constant: number }
  sourceId?: string
}

const SOLID_TYPES = ["cube", "pyramid", "cylinder", "cone", "polyhedron3"]
const PREVIEWABLE = [...SOLID_TYPES, "face3"]

/** 该对象能不能参与交线预览（实体 / 多面体 / 面）。平面没有边界，不参与。 */
export function canPreviewIntersection(primitive: PrimitiveSpec | null | undefined): boolean {
  return Boolean(primitive && PREVIEWABLE.includes(primitive.type))
}

/**
 * 已选中对象 → 预览内容。
 * - 恰好两个可交对象：求它们的面交线（与点击创建走同一套内核，因此"看到的"就是"会建出来的"）；
 * - 恰好一个实体：给默认剖切平面截面；
 * - 其它情况：`none`，由调用方决定是否提示。
 */
export function resolveIntersectionPreview(document: GeometryDocument, selectedIds: string[]): IntersectionPreview {
  const empty: IntersectionPreview = { kind: "none", sourceIds: [], segments: [], points: [], classification: "none", label: "" }
  const selected = selectedIds
    .map((id) => document.primitives.find((primitive) => primitive.id === id))
    .filter((primitive): primitive is PrimitiveSpec => Boolean(primitive))
  if (selected.length === 0 || selected.length > 2) return empty

  const primitiveMap = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
  if (selected.length === 2) {
    const [first, second] = selected
    if (!canPreviewIntersection(first) || !canPreviewIntersection(second)) {
      return { ...empty, kind: "insufficient", sourceIds: [first.id, second.id], reason: "只有实体、多面体或面之间才有可确定的交线；平面没有边界，不能作为有界交线的来源。" }
    }
    const firstRings = intersectionFaceRings(first, primitiveMap)
    const secondRings = intersectionFaceRings(second, primitiveMap)
    if (!firstRings || !secondRings) {
      return { ...empty, kind: "insufficient", sourceIds: [first.id, second.id], reason: "来源缺少可用的面环（平面没有边界，模板需要已物化的拓扑）。" }
    }
    const result = intersectFaceSets(firstRings, secondRings)
    if (result.classification === "none" || result.classification === "insufficient-data") {
      return { ...empty, kind: "insufficient", sourceIds: [first.id, second.id], classification: result.classification, reason: [result.explanation, ...result.diagnostics].filter(Boolean).join(" ") }
    }
    return {
      kind: "intersection",
      sourceIds: [first.id, second.id],
      segments: result.segments,
      points: [],
      classification: result.classification,
      label: result.classification === "segment" ? "面交线 · 1 段" : `面交线 · ${result.segments.length} 段`,
      reason: result.diagnostics.length > 0 ? result.diagnostics.join(" ") : undefined
    }
  }

  // 单个实体：默认剖切平面截面，沿用既有语义。
  const single = selected[0]
  if (!SOLID_TYPES.includes(single.type)) return empty
  const plane = sectionPlaneThroughSource(document, single.id)
  if (!plane) return { ...empty, kind: "insufficient", sourceIds: [single.id], reason: "无法从该实体推导默认剖切平面。" }
  const resolved = single.type === "polyhedron3" ? resolvePolyhedronTopology(document, single.id) : null
  const topology = resolved ? toIndexedTopology(resolved) : resolveTemplateTopology(document, single)
  if (!topology) return { ...empty, kind: "insufficient", sourceIds: [single.id], reason: "该实体还没有物化拓扑，先创建一次再剖切。" }
  const result = sectionPolyhedron3(topology.vertices, topology.faces, plane)
  if (result.status === "none" || result.status === "insufficient-data") {
    return { ...empty, kind: "insufficient", sourceIds: [single.id], classification: result.status, reason: result.explanation }
  }
  return {
    kind: "section",
    sourceIds: [single.id],
    segments: [],
    points: result.points,
    classification: result.status,
    label: result.status === "point" ? "默认剖切平面截面 · 1 点" : result.status === "segment" ? "默认剖切平面截面 · 1 段" : `默认剖切平面截面 · ${result.points.length} 边形`,
    // The boundary alone does not say where the cut is; the plane is what the canvas draws as a patch.
    plane,
    sourceId: single.id
  }
}

/** 场景图的拓扑（顶点按 ID 索引、面环按点 ID）转成内核求交需要的数组形式。 */
function toIndexedTopology(topology: { vertices: Record<string, Vector3>; faces: { pointIds: string[] }[] }): { vertices: Vector3[]; faces: number[][] } {
  const vertexIds = Object.keys(topology.vertices)
  const indexOf = new Map(vertexIds.map((id, index) => [id, index]))
  const vertices = vertexIds.map((id) => topology.vertices[id])
  const faces: number[][] = []
  for (const face of topology.faces) {
    const ring = face.pointIds.map((id) => indexOf.get(id) ?? -1)
    if (ring.length < 3 || ring.some((index) => index < 0)) continue
    faces.push(ring)
  }
  return { vertices, faces }
}

/** 模板实体的物化拓扑（`construction.kind === "template"` 指向该来源）：找不到返回 null。 */
function resolveTemplateTopology(document: GeometryDocument, source: PrimitiveSpec): { vertices: Vector3[]; faces: number[][] } | null {
  const polyhedron = document.primitives.find((primitive) =>
    primitive.type === "polyhedron3" && primitive.construction?.kind === "template" && primitive.construction.sourceIds[0] === source.id)
  if (!polyhedron || polyhedron.type !== "polyhedron3") return null
  const resolved = resolvePolyhedronTopology(document, polyhedron.id)
  return resolved ? toIndexedTopology(resolved) : null
}
