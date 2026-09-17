import { describe, expect, it } from "vitest"

import { toScenePreview, toSectionScenePreview, toSelectionLineScenePreview } from "./threeScenePreview"
import type { IntersectionPreview3d } from "./intersectionPreviews3d"
import type { IntersectionPreview } from "./intersectionPreview3d"

const solidPreview = (): IntersectionPreview3d => ({
  key: "pair:cube-a|cube-b:面",
  kind: "solid",
  sourceIds: ["cube-a", "cube-b"],
  segments: [],
  vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }],
  faces: [[0, 1, 2]],
  volume: 3,
  area: 1.5,
  classification: "polyhedron",
  label: "交面 · 3 面"
})

const linePreview = (): IntersectionPreview3d => ({
  key: "pair:cube-a|cube-b:线",
  kind: "intersection",
  sourceIds: ["cube-a", "cube-b"],
  segments: [{ a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }],
  vertices: [],
  faces: [],
  volume: 0,
  area: 0,
  classification: "polyline",
  label: "交线 · 1 段"
})

describe("scene preview bridge", () => {
  it("carries a 交面 preview's geometry to the canvas and marks it focused only when its sources are selected", () => {
    const preview = toScenePreview(solidPreview(), ["cube-a"])

    expect(preview.key).toBe("pair:cube-a|cube-b:面")
    expect(preview.kind).toBe("solid")
    expect(preview.vertices).toHaveLength(3)
    expect(preview.faces).toEqual([[0, 1, 2]])
    expect(preview.volume).toBe(3)
    expect(preview.area).toBe(1.5)
    // 只选中一个来源不算"正在看这一对"，否则画布会出现两份看起来一样的高亮。
    expect(preview.focused).toBe(false)
    expect(toScenePreview(solidPreview(), ["cube-a", "cube-b"]).focused).toBe(true)
    // 交面预览的线段是空的：它的边由面环画，交线是**另一份**独立预览。
    expect(preview.segments).toEqual([])
  })

  it("carries a 交线 preview's segments and never confuses the two kinds", () => {
    const preview = toScenePreview(linePreview(), ["cube-a", "cube-b"])

    expect(preview.kind).toBe("intersection")
    expect(preview.segments).toHaveLength(1)
    expect(preview.focused).toBe(true)
    expect(preview.vertices ?? []).toEqual([])
  })

  it("turns a selected solid's section preview into a canvas preview, and nothing else", () => {
    const section: IntersectionPreview = {
      kind: "section",
      sourceIds: ["cube-a"],
      segments: [],
      points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }],
      classification: "polygon",
      label: "默认剖切平面截面 · 3 边形",
      plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 },
      sourceId: "cube-a"
    }

    const preview = toSectionScenePreview(section)
    // key 用来源实体命名：同一个实体反复选中只重建一次预览。
    expect(preview?.key).toBe("section:cube-a")
    expect(preview?.kind).toBe("section")
    expect(preview?.sourceId).toBe("cube-a")
    expect(preview?.points).toHaveLength(3)
    expect(preview?.focused).toBe(true)

    // 交线 / 交面 / 条件不足 / 空：都不产生截面预览（否则会多画一圈不该有的虚线）。
    expect(toSectionScenePreview({ ...section, kind: "intersection" })).toBeNull()
    expect(toSectionScenePreview({ ...section, kind: "insufficient", reason: "平面没有边界" })).toBeNull()
    expect(toSectionScenePreview(null)).toBeNull()
  })

  it("turns a selection-driven face intersection into a canvas preview that the automatic sweep cannot cover", () => {
    const line: IntersectionPreview = {
      kind: "intersection",
      sourceIds: ["cube-b", "face-1"],
      segments: [{ a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }],
      points: [],
      classification: "segment",
      label: "交线 · 1 段"
    }

    const preview = toSelectionLineScenePreview(line)
    // key 与自动预览同一套命名（来源 id 排序）：两个实体都选中时按 key 去重，不会画两遍。
    expect(preview?.key).toBe("pair:cube-b|face-1:线")
    expect(preview?.kind).toBe("intersection")
    expect(preview?.segments).toHaveLength(1)
    expect(preview?.focused).toBe(true)

    // 没有线段就没有可点的东西：不能给一份空预览（状态栏会因此说"点击即可创建"却点不到）。
    expect(toSelectionLineScenePreview({ ...line, segments: [] })).toBeNull()
    expect(toSelectionLineScenePreview({ ...line, kind: "section" })).toBeNull()
    expect(toSelectionLineScenePreview(null)).toBeNull()
  })
})
