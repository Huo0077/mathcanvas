/**
 * **底面多边形的解析计算**（T3，2026-11-05 四题修复）。
 *
 * 见 [修复设计](../../../../docs/superpowers/specs/2026-11-05-solid-geometry-four-cases-design.md) §4.3。
 *
 * ## 这一层只做"算坐标"，不做"读关系"
 *
 * 关系 → 哪个点是 `A`、哪条边与哪条边平行/垂直，是 `constructors.ts` 既有判据的活
 * （`baseEdgePerpendicular` / `baseEdgeParallel` / `statedLength`）。这一层只接**已经解出来的数值**，
 * 返回一组 `z = 0` 上的坐标或一个**结构化拒绝** —— 于是同一组公式能被棱锥、棱柱、翻折共用，
 * 而不必每个族各写一遍三角。
 *
 * ## 两条本仓的既有口径
 *
 * - **拒绝是值不是异常**：退化输入（零/负/非有限边长、0° 或 180° 的角）返回
 *   `{ status: "rejected", code }`，**不返回 NaN**（NaN 会一路流到核验器，最后变成一句看不懂的失败）。
 * - **浮点噪声按回 0**：`cos(π/3)` / `sin(π)` 在双精度下会留下 1e-17 量级的东西；
 *   内核的"坐标量级跨度"守卫是对的，所以修在**构造侧**，不放宽守卫。
 */

import type { Vector3 } from "../geometry3d"

/** 退化 / 非法输入的结构化拒绝（与 `constructors.ts` 的 `WitnessConstructRejection` 同码表）。 */
export interface BasePolygonMathRejection {
  status: "rejected"
  code: "degenerate-base" | "non-finite-value"
  message: string
}

export type BasePolygonMathResult = { status: "ok"; polygon: Vector3[] } | BasePolygonMathRejection

/**
 * 把浮点噪声按回 0。
 *
 * `cos(π/2)` / `sin(π)` 算出来是 6.1e-17 / 1.2e-16 这种量级。正六边形若留着它，内核的
 * "候选坐标量级跨度过大"守卫会**如实拒绝**这张图 —— 那条守卫是对的（双精度下拿 1e-16 与 1
 * 去比距离和角度不可靠），所以修在**构造侧**：把噪声按回 0，而不是去放宽守卫。
 */
export function snapToZero(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value
}

function notFinite(label: string, value: number): BasePolygonMathRejection {
  return { status: "rejected", code: "non-finite-value", message: `${label} 必须是有限数值（收到 ${String(value)}）。` }
}

function notPositive(label: string, value: number): BasePolygonMathRejection {
  return { status: "rejected", code: "degenerate-base", message: `${label} 必须是有限正数（收到 ${String(value)}）：围不出面积。` }
}

/**
 * **直角梯形**：`A=(0,0)`、`B=(w,0)`、`C=(top,h)`、`D=(0,h)`。
 *
 * 题面那一组关系是"直角在 `A` 处"（`AD ⊥ AB`）与"`AB ∥ CD`"——
 * `AB` 被钉成 `AD` 与 `DC` 的公垂线，于是三个长度各自独立：`AB = w`、`AD = h`、`CD = top`。
 * **没有联立**：这是闭式构造，不是求解。
 *
 * `top === w` 时它恰好是矩形 —— 那由调用方决定要不要按矩形文案，本层不判（同一个公式）。
 */
export function rightTrapezoidPolygon(input: { width: number; height: number; top: number }): BasePolygonMathResult {
  const { width, height, top } = input
  for (const [label, value] of [["AB 的长度", width], ["AD 的高度", height], ["CD 的长度", top]] as const) {
    if (!Number.isFinite(value)) return notFinite(label, value)
    if (!(value > 0)) return notPositive(label, value)
  }
  return {
    status: "ok",
    polygon: [
      { x: 0, y: 0, z: 0 },
      { x: width, y: 0, z: 0 },
      { x: snapToZero(top), y: height, z: 0 },
      { x: 0, y: height, z: 0 }
    ]
  }
}

/**
 * **菱形**：`A=(0,0)`、`B=(s,0)`、`D=(s·cosθ, s·sinθ)`、`C = B + D`。
 *
 * `θ` 是 `∠BAD`（`A` 处的内角）。设计 §4.3：`s > 0`、`0 < θ < π`；两端点都是退化。
 * **显式角必须原样使用** —— "菱形只说四边相等、没说角"那一套代表值只属于"题面没给角"的情形。
 */
export function rhombusPolygon(input: { side: number; angleDegrees: number }): BasePolygonMathResult {
  const { side, angleDegrees } = input
  if (!Number.isFinite(side)) return notFinite("菱形的边长", side)
  if (!(side > 0)) return notPositive("菱形的边长", side)
  if (!Number.isFinite(angleDegrees)) return notFinite("菱形的角", angleDegrees)
  if (!(angleDegrees > 0) || !(angleDegrees < 180)) {
    return {
      status: "rejected",
      code: "degenerate-base",
      message: `菱形的角是 ${String(angleDegrees)}°：内角必须严格落在 0° 与 180° 之间（0 与 180 都是退化）。`
    }
  }
  const radians = (angleDegrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const b: Vector3 = { x: side, y: 0, z: 0 }
  const d: Vector3 = { x: snapToZero(side * cos), y: snapToZero(side * sin), z: 0 }
  return {
    status: "ok",
    polygon: [
      { x: 0, y: 0, z: 0 },
      b,
      { x: snapToZero(b.x + d.x), y: snapToZero(b.y + d.y), z: 0 },
      d
    ]
  }
}
