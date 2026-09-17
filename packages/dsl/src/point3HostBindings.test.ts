import { describe, expect, it } from "vitest"

import { createEmptyDocument, validateDocument } from "./index"

/** 3D 动点的宿主绑定（onHost / onFace / onSurface）必须过 schema，且不能留下悬空引用。 */
describe("3D point host bindings", () => {
  function hostDocument() {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "b", type: "point3", position: { x: 2, y: 0, z: 0 } },
      { id: "c", type: "point3", position: { x: 0, y: 2, z: 0 } },
      { id: "segment-ab", type: "segment3", pointIds: ["a", "b"] },
      { id: "face-abc", type: "face3", pointIds: ["a", "b", "c"] },
      { id: "cylinder-1", type: "cylinder", center: { x: 0, y: 0, z: 0 }, radius: 2, height: 4, segments: 8 },
      { id: "on-host", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onHost", hostId: "segment-ab", parameter: 0.25 } },
      { id: "on-face", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onFace", faceId: "face-abc", uv: [1, 1] } },
      { id: "on-surface", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onSurface", solidId: "cylinder-1", uv: [0, 0.5] } }
    ]
    return document
  }

  const bindingOf = (document: ReturnType<typeof hostDocument>, id: string) =>
    (document.primitives.find((primitive) => primitive.id === id) as { binding: Record<string, unknown> }).binding

  it("accepts host, face and surface bindings", () => {
    expect(validateDocument(hostDocument())).toEqual({ valid: true })
  })

  it("rejects a host that is missing, of the wrong type, or has a non-finite parameter", () => {
    const missing = hostDocument()
    bindingOf(missing, "on-host").hostId = "nope"
    expect(validateDocument(missing).valid).toBe(false)

    const wrongType = hostDocument()
    bindingOf(wrongType, "on-host").hostId = "a"
    expect(validateDocument(wrongType).valid).toBe(false)

    const notFinite = hostDocument()
    bindingOf(notFinite, "on-host").parameter = Number.NaN
    expect(validateDocument(notFinite).valid).toBe(false)
  })

  it("rejects a surface binding that points at something that is not a round solid", () => {
    const wrongSolid = hostDocument()
    bindingOf(wrongSolid, "on-surface").solidId = "face-abc"
    expect(validateDocument(wrongSolid).valid).toBe(false)

    const badUv = hostDocument()
    bindingOf(badUv, "on-face").uv = [1, Number.POSITIVE_INFINITY]
    expect(validateDocument(badUv).valid).toBe(false)
  })
})
