'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { extractChoice, parseFinalChoiceV2, scoreFinalChoiceV2 } = require('./score.cjs')

test('historical extractor remains unchanged', () => {
  assert.equal(extractChoice('选 B'), null)
  assert.equal(extractChoice('答案：C。最终答案：A'), null)
})

test('v2 recognizes an unambiguous short conclusion', () => {
  assert.deepEqual(parseFinalChoiceV2('证明结束，选 B。'), { choice: 'B', status: 'answered', source: 'conclusion' })
  assert.equal(scoreFinalChoiceV2('证明结束，选 B。', ['B']).correct, true)
})

test('v2 final answer outranks a different intermediate answer', () => {
  assert.deepEqual(parseFinalChoiceV2('中途答案：C，复查后最终答案：A。'), { choice: 'A', status: 'answered', source: 'final' })
})

test('v2 rejects conflicting finals rather than picking the last one', () => {
  assert.deepEqual(parseFinalChoiceV2('最终答案：A。最终答案：C。'), { choice: null, status: 'ambiguous', source: null })
  assert.equal(scoreFinalChoiceV2('最终答案：A。最终答案：C。', ['C']).correct, false)
})

test('v2 uses structured value, but does not hide a conflict with explicit final prose', () => {
  const structured = { kind: 'single_choice', optionId: 'B' }
  assert.deepEqual(parseFinalChoiceV2('推导完整。', structured), { choice: 'B', status: 'answered', source: 'structured' })
  assert.equal(parseFinalChoiceV2('最终答案：A', structured).status, 'ambiguous')
  assert.equal(parseFinalChoiceV2('最终答案：B', structured).choice, 'B')
  assert.equal(parseFinalChoiceV2('最终答案：A', { kind: 'single_choice', optionId: 'Z' }).status, 'ambiguous')
})

test('v2 never guesses a letter from enumerated options, proof text or negation', () => {
  for (const text of ['A.1 B.2 C.3 D.4', '设A、B、C三点，求证……', '不能选 B，仍需补图。']) {
    assert.equal(parseFinalChoiceV2(text).status, 'unscored')
  }
})

test('v2 does not treat a hypothetical option as a completed conclusion', () => {
  assert.equal(parseFinalChoiceV2('若选 B 则有矛盾，所以无法确定答案。').status, 'unscored')
  assert.equal(parseFinalChoiceV2('考虑选 B，但仍需补图才能确定。').status, 'unscored')
})

test('v2 latex boxed final and no-delivery remain distinct', () => {
  assert.equal(parseFinalChoiceV2('最终答案：$\\boxed{B}$').choice, 'B')
  assert.equal(scoreFinalChoiceV2('选 B', ['B'], false).deliverySuccess, false)
  assert.equal(scoreFinalChoiceV2('选 B', ['B'], false).endToEndCorrect, false)
})
