import { describe, expect, it } from "vitest"

import { toScenePreview, toSectionScenePreview, toSelectionLineScenePreview } from "./threeScenePreview"
import type { IntersectionPreview3d } from "./intersectionPreviews3d"
import type { IntersectionPreview } from "./intersectionPreview3d"

const ZERO = { x: 0, y: 0, z: 0 }

const facePreview = (): IntersectionPreview3d => ({
  key: "pair:cube-a|cube-b:面0",
  kind: "face",
  sourceIds: ["cube-a", "cube-b"],
  segments: [],
  points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }],
  normal: { x: 0, y: 0, z: -1 },
  area: 0.5,
  hint: { x: 2 / 3, y: 1 / 3, z: 0 },
  position: ZERO,
  classification: "polyhedron",
  label: "交面 · 3 边形（面积 0.50）"
})

const linePreview = (): IntersectionPreview3d => ({
  key: "pair:cube-a|cube-b:线",
  kind: "intersection",
  sourceIds: ["cube-a", "cube-b"],
  segments: [{ a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }],
  points: [],
  normal: ZERO,
  area: 0,
  hint: ZERO,
  position: ZERO,
  classification: "polyline",
  label: "交线 · 1 段"
})

const pointPreview = (): IntersectionPreview3d => ({
  key: "pair:cube-a|cube-b:点0",
  kind: "point",
  sourceIds: ["cube-a", "cube-b"],
  segments: [],
  points: [],
  normal: ZERO,
  area: 0,
  hint: { x: 1, y: -2, z: 0 },
  position: { x: 1, y: -2, z: 0 },
  classification: "polyline",
  label: "交点"
})

describe("scene preview bridge", () => {
  it("carries a 交面 preview's single ring to the canvas and marks it focused only when its sources are selected", () => {
    const preview = toScenePreview(facePreview(), ["cube-a"])

    expect(preview.key).toBe("pair:cube-a|cube-b:面0")
    expect(preview.kind).toBe("face")
    expect(preview.points).toHaveLength(3)
    expect(preview.normal).toEqual({ x: 0, y: 0, z: -1 })
    expect(preview.area).toBe(0.5)
    // 形心会写进新图元的 `hint`：重算时按它认领同一面。
    expect(preview.hint).toEqual({ x: 2 / 3, y: 1 / 3, z: 0 })
    // 只选中一个来源不算"正在看这一对"，否则画布会出现两份看起来一样的高亮。
    expect(preview.focused).toBe(false)
    expect(toScenePreview(facePreview(), ["cube-a", "cube-b"]).focused).toBe(true)
    // 交面预览的线段是空的：它的边由面环画，交线是**另一份**独立预览。
    expect(preview.segments).toEqual([])
  })

  it("carries a 交线 preview's segments and a 交点 preview's position, and never confuses the kinds", () => {
    const line = toScenePreview(linePreview(), ["cube-a", "cube-b"])
    expect(line.kind).toBe("intersection")
    expect(line.segments).toHaveLength(1)
    expect(line.focused).toBe(true)
    expect(line.points).toEqual([])

    const point = toScenePreview(pointPreview(), [])
    expect(point.kind).toBe("point")
    expect(point.position).toEqual({ x: 1, y: -2, z: 0 })
    expect(point.segments).toEqual([])
    expect(point.focused).toBe(false)
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
