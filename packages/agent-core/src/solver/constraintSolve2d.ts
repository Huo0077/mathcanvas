import type {
  CirclePrimitive,
  Coordinate,
  EllipsePrimitive,
  HyperbolaPrimitive,
  ParabolaPrimitive
} from "@draw/dsl"
import {
  commonTangents,
  conicFoci,
  evaluateFunctionDomainEvidence,
  evaluateFunctionWithDomain,
  evaluateSymbolicDerivative,
  intersectLinesDetailed,
  intersectLineWithConic,
  parseSymbolicConicEquation,
  pointToLineDistance2d,
  solveAffineRatioPoint2d,
  solveOrientedLineThroughPoint2d,
  solvePointOnLine2d,
  solveSymbolicConicContract,
  tangentsFromPoint,
  type ConicLine,
  type PlanarConic,
  type SymbolicConicMetricConstraint
} from "@draw/geometry-kernel"

import type { ConstraintStatus } from "../constraintGraph"

export type Solve2dStatus =
  | "solved"
  | "multiple_branches"
  | "infeasible"
  | "degenerate"
  | "underdetermined"
  | "unsupported"

export type Solve2dDomainStatus =
  | "valid"
  | "partial_breaks"
  | "empty_domain"
  | "invalid_expression"
  | "not_applicable"

export interface ConstraintSolve2dRoot {
  point?: Coordinate
  endpoint?: Coordinate
  parameter?: number
  x?: number
  y?: number
  slope?: number | null
  intercept?: number | null
  branch?: number | string
  conic?: EllipsePrimitive | HyperbolaPrimitive | ParabolaPrimitive
}

export interface ConstraintSolve2dResult {
  status: Solve2dStatus
  roots: ConstraintSolve2dRoot[]
  selectedBranch: number | string | null
  residual: number
  domainStatus: Solve2dDomainStatus
  constraintStatus: ConstraintStatus
  foci?: Coordinate[]
  eccentricity?: number
  reason?: string
}

export type ConicBranchPreference = "positive_x" | "negative_x" | "positive_y" | "negative_y"

export type ConstraintSolve2dRequest =
  | {
      kind: "point_on_line"
      line: readonly [Coordinate, Coordinate]
      parameter?: number
      candidate?: Coordinate
      tolerance?: number
    }
  | {
      kind: "line_intersection"
      first: readonly [Coordinate, Coordinate]
      second: readonly [Coordinate, Coordinate]
      tolerance?: number
    }
  | {
      kind: "collinear"
      points: readonly [Coordinate, Coordinate, Coordinate]
      tolerance?: number
    }
  | {
      kind: "midpoint"
      a: Coordinate
      b: Coordinate
      candidate?: Coordinate
      tolerance?: number
    }
  | {
      kind: "segment_ratio"
      a: Coordinate
      b: Coordinate
      ratio: number
      mode?: "affine" | "ap_to_pb"
      splitBetween?: boolean
      candidate?: Coordinate
      tolerance?: number
    }
  | {
      kind: "equal_distance"
      targets: readonly [Coordinate, Coordinate]
      distancePoint?: Coordinate
      candidate?: Coordinate
      tolerance?: number
    }
  | {
      kind: "perpendicular"
      line: readonly [Coordinate, Coordinate]
      throughPoint: Coordinate
      length?: number
      candidateLine?: readonly [Coordinate, Coordinate]
      tolerance?: number
    }
  | {
      kind: "parallel"
      line: readonly [Coordinate, Coordinate]
      throughPoint: Coordinate
      length?: number
      candidateLine?: readonly [Coordinate, Coordinate]
      tolerance?: number
    }
  | {
      kind: "conic_line_intersection"
      line: ConicLine
      conic: PlanarConic
      branchIndex?: number
      branchPreference?: ConicBranchPreference
      tolerance?: number
    }
  | {
      kind: "function_domain"
      expression: string
      domain: [number, number]
      x?: number
      steps?: number
    }
  | {
      kind: "tangent_at_x"
      expression: string
      domain: [number, number]
      x: number
    }
  | {
      kind: "tangent_from_point"
      expression: string
      domain: [number, number]
      point: Coordinate
      branchIndex?: number
    }
  | {
      kind: "common_tangent"
      firstExpression: string
      secondExpression: string
      firstDomain: [number, number]
      secondDomain: [number, number]
      branchIndex?: number
    }
  | {
      kind: "conic_foci_eccentricity"
      conic: EllipsePrimitive | HyperbolaPrimitive | ParabolaPrimitive | CirclePrimitive
    }
  | {
      kind: "conic_foci_eccentricity"
      symbolicEquation: string
      metrics: readonly SymbolicConicMetricConstraint[]
      extraDomains?: readonly string[]
    }

