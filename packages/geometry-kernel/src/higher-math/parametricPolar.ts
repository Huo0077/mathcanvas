import { compileAstToRpn, normalizeHigherMathInput } from "./bytecode"
import { parseExpression } from "../expression"
import type { Point2D, ViewportBounds2D } from "./contour"

export interface ParametricCurvePreset {
  id: string
  title: string
  courseTag: string
  xExpr: string
  yExpr: string
  tRange: [number, number]
  initialT: number
}

export interface PolarCurvePreset {
  id: string
  title: string
  courseTag: string
  rExpr: string
  thetaRange: [number, number]
  initialTheta: number
}

export const PARAMETRIC_CURVE_PRESETS: ParametricCurvePreset[] = [
  {
    id: "cycloid",
    title: "经典摆线（一拱）",
    courseTag: "高数上 · 参数方程弧长",
    xExpr: "t - sin(t)",
    yExpr: "1 - cos(t)",
    tRange: [0, 6.2832],
    initialT: 2.1
  },
  {
    id: "astroid",
    title: "星形线（内摆线）",
    courseTag: "考研高频 · 弧长与面积",
    xExpr: "2*cos(t)^3",
    yExpr: "2*sin(t)^3",
    tRange: [0, 6.2832],
    initialT: 0.7854
  },
  {
    id: "lissajous",
    title: "利萨茹振动曲线",
    courseTag: "物理/高数 · 参数轨线",
    xExpr: "2.5*sin(3*t)",
    yExpr: "2.5*sin(2*t)",
    tRange: [0, 6.2832],
    initialT: 0.9
  },
  {
    id: "heart",
    title: "心形参数曲线",
    courseTag: "经典参数方程",
    xExpr: "1.6*sin(t)^3",
    yExpr: "1.3*cos(t) - 0.5*cos(2*t) - 0.2*cos(3*t) - 0.1*cos(4*t)",
    tRange: [0, 6.2832],
    initialT: 1.2
  },
  {
    id: "helix_proj",
    title: "阻尼螺旋线",
    courseTag: "动力系统 · 参数衰减",
    xExpr: "2.6*exp(-0.18*t)*cos(t)",
    yExpr: "2.6*exp(-0.18*t)*sin(t)",
    tRange: [0, 12.5664],
    initialT: 2.4
  }
]

export const POLAR_CURVE_PRESETS: PolarCurvePreset[] = [
  {
    id: "cardioid",
    title: "心脏线 r = 1 + cos θ",
    courseTag: "高数上 · 极坐标面积/弧长",
    rExpr: "1 + cos(theta)",
    thetaRange: [0, 6.2832],
    initialTheta: 1.0472
  },
  {
    id: "rose3",
    title: "三叶玫瑰线 r = 2cos(3θ)",
    courseTag: "考研必考 · 对称极坐标",
    rExpr: "2*cos(3*theta)",
    thetaRange: [0, 3.1416],
    initialTheta: 0.35
  },
  {
    id: "rose4",
    title: "四叶玫瑰线 r = 2sin(2θ)",
    courseTag: "高数上 · 极坐标对称性",
    rExpr: "2*sin(2*theta)",
    thetaRange: [0, 6.2832],
    initialTheta: 0.7854
  },
  {
    id: "archimedes",
    title: "阿基米德螺线 r = 0.35θ",
    courseTag: "极坐标弧长经典题",
    rExpr: "0.35*theta",
    thetaRange: [0, 12.5664],
    initialTheta: 4.5
  },
  {
    id: "limacon",
    title: "帕斯卡蜗线 r = 1 + 2cos θ",
    courseTag: "带内环极坐标曲线",
    rExpr: "1 + 2*cos(theta)",
    thetaRange: [0, 6.2832],
    initialTheta: 0.8
  }
]

export interface ParametricCurveAnalysis {
  xExpr: string
  yExpr: string
  tRange: [number, number]
  activeT: number
  points: Point2D[]
  activePoint: Point2D
  velocity: Point2D
  speed: number
  dyDx: number
  d2yDx2: number
  curvature: number
  arcLength: number
  suggestedBounds: ViewportBounds2D
}

export interface PolarCurveAnalysis {
  rExpr: string
  thetaRange: [number, number]
  activeTheta: number
  points: Point2D[]
  activeR: number
  activeDR: number
  activePoint: Point2D
  tangentVec: Point2D
  sectorArea: number
  arcLength: number
  suggestedBounds: ViewportBounds2D
}

function compileSingleParam(expr: string, variableName: "t" | "theta"): (v: number) => number {
  const cleaned = normalizeHigherMathInput(expr, "expression")
  const ast = parseExpression(cleaned)
  const rpn = compileAstToRpn(ast, [variableName, "x"])
  return (v: number) => rpn.evalAt([v, v])
}

