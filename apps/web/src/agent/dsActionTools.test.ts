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

describe("DS answer provenance is not geometry", () => {
  it("never invents an exam answer while finishing a symbolic prism/sphere diagram", () => {
    const prompt = drawingContracts36.cases.find((entry) => entry.id === "GK-S09")!.prompt
    const session = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"), problemText: prompt })
    expect(session.execute("construct_equal_edge_triangular_prism", { id: "prism", displayScale: 2 }).ok).toBe(true)
    expect(session.execute("construct_circumsphere", { id: "sphere", solidId: "prism" }).ok).toBe(true)
    const finished = session.execute("finish_candidate", { goal: "render prism and circumsphere" })
    expect(finished.status).toBe("accepted")
    expect(finished.terminated?.plan.kind).toBe("plan")
    if (finished.terminated?.plan.kind !== "plan") return
    expect(finished.terminated.plan.actions).toHaveLength(2)
    expect(finished.terminated.plan.answer).toBeUndefined()
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
      expect(finished.terminated.plan.answer).toBeUndefined()
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
      expect(finished.terminated.plan.answer).toBeUndefined()
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
    const published = "properties" in advertised.function.parameters && "kind" in advertised.function.parameters.properties &&
      "enum" in advertised.function.parameters.properties.kind
      ? advertised.function.parameters.properties.kind.enum : []
    expect(published).toEqual(Object.values(SOLID_KIND_FAMILIES).flat())
    const validByFamily: Record<string, Record<string, unknown>> = {
      regular_pyramid: { sideLength: 2, height: 3 },
      tetrahedron: { edgeLength: 2 },
      prism: { sideLength: 2, height: 3 },
      perpendicular_pyramid: { sideLength: 2, height: 3 },
      pyramidal_frustum: { bottomSide: 4, topSide: 2, height: 3 },
      cylinder: { radius: 2, height: 3 },
      cone: { radius: 2, height: 3 },
      round_frustum: { radiusBottom: 3, radiusTop: 1, height: 3 },
      sphere: { radius: 2 }
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

describe("conic from two real points", () => {
  it("fits the origin-centred ellipse through two materialized points without guessed semi-axes", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "A", x: 0, y: -2 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "B", x: 1.5, y: -1 }).ok).toBe(true)
    const fit = session.execute("construct_conic", { id: "E", conicType: "ellipse", throughPointIds: ["A", "B"] })
    expect(fit.status).toBe("accepted")
    const action = session.currentSnapshot().actions.at(-1)
    expect(action?.actionId).toBe("planar.create_conic")
    expect(action?.inputs).toMatchObject({ kind: "ellipse", center: { x: 0, y: 0 }, radiusX: Math.sqrt(3), radiusY: 2 })
    const compiled = compilePlan({ schemaVersion: "mathcanvas.plan.v1", kind: "plan", goal: "ellipse through A and B", factIds: [], actions: [...session.currentSnapshot().actions] },
      { document: createEmptyDocument("conics"), conversationId: "ellipse-through-points", documentGeneration: 0, workspace: "conics" })
    expect(compiled.ok).toBe(true)
    expect(compiled.draftDocument?.primitives).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "ellipse", center: { x: 0, y: 0 }, radiusX: Math.sqrt(3), radiusY: 2 })
    ]))
  })
  it("preserves a fitted vertical hyperbola's axis rather than defaulting to x", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "A", x: 0, y: 2 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "B", x: 1, y: Math.sqrt(5) }).ok).toBe(true)
    expect(session.execute("construct_conic", { id: "H", conicType: "hyperbola", throughPointIds: ["A", "B"] }).ok).toBe(true)
    const last = session.currentSnapshot().actions.at(-1)
    expect(last?.actionId).toBe("planar.create_conic")
    if (last?.actionId !== "planar.create_conic") return
    expect(last.inputs).toMatchObject({ kind: "hyperbola", axis: "y" })
    expect(last.inputs.radiusX).toBeCloseTo(2, 9)
    expect(last.inputs.radiusY).toBeCloseTo(2, 9)
  })
  it("fits from shared points into a branch without publishing that conic to another branch", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "A", x: 1, y: -3 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "B", x: 2.5, y: -2 }).ok).toBe(true)
    const result = session.execute("construct_conic", { id: "E", conicType: "ellipse", throughPointIds: ["A", "B"], cx: 1, cy: -1, branchId: "left" })
    expect(result.ok).toBe(true)
    expect(session.referenceDirectory("left").materializedConics).toContain("E")
    expect(session.referenceDirectory("right").materializedConics).toEqual([])
    expect(session.referenceDirectory().materializedConics).toEqual([])
  })
  it("rejects missing, dependent, contradictory, and mixed sources with no candidate change", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "A", x: 0, y: -2 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "B", x: 1.5, y: -1 }).ok).toBe(true)
    const before = session.currentSnapshot().candidateHash
    expect(session.execute("construct_conic", { id: "E", conicType: "ellipse", throughPointIds: ["A", "Missing"] }).blockerCode).toBe("undeclared_entity_ref")
    expect(session.execute("construct_conic", { id: "E", conicType: "ellipse", throughPointIds: ["A", "A"] }).blockerCode).toBe("conic_fit_unsatisfied")
    expect(session.execute("construct_conic", { id: "H", conicType: "hyperbola", throughPointIds: ["A", "B"] }).blockerCode).toBe("conic_fit_unsatisfied")
    expect(session.execute("construct_conic", { id: "E", conicType: "ellipse", throughPointIds: ["A", "B"], radiusX: 3, radiusY: 2 }).blockerCode).toBe("ambiguous_geometry_input")
    expect(session.currentSnapshot().candidateHash).toBe(before)
    expect(session.referenceDirectory().materializedConics).toEqual([])
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

  it("allows valid vertical ellipse via fit, equation, or radiusY > radiusX, positions alias, and 5-vertex pyramids", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "A", x: 0, y: -2 }).status).toBe("accepted")
    expect(session.execute("construct_point", { id: "B", x: 1.5, y: -1 }).status).toBe("accepted")
    expect(session.execute("construct_conic", { id: "Ey_fit", conicType: "ellipse", axis: "y", throughPointIds: ["A", "B"] }).status).toBe("accepted")
    expect(session.execute("construct_conic", { id: "Ey_eq", conicType: "ellipse", axis: "y", equation: "x^2/3+y^2/4=1" }).status).toBe("accepted")
    expect(session.execute("construct_conic", { id: "Ey_r", conicType: "ellipse", axis: "y", radiusX: Math.sqrt(3), radiusY: 2 }).status).toBe("accepted")
    expect(session.execute("query_measurement", { metric: "positions", target: "B" }).measurement?.value).toEqual({ x: 1.5, y: -1 })

    const s3 = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    for (const [id, x, y, z] of [["P", 0, 0, 4], ["A", 0, 0, 0], ["B", 2, 0, 0], ["C", 1, 2, 0], ["D", 0, 4, 0]] as const) {
      expect(s3.execute("construct_point", { id, x, y, z }).status).toBe("accepted")
    }
    expect(s3.execute("construct_solid", { id: "pyr", vertexNames: ["P", "A", "B", "C", "D"] }).status).toBe("accepted")

    const sLine = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(sLine.execute("construct_conic", { id: "G", conicType: "ellipse", radiusX: 2, radiusY: Math.sqrt(3) }).status).toBe("accepted")
    expect(sLine.execute("construct_point", { id: "C", x: 0, y: -1 }).status).toBe("accepted")
    expect(sLine.execute("construct_line", { id: "l", throughPointId: "C", slope: 0.5 }).status).toBe("accepted")
    expect(sLine.execute("construct_intersection", { id: "E", lineA: "l", conicId: "G", selection: "max_x" }).status).toBe("accepted")
    expect(sLine.execute("repair_entity", { target: "E" }).status).toBe("accepted")
    expect(sLine.execute("construct_intersection", { id: "E", lineA: "l", conicId: "G", selection: "max_x" }).status).toBe("accepted")
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
    expect(tools.get("construct_conic")?.description).toMatch(/throughPointIds.*two existing points/i)
    expect(tools.get("construct_conic")?.parameters).toMatchObject({ properties: { throughPointIds: { type: "array", items: { type: "string" } } } })
    expect(tools.get("construct_line")?.parameters).toMatchObject({ required: ["id"],
      properties: { from: { type: "string" }, to: { type: "string" } } })
    expect(tools.get("construct_line")?.description).toMatch(/finite equation coefficients a,b,c/i)
    expect(tools.get("construct_point")?.description).toMatch(/id.*x.*y/i)
    expect(tools.get("query_measurement")?.description).toMatch(/metric.*distance.*targets/i)
    expect(tools.get("query_constraint_status")?.description).toMatch(/targets/i)
    expect(tools.get("query_measurement")?.parameters).toMatchObject({ required: ["metric"],
      properties: { metric: { enum: ["distance", "position", "coordinates", "area", "line_plane_angle", "line_angle", "dihedral_angle"] }, targets: { type: "array" } } })
  })
})

