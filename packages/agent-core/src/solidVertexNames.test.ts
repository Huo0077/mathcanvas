import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"
import { SKILL_MANIFESTS } from "./skills/manifest"

/**
 * **用户现场（2026-10-15）：四棱锥 P-ABCD 那一轮为什么停在"题设尚未核验"**。
 *
 * 现场读数三条，本文件逐条给出原因：
 *
 * 1. `PD ⊥ 平面 ABCD：候选图缺少唯一、可靠的顶点名映射` —— **真的缺映射**，但那一句话
 *    说不清缺的是什么。实测（本轮复现）：`solid.create_polyhedron`（或 `solid.create_face`）
 *    的 `vertexNames` 是**可选字段**，模型不给也照样编译通过 —— 于是图上的顶点只有模板编号
 *    `P1…P5`，题面里的 `A/B/C/D/P` 对不上任何东西；而核验层只会说"缺少唯一、可靠的顶点名映射"，
 *    八个不同的守卫共用这一句话。**所以第一条修的是"让它说清是哪一种缺"。**
 * 2. `E、F 分别为棱 AB、PB 的中点：未被可靠解析` —— **真缺口**：并列中点那条读取器收
 *    `E、F 分别为 AC 和 CC₁ 的中点`，但**不吃"棱"字**。卷面上"棱 AB"是最常见的写法之一。
 * 3. 两句合起来才是现场的全部：**即使模型给对点名，第 2 条也会把 E、F 丢掉**（它们是补点的入口）。
 *
 * 判据一律**自己算**：中点坐标由测试按顶点坐标现算，不读图元自报。
 */
const PROMPT = `四棱锥 P-ABCD 的底面是边长为 2 的正方形，
PD ⊥ 平面 ABCD，且 PD = 2。
E、F 分别为棱 AB、PB 的中点。

（1）证明：EF ∥ 平面 PAD。`

// A(2,0,0) B(2,2,0) C(0,2,0) D(0,0,0) P(0,0,2)：底面是边长 2 的正方形、PD ⊥ 底面、PD = 2。
const vertices = [{ x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }]
const faces = [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]

function plan(actions: readonly unknown[]): PlanEnvelope {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "四棱锥 P-ABCD", factIds: [], actions } as unknown as PlanEnvelope
}

const polyhedron = (vertexNames?: readonly string[]) => ({
  actionId: "solid.create_polyhedron",
  actionKey: "pyramid",
  factIds: [],
  inputs: { alias: "pyramid", vertices, faces, label: "四棱锥 P-ABCD", ...(vertexNames === undefined ? {} : { vertexNames }) }
})
/** 一只**没有点名**的面片（模型为了让"平面 PAD"看得见常常顺手补一笔）。 */
const namelessFace = { actionId: "solid.create_face", actionKey: "pad", factIds: [], inputs: { alias: "pad", vertices: [vertices[4], vertices[0], vertices[3]], label: "平面 PAD" } }

function run(actions: readonly unknown[]) {
  return compilePlan(plan(actions), { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "solid-names", documentGeneration: 0 })
}

function checksOf(result: ReturnType<typeof run>): string {
  return (result.diagramVerification?.checks ?? []).map((check) => `${check.sourceText} => ${check.status}: ${check.reason}`).join(" || ")
}

function reasonFor(result: ReturnType<typeof run>, sourceText: string): string {
  const check = result.diagramVerification?.checks.find((entry) => entry.sourceText.includes(sourceText))
  expect(check, checksOf(result)).toBeDefined()
  return check!.reason
}

describe("现场那道四棱锥：点名对不上图上的顶点时，系统要说清缺的是什么", () => {
  it("`E、F 分别为棱 AB、PB 的中点` 读得出来（**带「棱」字**，一句话两条 midpoint）", () => {
    const parsed = parseDiagramObligations(PROMPT)
    const midpoints = parsed.givens.filter((item) => item.kind === "midpoint")
    expect(midpoints.map((item) => item.targets), `给定：${JSON.stringify(parsed.givens.map((i) => [i.kind, i.targets]))}；未核验：${JSON.stringify(parsed.unverified.map((u) => u.sourceText))}`).toEqual([["E", "A", "B"], ["F", "P", "B"]])
    expect(parsed.unverified.some((entry) => entry.sourceText.includes("中点"))).toBe(false)
  })

  it("带点名的多面体 + 这段原话 ⇒ 整轮通过，E、F 由系统补出来（落点**测试自己算**）", () => {
    const result = run([polyhedron(["A", "B", "C", "D", "P"])])
    expect(result.ok, `诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}: ${entry.detail}`).join("；")}`).toBe(true)
    expect(result.diagramVerification?.status, checksOf(result)).toBe("passed")

    const draft = result.draftDocument!
    const positionOf = (label: string) => {
      const primitive = draft.primitives.find((candidate) => candidate.type === "point3" && (candidate as { label?: string }).label === label)
      return (primitive as { position?: { x: number; y: number; z: number } } | undefined)?.position
    }
    // AB 的中点 = (2, 1, 0)；PB 的中点 = (1, 1, 1) —— 自己算。
    expect(positionOf("E"), `草稿点名：${draft.primitives.filter((p) => p.type === "point3").map((p) => (p as { label?: string }).label).join(",")}`).toMatchObject({ x: 2, y: 1, z: 0 })
    expect(positionOf("F")).toMatchObject({ x: 1, y: 1, z: 1 })
  })

  it("**没有点名**的多面体 ⇒ 未核验，理由点名缺的是 `vertexNames`（而不是一句放之四海皆准的话）", () => {
    const result = run([polyhedron()])
    const reason = reasonFor(result, "PD ⊥ 平面 ABCD")
    expect(reason, reason).toContain("vertexNames")
    expect(reason, reason).toContain("没有带点名")
  })

  it("**没有点名**的面片 ⇒ 未核验，理由同样点名 `vertexNames`（多面体带了名也不行）", () => {
    const result = run([polyhedron(["A", "B", "C", "D", "P"]), namelessFace])
    const reason = reasonFor(result, "PD = 2")
    expect(reason, reason).toContain("vertexNames")
    expect(reason, reason).toContain("面片")
  })

  it("**模型读的那份技能说明**也把这条写进去了（现场那一轮就是没写名字）", () => {
    /**
     * 判据为什么长这样：模型的**唯一**依据是这份技能说明（`summary` 会进提示词），
     * 而"题面点名了顶点就必须给 `vertexNames`"此前**一个字都没写**（只有 `solid.fold` 那条写了"必填"）。
     * 现场那一轮正是这么停下的。这条断言把它钉住 —— 以后谁把这句话删掉，这里就红。
     */
    const spatial = SKILL_MANIFESTS.find((entry) => entry.id === "spatial-modeling")
    expect(spatial, "技能目录里必须有 spatial-modeling").toBeDefined()
    expect(spatial!.summary, spatial!.summary).toContain("必须用 `vertexNames`")
    expect(spatial!.summary, spatial!.summary).toContain("题设核验一条都过不了")
  })
})
