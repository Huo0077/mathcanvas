/**
 * **圆锥曲线的有限判据（W6-A，2026-11-09）**。
 *
 * 只处理两类题设明确、可以**精确算出来**的结论：
 *
 * 1. **双曲线焦点到渐近线的垂足**：候选点必须**同时**满足"落在渐近线上"与
 *    "与焦点的连线垂直于渐近线"。只满足前者就接受，正是 text-128 那类错误的根源。
 * 2. **椭圆点距上顶点的上界**：`|PB| ≤ 2b` 对椭圆上所有点成立 **当且仅当** `e ≤ √2/2`。
 *    参数极值出现在 `sin u = −(1−e²)/e²`；当 `e=√3/2` 时它恰好是 `−1/3`（落在定义域内），
 *    此时最大距离 `4/√3 > 2b`，所以那条全称结论**必须被否证**。
 */

export interface Point2 {
  x: number
  y: number
}

export interface ConicDecision {
  decision: "supported" | "refuted" | "unknown"
  reasonCodes: string[]
  residuals: Record<string, number | null>
}

const TOLERANCE = 1e-9

function closeTo(left: number, right: number, tolerance = 1e-7): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right))
}

function validPoint(point: Point2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

export interface HyperbolaFootInput {
  /** 半实轴；支持域 `a>0`。 */
  a: number
  /** 半虚轴；支持域 `b>0`。 */
  b: number
  point: Point2
}

/**
 * 双曲线 `x²/a² − y²/b² = 1` 的右焦点 `F₂=(c,0)` 到渐近线 `y=(b/a)x` 的垂足。
 *
 * 返回值里 `foot` 与 `distance`（`|OF₂|` 垂足到原点的距离）都是**宿主算的**；
 * 候选点只用于比对。`decision` 为 `refuted` 表示候选点连"落线 + 垂直"都不满足。
 */
export function checkHyperbolaFoot(input: HyperbolaFootInput): ConicDecision & {
  foot?: Point2
  distance?: number
} {
  const reasonCodes: string[] = []
  if (!(input.a > 0) || !(input.b > 0) || !Number.isFinite(input.a) || !Number.isFinite(input.b)) {
    return { decision: "unknown", reasonCodes: ["outside_supported_domain"], residuals: {} }
  }
  if (!validPoint(input.point)) return { decision: "unknown", reasonCodes: ["candidate_not_point"], residuals: {} }

  const { a, b } = input
  const c = Math.sqrt(a * a + b * b)
  const norm = a * a + b * b
  const foot = { x: (c * a * a) / norm, y: (c * a * b) / norm }
  const distance = c * a / Math.sqrt(norm)

  // ① 候选点是否落在渐近线上（y = (b/a)x）。
  const onLine = (input.point.y - (b / a) * input.point.x) / Math.max(1, Math.abs(foot.y), Math.abs(foot.x))
  // ② 候选点与 F₂ 的连线是否垂直于渐近线（方向 (a,b) 归一化）。
  const toPoint = { x: input.point.x - c, y: input.point.y }
  const direction = { x: a / Math.sqrt(norm), y: b / Math.sqrt(norm) }
  const perpendicular = toPoint.x * direction.x + toPoint.y * direction.y
  const residuals = { onLine, perpendicular, footX: foot.x, footY: foot.y, distance }

  if (closeTo(onLine, 0) && closeTo(perpendicular, 0)) {
    // 两个条件同时成立时点唯一：必须与宿主算出的垂足一致才算支持。
    if (closeTo(input.point.x, foot.x) && closeTo(input.point.y, foot.y)) {
      return { decision: "supported", reasonCodes: ["limited_domain", "line_and_perpendicular"], residuals, foot, distance }
    }
    return { decision: "unknown", reasonCodes: ["inconsistent_conditions"], residuals, foot, distance }
  }
  if (!closeTo(onLine, 0) && !closeTo(perpendicular, 0)) reasonCodes.push("not_on_asymptote", "not_perpendicular")
  else if (!closeTo(onLine, 0)) reasonCodes.push("not_on_asymptote")
  else reasonCodes.push("not_perpendicular")
  return { decision: "refuted", reasonCodes: ["counterexample_found", ...reasonCodes], residuals, foot, distance }
}

export interface EllipseVertexBoundInput {
  /** 长半轴；支持域 `a>b>0`。 */
  a: number
  /** 短半轴。 */
  b: number
  /** 题设里的倍数：默认 `PB ≤ 2b`。 */
  boundMultiplier?: number
}

/**
 * 椭圆 `x²/a² + y²/b² = 1` 上点到上顶点 `B=(0,b)` 的距离上界。
 *
 * 精确结论：`max |PB| = 2b` 当 `e ≤ √2/2`；`e > √2/2` 时极值在
 * `sin u = −(1−e²)/e²`，最大距离 `> 2b`。所以全称上界**只在 `e ≤ √2/2` 时成立**。
 */
export function checkEllipseVertexBound(input: EllipseVertexBoundInput): ConicDecision & {
  maximum?: number
  bound?: number
  counterexample?: { sinU: number; distance: number }
} {
  const { a, b } = input
  const multiplier = input.boundMultiplier ?? 2
  if (!(a > 0) || !(b > 0) || !(a > b) || !(multiplier > 0) || !Number.isFinite(a) || !Number.isFinite(b)) {
    return { decision: "unknown", reasonCodes: ["outside_supported_domain"], residuals: {} }
  }
  const eccentricitySquared = 1 - (b * b) / (a * a)
  const bound = multiplier * b
  // 极值参数：sin u = −(1−e²)/e²；≤ −1 时不在椭圆上，最大值出现在下顶点（距离 2b）。
  // 边界（e=√2/2）在浮点上会落在 −1±ε，所以这一段统一按端点处理。
  const sinU = -(1 - eccentricitySquared) / eccentricitySquared
  const outside = sinU <= -1 + 1e-12
  const distance = outside
    ? 2 * b
    : b * Math.sqrt((1 - sinU * sinU) / (1 - eccentricitySquared) + (sinU - 1) * (sinU - 1))
  const residuals = { eccentricitySquared, sinU: outside ? -1 : sinU, distance, bound }
  if (distance <= bound + TOLERANCE * Math.max(1, bound)) {
    return {
      decision: "supported",
      reasonCodes: ["limited_domain", outside ? "bound_at_lower_vertex" : "bound_at_interior_extremum"],
      residuals,
      maximum: distance,
      bound
    }
  }
  return {
    decision: "refuted",
    reasonCodes: ["counterexample_found", "eccentricity_exceeds_threshold"],
    residuals,
    maximum: distance,
    bound,
    counterexample: { sinU, distance }
  }
}
