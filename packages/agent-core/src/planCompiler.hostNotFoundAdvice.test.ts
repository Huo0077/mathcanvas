import { describe, expect, it } from "vitest"
import { createEmptyDocument } from "@draw/dsl"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"

import { compilePlan, describeCompileRepairPrompt } from "./planCompiler"

/**
 * **宿主引用指向不存在的实体**（2026-10-19 联考 `joint-06`）。
 *
 * 现场读数：计划后两笔引用了 `solid-1:e0` —— 一个**不存在的别名**，编译期报 `host_not_found`，
 * 整题 0 图元。这是**计划侧**的错误（模型凭空拼了一个 id），不是几何能力不足；修复提示要说清
 * "别名必须是前面某一笔真的给出过的名字"，否则下一轮它还会拼一个新的。
 *
 * 反向判据：提示里**不能**出现"随便给个已有点顶着"这种诱导 —— 找不到宿主时该补的是
 * **建那个宿主的那一笔**，或者换成已有点名走 `solid.create_segment` / `solid.create_point`。
 */
describe("host not found advice", () => {
  it("tells the model the host must be built by an earlier action, not invented", () => {
    const hint = describeCompileRepairPrompt({
      reason: "schema_invalid",
      errors: [{ code: "host_not_found", path: "envelope.actions[1]", detail: "no host solid-1:e0" }],
      allowedChanges: [],
      attempt: 1
    })

    expect(hint).toContain("真的存在")
    expect(hint).toContain("scope")
    expect(hint).toContain("前面")
    expect(hint).toContain("solid.create_segment")
  })
})

/** Synthetic joint-06 mechanism; the original exam prompt is unavailable. */
it("rejects a synthetic invented edge alias instead of staging any draft", () => {
  const plan = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "draw a tetrahedron and point", factIds: [], actions: [
    { actionId: "solid.create_polyhedron", actionKey: "solid", factIds: [], inputs: {
      alias: "solid", vertices: [{ x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }],
      faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
    } },
    { actionId: "dynamic.create_bound_point", actionKey: "ghost", factIds: [], inputs: { alias: "ghost", host: { scope: "draft", alias: "solid-1:e0" }, hostSub: 0, parameter: 0.5 } }
  ] } as unknown as PlanEnvelope
  const base = createEmptyDocument("geometry3d")
  const result = compilePlan(plan, { document: base, conversationId: "synthetic-joint-06", documentGeneration: base.revision })
  expect(result.ok).toBe(false)
  expect(result.draftDocument).toBeNull()
  expect(result.diagnostics.some(item => item.code === "unresolved_alias"), JSON.stringify(result.diagnostics)).toBe(true)
  const hint = describeCompileRepairPrompt({ reason: "schema_invalid", errors: result.diagnostics, allowedChanges: [], attempt: 1 })
  expect(hint).toContain("真的存在")
  expect(base.primitives).toHaveLength(0)
})
