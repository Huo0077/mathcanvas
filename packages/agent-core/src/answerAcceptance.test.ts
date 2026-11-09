import { describe, expect, it } from "vitest"

import { acceptAnswer } from "./answerAcceptance"
import type { AnswerGoal, EvidenceRecord, GoalAnswer } from "./answerResult"

/**
 * **W2 / T2：答案验收是宿主侧的裁决，不是模型自述。**
 *
 * 这一组用例只驱动纯函数（不调模型、不写文档、不扣预算），钉住四件事：
 * ① 空白正文**不是**已作答（`completed` 只表示流程结束）；
 * ② 空目标列表不能用 `every([]) === true` 宣布成功；
 * ③ 未核验但非空的答案**照常可见**，证据为空就如实为空；
 * ④ 部分交付（缺小问、缺结构值、被反例否证）与完整交付分开。
 *
 * 证据记录里的 `failed` 在这里的含义是"系统自洽、而候选答案不满足"（见 `claimEvidence.ts`），
 * 所以它是否证，不是"没算出来"。
 */

const numericGoal: AnswerGoal = { id: "g1", kind: "numeric", required: true }

const numericAnswer = (text: string, extra: Partial<GoalAnswer> = {}): GoalAnswer => ({
  goalId: "g1",
  kind: "numeric",
  displayText: text,
  evidenceRefs: [],
  ...extra
})

const base = {
  problemRevision: "revision-1",
  goals: [numericGoal],
  evidence: [],
  resolution: "answer" as const,
  clarificationQuestions: []
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "e1",
    goalId: "g1",
    problemRevision: "revision-1",
    producer: "host_verifier",
    method: "independent_substitution",
    evidence: { status: "failed", solver: "model", residuals: { "answer-g1": 2.5 }, degreesOfFreedom: 0, nextActions: [] },
    ...overrides
  }
}

describe("W2 — 空答与空目标都不能算完成", () => {
  it("does not accept whitespace as a delivered answer", () => {
    const result = acceptAnswer({ ...base, candidates: [numericAnswer(" \n\t ")] })

    expect(result.status).toBe("failed")
    expect(result.unansweredGoalIds).toEqual(["g1"])
    expect(result.answers).toEqual([])
    expect(result.reasonCodes).toContain("empty_answer")
  })

  it("does not turn an empty goal list into success", () => {
    const result = acceptAnswer({ ...base, goals: [], candidates: [] })

    expect(result.status).not.toBe("answered")
    expect(result.status).toBe("failed")
    expect(result.reasonCodes).toContain("no_required_goals")
  })

  it("does not let an empty candidate list claim the goals were answered", () => {
    const result = acceptAnswer({ ...base, candidates: [] })

    expect(result.status).toBe("failed")
    expect(result.unansweredGoalIds).toEqual(["g1"])
    expect(result.reasonCodes).toContain("missing_answer")
  })
})

describe("W2 — 未核验的答案可见，但不伪装成已核验", () => {
  it("keeps an unverified but nonempty answer visible", () => {
    const result = acceptAnswer({ ...base, candidates: [numericAnswer("2", { value: { kind: "numeric", expression: "2" } })] })

    expect(result.status).toBe("answered")
    expect(result.answers.map((answer) => answer.displayText)).toEqual(["2"])
    // **证据是空的就是空的**：没有核验器就不要编一条。
    expect(result.evidence).toEqual([])
    expect(result.unansweredGoalIds).toEqual([])
  })

  it("reports partial when the structured value the goal needs is missing, but keeps the text", () => {
    const result = acceptAnswer({ ...base, candidates: [numericAnswer("2")] })

    expect(result.status).toBe("partial")
    expect(result.unansweredGoalIds).toEqual(["g1"])
    expect(result.answers.map((answer) => answer.displayText)).toEqual(["2"])
    expect(result.answers[0]?.value).toBeUndefined()
    expect(result.reasonCodes).toContain("missing_structured_value")
  })

  it("drops a value whose kind contradicts the answer kind instead of faking structure", () => {
    const result = acceptAnswer({
      ...base,
      candidates: [numericAnswer("2", { value: { kind: "interval", expression: "(1,2)" } })]
    })

    expect(result.status).toBe("partial")
    expect(result.answers[0]?.value).toBeUndefined()
    expect(result.reasonCodes).toContain("value_kind_mismatch")
  })

  it("rejects a non-finite approximation rather than displaying it as a number", () => {
    const result = acceptAnswer({
      ...base,
      candidates: [numericAnswer("2", { value: { kind: "numeric", expression: "2", approximation: Number.POSITIVE_INFINITY } })]
    })

    expect(result.answers[0]?.value).toBeUndefined()
    expect(result.reasonCodes).toContain("invalid_value")
  })
})

