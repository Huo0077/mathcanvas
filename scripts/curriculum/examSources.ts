export interface ExamSourceRecord {
  sourceId: string
  examYear: number
  paperId: string
  url: string
  publishedOn: string
  sourceSha256: string
  evidenceKind: "commentary_only" | "full_question_and_answer"
  fullPaperReviewed: boolean
  answerReviewed: boolean
  goldCaseId?: string
  topics: { unitId: string; questionId: string | null }[]
}

/** Authorities reviewed for this source-only batch; extend per verified agency, never by suffix wildcard. */
const REVIEWED_EXAM_HOSTS = new Set(["www.shmeea.edu.cn", "www.moe.gov.cn"])

export interface ExamSourceAudit {
  candidateUnitIds: string[]
  verifiedGoldCaseIds: string[]
  invalidSources: string[]
  duplicateIds: string[]
}

/**
 * Only audits source-level topic mentions. A commentary is not the original paper
 * or answer key; no combination of booleans in this metadata can mint a gold case.
 * An eventual reviewed past-paper pipeline needs independent source/answer evidence.
 */
export function auditExamSources(sources: readonly ExamSourceRecord[], unitIds: ReadonlySet<string>): ExamSourceAudit {
  const candidateUnitIds: string[] = []
  const invalidSources: string[] = []
  const duplicateIds: string[] = []
  const seenSourceIds = new Set<string>()
  const seenUnitIds = new Set<string>()
  for (const source of sources) {
    if (seenSourceIds.has(source.sourceId)) duplicateIds.push(source.sourceId)
    seenSourceIds.add(source.sourceId)
    let url: URL | null = null
    try { url = new URL(source.url) } catch { /* invalid source, not a missing topic */ }
    const valid = source.sourceId.trim().length > 0
      && source.paperId.trim().length > 0
      && Number.isInteger(source.examYear) && source.examYear > 1900
      && /^\d{4}-\d{2}-\d{2}$/.test(source.publishedOn)
      && url?.protocol === "https:"
      && REVIEWED_EXAM_HOSTS.has(url.hostname.toLowerCase())
      && /^[0-9A-F]{64}$/.test(source.sourceSha256)
      && source.evidenceKind === "commentary_only"
      && source.fullPaperReviewed === false && source.answerReviewed === false
      && source.goldCaseId === undefined
      && source.topics.length > 0
      && source.topics.every((topic) => unitIds.has(topic.unitId) && (topic.questionId === null || topic.questionId.trim().length > 0))
    if (!valid) { invalidSources.push(source.sourceId); continue }
    for (const topic of source.topics) {
      if (!seenUnitIds.has(topic.unitId)) candidateUnitIds.push(topic.unitId)
      seenUnitIds.add(topic.unitId)
    }
  }
  // Invariant: commentary metadata cannot independently verify question text or answers.
  return { candidateUnitIds, verifiedGoldCaseIds: [], invalidSources, duplicateIds }
}
