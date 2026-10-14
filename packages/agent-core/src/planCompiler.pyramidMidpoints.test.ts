import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **形状 × 构造矩阵：棱锥 × 中点**（2026-10-15，接用户那句"下次是棱锥怎么办"）。
 *
 * ## 先说清一件事（这是本轮量出来的事实）
 *
 * 带**点名**的立体动作只有四种：`solid.create_prism` / `solid.create_face` /
 * `solid.create_polyhedron` / 折面那一条 —— 补点的宿主判据（"输入里带 ≥3 个点名"）覆盖的正是它们。
 * 而 `solid.create_template`（正棱锥 / 正四面体 / 圆台 / 球）与 `solid.create_round_frustum`
 * 的字段里**根本没有点名**（只有 center / radius / height）—— 题面里的 `P、A、B、C、D`
 * 不可能从那种动作来。所以"棱锥"有两副面孔：
 *
 * - **带点名的棱锥**（本合同里由多面体/面片建出来，题面点名才有意义）⇒ 补点**通**（本文件即证据）；
 * - **模板生成的棱锥/圆柱/圆锥**（没有点名）⇒ 补点无从谈起，**那是另一类缺口**（见下）。
 *
 * ## 用例
 *
 * 底面正方形 `ABCD`、顶点 `P`，题面点名 `E、F 分别为 PA 和 BC 的中点` —— 两个点都要补出来，
 * 且第二遍核验必须通过（救援只在通过时才保留生成物）。
 */
const A = { x: 0, y: 0, z: 0 }
const B = { x: 2, y: 0, z: 0 }
const C = { x: 2, y: 2, z: 0 }
const D = { x: 0, y: 2, z: 0 }
const P = { x: 1, y: 1, z: 4 }

const PLAN: PlanEnvelope = {
  schemaVersion: PLAN_SCHEMA_VERSION,
  kind: "plan",
  goal: "四棱锥 P-ABCD",
  factIds: [],
  actions: [{
    actionId: "solid.create_polyhedron",
    actionKey: "pyramid",
    factIds: [],
    inputs: {
      alias: "pyramid",
      vertexNames: ["A", "B", "C", "D", "P"],
      vertices: [A, B, C, D, P],
      faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
      label: "四棱锥 P-ABCD"
    }
  }]
} as unknown as PlanEnvelope

const PROMPT = "在四棱锥P-ABCD中，E、F分别为PA和BC的中点。"

describe("形状 × 构造矩阵：棱锥 × 中点", () => {
  it("带点名的棱锥：E、F 由系统补出来，落点由测试自己算", () => {
    const result = compilePlan(PLAN, { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "pyramid-midpoints", documentGeneration: 0 })
    const why = result.diagramVerification === undefined
      ? `没有核验报告；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}: ${entry.detail}`).join("；")}`
      : result.diagramVerification.checks.map((check) => `${check.sourceText}:${check.status}`).join("；")
    expect(result.ok, why).toBe(true)
    expect(result.diagramVerification?.status, why).toBe("passed")

    const draft = result.draftDocument!
    const positionOf = (label: string) => {
      const primitive = draft.primitives.find((candidate) => candidate.type === "point3" && (candidate as { label?: string }).label === label)
      return (primitive as { position?: { x: number; y: number; z: number } } | undefined)?.position
    }
    // PA 的中点 = (0.5, 0.5, 2)；BC 的中点 = (2, 1, 0) —— 测试自己算，不读图元自报。
    expect(positionOf("E"), `草稿点名：${draft.primitives.filter((p) => p.type === "point3").map((p) => (p as { label?: string }).label).join(",")}`).toMatchObject({ x: 0.5, y: 0.5, z: 2 })
    expect(positionOf("F")).toMatchObject({ x: 2, y: 1, z: 0 })
  })

  /**
   * **另一类缺口，如实钉住**：模板生成的立体**没有点名**（字段里就没有这个名字表），
   * 所以题面点名 `E 为 PA 的中点` 时系统**无从补起** —— 这不是"漏了一种形状"，
   * 而是"那条路径上根本没有名字可用"。等它被补上（要么模板也接受点名，要么给曲线上的点
   * 另开一条按参数取点的补建），把这条断言改成"能补出来"。
   */
  it("模板生成的棱锥没有点名 ⇒ 补点无从谈起（如实记下这条边界）", () => {
    const templatePlan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "正四棱锥",
      factIds: [],
      actions: [{ actionId: "solid.create_regular_pyramid", actionKey: "pyramid", factIds: [], inputs: { alias: "pyramid", baseCenter: { x: 0, y: 0, z: 0 }, sides: 4, radius: 2, height: 4, label: "正四棱锥" } }]
    } as unknown as PlanEnvelope

    const result = compilePlan(templatePlan, { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "template-pyramid", documentGeneration: 0 })
    // 名字补不出来 ⇒ 这一轮不可能通过（如实失败，而不是假装核验过）。
    expect(result.diagramVerification?.status ?? "unverified", "模板立体没有点名，补点无从谈起").not.toBe("passed")
  })
})
