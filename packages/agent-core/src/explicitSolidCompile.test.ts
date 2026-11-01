import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION } from "./contracts"
import { DEFAULT_SOLID_SIZE } from "./localPlanDefaults"
import { compilePlan } from "./planCompiler"

const SPHERE_PROMPT = "画一个球体，球心 (1,2,3)，半径 5"
const PRISM_PROMPT = "画一个斜棱柱，底面边长 4，高 8"

function sphere(center: { x: number; y: number; z: number }, radius: number, alias = "sphere") {
  return {
    actionId: "solid.create_sphere",
    actionKey: alias,
    factIds: [],
    inputs: { alias, center, radius }
  }
}

function prism(input: { vector?: { x: number; y: number; z: number }; span?: number; alias?: string; basePolygon?: { x: number; y: number; z: number }[] } = {}) {
  const alias = input.alias ?? "prism"
  const span = input.span ?? 4
  return {
    actionId: "solid.create_prism",
    actionKey: alias,
    factIds: [],
    inputs: {
      alias,
      basePolygon: input.basePolygon ?? [{ x: 0, y: 0, z: 0 }, { x: span, y: 0, z: 0 }, { x: span, y: span, z: 0 }, { x: 0, y: span, z: 0 }],
      vector: input.vector ?? { x: 1, y: 0.5, z: 8 }
    }
  }
}

function plan(actions: unknown[]) {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "explicit solid", factIds: [], actions }
}

function context(prompt: string, document: GeometryDocument = createEmptyDocument("geometry3d")) {
  return { document, prompt, workspace: "geometry3d" as const, conversationId: "explicit-solid", documentGeneration: document.revision }
}

function failureText(result: ReturnType<typeof compilePlan>): string {
  return result.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")
}

