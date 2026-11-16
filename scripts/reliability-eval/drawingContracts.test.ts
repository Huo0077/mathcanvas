// @vitest-environment node

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"
import { intersectPlanarLineAndConicExact, rotatePointAboutHinge } from "@draw/geometry-kernel"

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

function pyramidTopology(ids: readonly string[]) {
  const [p, a, b, c, d] = ids
  const rings = [[a, d, c, b], [p, a, b], [p, b, c], [p, c, d], [p, d, a]]
  return [
    ...rings.map((pointIds, index) => ({ type: "face3", id: `pyramid-face-${index}`, pointIds })),
    { type: "polyhedron3", id: "pyramid", vertexIds: ids, edgeIds: [], faceIds: rings.map((_, index) => `pyramid-face-${index}`) }
  ]
}

function squarePrismTopology(ids: readonly string[]) {
  const [a, b, c, d, a1, b1, c1, d1] = ids
  const rings = [[a, d, c, b], [a1, b1, c1, d1], [a, b, b1, a1], [b, c, c1, b1], [c, d, d1, c1], [d, a, a1, d1]]
  return [
    ...rings.map((pointIds, index) => ({ type: "face3", id: `prism-face-${index}`, pointIds })),
    { type: "polyhedron3", id: "prism", vertexIds: ids, edgeIds: [], faceIds: rings.map((_, index) => `prism-face-${index}`) }
  ]
}

function triangularPrismTopology(ids: readonly string[]) {
  const [a, b, c, a1, b1, c1] = ids
  const rings = [[a, c, b], [a1, b1, c1], [a, b, b1, a1], [b, c, c1, b1], [c, a, a1, c1]]
  return [
    ...rings.map((pointIds, index) => ({ type: "face3", id: `tri-prism-face-${index}`, pointIds })),
    { type: "polyhedron3", id: "tri-prism", vertexIds: ids, edgeIds: [], faceIds: rings.map((_, index) => `tri-prism-face-${index}`) }
  ]
}

