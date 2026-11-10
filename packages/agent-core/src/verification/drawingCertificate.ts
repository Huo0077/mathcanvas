import { canonicalContentHash } from "../hashing"
import type { DiagramVerificationReport } from "../diagramVerification"
import type { VerificationReport } from "../contracts"
import type { SolveContext } from "../solveContext"
import { understandProblem } from "../problemUnderstanding"
import { tryBuildScopedPyramidPlan } from "../scopedPyramidPlan"

export interface DrawingDraftIdentity {
  draftId: string
  draftVersion: number
  previewHash: string
  candidateHash: string
  sceneRevision: string
  stageCount: number
}
export interface StructuralDrawingCheck {
  /** An exact span from the original prompt, verified against the staged candidate by the host. */
  sourceText: string
  status: "passed" | "failed" | "unverified"
  entityIds: readonly string[]
}
export interface DrawingCertificate {
  kind: "drawing"
  draftId: string
  draftVersion: number
  previewHash: string
  candidateHash: string
  sceneRevision: string
  problemRevision: string
  sourceRevision: string
  promptHash: string
  verifierVersion: string
  obligationManifestHash: string
  requiredGoalIds: readonly string[]
  obligations: readonly { obligationId: string; kind: string; sourceText: string; sourceSpan: { start: number; end: number }; targetNames: readonly string[]; checkStatus: "passed" }[]
  structuralChecks: readonly StructuralDrawingCheck[]
  evidenceScope: "figure-instance" | "parameter-instance"
  status: "passed"
}
export interface DrawingCertificateInput {
  context: SolveContext
  draft: DrawingDraftIdentity
  diagram: DiagramVerificationReport | undefined
  toolVerification: VerificationReport | undefined
  structuralChecks: readonly StructuralDrawingCheck[]
  verifierVersion: string
}
type BuildResult = { status: "passed"; certificate: DrawingCertificate } | { status: "unsupported"; reason: string; certificate?: never }
export const DRAWING_VERIFIER_VERSION = "drawing-v1" as const
const minted = new WeakSet<object>()
const scopedContexts = new WeakSet<object>()
const sha256 = /^[a-f0-9]{64}$/i

/** Unaccounted words are not discarded as punctuation. This is intentionally conservative. */
function unaccountedSource(prompt: string, spans: readonly { start: number; end: number }[], scoped: boolean): string {
  const covered = new Array<boolean>(prompt.length).fill(false)
  for (const { start, end } of spans) for (let i = start; i < end; i += 1) covered[i] = true
  const gaps: { start: number; end: number; text: string }[] = []
  for (let i = 0; i < prompt.length;) {
    if (covered[i]) { i += 1; continue }
    const start = i
    while (i < prompt.length && !covered[i]) i += 1
    const text = prompt.slice(start, i).replace(/[\s\uFF0C\u3002\uFF1B\uFF1A\u3001,.!\uFF01?\uFF1F\uFF08\uFF09()[\]{}]/gu, "")
    if (text) gaps.push({ start, end: i, text })
  }
  // Each omitted span is a *whole syntactic connector* in its proper position.
  // Removing individual characters globally can erase a second instruction.
  const first = new Set(["\u5982\u56fe", "\u5728", "\u5982\u56fe\u5728", "\u8bf7\u753b\u4e00\u4e2a", "\u5efa\u4e2a", "\u5efa\u4e00\u4e2a", "\u753b\u4e00\u4e2a", "\u518d\u5efa\u4e00\u4e2a", "\u8bf7\u4f5c\u56fe"])
  const middle = new Set(["\u4e2d", "\u7684", "\u753b\u51fa", "\u5e95\u9762\u8fb9\u957f", "\u4fa7\u68f1\u957f", "\u70b9", "\u6c42\u8bc1", "\u8bc1\u660e", "\u6c42", "\u4e0e", "\u4f7f\u5f97", "\u4f7f", "\u4e14", "\u4e14\u9898\u4e2d\u5f15\u7528\u7684"])
  const last = new Set(["\u8bf7\u4f5c\u56fe", "\u753b\u793a\u610f\u56fe", "\u8bf7\u753b\u9898\u8bbe\u793a\u610f\u56fe"])
  for (const gap of gaps) {
    const valid = gap.start === 0 ? first.has(gap.text) || /^(?:\d+)?\u5df2\u77e5\u51fd\u6570$/u.test(gap.text) || scoped && /^(?:\d+)?\u2605\u672c\u5c0f\u9898\u6ee1\u5206\d+\u5206\u5982\u56fe$/u.test(gap.text)
      : gap.end === prompt.length ? last.has(gap.text)
        : middle.has(gap.text) || scoped && gap.text === "\u82e5" || /^(?:1|i)\u6c42$/u.test(gap.text)
    if (!valid) return gap.text
  }
  return ""
}

