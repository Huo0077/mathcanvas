# MathCanvas Agent Tool Loop Scorecard

> **这张表只列"门槛与能力对照"。** 具体读数与各阶段做到哪一步，**以
> [`docs/current-status.md`](../current-status.md) 为准** —— 它是"现在时"的唯一一处。
> 这里的每一行都是**镜像**：能力前进一格时，这一行要跟着改（第 25 / 33 / 43 轮各漏过一次）。

Updated: 2026-10-10 (S3.4 unblocked; earlier entries through 2026-10-07). **现行任务只覆盖需要画图的高中题。** 旧全课程 H0–H4 的 43/141 来源盘点只供寻找候选；V0 已有四家族 12 条内部文字/坐标候选和 134 未审子型，**四家族的实际作图交付仍未完成**（题设核验与浏览器证据已齐，差教师/学生目视走查）；**真实 provider 作图质量与自动 Lean 均未交付**。原文核验已由 `planHasVerifiableFigure` 一处判断覆盖多面体 / 平面点 / 圆锥曲线 / 函数曲线与切线（V0b–V0d 的 Agent 入口已补），`solid.create_template` 的模板实体**仍刻意不进核验**。既有真实 provider 成本仍 `null`、条件垂直引理不是整题证明；S1/S2 已落地、S4/S5 有分块浏览器证据，**S3.4 题面驱动的棱柱正例已于 2026-10-10 解除**（浏览器用例由 `test.fixme` 转正），S6 未收口；具体门禁读数与发布结论分别看 [当前状态](../current-status.md) / [发布门禁](agent-release-gate.md)，新设计 [V0–V3](../superpowers/specs/2026-10-06-diagram-scope-addendum.md)。

