import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate, conic3FromCircle3, projectConic3, projectionBasis } from "@draw/geometry-kernel"

import { resolveProjectedDrawing, defaultDraftView, drawingViewLabels, projectedDrawingForView } from "./projectionVisuals"

function topologyDocument(primitives: PrimitiveSpec[]): GeometryDocument {
  return { ...createEmptyDocument("cad"), primitives }
}

function tetrahedronPrimitives(): PrimitiveSpec[] {
  const points: PrimitiveSpec[] = [
    { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
    { id: "point-b", type: "point3", position: { x: 2, y: 0, z: 0 } },
    { id: "point-c", type: "point3", position: { x: 0, y: 2, z: 0 } },
    { id: "point-d", type: "point3", position: { x: 0, y: 0, z: 2 } }
  ]
  const edges: PrimitiveSpec[] = [
    { id: "edge-ab", type: "edge3", pointIds: ["point-a", "point-b"] },
    { id: "edge-ac", type: "edge3", pointIds: ["point-a", "point-c"] },
    { id: "edge-ad", type: "edge3", pointIds: ["point-a", "point-d"] },
    { id: "edge-bc", type: "edge3", pointIds: ["point-b", "point-c"] },
    { id: "edge-bd", type: "edge3", pointIds: ["point-b", "point-d"] },
    { id: "edge-cd", type: "edge3", pointIds: ["point-c", "point-d"] },
    { id: "edge-missing", type: "edge3", pointIds: ["point-a", "missing-point"] }
  ]
  const faces: PrimitiveSpec[] = [
    { id: "face-abc", type: "face3", pointIds: ["point-a", "point-b", "point-c"] },
    { id: "face-abd", type: "face3", pointIds: ["point-a", "point-b", "point-d"] },
    { id: "face-acd", type: "face3", pointIds: ["point-a", "point-c", "point-d"] },
    { id: "face-bcd", type: "face3", pointIds: ["point-b", "point-c", "point-d"] }
  ]
  const solid: PrimitiveSpec = {
    id: "solid-1",
    type: "polyhedron3",
    vertexIds: ["point-a", "point-b", "point-c", "point-d"],
    edgeIds: ["edge-ab", "edge-ac", "edge-ad", "edge-bc", "edge-bd", "edge-cd"],
    faceIds: ["face-abc", "face-abd", "face-acd", "face-bcd"]
  }
  return [...points, ...edges, ...faces, solid]
}

describe("renderer-neutral engineering drawing projections", () => {
  it("resolves stable source IDs, closed faces, and finite depths", () => {
    const drawing = resolveProjectedDrawing(topologyDocument(tetrahedronPrimitives()), "front")

    expect(drawing.view).toBe("front")
    expect(drawing.primitives.map((primitive) => primitive.sourceId)).toEqual(expect.arrayContaining(["point-a", "edge-ab", "face-abc"]))
    expect(drawing.primitives.some((primitive) => primitive.sourceId === "solid-1")).toBe(false)
    const polygon = drawing.primitives.find((primitive) => primitive.kind === "polygon" && primitive.sourceId === "face-abc")
    expect(polygon?.kind).toBe("polygon")
    if (polygon?.kind === "polygon") {
      expect(polygon.points.length).toBe(4)
      expect(polygon.points[0]).toEqual(polygon.points.at(-1))
      expect(Number.isFinite(polygon.depth)).toBe(true)
    }
    drawing.primitives.forEach((primitive) => {
      if (primitive.kind === "point") expect(Number.isFinite(primitive.point.depth)).toBe(true)
      else primitive.points.forEach((point) => expect(Number.isFinite(point.depth)).toBe(true))
    })
  })

  it("reports missing references without fabricating a projected origin", () => {
    const drawing = resolveProjectedDrawing(topologyDocument(tetrahedronPrimitives()), "top")

    expect(drawing.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining("edge-missing")]))
    expect(drawing.primitives.some((primitive) => primitive.sourceId === "edge-missing")).toBe(false)
  })

  it("orders projected records by depth and stable source ID", () => {
    const drawing = resolveProjectedDrawing(topologyDocument([
      { id: "point-far", type: "point3", position: { x: 0, y: 0, z: 4 } },
      { id: "point-near", type: "point3", position: { x: 0, y: 0, z: -2 } },
      { id: "point-same-depth-b", type: "point3", position: { x: 1, y: 0, z: 0 } },
      { id: "point-same-depth-a", type: "point3", position: { x: 0, y: 1, z: 0 } }
    ]), "front")

    expect(drawing.primitives.map((primitive) => primitive.sourceId)).toEqual([
      "point-near",
      "point-same-depth-a",
      "point-same-depth-b",
      "point-far"
    ])
  })

  it("describes cross-view projection links for each stable source", () => {
    const drawing = resolveProjectedDrawing(topologyDocument(tetrahedronPrimitives()), "front")

    expect(drawing.projectionLines.length).toBeGreaterThan(0)
    expect(drawing.projectionLines.every((line) => line.originView === "front")).toBe(true)
    expect(drawing.projectionLines.some((line) => line.sourceId === "point-a" && line.targetView === "top")).toBe(true)
  })

  it("does not render a parameterized template source beside its materialized topology", () => {
    const source: Extract<PrimitiveSpec, { type: "cube" }> = {
      id: "cube-source",
      type: "cube",
      origin: { x: 0, y: 0, z: 0 },
      size: { x: 2, y: 2, z: 2 }
    }
    const generated = buildSolidTemplate(source)
    const drawing = resolveProjectedDrawing(topologyDocument([source, ...generated.primitives]), "axonometric")
    const sourceIds = drawing.primitives.map((primitive) => primitive.sourceId)

    expect(sourceIds).not.toContain(source.id)
    expect(new Set(sourceIds).size).toBe(sourceIds.length)
    expect(sourceIds).toEqual(expect.arrayContaining(generated.vertexIds))
    expect(sourceIds).toEqual(expect.arrayContaining(generated.edgeIds))
    expect(sourceIds).toEqual(expect.arrayContaining(generated.faceIds))
  })

  it("projects engineering annotations from stable 3D sources", () => {
    const drawing = resolveProjectedDrawing({
      ...topologyDocument([
        { id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } },
        { id: "point-b", type: "point3", position: { x: 3, y: 4, z: 0 } }
      ]),
      engineeringAnnotations: [{ id: "dimension-1", kind: "linear", sourceIds: ["point-a", "point-b"], view: "front", status: "valid", explanation: "" }]
    }, "front")

    expect(drawing.annotations).toHaveLength(1)
    expect(drawing.annotations[0]).toMatchObject({ id: "dimension-1", status: "valid", position: { x: 1.5, y: 2 } })
    expect(drawing.annotations[0].text).toContain("5")
  })

  it("keeps invalid engineering annotation diagnostics without inventing a position", () => {
    const drawing = resolveProjectedDrawing({
      ...topologyDocument([{ id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } }]),
      engineeringAnnotations: [{ id: "dimension-invalid", kind: "linear", sourceIds: ["missing", "point-a"], view: "front", status: "insufficient-data", explanation: "" }]
    }, "front")

    expect(drawing.annotations[0]).toMatchObject({ id: "dimension-invalid", status: "insufficient-data" })
    expect(drawing.annotations[0].position).toBeUndefined()
    expect(drawing.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining("dimension-invalid")]))
  })
})

