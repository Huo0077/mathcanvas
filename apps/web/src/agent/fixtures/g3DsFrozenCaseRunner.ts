import {
  canonicalContentHash,
  certifyDrawingAgainstContract,
  compilePlan,
  type Budget,
  type DrawingCertificateResult,
  type ExamRunBudget,
  type PlanEnvelope,
  type PlannerPort
} from "@draw/agent-core"
import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import {
  evaluateDrawingContract,
  evaluateDrawingContractSetByPolicy,
  type DrawingContractCase,
  type PolicyCandidateSlice
} from "../../../../../scripts/reliability-eval/drawingContracts"

export interface PublicFrozenCaseInput {
  readonly id: string
  readonly prompt: string
  readonly confirmedFigureRefs: readonly unknown[]
  readonly workspace: "geometry3d" | "conics"
}

export interface CandidateSliceArtifact {
  readonly scopeId: string
  readonly stateId?: string
  readonly branchId?: string
  readonly document?: GeometryDocument
  readonly plan?: PlanEnvelope
  readonly answerText?: string
  /** Test-only hook to simulate stale or tampered certificate candidate hash binding. */
  readonly overrideCertificateHash?: string
}

export interface CandidateSliceCertificate {
  readonly scopeId: string
  readonly stateId?: string
  readonly branchId?: string
  readonly candidateHash: string
  readonly certificateStatus: DrawingCertificateResult["certificateStatus"]
  readonly failedObligations?: readonly string[]
}

export interface FrozenDsCaseResult {
  readonly candidateSet: readonly CandidateSliceCertificate[]
  readonly modelInvoked: boolean
  readonly contractStatus: "passed" | "partial" | "failed" | "incomplete"
  readonly renderStatus: "pending" | "passed" | "failed"
  readonly commitStatus: "pending" | "passed" | "failed"
}

export interface FrozenDsCaseRunnerResponse {
  readonly modelInvoked: boolean
  readonly slices: readonly CandidateSliceArtifact[]
}

export type FrozenDsProvider =
  | ((publicCase: PublicFrozenCaseInput, budget: Budget | ExamRunBudget) => Promise<FrozenDsCaseRunnerResponse>)
  | PlannerPort

const ROMAN_SCOPE_NUMS: Record<string, number> = {
  I: 1, "Ⅰ": 1, II: 2, "Ⅱ": 2, III: 3, "Ⅲ": 3, IV: 4, "Ⅳ": 4
}

function toCertificateScopeId(scopeId: string): string {
  const trimmed = scopeId.trim()
  if (/^subquestion:[1-9]\d*$/.test(trimmed) || trimmed === "shared") return trimmed
  const arabic = /^[（(]?\s*([1-9]\d*)\s*[）)]?$/.exec(trimmed)
  if (arabic) return `subquestion:${arabic[1]}`
  const romanMatch = /^[（(]?\s*(I{1,3}|IV|[ⅠⅡⅢⅣ])\s*[）)]?$/i.exec(trimmed)
  if (romanMatch) {
    const n = ROMAN_SCOPE_NUMS[romanMatch[1]!.toUpperCase()] ?? ROMAN_SCOPE_NUMS[romanMatch[1]!]
    if (n) return `subquestion:${n}`
  }
  return trimmed
}

export function projectPublicFrozenCaseInput(input: {
  readonly id: string
  readonly prompt: string
  readonly confirmedFigureRefs?: readonly unknown[]
  readonly workspace: "geometry3d" | "conics"
}): PublicFrozenCaseInput {
  return {
    id: input.id,
    prompt: input.prompt,
    confirmedFigureRefs: input.confirmedFigureRefs ? [...input.confirmedFigureRefs] : [],
    workspace: input.workspace
  }
}

function materializeSliceDocument(
  slice: CandidateSliceArtifact,
  workspace: "geometry3d" | "conics",
  index: number
): GeometryDocument | null {
  if (slice.document) return slice.document
  if (slice.plan && slice.plan.kind === "plan") {
    const compiled = compilePlan(slice.plan, {
      document: createEmptyDocument(workspace),
      conversationId: `frozen-slice-${index}`,
      documentGeneration: 0,
      workspace
    })
    return compiled.ok && compiled.draftDocument ? compiled.draftDocument : null
  }
  return null
}

function buildPlanRequestForPublicInput(pub: PublicFrozenCaseInput) {
  return {
    run: {
      runId: `frozen-${pub.id}`,
      conversationId: `frozen-${pub.id}`,
      projectId: "local",
      phase: "planning" as const,
      target: {
        projectId: "local",
        documentId: `frozen-doc-${pub.id}`,
        workspace: pub.workspace,
        epoch: `epoch:${pub.id}`,
        generation: 0,
        contentHash: "empty"
      }
    },
    userMessage: pub.prompt,
    model: {
      channel: "native_tools" as const,
      tools: [],
      context: {
        preamble: "MathCanvas",
        handles: {
          target: {
            projectId: "local",
            documentId: `frozen-doc-${pub.id}`,
            workspace: pub.workspace,
            epoch: `epoch:${pub.id}`,
            generation: 0,
            contentHash: "empty"
          },
          sources: []
        },
        binding: { conversationId: `frozen-${pub.id}`, projectId: "local", documentId: `frozen-doc-${pub.id}`, generation: 0 },
        workspace: pub.workspace,
        facts: [],
        derived: [],
        selectedRefs: [],
        skills: [],
        availableActions: [],
        warnings: [],
        estimatedCharacters: 64
      }
    }
  }
}

