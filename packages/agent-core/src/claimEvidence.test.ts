import { describe, expect, it } from "vitest"

import { EVIDENCE_STATUSES, SOLVER_STATUSES, WITNESS_RESULT_STATUSES, evidenceFromLegacyCheck, evidenceStatusForWitness } from "./claimEvidence"

describe("claim evidence vocabulary", () => {
  it("keeps verified_instance, sampled and formally_proved as three mutually exclusive evidence states", () => {
    expect(EVIDENCE_STATUSES).toEqual([
      "not_run", "verified_instance", "sampled", "formally_proved", "failed", "unknown", "inconsistent", "timeout"
    ])
    expect(new Set(EVIDENCE_STATUSES).size).toBe(EVIDENCE_STATUSES.length)
  })

  it("keeps the candidate search outcome separate from the evidence state", () => {
    expect(WITNESS_RESULT_STATUSES).toEqual(["verified_instance", "unverified_instance", "no_witness"])
    expect(SOLVER_STATUSES).toEqual(["not_run", "model", "unsat", "unknown", "timeout", "diverged"])
  })
})

describe("evidenceStatusForWitness", () => {
  it("maps a verified instance to the verified_instance evidence state", () => {
    expect(evidenceStatusForWitness("verified_instance")).toBe("verified_instance")
  })

  it("maps an unverified candidate to unknown evidence rather than a pass", () => {
    expect(evidenceStatusForWitness("unverified_instance")).toBe("unknown")
  })

  it("maps a failed search to failed evidence rather than an unsupported pass", () => {
    expect(evidenceStatusForWitness("no_witness")).toBe("failed")
  })

  it("maps every witness outcome so N2/N5 cannot invent a fourth state", () => {
    for (const status of WITNESS_RESULT_STATUSES) expect(EVIDENCE_STATUSES).toContain(evidenceStatusForWitness(status))
  })
})

describe("evidenceFromLegacyCheck", () => {
  it("reports a legacy pass as verified_instance on an instance, never as a formal proof", () => {
    const evidence = evidenceFromLegacyCheck("passed")
    expect(evidence.status).toBe("verified_instance")
    expect(evidence.solver).toBe("not_run")
    expect(evidence.residuals).toEqual({})
    expect(evidence.degreesOfFreedom).toBeNull()
    expect(evidence.nextActions.length).toBeGreaterThan(0)
  })

  it("reports a legacy failure as failed and an unknown condition as unknown", () => {
    expect(evidenceFromLegacyCheck("failed").status).toBe("failed")
    expect(evidenceFromLegacyCheck("unverified").status).toBe("unknown")
  })

  it("carries measured residuals and the reported degree of freedom when they exist", () => {
    const evidence = evidenceFromLegacyCheck("failed", { residuals: { "BD=2": 0.5 }, degreesOfFreedom: 2 })
    expect(evidence.residuals).toEqual({ "BD=2": 0.5 })
    expect(evidence.degreesOfFreedom).toBe(2)
  })
})
