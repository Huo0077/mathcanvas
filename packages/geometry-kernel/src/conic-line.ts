import type { CirclePrimitive, Coordinate, EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

/**
 * **代数**直线 ∩ 圆锥曲线（Task 14）。
 *
 * ## 为什么要有这一层
 *
 * 仓里已有的 `intersectSampledPrimitives`（`curve-intersections.ts`）把曲线离散成折线、再求线段交点，
 * 它的返回只有 `none / point / points / degenerate` —— **永远给不出"相切"**：相切与"两个极近的交点"
 * 在采样下区分不开，交点数还取决于弦端点有没有跨过曲线，与**重数**无关。
 * 计划对 Task 14 的原文要求是：「切触用**代数重根**或**可验证切向条件**，不用画面采样宣称恰有 n 个交点」。
 *
 * ## 口径
 *
 * 一元二次 `αt² + βt + γ = 0` 的判别式给出重数，**不猜**：
 *
 * | 情形 | 判定 | 返回 |
 * | --- | --- | --- |
 * | `α = 0, β ≠ 0` | 直线与对称轴平行（抛物线那一支） | `single` —— 恰好**一个**有限交点 |
 * | `Δ < 0` | 无实根 | `none` |
 * | `Δ ≈ 0` | 重根 | `tangent` |
 * | `Δ > 0` | 两个不同实根 | `secant` |
 *
 * `single` 与 `tangent` **必须分开**：前者是"另一个交点在无穷远"，后者是"重根"。
 * 把它们并成一个词，"恰好一个交点"这句话就会在两种完全不同的几何之间来回漂。
 *
 * ## 残差是读数，不是判据
 *
 * 每个分支都带两样可核的量：`residual`（报告的点离曲线的距离估计，长度量纲）与
 * `tangency`（`|∇Q·d| / (|∇Q|·|d|)`，无量纲，0 表示切线与梯度垂直 —— 也就是**真相切**）。
 * 调用方可以只看 `kind`，也可以自己拿这两样复核；**不要**拿本函数自报的残差当"题目已核验"。
 */

export type PlanarConic = CirclePrimitive | EllipsePrimitive | HyperbolaPrimitive | ParabolaPrimitive

/** 一条直线：过 `a`、`b` 两点（方向由 `b − a` 给出，长度无关）。 */
export interface ConicLine {
  a: Coordinate
  b: Coordinate
}

export interface ConicLineEvidence {
  /** 局部一元二次的判别式 `β² − 4αγ`（量纲随系数，只作读数）。 */
  discriminant: number
  /** 报告的点离曲线的距离估计：`max |Q(P)| / max(1, |∇Q(P)|)`（长度量纲）。 */
  residual: number
  /** 切向残差 `max |∇Q(P)·d| / (|∇Q(P)|·|d|)`（无量纲；切线应接近 0）。 */
  tangency: number
}

export type LineConicIntersection =
  | ({ kind: "none" } & ConicLineEvidence)
  | ({ kind: "tangent"; point: Coordinate } & ConicLineEvidence)
  | ({ kind: "secant"; points: [Coordinate, Coordinate] } & ConicLineEvidence)
  | ({ kind: "single"; point: Coordinate } & ConicLineEvidence)
  | { kind: "degenerate"; reason: string }

/**
 * 局部（轴对齐）隐式形式 `A x² + C y² + D x + E y + F = 0`，外加两个坐标变换。
 *
 * **系数刻意归一化**（比如椭圆用 `x²/a² + y²/b² − 1`，而不是乘开成 `b²x² + a²y² − a²b²`）：
 * 后者在 `a = 1000` 时系数到 1e12，`α/β/γ` 的浮点条件数会差好几个数量级，
 * 判别式那一支的"相切"就会被舍入误差顶掉。
 */
interface LocalForm {
  toLocal: (point: Coordinate) => Coordinate
  toWorld: (point: Coordinate) => Coordinate
  A: number
  C: number
  D: number
  E: number
  F: number
}

const EPSILON = 1e-12

function finite(point: Coordinate): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function buildLocalForm(conic: PlanarConic): LocalForm | null {
  const rotation = conic.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const origin = conic.type === "parabola" ? conic.vertex : conic.center
  if (!finite(origin) || !Number.isFinite(rotation)) return null
  const toLocal = (point: Coordinate): Coordinate => {
    const dx = point.x - origin.x
    const dy = point.y - origin.y
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos }
  }
  const toWorld = (point: Coordinate): Coordinate => ({ x: origin.x + point.x * cos - point.y * sin, y: origin.y + point.x * sin + point.y * cos })

  if (conic.type === "circle") {
    if (!(conic.radius > 0)) return null
    return { toLocal, toWorld, A: 1, C: 1, D: 0, E: 0, F: -(conic.radius * conic.radius) }
  }
  if (conic.type === "ellipse") {
    if (!(conic.radiusX > 0) || !(conic.radiusY > 0)) return null
    return { toLocal, toWorld, A: 1 / (conic.radiusX * conic.radiusX), C: 1 / (conic.radiusY * conic.radiusY), D: 0, E: 0, F: -1 }
  }
  if (conic.type === "hyperbola") {
    if (!(conic.radiusX > 0) || !(conic.radiusY > 0)) return null
    /**
     * **`axis` 是实轴**（与 `sampleHyperbola` / `hyperbolaConicCoefficients` 同一口径，
     * 2026-10-12 统一）：`axis: "x"` ⇒ `x²/rx² − y²/ry² = 1`。
     */
    const alongX = conic.axis === "x"
    return {
      toLocal,
      toWorld,
      A: (alongX ? 1 : -1) / (conic.radiusX * conic.radiusX),
      C: (alongX ? -1 : 1) / (conic.radiusY * conic.radiusY),
      D: 0,
      E: 0,
      F: -1
    }
  }
  if (!(conic.focalParameter > 0)) return null
  // 抛物线：`axis: "x"` ⇒ `y² = 2px`；`axis: "y"` ⇒ `x² = 2py`（顶点在局部原点）。
  const p = conic.focalParameter
  return conic.axis === "x"
    ? { toLocal, toWorld, A: 0, C: 1, D: -2 * p, E: 0, F: 0 }
    : { toLocal, toWorld, A: 1, C: 0, D: 0, E: -2 * p, F: 0 }
}

