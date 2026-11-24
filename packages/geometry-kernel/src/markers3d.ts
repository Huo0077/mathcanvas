import type { Plane3, Vector3 } from "./geometry3d"
import { addVector3, crossVector3, dotVector3, lengthVector3, normalizeVector3, scaleVector3, subtractVector3 } from "./geometry3d"

/** 二面角弧的步数上限：超过这个数只是浪费顶点（弧早就看不出折线了）。 */
const MAX_ARC_STEPS = 720

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
  /**
   * 步数必须归一化：`Math.max(2, Math.floor(NaN))` 仍是 NaN，于是 `for (step = 0; step <= NaN; …)`
   * 一次都不执行——标记照常返回、`arc` 却是空数组（画布上画不出弧）。
   * 荒谬的巨大步数（例如 1e9）同样要夹住，否则一次分配十亿个点。
   */
  const requestedSteps = options.arcSteps
  const steps = Number.isFinite(requestedSteps) ? Math.max(2, Math.min(MAX_ARC_STEPS, Math.floor(requestedSteps as number))) : 12
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

export type LinePlaneRelation3 = "parallel" | "contained" | "oblique" | "perpendicular"

export interface LinePlaneAngleDetail3 {
  radians: number
  degrees: number
  sin: number
  cos: number
  relation: LinePlaneRelation3
  lineDirection: Vector3
  planeNormal: Vector3
  explanation: string
}

/** Drawable 3D line-plane angle annotation: intersection, perpendicular drop, projection in plane, arc, and right-angle square. */
export interface LinePlaneAngleMarker3 {
  relation: LinePlaneRelation3
  radians: number
  degrees: number
  /** Label anchor in world coordinates. */
  anchor: Vector3
  /** Intersection point of the line and the plane (null when parallel / contained). */
  intersection: Vector3 | null
  /** Highlighted oblique segment along the line from intersection to reference point (or source segment when parallel). */
  obliqueSegment: MarkerSegment3
  /** Projection of the oblique segment onto the plane. */
  projectionSegment: MarkerSegment3
  /** Dashed perpendicular drop from the reference point to its foot on the plane (null when contained/perpendicular at vertex). */
  perpendicularDrop: MarkerSegment3 | null
  /** Angle arc swept from projection toward the line (empty when angle is 0). */
  arc: Vector3[]
  /** 3-point right-angle bracket polyline at the perpendicular foot (or intersection when 90°). */
  rightAngleCorner?: Vector3[]
}

export type SpatialLineRelation3 = "intersecting" | "skew" | "parallel"

export interface LineAngleDetail3 {
  radians: number
  degrees: number
  sin: number
  cos: number
  relation: SpatialLineRelation3
  /** Shortest distance between the two infinite lines (0 for intersecting, >0 for skew / distinct parallel). */
  skewDistance: number
  firstDirection: Vector3
  secondDirection: Vector3
  explanation: string
}

/** Drawable 3D spatial line-line angle annotation: vertex, acute/right angle arc, legs, and parallel translation line for skew lines. */
export interface LineAngleMarker3 {
  relation: SpatialLineRelation3
  radians: number
  degrees: number
  skewDistance: number
  /** Vertex at which the angle arc is drawn (intersection for intersecting lines, translation point on line 1 for skew lines). */
  vertex: Vector3
  /** Label anchor in world coordinates. */
  anchor: Vector3
  firstLeg: MarkerSegment3
  secondLeg: MarkerSegment3
  /** Dashed parallel translation helper segment through `vertex` when the two lines are skew. */
  translatedLine: MarkerSegment3 | null
  /** Optional subtle dashed connector between the closest points of two skew lines. */
  commonPerpendicular: MarkerSegment3 | null
  /** Angle arc swept between the two acute/right directions (empty when parallel). */
  arc: Vector3[]
  /** 3-point right-angle bracket polyline when the lines are perpendicular. */
  rightAngleCorner?: Vector3[]
}

