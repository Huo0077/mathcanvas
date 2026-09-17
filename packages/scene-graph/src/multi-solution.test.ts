import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { applyOperation, recomputeDerivedObjects } from "./index"

/**
 * 一条直线与 sin(x) 有 7 个交点：交点是**每个解一个独立实体**，
 * 而不是"只存下标且下标被夹在 0|1"。
 */
function intersectionDocument(solutionIndex: number | undefined, hint?: { x: number; y: number }) {
  const document = createEmptyDocument("conics")
  document.primitives = [
    { id: "line-1", type: "line", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } },
    { id: "function-1", type: "function", expression: "sin(x)", domain: [-10, 10], samples: 400 },
    { id: "curve-1", type: "curveIntersection", objectA: "line-1", objectB: "function-1", solutionIndex, hint, x: 0, y: 0 }
  ]
  return recomputeDerivedObjects(document)
}

const pointOf = (document: ReturnType<typeof intersectionDocument>) => document.primitives.find((primitive) => primitive.id === "curve-1") as { x: number; y: number; hint?: { x: number; y: number } }

describe("multi-solution intersections", () => {
  it("keeps every solution addressable instead of folding them onto 0|1", () => {
    // 5 个不同的下标给出 5 个不同的解（旧实现会把 >=2 的都夹到 1）。
    const xs = [0, 1, 2, 3, 4].map((index) => pointOf(intersectionDocument(index)).x)
    expect(new Set(xs.map((x) => x.toFixed(3))).size).toBe(5)
    // 且这些解都落在直线 y = 0 上、都是 sin 的零点。
    for (const x of xs) expect(Math.abs(Math.sin(x))).toBeLessThan(0.05)
  })

  it("follows the solution the user clicked when the shape changes", () => {
    // hint 指向最右边那个解（2π）。按要求：重算取**离 hint 最近的解**，而不是按下标取第 0 个。
    const hinted = intersectionDocument(0, { x: 2 * Math.PI, y: 0 })
    expect(pointOf(hinted).x).toBeCloseTo(2 * Math.PI, 2)
    // 选中的解会写回 hint，下一次重算继续跟着它。
    expect(pointOf(hinted).hint?.x).toBeCloseTo(2 * Math.PI, 2)

    // 把直线抬高 0.1：解整体平移，点必须留在"同一个"解附近（≈2π+0.1），而不是跳到别的零点。
    const moved = applyOperation(hinted, { op: "updatePrimitive", id: "line-1", patch: { a: { x: -10, y: 0.1 }, b: { x: 10, y: 0.1 } } })
    const followed = pointOf(moved.document)
    expect(followed.x).toBeGreaterThan(2 * Math.PI - 0.5)
    expect(followed.x).toBeLessThan(2 * Math.PI + 0.5)
    expect(followed.y).toBeCloseTo(0.1, 2)
  })

  it("falls back to the index when there is no hint, and hides the point when a solution disappears", () => {
    const byIndex = intersectionDocument(2)
    expect(pointOf(byIndex).hint?.x).toBeCloseTo(pointOf(byIndex).x, 9)

    // 把直线移到 sin 的值域之外：没有解了，交点不可见而不是伪造坐标。
    const empty = applyOperation(byIndex, { op: "updatePrimitive", id: "line-1", patch: { a: { x: -10, y: 5 }, b: { x: 10, y: 5 } } })
    expect(empty.document.primitives.find((primitive) => primitive.id === "curve-1")).toMatchObject({ visible: false })
  })
})
