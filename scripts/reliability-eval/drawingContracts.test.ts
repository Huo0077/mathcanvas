// @vitest-environment node

import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  evaluateDrawingContract,
  reconstructBaselineContractSummary,
  summarizeContractReports,
  validateContractSuite,
  type ContractSuiteFile,
  type DrawingContractCase
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
      { type: "ellipse", id: "ell-g", label: "G", center: { x: 0, y: 0 }, radiusX: 2, radiusY: Math.sqrt(3) }
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
      { verificationStatus: "passed" }
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
      { verificationStatus: "passed" }
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
