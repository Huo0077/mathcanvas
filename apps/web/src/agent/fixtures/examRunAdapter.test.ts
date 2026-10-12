import { EXAM_CASES, FROZEN_THRESHOLDS, type ExamCase, type PlannerPort } from "@draw/agent-core"
import { describe, expect, it, vi } from "vitest"

import { createExamRunCase } from "./examRunAdapter"

/**
 * **Task 20 的产品侧适配器**：把一次规划请求接到记账上（这里全是假规划器，零网络）。
 *
 * 钉三件事：**映射**（计划 / 问路 / 回解释 / 抛错各自一档）、**费用不由这层编**（由注入的
 * `costOf` 给）、**抛错不许被吞成"没跑"**。
 */

const CASE = EXAM_CASES[0]! as ExamCase

function plannerReturning(plan: unknown): PlannerPort {
  return { plan: vi.fn(async () => ({ plan, requestId: "r", attemptId: "a" })) } as unknown as PlannerPort
}

describe("Task 20: 规划请求 → 试验结局", () => {
  it("给了计划 ⇒ `planned`；费用与延迟来自注入的读数", async () => {
    const ticks = [1000, 2500]
    const runCase = createExamRunCase({
      planner: plannerReturning({ kind: "plan" }),
      costOf: () => 0.12,
      now: () => ticks.shift() ?? 2500
    })
    const result = await runCase(CASE, 1)
    expect(result.outcome).toBe("planned")
    expect(result.costUsd).toBe(0.12)
    expect(result.latencyMs).toBe(1500)
  })

  it("反问 ⇒ `clarification`；回了一段解释 ⇒ `rejected`（都不是成功）", async () => {
    const asking = createExamRunCase({ planner: plannerReturning({ kind: "clarification" }), costOf: () => 0.05 })
    expect((await asking(CASE, 1)).outcome).toBe("clarification")
    const answering = createExamRunCase({ planner: plannerReturning({ kind: "answer" }), costOf: () => 0.05 })
    const answered = await answering(CASE, 1)
    expect(answered.outcome).toBe("rejected")
    expect(answered.detail).toContain("kind=answer")
  })

  it("**规划器抛错 ⇒ `error`**，不吞异常、也不假装没跑", async () => {
    const planner = { plan: vi.fn(async () => { throw new Error("provider 401") }) } as unknown as PlannerPort
    const runCase = createExamRunCase({ planner, costOf: () => 0 })
    const result = await runCase(CASE, 2)
    expect(result.outcome).toBe("error")
    expect(result.detail).toContain("provider 401")
  })

  it("**费用不由这一层编**：`costOf` 收到的是真实的这一次（题、试次、结局）", async () => {
    const seen: unknown[] = []
    const runCase = createExamRunCase({
      planner: plannerReturning({ kind: "plan" }),
      costOf: (request) => {
        seen.push({ caseId: request.examCase.id, trial: request.trial, hasOutcome: request.outcome !== null })
        return 0.3
      }
    })
    const result = await runCase(CASE, 3)
    expect(result.costUsd).toBe(0.3)
    expect(seen).toEqual([{ caseId: CASE.id, trial: 3, hasOutcome: true }])
    // 冻结表那一侧仍然没有授权：这一层**不会**自己去跑任何东西（它只被 runExamEvaluation 调用）。
    expect(FROZEN_THRESHOLDS.authorization.status).toBe("pending")
  })
})
