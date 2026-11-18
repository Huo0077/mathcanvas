import { createBudget, DS_ACTION_CLOSED_SET } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import {
  buildDsActionToolSchemas,
  createDsActionSession,
  DS_ACTION_TOOL_NAMES,
  parseDsActionToolCall
} from "./dsActionTools"
import { createModelPlanner } from "./modelPlanner"
import { buildSystemPrompt, DS_ACTION_PROMPT_VERSION } from "./systemPrompt"

function plannerRequest(userMessage = "作线段 AB") {
  return {
    run: {
      runId: "ds-action-run-1",
      conversationId: "ds-action-conv-1",
      promptMessageId: "msg-1",
      target: {
        projectId: "local",
        documentId: "doc-1",
        workspace: "conics" as const,
        epoch: "epoch-1",
        generation: 0,
        contentHash: "empty"
      },
      sources: [],
      textProfileId: "deepseek",
      capabilityRevision: "2026-09-19.1",
      policyRevision: "local"
    },
    userMessage,
    budget: createBudget(),
    signal: new AbortController().signal,
    model: {
      tools: [
        {
          id: "plan.set_plan",
          kind: "control" as const,
          effect: "propose_plan" as const,
          description: "Propose plan",
          phases: ["planning" as const],
          workspaces: []
        }
      ],
      context: {
        preamble: "MathCanvas",
        handles: {
          target: {
            projectId: "local",
            documentId: "doc-1",
            workspace: "conics" as const,
            epoch: "epoch-1",
            generation: 0,
            contentHash: "empty"
          },
          sources: []
        },
        binding: { conversationId: "ds-action-conv-1", projectId: "local", documentId: "doc-1", generation: 0 },
        workspace: "conics" as const,
        facts: [],
        derived: [],
        selectedRefs: [],
        skills: [],
        availableActions: [],
        warnings: [],
        estimatedCharacters: 64
      }
    },
    conversation: {
      binding: { conversationId: "ds-action-conv-1", projectId: "local", documentId: "doc-1", workspace: "conics" as const, generation: 0 },
      summary: "",
      facts: [],
      messages: [],
      observation: { facts: [], summary: "" },
      warnings: [],
      estimatedCharacters: 0
    }
  }
}

