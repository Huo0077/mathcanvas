import { describe, expect, it } from "vitest"
import {
  classifyPlanDiagnostics,
  computeFailureSignature,
  createRepairStagnationTracker,
  normalizeSolveOutcome
} from "./reliabilityDiagnostics"

describe("P4 / T12 reliability diagnostics, bounded repair & solve outcome taxonomy", () => {
  it("never maps timeout, not-found, or budget_exhausted to mathematical unsatisfiability (provenUnsat: false)", () => {
    const timedOut = normalizeSolveOutcome({
      status: "timeout",
      detail: "solver timed out after 1500ms",
      evaluations: 120
    })
    const notFound = normalizeSolveOutcome({
      status: "not-found",
      detail: "bounded sample search exhausted",
      evaluations: 400
    })
    const exhausted = normalizeSolveOutcome({
      status: "budget_exhausted",
      detail: "repair budget exceeded",
      evaluations: 8
    })

    for (const outcome of [timedOut, notFound, exhausted]) {
      expect(outcome.provenUnsat).toBe(false)
      expect(outcome.detail).not.toMatch(/无解|impossible|unsatisfiable/i)
    }
    expect(timedOut.code).toBe("residual_failed")
    expect(notFound.code).toBe("residual_failed")
    expect(exhausted.code).toBe("residual_failed")
  })

  it("stops repeat identical candidates, non-improving residuals, and unsupported missing capabilities", () => {
    const tracker = createRepairStagnationTracker()
    const diagA = classifyPlanDiagnostics([
      {
        stage: "geometry_validation",
        code: "residual_failed",
        path: "envelope.actions[0].inputs.position",
        detail: "constraint residual exceeds tolerance",
        severity: "error"
      }
    ], {
      candidateHash: "cand-1",
      residual: 0.42
    })
    expect(diagA[0]?.priorityAction).toBe("retry_local_params")

    const first = tracker.record({
      candidateHash: "cand-1",
      diagnostics: diagA,
      residual: 0.42
    })
    expect(first.shouldStop).toBe(false)

    // Same candidate + failureSignature -> stagnant_candidate
    const repeat = tracker.record({
      candidateHash: "cand-1",
      diagnostics: diagA,
      residual: 0.42
    })
    expect(repeat.shouldStop).toBe(true)
    expect(repeat.stopReason).toBe("stagnant_candidate")

    // Different candidateHash, but residual worsened -> no_progress
    const tracker2 = createRepairStagnationTracker()
    expect(tracker2.record({ candidateHash: "cand-a", diagnostics: diagA, residual: 0.25 }).shouldStop).toBe(false)
    const noProgress = tracker2.record({
      candidateHash: "cand-b",
      diagnostics: diagA,
      residual: 0.28
    })
    expect(noProgress.shouldStop).toBe(true)
    expect(noProgress.stopReason).toBe("no_progress")

    // Missing engine capability -> capability_missing stops re-asking immediately
    const capDiags = classifyPlanDiagnostics([
      {
        stage: "transport",
        code: "not_supported",
        path: "envelope.actions[0].actionId",
        detail: "unsupported capability: helix_3d",
        severity: "error"
      }
    ], { candidateHash: "cand-cap" })
    expect(capDiags[0]?.code).toBe("capability_missing")
    expect(capDiags[0]?.recoverable).toBe(false)
    expect(computeFailureSignature("cand-cap", capDiags)).toContain("capability_missing")

    const capStop = createRepairStagnationTracker().record({
      candidateHash: "cand-cap",
      diagnostics: capDiags
    })
    expect(capStop.shouldStop).toBe(true)
    expect(capStop.stopReason).toBe("capability_missing")
  })
})
