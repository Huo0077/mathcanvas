import { createBudget, DS_ACTION_CLOSED_SET, compilePlan } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import drawingContracts36 from "../../../../test-fixtures/reliability/drawing-contracts-36.json"
import {
  buildDsActionToolSchemas,
  createDsActionSession,
  DS_ACTION_TOOL_NAMES,
  SOLID_KIND_FAMILIES,
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

describe("simple symbolic equal-edge prism tool", () => {
  it("does not substitute a right prism when the prompt specifies an oblique triangular prism", () => {
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"),
      problemText: "An oblique triangular prism has all edges length a, where a>0; the lateral edges are not perpendicular to its base." })
    const before = session.currentSnapshot()
    for (const [tool, input] of [
      ["construct_equal_edge_triangular_prism", { id: "P", displayScale: 2 }],
      ["construct_solid", { id: "P", kind: "triangular_prism", symbol: "a", displayScale: 2 }]
    ] as const) {
      const result = session.execute(tool, input)
      expect(result.ok).toBe(false)
      expect(result.blockerCode).toBe("symbolic_prism_shape_mismatch")
      expect(session.currentSnapshot().candidateHash).toBe(before.candidateHash)
    }
  })

  it("does not infer rightness when the symbolic triangular prism has no orientation condition", () => {
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"),
      problemText: "A triangular prism has all edges length a, where a>0. Draw it." })
    const result = session.execute("construct_equal_edge_triangular_prism", { id: "P", displayScale: 2 })
    expect(result.ok).toBe(false)
    expect(result.blockerCode).toBe("symbolic_prism_shape_mismatch")
    expect(session.currentSnapshot().primitiveCount).toBe(0)
  })

  it("publishes a small family-specific schema that can construct and name a real prism", () => {
    const tool = buildDsActionToolSchemas().find((item) => item.function.name === "construct_equal_edge_triangular_prism")
    expect(tool?.function.parameters).toMatchObject({
      type: "object", additionalProperties: false, required: ["id", "displayScale"],
      properties: { id: { type: "string" }, displayScale: { type: "number", exclusiveMinimum: 0 } }
    })
    expect(JSON.stringify(tool?.function.parameters)).not.toMatch(/sideLength|height|"kind"|"vertices"/)
    const prompt = drawingContracts36.cases.find((item) => item.id === "GK-S09")!.prompt
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"), problemText: prompt })
    const accepted = session.execute("construct_equal_edge_triangular_prism", { id: "prism", displayScale: 2,
      vertexNames: ["A", "B", "C", "A\u2081", "B\u2081", "C\u2081"] })
    expect(accepted.status).toBe("accepted")
    expect(accepted.primitiveCount).toBeGreaterThan(0)
    expect(accepted.action).toBe("construct_equal_edge_triangular_prism")
    const unknown = session.execute("construct_equal_edge_triangular_prism", { id: "bad", displayScale: 2, height: 4 })
    expect(unknown.ok).toBe(false)
    expect(session.currentSnapshot().candidateHash).toBe(accepted.candidateHash)
  })
})

