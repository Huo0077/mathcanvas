import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import type { SolveResult } from "@draw/agent-core"

import { AnswerResult } from "./AnswerResult"

/**
 * **W2 / T2：答案卡只说交付到了哪一步。**
 *
 * 三类本轮故障（空白正文、请求补图却报成回答、多问只答一问）在界面上必须可分辨；
 * 证据为空时必须写"未核验"，`verified_instance` 也只能写"实例验证"，
 * **不许**出现"已证明"这种把抽样/实例说成形式证明的字样。
 */

function result(overrides: Partial<SolveResult> = {}): SolveResult {
  return {
    schemaVersion: "mathcanvas.solve.v1",
    problemRevision: "revision-1",
    status: "answered",
    answers: [{ goalId: "goal-1", kind: "conversation", displayText: "BD 的长是 2。", evidenceRefs: [] }],
    unansweredGoalIds: [],
    evidence: [],
    reasonCodes: [],
    clarificationQuestions: [],
    ...overrides
  }
}

describe("answer delivery card", () => {
  it("labels an answered run and says it is unverified when there is no evidence", () => {
    const { container } = render(<AnswerResult result={result()} />)

    expect(screen.getByText("已交付")).toBeTruthy()
    expect(screen.getByText("第1问")).toBeTruthy()
    expect(container.textContent).toContain("BD 的长是 2。")
    expect(container.textContent).toContain("未核验")
    expect(container.textContent).not.toContain("已证明")
  })

  it("never claims success for a failed or empty delivery", () => {
    const { container } = render(<AnswerResult result={result({
      status: "failed",
      answers: [],
      unansweredGoalIds: ["goal-1"],
      reasonCodes: ["empty_answer"]
    })} />)

    expect(screen.getByText("未完成")).toBeTruthy()
    expect(container.textContent).toContain("缺少回答")
    expect(container.textContent).toContain("第1问")
    expect(container.textContent).not.toContain("已交付")
    expect(container.textContent).not.toContain("已解答")
  })

  it("shows the concrete questions when the run needs clarification", () => {
    const { container } = render(<AnswerResult result={result({
      status: "needs_clarification",
      answers: [],
      unansweredGoalIds: ["goal-1"],
      clarificationQuestions: ["CD 是折前的线段还是折后的 CP？"]
    })} />)

    expect(screen.getByText("需要补充信息")).toBeTruthy()
    expect(container.textContent).toContain("CD 是折前的线段还是折后的 CP？")
  })

  it("shows delivered answers and missing goals together for a partial delivery", () => {
    const { container } = render(<AnswerResult result={result({
      status: "partial",
      answers: [
        { goalId: "goal-1", kind: "numeric", displayText: "2", value: { kind: "numeric", expression: "2" }, evidenceRefs: [] }
      ],
      unansweredGoalIds: ["goal-2"]
    })} />)

    expect(screen.getByText("部分交付")).toBeTruthy()
    expect(container.textContent).toContain("2")
    expect(container.textContent).toContain("缺少回答")
    expect(container.textContent).toContain("第2问")
  })

  it("calls an instance check an instance check, never a proof", () => {
    const { container } = render(<AnswerResult result={result({
      evidence: [{
        id: "e1",
        goalId: "goal-1",
        problemRevision: "revision-1",
        producer: "host_verifier",
        method: "independent_substitution",
        evidence: { status: "verified_instance", solver: "model", residuals: {}, degreesOfFreedom: 0, nextActions: [] }
      }]
    })} />)

    expect(container.textContent).toContain("实例验证")
    expect(container.textContent).not.toContain("已证明")
    expect(container.textContent).not.toContain("未核验")
  })
})
