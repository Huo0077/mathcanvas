import { describe, expect, it } from "vitest"
import { parseAngleChains } from "./relationChains"

describe("relationChains — parseAngleChains", () => {
  it("splits multi-angle numeric chains with shared span and chainIndex", () => {
    const prompt = "已知三棱锥 A-BCD 中，∠ADB=∠ADC=60°，E 为 BC 中点"
    const chains = parseAngleChains(prompt)
    expect(chains).toHaveLength(1)
    const chain = chains[0]!
    expect(chain.ok).toBe(true)
    if (!chain.ok) throw new Error("expected ok chain")
    expect(chain.sourceText).toBe("∠ADB=∠ADC=60°")
    expect(prompt.slice(chain.start, chain.end)).toBe("∠ADB=∠ADC=60°")
    expect(chain.drafts).toEqual([
      { kind: "planarAngle", targets: ["A", "D", "B"], value: 60, chainIndex: 0 },
      { kind: "planarAngle", targets: ["A", "D", "C"], value: 60, chainIndex: 1 }
    ])
  })

  it("reads chained equalAngle without inventing numeric degrees", () => {
    const chains = parseAngleChains("若 ∠ADB=∠ADC，则")
    expect(chains).toHaveLength(1)
    expect(chains[0]).toMatchObject({
      ok: true,
      sourceText: "∠ADB=∠ADC",
      drafts: [{ kind: "equalAngle", targets: ["A", "D", "B", "A", "D", "C"] }]
    })
  })

  it("converts valid explicit radian values once to canonical degrees and rejects mixed/invalid chains", () => {
    const okRad = parseAngleChains("在△ABC中，∠ABC=2π/3 rad")
    expect(okRad[0]).toMatchObject({
      ok: true,
      drafts: [{ kind: "planarAngle", targets: ["A", "B", "C"], value: 120 }]
    })

    for (const invalid of [
      "∠ADB=",
      "∠ADB=∠ADC=",
      "∠ADB=AB",
      "AB=∠ADC=60°",
      "AB=60°",
      "∠ADB=60",
      "∠ADB=60 rad",
      "∠ADB=60°=π/3 rad",
      "∠ADB=0°",
      "∠ADB=180°",
      "∠ABA=60°",
      "sin∠ABC=0.5"
    ]) {
      const chains = parseAngleChains(invalid)
      expect(chains, invalid).toHaveLength(1)
      expect(chains[0]!.ok, invalid).toBe(false)
    }
  })
})
