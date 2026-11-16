import type { Coordinate, EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

import { sampleEllipse, sampleHyperbolaBranches, sampleParabola } from "./conics"
// "过两点的直线"只留一份定义（`conic-line.ts` 里那份），这里复用而不是再抄一个同形接口。
import { conicResidualAt, type ConicLine } from "./conic-line"
import {
  evaluateExpressionWithDomain,
  evaluateRelationConstraint,
  parseRelationConstraint,
  type ParsedRelationConstraint
} from "./expression"

/**
 * **由条件反求圆锥曲线的参数**（Task 14）。
 *
 * ## 为什么这一层是"真实缺的"
 *
 * 调研 §2.2 归出来的子型 C1 就是「焦点 / 准线 / 离心率 / 渐近线 ⇒ 参数反求」，而仓里此前
 * **只有正向计算**（给了 `a`、`b`、轴再算别的：系数、采样、切线、约束）。真题里更常见的是反过来：
 * 给两个焦点与曲线上一点、给焦点与准线、给离心率与准线 —— 这些都得先把 `a`、`b`、**轴**解出来。
 *
 * ## 三条反求路径
 *
 * 1. `ellipseFromFociAndPoint` / `hyperbolaFromFociAndPoint`：**两焦点定义**
 *    （`2a = |PF₁| ± |PF₂|`，轴就是两个焦点连的那条线）；
 * 2. `parabolaFromFocusAndDirectrix`：**焦点—准线定义**（`|PF| = dist(P, L)`）；
 * 3. `conicFromFocusDirectrixAndEccentricity`：**统一式**（`|PF| / dist(P, L) = e`），
 *    `e < 1` 椭圆、`e = 1` 抛物线、`e > 1` 双曲线 —— 离心率这一支就是从这里进来的。
 *
 * ## 残差是读数，而且是在**曲线自己**上复核的
 *
 * 每条路径都返回两个残差：`residual`（定义式在**输入**上的相对偏差）与 `sampledResidual`
 * （把反求出来的曲线**采样**一遍，逐点复核定义式的最大相对偏差）。
 * 后者才是这一层真正的验收 —— 反求过程内部那几个中间量自证不了任何东西。
 *
 * ## 三种结局必须分开
 *
 * `solved` / `contradictory`（输入自相矛盾：焦点在准线上、`2a ≤ 2c`、点在两焦点之间……）/
 * `unsupported`（不是"矛盾"，是"这个条件组定义不出曲线"：两焦点重合、离心率非正）。
 * 把 `unsupported` 说成 `contradictory` 会冤枉用户的题面；反过来会把"题面矛盾"藏起来。
 *
 * 返回的曲线带一个**占位 id**（`inverted-parabola` / `inverted-ellipse` / `inverted-hyperbola`）——
 * 调用方把它插进文档时要换成自己的 id（这一层不认识文档，也不该去分配 id）。
 */

export type ConicInversion<T> =
  | {
      kind: "solved"
      conic: T
      /** 定义式在**输入**上的相对偏差。 */
      residual: number
      /** 把曲线采样一遍、逐点复核定义式的**最大**相对偏差。 */
      sampledResidual: number
      /** 离心率（椭圆 / 双曲线有；抛物线恒为 1）。 */
      eccentricity: number
    }
  | { kind: "contradictory"; detail: string }
  | { kind: "unsupported"; reason: string }

const EPSILON = 1e-12

/** 轴对齐的判定阈值：在这个角度以内就报**轴对齐**而不是 `rotation`。 */
const AXIS_SNAP = 1e-12

function finitePoint(point: Coordinate): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function finiteLine(line: ConicLine): boolean {
  return finitePoint(line.a) && finitePoint(line.b)
}

function distance(first: Coordinate, second: Coordinate): number {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function distanceToLine(point: Coordinate, line: ConicLine): number {
  const dx = line.b.x - line.a.x
  const dy = line.b.y - line.a.y
  const length = Math.hypot(dx, dy)
  return Math.abs(dy * (point.x - line.a.x) - dx * (point.y - line.a.y)) / length
}

/** 点在直线上的垂足。 */
function footOfPerpendicular(point: Coordinate, line: ConicLine): Coordinate {
  const dx = line.b.x - line.a.x
  const dy = line.b.y - line.a.y
  const lengthSquared = dx * dx + dy * dy
  const parameter = ((point.x - line.a.x) * dx + (point.y - line.a.y) * dy) / lengthSquared
  return { x: line.a.x + parameter * dx, y: line.a.y + parameter * dy }
}

/** 把角度折到 `(−π/2, π/2]`：椭圆 / 双曲线的轴是一条**线**，`θ` 与 `θ + π` 是同一个朝向。 */
function normalizeAxial(angle: number): number {
  const half = Math.PI / 2
  let value = angle % Math.PI
  if (value <= -half) value += Math.PI
  if (value > half) value -= Math.PI
  return value
}

/**
 * 抛物线：`axis` 是**开口方向**（一条射线，不能按 mod π 折），轴对齐时就报轴对齐。
 *
 * 为什么值得单独一个函数：把"开口沿 y"写成"`axis: "x"` + `rotation: π/2`"在几何上等价，
 * 但**核验器比的就是 `axis` 字段**（`diagramVerification.ts` 的「开口方向不同就是另一条曲线」），
 * 于是同一条曲线会被判成"另一条"。轴对齐必须落成轴对齐。
 */
function parabolaWithDirection(vertex: Coordinate, focalParameter: number, angle: number): ParabolaPrimitive {
  const full = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  if (full <= AXIS_SNAP || full >= 2 * Math.PI - AXIS_SNAP) return { id: "inverted-parabola", type: "parabola", vertex, focalParameter, axis: "x" }
  if (Math.abs(full - Math.PI / 2) <= AXIS_SNAP) return { id: "inverted-parabola", type: "parabola", vertex, focalParameter, axis: "y" }
  return { id: "inverted-parabola", type: "parabola", vertex, focalParameter, axis: "x", rotation: full }
}

/** 采样出来的曲线 → 定义式的最大相对偏差。`relative` 由调用方给（每条曲线的定义式不一样）。 */
function worstRelative(points: readonly Coordinate[], relative: (point: Coordinate) => number): number {
  let worst = 0
  for (const point of points) {
    const value = Math.abs(relative(point))
    if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY
    if (value > worst) worst = value
  }
  return worst
}

export function parabolaFromFocusAndDirectrix(focus: Coordinate, directrix: ConicLine): ConicInversion<ParabolaPrimitive> {
  if (!finitePoint(focus)) return { kind: "unsupported", reason: "焦点坐标不是有限数" }
  if (!finiteLine(directrix)) return { kind: "unsupported", reason: "准线的端点不是有限数" }
  const span = distance(directrix.a, directrix.b)
  if (span <= EPSILON) return { kind: "unsupported", reason: "准线的两个端点重合（定不出这条直线）" }
  const distanceToDirectrix = distanceToLine(focus, directrix)
  if (!(distanceToDirectrix > EPSILON)) {
    return { kind: "contradictory", detail: "焦点落在准线上：到定点的距离与到定直线的距离恒等，定义不出抛物线" }
  }
  const foot = footOfPerpendicular(focus, directrix)
  const normal = { x: (focus.x - foot.x) / distanceToDirectrix, y: (focus.y - foot.y) / distanceToDirectrix }
  // 顶点在焦点与垂足的中点；**焦准距 `p` 就是 `|FL|`**（题面 `y² = 4x` 里的 4 是 `2p`，这是另一个坑）。
  const vertex = { x: foot.x + normal.x * distanceToDirectrix / 2, y: foot.y + normal.y * distanceToDirectrix / 2 }
  const conic = parabolaWithDirection(vertex, distanceToDirectrix, Math.atan2(normal.y, normal.x))
  const residual = Math.abs(distance(vertex, focus) / distanceToLine(vertex, directrix) - 1)
  const sampled = sampleParabola(conic, [-Math.max(1, distanceToDirectrix) * 3, Math.max(1, distanceToDirectrix) * 3], 24)
  const sampledResidual = worstRelative(sampled, (point) => {
    const toLine = distanceToLine(point, directrix)
    return toLine > 0 ? distance(point, focus) / toLine - 1 : Number.NaN
  })
  return { kind: "solved", conic, residual, sampledResidual, eccentricity: 1 }
}

export function ellipseFromFociAndPoint(foci: readonly [Coordinate, Coordinate], point: Coordinate): ConicInversion<EllipsePrimitive> {
  const [first, second] = foci
  if (!finitePoint(first) || !finitePoint(second) || !finitePoint(point)) return { kind: "unsupported", reason: "坐标不是有限数" }
  const halfSeparation = distance(first, second) / 2
  if (halfSeparation <= EPSILON) return { kind: "unsupported", reason: "两个焦点重合：定不出椭圆的轴（任何过该点的椭圆都合格）" }
  const centre = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
  const semiMajor = (distance(point, first) + distance(point, second)) / 2
  if (semiMajor <= halfSeparation) {
    return {
      kind: "contradictory",
      detail: `2a = ${(2 * semiMajor).toFixed(6)} 不超过 2c = ${(2 * halfSeparation).toFixed(6)}：这个点落在两个焦点之间，满足「到两焦点距离之和为常数」的曲线不存在（退化成线段）`
    }
  }
  const semiMinor = Math.sqrt(semiMajor * semiMajor - halfSeparation * halfSeparation)
  const axial = normalizeAxial(Math.atan2(second.y - first.y, second.x - first.x))
  const conic: EllipsePrimitive = {
    id: "inverted-ellipse",
    type: "ellipse",
    center: centre,
    radiusX: semiMajor,
    radiusY: semiMinor,
    ...(Math.abs(axial) <= AXIS_SNAP ? {} : { rotation: axial })
  }
  const expected = 2 * semiMajor
  const sampled = sampleEllipse(conic, 32)
  const sampledResidual = worstRelative(sampled, (sample) => (distance(sample, first) + distance(sample, second) - expected) / expected)
  return { kind: "solved", conic, residual: Math.abs((distance(point, first) + distance(point, second) - expected) / expected), sampledResidual, eccentricity: halfSeparation / semiMajor }
}

export function hyperbolaFromFociAndPoint(foci: readonly [Coordinate, Coordinate], point: Coordinate): ConicInversion<HyperbolaPrimitive> {
  const [first, second] = foci
  if (!finitePoint(first) || !finitePoint(second) || !finitePoint(point)) return { kind: "unsupported", reason: "坐标不是有限数" }
  const halfSeparation = distance(first, second) / 2
  if (halfSeparation <= EPSILON) return { kind: "unsupported", reason: "两个焦点重合：定不出双曲线的实轴" }
  const centre = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
  const semiTransverse = Math.abs(distance(point, first) - distance(point, second)) / 2
  if (semiTransverse <= EPSILON) {
    return { kind: "contradictory", detail: "这个点到两个焦点的距离相等：差值恒为 0，双曲线要求差值是一个正数 2a" }
  }
  if (semiTransverse >= halfSeparation) {
    return {
      kind: "contradictory",
      detail: `2a = ${(2 * semiTransverse).toFixed(6)} 不小于 2c = ${(2 * halfSeparation).toFixed(6)}：这样的双曲线退化成两条射线`
    }
  }
  const semiConjugate = Math.sqrt(halfSeparation * halfSeparation - semiTransverse * semiTransverse)
  const axial = normalizeAxial(Math.atan2(second.y - first.y, second.x - first.x))
  const alongX = Math.abs(axial) <= AXIS_SNAP
  const alongY = Math.abs(Math.abs(axial) - Math.PI / 2) <= AXIS_SNAP
  /**
   * `axis` 是**实轴**（2026-10-12 统一过的口径）：`axis: "y"` 时半实轴是 `radiusY`、
   * `radiusX` 是半虚轴 —— 所以这里两个字段是**换位**的，不是同一个数换个名字。
   */
  const conic: HyperbolaPrimitive = alongX || !alongY
    ? {
        id: "inverted-hyperbola",
        type: "hyperbola",
        center: centre,
        radiusX: semiTransverse,
        radiusY: semiConjugate,
        axis: "x",
        ...(alongX ? {} : { rotation: axial })
      }
    : { id: "inverted-hyperbola", type: "hyperbola", center: centre, radiusX: semiConjugate, radiusY: semiTransverse, axis: "y" }
  const expected = 2 * semiTransverse
  const sampled = sampleHyperbolaBranches(conic, [semiTransverse, semiTransverse * 4], 16).flat()
  const sampledResidual = worstRelative(sampled, (sample) => (Math.abs(distance(sample, first) - distance(sample, second)) - expected) / expected)
  return {
    kind: "solved",
    conic,
    residual: Math.abs((Math.abs(distance(point, first) - distance(point, second)) - expected) / expected),
    sampledResidual,
    eccentricity: halfSeparation / semiTransverse
  }
}

/**
 * **统一式**：`|PF| / dist(P, L) = e`。
 *
 * 把准线放在参数 0、焦点放在 `+d`（`n` 是从准线指向焦点的单位法向），代入定义式平方整理得
 *
 *     (x − d/(1−e²))² / (de/|1−e²|)²  ±  y² / (de/|1−e²|)²·|1−e²|  =  1
 *
 * 于是：中心在准线外 `d/(1−e²)` 处（`e > 1` 时是**负的** —— 中心跑到准线的另一侧，这正是
 * 椭圆与双曲线在焦点—准线语言里的分野）、半轴 `a = de/|1−e²|`、`b = a√|1−e²|`。`e = 1` 退化成抛物线。
 */
export function conicFromFocusDirectrixAndEccentricity(
  focus: Coordinate,
  directrix: ConicLine,
  eccentricity: number
): ConicInversion<EllipsePrimitive | HyperbolaPrimitive | ParabolaPrimitive> {
  if (!Number.isFinite(eccentricity) || eccentricity <= 0) return { kind: "unsupported", reason: "离心率必须是正的有限数" }
  if (Math.abs(eccentricity - 1) <= 1e-12) return parabolaFromFocusAndDirectrix(focus, directrix)
  if (!finitePoint(focus)) return { kind: "unsupported", reason: "焦点坐标不是有限数" }
  if (!finiteLine(directrix)) return { kind: "unsupported", reason: "准线的端点不是有限数" }
  if (distance(directrix.a, directrix.b) <= EPSILON) return { kind: "unsupported", reason: "准线的两个端点重合（定不出这条直线）" }
  const distanceToDirectrix = distanceToLine(focus, directrix)
  if (!(distanceToDirectrix > EPSILON)) {
    return { kind: "contradictory", detail: "焦点落在准线上：比值 `|PF| / dist(P, L)` 恒等于 1，与给定的离心率不符" }
  }
  const foot = footOfPerpendicular(focus, directrix)
  const normal = { x: (focus.x - foot.x) / distanceToDirectrix, y: (focus.y - foot.y) / distanceToDirectrix }
  const denominator = 1 - eccentricity * eccentricity
  const centreOffset = distanceToDirectrix / denominator
  const semiTransverse = (distanceToDirectrix * eccentricity) / Math.abs(denominator)
  const semiConjugate = semiTransverse * Math.sqrt(Math.abs(denominator))
  const centre = { x: foot.x + normal.x * centreOffset, y: foot.y + normal.y * centreOffset }
  const angle = Math.atan2(normal.y, normal.x)
  const axial = normalizeAxial(angle)
  const relative = (point: Coordinate): number => {
    const toLine = distanceToLine(point, directrix)
    return toLine > 0 ? distance(point, focus) / toLine / eccentricity - 1 : Number.NaN
  }

  if (eccentricity < 1) {
    const conic: EllipsePrimitive = {
      id: "inverted-ellipse",
      type: "ellipse",
      center: centre,
      radiusX: semiTransverse,
      radiusY: semiConjugate,
      ...(Math.abs(axial) <= AXIS_SNAP ? {} : { rotation: axial })
    }
    return { kind: "solved", conic, residual: relative(focus), sampledResidual: worstRelative(sampleEllipse(conic, 32), relative), eccentricity }
  }

  const alongX = Math.abs(axial) <= AXIS_SNAP
  const alongY = Math.abs(Math.abs(axial) - Math.PI / 2) <= AXIS_SNAP
  const conic: HyperbolaPrimitive = alongX || !alongY
    ? {
        id: "inverted-hyperbola",
        type: "hyperbola",
        center: centre,
        radiusX: semiTransverse,
        radiusY: semiConjugate,
        axis: "x",
        ...(alongX ? {} : { rotation: axial })
      }
    : { id: "inverted-hyperbola", type: "hyperbola", center: centre, radiusX: semiConjugate, radiusY: semiTransverse, axis: "y" }
  const sampled = sampleHyperbolaBranches(conic, [semiTransverse, semiTransverse * 4], 16).flat()
  return { kind: "solved", conic, residual: relative(focus), sampledResidual: worstRelative(sampled, relative), eccentricity }
}

export interface SymbolicSemiAxisTerm {
  coordinate: "x" | "y"
  sign: 1 | -1
  symbol: string | null
  numericSemiAxis: number | null
  rawTerm: string
}

export type SymbolicConicEquation =
  | {
      ok: true
      kind: "ellipse" | "hyperbola"
      xTerm: SymbolicSemiAxisTerm
      yTerm: SymbolicSemiAxisTerm
      resolvedAxis: "x" | "y" | "undetermined"
      symbols: string[]
      domainConstraints: string[]
      raw: string
    }
  | {
      ok: false
      error: string
    }

export type SymbolicConicMetricConstraint =
  | { kind: "majorAxisLength" | "minorAxisLength" | "focalLength" | "eccentricity" | "realAxisLength" | "imaginaryAxisLength"; value: number }
  | { kind: "asymptoteTangentCircle"; circle: { centerX: number; centerY: number; radius: number } }
  | { kind: "pointOnCurve"; x: number; y: number }

export interface SymbolicIndependentCheck {
  passed: boolean
  residual: number
  checks: { label: string; residual: number }[]
  tangencyPoints?: { x: number; y: number }[]
}

export type SymbolicConicResolution =
  | {
      status: "solved"
      kind: "ellipse" | "hyperbola"
      conic:
        | { kind: "ellipse"; radiusX: number; radiusY: number }
        | { kind: "hyperbola"; radiusX: number; radiusY: number; axis: "x" | "y" }
      parameterValues: Record<string, number>
      domains: string[]
      asymptotes: string[]
      independentCheck: SymbolicIndependentCheck
    }
  | {
      status: "underdetermined"
      kind: "ellipse" | "hyperbola"
      axis: "x" | "y" | "undetermined"
      symbols: string[]
      domains: string[]
      reason: string
    }
  | {
      status: "invalid"
      reason: string
    }

function splitTopLevelSignedTerms(expr: string): { sign: 1 | -1; term: string }[] {
  const compact = expr.replace(/\s+/g, "").replace(/[−–—]/g, "-")
  const out: { sign: 1 | -1; term: string }[] = []
  let depth = 0
  let currentStart = 0
  let currentSign: 1 | -1 = 1
  for (let i = 0; i < compact.length; i += 1) {
    const ch = compact[i]!
    if (ch === "(") depth += 1
    else if (ch === ")") depth = Math.max(0, depth - 1)
    if (depth > 0) continue
    if (ch === "+" || ch === "-") {
      if (i > currentStart) {
        out.push({ sign: currentSign, term: compact.slice(currentStart, i) })
      }
      currentSign = ch === "-" ? -1 : 1
      currentStart = i + 1
    }
  }
  if (currentStart < compact.length) {
    out.push({ sign: currentSign, term: compact.slice(currentStart) })
  }
  return out
}

function parseSquaredAxisTerm(rawTerm: string, sign: 1 | -1): SymbolicSemiAxisTerm | null {
  const normalized = rawTerm.replace(/²/g, "^2")
  const match = /^(?:(\d+(?:\.\d+)?)\s*\*?\s*)?([xy])\^2(?:\s*\/\s*(.+))?$/.exec(normalized)
  if (match === null) return null
  const numCoeff = match[1] === undefined ? 1 : Number(match[1])
  if (!Number.isFinite(numCoeff) || numCoeff <= 0) return null
  const coordinate = match[2] as "x" | "y"
  const denomRaw = match[3]?.trim()

  if (denomRaw === undefined) {
    return {
      coordinate,
      sign,
      symbol: null,
      numericSemiAxis: 1 / Math.sqrt(numCoeff),
      rawTerm
    }
  }

  const stripped = denomRaw.startsWith("(") && denomRaw.endsWith(")") ? denomRaw.slice(1, -1).trim() : denomRaw
  const symMatch = /^([A-Za-z][A-Za-z0-9_]*)\^2$/.exec(stripped)
  if (symMatch !== null && numCoeff === 1) {
    return {
      coordinate,
      sign,
      symbol: symMatch[1]!,
      numericSemiAxis: null,
      rawTerm
    }
  }
  const evaluated = evaluateExpressionWithDomain(stripped, {})
  if (evaluated.ok && evaluated.value > 0) {
    return {
      coordinate,
      sign,
      symbol: null,
      numericSemiAxis: Math.sqrt(evaluated.value / numCoeff),
      rawTerm
    }
  }
  return null
}

function analyzeDomainRelations(
  domainStrings: readonly string[],
  symbols: readonly string[]
): { ok: true; constraints: ParsedRelationConstraint[]; greaterThan: [string, string][] } | { ok: false; error: string } {
  const constraints: ParsedRelationConstraint[] = []
  const greaterThan: [string, string][] = []
  const symbolSet = new Set(symbols)

  for (const raw of domainStrings) {
    let parsed: ParsedRelationConstraint
    try {
      parsed = parseRelationConstraint(raw)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
    constraints.push(parsed)

    for (let i = 0; i < parsed.operators.length; i += 1) {
      const left = parsed.terms[i]!
      const right = parsed.terms[i + 1]!
      const op = parsed.operators[i]!

      const leftVar = left.type === "variable" ? left.name : null
      const rightVar = right.type === "variable" ? right.name : null
      const leftNum = evaluateExpressionWithDomain(left, {})
      const rightNum = evaluateExpressionWithDomain(right, {})

      // Reject explicit non-positive domain statements for conic semi-axes.
      if (leftVar && symbolSet.has(leftVar) && rightNum.ok) {
        if ((op === "<=" || op === "<" || op === "=") && rightNum.value <= 0) {
          return { ok: false, error: `Semi-axis symbol "${leftVar}" must be positive, got constraint "${raw}"` }
        }
      }
      if (rightVar && symbolSet.has(rightVar) && leftNum.ok) {
        if ((op === ">=" || op === ">" || op === "=") && leftNum.value <= 0) {
          return { ok: false, error: `Semi-axis symbol "${rightVar}" must be positive, got constraint "${raw}"` }
        }
      }

      if (leftVar && rightVar) {
        if (leftVar === rightVar && (op === "<" || op === ">" || op === "!=")) {
          return { ok: false, error: `Contradictory domain constraint "${raw}"` }
        }
        if (op === ">") greaterThan.push([leftVar, rightVar])
        else if (op === "<") greaterThan.push([rightVar, leftVar])
      }
    }
  }

  // Transitivity closure on strict symbol > symbol comparisons to detect cycles.
  const reaches = (from: string, target: string, visited = new Set<string>()): boolean => {
    if (from === target) return true
    if (visited.has(from)) return false
    visited.add(from)
    return greaterThan.some(([hi, lo]) => hi === from && reaches(lo, target, visited))
  }
  for (const [hi, lo] of greaterThan) {
    if (reaches(lo, hi)) {
      return { ok: false, error: `Contradictory ordering cycle involving ${hi} and ${lo}` }
    }
  }

  return { ok: true, constraints, greaterThan }
}

export function parseSymbolicConicEquation(
  equation: string,
  domainStrings: readonly string[] = []
): SymbolicConicEquation {
  const cleaned = equation
    .trim()
    .replace(/^\$+|\$+$/g, "")
    .replace(/＝/g, "=")
    .replace(/[−–—]/g, "-")
  const eqParts = cleaned.split("=")
  if (eqParts.length !== 2) {
    return { ok: false, error: `Expected single "=" in conic equation "${equation}"` }
  }
  const rhsEval = evaluateExpressionWithDomain(eqParts[1]!, {})
  if (!rhsEval.ok || Math.abs(rhsEval.value - 1) > 1e-9) {
    return { ok: false, error: `Standard symbolic conic RHS must equal 1, got "${eqParts[1]?.trim()}"` }
  }

  const rawTerms = splitTopLevelSignedTerms(eqParts[0]!)
  if (rawTerms.length !== 2) {
    return { ok: false, error: `Expected two quadratic terms in "${equation}"` }
  }
  const parsedTerms = rawTerms.map((entry) => parseSquaredAxisTerm(entry.term, entry.sign))
  if (parsedTerms.some((item) => item === null)) {
    return { ok: false, error: `Unrecognized symbolic quadratic term in "${equation}"` }
  }
  const xTerm = parsedTerms.find((item) => item!.coordinate === "x") ?? null
  const yTerm = parsedTerms.find((item) => item!.coordinate === "y") ?? null
  if (xTerm === null || yTerm === null) {
    return { ok: false, error: `Conic equation must contain both x² and y² terms: "${equation}"` }
  }
  if (xTerm.sign === -1 && yTerm.sign === -1) {
    return { ok: false, error: `Negative squared terms cannot equal 1 in "${equation}"` }
  }

  const kind: "ellipse" | "hyperbola" = xTerm.sign === 1 && yTerm.sign === 1 ? "ellipse" : "hyperbola"
  const symbols = [...new Set([xTerm.symbol, yTerm.symbol].filter((s): s is string => s !== null))]
  const domainAnalysis = analyzeDomainRelations(domainStrings, symbols)
  if (!domainAnalysis.ok) return { ok: false, error: domainAnalysis.error }

  let resolvedAxis: "x" | "y" | "undetermined" = "undetermined"
  if (kind === "hyperbola") {
    resolvedAxis = xTerm.sign === 1 ? "x" : "y"
  } else {
    const reaches = (hi: string, lo: string, visited = new Set<string>()): boolean => {
      if (visited.has(hi)) return false
      visited.add(hi)
      for (const [a, b] of domainAnalysis.greaterThan) {
        if (a === hi && (b === lo || reaches(b, lo, visited))) return true
      }
      return false
    }
    if (xTerm.symbol !== null && yTerm.symbol !== null) {
      if (reaches(xTerm.symbol, yTerm.symbol)) resolvedAxis = "x"
      else if (reaches(yTerm.symbol, xTerm.symbol)) resolvedAxis = "y"
    } else if (xTerm.numericSemiAxis !== null && yTerm.numericSemiAxis !== null) {
      if (xTerm.numericSemiAxis > yTerm.numericSemiAxis + 1e-9) resolvedAxis = "x"
      else if (yTerm.numericSemiAxis > xTerm.numericSemiAxis + 1e-9) resolvedAxis = "y"
    }
  }

  return {
    ok: true,
    kind,
    xTerm,
    yTerm,
    resolvedAxis,
    symbols,
    domainConstraints: [...domainStrings],
    raw: cleaned
  }
}

function solvePositiveQuadratic(a: number, b: number, c: number): number[] {
  const eps = 1e-12
  if (Math.abs(a) <= eps) {
    if (Math.abs(b) <= eps) return []
    const root = -c / b
    return root > eps && Number.isFinite(root) ? [root] : []
  }
  const disc = b * b - 4 * a * c
  if (disc < -1e-10) return []
  const clampedDisc = Math.max(0, disc)
  const sqrtDisc = Math.sqrt(clampedDisc)
  const candidates = [(-b - sqrtDisc) / (2 * a), (-b + sqrtDisc) / (2 * a)]
  const unique: number[] = []
  for (const r of candidates) {
    if (r > eps && Number.isFinite(r) && !unique.some((u) => Math.abs(u - r) <= 1e-9)) {
      unique.push(r)
    }
  }
  return unique
}

export function solveSymbolicConicContract(
  spec: Extract<SymbolicConicEquation, { ok: true }>,
  metrics: readonly SymbolicConicMetricConstraint[],
  extraDomains: readonly string[] = []
): SymbolicConicResolution {
  const allDomains = [...new Set([...spec.domainConstraints, ...extraDomains])]
  const domainAnalysis = analyzeDomainRelations(allDomains, spec.symbols)
  if (!domainAnalysis.ok) return { status: "invalid", reason: domainAnalysis.error }

  if (spec.kind === "ellipse") {
    if (spec.resolvedAxis === "undetermined") {
      return {
        status: "underdetermined",
        kind: "ellipse",
        axis: "undetermined",
        symbols: spec.symbols,
        domains: allDomains,
        reason: "Symbolic ellipse semi-axis ordering is not established (major axis could be x or y)."
      }
    }
    const majorTerm = spec.resolvedAxis === "x" ? spec.xTerm : spec.yTerm
    const minorTerm = spec.resolvedAxis === "x" ? spec.yTerm : spec.xTerm

    let a: number | null = majorTerm.numericSemiAxis
    let b: number | null = minorTerm.numericSemiAxis
    let c: number | null = null
    let e: number | null = null

    for (const metric of metrics) {
      if (metric.kind === "asymptoteTangentCircle" || metric.kind === "pointOnCurve") continue
      if (!Number.isFinite(metric.value) || metric.value <= 0) {
        return { status: "invalid", reason: `Conic metric ${metric.kind} must be positive` }
      }
      if (metric.kind === "majorAxisLength") a = metric.value / 2
      else if (metric.kind === "minorAxisLength") b = metric.value / 2
      else if (metric.kind === "focalLength") c = metric.value / 2
      else if (metric.kind === "eccentricity") {
        if (!(metric.value > 0 && metric.value < 1)) {
          return { status: "invalid", reason: `Ellipse eccentricity must satisfy 0 < e < 1, got ${metric.value}` }
        }
        e = metric.value
      }
    }

    const curvePoints = metrics.filter((m): m is Extract<SymbolicConicMetricConstraint, { kind: "pointOnCurve" }> => m.kind === "pointOnCurve")
    for (const pt of curvePoints) {
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
        return { status: "invalid", reason: "Point on conic must have finite coordinates" }
      }
      const u = spec.resolvedAxis === "x" ? pt.x * pt.x : pt.y * pt.y
      const v = spec.resolvedAxis === "x" ? pt.y * pt.y : pt.x * pt.x
      if (c !== null && a === null && b === null) {
        const rootsA2 = solvePositiveQuadratic(1, -(u + v + c * c), u * c * c).filter((a2) => a2 > c! * c! + 1e-12)
        if (rootsA2.length === 1) {
          a = Math.sqrt(rootsA2[0]!)
          b = Math.sqrt(rootsA2[0]! - c * c)
        }
      } else if (a !== null && b === null && v > 1e-12) {
        const denom = 1 - u / (a * a)
        if (denom > 1e-12) b = Math.sqrt(v / denom)
      } else if (b !== null && a === null && u > 1e-12) {
        const denom = 1 - v / (b * b)
        if (denom > 1e-12) a = Math.sqrt(u / denom)
      }
    }
    if ((a === null || b === null) && curvePoints.length >= 2) {
      const p1 = curvePoints[0]!
      const p2 = curvePoints[1]!
      const u1 = spec.resolvedAxis === "x" ? p1.x * p1.x : p1.y * p1.y
      const v1 = spec.resolvedAxis === "x" ? p1.y * p1.y : p1.x * p1.x
      const u2 = spec.resolvedAxis === "x" ? p2.x * p2.x : p2.y * p2.y
      const v2 = spec.resolvedAxis === "x" ? p2.y * p2.y : p2.x * p2.x
      const det = u1 * v2 - u2 * v1
      if (Math.abs(det) > 1e-12) {
        const invA2 = (v2 - v1) / det
        const invB2 = (u1 - u2) / det
        if (invA2 > 1e-12 && invB2 > 1e-12) {
          a = 1 / Math.sqrt(invA2)
          b = 1 / Math.sqrt(invB2)
        }
      }
    }

    if (e !== null && a !== null && c === null) c = a * e
    if (e !== null && c !== null && a === null) a = c / e
    if (e !== null && b !== null && a === null) a = b / Math.sqrt(1 - e * e)
    if (a !== null && c !== null && b === null) {
      const bSq = a * a - c * c
      if (!(bSq > 0)) return { status: "invalid", reason: "Ellipse semi-axes contradict a > c > 0" }
      b = Math.sqrt(bSq)
    }
    if (a !== null && b !== null && c === null) {
      const cSq = a * a - b * b
      if (!(cSq > 0)) return { status: "invalid", reason: "Ellipse requires major semi-axis > minor semi-axis" }
      c = Math.sqrt(cSq)
    }
    if (b !== null && c !== null && a === null) a = Math.sqrt(b * b + c * c)

    if (a === null || b === null || c === null) {
      return {
        status: "underdetermined",
        kind: "ellipse",
        axis: spec.resolvedAxis,
        symbols: spec.symbols,
        domains: allDomains,
        reason: "Underdetermined symbolic ellipse: scale condition is required alongside shape."
      }
    }
    if (!(a > b && b > 0)) {
      return { status: "invalid", reason: `Solved ellipse values (${a}, ${b}) violate a > b > 0` }
    }

    const parameterValues: Record<string, number> = {}
    if (majorTerm.symbol !== null) parameterValues[majorTerm.symbol] = a
    if (minorTerm.symbol !== null) parameterValues[minorTerm.symbol] = b
    if (parameterValues.c === undefined) parameterValues.c = c

    for (const constraint of domainAnalysis.constraints) {
      if (!constraint.variables.every((v) => parameterValues[v] !== undefined)) continue
      const check = evaluateRelationConstraint(constraint, parameterValues)
      if (!check.ok) return { status: "invalid", reason: check.error ?? "Domain constraint violated" }
    }

    const rx = spec.resolvedAxis === "x" ? a : b
    const ry = spec.resolvedAxis === "x" ? b : a
    const ellipsePrimitive: EllipsePrimitive = { id: "symbolic-ellipse-check", type: "ellipse", center: { x: 0, y: 0 }, radiusX: rx, radiusY: ry }
    const vertexXResidual = conicResidualAt(ellipsePrimitive, { x: rx, y: 0 })?.residual ?? 1
    const vertexYResidual = conicResidualAt(ellipsePrimitive, { x: 0, y: ry })?.residual ?? 1
    const checks: { label: string; residual: number }[] = [
      { label: "focal_identity_a2_b2_c2", residual: Math.abs((a * a - b * b) - c * c) },
      { label: "vertex_x_equation_residual", residual: vertexXResidual },
      { label: "vertex_y_equation_residual", residual: vertexYResidual }
    ]
    const eccMetric = metrics.find((m) => m.kind === "eccentricity")
    if (eccMetric !== undefined && eccMetric.kind === "eccentricity") {
      checks.push({ label: "eccentricity_c_over_a", residual: Math.abs(c / a - eccMetric.value) })
    }
    const majorMetric = metrics.find((m) => m.kind === "majorAxisLength")
    if (majorMetric !== undefined && majorMetric.kind === "majorAxisLength") {
      checks.push({ label: "major_axis_2a", residual: Math.abs(2 * a - majorMetric.value) })
    }
    const maxResidual = Math.max(...checks.map((item) => item.residual))
    return {
      status: "solved",
      kind: "ellipse",
      conic: { kind: "ellipse", radiusX: rx, radiusY: ry },
      parameterValues,
      domains: allDomains,
      asymptotes: [],
      independentCheck: {
        passed: maxResidual < 1e-7,
        residual: maxResidual,
        checks
      }
    }
  }

  // Hyperbola case
  const axis = spec.resolvedAxis === "y" ? "y" : "x"
  let rx: number | null = spec.xTerm.numericSemiAxis
  let ry: number | null = spec.yTerm.numericSemiAxis
  let c: number | null = null
  let e: number | null = null

  for (const metric of metrics) {
    if (metric.kind === "asymptoteTangentCircle" || metric.kind === "pointOnCurve") continue
    if (!Number.isFinite(metric.value) || metric.value <= 0) {
      return { status: "invalid", reason: `Conic metric ${metric.kind} must be positive` }
    }
    if (metric.kind === "realAxisLength") {
      if (axis === "x") rx = metric.value / 2
      else ry = metric.value / 2
    } else if (metric.kind === "imaginaryAxisLength") {
      if (axis === "x") ry = metric.value / 2
      else rx = metric.value / 2
    } else if (metric.kind === "focalLength") {
      c = metric.value / 2
    } else if (metric.kind === "eccentricity") {
      if (!(metric.value > 1)) {
        return { status: "invalid", reason: `Hyperbola eccentricity must satisfy e > 1, got ${metric.value}` }
      }
      e = metric.value
    }
  }

  const transverse = axis === "x" ? rx : ry
  if (e !== null && transverse !== null && c === null) c = transverse * e
  if (e !== null && c !== null && transverse === null) {
    if (axis === "x") rx = c / e
    else ry = c / e
  }
  if (c !== null && rx !== null && ry === null) {
    const sq = c * c - rx * rx
    if (!(sq > 0)) return { status: "invalid", reason: "Hyperbola c must exceed semi-axes" }
    ry = Math.sqrt(sq)
  }
  if (c !== null && ry !== null && rx === null) {
    const sq = c * c - ry * ry
    if (!(sq > 0)) return { status: "invalid", reason: "Hyperbola c must exceed semi-axes" }
    rx = Math.sqrt(sq)
  }

  const hypCurvePoints = metrics.filter((m): m is Extract<SymbolicConicMetricConstraint, { kind: "pointOnCurve" }> => m.kind === "pointOnCurve")
  for (const pt of hypCurvePoints) {
    if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) {
      return { status: "invalid", reason: "Point on conic must have finite coordinates" }
    }
    const u = axis === "x" ? pt.x * pt.x : pt.y * pt.y
    const v = axis === "x" ? pt.y * pt.y : pt.x * pt.x
    if (c !== null && rx === null && ry === null) {
      const rootsA2 = solvePositiveQuadratic(1, -(u + v + c * c), u * c * c).filter((a2) => a2 > 1e-12 && a2 < c! * c! - 1e-12)
      if (rootsA2.length === 1) {
        const aVal = Math.sqrt(rootsA2[0]!)
        const bVal = Math.sqrt(c * c - rootsA2[0]!)
        if (axis === "x") {
          rx = aVal
          ry = bVal
        } else {
          ry = aVal
          rx = bVal
        }
      }
    }
  }
  if ((rx === null || ry === null) && hypCurvePoints.length >= 2) {
    const p1 = hypCurvePoints[0]!
    const p2 = hypCurvePoints[1]!
    const u1 = axis === "x" ? p1.x * p1.x : p1.y * p1.y
    const v1 = axis === "x" ? p1.y * p1.y : p1.x * p1.x
    const u2 = axis === "x" ? p2.x * p2.x : p2.y * p2.y
    const v2 = axis === "x" ? p2.y * p2.y : p2.x * p2.x
    const det = u1 * v2 - u2 * v1
    if (Math.abs(det) > 1e-12) {
      const invA2 = (v2 - v1) / det
      const invB2 = (u2 - u1) / det
      if (invA2 > 1e-12 && invB2 > 1e-12) {
        if (axis === "x") {
          rx = 1 / Math.sqrt(invA2)
          ry = 1 / Math.sqrt(invB2)
        } else {
          ry = 1 / Math.sqrt(invA2)
          rx = 1 / Math.sqrt(invB2)
        }
      }
    }
  }

  const tangencyPoints: { x: number; y: number }[] = []
  const tangencyChecks: { label: string; residual: number }[] = []
  const circleTangency = metrics.find((m) => m.kind === "asymptoteTangentCircle")

  if (circleTangency !== undefined && circleTangency.kind === "asymptoteTangentCircle") {
    const { centerX: cx, centerY: cy, radius: R } = circleTangency.circle
    if (!(R > 0) || !Number.isFinite(R)) {
      return { status: "invalid", reason: "Tangency circle radius must be positive" }
    }
    if (rx === null && ry !== null && spec.xTerm.symbol !== null) {
      const rootsPlus = solvePositiveQuadratic(cy * cy - R * R, 2 * ry * cx * cy, ry * ry * (cx * cx - R * R))
      const rootsMinus = solvePositiveQuadratic(cy * cy - R * R, -2 * ry * cx * cy, ry * ry * (cx * cx - R * R))
      const combined = [...rootsPlus, ...rootsMinus].filter((candidate) => {
        const vals = { [spec.xTerm.symbol!]: candidate }
        return domainAnalysis.constraints.every(
          (cst) => !cst.variables.includes(spec.xTerm.symbol!) || evaluateRelationConstraint(cst, vals).ok
        )
      })
      const distinct: number[] = []
      for (const root of combined) {
        if (!distinct.some((prev) => Math.abs(prev - root) <= 1e-8)) distinct.push(root)
      }
      if (distinct.length === 0) return { status: "invalid", reason: "No positive parameter satisfies asymptote-circle tangency" }
      if (distinct.length > 1) {
        return {
          status: "underdetermined",
          kind: "hyperbola",
          axis,
          symbols: spec.symbols,
          domains: allDomains,
          reason: "Multiple distinct positive roots satisfy asymptote-circle tangency."
        }
      }
      rx = distinct[0]!
    } else if (ry === null && rx !== null && spec.yTerm.symbol !== null) {
      const rootsPlus = solvePositiveQuadratic(cx * cx - R * R, 2 * rx * cx * cy, rx * rx * (cy * cy - R * R))
      const rootsMinus = solvePositiveQuadratic(cx * cx - R * R, -2 * rx * cx * cy, rx * rx * (cy * cy - R * R))
      const combined = [...rootsPlus, ...rootsMinus].filter((candidate) => {
        const vals = { [spec.yTerm.symbol!]: candidate }
        return domainAnalysis.constraints.every(
          (cst) => !cst.variables.includes(spec.yTerm.symbol!) || evaluateRelationConstraint(cst, vals).ok
        )
      })
      const distinct: number[] = []
      for (const root of combined) {
        if (!distinct.some((prev) => Math.abs(prev - root) <= 1e-8)) distinct.push(root)
      }
      if (distinct.length === 0) return { status: "invalid", reason: "No positive parameter satisfies asymptote-circle tangency" }
      if (distinct.length > 1) {
        return {
          status: "underdetermined",
          kind: "hyperbola",
          axis,
          symbols: spec.symbols,
          domains: allDomains,
          reason: "Multiple distinct positive roots satisfy asymptote-circle tangency."
        }
      }
      ry = distinct[0]!
    }
  }

  if (rx === null || ry === null || !(rx > 0) || !(ry > 0)) {
    return {
      status: "underdetermined",
      kind: "hyperbola",
      axis,
      symbols: spec.symbols,
      domains: allDomains,
      reason: "Underdetermined symbolic hyperbola: insufficient equations to solve both semi-axes."
    }
  }

  const parameterValues: Record<string, number> = {}
  if (spec.xTerm.symbol !== null) parameterValues[spec.xTerm.symbol] = rx
  if (spec.yTerm.symbol !== null) parameterValues[spec.yTerm.symbol] = ry
  parameterValues.c = Math.hypot(rx, ry)

  for (const constraint of domainAnalysis.constraints) {
    if (!constraint.variables.every((v) => parameterValues[v] !== undefined)) continue
    const check = evaluateRelationConstraint(constraint, parameterValues)
    if (!check.ok) return { status: "invalid", reason: check.error ?? "Domain constraint violated" }
  }

  // Independent verification of asymptotes & tangency points (general, no problem-specific formulas)
  if (circleTangency !== undefined && circleTangency.kind === "asymptoteTangentCircle") {
    const { centerX: cx, centerY: cy, radius: R } = circleTangency.circle
    const norm = Math.hypot(ry, rx)
    let matchedTangentLines = 0
    for (const sign of [1, -1] as const) {
      const ax = ry
      const ay = sign * rx
      const signedDist = (ax * cx + ay * cy) / norm
      const distGap = Math.abs(Math.abs(signedDist) - R)
      if (distGap <= 1e-6) {
        matchedTangentLines += 1
        const proj = (ax * cx + ay * cy) / (ax * ax + ay * ay)
        const tx = cx - proj * ax
        const ty = cy - proj * ay
        tangencyPoints.push({ x: tx, y: ty })
        tangencyChecks.push({
          label: `asymptote_${sign > 0 ? "pos" : "neg"}_circle_tangency`,
          residual: Math.max(distGap, Math.abs(ax * tx + ay * ty), Math.abs(Math.hypot(tx - cx, ty - cy) - R))
        })
      }
    }
    if (matchedTangentLines === 0) {
      return { status: "invalid", reason: "Solved hyperbola asymptotes are not tangent to the circle" }
    }
  }

  const vx = axis === "x" ? rx : 0
  const vy = axis === "y" ? ry : 0
  const vertexResidual = axis === "x"
    ? Math.abs((vx * vx) / (rx * rx) - (vy * vy) / (ry * ry) - 1)
    : Math.abs((vy * vy) / (ry * ry) - (vx * vx) / (rx * rx) - 1)
  const checks = [{ label: "hyperbola_vertex_residual", residual: vertexResidual }, ...tangencyChecks]
  const maxResidual = Math.max(...checks.map((item) => item.residual))

  const asymptotes = [
    `y = (${(ry / rx).toPrecision(6)})*x`,
    `y = -(${(ry / rx).toPrecision(6)})*x`
  ]

  return {
    status: "solved",
    kind: "hyperbola",
    conic: { kind: "hyperbola", radiusX: rx, radiusY: ry, axis },
    parameterValues,
    domains: allDomains,
    asymptotes,
    independentCheck: {
      passed: maxResidual < 1e-7,
      residual: maxResidual,
      checks,
      ...(tangencyPoints.length > 0 ? { tangencyPoints } : {})
    }
  }
}

export type OriginConicFitResult =
  | {
    kind: "ellipse"
    radiusX: number
    radiusY: number
    residuals: [number, number]
  }
  | {
    kind: "hyperbola"
    radiusX: number
    radiusY: number
    axis: "x" | "y"
    residuals: [number, number]
  }

/**
 * Fits a centered axis-aligned conic (`A*x^2 + B*y^2 = 1`) through two linearly
 * independent non-symmetric points `(p1, p2)` with independent equation residuals.
 */
export function fitOriginConicThroughPoints(
  points: readonly [Coordinate, Coordinate],
  axisHint?: "x" | "y",
  expectedKind?: "ellipse" | "hyperbola"
): OriginConicFitResult | null {
  const [p1, p2] = points
  if (
    !Number.isFinite(p1.x) || !Number.isFinite(p1.y) ||
    !Number.isFinite(p2.x) || !Number.isFinite(p2.y)
  ) {
    return null
  }
  const x1Sq = p1.x * p1.x
  const y1Sq = p1.y * p1.y
  const x2Sq = p2.x * p2.x
  const y2Sq = p2.y * p2.y
  const det = x1Sq * y2Sq - x2Sq * y1Sq
  if (!Number.isFinite(det) || Math.abs(det) <= 1e-12) return null

  const A = (y2Sq - y1Sq) / det
  const B = (x1Sq - x2Sq) / det
  if (!Number.isFinite(A) || !Number.isFinite(B)) return null

  const residualAt = (p: Coordinate): number => Math.abs(A * p.x * p.x + B * p.y * p.y - 1)
  const r1 = residualAt(p1)
  const r2 = residualAt(p2)
  if (r1 > 1e-7 || r2 > 1e-7) return null

  if (A > 1e-12 && B > 1e-12) {
    if (expectedKind === "hyperbola") return null
    return {
      kind: "ellipse",
      radiusX: Math.sqrt(1 / A),
      radiusY: Math.sqrt(1 / B),
      residuals: [r1, r2]
    }
  }
  if (A * B < -1e-24) {
    if (expectedKind === "ellipse") return null
    const axis: "x" | "y" = A > 0 ? "x" : "y"
    if (axisHint !== undefined && axisHint !== axis) return null
    return {
      kind: "hyperbola",
      axis,
      radiusX: Math.sqrt(1 / Math.abs(A)),
      radiusY: Math.sqrt(1 / Math.abs(B)),
      residuals: [r1, r2]
    }
  }
  return null
}