describe("compile-time explicit solid conditions", () => {
  it("compiles a sphere with the user's center and radius, and verifies the final primitive", () => {
    const result = compilePlan(plan([sphere({ x: 1, y: 2, z: 3 }, 5)]), context(SPHERE_PROMPT))
    expect(result.ok, failureText(result)).toBe(true)
    expect(result.draftDocument?.primitives[0]).toMatchObject({ type: "sphere", center: { x: 1, y: 2, z: 3 }, radius: 5 })
    expect(result.diagramVerification?.status, JSON.stringify(result.diagramVerification)).toBe("passed")
    expect(result.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}`)).toEqual([
      "球心 (1,2,3):passed",
      "半径 5:passed"
    ])
  })

  it("rejects a sphere whose final center ignores the explicit center", () => {
    const result = compilePlan(plan([sphere({ x: 0, y: 0, z: 0 }, 5)]), context(SPHERE_PROMPT))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/球心|center/i)
    expect(result.diagramVerification?.status).toBe("failed")
  })

  it("rejects a sphere whose radius was replaced by the default", () => {
    const result = compilePlan(plan([sphere({ x: 1, y: 2, z: 3 }, DEFAULT_SOLID_SIZE)]), context(SPHERE_PROMPT))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/5/)
  })

  it("compiles a prism only when both base edge and vertical height match", () => {
    const result = compilePlan(plan([prism()]), context(PRISM_PROMPT))
    expect(result.ok, failureText(result)).toBe(true)
    const solid = result.draftDocument?.primitives.find((primitive) => primitive.type === "polyhedron3")
    expect(solid?.type).toBe("polyhedron3")
    if (solid?.type === "polyhedron3") {
      const construction = solid.construction
      expect(construction?.kind).toBe("prism")
      if (construction?.kind === "prism") {
        expect(construction.vector.z).toBe(8)
        expect(Math.hypot(construction.vector.x, construction.vector.y, construction.vector.z)).toBeGreaterThan(8)
      }
    }
    expect(result.diagramVerification?.status, JSON.stringify(result.diagramVerification)).toBe("passed")
  })

  it("rejects a prism whose side edge is 8 but whose vertical height is not 8", () => {
    // 侧棱长 = √(48 + 16 + 0) = 8，但两底面之间的垂直高度只有 4。
    const result = compilePlan(plan([prism({ vector: { x: Math.sqrt(48), y: 0, z: 4 } })]), context(PRISM_PROMPT))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/高|height/i)
    expect(result.diagramVerification?.status).toBe("failed")
  })

  it("rejects a prism whose base edge is wrong even when the height is right", () => {
    const result = compilePlan(plan([prism({ span: 3 })]), context(PRISM_PROMPT))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/底面边长|base edge/i)
  })

  it("rejects a straight prism whose lateral vector is oblique", () => {
    const result = compilePlan(plan([prism({ vector: { x: 1, y: 0.5, z: 8 } })]), context("画一个直棱柱，底面边长 4，高 8"))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/直|侧棱|垂直/)
    expect(result.diagramVerification?.status).toBe("failed")
  })

  it("accepts a regular square prism only with a square base and vertical sides", () => {
    const correct = compilePlan(plan([prism({ vector: { x: 0, y: 0, z: 8 } })]), context("画一个正四棱柱，底面边长 4，高 8"))
    expect(correct.ok, failureText(correct)).toBe(true)
    expect(correct.diagramVerification?.status).toBe("passed")
    const oblique = compilePlan(plan([prism({ vector: { x: 1, y: 0.5, z: 8 } })]), context("画一个正四棱柱，底面边长 4，高 8"))
    expect(oblique.ok).toBe(false)
    expect(failureText(oblique)).toMatch(/侧棱|垂直|直/)
  })

  it("rejects a triangular prism request built with a quadrilateral base", () => {
    const result = compilePlan(plan([prism()]), context("画一个三棱柱，底面边长 4，高 8"))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/边数|三|3/)
    expect(result.diagramVerification?.status).toBe("failed")
  })

  it("rejects a regular hexagonal prism request built with a quadrilateral base", () => {
    const result = compilePlan(plan([prism()]), context("画一个正六棱柱，底面边长 4，高 8"))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/边数|六|6/)
    expect(result.diagramVerification?.status).toBe("failed")
  })

  it("rejects a rhombus as the base of a regular square prism", () => {
    // 四边等长但不是正多边形：60°/120° 的菱形不共圆。
    const rhombus = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 6, y: 2 * Math.sqrt(3), z: 0 }, { x: 2, y: 2 * Math.sqrt(3), z: 0 }]
    const result = compilePlan(plan([prism({ basePolygon: rhombus, vector: { x: 0, y: 0, z: 8 } })]), context("画一个正四棱柱，底面边长 4，高 8"))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/正多边形|共圆|regular/)
    expect(result.diagramVerification?.status).toBe("failed")
  })

  it("rejects a plan that is missing the explicitly requested entity", () => {
    const cube = {
      actionId: "solid.create_template",
      actionKey: "cube",
      factIds: [],
      inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } }
    }
    const result = compilePlan(plan([cube]), context(SPHERE_PROMPT))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/球体|sphere/i)
  })

  it("rejects a plan that creates the wrong entity type for a prism request", () => {
    const result = compilePlan(plan([sphere({ x: 0, y: 0, z: 0 }, 5)]), context(PRISM_PROMPT))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/棱柱|prism/i)
  })

  it("rejects multiple target entities when the user asked for one", () => {
    const result = compilePlan(plan([sphere({ x: 1, y: 2, z: 3 }, 5, "sphere-a"), sphere({ x: 1, y: 2, z: 3 }, 5, "sphere-b")]), context("画一个球体，球心 (1,2,3)，半径 5"))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/一个|more than one|multiple/i)
  })

  it("rejects a correct target plus an extra solid as unclear ownership", () => {
    const cube = {
      actionId: "solid.create_template",
      actionKey: "cube",
      factIds: [],
      inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } }
    }
    const result = compilePlan(plan([sphere({ x: 1, y: 2, z: 3 }, 5), cube]), context("画一个球体，球心 (1,2,3)，半径 5"))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/归属|一个实体|2 个实体/)
  })

  it("fails closed on an unsupported explicit value instead of using a default", () => {
    const result = compilePlan(plan([sphere({ x: 0, y: 0, z: 0 }, DEFAULT_SOLID_SIZE)]), context("画一个球体，半径 1/2"))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/分数|不支持/)
  })

  it("fails closed on conflicting repeated explicit values", () => {
    const result = compilePlan(plan([sphere({ x: 1, y: 2, z: 3 }, 5)]), context("画一个球体，球心 (1,2,3)，球心 (1,2,4)，半径 5"))
    expect(result.ok).toBe(false)
    expect(failureText(result)).toMatch(/矛盾|冲突/)
  })
})