describe("GK-S09 derived circumsphere action", () => {
  it("refuses numeric side and height as unlabelled values for an all-edges-a prompt", () => {
    const prompt = drawingContracts36.cases.find((entry) => entry.id === "GK-S09")!.prompt
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"), problemText: prompt })
    const before = session.currentSnapshot()
    const guessed = session.execute("construct_solid", { id: "prism", kind: "triangular_prism", sideLength: 1, height: 1 })
    expect(guessed.status).toBe("blocked")
    expect(guessed.blockerCode).toBe("symbol_source_required")
    expect(session.currentSnapshot().candidateHash).toBe(before.candidateHash)
    const explicit = session.execute("construct_solid", { id: "prism", kind: "triangular_prism", symbol: "a", displayScale: 1 })
    expect(explicit.status).toBe("accepted")
  })

  it("accepts implicit positive symbolic edge length in the frozen GK-S09 prompt without guessing its value", () => {
    const prompt = drawingContracts36.cases.find((entry) => entry.id === "GK-S09")!.prompt
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"), problemText: prompt })
    const result = session.execute("construct_solid", { id: "prism", kind: "triangular_prism", symbol: "a", displayScale: 2,
      vertexNames: ["A", "B", "C", "A\u2081", "B\u2081", "C\u2081"] })
    expect(result.status).toBe("accepted")
    const noSphere = session.execute("finish_candidate", { goal: "symbolic equal-edge right prism" })
    expect(noSphere.terminated?.plan.kind).toBe("plan")
    if (noSphere.terminated?.plan.kind === "plan") expect(noSphere.terminated.plan.answer).toBeUndefined()
    const derived = session.execute("construct_circumsphere", { solidId: "prism", id: "sphere" })
    expect(derived.status).toBe("accepted")
    const finished = session.execute("finish_candidate", { goal: "symbolic equal-edge right prism" })
    expect(finished.terminated?.plan.kind).toBe("plan")
    if (finished.terminated?.plan.kind === "plan") {
      expect(finished.terminated.plan.assumptions).toEqual(expect.arrayContaining([expect.stringMatching(/a > 0.*display.*2/i)]))
      expect(finished.terminated.plan.answer).toContain("7/3")
      expect(finished.terminated.plan.answer).toContain("a^2")
    }
    expect(session.execute("repair_entity", {}).status).toBe("accepted")
    const rolled = session.execute("repair_entity", {})
    expect(rolled.status).toBe("accepted")
    expect(session.execute("construct_solid", { id: "N", kind: "tetrahedron", edgeLength: 3 }).status).toBe("accepted")
    const afterRollback = session.execute("finish_candidate", { goal: "without symbolic prism" })
    expect(afterRollback.terminated?.plan.kind).toBe("plan")
    if (afterRollback.terminated?.plan.kind === "plan") expect(afterRollback.terminated.plan.assumptions ?? []).toEqual([])
    const unrelated = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"),
      problemText: "Let a denote an angle; draw a prism." })
      .execute("construct_solid", { kind: "triangular_prism", symbol: "a", displayScale: 2 })
    expect(unrelated.blockerCode).toBe("symbol_source_missing")
  })

  it("uses displayScale only with a positive symbolic a source and does not silently set a=1", () => {
    const build = () => createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"),
      problemText: "All edges of the right triangular prism have length a, where a>0." })
    const symbolic = build()
    const result = symbolic.execute("construct_solid", { id: "P", kind: "triangular_prism", symbol: "a", displayScale: 2 })
    expect(result.status).toBe("accepted")
    const action = symbolic.currentSnapshot().actions[0]!
    expect(action.actionId).toBe("solid.create_prism")
    if (action.actionId === "solid.create_prism") {
      expect(action.inputs.vector.z).toBeCloseTo(2)
      expect(Math.hypot(
        action.inputs.basePolygon[0]!.x - action.inputs.basePolygon[1]!.x,
        action.inputs.basePolygon[0]!.y - action.inputs.basePolygon[1]!.y,
        action.inputs.basePolygon[0]!.z - action.inputs.basePolygon[1]!.z
      )).toBeCloseTo(2)
    }
    const noSource = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
      .execute("construct_solid", { kind: "triangular_prism", symbol: "a", displayScale: 2 })
    expect(noSource.ok).toBe(false)
    expect(noSource.blockerCode).toBe("symbol_source_missing")
    const zero = build().execute("construct_solid", { kind: "triangular_prism", symbol: "a", displayScale: 0 })
    expect(zero.ok).toBe(false)
  })

  it("keeps the derived sphere radius proportional to symbolic display scale", () => {
    const prompt = drawingContracts36.cases.find((entry) => entry.id === "GK-S09")!.prompt
    for (const displayScale of [1, 2]) {
      const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"), problemText: prompt })
      expect(session.execute("construct_solid", { kind: "triangular_prism", id: "P", symbol: "a", displayScale }).status).toBe("accepted")
      expect(session.execute("construct_circumsphere", { solidId: "P", id: "S" }).status).toBe("accepted")
      const finished = session.execute("finish_candidate", { goal: "sphere area" })
      if (finished.terminated?.plan.kind !== "plan") throw new Error("no plan")
      expect(finished.terminated.plan.answer).toContain("7/3*pi*a^2")
      const compiled = compilePlan(finished.terminated.plan, { document: createEmptyDocument("geometry3d"), conversationId: "symbolic-test" })
      expect(compiled.ok).toBe(true)
      const sphere = compiled.draftDocument?.primitives.find((primitive) => primitive.type === "sphere")
      expect(sphere?.type).toBe("sphere")
      if (sphere?.type === "sphere") expect(sphere.radius / displayScale).toBeCloseTo(Math.sqrt(7 / 12), 8)
    }
  })

  it("creates a real sphere from the named prism via the kernel and keeps unknown hosts atomic", () => {
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const prism = session.execute("construct_solid", { id: "prism", kind: "triangular_prism", sideLength: 1, height: 1,
      vertexNames: ["A", "B", "C", "A1", "B1", "C1"] })
    expect(prism.status).toBe("accepted")
    const before = session.currentSnapshot()
    const missing = session.execute("construct_circumsphere", { id: "bad", solidId: "not-found" })
    expect(missing.ok).toBe(false)
    expect(missing.status).toBe("blocked")
    expect(session.currentSnapshot().candidateHash).toBe(before.candidateHash)
    const derived = session.execute("construct_circumsphere", { id: "sphere", solidId: "prism", label: "circumsphere" })
    expect(derived.status).toBe("accepted")
    expect(derived.stateChanged).toBe(true)
    expect(derived.primitiveCount).toBeGreaterThan(prism.primitiveCount)
    const tool = buildDsActionToolSchemas().find((schema) => schema.function.name === "construct_circumsphere")!
    expect(tool.function.parameters).toMatchObject({ required: ["solidId"], additionalProperties: false })
    expect(JSON.stringify(tool.function.parameters)).not.toMatch(/center|radius/)
    const badRadius = session.execute("construct_circumsphere", { id: "fake", solidId: "prism", radius: 99 })
    expect(badRadius.ok).toBe(false)
    expect(session.currentSnapshot().candidateHash).toBe(derived.candidateHash)
    expect(session.currentSnapshot().actions.at(-1)).toMatchObject({ actionId: "derived.create_circumsphere",
      inputs: { alias: "sphere", solidId: { scope: "draft", alias: "prism" } } })
    const finish = session.execute("finish_candidate", { goal: "equal-edge triangular prism and circumsphere" })
    expect(finish.terminated?.plan.kind).toBe("plan")
  })
})

