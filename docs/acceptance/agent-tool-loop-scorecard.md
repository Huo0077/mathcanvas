# MathCanvas Agent Tool Loop Scorecard

Date: September 28, 2026. Status: evaluation protocol defined; real-provider evaluation not run.

## Metrics

| Metric | Definition | Failure rule |
|---|---|---|
| pass@1 | One independent run satisfies every acceptance check | A tool receipt, draft creation, or revision increase alone is not success |
| pass@3 | At least one of three independent runs satisfies every check | A single in-run repair is not a third trial |
| Tool error rate | Rejected tool calls / all tool calls | Separate provider errors from geometry refusal |
| Semantic verification rate | Completed claims with complete verification evidence / completed claims | Unknown, not-supported, or missing evidence does not pass |
| Visual verification rate | Visual tasks with same-draft screenshot/layout evidence / visual tasks | Old-draft screenshots and blank canvases do not pass |
| Average latency | Total time to confirmable draft / successful runs | Keep failed-run latency separate |
| Average cost | Provider billable cost / successful runs | Missing billing data is null, never zero |

## Current evidence

`npm run eval:agent` runs the offline evaluator and prints the scorecard (it reuses vitest because this repo has no TS runner; the report lives in `apps/web/src/agent/fixtures/agentEvalReport.ts`).

| Scope | Status | Evidence |
|---|---|---|
| Deterministic code/tests | Measured | 250 Vitest files, 2935 passed, 1 todo; TypeScript, Rust, and Web build passed |
| Offline deterministic pass@1 | Measured **4/8** | `npm run eval:agent`, 2026-09-29 — passes: `create-cube`, `create-tetrahedron`, `reject-degenerate-cube`, `visual-fit-drawn` |
| Offline deterministic pass@3 | Measured **4/8** | same run, 3 independent trials per task |
| Offline tool selection | Measured **45/45** | same run |
| Offline tool error rate | Measured **3/45** | same run |
| Deterministic check coverage | **7 of 8 tasks judged**, 1 unverifiable | Only `visual-fit` remains `not_supported`, because its prompt has no composition verb so the deterministic planner produces nothing to judge. `section-after-solid` and `modify-section` gained judges this round and now honestly report `failed` (the local planner issues no section actions / produces no candidate) |
| Real provider tool selection | **One live run recorded** | 2026-09-29, DeepSeek `deepseek-chat` (`tools` verified): the native channel published **exactly the 5 model-facing tools** (`tools=5` in the transport log) and the model called `plan_set_plan`. Still not a pass@1 measurement |
| Real drawing pass@1/pass@3 | Not measured | One problem was driven end to end (`docs/research/2026-09-28-agent-tool-loop-progress.md`, "Live run against a real provider") and the model's answer was independently correct — but one problem is not a rate, and the scene was not connected |
| Visual/layout evidence | **Local path measured; screenshot path not wired** | `visual-fit-drawn` is judged by `diagnoseLayout` on a candidate document with **no provider vision** (clipping 0, label overlaps 0). `render.capture` / `render.inspect_layout` and live-camera boxes remain unconnected |
| Cost/latency | Not measured | No real-provider billing or end-to-end sample set; the printed latency covers the deterministic local planner only |

## Offline deterministic mode

The repository includes a deterministic local evaluator. Its result mode is `deterministic_local`; it is useful for protocol and geometry regressions but must not be presented as real-model accuracy. The printed report carries that banner on its first line, and the metrics it cannot measure say `not measured` rather than showing a number.

**These 3/7 numbers are a floor for the local deterministic planner, not a model score.** They are the baseline later phases must move; a change here means the planner, the geometry kernel, or the judge changed.

## Release gate

1. Every model-visible tool has strict input validation, a real handler, and a result-return path.
2. A task passes only with semantic evidence; visual tasks also need same-draft visual evidence.
3. pass@1, pass@3, tool error rate, semantic/visual verification, latency, and cost are measured before release.
4. Any regression in confirmation, CAS, cross-document reference, or "success without evidence" blocks release.
