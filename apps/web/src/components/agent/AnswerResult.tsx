import type { AnswerValue, SolveResult, SolveStatus } from "@draw/agent-core"

import { TranscriptText } from "./TranscriptText"

/**
 * **答案交付卡**（W2 / T2，2026-11-08）。
 *
 * 它回答的是"这次交付到了哪一步"，而不是"这道题做对了"：
 *
 * - `status` 来自宿主侧的 `acceptAnswer`（逐问覆盖 + 结构值 + 证据引用），
 *   所以空白正文、缺小问、请求补图都不会显示成"已解答"；
 * - **证据为空就写"未核验"**；`verified_instance` 只写"实例验证"，
 *   绝不出现"已证明" —— 抽样与实例不是形式证明（方案 §7.2 的三个完成定义）。
 *
 * 逐问分行是刻意的：合并问句漏答在旧版本里看不出来，因为界面上只有一段正文。
 */

const STATUS_LABEL: Record<SolveStatus, string> = {
  answered: "已交付",
  partial: "部分交付",
  needs_clarification: "需要补充信息",
  inconsistent: "题设存在冲突",
  unsupported: "超出当前能力",
  failed: "未完成"
}

const EVIDENCE_LABEL: Record<string, string> = {
  formally_proved: "形式证明",
  verified_instance: "实例验证",
  sampled: "数值抽样",
  failed: "存在反例",
  inconsistent: "题设冲突",
  unknown: "未核验",
  not_run: "未做核验",
  timeout: "核验超时"
}

/** `goal-2` 这类宿主生成的稳定 id 显示成"第2问"；别的 id 原样显示，不猜编号。 */
function goalLabel(goalId: string, fallbackIndex: number): string {
  const match = /^goal-(\d+)$/.exec(goalId)
  return match ? `第${match[1]}问` : `第${fallbackIndex}问`
}

function valueLine(value: AnswerValue | undefined): string | undefined {
  if (value === undefined) return undefined
  switch (value.kind) {
    case "numeric":
      return `数值：${value.expression}${value.approximation === undefined ? "" : ` ≈ ${value.approximation}`}${value.unit === undefined ? "" : ` ${value.unit}`}`
    case "interval":
      return `区间：${value.expression}`
    case "single_choice":
      return `选项：${value.optionId}`
    case "multiple_choice":
      return `选项：${value.optionIds.join("、")}`
    case "proof":
      // 有结论不等于证明成立：这一行只说明"结论是什么"。
      return "证明结论（是否成立见核验说明）"
    case "drawing":
      return "已生成草稿（尚未提交）"
    case "conversation":
    case "unknown":
      return undefined
  }
}

function evidenceSummary(result: SolveResult): string {
  if (result.evidence.length === 0) return "未核验：本次没有可独立复核的证据。"
  const counts = new Map<string, number>()
  for (const record of result.evidence) {
    const label = EVIDENCE_LABEL[record.evidence.status] ?? record.evidence.status
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return `核验：${[...counts].map(([label, count]) => `${label} ${count} 条`).join("、")}。`
}

export function AnswerResult({ result }: { result: SolveResult }) {
  const missing = result.unansweredGoalIds.map((goalId, index) => goalLabel(goalId, index + 1))
  return <section className="agent-answer-result" data-solve-status={result.status} aria-label="答案交付">
    <header className="agent-answer-head">
      <span className="agent-answer-status" data-status={result.status}>{STATUS_LABEL[result.status]}</span>
      <small className="agent-answer-evidence">{evidenceSummary(result)}</small>
    </header>
    {result.answers.length > 0 && <ol className="agent-answer-list">
      {result.answers.map((answer, index) => {
        const value = valueLine(answer.value)
        return <li className="agent-answer-row" key={answer.goalId} data-answer-kind={answer.kind}>
          <span className="agent-answer-index">{goalLabel(answer.goalId, index + 1)}</span>
          <div className="agent-answer-body">
            <p className="agent-answer-text"><TranscriptText text={answer.displayText} /></p>
            {value !== undefined && <p className="agent-answer-value">{value}</p>}
          </div>
        </li>
      })}
    </ol>}
    {missing.length > 0 && <p className="agent-answer-missing">缺少回答：{missing.join("、")}</p>}
    {result.clarificationQuestions.length > 0 && <div className="agent-answer-questions">
      <strong>需要你补充：</strong>
      <ul>{result.clarificationQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
    </div>}
    {result.reasonCodes.length > 0 && <details className="agent-answer-reasons">
      <summary>诊断</summary>
      <code>{result.reasonCodes.join(", ")}</code>
    </details>}
  </section>
}
