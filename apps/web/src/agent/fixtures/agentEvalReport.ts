import type { VerificationReport } from "@draw/agent-core"
import type { AgentEvalScorecard } from "./agentEvalRunner"

/**
 * **评测读数怎么呈现给人看**（Phase 6 / Task 6.2）。
 *
 * ## 这份报告最要紧的一件事：不许把 `deterministic_local` 说成模型准确率
 *
 * 计划 Task 6.2 与记分卡都点名了这一条，原话是
 * "Its result mode is `deterministic_local`; it is useful for protocol and geometry regressions
 * but **must not be presented as real-model accuracy**."
 *
 * 所以报告顶部**必须**带模式的横幅，而且真实 provider 那几行一律写 `not measured`，
 * 而不是留空或写 0 —— 空与 0 都会被读成"测过了，是零分"。
 */

/** 报告顶部那行横幅。它的存在本身就是一条判据，所以单独成函数、单独测。 */
export function evalModeBanner(mode: "deterministic_local" | "real_provider"): string {
  return mode === "deterministic_local"
    ? "mode: deterministic_local — protocol/geometry regression signal only; NOT real-model accuracy"
    : "mode: real_provider — measured against a real provider"
}

/** 真实 provider 的读数**没有测**时写什么。刻意不是一个数字。 */
export const NOT_MEASURED = "not measured"

export interface ScorecardReportInput {
  mode: "deterministic_local" | "real_provider"
  scorecard: AgentEvalScorecard
  attempts: readonly { fixtureId: string; trial: 1 | 2 | 3; report: VerificationReport; durationMs: number; toolErrors: number; costUsd?: number }[]
  /**
   * **跑的是哪个 provider / 哪个模型**（真实 provider 那一侧才给得出）。
   *
   * 为什么必须写进报告：同一份 `pass@1` 在 `gpt-*` 与在另一个模型上**不是同一个数**。
   * 只写"measured against a real provider"而不写是谁，读数就没法比对。
   * 离线那一侧不给这个字段 ⇒ 报告写 `not measured`。
   */
  provider?: { id: string; modelId: string } | null
}

function percent(value: { passed: number; total: number } | null): string {
  if (value === null) return NOT_MEASURED
  return `${value.passed}/${value.total}`
}

/**
 * 把记分卡渲染成有界的多行文本（供 CLI 打印，也供用例断言）。
 *
 * 每个指标都直接读 `AgentEvalScorecard`，**不在这里重算**：
 * 重算就等于第二份口径，而"同一个量有两个数"是这个项目已经吃过亏的坑。
 */
export function formatScorecard(input: ScorecardReportInput): string {
  const { scorecard, attempts } = input
  const rate = (entry: { errors: number; total: number }) => entry.total === 0 ? NOT_MEASURED : `${entry.errors}/${entry.total}`
  const visual = scorecard.unverifiableTaskIds.length
  const lines: string[] = [
    evalModeBanner(input.mode),
    `provider          ${input.provider ? `${input.provider.id} / ${input.provider.modelId}` : NOT_MEASURED}`,
    "",
    `pass@1            ${percent(scorecard.passAt1)}`,
    `pass@3            ${percent(scorecard.passAt3)}`,
    `tool error rate   ${rate(scorecard.toolErrorRate)}`,
    `tool selection    ${scorecard.toolSelection.matched}/${scorecard.toolSelection.total}`,
    /**
     * **这一行原来打的是 `semantic verify   ${percent(scorecard.passAt1)}`** —— 也就是把 `pass@1`
     * **又打印了一遍**（2026-10-05 发现并删除）。它不是第二个指标：`AgentEvalScorecard` 里
     * **没有**独立的"语义验证"字段，而全仓也没有任何断言钉过那一行。
     *
     * 后果不是"少一行"那么轻：读数里会出现两个名字、一个数，读者很容易当成两个数据点；
     * 而**发布门禁第 2 条**点名的恰恰是"pass@1 **和语义验证率**" —— 那个名义指标因此**看起来存在、实际没有**。
     *
     * **真要做它**，判据就在仓里：`packages/agent-core/src/verification/taskVerification.ts` 是任务级语义验证器，
     * 而记分卡（`docs/acceptance/agent-tool-loop-scorecard.md`）给它的定义是
     * "已完成且证据完整的 claim 数 ÷ 已完成的 claim 数"。那是**一个要实现的指标**，不是一行 `percent(passAt1)`。
     * 在实现之前，这一行**不打印** —— 留白比留一个错的数诚实。
     */
    `visual verify     ${visual === 0 ? NOT_MEASURED : `not_supported for ${visual} task(s): ${scorecard.unverifiableTaskIds.join(", ")}`}`,
    `average latency   ${scorecard.averageLatencyMs === null ? NOT_MEASURED : `${Math.round(scorecard.averageLatencyMs)} ms (successful runs only)`}`,
    `average cost      ${scorecard.averageCostUsd === null ? NOT_MEASURED : `$${scorecard.averageCostUsd.toFixed(4)} (successful runs only)`}`,
    "",
    `attempts          ${attempts.length}`
  ]
  return lines.join("\n")
}

/** 逐任务一行，说清"哪个任务卡在哪一条 check 上"——只报总数的话排障无从下手。 */
export function formatAttemptFailures(input: ScorecardReportInput): string[] {
  const lines: string[] = []
  for (const attempt of input.attempts) {
    if (attempt.report.status === "passed") continue
    const failing = attempt.report.checks
      .filter((check) => check.status !== "passed")
      .map((check) => `${check.status}: ${check.detail}`)
    lines.push(`${attempt.fixtureId} #${attempt.trial} → ${attempt.report.status}${failing.length === 0 ? "" : `\n    ${failing.join("\n    ")}`}`)
  }
  return lines
}

/** 真实 provider 评测的**未测项**：显式列出来，免得"没测"被读成"通过"。 */
export const REAL_PROVIDER_GAPS: readonly string[] = [
  "real provider tool selection",
  "real drawing pass@1 / pass@3",
  "provider-billed cost",
  "real-provider latency"
]
