import { describe, expect, it } from "vitest"

import {
  assertSanitizedDsLiveLedger,
  classifyDsFailureBoundary,
  summarizeDsLiveBaseline,
  type RawDsLiveCaseSnapshot
} from "./dsLiveBaseline"
import { certifyDrawingAgainstContract } from "./drawingCertificate"

const FROZEN_36_IDS = [
  "GK-S01", "GK-S02", "GK-S03", "GK-S04", "GK-S05", "GK-S06", "GK-S07", "GK-S08", "GK-S09",
  "JT-S01", "JT-S02", "JT-S03", "JT-S04", "JT-S05", "JT-S06", "JT-S07", "JT-S08", "JT-S09",
  "GK-P01", "GK-P02", "GK-P03", "GK-P04", "GK-P05", "GK-P06", "GK-P07", "GK-P08", "GK-P09",
  "JT-P01", "JT-P02", "JT-P03", "JT-P04", "JT-P05", "JT-P06", "JT-P07", "JT-P08", "JT-P09"
] as const

function makeValidRawCases(ids: readonly string[]): RawDsLiveCaseSnapshot[] {
  return ids.map((id, idx) => {
    if (id === "GK-S08" || id === "GK-S09") {
      return {
        id,
        terminal: "awaiting_confirmation",
        requests: id === "GK-S08" ? 2 : 1,
        passed: true,
        primitiveCount: 19,
        verificationStatus: "passed",
        certificateStatus: "passed",
        contractStatus: "passed",
        objectCoverage: 1,
        obligationCoverage: 1,
        missingEntityIds: [],
        failedObligationIds: [],
        failedObligationKinds: []
      }
    }
    if (id === "GK-P09" || id === "JT-P09") {
      return {
        id,
        terminal: "awaiting_confirmation",
        requests: 2,
        passed: false,
        primitiveCount: id === "GK-P09" ? 3 : 9,
        verificationStatus: "passed",
        certificateStatus: "passed",
        contractStatus: "partial",
        objectCoverage: id === "GK-P09" ? 1 : 5 / 6,
        obligationCoverage: id === "GK-P09" ? 0 : 3 / 13,
        missingEntityIds: id === "JT-P09" ? ["M"] : [],
        failedObligationIds: id === "GK-P09" ? ["ob-f-expression"] : ["ob-m-circ"],
        failedObligationKinds: id === "GK-P09" ? ["function_expression"] : ["circle_equation"]
      }
    }
    if (id === "JT-S07" || id === "JT-S09") {
      return {
        id,
        terminal: "failed",
        requests: id === "JT-S07" ? 2 : 1,
        passed: false,
        primitiveCount: 28,
        verificationStatus: "not_supported",
        certificateStatus: "partial",
        contractStatus: "partial",
        objectCoverage: 1,
        obligationCoverage: 1,
        missingEntityIds: [],
        failedObligationIds: [],
        failedObligationKinds: []
      }
    }
    if (id === "JT-S04") {
      return {
        id,
        terminal: "waiting",
        requests: 2,
        passed: false,
        primitiveCount: 0,
        verificationStatus: null,
        certificateStatus: null,
        contractStatus: "failed",
        objectCoverage: 0,
        obligationCoverage: 0,
        missingEntityIds: ["A"],
        failedObligationIds: ["ob-ab"],
        failedObligationKinds: ["length"]
      }
    }
    if (idx < 14) {
      return {
        id,
        terminal: "failed",
        requests: 3,
        passed: false,
        primitiveCount: 0,
        verificationStatus: null,
        certificateStatus: null,
        contractStatus: "failed",
        objectCoverage: 0,
        obligationCoverage: 0,
        missingEntityIds: ["A"],
        failedObligationIds: ["ob-1"],
        failedObligationKinds: ["length"]
      }
    }
    return {
      id,
      terminal: "failed",
      requests: idx % 2 === 0 ? 1 : 2,
      passed: false,
      primitiveCount: 10,
      verificationStatus: "not_supported",
      certificateStatus: "partial",
      contractStatus: "partial",
      objectCoverage: 0.7,
      obligationCoverage: 0.5,
      missingEntityIds: [],
      failedObligationIds: ["ob-1"],
      failedObligationKinds: ["incidence"]
    }
  })
}

