import { describe, expect, it } from "vitest"

import { acceptAnswer } from "../answerAcceptance"
import type { GoalAnswer } from "../answerResult"
import { createBudget } from "../budget"
import type { ObligationIR } from "../obligationIR"
import { verifyMathAnswer, type MathFact } from "./mathAnswerVerification"

/**
 * **W5 / T5：独立数学核验的有限支持域。**
 *
 * 两条历史错解必须被**否证**，正确答案不能被误杀：
 * - text-128：把 `OP` 与 `OF₁` 当垂直，用 `PF₁²=a²+c²` 得 `e=√5`；按题设 `PF₁²=6OP²`
 *   代入坐标算，`e=√5` 的残差是 2（`PF₁²=8`，要求 6）。
 * - text-198：把全称不等式方向写反；`a=2,b=1,t=−1/3` 这一个点就否证"所有点都满足 `PB≤2b`"，
 *   正确范围是 `0<e≤√2/2`。
 *
 * 期望值全部由**独立坐标算术/区间分支**给出，不调用被测函数生成。
 */

const ir: ObligationIR = { obligations: [], unverified: [] }

const numericAnswer = (expression: string, approximation: number, goalId = "g1"): GoalAnswer => ({
  goalId,
  kind: "numeric",
  displayText: expression,
  value: { kind: "numeric", expression, approximation },
  evidenceRefs: []
})

const intervalAnswer = (expression: string, goalId = "g1"): GoalAnswer => ({
  goalId,
  kind: "interval",
  displayText: expression,
  value: { kind: "interval", expression },
  evidenceRefs: []
})

function verify(fact: MathFact, candidate: GoalAnswer, options: { budget?: ReturnType<typeof createBudget>; signal?: AbortSignal } = {}) {
  const controller = new AbortController()
  const signal = options.signal ?? controller.signal
  return verifyMathAnswer({
    problemRevision: "revision-1",
    goalId: "g1",
    ir,
    candidate,
    facts: [fact]
  }, options.budget ?? createBudget(), signal)
}

describe("W5 — 历史错解必须被独立否证", () => {
  it("refutes the old hyperbola identity e=√5 by coordinate substitution", () => {
    const result = verify({ kind: "hyperbola-foot-eccentricity", goalId: "g1" }, numericAnswer("\\sqrt{5}", Math.sqrt(5)))

    expect(result.decision).toBe("refuted")
    expect(result.method).toBe("hyperbola-foot-substitution")
    expect(result.counterexample?.e).toBeCloseTo(Math.sqrt(5), 9)
    expect(result.counterexample?.pf1Squared).toBeCloseTo(8, 9)
    expect(result.counterexample?.required).toBeCloseTo(6, 9)
    expect(result.evidence?.evidence.status).toBe("failed")
  })

  it("supports the correct eccentricity e=√3 and never calls it a formal proof", () => {
    const result = verify({ kind: "hyperbola-foot-eccentricity", goalId: "g1" }, numericAnswer("\\sqrt{3}", Math.sqrt(3)))

    expect(result.decision).toBe("supported")
    expect(result.evidence).toBeDefined()
    expect(result.evidence?.evidence.status).not.toBe("formally_proved")
    expect(result.reasonCodes).toContain("limited_domain")
  })

  it("feeds a refuted verification into answer acceptance as a real refutation", () => {
    const verified = verify({ kind: "hyperbola-foot-eccentricity", goalId: "g1" }, numericAnswer("\\sqrt{5}", Math.sqrt(5)))
    expect(verified.evidence, "否证必须带一条可引用的证据").toBeDefined()

    const accepted = acceptAnswer({
      problemRevision: "revision-1",
      goals: [{ id: "g1", kind: "numeric", required: true }],
      candidates: [numericAnswer("\\sqrt{5}", Math.sqrt(5))],
      evidence: [verified.evidence!],
      resolution: "answer",
      clarificationQuestions: []
    })

    // 被独立否证的候选不能作为最终结论；正文仍在轨迹里，但状态是 failed。
    expect(accepted.status).toBe("failed")
    expect(accepted.answers).toEqual([])
    expect(accepted.reasonCodes).toContain("refuted_answer")
  })

  it("supports 0<e≤√2/2 and refutes the reversed ellipse range with a concrete point", () => {
    const supported = verify({ kind: "ellipse-eccentricity-range", goalId: "g1" }, intervalAnswer("0<e≤\\sqrt{2}/2"))
    expect(supported.decision).toBe("supported")
    expect(supported.evidence?.evidence.status).not.toBe("formally_proved")

    const reversed = verify({ kind: "ellipse-eccentricity-range", goalId: "g1" }, intervalAnswer("\\sqrt{2}/2<e<1"))
    expect(reversed.decision).toBe("refuted")
    expect(reversed.counterexample?.e).toBeGreaterThan(Math.SQRT1_2)
    expect(reversed.counterexample?.pbSquared).toBeGreaterThan(reversed.counterexample?.allowed ?? 0)
  })
})

