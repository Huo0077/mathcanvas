import { describe, expect, it } from "vitest"

import type { Vector3 } from "@draw/dsl"

import { composeEuler3, eulerRotationMatrix3, rotatePointAboutAxis3, rotateVectorAboutAxis3 } from "./rotation3d"

/**
 * 绕**世界轴**旋转（立体几何用）。
 *
 * 用户口径："我希望能给立体图形增加旋转功能，就像我想要一个横着的圆柱，可以在图中拖着圆柱旋转，
 * 也可以在右侧属性栏设置为 90 度。"
 *
 * 这里必须和**已经画出来的几何**用同一套约定：参数化模板的顶点由 `solid-builders.ts` 的
 * `rotateAboutPivot` 生成（X→Y→Z、绕自身中心），二次曲面（A1/A2 的解析层）也按同一套矩阵做刚体共轭。
 * 所以本模块的 `eulerRotationMatrix3` 与那两处**逐行同源**，`composeEuler3` 才是"拖着转"能落到
 * 属性栏那三个角度字段上的依据。
 */
const close = (first: Vector3, second: Vector3) => {
  expect(first.x).toBeCloseTo(second.x, 9)
  expect(first.y).toBeCloseTo(second.y, 9)
  expect(first.z).toBeCloseTo(second.z, 9)
}

const applyMatrix = (matrix: number[], vector: Vector3): Vector3 => ({
  x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
  y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
  z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z
})

