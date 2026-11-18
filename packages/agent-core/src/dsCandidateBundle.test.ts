import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import {
  createDsCandidateBundle,
  DS_CANDIDATE_BUNDLE_SCHEMA,
  parseAndValidateDsCandidateBundle,
  verifyBundleRenderAndDelivery
} from "./dsCandidateBundle"
import { canonicalContentHash } from "./hashing"

describe("DS4 zero-cost replayable ds-candidate-bundle & evidence chain", () => {
  const sampleDoc = () => {
    const doc = createEmptyDocument("conics")
    doc.primitives = [
      { id: "c-1", type: "ellipse", label: "C", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1 },
      { id: "p-1", type: "point", label: "A", x: 2, y: 0 }
    ]
    return doc
  }

  it("validates sanitized replay bundles and rejects forged live provenance or leaked secrets/prompts", () => {
    const doc = sampleDoc()
    const viewportHash = canonicalContentHash({ width: 1280, height: 800 })
    const bundle = createDsCandidateBundle({
      bundleKind: "synthetic_replay",
      revision: "rev-test",
      caseId: "GK-P01",
      promptHash: "prompt-hash-p01",
      planHash: "plan-hash-p01",
      document: doc,
      certificateStatus: "passed",
      provenance: { route: "ds_intent_replay", modelId: null, dsInvoked: false, isLiveAuthorized: false },
      runId: "run-p01",
      viewportHash
    })
    expect(bundle.schemaVersion).toBe(DS_CANDIDATE_BUNDLE_SCHEMA)
    expect(bundle.reviewStatus).toEqual({ agentVisualReview: "pending", humanReviewed: "pending" })
    expect(parseAndValidateDsCandidateBundle(bundle).ok).toBe(true)

    const forged = { ...bundle, bundleKind: "live_authorized" as const }
    const forgedCheck = parseAndValidateDsCandidateBundle(forged)
    expect(forgedCheck.ok).toBe(false)
    if (!forgedCheck.ok) expect(forgedCheck.code).toBe("forged_live_provenance")

    const leaked = { ...bundle, rawPrompt: "secret prompt text" }
    const leakedCheck = parseAndValidateDsCandidateBundle(leaked)
    expect(leakedCheck.ok).toBe(false)
    if (!leakedCheck.ok) expect(leakedCheck.code).toBe("unsanitized_secret_or_prompt")
  })

  it("blocks mismatched screenshot/candidate hashes, offscreen errors, duplicate commits, and late writes while preserving humanReviewed pending", () => {
    const doc = sampleDoc()
    const docHash = canonicalContentHash(doc)
    const viewportHash = canonicalContentHash({ width: 1280, height: 800 })
    const bundle = createDsCandidateBundle({
      bundleKind: "synthetic_replay",
      revision: "rev-test",
      caseId: "GK-S01",
      promptHash: "prompt-hash-s01",
      planHash: "plan-hash-s01",
      document: doc,
      certificateStatus: "passed",
      provenance: { route: "ds_intent_replay", modelId: null, dsInvoked: false, isLiveAuthorized: false },
      runId: "run-s01",
      cameraHash: "cam-1",
      viewportHash
    })

    const passWithWarning = verifyBundleRenderAndDelivery(bundle, {
      runId: "run-s01",
      candidateHash: docHash,
      documentHash: docHash,
      cameraHash: "cam-1",
      viewportHash,
      evidenceStatus: "passed",
      renderTier: "rendered",
      objectsCount: 2,
      labelsCount: 1,
      expectedLabelsCount: 1,
      diagnosticErrors: [],
      diagnosticWarnings: ["clipped_object"],
      hiddenLabels: [],
      committedDocumentHash: docHash,
      commitCount: 1
    })
    expect(passWithWarning.passed).toBe(true)
    expect(passWithWarning.warnings).toEqual(["clipped_object"])
    // Non-blocking warning stays visible and never auto-approves humanReviewed.
    expect(passWithWarning.humanReviewed).toBe("pending")

    const bad = verifyBundleRenderAndDelivery(bundle, {
      runId: "run-s01",
      candidateHash: "stale-hash",
      documentHash: docHash,
      cameraHash: "cam-2",
      viewportHash,
      evidenceStatus: "failed",
      renderTier: "rendered",
      objectsCount: 0,
      labelsCount: 0,
      expectedLabelsCount: 1,
      diagnosticErrors: ["empty_canvas"],
      diagnosticWarnings: ["label_overlap"],
      hiddenLabels: ["A"],
      committedDocumentHash: "other-doc-hash",
      commitCount: 2,
      cancelledLateWrite: true
    })
    expect(bad.passed).toBe(false)
    expect(bad.blockers).toEqual(expect.arrayContaining([
      "candidate_hash_mismatch",
      "camera_hash_mismatch",
      "canvas_evidence_failed",
      "empty_canvas_objects",
      "missing_rendered_labels",
      "hidden_labels:A",
      "diagnostic_error:empty_canvas",
      "label_overlap",
      "duplicate_commit",
      "late_write_after_cancel",
      "committed_document_hash_mismatch"
    ]))
  })

  it("Task 5 classifies replay as bridge_replay_passed (never dsLiveRendered) and blocks stale camera orbit or unconfirmed writes", () => {
    const doc = sampleDoc()
    const docHash = canonicalContentHash(doc)
    const viewportHash = canonicalContentHash({ width: 1280, height: 800 })

    const replayBundle = createDsCandidateBundle({
      bundleKind: "synthetic_replay",
      revision: "rev-t5",
      caseId: "GK-S01",
      promptHash: "prompt-t5",
      planHash: "plan-t5",
      document: doc,
      certificateStatus: "passed",
      provenance: { route: "ds_intent_replay", modelId: null, dsInvoked: false, isLiveAuthorized: false },
      runId: "run-t5-1",
      cameraHash: "cam-initial",
      viewportHash
    })

    const replayVerdict = verifyBundleRenderAndDelivery(replayBundle, {
      runId: "run-t5-1",
      candidateHash: docHash,
      documentHash: docHash,
      cameraHash: "cam-initial",
      viewportHash,
      evidenceStatus: "passed",
      renderTier: "rendered",
      objectsCount: 2,
      labelsCount: 1,
      expectedLabelsCount: 1,
      diagnosticErrors: [],
      diagnosticWarnings: [],
      hiddenLabels: [],
      commitCount: 1,
      mainCanvasWritesBeforeConfirm: 0
    })
    expect(replayVerdict.passed).toBe(true)
    expect(replayVerdict.classification).toBe("bridge_replay_passed")
    expect(replayVerdict.humanReviewed).toBe("pending")

    const staleOrbitAndUnconfirmed = verifyBundleRenderAndDelivery(replayBundle, {
      runId: "run-t5-1",
      traceCandidateHash: "stale-trace-hash",
      candidateHash: docHash,
      documentHash: docHash,
      cameraHash: "cam-initial",
      previousCameraHash: "cam-initial",
      cameraMoved: true,
      viewportHash,
      evidenceStatus: "passed",
      renderTier: "rendered",
      objectsCount: 2,
      labelsCount: 1,
      diagnosticErrors: [],
      diagnosticWarnings: [],
      hiddenLabels: [],
      commitCount: 1,
      mainCanvasWritesBeforeConfirm: 1
    })
    expect(staleOrbitAndUnconfirmed.passed).toBe(false)
    expect(staleOrbitAndUnconfirmed.classification).toBe("blocked")
    expect(staleOrbitAndUnconfirmed.blockers).toEqual(
      expect.arrayContaining([
        "trace_candidate_hash_mismatch",
        "stale_camera_hash_after_orbit",
        "unconfirmed_write_to_main_canvas"
      ])
    )

    const liveBundle = createDsCandidateBundle({
      bundleKind: "live_authorized",
      revision: "rev-t5",
      caseId: "GK-S01",
      promptHash: "prompt-t5",
      planHash: "plan-t5",
      document: doc,
      certificateStatus: "passed",
      provenance: { route: "ds_intent", modelId: "deepseek-v4-flash", dsInvoked: true, isLiveAuthorized: true },
      runId: "run-t5-live",
      cameraHash: "cam-after-orbit",
      viewportHash
    })
    const liveVerdict = verifyBundleRenderAndDelivery(liveBundle, {
      runId: "run-t5-live",
      traceCandidateHash: docHash,
      candidateHash: docHash,
      documentHash: docHash,
      cameraHash: "cam-after-orbit",
      previousCameraHash: "cam-initial",
      cameraMoved: true,
      viewportHash,
      evidenceStatus: "passed",
      renderTier: "rendered",
      objectsCount: 2,
      labelsCount: 1,
      diagnosticErrors: [],
      diagnosticWarnings: [],
      hiddenLabels: [],
      commitCount: 1,
      mainCanvasWritesBeforeConfirm: 0
    })
    expect(liveVerdict.passed).toBe(true)
    expect(liveVerdict.classification).toBe("dsLiveRendered")
    expect(liveVerdict.humanReviewed).toBe("pending")

    const speculativeBlocked = verifyBundleRenderAndDelivery(liveBundle, {
      runId: "run-t5-live",
      traceCandidateHash: docHash,
      candidateHash: docHash,
      documentHash: docHash,
      screenshotCandidateHash: "different-screenshot-hash",
      speculativeOnly: true,
      cameraHash: "cam-after-orbit",
      viewportHash,
      evidenceStatus: "passed",
      renderTier: "rendered",
      objectsCount: 2,
      labelsCount: 1,
      diagnosticErrors: [],
      diagnosticWarnings: [],
      hiddenLabels: [],
      commitCount: 1,
      mainCanvasWritesBeforeConfirm: 0
    })
    expect(speculativeBlocked.passed).toBe(false)
    expect(speculativeBlocked.classification).toBe("blocked")
    expect(speculativeBlocked.blockers).toEqual(
      expect.arrayContaining(["speculative_candidate_rejected", "screenshot_candidate_hash_mismatch"])
    )
  })
})
