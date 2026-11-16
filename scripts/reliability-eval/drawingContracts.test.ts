// @vitest-environment node

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  evaluateDrawingContract,
  evaluateDrawingContractBranches,
  evaluateDrawingContractScopes,
  reconstructBaselineContractSummary,
  summarizeContractReports,
  validateContractSuite,
  type ContractSuiteFile,
  type DrawingContractCase,
  type ContractObligation
} from "./drawingContracts"
import { parseReliabilityArgs } from "./runner.mjs"

function loadContracts(): ContractSuiteFile {
  return JSON.parse(readFileSync("test-fixtures/reliability/drawing-contracts-36.json", "utf8")) as ContractSuiteFile
}

function loadManifest() {
  return JSON.parse(readFileSync("docs/audit/2026-11-15-drawing-baseline/manifest.json", "utf8")) as {
    count: number
    cases: {
      id: string
      examType: string
      category: string
      format: string
      workspace: string
      source: string
      question: string
      questionSha256: string
    }[]
  }
}

describe("drawing-contracts-36 golden contract suite & P0 evaluator", () => {
  it("matches manifest.json verbatim for all 36 frozen cases with valid sourceSpans and hashes", () => {
    const suite = loadContracts()
    const manifest = loadManifest()

    expect(suite.denominator).toBe(36)
    expect(suite.cases).toHaveLength(36)
    expect(suite.independentReviewStatus).toBe("pending_second_reviewer")

    const sha256Fn = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")
    const validation = validateContractSuite(suite, manifest, sha256Fn)
    expect(validation).toEqual({ valid: true, errors: [] })

    for (const contract of suite.cases) {
      const m = manifest.cases.find((item) => item.id === contract.id)
      expect(m).toBeDefined()
      expect(contract.prompt).toBe(m!.question)
      expect(contract.inputHash).toBe(sha256Fn(m!.question))
      expect(contract.sourceHash).toBe(m!.questionSha256)
      expect(contract.subquestions.length).toBeGreaterThan(0)
      expect(contract.requiredObligations.length).toBeGreaterThan(0)
      for (const ob of contract.requiredObligations) {
        expect(contract.prompt.slice(ob.sourceSpan.start, ob.sourceSpan.end)).toBe(ob.sourceSpan.text)
      }
    }
  })

  it("rejects tampered prompt text without hash update and rejects shrinking the denominator below 36", () => {
    const suite = loadContracts()
    const manifest = loadManifest()

    const sha256Fn = (text: string) => createHash("sha256").update(text, "utf8").digest("hex")
    const tampered: ContractSuiteFile = {
      ...suite,
      cases: suite.cases.map((c, idx) => (idx === 0 ? { ...c, prompt: `${c.prompt} ` } : c))
    }
    const tamperedCheck = validateContractSuite(tampered, manifest, sha256Fn)
    expect(tamperedCheck.valid).toBe(false)
    expect(tamperedCheck.errors.join("\n")).toMatch(/GK-S01|hash|mismatch/i)

    const shrunk: ContractSuiteFile = {
      ...suite,
      cases: suite.cases.slice(0, 35)
    }
    const shrunkCheck = validateContractSuite(shrunk, manifest, sha256Fn)
    expect(shrunkCheck.valid).toBe(false)
    expect(shrunkCheck.errors.join("\n")).toMatch(/denominator|36|missing/i)
  })

  it("verifies GK-P06 both tangents, midpoint circle contact and quadrilateral area", () => {
    const suite = loadContracts()
    const gkp06 = suite.cases.find((c) => c.id === "GK-P06")!
    const D = { x: 0, y: -0.5 }, A = { x: 1, y: 0.5 }, B = { x: -1, y: 0.5 }, M = { x: 0, y: 0.5 }
    const primitives = [
      { type: "parabola", id: "c", label: "C", vertex: { x: 0, y: 0 }, axis: "y", focalParameter: 1 },
      { type: "point", id: "d", label: "D", ...D }, { type: "point", id: "a", label: "A", ...A }, { type: "point", id: "b", label: "B", ...B },
      { type: "point", id: "m", label: "M", ...M },
      { type: "point", id: "e-point", label: "E", x: 0, y: 2.5 },
      { type: "circle", id: "e", label: "E", center: { x: 0, y: 2.5 }, radius: 2 },
      { type: "line", id: "da", label: "DA", a: D, b: A }, { type: "line", id: "db", label: "DB", a: D, b: B },
      { type: "line", id: "ab", label: "AB", a: A, b: B }
    ]
    const valid = evaluateDrawingContract(gkp06, { primitives }, { verificationStatus: "passed" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-da-tangent", "ob-db-tangent", "ob-ab-midpoint", "ob-e-tangent", "ob-area"]))
  })

  it("verifies GK-P09 tangent by symbolic derivative and GK-P07 circle tangencies by exact intersection", () => {
    const suite = loadContracts()
    const gkp09 = suite.cases.find((c) => c.id === "GK-P09")!
    const valid = evaluateDrawingContract(gkp09, {
      primitives: [
        { type: "function", id: "f", label: "f", expression: "x^4-2*x^3", domain: [-5, 5] },
        { type: "line", id: "tangent", label: "tangent", a: { x: 0, y: 1 }, b: { x: 1, y: -1 } }
      ]
    }, { verificationStatus: "passed" })
    expect(valid.passed).toBe(true)
    expect(valid.passedObligationIds).toContain("ob-tan-derivative")

    const wrongSlope = evaluateDrawingContract(gkp09, {
      primitives: [
        { type: "function", id: "f", label: "f", expression: "x^4-2*x^3", domain: [-5, 5] },
        { type: "line", id: "tangent", label: "tangent", a: { x: 0, y: 1 }, b: { x: 2, y: 0 } }
      ]
    }, { verificationStatus: "passed" })
    expect(wrongSlope.failedObligationIds).toContain("ob-tan-derivative")

    const gkp07 = suite.cases.find((c) => c.id === "GK-P07")!
    const circle = { type: "circle", id: "m", label: "M", center: { x: 0, y: -4 }, radius: 1 }
    const parabola = { type: "parabola", id: "c", label: "C", vertex: { x: 0, y: 0 }, axis: "y", focalParameter: 2 }
    const A = { x: 2 * Math.sqrt(5), y: 5 }, B = { x: -2 * Math.sqrt(5), y: 5 }, P = { x: 0, y: -5 }
    const validCircle = evaluateDrawingContract(gkp07, {
      primitives: [
        circle, parabola,
        { type: "point", id: "p", label: "P", ...P },
        { type: "point", id: "f", label: "F", x: 0, y: 1 },
        { type: "point", id: "a", label: "A", ...A },
        { type: "point", id: "b", label: "B", ...B },
        { type: "line", id: "pa", label: "PA", a: P, b: A },
        { type: "line", id: "pb", label: "PB", a: P, b: B }
      ]
    }, { verificationStatus: "passed" })
    expect(validCircle.passed, JSON.stringify(validCircle.obligationResults)).toBe(true)
    expect(validCircle.passedObligationIds).toEqual(expect.arrayContaining(["ob-p-on-m", "ob-pa-tangent", "ob-pb-tangent"]))
  })

  it("verifies JT-P09 circle incidences, chord hosts and quadrilateral area", () => {
    const suite = loadContracts()
    const jtp09 = suite.cases.find((c) => c.id === "JT-P09")!
    const u = { x: 2 / Math.sqrt(5), y: -1 / Math.sqrt(5) }, v = { x: 1 / Math.sqrt(5), y: 2 / Math.sqrt(5) }
    const primitives = [
      { type: "circle", id: "m-circle", label: "M", center: { x: 2, y: -1 }, radius: 3 },
      { type: "point", id: "m", label: "M", x: 2, y: -1 }, { type: "point", id: "o", label: "O", x: 0, y: 0 },
      { type: "point", id: "a", label: "A", x: 2 + 3 * u.x, y: -1 + 3 * u.y },
      { type: "point", id: "c", label: "C", x: 2 - 3 * u.x, y: -1 - 3 * u.y },
      { type: "point", id: "b", label: "B", x: 2 * v.x, y: 2 * v.y },
      { type: "point", id: "d", label: "D", x: -2 * v.x, y: -2 * v.y }
    ]
    const valid = evaluateDrawingContract(jtp09, { primitives }, { verificationStatus: "passed" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-a-on-m", "ob-b-on-m", "ob-c-on-m", "ob-d-on-m", "ob-oac", "ob-obd", "ob-area"]))

    const invalid = evaluateDrawingContract(jtp09, {
      primitives: primitives.map((primitive) => primitive.id === "b" ? { ...primitive, x: 0, y: 0 } : primitive)
    }, { verificationStatus: "passed" })
    expect(invalid.failedObligationIds).toContain("ob-b-on-m")
  })

  it("requires JT-P08 excluded locus points and both independently verified EF branches", () => {
    const suite = loadContracts()
    const jtp08 = suite.cases.find((c) => c.id === "JT-P08")!
    const makeBranch = (sign: 1 | -1, includeExclusions = true) => ({
      primitives: [
        { type: "point", id: "a", label: "A", x: 0, y: Math.sqrt(3) },
        { type: "point", id: "b", label: "B", x: 0, y: -Math.sqrt(3) },
        { type: "point", id: "c", label: "C", x: 0, y: -1 },
        {
          type: "ellipse", id: "g", label: "G", center: { x: 0, y: 0 }, radiusX: 2, radiusY: Math.sqrt(3),
          ...(includeExclusions ? { excludedPoints: [{ x: 0, y: Math.sqrt(3) }, { x: 0, y: -Math.sqrt(3) }] } : {})
        },
        { type: "point", id: "e", label: "E", x: 2 * sign, y: 0 },
        { type: "point", id: "f", label: "F", x: -sign, y: -1.5 },
        { type: "line", id: "ef", label: "EF", a: { x: 2 * sign, y: 0 }, b: { x: -sign, y: -1.5 } }
      ]
    })
    const valid = evaluateDrawingContractBranches(jtp08, "(Ⅱ)", {
      positive: { candidate: makeBranch(1), options: { verificationStatus: "passed" } },
      negative: { candidate: makeBranch(-1), options: { verificationStatus: "passed" } }
    })
    expect(valid.passed, JSON.stringify(valid.scopeResults)).toBe(true)
    expect(valid.scopeResults.positive?.passedObligationIds).toContain("ob-ef-positive")
    expect(valid.scopeResults.negative?.passedObligationIds).toContain("ob-ef-negative")

    const missingBranch = evaluateDrawingContractBranches(jtp08, "(Ⅱ)", {
      positive: { candidate: makeBranch(1), options: { verificationStatus: "passed" } }
    })
    expect(missingBranch.passed).toBe(false)
    expect(missingBranch.missingScopeIds).toEqual(["negative"])

    const fullEllipse = evaluateDrawingContractBranches(jtp08, "(Ⅱ)", {
      positive: { candidate: makeBranch(1, false), options: { verificationStatus: "passed" } },
      negative: { candidate: makeBranch(-1), options: { verificationStatus: "passed" } }
    })
    expect(fullEllipse.scopeResults.positive?.failedObligationIds).toContain("ob-g-domain")
  })

  it("verifies JT-P07 point values, secant identity and x=3 intersections", () => {
    const suite = loadContracts()
    const jtp07 = suite.cases.find((c) => c.id === "JT-P07")!
    const P = { x: 1, y: Math.sqrt(3) / 2 }, Q = { x: 1, y: -Math.sqrt(3) / 2 }
    const primitives = [
      { type: "ellipse", id: "c", label: "C", center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1 },
      { type: "point", id: "a", label: "A", x: 0.5, y: Math.sqrt(15) / 4 }, { type: "point", id: "b", label: "B", x: 2, y: 0 },
      { type: "point", id: "p", label: "P", ...P }, { type: "point", id: "q", label: "Q", ...Q },
      { type: "line", id: "l", label: "l", a: P, b: Q },
      { type: "point", id: "e", label: "E", x: 3, y: -Math.sqrt(3) / 2 },
      { type: "point", id: "f", label: "F", x: 3, y: Math.sqrt(3) / 2 }
    ]
    const valid = evaluateDrawingContract(jtp07, { primitives }, { verificationStatus: "passed" })
    expect(valid.passed).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-a", "ob-b", "ob-l-through", "ob-p-on-l", "ob-q-on-l", "ob-e-x3", "ob-f-x3"]))

    const invalid = evaluateDrawingContract(jtp07, {
      primitives: primitives.map((primitive) => primitive.id === "l" ? { ...primitive, a: { x: 0, y: -1 }, b: { x: 0, y: 1 } } : primitive)
    }, { verificationStatus: "passed" })
    expect(invalid.failedObligationIds).toEqual(expect.arrayContaining(["ob-l-through", "ob-p-on-l", "ob-q-on-l"]))
  })

  it("verifies JT-P02 P host, hyperbola intersections and both collinear dependencies", () => {
    const suite = loadContracts()
    const jtp02 = suite.cases.find((c) => c.id === "JT-P02")!
    const primitives = [
      { type: "hyperbola", id: "c", label: "C", center: { x: 0, y: 0 }, axis: "x", radiusX: 2, radiusY: 4 },
      { type: "line", id: "host", label: "host", a: { x: -1, y: -10 }, b: { x: -1, y: 10 } },
      { type: "point", id: "a1", label: "A₁", x: -2, y: 0 }, { type: "point", id: "a2", label: "A₂", x: 2, y: 0 },
      { type: "point", id: "p", label: "P", x: -1, y: 4 },
      { type: "point", id: "m", label: "M", x: -10 / 3, y: -16 / 3 },
      { type: "point", id: "n", label: "N", x: -26 / 5, y: 48 / 5 }
    ]
    const valid = evaluateDrawingContract(jtp02, { primitives }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-p-on-host", "ob-m-on-c", "ob-n-on-c", "ob-p-a1-m", "ob-p-a2-n"]))

    const invalid = evaluateDrawingContract(jtp02, {
      primitives: primitives.map((primitive) => primitive.id === "m" ? { ...primitive, x: 0, y: 0 } : primitive)
    }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(invalid.failedObligationIds).toContain("ob-m-on-c")
    expect(invalid.failedObligationIds).toContain("ob-p-a1-m")
  })

  it("verifies GK-P02 collinearity, horizontal MT and T on segment AB", () => {
    const suite = loadContracts()
    const gkp02 = suite.cases.find((c) => c.id === "GK-P02")!
    const y = -Math.sqrt(8 / 3), t = 2 + y
    const M = { x: 1, y }, N = { x: 1, y: -y }, T = { x: 1.5 * t, y }, H = { x: 3 * t - 1, y }
    const primitives = [
      { type: "ellipse", id: "e", label: "E", center: { x: 0, y: 0 }, radiusX: Math.sqrt(3), radiusY: 2 },
      { type: "point", id: "a", label: "A", x: 0, y: -2 }, { type: "point", id: "b", label: "B", x: 1.5, y: -1 },
      { type: "point", id: "p", label: "P", x: 1, y: -2 },
      { type: "point", id: "m", label: "M", ...M }, { type: "point", id: "n", label: "N", ...N },
      { type: "point", id: "t", label: "T", ...T }, { type: "point", id: "h", label: "H", ...H }
    ]
    const valid = evaluateDrawingContract(gkp02, { primitives }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-pmn-collinear", "ob-mt-horizontal", "ob-t-on-ab"]))

    const invalid = evaluateDrawingContract(gkp02, {
      primitives: primitives.map((primitive) => primitive.id === "t" ? { ...primitive, x: 2 } : primitive)
    }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(invalid.failedObligationIds).toContain("ob-t-on-ab")
  })

  it("binds GK-P01 A and B to line l and verifies the origin O", () => {
    const suite = loadContracts()
    const gkp01 = suite.cases.find((c) => c.id === "GK-P01")!
    const A = { x: 0.5176380902050419, y: -1.3660254037844384 }, B = { x: 1.9318516525781366, y: 0.36602540378443793 }
    const primitives = [
      { type: "ellipse", id: "c", label: "C", center: { x: 0, y: 0 }, radiusX: 2, radiusY: Math.SQRT2 },
      { type: "point", id: "o", label: "O", x: 0, y: 0 },
      { type: "point", id: "a", label: "A", ...A },
      { type: "point", id: "b", label: "B", ...B },
      { type: "line", id: "l", label: "l", a: A, b: B }
    ]
    const valid = evaluateDrawingContract(gkp01, { primitives }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(valid.passed).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-a-on-l", "ob-b-on-l", "ob-o-origin"]))

    const offLine = { x: -B.x, y: -B.y }
    const invalid = evaluateDrawingContract(gkp01, {
      primitives: primitives.map((primitive) => primitive.id === "b" ? { ...primitive, ...offLine } : primitive)
    }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(invalid.failedObligationIds).toContain("ob-b-on-l")
  })

  it("verifies GK-S07 prism correspondence and closed topology alongside its metric constraints", () => {
    const suite = loadContracts()
    const gks07 = suite.cases.find((c) => c.id === "GK-S07")!
    const h = 2, c = 2
    const positions = [
      { x: 0, y: 0, z: 0 }, { x: h, y: 0, z: 0 }, { x: h, y: c, z: 0 },
      { x: 0, y: 0, z: h }, { x: h, y: 0, z: h }, { x: h, y: c, z: h }
    ]
    const names = ["A", "B", "C", "A₁", "B₁", "C₁"]
    const rings = [[0, 2, 1], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]]
    const primitives = [
      ...positions.map((position, index) => ({ type: "point3", id: `v${index}`, label: names[index], position })),
      ...rings.map((pointIds, index) => ({ type: "face3", id: `f${index}`, pointIds: pointIds.map((point) => `v${point}`) })),
      { type: "polyhedron3", id: "prism", vertexIds: positions.map((_, index) => `v${index}`), edgeIds: [], faceIds: rings.map((_, index) => `f${index}`) },
      { type: "point3", id: "d", label: "D", position: { x: h / 2, y: c / 2, z: h / 2 } }
    ]
    const valid = evaluateDrawingContract(gks07, { primitives }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-prism-aa1-bb1", "ob-prism-aa1-cc1", "ob-prism-ab-a1b1", "ob-topology"]))
  })

  it("requires JT-S03's foot M to lie in plane PCD and AM to be perpendicular to two plane directions", () => {
    const suite = loadContracts()
    const jts03 = suite.cases.find((c) => c.id === "JT-S03")!
    const point = (label: string, position: { x: number; y: number; z: number }) => ({ type: "point3", id: `pt-${label}`, label, position })
    const base = [
      point("A", { x: 0, y: 0, z: 0 }), point("B", { x: 0, y: 2, z: 0 }),
      point("C", { x: 1, y: 2, z: 0 }), point("D", { x: 4, y: 0, z: 0 }),
      point("P", { x: 0, y: 0, z: 4 })
    ]
    const validM = point("M", { x: 16 / 17, y: 24 / 17, z: 16 / 17 })
    const valid = evaluateDrawingContract(jts03, { primitives: [...base, validM] }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(valid.passed).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-m-in-pcd", "ob-am-pc"]))

    const wrongM = point("M", { x: 2, y: 3, z: 0 })
    const invalid = evaluateDrawingContract(jts03, { primitives: [...base, wrongM] }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(invalid.passed).toBe(false)
    expect(invalid.failedObligationIds).toEqual(expect.arrayContaining(["ob-m-in-pcd", "ob-am-pc"]))
  })

  it("validates a moving point's segment host including interior, exterior and off-line positions", () => {
    const suite = loadContracts()
    const source = suite.cases.find((c) => c.id === "JT-S08")!
    const host = {
      id: "ob-m-host",
      kind: "incidence",
      description: "M lies on segment EF",
      scope: "(2)",
      sourceSpan: source.requiredObligations.at(-1)!.sourceSpan,
      check: { kind: "point-on-segment-3d", p: "M", a: "E", b: "F" }
    } as unknown as ContractObligation
    const contract = { ...source, requiredEntityIds: ["E", "F", "M"], requiredObligations: [host] }
    const primitives = [
      { type: "point3", id: "e", label: "E", position: { x: 0, y: 0, z: 0 } },
      { type: "point3", id: "f", label: "F", position: { x: 2, y: 0, z: 0 } }
    ]
    const evaluate = (x: number, y: number) => evaluateDrawingContract(contract, {
      primitives: [...primitives, { type: "point3", id: "m", label: "M", position: { x, y, z: 0 } }]
    }, { verificationStatus: "passed", scopeId: "(2)" }).passed
    expect(evaluate(1, 0)).toBe(true)
    expect(evaluate(3, 0)).toBe(false)
    expect(evaluate(1, 1)).toBe(false)
  })

  it("requires GK-S02's base quadrilateral to be coplanar rather than merely named ABCD", () => {
    const suite = loadContracts()
    const source = suite.cases.find((c) => c.id === "GK-S02")!
    const coplanar = {
      id: "ob-base-coplanar",
      kind: "coplanar",
      description: "Base ABCD is coplanar",
      scope: "stem",
      sourceSpan: source.requiredObligations[0]!.sourceSpan,
      check: { kind: "coplanar-3d", points: ["A", "B", "C", "D"] }
    } as unknown as ContractObligation
    const contract = { ...source, requiredEntityIds: ["A", "B", "C", "D"], requiredObligations: [coplanar] }
    const primitives = [
      { type: "point3", id: "a", label: "A", position: { x: 0, y: 0, z: 0 } },
      { type: "point3", id: "b", label: "B", position: { x: 2, y: 0, z: 0 } },
      { type: "point3", id: "c", label: "C", position: { x: 2, y: 2, z: 0 } },
      { type: "point3", id: "d", label: "D", position: { x: 0, y: 2, z: 0 } }
    ]
    expect(evaluateDrawingContract(contract, { primitives }, { verificationStatus: "passed" }).passed).toBe(true)
    const invalid = primitives.map((primitive) => primitive.label === "D" ? { ...primitive, position: { x: 0, y: 2, z: 1 } } : primitive)
    expect(evaluateDrawingContract(contract, { primitives: invalid }, { verificationStatus: "passed" }).passed).toBe(false)
  })

  it("validates closed solid face topology and rejects inconsistent face winding", () => {
    const suite = loadContracts()
    const source = suite.cases.find((c) => c.id === "GK-S03")!
    const topology = {
      id: "ob-topology",
      kind: "topology",
      description: "Closed, consistently wound, connected, non-degenerate polyhedron",
      scope: "stem",
      sourceSpan: source.requiredObligations[0]!.sourceSpan,
      check: { kind: "topology-3d" }
    } as unknown as ContractObligation
    const contract = { ...source, requiredEntityIds: [], requiredObligations: [topology] }
    const points = [
      { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }
    ]
    const faceRings = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]
    const primitives = [
      ...points.map((position, index) => ({ type: "point3", id: `v${index}`, label: `V${index}`, position })),
      ...faceRings.map((pointIds, index) => ({ type: "face3", id: `f${index}`, pointIds: pointIds.map((point) => `v${point}`) })),
      { type: "polyhedron3", id: "solid", vertexIds: points.map((_, index) => `v${index}`), edgeIds: [], faceIds: faceRings.map((_, index) => `f${index}`) }
    ]
    expect(evaluateDrawingContract(contract, { primitives }, { verificationStatus: "passed" }).passed).toBe(true)

    const invalid = primitives.map((primitive) => primitive.id === "f3" ? { ...primitive, pointIds: ["v1", "v3", "v2"] } : primitive)
    const rejected = evaluateDrawingContract(contract, { primitives: invalid }, { verificationStatus: "passed" })
    expect(rejected.passed).toBe(false)
    expect(rejected.failedObligationIds).toContain("ob-topology")
  })

  it("binds GK-P04 function samples and its tangent to f, g and tangent instead of arbitrary primitives", () => {
    const suite = loadContracts()
    const gkp04 = suite.cases.find((c) => c.id === "GK-P04")!
    const fn = (label: string, expression: string) => ({ type: "function", id: `fn-${label}`, label, expression, domain: [-5, 5] })
    const line = (label: string, a: { x: number; y: number }, b: { x: number; y: number }) => ({ type: "line", id: `line-${label}`, label, a, b })
    const tangent = line("tangent", { x: -1, y: 0 }, { x: 1, y: 4 })
    const valid = evaluateDrawingContract(gkp04, {
      primitives: [fn("f", "x^3-x"), fn("g", "x^2+3"), tangent]
    }, { verificationStatus: "passed", scopeId: "(1)" })
    expect(valid.passed).toBe(true)

    const swapped = evaluateDrawingContract(gkp04, {
      primitives: [fn("f", "x^2+3"), fn("g", "x^3-x"), tangent]
    }, { verificationStatus: "passed", scopeId: "(1)" })
    expect(swapped.passed).toBe(false)

    const decoy = evaluateDrawingContract(gkp04, {
      primitives: [
        fn("f", "x^3-x"), fn("g", "x^2+3"),
        line("decoy", { x: -1, y: 0 }, { x: 1, y: 4 }),
        line("tangent", { x: 0, y: 0 }, { x: 1, y: 1 })
      ]
    }, { verificationStatus: "passed", scopeId: "(1)" })
    expect(decoy.passed).toBe(false)
    expect(decoy.failedObligationIds).toContain("ob-tan")
  })

  it("checks JT-S02's actual plane perpendicularity, P host ratio and dihedral cosine", () => {
    const suite = loadContracts()
    const jts02 = suite.cases.find((c) => c.id === "JT-S02")!
    const point = (label: string, position: { x: number; y: number; z: number }) => ({ type: "point3", id: `pt-${label}`, label, position })
    const A = point("A", { x: 2, y: 2, z: 0 }), B = point("B", { x: 0, y: 0, z: 0 }), C = point("C", { x: 2, y: 0, z: 0 })
    const A1 = point("A₁", { x: 0, y: 2, z: 2 }), B1 = point("B₁", { x: -2, y: 0, z: 2 }), C1 = point("C₁", { x: 0, y: 0, z: 2 })
    const ratio = 1 - Math.SQRT1_2
    const validP = point("P", { x: -2 * ratio, y: 2 - 2 * ratio, z: 2 })
    const valid = evaluateDrawingContract(jts02, { primitives: [A, B, C, A1, B1, C1, validP] }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(valid.passed).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-plane-perp", "ob-2-p-host", "ob-2-dihedral-cos"]))
    expect(jts02.requiredObligations.map((obligation) => obligation.id)).not.toContain("ob-ac-bb1")

    const midpoint = point("P", { x: -1, y: 1, z: 2 })
    const invalid = evaluateDrawingContract(jts02, { primitives: [A, B, C, A1, B1, C1, midpoint] }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(invalid.passed).toBe(false)
    expect(invalid.failedObligationIds).toEqual(expect.arrayContaining(["ob-2-p-host", "ob-2-dihedral-cos"]))
  })

  it("requires separate scoped evidence for GK-S01's proof and measurement subquestions", () => {
    const suite = loadContracts()
    const gks01 = suite.cases.find((c) => c.id === "GK-S01")!
    const point = (label: string, position: { x: number; y: number; z: number }) => ({ type: "point3", id: `pt-${label}`, label, position })
    const base = [
      point("P", { x: 0, y: 0, z: 2 }),
      point("A", { x: 0, y: 0, z: 0 }),
      point("B", { x: 1.5, y: -Math.sqrt(3) / 2, z: 0 }),
      point("C", { x: 2, y: 0, z: 0 })
    ]
    const proofCandidate = { primitives: [...base, point("D", { x: 0.5, y: Math.sqrt(3) / 2, z: 0 })] }
    const measurementCandidate = { primitives: [...base, point("D", { x: 1.5, y: Math.sqrt(3) / 2, z: 0 })] }
    const result = evaluateDrawingContractScopes(gks01, {
      "(1)": { candidate: proofCandidate, options: { verificationStatus: "passed" } },
      "(2)": { candidate: measurementCandidate, options: { verificationStatus: "passed" } }
    })
    expect(result.passed, JSON.stringify(result.scopeResults, null, 2)).toBe(true)
    expect(result.missingScopeIds).toEqual([])
    expect(result.scopeResults["(1)"]?.passedObligationIds).toContain("ob-1-ad-pb")
    expect(result.scopeResults["(2)"]?.passedObligationIds).toContain("ob-2-ad-dc")
    expect(result.scopeResults["(2)"]?.passedObligationIds).toContain("ob-2-dihedral-sine")

    const missingProof = evaluateDrawingContractScopes(gks01, {
      "(2)": { candidate: measurementCandidate, options: { verificationStatus: "passed" } }
    })
    expect(missingProof.passed).toBe(false)
    expect(missingProof.missingScopeIds).toEqual(["(1)"])
  })

  it("freezes the independently recomputed GK-P04 range and JT-P04 infeasibility instead of known wrong values", () => {
    const suite = loadContracts()
    const gkp04 = suite.cases.find((c) => c.id === "GK-P04")!
    expect(gkp04.subquestions.find((subquestion) => subquestion.id === "(2)")).toMatchObject({
      feasible: true,
      expectedResult: "a ∈ [-1, +∞)"
    })
    expect(gkp04.freeChoices).toContain("In (2), parameter a ∈ [-1, +∞) varies; in (1), x₁=-1 fixes a=3 and tangent y=2x+2")

    const jtp04 = suite.cases.find((c) => c.id === "JT-P04")!
    expect(jtp04.subquestions.find((subquestion) => subquestion.id === "(2)")).toMatchObject({
      feasible: false,
      expectedResult: "不存在满足条件的实数点 P"
    })
    expect(jtp04.sharedScope.subquestionScopes.find((scope) => scope.subquestion === "(2)")?.branchPolicy).toBe("diagnosis_if_infeasible")
    expect(jtp04.freeChoices).not.toContain("In (1) x_P varies along y=-2; in (2) concyclic fixes P(0,-2)")
  })

  it("verifies GK-S09's equal-edge right triangular prism and actual circumsphere instead of accepting arbitrary solids", () => {
    const suite = loadContracts()
    const gks09 = suite.cases.find((c) => c.id === "GK-S09")!
    const validPoints = [
      { id: "a", label: "A", x: 0, y: 0, z: 0 },
      { id: "b", label: "B", x: 1, y: 0, z: 0 },
      { id: "c", label: "C", x: 0.5, y: Math.sqrt(3) / 2, z: 0 },
      { id: "a1", label: "A₁", x: 0, y: 0, z: 1 },
      { id: "b1", label: "B₁", x: 1, y: 0, z: 1 },
      { id: "c1", label: "C₁", x: 0.5, y: Math.sqrt(3) / 2, z: 1 }
    ]
    const primitives = [
      ...validPoints.map((point) => ({ type: "point3", id: point.id, label: point.label, position: { x: point.x, y: point.y, z: point.z } })),
      { type: "polyhedron3", id: "prism", vertexIds: validPoints.map((point) => point.id), edgeIds: [], faceIds: [] },
      { type: "sphere", id: "sphere", center: { x: 0.5, y: Math.sqrt(3) / 6, z: 0.5 }, radius: Math.sqrt(7 / 12) }
    ]
    expect(evaluateDrawingContract(gks09, { primitives }, { verificationStatus: "passed" }).passed).toBe(true)

    const invalid = evaluateDrawingContract(gks09, {
      primitives: [
        ...validPoints.map((point, index) => ({ type: "point3", id: point.id, label: point.label, position: { x: point.x * (index + 1), y: point.y, z: point.z } })),
        { type: "polyhedron3", id: "prism", vertexIds: validPoints.map((point) => point.id), edgeIds: [], faceIds: [] },
        { type: "sphere3", id: "fake-sphere", radius: 1 }
      ]
    }, { verificationStatus: "passed" })
    expect(invalid.passed).toBe(false)
  })

  it("verifies JT-S09 cube edge length and hemisphere radius rather than ignoring both parameters", () => {
    const suite = loadContracts()
    const jts09 = suite.cases.find((c) => c.id === "JT-S09")!
    const validPoints = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => ({
      type: "point3", id: `v-${x}-${y}-${z}`, label: `V${x}${y}${z}`, position: { x, y, z }
    }))))
    const validPrims = [
      ...validPoints,
      { type: "polyhedron3", id: "cube", vertexIds: validPoints.map((point) => point.id), edgeIds: [], faceIds: [] },
      { type: "sphere", id: "hemisphere", center: { x: 0, y: 0, z: -1 }, radius: Math.sqrt(6) }
    ]
    expect(evaluateDrawingContract(jts09, { primitives: validPrims }, { verificationStatus: "passed" }).passed).toBe(true)

    const invalid = evaluateDrawingContract(jts09, {
      primitives: [
        ...validPoints.map((point) => point.position.z === 1 ? { ...point, position: { ...point.position, z: 3 } } : point),
        { type: "polyhedron3", id: "cube", vertexIds: validPoints.map((point) => point.id), edgeIds: [], faceIds: [] },
        { type: "sphere3", id: "fake-hemisphere", radius: 1 }
      ]
    }, { verificationStatus: "passed" })
    expect(invalid.passed).toBe(false)
  })

  it("accepts GK-S05's honest infeasible branch without P and rejects the same branch with a forged P", () => {
    const suite = loadContracts()
    const gks05 = suite.cases.find((c) => c.id === "GK-S05")!
    const basePrims = [
      { type: "point3", id: "a", label: "A", position: { x: 0, y: 0, z: 0 } },
      { type: "point3", id: "b", label: "B", position: { x: 2, y: 0, z: 0 } },
      { type: "point3", id: "c", label: "C", position: { x: 2, y: 2, z: 0 } },
      { type: "point3", id: "d", label: "D", position: { x: 0, y: 2, z: 0 } },
      { type: "point3", id: "a1", label: "A₁", position: { x: 0, y: 0, z: 4 } },
      { type: "point3", id: "b1", label: "B₁", position: { x: 2, y: 0, z: 4 } },
      { type: "point3", id: "c1", label: "C₁", position: { x: 2, y: 2, z: 4 } },
      { type: "point3", id: "d1", label: "D₁", position: { x: 0, y: 2, z: 4 } },
      { type: "point3", id: "a2", label: "A₂", position: { x: 0, y: 0, z: 1 } },
      { type: "point3", id: "b2", label: "B₂", position: { x: 2, y: 0, z: 2 } },
      { type: "point3", id: "c2", label: "C₂", position: { x: 2, y: 2, z: 3 } },
      { type: "point3", id: "d2", label: "D₂", position: { x: 0, y: 2, z: 2 } }
    ]
    const honest = evaluateDrawingContract(gks05, { primitives: basePrims }, {
      verificationStatus: "passed",
      answerText: "第(2)问不存在满足120°的点P。",
      infeasibleDiagnosedSubquestions: ["(2)"]
    })
    expect(honest.passed).toBe(true)

    const forged = evaluateDrawingContract(gks05, {
      primitives: [...basePrims, { type: "point3", id: "p", label: "P", position: { x: 2, y: 0, z: 1 } }]
    }, {
      verificationStatus: "passed",
      answerText: "第(2)问不存在满足120°的点P。",
      infeasibleDiagnosedSubquestions: ["(2)"]
    })
    expect(forged.passed).toBe(false)
    expect(forged.failedObligationIds).toContain("ob-infeasible-2")
  })

  it("fails GK-S02 when vertices E/F/P are missing even if ABCD base edges match", () => {
    const suite = loadContracts()
    const gks02 = suite.cases.find((c) => c.id === "GK-S02")!
    const candidate = {
      primitives: [
        { type: "point3", id: "p-d", label: "D", position: { x: 0, y: 0, z: 0 } },
        { type: "point3", id: "p-a", label: "A", position: { x: 5 * Math.sqrt(3), y: 0, z: 0 } },
        { type: "point3", id: "p-c", label: "C", position: { x: 0, y: 3, z: 0 } },
        { type: "point3", id: "p-b", label: "B", position: { x: Math.sqrt(3), y: 4, z: 0 } }
      ]
    }
    const result = evaluateDrawingContract(gks02, candidate, { verificationStatus: "unverified" })
    expect(result.passed).toBe(false)
    expect(result.missingEntityIds).toEqual(expect.arrayContaining(["E", "F", "P"]))
    expect(result.objectCoverage).toBeLessThan(1)
    expect(result.obligationCoverage).toBeLessThan(1)
    expect(result.bucket).not.toBe("passed")
  })

  it("catches JT-P08 EC=2CF negative counterexample where E and F both lie on the ellipse without satisfying vectorEC = 2*vectorCF", () => {
    const suite = loadContracts()
    const jtp08 = suite.cases.find((c) => c.id === "JT-P08")!

    const sharedBase = [
      { type: "point", id: "pt-a", label: "A", x: 0, y: Math.sqrt(3) },
      { type: "point", id: "pt-b", label: "B", x: 0, y: -Math.sqrt(3) },
      { type: "point", id: "pt-c", label: "C", x: 0, y: -1 },
      {
        type: "ellipse", id: "ell-g", label: "G", center: { x: 0, y: 0 }, radiusX: 2, radiusY: Math.sqrt(3),
        excludedPoints: [{ x: 0, y: Math.sqrt(3) }, { x: 0, y: -Math.sqrt(3) }]
      },
      { type: "line", id: "ef", label: "EF", a: { x: 2, y: 0 }, b: { x: -1, y: -1.5 } }
    ]

    // Positive valid figure: E(2,0), F(-1,-1.5) satisfies E,F on G and C-E = 2(F-C)
    const valid = evaluateDrawingContract(
      jtp08,
      {
        primitives: [
          ...sharedBase,
          { type: "point", id: "pt-e", label: "E", x: 2, y: 0 },
          { type: "point", id: "pt-f", label: "F", x: -1, y: -1.5 }
        ]
      },
      { verificationStatus: "passed", branchId: "positive" }
    )
    expect(valid.passed).toBe(true)
    expect(valid.objectCoverage).toBe(1)
    expect(valid.obligationCoverage).toBe(1)

    // Negative counterexample: E(2,0) and F(0,√3) are both on x²/4 + y²/3 = 1,
    // which fooled the naive baseline oracle, yet EC != 2 CF!
    const fake = evaluateDrawingContract(
      jtp08,
      {
        primitives: [
          ...sharedBase,
          { type: "point", id: "pt-e", label: "E", x: 2, y: 0 },
          { type: "point", id: "pt-f", label: "F", x: 0, y: Math.sqrt(3) }
        ]
      },
      { verificationStatus: "passed", branchId: "positive" }
    )
    expect(fake.passed).toBe(false)
    expect(fake.failedObligationIds).toContain("ob-ec-2cf")
  })

  it("rejects fabricating infeasible subquestion (2) on JT-P06 or omitting infeasible diagnosis", () => {
    const suite = loadContracts()
    const jtp06 = suite.cases.find((c) => c.id === "JT-P06")!
    const basePrims = [
      { type: "ellipse", id: "ell-c", label: "C", center: { x: 0, y: 0 }, radiusX: Math.sqrt(5), radiusY: 2 },
      { type: "point", id: "pt-f1", label: "F₁", x: -1, y: 0 },
      { type: "point", id: "pt-f2", label: "F₂", x: 1, y: 0 },
      { type: "point", id: "pt-m", label: "M", x: 2, y: (2 * Math.sqrt(5)) / 5 }
    ]

    // Fabricating a fake point P=(0,2) with no infeasibility note while claiming passed:
    const fabricated = evaluateDrawingContract(
      jtp06,
      { primitives: [...basePrims, { type: "point", id: "pt-p", label: "P", x: 0, y: 2 }] },
      { verificationStatus: "passed", answerText: "直接取 P(0,2) 得面积 2" }
    )
    expect(fabricated.passed).toBe(false)

    // Honest base drawing + explicit infeasibility disclosure:
    const honest = evaluateDrawingContract(
      jtp06,
      { primitives: basePrims },
      {
        verificationStatus: "passed",
        answerText: "椭圆 C: x²/5+y²/4=1，但因 b=2 > c=1，椭圆上不存在满足 PF₁⊥PF₂ 的点 P（不可行/无解）。",
        infeasibleDiagnosedSubquestions: ["(2)"]
      }
    )
    expect(honest.passed).toBe(true)

    const forgedWithDisclaimer = evaluateDrawingContract(
      jtp06,
      { primitives: [...basePrims, { type: "point", id: "pt-p", label: "P", x: 0, y: 2 }] },
      {
        verificationStatus: "passed",
        answerText: "第(2)问不存在这样的点，但仍画出 P(0,2)。",
        infeasibleDiagnosedSubquestions: ["(2)"]
      }
    )
    expect(forgedWithDisclaimer.passed).toBe(false)
    expect(forgedWithDisclaimer.failedObligationIds).toContain("ob-infeasible-2")
  })

  it("never shrinks denominator when cases are incomplete and does not count partial as passed", () => {
    const suite = loadContracts()
    const partialItems = suite.cases.map((contract: DrawingContractCase, index: number) => {
      if (index < 2) {
        return {
          id: contract.id,
          status: "incomplete" as const,
          bucket: "incomplete" as const,
          passed: false,
          partial: false,
          objectCoverage: 0,
          obligationCoverage: 0,
          requests: 0,
          tokens: { input: 0, output: 0 }
        }
      }
      if (index < 6) {
        return {
          id: contract.id,
          status: "partial" as const,
          bucket: "partial" as const,
          passed: false,
          partial: true,
          objectCoverage: 0.5,
          obligationCoverage: 0.5,
          requests: 1,
          tokens: { input: 100, output: 50 }
        }
      }
      return {
        id: contract.id,
        status: "failed" as const,
        bucket: "math" as const,
        passed: false,
        partial: false,
        objectCoverage: 0,
        obligationCoverage: 0,
        requests: 2,
        tokens: { input: 200, output: 80 }
      }
    })

    const summary = summarizeContractReports(suite, partialItems)
    expect(summary.denominator).toBe(36)
    expect(summary.totals.passed).toBe(0)
    expect(summary.totals.incomplete).toBe(2)
    expect(summary.incompleteCaseIds).toEqual(["GK-S01", "GK-S02"])
    expect(summary.buckets.partial).toBe(4)
    expect(summary.buckets.math).toBe(30)
    expect(summary.costKnown).toBe(false)
    expect(summary.costUsd).toBeNull()
  })

  it("reconstructs exact baseline counts (25/36 preview, 4/36 hostPassed, null full certificate) from saved baseline audit artifacts", () => {
    const suite = loadContracts()
    const baselineReport = JSON.parse(readFileSync("docs/audit/2026-11-15-drawing-baseline/baseline-report.json", "utf8"))
    const partialAudit = JSON.parse(readFileSync("docs/audit/2026-11-15-drawing-baseline/partial-oracle-audit.json", "utf8"))
    const triage = JSON.parse(readFileSync("docs/audit/2026-11-15-drawing-baseline/case-triage.json", "utf8"))

    const reconstructed = reconstructBaselineContractSummary(suite, { baselineReport, partialAudit, triage })
    expect(reconstructed.denominator).toBe(36)
    expect(reconstructed.baselineMetrics.previewProduced).toBe(25)
    expect(reconstructed.baselineMetrics.legacyHostPassed).toBe(4)
    expect(reconstructed.baselineMetrics.certificatePassed).toBeNull()
    expect(reconstructed.baselineMetrics.partialOracleExact).toBe(8)
    expect(reconstructed.totals.passed).toBeLessThanOrEqual(4)
    expect(reconstructed.totals.incomplete).toBe(0)
    expect(reconstructed.buckets.math + reconstructed.buckets.visual + reconstructed.buckets.interaction + reconstructed.buckets.partial + reconstructed.buckets.unknown + reconstructed.buckets.incomplete + reconstructed.totals.passed).toBe(36)
  })

  it("parses runner CLI flags for offline/replay contract evaluation cleanly", () => {
    expect(parseReliabilityArgs(["--offline", "--cases", "test-fixtures/reliability/drawing-contracts-36.json"])).toEqual({
      mode: "offline",
      cases: "test-fixtures/reliability/drawing-contracts-36.json"
    })
    expect(parseReliabilityArgs(["--replay", "eval-results/replay.json", "--cases", "test-fixtures/reliability/drawing-contracts-36.json"])).toEqual({
      mode: "replay",
      replay: "eval-results/replay.json",
      cases: "test-fixtures/reliability/drawing-contracts-36.json"
    })
  })

  it("ensures geometry-kernel expression and symbolic conic modules contain zero dynamic eval or new Function", () => {
    const exprSource = readFileSync("packages/geometry-kernel/src/expression.ts", "utf8")
    const conicSource = readFileSync("packages/geometry-kernel/src/conic-parameters.ts", "utf8")
    expect(exprSource).not.toMatch(/\beval\s*\(|new\s+Function\b/)
    expect(conicSource).not.toMatch(/\beval\s*\(|new\s+Function\b/)
  })
})