describe("construct_solid model-visible contract", () => {
  it("rejects unknown solid fields before the kernel while preserving supported aliases", () => {
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const unknown = session.execute("construct_solid", { kind: "triangular_prism", sideLength: 1, height: 1, heightTypo: 1 })
    expect(unknown.status).toBe("repairable")
    expect(unknown.blockerCode).toBe("invalid_schema")
    expect(unknown.primitiveCount).toBe(0)
    const accepted = session.execute("construct_solid", { kind: "triangular_prism", sideLength: 1, height: 1 })
    expect(accepted.status).toBe("accepted")
    expect(accepted.primitiveCount).toBeGreaterThan(0)
  })

  it("keeps all published solid kinds executable and rejects missing or negative dimensions", () => {
    const advertised = buildDsActionToolSchemas().find((schema) => schema.function.name === "construct_solid")!
    const published = "properties" in advertised.function.parameters && "kind" in advertised.function.parameters.properties
      ? advertised.function.parameters.properties.kind.enum : []
    expect(published).toEqual(Object.values(SOLID_KIND_FAMILIES).flat())
    const validByFamily: Record<string, Record<string, unknown>> = {
      regular_pyramid: { sideLength: 2, height: 3 },
      tetrahedron: { edgeLength: 2 },
      prism: { sideLength: 2, height: 3 },
      perpendicular_pyramid: { sideLength: 2, height: 3 }
    }
    for (const [family, names] of Object.entries(SOLID_KIND_FAMILIES)) {
      for (const kind of names) {
        const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
        const valid = session.execute("construct_solid", { kind, ...validByFamily[family] })
        expect(valid.status, `published kind ${kind}`).toBe("accepted")
        expect(valid.primitiveCount).toBeGreaterThan(0)
        const negative = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
          .execute("construct_solid", { kind, ...validByFamily[family], height: -1, sideLength: -1, edgeLength: -1 })
        expect(negative.status, `negative dimension ${kind}`).not.toBe("accepted")
      }
    }
  })

  it("publishes supported kinds and numeric geometry fields rather than a free-form object", () => {
    const tool = buildDsActionToolSchemas().find((schema) => schema.function.name === "construct_solid")!
    expect(tool.function.parameters).toMatchObject({
      type: "object",
      required: ["kind"],
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: expect.arrayContaining(["triangular_prism", "regular_pyramid", "tetrahedron"]) },
        height: { type: "number", exclusiveMinimum: 0 },
        sideLength: { type: "number", exclusiveMinimum: 0 },
        vertexNames: { type: "array" }
      }
    })
    expect(JSON.stringify(tool.function.parameters)).not.toContain('"vertices"')
  })
})

