import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import manifestModule from './manifest.cjs'

const { validateManifest } = manifestModule

/**
 * W10 — offline ladder planner for the production reliability evaluation.
 *
 * This module **never** starts an API call. It validates the frozen manifest and
 * refuses a live run unless all of the following hold:
 *   1. `MATHCANVAS_REAL_EXAM_LIVE=1` (explicit opt-in);
 *   2. `MATHCANVAS_EXPECTED_BUILD` matches the manifest `buildId` (version guard);
 *   3. the manifest passed validation (corpus, splits, freeze, entry track).
 *
 * Paid batches remain a separate, user-authorized decision; the planner only
 * reports what would run and why it cannot.
 */

export const MANIFEST_PATH = path.join('test-fixtures', 'agent-reliability-v2', 'manifest.json')

export const LADDER = [
  { stage: 'offline-regression', cases: 0, note: '不花 API：只跑离线/单元回归' },
  { stage: 'approved-smoke', cases: 10, note: '需单独批准模型与总预算' },
  { stage: 'three-rounds', cases: 50, note: '三轮分别报告，不取最好值' },
  { stage: 'validation', cases: 100, note: '验证集，与盲测不重叠' },
  { stage: 'blind', cases: 500, note: '正式主结果；重复两轮仍只有 500 道不同题' }
]

export function loadManifest(root = process.cwd()) {
  const file = path.join(root, MANIFEST_PATH)
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

export function liveGate(manifest, env = process.env) {
  if (env.MATHCANVAS_REAL_EXAM_LIVE !== '1') return { ok: false, reason: 'offline_only' }
  const expected = env.MATHCANVAS_EXPECTED_BUILD
  if (typeof expected !== 'string' || expected.length === 0) return { ok: false, reason: 'build_identity_missing' }
  if (expected !== manifest.buildId) return { ok: false, reason: 'build_identity_mismatch' }
  return { ok: true, reason: 'live_allowed' }
}

export function planStudio(manifest, env = process.env) {
  const validation = validateManifest(manifest)
  if (!validation.ok) return { status: 'refused', reason: 'manifest_invalid', errors: validation.errors, stages: [] }
  const gate = liveGate(manifest, env)
  return {
    status: gate.ok ? 'live_planned' : 'offline_planned',
    reason: gate.reason,
    entryTrack: manifest.entryTrack,
    corpusHash: manifest.corpusHash,
    stages: LADDER.map((stage) => ({ ...stage, runs: gate.ok ? stage.cases : 0 }))
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = planStudio(loadManifest(), process.env)
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`)
  process.exitCode = plan.status === 'refused' ? 1 : 0
}
