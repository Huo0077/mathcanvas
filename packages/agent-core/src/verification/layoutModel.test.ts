import { describe, expect, it } from "vitest"

import { buildLayoutModel, DEFAULT_LAYOUT_MODEL_OPTIONS, LAYOUT_MODEL_LIMITATIONS } from "./layoutModel"
import { diagnoseLayout } from "./renderEvidence"

/**
 * **文档 → 屏幕盒子**（Phase 4 / Task 4.2）。
 *
 * 判据是**确定性**：同一份文档永远得到同一组读数，而且屏幕 y 的方向是对的。
 * 后者看着像细节，但它错了会让"上方出界"被报成"下方出界" ——
 * 读数上完全看不出区别（都是 `clipped_object`），所以必须有一条用例钉住。
 */

/** 棱长 2、以原点为中心的立方体：8 个顶点 + 一个带 vertexIds 的多面体。 */
function cubeDocument() {
  const corners = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
  ]
  return {
    primitives: [
      { id: "cube-1", type: "polyhedron3", label: "立方体", vertexIds: corners.map((_, index) => `cube-1:v${index}`) },
      ...corners.map(([x, y, z], index) => ({ id: `cube-1:v${index}`, type: "point3", position: { x, y, z } }))
    ]
  }
}

describe("document to screen boxes", () => {
  it("produces one object box per readable entity and centres the content", () => {
    const model = buildLayoutModel(cubeDocument())

    const objects = model.boxes.filter((box) => box.kind === "object")
    // 8 个顶点 + 1 个多面体（多面体与它的顶点重合，但仍然各自占一个盒子）。
    expect(objects).toHaveLength(9)
    expect(objects.some((box) => box.id === "cube-1")).toBe(true)

    const cube = objects.find((box) => box.id === "cube-1")!
    // 棱长 2 × 60 px/单位 = 120 px。
    expect(cube.width).toBeCloseTo(120, 5)
    expect(cube.height).toBeCloseTo(120, 5)
    // 居中：左右留白相等，上下留白相等。
    expect(cube.x).toBeCloseTo(model.viewport.width - (cube.x + cube.width), 5)
    expect(cube.y).toBeCloseTo(model.viewport.height - (cube.y + cube.height), 5)
  })

  it("flips the screen y axis so world-up is screen-up", () => {
    /**
     * 两个点：一个在世界坐标 y = +1（上），一个在 y = -1（下）。
     * 数学 y 向上、屏幕 y 向下，所以上方那个点的屏幕 y **必须更小**。
     * 不取反的话这条会红 —— 而它在 `clipped_object` 的读数上完全看不出来。
     */
    const model = buildLayoutModel({ primitives: [
      { id: "high", type: "point3", position: { x: 0, y: 1, z: 0 } },
      { id: "low", type: "point3", position: { x: 0, y: -1, z: 0 } }
    ] })

    const high = model.boxes.find((box) => box.id === "high")!
    const low = model.boxes.find((box) => box.id === "low")!
    expect(high.y).toBeLessThan(low.y)
  })

  it("adds a label box only for entities that actually carry a label", () => {
    const labelled = buildLayoutModel({
      primitives: [
        { id: "p1", type: "point", x: 0, y: 0, label: "A" },
        { id: "p2", type: "point", x: 5, y: 0 }
      ]
    })

    expect(labelled.boxes.filter((box) => box.kind === "label").map((box) => box.id)).toEqual(["p1#label"])
  })

  it("skips entities it cannot locate instead of inventing coordinates for them", () => {
    // 读不出位置的图元被跳过（漏报），不会被编一个盒子出来 —— 编出来的盒子会让
    // "布局没问题"这句话来源不明。
    const model = buildLayoutModel({ primitives: [{ id: "mystery", type: "circle3" }] })

    expect(model.boxes).toEqual([])
    expect(model.viewport).toEqual({ width: 0, height: 0 })
  })

  it("keeps a degenerate viewport out of the layout verdict path", () => {
    // 文档里一个位置都读不出来 → 视口退化 → 只报这一条，不报"所有对象都出界"。
    const model = buildLayoutModel({ primitives: [{ id: "mystery", type: "circle3" }] })
    const diagnostics = diagnoseLayout(model.viewport, model.boxes)

    expect(diagnostics.map((entry) => entry.code)).toEqual(["degenerate_viewport"])
  })

  it("finds no layout problem in a well-framed document", () => {
    // 端到端的那一步：这份文档投影后**真的**是干净的（不是"没检查"）。
    const model = buildLayoutModel(cubeDocument())
    const diagnostics = diagnoseLayout(model.viewport, model.boxes)

    expect(diagnostics).toEqual([])
  })

  it("reports an overlap when two labelled points sit on top of each other", () => {
    /**
     * 两个标签叠在一起时**必须**被发现 —— 这是"纯本地视觉判据"存在意义的最小证明。
     * 两个点相距极近（0.02 单位 ≈ 1.2 px），标签盒子（28×14 px）必然重叠。
     */
    const model = buildLayoutModel({
      primitives: [
        { id: "p1", type: "point", x: 0, y: 0, label: "A" },
        { id: "p2", type: "point", x: 0.02, y: 0, label: "B" }
      ]
    })
    const diagnostics = diagnoseLayout(model.viewport, model.boxes)

    const overlap = diagnostics.find((entry) => entry.code === "label_overlap")
    expect(overlap, JSON.stringify(diagnostics)).toBeDefined()
    expect(overlap?.objectIds).toEqual(["p1#label", "p2#label"])
  })

  it("states its limitations as data, not only as prose", () => {
    // 这三条局限是这一层的定位。写成常量后，接线到真实渲染器的人能直接读出来。
    expect(LAYOUT_MODEL_LIMITATIONS).toHaveLength(3)
    expect(LAYOUT_MODEL_LIMITATIONS.join(" ")).toContain("orthographic")
    expect(DEFAULT_LAYOUT_MODEL_OPTIONS.pixelsPerUnit).toBeGreaterThan(0)
  })
})
