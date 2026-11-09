'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { summarize, compareRuns, assertUnitIntervals } = require('./report.cjs')

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

/**
 * W10：UI 抽测与服务评测分开报告；任何成功率都必须落在 [0,1]。
 * 把 `ui` 与服务混成一个数字，正是"完整解题率"被夸大的那类错误。
 */
test('reports the ui and core-service entry tracks separately', () => {
  const summary = summarize({ cases: [
    { id: 'a', correct: true, split: 'dev', family: 'g', entryTrack: 'core-service' },
    { id: 'b', correct: false, split: 'dev', family: 'g', entryTrack: 'ui' },
    { id: 'c', correct: true, split: 'dev', family: 'g', entryTrack: 'ui' }
  ] })
  assert.equal(summary.byEntryTrack['core-service'].total, 1)
  assert.equal(summary.byEntryTrack['ui'].total, 2)
  assert.equal(Number(summary.byEntryTrack.ui.fullAccuracy.toFixed(2)), 0.5)
  assert.equal(Number(summary.totals.fullAccuracy.toFixed(2)), 0.67)
})

test('refuses a report whose accuracy is outside [0,1]', () => {
  assert.throws(() => assertUnitIntervals({ totals: { fullAccuracy: 1.5 } }), /within \[0,1\]/)
  assert.throws(() => assertUnitIntervals({ totals: { scoredAccuracy: -0.1 } }), /within \[0,1\]/)
  assert.throws(() => assertUnitIntervals({ totals: { fuzzyAccuracy: 2 } }), /within \[0,1\]/)
  assert.throws(() => assertUnitIntervals({ totals: {}, bySplit: { dev: { fullAccuracy: 1.2 } } }), /within \[0,1\]/)
  assert.equal(assertUnitIntervals({ totals: { fullAccuracy: 0.5, scoredAccuracy: 1, wilson: { low: 0, high: 1, p: 0.5 } } }).totals.fullAccuracy, 0.5)
})
