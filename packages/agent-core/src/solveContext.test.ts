import { describe, expect, it } from "vitest"
import { acceptSolvedCandidate, bindHostEvidence, candidateHash, createSolveContext } from "./solveContext"
import type { EvidenceRecord, GoalAnswer } from "./answerResult"

const sha = async (text: string) => {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("")
}
const base = { runId: "r1", conversationId: "c1", attachments: [], corrections: [], sceneRevision: "empty-scene" }
const prompt = "矩形 ABCD 中 AB=4，BC=2。沿 AC 将三角形 ABC 折起 90°，求折前BC与折后B'C的长度。"
const evidence = (goalId: string, revision: string): EvidenceRecord => ({
  id: "host-evidence-1", goalId, problemRevision: revision, producer: "host_verifier",
  method: "independent_substitution",
  evidence: { status: "failed", solver: "model", residuals: { given: 1 }, degreesOfFreedom: 0, nextActions: [] }
})
const answer = (goalId: string, value = "2"): GoalAnswer => ({
  goalId, kind: "numeric", displayText: value, value: { kind: "numeric", expression: value }, evidenceRefs: []
})

it("two questions with the same empty scene have different problem revisions", async () => {
  const a = await createSolveContext({ ...base, prompt: "求AB的长度" }, sha)
  const b = await createSolveContext({ ...base, prompt: "求CD的长度" }, sha)
  expect(a.problemRevision).not.toBe(b.problemRevision)
  expect(a.sceneRevision).toBe(b.sceneRevision)
  expect(a.understanding.goals[0]?.source.sourceId).toBe(a.problemRevision)
})

it("cannot mint host evidence using a digest that was never computed for a candidate", async () => {
  const ctx = await createSolveContext({ ...base, prompt }, sha)
  const candidate = answer(ctx.understanding.goals[0]!.goalId)
  expect(() => bindHostEvidence(ctx, "f".repeat(64), evidence(candidate.goalId, ctx.problemRevision), "v1")).toThrow(/candidate/i)
})

it("attachment hashes and user corrections are identities; ordering of attachments is stable", async () => {
  const att = { attachmentId: "a1", sha256: "a".repeat(64), page: 1 }
  const other = { attachmentId: "a2", sha256: "b".repeat(64), page: 1 }
  const x = await createSolveContext({ ...base, prompt, attachments: [att, other] }, sha)
  const sorted = await createSolveContext({ ...base, prompt, attachments: [other, att] }, sha)
  const changedImage = await createSolveContext({ ...base, prompt, attachments: [{ ...att, sha256: "c".repeat(64) }, other] }, sha)
  const corrected = await createSolveContext({ ...base, prompt, attachments: [att, other], corrections: [{ id: "c1", text: "BC=3" }] }, sha)
  expect(x.problemRevision).toBe(sorted.problemRevision)
  expect(x.problemRevision).not.toBe(changedImage.problemRevision)
  expect(x.problemRevision).not.toBe(corrected.problemRevision)
  expect(await createSolveContext({ ...base, prompt, conversationId: "different" }, sha)).toMatchObject({ problemRevision: expect.any(String) })
  await expect(createSolveContext({ ...base, prompt, attachments: [att, att] }, sha)).rejects.toThrow(/duplicate/i)
})

it("tracks the actual two required goals; a partial candidate cannot complete the task", async () => {
  const ctx = await createSolveContext({ ...base, prompt }, sha)
  expect(ctx.understanding.goals).toHaveLength(2)
  const first = answer(ctx.understanding.goals[0]!.goalId)
  const result = acceptSolvedCandidate({ context: ctx, candidates: [first], candidateHashes: { [first.goalId]: await candidateHash(first, sha) }, evidence: [], resolution: "answer", questions: [] })
  expect(result.status).toBe("partial")
  expect(result.unansweredGoalIds).toEqual([ctx.understanding.goals[1]!.goalId])
  expect(result.evidence).toEqual([])
})

