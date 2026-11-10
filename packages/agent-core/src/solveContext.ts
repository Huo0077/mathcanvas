import { acceptAnswer } from "./answerAcceptance"
import type { AnswerGoal, EvidenceRecord, GoalAnswer, SolveResult } from "./answerResult"
import { understandProblem, taskIntentFor, type ProblemUnderstanding } from "./problemUnderstanding"

export interface SourceAttachment { attachmentId: string; sha256: string; page: number }
export interface ProblemSource {
  runId: string
  conversationId: string
  prompt: string
  attachments: readonly SourceAttachment[]
  corrections: readonly { id: string; text: string }[]
  sceneRevision: string
}
export interface SolveContext extends ProblemSource {
  problemRevision: string
  sourceRevision: string
  understanding: ProblemUnderstanding
  unrecognizedMathGoal: boolean
}
export interface BoundEvidenceRecord extends EvidenceRecord {
  candidateHash: string
  sourceRevision: string
  sceneRevision: string
  verifierVersion: string
}
export type HashText = (text: string) => Promise<string>

/** Records have an in-memory host capability; copying serialized JSON does not copy trust. */
const hostRecords = new WeakSet<object>()
const hashedCandidates = new WeakMap<GoalAnswer, { digest: string; canonical: string }>()
const knownDigests = new Map<string, Set<string>>()
const sha256 = /^[a-f0-9]{64}$/i

function freezeTree<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) freezeTree(nested)
    Object.freeze(value)
  }
  return value
}

function validAttachment(attachment: SourceAttachment): void {
  if (!attachment.attachmentId || !sha256.test(attachment.sha256) || !Number.isInteger(attachment.page) || attachment.page < 1) {
    throw new Error("invalid attachment identity")
  }
}

/** Prompt and attachment changes invalidate a problem; scene changes have their own revision. */
export async function createSolveContext(source: ProblemSource, hash: HashText): Promise<SolveContext> {
  if (!source.runId || !source.conversationId || !source.prompt.trim() || !source.sceneRevision) throw new Error("invalid problem source")
  const attachments = source.attachments.map(attachment => ({ ...attachment, sha256: attachment.sha256.toLowerCase() }))
  attachments.forEach(validAttachment)
  attachments.sort((a, b) => a.attachmentId.localeCompare(b.attachmentId) || a.page - b.page)
  const seen = new Set<string>()
  for (const attachment of attachments) {
    const key = attachment.attachmentId + ":" + attachment.page
    if (seen.has(key)) throw new Error("duplicate attachment identity")
    seen.add(key)
  }
  const corrections = source.corrections.map(item => ({ id: item.id, text: item.text }))
  if (corrections.some(item => !item.id || !item.text)) throw new Error("invalid user correction")
  const problemRevision = await hash(JSON.stringify({ prompt: source.prompt, attachments, corrections }))
  if (!sha256.test(problemRevision)) throw new Error("problem hash must be SHA-256")
  const sourceRevision = await hash(JSON.stringify({ conversationId: source.conversationId, problemRevision }))
  if (!sha256.test(sourceRevision)) throw new Error("source hash must be SHA-256")
  const understanding = understandProblem({ prompt: source.prompt, problemRevision })
  const unrecognizedMathGoal = understanding.goals.length === 0 && /(?:求|算出|计算|证明|解题|请解|几何|如图|图中|面积|体积|方程|函数|角度|角相等|结论)/u.test(source.prompt)
  if (understanding.goals.length === 0 && taskIntentFor(understanding, source.prompt, attachments.length > 0) === "drawing") {
    // A shape-only command may not match the narrow goal parser. It still needs a
    // host-issued draft goal; never let an empty-goal conversation certify a drawing.
    understanding.goals.push({ goalId: problemRevision + ":drawing", expectedKind: "drawing", partId: "stem",
      source: { sourceId: problemRevision, start: 0, end: source.prompt.length }, stateId: "s0", dependsOnGoalIds: [] })
  } else if (understanding.goals.length === 0 && !unrecognizedMathGoal) {
    understanding.goals.push({ goalId: problemRevision + ":conversation", expectedKind: "conversation", partId: "stem",
      source: { sourceId: problemRevision, start: 0, end: source.prompt.length }, stateId: "s0", dependsOnGoalIds: [] })
  }
  return { ...source, attachments, corrections, problemRevision, sourceRevision, understanding, unrecognizedMathGoal }
}

