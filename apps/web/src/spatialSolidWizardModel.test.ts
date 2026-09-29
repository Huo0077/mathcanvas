import { describe, expect, it } from "vitest"

import { DEFAULT_SOLID_WIZARD_DRAFT, solidWizardInput } from "./spatialSolidWizardModel"

const origin = { x: 1, y: 2, z: 0 }

describe("teaching solid form model", () => {
  it("uses one edge length for all three cube dimensions", () => {
    expect(solidWizardInput({ ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "cube", origin, width: 4, depth: 2, height: 8 })).toEqual({ kind: "box", origin, size: { x: 4, y: 4, z: 4 } })
  })

  it("keeps three independent lengths for a rectangular box", () => {
    expect(solidWizardInput({ ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "box", origin, width: 4, depth: 3, height: 2 })).toEqual({ kind: "box", origin, size: { x: 4, y: 3, z: 2 } })
  })

  it("makes a triangular prism from three visible base vertices and an oblique extrusion", () => {
    expect(solidWizardInput({ ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "tri-prism", origin, width: 4, depth: 3, height: 5, offsetX: 1, offsetY: -2 })).toEqual({
      kind: "prism", base: [{ x: 1, y: 2, z: 0 }, { x: 5, y: 2, z: 0 }, { x: 3, y: 5, z: 0 }], vector: { x: 1, y: -2, z: 5 }
    })
  })

  it("uses an existing face's exact coordinates when that option is chosen", () => {
    const selectedBase = [{ x: 0, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }, { x: 2, y: 3, z: 1 }, { x: 0, y: 3, z: 1 }]
    expect(solidWizardInput({ ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "quad-prism", useSelectedBase: true }, selectedBase)).toEqual({ kind: "prism", base: selectedBase, vector: { x: 0, y: 0, z: 3 } })
  })

  it("puts the pyramid apex over the base centroid unless the offset is changed", () => {
    const draft = { ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "tri-pyramid" as const, origin, width: 4, depth: 3, height: 5, offsetX: 1, offsetY: -1 }
    expect(solidWizardInput(draft)).toEqual({ kind: "pyramid", base: [{ x: 1, y: 2, z: 0 }, { x: 5, y: 2, z: 0 }, { x: 3, y: 5, z: 0 }], apex: { x: 4, y: 2, z: 5 } })
  })

  it("does not reject a cube because hidden depth or height fields were edited earlier", () => {
    expect(solidWizardInput({ ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "cube", width: 4, depth: 0, height: 0 })).toEqual({ kind: "box", origin: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } })
  })

  it("does not validate hidden origin and footprint inputs when using a selected base", () => {
    const base = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 0, y: 2, z: 0 }]
    expect(solidWizardInput({ ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "tri-prism", origin: { x: NaN, y: 0, z: 0 }, width: 0, depth: 0, useSelectedBase: true }, base)).toEqual({ kind: "prism", base, vector: { x: 0, y: 0, z: 3 } })
  })
  it("reports missing base and invalid dimensions before any construction is attempted", () => {
    expect(solidWizardInput({ ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "tri-prism", useSelectedBase: true })).toHaveProperty("error")
    expect(solidWizardInput({ ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "box", width: 0 })).toHaveProperty("error")
  })
})