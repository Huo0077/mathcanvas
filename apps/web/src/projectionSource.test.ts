import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { hasProjectableGeometry, projectionEmptyMessage, projectionSourceHandles, resolveProjectionSource, resolveProjectionSourceEntity, resolveProjectionSourceLabels } from "./projectionSource"

describe("projection source", () => {
  it("treats a document with visible spatial objects as projectable", () => {
    expect(hasProjectableGeometry(null)).toBe(false)
    expect(hasProjectableGeometry(createEmptyDocument("cad"))).toBe(false)
    expect(hasProjectableGeometry({ ...createEmptyDocument("geometry3d"), primitives: [{ id: "point3-1", type: "point3", position: { x: 1, y: 2, z: 3 } }] })).toBe(true)
  })

  it("ignores hidden objects and planar-only documents", () => {
    const hidden = { ...createEmptyDocument("geometry3d"), primitives: [{ id: "point3-1", type: "point3" as const, position: { x: 1, y: 2, z: 3 }, visible: false }] }
    expect(hasProjectableGeometry(hidden)).toBe(false)
    // 二维图元不参与三维投影。
    const planar = { ...createEmptyDocument("cad"), primitives: [{ id: "point-1", type: "point" as const, x: 1, y: 2 }] }
    expect(hasProjectableGeometry(planar)).toBe(false)
  })

  it("explains which document is empty and points at the other one", () => {
    // 本图纸空、立体几何有模型：说明原因（这是最容易让人以为功能坏了的情况）。
    expect(projectionEmptyMessage("cad", false, true)).toContain("立体几何里已有模型")
    // 两份都空：保持原来的中性文案。
    expect(projectionEmptyMessage("cad", false, false)).toBe("暂无可投影的空间对象")
    expect(projectionEmptyMessage("cad", true, true)).toBe("暂无可投影的空间对象")
    // 已经切到立体几何：如果它也是空的，说清是它空。
    expect(projectionEmptyMessage("geometry3d", false, false)).toContain("立体几何工作区还没有可投影的对象")
    expect(projectionEmptyMessage("geometry3d", false, true)).toBe("暂无可投影的空间对象")
  })
})

/**
 * Task 0.6 Step 3：**显示与导出共用同一个来源选择**。
 *
 * 这组用例守的是一个实测缺陷：`EngineeringDrawingView` 按 `projectionSource` 选文档，
 * 而 `App` 生成导出内容时永远用当前工作区文档 —— 切到"投影立体几何"后，
 * 视图里是立方体、导出的文件里却是本图纸（往往为空）。选择逻辑现在只有一处。
 */
describe("projection source selection is shared by display and export", () => {
  function docs() {
    const layout = createEmptyDocument("cad")
    const spatial = createEmptyDocument("geometry3d")
    spatial.primitives = [{ id: "point3-1", type: "point3", position: { x: 1, y: 2, z: 3 } }]
    return { layout, spatial }
  }

  it("uses the layout document unless the spatial source is selected", () => {
    const { layout, spatial } = docs()

    expect(resolveProjectionSource("cad", layout, spatial).metadata.id).toBe(layout.metadata.id)
    expect(resolveProjectionSource("geometry3d", layout, spatial).metadata.id).toBe(spatial.metadata.id)
  })

  it("falls back to the layout document when the spatial source is missing", () => {
    const { layout } = docs()
    // 与显示侧历史行为一致：`geometry3d` 来源但没有空间文档时，看的是本图纸。
    expect(resolveProjectionSource("geometry3d", layout, null).metadata.id).toBe(layout.metadata.id)
  })

  it("keeps the two source documents distinguishable in the handles", () => {
    const { layout, spatial } = docs()
    const handles = projectionSourceHandles(layout, spatial, "project-1")

    // 同名 id 在两份文档里必须仍然可区分：这正是 Task 0.6 的起点。
    expect(handles.layout.documentId).not.toBe(handles.geometry.documentId)
    expect(handles.geometry.contentHash).not.toBe(handles.layout.contentHash)
  })
})

/**
 * Task 0.6 Step 3 后半：**来源解析也要在两份文档里找**。
 *
 * 守的是另一个实测缺陷：来源标签与检查器的"投影来源"过去只查布局文档，
 * 于是切到"投影立体几何"之后，看得见的空间对象会被标成"来源已删除"。
 */
describe("projection source entity resolution", () => {
  function docs() {
    const layout = { ...createEmptyDocument("cad"), primitives: [{ id: "point3-1", type: "point3" as const, position: { x: 0, y: 0, z: 0 }, label: "布局里的同名点" }] }
    const spatial = { ...createEmptyDocument("geometry3d"), primitives: [{ id: "point3-1", type: "point3" as const, position: { x: 1, y: 2, z: 3 }, label: "空间点 A" }] }
    return { layoutDocument: layout, spatialDocument: spatial }
  }

  it("finds a source that only exists in the spatial document", () => {
    const documents = docs()
    const spatialOnly = { ...createEmptyDocument("geometry3d"), primitives: [{ id: "point3-9", type: "point3" as const, position: { x: 4, y: 5, z: 6 }, label: "只在空间文档里的点" }] }

    // 只有空间文档里有它 —— 这正是"切到立体几何来源"时的常态。
    const resolved = resolveProjectionSourceEntity("point3-9", spatialOnly, { ...documents, spatialDocument: spatialOnly })
    expect(resolved).toEqual({ label: "只在空间文档里的点", missing: false })
  })

  it("prefers the document currently on screen when both documents define the same id", () => {
    const documents = docs()

    // 同名 id 同时存在：标签必须跟着眼前显示的那份走，否则用户会看到别人的名字。
    expect(resolveProjectionSourceEntity("point3-1", documents.spatialDocument, documents).label).toBe("空间点 A")
    expect(resolveProjectionSourceEntity("point3-1", documents.layoutDocument, documents).label).toBe("布局里的同名点")
  })

  it("still reports a genuinely deleted source as missing", () => {
    const documents = docs()

    // "看不见"与"被删了"是两件事：两份都没有才叫 missing。
    expect(resolveProjectionSourceEntity("point3-gone", documents.layoutDocument, documents)).toEqual({ label: "point3-gone", missing: true })
    expect(resolveProjectionSourceEntity("point3-gone", documents.spatialDocument, { ...documents, spatialDocument: null })).toEqual({ label: "point3-gone", missing: true })
  })

  it("builds the tree label table from the same resolution", () => {
    const documents = docs()
    const labels = resolveProjectionSourceLabels(["point3-1", "point3-gone"], documents.spatialDocument, documents)

    expect(labels).toEqual({ "point3-1": "空间点 A", "point3-gone": "point3-gone" })
  })
})