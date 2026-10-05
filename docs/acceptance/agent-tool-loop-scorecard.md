# MathCanvas Agent Tool Loop Scorecard

> **这张表只列"门槛与能力对照"。** 具体读数与各阶段做到哪一步，**以
> [`docs/current-status.md`](../current-status.md) 为准** —— 它是"现在时"的唯一一处。
> 这里的每一行都是**镜像**：能力前进一格时，这一行要跟着改（第 25 / 33 / 43 轮各漏过一次）。

Date: October 4, 2026. Status: geometry-instance verification added; real-provider evaluation still not run. **最后刷新：2026-10-05**（第 43 轮查出四行能力状态过期并改对：`Formal proof` 从"design only"改成"boundary only (N5, no backend)"、N4 从"step 1–2"改成"step 1–7"、拖动那行补上线状平行/垂直、读数行更新为 308 文件 / 3590 通过）。

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

## Deferred-capability scorecard

| Capability | Status | Required evidence before enabling |
| --- | --- | --- |
| General nonlinear solving | **partial (N2, flag default off)** | model/unsat/unknown/timeout/diverged, residuals and reproducible seeds — **present**; **degrees of freedom still `null`**; no success rate on a real task set; not wired into any user path unless the switch is turned on |
| Constraint-preserving drag | **partial (N3, flag default off)** | kernel point projection + drag-layer DOF/redundancy diagnosis + provable contradictions + **line-shaped parallel/perpendicular projection** + the drag decision layer all exist, and the commit is **one transaction** (so single-step undo is free). **Single-step undo is now covered** (`apps/web/src/constrainedDragUndo.test.ts`, against the real store). **Missing**: any browser case, the recovery path, and **any product entry that turns the switch on** — so the browser suite the gate asks for cannot even be written yet |
| Open-ended problem compilation | **harness only (N4 step 1–7)** | dataset schema + validator, credential redaction, run/report contract split by `extraction` / `witness`, a **21-case set (7 categories × 3)**, a **3-rounds-per-case cap**, and `npm run bench:agent`. Three real readings: coverage **14/21**, case-level extraction rate **0.667**, clause-level premise coverage **0.727**. **Solve rate is now measured** (witness layer: `solveRate=0.048`). **Missing**: judgeability, human review, and the **benchmark-side** `real_provider` mode (the *production* adapter exists — `providers/adapter.rs`, with a recorded live run on 2026-09-29) |
| Formal proof | **boundary only (N5, no backend)** | proof-artifact schema + `verifyProofArtifact` + a closed short-goal vocabulary + a **backend admission gate** (`WIRED_PROOF_BACKENDS` is *derived* from passed review records, so "no review" cannot be wired in) + `npm run proof:smoke`. `PROOF_BACKENDS {"wired":[],"reviewed":0}`. **Missing**: any backend at all — so `formally_proved` is unreachable today, the plan's first batch names three goals the parser cannot express (collinear/coplanar/pythagorean), and no artifact has ever reached a UI surface |
| Real provider | not measured | pass@1/pass@3, cost, latency and human readability |

> **Do not read "partial (N2)" as "the solving gate is passed."** What exists: a bounded, seed-reproducible search that produces a witness only when the same verifier passes it, behind a default-off switch, with a golden pin proving the off path is byte-identical to `4707b64`. What does not: degrees of freedom (always `null`), any real-task success rate, any browser end-to-end of the rescue path, and any product wiring of a solver backend.
>
> **Degrees of freedom, precisely (2026-10-05).** Two different questions now have two different answers, and neither is "done":
> - **Witness layer** (`apps/web`/`agent-core`): still `null`. It needs `ConstraintType` to express line⊥plane and dihedral angles; until then any number would be a partial sum that hides what it left out.
> - **Drag layer** (kernel `constraints3dProjection`): a **real first-order number** — movable axes minus the rank of the constraint Jacobian, computed at the final configuration. First-order only: at a non-smooth point (residuals that take an absolute value) or a degenerate configuration the rank can overstate local stiffness. The two layers share one rank implementation (`linear-algebra.ts`) but deliberately use different "movable" sets (bindings vs. `anchoredPointIds`).
>
> **Do not read "partial (N3)" as "the drag gate is passed", nor "harness only (N4)" as "open-ended understanding works".** In both cases the missing half is the half that needs a real user or a real provider — see the per-capability notes above.
## Current evidence

### 2026-10-04 geometry-diagram supplement

| Metric | Current reading | Boundary |
| --- | --- | --- |
| Supported static-instance verification | 3319 unit assertions + 186 browser assertions in the current workspace | Fixed/ offline candidates; not real-model accuracy |
| Unknown-condition blocking | Covered by unit, runtime, HostBridge and browser negative paths | Only supported high-precision obligation forms are judged |
| Real-provider geometry pass@1/pass@3 | Not measured | Requires provider credential and benchmark dataset |
| Witness-search success rate | **Implemented, not measured** | The search exists (N2) and only returns a witness the same verifier passes, but it sits behind a **default-off** switch, is not reachable from any UI/CLI, and has no success rate on a real task set |


`npm run eval:agent` runs the offline evaluator and prints the scorecard (it reuses vitest because this repo has no TS runner; the report lives in `apps/web/src/agent/fixtures/agentEvalReport.ts`).

| Scope | Status | Evidence |
|---|---|---|
| Deterministic code/tests | Measured (2026-10-05) | **308 Vitest files, 3590 passed, 1 todo**; `typecheck` and `lint` exit 0; Rust **238 passed / 3 ignored** in consecutive full runs after serialising the five tests that hit the real credential store (before: 1 red in 5 runs; discriminator: 1/15 parallel vs 0/20 single-threaded; after: **0/100** parallel — 60 then 40 more in a re-check); full e2e **186 passed** in 7 consecutive runs after making `projectWorldPoint` wait for the camera to settle (before: 4 of 6 runs failed the same `data-preview-hovering` assertion). **Both fixes are test-side; product behaviour unchanged.** |
| Offline deterministic pass@1 | Measured **4/8** | `npm run eval:agent`, 2026-09-29 — passes: `create-cube`, `create-tetrahedron`, `reject-degenerate-cube`, `visual-fit-drawn` |
| Offline deterministic pass@3 | Measured **4/8** | same run, 3 independent trials per task |
| Offline tool selection | Measured **45/45** | same run |
| Offline tool error rate | Measured **3/45** | same run |
| Deterministic check coverage | **7 of 8 tasks judged**, 1 unverifiable | Only `visual-fit` remains `not_supported`, because its prompt has no composition verb so the deterministic planner produces nothing to judge. `section-after-solid` and `modify-section` gained judges this round and now honestly report `failed` (the local planner issues no section actions / produces no candidate) |
| Real provider tool selection | **One live run recorded** | 2026-09-29, DeepSeek `deepseek-chat` (`tools` verified): the native channel published **exactly the 5 model-facing tools** (`tools=5` in the transport log) and the model called `plan_set_plan`. Still not a pass@1 measurement |
| Real drawing pass@1/pass@3 | Not measured | Offline geometry-instance/browser evidence is not a real-model rate. One problem was driven end to end (`docs/research/2026-09-28-agent-tool-loop-progress.md`, "Live run against a real provider") and the model's answer was independently correct — but one problem is not a rate, and the scene was not connected |
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
