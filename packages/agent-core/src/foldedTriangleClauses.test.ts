import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { parseDiagramObligations } from "./diagramObligations"
import { compilePlan } from "./planCompiler"
import { parseShapeClause } from "./solver/shapeGrammar"

/**
 * **用户现场（2026-10-15，Rt△ABC 折起那道题）**：题面
 *
 * ```
 * Rt△ABC 中，∠C=90°，AC=3，BC=4。
 * D 为 AC 上一点，CD=1。将 △BCD 沿 BD 折起，使 C 到 C'，且 C'D⊥平面 ABD。
 * （1）求 BD 长及折叠后 C' 到平面 ABD 的距离（即 C'D=1，已知垂直）。
 * （2）求二面角 A-BC'-D 的正弦值。
 * ```
 *
 * 现场读数四条 `点名缺失：C`（`AC=3` / `BC=4` / `CD=1`）与一条"形状从句（点名环）认不出来"
 * （`∠C=90°`）。**根因之一是 `Rt△ABC 中` 没被认出来** —— 形状从句的正则只收"三角形"三个字，
 * 既不认 `Rt` 也不认 `△` ⇒ 环不存在 ⇒ 单字母角 `∠C` 不知道是哪两条边。
 *
 * 这一组用例钉住**现在读得出什么**，以及**还读不出什么**（后者照实记，不许假装）。
 */
const PROMPT = [
  "Rt△ABC 中，∠C=90°，AC=3，BC=4。",
  "D 为 AC 上一点，CD=1。将 △BCD 沿 BD 折起，使 C 到 C'，且 C'D⊥平面 ABD。",
  "（1）求 BD 长及折叠后 C' 到平面 ABD 的距离（即 C'D=1，已知垂直）。",
  "（2）求二面角 A-BC'-D 的正弦值。"
].join("\n")

/** 失败时把**完整的**读账带出来（比逐个断言更容易看出真实形状）。 */
function ledger(parsed: ReturnType<typeof parseDiagramObligations>): string {
  return `给定：${JSON.stringify(parsed.givens.map((item) => [item.kind, item.targets, item.value ?? null]))}\n未核验：${JSON.stringify(parsed.unverified.map((entry) => entry.sourceText))}`
}

