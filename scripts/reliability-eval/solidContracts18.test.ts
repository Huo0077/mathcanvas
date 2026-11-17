import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createEmptyDocument } from "@draw/dsl"
import {
  canonicalContentHash,
  certifyDrawingAgainstContract,
  compilePlan,
  parseDiagramObligations,
  routeDeterministicProblem,
  type PlanEnvelope
} from "@draw/agent-core"
import {
  evaluateDrawingContract,
  evaluateDrawingContractBranches,
  evaluateDrawingContractScopes,
  evaluateDrawingContractStates,
  type ContractSuiteFile,
  type DrawingContractCase
} from "./drawingContracts"

const suitePath = path.resolve(process.cwd(), "test-fixtures/reliability/drawing-contracts-36.json")
const suite = JSON.parse(fs.readFileSync(suitePath, "utf8")) as ContractSuiteFile
const solidCases: readonly DrawingContractCase[] = suite.cases.filter(
  (c) => c.category !== "plane"
)

function compileAndCertify(prompt: string, plan: PlanEnvelope, diagramPrompt?: string, selectedScopeId?: string) {
  const effectivePrompt = diagramPrompt ?? prompt
  const compiled = compilePlan(plan, {
    document: createEmptyDocument("geometry3d"),
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

describe("Task 4: 18 solid & fold contract cases end-to-end (construction + verification + certificate)", () => {
  it("loads all 18 solid and fold contracts", () => {
    expect(solidCases).toHaveLength(18)
  })

  for (const entry of solidCases) {
    it(`${entry.id} constructs and certifies all obligations`, () => {
      const parsedObs = parseDiagramObligations(entry.prompt)
      const route = routeDeterministicProblem(entry.prompt)
      expect(
        route,
        `${entry.id}: route=null, parsedGivens=${parsedObs.givens.length}, unverified=${JSON.stringify(parsedObs.unverified.map((u) => u.sourceText))}`
      ).not.toBeNull()
      if (route === null) throw new Error(`${entry.id}: route null`)

      const answerText = "answer" in route.plan && typeof route.plan.answer === "string"
        ? route.plan.answer
        : route.plan.assumptions?.join("\n") ?? null
      const infeasibleDiagnosedSubquestions = route.infeasibleSubquestions
        ? [...route.infeasibleSubquestions]
        : entry.subquestions
            .filter((sq) => sq.feasible === false && /无实数解|不存在|不成立|矛盾|不可能|不会|无法|infeasible/i.test(`${answerText ?? ""}\n${(route.plan.kind === "plan" ? route.plan.assumptions ?? [] : []).join("\n")}`))
            .map((sq) => sq.id)

      const branchPolicy = entry.displayPolicy.multiBranchHandling
      const statePolicy = entry.displayPolicy.multiStateHandling ?? ""
      const routeExtra = route as typeof route & {
        scopePlans?: Readonly<Record<string, { plan: PlanEnvelope; diagramPrompt?: string; selectedScopeId?: string }>>
        statePlans?: Readonly<Record<string, { plan: PlanEnvelope; diagramPrompt?: string; selectedScopeId?: string }>>
        scopedStatePlans?: Readonly<Record<string, Readonly<Record<string, { plan: PlanEnvelope; diagramPrompt?: string; selectedScopeId?: string }>>>>
      }

      if (routeExtra.scopedStatePlans) {
        for (const [scopeId, perState] of Object.entries(routeExtra.scopedStatePlans)) {
          const stateInputs: Record<string, { candidate: ReturnType<typeof createEmptyDocument>; options: Parameters<typeof evaluateDrawingContract>[2] }> = {}
          for (const [sid, sp] of Object.entries(perState)) {
            const sRes = compileAndCertify(entry.prompt, sp.plan, sp.diagramPrompt ?? route.diagramPrompt, sp.selectedScopeId ?? route.selectedScopeId)
            expect(sRes.compiled.diagramVerification?.status, `${entry.id}/${scopeId}/${sid}: checks=${JSON.stringify(sRes.compiled.diagramVerification?.checks)}`).toBe("passed")
            expect(sRes.certificate.certificateStatus, `${entry.id}/${scopeId}/${sid}: blockers=${JSON.stringify(sRes.certificate.gate.blockers)}`).toBe("passed")
            stateInputs[sid] = {
              candidate: sRes.draft,
              options: { verificationStatus: "passed", answerText, terminal: "awaiting_confirmation", error: null, infeasibleDiagnosedSubquestions, scopeId }
            }
          }
          const evalRes = evaluateDrawingContractStates(entry, stateInputs)
          expect(evalRes.passed, `${entry.id}/${scopeId}: state eval=${JSON.stringify(evalRes)}`).toBe(true)
        }
        return
      }

      if (statePolicy.startsWith("enumerate:") && routeExtra.statePlans) {
        const stateIds = statePolicy.slice("enumerate:".length).split(",").map((s) => s.trim()).filter(Boolean)
        const stateInputs: Record<string, { candidate: ReturnType<typeof createEmptyDocument>; options: Parameters<typeof evaluateDrawingContract>[2] }> = {}
        for (const sid of stateIds) {
          const sp = routeExtra.statePlans[sid]
          expect(sp, `${entry.id}: missing state plan ${sid}`).toBeDefined()
          const sRes = compileAndCertify(entry.prompt, sp!.plan, sp!.diagramPrompt ?? route.diagramPrompt, sp!.selectedScopeId ?? route.selectedScopeId)
          expect(sRes.compiled.diagramVerification?.status, `${entry.id}/${sid}: checks=${JSON.stringify(sRes.compiled.diagramVerification?.checks)}`).toBe("passed")
          expect(sRes.certificate.certificateStatus, `${entry.id}/${sid}: blockers=${JSON.stringify(sRes.certificate.gate.blockers)}`).toBe("passed")
          stateInputs[sid] = {
            candidate: sRes.draft,
            options: { verificationStatus: "passed", answerText, terminal: "awaiting_confirmation", error: null, infeasibleDiagnosedSubquestions }
          }
        }
        const evalRes = evaluateDrawingContractStates(entry, stateInputs)
        expect(evalRes.passed, `${entry.id}: state eval=${JSON.stringify(evalRes)}`).toBe(true)
        return
      }

      if (routeExtra.scopePlans) {
        const scopeInputs: Record<string, { candidate: ReturnType<typeof createEmptyDocument>; options: Parameters<typeof evaluateDrawingContract>[2] }> = {}
        for (const [scopeId, sp] of Object.entries(routeExtra.scopePlans)) {
          const sRes = compileAndCertify(entry.prompt, sp.plan, sp.diagramPrompt ?? route.diagramPrompt, sp.selectedScopeId ?? route.selectedScopeId)
          expect(sRes.compiled.diagramVerification?.status, `${entry.id}/${scopeId}: checks=${JSON.stringify(sRes.compiled.diagramVerification?.checks)}`).toBe("passed")
          expect(sRes.certificate.certificateStatus, `${entry.id}/${scopeId}: blockers=${JSON.stringify(sRes.certificate.gate.blockers)}`).toBe("passed")
          scopeInputs[scopeId] = {
            candidate: sRes.draft,
            options: { verificationStatus: "passed", answerText, terminal: "awaiting_confirmation", error: null, infeasibleDiagnosedSubquestions, scopeId }
          }
        }
        const evalRes = evaluateDrawingContractScopes(entry, scopeInputs)
        expect(evalRes.passed, `${entry.id}: scope eval=${JSON.stringify(evalRes)}`).toBe(true)
        return
      }

      if (branchPolicy.startsWith("enumerate:") && route.branchPlans) {
        const branches = branchPolicy.slice("enumerate:".length).split(",").map((b) => b.trim()).filter(Boolean)
        const targetSubq = entry.subquestions.find((sq) =>
          entry.requiredObligations.some((ob) => ob.scope === sq.id && ob.branchId !== undefined)
        )?.id ?? entry.subquestions.at(-1)?.id ?? "stem"
        const branchInputs: Record<string, { candidate: ReturnType<typeof createEmptyDocument>; options: Parameters<typeof evaluateDrawingContract>[2] }> = {}
        for (const br of branches) {
          const brPlan = route.branchPlans[br]
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
        return
      }

      const { compiled, draft, certificate } = compileAndCertify(
        entry.prompt,
        route.plan,
        route.diagramPrompt,
        route.selectedScopeId
      )
      expect(compiled.diagramVerification?.status, `${entry.id}: checks=${JSON.stringify(compiled.diagramVerification?.checks)}`).toBe("passed")
      expect(certificate.certificateStatus, `${entry.id}: cert blockers=${JSON.stringify(certificate.gate.blockers)}, checks=${JSON.stringify(certificate.report?.checks)}`).toBe("passed")

      const evalRes = evaluateDrawingContract(entry, draft, {
        verificationStatus: "passed",
        answerText,
        terminal: "awaiting_confirmation",
        error: null,
        infeasibleDiagnosedSubquestions
      })
      expect(evalRes.passed, `${entry.id}: failed=${JSON.stringify(evalRes.obligationResults.filter((o) => !o.passed))}, missing=${JSON.stringify(evalRes.missingEntityIds)}`).toBe(true)
    })
  }

  it("rejects tampered folded apex breaking rigid fold-transform-3d on GK-S02", () => {
    const entry = solidCases.find((c) => c.id === "GK-S02")!
    const route = routeDeterministicProblem(entry.prompt) as ReturnType<typeof routeDeterministicProblem> & {
      statePlans?: Record<string, { plan: typeof route.plan; diagramPrompt?: string; selectedScopeId?: string }>
    }
    const before = compileAndCertify(entry.prompt, route.statePlans!.before_fold.plan, route.statePlans!.before_fold.diagramPrompt, route.statePlans!.before_fold.selectedScopeId)
    const after = compileAndCertify(entry.prompt, route.statePlans!.after_fold.plan, route.statePlans!.after_fold.diagramPrompt, route.statePlans!.after_fold.selectedScopeId)
    const tamperedAfter = structuredClone(after.draft)
    for (const p of tamperedAfter.primitives) {
      if (p.type === "point3" && p.label === "P") p.position = { ...p.position, z: p.position.z + 0.5 }
    }
    const evalRes = evaluateDrawingContractStates(entry, {
      before_fold: { candidate: before.draft, options: { verificationStatus: "passed", terminal: "awaiting_confirmation", error: null } },
      after_fold: { candidate: tamperedAfter, options: { verificationStatus: "passed", terminal: "awaiting_confirmation", error: null } }
    })
    expect(evalRes.passed).toBe(false)
    expect(evalRes.lineageResult?.failedObligationIds).toContain("ob-fold-transform")
  })

  it("rejects non-optimal BE=5 substituted into subquestion (2) of JT-S04", () => {
    const entry = solidCases.find((c) => c.id === "JT-S04")!
    const route = routeDeterministicProblem(entry.prompt) as ReturnType<typeof routeDeterministicProblem> & {
      scopedStatePlans?: Record<string, Record<string, { plan: typeof route.plan; diagramPrompt?: string; selectedScopeId?: string }>>
    }
    const before1 = compileAndCertify(entry.prompt, route.scopedStatePlans!["(1)"].before_fold.plan, route.scopedStatePlans!["(1)"].before_fold.diagramPrompt, route.scopedStatePlans!["(1)"].before_fold.selectedScopeId)
    const after1 = compileAndCertify(entry.prompt, route.scopedStatePlans!["(1)"].after_fold.plan, route.scopedStatePlans!["(1)"].after_fold.diagramPrompt, route.scopedStatePlans!["(1)"].after_fold.selectedScopeId)
    const evalRes = evaluateDrawingContractStates(entry, {
      before_fold: { candidate: before1.draft, options: { verificationStatus: "passed", terminal: "awaiting_confirmation", error: null, scopeId: "(2)" } },
      after_fold: { candidate: after1.draft, options: { verificationStatus: "passed", terminal: "awaiting_confirmation", error: null, scopeId: "(2)" } }
    })
    expect(evalRes.passed).toBe(false)
    expect(evalRes.scopeResults.after_fold?.failedObligationIds).toContain("ob-2-skew-min-cos")
  })

  it("rejects wrong hemisphere radius on JT-S09", () => {
    const entry = solidCases.find((c) => c.id === "JT-S09")!
    const route = routeDeterministicProblem(entry.prompt)!
    const res = compileAndCertify(entry.prompt, route.plan, route.diagramPrompt, route.selectedScopeId)
    const tampered = structuredClone(res.draft)
    for (const p of tampered.primitives) {
      if (p.type === "sphere") p.radius = Math.sqrt(5)
    }
    const evalRes = evaluateDrawingContract(entry, tampered, {
      verificationStatus: "passed",
      terminal: "awaiting_confirmation",
      error: null
    })
    expect(evalRes.passed).toBe(false)
    expect(evalRes.failedObligationIds).toContain("ob-hemisphere")
  })

  it("rejects off-edge vertex corruption on GK-S05", () => {
    const entry = solidCases.find((c) => c.id === "GK-S05")!
    const route = routeDeterministicProblem(entry.prompt)!
    const res = compileAndCertify(entry.prompt, route.plan, route.diagramPrompt, route.selectedScopeId)
    const tampered = structuredClone(res.draft)
    for (const p of tampered.primitives) {
      if (p.type === "point3" && p.label === "B₂") p.position = { ...p.position, x: p.position.x + 0.4 }
    }
    const evalRes = evaluateDrawingContract(entry, tampered, {
      verificationStatus: "passed",
      terminal: "awaiting_confirmation",
      error: null,
      infeasibleDiagnosedSubquestions: ["(2)"]
    })
    expect(evalRes.passed).toBe(false)
    expect(evalRes.failedObligationIds).toContain("ob-b2")
  })
})