/** 局部形式在一点的值与梯度（`∂/∂x = 2Ax + D`、`∂/∂y = 2Cy + E`）。 */
function evaluate(form: LocalForm, point: Coordinate): { value: number; gradient: Coordinate } {
  return {
    value: form.A * point.x * point.x + form.C * point.y * point.y + form.D * point.x + form.E * point.y + form.F,
    gradient: { x: 2 * form.A * point.x + form.D, y: 2 * form.C * point.y + form.E }
  }
}

/** 报告点上的两样残差（都在**局部**坐标里算，与旋转无关）。 */
function evidenceAt(form: LocalForm, localPoint: Coordinate, direction: Coordinate): { residual: number; tangency: number } {
  const { value, gradient } = evaluate(form, localPoint)
  const gradientLength = Math.hypot(gradient.x, gradient.y)
  const directionLength = Math.hypot(direction.x, direction.y)
  const residual = gradientLength > 0 ? Math.abs(value) / Math.max(1, gradientLength) : Math.abs(value)
  const tangency = gradientLength > 0 && directionLength > 0
    ? Math.abs(gradient.x * direction.x + gradient.y * direction.y) / (gradientLength * directionLength)
    : 1
  return { residual, tangency }
}

export function intersectLineWithConic(line: ConicLine, conic: PlanarConic): LineConicIntersection {
  if (!finite(line.a) || !finite(line.b)) return { kind: "degenerate", reason: "直线的端点不是有限数" }
  const form = buildLocalForm(conic)
  if (form === null) return { kind: "degenerate", reason: "这条圆锥曲线的参数退化（半轴/半径必须为正的有限数）" }
  const start = form.toLocal(line.a)
  const end = form.toLocal(line.b)
  const direction = { x: end.x - start.x, y: end.y - start.y }
  if (Math.hypot(direction.x, direction.y) <= EPSILON) return { kind: "degenerate", reason: "直线的两个端点重合（零长直线定不出方向）" }

  const alpha = form.A * direction.x * direction.x + form.C * direction.y * direction.y
  const beta = 2 * form.A * start.x * direction.x + 2 * form.C * start.y * direction.y + form.D * direction.x + form.E * direction.y
  const gamma = form.A * start.x * start.x + form.C * start.y * start.y + form.D * start.x + form.E * start.y + form.F
  const discriminant = beta * beta - 4 * alpha * gamma
  const at = (parameter: number): Coordinate => ({ x: start.x + parameter * direction.x, y: start.y + parameter * direction.y })

  const alphaScale = Math.abs(form.A * direction.x * direction.x) + Math.abs(form.C * direction.y * direction.y)
  if (Math.abs(alpha) <= EPSILON * Math.max(alphaScale, Number.MIN_VALUE)) {
    // 二次项消失：直线与抛物线的对称轴平行（或与锥的渐近方向平行）。
    if (Math.abs(beta) <= EPSILON * (Math.abs(form.D * direction.x) + Math.abs(form.E * direction.y) + 1)) {
      return { kind: "degenerate", reason: "整条直线都落在这条曲线的方程上（这是退化情形，解不唯一）" }
    }
    const parameter = -gamma / beta
    const localPoint = at(parameter)
    const { residual, tangency } = evidenceAt(form, localPoint, direction)
    return { kind: "single", point: form.toWorld(localPoint), discriminant, residual, tangency }
  }

  /**
   * **相切怎么判**：不看 `Δ` 的绝对值，看**两个根分开多少**（相对根的尺度）。
   *
   * 绝对值那条路实测踩过坑：直线恰好经过曲线上一点时 `β²` 与 `4αγ` 都可能是 0，
   * `|Δ| ≤ 1e-12 · (β² + |4αγ|)` 的阈值于是塌到 0，浮点把 `Δ` 弄成 −1e-32 就判成"无交"。
   * 换成"根间距 `/ 4α²` 与根的尺度比"之后，阈值不依赖系数怎么归一化，
   * 而且天然回答了真正要问的那句话：**这两个根是不是同一个**。
   */
  const rootCentre = -beta / (2 * alpha)
  const spreadSquared = discriminant / (4 * alpha * alpha)
  const spread = spreadSquared > 0 ? Math.sqrt(spreadSquared) : 0
  const rootScale = Math.max(1, Math.abs(rootCentre), spread)
  /**
   * 容差与 `spreadSquared` **同量纲**（t²）：`1e-12 · rootScale²` 换算成"两根相差多少"是
   * `1e-6 · rootScale`。这个常数不是随手取的：调用方给的切点通常只精确到机器精度，
   * 那会让 `γ` 带上 `~1e-16` 的误差、`spreadSquared` 带上 `~1e-16` 的偏移
   *（实测旋转椭圆那一支正是这样），所以阈值必须明显大于 `ε`、又明显小于任何有意义的根间距。
   */
  const isTangent = Math.abs(spreadSquared) <= 1e-12 * rootScale * rootScale
  if (discriminant < 0 && !isTangent) {
    return { kind: "none", discriminant, residual: Number.POSITIVE_INFINITY, tangency: 0 }
  }
  if (isTangent) {
    const localPoint = at(rootCentre)
    const { residual, tangency } = evidenceAt(form, localPoint, direction)
    return { kind: "tangent", point: form.toWorld(localPoint), discriminant, residual, tangency }
  }
  // 数值稳的写法：先算量级大的那个根，另一个用 `γ/(α·t₁)` 回代（避免两个相近的大数相减）。
  const first = rootCentre - Math.sign(rootCentre || 1) * spread
  const second = Math.abs(first) > EPSILON ? gamma / (alpha * first) : rootCentre + Math.sign(rootCentre || 1) * spread
  const firstPoint = at(first)
  const secondPoint = at(second)
  const firstEvidence = evidenceAt(form, firstPoint, direction)
  const secondEvidence = evidenceAt(form, secondPoint, direction)
  return {
    kind: "secant",
    points: [form.toWorld(firstPoint), form.toWorld(secondPoint)],
    discriminant,
    residual: Math.max(firstEvidence.residual, secondEvidence.residual),
    tangency: Math.max(firstEvidence.tangency, secondEvidence.tangency)
  }
}