function canonicalCandidate(answer: GoalAnswer): string {
  return JSON.stringify({ goalId: answer.goalId, kind: answer.kind, displayText: answer.displayText,
    value: answer.value ?? null, evidenceRefs: [...answer.evidenceRefs].sort() })
}

export async function candidateHash(answer: GoalAnswer, hash: HashText): Promise<string> {
  const canonical = canonicalCandidate(answer)
  const id = await hash(canonical)
  if (!sha256.test(id)) throw new Error("candidate hash must be SHA-256")
  hashedCandidates.set(answer, { digest: id, canonical })
  const goalDigests = knownDigests.get(answer.goalId) ?? new Set<string>()
  goalDigests.add(id)
  knownDigests.set(answer.goalId, goalDigests)
  return id
}

/** Call only with a result from a trusted host verifier, never with model-supplied JSON. */
export function bindHostEvidence(context: SolveContext, answerHash: string, record: EvidenceRecord, verifierVersion: string): BoundEvidenceRecord {
  if (!sha256.test(answerHash) || !knownDigests.get(record.goalId)?.has(answerHash) || !verifierVersion || !record.id || !record.method || record.producer !== "host_verifier" ||
    record.problemRevision !== context.problemRevision || !context.understanding.goals.some(goal => goal.goalId === record.goalId)) {
    throw new Error("host evidence candidate, revision, goal or producer mismatch")
  }
  const copy = freezeTree({ ...record, evidence: structuredClone(record.evidence), candidateHash: answerHash,
    sourceRevision: context.sourceRevision, sceneRevision: context.sceneRevision, verifierVersion })
  hostRecords.add(copy)
  return copy
}

/** Reuse the existing acceptance state machine, adding fail-closed source/candidate binding. */
export function acceptSolvedCandidate(input: {
  context: SolveContext
  candidates: readonly GoalAnswer[]
  candidateHashes: Readonly<Record<string, string>>
  evidence: readonly BoundEvidenceRecord[]
  resolution: "answer" | "clarification" | "inconsistent" | "unsupported" | "failed"
  questions: readonly string[]
}): SolveResult {
  const goals: AnswerGoal[] = input.context.understanding.goals.map(goal => ({ id: goal.goalId, kind: goal.expectedKind, required: true }))
  const validEvidence: EvidenceRecord[] = []
  let invalidEvidence = false
  for (const record of input.evidence) {
    if (hostRecords.has(record) && record.producer === "host_verifier" && record.problemRevision === input.context.problemRevision &&
      record.sourceRevision === input.context.sourceRevision && record.sceneRevision === input.context.sceneRevision && record.verifierVersion &&
      input.candidates.some(candidate => candidate.goalId === record.goalId &&
        hashedCandidates.get(candidate)?.digest === record.candidateHash &&
        hashedCandidates.get(candidate)?.canonical === canonicalCandidate(candidate)) &&
      input.candidateHashes[record.goalId] === record.candidateHash) validEvidence.push(record)
    else invalidEvidence = true
  }
  const result = acceptAnswer({ problemRevision: input.context.problemRevision, goals, candidates: input.candidates,
    evidence: validEvidence, resolution: input.resolution, clarificationQuestions: input.questions })
  if (invalidEvidence) result.reasonCodes.push("invalid_evidence_ref")
  if (input.context.unrecognizedMathGoal) result.reasonCodes.push("unrecognized_math_goal")
  return result
}
