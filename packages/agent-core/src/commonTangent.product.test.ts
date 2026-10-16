import { createEmptyDocument } from "@draw/dsl"
import { commitPatch } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"
import { parseActionToolInput } from "./actionSchemas"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"
import { compilePlan } from "./planCompiler"

const prompt = "画出 f(x)=x² 与 g(x)=−(x−2)²+1 的两条公切线"
function commonPlan(): PlanEnvelope {
  const inputs = [
    ["function.create_graph", { alias: "f", expression: "x*x", domain: [-3, 3] }],
    ["function.create_graph", { alias: "g", expression: "-(x-2)*(x-2)+1", domain: [-2, 3] }],
    ...[0, 1].map(branch => ["function.create_tangent", { alias: "ct" + branch, sourceId: { scope: "draft", alias: "f" }, anchor: { kind: "common", otherSourceId: { scope: "draft", alias: "g" }, branch } }])
  ] as const
  const actions = inputs.map(([id, input], index) => {
    const parsed = parseActionToolInput(id as "function.create_graph", input, "step-" + index)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors))
    return parsed.value
  })
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "画公切线", factIds: [], actions }
}
function compiledFixture() {
  const base = createEmptyDocument("conics")
  const plan = commonPlan()
  const compiled = compilePlan(plan, { document: base, prompt, conversationId: "common", documentGeneration: 0 })
  expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true)
  if (!compiled.draftDocument) throw new Error("candidate missing")
  return { plan: compiled.plan!, candidate: compiled.draftDocument, compiled, base }
}

describe("common tangent product verification", () => {
  it("parses the two original expressions and count as one explicit common-tangent obligation", () => {
    const set = parseDiagramObligations(prompt)
    expect(set.givens).toEqual([expect.objectContaining({ kind: "commonTangent", expressions: ["x^2", "-(x-2)^2+1"], value: 2 })])
    expect(set.unverified).toEqual([])
  })

  it("resolves both draft references, commits two real lines and independently checks both curves", () => {
    const { compiled, candidate } = compiledFixture()
    expect(candidate.primitives.filter(p => p.type === "tangent").map(p => p.type === "tangent" ? p.slope : 0)).toEqual([expect.closeTo(2 - Math.sqrt(2), 6), expect.closeTo(2 + Math.sqrt(2), 6)])
    expect(compiled.diagramVerification).toMatchObject({ status: "passed", proofScope: "figure-instance", universalClaims: "not-proven", checks: [expect.objectContaining({ kind: "commonTangent", status: "passed", evidence: "verified-numeric" })] })
  })

  it.each(["wrong-line", "missing-branch", "wrong-second-curve", "duplicate-branch"])("does not accept %s as a common tangent solution", corruption => {
    const { plan, candidate, base } = compiledFixture()
    const tangents = candidate.primitives.filter(p => p.type === "tangent")
    const first = tangents[0]
    if (first?.type !== "tangent") throw new Error("tangent missing")
    if (corruption === "wrong-line") { first.slope = 0; first.point.y = 20 }
    if (corruption === "missing-branch") candidate.primitives = candidate.primitives.filter(p => p.id !== tangents[1].id)
    if (corruption === "wrong-second-curve") {
      const commonAnchor = first.anchor?.kind === "common" ? first.anchor : undefined
      const second = candidate.primitives.find(p => p.id === commonAnchor?.otherSourceId)
      if (second?.type !== "function") throw new Error("second source missing")
      second.expression = "x*x+1"
    }
    if (corruption === "duplicate-branch") Object.assign(tangents[1], { ...first, id: tangents[1].id })
    const report = verifyDiagramObligations(parseDiagramObligations(prompt), plan, candidate, base)
    expect(report.checks.find(c => c.kind === "commonTangent")?.status).not.toBe("passed")
    expect(report.status).not.toBe("passed")
  })

  it("keeps the committed tangent but invalidates evidence after the other source loses all tangents", () => {
    const { plan, candidate, base } = compiledFixture()
    const tangent = candidate.primitives.find(p => p.type === "tangent")
    if (tangent?.type !== "tangent" || tangent.anchor?.kind !== "common") throw new Error("common tangent missing")
    const edited = commitPatch(candidate, { op: "updatePrimitive", id: tangent.anchor.otherSourceId, patch: { expression: "x*x+1" } })
    expect(edited.error).toBeUndefined()
    expect(verifyDiagramObligations(parseDiagramObligations(prompt), plan, edited.document, base).status).not.toBe("passed")
  })
})