describe("drawing view metadata", () => {
  it("labels every drawing view kind for the tree and the viewports", () => {
    expect(drawingViewLabels).toEqual({ model: "模型视图", front: "主视图", top: "俯视图", left: "左视图", axonometric: "轴测图" })
  })

  it("synthesises a drafting view when the sheet has none", () => {
    const sheet = { id: "sheet-1", name: "工程图纸", paper: "A4" as const, orientation: "landscape" as const, scale: 2, viewIds: [] }
    const draft = defaultDraftView(sheet, [{ id: "view-front", kind: "front" as const, x: 0, y: 0, width: 10, height: 10, scale: 1, visible: true, showProjectionLines: false }])

    expect(draft).toMatchObject({ id: "view-model", kind: "model", scale: 2, visible: true })
  })

  it("reuses an existing model view instead of creating a second one", () => {
    const existing = { id: "view-model", kind: "model" as const, x: 5, y: 6, width: 100, height: 80, scale: 3, visible: false, showProjectionLines: false }

    expect(defaultDraftView(null, [existing])).toEqual(existing)
  })

  it("never fabricates a projected drawing for the drafting view", () => {
    const document = topologyDocument([{ id: "point-a", type: "point3", position: { x: 0, y: 0, z: 0 } }])
    const modelView = { id: "view-model", kind: "model" as const, x: 0, y: 0, width: 10, height: 10, scale: 1, visible: true, showProjectionLines: false }
    const frontView = { ...modelView, id: "view-front", kind: "front" as const }

    expect(projectedDrawingForView(document, modelView)).toBeNull()
    expect(projectedDrawingForView(document, frontView)?.primitives).toHaveLength(1)
  })
})

