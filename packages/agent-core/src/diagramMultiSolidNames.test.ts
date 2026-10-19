import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **两只闭合多面体的点名表**（2026-10-19 联考 `joint-02`）。
 *
 * 现场读数：计划里建了**两只闭合多面体**，候选图也确实画出来了（30 个图元），
 * 但核验器说"说不清题面说的是哪一只，题面的点名因此对不上图上的顶点" —— 于是整题停在未核验。
 *
 * 这条守卫的初衷是对的（只建一只时，别名 → 那只多面体的映射是唯一的）。但它把
 * "**多只**"也一起判成了不可靠，而真正的不变量是：**同一份计划按顺序执行**，所以
 * 第 i 笔闭合多面体物化出来的就是第 i 只新多面体 —— 这条顺序纪律在 `solid.create_segment`、
 * `solid.fold` 那几处都已经在用，没有理由在这里换成"数量必须恰好一个"。
 *
 * 判据两条、方向相反：
 * - 每一笔都带**互不冲突**的点名 ⇒ 两张表合并，两条长度题设都核得出来；
 * - 两只多面体用了**同一个点名** ⇒ 仍然拒绝（那是题面/计划自己错了，不能靠合并掩盖）。
 */
const PROMPT = "三棱锥 A-BCD 与三棱锥 E-FGH 中，AB=3，EF=3。"

/** 四面体（4 个顶点、4 个三角面）。 */
const tetra = (key: string, names: readonly string[], origin: { x: number; y: number; z: number }) => ({
  actionId: "solid.create_polyhedron",
  actionKey: `tetra-${key}`,
  factIds: [],
  inputs: {
    alias: `tetra-${key}`,
    vertexNames: names,
    vertices: [
      { x: origin.x, y: origin.y, z: origin.z },
      { x: origin.x + 3, y: origin.y, z: origin.z },
      { x: origin.x, y: origin.y + 3, z: origin.z },
      { x: origin.x, y: origin.y, z: origin.z + 3 }
    ],
    faces: [
      [0, 1, 2],
      [0, 1, 3],
      [0, 2, 3],
      [1, 2, 3]
    ]
  }
})

function plan(actions: readonly unknown[]): PlanEnvelope {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "两只三棱锥", factIds: [], actions } as unknown as PlanEnvelope
}

function run(actions: readonly unknown[]) {
  return compilePlan(plan(actions), {
    document: createEmptyDocument("geometry3d"),
    prompt: PROMPT,
    conversationId: "multi-solid-names",
    documentGeneration: 0
  })
}

const checksOf = (result: ReturnType<typeof run>): string =>
  (result.diagramVerification?.checks ?? []).map((check) => `${check.sourceText} => ${check.status}: ${check.reason}`).join(" || ")

describe("两只闭合多面体：点名表按执行顺序配对", () => {
  it("两只都带互不冲突的点名 ⇒ 两条长度题设都核得出来", () => {
    const result = run([
      tetra("t1", ["A", "B", "C", "D"], { x: 0, y: 0, z: 0 }),
      tetra("t2", ["E", "F", "G", "H"], { x: 10, y: 0, z: 0 })
    ])

    expect(result.ok, `诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}: ${entry.detail}`).join("；")}`).toBe(true)
    expect(result.diagramVerification?.status, checksOf(result)).toBe("passed")
    expect(
      (result.diagramVerification?.checks ?? []).map((check) => `${check.sourceText}:${check.status}`).sort(),
      checksOf(result)
    ).toEqual(["AB=3:passed", "EF=3:passed"])
  })

  it("**两只用同一个点名** ⇒ 仍然拒绝（合并不能掩盖冲突）", () => {
    const result = run([
      tetra("t1", ["A", "B", "C", "D"], { x: 0, y: 0, z: 0 }),
      tetra("t3", ["A", "F", "G", "H"], { x: 10, y: 0, z: 0 })
    ])

    const report = result.diagramVerification
    expect(report?.status, checksOf(result)).toBe("unverified")
    const reasons = (report?.checks ?? []).map((check) => check.reason).join(" ")
    expect(reasons, checksOf(result)).toContain("重复")
  })
})
