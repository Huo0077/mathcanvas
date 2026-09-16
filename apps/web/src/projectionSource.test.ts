import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { hasProjectableGeometry, projectionEmptyMessage } from "./projectionSource"

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
