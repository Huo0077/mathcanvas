import { describe, expect, it } from "vitest"

import type { AnnotationSpec, PrimitiveSpec } from "@draw/dsl"

import { resolveAnnotationPoint } from "./annotations"

describe("annotation anchors", () => {
  it("resolves conic focus anchors", () => {
    const primitives: PrimitiveSpec[] = [{ id: "ellipse-1", type: "ellipse", center: { x: 1, y: 2 }, radiusX: 5, radiusY: 3 }]
    const annotation: AnnotationSpec = { id: "annotation-1", text: "F₁", anchor: { kind: "primitive", primitiveId: "ellipse-1", feature: "focus" } }

    expect(resolveAnnotationPoint(annotation, primitives)).toEqual({ x: 5, y: 2 })
  })

  it("resolves the selected point in an intersection set", () => {
    const primitives: PrimitiveSpec[] = [{ id: "intersection-set-1", type: "intersectionSet", objectA: "line-1", objectB: "line-2", points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], selectedIndex: 1 }]
    const annotation: AnnotationSpec = { id: "annotation-1", text: "P₂", anchor: { kind: "primitive", primitiveId: "intersection-set-1", feature: "intersection", index: 0 } }

    expect(resolveAnnotationPoint(annotation, primitives)).toEqual({ x: 1, y: 2 })
  })

  it("keeps legacy target annotations attached", () => {
    const primitives: PrimitiveSpec[] = [{ id: "point-1", type: "point", x: 2, y: -1 }]
    const annotation: AnnotationSpec = { id: "annotation-1", text: "A", target: "point-1" }

    expect(resolveAnnotationPoint(annotation, primitives)).toEqual({ x: 2, y: -1 })
  })
})
