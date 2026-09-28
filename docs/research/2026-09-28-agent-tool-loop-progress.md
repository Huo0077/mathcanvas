# Agent Tool Loop Progress Snapshot

Date: September 28, 2026. Status: paused at a reproducible intermediate checkpoint; the final release gate is not met.

## Completed

- Phase 0: baseline report, seven representative tasks, deterministic task judge, offline evaluator, and scorecard.
- First Phase 1 slice: tool execution identity, verification report, strict action-schema draft, removal of unimplemented tools, read-tool argument validation, and recovery metadata.
- Read-only Phase 2 loop: `AgentRuntime -> Coordinator -> ToolPort -> modelPlanner -> provider tool_call -> Scene Dispatcher -> tool_result -> plan_set_plan -> DraftStore`.
- Provider transport: tested tool schemas and tool-call/tool-result message shapes for OpenAI-compatible, Anthropic, and Ollama protocols.
- Geometry safeguards: cube center/corner semantics, explicit edge length, zero-size rejection, and the one-cube constraint have deterministic tests.
- User trace: tool names are shown in the run trace; before confirmation the live document remains unchanged.

## Not completed

- Incremental draft typed tools: `draft.begin`, `draft.stage`, `draft.preview`, and `draft.verify` are not model-facing.
- Complete schema single source of truth: some action field mappings remain separately maintained.
- General task verification for sections, relations, deletion, and parameterized objects.
- Visual evidence: same-draft `render.capture`, layout checks, and reference comparison are not connected; visual tasks remain `not_supported`.
- Real provider evaluation: pass@1, pass@3, cost, latency, and consistency have not been measured. Offline results are `deterministic_local` and do not represent model accuracy.
- Agent Worker product decision: implement the real worker or explicitly disable the production entry point.

## Verification evidence

- `npm.cmd test -- --run`: 242 test files, 2863 tests passed, 1 todo.
- `npm.cmd run typecheck`: all workspaces, e2e, and scripts passed.
- `npm.cmd run test:rust`: full Rust test suite passed.
- `npm.cmd --workspace @draw/web run build`: Web production build passed.
- Vitest still prints jsdom/Three.js WebGL `getContext` warnings; they do not fail the suite and do not prove real 3D pixel correctness.

## Pause point

The work is paused after the read-only observation loop and deterministic semantic judge. Resume with incremental draft tools and broader task verification. Do not revert to one-shot Plan JSON and do not treat scripted-provider results as real-provider metrics.

Related documents:

- `docs/superpowers/specs/2026-09-28-agent-tool-loop-design.md`
- `docs/superpowers/plans/2026-09-28-agent-tool-loop-implementation-plan.md`
- `docs/research/2026-09-28-agent-tool-loop-baseline.md`
- `docs/acceptance/agent-tool-loop-scorecard.md`
