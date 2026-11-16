import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createEmptyDocument } from "@draw/dsl"
import {
  canonicalContentHash,
  certifyDrawingAgainstContract,
  compilePlan,
  routeDeterministicProblem,
  type PlanEnvelope
} from "@draw/agent-core"
import {
  evaluateDrawingContract,
  evaluateDrawingContractBranches,
  type ContractSuiteFile,
  type DrawingContractCase
} from "./drawingContracts"

const suitePath = path.resolve(process.cwd(), "test-fixtures/reliability/drawing-contracts-36.json")
const suite = JSON.parse(fs.readFileSync(suitePath, "utf8")) as ContractSuiteFile
const planarCases: readonly DrawingContractCase[] = suite.cases.filter((c) => c.category === "plane")

function compileAndCertify(prompt: string, plan: PlanEnvelope, diagramPrompt?: string, selectedScopeId?: string) {
  const effectivePrompt = diagramPrompt ?? prompt
  const compiled = compilePlan(plan, {
    document: createEmptyDocument("conics"),
    prompt: effectivePrompt,
    diagramObligationIR: true,
    ...(selectedScopeId === undefined ? {} : { selectedScopeId })
  })
  expect(compiled.ok, `${prompt}: compile diagnostics=${JSON.stringify(compiled.diagnostics)}`).toBe(true)
  const draft = compiled.draftDocument!
  const certificate = certifyDrawingAgainstContract({
    prompt: effectivePrompt,
    document: draft,
    candidateHash: canonicalContentHash(draft),
    sourceHash: canonicalContentHash(effectivePrompt),
    plan,
    obligationIR: true,
    ...(selectedScopeId === undefined ? {} : { selectedScopeId })
  })
  return { compiled, draft, certificate }
}

describe("Task 3: 18 planar contract cases end-to-end (construction + verification + certificate)", () => {
  it("loads all 18 planar contracts", () => {
    expect(planarCases).toHaveLength(18)
  })

  for (const entry of planarCases) {
    it(`${entry.id} constructs and certifies all obligations`, () => {
      const route = routeDeterministicProblem(entry.prompt)
      expect(route, `${entry.id}: routeDeterministicProblem returned null`).not.toBeNull()
      if (route === null) throw new Error(`${entry.id}: route null`)

      const { compiled, draft, certificate } = compileAndCertify(
        entry.prompt,
        route.plan,
        route.diagramPrompt,
        route.selectedScopeId
      )
      expect(compiled.diagramVerification?.status, `${entry.id}: checks=${JSON.stringify(compiled.diagramVerification?.checks)}`).toBe("passed")
      expect(certificate.certificateStatus, `${entry.id}: cert blockers=${JSON.stringify(certificate.gate.blockers)}, checks=${JSON.stringify(certificate.report?.checks)}`).toBe("passed")

      const answerText = "answer" in route.plan && typeof route.plan.answer === "string"
        ? route.plan.answer
        : route.plan.assumptions?.join("\n") ?? null
      const infeasibleDiagnosedSubquestions = route.infeasibleSubquestions
        ? [...route.infeasibleSubquestions]
        : entry.subquestions
            .filter((sq) => sq.feasible === false && /无实数解|不存在|不成立|矛盾|infeasible/i.test(`${answerText ?? ""}\n${(route.plan.kind === "plan" ? route.plan.assumptions ?? [] : []).join("\n")}`))
            .map((sq) => sq.id)

      const branchPolicy = entry.displayPolicy.multiBranchHandling
      if (branchPolicy.startsWith("enumerate:")) {
        const branches = branchPolicy.slice("enumerate:".length).split(",").map((b) => b.trim()).filter(Boolean)
        const targetSubq = entry.subquestions.find((sq) =>
          entry.requiredObligations.some((ob) => ob.scope === sq.id && ob.branchId !== undefined)
        )?.id ?? entry.subquestions.at(-1)?.id ?? "stem"
        const branchInputs: Record<string, { candidate: typeof draft; options: Parameters<typeof evaluateDrawingContract>[2] }> = {}
        for (const br of branches) {
          const brPlan = route.branchPlans?.[br]
          expect(brPlan, `${entry.id}: missing branch plan ${br}`).toBeDefined()
          const brRes = compileAndCertify(entry.prompt, brPlan!, route.diagramPrompt, route.selectedScopeId)
          expect(brRes.compiled.diagramVerification?.status, `${entry.id}/${br}: checks=${JSON.stringify(brRes.compiled.diagramVerification?.checks)}`).toBe("passed")
          expect(brRes.certificate.certificateStatus, `${entry.id}/${br}: blockers=${JSON.stringify(brRes.certificate.gate.blockers)}`).toBe("passed")
          branchInputs[br] = {
            candidate: brRes.draft,
            options: { verificationStatus: "passed", answerText, terminal: "awaiting_confirmation", error: null, infeasibleDiagnosedSubquestions }
          }
        }
        const evalRes = evaluateDrawingContractBranches(entry, targetSubq, branchInputs)
        expect(evalRes.passed, `${entry.id}: branch eval=${JSON.stringify(evalRes)}`).toBe(true)
      } else {
        const evalRes = evaluateDrawingContract(entry, draft, {
          verificationStatus: "passed",
          answerText,
          terminal: "awaiting_confirmation",
          error: null,
          infeasibleDiagnosedSubquestions
        })
        expect(evalRes.passed, `${entry.id}: failed=${JSON.stringify(evalRes.obligationResults.filter((o) => !o.passed))}, missing=${JSON.stringify(evalRes.missingEntityIds)}`).toBe(true)
      }
    })
  }
})

