import { examTrialOutcomeOf, type ExamRunCaseResult, type PlanOutcome, type PlannerPort } from "@draw/agent-core"
import type { ExamCase } from "@draw/agent-core"

/**
 * **把一次规划请求接到 Task 20 的记账上**（授权到了就是"跑一条命令"里的那一步）。
 *
 * ## 它做什么
 *
 * 每题每次试验调一次**产品侧的规划器端口**（`createModelPlanner()`），把结果映射成
 * `ExamRunCaseResult`：成功 / 问路 / 回了一段解释 / 抛错，以及这一次的延迟与费用。
 *
 * ## 它刻意不做的事（三条边界，都写在返回值上）
 *
 * 1. **不自己算钱**：费用由调用方注入的 `costOf` 给 —— 价格表在 provider 那一侧，
 *    这一层编一个数就等于伪造成本读数；
 * 2. **不吞异常**：规划器抛了就记 `error`（`detail` 带上原文），不假装"这次没跑"；
 * 3. **取不到"同轮修复"那一档**：修复在协调器的编译回路里，端口这一层看不到 ⇒
 *    这里一律 `repaired: false`。真跑时若走协调器那条路，要把它的修复标记传进来，
 *    否则 `repairedCount` 会如实读成 0（**不许**把"修了一次才成"记成一次成功）。
 */

export interface ExamRunAdapterDeps {
  planner: PlannerPort
  /** 这一次请求花了多少钱（由 provider 侧按真实用量给）。 */
  costOf: (request: { examCase: ExamCase; trial: number; outcome: PlanOutcome | null; error: unknown }) => number
  /** 墙钟（测试里注入固定值）。 */
  now?: () => number
}

/** 一次试验的适配器（`runExamEvaluation` 的 `runCase` 就是它）。 */
export function createExamRunCase(deps: ExamRunAdapterDeps): (examCase: ExamCase, trial: number) => Promise<ExamRunCaseResult> {
  const now = deps.now ?? (() => Date.now())
  return async (examCase, trial) => {
    const started = now()
    // 不给初值：`catch` 那条路一定 `return`，所以走完 `try` 时它必然已被赋值（`no-useless-assignment`）。
    let outcome: PlanOutcome
    try {
      outcome = await deps.planner.plan({
        run: { runId: `exam-${examCase.id}-${trial}`, conversationId: `exam-${examCase.id}` },
        userMessage: examCase.prompt
      } as never)
    } catch (error) {
      return {
        outcome: examTrialOutcomeOf({ kind: "error" }),
        costUsd: deps.costOf({ examCase, trial, outcome: null, error }),
        latencyMs: now() - started,
        detail: `规划器抛了：${error instanceof Error ? error.message : String(error)}`
      }
    }
    const kind = (outcome.plan as { kind?: string }).kind
    const mapped = kind === "plan" ? "plan" : kind === "clarification" ? "clarification" : "answer"
    return {
      // 端口这一层看不到协调器的修复回路 ⇒ 一律 `repaired: false`（见文件头边界③）。
      outcome: examTrialOutcomeOf({ kind: mapped, repaired: false }),
      costUsd: deps.costOf({ examCase, trial, outcome, error: null }),
      latencyMs: now() - started,
      ...(mapped === "plan" ? {} : { detail: `规划器给的不是计划（kind=${kind ?? "未知"}）。` })
    }
  }
}
