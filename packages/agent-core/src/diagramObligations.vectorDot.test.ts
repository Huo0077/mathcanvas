import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

/**
 * **向量点积条件**（2026-10-19，trig-89 现场）：
 * `2AB·AO=|AB|²` 应当读成一条 `vectorDot`，而不是未核验残留。
 */
describe("vector dot obligation", () => {
  it("parses 2AB·AO=|AB|² with the two segment targets", () => {
    const parsed = parseDiagramObligations("2AB·AO=|AB|²")

    expect(parsed.givens).toContainEqual(expect.objectContaining({
      kind: "vectorDot",
      targets: ["A", "B", "A", "O", "A", "B"],
      value: 2
    }))
    expect(parsed.unverified.some((entry) => entry.sourceText.includes("AB"))).toBe(false)
  })
})