describe("analytic circle3 projection", () => {
  const center = { x: 0, y: 0, z: 0 }
  const circle: Extract<PrimitiveSpec, { type: "circle3" }> = { id: "circle-rim", type: "circle3", centerId: "point-center", normal: { x: 0, y: 0, z: 1 }, radius: 2 }
  const circleDocument = (primitive: PrimitiveSpec) => topologyDocument([{ id: "point-center", type: "point3", position: center }, primitive])

  it("projects a circle3 as a dense polyline that lies on the analytic ellipse", () => {
    const drawing = resolveProjectedDrawing(circleDocument(circle), "axonometric")
    const projected = drawing.primitives.find((primitive) => primitive.sourceId === circle.id)

    // 空间圆必须真的投影出来（以前完全没投影），而且沿用既有的 polyline 图元：不新增图元种类，
    // 三个消费方（DrawingViewport / engineeringExporters）因此不用改。
    expect(projected?.kind).toBe("polyline")
    if (projected?.kind !== "polyline") throw new Error("circle3 must project to a polyline")
    expect(projected.closed).toBe(true)
    // 采样要够密（"放大不看出棱"），且首尾重合——不依赖消费方是否读 `closed`（SVG 的 polyline 不会自己闭合）。
    expect(projected.points.length).toBeGreaterThan(64)
    expect(projected.points.at(-1)).toEqual(projected.points[0])

    // 采样点必须落在内核给出的那条**解析椭圆**上（1e-6）。
    const conic = conic3FromCircle3(circle, new Map([["point-center", { position: center }]]))
    expect(conic).not.toBeNull()
    const analytic = projectConic3(conic!, "axonometric")
    expect(analytic?.kind).toBe("ellipse")
    if (analytic?.kind !== "ellipse") throw new Error("an obliquely viewed circle must project to an ellipse")
    const majorAxis = { x: Math.cos(analytic.rotation), y: Math.sin(analytic.rotation) }
    const minorAxis = { x: -Math.sin(analytic.rotation), y: Math.cos(analytic.rotation) }
    projected.points.forEach((point) => {
      const dx = point.x - analytic.center.x
      const dy = point.y - analytic.center.y
      const alongMajor = (dx * majorAxis.x + dy * majorAxis.y) / analytic.semiMajor
      const alongMinor = (dx * minorAxis.x + dy * minorAxis.y) / analytic.semiMinor
      expect(Math.hypot(alongMajor, alongMinor)).toBeCloseTo(1, 6)
    })

    /**
     * 独立校验（不读 `rotation` 与半轴）：在圆平面内任取正交单位基，取 `A = r·P(u)`、`B = r·P(v)`，
     * 投影像就是 `{proj(C) + A cos t + B sin t}`，即隐式方程 `qᵀM⁻¹q = 1`（`M = A·Aᵀ + B·Bᵀ`）。
     * 两条路径都同意，才能说"采样的确实是那条真投影曲线"，而不是恰好落在一个自洽的错椭圆上。
     */
    const basis = projectionBasis("axonometric")
    const inPlane = [{ x: 0, y: -1, z: 0 }, { x: 1, y: 0, z: 0 }]
    const image = inPlane.map((direction) => ({
      x: circle.radius * (direction.x * basis.horizontal.x + direction.y * basis.horizontal.y + direction.z * basis.horizontal.z),
      y: circle.radius * (direction.x * basis.vertical.x + direction.y * basis.vertical.y + direction.z * basis.vertical.z)
    }))
    const m11 = image[0].x ** 2 + image[1].x ** 2
    const m12 = image[0].x * image[0].y + image[1].x * image[1].y
    const m22 = image[0].y ** 2 + image[1].y ** 2
    const determinant = m11 * m22 - m12 * m12
    expect(determinant).toBeGreaterThan(0)
    projected.points.forEach((point) => {
      const quadratic = (m22 * point.x * point.x - 2 * m12 * point.x * point.y + m11 * point.y * point.y) / determinant
      expect(quadratic).toBeCloseTo(1, 6)
    })
  })

  it("collapses an edge-on circle3 to its projected segment", () => {
    const edgeOn: Extract<PrimitiveSpec, { type: "circle3" }> = { ...circle, normal: { x: 1, y: 0, z: 0 } }
    const drawing = resolveProjectedDrawing(circleDocument(edgeOn), "front")
    const projected = drawing.primitives.find((primitive) => primitive.sourceId === circle.id)

    // 边视是**线段**（长度 = 直径）：既不是零面积椭圆，也不是"干脆不画"。
    expect(projected?.kind).toBe("polyline")
    if (projected?.kind !== "polyline") throw new Error("an edge-on circle3 must project to a segment polyline")
    expect(projected.closed).toBe(false)
    expect(projected.points).toHaveLength(2)
    expect(Math.hypot(projected.points[0].x - projected.points[1].x, projected.points[0].y - projected.points[1].y)).toBeCloseTo(4, 9)
  })

  it("reports a circle3 whose centre reference is missing", () => {
    const drawing = resolveProjectedDrawing(topologyDocument([{ ...circle, centerId: "missing-point" }]), "front")

    expect(drawing.primitives.some((primitive) => primitive.sourceId === circle.id)).toBe(false)
    expect(drawing.diagnostics).toEqual(expect.arrayContaining([expect.stringContaining(circle.id)]))
  })
})