describe("B7 declaration schema and execution agree", () => {
  it("does not silently accept coordinates in declare_entity as if it drew a point", () => {
    const schema = buildDsActionToolSchemas().find(tool => tool.function.name === "declare_entity")?.function.parameters
    expect(schema).toMatchObject({ type: "object", additionalProperties: false, required: ["id"],
      properties: { id: { type: "string" }, kind: { type: "string" }, branchId: { type: "string" } } })
    expect(buildDsActionToolSchemas().find(tool => tool.function.name === "declare_entity")?.function.description).toMatch(/does not draw.*construct_point/i)
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    const before = session.currentSnapshot()
    const invalid = session.execute("declare_entity", { id: "P", kind: "point", x: 2, y: 3 })
    expect(invalid).toMatchObject({ status: "repairable", blockerCode: "invalid_schema" })
    expect(session.currentSnapshot().candidateHash).toBe(before.candidateHash)
    expect(session.referenceDirectory().declaredOnly).toEqual([])
    expect(session.execute("declare_entity", { id: "P", kind: "point", branchId: "left" }).status).toBe("accepted")
    expect(session.referenceDirectory("left").declaredOnly).toContain("P")
    expect(session.referenceDirectory("left").materializedPoints).toEqual([])
    expect(session.execute("construct_point", { id: "P", x: 2, y: 3, branchId: "left" }).status).toBe("accepted")
    expect(session.referenceDirectory("left").materializedPoints).toContain("P")
  })
})

describe("B9 line-conic intersection branch selection", () => {
  it("never chooses an arbitrary first of two intersections and lets the model select left/right branches", () => {
    const schema = buildDsActionToolSchemas().find(tool => tool.function.name === "construct_intersection")?.function.parameters
    expect(schema).toMatchObject({ type: "object", additionalProperties: false,
      properties: { lineA: { type: "string" }, conicId: { type: "string" },
        selection: { enum: ["min_x", "max_x", "min_y", "max_y"] } } })
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "A", x: -3, y: 0 }).status).toBe("accepted")
    expect(session.execute("construct_point", { id: "B", x: 3, y: 0 }).status).toBe("accepted")
    expect(session.execute("construct_line", { id: "L", from: "A", to: "B" }).status).toBe("accepted")
    expect(session.execute("construct_circle", { id: "C", radius: 2 }).status).toBe("accepted")
    const before = session.currentSnapshot()
    expect(session.execute("construct_intersection", { id: "P", lineA: "L", conicId: "C" })).toMatchObject({
      status: "repairable", blockerCode: "ambiguous_intersection"
    })
    expect(session.currentSnapshot()).toMatchObject({ candidateHash: before.candidateHash, primitiveCount: before.primitiveCount })
    expect(session.referenceDirectory().materializedPoints).not.toContain("P")
    expect(session.execute("construct_intersection", { id: "P", lineA: "L", conicId: "C", selection: "min_x" })).toMatchObject({
      status: "accepted", position: { x: -2, y: 0 }
    })
    expect(session.execute("construct_intersection", { id: "Q", lineA: "L", conicId: "C", selection: "max_x" })).toMatchObject({
      status: "accepted", position: { x: 2, y: 0 }
    })
  })

  it("refuses a tied coordinate or inapplicable selector rather than drawing a plausible wrong point", () => {
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    session.execute("construct_circle", { id: "C", radius: 2 })
    session.execute("construct_line", { id: "V", a: 1, b: 0, c: 0 })
    const before = session.currentSnapshot()
    expect(session.execute("construct_intersection", { id: "P", lineA: "V", conicId: "C", selection: "min_x" })).toMatchObject({
      status: "repairable", blockerCode: "ambiguous_intersection"
    })
    expect(session.execute("construct_intersection", { id: "P", lineA: "V", conicId: "C", selection: "highest" })).toMatchObject({
      status: "repairable", blockerCode: "invalid_selection"
    })
    expect(session.execute("construct_intersection", { id: "P", lineA: "V", conicId: "C", lineB: "V", selection: "max_y" })).toMatchObject({
      status: "repairable", blockerCode: "ambiguous_geometry_input"
    })
    expect(session.currentSnapshot()).toMatchObject({ candidateHash: before.candidateHash, primitiveCount: before.primitiveCount })
    expect(session.referenceDirectory().materializedPoints).not.toContain("P")
    expect(session.execute("construct_intersection", { id: "Q", lineA: "V", conicId: "C", selection: "max_y" })).toMatchObject({
      status: "accepted", position: { x: 0, y: 2 }
    })
    expect(session.execute("construct_intersection", { id: "R", lineA: "V", conicId: "C", selection: "min_y" })).toMatchObject({
      status: "accepted", position: { x: 0, y: -2 }
    })
    expect(session.execute("construct_line", { id: "T", a: 0, b: 1, c: -2 }).status).toBe("accepted")
    expect(session.execute("construct_intersection", { id: "Top", lineA: "T", conicId: "C" })).toMatchObject({
      status: "accepted", position: { x: 0, y: 2 }
    })
    expect(session.execute("construct_intersection", { id: "X", lineA: "T", lineB: "V" })).toMatchObject({
      status: "accepted", position: { x: 0, y: 2 }
    })
  })
})

