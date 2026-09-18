import { describe, expect, it } from "vitest"

import { createEmptyDocument, validateDocument, type GeometryDocument } from "./index"
import { SAMPLED_PRIMITIVE_TYPES, isSampledPrimitiveType } from "./sampledTypes"

/** `validateDocument` 是判别联合：`valid: true` 时没有 `errors` 字段。 */
function errorsOf(document: GeometryDocument): string[] {
  const result = validateDocument(document)
  return result.valid ? [] : result.errors
}

describe("sampled primitive types", () => {
  it("covers every curve-like type, including the derived ones", () => {
    for (const type of ["line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function", "tangent", "normal", "secant", "derivative", "integral"]) {
      expect(SAMPLED_PRIMITIVE_TYPES).toContain(type)
      expect(isSampledPrimitiveType(type)).toBe(true)
    }
    /**
     * 静态标记不是曲线：它只有离散的零点/极值/拐点，没有几何可采样。
     * 点也不是曲线 —— 点与曲线的"相交"是另一种语义（点在线上），不在求交里。
     */
    expect(isSampledPrimitiveType("analysisSet")).toBe(false)
    expect(isSampledPrimitiveType("point")).toBe(false)
  })

  it("accepts a tangent as an intersection source", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-src", type: "circle", center: { x: 0, y: 6 }, radius: 2 },
      { id: "line-1", type: "line", a: { x: -6, y: 3 }, b: { x: 10, y: 3 } },
      { id: "tangent-1", type: "tangent", sourceId: "circle-src", x: 2, point: { x: 2, y: 6 }, slope: 0, a: { x: -1, y: 6 }, b: { x: 5, y: 6 }, status: "approximate", anchor: { kind: "parameter", parameter: 0 } },
      { id: "set-1", type: "intersectionSet", objectA: "tangent-1", objectB: "line-1", points: [{ x: 2, y: 3 }] }
    ]
    expect(errorsOf(document).filter((error) => error.includes("intersection"))).toEqual([])
  })

  it("still refuses an object that is not a curve at all", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-src", type: "circle", center: { x: 0, y: 6 }, radius: 2 },
      { id: "line-1", type: "line", a: { x: -6, y: 3 }, b: { x: 10, y: 3 } },
      { id: "set-1", type: "intersectionSet", objectA: "circle-src", objectB: "line-1", points: [{ x: 2, y: 3 }] },
      { id: "set-2", type: "intersectionSet", objectA: "nope", objectB: "line-1", points: [{ x: 2, y: 3 }] }
    ]
    const errors = errorsOf(document)
    // 圆的来源合法（set-1 不该报错）；不存在的 id 仍要报错（set-2）。
    expect(errors.filter((error) => error.includes("intersection"))).toHaveLength(1)
  })
})
