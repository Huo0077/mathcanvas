'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { loadDataset, validateDataset } = require('./dataset.cjs')
const { summarize, compareRuns, wilson } = require('./report.cjs')

const root = path.resolve(__dirname, '../..')
const dev = loadDataset(path.join(root, 'test-fixtures/agent-reliability/development.json'))
const holdout = loadDataset(path.join(root, 'test-fixtures/agent-reliability/holdout.open.json'))

test('development and open-holdout datasets validate', () => {
  assert.equal(dev.ok, true, dev.errors.join('\n'))
  assert.equal(holdout.ok, true, holdout.errors.join('\n'))
  assert.equal(dev.cases.length, 8)
  assert.equal(holdout.cases.length, 12)
})

test('split identity is not mixed', () => {
  assert.equal(dev.cases.every((item) => item.split === 'dev'), true)
  assert.equal(holdout.cases.every((item) => item.split === 'open-holdout' && item.blind === false), true)
})

test('a missing required field is rejected', () => {
  const result = validateDataset([{ caseId: 'x', family: 'rectangle-fold', split: 'dev', problemText: '题', goals: [{ id: 'g1', kind: 'numeric', reference: { value: 1 } }] }])
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /missing source/)
})

test('duplicate case ids are rejected', () => {
  const item = { caseId: 'dup', family: 'rectangle-fold', split: 'dev', source: { kind: 'audit-fixture', reference: 'x' }, problemText: '题干', goals: [{ id: 'g1', kind: 'numeric', reference: { value: 1 } }] }
  const result = validateDataset([item, item])
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /duplicate caseId/)
})

test('an open-holdout case cannot claim to be blind', () => {
  const result = validateDataset([{ caseId: 'open', family: 'rectangle-fold', split: 'open-holdout', blind: true, source: { kind: 'synthetic-closed-form', reference: 'x' }, problemText: '题干', goals: [{ id: 'g1', kind: 'numeric', reference: { value: 1 } }] }])
  assert.equal(result.ok, false)
  assert.match(result.errors.join('\n'), /blind must be false/)
})

test('full accuracy keeps failed, clarification and unscored cases in the denominator', () => {
  const summary = summarize({
    runId: 'run-1',
    cases: [
      { caseId: 'a', split: 'dev', family: 'rectangle-fold', correct: true, calls: 3, latencyMs: 100 },
      { caseId: 'b', split: 'dev', family: 'rectangle-fold', correct: false, claimedVerified: true, calls: 2, latencyMs: 200 },
      { caseId: 'c', split: 'dev', family: 'conic-eccentricity', correct: false, clarification: true, calls: 1, latencyMs: 50 },
      { caseId: 'd', split: 'dev', family: 'conic-eccentricity', correct: false, providerFailed: true, calls: 1, latencyMs: 30 },
      { caseId: 'e', split: 'dev', family: 'orthographic-cuboid', correct: null, calls: 1, latencyMs: 20 }
    ]
  })

  assert.equal(summary.totals.total, 5)
  assert.equal(summary.totals.correct, 1)
  assert.equal(Number(summary.totals.fullAccuracy.toFixed(2)), 0.2)
  assert.equal(Number(summary.totals.scoredAccuracy.toFixed(2)), 0.5)
  assert.equal(summary.totals.clarification, 1)
  assert.equal(summary.totals.providerFailed, 1)
  assert.equal(summary.totals.unscored, 1)
  // 最关键的诚实指标：答错却标"已核验"。
  assert.equal(summary.totals.wrongButClaimedVerified, 1)
  assert.equal(summary.totals.calls, 8)
})

test('Wilson interval is bounded and widens for small samples', () => {
  const one = wilson(1, 1)
  const small = wilson(1, 5)
  assert.equal(one.low >= 0 && one.high <= 1, true)
  assert.equal(small.low >= 0 && small.high <= 1, true)
  assert.equal(one.high - one.low > small.high - small.low, true)
  assert.equal(wilson(0, 0), null)
})

test('comparing runs reports a point estimate, not significance', () => {
  const baseline = { runId: 'base', cases: [{ caseId: 'a', split: 'dev', family: 'rectangle-fold', correct: false }, { caseId: 'b', split: 'dev', family: 'rectangle-fold', correct: true }] }
  const candidate = { runId: 'cand', cases: [{ caseId: 'a', split: 'dev', family: 'rectangle-fold', correct: true }, { caseId: 'b', split: 'dev', family: 'rectangle-fold', correct: true }] }
  const compared = compareRuns(baseline, candidate)
  assert.equal(compared.delta, 0.5)
  assert.match(compared.note, /Point estimate only/)
})
