'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { score } = require('../real-exam-eval/score.cjs')
const { regradeRun, regradeBatch } = require('./regrade.cjs')

function fixture(answer = '最终答案：B', delivered = true) {
  const legacy = score(answer, ['B'])
  return {
    summary: { revision: 'known-revision', evaluationTrack: 'core-runtime-with-native-provider-not-full-UI',
      total: 1, results: [{ id: 'case-1', expected: ['B'], score: legacy, deliverySuccess: delivered, endToEndCorrect: delivered && legacy.correct }] },
    detail: { id: 'case-1', expected: ['B'], answer, deliverySuccess: delivered, solveResult: { answers: [] } }
  }
}

test('same source regraded twice without changing original records or claiming math review', () => {
  const x = fixture('证明结束，选 B')
  const original = JSON.stringify(x)
  const output = regradeRun(x.summary, id => id === x.detail.id ? x.detail : null)
  assert.equal(output.totals.legacyDeliveredCorrect, 0)
  assert.equal(output.totals.v2DeliveredCorrect, 1)
  assert.equal(output.totals.mathReviewed, 0)
  assert.equal(output.totals.mathFullAccuracy, null)
  assert.equal(output.totals.mathLowerBound, 0)
  assert.equal(output.results[0].mathReview.status, 'not_reviewed')
  assert.equal(JSON.stringify(x), original)
  assert.doesNotMatch(JSON.stringify(output), /证明结束/)
})

test('historical audit summary with scoring.total is accepted without rewriting it', () => {
  const x = fixture()
  const { total, ...withoutTotal } = x.summary
  const output = regradeRun({ ...withoutTotal, scoring: { total } }, () => x.detail)
  assert.equal(output.totals.legacyDeliveredCorrect, 1)
  assert.equal(output.totals.cases, 1)
})

test('a right option blocked by delivery is never counted as success', () => {
  const x = fixture('最终答案：B', false)
  const output = regradeRun(x.summary, () => x.detail)
  assert.equal(output.totals.v2RawCorrect, 1)
  assert.equal(output.totals.v2DeliveredCorrect, 0)
})

test('duplicate IDs, missing raw details and a mismatched legacy baseline fail closed', () => {
  const x = fixture()
  assert.throws(() => regradeRun({ ...x.summary, total: 2, results: [x.summary.results[0], x.summary.results[0]] }, () => x.detail), /duplicate/)
  assert.throws(() => regradeRun(x.summary, () => null), /missing.*case-1/i)
  assert.throws(() => regradeRun(x.summary, () => ({ ...x.detail, id: 'wrong' })), /id mismatch/i)
  assert.throws(() => regradeRun({ ...x.summary, results: [{ ...x.summary.results[0], score: { choice: 'A', correct: true } }] }, () => x.detail), /legacy.*mismatch/i)
})

test('CLI only writes a sanitized artifact, never raw answers; refuses overwrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-regrade-'))
  try {
    const old = path.join(dir, 'raw')
    fs.mkdirSync(old)
    const x = fixture('最终答案：B：secret-raw-answer-do-not-upload')
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(x.summary))
    fs.writeFileSync(path.join(old, 'case-1.json'), JSON.stringify(x.detail))
    const manifest = path.join(dir, 'manifest.json')
    const out = path.join(dir, 'sanitized.json')
    fs.writeFileSync(manifest, JSON.stringify({ runs: [{ name: 'old', summary: path.join(dir, 'summary.json'), caseDirs: [old] }] }))
    const batch = regradeBatch(manifest, out)
    assert.equal(batch.runs[0].totals.v2DeliveredCorrect, 1)
    assert.match(batch.runs[0].sourceHashes.summarySha256, /^[0-9a-f]{64}$/)
    assert.match(batch.runs[0].sourceHashes.caseFilesSha256, /^[0-9a-f]{64}$/)
    assert.doesNotMatch(fs.readFileSync(out, 'utf8'), /secret-raw-answer-do-not-upload/)
    assert.throws(() => regradeBatch(manifest, out), /refus.*overwrit/i)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