describe("world-axis rotation", () => {
  it("turns a vector by the right-hand rule about each world axis", () => {
    // Z 轴朝上、右手系：绕 +x 转 90° 把 +y 送到 +z，绕 +z 转 90° 把 +x 送到 +y。
    close(rotateVectorAboutAxis3({ x: 0, y: 1, z: 0 }, "x", Math.PI / 2), { x: 0, y: 0, z: 1 })
    close(rotateVectorAboutAxis3({ x: 1, y: 0, z: 0 }, "z", Math.PI / 2), { x: 0, y: 1, z: 0 })
    close(rotateVectorAboutAxis3({ x: 0, y: 0, z: 1 }, "y", Math.PI / 2), { x: 1, y: 0, z: 0 })
    // 整圈回到原处；零角度不动；绕某轴的旋转不改那个轴上的分量。
    close(rotateVectorAboutAxis3({ x: 1, y: 2, z: 3 }, "x", Math.PI * 2), { x: 1, y: 2, z: 3 })
    close(rotateVectorAboutAxis3({ x: 1, y: 2, z: 3 }, "y", 0), { x: 1, y: 2, z: 3 })
    expect(rotateVectorAboutAxis3({ x: 1, y: 2, z: 3 }, "z", 1.1).z).toBeCloseTo(3, 9)
  })

  it("keeps the pivot fixed and preserves distances", () => {
    const pivot = { x: 1, y: -2, z: 0.5 }
    close(rotatePointAboutAxis3(pivot, pivot, "z", 1.3), pivot)
    const before = { x: 3, y: 1, z: 2 }
    const after = rotatePointAboutAxis3(before, pivot, "y", 0.9)
    const distance = (first: Vector3, second: Vector3) => Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
    expect(distance(after, pivot)).toBeCloseTo(distance(before, pivot), 9)
  })

  it("builds the same rotation matrix the solids and quadrics already use", () => {
    /**
     * 与 `solid-builders.rotateAboutPivot` 的同源关系用**逐点**验证：取三个不共面的基向量，
     * 矩阵乘出来的结果必须与"先绕 X、再绕 Y、最后绕 Z"逐分量一致。
     */
    const euler = { x: 0.4, y: -0.7, z: 1.2 }
    const matrix = eulerRotationMatrix3(euler)
    for (const vector of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0.3, y: -1.4, z: 2.1 }]) {
      // 手动走一遍 X → Y → Z。
      const [cx, sx] = [Math.cos(euler.x), Math.sin(euler.x)]
      const [cy, sy] = [Math.cos(euler.y), Math.sin(euler.y)]
      const [cz, sz] = [Math.cos(euler.z), Math.sin(euler.z)]
      const afterX = { x: vector.x, y: vector.y * cx - vector.z * sx, z: vector.y * sx + vector.z * cx }
      const afterY = { x: afterX.x * cy + afterX.z * sy, y: afterX.y, z: -afterX.x * sy + afterX.z * cy }
      const afterZ = { x: afterY.x * cz - afterY.y * sz, y: afterY.x * sz + afterY.y * cz, z: afterY.z }
      close(applyMatrix(matrix, vector), afterZ)
    }
  })

  /**
   * 拖旋转环时角度要落回属性栏那三个字段。`R = Rz·Ry·Rx`（后转的在外面），所以：
   * 绕 **Z** 转就是 `z += θ`（精确）；从**未旋转**状态绕任一轴转也只改那一个字段。
   * 一般情形不保证"只改一个字段"——这是 Euler 表示的固有性质，spec §3.2 如实写着。
   */
  it("folds a world-axis rotation back into the XYZ angle fields", () => {
    close(composeEuler3({ x: 0.3, y: 0.4, z: 0.5 }, "z", 0.7), { x: 0.3, y: 0.4, z: 1.2 })
    close(composeEuler3({ x: 0, y: 0, z: 0 }, "x", Math.PI / 2), { x: Math.PI / 2, y: 0, z: 0 })
    close(composeEuler3({ x: 0, y: 0, z: 0 }, "y", Math.PI / 2), { x: 0, y: Math.PI / 2, z: 0 })
    close(composeEuler3({ x: 0, y: 0, z: 0 }, "z", Math.PI / 2), { x: 0, y: 0, z: Math.PI / 2 })
  })

  it("keeps the composed angle equivalent to rotating about the world axis (property)", () => {
    // 一般情形用**矩阵等价**断言（不锁死某一支分解）：新角度给出的旋转必须等于"先按旧角度转、再绕世界轴转"。
    const probe = { x: 1, y: 1, z: 1 }
    const cases: { euler: Vector3; axis: "x" | "y" | "z"; radians: number }[] = [
      { euler: { x: 0.3, y: 0.4, z: 0.5 }, axis: "x", radians: 0.7 },
      { euler: { x: -0.9, y: 0.2, z: 1.1 }, axis: "y", radians: -0.4 },
      { euler: { x: 2.1, y: -1.3, z: 0.6 }, axis: "z", radians: 2.2 },
      // 万向锁附近（y = ±90°）：分解要挑一支，但仍然必须给出同一个旋转。
      { euler: { x: Math.PI / 2, y: Math.PI / 2, z: 0 }, axis: "y", radians: Math.PI / 2 },
      { euler: { x: 0.2, y: Math.PI / 2, z: -0.3 }, axis: "x", radians: 0.8 }
    ]
    for (const testCase of cases) {
      const composed = composeEuler3(testCase.euler, testCase.axis, testCase.radians)
      const fromOld = applyMatrix(eulerRotationMatrix3(testCase.euler), probe)
      const expected = applyMatrix(axisMatrix(testCase.axis, testCase.radians), { x: fromOld.x, y: fromOld.y, z: fromOld.z })
      const actual = applyMatrix(eulerRotationMatrix3(composed), probe)
      expect(Number.isFinite(composed.x) && Number.isFinite(composed.y) && Number.isFinite(composed.z)).toBe(true)
      close({ x: actual.x, y: actual.y, z: actual.z }, { x: expected.x, y: expected.y, z: expected.z })
    }
  })
})

/** 单轴旋转矩阵（测试里自备一份，避免"用被测代码验证被测代码"）。 */
function axisMatrix(axis: "x" | "y" | "z", radians: number): number[] {
  const [c, s] = [Math.cos(radians), Math.sin(radians)]
  if (axis === "x") return [1, 0, 0, 0, c, -s, 0, s, c]
  if (axis === "y") return [c, 0, s, 0, 1, 0, -s, 0, c]
  return [c, -s, 0, s, c, 0, 0, 0, 1]
}
