import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "../diagramObligations"
import { specForPrompt } from "./witnessSearch"

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
  it("认出之后：如实说这一类还没有构造器，而不是给一句立体题的理由", () => {
    const result = specForPrompt(PROMPT, parseDiagramObligations(PROMPT).givens)

    expect(result.status).toBe("unrecognised")
    if (result.status !== "unrecognised") return
    expect(result.reason).toContain("平面图形")
    expect(result.reason).toContain("还没有构造器")
    // 不许出现"缺锥顶 / 缺侧棱⊥底面"那一类**对平面题是假话**的理由。
    expect(result.reason).not.toContain("锥顶")
    expect(result.reason).not.toContain("侧棱")
  })

  it("护栏：立体题面仍然照旧推出 spec（新分支没抢走它们）", () => {
    const solid = "在四棱锥P-ABCD中，PA⊥平面ABCD，底面ABCD是菱形，画出这个四棱锥"
    const result = specForPrompt(solid, parseDiagramObligations(solid).givens)
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.spec.family).toBe("pyramid")
  })
})
