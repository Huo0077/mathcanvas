import type { Plane3, Vector3 } from "./geometry3d"
import { addVector3, crossVector3, dotVector3, lengthVector3, normalizeVector3, scaleVector3, subtractVector3 } from "./geometry3d"

/** Explainable dihedral measurement for two faces that share a common edge. */
export interface DihedralDetail3 {
  /** Angle inside the solid, measured in the plane perpendicular to the common edge. */
  interiorDegrees: number
  /** The supplement of the interior angle, i.e. the usual "outside" dihedral reading. */
  exteriorDegrees: number
  hingeAxis: Vector3
  firstNormal: Vector3
  secondNormal: Vector3
  explanation: string
}

export interface PerpendicularFoot3 {
  point: Vector3
  /** Position along the line, normalised so 0 is the start and 1 is the end point. */
  parameter: number
}

export interface MarkerSegment3 {
  start: Vector3
  end: Vector3
}

/** Drawable dihedral annotation: hinge, angle arc in the plane perpendicular to the hinge, and both normals. */
export interface DihedralMarker3 {
  hingeStart: Vector3
  hingeEnd: Vector3
  arc: Vector3[]
  interiorDegrees: number
  exteriorDegrees: number
  firstNormal: MarkerSegment3
  secondNormal: MarkerSegment3
}

const EPSILON = 1e-9

function centroid(points: Vector3[]): Vector3 {
  return points.reduce((sum, point) => addVector3(sum, { x: point.x / points.length, y: point.y / points.length, z: point.z / points.length }), { x: 0, y: 0, z: 0 })
}

function ringNormal(points: Vector3[]): Vector3 | null {
  if (points.length < 3) return null
  const normal = crossVector3(subtractVector3(points[1], points[0]), subtractVector3(points[2], points[0]))
  return lengthVector3(normal) > EPSILON ? normalizeVector3(normal) : null
}

/** In-plane direction perpendicular to the common edge pointing into the face; independent of ring winding. */
function inwardPerpendicular(face: Vector3[], hingeStart: Vector3, hingeAxis: Vector3): Vector3 | null {
  const offset = subtractVector3(centroid(face), hingeStart)
  const perpendicular = subtractVector3(offset, scaleVector3(hingeAxis, dotVector3(offset, hingeAxis)))
  return lengthVector3(perpendicular) > EPSILON ? normalizeVector3(perpendicular) : null
}

/**
 * Dihedral angle between two faces around their common edge. The interior angle is measured between the two
 * in-face directions perpendicular to the hinge, so it is the angle a student reads inside the solid and it does
 * not depend on how each face ring happens to be wound. Degenerate input returns null instead of a guess.
 */
export function dihedralAngleDetail3(first: Vector3[], second: Vector3[], hingeStart: Vector3, hingeEnd: Vector3): DihedralDetail3 | null {
  const hingeVector = subtractVector3(hingeEnd, hingeStart)
  if (first.length < 3 || second.length < 3 || lengthVector3(hingeVector) <= EPSILON) return null
  const hingeAxis = normalizeVector3(hingeVector)
  const firstInward = inwardPerpendicular(first, hingeStart, hingeAxis)
  const secondInward = inwardPerpendicular(second, hingeStart, hingeAxis)
  const firstNormal = ringNormal(first)
  const secondNormal = ringNormal(second)
  if (!firstInward || !secondInward || !firstNormal || !secondNormal) return null
  const cosine = Math.min(1, Math.max(-1, dotVector3(firstInward, secondInward)))
  const interiorDegrees = Math.acos(cosine) * 180 / Math.PI
  const exteriorDegrees = 180 - interiorDegrees
  return {
    interiorDegrees,
    exteriorDegrees,
    hingeAxis,
    firstNormal,
    secondNormal,
    explanation: `以公共棱为轴，取两个面内垂直于公共棱的方向，二面角内角为 ${interiorDegrees.toFixed(3)}°，外角（补角）为 ${exteriorDegrees.toFixed(3)}°。`
  }
}

/** First shared edge of two face rings as point ids, in the first ring's direction. */
export function sharedRingEdge3(firstPointIds: string[], secondPointIds: string[]): [string, string] | null {
  for (let index = 0; index < firstPointIds.length; index += 1) {
    const start = firstPointIds[index]
    const end = firstPointIds[(index + 1) % firstPointIds.length]
    for (let other = 0; other < secondPointIds.length; other += 1) {
      const otherStart = secondPointIds[other]
      const otherEnd = secondPointIds[(other + 1) % secondPointIds.length]
      if ((start === otherStart && end === otherEnd) || (start === otherEnd && end === otherStart)) return [start, end]
    }
  }
  return null
}

