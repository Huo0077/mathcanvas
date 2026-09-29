import * as THREE from "three"
import { createEmptyDocument, decodeMgeo, encodeMgeo, type Point3Primitive } from "@draw/dsl"
import { commitTransaction } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createEdge3Line, createPointDrivenLine } from "./threePrimitives"

const point = (id: string, x: number): Point3Primitive => ({ id, type: "point3", position: { x, y: 0, z: 0 }, binding: { kind: "free" } })
const points = new Map([["A", point("A", 0)], ["B", point("B", 4)]])

describe("instructional 3D line styles", () => {
  it("draws an explicit segment dash pattern with usable line distances even when selected", () => {
    const line = createPointDrivenLine({ id: "helper", type: "segment3", pointIds: ["A", "B"], style: { dash: "8 6", stroke: "#1b6597" } }, points, true)!
    expect(line.material).toBeInstanceOf(THREE.LineDashedMaterial)
    expect((line.material as THREE.LineDashedMaterial).dashSize).toBeGreaterThan(0)
    expect(line.geometry.getAttribute("lineDistance")).toBeTruthy()
    expect(line.geometry.getAttribute("lineDistance").getX(1)).toBeCloseTo(4)
  })

  it("renders point-line edge styling independently of view-only hidden edges", () => {
    const edge = createEdge3Line({ id: "edge-ab", type: "edge3", pointIds: ["A", "B"], style: { dash: "2 5" } }, points, false)!
    expect(edge.material).toBeInstanceOf(THREE.LineDashedMaterial)
    expect((edge.material as THREE.LineDashedMaterial).gapSize).toBeGreaterThan((edge.material as THREE.LineDashedMaterial).dashSize)
    expect(edge.userData.primitiveId).toBe("edge-ab")
    const solid = createEdge3Line({ id: "edge-cd", type: "edge3", pointIds: ["A", "B"] }, points, false)!
    expect(solid.material).toBeInstanceOf(THREE.LineBasicMaterial)
  })

  it("keeps a teacher's dash choice after a document edit and .mgeo roundtrip", () => {
    const base = createEmptyDocument("geometry3d")
    const created = commitTransaction({ base, operations: [{ op: "addPrimitives", primitives: [point("A", 0), point("B", 4), { id: "helper", type: "segment3", pointIds: ["A", "B"] }] }] })
    expect(created.errors).toEqual([])
    const styled = commitTransaction({ base: created.document, operations: [{ op: "updatePrimitive", id: "helper", patch: { style: { dash: "8 6" } } }] })
    expect(styled.errors).toEqual([])
    const recovered = decodeMgeo(encodeMgeo(styled.document))
    expect(recovered.primitives.find((item) => item.id === "helper")?.style?.dash).toBe("8 6")
    const hidden = commitTransaction({ base: recovered, operations: [{ op: "toggleVisibility", id: "helper", visible: false }] })
    expect(hidden.document.primitives.find((item) => item.id === "helper")?.style?.dash).toBe("8 6")
  })
})