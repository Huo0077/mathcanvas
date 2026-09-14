import type { Plane3, Vector3 } from "./geometry3d"
import { addVector3, crossVector3, dotVector3, intersectPlaneSegment, lengthVector3, normalizeVector3, subtractVector3 } from "./geometry3d"

/** Ordered section boundary produced by cutting a polyhedron with a plane. */
export type Section3Status = "none" | "point" | "segment" | "polygon" | "insufficient-data"

export interface Section3Result {
  status: Section3Status
  /** Boundary points in plane order. Empty unless the status is point, segment or polygon. */
  points: Vector3[]
  explanation: string
}

const EPSILON = 1e-9

function pointKey(point: Vector3): string {
  return `${point.x.toFixed(9)},${point.y.toFixed(9)},${point.z.toFixed(9)}`
}

/** Sort section points by angle in the cutting plane so the boundary is a deterministic closed ring. */
function orderAroundPlane(points: Vector3[], plane: Plane3): Vector3[] {
  const count = points.length
  const centroid = points.reduce((sum, point) => addVector3(sum, { x: point.x / count, y: point.y / count, z: point.z / count }), { x: 0, y: 0, z: 0 })
  const normal = normalizeVector3(plane.normal)
  const helper = Math.abs(normal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const firstAxis = normalizeVector3(crossVector3(normal, helper))
  const secondAxis = crossVector3(normal, firstAxis)
  const angleOf = (point: Vector3) => {
    const offset = subtractVector3(point, centroid)
    return Math.atan2(dotVector3(offset, secondAxis), dotVector3(offset, firstAxis))
  }
  return [...points].sort((first, second) => angleOf(first) - angleOf(second))
}

/** Order an unordered coplanar point set around the cutting plane; fewer than three points are returned as-is. */
export function orderSectionPoints3(points: Vector3[], plane: Plane3): Vector3[] {
  return points.length < 3 ? [...points] : orderAroundPlane(points, plane)
}

function polygonArea(points: Vector3[]): number {
  if (points.length < 3) return 0
  const origin = points[0]
  let areaVector = { x: 0, y: 0, z: 0 }
  for (let index = 1; index < points.length - 1; index += 1) areaVector = addVector3(areaVector, crossVector3(subtractVector3(points[index], origin), subtractVector3(points[index + 1], origin)))
  return lengthVector3(areaVector) / 2
}

/**
 * Cut any closed polyhedron with a plane by intersecting the plane with every face boundary.
 * The result is classified instead of fabricating geometry: disjoint, vertex-tangent, edge-coincident
 * and full-polygon sections are distinguished, and degenerate results return no points.
 *
 * @param vertices - polyhedron vertex positions; face rings index into this array
 * @param faces - closed face rings (index lists), at least 4 for a closed solid
 * @param plane - cutting plane in `dot(normal, point) + constant = 0` form
 */
export function sectionPolyhedron3(vertices: Vector3[], faces: number[][], plane: Plane3, tolerance = EPSILON): Section3Result {
  const validFaces = faces.filter((face) => face.length >= 3 && face.every((index) => Number.isInteger(index) && index >= 0 && index < vertices.length))
  if (vertices.length < 4 || validFaces.length < 4) return { status: "insufficient-data", points: [], explanation: "多面体拓扑不足：截面需要至少 4 个顶点和 4 个闭合面。" }

  const unique = new Map<string, Vector3>()
  for (const face of validFaces) {
    for (let index = 0; index < face.length; index += 1) {
      const first = vertices[face[index]]
      const second = vertices[face[(index + 1) % face.length]]
      for (const point of intersectPlaneSegment(first, second, plane)) unique.set(pointKey(point), point)
    }
  }

  const points = [...unique.values()]
  if (points.length === 0) return { status: "none", points: [], explanation: "剖切平面与多面体没有交集。" }
  if (points.length === 1) return { status: "point", points, explanation: "剖切平面与多面体相切于一个顶点。" }
  if (points.length === 2) return { status: "segment", points, explanation: "剖切平面与多面体相交于一条棱或线段。" }
  const ordered = orderAroundPlane(points, plane)
  if (polygonArea(ordered) <= tolerance) return { status: "insufficient-data", points: [], explanation: "截面点近似共线，无法构成有效多边形。" }
  return { status: "polygon", points: ordered, explanation: `按面边界求交得到 ${ordered.length} 个截面顶点，并按剖切平面内的角度排序。` }
}