describe("failed staged point reference hygiene", () => {
  it("never overwrites the reference position of an existing point with a conflicting same-name construction", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "P", x: 0, y: 0 }).ok).toBe(true)
    const original = session.currentSnapshot().candidateHash
    const conflicting = session.execute("construct_point", { id: "P", x: 100, y: 0 })
    expect(conflicting.ok).toBe(false)
    expect(session.currentSnapshot().candidateHash).toBe(original)
    expect(session.execute("query_measurement", { metric: "position", target: "P" }).measurement?.value).toEqual({ x: 0, y: 0 })
    expect(session.referenceDirectory().materializedPoints).toEqual(["P"])
  })
})

describe("rolled-back line and conic references", () => {
  it("cannot intersect a rolled-back line even when its prior endpoint coordinates still exist", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    for (const [id, x, y] of [["P", 0, 0], ["Q", 2, 0], ["R", 0, 2]] as const) {
      expect(session.execute("construct_point", { id, x, y }).ok).toBe(true)
    }
    expect(session.execute("construct_line", { id: "L1", from: "P", to: "Q" }).ok).toBe(true)
    expect(session.execute("construct_line", { id: "L2", from: "P", to: "R" }).ok).toBe(true)
    expect(session.execute("repair_entity", {}).stateChanged).toBe(true)
    expect(session.execute("construct_intersection", { id: "X", lineA: "L1", lineB: "L2" }).blockerCode).toBe("undeclared_entity_ref")
  })
  it("cannot use a rolled-back conic for a later tangent", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "P", x: 3, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_conic", { id: "E", conicType: "ellipse", radiusX: 3, radiusY: 2 }).ok).toBe(true)
    expect(session.execute("repair_entity", {}).stateChanged).toBe(true)
    expect(session.execute("construct_tangent", { id: "T", conicId: "E", pointId: "P" }).blockerCode).toBe("undeclared_entity_ref")
  })
})

