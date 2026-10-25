import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"
import { buildFoldChain } from "./foldChain"

const BASE = "平面四边形ABCD中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°。点E,F满足AE=2/5 AD，AF=1/2 AB。"
function plan(angle?: number): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "fold", factIds: [],
    actions: [
      { actionId: "solid.create_face", actionKey: "base", factIds: [], inputs: {
        alias: "base", vertexNames: ["A", "B", "C", "D"],
        vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 9, y: Math.sqrt(3), z: 0 }, { x: 7.5, y: 2.5 * Math.sqrt(3), z: 0 }]
      } },
      ...(angle === undefined ? [] : [{ actionId: "solid.fold" as const, actionKey: "flap", factIds: [], inputs: {
        alias: "flap", vertexNames: ["A", "E", "F"], apex: "A", apexAs: "P", hinge: { from: "E", to: "F" }, angle,
        vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: Math.sqrt(3), z: 0 }, { x: 4, y: 0, z: 0 }]
      } }])
    ]
  }
}
function compile(input: PlanEnvelope) {
  return compilePlan(input, { document: createEmptyDocument("geometry3d"), conversationId: "fold-completeness", documentGeneration: 0, prompt: BASE + "将△AEF沿EF翻折30°至△PEF。" })
}

describe("fold completeness", () => {
  it("verifies a motion even when the prompt has no ordinary numeric obligations", () => {
    const input: PlanEnvelope = {
      schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "fold points", factIds: [],
      actions: [
        { name: "A", position: { x: 0, y: 1, z: 0 } }, { name: "E", position: { x: 0, y: 0, z: 0 } }, { name: "F", position: { x: 1, y: 0, z: 0 } }
      ].map(({ name, position }) => ({ actionId: "solid.create_point" as const, actionKey: name, factIds: [], inputs: { alias: name, label: name, position } }))
    }
    const result = compilePlan(input, { document: createEmptyDocument("geometry3d"), conversationId: "pure-fold", documentGeneration: 0, prompt: "将△AEF沿EF翻折30°至△PEF。" })
    expect(result.diagramVerification?.checks.some(c => c.kind === "fold")).toBe(true)
    if (result.ok) expect(result.draftDocument?.primitives.some(p => p.type === "point3" && p.label === "P")).toBe(true)
  })
  it("constructs the missing folded point rather than accepting only the correct base", () => {
    const result = compile(plan())
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.draftDocument?.primitives.some(p => p.type === "point3" && p.label === "P")).toBe(true)
  })
  it("never verifies a 90 degree fold against an explicit 30 degree requirement", () => {
    const result = compile(plan(90))
    const check = result.diagramVerification?.checks.find(c => c.kind === "fold" && c.expected === 30)
    expect(check).toBeDefined()
    if (result.ok) expect(check?.actual).toBeCloseTo(30, 3)
    else expect(result.diagramVerification?.status).not.toBe("passed")
  })
  it("checks a correct fold from final geometry", () => {
    const result = compile(plan(30))
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.diagramVerification?.checks.some(c => c.kind === "fold" && c.expected === 30 && c.status === "passed")).toBe(true)
  })
})

describe("fold clause binding", () => {
  it("does not treat reuse of an output name as an input dependency", () => {
    const chain = buildFoldChain("将△AEF沿EF翻折90°至△PEF，将△BCD沿CD翻折60°至△PCD")
    expect(chain.status).toBe("unsupported")
    if (chain.status === "unsupported") expect(chain.reason).toBe("reference_not_chained")
  })
  it("keeps mixed sentence forms in source order", () => {
    const chain = buildFoldChain("先将△AEF沿EF翻折90°，使点A到达点P，再将△PEF沿PF翻折60°至△QPF")
    expect(chain.status).toBe("sequential_resolvable")
    if (chain.status === "sequential_resolvable") {
      expect(chain.steps.map(s => s.transformation.apexAs)).toEqual(["P", "Q"])
      expect(chain.steps.map(s => s.angleDegrees)).toEqual([90, 60])
    }
  })
  it.each([
    ["先将△AEF沿EF翻折至△PEF，再将△PEF沿PF翻折60°至△QPF", [undefined, 60]],
    ["先将△AEF沿EF翻折90°至△PEF，再将△PEF沿PF翻折至△QPF", [90, undefined]]
  ])("keeps an unspecified angle on its own clause: %s", (prompt, angles) => {
    const chain = buildFoldChain(prompt)
    expect(chain.status).toBe("coupled")
    if (chain.status === "coupled") expect(chain.steps.map(s => s.angleDegrees)).toEqual(angles)
  })
})
