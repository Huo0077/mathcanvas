import { expect, it } from "vitest"

import { auditCoverage, type CurriculumCase, type CurriculumUnit, type SourceUnit, type SourceSubtype } from "./catalog"
import officialIndex from "../../docs/taxonomy/high-school-2025-source-index.json"
import workingCatalog from "../../docs/taxonomy/high-school-2025.json"

const source: SourceUnit[] = [
  { unitId: "required-functions", track: "compulsory", sourceSection: "五（一）主题二", pdfPage: 16 },
  { unitId: "selected-geometry", track: "selective", sourceSection: "五（二）主题二", pdfPage: 38 }
]
const units: CurriculumUnit[] = source.map((entry) => ({ ...entry, subtypes: [] }))

const validCaseRoles: CurriculumCase[] = [
  { caseId: "p", subtypeId: "domain", role: "positive", scope: "curriculum" },
  { caseId: "n", subtypeId: "domain", role: "negative", scope: "curriculum" },
  { caseId: "a", subtypeId: "domain", role: "ambiguous", scope: "curriculum" }
]

/** Break guarded: removing an official unit from the working list must not shrink the denominator. */
it("reports an official unit absent from the editable catalog", () => {
  const result = auditCoverage(source, units.slice(0, 1), [])
  expect(result.missingUnits).toEqual(["selected-geometry"])
  expect(result.ready).toBe(false)
})

/** Break guarded: a row's title alone cannot masquerade as proof-type coverage. */
it("does not count unclassified curriculum units as supported", () => {
  const result = auditCoverage(source, units, [])
  expect(result.unclassified).toEqual(["required-functions", "selected-geometry"])
  expect(result.ready).toBe(false)
})

/** Break guarded: a proposition needs three independent outcome roles, not just a successful example. */
it("reports missing negative and ambiguous cases separately", () => {
  const assigned: CurriculumUnit[] = [
    { ...units[0]!, subtypes: [{ subtypeId: "domain", taskKind: "proposition", goldCaseIds: ["p"] }] },
    units[1]!
  ]
  const result = auditCoverage(source, assigned, validCaseRoles.slice(0, 1))
  expect(result.missingCases).toEqual(["domain:negative", "domain:ambiguous"])
  expect(result.ready).toBe(false)
})

/** Break guarded: open modelling still needs review examples but never a fake theorem. */
it("tracks non-propositional tasks without treating them as formally proved", () => {
  const assigned: CurriculumUnit[] = [
    { ...units[0]!, subtypes: [{ subtypeId: "model-review", taskKind: "non_propositional", goldCaseIds: ["p", "n", "a"] }] },
    { ...units[1]!, subtypes: [{ subtypeId: "domain", taskKind: "proposition", goldCaseIds: ["p2", "n2", "a2"] }] }
  ]
  const cases: CurriculumCase[] = [
    ...validCaseRoles.map((entry) => ({ ...entry, subtypeId: "model-review" })),
    ...validCaseRoles.map((entry) => ({ ...entry, caseId: `${entry.caseId}2` }))
  ]
  const result = auditCoverage(source, assigned, cases)
  expect(result.ready).toBe(true)
  expect(result.nonPropositional).toEqual(["model-review"])
  expect(result).not.toHaveProperty("formallyProved")
})

/** Break guarded: exam/competition examples cannot silently enter the curriculum denominator. */
it("rejects contest examples and detects duplicate unit/subtype identities", () => {
  const assigned: CurriculumUnit[] = [
    { ...units[0]!, subtypes: [{ subtypeId: "domain", taskKind: "proposition", goldCaseIds: ["p"] }] },
    { ...units[0]!, subtypes: [{ subtypeId: "domain", taskKind: "proposition", goldCaseIds: ["p"] }] }
  ]
  const result = auditCoverage(source, assigned, [validCaseRoles[0]!, { caseId: "olympiad", subtypeId: "domain", role: "positive", scope: "contest" }])
  expect(result.duplicateIds).toContain("required-functions")
  expect(result.duplicateIds).toContain("domain")
  expect(result.outOfScope).toEqual(["olympiad"])
  expect(result.ready).toBe(false)
})

