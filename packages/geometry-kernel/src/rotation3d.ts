/**
 * 绕**世界轴**的旋转（立体几何的"拖着转"与属性栏角度都走这里）。
 *
 * 用户口径："我希望能给立体图形增加旋转功能，就像我想要一个横着的圆柱，可以在图中拖着圆柱旋转，
 * 也可以在右侧属性栏设置为 90 度。"
 *
 * 三个约定必须与**已经画出来的几何**一致，否则"读数说转了 90°、画面上却没转"：
 * - 欧拉角次序 **X → Y → Z**（先绕 X、再绕 Y、最后绕 Z，都绕物体自身中心），与
 *   `solid-builders.ts` 的 `rotateAboutPivot` 逐行同源；
 * - 世界 Z 轴朝上、右手系；
 * - 矩阵行主序 3×3，`eulerRotationMatrix3(e)` 给出的就是 `R = Rz(e.z)·Ry(e.y)·Rx(e.x)`。
 *
 * `quadrics.ts`（A1/A2 的解析层）与 `scene-graph` 都直接用这里的矩阵，不再各写一份——两份实现漂移
 * 过一次（"校验说行、应用说不行"），这种坑不要再踩。
 */
import type { Vector3 } from "@draw/dsl"

/** 世界轴名（与属性栏「朝向」那三个字段同名，避免两套叫法）。 */
export type WorldAxis3 = "x" | "y" | "z"

/**
 * **从目标距离反求折角**（Task 12，2026-10-12）的结果。
 *
 * 四档是**刻意分开**的（计划原文："把找不到根与不能证明无解分开"）：
 * - `solved`：求到了，且在允许区间内；
 * - `outside-range`：方程**有**根，但都不在允许区间（例如只有 θ=0 才对）——
 *   与"无解"是两件事，用户该看到的是"把折叠起来才行"；
 * - `unreachable`：**证明无解** —— 目标距离落在可达区间之外，并把区间**报出来**；
 * - `degenerate`：待折点就在折痕上（转多少度它都不动），没有"角"可言。
 */
export type FoldAngleOutcome =
  | { status: "solved"; degrees: number[] }
  | { status: "outside-range"; degrees: number[] }
  | { status: "unreachable"; minimum: number; maximum: number }
  | { status: "degenerate"; detail: string }

/**
 * **折角解析求解**：绕一条**任意**折痕转一个点，问"转多少度才能让 `|P(θ)Q| = d`"。
 *
 * ## 为什么是解析的
 *
 * 计划原文："对**固定点到旋转后点的距离**优先利用 `rotateAboutAxis` 所确定的三角关系解析枚举候选角"。
 * 设折痕过 `pivot`、方向 `a`（单位化），待折点 `moving`、目标点 `target`：
 *
 * ```text
 * v = moving − pivot,  v∥ = (v·a)a,  v⊥ = v − v∥,  r = |v⊥|
 * P(θ) = pivot + v∥ + cosθ·v⊥ + sinθ·(a × v⊥)
 * |P(θ) − target|² = K + A·cosθ + B·sinθ
 *   K = |w|² + r²,  w = (pivot − target) + v∥,  A = 2(w·v⊥),  B = 2(w·(a × v⊥))
 * ```
 *
 * 于是 `A·cosθ + B·sinθ = d² − K` 就是 `R·cos(θ − φ) = d² − K`（`R = √(A²+B²)`、`φ = atan2(B, A)`），
 * **闭式**给出至多两支角 —— 不需要区间搜索，也就不会把"没搜到"说成"无解"。
 *
 * **`a` 不必是单位向量**（求解器自己归一化）；`a` 取反得到的是同一个图形（旋转角取反）。
 * 折痕退化（`r = 0`，待折点就在折痕上）单独报 `degenerate`，**不许**给出一个假角。
 */
