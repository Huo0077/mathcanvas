import type { Vector3 } from "@draw/dsl"
import {
  distanceVector3,
  dotVector3,
  evaluateCoplanarPoints3,
  evaluateLinePlaneRelation3,
  evaluatePlanePlaneRelation3,
  planeFromPoints,
  projectPointOntoPlanePoints3,
  projectPointOntoSegmentEndpoints3,
  subtractVector3,
  verifyClosedPolyhedronTopology3
} from "@draw/geometry-kernel"

import type { ConstraintStatus } from "../constraintGraph"
import { constructRegularSquarePyramid } from "./regularPyramid"
import { constructTetrahedron } from "./tetrahedron"

export type Solve3dStatus =
  | "solved"
  | "infeasible"
  | "degenerate"
  | "underdetermined"
  | "unsupported"

export interface ConstraintSolve3dResult {
  status: Solve3dStatus
  residuals: Record<string, number>
  constraintStatus: ConstraintStatus
  pointRegistry: Record<string, Vector3>
  vertices?: Vector3[]
  faceRings?: number[][]
  namedFaceRings?: string[][]
  topologyValid?: boolean
  reason?: string
}

export interface NamedVertex3 {
  name: string
  point: Vector3
}

export type ConstraintSolve3dRequest =
  | {
      kind: "prism"
      baseVertices: readonly NamedVertex3[]
      topLabels: readonly string[]
      height: number
      drift?: Vector3
      tolerance?: number
    }
  | {
      kind: "regular_pyramid"
      baseSide: number
      lateralEdge: number
      baseLabels?: readonly [string, string, string, string]
      apexName?: string
      tolerance?: number
    }
  | {
      kind: "perpendicular_pyramid"
      apexName: string
      baseVertices: readonly NamedVertex3[]
      footName: string
      height: number
      tolerance?: number
    }
  | {
      kind: "tetrahedron"
      names?: readonly [string, string, string, string]
      ab: number
      ac: number
      bc: number
      pa: number
      pb: number
      pc: number
      tolerance?: number
    }
  | {
      kind: "perpendicular_foot"
      targetKind: "line"
      point: Vector3
      line: readonly [Vector3, Vector3]
      resultName: string
      tolerance?: number
    }
  | {
      kind: "perpendicular_foot"
      targetKind: "plane"
      point: Vector3
      planePoints: readonly [Vector3, Vector3, Vector3]
      resultName: string
      tolerance?: number
    }
  | {
      kind: "line_plane_relation"
      relation: "perpendicular" | "parallel"
      line: readonly [Vector3, Vector3]
      planePoints: readonly [Vector3, Vector3, Vector3]
      tolerance?: number
    }
  | {
      kind: "plane_plane_relation"
      relation: "perpendicular" | "parallel"
      firstPlane: readonly [Vector3, Vector3, Vector3]
      secondPlane: readonly [Vector3, Vector3, Vector3]
      tolerance?: number
    }
  | {
      kind: "coplanar"
      points: readonly Vector3[]
      tolerance?: number
    }
  | {
      kind: "closed_polyhedron_topology"
      vertices: readonly Vector3[]
      faceRings: readonly (readonly number[])[]
      tolerance?: number
    }
  | {
      kind: "interior_ratio"
      targetKind: "edge"
      anchors: readonly [Vector3, Vector3]
      ratio: number
      resultName: string
      splitBetween?: boolean
    }
  | {
      kind: "interior_ratio"
      targetKind: "face"
      anchors: readonly [Vector3, Vector3, Vector3]
      weights: readonly [number, number, number]
      resultName: string
    }

const DEFAULT_TOLERANCE = 1e-6

function fail3d(
  status: Solve3dStatus,
  constraintStatus: ConstraintStatus,
  reason: string,
  residuals: Record<string, number> = {}
): ConstraintSolve3dResult {
  return {
    status,
    residuals,
    constraintStatus,
    pointRegistry: {},
    topologyValid: false,
    reason
  }
}

