import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"
import {
  compileDsDrawingIntentByScope,
  compileDsDrawingIntentToPlan,
  parseAndValidateDsDrawingIntent,
  validateRequiredParameters,
  type DsDrawingIntent
} from "./dsDrawingIntent"
import { compilePlan } from "./planCompiler"
import { parsePlanEnvelope } from "./schemas"

describe("DS1 DsDrawingIntent structural compiler & invariants", () => {
  it("compiles a zero-candidate open-surface fold intent (GK-S02 class & renamed variant) without hand coordinates", () => {
    const foldIntent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Construct planar trapezoid and fold triangle along segment MN to P",
      entities: [
        { id: "M", kind: "point", label: "M", scopeId: "shared", stateId: "pre_fold" },
        { id: "N", kind: "point", label: "N", scopeId: "shared", stateId: "pre_fold" },
        { id: "Q", kind: "point", label: "Q", scopeId: "shared", stateId: "pre_fold" },
        { id: "R", kind: "point", label: "R", scopeId: "shared", stateId: "pre_fold" },
        { id: "U", kind: "point", label: "U", scopeId: "shared", stateId: "pre_fold", hostEntityId: "M" },
        { id: "V", kind: "point", label: "V", scopeId: "shared", stateId: "pre_fold", hostEntityId: "R" },
        { id: "baseQuad", kind: "polygon", scopeId: "shared", stateId: "pre_fold" },
        { id: "flapTri", kind: "polygon", scopeId: "shared", stateId: "pre_fold" },
        { id: "foldedSolid", kind: "solid", scopeId: "shared", stateId: "post_fold" }
      ],
      givenRelations: [
        { kind: "length", targets: ["M", "N"], value: 6, scopeId: "shared", stateId: "pre_fold", sourceSpan: { text: "MN=6" } },
        { kind: "length", targets: ["N", "R"], value: 4, scopeId: "shared", stateId: "pre_fold", sourceSpan: { text: "NR=4" } },
        { kind: "perpendicular", targets: ["M", "R", "R", "N"], scopeId: "shared", stateId: "pre_fold", sourceSpan: { text: "MR⊥RN" } }
      ],
      subquestions: [
        { id: "(1)", dependsOn: ["shared"], stateId: "post_fold", relations: ["perp"] }
      ],
      constructionStrategies: [
        {
          nodeId: "build-base",
          outputEntityId: "baseQuad",
          outputKind: "polygon",
          strategy: "solid_base_and_prism_or_pyramid",
          scopeId: "shared",
          stateId: "pre_fold",
          dependencyIds: [],
          foldPhase: "pre_fold",
          params: {
            shape: "right_trapezoid_open_base",
            vertexNames: ["N", "R", "U", "V"],
            rightAngleAt: "R",
            bottomLength: 4,
            topLength: 2,
            height: 4
          },
          assumptions: ["取 N, R, U, V 共面于 z=0 构造开放平面底片"]
        },
        {
          nodeId: "fold-flap",
          outputEntityId: "foldedSolid",
          outputKind: "solid",
          strategy: "solid_fold_along_hinge",
          scopeId: "shared",
          stateId: "post_fold",
          hostEntityId: "baseQuad",
          dependencyIds: ["build-base"],
          foldPhase: "post_fold",
          params: {
            hinge: ["U", "V"],
            movingVertexNames: ["M"],
            afterVertexNames: ["P"],
            preMovingTriangleVertices: [{ name: "M", onEdgeFrom: "R", to: "N", ratioFromFirst: 0.5 }],
            angleDegrees: 90,
            direction: "positive"
          },
          assumptions: ["沿 UV 折起 90° 得到 P"]
        }
      ],
      unknowns: []
    }

    const parsed = parseAndValidateDsDrawingIntent(foldIntent, "在直角梯形中 MN=6, NR=4, MR⊥RN，沿 UV 折起至 P")
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const compiled = compileDsDrawingIntentToPlan(parsed.value)
    expect(compiled.kind).toBe("plan")
    if (compiled.kind !== "plan") return
    expect(compiled.actions.length).toBeGreaterThanOrEqual(2)
    expect(compiled.actions.some((a) => a.actionId === "solid.create_face")).toBe(true)
    expect(compiled.actions.some((a) => a.actionId === "solid.fold")).toBe(true)
  })

  it("compiles function + derivative tangent intent (GK-P04 class) and conic + tangent intent (GK-P06 class)", () => {
    const fnIntent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Plot cubic f(x) and quadratic g(x) tangent at x0=-1",
      entities: [
        { id: "f", kind: "function", label: "f", scopeId: "shared", stateId: "shared" },
        { id: "g", kind: "function", label: "g", scopeId: "shared", stateId: "shared" },
        { id: "tan", kind: "tangent", label: "l", scopeId: "(1)", stateId: "(1)", hostEntityId: "f" }
      ],
      givenRelations: [
        { kind: "function_expression", targets: ["f"], value: "x^3 - x", scopeId: "shared", stateId: "shared", sourceSpan: { text: "f(x)=x³-x" } },
        { kind: "function_expression", targets: ["g"], value: "x^2 - 1", scopeId: "shared", stateId: "shared", sourceSpan: { text: "g(x)=x²+a" } }
      ],
      subquestions: [{ id: "(1)", dependsOn: ["shared"], stateId: "(1)", relations: ["tangent"] }],
      constructionStrategies: [
        {
          nodeId: "fn-f",
          outputEntityId: "f",
          outputKind: "function",
          strategy: "function_curve_and_tangent",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { label: "f", expression: "x^3 - x", domain: [-3, 3] },
          sourceSpan: { text: "f(x)=x³-x" }
        },
        {
          nodeId: "fn-g",
          outputEntityId: "g",
          outputKind: "function",
          strategy: "function_curve_and_tangent",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { label: "g", expression: "x^2 - 1", domain: [-3, 3] },
          assumptions: ["取参数 representative a=-1"]
        },
        {
          nodeId: "tan-at",
          outputEntityId: "tan",
          outputKind: "tangent",
          strategy: "function_curve_and_tangent",
          scopeId: "(1)",
          stateId: "(1)",
          hostEntityId: "f",
          dependencyIds: ["fn-f"],
          params: { mode: "tangent_at_x", targetFunctionLabel: "f", expression: "x^3 - x", x0: -1, tangentLabel: "l" },
          sourceSpan: { text: "x₁=-1" }
        }
      ],
      unknowns: []
    }

    const parsedFn = parseAndValidateDsDrawingIntent(fnIntent)
    expect(parsedFn.ok).toBe(true)
    if (!parsedFn.ok) return
    const compiledFn = compileDsDrawingIntentToPlan(parsedFn.value)
    expect(compiledFn.kind).toBe("plan")
    if (compiledFn.kind !== "plan") return
    expect(compiledFn.actions.filter((a) => a.actionId === "function.create_graph")).toHaveLength(2)
    expect(compiledFn.actions.some((a) => a.actionId === "function.create_tangent")).toBe(true)

    const conicIntent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Construct parabola C and point E and tangent line",
      entities: [
        { id: "C", kind: "conic", label: "C", scopeId: "shared", stateId: "shared" },
        { id: "E", kind: "point", label: "E", scopeId: "shared", stateId: "shared", hostEntityId: "C" },
        { id: "tanE", kind: "tangent", label: "DA", scopeId: "(1)", stateId: "(1)", hostEntityId: "E" }
      ],
      givenRelations: [],
      subquestions: [{ id: "(1)", dependsOn: ["shared"], stateId: "(1)", relations: ["tangent"] }],
      constructionStrategies: [
        {
          nodeId: "parabola-c",
          outputEntityId: "C",
          outputKind: "conic",
          strategy: "conic_from_equation_or_properties",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { conicType: "parabola", axis: "y", focalParameter: 2, label: "C" },
          sourceSpan: { text: "x²=4y" }
        },
        {
          nodeId: "pt-e",
          outputEntityId: "E",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "shared",
          stateId: "shared",
          hostEntityId: "C",
          dependencyIds: ["parabola-c"],
          params: { mode: "explicit_coords", label: "E", x: 2, y: 1 },
          sourceSpan: { text: "E(2,1)" }
        },
        {
          nodeId: "line-tan",
          outputEntityId: "tanE",
          outputKind: "tangent",
          strategy: "planar_line_or_segment",
          scopeId: "(1)",
          stateId: "(1)",
          hostEntityId: "E",
          dependencyIds: ["parabola-c", "pt-e"],
          params: { mode: "tangent_to_conic", conicType: "parabola", axis: "y", focalParameter: 2, touchPoint: { x: 2, y: 1 }, label: "DA" },
          sourceSpan: { text: "过点E作切线" }
        }
      ],
      unknowns: []
    }

    const parsedConic = parseAndValidateDsDrawingIntent(conicIntent)
    expect(parsedConic.ok).toBe(true)
    if (!parsedConic.ok) return
    const compiledConic = compileDsDrawingIntentToPlan(parsedConic.value)
    expect(compiledConic.kind).toBe("plan")
    if (compiledConic.kind !== "plan") return
    expect(compiledConic.actions.some((a) => a.actionId === "planar.create_conic")).toBe(true)
    expect(compiledConic.actions.some((a) => a.actionId === "planar.create_line")).toBe(true)
    expect(parsePlanEnvelope(compiledConic).ok).toBe(true)
    expect(parsePlanEnvelope(compiledFn).ok).toBe(true)
  })

  it("rejects hand-computed solid vertices, undeclared entity refs, cross-scope pollution, unsourced constants, and blocking missing-figure unknowns", () => {
    const baseValid: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Build pyramid",
      entities: [{ id: "P", kind: "solid", label: "P-ABCD", scopeId: "shared", stateId: "shared" }],
      givenRelations: [],
      subquestions: [
        { id: "(1)", dependsOn: ["shared"], stateId: "shared", relations: [] },
        { id: "(2)", dependsOn: ["shared"], stateId: "shared", relations: [] }
      ],
      constructionStrategies: [
        {
          nodeId: "n1",
          outputEntityId: "P",
          outputKind: "solid",
          strategy: "solid_base_and_prism_or_pyramid",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: {
            shape: "regular_pyramid",
            sides: 4,
            baseSide: 2,
            height: 3,
            vertexNames: ["A", "B", "C", "D", "P"]
          },
          sourceSpan: { text: "正四棱锥，底面边长2，高3" }
        }
      ],
      unknowns: []
    }

    // 1. Hand-computed raw vertices forbidden on parametric/named solid
    const handVertices = structuredClone(baseValid)
    handVertices.constructionStrategies[0]!.params = {
      shape: "polyhedron",
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      faces: [[0, 1, 2]]
    }
    const rHand = parseAndValidateDsDrawingIntent(handVertices)
    expect(rHand.ok).toBe(false)
    if (!rHand.ok) expect(rHand.diagnostics.some((d) => d.code === "hand_computed_vertices_forbidden")).toBe(true)

    // 2. Undeclared entity ref in relation
    const badRef = structuredClone(baseValid)
    badRef.givenRelations = [{ kind: "length", targets: ["A", "GhostX"], value: 2, scopeId: "shared", stateId: "shared", sourceSpan: { text: "A=2" } }]
    const rRef = parseAndValidateDsDrawingIntent(badRef)
    expect(rRef.ok).toBe(false)
    if (!rRef.ok) expect(rRef.diagnostics.some((d) => d.code === "undeclared_entity_ref")).toBe(true)

    // 3. Cross-scope pollution between unlinked subquestions (1) and (2)
    const badScope = structuredClone(baseValid)
    badScope.entities.push(
      { id: "M", kind: "point", scopeId: "(1)", stateId: "shared" },
      { id: "N", kind: "point", scopeId: "(2)", stateId: "shared", hostEntityId: "M" }
    )
    badScope.constructionStrategies.push(
      {
        nodeId: "n-m",
        outputEntityId: "M",
        outputKind: "point",
        strategy: "planar_point_on_host",
        scopeId: "(1)",
        stateId: "shared",
        dependencyIds: ["n1"],
        params: { mode: "explicit_coords", label: "M", x: 0, y: 1 },
        assumptions: ["例值 M"]
      },
      {
        nodeId: "n-n",
        outputEntityId: "N",
        outputKind: "point",
        strategy: "planar_point_on_host",
        scopeId: "(2)",
        stateId: "shared",
        hostEntityId: "M",
        dependencyIds: ["n-m"],
        params: { mode: "explicit_coords", label: "N", x: 1, y: 1 },
        assumptions: ["例值 N"]
      }
    )
    const rScope = parseAndValidateDsDrawingIntent(badScope)
    expect(rScope.ok).toBe(false)
    if (!rScope.ok) expect(rScope.diagnostics.some((d) => d.code === "cross_scope_violation")).toBe(true)

    // 4. Unsourced constant (neither sourceSpan nor assumptions provided on non-trivial scalar params)
    const unsourced = structuredClone(baseValid)
    delete unsourced.constructionStrategies[0]!.sourceSpan
    delete unsourced.constructionStrategies[0]!.assumptions
    const rUnsourced = parseAndValidateDsDrawingIntent(unsourced)
    expect(rUnsourced.ok).toBe(false)
    if (!rUnsourced.ok) expect(rUnsourced.diagnostics.some((d) => d.code === "unsourced_constant")).toBe(true)

    // 5. Blocking unknown (missing figure) turns into safe clarification, never fabricates a diagram
    const blocked = structuredClone(baseValid)
    blocked.unknowns = [{ kind: "missing_figure", scopeId: "shared", detail: "题图缺失无法确定底面形状与位置", blocking: true }]
    const rBlocked = parseAndValidateDsDrawingIntent(blocked)
    expect(rBlocked.ok).toBe(true)
    if (rBlocked.ok) {
      const env = compileDsDrawingIntentToPlan(rBlocked.value)
      expect(env.kind).toBe("clarification")
      if (env.kind === "clarification") {
        expect(env.questions[0]).toContain("题图缺失")
      }
    }
  })

  it("covers zero-candidate solid prism, perpendicular pyramid, tetrahedron, and edge-point families orthogonally without hand coordinates", () => {
    const shapes = [
      { shape: "perpendicular_pyramid", params: { ab: 3, bc: 3, angleABC: 60, pa: 3 }, vNames: ["A", "B", "C", "D", "P"], action: "solid.create_polyhedron" },
      { shape: "right_triangular_prism", params: { lateralLength: 5, apexToPlane: 2, lateralLineDistance: 3 }, vNames: ["A", "B", "C", "A₁", "B₁", "C₁"], action: "solid.create_prism" },
      { shape: "tetrahedron", params: { ab: 3, bc: 3, ac: 3, pa: 3, pb: 3, pc: 3 }, vNames: ["A", "B", "C", "P"], action: "solid.create_polyhedron" },
      { shape: "prism_box", params: { width: 2, depth: 3, height: 4 }, vNames: ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"], action: "solid.create_prism" }
    ] as const

    for (const item of shapes) {
      const intent: DsDrawingIntent = {
        schemaVersion: "mathcanvas.ds_intent.v1",
        goal: `Construct ${item.shape}`,
        entities: [
          { id: "S", kind: "solid", scopeId: "shared", stateId: "shared" },
          { id: "M", kind: "point", scopeId: "shared", stateId: "shared", hostEntityId: "S" }
        ],
        givenRelations: [],
        subquestions: [{ id: "(1)", dependsOn: ["shared"], stateId: "shared", relations: ["geometry"] }],
        constructionStrategies: [
          {
            nodeId: "build-solid",
            outputEntityId: "S",
            outputKind: "solid",
            strategy: "solid_base_and_prism_or_pyramid",
            scopeId: "shared",
            stateId: "shared",
            dependencyIds: [],
            params: { shape: item.shape, vertexNames: [...item.vNames], ...item.params },
            sourceSpan: { text: "参数化立体" }
          },
          {
            nodeId: "build-mid",
            outputEntityId: "M",
            outputKind: "point",
            strategy: "solid_point_on_edge_or_face",
            scopeId: "shared",
            stateId: "shared",
            hostEntityId: "S",
            dependencyIds: ["build-solid"],
            params: { from: item.vNames[0], to: item.vNames[1], ratioFromFirst: 0.5, label: "M" },
            sourceSpan: { text: "中点 M" }
          }
        ],
        unknowns: []
      }
      const parsed = parseAndValidateDsDrawingIntent(intent)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      const compiled = compileDsDrawingIntentToPlan(parsed.value)
      expect(parsePlanEnvelope(compiled).ok).toBe(true)
      expect(compiled.kind).toBe("plan")
      if (compiled.kind !== "plan") continue
      expect(compiled.actions.some((a) => a.actionId === item.action)).toBe(true)
      expect(compiled.actions.some((a) => a.actionId === "solid.create_point")).toBe(true)
    }
  })

  it("DS2 Family 1 & 3: solves ellipse from eccentricity, intersects with secant line, constructs midpoint & ellipse tangent via kernel", () => {
    const intent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Construct ellipse x^2/4+y^2/2=1, secant line l, intersections A,B, midpoint M, and tangent at P",
      entities: [
        { id: "C", kind: "conic", label: "C", scopeId: "shared", stateId: "shared" },
        { id: "F1", kind: "focus", label: "F₁", scopeId: "shared", stateId: "shared", hostEntityId: "C" },
        { id: "l", kind: "line", label: "l", scopeId: "(1)", stateId: "shared" },
        { id: "A", kind: "point", label: "A", scopeId: "(1)", stateId: "shared", hostEntityId: "C" },
        { id: "B", kind: "point", label: "B", scopeId: "(1)", stateId: "shared", hostEntityId: "C" },
        { id: "M", kind: "point", label: "M", scopeId: "(1)", stateId: "shared" },
        { id: "P", kind: "point", label: "P", scopeId: "(2)", stateId: "shared", hostEntityId: "C" },
        { id: "tP", kind: "tangent", label: "t", scopeId: "(2)", stateId: "shared", hostEntityId: "P" }
      ],
      givenRelations: [],
      subquestions: [
        { id: "(1)", dependsOn: ["shared"], stateId: "shared", relations: ["intersection", "midpoint"] },
        { id: "(2)", dependsOn: ["shared"], stateId: "shared", relations: ["tangent"] }
      ],
      constructionStrategies: [
        {
          nodeId: "build-ellipse",
          outputEntityId: "C",
          outputKind: "conic",
          strategy: "conic_from_equation_or_properties",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { conicType: "ellipse", majorSemiAxis: 2, eccentricity: Math.SQRT1_2, axis: "x", label: "C" },
          sourceSpan: { text: "a=2, e=√2/2" }
        },
        {
          nodeId: "build-f1",
          outputEntityId: "F1",
          outputKind: "focus",
          strategy: "planar_point_on_host",
          scopeId: "shared",
          stateId: "shared",
          hostEntityId: "C",
          dependencyIds: ["build-ellipse"],
          params: { mode: "focus", conicId: "C", index: 0, label: "F₁" },
          sourceSpan: { text: "左焦点 F₁" }
        },
        {
          nodeId: "build-secant",
          outputEntityId: "l",
          outputKind: "line",
          strategy: "planar_line_or_segment",
          scopeId: "(1)",
          stateId: "shared",
          dependencyIds: [],
          params: { mode: "equation", a: 1, b: -1, c: -1, label: "l" },
          sourceSpan: { text: "直线 x-y-1=0" }
        },
        {
          nodeId: "build-a",
          outputEntityId: "A",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "(1)",
          stateId: "shared",
          hostEntityId: "C",
          dependencyIds: ["build-ellipse", "build-secant"],
          params: { mode: "line_conic_intersection", lineId: "l", conicId: "C", index: 0, label: "A" },
          sourceSpan: { text: "交点 A" }
        },
        {
          nodeId: "build-b",
          outputEntityId: "B",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "(1)",
          stateId: "shared",
          hostEntityId: "C",
          dependencyIds: ["build-ellipse", "build-secant"],
          params: { mode: "line_conic_intersection", lineId: "l", conicId: "C", index: 1, label: "B" },
          sourceSpan: { text: "交点 B" }
        },
        {
          nodeId: "build-m",
          outputEntityId: "M",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "(1)",
          stateId: "shared",
          dependencyIds: ["build-a", "build-b"],
          params: { mode: "midpoint", from: "A", to: "B", label: "M" },
          sourceSpan: { text: "AB 中点 M" }
        },
        {
          nodeId: "build-p",
          outputEntityId: "P",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "(2)",
          stateId: "shared",
          hostEntityId: "C",
          dependencyIds: ["build-ellipse"],
          params: { mode: "on_conic", conicId: "C", parameter: Math.PI / 4, label: "P" },
          assumptions: ["取椭圆上参数 θ=π/4 的点 P"]
        },
        {
          nodeId: "build-tp",
          outputEntityId: "tP",
          outputKind: "tangent",
          strategy: "planar_line_or_segment",
          scopeId: "(2)",
          stateId: "shared",
          hostEntityId: "P",
          dependencyIds: ["build-ellipse", "build-p"],
          params: { mode: "tangent_to_conic", conicId: "C", touchPointId: "P", label: "t" },
          sourceSpan: { text: "过点 P 的切线" }
        }
      ],
      unknowns: []
    }

    const parsed = parseAndValidateDsDrawingIntent(intent)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    // Scope (1) compiles A, B on x^2/4+y^2/2=1 AND x-y-1=0 without leaking P/tP from scope (2)!
    const scope1Plan = compileDsDrawingIntentByScope(parsed.value, "(1)")
    expect(scope1Plan.kind).toBe("plan")
    if (scope1Plan.kind !== "plan") return
    const compiled1 = compilePlan(scope1Plan, {
      document: createEmptyDocument("conics"),
      conversationId: "ds2-test-1",
      documentGeneration: 0,
      workspace: "conics"
    })
    expect(compiled1.ok, JSON.stringify(compiled1.diagnostics)).toBe(true)
    expect(compiled1.draftDocument).not.toBeNull()
    const prims1 = compiled1.draftDocument!.primitives
    const ptA = prims1.find((p) => p.type === "point" && p.label === "A") as { type: "point"; x: number; y: number } | undefined
    const ptB = prims1.find((p) => p.type === "point" && p.label === "B") as { type: "point"; x: number; y: number } | undefined
    const ptM = prims1.find((p) => p.type === "point" && p.label === "M") as { type: "point"; x: number; y: number } | undefined
    expect(ptA).toBeDefined()
    expect(ptB).toBeDefined()
    expect(ptM).toBeDefined()
    expect(Math.abs((ptA!.x ** 2) / 4 + (ptA!.y ** 2) / 2 - 1)).toBeLessThan(1e-6)
    expect(Math.abs(ptA!.x - ptA!.y - 1)).toBeLessThan(1e-6)
    expect(Math.abs(ptM!.x - (ptA!.x + ptB!.x) / 2)).toBeLessThan(1e-6)
    expect(prims1.some((p) => p.label === "t")).toBe(false)

    // Scope (2) compiles ellipse tangent at P via kernel tangentLineToConicAt without leaking (1) secant M.
    const scope2Plan = compileDsDrawingIntentByScope(parsed.value, "(2)")
    expect(scope2Plan.kind).toBe("plan")
    if (scope2Plan.kind !== "plan") return
    const compiled2 = compilePlan(scope2Plan, {
      document: createEmptyDocument("conics"),
      conversationId: "ds2-test-2",
      documentGeneration: 0,
      workspace: "conics"
    })
    expect(compiled2.ok).toBe(true)
    const prims2 = compiled2.draftDocument!.primitives
    const ptP = prims2.find((p) => p.type === "point" && p.label === "P") as { type: "point"; x: number; y: number } | undefined
    const lineT = prims2.find((p) => p.type === "line" && p.label === "t") as { type: "line"; a: { x: number; y: number }; b: { x: number; y: number } } | undefined
    expect(ptP).toBeDefined()
    expect(lineT).toBeDefined()
    // Gradient of x^2/4 + y^2/2 = 1 at P is (x/2, y); tangent vector (b - a) must be perpendicular to gradient.
    const dotGrad = (ptP!.x / 2) * (lineT!.b.x - lineT!.a.x) + ptP!.y * (lineT!.b.y - lineT!.a.y)
    expect(Math.abs(dotGrad)).toBeLessThan(1e-6)
    expect(prims2.some((p) => p.label === "M")).toBe(false)
  })

  it("DS2 Family 2 & 4: solves GK-S01-class pyramid (AD⊥DC + dihedral) & face projection foot + connecting segment across scopes", () => {
    const intent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Construct pyramid P-ABCD with PA⊥base, BC∥AD, AD⊥DC, dihedral sine √42/7, and foot M on face PCD",
      entities: [
        { id: "S", kind: "solid", scopeId: "shared", stateId: "shared" },
        { id: "M", kind: "point", label: "M", scopeId: "(2)", stateId: "shared", hostEntityId: "S" },
        { id: "segAM", kind: "segment", label: "AM", scopeId: "(2)", stateId: "shared", hostEntityId: "M" }
      ],
      givenRelations: [
        { kind: "perpendicular", targets: ["S"], scopeId: "(2)", stateId: "shared", sourceSpan: { text: "AD⊥DC" } }
      ],
      subquestions: [
        { id: "(1)", dependsOn: ["shared"], stateId: "shared", relations: ["parallel_bc_ad"] },
        { id: "(2)", dependsOn: ["shared"], stateId: "shared", relations: ["ad_perp_dc", "dihedral_sine", "foot_on_pcd"] }
      ],
      constructionStrategies: [
        {
          nodeId: "build-pyr",
          outputEntityId: "S",
          outputKind: "solid",
          strategy: "solid_base_and_prism_or_pyramid",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: {
            shape: "pyramid_perp_base_quad",
            vertexNames: ["A", "B", "C", "D", "P"],
            pa: 2,
            ab: 1,
            ad: 1,
            bc: 2,
            requireAdPerpDc: true
          },
          sourceSpan: { text: "PA⊥底面ABCD，PA=2，AB=AD=1，BC=2，AD⊥DC" }
        },
        {
          nodeId: "foot-m",
          outputEntityId: "M",
          outputKind: "point",
          strategy: "solid_point_on_edge_or_face",
          scopeId: "(2)",
          stateId: "shared",
          hostEntityId: "S",
          dependencyIds: ["build-pyr"],
          params: { mode: "perpendicular_foot_on_plane", sourcePoint: "A", planePoints: ["P", "C", "D"], label: "M" },
          sourceSpan: { text: "作 A 在平面 PCD 上的射影 M" }
        },
        {
          nodeId: "seg-am",
          outputEntityId: "segAM",
          outputKind: "segment",
          strategy: "solid_point_on_edge_or_face",
          scopeId: "(2)",
          stateId: "shared",
          hostEntityId: "M",
          dependencyIds: ["foot-m"],
          params: { mode: "segment", from: "A", to: "M", label: "AM" },
          sourceSpan: { text: "连线 AM" }
        }
      ],
      unknowns: []
    }

    const parsed = parseAndValidateDsDrawingIntent(intent)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const plan2 = compileDsDrawingIntentByScope(parsed.value, "(2)")
    expect(plan2.kind).toBe("plan")
    if (plan2.kind !== "plan") return
    const compiled = compilePlan(plan2, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "ds2-test-3",
      documentGeneration: 0,
      workspace: "geometry3d"
    })
    expect(compiled.ok, JSON.stringify(compiled.diagnostics)).toBe(true)
    const prims = compiled.draftDocument!.primitives
    const ptPos = (lbl: string) => (prims.find((p) => p.type === "point3" && p.label === lbl) as { type: "point3"; position: { x: number; y: number; z: number } }).position
    const A = ptPos("A"), D = ptPos("D"), C = ptPos("C"), P = ptPos("P"), M = ptPos("M")
    // Verify AD ⊥ DC accurately!
    const adx = D.x - A.x, ady = D.y - A.y, dcx = C.x - D.x, dcy = C.y - D.y
    expect(Math.abs(adx * dcx + ady * dcy)).toBeLessThan(1e-6)
    // Verify AM ⊥ PCD (AM orthogonal to PC and PD)!
    const am = { x: M.x - A.x, y: M.y - A.y, z: M.z - A.z }
    const pc = { x: C.x - P.x, y: C.y - P.y, z: C.z - P.z }
    const pd = { x: D.x - P.x, y: D.y - P.y, z: D.z - P.z }
    expect(Math.abs(am.x * pc.x + am.y * pc.y + am.z * pc.z)).toBeLessThan(1e-6)
    expect(Math.abs(am.x * pd.x + am.y * pd.y + am.z * pd.z)).toBeLessThan(1e-6)

    // Independent verifier check: AD⊥DC passes on solved candidate and FAILS if D is tampered to break perpendicularity.
    const obSet = parseDiagramObligations("四棱锥P-ABCD中，PA⊥底面ABCD，AD⊥DC")
    const verified = verifyDiagramObligations(obSet, plan2, compiled.draftDocument!)
    expect(verified.status).toBe("passed")
    const tamperedDoc = structuredClone(compiled.draftDocument!)
    for (const prim of tamperedDoc.primitives) {
      if (prim.type === "point3" && prim.label === "D") prim.position.y += 0.6
    }
    const tamperedVer = verifyDiagramObligations(obSet, plan2, tamperedDoc)
    expect(tamperedVer.status).toBe("failed")
  })

  it("DS2 negative & disclosure checks: solves external-point curve tangent and isolates infeasible subquestion disclosures", () => {
    const extTangentIntent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Plot parabola y=x^2 and tangent through external point (1, 0), disclosing infeasible case separately",
      entities: [
        { id: "f", kind: "function", label: "f", scopeId: "shared", stateId: "shared" },
        { id: "t", kind: "tangent", label: "l", scopeId: "(1)", stateId: "shared", hostEntityId: "f" }
      ],
      givenRelations: [
        { kind: "function_expression", targets: ["f"], value: "x^2", scopeId: "shared", stateId: "shared", sourceSpan: { text: "f(x)=x²" } }
      ],
      subquestions: [
        { id: "(1)", dependsOn: ["shared"], stateId: "shared", relations: ["external_tangent"] },
        { id: "(2)", dependsOn: ["shared"], stateId: "shared", relations: ["infeasible_existence"] }
      ],
      constructionStrategies: [
        {
          nodeId: "build-f",
          outputEntityId: "f",
          outputKind: "function",
          strategy: "function_curve_and_tangent",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { label: "f", expression: "x^2", domain: [-3, 3] },
          sourceSpan: { text: "f(x)=x²" }
        },
        {
          nodeId: "build-t",
          outputEntityId: "t",
          outputKind: "tangent",
          strategy: "function_curve_and_tangent",
          scopeId: "(1)",
          stateId: "shared",
          hostEntityId: "f",
          dependencyIds: ["build-f"],
          params: {
            mode: "tangent_from_external_point",
            expression: "x^2",
            externalPoint: { x: 1, y: 0 },
            domain: [0.5, 4],
            index: 0,
            tangentLabel: "l"
          },
          sourceSpan: { text: "过点 (1,0) 的切线" }
        },
        {
          nodeId: "disclose-2",
          outputEntityId: "f",
          outputKind: "function",
          strategy: "infeasible_disclosure",
          scopeId: "(2)",
          stateId: "shared",
          dependencyIds: ["build-f"],
          params: { summary: "第(2)问对应点不存在" },
          sourceSpan: { text: "若不存在请说明理由" }
        }
      ],
      unknowns: []
    }

    const parsed = parseAndValidateDsDrawingIntent(extTangentIntent)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const plan1 = compileDsDrawingIntentByScope(parsed.value, "(1)")
    expect(plan1.kind).toBe("plan")
    if (plan1.kind !== "plan") return
    expect(plan1.answer).toBeUndefined()
    const compiled1 = compilePlan(plan1, {
      document: createEmptyDocument("calculus"),
      conversationId: "ds2-ext-1",
      documentGeneration: 0,
      workspace: "calculus"
    })
    expect(compiled1.ok, JSON.stringify(compiled1.diagnostics)).toBe(true)
    const lineL = compiled1.draftDocument!.primitives.find((p) => p.type === "line" && p.label === "l") as
      | { type: "line"; a: { x: number; y: number }; b: { x: number; y: number } }
      | undefined
    expect(lineL).toBeDefined()
    // Tangent to y=x^2 from (1,0) in (0.5,4) touches at t=2 => y = 4(x-1) => passes through (1,0) and slope=4.
    const slope = (lineL!.b.y - lineL!.a.y) / (lineL!.b.x - lineL!.a.x)
    const yAt1 = lineL!.a.y + slope * (1 - lineL!.a.x)
    expect(Math.abs(slope - 4)).toBeLessThan(1e-5)
    expect(Math.abs(yAt1)).toBeLessThan(1e-5)
    // Tampering negative check: a non-tangent slope like 2 cannot satisfy y=x^2 tangency through (1,0).
    expect(Math.abs(slope - 2)).toBeGreaterThan(1)

    const fullPlan = compileDsDrawingIntentByScope(parsed.value)
    expect(fullPlan.kind).toBe("plan")
    if (fullPlan.kind === "plan") {
      expect(fullPlan.answer).toContain("第(2)问对应点不存在")
    }
  })
})

