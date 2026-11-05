import { createEmptyDocument, type Point3Binding } from "@draw/dsl"
import { commitTransaction } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"
import { hostPointDragOperations } from "./hostPointDrag"

function fixture(binding: Point3Binding) {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [
    { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
    { id: "b", type: "point3", position: { x: 4, y: 0, z: 0 } },
    { id: "track", type: "segment3", pointIds: ["a", "b"] },
    { id: "mover", type: "point3", position: { x: 2, y: 0, z: 0 }, binding }
  ]
  return document
}

describe("hostPointDragOperations", () => {
  it("updates the authoritative driver without losing slider metadata or the binding", () => {
    const document = fixture({ kind: "onHost", hostId: "track", parameter: 0.5, parameterId: "t" })
    document.parameters.t = { id: "t", value: 0.5, min: 0, max: 1, step: 0.01, label: "进度", ownerId: "mover" }
    const operations = hostPointDragOperations(document, "mover", { u: 0.75 })
    expect(operations).toContainEqual({ op: "setParameter", id: "t", value: 0.75 })
    const result = commitTransaction({ base: document, operations })
    expect(result.errors).toEqual([])
    expect(result.document.parameters.t).toMatchObject({ ...document.parameters.t, value: 0.75 })
    expect(result.document.primitives.find(p => p.id === "mover")).toMatchObject({ position: { x: 3, y: 0, z: 0 }, binding: { parameterId: "t", parameter: 0.75 } })
    expect(document.parameters.t.value).toBe(0.5)
  })

  it("still supports bindings without drivers and legacy onLine bindings", () => {
    for (const binding of [
      { kind: "onHost", hostId: "track", parameter: 0.5 },
      { kind: "onLine", lineId: "track", parameter: 0.5 }
    ] as const) {
      expect(hostPointDragOperations(fixture(binding), "mover", { u: 0.75 })).toEqual([
        { op: "updatePrimitive", id: "mover", patch: { binding3: { ...binding, parameter: 0.75 } } }
      ])
    }
  })

  it.each(["onFace", "onSurface"] as const)("updates both %s drivers and preserves an omitted dimension's current driver value", kind => {
    const binding: Point3Binding = kind === "onFace"
      ? { kind, faceId: "face", uv: [9, 9], parameterIds: ["u", "v"] }
      : { kind, solidId: "solid", uv: [9, 9], parameterIds: ["u", "v"] }
    const document = fixture(binding)
    document.parameters = { u: { id: "u", value: 0.2 }, v: { id: "v", value: 0.4 } }
    expect(hostPointDragOperations(document, "mover", { u: 0.7 })).toEqual([
      { op: "setParameter", id: "u", value: 0.7 },
      { op: "setParameter", id: "v", value: 0.4 },
      { op: "updatePrimitive", id: "mover", patch: { binding3: { ...binding, uv: [0.7, 0.4] } } }
    ])
  })

  it("updates all three solid-volume drivers", () => {
    const binding: Point3Binding = { kind: "inSolid", solidId: "solid", uvw: [0, 0, 0], parameterIds: ["u", "v", "w"] }
    const document = fixture(binding)
    document.parameters = { u: { id: "u", value: 0.2 }, v: { id: "v", value: 0.4 }, w: { id: "w", value: 0.6 } }
    const operations = hostPointDragOperations(document, "mover", { u: 0.7, v: 0.8, w: 0.9 })
    expect(operations.slice(0, 3)).toEqual(["u", "v", "w"].map((id, index) => ({ op: "setParameter", id, value: [0.7, 0.8, 0.9][index] })))
    expect(operations[3]).toMatchObject({ patch: { binding3: { ...binding, uvw: [0.7, 0.8, 0.9] } } })
  })

  it("does not manufacture missing drivers or commit invalid drag values", () => {
    const document = fixture({ kind: "onHost", hostId: "track", parameter: 0.5, parameterId: "missing" })
    expect(hostPointDragOperations(document, "mover", { u: 0.7 })).toEqual([])
    expect(hostPointDragOperations(document, "mover", { u: NaN })).toEqual([])
    expect(hostPointDragOperations(document, "absent", { u: 0.7 })).toEqual([])
    expect(hostPointDragOperations(fixture({ kind: "free" }), "mover", { u: 0.7 })).toEqual([])
  })
})
