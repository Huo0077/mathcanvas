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
