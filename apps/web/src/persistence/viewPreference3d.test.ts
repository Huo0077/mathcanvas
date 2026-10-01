import { beforeEach, describe, expect, it } from "vitest"

import { loadViewPreference3d, saveViewPreference3d } from "./draftStorage"

describe("3D view preference", () => {
  beforeEach(() => localStorage.clear())

  it("defaults to auto-fit on and the rotation rings off", () => {
    expect(loadViewPreference3d()).toEqual({ autoFit: true, showRotationHandles: false })
  })

  it("round-trips both toggles", () => {
    saveViewPreference3d({ autoFit: false, showRotationHandles: true })
    expect(loadViewPreference3d()).toEqual({ autoFit: false, showRotationHandles: true })

    saveViewPreference3d({ autoFit: true, showRotationHandles: false })
    expect(loadViewPreference3d()).toEqual({ autoFit: true, showRotationHandles: false })
  })

  it("treats a stored value from before the ring switch as off", () => {
    /**
     * 旧数据里根本没有这个字段。默认必须是**关**（"没点过就不显示环"），
     * 不能因为"读不出来"就顺手把环打开 —— 那正好是用户要消灭的那三个环。
     */
    localStorage.setItem("mathcanvas:3d-view", JSON.stringify({ autoFit: false }))

    expect(loadViewPreference3d()).toEqual({ autoFit: false, showRotationHandles: false })
  })

  it("only an explicit true turns the rings on", () => {
    localStorage.setItem("mathcanvas:3d-view", JSON.stringify({ autoFit: true, showRotationHandles: "yes" }))

    expect(loadViewPreference3d()).toEqual({ autoFit: true, showRotationHandles: false })
  })

  it("falls back to the default and clears a corrupt value", () => {
    localStorage.setItem("mathcanvas:3d-view", "{not json")

    expect(loadViewPreference3d()).toEqual({ autoFit: true, showRotationHandles: false })
    expect(localStorage.getItem("mathcanvas:3d-view")).toBeNull()
  })
})
