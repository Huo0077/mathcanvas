import type { Coordinate, EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

import { sampleEllipse, sampleHyperbolaBranches, sampleParabola } from "./conics"
// "过两点的直线"只留一份定义（`conic-line.ts` 里那份），这里复用而不是再抄一个同形接口。
import type { ConicLine } from "./conic-line"

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
