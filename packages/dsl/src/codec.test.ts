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
})
