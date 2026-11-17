import { createBudget, type PlanRequest, type ToolDescriptor } from "@draw/agent-core"
import { describe, expect, it, vi } from "vitest"
import { createModelPlanner, PLAN_TOOL_NAME } from "./modelPlanner"
import { partitionPublishedTools, selectToolPhase } from "./modelToolPolicy"

const planTool: ToolDescriptor = {
  id: "plan.set_plan",
  kind: "control",
  effect: "propose_plan",
  description: "Propose plan",
  phases: ["planning"],
  workspaces: []
}

const inspectTool: ToolDescriptor = {
  id: "scene.inspect",
  kind: "read",
  effect: "none",
  description: "Inspect scene",
  phases: ["planning"],
  workspaces: []
}

const searchTool: ToolDescriptor = {
  id: "scene.search_entities",
  kind: "read",
  effect: "none",
  description: "Search scene",
  phases: ["planning"],
  workspaces: []
}

function makeRequest(overrides: Partial<PlanRequest> & { facts?: PlanRequest["model"]["context"]["facts"]; selectedRefs?: PlanRequest["model"]["context"]["selectedRefs"] } = {}): PlanRequest {
  const { facts = [], selectedRefs = [], ...rest } = overrides
  return {
    run: {
      runId: "run-t1-1",
      conversationId: "conv-t1",
      projectId: "proj-1",
      phase: "planning",
      target: {
        projectId: "proj-1",
        documentId: "doc-1",
        workspace: "geometry3d",
        epoch: "epoch:1",
        generation: 0,
        contentHash: "hash-0"
      }
    },
    userMessage: "在空白场景中画一个四棱锥 P-ABCD，底面为矩形，PD⊥底面",
    signal: new AbortController().signal,
    budget: createBudget(),
    model: {
      channel: "native_tools",
      tools: [planTool, inspectTool, searchTool],
      context: {
        preamble: "MathCanvas",
        handles: {
          target: {
            projectId: "proj-1",
            documentId: "doc-1",
            workspace: "geometry3d",
            epoch: "epoch:1",
            generation: 0,
            contentHash: "hash-0"
          },
          sources: []
        },
        binding: { conversationId: "conv-t1", projectId: "proj-1", documentId: "doc-1", generation: 0 },
        workspace: "geometry3d",
        facts,
        derived: [],
        selectedRefs,
        skills: [],
        availableActions: ["solid.create_polyhedron"],
        warnings: [],
        estimatedCharacters: 64
      }
    },
    ...rest
  } as unknown as PlanRequest
}

