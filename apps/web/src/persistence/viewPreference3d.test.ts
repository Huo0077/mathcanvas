import { beforeEach, describe, expect, it } from "vitest"

import { loadViewPreference3d, saveViewPreference3d } from "./draftStorage"

describe("3D view preference", () => {
  beforeEach(() => localStorage.clear())

  it("defaults to auto-fit on", () => {
    expect(loadViewPreference3d()).toEqual({ autoFit: true })
  })

  it("round-trips the toggle", () => {
    saveViewPreference3d({ autoFit: false })
    expect(loadViewPreference3d()).toEqual({ autoFit: false })

    saveViewPreference3d({ autoFit: true })
    expect(loadViewPreference3d()).toEqual({ autoFit: true })
  })

  it("falls back to the default and clears a corrupt value", () => {
    localStorage.setItem("mathcanvas:3d-view", "{not json")

    expect(loadViewPreference3d()).toEqual({ autoFit: true })
    expect(localStorage.getItem("mathcanvas:3d-view")).toBeNull()
  })
})
