import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

const USER_PROMPT = "在三棱锥 A-BCD 中，BD=2，△OCD为等边三角形，AB=AD，O为BD的中点，DE=2EA，平面ABD⊥平面BCD，二面角E-BC-D=45°。求证 OA⊥CD"

describe("parseDiagramObligations", () => {
  it("lists the original seven givens without turning a proposition into a given", () => {
    const parsed = parseDiagramObligations(USER_PROMPT)
    expect(parsed.givens.map(({ kind }) => kind)).toEqual([
      "fixedLength", "equilateral", "equalLength", "midpoint", "segmentRatio", "planePerpendicular", "dihedral"
    ])
    expect(parsed.givens.map(({ sourceText }) => sourceText)).toEqual([
      "BD=2", "△OCD为等边三角形", "AB=AD", "O为BD的中点", "DE=2EA", "平面ABD⊥平面BCD", "二面角E-BC-D=45°"
    ])
    expect(parsed.goals).toEqual(["OA⊥CD"])
    expect(parsed.unverified).toEqual([])
  })

  it("retains numeric values, named targets and traceable source ranges", () => {
    const parsed = parseDiagramObligations(USER_PROMPT)
    expect(parsed.givens[0]).toMatchObject({ kind: "fixedLength", targets: ["B", "D"], value: 2 })
    expect(parsed.givens[4]).toMatchObject({ kind: "segmentRatio", targets: ["D", "E", "E", "A"], value: 2 })
    expect(parsed.givens[6]).toMatchObject({ kind: "dihedral", targets: ["E", "B", "C", "D"], value: 45 })
    for (const item of parsed.givens) {
      expect(USER_PROMPT.slice(item.start, item.end)).toBe(item.sourceText)
    }
  })

  it("does not confuse an unrecognized geometric condition with an empty success", () => {
    const parsed = parseDiagramObligations("在三角形 ABC 中，∠ABC=60°，画出图形")
    expect(parsed.givens).toEqual([])
    expect(parsed.unverified).toEqual([{ sourceText: "∠ABC=60°", reason: expect.any(String) }])
  })

  it("flags unmatched conditions and invalid dimensions rather than dropping them", () => {
    const unsupported = parseDiagramObligations("在△ABC中，AB:AC=2，画出图形")
    expect(unsupported.givens).toEqual([])
    expect(unsupported.unverified.some(({ sourceText }) => sourceText.includes("AB:AC=2"))).toBe(true)

    const impossibleLength = parseDiagramObligations("在△ABC中，AB=0，画出图形")
    expect(impossibleLength.givens).toEqual([])
    expect(impossibleLength.unverified.some(({ sourceText }) => sourceText.includes("AB=0"))).toBe(true)
  })
  it("recognizes an explicitly free point as a choice, not an unverified condition", () => {
    const parsed = parseDiagramObligations("在三棱锥A-BCD中，BD=2，任取点A，画一张示意图")
    expect(parsed.givens.map((item) => item.sourceText)).toEqual(["BD=2"])
    expect(parsed.freeChoices).toEqual(["A"])
    expect(parsed.unverified).toEqual([])
  })
  it("surfaces unsupported geometric operators and a missing dihedral unit", () => {
    const parallelPlanes = parseDiagramObligations("在六面体 ABCDEF 中，平面ABC∥平面DEF，画出图形")
    expect(parallelPlanes.givens).toEqual([])
    expect(parallelPlanes.unverified.some((item) => item.sourceText.includes("平面ABC∥平面DEF"))).toBe(true)

    const missingUnit = parseDiagramObligations("在三棱锥 A-BCD 中，二面角E-BC-D=45，画出图形")
    expect(missingUnit.givens).toEqual([])
    expect(missingUnit.unverified.some((item) => item.sourceText.includes("二面角E-BC-D=45"))).toBe(true)
  })
  it("does not accept a prefix of an unsupported algebraic value as an exact given", () => {
    for (const expression of ["AB=1/2", "AB=2√3", "AB=AD+1", "DE=2EA/3"]) {
      const parsed = parseDiagramObligations(`在四棱锥P-ABCD中，${expression}，画示意图`)
      expect(parsed.givens, expression).toEqual([])
      expect(parsed.unverified.some((item) => item.sourceText.includes(expression)), expression).toBe(true)
    }
  })
  it("never drops the legacy equal-length spelling when the plan omits names", () => {
    const parsed = parseDiagramObligations("在四棱锥P-ABCD中，BC与AD等长，画示意图")
    expect(parsed.givens.length + parsed.unverified.length).toBeGreaterThan(0)
    expect([...parsed.givens.map((item) => item.sourceText), ...parsed.unverified.map((item) => item.sourceText)]).toContain("BC与AD等长")
  })
  it("surfaces common point-plane and collinearity language that has no supported judge yet", () => {
    for (const sentence of ["点A在平面BCD内", "A、B、C三点共线"]) {
      const parsed = parseDiagramObligations(`在四棱锥P-ABCD中，${sentence}，画示意图`)
      expect(parsed.givens.length + parsed.unverified.length, sentence).toBeGreaterThan(0)
    }
  })
  it("surfaces a bare 相等 phrasing that has no supported judge (由 benchmark 查出的，2026-10-05)", () => {
    // 原话来自 `scripts/agent-benchmark` 的 dynamic-request 用例。修前它**一个子句都没留下**：
    // 既没有给定义、也没有 residue —— 而这句话里明明有一个几何条件词（"相等"）。
    // 这与本文件上面那条纪律冲突：**新写法必须显形，不许把非空题面静默变成空通过**。
    const parsed = parseDiagramObligations("拖动这个正四面体的一个顶点，保持六条棱长始终相等")

    expect(parsed.givens.length + parsed.unverified.length).toBeGreaterThan(0)
    expect(parsed.unverified.some((item) => item.sourceText.includes("相等"))).toBe(true)
  })
  it("keeps ordinary explanations outside geometric condition coverage", () => {
    const parsed = parseDiagramObligations("比如画一张四棱锥 P-ABCD 的示意图")
    expect(parsed.givens).toEqual([])
    expect(parsed.unverified).toEqual([])
  })

  it("reads existing line-plane relations and leaves unrecognized targets visible", () => {
    const parsed = parseDiagramObligations("在四棱锥 P-ABCD 中，PA垂直平面ABCD，BC∥AD，画出示意图")
    expect(parsed.givens.map(({ kind }) => kind)).toEqual(["perpendicular", "parallel"])
    expect(parsed.unverified).toEqual([])
  })
})