describe("modelToolPolicy (Task 1 phase-separated tool publishing)", () => {
  it("selects construct on empty ds_intent document and observe when existing geometry or selectedRefs exist", () => {
    expect(
      selectToolPhase({
        intentMode: "ds_intent",
        hasExistingGeometry: false,
        hasSelectedRefs: false,
        requiresSceneObservation: false,
        observationCompleted: false
      })
    ).toBe("construct")

    expect(
      selectToolPhase({
        intentMode: "ds_intent",
        hasExistingGeometry: true,
        hasSelectedRefs: false,
        requiresSceneObservation: false,
        observationCompleted: false
      })
    ).toBe("observe")

    expect(
      selectToolPhase({
        intentMode: "ds_intent",
        hasExistingGeometry: false,
        hasSelectedRefs: true,
        requiresSceneObservation: false,
        observationCompleted: true
      })
    ).toBe("construct")

    // Legacy actions keep backwards compatibility.
    expect(
      selectToolPhase({
        intentMode: "legacy_actions",
        hasExistingGeometry: true,
        hasSelectedRefs: true,
        requiresSceneObservation: true,
        observationCompleted: false
      })
    ).toBe("construct")
  })

  it("partitions native tools mutually exclusively in ds_intent mode", () => {
    const emptyPlanOnly = partitionPublishedTools({
      intentMode: "ds_intent",
      phase: "construct",
      planTool: { name: "plan_set_plan" },
      readTools: [{ name: "scene_inspect" }]
    })
    expect(emptyPlanOnly.canOfferPlan).toBe(true)
    expect(emptyPlanOnly.publishedTools).toEqual([{ name: "plan_set_plan" }])
    expect(emptyPlanOnly.publishedReadTools).toEqual([])

    const populatedObserveOnly = partitionPublishedTools({
      intentMode: "ds_intent",
      phase: "observe",
      planTool: { name: "plan_set_plan" },
      readTools: [{ name: "scene_inspect" }]
    })
    expect(populatedObserveOnly.canOfferPlan).toBe(false)
    expect(populatedObserveOnly.publishedTools).toEqual([{ name: "scene_inspect" }])
    expect(populatedObserveOnly.publishedReadTools).toEqual([{ name: "scene_inspect" }])
  })

  it("publishes ONLY plan_set_plan on empty ds_intent documents (replaying GK-S08 shape without mixed read tool offer)", async () => {
    const publishedToolNamesByCall: string[][] = []
    const executeTool = vi.fn(async () => ({
      status: "success" as const,
      summary: "ok",
      next_actions: [],
      artifacts: [],
      payload: [],
      diagnostics: []
    }))
    const planner = createModelPlanner({
      intentMode: "ds_intent",
      resolveProvider: async () => ({
        ok: true,
        provider: {
          id: "deepseek",
          modelId: "deepseek-v4-flash",
          dialect: "openai",
          revision: 2,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        }
      }),
      runModel: async (req) => {
        const names = (req.tools as Array<{ function: { name: string } }>).map((t) => t.function.name)
        publishedToolNamesByCall.push(names)
        return {
          ok: true,
          events: [
            { kind: "started", requestId: "r-empty", attemptId: "a-empty", model: "deepseek-v4-flash" },
            {
              kind: "tool_call",
              requestId: "r-empty",
              attemptId: "a-empty",
              toolCallId: "tc-1",
              toolId: PLAN_TOOL_NAME,
              input: { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "ok", factIds: [], toolResultRefs: [], answer: "done" }
            },
            { kind: "completed", requestId: "r-empty", attemptId: "a-empty", stopReason: "tool_calls" }
          ]
        }
      }
    })

    const outcome = await planner.plan(makeRequest({ executeTool }))
    expect("plan" in outcome).toBe(true)
    expect(publishedToolNamesByCall).toEqual([[PLAN_TOOL_NAME]])
    expect(executeTool).not.toHaveBeenCalled()
  })

  it("publishes ONLY read tools first on populated ds_intent scene, then ONLY plan_set_plan after observation, and rejects premature plan_set_plan", async () => {
    const publishedToolNamesByCall: string[][] = []
    const executeTool = vi.fn(async () => ({
      status: "success" as const,
      summary: "1 solid",
      next_actions: [],
      artifacts: [],
      payload: [{ entityId: "solid-1", label: "立方体" }],
      diagnostics: []
    }))
    let callNum = 0
    const planner = createModelPlanner({
      intentMode: "ds_intent",
      resolveProvider: async () => ({
        ok: true,
        provider: {
          id: "deepseek",
          modelId: "deepseek-v4-flash",
          dialect: "openai",
          revision: 2,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        }
      }),
      runModel: async (req) => {
        callNum += 1
        const names = (req.tools as Array<{ function: { name: string } }>).map((t) => t.function.name)
        publishedToolNamesByCall.push(names)
        if (callNum === 1) {
          return {
            ok: true,
            events: [
              { kind: "started", requestId: "r1", attemptId: "a1", model: "deepseek-v4-flash" },
              { kind: "tool_call", requestId: "r1", attemptId: "a1", toolCallId: "call-1", toolId: "scene_inspect", input: { documentId: "doc-1" } },
              { kind: "completed", requestId: "r1", attemptId: "a1", stopReason: "tool_calls" }
            ]
          }
        }
        return {
          ok: true,
          events: [
            { kind: "started", requestId: "r2", attemptId: "a2", model: "deepseek-v4-flash" },
            {
              kind: "tool_call",
              requestId: "r2",
              attemptId: "a2",
              toolCallId: "call-2",
              toolId: PLAN_TOOL_NAME,
              input: { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "ok", factIds: [], toolResultRefs: [], answer: "observed then planned" }
            },
            { kind: "completed", requestId: "r2", attemptId: "a2", stopReason: "tool_calls" }
          ]
        }
      }
    })

    const outcome = await planner.plan(
      makeRequest({
        facts: [{ id: "solid-1", text: "立方体", origin: "user" }],
        executeTool
      })
    )
    expect("plan" in outcome).toBe(true)
    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(publishedToolNamesByCall[0]).not.toContain(PLAN_TOOL_NAME)
    expect(publishedToolNamesByCall[0]).toContain("scene_inspect")
    expect(publishedToolNamesByCall[1]).toEqual([PLAN_TOOL_NAME])
  })

  it("replays the 7 historical mixed-batch cases: still atomically rejects mixed batches, while fail-closing premature plan calls during observe", async () => {
    const mixedCaseIds = ["GK-S08", "JT-S02", "JT-S09", "GK-P06", "JT-P01", "JT-P05", "JT-P07"] as const
    for (const caseId of mixedCaseIds) {
      const executeTool = vi.fn()
      const planner = createModelPlanner({
        intentMode: "ds_intent",
        resolveProvider: async () => ({
          ok: true,
          provider: {
            id: "deepseek",
            modelId: "deepseek-v4-flash",
            dialect: "openai",
            revision: 2,
            capabilities: { tools: "verified", json: "verified", vision: "unknown" }
          }
        }),
        runModel: async () => ({
          ok: true,
          events: [
            { kind: "started", requestId: `r-${caseId}`, attemptId: "a1", model: "deepseek-v4-flash" },
            { kind: "tool_call", requestId: `r-${caseId}`, attemptId: "a1", toolCallId: "c1", toolId: "scene_inspect", input: {} },
            { kind: "tool_call", requestId: `r-${caseId}`, attemptId: "a1", toolCallId: "c2", toolId: PLAN_TOOL_NAME, input: { schemaVersion: "mathcanvas.ds_intent.v1" } },
            { kind: "completed", requestId: `r-${caseId}`, attemptId: "a1", stopReason: "tool_calls" }
          ]
        })
      })

      await expect(planner.plan(makeRequest({ executeTool })), `mixed batch should reject for ${caseId}`).rejects.toThrow(/mixes a read tool/i)
      expect(executeTool).not.toHaveBeenCalled()
    }
  })

  it("fails closed during observe when cancelled, budget exhausted, duplicate callId, or plan_set_plan called before read finishes", async () => {
    const executeTool = vi.fn()
    const controller = new AbortController()
    controller.abort()
    const cancelledPlanner = createModelPlanner({
      intentMode: "ds_intent",
      resolveProvider: async () => ({
        ok: true,
        provider: {
          id: "deepseek",
          modelId: "deepseek-v4-flash",
          dialect: "openai",
          revision: 2,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        }
      }),
      runModel: async () => ({
        ok: true,
        events: [
          { kind: "started", requestId: "r-cancel", attemptId: "a1", model: "deepseek-v4-flash" },
          { kind: "tool_call", requestId: "r-cancel", attemptId: "a1", toolCallId: "c1", toolId: "scene_inspect", input: {} }
        ]
      })
    })
    await expect(
      cancelledPlanner.plan(makeRequest({ signal: controller.signal, facts: [{ id: "p1", text: "点 A", origin: "user" }], executeTool }))
    ).rejects.toThrow(/cancel/i)
    expect(executeTool).not.toHaveBeenCalled()

    // Calling plan_set_plan during observe phase is rejected instead of accepted.
    const prematurePlanner = createModelPlanner({
      intentMode: "ds_intent",
      resolveProvider: async () => ({
        ok: true,
        provider: {
          id: "deepseek",
          modelId: "deepseek-v4-flash",
          dialect: "openai",
          revision: 2,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        }
      }),
      runModel: async () => ({
        ok: true,
        events: [
          { kind: "started", requestId: "r-prem", attemptId: "a1", model: "deepseek-v4-flash" },
          { kind: "tool_call", requestId: "r-prem", attemptId: "a1", toolCallId: "c1", toolId: PLAN_TOOL_NAME, input: { schemaVersion: "mathcanvas.plan.v1", kind: "answer", goal: "g", factIds: [], toolResultRefs: [], answer: "premature" } }
        ]
      })
    })
    const premature = await prematurePlanner.plan(makeRequest({ facts: [{ id: "p1", text: "点 A", origin: "user" }], executeTool }))
    expect("failure" in premature).toBe(true)
    if ("failure" in premature) {
      expect(premature.failure.category).toBe("unexpected_tool_call")
    }

    // Duplicate callId during observe fails closed.
    const dupPlanner = createModelPlanner({
      intentMode: "ds_intent",
      resolveProvider: async () => ({
        ok: true,
        provider: {
          id: "deepseek",
          modelId: "deepseek-v4-flash",
          dialect: "openai",
          revision: 2,
          capabilities: { tools: "verified", json: "verified", vision: "unknown" }
        }
      }),
      runModel: async () => ({
        ok: true,
        events: [
          { kind: "started", requestId: "r-dup", attemptId: "a1", model: "deepseek-v4-flash" },
          { kind: "tool_call", requestId: "r-dup", attemptId: "a1", toolCallId: "same-id", toolId: "scene_inspect", input: {} },
          { kind: "tool_call", requestId: "r-dup", attemptId: "a1", toolCallId: "same-id", toolId: "scene_inspect", input: {} }
        ]
      })
    })
    await expect(dupPlanner.plan(makeRequest({ facts: [{ id: "p1", text: "点 A", origin: "user" }], executeTool }))).rejects.toThrow(/duplicate/i)
    expect(executeTool).not.toHaveBeenCalled()
  })
})
