import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { buildSolidTemplate, createMeasurement3 } from "@draw/geometry-kernel"
import { describe, expect, it } from "vitest"
import { commitPatch, patchPoint3, recomputeDerivedObjects } from "./index"

describe("volume measurements after editing a materialized solid", () => {
  function setup(kind: "cube" | "pyramid" | "cylinder" | "cone" = "cube") {
    const solid: Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }> = kind === "cube"
      ? { id: "solid", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } }
      : kind === "pyramid"
        ? { id: "solid", type: "pyramid", baseCenter: { x: 0, y: 0, z: 0 }, baseSize: { x: 2, y: 2 }, height: 2 }
        : { id: "solid", type: kind, center: { x: 0, y: 0, z: 0 }, radius: 1, height: 2, segments: 12 }
    const built = buildSolidTemplate(solid)
    const document = createEmptyDocument("geometry3d")
    document.primitives = [solid, ...built.primitives]
    document.measurements = [createMeasurement3("volume", "volume", [solid.id], document.primitives)]
    return { document, built }
  }

  it("recalculates both incrementally and fully from edited vertices instead of the old template size", () => {
    let { document } = setup()
    // Raise all four top vertices: a 2×2×2 cube becomes a 2×2×4 cuboid.
    const top = document.primitives.filter(p => p.type === "point3" && p.position.z === 2)
    expect(top).toHaveLength(4)
    for (const point of top) {
      if (point.type !== "point3") continue
      const edited = commitPatch(document, patchPoint3(point.id, { ...point.position, z: 4 }))
      expect(edited.error).toBeUndefined()
      document = edited.document
    }
    const full = recomputeDerivedObjects(document)
    expect(full.measurements[0]?.value).toBeCloseTo(16, 10)
    expect(document.measurements[0]?.value).toBeCloseTo(16, 10)
    const polyhedron = document.primitives.find(p => p.type === "polyhedron3")!
    expect(createMeasurement3("topology-volume", "volume", [polyhedron.id], document.primitives).value).toBeCloseTo(16, 10)
  })

  for (const kind of ["cube", "pyramid", "cylinder", "cone"] as const) {
    it(`uses the edited boundary of a ${kind} and preserves unrelated measurements`, () => {
      const fixture = setup(kind)
      let document = fixture.document
      const built = fixture.built
      document.measurements.push(createMeasurement3("topology-volume", "volume", [built.polyhedronId!], document.primitives))
      document.primitives.push({ id: "other", type: "sphere", center: { x: 20, y: 0, z: 0 }, radius: 1 })
      document.measurements.push(createMeasurement3("other-volume", "volume", ["other"], document.primitives))
      const unrelated = document.measurements[2]
      const vertex = document.primitives.find(p => p.id === built.vertexIds[0])!
      if (vertex.type !== "point3") throw new Error("missing vertex")
      const edited = commitPatch(document, patchPoint3(vertex.id, { ...vertex.position, x: vertex.position.x - 1 }))
      expect(edited.error).toBeUndefined()
      document = edited.document
      const expected = createMeasurement3("expected", "volume", [built.polyhedronId!], document.primitives)
      expect(document.measurements[0]?.value).toBeCloseTo(expected.value!, 10)
      expect(document.measurements[0]?.precision).toBe("numeric-approximation")
      expect(createMeasurement3("new-volume", "volume", ["solid"], document.primitives).value).toBeCloseTo(expected.value!, 10)
      expect(document.measurements[2]).toEqual(unrelated)
    })
  }

  for (const kind of ["pyramid", "cylinder", "cone"] as const) {
    it(`preserves the analytic formula for an unedited ${kind} after resizing`, () => {
      const { document } = setup(kind)
      const edited = commitPatch(document, { op: "updatePrimitive", id: "solid", patch: { height: 4 } })
      expect(edited.error).toBeUndefined()
      const expected = kind === "pyramid" ? 16 / 3 : kind === "cylinder" ? 4 * Math.PI : 4 * Math.PI / 3
      expect(edited.document.measurements[0]?.value).toBeCloseTo(expected, 10)
      expect(edited.document.measurements[0]?.precision).toBe("exact-input")
    })
  }

  it("still updates analytic template volumes after changing dimensions", () => {
    const { document } = setup()
    const edited = commitPatch(document, { op: "updatePrimitive", id: "solid", patch: { size3: { x: 2, y: 3, z: 4 } } })
    expect(edited.error).toBeUndefined()
    expect(edited.document.measurements[0]).toMatchObject({ value: 24, precision: "exact-input" })
  })
})
