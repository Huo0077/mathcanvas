import { describe, expect, it } from "vitest"

import { createEmptyDocument, decodeMgeo, encodeMgeo } from "./index"

describe("Geometry DSL codec", () => {
  it("round-trips a versioned document with stable metadata", () => {
    const document = createEmptyDocument("calculus")
    const restored = decodeMgeo(encodeMgeo(document))

    expect(restored.schemaVersion).toBe("0.1")
    expect(restored.workspace).toBe("calculus")
    expect(restored.revision).toBe(0)
    expect(restored.metadata.id).toBe(document.metadata.id)
  })

  it("round-trips a segment primitive", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [{ id: "segment-1", type: "segment", a: { x: -1, y: 2 }, b: { x: 3, y: 4 } }]

    expect(decodeMgeo(encodeMgeo(document)).primitives[0]).toEqual(document.primitives[0])
  })
})
