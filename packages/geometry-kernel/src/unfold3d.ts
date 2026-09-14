import type { Vector3 } from "./geometry3d"
import { addVector3, crossVector3, dotVector3, lengthVector3, normalizeVector3, scaleVector3, subtractVector3 } from "./geometry3d"

/** Closed face ring referencing vertex ids. */
export interface FaceRing3 {
  id: string
  pointIds: string[]
}

export interface UnfoldFace3 {
  faceId: string
  pointIds: string[]
  /** Face ring in world coordinates at the requested fold progress; progress 1 lies in the root face plane. */
  positions: Vector3[]
  parentFaceId?: string
  /** Shared edge (in the parent ring direction) this face was unfolded around. */
  hingePointIds?: [string, string]
}

export interface UnfoldLayout3 {
  rootFaceId: string
  faces: UnfoldFace3[]
  diagnostics: string[]
  status: "ok" | "insufficient-data"
}

export interface UnfoldFace2 {
  faceId: string
  points: { x: number; y: number }[]
}

const EPSILON = 1e-9

interface HingeStep {
  origin: Vector3
  axis: Vector3
  angle: number
}

function edgeKey(first: string, second: string): string {
  return first < second ? `${first}|${second}` : `${second}|${first}`
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function ringNormal(points: Vector3[]): Vector3 | null {
  if (points.length < 3) return null
  const normal = crossVector3(subtractVector3(points[1], points[0]), subtractVector3(points[2], points[0]))
  return lengthVector3(normal) > EPSILON ? normalizeVector3(normal) : null
}

/** Rodrigues rotation of `point` around the axis through `origin`; the shared hinge stays fixed by construction. */
function rotateAboutAxis(point: Vector3, origin: Vector3, axis: Vector3, angle: number): Vector3 {
  if (Math.abs(angle) <= EPSILON) return point
  const offset = subtractVector3(point, origin)
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const parallel = scaleVector3(axis, dotVector3(offset, axis))
  const perpendicular = subtractVector3(offset, parallel)
  const rotated = addVector3(scaleVector3(perpendicular, cosine), scaleVector3(crossVector3(axis, perpendicular), sine))
  return addVector3(origin, addVector3(parallel, rotated))
}

function applySteps(point: Vector3, steps: HingeStep[]): Vector3 {
  return steps.reduce((current, step) => rotateAboutAxis(current, step.origin, step.axis, step.angle), point)
}

function projectRange(points: { x: number; y: number }[], axis: { x: number; y: number }): { min: number; max: number } {
  const values = points.map((point) => point.x * axis.x + point.y * axis.y)
  return { min: Math.min(...values), max: Math.max(...values) }
}

function centroid(points: Vector3[]): Vector3 {
  return points.reduce((sum, point) => addVector3(sum, { x: point.x / points.length, y: point.y / points.length, z: point.z / points.length }), { x: 0, y: 0, z: 0 })
}

function perpendicularOffset(point: Vector3, origin: Vector3, axis: Vector3): Vector3 {
  const offset = subtractVector3(point, origin)
  return subtractVector3(offset, scaleVector3(axis, dotVector3(offset, axis)))
}

/**
 * Rotation that flattens a child face into its parent plane. Both hinge rotations by `θ` and `θ + π` flatten the
 * face, so the side is chosen geometrically: an unfolded net always lays the child on the far side of the hinge
 * from the parent body. This keeps the result independent of the ring winding order.
 */
function flatteningAngle(parentPositions: Vector3[], childPositions: Vector3[], origin: Vector3, axis: Vector3): number {
  const parentNormal = ringNormal(parentPositions)
  const childNormal = ringNormal(childPositions)
  if (!parentNormal || !childNormal) return 0
  const flatten = Math.atan2(dotVector3(crossVector3(childNormal, parentNormal), axis), dotVector3(childNormal, parentNormal))
  const parentOffset = perpendicularOffset(centroid(parentPositions), origin, axis)
  const childOffset = perpendicularOffset(centroid(childPositions), origin, axis)
  const rotatedChild = rotateAboutAxis(addVector3(origin, childOffset), origin, axis, flatten)
  const angle = dotVector3(subtractVector3(rotatedChild, origin), parentOffset) > 0 ? flatten + Math.PI : flatten
  if (angle > Math.PI) return angle - Math.PI * 2
  if (angle < -Math.PI) return angle + Math.PI * 2
  return angle
}

/** Separating-axis test for convex rings; faces that merely share an edge are not reported as overlapping. */
function ringsOverlap(first: { x: number; y: number }[], second: { x: number; y: number }[], tolerance = 1e-6): boolean {
  for (const ring of [first, second]) {
    for (let index = 0; index < ring.length; index += 1) {
      const start = ring[index]
      const end = ring[(index + 1) % ring.length]
      const length = Math.hypot(end.x - start.x, end.y - start.y)
      if (length <= EPSILON) continue
      const axis = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length }
      const firstRange = projectRange(first, axis)
      const secondRange = projectRange(second, axis)
      if (Math.min(firstRange.max, secondRange.max) - Math.max(firstRange.min, secondRange.min) <= tolerance) return false
    }
  }
  return true
}

/** Report every pair of coplanar faces whose unfolded rings share area. */
export function detectUnfoldOverlaps(faces: UnfoldFace2[]): [string, string][] {
  const overlaps: [string, string][] = []
  for (let first = 0; first < faces.length; first += 1) {
    for (let second = first + 1; second < faces.length; second += 1) {
      if (ringsOverlap(faces[first].points, faces[second].points)) overlaps.push([faces[first].faceId, faces[second].faceId])
    }
  }
  return overlaps
}

