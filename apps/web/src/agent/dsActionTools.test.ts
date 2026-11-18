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
    expect(schemas.map((s) => s.function.name)).toEqual([...DS_ACTION_CLOSED_SET])

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

  it("Task 0 fail-closed gate: empty finish_candidate and unsupported observations never fake accepted with 0 primitives", () => {
    const families = [
      { kind: "square_pyramid", sideLength: 2, height: 3 },
      { kind: "triangular_prism", sideLength: 3, height: 4 },
      { kind: "tetrahedron", edgeLength: 2 }
    ]

    for (const input of families) {
      const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
      const badFace = session.execute("construct_face", { alias: "F1", vertexNames: ["A", "B", "C"] })
      expect(badFace.ok).toBe(false)
      expect(badFace.stateChanged).toBe(false)

      const badObs = session.execute("query_measurement", { metric: "unsupported_custom_metric", targets: ["A", "B"] })
      expect(badObs.ok).toBe(false)
      expect(badObs.status).toBe("blocked")
      expect(badObs.blockerCode).toBe("unsupported_observation")

      const finish = session.execute("finish_candidate", { goal: `empty-${input.kind}` })
      expect(finish.ok).toBe(false)
      expect(finish.status).toBe("repairable")
      expect(finish.blockerCode).toBe("empty_candidate")
      expect(finish.terminated).toBeUndefined()
    }
  })

  it("Task 1 parametric construct_solid: materializes regular_pyramid, prism, perpendicular_pyramid, and tetrahedron into SpeculativeCanvas and rejects invalid specs", () => {
    // 1. regular_pyramid / square_pyramid
    const s1 = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const hashBefore = s1.currentSnapshot().candidateHash
    const r1 = s1.execute("construct_solid", { id: "S1", kind: "square_pyramid", sideLength: 2, height: 3 })
    expect(r1.ok).toBe(true)
    expect(r1.status).toBe("accepted")
    expect(r1.stateChanged).toBe(true)
    expect(r1.primitiveCount).toBeGreaterThan(0)
    expect(r1.candidateHash).not.toBe(hashBefore)
    const fin1 = s1.execute("finish_candidate", { goal: "正四棱锥" })
    expect(fin1.terminated?.plan.kind).toBe("plan")
    expect(s1.currentSnapshot().actions[0]?.actionId).toBe("solid.create_polyhedron")
    const polyInputs1 = s1.currentSnapshot().actions[0]?.inputs as { vertices: Array<{ x: number; y: number; z: number }>; faces: number[][]; vertexNames: string[] }
    expect(polyInputs1.vertices).toHaveLength(5)
    expect(polyInputs1.faces).toHaveLength(5)
    expect(Math.max(...polyInputs1.vertices.map((v) => v.z))).toBeCloseTo(3, 6)

    // 2. prism (triangular_prism)
    const s2 = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const r2 = s2.execute("construct_solid", { id: "S2", kind: "triangular_prism", sideLength: 3, height: 4 })
    expect(r2.ok).toBe(true)
    expect(r2.stateChanged).toBe(true)
    expect(r2.primitiveCount).toBeGreaterThan(0)
    const fin2 = s2.execute("finish_candidate", { goal: "正三棱柱" })
    expect(fin2.terminated?.plan.kind).toBe("plan")

    // 3. perpendicular_pyramid
    const s3 = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const r3 = s3.execute("construct_solid", { id: "S3", kind: "perpendicular_pyramid", sideLength: 4, height: 5, footName: "A", apexName: "S" })
    expect(r3.ok).toBe(true)
    expect(r3.stateChanged).toBe(true)
    const polyInputs3 = s3.currentSnapshot().actions[0]?.inputs as { vertices: Array<{ x: number; y: number; z: number }>; vertexNames: string[] }
    const sIdx = polyInputs3.vertexNames.indexOf("S")
    expect(sIdx).toBeGreaterThanOrEqual(0)
    expect(polyInputs3.vertices[sIdx]?.z).toBeCloseTo(5, 6)

    // 4. tetrahedron
    const s4 = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const r4 = s4.execute("construct_solid", { id: "S4", kind: "tetrahedron", edgeLength: 2 })
    expect(r4.ok).toBe(true)
    expect(r4.stateChanged).toBe(true)
    const polyInputs4 = s4.currentSnapshot().actions[0]?.inputs as { vertices: Array<{ x: number; y: number; z: number }>; faces: number[][] }
    expect(polyInputs4.vertices).toHaveLength(4)
    expect(polyInputs4.faces).toHaveLength(4)

    // Negative counterexamples: missing dimensions, impossible triangle, duplicate names, hand vertices, undeclared base refs
    const negMissing = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const mRes = negMissing.execute("construct_solid", { id: "Bad1", kind: "regular_pyramid", sideLength: 2 })
    expect(mRes.ok).toBe(false)
    expect(mRes.blockerCode).toBe("missing_required_parameter")
    expect(negMissing.currentSnapshot().actions).toHaveLength(0)

    const negImpossible = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const iRes = negImpossible.execute("construct_solid", { id: "Bad2", kind: "tetrahedron", ab: 1, ac: 1, bc: 10, pa: 2, pb: 2, pc: 2 })
    expect(iRes.ok).toBe(false)
    expect(iRes.status).toBe("blocked")
    expect(negImpossible.currentSnapshot().actions).toHaveLength(0)

    const negDup = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const dRes = negDup.execute("construct_solid", { id: "Bad3", kind: "tetrahedron", edgeLength: 2, vertexNames: ["P", "A", "A", "C"] })
    expect(dRes.ok).toBe(false)
    expect(negDup.currentSnapshot().actions).toHaveLength(0)

    const negHand = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const hRes = negHand.execute("construct_solid", { id: "Bad4", kind: "tetrahedron", vertices: [{ x: 0, y: 0, z: 0 }] })
    expect(hRes.ok).toBe(false)
    expect(hRes.blockerCode).toBe("hand_computed_vertices_forbidden")
    expect(negHand.currentSnapshot().actions).toHaveLength(0)

    const negUndeclared = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const uRes = negUndeclared.execute("construct_solid", { id: "Bad5", kind: "prism", baseVertexNames: ["X", "Y", "Z"], height: 3 })
    expect(uRes.ok).toBe(false)
    expect(uRes.blockerCode).toBe("undeclared_entity_ref")
    expect(negUndeclared.currentSnapshot().actions).toHaveLength(0)
  })

  it("Task 2 real construct_base, construct_face, construct_fold_state, query_measurement, and query_constraint_status with rollback hygiene", () => {
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })

    // 1. construct_base requires real parameters (missing rejected) then materializes rectangle ABCD
    const badBase = session.execute("construct_base", { shape: "rectangle" })
    expect(badBase.ok).toBe(false)
    expect(session.currentSnapshot().actions).toHaveLength(0)

    const baseRes = session.execute("construct_base", { id: "BASE", shape: "rectangle", width: 4, depth: 2, vertexNames: ["A", "B", "C", "D"] })
    expect(baseRes.ok).toBe(true)
    expect(baseRes.stateChanged).toBe(true)
    expect(baseRes.primitiveCount).toBeGreaterThan(0)
    const primsAfterBase = baseRes.primitiveCount

    // 2. query_measurement reads actual AB length = 4, blocks missing/rolled-back points
    const distAB = session.execute("query_measurement", { metric: "distance", targets: ["A", "B"] })
    expect(distAB.ok).toBe(true)
    expect(distAB.stateChanged).toBe(false)
    expect(distAB.measurement?.value).toBeCloseTo(4, 9)
    expect(distAB.measurement?.sourceEntityIds).toEqual(["A", "B"])

    // Stage a temporary 3D point, confirm measurable, then rollback and ensure query_measurement rejects stale access
    const tempPt = session.execute("construct_point", { id: "P_TEMP", x: 1, y: 1, z: 3 })
    expect(tempPt.ok).toBe(true)
    expect(session.execute("query_measurement", { metric: "position", target: "P_TEMP" }).ok).toBe(true)
    const rolled = session.execute("repair_entity", {})
    expect(rolled.stateChanged).toBe(true)
    const afterRollbackQuery = session.execute("query_measurement", { metric: "position", target: "P_TEMP" })
    expect(afterRollbackQuery.ok).toBe(false)
    expect(afterRollbackQuery.blockerCode).toBe("undeclared_entity_ref")

    // 3. construct_point off-plane -> verify non-coplanar face rejection; coplanar face accepted
    expect(session.execute("construct_point", { id: "P", x: 0, y: 0, z: 3 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "Q_NONCOPLANAR", x: 1, y: 1, z: 2 }).ok).toBe(true)
    const nonCoplanarFace = session.execute("construct_face", { id: "BAD_F", vertexNames: ["A", "B", "C", "Q_NONCOPLANAR"] })
    expect(nonCoplanarFace.ok).toBe(false)
    expect(nonCoplanarFace.blockerCode).toBe("non_coplanar_face")

    const collinearPt = session.execute("construct_point", { id: "MID_AB", from: "A", to: "B", ratio: 0.5 })
    expect(collinearPt.ok).toBe(true)
    const collinearFace = session.execute("construct_face", { id: "COL_F", vertexNames: ["A", "MID_AB", "B"] })
    expect(collinearFace.ok).toBe(false)
    expect(collinearFace.blockerCode).toBe("degenerate_face")

    const validFace = session.execute("construct_face", { id: "FACE_PAB", vertexNames: ["P", "A", "B"] })
    expect(validFace.ok).toBe(true)
    expect(validFace.stateChanged).toBe(true)
    expect(validFace.primitiveCount).toBeGreaterThan(primsAfterBase)

    // 4. query_constraint_status reads real coplanar / distance kernel verdict & residual
    const checkCoplanar = session.execute("query_constraint_status", { kind: "coplanar", targets: ["A", "B", "C", "D"] })
    expect(checkCoplanar.ok).toBe(true)
    expect(checkCoplanar.constraintStatus).toBe("satisfied")
    expect(Number(checkCoplanar.measurement?.residual ?? 999)).toBeLessThan(1e-9)

    const checkWrongDist = session.execute("query_constraint_status", { kind: "fixed_distance", targets: ["A", "B"], expected: 10 })
    expect(checkWrongDist.ok).toBe(true)
    expect(checkWrongDist.constraintStatus).toBe("violated")

    // 5. construct_fold_state produces distinct pre_fold / post_fold lineage hashes
    const foldSession = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    expect(foldSession.execute("construct_base", { id: "RECT", shape: "rectangle", width: 4, depth: 2, vertexNames: ["A", "B", "C", "D"] }).ok).toBe(true)
    expect(foldSession.execute("construct_face", { id: "FIXED", vertexNames: ["A", "C", "D"] }).ok).toBe(true)
    const badFold = foldSession.execute("construct_fold_state", { vertexNames: ["A", "B", "C"], hinge: { from: "A", to: "C" }, apex: "B", apexAs: "B′", angle: 0 })
    expect(badFold.ok).toBe(false)

    const goodFold = foldSession.execute("construct_fold_state", {
      id: "FOLD_ABC",
      vertexNames: ["A", "B", "C"],
      hinge: { from: "A", to: "C" },
      apex: "B",
      apexAs: "B′",
      angle: 90,
      scopeId: "shared",
      stateId: "after_fold"
    })
    expect(goodFold.ok).toBe(true)
    expect(goodFold.stateChanged).toBe(true)
    const slices = foldSession.stateSlices()
    expect(slices.length).toBeGreaterThanOrEqual(2)
    const hashSet = new Set(slices.map((s) => s.candidateHash))
    expect(hashSet.size).toBe(slices.length)
  })
})
