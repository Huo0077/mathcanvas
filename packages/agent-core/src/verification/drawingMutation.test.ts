import { createEmptyDocument, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import { certifyDrawingAgainstContract, evaluateMathGate } from "./drawingCertificate"

function validEllipseDocument(extraPrimitives: PrimitiveSpec[] = []): GeometryDocument {
  const base = createEmptyDocument("conics")
  return {
    ...base,
    primitives: [
      { id: "ell-1", type: "ellipse", label: "C", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1 },
      { id: "pt-f1", type: "point", label: "F₁", x: -Math.sqrt(3), y: 0 },
      { id: "pt-f2", type: "point", label: "F₂", x: Math.sqrt(3), y: 0 },
      { id: "pt-m", type: "point", label: "M", x: 1, y: Math.sqrt(3) / 2 },
      ...extraPrimitives
    ]
  }
}

function validFunctionPairDocument(swapped = false): GeometryDocument {
  const base = createEmptyDocument("calculus")
  return {
    ...base,
    primitives: [
      {
        id: "fn-f",
        type: "function",
        label: swapped ? "g" : "f",
        expression: "x^2",
        domain: [-2, 2]
      } as unknown as PrimitiveSpec,
      {
        id: "fn-g",
        type: "function",
        label: swapped ? "f" : "g",
        expression: "x + 1",
        domain: [-2, 2]
      } as unknown as PrimitiveSpec
    ]
  }
}

describe("P4 / T13 mathematical mutation rejection matrix", () => {
  it("rejects deleting a required point, mutating final coordinates, or introducing NaN even when self-reports claim passed", () => {
    const missingPointDoc = validEllipseDocument()
    missingPointDoc.primitives = missingPointDoc.primitives.filter((p) => p.label !== "F₁")
    const missingRes = certifyDrawingAgainstContract({
      prompt: "椭圆 C: x^2/4 + y^2 = 1，标出左焦点 F₁、右焦点 F₂ 与点 M(1, √3/2)。",
      document: missingPointDoc,
      candidateHash: "h-missing",
      sourceHash: "s1",
      requiredEntityLabels: ["C", "F₁", "F₂", "M"]
    })
    expect(missingRes.certificateStatus).toBe("blocked")
    expect(missingRes.gate.blockers).toContain("required_entity_missing")

    // Mutate point M off the ellipse (y = 5 instead of √3/2), independent recomputation catches it!
    const movedDoc = validEllipseDocument()
    movedDoc.primitives = movedDoc.primitives.map((p) => (p.type === "point" && p.label === "M" ? { ...p, y: 5 } : p))
    const movedRes = certifyDrawingAgainstContract({
      prompt: "椭圆 C: x^2/4 + y^2 = 1，M 在椭圆上，M=(1, 0.8660254038)。",
      document: movedDoc,
      candidateHash: "h-moved",
      sourceHash: "s1",
      requiredEntityLabels: ["C", "M"]
    })
    expect(movedRes.certificateStatus).toBe("blocked")

    // NaN coordinate in final geometry is immediately rejected
    const nanDoc = validEllipseDocument()
    nanDoc.primitives = nanDoc.primitives.map((p) => (p.type === "point" && p.label === "M" ? { ...p, x: Number.NaN } : p))
    const nanRes = certifyDrawingAgainstContract({
      prompt: "椭圆 C: x^2/4 + y^2 = 1，点 M",
      document: nanDoc,
      candidateHash: "h-nan",
      sourceHash: "s1",
      requiredEntityLabels: ["C", "M"]
    })
    expect(nanRes.certificateStatus).toBe("blocked")
    expect(nanRes.gate.blockers).toContain("non_finite_geometry")
  })

  it("rejects swapped curves, incomplete source coverage, flipped failed->unknown, and mismatched evidence hash", () => {
    const swappedDoc = validFunctionPairDocument(true)
    const swapRes = certifyDrawingAgainstContract({
      prompt: "作出函数 f(x)=x^2 与 g(x)=x+1 的图像",
      document: swappedDoc,
      candidateHash: "h-swap",
      sourceHash: "s2",
      requiredEntityLabels: ["f", "g"],
      expectedFunctions: { f: "x^2", g: "x + 1" }
    })
    expect(swapRes.certificateStatus).toBe("blocked")

    const partialCoverage = evaluateMathGate({
      isDrawingRequest: true,
      coverage: {
        requiredIds: ["o1", "o2"],
        checkedIds: ["o1"],
        unresolvedSource: ["使∠ABC=60°"],
        missingEntityIds: []
      },
      evidence: [{ obligationId: "o1", status: "passed", residual: 0 }],
      binding: { candidateHash: "h1", sourceHash: "s1", policyVersion: "num-policy-v1" }
    })
    expect(partialCoverage.status).toBe("blocked")
    expect(partialCoverage.blockers).toContain("source_coverage_incomplete")

    const flippedUnknown = evaluateMathGate({
      isDrawingRequest: true,
      coverage: {
        requiredIds: ["o1"],
        checkedIds: ["o1"],
        unresolvedSource: [],
        missingEntityIds: []
      },
      evidence: [{ obligationId: "o1", status: "unknown" }],
      binding: { candidateHash: "h1", sourceHash: "s1", policyVersion: "num-policy-v1" }
    })
    expect(flippedUnknown.status).toBe("blocked")
    expect(flippedUnknown.blockers).toContain("obligation_not_passed:o1")

    const staleEvidenceHash = evaluateMathGate({
      isDrawingRequest: true,
      coverage: {
        requiredIds: ["o1"],
        checkedIds: ["o1"],
        unresolvedSource: [],
        missingEntityIds: []
      },
      evidence: [{ obligationId: "o1", status: "passed", residual: 0, candidateHash: "old-hash" }],
      binding: { candidateHash: "new-hash", sourceHash: "s1", policyVersion: "num-policy-v1" }
    })
    expect(staleEvidenceHash.status).toBe("blocked")
    expect(staleEvidenceHash.blockers).toContain("stale_candidate_binding:o1")
  })

  it("keeps certificate passed when an unrelated auxiliary point is added without violating constraints", () => {
    const withAux = validEllipseDocument([
      { id: "aux-1", type: "point", label: "Aux", x: 5, y: 5 }
    ])
    const res = certifyDrawingAgainstContract({
      prompt: "椭圆 C: x²/4 + y² = 1",
      document: withAux,
      candidateHash: "h-aux",
      sourceHash: "s1",
      requiredEntityLabels: ["C", "F₁", "F₂"]
    })
    expect(res.certificateStatus, res.summary).toBe("passed")
  })
})
