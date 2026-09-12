import { describe, expect, it } from "vitest"

import { createDemoDocument } from "../demoDocument"
import { loadMgeo, saveMgeo } from "./mgeoStorage"

describe("mgeo storage helpers", () => {
  it("round-trips the workbench document", () => {
    const restored = loadMgeo(saveMgeo(createDemoDocument()))
    expect(restored.primitives.some((primitive) => primitive.id === "intersection-main")).toBe(true)
  })
})
