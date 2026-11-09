'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')

const { validateManifest } = require('./manifest.cjs')

/**
 * W10 — the manifest gate must refuse the exact shortcuts that made earlier
 * accuracy numbers untrustworthy. These tests start no API and read no files.
 */

const sha = (letter) => letter.repeat(64)
const base = () => ({
  corpusHash: sha('a'),
  scorerVersion: 'structured-final-v2',
  buildId: 'build-2026-11-09',
  binarySha256: sha('b'),
  revision: 'rev-1',
  profileRevision: '1',
  flagSnapshot: { mathVerificationV1: true, goalTrackingV1: true },
  budgetSnapshot: { requests: 8, inputTokens: 96000 },
  entryTrack: 'core-service',
  cases: [
    { id: 'q1', split: 'dev', family: 'conic-eccentricity', materialHash: sha('1'), question: '求离心率。' },
    { id: 'q2', split: 'holdout-validation', family: 'conic-eccentricity', materialHash: sha('2'), question: '求垂足。' }
  ]
})

test('accepts a well-formed manifest', () => {
  assert.equal(validateManifest(base()).ok, true)
})

test('refuses the same material across dev and holdout', () => {
  const manifest = base()
  manifest.cases[1].materialHash = manifest.cases[0].materialHash
  const result = validateManifest(manifest)
  assert.equal(result.ok, false)
  assert.match(result.errors.join(' '), /cross_split/)
})

test('refuses duplicate question numbers and duplicate material inside one split', () => {
  const duplicateId = base()
  duplicateId.cases[1].id = 'q1'
  assert.match(validateManifest(duplicateId).errors.join(' '), /duplicate question number/)

  const duplicateMaterial = base()
  duplicateMaterial.cases[1].split = 'dev'
  duplicateMaterial.cases[1].materialHash = duplicateMaterial.cases[0].materialHash
  assert.match(validateManifest(duplicateMaterial).errors.join(' '), /duplicate material/)
})

test('refuses an image question without an attachment', () => {
  const manifest = base()
  manifest.cases[0].requiresImage = true
  assert.match(validateManifest(manifest).errors.join(' '), /image_without_attachment/)
})

test('refuses a reference answer leaking into the prompt', () => {
  const manifest = base()
  manifest.cases[0].reference = 'e=√3/2'
  manifest.cases[0].question = '参考答案：e=√3/2，求离心率。'
  assert.match(validateManifest(manifest).errors.join(' '), /reference_in_prompt/)
})

test('refuses a material that changed after the freeze, and a missing frozen case', () => {
  const manifest = base()
  manifest.frozenMaterialHashes = { q1: sha('f'), q2: manifest.cases[1].materialHash }
  assert.match(validateManifest(manifest).errors.join(' '), /material_changed_after_freeze/)

  const missing = base()
  missing.frozenMaterialHashes = { q1: missing.cases[0].materialHash, q2: missing.cases[1].materialHash, q9: sha('e') }
  assert.match(validateManifest(missing).errors.join(' '), /frozen case q9 is missing/)
})

test('refuses an unknown entry track and a missing corpus hash', () => {
  const manifest = base()
  manifest.entryTrack = 'someone-elses-runner'
  delete manifest.corpusHash
  const errors = validateManifest(manifest).errors.join(' ')
  assert.match(errors, /entryTrack/)
  assert.match(errors, /corpusHash/)
})