it("host evidence cannot be reused for another answer, goal, question or conversation", async () => {
  const ctx = await createSolveContext({ ...base, prompt }, sha)
  const goalId = ctx.understanding.goals[0]!.goalId
  const a = answer(goalId, "2")
  const b = answer(goalId, "3")
  const bound = bindHostEvidence(ctx, await candidateHash(a, sha), evidence(goalId, ctx.problemRevision), "v1")
  const verdict = (context: typeof ctx, candidate: GoalAnswer, hash: string, records: typeof bound[]) => acceptSolvedCandidate({
    context, candidates: [candidate], candidateHashes: { [candidate.goalId]: hash }, evidence: records, resolution: "answer", questions: []
  })
  expect(verdict(ctx, a, await candidateHash(a, sha), [bound]).reasonCodes).toContain("refuted_answer")
  const reused = verdict(ctx, b, await candidateHash(b, sha), [bound])
  expect(reused.reasonCodes).toContain("invalid_evidence_ref")
  expect(reused.answers).toHaveLength(1)
  expect(reused.evidence).toHaveLength(0)
  const another = await createSolveContext({ ...base, prompt, conversationId: "c2" }, sha)
  expect(verdict(another, answer(another.understanding.goals[0]!.goalId), await candidateHash(answer(another.understanding.goals[0]!.goalId), sha), [bound]).evidence).toHaveLength(0)
  const changed = await createSolveContext({ ...base, prompt, corrections: [{ id: "u1", text: "BC=3" }] }, sha)
  expect(verdict(changed, answer(changed.understanding.goals[0]!.goalId), await candidateHash(answer(changed.understanding.goals[0]!.goalId), sha), [bound]).evidence).toHaveLength(0)
  const aHash = await candidateHash(a, sha)
  expect(() => bindHostEvidence(ctx, aHash, evidence(ctx.understanding.goals[1]!.goalId, "wrong"), "v1")).toThrow(/revision/i)
})

it("a mutable host evidence payload cannot change its verdict after binding", async () => {
  const ctx = await createSolveContext({ ...base, prompt }, sha)
  const candidate = answer(ctx.understanding.goals[0]!.goalId)
  const hash = await candidateHash(candidate, sha)
  const original = evidence(candidate.goalId, ctx.problemRevision)
  const bound = bindHostEvidence(ctx, hash, original, "v1")
  original.evidence.status = "unknown"
  const result = acceptSolvedCandidate({ context: ctx, candidates: [candidate], candidateHashes: { [candidate.goalId]: hash },
    evidence: [bound], resolution: "answer", questions: [] })
  expect(result.reasonCodes).toContain("refuted_answer")
  expect(Object.isFrozen(bound.evidence)).toBe(true)
})

it("scene changes and candidate mutation invalidate previously bound host evidence", async () => {
  const ctx = await createSolveContext({ ...base, prompt }, sha)
  const goalId = ctx.understanding.goals[0]!.goalId
  const candidate = answer(goalId, "2")
  const hash = await candidateHash(candidate, sha)
  const bound = bindHostEvidence(ctx, hash, evidence(goalId, ctx.problemRevision), "v1")
  const sceneChanged = await createSolveContext({ ...base, prompt, sceneRevision: "different-scene" }, sha)
  const staleScene = acceptSolvedCandidate({ context: sceneChanged, candidates: [candidate],
    candidateHashes: { [goalId]: hash }, evidence: [bound], resolution: "answer", questions: [] })
  expect(staleScene.evidence).toHaveLength(0)
  candidate.displayText = "3"
  candidate.value = { kind: "numeric", expression: "3" }
  const mutated = acceptSolvedCandidate({ context: ctx, candidates: [candidate],
    candidateHashes: { [goalId]: hash }, evidence: [bound], resolution: "answer", questions: [] })
  expect(mutated.evidence).toHaveLength(0)
  expect(mutated.reasonCodes).toContain("invalid_evidence_ref")
})

it("two independent host verifiers may use the same candidate digest without overwriting each other", async () => {
  const ctx = await createSolveContext({ ...base, prompt }, sha)
  const first = answer(ctx.understanding.goals[0]!.goalId)
  const second = answer(ctx.understanding.goals[0]!.goalId)
  const h1 = await candidateHash(first, sha)
  const h2 = await candidateHash(second, sha)
  const bound = bindHostEvidence(ctx, h1, evidence(first.goalId, ctx.problemRevision), "v1")
  const result = acceptSolvedCandidate({ context: ctx, candidates: [second], candidateHashes: { [second.goalId]: h2 },
    evidence: [bound], resolution: "answer", questions: [] })
  expect(result.reasonCodes).toContain("refuted_answer")
})

it("bound evidence passed for another goal is never accepted even if it came from the host", async () => {
  const ctx = await createSolveContext({ ...base, prompt }, sha)
  const first = answer(ctx.understanding.goals[0]!.goalId)
  const second = answer(ctx.understanding.goals[1]!.goalId)
  const firstHash = await candidateHash(first, sha)
  const secondHash = await candidateHash(second, sha)
  const bound = bindHostEvidence(ctx, firstHash, evidence(first.goalId, ctx.problemRevision), "v1")
  const renamed = { ...bound, goalId: second.goalId, candidateHash: secondHash }
  const result = acceptSolvedCandidate({ context: ctx, candidates: [second], candidateHashes: { [second.goalId]: secondHash },
    evidence: [renamed], resolution: "answer", questions: [] })
  expect(result.evidence).toHaveLength(0)
  expect(result.reasonCodes).toContain("invalid_evidence_ref")
})

