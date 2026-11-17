import { describe, expect, it } from "vitest"

import { compileDsDrawingIntentToPlan, parseAndValidateDsDrawingIntent, type DsDrawingIntent } from "./dsDrawingIntent"
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
    expect(compiledFn.actions.some((a) => a.actionId === "planar.create_line")).toBe(true)

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
})