describe("Task 2 required mathematical parameter provenance and DAG fail-closed", () => {
  const validFunctionTangentIntent: DsDrawingIntent = {
    schemaVersion: "mathcanvas.ds_intent.v1",
    goal: "Plot f(x)=x^2 and tangent at x0=1",
    entities: [
      { id: "f", kind: "function", label: "f", scopeId: "shared", stateId: "shared" },
      { id: "l", kind: "tangent", label: "l", scopeId: "(1)", stateId: "(1)", hostEntityId: "f" }
    ],
    givenRelations: [
      { kind: "function_expression", targets: ["f"], value: "x^2", scopeId: "shared", stateId: "shared", sourceSpan: { text: "f(x)=x^2" } }
    ],
    subquestions: [{ id: "(1)", dependsOn: ["shared"], stateId: "(1)", relations: ["tangent"] }],
    constructionStrategies: [
      {
        nodeId: "fn-f",
        outputEntityId: "f",
        outputKind: "function",
        strategy: "function_curve_and_tangent",
        scopeId: "shared",
        stateId: "shared",
        dependencyIds: [],
        params: { label: "f", expression: "x^2", domain: [-2, 4] },
        sourceSpan: { text: "f(x)=x^2, x in [-2,4]" }
      },
      {
        nodeId: "tan-l",
        outputEntityId: "l",
        outputKind: "tangent",
        strategy: "function_curve_and_tangent",
        scopeId: "(1)",
        stateId: "(1)",
        hostEntityId: "f",
        dependencyIds: ["fn-f"],
        params: { mode: "tangent_at_x", expression: "x^2", x0: 1, tangentLabel: "l" },
        sourceSpan: { text: "x0=1" }
      }
    ],
    unknowns: []
  }

  it("rejects missing expression, missing x0, and missing domain instead of substituting 'x', 0, or [-5, 5]", () => {
    expect(validateRequiredParameters(validFunctionTangentIntent)).toEqual({ ok: true })

    // 1. Missing expression
    const missingExpr = structuredClone(validFunctionTangentIntent)
    delete missingExpr.constructionStrategies[0]!.params!.expression
    expect(validateRequiredParameters(missingExpr)).toEqual({
      ok: false,
      code: "missing_required_parameter",
      path: "intent.constructionStrategies[0].params.expression"
    })
    expect(parseAndValidateDsDrawingIntent(missingExpr).ok).toBe(false)
    expect(compileDsDrawingIntentToPlan(missingExpr).kind).not.toBe("plan")

    // 2. Missing x0 on tangent_at_x
    const missingX0 = structuredClone(validFunctionTangentIntent)
    delete missingX0.constructionStrategies[1]!.params!.x0
    expect(validateRequiredParameters(missingX0)).toEqual({
      ok: false,
      code: "missing_required_parameter",
      path: "intent.constructionStrategies[1].params.x0"
    })
    expect(compileDsDrawingIntentToPlan(missingX0).kind).not.toBe("plan")

    // 3. Missing domain on curve & tangent_from_external_point
    const missingDomain = structuredClone(validFunctionTangentIntent)
    delete missingDomain.constructionStrategies[0]!.params!.domain
    expect(validateRequiredParameters(missingDomain)).toEqual({
      ok: false,
      code: "missing_required_parameter",
      path: "intent.constructionStrategies[0].params.domain"
    })

    // 4. Rejects unproven parameters lacking sourceSpan, assumptions, or derived dependency
    const unproven = structuredClone(validFunctionTangentIntent)
    delete unproven.constructionStrategies[0]!.sourceSpan
    expect(validateRequiredParameters(unproven)).toEqual({
      ok: false,
      code: "unproven_parameter",
      path: "intent.constructionStrategies[0]"
    })
  })

  it("fails closed on cyclic_dependency, missing_host, and cross_scope_violation without falling back to raw step order", () => {
    // 1. Cyclic dependency
    const cyclic = structuredClone(validFunctionTangentIntent)
    cyclic.constructionStrategies[0]!.dependencyIds = ["tan-l"]
    const rCyclic = parseAndValidateDsDrawingIntent(cyclic)
    expect(rCyclic.ok).toBe(false)
    if (!rCyclic.ok) {
      expect(rCyclic.diagnostics.some((d) => d.code === "cyclic_dependency")).toBe(true)
    }
    const envCyclic = compileDsDrawingIntentToPlan(cyclic)
    expect(envCyclic.kind).toBe("clarification")
    if (envCyclic.kind === "clarification") {
      expect(envCyclic.questions.join(" ")).toContain("cyclic_dependency")
    }

    // 2. Missing host
    const missingHost = structuredClone(validFunctionTangentIntent)
    missingHost.entities[1]!.hostEntityId = "MissingCurve"
    missingHost.constructionStrategies[1]!.hostEntityId = "MissingCurve"
    const rHost = parseAndValidateDsDrawingIntent(missingHost)
    expect(rHost.ok).toBe(false)
    const envHost = compileDsDrawingIntentToPlan(missingHost)
    expect(envHost.kind).toBe("clarification")
    if (envHost.kind === "clarification") {
      expect(envHost.questions.join(" ")).toContain("missing_host")
    }

    // 3. Cross scope violation
    const crossScope = structuredClone(validFunctionTangentIntent)
    crossScope.subquestions.push({ id: "(2)", dependsOn: ["shared"], stateId: "(2)", relations: [] })
    crossScope.entities.push({ id: "g", kind: "function", label: "g", scopeId: "(1)", stateId: "(1)" })
    crossScope.entities.push({ id: "l2", kind: "tangent", label: "l2", scopeId: "(2)", stateId: "(2)", hostEntityId: "g" })
    crossScope.constructionStrategies.push({
      nodeId: "fn-g",
      outputEntityId: "g",
      outputKind: "function",
      strategy: "function_curve_and_tangent",
      scopeId: "(1)",
      stateId: "(1)",
      dependencyIds: [],
      params: { label: "g", expression: "x", domain: [-1, 1] },
      sourceSpan: { text: "g(x)=x" }
    })
    crossScope.constructionStrategies.push({
      nodeId: "tan-l2",
      outputEntityId: "l2",
      outputKind: "tangent",
      strategy: "function_curve_and_tangent",
      scopeId: "(2)",
      stateId: "(2)",
      hostEntityId: "g",
      dependencyIds: ["fn-g"],
      params: { mode: "tangent_at_x", expression: "x", x0: 0, tangentLabel: "l2" },
      sourceSpan: { text: "x0=0" }
    })
    const rCross = parseAndValidateDsDrawingIntent(crossScope)
    expect(rCross.ok).toBe(false)
    if (!rCross.ok) {
      expect(rCross.diagnostics.some((d) => d.code === "cross_scope_violation")).toBe(true)
    }
    const envCross = compileDsDrawingIntentToPlan(crossScope)
    expect(envCross.kind).toBe("clarification")
    if (envCross.kind === "clarification") {
      expect(envCross.questions.join(" ")).toContain("cross_scope_violation")
    }
  })
})

