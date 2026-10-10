import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **面环共面容差**（2026-10-10 用户现场）。
 *
 * 现场报错原文：`compile_failed: degenerate_polyhedron: action_compile: envelope.actions[0]:
 * polygon face vertices must be coplanar`。根因是**同一件事两个写法**：棱柱那条早就用
 * **按尺度**的容差（`scale * 1e-9`），而多面体的面环用 `areCoplanar` 的默认**绝对** `1e-10` ——
 * 于是模型自己算的坐标（末位差 1e-9）做成棱柱能过、做成多面体被拒，而它只有一次修复机会。
 *
 * 这份判据钉在**管线层**（`compilePlan`）：不是"内核函数返回什么"，而是**用户那次失败**
 * 到底还发不发生、以及再发生时那句话有没有用。
 *
 * 夹具与 `planCompiler.test.ts` 的 `PYRAMID_VERTICES` / `PYRAMID_FACES` 逐字同源
 *（绕向是暴力搜出来的合法组合，拓扑别手推）。
 */
const PYRAMID_VERTICES = [
  { x: 0, y: 0, z: 4 }, // P
  { x: 0, y: 0, z: 0 }, // A
  { x: 2, y: 0, z: 0 }, // B
  { x: 2, y: 3, z: 0 }, // C
  { x: 0, y: 3, z: 0 } // D
]
const PYRAMID_FACES = [[1, 2, 3, 4], [0, 2, 1], [0, 3, 2], [0, 4, 3], [0, 1, 4]]
const PROMPT = "在四棱锥 P-ABCD 中，画出这个四棱锥"

function planWith(vertices: unknown[]): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "画示意图",
    factIds: [],
    actions: [{ actionId: "solid.create_polyhedron", actionKey: "pyramid", factIds: [], inputs: { alias: "pyramid", vertexNames: ["P", "A", "B", "C", "D"], vertices, faces: PYRAMID_FACES } }]
  } as unknown as PlanEnvelope
}

const compile = (vertices: unknown[]) =>
  compilePlan(planWith(vertices), { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "coplanar", documentGeneration: 0 })

describe("面环共面容差（用户现场：degenerate_polyhedron）", () => {
  it("**末位的小数差不再被拒**：底面四点差 1e-9 照样编译通过", () => {
    const sloppy = [PYRAMID_VERTICES[0], PYRAMID_VERTICES[1], PYRAMID_VERTICES[2], PYRAMID_VERTICES[3], { ...PYRAMID_VERTICES[4], z: 1e-9 }]

    const result = compile(sloppy)

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.draftDocument?.primitives.some((primitive) => primitive.type === "polyhedron3")).toBe(true)
  })

  it("**真的不共面照旧拒**，而且报错说清哪个环、偏多少", () => {
    const broken = [PYRAMID_VERTICES[0], PYRAMID_VERTICES[1], PYRAMID_VERTICES[2], PYRAMID_VERTICES[3], { ...PYRAMID_VERTICES[4], z: 0.5 }]

    const result = compile(broken)

    expect(result.ok).toBe(false)
    const detail = JSON.stringify(result.diagnostics)
    // 环下标 + "偏了多少"：模型那唯一一次修复就靠这两样东西。
    expect(detail).toContain("[1,2,3,4]")
    expect(detail).toMatch(/deviation/i)
  })
})