export function foldAnglesForTargetDistance(
  moving: Vector3,
  pivot: Vector3,
  axis: Vector3,
  target: Vector3,
  distance: number,
  range: { minimumDegrees: number; maximumDegrees: number } = { minimumDegrees: 0, maximumDegrees: 180 }
): FoldAngleOutcome {
  const axisLength = Math.hypot(axis.x, axis.y, axis.z)
  if (!(axisLength > 0)) return { status: "degenerate", detail: "折痕方向是零向量：没有折痕可言。" }
  const a = { x: axis.x / axisLength, y: axis.y / axisLength, z: axis.z / axisLength }
  const v = { x: moving.x - pivot.x, y: moving.y - pivot.y, z: moving.z - pivot.z }
  const along = v.x * a.x + v.y * a.y + v.z * a.z
  const parallel = { x: a.x * along, y: a.y * along, z: a.z * along }
  const perpendicular = { x: v.x - parallel.x, y: v.y - parallel.y, z: v.z - parallel.z }
  const radiusSquared = perpendicular.x * perpendicular.x + perpendicular.y * perpendicular.y + perpendicular.z * perpendicular.z
  if (!(radiusSquared > 1e-18)) return { status: "degenerate", detail: "待折点就在折痕上：绕折痕怎么转它都不动。" }

  const w = { x: pivot.x - target.x + parallel.x, y: pivot.y - target.y + parallel.y, z: pivot.z - target.z + parallel.z }
  const wSquared = w.x * w.x + w.y * w.y + w.z * w.z
  const cross = { x: a.y * perpendicular.z - a.z * perpendicular.y, y: a.z * perpendicular.x - a.x * perpendicular.z, z: a.x * perpendicular.y - a.y * perpendicular.x }
  const constant = wSquared + radiusSquared
  const first = 2 * (w.x * perpendicular.x + w.y * perpendicular.y + w.z * perpendicular.z)
  const second = 2 * (w.x * cross.x + w.y * cross.y + w.z * cross.z)
  const amplitude = Math.hypot(first, second)
  const targetSquared = distance * distance
  const scale = Math.max(1, constant, targetSquared)
  const slack = Math.abs(targetSquared - constant)

  /**
   * `R = 0`（目标点到折痕轴的距离恰好等于 `r`）时 `|P(θ)Q|` **与 θ 无关** ——
   * 要么这个距离恒等于目标值（任何角都可以，交给调用方的区间），要么永远够不到。
   */
  if (amplitude <= 1e-12 * scale) {
    if (slack <= 1e-9 * scale) {
      return { status: "solved", degrees: [range.maximumDegrees] }
    }
    const reachable = Math.sqrt(Math.max(0, constant))
    return { status: "unreachable", minimum: reachable, maximum: reachable }
  }

  if (slack > amplitude * (1 + 1e-12)) {
    return { status: "unreachable", minimum: Math.sqrt(Math.max(0, constant - amplitude)), maximum: Math.sqrt(constant + amplitude) }
  }

  const phi = Math.atan2(second, first)
  const alpha = Math.acos(Math.min(1, Math.max(-1, (targetSquared - constant) / amplitude)))
  const candidates: number[] = []
  for (const theta of [phi + alpha, phi - alpha]) {
    // 归一到 `[0, 360)`，再按允许区间过滤（区间是**度**，与题面同一套单位）。
    let degrees = ((theta * 180) / Math.PI) % 360
    if (degrees < 0) degrees += 360
    if (degrees <= range.minimumDegrees + 1e-9 || degrees > range.maximumDegrees + 1e-9) continue
    if (candidates.some((existing) => Math.abs(existing - degrees) <= 1e-7)) continue
    candidates.push(degrees)
  }
  candidates.sort((left, right) => left - right)
  if (candidates.length === 0) {
    // 有根、但都不在允许区间 —— 与"无解"分开报。
    const all: number[] = []
    for (const theta of [phi + alpha, phi - alpha]) {
      let degrees = ((theta * 180) / Math.PI) % 360
      if (degrees < 0) degrees += 360
      if (!all.some((existing) => Math.abs(existing - degrees) <= 1e-7)) all.push(degrees)
    }
    all.sort((left, right) => left - right)
    return { status: "outside-range", degrees: all }
  }
  return { status: "solved", degrees: candidates }
}

/**
 * 欧拉角（X → Y → Z，绕原点）→ 行主序 3×3 旋转矩阵。
 *
 * 与 `solid-builders.ts` 的 `rotateAboutPivot` 逐行同源：先用 `Rx` 把点转一次，再用 `Ry`、最后 `Rz`。
 */
export function eulerRotationMatrix3(rotation: Vector3): number[] {
  const [cx, sx] = [Math.cos(rotation.x), Math.sin(rotation.x)]
  const [cy, sy] = [Math.cos(rotation.y), Math.sin(rotation.y)]
  const [cz, sz] = [Math.cos(rotation.z), Math.sin(rotation.z)]
  return [
    cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz,
    cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz,
    -sy, sx * cy, cx * cy
  ]
}

