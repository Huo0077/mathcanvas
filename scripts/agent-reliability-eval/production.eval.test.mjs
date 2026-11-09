import assert from 'node:assert/strict'
import { test } from 'node:test'

import { liveGate, loadManifest, planStudio } from './production.eval.mjs'

/**
 * W10 — the planner must stay offline unless explicitly authorized and the
 * build identity matches. No API, no provider, no file writes here.
 */

test('defaults to the offline ladder', () => {
  const plan = planStudio(loadManifest(), {})
  assert.equal(plan.status, 'offline_planned')
  assert.equal(plan.reason, 'offline_only')
  assert.equal(plan.stages.every((stage) => stage.runs === 0), true)
})

test('refuses a live run without an expected build id', () => {
  assert.deepEqual(liveGate({ buildId: 'build-1' }, { MATHCANVAS_REAL_EXAM_LIVE: '1' }), { ok: false, reason: 'build_identity_missing' })
})

test('refuses a live run when the build identity does not match the manifest', () => {
  assert.deepEqual(liveGate({ buildId: 'build-1' }, { MATHCANVAS_REAL_EXAM_LIVE: '1', MATHCANVAS_EXPECTED_BUILD: 'build-2' }), { ok: false, reason: 'build_identity_mismatch' })
})

test('allows a live run only when the flag and build id both match', () => {
  const gate = liveGate({ buildId: 'build-1' }, { MATHCANVAS_REAL_EXAM_LIVE: '1', MATHCANVAS_EXPECTED_BUILD: 'build-1' })
  assert.equal(gate.ok, true)
  const plan = planStudio(loadManifest(), { MATHCANVAS_REAL_EXAM_LIVE: '1', MATHCANVAS_EXPECTED_BUILD: 'build-2026-11-09' })
  assert.equal(plan.status, 'live_planned')
  assert.equal(plan.stages.find((stage) => stage.stage === 'blind').runs, 500)
})

test('refuses to plan on an invalid manifest', () => {
  const broken = loadManifest()
  broken.cases[1].materialHash = broken.cases[0].materialHash
  const plan = planStudio(broken, {})
  assert.equal(plan.status, 'refused')
  assert.match(plan.errors.join(' '), /cross_split/)
})
