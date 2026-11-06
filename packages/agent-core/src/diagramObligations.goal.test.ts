import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

/**
 * **“则 …”后面是问题，不是题设**（2026-10-19，solid-3 现场）。
 *
 * 题面以「则SA=.」结尾（答案留空）。它不该作为一条必须核验的已知条件；
 * 否则整份图永远停在“未核验”，而实际上要画的题设已经满足。
 */
describe("goal clauses after 则", () => {
  it("does not treat 则SA=. as a given", () => {
    const parsed = parseDiagramObligations("SA⊥平面ABC,△ABC是边长为3的等边三角形,则SA=.")

    expect(parsed.unverified.some((entry) => entry.sourceText.includes("SA="))).toBe(false)
  })
})

it("keeps each numbered question's assumptions in its own scope", () => {
  const prompt = "四棱锥 P-ABCD 中，PA=2。① 若 AD⊥PB，试证明 AD∥平面 PBC；② 若 AD⊥DC，求 AD。"
  const parsed = parseDiagramObligations(prompt)
  expect(parsed.givens.map(given => given.sourceText)).toEqual(["PA=2"])
  expect(parsed.unverified).toEqual([expect.objectContaining({ sourceText: "各小问的条件" })])
  expect(parsed.parts?.map(part => part.obligations.givens.map(given => given.sourceText))).toEqual([
    ["PA=2", "AD⊥PB"],
    ["PA=2", "AD⊥DC"]
  ])
  expect(parsed.goals).toEqual(["AD∥平面 PBC；", "AD。"])
  for (const part of parsed.parts ?? []) {
    expect(prompt.slice(part.start, part.end)).toBe(part.text)
    for (const given of part.obligations.givens) {
      expect(prompt.slice(given.start, given.end)).toBe(given.sourceText)
    }
  }
})
