import type { AnswerGoal, AnswerKind, EvidenceRecord, GoalAnswer, SolveResult, SolveStatus } from "./answerResult"
import { SOLVE_RESULT_SCHEMA_VERSION } from "./answerResult"

/**
 * **答案验收（W2 / T2）**。
 *
 * 纯函数：不访问模型、不写文档、不扣预算 —— 候选答案是否可信由**宿主**提供的证据决定，
 * 本函数只做"目标覆盖 / 正文 / 结构值 / 证据引用一致性"的交付裁决。
 *
 * ## 为什么不能只看 `every(goal => answer)` 这种一行判据
 *
 * 现场三类故障都穿过了它：空白正文（有"答案"但什么都没说）、请求补图却报成回答、
 * 多问只答最后一问。于是这里把"有没有内容"、"结构值够不够"、"有没有被否证"、
 * "证据引用对不对得上"分开判，而 `status` 只表示**交付层面**的结论。
 *
 * ## 证据等级
 *
 * 一条证据记录只有在 `goalId` 属于本题目标、且 `problemRevision` 与本次题面一致时才有效。
 * 有效证据里的 `failed` 是**否证**（系统自洽、候选不满足），被否证的候选不作为最终结论；
 * 其余状态（含 `verified_instance` / `sampled`）只表示"有证据"，不代表答案是形式证明。
 */

export interface AnswerAcceptanceInput {
  problemRevision: string
  goals: readonly AnswerGoal[]
  candidates: readonly GoalAnswer[]
  evidence: readonly EvidenceRecord[]
  resolution: "answer" | "clarification" | "inconsistent" | "unsupported" | "failed"
  clarificationQuestions: readonly string[]
}

/** 必须有结构值才叫"完整交付"的目标类型（方案 §8.2）。 */
const STRUCTURED_KINDS: ReadonlySet<AnswerKind> = new Set<AnswerKind>(["single_choice", "multiple_choice", "numeric", "interval"])

interface Assessment {
  answer: GoalAnswer
  complete: boolean
  reasons: string[]
}

/**
 * 校验一个结构值本身是否合法；返回原因码或 `undefined`。
 *
 * 这里**只做结构校验**，不做数学核验：值是否"对"由独立核验器说话。
 * 数值只接受有限值 —— `NaN` / `Infinity` 显示出来就是假话。
 */
function valueProblem(answer: GoalAnswer): string | undefined {
  const value = answer.value
  if (value === undefined) return undefined
  if (value.kind !== answer.kind) return "value_kind_mismatch"
  switch (value.kind) {
    case "single_choice":
      return /^[A-D]$/.test(value.optionId.trim()) ? undefined : "invalid_value"
    case "multiple_choice": {
      const ids = value.optionIds.map((id) => id.trim()).filter((id) => id.length > 0)
      return ids.length > 0 ? undefined : "invalid_value"
    }
    case "numeric":
      if (value.expression.trim().length === 0) return "invalid_value"
      if (value.approximation !== undefined && !Number.isFinite(value.approximation)) return "invalid_value"
      return undefined
    case "interval":
      return value.expression.trim().length > 0 ? undefined : "invalid_value"
    case "proof":
      return value.conclusion.trim().length > 0 ? undefined : "invalid_value"
    case "drawing":
      return value.draftId.trim().length > 0 ? undefined : "invalid_value"
    case "conversation":
    case "unknown":
      return undefined
  }
}

/** 多选去重（方案 §8.2：选项 ID 去重），其它值原样保留。 */
function normalizedValue(answer: GoalAnswer): GoalAnswer["value"] {
  const value = answer.value
  if (value?.kind === "multiple_choice") {
    return { kind: "multiple_choice", optionIds: [...new Set(value.optionIds.map((id) => id.trim()).filter((id) => id.length > 0))] }
  }
  if (value?.kind === "single_choice") return { kind: "single_choice", optionId: value.optionId.trim() }
  return value
}

function assess(goal: AnswerGoal, candidate: GoalAnswer): Assessment | null {
  if (candidate.displayText.trim().length === 0) return null
  const reasons: string[] = []
  if (goal.kind !== "unknown" && candidate.kind !== goal.kind) reasons.push("goal_kind_mismatch")

  const value = normalizedValue(candidate)
  const explicitFinals = [...candidate.displayText.matchAll(/最终答案\s*[:：]\s*([A-D])(?=$|[\s。！!，,、）)*])/gu)]
  if (value?.kind === "single_choice" && explicitFinals.some(match => match[1] !== value.optionId.trim())) {
    reasons.push("inconsistent_final_option")
  }
  const problem = valueProblem({ ...candidate, value })
  const acceptedValue = problem === undefined ? value : undefined
  if (problem !== undefined) reasons.push(problem)

  if (STRUCTURED_KINDS.has(goal.kind) && acceptedValue === undefined && !reasons.includes("missing_structured_value")) {
    reasons.push("missing_structured_value")
  }

  const answer: GoalAnswer = { ...candidate, ...(acceptedValue === undefined ? {} : { value: acceptedValue }) }
  if (acceptedValue === undefined) delete answer.value
  return { answer, complete: reasons.length === 0, reasons }
}

