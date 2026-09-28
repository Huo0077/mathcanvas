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
- The Worker path is still unresolved.

## Gate status

Phase 0: complete.

Phase 1: first slice complete, full single-source schema gate not met.

Phase 2: read-only observation slice complete with scripted providers; incremental draft, semantic verification, and visual evidence remain.