describe("materialized reference truth", () => {
  it("never tells the model that a declaration or rolled-back point is materialized", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("declare_entity", { id: "P", kind: "point" }).status).toBe("accepted")
    expect(session.referenceDirectory()).toEqual({ materializedPoints: [], materializedLines: [], materializedConics: [], declaredOnly: ["P"], truncated: false })
    expect(session.execute("construct_point", { id: "P", x: 0, y: 0 }).status).toBe("accepted")
    expect(session.execute("construct_point", { id: "Q", x: 2, y: 0 }).status).toBe("accepted")
    expect(session.referenceDirectory().materializedPoints).toEqual(["P", "Q"])
    session.execute("repair_entity", {})
    expect(session.referenceDirectory().materializedPoints).toEqual(["P"])
    expect(session.referenceDirectory().declaredOnly).toEqual([])
    expect(session.execute("construct_line", { id: "L", from: "P", to: "Q" }).blockerCode).toBe("undeclared_entity_ref")
  })
  it("bounds the provider-visible directory and flags omitted names instead of truncating feedback JSON", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    for (let i = 0; i < 20; i += 1) {
      expect(session.execute("construct_point", { id: `P${i}`, x: i, y: 0 }).ok).toBe(true)
      expect(session.execute("declare_entity", { id: `D${i}`, kind: "point" }).ok).toBe(true)
    }
    const directory = session.referenceDirectory()
    expect(directory.materializedPoints).toHaveLength(20)
    expect(directory.materializedPoints.length + directory.materializedLines.length + directory.materializedConics.length + directory.declaredOnly.length).toBeLessThanOrEqual(32)
    expect(directory.truncated).toBe(true)
  })
  it("repairs the selected branch without deleting shared geometry or keeping stale branch points", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "S", x: 0, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "P", x: 1, y: 0, branchId: "left" }).ok).toBe(true)
    expect(session.execute("repair_entity", { branchId: "left" }).stateChanged).toBe(true)
    expect(session.referenceDirectory().materializedPoints).toEqual(["S"])
    expect(session.referenceDirectory("left").materializedPoints).toEqual(["S"])
    expect(session.execute("query_measurement", { metric: "position", target: "P", branchId: "left" }).blockerCode).toBe("undeclared_entity_ref")
  })
  it("never lets the other branch consume a line or conic that only exists locally", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "P", x: 3, y: 0, branchId: "left" }).ok).toBe(true)
    expect(session.execute("construct_conic", { id: "E", conicType: "ellipse", radiusX: 3, radiusY: 2, branchId: "left" }).ok).toBe(true)
    expect(session.execute("construct_tangent", { id: "T", conicId: "E", pointId: "P", branchId: "right" }).blockerCode).toBe("undeclared_entity_ref")
    expect(session.execute("query_measurement", { metric: "position", target: "P", branchId: "right" }).blockerCode).toBe("undeclared_entity_ref")
    expect(session.referenceDirectory("right").materializedConics).toEqual([])
  })
  it("keeps different branch checkpoints isolated when repairing only one branch", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "S", x: 0, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "L", x: 1, y: 0, branchId: "left" }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "R", x: 2, y: 0, branchId: "right" }).ok).toBe(true)
    expect(session.execute("repair_entity", { branchId: "left" }).ok).toBe(true)
    expect(session.referenceDirectory("left").materializedPoints).toEqual(["S"])
    expect(session.referenceDirectory("right").materializedPoints).toEqual(["R", "S"])
    expect(session.execute("query_measurement", { metric: "position", target: "R", branchId: "right" }).ok).toBe(true)
  })
  it("does not silently omit new shared geometry from an already-materialized branch", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "S", x: 0, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "P", x: 1, y: 0, branchId: "left" }).ok).toBe(true)
    const sharedBefore = session.currentSnapshot().candidateHash
    expect(session.execute("construct_point", { id: "T", x: 2, y: 0 }).blockerCode).toBe("active_branch_dependency")
    expect(session.currentSnapshot().candidateHash).toBe(sharedBefore)
    expect(session.referenceDirectory("left").materializedPoints).toEqual(["P", "S"])
    expect(session.execute("repair_entity", { branchId: "left" }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "T", x: 2, y: 0 }).ok).toBe(true)
    expect(session.referenceDirectory("left").materializedPoints).toEqual(["S", "T"])
  })
  it("keeps shared rollback checkpoints aligned after earlier branch work", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "S", x: 0, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "P", x: 1, y: 0, branchId: "left" }).ok).toBe(true)
    expect(session.execute("repair_entity", { branchId: "left" }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "T", x: 2, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "U", x: 3, y: 0 }).ok).toBe(true)
    expect(session.execute("repair_entity", {}).stateChanged).toBe(true)
    expect(session.referenceDirectory().materializedPoints).toEqual(["S", "T"])
    expect(session.referenceDirectory("left").materializedPoints).not.toContain("P")
    expect(session.execute("query_measurement", { metric: "position", target: "T" }).ok).toBe(true)
  })
  it("refuses to undo shared geometry while an active branch still depends on it", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "S", x: 0, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "P", x: 1, y: 0, branchId: "left" }).ok).toBe(true)
    expect(session.execute("repair_entity", {}).blockerCode).toBe("active_branch_dependency")
    expect(session.referenceDirectory().materializedPoints).toEqual(["S"])
    expect(session.referenceDirectory("left").materializedPoints).toEqual(["P", "S"])
  })
  it("removes a branch conic without leaving a stale tangent reference", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "P", x: 3, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_conic", { id: "E", conicType: "ellipse", radiusX: 3, radiusY: 2, branchId: "left" }).ok).toBe(true)
    expect(session.execute("repair_entity", { branchId: "left" }).stateChanged).toBe(true)
    expect(session.referenceDirectory("left").materializedConics).toEqual([])
    expect(session.execute("construct_tangent", { id: "T", conicId: "E", pointId: "P", branchId: "left" }).blockerCode).toBe("undeclared_entity_ref")
  })
  it("exposes branch-local references only within their branch while keeping shared points", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "S", x: 0, y: 0 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "P", x: 1, y: 0, branchId: "left" }).ok).toBe(true)
    expect(session.referenceDirectory().materializedPoints).toEqual(["S"])
    expect(session.referenceDirectory("left").materializedPoints).toEqual(["P", "S"])
    expect(session.referenceDirectory("right").materializedPoints).toEqual(["S"])
    expect(session.execute("declare_entity", { id: "L_ONLY", kind: "point", branchId: "left" }).ok).toBe(true)
    expect(session.referenceDirectory("left").declaredOnly).toContain("L_ONLY")
    expect(session.referenceDirectory("right").declaredOnly).not.toContain("L_ONLY")
  })
})