describe("DS0 baseline ledger & boundary classification", () => {
  it("classifies passed, false-positive confirmable, verification split, single-shot validating dead-end, and waiting boundaries", () => {
    expect(
      classifyDsFailureBoundary({
        terminal: "awaiting_confirmation",
        requests: 2,
        passed: true,
        primitiveCount: 19,
        verificationStatus: "passed",
        certificateStatus: "passed",
        contractStatus: "passed",
        objectCoverage: 1,
        obligationCoverage: 1,
        missingEntityIds: [],
        failedObligationIds: []
      })
    ).toBe("passed")

    expect(
      classifyDsFailureBoundary({
        terminal: "awaiting_confirmation",
        requests: 2,
        passed: false,
        primitiveCount: 3,
        verificationStatus: "passed",
        certificateStatus: "passed",
        contractStatus: "partial",
        objectCoverage: 1,
        obligationCoverage: 0,
        missingEntityIds: [],
        failedObligationIds: ["ob-f-expression"]
      })
    ).toBe("false_positive_confirmable")

    expect(
      classifyDsFailureBoundary({
        terminal: "failed",
        requests: 1,
        passed: false,
        primitiveCount: 28,
        verificationStatus: "not_supported",
        certificateStatus: "partial",
        contractStatus: "partial",
        objectCoverage: 1,
        obligationCoverage: 1,
        missingEntityIds: [],
        failedObligationIds: []
      })
    ).toBe("verification_split_not_supported")

    expect(
      classifyDsFailureBoundary({
        terminal: "failed",
        requests: 1,
        passed: false,
        primitiveCount: 14,
        verificationStatus: "not_supported",
        certificateStatus: "partial",
        contractStatus: "partial",
        objectCoverage: 1,
        obligationCoverage: 0.73,
        missingEntityIds: [],
        failedObligationIds: ["ob-m-on"]
      })
    ).toBe("partial_single_shot_no_validating_repair")

    expect(
      classifyDsFailureBoundary({
        terminal: "waiting",
        requests: 2,
        passed: false,
        primitiveCount: 0,
        verificationStatus: null,
        certificateStatus: null,
        contractStatus: "failed",
        objectCoverage: 0,
        obligationCoverage: 0,
        missingEntityIds: ["A"],
        failedObligationIds: ["ob-ab"]
      })
    ).toBe("zero_candidate_waiting")
  })

  it("summarizes 36 frozen cases cleanly and rejects missing, duplicate, mismatched totals, or secret/prompt leakage", () => {
    const ids = [...FROZEN_36_IDS]
    const rawCases = makeValidRawCases(ids)
    const totalRequests = rawCases.reduce((sum, entry) => sum + entry.requests, 0)

    const summary = summarizeDsLiveBaseline(ids, rawCases, {
      sourceRevision: "06648346634aa0760ba329419de041e5296add77",
      modelId: "deepseek-v4-flash",
      routeMode: "forced-native-DS-planner",
      maxRequests: 108,
      maxPerCase: 3,
      expectedRequests: totalRequests,
      inputTokens: 1724928,
      outputTokens: 66549,
      sceneWrites: 0
    })

    expect(summary.denominator).toBe(36)
    expect(summary.passed).toBe(2)
    expect(summary.confirmableCount).toBe(4)
    expect(summary.falsePositiveConfirmableCount).toBe(2)
    expect(summary.falsePositiveCaseIds).toEqual(["GK-P09", "JT-P09"])
    expect(summary.verificationSplitCount).toBe(2)
    expect(summary.verificationSplitCaseIds).toEqual(["JT-S07", "JT-S09"])
    expect(summary.zeroCandidateWaitingCaseIds).toEqual(["JT-S04"])
    expect(summary.costUsd).toBeNull()
    expect(summary.costKnown).toBe(false)
    expect(() => assertSanitizedDsLiveLedger(summary)).not.toThrow()

    // Duplicate ID must be rejected
    const dupCases = [...rawCases.slice(0, -1), rawCases[0]!]
    expect(() =>
      summarizeDsLiveBaseline(ids, dupCases, {
        sourceRevision: "rev",
        modelId: "deepseek-v4-flash",
        routeMode: "forced-native-DS-planner",
        maxRequests: 108,
        maxPerCase: 3,
        expectedRequests: totalRequests,
        inputTokens: 0,
        outputTokens: 0,
        sceneWrites: 0
      })
    ).toThrow(/duplicate|mismatch/i)

    // Missing ID must be rejected
    expect(() =>
      summarizeDsLiveBaseline(ids, rawCases.slice(0, -1), {
        sourceRevision: "rev",
        modelId: "deepseek-v4-flash",
        routeMode: "forced-native-DS-planner",
        maxRequests: 108,
        maxPerCase: 3,
        expectedRequests: totalRequests,
        inputTokens: 0,
        outputTokens: 0,
        sceneWrites: 0
      })
    ).toThrow(/missing|mismatch/i)

    // Leaked bearer/apiKey/prompt content must be rejected
    const leaked = structuredClone(summary) as unknown as Record<string, unknown>
    ;(leaked.cases as Record<string, unknown>[])[0]!.prompt = "secret prompt text"
    expect(() => assertSanitizedDsLiveLedger(leaked)).toThrow(/forbidden|sanitize/i)
  })

  it("pins the empty-prompt certificate bypass boundary", () => {
    // Pins the root cause boundary documented in DS0: passing an empty prompt (as draftStore.ts:660 does when checked === undefined)
    // skips math-gate checks (`not_applicable`), explaining how under-parsed cases can slip through confirmation without DS3 fixes.
    const bypassed = certifyDrawingAgainstContract({
      prompt: "",
      document: {
        id: "doc-bypass",
        version: 1,
        workspace: "plane",
        revision: 1,
        primitives: [],
        layers: []
      } as never,
      candidateHash: "cand-1",
      sourceHash: "src-1"
    })
    expect(bypassed.gate.status).toBe("not_applicable")
    expect(bypassed.certificateStatus).toBe("unverified")
  })
})
