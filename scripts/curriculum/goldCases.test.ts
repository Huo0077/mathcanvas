import { expect, it } from "vitest"

import { auditCoverage, type SourceUnit, type CurriculumUnit, type SourceSubtype } from "./catalog"
import { auditGoldCases, type GoldCase } from "./goldCases"
import workingCatalog from "../../docs/taxonomy/high-school-2025.json"
import officialIndex from "../../docs/taxonomy/high-school-2025-source-index.json"
import casesFile from "../../docs/taxonomy/curriculum-gold-cases.json"

const positive: GoldCase = {
  caseId: "triangle-perpendicular-true", subtypeId: "compulsory-trigonometry/applications", unitId: "compulsory-trigonometry",
  scope: "curriculum", role: "positive", taskKind: "proposition", curriculumVersion: "2017-2025", origin: "authored",
  prompt: "请画三角形 A(0,0)、B(4,0)、C(0,3)，判断 AB 与 AC 是否垂直。",
  goldGoal: { verdict: "true", rationale: "AB 向量为 (4,0)，AC 向量为 (0,3)，点积为零。" },
  reviewStatus: "internally_checked",
  diagram: { family: "triangle", intent: "required", witnessCandidate: { description: "A(0,0),B(4,0),C(0,3) 的平面三角形", freeChoices: [] } }
}

/** Break guarded: a false conclusion without a counterexample is not a reviewed negative. */
it("refuses a negative case that cannot demonstrate why the claim is false", () => {
  const invalid: GoldCase = { ...positive, caseId: "wrong", role: "negative", prompt: "画出指定三角形，判断 AB 是否平行 AC。", goldGoal: { verdict: "false", rationale: "两向量线性无关，不可能平行。" } }
  expect(auditGoldCases([invalid], new Set([positive.subtypeId])).invalidCases).toContain("wrong")
})

/** Break guarded: an unspecified variable cannot be silently resolved by the candidate image. */
it("requires an explicit missing premise in an underdetermined case", () => {
  const invalid: GoldCase = { ...positive, caseId: "unknown", role: "ambiguous", prompt: "只给 A(0,0)、B(4,0) 且 A 处直角，请画任一满足条件的三角形。", goldGoal: { verdict: "underdetermined", rationale: "没有指定 AC 的长度，点 C 不唯一。" }, diagram: { family: "triangle", intent: "required", witnessCandidate: { description: "可取 C(0,3)", freeChoices: ["AC=3"] } } }
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
it("keeps twelve authored diagram examples separate from verified geometry, teacher review and exam success", () => {
  const all = casesFile.cases as GoldCase[]
  expect(all).toHaveLength(12)
  const known = new Set(officialIndex.expectedSubtypes.map((item) => item.subtypeId))
  const quality = auditGoldCases(all, known)
  expect(quality.invalidCases).toEqual([])
  expect(quality.duplicateIds).toEqual([])
  expect(quality.teacherReviewedCaseIds).toEqual([])
  expect(quality.internalCaseIds).toHaveLength(12)
  expect(new Set(all.map((item) => item.subtypeId)).size).toBe(4)
  expect(new Set(all.map((item) => item.diagram?.family))).toEqual(new Set(["triangle", "conic", "derivative_graph", "solid3d"]))
  expect(quality.freeWitnessCandidateCaseIds).toHaveLength(4)
  const catalog = auditCoverage(officialIndex.expectedUnits as SourceUnit[], workingCatalog.units as CurriculumUnit[], all, officialIndex.expectedSubtypes as SourceSubtype[])
  for (const subtypeId of new Set(all.map((item) => item.subtypeId))) {
    for (const role of ["positive", "negative", "ambiguous"]) expect(catalog.missingCases).not.toContain(`${subtypeId}:${role}`)
  }
  expect(catalog.ready).toBe(false)
  expect(workingCatalog.exam.status).toBe("not_measured")
})

/** Break guarded: an ambiguous diagram may still have a valid illustrative free-point witness. */
it("allows an underdetermined task to supply a candidate diagram without claiming uniqueness", () => {
  const caseWithFreedom: GoldCase = {
    ...positive, caseId: "triangle-free-apex", role: "ambiguous",
    goldGoal: { verdict: "underdetermined", rationale: "顶点 C 的高度未定，不唯一。", missingCondition: "给出 AC 长度才能唯一确定 C。" },
    diagram: { family: "triangle", intent: "required", witnessCandidate: { description: "取 C(0,3) 满足 A 处直角", freeChoices: ["AC=3"] } }
  }
  const result = auditGoldCases([caseWithFreedom], new Set([positive.subtypeId]))
  expect(result.invalidCases).toEqual([])
  expect(result.freeWitnessCandidateCaseIds).toEqual([caseWithFreedom.caseId])
})

/** Break guarded: a mathematically valid nonvisual claim is outside this drawing-task corpus. */
it("rejects a case without a required diagram and a candidate visual", () => {
  const nonvisual: GoldCase = { ...positive, caseId: "nonvisual-only", diagram: undefined }
  expect(auditGoldCases([nonvisual], new Set([positive.subtypeId])).invalidCases).toContain(nonvisual.caseId)
})
