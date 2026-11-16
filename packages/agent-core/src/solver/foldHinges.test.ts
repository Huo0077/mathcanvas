import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import { buildFoldLineage, materialiseFoldHinges, validateFoldLineageStep } from "./foldHinges"

/**
 * **AEF 平面片 + fold → bound point E/F**（2026-10-19）。
 *
 * 只测结构变换：删冗余面、生成 bound point、去掉 fold 的旧 vertices。
 * 坐标是否满足题设由编译/核验层负责，这里不算几何。
 */

function userPlan(): Extract<PlanEnvelope, { kind: "plan" }> {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "四边形 + AEF 平面片 + fold",
    factIds: [],
    actions: [
      {
        actionId: "solid.create_face",
        actionKey: "quad_abcd",
        factIds: [],
        inputs: {
          alias: "ABCD",
          vertices: [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 10.098, y: 6.83, z: 0 }, { x: 7.5, y: 4.3301, z: 0 }],
          vertexNames: ["A", "B", "C", "D"]
        }
      },
      {
        actionId: "solid.create_face",
        actionKey: "tri_aef",
        factIds: [],
        inputs: {
          alias: "AEF",
          vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 1.7321, z: 0 }, { x: 4, y: 0, z: 0 }],
          vertexNames: ["A", "E", "F"]
        }
      },
      {
        actionId: "solid.fold",
        actionKey: "fold_aef",
        factIds: [],
        inputs: {
          alias: "PEF",
          vertices: [{ x: 0, y: 0, z: 0 }, { x: 3, y: 1.7321, z: 0 }, { x: 4, y: 0, z: 0 }],
          vertexNames: ["A", "E", "F"],
          hinge: ["E", "F"],
          apex: "A",
          apexAs: "P",
          angle: 120
        }
      }
    ]
  } as unknown as Extract<PlanEnvelope, { kind: "plan" }>
}

describe("materialiseFoldHinges", () => {
  it("drops the flat AEF face and creates bound E/F before the fold", () => {
    const plan = materialiseFoldHinges(userPlan())
    const ids = plan.actions.map((action) => action.actionId)

    expect(ids).toEqual(["solid.create_face", "dynamic.create_bound_point", "dynamic.create_bound_point", "solid.fold"])
    const faces = plan.actions.filter((action) => action.actionId === "solid.create_face")
    expect(faces).toHaveLength(1)

    const bounds = plan.actions.filter((action) => action.actionId === "dynamic.create_bound_point")
    expect(bounds).toHaveLength(2)
    const [e, f] = bounds
    expect((e!.inputs as { hostEdge?: unknown }).hostEdge).toEqual({ from: "A", to: "D" })
    expect((e!.inputs as { parameter?: unknown }).parameter).toBeCloseTo(0.4, 12)
    expect((f!.inputs as { hostEdge?: unknown }).hostEdge).toEqual({ from: "A", to: "B" })
    expect((f!.inputs as { parameter?: unknown }).parameter).toBeCloseTo(0.5, 12)

    const fold = plan.actions.find((action) => action.actionId === "solid.fold")
    expect((fold!.inputs as { vertices?: unknown }).vertices).toBeUndefined()
  })
})

