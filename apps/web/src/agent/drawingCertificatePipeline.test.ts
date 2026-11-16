import { createBudget, NUMERIC_POLICY_VERSION, PLAN_SCHEMA_VERSION, type PlannerPort } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createAgentRuntime } from "./agentRuntime"
import { createDraftStore } from "./draftStore"
import { createHostBridge } from "./hostBridge"

const VALID_TETRA_ACTION = {
  actionId: "solid.create_polyhedron",
  actionKey: "tetrahedron",
  factIds: [],
  inputs: {
    alias: "tetrahedron",
    vertexNames: ["A", "B", "C", "D"],
    vertices: [
      { x: 0, y: 0, z: 1 },
      { x: -1, y: 0, z: 0 },
      { x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
      { x: 1, y: 0, z: 0 }
    ],
    faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]]
  }
} as const

function setupRuntime(options: {
  planner?: PlannerPort
  enableCompleteCertificate?: boolean
  conversationId?: string
  readConversationId?: () => string | null
}) {
  let doc = createEmptyDocument("geometry3d")
  const writes: number[] = []
  const readDoc = () => doc
  const handle = () => ({
    projectId: "proj-cert",
    documentId: doc.metadata.id,
    workspace: "geometry3d" as const,
    epoch: `epoch:${doc.metadata.id}`,
    generation: doc.revision,
    contentHash: contentFingerprint(doc)
  })
  const defaultPlanner: PlannerPort = {
    async plan() {
      return {
        plan: {
          schemaVersion: PLAN_SCHEMA_VERSION,
          kind: "plan",
          goal: "画三棱锥示意图",
          factIds: [],
          actions: [VALID_TETRA_ACTION] as never
        },
        requestId: "req-cert-1",
        attemptId: "att-cert-1"
      }
    }
  }
  const runtime = createAgentRuntime({
    readDocument: readDoc,
    writeDocument: (candidate) => {
      doc = candidate
      writes.push(candidate.revision)
    },
    planner: options.planner ?? defaultPlanner,
    budget: createBudget(),
    readSceneDocuments: () => [{ handle: handle(), document: doc }],
    projectId: "proj-cert",
    runId: "run-cert",
    ...(options.conversationId ? { conversationId: options.conversationId } : {}),
    ...(options.readConversationId ? { readConversationId: options.readConversationId } : {}),
    ...(options.enableCompleteCertificate !== undefined ? { enableCompleteCertificate: options.enableCompleteCertificate } : {}),
    exportPreflight: {
      preflight: () => ({
        format: "svg",
        supported: true,
        requiresUserAcceptance: false,
        omitted: [],
        fontLoss: [],
        approximationNotes: [],
        blockedReasons: [],
        projectedEntityCount: 0
      })
    },
    candidateRenderEvidence: ({ runId, draftId, draftVersion, documentHash }) => ({
      mode: "structured_only",
      runId,
      draftId,
      draftVersion,
      documentHash,
      viewport: { width: 800, height: 600 },
      boxes: [{ id: "tetrahedron", kind: "object", label: "tetrahedron", x: 100, y: 100, width: 200, height: 200, visible: true }]
    })
  })
  return { runtime, writes, readDoc, handle }
}

