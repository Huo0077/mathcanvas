import { createEmptyDocument } from "@draw/dsl"
import { createDocumentHandle, type DraftAction } from "@draw/scene-graph"
import { canonicalContentHash } from "@draw/agent-core"
import { describe, expect, it, vi } from "vitest"
import { createDraftStore } from "./draftStore"
import { createHostBridge } from "./hostBridge"
import { createSpeculativeCanvas } from "./speculativeCanvas"

describe("speculativeCanvas (Task F1 exploratory isolation layer)", () => {
  it("isolates exploratory actions from live documents, supports exact rollback, and restores prior candidateHash", () => {
    const baseDoc = createEmptyDocument("conics")
    const baseSnapshot = JSON.stringify(baseDoc)
    const baseHash = canonicalContentHash(baseDoc)

    const session = createSpeculativeCanvas(baseDoc, { runId: "spec-run-1" })
    expect(session.snapshot().speculativeOnly).toBe(true)
    expect(session.snapshot().candidateHash).toBe(baseHash)

    const ptA: DraftAction = {
      actionId: "planar.create_point",
      actionKey: "pt-a",
      factIds: [],
      inputs: { alias: "A", label: "A", points: [{ x: 0, y: 0 }] }
    }
    const ptB: DraftAction = {
      actionId: "planar.create_point",
      actionKey: "pt-b",
      factIds: [],
      inputs: { alias: "B", label: "B", points: [{ x: 3, y: 0 }] }
    }
    const segAB: DraftAction = {
      actionId: "planar.create_segment",
      actionKey: "seg-ab",
      factIds: [],
      inputs: { alias: "AB", label: "AB", points: [{ x: 0, y: 0 }, { x: 3, y: 0 }] }
    }

    const r1 = session.applyAction(ptA)
    expect(r1.ok).toBe(true)
    expect(r1.stepIndex).toBe(1)
    const hash1 = r1.candidateHash
    expect(hash1).not.toBe(baseHash)

    const r2 = session.applyAction(ptB)
    expect(r2.ok).toBe(true)
    expect(r2.stepIndex).toBe(2)

    const r3 = session.applyAction(segAB)
    expect(r3.ok).toBe(true)
    expect(r3.stepIndex).toBe(3)
    expect(session.snapshot().primitiveCount).toBe(3)

    // Invalid action must NOT corrupt step 3 checkpoint.
    const badStep = session.applyAction({
      actionId: "planar.create_point",
      actionKey: "bad-pt",
      factIds: [],
      inputs: { alias: "Bad", points: [{ x: Number.NaN, y: 0 }] }
    } as DraftAction)
    expect(badStep.ok).toBe(false)
    expect(session.snapshot().stepIndex).toBe(3)
    expect(session.snapshot().candidateHash).toBe(r3.candidateHash)

    // Rollback 2 steps -> must restore exact step 1 hash & primitives.
    const rolled = session.rollback(2)
    expect(rolled.stepIndex).toBe(1)
    expect(rolled.candidateHash).toBe(hash1)
    expect(rolled.primitiveCount).toBe(1)

    // Discard restores clean initial state.
    const discarded = session.discard()
    expect(discarded.stepIndex).toBe(0)
    expect(discarded.candidateHash).toBe(baseHash)
    expect(discarded.primitiveCount).toBe(0)

    // Original live document object was never mutated.
    expect(JSON.stringify(baseDoc)).toBe(baseSnapshot)
  })

  it("blocks HostBridge consent/commit on speculativeOnly drafts and allows promotion only through certified DraftStore", async () => {
    const liveDoc = createEmptyDocument("conics")
    let currentDoc = structuredClone(liveDoc)
    const replace = vi.fn((next: typeof liveDoc) => {
      currentDoc = next
    })
    const liveHandle = () => createDocumentHandle(currentDoc, "local", "epoch-1")

    const drafts = createDraftStore()
    const bridge = createHostBridge({
      runId: "spec-bridge-run",
      drafts,
      live: () => ({ document: currentDoc, handle: liveHandle() }),
      replace
    })

    // 1. Exploratory speculative draft staged directly with speculativeOnly: true -> HostBridge MUST block consent & commit.
    const specDraft = drafts.create(currentDoc, liveHandle())
    const ptAction: DraftAction = {
      actionId: "planar.create_point",
      actionKey: "spec-pt",
      factIds: [],
      inputs: { alias: "P", label: "P", points: [{ x: 1, y: 2 }] }
    }
    const specStaged = await drafts.stage(specDraft.draftId, [ptAction], specDraft.draftVersion, undefined, undefined, false, false, false, undefined, {
      speculativeOnly: true
    })
    expect(specStaged.ok).toBe(true)
    if (!specStaged.ok) return
    expect(specStaged.preview.speculativeOnly).toBe(true)

    const blockedConsent = bridge.requestConsent(specDraft.draftId)
    expect(blockedConsent.ok).toBe(false)
    if (!blockedConsent.ok) expect(blockedConsent.reason).toBe("unverified_diagram")
    expect(replace).not.toHaveBeenCalled()

    // 2. Promote verified exploratory session into non-speculative DraftStore draft -> hash matches cleanly.
    const session = createSpeculativeCanvas(currentDoc, { runId: "spec-promote" })
    session.applyAction(ptAction)
    const expectedHash = session.snapshot().candidateHash
    const promoted = await session.promoteToDraftStore(drafts, liveHandle())
    expect(promoted.ok).toBe(true)
    if (!promoted.ok) return
    expect(promoted.preview.speculativeOnly).toBeUndefined()
    expect(promoted.preview.previewHash).toBe(expectedHash)
  })
})
