import { describe, expect, it } from "vitest"

import { canonicalContentHash, newDraftId, newRunId, parsePlanEnvelope, parseDraftAction } from "./schemas"
import type { DocumentHandle } from "./contracts"

const HANDLE: DocumentHandle = {
  projectId: "project-1",
  documentId: "document-1",
  workspace: "geometry3d",
  epoch: "epoch-1",
  generation: 7,
  contentHash: "hash-1"
}

/** 附录 A 的示例：画一个边长 4 的立方体 + z=2 的水平截面。它是"必须被接受"的基准。 */
function validPlan(): unknown {
  return {
    schemaVersion: "mathcanvas.plan.v1",
    kind: "plan",
    goal: "创建立方体及水平截面",
    factIds: ["size-four", "section-height-two"],
    actions: [
      {
        actionId: "solid.create_template",
        actionKey: "create-solid",
        inputs: { alias: "solid", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 4, y: 4, z: 4 } },
        factIds: ["size-four"]
      },
      {
        actionId: "section.create",
        actionKey: "create-section",
        // `SectionCreateAction` 收的是**同文档内的裸 id**（动作层用 `findPrimitive` 查），
        // 不是带 documentId 的作用域引用。这条夹具此前写成 `source: { scope: "draft", … }`，
        // 与动作层的真实形状不符 —— 登记表修正后才暴露出来。
        inputs: { alias: "cut", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: -2 } },
        factIds: ["section-height-two"]
      }
    ]
  }
}

/** 解析失败时应当带一个稳定的错误码，方便 Agent 侧据此走"可见修复"路径。 */
function expectRejected(result: { ok: boolean; errors?: { code: string; path: string }[] }, code: string) {
  expect(result.ok, `expected rejection with ${code}`).toBe(false)
  expect(result.errors?.some((error) => error.code === code), `missing ${code} in ${JSON.stringify(result.errors)}`).toBe(true)
}

describe("plan envelope parsing", () => {
  it("accepts the appendix A plan", () => {
    const result = parsePlanEnvelope(validPlan())
    expect(result.ok).toBe(true)
    if (result.ok && result.value.kind === "plan") {
      expect(result.value.actions).toHaveLength(2)
    } else {
      throw new Error("expected a plan branch")
    }
  })

  it("rejects an unknown kind", () => {
    expectRejected(parsePlanEnvelope({ ...(validPlan() as object), kind: "not-a-plan" }), "unknown_kind")
  })

  it("rejects unknown top-level fields", () => {
    expectRejected(parsePlanEnvelope({ ...(validPlan() as object), authorised: true }), "unknown_field")
  })

  it("rejects unknown fields inside an action", () => {
    const plan = validPlan() as { actions: Record<string, unknown>[] }
    plan.actions[0].mayCommit = true
    expectRejected(parsePlanEnvelope(plan), "unknown_field")
  })

  it("rejects an unknown action id", () => {
    const plan = validPlan() as { actions: Record<string, unknown>[] }
    plan.actions[0].actionId = "solid.explode"
    expectRejected(parsePlanEnvelope(plan), "unknown_action")
  })

  it("rejects a duplicate action key within one run", () => {
    const plan = validPlan() as { actions: Record<string, unknown>[] }
    plan.actions[1].actionKey = plan.actions[0].actionKey
    expectRejected(parsePlanEnvelope(plan), "duplicate_action_key")
  })

  it("rejects non-finite numbers", () => {
    const plan = validPlan() as { actions: { inputs: { size?: { x: number } } }[] }
    plan.actions[0].inputs.size!.x = Number.POSITIVE_INFINITY
    expectRejected(parsePlanEnvelope(plan), "non_finite_number")
  })

  it("rejects oversized strings", () => {
    expectRejected(parsePlanEnvelope({ ...(validPlan() as object), goal: "x".repeat(2000) }), "string_too_long")
  })

  it("rejects oversized arrays", () => {
    const plan = validPlan() as { actions: unknown[] }
    plan.actions = Array.from({ length: 64 }, (_, index) => ({ ...(plan.actions[0] as object), actionKey: `key-${index}` }))
    expectRejected(parsePlanEnvelope(plan), "array_too_long")
  })

  it("rejects a scoped reference that is missing its scope", () => {
    // `object.update_inputs` 收的是**带 documentId** 的作用域引用（动作层会检查它是否跨文档），
    // 所以"只给 entityId"必须被拒 —— 名称不是 ID（设计规格 §6）。
    const plan = validPlan() as { actions: unknown[] }
    plan.actions[1] = { actionId: "object.update_inputs", actionKey: "rename", factIds: [], inputs: { target: { entityId: "point-1" }, patch: { label: "B" } } }
    expectRejected(parsePlanEnvelope(plan), "unscoped_reference")
  })

  it("rejects a plan branch without actions", () => {
    expectRejected(parsePlanEnvelope({ ...(validPlan() as object), actions: [] }), "empty_actions")
  })
})

describe("draft action parsing", () => {
  it("accepts a single well-formed action", () => {
    const action = (validPlan() as { actions: unknown[] }).actions[0]
    const result = parseDraftAction(action)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.actionKey).toBe("create-solid")
  })

  it("rejects a raw domain operation masquerading as an action", () => {
    expectRejected(parseDraftAction({ op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 0, y: 0 } }), "unknown_action")
  })

  it("rejects an unscoped scene reference", () => {
    // 既有实体必须写成 {scope:"scene", ref:{documentId,entityId}}；只给 entityId 不算数。
    expectRejected(parseDraftAction({ actionId: "object.update_inputs", actionKey: "delete", inputs: { target: { entityId: "point-1" }, patch: { label: "x" } }, factIds: [] }), "unscoped_reference")
  })
})

describe("deterministic ids and hashes", () => {
  it("mints distinct, prefixed ids", () => {
    const runIds = new Set(Array.from({ length: 50 }, () => newRunId()))
    expect(runIds.size).toBe(50)
    expect([...runIds][0]).toMatch(/^run_/)
    expect(newDraftId()).toMatch(/^draft_/)
  })

  it("hashes canonical content stably and ignores key order", () => {
    const left = canonicalContentHash({ b: 1, a: { d: 4, c: 3 } })
    const right = canonicalContentHash({ a: { c: 3, d: 4 }, b: 1 })
    expect(left).toBe(right)
    expect(left).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changes the hash when geometry changes", () => {
    const before = canonicalContentHash({ primitives: [{ id: "p1", x: 0 }] })
    const after = canonicalContentHash({ primitives: [{ id: "p1", x: 1 }] })
    expect(after).not.toBe(before)
  })

  it("excludes runtime-only and view-only keys from the hash", () => {
    const withNoise = canonicalContentHash({ geometry: { radius: 2 }, viewport: { scale: 9 }, updatedAt: 123, logs: ["x"] })
    const clean = canonicalContentHash({ geometry: { radius: 2 } })
    expect(withNoise).toBe(clean)
  })

  it("includes the semantic document handle identity", () => {
    const base = canonicalContentHash({ handle: HANDLE, geometry: { radius: 2 } })
    const otherGeneration = canonicalContentHash({ handle: { ...HANDLE, generation: 8 }, geometry: { radius: 2 } })
    expect(otherGeneration).not.toBe(base)
  })
})
