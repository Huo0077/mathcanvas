import { describe, expect, it } from "vitest"

import holdout from "../../../test-fixtures/agent-reliability/fold-holdout.json"

import { solveRectangleFold } from "./rectangleFoldPlan"

/**
 * **W4 的 12 道后置变式**（2026-11-08）。
 *
 * **诚实声明：这一组不是盲测留出集。** 它们是在实现之后写的，期望值由**独立闭式公式**给出：
 *
 * - 折前 `BD² = a² + b²`；
 * - 折后 `BD² = t² + 2h² + 2h²cosθ`，其中 `t = |a²−b²|/√(a²+b²)`、`h = ab/√(a²+b²)`。
 *
 * 也就是说，"期望值"不来自被测求解器，但"选这 12 道题"发生在看过实现之后。
 * 真正的盲测留出集需要先封存再实现（方案 §11.3 / W8）；这里只证明**没有只对原 24 题过拟合**。
 */

interface HoldoutCase {
  id: string
  note: string
  prompt: string
  kind: "length" | "angle" | "perpendicular" | "perpendicular-and-length" | "inconsistent"
  expectedStatus: string
  values: number[]
}

const cases = holdout as unknown as HoldoutCase[]

const close = (left: number, right: number): boolean => Math.abs(left - right) <= 1e-8 * Math.max(1, Math.abs(right))

describe("W4 — post-implementation fold variants (not blind holdout)", () => {
  it.each(cases.map((item) => [item.id, item] as const))("%s: %s", (id, item) => {
    const solved = solveRectangleFold(item.prompt)
    expect(solved.status, `${id} ${item.note}`).toBe(item.expectedStatus)

    if (item.kind === "inconsistent") {
      expect(solved.status).toBe("unsupported")
      if (solved.status !== "unsupported") return
      expect(solved.code).toBe("inconsistent_conditions")
      return
    }
    if (solved.status !== "plan" && solved.status !== "answer") return

    if (item.kind === "length" || item.kind === "perpendicular-and-length") {
      const lengths = solved.findings.filter((finding) => finding.kind === "length").map((finding) => finding.kind === "length" ? finding.value : Number.NaN)
      expect(lengths.length, `${id} 长度条数`).toBe(item.values.length)
      for (const [index, expected] of item.values.entries()) {
        expect(close(lengths[index]!, expected), `${id} 第 ${index + 1} 个长度 ${lengths[index]} ≠ ${expected}`).toBe(true)
      }
    }
    if (item.kind === "angle") {
      const angles = solved.findings.filter((finding) => finding.kind === "angle").map((finding) => finding.kind === "angle" ? finding.value : Number.NaN)
      expect(angles.length, `${id} 折角条数`).toBe(1)
      expect(close(angles[0]!, item.values[0]!), `${id} 折角 ${angles[0]} ≠ ${item.values[0]}`).toBe(true)
    }
    if (item.kind === "perpendicular" || item.kind === "perpendicular-and-length") {
      const perpendicular = solved.findings.find((finding) => finding.kind === "perpendicular")
      expect(perpendicular?.kind === "perpendicular" ? perpendicular.status : undefined, `${id} 垂直结论`).toBe("holds")
    }

    // 交付层：有结论的题必须有正文（内部算对但正文没有，不算交付）。
    const answer = solved.status === "answer" ? solved.answer : solved.plan.answer ?? ""
    expect(answer.trim().length, `${id} 没有正文`).toBeGreaterThan(0)
  })
})
