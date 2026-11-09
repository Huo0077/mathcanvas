/**
 * **平面基础判据（W6-D，2026-11-09）**：首批只支持**非退化直角三角形**的面积。
 *
 * 判据刻意窄：
 * - 输入三个点**恰好在一个顶点处直角**才成立（数值上唯一）；
 * - 退化（重合点、共线）→ `unknown`，不套公式；
 * - 非直角三角形 → `unknown`（"任意三角形面积"没有注册判据，不能拿它冒充）。
 * 任意三角形与圆的扩展必须单独声明支持域。
 */

export interface Point2 {
  x: number
  y: number
}

export interface RightTriangleResult {
  decision: "supported" | "refuted" | "unknown"
  reasonCodes: string[]
  area?: number
  rightAngleAt?: 0 | 1 | 2
}

const RELATIVE = 1e-9

function sub(a: Point2, b: Point2): Point2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

function dot(a: Point2, b: Point2): number {
  return a.x * b.x + a.y * b.y
}

function norm(a: Point2): number {
  return Math.sqrt(dot(a, a))
}

function closeTo(left: number, right: number, tolerance = 1e-9): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right))
}

export function checkRightTriangle(
  points: readonly [Point2, Point2, Point2],
  candidateArea: number
): RightTriangleResult {
  if (!points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
    return { decision: "unknown", reasonCodes: ["non_finite_point"] }
  }
  if (!Number.isFinite(candidateArea)) return { decision: "unknown", reasonCodes: ["candidate_not_numeric"] }

  const legs: { at: 0 | 1 | 2; first: number; second: number }[] = []
  for (const at of [0, 1, 2] as const) {
    const a = points[at]
    const b = points[(at + 1) % 3]
    const c = points[(at + 2) % 3]
    const first = sub(b, a)
    const second = sub(c, a)
    const lengthFirst = norm(first)
    const lengthSecond = norm(second)
    if (lengthFirst <= RELATIVE || lengthSecond <= RELATIVE) {
      return { decision: "unknown", reasonCodes: ["degenerate_triangle"] }
    }
    // 直角判据：归一化点积为零（与仓库其余垂直判据同一容差口径）。
    if (Math.abs(dot(first, second)) / (lengthFirst * lengthSecond) <= 1e-9) {
      legs.push({ at, first: lengthFirst, second: lengthSecond })
    }
  }

  if (legs.length === 0) {
    // 非直角三角形：本判据没有注册面积公式，返回 unknown 而不是硬套 1/2·底·高。
    return { decision: "unknown", reasonCodes: ["not_right_triangle"] }
  }
  if (legs.length > 1) return { decision: "unknown", reasonCodes: ["ambiguous_right_angle"] }

  const leg = legs[0]!
  const area = 0.5 * leg.first * leg.second
  if (closeTo(area, candidateArea)) {
    return { decision: "supported", reasonCodes: ["limited_domain"], area, rightAngleAt: leg.at }
  }
  return { decision: "refuted", reasonCodes: ["counterexample_found"], area, rightAngleAt: leg.at }
}
