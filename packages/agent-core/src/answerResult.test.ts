import { describe, expect, it } from "vitest"

import { acceptAnswer } from "./answerAcceptance"
import { isSolveResultV1, type SolveResult } from "./answerResult"

/**
 * **W9：未知版本不得被当成当前版本渲染。**
 *
 * 迁移的第一条是"读路径容忍未知版本"：旧会话/未来版本/手工伪造的 `solveResult`
 * 必须被守卫拒绝，界面才能退回"历史回答，未重新核验"，而不是显示一个不认识的"已交付"。
 */

function valid(): SolveResult {
  return {
    schemaVersion: "mathcanvas.solve.v1",
    problemRevision: "rev-1",
    status: "answered",
    answers: [{ goalId: "g1", kind: "numeric", displayText: "2", evidenceRefs: [] }],
    unansweredGoalIds: [],
    evidence: [],
    reasonCodes: [],
    clarificationQuestions: []
  }
}

describe("W9 — solveResult version guard", () => {
  it("accepts the current version produced by acceptAnswer", () => {
    const produced = acceptAnswer({
      problemRevision: "rev-1",
      goals: [{ id: "g1", kind: "numeric", required: true }],
      candidates: [{ goalId: "g1", kind: "numeric", displayText: "2", value: { kind: "numeric", expression: "2" }, evidenceRefs: [] }],
      evidence: [],
      resolution: "answer",
      clarificationQuestions: []
    })
    expect(isSolveResultV1(produced)).toBe(true)
  })

  it("rejects an unknown schema version", () => {
    expect(isSolveResultV1({ ...valid(), schemaVersion: "mathcanvas.solve.v2" })).toBe(false)
    expect(isSolveResultV1({ ...valid(), schemaVersion: undefined })).toBe(false)
  })

  it("rejects a malformed payload instead of rendering it", () => {
    expect(isSolveResultV1({ ...valid(), status: "looks-fine" })).toBe(false)
    expect(isSolveResultV1({ ...valid(), answers: [{ goalId: "g1" }] })).toBe(false)
    expect(isSolveResultV1({ ...valid(), evidence: undefined })).toBe(false)
    expect(isSolveResultV1(null)).toBe(false)
  })
})
