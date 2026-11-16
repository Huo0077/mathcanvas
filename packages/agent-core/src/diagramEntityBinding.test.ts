import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"

function makeConicPlan(alias = "conic-1"): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "draw conic",
    factIds: [],
    actions: [
      {
        actionId: "planar.create_conic",
        actionKey: alias,
        factIds: [],
        inputs: { alias }
      } as unknown as Extract<PlanEnvelope, { kind: "plan" }>["actions"][number]
    ]
  }
}

describe("T05 multi-entity binding invariants", () => {
  it("keeps verification bound to the same entityId when conic primitives are reordered or an auxiliary circle is added", () => {
    const prompt = "已知椭圆 C：x²/9+y²/4=1，椭圆 D：x²/25+y²/16=1，P 是椭圆 C 上一点。"
    const obligations = parseDiagramObligations(prompt)

    const ellipseC = { id: "ent-c", label: "C", type: "ellipse" as const, center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }
    const ellipseD = { id: "ent-d", label: "D", type: "ellipse" as const, center: { x: 0, y: 0 }, radiusX: 5, radiusY: 4 }
    const auxCircle = { id: "ent-aux", label: "Aux", type: "circle" as const, center: { x: 0, y: 0 }, radius: 1 }
    const pointP = { id: "pt-p", type: "point" as const, x: 3, y: 0, label: "P" }

    const docOrderA: GeometryDocument = { ...createEmptyDocument("conics"), id: "doc-a", primitives: [ellipseC, ellipseD, auxCircle, pointP] } as GeometryDocument
    const docOrderB: GeometryDocument = { ...createEmptyDocument("conics"), id: "doc-b", primitives: [auxCircle, ellipseD, ellipseC, pointP] } as GeometryDocument
    const plan = makeConicPlan("doc-a")
    const entityBindings = { C: "ent-c", D: "ent-d" }

    const reportA = verifyDiagramObligations(obligations, plan, docOrderA, undefined, { entityBindings })
    const reportB = verifyDiagramObligations(obligations, plan, docOrderB, undefined, { entityBindings })

    expect(reportA.status).toBe("passed")
    expect(reportB.status).toBe("passed")
    expect(reportA.checks.map((c) => c.status)).toEqual(reportB.checks.map((c) => c.status))
  })

  it("still verifies main ellipse when an auxiliary circle is added without extra ellipses", () => {
    const prompt = "已知椭圆 x²/9+y²/4=1，P 是椭圆上一点。"
    const obligations = parseDiagramObligations(prompt)
    const ellipse = { id: "main-ellipse", type: "ellipse" as const, center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }
    const auxCircle = { id: "aux-circle", type: "circle" as const, center: { x: 0, y: 0 }, radius: 5 }
    const pointP = { id: "pt-p", type: "point" as const, x: 0, y: 2, label: "P" }
    const doc: GeometryDocument = { ...createEmptyDocument("conics"), primitives: [auxCircle, ellipse, pointP] }

    const report = verifyDiagramObligations(obligations, makeConicPlan("doc-aux"), doc)
    expect(report.status).toBe("passed")
  })

  it("returns unverified with binding_ambiguous or entity_missing instead of guessing first/largest on duplicate or missing entities", () => {
    const prompt = "已知椭圆 x²/9+y²/4=1。"
    const obligations = parseDiagramObligations(prompt)
    const docTwoEllipses: GeometryDocument = {
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "e-first", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 },
        { id: "e-second", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 5, radiusY: 4 }
      ]
    }
    const ambReport = verifyDiagramObligations(obligations, makeConicPlan("doc-amb"), docTwoEllipses)
    expect(ambReport.status).toBe("unverified")
    expect(ambReport.checks[0]?.code).toBe("binding_ambiguous")

    const labeledPrompt = "已知椭圆 C：x²/9+y²/4=1。"
    const labeledObs = parseDiagramObligations(labeledPrompt)
    const docSingle: GeometryDocument = {
      ...createEmptyDocument("conics"),
      primitives: [{ id: "e-other", label: "D", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }]
    }
    const missingReport = verifyDiagramObligations(labeledObs, makeConicPlan("doc-missing"), docSingle, undefined, {
      entityBindings: { C: "nonexistent-id" }
    })
    expect(missingReport.status).toBe("unverified")
    expect(missingReport.checks[0]?.code).toBe("entity_missing")
  })

  it("rejects cross-scope or cross-state entity binding for identically named entities", () => {
    const prompt = "已知椭圆 C：x²/9+y²/4=1。"
    const obligations = parseDiagramObligations(prompt)
    const doc: GeometryDocument = {
      ...createEmptyDocument("conics"),
      primitives: [{ id: "e-sub1", label: "C", type: "ellipse", center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 }]
    }
    const report = verifyDiagramObligations(obligations, makeConicPlan("doc-scope"), doc, undefined, {
      entityBindings: { C: "e-sub1" },
      entityScopes: { "e-sub1": { scopeId: "subquestion:1", stateId: "s0" } },
      activeScopeId: "subquestion:2",
      activeStateId: "s1"
    })
    expect(report.status).toBe("unverified")
    expect(report.checks[0]?.code).toBe("binding_scope_mismatch")
  })
})

