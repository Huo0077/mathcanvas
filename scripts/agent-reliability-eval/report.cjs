'use strict'

/** Wilson score interval for a binomial proportion; small samples stay visibly wide. */
function wilson(successes, total, z = 1.96) {
  if (!Number.isFinite(total) || total <= 0) return null
  const p = successes / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))
  return {
    low: Math.max(0, (centre - spread) / denominator),
    high: Math.min(1, (centre + spread) / denominator),
    p
  }
}

function emptyBucket() {
  return {
    total: 0,
    correct: 0,
    wrong: 0,
    unscored: 0,
    scored: 0,
    clarification: 0,
    providerFailed: 0,
    wrongButClaimedVerified: 0,
    calls: 0,
    latencyMs: 0
  }
}

function addTo(bucket, item) {
  bucket.total += 1
  // Historical wrong/unscored buckets stay unchanged; scored is an independent,
  // mutually exclusive predicate so a null clarification cannot be subtracted twice.
  if (item.correct === true) bucket.correct += 1
  else if (item.correct === false) bucket.wrong += 1
  else bucket.unscored += 1
  if ((item.correct === true || item.correct === false) && item.clarification !== true && item.providerFailed !== true) bucket.scored += 1
  if (item.clarification === true) bucket.clarification += 1
  if (item.providerFailed === true) bucket.providerFailed += 1
  if (item.claimedVerified === true && item.correct === false) bucket.wrongButClaimedVerified += 1
  if (Number.isFinite(item.calls)) bucket.calls += item.calls
  if (Number.isFinite(item.latencyMs)) bucket.latencyMs += item.latencyMs
}

function finalize(bucket) {
  // 条件正确率的分母 = 有可评分完整终答的题：澄清、provider 失败、未评分不算"答了但答错"。
  const scored = bucket.scored
  const interval = wilson(bucket.correct, bucket.total)
  return {
    ...bucket,
    // **全量分母包含失败、澄清、超时与未评分**：过滤掉它们再报正确率是另一种不诚实。
    fullAccuracy: bucket.total === 0 ? null : bucket.correct / bucket.total,
    scoredAccuracy: scored === 0 ? null : bucket.correct / scored,
    wilson: interval
  }
}

function validateRun(run) {
  if (!run || !Array.isArray(run.cases)) throw new TypeError('run.cases must be an array')
  const seen = new Set()
  for (const item of run.cases) {
    if (!item || typeof item !== 'object') throw new TypeError('case must be an object')
    if (item.correct !== undefined && item.correct !== null && typeof item.correct !== 'boolean') throw new TypeError('correct must be true, false or null')
    if (item.clarification === true && item.providerFailed === true) throw new Error('provider failure and clarification cannot be the same outcome')
    if (item.correct === true && (item.clarification === true || item.providerFailed === true)) throw new Error('correct answer cannot also be a clarification or provider failure')
    const id = item.caseId ?? item.id
    if (id !== undefined) {
      if (typeof id !== 'string' || id.length === 0) throw new TypeError('case id must be a nonempty string')
      if (seen.has(id)) throw new Error(`duplicate case id: ${id}`)
      seen.add(id)
    }
  }
}

/** W10：报告里的任何"成功率"都必须落在 [0,1]；超过 100% 是代码缺陷，不是好消息。 */
function assertUnitIntervals(report) {
  const check = (value, path) => {
    if (value === undefined || value === null) return
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError(`${path} must be within [0,1], got ${value}`)
  }
  const walk = (bucket, path) => {
    if (bucket === null || typeof bucket !== 'object') return
    for (const [key, value] of Object.entries(bucket)) {
      if (/Accuracy$/.test(key)) check(value, `${path}.${key}`)
    }
    check(bucket.wilson?.low, `${path}.wilson.low`)
    check(bucket.wilson?.high, `${path}.wilson.high`)
    check(bucket.wilson?.p, `${path}.wilson.p`)
  }
  if (!report || typeof report !== 'object') throw new TypeError('report must be an object')
  walk(report.totals, 'totals')
  for (const [key, bucket] of Object.entries(report.bySplit ?? {})) walk(bucket, `bySplit.${key}`)
  for (const [key, bucket] of Object.entries(report.byFamily ?? {})) walk(bucket, `byFamily.${key}`)
  for (const [key, bucket] of Object.entries(report.byEntryTrack ?? {})) walk(bucket, `byEntryTrack.${key}`)
  return report
}

function summarize(run) {
  validateRun(run)
  const totals = emptyBucket()
  const bySplit = {}
  const byFamily = {}
  /** W10：UI 抽测（`ui`）与服务评测（`core-service`）必须分开报告，不能混成一个成功率。 */
  const byEntryTrack = {}
  for (const item of run.cases) {
    addTo(totals, item)
    const split = item.split ?? 'unknown'
    bySplit[split] = bySplit[split] ?? emptyBucket()
    addTo(bySplit[split], item)
    const family = item.family ?? 'unknown'
    byFamily[family] = byFamily[family] ?? emptyBucket()
    addTo(byFamily[family], item)
    const track = item.entryTrack ?? 'unknown'
    byEntryTrack[track] = byEntryTrack[track] ?? emptyBucket()
    addTo(byEntryTrack[track], item)
  }
  const finalizeAll = (buckets) => Object.fromEntries(Object.entries(buckets).map(([key, bucket]) => [key, finalize(bucket)]))
  return assertUnitIntervals({
    runId: run.runId ?? null,
    config: run.config ?? null,
    totals: finalize(totals),
    bySplit: finalizeAll(bySplit),
    byFamily: finalizeAll(byFamily),
    byEntryTrack: finalizeAll(byEntryTrack),
    note: 'One run is one observation; repeated runs of the same cases are not independent samples.'
  })
}

/** Paired difference in full accuracy; deliberately does not print a significance claim. */
function compareRuns(baseline, candidate) {
  const before = summarize(baseline)
  const after = summarize(candidate)
  const delta = before.totals.fullAccuracy === null || after.totals.fullAccuracy === null
    ? null
    : after.totals.fullAccuracy - before.totals.fullAccuracy
  return { baseline: before, candidate: after, delta, note: 'Point estimate only; use the per-run Wilson intervals and the case count before calling this an improvement.' }
}

module.exports = { wilson, summarize, compareRuns, assertUnitIntervals }
