import { createEmptyDocument } from "@draw/dsl"
import { PLAN_SCHEMA_VERSION, compilePlan, type PlanEnvelope } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { createDraftStore } from "./draftStore"

/**
 * **连等题设：编译与草稿核验必须一致**（2026-10-26）。
 *
 * 用户原题里的 `AD=AB=2CD=2` 曾经被读成 `AD=` + 错误的 AB（见 `lengthEquality.test.ts`），
 * 结果编译器（会临时展开题面）说 passed、草稿层用另一份题面复核说 unverified —— 门禁于是拦下。
 *
 * 这一组从**产品入口**验证：同一份正确计划在 `compilePlan` 与 `DraftStore.stage` 下结论一致；
 * 错误计划（长度改错、中点位置错）两边都**不能**通过。
 */
const PROMPT = "四棱锥 P-ABCD 中，平面 PAD ⊥ 平面 ABCD，AB∥CD，AB⊥AD，M 为 AD 中点，PA=PD=√5，AD=AB=2CD=2。 （1）求证：平面 PMB ⊥ 平面 PAC； （2）求二面角 A-PC-D 的余弦值。"

interface Point { x: number; y: number; z: number }
const A: Point = { x: 0, y: 0, z: 0 }
const B: Point = { x: 0, y: 2, z: 0 }
const C: Point = { x: 2, y: 1, z: 0 }
const D: Point = { x: 2, y: 0, z: 0 }
const M: Point = { x: 1, y: 0, z: 0 }
const P: Point = { x: 1, y: 0, z: 2 }

function plan(overrides: { cd?: number; mParameter?: number } = {}): Extract<PlanEnvelope, { kind: "plan" }> {
  // `CD` 的改动通过移动 C 实现（AD=2、AB=2 不动）。
  const c = overrides.cd === undefined ? C : { x: D.x + overrides.cd, y: 1, z: 0 }
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "画题设示意图",
    factIds: [],
    actions: [
      {
        actionId: "solid.create_polyhedron", actionKey: "solid", factIds: [],
        inputs: {
          alias: "solid",
          vertexNames: ["P", "A", "B", "C", "D"],
          vertices: [P, A, B, c, D],
          faces: [[1, 4, 3, 2], [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1]]
        }
      },
      {
        actionId: "dynamic.create_bound_point", actionKey: "midpoint", factIds: [],
        inputs: { alias: "M", host: { scope: "draft", alias: "solid" }, hostSub: 0, parameter: overrides.mParameter ?? 0.5, label: "M" }
      }
    ]
  } as unknown as Extract<PlanEnvelope, { kind: "plan" }>
}

function compile(built: Extract<PlanEnvelope, { kind: "plan" }>) {
  return compilePlan(built, { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "chain-consistency", documentGeneration: 0 })
}

async function stage(built: Extract<PlanEnvelope, { kind: "plan" }>) {
  const store = createDraftStore()
  const base = createEmptyDocument("geometry3d")
  const record = store.create(base)
  return store.stage(record.draftId, built.actions, record.draftVersion, PROMPT)
}

describe("chain equality: compiler and draft store agree", () => {
  it("accepts the correct plan in both paths, with every condition verified", async () => {
    const built = plan()
    const compiled = compile(built)
    expect(compiled.ok, compiled.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join("; ")).toBe(true)
    expect(compiled.diagramVerification?.status).toBe("passed")
    expect(compiled.diagramVerification?.checks.every((check) => check.status === "passed")).toBe(true)

    const staged = await stage(built)
    expect(staged.ok).toBe(true)
    if (!staged.ok) return
    expect(staged.preview.diagramVerification?.status).toBe("passed")
  })

  it("rejects a plan whose CD length is wrong in both paths", async () => {
    const built = plan({ cd: 2 })
    const compiled = compile(built)
    expect(compiled.diagramVerification?.status).not.toBe("passed")

    const staged = await stage(built)
    if (staged.ok) expect(staged.preview.diagramVerification?.status).not.toBe("passed")
  })

  it("rejects a plan where M is not the midpoint of AD in both paths", async () => {
    const built = plan({ mParameter: 0.4 })
    const compiled = compile(built)
    expect(compiled.diagramVerification?.status).not.toBe("passed")

    const staged = await stage(built)
    if (staged.ok) expect(staged.preview.diagramVerification?.status).not.toBe("passed")
  })
})
