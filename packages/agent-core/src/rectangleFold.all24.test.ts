import { describe, expect, it } from "vitest"

import foldFixtures from "../../../test-fixtures/agent-answer-validation-20261102.json"

import { solveRectangleFold } from "./rectangleFoldPlan"

/**
 * **W4 门槛：原 24 题的独立核心判据 24/24。**
 *
 * 期望值来自夹具里的人工核对值（不是被测求解器生成的）。每道题的判据在 2026-11-03
 * 的验收记录里写明（`docs/audit/2026-11-03-agent-example-validation.md`）：
 * 垂直题看结论方向 + 数值、长度题看数值、折角题看角度、矛盾题看 `inconsistent_conditions`、
 * 澄清题看是否真的问了用户。
 *
 * **这是"核心判据"，不是完整证明**：它证明求解器在这些实例上给出正确结论，
 * 不证明它对任意矩形折叠题都正确。
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

describe("W4 — the original 24 fold fixtures", () => {
  it("passes every fixture's independent core criterion", () => {
    const failures: string[] = []
    for (const fixture of fixtures) {
      const solved = solveRectangleFold(fixture.prompt)
      const findings = "findings" in solved ? solved.findings : []
      const values = fixture.expectedKind === "angle"
        ? findings.filter((finding) => finding.kind === "angle").map((finding) => finding.kind === "angle" ? finding.value : Number.NaN)
        : findings.filter((finding) => finding.kind === "length").map((finding) => finding.kind === "length" ? finding.value : Number.NaN)
      const numericMatch = values.length === fixture.values.length
        && values.every((value, index) => Number.isFinite(value) && Math.abs(value - fixture.values[index]!) <= 1e-8 * Math.max(1, Math.abs(fixture.values[index]!)))
      const holds = findings.some((finding) => finding.kind === "perpendicular" && finding.status === "holds")
      const disproved = findings.some((finding) => finding.kind === "perpendicular" && finding.status === "disproved")
      const corePass = fixture.expectedKind === "inconsistent"
        ? solved.status === "unsupported" && "code" in solved && solved.code === "inconsistent_conditions"
        : fixture.expectedKind === "clarify"
          ? solved.status === "clarification"
          : fixture.expectedKind === "refute"
            ? numericMatch && disproved
            : fixture.expectedKind === "true"
              ? numericMatch && holds
              : numericMatch
      if (!corePass) failures.push(`${fixture.id}（${fixture.name}）status=${solved.status} values=${JSON.stringify(values)} expected=${JSON.stringify(fixture.values)}`)
    }

    expect(failures, `未过核心判据的题：\n${failures.join("\n")}`).toEqual([])
    expect(fixtures).toHaveLength(24)
  })

  it("delivers body text for every fixture that claims a conclusion", () => {
    const missing: string[] = []
    for (const fixture of fixtures) {
      const solved = solveRectangleFold(fixture.prompt)
      if (solved.status !== "answer" && solved.status !== "plan") continue
      const answer = solved.status === "answer" ? solved.answer : solved.plan.answer ?? ""
      if (answer.trim().length === 0) missing.push(fixture.id)
    }
    expect(missing, `这些题内部有结论但正文为空：${missing.join("、")}`).toEqual([])
  })
})