describe("explicit planar line equation construction", () => {
  it("constructs the exact line 2x + 3y - 6 = 0 without inventing endpoint entities", () => {
    const schema = buildDsActionToolSchemas().find((tool) => tool.function.name === "construct_line")!.function.parameters
    expect(schema).toMatchObject({ additionalProperties: false, required: ["id"],
      properties: { a: { type: "number" }, b: { type: "number" }, c: { type: "number" } } })
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    const result = session.execute("construct_line", { id: "L", a: 2, b: 3, c: -6 })
    expect(result.status).toBe("accepted")
    expect(result.primitiveCount).toBeGreaterThan(0)
    const lineAction = session.currentSnapshot().actions.find((action) => action.actionId === "planar.create_line")
    expect(lineAction).toBeDefined()
    if (lineAction?.actionId !== "planar.create_line") return
    const points = lineAction.inputs.points as Array<{ x: number; y: number }>
    expect(points).toHaveLength(2)
    for (const point of points) expect(2 * point.x + 3 * point.y - 6).toBeCloseTo(0, 9)
    expect(Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y)).toBeGreaterThan(0.1)
  })
  it("rejects zero normals, missing coefficients and mixed endpoint/equation requests atomically", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    const before = session.currentSnapshot().candidateHash
    expect(session.execute("construct_line", { id: "L", a: 0, b: 0, c: 1 }).blockerCode).toBe("degenerate_line")
    expect(session.execute("construct_line", { id: "L", a: 1, b: 2 }).blockerCode).toBe("missing_required_parameter")
    expect(session.execute("construct_line", { id: "L" }).blockerCode).toBe("missing_required_parameter")
    expect(session.execute("construct_line", { id: "L", from: "A" }).blockerCode).toBe("missing_required_parameter")
    expect(session.execute("construct_line", { id: "L", a: 1, b: 2, c: 3, from: "A", to: "B" }).blockerCode).toBe("ambiguous_geometry_input")
    expect(session.currentSnapshot().candidateHash).toBe(before)
    expect(session.currentSnapshot().primitiveCount).toBe(0)
  })
})

