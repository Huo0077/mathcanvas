import { createBudget, renderEvidenceStaleness, verifyCertificateFreshness, type PlannerPort, PLAN_SCHEMA_VERSION } from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"
import { createAgentRuntime } from "./agentRuntime"
import { createDraftStore } from "./draftStore"

describe("P4 / T14 draft/certificate staleness, double-confirm idempotency & camera-only invariance", () => {
  it("invalidates stale certificates when prompt text, subquestion scope, base scene, or reopened file revision changes", () => {
    const store = createDraftStore()
    const base = createEmptyDocument("geometry3d")
    const record = store.create(base)

    const initialBinding = {
      runId: "run-1",
      draftId: record.draftId,
      draftVersion: record.draftVersion,
      documentHash: "a".repeat(64),
      promptHash: "prompt-hash-1",
      scopeId: "subq-1",
      conversationId: "conv-1",
      baseRevision: base.revision,
      policyVersion: "num-policy-v1"
    }

    expect(verifyCertificateFreshness(initialBinding, { ...initialBinding }).fresh).toBe(true)

    const promptChanged = verifyCertificateFreshness(initialBinding, {
      ...initialBinding,
      promptHash: "prompt-hash-2"
    })
    expect(promptChanged.fresh).toBe(false)
    expect(promptChanged.reason).toBe("prompt_changed")

    const scopeChanged = verifyCertificateFreshness(initialBinding, {
      ...initialBinding,
      scopeId: "subq-2"
    })
    expect(scopeChanged.fresh).toBe(false)
    expect(scopeChanged.reason).toBe("scope_changed")

    const convChanged = verifyCertificateFreshness(initialBinding, {
      ...initialBinding,
      conversationId: "conv-2"
    })
    expect(convChanged.fresh).toBe(false)
    expect(convChanged.reason).toBe("conversation_changed")

    const reopenedFileOldCert = verifyCertificateFreshness(initialBinding, {
      ...initialBinding,
      documentHash: "b".repeat(64),
      baseRevision: base.revision + 3
    })
    expect(reopenedFileOldCert.fresh).toBe(false)
    expect(reopenedFileOldCert.reason).toBe("document_changed")
  })

  it("marks camera-only changes as visual-stale without invalidating math certificate or triggering model replan", () => {
    const mathHash = "c".repeat(64)
    const outcome = renderEvidenceStaleness(
      {
        draftId: "draft-1",
        draftVersion: 2,
        documentHash: mathHash,
        cameraHash: "cam-pos-1"
      },
      {
        draftId: "draft-1",
        documentHash: mathHash,
        cameraHash: "cam-pos-2"
      }
    )
    expect(outcome.stale).toBe(true)
    if (outcome.stale) {
      expect(outcome.kind).toBe("camera_changed")
      expect(outcome.mathStale).toBe(false)
      expect(outcome.visualStale).toBe(true)
      expect(outcome.requiresReplan).toBe(false)
    }
  })

  it("enforces atomic once-only confirmation so double-clicking confirmDraft writes the scene at most once", async () => {
    let liveDoc = createEmptyDocument("geometry3d")
    const writes: number[] = []
    const activeConversation = "conv-1"

    const planner: PlannerPort = {
      async plan() {
        return {
          plan: {
            schemaVersion: PLAN_SCHEMA_VERSION,
            kind: "plan",
            goal: "create a cube",
            factIds: [],
            actions: [{
              actionId: "solid.create_template",
              actionKey: "cube-1",
              factIds: [],
              inputs: {
                alias: "cube",
                template: "cube",
                origin: { x: 0, y: 0, z: 0 },
                size: { x: 2, y: 2, z: 2 }
              }
            }]
          },
          requestId: "req-1",
          attemptId: "att-1"
        }
      }
    }

    const runtime = createAgentRuntime({
      readDocument: () => liveDoc,
      writeDocument: (candidate) => {
        liveDoc = candidate
        writes.push(candidate.revision)
      },
      planner,
      budget: createBudget(),
      readSceneDocuments: () => [{
        handle: {
          projectId: "proj-1",
          documentId: liveDoc.metadata.id,
          workspace: liveDoc.workspace as "geometry3d",
          epoch: `epoch:${liveDoc.metadata.id}`,
          generation: liveDoc.revision,
          contentHash: contentFingerprint(liveDoc)
        },
        document: liveDoc
      }],
      projectId: "proj-1",
      runId: "run-double-confirm",
      conversationId: "conv-1",
      readConversationId: () => activeConversation,
      candidateRenderEvidence: ({ runId, draftId, draftVersion, documentHash }) => ({
        mode: "structured_only",
        runId,
        draftId,
        draftVersion,
        documentHash,
        viewport: { width: 800, height: 600 },
        boxes: [{ id: "cube-1", kind: "object", shape: "shape", x: 100, y: 100, width: 200, height: 200 }]
      }),
      exportPreflight: { preflight: () => ({ error: "none" }) }
    })

    for await (const _ of runtime.coordinator.start({
      run: {
        runId: "run-double-confirm",
        conversationId: "conv-1",
        promptMessageId: "msg-1",
        target: {
          projectId: "proj-1",
          documentId: liveDoc.metadata.id,
          workspace: liveDoc.workspace as "geometry3d",
          epoch: `epoch:${liveDoc.metadata.id}`,
          generation: liveDoc.revision,
          contentHash: contentFingerprint(liveDoc)
        },
        sources: [],
        textProfileId: "p1",
        capabilityRevision: "r1",
        policyRevision: "pol1"
      },
      userMessage: "画一个棱长为2的立方体"
    })) {
      // zero writes before confirm
      expect(writes).toHaveLength(0)
    }

    expect(writes).toHaveLength(0)
    const firstConfirm = runtime.confirmDraft()
    expect(firstConfirm.status, "detail" in firstConfirm ? firstConfirm.detail : "").toBe("committed")
    expect(writes).toHaveLength(1)

    // Second click (double-confirm) must refuse without writing a second time
    const secondConfirm = runtime.confirmDraft()
    expect(secondConfirm.status).toBe("rejected")
    if (secondConfirm.status === "rejected") {
      expect(secondConfirm.detail).toContain("already_committed")
    }
    expect(writes).toHaveLength(1)
  })
})