function buildArcPoints(vertex: Vector3, startDir: Vector3, endDir: Vector3, radius: number, requestedSteps?: number): Vector3[] {
  const u = normalizeVector3(startDir)
  const v = normalizeVector3(endDir)
  if (lengthVector3(u) <= EPSILON || lengthVector3(v) <= EPSILON || !(radius > EPSILON)) return []
  const sweep = Math.acos(Math.min(1, Math.max(-1, dotVector3(u, v))))
  if (sweep <= 1e-6) return []
  const axisRaw = crossVector3(u, v)
  const axisLen = lengthVector3(axisRaw)
  if (axisLen <= EPSILON) return []
  const axis = scaleVector3(axisRaw, 1 / axisLen)
  const steps = Number.isFinite(requestedSteps) ? Math.max(4, Math.min(MAX_ARC_STEPS, Math.floor(requestedSteps as number))) : 16
  const points: Vector3[] = []
  for (let step = 0; step <= steps; step += 1) {
    const angle = sweep * (step / steps)
    points.push(addVector3(vertex, scaleVector3(rotateVectorAboutAxis(u, axis, angle), radius)))
  }
  return points
}

function buildRightAngleCorner(corner: Vector3, dirA: Vector3, dirB: Vector3, size: number): Vector3[] | undefined {
  const u = normalizeVector3(dirA)
  const v = normalizeVector3(dirB)
  if (lengthVector3(u) <= EPSILON || lengthVector3(v) <= EPSILON || !(size > EPSILON)) return undefined
  const pA = addVector3(corner, scaleVector3(u, size))
  const pAB = addVector3(pA, scaleVector3(v, size))
  const pB = addVector3(corner, scaleVector3(v, size))
  return [pA, pAB, pB]
}

/**
 * Compute the line-plane angle θ ∈ [0, π/2] from a spatial line segment and a plane.
 * Uses sin(θ) = |d · n| / (|d| |n|), independent of endpoint order or plane normal sign.
 */
export function linePlaneAngleDetail3(lineStart: Vector3, lineEnd: Vector3, plane: Plane3): LinePlaneAngleDetail3 | null {
  const rawDir = subtractVector3(lineEnd, lineStart)
  const dirLen = lengthVector3(rawDir)
  const normalLen = lengthVector3(plane.normal)
  if (dirLen <= EPSILON || normalLen <= EPSILON) return null
  const d = scaleVector3(rawDir, 1 / dirLen)
  const n = scaleVector3(plane.normal, 1 / normalLen)
  const c = plane.constant / normalLen
  const sinVal = Math.min(1, Math.max(0, Math.abs(dotVector3(d, n))))
  const radians = Math.asin(sinVal)
  const degrees = (radians * 180) / Math.PI
  const cosVal = Math.sqrt(Math.max(0, 1 - sinVal * sinVal))
  const startDist = Math.abs(dotVector3(n, lineStart) + c)
  const relation: LinePlaneRelation3 =
    sinVal <= 1e-7 ? (startDist <= 1e-6 ? "contained" : "parallel")
    : sinVal >= 1 - 1e-7 ? "perpendicular"
    : "oblique"
  const relationLabel =
    relation === "contained" ? "直线在平面内"
    : relation === "parallel" ? "直线与平面平行"
    : relation === "perpendicular" ? "直线与平面垂直"
    : "直线与平面斜交"
  return {
    radians,
    degrees,
    sin: sinVal,
    cos: cosVal,
    relation,
    lineDirection: d,
    planeNormal: n,
    explanation: `${relationLabel}，线面角为 ${radians.toFixed(3)} rad（${degrees.toFixed(2)}°，sin=${sinVal.toFixed(4)}，cos=${cosVal.toFixed(4)}）。`
  }
}

/**
 * Build the drawable 3D line-plane angle marker: intersection point, perpendicular drop P→H,
 * in-plane projection I→H, right-angle bracket at H, and swept angle arc at I.
 */