describe("DS conic orientation and center fidelity", () => {
  it("uses published center and axis for a vertical hyperbola, and center for an ellipse", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_conic", { id: "H", conicType: "hyperbola", radiusX: 2, radiusY: 3, axis: "y", cx: -1, cy: 4 }).ok).toBe(true)
    expect(session.execute("construct_conic", { id: "E", conicType: "ellipse", radiusX: 3, radiusY: 2, cx: 5, cy: -2 }).ok).toBe(true)
    const actions = session.currentSnapshot().actions.filter((action) => action.actionId === "planar.create_conic")
    expect(actions).toHaveLength(2)
    expect(actions[0]?.inputs).toMatchObject({ alias: "H", kind: "hyperbola", axis: "y", center: { x: -1, y: 4 }, radiusX: 2, radiusY: 3 })
    expect(actions[1]?.inputs).toMatchObject({ alias: "E", kind: "ellipse", center: { x: 5, y: -2 }, radiusX: 3, radiusY: 2 })
    const compiled = compilePlan({ schemaVersion: "mathcanvas.plan.v1", kind: "plan", goal: "two translated conics", factIds: [], actions: [...session.currentSnapshot().actions] },
      { document: createEmptyDocument("conics"), conversationId: "conic-placement", documentGeneration: 0, workspace: "conics" })
    expect(compiled.ok).toBe(true)
    expect(compiled.draftDocument?.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "hyperbola", axis: "y", center: { x: -1, y: 4 } }),
      expect.objectContaining({ type: "ellipse", center: { x: 5, y: -2 } })
    ]))
  })

  it("rejects invalid supplied axis or center instead of silently using origin or another orientation", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    const initialHash = session.currentSnapshot().candidateHash
    expect(session.execute("construct_conic", { id: "H", conicType: "hyperbola", radiusX: 2, radiusY: 3, axis: "z" }).blockerCode).toBe("invalid_axis")
    expect(session.execute("construct_conic", { id: "E", conicType: "ellipse", radiusX: 3, radiusY: 2, cx: "unknown" }).blockerCode).toBe("invalid_center")
    expect(session.execute("construct_conic", { id: "E", conicType: "ellipse", radiusX: 3, radiusY: 2, vx: 5 }).blockerCode).toBe("incompatible_conic_fields")
    expect(session.execute("construct_conic", { id: "P", conicType: "parabola", focalParameter: 2, radiusX: 3 }).blockerCode).toBe("incompatible_conic_fields")
    expect(session.execute("construct_conic", { id: "E", conicType: "ellipse", radiusX: 3, radiusY: 2, axis: "y" }).blockerCode).toBe("incompatible_conic_fields")
    expect(session.currentSnapshot().candidateHash).toBe(initialHash)
    expect(session.referenceDirectory().materializedConics).toEqual([])
  })
})

