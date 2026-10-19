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