describe("Task 2: DrawingCertificateResult wired into stage -> preview -> consent -> commit", () => {
  it("attaches complete DrawingCertificateResult and CertificateBinding through stage -> preview -> consent -> commit", async () => {
    const { runtime, writes, handle } = setupRuntime({ conversationId: "conv-cert" })
    const events: string[] = []
    for await (const event of runtime.coordinator.start({
      run: {
        runId: "run-cert",
        conversationId: "conv-cert",
        promptMessageId: "msg-1",
        target: handle(),
        sources: [],
        textProfileId: "local-planner",
        capabilityRevision: "1",
        policyRevision: "local"
      },
      userMessage: "在三棱锥A-BCD中，BD=2，AB=AD，画示意图"
    })) {
      events.push(event.phase)
    }
    expect(events.at(-1)).toBe("awaiting_confirmation")
    expect(writes).toHaveLength(0)

    const draftId = runtime.draftId()!
    const preview = runtime.host.preview(draftId)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    expect(preview.artifact.drawingCertificate?.certificateStatus).toBe("passed")
    expect(preview.artifact.drawingCertificate?.gate.status).toBe("passed")
    expect(preview.artifact.drawingCertificate?.numericPolicyVersion).toBe(NUMERIC_POLICY_VERSION)
    expect(preview.artifact.drawingCertificate?.ignoredUntrustedSelfReport).toBe(true)
    expect(preview.artifact.certificateBinding?.runId).toBe("run-cert")
    expect(preview.artifact.certificateBinding?.draftId).toBe(draftId)
    expect(preview.artifact.certificateBinding?.documentHash).toBeTruthy()
    expect(preview.artifact.certificateBinding?.policyVersion).toBe(NUMERIC_POLICY_VERSION)

    const confirmed = runtime.confirmDraft()
    expect(confirmed.status).toBe("committed")
    expect(writes).toHaveLength(1)
  })

  it("blocks requestConsent & commit when certificate is partial/unverified or when complete certificate switch is off", async () => {
    const store = createDraftStore()
    let doc = createEmptyDocument("geometry3d")
    const writes: number[] = []
    const host = createHostBridge({
      drafts: store,
      live: () => ({
        handle: {
          projectId: "proj-1",
          documentId: doc.metadata.id,
          workspace: "geometry3d",
          epoch: `epoch:${doc.metadata.id}`,
          generation: doc.revision,
          contentHash: contentFingerprint(doc)
        },
        document: doc
      }),
      replace: (next) => {
        doc = next
        writes.push(next.revision)
      },
      runId: "run-block",
      candidateRenderEvidence: ({ runId, draftId, draftVersion, documentHash }) => ({
        mode: "structured_only",
        runId,
        draftId,
        draftVersion,
        documentHash,
        viewport: { width: 800, height: 600 },
        boxes: [{ id: "tetrahedron", kind: "object", label: "tetrahedron", x: 100, y: 100, width: 200, height: 200, visible: true }]
      })
    })

    // 1. Disabled complete certificate -> unverified ("未完整核验"), NEVER fallback passed
    const disabledDraft = store.create(doc)
    const disabledStaged = await store.stage(
      disabledDraft.draftId,
      [VALID_TETRA_ACTION] as never,
      disabledDraft.draftVersion,
      "在三棱锥A-BCD中，BD=2，AB=AD，画示意图",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { enableCompleteCertificate: false, runId: "run-block" }
    )
    expect(disabledStaged.ok).toBe(true)
    if (!disabledStaged.ok) return
    expect(disabledStaged.preview.drawingCertificate?.certificateStatus).toBe("unverified")
    expect(disabledStaged.preview.drawingCertificate?.summary).toContain("未完整核验")
    expect(host.requestConsent(disabledDraft.draftId)).toMatchObject({ ok: false, reason: "unverified_diagram" })
    expect(writes).toHaveLength(0)

    // 2. Partial/unparsed condition -> partial, blocked from consent
    const partialDraft = store.create(doc)
    const partialStaged = await store.stage(
      partialDraft.draftId,
      [VALID_TETRA_ACTION] as never,
      partialDraft.draftVersion,
      "在三棱锥A-BCD中，sin∠ABC=0.5，画示意图",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { runId: "run-block" }
    )
    expect(partialStaged.ok).toBe(true)
    if (!partialStaged.ok) return
    expect(partialStaged.preview.drawingCertificate?.certificateStatus).toBe("partial")
    expect(host.requestConsent(partialDraft.draftId)).toMatchObject({ ok: false, reason: "unverified_diagram" })
    expect(writes).toHaveLength(0)

    // 3. Coordinator also blocks when enableCompleteCertificate is false
    const runtimeBlocked = setupRuntime({ enableCompleteCertificate: false })
    const events: string[] = []
    for await (const event of runtimeBlocked.runtime.coordinator.start({
      run: {
        runId: "run-cert",
        conversationId: "conv-cert",
        promptMessageId: "msg-1",
        target: runtimeBlocked.handle(),
        sources: [],
        textProfileId: "local-planner",
        capabilityRevision: "1",
        policyRevision: "local"
      },
      userMessage: "在三棱锥A-BCD中，BD=2，AB=AD，画示意图"
    })) {
      events.push(event.phase)
    }
    expect(events.at(-1)).toBe("failed")
    expect(runtimeBlocked.writes).toHaveLength(0)
  })

  it("blocks commit via verifyCertificateFreshness when active conversation changes or second stage invalidates earlier obligations", async () => {
    const store = createDraftStore()
    let doc = createEmptyDocument("geometry3d")
    const writes: number[] = []
    let currentConv = "conv-A"
    const host = createHostBridge({
      drafts: store,
      live: () => ({
        handle: {
          projectId: "proj-1",
          documentId: doc.metadata.id,
          workspace: "geometry3d",
          epoch: `epoch:${doc.metadata.id}`,
          generation: doc.revision,
          contentHash: contentFingerprint(doc)
        },
        document: doc
      }),
      replace: (next) => {
        doc = next
        writes.push(next.revision)
      },
      runId: "run-fresh",
      conversationId: "conv-A",
      readConversationId: () => currentConv,
      candidateRenderEvidence: ({ runId, draftId, draftVersion, documentHash }) => ({
        mode: "structured_only",
        runId,
        draftId,
        draftVersion,
        documentHash,
        viewport: { width: 800, height: 600 },
        boxes: [{ id: "tetrahedron", kind: "object", label: "tetrahedron", x: 100, y: 100, width: 200, height: 200, visible: true }]
      })
    })

    const draft1 = store.create(doc)
    const staged1 = await store.stage(
      draft1.draftId,
      [VALID_TETRA_ACTION] as never,
      draft1.draftVersion,
      "在三棱锥A-BCD中，BD=2，AB=AD，画示意图",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { runId: "run-fresh", conversationId: "conv-A" }
    )
    expect(staged1.ok).toBe(true)
    if (!staged1.ok) return
    const consent = host.requestConsent(draft1.draftId)
    expect(consent.ok).toBe(true)
    if (!consent.ok) return
    expect(consent.record.certificateBinding?.conversationId).toBe("conv-A")

    // User switches conversation after minting consent -> commit blocked!
    currentConv = "conv-B"
    expect(host.commit(draft1.draftId, consent.record)).toMatchObject({ ok: false, reason: "stale_conversation" })
    expect(writes).toHaveLength(0)

    // Second stage alters candidate without re-checking earlier obligations -> certificate unverified & blocked
    const draft2 = store.create(doc)
    const first2 = await store.stage(
      draft2.draftId,
      [VALID_TETRA_ACTION] as never,
      draft2.draftVersion,
      "在三棱锥A-BCD中，BD=2，AB=AD，画示意图",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { runId: "run-fresh" }
    )
    expect(first2.ok).toBe(true)
    if (!first2.ok) return
    const second2 = await store.stage(
      draft2.draftId,
      [{ actionId: "parameter.create", actionKey: "theta", factIds: [], inputs: { id: "theta", value: 1, label: "θ" } }] as never,
      first2.preview.draftVersion,
      "设 θ = 1",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { runId: "run-fresh" }
    )
    expect(second2.ok).toBe(true)
    if (!second2.ok) return
    expect(second2.preview.drawingCertificate?.certificateStatus).toBe("unverified")
    expect(second2.preview.drawingCertificate?.gate.blockers).toContain("stale_earlier_obligations")
    expect(host.requestConsent(draft2.draftId)).toMatchObject({ ok: false, reason: "unverified_diagram" })
    expect(writes).toHaveLength(0)
  })
})
