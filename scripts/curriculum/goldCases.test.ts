import { expect, it } from "vitest"

import { auditCoverage, type SourceUnit, type CurriculumUnit, type SourceSubtype } from "./catalog"
import { auditGoldCases, type GoldCase } from "./goldCases"
import workingCatalog from "../../docs/taxonomy/high-school-2025.json"
import officialIndex from "../../docs/taxonomy/high-school-2025-source-index.json"
import casesFile from "../../docs/taxonomy/curriculum-gold-cases.json"

const positive: GoldCase = {
  caseId: "set-intersection-true", subtypeId: "compulsory-sets/operations", unitId: "compulsory-sets",
  scope: "curriculum", role: "positive", taskKind: "proposition", curriculumVersion: "2017-2025", origin: "authored",
  prompt: "A={1,2}, B={2,3}，判断 A∩B={2} 是否成立。",
  goldGoal: { verdict: "true", rationale: "交集只有两集合共同的元素 2。" },
  reviewStatus: "internally_checked"
}

/** Break guarded: a false conclusion without a counterexample is not a reviewed negative. */
it("refuses a negative case that cannot demonstrate why the claim is false", () => {
  const invalid: GoldCase = { ...positive, caseId: "wrong", role: "negative", goldGoal: { verdict: "false", rationale: "元素一不属于两个集合的交集，因此结论错误。" } }
  expect(auditGoldCases([invalid], new Set([positive.subtypeId])).invalidCases).toContain("wrong")
})

/** Break guarded: an unspecified variable cannot be silently resolved by the candidate image. */
it("requires an explicit missing premise in an underdetermined case", () => {
  const invalid: GoldCase = { ...positive, caseId: "unknown", role: "ambiguous", goldGoal: { verdict: "underdetermined", rationale: "没有指定第二个集合，无法算出确定的交集。" } }
  expect(auditGoldCases([invalid], new Set([positive.subtypeId])).invalidCases).toContain("unknown")
})

/** Break guarded: authored internal checks must not impersonate teacher sign-off or Lean proof. */
it("separates mathematically checked fixtures from teacher or Lean evidence", () => {
  const result = auditGoldCases([positive], new Set([positive.subtypeId]))
  expect(result.invalidCases).toEqual([])
  expect(result.internalCaseIds).toEqual([positive.caseId])
  expect(result.teacherReviewedCaseIds).toEqual([])
  expect(result).not.toHaveProperty("formallyProved")
})

/** Break guarded: a case about one subtype must not inflate another subtype's coverage. */
it("rejects unknown subtypes and duplicate case ids", () => {
  const swapped: GoldCase = { ...positive, subtypeId: "unknown-domain" }
  const result = auditGoldCases([positive, { ...positive }, swapped], new Set([positive.subtypeId]))
  expect(result.duplicateIds).toContain(positive.caseId)
  expect(result.invalidCases).toContain(swapped.caseId)
})

/** Break guarded: the dataset provides all three roles but does not assert high-school coverage. */
it("records nine authored cross-domain examples without claiming full curriculum or exam success", () => {
  const all = casesFile.cases as GoldCase[]
  expect(all).toHaveLength(9)
  const known = new Set(officialIndex.expectedSubtypes.map((item) => item.subtypeId))
  const quality = auditGoldCases(all, known)
  expect(quality.invalidCases).toEqual([])
  expect(quality.duplicateIds).toEqual([])
  expect(quality.teacherReviewedCaseIds).toEqual([])
  expect(quality.internalCaseIds).toHaveLength(9)
  expect(new Set(all.map((item) => item.subtypeId)).size).toBe(3)
  const catalog = auditCoverage(officialIndex.expectedUnits as SourceUnit[], workingCatalog.units as CurriculumUnit[], all, officialIndex.expectedSubtypes as SourceSubtype[])
  for (const subtypeId of new Set(all.map((item) => item.subtypeId))) {
    for (const role of ["positive", "negative", "ambiguous"]) expect(catalog.missingCases).not.toContain(`${subtypeId}:${role}`)
  }
  expect(catalog.ready).toBe(false)
  expect(workingCatalog.exam.status).toBe("not_measured")
})
