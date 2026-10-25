import { describe, expect, it } from "vitest"
import { parseObligationIR } from "../obligationIR"
import { foldHingeRatios } from "./foldRatios"

const host = new Set(["A", "B", "C", "D"])
const read = (prompt: string) => foldHingeRatios(parseObligationIR(prompt), host)

describe("fold construction ratios share parsed givens", () => {
  it.each(["AE:AD=2:5", "AE：AD=2：5", "AE : AD = 2 : 5", "AE=2/5 AD", "AD:AE=5:2"])("reads %s consistently", prompt => {
    expect(read(prompt).get("E")).toEqual({ from: "A", to: "D", parameter: 0.4 })
  })
  it("rejects out-of-segment and conflicting ratios instead of clamping or replacing them", () => {
    expect(read("AE:AD=3:2").has("E")).toBe(false)
    expect(read("AE:AD=2:5，AE:AD=1:2").has("E")).toBe(false)
    expect(read("AE:AD=2:5，AE:AB=2:5").has("E")).toBe(false)
    expect(read("AE:BD=2:5").has("E")).toBe(false)
    expect(read("AE:AD=1:2:3").has("E")).toBe(false)
  })
})