describe("W2 — 被否证的候选不作为最终结论", () => {
  it("refutes an answer when a trustworthy evidence record says it fails", () => {
    const result = acceptAnswer({
      ...base,
      candidates: [numericAnswer("√5", { value: { kind: "numeric", expression: "\\sqrt{5}" } })],
      evidence: [evidence()]
    })

    expect(result.status).toBe("failed")
    expect(result.answers).toEqual([])
    expect(result.unansweredGoalIds).toEqual(["g1"])
    expect(result.reasonCodes).toContain("refuted_answer")
  })

  it("refutes only the goal the evidence names", () => {
    const goals: AnswerGoal[] = [numericGoal, { id: "g2", kind: "proof", required: true }]
    const result = acceptAnswer({
      ...base,
      goals,
      candidates: [
        numericAnswer("2", { value: { kind: "numeric", expression: "2" } }),
        { goalId: "g2", kind: "proof", displayText: "证明见上", value: { kind: "proof", conclusion: "成立" }, evidenceRefs: [] }
      ],
      evidence: [evidence({ goalId: "g2", method: "counterexample" })]
    })

    expect(result.status).toBe("partial")
    expect(result.answers.map((answer) => answer.goalId)).toEqual(["g1"])
    expect(result.unansweredGoalIds).toEqual(["g2"])
  })
})

describe("W2 — 证据引用必须对得上题面修订与目标", () => {
  it("does not let a record from another problem revision upgrade evidence", () => {
    const result = acceptAnswer({
      ...base,
      candidates: [numericAnswer("2", { value: { kind: "numeric", expression: "2" } })],
      evidence: [evidence({ problemRevision: "revision-0", evidence: { status: "verified_instance", solver: "model", residuals: {}, degreesOfFreedom: null, nextActions: [] } })]
    })

    expect(result.status).toBe("answered")
    expect(result.evidence).toEqual([])
    expect(result.reasonCodes).toContain("invalid_evidence_ref")
  })

  it("drops evidence that names a goal it does not have", () => {
    const result = acceptAnswer({
      ...base,
      candidates: [numericAnswer("2", { value: { kind: "numeric", expression: "2" } })],
      evidence: [evidence({ goalId: "ghost", evidence: { status: "verified_instance", solver: "model", residuals: {}, degreesOfFreedom: null, nextActions: [] } })]
    })

    expect(result.evidence).toEqual([])
    expect(result.reasonCodes).toContain("invalid_evidence_ref")
  })

  it("keeps a valid evidence record with its identity", () => {
    const result = acceptAnswer({
      ...base,
      candidates: [numericAnswer("2", { value: { kind: "numeric", expression: "2" } })],
      evidence: [evidence({ evidence: { status: "verified_instance", solver: "model", residuals: { "answer-g1": 0 }, degreesOfFreedom: 0, nextActions: [] } })]
    })

    expect(result.evidence.map((record) => record.id)).toEqual(["e1"])
  })
})

describe("W2 — 澄清、部分与不支持的裁决", () => {
  it("needs clarification only when it has a concrete question", () => {
    const withQuestion = acceptAnswer({ ...base, candidates: [], resolution: "clarification", clarificationQuestions: ["CD 是折前还是折后？"] })
    expect(withQuestion.status).toBe("needs_clarification")
    expect(withQuestion.clarificationQuestions).toEqual(["CD 是折前还是折后？"])
    expect(withQuestion.answers).toEqual([])

    const withoutQuestion = acceptAnswer({ ...base, candidates: [], resolution: "clarification", clarificationQuestions: [] })
    expect(withoutQuestion.status).toBe("failed")
    expect(withoutQuestion.reasonCodes).toContain("clarification_without_question")
  })

  it("keeps a delivered answer when another goal still needs clarification", () => {
    const result = acceptAnswer({
      ...base,
      resolution: "clarification",
      candidates: [numericAnswer("2", { value: { kind: "numeric", expression: "2" } })],
      clarificationQuestions: ["第二问的折角是多少？"]
    })

    expect(result.status).toBe("partial")
    expect(result.answers).toHaveLength(1)
    expect(result.clarificationQuestions).toEqual(["第二问的折角是多少？"])
  })

  it("reports inconsistent, unsupported and failed resolutions without inventing answers", () => {
    expect(acceptAnswer({ ...base, candidates: [], resolution: "inconsistent", clarificationQuestions: [] }).status).toBe("inconsistent")
    expect(acceptAnswer({ ...base, candidates: [], resolution: "unsupported", clarificationQuestions: [] }).status).toBe("unsupported")
    expect(acceptAnswer({ ...base, candidates: [], resolution: "failed", clarificationQuestions: [] }).status).toBe("failed")
  })

  it("returns partial for unsupported work that still delivered an answer", () => {
    const result = acceptAnswer({
      ...base,
      resolution: "unsupported",
      candidates: [numericAnswer("2", { value: { kind: "numeric", expression: "2" } })]
    })

    expect(result.status).toBe("partial")
  })
})

