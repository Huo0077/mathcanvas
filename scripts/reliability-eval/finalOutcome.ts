export type Artifact = {
  runId: string
  id: string
  kind: "plan" | "answer"
  contentHash: string
  text?: string
}

export type AcceptedFinal = {
  runId: string
  terminal: "completed" | "awaiting_confirmation" | "failed" | "cancelled" | "waiting"
  artifactId: string | null
  contentHash: string | null
}

export function selectFinalArtifact(artifacts: readonly Artifact[], final: AcceptedFinal): Artifact | null {
  if (final.terminal !== "completed" && final.terminal !== "awaiting_confirmation") return null
  if (final.artifactId === null || final.contentHash === null) return null
  const expectedKind = final.terminal === "completed" ? "answer" : "plan"
  const hits = artifacts.filter(artifact => artifact.runId === final.runId
    && artifact.id === final.artifactId
    && artifact.contentHash === final.contentHash
    && artifact.kind === expectedKind)
  return hits.length === 1 ? hits[0]! : null
}