describe("Rt△ABC 折起那道题：读得出什么、还读不出什么", () => {
  it("`Rt△ABC 中` 现在认得出环 ⇒ `∠C=90°` 落成三个点名的角（不再说「没有点名环」）", () => {
    expect(parseShapeClause(PROMPT)?.base, "环是 A、B、C").toEqual(["A", "B", "C"])
    const parsed = parseDiagramObligations(PROMPT)
    const angle = parsed.givens.find((item) => item.kind === "planarAngle")
    // 环上顶点 C 的邻点是 B 与 A，按"前一个、顶点、后一个"落成三个点名。
    expect(angle?.targets, ledger(parsed)).toEqual(["B", "C", "A"])
    expect(angle?.value).toBe(90)
    expect(parsed.unverified.some((entry) => entry.sourceText.includes("形状从句"))).toBe(false)
  })

  it("三条长度与那条「线 ⊥ 平面」都读得出来", () => {
    const parsed = parseDiagramObligations(PROMPT)
    const lengths = parsed.givens.filter((item) => item.kind === "fixedLength").map((item) => [item.targets.join(""), item.value])
    // `C'D=1` 是括号里那句「（即 C'D=1，已知垂直）」读出来的 —— 一并记着。
    // 撇归一到 `′`（见上一条的说明），所以这里是 `C′D`。
    expect(lengths, ledger(parsed)).toEqual([["AC", 3], ["BC", 4], ["CD", 1], ["C′D", 1]])
    const perpendicular = parsed.givens.find((item) => item.kind === "perpendicular")
    // 线的两个点名 + 平面的三个点名（`C'D⊥平面 ABD`）。
    // **撇已归一成规范字形 `′`**（2026-10-15）：题面写 `C'`、模型写 `C’`、文档标签写 `C′`
    // 都归到同一种字符，映射才对得上 —— 所以这里断言的是 `C′`，不是题面里那个 ASCII 撇。
    expect(perpendicular?.targets, ledger(parsed)).toEqual(["C′", "D", "A", "B", "D"])
  })

  it("**`D 为 AC 上一点` 不再静默消失**（今天还没有判据，但必须看得见）", () => {
    /**
     * 这一条是本轮**读账摊开之后照出来的第三处缺陷**：`D 为 AC 上一点` 此前既不进给定、
     * 也不进未核验 —— 与当年 `弦 AB 的长为 3`、`P 是椭圆上任意一点` 同一种病。
     * 本轮先把**触发词**接上（不许消失）并给它一句**说得清**的理由；
     * 真判据（与该线段共线且落在线段内）还没做 —— 做到之后这条断言要**翻转**成"读成一条义务"。
     */
    const parsed = parseDiagramObligations(PROMPT)
    const entry = parsed.unverified.find((item) => item.sourceText.includes("AC 上一点"))
    expect(entry, ledger(parsed)).toBeDefined()
    expect(entry!.reason, entry!.reason).toContain("还没有判据")
    expect(parsed.givens.some((item) => item.targets.join("").includes("AC") && item.kind === "segmentRatio"), "今天读不成义务").toBe(false)
  })

  it("**还读不出的**照实留在未核验里（不静默、也不假装读懂）", () => {
    const parsed = parseDiagramObligations(PROMPT)
    const unread = parsed.unverified.map((entry) => entry.sourceText).join("｜")
    // 二面角 `A-BC'-D`（折痕是两个带撇的点名）：读取器还没有这一支。
    expect(unread, ledger(parsed)).toContain("二面角 A-BC'-D")
  })

  it("**如实钉住的第四处缺口**：折起那句不在题设账上（它该是一条**诊断**，不是「未核验」）", () => {
    /**
     * 现状（本轮量出来的）：`将 △BCD 沿 BD 折起，使 C 到 C'` **既不进给定、也不进未核验**。
     *
     * 为什么**没有**顺手把它加进触发词表：它是一条**操作指令**，不是一条"待核验的条件" ——
     * 把它塞进 `unverified` 会给用户一句"折起：未核验"，而真正该说的是
     *「题面说了折起，**计划里却没有折**」。折起在**另一层**已经被读到了
     *（`figureIntent` 的 `readFoldTransformations`，`foldRigidityDiagnostics` 用它判刚体性），
     * 缺的是"计划没折"这条诊断。所以这条断言钉的是**缺口本身**：做到之后要**翻转**。
     */
    const parsed = parseDiagramObligations(PROMPT)
    const accounted = [...parsed.givens.map((item) => item.sourceText), ...parsed.unverified.map((entry) => entry.sourceText)].join("｜")
    expect(accounted, `题设账：${accounted}`).not.toContain("折起")
  })

  /**
   * **现场根因：模型把撇写成了弯撇**（`C’`，U+2019）。
   *
   * 贴来的读数是「这一笔面片的 `vertexNames` 与它的顶点对不上（给了 3 个名字、面有 3 个顶点）」——
   * **个数相等**，所以那句话指不出真凶。离线复现出来的真因是**字符**：弯撇不在点名字母表里
   *（`isPointName("C’") === false`），于是整张点名表建不出来，七条题设报同一句话。
   *
   * 修法：**读计划时把撇的变体归一到 `′`**（`actionInputs`），题面一侧的 `names()` 走同一个函数。
   * 这条判据钉住"归一之后映射真的建起来了"。
   */
  it("撇写成弯撇（`C’`）时名字照样对得上 —— 不再报「与它的顶点对不上」", () => {
    const C = { x: 0, y: 0, z: 0 }
    const A = { x: 3, y: 0, z: 0 }
    const B = { x: 0, y: 4, z: 0 }
    const D = { x: 1, y: 0, z: 0 }
    const plan = {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "plan",
      goal: "折",
      factIds: [],
      actions: [
        { actionId: "solid.create_face", actionKey: "abd", factIds: [], inputs: { alias: "abd", vertices: [A, B, D], vertexNames: ["A", "B", "D"], label: "平面ABD" } },
        { actionId: "solid.fold", actionKey: "bcd", factIds: [], inputs: { alias: "bcd", vertexNames: ["B", "C", "D"], vertices: [B, C, D], hinge: { from: "B", to: "D" }, apex: "C", apexAs: "C\u2019", angle: 90, label: "折起的三角形" } }
      ]
    } as unknown as PlanEnvelope

    const result = compilePlan(plan, { document: createEmptyDocument("geometry3d"), prompt: PROMPT, conversationId: "curly-prime", documentGeneration: 0 })
    const reasons = (result.diagramVerification?.checks ?? []).map((check) => check.reason).join("｜")
    const why = `ok=${result.ok}；诊断：${result.diagnostics.map((entry) => `${entry.stage}/${entry.code}: ${entry.detail}`).join(" || ")}；核验：${reasons}`

    // ① 名字表建起来了：**没有**那句"对不上"。
    expect(reasons, why).not.toContain("与它的顶点对不上")
    /**
     * ② 弯撇那个点真的在图上（归一之后叫 `C′`）：`C'D=1` 因此**核得出来** ——
     * 这一条比"读文档标签"强（编译没过时 `draftDocument` 是 `null`，而"这条长度量出来了"
     * 本身就证明那个点存在、且核验器按它的坐标算过）。
     */
    const foldedLength = (result.diagramVerification?.checks ?? []).find((entry) => entry.sourceText.includes("C'D=1"))
    expect(foldedLength?.status, why).toBe("passed")
    /**
     * ③ **仍然如实记着的第二处缺口**：折前的 `C` 在折后不存在，所以 `AC=3` / `BC=4` / `CD=1`
     * 这类**折前条件**依旧"点名缺失：C" —— 那不是字符问题，是"折前条件今天一律对最终文档核验"。
     * 把它钉在这里，免得下一轮把这条读数当成"归一没生效"。
     */
    expect(reasons, `核验：${reasons}`).toContain("点名缺失：C")
  })
})