describe("W5 — 限定二次函数区间最值与开闭端点", () => {
  const q: MathFact = {
    kind: "quadratic-interval",
    goalId: "g1",
    quadratic: [-3, -2, 5],
    interval: { lower: -1, upper: 1, lowerClosed: true, upperClosed: true },
    claim: "max"
  }

  it("supports a true extremum and reports residuals", () => {
    const result = verify(q, numericAnswer("\\frac{16}{3}", 16 / 3))
    expect(result.decision).toBe("supported")
    expect(result.counterexample).toBeUndefined()
    expect(result.evidence?.evidence.residuals).toBeDefined()
  })

  it("refutes a wrong extremum with the witness value and its argument", () => {
    const result = verify(q, numericAnswer("4", 4))
    expect(result.decision).toBe("refuted")
    expect(result.counterexample?.value).toBeCloseTo(16 / 3, 9)
    expect(result.counterexample?.at).toBeCloseTo(-1 / 3, 9)
  })

  it("handles an open endpoint: the supremum is not attained but still bounds the interior", () => {
    const open: MathFact = { ...q, interval: { lower: -1, upper: 1, lowerClosed: false, upperClosed: false } }
    // 顶点在内部，开闭端点不影响这条判据。
    expect(verify(open, numericAnswer("16/3", 16 / 3)).decision).toBe("supported")
    expect(verify(open, numericAnswer("5", 5)).decision).toBe("refuted")
  })

  it("returns unknown for a degenerate interval instead of guessing", () => {
    const result = verify({ ...q, interval: { lower: 2, upper: -2, lowerClosed: true, upperClosed: true } }, numericAnswer("0", 0))
    expect(result.decision).toBe("unknown")
    expect(result.reasonCodes.length).toBeGreaterThan(0)
  })
})

describe("W5 — 坐标距离与垂直依据", () => {
  const distance: MathFact = {
    kind: "distance-equality",
    goalId: "g1",
    left: [[0, 0], [3, 4]],
    right: [[0, 0], [1, 0]],
    ratio: 25
  }

  it("accepts an exact distance relation and rejects a broken one", () => {
    expect(verify(distance, numericAnswer("5", 5)).decision).toBe("supported")
    const broken = verify({ ...distance, ratio: 26 }, numericAnswer("5", 5))
    expect(broken.decision).toBe("refuted")
    expect(broken.counterexample?.leftSquared).toBeCloseTo(25, 9)
  })

  it("does not pretend a zero-length segment can be scaled", () => {
    const result = verify({ ...distance, right: [[1, 1], [1, 1]] }, numericAnswer("0", 0))
    expect(result.decision).toBe("unknown")
  })

  it("checks perpendicularity by the normalised dot product", () => {
    const perpendicular: MathFact = { kind: "perpendicular", goalId: "g1", first: [[0, 0], [2, 0]], second: [[1, 1], [1, 4]] }
    expect(verify(perpendicular, numericAnswer("0", 0)).decision).toBe("supported")
    expect(verify({ ...perpendicular, second: [[1, 1], [3, 2]] }, numericAnswer("0", 0)).decision).toBe("refuted")
  })
})

describe("W5 — 域外、预算与取消都不许装成结论", () => {
  it("returns unknown outside its supported domain", () => {
    const result = verify({ kind: "hyperbola-foot-eccentricity", goalId: "g1" }, {
      goalId: "g1",
      kind: "proof",
      displayText: "证明见上",
      value: { kind: "proof", conclusion: "成立" },
      evidenceRefs: []
    })
    expect(result.decision).toBe("unknown")
    expect(result.reasonCodes).toContain("candidate_not_numeric")
  })

  it("returns unknown when no criterion is registered for the goal", () => {
    const result = verify({ ...({ kind: "hyperbola-foot-eccentricity", goalId: "other" } as MathFact) }, numericAnswer("\\sqrt{3}", Math.sqrt(3)))
    expect(result.decision).toBe("unknown")
    expect(result.reasonCodes).toContain("no_registered_criterion")
  })

  it("stops on an exhausted geometry budget", () => {
    const result = verify({ kind: "hyperbola-foot-eccentricity", goalId: "g1" }, numericAnswer("\\sqrt{3}", Math.sqrt(3)), { budget: createBudget({ geometry: 0 }) })
    expect(result.decision).toBe("unknown")
    expect(result.reasonCodes).toContain("budget_exhausted")
  })

  it("stops on cancellation before doing arithmetic", () => {
    const controller = new AbortController()
    controller.abort()
    const result = verify({ kind: "hyperbola-foot-eccentricity", goalId: "g1" }, numericAnswer("\\sqrt{3}", Math.sqrt(3)), { signal: controller.signal })
    expect(result.decision).toBe("unknown")
    expect(result.reasonCodes).toContain("cancelled")
  })

  it("reads a radical interval without eval and tolerates exponent scaling", () => {
    const tiny: MathFact = {
      kind: "quadratic-interval",
      goalId: "g1",
      quadratic: [1, 0, 0],
      interval: { lower: -1e9, upper: 1e9, lowerClosed: true, upperClosed: true },
      claim: "max"
    }
    expect(verify(tiny, numericAnswer("1000000000000000000", 1e18)).decision).toBe("supported")
  })
})