> **2026-10-06 V0a 中途记录**：受限三棱锥草稿与开关正反例已有针对性证据（7 文件/171 定向、单 spec 3/3）；浏览器坐标回代、图形目视与全量回归**已于同日补齐**（见 [当前状态](../current-status.md)），**V0a/V0 仍不计完成**。Lean 未自动调用；provider 成本及大样本读数不变。现时唯一读数/放行状态见 [当前状态](../current-status.md) 与 [发布门禁](agent-release-gate.md)。

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
| Constraint-preserving drag | **experimental; default off, user-openable (N3)** | `e2e/agent-constrained-drag.spec.ts` 已有开/关、过约束拒绝、冲突恢复和一步撤销用例；空间线 `coincident` 缺 3D 判据时触及定义点会 fail-closed，不等于已支持其求解。仍欠真实题集成功率与其它空间判据覆盖；旧“缺恢复路径”不是现况。 |
| Open-ended problem compilation | **offline benchmark + small real-provider samples; not released as general diagram accuracy (N4)** | 21 题契约和离线抽取/见证读数是协议/局部判据；应用内 planning 已由用户运行三轮但每轮只覆盖前 3/21，工具环另有一轮 8×3（pass@1 1/8、pass@3 2/8）。已有两个人工可读性标注，每组 n=1；成本因缺经核对价目表保持 `null`，一例响应 >1 MiB 未测到。**旧“无人读标注/付费运行尚未发生”已过期**；以上也不是现行四类作图题准确率，不满足默认启用门禁。 |
| Formal proof | **one backend wired (N5 `lean4`); two goal classes closed** | proof-artifact schema + `verifyProofArtifact` + a closed short-goal vocabulary + a **backend admission gate** (`WIRED_PROOF_BACKENDS` is *derived* from passed review records, so "no review" cannot be wired in) + `npm run proof:smoke` ⇒ **`PROOF_BACKENDS {"wired":["lean4"],"reviewed":1,…}`**, 8 tests passing. Every first-batch goal has a route: collinear/coplanar via the constraint layer, **pythagorean via an explicit ⊥ + Pythagoras inference step** (modelled as `inference`, deliberately **not** aliased onto ⊥). **Measured (local, standalone, real Lean)**: (1) 2026-10-06 — a *general* `perpendicular` proposition (the **性质定理**: line ⊥ plane ⇒ ⊥ any line in it) reaches `formally_proved` with `axioms [propext, Classical.choice, Quot.sound]` in ~68 s; (2) 2026-10-10 — a second class `linePlanePerpendicular` (renamed from `planePerpendicular` — see below) (the **判定定理**: line ⊥ two *intersecting* lines in a plane ⇒ ⊥ the plane) also reaches `formally_proved` on the same three axioms in **68392 ms**, and its two premises **are literally the two ⊥ from the problem statement** (so this class is closer to premise resolution than class 1 — but the rest of the problem's givens are still *not* premises). In both classes the **same proposition with `sorry` exits 0 but stays `verified_instance`** (same exit code, opposite verdict), and the two classes use **different theorem names**, so one class's `#print axioms` report cannot be passed off as the other's (pinned by a test). **Missing**: only **two** goal classes (curve properties / tangent-derivative / other solid relations still have no template); the IR→Lean translation is itself unproved; `statement` is still optional; **no UI surface for artifacts and no default-path caller**; the mathlib revision is not pinned. **Caveat**: this test **times out at 300 s on a cold page cache** (the first run after a reboot), warm it is ~68–70 s — and it **also times out when run inside the parallel full suite**. Standalone, warm is its yardstick |
| Real provider | **both axes measured (planning n=3; tool loop 8×3)** | **two independent channels, two buttons, two own request counts** (merging them is not allowed — it would make "what did I click, what will it cost" unsayable). (1) the agent-tool-loop panel (设置 → 真实 provider 评测 → agent 工具环) runs the same **8×3 = 24** sweep through `createModelPlanner` → the loopback proxy; (2) the **dataset-planning** panel runs the **21-case benchmark set's first 3 cases × 1 round = 3 requests**, recording `planned` / `clarification` / `rejected` / `error` per case. Both are **two-step and spend money**: each first resolves the active profile and states the request count and target, and only an explicit confirm starts it; **the key never leaves the credential store**. **State of the numbers, split by axis** (2026-10-05 correction — this row used to say "No run has happened yet", which stopped being true): the **planning axis has been run twice** by the user (`planned 2/3`; under the current vocabulary that reads `clarification 1/3` — the model *asked* rather than failing; latency 13445 ms / 8465 ms; **n=3, empty-canvas conditions** ⇒ not "model planning ability", not the whole case set). The **pass@1 axis still has no number, and the reason is not "nobody ran it"**: that channel built its request as `{ userMessage } as never`, which the real `createModelPlanner` rejects **before any request is sent** (`TypeError … reading 'context'`; reproduced with a probe, `runModelCalls=0`), so it had **never worked at all**; it was fixed on 2026-10-05 (`90eba6e`) and **nobody had run it since — until 2026-10-05 later that day, when the user ran it** (`pass@1 1/8`, `pass@3 2/8`, tool selection 45/45, tool error rate 4/45, latency 4126 ms, attempts 24; single model, single sample, 8 cases × 3 rounds). `cost` stays `not measured` on both axes — the repo has no price table. **Missing**: a **price table** (so `cost` can never become a number), and any reading beyond the 3-case subset. **Human readability is no longer missing**: on 2026-10-06 the user annotated the readability of the bodies the third planning run produced — one `plan` case and one `clarification` case, **both judged `unreadable`** ⇒ `readable rate 0.000` in each group; the `rejected` group had **no cases** and honestly reads "unannotated (denominator = 0 annotated, not a score of 0)". **⚠️ That is n=1 per group — not a trend, and not a 21-case conclusion.** Additionally that run exposed a transport bound: one case could not be measured at all and reported `error` because **the model response exceeded 1 MiB** (`the response exceeded 1048576 bytes`, retried to the cap) — fail-closed and honest, but such cases are **not measurable today** |

> **Do not read "partial (N2)" as "the solving gate is passed."** What exists: a bounded, seed-reproducible search that produces a witness only when the same verifier passes it, behind a default-off switch, with a golden pin proving the off path is byte-identical to `4707b64`. What does not: degrees of freedom (always `null`), any real-task success rate, any browser end-to-end of the rescue path, and any product wiring of a solver backend.
>
> **Degrees of freedom, precisely (2026-10-05).** Two different questions now have two different answers, and neither is "done":
> - **Witness layer** (`apps/web`/`agent-core`): still `null`. It needs `ConstraintType` to express line⊥plane and dihedral angles; until then any number would be a partial sum that hides what it left out.
> - **Drag layer** (kernel `constraints3dProjection`): a **real first-order number** — movable axes minus the rank of the constraint Jacobian, computed at the final configuration. First-order only: at a non-smooth point (residuals that take an absolute value) or a degenerate configuration the rank can overstate local stiffness. The two layers share one rank implementation (`linear-algebra.ts`) but deliberately use different "movable" sets (bindings vs. `anchoredPointIds`).
>
> **Do not read "partial (N3)" as "the drag gate is passed", nor "harness + real-provider readings (N4)" as "open-ended understanding works".** N3's missing half is now a **success rate on real tasks** — its product entry and its browser positive/negative cases both exist; N4's missing half is still a **real provider**. See the per-capability notes above.
## Current evidence

### 2026-10-04 geometry-diagram supplement

| Metric | Current reading | Boundary |
| --- | --- | --- |
| Supported static-instance verification | 3319 unit assertions + 186 browser assertions in the current workspace | Fixed/ offline candidates; not real-model accuracy |
| Unknown-condition blocking | Covered by unit, runtime, HostBridge and browser negative paths | Only supported high-precision obligation forms are judged |
| Real-provider geometry pass@1/pass@3 | **Measured: `pass@1 1/8`, `pass@3 2/8`** | One post-fix run on 2026-10-05, **user-run (the controller did not observe it**; internal consistency checked). Until 2026-10-05 the channel's request shape made the real planner throw before any request was sent (`90eba6e` fixed it). **Definition**: `passAt1` = cases whose **first** trial passed; `passAt3` = cases where **any** of 3 trials passed. **Not comparable** to the offline `pass@1 4/8` (deterministic regression on a different subject), and **not** the same axis as the 3-case planning channel |
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
| Cost/latency | **Latency measured on both real-provider axes; cost not measured** | Latency is real wall-clock on every real run (planning 13445 / 8465 / 18153 ms; tool loop 4126 ms), and it stays attached to each recorded reading. `cost` remains `not measured` on **every** axis because the repo has **no price table** — re-running cannot change that. The older note that "the printed latency covers the deterministic local planner only" no longer applies to the real-provider rows |

## Offline deterministic mode

The repository includes a deterministic local evaluator. Its result mode is `deterministic_local`; it is useful for protocol and geometry regressions but must not be presented as real-model accuracy. The printed report carries that banner on its first line, and the metrics it cannot measure say `not measured` rather than showing a number.

**These 3/7 numbers are a floor for the local deterministic planner, not a model score.** They are the baseline later phases must move; a change here means the planner, the geometry kernel, or the judge changed.

## Release gate

1. Every model-visible tool has strict input validation, a real handler, and a result-return path.
2. A task passes only with semantic evidence; visual tasks also need same-draft visual evidence.
3. pass@1, pass@3, tool error rate, semantic/visual verification, latency, and cost are measured before release.
4. Any regression in confirmation, CAS, cross-document reference, or "success without evidence" blocks release.
