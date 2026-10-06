export interface SourceUnit {
  unitId: string
  track: "compulsory" | "selective" | "elective"
  category?: "A" | "B" | "C" | "D" | "E"
  sourceSection: string
  pdfPage: number
}

export interface SourceSubtype {
  subtypeId: string
  unitId: string
  sourceSection: string
  pdfPage: number
  title: string
  optionalForExam?: boolean
}

export interface CurriculumSubtype {
  subtypeId: string
  taskKind: "proposition" | "non_propositional" | "unclassified"
  goldCaseIds: string[]
}

export interface CurriculumUnit extends SourceUnit {
  subtypes: CurriculumSubtype[]
}

export interface CurriculumCase {
  caseId: string
  subtypeId: string
  role: "positive" | "negative" | "ambiguous"
  scope: "curriculum" | "contest"
}

export interface CurriculumAudit {
  missingUnits: string[]
  missingSubtypes: string[]
  unclassified: string[]
  missingCases: string[]
  duplicateIds: string[]
  outOfScope: string[]
  invalidSources: string[]
  nonPropositional: string[]
  ready: boolean
}

/**
 * A syllabus index and a proposed catalogue are separate inputs: removing a unit
 * from the working catalogue must not also silently shrink the official denominator.
 * "ready" means that the catalogue has audited examples, NOT that Lean can prove them.
 */
export function auditCoverage(official: readonly SourceUnit[], catalog: readonly CurriculumUnit[], cases: readonly CurriculumCase[], content: readonly SourceSubtype[] = []): CurriculumAudit {
  const missingUnits: string[] = []
  const missingSubtypes: string[] = []
  const unclassified: string[] = []
  const missingCases: string[] = []
  const duplicateIds: string[] = []
  const outOfScope: string[] = []
  const invalidSources: string[] = []
  const nonPropositional: string[] = []
  const officialById = new Map<string, SourceUnit>()
  const contentById = new Map<string, SourceSubtype>()
  for (const entry of content) {
    if (contentById.has(entry.subtypeId)) duplicateIds.push(entry.subtypeId)
    contentById.set(entry.subtypeId, entry)
    if (!official.some((unit) => unit.unitId === entry.unitId) || !Number.isInteger(entry.pdfPage) || entry.pdfPage < 1 || entry.pdfPage > 171 || !entry.sourceSection.trim() || !entry.title.trim()) invalidSources.push(entry.subtypeId)
  }
  for (const unit of official) {
    if (officialById.has(unit.unitId)) duplicateIds.push(unit.unitId)
    officialById.set(unit.unitId, unit)
  }
  const catalogIds = new Set<string>()
  const subtypeIds = new Set<string>()
  const caseIds = new Set<string>()
  const casesById = new Map<string, CurriculumCase>()
  const referencedCaseIds = new Set<string>()

  for (const entry of cases) {
    if (caseIds.has(entry.caseId)) duplicateIds.push(entry.caseId)
    caseIds.add(entry.caseId)
    casesById.set(entry.caseId, entry)
    if (entry.scope !== "curriculum") outOfScope.push(entry.caseId)
  }
  for (const unit of official) {
    if (!catalog.some((entry) => entry.unitId === unit.unitId)) missingUnits.push(unit.unitId)
  }
  for (const unit of catalog) {
    if (catalogIds.has(unit.unitId)) duplicateIds.push(unit.unitId)
    catalogIds.add(unit.unitId)
    const source = officialById.get(unit.unitId)
    if (!source) outOfScope.push(unit.unitId)
    if (!source || !Number.isInteger(unit.pdfPage) || unit.pdfPage < 1 || unit.pdfPage > 171
      || unit.pdfPage !== source.pdfPage || !unit.sourceSection.trim() || unit.sourceSection !== source.sourceSection || unit.track !== source.track || unit.category !== source.category) {
      invalidSources.push(unit.unitId)
    }
    if (unit.subtypes.length === 0) unclassified.push(unit.unitId)
    for (const subtype of unit.subtypes) {
      if (subtypeIds.has(subtype.subtypeId)) duplicateIds.push(subtype.subtypeId)
      subtypeIds.add(subtype.subtypeId)
      if (subtype.taskKind === "unclassified") unclassified.push(subtype.subtypeId)
      const expected = contentById.get(subtype.subtypeId)
      if (content.length > 0 && (!expected || expected.unitId !== unit.unitId)) outOfScope.push(subtype.subtypeId)
      if (subtype.taskKind === "non_propositional") nonPropositional.push(subtype.subtypeId)
      for (const id of subtype.goldCaseIds) referencedCaseIds.add(id)
      for (const role of ["positive", "negative", "ambiguous"] as const) {
        if (!subtype.goldCaseIds.some((id) => {
          const entry = casesById.get(id)
          return entry?.subtypeId === subtype.subtypeId && entry.role === role && entry.scope === "curriculum"
        })) missingCases.push(`${subtype.subtypeId}:${role}`)
      }
    }
  }
  for (const entry of content) {
    if (!subtypeIds.has(entry.subtypeId)) missingSubtypes.push(entry.subtypeId)
  }
  for (const entry of cases) {
    if (entry.scope === "curriculum" && (!subtypeIds.has(entry.subtypeId) || !referencedCaseIds.has(entry.caseId))) outOfScope.push(entry.caseId)
  }
  const ready = official.length > 0 && [missingUnits, missingSubtypes, unclassified, missingCases, duplicateIds, outOfScope, invalidSources].every((issues) => issues.length === 0)
  return { missingUnits, missingSubtypes, unclassified, missingCases, duplicateIds, outOfScope, invalidSources, nonPropositional, ready }
}