describe("Task 3 negative & tamper defenses (tampered coordinates/tangents/domain must fail)", () => {
  it("GK-P01: rejects compilePlan geometry_validation when chord endpoints break collinearity", () => {
    const entry = planarCases.find((c) => c.id === "GK-P01")!
    const route = routeDeterministicProblem(entry.prompt)!
    const tampered: PlanEnvelope = route.plan.kind === "plan"
      ? {
          ...route.plan,
          actions: route.plan.actions.map((act) =>
            act.actionId === "planar.create_point" && act.inputs.label === "A"
              ? { ...act, inputs: { ...act.inputs, points: [{ x: 4, y: 0 }] } }
              : act
          )
        }
      : route.plan
    const effectivePrompt = route.diagramPrompt ?? entry.prompt
    const compiled = compilePlan(tampered, {
      document: createEmptyDocument("conics"),
      prompt: effectivePrompt,
      diagramObligationIR: true,
      ...(route.selectedScopeId === undefined ? {} : { selectedScopeId: route.selectedScopeId })
    })
    expect(compiled.ok).toBe(false)
    expect(compiled.diagramVerification?.status).toBe("failed")
    expect(compiled.diagnostics.some((d) => d.code === "diagram_condition_failed")).toBe(true)
  })

  it("GK-P05: rejects compilePlan geometry_validation when P is moved off host line l: x = 1", () => {
    const entry = planarCases.find((c) => c.id === "GK-P05")!
    const route = routeDeterministicProblem(entry.prompt)!
    const tampered: PlanEnvelope = route.plan.kind === "plan"
      ? {
          ...route.plan,
          actions: route.plan.actions.map((act) =>
            act.actionId === "planar.create_point" && act.inputs.label === "P"
              ? { ...act, inputs: { ...act.inputs, points: [{ x: 2.5, y: 1 }] } }
              : act
          )
        }
      : route.plan
    const effectivePrompt = route.diagramPrompt ?? entry.prompt
    const compiled = compilePlan(tampered, {
      document: createEmptyDocument("conics"),
      prompt: effectivePrompt,
      diagramObligationIR: true,
      ...(route.selectedScopeId === undefined ? {} : { selectedScopeId: route.selectedScopeId })
    })
    expect(compiled.ok).toBe(false)
    expect(compiled.diagramVerification?.status).toBe("failed")
    expect(compiled.diagnostics.some((d) => d.code === "diagram_condition_failed")).toBe(true)
  })

  it("JT-P08: fails conic-domain-2d contract when excludedPoints (x != 0 vertices) are omitted", () => {
    const entry = planarCases.find((c) => c.id === "JT-P08")!
    const route = routeDeterministicProblem(entry.prompt)!
    const brPlan = route.branchPlans!.positive!
    const stripped: PlanEnvelope = brPlan.kind === "plan"
      ? {
          ...brPlan,
          actions: brPlan.actions.map((act) =>
            act.actionId === "planar.create_conic"
              ? { ...act, inputs: { ...act.inputs, excludedPoints: [] } }
              : act
          )
        }
      : brPlan
    const { draft } = compileAndCertify(entry.prompt, stripped, route.diagramPrompt, route.selectedScopeId)
    const evalRes = evaluateDrawingContract(entry, draft, { verificationStatus: "passed", terminal: "awaiting_confirmation", error: null })
    expect(evalRes.failedObligationIds).toContain("ob-g-domain")
  })

  it("GK-P09: rejects diagram verification & certificate when tangent x is tampered off inflection point", () => {
    const entry = planarCases.find((c) => c.id === "GK-P09")!
    const route = routeDeterministicProblem(entry.prompt)!
    const tampered: PlanEnvelope = route.plan.kind === "plan"
      ? {
          ...route.plan,
          actions: route.plan.actions.map((act) =>
            act.actionId === "function.create_tangent"
              ? { ...act, inputs: { ...act.inputs, x: 0.25 } }
              : act.actionId === "planar.create_line"
                ? { ...act, inputs: { ...act.inputs, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } }
                : act
          )
        }
      : route.plan
    const effectivePrompt = route.diagramPrompt ?? entry.prompt
    const compiled = compilePlan(tampered, {
      document: createEmptyDocument("conics"),
      prompt: effectivePrompt,
      diagramObligationIR: true,
      ...(route.selectedScopeId === undefined ? {} : { selectedScopeId: route.selectedScopeId })
    })
    expect(compiled.ok).toBe(false)
    expect(compiled.diagramVerification?.status).toBe("failed")
    const skippedCompile = compilePlan(tampered, { document: createEmptyDocument("conics"), prompt: effectivePrompt })
    const certificate = certifyDrawingAgainstContract({
      prompt: effectivePrompt,
      document: skippedCompile.draftDocument ?? createEmptyDocument("conics"),
      candidateHash: canonicalContentHash(tampered),
      sourceHash: canonicalContentHash(effectivePrompt),
      plan: tampered,
      obligationIR: true
    })
    expect(certificate.certificateStatus).not.toBe("passed")
  })
})
