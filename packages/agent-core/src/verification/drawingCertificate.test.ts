import { createEmptyDocument, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import drawingContractsJson from "../../../../test-fixtures/reliability/drawing-contracts-36.json"
import {
  certifyDrawingAgainstContract,
  evaluateMathGate,
  isDrawingRequestContract
} from "./drawingCertificate"

function makeEllipsisScene(): GeometryDocument {
  const base = createEmptyDocument("conics")
  const primitives: PrimitiveSpec[] = [
    {
      id: "ellipse-1",
      type: "ellipse",
      label: "C",
      center: { x: 0, y: 0 },
      radiusX: 2,
      radiusY: 1
    },
    { id: "pt-f1", type: "point", label: "F₁", x: -Math.sqrt(3), y: 0 },
    { id: "pt-f2", type: "point", label: "F₂", x: Math.sqrt(3), y: 0 }
  ]
  return { ...base, primitives }
}

describe("P4 / T13 drawingCertificate gate & full contract certification", () => {
  it("blocks empty required contracts, duplicate IDs, duplicate evidence, non-finite residuals, and forged passed status", () => {
    const empty = evaluateMathGate({
      isDrawingRequest: true,
      coverage: {
        requiredIds: [],
        checkedIds: [],
        unresolvedSource: [],
        missingEntityIds: []
      },
      evidence: [],
      binding: { candidateHash: "h1", sourceHash: "s1", policyVersion: "num-policy-v1" }
    })
    expect(empty.status).toBe("blocked")
    expect(empty.blockers).toContain("empty_required_contract")

    const duplicateReq = evaluateMathGate({
      isDrawingRequest: true,
      coverage: {
        requiredIds: ["o1", "o1"],
        checkedIds: ["o1"],
        unresolvedSource: [],
        missingEntityIds: []
      },
      evidence: [{ obligationId: "o1", status: "passed", residual: 0 }],
      binding: { candidateHash: "h1", sourceHash: "s1", policyVersion: "num-policy-v1" }
    })
    expect(duplicateReq.status).toBe("blocked")
    expect(duplicateReq.blockers).toContain("duplicate_required_id")

    const dupEvAndNan = evaluateMathGate({
      isDrawingRequest: true,
      coverage: {
        requiredIds: ["o1", "o2"],
        checkedIds: ["o1", "o2"],
        unresolvedSource: [],
        missingEntityIds: []
      },
      evidence: [
        { obligationId: "o1", status: "passed", residual: 0 },
        { obligationId: "o1", status: "passed", residual: 0 },
        { obligationId: "o2", status: "passed", residual: Number.NaN }
      ],
      binding: { candidateHash: "h1", sourceHash: "s1", policyVersion: "num-policy-v1" }
    })
    expect(dupEvAndNan.status).toBe("blocked")
    expect(dupEvAndNan.blockers).toContain("duplicate_evidence")
    expect(dupEvAndNan.blockers).toContain("non_finite_evidence")
  })

  it("distinguishes non-drawing chat from drawing contracts so casual chat is not blocked", () => {
    expect(isDrawingRequestContract("你好，请问今天天气如何？")).toBe(false)
    expect(isDrawingRequestContract("画布上有几个点？")).toBe(false)
    expect(isDrawingRequestContract("已知椭圆 x^2/4 + y^2 = 1，作切线 l")).toBe(true)

    const chatGate = evaluateMathGate({
      isDrawingRequest: false,
      coverage: { requiredIds: [], checkedIds: [], unresolvedSource: [], missingEntityIds: [] },
      evidence: [],
      binding: { candidateHash: "h0", sourceHash: "s0", policyVersion: "num-policy-v1" }
    })
    expect(chatGate.status).toBe("not_applicable")
  })

  it("recalculates final primitive coordinates rather than trusting self-reported builder claims and checks all 36 contracts schema", () => {
    const parsed = drawingContractsJson as {
      cases: Array<{
        id: string
        requiredEntityIds: string[]
        subquestions: unknown[]
        inputHash: string
        sourceHash: string
      }>
    }
    expect(parsed.cases).toHaveLength(36)

    // Verify every single one of the 36 contracts has valid scope/obligations (subquestions + entities or stem conditions)
    for (const entry of parsed.cases) {
      expect(entry.subquestions.length, entry.id).toBeGreaterThan(0)
      expect(Array.isArray(entry.requiredEntityIds), entry.id).toBe(true)
      expect(entry.inputHash).toBeTruthy()
      expect(entry.sourceHash).toBeTruthy()
    }

    const doc = makeEllipsisScene()
    const cert = certifyDrawingAgainstContract({
      prompt: "椭圆 C: x²/4 + y² = 1",
      document: doc,
      candidateHash: "hash-ellipse-valid",
      sourceHash: "src-1",
      requiredEntityLabels: ["C", "F₁", "F₂"],
      // Even if an untrusted caller attaches forged passed checks, independent verification drives the outcome
      untrustedSelfReportedChecks: [{ id: "fake-1", status: "passed", detail: "trust me" }]
    })
    expect(cert.certificateStatus, cert.summary).toBe("passed")
    expect(cert.gate.status).toBe("passed")
    expect(cert.numericPolicyVersion).toBeTruthy()
    expect(cert.ignoredUntrustedSelfReport).toBe(true)

    // Rollback switch: disabling complete certificate explicitly reports "unverified" (未完整核验), NEVER old fake passed!
    const disabled = certifyDrawingAgainstContract({
      prompt: "椭圆 C: x²/4 + y² = 1",
      document: doc,
      candidateHash: "hash-ellipse-valid",
      sourceHash: "src-1",
      requiredEntityLabels: ["C", "F₁", "F₂"],
      enableCompleteCertificate: false
    })
    expect(disabled.certificateStatus).toBe("unverified")
    expect(disabled.summary).toContain("未完整核验")
  })
})
