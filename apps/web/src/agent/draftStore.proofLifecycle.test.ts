import { createEmptyDocument } from "@draw/dsl"
import type { ProofChannel, ProofChannelResult } from "@draw/agent-core"
import type { DraftAction } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createDraftStore } from "./draftStore"

const PROMPT = "在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC"
const ACTION: DraftAction = {
  actionId: "solid.create_polyhedron", actionKey: "tetrahedron", factIds: [],
  inputs: { alias: "tetrahedron", vertexNames: ["P", "A", "B", "C"],
    vertices: [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }],
    faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]] }
}
const VERIFIED: ProofChannelResult = {
  outcome: "exited", exitCode: 0,
  stdout: "'draw_line_plane_perpendicular_goal' depends on axioms: [propext, Classical.choice, Quot.sound]\n",
  stderr: "", durationMs: 1, detail: "", backendVersion: "Lean 4.35.0-rc3 lifecycle test"
}
function deferredProof() {
  let release!: (result: ProofChannelResult) => void
  let enter!: () => void
  const entered = new Promise<void>((resolve) => { enter = resolve })
  const channel: ProofChannel = async () => {
    enter()
    return new Promise<ProofChannelResult>((resolve) => { release = resolve })
  }
  return { channel, entered, release: () => release(VERIFIED) }
}

describe("proof stage lifecycle: publish only into the live draft", () => {
  it("rejects a verified reply after its draft was invalidated", async () => {
    const proof = deferredProof()
    const store = createDraftStore(undefined, undefined, proof)
    const draft = store.create(createEmptyDocument("geometry3d"))
    const pending = store.stage(draft.draftId, [ACTION], draft.draftVersion, PROMPT, undefined, undefined, undefined, true)
    await proof.entered
    store.invalidate(draft.draftId, "document replaced while Lean was running")
    proof.release()
    expect(await pending).toMatchObject({ ok: false, reason: "unknown_draft" })
    expect(store.getPreview(draft.draftId)).toBeNull()
  })

  it("does not expose a half-published candidate while proof is pending", async () => {
    const proof = deferredProof()
    const store = createDraftStore(undefined, undefined, proof)
    const draft = store.create(createEmptyDocument("geometry3d"))
    const pending = store.stage(draft.draftId, [ACTION], draft.draftVersion, PROMPT, undefined, undefined, undefined, true)
    await proof.entered
    expect(store.getPreview(draft.draftId)).toMatchObject({ draftVersion: 1, stageCount: 0, candidate: { primitives: [] } })
    proof.release()
    const result = await pending
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.preview.proofAttempt).toMatchObject({ outcome: "verified", stale: null,
        binding: { inputHash: expect.stringMatching(/^[a-f0-9]{64}$/), backendVersion: VERIFIED.backendVersion } })
    }
  })

  it("does not overwrite a newer stage with a late verified reply", async () => {
    const proof = deferredProof()
    const store = createDraftStore(undefined, undefined, proof)
    const draft = store.create(createEmptyDocument("geometry3d"))
    const pending = store.stage(draft.draftId, [ACTION], draft.draftVersion, PROMPT, undefined, undefined, undefined, true)
    await proof.entered
    const newer = await store.stage(draft.draftId, [{ actionId: "parameter.create", actionKey: "new", factIds: [], inputs: { id: "theta", value: 1, label: "θ" } }], draft.draftVersion)
    expect(newer.ok).toBe(true)
    proof.release()
    expect(await pending).toMatchObject({ ok: false, reason: "stale_draft_version" })
    expect(store.getPreview(draft.draftId)).toEqual(newer.ok ? newer.preview : null)
    expect(store.getPreview(draft.draftId)?.proofAttempt).toBeUndefined()
  })

  it("does not treat a normalized rewrite as the original prompt", async () => {
    const store = createDraftStore(undefined, undefined, { channel: async () => VERIFIED })
    const draft = store.create(createEmptyDocument("geometry3d"))
    const original = PROMPT.replace(/\u6c42\u8bc1/, "AB:AC=1\uff0c\u6c42\u8bc1")
    const normalized = original.replace("AB:AC=1", "AB=AC")
    const first = await store.stage(draft.draftId, [ACTION], draft.draftVersion, original, undefined, undefined, undefined, true, [
      { original: "AB:AC=1", normalized: "AB=AC" }
    ])
    expect(first.ok && first.preview.proofAttempt?.outcome).toBe("verified")
    if (!first.ok) return
    expect(first.preview.promptNormalisation?.accepted).toHaveLength(1)
    const point = first.preview.candidate.primitives.find((primitive) => primitive.type === "point3" && primitive.label === "P")!
    const sameLabel: DraftAction = { actionId: "object.update_inputs", actionKey: "same", factIds: [], inputs: {
      target: { scope: "scene", ref: { documentId: first.preview.candidate.metadata.id, entityId: point.id } } as never, patch: { label: "P" }
    } }
    const second = await store.stage(draft.draftId, [sameLabel], first.preview.draftVersion, normalized)
    expect(second.ok, JSON.stringify(second)).toBe(true)
    if (second.ok) expect(second.preview.proofAttempt).toMatchObject({ outcome: "stale", stale: { kind: "input_changed" } })
  })

  it("invalidates the old proof when only the prompt changes", async () => {
    const store = createDraftStore(undefined, undefined, { channel: async () => VERIFIED })
    const draft = store.create(createEmptyDocument("geometry3d"))
    const first = await store.stage(draft.draftId, [ACTION], draft.draftVersion, PROMPT, undefined, undefined, undefined, true)
    expect(first.ok && first.preview.proofAttempt?.outcome).toBe("verified")
    if (!first.ok) return
    const point = first.preview.candidate.primitives.find((primitive) => primitive.type === "point3" && primitive.label === "P")!
    const sameLabel: DraftAction = { actionId: "object.update_inputs", actionKey: "same", factIds: [], inputs: {
      target: { scope: "scene", ref: { documentId: first.preview.candidate.metadata.id, entityId: point.id } } as never, patch: { label: "P" }
    } }
    const second = await store.stage(draft.draftId, [sameLabel], first.preview.draftVersion, PROMPT.replace("求证 PA ⊥ 平面 ABC", "求证 AB ⊥ AC"))
    expect(second.ok, JSON.stringify(second)).toBe(true)
    if (second.ok) expect(second.preview.proofAttempt).toMatchObject({ outcome: "stale", stale: { kind: "input_changed" } })
  })
})