describe("dsActionTools (Task F2 closed action-level protocol)", () => {
  it("exposes all 22 closed DS actions matching @draw/agent-core and parses single-action tri-state calls", () => {
    expect(DS_ACTION_TOOL_NAMES).toEqual(DS_ACTION_CLOSED_SET)
    expect(DS_ACTION_TOOL_NAMES).toHaveLength(22)

    const schemas = buildDsActionToolSchemas()
    expect(schemas.length).toBeGreaterThan(0)
    expect(schemas.every((s) => DS_ACTION_CLOSED_SET.includes(s.function.name))).toBe(true)
    const published = schemas.map((s) => s.function.name)
    expect(published).toContain("construct_point")
    expect(published).toContain("finish_candidate")
    expect(published).not.toContain("construct_base")
    expect(published).not.toContain("construct_fold_state")

    const prompt = buildSystemPrompt({
      context: plannerRequest().model.context,
      channel: "native_tools",
      canPlan: true,
      intentMode: "ds_action"
    })
    expect(prompt.version).toBe(DS_ACTION_PROMPT_VERSION)
    expect(prompt.policy).toContain("finish_candidate")

    const bad = parseDsActionToolCall("construct_intersection", "not-an-object")
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.status).toBe("repairable")

    const unknown = parseDsActionToolCall("invented_tool", {})
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.status).toBe("blocked")
  })

  it("executes multi-turn single-action construction onto SpeculativeCanvas and compiles finish_candidate without monolithic JSON", async () => {
    let turn = 0
    const seenToolNames: string[][] = []
    const planner = createModelPlanner({
      intentMode: "ds_action",
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
        turn += 1
        seenToolNames.push(req.tools.map((t) => (t as { function: { name: string } }).function.name))
        if (turn === 1) {
          return {
            ok: true,
            events: [
              {
                kind: "tool_call",
                requestId: "r-1",
                attemptId: "a-1",
                toolCallId: "act-1",
                toolId: "construct_point",
                input: { id: "A", label: "A", x: 0, y: 0 }
              }
            ]
          }
        }
        if (turn === 2) {
          return {
            ok: true,
            events: [
              {
                kind: "tool_call",
                requestId: "r-2",
                attemptId: "a-2",
                toolCallId: "act-2",
                toolId: "construct_point",
                input: { id: "B", label: "B", x: 3, y: 0 }
              }
            ]
          }
        }
        if (turn === 3) {
          return {
            ok: true,
            events: [
              {
                kind: "tool_call",
                requestId: "r-3",
                attemptId: "a-3",
                toolCallId: "act-3",
                toolId: "construct_segment",
                input: { id: "AB", from: "A", to: "B" }
              }
            ]
          }
        }
        return {
          ok: true,
          events: [
            {
              kind: "tool_call",
              requestId: "r-4",
              attemptId: "a-4",
              toolCallId: "act-4",
              toolId: "finish_candidate",
              input: { goal: "作线段 AB" }
            }
          ]
        }
      }
    })

    const outcome = await planner.plan(plannerRequest())
    expect("plan" in outcome).toBe(true)
    if (!("plan" in outcome) || outcome.plan.kind !== "plan") return
    expect(seenToolNames[0]).toContain("construct_point")
    expect(seenToolNames[0]).toContain("finish_candidate")
    expect(outcome.plan.actions.map((a) => a.actionId)).toEqual([
      "planar.create_point",
      "planar.create_point",
      "planar.create_segment"
    ])
  })

  it("rejects duplicate toolCallId, blocks mixed read+action batches, handles request_clarification, and honors AbortSignal", async () => {
    const dupPlanner = createModelPlanner({
      intentMode: "ds_action",
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
      runModel: (() => {
        let count = 0
        return async () => {
          count += 1
          return {
            ok: true,
            events: [
              {
                kind: "tool_call" as const,
                requestId: `r-${count}`,
                attemptId: `a-${count}`,
                toolCallId: "same-call-id",
                toolId: "construct_point",
                input: { id: `P${count}`, x: count, y: 0 }
              }
            ]
          }
        }
      })()
    })
    await expect(dupPlanner.plan(plannerRequest())).rejects.toThrow(/duplicate tool call id/i)

    const mixedPlanner = createModelPlanner({
      intentMode: "ds_action",
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
          { kind: "tool_call", requestId: "r-mix", attemptId: "a-mix", toolCallId: "tc-1", toolId: "scene_inspect", input: {} },
          { kind: "tool_call", requestId: "r-mix", attemptId: "a-mix", toolCallId: "tc-2", toolId: "construct_point", input: { id: "A", x: 0, y: 0 } }
        ]
      })
    })
    await expect(mixedPlanner.plan(plannerRequest())).rejects.toThrow(/mixes a read tool/i)

    const clarifyPlanner = createModelPlanner({
      intentMode: "ds_action",
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
          {
            kind: "tool_call",
            requestId: "r-clar",
            attemptId: "a-clar",
            toolCallId: "clar-1",
            toolId: "request_clarification",
            input: { reason: "缺少题图", questions: ["请上传题目附图"] }
          }
        ]
      })
    })
    const clarOutcome = await clarifyPlanner.plan(plannerRequest())
    expect("plan" in clarOutcome && clarOutcome.plan.kind === "clarification").toBe(true)

    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    const badIntersect = session.execute("construct_intersection", { lineA: "L1", lineB: "L2", output: "X" })
    expect(badIntersect.status).toBe("repairable")

    const controller = new AbortController()
    controller.abort()
    const abortReq = { ...plannerRequest(), signal: controller.signal }
    await expect(clarifyPlanner.plan(abortReq)).rejects.toThrow(/已取消|cancelled/i)
  })

  it("Task 0 fail-closed gate: unimplemented 3D/query actions never fake accepted with 0 primitives", () => {
    const families = [
      { kind: "square_pyramid", sideLength: 2, height: 3 },
      { kind: "triangular_prism", sideLength: 3, height: 4 },
      { kind: "tetrahedron", edgeLength: 2 }
    ]

    for (const input of families) {
      const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
      const solidRes = session.execute("construct_solid", input)
      expect(solidRes.ok).toBe(false)
      expect(solidRes.status).toBe("blocked")
      expect(solidRes.blockerCode).toBe("unsupported_action")
      expect(solidRes.stateChanged).toBe(false)
      expect(solidRes.primitiveCount).toBe(0)

      const faceRes = session.execute("construct_face", { alias: "F1", vertexNames: ["A", "B", "C"] })
      expect(faceRes.ok).toBe(false)
      expect(faceRes.status).toBe("blocked")
      expect(faceRes.blockerCode).toBe("unsupported_action")
      expect(faceRes.stateChanged).toBe(false)

      const baseRes = session.execute("construct_base", { shape: "square", sideLength: 2 })
      expect(baseRes.ok).toBe(false)
      expect(baseRes.status).toBe("blocked")
      expect(baseRes.blockerCode).toBe("unsupported_action")

      const foldRes = session.execute("construct_fold_state", { hinge: { from: "A", to: "C" }, angle: 90 })
      expect(foldRes.ok).toBe(false)
      expect(foldRes.status).toBe("blocked")
      expect(foldRes.blockerCode).toBe("unsupported_action")

      const queryM = session.execute("query_measurement", { metric: "distance", targets: ["A", "B"] })
      expect(queryM.ok).toBe(false)
      expect(queryM.status).toBe("blocked")

      const queryC = session.execute("query_constraint_status", { targets: ["A", "B"] })
      expect(queryC.ok).toBe(false)
      expect(queryC.status).toBe("blocked")

      const finish = session.execute("finish_candidate", {})
      expect(finish.ok).toBe(false)
      expect(finish.status).toBe("repairable")
      expect(finish.blockerCode).toBe("empty_candidate")
      expect(finish.terminated).toBeUndefined()
    }
  })
})