function orientBaseRingCCW(
  base: readonly NamedVertex3[],
  topLabels: readonly string[]
): { orderedBase: NamedVertex3[]; orderedTop: string[]; plane: NonNullable<ReturnType<typeof planeFromPoints>> } | null {
  if (base.length < 3 || base.length !== topLabels.length) return null
  const plane = planeFromPoints(base[0]!.point, base[1]!.point, base[2]!.point)
  if (!plane) return null
  // Determine signed area wrt plane.normal
  const o = base[0]!.point
  let areaSum = 0
  for (let i = 1; i < base.length - 1; i += 1) {
    const u = subtractVector3(base[i]!.point, o)
    const v = subtractVector3(base[i + 1]!.point, o)
    const cx = u.y * v.z - u.z * v.y
    const cy = u.z * v.x - u.x * v.z
    const cz = u.x * v.y - u.y * v.x
    areaSum += dotVector3({ x: cx, y: cy, z: cz }, plane.normal)
  }
  if (areaSum < 0) {
    return {
      orderedBase: [...base].reverse(),
      orderedTop: [...topLabels].reverse(),
      plane
    }
  }
  return { orderedBase: [...base], orderedTop: [...topLabels], plane }
}

function buildPyramidRings(baseNames: readonly string[], apexIdx: number): { faceRings: number[][]; namedFaceRings: string[][] } {
  const n = baseNames.length
  const baseIndices = Array.from({ length: n }, (_, i) => i)
  const faceRings: number[][] = [
    [...baseIndices].reverse()
  ]
  for (let i = 0; i < n; i += 1) {
    const next = (i + 1) % n
    faceRings.push([i, next, apexIdx])
  }
  const allNames = [...baseNames, "APEX"]
  const namedFaceRings = faceRings.map((ring) => ring.map((idx) => (idx === apexIdx ? "APEX" : allNames[idx]!)))
  return { faceRings, namedFaceRings }
}