export async function runFrozenDsCase(
  rawPublicInput: {
    readonly id: string
    readonly prompt: string
    readonly confirmedFigureRefs?: readonly unknown[]
    readonly workspace: "geometry3d" | "conics"
  },
  provider: FrozenDsProvider,
  budget: Budget | ExamRunBudget,
  options: { readonly contract?: DrawingContractCase } = {}
): Promise<FrozenDsCaseResult> {
  // Always strip any extra non-public fields before calling the model provider or planner.
  const publicCase = projectPublicFrozenCaseInput(rawPublicInput)

  const response: FrozenDsCaseRunnerResponse =
    typeof provider === "function"
      ? await provider(publicCase, budget)
      : await (async () => {
          const outcome = await provider.plan(buildPlanRequestForPublicInput(publicCase) as never)
          if ("plan" in outcome && outcome.plan.kind === "plan") {
            return {
              modelInvoked: true,
              slices: [{ scopeId: "shared", plan: outcome.plan, answerText: outcome.plan.answer }]
            }
          }
          return { modelInvoked: true, slices: [] }
        })()

  const candidateSet: CandidateSliceCertificate[] = []
  const evalSlices: PolicyCandidateSlice[] = []
  let allCertificatesPassed = response.slices.length > 0
  let anyCertificateHashMismatch = false

  for (let i = 0; i < response.slices.length; i += 1) {
    const slice = response.slices[i]!
    const doc = materializeSliceDocument(slice, publicCase.workspace, i)
    if (!doc) {
      allCertificatesPassed = false
      candidateSet.push({
        scopeId: slice.scopeId,
        ...(slice.stateId === undefined ? {} : { stateId: slice.stateId }),
        ...(slice.branchId === undefined ? {} : { branchId: slice.branchId }),
        candidateHash: "",
        certificateStatus: "blocked"
      })
      continue
    }

    const actualCandidateHash = canonicalContentHash(doc)
    const boundHash = slice.overrideCertificateHash ?? actualCandidateHash
    const cert = certifyDrawingAgainstContract({
      prompt: publicCase.prompt,
      document: doc,
      candidateHash: boundHash,
      sourceHash: boundHash,
      selectedScopeId: toCertificateScopeId(slice.scopeId)
    })
    const hashMatches = boundHash === actualCandidateHash
    if (!hashMatches) anyCertificateHashMismatch = true
    const effectiveCertStatus: DrawingCertificateResult["certificateStatus"] = !hashMatches
      ? "blocked"
      : cert.certificateStatus

    if (effectiveCertStatus !== "passed") {
      allCertificatesPassed = false
    }

    candidateSet.push({
      scopeId: slice.scopeId,
      ...(slice.stateId === undefined ? {} : { stateId: slice.stateId }),
      ...(slice.branchId === undefined ? {} : { branchId: slice.branchId }),
      candidateHash: actualCandidateHash,
      certificateStatus: effectiveCertStatus,
      ...(cert.failedObligations?.length ? { failedObligations: cert.failedObligations.map((f) => `${f.id}:${f.detail}`) } : {})
    })

    evalSlices.push({
      scopeId: slice.scopeId,
      ...(slice.stateId === undefined ? {} : { stateId: slice.stateId }),
      ...(slice.branchId === undefined ? {} : { branchId: slice.branchId }),
      candidate: doc,
      options: {
        verificationStatus: effectiveCertStatus === "passed" ? "passed" : "failed",
        answerText: slice.answerText ?? null,
        scopeId: slice.scopeId,
        ...(slice.stateId === undefined ? {} : { stateId: slice.stateId }),
        ...(slice.branchId === undefined ? {} : { branchId: slice.branchId })
      }
    })
  }

  let contractStatus: FrozenDsCaseResult["contractStatus"] = "failed"
  if (options.contract) {
    const policyEval = evaluateDrawingContractSetByPolicy(options.contract, evalSlices)
    contractStatus = policyEval.status
    if (anyCertificateHashMismatch || (!allCertificatesPassed && contractStatus === "passed")) {
      contractStatus = "failed"
    }
  } else if (allCertificatesPassed) {
    contractStatus = "passed"
  }

  return {
    candidateSet,
    modelInvoked: response.modelInvoked,
    contractStatus,
    renderStatus: "pending",
    commitStatus: "pending"
  }
}

export function compareLegacySingleVsMultiSliceReplay(
  contract: DrawingContractCase,
  singleCandidate: unknown,
  multiSlices: readonly PolicyCandidateSlice[]
): {
  readonly legacySingleStatus: "passed" | "partial" | "failed" | "incomplete"
  readonly multiSliceStatus: "passed" | "partial" | "failed" | "incomplete"
  readonly diverged: boolean
} {
  const singleRes = evaluateDrawingContract(contract, singleCandidate, { verificationStatus: "passed" })
  const multiRes = evaluateDrawingContractSetByPolicy(contract, multiSlices)
  return {
    legacySingleStatus: singleRes.status,
    multiSliceStatus: multiRes.status,
    diverged: singleRes.status !== multiRes.status
  }
}
