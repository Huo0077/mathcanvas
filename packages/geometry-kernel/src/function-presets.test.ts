import { describe, expect, it } from "vitest"

import { compileExpression, evaluateCompiledExpression } from "./expression"
import { functionPresets, getFunctionPreset } from "./function-presets"

describe("function presets", () => {
  it("compiles every built-in preset", () => {
    for (const preset of functionPresets) expect(() => compileExpression(preset.expression)).not.toThrow()
  })

  it("provides categorized defaults and evaluates a composite preset", () => {
    const preset = getFunctionPreset("damped-cosine")
    expect(preset?.category).toBe("composite")
    expect(preset?.defaultDomain).toEqual([0, 20])
    expect(evaluateCompiledExpression(compileExpression(preset!.expression), { x: 0 })).toBeCloseTo(1)
  })

  it("uses classroom-friendly notation for the exponential preset", () => {
    expect(getFunctionPreset("exponential")?.expression).toBe("e^x")
    expect(evaluateCompiledExpression(compileExpression("e^x"), { x: 1 })).toBeCloseTo(Math.E)
  })
})
