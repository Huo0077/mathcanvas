/**
 * **立体几何目标的坐标量测**（T7，2026-11-05 四题修复）。
 *
 * 见 [修复设计](../../../../docs/superpowers/specs/2026-11-05-solid-geometry-four-cases-design.md) §4.2 第 7 条
 * 与 [实施计划](../../../../docs/superpowers/plans/2026-11-05-solid-geometry-four-cases.md) T7。
 *
 * ## 为什么必须分开三个量
 *
 * 三种"角"在题面里都是"角"，但**不是同一个数**：
 *
 * | 量 | 定义 | 值域 |
 * |---|---|---|
 * | 线面角 `θ` | `sinθ = |d·n| / (|d||n|)` | `[0°, 90°]` |
 * | 二面角 | 两个**半平面**的夹角（由第三个点定侧） | `[0°, 180°]` |
 * | 平面夹角 | 两个平面的锐角 | `[0°, 90°]` |
 *
 * 统一取"绝对点积"会把二面角 `120°` 报成 `60°` —— 而题面问的可能是前者。
 * 所以本模块**分别**给三个函数，函数名就把口径写清楚，不给一个"万能 angle"。
 *
 * ## 拒绝是值不是异常
 *
 * 退化输入（方向为零、平面三点共线、点与平面重合）返回结构化拒绝，**不返回 NaN**
 * —— NaN 会一路流到文案里，最后变成一句用户看不懂的失败。
 */

import { crossVector3, dotVector3, lengthVector3, normalizeVector3, subtractVector3, type Vector3 } from "./geometry3d"

export type MeasurementRejectionCode = "degenerate-direction" | "degenerate-plane" | "non-finite-value"

export type Measurement = { status: "ok"; value: number } | { status: "rejected"; code: MeasurementRejectionCode; message: string }

const TOLERANCE = 1e-12

function rejected(code: MeasurementRejectionCode, message: string): Measurement {
  return { status: "rejected", code, message }
}

function finitePoint(point: Vector3): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

/**
 * **平面法向**（三点环）：叉积归一化。三点共线或重合 ⇒ 拒绝（不是"法向为零向量"）。
 */
export function planeNormalOf(points: readonly Vector3[]): { status: "ok"; normal: Vector3 } | { status: "rejected"; code: MeasurementRejectionCode; message: string } {
  if (points.length < 3 || points.some((point) => !finitePoint(point))) {
    return { status: "rejected", code: "non-finite-value", message: "平面至少要三个有限坐标的点。" }
  }
  for (let second = 1; second < points.length; second += 1) {
    for (let third = second + 1; third < points.length; third += 1) {
      const normal = crossVector3(subtractVector3(points[second]!, points[0]!), subtractVector3(points[third]!, points[0]!))
      if (lengthVector3(normal) > TOLERANCE) return { status: "ok", normal: normalizeVector3(normal) }
    }
  }
  return { status: "rejected", code: "degenerate-plane", message: "平面的点名三点共线（或重合），定不出法向。" }
}

/**
 * **线面角的正弦**：`sinθ = |d·n| / (|d||n|)`。
 *
 * 注意它**就是** `1 − |线面垂直残差|` 那一侧的量；题面问"所成角的正弦值"时用它，
 * 不要拿 `acos` 再算一遍（那会在 90° 附近放大误差）。
 */
export function linePlaneSine(direction: Vector3, planeNormal: Vector3): Measurement {
  if (!finitePoint(direction) || !finitePoint(planeNormal)) return rejected("non-finite-value", "方向或法向含非有限数值。")
  const directionLength = lengthVector3(direction)
  const normalLength = lengthVector3(planeNormal)
  if (!(directionLength > TOLERANCE)) return rejected("degenerate-direction", "线段两端重合，方向为零向量。")
  if (!(normalLength > TOLERANCE)) return rejected("degenerate-plane", "平面法向为零向量。")
  const sine = Math.abs(dotVector3(direction, planeNormal)) / (directionLength * normalLength)
  return { status: "ok", value: Math.min(1, Math.max(0, sine)) }
}

/** **点到平面的距离**：`|(p − a)·n| / |n|`。 */
export function pointPlaneDistance(point: Vector3, planePoint: Vector3, planeNormal: Vector3): Measurement {
  if (!finitePoint(point) || !finitePoint(planePoint) || !finitePoint(planeNormal)) {
    return rejected("non-finite-value", "点或法向含非有限数值。")
  }
  const normalLength = lengthVector3(planeNormal)
  if (!(normalLength > TOLERANCE)) return rejected("degenerate-plane", "平面法向为零向量。")
  return { status: "ok", value: Math.abs(dotVector3(subtractVector3(point, planePoint), planeNormal)) / normalLength }
}

/**
 * **二面角的余弦**（半平面口径，值域 `[0°, 180°]`）。
 *
 * 做法与内核既有的 `dihedralAngleDetail3` 同源：沿折痕取方向，把两侧各一个点投影到
 * 垂直于折痕的平面上，两个投影方向的夹角就是二面角。**不取绝对值** —— 取绝对值就是
 * 把 120° 报成 60°。
 *
 * 折痕两端重合、或某一侧的投影退化成零 ⇒ 拒绝。
 */
export function dihedralCosine(input: {
  hingeStart: Vector3
  hingeEnd: Vector3
  firstPoint: Vector3
  secondPoint: Vector3
}): Measurement {
  const { hingeStart, hingeEnd, firstPoint, secondPoint } = input
  if (![hingeStart, hingeEnd, firstPoint, secondPoint].every((point) => finitePoint(point))) {
    return rejected("non-finite-value", "折痕或两侧的点含非有限数值。")
  }
  const axis = subtractVector3(hingeEnd, hingeStart)
  const axisLength = lengthVector3(axis)
  if (!(axisLength > TOLERANCE)) return rejected("degenerate-direction", "折痕两端重合，定不出方向。")
  const unit = normalizeVector3(axis)
  const project = (point: Vector3): Vector3 | null => {
    const offset = subtractVector3(point, hingeStart)
    const along = dotVector3(offset, unit)
    const perpendicular = { x: offset.x - along * unit.x, y: offset.y - along * unit.y, z: offset.z - along * unit.z }
    return lengthVector3(perpendicular) > TOLERANCE ? normalizeVector3(perpendicular) : null
  }
  const first = project(firstPoint)
  const second = project(secondPoint)
  if (first === null || second === null) {
    return rejected("degenerate-plane", "有一侧的点落在折痕上（投影退化），定不出半平面。")
  }
  return { status: "ok", value: Math.min(1, Math.max(-1, dotVector3(first, second))) }
}

/** 二面角的度数（由余弦换算）。 */
export function dihedralDegrees(cosine: number): number {
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
}

/**
 * **两个平面的锐角余弦**：`|n1·n2|`。
 *
 * 与二面角**不是**同一个量：这里是"两张平面"的锐角，题面若写"平面 α 与平面 β 的夹角"
 * 用它；写"二面角 A-l-B"用 `dihedralCosine`。
 */
export function planeAngleCosine(firstNormal: Vector3, secondNormal: Vector3): Measurement {
  if (!finitePoint(firstNormal) || !finitePoint(secondNormal)) return rejected("non-finite-value", "法向含非有限数值。")
  const first = lengthVector3(firstNormal)
  const second = lengthVector3(secondNormal)
  if (!(first > TOLERANCE) || !(second > TOLERANCE)) return rejected("degenerate-plane", "平面的法向为零向量。")
  return { status: "ok", value: Math.min(1, Math.abs(dotVector3(firstNormal, secondNormal)) / (first * second)) }
}