/** Only the host deterministic router may narrow a multi-question prompt to its explicitly constructed second-question diagram. */
export function scopedDrawingContext(context: SolveContext, requestedScope: string): SolveContext | null {
  const routed = tryBuildScopedPyramidPlan(context.prompt)
  if (!routed || routed.diagramPrompt !== requestedScope) return null
  const understanding = understandProblem({ prompt: requestedScope, problemRevision: context.problemRevision })
  const derived = { ...context, prompt: requestedScope, understanding, unrecognizedMathGoal: understanding.goals.length === 0 }
  scopedContexts.add(derived)
  return derived
}
export function buildDrawingCertificate(input: DrawingCertificateInput): BuildResult {
  const { context, draft, diagram, toolVerification, structuralChecks } = input
  const refuse = (reason: string): BuildResult => ({ status: "unsupported", reason })
  if (!draft.draftId || !Number.isInteger(draft.draftVersion) || draft.draftVersion < 1 || draft.stageCount < 1
    || !sha256.test(draft.previewHash) || !sha256.test(draft.candidateHash) || !input.verifierVersion
    || context.sceneRevision !== draft.sceneRevision) return refuse("stale or invalid candidate identity")
  const givens = context.understanding.ir.obligations.filter(item => item.role === "given" || item.role === "construction")
  if ((givens.length > 0 && (!diagram || diagram.checks.length === 0)) || (diagram && (diagram.status !== "passed" || diagram.checks.some(check => check.status !== "passed" || check.kind === "unparsed")))) {
    const failures = diagram?.checks.filter(check => check.status !== "passed" || check.kind === "unparsed")
      .map(check => `${check.sourceText}\uff1a${check.reason}`).join("\uff1b")
    return refuse(failures ? `${context.understanding.ir.unverified.length > 0 ? "\u7cfb\u7edf\u6682\u672a\u80fd\u5b8c\u6574\u89e3\u6790\u6761\u4ef6\uff1b" : ""}\u9898\u8bbe\u5c1a\u672a\u6838\u9a8c\uff1a${failures}` : "\u9898\u8bbe\u5c1a\u672a\u6838\u9a8c\uff1a\u6ca1\u6709\u5b8c\u6574\u7684\u56fe\u5f62\u6838\u9a8c\u62a5\u544a")
  }
  if (!toolVerification || toolVerification.status !== "passed" || toolVerification.checks.length === 0 || toolVerification.checks.some(check => check.status !== "passed")) return refuse("tool verification missing or incomplete")
  if (context.understanding.ir.unverified.length > 0 || context.unrecognizedMathGoal) return refuse("original text contains unrecognized obligations")
  if (structuralChecks.length === 0 || structuralChecks.some(check => check.status !== "passed" || check.entityIds.length === 0 || check.entityIds.some(id => !id))) return refuse("structural identity has not been verified")
  if (givens.some(item => item.judgeability !== "supported" || item.end <= item.start || context.prompt.slice(item.start, item.end) !== item.sourceText)) return refuse("original givens lack verifiable source spans")
  const remainingChecks = [...(diagram?.checks ?? [])]
  for (const item of givens) {
    const index = remainingChecks.findIndex(check => check.kind === item.kind && check.sourceText === item.sourceText && check.status === "passed")
    if (index < 0) {
      // A LaTeX equation is normalized before the diagram checker sees it, so its
      // report uses a different spelling. Accept only the separate host structural
      // check that parsed the *original* formula and compared the final expression.
      const originalFormulaBound = item.kind === "functionGraph" && structuralChecks.some(check => check.status === "passed"
        && check.sourceText.includes(item.sourceText) && check.entityIds.length === 1)
      if (!originalFormulaBound) return refuse(`unverified given: ${item.sourceText}`)
      continue
    }
    remainingChecks.splice(index, 1)
  }
  const spans = givens.map(item => ({ start: item.start, end: item.end }))
  for (const goal of context.understanding.ir.obligations.filter(item => item.role === "goal")) {
    if (goal.end > goal.start && context.prompt.slice(goal.start, goal.end) === goal.sourceText) spans.push({ start: goal.start, end: goal.end })
  }
  for (const check of structuralChecks) {
    const start = context.prompt.indexOf(check.sourceText)
    if (start < 0) return refuse("structural evidence is not in the original prompt")
    spans.push({ start, end: start + check.sourceText.length })
  }
  const remainder = unaccountedSource(context.prompt, spans, scopedContexts.has(context))
  if (remainder) return refuse(`unaccounted source text remains: ${remainder.slice(0, 60)}`)
  const obligations = givens.map(item => ({ obligationId: item.id, kind: item.kind, sourceText: item.sourceText,
    sourceSpan: { start: item.start, end: item.end }, targetNames: [...item.targets], checkStatus: "passed" as const }))
  const certificate: DrawingCertificate = Object.freeze({
    kind: "drawing", draftId: draft.draftId, draftVersion: draft.draftVersion, previewHash: draft.previewHash,
    candidateHash: draft.candidateHash, sceneRevision: draft.sceneRevision, problemRevision: context.problemRevision,
    sourceRevision: context.sourceRevision, promptHash: canonicalContentHash({ prompt: context.prompt }), verifierVersion: input.verifierVersion,
    obligationManifestHash: canonicalContentHash(obligations.map(item => ({ id: item.obligationId, sourceText: item.sourceText, kind: item.kind }))),
    requiredGoalIds: Object.freeze(context.understanding.goals.map(item => item.goalId)),
    obligations: Object.freeze(obligations.map(item => Object.freeze({ ...item, sourceSpan: Object.freeze({ ...item.sourceSpan }), targetNames: Object.freeze([...item.targetNames]) }))),
    structuralChecks: Object.freeze(structuralChecks.map(item => Object.freeze({ ...item, entityIds: Object.freeze([...item.entityIds]) }))),
    evidenceScope: diagram?.proofScope ?? "figure-instance", status: "passed"
  })
  minted.add(certificate)
  return { status: "passed", certificate }
}

export function canCommitDrawing(certificate: DrawingCertificate | null | undefined,
  current: DrawingDraftIdentity & { problemRevision: string; sourceRevision: string; obligationManifestHash: string; verifierVersion: string }): boolean {
  return !!certificate && minted.has(certificate) && certificate.status === "passed"
    && certificate.draftId === current.draftId && certificate.draftVersion === current.draftVersion
    && certificate.previewHash === current.previewHash && certificate.candidateHash === current.candidateHash
    && certificate.sceneRevision === current.sceneRevision && certificate.problemRevision === current.problemRevision
    && certificate.sourceRevision === current.sourceRevision && certificate.obligationManifestHash === current.obligationManifestHash
    && certificate.verifierVersion === current.verifierVersion && current.stageCount > 0
}