function computeBounds(points: Point2D[]): ViewportBounds2D {
  let xMin = Number.POSITIVE_INFINITY
  let xMax = Number.NEGATIVE_INFINITY
  let yMin = Number.POSITIVE_INFINITY
  let yMax = Number.NEGATIVE_INFINITY
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    if (p.x < xMin) xMin = p.x
    if (p.x > xMax) xMax = p.x
    if (p.y < yMin) yMin = p.y
    if (p.y > yMax) yMax = p.y
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) {
    return { xMin: -4, xMax: 4, yMin: -4, yMax: 4 }
  }
  const cx = 0.5 * (xMin + xMax)
  const cy = 0.5 * (yMin + yMax)
  const halfSpan = Math.max(1.2, 0.5 * Math.max(xMax - xMin, yMax - yMin) * 1.24)
  return {
    xMin: cx - halfSpan,
    xMax: cx + halfSpan,
    yMin: cy - halfSpan,
    yMax: cy + halfSpan
  }
}

export function analyzeParametricCurve2D(
  xExpr: string,
  yExpr: string,
  tRange: [number, number],
  activeT: number,
  samples = 360
): ParametricCurveAnalysis {
  const fx = compileSingleParam(xExpr, "t")
  const fy = compileSingleParam(yExpr, "t")
  const [t0, t1] = tRange[0] <= tRange[1] ? tRange : [tRange[1], tRange[0]]
  const dt = (t1 - t0) / samples

  const points: Point2D[] = []
  let arcLength = 0
  let prev: Point2D | null = null
  for (let i = 0; i <= samples; i += 1) {
    const t = t0 + i * dt
    const x = fx(t)
    const y = fy(t)
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e4 || Math.abs(y) > 1e4) {
      prev = null
      continue
    }
    const pt = { x, y }
    points.push(pt)
    if (prev) arcLength += Math.hypot(pt.x - prev.x, pt.y - prev.y)
    prev = pt
  }

  const tc = Math.max(t0, Math.min(t1, activeT))
  const h = 1e-4 * Math.max(1, Math.abs(t1 - t0))
  const activePoint = { x: fx(tc), y: fy(tc) }
  const dx = (fx(tc + h) - fx(tc - h)) / (2 * h)
  const dy = (fy(tc + h) - fy(tc - h)) / (2 * h)
  const d2x = (fx(tc + h) - 2 * activePoint.x + fx(tc - h)) / (h * h)
  const d2y = (fy(tc + h) - 2 * activePoint.y + fy(tc - h)) / (h * h)
  const speed = Math.hypot(dx, dy)
  const dyDx = Math.abs(dx) > 1e-8 ? dy / dx : Number.NaN
  const d2yDx2 = Math.abs(dx) > 1e-6 ? (dx * d2y - dy * d2x) / (dx * dx * dx) : Number.NaN
  const curvature = speed > 1e-8 ? Math.abs(dx * d2y - dy * d2x) / (speed * speed * speed) : Number.NaN

  return {
    xExpr,
    yExpr,
    tRange: [t0, t1],
    activeT: tc,
    points,
    activePoint,
    velocity: { x: dx, y: dy },
    speed,
    dyDx,
    d2yDx2,
    curvature,
    arcLength,
    suggestedBounds: computeBounds(points)
  }
}

export function analyzePolarCurve2D(
  rExpr: string,
  thetaRange: [number, number],
  activeTheta: number,
  samples = 360
): PolarCurveAnalysis {
  const fr = compileSingleParam(rExpr, "theta")
  const [a, b] = thetaRange[0] <= thetaRange[1] ? thetaRange : [thetaRange[1], thetaRange[0]]
  const dth = (b - a) / samples

  const points: Point2D[] = []
  let sectorArea = 0
  let arcLength = 0
  let prevPt: Point2D | null = null
  for (let i = 0; i <= samples; i += 1) {
    const th = a + i * dth
    const r = fr(th)
    if (!Number.isFinite(r) || Math.abs(r) > 1e4) {
      prevPt = null
      continue
    }
    const pt = { x: r * Math.cos(th), y: r * Math.sin(th) }
    points.push(pt)
    if (i < samples) {
      const rMid = fr(th + 0.5 * dth)
      if (Number.isFinite(rMid)) sectorArea += 0.5 * rMid * rMid * dth
    }
    if (prevPt) arcLength += Math.hypot(pt.x - prevPt.x, pt.y - prevPt.y)
    prevPt = pt
  }

  const thc = Math.max(a, Math.min(b, activeTheta))
  const h = 1e-4
  const activeR = fr(thc)
  const activeDR = (fr(thc + h) - fr(thc - h)) / (2 * h)
  const activePoint = { x: activeR * Math.cos(thc), y: activeR * Math.sin(thc) }
  const tangentVec = {
    x: activeDR * Math.cos(thc) - activeR * Math.sin(thc),
    y: activeDR * Math.sin(thc) + activeR * Math.cos(thc)
  }

  return {
    rExpr,
    thetaRange: [a, b],
    activeTheta: thc,
    points,
    activeR,
    activeDR,
    activePoint,
    tangentVec,
    sectorArea,
    arcLength,
    suggestedBounds: computeBounds(points)
  }
}
