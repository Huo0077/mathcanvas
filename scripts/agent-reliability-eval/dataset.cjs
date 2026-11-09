'use strict'
const fs = require('node:fs')

const FAMILIES = ['rectangle-fold', 'conic-eccentricity', 'orthographic-cuboid', 'trig-monotonicity']
/** W10：生产评测用四个互斥分卷；`open-holdout` 是仓库内公开留出集，不是盲测。 */
const PRODUCTION_SPLITS = ['dev', 'holdout-validation', 'holdout-blind', 'anomaly']
const SPLITS = ['dev', 'open-holdout', 'holdout-validation', 'holdout-blind', 'anomaly']
const GOAL_KINDS = ['single_choice', 'multiple_choice', 'numeric', 'interval', 'proof']
const SOURCE_KINDS = ['audit-fixture', 'synthetic-closed-form', 'public-exam']

/**
 * Validate a case list against `dataset.schema.json` (the schema is the documentation;
 * this function is the executable gate used by the offline eval).
 *
 * Open-holdout cases must say `blind: false`: shipping the content in the repository
 * makes a "blind holdout" claim false, and the validator refuses that claim.
 */
function validateDataset(cases) {
  const errors = []
  if (!Array.isArray(cases) || cases.length === 0) return { ok: false, errors: ['dataset must be a non-empty array'] }
  const seen = new Set()
  cases.forEach((item, index) => {
    const at = `[${index}]`
    if (!item || typeof item !== 'object') { errors.push(`${at} is not an object`); return }
    for (const key of ['family', 'split', 'source', 'problemText', 'goals']) {
      if (item[key] === undefined) errors.push(`${at} missing ${key}`)
    }
    // W10：生产清单用 `id`（题号），离线开发集用 `caseId`；两者都接受，但不允许都缺。
    const caseId = typeof item.caseId === 'string' ? item.caseId : typeof item.id === 'string' ? item.id : undefined
    if (caseId === undefined || !/^[A-Za-z0-9._-]+$/.test(caseId)) errors.push(`${at} caseId must match /^[A-Za-z0-9._-]+$/`)
    else {
      if (seen.has(caseId)) errors.push(`${at} duplicate caseId ${caseId}`)
      seen.add(caseId)
    }
    if (!FAMILIES.includes(item.family)) errors.push(`${at} unknown family ${item.family}`)
    if (!SPLITS.includes(item.split)) errors.push(`${at} unknown split ${item.split}`)
    if (item.split === 'open-holdout' && item.blind !== false) errors.push(`${at} open-holdout content is in the repository; blind must be false`)
    if (!item.source || typeof item.source !== 'object') errors.push(`${at} source must be an object`)
    else {
      if (!SOURCE_KINDS.includes(item.source.kind)) errors.push(`${at} unknown source kind ${item.source.kind}`)
      if (typeof item.source.reference !== 'string' || item.source.reference.length < 3) errors.push(`${at} source.reference is required`)
    }
    if (typeof item.problemText !== 'string' || item.problemText.length < 3) errors.push(`${at} problemText is too short`)
    if (!Array.isArray(item.goals) || item.goals.length === 0) { errors.push(`${at} needs at least one goal`); return }
    const goalIds = new Set()
    item.goals.forEach((goal, goalIndex) => {
      const goalAt = `${at}.goals[${goalIndex}]`
      if (!goal || typeof goal !== 'object') { errors.push(`${goalAt} is not an object`); return }
      if (typeof goal.id !== 'string' || goal.id.length === 0) errors.push(`${goalAt} missing id`)
      if (goalIds.has(goal.id)) errors.push(`${goalAt} duplicate goal id ${goal.id}`)
      goalIds.add(goal.id)
      if (!GOAL_KINDS.includes(goal.kind)) errors.push(`${goalAt} unknown kind ${goal.kind}`)
      if (!goal.reference || typeof goal.reference !== 'object') errors.push(`${goalAt} missing reference`)
      else {
        const value = goal.reference.value
        if (typeof value !== 'number' && typeof value !== 'string') errors.push(`${goalAt} reference.value must be number or string`)
        if (typeof value === 'number' && !Number.isFinite(value)) errors.push(`${goalAt} reference.value must be finite`)
        if (goal.reference.tolerance !== undefined && !(typeof goal.reference.tolerance === 'number' && goal.reference.tolerance > 0)) errors.push(`${goalAt} tolerance must be positive`)
      }
    })
  })
  return { ok: errors.length === 0, errors }
}

function loadDataset(path) {
  const text = fs.readFileSync(path, 'utf8')
  const cases = JSON.parse(text)
  return { cases, ...validateDataset(cases) }
}

/**
 * **W10：同一材料跨分卷的冲突**。
 *
 * 同一张图/同一段材料同时出现在 dev 与任何 holdout 里，等于把答案提前给了模型
 * （或把两道"不同"题当成独立样本）。返回逐条冲突，调用方据此拒绝整份清单。
 */
function crossSplitMaterialConflicts(cases) {
  const byMaterial = new Map()
  const conflicts = []
  for (const item of Array.isArray(cases) ? cases : []) {
    const material = item && (item.materialHash ?? item.material ?? item.imageHash)
    if (typeof material !== 'string' || material.length === 0) continue
    const split = item.split
    const previous = byMaterial.get(material)
    if (previous === undefined) { byMaterial.set(material, { split, id: item.id ?? item.caseId }); continue }
    if (previous.split !== split) conflicts.push({ materialHash: material, first: previous, second: { split, id: item.id ?? item.caseId } })
  }
  return conflicts
}

module.exports = { validateDataset, loadDataset, crossSplitMaterialConflicts, FAMILIES, SPLITS, PRODUCTION_SPLITS, GOAL_KINDS, SOURCE_KINDS }
