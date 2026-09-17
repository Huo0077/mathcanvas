import { describe, expect, it } from "vitest"

import { isUserVisiblePrimitive } from "./primitiveVisibility"

/**
 * "谁算用户对象"只有这一处定义：画布渲染循环与对象列表都读它。
 * 这里把三类判定钉死，避免以后有人只在其中一边加了条件。
 */
describe("primitive visibility", () => {
  it("hides tessellation vertices: they stay in the document but are not user objects", () => {
    expect(isUserVisiblePrimitive({ id: "p-tess", type: "point3", position: { x: 1, y: 1, z: 0 }, tessellation: true })).toBe(false)
    expect(isUserVisiblePrimitive({ id: "p-quad", type: "point3", position: { x: 2, y: 0, z: 0 }, label: "A" })).toBe(true)
  })

  it("hides generatrix edges of a round solid", () => {
    expect(isUserVisiblePrimitive({ id: "e-generatrix", type: "edge3", pointIds: ["bottom", "top"], tessellation: true })).toBe(false)
    expect(isUserVisiblePrimitive({ id: "e-ring", type: "edge3", pointIds: ["quad-a", "quad-b"], label: "棱 1" })).toBe(true)
  })

  it("still honours an explicit hidden flag", () => {
    expect(isUserVisiblePrimitive({ id: "p-off", type: "point3", position: { x: 0, y: 0, z: 0 }, visible: false })).toBe(false)
    expect(isUserVisiblePrimitive({ id: "e-off", type: "edge3", pointIds: ["a", "b"], visible: false })).toBe(false)
    // 面不参与这套收敛：圆柱 / 圆锥的表面仍然是用户对象。
    expect(isUserVisiblePrimitive({ id: "f-flat", type: "face3", pointIds: ["a", "b", "c"], label: "面 1" })).toBe(true)
  })
})
