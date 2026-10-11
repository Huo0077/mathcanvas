import { describe, expect, it } from "vitest"

import { parseObligationWithLegacy } from "../obligationIR"
import { specForPrompt } from "./witnessSearch"

/**
 * 题设按**产品路径的同一份形状**取：`parseObligationWithLegacy(prompt).ir`
 *（与 `planCompiler.witnessSearchInput` 逐字一致）。用 `parseDiagramObligations` 的
 * `givens` 会拿到**另一种类型**，`tsc` 会当场拒绝 —— 这条我踩过一次。
 */
const givensOf = (prompt: string) =>
  parseObligationWithLegacy(prompt).ir.obligations.filter((obligation) => obligation.role === "given")

/**
 * **平面图形这一族**（乙案实施计划 Task 1 / Task 2）。
 *
 * Task 1 只**认出**了它（`parseShapeClause` 的新分支）；**构造规格**是 Task 2。
 * 两份之间那段时间，`specForPrompt` 必须**如实说"这一类还没有构造器"** ——
 * 不许掉进棱锥那一支去拿一句**对平面题是假话**的理由（"缺锥顶 / 缺侧棱⊥底面"），
 * 那会让用户照着去补一个题面根本没提的立体条件。
 */
const PROMPT = "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3"

describe("平面图形（乙案）", () => {
  /**
   * **期望在 Task 2 有意改了**：上一轮这一条断言的是"如实说这一类还没有构造器"
   *（那是 Task 1 与 Task 2 之间的过渡状态）。Task 2 把那个"没有"变成了"有" ——
   * 所以它现在断言的是**规格真的被推出来了**。
   */
  it("把针对环上点名的度量条件抽成一份平面构造规格", () => {
    const result = specForPrompt(PROMPT, givensOf(PROMPT))

    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.spec.family).toBe("planar-figure")
    expect(result.spec.base).toEqual(["A", "B", "C", "D"])
    /**
     * 五条四边形条件各自成一条关系：三条长度（`AB` / `AD` / `CD` ⇒ `segment-length`）
     * 与两个角（`∠BAD` / `∠ADC` ⇒ `planarAngle`）。**这一条是 Task 2 的核心读数**：
     * 条件**不需要模型复述**，它们本来就是解析器从原话抽出来的。
     */
    expect(result.spec.relations).toHaveLength(5)
    expect(result.spec.relations.filter((relation) => relation.kind === "segment-length")).toHaveLength(3)
    expect(result.spec.relations.filter((relation) => relation.kind === "planarAngle")).toHaveLength(2)
    // 每一条长度都带值（不是"只记形状"，值就是题面写的那个数）。
    for (const relation of result.spec.relations.filter((entry) => entry.kind === "segment-length")) {
      expect(typeof relation.value).toBe("number")
    }
  })

  it("护栏：环外点名的条件**不进**这份规格（`PC=4√3` 属于折，不属于平面四边形）", () => {
    const withFoldTarget = `${PROMPT}，且PC=4√3`
    const result = specForPrompt(withFoldTarget, givensOf(withFoldTarget))

    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    const touched = result.spec.relations.flatMap((relation) => ("segments" in relation ? relation.segments.flat() : relation.targets))
    expect(touched).not.toContain("P")
  })

  it("护栏：立体题面仍然照旧推出 spec（新分支没抢走它们）", () => {
    const solid = "在四棱锥P-ABCD中，PA⊥平面ABCD，底面ABCD是菱形，画出这个四棱锥"
    const result = specForPrompt(solid, givensOf(solid))
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.spec.family).toBe("pyramid")
  })
})