/** 单个世界轴的旋转矩阵（行主序 3×3）。 */
export function axisRotationMatrix3(axis: WorldAxis3, radians: number): number[] {
  const [c, s] = [Math.cos(radians), Math.sin(radians)]
  if (axis === "x") return [1, 0, 0, 0, c, -s, 0, s, c]
  if (axis === "y") return [c, 0, s, 0, 1, 0, -s, 0, c]
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}

/** 行主序 3×3 × 列向量。 */
export function applyRotationMatrix3(matrix: number[], vector: Vector3): Vector3 {
  return {
    x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
    y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
    z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z
  }
}

/** 两个行主序 3×3 相乘（`first · second`，即"先做 second、后做 first"）。 */
export function multiplyRotationMatrix3(first: number[], second: number[]): number[] {
  const result = new Array<number>(9).fill(0)
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      let sum = 0
      for (let index = 0; index < 3; index += 1) sum += first[row * 3 + index] * second[index * 3 + column]
      result[row * 3 + column] = sum
    }
  }
  return result
}

/** 绕世界轴把**向量**转过 `radians`（右手法则）。 */
export function rotateVectorAboutAxis3(vector: Vector3, axis: WorldAxis3, radians: number): Vector3 {
  return applyRotationMatrix3(axisRotationMatrix3(axis, radians), vector)
}

/** 绕**过 `pivot` 的世界轴**把点转过 `radians`：枢轴本身不动。 */
export function rotatePointAboutAxis3(point: Vector3, pivot: Vector3, axis: WorldAxis3, radians: number): Vector3 {
  const offset = { x: point.x - pivot.x, y: point.y - pivot.y, z: point.z - pivot.z }
  const turned = rotateVectorAboutAxis3(offset, axis, radians)
  return { x: pivot.x + turned.x, y: pivot.y + turned.y, z: pivot.z + turned.z }
}

/**
 * 行主序 3×3 → 欧拉角（X → Y → Z），是 `eulerRotationMatrix3` 的逆。
 *
 * 从矩阵元素直接读：`m[6] = −sin y`，所以 `y = asin(−m[6])`；`|cos y|` 足够大时
 * `x = atan2(m[7], m[8])`、`z = atan2(m[3], m[0])`。
 *
 * **万向锁**（`y = ±90°`，此时 `x` 与 `z` 只以 `x ∓ z` 的组合出现、单独解不出来）：如实取 `z = 0`
 * 这一支，并把 `x` 解成那个组合值——旋转本身仍然分毫不差，只是表示不唯一（spec §3.2 写着）。
 * 输入不是旋转矩阵（含非有限值）时返回零角，不返回 `NaN`。
 */
export function eulerFromRotationMatrix3(matrix: number[]): Vector3 {
  if (matrix.length !== 9 || matrix.some((value) => !Number.isFinite(value))) return { x: 0, y: 0, z: 0 }
  const sy = Math.min(1, Math.max(-1, -matrix[6]))
  const y = Math.asin(sy)
  const cy = Math.cos(y)
  if (Math.abs(cy) < 1e-12) {
    // 万向锁：x ∓ z 只有组合值有意义。sin y = +1 时 m[1] = sin(x−z)、m[2] = cos(x−z)；
    // sin y = −1 时 m[1] = −sin(x+z)、m[2] = −cos(x+z)。取 z = 0。
    const x = sy > 0 ? Math.atan2(matrix[1], matrix[2]) : Math.atan2(-matrix[1], -matrix[2])
    return { x, y, z: 0 }
  }
  return { x: Math.atan2(matrix[7], matrix[8]), y, z: Math.atan2(matrix[3], matrix[0]) }
}

/**
 * 在已有朝向 `euler` 上**再绕世界轴转** `radians`，返回新的欧拉角。
 *
 * 组合顺序：`R_new = R_axis(θ) · R_euler`——即"先按原朝向摆好，再绕世界轴转"（这正是拖旋转环的语义：
 * 环画在世界轴上）。`z` 轴恰好是欧拉链的最外层，所以绕 Z 转就是 `z += θ`（精确）；
 * 绕 X / Y 一般会同时改动多个字段，这是 Euler 表示的固有性质，不是实现偷懒。
 */
export function composeEuler3(euler: Vector3, axis: WorldAxis3, radians: number): Vector3 {
  const composed = multiplyRotationMatrix3(axisRotationMatrix3(axis, radians), eulerRotationMatrix3(euler))
  return eulerFromRotationMatrix3(composed)
}