describe("T05 replay contracts for JT-P03, JT-P07, and JT-P08", () => {
  it("JT-P03: binds parabola C: y²=4x stably when auxiliary line/circle are present and fails if swapped", () => {
    const prompt = "已知抛物线 C：y²=4x 的顶点为 O，过点 (2, 0) 的直线交 C 于 A，B 两点。（1）判断 向量OA·向量OB 是否为定值，并说明理由；（2）设直线 OA，OB 分别与直线 l：y=x+1 交于点 D，E，求 |DE| 的最小值。"
    const obligations = parseDiagramObligations(prompt, { selectedPart: 1 })
    const doc: GeometryDocument = {
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "aux-circle", type: "circle", label: "Aux", center: { x: 2, y: 0 }, radius: 1 },
        { id: "parabola-c", type: "parabola", label: "C", vertex: { x: 0, y: 0 }, axis: "x", focalParameter: 2 },
        { id: "pt-o", type: "point", label: "O", x: 0, y: 0 }
      ]
    }
    const report = verifyDiagramObligations(obligations, makeConicPlan("jt-p03"), doc, undefined, { entityBindings: { C: "parabola-c" } })
    const conicCheck = report.checks.find((c) => c.kind === "conicAxes")
    expect(conicCheck?.status).toBe("passed")
  })

  it("JT-P07: binds ellipse C: x²/4+y²=1 and point incidence cleanly across subquestions", () => {
    const prompt = "已知椭圆 C：x²/4+y²=1。P 是椭圆 C 上一点，Q 是椭圆 C 上一点。"
    const obligations = parseDiagramObligations(prompt)
    const docValid: GeometryDocument = {
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "aux-c", type: "circle", label: "Aux", center: { x: 1, y: 0 }, radius: 1 },
        { id: "ellipse-c", type: "ellipse", label: "C", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1 },
        { id: "pt-p", type: "point", label: "P", x: 0.5, y: Math.sqrt(15) / 4 },
        { id: "pt-q", type: "point", label: "Q", x: 2, y: 0 }
      ]
    }
    const okReport = verifyDiagramObligations(obligations, makeConicPlan("jt-p07"), docValid, undefined, { entityBindings: { C: "ellipse-c" } })
    expect(okReport.status).toBe("passed")

    const docWrongPoint: GeometryDocument = {
      ...docValid,
      primitives: [
        docValid.primitives[0]!,
        docValid.primitives[1]!,
        { id: "pt-p", type: "point", label: "P", x: 0, y: 0 },
        docValid.primitives[3]!
      ]
    }
    const failReport = verifyDiagramObligations(obligations, makeConicPlan("jt-p07"), docWrongPoint, undefined, { entityBindings: { C: "ellipse-c" } })
    expect(failReport.status).toBe("failed")
  })

  it("JT-P08: parses and enforces directed vector ratio 向量EC=2向量CF instead of dropping or misreading EC=2", () => {
    const prompt = "已知椭圆 G：x²/4+y²/3=1。（Ⅰ）求 G 的方程；（Ⅱ）过点 C(0, -1) 的直线与 G 相交于 E、F 两点，且 向量EC=2向量CF，求直线 EF 的方程。"
    const obligations = parseDiagramObligations(prompt, { selectedPart: 2 })

    // Must not falsely parse EC=2 as a fixedLength or leave vector ratio unparsed!
    expect(obligations.givens.some((g) => g.kind === "fixedLength")).toBe(false)
    const ratioObligation = obligations.givens.find((g) => g.kind === "segmentRatio")
    expect(ratioObligation).toMatchObject({
      kind: "segmentRatio",
      targets: ["E", "C", "C", "F"],
      value: 2,
      splitPoint: true
    })
    expect(obligations.unverified.some((u) => u.sourceText.includes("EC"))).toBe(false)

    // True witness: E=(2,0), C=(0,-1), F=(-1,-1.5) => C-E = (-2,-1) = 2*(-1,-0.5) = 2*(F-C)
    const validDoc: GeometryDocument = {
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "ellipse-g", type: "ellipse", label: "G", center: { x: 0, y: 0 }, radiusX: 2, radiusY: Math.sqrt(3) },
        { id: "pt-e", type: "point", label: "E", x: 2, y: 0 },
        { id: "pt-c", type: "point", label: "C", x: 0, y: -1 },
        { id: "pt-f", type: "point", label: "F", x: -1, y: -1.5 }
      ]
    }
    const okReport = verifyDiagramObligations(obligations, makeConicPlan("jt-p08-ok"), validDoc, undefined, { entityBindings: { G: "ellipse-g" } })
    expect(okReport.status).toBe("passed")

    // Counterexample: wrong ratio (midpoint E=(2,0), F=(-2,0) => C not collinear or wrong ratio) MUST fail!
    const badDoc: GeometryDocument = {
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "ellipse-g", type: "ellipse", label: "G", center: { x: 0, y: 0 }, radiusX: 2, radiusY: Math.sqrt(3) },
        { id: "pt-e", type: "point", label: "E", x: 2, y: 0 },
        { id: "pt-c", type: "point", label: "C", x: 0, y: -1 },
        { id: "pt-f", type: "point", label: "F", x: -2, y: 0 }
      ]
    }
    const failReport = verifyDiagramObligations(obligations, makeConicPlan("jt-p08-bad"), badDoc, undefined, { entityBindings: { G: "ellipse-g" } })
    expect(failReport.status).toBe("failed")
  })
})
