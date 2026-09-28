import { describe, expect, it } from "vitest"

import { diagnoseLayout } from "@draw/agent-core"

import { DEFAULT_LABEL_SIZE, layoutFromLabelAnchors } from "./renderLayoutInput"

/**
 * **已投影的标签 → 布局盒子 → 诊断**（Phase 4 / Task 4.2，「标签叠加」这半条的收口）。
 *
 * 判据是**端到端的那一步**：真实的投影输出（`pointLabelPlacements` 的形状）喂进
 * `diagnoseLayout` 之后，能不能发现"两个标签叠在一起"。
 *
 * 只测换算、不测诊断，会漏掉最要紧的那种失败：两边各自都对，接起来却不产生判据。
 */
const viewport = { width: 800, height: 600 }
const anchor = (key: string, left: number, top: number, visible = true) => ({ key, visible, left, top })

describe("label anchors become layout boxes", () => {
  it("produces one label box per visible anchor", () => {
    const model = layoutFromLabelAnchors([anchor("p1", 100, 100), anchor("p2", 400, 300)], viewport)

    expect(model.viewport).toEqual(viewport)
    expect(model.boxes).toHaveLength(2)
    expect(model.boxes[0]).toMatchObject({ id: "p1#label", kind: "label", x: 100, y: 100, width: DEFAULT_LABEL_SIZE.width, height: DEFAULT_LABEL_SIZE.height })
  })

  it("leaves out anchors the projection marked invisible", () => {
    /**
     * `project()` 会把落在视锥外的点标成不可见，而**不可见的标签不会被画出来**。
     * 把它们算进"叠了"，是在报一个用户看不见的问题 —— 而这类误报会让人不再读诊断。
     */
    const model = layoutFromLabelAnchors([anchor("p1", 100, 100), anchor("p2", 100, 100, false)], viewport)

    expect(model.boxes.map((box) => box.id)).toEqual(["p1#label"])
  })

  it("finds a real overlap through the shared diagnostic", () => {
    // 两个锚点几乎重合（真实投影里就是"两个点在同一位置"）。
    const model = layoutFromLabelAnchors([anchor("p1", 300, 200), anchor("p2", 305, 202)], viewport)
    const diagnostics = diagnoseLayout(model.viewport, model.boxes)

    const overlap = diagnostics.find((entry) => entry.code === "label_overlap")
    expect(overlap, JSON.stringify(diagnostics)).toBeDefined()
    expect(overlap?.objectIds).toEqual(["p1#label", "p2#label"])
  })

  it("finds no overlap for labels that are far apart", () => {
    /**
     * 断言的是"**没有** `label_overlap`"，而不是"诊断为空"：
     * 本层只产出标签盒子，所以 `empty_canvas` 会**照旧**报出来（那是"没有对象盒子"，
     * 不是"标签没叠"）。要求整份诊断为空，等于要求这一层回答一个它没能力回答的问题。
     */
    const model = layoutFromLabelAnchors([anchor("p1", 100, 100), anchor("p2", 400, 300)], viewport)
    const codes = diagnoseLayout(model.viewport, model.boxes).map((entry) => entry.code)

    expect(codes).not.toContain("label_overlap")
  })

  it("does not report an empty canvas just because there are no object boxes", () => {
    /**
     * 这条记录一个**边界**：这一层只产出标签盒子，所以 `diagnoseLayout` 的
     * `empty_canvas` 会说"画布上没有可画的对象"。对**本层**而言那不是缺陷 ——
     * 它没有能力知道场景里有没有图形。
     *
     * 所以调这个函数的人**不能**把整份诊断当成"场景是不是空的"来用：
     * 对象盒子要由渲染层另外提供（见 `layoutModel.ts` 的 `buildLayoutModel`，那是候选文档的口径）。
     * 这条用例把该边界钉住，免得下一个人拿它去判空画布。
     */
    const model = layoutFromLabelAnchors([], viewport)
    const diagnostics = diagnoseLayout(model.viewport, model.boxes)

    expect(diagnostics.map((entry) => entry.code)).toEqual(["empty_canvas"])
  })

  it("accepts an explicit label size so a future real text measurement can replace the estimate", () => {
    // 尺寸是估算，不是测量；这里让它可以被换掉，而不是写死在两处。
    const model = layoutFromLabelAnchors([anchor("p1", 100, 100)], viewport, { width: 60, height: 20 })

    expect(model.boxes[0]).toMatchObject({ width: 60, height: 20 })
  })
})