function tetrahedronTopology(ids: readonly string[]) {
  const [a, b, c, p] = ids
  const rings = [[a, c, b], [a, b, p], [a, p, c], [b, c, p]]
  return [
    ...rings.map((pointIds, index) => ({ type: "face3", id: `tetra-face-${index}`, pointIds })),
    { type: "polyhedron3", id: "tetra", vertexIds: ids, edgeIds: [], faceIds: rings.map((_, index) => `tetra-face-${index}`) }
  ]
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

  it("verifies GK-P03 second intersections and the actual optimal-angle branch", () => {
    const suite = loadContracts()
    const gkp03 = suite.cases.find((c) => c.id === "GK-P03")!
    const point = (t: number) => ({ x: t * t, y: 2 * t })
    const candidateAtSum = (sum: number) => {
      const m = (sum + Math.sqrt(sum * sum + 4)) / 2, n = (sum - Math.sqrt(sum * sum + 4)) / 2
      const M = point(m), N = point(n), A = point(-2 / m), B = point(-2 / n)
      return [
        { type: "parabola", id: "c", label: "C", vertex: { x: 0, y: 0 }, axis: "x", focalParameter: 2 },
        { type: "point", id: "f", label: "F", x: 1, y: 0 }, { type: "point", id: "d", label: "D", x: 2, y: 0 },
        { type: "point", id: "m", label: "M", ...M }, { type: "point", id: "n", label: "N", ...N },
        { type: "point", id: "a", label: "A", ...A }, { type: "point", id: "b", label: "B", ...B },
        { type: "line", id: "ab", label: "AB", a: A, b: B }
      ]
    }
    const primitives = candidateAtSum(Math.SQRT2)
    const valid = evaluateDrawingContract(gkp03, { primitives }, { verificationStatus: "passed" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-m-on-c", "ob-n-on-c", "ob-a-on-c", "ob-b-on-c", "ob-mn-distinct", "ob-a-distinct", "ob-b-distinct", "ob-a-on-ab", "ob-b-on-ab", "ob-ab-equation"]))
    expect(gkp03.subquestions.find((subquestion) => subquestion.id === "(2)")?.expectedResult).toBe("x - √2 y - 4 = 0")
    const angleAtSum = (sum: number) => Math.atan(2 / sum) - Math.atan(1 / sum)
    expect(angleAtSum(Math.SQRT2)).toBeCloseTo(19.47122063449069 * Math.PI / 180, 12)
    expect(angleAtSum(Math.SQRT2)).toBeGreaterThan(angleAtSum(2))

    const nonOptimal = evaluateDrawingContract(gkp03, { primitives: candidateAtSum(2) }, { verificationStatus: "passed" })
    expect(nonOptimal.failedObligationIds).toContain("ob-ab-equation")
    const mPoint = primitives.find((primitive) => primitive.id === "m")!
    const invalid = evaluateDrawingContract(gkp03, {
      primitives: primitives.map((primitive) => primitive.id === "n" ? { ...primitive, x: mPoint.x, y: mPoint.y } : primitive)
    }, { verificationStatus: "passed" })
    expect(invalid.failedObligationIds).toContain("ob-mn-distinct")
    const detachedLine = evaluateDrawingContract(gkp03, {
      primitives: primitives.map((primitive) => primitive.id === "ab" ? { ...primitive, a: { x: 0, y: 0 }, b: { x: 4, y: 2 * Math.SQRT2 } } : primitive)
    }, { verificationStatus: "passed" })
    expect(detachedLine.failedObligationIds).toEqual(expect.arrayContaining(["ob-a-on-ab", "ob-b-on-ab"]))
  })

  it("verifies GK-P05 parabola points, perpendicular radii and all three circle tangencies", () => {
    const suite = loadContracts()
    const gkp05 = suite.cases.find((c) => c.id === "GK-P05")!
    const A1 = { x: 0, y: 0 }, A2 = { x: 3, y: Math.sqrt(3) }, A3 = { x: 3, y: -Math.sqrt(3) }
    const primitives = [
      { type: "parabola", id: "c", label: "C", vertex: { x: 0, y: 0 }, axis: "x", focalParameter: 0.5 },
      { type: "circle", id: "m", label: "M", center: { x: 2, y: 0 }, radius: 1 },
      { type: "point", id: "o", label: "O", x: 0, y: 0 }, { type: "point", id: "m-point", label: "M", x: 2, y: 0 },
      { type: "point", id: "p", label: "P", x: 1, y: 1 }, { type: "point", id: "q", label: "Q", x: 1, y: -1 },
      { type: "line", id: "l", label: "l", a: { x: 1, y: -2 }, b: { x: 1, y: 2 } },
      { type: "point", id: "a1", label: "A₁", ...A1 }, { type: "point", id: "a2", label: "A₂", ...A2 }, { type: "point", id: "a3", label: "A₃", ...A3 },
      { type: "line", id: "a1a2", label: "A1A2", a: A1, b: A2 },
      { type: "line", id: "a1a3", label: "A1A3", a: A1, b: A3 },
      { type: "line", id: "a2a3", label: "A2A3", a: A2, b: A3 }
    ]
    const valid = evaluateDrawingContract(gkp05, { primitives }, { verificationStatus: "passed" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-p-on-c", "ob-q-on-c", "ob-op-oq", "ob-a1-on-c", "ob-a2-on-c", "ob-a3-on-c", "ob-a1a2-tangent", "ob-a1a3-tangent", "ob-a2a3-tangent"]))

    const invalid = evaluateDrawingContract(gkp05, {
      primitives: primitives.map((primitive) => primitive.id === "a2a3" ? { ...primitive, b: { x: 4, y: -2 } } : primitive)
    }, { verificationStatus: "passed" })
    expect(invalid.failedObligationIds).toContain("ob-a2a3-tangent")
  })

  it("verifies JT-P05 hyperbola incidences, parallel chords and the constant ratio", () => {
    const suite = loadContracts()
    const jtp05 = suite.cases.find((c) => c.id === "JT-P05")!
    const x = Math.sqrt(24 / 5)
    const primitives = [
      { type: "hyperbola", id: "c", label: "C", center: { x: 0, y: 0 }, axis: "x", radiusX: 2, radiusY: Math.sqrt(5) },
      { type: "point", id: "m", label: "M", x: 0, y: 1 },
      { type: "point", id: "p", label: "P", x, y: 1 }, { type: "point", id: "q", label: "Q", x: -x, y: 1 },
      { type: "point", id: "f", label: "F", x: 3, y: 0 },
      { type: "point", id: "a", label: "A", x: 2, y: 0 }, { type: "point", id: "b", label: "B", x: -2, y: 0 }
    ]
    const valid = evaluateDrawingContract(jtp05, { primitives }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(valid.passed).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-p-on-c", "ob-q-on-c", "ob-mpq", "ob-a-on-c", "ob-b-on-c", "ob-fab", "ob-ab-pq-parallel", "ob-ratio"]))

    const invalid = evaluateDrawingContract(jtp05, {
      primitives: primitives.map((primitive) => primitive.id === "a" ? { ...primitive, y: 1 } : primitive)
    }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(invalid.failedObligationIds).toContain("ob-a-on-c")

    const scoped = evaluateDrawingContractScopes(jtp05, {
      "(1)": { candidate: { primitives }, options: { verificationStatus: "passed" } },
      "(2)": { candidate: { primitives }, options: { verificationStatus: "passed" } }
    })
    expect(scoped.passed, JSON.stringify(scoped.scopeResults)).toBe(true)
    expect(scoped.scopeResults["(2)"]?.passedObligationIds).toContain("ob-hyp")
    const wrongSecondCurve = evaluateDrawingContractScopes(jtp05, {
      "(1)": { candidate: { primitives }, options: { verificationStatus: "passed" } },
      "(2)": { candidate: { primitives: primitives.map((primitive) => primitive.id === "c" ? { ...primitive, radiusX: 3 } : primitive) }, options: { verificationStatus: "passed" } }
    })
    expect(wrongSecondCurve.scopeResults["(2)"]?.failedObligationIds).toContain("ob-hyp")
  })

  it("verifies JT-P04 tangent/directrix dependencies and honest infeasibility", () => {
    const suite = loadContracts()
    const jtp04 = suite.cases.find((c) => c.id === "JT-P04")!
    const A = { x: 2, y: 1 }, B = { x: -4, y: 4 }, P = { x: -1, y: -2 }
    const primitives = [
      { type: "parabola", id: "gamma", label: "Γ", vertex: { x: 0, y: 0 }, axis: "y", focalParameter: 2 },
      { type: "point", id: "m", label: "M", x: 4, y: 4 }, { type: "point", id: "p", label: "P", ...P },
      { type: "point", id: "a", label: "A", ...A }, { type: "point", id: "b", label: "B", ...B },
      { type: "point", id: "c", label: "C", x: 2, y: -1 }, { type: "point", id: "d", label: "D", x: -4, y: -1 },
      { type: "line", id: "pa", label: "PA", a: P, b: A }, { type: "line", id: "pb", label: "PB", a: P, b: B }
    ]
    const result = evaluateDrawingContractScopes(jtp04, {
      "(1)": { candidate: { primitives }, options: { verificationStatus: "passed" } },
      "(2)": { candidate: { primitives }, options: { verificationStatus: "passed", answerText: "不存在实数点 P 使 A,C,P,D 共圆。", infeasibleDiagnosedSubquestions: ["(2)"] } }
    })
    expect(result.passed, JSON.stringify(result.scopeResults)).toBe(true)
    expect(result.scopeResults["(1)"]?.passedObligationIds).toEqual(expect.arrayContaining(["ob-pa-tangent", "ob-pb-tangent"]))
    expect(result.scopeResults["(2)"]?.passedObligationIds).toEqual(expect.arrayContaining(["ob-c-directrix", "ob-d-directrix", "ob-ac-vertical", "ob-bd-vertical", "ob-2-infeasible"]))
  })

  it("verifies JT-P03 parabola secant and D/E intersections with OA/OB and l", () => {
    const suite = loadContracts()
    const jtp03 = suite.cases.find((c) => c.id === "JT-P03")!
    const A = { x: 2, y: 2 * Math.SQRT2 }, B = { x: 2, y: -2 * Math.SQRT2 }
    const primitives = [
      { type: "parabola", id: "c", label: "C", vertex: { x: 0, y: 0 }, axis: "x", focalParameter: 2 },
      { type: "point", id: "o", label: "O", x: 0, y: 0 },
      { type: "point", id: "a", label: "A", ...A }, { type: "point", id: "b", label: "B", ...B },
      { type: "line", id: "ab", label: "AB", a: A, b: B },
      { type: "line", id: "l", label: "l", a: { x: 0, y: 1 }, b: { x: 1, y: 2 } },
      { type: "point", id: "d", label: "D", x: 1 + Math.SQRT2, y: 2 + Math.SQRT2 },
      { type: "point", id: "e", label: "E", x: 1 - Math.SQRT2, y: 2 - Math.SQRT2 }
    ]
    const valid = evaluateDrawingContract(jtp03, { primitives }, { verificationStatus: "passed" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-a-on-c", "ob-b-on-c", "ob-ab-through", "ob-l-equation", "ob-d-on-l", "ob-e-on-l", "ob-oad", "ob-obe"]))

    const invalid = evaluateDrawingContract(jtp03, {
      primitives: primitives.map((primitive) => primitive.id === "d" ? { ...primitive, x: 0, y: 0.5 } : primitive)
    }, { verificationStatus: "passed" })
    expect(invalid.failedObligationIds).toContain("ob-d-on-l")
    expect(invalid.failedObligationIds).toContain("ob-oad")
  })

  it("diagnoses JT-P01(2) as two intersections rather than fabricating a tangent proof", () => {
    const suite = loadContracts()
    const jtp01 = suite.cases.find((c) => c.id === "JT-P01")!
    const intersection = intersectPlanarLineAndConicExact(
      { type: "line", a: { x: 0.5, y: -1 }, b: { x: 0.5, y: 1 } },
      { type: "ellipse", id: "c", center: { x: 0, y: 0 }, radiusX: 2, radiusY: Math.sqrt(3) }
    )
    expect(intersection.kind).toBe("secant")
    expect(intersection.points).toHaveLength(2)
    for (const point of intersection.points) expect(Math.abs(point.y)).toBeCloseTo(3 * Math.sqrt(5) / 4, 12)

    expect(jtp01.subquestions.find((subquestion) => subquestion.id === "(2)")?.feasible).toBe(false)
    expect(jtp01.requiredObligations.map((obligation) => obligation.id)).toContain("ob-2-infeasible")
    const base = {
      primitives: [
        { type: "ellipse", id: "c", label: "C", center: { x: 0, y: 0 }, radiusX: 2, radiusY: Math.sqrt(3) },
        { type: "point", id: "f1", label: "F₁", x: -1, y: 0 },
        { type: "point", id: "f2", label: "F₂", x: 1, y: 0 },
        { type: "point", id: "a", label: "A", x: 2, y: 0 },
        { type: "circle", id: "locus", label: "M", center: { x: 1, y: 0 }, radius: 4 }
      ]
    }
    const honest = evaluateDrawingContractScopes(jtp01, {
      "(1)": { candidate: base, options: { verificationStatus: "passed" } },
      "(2)": { candidate: base, options: { verificationStatus: "passed", answerText: "第(2)问不成立：垂直平分线与椭圆有两个公共点。", infeasibleDiagnosedSubquestions: ["(2)"] } },
      "(3)": { candidate: base, options: { verificationStatus: "passed" } }
    })
    expect(honest.passed).toBe(true)
    const wrongCurve = evaluateDrawingContract(jtp01, {
      primitives: base.primitives.map((primitive) => primitive.id === "c" ? { ...primitive, radiusX: 3 } : primitive)
    }, { verificationStatus: "passed", scopeId: "(2)", answerText: "第(2)问不成立：有两个公共点。", infeasibleDiagnosedSubquestions: ["(2)"] })
    expect(wrongCurve.failedObligationIds).toContain("ob-c")
  })

  it("verifies all three GK-P06 tangent-circle branches and binds the named endpoints", () => {
    const suite = loadContracts()
    const gkp06 = suite.cases.find((c) => c.id === "GK-P06")!
    const candidateAtD = (d: number) => {
      const aX = d + Math.sqrt(d * d + 1), bX = d - Math.sqrt(d * d + 1)
      const D = { x: d, y: -0.5 }, A = { x: aX, y: aX * aX / 2 }, B = { x: bX, y: bX * bX / 2 }, M = { x: d, y: d * d + 0.5 }
      return [
        { type: "parabola", id: "c", label: "C", vertex: { x: 0, y: 0 }, axis: "y", focalParameter: 1 },
        { type: "point", id: "d", label: "D", ...D }, { type: "point", id: "a", label: "A", ...A }, { type: "point", id: "b", label: "B", ...B },
        { type: "point", id: "m", label: "M", ...M }, { type: "point", id: "e-point", label: "E", x: 0, y: 2.5 },
        { type: "circle", id: "e", label: "E", center: { x: 0, y: 2.5 }, radius: Math.hypot(d, 2 - d * d) },
        { type: "line", id: "da", label: "DA", a: D, b: A }, { type: "line", id: "db", label: "DB", a: D, b: B },
        { type: "line", id: "ab", label: "AB", a: A, b: B }
      ]
    }
    const inputs = Object.fromEntries([[-1, "negative"], [0, "zero"], [1, "positive"]].map(([d, branchId]) => [branchId, {
      candidate: { primitives: candidateAtD(Number(d)) }, options: { verificationStatus: "passed" }
    }]))
    const branches = evaluateDrawingContractBranches(gkp06, "(2)", inputs)
    expect(branches.passed, JSON.stringify(branches.scopeResults)).toBe(true)
    expect(Object.keys(branches.scopeResults)).toEqual(["zero", "positive", "negative"])
    expect(gkp06.subquestions.find((subquestion) => subquestion.id === "(2)")?.expectedResult).toBe("3 或 4√2")
    expect(branches.scopeResults.zero?.passedObligationIds).toEqual(expect.arrayContaining(["ob-da-tangent", "ob-db-tangent", "ob-ab-midpoint", "ob-e-tangent", "ob-area", "ob-a-on-c", "ob-b-on-c", "ob-d-on-da", "ob-a-on-da", "ob-d-on-db", "ob-b-on-db"]))
    expect(branches.missingScopeIds).toEqual([])

    const detached = evaluateDrawingContractBranches(gkp06, "(2)", {
      ...inputs,
      positive: { candidate: { primitives: candidateAtD(1).map((primitive) => primitive.id === "a" ? { ...primitive, y: 0 } : primitive) }, options: { verificationStatus: "passed" } }
    })
    expect(detached.passed).toBe(false)
    expect(detached.scopeResults.positive?.failedObligationIds).toEqual(expect.arrayContaining(["ob-a-on-c", "ob-a-on-da"]))
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
    const degenerate = evaluateDrawingContract(gkp09, {
      primitives: [
        { type: "function", id: "f", label: "f", expression: "x^4-2*x^3", domain: [-5, 5] },
        { type: "line", id: "tangent", label: "tangent", a: { x: 1, y: -1 }, b: { x: 1, y: -1 } }
      ]
    }, { verificationStatus: "passed" })
    expect(degenerate.failedObligationIds).toContain("ob-tan-derivative")

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
    const makeBranch = (sign: 1 | -1, includeExclusions = true, radiusX = 2) => ({
      primitives: [
        { type: "point", id: "a", label: "A", x: 0, y: Math.sqrt(3) },
        { type: "point", id: "b", label: "B", x: 0, y: -Math.sqrt(3) },
        { type: "point", id: "c", label: "C", x: 0, y: -1 },
        {
          type: "ellipse", id: "g", label: "G", center: { x: 0, y: 0 }, radiusX, radiusY: Math.sqrt(3),
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
    const wrongGeometry = evaluateDrawingContractBranches(jtp08, "(Ⅱ)", {
      positive: { candidate: makeBranch(1, true, 3), options: { verificationStatus: "passed" } },
      negative: { candidate: makeBranch(-1), options: { verificationStatus: "passed" } }
    })
    expect(wrongGeometry.scopeResults.positive?.failedObligationIds).toContain("ob-g-domain")
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
    const coincident = evaluateDrawingContract(gkp02, {
      primitives: primitives.map((primitive) => primitive.id === "n" ? { ...primitive, ...M } : primitive)
    }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(coincident.failedObligationIds).toContain("ob-mn-distinct")
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
    const scopes = evaluateDrawingContractScopes(gkp01, {
      "(1)": { candidate: { primitives }, options: { verificationStatus: "passed" } },
      "(2)": { candidate: { primitives: [...primitives.filter((primitive) => primitive.id !== "c"), { type: "ellipse", id: "c", label: "C", center: { x: 0, y: 0 }, radiusX: 3, radiusY: Math.SQRT2 }, { ...primitives[0]!, id: "decoy", label: "decoy" }] }, options: { verificationStatus: "passed" } }
    })
    expect(scopes.scopeResults["(2)"]?.failedObligationIds).toContain("ob-c")
    expect(scopes.scopeResults["(1)"]?.passedObligationIds).toContain("ob-c")
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
    const topology = pyramidTopology(["pt-P", "pt-A", "pt-B", "pt-C", "pt-D"])
    const validM = point("M", { x: 16 / 17, y: 24 / 17, z: 16 / 17 })
    const valid = evaluateDrawingContract(jts03, { primitives: [...base, validM, ...topology] }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(valid.passed).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-m-in-pcd", "ob-am-pc"]))

    const wrongM = point("M", { x: 2, y: 3, z: 0 })
    const invalid = evaluateDrawingContract(jts03, { primitives: [...base, wrongM, ...topology] }, { verificationStatus: "passed", scopeId: "(2)" })
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
    const topology = triangularPrismTopology(["pt-A", "pt-B", "pt-C", "pt-A₁", "pt-B₁", "pt-C₁"])
    const validP = point("P", { x: -2 * ratio, y: 2 - 2 * ratio, z: 2 })
    const valid = evaluateDrawingContract(jts02, { primitives: [A, B, C, A1, B1, C1, validP, ...topology] }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(valid.passed).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-plane-perp", "ob-2-p-host", "ob-2-dihedral-cos"]))
    expect(jts02.requiredObligations.map((obligation) => obligation.id)).not.toContain("ob-ac-bb1")

    const midpoint = point("P", { x: -1, y: 1, z: 2 })
    const invalid = evaluateDrawingContract(jts02, { primitives: [A, B, C, A1, B1, C1, midpoint, ...topology] }, { verificationStatus: "passed", scopeId: "(2)" })
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
    const topology = pyramidTopology(["pt-P", "pt-A", "pt-B", "pt-C", "pt-D"])
    const proofCandidate = { primitives: [...base, point("D", { x: 0.5, y: Math.sqrt(3) / 2, z: 0 }), ...topology] }
    const measurementCandidate = { primitives: [...base, point("D", { x: 1.5, y: Math.sqrt(3) / 2, z: 0 }), ...topology] }
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

  it("verifies JT-S04 as a rigid EF fold with the unique interior solution BE=5", () => {
    const suite = loadContracts()
    const jts04 = suite.cases.find((c) => c.id === "JT-S04")!
    const h = 2 * Math.sqrt(3), e = 5
    const beforePoints = {
      A: { x: 0, y: 0, z: 0 }, B: { x: 0, y: h, z: 0 },
      E: { x: e, y: h, z: 0 }, F: { x: e, y: 0, z: 0 },
      C: { x: 8, y: h, z: 0 }, D: { x: 9, y: 0, z: 0 }
    }
    const foldedA = rotatePointAboutHinge(beforePoints.A, beforePoints.F, beforePoints.E, 90)
    const foldedB = rotatePointAboutHinge(beforePoints.B, beforePoints.F, beforePoints.E, 90)
    if (foldedA.status !== "ok" || foldedB.status !== "ok") throw new Error("valid fold hinge")
    expect(foldedA.point).toEqual({ x: e, y: 0, z: e })
    expect(foldedB.point).toEqual({ x: e, y: h, z: e })
    type FoldPrimitive = { type: string; id: string; label?: string; position?: { x: number; y: number; z: number }; pointIds?: string[]; vertexIds?: string[]; edgeIds?: string[]; faceIds?: string[] }
    const beforePrimitives: FoldPrimitive[] = Object.entries(beforePoints).map(([label, position]) => ({ type: "point3", id: label.toLowerCase(), label, position }))
    const primitives: FoldPrimitive[] = beforePrimitives.map((primitive) => primitive.id === "a" || primitive.id === "b"
      ? { ...primitive, position: primitive.id === "a" ? foldedA.point : foldedB.point }
      : primitive)
    primitives.push(
      { type: "face3", id: "abef", pointIds: ["a", "b", "e", "f"] },
      { type: "face3", id: "ecdf", pointIds: ["e", "c", "d", "f"] },
      { type: "polyhedron3", id: "folded", vertexIds: ["a", "b", "e", "f", "c", "d"], edgeIds: [], faceIds: ["abef", "ecdf"] }
    )
    const before = evaluateDrawingContract(jts04, { primitives: beforePrimitives }, { verificationStatus: "passed", scopeId: "(1)", stateId: "before_fold" })
    expect(before.passed, JSON.stringify(before.obligationResults)).toBe(true)
    expect(before.passedObligationIds).toEqual(expect.arrayContaining(["ob-e-ratio", "ob-f-ratio"]))
    const valid = evaluateDrawingContract(jts04, { primitives }, { verificationStatus: "passed", scopeId: "(1)", stateId: "after_fold" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-cf-bd", "ob-planes-perpendicular", "ob-open-topology"]))
    expect(jts04.subquestions.find((subquestion) => subquestion.id === "(1)")?.expectedResult).toBe("5")
    expect(jts04.requiredObligations.map((obligation) => obligation.id)).not.toContain("ob-be-ec-perp")

    const wrongLength = primitives.map((primitive) => primitive.type === "point3" && ["a", "b", "e", "f"].includes(primitive.id)
      ? { ...primitive, position: { ...primitive.position, x: 20 / 3 } }
      : primitive)
    expect(evaluateDrawingContract(jts04, { primitives: wrongLength }, { verificationStatus: "passed", scopeId: "(1)", stateId: "before_fold" }).failedObligationIds).toEqual(expect.arrayContaining(["ob-e-ratio", "ob-f-ratio"]))
    expect(evaluateDrawingContract(jts04, { primitives: wrongLength }, { verificationStatus: "passed", scopeId: "(1)", stateId: "after_fold" }).failedObligationIds).toContain("ob-cf-bd")
  })

  it("verifies JT-S08 perpendicular folded planes without inventing manifold topology", () => {
    const suite = loadContracts()
    const jts08 = suite.cases.find((c) => c.id === "JT-S08")!
    const h = Math.sqrt(3) / 2
    const primitives = [
      { type: "point3", id: "a", label: "A", position: { x: 0, y: 0, z: 0 } },
      { type: "point3", id: "b", label: "B", position: { x: 1, y: 0, z: 0 } },
      { type: "point3", id: "c", label: "C", position: { x: 0.5, y: h, z: 0 } },
      { type: "point3", id: "d", label: "D", position: { x: -0.5, y: h, z: 0 } },
      { type: "point3", id: "e", label: "E", position: { x: 0, y: 0, z: 1 } },
      { type: "point3", id: "f", label: "F", position: { x: 0.5, y: h, z: 1 } },
      { type: "point3", id: "m", label: "M", position: { x: 0.25, y: h / 2, z: 1 } }
    ]
    const valid = evaluateDrawingContract(jts08, { primitives }, { verificationStatus: "passed", scopeId: "(2)" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toContain("ob-planes-perpendicular")
  })

  it("verifies JT-S05 rectangle, equilateral PCD, volume and closed topology", () => {
    const suite = loadContracts()
    const jts05 = suite.cases.find((c) => c.id === "JT-S05")!
    const primitives = [
      { type: "point3", id: "a", label: "A", position: { x: 0, y: 0, z: 0 } },
      { type: "point3", id: "b", label: "B", position: { x: 2, y: 0, z: 0 } },
      { type: "point3", id: "c", label: "C", position: { x: 2, y: 1, z: 0 } },
      { type: "point3", id: "d", label: "D", position: { x: 0, y: 1, z: 0 } },
      { type: "point3", id: "p", label: "P", position: { x: 1, y: 1, z: Math.sqrt(3) } },
      { type: "point3", id: "e", label: "E", position: { x: 1.5, y: 1, z: Math.sqrt(3) / 2 } },
      ...pyramidTopology(["p", "a", "b", "c", "d"])
    ]
    const valid = evaluateDrawingContract(jts05, { primitives }, { verificationStatus: "passed" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)
    expect(valid.passedObligationIds).toEqual(expect.arrayContaining(["ob-ad", "ob-cd", "ob-base-coplanar", "ob-topology"]))

    const invalid = evaluateDrawingContract(jts05, {
      primitives: primitives.map((primitive) => primitive.id === "d" ? { ...primitive, position: { x: 0, y: 2, z: 0 } } : primitive)
    }, { verificationStatus: "passed" })
    expect(invalid.failedObligationIds).toContain("ob-ad")
    expect(invalid.failedObligationIds).toContain("ob-cd")
  })

  it("verifies JT-S01 perpendicular folding, circumsphere and scoped subparts", () => {
    const suite = loadContracts()
    const jts01 = suite.cases.find((c) => c.id === "JT-S01")!
    const primitives = [
      { type: "point3", id: "a", label: "A", position: { x: 0, y: 0, z: 0 } },
      { type: "point3", id: "b", label: "B", position: { x: 0, y: 1, z: 0 } },
      { type: "point3", id: "c", label: "C", position: { x: 1, y: 0, z: 0 } },
      { type: "point3", id: "p", label: "P", position: { x: 1.5, y: 0, z: Math.sqrt(3) / 2 } },
      ...tetrahedronTopology(["a", "b", "c", "p"]),
      { type: "sphere", id: "o", label: "O", center: { x: 0.5, y: 0.5, z: Math.sqrt(3) / 2 }, radius: Math.sqrt(5) / 2 }
    ]
    const withoutSphere = primitives.filter((primitive) => primitive.id !== "o")
    const result = evaluateDrawingContractScopes(jts01, {
      "(1)(i)": { candidate: { primitives: withoutSphere }, options: { verificationStatus: "passed" } },
      "(1)(ii)": { candidate: { primitives }, options: { verificationStatus: "passed" } },
      "(2)": { candidate: { primitives: withoutSphere }, options: { verificationStatus: "passed" } }
    })
    expect(result.passed, JSON.stringify(result.scopeResults)).toBe(true)
    expect(result.scopeResults["(1)(i)"]?.passedObligationIds).toContain("ob-pc-ab")
    expect(result.scopeResults["(1)(ii)"]?.passedObligationIds).toEqual(expect.arrayContaining(["ob-pc-ab", "ob-circumsphere", "ob-sphere-present"]))
    expect(jts01.requiredEntityIds).not.toContain("O")
    expect(jts01.sharedScope.subquestionScopes.map((scope) => scope.subquestion)).toEqual(expect.arrayContaining(["(1)(i)", "(1)(ii)"]))
    expect(evaluateDrawingContract(jts01, { primitives: withoutSphere }, { verificationStatus: "passed", scopeId: "(1)(ii)" }).failedObligationIds).toContain("ob-sphere-present")
    const wrongFold = primitives.map((primitive) => primitive.id === "p" && "position" in primitive ? { ...primitive, position: { ...primitive.position, y: 0.25 } } : primitive)
    expect(evaluateDrawingContract(jts01, { primitives: wrongFold }, { verificationStatus: "passed", scopeId: "(1)(ii)" }).failedObligationIds).toContain("ob-pc-ab")
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
    const rings = [[0, 2, 1], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]]
    const primitives = [
      ...validPoints.map((point, index) => ({ type: "point3", id: `v${index}`, label: point.label, position: { x: point.x, y: point.y, z: point.z } })),
      ...rings.map((pointIds, index) => ({ type: "face3", id: `f${index}`, pointIds: pointIds.map((point) => `v${point}`) })),
      { type: "polyhedron3", id: "prism", vertexIds: validPoints.map((_, index) => `v${index}`), edgeIds: [], faceIds: rings.map((_, index) => `f${index}`) },
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
    const vertexId = (x: number, y: number, z: number) => `v-${x}-${y}-${z}`
    const topology = squarePrismTopology([
      vertexId(-1, -1, -1), vertexId(-1, 1, -1), vertexId(-1, 1, 1), vertexId(-1, -1, 1),
      vertexId(1, -1, -1), vertexId(1, 1, -1), vertexId(1, 1, 1), vertexId(1, -1, 1)
    ])
    const validPrims = [
      ...validPoints,
      ...topology,
      { type: "sphere", id: "hemisphere", center: { x: 0, y: 0, z: -1 }, radius: Math.sqrt(6) }
    ]
    const valid = evaluateDrawingContract(jts09, { primitives: validPrims }, { verificationStatus: "passed" })
    expect(valid.passed, JSON.stringify(valid.obligationResults)).toBe(true)

    const invalid = evaluateDrawingContract(jts09, {
      primitives: [
        ...validPoints.map((point) => point.position.z === 1 ? { ...point, position: { ...point.position, z: 3 } } : point),
        ...topology,
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
      { type: "point3", id: "d2", label: "D₂", position: { x: 0, y: 2, z: 2 } },
      ...squarePrismTopology(["a", "b", "c", "d", "a1", "b1", "c1", "d1"])
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
    const wrongCurve = evaluateDrawingContractScopes(jtp06, {
      "(1)": { candidate: { primitives: basePrims }, options: { verificationStatus: "passed" } },
      "(2)": { candidate: { primitives: basePrims.map((primitive) => primitive.id === "ell-c" ? { ...primitive, radiusX: 3 } : primitive) }, options: { verificationStatus: "passed", answerText: "第(2)问不成立。", infeasibleDiagnosedSubquestions: ["(2)"] } }
    })
    expect(wrongCurve.scopeResults["(2)"]?.failedObligationIds).toContain("ob-c")

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
