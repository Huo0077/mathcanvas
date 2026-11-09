'use strict'
/** Offline, versioned regrade of immutable real-exam records. No provider calls or raw answers in output. */
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { score, scoreFinalChoiceV2 } = require('../real-exam-eval/score.cjs')

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, i) => item === right[i])
}

function regradeRun(summary, lookup) {
  if (!summary || !Array.isArray(summary.results) ||
    (summary.total ?? summary.scoring?.total) !== summary.results.length) {
    throw new Error('summary total/results mismatch')
  }
  if (typeof lookup !== 'function') throw new TypeError('case lookup must be a function')
  const seen = new Set()
  const results = summary.results.map((entry) => {
    const { id, expected } = entry
    if (typeof id !== 'string' || !id || seen.has(id)) throw new Error(`duplicate or invalid case id: ` + id)
    seen.add(id)
    if (!Array.isArray(expected) || expected.length !== 1) throw new Error(`missing reference for ` + id)
    const detail = lookup(id)
    if (!detail) throw new Error(`missing raw case detail: ` + id)
    if (detail.id !== id) throw new Error(`case id mismatch: ` + id)
    if (!sameArray(detail.expected, expected)) throw new Error(`reference mismatch: ` + id)
    if (detail.deliverySuccess !== entry.deliverySuccess) throw new Error(`delivery mismatch: ` + id)
    const legacy = score(detail.answer, expected)
    if (legacy.choice !== entry.score?.choice || legacy.correct !== entry.score?.correct ||
      entry.endToEndCorrect !== (entry.deliverySuccess && legacy.correct)) {
      throw new Error(`legacy baseline mismatch: ` + id)
    }
    const typed = detail.solveResult?.answers?.length === 1 ? detail.solveResult.answers[0].value : undefined
    const v2 = scoreFinalChoiceV2(detail.answer, expected, entry.deliverySuccess, typed)
    return {
      id, visionRequired: entry.visionRequired === true, deliverySuccess: entry.deliverySuccess,
      legacy: { choice: legacy.choice, correct: legacy.correct, deliveredCorrect: entry.endToEndCorrect },
      v2: { choice: v2.choice, status: v2.status, source: v2.source, correct: v2.correct, deliveredCorrect: v2.endToEndCorrect },
      mathReview: { status: 'not_reviewed', reasoning: 'not_reviewed', drawing: 'not_reviewed' }
    }
  })
  const count = (predicate) => results.filter(predicate).length
  return {
    schemaVersion: 'agent-regrade.v1', sourceRevision: summary.revision,
    sourceCreatedAt: summary.createdAt ?? null, evaluationTrack: summary.evaluationTrack ?? null,
    scorers: { legacy: 'legacy-option-v1', v2: 'structured-final-v2' },
    totals: {
      cases: results.length, delivered: count(x => x.deliverySuccess),
      legacyDeliveredCorrect: count(x => x.legacy.deliveredCorrect),
      v2DeliveredCorrect: count(x => x.v2.deliveredCorrect),
      v2RawCorrect: count(x => x.v2.correct),
      v2Ambiguous: count(x => x.v2.status === 'ambiguous'),
      v2Unscored: count(x => x.v2.status === 'unscored'),
      mathReviewed: 0, mathCorrect: null, mathFullAccuracy: null, mathLowerBound: 0
    },
    results
  }
}

function regradeBatch(manifestPath, outPath) {
  if (!outPath || !manifestPath) throw new Error('usage: node regrade.cjs <manifest.json> <output.json>')
  if (fs.existsSync(outPath)) throw new Error('refusing to overwrite existing regrade output')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (!Array.isArray(manifest.runs) || manifest.runs.length === 0) throw new Error('manifest needs runs')
  const names = new Set()
  const runs = manifest.runs.map(run => {
    if (!run || typeof run.name !== 'string' || !run.name || names.has(run.name)) throw new Error('duplicate or missing run name')
    names.add(run.name)
    if (typeof run.summary !== 'string' || !Array.isArray(run.caseDirs) || !run.caseDirs.length) throw new Error('run requires summary and caseDirs')
    const byId = new Map()
    for (const dir of run.caseDirs) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json') || name.endsWith('-requests.json') || name === 'summary.json' || name === 'progress.json' || name === 'interruption.json') continue
        const id = name.slice(0, -5)
        if (byId.has(id)) throw new Error(`duplicate raw case id: ` + id)
        byId.set(id, path.join(dir, name))
      }
    }
    const summaryBytes = fs.readFileSync(run.summary)
    const summary = JSON.parse(summaryBytes.toString('utf8'))
    const caseHash = createHash('sha256')
    const graded = regradeRun(summary, id => {
      const file = byId.get(id)
      if (!file) return null
      const data = fs.readFileSync(file)
      caseHash.update(id + '\0' + data.length + '\0').update(data)
      return JSON.parse(data.toString('utf8'))
    })
    return { name: run.name, ...graded, sourceHashes: {
      summarySha256: createHash('sha256').update(summaryBytes).digest('hex'),
      caseFilesSha256: caseHash.digest('hex')
    } }
  })
  const output = { schemaVersion: 'agent-regrade-batch.v1', createdAt: new Date().toISOString(),
    note: 'Offline regrade only; option match is not proof/drawing correctness; all math review pending', runs }
  // Exclusive creation prevents accidental replacement of earlier scores, even across concurrent CLI invocations.
  const fd = fs.openSync(outPath, 'wx')
  try { fs.writeFileSync(fd, JSON.stringify(output, null, 2) + '\n', 'utf8') }
  finally { fs.closeSync(fd) }
  return output
}

if (require.main === module) {
  try { const output = regradeBatch(process.argv[2], process.argv[3]);
    console.log(JSON.stringify(output.runs.map(({ name, totals }) => ({ name, totals })))) }
  catch (error) { console.error(String(error)); process.exitCode = 1 }
}
module.exports = { regradeRun, regradeBatch }
