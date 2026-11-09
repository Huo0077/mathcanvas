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
  // W8：没有授权的独立配置时，被否证要说清"为什么停"与下一步，而不是只留一句 failed。
  expect(runtime.solveResult()?.reasonCodes).toContain("refuted_no_independent_profile")
  expect(runtime.solveResult()?.clarificationQuestions.length).toBeGreaterThan(0)
})


it("W11: an invalid flag combination is rejected before any model call", async () => {
  const document = createEmptyDocument("conics")
  const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
  const context = await createSolveContext({ runId: "r-flags", conversationId: "c", prompt: "求长度。", attachments: [], corrections: [], sceneRevision: "scene" }, hash)
  expect(() => startProblemSolve({
    context, session: createDefaultSolveSession("s-flags"),
    // 数学核验开着、目标跟踪关着：核验对象只能是猜出来的目标。
    flags: { answerSemanticsV1: true, goalTrackingV1: false, mathVerificationV1: true, imageRereadV1: false, orthographicTemplatesV1: false },
    hashText: hash,
    runtime: { planner: { plan: async () => { throw new Error("must not run") } }, readDocument: () => document, writeDocument: vi.fn(),
      readSceneDocuments: () => [], exportPreflight: { preflight: () => { throw new Error("no export") } }, projectId: "p", runId: "r-flags" }
  })).toThrow(/invalid reliability configuration/)
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


it("W8: an authorized independent profile turns a refutation into an explicit next step", async () => {
  const document = createEmptyDocument("conics")
  const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("")
  const prompt = "已知二次函数 f(t)=-3t²-2t+5，t∈[-1,1]，求最大值。"
  const context = await createSolveContext({ runId: "r-ind", conversationId: "c", prompt, attachments: [], corrections: [], sceneRevision: "doc-v0" }, hash)
  const goalId = context.understanding.goals[0]!.goalId
  const plan: PlanEnvelope = { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "max", factIds: [], answer: "最大值=2", toolResultRefs: [],
    goalAnswers: [{ goalId, kind: "numeric", displayText: "最大值=2", value: { kind: "numeric", expression: "2" }, evidenceRefs: [] }] }
  const runtime = startProblemSolve({ context, session: createDefaultSolveSession("s8"), flags: RELIABILITY_FLAGS_FOR_TESTS, hashText: hash,
    independentProfileAuthorized: true, runtime: {
      planner: { plan: async () => ({ plan, requestId: "req", attemptId: "att" }) }, readDocument: () => document, writeDocument: vi.fn(),
      readSceneDocuments: () => [{ handle: { projectId: "p", documentId: document.metadata.id, workspace: "conics", epoch: "e", generation: 0, contentHash: "doc-v0" }, document }],
      exportPreflight: { preflight: () => { throw new Error("no export") } }, projectId: "p", runId: "r-ind"
    } })
  for await (const _event of runtime.coordinator.start({ run: { runId: "r-ind", conversationId: "c", promptMessageId: "m",
    target: { projectId: "p", documentId: document.metadata.id, workspace: "conics", epoch: "e", generation: 0, contentHash: "doc-v0" },
    sources: [], textProfileId: "local", capabilityRevision: "r", policyRevision: "p" }, userMessage: prompt })) { /* drain */ }
  expect(runtime.solveResult()?.reasonCodes).toContain("independent_candidate_required")
  expect(runtime.solveResult()?.reasonCodes).not.toContain("refuted_no_independent_profile")
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

it("W4: a required image gap blocks delivery through the same production entry", async () => {
  const { runProductionScenario } = await import("./fixtures/productionSolveScenario")
  const prompt = "如图，求该几何体的体积。"
  const reply = { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "volume", factIds: [], answer: "体积=12", toolResultRefs: [] }
  const output = await runProductionScenario({ prompt, workspace: "geometry3d", flags: "reliability", providerReplies: [reply],
    attachments: [{ name: "exam.png", bytes: new TextEncoder().encode("picture") }],
    imageGaps: [{ code: "missing_dimension", message: "体积目标没有任何可核验的数值尺寸。", required: true }] })

  expect(output.solveStatus).not.toBe("answered")
  expect(output.stageNames.at(-1)).toBe("failed")
  expect(output.liveWrites).toBe(0)
  expect(output.auditEvents.find(item => item.kind === "image")?.status).toContain("missing_dimension")
})

it("routes a plain exam choice through read-only production service and leaves its answer unverified", async () => {
  const { runProductionScenario } = await import("./fixtures/productionSolveScenario")
  const output = await runProductionScenario({ prompt: "设 z=x+yi 满足 |z-i|=1，则\nA. x²+y²=1\nB. (x-1)²+y²=1\nC. x²+(y-1)²=1\nD. (x+1)²+y²=1",
    workspace: "conics", flags: "reliability",
    providerReplies: [{ schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "选择正确选项", factIds: [],
      answer: "圆心是(0,1)，最终答案：C。", toolResultRefs: [] }] })
  expect(output.requiredGoalCount).toBe(1)
  expect(output.requestedSkillIds).toEqual([])
  expect(output.stageNames.at(-1)).toBe("completed")
  expect(output.solveStatus).toBe("answered")
  expect(output.auditEvents.map(event => event.kind)).toContain("accept")
  expect(output.liveWrites).toBe(0)
  expect(output.providerCalls).toBe(1)
})

it("a required image fact gap still blocks an explicit final choice in production", async () => {
  const { runProductionScenario } = await import("./fixtures/productionSolveScenario")
  const output = await runProductionScenario({ prompt: "如图，几何体体积为（ ）", workspace: "geometry3d", flags: "reliability",
    attachments: [{ name: "sheet.png", bytes: new TextEncoder().encode("test image") }],
    providerReplies: [{ schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "体积", factIds: [],
      answer: "最终答案：B。", toolResultRefs: [] }],
    imageGaps: [{ code: "missing_dimension", message: "题图没有可核对的尺寸。", required: true }] })
  expect(output.solveStatus).not.toBe("answered")
  expect(output.liveWrites).toBe(0)
})

it("rejects a model drawing plan for an answer-only choice before staging a document", async () => {
  const { runProductionScenario } = await import("./fixtures/productionSolveScenario")
  const output = await runProductionScenario({ prompt: "几何体的体积为（ ）A. 6 B. 9 C. 12 D. 18", workspace: "geometry3d", flags: "reliability",
    providerReplies: [{ schemaVersion: "mathcanvas.plan.v1", kind: "plan", goal: "猜测立体", factIds: [],
      answer: "最终答案：B", actions: [{ actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } } }] }] })
  expect(output.stageNames.at(-1)).toBe("failed")
  expect(output.stageNames).not.toContain("compiling")
  expect(output.liveWrites).toBe(0)
})

it("rejects forged or missing structured goal answers instead of converting them to a valid choice", async () => {
  const { runProductionScenario } = await import("./fixtures/productionSolveScenario")
  const prompt = "设 z=x+yi 满足 |z-i|=1，则（ ）A. 甲 B. 乙 C. 丙 D. 丁"
  for (const goalAnswers of [
    [{ goalId: "foreign-goal", kind: "single_choice", displayText: "最终答案：C", value: { kind: "single_choice", optionId: "C" }, evidenceRefs: [] }],
    [{ goalId: "foreign-goal", kind: "single_choice", displayText: "最终答案：E", value: { kind: "single_choice", optionId: "E" }, evidenceRefs: [] }]
  ]) {
    const output = await runProductionScenario({ prompt, workspace: "conics", flags: "reliability", providerReplies: [
      { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "单选", factIds: [], answer: "最终答案：C。", goalAnswers, toolResultRefs: [] },
      { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "单选", factIds: [], answer: "最终答案：C。", goalAnswers, toolResultRefs: [] }
    ] })
    expect(output.solveStatus).not.toBe("answered")
    expect(output.liveWrites).toBe(0)
  }
})

it("rejects a structured choice when the visible final answer says no option matches", async () => {
  const { runProductionScenario } = await import("./fixtures/productionSolveScenario")
  const reply = (goalId: string) => ({ schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "离心率", factIds: [], toolResultRefs: [],
    answer: "计算后四个选项均不符合。最终答案：无匹配选项，请核对题设。", goalAnswers: [{ goalId,
      kind: "single_choice", displayText: "A", value: { kind: "single_choice", optionId: "A" }, evidenceRefs: [] }] })
  const output = await runProductionScenario({ prompt: "离心率是（ ）A. 1 B. 2 C. 3 D. 4", workspace: "conics", flags: "reliability", providerReplies: [reply] })
  expect(output.stageNames.at(-1)).toBe("failed")
  expect(output.solveStatus).not.toBe("answered")
  expect(output.liveWrites).toBe(0)
})

it("rejects a structured image option when the visible final answer asks the user to match the figure", async () => {
  const { runProductionScenario } = await import("./fixtures/productionSolveScenario")
  const reply = (goalId: string) => ({ schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "选图", factIds: [], toolResultRefs: [],
    answer: "函数可写为 f(x)=|sin 2x|。具体是 A/B/C/D 中哪一幅，需对照原题图确认。最终答案：以上述函数解析式对应的图象为准。",
    goalAnswers: [{ goalId, kind: "single_choice", displayText: "C", value: { kind: "single_choice", optionId: "C" }, evidenceRefs: [] }] })
  const output = await runProductionScenario({ prompt: "如图，下列图象是（ ）A. 图1 B. 图2 C. 图3 D. 图4", workspace: "conics", flags: "reliability", providerReplies: [reply] })
  expect(output.stageNames.at(-1)).toBe("failed")
  expect(output.solveStatus).not.toBe("answered")
})
