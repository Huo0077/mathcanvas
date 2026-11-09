import { createEmptyDocument } from "@draw/dsl"
import { createSolveContext, type PlanEnvelope } from "@draw/agent-core"
import { expect, it, vi } from "vitest"
import { createDefaultSolveSession } from "../services/solveSession"
import { RELIABILITY_FLAGS_FOR_TESTS } from "./reliabilityFlags"
import { startProblemSolve } from "./problemSolveService"

it("uses the actual runtime and same problem revision to reject a missing second goal", async () => {
  const document = createEmptyDocument("geometry3d")
  const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
  const prompt = "矩形 ABCD 中 AB=4，BC=2。沿 AC 将三角形 ABC 折起 90°，求折前BC与折后B'C的长度。"
  const context = await createSolveContext({ runId: "r1", conversationId: "c1", prompt, attachments: [], corrections: [], sceneRevision: "doc-v0" }, hash)
  const plan: PlanEnvelope = { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "length", factIds: [], answer: "（1）BC=2", toolResultRefs: [] }
  const writeDocument = vi.fn()
  const runtime = startProblemSolve({
    context, session: createDefaultSolveSession("session1"), flags: RELIABILITY_FLAGS_FOR_TESTS, hashText: hash,
    runtime: {
      planner: { plan: async () => ({ plan, requestId: "req", attemptId: "att" }) },
      readDocument: () => document, writeDocument,
      readSceneDocuments: () => [{ handle: { projectId: "p", documentId: document.metadata.id,
        workspace: "geometry3d", epoch: "epoch", generation: document.revision, contentHash: "doc-v0" }, document }],
      exportPreflight: { preflight: () => { throw new Error("no export") } },
      projectId: "p", runId: "r1"
    }
  })
  const events = []
  for await (const event of runtime.coordinator.start({ run: { runId: "r1", conversationId: "c1", promptMessageId: "m1",
    target: { projectId: "p", documentId: document.metadata.id, workspace: "geometry3d", epoch: "epoch", generation: 0,
      contentHash: "doc-v0" }, sources: [], textProfileId: "local", capabilityRevision: "r1", policyRevision: "local" }, userMessage: prompt })) events.push(event)
  expect(events.at(-1)?.phase).toBe("failed")
  expect(runtime.solveResult()?.status).toBe("partial")
  expect(runtime.solveResult()?.problemRevision).toBe(context.problemRevision)
  expect(writeDocument).not.toHaveBeenCalled()
})


it("only a fully parsed closed quadratic problem supplies host-owned verification facts", async () => {
  const { deriveTrustedMathFacts } = await import("./problemSolveService")
  const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
  const base = { runId: "quadratic", conversationId: "conv", attachments: [], corrections: [], sceneRevision: "scene" }
  const valid = await createSolveContext({ ...base, prompt: "已知二次函数 f(t)=-3t²-2t+5，t∈[-1,1]，求最大值。" }, hash)
  expect(deriveTrustedMathFacts(valid)).toEqual([{ kind: "quadratic-interval", goalId: valid.understanding.goals[0]!.goalId, quadratic: [-3, -2, 5],
    interval: { lower: -1, upper: 1, lowerClosed: true, upperClosed: true }, claim: "max" }])
  const incomplete = await createSolveContext({ ...base, prompt: "已知二次函数 f(t)=-3t²-2t+5，求最大值。" }, hash)
  expect(deriveTrustedMathFacts(incomplete)).toEqual([])
  const contradictory = await createSolveContext({ ...base, prompt: "已知二次函数 f(t)=-3t²-2t+5，t∈[-1,1]，求最大值。另外 f(t)=100。" }, hash)
  expect(deriveTrustedMathFacts(contradictory)).toEqual([])
})


it("the production service refutes a wrong quadratic value before delivery", async () => {
  const document = createEmptyDocument("conics")
  const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
  const prompt = "已知二次函数 f(t)=-3t²-2t+5，t∈[-1,1]，求最大值。"
  const context = await createSolveContext({ runId: "r-refute", conversationId: "c", prompt, attachments: [], corrections: [], sceneRevision: "doc-v0" }, hash)
  const goalId = context.understanding.goals[0]!.goalId
  const plan: PlanEnvelope = { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "max", factIds: [], answer: "最大值=2", toolResultRefs: [],
    goalAnswers: [{ goalId, kind: "numeric", displayText: "最大值=2", value: { kind: "numeric", expression: "2" }, evidenceRefs: [] }] }
  const writeDocument = vi.fn()
  const runtime = startProblemSolve({ context, session: createDefaultSolveSession("s"), flags: RELIABILITY_FLAGS_FOR_TESTS, hashText: hash, runtime: {
    planner: { plan: async () => ({ plan, requestId: "req", attemptId: "att" }) }, readDocument: () => document, writeDocument,
    readSceneDocuments: () => [{ handle: { projectId: "p", documentId: document.metadata.id, workspace: "conics", epoch: "e", generation: 0, contentHash: "doc-v0" }, document }],
    exportPreflight: { preflight: () => { throw new Error("no export") } }, projectId: "p", runId: "r-refute"
  } })
  const events = []
  for await (const event of runtime.coordinator.start({ run: { runId: "r-refute", conversationId: "c", promptMessageId: "m",
    target: { projectId: "p", documentId: document.metadata.id, workspace: "conics", epoch: "e", generation: 0, contentHash: "doc-v0" },
    sources: [], textProfileId: "local", capabilityRevision: "r", policyRevision: "p" }, userMessage: prompt })) events.push(event)
  expect(events.at(-1)?.phase).toBe("failed")
  expect(runtime.solveResult()?.reasonCodes).toContain("refuted_answer")
  expect(runtime.solveResult()?.evidence[0]?.candidateHash).toMatch(/^[0-9a-f]{64}$/)
  expect(writeDocument).not.toHaveBeenCalled()
})


