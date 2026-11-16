import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import {
  auditMaterializedIntent,
  collectDependentSubgraph,
  compileConstructionDag,
  deriveRequiredDrawingIntent,
  type DrawingIntentNode
} from "./drawingIntent"
import { compilePlan } from "./planCompiler"

const GK_S02_PROMPT =
  "如图，平面四边形 ABCD 中，AB=8，CD=3，AD=5√3，∠ADC=90°，∠BAD=30°，点 E，F 满足 AE=2/5 AD，AF=1/2 AB，将 △AEF 沿 EF 对折至 △PEF，使得 PC=4√3。（1）证明：EF⊥PD；（2）求面 PCD 与面 PBF 所成的二面角的正弦值。"

const JT_P06_PROMPT =
  "已知 F₁，F₂ 是椭圆 C：x²/a² + y²/b² = 1 (a>b>0) 的两个焦点，|F₁F₂|=2，M(2, 2√5/5) 为 C 上一点。（1）求椭圆 C 的标准方程；（2）若 P 为 C 上一点，且 PF₁⊥PF₂，求 △F₁PF₂ 的面积。"

describe("T06 construction intent DAG invariants", () => {
  it("rejects cyclic dependencies, duplicate entity IDs, missing hosts, wrong host types, unsupported operators, and pre-fold state violations", () => {
    const validBase: DrawingIntentNode = {
      nodeId: "n-base",
      outputEntityId: "C",
      outputKind: "conic",
      operator: "planar.create_conic",
      dependencyIds: [],
      scopeId: "shared",
      stateId: "s0",
      sourceRefs: []
    }

    // 1. Cycle
    const cycleResult = compileConstructionDag([
      { ...validBase, nodeId: "n-a", outputEntityId: "A", outputKind: "point", operator: "planar.create_point", dependencyIds: ["n-b"] },
      { ...validBase, nodeId: "n-b", outputEntityId: "B", outputKind: "point", operator: "planar.create_point", dependencyIds: ["n-a"] }
    ])
    expect(cycleResult.ok).toBe(false)
    if (!cycleResult.ok) expect(cycleResult.diagnostics.some((d) => d.code === "cyclic_dependency")).toBe(true)

    // 2. Duplicate entity ID in same scope/state
    const dupResult = compileConstructionDag([
      validBase,
      { ...validBase, nodeId: "n-dup", outputEntityId: "C" }
    ])
    expect(dupResult.ok).toBe(false)
    if (!dupResult.ok) expect(dupResult.diagnostics.some((d) => d.code === "duplicate_entity_id")).toBe(true)

    // 3. Missing host
    const missingHostResult = compileConstructionDag([
      {
        nodeId: "n-pt",
        outputEntityId: "E",
        outputKind: "point",
        operator: "dynamic.create_bound_point",
        dependencyIds: ["n-missing-seg"],
        hostEntityId: "missing-seg",
        requiredHostKind: "segment",
        scopeId: "shared",
        stateId: "s0",
        sourceRefs: []
      }
    ])
    expect(missingHostResult.ok).toBe(false)
    if (!missingHostResult.ok) expect(missingHostResult.diagnostics.some((d) => d.code === "missing_host")).toBe(true)

    // 4. Wrong host kind (attaching focus to a point instead of conic)
    const wrongHostResult = compileConstructionDag([
      { ...validBase, nodeId: "n-pt", outputEntityId: "A", outputKind: "point", operator: "planar.create_point" },
      {
        nodeId: "n-f1",
        outputEntityId: "F₁",
        outputKind: "focus",
        operator: "solve.conic_focus",
        dependencyIds: ["n-pt"],
        hostEntityId: "A",
        requiredHostKind: "conic",
        scopeId: "shared",
        stateId: "s0",
        sourceRefs: []
      }
    ])
    expect(wrongHostResult.ok).toBe(false)
    if (!wrongHostResult.ok) expect(wrongHostResult.diagnostics.some((d) => d.code === "wrong_host_kind")).toBe(true)

    // 5. Unsupported operator
    const badOpResult = compileConstructionDag([
      { ...validBase, nodeId: "n-bad", outputEntityId: "X", operator: "unsupported.magic_op" }
    ])
    expect(badOpResult.ok).toBe(false)
    if (!badOpResult.ok) expect(badOpResult.diagnostics.some((d) => d.code === "unsupported_operator")).toBe(true)

    // 6. Pre-fold host violation (post_fold dependent referencing pre_fold vertex directly without fold transition)
    const foldViolationResult = compileConstructionDag([
      {
        nodeId: "n-pre-a",
        outputEntityId: "A",
        outputKind: "point",
        operator: "solid.create_point",
        dependencyIds: [],
        scopeId: "shared",
        stateId: "s0",
        foldPhase: "pre_fold",
        sourceRefs: []
      },
      {
        nodeId: "n-post-seg",
        outputEntityId: "PA",
        outputKind: "segment",
        operator: "solid.create_segment",
        dependencyIds: ["n-pre-a"],
        hostEntityId: "A",
        scopeId: "shared",
        stateId: "s1",
        foldPhase: "post_fold",
        sourceRefs: []
      }
    ])
    expect(foldViolationResult.ok).toBe(false)
    if (!foldViolationResult.ok) expect(foldViolationResult.diagnostics.some((d) => d.code === "pre_fold_host_violation")).toBe(true)
  })

  it("computes deterministic topological order and incremental dependent subgraph invalidation for T12", () => {
    const intent = deriveRequiredDrawingIntent({ prompt: JT_P06_PROMPT, requiredEntityIds: ["C", "F₁", "F₂", "M", "P"] })
    const compiled = compileConstructionDag(intent.nodes)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const orderIds = compiled.executionOrder.map((n) => n.outputEntityId)
    expect(orderIds.indexOf("C")).toBeLessThan(orderIds.indexOf("F₁"))
    expect(orderIds.indexOf("C")).toBeLessThan(orderIds.indexOf("F₂"))
    expect(orderIds.indexOf("C")).toBeLessThan(orderIds.indexOf("M"))

    const impacted = collectDependentSubgraph(compiled.executionOrder, ["C"])
    expect(impacted).toEqual(expect.arrayContaining(["C", "F₁", "F₂", "M", "P"]))
  })
})

