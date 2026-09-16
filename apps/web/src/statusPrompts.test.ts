import { describe, expect, it } from "vitest"

import { resolveIntersectionPreviewPrompt, resolveStatusPrompt } from "./statusPrompts"

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
    // 条件不足时直接说明原因；没有预览时不发言（交给默认提示）。
    expect(resolveIntersectionPreviewPrompt({ kind: "insufficient", label: "", reason: "两组面之间没有交线。" }, false)).toBe("两组面之间没有交线。")
    expect(resolveIntersectionPreviewPrompt({ kind: "none", label: "" }, false)).toBeNull()
    expect(resolveIntersectionPreviewPrompt(null, false)).toBeNull()
  })
})
