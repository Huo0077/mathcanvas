import { describe, expect, it } from "vitest"

import { createEmptyDocument, validateDocument } from "./index"

/**
 * 交点的"解引用"：`solutionIndex` **不设上界**（采样曲线可以有任意多个解），
 * `hint` 是用户点选的那个解，用来在重算时按最近解匹配。
 * 旧类型写死 `0 | 1`，第三个及以后的解会被折叠到第 2 个上。
 */
describe("intersection solution references", () => {
  function documentWith(solutionIndex: unknown, hint?: unknown) {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "line-1", type: "line", a: { x: -10, y: 0 }, b: { x: 10, y: 0 } },
      { id: "function-1", type: "function", expression: "sin(x)", domain: [-10, 10], samples: 200 },
      { id: "curve-1", type: "curveIntersection", objectA: "line-1", objectB: "function-1", solutionIndex, hint, x: 0, y: 0 } as never
    ]
    return document
  }

  it("accepts an arbitrary non-negative index and a finite hint", () => {
    expect(validateDocument(documentWith(4, { x: Math.PI, y: 0 }))).toEqual({ valid: true })
    // 没有这两个字段的旧文档同样合法。
    expect(validateDocument(documentWith(undefined)).valid).toBe(true)
  })

  it("rejects a negative, fractional or non-finite index, and a bad hint", () => {
    expect(validateDocument(documentWith(-1)).valid).toBe(false)
    expect(validateDocument(documentWith(1.5)).valid).toBe(false)
    expect(validateDocument(documentWith(Number.POSITIVE_INFINITY)).valid).toBe(false)
    expect(validateDocument(documentWith(0, { x: Number.NaN, y: 0 })).valid).toBe(false)
  })
})
