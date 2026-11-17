import { createEmptyDocument, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { describe, expect, it } from "vitest"
import drawingContractsJson from "../../../../test-fixtures/reliability/drawing-contracts-36.json"
import {
  certifyDrawingAgainstContract,
  evaluateMathGate,
  isDrawingRequestContract,
  verifyCertificateFreshness
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

  it("DS3 RED 1 (GK-P09 false positive): wrong expression / missing tangent never passes", () => {
    const gkP09Doc: GeometryDocument = {
      ...createEmptyDocument("calculus"),
      primitives: [
        { id: "fn-f", type: "function", label: "f", expression: "x^2", domain: [-3, 3] } as unknown as PrimitiveSpec
      ]
    }
    const gkP09Cert = certifyDrawingAgainstContract({
      prompt: "6. 函数 $f(x)=x^{4}-2 x^{3}$ 的图像在点 $(1, f(1))$ 处的切线方程为 ()\nA. $y=-2 x-1$\nB. $y=-2 x+1$\nC. $y=2 x-3$\nD. $y=2 x+1$",
      document: gkP09Doc,
      candidateHash: "hash-gkp09-bad",
      sourceHash: "src-gkp09"
    })
    expect(gkP09Cert.certificateStatus, `${gkP09Cert.summary} | checks=${JSON.stringify(gkP09Cert.report?.checks)}`).toBe("blocked")
    expect(gkP09Cert.gate.status).toBe("blocked")
  })

  it("DS3 RED 2 (JT-P09 false positive): circle M + chords missing / unparsed never returns passed", () => {
    const jtP09Doc: GeometryDocument = {
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "pt-o", type: "point", label: "O", x: 0, y: 0 },
        { id: "pt-a", type: "point", label: "A", x: 1, y: 1 },
        { id: "pt-c", type: "point", label: "C", x: -1, y: -1 }
      ]
    }
    const jtP09Cert = certifyDrawingAgainstContract({
      prompt: "4. 在圆 M：x²+y²-4x+2y-4=0 内，过点 O(0, 0) 的最长弦和最短弦分别是 AC 和 BD，则四边形 ABCD 的面积为（　　）",
      document: jtP09Doc,
      candidateHash: "hash-jtp09-bad",
      sourceHash: "src-jtp09"
    })
    expect(jtP09Cert.certificateStatus, `${jtP09Cert.summary} | checks=${JSON.stringify(jtP09Cert.report?.checks)}`).not.toBe("passed")
    expect(jtP09Cert.gate.status).toBe("blocked")
  })

  it("DS3 RED 3 (JT-S07 false negative): valid 5-face polyhedron ABCDEF + midpoint M passes without treating (2) solve ask as unparsed given", () => {
    const A = { x: 0, y: 0, z: 0 }
    const B = { x: 1, y: 0, z: 0 }
    const D = { x: 0, y: 2, z: 0 }
    const C = { x: 1, y: 1, z: 0 }
    const F = { x: 0, y: 0, z: 1 }
    const E = { x: 0, y: 1, z: 1 }
    const M = { x: (E.x + C.x) / 2, y: (E.y + C.y) / 2, z: (E.z + C.z) / 2 }
    const pts = [A, B, C, D, E, F]
    const names = ["A", "B", "C", "D", "E", "F"]
    const jtS07Doc: GeometryDocument = {
      ...createEmptyDocument("geometry3d"),
      primitives: [
        ...pts.map((position, i) => ({ id: `v-${names[i]}`, type: "point3" as const, label: names[i]!, position })),
        { id: "pt-m", type: "point3", label: "M", position: M },
        {
          id: "poly-abcdef",
          type: "polyhedron3",
          label: "五面体ABCDEF",
          vertexIds: names.map((n) => `v-${n}`),
          edgeIds: [],
          faceIds: []
        }
      ]
    }
    const jtS07Cert = certifyDrawingAgainstContract({
      prompt: "如图，在五面体 ABCDEF 中，FA⊥平面 ABCD，AD∥BC∥FE，AB⊥AD，M 为 EC 的中点，AF=AB=BC=FE=1/2 AD。（1）求异面直线 BF 与 DE 所成角的大小；（2）求二面角 A-CD-E 的余弦值。",
      document: jtS07Doc,
      candidateHash: "hash-jts07-valid",
      sourceHash: "src-jts07"
    })
    expect(jtS07Cert.certificateStatus, `${jtS07Cert.summary} | checks=${JSON.stringify(jtS07Cert.report?.checks)}`).toBe("passed")
    expect(jtS07Cert.gate.status).toBe("passed")
  })

  it("DS3 RED 4 (JT-S09 false negative): valid cube edge=2 inscribed in hemisphere R=sqrt(6) passes without false not_supported", () => {
    const jtS09Doc: GeometryDocument = {
      ...createEmptyDocument("geometry3d"),
      primitives: [
        {
          id: "cube-1",
          type: "cube",
          label: "正方体",
          origin: { x: -1, y: -1, z: 0 },
          size: { x: 2, y: 2, z: 2 }
        },
        {
          id: "hemi-1",
          type: "sphere",
          label: "半球",
          center: { x: 0, y: 0, z: 0 },
          radius: Math.sqrt(6),
          hemisphere: true
        } as unknown as PrimitiveSpec
      ]
    }
    const jtS09Cert = certifyDrawingAgainstContract({
      prompt: "4. 已知半球内有一个内接正方体，正方体的一个面在半球的底面圆内，若正方体的棱长为 2，则半球的表面积为（　　）",
      document: jtS09Doc,
      candidateHash: "hash-jts09-valid",
      sourceHash: "src-jts09"
    })
    expect(jtS09Cert.certificateStatus, `${jtS09Cert.summary} | checks=${JSON.stringify(jtS09Cert.report?.checks)}`).toBe("passed")
    expect(jtS09Cert.gate.status).toBe("passed")
  })

  it("DS3 tamper & freshness: tampering candidate invalidates certificate binding and blocks re-use", () => {
    const validDoc = makeEllipsisScene()
    const freshness = verifyCertificateFreshness(
      { runId: "run-1", draftId: "draft-1", draftVersion: 2, documentHash: "hash-valid", policyVersion: "num-policy-v1" },
      { runId: "run-1", draftId: "draft-1", draftVersion: 2, documentHash: "hash-tampered", policyVersion: "num-policy-v1" }
    )
    expect(freshness.fresh).toBe(false)
    if (!freshness.fresh) expect(freshness.reason).toBe("document_changed")

    const tampered = structuredClone(validDoc)
    const ell = tampered.primitives.find((p) => p.type === "ellipse")
    if (ell && ell.type === "ellipse") {
      ell.radiusX = 1
      ell.radiusY = 2
    }
    const cert = certifyDrawingAgainstContract({
      prompt: "椭圆 C: x²/4 + y² = 1",
      document: tampered,
      candidateHash: "hash-tampered",
      sourceHash: "src-1",
      requiredEntityLabels: ["C", "F₁", "F₂"]
    })
    expect(cert.certificateStatus).toBe("blocked")
    expect(cert.failedObligations?.length).toBeGreaterThan(0)
  })
})
