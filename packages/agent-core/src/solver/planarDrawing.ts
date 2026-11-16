import type { CirclePrimitive, Coordinate, EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"
import {
  conicFoci,
  conicResidualAt,
  ellipseFromFociAndPoint,
  evaluateExpressionWithDomain,
  fitOriginConicThroughPoints,
  hyperbolaFromFociAndPoint,
  intersectParametricLineWithConic,
  tangentLineToConicAt,
  type PlanarConic
} from "@draw/geometry-kernel"
import type { DraftAction } from "@draw/scene-graph"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import { parseDiagramObligations } from "../diagramObligations"
import { normalizeGeometryPrompt } from "../latexNormalisation"

export type PlanarConicSpec = EllipsePrimitive | HyperbolaPrimitive | ParabolaPrimitive

export interface PlanarDrawingSummary {
  kind: "solved" | "free_choice" | "clarification"
  curveLabel?: string
  conics: readonly PlanarConicSpec[]
  circles: readonly CirclePrimitive[]
  domainExclusions: readonly string[]
  infeasibleConstraints: readonly string[]
  representativeChoices: readonly string[]
}

export interface PlanarDrawingPlanResult {
  plan: PlanEnvelope
  family: "planar-basics" | "conics-tangents"
  skillIds: readonly ("planar-basics" | "conics-tangents" | "dynamic-bindings")[]
  diagramPrompt: string
  summary: PlanarDrawingSummary
}

interface SolvedCircle {
  label: string
  center: Coordinate
  radius: number
}

interface SolvedPoint {
  label: string
  point: Coordinate
}

interface SolvedLine {
  label: string
  a: Coordinate
  b: Coordinate
}

interface SolvedSegment {
  label?: string
  a: Coordinate
  b: Coordinate
}

function evalScalar(raw: string | undefined): number | null {
  if (!raw) return null
  let cleaned = raw
    .trim()
    .replace(/^[=＝:：\s]+/, "")
    .replace(/[，。；、！？.!?,;\s]+$/, "")
    .replace(/\\pi\b|π/g, "pi")
    .replace(/([0-9.]+)\s*°/g, "(($1)*pi/180)")
    .replace(/−/g, "-")
    .replace(/×/g, "*")
  if (cleaned.length === 0) return null
  // Convert Unicode √... into sqrt(...) for expression.ts
  cleaned = cleaned
    .replace(/(\d+(?:\.\d+)?)\s*√\s*\(([^()]+)\)/g, "$1*sqrt($2)")
    .replace(/(\d+(?:\.\d+)?)\s*√\s*(\d+(?:\.\d+)?)/g, "$1*sqrt($2)")
    .replace(/√\s*\(([^()]+)\)/g, "sqrt($1)")
    .replace(/√\s*(\d+(?:\.\d+)?)/g, "sqrt($1)")
  if (cleaned.includes("√")) return null
  const result = evaluateExpressionWithDomain(cleaned, {})
  if (!result.ok || !Number.isFinite(result.value)) return null
  return result.value
}

function isPureNonPlanarPrompt(normalized: string): boolean {
  if (/(?:棱柱|棱锥|四面体|正方体|立方体|圆锥|圆柱|圆台|翻折|对折|折起|二面角|异面|截面|空间四边形|多面体)/.test(normalized)) {
    return true
  }
  const hasConicCue = /(?:椭圆|双曲线|抛物线|焦点|准线|渐近线|离心率|斜率之积)/.test(normalized)
    || /x²\s*[+-]\s*y²|y²\s*[+-]\s*x²|y²\s*=\s*[^=\n]*x|x²\s*=\s*[^=\n]*y/.test(normalized)
  const isFunctionOnly = /(?:^|[^a-zA-Z])[fg]\s*\(\s*x\s*\)\s*=|定积分|单调(?:递)?[增减]|极[大小]值/.test(normalized)
  if (isFunctionOnly && !hasConicCue) return true
  const hasPlanarCue = hasConicCue || /(?:圆\s*[A-Z]?\s*[：:(]|x²\s*\+\s*y²|旋转角.*椭圆)/.test(normalized)
  return !hasPlanarCue
}

function detectCurveLabel(normalized: string): string {
  const labeled = normalized.match(/(?:椭圆|双曲线|抛物线|曲线)\s*([A-Z])(?![A-Z0-9])/u)
  if (labeled?.[1]) return labeled[1]
  const ref = normalized.match(/([A-Z])\s*上(?:一点|任意一点|的点|动点)/u)
  if (ref?.[1]) return ref[1]
  return "C"
}

function parseExplicitPoints(normalized: string): { named: Map<string, Coordinate>; anonymous: Coordinate[] } {
  const named = new Map<string, Coordinate>()
  const namedRegex = /([A-Z][0-9′'₁₂₃₄₅₆₇₈₉]?)\s*\(\s*([^(),\n]+?)\s*,\s*([^()\n]+?)\s*\)/g
  for (const match of normalized.matchAll(namedRegex)) {
    const label = match[1]!
    const x = evalScalar(match[2])
    const y = evalScalar(match[3])
    if (x !== null && y !== null) named.set(label, { x, y })
  }

  const anonymous: Coordinate[] = []
  const anonRegex = /过点\s*\(\s*([^(),\n]+?)\s*,\s*([^()\n]+?)\s*\)/g
  for (const match of normalized.matchAll(anonRegex)) {
    const x = evalScalar(match[1])
    const y = evalScalar(match[2])
    if (x !== null && y !== null) anonymous.push({ x, y })
  }
  return { named, anonymous }
}

function parseCircles(normalized: string): SolvedCircle[] {
  const circles: SolvedCircle[] = []
  // General circle: x²+y²+Dx+Ey+F=0
  const general = normalized.match(/x²\s*\+\s*y²((?:\s*[+-]\s*(?:(?:\d+(?:\.\d+)?(?:\/\d+)?)\s*)?[xy]|\s*[+-]\s*\d+(?:\.\d+)?(?:\/\d+)?)+)\s*=\s*0/)
  if (general?.[1]) {
    const tail = general[1].replace(/\s+/g, "")
    const coeffOf = (variable: "x" | "y"): number => {
      const m = tail.match(new RegExp(`([+-]?(?:\\d+(?:\\.\\d+)?(?:/\\d+)?)?)${variable}`))
      if (!m) return 0
      const raw = m[1]!
      if (raw === "" || raw === "+") return 1
      if (raw === "-") return -1
      return evalScalar(raw) ?? 0
    }
    const constStr = tail
      .replace(/[+-]?(?:\d+(?:\.\d+)?(?:\/\d+)?)?[xy]/g, "")
    const D = coeffOf("x")
    const E = coeffOf("y")
    const F = constStr.length > 0 ? (evalScalar(constStr) ?? 0) : 0
    const cx = -D / 2
    const cy = -E / 2
    const r2 = cx * cx + cy * cy - F
    if (r2 > 1e-12) {
      circles.push({ label: "O₁", center: { x: cx, y: cy }, radius: Math.sqrt(r2) })
    }
  }
  // Standard circle: (x-h)²+(y-k)²=r² or x²+y²=r²
  const standard = normalized.match(/(?:\(\s*x\s*([+-]\s*[^()]+)\)|x)²\s*\+\s*(?:\(\s*y\s*([+-]\s*[^()]+)\)|y)²\s*=\s*([^\s，。；,]+)/)
  if (standard && circles.length === 0) {
    const h = standard[1] ? -(evalScalar(standard[1]) ?? 0) : 0
    const k = standard[2] ? -(evalScalar(standard[2]) ?? 0) : 0
    const rhs = evalScalar(standard[3])
    if (rhs !== null && rhs > 1e-12) {
      circles.push({ label: "O₁", center: { x: h, y: k }, radius: Math.sqrt(rhs) })
    }
  }
  return circles
}

function parseExplicitConic(normalized: string, curveLabel: string): {
  conic: PlanarConicSpec | null
  domainExclusions: string[]
  isRepresentative: boolean
  representativeNotes: string[]
} {
  // 1. Natural description with center, semi-axes, optional rotation
  const desc = normalized.match(/中心在\s*\(\s*([^,()]+)\s*,\s*([^()]+)\s*\)[^。；\n]*?半长轴(?:为)?\s*([^\s、，,]+)\s*[、，,]?\s*半短轴(?:为)?\s*([^\s、，,]+)(?:[、，,]?\s*旋转角(?:为)?\s*([^\s、，,的]+))?[^。；\n]*椭圆/)
  if (desc) {
    const cx = evalScalar(desc[1])
    const cy = evalScalar(desc[2])
    const rx = evalScalar(desc[3])
    const ry = evalScalar(desc[4])
    const rot = desc[5] ? evalScalar(desc[5]) : 0
    if (cx !== null && cy !== null && rx !== null && ry !== null && rx > 0 && ry > 0 && rot !== null) {
      return {
        conic: {
          id: "planar-conic",
          type: "ellipse",
          center: { x: cx, y: cy },
          radiusX: rx,
          radiusY: ry,
          ...(Math.abs(rot) > 1e-12 ? { rotation: rot } : {}),
          label: curveLabel
        },
        domainExclusions: [],
        isRepresentative: false,
        representativeNotes: []
      }
    }
  }

  // 2. Numeric parabola: y² = kx or x² = ky
  const parabY = normalized.match(/y²\s*=\s*(\d+(?:\.\d+)?)\s*x(?![a-zA-Z0-9_])/)
  if (parabY) {
    const k = evalScalar(parabY[1])
    if (k !== null && k > 0) {
      return {
        conic: { id: "planar-conic", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: k / 2, axis: "x", label: curveLabel },
        domainExclusions: [],
        isRepresentative: false,
        representativeNotes: []
      }
    }
  }
  const parabX = normalized.match(/x²\s*=\s*(\d+(?:\.\d+)?)\s*y(?![a-zA-Z0-9_])/)
  if (parabX) {
    const k = evalScalar(parabX[1])
    if (k !== null && k > 0) {
      return {
        conic: { id: "planar-conic", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: k / 2, axis: "y", label: curveLabel },
        domainExclusions: [],
        isRepresentative: false,
        representativeNotes: []
      }
    }
  }

  // 3. Numeric ellipse x²/A + y²/B = 1 (allowing omitted /1)
  const numEllipse = normalized.match(/x²(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*\+\s*y²(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*=\s*1/)
  if (numEllipse) {
    const a2 = numEllipse[1] ? evalScalar(numEllipse[1]) : 1
    const b2 = numEllipse[2] ? evalScalar(numEllipse[2]) : 1
    if (a2 !== null && b2 !== null && a2 > 0 && b2 > 0) {
      return {
        conic: { id: "planar-conic", type: "ellipse", center: { x: 0, y: 0 }, radiusX: Math.sqrt(a2), radiusY: Math.sqrt(b2), label: curveLabel },
        domainExclusions: [],
        isRepresentative: false,
        representativeNotes: []
      }
    }
  }

  // 4. Numeric hyperbola x²/A - y²/B = 1 or y²/B - x²/A = 1
  const hypX = normalized.match(/x²(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*-\s*y²(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*=\s*1/)
  if (hypX) {
    const a2 = hypX[1] ? evalScalar(hypX[1]) : 1
    const b2 = hypX[2] ? evalScalar(hypX[2]) : 1
    if (a2 !== null && b2 !== null && a2 > 0 && b2 > 0) {
      return {
        conic: { id: "planar-conic", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: Math.sqrt(a2), radiusY: Math.sqrt(b2), axis: "x", label: curveLabel },
        domainExclusions: [],
        isRepresentative: false,
        representativeNotes: []
      }
    }
  }
  const hypY = normalized.match(/y²(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*-\s*x²(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*=\s*1/)
  if (hypY) {
    const b2 = hypY[1] ? evalScalar(hypY[1]) : 1
    const a2 = hypY[2] ? evalScalar(hypY[2]) : 1
    if (a2 !== null && b2 !== null && a2 > 0 && b2 > 0) {
      return {
        conic: { id: "planar-conic", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: Math.sqrt(a2), radiusY: Math.sqrt(b2), axis: "y", label: curveLabel },
        domainExclusions: [],
        isRepresentative: false,
        representativeNotes: []
      }
    }
  }

  return { conic: null, domainExclusions: [], isRepresentative: false, representativeNotes: [] }
}

function solveFromGeometricConditions(
  normalized: string,
  curveLabel: string,
  points: Map<string, Coordinate>
): {
  conic: PlanarConicSpec | null
  domainExclusions: string[]
  isRepresentative: boolean
  representativeNotes: string[]
  needsClarification?: string
} {
  // 1. Reuse parseDiagramObligations symbolic conic contract solver (eccentricity + major axis, hyperbola-asymptote-circle tangency, etc.)
  const parsedObligations = parseDiagramObligations(normalized)
  const solvedConicGiven = parsedObligations.givens.find(
    (g) => g.kind === "conicAxes" && g.conic !== undefined && g.conic.kind !== "circle"
  )
  if (solvedConicGiven?.conic && solvedConicGiven.conic.kind !== "circle") {
    const c = solvedConicGiven.conic
    const center = {
      x: "centerX" in c && typeof c.centerX === "number" ? c.centerX : 0,
      y: "centerY" in c && typeof c.centerY === "number" ? c.centerY : 0
    }
    if (c.kind === "ellipse") {
      return {
        conic: { id: "planar-conic", type: "ellipse", center, radiusX: c.radiusX, radiusY: c.radiusY, label: curveLabel },
        domainExclusions: [],
        isRepresentative: false,
        representativeNotes: []
      }
    }
    if (c.kind === "hyperbola") {
      return {
        conic: {
          id: "planar-conic",
          type: "hyperbola",
          center,
          radiusX: c.radiusX,
          radiusY: c.radiusY,
          axis: c.axis ?? "x",
          label: curveLabel
        },
        domainExclusions: [],
        isRepresentative: false,
        representativeNotes: []
      }
    }
  }
  const underdeterminedSymbolic = parsedObligations.givens.find(
    (g) => g.kind === "symbolicConic" && g.symbolicConic?.status === "underdetermined"
  )

  // 2. Foci distance |F₁F₂| = 2c + point on curve (e.g. JT-P06)
  const focalDistMatch = normalized.match(/\|F₁F₂\|\s*=\s*([^\s，。,；]+)|焦距(?:为|是)?\s*([^\s，。,；]+)/)
  if (focalDistMatch) {
    const twoC = evalScalar(focalDistMatch[1] ?? focalDistMatch[2])
    if (twoC !== null && twoC > 0) {
      const c = twoC / 2
      const yMajor = /y²\s*\/\s*a²\s*\+\s*x²\s*\/\s*b²|y²\s*\/\s*a²\s*-\s*x²\s*\/\s*b²/.test(normalized)
      const f1: Coordinate = yMajor ? { x: 0, y: -c } : { x: -c, y: 0 }
      const f2: Coordinate = yMajor ? { x: 0, y: c } : { x: c, y: 0 }
      const onCurveMatch = normalized.match(/([A-Z][0-9′'₁₂₃₄₅₆₇₈₉]?)\s*\([^)]+\)\s*(?:是|为|在)\s*(?:(?:椭圆|双曲线|曲线)\s*)?[A-Z]\s*上(?:一点|的点)/)
      const pt = onCurveMatch?.[1] ? points.get(onCurveMatch[1]) : undefined
      if (pt) {
        if (/双曲线/.test(normalized)) {
          const inv = hyperbolaFromFociAndPoint([f1, f2], pt)
          if (inv.kind === "solved") {
            return { conic: { ...inv.conic, id: "planar-conic", label: curveLabel }, domainExclusions: [], isRepresentative: false, representativeNotes: [] }
          }
        } else {
          const inv = ellipseFromFociAndPoint([f1, f2], pt)
          if (inv.kind === "solved") {
            return { conic: { ...inv.conic, id: "planar-conic", label: curveLabel }, domainExclusions: [], isRepresentative: false, representativeNotes: [] }
          }
        }
      }
    }
  }

  // 3. Locus via slope product k_PA * k_PB = lambda with symmetric anchor points A, B (JT-P08)
  const slopeProdMatch = normalized.match(/斜率之积(?:为|等于)?\s*([+-]?[^\s，。；,]+)/)
  if (slopeProdMatch) {
    const lambda = evalScalar(slopeProdMatch[1])
    const ptList = [...points.entries()]
    if (lambda !== null && Math.abs(lambda) > 1e-12 && ptList.length >= 2) {
      const pA = ptList[0]![1]
      const pB = ptList[1]![1]
      if (Math.abs(pA.x) < 1e-9 && Math.abs(pB.x) < 1e-9 && Math.abs(pA.y + pB.y) < 1e-9 && Math.abs(pA.y) > 1e-9) {
        const d2 = pA.y * pA.y
        if (lambda < 0) {
          const rx = Math.sqrt(d2 / -lambda)
          const ry = Math.abs(pA.y)
          return {
            conic: { id: "planar-conic", type: "ellipse", center: { x: 0, y: 0 }, radiusX: rx, radiusY: ry, label: curveLabel },
            domainExclusions: ["x≠0"],
            isRepresentative: false,
            representativeNotes: []
          }
        }
        return {
          conic: { id: "planar-conic", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: Math.sqrt(d2 / lambda), radiusY: Math.abs(pA.y), axis: "y", label: curveLabel },
          domainExclusions: ["x≠0"],
          isRepresentative: false,
          representativeNotes: []
        }
      }
      if (Math.abs(pA.y) < 1e-9 && Math.abs(pB.y) < 1e-9 && Math.abs(pA.x + pB.x) < 1e-9 && Math.abs(pA.x) > 1e-9) {
        const d2 = pA.x * pA.x
        if (lambda < 0) {
          return {
            conic: { id: "planar-conic", type: "ellipse", center: { x: 0, y: 0 }, radiusX: Math.abs(pA.x), radiusY: Math.sqrt(-lambda * d2), label: curveLabel },
            domainExclusions: [`x≠${Math.abs(pA.x)}`, `x≠-${Math.abs(pA.x)}`],
            isRepresentative: false,
            representativeNotes: []
          }
        }
      }
    }
  }

  // 4. Two-point origin conic fitter (JT-P07)
  if (/对称轴都在坐标轴|中心在原点|过点/.test(normalized) && points.size >= 2) {
    const firstTwo = [...points.values()].slice(0, 2) as [Coordinate, Coordinate]
    const expectedKind = /双曲线/.test(normalized) ? "hyperbola" : /椭圆/.test(normalized) ? "ellipse" : undefined
    const fitted = fitOriginConicThroughPoints(firstTwo, undefined, expectedKind)
    if (fitted) {
      return {
        conic: fitted.kind === "ellipse"
          ? { id: "planar-conic", type: "ellipse", center: { x: 0, y: 0 }, radiusX: fitted.radiusX, radiusY: fitted.radiusY, label: curveLabel }
          : { id: "planar-conic", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: fitted.radiusX, radiusY: fitted.radiusY, axis: fitted.axis, label: curveLabel },
        domainExclusions: [],
        isRepresentative: false,
        representativeNotes: []
      }
    }
  }

  // 5. Symbolic parabola / underdetermined schematic disclosure (示意图 vs clarify)
  if (underdeterminedSymbolic?.symbolicConic) {
    if (/示意/.test(normalized)) {
      if (underdeterminedSymbolic.symbolicConic.kind === "hyperbola") {
        return {
          conic: { id: "planar-conic", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1, axis: "x", label: curveLabel },
          domainExclusions: [],
          isRepresentative: true,
          representativeNotes: ["示意图采用满足约束的代表参数（a=2, b=1，free_choice），不作为唯一题设数值。"]
        }
      }
      return {
        conic: { id: "planar-conic", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1, label: curveLabel },
        domainExclusions: [],
        isRepresentative: true,
        representativeNotes: ["示意图采用满足 a>b>0 的代表参数（a=2, b=1，free_choice），不作为唯一题设数值。"]
      }
    }
    return {
      conic: null,
      domainExclusions: [],
      isRepresentative: false,
      representativeNotes: [],
      needsClarification: `圆锥曲线 ${curveLabel} 参数欠定，请补充决定半轴长或离心率等条件（如需示意图可标注“示意图”）。`
    }
  }

  return { conic: null, domainExclusions: [], isRepresentative: false, representativeNotes: [] }
}

/**
 * Solves for secant slope k >= 0 of line through (0, y0) intersecting ellipse x²/rx² + y²/ry² = 1
 * at A, B with triangle OAB area equal to targetArea.
 */
function solveOriginTriangleAreaSlope(rx: number, ry: number, y0: number, targetArea: number): number | null {
  if (!(rx > 0) || !(ry > 0) || !(Math.abs(y0) > 1e-9) || !(targetArea > 0)) return null
  const a2 = rx * rx
  const b2 = ry * ry
  const c2 = targetArea * targetArea
  const p = a2 * b2 * y0 * y0
  // Equation in u = k^2 >= 0:
  // c2 * (b2 + a2 * u)^2 = p * (a2 * u + b2 - y0^2)
  // => (c2 * a2^2) u^2 + (2 * c2 * a2 * b2 - p * a2) u + (c2 * b2^2 - p * (b2 - y0^2)) = 0
  const A = c2 * a2 * a2
  const B = 2 * c2 * a2 * b2 - p * a2
  const C = c2 * b2 * b2 - p * (b2 - y0 * y0)
  const disc = B * B - 4 * A * C
  if (disc < -1e-9) return null
  const root = Math.sqrt(Math.max(0, disc))
  const candidates = [(-B + root) / (2 * A), (-B - root) / (2 * A)]
    .filter((u) => Number.isFinite(u) && u >= -1e-12)
    .map((u) => Math.max(0, u))
  for (const u of candidates) {
    const discLine = a2 * u + b2 - y0 * y0
    if (discLine > 1e-12) return Math.sqrt(u)
  }
  return null
}

function intersectLines2D(a1: Coordinate, a2: Coordinate, b1: Coordinate, b2: Coordinate): Coordinate | null {
  const dx1 = a2.x - a1.x
  const dy1 = a2.y - a1.y
  const dx2 = b2.x - b1.x
  const dy2 = b2.y - b1.y
  const det = dx1 * (-dy2) - (-dx2) * dy1
  if (Math.abs(det) <= 1e-12) return null
  const rhsX = b1.x - a1.x
  const rhsY = b1.y - a1.y
  const t = (rhsX * (-dy2) - (-dx2) * rhsY) / det
  return { x: a1.x + t * dx1, y: a1.y + t * dy1 }
}

function pointOnEllipseForSlopeProduct(conic: PlanarConic, domainExcludeXZero: boolean): Coordinate | null {
  const verify = (point: Coordinate): Coordinate | null => {
    if (domainExcludeXZero && Math.abs(point.x) <= 1e-6) return null
    const res = conicResidualAt(conic, point)
    return res !== null && res.residual < 1e-9 ? point : null
  }
  if (conic.type === "ellipse") {
    // Pick t = pi/4: (rx * sqrt(2)/2, ry * sqrt(2)/2), guaranteeing x !== 0 and non-axis
    return verify({
      x: conic.center.x + conic.radiusX * Math.SQRT1_2,
      y: conic.center.y + conic.radiusY * Math.SQRT1_2
    })
  }
  if (conic.type === "hyperbola") {
    return verify({
      x: conic.center.x + (conic.axis === "x" ? conic.radiusX * Math.cosh(0.6) : conic.radiusX * Math.sinh(0.6)),
      y: conic.center.y + (conic.axis === "x" ? conic.radiusY * Math.sinh(0.6) : conic.radiusY * Math.cosh(0.6))
    })
  }
  return null
}

export function tryBuildPlanarDrawingPlan(prompt: string): PlanarDrawingPlanResult | null {
  const normalized = normalizeGeometryPrompt(prompt)
  if (isPureNonPlanarPrompt(normalized)) return null

  const curveLabel = detectCurveLabel(normalized)
  const { named: parsedPoints, anonymous: anonymousPoints } = parseExplicitPoints(normalized)
  const circles = parseCircles(normalized)

  const explicit = parseExplicitConic(normalized, curveLabel)
  let conic = explicit.conic
  let domainExclusions = [...explicit.domainExclusions]
  let isRepresentative = explicit.isRepresentative
  const representativeNotes = [...explicit.representativeNotes]
  const infeasibleConstraints: string[] = []

  if (conic === null) {
    const cond = solveFromGeometricConditions(normalized, curveLabel, parsedPoints)
    if (cond.needsClarification) {
      return {
        plan: {
          schemaVersion: PLAN_SCHEMA_VERSION,
          kind: "clarification",
          goal: `补充圆锥曲线 ${curveLabel} 的确定参数`,
          factIds: [],
          questions: [cond.needsClarification]
        },
        family: "conics-tangents",
        skillIds: ["planar-basics", "conics-tangents", "dynamic-bindings"],
        diagramPrompt: prompt,
        summary: {
          kind: "clarification",
          curveLabel,
          conics: [],
          circles: [],
          domainExclusions: [],
          infeasibleConstraints: [],
          representativeChoices: []
        }
      }
    }
    conic = cond.conic
    domainExclusions = [...cond.domainExclusions]
    isRepresentative = cond.isRepresentative
    representativeNotes.push(...cond.representativeNotes)
  }

  if (conic === null && circles.length === 0) return null

  const pointsToCreate: SolvedPoint[] = []
  const linesToCreate: SolvedLine[] = []
  const segmentsToCreate: SolvedSegment[] = []
  const seenPointLabels = new Set<string>()

  const addPoint = (label: string, point: Coordinate) => {
    if (seenPointLabels.has(label)) return
    seenPointLabels.add(label)
    pointsToCreate.push({ label, point })
  }

  // Add explicit named input points (M, A, B, C...)
  for (const [label, point] of parsedPoints.entries()) {
    addPoint(label, point)
  }

  // Origin O if mentioned as vertex or coordinate origin
  if (/(?:顶点为\s*O|O\s*为坐标原点|坐标原点)/.test(normalized)) {
    addPoint("O", { x: 0, y: 0 })
  }

  const domainOpt = domainExclusions.includes("x≠0") ? { excludeXZero: true } : undefined

  // Add foci F₁, F₂ if requested
  if (conic && /(?:焦点|F₁|F₂)/.test(normalized)) {
    const foci = conicFoci(conic)
    if (foci.length === 2) {
      addPoint("F₁", foci[0]!)
      addPoint("F₂", foci[1]!)
    } else if (foci.length === 1) {
      addPoint("F", foci[0]!)
    }
  }

  // Explicit tangent request on curve ("切线")
  if (conic && /标记[^。]*切线|并(?:作|画)切线/.test(normalized) && !/渐近线/.test(normalized)) {
    const anchor = conic.type === "ellipse"
      ? {
          x: conic.center.x + (conic.radiusX * Math.cos(0.6) * Math.cos(conic.rotation ?? 0) - conic.radiusY * Math.sin(0.6) * Math.sin(conic.rotation ?? 0)),
          y: conic.center.y + (conic.radiusX * Math.cos(0.6) * Math.sin(conic.rotation ?? 0) + conic.radiusY * Math.sin(0.6) * Math.cos(conic.rotation ?? 0))
        }
      : conic.type === "parabola"
        ? { x: conic.vertex.x + (conic.axis === "x" ? conic.focalParameter / 2 : conic.focalParameter), y: conic.vertex.y + (conic.axis === "x" ? conic.focalParameter : conic.focalParameter / 2) }
        : { x: conic.center.x + (conic.axis === "x" ? conic.radiusX : 0), y: conic.center.y + (conic.axis === "x" ? 0 : conic.radiusY) }
    const tangent = tangentLineToConicAt(conic, anchor, 4)
    if (tangent) {
      linesToCreate.push({ label: "切线", a: tangent.line.a, b: tangent.line.b })
    }
  }

  // JT-P06 subquestion (2): P on ellipse with PF₁⊥PF₂
  if (conic?.type === "ellipse" && /P\s*为\s*[A-Z]\s*上一点[^。]*PF₁\s*⊥\s*PF₂/.test(normalized)) {
    const a = Math.max(conic.radiusX, conic.radiusY)
    const b = Math.min(conic.radiusX, conic.radiusY)
    const c = Math.sqrt(Math.max(0, a * a - b * b))
    if (c >= b - 1e-9 && c > 1e-12) {
      const localX = (a * Math.sqrt(Math.max(0, c * c - b * b))) / c
      const localY = (b * b) / c
      const pCoord: Coordinate = conic.radiusX >= conic.radiusY
        ? { x: conic.center.x + localX, y: conic.center.y + localY }
        : { x: conic.center.x + localY, y: conic.center.y + localX }
      addPoint("P", pCoord)
    } else {
      infeasibleConstraints.push(`PF₁⊥PF₂ 在当前椭圆 (c=${c.toPrecision(4)} < b=${b.toPrecision(4)}) 上无实数点解，已保留主干与(1)真实图元而不伪造点 P。`)
    }
  }

  // Representative dynamic point P(x, y) if mentioned as locus moving point (JT-P08)
  if (conic && /动点\s*P\s*\(\s*x\s*,\s*y\s*\)/.test(normalized) && !seenPointLabels.has("P")) {
    const sampleP = pointOnEllipseForSlopeProduct(conic, domainExclusions.includes("x≠0"))
    if (sampleP) addPoint("P", sampleP)
  }

  // Vector split chord through C (JT-P08: 向量EC = r * 向量CF -> C - E = r*(F - C))
  const vectorRatioMatch = normalized.match(/过点\s*([A-Z])\s*\([^)]+\)\s*的直线[^。]*相交于\s*([A-Z])\s*[、,，]\s*([A-Z])\s*两点[^。]*?(?:向量\s*|\u2192)?([A-Z]{2})\s*=\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*(?:向量\s*|\u2192)?([A-Z]{2})/)
  if (conic?.type === "ellipse" && vectorRatioMatch) {
    const baseLabel = vectorRatioMatch[1]!
    const firstEnd = vectorRatioMatch[2]!
    const secondEnd = vectorRatioMatch[3]!
    const ratio = evalScalar(vectorRatioMatch[5])
    const basePt = parsedPoints.get(baseLabel)
    if (basePt && ratio !== null && ratio > 0 && Math.abs(ratio - 1) > 1e-9 && Math.abs(basePt.x) < 1e-9) {
      // C - E = ratio * (F - C) => E = (1 + ratio)*C - ratio*F
      const ry2 = conic.radiusY * conic.radiusY
      const cy = basePt.y
      const yF = ((1 + ratio) ** 2 * cy * cy - (1 - ratio * ratio) * ry2) / (2 * ratio * (1 + ratio) * cy)
      const ratioY = (yF * yF) / ry2
      if (ratioY < 1 - 1e-9) {
        const xF = conic.radiusX * Math.sqrt(1 - ratioY)
        const dir = { x: xF - basePt.x, y: yF - basePt.y }
        const inter = intersectParametricLineWithConic({ origin: basePt, direction: dir }, conic, domainOpt)
        if (inter.kind === "secant") {
          const pF = inter.points.find((pt) => pt.x * xF > 0 && Math.abs(pt.y - yF) < 1e-6) ?? inter.points[0]!
          const pE = inter.points.find((pt) => pt !== pF) ?? inter.points[1]!
          addPoint(firstEnd, pE)
          addPoint(secondEnd, pF)
          linesToCreate.push({ label: `${firstEnd}${secondEnd}`, a: pE, b: pF })
        }
      }
    }
  }

  // General secant chord through point (x0, y0): 过点(x0, y0)的直线[l]交[C]于A、B两点 OR 与C交于A、B两点
  const chordMatch = normalized.match(/过点\s*(?:[A-Z]\s*)?\(\s*([^(),\n]+?)\s*,\s*([^()\n]+?)\s*\)\s*的直线(?:\s*([a-z]))?\s*(?:与?\s*(?:椭圆|双曲线|抛物线|曲线|[A-Z])?\s*相?交\s*(?:(?:椭圆|双曲线|抛物线|曲线)?\s*[A-Z])?\s*于)\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点/)
  if (conic && chordMatch && (!seenPointLabels.has(chordMatch[4]!) || !seenPointLabels.has(chordMatch[5]!))) {
    const x0 = evalScalar(chordMatch[1])
    const y0 = evalScalar(chordMatch[2])
    const lineLabel = chordMatch[3] ?? "l"
    const p1Label = chordMatch[4]!
    const p2Label = chordMatch[5]!
    if (x0 !== null && y0 !== null) {
      let slope: number | null = null
      const areaMatch = normalized.match(/面积(?:为|等于)?\s*([^\s，。；,]+)/)
      if (conic.type === "ellipse" && Math.abs(x0) < 1e-9 && areaMatch) {
        const targetArea = evalScalar(areaMatch[1])
        if (targetArea !== null) {
          slope = solveOriginTriangleAreaSlope(conic.radiusX, conic.radiusY, y0, targetArea)
        }
      }
      const tryDirections: Coordinate[] = slope !== null
        ? [{ x: 1, y: slope }]
        : [{ x: 1, y: 1 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }]
      for (const dir of tryDirections) {
        const res = intersectParametricLineWithConic({ origin: { x: x0, y: y0 }, direction: dir }, conic, domainOpt)
        if (res.kind === "secant") {
          addPoint(p1Label, res.points[0]!)
          addPoint(p2Label, res.points[1]!)
          linesToCreate.push({ label: lineLabel, a: res.points[0]!, b: res.points[1]! })
          if (slope === null) {
            isRepresentative = true
            representativeNotes.push(`过点 (${x0}, ${y0}) 的动直线取一条代表性割线以展示交点 ${p1Label}、${p2Label}（free_choice）。`)
          }
          break
        }
      }
    }
  } else if (conic && anonymousPoints.length > 0 && /交于\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点/.test(normalized)) {
    // Fallback secant if wording varies slightly
    const ptsMatch = normalized.match(/交于\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点/)!
    const origin = anonymousPoints[0]!
    if (!seenPointLabels.has(ptsMatch[1]!) || !seenPointLabels.has(ptsMatch[2]!)) {
      const res = intersectParametricLineWithConic({ origin, direction: { x: 1, y: 1 } }, conic, domainOpt)
      if (res.kind === "secant") {
        addPoint(ptsMatch[1]!, res.points[0]!)
        addPoint(ptsMatch[2]!, res.points[1]!)
        linesToCreate.push({ label: "l", a: res.points[0]!, b: res.points[1]! })
        isRepresentative = true
        representativeNotes.push(`动直线取一条代表性割线以展示交点 ${ptsMatch[1]}、${ptsMatch[2]}（free_choice）。`)
      }
    }
  }

  // Aux line intersection for pairs (e.g. JT-P03: 直线 OA, OB 分别与直线 l: y=x+1 交于点 D, E; JT-P07: 直线 BP, BQ 分别交直线 x=3 于 E, F 两点)
  const pairLineMatch = normalized.match(/直线\s*([A-Z])([A-Z])\s*[，,、]\s*(?:直线\s*)?([A-Z])([A-Z])\s*分别(?:与|交)\s*直线(?:\s*[a-z]\s*[：:])?\s*(?:(x\s*=\s*[-+*/0-9a-zA-Z.\s]+?)|(y\s*=\s*[-+*/0-9a-zA-Z.\s]+?))\s*(?:相?交)?于点?\s*([A-Z])\s*[，,、]\s*([A-Z])/)
  if (pairLineMatch) {
    const getPt = (lbl: string) => pointsToCreate.find((p) => p.label === lbl)?.point ?? parsedPoints.get(lbl)
    const p1A = getPt(pairLineMatch[1]!)
    const p1B = getPt(pairLineMatch[2]!)
    const p2A = getPt(pairLineMatch[3]!)
    const p2B = getPt(pairLineMatch[4]!)
    const out1 = pairLineMatch[7]!
    const out2 = pairLineMatch[8]!
    let auxA: Coordinate | null = null
    let auxB: Coordinate | null = null
    let auxLabel = "l"
    if (pairLineMatch[5]) {
      const xConst = evalScalar(pairLineMatch[5].split("=")[1])
      if (xConst !== null) {
        auxA = { x: xConst, y: -5 }
        auxB = { x: xConst, y: 5 }
        auxLabel = `x=${xConst}`
      }
    } else if (pairLineMatch[6]) {
      const rhs = pairLineMatch[6].split("=")[1]?.replace(/\s+/g, "") ?? ""
      const lineExpr = rhs.match(/^([+-]?(?:\d+(?:\.\d+)?)?)?\*?x(?:\s*([+-]\s*\d+(?:\.\d+)?))?$/)
      const m = lineExpr ? (lineExpr[1] === undefined || lineExpr[1] === "" || lineExpr[1] === "+" ? 1 : lineExpr[1] === "-" ? -1 : evalScalar(lineExpr[1])) : null
      const q = lineExpr?.[2] ? evalScalar(lineExpr[2]) : 0
      if (m !== null && q !== null) {
        auxA = { x: -4, y: -4 * m + q }
        auxB = { x: 4, y: 4 * m + q }
        auxLabel = `y=${rhs}`
      }
    }
    if (auxA && auxB && p1A && p1B && p2A && p2B) {
      linesToCreate.push({ label: auxLabel, a: auxA, b: auxB })
      const dPt = intersectLines2D(p1A, p1B, auxA, auxB)
      const ePt = intersectLines2D(p2A, p2B, auxA, auxB)
      if (dPt) {
        addPoint(out1, dPt)
        segmentsToCreate.push({ a: p1A, b: dPt })
      }
      if (ePt) {
        addPoint(out2, ePt)
        segmentsToCreate.push({ a: p2A, b: ePt })
      }
    }
  }

  // Verify points declared on conic really satisfy residual
  if (conic) {
    for (const pt of pointsToCreate) {
      if (seenPointLabels.has(pt.label)) {
        const res = conicResidualAt(conic, pt.point)
        if (res === null) return null
      }
    }
  }

  const assumptions = [
    ...(isRepresentative ? representativeNotes : []),
    ...infeasibleConstraints,
    ...domainExclusions.map((domain) => `轨迹定义域排除 ${domain}。`)
  ]
  if (assumptions.some((a) => /示意|representative|free_choice/i.test(a))) {
    // preserve free_choice marker in assumption string
  }

  const actions = actionDraftsToPlanActions(
    conic,
    curveLabel,
    circles,
    pointsToCreate,
    linesToCreate,
    segmentsToCreate
  )

  const family: "planar-basics" | "conics-tangents" = conic ? "conics-tangents" : "planar-basics"

  return {
    plan: {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "构造经内核代数求解与定义域核验的平面/圆锥曲线主体及辅助图元",
      factIds: [],
      ...(assumptions.length > 0 ? { assumptions } : {}),
      actions
    },
    family,
    skillIds: conic ? ["planar-basics", "conics-tangents", "dynamic-bindings"] : ["planar-basics"],
    diagramPrompt: prompt,
    summary: {
      kind: isRepresentative ? "free_choice" : "solved",
      curveLabel,
      conics: conic ? [conic] : [],
      circles: circles.map((c, idx) => ({ id: `circle-${idx + 1}`, type: "circle", center: c.center, radius: c.radius, label: c.label })),
      domainExclusions,
      infeasibleConstraints,
      representativeChoices: representativeNotes
    }
  }
}

function actionDraftsToPlanActions(
  conic: PlanarConicSpec | null,
  curveLabel: string,
  circles: readonly SolvedCircle[],
  pointsToCreate: readonly SolvedPoint[],
  linesToCreate: readonly SolvedLine[],
  segmentsToCreate: readonly SolvedSegment[]
): DraftAction[] {
  const actions: DraftAction[] = []
  let aliasCounter = 1
  const nextAlias = (prefix: string) => `${prefix}_${aliasCounter++}`

  if (conic) {
    if (conic.type === "ellipse") {
      actions.push({
        actionId: "planar.create_conic",
        actionKey: "planar-conic",
        factIds: [],
        inputs: {
          alias: nextAlias("conic"),
          kind: "ellipse",
          center: conic.center,
          radiusX: conic.radiusX,
          radiusY: conic.radiusY,
          ...(conic.rotation === undefined ? {} : { rotation: conic.rotation }),
          label: curveLabel
        }
      })
    } else if (conic.type === "hyperbola") {
      actions.push({
        actionId: "planar.create_conic",
        actionKey: "planar-conic",
        factIds: [],
        inputs: {
          alias: nextAlias("conic"),
          kind: "hyperbola",
          center: conic.center,
          radiusX: conic.radiusX,
          radiusY: conic.radiusY,
          axis: conic.axis,
          ...(conic.rotation === undefined ? {} : { rotation: conic.rotation }),
          label: curveLabel
        }
      })
    } else {
      actions.push({
        actionId: "planar.create_conic",
        actionKey: "planar-conic",
        factIds: [],
        inputs: {
          alias: nextAlias("conic"),
          kind: "parabola",
          vertex: conic.vertex,
          focalParameter: conic.focalParameter,
          axis: conic.axis,
          ...(conic.rotation === undefined ? {} : { rotation: conic.rotation }),
          label: curveLabel
        }
      })
    }
  }

  for (const circle of circles) {
    const key = nextAlias("circle")
    actions.push({
      actionId: "planar.create_circle",
      actionKey: key,
      factIds: [],
      inputs: {
        alias: key,
        center: circle.center,
        radius: circle.radius,
        label: circle.label
      }
    })
  }

  for (const pt of pointsToCreate) {
    const key = nextAlias("pt")
    actions.push({
      actionId: "planar.create_point",
      actionKey: key,
      factIds: [],
      inputs: {
        alias: key,
        points: [pt.point],
        label: pt.label
      }
    })
  }

  for (const line of linesToCreate) {
    const key = nextAlias("line")
    actions.push({
      actionId: "planar.create_line",
      actionKey: key,
      factIds: [],
      inputs: {
        alias: key,
        points: [line.a, line.b],
        label: line.label
      }
    })
  }

  for (const seg of segmentsToCreate) {
    const key = nextAlias("seg")
    actions.push({
      actionId: "planar.create_segment",
      actionKey: key,
      factIds: [],
      inputs: {
        alias: key,
        points: [seg.a, seg.b],
        ...(seg.label ? { label: seg.label } : {})
      }
    })
  }

  return actions
}
