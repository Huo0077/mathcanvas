import { beforeEach, describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { createDemoDocument } from "./demoDocument"
import { MAX_HISTORY_ENTRIES, useSceneStore, withDocumentLayout } from "./store"

describe("workbench preferences in the scene store", () => {
  beforeEach(() => localStorage.clear())

  it("keeps the active tree tab and expanded nodes out of the document", () => {
    useSceneStore.getState().setTreeTab("layers")
    useSceneStore.getState().toggleExpanded("layer-geometry")

    const state = useSceneStore.getState()
    expect(state.treeTab).toBe("layers")
    expect(state.expandedIds).toContain("layer-geometry")
    expect(JSON.stringify(state.document)).not.toContain("layer-geometry")
    expect(JSON.parse(localStorage.getItem("mathcanvas:workbench-preferences") ?? "{}")).toEqual({ treeTab: "layers", expandedIds: state.expandedIds })
  })

  it("drops expanded nodes when they are toggled twice", () => {
    useSceneStore.getState().toggleExpanded("layer-temporary")
    useSceneStore.getState().toggleExpanded("layer-temporary")

    expect(useSceneStore.getState().expandedIds).not.toContain("layer-temporary")
  })
})

describe("CAD document layout normalisation", () => {
  it("gives CAD documents the default layers, sheet and four views", () => {
    const cad = withDocumentLayout({ ...createDemoDocument(), workspace: "cad" })

    expect(cad.layers?.map((layer) => layer.name)).toEqual(["几何", "尺寸", "辅助线", "注释"])
    expect(cad.drawingSheets).toHaveLength(1)
    expect(cad.drawingViews?.map((view) => view.kind)).toEqual(["front", "top", "left", "axonometric"])
    expect(cad.activeLayerId).toBe("layer-geometry")
    expect(cad.activeSheetId).toBe("sheet-1")
  })

  it("leaves planar documents untouched", () => {
    const planar = createDemoDocument()
    expect(withDocumentLayout(planar).layers).toBeUndefined()
  })
})

describe("scene store document replacement", () => {
  it("keeps documents cached for other workspaces so switching back preserves in-session work", () => {
    useSceneStore.getState().replace(createDemoDocument())
    useSceneStore.getState().switchWorkspace("geometry3d")
    useSceneStore.getState().apply({
      op: "addPrimitive",
      primitive: { id: "point3-a", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "free" } }
    })
    useSceneStore.getState().switchWorkspace("conics")

    useSceneStore.getState().replace({ ...createDemoDocument(), metadata: { ...createDemoDocument().metadata, name: "opened" } })

    expect(useSceneStore.getState().document.workspace).toBe("conics")
    expect(useSceneStore.getState().workspaceDocuments.geometry3d?.primitives).toHaveLength(1)
    expect(useSceneStore.getState().workspaceDocuments.conics?.metadata.name).toBe("opened")
  })

  it("caps undo history while retaining the newest document snapshots", () => {
    useSceneStore.getState().replace(createDemoDocument())

    for (let index = 0; index < MAX_HISTORY_ENTRIES + 1; index += 1) {
      useSceneStore.getState().apply({ op: "setParameter", id: "slope", value: 0.15 + (index % 15) * 0.05 })
    }

    expect(useSceneStore.getState().history).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(useSceneStore.getState().document.parameters.slope?.value).toBeCloseTo(0.65)

    for (let index = 0; index < MAX_HISTORY_ENTRIES; index += 1) useSceneStore.getState().undo()

    expect(useSceneStore.getState().history).toHaveLength(0)
    expect(useSceneStore.getState().document.parameters.slope?.value).toBeCloseTo(0.15)
  })
})

/** Task 0.4：整批提交必须**只占一步撤销**，且批量删除与顺序无关。 */
describe("batch transactions", () => {
  it("keeps one undo step for a whole batch and deletes a union in any order", () => {
    const document = createEmptyDocument("conics")
    useSceneStore.setState({ document, workspaceDocuments: { [document.workspace]: document }, history: [], future: [], error: null })

    useSceneStore.getState().applyBatch([
      { op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0 } },
      { op: "addPrimitive", primitive: { id: "point-2", type: "point", x: 1, y: 0 } }
    ])
    // 整批 → 历史只多一步（以前循环 apply 会压两步）
    expect(useSceneStore.getState().history).toHaveLength(1)
    expect(useSceneStore.getState().document.primitives).toHaveLength(2)

    useSceneStore.getState().applyBatch([{ op: "deleteObjects", ids: ["point-2", "point-1"] }])
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)

    useSceneStore.getState().undo()
    expect(useSceneStore.getState().document.primitives).toHaveLength(2)
  })

  it("leaves history untouched when the batch changes nothing", () => {
    const document = createEmptyDocument("conics")
    const withPoint = { ...document, primitives: [{ id: "point-1", type: "point" as const, x: 0, y: 0 }] }
    useSceneStore.setState({ document: withPoint, workspaceDocuments: { [withPoint.workspace]: withPoint }, history: [], future: [], error: null })

    // 本来就是可见的：整批没有语义变化，不该占一步撤销。
    useSceneStore.getState().applyBatch([{ op: "toggleVisibility", id: "point-1", visible: true }])
    expect(useSceneStore.getState().history).toHaveLength(0)
  })
})

/**
 * **Agent 提交的候选"内容变了、revision 没变"，也必须落地**（2026-09-21 的真实缺陷）。
 * 那份候选来自 `commitTransaction`，而它**不推进 `revision`** —— 推进 revision 的是这里的
 * `apply` / `applyBatch`。于是 `commitCandidate` 原先那条"revision + id 相同就算没变"的守卫
 * 会把一次真实的提交**静默丢掉**：确认面板说"已提交"，画布上却什么都没有；而自动保存
 * 把那份没变的空文档写回了本地草稿（实测：`revision: 0` + `primitives: []`）。
 */
describe("committing a candidate the agent built", () => {
  it("lands even when the candidate carries the base revision, and advances it", () => {
    const base = createEmptyDocument("geometry3d")
    useSceneStore.setState({ document: base, workspaceDocuments: { [base.workspace]: base }, history: [], future: [], error: null })

    // 先用一次**真实**改动造出"内容变了"的文档，再把 revision 调回基准值 ——
    // 这正是 `commitTransaction` 交出来的形状。
    useSceneStore.getState().apply({ op: "addPrimitive", primitive: { id: "point3-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } } })
    const grown = useSceneStore.getState().document
    useSceneStore.setState({ document: base, workspaceDocuments: { [base.workspace]: base }, history: [], future: [], error: null })

    useSceneStore.getState().commitCandidate({ ...grown, revision: base.revision })

    expect(useSceneStore.getState().document.primitives).toHaveLength(1)
    // revision 必须**推进**：否则撤销栈、仓储的 generation 与 CAS 全都停在原地。
    expect(useSceneStore.getState().document.revision).toBeGreaterThan(base.revision)
    expect(useSceneStore.getState().history).toHaveLength(1)
  })

  it("still treats a real no-op as a no-op and does not push history", () => {
    const base = createEmptyDocument("geometry3d")
    useSceneStore.setState({ document: base, workspaceDocuments: { [base.workspace]: base }, history: [], future: [], error: null })

    useSceneStore.getState().commitCandidate({ ...base })

    expect(useSceneStore.getState().history).toHaveLength(0)
    expect(useSceneStore.getState().document.revision).toBe(base.revision)
  })
})