describe("P4 / T10 fold state lineage, isometry, hinge stability & identity guards", () => {
  it("records parentState, hingeEntityId, fixedEntities, pointMapping (D->P) and verifies zero hinge drift + isometry", () => {
    const lineage = buildFoldLineage([
      {
        stepId: "fold-1",
        parentStateId: "s0",
        stateId: "s1",
        hingeEntityId: "edge:E-F",
        hingeFrom: { name: "E", position: { x: 0, y: 0, z: 0 } },
        hingeTo: { name: "F", position: { x: 2, y: 0, z: 0 } },
        apexFrom: { name: "D", position: { x: 0, y: 3, z: 0 } },
        apexAs: "P",
        movingFaceIds: ["face:DEF"],
        fixedEntities: ["A", "B", "C", "E", "F"],
        angleDegrees: 90,
        side: "positive"
      }
    ])
    expect(lineage.ok).toBe(true)
    if (!lineage.ok) return
    const step = lineage.steps[0]!
    expect(step.parentStateId).toBe("s0")
    expect(step.stateId).toBe("s1")
    expect(step.hingeEntityId).toBe("edge:E-F")
    expect(step.pointMapping).toEqual({ D: "P" })
    expect(step.postApexPosition.z).toBeCloseTo(3, 9)
    expect(Math.hypot(step.postApexPosition.x, step.postApexPosition.y)).toBeCloseTo(0, 9)
  })

  it("rejects zero-length hinge, hinge point drift, edge length change, D/P identity conflation, and 180° coplanar collapse", () => {
    const zeroHinge = validateFoldLineageStep({
      stepId: "bad-zero",
      parentStateId: "s0",
      stateId: "s1",
      hingeEntityId: "edge:E-E",
      hingeFrom: { name: "E", position: { x: 1, y: 1, z: 0 } },
      hingeTo: { name: "F", position: { x: 1, y: 1, z: 0 } },
      apexFrom: { name: "D", position: { x: 0, y: 2, z: 0 } },
      apexAs: "P",
      movingFaceIds: ["face:DEF"],
      fixedEntities: ["E", "F"],
      angleDegrees: 90,
      side: "positive"
    })
    expect(zeroHinge.ok).toBe(false)
    if (!zeroHinge.ok) expect(zeroHinge.diagnostics.some((d) => d.code === "zero_length_hinge")).toBe(true)

    const dpSameName = validateFoldLineageStep({
      stepId: "bad-dp",
      parentStateId: "s0",
      stateId: "s1",
      hingeEntityId: "edge:E-F",
      hingeFrom: { name: "E", position: { x: 0, y: 0, z: 0 } },
      hingeTo: { name: "F", position: { x: 2, y: 0, z: 0 } },
      apexFrom: { name: "D", position: { x: 0, y: 3, z: 0 } },
      apexAs: "D",
      movingFaceIds: ["face:DEF"],
      fixedEntities: ["E", "F"],
      angleDegrees: 60,
      side: "positive"
    })
    expect(dpSameName.ok).toBe(false)
    if (!dpSameName.ok) expect(dpSameName.diagnostics.some((d) => d.code === "dp_identity_conflation")).toBe(true)

    const hingeDrift = validateFoldLineageStep({
      stepId: "bad-drift",
      parentStateId: "s0",
      stateId: "s1",
      hingeEntityId: "edge:E-F",
      hingeFrom: { name: "E", position: { x: 0, y: 0, z: 0 } },
      hingeTo: { name: "F", position: { x: 2, y: 0, z: 0 } },
      hingeFromAfter: { x: 0.2, y: 0, z: 0 },
      hingeToAfter: { x: 2, y: 0, z: 0 },
      apexFrom: { name: "D", position: { x: 0, y: 3, z: 0 } },
      apexAs: "P",
      postApexOverride: { x: 0, y: 0, z: 3 },
      movingFaceIds: ["face:DEF"],
      fixedEntities: ["E", "F"],
      angleDegrees: 90,
      side: "positive"
    })
    expect(hingeDrift.ok).toBe(false)
    if (!hingeDrift.ok) expect(hingeDrift.diagnostics.some((d) => d.code === "hinge_point_drift")).toBe(true)

    const edgeStretched = validateFoldLineageStep({
      stepId: "bad-stretch",
      parentStateId: "s0",
      stateId: "s1",
      hingeEntityId: "edge:E-F",
      hingeFrom: { name: "E", position: { x: 0, y: 0, z: 0 } },
      hingeTo: { name: "F", position: { x: 2, y: 0, z: 0 } },
      apexFrom: { name: "D", position: { x: 0, y: 3, z: 0 } },
      apexAs: "P",
      postApexOverride: { x: 0, y: 0, z: 4.5 },
      movingFaceIds: ["face:DEF"],
      fixedEntities: ["E", "F"],
      angleDegrees: 90,
      side: "positive"
    })
    expect(edgeStretched.ok).toBe(false)
    if (!edgeStretched.ok) expect(edgeStretched.diagnostics.some((d) => d.code === "edge_length_changed")).toBe(true)

    const flat180 = validateFoldLineageStep({
      stepId: "bad-180",
      parentStateId: "s0",
      stateId: "s1",
      hingeEntityId: "edge:E-F",
      hingeFrom: { name: "E", position: { x: 0, y: 0, z: 0 } },
      hingeTo: { name: "F", position: { x: 2, y: 0, z: 0 } },
      apexFrom: { name: "D", position: { x: 0, y: 3, z: 0 } },
      apexAs: "P",
      movingFaceIds: ["face:DEF"],
      fixedEntities: ["E", "F"],
      angleDegrees: 180,
      side: "positive"
    })
    expect(flat180.ok).toBe(false)
    if (!flat180.ok) expect(flat180.diagnostics.some((d) => d.code === "degenerate_fold_angle")).toBe(true)
  })
})
