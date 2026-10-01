import type { PrimitiveSpec } from "@draw/dsl"
import { areCoplanar } from "@draw/geometry-kernel"

type Solid = Extract<PrimitiveSpec, { type: "polyhedron3" }>
type Face = Extract<PrimitiveSpec, { type: "face3" }>
type Edge = Extract<PrimitiveSpec, { type: "edge3" }>
type Point = Extract<PrimitiveSpec, { type: "point3" }>

const pairKey = (first: string, second: string) => first < second ? `${first}|${second}` : `${second}|${first}`

/** Keep the existing face id for its first triangle so external references do not dangle. */
export function triangulateWarpedSolidFaces(primitives: PrimitiveSpec[], movedVertexId: string): string | null {
  const solids = primitives.filter((primitive): primitive is Solid => primitive.type === "polyhedron3" && primitive.vertexIds.includes(movedVertexId))
  if (solids.length === 0) return null
  const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  const moved = byId.get(movedVertexId)
  if (moved?.type !== "point3") return `solid vertex ${movedVertexId} is missing`
  for (const solid of solids) {
    for (const otherId of solid.vertexIds) {
      if (otherId === movedVertexId) continue
      const other = byId.get(otherId)
      if (other?.type === "point3" && other.position.x === moved.position.x && other.position.y === moved.position.y && other.position.z === moved.position.z) {
        return `solid vertex overlaps another vertex: ${movedVertexId} and ${otherId}`
      }
    }
  }
  const faceIds = new Set(solids.flatMap((solid) => solid.faceIds))
  const allocateId = (stem: string) => {
    let id = stem
    for (let suffix = 1; byId.has(id); suffix += 1) id = `${stem}:${suffix}`
    return id
  }

  for (const faceId of faceIds) {
    const face = byId.get(faceId)
    if (face?.type !== "face3" || face.pointIds.length < 4 || !face.pointIds.includes(movedVertexId)) continue
    const positions = face.pointIds.map((id) => byId.get(id))
    if (!positions.every((point): point is Point => point?.type === "point3")) return `face ${face.id} references a missing vertex`
    if (areCoplanar(positions.map((point) => point.position))) continue
    if (!face.edgeIds || face.edgeIds.length !== face.pointIds.length) return `face ${face.id} has no closed edge boundary`

    const boundary = new Map<string, Edge>()
    for (const edgeId of face.edgeIds) {
      const edge = byId.get(edgeId)
      if (edge?.type !== "edge3") return `face ${face.id} references a missing edge`
      boundary.set(pairKey(edge.pointIds[0], edge.pointIds[1]), edge)
    }
    const pivot = face.pointIds.indexOf(movedVertexId)
    const ring = [...face.pointIds.slice(pivot), ...face.pointIds.slice(0, pivot)]
    const additions: PrimitiveSpec[] = []
    const diagonals = new Map<string, Edge>()
    const triangles: Face[] = []
    for (let index = 1; index < ring.length - 1; index += 1) {
      const points = [ring[0], ring[index], ring[index + 1]]
      const id = index === 1 ? face.id : allocateId(`${face.id}:triangle:${index}`)
      const triangleEdges: string[] = []
      for (let side = 0; side < 3; side += 1) {
        const key = pairKey(points[side], points[(side + 1) % 3])
        let edge = boundary.get(key) ?? diagonals.get(key)
        if (!edge) {
          const edgeId = allocateId(`${face.id}:diagonal:${diagonals.size + 1}`)
          edge = { id: edgeId, type: "edge3", pointIds: [points[side], points[(side + 1) % 3]], faceIds: [], tessellation: true }
          diagonals.set(key, edge)
          byId.set(edgeId, edge)
          additions.push(edge)
        }
        triangleEdges.push(edge.id)
      }
      const triangle: Face = {
        ...face, id, pointIds: points, edgeIds: triangleEdges,
        ...(index > 1 ? { label: `${face.label ?? face.id} · 三角片 ${index}` } : {})
      }
      triangles.push(triangle)
      if (index > 1) {
        byId.set(id, triangle) // Reserve this id and make the new face discoverable by the next step.
        additions.push(triangle)
      }
    }

    for (const edge of boundary.values()) edge.faceIds = (edge.faceIds ?? []).filter((id) => id !== face.id)
    for (const triangle of triangles) {
      for (const edgeId of triangle.edgeIds ?? []) {
        const edge = byId.get(edgeId)
        if (edge?.type === "edge3" && !edge.faceIds?.includes(triangle.id)) edge.faceIds = [...(edge.faceIds ?? []), triangle.id]
      }
    }
    face.pointIds = triangles[0].pointIds
    face.edgeIds = triangles[0].edgeIds
    primitives.push(...additions)
    for (const solid of primitives) {
      if (solid.type !== "polyhedron3" || !solid.faceIds.includes(face.id)) continue
      solid.faceIds = solid.faceIds.flatMap((id) => id === face.id ? triangles.map((triangle) => triangle.id) : [id])
      for (const edge of diagonals.values()) if (!solid.edgeIds.includes(edge.id)) solid.edgeIds.push(edge.id)
      if (solid.construction?.kind === "fromFaces") solid.construction.sourceIds = [...solid.faceIds]
    }
  }
  return null
}