describe("Task 3 failure-driven capability families (non-case-ID parameterized & negative checks)", () => {
  it("constructs secant other-intersection and conic equation + vertices (GK-P03 & JT-P02 families, renamed)", () => {
    const intent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Construct ellipse Gamma, focus H, vertices V1/V2, external point D, and distinct secant intersections J, K",
      entities: [
        { id: "Gamma", kind: "conic", label: "Γ", scopeId: "shared", stateId: "shared" },
        { id: "V1", kind: "point", label: "V₁", scopeId: "shared", stateId: "shared", hostEntityId: "Gamma" },
        { id: "V2", kind: "point", label: "V₂", scopeId: "shared", stateId: "shared", hostEntityId: "Gamma" },
        { id: "H", kind: "focus", label: "H", scopeId: "shared", stateId: "shared", hostEntityId: "Gamma" },
        { id: "U", kind: "point", label: "U", scopeId: "shared", stateId: "shared", hostEntityId: "Gamma" },
        { id: "D", kind: "point", label: "D", scopeId: "(1)", stateId: "(1)" },
        { id: "J", kind: "point", label: "J", scopeId: "(1)", stateId: "(1)", hostEntityId: "Gamma" },
        { id: "DJ", kind: "line", label: "DJ", scopeId: "(1)", stateId: "(1)" }
      ],
      givenRelations: [],
      subquestions: [{ id: "(1)", dependsOn: ["shared"], stateId: "(1)", relations: ["collinear", "on_conic"] }],
      constructionStrategies: [
        {
          nodeId: "n-gamma",
          outputEntityId: "Gamma",
          outputKind: "conic",
          strategy: "conic_from_equation_or_properties",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { conicType: "ellipse", equation: "x^2/4 + y^2/3 = 1" },
          sourceSpan: { text: "椭圆 Γ: x²/4 + y²/3 = 1" }
        },
        {
          nodeId: "n-v1",
          outputEntityId: "V1",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "shared",
          stateId: "shared",
          hostEntityId: "Gamma",
          dependencyIds: ["n-gamma"],
          params: { mode: "conic_vertex", conicId: "Gamma", index: 0 },
          sourceSpan: { text: "左顶点 V₁" }
        },
        {
          nodeId: "n-v2",
          outputEntityId: "V2",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "shared",
          stateId: "shared",
          hostEntityId: "Gamma",
          dependencyIds: ["n-gamma"],
          params: { mode: "conic_vertex", conicId: "Gamma", index: 1 },
          sourceSpan: { text: "右顶点 V₂" }
        },
        {
          nodeId: "n-h",
          outputEntityId: "H",
          outputKind: "focus",
          strategy: "planar_point_on_host",
          scopeId: "shared",
          stateId: "shared",
          hostEntityId: "Gamma",
          dependencyIds: ["n-gamma"],
          params: { mode: "focus", conicId: "Gamma", index: 1 },
          sourceSpan: { text: "右焦点 H" }
        },
        {
          nodeId: "n-u",
          outputEntityId: "U",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "shared",
          stateId: "shared",
          hostEntityId: "Gamma",
          dependencyIds: ["n-gamma"],
          params: { mode: "on_conic", conicId: "Gamma", parameter: Math.PI / 3 },
          assumptions: ["取参数 θ=π/3"]
        },
        {
          nodeId: "n-d",
          outputEntityId: "D",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "(1)",
          stateId: "(1)",
          dependencyIds: [],
          params: { mode: "explicit_coords", x: 1, y: 0 },
          sourceSpan: { text: "D(1,0)" }
        },
        {
          nodeId: "n-j",
          outputEntityId: "J",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "(1)",
          stateId: "(1)",
          hostEntityId: "Gamma",
          dependencyIds: ["n-gamma", "n-u", "n-d"],
          params: { mode: "other_line_conic_intersection", conicId: "Gamma", from: "D", through: "U", excludePointId: "U" },
          sourceSpan: { text: "DU 交 Γ 于另一点 J" }
        },
        {
          nodeId: "n-dj",
          outputEntityId: "DJ",
          outputKind: "line",
          strategy: "planar_line_or_segment",
          scopeId: "(1)",
          stateId: "(1)",
          dependencyIds: ["n-d", "n-j"],
          params: { mode: "through_points", from: "D", to: "J" },
          sourceSpan: { text: "直线 DJ" }
        }
      ],
      unknowns: []
    }

    const parsed = parseAndValidateDsDrawingIntent(intent)
    expect(parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.diagnostics)).toBe(true)
    if (!parsed.ok) return
    const plan = compileDsDrawingIntentToPlan(parsed.value)
    expect(plan.kind).toBe("plan")
    if (plan.kind !== "plan") return

    const compiled = compilePlan(plan, {
      document: createEmptyDocument("conics"),
      conversationId: "t3-secant-1",
      documentGeneration: 0,
      workspace: "conics"
    })
    expect(compiled.ok).toBe(true)
    const ptU = compiled.draftDocument!.primitives.find((p) => p.type === "point" && p.label === "U") as { x: number; y: number } | undefined
    const ptJ = compiled.draftDocument!.primitives.find((p) => p.type === "point" && p.label === "J") as { x: number; y: number } | undefined
    const ptV1 = compiled.draftDocument!.primitives.find((p) => p.type === "point" && p.label === "V₁") as { x: number; y: number } | undefined
    expect(ptU).toBeDefined()
    expect(ptJ).toBeDefined()
    expect(ptV1).toEqual({ id: expect.any(String), type: "point", label: "V₁", x: -2, y: 0 })
    // J must satisfy x^2/4 + y^2/3 = 1, be collinear with U and D(1,0), and be distinct from U
    expect(Math.hypot(ptJ!.x - ptU!.x, ptJ!.y - ptU!.y)).toBeGreaterThan(0.5)
    expect(Math.abs((ptJ!.x * ptJ!.x) / 4 + (ptJ!.y * ptJ!.y) / 3 - 1)).toBeLessThan(1e-5)
    const cross = (ptU!.x - 1) * ptJ!.y - ptU!.y * (ptJ!.x - 1)
    expect(Math.abs(cross)).toBeLessThan(1e-5)
  })

  it("materializes cuboid edge-ratio points via givenRelations or edge_ratio on renamed prism (GK-S05 family)", () => {
    const intent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Construct right prism MNPQ-M1N1P1Q1 and derived ratio points M2, N2 on lateral edges",
      entities: [
        { id: "Prism", kind: "solid", label: "Prism", scopeId: "shared", stateId: "shared" },
        { id: "M2", kind: "point", label: "M₂", scopeId: "shared", stateId: "shared", hostEntityId: "Prism" },
        { id: "N2", kind: "point", label: "N₂", scopeId: "shared", stateId: "shared", hostEntityId: "Prism" },
        { id: "Seg", kind: "segment", label: "M₂N₂", scopeId: "shared", stateId: "shared" }
      ],
      givenRelations: [
        { kind: "ratio", targets: ["M2", "M", "M₁"], value: 0.25, scopeId: "shared", stateId: "shared", sourceSpan: { text: "MM₂ = 1/4 MM₁" } }
      ],
      subquestions: [{ id: "(1)", dependsOn: ["shared"], stateId: "shared", relations: ["ratio", "parallel"] }],
      constructionStrategies: [
        {
          nodeId: "n-prism",
          outputEntityId: "Prism",
          outputKind: "solid",
          strategy: "solid_base_and_prism_or_pyramid",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { shape: "prism_box", width: 4, depth: 3, height: 8, vertexNames: ["M", "N", "P", "Q", "M₁", "N₁", "P₁", "Q₁"] },
          sourceSpan: { text: "长方体 MNPQ-M₁N₁P₁Q₁，宽4深3高8" }
        },
        {
          nodeId: "n-m2",
          outputEntityId: "M2",
          outputKind: "point",
          strategy: "solid_point_on_edge_or_face",
          scopeId: "shared",
          stateId: "shared",
          hostEntityId: "Prism",
          dependencyIds: ["n-prism"],
          params: { mode: "edge_ratio", from: "M", to: "M₁", ratioFromFirst: 0.25 },
          sourceSpan: { text: "MM₂ = 1/4 MM₁" }
        },
        {
          nodeId: "n-n2",
          outputEntityId: "N2",
          outputKind: "point",
          strategy: "solid_point_on_edge_or_face",
          scopeId: "shared",
          stateId: "shared",
          hostEntityId: "Prism",
          dependencyIds: ["n-prism"],
          params: { mode: "edge_ratio", from: "N", to: "N₁", ratioFromFirst: 0.25 },
          sourceSpan: { text: "NN₂ = 1/4 NN₁" }
        },
        {
          nodeId: "n-seg",
          outputEntityId: "Seg",
          outputKind: "segment",
          strategy: "solid_point_on_edge_or_face",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: ["n-m2", "n-n2"],
          params: { mode: "segment", from: "M2", to: "N2" },
          sourceSpan: { text: "连线 M₂N₂" }
        }
      ],
      unknowns: []
    }

    const parsed = parseAndValidateDsDrawingIntent(intent)
    expect(parsed.ok, parsed.ok ? "" : JSON.stringify(parsed.diagnostics)).toBe(true)
    if (!parsed.ok) return
    const plan = compileDsDrawingIntentToPlan(parsed.value)
    expect(plan.kind).toBe("plan")
    if (plan.kind !== "plan") return

    const compiled = compilePlan(plan, {
      document: createEmptyDocument("geometry3d"),
      conversationId: "t3-s05-1",
      documentGeneration: 0,
      workspace: "geometry3d"
    })
    expect(compiled.ok).toBe(true)
    const ptM2 = compiled.draftDocument!.primitives.find((p) => p.type === "point3" && p.label === "M₂") as { position: { x: number; y: number; z: number } } | undefined
    const ptN2 = compiled.draftDocument!.primitives.find((p) => p.type === "point3" && p.label === "N₂") as { position: { x: number; y: number; z: number } } | undefined
    expect(ptM2?.position).toEqual({ x: 0, y: 0, z: 2 })
    expect(ptN2?.position).toEqual({ x: 4, y: 0, z: 2 })
    // Cross-id segment resolution must also succeed when using outputEntityId "M2"/"N2" instead of display label "M₂"/"N₂"
    expect(compiled.draftDocument!.primitives.some((p) => p.type === "segment3" && p.label === "M₂N₂")).toBe(true)
  })

  it("compiles common_tangent / source-bound tangent_at_x to function.create_tangent, supports perp/parallel lines & scaled conics, rotates all fold vertices, and fails closed on unresolved steps", () => {
    // 1. Common tangent between two polynomial curves -> real function.create_tangent actions
    const commonTangentIntent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Draw f(x)=x^2, g(x)=-(x-2)^2+1 and their two common tangents",
      entities: [
        { id: "f", kind: "function", label: "f", scopeId: "shared", stateId: "shared" },
        { id: "g", kind: "function", label: "g", scopeId: "shared", stateId: "shared" },
        { id: "ct0", kind: "tangent", label: "ct0", scopeId: "(1)", stateId: "shared", hostEntityId: "f" },
        { id: "ct1", kind: "tangent", label: "ct1", scopeId: "(1)", stateId: "shared", hostEntityId: "f" }
      ],
      givenRelations: [],
      subquestions: [{ id: "(1)", dependsOn: ["shared"], stateId: "shared", relations: ["common_tangent"] }],
      constructionStrategies: [
        {
          nodeId: "n-f",
          outputEntityId: "f",
          outputKind: "function",
          strategy: "function_curve_and_tangent",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { mode: "curve", expression: "x*x", domain: [-3, 3] },
          sourceSpan: { text: "f(x)=x^2" }
        },
        {
          nodeId: "n-g",
          outputEntityId: "g",
          outputKind: "function",
          strategy: "function_curve_and_tangent",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { mode: "curve", expression: "-(x-2)*(x-2)+1", domain: [-2, 3] },
          sourceSpan: { text: "g(x)=-(x-2)^2+1" }
        },
        {
          nodeId: "n-ct0",
          outputEntityId: "ct0",
          outputKind: "tangent",
          strategy: "function_curve_and_tangent",
          scopeId: "(1)",
          stateId: "shared",
          hostEntityId: "f",
          dependencyIds: ["n-f", "n-g"],
          params: { mode: "common_tangent", sourceEntityId: "f", otherEntityId: "g", branch: 0 },
          sourceSpan: { text: "公切线1" }
        },
        {
          nodeId: "n-ct1",
          outputEntityId: "ct1",
          outputKind: "tangent",
          strategy: "function_curve_and_tangent",
          scopeId: "(1)",
          stateId: "shared",
          hostEntityId: "f",
          dependencyIds: ["n-f", "n-g"],
          params: { mode: "common_tangent", sourceEntityId: "f", otherEntityId: "g", branch: 1 },
          sourceSpan: { text: "公切线2" }
        }
      ],
      unknowns: []
    }
    const parsedCt = parseAndValidateDsDrawingIntent(commonTangentIntent)
    expect(parsedCt.ok, parsedCt.ok ? "" : JSON.stringify(parsedCt.diagnostics)).toBe(true)
    if (!parsedCt.ok) return
    const planCt = compileDsDrawingIntentToPlan(parsedCt.value)
    expect(planCt.kind).toBe("plan")
    if (planCt.kind !== "plan") return
    expect(planCt.actions.filter((a) => a.actionId === "function.create_tangent")).toHaveLength(2)

    const compiledCt = compilePlan(planCt, {
      document: createEmptyDocument("conics"),
      conversationId: "r2-ct",
      documentGeneration: 0,
      workspace: "conics"
    })
    expect(compiledCt.ok).toBe(true)
    const ctPrims = compiledCt.draftDocument!.primitives.filter((p) => p.type === "tangent")
    expect(ctPrims).toHaveLength(2)

    // 2. Scaled ellipse 4x^2 + 9y^2 = 36 + perpendicular/parallel lines through a point
    const planarOrthoIntent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Draw ellipse 4x^2+9y^2=36, chord AB and perpendicular chord through focus",
      entities: [
        { id: "E", kind: "conic", label: "E", scopeId: "shared", stateId: "shared" },
        { id: "F2", kind: "point", label: "F2", scopeId: "shared", stateId: "shared", hostEntityId: "E" },
        { id: "O", kind: "point", label: "O", scopeId: "shared", stateId: "shared" },
        { id: "L1", kind: "line", label: "L1", scopeId: "shared", stateId: "shared" },
        { id: "Lperp", kind: "line", label: "Lperp", scopeId: "shared", stateId: "shared" },
        { id: "Lpar", kind: "line", label: "Lpar", scopeId: "shared", stateId: "shared" }
      ],
      givenRelations: [],
      subquestions: [{ id: "(1)", dependsOn: ["shared"], stateId: "shared", relations: ["perpendicular", "parallel"] }],
      constructionStrategies: [
        {
          nodeId: "n-e",
          outputEntityId: "E",
          outputKind: "conic",
          strategy: "conic_from_equation_or_properties",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { conicType: "ellipse", equation: "4x^2+9y^2=36" },
          sourceSpan: { text: "4x^2+9y^2=36" }
        },
        {
          nodeId: "n-f2",
          outputEntityId: "F2",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "shared",
          stateId: "shared",
          hostEntityId: "E",
          dependencyIds: ["n-e"],
          params: { mode: "focus", conicId: "E", index: 1 },
          sourceSpan: { text: "右焦点 F2" }
        },
        {
          nodeId: "n-o",
          outputEntityId: "O",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { mode: "explicit_coords", x: 0, y: 0 },
          sourceSpan: { text: "原点 O" }
        },
        {
          nodeId: "n-l1",
          outputEntityId: "L1",
          outputKind: "line",
          strategy: "planar_line_or_segment",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: ["n-o", "n-f2"],
          params: { mode: "equation", a: 1, b: -1, c: 0 },
          sourceSpan: { text: "x-y=0" }
        },
        {
          nodeId: "n-lperp",
          outputEntityId: "Lperp",
          outputKind: "line",
          strategy: "planar_line_or_segment",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: ["n-l1", "n-f2"],
          params: { mode: "perpendicular_through_point", throughPointId: "F2", lineId: "L1" },
          sourceSpan: { text: "过 F2 垂直于 L1" }
        },
        {
          nodeId: "n-lpar",
          outputEntityId: "Lpar",
          outputKind: "line",
          strategy: "planar_line_or_segment",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: ["n-l1", "n-f2"],
          params: { mode: "parallel_through_point", throughPointId: "F2", lineId: "L1" },
          sourceSpan: { text: "过 F2 平行于 L1" }
        }
      ],
      unknowns: []
    }
    const parsedOrtho = parseAndValidateDsDrawingIntent(planarOrthoIntent)
    expect(parsedOrtho.ok, parsedOrtho.ok ? "" : JSON.stringify(parsedOrtho.diagnostics)).toBe(true)
    if (!parsedOrtho.ok) return
    const planOrtho = compileDsDrawingIntentToPlan(parsedOrtho.value)
    expect(planOrtho.kind).toBe("plan")
    if (planOrtho.kind !== "plan") return
    const compiledOrtho = compilePlan(planOrtho, {
      document: createEmptyDocument("conics"),
      conversationId: "r2-ortho",
      documentGeneration: 0,
      workspace: "conics"
    })
    expect(compiledOrtho.ok).toBe(true)
    expect(compiledOrtho.draftDocument!.primitives.some((p) => p.type === "ellipse" && Math.abs(p.radiusX - 3) < 1e-6 && Math.abs(p.radiusY - 2) < 1e-6)).toBe(true)
    expect(compiledOrtho.draftDocument!.primitives.filter((p) => p.type === "line")).toHaveLength(3)

    // 3. Multi-vertex fold rotates every movingVertexNames[i] -> afterVertexNames[i]
    const foldIntent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Fold both moving vertices around hinge B-C and connect after-fold edge",
      entities: [
        { id: "Base", kind: "polygon", label: "Base", scopeId: "shared", stateId: "pre_fold" },
        { id: "Folded", kind: "solid", label: "Folded", scopeId: "(1)", stateId: "post_fold" },
        { id: "SegAfter", kind: "segment", label: "A₁D₁", scopeId: "(1)", stateId: "post_fold" }
      ],
      givenRelations: [],
      subquestions: [{ id: "(1)", dependsOn: ["shared"], stateId: "post_fold", relations: ["fold"] }],
      constructionStrategies: [
        {
          nodeId: "n-base",
          outputEntityId: "Base",
          outputKind: "polygon",
          strategy: "solid_base_and_prism_or_pyramid",
          scopeId: "shared",
          stateId: "pre_fold",
          dependencyIds: [],
          params: { shape: "right_trapezoid_open_base", bottomLength: 4, topLength: 2, height: 2, vertexNames: ["B", "C", "D", "A"] },
          sourceSpan: { text: "直角梯形 ABCD" }
        },
        {
          nodeId: "n-fold",
          outputEntityId: "Folded",
          outputKind: "solid",
          strategy: "solid_fold_along_hinge",
          scopeId: "(1)",
          stateId: "post_fold",
          dependencyIds: ["n-base"],
          foldPhase: "post_fold",
          params: { hinge: ["B", "C"], movingVertexNames: ["A", "D"], afterVertexNames: ["A₁", "D₁"], angleDegrees: 90 },
          sourceSpan: { text: "沿 BC 折起 90°" }
        },
        {
          nodeId: "n-seg-after",
          outputEntityId: "SegAfter",
          outputKind: "segment",
          strategy: "solid_point_on_edge_or_face",
          scopeId: "(1)",
          stateId: "post_fold",
          dependencyIds: ["n-fold"],
          params: { mode: "segment", from: "A₁", to: "D₁" },
          sourceSpan: { text: "连线 A₁D₁" }
        }
      ],
      unknowns: []
    }
    const parsedFold = parseAndValidateDsDrawingIntent(foldIntent)
    expect(parsedFold.ok, parsedFold.ok ? "" : JSON.stringify(parsedFold.diagnostics)).toBe(true)
    if (!parsedFold.ok) return
    const planFold = compileDsDrawingIntentToPlan(parsedFold.value)
    expect(planFold.kind).toBe("plan")
    if (planFold.kind !== "plan") return
    expect(planFold.actions.some((a) => a.actionId === "solid.create_segment")).toBe(true)

    // 4. Unresolved step dependency must fail closed (clarification), never silently drop action
    const unresolvedIntent: DsDrawingIntent = {
      schemaVersion: "mathcanvas.ds_intent.v1",
      goal: "Fail closed when line misses host point",
      entities: [
        { id: "O", kind: "point", scopeId: "shared", stateId: "shared" },
        { id: "L", kind: "line", scopeId: "shared", stateId: "shared" }
      ],
      givenRelations: [],
      subquestions: [],
      constructionStrategies: [
        {
          nodeId: "n-o",
          outputEntityId: "O",
          outputKind: "point",
          strategy: "planar_point_on_host",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: [],
          params: { mode: "explicit_coords", x: 0, y: 0 },
          sourceSpan: { text: "O(0,0)" }
        },
        {
          nodeId: "n-l",
          outputEntityId: "L",
          outputKind: "line",
          strategy: "planar_line_or_segment",
          scopeId: "shared",
          stateId: "shared",
          dependencyIds: ["n-o"],
          params: { mode: "through_points", from: "O", to: "MissingPt" },
          sourceSpan: { text: "过 O 与 MissingPt" }
        }
      ],
      unknowns: []
    }
    const compiledUnresolved = compileDsDrawingIntentToPlan(unresolvedIntent)
    expect(compiledUnresolved.kind).toBe("clarification")
    if (compiledUnresolved.kind === "clarification") {
      expect(compiledUnresolved.questions.join(" ")).toContain("unresolved_construction")
    }
  }, 15_000)
})