export function linePlaneAngleMarker3(
  lineStart: Vector3,
  lineEnd: Vector3,
  plane: Plane3,
  options: { radius?: number; arcSteps?: number; planeReference?: Vector3 } = {}
): LinePlaneAngleMarker3 | null {
  const detail = linePlaneAngleDetail3(lineStart, lineEnd, plane)
  if (!detail) return null
  const normalLen = lengthVector3(plane.normal)
  const unitPlane: Plane3 = { normal: scaleVector3(plane.normal, 1 / normalLen), constant: plane.constant / normalLen }
  const midpoint = scaleVector3(addVector3(lineStart, lineEnd), 0.5)

  if (detail.relation === "parallel" || detail.relation === "contained") {
    const h0 = perpendicularFootOnPlane3(lineStart, unitPlane)
    const h1 = perpendicularFootOnPlane3(lineEnd, unitPlane)
    if (!h0 || !h1) return null
    const midFoot = scaleVector3(addVector3(h0, h1), 0.5)
    const dist = lengthVector3(subtractVector3(midpoint, midFoot))
    return {
      relation: detail.relation,
      radians: detail.radians,
      degrees: detail.degrees,
      anchor: midpoint,
      intersection: null,
      obliqueSegment: { start: lineStart, end: lineEnd },
      projectionSegment: { start: h0, end: h1 },
      perpendicularDrop: dist > 1e-5 ? { start: midpoint, end: midFoot } : null,
      arc: []
    }
  }

  const segVec = subtractVector3(lineEnd, lineStart)
  const denom = dotVector3(unitPlane.normal, segVec)
  if (Math.abs(denom) <= EPSILON) return null
  const t = -(dotVector3(unitPlane.normal, lineStart) + unitPlane.constant) / denom
  const intersection = addVector3(lineStart, scaleVector3(segVec, t))
  const distStart = lengthVector3(subtractVector3(lineStart, intersection))
  const distEnd = lengthVector3(subtractVector3(lineEnd, intersection))
  const refPoint = distEnd >= distStart ? lineEnd : lineStart
  const refVec = subtractVector3(refPoint, intersection)
  const refLen = lengthVector3(refVec)
  const p = refLen > 1e-5 ? refPoint : addVector3(intersection, detail.lineDirection)
  const foot = perpendicularFootOnPlane3(p, unitPlane)
  if (!foot) return null

  const pLen = lengthVector3(subtractVector3(p, intersection))
  const requestedRadius = options.radius ?? 0.55

  if (detail.relation === "perpendicular") {
    const dirLine = normalizeVector3(subtractVector3(p, intersection))
    const helperBase = options.planeReference ? subtractVector3(options.planeReference, intersection) : { x: 1, y: 0, z: 0 }
    let inPlane = subtractVector3(helperBase, scaleVector3(unitPlane.normal, dotVector3(helperBase, unitPlane.normal)))
    if (lengthVector3(inPlane) <= 1e-6) {
      const alt = Math.abs(unitPlane.normal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
      inPlane = subtractVector3(alt, scaleVector3(unitPlane.normal, dotVector3(alt, unitPlane.normal)))
    }
    const dirPlane = normalizeVector3(inPlane)
    const radius = Math.min(requestedRadius, Math.max(0.14, pLen * 0.45))
    const arc = buildArcPoints(intersection, dirPlane, dirLine, radius, options.arcSteps)
    const projEnd = addVector3(intersection, scaleVector3(dirPlane, Math.max(radius * 1.35, Math.min(1, pLen * 0.6))))
    const rightAngleCorner = buildRightAngleCorner(intersection, dirPlane, dirLine, Math.min(0.2, radius * 0.55))
    const anchor = arc.length > 0 ? arc[Math.floor(arc.length / 2)]! : scaleVector3(addVector3(intersection, p), 0.5)
    return {
      relation: detail.relation,
      radians: detail.radians,
      degrees: detail.degrees,
      anchor,
      intersection,
      obliqueSegment: { start: intersection, end: p },
      projectionSegment: { start: intersection, end: projEnd },
      perpendicularDrop: null,
      arc,
      rightAngleCorner
    }
  }

  const projVec = subtractVector3(foot, intersection)
  const dropVec = subtractVector3(p, foot)
  const projLen = lengthVector3(projVec)
  const dropLen = lengthVector3(dropVec)
  const radius = Math.min(requestedRadius, Math.max(0.12, Math.min(pLen, projLen) * 0.45))
  const arc = buildArcPoints(intersection, projVec, subtractVector3(p, intersection), radius, options.arcSteps)
  const cornerSize = Math.min(0.18, Math.min(projLen, dropLen) * 0.3)
  const rightAngleCorner = buildRightAngleCorner(foot, subtractVector3(intersection, foot), dropVec, cornerSize)
  const anchor = arc.length > 0 ? arc[Math.floor(arc.length / 2)]! : scaleVector3(addVector3(intersection, p), 0.5)
  return {
    relation: detail.relation,
    radians: detail.radians,
    degrees: detail.degrees,
    anchor,
    intersection,
    obliqueSegment: { start: intersection, end: p },
    projectionSegment: { start: intersection, end: foot },
    perpendicularDrop: { start: p, end: foot },
    arc,
    rightAngleCorner
  }
}

/**
 * Compute the spatial angle θ ∈ [0, π/2] between two 3D lines (intersecting, skew, or parallel),
 * along with their spatial relationship and shortest distance.
 */
export function lineAngleDetail3(a0: Vector3, a1: Vector3, b0: Vector3, b1: Vector3): LineAngleDetail3 | null {
  const rawU = subtractVector3(a1, a0)
  const rawV = subtractVector3(b1, b0)
  const lenU = lengthVector3(rawU)
  const lenV = lengthVector3(rawV)
  if (lenU <= EPSILON || lenV <= EPSILON) return null
  const u = scaleVector3(rawU, 1 / lenU)
  let v = scaleVector3(rawV, 1 / lenV)
  if (dotVector3(u, v) < 0) v = scaleVector3(v, -1)
  const cosVal = Math.min(1, Math.max(0, dotVector3(u, v)))
  const radians = Math.acos(cosVal)
  const degrees = (radians * 180) / Math.PI
  const sinVal = Math.sqrt(Math.max(0, 1 - cosVal * cosVal))

  const w0 = subtractVector3(a0, b0)
  const b = dotVector3(u, v)
  const d = dotVector3(u, w0)
  const e = dotVector3(v, w0)
  const denom = 1 - b * b
  const scale = Math.max(1, lenU, lenV, lengthVector3(w0))

  let relation: SpatialLineRelation3
  let skewDistance: number
  if (denom <= 1e-10) {
    relation = "parallel"
    const proj = subtractVector3(w0, scaleVector3(u, d))
    skewDistance = lengthVector3(proj)
  } else {
    const s = (b * e - d) / denom
    const t = (e - b * d) / denom
    const p1 = addVector3(a0, scaleVector3(u, s))
    const p2 = addVector3(b0, scaleVector3(v, t))
    skewDistance = lengthVector3(subtractVector3(p1, p2))
    relation = skewDistance <= 1e-5 * scale ? "intersecting" : "skew"
  }

  const relationText =
    relation === "parallel" ? "平行或重合直线"
    : relation === "intersecting" ? "相交直线"
    : `异面直线（公垂距 ${skewDistance.toFixed(3)} u，经平移求夹角）`
  return {
    radians,
    degrees,
    sin: sinVal,
    cos: cosVal,
    relation,
    skewDistance,
    firstDirection: u,
    secondDirection: v,
    explanation: `${relationText}，空间直线夹角为 ${radians.toFixed(3)} rad（${degrees.toFixed(2)}°，sin=${sinVal.toFixed(4)}，cos=${cosVal.toFixed(4)}）。`
  }
}

/**
 * Build the drawable 3D spatial line-line angle marker.
 * - Intersecting lines: draws the acute/right angle arc directly at the intersection point.
 * - Skew lines: translates the second line parallel to pass through an anchor on the first line,
 *   showing the dashed translated helper line, common perpendicular connector, and angle arc.
 * - Parallel lines: returns a zero-angle marker anchored between the midpoints.
 */
export function lineAngleMarker3(
  a0: Vector3,
  a1: Vector3,
  b0: Vector3,
  b1: Vector3,
  options: { radius?: number; arcSteps?: number } = {}
): LineAngleMarker3 | null {
  const detail = lineAngleDetail3(a0, a1, b0, b1)
  if (!detail) return null
  const rawU = subtractVector3(a1, a0)
  const rawV = subtractVector3(b1, b0)
  const lenU = lengthVector3(rawU)
  const lenV = lengthVector3(rawV)
  const u0 = scaleVector3(rawU, 1 / lenU)
  const v0 = scaleVector3(rawV, 1 / lenV)
  const midA = scaleVector3(addVector3(a0, a1), 0.5)
  const midB = scaleVector3(addVector3(b0, b1), 0.5)

  if (detail.relation === "parallel") {
    const anchor = scaleVector3(addVector3(midA, midB), 0.5)
    return {
      relation: "parallel",
      radians: detail.radians,
      degrees: detail.degrees,
      skewDistance: detail.skewDistance,
      vertex: midA,
      anchor,
      firstLeg: { start: a0, end: a1 },
      secondLeg: { start: b0, end: b1 },
      translatedLine: null,
      commonPerpendicular: null,
      arc: []
    }
  }

  const w0 = subtractVector3(a0, b0)
  const b = dotVector3(u0, v0)
  const d = dotVector3(u0, w0)
  const e = dotVector3(v0, w0)
  const denom = 1 - b * b
  const s = (b * e - d) / denom
  const t = (e - b * d) / denom
  const p1 = addVector3(a0, scaleVector3(u0, s))
  const p2 = addVector3(b0, scaleVector3(v0, t))

  let vertex: Vector3
  let dirA = u0
  let dirB = v0
  let translatedLine: MarkerSegment3 | null = null
  let commonPerpendicular: MarkerSegment3 | null = null

  if (detail.relation === "intersecting") {
    vertex = scaleVector3(addVector3(p1, p2), 0.5)
    // Prefer directions pointing into each source segment when that still yields an acute/right angle.
    const toMidA = subtractVector3(midA, vertex)
    const toMidB = subtractVector3(midB, vertex)
    if (lengthVector3(toMidA) > 1e-6 && dotVector3(toMidA, dirA) < 0) dirA = scaleVector3(dirA, -1)
    if (lengthVector3(toMidB) > 1e-6 && dotVector3(toMidB, dirB) < 0) dirB = scaleVector3(dirB, -1)
    if (dotVector3(dirA, dirB) < 0) dirB = scaleVector3(dirB, -1)
  } else {
    // Skew lines: anchor on segment 1 (use closest point P1 when near the segment, otherwise midpoint of segment 1).
    const useClosest = s >= -0.35 * lenU && s <= 1.35 * lenU
    vertex = useClosest ? p1 : midA
    const toMidA = subtractVector3(midA, vertex)
    if (lengthVector3(toMidA) > 1e-6 && dotVector3(toMidA, dirA) < 0) dirA = scaleVector3(dirA, -1)
    if (dotVector3(dirA, dirB) < 0) dirB = scaleVector3(dirB, -1)
    const halfSpan = Math.max(0.55, Math.min(1.6, lenV * 0.5))
    translatedLine = {
      start: subtractVector3(vertex, scaleVector3(dirB, halfSpan * 0.4)),
      end: addVector3(vertex, scaleVector3(dirB, halfSpan))
    }
    commonPerpendicular = { start: p1, end: p2 }
  }

  const legLength = Math.max(0.45, Math.min(1.1, Math.min(lenU, lenV) * 0.55))
  const radius = Math.min(options.radius ?? 0.5, Math.max(0.14, legLength * 0.65))
  const arc = buildArcPoints(vertex, dirA, dirB, radius, options.arcSteps)
  const rightAngleCorner =
    Math.abs(detail.radians - Math.PI / 2) <= 1e-4
      ? buildRightAngleCorner(vertex, dirA, dirB, Math.min(0.2, radius * 0.55))
      : undefined
  const anchor = arc.length > 0 ? arc[Math.floor(arc.length / 2)]! : vertex
  return {
    relation: detail.relation,
    radians: detail.radians,
    degrees: detail.degrees,
    skewDistance: detail.skewDistance,
    vertex,
    anchor,
    firstLeg: { start: vertex, end: addVector3(vertex, scaleVector3(dirA, legLength)) },
    secondLeg: { start: vertex, end: addVector3(vertex, scaleVector3(dirB, legLength)) },
    translatedLine,
    commonPerpendicular,
    arc,
    rightAngleCorner
  }
}
