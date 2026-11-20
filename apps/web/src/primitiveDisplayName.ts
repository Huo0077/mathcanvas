import type { PrimitiveSpec } from "@draw/dsl"

const GENERIC_EDGE_LABEL = /^棱\s*\d+$/
const GENERIC_FACE_LABEL = /^面\s*\d+$/

function pointVertexLabels(pointIds: readonly string[], byId: ReadonlyMap<string, PrimitiveSpec>): string[] {
  return pointIds
    .map((id) => byId.get(id))
    .map((prim) => (prim?.type === "point3" && prim.label && prim.label.trim().length > 0 ? prim.label.trim() : null))
    .filter((label): label is string => Boolean(label))
}

/**
 * 为对象树与宿主下拉生成可读的几何显示名称（不修改底层持久化 label）：
 * - 对匿名或仅编号的棱（如 `棱 1`、`face-1:e0`），附带两端点名（如 `棱 1 · PB`、`边 AB`）
 * - 对匿名或仅编号的面（如 `面 1`），附带顶点环（如 `面 1 · ABCD`）
 * - 对面片子顶点缺省标签（如 `face-2:v0`），显示 `顶点 1` 而非内部 ID
 */
export function formatPrimitiveDisplayLabel(
  primitive: PrimitiveSpec,
  byId: ReadonlyMap<string, PrimitiveSpec>
): string {
  const raw = primitive.label?.trim()
  if (primitive.type === "edge3") {
    const verts = pointVertexLabels(primitive.pointIds, byId)
    const pair = verts.length === 2 ? verts.join("") : ""
    if (!raw) return pair ? `边 ${pair}` : primitive.id.replace(/^.*:e(\d+)$/, (_, n) => `边 ${Number(n) + 1}`)
    if (pair && GENERIC_EDGE_LABEL.test(raw) && !raw.includes(pair)) return `${raw} · ${pair}`
    return raw
  }
  if (primitive.type === "face3") {
    const verts = pointVertexLabels(primitive.pointIds, byId)
    const ring = verts.length >= 3 ? verts.join("") : ""
    if (!raw) return ring ? `面 ${ring}` : primitive.id
    if (ring && GENERIC_FACE_LABEL.test(raw) && !raw.includes(ring)) return `${raw} · ${ring}`
    return raw
  }
  if (primitive.type === "point3" && !raw) {
    const match = /:v(\d+)$/.exec(primitive.id)
    if (match) return `顶点 ${Number(match[1]) + 1}`
  }
  return raw || primitive.id
}
