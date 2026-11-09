import { describe, expect, it } from "vitest"

import { createBudget } from "../budget"
import type { GoalAnswer } from "../answerResult"
import type { ObligationIR } from "../obligationIR"
import { verifyMathAnswer, type MathFact } from "./mathAnswerVerification"
import { conditionMathFacts } from "./trustedFactAdapters"

/**
 * **W6：题族事实适配器 + 生产核验出口（2026-11-09）**。
 *
 * 这里钉的是"宿主事实从哪来、核验结果怎么落到证据"，不是又写一遍判据单元测试：
 * ① 事实**只**来自题面条件（模型给的坐标不进 facts）；
 * ② 条件没绑定目标就不生成事实（宁可 unknown）；
 * ③ 否证经同一条 `verifyMathAnswer` 出口变成 `failed` 证据，采样通过只能 `sampled`。
 */

const ir: ObligationIR = { obligations: [], unverified: [] }
const budget = () => createBudget()
const signal = new AbortController().signal

const numeric = (expression: string): GoalAnswer => ({
  goalId: "g1", kind: "numeric", displayText: expression,
  value: { kind: "numeric", expression }, evidenceRefs: []
})

describe("W6 事实适配器只读题面条件", () => {
  it("derives a hyperbola fact from the stated equation", () => {
    const facts = conditionMathFacts({ problemRevision: "p".repeat(64), conditions: [
      { id: "c1", sourceText: "已知双曲线 x²/9 − y²/16 = 1", goalIds: ["g1"] }
    ] })
    expect(facts).toEqual([{ kind: "hyperbola-asymptote-foot", goalId: "g1", a: 3, b: 4 }])
  })

  it("derives an ellipse fact and a without-replacement draw condition", () => {
    const facts = conditionMathFacts({ problemRevision: "p".repeat(64), conditions: [
      { id: "c1", sourceText: "已知椭圆 x²/4 + y² = 1", goalIds: ["g1"] },
      { id: "c2", sourceText: "袋中有 3 个红球、2 个蓝球，不放回取 2 个", goalIds: ["g2"] }
    ] })
    expect(facts[0]).toMatchObject({ kind: "ellipse-eccentricity", a: 2, b: 1 })
    expect(facts[1]).toMatchObject({ kind: "draw-probability", condition: { red: 3, blue: 2, draws: 2, replacement: "without" }, boundToProblem: true })
  })

  it("never turns a model-supplied answer point into a fact", () => {
    const facts = conditionMathFacts({ problemRevision: "p".repeat(64), conditions: [
      { id: "c1", sourceText: "已知双曲线 x²/9 − y²/16 = 1，垂足 P(9/5,12/5)", goalIds: ["g1"] }
    ] })
    expect(facts).toEqual([{ kind: "hyperbola-asymptote-foot", goalId: "g1", a: 3, b: 4 }])
  })

  it("skips a condition that is bound to no goal or to several goals", () => {
    expect(conditionMathFacts({ problemRevision: "p".repeat(64), conditions: [
      { id: "c1", sourceText: "已知双曲线 x²/9 − y²/16 = 1", goalIds: [] }
    ] })).toEqual([])
    expect(conditionMathFacts({ problemRevision: "p".repeat(64), conditions: [
      { id: "c1", sourceText: "已知双曲线 x²/9 − y²/16 = 1", goalIds: ["g1", "g2"] }
    ] })).toEqual([])
  })
})

describe("W6 生产核验出口", () => {
  const hyperbola: MathFact = { kind: "hyperbola-asymptote-foot", goalId: "g1", a: 3, b: 4 }

  it("supports the exact foot through verifyMathAnswer", () => {
    const answer: GoalAnswer = { goalId: "g1", kind: "conversation", displayText: "(9/5,12/5)", evidenceRefs: [] }
    const result = verifyMathAnswer({ problemRevision: "p".repeat(64), goalId: "g1", ir, candidate: answer, facts: [hyperbola] }, budget(), signal)
    expect(result.decision).toBe("supported")
    expect(result.evidence?.evidence.status).toBe("verified_instance")
  })

  it("refutes (3,4) and produces a failed evidence record", () => {
    const answer: GoalAnswer = { goalId: "g1", kind: "conversation", displayText: "(3,4)", evidenceRefs: [] }
    const result = verifyMathAnswer({ problemRevision: "p".repeat(64), goalId: "g1", ir, candidate: answer, facts: [hyperbola] }, budget(), signal)
    expect(result.decision).toBe("refuted")
    expect(result.reasonCodes).toContain("not_perpendicular")
    expect(result.evidence?.evidence.status).toBe("failed")
  })

  it("keeps a sampling-only function result at 'sampled', not verified", () => {
    const fact: MathFact = { kind: "function-equivalence", goalId: "g1", reference: "|sin(x)cos(x)|", domain: [-3, 3] }
    const answer: GoalAnswer = { goalId: "g1", kind: "conversation", displayText: "|sin(2x)|/2", evidenceRefs: [] }
    const result = verifyMathAnswer({ problemRevision: "p".repeat(64), goalId: "g1", ir, candidate: answer, facts: [fact] }, budget(), signal)
    expect(result.decision).toBe("supported")
    expect(result.evidence?.evidence.status).toBe("sampled")
  })

  it("refutes a without-replacement answer that used the independent model", () => {
    const fact: MathFact = { kind: "draw-probability", goalId: "g1", condition: { red: 3, blue: 2, draws: 2, replacement: "without" }, boundToProblem: true }
    const result = verifyMathAnswer({ problemRevision: "p".repeat(64), goalId: "g1", ir, candidate: numeric("9/25"), facts: [fact] }, budget(), signal)
    expect(result.decision).toBe("refuted")
    expect(result.evidence?.evidence.status).toBe("failed")
  })

  it("refutes a claimed monotone decreasing continued fraction", () => {
    const fact: MathFact = { kind: "continued-fraction-monotonicity", goalId: "g1", coefficients: [1n, 1n, 1n], claim: "decreasing" }
    const answer: GoalAnswer = { goalId: "g1", kind: "proof", displayText: "b_n 单调递减", value: { kind: "proof", conclusion: "b_n 单调递减" }, evidenceRefs: [] }
    const result = verifyMathAnswer({ problemRevision: "p".repeat(64), goalId: "g1", ir, candidate: answer, facts: [fact] }, budget(), signal)
    expect(result.decision).toBe("refuted")
    expect(result.evidence?.evidence.status).toBe("failed")
  })

  it("stays unknown when a draw fact was never bound to the problem text", () => {
    const fact: MathFact = { kind: "draw-probability", goalId: "g1", condition: { red: 3, blue: 2, draws: 2, replacement: "without" }, boundToProblem: false }
    expect(verifyMathAnswer({ problemRevision: "p".repeat(64), goalId: "g1", ir, candidate: numeric("3/10"), facts: [fact] }, budget(), signal).decision).toBe("unknown")
  })
})