function projectOntoPlane(point: Vector3, origin: Vector3, firstAxis: Vector3, secondAxis: Vector3): { x: number; y: number } {
  const offset = subtractVector3(point, origin)
  return { x: dotVector3(offset, firstAxis), y: dotVector3(offset, secondAxis) }
}

/**
 * Unfold a closed polyhedron into the plane of a root face by walking shared-edge adjacency and rotating every
 * face around its hinge. Progress 1 is the flat net, 0 is the original folded pose; intermediate values give a
 * continuous folding animation. Structural problems and net overlaps are reported instead of guessed.
 */
export function unfoldPolyhedron3(vertices: Record<string, Vector3>, faces: FaceRing3[], progress = 1, rootFaceId?: string): UnfoldLayout3 {
  const diagnostics: string[] = []
  const fallbackRoot = rootFaceId ?? faces[0]?.id ?? ""
  for (const face of faces) {
    const missing = face.pointIds.filter((id) => !vertices[id])
    if (missing.length > 0) diagnostics.push(`面 ${face.id} 引用了不存在的顶点：${missing.join("、")}`)
    if (face.pointIds.length < 3) diagnostics.push(`面 ${face.id} 的顶点不足 3 个。`)
  }
  if (diagnostics.length > 0) return { rootFaceId: fallbackRoot, faces: [], diagnostics, status: "insufficient-data" }
  if (faces.length < 4) return { rootFaceId: fallbackRoot, faces: [], diagnostics: ["展开需要至少 4 个闭合面。"], status: "insufficient-data" }

  const edgeFaces = new Map<string, number[]>()
  faces.forEach((face, index) => face.pointIds.forEach((id, position) => {
    const key = edgeKey(id, face.pointIds[(position + 1) % face.pointIds.length])
    edgeFaces.set(key, [...(edgeFaces.get(key) ?? []), index])
  }))
  const openEdges = [...edgeFaces.values()].filter((indexes) => indexes.length !== 2).length
  if (openEdges > 0) return { rootFaceId: fallbackRoot, faces: [], diagnostics: [`拓扑不是闭合多面体：${openEdges} 条棱没有恰好两个相邻面。`], status: "insufficient-data" }

  const rootIndex = Math.max(0, faces.findIndex((face) => face.id === fallbackRoot))
  const root = faces[rootIndex]
  const stepsByFace = new Map<number, HingeStep[]>([[rootIndex, []]])
  const parentByFace = new Map<number, { parent: number; hinge: [string, string] }>()
  const visited = new Set<number>([rootIndex])
  const queue: number[] = [rootIndex]
  const fold = clamp01(progress)

  while (queue.length > 0) {
    const current = queue.shift()!
    const currentSteps = stepsByFace.get(current) ?? []
    const currentFace = faces[current]
    for (let position = 0; position < currentFace.pointIds.length; position += 1) {
      const id = currentFace.pointIds[position]
      const nextId = currentFace.pointIds[(position + 1) % currentFace.pointIds.length]
      for (const neighbour of edgeFaces.get(edgeKey(id, nextId)) ?? []) {
        if (neighbour === current || visited.has(neighbour)) continue
        const origin = applySteps(vertices[id], currentSteps)
        const axisVector = subtractVector3(applySteps(vertices[nextId], currentSteps), origin)
        if (lengthVector3(axisVector) <= EPSILON) {
          diagnostics.push(`面 ${faces[neighbour].id} 的铰链棱退化。`)
          visited.add(neighbour)
          continue
        }
        const axis = normalizeVector3(axisVector)
        const parentPositions = currentFace.pointIds.map((pointId) => applySteps(vertices[pointId], currentSteps))
        const childPositions = faces[neighbour].pointIds.map((pointId) => applySteps(vertices[pointId], currentSteps))
        const angle = flatteningAngle(parentPositions, childPositions, origin, axis)
        visited.add(neighbour)
        stepsByFace.set(neighbour, [...currentSteps, { origin, axis, angle: angle * fold }])
        parentByFace.set(neighbour, { parent: current, hinge: [id, nextId] })
        queue.push(neighbour)
      }
    }
  }
  if (visited.size !== faces.length) {
    const unreachable = faces.filter((_, index) => !visited.has(index)).map((face) => face.id)
    diagnostics.push(`以下面无法从根面 ${root.id} 到达：${unreachable.join("、")}`)
    return { rootFaceId: root.id, faces: [], diagnostics, status: "insufficient-data" }
  }

  const layoutFaces: UnfoldFace3[] = faces.map((face, index) => {
    const steps = stepsByFace.get(index) ?? []
    const parent = parentByFace.get(index)
    return {
      faceId: face.id,
      pointIds: [...face.pointIds],
      positions: face.pointIds.map((id) => applySteps(vertices[id], steps)),
      ...(parent ? { parentFaceId: faces[parent.parent].id, hingePointIds: parent.hinge } : {})
    }
  })

  if (fold >= 1 - EPSILON) {
    const rootFace = layoutFaces[rootIndex]
    const normal = ringNormal(rootFace.positions)
    if (normal) {
      const helper = Math.abs(normal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
      const firstAxis = normalizeVector3(crossVector3(normal, helper))
      const secondAxis = crossVector3(normal, firstAxis)
      const origin = rootFace.positions[0]
      const flat: UnfoldFace2[] = layoutFaces.map((face) => ({ faceId: face.faceId, points: face.positions.map((point) => projectOntoPlane(point, origin, firstAxis, secondAxis)) }))
      for (const [first, second] of detectUnfoldOverlaps(flat)) diagnostics.push(`展开布局中面 ${first} 与面 ${second} 重叠。`)
    }
  }

  return { rootFaceId: root.id, faces: layoutFaces, diagnostics, status: "ok" }
}