export function acceptAnswer(input: AnswerAcceptanceInput): SolveResult {
  const reasonCodes = new Set<string>()
  const goals = input.goals
  const goalById = new Map(goals.map((goal) => [goal.id, goal]))

  // 1) 证据引用的一致性：对不上题面修订或目标的记录**不升级任何东西**。
  const evidence: EvidenceRecord[] = []
  for (const record of input.evidence) {
    if (!goalById.has(record.goalId) || record.problemRevision !== input.problemRevision) {
      reasonCodes.add("invalid_evidence_ref")
      continue
    }
    evidence.push(record)
  }
  const refutedGoalIds = new Set(evidence.filter((record) => record.evidence.status === "failed").map((record) => record.goalId))

  // 2) 候选去重：同一个目标先到的留下，后到的不覆盖已交付的结论。
  const candidates = new Map<string, GoalAnswer>()
  for (const candidate of input.candidates) {
    if (!goalById.has(candidate.goalId)) {
      reasonCodes.add("unknown_goal")
      continue
    }
    if (candidates.has(candidate.goalId)) {
      reasonCodes.add("duplicate_answer")
      continue
    }
    candidates.set(candidate.goalId, candidate)
  }

  // 3) 逐目标裁决。`answers` 保留**有正文**的候选（含结构值不完整的那一类），
  //    `unansweredGoalIds` 只列必答且未完整交付的目标 —— 两者不是同一件事。
  const answers: GoalAnswer[] = []
  const unansweredGoalIds: string[] = []
  const completeGoalIds = new Set<string>()
  for (const goal of goals) {
    const candidate = candidates.get(goal.id)
    const assessment = candidate === undefined ? null : assess(goal, candidate)
    if (assessment === null) {
      for (const reason of candidate === undefined ? ["missing_answer"] : ["empty_answer"]) reasonCodes.add(reason)
      if (goal.required) unansweredGoalIds.push(goal.id)
      continue
    }
    for (const reason of assessment.reasons) reasonCodes.add(reason)
    if (refutedGoalIds.has(goal.id)) {
      reasonCodes.add("refuted_answer")
      if (goal.required) unansweredGoalIds.push(goal.id)
      continue
    }
    answers.push(assessment.answer)
    if (assessment.complete) completeGoalIds.add(goal.id)
    else if (goal.required) unansweredGoalIds.push(goal.id)
  }

  // 4) 交付状态。`answered` 要求"有正文 + 必答目标全部完整"，**空目标列表不算**。
  const requiredGoals = goals.filter((goal) => goal.required)
  const requiredComplete = requiredGoals.filter((goal) => completeGoalIds.has(goal.id))
  const hasAnyAnswer = answers.length > 0
  const questions = input.clarificationQuestions.map((question) => question.trim()).filter((question) => question.length > 0)

  let status: SolveStatus
  switch (input.resolution) {
    case "clarification":
      if (questions.length === 0 && !hasAnyAnswer) {
        reasonCodes.add("clarification_without_question")
        status = "failed"
      } else {
        status = hasAnyAnswer ? "partial" : "needs_clarification"
      }
      break
    case "inconsistent":
      status = "inconsistent"
      break
    case "unsupported":
      status = hasAnyAnswer ? "partial" : "unsupported"
      break
    case "failed":
      status = "failed"
      break
    default:
      if (requiredGoals.length === 0) {
        reasonCodes.add("no_required_goals")
        status = "failed"
      } else if (requiredComplete.length === requiredGoals.length && hasAnyAnswer) {
        status = "answered"
      } else if (hasAnyAnswer || completeGoalIds.size > 0) {
        status = "partial"
      } else {
        status = "failed"
      }
      break
  }

  return {
    schemaVersion: SOLVE_RESULT_SCHEMA_VERSION,
    problemRevision: input.problemRevision,
    status,
    answers,
    unansweredGoalIds,
    evidence,
    reasonCodes: [...reasonCodes],
    clarificationQuestions: questions
  }
}