describe("T06 missing/fake/hidden object audits on GK-S02 and JT-P06", () => {
  it("GK-S02: detects missing E, F, P, rejects isolated label faking and hidden auxiliary primitives", () => {
    const intent = deriveRequiredDrawingIntent({ prompt: GK_S02_PROMPT, requiredEntityIds: ["A", "B", "C", "D", "E", "F", "P"] })
    const dag = compileConstructionDag(intent.nodes)
    expect(dag.ok).toBe(true)
    if (!dag.ok) return

    const onlyQuadDoc: GeometryDocument = {
      ...createEmptyDocument("geometry3d"),
      primitives: [
        { id: "v-a", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "A" },
        { id: "v-b", type: "point3", position: { x: 8, y: 0, z: 0 }, label: "B" },
        { id: "v-c", type: "point3", position: { x: 5, y: 3, z: 0 }, label: "C" },
        { id: "v-d", type: "point3", position: { x: 0, y: 5, z: 0 }, label: "D" }
      ]
    }
    const missingAudit = auditMaterializedIntent(dag.executionOrder, onlyQuadDoc)
    expect(missingAudit.ok).toBe(false)
    expect(missingAudit.diagnostics.filter((d) => d.code === "missing_entity").map((d) => d.entityId)).toEqual(
      expect.arrayContaining(["E", "F", "P"])
    )

    // Faking E with a label/text/annotation instead of real point primitive must be caught.
    const fakeLabelDoc: GeometryDocument = {
      ...createEmptyDocument("geometry3d"),
      primitives: [
        ...onlyQuadDoc.primitives,
        { id: "fake-e", type: "label", text: "E", label: "E", position: { x: 0, y: 2, z: 0 } } as unknown as GeometryDocument["primitives"][number],
        { id: "v-f", type: "point3", position: { x: 4, y: 0, z: 0 }, label: "F" },
        { id: "v-p", type: "point3", position: { x: 2, y: 2, z: 3 }, label: "P" }
      ]
    }
    const fakeAudit = auditMaterializedIntent(dag.executionOrder, fakeLabelDoc)
    expect(fakeAudit.ok).toBe(false)
    expect(fakeAudit.diagnostics.some((d) => d.code === "isolated_label_without_primitive" && d.entityId === "E")).toBe(true)

    // Hidden auxiliary point F (`visible: false`) must be caught.
    const hiddenAuxDoc: GeometryDocument = {
      ...createEmptyDocument("geometry3d"),
      primitives: [
        ...onlyQuadDoc.primitives,
        { id: "v-e", type: "point3", position: { x: 0, y: 2, z: 0 }, label: "E" },
        { id: "v-f", type: "point3", position: { x: 4, y: 0, z: 0 }, label: "F", visible: false } as unknown as GeometryDocument["primitives"][number],
        { id: "v-p", type: "point3", position: { x: 2, y: 2, z: 3 }, label: "P" }
      ]
    }
    const hiddenAudit = auditMaterializedIntent(dag.executionOrder, hiddenAuxDoc)
    expect(hiddenAudit.ok).toBe(false)
    expect(hiddenAudit.diagnostics.some((d) => d.code === "auxiliary_object_hidden" && d.entityId === "F")).toBe(true)
  })

  it("JT-P06: rejects plan/document missing required foci F₁ and F₂ when ellipse and M exist", () => {
    const intent = deriveRequiredDrawingIntent({ prompt: JT_P06_PROMPT, requiredEntityIds: ["C", "F₁", "F₂", "M"] })
    const dag = compileConstructionDag(intent.nodes)
    expect(dag.ok).toBe(true)
    if (!dag.ok) return

    const docMissingFoci: GeometryDocument = {
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "c", type: "ellipse", label: "C", center: { x: 0, y: 0 }, radiusX: Math.sqrt(5), radiusY: 2 },
        { id: "m", type: "point", label: "M", x: 2, y: (2 * Math.sqrt(5)) / 5 }
      ]
    }
    const audit = auditMaterializedIntent(dag.executionOrder, docMissingFoci)
    expect(audit.ok).toBe(false)
    expect(audit.diagnostics.filter((d) => d.code === "missing_entity").map((d) => d.entityId)).toEqual(
      expect.arrayContaining(["F₁", "F₂"])
    )
  })

  it("blocks compilePlan via drawingIntentCheck when GK-S02 omits required objects E, F, P", () => {
    const planOnlyBase: PlanEnvelope = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "仅画底面四边形",
      factIds: [],
      actions: [
        {
          actionId: "solid.create_face",
          actionKey: "base",
          factIds: [],
          inputs: {
            alias: "base",
            vertexNames: ["A", "B", "C", "D"],
            vertices: [
              { x: 0, y: 0, z: 0 },
              { x: 8, y: 0, z: 0 },
              { x: 5, y: 3, z: 0 },
              { x: 0, y: 5, z: 0 }
            ]
          }
        } as unknown as Extract<PlanEnvelope, { kind: "plan" }>["actions"][number]
      ]
    }
    const compiled = compilePlan(planOnlyBase, {
      document: createEmptyDocument("geometry3d"),
      prompt: GK_S02_PROMPT,
      conversationId: "t06-s02",
      documentGeneration: 0,
      drawingIntentCheck: true
    })
    expect(compiled.ok).toBe(false)
    expect(compiled.diagnostics.some((d) => d.code === "drawing_intent_missing_entity")).toBe(true)
  })
})
