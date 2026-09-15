import { createDefaultCadLayout, createEmptyDocument } from "@draw/dsl"
import { beforeEach, describe, expect, it } from "vitest"

import { loadActiveWorkspace, loadDraft, loadWorkbenchPreferences, saveDraft, saveWorkbenchPreferences } from "./draftStorage"

describe("draft storage", () => {
  beforeEach(() => localStorage.clear())

  it("round-trips a workspace draft and active workspace", () => {
    const document = createEmptyDocument("conics")
    document.metadata.name = "草稿"

    saveDraft(document)

    expect(loadDraft("conics")?.metadata.name).toBe("草稿")
    expect(loadActiveWorkspace()).toBe("conics")
  })

  it("removes malformed drafts instead of breaking startup", () => {
    localStorage.setItem("mathcanvas:draft:calculus", "not-json")

    expect(loadDraft("calculus")).toBeNull()
    expect(localStorage.getItem("mathcanvas:draft:calculus")).toBeNull()
  })

  it("round-trips workbench preferences without touching the document draft", () => {
    saveWorkbenchPreferences({ treeTab: "layers", expandedIds: ["layer-geometry", "sheet-1"] })

    expect(loadWorkbenchPreferences()).toEqual({ treeTab: "layers", expandedIds: ["layer-geometry", "sheet-1"] })
  })

  it("falls back to safe preferences when stored workbench state is malformed", () => {
    localStorage.setItem("mathcanvas:workbench-preferences", "not-json")
    expect(loadWorkbenchPreferences()).toBeNull()

    localStorage.setItem("mathcanvas:workbench-preferences", JSON.stringify({ treeTab: "nope", expandedIds: [1, "sheet-1"] }))
    expect(loadWorkbenchPreferences()).toEqual({ treeTab: "model", expandedIds: ["sheet-1"] })
  })

  it("preserves the CAD layer, sheet and view layout through a draft round-trip", () => {
    const document = createDefaultCadLayout(createEmptyDocument("cad"))
    document.drawingViews = document.drawingViews?.map((view) => view.id === "view-front" ? { ...view, scale: 2.5 } : view)
    document.layers = document.layers?.map((layer) => layer.id === "layer-dimension" ? { ...layer, visible: false } : layer)
    document.activeLayerId = "layer-dimension"

    saveDraft(document)
    const restored = loadDraft("cad")

    expect(restored?.drawingViews?.find((view) => view.id === "view-front")?.scale).toBe(2.5)
    expect(restored?.layers?.find((layer) => layer.id === "layer-dimension")?.visible).toBe(false)
    expect(restored?.drawingSheets).toHaveLength(1)
    expect(restored?.activeLayerId).toBe("layer-dimension")
    expect(localStorage.getItem("mathcanvas:draft:cad")).toBeTruthy()
  })

  it("migrates a legacy CAD draft that has no layer or sheet layout", () => {
    const legacy = { format: "mgeo", formatVersion: "0.1", document: { ...createEmptyDocument("cad"), layers: undefined, drawingViews: undefined, drawingSheets: undefined } }
    localStorage.setItem("mathcanvas:draft:cad", JSON.stringify(legacy))

    const restored = loadDraft("cad")

    expect(restored?.layers?.map((layer) => layer.name)).toEqual(["几何", "尺寸", "辅助线", "注释"])
    expect(restored?.drawingViews?.map((view) => view.kind)).toEqual(["front", "top", "left", "axonometric"])
    expect(restored?.activeLayerId).toBe("layer-geometry")
  })
})
