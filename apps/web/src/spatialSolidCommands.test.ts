import { createEmptyDocument, type GeometryDocument, type Vector3 } from "@draw/dsl"
import { commitTransaction } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { buildTeachingSolid } from "./spatialSolidCommands"

const base3: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 1, y: 3, z: 0 }]
const base4: Vector3[] = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }]
const scene = (): GeometryDocument => createEmptyDocument("geometry3d")

function built(result: ReturnType<typeof buildTeachingSolid>, document = scene()) {
  if ("error" in result) throw new Error(result.error)
  const committed = commitTransaction({ base: document, operations: result.operations })
  expect(committed.errors).toEqual([])
  return { ...result, ...committed }
}

describe("high-school solid construction", () => {
  it("creates a right triangular prism from a base and an explicit extrusion vector", () => {
    const result = built(buildTeachingSolid(scene(), { kind: "prism", base: base3, vector: { x: 0, y: 0, z: 3 } }))
    const solid = result.document.primitives.find((item) => item.id === result.selectedId)
    expect(solid).toMatchObject({ type: "polyhedron3", label: "三棱柱 1", construction: { kind: "prism", vector: { x: 0, y: 0, z: 3 } } })
    if (solid?.type !== "polyhedron3") throw new Error("missing solid")
    expect([solid.vertexIds.length, solid.edgeIds.length, solid.faceIds.length]).toEqual([6, 9, 5])
    expect(result.operations).toHaveLength(1)
  })

  it("preserves the oblique vector and creates an arbitrary quadrilateral prism", () => {
    const result = built(buildTeachingSolid(scene(), { kind: "prism", base: base4, vector: { x: 1, y: -2, z: 3 } }))
    expect(result.document.primitives.find((item) => item.id === result.selectedId)).toMatchObject({ label: "四棱柱 1", construction: { kind: "prism", vector: { x: 1, y: -2, z: 3 } } })
  })

  it("creates a triangular pyramid with the chosen apex on either side of its base", () => {
    for (const z of [4, -4]) {
      const result = built(buildTeachingSolid(scene(), { kind: "pyramid", base: base3, apex: { x: 1, y: 1, z } }))
      const solid = result.document.primitives.find((item) => item.id === result.selectedId)
      expect(solid).toMatchObject({ type: "polyhedron3", label: "三棱锥 1" })
      if (solid?.type !== "polyhedron3") throw new Error("missing solid")
      expect([solid.vertexIds.length, solid.faceIds.length]).toEqual([4, 4])
    }
  })

  it("creates a general quadrilateral pyramid with a noncentral apex", () => {
    const result = built(buildTeachingSolid(scene(), { kind: "pyramid", base: base4, apex: { x: 0, y: 1, z: 4 } }))
    expect(result.document.primitives.find((item) => item.id === result.selectedId)).toMatchObject({ label: "四棱锥 1" })
  })

  it("distinguishes a cube from a rectangular box while keeping the legacy cube document type", () => {
    const cube = built(buildTeachingSolid(scene(), { kind: "box", origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } }))
    const box = built(buildTeachingSolid(scene(), { kind: "box", origin: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 3, z: 2 } }))
    expect(cube.document.primitives.find((item) => item.id === cube.selectedId)).toMatchObject({ type: "cube", label: "正方体 1" })
    expect(box.document.primitives.find((item) => item.id === box.selectedId)).toMatchObject({ type: "cube", label: "长方体 1", size: { x: 4, y: 3, z: 2 } })
  })

  it("rejects degenerate bases, zero extrusion, and flat pyramids without producing a transaction", () => {
    expect(buildTeachingSolid(scene(), { kind: "prism", base: base3, vector: { x: 0, y: 0, z: 0 } })).toHaveProperty("error")
    expect(buildTeachingSolid(scene(), { kind: "pyramid", base: base3, apex: { x: 1, y: 1, z: 0 } })).toHaveProperty("error")
    expect(buildTeachingSolid(scene(), { kind: "pyramid", base: [base3[0], base3[1], { x: 2, y: 0, z: 0 }], apex: { x: 1, y: 0, z: 4 } })).toHaveProperty("error")
    expect(buildTeachingSolid(scene(), { kind: "box", origin: base3[0], size: { x: -1, y: 2, z: 2 } })).toHaveProperty("error")
  })
})