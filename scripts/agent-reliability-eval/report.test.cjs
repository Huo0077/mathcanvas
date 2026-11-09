'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { summarize, compareRuns } = require('./report.cjs')

test('unscored clarification never shrinks the scored denominator twice', () => {
  const totals = summarize({ cases: [
    { id: '1', correct: true }, { id: '2', correct: true },
    { id: '3', correct: true }, { id: '4', correct: null, clarification: true }
  ] }).totals
  assert.equal(totals.total, 4)
  assert.equal(totals.fullAccuracy, .75)
  assert.equal(totals.scoredAccuracy, 1)
  assert.equal(totals.unscored, 1)
})

test('provider failure stays in the full denominator, but not the scored denominator', () => {
  const totals = summarize({ cases: [
    { id: '1', correct: true }, { id: '2', correct: false },
    { id: '3', correct: null, providerFailed: true }
  ] }).totals
  assert.equal(totals.fullAccuracy, 1 / 3)
  assert.equal(totals.scoredAccuracy, .5)
  assert.equal(totals.providerFailed, 1)
})

test('contradictory positive scores and duplicate IDs are rejected before aggregation', () => {
  assert.throws(() => summarize({ cases: [{ correct: true, clarification: true }] }), /clarification/i)
  assert.throws(() => summarize({ cases: [{ correct: true, providerFailed: true }] }), /provider/i)
  assert.throws(() => summarize({ cases: [{ correct: null, providerFailed: true, clarification: true }] }), /provider|clarification/i)
  assert.throws(() => summarize({ cases: [{ id: 'same', correct: true }, { id: 'same', correct: false }] }), /duplicate/i)
  assert.throws(() => summarize({ cases: [{ correct: 'yes' }] }), /correct/i)
})

test('zero denominator is null and buckets sum exactly to full total', () => {
  const empty = summarize({ cases: [] }).totals
  assert.equal(empty.fullAccuracy, null)
  assert.equal(empty.scoredAccuracy, null)
  assert.equal(empty.wilson, null)
  const summary = summarize({ cases: [
    { id: 'a', correct: true, family: 'g', split: 'dev' },
    { id: 'b', correct: false, family: 'g', split: 'dev' },
    { id: 'c', correct: null, family: 'f', split: 'holdout' }
  ] })
  assert.equal(Object.values(summary.byFamily).reduce((sum, b) => sum + b.total, 0), summary.totals.total)
  assert.equal(summary.totals.correct + summary.totals.wrong + summary.totals.unscored, 3)
  assert.equal(compareRuns({ cases: [] }, { cases: [] }).delta, null)
})
