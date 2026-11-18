import { describe, expect, it } from "vitest"

import { createTargetedRepairTracker, formatTargetedRepairSummary } from "./repairProgress"

describe("repairProgress (targeted local repair & monotonic progress tracking)", () => {
  it("tracks monotonic reduction in failing constraints and locks passed obligations", () => {
    const tracker = createTargetedRepairTracker({ maxRounds: 3 })

    const r1 = tracker.evaluate({
      candidateHash: "cand-1",
      checks: [
        { id: "ob-1", kind: "fixedLength", status: "passed", detail: "AB=4" },
        { id: "ob-2", kind: "perpendicular", status: "failed", detail: "PA⊥AB failed", targetEntities: ["P", "A", "B"] },
        { id: "ob-3", kind: "coplanar", status: "failed", detail: "ABCD coplanar failed", targetEntities: ["D"] }
      ],
      maxResidual: 1.5
    })
    expect(r1.allowRepair).toBe(true)
    expect(r1.round).toBe(1)
    expect(r1.targetConstraintIds).toEqual(["ob-2", "ob-3"])
    expect(r1.targetEntities).toEqual(["A", "B", "D", "P"])
    expect(r1.preservedObligationIds).toEqual(["ob-1"])

    const r2 = tracker.evaluate({
      candidateHash: "cand-2",
      checks: [
        { id: "ob-1", kind: "fixedLength", status: "passed", detail: "AB=4" },
        { id: "ob-2", kind: "perpendicular", status: "passed", detail: "PA⊥AB passed" },
        { id: "ob-3", kind: "coplanar", status: "failed", detail: "ABCD coplanar failed", targetEntities: ["D"] }
      ],
      maxResidual: 0.4
    })
    expect(r2.allowRepair).toBe(true)
    expect(r2.round).toBe(2)
    expect(r2.targetConstraintIds).toEqual(["ob-3"])
    expect(r2.preservedObligationIds).toEqual(["ob-1", "ob-2"])

    const summary = formatTargetedRepairSummary({
      targetEntities: r2.targetEntities,
      targetConstraintIds: r2.targetConstraintIds,
      preservedObligationIds: r2.preservedObligationIds,
      failureSignature: r2.signature,
      round: r2.round
    })
    expect(summary).toContain("ob-3")
    expect(summary).toContain("ob-1")
    expect(summary).toContain("D")
  })

  it("stops immediately on zero progress (same failure count & unimproved residual)", () => {
    const tracker = createTargetedRepairTracker({ maxRounds: 3 })
    const r1 = tracker.evaluate({
      candidateHash: "cand-a",
      checks: [{ id: "ob-2", kind: "perpendicular", status: "failed", detail: "PA⊥AB", targetEntities: ["P"] }],
      maxResidual: 0.5
    })
    expect(r1.allowRepair).toBe(true)

    const r2 = tracker.evaluate({
      candidateHash: "cand-b",
      checks: [{ id: "ob-2", kind: "perpendicular", status: "failed", detail: "PA⊥AB", targetEntities: ["P"] }],
      maxResidual: 0.5
    })
    expect(r2.allowRepair).toBe(false)
    expect(r2.stopReason).toBe("no_progress")
  })

  it("stops when repairing one constraint regresses a previously passed obligation", () => {
    const tracker = createTargetedRepairTracker({ maxRounds: 3 })
    const r1 = tracker.evaluate({
      candidateHash: "cand-1",
      checks: [
        { id: "ob-1", kind: "fixedLength", status: "passed", detail: "AB=4" },
        { id: "ob-2", kind: "perpendicular", status: "failed", detail: "PA⊥AB" }
      ]
    })
    expect(r1.allowRepair).toBe(true)

    const r2 = tracker.evaluate({
      candidateHash: "cand-2",
      checks: [
        { id: "ob-1", kind: "fixedLength", status: "failed", detail: "AB broken" },
        { id: "ob-2", kind: "perpendicular", status: "passed", detail: "PA⊥AB fixed" }
      ]
    })
    expect(r2.allowRepair).toBe(false)
    expect(r2.stopReason).toBe("preserved_obligation_regressed")
  })

  it("stops cleanly once maxRounds bound is exceeded", () => {
    const tracker = createTargetedRepairTracker({ maxRounds: 1 })
    const r1 = tracker.evaluate({
      candidateHash: "cand-1",
      checks: [
        { id: "ob-1", kind: "k", status: "failed", detail: "1" },
        { id: "ob-2", kind: "k", status: "failed", detail: "2" }
      ]
    })
    expect(r1.allowRepair).toBe(true)

    const r2 = tracker.evaluate({
      candidateHash: "cand-2",
      checks: [{ id: "ob-2", kind: "k", status: "failed", detail: "2" }]
    })
    expect(r2.allowRepair).toBe(false)
    expect(r2.stopReason).toBe("max_rounds_reached")
  })
})
