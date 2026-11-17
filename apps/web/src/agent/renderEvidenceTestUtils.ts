import { buildLayoutModel, canonicalContentHash, type RenderEvidence } from "@draw/agent-core"

import type { CandidateRenderEvidenceInput } from "./hostBridge"

export function renderedCandidateEvidence(input: CandidateRenderEvidenceInput): RenderEvidence {
  return {
    mode: "rendered",
    evidenceTier: "rendered",
    runId: input.runId,
    draftId: input.draftId,
    draftVersion: input.draftVersion,
    documentHash: canonicalContentHash(input.candidate),
    ...buildLayoutModel(input.candidate as unknown as { primitives: readonly Record<string, unknown>[] })
  }
}
