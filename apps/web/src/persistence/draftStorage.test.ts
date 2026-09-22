import { createDefaultCadLayout, createEmptyDocument } from "@draw/dsl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadActiveWorkspace, loadDraft, loadWorkbenchPreferences, saveDraft, saveViewPreference3d, saveWorkbenchPreferences } from "./draftStorage"

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

  /**
   * 体检发现的真缺陷：只要 `decodeMgeo` 抛错就把草稿删掉。可**合法的 JSON 也可能解不出来**
   * （旧版本字段、校验更严的新版本、手工改坏的文档）——那是用户的工作，删掉就是静默的数据丢失。
   * 区分"根本不是 JSON"（垃圾，删）与"是文档但当前版本读不了"（保留）。
   */
  it("keeps a well-formed draft it cannot decode instead of deleting the user's work", () => {
    const legacy = { format: "mgeo", formatVersion: "0.1", document: { ...createEmptyDocument("conics"), revision: -1 } }
    localStorage.setItem("mathcanvas:draft:conics", JSON.stringify(legacy))

    expect(() => loadDraft("conics")).toThrow()
    // 原键挪到旁路键上保留：自动保存不会覆盖它，用户的工作还在。
    expect(localStorage.getItem("mathcanvas:draft:conics")).toBeNull()
    expect(JSON.parse(localStorage.getItem("mathcanvas:draft:conics:unreadable")!)).toEqual(legacy)
  })

  it("never throws out of a preference write when storage rejects the write", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("quota", "QuotaExceededError") })
    try {
      expect(() => saveWorkbenchPreferences({ treeTab: "layers", expandedIds: [] })).not.toThrow()
      expect(() => saveViewPreference3d({ autoFit: false })).not.toThrow()
      expect(() => saveDraft(createEmptyDocument("conics"))).not.toThrow()
    } finally {
      spy.mockRestore()
    }
  })

  /**
   * **存不下（配额）可以吞，编不出来（文档非法）必须抛**（Fix round 1，Reactive DAG worker 报的缺陷）。
   *
   * 原来两种失败共用一个 `catch {}`，于是"文档已经不合法、`encodeMgeo` 抛错"这条路径
   * 被当成"存不下"静默吞掉：画布上是新内容、磁盘上还是旧的，用户看不到任何提示
   *（`App.tsx` 那层 `try/catch` 因此永远收不到这个错误）。
   */
  it("surfaces an unencodable document instead of swallowing it like a quota error", () => {
    const broken = createEmptyDocument("geometry3d")
    // `y = 0` 的立方体在 DSL 里非法（尺寸必须为正）→ `encodeMgeo` 会抛。
    broken.primitives = [{ id: "cube-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 0, z: 2 } }] as never

    expect(() => saveDraft(broken)).toThrow()
    // 抛了就不该留下半份"看起来存过了"的草稿。
    expect(localStorage.getItem("mathcanvas:draft:geometry3d")).toBeNull()
  })

  it("never reopens the retired calculus workspace from a stored preference", () => {
    localStorage.setItem("mathcanvas:active-workspace", "calculus")

    // The workspace is retired, so a stale preference must not drag the app back into it on startup.
    expect(loadActiveWorkspace()).toBeNull()
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
