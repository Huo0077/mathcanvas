import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import { PLAN_SCHEMA_VERSION } from "./contracts"
import { compilePlan } from "./planCompiler"

function compile(prompt: string, c = { x: 1, y: 1, z: 0 }) {
  const document = createEmptyDocument("geometry3d")
  return compilePlan({
    schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "fold to a stated relation", factIds: [],
    actions: [
      { actionId: "solid.create_face", actionKey: "flat", factIds: [], inputs: {
        alias: "flat", vertexNames: ["B", "C", "D"],
        vertices: [{ x: 0, y: 1, z: 0 }, c, { x: 1, y: 0, z: 0 }]
      } },
      { actionId: "solid.fold", actionKey: "flap", factIds: [], inputs: {
        alias: "flap", vertexNames: ["A", "E", "F"],
        vertices: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
        hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P", angle: 30
      } }
    ]
  }, { document, conversationId: "fold-search", documentGeneration: document.revision, prompt })
}

describe("fold relation search in the real plan compiler", () => {
  it("replaces a wrong provisional fold with a numerically solved stated angle", () => {
    const result = compile("∠PEB=67°")
    expect(result.ok).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    const point = result.draftDocument?.primitives.find(p => p.type === "point3" && p.label === "P")
    expect(point?.type).toBe("point3")
    if (point?.type !== "point3") throw new Error("missing folded P")
    // For a rotation about +x, P=(0,cos(theta),sin(theta)); measured independently here.
    expect(Math.atan2(point.position.z, point.position.y) * 180 / Math.PI).toBeCloseTo(67, 4)
    expect(result.assumptions.some(a => a.kind === "witness" && a.id === "searched-fold-angle.P")).toBe(true)
    const disclosure = result.assumptions.find(a => a.id === "searched-fold-angle.P")
    expect(disclosure?.value).toMatchObject({ complete: false, method: "bounded-numerical" })
  })

  it.each(["二面角P-EF-B=67°", "PE与平面BCD所成的角为67°"])("solves a supported relation: %s", prompt => {
    const result = compile(prompt)
    expect(result.ok).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    expect(result.assumptions.some(a => a.id === "searched-fold-angle.P")).toBe(true)
  })

  it("tries the second numerical branch instead of publishing a root that fails another condition", () => {
    const result = compile("PE与平面BCD所成角为67°，∠PEB=113°")
    expect(result.ok).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    expect(result.assumptions.find(a => a.id === "searched-fold-angle.P")?.value)
      .toMatchObject({ angleDegrees: expect.closeTo(113, 4), complete: false })
  })

  it("tries the second analytic branch when only it satisfies all stated conditions", () => {
    // P=(0,cos(theta),sin(theta)), C=(0,1,1).
    // PC²=3-2cos(theta)-2sin(theta). The given distance has roots 15° and 75°.
    const result = compile("PC=0.7419637843，∠PEB=75°", { x: 0, y: 1, z: 1 })
    expect(result.ok).toBe(true)
    expect(result.diagramVerification?.status).toBe("passed")
    const solved = result.assumptions.find(a => a.id === "solved-fold-angle.P")
    expect(solved?.value).toMatchObject({ angleDegrees: expect.closeTo(75, 4) })
  })

  it("does not publish a relation root when another stated condition fails", () => {
    const result = compile("∠PEB=67°，PE=2")
    expect(result.ok).toBe(false)
    expect(result.diagramVerification?.status).not.toBe("passed")
    expect(result.assumptions.some(a => a.id === "searched-fold-angle.P")).toBe(false)
  })
})
