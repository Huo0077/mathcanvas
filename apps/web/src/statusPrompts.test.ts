import { describe, expect, it } from "vitest"

import { resolveIntersectionPreviewPrompt, resolvePreviewInventoryPrompt, resolveStatusPrompt } from "./statusPrompts"

describe("status prompts", () => {
  it("describes the default selection workflow", () => {
    expect(resolveStatusPrompt({ mode: null, selectedCount: 0, selectedLabel: null, hasCenter: false, hasStart: false, pointCount: 0 })).toContain("点击图元查看属性")
    expect(resolveStatusPrompt({ mode: null, selectedCount: 1, selectedLabel: "直线_1", hasCenter: false, hasStart: false, pointCount: 0 })).toContain("已选中直线_1")
  })

  it("advances the line prompt from its first point to its second point", () => {
    expect(resolveStatusPrompt({ mode: "line", selectedCount: 0, selectedLabel: null, hasCenter: false, hasStart: false, pointCount: 0 })).toContain("第1步")
    expect(resolveStatusPrompt({ mode: "line", selectedCount: 0, selectedLabel: null, hasCenter: true, hasStart: false, pointCount: 0 })).toContain("第2步")
  })

  it("describes circle center and through-point stages", () => {
    expect(resolveStatusPrompt({ mode: "circle", selectedCount: 0, selectedLabel: null, hasCenter: false, hasStart: false, pointCount: 0 })).toContain("圆心")
    expect(resolveStatusPrompt({ mode: "circle", selectedCount: 0, selectedLabel: null, hasCenter: true, hasStart: false, pointCount: 0 })).toContain("通过点")
  })

  it("explains the 3D normal display", () => {
    const prompt = resolveStatusPrompt({ mode: null, selectedCount: 0, selectedLabel: null, hasCenter: false, hasStart: false, pointCount: 0, sceneControl: "normals" })

    expect(prompt).toContain("外法向量")
  })

  it("separates the sample angle display from a real face measurement", () => {
    const prompt = resolveStatusPrompt({ mode: null, selectedCount: 0, selectedLabel: null, hasCenter: false, hasStart: false, pointCount: 0, sceneControl: "dihedral-demo" })

    expect(prompt).toContain("示例值")
    expect(prompt).toContain("Alt")
    expect(prompt).toContain("二面角内角")
    expect(prompt).toContain("二面角外角")
  })

  it("keeps a creation step ahead of the scene control hint", () => {
    const prompt = resolveStatusPrompt({ mode: "line", selectedCount: 0, selectedLabel: null, hasCenter: false, hasStart: false, pointCount: 0, sceneControl: "normals" })

    expect(prompt).toContain("第1步")
  })

  /**
   * 用户反馈："动点（动点绑定）的内容完全没有提示，我也不知道如何将点固定到我创立的曲线或直线轨迹上面。"
   * 能力本来就有（属性栏「路径绑定」下拉 + 路径参数 + 记录轨迹），缺的是**说出来**：
   * 选中点时状态栏必须直接告诉他去哪绑定、绑定之后能做什么。
   */
  it("explains how to turn a selected point into a dynamic point", () => {
    const base = { mode: null, selectedCount: 1, selectedLabel: "点 A", hasCenter: false, hasStart: false, pointCount: 0 } as const

    const withPaths = resolveStatusPrompt({ ...base, pointBinding: { bound: false, hasPaths: true } })
    expect(withPaths).toContain("路径绑定")
    expect(withPaths).toContain("动点")

    // 还没有任何曲线/直线：先告诉他去画一条，而不是让他对着空下拉框发呆。
    const withoutPaths = resolveStatusPrompt({ ...base, pointBinding: { bound: false, hasPaths: false } })
    expect(withoutPaths).toContain("先画")
    expect(withoutPaths).toContain("路径绑定")
    // 这条也要出现"动点"这个词：用户的原话就是"不知道如何把点变成动点"。
    expect(withoutPaths).toContain("动点")

    // 已经绑定：说明三种等价用法（拖动 / 路径参数 / 记录轨迹）。
    const bound = resolveStatusPrompt({ ...base, pointBinding: { bound: true, hasPaths: true, pathLabel: "直线 1" } })
    expect(bound).toContain("动点")
    expect(bound).toContain("直线 1")
    expect(bound).toContain("路径参数")
    expect(bound).toContain("记录轨迹")
  })

  it("points at the path binding when a curve that can host a point is selected", () => {
    const prompt = resolveStatusPrompt({ mode: null, selectedCount: 1, selectedLabel: "直线 1", hasCenter: false, hasStart: false, pointCount: 0, pathSelected: true })

    expect(prompt).toContain("路径绑定")
    expect(prompt).toContain("动点")
  })

  it("describes the dashed intersection preview and its two levels", () => {
    // 选中两个对象：指针不在虚线上时提示"移到虚线上"，移上去后提示"点击即可创建"。
    expect(resolveIntersectionPreviewPrompt({ kind: "intersection", label: "面交线 · 1 段" }, false)).toContain("移到虚线上")
    expect(resolveIntersectionPreviewPrompt({ kind: "intersection", label: "面交线 · 1 段" }, true)).toContain("点击即可创建")
    // 单个实体给的是默认剖切平面截面：指针不在剖切面上时不抢状态栏（"已选中…"本身也是用户需要的信息），
    // 指上去才解释"点它即创建、之后怎么挪刀口"。
    expect(resolveIntersectionPreviewPrompt({ kind: "section", label: "默认剖切平面截面 · 4 边形" }, false)).toBeNull()
    const hovered = resolveIntersectionPreviewPrompt({ kind: "section", label: "默认剖切平面截面 · 4 边形" }, true)
    expect(hovered).toContain("点击即创建截面")
    expect(hovered).toContain("方向键")
    /**
     * 用户反馈："我需要的是交面、交线和交点，而不是创建对象之后中间出现一个大截面。"
     * 画布上那圈虚线是**交线**、圆点是**交点**，点出来的才是**交面**——这句提示要说清它们，
     * 否则用户看到虚线仍然不知道它是什么。
     */
    expect(hovered).toContain("交线")
    expect(hovered).toContain("交点")
    expect(hovered).toContain("交面")
    // 条件不足时直接说明原因；没有预览时不发言（交给默认提示）。
    expect(resolveIntersectionPreviewPrompt({ kind: "insufficient", label: "", reason: "两组面之间没有交线。" }, false)).toBe("两组面之间没有交线。")
    expect(resolveIntersectionPreviewPrompt({ kind: "none", label: "" }, false)).toBeNull()
    expect(resolveIntersectionPreviewPrompt(null, false)).toBeNull()
  })

  it("explains a 交面 preview as the boolean intersection, not as a cut", () => {
    // 交面是"两个实体公共区域的整体表面"，说法必须与截面（一刀切出来的）区分开。
    const idle = resolveIntersectionPreviewPrompt({ kind: "solid", label: "交面 · 6 面" }, false)
    expect(idle).toContain("交面")
    expect(idle).toContain("面片")

    const hovered = resolveIntersectionPreviewPrompt({ kind: "solid", label: "交面 · 6 面" }, true)
    expect(hovered).toContain("布尔交集")
    expect(hovered).toContain("点击即创建交面图元")
    // 交面预览上那条边就是交线、顶点就是交点：用户要的三样东西一次说全。
    expect(hovered).toContain("交线")
    expect(hovered).toContain("交点")
  })

  it("announces the automatically drawn intersections, because they no longer need a selection", () => {
    // 自动枚举之后，画布上有没有交线不再取决于选择：不说明就只剩一堆没人认识的虚线。
    expect(resolvePreviewInventoryPrompt({ lines: 2, solids: 1, truncated: 0, dropped: 0 })).toBe("已自动标出 2 处交线、1 处交面：点虚线创建交线图元，点半透明面片创建交面图元。")
    expect(resolvePreviewInventoryPrompt({ lines: 3, solids: 0, truncated: 0, dropped: 0 })).toContain("3 处交线")
    // 没有交线 / 交面就不打扰（否则每次进 3D 工作区都多一句废话）。
    expect(resolvePreviewInventoryPrompt({ lines: 0, solids: 0, truncated: 0, dropped: 0 })).toBeNull()
  })

  it("says what the sweep could not compute, and does not pretend a missing 交面 is a drawn 交线", () => {
    // 截断说明必须与事实相符：被配额挤掉的那一对可能**连交线都没有**（完全包含），
    // 所以不能说"只画了交线"——它只是"这次没算交面"。
    const capped = resolvePreviewInventoryPrompt({ lines: 2, solids: 1, truncated: 3, dropped: 0 })
    expect(capped).toContain("另有 3 处这次没算交面")
    expect(capped).not.toContain("只画了交线")

    // 连交线都没有、但确实少了一处交面：也必须说，不能静默。
    const onlyTruncated = resolvePreviewInventoryPrompt({ lines: 0, solids: 0, truncated: 1, dropped: 0 })
    expect(onlyTruncated).toContain("另有 1 处这次没算交面")

    // 超出单次扫描对数上限是另一回事：那几对连交线都没画，措辞要分开。
    const dropped = resolvePreviewInventoryPrompt({ lines: 4, solids: 2, truncated: 0, dropped: 5 })
    expect(dropped).toContain("5 处相交对超出单次扫描上限")
  })
})
