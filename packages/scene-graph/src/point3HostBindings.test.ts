import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { applyOperation, createPoint3, getAffectedPrimitiveIds, patchPoint3, recomputeDerivedObjects } from "./index"

/**
 * 绑到宿主上的 3D 动点：坐标永远由参数算出，宿主变了就跟着变。
 * 这是"参数是唯一真值"的可测判据——点不会自己漂，也不会在端点移动后留在原地。
 */
describe("3D host-bound points", () => {
  function segmentDocument() {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("point-a", { x: 0, y: 0, z: 0 }),
      createPoint3("point-b", { x: 2, y: 0, z: 0 }),
      { id: "segment-ab", type: "segment3", pointIds: ["point-a", "point-b"] },
      createPoint3("mover", { x: 9, y: 9, z: 9 }, { kind: "onHost", hostId: "segment-ab", parameter: 0.25 })
    ]
    return document
  }

  it("derives a host-bound point from its parameter, ignoring the stored coordinates", () => {
    const result = recomputeDerivedObjects(segmentDocument())

    expect(result.primitives.find((primitive) => primitive.id === "mover")).toMatchObject({ position: { x: 0.5, y: 0, z: 0 } })
  })

  it("keeps the point on the segment when an endpoint moves, and lists it as affected", () => {
    const moved = applyOperation(segmentDocument(), patchPoint3("point-b", { x: 4, y: 0, z: 0 }))

    expect(moved.document.primitives.find((primitive) => primitive.id === "mover")).toMatchObject({ position: { x: 1, y: 0, z: 0 } })
    expect([...getAffectedPrimitiveIds(segmentDocument(), ["point-b"])]).toEqual(["point-b", "segment-ab", "mover"])
  })

  it("clamps a host parameter to the segment's domain instead of leaving the host", () => {
    const document = segmentDocument()
    const mover = document.primitives.find((primitive) => primitive.id === "mover") as { binding: { parameter: number } }
    mover.binding.parameter = 2

    const result = recomputeDerivedObjects(document)

    expect(result.primitives.find((primitive) => primitive.id === "mover")).toMatchObject({ position: { x: 2, y: 0, z: 0 } })
  })

  it("derives surface-bound points from their uv parameter", () => {
    const document = createEmptyDocument("geometry3d")
    const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 4, segments: 8 }
    document.primitives = [cylinder, createPoint3("on-surface", { x: 9, y: 9, z: 9 }, { kind: "onSurface", solidId: "cylinder-1", uv: [0, 0.5] })]

    const result = recomputeDerivedObjects(document)
    const bound = result.primitives.find((primitive) => primitive.id === "on-surface")

    expect(bound).toMatchObject({ position: { x: 2, y: 0, z: 2 } })
  })

  it("derives face-bound points from their uv parameter", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("a", { x: 0, y: 0, z: 0 }),
      createPoint3("b", { x: 4, y: 0, z: 0 }),
      createPoint3("c", { x: 0, y: 4, z: 0 }),
      { id: "face-abc", type: "face3", pointIds: ["a", "b", "c"] },
      createPoint3("on-face", { x: 9, y: 9, z: 9 }, { kind: "onFace", faceId: "face-abc", uv: [1, 2] })
    ]

    const result = recomputeDerivedObjects(document)

    expect(result.primitives.find((primitive) => primitive.id === "on-face")).toMatchObject({ position: { x: 1, y: 2, z: 0 } })
  })

  it("keeps the stored coordinates when the host cannot be resolved, instead of moving the point", () => {
    const document = segmentDocument()
    document.primitives = document.primitives.filter((primitive) => primitive.id !== "segment-ab")

    const result = recomputeDerivedObjects(document)

    expect(result.primitives.find((primitive) => primitive.id === "mover")).toMatchObject({ position: { x: 9, y: 9, z: 9 } })
  })
})
