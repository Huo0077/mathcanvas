import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

/**
 * **「二面角 … 为 150°」**（2026-10-19，trig-23 现场）：原来的匹配器只认等号，
 * 题面写「为」就整句落进未核验。这里把「为」与「=」同等收下。
 */
describe("dihedral condition with 为", () => {
  it("parses 二面角C-AB-D为150°", () => {
    const parsed = parseDiagramObligations("二面角C-AB-D为150°")
    const dihedral = parsed.givens.find((given) => given.kind === "dihedral")

    expect(dihedral).toMatchObject({ kind: "dihedral", targets: ["C", "A", "B", "D"], value: 150 })
    expect(parsed.unverified.some((entry) => entry.sourceText.includes("二面角"))).toBe(false)
  })
})
