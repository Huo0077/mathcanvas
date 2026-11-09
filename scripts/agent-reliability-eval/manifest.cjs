'use strict'

/**
 * Layer manifest for the production reliability evaluation (W10, 2026-11-09).
 *
 * The manifest is the contract that makes "500-question goal" falsifiable: it
 * freezes the corpus hash, the scorer version, the build/binary identity, the
 * flag snapshot, the budget snapshot, the entry track and the question numbers.
 * It also refuses the three ways the previous rounds cheated:
 *
 * 1. the same material (image/text hash) appearing in both dev and holdout
 *    (`cross_split_material`), or twice at all (`duplicate_material`);
 * 2. a frozen material changing after the freeze (`material_changed_after_freeze`);
 * 3. reference answers leaking into the prompt (`reference_in_prompt`), or an
 *    image question without any attachment (`image_without_attachment`).
 *
 * `validateManifest` is pure: it starts no API, no provider, no file write.
 */

const SPLITS = ['dev', 'holdout-validation', 'holdout-blind', 'anomaly']
const ENTRY_TRACKS = ['core-service', 'ui']
const HASH = /^[a-f0-9]{64}$/i

function validateManifest(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { ok: false, errors: ['manifest must be an object'] }
  for (const key of ['corpusHash', 'scorerVersion', 'buildId', 'binarySha256', 'revision', 'profileRevision', 'flagSnapshot', 'budgetSnapshot', 'entryTrack', 'cases']) {
    if (manifest[key] === undefined) errors.push(`manifest missing ${key}`)
  }
  if (typeof manifest.corpusHash === 'string' && !HASH.test(manifest.corpusHash)) errors.push('corpusHash must be a sha256 hex string')
  if (typeof manifest.binarySha256 === 'string' && manifest.binarySha256.length > 0 && !HASH.test(manifest.binarySha256)) errors.push('binarySha256 must be a sha256 hex string')
  if (!ENTRY_TRACKS.includes(manifest.entryTrack)) errors.push(`entryTrack must be one of ${ENTRY_TRACKS.join(', ')}`)
  if (!manifest.flagSnapshot || typeof manifest.flagSnapshot !== 'object') errors.push('flagSnapshot must be an object')
  if (!manifest.budgetSnapshot || typeof manifest.budgetSnapshot !== 'object') errors.push('budgetSnapshot must be an object')

  const cases = manifest.cases
  if (!Array.isArray(cases) || cases.length === 0) {
    errors.push('cases must be a non-empty array')
    return { ok: false, errors }
  }

  const seenIds = new Map()
  const materialSplit = new Map()
  const frozen = manifest.frozenMaterialHashes && typeof manifest.frozenMaterialHashes === 'object' ? manifest.frozenMaterialHashes : null

  cases.forEach((item, index) => {
    const at = `cases[${index}]`
    if (!item || typeof item !== 'object') { errors.push(`${at} is not an object`); return }
    const id = typeof item.id === 'string' ? item.id : typeof item.caseId === 'string' ? item.caseId : undefined
    if (!id || !/^[A-Za-z0-9._-]+$/.test(id)) errors.push(`${at} needs a question-number id (/^[A-Za-z0-9._-]+$/)`)
    if (id && seenIds.has(id)) errors.push(`duplicate question number ${id} (also at ${seenIds.get(id)})`)
    else if (id) seenIds.set(id, at)

    if (!SPLITS.includes(item.split)) errors.push(`${at} unknown split ${item.split}`)
    if (typeof item.materialHash !== 'string' || !HASH.test(item.materialHash)) errors.push(`${at} materialHash must be a sha256 hex string`)
    if (typeof item.family !== 'string' || item.family.length === 0) errors.push(`${at} needs a family`)

    // 参考/关键步骤只对评分进程可见：题面里出现 reference 就算泄漏。
    const question = typeof item.question === 'string' ? item.question : ''
    if (question.length < 3) errors.push(`${at} question is too short`)
    if (/\breference\b|参考答案|关键步骤/.test(question)) errors.push(`${at} reference_in_prompt`)
    if (item.reference !== undefined && question.includes(String(item.reference))) errors.push(`${at} reference_in_prompt`)
    if (item.referenceVisibleInPrompt === true) errors.push(`${at} reference_in_prompt`)

    if (item.requiresImage === true && !(Array.isArray(item.attachments) && item.attachments.length > 0)) {
      errors.push(`${at} image_without_attachment`)
    }

    // 同一材料不得跨 split，也不得重复出现（同一张图的两个变式必须显式分组）。
    if (typeof item.materialHash === 'string') {
      const key = item.materialHash.toLowerCase()
      const previous = materialSplit.get(key)
      if (previous === undefined) materialSplit.set(key, item.split)
      else if (previous === item.split) errors.push(`duplicate material ${key.slice(0, 12)}… across ${id ?? at}`)
      else errors.push(`cross_split material ${key.slice(0, 12)}… used by both ${previous} and ${item.split}`)
    }

    if (frozen !== null && id && frozen[id] !== undefined && frozen[id].toLowerCase() !== String(item.materialHash).toLowerCase()) {
      errors.push(`${at} material_changed_after_freeze (${id})`)
    }
  })

  if (frozen !== null) {
    for (const id of Object.keys(frozen)) {
      if (!seenIds.has(id)) errors.push(`frozen case ${id} is missing from this corpus`)
    }
  }

  return { ok: errors.length === 0, errors }
}

module.exports = { SPLITS, ENTRY_TRACKS, validateManifest }
