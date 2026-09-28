# Agent Tool Loop Baseline and Current Status

Date: September 28, 2026.

This document is the Phase 0 baseline plus the current pause snapshot. It is not a claim that the final Agent is complete.

## Baseline facts before the loop work

- The native provider path sent only the final `plan_set_plan` tool.
- The tool registry contained declarations that were not executable by the dispatcher.
- Initial scene observation primarily exposed IDs and labels; detailed facts required a read tool.
- Image input was disabled for model planning and there was no render/layout evidence tool.
- The Agent Worker returned `agent.unavailable` instead of running the coordinator.

## Current implementation snapshot

- Read-only tools now have strict provider schemas and host-side argument validation.
- The Coordinator injects a read-only ToolPort and publishes only tools with an executable host path.
- Native tool calls are bounded by budget, cancellation, duplicate-call, and phase checks.
- Tool results return to the model using provider-native tool history shapes.
- `plan_set_plan` is schema-generated from the currently allowed action IDs; the action registry/schema mapping is not yet completely single-source.
- The live document is still isolated from the draft until user confirmation.
- Explicit cube center/edge constraints are checked against the candidate document.

## What is verified

- Full Vitest: 242 test files, 2863 tests passed, 1 todo.
- Full TypeScript typecheck passed.
- Full Rust test suite passed.
- Web production build passed.
- Scripted end-to-end read loop passed: inspect live scene -> return native tool result -> continue planning -> stage isolated draft -> expose tool trace.

## What is not verified

- No real provider pass@1/pass@3 measurement.
- No cost or latency baseline from real provider runs.
- No screenshot or visual layout verification.
- No incremental draft tools exposed to the model.
- No complete task-level verifier for all representative tasks.
- The Worker path is unresolved. → **resolved 2026-09-29: the Agent Worker entry point is explicitly disabled** (`AGENT_WORKER_READY = false`, decision doc `docs/decisions/2026-09-28-agent-worker-strategy.md`); geometry compilation remains in `geometry.worker`.

## Gate status

Phase 0: complete.

Phase 1: **stage gate met (2026-09-29)** — field shapes have a single source of truth in `actionRegistry`, and "tool catalogue = schema = dispatcher" is enforced in both directions. See the progress snapshot for evidence.

Phase 2: read-only observation slice complete with scripted providers. **Option A chosen (2026-09-29): the draft stays coordinator-mediated, so `ToolPort` remains read-only and the "no writes without confirmation" boundary is untouched.** Two slices are in: the loop's bounds (`toolLoop.ts`) and the `draft.verify` contract (`draftVerify`, verdict taken from `verificationGate`). **Correction (2026-09-29): the multi-round tool loop is not missing — it already exists in `modelPlanner` (bounded calls, duplicate-id rejection, per-continuation budget accounting, explicit tool-result messages).** What genuinely remains: draft-scoped tools cannot be model-reachable while the coordinator stages the draft at the end of its single `planning` phase (a `draft.verify` call during planning has no draft to verify) — that needs a run-state-machine change, not more tool code. **Deferred by decision (2026-09-29): `docs/decisions/2026-09-29-agent-phase2-draft-tools.md`** — the model cannot see the draft at all, so option A would produce a blind verification, and with today's criteria (`has_primitive` only) the model can already answer the same question against the live document. The multi-call defect (one response carrying several tool calls discarded the whole turn) is **fixed**: the permitted batch now executes and continues, with the same call/duplicate/budget bounds.

Phase 3: **six slices landed (2026-09-29) — the chain is complete and live**: user prompt → `deriveAcceptance` (shape existence only, deliberately narrow) → `taskAcceptance` report → `completionGate` → coordinator blocks confirmation with `failed`. **7 of the 8 representative tasks are judged; only `visual-fit` remains `not_supported`.** Remaining: deletion and parameterized-object checks (no judge exists, so nothing is derived for them).

Phase 5: **decided (2026-09-29)** — the Agent Worker entry point is explicitly disabled rather than implemented; see `docs/decisions/2026-09-28-agent-worker-strategy.md`. Phase 5 Task 5.2 ("unify the main-thread and Worker capability boundary") has no second path to unify while the entry is disabled.

Phase 4: **local layout path landed and reachable (2026-09-29)** — `verification/layoutModel.ts` projects a candidate document to boxes and `diagnoseLayout` judges clipping / label overlap / empty canvas with no provider vision; the judge and the offline evaluator use it, which moved offline pass@1 to **4/8** and made `visual-fit-drawn` genuinely verifiable. Still missing: `render.capture` / `render.inspect_layout` dispatcher handlers, screenshots, live-camera boxes, and provider vision.

Phase 6: **three slices landed (2026-09-29)** — `npm run eval:agent` prints the scorecard; the run ledger records the four revisions on **every** event plus a bounded `ToolCallTrace` per tool call (Task 6.1); and those revisions are now **persisted** through `runEventClient` → Rust `RunEventVersions` (the three new Rust fields are `#[serde(default)]` so pre-existing rows still deserialize). Remaining: real-provider pass@1/pass@3/cost/latency (**needs a provider**), and Task 6.3's release gate — which now **exists** (`docs/acceptance/agent-release-gate.md` + `agentReleaseGate.test.ts`, and `npm run eval:agent` runs in CI's `checks` job). The gate's verdict is **not met**: its line 2 (pass@1 / semantic-verification thresholds) has **no real-provider data**, and line 5 is partial (`render.capture` not wired). So the plan's final stage gate — "only when all gates pass may the typed tool loop become the default" — is **not** satisfied. Tool traces are now **persisted too** — an optional `trace` on `RunEventInput` (both sides, `#[serde(default)]`, `deny_unknown_fields`), one row per call in the existing `run_events` table (`${runId}:trace:${toolCallId}`, so no new table or migration), with both summaries passing the same `redact` as `detail`. **Stated limitation:** traces are written after the run (because `toolTraces()` is only complete then) while events stream during it, so a crashed run keeps its events and loses its traces.