describe("B8 segment parameter contract", () => {
  it("requires materialized endpoint references and rejects geometry fields that the segment action cannot use", () => {
    const tool = buildDsActionToolSchemas().find(item => item.function.name === "construct_segment")?.function
    expect(tool?.parameters).toMatchObject({ type: "object", additionalProperties: false, required: ["from", "to"],
      properties: { from: { type: "string" }, to: { type: "string" }, id: { type: "string" } } })
    const session = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(session.execute("construct_point", { id: "A", x: 0, y: 0 }).status).toBe("accepted")
    expect(session.execute("construct_point", { id: "B", x: 2, y: 0 }).status).toBe("accepted")
    const count = session.currentSnapshot().primitiveCount
    expect(session.execute("construct_segment", { id: "S", from: "A" })).toMatchObject({ status: "repairable", blockerCode: "missing_required_parameter" })
    expect(session.execute("construct_segment", { id: "S", from: "A", to: "B", radius: 9 })).toMatchObject({ status: "repairable", blockerCode: "invalid_schema" })
    expect(session.currentSnapshot().primitiveCount).toBe(count)
    expect(session.execute("construct_segment", { id: "S", from: "A", to: "B" }).status).toBe("accepted")
    expect(session.currentSnapshot().primitiveCount).toBe(count + 1)
    const spatial = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    expect(spatial.execute("construct_point", { id: "U", x: 0, y: 0, z: 0 }).status).toBe("accepted")
    expect(spatial.execute("construct_point", { id: "V", x: 0, y: 0, z: 3 }).status).toBe("accepted")
    expect(spatial.execute("construct_segment", { id: "UV", from: "U", to: "V" }).status).toBe("accepted")
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

    // 4b. query_constraint_status supports 3D collinearity checks via readP3
    const checkCollinear3d = session.execute("query_constraint_status", { kind: "collinear", targets: ["A", "MID_AB", "B"] })
    expect(checkCollinear3d.ok).toBe(true)
    expect(checkCollinear3d.constraintStatus).toBe("satisfied")
    expect(Number(checkCollinear3d.measurement?.residual ?? 999)).toBeLessThan(1e-6)

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

    const scopedFinish = foldSession.execute("finish_candidate", { goal: "subquestion 2 check", scopeId: "subquestion:2" })
    expect(scopedFinish.ok).toBe(true)
    expect(scopedFinish.terminated?.selectedScopeId).toBe("subquestion:2")
  })

  it("supports y=x^2/2 parabolas, external conic tangents, c+throughPointIds fit, materialized 5-vertex pyramids, and circle/point M coexistence", () => {
    // 1. y = x^2/2 parabola + two external tangents from D(1, -0.5)
    const pSess = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(pSess.execute("construct_conic", { id: "C", conicType: "parabola", equation: "y = x^2/2" }).ok).toBe(true)
    expect(pSess.execute("construct_point", { id: "D", x: 1, y: -0.5 }).ok).toBe(true)
    const tA = pSess.execute("construct_tangent", { id: "DA", conicId: "C", pointId: "D", tangentPointId: "A" })
    const tB = pSess.execute("construct_tangent", { id: "DB", conicId: "C", pointId: "D", tangentPointId: "B" })
    expect(tA.ok).toBe(true)
    expect(tB.ok).toBe(true)
    const ptA = tA.measurement?.tangentPoint as { x: number; y: number }
    const ptB = tB.measurement?.tangentPoint as { x: number; y: number }
    expect(Math.abs(ptA.y - (ptA.x * ptA.x) / 2)).toBeLessThan(1e-6)
    expect(Math.abs(ptB.y - (ptB.x * ptB.x) / 2)).toBeLessThan(1e-6)
    expect(Math.hypot(ptA.x - ptB.x, ptA.y - ptB.y)).toBeGreaterThan(1)

    // 2. c + single throughPointIds ellipse fit (JT-P06: c=1, M=(2, 2*sqrt(5)/5))
    const eSess = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(eSess.execute("construct_point", { id: "M", x: 2, y: (2 * Math.sqrt(5)) / 5 }).ok).toBe(true)
    const eFit = eSess.execute("construct_conic", { id: "E", conicType: "ellipse", c: 1, axis: "x", throughPointIds: ["M"] })
    expect(eFit.ok).toBe(true)
    const finishedEllipse = eSess.execute("finish_candidate", { goal: "ellipse fit" })
    expect(finishedEllipse.terminated?.plan.kind).toBe("plan")
    const conicAct = finishedEllipse.terminated?.plan.kind === "plan"
      ? finishedEllipse.terminated.plan.actions.find((a) => a.actionId === "planar.create_conic")
      : undefined
    expect(Number((conicAct?.inputs as { radiusX?: number }).radiusX)).toBeCloseTo(Math.sqrt(5), 5)
    expect(Number((conicAct?.inputs as { radiusY?: number }).radiusY)).toBeCloseTo(2, 5)

    // 3. Same-name point M & circle M coexistence + point-to-line distance
    const mSess = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(mSess.execute("construct_point", { id: "M", x: 2, y: 0 }).ok).toBe(true)
    expect(mSess.execute("construct_circle", { id: "M", centerId: "M", radius: 1 }).ok).toBe(true)
    expect(mSess.execute("construct_line", { id: "l", a: 1, b: 0, c: -1 }).ok).toBe(true)
    const dist = mSess.execute("query_measurement", { metric: "distance", targets: ["M", "l"] })
    expect(dist.ok).toBe(true)
    expect(Number(dist.measurement?.value)).toBeCloseTo(1, 6)

    // 4. Materialized 5-vertex right-trapezoidal pyramid assembled via construct_solid (JT-S03)
    const sSess = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    for (const [id, x, y, z] of [["A", 0, 0, 0], ["B", 2, 0, 0], ["C", 2, 1, 0], ["D", 0, 4, 0], ["P", 0, 0, 4]] as const) {
      expect(sSess.execute("construct_point", { id, x, y, z }).ok).toBe(true)
    }
    const trap = sSess.execute("construct_solid", { id: "PYR", kind: "perpendicular_pyramid", vertexNames: ["P", "A", "B", "C", "D"] })
    expect(trap.ok).toBe(true)

    // 5. Two static exterior tangents to a circle from P(4,2) produce two distinct secant lines (GK-P05)
    // and point M before circle M passes full math certificate without entityBindings hijacking (GK-P07 / JT-P09)
    const cTanSess = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(cTanSess.execute("construct_point", { id: "M", x: 2, y: -1 }).ok).toBe(true)
    expect(cTanSess.execute("construct_circle", { id: "M", centerId: "M", radius: 3 }).ok).toBe(true)
    expect(cTanSess.execute("construct_point", { id: "O", x: 0, y: 0 }).ok).toBe(true)
    const ct1 = cTanSess.execute("construct_tangent", { id: "t1", conicId: "M", pointId: "P" }) // undeclared P -> fails
    expect(ct1.ok).toBe(false)
    expect(cTanSess.execute("construct_point", { id: "Q", x: 6, y: 2 }).ok).toBe(true)
    const q1 = cTanSess.execute("construct_tangent", { id: "q1", conicId: "M", pointId: "Q" })
    const q2 = cTanSess.execute("construct_tangent", { id: "q2", conicId: "M", pointId: "Q" })
    expect(q1.ok).toBe(true)
    expect(q2.ok).toBe(true)
    const tp1 = q1.measurement?.tangentPoint as { x: number; y: number }
    const tp2 = q2.measurement?.tangentPoint as { x: number; y: number }
    expect(Math.hypot(tp1.x - tp2.x, tp1.y - tp2.y)).toBeGreaterThan(1)
  })

  it("supports circle-circle and concentric circle-ellipse construct_intersection with infeasible empty diagnostic", () => {
    const sess = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(sess.execute("construct_point", { id: "O", x: 0, y: 0 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "D", x: 2, y: 0 }).ok).toBe(true)
    expect(sess.execute("construct_circle", { id: "c1", centerId: "O", radius: 2 }).ok).toBe(true)
    expect(sess.execute("construct_circle", { id: "c2", centerId: "D", radius: 2 }).ok).toBe(true)
    const cc = sess.execute("construct_intersection", { id: "X", lineA: "c1", lineB: "c2", selection: "max_y" })
    expect(cc.ok).toBe(true)
    const xPt = cc.position as { x: number; y: number } | undefined
    expect(xPt?.x).toBeCloseTo(1, 6)
    expect(xPt?.y).toBeCloseTo(Math.sqrt(3), 6)

    // Thales circle r=1 strictly inside ellipse rx=sqrt(5), ry=2 -> no_intersection + scopeId: subquestion:1 guidance
    expect(sess.execute("construct_conic", { id: "E", conicType: "ellipse", centerX: 0, centerY: 0, radiusX: Math.sqrt(5), radiusY: 2 }).ok).toBe(true)
    expect(sess.execute("construct_circle", { id: "cSmall", centerId: "O", radius: 1 }).ok).toBe(true)
    const emptyCe = sess.execute("construct_intersection", { id: "P", lineA: "cSmall", conicId: "E" })
    expect(emptyCe.ok).toBe(false)
    expect(emptyCe.blockerCode).toBe("no_intersection")
    expect(emptyCe.repairHint).toContain("subquestion:1")

    // Concentric circle r=2 (tangent at co-vertices) with ellipse rx=sqrt(5), ry=2 -> unique max_y at (0, 2)
    expect(sess.execute("construct_circle", { id: "cCotan", centerId: "O", radius: 2 }).ok).toBe(true)
    const hitCe = sess.execute("construct_intersection", { id: "Q", lineA: "cCotan", conicId: "E", selection: "max_y" })
    expect(hitCe.ok).toBe(true)
    const qPt = hitCe.position as { x: number; y: number } | undefined
    expect(qPt?.x).toBeCloseTo(0, 6)
    expect(qPt?.y).toBeCloseTo(2, 6)

    // Concentric circle r=sqrt(4.5) creates 4 symmetric intersections; extreme x ties between +y and -y
    expect(sess.execute("construct_circle", { id: "cMid", centerId: "O", radius: Math.sqrt(4.5) }).ok).toBe(true)
    const tiedCe = sess.execute("construct_intersection", { id: "Q2", lineA: "cMid", conicId: "E", selection: "max_x" })
    expect(tiedCe.ok).toBe(false)
    expect(tiedCe.blockerCode).toBe("ambiguous_intersection")
  })

  it("returns circumsphere center/radius and supports query_measurement distance & position on circumsphere id", () => {
    const sess = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const tet = sess.execute("construct_solid", { id: "PYR", kind: "tetrahedron", vertexNames: ["P", "A", "B", "C"], ab: 1, ac: 1, bc: Math.SQRT2, pa: Math.sqrt(3), pb: 2, pc: 1 })
    expect(tet.ok).toBe(true)
    const edges = (tet.measurement?.edgeLengths ?? {}) as Record<string, number>
    expect(edges.AB).toBeCloseTo(1, 5)
    expect(edges.PB).toBeCloseTo(2, 5)

    const sphere = sess.execute("construct_circumsphere", { id: "O", solidId: "PYR" })
    expect(sphere.ok).toBe(true)
    const radius = Number((sphere.measurement as { radius?: number } | undefined)?.radius)
    expect(radius).toBeCloseTo(Math.sqrt(5) / 2, 5)

    const op = sess.execute("query_measurement", { metric: "distance", targets: ["O", "P"] })
    expect(op.ok).toBe(true)
    expect(Number(op.measurement?.value)).toBeCloseTo(radius, 5)

    const oPos = sess.execute("query_measurement", { metric: "position", targets: ["O"] })
    expect(oPos.ok).toBe(true)
  })

  it("promotes standalone 4 non-coplanar tetrahedron construct_point scaffolding to solid.create_polyhedron in finish_candidate", () => {
    const sess = createDsActionSession({
      workspace: "geometry3d",
      baseDocument: createEmptyDocument("geometry3d"),
      problemText: "三棱锥 A-BCD 中，E 在 BD 上，AE⊥CE，AE⊥DE，CD⊥AD，DE=2，BE=1，AE=√2，CD=2√3。"
    })
    expect(sess.execute("construct_point", { id: "B", x: -1, y: 0, z: 0 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "D", x: 2, y: 0, z: 0 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "C", x: 2, y: 2 * Math.sqrt(3), z: 0 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "A", x: 0, y: 0, z: Math.SQRT2 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "E", from: "B", to: "D", ratio: 1 / 3 }).ok).toBe(true)
    expect(sess.execute("construct_segment", { id: "AB", from: "A", to: "B" }).ok).toBe(true)
    expect(sess.execute("construct_segment", { id: "AE", from: "A", to: "E" }).ok).toBe(true)
    expect(sess.execute("construct_face", { id: "F_ABC", vertexNames: ["A", "B", "C"] }).ok).toBe(true)

    const fin = sess.execute("finish_candidate", { goal: "USER-16 scaffold promotion" })
    expect(fin.ok).toBe(true)
    expect(fin.terminated?.plan.kind).toBe("plan")
    if (fin.terminated?.plan.kind === "plan") {
      expect(fin.terminated.plan.actions.some((a) => a.actionId === "solid.create_polyhedron")).toBe(true)
    }
  })

  it("canonicalizes ASCII subscripts like F1/F_1 to stated Unicode F₁, supports perpendicular/parallel constraint queries, and resolves subquestion:1 after infeasible Thales circle", () => {
    const sess = createDsActionSession({
      workspace: "conics",
      baseDocument: createEmptyDocument("conics"),
      problemText: "已知 F₁，F₂ 是椭圆 C 的两个焦点，|F₁F₂|=2，M(2, 2√5/5) 为 C 上一点。（1）求方程；（2）若 P 为 C 上一点，且 PF₁⊥PF₂，求面积。"
    })
    expect(sess.execute("construct_point", { id: "F1", x: -1, y: 0 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "F_2", x: 1, y: 0 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "M", x: 2, y: (2 * Math.sqrt(5)) / 5 }).ok).toBe(true)
    expect(sess.execute("construct_segment", { id: "F1F2", from: "F1", to: "F₂" }).ok).toBe(true)
    expect(sess.execute("construct_conic", { id: "C", conicType: "ellipse", centerX: 0, centerY: 0, radiusX: Math.sqrt(5), radiusY: 2 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "O", x: 0, y: 0 }).ok).toBe(true)
    expect(sess.execute("construct_circle", { id: "cT", centerId: "O", radius: 1 }).ok).toBe(true)
    expect(sess.execute("construct_intersection", { id: "P", lineA: "cT", conicId: "C" }).ok).toBe(false)

    // P omitted after kernel no_intersection proof -> finish_candidate auto-selects subquestion:1
    const fin = sess.execute("finish_candidate", { goal: "JT-P06 done" })
    expect(fin.ok).toBe(true)
    expect(fin.terminated?.selectedScopeId).toBe("subquestion:1")
    if (fin.terminated?.plan.kind === "plan") {
      const f1Create = fin.terminated.plan.actions.find((a) => (a.inputs as { alias?: string }).alias === "F1")
      const f2Create = fin.terminated.plan.actions.find((a) => (a.inputs as { alias?: string }).alias === "F_2")
      expect((f1Create?.inputs as { label?: string }).label).toBe("F₁")
      expect((f2Create?.inputs as { label?: string }).label).toBe("F₂")
    }

    // query_constraint_status perpendicular (violated + hypotenuse hint & satisfied) and parallel
    const s3 = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    expect(s3.execute("construct_point", { id: "A", x: 0, y: 0, z: 0 }).ok).toBe(true)
    expect(s3.execute("construct_point", { id: "B", x: 1, y: 0, z: 0 }).ok).toBe(true)
    expect(s3.execute("construct_point", { id: "C", x: 0.5, y: Math.sqrt(3) / 2, z: 0 }).ok).toBe(true)
    expect(s3.execute("construct_point", { id: "D", x: 0, y: 1, z: 0 }).ok).toBe(true)
    expect(s3.execute("construct_point", { id: "E", x: 2, y: 0, z: 0 }).ok).toBe(true)
    const badPerp = s3.execute("query_constraint_status", { kind: "perpendicular", targets: ["B", "A", "C"] })
    expect(badPerp.ok).toBe(true)
    expect(badPerp.constraintStatus).toBe("violated")
    expect(Number((badPerp.measurement as { expectedHypotenuse?: number } | undefined)?.expectedHypotenuse)).toBeCloseTo(Math.SQRT2, 6)
    const okPerp = s3.execute("query_constraint_status", { kind: "perpendicular", targets: ["B", "A", "D"] })
    expect(okPerp.ok).toBe(true)
    expect(okPerp.constraintStatus).toBe("satisfied")
    const okPar = s3.execute("query_constraint_status", { kind: "parallel", targets: ["A", "B", "A", "E"] })
    expect(okPar.ok).toBe(true)
    expect(okPar.constraintStatus).toBe("satisfied")
  })

  it("promotes 5-vertex right-trapezoid pyramid scaffolding (P-ABCD + M) to solid.create_polyhedron and preserves materialized vertices in perpendicular_pyramid", () => {
    const prompt = "在四棱锥 P-ABCD 中，底面 ABCD 为直角梯形，AD∥BC，AB⊥AD，PA⊥平面 ABCD，AP=AD=2AB=4BC。（2）若 AM⊥平面 PCD 于点 M，求二面角 M-AD-P 的余弦值。"
    const sess = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"), problemText: prompt })
    expect(sess.execute("construct_point", { id: "A", x: 0, y: 0, z: 0 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "B", x: 2, y: 0, z: 0 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "C", x: 2, y: 1, z: 0 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "D", x: 0, y: 4, z: 0 }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "P", x: 0, y: 0, z: 4 }).ok).toBe(true)
    // Foot of perpendicular from A to plane PCD: plane is 3x + 2y + 2z = 8 -> M = (24/17, 16/17, 16/17)
    expect(sess.execute("construct_point", { id: "M", x: 24 / 17, y: 16 / 17, z: 16 / 17 }).ok).toBe(true)
    expect(sess.execute("construct_segment", { id: "AM", from: "A", to: "M" }).ok).toBe(true)

    const fin = sess.execute("finish_candidate", { goal: "JT-S03 5-vertex promotion" })
    expect(fin.ok).toBe(true)
    expect(fin.terminated?.plan.kind).toBe("plan")
    if (fin.terminated?.plan.kind === "plan") {
      const poly = fin.terminated.plan.actions.find((a) => a.actionId === "solid.create_polyhedron")
      expect(poly).toBeDefined()
      expect((poly?.inputs as { vertexNames?: string[] }).vertexNames).toEqual(["P", "A", "B", "C", "D"])
    }

    // Calling construct_solid perpendicular_pyramid with materialized A,B,C,D,P + height preserves exact trapezoid instead of overwriting
    const s2 = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d"), problemText: prompt })
    s2.execute("construct_point", { id: "A", x: 0, y: 0, z: 0 })
    s2.execute("construct_point", { id: "B", x: 2, y: 0, z: 0 })
    s2.execute("construct_point", { id: "C", x: 2, y: 1, z: 0 })
    s2.execute("construct_point", { id: "D", x: 0, y: 4, z: 0 })
    s2.execute("construct_point", { id: "P", x: 0, y: 0, z: 4 })
    const solid = s2.execute("construct_solid", { kind: "perpendicular_pyramid", vertexNames: ["P", "A", "B", "C", "D"], height: 4 })
    expect(solid.ok).toBe(true)
    const bc = s2.execute("query_measurement", { metric: "distance", targets: ["B", "C"] })
    expect(Number(bc.measurement?.value)).toBeCloseTo(1, 5)
    const ad = s2.execute("query_measurement", { metric: "distance", targets: ["A", "D"] })
    expect(Number(ad.measurement?.value)).toBeCloseTo(4, 5)
  })

  it("aligns tetrahedron vertexNames=[A,B,C,P] to match pa/pb/pc/ab/ac/bc and differentiates failed progressSignatures by input", () => {
    const sess = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const okSolid = sess.execute("construct_solid", {
      kind: "tetrahedron",
      vertexNames: ["A", "B", "C", "P"],
      pa: Math.sqrt(3),
      pb: 2,
      pc: 1,
      ab: 1,
      ac: 1,
      bc: Math.SQRT2
    })
    expect(okSolid.ok).toBe(true)
    expect(Number(sess.execute("query_measurement", { metric: "distance", targets: ["P", "A"] }).measurement?.value)).toBeCloseTo(Math.sqrt(3), 5)
    expect(Number(sess.execute("query_measurement", { metric: "distance", targets: ["B", "C"] }).measurement?.value)).toBeCloseTo(Math.SQRT2, 5)

    // Positional vertexNames=["A","B","C","D"] (no "P") preserves A as apex so pa=|AB|, pc=|AD| (e.g. 三棱锥 A-BCD)
    const sessAbcd = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const abcdSolid = sessAbcd.execute("construct_solid", {
      kind: "tetrahedron",
      vertexNames: ["A", "B", "C", "D"],
      pa: Math.sqrt(3),
      pb: Math.sqrt(18),
      pc: Math.sqrt(6),
      ab: Math.sqrt(21),
      ac: 3,
      bc: 2 * Math.sqrt(3)
    })
    expect(abcdSolid.ok).toBe(true)
    expect(Number(sessAbcd.execute("query_measurement", { metric: "distance", targets: ["A", "B"] }).measurement?.value)).toBeCloseTo(Math.sqrt(3), 5)
    expect(Number(sessAbcd.execute("query_measurement", { metric: "distance", targets: ["C", "D"] }).measurement?.value)).toBeCloseTo(2 * Math.sqrt(3), 5)

    // Two distinct failing construct_solid inputs must NOT collide on progressSignature
    const sFail = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    sFail.execute("construct_point", { id: "A", x: 0, y: 0, z: 0 })
    sFail.execute("construct_point", { id: "B", x: 1, y: 0, z: 0 })
    sFail.execute("construct_point", { id: "C", x: 0, y: 1, z: 0 })
    sFail.execute("construct_point", { id: "P", x: 1, y: 1, z: 0 })
    const f1 = sFail.execute("construct_solid", { kind: "tetrahedron", pa: 10, pb: 1, pc: 1, ab: 1, ac: 1, bc: 1 })
    const f2 = sFail.execute("construct_solid", { kind: "tetrahedron", vertexNames: ["P", "A", "B", "C"] })
    expect(f1.ok).toBe(false)
    expect(f2.ok).toBe(false)
    expect(f1.progressSignature).not.toBe(f2.progressSignature)
  })

  it("rejects duplicate/tangent intersections in construct_intersection and runs in-session pre-cert self-repair in finish_candidate", () => {
    const sess = createDsActionSession({
      workspace: "conics",
      baseDocument: createEmptyDocument("conics"),
      problemText: "已知两点 A(0, √3)，B(0, -√3)。曲线 G：x²/4+y²/3=1。（Ⅱ）过点 C(0, -1) 的直线与 G 相交于 E、F 两点，且 向量EC=2向量CF，求直线 EF 的方程。"
    })
    expect(sess.execute("construct_point", { id: "A", x: 0, y: Math.sqrt(3) }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "B", x: 0, y: -Math.sqrt(3) }).ok).toBe(true)
    expect(sess.execute("construct_point", { id: "C", x: 0, y: -1 }).ok).toBe(true)
    expect(sess.execute("construct_conic", { id: "G", conicType: "ellipse", centerX: 0, centerY: 0, radiusX: 2, radiusY: Math.sqrt(3) }).ok).toBe(true)
    // Wrong slope k = sqrt(3/2) gives ratio 3 instead of 2
    expect(sess.execute("construct_line", { id: "l", equation: "y=sqrt(6)/2*x-1" }).ok).toBe(true)
    expect(sess.execute("construct_intersection", { id: "E", lineA: "l", conicId: "G", selection: "max_x" }).ok).toBe(true)
    // Selecting max_y on positive slope picks the same point as max_x -> must be rejected as duplicate_intersection_point
    const dup = sess.execute("construct_intersection", { id: "F", lineA: "l", conicId: "G", selection: "max_y" })
    expect(dup.ok).toBe(false)
    expect(dup.blockerCode).toBe("duplicate_intersection_point")

    expect(sess.execute("construct_intersection", { id: "F", lineA: "l", conicId: "G", excludePointId: "E" }).ok).toBe(true)
    // First finish_candidate catches ratio 3.0 != 2 in-session without destroying canvas!
    const preReject = sess.execute("finish_candidate", { goal: "JT-P08 bad slope" })
    expect(preReject.ok).toBe(false)
    expect(preReject.blockerCode).toBe("diagram_condition_failed")
    expect(preReject.repairHint).toContain("3.0000")

    // Repair ONLY l, E, F in-session to exact k = 0.5 -> finish_candidate passes immediately!
    expect(sess.execute("repair_entity", { target: "F" }).ok).toBe(true)
    expect(sess.execute("repair_entity", { target: "E" }).ok).toBe(true)
    expect(sess.execute("repair_entity", { target: "l" }).ok).toBe(true)
    expect(sess.execute("construct_line", { id: "l", equation: "y=0.5*x-1" }).ok).toBe(true)
    expect(sess.execute("construct_intersection", { id: "E", lineA: "l", conicId: "G", selection: "max_x" }).ok).toBe(true)
    expect(sess.execute("construct_intersection", { id: "F", lineA: "l", conicId: "G", excludePointId: "E" }).ok).toBe(true)
    const fin = sess.execute("finish_candidate", { goal: "JT-P08 exact slope" })
    expect(fin.ok).toBe(true)
    expect(fin.terminated).toBeDefined()
  })

  it("blocks construct_face on 2D planar workspaces, blocks cop-out request_clarification on self-contained pure-text problems, and computes exact 3D tetrahedron feasibility intervals", () => {
    const s2d = createDsActionSession({
      workspace: "conics",
      baseDocument: createEmptyDocument("conics"),
      problemText: "在圆 M：x²+y²-4x+2y-4=0 内，过点 O(0, 0) 的最长弦和最短弦分别是 AC 和 BD，则四边形 ABCD 的面积为（　　）"
    })
    s2d.execute("construct_point", { id: "A", x: 0, y: 0 })
    s2d.execute("construct_point", { id: "B", x: 1, y: 0 })
    s2d.execute("construct_point", { id: "C", x: 1, y: 1 })
    const badFace = s2d.execute("construct_face", { id: "F", vertexNames: ["A", "B", "C"] })
    expect(badFace.ok).toBe(false)
    expect(badFace.blockerCode).toBe("workspace_mismatch")

    const badClarify = s2d.execute("request_clarification", { reason: "系统验证器提示候选图没有唯一圆锥曲线，是否按 M(2,-1), r=3 作图？" })
    expect(badClarify.ok).toBe(false)
    expect(badClarify.blockerCode).toBe("clarification_unnecessary")

    const badClarify2 = s2d.execute("request_clarification", { reason: "（Ⅰ）G 的方程 x^2/4+y^2/3=1 是否符合题意？" })
    expect(badClarify2.ok).toBe(false)
    expect(badClarify2.blockerCode).toBe("clarification_unnecessary")

    const s3d = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const infeas = s3d.execute("construct_solid", {
      kind: "tetrahedron",
      vertexNames: ["P", "A", "B", "C"],
      ab: 1,
      ac: 1,
      bc: Math.SQRT2,
      pa: Math.sqrt(3),
      pb: 1.2,
      pc: 1
    })
    expect(infeas.ok).toBe(false)
    expect(infeas.repairHint).toContain("1.506")
    expect(infeas.repairHint).toContain("2.3942")
    expect(infeas.repairHint).toContain("pb=2")

    // construct_circumsphere registers its center in readP3 so construct_segment and query_constraint_status can reference "O" directly
    const sCircum = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    expect(sCircum.execute("construct_point", { id: "A", x: 0, y: 0, z: 0 }).ok).toBe(true)
    expect(sCircum.execute("construct_point", { id: "B", x: 0, y: 1, z: 0 }).ok).toBe(true)
    expect(sCircum.execute("construct_point", { id: "C", x: 1, y: 0, z: 0 }).ok).toBe(true)
    expect(sCircum.execute("construct_point", { id: "P", x: 1.5, y: 0, z: Math.sqrt(3) / 2 }).ok).toBe(true)
    expect(sCircum.execute("construct_solid", { kind: "tetrahedron", id: "pyr", vertexNames: ["P", "A", "B", "C"] }).ok).toBe(true)
    expect(sCircum.execute("construct_circumsphere", { id: "O", solidId: "pyr" }).ok).toBe(true)
    expect(sCircum.execute("query_measurement", { metric: "distance", targets: ["O", "P"] }).ok).toBe(true)
    expect(sCircum.execute("query_constraint_status", { kind: "perpendicular", targets: ["O", "A", "B"] }).ok).toBe(true)
  })

  it("supports native A-BCD six-edge tetrahedron (ab,ac,ad,bc,bd,cd) and exact closed-form conic chordRatio solver in construct_line", () => {
    // 1. A-BCD six-edge direct call (USER-16)
    const sTet = createDsActionSession({ workspace: "geometry3d", baseDocument: createEmptyDocument("geometry3d") })
    const resTet = sTet.execute("construct_solid", {
      kind: "tetrahedron",
      id: "pyr",
      vertexNames: ["A", "B", "C", "D"],
      ab: Math.sqrt(3),
      ac: Math.sqrt(18),
      ad: Math.sqrt(6),
      bc: Math.sqrt(21),
      bd: 3,
      cd: 2 * Math.sqrt(3)
    })
    expect(resTet.ok).toBe(true)
    expect(Number(sTet.execute("query_measurement", { metric: "distance", targets: ["A", "D"] }).measurement?.value)).toBeCloseTo(Math.sqrt(6), 5)
    expect(Number(sTet.execute("query_measurement", { metric: "distance", targets: ["B", "D"] }).measurement?.value)).toBeCloseTo(3, 5)
    expect(Number(sTet.execute("query_measurement", { metric: "distance", targets: ["C", "D"] }).measurement?.value)).toBeCloseTo(2 * Math.sqrt(3), 5)
    expect(sTet.execute("query_constraint_status", { kind: "perpendicular", targets: ["C", "D", "A"] }).constraintStatus).toBe("satisfied")

    // 2. Exact closed-form conic chordRatio solver on ellipse x²/4 + y²/3 = 1 through C(0,-1) with ratio=2 (JT-P08)
    const sEll = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(sEll.execute("construct_conic", { id: "G", conicType: "ellipse", centerX: 0, centerY: 0, radiusX: 2, radiusY: Math.sqrt(3) }).ok).toBe(true)
    expect(sEll.execute("construct_point", { id: "C", x: 0, y: -1 }).ok).toBe(true)
    const chordLine = sEll.execute("construct_line", { id: "l", throughPointId: "C", conicId: "G", chordRatio: 2 })
    expect(chordLine.ok).toBe(true)
    expect(Number((chordLine.measurement as { slope?: number } | undefined)?.slope)).toBeCloseTo(0.5, 5)
    expect(sEll.execute("construct_intersection", { id: "E", lineA: "l", conicId: "G", selection: "max_x" }).ok).toBe(true)
    expect(sEll.execute("construct_intersection", { id: "F", lineA: "l", conicId: "G", excludePointId: "E" }).ok).toBe(true)
    const ec = Number(sEll.execute("query_measurement", { metric: "distance", targets: ["E", "C"] }).measurement?.value)
    const cf = Number(sEll.execute("query_measurement", { metric: "distance", targets: ["C", "F"] }).measurement?.value)
    expect(ec / cf).toBeCloseTo(2, 5)

    // 3. Exact closed-form conic chordRatio solver on parabola y² = 4x through C(2,0) with ratio=2
    const sPar = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(sPar.execute("construct_conic", { id: "P", conicType: "parabola", equation: "y^2=4x" }).ok).toBe(true)
    expect(sPar.execute("construct_point", { id: "C", x: 2, y: 0 }).ok).toBe(true)
    const pLine = sPar.execute("construct_line", { id: "lp", throughPointId: "C", conicId: "P", chordRatio: 2 })
    expect(pLine.ok).toBe(true)
    expect(sPar.execute("construct_intersection", { id: "E", lineA: "lp", conicId: "P", selection: "max_x" }).ok).toBe(true)
    expect(sPar.execute("construct_intersection", { id: "F", lineA: "lp", conicId: "P", excludePointId: "E" }).ok).toBe(true)
    const pec = Number(sPar.execute("query_measurement", { metric: "distance", targets: ["E", "C"] }).measurement?.value)
    const pcf = Number(sPar.execute("query_measurement", { metric: "distance", targets: ["C", "F"] }).measurement?.value)
    expect(pec / pcf).toBeCloseTo(2, 5)

    // 4. LaTeX subscript canonicalization ($A_{1}, A_{2}, A_{3}$ -> A₁, A₂, A₃ for GK-P05)
    const sLatex = createDsActionSession({
      workspace: "conics",
      baseDocument: createEmptyDocument("conics"),
      problemText: "设 $A_{1}, A_{2}, A_{3}$ 是抛物线 $C$ 上的三个点。"
    })
    expect(sLatex.execute("construct_point", { id: "A1", x: 1, y: 2 }).ok).toBe(true)
    expect(sLatex.execute("construct_point", { id: "A_2", x: 4, y: -4 }).ok).toBe(true)
    const finL = sLatex.execute("finish_candidate", { goal: "latex subscripts" })
    expect(finL.ok).toBe(true)
    if (finL.terminated?.plan.kind === "plan") {
      const a1 = finL.terminated.plan.actions.find((a) => (a.inputs as { alias?: string }).alias === "A1")
      const a2 = finL.terminated.plan.actions.find((a) => (a.inputs as { alias?: string }).alias === "A_2")
      expect((a1?.inputs as { label?: string }).label).toBe("A₁")
      expect((a2?.inputs as { label?: string }).label).toBe("A₂")
    }

    // 5. finish_candidate forwards validated normalisations onto the returned plan envelope
    const sNorm = createDsActionSession({ workspace: "conics", baseDocument: createEmptyDocument("conics") })
    expect(sNorm.execute("construct_point", { id: "A", x: 0, y: 0 }).ok).toBe(true)
    const finNorm = sNorm.execute("finish_candidate", {
      goal: "square with normalised phrasing",
      normalisations: [
        { original: "正四边", normalized: "正方形" },
        { original: "", normalized: "ignored" }
      ]
    })
    expect(finNorm.ok).toBe(true)
    if (finNorm.terminated?.plan.kind === "plan") {
      expect(finNorm.terminated.plan.normalisations).toEqual([
        { original: "正四边", normalized: "正方形" }
      ])
    }
  })

  it("preserves constructed sub-faces lying inside a solid face while still deduplicating exact full-face copies", () => {
    const session = createDsActionSession({
      workspace: "geometry3d",
      baseDocument: createEmptyDocument("geometry3d"),
      problemText: "在四棱锥 P-ABCD 中，底面 ABCD 为正方形，E 为 AB 中点，F 为 BC 中点，画出三角形面 AEF。"
    })
    for (const [id, x, y, z] of [["P", 0, 0, 2], ["A", 0, 0, 0], ["B", 2, 0, 0], ["C", 2, 2, 0], ["D", 0, 2, 0]] as const) {
      expect(session.execute("construct_point", { id, x, y, z }).ok).toBe(true)
    }
    expect(session.execute("construct_solid", { id: "pyramid", vertexNames: ["P", "A", "B", "C", "D"] }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "E", x: 1, y: 0, z: 0 }).ok).toBe(true)
    expect(session.execute("construct_point", { id: "F", x: 2, y: 1, z: 0 }).ok).toBe(true)
    // Valid sub-face lying strictly inside base ABCD
    expect(session.execute("construct_face", { id: "face_AEF", label: "面 AEF", vertexNames: ["A", "E", "F"] }).ok).toBe(true)
    // Exact duplicate of the existing base face ABCD
    expect(session.execute("construct_face", { id: "face_ABCD_dup", label: "面 ABCD", vertexNames: ["A", "B", "C", "D"] }).ok).toBe(true)

    const fin = session.execute("finish_candidate", { goal: "四棱锥 P-ABCD 与底面内子三角形面 AEF" })
    expect(fin.ok).toBe(true)
    expect(fin.terminated?.plan.kind).toBe("plan")
    if (fin.terminated?.plan.kind === "plan") {
      const faceActions = fin.terminated.plan.actions.filter((a) => a.actionId === "solid.create_face")
      const aliases = faceActions.map((a) => (a.inputs as { alias?: string }).alias)
      expect(aliases).toContain("face_AEF")
      expect(aliases).not.toContain("face_ABCD_dup")
    }
  })

  it("solves distinct exact inspheres M and N for sub-tetrahedra T-PAB and T-ABC, materializes centers for faces/segments, and passes full verification", () => {
    const prompt = "14.在各棱长均相等的正四面体 PABC 中,取棱PC一点T,使PT=2TC,连接TA,TB,三棱锥T-PAB 的内切球的球心为M,三棱锥T-ABC的内切球的球心为N,则平面MAB 与平面NAB 的夹角的正弦值是"
    const session = createDsActionSession({
      workspace: "geometry3d",
      baseDocument: createEmptyDocument("geometry3d"),
      problemText: prompt
    })

    expect(session.execute("construct_solid", {
      id: "PABC",
      kind: "tetrahedron",
      edgeLength: 3,
      vertexNames: ["P", "A", "B", "C"]
    }).ok).toBe(true)

    expect(session.execute("construct_point", {
      id: "T",
      from: "P",
      to: "C",
      ratio: 2 / 3
    }).ok).toBe(true)

    expect(session.execute("construct_segment", { id: "TA", from: "T", to: "A" }).ok).toBe(true)
    expect(session.execute("construct_segment", { id: "TB", from: "T", to: "B" }).ok).toBe(true)

    expect(session.execute("construct_solid", {
      id: "T_PAB",
      kind: "tetrahedron",
      vertexNames: ["T", "P", "A", "B"]
    }).ok).toBe(true)

    expect(session.execute("construct_solid", {
      id: "T_ABC",
      kind: "tetrahedron",
      vertexNames: ["T", "A", "B", "C"]
    }).ok).toBe(true)

    const insM = session.execute("construct_circumsphere", {
      id: "M",
      solidId: "T_PAB",
      mode: "insphere"
    })
    expect(insM.ok).toBe(true)
    expect(insM.measurement?.exactInsphere).toBe(true)

    const insN = session.execute("construct_circumsphere", {
      id: "N",
      solidId: "T_ABC",
      mode: "insphere"
    })
    expect(insN.ok).toBe(true)
    expect(insN.measurement?.exactInsphere).toBe(true)

    // Must target distinct sub-tetrahedra rather than falling back to the first polyhedron PABC
    const distMN = session.execute("query_measurement", { metric: "distance", targets: ["M", "N"] })
    expect(distMN.ok).toBe(true)
    expect(Number(distMN.measurement?.value)).toBeGreaterThan(0.2)

    // Sphere centers M and N can immediately be used in segments and planes MAB / NAB
    expect(session.execute("construct_segment", { id: "MN", from: "M", to: "N" }).ok).toBe(true)
    expect(session.execute("construct_face", { id: "face_MAB", label: "平面 MAB", vertexNames: ["M", "A", "B"] }).ok).toBe(true)
    expect(session.execute("construct_face", { id: "face_NAB", label: "平面 NAB", vertexNames: ["N", "A", "B"] }).ok).toBe(true)

    const fin = session.execute("finish_candidate", {
      goal: "正四面体 PABC 中分点 T 及子三棱锥 T-PAB、T-ABC 内切球心 M、N 与平面 MAB、NAB"
    })
    expect(fin.ok).toBe(true)
    expect(fin.terminated?.plan.kind).toBe("plan")
    if (fin.terminated?.plan.kind === "plan") {
      const compiled = compilePlan(fin.terminated.plan, {
        document: createEmptyDocument("geometry3d"),
        conversationId: "reg-pabc-insphere",
        documentGeneration: 0,
        workspace: "geometry3d",
        prompt
      })
      expect(compiled.ok).toBe(true)
      expect(compiled.diagramVerification?.status).toBe("passed")
      expect(compiled.diagramVerification?.checks.length).toBeGreaterThanOrEqual(6)
      expect(compiled.diagramVerification?.checks.every((c) => c.status === "passed")).toBe(true)
    }
  })

  it("supports query_measurement for line_plane_angle, skew line_angle, and dihedral_angle", () => {
    const session = createDsActionSession({
      workspace: "geometry3d",
      baseDocument: createEmptyDocument("geometry3d"),
      problemText: "在单位正方体 ABCD-A₁B₁C₁D₁ 中，求体对角线 AC₁ 与底面 ABCD 所成角、异面直线 AB₁ 与 BC₁ 所成角以及二面角 A₁-AB-C。"
    })
    for (const [id, x, y, z] of [
      ["A", 0, 0, 0], ["B", 1, 0, 0], ["C", 1, 1, 0], ["D", 0, 1, 0],
      ["A1", 0, 0, 1], ["B1", 1, 0, 1], ["C1", 1, 1, 1]
    ] as const) {
      expect(session.execute("construct_point", { id, x, y, z }).ok).toBe(true)
    }

    const lp = session.execute("query_measurement", { metric: "line_plane_angle", targets: ["A", "C1", "A", "B", "C"] })
    expect(lp.ok).toBe(true)
    expect(Number(lp.measurement?.sin)).toBeCloseTo(1 / Math.sqrt(3), 6)
    expect(lp.measurement?.relation).toBe("oblique")

    const la = session.execute("query_measurement", { metric: "line_angle", targets: ["A", "B1", "B", "C1"] })
    expect(la.ok).toBe(true)
    expect(Number(la.measurement?.degrees)).toBeCloseTo(60, 6)
    expect(la.measurement?.relation).toBe("skew")

    const dh = session.execute("query_measurement", { metric: "dihedral_angle", targets: ["A1", "A", "B", "C"] })
    expect(dh.ok).toBe(true)
    expect(Number(dh.measurement?.degrees)).toBeCloseTo(90, 6)
  })
})