const DEFAULT_TOLERANCE = 1e-6

function selectConicBranch(
  points: readonly Coordinate[],
  branchIndex?: number,
  preference?: ConicBranchPreference
): { ordered: Coordinate[]; selectedBranch: number } {
  if (points.length <= 1) return { ordered: [...points], selectedBranch: 0 }
  const ordered = [...points]
  if (preference === "positive_x") {
    ordered.sort((p, q) => q.x - p.x)
  } else if (preference === "negative_x") {
    ordered.sort((p, q) => p.x - q.x)
  } else if (preference === "positive_y") {
    ordered.sort((p, q) => q.y - p.y)
  } else if (preference === "negative_y") {
    ordered.sort((p, q) => p.y - q.y)
  }
  const clamped = branchIndex !== undefined
    ? Math.max(0, Math.min(ordered.length - 1, Math.round(branchIndex)))
    : 0
  return { ordered, selectedBranch: clamped }
}

function numericEccentricity(
  conic: EllipsePrimitive | HyperbolaPrimitive | ParabolaPrimitive | CirclePrimitive
): number {
  if (conic.type === "circle") return 0
  if (conic.type === "parabola") return 1
  if (conic.type === "ellipse") {
    const major = Math.max(conic.radiusX, conic.radiusY)
    const minor = Math.min(conic.radiusX, conic.radiusY)
    return major > 0 && minor > 0 ? Math.sqrt(Math.max(0, major * major - minor * minor)) / major : Number.NaN
  }
  const a = conic.axis === "x" ? conic.radiusX : conic.radiusY
  const b = conic.axis === "x" ? conic.radiusY : conic.radiusX
  return a > 0 && b > 0 ? Math.hypot(a, b) / a : Number.NaN
}

function failResult(
  status: Solve2dStatus,
  constraintStatus: ConstraintStatus,
  domainStatus: Solve2dDomainStatus,
  reason: string,
  residual = Number.POSITIVE_INFINITY
): ConstraintSolve2dResult {
  return {
    status,
    roots: [],
    selectedBranch: null,
    residual,
    domainStatus,
    constraintStatus,
    reason
  }
}