it("even the same-answer evidence cannot be reused in another conversation", async () => {
  const ctx = await createSolveContext({ ...base, prompt }, sha)
  const candidate = answer(ctx.understanding.goals[0]!.goalId)
  const hash = await candidateHash(candidate, sha)
  const bound = bindHostEvidence(ctx, hash, evidence(candidate.goalId, ctx.problemRevision), "v1")
  const other = await createSolveContext({ ...base, prompt, conversationId: "c2" }, sha)
  const result = acceptSolvedCandidate({ context: other, candidates: [candidate], candidateHashes: { [candidate.goalId]: hash },
    evidence: [bound], resolution: "answer", questions: [] })
  expect(result.evidence).toHaveLength(0)
  expect(result.reasonCodes).toContain("invalid_evidence_ref")
})

it("unknown mathematical goals refuse model-supplied conversation goals", async () => {
  const ctx = await createSolveContext({ ...base, prompt: "请解这道几何题：如图所示，算出图形结果。" }, sha)
  const forged: GoalAnswer = { goalId: ctx.problemRevision + ":conversation", kind: "conversation", displayText: "答案A", evidenceRefs: [] }
  const result = acceptSolvedCandidate({ context: ctx, candidates: [forged],
    candidateHashes: { [forged.goalId]: await candidateHash(forged, sha) }, evidence: [], resolution: "answer", questions: [] })
  expect(result.status).not.toBe("answered")
  expect(result.reasonCodes).toContain("unrecognized_math_goal")
})

it("a forged model evidence object is never trusted, nor can duplicates replace an earlier answer", async () => {
  const ctx = await createSolveContext({ ...base, prompt }, sha)
  const first = answer(ctx.understanding.goals[0]!.goalId)
  const hash = await candidateHash(first, sha)
  const forged = { ...evidence(first.goalId, ctx.problemRevision), candidateHash: hash, sourceRevision: ctx.sourceRevision, sceneRevision: ctx.sceneRevision, verifierVersion: "v1" }
  const result = acceptSolvedCandidate({ context: ctx, candidates: [first, answer(first.goalId, "999")], candidateHashes: { [first.goalId]: hash }, evidence: [forged], resolution: "answer", questions: [] })
  expect(result.evidence).toHaveLength(0)
  expect(result.answers[0]?.displayText).toBe("2")
  expect(result.reasonCodes).toEqual(expect.arrayContaining(["duplicate_answer", "invalid_evidence_ref"]))
})

describe("chat and unknown problems", () => {
  it("ordinary conversation still delivers a conversation answer, without verified evidence", async () => {
    const ctx = await createSolveContext({ ...base, prompt: "你好，请介绍一下功能" }, sha)
    const chat = answer(ctx.understanding.goals[0]!.goalId)
    const candidate = { ...chat, kind: "conversation" as const, displayText: "你好", value: { kind: "conversation" as const, text: "你好" } }
    const result = acceptSolvedCandidate({ context: ctx, candidates: [candidate], candidateHashes: { [candidate.goalId]: await candidateHash(candidate, sha) }, evidence: [], resolution: "answer", questions: [] })
    expect(result.status).toBe("answered")
    expect(result.evidence).toEqual([])
  })
  it("without an explicit goal, a mathematical statement must not be completed", async () => {
    const ctx = await createSolveContext({ ...base, prompt: "图中的角相等，请给出结论。" }, sha)
    expect(ctx.unrecognizedMathGoal).toBe(true)
    expect(ctx.understanding.goals).toHaveLength(0)
  })
  it("unrecognized math goal never becomes a default conversation success", async () => {
    const ctx = await createSolveContext({ ...base, prompt: "请解这道几何题：如图所示，算出图形结果。" }, sha)
    const candidate: GoalAnswer = { goalId: ctx.problemRevision + ":conversation", kind: "conversation", displayText: "A", evidenceRefs: [] }
    const result = acceptSolvedCandidate({ context: ctx, candidates: [candidate], candidateHashes: {}, evidence: [], resolution: "answer", questions: [] })
    expect(result.status).not.toBe("answered")
    expect(result.reasonCodes).toContain("unrecognized_math_goal")
  })
})
