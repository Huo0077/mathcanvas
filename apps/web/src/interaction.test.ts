import { describe, expect, it } from "vitest"

import type { PrimitiveSpec } from "@draw/dsl"

import { createDragAction, getDragHandle, primitiveHandlePoints } from "./interaction"

describe("direct manipulation", () => {
  it("translates a line body by the pointer delta", () => {
    const line: PrimitiveSpec = { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 1 } }

    expect(createDragAction(line, "body", { x: 1, y: 0.5 }, { x: 3, y: 2 })).toEqual({
      kind: "translate",
      delta: { x: 2, y: 1.5 }
    })
  })

  it("updates a line endpoint when its handle is dragged", () => {
    const line: PrimitiveSpec = { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 1 } }

    expect(getDragHandle(line, { x: 0.05, y: 0.04 })).toBe("a")
    expect(createDragAction(line, "a", { x: 0, y: 0 }, { x: -1, y: 2 })).toEqual({
      kind: "update",
      patch: { a: { x: -1, y: 2 } }
    })
  })

  it("updates a circle radius from its radius handle", () => {
    const circle: PrimitiveSpec = { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 }

    expect(getDragHandle(circle, { x: 2.05, y: 0 })).toBe("radius")
    expect(createDragAction(circle, "radius", { x: 2, y: 0 }, { x: 3, y: 0 })).toEqual({
      kind: "update",
      patch: { radius: 3 }
    })
  })

  it("keeps derived intersections non-draggable", () => {
    const intersection: PrimitiveSpec = { id: "intersection-1", type: "intersection", lineA: "a", lineB: "b", x: 0, y: 0 }

    expect(getDragHandle(intersection, { x: 0, y: 0 })).toBeNull()
  })

  it("rotates a selected ellipse from its rotation handle", () => {
    const ellipse: PrimitiveSpec = { id: "ellipse-1", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, rotation: 0 }

    expect(getDragHandle(ellipse, { x: 4, y: 0 })).toBe("rotation")
    expect(createDragAction(ellipse, "rotation", { x: 4, y: 0 }, { x: 0, y: 4 })).toEqual({
      kind: "update",
      patch: { rotation: Math.PI / 2 }
    })
  })

  it("translates function graphs with their domain", () => {
    const functionPrimitive: PrimitiveSpec = { id: "function-1", type: "function", expression: "x*x", domain: [-2, 2] }

    expect(createDragAction(functionPrimitive, "body", { x: 0, y: 0 }, { x: 2, y: 1 })).toEqual({
      kind: "translate",
      delta: { x: 2, y: 1 }
    })
  })
})

describe("grip handle points", () => {
  it("puts a handle on both endpoints of a segment", () => {
    expect(primitiveHandlePoints({ id: "s", type: "segment", a: { x: 0, y: 0 }, b: { x: 5, y: 2 } })).toEqual([
      { handle: "a", point: { x: 0, y: 0 } },
      { handle: "b", point: { x: 5, y: 2 } }
    ])
  })

  it("puts one handle per polyline vertex, a radius handle on a circle, and three on an arc", () => {
    expect(primitiveHandlePoints({ id: "p", type: "polyline", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }] }).map((entry) => entry.handle)).toEqual(["vertex-0", "vertex-1", "vertex-2"])
    expect(primitiveHandlePoints({ id: "c", type: "circle", center: { x: 1, y: 1 }, radius: 2 })).toEqual([{ handle: "radius", point: { x: 3, y: 1 } }])
    expect(primitiveHandlePoints({ id: "a", type: "arc", center: { x: 0, y: 0 }, radius: 2, startAngle: 0, endAngle: Math.PI / 2 }).map((entry) => entry.handle)).toEqual(["startAngle", "endAngle", "radius"])
  })

  it("offers no handles for locked or derived objects", () => {
    expect(primitiveHandlePoints({ id: "s", type: "segment", a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, locked: true })).toEqual([])
    expect(primitiveHandlePoints({ id: "i", type: "intersection", lineA: "a", lineB: "b", x: 0, y: 0 })).toEqual([])
    expect(primitiveHandlePoints({ id: "pt", type: "point", x: 1, y: 1 })).toEqual([])
  })
})
