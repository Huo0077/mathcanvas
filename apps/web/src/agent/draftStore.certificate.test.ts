import { createEmptyDocument } from "@draw/dsl"
import { buildDrawingCertificate, canonicalContentHash, createSolveContext, type DiagramVerificationReport } from "@draw/agent-core"
import { createDocumentHandle } from "@draw/scene-graph"
import { expect, it } from "vitest"
import { createDraftStore } from "./draftStore"

const prompt = "在正方体ABCD-A1B1C1D1中，AB=2，请作图。"
const hash = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, "0")).join("")
const diagram: DiagramVerificationReport = { status: "passed", checks: [{ kind: "fixedLength", sourceText: "AB=2", status: "passed", reason: "verified" }], sampleValues: [], proofScope: "figure-instance", proofScopeNote: "one sample", universalClaims: "not-proven" }

it("a later stage invalidates a host-minted drawing certificate", async () => {
  const drafts = createDraftStore()
  const document = createEmptyDocument("conics")
  const handle = createDocumentHandle(document, "project-1")
  const record = drafts.create(document, handle)
  const point = (alias: string) => ({ actionId: "planar.create_point" as const, actionKey: alias, factIds: [], inputs: { alias, points: [{ x: 1, y: 0 }] } })
  const first = await drafts.stage(record.draftId, [point("p1")], record.draftVersion, prompt)
  expect(first.ok).toBe(true)
  if (!first.ok) return
  const context = await createSolveContext({ runId: "run-1", conversationId: "conv-1", prompt, attachments: [], corrections: [], sceneRevision: handle.contentHash }, hash)
  const signed = buildDrawingCertificate({ context, draft: { draftId: record.draftId, draftVersion: first.preview.draftVersion, previewHash: first.preview.previewHash, candidateHash: canonicalContentHash(first.preview.candidate), sceneRevision: handle.contentHash, stageCount: first.preview.stageCount }, diagram,
    toolVerification: { status: "passed", checks: [{ id: "ok", status: "passed", detail: "ok" }], next_actions: [] },
    structuralChecks: [{ sourceText: "正方体ABCD-A1B1C1D1", status: "passed", entityIds: ["solid-1"] }], verifierVersion: "v1" })
  expect(signed.status).toBe("passed")
  if (signed.status !== "passed") return
  expect(drafts.setDrawingCertificate(record.draftId, first.preview.draftVersion + 1, signed.certificate)).toBe(false)
  expect(drafts.setDrawingCertificate(record.draftId, first.preview.draftVersion, structuredClone(signed.certificate))).toBe(false)
  expect(drafts.setDrawingCertificate(record.draftId, first.preview.draftVersion, signed.certificate)).toBe(true)
  expect(drafts.certificateOf(record.draftId)).toBe(signed.certificate)
  const second = await drafts.stage(record.draftId, [point("p2")], first.preview.draftVersion, prompt)
  expect(second.ok).toBe(true)
  expect(drafts.certificateOf(record.draftId)).toBeNull()
})