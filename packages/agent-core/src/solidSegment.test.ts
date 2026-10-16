import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compilePlan } from "./planCompiler"

/**
 * **立体里"两点连成一条线段"**（2026-10-15 用户现场，四棱锥那道题的 `EF`）。
 *
 * ## 为什么要有这个动作
 *
 * 立体几何里此前**没有**它：模型要画 `EF`、`BD` 这类线，只能拿 `planar.create_segment` 去凑，
 * 而那条落在 `z=0` 上 —— `planCompiler` 甚至专门劝它"别这么干"（那条提示是对的），
 * 于是模型**无处可去**。现场那道四棱锥题正是卡在这里。
 *
 * ## 判据：物化成 `segment3`，两端是**文档里那两个点**
 *
 * 不给坐标 —— 两端按点名从文档取（题面点名的顶点、棱上的分点、折出来的点）。
 * 所以用例不读"动作写没写"，而是读**最终文档**：那条 `segment3` 的两个端点 `pointIds`
 * 必须**就是**标着 `E`、`F` 的那两个 `point3`。
 *
 * ## 失败要 fail-closed
 *
 * 点名少一个/重复/在文档里找不到 ⇒ **一条图元都不产出**，并说清是**哪些**名字没找到
 *（与其余动作同一条纪律：宁可不做，也不做一半）。
 */
const PROMPT = "画出四边形 ABCD，并在 AD、AB 上各取一点 E、F，连接 EF。"

/** 一个四边形（带点名）+ 两个按定比分点绑上去的点（`E`、`F`）。 */
const flatActions = [
  {
    actionId: "solid.create_face",
    actionKey: "quad",
    factIds: [],
    inputs: {
      alias: "quad",
      vertexNames: ["A", "B", "C", "D"],
      vertices: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }],
      label: "四边形 ABCD"
    }
  },
  { actionId: "dynamic.create_bound_point", actionKey: "E", factIds: [], inputs: { alias: "E", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "D" }, parameter: 0.5, label: "E" } },
  { actionId: "dynamic.create_bound_point", actionKey: "F", factIds: [], inputs: { alias: "F", host: { scope: "draft", alias: "quad" }, hostEdge: { from: "A", to: "B" }, parameter: 0.5, label: "F" } }
]

const segmentAction = (vertexNames: string[], label = "EF") =>
  ({ actionId: "solid.create_segment", actionKey: "ef", factIds: [], inputs: { alias: "ef", vertexNames, label } })

function run(actions: readonly unknown[]) {
  const plan = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "连 EF", factIds: [], actions } as unknown as PlanEnvelope
  return compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "solid-segment", documentGeneration: 0 })
}

const pointId = (result: ReturnType<typeof run>, label: string): string | undefined =>
  result.draftDocument?.primitives.find((primitive) => primitive.type === "point3" && (primitive as { label?: unknown }).label === label)?.id

describe("立体里的线段动作：`solid.create_segment` 按点名连两个已有点", () => {
  it("连 `EF` ⇒ 文档里出现一条 `segment3`，两端就是标着 `E`、`F` 的那两个点", () => {
    const result = run([...flatActions, segmentAction(["E", "F"])])
    const why = `ok=${result.ok}；诊断：${result.diagnostics.map((entry) => `${entry.code}@${entry.path}: ${entry.detail}`).join(" || ")}`

    expect(result.ok, why).toBe(true)
    const segment = result.draftDocument?.primitives.find((primitive) => primitive.type === "segment3")
    expect(segment, why).toBeDefined()
    // 端点必须**就是**那两个已有点（不是另造两个坐标相同的点）。
    const ids = (segment as { pointIds?: string[] }).pointIds
    expect(ids, why).toEqual([pointId(result, "E"), pointId(result, "F")])
    expect(pointId(result, "E"), why).toBeDefined()
    expect(((segment as { label?: string }).label), why).toBe("EF")
  })

  /**
   * **点名找不到就一条图元都不产出**，并说清是**哪一个**名字 —— 不许猜、也不许只做一半。
   */
  it("点名在文档里不存在 ⇒ 整笔被拒，理由点名是 `Z`", () => {
    const result = run([...flatActions, segmentAction(["E", "Z"])])
    const why = result.diagnostics.map((entry) => `${entry.code}@${entry.path}: ${entry.detail}`).join(" || ")

    expect(result.ok, why).toBe(false)
    expect(why, why).toContain("Z")
    // 没有草稿 ⇒ 也就没有半条线段。
    const segments = (result.draftDocument?.primitives ?? []).filter((primitive) => primitive.type === "segment3")
    expect(segments, why).toEqual([])
  })

  it("两个端点写成同一个点 ⇒ 被拒（一条线段的两个端点不能是同一点）", () => {
    const result = run([...flatActions, segmentAction(["E", "E"])])
    const why = result.diagnostics.map((entry) => `${entry.code}@${entry.path}: ${entry.detail}`).join(" || ")

    expect(result.ok, why).toBe(false)
  })
})
