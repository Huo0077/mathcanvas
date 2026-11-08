import { describe, expect, it } from "vitest"

import foldFixtures from "../../../test-fixtures/agent-answer-validation-20261102.json"

import { solveRectangleFold, type RectangleFoldSolution } from "./rectangleFoldPlan"

/**
 * **W4 / T4：折叠题的验收在"用户看得见的东西"上，不在内部 geometry 上。**
 *
 * 这一组直接拿 2026-11-02 的 24 题夹具里被点名的失败实例（E06/E10/E13/E15/E18/E19/E23），
 * 断言的是**正文、状态与逐问结论**：内部角度算对但正文没有，按 W4 的判据仍算未交付。
 *
 * 夹具的期望值来自独立参考（不是由被测求解器生成的），见 `test-fixtures/agent-answer-validation-20261102.json`。
 */

interface FoldFixture {
  id: string
  name: string
  prompt: string
  expectedKind: string
  expected: string
  values: number[]
}

const fixtures = foldFixtures as unknown as FoldFixture[]

function fixture(id: string): FoldFixture {
  const found = fixtures.find((item) => item.id === id)
  expect(found, `夹具里没有 ${id}`).toBeDefined()
  return found!
}

function solve(id: string): RectangleFoldSolution {
  return solveRectangleFold(fixture(id).prompt)
}

function answerOf(solved: RectangleFoldSolution): string {
  if (solved.status === "answer") return solved.answer
  if (solved.status === "plan") return solved.plan.answer ?? ""
  return ""
}

describe("W4 — 折叠题的逐问交付", () => {
  it("E06 square wording: 折后 BD⊥AC 成立，正文交出 BD=4", () => {
    const solved = solve("E06")
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") throw new Error("expected plan")
    const perpendicular = solved.findings.find((finding) => finding.kind === "perpendicular")
    const length = solved.findings.find((finding) => finding.kind === "length")
    expect(perpendicular?.kind === "perpendicular" ? perpendicular.status : undefined).toBe("holds")
    expect(length?.kind === "length" ? length.value : undefined).toBeCloseTo(4, 9)

    const answer = answerOf(solved)
    expect(answer).toContain("BD=4")
    expect(answer).toContain("成立")
  })

  it("E10 merged question: two goals (折前 + 折后) with two values in the body", () => {
    const solved = solve("E10")
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") throw new Error("expected plan")

    const lengths = solved.findings.filter((finding) => finding.kind === "length")
    expect(lengths).toHaveLength(2)
    expect(lengths.map((finding) => finding.kind === "length" ? Number(finding.value.toPrecision(10)) : 0))
      .toEqual([4.472135955, 3.687817783])
    // 折前必须真的是折前：不是把折后的值重复贴两遍。
    expect(lengths[0]?.kind === "length" ? lengths[0].detail : "").toContain("折前")
    expect(lengths[1]?.kind === "length" ? lengths[1].detail : "").toContain("折后")

    const answer = answerOf(solved)
    expect(answer).toContain("2√5")
    expect(answer).toContain("2√85/5")
  })

  it("E13 colloquial question: 折后 BD 多长 也有正文与数值", () => {
    const solved = solve("E13")
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") throw new Error("expected plan")

    const length = solved.findings.find((finding) => finding.kind === "length")
    expect(length?.kind === "length" ? Number(length.value.toPrecision(10)) : undefined).toBeCloseTo(3.687817783, 9)
    expect(answerOf(solved)).toContain("2√85/5")
  })

  it("E15 pre-fold-only: answers 2√5 without asking for the fold angle", () => {
    const solved = solve("E15")

    // 只问折前，就不该因为"没给折角"而停在澄清。
    expect(solved.status).not.toBe("clarification")
    expect(answerOf(solved)).toContain("2√5")
    expect(solved.status === "answer" || solved.status === "plan").toBe(true)
    if (solved.status !== "answer" && solved.status !== "plan") return
    const length = solved.findings.find((finding) => finding.kind === "length")
    expect(length?.kind === "length" ? Number(length.value.toPrecision(10)) : undefined).toBeCloseTo(4.472135955, 9)
  })

  it("E18 diagonal contradiction: refuses to answer and names the conflicting condition", () => {
    const solved = solve("E18")

    expect(solved.status).toBe("unsupported")
    if (solved.status !== "unsupported") return
    expect(solved.code).toBe("inconsistent_conditions")
    expect(solved.reason).toContain("AC=6")
    expect(solved.reason).toContain("矛盾")
    expect(solved.sourceText).toBe("AC=6")
    // 不许"继续编解"：矛盾时没有正文。
    expect(answerOf(solved)).toBe("")
  })

  it("E19 foot of perpendicular: E is constructed, BE⊥AC is verified and stated", () => {
    const solved = solve("E19")
    expect(solved.status === "plan" || solved.status === "answer").toBe(true)
    if (solved.status !== "plan" && solved.status !== "answer") return

    const perpendicular = solved.findings.find((finding) => finding.kind === "perpendicular")
    expect(perpendicular?.kind === "perpendicular" ? perpendicular.status : undefined).toBe("holds")
    const answer = answerOf(solved)
    expect(answer).toContain("E")
    expect(answer).toContain("垂足")
    expect(answer).toContain("成立")

    if (solved.status === "plan") {
      // 辅助点 E 必须真的进计划（否则"核验过 E"在图上不存在）。
      const point = solved.plan.actions.find((action) => action.actionId === "solid.create_point" && action.inputs.label === "E")
      expect(point, "计划里没有构造辅助点 E").toBeDefined()
    }
  })

  it("E23 reverse fold angle: the angle is in the body, not only inside geometry", () => {
    const solved = solve("E23")
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") throw new Error("expected plan")

    const angle = solved.findings.find((finding) => finding.kind === "angle")
    expect(angle?.kind === "angle" ? Number(angle.value.toFixed(2)) : undefined).toBeCloseTo(135.95, 2)
    const answer = answerOf(solved)
    expect(answer).toContain("135.95")
    expect(answer).toContain("折角")
  })
})