export function solveConstraint2d(request: ConstraintSolve2dRequest): ConstraintSolve2dResult {
  const tol = request.kind === "function_domain" || request.kind === "tangent_at_x" || request.kind === "tangent_from_point" || request.kind === "common_tangent" || request.kind === "conic_foci_eccentricity"
    ? DEFAULT_TOLERANCE
    : (request.tolerance ?? DEFAULT_TOLERANCE)

  switch (request.kind) {
    case "point_on_line": {
      const solved = solvePointOnLine2d(request.line[0], request.line[1], {
        parameter: request.parameter,
        candidate: request.candidate
      })
      if (solved.degenerate || !solved.point) {
        return failResult("degenerate", "inconsistent", "not_applicable", "直线两点重合，无法确定线约束。")
      }
      const satisfied = solved.residual <= tol
      return {
        status: satisfied ? "solved" : "infeasible",
        roots: [{ point: solved.point, parameter: solved.parameter ?? undefined }],
        selectedBranch: 0,
        residual: solved.residual,
        domainStatus: "not_applicable",
        constraintStatus: satisfied ? "satisfied" : "violated"
      }
    }

    case "line_intersection": {
      const res = intersectLinesDetailed(
        { id: "l1", type: "line", label: "L1", a: request.first[0], b: request.first[1] },
        { id: "l2", type: "line", label: "L2", a: request.second[0], b: request.second[1] }
      )
      if (res.kind === "point") {
        return {
          status: "solved",
          roots: [{ point: res.point }],
          selectedBranch: 0,
          residual: 0,
          domainStatus: "not_applicable",
          constraintStatus: "satisfied"
        }
      }
      if (res.kind === "coincident") {
        return failResult("underdetermined", "underdetermined", "not_applicable", "两条直线重合，交点不唯一。")
      }
      if (res.kind === "none") {
        return failResult("infeasible", "inconsistent", "not_applicable", "两条直线平行，不存在有限交点。")
      }
      return failResult("degenerate", "inconsistent", "not_applicable", res.kind === "degenerate" ? res.reason : "直线端点退化。")
    }

    case "collinear": {
      const [p1, p2, p3] = request.points
      const d12 = pointToLineDistance2d(p1, p2, p3)
      if (d12 === null) {
        return failResult("degenerate", "inconsistent", "not_applicable", "前两个点重合，无法判定三点共线。")
      }
      const satisfied = d12 <= tol
      return {
        status: "solved",
        roots: satisfied ? [{ point: p3 }] : [],
        selectedBranch: satisfied ? 0 : null,
        residual: d12,
        domainStatus: "not_applicable",
        constraintStatus: satisfied ? "satisfied" : "violated"
      }
    }

    case "midpoint": {
      const solved = solveAffineRatioPoint2d(request.a, request.b, 0.5, request.candidate)
      if (!solved.point) {
        return failResult("degenerate", "inconsistent", "not_applicable", "端点坐标无效。")
      }
      const satisfied = solved.residual <= tol
      return {
        status: "solved",
        roots: [{ point: solved.point, parameter: 0.5 }],
        selectedBranch: 0,
        residual: solved.residual,
        domainStatus: "not_applicable",
        constraintStatus: satisfied ? "satisfied" : "violated"
      }
    }

    case "segment_ratio": {
      let t = request.ratio
      if (request.mode === "ap_to_pb") {
        if (!Number.isFinite(request.ratio) || request.ratio <= -1) {
          return failResult("infeasible", "inconsistent", "not_applicable", "定比分点比值无效（1 + ratio <= 0）。")
        }
        t = request.ratio / (1 + request.ratio)
      }
      if (request.splitBetween && (t < 0 || t > 1)) {
        return failResult("infeasible", "inconsistent", "not_applicable", "要求点在线段内部，但比例参数越出 [0, 1]。")
      }
      const solved = solveAffineRatioPoint2d(request.a, request.b, t, request.candidate)
      if (!solved.point) {
        return failResult("degenerate", "inconsistent", "not_applicable", "端点坐标无效。")
      }
      const satisfied = solved.residual <= tol
      return {
        status: "solved",
        roots: [{ point: solved.point, parameter: t }],
        selectedBranch: 0,
        residual: solved.residual,
        domainStatus: "not_applicable",
        constraintStatus: satisfied ? "satisfied" : "violated"
      }
    }

    case "equal_distance": {
      const [pA, pB] = request.targets
      const pt = request.candidate ?? request.distancePoint
      if (!pt) {
        const mid = solveAffineRatioPoint2d(pA, pB, 0.5)
        return {
          status: "underdetermined",
          roots: mid.point ? [{ point: mid.point }] : [],
          selectedBranch: null,
          residual: 0,
          domainStatus: "not_applicable",
          constraintStatus: "underdetermined",
          reason: "等距轨迹为垂直平分线，需提供候选点或方向以锁定唯一解。"
        }
      }
      const dA = Math.hypot(pt.x - pA.x, pt.y - pA.y)
      const dB = Math.hypot(pt.x - pB.x, pt.y - pB.y)
      const residual = Math.abs(dA - dB)
      const satisfied = residual <= tol
      return {
        status: "solved",
        roots: satisfied ? [{ point: pt }] : [],
        selectedBranch: satisfied ? 0 : null,
        residual,
        domainStatus: "not_applicable",
        constraintStatus: satisfied ? "satisfied" : "violated"
      }
    }

    case "perpendicular":
    case "parallel": {
      const solved = solveOrientedLineThroughPoint2d(request.line, request.throughPoint, request.kind, {
        length: request.length,
        candidateLine: request.candidateLine
      })
      if (!solved) {
        return failResult("degenerate", "inconsistent", "not_applicable", "基线或过定点坐标退化。")
      }
      const satisfied = solved.residual <= tol
      return {
        status: "solved",
        roots: [{
          point: solved.point,
          endpoint: solved.endpoint,
          slope: solved.slope,
          intercept: solved.intercept
        }],
        selectedBranch: 0,
        residual: solved.residual,
        domainStatus: "not_applicable",
        constraintStatus: satisfied ? "satisfied" : "violated"
      }
    }

    case "conic_line_intersection": {
      const hit = intersectLineWithConic(request.line, request.conic)
      if (hit.kind === "degenerate") {
        return failResult("degenerate", "inconsistent", "not_applicable", hit.reason)
      }
      if (hit.kind === "none") {
        return failResult("infeasible", "inconsistent", "not_applicable", "直线与圆锥曲线无实交点（Δ < 0）。", hit.residual)
      }
      if (hit.kind === "single" || hit.kind === "tangent") {
        const satisfied = hit.residual <= tol
        return {
          status: "solved",
          roots: [{ point: hit.point, branch: 0 }],
          selectedBranch: 0,
          residual: hit.residual,
          domainStatus: "not_applicable",
          constraintStatus: satisfied ? "satisfied" : "repairable"
        }
      }
      const { ordered, selectedBranch } = selectConicBranch(hit.points, request.branchIndex, request.branchPreference)
      return {
        status: "multiple_branches",
        roots: ordered.map((point, index) => ({ point, branch: index })),
        selectedBranch,
        residual: hit.residual,
        domainStatus: "not_applicable",
        constraintStatus: hit.residual <= tol ? "satisfied" : "repairable"
      }
    }

    case "function_domain": {
      const evidence = evaluateFunctionDomainEvidence(request.expression, request.domain, { steps: request.steps })
      if (evidence.domainStatus === "invalid_expression") {
        return failResult("unsupported", "inconsistent", "invalid_expression", evidence.note)
      }
      if (evidence.domainStatus === "empty_domain") {
        return failResult("infeasible", "inconsistent", "empty_domain", evidence.note)
      }
      if (request.x !== undefined) {
        if (request.x < request.domain[0] || request.x > request.domain[1]) {
          return failResult("infeasible", "inconsistent", evidence.domainStatus, `自变量 x=${request.x} 超出声明定义域。`)
        }
        const evaluated = evaluateFunctionWithDomain(request.expression, request.x)
        if (!evaluated.ok) {
          return failResult("infeasible", "inconsistent", evidence.domainStatus, evaluated.error ?? "点在函数定义域外。")
        }
        return {
          status: "solved",
          roots: [{ x: request.x, y: evaluated.value, point: { x: request.x, y: evaluated.value } }],
          selectedBranch: 0,
          residual: 0,
          domainStatus: evidence.domainStatus,
          constraintStatus: "satisfied"
        }
      }
      return {
        status: "solved",
        roots: [],
        selectedBranch: 0,
        residual: 0,
        domainStatus: evidence.domainStatus,
        constraintStatus: "satisfied",
        reason: evidence.note
      }
    }

    case "tangent_at_x": {
      if (request.x < request.domain[0] || request.x > request.domain[1]) {
        return failResult("infeasible", "inconsistent", "empty_domain", `切点 x=${request.x} 超出区间 [${request.domain[0]}, ${request.domain[1]}]。`)
      }
      const val = evaluateFunctionWithDomain(request.expression, request.x)
      if (!val.ok) {
        return failResult("infeasible", "inconsistent", "empty_domain", val.error ?? "切点不在定义域内。")
      }
      const deriv = evaluateSymbolicDerivative(request.expression, request.x)
      if (!deriv.ok) {
        return failResult("unsupported", "inconsistent", "invalid_expression", deriv.reason)
      }
      const intercept = val.value - deriv.value * request.x
      return {
        status: "solved",
        roots: [{
          x: request.x,
          y: val.value,
          point: { x: request.x, y: val.value },
          parameter: request.x,
          slope: deriv.value,
          intercept
        }],
        selectedBranch: 0,
        residual: 0,
        domainStatus: "valid",
        constraintStatus: "satisfied"
      }
    }

    case "tangent_from_point": {
      const domainEv = evaluateFunctionDomainEvidence(request.expression, request.domain)
      if (domainEv.domainStatus === "invalid_expression" || domainEv.domainStatus === "empty_domain") {
        return failResult("infeasible", "inconsistent", domainEv.domainStatus, domainEv.note)
      }
      const solved = tangentsFromPoint(request.expression, request.domain, request.point)
      if (solved.status === "unsupported") {
        return failResult("unsupported", "inconsistent", domainEv.domainStatus, solved.diagnostic ?? "外点切线求解不受支持。")
      }
      if (solved.tangents.length === 0) {
        return failResult("infeasible", "inconsistent", domainEv.domainStatus, "在声明定义域内不存在过该定点的切线。")
      }
      const selected = request.branchIndex !== undefined
        ? Math.max(0, Math.min(solved.tangents.length - 1, Math.round(request.branchIndex)))
        : 0
      const maxRes = Math.max(...solved.tangents.map((t) => t.residual))
      return {
        status: solved.tangents.length > 1 ? "multiple_branches" : "solved",
        roots: solved.tangents.map((t, index) => ({
          x: t.x,
          y: t.y,
          point: { x: t.x, y: t.y },
          parameter: t.parameter,
          slope: t.slope,
          intercept: t.intercept,
          branch: index
        })),
        selectedBranch: selected,
        residual: maxRes,
        domainStatus: domainEv.domainStatus,
        constraintStatus: "satisfied"
      }
    }

    case "common_tangent": {
      const d1 = evaluateFunctionDomainEvidence(request.firstExpression, request.firstDomain)
      const d2 = evaluateFunctionDomainEvidence(request.secondExpression, request.secondDomain)
      if (d1.domainStatus === "invalid_expression" || d1.domainStatus === "empty_domain") {
        return failResult("infeasible", "inconsistent", d1.domainStatus, d1.note)
      }
      if (d2.domainStatus === "invalid_expression" || d2.domainStatus === "empty_domain") {
        return failResult("infeasible", "inconsistent", d2.domainStatus, d2.note)
      }
      const solved = commonTangents(
        request.firstExpression,
        request.secondExpression,
        request.firstDomain,
        request.secondDomain
      )
      if (solved.status === "unsupported") {
        return failResult("unsupported", "inconsistent", "valid", solved.diagnostic ?? "公切线求解不受支持。")
      }
      if (solved.tangents.length === 0) {
        return failResult("infeasible", "inconsistent", "valid", "两条曲线在给定定义域上无公切线。")
      }
      const selected = request.branchIndex !== undefined
        ? Math.max(0, Math.min(solved.tangents.length - 1, Math.round(request.branchIndex)))
        : 0
      const maxRes = Math.max(...solved.tangents.map((t) => t.residual))
      return {
        status: solved.tangents.length > 1 ? "multiple_branches" : "solved",
        roots: solved.tangents.map((t, index) => ({
          x: t.first.x,
          y: t.first.y,
          point: { x: t.first.x, y: t.first.y },
          endpoint: { x: t.second.x, y: t.second.y },
          parameter: t.first.parameter,
          slope: t.slope,
          intercept: t.intercept,
          branch: index
        })),
        selectedBranch: selected,
        residual: maxRes,
        domainStatus: "valid",
        constraintStatus: "satisfied"
      }
    }

    case "conic_foci_eccentricity": {
      if ("conic" in request) {
        const foci = conicFoci(request.conic)
        const eccentricity = numericEccentricity(request.conic)
        if (!Number.isFinite(eccentricity)) {
          return failResult("degenerate", "inconsistent", "not_applicable", "圆锥曲线参数退化，无法求离心率。")
        }
        return {
          status: "solved",
          roots: foci.map((pt, index) => ({ point: pt, branch: index })),
          selectedBranch: 0,
          residual: 0,
          domainStatus: "not_applicable",
          constraintStatus: "satisfied",
          foci,
          eccentricity
        }
      }
      const parsed = parseSymbolicConicEquation(request.symbolicEquation, request.extraDomains ?? [])
      if (!parsed.ok) {
        return failResult("unsupported", "inconsistent", "invalid_expression", parsed.error)
      }
      const resolution = solveSymbolicConicContract(parsed, request.metrics, request.extraDomains ?? [])
      if (resolution.status === "invalid") {
        return failResult("infeasible", "inconsistent", "not_applicable", resolution.reason)
      }
      if (resolution.status === "underdetermined") {
        return failResult("underdetermined", "underdetermined", "not_applicable", resolution.reason)
      }
      const conic: EllipsePrimitive | HyperbolaPrimitive =
        resolution.conic.kind === "ellipse"
          ? {
              id: "solved-ellipse",
              type: "ellipse",
              label: "E",
              center: { x: 0, y: 0 },
              radiusX: resolution.conic.radiusX,
              radiusY: resolution.conic.radiusY
            }
          : {
              id: "solved-hyperbola",
              type: "hyperbola",
              label: "H",
              center: { x: 0, y: 0 },
              radiusX: resolution.conic.radiusX,
              radiusY: resolution.conic.radiusY,
              axis: resolution.conic.axis
            }
      const foci = conicFoci(conic)
      const eccentricity = numericEccentricity(conic)
      return {
        status: "solved",
        roots: [{ conic }],
        selectedBranch: 0,
        residual: resolution.independentCheck.residual,
        domainStatus: "valid",
        constraintStatus: "satisfied",
        foci,
        eccentricity
      }
    }
  }
}
