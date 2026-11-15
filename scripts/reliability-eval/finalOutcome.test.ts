import { describe, expect, it } from "vitest"

import { selectFinalArtifact, type Artifact } from "./finalOutcome"

const artifacts: readonly Artifact[] = [
  { runId: "r", id: "a1", kind: "answer", contentHash: "h1", text: "2" },
  { runId: "r", id: "a2", kind: "answer", contentHash: "h2", text: "3" },
  { runId: "r", id: "p1", kind: "plan", contentHash: "h3", text: "draft" }
]

describe("selectFinalArtifact", () => {
  it("does not let a correct earlier answer rescue an accepted wrong answer", () => {
    const selected = selectFinalArtifact(artifacts, { runId: "r", terminal: "completed", artifactId: "a2", contentHash: "h2" })

    expect(selected?.id).toBe("a2")
    expect(selected?.text).toBe("3")
    expect(selected?.text).not.toBe("2")
    expect(selectFinalArtifact(artifacts, { runId: "r", terminal: "cancelled", artifactId: "a1", contentHash: "h1" })).toBeNull()
  })

  it("accepts a corrected final answer instead of the discarded earlier answer", () => {
    const selected = selectFinalArtifact(artifacts, { runId: "r", terminal: "completed", artifactId: "a2", contentHash: "h2" })

    expect(selected?.text).toBe("3")
  })

  it("requires a plan for awaiting confirmation and an answer for completed", () => {
    expect(selectFinalArtifact(artifacts, { runId: "r", terminal: "awaiting_confirmation", artifactId: "p1", contentHash: "h3" })?.kind).toBe("plan")
    expect(selectFinalArtifact(artifacts, { runId: "r", terminal: "awaiting_confirmation", artifactId: "a2", contentHash: "h2" })).toBeNull()
    expect(selectFinalArtifact(artifacts, { runId: "r", terminal: "completed", artifactId: "p1", contentHash: "h3" })).toBeNull()
  })

  it("rejects cross-run, wrong-hash, duplicate, failed and waiting selections", () => {
    expect(selectFinalArtifact(artifacts, { runId: "other", terminal: "completed", artifactId: "a2", contentHash: "h2" })).toBeNull()
    expect(selectFinalArtifact(artifacts, { runId: "r", terminal: "completed", artifactId: "a2", contentHash: "wrong" })).toBeNull()
    expect(selectFinalArtifact([...artifacts, artifacts[1]!], { runId: "r", terminal: "completed", artifactId: "a2", contentHash: "h2" })).toBeNull()
    expect(selectFinalArtifact(artifacts, { runId: "r", terminal: "failed", artifactId: "a2", contentHash: "h2" })).toBeNull()
    expect(selectFinalArtifact(artifacts, { runId: "r", terminal: "waiting", artifactId: "a2", contentHash: "h2" })).toBeNull()
  })
})
