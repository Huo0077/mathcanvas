import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { createEmptyDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { parsePlanEnvelope } from "../../packages/agent-core/src/schemas"
import { normalizeGeometryPrompt } from "../../packages/agent-core/src/latexNormalisation"
import { routeDeterministicProblem } from "../../packages/agent-core/src/deterministicProblemRoute"
import { solveRectangleFold } from "../../packages/agent-core/src/rectangleFoldPlan"
import { createAgentRuntime } from "../../apps/web/src/agent/agentRuntime"

// Characterisation probes, NOT product acceptance tests. A pass may confirm a defect.
// No model/provider calls, credentials, UI automation, or writes to user documents.
const output = "docs/audit/artifacts/2026-11-08-agent-failures/current-probe.json"
const report = {
  generatedAt: new Date().toISOString(),
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  mode: "offline-characterisation-not-live-accuracy",
  observations: {}
}
const envelope = (answer) => ({ schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "解题", factIds: [], answer, toolResultRefs: [] })
const brief = (result) => result.ok ? { accepted: true } : { accepted: false, errors: result.errors.map(({ code, path }) => ({ code, path })) }

afterAll(() => {
  mkdirSync(resolve(output, ".."), { recursive: true })
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n")
})

describe("2026-11-08 current-source failure characterisation", () => {
  it("replays historical envelopes through ONLY the current parser when local logs exist", () => {
    const rows = []
    const missing = []
    for (const id of ["mm-035", "mm-051", "mm-063", "text-139", "text-190"]) {
      const path = `eval-results/real-exams-20261105/baseline/${id}-requests.json`
      if (!existsSync(path)) { missing.push(id); continue }
      const requests = JSON.parse(readFileSync(path, "utf8"))
      for (const [index, request] of requests.entries()) {
        const calls = (Array.isArray(request.response) ? request.response : []).filter((event) => event.kind === "tool_call")
        for (const call of calls.filter((item) => item.toolId === "plan_set_plan")) {
          rows.push({ caseId: id, requestIndex: index + 1, batchToolIds: calls.map((item) => item.toolId), kind: call.input?.kind,
            answerLength: typeof call.input?.answer === "string" ? call.input.answer.length : null,
            fields: Object.keys(call.input ?? {}).sort(), ...brief(parsePlanEnvelope(call.input)) })
        }
      }
    }
    report.observations.historicalSchemaReplay = { rows, missing, scope: "Parser only: acceptance does not establish transport success, valid reasoning, or a correct answer." }
    expect(rows.filter((row) => row.caseId === "mm-035").every((row) => row.accepted)).toBe(true)
    const branchConflicts = rows.filter((row) => row.kind === "answer" && row.fields.includes("normalisations"))
    expect(branchConflicts.every((row) => !row.accepted)).toBe(true)
    if (rows.length) expect(branchConflicts.length).toBeGreaterThan(0)
  })

  it("accepts an empty answer in the current schema", () => {
    const result = parsePlanEnvelope(envelope(""))
    report.observations.emptyAnswerSchema = brief(result)
    expect(result.ok).toBe(true)
  })

  it.each([
    ["wrong-choice", "最终答案：A（√5）", "双曲线左右焦点为F1、F2，P为F2到渐近线的垂足，PF1=√6 OP，求离心率。"],
    ["clarification-as-answer", "请提供清晰图片以确认尺寸。", "如图，求几何体的体积。"],
    ["empty-answer", "", "求函数的单调区间。"]
  ])("records that %s can complete without a mathematical check", async (id, answer, prompt) => {
    const document = createEmptyDocument("conics")
    const target = { projectId: "offline-audit", documentId: document.metadata.id, workspace: document.workspace,
      epoch: "offline-audit", generation: document.revision, contentHash: contentFingerprint(document) }
    let writes = 0
    const runtime = createAgentRuntime({
      readDocument: () => document,
      writeDocument: () => { writes++; throw new Error("Audit must not write user documents") },
      readSceneDocuments: () => [{ handle: target, document }],
      planner: { plan: async () => ({ plan: envelope(answer), requestId: id, attemptId: id }) },
      exportPreflight: { preflight: () => { throw new Error("No export expected") } },
      projectId: "offline-audit", runId: id
    })
    const run = { runId: id, conversationId: id, promptMessageId: id, target, sources: [],
      textProfileId: "offline", capabilityRevision: "audit", policyRevision: "audit" }
    const phases = []
    for await (const event of runtime.coordinator.start({ run, userMessage: prompt })) phases.push(event.phase)
    report.observations[id] = { phases, finalAnswer: runtime.answer(), writes, planner: "scripted fault injection, not a live model" }
    expect(phases.at(-1)).toBe("completed")
    expect(runtime.answer()).toBe(answer)
    expect(writes).toBe(0)
  })

  it("retains the denominator grouping for the historical fraction family", () => {
    const input = String.raw`函数 $f(x)=\frac{1}{2x}$，求导数。`
    const normalized = normalizeGeometryPrompt(input)
    report.observations.fractionGrouping = { input, normalized, scope: "Normalisation only, not a proof of all expression semantics." }
    expect(normalized).toContain("1/(2x)")
  })

  it("measures narrow deterministic routing without calling fallback models", () => {
    const prompts = [
      "已知函数f(x)=2sin(x)cos(x-π/3)+1，求f(x)的单调递增区间。",
      "已知函数f(x)=2sin(x)cos(x-π/3)+1，求f(x)的单调递减区间。",
      "已知函数f(x)=2sin(x)cos(x-π/3)+1，求出这个函数在哪些区间上单调递增。"
    ]
    const rows = prompts.map((prompt) => ({ prompt, family: routeDeterministicProblem(prompt)?.family ?? null }))
    report.observations.deterministicRouting = { rows, scope: "A route miss means fallback, not necessarily an incorrect final answer." }
    expect(rows[0].family).toBe("functions")
    expect(rows[1].family).toBeNull()
    expect(rows[2].family).toBeNull()
  })

  it("rechecks the historical 24 rectangle-fold fixtures without a Vite dev server", () => {
    const fixtures = JSON.parse(readFileSync("test-fixtures/agent-answer-validation-20261102.json", "utf8"))
    const rows = fixtures.map((example) => {
      const solved = solveRectangleFold(example.prompt)
      const findings = solved.findings ?? []
      const lengths = findings.filter((item) => item.kind === "length").map((item) => item.value)
      const values = example.expectedKind === "angle" ? [solved.geometry?.angleDegrees] : lengths
      const match = values.length === example.values.length && values.every((value, i) => Number.isFinite(value) && Math.abs(value - example.values[i]) <= 1e-8 * Math.max(1, Math.abs(example.values[i])))
      const corePass = example.expectedKind === "inconsistent" ? solved.code === "inconsistent_conditions"
        : example.expectedKind === "clarify" ? solved.status === "clarification" && solved.reason === "needs_fold_angle"
        : example.expectedKind === "refute" ? match && findings.some((item) => item.status === "disproved")
        : example.expectedKind === "true" ? match && findings.some((item) => item.status === "holds") : match
      const answer = solved.answer ?? solved.plan?.answer ?? ""
      return { id: example.id, name: example.name, expectedKind: example.expectedKind, corePass,
        status: solved.status, code: solved.code, lengths, angleDegrees: solved.geometry?.angleDegrees,
        hasAnswerText: Boolean(answer.trim()), answer }
    })
    report.observations.rectangleFold24 = { total: rows.length, corePass: rows.filter((row) => row.corePass).length, rows,
      scope: "Reuses the historical independent numeric fixture oracle; not a full proof or browser delivery check. Angle corePass can be true even with no answer text." }
    expect(rows).toHaveLength(24)
  })

  it("independently disproves the text-128 wrong eccentricity by coordinates", () => {
    const check = (a, c) => {
      const b = Math.sqrt(c * c - a * a)
      const p = [a * a / c, a * b / c]
      const pf1Squared = (p[0] + c) ** 2 + p[1] ** 2
      const required = 6 * (p[0] ** 2 + p[1] ** 2)
      return { a, c, pf1Squared, required, residual: pf1Squared - required }
    }
    const wrong = check(1, Math.sqrt(5)), correct = check(1, Math.sqrt(3))
    report.observations.text128Counterexample = { wrong, correct, method: "Independent coordinate arithmetic, not the agent expression converter." }
    expect(wrong.pf1Squared).toBeCloseTo(8)
    expect(wrong.required).toBeCloseTo(6)
    expect(correct.residual).toBeCloseTo(0)
  })

  it("independently disproves text-198's reversed inequality by an ellipse point", () => {
    const a = 2, b = 1, sinTheta = -1 / 3
    const p = [a * Math.sqrt(1 - sinTheta * sinTheta), b * sinTheta]
    const pbSquared = p[0] ** 2 + (p[1] - b) ** 2
    const allowed = (2 * b) ** 2
    report.observations.text198Counterexample = { a, b, p, pbSquared, allowed, method: "One admissible point refutes the universal claim; it is not a proof of the correct interval." }
    expect((p[0] / a) ** 2 + (p[1] / b) ** 2).toBeCloseTo(1)
    expect(pbSquared).toBeCloseTo(16 / 3)
    expect(pbSquared).toBeGreaterThan(allowed)
  })
})
