import type { ClaimEvidence } from "./claimEvidence"

/**
 * **宿主答案合同（W2 / T2，2026-11-08）**。
 *
 * 这一层回答的是"这次到底交付了什么"：回答了几问、缺哪一问、证据是什么等级。
 * 它**不是**数学正确性的证明：`status: "answered"` 只表示目标有了可交付的非空回答，
 * 界面必须同时显示证据等级（证据为空就是"未核验"）。
 *
 * ## 信任边界
 *
 * `SolveResult` 由宿主产生，**不直接接受模型提交的"已核验"结果**。模型可以给候选正文、
 * 候选结构值与工具结果引用；只有宿主核验器能生成可信的 `EvidenceRecord`。
 * `producer` 字段本身不构成授权 —— 真正的约束是"谁能调用这个构造函数"，
 * 所以本文件只导出类型，不导出"从模型输出直接造 SolveResult"的入口。
 *
 * ## 与 `ClaimEvidence` 的关系
 *
 * 证据词表**沿用** `ClaimEvidence`，不另造一套"证明等级"：`verified_instance` /
 * `sampled` / `formally_proved` 三态互斥，其余状态表示"还没有证据"的各种原因。
 * `EvidenceRecord` 只是给引用补上身份（哪一问、哪一版题面、谁产生的、用什么方法）。
 */

export type SolveStatus = "answered" | "partial" | "needs_clarification" | "inconsistent" | "unsupported" | "failed"

export const SOLVE_STATUSES: readonly SolveStatus[] = ["answered", "partial", "needs_clarification", "inconsistent", "unsupported", "failed"]

export type AnswerKind = "single_choice" | "multiple_choice" | "numeric" | "interval" | "proof" | "drawing" | "conversation" | "unknown"

export const ANSWER_KINDS: readonly AnswerKind[] = ["single_choice", "multiple_choice", "numeric", "interval", "proof", "drawing", "conversation", "unknown"]

/**
 * 结构值：**判别联合，不是任意 JSON**。
 *
 * 三条硬约束（见方案 §8.2）：`kind` 与 `GoalAnswer.kind` 必须一致；
 * 数值只接受有限值（NaN / Infinity 拒绝）；`numeric.expression` 只被当作**字符串**，
 * 绝不进入 `eval`。
 */
export type AnswerValue =
  | { kind: "single_choice"; optionId: string }
  | { kind: "multiple_choice"; optionIds: string[] }
  | { kind: "numeric"; expression: string; approximation?: number; unit?: string }
  | { kind: "interval"; expression: string }
  | { kind: "proof"; conclusion: string }
  | { kind: "drawing"; draftId: string }
  | { kind: "conversation"; text: string }
  | { kind: "unknown"; text: string }

/** 一个要回答的目标（W2 先由宿主按信封派生，W3 再接真实子问）。 */
export interface AnswerGoal {
  id: string
  kind: AnswerKind
  /** 必答目标缺答会让整题落入 `partial` / `failed`；可选的缺失不阻塞。 */
  required: boolean
}

/** 模型给出的**候选**回答。宿主验收后才成为 `SolveResult.answers` 的一项。 */
export interface GoalAnswer {
  goalId: string
  kind: AnswerKind
  displayText: string
  value?: AnswerValue
  evidenceRefs: string[]
}

export interface EvidenceRecord {
  id: string
  goalId: string
  problemRevision: string
  producer: "host_verifier" | "legacy_adapter"
  method: string
  evidence: ClaimEvidence
  /** 新版宿主记录附有候选、来源、场景与核验器版本；旧记录读取兼容但不得自动升级为可信。 */
  candidateHash?: string
  sourceRevision?: string
  sceneRevision?: string
  verifierVersion?: string
}

export interface SolveResult {
  schemaVersion: "mathcanvas.solve.v1"
  problemRevision: string
  status: SolveStatus
  answers: GoalAnswer[]
  unansweredGoalIds: string[]
  evidence: EvidenceRecord[]
  reasonCodes: string[]
  clarificationQuestions: string[]
}

export const SOLVE_RESULT_SCHEMA_VERSION = "mathcanvas.solve.v1" as const

/**
 * **运行时守卫（W9）**：只认 `mathcanvas.solve.v1` 这一版。
 *
 * 旧会话里可能出现未来/未知版本的 `solveResult`（或手工伪造的字段）。界面与迁移层
 * 读到未知版本时必须**当成没有这个字段**：保留正文、标"历史回答，未重新核验"，
 * 而不是拿一个不认识的结构去渲染"已交付/已核验"。
 */
export function isSolveResultV1(value: unknown): value is SolveResult {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.schemaVersion !== SOLVE_RESULT_SCHEMA_VERSION) return false
  if (typeof candidate.problemRevision !== "string") return false
  if (!SOLVE_STATUSES.includes(candidate.status as SolveStatus)) return false
  for (const key of ["answers", "unansweredGoalIds", "evidence", "reasonCodes", "clarificationQuestions"]) {
    if (!Array.isArray(candidate[key])) return false
  }
  return (candidate.answers as unknown[]).every((answer) => {
    if (typeof answer !== "object" || answer === null) return false
    const item = answer as Record<string, unknown>
    return typeof item.goalId === "string"
      && typeof item.kind === "string"
      && ANSWER_KINDS.includes(item.kind as AnswerKind)
      && typeof item.displayText === "string"
      && Array.isArray(item.evidenceRefs)
  })
}
