import { compilePlan, PLAN_SCHEMA_VERSION } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { createDraftStore } from "./draftStore"

const SPHERE_PROMPT = "画一个球体，球心 (1,2,3)，半径 5"
const PRISM_PROMPT = "画一个斜棱柱，底面边长 4，高 8"

function sphereAction(center: { x: number; y: number; z: number }, radius: number) {
  return { actionId: "solid.create_sphere", actionKey: "sphere", factIds: [], inputs: { alias: "sphere", center, radius } }
}

function prismAction(vector: { x: number; y: number; z: number }) {
  return {
    actionId: "solid.create_prism",
    actionKey: "prism",
    factIds: [],
    inputs: {
      alias: "prism",
      basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }],
      vector
    }
  }
}

function plan(actions: unknown[]) {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan" as const, goal: "explicit solid", factIds: [], actions }
}

function compile(actions: unknown[], prompt: string) {
  const document = createEmptyDocument("geometry3d")
  return compilePlan(plan(actions), { document, prompt, workspace: "geometry3d", conversationId: "explicit-stage", documentGeneration: document.revision })
}

async function stage(actions: unknown[], prompt: string) {
  const store = createDraftStore()
  const draft = store.create(createEmptyDocument("geometry3d"))
  return store.stage(draft.draftId, actions as never, draft.draftVersion, prompt)
}

describe("explicit solid conditions on the draft staging path", () => {
  it("shows the same passed sphere report as compilePlan, and keeps the final center and radius", async () => {
    const actions = [sphereAction({ x: 1, y: 2, z: 3 }, 5)]
    const compiled = compile(actions, SPHERE_PROMPT)
    const staged = await stage(actions, SPHERE_PROMPT)
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    expect(staged.preview.diagramVerification?.status).toBe("passed")
    expect(staged.preview.diagramVerification?.checks.map((check) => `${check.sourceText}:${check.status}`)).toEqual([
      "球心 (1,2,3):passed",
      "半径 5:passed"
    ])
    expect(staged.preview.candidate.primitives[0]).toMatchObject({ type: "sphere", center: { x: 1, y: 2, z: 3 }, radius: 5 })
  })

  it("blocks a wrong sphere at the draft gate, consistently with compilePlan", async () => {
    const actions = [sphereAction({ x: 0, y: 0, z: 0 }, 5)]
    const compiled = compile(actions, SPHERE_PROMPT)
    const staged = await stage(actions, SPHERE_PROMPT)
    expect(compiled.ok).toBe(false)
    expect(staged.ok).toBe(false)
    if (!staged.ok) {
      expect(staged.reason).toBe("compile_failed")
      expect(staged.planDiagnostics?.some((entry) => /球心|center/i.test(entry.detail))).toBe(true)
    }
  })

  it("shows a passed prism report with vertical height 8 even though the side edge is longer", async () => {
    const actions = [prismAction({ x: 1, y: 0.5, z: 8 })]
    const compiled = compile(actions, PRISM_PROMPT)
    const staged = await stage(actions, PRISM_PROMPT)
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    expect(staged.preview.diagramVerification?.status).toBe("passed")
    const solid = staged.preview.candidate.primitives.find((primitive) => primitive.type === "polyhedron3")
    expect(solid?.type).toBe("polyhedron3")
    if (solid?.type === "polyhedron3") {
      const construction = solid.construction
      if (construction?.kind === "prism") {
        expect(construction.vector.z).toBe(8)
        expect(Math.hypot(construction.vector.x, construction.vector.y, construction.vector.z)).toBeGreaterThan(8)
      }
    }
  })

  it("blocks the side-edge-instead-of-height prism at the draft gate", async () => {
    const actions = [prismAction({ x: Math.sqrt(48), y: 0, z: 4 })]
    const compiled = compile(actions, PRISM_PROMPT)
    const staged = await stage(actions, PRISM_PROMPT)
    expect(compiled.ok).toBe(false)
    expect(staged.ok).toBe(false)
    if (!staged.ok) expect(staged.planDiagnostics?.some((entry) => /高|height/i.test(entry.detail))).toBe(true)
  })

  it("fails closed on unsupported explicit values at the draft gate", async () => {
    const actions = [sphereAction({ x: 0, y: 0, z: 0 }, 2)]
    const staged = await stage(actions, "画一个球体，半径 1/2")
    expect(staged.ok).toBe(false)
    if (!staged.ok) expect(staged.planDiagnostics?.some((entry) => /分数|不支持/.test(entry.detail))).toBe(true)
  })

  it("blocks a correct sphere plus an extra cube as unclear ownership", async () => {
    const cube = { actionId: "solid.create_template", actionKey: "cube", factIds: [], inputs: { alias: "cube", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } } }
    const staged = await stage([sphereAction({ x: 1, y: 2, z: 3 }, 5), cube], SPHERE_PROMPT)
    expect(staged.ok).toBe(false)
    if (!staged.ok) expect(staged.planDiagnostics?.some((entry) => /归属|一个实体|2 个实体/.test(entry.detail))).toBe(true)
  })
})
