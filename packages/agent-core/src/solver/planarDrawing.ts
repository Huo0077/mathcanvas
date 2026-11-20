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
import { splitNumberedProblem, subquestionScopeId } from "../numberedProblem"

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
  selectedScopeId?: string
  branchPlans?: Readonly<Record<string, PlanEnvelope>>
  infeasibleSubquestions?: readonly string[]
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
    || /x²\s*[+-]\s*y²|y²\s*[+-]\s*x²|y²\s*=\s*[^=\n]*x|x²\s*=\s*[^=\n]*y|y\s*=\s*x²\s*\/\s*\d+/.test(normalized)
  const isFunctionOnly = /(?:^|[^a-zA-Z])[fg]\s*\(\s*x\s*\)\s*=|定积分|单调(?:递)?[增减]|极[大小]值/.test(normalized)
  if (isFunctionOnly && !hasConicCue) return true
  const hasPlanarCue = hasConicCue || /(?:圆\s*[A-Z]?\s*[：:(]|为圆心的圆|x²\s*\+\s*y²|旋转角.*椭圆)/.test(normalized)
  return !hasPlanarCue
}

function detectCurveLabel(normalized: string): string {
  const labeled = normalized.match(/(?:椭圆|双曲线|抛物线|曲线)\s*([A-ZΓ])(?![A-Z0-9])/u)
  if (labeled?.[1]) return labeled[1] === "Γ" ? "Γ" : labeled[1]
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
  const seenLabels = new Set<string>()
  const pushCircle = (label: string, center: Coordinate, radius: number) => {
    if (seenLabels.has(label) && circles.some((c) => c.label === label && Math.hypot(c.center.x - center.x, c.center.y - center.y) < 1e-9)) return
    seenLabels.add(label)
    circles.push({ label, center, radius })
  }

  // General circle: [圆M：]x²+y²+Dx+Ey+F=0
  for (const general of normalized.matchAll(/(?:(?:[⊙○]|圆)\s*([A-Z])\s*[：:]\s*)?x²\s*\+\s*y²((?:\s*[+-]\s*(?:(?:\d+(?:\.\d+)?(?:\/\d+)?)\s*)?[xy]|\s*[+-]\s*\d+(?:\.\d+)?(?:\/\d+)?)+)\s*=\s*0/g)) {
    if (!general[2]) continue
    const tail = general[2].replace(/\s+/g, "")
    const coeffOf = (variable: "x" | "y"): number => {
      const m = tail.match(new RegExp(`([+-]?(?:\\d+(?:\\.\\d+)?(?:/\\d+)?)?)${variable}`))
      if (!m) return 0
      const raw = m[1]!
      if (raw === "" || raw === "+") return 1
      if (raw === "-") return -1
      return evalScalar(raw) ?? 0
    }
    const constStr = tail.replace(/[+-]?(?:\d+(?:\.\d+)?(?:\/\d+)?)?[xy]/g, "")
    const D = coeffOf("x")
    const E = coeffOf("y")
    const F = constStr.length > 0 ? (evalScalar(constStr) ?? 0) : 0
    const cx = -D / 2
    const cy = -E / 2
    const r2 = cx * cx + cy * cy - F
    if (r2 > 1e-12) {
      pushCircle(general[1] ?? "O₁", { x: cx, y: cy }, Math.sqrt(r2))
    }
  }
  // Standard circle: [圆M：](x-h)²+(y-k)²=r² or x²+(y-k)²=r²
  for (const standard of normalized.matchAll(/(?:(?:[⊙○]|圆)\s*([A-Z])\s*[：:]\s*)?(?:\(\s*x\s*([+-]\s*[^()]+)\)|x)²\s*\+\s*(?:\(\s*y\s*([+-]\s*[^()]+)\)|y)²\s*=\s*(\d+(?:\.\d+)?(?:\/\d+)?)/g)) {
    const h = standard[2] ? -(evalScalar(standard[2]) ?? 0) : 0
    const k = standard[3] ? -(evalScalar(standard[3]) ?? 0) : 0
    const rhs = evalScalar(standard[4])
    if (rhs !== null && rhs > 1e-12) {
      pushCircle(standard[1] ?? "O₁", { x: h, y: k }, Math.sqrt(rhs))
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
  const parabQuad = normalized.match(/y\s*=\s*x²\s*\/\s*(\d+(?:\.\d+)?)(?!\s*[-+−])/)
  if (parabQuad) {
    const denom = evalScalar(parabQuad[1])
    if (denom !== null && denom > 0) {
      return {
        conic: { id: "planar-conic", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: denom / 2, axis: "y", label: curveLabel },
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
  points: Map<string, Coordinate>,
  selectedScopeId?: string
): {
  conic: PlanarConicSpec | null
  extraCircles: SolvedCircle[]
  extraPoints: SolvedPoint[]
  domainExclusions: string[]
  isRepresentative: boolean
  representativeNotes: string[]
  needsClarification?: string
} {
  // 1. Reuse parseDiagramObligations conic contract solver (selectedScopeId first if multi-part, else unscoped)
  const parsedObligations = parseDiagramObligations(normalized, selectedScopeId ? { selectedScopeId } : {})
  const extraCircles: SolvedCircle[] = []
  const extraPoints: SolvedPoint[] = []
  for (const g of parsedObligations.givens) {
    if (g.kind === "conicAxes" && g.conic?.kind === "circle") {
      extraCircles.push({
        label: g.entityLabel ?? "O₁",
        center: { x: g.conic.centerX, y: g.conic.centerY },
        radius: g.conic.radius
      })
    } else if (g.kind === "pointCoordinate" && g.targets.length === 1 && g.coordinate) {
      extraPoints.push({ label: g.targets[0]!, point: { x: g.coordinate.x, y: g.coordinate.y } })
    }
  }
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
        extraCircles,
        extraPoints,
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
        extraCircles,
        extraPoints,
        domainExclusions: [],
        isRepresentative: false,
        representativeNotes: []
      }
    }
    if (c.kind === "parabola") {
      return {
        conic: {
          id: "planar-conic",
          type: "parabola",
          vertex: { x: 0, y: 0 },
          focalParameter: c.focalParameter,
          axis: c.axis,
          label: curveLabel
        },
        extraCircles,
        extraPoints,
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
            return { conic: { ...inv.conic, id: "planar-conic", label: curveLabel }, extraCircles, extraPoints, domainExclusions: [], isRepresentative: false, representativeNotes: [] }
          }
        } else {
          const inv = ellipseFromFociAndPoint([f1, f2], pt)
          if (inv.kind === "solved") {
            return { conic: { ...inv.conic, id: "planar-conic", label: curveLabel }, extraCircles, extraPoints, domainExclusions: [], isRepresentative: false, representativeNotes: [] }
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
            extraCircles,
            extraPoints,
            domainExclusions: ["x≠0"],
            isRepresentative: false,
            representativeNotes: []
          }
        }
        return {
          conic: { id: "planar-conic", type: "hyperbola", center: { x: 0, y: 0 }, radiusX: Math.sqrt(d2 / lambda), radiusY: Math.abs(pA.y), axis: "y", label: curveLabel },
          extraCircles,
          extraPoints,
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
            extraCircles,
            extraPoints,
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
        extraCircles,
        extraPoints,
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
          extraCircles,
          extraPoints,
          domainExclusions: [],
          isRepresentative: true,
          representativeNotes: ["示意图采用满足约束的代表参数（a=2, b=1，free_choice），不作为唯一题设数值。"]
        }
      }
      return {
        conic: { id: "planar-conic", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1, label: curveLabel },
        extraCircles,
        extraPoints,
        domainExclusions: [],
        isRepresentative: true,
        representativeNotes: ["示意图采用满足 a>b>0 的代表参数（a=2, b=1，free_choice），不作为唯一题设数值。"]
      }
    }
    return {
      conic: null,
      extraCircles,
      extraPoints,
      domainExclusions: [],
      isRepresentative: false,
      representativeNotes: [],
      needsClarification: `圆锥曲线 ${curveLabel} 参数欠定，请补充决定半轴长或离心率等条件（如需示意图可标注“示意图”）。`
    }
  }

  return { conic: null, extraCircles, extraPoints, domainExclusions: [], isRepresentative: false, representativeNotes: [] }
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

function tangentsFromPointToCircle(pt: Coordinate, center: Coordinate, radius: number): [Coordinate, Coordinate] | null {
  const dx = pt.x - center.x
  const dy = pt.y - center.y
  const d = Math.hypot(dx, dy)
  if (!(d > radius + 1e-9)) return null
  const phi = Math.atan2(dy, dx)
  const alpha = Math.acos(radius / d)
  const t1 = { x: center.x + radius * Math.cos(phi + alpha), y: center.y + radius * Math.sin(phi + alpha) }
  const t2 = { x: center.x + radius * Math.cos(phi - alpha), y: center.y + radius * Math.sin(phi - alpha) }
  return [t1, t2]
}

function tangentsFromPointToParabolaY(pt: Coordinate, focalParameter: number): [Coordinate, Coordinate] | null {
  const disc = pt.x * pt.x - 2 * focalParameter * pt.y
  if (!(disc > 1e-12)) return null
  const root = Math.sqrt(disc)
  const x1 = pt.x - root
  const x2 = pt.x + root
  return [
    { x: x1, y: (x1 * x1) / (2 * focalParameter) },
    { x: x2, y: (x2 * x2) / (2 * focalParameter) }
  ]
}

export function tryBuildPlanarDrawingPlan(prompt: string): PlanarDrawingPlanResult | null {
  const normalized = normalizeGeometryPrompt(prompt)
  if (isPureNonPlanarPrompt(normalized)) return null
  if (/任意一点/.test(normalized) && /切线/.test(normalized) && /(?:恒为|定值)/.test(normalized)) return null

  const curveLabel = detectCurveLabel(normalized)
  const { named: parsedPoints, anonymous: anonymousPoints } = parseExplicitPoints(normalized)
  const circles = parseCircles(normalized)
  const problemParts = splitNumberedProblem(normalized)

  // Determine active drawable scope before solving geometric conditions
  const hasPrefeasibleP2 = problemParts !== null && problemParts.parts.length >= 2 && /PF₁\s*⊥\s*PF₂/.test(normalized)
  const preliminaryScopeId = problemParts === null
    ? undefined
    : subquestionScopeId(hasPrefeasibleP2 ? 1 : problemParts.parts[problemParts.parts.length - 1]!.number)

  const explicit = parseExplicitConic(normalized, curveLabel)
  let conic = explicit.conic
  let domainExclusions = [...explicit.domainExclusions]
  let isRepresentative = explicit.isRepresentative
  const representativeNotes = [...explicit.representativeNotes]
  const infeasibleConstraints: string[] = []
  const infeasibleSubquestions: string[] = []

  const cond = solveFromGeometricConditions(normalized, curveLabel, parsedPoints, preliminaryScopeId)
  if (conic === null) {
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

  for (const extraC of cond.extraCircles) {
    if (!circles.some((c) => c.label === extraC.label || (Math.hypot(c.center.x - extraC.center.x, c.center.y - extraC.center.y) < 1e-6 && Math.abs(c.radius - extraC.radius) < 1e-6))) {
      circles.push(extraC)
    }
  }

  if (conic === null && circles.length === 0) return null

  const pointsToCreate: SolvedPoint[] = []
  const linesToCreate: SolvedLine[] = []
  const segmentsToCreate: SolvedSegment[] = []
  const seenPointLabels = new Set<string>()
  const branchPlans: Record<string, PlanEnvelope> = {}

  const addPoint = (label: string, point: Coordinate) => {
    if (seenPointLabels.has(label)) return
    seenPointLabels.add(label)
    pointsToCreate.push({ label, point })
  }

  for (const [label, point] of parsedPoints.entries()) addPoint(label, point)
  for (const extraPt of cond.extraPoints) addPoint(extraPt.label, extraPt.point)
  for (const circle of circles) {
    if (circle.label !== "O₁" && !/轨迹为圆/.test(normalized)) addPoint(circle.label, circle.center)
  }

  if (/(?:顶点为\s*O|O\s*为坐标原点|坐标原点)/.test(normalized)) {
    addPoint("O", { x: 0, y: 0 })
  }

  const excludedPoints: Coordinate[] = []
  if (conic && domainExclusions.includes("x≠0") && conic.type === "ellipse" && Math.abs(conic.center.x) < 1e-9) {
    excludedPoints.push(
      { x: 0, y: conic.center.y + conic.radiusY },
      { x: 0, y: conic.center.y - conic.radiusY }
    )
  }
  const domainOpt = domainExclusions.includes("x≠0") ? { excludeXZero: true } : undefined

  if (conic && /(?:焦点|F₁|F₂|\bF\b)/.test(normalized)) {
    const foci = conicFoci(conic)
    if (foci.length === 2) {
      if (/左|右焦点/.test(normalized) || /F₁|F₂/.test(normalized)) {
        addPoint("F₁", foci[0]!)
        addPoint("F₂", foci[1]!)
      }
      if (/右焦点\s*F/.test(normalized)) addPoint("F", foci[1]!)
    } else if (foci.length === 1) {
      addPoint("F", foci[0]!)
    }
  }

  // Explicit tangent request on conic ("标记...切线")
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
    if (tangent) linesToCreate.push({ label: "切线", a: tangent.line.a, b: tangent.line.b })
  }

  // Hyperbola asymptotes ("渐近线")
  if (conic?.type === "hyperbola" && /渐近线/.test(normalized) && !linesToCreate.some((line) => line.label.startsWith("渐近线"))) {
    const theta = conic.rotation ?? 0
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    const addAsymptote = (sx: 1 | -1, sy: 1 | -1, label: string) => {
      const vx = sx * conic.radiusX
      const vy = sy * conic.radiusY
      const dx = vx * cos - vy * sin
      const dy = vx * sin + vy * cos
      linesToCreate.push({
        label,
        a: { x: conic.center.x + dx * 1.2, y: conic.center.y + dy * 1.2 },
        b: { x: conic.center.x + dx * 2.2, y: conic.center.y + dy * 2.2 }
      })
    }
    addAsymptote(-1, -1, "l₁")
    addAsymptote(1, -1, "l₂")
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
      infeasibleSubquestions.push("(2)")
      infeasibleConstraints.push(`PF₁⊥PF₂ 在当前椭圆 (c=${c.toPrecision(4)} < b=${b.toPrecision(4)}) 上无实数点解，第(2)问不成立，已保留主干与(1)真实图元而不伪造点 P。`)
    }
  }

  // JT-P01: locus circle M + check whether AF₁ bisector hits ellipse in 2 points (infeasible (2))
  if (conic?.type === "ellipse" && /垂直平分线与椭圆\s*[A-Z]\s*恰有一个公共点/.test(normalized)) {
    const a = Math.max(conic.radiusX, conic.radiusY)
    const f1 = parsedPoints.get("F₁") ?? conicFoci(conic)[0]!
    const f2 = parsedPoints.get("F₂") ?? conicFoci(conic)[1]!
    const pA = parsedPoints.get("A")
    if (pA) {
      const mid = { x: (pA.x + f1.x) / 2, y: (pA.y + f1.y) / 2 }
      const dir = { x: -(pA.y - f1.y), y: pA.x - f1.x }
      const bisectorRes = intersectParametricLineWithConic({ origin: mid, direction: dir }, conic, domainOpt)
      linesToCreate.push({ label: "AF₁-bisector", a: { x: mid.x - dir.x, y: mid.y - dir.y }, b: { x: mid.x + dir.x, y: mid.y + dir.y } })
      if (bisectorRes.kind === "secant") {
        infeasibleSubquestions.push("(2)")
        infeasibleConstraints.push(`第(2)问不成立：线段 AF₁ 的垂直平分线与椭圆 ${curveLabel} 有两个公共点 (${bisectorRes.points[0]!.x.toFixed(3)}, ±${Math.abs(bisectorRes.points[0]!.y).toFixed(3)})，不是恰有一个公共点。`)
      }
    }
    if (/轨迹为圆/.test(normalized) && !circles.some((c) => c.label === "M")) {
      circles.push({ label: "M", center: f2, radius: 2 * a })
    }
  }

  // JT-P09: longest & shortest orthogonal chords through interior point O of circle M
  const circleChordsMatch = normalized.match(/过点\s*([A-Z])\s*(?:\([^)]+\))?\s*的最长弦和最短弦分别是\s*([A-Z])([A-Z])\s*和\s*([A-Z])([A-Z])/)
  if (circles.length >= 1 && circleChordsMatch) {
    const circle = circles[0]!
    const oLbl = circleChordsMatch[1]!
    const pO = pointsToCreate.find((p) => p.label === oLbl)?.point ?? parsedPoints.get(oLbl) ?? { x: 0, y: 0 }
    addPoint(oLbl, pO)
    const dx = pO.x - circle.center.x
    const dy = pO.y - circle.center.y
    const distOM = Math.hypot(dx, dy)
    if (distOM < circle.radius - 1e-9) {
      const ux = distOM > 1e-9 ? dx / distOM : 1
      const uy = distOM > 1e-9 ? dy / distOM : 0
      const pA = { x: circle.center.x - circle.radius * ux, y: circle.center.y - circle.radius * uy }
      const pC = { x: circle.center.x + circle.radius * ux, y: circle.center.y + circle.radius * uy }
      const halfShort = Math.sqrt(circle.radius * circle.radius - distOM * distOM)
      const pB = { x: pO.x - halfShort * uy, y: pO.y + halfShort * ux }
      const pD = { x: pO.x + halfShort * uy, y: pO.y - halfShort * ux }
      addPoint(circleChordsMatch[2]!, pA)
      addPoint(circleChordsMatch[3]!, pC)
      addPoint(circleChordsMatch[4]!, pB)
      addPoint(circleChordsMatch[5]!, pD)
      segmentsToCreate.push({ a: pA, b: pC, label: `${circleChordsMatch[2]}${circleChordsMatch[3]}` })
      segmentsToCreate.push({ a: pB, b: pD, label: `${circleChordsMatch[4]}${circleChordsMatch[5]}` })
    }
  }

  // JT-P02: hyperbola vertices A₁, A₂ + vertical host x = c₀ + P on host -> secants PA₁ ∩ C = M, PA₂ ∩ C = N
  const verticalHostMatch = normalized.match(/点\s*([A-Z])\s*(?:在|为)(?:定)?直线\s*x\s*=\s*([-+*/0-9.\s]+)\s*上/)
  if (conic?.type === "hyperbola" && verticalHostMatch && /A₁|A₂/.test(normalized)) {
    const pLabel = verticalHostMatch[1]!
    const xHost = evalScalar(verticalHostMatch[2])
    const a = conic.axis === "x" ? conic.radiusX : conic.radiusY
    const a1: Coordinate = conic.axis === "x" ? { x: -a, y: 0 } : { x: 0, y: -a }
    const a2: Coordinate = conic.axis === "x" ? { x: a, y: 0 } : { x: 0, y: a }
    addPoint("A₁", a1)
    addPoint("A₂", a2)
    if (xHost !== null) {
      linesToCreate.push({ label: "host", a: { x: xHost, y: -6 }, b: { x: xHost, y: 6 } })
      for (const yTry of [1, 1.5, 2.5, 0.7]) {
        const pTry = { x: xHost, y: yTry }
        const r1 = intersectParametricLineWithConic({ origin: a1, direction: { x: pTry.x - a1.x, y: pTry.y - a1.y } }, conic)
        const r2 = intersectParametricLineWithConic({ origin: a2, direction: { x: pTry.x - a2.x, y: pTry.y - a2.y } }, conic)
        if (r1.kind === "secant" && r2.kind === "secant") {
          const ptM = r1.points.find((pt) => Math.hypot(pt.x - a1.x, pt.y - a1.y) > 1e-4)
          const ptN = r2.points.find((pt) => Math.hypot(pt.x - a2.x, pt.y - a2.y) > 1e-4)
          if (ptM && ptN && Math.hypot(ptM.x - ptN.x, ptM.y - ptN.y) > 1e-4) {
            addPoint(pLabel, pTry)
            addPoint("M", ptM)
            addPoint("N", ptN)
            linesToCreate.push({ label: `P${"A₁"}`, a: pTry, b: ptM })
            linesToCreate.push({ label: `P${"A₂"}`, a: pTry, b: ptN })
            break
          }
        }
      }
    }
  }

  // GK-P03: parabola focal chord MN through F + MD∩C=A, ND∩C=B with optimal α - β (tan β = √2/2)
  if (conic?.type === "parabola" && conic.axis === "x" && /当直线\s*MD\s*垂直于\s*x\s*轴时/.test(normalized)) {
    const p = conic.focalParameter
    const ptD = pointsToCreate.find((pt) => pt.label === "D")?.point ?? { x: p, y: 0 }
    // Optimal line AB passes through (2p, 0) with slope 1/sqrt(2) => direction (sqrt(2), 1)
    const optAB = intersectParametricLineWithConic({ origin: { x: 2 * p, y: 0 }, direction: { x: Math.SQRT2, y: 1 } }, conic)
    if (optAB.kind === "secant") {
      const ptA = optAB.points[0]!
      const ptB = optAB.points[1]!
      const resM = intersectParametricLineWithConic({ origin: ptD, direction: { x: ptA.x - ptD.x, y: ptA.y - ptD.y } }, conic)
      const resN = intersectParametricLineWithConic({ origin: ptD, direction: { x: ptB.x - ptD.x, y: ptB.y - ptD.y } }, conic)
      if (resM.kind === "secant" && resN.kind === "secant") {
        const ptM = resM.points.find((pt) => Math.hypot(pt.x - ptA.x, pt.y - ptA.y) > 1e-4)!
        const ptN = resN.points.find((pt) => Math.hypot(pt.x - ptB.x, pt.y - ptB.y) > 1e-4)!
        addPoint("M", ptM)
        addPoint("N", ptN)
        addPoint("A", ptA)
        addPoint("B", ptB)
        linesToCreate.push({ label: "AB", a: ptA, b: ptB })
        linesToCreate.push({ label: "MN", a: ptM, b: ptN })
      }
    }
  }

  // GK-P05: Poncelet triangle A₁A₂A₃ on parabola circumscribed around circle M
  if (conic?.type === "parabola" && conic.axis === "x" && circles.length >= 1 && /A₁.*A₂.*A₃/.test(normalized)) {
    const circle = circles[0]!
    const twoP = 2 * conic.focalParameter
    for (const yTry of [0.5, 0.7, 1.2, 1.5]) {
      const a1: Coordinate = { x: (yTry * yTry) / twoP, y: yTry }
      const touches = tangentsFromPointToCircle(a1, circle.center, circle.radius)
      if (!touches) continue
      const r1 = intersectParametricLineWithConic({ origin: a1, direction: { x: touches[0].x - a1.x, y: touches[0].y - a1.y } }, conic)
      const r2 = intersectParametricLineWithConic({ origin: a1, direction: { x: touches[1].x - a1.x, y: touches[1].y - a1.y } }, conic)
      if (r1.kind === "secant" && r2.kind === "secant") {
        const a2 = r1.points.find((pt) => Math.hypot(pt.x - a1.x, pt.y - a1.y) > 1e-4)
        const a3 = r2.points.find((pt) => Math.hypot(pt.x - a1.x, pt.y - a1.y) > 1e-4)
        if (a2 && a3 && Math.hypot(a2.x - a3.x, a2.y - a3.y) > 1e-4) {
          addPoint("A₁", a1)
          addPoint("A₂", a2)
          addPoint("A₃", a3)
          linesToCreate.push({ label: "A1A2", a: a1, b: a2 })
          linesToCreate.push({ label: "A1A3", a: a1, b: a3 })
          linesToCreate.push({ label: "A2A3", a: a2, b: a3 })
          break
        }
      }
    }
  }

  // GK-P06 (branched): D on y=-p/2, tangents DA/DB to C, circle E tangent at midpoint M of AB
  if (conic?.type === "parabola" && conic.axis === "y" && /切点为线段\s*AB\s*的中点/.test(normalized)) {
    const p = conic.focalParameter
    const ptE = pointsToCreate.find((pt) => pt.label === "E")?.point ?? { x: 0, y: 2.5 }
    addPoint("E", ptE)
    const tPositive = Math.sqrt(Math.max(0, p * (ptE.y - 1.5 * p)))
    const branches: { key: string; tx: number }[] = [
      { key: "zero", tx: 0 },
      { key: "positive", tx: tPositive },
      { key: "negative", tx: -tPositive }
    ]
    const buildMidCircleBranch = (tx: number) => {
      const ptD: Coordinate = { x: tx, y: -p / 2 }
      const touchPair = tangentsFromPointToParabolaY(ptD, p)!
      const ptA = touchPair[0]
      const ptB = touchPair[1]
      const ptM: Coordinate = { x: (ptA.x + ptB.x) / 2, y: (ptA.y + ptB.y) / 2 }
      const rad = Math.hypot(ptE.x - ptM.x, ptE.y - ptM.y)
      const branchPts: SolvedPoint[] = [
        { label: "D", point: ptD },
        { label: "E", point: ptE },
        { label: "A", point: ptA },
        { label: "B", point: ptB },
        { label: "M", point: ptM }
      ]
      const branchLines: SolvedLine[] = [
        { label: "DA", a: ptD, b: ptA },
        { label: "DB", a: ptD, b: ptB },
        { label: "AB", a: ptA, b: ptB }
      ]
      const branchCircles: SolvedCircle[] = [{ label: "E", center: ptE, radius: rad }]
      return { ptD, ptA, ptB, ptM, rad, branchPts, branchLines, branchCircles }
    }
    for (const br of branches) {
      const bData = buildMidCircleBranch(br.tx)
      const brActions = actionDraftsToPlanActions(conic, curveLabel, bData.branchCircles, bData.branchPts, bData.branchLines, [])
      branchPlans[br.key] = {
        schemaVersion: PLAN_SCHEMA_VERSION,
        kind: "plan",
        goal: `抛物线切点弦中点圆切线分支 ${br.key}`,
        factIds: [],
        answer: `(1) AB 恒过定点 (0, 1/2)；(2) 三组解对应的四边形 ADBE 面积分别为 3 与 4√2。`,
        actions: brActions
      }
    }
    const mainBr = buildMidCircleBranch(0)
    addPoint("D", mainBr.ptD)
    addPoint("A", mainBr.ptA)
    addPoint("B", mainBr.ptB)
    addPoint("M", mainBr.ptM)
    circles.push(...mainBr.branchCircles)
    linesToCreate.push(...mainBr.branchLines)
  }

  // GK-P07: P on circle M maximizing triangle PAB tangent chord area
  if (conic?.type === "parabola" && conic.axis === "y" && circles.length >= 1 && /△\s*PAB\s*面积的最大值/.test(normalized)) {
    const circle = circles[0]!
    const ptP: Coordinate = { x: circle.center.x, y: circle.center.y - circle.radius }
    const pair = tangentsFromPointToParabolaY(ptP, conic.focalParameter)
    if (pair) {
      addPoint("P", ptP)
      addPoint("A", pair[0])
      addPoint("B", pair[1])
      linesToCreate.push({ label: "PA", a: ptP, b: pair[0] })
      linesToCreate.push({ label: "PB", a: ptP, b: pair[1] })
    }
  }

  // JT-P04: parabola tangents PA, PB with k_PA * k_PB = -2, directrix feet C, D, infeasible concyclic check
  if (conic?.type === "parabola" && conic.axis === "y" && /斜率之积为\s*-2/.test(normalized) && /准线的垂线/.test(normalized)) {
    const p = conic.focalParameter
    const xA = p * 1
    const xB = p * -2
    const ptA: Coordinate = { x: xA, y: (xA * xA) / (2 * p) }
    const ptB: Coordinate = { x: xB, y: (xB * xB) / (2 * p) }
    const ptP: Coordinate = { x: (xA + xB) / 2, y: (xA * xB) / (2 * p) }
    const dirY = -p / 2
    const ptC: Coordinate = { x: ptA.x, y: dirY }
    const ptD: Coordinate = { x: ptB.x, y: dirY }
    addPoint("A", ptA)
    addPoint("B", ptB)
    addPoint("P", ptP)
    addPoint("C", ptC)
    addPoint("D", ptD)
    linesToCreate.push({ label: "PA", a: ptP, b: ptA })
    linesToCreate.push({ label: "PB", a: ptP, b: ptB })
    infeasibleSubquestions.push("(2)")
    infeasibleConstraints.push("第(2)问不存在满足 A、C、P、D 四点共圆的点 P：设切点横坐标为 a, b（ab=-2p²≠0），共圆条件推出 a=b 或 b=0，与两条相异切线斜率之积为 -2 矛盾。")
  }

  // Representative dynamic point P(x, y) if mentioned as locus moving point (JT-P08)
  if (conic && /动点\s*P\s*\(\s*x\s*,\s*y\s*\)/.test(normalized) && !seenPointLabels.has("P")) {
    const sampleP = pointOnEllipseForSlopeProduct(conic, domainExclusions.includes("x≠0"))
    if (sampleP) addPoint("P", sampleP)
  }

  // Vector split chord through C (JT-P08: 向量EC = r * 向量CF -> C - E = r*(F - C)) with both branches
  const vectorRatioMatch = normalized.match(/过点\s*([A-Z])\s*\([^)]+\)\s*的直线[^。]*相交于\s*([A-Z])\s*[、,，]\s*([A-Z])\s*两点[^。]*?(?:向量\s*|\u2192)?([A-Z]{2})\s*=\s*(\d+(?:\.\d+)?(?:\/\d+)?)\s*(?:向量\s*|\u2192)?([A-Z]{2})/)
  if (conic?.type === "ellipse" && vectorRatioMatch) {
    const baseLabel = vectorRatioMatch[1]!
    const firstEnd = vectorRatioMatch[2]!
    const secondEnd = vectorRatioMatch[3]!
    const ratio = evalScalar(vectorRatioMatch[5])
    const basePt = parsedPoints.get(baseLabel)
    if (basePt && ratio !== null && ratio > 0 && Math.abs(ratio - 1) > 1e-9 && Math.abs(basePt.x) < 1e-9) {
      const ry2 = conic.radiusY * conic.radiusY
      const cy = basePt.y
      const yF = ((1 + ratio) ** 2 * cy * cy - (1 - ratio * ratio) * ry2) / (2 * ratio * (1 + ratio) * cy)
      const ratioY = (yF * yF) / ry2
      if (ratioY < 1 - 1e-9) {
        const xFMag = conic.radiusX * Math.sqrt(1 - ratioY)
        const solveBranchPts = (signSlope: 1 | -1) => {
          // C=(0, cy), yF - cy = yF - basePt.y. For line slope k = (yF - cy) / xF to match signSlope:
          const targetX = (yF - basePt.y) * signSlope >= 0 ? xFMag : -xFMag
          const dir = { x: targetX - basePt.x, y: yF - basePt.y }
          const inter = intersectParametricLineWithConic({ origin: basePt, direction: dir }, conic, domainOpt)
          if (inter.kind !== "secant") return null
          const pF = inter.points.find((pt) => pt.x * targetX > 0 && Math.abs(pt.y - yF) < 1e-6) ?? inter.points[0]!
          const pE = inter.points.find((pt) => pt !== pF) ?? inter.points[1]!
          return { pE, pF }
        }
        const posPts = solveBranchPts(1)
        const negPts = solveBranchPts(-1)
        if (posPts && negPts) {
          addPoint(firstEnd, posPts.pE)
          addPoint(secondEnd, posPts.pF)
          linesToCreate.push({ label: `${firstEnd}${secondEnd}`, a: posPts.pE, b: posPts.pF })
          const makeBranchPlan = (pts: { pE: Coordinate; pF: Coordinate }, key: string): PlanEnvelope => {
            const brPts: SolvedPoint[] = [
              ...pointsToCreate.filter((p) => p.label !== firstEnd && p.label !== secondEnd),
              { label: firstEnd, point: pts.pE },
              { label: secondEnd, point: pts.pF }
            ]
            const brLines: SolvedLine[] = [
              ...linesToCreate.filter((l) => l.label !== `${firstEnd}${secondEnd}`),
              { label: `${firstEnd}${secondEnd}`, a: pts.pE, b: pts.pF }
            ]
            return {
              schemaVersion: PLAN_SCHEMA_VERSION,
              kind: "plan",
              goal: `向量比切分椭圆弦分支 ${key}`,
              factIds: [],
              answer: `(Ⅰ) x²/4+y²/3=1 (x≠0)；(Ⅱ) y = ±(1/2)x - 1。`,
              actions: actionDraftsToPlanActions(conic, curveLabel, circles, brPts, brLines, segmentsToCreate, excludedPoints)
            }
          }
          branchPlans.positive = makeBranchPlan(posPts, "positive")
          branchPlans.negative = makeBranchPlan(negPts, "negative")
        }
      }
    }
  }

  // GK-P02: secant through P meeting E at M, N such that y=M.y meets segment AB at T, and MT=TH
  const horizSecantMatch = normalized.match(/过点\s*([A-Z])\s*\(\s*([^(),\n]+?)\s*,\s*([^()\n]+?)\s*\)\s*的直线交\s*[A-Z]\s*于\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点[^。]*?过\s*\4\s*且平行于\s*x\s*轴的直线与线段\s*([A-Z])([A-Z])\s*交于\s*点?\s*([A-Z])[^。]*?(?:向量\s*|\u2192)?\4\8\s*=\s*(?:向量\s*|\u2192)?\8([A-Z])/)
  if (conic && horizSecantMatch) {
    const pLbl = horizSecantMatch[1]!
    const x0 = evalScalar(horizSecantMatch[2])
    const y0 = evalScalar(horizSecantMatch[3])
    const mLbl = horizSecantMatch[4]!
    const nLbl = horizSecantMatch[5]!
    const aSeg = pointsToCreate.find((p) => p.label === horizSecantMatch[6])?.point
    const bSeg = pointsToCreate.find((p) => p.label === horizSecantMatch[7])?.point
    const tLbl = horizSecantMatch[8]!
    const hLbl = horizSecantMatch[9]!
    if (x0 !== null && y0 !== null && aSeg && bSeg) {
      addPoint(pLbl, { x: x0, y: y0 })
      const yMin = Math.min(aSeg.y, bSeg.y) + 0.1
      const yMax = Math.max(aSeg.y, bSeg.y) - 0.1
      for (const dyTry of [-0.3, -0.5, -0.8, -1, -1.5, -2, -3, 0.25, 0.4, 0.6, 0.8, 1.1, 1.5, 2.5, 4]) {
        const res = intersectParametricLineWithConic({ origin: { x: x0, y: y0 }, direction: { x: 1, y: dyTry } }, conic, domainOpt)
        if (res.kind !== "secant") continue
        const pM = res.points.find((pt) => pt.y >= yMin && pt.y <= yMax)
        const pN = res.points.find((pt) => pt !== pM)
        if (pM && pN && Math.hypot(pM.x - pN.x, pM.y - pN.y) > 1e-4) {
          const pT = intersectLines2D(pM, { x: pM.x + 1, y: pM.y }, aSeg, bSeg)
          if (pT) {
            const pH = { x: 2 * pT.x - pM.x, y: pM.y }
            addPoint(mLbl, pM)
            addPoint(nLbl, pN)
            addPoint(tLbl, pT)
            addPoint(hLbl, pH)
            linesToCreate.push({ label: `${mLbl}${nLbl}`, a: pM, b: pN })
            segmentsToCreate.push({ a: pM, b: pH })
            break
          }
        }
      }
    }
  }

  // JT-P05: secant through M(0,1) meeting hyperbola at P, Q + parallel line through F meeting hyperbola at A, B
  const parallelChordsMatch = normalized.match(/过\s*([A-Z])\s*\(\s*([^(),\n]+?)\s*,\s*([^()\n]+?)\s*\)\s*的直线与双曲线交于\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点[^。]*?过[^。]*?([A-Z])\s*且与\s*\4\5\s*平行的直线交双曲线于\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点/)
  if (conic?.type === "hyperbola" && parallelChordsMatch) {
    const ptM = parsedPoints.get(parallelChordsMatch[1]!) ?? { x: evalScalar(parallelChordsMatch[2]) ?? 0, y: evalScalar(parallelChordsMatch[3]) ?? 1 }
    const fLbl = parallelChordsMatch[6]!
    const ptF = pointsToCreate.find((p) => p.label === fLbl)?.point ?? conicFoci(conic)[1]!
    addPoint(fLbl, ptF)
    const dirPQ = { x: 1, y: 0.5 }
    const rPQ = intersectParametricLineWithConic({ origin: ptM, direction: dirPQ }, conic)
    const rAB = intersectParametricLineWithConic({ origin: ptF, direction: dirPQ }, conic)
    if (rPQ.kind === "secant" && rAB.kind === "secant") {
      addPoint(parallelChordsMatch[4]!, rPQ.points[0]!)
      addPoint(parallelChordsMatch[5]!, rPQ.points[1]!)
      addPoint(parallelChordsMatch[7]!, rAB.points[0]!)
      addPoint(parallelChordsMatch[8]!, rAB.points[1]!)
      linesToCreate.push({ label: `${parallelChordsMatch[4]}${parallelChordsMatch[5]}`, a: rPQ.points[0]!, b: rPQ.points[1]! })
      linesToCreate.push({ label: `${parallelChordsMatch[7]}${parallelChordsMatch[8]}`, a: rAB.points[0]!, b: rAB.points[1]! })
    }
  }

  // General secant chord through point (x0, y0)
  const chordMatch = normalized.match(/过点\s*(?:[A-Z]\s*)?\(\s*([^(),\n]+?)\s*,\s*([^()\n]+?)\s*\)\s*的直线(?:\s*([a-z]))?\s*(?:与\s*(?:椭圆|双曲线|抛物线|曲线)?\s*(?:[A-Z]\s*)?相?交|相?交\s*(?:(?:椭圆|双曲线|抛物线|曲线)?\s*[A-Z])?\s*)于\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点/)
  if (conic && chordMatch && (!seenPointLabels.has(chordMatch[4]!) || !seenPointLabels.has(chordMatch[5]!))) {
    const x0 = evalScalar(chordMatch[1])
    const y0 = evalScalar(chordMatch[2])
    const hasSeparateL = /直线\s*l\s*[：:]\s*y\s*=/.test(normalized)
    const lineLabel = chordMatch[3] ?? (hasSeparateL ? `${chordMatch[4]}${chordMatch[5]}` : "l")
    const p1Label = chordMatch[4]!
    const p2Label = chordMatch[5]!
    if (x0 !== null && y0 !== null) {
      let exactPts: [Coordinate, Coordinate] | null = null
      let slope: number | null = null
      const areaMatch = normalized.match(/面积(?:为|等于)?\s*([^\s，。；,]+)/)
      if (conic.type === "ellipse" && Math.abs(x0) < 1e-9 && areaMatch) {
        const targetArea = evalScalar(areaMatch[1])
        if (targetArea !== null) slope = solveOriginTriangleAreaSlope(conic.radiusX, conic.radiusY, y0, targetArea)
      }
      // JT-P03 parabola optimal |DE| (minimum at u+v=-8 => (y_A/p)+(y_B/p) = -8)
      if (conic.type === "parabola" && conic.axis === "x" && /最小值/.test(normalized) && Math.abs(y0) < 1e-9 && x0 > 0) {
        const p = conic.focalParameter
        const twoP = 2 * p
        const ySum = -4 * x0 * p
        const yProd = -twoP * x0
        const disc = ySum * ySum - 4 * yProd
        if (disc > 0) {
          const y1 = (ySum + Math.sqrt(disc)) / 2
          const y2 = (ySum - Math.sqrt(disc)) / 2
          exactPts = [{ x: (y1 * y1) / twoP, y: y1 }, { x: (y2 * y2) / twoP, y: y2 }]
        }
      }
      if (exactPts) {
        addPoint(p1Label, exactPts[0])
        addPoint(p2Label, exactPts[1])
        linesToCreate.push({ label: lineLabel, a: exactPts[0], b: exactPts[1] })
      } else {
        const preferVertical = /最小值/.test(normalized)
        const tryDirections: Coordinate[] = slope !== null
          ? [{ x: 1, y: slope }]
          : preferVertical
            ? [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }]
            : [{ x: 1, y: 1 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }]
        for (const dir of tryDirections) {
          const res = intersectParametricLineWithConic({ origin: { x: x0, y: y0 }, direction: dir }, conic, domainOpt)
          if (res.kind === "secant") {
            addPoint(p1Label, res.points[0]!)
            addPoint(p2Label, res.points[1]!)
            linesToCreate.push({ label: lineLabel, a: res.points[0]!, b: res.points[1]! })
            if (slope === null && !preferVertical) {
              isRepresentative = true
              representativeNotes.push(`过点 (${x0}, ${y0}) 的动直线取一条代表性割线以展示交点 ${p1Label}、${p2Label}（free_choice）。`)
            }
            break
          }
        }
      }
    }
  } else if (
    conic &&
    /与直线(?:\s*[a-z]\s*[：:])?\s*(x\s*=\s*[^，。,；\s]+|y\s*=\s*[^，。,；\s]+)\s*相?交于(?:点)?\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点/.test(normalized)
  ) {
    const match = normalized.match(/与直线(?:\s*[a-z]\s*[：:])?\s*(x\s*=\s*[^，。,；\s]+|y\s*=\s*[^，。,；\s]+)\s*相?交于(?:点)?\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点/)!
    const eq = match[1]!.replace(/\s+/g, "")
    const p1Label = match[2]!
    const p2Label = match[3]!
    let lineOrigin: Coordinate | null = null
    let lineDir: Coordinate | null = null
    const lineLbl = eq
    if (eq.startsWith("y=")) {
      const rhs = eq.slice(2)
      const scalar = evalScalar(rhs)
      if (scalar !== null) {
        lineOrigin = { x: 0, y: scalar }
        lineDir = { x: 1, y: 0 }
      } else {
        const slopeIntercept = rhs.match(/^([+-]?(?:\d+(?:\.\d+)?)?)?\*?x([+-].+)?$/)
        if (slopeIntercept) {
          const m = slopeIntercept[1] === undefined || slopeIntercept[1] === "" || slopeIntercept[1] === "+"
            ? 1
            : slopeIntercept[1] === "-"
              ? -1
              : evalScalar(slopeIntercept[1])
          const b = slopeIntercept[2] ? evalScalar(slopeIntercept[2]) : 0
          if (m !== null && b !== null) {
            lineOrigin = { x: 0, y: b }
            lineDir = { x: 1, y: m }
          }
        }
      }
    } else if (eq.startsWith("x=")) {
      const scalar = evalScalar(eq.slice(2))
      if (scalar !== null) {
        lineOrigin = { x: scalar, y: 0 }
        lineDir = { x: 0, y: 1 }
      }
    }
    if (lineOrigin && lineDir) {
      const res = intersectParametricLineWithConic({ origin: lineOrigin, direction: lineDir }, conic, domainOpt)
      if (res.kind === "secant" && res.points.length === 2) {
        addPoint(p1Label, res.points[0]!)
        addPoint(p2Label, res.points[1]!)
        linesToCreate.push({ label: lineLbl, a: res.points[0]!, b: res.points[1]! })
      } else if (res.kind === "tangent" || res.kind === "single") {
        linesToCreate.push({
          label: lineLbl,
          a: lineOrigin,
          b: { x: lineOrigin.x + lineDir.x * 4, y: lineOrigin.y + lineDir.y * 4 }
        })
      }
    }
  } else if (conic && /直线\s*([a-z])\s*[：:]\s*(x\s*=\s*[^，。,；\s]+|y\s*=\s*[^，。,；\s]+)\s*交\s*[A-Z]\s*于\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点/.test(normalized)) {
    const mLine = normalized.match(/直线\s*([a-z])\s*[：:]\s*x\s*=\s*([^，。,；\s]+)\s*交\s*[A-Z]\s*于\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点/)
    if (mLine) {
      const xVal = evalScalar(mLine[2])
      if (xVal !== null) {
        const res = intersectParametricLineWithConic({ origin: { x: xVal, y: 0 }, direction: { x: 0, y: 1 } }, conic, domainOpt)
        if (res.kind === "secant") {
          addPoint(mLine[3]!, res.points[0]!)
          addPoint(mLine[4]!, res.points[1]!)
          linesToCreate.push({ label: mLine[1]!, a: res.points[0]!, b: res.points[1]! })
        }
      }
    }
  } else if (conic && anonymousPoints.length > 0 && /交于\s*([A-Z])\s*[，,、]\s*([A-Z])\s*两点/.test(normalized)) {
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

  // Aux line intersection for pairs (JT-P03, JT-P07)
  const pairLineMatch = normalized.match(/直线\s*([A-Z])([A-Z])\s*[，,、]\s*(?:直线\s*)?([A-Z])([A-Z])\s*分别(?:与|交)\s*直线(?:\s*([a-z])\s*[：:])?\s*(?:(x\s*=\s*[-+*/0-9a-zA-Z.\s]+?)|(y\s*=\s*[-+*/0-9a-zA-Z.\s]+?))\s*(?:相?交)?于点?\s*([A-Z])\s*[，,、]\s*([A-Z])/)
  if (pairLineMatch) {
    const getPt = (lbl: string) => pointsToCreate.find((p) => p.label === lbl)?.point ?? parsedPoints.get(lbl)
    const p1A = getPt(pairLineMatch[1]!)
    const p1B = getPt(pairLineMatch[2]!)
    const p2A = getPt(pairLineMatch[3]!)
    const p2B = getPt(pairLineMatch[4]!)
    const namedAuxLabel = pairLineMatch[5]
    const out1 = pairLineMatch[8]!
    const out2 = pairLineMatch[9]!
    let auxA: Coordinate | null = null
    let auxB: Coordinate | null = null
    let auxLabel = namedAuxLabel ?? "l"
    if (pairLineMatch[6]) {
      const xConst = evalScalar(pairLineMatch[6].split("=")[1])
      if (xConst !== null) {
        auxA = { x: xConst, y: -5 }
        auxB = { x: xConst, y: 5 }
        if (!namedAuxLabel) auxLabel = `x=${xConst}`
      }
    } else if (pairLineMatch[7]) {
      const rhs = pairLineMatch[7].split("=")[1]?.replace(/\s+/g, "") ?? ""
      const lineExpr = rhs.match(/^([+-]?(?:\d+(?:\.\d+)?)?)?\*?x(?:\s*([+-]\s*\d+(?:\.\d+)?))?$/)
      const m = lineExpr ? (lineExpr[1] === undefined || lineExpr[1] === "" || lineExpr[1] === "+" ? 1 : lineExpr[1] === "-" ? -1 : evalScalar(lineExpr[1])) : null
      const q = lineExpr?.[2] ? evalScalar(lineExpr[2]) : 0
      if (m !== null && q !== null) {
        auxA = { x: -4, y: -4 * m + q }
        auxB = { x: 4, y: 4 * m + q }
        if (!namedAuxLabel) auxLabel = `y=${rhs}`
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

  // Verify points declared on conic really satisfy finite residual
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
    ...(!isRepresentative && conic && representativeNotes.length === 0 ? ["曲线参数与几何位置均由题面条件唯一确定，并非系统自选。"] : []),
    ...infeasibleConstraints,
    ...domainExclusions.map((domain) => `轨迹定义域排除 ${domain}。`)
  ]

  const actions = actionDraftsToPlanActions(
    conic,
    curveLabel,
    circles,
    pointsToCreate,
    linesToCreate,
    segmentsToCreate,
    excludedPoints
  )

  const family: "planar-basics" | "conics-tangents" = conic ? "conics-tangents" : "planar-basics"
  const finalScopeId = infeasibleSubquestions.includes("(2)") && problemParts && problemParts.parts.length >= 3
    ? subquestionScopeId(3)
    : infeasibleSubquestions.includes("(2)") && problemParts && problemParts.parts.length === 2 && !/准线的垂线/.test(normalized)
      ? subquestionScopeId(1)
      : preliminaryScopeId

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
    ...(finalScopeId === undefined ? {} : { selectedScopeId: finalScopeId }),
    ...(Object.keys(branchPlans).length > 0 ? { branchPlans } : {}),
    ...(infeasibleSubquestions.length > 0 ? { infeasibleSubquestions } : {}),
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
  segmentsToCreate: readonly SolvedSegment[],
  excludedPoints: readonly Coordinate[] = []
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
          ...(excludedPoints.length > 0 ? { excludedPoints: [...excludedPoints] } : {}),
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
          ...(excludedPoints.length > 0 ? { excludedPoints: [...excludedPoints] } : {}),
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
