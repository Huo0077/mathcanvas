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

  /**
   * **名字非法时，理由要指名道姓**（2026-10-15 用户现场：那句"给了 3 个名字、面有 3 个顶点"
   * 在**个数相等**时指不出真凶，真因是弯撇；撇的变体现在已在入口归一，但别的非法写法
   *（小写、全角）仍要能一眼看出是哪一个名字）。
   */
  it("名字**非法**时，理由点名是哪一个（不再只说给了几个）", () => {
    const result = run([polyhedron(["A", "B", "C", "D", "p"])])
    const reason = reasonFor(result, "PD = 2")
    expect(reason, reason).toContain("不是合法点名")
    expect(reason, reason).toContain("`p`")
  })

  /**
   * **模型把下标写成数字**（`A2` 而不是 `A₂`）—— 2026-10-15 用户现场（正四棱柱 A₂B₂C₂D₂）。
   *
   * 现场那条诊断已经把真凶点名出来了（`**不是合法点名**的是 A2、B2、C2、D2`），而题面里写的是
   * **下标** ⇒ 与"弯撇"同一类：**同一个名字的两种写法**。题面那一侧的契约（`A1` 必须留在
   * "读不出"侧）**一个字没动**；这里归一的只是**计划里那份名字表**。
   *
   * 判据两条：① 不再报"与它的顶点对不上"（表建起来了）；② `AA₂=1` 这类条件因此**核得出来**
   *（`A` 来自棱柱、`A₂` 来自那一笔面片）。
   */
  it("**下标写成数字**（`A2`）时名字照样对得上，条件核得出来", () => {
    const prompt = "正四棱柱 ABCD-A₁B₁C₁D₁ 中，AB=2，AA₁=4。点 A₂,B₂,C₂,D₂ 分别在棱 AA₁,BB₁,CC₁,DD₁ 上，且 AA₂=1，BB₂=2。"
    const A = { x: 0, y: 0, z: 0 }
    const B = { x: 2, y: 0, z: 0 }
    const C = { x: 2, y: 2, z: 0 }
    const D = { x: 0, y: 2, z: 0 }
    const actions = [
      { actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: { alias: "prism", basePolygon: [A, B, C, D], vector: { x: 0, y: 0, z: 4 }, vertexNames: ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"], label: "正四棱柱" } },
      // 截面那个四边形：**名字用 ASCII 数字**（现场那一笔就是这个形状）。
      { actionId: "solid.create_face", actionKey: "cut", factIds: [], inputs: { alias: "cut", vertices: [{ x: 0, y: 0, z: 1 }, { x: 2, y: 0, z: 2 }, { x: 2, y: 2, z: 3 }, { x: 0, y: 2, z: 2 }], vertexNames: ["A2", "B2", "C2", "D2"], label: "截面 A₂B₂C₂D₂" } }
    ]
    const result = compilePlan(
      { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "正四棱柱截面", factIds: [], actions } as unknown as PlanEnvelope,
      { document: createEmptyDocument("geometry3d"), prompt, conversationId: "digit-suffix", documentGeneration: 0 }
    )
    const checks = result.diagramVerification?.checks ?? []
    const why = `ok=${result.ok}；诊断：${result.diagnostics.map((entry) => `${entry.code}: ${entry.detail}`).join(" || ")}；核验：${checks.map((check) => `${check.sourceText} => ${check.status}`).join(" | ")}`

    expect(checks.map((check) => check.reason).join("｜"), why).not.toContain("与它的顶点对不上")
    // `AA₂=1` 归一之后找得到两个端点：`A` 在棱柱上、(0,0,1) 那个点归一后叫 `A₂`。
    const length = checks.find((check) => check.sourceText.startsWith("AA₂=1"))
    expect(length?.status, why).toBe("passed")
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

  /**
   * **"平面图形 + 分点 + 沿某条线翻折"这类题的计划骨架与顺序**（2026-10-15 用户现场）。
   *
   * 现场反复出现的两个错：拿 `solid.create_polyhedron` 去套**平面四边形**（"开放图形不要拼闭合体"
   * 这条提示它已经忽略四次），以及把**连线段排在建点之前**。两者都是**结构**问题 ——
   * 写进技能说明是"**第一次就写对**"的那条路，而不是花掉修复轮（那一轮正是预算耗尽的那一轮）。
   *
   * 这条断言把骨架钉住：以后谁把这段删掉，这里就红。
   */
  it("**技能说明里写清了这类题的计划骨架与顺序**（先建折前平面片 → 再建分点 → 最后连线/折）", () => {
    const spatial = SKILL_MANIFESTS.find((entry) => entry.id === "spatial-modeling")
    expect(spatial, "技能目录里必须有 spatial-modeling").toBeDefined()
    const summary = spatial!.summary
    expect(summary, summary).toContain("计划骨架")
    // 顺序那一条必须明写：同一份计划**按顺序**执行，后一笔引用不到前面的点名会被当场拒。
    expect(summary, summary).toContain("先建点")
    expect(summary, summary).toContain("再连线")
  })
})