describe("W2 — 多目标、部分与普通对话", () => {
  it("reports only the missing required goals as unanswered", () => {
    const goals: AnswerGoal[] = [numericGoal, { id: "g2", kind: "numeric", required: true }]
    const result = acceptAnswer({
      ...base,
      goals,
      candidates: [numericAnswer("2", { value: { kind: "numeric", expression: "2" } })]
    })

    expect(result.status).toBe("partial")
    expect(result.unansweredGoalIds).toEqual(["g2"])
  })

  it("does not block on an optional goal", () => {
    const goals: AnswerGoal[] = [numericGoal, { id: "g2", kind: "proof", required: false }]
    const result = acceptAnswer({
      ...base,
      goals,
      candidates: [numericAnswer("2", { value: { kind: "numeric", expression: "2" } })]
    })

    expect(result.status).toBe("answered")
    expect(result.unansweredGoalIds).toEqual([])
  })

  it("accepts a conversation goal as text and rejects an empty one", () => {
    const goals: AnswerGoal[] = [{ id: "chat", kind: "conversation", required: true }]
    const answered = acceptAnswer({
      ...base,
      goals,
      candidates: [{ goalId: "chat", kind: "conversation", displayText: "一共有 3 个点。", evidenceRefs: [] }]
    })
    expect(answered.status).toBe("answered")

    const empty = acceptAnswer({
      ...base,
      goals,
      candidates: [{ goalId: "chat", kind: "conversation", displayText: "  ", evidenceRefs: [] }]
    })
    expect(empty.status).toBe("failed")
    expect(empty.unansweredGoalIds).toEqual(["chat"])
  })

  it("reports unknown goals and duplicate candidates instead of silently merging them", () => {
    const result = acceptAnswer({
      ...base,
      candidates: [
        numericAnswer("2", { value: { kind: "numeric", expression: "2" } }),
        numericAnswer("3", { value: { kind: "numeric", expression: "3" } }),
        { goalId: "ghost", kind: "unknown", displayText: "无关", evidenceRefs: [] }
      ]
    })

    expect(result.status).toBe("answered")
    // 先到的那一份留下：后到的同 goal 候选不覆盖已交付的结论。
    expect(result.answers.map((answer) => answer.displayText)).toEqual(["2"])
    expect(result.reasonCodes).toContain("duplicate_answer")
    expect(result.reasonCodes).toContain("unknown_goal")
  })
})

it("rejects a non-option single-choice value rather than completing it", () => {
  const result = acceptAnswer({ problemRevision: "revision-1", goals: [{ id: "g1", kind: "single_choice", required: true }],
    candidates: [{ goalId: "g1", kind: "single_choice", displayText: "最终答案：E", value: { kind: "single_choice", optionId: "E" }, evidenceRefs: [] }],
    evidence: [], resolution: "answer", clarificationQuestions: [] })
  expect(result.status).not.toBe("answered")
  expect(result.reasonCodes).toContain("invalid_value")
})

it("rejects a structured option when its own explicit final answer names another option", () => {
  const result = acceptAnswer({ problemRevision: "revision-1", goals: [{ id: "g1", kind: "single_choice", required: true }],
    candidates: [{ goalId: "g1", kind: "single_choice", displayText: "推导得 9，最终答案：B。", value: { kind: "single_choice", optionId: "C" }, evidenceRefs: [] }],
    evidence: [], resolution: "answer", clarificationQuestions: [] })
  expect(result.status).not.toBe("answered")
  expect(result.reasonCodes).toContain("inconsistent_final_option")
})

it("does not mistake a quoted option in an old revision for a verified final answer", () => {
  const result = acceptAnswer({ problemRevision: "revision-1", goals: [{ id: "g1", kind: "single_choice", required: true }],
    candidates: [{ goalId: "g1", kind: "single_choice", displayText: "候选 C；最终答案：B。", value: { kind: "single_choice", optionId: "B" }, evidenceRefs: [] }],
    evidence: [], resolution: "answer", clarificationQuestions: [] })
  expect(result.status).toBe("answered")
  expect(result.evidence).toEqual([])
})