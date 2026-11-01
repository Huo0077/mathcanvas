import { compilePlan, planOf } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { createLocalPlanner } from "./localPlanner"

async function plan(prompt: string) {
  const planner = createLocalPlanner()
  return planOf(await planner.plan({ userMessage: prompt } as never))
}

function prismInputs(envelope: Awaited<ReturnType<typeof plan>>) {
  if (envelope.kind !== "plan") throw new Error(`expected plan, got ${envelope.kind}`)
  return envelope.actions[0]!.inputs as { basePolygon: { x: number; y: number; z: number }[]; vector: { x: number; y: number; z: number } }
}

async function compilePrompt(prompt: string) {
  const envelope = await plan(prompt)
  if (envelope.kind !== "plan") throw new Error(`expected plan, got ${envelope.kind}: ${envelope.kind === "clarification" ? envelope.questions.join(" | ") : ""}`)
  const document = createEmptyDocument("geometry3d")
  return compilePlan(envelope, { document, workspace: "geometry3d", prompt, conversationId: "shape", documentGeneration: document.revision })
}

describe("explicit prism shape semantics", () => {
  it("keeps a straight prism's lateral vector perpendicular to the base", async () => {
    const prompt = "画一个直棱柱，底面边长 4，高 8"
    const inputs = prismInputs(await plan(prompt))
    expect(inputs.vector).toEqual({ x: 0, y: 0, z: 8 })
    const compiled = await compilePrompt(prompt)
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status, JSON.stringify(compiled.diagramVerification)).toBe("passed")
  })

  it("builds a regular square prism with a square base and vertical sides", async () => {
    const prompt = "画一个正四棱柱，底面边长 4，高 8"
    const inputs = prismInputs(await plan(prompt))
    expect(inputs.vector).toEqual({ x: 0, y: 0, z: 8 })
    expect(inputs.basePolygon).toHaveLength(4)
    const compiled = await compilePrompt(prompt)
    expect(compiled.ok).toBe(true)
    expect(compiled.diagramVerification?.status, JSON.stringify(compiled.diagramVerification)).toBe("passed")
  })

  it("asks for clarification for a triangular prism instead of building a quadrilateral one", async () => {
    const envelope = await plan("画一个三棱柱，底面边长 4，高 8")
    expect(envelope.kind).toBe("clarification")
    if (envelope.kind === "clarification") expect(envelope.questions.join(" ")).toMatch(/三|三角形|不支持/)
  })

  it("asks for clarification for a regular hexagonal prism instead of building a quadrilateral one", async () => {
    const envelope = await plan("画一个正六棱柱，底面边长 4，高 8")
    expect(envelope.kind).toBe("clarification")
    if (envelope.kind === "clarification") expect(envelope.questions.join(" ")).toMatch(/六|六边形|不支持/)
  })

  it("keeps an oblique prism's lateral vector off the base normal", async () => {
    const inputs = prismInputs(await plan("画一个斜棱柱，底面边长 4，高 8"))
    expect(inputs.vector).toMatchObject({ x: 1, z: 8 })
    expect(Math.hypot(inputs.vector.x, inputs.vector.y)).toBeGreaterThan(0)
  })
})

describe("complete numeric lexical boundaries through the planner", () => {
  it("asks for clarification for a spaced fraction instead of using 1", async () => {
    const envelope = await plan("画一个球体，半径 1 / 2")
    expect(envelope.kind).toBe("clarification")
    if (envelope.kind === "clarification") expect(envelope.questions.join(" ")).toMatch(/分数/)
  })

  it("asks for clarification for multiplication instead of using 5", async () => {
    const envelope = await plan("画一个球体，半径 5×2")
    expect(envelope.kind).toBe("clarification")
    if (envelope.kind === "clarification") expect(envelope.questions.join(" ")).toMatch(/乘法/)
  })

  it("treats a space between a coefficient and pi as the same 2π expression", async () => {
    const envelope = await plan("画一个球体，半径 2 π")
    expect(envelope.kind).toBe("plan")
    if (envelope.kind === "plan") expect(envelope.actions[0]!.inputs).toMatchObject({ radius: 2 * Math.PI })
    const compiled = await compilePrompt("画一个球体，半径 2 π")
    expect(compiled.diagramVerification?.status).toBe("passed")
  })

  it("ask for clarification for internal whitespace in a coordinate instead of concatenating 12", async () => {
    const envelope = await plan("画一个球体，球心 (1 2,3,4)，半径 5")
    expect(envelope.kind).toBe("clarification")
    if (envelope.kind === "clarification") expect(envelope.questions.join(" ")).toMatch(/坐标|十进制/)
  })
})
