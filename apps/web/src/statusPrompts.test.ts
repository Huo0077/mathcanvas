import { describe, expect, it } from "vitest"

import { resolveStatusPrompt } from "./statusPrompts"

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
})