/** Break guarded: a blank or fictitious source location is not evidence of syllabus coverage. */
it("rejects missing PDF page metadata", () => {
  const result = auditCoverage(source, [{ ...units[0]!, pdfPage: 0 }, units[1]!], [])
  expect(result.invalidSources).toContain("required-functions")
  expect(result.ready).toBe(false)
})

/** Break guarded: a deleted topic cannot make a still-incomplete course appear complete. */
it("registers 2025 course rows independently and reports every unsplit row honestly", () => {
  const official = officialIndex.expectedUnits as SourceUnit[]
  const editable = workingCatalog.units as CurriculumUnit[]
  expect(official).toHaveLength(43) // read from the 2025 source tables, not the current app capabilities
  expect(official.filter((unit) => unit.track === "compulsory")).toHaveLength(14)
  expect(official.filter((unit) => unit.track === "selective")).toHaveLength(8)
  expect(official.filter((unit) => unit.track === "elective")).toHaveLength(21)
  expect(officialIndex.pdfSha256).toBe("FC9258BB37ED2E052A4B1BE608865A5481F770AE7E28CE536E835D2354353F86")
  const report = auditCoverage(official, editable, [])
  expect(report.missingUnits).toEqual([])
  expect(report.unclassified).toEqual(editable.flatMap((unit) => unit.subtypes.length === 0
    ? [unit.unitId]
    : unit.subtypes.filter((subtype) => subtype.taskKind === "unclassified").map((subtype) => subtype.subtypeId)))
  expect(report.ready).toBe(false)
  expect(workingCatalog.exam.status).toBe("not_measured")
})

/** Break guarded: copying the same PDF row twice must not forge an independent denominator. */
it("rejects a duplicated identifier in the official source index", () => {
  const result = auditCoverage([source[0]!, source[0]!], [units[0]!], [])
  expect(result.duplicateIds).toContain("required-functions")
  expect(result.ready).toBe(false)
})

/** Break guarded: A and B course topics share names but are not interchangeable. */
it("does not silently relabel an elective A row as elective B", () => {
  const original: SourceUnit = { unitId: "elective-calculus", track: "elective", category: "A", sourceSection: "五（三）A类", pdfPage: 53 }
  const result = auditCoverage([original], [{ ...original, category: "B", subtypes: [] }], [])
  expect(result.invalidSources).toContain("elective-calculus")
  expect(result.ready).toBe(false)
})

/** Break guarded: removing a required content item must not shrink the atomic denominator. */
it("reports an official content item omitted from the editable subtype list", () => {
  const officialContent: SourceSubtype[] = [{ subtypeId: "quadratic-range", unitId: "required-functions", sourceSection: "五（一）主题二", pdfPage: 21, title: "二次函数取值范围" }]
  const result = auditCoverage([source[0]!], [units[0]!], [], officialContent)
  expect(result.missingSubtypes).toEqual(["quadratic-range"])
  expect(result.ready).toBe(false)
})

/** Break guarded: a named content heading has not yet been adjudicated as a theorem or open task. */
it("refuses to count an unclassified atomic content item even with example cases", () => {
  const assigned: CurriculumUnit = {
    ...units[0]!, subtypes: [{ subtypeId: "domain", taskKind: "unclassified", goldCaseIds: ["p", "n", "a"] }]
  }
  const result = auditCoverage([source[0]!], [assigned], validCaseRoles)
  expect(result.unclassified).toEqual(["domain"])
  expect(result.ready).toBe(false)
})

/** Break guarded: elective entries alone cannot stand in for compulsory/selective content requirements. */
it("indexes every reviewed compulsory and selective content heading without claiming cases exist", () => {
  const content = officialIndex.expectedSubtypes as SourceSubtype[]
  expect(content).toHaveLength(67) // hand-reviewed content-requirement headings on PDF pages 17–52
  expect(content.filter((entry) => entry.optionalForExam)).toHaveLength(5)
  const report = auditCoverage(officialIndex.expectedUnits as SourceUnit[], workingCatalog.units as CurriculumUnit[], [], content)
  expect(report.missingSubtypes).toEqual([])
  expect(report.ready).toBe(false) // zero gold cases, elective subtypes and exam tags still missing
})
