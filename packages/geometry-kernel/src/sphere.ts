import type { CurvePiece3 } from "@draw/dsl"

import { dotVector3, lengthVector3, scaleVector3, subtractVector3, type Plane3, type Vector3 } from "./geometry3d"
import { circleConic3, type Conic3 } from "./quadrics"

/**
 * 球 ∩ 平面（实施计划 Task 2）：**解析**判定，不是把球切成多面体再求交。
 *
 * 设 `n̂ = n/|n|`、有符号距离 `d = (n·C + constant)/|n|`，则交圆圆心 `C − d·n̂`、半径 `√(r² − d²)`。
 * 三种结局：`|d| > r` 空集、`|d| ≈ r` 单点切触、`|d| < r` 圆。
 *
 * ## 两条写在这里的纪律
 *
 * 1. **容差与模型尺度同源**（相对容差，见 `RELATIVE_TOLERANCE`）。绝对阈值两头都错：小模型上把真实的
 *    间隙读成"相切"，大模型上把数值噪声读成"不相交"。两个方向在 `sphere.test.ts` 里各有一条用例。
 * 2. **不伪造型状**。法向为零 / 非有限、半径非正或非有限一律 `invalid`，不返回一个"看着像"的圆；
 *    退化到切点时也不返回一个"极扁的圆"（那时 `√(r²−d²)` 已经落进噪声）。
 *
 * 球是**无端面**的实体，所以交圆整条都在球面上：`loops` 就是一段完整参数域 `[0, 2π]` 的圆锥曲线，
 * 不需要圆柱 / 圆锥那套"端面弦"裁剪（见 `section-quadric.ts` 的对照）。
 */

/** 球的解析形状 —— 文档里存的就是这两个数（`SpherePrimitive.center` / `.radius`）。 */
export interface Sphere3Shape {
  center: Vector3
  radius: number
}

export type SpherePlaneSection3InvalidCode = "invalid_sphere" | "invalid_plane"

export type SpherePlaneSection3Result =
  | { kind: "circle"; center: Vector3; radius: number; distance: number; conic: Conic3; loops: CurvePiece3[][] }
  | { kind: "point"; point: Vector3 }
  | { kind: "empty"; distance: number }
  | { kind: "invalid"; code: SpherePlaneSection3InvalidCode; detail: string }

/**
 * 退化判别的**相对**容差：与半径同量纲，所以同一个数字在小球与大球上说同一件事。
 *
 * 取 `1e-9`（而不是 `CIRCLE_RELATIVE_TOLERANCE` 的 `1e-12`）：这里判的是**距离**，而距离是由
 * `n·C + constant` 再除以 `|n|` 算出来的，比"两个半轴之差"少一层相消，所以能用稍宽的相对带。
 * 判别力仍有 1e-9 个相对单位 —— 远小于任何"用户真的想表达"的间隙。
 */
const RELATIVE_TOLERANCE = 1e-9

const TAU = Math.PI * 2

function isFiniteVector(vector: Vector3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z)
}

/**
 * 球 ∩ 平面。
 *
 * 非单位法向的常数**按同一个 `|n|` 缩放**（先做除法再比较）：只把法向归一化而不同步缩放常数，
 * 会把平面整体挪走 —— 在球上正好表现为"切歪"，而且歪得看不出来。
 */
export function spherePlaneSection3(sphere: Sphere3Shape, plane: Plane3): SpherePlaneSection3Result {
  const { center, radius } = sphere
  if (!isFiniteVector(center) || !Number.isFinite(radius) || radius <= 0) {
    return { kind: "invalid", code: "invalid_sphere", detail: "球的中心与半径必须是有限数，且半径严格大于 0" }
  }
  if (!isFiniteVector(plane.normal) || !Number.isFinite(plane.constant)) {
    return { kind: "invalid", code: "invalid_plane", detail: "平面法向与常数必须是有限数" }
  }
  const normalLength = lengthVector3(plane.normal)
  if (normalLength <= 0) {
    return { kind: "invalid", code: "invalid_plane", detail: "平面法向必须是非零向量" }
  }

  const unitNormal = scaleVector3(plane.normal, 1 / normalLength)
  const signedDistance = (dotVector3(plane.normal, center) + plane.constant) / normalLength
  const distance = Math.abs(signedDistance)
  const tolerance = radius * RELATIVE_TOLERANCE

  if (distance > radius + tolerance) return { kind: "empty", distance }

  /** 球心沿法向投影到平面上 —— 交圆圆心（切触时就是切点）。 */
  const foot = subtractVector3(center, scaleVector3(unitNormal, signedDistance))

  if (distance >= radius - tolerance) {
    /**
     * `|d| ≈ r`：相切。这里刻意**不**返回 `√(r²−d²)` 算出来的那个极扁的圆 ——
     * 那个数在这个区间里完全是噪声，报出去等于让一个"看着像圆的圆"冒充精确几何。
     */
    return { kind: "point", point: foot }
  }

  const sectionRadius = Math.sqrt(Math.max(0, radius * radius - distance * distance))
  const conic = circleConic3(foot, unitNormal, sectionRadius)
  if (!conic) {
    // `circleConic3` 只在半径非正 / 非有限时返回 null，而上面已经排除了这些情况。
    return { kind: "invalid", code: "invalid_sphere", detail: "交圆半径算不出来" }
  }
  return {
    kind: "circle",
    center: foot,
    radius: sectionRadius,
    distance,
    conic,
    loops: [[{ kind: "conic", conic, parameterRange: [0, TAU] }]]
  }
}
