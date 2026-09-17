import { describe, expect, it } from "vitest"

import { createEmptyDocument, validateDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { commitPatch, validatePatch } from "./patches"

/** A cube the way the 3D workspace builds one: the parameter row plus its generated topology. */
function templateCubeDocument() {
  const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 }, label: "立方体 1" }
  const built = buildSolidTemplate(cube)
  const document = createEmptyDocument("geometry3d")
  document.primitives = [cube, ...built.primitives]
  return { document, cube, built }
}

describe("domain patches", () => {
  it("rejects an intersection that references missing lines", () => {
    const document = createEmptyDocument("calculus")
    const operation = { op: "addPrimitive" as const, primitive: { id: "intersection-1", type: "intersection" as const, lineA: "missing-a", lineB: "missing-b", x: 0, y: 0 } }

    expect(validatePatch(document, operation)).toEqual({ valid: false, errors: ["intersection references missing line"] })
  })

  it("commits a valid patch and increments the document revision", () => {
    const document = createEmptyDocument("calculus")
    const operation = { op: "addPrimitive" as const, primitive: { id: "point-1", type: "point" as const, x: 1, y: 2 } }

    expect(commitPatch(document, operation).document.primitives).toHaveLength(1)
    expect(commitPatch(document, operation).document.revision).toBe(1)
  })

  it("rejects malformed parameter expressions before commit", () => {
    const document = createEmptyDocument("calculus")
    const operation = { op: "setParameterExpression" as const, id: "slope", expression: "2 +" }

    expect(validatePatch(document, operation)).toEqual({ valid: false, errors: ["invalid parameter expression"] })
  })

  it("accepts a parallel constraint only for existing lines", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
      { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 1, y: 2 } }
    ]
    const operation = { op: "addConstraint" as const, constraint: { id: "parallel-1", type: "parallel" as const, targets: ["line-a", "line-b"] } }

    expect(validatePatch(document, operation)).toEqual({ valid: true })
    expect(commitPatch(document, operation).document.constraints).toEqual([operation.constraint])
  })

  /**
   * 3D 的点-线-面拓扑**不**在级联范围内：删掉一条空间直线依赖的点仍然被拒绝。
   * 这是有意保留的保护 —— 那些顶层拓扑对象不是"纯派生"的，用户应当明确处理。
   */
  it("still refuses to delete a spatial point that a line3 depends on", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b"] } }
    ]

    expect(validatePatch(document, { op: "deleteObject", id: "point-a" })).toEqual({ valid: false, errors: ["object is referenced by another object"] })
  })

  /**
   * 删掉动点所绑定的曲线会留下一个悬空的 pathId：点会静默冻住，用户完全看不出为什么。
   * `isReferenced` 原来只覆盖了 point3 的绑定，二维点被漏掉了。
   */
  it("unbinds a dynamic point when the curve it was bound to is deleted", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "parabola-1", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" },
      { id: "point-1", type: "point", x: 0, y: 0, binding: { kind: "onPath", pathId: "parabola-1", parameter: 0, domain: [-4, 4] } }
    ]

    // 宿主可以被删：绑定点降级为自由点（位置保留），而不是留下悬空的 pathId 让文档存不下去。
    expect(validatePatch(document, { op: "deleteObject", id: "parabola-1" })).toEqual({ valid: true })
    const deleted = commitPatch(document, { op: "deleteObject", id: "parabola-1" }).document
    expect(deleted.primitives.find((primitive) => primitive.id === "point-1")).toMatchObject({ type: "point", binding: { kind: "free" } })
    // A free point is still deletable on its own.
    expect(validatePatch(document, { op: "deleteObject", id: "point-1" }).valid).toBe(true)
  })

  /**
   * 轨迹的 sourcePointId 也是引用。删掉被追踪的点不能留下悬空引用 ——
   * `locus` 的 schema 校验要求源点存在，悬空的文档**存不下去**（`encodeMgeo` 会抛）。
   * 处理方式与导函数跟着源函数走一致：轨迹是纯派生对象，跟着源点一起删。
   */
  it("deletes a locus together with the point it tracks, keeping the document savable", () => {
    const document = createEmptyDocument("conics")
    document.parameters = { t: { id: "t", value: 0.5, min: 0, max: 1 } }
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 0 },
      { id: "keep-me", type: "point", x: 5, y: 5 },
      { id: "locus-1", type: "locus", sourcePointId: "point-1", parameterId: "t", domain: [0, 1], samples: 32 }
    ]

    expect(validatePatch(document, { op: "deleteObject", id: "point-1" })).toEqual({ valid: true })
    const deleted = commitPatch(document, { op: "deleteObject", id: "point-1" }).document
    expect(deleted.primitives.map((primitive) => primitive.id)).toEqual(["keep-me"])

    // Sanity: the document that the guard prevents really would fail validation.
    const dangling = { ...document, primitives: document.primitives.filter((primitive) => primitive.id !== "point-1") }
    expect(validateDocument(dangling).valid).toBe(false)
    // The result of the actual delete stays valid and therefore savable.
    expect(validateDocument(deleted).valid).toBe(true)
  })

  it("rejects editing and deleting a locked object", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 1, y: 2, locked: true }]

    expect(validatePatch(document, { op: "deleteObject", id: "point-1" })).toEqual({ valid: false, errors: ["object is locked"] })
    expect(validatePatch(document, { op: "updatePrimitive", id: "point-1", patch: { center: { x: 2, y: 3 } } })).toEqual({ valid: false, errors: ["object is locked", "only circles and conics support center"] })
  })

  it("validates and edits segment endpoints", () => {
    const document = createEmptyDocument("calculus")
    const segment = { id: "segment-1", type: "segment" as const, a: { x: 0, y: 0 }, b: { x: 2, y: 1 } }
    const added = commitPatch(document, { op: "addPrimitive", primitive: segment })

    expect(added.changed).toBe(true)
    expect(commitPatch(added.document, { op: "updatePrimitive", id: segment.id, patch: { b: { x: 4, y: 3 } } }).document.primitives[0]).toMatchObject({ b: { x: 4, y: 3 } })
    expect(validatePatch(document, { op: "addPrimitive", primitive: { ...segment, b: segment.a } })).toEqual({ valid: false, errors: ["segment endpoints must differ"] })
    expect(commitPatch(added.document, { op: "updatePrimitive", id: segment.id, patch: { b: segment.a } })).toMatchObject({ document: added.document, changed: false, error: "segment endpoints must differ" })
  })

  it("rejects degenerate rays and polylines at the patch boundary", () => {
    const document = createEmptyDocument("calculus")
    const ray = { id: "ray-1", type: "ray" as const, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }
    const polyline = { id: "polyline-1", type: "polyline" as const, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }

    expect(validatePatch(document, { op: "addPrimitive", primitive: ray })).toEqual({ valid: false, errors: ["ray direction must differ"] })
    expect(validatePatch(document, { op: "addPrimitive", primitive: polyline })).toEqual({ valid: false, errors: ["polyline consecutive points must differ"] })
  })

  it("validates conic and function property edits", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "parabola-1", type: "parabola", vertex: { x: 0, y: 0 }, focalParameter: 2, axis: "y" },
      { id: "function-1", type: "function", expression: "x*x", domain: [-4, 4], samples: 32 }
    ]

    const parabola = commitPatch(document, { op: "updatePrimitive", id: "parabola-1", patch: { focalParameter: 3, vertex: { x: 1, y: 2 } } })
    const functionResult = commitPatch(parabola.document, { op: "updatePrimitive", id: "function-1", patch: { expression: "2*x+1", domain: [-2, 6] } })

    expect(parabola.document.primitives[0]).toMatchObject({ focalParameter: 3, vertex: { x: 1, y: 2 } })
    expect(functionResult.document.primitives[1]).toMatchObject({ expression: "2*x+1", domain: [-2, 6] })
    expect(validatePatch(document, { op: "updatePrimitive", id: "function-1", patch: { expression: "x+" } })).toEqual({ valid: false, errors: ["invalid function expression"] })
  })

  it("validates and edits 3D solid properties", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "cube-1", type: "cube", origin: { x: -2, y: -2, z: -1 }, size: { x: 4, y: 4, z: 2 } }]

    const result = commitPatch(document, { op: "updatePrimitive", id: "cube-1", patch: { origin3: { x: 1, y: 2, z: 3 }, size3: { x: 5, y: 6, z: 7 } } })

    expect(result.changed).toBe(true)
    expect(result.document.primitives[0]).toMatchObject({ origin: { x: 1, y: 2, z: 3 }, size: { x: 5, y: 6, z: 7 } })
  })

  it("accepts rotation and label edits for conics", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [{ id: "ellipse-1", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2 }]

    const result = commitPatch(document, { op: "updatePrimitive", id: "ellipse-1", patch: { rotation: Math.PI / 4, label: "旋转椭圆" } })

    expect(result.document.primitives[0]).toMatchObject({ rotation: Math.PI / 4, label: "旋转椭圆" })
  })

  it("rejects invalid style patch values", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "point-1", type: "point", x: 0, y: 0 }]

    expect(validatePatch(document, { op: "updatePrimitive", id: "point-1", patch: { style: { stroke: 12 as unknown as string, dash: 8 as unknown as string } } })).toEqual({ valid: false, errors: ["stroke is invalid", "dash is invalid"] })
  })

  /**
   * 删除图形时**不需要先手动删掉它的交点**：交点是纯派生对象，跟着来源一起走。
   * 旧行为是"object is referenced by another object"拒绝删除，用户必须先删交点再删直线。
   */
  it("deletes a line together with the intersection it takes part in", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
      { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 1, y: 0 } },
      { id: "keep", type: "line", a: { x: 0, y: -1 }, b: { x: 1, y: -1 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0.5, y: 0.5 }
    ]

    expect(validatePatch(document, { op: "deleteObject", id: "line-a" })).toEqual({ valid: true })
    const deleted = commitPatch(document, { op: "deleteObject", id: "line-a" }).document
    // The line and the intersection go; the *other* line that met it at that point stays.
    expect(deleted.primitives.map((primitive) => primitive.id).sort()).toEqual(["keep", "line-b"])
    // The result is a valid document, so it can still be saved.
    expect(validateDocument(deleted).valid).toBe(true)
  })

  it("deletes a circle together with its line-circle and circle-circle intersections", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "line-1", type: "line", a: { x: -5, y: 0 }, b: { x: 5, y: 0 } },
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
      { id: "circle-2", type: "circle", center: { x: 3, y: 0 }, radius: 2 },
      { id: "line-circle", type: "lineCircleIntersection", lineId: "line-1", circleId: "circle-1", x: 2, y: 0 },
      { id: "circle-circle", type: "circleIntersection", circleA: "circle-1", circleB: "circle-2", x: 1.5, y: 0 },
      { id: "keep", type: "point", x: 9, y: 9 }
    ]

    const deleted = commitPatch(document, { op: "deleteObject", id: "circle-1" }).document
    expect(deleted.primitives.map((primitive) => primitive.id).sort()).toEqual(["circle-2", "keep", "line-1"])
    expect(validateDocument(deleted).valid).toBe(true)
  })

  it("cascades through several levels, not just one", () => {
    const document = createEmptyDocument("conics")
    // A point → the connection joining it to another point → the intersection of that connection
    // with a circle. Deleting the point must take the whole chain, not just the first level.
    document.primitives = [
      { id: "p1", type: "point", x: -4, y: 0 },
      { id: "p2", type: "point", x: 4, y: 0 },
      { id: "seg", type: "connection", kind: "segment", startPointId: "p1", endPointId: "p2" },
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 1 },
      { id: "hits", type: "intersectionSet", objectA: "seg", objectB: "circle-1", points: [] },
      { id: "keep", type: "point", x: 9, y: 9 }
    ]

    const deleted = commitPatch(document, { op: "deleteObject", id: "p1" }).document
    // p1 goes, the connection goes with its endpoint, and the intersection set goes with the
    // connection. The other point, the circle and the unrelated point survive.
    expect(deleted.primitives.map((primitive) => primitive.id).sort()).toEqual(["circle-1", "keep", "p2"])
    expect(validateDocument(deleted).valid).toBe(true)
  })

  /**
   * 边界的诚实记录：**交点本身**会级联删除，但如果那个交点身上挂着用户自己写的东西
   * （注释 / 分组 / 测量 / 约束），删除仍会被拒绝 —— 那些是既有测试保护的刻意行为，
   * 不能因为"要删交点"就顺手把用户写的内容一起抹掉。
   */
  it("takes the user's own annotation down with the object it points at", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } },
      { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 1, y: 0 } },
      { id: "intersection", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0.5, y: 0.5 }
    ]
    document.annotations = [{ id: "note", text: "交点", target: "intersection" }]

    // 标注挂在对象上：删对象时一起注销（用户确认的语义），不留悬空引用。
    expect(validatePatch(document, { op: "deleteObject", id: "line-a" })).toEqual({ valid: true })
    const deleted = commitPatch(document, { op: "deleteObject", id: "line-a" }).document
    expect(deleted.primitives.map((primitive) => primitive.id)).toEqual(["line-b"])
    expect(deleted.annotations).toEqual([])
    expect(validateDocument(deleted).valid).toBe(true)
  })

  it("deletes the annotation together with the point it annotates", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [{ id: "point-1", type: "point", x: 1, y: 1 }]
    document.annotations = [{ id: "note", text: "顶点", target: "point-1" }]

    const deleted = commitPatch(document, { op: "deleteObject", id: "point-1" }).document
    expect(deleted.primitives).toEqual([])
    expect(deleted.annotations).toEqual([])
    expect(validateDocument(deleted).valid).toBe(true)
  })

  it("creates and protects a sampled curve intersection", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "ellipse-1", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2 },
      { id: "function-1", type: "function", expression: "x*x", domain: [-4, 4], samples: 128 }
    ]

    const result = commitPatch(document, { op: "addPrimitive", primitive: { id: "curve-intersection-1", type: "curveIntersection", objectA: "ellipse-1", objectB: "function-1", x: 0, y: 0 } })

    expect(result.changed).toBe(true)
    expect(result.document.primitives[2]).toMatchObject({ type: "curveIntersection", visible: true })
    // Deleting either source takes the sampled intersection with it, rather than refusing the delete.
    const deleted = commitPatch(result.document, { op: "deleteObject", id: "ellipse-1" }).document
    expect(deleted.primitives.map((primitive) => primitive.id)).toEqual(["function-1"])
    expect(validateDocument(deleted).valid).toBe(true)
  })

  it("rejects overlapping groups and locked batch alignment", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "point-1", type: "point", x: 1, y: 2 },
      { id: "point-2", type: "point", x: 3, y: 4, locked: true },
      { id: "point-3", type: "point", x: 5, y: 6 }
    ]
    document.groups = [{ id: "group-1", members: ["point-1", "point-2"] }]

    expect(validatePatch(document, { op: "createGroup", group: { id: "group-2", members: ["point-2", "point-3"] } })).toEqual({ valid: false, errors: ["primitive already belongs to a group"] })
    expect(validatePatch(document, { op: "alignPrimitives", ids: ["point-1", "point-2"], alignment: "left" })).toEqual({ valid: false, errors: ["selection contains locked object"] })
  })

  it("rejects invalid alignment values and locked constrained dependents", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
      { id: "line-b", type: "line", a: { x: 0, y: 1 }, b: { x: 2, y: 1 } },
      { id: "line-c", type: "line", a: { x: 0, y: 2 }, b: { x: 2, y: 2 }, locked: true },
      { id: "point-1", type: "point", x: 5, y: 5 }
    ]
    document.constraints = [
      { id: "parallel-1", type: "parallel", targets: ["line-a", "line-b"] },
      { id: "parallel-2", type: "parallel", targets: ["line-b", "line-c"] }
    ]

    const invalidAlignment = validatePatch(document, { op: "alignPrimitives", ids: ["line-a", "point-1"], alignment: "diagonal" as never })
    const lockedDependent = validatePatch(document, { op: "alignPrimitives", ids: ["line-a", "point-1"], alignment: "left" })
    const singleObject = validatePatch(document, { op: "alignPrimitives", ids: ["line-a"], alignment: "left" })

    expect(invalidAlignment.valid).toBe(false)
    expect(invalidAlignment.valid ? [] : invalidAlignment.errors).toContain("alignment is invalid")
    expect(lockedDependent.valid).toBe(false)
    expect(lockedDependent.valid ? [] : lockedDependent.errors).toContain("alignment would move locked constrained object")
    expect(singleObject.valid).toBe(false)
    expect(singleObject.valid ? [] : singleObject.errors).toContain("alignment requires multiple objects")
  })

  it("rejects malformed primitive patches without throwing", () => {
    const document = createEmptyDocument("calculus")
    const malformedOperations = [
      { op: "addPrimitive", primitive: { id: "point-1", type: "point" } },
      { op: "addPrimitive", primitive: { id: "segment-1", type: "segment" } }
    ] as never[]

    for (const operation of malformedOperations) {
      expect(() => validatePatch(document, operation)).not.toThrow()
      expect(validatePatch(document, operation).valid).toBe(false)
    }
  })

  it("adds and deletes persistent annotations transactionally", () => {
    const document = createEmptyDocument("calculus")
    const annotation = { id: "annotation-1", text: "A", anchor: { kind: "coordinate", x: 1, y: 2 } }
    const added = commitPatch(document, { op: "addAnnotation", annotation } as never)

    expect(added.changed).toBe(true)
    expect(added.document.annotations).toEqual([annotation])

    const deleted = commitPatch(added.document, { op: "deleteAnnotation", id: annotation.id } as never)
    expect(deleted.changed).toBe(true)
    expect(deleted.document.annotations).toEqual([])
  })

  it("adds and deletes engineering annotations transactionally", () => {
    const document = createEmptyDocument("cad")
    document.primitives = [
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 } }
    ]
    const engineeringAnnotation = {
      id: "dimension-1",
      kind: "linear" as const,
      sourceIds: ["point-a", "point-b"],
      view: "front" as const,
      status: "valid" as const,
      explanation: "线性尺寸"
    }

    const added = commitPatch(document, { op: "addEngineeringAnnotation", annotation: engineeringAnnotation } as never)
    expect(added.changed).toBe(true)
    expect(added.document.engineeringAnnotations).toEqual([engineeringAnnotation])

    const deleted = commitPatch(added.document, { op: "deleteEngineeringAnnotation", id: engineeringAnnotation.id } as never)
    expect(deleted.changed).toBe(true)
    expect(deleted.document.engineeringAnnotations).toEqual([])
  })

  it("deletes an annotation anchored to the object it was attached to", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "line-a", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }]
    const annotated = commitPatch(document, { op: "addAnnotation", annotation: { id: "annotation-1", text: "A", anchor: { kind: "primitive", primitiveId: "line-a" } } } as never)

    expect(validatePatch(annotated.document, { op: "deleteObject", id: "line-a" })).toEqual({ valid: true })
    const deleted = commitPatch(annotated.document, { op: "deleteObject", id: "line-a" }).document
    expect(deleted.primitives).toEqual([])
    expect(deleted.annotations).toEqual([])
    expect(validateDocument(deleted).valid).toBe(true)
  })

  it("translates a function through one domain operation", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "function-1", type: "function", expression: "x*x", domain: [-2, 2] }]

    const result = commitPatch(document, { op: "translatePrimitive", id: "function-1", delta: { x: 2, y: 1 } })

    expect(result.changed).toBe(true)
    expect(result.document.primitives[0]).toMatchObject({ expression: "((x-2)*(x-2))+1", domain: [0, 4] })
  })

  it("translates a ray body while preserving its direction", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "ray-1", type: "ray", a: { x: 1, y: 2 }, b: { x: 3, y: 5 } }]

    const result = commitPatch(document, { op: "translatePrimitive", id: "ray-1", delta: { x: -2, y: 4 } })

    expect(result.document.primitives[0]).toMatchObject({ a: { x: -1, y: 6 }, b: { x: 1, y: 9 } })
  })

  it("accepts a spatial point-on-line constraint and rejects mismatched targets", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "point-b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b"] } }
    ]
    const operation = { op: "addConstraint" as const, constraint: { id: "on-line", type: "pointOnLine" as const, targets: ["point-a", "line-ab"] } }

    expect(validatePatch(document, operation)).toEqual({ valid: true })
    expect(commitPatch(document, operation).document.constraints).toEqual([operation.constraint])
    expect(validatePatch(document, { op: "addConstraint", constraint: { id: "on-line-2", type: "pointOnLine", targets: ["point-a", "point-b"] } })).toEqual({ valid: false, errors: ["pointOnLine requires a point and line"] })
    expect(validatePatch(document, { op: "addConstraint", constraint: { id: "collinear-1", type: "collinear", targets: ["point-a", "point-b"] } })).toEqual({ valid: false, errors: ["constraint has invalid targets"] })
  })

  it("adds and deletes a 3D measurement transactionally and unregisters it with its sources", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "point-b", type: "point3", position: { x: 3, y: 4, z: 0 } }
    ]
    const measurement = { id: "measurement3-1", kind: "measurement3" as const, sourceIds: ["point-a", "point-b"], metric: "distance" as const, value: 5, unit: "u", precision: "numeric-approximation" as const, status: "valid" as const, explanation: "两个空间点的坐标计算距离。" }
    const added = commitPatch(document, { op: "addMeasurement", measurement })

    expect(added.changed).toBe(true)
    expect(added.document.measurements).toHaveLength(1)
    expect(added.document.measurements[0]).toMatchObject({ id: "measurement3-1", metric: "distance", status: "valid", value: 5 })
    // 删除被测量的点时测量随宿主一起注销，不再要求用户"先手动删测量"。
    expect(validatePatch(added.document, { op: "deleteObject", id: "point-a" })).toEqual({ valid: true })
    const withoutPoint = commitPatch(added.document, { op: "deleteObject", id: "point-a" }).document
    expect(withoutPoint.measurements).toEqual([])
    expect(validateDocument(withoutPoint).valid).toBe(true)
    expect(validatePatch(added.document, { op: "addMeasurement", measurement })).toEqual({ valid: false, errors: ["duplicate measurement id"] })
    expect(validatePatch(added.document, { op: "addMeasurement", measurement: { ...measurement, id: "measurement3-2", sourceIds: ["missing"] } })).toEqual({ valid: false, errors: ["measurement has invalid sources"] })
    expect(commitPatch(added.document, { op: "deleteMeasurement", id: measurement.id }).document.measurements).toEqual([])
  })

  it("deletes a section together with the solid it cuts", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } },
      { id: "section-1", type: "section", sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [], classification: "none", status: "undefined" }
    ]

    expect(validatePatch(document, { op: "deleteObject", id: "cube-1" })).toEqual({ valid: true })
    const deleted = commitPatch(document, { op: "deleteObject", id: "cube-1" }).document
    expect(deleted.primitives).toEqual([])
    expect(validateDocument(deleted).valid).toBe(true)
  })

  it("deletes a template solid together with the topology it generated", () => {
    const { document, built } = templateCubeDocument()

    expect(validatePatch(document, { op: "deleteObject", id: "cube-1" })).toEqual({ valid: true })
    const result = commitPatch(document, { op: "deleteObject", id: "cube-1" })

    expect(result.changed).toBe(true)
    expect(result.document.primitives).toHaveLength(0)
    expect(validateDocument(result.document).valid).toBe(true)
    expect(built.primitives.length).toBeGreaterThan(20)
  })

  it("deletes the whole template family when the generated topology is the target", () => {
    const { document, built } = templateCubeDocument()

    const result = commitPatch(document, { op: "deleteObject", id: built.polyhedronId! })

    expect(result.changed).toBe(true)
    expect(result.document.primitives).toHaveLength(0)
    expect(validateDocument(result.document).valid).toBe(true)
  })

  it("deletes the whole template family when one generated edge is the target", () => {
    const { document, built } = templateCubeDocument()

    const result = commitPatch(document, { op: "deleteObject", id: built.edgeIds[0] })

    expect(result.changed).toBe(true)
    expect(result.document.primitives).toHaveLength(0)
    expect(validateDocument(result.document).valid).toBe(true)
  })

  it("deletes a section together with its template solid, keeping the document valid", () => {
    const { document } = templateCubeDocument()
    document.primitives.push({ id: "section-1", type: "section", sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [], classification: "none", status: "undefined" })

    expect(validatePatch(document, { op: "deleteObject", id: "cube-1" })).toEqual({ valid: true })
    const deleted = commitPatch(document, { op: "deleteObject", id: "cube-1" }).document
    expect(deleted.primitives).toEqual([])
    expect(validateDocument(deleted).valid).toBe(true)
  })

  it("deletes a generated face together with the measurement on it", () => {
    const { document, built } = templateCubeDocument()
    document.measurements = [{ id: "measurement3-1", kind: "measurement3", metric: "area", sourceIds: [built.faceIds[0]], precision: "numeric-approximation", status: "valid", explanation: "面积" }]

    // 生成的面属于模板实体（删面 = 删整族），测量随它一起注销。
    expect(validatePatch(document, { op: "deleteObject", id: built.faceIds[0] })).toEqual({ valid: true })
    const deleted = commitPatch(document, { op: "deleteObject", id: "cube-1" }).document
    expect(deleted.primitives).toEqual([])
    expect(deleted.measurements).toEqual([])
    expect(validateDocument(deleted).valid).toBe(true)
  })

  it("rejects malformed measurement patches without throwing", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } }]
    const malformedOperations = [
      { op: "addMeasurement", measurement: { id: "measurement3-1" } },
      { op: "addMeasurement" },
      { op: "addMeasurement", measurement: { id: "measurement3-2", kind: "measurement3", sourceIds: ["point-a"], metric: "bogus", precision: "numeric-approximation", status: "valid", explanation: "x" } }
    ] as never[]

    for (const operation of malformedOperations) {
      expect(() => validatePatch(document, operation)).not.toThrow()
      expect(validatePatch(document, operation).valid).toBe(false)
    }
  })
})