it("the production service rejects identity mismatches before opening a draft", async () => {
  const document = createEmptyDocument("geometry3d")
  const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
  const context = await createSolveContext({ runId: "r", conversationId: "c", prompt: "求长度。", attachments: [], corrections: [], sceneRevision: "scene" }, hash)
  const input = { context, session: createDefaultSolveSession("s"), flags: RELIABILITY_FLAGS_FOR_TESTS, hashText: hash, runtime: {
    planner: { plan: async () => { throw new Error("must not run") } }, readDocument: () => document, writeDocument: vi.fn(), readSceneDocuments: () => [],
    exportPreflight: { preflight: () => { throw new Error("no export") } }, projectId: "p", runId: "different"
  } }
  expect(() => startProblemSolve(input)).toThrow(/identity/i)
})


it("a single shared production router preserves deterministic, model and offline paths", async () => {
  const { selectProblemPlanner } = await import("./problemSolveService")
  const planner = { plan: async () => ({ plan: { schemaVersion: "mathcanvas.plan.v1", kind: "answer" as const, goal: "offline", factIds: [], answer: "ok", toolResultRefs: [] }, requestId: "local", attemptId: "a" }) }
  const resolveProvider = vi.fn(async () => { throw new Error("provided planner must not contact provider") })
  const local = await selectProblemPlanner({ prompt: "建一个棱长 3 的立方体", imageNotes: "", planner, modelPlanner: { resolveProvider } })
  expect(resolveProvider).not.toHaveBeenCalled()
  expect(local.textProfileId).toBe("local-planner")
  const cloud = await selectProblemPlanner({ prompt: "请用模型解释一般数列", imageNotes: "", modelPlanner: {
    resolveProvider: async () => ({ ok: true as const, provider: { id: "model-a", modelId: "test", dialect: "openai_native", revision: 1, capabilities: { json: "unknown" as const, tools: "unknown" as const, vision: "unknown" as const } } })
  } })
  expect(cloud.textProfileId).toBe("model-a")
  const noProvider = await selectProblemPlanner({ prompt: "请用模型解释一般数列", imageNotes: "", modelPlanner: {
    resolveProvider: async () => ({ ok: false as const, code: "no_active_profile" as const, detail: "offline" })
  } })
  expect(noProvider.textProfileId).toBe("local-planner")
})


it("scenario harness exercises the same production router, runtime and answer gate", async () => {
  const { runProductionScenario } = await import("./fixtures/productionSolveScenario")
  const prompt = "已知二次函数 f(t)=-3t²-2t+5，t∈[-1,1]，求最大值。"
  const output = await runProductionScenario({ prompt, workspace: "conics", flags: "reliability", providerReplies: [
    { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "quadratic maximum", factIds: [], answer: "最大值=2", toolResultRefs: [] }
  ] })
  expect(output.providerCalls).toBe(1)
  expect(output.stageNames).toContain("answering")
  expect(output.stageNames.at(-1)).toBe("failed")
  expect(output.solveStatus).toBe("failed")
  expect(output.liveWrites).toBe(0)
  expect(output.auditEvents.map(item => item.kind)).toEqual(["understand", "verify", "accept"])
  expect(output.auditEvents.every(item => item.problemRevision.length === 64)).toBe(true)
  expect(output.auditEvents.find(item => item.kind === "verify")?.attemptId).toBe("attempt")
  expect(JSON.stringify(output.auditEvents)).not.toContain("f(t)=")
})

it("scenario source revision changes when attachment bytes change without leaking the bytes into audit", async () => {
  const { runProductionScenario } = await import("./fixtures/productionSolveScenario")
  const prompt = "如图，求立体体积。"
  const reply = { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "volume", factIds: [], answer: "体积=2", toolResultRefs: [] }
  const a = await runProductionScenario({ prompt, workspace: "geometry3d", flags: "reliability", providerReplies: [reply],
    attachments: [{ name: "exam.png", bytes: new TextEncoder().encode("private-picture-A") }] })
  const b = await runProductionScenario({ prompt, workspace: "geometry3d", flags: "reliability", providerReplies: [reply],
    attachments: [{ name: "exam.png", bytes: new TextEncoder().encode("private-picture-B") }] })
  expect(a.problemRevision).not.toBe(b.problemRevision)
  expect(JSON.stringify(a.auditEvents)).not.toContain("private-picture-A")
  expect(a.providerCalls).toBe(1)
})
