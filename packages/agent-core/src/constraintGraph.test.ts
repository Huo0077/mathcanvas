import { describe, expect, it } from "vitest"
import {
  addConstraintNode,
  createConstraintGraph,
  evaluateConstraintGraphStatus,
  parseConstraintGraph,
  registerPendingParameterVar,
  serializeConstraintGraph
} from "./constraintGraph"
import type { DsDrawingIntent } from "./dsDrawingIntent"
import { classifyDsIntentTriState } from "./dsDrawingIntent"
import { buildConstraintGraphFromObligationIR, parseObligationIR } from "./obligationIR"

describe("constraintGraph & KernelObservation (Task F3)", () => {
  it("serializes, replays, and builds constraint graph from ObligationIR with pending parameters", () => {
    let graph = createConstraintGraph()
    graph = addConstraintNode(graph, {
      id: "c-len-1",
      kind: "distance",
      targets: ["A", "B"],
      scopeId: "shared",
      stateId: "shared",
      sourceRefs: [{ sourceText: "AB=2", start: 0, end: 4 }],
      status: "satisfied",
      residual: 0
    })
    graph = addConstraintNode(graph, {
      id: "c-perp-1",
      kind: "perpendicular",
      targets: ["P", "A", "B", "C"],
      scopeId: "(1)",
      stateId: "shared",
      sourceRefs: [{ sourceText: "PA⊥BC", start: 5, end: 10 }],
      status: "violated",
      residual: 0.42
    })
    graph = registerPendingParameterVar(graph, {
      name: "height",
      entityId: "Pyr",
      scopeId: "shared",
      solvableFromConstraintIds: ["c-len-1"],
      kind: "solvable"
    })

    const raw = serializeConstraintGraph(graph)
    const parsed = parseConstraintGraph(raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(Object.keys(parsed.value.nodes)).toEqual(["c-len-1", "c-perp-1"])
    expect(parsed.value.pendingVars.height?.kind).toBe("solvable")
    expect(evaluateConstraintGraphStatus(parsed.value)).toBe("repairable")

    const ir = parseObligationIR("四棱锥 P-ABCD 中，AB = 2，PA ⊥ 平面 ABCD，PA = 3")
    const irGraph = buildConstraintGraphFromObligationIR(ir)
    expect(Object.keys(irGraph.nodes).length).toBeGreaterThan(0)
  })

  it("classifies DsDrawingIntent tri-state cleanly: repairable vs hard blocked", () => {
    const repairableUndeclared: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Segment AB",
      entities: [{ id: "A", kind: "point", scopeId: "shared", stateId: "shared" }],
      givenRelations: [{ kind: "length", targets: ["A", "B"], value: 2, scopeId: "shared", stateId: "shared", sourceSpan: { text: "AB=2" } }],
      subquestions: [],
      constructionStrategies: [
        {
          nodeId: "n-a",
          outputEntityId: "A",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { mode: "explicit_coords", x: 0, y: 0 },
          sourceSpan: { text: "A(0,0)" }
        }
      ],
      unknowns: []
    }
    const obsRepairable = classifyDsIntentTriState(repairableUndeclared)
    expect(obsRepairable.status).toBe("repairable")
    expect(obsRepairable.repairHints.length).toBeGreaterThan(0)

    const blockedMissingFigure: DsDrawingIntent = {
      ...repairableUndeclared,
      unknowns: [{ kind: "missing_figure", scopeId: "shared", detail: "缺少必要附图", blocking: true }]
    }
    const obsBlocked = classifyDsIntentTriState(blockedMissingFigure)
    expect(obsBlocked.status).toBe("blocked")
  })
})
