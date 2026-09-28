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

| Scope | Status | Evidence |
|---|---|---|
| Deterministic code/tests | Measured | 242 Vitest files, 2863 passed, 1 todo; TypeScript, Rust, and Web build passed |
| Real provider tool selection | Not measured | No real provider run has been recorded |
| Real drawing pass@1/pass@3 | Not measured | Requires real model responses and candidate-document verification |
| Visual/layout evidence | Not supported | Same-draft screenshot and layout verifier are not connected |
| Cost/latency | Not measured | No real-provider billing or end-to-end sample set |

## Offline deterministic mode

The repository includes a deterministic local evaluator. Its result mode is `deterministic_local`; it is useful for protocol and geometry regressions but must not be presented as real-model accuracy.

## Release gate

1. Every model-visible tool has strict input validation, a real handler, and a result-return path.
2. A task passes only with semantic evidence; visual tasks also need same-draft visual evidence.
3. pass@1, pass@3, tool error rate, semantic/visual verification, latency, and cost are measured before release.
4. Any regression in confirmation, CAS, cross-document reference, or "success without evidence" blocks release.