describe("real DS planar tool schema fidelity", () => {
  it("executes the published planar conic/point/line fields and refuses missing geometry", () => {
    const scene = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(scene.execute("construct_conic", { id: "E", conicType: "ellipse", radiusX: 3, radiusY: 2 }).status).toBe("accepted")
    expect(scene.execute("construct_conic", { id: "H", conicType: "hyperbola", radiusX: 3, radiusY: 2 }).status).toBe("accepted")
    expect(scene.execute("construct_conic", { id: "P1", conicType: "parabola", focalParameter: 2, axis: "x" }).status).toBe("accepted")
    expect(scene.execute("construct_point", { id: "A", x: 0, y: 0 }).status).toBe("accepted")
    expect(scene.execute("construct_point", { id: "B", x: 3, y: 0 }).status).toBe("accepted")
    expect(scene.execute("construct_line", { id: "L", from: "A", to: "B" }).status).toBe("accepted")
    expect(scene.execute("query_measurement", { metric: "distance", targets: ["A", "B"] }).measurement?.value).toBe(3)
    const count = scene.currentSnapshot().primitiveCount
    expect(scene.execute("construct_conic", { id: "bad-kind", conicType: "circle", radiusX: 3, radiusY: 2 }).blockerCode).toBe("unsupported_conic_kind")
    expect(scene.execute("construct_conic", { id: "missing-kind", radiusX: 3, radiusY: 2 }).blockerCode).toBe("missing_required_parameter")
    expect(scene.execute("construct_conic", { id: "bad", conicType: "ellipse" }).blockerCode).toBe("missing_required_parameter")
    expect(scene.execute("construct_line", { id: "bad-line", from: "A", to: "Unknown" }).blockerCode).toBe("undeclared_entity_ref")
    expect(scene.currentSnapshot().primitiveCount).toBe(count)
  })

  it("publishes closed executable parameter names for conic, point, line and measurement", () => {
    const tools = new Map(buildDsActionToolSchemas().map((tool) => [tool.function.name, tool.function]))
    for (const name of ["construct_conic", "construct_point", "construct_line", "query_measurement", "query_constraint_status"] as const) {
      expect(tools.get(name)?.parameters).toMatchObject({ type: "object", additionalProperties: false })
    }
    expect(tools.get("construct_conic")?.parameters).toMatchObject({
      required: ["id", "conicType"],
      properties: { conicType: { enum: ["ellipse", "hyperbola", "parabola"] },
        radiusX: { type: "number", exclusiveMinimum: 0 }, radiusY: { type: "number", exclusiveMinimum: 0 },
        focalParameter: { type: "number" } }
    })
    expect(tools.get("construct_conic")?.description).not.toMatch(/from equation/i)
    expect(tools.get("construct_conic")?.description).toMatch(/axis.*x.*y/i)
    expect(tools.get("construct_conic")?.description).toMatch(/cx.*cy/i)
    expect(tools.get("construct_line")?.parameters).toMatchObject({ required: ["id"],
      properties: { from: { type: "string" }, to: { type: "string" } } })
    expect(tools.get("construct_line")?.description).toMatch(/finite equation coefficients a,b,c/i)
    expect(tools.get("construct_point")?.description).toMatch(/id.*x.*y/i)
    expect(tools.get("query_measurement")?.description).toMatch(/metric.*distance.*targets/i)
    expect(tools.get("query_constraint_status")?.description).toMatch(/targets/i)
    expect(tools.get("query_measurement")?.parameters).toMatchObject({ required: ["metric"],
      properties: { metric: { enum: ["distance", "position", "coordinates"] }, targets: { type: "array" } } })
  })
})

describe("dsActionTools (Task F2 closed action-level protocol)", () => {
  it("exposes all 24 closed DS actions matching @draw/agent-core and parses single-action tri-state calls", () => {
    expect(DS_ACTION_TOOL_NAMES).toEqual(DS_ACTION_CLOSED_SET)
    expect(DS_ACTION_TOOL_NAMES).toHaveLength(24)

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

    // Task 3: progressSignature and toolName must be emitted deterministically on tool receipts
    const distReceipt = foldSession.execute("query_measurement", { metric: "distance", targets: ["A", "B"] })
    expect(distReceipt.toolName).toBe("query_measurement")
    expect(distReceipt.progressSignature).toContain("query_measurement:accepted:")
  })
})