function rotateVectorAboutAxis(vector: Vector3, axis: Vector3, angle: number): Vector3 {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  const parallel = scaleVector3(axis, dotVector3(vector, axis))
  const perpendicular = subtractVector3(vector, parallel)
  return addVector3(parallel, addVector3(scaleVector3(perpendicular, cosine), scaleVector3(crossVector3(axis, perpendicular), sine)))
}

/** Point a face normal away from the neighbouring face so both arrows separate the wedge. */
function orientOutward(normal: Vector3, ownCentroid: Vector3, otherCentroid: Vector3): Vector3 {
  return dotVector3(normal, subtractVector3(otherCentroid, ownCentroid)) > 0 ? scaleVector3(normal, -1) : normal
}

/**
 * Build the drawable annotation for a dihedral angle: the common edge, an arc swept between the two in-face
 * directions in the plane perpendicular to the hinge, and both face normals oriented outward.
 * Returns null for degenerate input so callers never draw a guessed marker.
 */
export function dihedralMarker3(first: Vector3[], second: Vector3[], hingeStart: Vector3, hingeEnd: Vector3, options: { radius?: number; arcSteps?: number } = {}): DihedralMarker3 | null {
  const detail = dihedralAngleDetail3(first, second, hingeStart, hingeEnd)
  const firstInward = detail ? inwardPerpendicular(first, hingeStart, detail.hingeAxis) : null
  const secondInward = detail ? inwardPerpendicular(second, hingeStart, detail.hingeAxis) : null
  if (!detail || !firstInward || !secondInward) return null
  const radius = options.radius ?? 0.6
  const steps = Math.max(2, Math.floor(options.arcSteps ?? 12))
  const midpoint = scaleVector3(addVector3(hingeStart, hingeEnd), 0.5)
  const sweep = Math.acos(Math.min(1, Math.max(-1, dotVector3(firstInward, secondInward))))
  const direction = dotVector3(crossVector3(firstInward, secondInward), detail.hingeAxis) < 0 ? -1 : 1
  const arc: Vector3[] = []
  for (let step = 0; step <= steps; step += 1) {
    const angle = direction * sweep * (step / steps)
    arc.push(addVector3(midpoint, scaleVector3(rotateVectorAboutAxis(firstInward, detail.hingeAxis, angle), radius)))
  }
  const firstCentroid = centroid(first)
  const secondCentroid = centroid(second)
  const firstNormal = orientOutward(detail.firstNormal, firstCentroid, secondCentroid)
  const secondNormal = orientOutward(detail.secondNormal, secondCentroid, firstCentroid)
  return {
    hingeStart,
    hingeEnd,
    arc,
    interiorDegrees: detail.interiorDegrees,
    exteriorDegrees: detail.exteriorDegrees,
    firstNormal: { start: firstCentroid, end: addVector3(firstCentroid, scaleVector3(firstNormal, radius * 1.4)) },
    secondNormal: { start: secondCentroid, end: addVector3(secondCentroid, scaleVector3(secondNormal, radius * 1.4)) }
  }
}

/** Foot of the perpendicular from a point to a plane, or null for a degenerate plane normal. */
export function perpendicularFootOnPlane3(point: Vector3, plane: Plane3): Vector3 | null {
  const normalLength = lengthVector3(plane.normal)
  if (normalLength <= EPSILON) return null
  const normal = scaleVector3(plane.normal, 1 / normalLength)
  const signedDistance = dotVector3(normal, point) + plane.constant / normalLength
  return subtractVector3(point, scaleVector3(normal, signedDistance))
}

/** Foot of the perpendicular from a point to a line, with its normalised parameter, or null when degenerate. */
export function perpendicularFootOnLine3(point: Vector3, lineStart: Vector3, lineEnd: Vector3): PerpendicularFoot3 | null {
  const direction = subtractVector3(lineEnd, lineStart)
  const lengthSquared = dotVector3(direction, direction)
  if (lengthSquared <= EPSILON * EPSILON) return null
  const parameter = dotVector3(subtractVector3(point, lineStart), direction) / lengthSquared
  return { point: addVector3(lineStart, scaleVector3(direction, parameter)), parameter }
}
