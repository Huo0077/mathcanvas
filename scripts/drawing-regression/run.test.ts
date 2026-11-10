/// <reference types="vite/client" />
import { mkdir, writeFile } from "node:fs/promises"
import { readFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { createEmptyDocument } from "@draw/dsl"
import type { GeometryDocument } from "@draw/dsl"
import { createSolveContext } from "@draw/agent-core"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"
import { createAgentRunner } from "../../apps/web/src/agent/agentRunner"
import { useAgentStore } from "../../apps/web/src/agentStore"
import { useSceneStore } from "../../apps/web/src/store"
import { summarizeDrawingRuns, type DrawingRun } from "./report"

type Point = { x: number; y: number; z: number }
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
function errorsFor(id: string, doc: GeometryDocument): string[] {
  const points = new Map(doc.primitives.filter(p => p.type === "point3" && p.label).map(p => [p.label!, p.type === "point3" ? p.position : { x: 0, y: 0, z: 0 }]))
  const at = (name: string) => points.get(name)
  const measured = (a: string, b: string, expected: number, label: string): string[] => {
    const p = at(a), q = at(b)
    return p && q && Math.abs(distance(p, q) - expected) < 1e-6 ? [] : [label]
  }
  if (id.includes("case-1")) return [...measured("A", "B", 2, "AB"), ...measured("C", "D", 1, "CD")]
  if (id.includes("case-2")) return [...measured("A", "B", 2, "AB"), ...measured("A", "A₁", 3, "AA₁")]
  if (id.includes("case-3")) return [...measured("A", "B", 2, "AB"), ...measured("P", "O", Math.sqrt(3), "PO")]
  if (id.includes("case-4")) return [...measured("A", "B", 2, "AB"), ...measured("A", "D", 1, "AD")]
  return ["oracle_missing"]
}

/** This is a DEVELOPMENT regression using the actual offline runner; never a blind holdout. */
describe("W5 deterministic UI-equivalent run report", () => {
  it("replays all four frozen originals once and records every outcome, without a provider request", async () => {
    const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "test-fixtures/drawing-regression-20261109/cases.json"), "utf8")) as {
      cases: { id: string; prompt: string; source: { sha256: string } }[] }
    const cases = manifest.cases.filter(item => /case-[1-4]-/.test(item.id) && !item.id.includes("revised"))
    expect(cases).toHaveLength(4)
    const runs: DrawingRun[] = []
    const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
    let providerCalls = 0
    let resolutionAttempts = 0
    for (const item of cases) {
      localStorage.clear()
      useAgentStore.getState().clearAll()
      const base = createEmptyDocument("geometry3d")
      useSceneStore.setState({ document: base, workspaceDocuments: { geometry3d: base }, history: [], future: [], error: null })
      expect(await hash(item.prompt)).toBe(item.source.sha256)
      const prompt = item.prompt + "请画题设示意图。"
      const context = await createSolveContext({ runId: "eval", conversationId: "eval", prompt, attachments: [], corrections: [], sceneRevision: contentFingerprint(base) }, hash)
      const obligations = context.understanding.ir.obligations.filter(o => o.role === "given" || o.role === "construction").map(o => o.id)
      await useAgentStore.getState().sendPrompt(prompt)
      const user = [...useAgentStore.getState().activeConversation!.messages].reverse().find(msg => msg.role === "user")!
      const runner = createAgentRunner({ modelPlanner: { resolveProvider: async () => {
        resolutionAttempts++
        return { ok: false as const, code: "no_active_profile" as const, detail: "offline evaluation: no provider" }
      }, runModel: async () => { providerCalls++; throw new Error("offline report must not call a model") } } })
      const result = await runner.run(prompt, user.id)
      const draft = useAgentStore.getState().activeConversation!.messages.at(-1)?.draft
      const stage = result.phase === "awaiting_confirmation"
      const sourceChecks = draft?.diagramVerification?.checks ?? []
      const verifiedObligations = obligations.filter(id => {
        const item = context.understanding.ir.obligations.find(o => o.id === id)!
        return sourceChecks.some(check => check.kind === item.kind && check.sourceText === item.sourceText && check.status === "passed")
      })
      const certified = stage && draft?.drawingCertified === true && draft.diagramVerification?.status === "passed"
        && verifiedObligations.length === obligations.length
      const commit = stage ? runner.confirm() : { status: "failed" as const }
      const actual = commit.status === "committed" ? errorsFor(item.id, useSceneStore.getState().document) : []
      runs.push({ caseId: item.id, sourceSha256: item.source.sha256, sourceSet: "development", kind: "drawing",
        disposition: commit.status === "committed" ? "committed" : result.phase === "waiting" ? "clarification" : "failed",
        requiredObligations: obligations, verifiedObligations, draftCreated: !!draft,
        staged: stage, certificateValid: certified, committedWithKnownError: actual.length > 0,
        expectedDrawable: true, reasonCodes: actual.length ? actual : commit.status === "committed" ? [] : [result.phase] })
    }
    // Synthetic unsupported relation: count the refusal in the denominator, never as a historical exam original.
    const refusalSource = "在三棱锥D-ABC中，AD⊥平面ABC，D在底面ABC上方，画示意图"
    const refusalHash = await hash(refusalSource)
    localStorage.clear()
    useAgentStore.getState().clearAll()
    const refusalBase = createEmptyDocument("geometry3d")
    useSceneStore.setState({ document: refusalBase, workspaceDocuments: { geometry3d: refusalBase }, history: [], future: [], error: null })
    await useAgentStore.getState().sendPrompt(refusalSource)
    const refusalUser = useAgentStore.getState().activeConversation!.messages.find(message => message.role === "user")!
    const refusalRunner = createAgentRunner({ modelPlanner: { resolveProvider: async () => ({ ok: false as const,
      code: "no_active_profile" as const, detail: "offline evaluation: no provider" }), runModel: async () => {
      providerCalls++; throw Error("offline refusal must not call a model") } } })
    const refusalResult = await refusalRunner.run(refusalSource, refusalUser.id)
    const refusalMessage = useAgentStore.getState().activeConversation!.messages.at(-1)
    const refusalDraft = useAgentStore.getState().activeConversation!.messages.at(-1)?.draft
    runs.push({ caseId: "synthetic-above-base-unsupported", sourceSha256: refusalHash, sourceSet: "synthetic", kind: "drawing",
      disposition: refusalResult.phase === "waiting" ? "clarification" : "unsupported", requiredObligations: ["above-base"],
      verifiedObligations: [], draftCreated: !!refusalDraft, staged: false, certificateValid: false,
      committedWithKnownError: false, reasonCodes: [refusalMessage?.failure?.code ?? refusalResult.phase] })
    expect(refusalMessage?.failure).toBeDefined()
    expect(refusalRunner.confirm().status).toBe("rejected")
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    const report = summarizeDrawingRuns(runs)
    const revision = new TextDecoder().decode(execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })).trim()
    const workingTreeDirty = new TextDecoder().decode(execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: process.cwd() })).trim().length > 0
    const out = path.join(process.cwd(), "eval-results/drawing-regression/development-offline-latest.json")
    await mkdir(path.dirname(out), { recursive: true })
    await writeFile(out, JSON.stringify({ revision, workingTreeDirty, fixtureVersion: "2026-11-09-v1", mode: "deterministic-offline", measurement: "development-and-synthetic-only", providerCalls, resolutionAttempts, report, runs }, null, 2), "utf8")
    expect(providerCalls).toBe(0)
    expect(report.counts).toMatchObject({ attempted: 5, committed: 4, committedWithKnownError: 0 })
    expect(report.obligationCoverage).toMatchObject({ required: 34, verified: 33, rate: 33 / 34 })
    expect(report.cohorts.development).toMatchObject({ attempted: 4, committed: 4, verified: 33, required: 33 })
    expect(report.cohorts.synthetic).toMatchObject({ attempted: 1, committed: 0, verified: 0, required: 1 })
    expect(report.safetyGate.passed).toBe(true)
    expect(report.releaseGate.passed).toBe(false)
  }, 30_000)
})