export function solveConstraint3d(request: ConstraintSolve3dRequest): ConstraintSolve3dResult {
  const tol = "tolerance" in request && request.tolerance !== undefined ? request.tolerance : DEFAULT_TOLERANCE

  switch (request.kind) {
    case "prism": {
      if (!Number.isFinite(request.height) || request.height <= 0 || request.baseVertices.length < 3) {
        return fail3d("infeasible", "inconsistent", "棱柱高度必须为正且底面至少 3 个顶点。")
      }
      if (request.topLabels.length !== request.baseVertices.length) {
        return fail3d("degenerate", "inconsistent", "顶面命名数量与底面顶点数量不一致。")
      }
      const oriented = orientBaseRingCCW(request.baseVertices, request.topLabels)
      if (!oriented) {
        return fail3d("degenerate", "inconsistent", "底面前三点共线，无法确立棱柱底面平面。")
      }
      const { orderedBase, orderedTop, plane } = oriented
      // Ensure base normal points toward +Z when lying on Z=const, otherwise use unit plane normal
      const upDir = plane.normal.z < -1e-9
        ? { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z }
        : plane.normal
      const offset = request.drift ?? {
        x: upDir.x * request.height,
        y: upDir.y * request.height,
        z: upDir.z * request.height
      }
      const n = orderedBase.length
      const vertices: Vector3[] = [
        ...orderedBase.map((v) => v.point),
        ...orderedBase.map((v) => ({ x: v.point.x + offset.x, y: v.point.y + offset.y, z: v.point.z + offset.z }))
      ]
      const names = [...orderedBase.map((v) => v.name), ...orderedTop]
      const pointRegistry: Record<string, Vector3> = {}
      for (let i = 0; i < names.length; i += 1) {
        pointRegistry[names[i]!] = vertices[i]!
      }
      // Check outward winding based on dot(offset, oriented area normal)
      const areaSign = dotVector3(offset, plane.normal) >= 0 ? 1 : -1
      const faceRings: number[][] = []
      if (areaSign > 0) {
        faceRings.push(Array.from({ length: n }, (_, i) => n - 1 - i))
        faceRings.push(Array.from({ length: n }, (_, i) => n + i))
        for (let i = 0; i < n; i += 1) {
          const next = (i + 1) % n
          faceRings.push([i, next, n + next, n + i])
        }
      } else {
        faceRings.push(Array.from({ length: n }, (_, i) => i))
        faceRings.push(Array.from({ length: n }, (_, i) => n + (n - 1 - i)))
        for (let i = 0; i < n; i += 1) {
          const next = (i + 1) % n
          faceRings.push([next, i, n + i, n + next])
        }
      }
      const topo = verifyClosedPolyhedronTopology3(vertices, faceRings, tol)
      if (!topo.closed) {
        return fail3d("infeasible", "inconsistent", topo.reason ?? "棱柱拓扑未闭合。", {
          coplanarFace: topo.coplanarResidual,
          topologyClosed: topo.boundaryEdgeCount
        })
      }
      const namedFaceRings = faceRings.map((ring) => ring.map((idx) => names[idx]!))
      return {
        status: "solved",
        residuals: {
          coplanarFace: topo.coplanarResidual,
          topologyClosed: topo.boundaryEdgeCount
        },
        constraintStatus: "satisfied",
        pointRegistry,
        vertices,
        faceRings,
        namedFaceRings,
        topologyValid: true
      }
    }

    case "regular_pyramid": {
      const built = constructRegularSquarePyramid(request.baseSide, request.lateralEdge)
      if (!built) {
        return fail3d("infeasible", "inconsistent", "正四棱锥边长与侧棱不满足几何不等式。")
      }
      const labels = request.baseLabels ?? ["A", "B", "C", "D"]
      const apexName = request.apexName ?? "P"
      const vertices: Vector3[] = [built.a, built.b, built.c, built.d, built.p]
      const names = [...labels, apexName]
      const pointRegistry: Record<string, Vector3> = {}
      for (let i = 0; i < names.length; i += 1) pointRegistry[names[i]!] = vertices[i]!
      const { faceRings } = buildPyramidRings(labels, 4)
      const namedFaceRings = faceRings.map((ring) => ring.map((idx) => names[idx]!))
      const topo = verifyClosedPolyhedronTopology3(vertices, faceRings, tol)
      const maxLateralErr = Math.max(
        Math.abs(distanceVector3(built.p, built.a) - request.lateralEdge),
        Math.abs(distanceVector3(built.p, built.b) - request.lateralEdge),
        Math.abs(distanceVector3(built.p, built.c) - request.lateralEdge),
        Math.abs(distanceVector3(built.p, built.d) - request.lateralEdge)
      )
      return {
        status: topo.closed ? "solved" : "infeasible",
        residuals: {
          maxLateralEdge: maxLateralErr,
          topologyClosed: topo.boundaryEdgeCount
        },
        constraintStatus: topo.closed && maxLateralErr <= tol ? "satisfied" : "inconsistent",
        pointRegistry,
        vertices,
        faceRings,
        namedFaceRings,
        topologyValid: topo.closed
      }
    }

    case "perpendicular_pyramid": {
      if (!Number.isFinite(request.height) || request.height <= 0 || request.baseVertices.length < 3) {
        return fail3d("infeasible", "inconsistent", "直棱锥高度必须为正且底面至少 3 个顶点。")
      }
      const oriented = orientBaseRingCCW(request.baseVertices, request.baseVertices.map((v) => v.name))
      if (!oriented) {
        return fail3d("degenerate", "inconsistent", "底面三点共线，无法构成棱锥。")
      }
      const footVertex = oriented.orderedBase.find((v) => v.name === request.footName)
      if (!footVertex) {
        return fail3d("degenerate", "inconsistent", `未在底面中找到垂足顶点 ${request.footName}。`)
      }
      const upDir = oriented.plane.normal.z < -1e-9
        ? { x: -oriented.plane.normal.x, y: -oriented.plane.normal.y, z: -oriented.plane.normal.z }
        : oriented.plane.normal
      const apex: Vector3 = {
        x: footVertex.point.x + upDir.x * request.height,
        y: footVertex.point.y + upDir.y * request.height,
        z: footVertex.point.z + upDir.z * request.height
      }
      const basePts = oriented.orderedBase.map((v) => v.point)
      const vertices = [...basePts, apex]
      const names = [...oriented.orderedBase.map((v) => v.name), request.apexName]
      const pointRegistry: Record<string, Vector3> = {}
      for (let i = 0; i < names.length; i += 1) pointRegistry[names[i]!] = vertices[i]!
      const n = oriented.orderedBase.length
      const areaSign = dotVector3(subtractVector3(apex, footVertex.point), oriented.plane.normal) >= 0 ? 1 : -1
      const faceRings: number[][] = [
        areaSign > 0 ? Array.from({ length: n }, (_, i) => n - 1 - i) : Array.from({ length: n }, (_, i) => i)
      ]
      for (let i = 0; i < n; i += 1) {
        const next = (i + 1) % n
        faceRings.push(areaSign > 0 ? [i, next, n] : [next, i, n])
      }
      const topo = verifyClosedPolyhedronTopology3(vertices, faceRings, tol)
      const perpErr = evaluateLinePlaneRelation3(
        [footVertex.point, apex],
        [basePts[0]!, basePts[1]!, basePts[2]!],
        "perpendicular"
      ) ?? Number.POSITIVE_INFINITY
      return {
        status: topo.closed ? "solved" : "infeasible",
        residuals: {
          perpendicularApex: perpErr,
          topologyClosed: topo.boundaryEdgeCount
        },
        constraintStatus: topo.closed && perpErr <= tol ? "satisfied" : "inconsistent",
        pointRegistry,
        vertices,
        faceRings,
        namedFaceRings: faceRings.map((ring) => ring.map((idx) => names[idx]!)),
        topologyValid: topo.closed
      }
    }

    case "tetrahedron": {
      const built = constructTetrahedron({
        ab: request.ab,
        ac: request.ac,
        bc: request.bc,
        pa: request.pa,
        pb: request.pb,
        pc: request.pc
      })
      if (!built) {
        return fail3d("infeasible", "inconsistent", "六条棱长不满足四面体存在不等式。")
      }
      const names = request.names ?? ["P", "A", "B", "C"]
      const pointRegistry: Record<string, Vector3> = {
        [names[0]!]: built.p,
        [names[1]!]: built.a,
        [names[2]!]: built.b,
        [names[3]!]: built.c
      }
      const vertices: Vector3[] = [built.a, built.b, built.c, built.p]
      const ringLabels = [names[1]!, names[2]!, names[3]!, names[0]!]
      const faceRings: number[][] = [
        [2, 1, 0],
        [0, 1, 3],
        [1, 2, 3],
        [2, 0, 3]
      ]
      const topo = verifyClosedPolyhedronTopology3(vertices, faceRings, tol)
      const maxEdge = Math.max(
        Math.abs(distanceVector3(built.a, built.b) - request.ab),
        Math.abs(distanceVector3(built.a, built.c) - request.ac),
        Math.abs(distanceVector3(built.b, built.c) - request.bc),
        Math.abs(distanceVector3(built.p, built.a) - request.pa),
        Math.abs(distanceVector3(built.p, built.b) - request.pb),
        Math.abs(distanceVector3(built.p, built.c) - request.pc)
      )
      return {
        status: topo.closed ? "solved" : "infeasible",
        residuals: {
          maxEdge,
          topologyClosed: topo.boundaryEdgeCount
        },
        constraintStatus: topo.closed && maxEdge <= tol ? "satisfied" : "inconsistent",
        pointRegistry,
        vertices,
        faceRings,
        namedFaceRings: faceRings.map((ring) => ring.map((idx) => ringLabels[idx]!)),
        topologyValid: topo.closed
      }
    }

    case "perpendicular_foot": {
      if (request.targetKind === "line") {
        const foot = projectPointOntoSegmentEndpoints3(request.point, request.line[0], request.line[1])
        if (!foot) {
          return fail3d("degenerate", "inconsistent", "直线两端点重合，无法求垂足。")
        }
        const dir = subtractVector3(request.line[1], request.line[0])
        const normDir = Math.hypot(dir.x, dir.y, dir.z)
        const leg = subtractVector3(request.point, foot)
        const legLen = Math.hypot(leg.x, leg.y, leg.z)
        const ortho = legLen > 1e-12 ? Math.abs(dotVector3(dir, leg)) / (normDir * legLen) : 0
        return {
          status: "solved",
          residuals: { orthogonality: ortho },
          constraintStatus: ortho <= tol ? "satisfied" : "violated",
          pointRegistry: { [request.resultName]: foot }
        }
      }
      const foot = projectPointOntoPlanePoints3(
        request.point,
        request.planePoints[0],
        request.planePoints[1],
        request.planePoints[2]
      )
      if (!foot) {
        return fail3d("degenerate", "inconsistent", "平面三点共线，无法确立平面垂足。")
      }
      const plane = planeFromPoints(request.planePoints[0], request.planePoints[1], request.planePoints[2])!
      const onPlane = Math.abs(dotVector3(plane.normal, foot) + plane.constant)
      return {
        status: "solved",
        residuals: { onPlane },
        constraintStatus: onPlane <= tol ? "satisfied" : "violated",
        pointRegistry: { [request.resultName]: foot }
      }
    }

    case "line_plane_relation": {
      const residual = evaluateLinePlaneRelation3(request.line, request.planePoints, request.relation)
      if (residual === null) {
        return fail3d("degenerate", "inconsistent", "直线或平面退化，无法判定线面关系。")
      }
      return {
        status: "solved",
        residuals: { relation: residual },
        constraintStatus: residual <= tol ? "satisfied" : "violated",
        pointRegistry: {}
      }
    }

    case "plane_plane_relation": {
      const residual = evaluatePlanePlaneRelation3(request.firstPlane, request.secondPlane, request.relation)
      if (residual === null) {
        return fail3d("degenerate", "inconsistent", "存在共线退化平面，无法判定面面关系。")
      }
      return {
        status: "solved",
        residuals: { relation: residual },
        constraintStatus: residual <= tol ? "satisfied" : "violated",
        pointRegistry: {}
      }
    }

    case "coplanar": {
      const residual = evaluateCoplanarPoints3(request.points)
      if (residual === null) {
        return fail3d("degenerate", "inconsistent", "点集全部共线或点数不足，无法构成对比平面。")
      }
      return {
        status: "solved",
        residuals: { coplanar: residual },
        constraintStatus: residual <= tol ? "satisfied" : "violated",
        pointRegistry: {}
      }
    }

    case "closed_polyhedron_topology": {
      const verdict = verifyClosedPolyhedronTopology3(request.vertices, request.faceRings, tol)
      return {
        status: verdict.closed ? "solved" : "infeasible",
        residuals: {
          boundaryEdges: verdict.boundaryEdgeCount,
          coplanarFace: verdict.coplanarResidual
        },
        constraintStatus: verdict.closed ? "satisfied" : "inconsistent",
        pointRegistry: {},
        topologyValid: verdict.closed,
        ...(verdict.reason ? { reason: verdict.reason } : {})
      }
    }

    case "interior_ratio": {
      if (request.targetKind === "edge") {
        const splitBetween = request.splitBetween ?? true
        if (!Number.isFinite(request.ratio) || (splitBetween && (request.ratio < 0 || request.ratio > 1))) {
          return fail3d("infeasible", "inconsistent", "棱内分点比例必须落在 [0, 1] 区间。")
        }
        const [a, b] = request.anchors
        const pt: Vector3 = {
          x: a.x + request.ratio * (b.x - a.x),
          y: a.y + request.ratio * (b.y - a.y),
          z: a.z + request.ratio * (b.z - a.z)
        }
        return {
          status: "solved",
          residuals: { ratio: 0 },
          constraintStatus: "satisfied",
          pointRegistry: { [request.resultName]: pt }
        }
      }
      const [w0, w1, w2] = request.weights
      const sum = w0 + w1 + w2
      if (![w0, w1, w2].every(Number.isFinite) || sum <= 1e-12 || w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) {
        return fail3d("infeasible", "inconsistent", "面内重心权重须非负且和为正。")
      }
      const [p0, p1, p2] = request.anchors
      const pt: Vector3 = {
        x: (w0 * p0.x + w1 * p1.x + w2 * p2.x) / sum,
        y: (w0 * p0.y + w1 * p1.y + w2 * p2.y) / sum,
        z: (w0 * p0.z + w1 * p1.z + w2 * p2.z) / sum
      }
      return {
        status: "solved",
        residuals: { barycentric: 0 },
        constraintStatus: "satisfied",
        pointRegistry: { [request.resultName]: pt }
      }
    }
  }
}
