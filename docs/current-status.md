# MathCanvas 当前状态

## 2026-10-19 泛化问题任务表

- 新增 [几何 Agent 泛化问题任务表](agent-generalization-task-list-20261019.md)：6 个 Part、24 项任务，逐项带优先级、状态与验收口径；任务表落档后先做 P1-3、P5-1。
- P1-3 进展：新增 `rescueWithStructuralRepairs`，同一轮清洗“线段顺序 + 非法折角（0° → 安全默认 90°，可覆盖）”，再走折角反求与题设核验；两条回归在 `planCompiler.witnessFold.test.ts`，提交 `16ca1cc`。
- P5-1 进展：新增 `normalizeGeometryPrompt`（LaTeX 命令与 OCR 错字 → 解析器可读文本），接入 `parseObligationWithLegacy` / `parseObligationIR` 与 `planCompiler` 的解析/关系核验；11 道 HighMATH 原始 LaTeX 的 given **0→29**、unverified **26→13**，8/11 能读出条件；`latexNormalisation.test.ts` 4 条 + 原始 LaTeX 端到端 1 条通过。
- P1-2 进展：`readScopedReference` 接受裸字符串并补成 `{scope:"draft",alias}`；对象缺 scope 仍拒绝；`schemas.test.ts` 与 `planCompiler.bareAlias.test.ts` 覆盖解析到绑定。
- P0 三件套：模型/通道（P1-4/P1-5）、计划清洗与救援组合（P1-2/P1-3）、LaTeX/OCR 归一化（P5-1）。
- 已完成项以 `97dde4b`、`16ca1cc`、`b4cf68e` 及 P1-2 提交为准；门禁：412 文件 / 4774 通过 + 1 todo，typecheck 0，lint 0 error / 15 warning。

## 2026-10-17 真实 provider 画图评测（12 道）

- 详见 [评测记录](agent-drawing-eval-20261017.md)：12 道公开高中题 + 用户翻折题，配置默认模型实际路由到 `deepseek-flash`；flash 生成 5/12、v4-pro 生成 7/12，**题设全过都是 0/12**。失败主因是模型坐标/动作契约与“一次多缺陷”，不是图形原语不足。
- 评测驱动的代码：`segment_reference_missing` 线段自动后移（含剪角）、`unscoped_reference` 的 scoped 修复提示、`Ctrl+A` 全选（便于整图删除）；单面 `solid.create_polyhedron`、3D 里 `planar.*` 提升、开放图形提示与折角剪裁均已落地。
- 门禁：全量 **410 文件 / 4765 通过 + 1 todo**，typecheck exit 0，lint **0 error / 15 warning**。
- 已知：LaTeX/OCR 归一化未进主路径；绑定点删除语义仍会挡住单张面删除（用 `Ctrl+A` 全选后删除）；桌面端尚未重建。

<!-- functional-checkpoint-20261016-ci -->
## 2026-10-16 功能审查与 CI 状态同步

本节为当前口径；下文较早日期的完成声明与测试数量仅为历史快照，不覆盖本节。功能基线提交为 `7efd0ce3b078f652d5c4a7e046a74225a2f36f7e`。

| 当前判定 | 数量 | Task |
| --- | ---: | --- |
| 已在声明的支持范围内完成功能验收 | 16 | 1–15、17 |
| 部分完成 | 3 | 16、18、19 |
| 未整体完成／未发行验收 | 2 | 20、21 |

- **已落地**：独立条件核验、有界翻折、面上点与受限展开、函数公切线；证明迟到/失效与输入绑定；跨工作区自动保存和重启恢复；候选证据运行身份与椭圆/双曲线/抛物线/球体范围门禁；产品协调流程中的评测请求额度及缺失人评拒绝门禁。
- **最新已提交的本地验证**：单元测试 404 文件 / 4741 passed / 1 todo；当前源码重新构建后的浏览器测试 239 passed；typecheck exit 0；lint 0 errors / 13 既有 warnings。证据为 `audit-20261016/task16-analytic-final-{unit,e2e,typecheck,lint}.txt/.exit`。这些是本地结果，不等于 GitHub CI 全绿。
- **GitHub CI 失败与修复记录**：运行 `38994176178` 中 build、rust、e2e 成功，checks 在 Vitest 失败，后续性能与评测步骤被跳过。已查实提交中的六份 `task16-analytic-final-{e2e,lint,typecheck,unit}.txt`、`task16-analytic-invalid-{green,red}.txt` 是 UTF-16 LE（`FF FE`），违反仓库受跟踪文本必须为 UTF-8 的卫生判据。后续提交 `1add886dfa13cd28ae7f346f332862586fbcaac1` 已将六份日志转换为 UTF-8；其远端运行 `38995619547` 已 completed / success。保留原失败历史；本次文档更新不修改产品或日志，新的文档提交仍需单独观察 CI。
- **暂停前的未提交工程复验**：本地 Rust 263 passed / 4 ignored，独立配置桌面构建 exit 0。原生椭圆待确认状态有记录，但新一轮桌面确认/退出/重启验收未闭环，期间进程退出原因未确认；仅保留本地证据，不作为已上传或完整验收结果。独立测试副本已关闭，其他功能开发暂停。
- **剩余验收**：Task 16 缺确认前真实候选 DOM/截图、完整 WebGL 对象测量与视觉人评；Task 18/19 缺标准打包/干净环境证明验收、OS 强沙箱与离线分发；Task 20 缺冻结 12×3 独立 gold 真实模型质量、人评及真实美元止损；Task 21 缺干净机器/断网发行和教师/学生签收。已有真实 provider 小样本不达标，不能替代冻结题集验收。
- **边界**：普通作图、受限自动 Lean、真实模型质量和最终发行分别验收；`structured_only` 不是实际候选截图，受限引理不是整题证明。Goal 保持未完成，本次文档更新不提高任何 Task 的完成状态。
<!-- /functional-checkpoint-20261016-ci -->

## 2026-10-16 Task 20 coordinator-driven evaluation engineering

- **Product path, not a parallel repair simulation:** the shell-triggered exam run now selects `repairPath: coordinator-driven` and uses the real `createAgentRuntime`, coordinator, observer, tools, staging and geometry compiler. The historical adapter still defaults to `not-driven` for compatibility. Each case starts with isolated empty workspace documents; it never grants commit consent, rejects document writes, and discards the preview afterward. Experimental compile flags are explicit; user preferences and automatic Lean are not enabled implicitly.
- **Functional repair and truthful verdicts:** regressions exercise schema repair, real compile-diagnostic repair, cross-workspace staging, answer/clarification, native read-tool continuation, and retry paths. Missing facts cannot become `planned`; schema/compile/verification failures remain distinct. A successful compile must also pass diagram verification and reach the real `awaiting_confirmation` phase. Cost callbacks receive every planner attempt, not just the final repaired plan.
- **Authorization is unchanged:** coordinator repairs, transport retries and native read-tool continuations share the outer request cap without charging a reserved transport twice. The frozen authorization remains **36 actual provider requests / $12 declared maximum**; it is not expanded to make a 36-logical-trial report look complete. When one repair consumes one of those 36 requests, the remaining logical trial is denied and evaluation does not pass. Without a price table, `costUsd` stays `null`; this is not a demonstrated real-time dollar stop-loss.
- **RED to GREEN and current checks:** the initial coordinator suite reproduced **4 failed / 2 passed**; the shell suite reproduced **2 failed / 2 passed** before enabling this path. Final focused tests: **4 files / 56 passed**; fresh precommit run including four documentation-consistency suites: **8 files / 68 passed**, exit 0 (`task20-precommit.txt/.exit`); full unit suite: **404 files / 4710 passed / 1 todo**, exit 0. Typecheck exit 0; lint **0 errors / 13 pre-existing warnings**. All-workspace production build, including the desktop executable, exited 0 on the final unlocked rerun.
- **Build evidence correction:** `task20-build.txt/.exit` actually records exit **1**, caused by the isolated audit executable holding the release file open. It is retained as a failure, not cited as passing. After verifying the executable path and audit PID, only audit process 55192 was stopped; the user's original process 7920 was untouched. `task20-build-unlocked.txt/.exit` records the subsequent exit 0. Existing Vite size/dynamic-import and linker warnings are retained.
- **Independent review:** a bounded read-only review of the eight source/test files against `6b10196468b7631e0f88713c0718ee552970e5b8` found no remaining Critical/Important issue. The reviewer inspected behavior/call paths but did not independently rerun the checks; see `audit-20261016/task20-coordinator-review.md`.
- **Evidence:** `audit-20261016/task20-{coordinator-red,shell-red,focused,full-unit,typecheck-final,lint-final,build,build-unlocked}.txt/.exit`; permanent tests are `examRunCoordinated.test.ts` (15), `examRunCli.test.ts` (4), plus existing adapter/runtime suites (7/30).
- **Acceptance boundary:** these are synthetic provider-response engineering smokes through the real product coordinator, **not** a new real-provider quality run or frozen 12 x 3 gold evaluation. `verifiedGoldCaseIds=[]`, human readability and dollar cost remain unmeasured. The previous installed-product real-provider failures remain valid historical measurements; `bench:agent --mode=real_provider` is still `not_measured`. **Task 20 remains not complete as a whole; the matrix stays 16 complete / 3 partial / 2 not complete or not release-accepted.** Task 16 visual/human gates, Task 18/19 installed real-Lean lifecycle/distribution, and Task 21 clean/offline/teacher/student acceptance are not passed by this block.

## 2026-10-16 Task 21 inactive-workspace restart recovery

- **Closed the previously reproduced functional defect:** after restart, first visiting an inactive workspace now restores its own repository document, with its browser draft only as fallback. Empty repository documents remain authoritative. Hydration is read-only and does not save an empty placeholder over an existing drawing.
- **Race protection:** a late response cannot overwrite edits, imported documents, or another workspace. An edit made while recovery is pending is saved even if the user navigates away before recovery finishes; revisiting an already hydrated workspace keeps the current in-memory drawing.
- **Independent review correction:** startup still used the global latest document if its remembered id was missing or belonged to another workspace. Two regression cases failed before the correction (2 failed / 26 passed). Startup now shares the workspace-filtered lookup with lazy hydration; this fixes both missing-id and wrong-workspace-id paths rather than merely rejecting the result in the UI.
- **Fresh verification:** four focused suites **64 tests passed**; Rust SQLite repository suite **27 passed**; typecheck exit 0; lint **0 errors / 13 pre-existing warnings**. Current-source browser E2E **1 passed**, creating planar/spatial drawings through the UI, reloading twice, then exporting real in-memory documents to verify ids and objects (not just reading browser storage). Isolated native release build exited 0.
- **Actual native restart check:** using only `com.mathcanvas.audit.task18`, prepared two points in each of conics/geometry3d. Across two real process restarts, each workspace was verified both as startup-active and as initially inactive: all four UI checks showed the correct workspace and two objects. Read-only SQLite before/after inspection confirmed all document ids, generations, and object ids were unchanged by hydration. This is an isolated binary, not standard installer/clean-machine/offline release acceptance.
- **Environment/evidence hygiene:** the audit WebView profile downloaded third-party JavaScript, causing an initial lint failure outside product source. Stopped only the audit process and moved that existing profile outside the repository; fresh lint then returned 0 errors. The user's original app was not stopped or changed. Installed the matching Playwright browser runtime only (no package manifest/lock changes). New evidence and prior autosave text evidence are normalized to UTF-8 without BOM/trailing whitespace; no test result is rewritten.
- **Evidence:** `audit-20261016/task21-workspace-restore-{red,rust-red,hook-red,navigation-red,startup-red,green,rust-green,typecheck,lint,e2e,native-build}.txt/.exit`, `task21-workspace-restore-native-{planar-before,spatial-before,planar-after,spatial-after,planar-second-restart,spatial-second-restart}.txt`, and `task21-workspace-restore-native-db-{before,after}.json`. Permanent regressions are in `useDraftPersistence.test.tsx`, `documentPersistence.test.ts`, `documentRepository.test.ts`, `project_repository.rs`, and `e2e/workspace-persistence.spec.ts`.
- **Fresh full-unit gate:** 402 files passed; 4687 tests passed / 1 todo (4688 total), exit 0. Four progress-document consistency suites: 12 tests passed. Evidence: `task21-full-unit-restore.txt/.exit` and `task21-workspace-restore-docs-check.txt/.exit`. Existing runtime/React/canvas warnings are retained in the log, not hidden.
- **Second independent-review correction:** a foreign remembered id with no existing document in the requested workspace could still be reused during creation, then overwritten by autosave/import. Four regressions first failed (4 failed / 28 passed). Recovery now allocates a new id for that collision, and both cold/cached autosave heads and import/reset reject a different-workspace owner. Missing-but-unowned remembered ids remain stable. Focused suites now **4 files / 68 passed**, current typecheck exit 0, lint 0 errors / 13 warnings, browser E2E 1 passed, isolated native build exit 0. Native retest checked both workspaces after two launches (2 objects each), with unchanged repository ids/generations/object ids. The reviewer reports no remaining reproducible Critical/Important in this repair.
- **Final current-source unit gate:** **402 files / 4691 passed / 1 todo**, exit 0. An intervening full run failed only the two file-hygiene assertions because PowerShell was rewriting an already-staged evidence log as UTF-16 during the test itself; that failure is preserved, the original successful log is restored from the index, and the final rerun writes a distinct untracked capture before UTF-8 normalization. No product test was skipped. A test-fixture `ok` boolean inference also caused one typecheck failure; the fixture now preserves its literal type and fresh typecheck is 0.
- **Latest evidence:** `task21-workspace-restore-identity-{red,green,typecheck,lint,e2e,native-build}.txt/.exit`, `task21-workspace-restore-identity-native-{planar,spatial,planar-restart,spatial-restart}.txt`, `task21-workspace-restore-identity-native-db.json`, `task21-workspace-restore-review.md`, and `task21-full-unit-{identity,identity-hygiene-failure}.txt`. Earlier 64-test/4687-test records above are intermediate runs, not the final baseline.
- **Matrix remains 16 complete / 3 partial / 2 not complete or not release-accepted.** This completes the identified restart recovery repair, not Task 21's remaining human acceptance, clean/offline distribution, or all 21 tasks.



## 2026-10-16 Task 21 cross-workspace native autosave repair

- **Independent review caught two additional real races:** a different-content `stale_head` was accidentally adopted for a queued overwrite; resetting B invalidated A's queued final edit. Both now have permanent regressions observed RED (2 failed / 22 passed), then GREEN (**3 files / 43 passed**). Different-content conflicts keep the previous CAS baseline; reset eras and queues are scoped to the target document. Updated typecheck/lint exit 0. Revised isolated native build initially hit the running audit executable lock (exit 1); after stopping only that audit process, rebuilt successfully (exit 0). Native recheck can edit both workspaces without a save-failure warning; it does not close the inactive restart defect below.
- **Review evidence:** `task21-persistence-review-{red,green,typecheck,lint,desktop-build,desktop-build-retry}.txt/.exit`, `task21-persistence-native-reviewed.txt`, and `task21-persistence-review.md`.

- **Real defect:** native desktop switching from the restored document to a new geometry3d document used the old document's CAS head, then failed with `no document ... in project local`. The persistence adapter now maintains a head per document, reads/creates the correct target, and serializes rapid saves per document. Known heads retain CAS conflict detection; different workspaces do not block one another.
- **Additional race reproduced:** an edit during an import could be acknowledged before the imported epoch replaced it. A regression failed with only the imported point surviving. New-era saves now wait for that import, while reset can bypass a stuck previous-era save; superseded success/failure responses cannot replace the new head.
- **Executable verification:** initial workspace/rapid-save regression: 2 failed / 17 passed; import-race regression: 1 failed / 21 passed. After the repair, persistence/repository/hook suites: **3 files / 41 tests passed**; workspace typecheck and changed-file lint: exit 0; isolated-identity native desktop release build: exit 0.
- **Native UI + SQLite verification:** using only the audit identity, added a 3D point, switched to planar geometry and added two points, returned to 3D and added a second point. No save-failure message; read-only SQLite inspection confirms separate geometry3d and conics documents with two objects each and semantic content matching their stored hashes. Restarting the same audit app restored the active 3D document with both points. This is current-source isolated binary evidence, not standard installer/clean-machine acceptance.
- **Next real defect exposed, not hidden:** after that restart, switching to the inactive planar workspace shows zero objects although its two-point document remains in SQLite. The startup hook restores only the active workspace; inactive-workspace restoration is a separate pending repair. Therefore this block closes the save-head/rapid-save/import-race defect only, not full workspace persistence or Task 21.
- **Evidence:** `audit-20261016/task21-persistence-{red,reset-red,green,typecheck,lint,desktop-build}.txt/.exit`, `task21-persistence-native-{start,solid,conics,solid2,restarted,restarted-conics}.txt`, and `task21-persistence-native-database.json`.
- **Task matrix unchanged:** 16 complete / 3 partial / 2 not complete or not release-accepted. Ordinary drawing, bounded automatic Lean, and distribution/human acceptance remain separate.



## 2026-10-16 Task 18 live proof freshness and native desktop lifecycle

- **Functional defect reproduced and fixed:** after a real desktop Lean acceptance, confirming 19 objects and undoing to zero previously left the transcript saying the restricted lemma was proved for the current canvas. Proof messages now retain their historical backend result but derive freshness from the pinned base/candidate document identity and semantic content hash. Undo, edits, document replacement, and legacy messages without a binding fail closed as stale; redo of exactly the bound content restores the historical display without claiming a new Lean run. Backend version and proposition input hash are visible.
- **Real Windows desktop evidence:** a release binary built from the current source with the isolated `com.mathcanvas.audit.task18` identity (not the standard installer) and no configured provider ran the local planner through the actual Rust/Lean child process. The native UI reported `Lean 4.35.0-rc3` and proposition hash `70d0cdd3851789e4ac8c02abdb5d94c36ee1a42b37b5a6b08c89a5dba4e3b037`, restricted-lemma acceptance, confirm -> 19 objects, undo -> 0 objects, and then stale in the transcript. The theorem remains a restricted lemma, not a proof of the whole question.
- **Verification:** initial production-wiring regression tests failed before the fix; four focused suites / 88 tests then passed, typecheck and changed-file lint exited 0, browser proof lifecycle 2/2 passed, and the isolated release build exited 0. Native UI captures are `audit-20261016/task18-native-fixed-{settings,flag,during,result,confirmed,undo,stale}.txt` and `task18-native-fixed-processes.json`; automated evidence is `task18-live-proof-{red,green,typecheck,lint,browser,desktop-build}.txt/.exit`.
- **Separate release blocker found:** the real desktop still reports a local-project save failure (`no document ... in project local`) after changing workspace. This is not hidden by the proof success and will be handled as a separate persistence block.
- **Boundary:** Task 18's configured native proof/confirm/undo/freshness path is evidenced. Task 18 remains partial pending standard packaged/clean-machine release acceptance. Task 19 remains partial (no OS sandbox or packaged release evidence). Overall adjudication remains **16 complete / 3 partial / 2 not complete or not release-accepted**; no human gold or teacher/student acceptance has been fabricated.
- **Evidence hygiene:** existing tracked BOM/UTF-16 evidence and two BOM-prefixed test files were normalized to UTF-8 without BOM, without relaxing the repository's hygiene gate or changing test semantics.


> **2026-10-15 现场（同一道题第四次读数）：这轮**先复现、再改**（没有猜）。** 读数里有两处**我们的修法当场生效**的证据：① 上几轮加的诊断打出了 `plan_set_plan 的参数是一段字符串，但**按 JSON 解析失败**（Unexpected non-whitespace character after JSON at position 2249 …）` —— 那次模型把计划写成了"合法 JSON + 后面又跟了东西"，而**旧文案只会说"got a string"**（分不清"解不了"和"没试过"）；② 失败本身是"**题面点到、图上却没有**"那一族。**离线复现（一条临时探针，用完即删）**：喂一份"面片**不带 `vertexNames`**"的计划 + 这道题的原话 ⇒ 引擎的读数是"这一笔面片**没有带点名**（`vertexNames`）：图上的顶点只有模板编号…"，八条题设条条未核验 ⇒ 门禁拦下（`verification is incomplete` ✓ 如实）。**但关键的一处缺口也照出来了**：这类结果的 `compilePlan` 是 **`ok = true`**（草稿建出来了，只是核验不完整）⇒ **没有 `RepairRequest`** ⇒ 协调器那条**刻意**的判据（注释写着"门禁拿不到'允许改哪几处'…没有请求的重试只是一次盲目的重复"）让它**直接落到 `failed`** ⇒ **模型从头到尾没被告知它漏了点名**（那句诊断只在开发者视图里）。**本轮做的（小、但直击"误导"）**：用户看到的那句"系统只补建…这一点没能补上"**会把人引到"系统能力到此为止"**，而真因在**计划**里。现在这句话把**该往哪改**说出来：**建图那一笔必须给 `vertexNames`（题面点到的顶点按 `vertices` 下标给全），或者先用 `dynamic.create_bound_point` 把点单独建出来 —— 重新让模型出一版计划即可**。**RED 先看到且逐字复现现场**（抽掉 `agentRunner.ts` 那处改动时，失败信息正是"题设还没核验，本次不会提交。AB=8：点名缺失：A、B … 这一点没能补上"，与用户贴的那条同形）。**仍然没做、且我认为该做的一件（下一轮）**：给这类"**计划侧漏点名**"**一个修复轮**（`planCompiler` 在 `ok` 路径上附 `RepairRequest` + 协调器允许它），让模型自己修，而不是把球踢回用户；之所以要先复现再动，是因为**判据必须窄** —— 有些"点名缺失"是**引擎**的读取器缺口（例如折前名字那种），那种让模型去修只会白烧一轮。

> **2026-10-15 用户裁决并落地两件：① 技能说明里写清这类题的**计划骨架与顺序**；② 预算**适当调高（6 → 8）**。** **① 技能骨架**（`spatial-modeling.summary`，模型每轮都读它）：现场反复出现的两个**结构**错是"拿 `solid.create_polyhedron` 去套**平面四边形**"（"开放图形不要拼闭合体"这条提示它已经忽略**四次**）与"把**连线段排在建点之前**"。现在 summary 里明写这段题型的骨架：**① `solid.create_face` 建折前平面图形 → ② `dynamic.create_bound_point` 把分点建在它的**棱**上（**分点不要塞进 `create_face` 的 `vertices`**）→ ③ 最后 `solid.create_segment`（只给点名）连线段、`solid.fold` 折起来**，并点明**同一份计划是按顺序执行的**、顺序就是「**先建点、再连线、最后折**」，且**不要**用 `create_polyhedron` / `create_prism` 表达平面图形。写进技能说明的理由是**第一次就写对** —— 现场那两轮都花在修复上，而其中一轮正是**预算耗尽**那一轮。**② 预算**（`budget.ts`）：`generation` 与 `network` 由 **6 抬到 8** —— 依据是第三次现场读数（"修复轮又读一次场景"把 6 代用光、整轮停在预算上、而**本来还有修复额度**）。`budget.test.ts` 那条不变量用例**按新事实改**了：从"恰好装得下前三次、有意让第 4 次停在预算上"改成"**最坏情况也装得下**"（`MAX_PLAN_ATTEMPTS × 2` 恰好等于代际预算，余量断言由 `toBe(2)` 改成 `toBe(0)`），并在注释里记下**是谁批的**（预算主人＝用户，2026-10-15 同意"适当调高"）与**代价**（模型调用上限抬三分之一；用付费 provider 时就是花费上限抬三分之一）。**RED 两处都先看到**：技能那条（summary 里没有"计划骨架"）与预算那条（把实现 `git stash` 抽掉时 `expected 6 to be 8`、余量 `expected 2 to be 0`）各自红过再转绿。**门禁**见下一条记录。

> **2026-10-15 现场（同一道题第三次读数）：这次不是计划错，是**预算用尽** —— 而它发生在模型第二次输出（修复稿）把信封写坏之后。** 读数：`ModelPlannerError: 预算不够用这次工具的结果：还需要 generation ≥ 1 且 network ≥ 1，实际剩 generation 0、network 0（工具调用次数是另一本账）。` **查实的两件事**：① 预算**每次运行**新建（`coordinator.ts:261-262` 的 `const budget = dependencies.budget ?? createBudget(dependencies.limits)`）、默认 **6/6**（`budget.ts`），而**应用没有覆盖它**（`agentRuntime` 传给协调器的参数里没有 `budget` / `limits`）⇒ 这 6 代是在**单次运行内**用光的：`出计划 → 读场景 → 出计划 → 编译被拒 → 修复要计划 → 修复轮**又读一次场景**` 这个模式，正好是 `budget.ts` 那段注释在算的账（当年把 4 提到 6 就是为了它），**6 在这个模式上仍然紧**。② 模型的**修复稿比第一稿更差**：又是 `solid.create_polyhedron` 套平面四边形（`needs at least four faces`），而且 `solid.create_segment` 的 `vertexNames` 交了个**空数组**（`a spatial segment connects exactly two named points, got 0`）。**本轮的产品侧小修**：给"线段点名写空/个数不对"这一签名补一条**修复提示**（给出具体例子 `["E","F"]`、并重申"这两个点要由前面几笔建出来"）—— RED → GREEN（把实现 `git stash` 抽掉时那条用例**确实红**）。**需要用户拍板的一件事（预算属于用户）**：要不要把 `generation` / `network` 的默认从 **6 调高**（例如 8–10）—— 这会**增加模型调用次数**（若用付费 provider 就是增加花费），所以我**没有**擅自改。**门禁**见下一条记录。

> **2026-10-15 现场（同一条线段动作的第二次读数）：模型**已经在用** `solid.create_segment`，失败换成了**顺序**。** 读数：`segment_reference_missing: envelope.actions[1]: 这些点名在这份文档里找不到对应的点：E`（`actions[2]` 同理是 `F`）—— 也就是说它**接受了这个动作、也照约定只给了点名**（这是新动作落地的直接证据），但它把连线段放在了**建出 `E`、`F` 之前**；同一份计划**按顺序**执行，于是两端都找不到。**拒绝是对的，问题在提示**：原文案只说"两端必须是**已经建出来**的点（先建实体/棱上的分点，再连线段）"，模型**两轮都在改名字**（它没把这句读成"**调换顺序**"）。**修法两处（都把"移到后面"说成一个动作）**：① 执行层那条理由改成"同一份计划是**按顺序**执行的，这一笔必须排在**建出这些点**的那几笔**之后**（带 `vertexNames` 的实体/面片、`dynamic.create_bound_point`、`solid.fold` 都会建点）—— 请把这一笔**移到后面**（这是**顺序**问题，不是名字问题）"；② `targetedRepairAdvice` 新增这一签名，把同一件事写进**修复提示**（模型每轮真正读的是那段）。**RED → GREEN**：两条用例先红（现场那条 fixture 逐字复现："找不到对应的点：E、F"），改完转绿。**仍然不做的事**：**不替模型重排动作** —— 计划里的顺序是有语义的（别名/点名必须先存在），静默重排就是"系统替它改计划"，那正是本仓明令禁止的那一类。**门禁**见下一条记录。

> **2026-10-15 老缺口之二落地：立体里终于有"两点连成一条线段"的动作（`solid.create_segment`）。** 此前立体几何**没有**这个动作：模型要画 `EF`、`BD` 这类线，只能拿 `planar.create_segment` 去凑，而那条落在 `z=0` 上 —— `planCompiler` 甚至专门劝它"别这么干"（那条提示是对的）⇒ 模型**无处可去**（现场那道四棱锥题正卡在这里）。**这次的取证里有一条很有意思**：好几条老用例钉的"模型**自己编造**的动作名"，**就是** `solid.create_segment` —— 也就是说这个名字来自现场的真实需求（`coordinator.test.ts` 的 `inventedSegmentEnvelope`、`outputParser.test.ts`、`agentRunner.test.ts` 都是它）。**修法**：新动作 `solid.create_segment` —— **只给两个点名**（`vertexNames`），两端必须是这份文档里**已经建出来**的点（题面点名的顶点、棱上的分点、折出来的点），坐标由前面几笔决定（**再让模型手写一遍坐标就是第二个真源**）；物化成 `segment3`（**自由线段**，不是 `edge3` —— `edge3` 是实体面上的棱，带 `faceIds`）；点名少一个/重复/对不上任何已有点，**一条图元都不产出**并说清是**哪些**名字没找到（`segment_endpoint_count` / `segment_endpoint_same` / `segment_reference_missing`）。**接线七处**（少一处它就不通）：`scene-graph` 的类型 + 执行器 + 分派、`actionIds`（**34 → 35**）、`actionRegistry`、`actionInputs`（点名读者走**同一个** `canonicalPointName`）、`skills/manifest` 的 `actionIds` **与能力分类表**、`catalog` 的**内容哈希重签**（`spatial-modeling` → `1c4612a9…`）、`systemPrompt` 里那句**会误导模型的旧话**（原文是"立体里**没有**线段动作"）与 `planCompiler` 的针对性提示。**RED → GREEN**：新用例（`solidSegment.test.ts`，3 条）先红（`unregistered action 'solid.create_segment'` + 计数 34），补齐接线后全绿 —— 判据读的是**最终文档**：那条 `segment3` 的两个 `pointIds` **就是**标着 `E`、`F` 的那两个 `point3`。**顺带把三条老用例的夹具**从 `solid.create_segment` 换成今天仍然不存在的 `solid.create_wire`（覆盖不变，现场记录照旧留着），并把 `systemPrompt` 那条"不许出现 `solid.create_segment`"的断言**按新事实翻转**成"立体与平面的线段**两件事**都要说"。**门禁**：全量单测 **391 文件 / 4561 通过 + 1 todo / 0 失败**；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 12 通过。

> **2026-10-15 用户点名的两条老缺口之一落地：「点在一条线段上」终于有判据了。** 现场那句话 `D 为 AC 上一点` 此前**只有触发词、没有判据** —— 用户看到的是"今天还没有判据"（旧文案自己都写着"要新造一条义务：与该线段共线、且落在线段内"，而 `foldedTriangleClauses.test.ts` 那条用例的注释也写明"**真判据做到之后这条断言要翻转**"）。**判据（`pointOnSegment`，`targets` = [点, 线段两端]，点在先 —— 与 `midpoint` 同一条约定）判两件事，而且必须分开说**：① **共线**：点到这条**直线**的距离必须为 0 ⇒ 不为 0 就是「**根本不在 `AC` 这条线上**」；② **在线段内**：参数 `t = (D−A)·(C−A)/|AC|²` 必须落在 `[0,1]` ⇒ `t<0`/`t>1` 是「**在延长线上**」。**为什么非要分开**：它们**不是同一种错** —— 前者该改 D 的位置或那条线，后者该改参数；题面写 `AC 上一点`，而「`AC` 的延长线上一点」是**另一件事**，说成同一句用户不知道该改哪里（用例里两条**互相排除**的断言把这件事钉住：延长线那条例由里**不许**出现"根本不在"，反之亦然）。**残余取两者较大值**（等价于"点到这条线段的距离"），容差按 `|AC|` 缩放（与 `midpoint` 同一条约定 ⇒ IR 那一侧**如实不给**固定容差）。**同一处还有一条边界要如实记着**：光写 `点 D 在 AC 上`（没有"一点"那截尾巴）**不收** —— 那既可能是线段、也可能是直线，猜不得；而 `AC 上一点 D`（点写在线段**后面**）这种语序今天读不出，残留扫描器的理由**跟着改了口径**：不再是"今天还没有判据"，而是"**判据已经有了，是这一句的点名没排成能读的顺序**"。**RED → GREEN**：新用例先红（那时 check 根本不存在），补上判据后全绿；`foldedTriangleClauses.test.ts` 里那条"还没有判据"的旧断言**按它自己写明的条件翻转**成"读成一条义务"。**门禁**：全量单测见下一条记录。

> **2026-10-15 选项②落地：题面说要折、计划里没有折 ⇒ **系统按题面把那一笔补上**（第四个救援）。** 现场那道题真正卡住的是"模型写不对计划"（两轮都在拼一只"折后的闭合体"）。而这轮查实了一件此前没被用起来的事：**题面那句翻折一直是可读的** —— `readFoldTransformations`（Task 13 起）早就把它解析成 `{ face, hinge, apex, apexAs }`，只是那份解析**此前只**被用来判"折是不是刚体运动"（`foldRigidityDiagnostics`），**从来没有人拿它去补那一笔动作** ⇒ "题面说折、图上没有折"这件事系统看得见却不动手。**修法**：新增 `rescueWithSynthesisedFold`，接在救回链上，顺序成为「**补点 → 补折 → 反求折角 → 见证搜索**」（补折必须排在折角反求**之前** —— 反求要有一笔折才谈得上求角）。纪律与前三条救援逐条相同：**只救不抢**（第一遍通过就一步不动）、**计划里已经有折就不碰**（那是反求的活，否则会给同一只片补出第二笔）、**折片三个点名必须真的在图上**（缺一个就不补 —— 补一笔引用不到点的动作只会换来"引用缺失"）、**折角那一半直接复用 `rescueWithSolvedFoldAngle`**（"同一个判断不写两遍"：题面给的是折后距离，补上来那一笔先取 90°，能不能成立由反求/核验说了算）、**补了什么要写进 `assumptions`**（人话 + 定下来的东西）。**顺带查出的第二处真缺口**：`readFoldTransformations` 的正则只认 `三角形AEF` 与裸 `AEF`，**不认卷面最常见的 `△AEF`** —— 而用户原话用的正是 `△` ⇒ 读不出 ⇒ 这条救援整条落空。已把 `△`/`Δ` 收进两种写法。**RED 是先看到的**（新用例先红：`△` 读不出来；补折后 `PC=4√3` 仍是 `点名缺失：P`），补上正则后转绿。**验收（用用户原话 + 一份"缺折"的计划）**：`diagramVerification.status === "passed"`、计划里真的多了 `solid.fold`（`vertexNames` = 折前三个点名 `A、E、F`、折痕 `E→F`、`apex A`/`apexAs P`）、且 `assumptions` 里写明"计划里没有折这一笔"。**一处如实**：本题的真值折角**恰好是 90°**，与那一笔的占位值相同 ⇒ 第二遍**直接通过**（"只救不抢"的含义：核验器按最终坐标说了算），所以"反求那条路"由**既有的**折角用例覆盖（夹具里那个 30° 是**故意填错的**）—— 我没有为了"看起来更强"去改占位值凑一个反求。**门禁**：全量单测 **389 文件 / 4551 通过 + 1 todo / 0 失败**（exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 12 通过；`planCompiler.offPath.golden.test.ts` 未动（补折只在"题面有折 + 计划没有折"时触发）。**推送状况**：本地已有**五个**提交待推，`git push` 仍被网络重置。

> **2026-10-15 选项①落地：翻折那道题现在**用用户原话就能端到端通过**（本地确定性规划）。** 用户裁决做 ①+②，这是 ①。**两处挡着的（都在匹配层，不在几何层）**：① 那条代表题意图写的是 `exact: USER_FOLD_PROMPT` —— 要求归一化后**与夹具原文逐字相同**，而用户手上是**同一道题的另一种写法**（`△AEF` 对 `三角形AEF`、`AE=2/5 AD` 对 `AE:AD=2:5`，还多带 `（1）证明…（2）求…`）⇒ 匹配不上 ⇒ 落到模型那条路（现场那一轮正是这么收场的）；② 就算签名对上，那句**没有建模动词**、又带"证明/求" ⇒ `isAnalysisQuestion` 判真 ⇒ **带技能的意图一律跳过**（那条纪律的用意是"用户只想要一个读数时别替他建图"）。**修法三处**：**甲** 意图从逐字匹配改成**签名匹配**（`四边形` + `翻折` + `pc=4√3` —— 放的是这道题的**定义性特征**，不是排版）；**乙** `LocalIntent` 新增 `allowWhenAsking`，**只给这一条**开例外（它是一道完整题目：题面把图形完全确定，两问的"证明/求"属于目标层）；**丙** 新读取器认**分数写法**的定比分点 `AE=2/5 AD`（原先只认 `AE:AD=2:5` 与 `AD=2AB` ⇒ 那两句整句落进"尚未被可靠解析"，E、F 两条题设**谁也没被核**）。丙必须排在**长度**读取器之前：`AE=2/5 AD` 会被长度那条半吃成 `AE=2`（`2` 后面是 `/`，不在它的负向断言里），留下 `/5 AD` 那半截**没有 `=`**、残留扫描器也看不见 —— 又是"静默丢掉一个条件"（用例里专门有一条挡它）。**RED 是先看到的**：把两处实现 `git stash` 抽掉，两组用例各自因缺实现而红（`userFoldClauses.test.ts` 的比例那条、`localPlanner.test.ts` 的验收那条），再放回来转绿 —— 不是"写完实现补个用例"。**验收（用用户原话，逐字）**：`matchLocalIntent` 命中 → 代表计划过传输层 → `compilePlan` 后 **`diagramVerification.status === "passed"`**（夹具里那个折角是**故意填错的 30°**，所以通过只可能是因为 Task 12 的**折角反求**按 `PC=4√3` 把角算出来并换掉了它）。**门禁**：全量单测 **388 文件 / 4548 通过 + 1 todo / 0 失败**（exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 12 通过。**②（按题面整图合成）下一轮做**：这一轮只做了 ①；② 要动推导/救回链（题面里那句"将 △X 沿 YZ 翻折至 △W"今天**既不在题设账上、也不产生折动作**），设计已经查实（见下一条）。**推送状况**：本地已有**四个**提交待推（新增本轮），`git push` 仍被网络重置。

> **2026-10-15 现场（翻折题第四轮）：`got a string` 的真因是**那段字符串解析不了** —— 而旧的 `catch {}` 什么都不说。** 读数：`invalid_type@envelope: expected the plan envelope object, got a string — the envelope must be a JSON object, not text that contains one`（第 1 轮仍是"用多面体套平面四边形"被拒，第 2 轮即唯一修复轮把信封**包成了字符串**）。**查实的两件事**：① `coerceEnvelopeArgument` **在**（`apps/web/src/agent/modelPlanner.ts`，接在 `parsePlanEnvelope(coerceEnvelopeArgument(toolCall.input, …))` 上，全仓唯一一处生产调用点）；② 它的判据是"**只在解出来确实是对象时才用**"，所以这次它没接住只有一个解释：**`JSON.parse` 抛了**（模型那段被写坏/截断），而它的 `catch {}` **一个字都不说** ⇒ 在读数上"**解不了**"与"**根本没试**"长得一模一样。**修法两处（都不改合同、不做静默接受）**：① 强制转换**把失败原因说出来** —— 解析失败时报出 `JSON.parse` 的原因，解出来不是对象时报出"是数组/是什么类型"（都进开发者详细视图）；② **给模型一条说得清的修复提示**（`targetedRepairAdvice` 新增这一签名）：`plan_set_plan` 的参数必须是**对象本身**，不是装着 JSON 的字符串，请把 `goal` 与 `actions` 作为对象的字段**直接给出**（此前模板里没有这一句，那条笼统的"顶层必须有 `goal` 与 `actions`"对它并不对症）。**RED → GREEN**：现场形状的用例先红后绿 —— 喂一段**引号没闭合**的字符串（与现场同形），断言留痕里有"**按 JSON 解析失败**"，并且**仍然不静默接受**；另加一条提示用例（断言"对象本身"/"装着 JSON 的字符串"）。**门禁**：全量单测 **387 文件 / 4545 通过 + 1 todo / 0 失败**（exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 12 通过。**如实说明分量**：这一轮让**失败自证**（下一个人一眼看出是"那段文本坏了"而不是"系统没接"），并给模型一句对症的指令；它**不能**救回一段被截断的计划（引擎**不猜**）—— 那道题第 1 轮的动作形状也还是错的，所以那题仍需"模型写对"或走下面那三条结构性选项。**推送状况**：本地已有**三个**提交待推（`40de4f7` / `411f158` / 本轮）；`git push` 连续 `Connection was reset`，远端仍是 `c1f109f`。

> **2026-10-15 现场（翻折那道题，第三轮）：`goal` 那堵墙确实拆掉了，剩下的错是**约定**错 —— 补上 `fold_reference_missing` 的针对性提示。** 读数（两次几何修复之后仍然同时两条）：`degenerate_polyhedron: face ring [0,3,4] has zero area … collinear`（面塌了：模型在拼一只"折后的闭合体"）与 `fold_reference_missing: 折痕两端与顶点都必须是这只片上的点名（这片上有 P、E、F）`。**第二条是判据**：片上是 `P、E、F` ⇒ 模型把**折后**的名字写进了 `vertexNames`，而契约要的是**折前**的 `A、E、F` 加 `apex`/`apexAs` —— 这是**约定错误**（不是几何算错），此前**一条提示都没有**（`targetedRepairAdvice` 里没有这一支；第一条"开放图形不要拼闭合体"本来就有）。**修法**：新增一支按签名的提醒 —— 说清折前名字 / `apex`（折前被带走的点）/ `apexAs`（它折后叫什么）/ `hinge` 两端也必须是片上点名，并给出这类题的**正确形状**（先用 `solid.create_face` 建**折前**的平面片，再用 `solid.fold` 折它；**不要**拼"折后的闭合体"）—— 现场那两条错是**一起**出现的，所以提示也成对给。**RED → GREEN**：新用例（同时喂那两条错）先红后绿；判别性断言 `折前` / `apexAs` / `solid.fold` 用 grep 证明**只**出现在新分支里（`planCompiler.ts:1952/1959`）。**门禁**：全量单测 **387 文件 / 4543 通过 + 1 todo / 0 失败**（exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 12 通过。**如实说明这条提示的分量**：它救的是**约定**那一半（模型"想对了、写错了"）；"面塌了"那一半提示本来就有、模型两轮没照做 ⇒ 这道题**仍可能过不去**，而那属于**模型能力**（不是引擎缺陷）。**结构性选项（都还没做，等用户定）**：① 把这道**代表题**做成**本地确定性规划**（像圆锥曲线那道一样，不依赖模型）；② 把推导路径从"替换坐标"扩到"**按题面整图合成**"（让系统自己造这张平面片 + 折，而不是等模型写对）；③ 信封/编译失败的修复次数（预算）。

> **2026-10-15 现场（翻折那道题）：模型在唯一的修复轮里**整个 `goal` 丢了** —— 于是把 `goal` 也按"缺失就补"处理。** 现场读数：`the plan never matched the schema: invalid_type@envelope.goal: expected a string`。两轮分别是**两种不同的模型错误**：第 1 轮用 `solid.create_polyhedron` 去套**平面四边形**（只给 2 个面 ⇒ `a polyhedron needs at least four faces`，拒得对，模型也照提示换了形状）；第 2 轮（**唯一的**修复轮）交上来的信封里 `goal` **整栏不见** —— 而形状那关它**过了**（7 顶点 6 面的"折叠体"），整轮却停在一个字符串上。**根因是前提被证伪**：`schemas.ts` 里 `goal` 必填的唯一理由是「**模型一直写得出**…系统不替它编」。修法与 `kind` / `schemaVersion` / `factIds` **同一条口径**（缺失走默认值）：传输层把"缺失"收成空串，**编译器用题面原话（第一行）补**，并留一条 `goal_inferred` **warning** 让"这一行不是模型给的"**显形** —— 系统仍然**不替模型另编一句话**，显示出来的目标句就是用户自己写的题面。**"给了但不是字符串"照旧报错**（那是一次真错误）。**RED → GREEN**：`schemas.test.ts` 那条"缺 `goal` 就拒"的用例**按设计翻转**（缺 ⇒ 收下、`goal` 为空串；`goal: 42` ⇒ 仍然拒），并新增 `planCompiler` 用例（缺 `goal` + 题面 ⇒ 目标句 = 题面第一行 + 一条 `warning`）。**门禁**：全量单测 **387 文件 / 4542 通过 + 1 todo / 0 失败**（exit 0）；`lint` 0 error / 13 warning；`docs-consistency` 12 通过；**`typecheck` 一处如实**：第一次 **exit 2**（新用例用了没导入的 `PlanEnvelope` 类型 —— 运行期全绿、类型门禁抓到），补上导入后 exit 0。**仍记的边界**：这次放宽的是**一个字符串字段**；第 1 轮那种"用多面体去套平面四边形"仍由**编译期**拒（并且已有针对性修复提示），那是几何契约，不放宽。**另一件没做的**：信封失败仍只有**一次**修复机会（现场这两轮就是"首次 + 信封修复"用完即停）—— 要不要给"纯形状错"多一次，是预算决定，等用户点头。

> **2026-10-15 现场（正四棱柱 `A₂B₂C₂D₂`）：模型把**下标写成了数字** —— 与"弯撇"同一类，已在读入时归一。** 现场读数是七条题设重复同一句：`候选图缺少可靠的点名映射：这一笔面片的 vertexNames 与它的顶点对不上：给了 4 个名字、面有 4 个顶点；**不是合法点名**的是 A2、B2、C2、D2`。**上一轮那条"指名道姓"的诊断这一步就收效了**（按旧文案只会说"个数对不上"，而实际个数是相等的）。真因：**题面写的是下标 `A₂`，而模型在计划的名字表里写成了 ASCII 数字 `A2`** —— 同一个名字的两种写法，与弯撇 `’` 完全同形。**修法**：`canonicalPointName` 增加"**ASCII 数字后缀 → 下标字形**"（`A2`→`A₂`、`A12`→`A₁₂`、`A1′`→`A₁′`；只对**以字母开头**的串、只认 `1`–`6`，`A10` 归一成 `A₁0` 之后**仍然不是**点名）。**上一轮的接线让这一处只改内核就够**：`actionInputs` 已在读计划时调用这个函数（棱柱/多面体/面片/折面 + 折的 `hinge`/`apex`/`apexAs`），计划里的 `A2` 于是自动变成文档标签 `A₂`。**分界（写进模块注释，老契约没动）**：**题面**里的 `A1` 照旧**读不出**（留在 `unverified` 显形，不许凑合解析）；归一的是**计划里那份名字表**（它只是"这些顶点叫什么"）。**RED → GREEN**：内核用例（两种字形逐条、`A10` 仍非法、`isPointName("A1")` 仍为假）+ **现场那条原话**的端到端用例（正四棱柱 + 用 ASCII 数字命名的截面面片 ⇒ 名字表建起来、`AA₂=1` **passed**）先红后绿。**门禁**：全量单测 **387 文件 / 4541 通过 + 1 todo / 0 失败**（exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 12 通过。**仍记的边界**：① 题面自己若写 `A1`（数字），那条题设照旧读不出（有意为之）；② 本轮修的是**名字的写法**，"截面/定点是否被正确构造"仍取决于模型给的坐标，核验会如实说。

> **2026-10-15 一个**算术发现**，它改了这道题的下一步：`C'D⊥平面 ABD` 与题面其余条件**不可能同时成立**。** 上一轮我记的"①②做完这道题就该通了"**是错的**，先更正。**证明（自己算，跑遍所有折角，已钉进 `foldedTriangleClauses.test.ts`）**：折是**绕折痕 `BD` 的旋转**，而旋转**保持向量在轴方向上的分量** —— `⟨DC', û⟩ = ⟨DC, û⟩`（`û` 是 `BD` 的单位方向）。题面要 `C'D ⊥ 平面 ABD`，而 `BD ⊂ 平面 ABD` ⇒ 必须 `C'D ⊥ BD` ⇒ 必须 `⟨DC, û⟩ = 0`。实测：`C=(0,0,0)`、`D=(1,0,0)`、`B=(0,4,0)` ⇒ `DC=(-1,0,0)`、`û=(-1,4,0)/√17` ⇒ **`⟨DC, û⟩ = 1/√17 ≈ 0.2425 ≠ 0`**。扫 720 个折角取最小残差：**最小值恰好就是 `1/√17`**（这个不变量折角消不掉），而且**最小处正是 90°** —— 现场那一笔给的就是 90°，所以引擎报的 `实测 0.24254，题设要求 0` **不是折角没算对，而是这条题设的下限**。**对照（同一条用例里）**：同样绕 `BD` 折，若题面写 `C'D ⊥ AB`（`AB` 不在铰链上）**有解** —— 扫描找到的折角对上解析解 `cosθ = −19/32`（≈126.5°）。所以这更像**题面的笔误**，而不是"系统做不到"；把 `C'D⊥平面ABD` 换成 `C'D⊥AB` 这类（或者补一条 A 在铰链外的垂直关系）才可能同时成立。**结论（对下一步的影响）**：**不要**为了这道题去补 ①折前条件 / ②按垂直条件反求折角 —— 那两项**救不了**一条自相矛盾的题设。它们的价值在**别的**折起题上（题面自洽的那些）：①让"折前条件"能核（今天一律对折后文档核，读数 `点名缺失：C`）；②让"折角由题设反求"覆盖垂直/角度类目标（今天只覆盖"定点到旋转后点的距离"）。**产品该做的另一件事**：当一条关于折后点的题设**折角改变不了**（不变量非零）时，把它报成**矛盾**并说明不变量，而不是只给"实测 0.24254，题设要求 0" —— 那句话对老师没有信息量。**门禁**：本轮**只加用例与文档、未改产品代码**（所以不需要重建应用）；全量单测见下一条记录。

> **2026-10-15 现场（Rt△ABC 折起第二轮）：真因是**弯撇** —— 模型把 `C'` 写成了 `C’`（U+2019）。** 贴来的读数是「这一笔面片的 `vertexNames` 与它的顶点对不上（给了 3 个名字、面有 3 个顶点；名字必须合法且互不重复）」**七条题设重复同一句**。**离线一比一复现**：`isPointName("C'") = true`、`isPointName("C′") = true`，而 `isPointName("C’") = false` —— 弯撇不在点名字母表 `[A-Z](?:[′']|[₁₂₃₄₅₆]){0,2}` 里 ⇒ 整张点名表**建不出来**（这一处失败是全表级的，所以每条题设都报同一句话）。**修法（两侧归一，一处定义）**：内核 `canonicalPointName` 从"只认 ASCII `'`"扩成**所有撇的变体**（`’´ʹʼ`` ` ``）都归一到 `′`（这个函数本来就有、只是太窄）；**读计划那一层**（`actionInputs.ts`：棱柱/多面体/面片/折面四处 `vertexNames` + 折那一笔的 `hinge.from/to`、`apex`/`apexAs`）应用它，**题面那一侧**的 `names()` 也走同一个函数 —— 文档标签与题面点位因此是**同一种字符**。**同时把那条诊断改成指名道姓**（`nameTableProblem`）：非法与重复**分别点名**（连字形一起给），因为"个数相等"那句话在个数相等时**指不出真凶**（这一轮就是被它绊住的）。**RED → GREEN**：新用例三条 —— 内核（五种撇变体逐字归一，且全角/小写**不**被顺手收进来）、现场那条弯撇折计划（`C'D=1` 现在**核得出来**、且不再报"对不上"）、非法名字的诊断（理由里出现 `不是合法点名` 与那个名字）。**一处连带**：`foldedTriangleClauses.test.ts` 里两处旧断言写的是 ASCII 撇，归一之后目标点名是规范字形 `C′` —— 按"撇的两种字形是同一个名字"这条既有约定改了断言（不是改实现）。**门禁**：全量单测 **387 文件 / 4538 通过 + 1 todo / 0 失败**（exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 12 通过。**第二处缺口（在同一组用例里钉住，本轮没修）**：字符修对之后，`∠C=90°` / `AC=3` / `BC=4` / `CD=1` 仍报 **`点名缺失：C`** —— 它们说的是**折前的 `C`**，而折起之后图上只有 `C′`（`C` 被折走了）。这不是字符问题，是**"折前条件今天一律对最终文档核验"**；正确做法是让这类条件在**折前构型**上核验（折那一笔本身就带着折前的顶点坐标）。实测读数：`C'D⊥平面 ABD` 实测 0.24254（那一笔的折角是夹具给的 90°，本题的真实折角由垂直条件反求），`C'D=1` **passed**。**另一处如实**：`D 为 AC 上一点` 今天只有触发词接住（"还没有判据"），见上一条。

> **2026-10-15 用户裁决并落地：见证搜索（乙案推导）**改成默认开** —— 系统按题面造坐标，不再是"能力在、默认关着"。** 背景：连续几道题（三棱柱、四棱锥 ×3、Rt△ABC 折起）停下来的形状都一样 —— **模型手写的坐标不满足它自己读到的关系**，而系统**明明有**"按题面条件造坐标"的能力（`solver/witnessSearch.ts` + 内核第四族构造器，乙案），却挂在一个默认关的实验开关后面。**为什么默认开是安全的（写在代码注释里，也在这里）**：这条救援的纪律是「**只救不抢**」——`planCompiler.rescuedByWitnessSearch` 第一句就是 `report.status === "passed" ⇒ not-needed`（候选已经满足题设时**一步都不动**），只有核验**没通过**时才按题面搜，而且**第二遍必须真的通过**才采用，否则原样交回第一遍并标明坐标来源；所以它**不可能**让一份本来能过的计划变差。**落地范围（三处，逐处都有读数）**：① `apps/web/src/persistence/nextPhasePreferences.ts` 的 `loadWitnessSearchEnabled` 语义改成**只有显式 `false` 才算关**（没存过 / 坏数据 / 字符串一律按默认**开**读 —— 一条乱码不该悄悄关掉一个默认能力）；② 设置页文案与默认状态跟着改（开关**默认勾上**，点一下是"不要替我重造坐标"）；③ **9 个 e2e 规格 + 1 个开关语义规格**跟着改：它们原先是"点一下开关把它打开"，默认翻转之后**那一点会把救援关掉**，所以改成"断言它已经勾上"（这比原来更强：它同时在验默认值）；开关语义那条则反向重写（默认勾上 ⇒ 点一下关掉 ⇒ 刷新仍关）。**门禁**：全量 e2e **237 passed / exit 0**（默认翻转**没有翻转任何负例** —— 这条是本次最关键的读数）；全量单测 **387 文件 / 4535 通过 + 1 todo**，其中**一条按设计改了前提**：`agentRuntime.test.ts` 的"歪坐标被拒"现在只在**显式关掉推导**时成立（用例改成显式 `witnessSearch: false`，并**新增一条**钉住默认路径不再拒、而是走到确认面板）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。**边界照实**：① 推导**只覆盖它的构造器认得的那几类条件**（认不出如实拒绝，不猜）；② 它**只救不抢** ⇒ 用户显式关掉时行为与从前逐字相同（`offPath.golden` 那条契约仍然钉着 `false` 这一支）；③ 这道 Rt△ABC 折起题里"`D` 在 `AC` 上 + 折起 + 二面角"那几段**仍然读不出/造不出**（见上一条），默认推导解决的是"**环上的点由条件定坐标**"这一类。

> **2026-10-15 新现场（Rt△ABC 折起那道题）：一处读取器缺口 + 一处**静默丢条件**。** 题面 `Rt△ABC 中，∠C=90°，AC=3，BC=4。D 为 AC 上一点，CD=1。将 △BCD 沿 BD 折起，使 C 到 C'，且 C'D⊥平面 ABD。` 现场读数四条 `点名缺失：C` 加一条"形状从句（点名环）认不出来"。**① `Rt△ABC 中` / `△ABC 中` 认不出来**：形状从句的正则只收"三角形"三个字，既不认 `Rt`（修饰词）也不认 `△`（符号）⇒ 环不存在 ⇒ 单字母角 `∠C=90°` 落成"不知道是哪两条边"。现在两种写法都收（`Rt`/`直角` 前缀 + `△`），**只认环、不从 `Rt` 猜哪个顶点是直角**（直角由题面那句 `∠C=90°` 说，凭 `Rt` 猜就是替题面编条件）。**② `D 为 AC 上一点` 静默消失**（把读账摊开才看见：既不在给定、也不在未核验 —— 与当年 `弦 AB 的长为 3`、`P 是椭圆上任意一点` 同一种病）。这一轮先把它**接住**：触发词 `上一点 / 上的点 / 上任意一点` + 一句说得清的理由（"「某点在一条线段上」今天还没有判据……如实未核验，不静默丢掉"）；**真判据**（与该线段共线且落在线段内）还没做 —— 做到之后那条断言要翻转。**③ 读账现在长这样**（钉在新 `foldedTriangleClauses.test.ts` 里，用**用户原话本身**）：给定 = `planarAngle[∠C]=90`、`AC=3`、`BC=4`、`CD=1`、`C'D⊥平面ABD`、`C'D=1`（括号那句也读出来了）；未核验 = `D 为 AC 上一点`、`（2）求二面角 A-BC'-D 的正弦值`。**④ 如实钉住的第四处**：折起那句（`将 △BCD 沿 BD 折起，使 C 到 C'`）**不在题设账上** —— 但**没有**顺手塞进触发词表：它是一条**操作指令**，该说的是「题面说了折起、**计划里却没折**」（一条诊断），塞进 `unverified` 只会给用户一句"折起：未核验"。折起在**另一层**已经被读到（`figureIntent.readFoldTransformations`，`foldRigidityDiagnostics` 用它判刚体性），缺的正是"计划没折"这条诊断；用例把现状钉住，做到之后翻转。**根因交代（不只补读取器）**：这道题真正卡住的是**计划里没有 `C`**（模型给的坐标少了这个顶点），而系统只会自动补建**位置被题设唯一确定**的那几类（中点、定比分点）—— 自由顶点补不出来。所以这道题的根治方向仍是**由关系推出坐标**（见上一条那条边界），不是再补几个读取器。**门禁**：全量单测 **387 文件 / 4535 通过 + 1 todo / 0 失败**（exit 0；基线 386 / 4529 ⇒ +1 文件、+6 条用例）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 12 通过。**一处如实（我自己的错）**：这轮写中文用例名时**两次**把直引号写在双引号字符串里（`"未核验"`），两次都被测试运行器当场拦下（`Expected ")" but found …`）—— 与"JSON 引号"是同一类手误，记在这里。

> **2026-10-15 用户第三现场（同一道四棱锥）：合同全过了，死在几何 —— 顶点被放在了底面中心上方。** 读数：`relation_not_satisfied: relation-0（perpendicular）残差 8.16e-1`、`PD ⊥ 平面 ABCD：实测 0.81650，题设要求 0`、`PD = 2：实测 3.4641，题设要求 2`；三次尝试（1 笔 → 修复 → 2 笔 → 修复 → 1 笔）都没改对。**两个数反推得很干净**：`3.4641 = 2√3`、`0.81650 = √(2/3)` —— 正是 `D=(0,0,0)`、`P=(2,2,2)` 那一组（`|PD| = 2√3`，`PD` 与底面法向的夹角余弦 `1/√3` ⇒ 正弦 `√(2/3)`）。也就是说：**模型把顶点放在了底面中心（或别的顶点）的正上方，`PD` 成了一条体对角线**，而不是"过 D 垂直于底面"的那条棱。**这已经不是合同问题** —— 上一轮那两处 schema 修好之后，这一次信封 / 字段 / 名字**一次就过**，卡的是**几何理解**。**修法（一处，只把定义说清、不替它算答案）**：`targetedRepairAdvice` 新增一条按签名的提醒 —— `某条棱 ⊥ 平面` 的意思是那条棱**沿平面的法向**（顶点 = **垂足 + 法向 × 棱长**），长度条件由两点的**坐标差**决定、与垂直关系**一起**才把点钉死，**不要把顶点放在底面中心或别的顶点的正上方**。它**不复述读数**（读数本来就在修复请求里，模型看了两轮也没改对），而是把**那句话的几何含义**说清。**RED → GREEN**：那条用例先红（提示里没有"法向"/"垂足"），转绿后 71 条全过；新短语 `不要把顶点放在底面中心` 用 grep 证明**只**出现在实现与断言里。**门禁**：全量单测 **386 文件 / 4529 通过 + 1 todo / 0 失败**（exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 4 文件 12 通过。**两件如实记下的**：① 这条提醒**只是**把定义说清，**不保证**模型下一轮就改对 —— 真正的结构性解法是让系统**从关系推出坐标**（`planCompiler` 的见证搜索救援；入口是 设置 → 实验性功能 → 「示意图见证搜索」，它自己的说明写着"仅限有界题型的候选救援，**可能替换模型给的坐标**"）；**我没有验证**这道题打开那个开关后一定能过（四边形底面要有**环上**的定形条件，而"底面是边长为 2 的正方形"这句未必被读成环上条件）；② 立体几何里**没有**"把两个已有点连成一条线段"的动作这件事仍然记着（上一轮那条边界）——`EF` 只能靠实体的棱或文字表达。

> **2026-10-15 用户第二现场（同一道四棱锥）：模型的计划**两次**没通过信封，而两条规矩它根本无从知道。** 读数：第 1 次 `invalid_type@envelope.actions[2].inputs.vertices: a planar face needs at least three vertices`、修复那一轮 `duplicate_name@envelope.actions[2].inputs.vertexNames[2]: vertex name 'F' is used twice` —— 两次都死在 `actions[2]`，而前两笔（多面体 + `平面PAD`）这次**点名给对了**。修法两条，都落在"发布出去的 schema 与真正接受的载荷必须是同一种东西"这条老规矩上：**① 名字表发布 `uniqueItems: true`**（校验器在棱柱 / 多面体 / 面片 / 折面**四处**都判重名，而原先发布的只有"这是一个字符串数组"）；**② 逐动作的字段下限表**（`FIELD_MIN_ITEMS`）—— 面片（`solid.create_face` / `solid.fold`）的 `vertices` 真下限是 **3**（`平面 PAD` 就是三角形），而通用的 `vertexList` 发布的是 **4**（那是**闭合多面体**的下限）；发布 4 会让模型以为三角形面片不被接受，于是去"凑第四个点"——现场那份重名的 `F` 正是这么来的形状；棱柱的 `vertexNames` 补 `minItems: 6`（底环 n + 顶环 n）。**③ 修复轮的两句提醒**：`一条线段不要用面片去凑 —— 立体几何里没有「画线段」的动作`、`vertexNames 里每个名字只能用一次（它按下标与 vertices 一一对应）`。**用户要求的那条纪律落成了守卫用例**：`actionSchemas.test.ts` 新增一组"发布的 schema 不许隐瞒校验器会执行的规矩"，**枚举全部动作**检查名字表的 `uniqueItems`、面片/多面体的 `minItems` 与棱柱的名字个数 —— 以后改了校验器不改 schema 就直接红（不再靠人记得逐个看）。**RED → GREEN**：3 条 schema 用例先红（16 条既有绿）、2 条修复提醒用例与之配套（新文案 `画线段` / `只能用一次` 用 grep 证明**只**出现在实现与用例里 ⇒ 这两条断言确实会咬人）。**门禁**：全量单测 **386 文件 / 4528 通过 + 1 todo / 0 失败**（exit 0）；`lint` 0 error / 13 warning；`docs-consistency` 4 文件 12 通过；`typecheck` 最终 exit 0 —— **一处如实**：本批**第一次** `typecheck` 是 **exit 2**（`uniqueItems` 没在 `JsonSchema` 类型上声明，运行期用例照旧全绿）⇒ 类型门禁抓到了运行期测试抓不到的东西，补上声明之后复跑 exit 0。**仍记的边界（下一件的入口）**：立体几何里**没有**"把两个已有点连成一条线段"的动作 —— `planar.create_segment` 只收 `x`/`y`（而且修复提醒里明说"不要再用 `planar.*` 去补立体的边"），所以模型想显示 `EF` 时**没有正确动作可套**，只能去凑面片。这才是"每次都有"的结构性原因；要么补一个空间线段动作，要么在技能说明里明说"线段不单独建、实体的棱已经画出来了"。修复轮**仍然只多给一次机会**（预算是用户定的，不擅自改）。

> **2026-10-15 用户现场（四棱锥 P-ABCD）三处缺陷，逐处复现、逐处修。** 现场读数三条：`PD ⊥ 平面 ABCD：候选图缺少唯一、可靠的顶点名映射`、`PD = 2：同一句`、`E、F 分别为棱 AB、PB 的中点：尚未被可靠解析`。**离线按同一形状跑了一遍，三条逐字复现** —— 于是逐条定位：**① 构造实体那一笔没带点名**（`solid.create_polyhedron` / `solid.create_face` 的 `vertexNames` 是**可选字段**，模型不给也照样编译通过）⇒ 图上顶点只有模板编号 `P1…P5`，题面里的 `A/B/C/D/P` 对不上任何顶点；而"点名表建不出来"这一句**有八个不同成因共用**，现场根本读不出该改什么。修法：`candidatePoints` 的返回从 `Map | null` 改成 `{ok:true,points} | {ok:false,reason}`，**每个守卫各自说清是哪一种缺**（"这一笔多面体**没有带点名**（`vertexNames`）：图上的顶点只有模板编号（`P1`…），题面里的点名对不上它"），核验理由原样带上它 —— 与预算那条报错"点名哪本账、还剩多少"同一条纪律。**② `E、F 分别为棱 AB、PB 的中点` 读不出来**：并列中点那条读取器收 `E、F 分别为 AC 和 CC₁ 的中点`，但**不吃「棱」字** ⇒ 整句落进"尚未被可靠解析" ⇒ E、F 谁也没被点名 ⇒ **补点入口断掉**（它们本该由系统按中点造出来）。两条中点读取器（并列 / 单写）现在都收 `棱` / `边`，且**只收这两个量词**。**③ 顺带查出下游第三处**：多面体**自己的面**（`faceIds`，类型里是必填）被算进了"新出现的 `face3`"⇒"一笔多面体 + 一笔 `solid.create_face`"（模型为了让 `平面 PAD` 看得见，常常顺手补一笔）**恒定**撞上数量判据 ⇒ 整张点名表建不出来。按归属排除之后，"新面片"才真的等于"由建面/折那几笔产出的面"。**④ 模型那一侧也补了一句**（现场就是没给名字）：`spatial-modeling` 的技能说明里写明"题面点名了顶点时，构造那一笔必须用 `vertexNames` 按 `vertices` 的下标给全，否则**题设核验一条都过不了**"，并挂了一条用例防它被删。**RED → GREEN**：新 `solidVertexNames.test.ts` **5 条** —— 前 4 条先红（读取器读不出、端到端停在 `unverified`、两条理由里都没有 `vertexNames`），转绿后跑出**端到端通过**：**用户原话 + 一份带点名的四棱锥计划 ⇒ `passed`**，E、F 由系统补出来，落点**由测试自己算**（E=(2,1,0)、F=(1,1,1)）。**golden 基线按本仓纪律重抓**：先用一次性探针逐字段对读，证明差异**恰好**是 6 处文案（3 条 `diagnostics[].detail` + 3 条 `diagramVerification.checks[].reason`）、只动 `pyramid-unverified-without-names` 一条用例、两种开关形状逐字节相同；**探针在写回之前把不合预期的差异直接判红**（第一版探针正因路径形状不符而拒绝写回），然后才写回样本并记一条修订（`kind: unmapped-names-reason`）。**一条值得记的对照**：仓库的 golden 样本里**早就有** `pyramid-unverified-without-names` 这一条 —— 这是**已知形状**的失败，不是新的偶发。**门禁**：全量单测 **386 文件 / 4523 通过 + 1 todo / 0 失败**（exit 0；基线 385 / 4518 ⇒ +1 文件、+5 条用例）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 4 文件 12 通过。**仍记的边界**：① 模板类立体（`solid.create_template` / `create_regular_pyramid` / `create_round_frustum`）**字段里根本没有点名**，题面点名无从谈起 —— 那是覆盖清单里另一类**未做**的欠账；② 本轮**没有**把"模型必须给 `vertexNames`"做成**合同层强制**（仍是可选字段 + 技能说明里的要求）—— 要不要强制，等下一次现场读数再定。

> **2026-10-15 施工单①收口：`P 是椭圆上任意一点` 从「静默消失」变成「读得出、量得动、判得动」。** 四层一处不落：**① 判据（内核）** `packages/geometry-kernel/src/conic-line.ts` 导出 `conicResidualAt(conic, point)` —— 薄包装复用本模块**已有**的私有三件套（`buildLocalForm` → `evaluate` → 残差 `|Q| / max(1, |∇Q|)`），并顺手把那条残差公式**收成一处**（`localEvidence`，`evidenceAt` 也走它），**没有第二份隐式方程**；口径写在类型上：它是**一阶**距离估计、不是精确距离（`(0, 3)` 对 `x²/9+y²/4=1` 给 0.8333，真实距离是 1），退化参数与非有限点一律 `null`。**② 读取器与义务** `diagramObligations.ts` 新增 `pointOnConic`（`targets: [点名]` + `conicKind`）：`是 / 为 / 在` 三种系词 × `椭圆 / 双曲线 / 抛物线`；尾部只收**封闭的**五种说法（`任意一点 / 任意点 / 一点 / 的点 / 动点`），**不做"往后吃几个字"** —— 那会把 `P 是椭圆上一点且AB=2` 里的真条件一起吞掉，而按字符占位去重会让它**再也不被扫描**（正是"静默丢掉一条题设"）。**刻意不收** `P 是椭圆外一点`（与"在曲线上"是相反的事）：新增触发词 `OUTSIDE_CURVE_TERM` 让它落"未核验"，理由明说"今天的判据只有'在曲线上'这一条"。**③ 判性与容差** `obligationIR.ts`：进 `JUDGED_KINDS`（否则界面会把它显示成"ambiguous"）、容差与点坐标同一把绝对尺子 `distanceTolerance(1)`；`conicKind` 进 `ObligationGeometry` 并双向适配，R4 的 `toEqual(legacy)` 照旧成立。**④ 判据（核验）** `diagramVerification.ts` 的 `pointOnConic` 支三层都问**候选图自己**：图上有没有恰好一条新画的圆锥曲线（`candidateConic`）→ 是不是**题面说的那一种**（不符直接判失败并说清两种曲线，与 `conicAxes` 的"轴反了"同一档）→ 那一点离这条曲线多远（内核残差）。题面自己写了"任意"时，这条判据的理由里另有一句**指回报告证明范围**的披露（"这一条核的是**图上这一点**，不是对任意点的证明"）—— 少了它，一个绿字很容易被读成"对任意点都成立"。**RED → GREEN（先红后绿，逐条都有读数）**：内核 5 条先红（`conicResidualAt is not a function`）后绿（残差与梯度**由测试自己按曲线方程现算**、旋转椭圆与三类曲线各一条、退化输入一条）；读取器 3 条先红（`pointOnConic` 不存在 / 那句整句消失）后绿，其中那条**"将来翻转"的断言已经翻转**成正面判据（带点名 `P`、种类 `ellipse`，且**不再落进未核验**）；核验 4 条先红后绿：**正例**（`P` 真的在椭圆上 ⇒ `passed`，残差 `< 1e-12`）、**落在椭圆内**（绑在 x 轴上的 `(1.5, 0)` ⇒ `failed`，残差 **0.75** 由测试自己算：`Q = −0.75`、`|∇Q| = 1/3 < 1`）、**种类不符**（题面说椭圆、图上画抛物线 ⇒ `failed`，两种曲线都写在理由里）、**图上没有 P** ⇒ 未核验且理由点名缺的是 `P`。实现过程中被自己的用例纠正一次：读取器最初的 `sourceText` 只到"椭圆上"（`任意` 两个字没进来），于是那句**披露永远不会触发** —— 尾巴收成封闭集合之后两处一起绿；记在这里是因为"披露写在一句判据里、而那句话却没被读全"是很容易漏的一种错。**门禁**：全量单测 **385 文件 / 4518 通过 + 1 todo / 0 失败**（exit 0；基线 384 / 4507 ⇒ +1 文件、+11 条用例）；**设计夹具未被误伤** —— `e2e/agent-conic-invariant.spec.ts` **2 passed**（`CONIC_INVARIANT_PROMPT` 仍然走到 `awaiting_confirmation`；这正是施工单点名要确认的那一条，因为这条新义务一旦判不出来，确认面板会整块消失）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`docs-consistency` 4 文件 12 通过。**仍记的边界**：① 曲线**外**的点没有判据（如实未核验，见上）；② 一句话里有多条圆锥曲线时 `candidateConic` 返回 `null` ⇒ 这条义务落"未核验"（"判的是哪一条"没有答案，不猜）；③ 写"圆锥曲线上"这种**不点种类**的说法今天读不出来（判据要拿种类问"图上是不是那一种"，猜不得）；④ **曲线上的点补建**（施工单②：圆柱/圆锥底面上的点、母线中点）仍未做。

> **2026-10-15 「题面点名、图上没有的点」覆盖清单（形状 × 构造）—— 支持哪些、不支持哪些，一次说清。** 这张表是用户那句"下次是棱锥、圆锥又怎么办？覆盖所有常见的"的直接答复：**判据不按形状枚举**（宿主 = 输入里带 ≥3 个字名的动作），所以形状这一维是**自动**覆盖的，真正的分界在**构造类型**与**有没有点名**。
>
> | 构造类型 | 覆盖情况 | 证据 |
> | --- | --- | --- |
> | **中点**（`E、F 分别为 AC 和 CC₁ 的中点`，含并列写法） | ✅ 通 | 棱柱端到端（用户原题）+ 棱锥端到端 + 既有面片/多面体用例 |
> | **定比分点**（`AE:AD=2:5` 一类） | ✅ 通 | 既有用例（含"棱的方向决定参数往哪边量"那条坑） |
> | **面形状**（`侧面 AA₁B₁B 为正方形` / `为矩形` / `为菱形`） | ✅ 通（读成已有判据：正方形 = 三条等长 + 三个直角；矩形 = 三个直角；菱形 = 三条等长） | 本轮用例 + 用户原题整句 |
> | **带点名的宿主** | ✅ 棱柱 / 棱锥（多面体建法）/ 多面体 / 面片 / 折面 —— 判据只有一条，新增体自动算 | 本轮矩阵用例 |
> | **曲线上的点**（圆柱 / 圆锥：底面圆上的点、母线中点、圆心） | ⚠️ **半通** —— 读取器仍没有，但 `圆周 / (?<!椭)圆上 / 母线 / 底面圆` 已进残留触发词 ⇒ 这类句子**至少落进未核验**（此前与 `弦 AB 的长为 3` 一样**静默消失**）；真正的补建（认出是哪条曲线 + 参数，落成 `dynamic.bind_curve`）未做 | `curvePointClauses.test.ts` 两条 |
> | **点在圆锥曲线上**（`P 是椭圆上任意一点`） | ✅ **通（2026-10-15 收口，施工单①）** —— 读得出、量得动、判得动：读取器认 `是 / 为 / 在` × `椭圆 / 双曲线 / 抛物线`（`P 是椭圆上任意一点` / `P 在双曲线上` / `M 为椭圆上一点`）；判据由核验器拿**内核** `conicResidualAt` 从**图上那一点与图上那条曲线**自己算（复用 `conic-line.ts` 的局部隐式形式，**没有第二份隐式方程**）；题面说的种类与图上那条曲线不符 ⇒ 直接判失败并说清两种曲线；图上没有那个点名 ⇒ 如实报"点名缺失：P"。**"任意一点"那层普遍性仍不由这条承担**（由报告既有的 `proofScope: figure-instance` + `universalClaims: not-proven` 承担，判据理由里另有一句指回那里的披露）。**刻意不收** `P 是椭圆外一点`（那是相反的事）：它由残留触发词接住，落"未核验"且理由说清"今天的判据只有'在曲线上'这一条"。 下面这段是**当时那次勘测的过程记录**（结论已被上面的收口取代，留着是为了记住判据复用了什么、以及为什么不能另写一份方程）：**实现勘测（2026-10-15 定量过）**：① `diagramVerification` 里**没有**"点在曲线上"的判据（`pointOnCurve` 之类一处都没有）⇒ 要**新造一种义务 + 一条判据**；**但判据的实现不必从零写**（2026-10-15 继续勘测）：`conic-line.ts` 里已有 `buildLocalForm` → `evaluate`（给 `value` 与 `gradient`）→ `evidenceAt`（残差口径 `|Q| / max(1, |∇Q|)`，长度量纲），只是**模块私有**；正确做法是**导出一个薄包装**（例如 `conicResidualAt(conic, point)`）复用它，**不要再写一份隐式方程**（那就是"同一个判断写两遍"）；② 读取器认 `(点名) 是 (椭圆/双曲线/抛物线) 上 …`；③ **它不是"再加一个触发词"**：加词只会让它变成未核验、从而打掉设计夹具 `CONIC_INVARIANT_PROMPT` 的 `awaiting_confirmation`；而**真读成一条可核验的义务**之后，实例核验通过即可，**"任意一点"那层普遍性由报告里既有的 `proofScope: figure-instance` + `universalClaims: not-proven` 如实承担**（不必也不许假装证明了任意性） | `curvePointClauses.test.ts` 一条（断言写成"将来翻转"） |
> | **模板类立体**（`create_template` 正棱锥/正四面体、`create_round_frustum`、球） | ❌ **未做** —— 这些动作的字段里**根本没有点名**（只有 center/radius/height），题面的 `P、A、B、C、D` 不可能从它们来；要么让模板也接受点名，要么由计划改用带点名的建法 | 本轮用例把这条边界钉住（不许假装核验过） |
> | **需要几何求解的点**（交点 / 垂足 / 投影） | ❌ **未做** —— 不是"补一笔动作"能定的；系统**如实报"补不上"**，不静默、不硬凑 | 既有救援的"要么全补、要么不补" |
> | 其它面形状（菱形 / 梯形…） | ❌ 未做（读取器还没有） | —— |
>
> 一句话：**"两点名之间的点"这一整类已经通（形状不设限），"曲线上的点"与"没有点名的模板立体"是两类不同的欠账**，都还没做，也都写在上面。

> **2026-10-15 用户那道直三棱柱的题**整句跑通了**（编译 ok + 题设核验 `passed`，E、F 都补在正确位置）。** 这条线一共四处缺陷，逐处定位、逐处修，都有用例钉着：① **并列写法的中点读不出来**（`E、F 分别为 AC 和 CC₁ 的中点` 落进"尚未被可靠解析"）⇒ 新增读取器，一句话读出两条 `midpoint`（契约本来就允许返回数组），覆盖和/与/顿号、有没有"分别"四种变体；② **补点的宿主按形状枚举**（只认多面体与平面片，棱柱被挡）⇒ 判据改成"**输入里带 ≥3 个点名**"，棱柱/棱锥/棱台/多面体/平面片一次全通，用户的原话就是"别按形状打补丁"；③ **找棱靠 id 前缀**（那是某一种体自己的命名习惯）⇒ 改成按**端点点名**匹配，唯一性本来就强制；④ **"要么全补、要么不补"把不可构造的题设也算进来** —— 题面里 `BF ⊥ A₁B₁` 也点名了 F，而垂直关系不是一笔动作能构造的 ⇒ 整批放弃 ⇒ 一个点都没建（**这才是"点名缺失：F"的真凶**，靠入口探针才看到：三条条目里两条可构造、一条不可构造）。修法：全补或不补**只在可构造的那几类之间**成立；不可构造的那些是**期待**，第二遍核验照样判它们。最后 ⑤ **`侧面 AA₁B₁B 为正方形`读得出、验不了**（被"面 XX"通用模式吞掉，落成核验不了的关系）⇒ 新增读取器，**复用**已有的等长与垂直判据（四条边等长 ×3 + 相邻边垂直 ×1），**不新造 `square` 义务**。**验收用的是用户原话本身**：`planCompiler.prismMidpoints.test.ts` 三条 —— 原话整句（编译 ok、核验 `passed`、"正方形"那四条判据条条 passed）、去掉正方形那句（同样整轮通过）、以及 E/F 落点由**测试自己算**（AC 中点 (1,1,0)、CC₁ 中点 (2,2,1)）。门禁：全量单测 **381 文件 / 4498 通过 + 1 todo / 0 失败**（45.45 s，exit 0）；全量 e2e **235/237** —— 两条都是**负载敏感用例**（`agent-exam-visual-and-stale.spec.ts` 单独跑 6 passed；**另一条本轮没有单独复跑确认，如实记**）；`typecheck`/`lint` 见提交记录。**仍开放的如实清单**：`侧面…为矩形`之类的其他面形状还没读取器；交点/垂足/投影那类需要几何求解的点仍不在"补点"范围内（会如实说"补不上"，不会静默）。

> **2026-10-14 第二次重试暴露的第二个失败已修：模型把计划**包成字符串**交上来 ⇒ 整轮硬失败（连一次修复机会都没有）。** 用户现场读数（直三棱柱那道题、重建后再试）：第一遍 `plan_set_plan` 是**正经对象**但把三棱柱的点名写成 3 个（合同要求**基环 + 顶环、至少六个且为偶数**）⇒ 被拒；第二遍**点名改对了**（`A,B,C,A₁,B₁,C₁`），却把整个信封**双重编码成字符串**（`"{\"actions\": …}"`）⇒ 引擎判 `expected the plan envelope object, got a string` ⇒ 整轮停。**根因（先核实再改）**：我方工具 schema **本来就是** `type: "object"` + `required: [schemaVersion, kind, goal, factIds]` + `additionalProperties: false` —— **合同没写错，是模型照样这么发**：工具参数在**线路上本来就是一段 JSON 文本**（provider 方言如此），模型会"串味"地双重编码。所以修法不是放宽 schema，而是**两头都补**：① 把"参数必须是 JSON 对象、不是装着 JSON 的字符串"写进**模型每轮都读的**工具描述里；② 新 `coerceEnvelopeArgument`：参数是字符串时**按 JSON 解一次**，**只在解出来确实是对象时**才用，并**留一行痕**（开发者详细视图："`plan_set_plan` 的参数是一段字符串，系统按 JSON 解了一次（对象形式的合同没有变）"）—— 解不出来仍按原样交回，由信封校验报逐条字段错误。**静默接受仍然不做。** **RED → GREEN**：新用例喂**字符串形式**的信封（就是现场那一次），要求它被解出来并按计划走、且留下那行痕；此前这种交法直接判 `got a string`。**顺带记下的两条真问题（尚未做）**：① 三棱柱那条合同（基环 3 + 顶环 3）应当**写进动作说明**，别让模型烧一轮去试错（现场那 1586 字的参数就是它自己猜的）；② 这次"按文本解了一次"只出现在**开发者详细视图**，还不是用户可见的假设 —— 要提到用户面的话得走信封的 `assumptions` 那条路。门禁：`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；`modelPlanner.test.ts` **48 条全过**；全量单测与 e2e 见下一条（本轮末跑）。**注**：**上一批的预算修复是生效的** —— 这次没有再报 `budget exhausted`，而是走到了"用工具结果出计划"之后的合同那一步。

> **2026-10-14 用户现场故障已定位并修复：**代际预算 4 代装不下"读场景"的工具轮** ⇒ 3D 题在修复轮死在预算上（`ModelPlannerError: budget exhausted…`）。** 用户贴来的原始读数：直三棱柱那道真题，界面走到 `preflight → observing → planning → 读工具 scene.inspect 成功 → 暂存 3 个动作 → asking for the repair (shape 0/1, geometry 1/2) → failed: budget exhausted before the model could use the tool results`，原因码 `run_failed`，**整轮什么都没落下**。**根因（逐处数过扣账点，不是猜的）**：扣账只有三处 —— 协调器每次向模型要计划扣 1 代 + 1 网、每次修复尝试再扣 1 代 + 1 网（`coordinator.ts:365/436`）；规划器每做**一轮读工具**替"下一轮用工具结果的生成"预扣 1 代 + 1 网（`modelPlanner.ts:544`）。**没有多扣**。现场的账：提问① 1 + 工具轮 1 + 修复提问 1 + 修复的第一个工具轮 1 = 4（用满），而修复的**第二个**工具轮要第 5 代 ⇒ 预检在"剩 0"时抛出。也就是说：计划里那个 **4（"4 logical generations"，Task 2.1 原文）是在只读工具出现之前定的**，而一个工具轮要多花一次生成 ⇒ 它只够"一次尝试 + 一次修复，且都不读场景"。**同向的第二条证据**：`network` 一直是 6，而**每一次网络往返必然是一次生成** —— 两个账本给同一件事实各定了一个上限，紧的那个才是真的上限，而紧的那个恰好是错的。**修法（用户 2026-10-14 选 A）**：`DEFAULT_BUDGET_LIMITS.generation` **4 → 6**（与 `network` 对齐；`tool: 24` / `actions_per_stage: 32` / `actions_per_run: 128` 一个没动，运行仍然有界），并把预算与协调器的修复额度**挂钩** —— `MAX_PLAN_ATTEMPTS` 从模块私有改成导出（= 4：首次 + 信封修复 + 编译修复两次），`budget.test.ts` 新增一条不变量：`generation ≥ (MAX_PLAN_ATTEMPTS − 1) × 2`，**并把剩下的 2 代余量明写出来**（第 4 次尝试若还要读场景就停在预算上 —— 这是有意的：宁可停在一轮有界的地方，也不为最坏情况把默认抬到 8、连带把 network 也抬上去）。**RED → GREEN（现场那条路直接进了用例）**：`modelPlanner.test.ts` 新增一条跑**两遍同一条路**的用例 —— `generation: 4`（旧默认）**必须红**（抛的正是现场那句"预算不够用这次工具的结果"，且第三个读工具一次都没执行），默认（6）**必须走完**且恰好花 **5 代 5 网**；另有"一批只读工具只扣一次生成"那条老用例继续守着 2026-10-10 的修复。**顺手修的报错质量**：那句 `budget exhausted before the model could use the tool results` 谁都读不出"哪本账、还剩多少"，现在点名 `generation 0 / network 0（工具次数是另一本账）` —— 用户当时只能整段贴开发者视图才能定位。门禁：`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；全量单测 **379 文件 / 4491 通过 + 1 todo / 0 失败**（37.80 s，exit 0）；**全量 e2e 237 通过（1.9 m，exit 0）**。**还没做**：把应用重建一遍，让用户**在原题上重试**（那一次会花他 provider 的钱，我按约定先问再跑）。**另记**：用户贴来的这道题是**第一条逐字真题面**（此前后 12 道题面全是调研摘要），已按他的意思录进"新一批冻结样本"的候选。

> **2026-10-14 受闸入口造好了，并用**零成本干跑**证明它真的会拒（一个请求都没发、一个 token 都没花）。** 用户选 B（我来造入口、由系统按开关）。**入口**：桌面壳新增启动模式 `mathcanvas-desktop.exe --exam-run <报告路径>` —— `ExamRunState::from_args` 在**起窗口之前**读一次（`shell_smoke.rs` 的命令清单里逐字加了两个名字：`exam_run_target` 只回答"这次是不是评测跑、报告写哪"，`exam_run_finish` 把报告交回来），前端启动时问一次 target，拿到就走**真产品路径**（`createModelPlanner` → 桌面壳 IPC 借密钥 → `runExamEvaluation` 与授权闸），跑完由 **Rust 写到启动参数给的那一个路径**再退出。**安全边界**：前端交的只是一段文本、**路径不由它决定** —— 所以这次没有、也不会加"写任意文件"的通用命令（与 `shell_smoke` 那条"没有通用 shell/文件读写出口"同一条）。**干跑读数（授权闸仍关着）**：进程自己退出 **code 0**，报告落盘 `D:\数学画布\exam-dry-run.json`，内容是 `evaluation.ok = false` + 理由"还没有拿到付费授权（`authorization.status` 仍是 pending）"、`planned = { requests: 36, worstCaseCostUsd: 10.35 }`；**顺带把 provider 那问答了** —— 这台机器「使用中」那份解析成功：`ds / deepseek-chat / dialect deepseek`。**一条必须先说的边界**：这一跑的 **$12 上限拦不住** —— 费用算不出来（仓里没有价目表 ⇒ `costUsd` 一律 `null`），所以超支核对这一轮**不会触发**，真正兜底的只有事前估算的 **$10.35**。门禁（本批）：`typecheck` exit 0；`lint` 0 error / 13 warning（基线；中途我自己写出 1 个 `no-useless-assignment`，已把"取目标"那一段收成一个函数修掉）；全量单测 **379 文件 / 4487 通过 + 1 todo / 0 失败**；**全量 e2e 237 通过（2.0 m，exit 0）**；**Rust 全量各套 12+26+26+25… 全过**（含 `shell_smoke` 的命令清单）；桌面 `tauri build --no-bundle` exit 0（前端 6.01 s 一起重建、cargo 36.55 s）。**仍未做**：把授权值写进冻结表 + 真跑 36 次。

> **2026-10-14 付费实测前的诚实性前置：费用**没测到就是 `null`，不许记 0**（否则费用阈值凭空通过）。** 用户已授权（**36 请求 / 上限 $12**，`grantedBy` 按原话记为 `"X"`），但在按下开关之前先量了一件事：**仓里没有价目表** —— provider 那条通道能拿到的只有用量（token 数），**拿不到钱**。此前的 `costUsd` 是**必填数**，把"算不出"写成 0 会让 `costPerCase` 拿 `0 ≤ $0.25` **凭空通过**，报告里就会出现一条"费用达标"的绿字（本仓最忌的"没测当成测了"）。**改法照"人评没标就是 `null`"那一条**：`ExamTrialObservation.costUsd` / `ExamFamilyResult.costUsd` / `totals.costUsd` / `ExamRunCaseResult.costUsd` 全部改成 `number | null`；**有一次算不出钱，那一族与总计就是 `null`**（不拿已有的那几次求和冒充合计 —— 那会把"没测"摊薄成一个偏小、正好往阈值靠的数）；**超支核对只在钱算得出来时才做**（`null` 时既不说"没超"，也不拿它拦下整轮：报告照样给，费用那一栏如实是 `null`）；`costPerCase` 那条阈值**如实不通过**（判据本来就写着 `actual !== null && …`，这一批只是让 `null` 真的能流到那里）。**RED → GREEN**：两条新用例 —— 全表无费用 ⇒ 合计与每族都是 `null`、费用阈值**条条不通过**、而**成功读数不受影响**（`passAt1` 照旧 1）；混一条无费用 ⇒ 那一族与总计是 `null`、**别的族照旧是数**。门禁：全量单测 **379 文件 / 4487 通过 + 1 todo / 0 失败**（44.37 s，exit 0；+2 = 本批用例）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；**全量 e2e 236/237** —— 唯一一条是 `main-thread-responsiveness.spec.ts`（本文件早已按"负载敏感抖动"记过），**单独跑 1 passed** ⇒ 按本仓口径**记为抖动、不说成全绿**。**如实记**：**授权还没写进冻结表**（`authorization.status` 仍是 `pending`），**付费那一跑一次都还没发**、一个 token 都没花；下一步是补那个受闸入口（桌面壳 `--exam-run` 启动模式，用户已选 B），先做**零成本干跑**（闸仍关着，应当拒得干净），确认入口无误之后再把授权值写进冻结表、才真跑。

> **2026-10-14 给 Task 15 的边界「外点双切线没有产品动作」补上了产品入口：`function.create_tangent` 新增一类锚点 `{ kind: "through", pointId, branch }`（过曲线外一点作切线）。** 边界原文："外点双切线 / 公切线**没有产品动作** ⇒ 它们的产品面读数在本任务里是内核 + 单测"。**判据不重写**：内核 `tangentsFromPoint` 早就会算这一族（2021 新高考Ⅰ卷 7 题那种"从曲线外一点向指数函数作两条切线"，连临界一条 / 无解 / 退化都有结论）；新加的 `tangentThroughPoint`（`scene-graph`）只做"锚点 → 那一次调用"的翻译，把"第几条"翻成**切点参数** —— 于是**编译期与重算期走同一个求解器**，重算填几何那一段与既有的 `parameter` 锚法**共用同一段收尾**。**为什么单开 `through`、不复用 `point`**：`point` 是"跟随一个**绑在这条曲线上**的动点"（切线在它自己那儿作），`through` 是"过这个**曲线外**的点"（切点要**解出来**，一个点一般对应两条 ⇒ `branch` 选第几条）—— 混成一句会让用户以为切点就是那个点；检查器文案据此也分开写（"跟随动点 P" / "过点 P 的第一条切线"）。**一处契约、九处落点（typecheck 一处一处逼出来的）**：`scene-graph` 的动作输入类型、`@draw/dsl` 的**存储**类型、`dsl` 的文档校验、`scene-graph` 的补丁校验、`scene-graph` 的编译、`scene-graph` 的重算、`agent-core` 发布给模型的 JSON Schema、登记表的**嵌套引用**解析（`anchor.pointId` 要能指向同一份计划里新建的点）、以及检查器文案。**如实记的边界**：① 这一档**只收函数曲线** —— 圆与圆锥曲线那一侧内核还没有同一个求解器（那要各自的代数求解），所以**如实拒绝**（`unsupported_source`），不假装读过；② **公切线**仍没有产品动作；③ 题面层面的**核验**（把"过外点的两条切线"做成一条义务）仍然没有读取器 —— 这一批交付的是**作图能力**。**RED → GREEN**：新 4 条用例（`(0, −1)` 向 `y = x²` 两支各一条；重算之后**测试自己算**那条线真的过该点、切点处斜率 = 导数、两条互不相同；`(0, 1)` 落在抛物线**里面** ⇒ 编译期 `no_tangent`，不落空图元；圆 ⇒ `unsupported_source`）。门禁：全量单测 **379 文件 / 4485 通过 + 1 todo / 0 失败**（44.18 s，exit 0；+4 = 本批用例）；**全量 e2e 237 通过（2.0 m，exit 0）**；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。

> **2026-10-15 为"条件被静默丢掉"这一类缺陷加了一条**系统审计**，并顺手补上一处审计照出来的写法。** 审计（新 `examClauseCoverage.test.ts`）：**带具体条件的句子必须出现在 `givens` 或 `unverified` 里** —— 落进未核验可以（"读不懂就如实说"是本仓纪律），**消失不行**。它是为**一类**缺陷写的，本仓已撞过两次（`弦 AB 的长为 3` 静默消失；非标准曲线把"范围外"说成"没写清楚"）。**一条先量出来的前提**：随仓那 12 道"真题题面"**全是调研归纳的主题摘要**（`promptKind: survey-summary`、`verifiedGoldCaseIds` 仍为空）—— 第一版按"每句都要记账"去卡，**6 道红**，逐条看**全是假红**（「椭圆动弦。」这类摘要本来就不带具体条件，谈不上"读得出/读不出"）。于是判据收成两段：**① 摘要那一批**只卡"**既有条件词、又有数字**"的句子（今天一条都没有 ⇒ 它是一道**等 verbatim 真题题面进仓才会咬人**的护栏）；**② 具体句那一批**拿仓库里真实用过的问题句（用户原话 + 各任务夹具）逐句卡同一件事。**审计当场照出一处真缺口**：「弦 AB 的**长度**是 3」—— 读取器只收"长为/长是"，而它同样**没有 `=`** ⇒ 照旧静默消失；已把 `的长度为 / 的长度是` 收进读取器（判据照旧复用 `fixedLength`，不新造）。**判据自身可咬人**：另加一条**对照组** —— 喂一句有条件词有数字、任何读取器都不认、残留扫描器也够不到的话（`弦 AB 大约 3`），它**必须被报出来**；没有这一条，其余全绿说明不了任何事（判据可能被写成了恒真）。门禁：全量单测 **379 文件 / 4481 通过 + 1 todo / 0 失败**（43.87 s，exit 0；+1 文件 = 本批）；**全量 e2e 237 通过（1.9 m，exit 0）**；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。

> **2026-10-14 收口 Task 14 的最后一条边界「面积核验要求图上真有那个点名」：`O` 按**约定**取原点，并把这条约定**写在判据理由里**。** 边界的实情：解析几何里 `O` 就是原点，而题目通常**不把 O 画出来**（图上只有椭圆/直线/曲线与 A、B）⇒ `△OAB的面积为…` 这类条件永远停在"点名缺失：O，未核验"，用户与门禁都走不动。**修法**：`diagramVerification` 新增 `statedOriginNames`（**一处判据**）+ 在 `verifyDiagramObligations` 里把约定补进**这一份核验用的点名表**（不往文档里加任何东西 —— 图上没有 O 这件事仍然是真的）；披露写在**那条判据自己的 `reason` 里**：「（`O` 按**原点** (0, 0) 取：图上没有这个点名，这是解析几何的常用约定，不是图上量出来的。）」—— 面板上那一列就是这份理由，所以不必另开通道。**三条不认约定的情形**（都不猜）：图上**已经有** `O`；题面用**坐标**定义过 `O`；题面用**构造**定义过 `O`（`O为 BD的中点` / 分点那一类）。**最后那条是实测逼出来的**：第一版只挡了坐标，全量单测立刻红了 **6 条**（`namedPoints` 的"O 由系统补建"三条、重名 `O` 的 fail-closed 一条、`namedPointCommit` 一条、`witnessSearch` 一条）—— 说明"题面点名、系统补建"那条路与这条约定**会互相顶掉**，于是把判据交给内核那一处（`ratioParameterFor` 判分点里谁是被算出来的点，不另写一套）。**RED → GREEN**：新 `diagramVerification.origin.test.ts` 三条 —— 端到端（题面点名 O、图上没有 ⇒ 面积核验 `passed`、`actual = 1`、理由里写明按原点取）、图上就有 O ⇒ 不用约定、坐标定义过 O ⇒ 不用约定。门禁：全量单测 **378 文件 / 4459 通过 + 1 todo / 0 失败**（44.82 s，exit 0；+1 文件 = 本批用例）；**全量 e2e 237 通过（2.0 m，exit 0）**；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。**下一件（记下来，本轮没做）**：**外点双切线 / 公切线仍没有产品动作** —— 本轮探过路：动作要新开一类锚点、`analysisRecompute` 那条重算链与内核的"过外点求切线"都得跟着长，不是一轮能收口的，所以**没有硬上**。

> **2026-10-14 Task 19 的桌面那一半：在当前 HEAD 上真的产出了安装包，并做了冒烟启动（仍缺干净/无网机器上的验收）。** 先纠正一条**过期的话**：Task 19 记着"本机没有打包产物"，而工作副本里 `apps/desktop/src-tauri/target/release/bundle/` **早就有 0.1.0 → 3.3.13 的一串 MSI**（最新一条 2026-10-11 16:23）—— 但它们**早于当前 HEAD**（源码在那之后又动过），所以那一批不能当当前版本的读数。**本批重跑** `npm --workspace @draw/desktop run bundle`：**exit 0**，cargo `release` **38.86 s**，产出两个包 + 一个可执行文件（**当前工作树，干净**）：`MathCanvas_3.3.14_x64_en-US.msi` **6.71 MB**（SHA256 `77A98F52…`）、`MathCanvas_3.3.14_x64-setup.exe` **4.96 MB**（`7FF8E01E…`）、`mathcanvas-desktop.exe` **16.66 MB**（`7F5D51C7…`）。**冒烟启动**（跑的是刚构建出来的那个 exe，**不是**安装包）：进程活着、窗口标题 `MathCanvas`、`CloseMainWindow` ⇒ **优雅退出 code 0**（与仓库早已记过的"冒烟启动 → 响应正常 → 优雅退出 0"同一条口径）。**仍未做（如实记）**：① **干净/无网机器上的发行验收** —— 本机没有第二台干净机器，这一条不可能在本轮满足；② **在本机安装 MSI/NSIS** —— 那要管理员权限并**改动这台机器**，没有用户明确同意我不做（旧记录里也把这一条列在"仍未做"）。**门禁**：本批**不改代码**，所以单测/e2e 读数沿用上一批（377 文件 / 4456 通过 + 1 todo / 0 失败；e2e 236/237，唯一一条是已记过的负载敏感抖动、单独跑绿）；本批新增的读数是打包与启动那两条。

> **2026-10-14 收口 Task 12 的边界「两支角合法时另一支未披露」：没取的那些支现在写进假设。** 边界原文逐字：「两支角合法时**另一支未披露**」。**先量清了它到底指哪两支**：求解器 `foldAnglesForTargetDistance` 其实**算得出**两支 —— `A·cosθ + B·sinθ = d² − K` 闭式至多两支角；只是 `solved` 那一档只返回**允许区间（0°, 180°] 内**的候选，另一支（`360° − θ`，也就是"朝折痕另一侧折"）被区间过滤掉了。**而它同样满足题面那个距离**：用户那道题（`PC=4√3`）里目标点 `C` 在底面内，`P(−θ)` 与 `P(θ)` 关于底面镜像，到 `C` 的距离自然相等 —— 只写一支，用户会以为"折角只有这一个解"。**修法不新写判据**：拿**同一个求解器、把区间放开**再问一次，差集就是"合法但没取"的那些支；假设文案改成「…把它**反求**出来，得到折角 90°。**另外还有 1 支折角（270°）同样满足题面那个距离（差别只在朝折痕另一侧折），系统没有取它们。**」。**先红后绿**：新 `planCompiler.foldBranches.test.ts` 用用户原话逐字跑一遍完整 `compilePlan`，判据全部自己算 —— 落盘 `|PC| = 4√3`、**放开区间**的那次求解确实给两支、刚好一支没被取、且它出现在假设文案里；同时 `planCompiler.faceRatios.test.ts` 四条旧用例照旧绿（**没有回归**）。门禁：全量单测 **377 文件 / 4456 通过 + 1 todo / 0 失败**（43.54 s，exit 0；+1 文件 = 本批新用例）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；**全量 e2e 236/237** —— 唯一一条仍是 `main-thread-responsiveness.spec.ts:28`（本文件早已按"负载敏感抖动"记过；这次报的又是它自己的**标定探针**"故意阻塞 200ms 却没在帧间隔上出现空档"），**单独跑 1 passed** ⇒ 按本仓口径**记为抖动、不说成全绿**。**仍记的边界（Task 12）**：更一般目标关系（不是"固定点到旋转后点的距离"）的区间搜索未做。

> **2026-10-14 收口 Task 11 的边界「`∠A` 单字母角不认」：单字母角现在靠形状从句的环落成三个点名。** 边界原文逐字：「`∠A` 单字母角不认」。三条角读取器都要三个点名（`∠ABC`），而卷面上 `∠A=60°` 更常见 —— 它只给一个点名，**两条边是哪两条**要看**形状从句的环**（`平面三角形ABC中` ⇒ 顶点 `A` 的邻点是 `C` 与 `B`）。修法与"底面"那条**同一个形状**：读取器先留占位（`STATED_VERTEX_ANGLE`），整句解析完由 `resolveStatedVertexAngle` **问形状从句**（环的解析只有 `parseShapeClause` 一处）；**问不出来就不猜**（没有形状从句 / 环少于三点 / 顶点不在环上 ⇒ 挪进 `unverified` 并说清"不知道是哪两条边"）。判据与构造**一个字都没改**：落成 `[前一个点名, 顶点, 后一个点名]` 之后走的就是既有的 `planarAngle`（核验器量内部角、内核 `deriveAngledTriangleBase` 构造）。**RED → GREEN**：两条正向用例先真红（`expected undefined to deeply equal [ 'C', 'A', 'B' ]`），另加四条守卫（三点名写法照旧走前面那条、没有形状从句、顶点不在环上、`0°/180°` 读不出）⇒ `diagramObligations.test.ts` **58 通过**。**另有一条端到端读数**（新 `singleLetterAngle.test.ts`）：题面 `平面三角形ABC中，AB=8，∠A=30°，BC=4` ⇒ `verified_instance`，测试**自己从坐标量** ∠A = 30°。**一处如实**：那条用例的**第一版题面我写成 `AB=8，∠A=60°`（只有一边一角）**，实测拿到 `underdetermined-planar`（*"C：角已经点名，但缺一条定长 AC"*）—— 欠定不画是本层**有意**的行为、不是缺陷；它反过来证明**角真的被读进去并参与了推理**（否则报的会是"读不出这个角"）。门禁：全量单测 **376 文件 / 4455 通过 + 1 todo / 0 失败**（44.51 s，exit 0；+7 = 本批用例，含新文件）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）；**全量 e2e 236/237** —— 唯一一条是 `main-thread-responsiveness.spec.ts:28`（本文件早已按"负载敏感抖动"记过的用例，这次报的是它的**标定探针**："故意阻塞 200ms 却没在帧间隔上出现空档"），**单独跑 1 passed** ⇒ 按本仓口径**记为抖动、不说成全绿**。

> **2026-10-14 收口 Task 14 的边界「弦长/面积未接」：弦长读得出来；面积那一半实测**本来就通**。** 边界原文只有四个字、没有修法方向，所以**先量后改**。**① 面积不是解析缺口**：`△OAB的面积为3` 今天就被读成 `area`（三个点名 + 值；Task 11 起核验器按 `½|OA×OB|` 从**最终坐标**自己算）—— 核不核得出来只取决于**图上有没有点名 `O`**，那是作图那一侧的事，不是解析。**② 弦长是真缺口，而且比"未核验"更糟**：`弦 AB 的长为 3` 这种卷面常见写法，两条既有读取器（`AB=3` 与面积）都不认，而这句里**没有 `=`** ⇒ 残留扫描器的触发词也够不到它 ⇒ **静默丢掉一条题设**（既不进 `givens`、也不进 `unverified`，用户与判据都看不见它存在过）。本仓把"静默丢掉一个条件"当最贵的一类错，所以补的是**读取器**：新增 `弦 AB 的长为 n`（连接词 `为/是/＝/=` 都收）与 `|AB|=n` 两条；判据**复用 `fixedLength`**（两个点名之间的距离，核验器那一侧早有判据，**不新造**），根号写法（`弦 AB 的长为 3√2`）照收。**RED → GREEN**：三条用例先真红（实测读数就是 `expected [] to deeply equal [ [ 'AB', 3 ] ]`），转绿后 `diagramObligations.test.ts` **52 通过**；另有一条**记录实测**的用例钉住"面积那一半读得出来"，免得下一轮又把这句话当成缺口重查一遍。门禁：全量单测 **375 文件 / 4448 通过 + 1 todo / 0 失败**（44.06 s，exit 0；+4 = 本批用例）；**全量 e2e 237 通过（1.9 m，exit 0）**；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。**仍记的边界（Task 14）**：`△OAB` 这类面积核验要求**图上真有那个点名**（作图侧）；反例那一侧的浏览器读数是 fail-closed 而不是"面板上出现一条红"（后者在单测里）。

> **2026-10-14 收口 Task 16 的边界「3D 虚实线 DOM 读不到」：隐藏棱的虚线**画了几段**现在能被画布证据读到。** 边界原文：「**3D 虚实线**在 Three.js 内部、DOM 读不到（这一层只给相机可见性与标签）」。修法一处、**不重算**：虚线是 `createSolidGroup` 按显示开关建出来的（那个 `userData.visualRole === "hidden-edges"` 的 `LineSegments`），所以**由真的建了它的那一层**（`threeSceneContent` 的同步）把它数一遍（段数 = 顶点数 ÷ 2），并把 `hiddenEdgeSegments` / `hiddenEdgesShown` 写进**场景容器的 dataset** —— 与既有的 `dataset.sceneSyncs` 同一个位置、同一条纪律（DOM 上的数由建它的那一层写）；`threeScene.tsx` 只转述，`canvasEvidence` 新增 `hiddenEdges: { shown, segments }` 与两个属性 `data-canvas-hidden-edges-shown` / `data-canvas-hidden-edges`（缺省如实"没画、0 段"，**不编一个数**）。**为什么"开关"与"段数"必须分开报**：只报开关的话，「开关开着、画面上其实一段都没建出来」看起来也正常。判据只读**已经建出来的 group**，不在这里重算"哪几条棱算隐藏"（那会变成第二份真相）。**RED → GREEN**：两条用例 —— `threeSceneContent`（开关开 ⇒ 段数 **> 0**；关掉再同步 ⇒ 如实 **0** 段且 `shown=false`）与 `canvasEvidence`（`shown` 与段数分开报、缺省是 `false`/`0`）。门禁：全量单测 **375 文件 / 4444 通过 + 1 todo / 0 失败**（44.31 s，exit 0；+2 = 本批用例）；**全量 e2e 237 通过（1.9 m，exit 0）**；`lint` 0 error / 13 warning（基线）；`typecheck` exit 0（**一处如实**：首跑红了一条 `keepContent` 的返回类型是 `Object3D | null`，已按真实返回类型收紧）。**仍未做（Task 16 的其余边界）**：把点名转出视锥需要把相机推近到实体内部、产品入口没有确定性做法；**"取消拖动"不是现有产品动作**；教师/学生可读性签收未做（属发布门禁那一侧）。

> **2026-10-14 收口 Task 15 的边界「函数∩直线的交点数」：题面写的交点个数**现在进核验面板**，而且是从**图上那条曲线**自己数出来的。** 边界原文：「函数与直线的**交点数**尚未有义务种类与匹配器 ⇒ 真题里"多交点"那一型的产品入口仍是作图 + 内核读数，**未进核验面板**」。三处齐：**① 义务与读取器**（`diagramObligations` 新种类 `functionLineIntersections`）：`直线 y=0.5 与 f(x)=sin x 的图像有三个交点` / `f(x)=x³−3x 的图像与直线 y=1 恰有 2 个交点` / `直线 x=2 与 …有一个交点` 都收 —— 斜截式 / 水平线 / 竖直线三条线形与圆锥曲线那一族**同一套写法**（连"水平线后面不许再跟 `x`"那条守卫都一样），个数**中文与阿拉伯数字都认**。**两处实测踩出来的细节**：(a) 个数必须写在**前瞻**里、只占用「直线 …」那一段 —— 中间那段 `f(x)=…` 已经被函数定义那条读取器按**字符占位**收走了，吃进来会让这条读取器因"重叠"整条跳过（首版就是这么红的）；(b) 数字后面加了 `(?![eE][+-]?\d)` 防**半读**：`y = 1e-12` 若被读成 `y = 1`，得到的是一个**看着成立、其实换了条件**的义务 —— 宁可读不出（落未核验），这条另有专门用例钉住。**② 判性**（`obligationIR` 的 `JUDGED_KINDS`）：个数是整数 ⇒ 容差只能是 **0**（"3 个"与"4 个"之间没有"差不多"可讲）。**③ 判据**（`diagramVerification` 的 `functionLineIntersections` 支）：调内核 `functionLineRoots` 数**图上那条曲线**与题面那条直线的交点（代数路径给精确根、数值路径带 `complete`），不读构造过程留下的量；**`complete === false` ⇒ 未核验而不是 failed** —— 数值路径自己说"这个个数不能当个数用"（分辨不出的近重根，用的就是内核已记的 `cos x − 1 + 1e-12` 那一形）时，报"个数不对"就是拿一个算不准的量去指责用户；竖直线这一档如实留白。**RED → GREEN**：四条读取器用例（含"没写个数就不产这条"的反向）与三条判据用例（个数对 ⇒ passed、个数说 4 个而图上 3 个 ⇒ failed、分辨不出 ⇒ 未核验）先真红后转绿。门禁：全量单测 **375 文件 / 4442 通过 + 1 todo / 0 失败**（51.36 s，exit 0；+8 = 本批用例）；**全量 e2e 237 通过（2.2 m，exit 0）**；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。**一处如实**：本批 e2e 是**一次跑绿**；上一批（斜棱柱倾角）同机连跑三次各红一条负载敏感抖动、那两条各自单跑都绿 —— 两批的差别只在当时的机器负载，两条用例本身都不是回归。**仍未做（Task 15 的其余边界）**：代数档只到二次多项式；`complete` 是数值完备性、不是全区间证明；外点双切线 / 公切线**没有产品动作**（只有内核读数）。

> **2026-10-14 收口 Task 13 的边界「斜棱柱明说倾角」：题面明说的**线面角**现在真的进链，而且**从最终坐标量得出来**。** 修的正是边界里写的那三层，一层不少：**① 读**（`diagramObligations` 新义务种类 `linePlaneAngle`）：`AA′与底面所成角为45°` 与 `AA′与平面ABC所成角为60°` 两种写法都收；写"底面"时先留一个占位，整句解析完之后由 **`resolveStatedBasePlane` 落成底环点名** —— 底环的解析只有 `parseShapeClause` 一处（形状从句），不另写一套"哪几个点是底面"；**认不出底环就不猜**（挪进 `unverified` 并说清"不知道量哪张平面"）。范围是 `(0°, 90°)`：`0°` 不是角、`90°` 是侧棱躺进底面，都不收。**② 判性 + 用**：`obligationIR` 的 `JUDGED_KINDS` 与角度容差收它；`witnessSearch.statedLateralTilt` **只认"侧棱 + 底面"那一条**（线段两个点名必须是 `X` 与 `X′`、平面点名必须与底环同集合），否则回落代表值 —— 题面完全可能写的是 `A′B 与平面 ABC`，那不是侧棱，拿它当斜向就是替题面改题。**两个角不能写反**：`lateralTiltDegrees` 是**与底面法向**的夹角，而题面写的是**线面角**，两者互为余角（题面 60° ⇒ 法向 30°；代表值 60 的含义正是"代表线面角 30°"）。**③ 核**（`diagramVerification` 的 `linePlaneAngle` 支）：从**最终坐标自己算** `sin θ = |v·n| / (|v||n|)`，不读构造过程留下的量 —— 少了这一层就是"读得懂但没人核"，那比读不懂更糟（这正是边界里写下的那句）。**顺带纠正一处措辞**：题面明说的斜向**不再**写进 `freeValues`（那一列的含义是"系统替你定了什么"）⇒ 新增 `SolidShapeSpec.lateralTiltSource`（`stated` / `representative`），构造层按它决定要不要写那句"系统取代表斜向"。**RED → GREEN**：原来那两条探针钉着"45° 与 60° 取到同一个数"（缺陷）⇒ 先真红，再反向成"45° ⇒ 法向 45°、60° ⇒ 法向 30°"；另加一条**端到端**用例（题面 45° ⇒ `verified_instance`，且测试**自己从坐标量**出 45.0000°）、四条读取器用例（含 `0°`/`90°` 与"没有形状从句 ⇒ 不猜"两条反向）。门禁：全量单测 **375 文件 / 4434 通过 + 1 todo / 0 失败**（46.93 s，exit 0；+5 = 本批用例）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。**一处如实（全量 e2e）**：本批连跑三次，**没有取得一次全绿** —— ① 首跑 236/237，红的是 `geometry3d-drag.spec.ts:103`（取景动画竞态，**单独跑 9/9 绿**）；②③ 复跑各 236/237，红的是 `main-thread-responsiveness.spec.ts:28`（帧间隔阈值被负载顶破，**单独跑 1 passed**）。两条都是本文件早已按"负载敏感抖动"记过的用例 ⇒ 按本仓口径**记为抖动、不说成全绿**。**仍未做（Task 13 的其余边界）**：**面上点**与**展开**（都没有产品入口）；顶点垂足不在中心（有用例、无专条）。

> **2026-10-14 收口 Task 14 的一条边界：非标准曲线的「明确不归类」（不是"没写清楚"）。** 调研 §C 对 `2024 新课标Ⅰ卷第 11 题`的原话是"**非标准曲线**，暂记范围外/跨家族候选，**不伪装成椭圆/双曲线/抛物线**"；而此前的实情是：**曲线方程**（`x²+xy+y²=1` 这类不在标准形式里的）落进**通用**残留文案「原题出现了尚未被可靠解析的几何条件」—— 那句话把**范围外**说成了**没写清楚**，用户会以为换个写法就能被认出来，于是反复改题面。**修法（一处判据、两条路径复用同一句话）**：`diagramObligations.ts` 新增 `CURVE_EQUATION_TERM`（**小写** `x` / `y` 后面跟平方：`x²` / `x^2` / `y²`）与理由函数，两条残留路径（逐句那条与整句 leftover 那条）共用它；命中曲线方程时明说「**没有归入本仓支持的三类标准圆锥曲线**（椭圆 / 双曲线 / 抛物线的标准方程）或 `f(x)=…` 那一类函数式 ⇒ 记为**明确不归类**：不伪装成椭圆 / 双曲线 / 抛物线，也不硬塞成函数图像；**这是范围外**」。**为什么判据是"小写"**：本仓点名一律大写，所以 `AB²=4` 是**线段的平方**、不是坐标变量的平方 —— 第二条用例就是这条**反向**判据（`AB²=4` 照旧走通用文案，不许被贴上"非标准曲线"的标签：那是过度解释，比不解释更糟）。**RED → GREEN**：先真红（实测拿到的是通用那句 `原题出现了尚未被可靠解析的几何条件，未核验。`，两条断言都挂）→ 修后绿（`diagramObligations.test.ts` **40 通过**）。门禁：全量单测 **375 文件 / 4429 通过 + 1 todo / 0 失败**（45.83 s，exit 0；+2 = 本批两条用例）；全量 e2e **237 通过**（2.0 m，exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。**仍未做（Task 14 的另一半边界）**：**弦长 / 面积未接**。

> **2026-10-14 Task 20 第二批（免授权）：适配器不再只是"发一次请求"—— 它走完产品同一条编译路径，失败落在**层**上；顺带修掉一条会让付费那一跑"看起来在跑"的真缺陷。** 三块：① **真缺陷（P1，已修，先红后绿）**：`examRunAdapter` 上一版给规划器的请求是 `{ run, userMessage } as never`，而**真实**的 `createModelPlanner().plan()` 头一件事就是读 `request.model.context`（`apps/web/src/agent/modelPlanner.ts:369`，后面还要 `budget` / `signal` / `run`）⇒ **在任何请求发出之前**抛 `TypeError`。后果不是"跑失败"，而是更坏的一种：付费那一跑会**看起来在跑**、36 条全记 `error`、**一个 token 都没花**，而报告里的 pass@1 = 0 看不出是"根本没发出去"。修法：请求改由 `planRequestFor`（= `buildPlanRequest`，与产品那一次同一份形状）组装。**RED 读数**（把旧实现换回去单独跑那条用例）：`expected [] to deeply equal [ 'p-bench' ]` —— transport **一次都没被调用**；GREEN 后 transport 收到 1 次，且那次请求里带的是**这道题的题面**。② **补上计划点名、而上一批"没有落点"的那四层**：计划原文要的是 plan / schema / 构造 / 核验 / 可读性**五层**的失败分布，上一批只覆盖了 planning 一层。现在一次试验 = **规划 + 编译**（同一个 `compilePlan`：六层编译 + 题设核验），新增 `ExamFailureLayer`（`plan` / `schema` / `construct` / `verify`）与**唯一一处**判定 `examTrialVerdictOf`：模型没给计划 ⇒ `plan`；前四层编译被拒（transport / field_audit / reference_resolution / parameter_completion）⇒ `schema`；后两层（geometry_validation / action_compile）⇒ `construct`；编译过了但**题设核验不是 `passed`** ⇒ `verify`（与产品提交闸同一条判据：`hostBridge` 那条 `unverified_diagram`）。**层名只看第一条错误诊断**，编译器没给原因时**不编层名**（报告里如实少一栏，而不是猜一个把账凑平）。③ **"这一轮没走协调器"落成一个字段**：报告新增 `repairPath`（本适配器一律 `not-driven`），并且**声明与观测矛盾就抛**（说了没走协调器、却记下"同轮修复"）—— 于是 `repairedCount === 0` 的含义只有"这一轮没走协调器"，不许被读成"产品没有修复过"。**顺带把工作区次序收成一处**：新增 `agentRunner.planWorkspaceFor`（三维优先、其次平面），协调器的 `prepareWorkspaceFor` 与评测**共用同一处判据**；评测在编译前按同一次序换一份空文档（否则"计划要求另一个工作区"会被编译器的守卫拒掉，而产品那边它本来能成）。门禁：全量单测 **375 文件 / 4427 通过 + 1 todo / 0 失败**（44.85 s，exit 0；+5 = 本批新增用例）；全量 e2e **237 通过**（2.0 m，exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning（回到基线 —— 中途曾多出一条 `PlanEnvelope` 未使用，已删）。**一处如实**：本批第一次跑全量的命令形态报过 `exit 1` 而摘要全绿（375 文件 / 4422 通过 / 0 失败），复跑与重定向形态都是 `exit 0` —— 按本仓口径记为调用形态的假红，不记为读数。**未做（仍记）**：**付费实测未跑**（**仍未授权**：36 个请求 / 最高 $12，冻结表 `authorization.status` 仍是 `pending`）；**修复回路本身仍未接**（协调器的修复标记不在这个端口上 ⇒ 真跑时 `planned_after_repair` 不会出现，报告里已如实写明 `not-driven`，不许把"没接"读成"产品没修复"）。

> **2026-10-12 Task 20（四族真实模型质量）免授权那一半完成（五块：① 事先冻结 ② 授权闸 ③ 离线分布 ④ 执行与记账层 ⑤ 产品侧适配器）；付费那一步停在授权门口，未获授权不跑、不跳到 Task 21。** 三块：① **事先冻结（计划写死的先决条件）**：新 `packages/agent-core/src/benchmark/frozenThresholds.ts`（+ 7 条用例）把四族的样本**按题号**冻住 —— 开发集 8 条（`exam-*`）+ 留出集 4 条（`held-*`），逐题带 `offlineAttemptability`；每族的验收线也事先写死（pass@1 ≥ 0.5、pass@3 ≥ 0.75、人评 `unreadable` ≤ 0.2、延迟 p95 上限 120/120/150/240 s、单题费用上限 $0.25 / $0.25 / $0.25 / $0.40），并记 `frozenOn: 2026-10-12`、`paidRuns: 0`。**"事先冻结"这件事是可证的**：判据要求 `paidRuns === 0`，跑过付费观测之后再谈冻结直接拒 —— 不然"阈值"就是看完结果挑的一个好听数字。② **计划的停止条件落成一个函数**：`assertPaidRunAllowed` 四道门 —— 先冻结、**先授权**（`authorization.status === "granted"`）、额度写清（`maxRequests`/`maxCostUsd` 都是正数且 `grantedBy` 有人）、**这次请求不许超**；缺任何一道都拒。**默认 `pending` ⇒ 一个请求都不发**（用例先红后绿：未授权一律拒、点头后超一个请求也拒、超一分钱也拒、缺额度栏也拒、`paidRuns > 0` 也拒）。③ **离线失败分布（不发任何请求）**：新 `apps/web/src/agent/fixtures/frozenThresholds.local.test.ts` 拿**真实的 `matchLocalIntent`** 逐条核对 12 道真题题面，实测 **triangle 0/3、conic 0/3、function 0/3、solid 1/3** 会被本地规划器**回应**；而唯一被回应那一条（2023 新课标Ⅰ卷 18：`正四棱柱中多条棱上的点构成的空间关系。`）拿到的是**夹具那只正棱柱**，不是这道题 —— 该用例自己的 `requiredFigure` 恰好写着"不能用假定立方体遮蔽原题条件"。所以 **12/12 都仍需真实 provider 判定**；计划点名的五层（plan/schema/构造/核验/可读性）离线只拆得出 planning 一层，其余四层**无从谈起**（不是"通过"）。**授权请求（等你点头）**：**36 个请求**（12 题 × 3 次独立试验）、**最高费用 $12**（最坏 $10.35，留余量）。**④ "授权一到就能跑"已经建好**（新 `packages/agent-core/src/benchmark/examEvaluation.ts` + 8 条用例，**零网络**）：`examRequestPlan` 把请求清单打成一行可复算的 JSON（`{"cases":12,"trialsPerCase":3,"requests":36,"worstCaseCostUsd":10.35,…}`）；`runExamEvaluation` **第一件事就是 `assertPaidRunAllowed`** —— 未授权时 `runCase` **一次都不被调用**（用例先红后绿），跑完还会核对实际费用是否超授权上限；`summarizeExamEvaluation` 把记账口径写死：**pass@1 = 第一次就成**、**pass@3 = 三次独立里至少一次成**、**同轮修复成功单独一栏**（不许混进上面两个）、**人评没标就是 `null`**（不许当可读，也不许当 0）、**阈值只对照不改写**（用例断言冻结表逐字不变）、**少跑一条或缺一个试次就抛**（不是"按有的算"）。门禁：全量单测 **375 文件 / 4422 通过 + 1 todo / 0 失败**（128.13 s，exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning；`docs-consistency` 4 文件 12 通过。**⑤ 产品侧适配器也接上了**（新 `apps/web/src/agent/fixtures/examRunAdapter.ts` + 4 条用例，零网络）：`createExamRunCase` 调一次产品侧规划器端口（`createModelPlanner()`），把结果按**唯一一处**映射（core 的 `examTrialOutcomeOf`：计划 / 问路 / 回了一段解释 / 抛错各一档）记成试验结局；**费用由注入的 `costOf` 给**（这一层不编价格）、**抛错记 `error` 并带上原文**（不吞成"没跑"）。**如实记的边界**：修复发生在协调器的编译回路里、端口这一层看不到 ⇒ 这条适配器一律 `repaired: false`，真跑时 `repairedCount` 会是 0；要么把协调器的修复标记接进来，要么在报告里读成"这一轮没走协调器"。门禁：全量单测 **375 文件 / 4422 通过 + 1 todo / 0 失败**（128.13 s，exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning。**未做**：真实 provider 的 pass@1/pass@3/人评/延迟/费用读数 —— **未获授权前不跑，也不跳到 Task 21**（计划原文：*"未同意请求数和最高费用，或样本/阈值未预先冻结，就停在 Task 20"*）。

> **2026-10-12 Task 19（Lean 固定工具链、安全与发行）完成本机那一半；真桌面发行验收未做，因此不标"已发布自动证明"。** 三块：① **先固定现状（只读、零下载）**：新 `scripts/proof-spike/lean4Pin.test.ts`（4 条）把 `proof/lean4/` 的工程定义钉住 —— `lakefile.toml` 的 mathlib rev == `lake-manifest.json` 的 `rev` == `inputRev` 且必须是 **40 位 commit**（不是 `master`）、URL 是 mathlib4、`lean-toolchain` 是具体版本不是 latest、**README 必须写出当前钉住的 commit 且不许再说过期的话**（这一条**先真红**：旧 README 还写着"manifest 不进仓库""换台机器复跑不保证同一份 mathlib"，与 2026-10-10 已钉住的事实矛盾；现已改写成"依赖闭包是钉住的"，并保留两条真实代价：首次要下 GB 级东西、工具链不随包）。**实测读数**：直接工具链与 `lake env lean --version`（在 `proof/lean4` 里）给出**同一个**串 `Lean (version 4.35.0-rc3, …, commit 470d5ce1400764999581fd26d5d72b00d990b0f4, Release)`；`~/.elan/toolchains/` 下 v4.34.1 与 v4.35.0-rc3 都在；`.lake` 展开 **7.00 GB**（mathlib olean **8615** 个、`Mathlib.olean` 在位）⇒ **本机缓存已在，本批没有触发任何下载或升级**（**停车条件未触发**；换机器时的首次下载仍需单独征得同意）。② **安全判据复核（既有，本批一行没改）**：三份定向测试 **74 通过** —— `sorry` 拒、用户自定义 `axiom` 拒、报告缺失拒、报告属于别的定理拒、形状不认识拒、**exit code 单独不算数**、编译错 `failed`、墙钟超时 `timeout`，"模板生成的 import/定理名 ↔ Rust 白名单"**双向**一致；Rust 侧 `npm run test:rust` **250 通过 / 0 失败 / 3 ignored**（17 个套件：能力集最小、只暴露具名 IPC、无通用命令、CSP、密钥无明文出口…）。③ **真后端实测**：`npm run proof:smoke` **8 通过**（打出十栏后端审查：版本/许可证（读自工具链目录）/`child-process` 进程模型/原生依赖清单/启动预算/两层超时策略/`sorry` 与自定义 axiom 的失败行为/缓存与沙箱 —— **强沙箱下证明运行"未测"如实写着**）；`npm run test:lean` **8 passed / 1195.4 s**：冷启动单独量 **219.5 s**，四类目标各 ~62 s 全部 `formally_proved / verified / exit=0` 且公理**恰好** `["propext","Classical.choice","Quot.sound"]`，`sorry` 那次 **exit=0 而判 `failed`**（在真实后端上再证一次"退出码不算数"），窄 import **64.4 s** vs `import Mathlib` **588.4 s**（成本纪律有读数）。门禁：全量单测 **371 文件 / 4400 通过 + 1 todo / 0 失败**（127.63 s，exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning；`docs-consistency` 4 文件 12 通过。**未做（如实记，也是本任务唯一未做的一块）**：**打包后在干净/无网的桌面上的验收**（本机没有打包产物，也没有另一台干净机器）—— 所以本任务**只主张"本机真跑绿 + 判据齐 + 工程定义钉住"**，**不主张"已发布/已发行"**；"明确不可用仍能画图"另有浏览器证据（Task 18 的 `e2e/agent-proof-lifecycle.spec.ts` 2 passed）。**下一项是 Task 20（四族真实模型质量）—— 它的先决条件是付费 provider 授权，属计划写死的停车条件**：未获授权就停在这里如实报告，不自行发起任何付费请求。

> **2026-10-12 Task 18（证明产物异步绑定与可读 UI）完成**。四块：① **一次异步证明"回来时还算不算数"**（`packages/agent-core/src/proof/proofArtifact.ts` 新增 `ProofAttemptIdentity` + `proofAttemptStaleness`，RED 7 条先红后绿）：身份是**草稿 id + 内容哈希 + 版本 + claim + 目标条件出处 + `inputHash` + 后端版本**，判据**看哈希不看版本号**（暂存同一份内容不算过期），六档分开 —— `draft_replaced`（切工作区/导入别的文档）、`document_changed`（**改题/改图/撤销**）、`claim_replaced`、`condition_replaced`（目标句出处的原文条件换了）、`input_changed`（命题/假设变了）、`backend_replaced`（换了工具链）；**没绑内容哈希一律过期**（fail-closed），**没捕获的那几栏不参与判定**（拿不到就不许拿它当判据）。与 `verifyProofArtifact` 的**分工写在注释里**：那条判**命题一级**（刻意不绑文档指纹，R51/R56 的裁决：绑了会把"普遍成立"降级成"这一次实例"，还会被改个 `label` 刷成假过期），这条判**这一轮/这一份图** —— 所以 `document_changed` 的措辞是"**这一轮的 claim 不能凭它升级**"，**不是**"那条命题不再成立"，两句话分开放着。② **草稿层接上**（`draftStore.ts`）：证明块**发起前捕获身份、跑完复查**；`previewOf` **每次都重新判一次** —— 后续 `stage` 让候选内容变了而证明块没被重写时（改题之后新题面读不出可核验题设那一类），那一栏会翻成 `stale`（`draftStore.test.ts` 有用例先红后绿），过期时只改结局与理由、**不抹掉产物**。③ **界面分档**（`ConfirmationPanel.tsx`）：标题按 Task 17 的范围报告写"**受限引理已证（不是整道题）**"/"原题完整证明"/"**过期（这份结果说的是另一张图）**"，并列出**没进命题的题面条件**与过期原因；`data-proof-scope` / `data-proof-stale` 供读数。④ **e2e**（新 `e2e/agent-proof-lifecycle.spec.ts`，**2 passed**）：浏览器里没有桌面工具链 ⇒ 那一段如实说"没跑成"（不是"证不出来"、更不是"已验证"）、范围报告列出 `BC ∥ AD` 这类没进命题的条件、**确认按钮可用且真的提交成功**（**证明不可用不挡作图**）；开关关着 ⇒ 那一段**根本不存在**、同样提交得掉。为此新增夹具题面 `PROOF_GOAL_PROMPT`（同一只四棱锥 + 一句可形式化的目标）；**实测踩到一条**：`localPlanner.isAnalysisQuestion` 认"求"字 ⇒ 题面里必须留作图动词（"画出这个四棱锥"），否则本地规划器把整句当"只在问读数"、面板根本不出现。门禁：全量单测 **370 文件 / 4396 通过 + 1 todo / 0 失败**（125.98 s，exit 0，**单独跑**）；全量 e2e **237 通过**（2.6 m，0 抖动）；计划点名的六份单测 **92 通过**、那条 e2e 命令 **9 passed**；`typecheck` exit 0；`lint` 0 error / 13 warning；`docs-consistency` 4 文件 12 通过。**仍记的边界**：**桌面真实开旗 → 一次 Lean → 改题/撤销 ⇒ 标 `stale`** 的 UI/IPC/版本证据**没有做**（本机没有桌面壳与 Lean 工具链）—— 它的判据在单测里钉住（7 + 1 条），**不拿 mock 冒充真跑**；那一段真正的验收位置是 Task 19 的桌面/发行那一节。设置入口与"只写自己那个键"沿用既有证据（`next-phase-flag-entry.spec.ts` 7 passed），**没有新建第二个偏好存储**。**下一项是 Task 19（Lean 固定工具链、安全与发行）** —— 按计划它的文件清单与停止条件都写着"**首次下载、升级 mathlib、复制缓存或改变桌面发行体积需单独征得用户同意**"，到那一步会停下如实报告、**不自行授权**。

> **2026-10-12 Task 17（Lean 原题前提与受限引理分级）完成**。新模块 `packages/agent-core/src/proof/proofScope.ts`（+ `proofScope.test.ts` 8 条，**先真红：模块不存在**）交付 `ProofScopeReport` —— **"这一次到底证了什么"**：每一条原题条件落四档之一（`formalized` 进了命题假设 / `dischargedByNamedDerivation` 由一条**点名定理**从它一步推出，定理名必须写出来 / `figureAssumption` 只是**图上这一个实例**满足 / `notRepresented` 连读都没读出来），带原话 span（id 与区间**直接取自 `buildObligationIR`**，不另写一套编号）与系统替用户做的选择（R51）；结局只有 `limited_lemma | whole_problem | unsupported`，**默认受限引理**。判据逐条有读数：① 题面多一条必要条件（`AB=2`）⇒ 产物照样出、模板定理照样成立，但 `AB=2` 被列在命题之外、结局受限引理，说明文案也写着"受限引理"；② 由性质定理一步推出的题设归 `dischargedByNamedDerivation` 并写出那一步叫什么；③ 前提指不出出处 ⇒ `unsupported`（连命题都不生成）；④ 面 ⊥ 面这类**没有模板** ⇒ `unsupported`（读目标时就拒，不混线⊥面）；⑤ **后端没验过 ⇒ 永远不是整题**（`sorry`、表外公理那一档在此被挡）；⑥ `fromFigure` 的图上前提如实标出，并说清那些点名**在图上有没有真的物化**；⑦ 整题级要"逐条条件都进命题 + 调用方**显式交出**完整命题产物声明 + 后端验过"，而且**系统补的图上前提会挡住它**。**接进产品路径**：`AutomaticProofResult.scope` 做成**必填**（每一条返回路径都得交出"证的是哪一档"，没有一条能省掉这句话），`verified` 那次的说明文案改成"证的是**受限引理**，不是整道题"（经 `automaticProofStage` 的 `detail` 到面板）；范围报告建不起来时如实给 `unsupported` 而**不编**。**四受限目标的原例继续有效**：`packages/agent-core/src/proof` 全目录 **11 文件 / 172 通过**，计划点名的五份 **51 通过**。门禁：全量单测 **370 文件 / 4386 通过 + 1 todo / 0 失败**（128.65 s，exit 0；**一处如实**：同批把全量 e2e 与全量单测并发跑时，单测出现过一次 CPU 饥饿导致的假红（342 文件 / 1 失败 / 28 errors），**单独复跑为 0 失败** —— 上一批也撞过同一个现象，不再把它当读数）；全量 e2e **235 通过**（3.1 m，0 抖动）；`typecheck` exit 0；`lint` 0 error / 13 warning；`docs-consistency` 4 文件 12 通过。**仍记的边界**：① **`whole_problem` 在产品路径上不可达** —— 本仓还没有一份完整原题的 Lean 命题产物，所以没有调用方交得出那份声明（这正是计划"没有新的完整原题 Lean 命题产物，不勾 whole_problem"的代码形态；规则本身有用例证明它只在"条件全进命题 + 显式声明 + 后端验过"时才可能出现）；② **"题设与图互相矛盾"没有在范围报告里单独判** —— 矛盾由核验器那一侧判，范围报告只做条件分类，如实记着；③ 证明的**异步/迟到/版本绑定与面板分档显示属 Task 18**，本任务只把字段与那句文案送到产品路径上；④ **没有发起任何付费 provider 请求**，本任务全程离线（Lean 后端在本机默认不可用，产品路径照旧如实报"没配工具链"，不阻塞作图）。**下一项是 Task 18（证明产物异步绑定与可读 UI）**。

> **2026-10-12 Task 16（真实画布和过期证据）完成**。两块：**① 画布证据面 + 过期判据**；**② 修掉本任务读数抓出的一条真缺陷（同一串字母被画两遍）**。① `packages/agent-core/src/verification/renderEvidence.ts`：`RenderEvidence.documentHash` 变**必填**并纳入 `evidenceIdentityProblem`；新增 `renderEvidenceStaleness` —— **看内容哈希、不看版本号**（暂存同一份内容不算过期），`document_changed`（**改题/撤销**）与 `draft_replaced`（**切文档**）分开，**带截图也不改变结论**（"截图不能替代条件回代"的另一种形态）。RED 5 条 → **22 通过**。② 新 `apps/web/src/canvasEvidence.ts`（接进 `GraphicsView.tsx` 的 SVG 与 `threeScene.tsx` 的场景 div）：每个数都从**已经渲染出来的 DOM** 上量（2D 读图元几何属性、3D 读标注覆盖层），诊断交给既有 `diagnoseLayout`（`label_overlap`＝点名遮挡、`clipped_object`＝出画布），画布根元素挂 `data-document-hash` / `data-canvas-boxes` / `data-canvas-labels` / `data-canvas-diagnostics` / `data-canvas-diagnostic-errors` / `data-canvas-hidden-labels` / `data-canvas-objects-measurable`；**3D 如实标 `objectsMeasurable=false` 且不许报 `empty_canvas`**（把"量不到"说成"画布是空的"就是假报警）。RED→GREEN 7 条。③ 新 `e2e/agent-exam-visual-and-stale.spec.ts` **6 passed**（35.5 s，**四族各一次** + 三向反例）：画布自报的哈希 == **测试自己**按 `canonicalContentHash` 口径规范化（键排序、丢视图/时间字段、`undefined` 视同没有）后用 **`crypto.subtle`** 摘要的那一份 —— 规范串自己算、摘要走平台实现，两边一致才叫"画布渲染的正是这一份文档"；**撤销** ⇒ 哈希变 + 画布如实报空 + 落盘文档里曲线也没了；**改题** ⇒ 换成另一版内容；**视图变化**（缩放 / 切工作区再切回）**不**作废证据。④ **本任务读数抓到并修掉的缺陷**：翻折题落盘 **9** 个 `point3`，`E`/`F` **各带一遍同名标签**（折片 `face-2:v1/v2` 是与边上那两点**坐标逐位相同**的副本）⇒ 画布把同一串字母画两遍（画布证据如实报 `label_overlap`）、文档里"E 是哪一点"也有歧义（`resolveFlapVertices` 自己就是后写覆盖）。**修法两层**：`compileSolidFold` 新增 `suppressedNames`（**折痕两端在原图上已有同名点时，折片副本不再挂标签**；新顶点 `P` 照挂；原图没有同名点时**一个都不抑制** —— 反方向有用例守住），RED 先红（`expected [ 'P', 'E', 'F' ] to deeply equal [ 'P' ]`）后绿；渲染层同时不再拿**图元 id 当名字**画（3D 覆盖层只画有名字的点、2D `<text>` 同一规则 —— 早先没名字的点会顶着 `face-2:v1` 这种内部编号出现在图上）。e2e 收紧成"七个标签、无 `label_overlap`"仍 **6 passed**；受影响旧用例 `workerRuntime.test.ts` 的"带名字的点"改成**恰好四个**（副本仍在、只是没名字）。门禁：全量单测 **369 文件 / 4377 通过 + 1 todo / 0 失败**（128.60 s，exit 0）；全量 e2e **235 通过**（3.2 m，0 抖动）；`typecheck` exit 0；`lint` 0 error / 13 warning；`docs-consistency` 4 文件 12 通过。**仍记的边界**：**3D 虚实线**在 Three.js 内部、DOM 读不到（这一层只给相机可见性与标签）；把某个点名转出视锥需要把相机推近到实体内部，产品入口没有确定性做法（"文档里有名字而画布没画出来"那一支在单测里钉住）；**"取消拖动"不是现有产品动作**（没有 Escape 取消拖动），以"缩放 / 切工作区再切回不失效"这条读数代替；**教师/学生可读性签收未做**（属发布门禁那一侧）。**下一项是 Task 17（Lean 原题前提与受限引理分级）**。

> **2026-10-12 Task 16（真实画布和过期证据）第一批完成 —— 本任务仍在进行中，未勾完成**。三块：① **证据绑内容哈希 + 过期判据**（`packages/agent-core/src/verification/renderEvidence.ts`）：`RenderEvidence.documentHash` 变成**必填**并纳入 `evidenceIdentityProblem`（非法哈希当场拒），新增 `renderEvidenceStaleness` —— **看内容哈希、不看版本号**（暂存了同一份内容不算过期，"什么都没改"不许报成过期），`document_changed`（**改题/撤销**）与 `draft_replaced`（**切文档**）分开说、理由里两个哈希前缀都写出来，而且**带截图也不改变结论**（"截图不能替代条件回代"的另一种形态）。RED 5 条（1 条身份断言 + 4 条"函数不存在"）→ **22 通过**。② **真实画布证据**（新 `apps/web/src/canvasEvidence.ts`，接进 `GraphicsView.tsx` 的 SVG 与 `threeScene.tsx` 的场景 div）：每一个数都从**已经渲染出来的 DOM** 上量 —— 2D 读图元元素的几何属性（`circle` 的 `cx/cy/r`、`line` 的端点、`polyline` 的 `points`），3D 读点标注覆盖层的 `style.left/top`；诊断交给既有 `diagnoseLayout`（`label_overlap`＝**点名遮挡**、`clipped_object`＝出画布、`empty_canvas`＝画布上没有可画的图形），画布根元素上挂 `data-document-hash` / `data-document-revision` / `data-canvas-boxes` / `data-canvas-labels` / `data-canvas-diagnostics` / `data-canvas-diagnostic-errors` / `data-canvas-hidden-labels` / `data-canvas-objects-measurable`。**3D 如实标 `objectsMeasurable=false`**：图形画在 WebGL 里、DOM 量不到，那时**不许报 `empty_canvas`**（把"量不到"说成"画布是空的"就是假报警）。RED→GREEN 7 条。③ **e2e `e2e/agent-exam-visual-and-stale.spec.ts` 6 passed**（35.6 s，**四族各一次**）：画布自己报的哈希 == **测试自己**用 `node:crypto` 按 `canonicalContentHash` 口径（键排序、丢视图/时间字段、`undefined` 视同没有）算出来的那一份 —— **两份实现互相独立**，相等才叫"画布渲染的正是这一份文档"；**撤销** ⇒ 哈希变、画布如实报空、落盘文档里那条曲线也没了；**改题** ⇒ 换成另一版内容（测试自己读落盘表达式确认 `1/x` 进来了）；**视图变化**（缩放、切工作区再切回）**不**作废证据。**本批的新读数抓到一条真问题（待修，属本任务未做完的部分）**：翻折题落盘文档有 **9** 个 `point3`、题面七个点名里 `E`/`F` **各画了两遍**（折片 `face-2:v1/v2` 是另建的面片、带同名标签且与边上那两点位置重合）⇒ 画布上同一串字母被画两遍，`data-canvas-diagnostics` 因此**如实**含 `label_overlap`（判据没失灵，是图上真叠着两个标签）；修法与 RED 记在任务卡上。门禁：全量单测 **369 文件 / 4376 通过 + 1 todo / 0 失败**（126.34 s，exit 0）；`canvasEvidence.test.ts` 7 通过、`renderEvidence.test.ts` 22 通过；`typecheck` exit 0；`lint` 0 error / 13 warning。**仍记的边界**：**3D 虚实线** DOM 里读不到（这一层只给相机可见性与标签）；把某个点名转出视锥需要把相机推近到实体内部，产品入口没有确定性做法（"文档里有名字而画布没画出来"那一支在单测里钉住）；**"取消拖动"这个产品动作不存在**（没有 Escape 取消拖动），本批以"缩放 / 切工作区再切回不失效"这条读数代替；**教师/学生可读性签收**需要人来做，未做。**下一批（本任务剩余）：给折片重合顶点的重复标签补 RED 并修，再把 e2e 收紧成"7 个标签、无 `label_overlap`"**。

> **2026-10-12 Task 15（函数与导数真题纵向交付）完成**。四块：① 新模块 `packages/geometry-kernel/src/function-evidence.ts`（+ 19 条用例，**先真红**）把四个真题形状做成**有读数**的能力 —— **2021 新高考Ⅰ卷 7 题**外点双切线（`(0, 0.5)` 向 `eˣ` 两条、`(0, 1)` 恰好卡在 1 条与 2 条的分界上 ⇒ 报**退化**、`(0, 2)` 如实 `none`、`(0, −1)` 唯一一条）、**2022 新高考Ⅰ卷 22 题 / 2024 新课标Ⅰ卷 7 题**多交点（`sin x = 0.5` 在 `[−5,5]` 三条、`sin x = cos x` 三条，测试自己解 `π/6+2kπ` 与 `π/4+kπ` 回代）、**2024 新课标Ⅰ卷 13 题**公切线（`y=x²` 与 `y=−(x−2)²+1` 两条，斜率 **2±√2**，测试自己算两个切点与截距回代两条曲线）。② **证据分两个字段**：`grade`（`algebraic` 判别式 / `verified-numeric` 数值求根 + 独立回代 / `plot-only` 只有采样折线）与 `complete`（**个数能不能当个数用**）。③ **四类反例先真红后转绿**：**断点被连线**（题面 `(x²−1)/(x−1)` 在 `x=1` 没有定义、图上画成连续的 `x+1` —— 旧判据是"未核验"，现在是**红**）、**错切点**（`|x|` 在 `x=0` 是尖点，旧判据用**中心差分**得到 `(|h|−|−h|)/2h = 0` 于是**放行**一条水平切线；现在由**单侧差商**量出"左 −1 / 右 +1"并红；另有"切点纵坐标不在曲线上"⇒ 红）、**漏近重根**（`(x−1)²−1e-10` 由判别式解出 `1±1e-5`；`cos x − 1 + 1e-12` 这种分辨不出的情形如实 `complete: false`，**不许报"零个根"**）、**参数实例 ≠ 全称**（`judgeUniversalClaim` 把全称主张一律降级成 `at-parameters` + `plot-only` + `upheld: false`）。④ **产品面**：判据 `functionGraph` 新增**断点集合必须一致**（正例 `1/x` 从"未核验"变成 `passed` 并说清断在 `x = 0`）、`tangentAt` 新增**可导性**与**整条直线是否相切**两问；每条函数族读数带 `evidence`；报告新增 `proofScope` / `universalClaims` / `proofScopeNote`，`universalClaims` **只有 `not-proven` 一个取值**，三个字段由 `proofScopeOf` **唯一**产出（`draftStore` 拼旧证据那条路用同一个函数）；面板显示"证据：…"与"证据范围：…"；两道夹具题（`1/x` 断点题、`|x|` 尖点负例）；**新建 `e2e/agent-exam-function.spec.ts`**（2 passed：断点题走完整产品路径、测试自己在定义域上扫 129 点自算"恰好一处没有定义"；尖点题 **fail-closed**，确认面板根本不出现）、扩 `e2e/agent-function-tangent.spec.ts`（两个证据等级 + 范围断言）。**黄金样本有据修订一次**：报告多出的三个字段进了 `planCompiler4707b64.golden.json` —— 重抓前用临时探针**逐字段对读**证明"差异恰好是那三个"（4 个有报告的用例各 3 条路径、`transport-invalid` / `audit-completes-defaults` **零差异**、两种开关形状逐字节相同）并把这条写成断言，样本的修订记录由单个 `revised` 改为 `revisions` 数组（2026-10-10 那条**逐字保留**）。门禁：全量 **368 文件 / 4364 通过 + 1 todo / 0 失败**（125.34 s，exit 0）；两个函数 e2e **3 passed**（26.9 s）、**全量 e2e 229 通过**（2.6 m，0 抖动）；`typecheck` exit 0；`lint` 0 error / 13 warning；`docs-consistency` 4 文件 12 通过。**仍记的边界**：① `algebraic` 只覆盖**多项式且次数 ≤ 2**（判别式给重数结构），次数 ≥ 3 与超越函数走 `verified-numeric`；② `complete` 是**数值完备性**（两个分辨率一致 + 无落进判零带却不变号的格子），**不是**"全区间根数 / 单调性已证明"；③ 函数与直线的**交点数**没有义务种类与匹配器（`diagramObligations.ts` 不在本任务文件清单里）⇒ 真题里"多交点"那一型的产品入口仍是作图 + 内核读数，未进核验面板；④ 外点双切线 / 公切线**没有产品动作**（`function.create_tangent` 只表达"在某个 `x` 处"）⇒ 它们的读数在本任务里是内核 + 单测，真画布验收归 Task 16；⑤ 反例在浏览器一侧的读数是 **fail-closed**（面板不出现），"面板上出现一条红"由单测钉住；⑥ 抽象函数"不能编出唯一图"那句**没有实现**（今天没有产品入口产出这类图像，记成边界而不是造一个隐形判据）。**下一项是 Task 16（真实画布和过期证据）**。

> **2026-10-12 Task 14（圆锥曲线真题纵向交付）完成**。四块：① 先修掉一条 **P0 级真缺陷**（双曲线的 `axis`＝实轴，在采样器 / 隐式形式 / 约束三处实现里与声明相差 90°）；② **代数**直线∩圆锥曲线（判别式给重数，五档 `secant`/`tangent`/`single`/`none`/`degenerate`，**竖直线**单独成支）；③ **条件反求曲线参数**（两焦点+一点 / 焦点+准线 / 焦点+准线+离心率，三种结局 `solved`/`contradictory`/`unsupported` 分开）；④ **`conicChord` 义务与判据** —— 计划点名的「**丢一交点必须真红**」**现在真的会红**（旧实现只会走未核验），并新建 `e2e/agent-exam-conic.spec.ts`（正例走完整产品路径并**自己从落盘坐标算**那两个交点；反例与正例**共用同一份计划**、只把题面里的直线改成 `y=1` ⇒ **fail-closed：确认面板根本不出现**）。门禁：全量 **367 文件 / 4338 通过 + 1 todo / 0 失败**（553.04 s，exit 0）；全量 e2e **227 通过**（首跑有 1 条斜棱柱用例抖动 ⇒ 单独跑 3/3 绿 ⇒ 复跑全量 **227/0**，按本仓口径记为抖动、**不记为绿**）；`typecheck` exit 0；`lint` 0 error / 13 warning；`docs-consistency` 4 文件 12 通过。**仍记的边界**：**弦长/面积未接**；2024Ⅰ-11 非标准曲线的「明确不归类」**已于 2026-10-14 收口**（见顶部同日条目：曲线方程不再落进通用"没被可靠解析"）；反例那一侧的浏览器读数是 fail-closed，而不是"面板上出现一条红"（后者在单测里）。**下一项是 Task 15**。

> **2026-10-12 Task 14 开始：先撞上并修掉一条 P0 级轴向缺陷（双曲线的实轴与声明相差 90°）**。计划写了「新增可复现 P0 故障时先停在当前编号、在该任务下补 RED / 修复 / 旧路证据」，所以这一批只做这件事 —— **Task 14 的主体（代数直线∩圆锥曲线、条件反求、新义务与核验、新 e2e）仍未做**。**① RED**：`packages/geometry-kernel/src/conics.test.ts` 新增「双曲线的 axis 语义（实轴，不是参数方向）」2 条，先真红（`axis=x 的点 (0, 2) 不在这条双曲线上: expected -1 to be close to 1`；`实轴顶点没落在曲线上: expected +0 to be 2`）。**② 根因**：`axis` 的语义在两半代码里是**两套** —— 题面侧唯一声明是「实轴」（`diagramObligations.ts:150` 原文「`x²/… − y²/… = 1` 的实轴沿 x」），核验文案（`diagramVerification.ts:361`）、焦点/顶点标记（`GraphicsView.tsx:79`、`annotations.ts:18`）与那条绿的 e2e 也都按实轴；而**采样器 `sampleHyperbola`、隐式形式 `hyperbolaConicCoefficients`、约束 `hyperbolaConstraint` 三处**按「参数往哪边走」实现 —— 三处**互相自洽**（所以测试全绿、缺陷看不见），净效果是**画出来的双曲线与它自己的实轴、焦点相差 90°**；`planar-constraints.ts` 的旧注释还专门论证过「按字面取是错的」。**③ GREEN**：三处统一到实轴口径 —— `sampleHyperbola` 的参数改扫实轴坐标（`|坐标| < 半实轴` 上没有点，返回 null；domain 取绝对值上界，只看单侧的视野也能画全）、`hyperbolaConicCoefficients` 的 `qxx/qyy` 改为 `±b²`/`∓a²`、`hyperbolaConstraint` 的 `evaluate`/`search`/`tangent` 同步且**切线改用隐式梯度**（顶点处斜率无穷大也成立）；顺带修 `annotations.ts:21` 顶点距离三元式两支写同一个值、新增共用的 `hyperbolaDomain`（`axis: "y"` 时给 y 范围，渲染与导出共用）、更正 `diagramVerification.ts` 里「只认 ellipse」那句过期注释。**④ 旧路证据**：`packages/geometry-kernel` **54 文件 / 753 通过**；`typecheck` exit 0；三个圆锥曲线 e2e **5 passed**（`agent-conic-kinds` / `agent-conic-ellipse` / `agent-conic-invariant`）。**⑤ 全量抓出三处下游**（这正是跑全量的价值）：`App.test.tsx` 与 `scene-graph/curveTangents.test.ts` 的"给每种曲线作切线"红在双曲线（`status` 该是 `approximate` 却是 `undefined`）—— 根因是**约束层在缺口里返回 `null` 会让投影假报"找不到"**；改成「**约束层把参数夹到 ±半实轴**（它必须满射）/ **采样层留空**（折线不能把两支连起来）」后转绿。`scene-store.test.ts` 的"拖到另一支仍留在本支"把旧几何（`u=0 ⇒ (0, ±2)`、`u=6 ⇒ (6, −2√5)`）写死了，按新口径改成**顶点 `(3, 0)`** 与 **`(6, −2√3)`**。另有 **5 条**把旧参数化写死的断言按新口径改正（`conics.test.ts` 2 条形状断言、`curve-tangents.test.ts` 的切线参数集、`planar-constraints.test.ts` 2 条分支断言），每处都注明理由。**仍未做（当时）**：代数直线∩圆锥曲线、条件反求曲线参数、`conicChord` 一类义务与核验判据 —— **这三项已在下方 ⑥⑦⑧ 落地**；**`e2e/agent-exam-conic.spec.ts` 未新建**、2024Ⅰ-11 非标准曲线的「明确不归类」。**⑥ 代数直线∩圆锥曲线已落地**（新模块 `packages/geometry-kernel/src/conic-line.ts` + 同名测试 8 条，先红后绿）：判别式给**重数**，五档分开 —— `none` / `tangent`（重根）/ `secant` / `single`（与抛物线对称轴平行 ⇒ 恰好一个有限交点，**与"相切"分开**）/ `degenerate`；**竖直线**单独成支；每档带 `residual` 与 `tangency` 两样可核读数。**被自己的判据抓住两次**：① 用 `Δ` 绝对值当相切阈值，切点恰在曲线上时 `β²` 与 `4αγ` 同时为 0、阈值塌成 0（旋转椭圆判成 `none`）⇒ 改成**根间距相对根尺度**；② 容差量纲写成 `(1e-9·rootScale)²`，比"切点只有机器精度"带来的噪声还紧（实测 `spreadSquared ~ 1e-16`）⇒ 改成 `1e-12·rootScale²`。`typecheck` exit 0；内核包 **55 文件 / 761 通过**。**⑦ 条件反求曲线参数已落地**（新模块 `conic-parameters.ts` + 15 条判据，先红后绿）：两焦点 + 曲线上一点（椭圆/双曲线）、焦点 + 准线（抛物线，`p = |FL|`）、**统一式** 焦点 + 准线 + 离心率（`e<1/=/ >1` 分别椭圆/抛物线/双曲线）；`contradictory` 与 `unsupported` 分开（前者是题面自相矛盾，后者是这组条件定义不出曲线）；**残差在采样出来的曲线上逐点复核定义式**；轴对齐时报轴对齐（否则核验器比 `axis` 那一条会判成"另一条曲线"）。**三处自查**：`axis:"y"` 的双曲线两个半轴字段是换位的；`ConicLine` 不是 DSL 的导出（`typecheck` 报 `TS2724`）⇒ 复用 `conic-line.ts` 那份；**以及我违反仓库自己记过的纪律一次** —— 用 `Set-Content` 改源码把中文注释写成乱码并加 BOM，已 `git checkout` 恢复并改用编辑工具（教训有效）。`typecheck` exit 0、`lint` 0 error / 13 warning、内核包 **56 文件 / 776 通过**。**⑧ 新义务种类 `conicChord` 与判据已落地**（13 条判据先红后绿）：`…与直线 y=x+1 相交于 A、B 两点` / `…与直线 x=3 相切` / `…没有交点` 读成一条义务（斜截式**或竖直线**；`expectation` 用**代数档位** `secant`/`tangent`/`single`/`none`）。判据两层：① **定性**（题面那条直线与**最终落盘**的曲线交给 `intersectLineWithConic`，判别式给重数，档位必须同名）；② **定量**（代数算出的**每一个**交点，图上都得有个点名落在那儿）。**「丢一交点必须真红」现在真的会红** —— 旧实现只会 `null` ⇒ 未核验、**永远不红**；失败文案逐字给出"代数上确实有 2 个交点（(−3, 0)、(3, 0)），但图上只找到 1 个 —— 丢了 1 个交点"。**错轴那条也红**（半轴一样、轴反了的双曲线与 `y=0` 的交点从 (±3,0) 变成 (0,±2)）。**三处设计决定**：新匹配器**只吃"直线 + 情形"、绝不圈进曲线方程**（解析器按字符占位去重，圈进去会把 `conicAxes` 整条吞掉，有一条判据专钉"两条义务并存"）；**题面点了名才要求图上有点**；平面积点表**另取一份**（`FigureContext.planarPoints` 读 `point` 的 `label`）—— 原有 `candidatePoints` 只从多面体/面片的 `vertexNames` 建，圆锥曲线文档里它是空的（实测会把"两条都画对了"判成"丢了两个交点"）。`agent-core` 包 **77 文件 / 1135 通过**。**仍未做**：**`e2e/agent-exam-conic.spec.ts` 尚未新建**、扩 `agent-conic-kinds.spec.ts`、2024Ⅰ-11 非标准曲线的「明确不归类」判据。

> **2026-10-12 承接上一条 ② 的根因：Lean 慢集成「单列」出去了，顺带把「两个 6」的账对上**（用户裁决）。① **单列**：`vitest.config.ts` 把 `scripts/proof-spike/lean4EndToEnd.test.ts` 排除出默认全量；另建 `vitest.lean.config.ts`（**复用主配置的环境与 `setupFiles`**，只换文件集）与具名脚本 `npm run test:lean`。**为什么**：那条集成在本机会真的跑 `lake env lean`（一个文件约 7 分钟 = 冷启动预热 ~2.5 分钟 + 四条判据各 ~65 s），待在默认全量里会把同跑的用例饿死（`fileExports.test.ts` 的 CAD 导出被挤到 vitest 默认的 5 s 超时）—— 上一批只给那条用例加了显式预算**止血**，这一批才动**根因**。**读数**：默认全量 **365 文件 / 4300 通过 + 1 todo / 0 失败**（419.27 s，exit 0；少掉的 8 条正是那个文件的用例，日志里 `E2E 冷启动` 出现 **0** 次）；`npm run test:lean` 单独跑绿。**一处如实**：这台机器现在比文档记录的那批（非 Lean 全量 147–170 s）慢得多（32 逻辑核、当时占用 31%，另有进程在吃 CPU），所以 419 s 与 147 s **不可比**。② **两个 6 的账**：`figureIntent.test.ts:20` 的 `PROMPT` 是**计划 §3 的转述**（"E/F 在边上定比分"、没有那两个比例）⇒ 读出 **6**；**用户原话**（与 `diagramObligations.test.ts` 的 "reads both radicals and both colon ratios from the real user sentence" 及 `e2e/agent-exam-solid.spec.ts:20-24` 逐字相同）⇒ 读出 **8**，早有判据钉着、也被绿的 e2e 钉住。而 §一里"第 11 轮实测 6 条"是**另一个** 6（拿原话测的，当时 Task 10 还没修好"部分比整体"）。两条记录现已互相指认，`figureIntent.test.ts` 的注释也改了 —— 它原来写着"我没有原始用户原话"，而**原话一直在仓库里**。**边界**：`vitest.lean.config.ts` 用一处 TS 断言取主配置的 `test` 段（配置对象在运行时是对象，不是函数）。

> **2026-10-12 三件收口（都不是新能力）：Lean 冷启动、一条被负载挤死的用例、两条待裁决**。① **Lean 真实端到端**：`scripts/proof-spike/lean4EndToEnd.test.ts` 新增一条 **「冷启动单独量」** 用例（宽预算 900 s、只要求 `exit 0`），把"第一趟把 mathlib olean 读进页缓存"的成本与四条判据**分开** —— **判据的 300 s 预算一个字没动**（"不要因冷跑就调预算或放宽判据"仍然成立），只是不再需要**人**去判断"这次红是冷还是真的慢"。实测：预热 `149339 ms exit=0`，随后四条各 ~65 s 全部 `formally_proved / verified`。② **`fileExports.test.ts` 的 CAD 导出用例**给了 30 s 显式预算：它在全量里与上面那条 Lean 集成同跑、被 CPU 挤到 vitest 默认的 5 s 超时（单跑 9/9 绿，**断言一条没动**）。**根因**（那条 16 分钟的机器相关集成跑在默认单测里）登记为待裁决，没在这条用例里偷偷处理。③ **两条待裁决由用户裁决并落地**，见 §一「待裁决」表第 5、6 行 —— 诊断文案**改在面板侧**（新模块 `confirmationWording.ts`，**黄金样本与编译器输出一个字没动**）；`.gitattributes` **加一条按路径的窄规则**（先实测复现了假脏，修后保持 clean）。门禁：**全库 366 文件 / 4308 通过 + 1 todo / 0 失败**（734.96 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning，`docs-consistency` 4 文件 12 通过。**边界**：桌面 IPC / 日志 / 导出里仍是编译器那句原话；Lean 冷启动那条路径**本机不能按需复现**（要清 OS 页缓存），验到的是"预热用例排在前面且通过 + 判据路径未改"。

> **2026-10-12 Task 13 **完成**（12 项里第 12 项；下一项是 Task 14 圆锥曲线真题纵向）**。**原用户那道题已经端到端通过**（真实浏览器 / 草稿 / 确认 / 一步撤销，`e2e/agent-exam-solid.spec.ts` 1 passed / 8.3 s），链路是：四个坐标 ⇒ 系统按定比分点建 `E`/`F` ⇒ 折叠**按点名取点** ⇒ 折角按 `PC=4√3` **反求**（**三环全串**）。**负例齐**：缺 `C` 的面片 / 错的折角 + 缺 `C` / **手写的 `P`**（`fold_not_rigid` 挡下 —— 八条题设全过、而 `|PE|` 差 3.7 倍的那种"图形很像但折后 `P` 错"）。本轮补齐的变式：**二面角定高**（内核早就会、产品路径够不着 ⇒ 已通，45°/60° 各自量得出来）、**棱柱点名**（`solid.create_prism` 收 `vertexNames` + `planHasVerifiableFigure` 按动作判 ⇒ 题面 `AB=2` 进核验并 `passed`；没带点名的照旧 `核验=[]`）、**底面数两半**（正五棱锥代表形状造得出；五边形底面 + 角度条件**如实拒绝**"不换一个题面没说的形状"）、**组合实体跨阶段点名**（第二阶段量得到第一阶段建的点，`PB=5:passed`）、**垂足不在中心＝常态**（有用例钉住）。**记录的边界**：① **斜棱柱"明说倾角"已于 2026-10-14 收口**（原先解析器没有"所成角"的读取器 ⇒ `45°` 与 `60°` 读到同一个代表值；现在三层齐：读取器 + `lateralTiltDegrees` 用它 + 从最终坐标量线面角，见顶部同日条目）；② **面上点**与**展开**今天**没有产品入口**（宿主类型只收棱/线/曲线；没有 `solid.unfold` 这类动作），按计划"不为没有产品入口的…单独造隐形约束"记成边界。门禁：**全库 366 文件 / 4298 通过 + 6 skipped + 1 todo / 0 失败**（147.61 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning，`docs-consistency` 4 文件 12 通过。

> **2026-10-12 Task 13 第十一步：两个真题变式的读数 —— 底面数（两半都钉住）与斜棱柱的"明说倾角"（缺口已钉住）**。**① 底面数变化（五边形）不是"能/不能"一条线**：`在正五棱锥P-ABCDE中，PA⊥平面ABCDE` ⇒ `verified_instance`（底面走"正 5 边形代表"，自算五个底面点共面 + 顶点离开底面）；而 `在五棱锥P-ABCDE中，PA⊥平面ABCDE，AB⊥BC` ⇒ **如实拒绝**，理由逐字"底面点名了角度或平行条件，**正 5 边形代表满足不了它，不换一个题面没说的形状**" —— 这种拒绝**是对的**（换形状就是替用户改题），记下来是为了让以后补"五边形底面联立"的人知道今天的边界画在哪。**② 斜棱柱的"明说倾角"是缺口**：`specForObliquePrism` 的口径是"只说'斜'、没说斜多少 ⇒ 取代表值 60°"，而题面**明说**倾角时**解析器里没有"所成角"的读取器**，那句话既进不了 `relations` 也改不动 `lateralTiltDegrees`；判据用**两个不同的角**（同一族的"二面角"当初就是这么抓出来的）：`45° ⇒ 60`、`60° ⇒ 60`，**同一个数** ⇒ 明说的倾角没有进链。**修法方向（未做）**：解析器加"与底面所成角"的读取器 ⇒ 新义务种类 ⇒ IR 判性 ⇒ `lateralTiltDegrees` 用它；**同时**必须有"从最终坐标量侧棱与底面所成角"的核验 —— 否则变成"读得懂但没人核"，那比读不懂更糟。门禁：**全库 366 文件 / 4296 通过 + 6 skipped + 1 todo / 0 失败**（167.04 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning，`solver` 面 **6 文件 / 194 通过**。**Task 13 仍未做**：斜棱柱明说倾角（上面那三层）、面上点、展开与组合实体、顶点垂足不在中心（注：现有夹具的垂足本来就取在顶点 `A` 上，属于"不在中心"那一类，但**没有专门用例钉住**这一条）。

> **2026-10-12 Task 13 第十步：棱柱的题设核验通了（上一轮钉住的洞，同日两步修完）**。**洞的实情**：棱柱顶点被编成 `P1…P6`（模板自己的顺序编号），于是题面里 `AB=2` **一条都不进核验**，而那一轮 `ok=true` —— **静默通过**。**两步修法**：① `solid.create_prism` 收 `vertexNames`（底面 n + 顶面 n，与题面 `ABC-A′B′C′` 一一对应）：`actionInputs`（只挡形状：非空、互不重名、偶数且 ≥6）、动作类型、`actionRegistry.inputFields`、`compileSolidPrism`（**长度与顶点数不符当场拒绝**；给了名字就用它当点的 `label`，否则仍是 `P1…P6`）。**登记表那一格是实测踩出来的**：只改 `actionInputs` 时 `vertexNames` 被字段审计当成未知字段，整轮失败、文档里一个带名字的点都没有（`带名字的点：[]`）。② `planHasVerifiableFigure` 对棱柱**按动作判**（`prismCarriesVertexNames`：带了点名才算可核验）—— **没有**无条件加进那个集合，否则"只画个棱柱"的题面会去核验并不存在的点名、把本来能过的挡住（与它排除 `solid.create_template` 是同一条理由）。**修后读数**（同一条用例，棱柱带 `["A","B","C","A′","B′","C′"]`）：文档点名 = `["A","B","C","A′","B′","C′"]`；题面 `AB=2` **进了核验**且 `passed`（不再是 `核验=[]`）；**自己算** `A` 到 `B` 的距离 = 2。**两半都留着判据**：没带点名的棱柱照旧 `核验=[]`（那条用例还在，钉着行为没被顺手改掉）。门禁：受影响面 **18 文件 / 352 通过**，**全库 366 文件 / 4294 通过 + 6 skipped + 1 todo / 0 失败**（166.03 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**Task 13 仍未做**：其余真题变式逐题（底面数、垂足不在中心、斜棱柱的**明说**倾角、面上点、展开与组合实体）。

> **2026-10-12 Task 13 第九步：真题变式「棱柱」—— 题设一条都不进核验，而这一轮**静默通过**（已钉住，未修）**。**实测读数**（`examSolidVariants.test.ts` 新增一条，题面 `在正三棱柱ABC-A′B′C′中，AB=2，画出这个正三棱柱`）：`ok=true；核验=[]；带名字的点=[P1、P2、P3、P4、P5、P6]；诊断=[]`。三件事一次看清：① 棱柱的顶点被编成 **`P1…P6`**（模板自己的顺序编号），**不是题面里的 `A`/`B`/`C`/`A′`…**；② 于是 `planHasVerifiableFigure` **刻意**没把 `solid.create_prism` 算进"能让题面点名的顶点拿到坐标"那一族 —— 它排除 `solid.create_template` 的理由（"那是**模板自己的顺序编号**，与题面点名不是一回事"）**逐字适用于今天的棱柱**，所以"没加进去"本身是**对的**、不是漏加；③ 结果是题面里的 `AB=2` **一条都不进核验**，而 `ok=true` —— **静默通过**。对"2021/2022 的**棱柱**题"来说，这是"画得像 ≠ 题设成立"最彻底的一种形态。**这一轮只钉住、没修**，因为修法是两步且第二步有反作用：① 让 `solid.create_prism` 收 `vertexNames`（底面 n + 顶面 n，与题面 `ABC-A′B′C′` 一一对应）并给子对象打名字；② `planHasVerifiableFigure` 对棱柱改成**按动作判**（**带了点名**才算可核验）—— **不能**无条件加进那个集合，否则"只画个棱柱"的题面会去核验并不存在的点名、把本来能过的挡住。第 2 步动的是"这一轮要不要跑核验"这个开关（`draftStore` 也要问同一个问题），是回归面最敏感的一处，留给下一轮单独做、单独取证据。门禁：**全库 366 文件 / 4293 通过 + 6 skipped + 1 todo / 0 失败**（167.31 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**Task 13 仍未做**：棱柱点名（上面那两步）、其余真题变式逐题（底面数、垂足不在中心、斜棱柱的**明说**倾角、面上点、展开与组合实体）。

> **2026-10-12 Task 13 第八步：真题变式「二面角」—— 内核早就会，产品路径够不着，现在通了**。**缺口**：① `kernelRelations` **连 `dihedral` 都没映射**（题面给了二面角，搜索层当它不存在）；② 就算映射过去，内核 `heightSpecFromSpec` **只认"定长侧棱"**，别的一律落 `free` ⇒ `deriveApexHeight` 的 `dihedral` 支（连单测都在）**在整条产品路径上够不着**。**实测症状**（新建 `packages/agent-core/src/solver/examSolidVariants.test.ts`，同一道题写两个角）：`45°` 通过、`60°` 红，诊断原文 `failed-given: 二面角P-CD-A=60°：实测 45.000，题设要求 60` —— **两个角量出来都是 45.000**，高根本不是按它求的。**45° 那一遍是碰巧过的**（自由高的某个候选恰好让角量成 45°），这也正是我把用例写成"两个角各来一遍"的原因。**修法（判据只留一处）**：`witnessSearch.kernelRelations` 新增 `dihedral` 映射（`targets` 四个点名 `[一侧,折痕1,折痕2,另一侧]` ⇒ 两个半平面 `(t0,t1,t2)`/`(t3,t1,t2)`）；`constructors.heightSpecFromSpec` 新增 `dihedral` 支（关系里有含顶点的半平面 ⇒ 高的来源就是它）。**我一开始在编排层塞 `apex.height`，被内核类型当场挡住** —— 那个类型的注释写着"**一份 spec 就够了**，不必在 spec 之外再夹带一个 `WitnessHeightSpec`（那正是'同一个判断写两遍'的开端）"，照它改在内核才对。**绿读数**：45° 与 60° 两遍都 `verified_instance`，**自己算**（沿折痕去掉分量、量两个垂线方向夹角）分别得 45° 与 60°；规格的自由标量只剩两条底边（`free` 里不再有 `height`）。门禁：受影响面 **8 文件 / 271 通过**，**全库 366 文件 / 4292 通过 + 6 skipped + 1 todo / 0 失败**（159.16 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**Task 13 仍未做**：其余真题变式逐题（底面数、垂足不在中心、斜棱柱、棱上/面上点、展开与组合实体）。

> **2026-10-12 Task 13 第七步："折后 P 错"是一个**真缺口**，已补上判据**。**先红读数**（新建 `planCompiler.foldNegatives.test.ts`）：计划**绕开 `solid.fold`**、直接用一只普通面片把"折后"的 `P` 写在某个满足 `PC=4√3` 的地方 ⇒ **八条题设全 `passed`**，而落盘 `|PE|=12.928` 对 `|AE|=3.464`、`|PF|=12.053` 对 `|AF|=4.000` —— **条件全过，图根本不是折出来的**。这正是计划 RED 点名的"图形很像但折后 `P` 错"：**"题设条件全过"不等于"图对了"**。**补了两处**：① `FigureTransformation` 此前只是个**类型** —— `buildFigureIntent` 只把调用方给的 `input.transformations` 原样带过，**没有任何东西去读题面里那句"翻折"**；新增 `readFoldTransformations(prompt)`（收原句与简写两种写法，判据是"折痕那两个名字先折后都要出现"，任何一处对不上就不产出）。② `compileOnce` 新增 `foldRigidityDiagnostics`（诊断码 `fold_not_rigid`）：从**最终坐标**量 `apexAs` 到折痕两端的距离与 `apex` 的比，超差即 `geometry_validation` 错误、整轮 `ok: false`，详情里带**量出来的数**。**为什么写在诊断而不是核验报告里**：核验报告是"题设条件"的账（那八条确实条条成立），"这不是折出来的"是**另一件事** —— 分开才不会把"核验通过"当成"图对了"。**绿读数**：同一条用例 `ok === false` + `fold_not_rigid`；`figureIntent.test.ts` 照旧全绿。门禁：**全库 365 文件 / 4290 通过 + 6 skipped + 1 todo / 0 失败**（161.72 s，exit 0），`typecheck` exit 0，`lint` **0 error / 13 warning**（回到基线）。**Task 13 仍未做**：**2021–2024 立体真题逐题**。

> **2026-10-12 Task 13 第六步：第三环也接上了 —— 用户那句题面的**整条结构**现在全部由系统算出来**。原先接不上：折角反求取坐标用的 `planPoint` 只读动作的 `vertices`/`vertexNames`，而"点名建点"（`dynamic.create_bound_point`）**没有那个数组**，`E`/`F` 取不到就放弃。**修法方向是"不自己再写一遍"**：不重写"点在棱上参数 p 处是哪"（那套判据只有一份：宿主棱朝向、平面路径弧长），而是**把折叠那几笔摘掉、用 `compileOnce` 再编译一次**，从"折之前"的文档里按点名取坐标。**为什么成立**（读源码确认）：`compileOnce` 的**成功路径**一定给出 `working`（`draftDocument: null` 只属于**动作报错**那条路）；摘掉折叠后那些条件本来就不成立，所以只看文档、不看结论；取不到才退回计划里的平行数组。**三环全串的读数**（`planCompiler.faceRatios.test.ts` 第四条）：计划里**一个 `E`/`F` 坐标都没给、折角也是错的 30°**，题面只说 `PC=4√3` ⇒ 整体 `passed`；自算 `AE/AD=2/5`、`AF/AB=1/2`、`|PC|=4√3`、`|PE|=|AE|`、`|PF|=|AF|`；`assumptions` 出现"反求"。**e2e 照同一口径加强**：`userFoldPlan()` 现在只给四边形四个坐标 + 两条"点名建点" + 折叠的点名与错的折角（**折片坐标也不给**），`e2e/agent-exam-solid.spec.ts` 仍 **1 passed（8.3 s）**。门禁：受影响面 **14 文件 / 187 通过**，单元切片 **7 文件 / 151 通过 + 1 todo**，**全库 364 文件 / 4289 通过 + 6 skipped + 1 todo / 0 失败**（164.62 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**Task 13 仍未做**：**2021–2024 立体真题逐题**（本轮与前几轮都在补齐能力与用户原题的整条链）。

> **2026-10-12 Task 13 第五步：`solid.fold` 可以**不带坐标**了 —— 前两环串起来；并实测到一个方向缺陷**。**改动**：`SolidFoldAction.inputs.vertices` 改成可选（`scene-graph/types.ts`）；`actionInputs.ts` 省略时只要求 `vertexNames`（≥3）；`actions/index.ts` 省略时**按点名从文档找点**（`resolveFlapVertices`），一个名字找不到就**整体拒绝**（`fold_reference_missing`）；`actionRegistry.ts` 把 `vertices` 从 `required` 里拿掉。**中间那一步值得单记**：`actionInputs` 放开之后计划**仍然**被打回，诊断原文 `parameter_completion/rejected_by_policy@…'vertices' must be provided explicitly` —— "某某字段必填"在仓库里有**两处**声明（动作输入校验 + 登记表 `required`），只改一处会在另一处被拦。**不是为一道题新造机制**：题面本来就把 `E`/`F` 钉在边上，让模型抄一遍系统已算好的坐标只会抄错（现场 7 次失败查实的一条正是"模型在自己手算折后坐标"）—— 与 Task 10 是**同一个判断**。**新用例**（`planCompiler.faceRatios.test.ts` 第三条）：计划里**只有**面片四个坐标 + 两条"点名建点" + 折叠的**点名与折角**，`E`/`F` 坐标**一处都没写**；实测整体 `passed`、**自算** `AE/AD=2/5`、`AF/AB=1/2`、`|PE|=|AE|`、`|PF|=|AF|`。**实测到的缺陷（钉住、未修）**：`dynamic.create_bound_point` 的 `parameter` 沿**宿主棱自己的 `pointIds` 顺序**量，而 `hostEdge:{from,to}` **不改变**那个顺序 —— 这只面片的 `A—D` 棱存的是 `D→A`，所以"从 `A` 量 2/5"必须写 `3/5`；写成 `2/5` 时 `AE:AD` 实测 **3/5**、核验 `failed`。Task 10 的补建那一支自己算了朝向并翻转过参数，**手写的** `create_bound_point` 没有这层保护；修法（朝向归一收成一处）**已在本轮做完**：`compileCreateBoundPoint` 按 `hostEdge` 的 `{from,to}` 判、相反时取 `1 − parameter`；`materialisedPointActions` **不再自己翻**（两边各翻一次会翻回去 —— 修的过程中实测到 `E` 落到 `3/5`、`AE:AD` 停在 `unverified`，那正是"同一个判断写两遍"的现场）。`orientation` 那一问保留（它问的是"这条棱找不找得到、唯不唯一"，与"从哪头量"是两件事）。现在面片那条用例里写的就是题面方向的 `2/5`。门禁：契约受影响面 **9 文件 / 176 通过**，**全库 364 文件 / 4288 通过 + 6 skipped + 1 todo / 0 失败**（165.63 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**仍未做**：**2021–2024 立体真题逐题**；**第三环"折角反求"未接进这条链**（反求那一支只从计划的 `vertices`/`vertexNames` 取坐标，解析不了"点名建点"的坐标）；**方向归一那个缺陷没修**。

> **2026-10-12 Task 13 负例补上了（计划 RED 要的"图形很像但缺 B/C/D 或折后 P 错"）**。两条，判据都是"**不许通过 + 不许把缺点蒙出来**"：① **面片少了顶点 `C`**（`CD=3`、`∠ADC=90°` 无坐标可核）⇒ 核验不是 `passed`，且文档里**没有** `C`（它不是中点、也不是定比分点，补建没有规则能造它）；② **错的折角 + 图里缺 `C`**（`PC=4√3` 仍在题面）⇒ 反求没有目标点可用、不救，`PC=4√3` 核不过，`C` 同样没被蒙出来。**我自己被实测纠正一次**：先把负例写成"把题面里的 `PC=4√3` 去掉 ⇒ 错的折角不许通过"，实测**红了** —— 因为删掉那句，**那条条件就不在题面里了**，错的折角没有任何可违反的条件，剩下七条确实全成立，`passed` 是**对的**；真正该挡的是"**条件还在、而反求没有依据**"。现在把这条正确行为（`passed`）也钉进断言，免得下次被"修"错。门禁：**全库 364 文件 / 4287 通过 + 6 skipped + 1 todo / 0 失败**（168.55 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning，docs-consistency 4 文件 12 通过。**Task 13 仍未做**：**2021–2024 立体真题逐题**（本轮做的是用户原题 + 面片定比分点 + 两条负例）；以及"系统构造 E/F"与"折角反求"**未串成一条链**（折叠 e2e 仍用夹具给的 `E`/`F`，因为 `solid.fold` 要显式 `vertices`）。

> **2026-10-12 Task 13 第三项补上了：面片上的定比分点由系统**构造**（不再靠夹具给坐标）**。新建 `packages/agent-core/src/planCompiler.faceRatios.test.ts`。**先红读数**：计划里**只有那只四边形面片**（没有 `E`、没有 `F`）+ 题面给两个定比分点 ⇒ 五条四边形条件 `passed`，而 `AE:AD=2:5`、`AF:AB=1:2` 停在 **`unverified`** —— 补建那一支**根本没跑**。**根因**：`materialisedPointActions`（Task 10 写的）第一句只认 `solid.create_polyhedron`，而用户那道题的宿主是一只**平面四边形**（`solid.create_face`），于是"点在边上且 `AE:AD=2:5`"在面片题上**永远补不出来**。**改法**：两种宿主本来就是同一个形状（都带 `vertexNames` + `vertices`，棱 id 都是 `${宿主}:eN`，`compileSolidFace` 与 `buildFromPoints` 用同一条命名约定 —— 读源码确认），判据仍是"**恰好一笔**能给出点名与棱的宿主"。**改后读数**：整体 `passed`；**自己从落盘坐标算** `AE/AD=2/5`、`AF/AB=1/2`，且 `AE+ED=AD`、`AF+FB=AB`（**在线段上**）；`assumptions` 里 `E`、`F` 都出现。Task 10 的多面体那一族**照旧全绿**。**一处如实记的边界**：折叠 e2e **仍用夹具给的 `E`/`F` 坐标**（`solid.fold` 要显式 `vertices`），所以"系统构造 E/F"与"折角反求"**各证各的、没串成一条链** —— 串起来没做。门禁：planCompiler 面 **8 文件 / 135 通过**，**全库 364 文件 / 4285 通过 + 6 skipped + 1 todo / 0 失败**（168.97 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**Task 13 仍未做**：① 计划 RED 那批变式与"图形很像但缺 B/C/D 或折后 P 错"的**负例**；② 2021–2024 立体真题逐题。

> **2026-10-12 Task 13 第一项：原用户那道题**首次端到端通过**（真实浏览器、真实草稿、真实画布、一步撤销）**。新建 `e2e/agent-exam-solid.spec.ts`（**1 passed / 8.0 s**）：题面就是现场那一句"平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"——**八条逐条**出现在「题设核验」里且整体 `passed`；`assumptions` 里出现"反求"（折角是系统算的）；提交后**自己从落盘坐标算**：`AB=8`、`AD=5√3`、`CD=3`、`AE/AD=2/5`、`AF/AB=1/2`、**`PC=4√3`**、`∠BAD=30°`、`∠ADC=90°`，刚体性 `|PE|=|AE|`、`|PF|=|AF|`，七个点名 `A B C D E F P` 一个不多一个不少；折痕上的 `E`/`F` 一点没动；**`Ctrl+Z` 一步撤销**回到空图。**为什么这条能证明"折角是求出来的"**：夹具把折角填成 **30°**（错的），题面里**根本没有折角** —— 能 `passed` 就只可能是因为 **Task 12 的折角反求**按 `PC=4√3` 把角算出来并换掉了它。**接线**：`representativeFixtures.ts` 新增 `USER_FOLD_PROMPT` + `userFoldPlan()`（四边形用真坐标，与 `solidFoldAction.test.ts` 逐字相同）；`localPlanner.ts` 新增**精确匹配**意图 —— **本地规划器此前对这句话没有任何意图，离线路径根本产不出这份计划**，这正是"整题画不出来"的最后一环。**被仓库守卫抓到一次**：我给那条意图写了 `skillIds:["planar-basics","solids"]`，而 `"solids"` 这个技能 id **不存在** —— `localPlanner.test.ts` 的 "keeps the skill ids it names inside the shipped catalogue" 当场红（真实的是 `spatial-modeling`，它才是拥有 `solid.create_face`/`solid.fold` 的那一只），改后复绿。门禁：e2e **1 passed（8.0 s）**，受影响单元切片 **8 文件 / 181 通过**，**全库 363 文件 / 4284 通过 + 6 skipped + 1 todo / 0 失败**（180.64 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**Task 13 仍未做**：① 计划 RED 那批变式（变化底面数、垂足不在中心、斜棱柱、棱上/面上点、二面角、展开与组合实体，以及"图形很像但缺 B/C/D 或折后 P 错"的**负例**）；② 2021/2022/2023/2024 的立体真题没有逐题做（本轮只做了用户原题这一道）；③ **`E`/`F` 是夹具直接给的坐标**，不是从"点在边上且 `AE:AD=2:5`"**构造**出来的 —— Task 10 的定比分点补建走的是 `planCompiler` 那条路，本轮没接进这份夹具。

> **2026-10-12 Task 12 第二轮：折角反求**接进编译路径**了（`compilePlan`），并修掉一个把我自己挡在门外的守卫**。`planCompiler.ts` 新增 `rescueWithSolvedFoldAngle`，排在见证搜索**之前**（解析的、确定的、不吃候选预算），护栏顺序即判据：① 第一遍已通过 ⇒ 不抢；② 没有 `solid.fold` ⇒ 不是这一支；③ 折痕两端/待折点/目标点都得在计划里有点名坐标；④ 目标距离必须**逐字来自原话**（`fixedLength` + 含折后点名）；⑤ 求解器说 `unreachable`/`degenerate` ⇒ 不救（**证明无解**与"没找到"分开）；⑥ **第二遍必须 `ok` + 核验 `passed`** —— 角是求出来的，但**对不对仍由既有核验器按最终坐标说了算**，没有"系统算的所以跳过核验"的豁免；求出的角写进 `assumptions`。**三读**：填错 30° ⇒ 救回且**自算** `|PC|=4√3`、`|PE|=|AE|`、`P.z≠0`；填对 90° ⇒ **不抢**；题面无目标距离 ⇒ **不凭空反求**。**根因（本轮最值钱的读数）**：正向用例先红，而症状**会骗人** —— `assumptions` 是空串，看着像"救援没生效"，其实是"**门都没进**"：`const document = first.result.draftDocument; if (document === null) return null` —— **核验没通过时草稿往往是 `null`，而"没通过"恰恰是这一支唯一该管的场景**。坐标本来就从**计划的 `vertices`/`vertexNames`** 取（顺带坐实上一轮的教训：**文档里的点不一定带 `label`**，点名是靠核验器的点名表认的）。第二处：`role` **不能**限定成 `given` —— "**使得** `PC=4√3`"是**要达成的目标**，探针实测 IR 是 `{role:"given", targets:["P","C"], expected:4√3, judgeability:"supported"}`，两种角色都逐字来自原话。门禁：`planCompiler`（五份）+ `diagramFoldPoints` + `diagramVerification` + `foldAngle` = **8 文件 / 139 通过**；**全库 363 文件 / 4284 通过 + 6 skipped + 1 todo / 0 失败**（167.94 s，exit 0）；`typecheck` exit 0；`lint` 0 error / 13 warning。**仍未做**：① 只覆盖"固定点到旋转后点"这一类目标关系（更一般关系的上界区间搜索没做）；② 两支角都合法时**只取第一支**并把选择写进假设，**没有**把另一支一并披露；③ **没有 e2e**（真画布证据没做，计划原文也写明仍需 Task 16 的真实产品验收）。
>
> **顺带定案：那条"计划说八条、实测 6 条"的待澄清项 —— 不是题面缺句，是那两条比当时读不出来。** 实证：`diagramObligations.test.ts` 的 "reads both radicals and both colon ratios from the real user sentence" **今天通过**（实测 1 passed / 31 skipped），逐字要求八条都在且 `unverified` 为空：`["AB=8","AD=5√3","∠BAD=30°","∠ADC=90°","CD=3","AE:AD=2:5","AF:AB=1:2","PC=4√3"]`。我第 11 轮实测到的 6 条 = 五条四边形条件 + `PC=4√3`，缺的正是那两条比 —— 当时 **Task 10 还没修好"部分比整体"的写法**。两件事对上了，这条可以从待裁决里划掉。

> **2026-10-12 Task 11 已**完成**；Task 12（从目标距离反求折角）第一项做完，下一项是 Task 12 剩余部分**。**Task 11** 的 §4 退出条件与任务卡第二项三条子项全部清了（分类矩阵有读数；面积五层接通；真画布 e2e `e2e/agent-exam-triangle.spec.ts` 1 passed；SSA 由内核新增的 `ray-circle` 解得出来；"判据只保留一份"审计为单份；"两解选择来源"由内核写进 `assumptions` 的那一行承担，我上一轮加的 `alternatives` 因与它重复已撤回）。**Task 12 本轮做的是第一项（RED + 解析求解）**：新建 `packages/geometry-kernel/src/foldAngle.test.ts`（**6 条，先全红 → 现全绿**）—— 只给题面那组坐标（`A=(0,0,0)`、`E=(3,√3,0)`、`F=(4,0,0)`、`C=(9,√3,0)`）与目标距离 `4√3`，**不给**模型猜的 P、也**不给**角，要求求出折角（**绿读数：唯一 `θ=90°`**；其中一条用**罗德里格斯公式**自己绕 EF 转一遍再量 `|PC|=4√3`，是**独立的第二条路径**）。原 `solidFoldAction.test.ts`"折 90° 时 PC 恰为 4√3"那条**不冒充**本 RED（它是把 90° 当输入）。`rotation3d.ts` 新增 `foldAnglesForTargetDistance`：由 `|P(θ)−target|² = K + A·cosθ + B·sinθ` 化到 `R·cos(θ−φ) = d²−K`，**闭式**给出至多两支角（**不做区间搜索**，也就不会把"没搜到"说成"无解"）；四档结局**刻意分开**：`solved` / `outside-range`（有根但都不在允许区间）/ `unreachable`（**证明无解**并报出可达区间，实测 `PC∈[√12,√84]`，与闭式 `|PC|²=48+36cosθ` 一致）/ `degenerate`（待折点就在折痕上）；折痕方向取反得到同一个角。读数：`foldAngle`+`rotation3d` **2 文件 / 11 通过**，Task 12 点名的四个文件 + 新文件 **5 文件 / 120 通过**，**全库 362 文件 / 4281 通过 + 6 skipped + 1 todo / 0 失败**（167.19 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**Task 12 仍未做**：①**没接进产品路径**（求解器是内核纯函数，`solid.fold` 的调用方仍要自己给角；"每候选交既有 `solid.fold` 物化 + 核验器从最终 P/C 坐标重算 PC/折痕不动/刚体长度"与"多支保留来源与选择"都没做）；②只覆盖"固定点到旋转后点"这一类目标关系；③`diagramFoldPoints.test.ts` / `diagramVerification.ts` 未动；④**"整题能画"仍不能说**（计划原文：仍需 Task 16 的真实产品验收）。

> **2026-10-12 Task 11 第四轮（收尾）：SSA 已解得出来、"两解"的出口早就有、判据审计是单份；我上一轮新加的那条通道撤掉了**。① **SSA 从"给不出"变成"解得出来"**：内核新增 `ray-circle` 规则 —— 角只给一条**射线**、`BC` 给一个**圆**，相交即解、**最多两解**；两条前提都不省（角那条臂的定长必须没有、距离必须来自另一个已落位点），方向取法与角那一支同一套（`±degrees`，正转在前），并排在最后（它比前几条弱）。实测 `AB=8，∠BAC=30°，BC=4` 现在 `verified_instance`，`AB=8`、`BC=4`、`∠BAC=30°` 逐条自算成立。② **"两解选择来源"早就满足了 —— 出口是内核那一行假设**：我在上一轮给 `verified_instance` 加了 `alternatives`，再测出平面这一族的候选池只有一条解析候选（`specForPlanarFigure` 的 `freeScalars` 是空数组），于是读成"两解没有出口"。**那个读法不完整** —— 内核在 `constructPlanarWitness` 里**自己数过**有几组解并写进**用户看得见**的假设：*"满足全部条件的坐标有 N 组，系统取第一组（各组都满足题面，差别只在镜像 / 另一支）。"* 已用断言钉住（面积题与 SSA 题的 `assumptions` 都必须出现"N 组"）。按本仓"同一个判断写两遍必然分叉"的纪律，`alternatives` 是同一件事的**第二份** ⇒ 连同 `solverContracts` 的字段一起**撤回**，选择行为恢复原样。③ **"判据只保留一份"审计：已经是单份** —— 整个 `agent-core` 生产代码只有**一处** `Math.acos`（核验器 `diagramVerification` 的 `planarAngle` 支），另外五处全在**测试**里（那是"自己算、不读面板结论"的纪律）；自交判据是内核 `buildFromPoints` / `hasSelfIntersectingPolygon` 的**一份**（`witnessSearch` 注释原话："都是**同一份**实现，这里不再抄第三份"）。**教训**：我两次都在"新加一条通道"上走过头 —— 一次是把 SSA 记成成功（宽松断言），一次是没先查"这件事是不是已经有人说了"就动手加通道。**先查已有的披露渠道，再决定加不加。** 门禁：定向 **8 文件 / 281 通过 / 0 失败**，**全库 361 文件 / 4275 通过 + 6 skipped + 1 todo / 0 失败**（165.86 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**仍差**：`∠A=30°` 单字母角不认（要写 `∠BAC`）；**全量 e2e 未跑**（只跑了 `e2e/agent-exam-triangle.spec.ts` 与定向切片）。
>
> **下面那一段（第三轮）里的两句已被本条推翻，读时以本条为准**：① "SSA **给不出**" —— 已修好；② "两解选择来源只做了一半" —— 出口一直都在（内核那行假设）。

> **2026-10-12 Task 11（三角形真题纵向交付）—— 基本完成，第一项做完；下一项仍是 Task 11（不启动 Task 12）**。**做完了分类矩阵**（计划 RED 第一项）：四个样本的**实测结局**都钉进 `planarFigure.test.ts` —— 无解（`AB=2，BC=1，AC=10`）是 `unverified_instance` **加一条 `contradictory-planar`**（"这几条条件互相不可能同时成立"），欠定（`AB=8`）是 `unverified_instance` **加一条 `underdetermined-planar`** 并**点名缺哪个点**（`C`），角顶点不在环上（`∠ADB`）如实拒绝，SSA（`AB=8，∠BAC=30°，BC=4`）**给不出**：`unverified_instance` + `underdetermined-planar`（**2026-10-12 同日更正**：上一轮我把它记成"通过且逐条自算成立"是**错的** —— 当时断言写成"要么 verified、要么至少不是 no_witness"，它走的正是后半支，我用宽松断言给自己报了一个不存在的成功；而且它给的理由"缺一条定长 AC"**在数学上也不成立**，SSA 由正余弦定理由唯一或两解定形，真实缺口是这一层不会联立）。**我两处先写错了断言、被实测纠正**：① "无解"不是 `no_witness` 而是"未核验 + 矛盾的码"（这更对：矛盾必须与"没找到"分开，方式是码 + 原话）；② "欠定"这一层**有意**不画（只做被题面钉死的情形），所以断言改成"欠定要说成欠定、并说清缺谁"。**同日第二轮：面积接通了**（五层）—— 解析器新增 `area` 义务与 `△ABC的面积为6` 句型（**不收**代数式 `S△ABC=6`，那会把"读不懂"变成"读错"）、IR 进 `JUDGED_KINDS` 且用相对容差、映射成内核关系 `area`、内核新增 `planarRuleFromArea`（`面积 = ½·底·臂·sin(夹角)` ⇒ 臂长唯一，返回一条**角规则**）、核验器**从最终坐标自算** `½|AB×AC|`。**那条钉住缺口的断言已反向改掉**：现在断言 `toContain("area")` + `verified_instance` + 自算面积 `= 6`。**过程里一次有用的失败**：规则写好仍红，理由是 `unsupported-planar-condition：…它目前只认得两类条件` —— 平面构造器入口有一道**条件种类白名单**，新条件必须同时过那道闸；`typecheck` 还抓出三处穷尽分支（条件名表、`planarWrittenForm`、底面角那支）必须显式处理。**同日第三轮：真画布 e2e 与换点名变式都做了**。新建 `e2e/agent-exam-triangle.spec.ts`（**1 passed / 8.0 s**）—— 计划点名的第三项验收：题面 `平面三角形ABC中，AB=8，∠BAC=30°，△ABC的面积为6`，夹具给的是**错的**坐标（`AB=4`、面积也不对），所以**能 `passed` 就只可能是因为按题面重新构造过**；三段判据都**自己从落盘坐标算**（`AB=8`、`∠BAC=30°`、面积 `=6`），面板上「题设核验」必须 `passed` 且**同时出现 `AB` 与 `面积`**，最后 **`Ctrl+Z` 一步撤销**回到空图。走 `设置 → 示意图见证搜索` 那条离线路线（配了新夹具 `examTrianglePlan()` 与本地规划器新意图）。**为什么在 `geometry3d`**：平面图形这一族的宿主是 `solid.create_face`，而 `withWitnessCoordinates` 只认 `create_polyhedron` / `create_face` 两种宿主 —— 平面动作那种文档里两者都不在役；原用户那道"平面四边形 + 翻折片"走的正是同一条路。另外补了**换点名**变式（`平面三角形BCA中，BC=8，∠CBA=30°，△BCA的面积为6`）：环顺序**跟着题面**（`["B","C","A"]`）而不是被排成字母序，三条条件逐条自算成立。门禁（全部重跑）：定向 **5 文件 / 155 通过**，受影响单元切片 **9 文件 / 187 通过 + 1 todo**，**e2e 新 spec 1 passed（8.0 s）**，**全库 361 文件 / 4273 通过 + 6 skipped + 1 todo / 0 失败**（167.47 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**同日第四轮（收 Task 11 两条子项）**：① **审计"`planarAngle` 与自交判据只保留一份"** —— 结论是**已经是单份**：整个 `agent-core` 生产代码里只有**一处** `Math.acos`（核验器 `diagramVerification.ts:549`），另外五处全在**测试**里（那是"自己算、不读面板结论"的纪律）；自交判据是内核 `buildFromPoints` 的**一份**，`witnessSearch.ts:813` 的注释原话就是"都是**同一份**实现，这里不再抄第三份"。② **"两解选择来源"只做了一半**：给 `verified_instance` 加了 `alternatives`（搜索器不再"找到第一个通过就 return"，而是把其余通过核验的支一并收进结果，扫描有界），**但平面图形这一族的候选池只有一条** —— `specForPlanarFigure` 的 `freeScalars` 是空数组，`candidatePool` 只产出那条解析候选，构造器算出的镜像支**从来没进过池子**，所以 `alternatives` 是空的。这条缺口连同"谁修、怎么反向改断言（镜像判据：`A`/`B` 不动、`C` 动了但到 `A`/`B` 的距离一模一样）"一起钉在 `planarFigure.test.ts` 里。**仍未做**：SSA 联立（或把那句数学上不成立的文案改掉）；平面的多支接进候选池；`∠A=30°` 单字母角不认（要写 `∠BAC`）；**全量 e2e 未跑**。门禁（第四轮）：定向 **6 文件 / 178 通过**，**全库 361 文件 / 4275 通过 + 6 skipped + 1 todo / 0 失败**（167.53 s，exit 0），`typecheck` exit 0。Task 12 及以后未开始；原用户那道折面题照旧未解决。读数：`planarFigure` + `diagramVerification` **2 文件 / 41 通过**，Task 1 适用切片 **7 文件 / 123 通过**，**全库 361 文件 / 4272 通过 + 6 skipped + 1 todo / 0 失败**（167.74 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**仍未做（所以不勾完成）**：① **面积条件**（解析→义务分类→见证关系→平面构造→核验，五层都要动）；② **SSA 的"两解"没有出口** —— `searchWitness` 只回一个候选，"输出自由度/两解选择来源"没做；③ **`e2e/agent-exam-triangle.spec.ts` 没有新建**（计划点名的真画布 + 一步撤销验收没做）；④ `∠A=30°` 这种单字母角不认（要写 `∠BAC`），实测到、没改。Task 12 及以后未开始；原用户那道折面题照旧未解决。

> **2026-10-12 Task 10（边上分点和动态依赖）已完成，下一项是 Task 11（三角形真题纵向交付），尚未开工**。`segmentRatio`（四条点名 + 一个比值）过去有**两处**实现且不一致：`planCompiler.constructiblePoint` 只认"未知点落在第 1、2 位"那一种锚法，于是用户题面里的 **`AE:AD = 2:5`**（部分比整体，解析成 `[A,E,A,D]`）**根本补不出来**。本批把判据**收成一处**（内核新增 `ratioParameterFor`：先认出"恰好一条名字出现两次"这个锚，再由锚决定方向与分母），`constructiblePoint` 改为委派。**先红读数**：内核 8 条新用例全红（函数不存在）；**端到端**：题面 `AE:AD=2:5` + 只给一笔多面体 ⇒ 文档里**出现 `E`**，**自算** `AE/AD = 2/5` 且 `AE + ED = AD`（**在线段上**）。**运行时不新增依赖**：派生点落到文档里就是既有的 `onHost` / `onPath` 绑定。读数：定向 **5 文件 / 193 通过**（另有本轮新增用例），Task 1 适用切片 **7 文件 / 123 通过**，**全库 361 文件 / 4264 通过 + 6 skipped + 1 todo / 0 失败**（166.75 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**补齐的两条（同日第二轮）**：① **不相容位置拒绝** —— `AE:AD=2:5` 与 `AE:ED=3:1` 同时出现时，**改动之前这一轮编译成功**（先红读数 `expected true to be false`）而 `E` 一个都没落到图上；现在**拒绝**并在诊断里点名两条来源（`incompatible_materialised_point`），比较用**规范形**（`from`/`to` 排序 + 参数折到同侧）所以同一条棱的两种写法不会误判成冲突，并顺带修掉"同名点被补两次"。② **宿主移动后的重算读数** —— 把顶点 `A` 挪走、跑既有的 `recomputeDerivedObjects`，`AE/AD` 仍是 `2/5` 且 `AE+ED=AD`；**牙齿检验**（跳过重算）读到 `0.9827` 而不是 `0.4`，证明这条判据真的在测"E 跟着动"。读数：定向 **7 文件 / 202 通过**（`diagramDraftStage` 17 通过），**全库 361 文件 / 4267 通过 + 6 skipped + 1 todo / 0 失败**（167.11 s，exit 0）。**仍未做**：`F`（`AF:AB=1:2`）没有单独用例（判据同一条，但不拿"同一条判据"当读数）；**全量 e2e 未跑**。另记一条**我自己的错**：补读数时用 PowerShell 直接改测试文件把中文写成乱码，`git checkout` 恢复时丢掉刚加的三条用例（已按原文重加）—— 源码改动一律走编辑工具，不用 shell 重写文件。Task 11 及以后未开始；原用户那道折面题照旧未解决（本轮补的是它 E/F 定比分点那一半）。

> **2026-10-12 Task 9（真题离线评测工件）已完成，下一项是 Task 10（边上分点和动态依赖），尚未开工**。新增 `packages/agent-core/src/benchmark/examSet.ts`（+ 11 条用例）：**开发集 8 条**（四家族各两条）+ **留出集 4 条**（**不同的原题**），每条带**来源锚点**（卷别 / 题号 / 证据等级 A-B-C / 输入许可 / 答案是否经独立复核）。把调研自己写下的两条约束变成**可执行判据** —— 因为这两条失效时程序**不崩**，只会让评测**看起来合格**：① **转载方的答案不能充 oracle**（调研 §1 明文；更彻底的一层是没复核过的题**连判都不判**，连一个"通过"都不许它发出）；② **留出集不许是开发题的变式**（判据认**来源锚点**，换名字/换常数/换说法都还是同一题，调研 §3.4）。外加退出条件里的"**错图 oracle 会拒绝**"（实测 `|AB|=4` 对要求 8 ⇒ `condition_failed` 且逐条说差在哪）。**随仓的真题工件不是金标，这一点写在代码里**：`verifiedGoldCaseIds` **仍为空**且有用例钉住"必须为空"（调研 §3.5）；每条题面带 `promptKind`，随仓的**全是 `survey-summary`**、**没有一条 `verbatim`**（本轮没有把任何卷面文本录入仓库，**不拿摘要冒充原题**）—— 所以 `judgeAgainstOracle` 对当前每一条都会回 `not_a_gold_case`，这是**如实的**。接线：`benchmark/index.ts` 逐项导出；`agentEvalReport.test.ts` 新增一条 ⇒ **`npm run eval:agent` 会把这份工件重跑一遍**（**不发任何 provider 请求**）；**`benchmarkPlanningEval.ts` 的现有 21 条合成题集一行未改**。读数：定向 **4 文件 / 35 通过**，Task 1 适用切片 **7 文件 / 123 通过**，**全库 361 文件 / 4255 通过 + 6 skipped + 1 todo / 0 失败**（170.64 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。仍未做：**"必要图"目前只是人读文本**（没有机器可判的图形 oracle —— 一条独立复核的答案都没有，写"预期图"等于编造金标）；**真题工件一条 oracle 都没有** ⇒ 今天能证明的是"判据挡住了不该通过的东西"，不是"某道真题已被评测过"。Task 10 及以后未开始；原用户那道折面题照旧未解决。

> **2026-10-12 Task 8（Worker 与主线程同版合同）已完成，下一项是 Task 9（真题离线评测工件），尚未开工**。两半：① **同版合同** —— 把 Task 7 的新支路纳入"两条路等价"那一族（同一份缺宿主输入 ⇒ 主线程与 Worker 的**图元逐字相同、报告含条件 ID 逐字相同、点名一致**）；**变异**掐掉 `witnessSearch` 转发 ⇒ 连同两条既有等价用例一起真红，最有说服力的读数是 `expected [ 1 个图元 ] to deeply equal [ 10 个图元 ]` —— **Worker 只有模型那一笔孤点、主线程多出系统补的四边形，而两边都不报错**。② **修掉一处误诊**：迟到的回包闸**本来就在**（`geometryWorkerClient` 四项核对，未改动），但 `compileInWorker` 的失败分支**只搬逐层诊断、不搬 `code`/`detail`** ⇒ "回包属于另一版"到草稿层变成诊断为空、只能说"编不出动作"。**先红**：`expected '' to contain 'stale_artifact'`；**GREEN**：Worker 没给逐层诊断时用回包自己的 `code`+`detail` 造一条（`stage: transport`、`path: worker`）。读数：定向 **6 文件 / 55 通过**，Task 1 适用切片 **7 文件 / 123 通过**，**全库 360 文件 / 4243 通过 + 6 skipped + 1 todo / 0 失败**（132.74 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**不以此宣布视觉或桌面可用**（计划原话）；迟到回包"进不了草稿"是结构性成立，但**我没有为它单独写草稿层用例**（新证据是"理由不再被吞"，不是"进不了草稿"）。Task 9 及以后未开始；原用户那道折面题照旧未解决。

> **2026-10-12 Task 7（缺宿主时安全物化）已完成，下一项是 Task 8（Worker 与主线程同版合同），尚未开工**。承接上一轮的接线，本轮把**最后一条退出证据补上**：`geometryWorkerHost.planar.test.ts` 新增一条 —— 同一份**没有宿主**的计划跨线程之后，图上照样出现系统补出来的 `A`/`B`/`C`/`D`，且断言 `witnessSearch` 开关也过了边界。**变异**：关掉合成 ⇒ **两条路同时真红** —— 主线程 `expected 'unverified' to be 'passed'`，Worker `A 没有在 Worker 里被补出来: expected [] to include 'A'`（**与现场症状逐字相同**）。⇒ Task 7 的三条退出条件（端到端实证、golden 兼容、Worker 与主线程同判）**都有读数**了。读数：定向 **6 文件 / 125 通过**，Task 1 适用切片 **7 文件 / 123 通过**，**全库 360 文件 / 4241 通过 + 6 skipped + 1 todo / 0 失败**（166.99 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning；**golden 一个文件都没改**。仍未做：**闭合物体**（`create_polyhedron`）的物化不在首批（要面环，本层以 `closed_ring_not_supported` 明确拒绝）；**原用户那道折面题照旧未解决** —— 本轮解的是"宿主缺席"，`PC=4√3` 那种反求折角是 Task 12。Task 8 及以后未开始。

> **2026-10-12 Task 7（缺宿主时安全物化）—— 接线已通、端到端实证；仅剩"Worker 级同判用例"未补**。本轮把上一轮的纯判据层接进了主链：`planCompiler` 的救援路径在 `withWitnessCoordinates` 返回 `null` **之后**才试"按题面补一个宿主"（顺序从句认得出、且是**平面图形**；坐标取内核构造的那一份，本处一个数字都不算）。**端到端实证**：模型只交一笔 `planar.create_point`（在可核验动作表里、却不产出面）⇒ 系统补出那个平面四边形 ⇒ **核验 `passed`**，落盘坐标自算 `|AB|=8`、`|CD|=3`。**过程中查出并修掉一个真缺陷**：第一版把**所有**动作都当"既有宿主"，于是夹具里的 `planar.create_point` 让判据判成 `existing_host` —— **判据把自己挡住了**；"宿主"的定义必须与 `withWitnessCoordinates` 那一份逐字一致（只认 `create_polyhedron` / `create_face`）。**golden 兼容已验**：`planCompiler.test.ts` 68 项（含 `planCompiler.offPath.golden.test.ts`）全过。**Worker 同判**：两条路调的是**同一个** `compilePlan`，而 Worker 携带 `prompt` 与 `witnessSearch` 已由既有用例钉住（`geometryWorkerHost.planar.test.ts:100`）——**但我没有为新合成写 Worker 级用例**，这一条如实记为剩余项。读数：定向 **5 文件 / 122 通过**，Task 1 适用切片 **7 文件 / 123 通过**，**全库 360 文件 / 4240 通过 + 6 skipped + 1 todo / 0 失败**（166.29 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning；**golden 一个文件都没改**。

> **2026-10-12 Task 7（缺宿主时安全物化）—— 进行中，只做完第一项；下一项仍是 Task 7，不启动 Task 8**。已做：新增 `packages/agent-core/src/figureMaterialisation.ts` + 同名测试（8 条），`planFigureMaterialisation` 是**纯函数**，判"**能不能替模型补一个宿主**"—— 产出要么是一笔 `solid.create_face` 的**骨架（一个数字都没有**，坐标归内核构造器）、要么是六个各不相同的拒绝码（`competing_rings` / `name_conflict` / `existing_host` / `unverified_conditions` / `no_named_ring` / `not_a_planar_ring`）。三条判据正对计划卡片的三个要求（能造 / 两个竞争四边形拒 / 点名冲突拒），**变异**把 `competing_rings` 短路 ⇒ `expected 'materialise' to be 'refused'` 真红。**未做（所以不勾完成）**：把意图经**窄适配**接进 `planCompiler` 与**同一草稿事务**、Worker 与主线程**同判**。**`planCompiler.ts` / `draftStore.ts` 一行未改** —— 所以"golden 兼容"是**靠"没碰"成立的，不是靠"验过"**，它**不算** Task 7 的退出证据；**这条能力在产品路径上一次都还没被调用**。读数：定向 **4 文件 / 103 通过**，**全库 360 文件 / 4234 通过 + 6 skipped + 1 todo / 0 失败**（165.44 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。本轮**没有 RED 读数**（测试与实现一起写完、一次全绿），补做变异证明判据不是空跑 —— 与前几个任务的记录方式不同，如实标明。Task 8 及以后未开始；原用户那道折面题照旧未解决。

> **2026-10-12 Task 6（来源可追溯的四族图形意图 IR）已完成，下一项是 Task 7（缺宿主时安全物化），尚未开工**。新增 `packages/agent-core/src/figureIntent.ts`（+ 同名测试 + `index.ts` 一处导出）：把"这道题要画什么"写成一份**不含坐标**的结构 —— 命名对象、条件清单、以及每条条件在**用户原话里的区间**；可追溯性照本仓既有的**可被程序核验**的形式写（`sourceText === prompt.slice(start, end)`），复用既有的 `DiagramSourceSpan`，**没有手抄第三套**。**计划的 `diagramObligations.ts` / `obligationIR.ts` / `contracts.ts` 一行未改** —— 计划给的是候选范围，而既有类型已经够用，能不动共享合同就不动。**本轮实测出一个不一致（待澄清，不是本轮改动）**：计划 §3 **逐字**引用的那句话，正文说它有"八条条件"，而**实测读出 6 条、0 条未核验**；我先排除了自己的措辞（第一版按记忆改写也读出 6，换成计划逐字那句仍是 6），差额最可能来自计划摘要压缩掉的显式比例（`AE:AD=2:5` / `AF:AB=1:2`），但**我没有原始用户原话，不替它下结论**。**（2026-10-12 补记：已定因，不是缺陷 —— §3 那句是转述、`figureIntent.test.ts:20` 用的正是它 ⇒ 6 条；用户原话在 `e2e/agent-exam-solid.spec.ts:20-24`、含那两条比例 ⇒ 8 条，且被一条绿的 e2e 逐条钉住（同文件 `:69`）。8 − 6 = 那两条比例。）**读数：定向 **3 文件 / 46 通过**（RED 是模块不存在），Task 1 适用切片 **7 文件 / 123 通过**，**全库 359 文件 / 4226 通过 + 6 skipped + 1 todo / 0 失败**（167.27 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning；**全量 e2e 本批未跑**。仍未做：`objects` **只到点名这一层**（`face`/`solid`/`curve`/`locus` 是给 Task 7 留的位置，现在没有代码产出它们 —— 这一层**不猜拓扑**）；`transformations` **只收不产**（翻折由 Task 12 反求）；**多解与工作区没有进 `FigureIntent`**（前者属构造层 Task 7，后者由 `planWorkspaces` 决定）；旧 `PlanEnvelope` 的窄适配**没写**（本层纯新增、没碰任何既有读取点，旧路径按构造仍可读；真正需要适配器是 Task 7 接线时）。Task 7 及以后未开始；原用户那道折面题照旧未解决。

> **2026-10-12 Task 5（非法输入与空间能力声明错位）已完成，下一项是 Task 6（来源可追溯的四族图形意图 IR），尚未开工**。三处改动：① `witnessSearch.ts` 的 `normaliseObligationIR` **逐条查形状** —— 它自己的注释写着"绝不抛异常跨边界"，而原先只查容器不查元素，`unverified: [null]` 直接 `TypeError: Cannot read properties of null (reading 'sourceText')`、`obligations: [null]` 在 `obligation.role` 上炸（两条都是**真红读数**）；② `capabilities.ts` 的 `constraint-authoring` 收窄为**只平面**（原先 `[...PLANAR, ...SOLID]`，而**没有任何入口能声明一条空间约束** —— 真红读数 `expected [ 'conics', 'geometry3d' ] to not include 'geometry3d'`，同一条用例从 `DRAFT_ACTION_IDS` 证明"没有一个约束类动作"）；③ `schemas.test.ts` 两条**本来绿的**用例（`relations: [null]` 与垃圾条目本来就是 fail-closed 的）—— 如实记为"钉住别退化"，不是"修缺陷"。**按计划扩了范围**：Task 5 的文件清单里没有 `witnessSearch.ts`，但卡片写明"仅在诊断表明另一个真实入口出错时扩范围"，而诊断表明出错的正是这个真实入口。**待裁决那一项一字未改**："题设要求 0" 仍保持旧字面（黄金样本 `planCompiler4707b64.golden.json` 未被触碰），沿用「待裁决」表第 5 行等你点头。**`typecheck` 抓到 `vitest` 没抓到的东西**：新断言写成 `result.errors?.some(...)` 时 vitest 全绿而 `tsc` 报 TS2339（判别联合要先收窄），修好才 exit 0。读数：定向 **5 文件 / 234 通过**，Task 1 适用切片 **7 文件 / 123 通过**，**全库 358 文件 / 4223 通过 + 6 skipped + 1 todo / 0 失败**（133.37 s，exit 0），`lint` 0 error / 13 warning。**全量 e2e 本批未跑**。**正常的 1 MiB 限制与超时拒绝一律不放宽**；Task 6 及以后未开始；原用户那道折面题照旧未解决。

> **2026-10-12 Task 4（预算及修复账本）已完成，下一项是 Task 5（非法输入与空间能力声明），尚未开工**。两件事：① **预算停止不再盖掉原始错误** —— 22:36 第 6 次尝试死在那句 `budget exhausted: budget_repair`，而它真正的失败是编译期那句几何诊断；现在失败事件三样一起给（哪本账用尽 / 余量 / **用尽之前最后一次真实失败**）。② **账本合同写成可执行判据**：一次 provider 往返 = 恰好一次 `(generation, network)` 计费、由恰好一层记 —— 协调器管每次 `plan()` 调用，规划器管它自己为"送回只读工具结果"多发的往返（"每批一次、不是每工具一次"由既有用例钉住）。**经测试没有重复计费**，第 6 次的闸是 `generation: 4` 本身（原始 1 + 工具批 1 + 修复 1 + 修复里的工具批 1），所以**额度一行没动**（`generation: 4` / `network: 6` 与两类修复上限照旧；`budget.test.ts` 的默认值断言照旧通过）—— **要不要加额度是你的成本决定**。读数：定向 **3 文件 / 101 通过**（先红读数见[变更记录](../CHANGELOG.md)），Task 1 适用切片 **7 文件 / 123 通过**，**全库 358 文件 / 4217 通过 + 6 skipped + 1 todo / 0 失败**（164.62 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning。**全量 e2e 本批未跑**。仍未做：**完整账本未逐笔记进事件流**（只在失败那一条里给余量，"每次发请求前记一份 remaining"没做）；原用户那道折面题照旧未解决；Task 5 及以后未开始。

> **2026-10-12 Task 3（统一动作菜单与工具合同）已完成，下一项是 Task 4（预算及修复账本），尚未开工**。本批把"模型能看见的动作"与"系统真正认识的动作"逐项对齐：对**全部 34 个 `DRAFT_ACTION_IDS`** 枚举校验**提示词菜单**（`buildPolicyText`）与**工具发布**（`buildPlanToolSchema`）两面都覆盖到、且本轮范围外的动作一个字不漏进来；把**开放的面 → `solid.create_face`（自带面边）/ 闭合实体 → `solid.create_polyhedron` / 折 → `solid.fold`** 的三分法从"报错之后才补"提前到**菜单本身**，且**只在给立体动作的那一轮出现**。另修一处**真实少报**：`{"arguments": "<计划字符串>"}` 这种工具通道的壳原先只报 `unknown_kind@envelope.kind`，**一个字都没说那个壳字段不该有** —— 现在两条一起报（`unknown_field@envelope.arguments`）。**没有注册任何新动作**：`solid.create_segment` 照旧不存在、照旧如实被拒。读数：定向 **4 文件 / 134 通过**（两处先红读数见[变更记录](../CHANGELOG.md)），Task 1 适用切片 **7 文件 / 123 通过**，**全库 358 文件 / 4216 通过 + 6 skipped + 1 todo / 0 失败**（169.05 s，exit 0），`typecheck` exit 0，`lint` 0 error / 13 warning；**全量 e2e 本批未跑**。仍未做："按场景只给最少需要的输入说明"只做到"菜单范围随本轮动作走"这一半，逐动作裁剪字段说明未做；原用户那道折面题照旧未解决；Task 4 及以后未开始。

> **2026-10-12 Task 2（重现并分类 22:36 的失败）已完成，下一项是 Task 3（统一动作菜单与工具合同），尚未开工**。本批改**三处**：`outputParser.ts` 新增成对的"账本那句话的生产方 / 逆运算"与面向用户的中文诊断、`coordinator.ts` 改用该生产方（格式逐字未变）、`apps/web/src/agent/agentRunner.ts` 的 `failed` 分支不再用一句话打发两种死因。**核心结论**：模型**自己造动作名**（现场是 `solid.create_segment` ×3）与**顶层 JSON 形状不合法**现在是**两句不同的话** —— 前者点名那个动作、列出三个路径、说出正确出口（`solid.create_face` 自带面边），并把上一轮已被忽略的那句建议一起摆出来；后者保留原来那句。定向 **3 文件 / 124 通过**（先红：20 项失败 / 1 项失败 / 1 项失败三处各自读数见[变更记录](../CHANGELOG.md)），Task 1 适用切片 **7 文件 / 123 通过**，`typecheck` exit 0，`lint` 0 error / 13 warning；**全库 358 文件 / 4210 通过 + 6 skipped + 1 todo / 0 失败**（163.42 s，exit 0 —— 比 Task 1 那次多 7 项，正是本批新增用例数）。**本批未跑全量 e2e**（改动只在解析/诊断文案与账本措辞，浏览器面未触及；沿用 Task 1 的 223 通过）。**阶段成果是正确拒绝与可读反馈，不是那道题已经自动画出** —— `solid.create_segment` 不会被自动翻译成别的动作，共享预算没动，原用户那道折面题照旧未解决；Task 3 及以后未开始。

> **2026-10-12 Task 1（旧功能兼容基线）已完成**（当时下一项是 Task 2）。本批**只新增一个测试文件**，**没有产品代码改动、没有修 bug、没有加能力**。读数：定向单测改动前 **6 文件 / 120 通过**、加上新守卫后 **7 文件 / 123 通过 / 0 失败**；定向 e2e **23 通过 / 0 失败 / 0 抖动**（`PLAYWRIGHT_EXIT=0`）；`typecheck` exit 0；`lint` 0 error / 13 warning；**全库单测 358 文件 / 4203 通过 + 6 skipped + 1 todo / 0 失败**（**三份文档改写完成后在冻结树上复跑**，168.43 s）；**全量 e2e 223 通过 / 0 失败 / 0 抖动**（2.4 m）。那 6 个 skipped 是真实 Lean 端到端用例（探针原文：本机没有 Lean ⇒ 全部 skip），**所以这两条全量读数不是 Lean 证据** —— 证明门禁照计划是另一把锁（Task 17–19），本批不主张任何 Lean 结论。计划要求"先量旧 HEAD"一节的结果是：**这个切片里没有旧红**（改动前全绿），所以"历史旧红已归因"在本切片上是空集。四处故意破坏的归因：仅有 `dynamic.*` 切进 3D 与前两处过期判据能被抓，其中**两处过期判据方向（②/②'）没有任何旧用例能抓** —— `committerAdapter` 的策略用例把这个值 mock 掉了，而 `draftStore.assertFresh` 的产生处从没被问过 `kind`。新增的 `apps/web/src/agent/legacyCompatibility.test.ts` 因此只钉这道缝：四类过期各自取值 + 四词互异，外加"纯 `dynamic.*`/`parameter.*` 计划不动用户工作区"这一格旧用例没覆盖的承诺。两次变异（epoch↔generation 互标）在 **45 个旧用例全绿**的情况下让新文件真红。**Task 1 完成不代表用户那道折面题能画出来**：Task 2 及以后一项未开始，`solid.create_segment`、共享预算与整道题照旧未解决。逐条读数见[变更记录](../CHANGELOG.md) 2026-10-12 那一节。

> **2026-10-11 四家族真题驱动升级（仅本轮研究与方案，非新产品能力）**：用户确认**新增高中作图范围**只覆盖三角形、圆锥曲线、函数/导数、立体几何；这不取消人工编辑、CAD/保存导出等已完成能力的兼容和现有受限 Lean 证明出口的补完。本轮已完成[真实试卷题型与作图需求调研](research/2026-10-11-four-family-exam-diagram-survey.md)，按卷别/题号给出来源等级和四族子型；**没有把转载卷的解答冒充独立答案金标**。唯一的下一步实施/进度台账是[作图、兼容、Lean 与缺陷总计划](superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md)，分别列 Agent 要改什么、现有功能怎么保、Lean 如何收口、旧 bug 如何验，不把调研留待以后。最新 22:36 用户轨迹先拿多面体画开放面、修复轮又编造 `solid.create_segment`，界面把未知动作泛称 JSON 形状错；原用户折面题仍未在真实 Agent 画出。今天这次同步**只改文档，不改变任何功能开关/预算、不运行付费 provider**；以下 2026-10-10/11 历史门禁数字不是本次文档后的新测试读数。

## 唯一执行顺序：Task 1→21（编号方案 2026-10-11 定；现状更新到 2026-10-12）

> **Task 1–19 已于 2026-10-12 完成（Task 19 是本机那一半：真桌面发行验收未做 ⇒ 不标"已发布自动证明"）；Task 20 进行中 —— 免授权那一半（事先冻结 + 离线分布 + 授权闸）已完成，付费那一步停在授权门口。** 未获授权就停在本编号、如实报告，**不自行发起付费请求、也不跳到 Task 21**。一个任务的 RED、GREEN、受影响旧功能复跑与验收记录不齐，不开始下一个。具体文件/命令/停机条件只在[主计划](superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md)维护，**逐条读数与各任务边界也在该文件 §7 表**；旧版 W0–W4/Task 14 起步是历史计划，不再指挥实施。

| 唯一编号 | 现状与下一步出口 |
| --- | --- |
| **Task 1–13** ✅ | **已完成（2026-10-12）**，逐条读数在下方同日各条与[主计划](superpowers/plans/2026-10-11-four-family-agent-upgrade-progress.md) §7。其中 **Task 13 的原用户那道折面题已端到端通过**（真实浏览器 / 草稿 / 确认 / 一步撤销，`e2e/agent-exam-solid.spec.ts`）；Task 13 记录的边界：**斜棱柱「明说倾角」已于 2026-10-14 收口**（新义务 `linePlaneAngle`，读得出、进 `lateralTiltDegrees`、并**从最终坐标量得出来**，见顶部同日条目）；**面上点与展开今天仍没有产品入口 / 读取器**。 |
| **Task 14** ✅ | **已完成（2026-10-12）**：代数直线∩圆锥曲线（含**竖直线**、相切/无交）、条件反求曲线参数、`conicChord` 义务与判据（**丢一交点会红**）、`e2e/agent-exam-conic.spec.ts`（正例 + fail-closed 反例）。**边界**：反例那一侧的浏览器读数是 fail-closed、而不是"面板上出现一条红"（后者在单测里）；**弦长 / 面积已于 2026-10-14 量清并收口** —— 面积本来就通（只要图上有那个点名），弦长补了 `弦 AB 的长为 n` 与 `|AB|=n` 两条读取器（此前那句题设被**静默丢掉**），见顶部同日条目。 |
| **Task 15** ✅ | **已完成（2026-10-12）**：函数与导数的证据分级（`algebraic` / `verified-numeric` / `plot-only` + `complete`）、外点双切线 / 公切线 / 多交点四真题形状、四类反例（断点被连线 / 错切点 / 漏近重根 / 参数实例≠全称）、判据侧断点集合与可导性、报告的证据范围三字段、`e2e/agent-exam-function.spec.ts`（断点题 + 尖点 fail-closed）。**边界**：代数档只到二次多项式、`complete` 是数值完备性、外点/公切线无产品动作；**函数∩直线交点数已于 2026-10-14 收口**（新义务 `functionLineIntersections`，见顶部同日条目）。 |
| **Task 16** ✅ | **已完成（2026-10-12）**：画布证据面（从**已渲染的 DOM** 量盒子/标签 + 诊断码 + 相机看不见的点名，挂在画布根元素上）、证据绑**内容哈希**与 `renderEvidenceStaleness`（看哈希不看版本号；改题/撤销 与 切文档 分开；带截图不改结论）、`e2e/agent-exam-visual-and-stale.spec.ts` 四族各一次 **6 passed**；并**修掉本任务读数抓出的重复标签缺陷**（翻折题 `E`/`F` 各画两遍 ⇒ 折片副本不再挂标签 + 渲染层不拿图元 id 当名字）。**边界**：转出视锥无确定性产品做法、"取消拖动"不是现有动作、教师/学生签收未做；**3D 虚实线已于 2026-10-14 收口**（`hiddenEdgeSegments` / `hiddenEdgesShown` 由建它的那一层写进场景容器 dataset，`canvasEvidence` 转述成 `data-canvas-hidden-edges-shown` / `data-canvas-hidden-edges`，见顶部同日条目）。 |
| **Task 17** ✅ | **已完成（2026-10-12）**：`ProofScopeReport`（每条原题条件四档分类 + 源 span + 系统选择；结局 `limited_lemma` / `whole_problem` / `unsupported`）、`AutomaticProofResult.scope` 必填、升级文案写明"受限引理"；四受限目标原例保持。**边界**：`whole_problem` 在产品路径不可达（无完整命题产物）；"题设与图矛盾"不在范围报告里判；异步/UI 属 Task 18。 |
| **Task 18** ✅ | **已完成（2026-10-12）**：`ProofAttemptIdentity` + `proofAttemptStaleness`（六档过期判据、看哈希不看版本号、没绑哈希一律过期）、草稿层发起前捕获/跑完复查且 `previewOf` 每次重判、界面按范围分档（"受限引理已证"/"原题完整证明"/"过期"）并列出没进命题的条件、`e2e/agent-proof-lifecycle.spec.ts` 2 passed（浏览器降级 + 不挡作图）。**边界**：桌面真跑一次 Lean 后改题/撤销的 UI/IPC/版本证据未做（本机无桌面 + 工具链），判据在单测里钉住。 |
| **Task 19** ✅ | **已完成本机那一半（2026-10-12）**：`lean4Pin.test.ts` 4 条钉住工程定义（两处 rev 逐字相同且是 40 位 commit、mathlib4 URL、工具链具体版本、**README 不许说过期的话**，最后一条先真红）；实测 `lean --version` 与 `lake env lean --version` 同为 `4.35.0-rc3 / commit 470d5ce1…`、`.lake` 展开 7.00 GB（olean 8615 个）⇒ **零下载**；安全判据复核 74 通过 + `test:rust` 250 通过；`proof:smoke` 8 通过（十栏审查）；`test:lean` 8 passed / 1195.4 s（四类目标全 `formally_proved`、公理恰好三个白名单、`sorry` exit 0 判 `failed`、窄 import 64.4 s vs 全量 588.4 s）。**未做**：打包后干净/无网桌面验收 ⇒ **不标"已发布自动证明"**。 |
| **Task 20** | **进行中（免授权部分已完成，含"授权一到就能跑"的执行骨架；付费那一步等授权）**：样本按题号冻结（8 开发 + 4 留出，逐题带离线可跑性）、每族阈值与 `paidRuns: 0` 写死、`assertPaidRunAllowed` 四道门（**未授权一律拒**）、离线分布实测 **12/12 仍需真实 provider**、`examEvaluation.ts` 把记账口径与授权闸写死（零网络，8 用例）。**请求**：36 个请求 / 最高 $12。**未做**：真实 provider 读数（未授权不跑、不跳 Task 21）。 |
| **Task 17–19** | 已有四类受限 Lean 目标、默认关但可开启的实验入口、已 pin mathlib。原题完整前提、迟到产物、无网/发行仍未验；证明不可用不阻止正确作图。 |
| **Task 20–21** | 真实 provider 四族质量与发布未做；先冻结样本/阈值并获付费授权才运行 Task 20，否则停在本编号，不跳到 Task 21。作图与自动 Lean 在最终任务**分别**裁决。 |

下方 §一各命令及数量按**行内日期**阅读；历史 CI/浏览器成绩不等于这 21 项已执行。**下方 2026-10-12 各批记录里写的「下一项是 Task N」「尚未开工」「原用户那道折面题照旧未解决」都是各批当时的读数**，最新状态以本表与顶部第一条为准。Task 1–13 各轮只改产品/测试与文档，**没有增加模型预算、没有发起新的付费 provider 请求**；Lean 的读数只对当次运行有效。

> **同一件事的另外三张表**（各自切面不同，读它们时注意它们都是**镜像**）：
> [能力目录](feature-catalog.md)（按能力列）、
> [发布门禁](acceptance/agent-release-gate.md)（按门槛列，回答"能不能放行"）、
> [记分卡](acceptance/agent-tool-loop-scorecard.md)（按阶段与 flag 列）。
>
> **这是"现在时"的唯一一处。** 本文件只回答三个问题：现在能跑吗、已经做完什么、还差什么。
> **阅读职责（2026-10-06 复核）**：现时证据以本页为准；逐块 V0a–V3 状态看 [下一轮任务追踪](agent-next-round-progress.md)；能否放行看 [发布门禁](acceptance/agent-release-gate.md)，旧 N1–N6 的开关/依赖实测见 [历史核查](acceptance/next-phase-flag-and-dependency-review.md)。旧 [Agent tool-loop](research/2026-09-28-agent-tool-loop-progress.md)、[高中立体交互](research/2026-09-29-high-school-geometry-interaction-progress.md) 与 [第一周验收](acceptance/2026-09-12-week-one.md) 均只代表各自当时快照。
> 历史过程（每一轮的 RED→GREEN 证据、被推翻的方案、实测读数、误报清单）在
> [`docs/project-progress.md`](project-progress.md) —— 那是**归档**，里面的数字是"当时实测"，
> 不是当前值。两份文件分工明确：**要当前值看这里，要过程看归档。**

> **2026-10-11 翻折题现场批次（四处修复，**仍然没画出来** —— 诚实记）**：用户那句题在桌面端到 16:27 为止试了 **6 次、每次死因不同**（读数从桌面端自己的库 `%APPDATA%\com.mathcanvas.desktop\projects.db` 读出；**界面上的轨迹是截断的**：`参数：…(+674 chars)`，所以判据不是从界面抄的）。**四处已修**：① `92fea57` **不认识的 `relations` 条目不再作废整份计划** —— 第 4 次尝试**四边形已经画对了**（五条条件按它给的坐标逐条自算全中），却被一个**自愿补充**字段（提示词原话："关系由系统自己从题面里读，你不需要声明它们"）整份丢掉；改成**丢掉那一条 + 以 `warning` 如实报告**（`ParseResult` 成功分支新增 `notes` 通道）。② `2e552df` / ③ `f5f8bcc` **报错里点名正确的动作** —— 第 1/3/5 次都拿 `solid.create_polyhedron` 去拼**开放**图形（四边形 + 翻折片），引擎回的"至少四个面 / 顶点"很准但**没告诉它该用什么**；现在传输层（面数/顶点数不够）与编译层（面环面积为零 / 三点共线）都说同一句话：开放图形用 `solid.create_face` 一张一张建。④ `36b760a` **编译类修复 1 次 → 2 次**（用户裁决"可以"）：第 5 次是"几何校验花掉编译类 1/1 → 修复轮写成字符串花掉信封类 1/1 → 第三次死在 `action_compile` 却没有额度了"，与 2026-10-10 修好的那个病同一个、只是病在更高一层。**但第四处到写记录时并没有生效**：第 6 次（16:27，三处修复后的新包）的读数是 **`budget exhausted: budget_repair`**，且这一轮**只问出去 2 次**。查账：每次问模型扣 1 generation + 1 network，**修复那一次再扣一次**（`coordinator.ts` 436），模型用过只读工具再继续那一批**又扣一次**（`modelPlanner.ts` 544），而默认共享预算是 **`generation: 4` / `network: 6`** ⇒ 原始 1+1、工具批 1+1、修复 2+2 就把 generation 归零，第 3 次问不出去。**所以真正的闸是共享预算，不是修复次数**；副作用是失败文案从"编译错误的原话"变成 `budget exhausted: budget_repair`（**对用户更没用**）。**没有动预算** —— 那是"每次运行允许烧多少次模型调用"的成本决定，要用户点头。**仍未解决（诚实列全）**：① 那条题仍然画不出来（6 次尝试没有一次走到"图落地"）；② 第 6 次模型把计划包进了 `{"arguments": "<计划字符串>"}`（工具通道的壳塞进了载荷 ⇒ `envelope.kind` 是 `undefined`），这是**通道 / 协议**那一类，不在本批四处修复的范围；③ 预算与修复次数的关系（要么 `generation` 提到 6，要么让修复那一次不重复扣）等用户裁决；④ 二期（`E`/`F` 定比分点与"折"的坐标）照旧没做，模型仍在手写 `P` 的坐标。门禁：四处各自先红后绿（变异证明），全库 **253 文件 / 2885 通过 + 1 todo / 0 失败**，`typecheck` exit 0，每次修复后重打包 + 冒烟通过。逐条读数见 [变更记录](../CHANGELOG.md) 同日第一节。

> **2026-10-11 乙案一期已实施：那句题面里的 `B`、`C`、`D` 现在由系统自己造出来，模型不再手写坐标**。上一条记着"平面那四个点仍要模型自己给对 —— 现场它给的 `C` 两个条件一个都不满足"，这一批治的就是**这一类**（[设计](superpowers/specs/2026-10-11-declarative-figure-construction-design.md) 的 §6 取舍：坐标"可选，但**永不静默采信**"）。**Task 0 先量后写**：那五条条件按"`A` 在原点、`AB` 沿 `x` 轴"闭式解出、逐条回代全过，`C` 由 `∠ADC=90°` 与 `CD=3` 定出 `(9, √3)` 与 `(6, 4√3)` **两个解**、**只有前者不自交** —— 所以设计里那句"取不让四边形自交的那一支"是**可判的**；**Task 3 的第一步也量了**：把 Task 2 的规格直接喂 `searchWitness`，得到 `missing-apex: 棱锥的形状描述里没有顶点`（候选池把平面规格交给了**棱锥**），这条读数把 Task 3 从"可能只是复用"改判成"确实要写内核代码"。**四批各自单独提交**：① `4209efd` 内核新增**第四族**（环 + 题面条件 → `z = 0` 上的坐标；两条闭式落位规则 + 逐点 DFS 展开多解 + **按最终坐标逐条回代** + **不许自交**取舍；角的判据复用 `interiorAngleDegrees`、自交判据复用 `hasSelfIntersectingPolygon` —— 两个判据各自只有一份实现），并按 `family` 分派（此前平面规格落到棱锥支被 `missing-apex` 拒掉）；② `b989b6c` **失败三分**三个机器可读码（`underdetermined-planar` 逐点说清缺哪一类条件 / `contradictory-planar` 说出**哪两条、差多少、实测多少** / `unsupported-planar-condition` 如实说没有构造器并列出认得哪几类，且把 `dihedral` 印成「二面角」而不是机器词）；③ `3079776` **管线接线与来源标注**（`withWitnessCoordinates` 也接受**平面片**宿主 —— 用户那题的动作用的是 `solid.create_face`，只认多面体这一族**永远接不进**替换；成功那句假设改成明说"坐标由**系统按题面条件构造**、不是模型给的"；构造不出时新增一句**不可覆盖**的"这份坐标是**模型给的、未经条件构造**"）；④ `bcafcfc` **管线级证据**（装配好的运行时上：文档里确实有 `A`、`B`、`C`、`D`、`E`、`F`、`P`，且 `|AB|=8`、`∠ADC=90°`、`|CD|=3`；反证 = 关掉开关同一份计划 `compile_failed`）。**两处期望有意改了**：`planCompiler.test.ts` 原先钉"开关打开 = 关闭，逐字节相同"，那条守的是"开关不会悄悄换图"，而来源标注是**有意新增**的 ⇒ 判据改成"去掉标注后逐字节相同，且**恰好一条**标注"；关旗 golden 一个字没动、同一趟全库里逐字通过。**变异**：把平面宿主那一支短路（等价于"退回模型坐标"）⇒ Task 5 与 Task 6 那两条护栏**真红**，还原复绿。**门禁**：`typecheck` exit 0；`lint` 0 error / 13 warning（中途我自己引入的两条未使用变量警告已清）；全库非 Lean **356 文件 / 4193 通过 + 1 todo / 0 失败**；全量 e2e **223 通过 / 0 失败 / 0 抖动**（1.9 m）。**仍未解决（诚实记，两条都属于二期）**：① **模型若压根没有声明那只平面四边形**（现场那一版就是，图上只有 `A`、`E`、`F`、`P`），救回路径**没有宿主可以替换**，`B`、`C`、`D` **仍然不在图上** —— 这一条被**钉成了一条用例**（读数：那一轮编译其实**成功**，五条题设全部**未核验**、理由是"点名缺失：`B` —— 题面点到了它，图上没有这个对象"，而"未核验"按本仓口径**不是失败**；来源标注也在，走成功路径的 `completionAssumptions`），它是设计 §2 的分工（**模型必须声明结构**）而不是缺陷被放过；② **折那一笔（`AEF → PEF`）的坐标仍旧是模型给的**，二期把定比分点（`E`、`F`）与折接进同一份规格，「折至 `PC=4√3`」那种对条件求根也在二期；三期才谈把坐标从模型输出里拿掉。**另如实记一条**：这一批的**管线级证据没有产生新的生产代码** —— 计划里写的"红 → 接通 → 绿"在那一条上不成立（Task 5 的接线已经交付），它首跑就是绿的，价值是运行时边界的回归护栏，这一点由上面的变异证明。逐条读数见 [变更记录](../CHANGELOG.md) 同日那节。

> **2026-10-11 翻折批次（一个真缺陷 + 两格能力缺口）**：用户那句「平面四边形ABCD … 将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3」连发 7 次、**7 次死因各不相同**，逐条归因后是**三件互不相干的事**。① **真缺陷**：草稿只在第一次暂存时建一次、绑死在当时的文档上，而 `epoch` 由 `document.metadata.id` 派生、`switchWorkspace` **就是换文档** —— 于是修复轮一旦换了动作族（现场 1 个动作 → 8 个动作），工作区被切走、草稿立刻过期、整轮 `stale_draft`；现场那两个事件之间只隔 **1 毫秒**，正是"失败发生在编译**之前**的校验里"的形状。改法：把"为什么过期"从一句给人读的 `detail` 变成**结构化判据**（`FreshnessKind`），并让宿主把"**这一轮自己**换了工作区"如实带进暂存请求（`runSwitchedWorkspace`）—— **两条同时成立才重建**，用户手工编辑（`generation` / `content`）与用户导入 / 打开文件**照旧拒绝**。② **题面读不懂**：八个从句只读懂四个 —— `AD=5√3` 是长度句型后面跟 `√`、命中一道**刻意的守卫**、整条匹配被丢弃；`AE:AD=2:5` 是残留扫描器**早就把它当条件看**、却没有读取器接它。而关口是"**只要还有一条题设没核验就不放行**"⇒ **只加一个"折"的动作，这道题一个字都不会变**（它会在核验那一关被拦下，与折无关）。补上**根号数字**与**冒号比例**两条句型之后，同一句原话读出**全部 8 条题设、0 条未核验**。③ **没有"折"这个动作**：新增 `solid.fold` —— 模型只报**折前**的平面坐标、折痕（`{from,to}`，复用既有的 `namePair` 约定）、被带走的点与折角，**折后的坐标由内核的刚体旋转算出来**（与展开共用 `rotateAboutAxis`，只是把它导出了）。**最硬的判据是闭式旁证**：拿那道题的**真坐标**折 90°，内核算出的 `PC` **恰好等于 `4√3`**（`6.928203230275509`）；把旋转短路成恒等做变异 ⇒ 那一条报出 `9.165151389911681`（正是 `|AC|`）真红，还原复绿。门禁：`typecheck` exit 0、`lint` 0 error / 13 warning、全库非 Lean **354 文件 / 4169 通过 + 1 todo / 0 失败**、全量 e2e **223 通过 / 0 失败**。**当天晚些时候，用户在 3.3.13 上复测、当场报回下一个死因**：`stale_draft` 没了、题面八个从句也全部读出来了，却卡在 **`validating`** —— 八条题设**全部**报「候选图缺少唯一、可靠的顶点名映射；不能按题面顺序猜坐标」，而图其实画出来了。**根因是本批自己引入的回归**：`candidatePoints` 只认 `solid.create_polyhedron` 与 `solid.create_face` 是"产出面的动作"，**不认 `solid.fold`** —— 而折也物化出**一只新的 `face3`**，于是"计划里 1 笔建面 + 1 笔折"对应"候选图里 **2** 只新面"，数量判据对不上 ⇒ 整张点名表判为不可靠。修法：折也算进"产出面的动作"，且核验器**复用编译器那份**改名规则（折会把被带走的点改名：`A` 折完叫 `P`；规则提出来导出成 `foldVertexNames`）。判据 `diagramFoldPoints.test.ts` 两条**先红后绿**（红时报的就是用户贴回的那句话）；门禁复跑 **355 文件 / 4171 通过 + 1 todo / 0 失败**。**这一条单独值得记**：它是上一批自己带出来的回归，而且**只有在真机上跑一次才会现形** —— 当时单测面是全绿的，坏的是折对下游核验器的**可见性**。**仍未解决（诚实记）**：平面那四个点仍要模型自己给对 —— 现场它给的 `C` **两个条件一个都不满足**（`|DC| = 2.34`、`∠ADC ≠ 90°`），**折做完不等于这道题一定画得出来**；「折至 `PC=4√3`」那种对条件求根是**第二期**，本期只做"折给定角度"。设计见 [翻折设计](superpowers/specs/2026-10-11-fold-flap-design.md)，逐条读数见 [变更记录](../CHANGELOG.md)。

> **2026-10-10 审核口径（以本段与§一当前读数为准）**：`4245e93` 已在远端 `main`；§一 CI 行的最近列举 SHA 早于该 HEAD，**未在本次审核核对该 HEAD 的 CI 结果**；3.3.10 是现场构建批次，**不是已发布的 GitHub Release**（远端版本标签仍为 `v3.2.0`）。本轮实现了常见题面写法、受限题面改写、按失败类别分配修复额度、`solid.create_face` 与统一面环判据；测试通过不等于原用户题已复测成功。最新共线面环仍被正确拒绝；`翻折至…PC=4√3` 尚无覆盖，真实 provider 对新报错是否能修复未测。V0 四家族有机器证据、仍待教师/学生走查；V2 四种受限证明目标有本机证据，**原题完整前提、桌面真实 UI 自动往返、发行工具链仍未验收**；V3 样本与人工读图不足，默认 Agent/自动 Lean 不放行。MSI 装/启/卸是**用户报告通过，控制器未旁观**，不再列为未做。详见 [发布门禁](acceptance/agent-release-gate.md) 与 [下一轮进度](agent-next-round-progress.md)。

**最后更新：** 2026-10-19（**泛化问题任务表已落档：6 个 Part、24 项，P0 是模型/通道、计划清洗与救援组合、LaTeX/OCR 归一化；本轮只改文档。详见 [任务表](agent-generalization-task-list-20261019.md)。**）**此前一条：2026-10-17（**真实 provider 12 道画图评测：配置默认实际是 flash，v4-pro 更强但格式/成本代价明显；题设全过仍为 0。详见 [评测记录](agent-drawing-eval-20261017.md)。**）**此前一条：2026-10-16（**Task 20 免授权部分第三块：产品侧适配器接上** —— 新 `apps/web/src/agent/fixtures/examRunAdapter.ts`（+ 4 条用例，零网络）：`createExamRunCase` 调一次规划器端口并把结果按 core 的**唯一一处**映射（`examTrialOutcomeOf`）记成试验结局；费用由注入的 `costOf` 给、抛错记 `error` 不吞；**边界**：修复回路在协调器里 ⇒ 这条适配器一律 `repaired: false`，真跑时 `repairedCount` 会是 0（要么接协调器的标记，要么如实读成"没走协调器"）。全量 375 文件 / 4422 通过 + 1 todo / 0 失败。**付费实测仍等用户点头（36 请求 / 最高 $12）**；未授权不跑、不跳 Task 21）。**此前一条：2026-10-12（**Task 20 免授权部分补齐第二块：「授权一到就能跑」** —— 新 `examEvaluation.ts`（+ 8 条用例，零网络）把记账口径写死：pass@1/pass@3 分栏、同轮修复单独计、人评没标为 `null`、阈值只对照不改写、少跑一条就抛；`runExamEvaluation` **第一件事是过 `assertPaidRunAllowed`**（未授权时一次 `runCase` 都不调用）；`examRequestPlan` 打出请求清单 **36 请求 / 最坏 $10.35**。冻结表、离线分布与授权闸见上一条。**付费实测仍等用户点头（36 请求 / 最高 $12）**；未授权不跑、不跳 Task 21。全量 374 文件 / 4417 通过 + 1 todo / 0 失败）。**此前一条：2026-10-12（**Task 19 Lean 工具链/安全/发行：本机那一半完成** —— 新 `lean4Pin.test.ts` 钉住 `proof/lean4` 的工程定义（两处 rev 逐字相同且是 40 位 commit、mathlib4 URL、工具链具体版本），并**改掉 README 里与事实矛盾的那一段**（"manifest 不进仓库""换台机器复跑不保证同一份 mathlib"）；实测 `lean --version` 与 `lake env lean --version` 同为 `4.35.0-rc3 / commit 470d5ce1…`、`.lake` 展开 7.00 GB（8615 个 olean）⇒ **本批零下载**（停车条件未触发）；安全判据复核 74 通过 + `test:rust` 250 通过；`proof:smoke` 8 通过（十栏审查）；`test:lean` **8 passed / 1195.4 s**（四类目标全 `formally_proved`、公理恰好三个白名单、`sorry` exit 0 而判 `failed`、窄 import 64.4 s vs 全量 588.4 s）。**未做**：打包后干净/无网桌面验收 ⇒ **不标"已发布自动证明"**；**下一项 Task 20 的停车条件：先要付费 provider 授权**）。**此前一条：2026-10-12（**Task 18 证明产物异步绑定与可读 UI 完成** —— 新 `ProofAttemptIdentity` + `proofAttemptStaleness`：一次证明"回来时还算不算数"按**草稿 id / 内容哈希 / claim / 目标条件出处 / inputHash / 后端版本**六档判，**看哈希不看版本号**，没绑哈希一律过期；草稿层发起前捕获身份、`previewOf` 每次重判（改题之后那一栏会翻 `stale`），过期不抹掉产物；面板按范围分档显示"受限引理已证"/"原题完整证明"/"过期"并列出**没进命题的题面条件**；新 `e2e/agent-proof-lifecycle.spec.ts` 2 passed（浏览器没有桌面工具链 ⇒ 如实"没跑成"、**且不挡作图**）。全量 370 文件 / 4396 通过 + 1 todo / 0 失败，全量 e2e 237 通过；**下一项是 Task 19**，它带停车条件：首次下载/升级 mathlib/复制缓存/改发行体积需先获用户同意）。**此前一条：2026-10-12（**Task 17 Lean 原题前提与受限引理分级完成** —— 新 `ProofScopeReport` 把"这一次到底证了什么"变成结构化字段：每条原题条件落 `formalized` / `dischargedByNamedDerivation` / `figureAssumption` / `notRepresented` 四档之一（带原话 span 与系统选择），结局默认 `limited_lemma`；题面多一条必要条件时产物照样出、但范围报告说它没进命题；**后端没验过永远不是整题**，`whole_problem` 还要求调用方显式交出完整命题产物声明（今天没有调用方给得出它 ⇒ 产品路径不可达）；`AutomaticProofResult.scope` 必填，升级文案写明"受限引理"。四受限目标原例保持（proof 全目录 172 通过）。全量 370 文件 / 4386 通过 + 1 todo / 0 失败，全量 e2e 235 通过；**下一项是 Task 18**）。**此前一条：2026-10-12（**Task 16 真实画布与过期证据完成** —— 证据绑**内容哈希**（`documentHash` 必填 + `renderEvidenceStaleness`：看哈希不看版本号，改题/撤销 与 切文档 分开，带截图不改结论）；新 `apps/web/src/canvasEvidence.ts` 从**已渲染的 DOM** 量对象盒子与点名标签，诊断交给既有 `diagnoseLayout`，画布根元素挂出哈希/计数/诊断码/相机看不见的点名；**3D 如实标"对象量不到"**而不谎报画布为空；新 e2e 四族各一次 **6 passed**（测试自己规范化、`crypto.subtle` 摘要来比对）；**并修掉读数抓出的重复标签缺陷**（翻折题 `E`/`F` 各画两遍 ⇒ 折片副本不再挂标签 + 渲染层不拿图元 id 当名字）。全量 369 文件 / 4377 通过 + 1 todo / 0 失败，全量 e2e 235 通过；**下一项是 Task 17**）。**此前一条：2026-10-12（**Task 15 函数与导数真题纵向交付完成**：新模块 `function-evidence.ts` 把外点双切线 / 公切线 / 多交点做成有读数的内核能力，证据分 `grade` + `complete` 两个字段；四类反例（断点被连线 / 错切点 / 漏近重根 / 参数实例≠全称）先真红后转绿；判据侧 `functionGraph` 判断点集合、`tangentAt` 判可导性与整条直线是否相切；报告新增 `proofScope` / `universalClaims` / `proofScopeNote`（`universalClaims` 只有 `not-proven`）并在面板显示；新建 `e2e/agent-exam-function.spec.ts`，黄金样本按"差异恰好是那三个字段"有据修订一次；全量 368 文件 / 4364 通过 + 1 todo / 0 失败；**下一项是 Task 16**）。**此前一条：2026-10-12（**Task 14 圆锥曲线真题纵向交付完成**：先修掉一条 P0 级轴向缺陷（双曲线 `axis` 在三处实现里与声明相差 90°），再补代数直线∩圆锥曲线（含竖直线）、条件反求曲线参数、`conicChord` 判据（**丢一交点现在真的会红**）与 `e2e/agent-exam-conic.spec.ts`；**下一项是 Task 15**）。**此前一条：2026-10-12（Task 14 开始，先修掉一条 P0 级轴向缺陷**：双曲线的 `axis`（实轴）在三处实现里与声明相差 90° —— 采样器 / 隐式形式 / 约束，先红后绿；顺带修 `annotations.ts` 的顶点距离与那句"只认 ellipse"的过期注释）。**此前一条：2026-10-12（Lean 慢集成单列**：默认全量已排除 `lean4EndToEnd`，另建 `vitest.lean.config.ts` + `npm run test:lean`；顺带把"两个 6"的账对上）。**此前一条：2026-10-12（三件收口**：Lean 冷启动单独预热、`fileExports` 的 CAD 用例改显式 30 s、两条待裁决落地）。**此前一条：2026-10-12（Task 13 完成**：原用户那道折面题**已端到端通过** —— 真实浏览器 / 草稿 / 确认 / 一步撤销，`e2e/agent-exam-solid.spec.ts` 1 passed；链路是四个坐标 ⇒ 系统按定比分点建 `E`/`F` ⇒ 折叠**按点名取点** ⇒ 折角按 `PC=4√3` **反求**；负例（缺 `C` 的面片 / 错的折角 + 缺 `C` / **手写的 `P`**）都挡得住；**边界**（斜棱柱明说倾角、面上点、展开）见上方 2026-10-12 第一条。**此前一条：2026-10-12（Task 1 旧功能兼容基线完成**：定向切片改动前 6 文件 / 120 项**全绿** ⇒ 本切片无旧红可归因；四处故意破坏各自先红后绿、变异源码逐字节还原；新增 `apps/web/src/agent/legacyCompatibility.test.ts` 只钉两处此前无人守的缝 —— `draftStore.assertFresh` 的结构化过期判据（消费方 `committerAdapter` 的用例把这个值 mock 掉了，两个方向的错标都能穿过 45 个旧用例）与 `planWorkspaces` "纯中性动作不动用户工作区"那一半承诺。**本批无产品代码改动、未修任何 bug。**见上方 2026-10-12 对应条与[变更记录](../CHANGELOG.md)）。**此前一条：2026-10-11（**翻折题现场批次：四处修复，仍然没画出来** —— 见上方 2026-10-11 的第一条：`92fea57` 不认识的 `relations` 条目不再作废整份计划（第 4 次尝试其实**把四边形画对了**）、`2e552df`/`f5f8bcc` 报错里点名"开放图形用 `solid.create_face`"、`36b760a` 编译类修复 1→2 次；**第四处到写记录时并没有生效** —— 第 6 次死在 `budget exhausted: budget_repair`，真正的闸是 `generation: 4` 的共享预算，没动它（要用户点头）。**此前一条：2026-10-11 乙案一期已实施**：见上方同日的第二条 —— 内核新增"由度量条件构造平面图形"那一族（`4209efd`）、失败三分（`b989b6c`）、管线接线与坐标来源标注（`3079776`）、管线级证据（`bcafcfc`）；那句题面里的 `B`、`C`、`D` 现在由系统自己造出来，逐条读数与两条未解决项都在那一条里。**此前一条：2026-10-11 翻折批次**——一个真缺陷（修复轮换工作区 ⇒ 草稿过期 ⇒ `stale_draft`）+ 两格能力缺口（题面根号与冒号比例读不懂、没有"折"这个动作），三批各自过了门禁；逐条读数与未解决项都在那一条里。**此前一条：2026-10-10 现场修复批次 3.3.0 → 3.3.10**：① 三种"随手写法"被读懂（`AD=2AB` 这种两条线段的倍数 / `底面`·`面`·`平面` / `设 …（即 …）` 重述从句）；② **题面规范化通道**（读不懂的从句交给模型换说法，**四道阀**：逐字指回原文、不许编点名、关系词不许换族、改完必须能被同一解析器读出；改写随 `stage` 走到草稿层，两层读同一份题面，并在确认面板摆出「**原件 → 我这样读**」）；③ **只读工具不再按次吃 `generation` 额度**（现场死因：3 个只读工具 = 3 代 ⇒ 修复扣不动 ⇒ `budget exhausted: budget_repair`）；④ **立体工作区新增 `solid.create_face`（平面多边形 / 面片）** —— `face3` 图元与渲染 / 拾取 / 面板 / 导出早就都有（手工工具「绘制空间面」），缺的只是 agent 入口；⑤ **面环判据三条口径统一**（点互异 / 面积 / 共面原先三套写法）+ **判据尺度分两种** + **三条一次全报** + **每条报错指名"哪个环、差多少、为什么"**。逐条读数、变异与未解决项见下方同日块。**此前一条：题面点到的点由系统兜底补建已落地**：`O为 BD的中点` 那一类题不再必然失败——编译器按题设补建"位置被题设唯一确定"的点（中点 / 定比分点），核验理由说清缺谁，用户话术不再叫已经点过名的用户"补充点名"；判据、两次真红变异与一次**没红**的变异见 [变更记录](../CHANGELOG.md) 同日那条，**浏览器证据仍为空**（原因写在那里）；**S3.4 已解除**：题面驱动的棱柱正例在浏览器里跑通；上一次为 2026-10-09 文档复核，产品证据截至 2026-10-07 的 `04bfed9`）。S1/S2 已落地，S4 台体、S5 球有受限界面/浏览器证据；**S3.4 已解除** —— 根因是**关系抽取的"点名块"字母表不含 `′`**（`AA′` 被读成退化的 A–A 线段 ⇒ `relation_not_satisfied` ⇒ 吃掉唯一一次修复 ⇒ 面板不出现），修法与读数见 [变更记录](../CHANGELOG.md)；S3 的斜棱柱 / 菱形底面与 S6 入口**已在随后收口**。以下历史段落保留当时口径，现时以本页 S1–S6 摘要与 §四 F 为准。**用户新范围只含需要作图的高中数学题**：三角/三角函数图、圆锥曲线、导数/函数图像及立体几何是首批；每题的实际作图需要优先于章节默认分类。旧 2025 课程 43 条来源/141 一级项是历史参考，不是本轮发布分母。现行 [V0–V3 设计](superpowers/specs/2026-10-06-diagram-scope-addendum.md)、[实施计划](superpowers/plans/2026-10-06-diagram-agent-auto-lean-implementation-plan.md)、[任务进度](agent-next-round-progress.md) 中，V0 的四家族（V0a 立体自由顶点 / V0b 平面三角 / V0c 圆锥曲线 / V0d 函数图像与切线）**测试面与浏览器证据均已齐**：各有本地入口、独立回代判据（读草稿里真实落盘的坐标或参数自己算，不读面板结论）、草稿层与 Worker 守卫、以及六张已目视核对的截图（`docs/evidence/`）；题设核验的触发已收成一份 `planHasVerifiableFigure`（多面体 / 平面点 / 圆锥曲线 / 函数曲线与切线，编译期与草稿层共用）。V0 的**入选侧**仍是：4 个图形候选子型、3 个默认非图、134 个尚未审题型；四类各 3 条原创建模候选（包含 4 条可取自由参数的欠定例）。**但"四家族测试面齐备"不等于"四家族交付"**：计划的 `V0 出口` 明写"没有 e2e 与**人看图确认**时保持未勾" —— 机器那半已给全，**教师/学生目视走查未做**、自动 Lean 尚未放行（后续已有本机受限真跑与产品调用点，但桌面 UI/发行链未验收）、真实 provider 的作图正确率与成本未测。此前 N1–N6 旧范围的有限见证/拖动安全、provider 小样本/费用空缺及只证明一类条件引理均是基线，不可平移为 V0–V3 完成。当前门禁读数在 §一、未完成项在 §四。

> **2026-10-10 §3-F 最后一项（空间"线重合"的求解）设计已写，并按推荐的自主决定记为"暂不实施"**。设计见 [空间线重合设计](superpowers/specs/2026-10-10-spatial-line-coincidence-design.md)。**查实一件改变优先级的事：今天没有任何产品入口能声明一条空间重合约束** —— 题面解析不产出它（`diagramObligations` 的关系种类里没有，`witnessSearch` 的注释直说这一类"根本没有对应类型"）、`actionIds.ts` 的 `DRAFT_ACTION_IDS` 里**没有**约束类动作、`apps/web/src` 下**没有**约束编辑器组件（`*onstraint*` 一个文件都没有）；而 `capabilities.ts` 却把 `constraint-authoring` 记为 **`available`**（平面 + 立体）—— **能力表说它可用，产品面上却没有一处能创建它**。所以判据与求解做出来**也没有用户路径**。**探针另照出一处口径分叉**（2026-10-10 实测，跑完即删）：拿两条异面线段建 `coincident` 与 `parallel`，`constraintResidual3(coincident)` 是 **`null`**（`parallel` 那条是 `0.7071…`，无量纲）；**单数**入口 `diagnoseConstraint3(coincident)` 给一条"算不出来"的诊断（`residual: null` / `satisfied: false` / `缺少有效空间来源`），而**复数**入口 `diagnoseConstraints3([coincident, parallel])` **只返回 `parallel` 那一条**（`coincident` 被 `filter` 掉了）—— 两个公开 API 对"文档里有没有一条没判过的约束"给**不同答案**。**但这与拖动无关**：拖动层读的是那张 `planar-only` 分类表（`isPlanarOnlyConstraint3`）而不是诊断列表，所以碰到重合约束的拖动才被拒（`unsupported_spatial_constraint`，理由是 `planar-only`）；**把这条分叉修好不会自动改变拖动** —— 设计页里第一版把因果写成"分叉 ⇒ 拖动只能一律拒绝"，**已当场改正**。**设计给的方案**：阶段 A 补判据（残差 = `max(方向项, 位置项)`，与 `parallel` 同一条无量纲尺子；`diagnoseConstraints3` 不再静默 filter；`planar-only` 那三处同步成一处真源；拖动的"保住重合"从拒绝变通过）→ 阶段 B 照**二维那条现成规则**求解（方向对齐 + 中点投影 + 保长；`CONSTRAINT_PROJECTION_DECISION.coincident` 从 `planar-only` 改成 `project`）。**护栏**：不许把"重合"降级成"平行"（必须有一条**平行但异面**的反例会红）。**为什么暂不实施**：入口三选一（题面 / Agent 动作 / 界面）各自缺需求证据，先做判据与求解只是加一层看不见的能力 —— 这是按用户"自主模式、直接选推荐方案"的授权做的决定，记在案，不由本轮替你拍板产品方向。

> **2026-10-10 §3-F 阶段 B（B1）已实施：环外点参与的数值角 `∠PBA=60°` 从"什么都出不来"到"能造、能核"**。前一版设计里那句"今天什么都出不来"现在**只剩 B3 与棱柱那两支**。**改的是内核两处**：`deriveApexHeight` 的 `free` 分支新增 `solveApexAngleHeight`（自由高不再是常量，而是**按那个角有界求根**解出来的标量 —— 与二面角 `solveDihedralHeight` 同一套：2048 步扫描 + 200 步二分、容差 1e-9°、取最小正根、无 RNG、单调性不假设、量最终坐标）；`deriveBasePolygon` 的四边形拒绝文案把"底面缺什么"与"那个角为什么帮不上忙"**分开报**。新增两个机器可读拒绝码 `contradictory-angle`（**算出来的**矛盾）与 `unsupported-angle-shape`（形状出范围 / 联立 / 范围内没有根）。**失败三分照设计落地**：角与高有关 ⇒ 用根；角与高**无关且等于题面值** ⇒ **冗余成立**（`∠DAB=90°` 这一种，高照旧系统自选、文案说明"由其它题设必然成立"）；无关且不等于 ⇒ **如实报矛盾**（说出恒为多少度）；随高变但取不到 ⇒ 如实拒绝并**报出实测变化范围**。**判据 11 条**（内核 7 + 搜索层 4；改动前 6 条真红），含**护栏**：斜棱柱 + 菱形底面 + `∠A′AB=60°` **仍然不通过**（方程形状与 B1 一样，但那是早已裁决不做的"用角钉死侧棱方向"），而去掉角那句仍 `verified_instance`。**变异**：把求根扫描上限改成 `0` ⇒ **两层同时真红**；还原 11 条复绿。**实施时被自己的判据抓住三个坑**（前两个把设计页写错的地方改正了）：① `dynamic-measurements` 的 `angleBetween` 是**二维**原语（只读 `x`/`y`）—— 顶点沿 `z` 抬高时把角**恒量成 0°**，四条判据当场红；改用与核验器同一条规则的**空间内角**；② 角与高无关时"任何高都满足它"，扫描会立刻找到根，照根那套文案会把"角定不了高"说成"高由角求出" ⇒ 改成一次探测同时给 `{root, low, high}`，**常性决定话怎么说、根决定图能不能画出来**；③ 第一版把 markdown 的 `**` 写进了**逐字渲染**的面板文案，被判据照出、已清掉。**读数**：`typecheck` exit 0；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4151 通过 + 1 todo / 0 失败**；全量 e2e 首跑 **221 通过 / 1 失败** —— 那条是**环境级** `page.goto: net::ERR_NO_BUFFER_SPACE`（浏览器缓冲耗尽，不是产品行为），**孤立复跑 7 passed**，按本仓口径记成抖动、**不**说成全绿。**仍未做（照旧）**：B3（`∠APB`，要两个以上未知量）、棱柱侧棱方向的角（护栏挡住）、棱柱顶环上的角；**浏览器证据已在同一块之后补上**：`e2e/agent-apex-angle.spec.ts`（走真内核路径、判据自算 ∠PBA=60° 并用 `h=|AB|·tan60°` 做旁证；"能咬人"由只回退内核源码的对照实验证明 —— 回退后面板原文 `failed-given: ∠PBA=60°：实测 45.000`）。

> **2026-10-10 §3-F 阶段 B 设计（`∠PBA=60°`）—— B1 已于同日实施，这一段的"今天"是实施前的实测（保留作对照）**：① `∠DBA=60°`（顶点在环上、一条腿到顶点）**什么都出不来**（`no_witness`，`failed-given: ∠DBA=60°：实测 45.000，题设要求 60`），而它**明明有解**（这个角随顶点的高单调变化，`h = |AB|·tan 60°`）—— 失败是因为候选之间的差别不在高：`deriveApexHeight` 的 `free` 分支给的是**一个系统自选的常量**，搜索根本试不到别的高；② 四边形底面 + 顶点角报的**理由是错的**（说"底面缺少点名在 `A` 处的直角"，真相是那个角**在环外**、定不了底面的形）；③ 由其它条件**必然成立**的角（`∠DAB=90°`，`A` 是垂足）今天**已经通过**（冗余成立，不许弄坏）；④ **真矛盾**的角（`∠DAB=60°`）今天只报"没找到"，不说"题面自相矛盾"。设计按**点名形状**切成三类：**(i) 三个点名都在底环上** ⇒ 阶段 A（已做）；**(ii) 顶点在环上、恰一条腿的端点是顶点 ⇒ B1（本期做）**，未知量只有顶点的高，用**有界求根**（与二面角 `solveDihedralHeight` 同一套：2048 步扫描 + 200 步二分、容差 1e-9°、取最小正根、无 RNG）；**(iii)** 顶点本身成角或两条腿端点都在环外（`∠APB`）⇒ 不做。**"角与高无关"不是第四类，而是 B1 的一种结局**：恒等于题面值就是**冗余成立**（今天已通过，不许弄坏），恒不等于就**如实报矛盾**。棱柱的 `∠A′AB`（用角钉死侧棱方向）**早已裁决不做**，而它的方程形状与 B1 相同 ⇒ **要主动挡住**（实测"斜棱柱 + 菱形底面 + `∠A′AB=60°`"今天是 `no_witness`，去掉角那句仍 `verified_instance`）；棱柱**顶环上**的角（`∠A′B′C′`）数学上等于底环上的角，但要先有"环外环"的点名映射，本期也不做。**失败三分**（找到根 / 冗余成立 / 矛盾或没找到）是这一页要回答的新问题，"先求根、后判常"的顺序也在设计里写明。设计见 [环外点参与的平面数值角设计](superpowers/specs/2026-10-10-out-of-ring-angle-conditions-design.md)。

> **2026-10-10 §3-F 阶段 A 的浏览器证据补上：底面点名的数值角在浏览器里真的画得出、核得过（四边形那一支也在内）**。上一条如实记着"这一支只动内核见证构造，浏览器面本就**覆盖不到**它的新分支" —— 也就是说这条能力在 `e2e/` 里**一条判据都没有**（`e2e/` 里 `∠` 只出现在"读不懂的样本"`sin∠PAB=0.5` 那一条上）。新 spec `e2e/agent-base-angle.spec.ts` 走的是**既有**离线路线（设置里打开「示意图见证搜索」⇒ `parseShapeClause` 认形状从句 ⇒ **在浏览器里**跑见证搜索，那正是 `deriveAngledTriangleBase` 的入口），判据三段：① 确认面板题设核验 `passed`，**实录** `PA⊥平面ABCD：通过。已按候选图坐标核验。∠ABC=60°：通过。已按候选图坐标核验。`（**通过 2 / 失败 0 / 未核验 0**）；② 提交后读**真实落盘**坐标、**按画布标签**取 A/B/C/D（于是"面板说的名字"与"画布上的名字"必须指同一批点），测试**自己算** ∠ABC = 60°；③ 两组对边都不平行（防"顺手做出题面没说的特殊关系"那条红线）。**这条判据能咬人由对照实验证明**（不是"跑绿就算"）：只把**内核源码**回退到上一块（`git checkout a44c54b -- packages/geometry-kernel/src/witness/constructors.ts`）⇒ 本 spec **真红**，确认面板根本不出现，状态行实录 `no-candidate-constructed: 13 个候选都在构造期被拒，没有得到任何可核验的坐标。；unsupported-base-shape: 底面缺少「点名在 A 处的直角」（AB ⊥ AD）…（13 个候选）`；还原 ⇒ **1 passed**。**一条"跑起来才知道"的前提照实记**：题面**必须**带「线段 ⊥ 点名平面」那一句 —— 见证搜索靠它确定**底面环 / 垂足 / 顶点**，少了它实测报 `unsupported-shape: 题面没有给出「某条线段 ⊥ 某个点名平面」的写法`；而那句对**底面构造**是透明的（`kernelRelations` 明确不把"线⊥面"翻译成内核的两两写法），所以内核收到的底面条件**只有那个角**。**读数**：`typecheck` exit 0；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4139 通过 + 1 todo / 1 失败** —— 那一条是**已记过**的负载敏感抖动 `fileExports.test.ts`（CAD 导出 5 s 超时），**孤立复跑 9/9 通过**（本块只新增一个 e2e spec，非 Lean 单测面没动）；全量 e2e **222 通过 / 0 失败**（2.8 m；比上一读数 +1 = 本条新增的那一条）。

> **2026-10-10 §3-F 阶段 A 已做：平面数值角 `∠ABC=60°` —— 读得出、造得出、量得动（三角形底面）**。此前这句**整句落 `unverified`**，后果不是"画不出来"，而是**整题永远有一条条件没核**（确认按钮因此永不出现）。现在：① **读**成 `planarAngle`（三个点名，**中间是顶点**；`0°`/`180°`/点名重复仍读不出）；② **量**——核验器拿坐标自己算内部角（容差与二面角同一把尺子），所以"题面 60° 而图不是"会**如实 `failed` 并报出量到的度数**；③ **造**——内核把**三角形底面**上的那个角闭式放出来（两条邻边取不等长的代表值，不加"等腰"这种题面没说的特殊性），**四边形与涉及环外点的角一律拒绝**（阶段 B 要有界求根，另开设计）。**设计里那条"实施顺序是硬约束"当场兑现**：只加"读"不是第一步而是**回归**（角进 `givens` ⇒ 量不过 ⇒ `compile_failed` ⇒ 面板根本不出现），所以读/造/量同一块落地。**RED 共 12 处**：定向跑照出 7 处，**全库首跑又照出 5 处**（`agentRunner` / `diagramDraftStage` / `hostBridge` / `localPlanner` / e2e `agent-underdetermined-diagram` —— 它们都拿 `∠ABC=60°` 当"读不懂的样本"）；处理是**保持每条用例的意图、把样本换成真正读不出来的那一类**（`sin∠PAB=0.5`）。**变异**：短路新构造 ⇒ 内核判据当场红（实测 73.78° 而不是 60°）。**读数**：`typecheck` exit 0；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4139 通过 + 1 todo / 0 失败**（537.52 s）；全量 e2e **221 通过 / 0 失败**。**（同日随后补：这一块里"四边形…一律拒绝"那句已作废 —— 四边形底面现在也认，见下方紧邻的同名块。）**

> **2026-10-10 §3-F 阶段 A 补完最后一格：四边形底面上的点名数值角也认（上一条的"仍拒绝"当场作废）**。上一条把边界写成"四边形…一律拒绝"，理由也记了（`D = A + k·C` 那版会顺带做出 `AD ∥ BC`）。**理由对、结论过宽**：四边形比三角形多一个自由度，而题面**只说了那个角** ⇒ 剩下的本来就该取**代表值**，真正的要求不是"不许有代表值"，而是"**代表值不许顺手做出别的特殊关系**"。于是把那个反例**当判据用**：第四个点取 `D = A + 0.8·|AB|·(cos(θ+35°), sin(θ+35°))`（角在环上第二位 = `∠ABC` 这种写法），并**由判据逐条自算钉住三件"没有多加"** —— ① 两组对边都不平行（`AD ∦ BC`、`AB ∦ DC`，否则就成了梯形/平行四边形）；② 四个顶点都不是直角、四条相邻边没有一对等长；③ 环仍然**凸**（四个转向同号）且非退化。**角不在环上第二位**（如 `∠BCD`）**仍旧拒绝**（`unsupported-base-shape`）—— 代表方向那条规则在那里不成立，硬套就是替题面编形状。这条代表规则也**写进了假设文案**（面板上会多出一句"第四条边取代表方向…刻意不与任何已有边平行、也不做出直角"），因为那是**系统替用户做的选择**。**判据两条**：正例（题面那个角**自算** = 60° + 上面四组"没有多加" + 凸性）、反例（`∠BCD=60°` 仍 `rejected` / `unsupported-base-shape`）。**变异**：把 35° 改成 0°（也就是上面那个反例本身）⇒ 判据当场真红，读数 `AD ∦ BC: expected 0 to be greater than 0.000001`；还原 ⇒ 定向 **47/47**。**读数**：`typecheck` exit 0；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4140 通过 + 1 todo / 0 失败**；全量 e2e **221 通过 / 0 失败**；**离线 benchmark 码表逐字未变**（`BENCHMARK_WITNESS verified=1 unverified=20 …`、`BENCHMARK_WITNESS_CODES` 全串相同 —— 题集里没有这类案例）。**仍未做（照旧）**：**五边形以上**与**环上其它位置**的角仍旧拒绝；涉及顶点／环外点的角（`∠PAB`）是**阶段 B**，要有界求根，另开一页设计。

> **2026-10-10 §3-F 之一：圆台的"这是近似、差多少"接到模型那条路上（原先只有夹具那条路写了）**。查实的落差：Task 4.3 的证据行写着"'近似'如实声明：假设里给段数与弦高误差"，但**那句话只在 `localPlanner` 的圆台夹具上成立**；**动作那条路（模型给三个数调 `solid.create_round_frustum`）一个字都没说** —— 面板上没有任何"这是近似"。**改法**：编译期补假设的既有通道上加 `approximationAssumptions`（段数 + 内接正 N 边形 + **弦高误差** + "不是那个真的圆台"），经 `completionAssumptions` → 预览 → 运行时 `assumptions()` → 面板。**顺带更正三处**：① 弦高误差原先写死按"下底"算（理由"它是较大的那个风险"只在 `R下 > R上` 时成立）⇒ 现在取 `max` 并**指名**哪一环；② 公式抽成 `roundFrustumChordError`（夹具与编译期同一真源）；③ 夹具文案里的 markdown 星号清掉（那是**逐字渲染**的）。**判据四条**（默认 48 段 / 显式 16 段且上底更大 / 运行时端到端 / 上底更大时弦高取大环）；**变异**：撤掉那条 spread ⇒ 编译与运行**两层同时真红**。**读数**：`typecheck` exit 0（**先跑 typecheck 再跑全库**）；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4134 通过 + 1 todo / 0 失败**（543.66 s）；全量 e2e **221 通过 / 0 失败**（2.7 m）。

> **2026-10-10 §3-F 之一：底面点名两个直角 ⇒ 造直角梯形（原来是"矩形是更强的假设 ⇒ 拒绝"）**。内核原先那句拒绝（`unsupported-base-shape`）**理由没错、结论过宽**：环首直角 `AB ⊥ AD` 加 B 处直角 `AB ⊥ BC` 把 `AB` 钉成两条平行边的**公垂线**，底面闭式可构造（`A=(0,0)`、`B=(w,0)`、`C=(w,c)`、`D=(0,d)`）—— "首批不做通用非线性求解"在这一支上不成立。现在四支各有各的答案：**B 处直角 ⇒ 直角梯形**（`c ≠ d`，相等就是矩形 = 题面没说的特殊性）；**另点 `AB ∥ DC` ⇒ 那就是矩形**，按矩形造（此时若又给两个不同的 `AD`/`BC` ⇒ **矛盾，如实拒绝**）；**点了 `CD` 的长度 ⇒ 拒绝**（联立关系，本层不做）；**C / D 处直角 ⇒ 仍旧拒绝**（配上环首直角推出来的是矩形）。**判据**：内核自算三条题面条件 + 两条"没有多加"（`AD ≠ BC`、C/D 处不是直角）；管线三条（直角梯形句与矩形句各自 `verified_instance`、矛盾句不给通过核验的候选）。**变异**：短路新分支 ⇒ 内核 `rejected` + 管线 12 个候选全被拒，**两层同时真红**。**读数**：`typecheck` exit 0；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4130 通过 + 1 todo / 0 失败**（474.56 s）；全量 e2e 首跑 **220 通过 / 1 失败**（`conversation-isolation.spec.ts:52`，已记过的抖动，孤立复跑 1 passed）。**离线 benchmark 逐字复查：改前改后同一个码表**（只 stash 内核源码跑了一遍改前）—— 顺带改正一处陈旧读数：§一 记的 `no-candidate-constructed:4 / unsupported-base-shape:4` 今天实测是 **2 / 2**（码表构成早先就变过）。

> **2026-10-10 §3-F 之一已裁决并落地：球的状态词表加第五个词 `stale`（"不再成立"）**。原来的毛病是**一句用户看得见的假话**：派生球与宿主对不上时（`derived.sphere_stale`）报告借 `undefined`，而界面把 `undefined` 说成"**不存在**"—— 可那只球**就画在屏幕上**。四个求解器状态（`exact` / `approximate` / `undefined` / `degenerate`）说的是"**解**怎么了"；这一条说的是"**解还在，但已经不是这只实体的解了**"，所以它是**报告**自己的第五个词，不是任何求解器的返回值。**改法**：`SolidDerivedStatus["status"]` 加 `| "stale"`（`ObservedDerivedStatus` 同步，模型看到的读数与界面同一个词表）；`derivedStatusLabels` 那张 `Record<status, string>` 因此**编译不过**、必须补上 `stale: "不再成立"`（这正是当年把这张表写成 `Record` 的理由）；`systemPrompt` 的读数口径同步教一句"`stale` 说「不再成立」，**不要**说成「不存在」"；面板脚注也补上第五种。**判据三层**：报告（`derivedSphereLink.test.ts` 断言 `status: "stale"`）、界面（`EngineeringInspector.test.tsx` 断言徽章是 `stale` 且**不含"不存在"**、含"不再成立"，并留一条 `undefined` 的对照断言"**真的没有**这只球"仍读作"不存在"）、提示词（`systemPrompt.test.ts` 要求策略文本含 `stale` 与"不再成立"）。**变异**：把报告那一格改回 `undefined` ⇒ 报告与界面**两层同时真红**（提示词那条不随它动 —— 它守的是"话有没有说到"，不是报告本身，照实记）。**读数**：`typecheck` exit 0；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4127 通过 + 1 todo / 0 失败**（537.26 s）；全量 e2e 首跑 **220 通过 / 1 失败** —— 那一条是**已记过**的 `agent-oblique-prism.spec.ts:35`（等"已提交"标签 5 s 可见性超时），**孤立复跑 3 passed**。

> **2026-10-10 §3-D 已做：`proofExport` 有了实验入口与产物呈现（并修掉一处让开关"事实上不生效"的断线）**。两件事一起做：① **设置 → 实验性功能 → 形式证明导出**（默认关；与另外两个同一条口径：`=== true` 才算开、只写自己那个键、坏数据读成关）；② **确认面板新增「形式证明」那一段** —— 结局（八个词的**翻译**，判定仍只在内核与适配器那一侧）、**正文是谁给的**（`system-canonical` = 系统按这一类给出的，不是模型写的）、**系统替你做了哪些选择**，外加一句不能省的边界："这只是题面里那一条受限目标的形式证明：**原题其余题设没有进命题**，不等于整题已证明"。**顺带查实并修掉一处真断线**：`committerAdapter` 把第八个参数写成 `undefined`，注释还写着"由草稿层按它自己的开关做" —— **草稿层没有自己的开关**（它收的就是调用方传进来的布尔）；于是**在这之前，"设置里打开形式证明导出"在生产主路上什么也不会发生**。现在两条暂存路径都传它，预检显式传 `false`（预检不该去起证明进程）。**判据**：偏好/flags 三条 + 开关 UI 两条 + 面板三条（含"关着时整段不存在"）+ **运行器一条**（开着 ⇒ 预览里带着那一次尝试、没"求证"句的题如实 `no_goal`；关着 ⇒ **连键都不写**）+ **浏览器 3 条**（开关默认关 / 能开 / 只开自己；关着时面板没有这一段；打开后同一句话的确认面板上真的出现这一段）。**变异**：把那一格改回 `undefined` ⇒ 单元与浏览器**两层同时真红**。**读数**：`typecheck` exit 0；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4127 通过 + 1 todo / 0 失败**（530.08 s）；全量 e2e **221 通过 / 0 失败**（2.6 m）。**§3-E 的决定一并记下**：1 MiB 响应上限**维持现状**（超限即如实停下是安全的那一侧；抬上限要一起论证内存/超时预算，而今天没有证据表明它挡住了本该成功的题目；真要改，该改的是"让计划更小"，那是提示词那一侧的事）—— 代价如实留着：planning 3 条里有 2 条因此走不到计划。**仍未验**：真桌面 UI 自动往返（开关与面板给了入口，那一次真实往返仍需人操作）。

> **2026-10-10 自测问题 P2-C 已修：画布顶点标签跟随 `vertexNames`（用户报的"点的名称对不上"）**。这条**早就查实、记了三轮**，一直卡在"改它会撞 `planCompiler.offPath.golden` 的逐字契约"上；本次按裁决**修 + 有据重抓基线**。**根因**：`solid.create_polyhedron` 的顶点标签由 `labelSolidChildren` 按**下标顺序**生成 `A`、`B`、`C`…（`templatePointLabel`），而题设核验器按 `vertexNames` 的**下标**认顶点 —— 题面把顶点写在前面时（`P-ABCD` / `P-ABCDE` / `ABCD-A′B′C′D′`），两套名字整体错位一格：学生在画布上把**顶点**读成 `A`，而面板说的 `A` 是底面上那个点。**核验本身一直是对的**（点名表只从 `vertexNames` 建，"顶点名优先"那条语义还在），错的是它与用户看到的名字不是同一批。**改法一处**：`labelSolidChildren(primitives, label, vertexNames)` —— 给了点名就按下标用点名，没给仍按位置顺延（模板迁移那条路靠 `A…` 认"自动标签"，不能改）；`compileSolidPolyhedron` 收 `vertexNames`，动作层把 `inputs.vertexNames` 传下去（手工工具与旧文档不传 ⇒ 行为不变）。**判据三层**：内核一条（`P,A,B,C` ⇒ 标签逐字 + "没给点名仍 `A…D`"）；`e2e/agent-derived-sphere`（`P-ABCD` 外接球题：`byLabel[names[i]] === byIndex[i]`）；**以及三处原来"把缺陷逐字钉住"的用例反向** —— `agent-prism-path`（`A,B,C,A′,B′,C′`）、`agent-solid-family-path` 的台体（`A…D′`）与五棱锥（`P-ABCDE`，顶点就是 `P`），它们现在断言"名字与下标一一对上"而不是钉住错位。**变异**：标签改回按位置 ⇒ 内核、golden、浏览器**三层同时真红**。**golden 有据重抓（本块最需要说清的一处）**：重抓**之前**先用临时探针逐字段对读，证明差异**只有**两例 × 各 5 个 `label` ×（`operations[0].primitives` 与 `draftDocument.primitives`）= **20 处**（`A,B,C,D,E` → `P,A,B,C,D`），其余 5 例**零差异**（报错文案 / 别名 / 键集合 / 题设报告一个字没动）；这 20 处连同理由写进样本的 `revised`，并**加了一条用例要求它存在** —— 基线可以修订，但不能悄悄修订。**读数**：`typecheck` exit 0；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4119 通过 + 1 todo / 2 失败**（451.29 s）—— 两条都是**负载超时**（`file-hygiene.test.ts` 的 5 s、既有 `fileExports.test.ts:189` 的 CAD 导出 5 s），**孤立复跑 12 通过**；全量 e2e 首跑 **217 通过 / 1 失败** —— `agent-diagram-free-apex.spec.ts:84` 的 **`beforeEach`** 里 `page.goto` 30 s 被 `ERR_ABORTED`（**既有抖动**那一类，孤立复跑 **6 passed**）。**至此三个自测问题全部修掉**（P0-A 引用写法、P1-B 工作区判据、P2-C 顶点标签）。

> **2026-10-10 自测问题 P0-A 已修：切线题的"源曲线引用"两种写法都收（真实 provider 现场）**。用户回传的报错原文把先前的三条猜测（采样区间过宽 / 取景数值溢出 / 工作区停在 3D）**当场推翻** —— `run_failed`：`the plan never matched the schema: invalid_type@envelope.actions[1].inputs.sourceId: expected a string`（轨迹：检查环境 ✓ → 读取场景 ✓ → 规划 ✓ → 暂存草稿 **2 action(s)** ✓ → 修复轮 shape 1/1 ✓ → **失败**）。**根因是我们自己教出来的**：动作表里 `dynamic.create_bound_point.host` / `derived.*.solidId` 发布给模型的是**对象**（`{scope:"draft",alias:"…"}`，技能自述里就是这么写的），而 `function.create_tangent.sourceId`（切线指它刚建出来的那条曲线）是**裸 id 字符串**；模型按前者的样子写了后者，传输层一句 `expected a string` 把它挡在门外，**而那句话没告诉它该写什么**，那唯一一次修复机会也没救回来。**离线照不出来的原因也查清了**：夹具写的是合规的 `sourceId: "draft:f"` —— 离线替模型写对了。**改法**：`kind:"id"` 引用字段新增 `readIdReference` —— 裸 id 字符串**或**草稿作用域对象（收成 `draft:<alias>`，那是 `planCompiler` 认的唯一别名写法），同一把尺子用在平铺引用、嵌套的 `anchor.pointId` 与 `section.create.sourceId` 三处；**发布出去的 schema 同步**成 `oneOf: [string, {scope:"draft",alias}]`（本文件里那条纪律："发布出去的 schema 与真正接受的载荷必须是同一种东西"）；**拒绝时的报错也说出这两种写法**。**三条边界**：`scope:"scene"` 照旧拒绝（摊平成裸 id 会丢掉跨文档判据）、`parameter` 引用照旧只收字符串、长度与去空判据一条不少。**判据两层**：传输层（对象 ⇒ `sourceId` 变 `draft:f`；scene / 数字 / 数组 / 缺 alias 逐个拒绝且路径指到那个字段）+ **管线级**（`function.create_graph` + 对象写法的切线 ⇒ **真编出切线**，`sourceId` = 那张图的 id，不是字面量 `draft:f`）。**变异**：把草稿作用域那一支短路 ⇒ **两层同时真红**，管线那条报出的正是用户看到的那句 `invalid_type@envelope.actions[1].inputs.sourceId`。**读数**：`typecheck` exit 0；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4120 通过 + 1 todo / 0 失败**（398.11 s）；全量 e2e 首跑 **215 通过 / 3 失败** —— 三条（`agent-diagram-free-apex:33` / `agent-oblique-prism:35` / `main-thread-responsiveness:28`）**都是本文档早已记过的负载敏感抖动**，`--workers=1` 孤立复跑 **10 passed**；关旗 golden 在同一趟全库里逐字通过（**没有**动基线）。

> **2026-10-10 用户自测三个问题之一已修：平面圆锥曲线题不再被切进立体几何工作区（P1-B）**。用户报的是"平面与立体不主动区分"；**当场归因的结果是"判据缺失"，不是"说明问题"**：`agentRunner.planWorkspaces` 把 `dynamic.*` 与 `solid.*` 并列算作"要立体几何"，而 `dynamic.create_bound_point` / `bind_curve` / `create_locus` 这一族**自己不要工作区**（工作区由**宿主**决定，宿主又总在同一份计划里由 `planar.*` 或 `solid.*` 建出来）。于是本地规划器在「椭圆…上任意点 P 处的切线 + 恒/定值」那句话上给出的 `conicInvariantPlan`（椭圆 + 两轴 + **三个**动点 + 切线）被判成"又要平面又要立体" ⇒ `prepareWorkspaceFor` **三维优先** ⇒ **一道圆锥曲线题画在立体几何工作区里**。而 3D 文档接受平面图元，**图照样画得出来**：单元与既有 e2e 全绿，只有用户看得见工作区是错的（`e2e/agent-conic-invariant.spec.ts` 里那句"工作区被切到圆锥曲线"原来只是一句**注释**，没有任何断言看它）。**改法**：`dynamic.*` 从判据里去掉，只由 `solid.*` / `section.*` 与 `planar.*` / `function.*` 两族投票；一条计划只有中性动作时**不切工作区**（不替用户猜）。**判据两层**：单元拿**真夹具**钉 `planWorkspaces(conicInvariantPlan()) === ["conics"]`（先红：实收 `["conics","geometry3d"]`）；浏览器在提交后断言 `跳转到平面几何` 的 `aria-pressed=true`。**变异**：把 `dynamic.` 加回判据 ⇒ **两层同时真红**，浏览器那条的读数是 `Expected "true" / Received "false"`（正是用户看到的现象），还原后定向 91 条与 11 条 agent e2e 复绿。**读数**：`typecheck` exit 0；`lint` 0 error / 13 warning；全库非 Lean **353 文件 / 4118 通过 + 1 todo / 0 失败**（404.24 s）；全量 e2e **218 通过 / 0 失败**（2.5 m）；关旗 golden 在同一趟全库里逐字通过。**两条如实记账**：① 新用例第一版在 `PlanEnvelope` 判别联合上直接读 `.actions` ⇒ `tsc` 报 **TS2339**（vitest 全绿而类型门红，又一次"跑过测试不等于过了类型门"）；② 首跑全库里 `fileExports.test.ts:189`（CAD 导出 5 s 超时）与 e2e `main-thread-responsiveness.spec.ts:28`（帧间隔阈值被负载顶破）各红一次，**孤立复跑均通过**，是本文档早已记过的同两条既有抖动。**另两个自测问题**：P0-A 已于同日修掉（见下一块：切线题的源曲线引用两种写法都收）；**P2-C 也于同日修掉**（见上一块：标签跟随 `vertexNames`，golden 有据重抓）。

> **2026-10-10 现场修复批次（3.3.0 → 3.3.10，本地提交已全部推送）**：用户在桌面端连续报了五类失败，逐条归因、各自修掉，**每一类都有真红变异**（含一条"变异没红 ⇒ 回头补判据"的记录）：
> ① **三种"随手写法"被读懂**：`AD=2AB`（两条**不同线段**的倍数，此前判据只认"一个点把线段分开"那种形状，于是**永远核不了**）、`PA⊥底面 ABCD`（句型写死要「平面」两字）、`设 AD=2AB=2（即 …）`（后置长度与**重述从句**）。
> ② **题面规范化通道**（设计与安全阀见 `docs/superpowers/specs/2026-10-10-prompt-normalisation-design.md`）：模型只换说法、**不许改条件**；四道阀 = 逐字指回原文 / 不许编点名 / 关系词不许换族 / 改完必须能被同一解析器读出；被拒的条目**连原因一起摆在面板上**；改写随 `CommitRequest.normalisations` → 协调器 → 适配器 → 草稿层 `stage` 一路下去，**两层读同一份题面**（否则编译器说"读懂了"、草稿层说"没读懂"，门禁反而不放行）。
> ③ **只读工具不再按次吃 `generation`**：现场死因是"3 个只读工具 = 3 代 ⇒ 修复扣不动"，现按"一批一次"；工具次数仍由 `tool`（上限 24）管。
> ④ **`solid.create_face`（立体工作区里的平面多边形 / 面片）**：`face3` 图元、渲染、拾取、属性面板、导出、宿主绑定**早就都有**（手工工具「绘制空间面」），能力登记表里那条 `temporarily_unavailable`（理由原文 `no action handler: faces are materialised by the kernel`）**随这次入口一起改成 available**。它让"平面四边形 + 翻折片"这类**开放曲面**第一次可以被表达（此前只能拿 `solid.create_polyhedron` 硬凑、必然被信封拒）。
> ⑤ **面环判据三条口径统一 + 报错指名**：多面体与棱柱原先**各写一套**（点互异 = 坐标字符串全等 / 面积 = 叉积精确非零 / 共面 = 绝对 `1e-10`），现共用一份；**判据尺度分两种** —— 浮点噪声 ∝ **坐标量级**、几何退化 ∝ **形状尺寸**（这条边界是既有用例"平移到 1e9 的单位立方体"照出来的）；三条判据**各自独立收集**（去掉 `else if` 链：模型只有一次修复机会，一次报一条等于逼它猜下一条）；每条报错写清**哪个环、差多少、为什么**。
> **当时读数**：全库非 Lean **353 文件 / 4117 通过 + 1 todo / 0 失败**；全量 e2e **218 通过 / 0 失败**；`typecheck` exit 0；`lint` 0 error / 13 warning；打包 **3.3.10**（exe/MSI/NSIS 各自校验 SHA-256，冒烟启动 → 响应正常 → 优雅退出 0）。
> **仍未解决（诚实记）**：用户那句"平面四边形 ABCD + 翻折片"最后一次失败是**模型给了四个共线的点**（`face ring [0,4,7] has zero area (largest triangle 0.00e+0)`）—— 内核拒得**对**（一条线不是面），报错现在也写清了"这些点共线、面需要三个不共线的点"，但**模型是否用得上这次机会，离线环境验不了**（真 provider 那一端只有应用能跑）。**`翻折至 … PC=4√3` 的语义、`AE:AD=2:5` / `AF:AB=1:2` 这类 `X:Y=a:b` 写法仍不在覆盖内**（后者要靠上面那条规范化通道）。**一条待裁决（2026-10-12 已落地）**：仓库里 `tauri.conf.json` / `Cargo.toml` 声明的版号曾停在 **3.2.0**（版号文件按用户口径未提交），而当时实际交付已到 3.3.10 —— **该版号已于 2026-10-12 随 `104d688`（`chore(desktop): version 3.2.0 -> 3.3.14`）提交入库，仓内声明版号现为 3.3.14**；远端 Release 标签仍是 `v3.2.0`。


> **2026-10-10 人工自测结果（用户报告，控制器未旁观）与下一步**：**管理员 MSI 安装验收 ✅ 通过**（装/启/卸）；**真实 provider 已跑**（工具环 pass@1 1/8/pass@3 2/8/tool error 5/45/延迟 3704 ms；题集 planning planned 0/3、clarification 1/3、**error 2/3**，两条 error 都是**我们自己的 1 MiB 响应上限**触发 ⇒「超大响应未测」这条现在有实测：**超限即如实停下**）；看图自测**发现三个问题**（切线题在桌面版失败/溢出、平面与立体不主动区分、点名与画布标签对不上）。**逐条归因、最小复现、修法与顺序写在** [下一步计划](superpowers/plans/2026-10-10-selftest-followups-and-release-plan.md)。

**修复前一版做完了什么**：用户现场"A 字句只有关系、没有数值的立体题面"从**画不出来**推进到**能画出来**。路上推翻了两个自己的设计（见下方"走过的弯路"），并修掉一批真实运行暴露的形式障碍（信封缺字段、平面动作带 `z`、面环绕向不一致、空 `relations`）。
**修复前一版暴露了什么（更重要）**：用户在真图上确认"**图画出来了，明显画错了**"。实测模型给的坐标：`BD=2`、`O` 是中点、`△OCD` 等边、`AB=AD` 都对，但 `OA·CD = −0.314 ≠ 0`（**第（1）问要证的那件事本身不成立**），且 `A` 的高度取 0.64、而"二面角 45°"要求约 1.33（**差约一倍**）。
**当时根因（必须写清，不能含糊）**：这道题的七个条件里，机器**真正核验过的只有一条**（`O 为 BD 中点`）。`AB=AD` 的等号写法不在关系词表里、`平面⊥平面` 没有判据、`等边三角形` / `DE=2EA` / `二面角 45°` 是**数值约束**而不在判据范围内 —— 于是**一张错图静默通过了全部门禁**。当次读数：全库单测 **282 文件 / 3277 通过 + 1 todo / 0 失败**、`agent-core`/`scene-graph`/`apps/web` 的 `typecheck` 均 exit 0、`eslint` exit 0。**这些绿读数与"图对不对"无关** —— 这一点此前几轮我没有说清楚，是本轮修正的表述。
**上一次：** 2026-10-03（欠定图形的见证生成与关系核验：关系表进信封 + 内核残差执行前核验。**其中"要求模型声明 `relations`"的设计已被真实运行推翻**，改为系统自己从原话抽）。

> **2026-10-07 立体图形扩宽 S1–S6（主体已通）：** 用户裁决"要能处理大部分形状"后，按 [实施计划](superpowers/plans/2026-10-07-solid-shape-coverage-implementation-plan.md) 分块推进。
> **S1 点名语法 ✅**：`pointNames.ts` 一份定义（`A′` / `A₁` / `A′′` 在**解析**与**核验**两侧都成立）。**S1.4 已按用户裁决扩语法**：底面已用 `A′` 时顶面叫 **`A′′`**；候选耗尽则**明确拒绝**，绝不造词表外的名字。**2026-10-10 S1 收口**：1.1–1.6 **逐条核实**后勾选（计划里的四个未勾项落后于仓库实际），并**当场做变异** —— 把 `POINT_NAME_SOURCE` 改回 `[A-Z]` ⇒ **11 条真红**（点名模块 3 / 解析器 3 / 核验器 3 / 内核 2），还原后 100/100 复绿。
> **S2 形状数据化 ✅**：`SolidShapeSpec` + 内核 `constructShapeFromSpec(spec, choices)`（编排层只交形状描述与取值）；**迁移护栏**（四棱锥坐标逐字快照）原样通过。
> **S3 棱柱 ✅（2026-10-10 收口）**：**直棱柱走通、底面 3–6 边**（n ≥ 5 时题面点名角度/平行仍拒绝，`unsupported-base-shape`；**四边形底面的"两个点名直角"自 2026-10-10 起改为构造直角梯形 / 矩形**，见本页顶部同名块）。**S3.3 反例已做**（底面三点共线 ⇒ 拒绝，种类 `no-candidate-constructed`；规划器夹具补 `exclude`，**带点名表的题面不再被夹具接走**——以前那样做的后果是题设**永远不会被核验**）。**S3.4 浏览器正例已解除（2026-10-10）**：题面驱动的棱柱现在能走到"确认改动"面板、能提交 —— `e2e/agent-prism-path.spec.ts` 从 `test.fixme` 转正，**1 passed（18.2 s）**，判据是提交之后在浏览器里**自算**三条侧棱彼此相等、且每条都与底面法向平行。**根因不在几何、也不在模型**：关系抽取的"点名块"字母表 `[A-Z][A-Z0-9]*` 不含 `′`，于是 `AA′` 被切成 `AA`、读成**自己到自己**的退化线段 ⇒ `AA′ ⊥ 平面ABC` 的 targets 成了 `v0,v0,…`、残差算不出来 ⇒ 判 `relation_not_satisfied`（一次**失败**，不是"未核验"）⇒ 编译失败 ⇒ 协调器把那唯一一次修复交给模型，可这条关系是**系统从原话抽的**、`envelope.relations` 只是投影，模型改不动 ⇒ `run_failed` ⇒ 面板永不出现。修法：抽取器改用 S1 的唯一点名定义（`pointNames.ts` 的 `POINT_NAME_SUFFIXES` + `splitPointNames`）。**菱形底面已做（2026-10-10，有名字表入口）**：**只接有名字表的题面**（`在四棱柱ABCD-A′B′C′D′中，底面ABCD是菱形，AA′⊥平面ABCD，画出这个四棱柱`），不给无点名表的说法编点名。落法**不新造数学** —— 解析层把「菱形」拆成三条**既有**的 `equalLength`（`AB=BC`/`BC=CD`/`CD=DA` 链式覆盖四条边），核验走既有等长判据；内核新增 `equal-length` 关系档 + `deriveRhombusBase`（代表角 **60°**，边长自由或题面给定）。**菱形不许取直角**（四边相等 + 直角 = 正方形，是题面没说的额外特殊性）。证据：**浏览器 `e2e/agent-rhombus-base.spec.ts` 1 passed**。**斜棱柱已做（2026-10-10，代表斜向 + 假设）**：题面只说"斜"、没说斜多少 ⇒ 系统取代表值（侧棱与底面法向成 **60°**、朝 +x 倾斜）并**写进假设**；`shapeGrammar` 把「正/斜/直」读成字段（此前被正则吃掉），并对 **`斜` + 「侧棱 ⊥ 底面」**这种自相矛盾题面**问路**（此前会静默画成直棱柱）；证据 **`e2e/agent-oblique-prism-from-sentence.spec.ts` 1 passed**。**"用角条件把方向钉死"（`∠A′AB=60°`）明确不做**（要"环外点名顶点"概念，见计划"明确不做"）。**S3 出口四类形状各有正反例，已收口**（Task 3.5）。
> **S4 台体 ✅**：**棱台**（内核 + 搜索 + 界面路径 + 浏览器证据）；**圆台**（内核多边形近似 → 既有多面体动作 → 参数化动作 `solid.create_round_frustum` → **已交给模型**），"近似"在**假设（段数 + 弦高误差）与对象标签**上如实声明。
> **S5 球 ✅（2026-10-10 补齐最后一格）**：外接 / 内切球（内核求解 → **派生绑定 + 重算** → 动作 → 交给模型 → 浏览器创建证据 → 面板可见性）。**核验独立于求解器**（"到各顶点等距 / 到各面相切"自己算距离），过期 / 不符会作为 `derived.sphere_stale` **显形**（正常时一行噪声都不加）。**5.5 的拖动那一半做成了**（此前"试了三次都没让实体动起来"）：根因是**外接球把宿主整个包住**（射线永远先命中球，探针读数 `solid:sphere-1->sphere`）叠上**派生球被当成可自由拖动**（拖它必被重算覆盖）；修法 = `isFreeDraggable3` 不再把派生球算作可拖（此前**全仓无一条用例**，现补 `transforms.test.ts` 4 条）+ 拖动拾取按"可拖"过滤（`pickRaycastHit3` 的 `accept`）；判据：顶点动、只有它动、球跟着重算、且**仍是新顶点组的外接球**。**变异**（把那行改回 `return true`）⇒ 单元与浏览器**两层同时真红**，还原复绿。
> **S6 入口语法 ✅（2026-10-10 收口）**：`parseShapeClause`（认得出就产出 spec，认不出返回 `null` = **问路**）+ `specForPrompt`（形状从句与"侧棱 ⊥ 底面"**两处读法交叉校验**）+ 离线入口与**界面路径**（规划器 `solidShapeIntentFor`：挂实验开关、夹具优先、避开 V0a 地盘）。**6.4 逐族核实**：棱锥 / 棱柱 / 棱台 / 球四族**各有至少一条浏览器正例**，且都是"读落盘坐标 → 测试自己算"（`agent-solid-family-path` / `agent-prism-path` / `agent-oblique-prism-from-sentence` / `agent-rhombus-base` / `agent-derived-sphere`）。**`freeApexIntentFor` 窄正则：2026-10-10 评估后决定保留**（不是漏做）—— 它是 V0a 那族句子的唯一通路，且契约里有一件不能丢的事：**必须传 `spatialPointConditions: true`**（实测：丢了它，`A=(0,0,0)` 这类写死坐标进不了图；"在底面ABC上方"与无等号坐标则会**静默通过**）。"退役"实际要做的不是删代码，而是把 V0a 的整套契约搬进形状族并改其单元与 e2e —— 风险落在一个实验开关后的既有能力上。**承重性已钉住**（`planCompiler.test.ts` 的"空间点条件：这个开关是承重的"两条，两个方向都钉）。**一条如实留着的边界**：无点名表的说法仍走夹具、"球"的关系仍**有意不认**（认了也造不出来）；覆盖度按设计 §6 的纪律"认不出就问路"。**2026-10-10 补**："认不出一律问路、不改文档"的**浏览器判据**已落地 —— `e2e/agent-unreadable-prompt.spec.ts` 三类反例（分析题 / 非立体题 / 说法与形状对不上）**3/3**，判据是：确认面板不出现、草稿键 `mathcanvas:draft:geometry3d` 前后逐字相同、回画布后对象为空且「撤销」禁用。**一条待裁决（本批查实）**：`waiting` 这一支在界面上经 `failPendingReply` 收尾 ⇒ 状态卡标签是**"没有完成"**（`data-status="error"`），"我问你一个问题"与"这次没做成"共用同一个词。
> **仍未裁决**：① ~~画布顶点标签与 `vertexNames` 错位~~（**2026-10-10 已修**：标签改为跟随 `vertexNames`，golden 有据重抓，见本页顶部同名块）；② ~~状态词表是否给"球**存在**、但主张不成立"加一档~~（**2026-10-10 已裁决并落地**：新增第五个状态词 `stale`（"不再成立"），见本页顶部同名块）。
> **当日读数（2026-10-07）**：全库非 Lean **3963 通过 + 1 todo / 0 失败**；**e2e（Playwright）全量 212/212**；`typecheck` exit 0；`lint` 0 error / 13 warning（基线）。
> **2026-10-10 读数（S3 收口那次复跑）**：全库非 Lean **337 文件 / 3977 通过 + 1 todo / 0 失败**（494.03 s）；**全量 e2e 218 通过 / 0 失败**（2.5 m）；`typecheck` exit 0；`lint` 0 error / 13 warning。此前同日的两次抖动（`conversation-isolation` / `geometry3d-drag`）都单跑复绿，均在下方按块记录里写明。
> **过程与失败尝试**见 [`CHANGELOG.md`](../CHANGELOG.md) 同日各条与 [`project-progress.md`](project-progress.md)。

> **2026-10-06 N3 增量：** 实验性约束拖动开启时，空间直线的 `coincident` 尚无 3D 判据，现在涉及其定义点的拖动（包括投影连带移动）会拒绝且保留文档和撤销历史。这是安全拒绝，**不是空间线重合求解**。本区块非 Lean 慢集成全库 324 文件 / 3781 通过 + 1 todo，e2e 196/196；Lean 慢集成本区块未单独重跑。下方历史读数仍保留原时刻。

> **2026-10-06 V0a 暂存状态（未收口，不放行）：** 已在本地为实验性见证搜索加入自由三棱锥顶点候选、明确坐标原文核验、未支持“在底面上方”条件的 `unverified` 提示；只接受受限点名句型，关闭开关保持旧路径。本次定向 7 文件 / 171 通过，全部工作区 typecheck exit 0，lint 0 error / 13 条旧 warning，**仅新 spec** 浏览器 3/3（开启后确认与一步撤销、关闭时不建草稿、上方条件不静默放行）。**没有**全库/全量 e2e、独立截图目检、对提交后坐标的浏览器独立回代、教师/学生走查、MSI、真实 Lean 或付费 provider 证据；测试通过并不意味着所有高中立体题可画，更不意味着 V0a/V0 出口完成。本区块代码快照为 WIP `4ee71e8`，属于进行中记录，不能作为 V0a/V0 完成证据。

> **2026-10-06 范围扩宽裁决 + 当前基线复测（`3968a99` 工作树）：**
> 用户当日裁决：**Agent 不能只会画三棱锥，要能处理大部分立体图形**。首批范围定为
> **棱锥（任意 3–6 边底面）／棱柱（任意底面 + `A′` 带撇顶面）／台体（棱台、圆台）／球与多面体的内切外接关系**；
> 入口这一层**本地解析器扩宽到常见自然语言说法**（不依赖模型，认不出就问路）；
> **默认行为先沿用现有开关**（四类全做完再单独决定何时默认开）；
> 落地结构为**形状数据化**（四层共用一份 `SolidShapeSpec`），不再逐个形状加构造分支。
> 设计（含已裁决的四条、现状事实、S1–S6 分块、错误处理、明确不做、回退办法）见
> [立体图形覆盖扩宽设计](superpowers/specs/2026-10-06-solid-shape-coverage-design.md)。
> **此处是 2026-10-06 裁决时快照：当时只写了设计，没有动产品代码**；实施计划于 2026-10-07 编写（[立体图形覆盖扩宽实施计划](superpowers/plans/2026-10-07-solid-shape-coverage-implementation-plan.md)，S1–S6 + 每块收口清单），此后 S1–S6 已逐块实施（现时状态见上方摘要）。
> **同一次复测的当时读数**（与下方 §一 表里更早时刻的数不是同一次，别混用）：
> `npm.cmd exec vitest run -- --exclude scripts/proof-spike/lean4EndToEnd.test.ts --maxWorkers=2 --reporter=dot`
> ⇒ **328 文件 / 3831 通过 + 1 todo / 0 失败**，exit 0，115.32 s；
> `npm.cmd run test:e2e` ⇒ **199 通过 / 0 失败**，exit 0，1.1 m。
> 工作区 `typecheck` exit 0、`lint` 0 error / 13 warning（同次复跑）。**Lean 慢集成本次未跑。**

> **2026-10-06 V0a 浏览器证据增补（`851e4cf`）：** 计划 V0a 出口点名的三件浏览器证据里，**两件已补**：
> ① 新增用例把应用自己写回的 `.mgeo` 草稿里**真实落盘的顶点坐标**读出来，在测试里**独立回代题设**
>（自算底面法向；**AD ⊥ 平面 ⟺ AD 平行于法向 ⟺ 余弦 = 1**，不是 0——这一点第一版写错、被这条用例自己抓住；
> 另含 D 真的离开底面、四点互异且体积非零、D 确实在垂足 A 正上方），**不读 `diagramVerification` 的结论**；
> ② 截图落 `test-results/v0a-free-apex-tetrahedron.png` 并**已目视核对**（顶点 D、垂足 A、底面 B/C，对象清单 15 项）。
> 该 spec 现 **4/4 通过**，exit 0，10.2 s；工作区 `typecheck` 与 `lint`（0 error / 13 warning）同次复跑通过。
> **仍缺**：错误坐标的浏览器反例（要先给受限句式加显式坐标支持）、全量 e2e、教师/学生走查、MSI、真实 Lean、付费 provider。
>
> **本次另查实一个真缺陷（2026-10-10 已修，见页头同名块）**：画布顶点标签曾是**按下标顺序自动生成**的
>（`geometry-kernel` 的 `templatePointLabel(index)` → `A`、`B`…），而题设核验器用的是 `vertexNames` 的下标。
> 两者顺序不同时（例如 `P-ABCD` 这类顶点写在前面的题面），**"题设核验通过"说的是另一个顶点**，
> 用户按标签读图会读到别的结论——绿门禁挂在了错的对象上。
> 探针实测：声明 `vertexNames: ["P","A","B","C","D"]` 配坐标 `[P(0,0,4), A(0,0,0), B(2,0,0), C(2,3,0), D(0,3,0)]`，
> 落盘标签却是 `A@(0,0,4)`、`B@(0,0,0)`、`C@(2,0,0)`、`D@(2,3,0)`、`E@(0,3,0)` —— **整体错位一格**。
> **不能顺手修**：`planCompiler.offPath.golden.test.ts` 要求关着开关时与 `4707b64` **逐字节相同**，
> 而草稿文档（含标签）就在比较范围内；改它等于改一条已声明的兼容契约，需要单独裁决与重新基线。
> V0a 这条路径**本身不受影响**（它的 `vertexNames` 恰好就是 `A,B,C,D` 的顺序），
> 且新用例已把"下标顺序与标签必须指同一个顶点"钉成判据，将来错位会红。
>
> **2026-10-07 浏览器实测把它的形态钉得更死**（`e2e/agent-solid-family-path.spec.ts`，3/3）：
> 标签**完全按位置顺延**，与 `vertexNames` 无关 —— 不只是"错位一格"：`P-ABCDE` 的顶点在画布上叫 **`F`**，
> 棱柱 / 台体的 `A′…D′` 变成 **`E…H`**（`A′` 这种名字在标签里**没有位置**）。
> 于是"面板说 passed"与"用户看到的点名"指着两套名字。该用例的几何判据因此改用**拓扑下标**
> （`polyhedron3.vertexIds` 的顺序），并把标签不一致**逐字钉住**，让它显形而不是静默。
>
> **2026-10-06 V0a 浏览器证据**收口（本批同一次提交）：第三条缺口也已补上——受限句型新增**底面顶点的显式坐标**
> 写法（`A=(0,0,0)`；坐标段只收底面环上的点且必须被坐标吃干净，顶点仍是自由点），并配**成对**的浏览器正反例
>（正例：题面写的坐标逐字出现在核验清单里且 `data-status=passed`；反例：`A=(5,5,5)` 与候选不符 ⇒ 无确认面板、无对象、不占撤销历史）。
> 同时修掉一处**两条路看得不一样**的缺陷：`searchWitnessForPrompt` 此前固定不带 `spatialPointConditions`，
> 于是救援路径认得出原话坐标、离线入口认不出；现改为与救援路径共用 `parseObligationWithLegacy`，**缺省仍为 `false`**
>（`bench:agent` 见证层历史读数因此不受影响）。
> **变异验证**：短路坐标守卫 ⇒ 对应用例当场变红，还原后复绿。
> **本次读数**：受限定向 2 文件 86/86；单 spec 浏览器 **6/6**；全库非 Lean **328 文件 / 3835 通过 + 1 todo / 0 失败**（143.88 s）；
> 全量 e2e **202 通过 / 0 失败**（1.0 m）；`typecheck` exit 0、`lint` 0 error / 13 warning。
> **V0a 仍未验收**：Lean 慢集成与桌面产物本批未跑，教师/学生走查、MSI、真实 Lean、付费 provider 仍未做。
>
> **2026-10-06 V0a 门禁全表复测（本批；取代 §一 中同名命令的更早读数）：**
>
> | 门禁 | 本次读数 | 退出码 |
> | --- | --- | --- |
> | 生产构建（web） | 成功，4.86 s；入口 `index-*.js` **1,861.85 kB / gzip 548.43 kB**（另 `engineeringExporters` 433.81 kB、`geometry.worker` 384.49 kB、CSS 106.15 kB） | 0 |
> | Rust provider 测试 | **238 通过 / 3 ignored / 0 失败** | 0 |
> | 证明边界 smoke | **8 通过** | 0 |
> | 性能基线 | **9/9**；`drag/300-frames` **625.9 ms** | 0 |
> | 依赖许可扫描 | 通过；快照重写后工作树**无变化**（说明快照与 `Cargo.lock` 一致） | 0 |
> | Agent 评测（离线 `deterministic_local`） | `pass@1 4/8`、`pass@3 4/8`、工具选择 `45/45`、工具错误 `3/45`、`average latency 2 ms`、`provider not measured`、`average cost not measured` —— **离线回归读数，不是模型准确率** | 0 |
> | Agent benchmark（离线） | `BENCHMARK_WITNESS verified=1 unverified=20 no_witness=0 error=0 solveRate=0.048`；`PREMISE rate=0.727`；`EXTRACTION 14/21 = 0.667`；`judgeability supported=21 unsupported=3` | 0 |
> | 非 Lean 全量单测 | **328 文件 / 3835 通过 + 1 todo / 0 失败**（143.88 s） | 0 |
> | 全量 e2e | **202 通过 / 0 失败**（1.0 m） | 0 |
> | typecheck / lint | exit 0 / **0 error · 13 warning** | 0 |
> | 真实 Lean 端到端（显式 gated） | **skip，不是通过**：环境探针如实打印「本机没有找到 Lean 可执行文件（`resolveLean4Toolchain` 返回 null）」；1 passed / 3 skipped | 0 |
>
> **两条必须说清的事**：
>
> ① **本机现在没有 Lean 工具链** —— 没有 `elan` / `lean` / `lake`，`proof/lean4/.lake` 也不存在。
> 因此 §一 里那条「真内核闭环成立（`formally_proved`，68277 ms）」是**更早某台装了 Lean 的机器上的历史读数，本机不可复现**。
> **⚠️ 2026-10-10 更正（只更正"不可复现"这半句）**：本机**现在装了 Lean 工具链**（`proof/lean4/.lake` 有 7.5 GB olean），那条历史读数**已复现** —— 热跑 69071 ms 得 `formally_proved` / `verified`（详见 §一 那一行的冷/热两读）。**"本机没有工具链"这句只代表写下它那一刻**，不要再当现在时读。
> 好在该用例是**显式 gated** 的：找不到工具链时**跳过并打印理由，绝不静默通过** —— 本次读数正是这个行为本身。
>
> ② **离线 benchmark 见证层的码表与文档里记的那一次不同**：本次多出一档 `"unverified-obligation":26`，
> 同时 `no-candidate-constructed` 由 4 降到 2、`unsupported-base-shape` 由 4 降到 2。
> 总体仍自洽（`verified=1`、`solveRate=0.048` 未变），但**分布不是同一个** ——
> 是拉取进来的那批提交改变了码表构成。引用旧码表之前必须知道这一点。
>
> **2026-10-06 V0a 出口判据逐条有证据（本批）：** 计划 V0a 那一行点名的出口条件，现在**每一条都有可复跑的浏览器证据**：
>
> | 出口条件 | 证据 |
> | --- | --- |
> | 真浏览器看到四面体 | 截图 `test-results/v0a-free-apex-tetrahedron.png`（**已目视核对**：顶点 D、垂足 A、底面 B/C）+ 场景对象与 15 项对象清单 |
> | 条件状态一致 | 面板 `data-status=passed`，且由**独立回代**复核（AD 平行于底面法向、D 离开底面、四点互异且体积非零） |
> | 拒绝不占撤销历史 | 两条拒绝用例各自断言「撤销」按钮仍 `disabled` —— 这是浏览器里**唯一**能看见撤销栈的读数；只断言"画布上没东西"与"画了又被撤掉"长得一样 |
> | 合法自由点图可确认但不宣称唯一 | 面板写明「不是普遍证明」，自由点取示例值并列为系统自选假设 |
> | 文字坐标/方位不能静默丢 | 题面坐标逐字出现在核验清单；「在底面 ABC 上方」被拒，不静默放行 |
> | 全量回归 | 非 Lean **328 文件 / 3835 通过 + 1 todo / 0 失败**；全量 e2e **202 通过 / 0 失败**；`typecheck` 0；`lint` 0 error / 13 warning |
> | 变异 | 短路坐标守卫 ⇒ 对应用例当场变红，还原后复绿；单 spec 浏览器 **6/6** |
>
> **本批（同日后一批）已把镜像文档同步完成**：`feature-catalog` / `project-progress` / `README` 与本节一致。
> 但「V0a 出口判据齐备 + 文档收口完成」**仍不等于「V0a 完成」**：计划的 `V0 出口` 与 `V0 区块收口` 两个复选框
> 覆盖的是**四家族**，当时 V0b–V0d 尚未开始（**已于同日逐块补齐**，见下方各块），所以两项都**不能勾**。教师/学生走查（§四 A）与管理员 MSI（§四 B）
> 是两项独立验收，不受本批影响。
>
> **2026-10-06 V0b 增量：平面图形接进同一套题设核验（单元级完成，浏览器证据与本地入口未做）**
>
> **查实的洞**：原文题设核验的触发条件此前写死了 `solid.create_polyhedron` —— 也就是说
> **任何平面图形都从不进入核验**，「动作编译成功」即被视为「图符合题意」。这与 V0a 修掉的是**同一类洞**，
> 只是换了一个工作区。
>
> **本批做的两件事**：① 触发条件改为一份显式、带注释的 `POINT_NAMING_ACTION_IDS`
>（`solid.create_polyhedron` + `planar.create_point`）。**刻意不含 `solid.create_template`**：它给子对象编的
> `A`、`B`、`C`… 是**模板自己的顺序编号**、与题面点名不是一回事，算进来会让「画个立方体」去核验并不存在的点名，
> 也会破坏关旗黄金样本。② 核验器的点名表新增 **2D `point`**：补 `z = 0` 后交给**同一套**判据 ——
> 平面题的垂直/平行本来就在 z = 0 平面上算，为 2D 再开一条数学分支等于把同一个判断写两遍。
> 同时把多面体那一支改成「计划里真的有它时才跑」，**多面体在场时的守卫逐字未改**（`null` 仍表示「没有可靠映射」，
> 与「点名表恰好是空的」区分开）。
>
> **读数**：RED 3 条全红 → GREEN；全库非 Lean **328 文件 / 3838 通过 + 1 todo / 0 失败**（145.54 s，
> **+3 正好是本批新增的用例数**）；`typecheck` exit 0；**关旗黄金样本仍逐字节相同**（`planCompiler.offPath.golden.test.ts`，
> 这是本批最关键的约束）。**变异**：去掉 2D 分支 ⇒ 正例与反例各一条变红，还原后复绿。
>
> **V0b 未收口**：`workerContracts` 侧用例未加；教师可读性走查属 §四 独立验收。
>
> **2026-10-06 V0b 续：本地入口、浏览器证据，以及一处"同一个判断写两遍"（本批最重要的发现）**
>
> 本地新增一条**精确匹配**夹具意图（`在三角形ABC中，AB⊥AC，画示意图`）：三个**点名**平面点，
> 边长由系统自选并写进 `assumptions`，`C` 取在过 `A` 且垂直于 `AB` 的线上（题面欠定，只给代表点）。
> **不挂实验开关**——开关管"见证搜索"，这条走的是与 `PYRAMID_PROMPT` 同类的夹具路径。
>
> 浏览器证据：新 spec 提交后读**草稿里真实落盘的坐标**，用**自算的点积**独立复核 `AB⊥AC`，
> 并断言三点不共线、点名恰好 A/B/C。
>
> **关键发现**：核验的触发条件此前在 `planCompiler`（编译期）与 `draftStore`（草稿层再核验）**各写了一份**
> `action.actionId === "solid.create_polyhedron"`。上一批只改了编译器那份 ⇒ **编译期核验跑了，而用户在面板上
> 什么也看不到**——面板那份报告来自草稿层。**单元测试抓不到**（`compilePlan` 的用例只走编译期那条），
> 是浏览器用例先红的。现收成一个导出的 `declaresPointNames`，两处共用，并补了草稿层单元守卫。
>
> **本次读数**：定向 3 文件 110/110；全库非 Lean **329 文件 / 3845 通过 + 1 todo / 0 失败**（146.80 s，+7 = 本批新增用例数：5 单测 + 2 Worker 契约）；
> 全量 e2e **203 通过 / 0 失败**（+1 = 新 spec）；`typecheck` 0、`lint` 0 error / 13 warning。
> **变异两次**：去掉 2D 分支 ⇒ 平面用例红；草稿层换回重复触发条件 ⇒ 新守卫红；两次还原后复绿。
>
> **Worker 那一侧也补了**：`geometryWorkerHost.planar.test.ts` 用**假线程 + 生产真策略**证明
> ① 原话真的装进了请求信封；② 同一份计划只把 `C` 挪到 `AB` 上，**跨线程之后照样拒绝** ——
> 后者正是"Worker 里真的逐条量过"的读数。**一条如实记录**：我最初在那里断言 `diagramVerification`，
> 红了才发现**那条通道按设计不走回程**（`compileInWorker` 只映射文档/操作/假设/被物化动作，
> 核验报告由 `draftStore` 重新算一遍）—— 断言它等于要求一条故意不存在的传输。
>
> **V0b 的测试面已齐**（本地入口 / 浏览器证据 / 草稿层守卫 / Worker 契约）；**仍未做**：
> 教师可读性走查（§四 独立验收）、V0c–V0d。
>
> **2026-10-06 V0c：圆锥曲线的题设也逐条核验（半轴与焦点）**
>
> **接上第二类"没有点名"的图形**：原文核验此前只认带点名的动作，而圆锥曲线**没有顶点名**，
> 于是它连"题面说的是图里哪个东西"都定不下来。触发判据由 `declaresPointNames` **改名**为
> `planHasVerifiableFigure` 并加上 `planar.create_conic`；新增 `candidateConic`，
> 沿用与多面体同一条"**恰好一条**"纪律（多一条 ⇒ `null` ⇒ **未核验**，不是通过）。
>
> **题面侧**：新增题设种类 `conicAxes` 与椭圆方程匹配器（`x²/9+y²/4=1`、y 在前、`x^2` 都收）。
> 判据只比半轴，但**结论带焦点**：焦点是半轴的函数（`c = √(a²−b²)`），半轴对调会把焦点从
> `(±√5, 0)` 挪到 `(0, ±√5)` —— 那是另一条曲线。
>
> **一处自己犯的错被用例抓住**：第一版把方程**分母**直接当半轴（报出 `(9, 4)` 而非 `(3, 2)`），
> 正面用例当场红；已改成开方，教训写进注释。
>
> **读数**：定向 2 文件 72/72；全库非 Lean **329 文件 / 3849 通过 + 1 todo / 0 失败**（144.50 s，+4 = 新增用例数）；
> 全量 e2e **203 通过 / 0 失败**；`typecheck` 0、`lint` 0 error / 13 warning。
> **变异**：把解析出的两个半轴对调 ⇒ **4 条 V0c 用例全红**，还原后复绿（判据是"分轴"的，不是只看大小）。
> **未做**：V0c 的浏览器证据（本地入口 + 真实椭圆截图目检）—— 已于同日补齐；双曲线 / 抛物线当时仍走
> "解析器不认识 ⇒ 未核验"这条诚实路径，**也已在同日补齐**（见下方"V0c 补齐"块）。
>
> **一条操作教训（成本真实）**：本批中途用 PowerShell `Set-Content` 批量重命名，
> 把两个源码文件的**中文写成了乱码**（diff 从几十行炸到 662 行），只能 `git checkout` 回滚重做。
> **本仓源码不能用 PowerShell 文本替换，只能用 `edit` 工具。**
>
> **2026-10-06 V0c 浏览器证据：椭圆与它的焦点（V0c 收口）**
>
> 本地新增**精确匹配**夹具意图（`椭圆 x²/9+y²/4=1，画示意图`），不挂实验开关。
> **一处关键不同**：题面是**方程**、半轴已被分母钉死（`√9 = 3`、`√4 = 2`），所以**没有"系统自选示例值"** ——
> 夹具假设里如实写"由题面方程唯一确定"。
>
> 浏览器证据：新 spec 提交后读**草稿里真实落盘的半轴**，在测试里**自己算焦点**（`c = √(a²−b²)`）
> 与题面要求的 `(±√5, 0)` 比对，并断言长轴在 x 轴上（半轴对调正是会改掉这件事）。
> **截图已目视核对**：椭圆明显**宽于高**，与方程一致；对象清单 1 项、标签就是那个方程。
>
> **一处措辞被用例逼着改**：假设初稿写"不是系统自选的**示例值**"，而面板逐字显示 ——
> 用户扫一眼只会看到"示例值"三个字。改成正面陈述后，那条"整句不许出现『示例值』"的断言才通过。
>
> **本次读数**：定向 1 文件 45/45；全库非 Lean **329 文件 / 3852 通过 + 1 todo / 0 失败**（+3 = 本批新增单测）；
> 全量 e2e **204 通过 / 0 失败**（+1 = 新 spec）；`typecheck` 0、`lint` 0 error / 13 warning。
> （另记：本批第一次 typecheck 曾报 `assumptions` 可能为 `undefined`，已修；那是**类型层**修正，不改运行时行为。）
>
> **V0c 测试面已齐**（单元 + 草稿层 + Worker 契约路径同样适用 + 浏览器 + 截图目检）；
> **仍未做**：双曲线 / 抛物线（**已于同日补齐**）；V0d。
>
> **2026-10-06 V0d 起步：Agent 第一次能创建函数图像（动作层已通，V0d 未收口）**
>
> **补上一个从入口就断掉的动作**：`packages/dsl` 一直有 `type: "function"` 图元、场景图也能重算它的
> 导数与切线，但动作表里**只有** `function.analyze` / `function.create_tangent` —— 两个都要求
> **先有一条曲线**。于是"求 f 的导数"能表达，"先把 f 画出来"不能。新增 `function.create_graph`
>（表达式 + **有界**定义域）。
>
> **跨了七处接线**，其中三处是机器逼着改齐的：`actionIds`（**28 → 29**）、`actionRegistry`
>（条目 + 新字段种类 `interval`）、`actionInputs`（区间读取：长度 2、两个有限数、`lo < hi`）、
> `actionSchemas`（区间 → 数字数组；`lo < hi` **不写进 schema** —— JSON Schema 表达不了元素间的关系）、
> `skills/manifest`（`CAPABILITY_FOR_ACTION` 是 `Record<DraftActionIdName, string>`，**漏登记直接 `tsc` 报错**）、
> `scene-graph` 的动作类型与编译器、`agentRunner` 的工作区路由（`function.*` → **`conics`**，**不是 `calculus`** —— 见下方更正）。
>
> **解析在编译期做一次**：用内核同一个 `compileExpression` 试解析，失败即结构化拒绝；
> 反例用例额外断言"错误不是 `unknown_action`"，堵掉假绿。**`functions` 技能已重签**
>（它的自述一直写着"创建函数图像"，而列表里没有能创建的动作 —— 这就是那个洞）。
> 顺带收掉 `prepareWorkspaceFor` 里一处**顺序决定行为**：目标工作区原先取 `wanted[0]`。
>
> **本次读数**：全库非 Lean **329 文件 / 3854 通过 + 1 todo / 0 失败**（146.94 s，+2 = 新增用例）；
> 全量 e2e **204 通过 / 0 失败**；`typecheck` 0、`lint` 0 error / 13 warning。
> **未做**：`f′(1)=0` 的切线判据、本地入口与浏览器证据 —— **V0d 未收口**。
>
> **2026-10-06 V0d 切线判据：核验器自己求导，不读图元里的斜率**
>
> 新增题设种类 `tangentAt`（题面 `在 x=1 处的切线`）与匹配器。**这条 obligation 只记横坐标** ——
> 斜率不由题面给出，而由函数决定。
>
> **判据不读图元里那个 `slope`**：内核重算切线时会把它写进图元，拿它当判据就是**拿系统自证**。
> 核验器改用**中心差分**从表达式独立求导，两个数都比：切点**横坐标**与该点**导数**。
> 对 `x³ − 3x`：`f′(1) = 0`、`f′(2) = 9`。
>
> **没有来源函数时如实报"未核验"**，不退化成"那就只查横坐标" —— 那只核验了一半，却看起来像全过了；
> 有专门用例钉住这条。**变异**：把斜率差强制为 0 ⇒ "错斜率"那条当场红，还原后复绿。
>
> **本次读数**：全库非 Lean **329 文件 / 3858 通过 + 1 todo / 0 失败**（145.77 s，+4 = 新增用例）；
> 全量 e2e **204 通过 / 0 失败**；`typecheck` 0、`lint` 0 error / 13 warning。
>
> **仍未做（V0d 未收口）**：本地入口与浏览器证据；`f(x)=x³−3x` 那种**带函数定义**的完整题面里，
> 函数表达式那一句**还没有匹配器**，整句会如实落在"未核验"上；双曲线 / 抛物线（**已于同日补齐**）。
>
> **2026-10-06 V0d 续：函数定义那一句也判了 + 一处自己引入的错被查出来**
>
> ① **函数定义**：新增题设种类 `functionGraph`（题面 `f(x)=x³−3x`）。判据**按函数值比、不按字符串比** ——
> 题面写 `x³−3x`、图元里存 `x^3-3*x`，字符串比会把同一条曲线判成"不是这条函数"；
> 而"先化简再比"要自己写一套化简，判据就变成"我的化简对不对"。所以取 9 个采样点比函数值。
> **边界如实写进代码注释**：采样等价**不是**符号证明 —— 它报的是"在这 9 个点上没发现差异"。
> 解析侧只做**纯字形替换**（上标转 `^`、`−` 转 `-`、只补 `数字×x` 这一种隐式乘号），
> 不做任何数学变形；`log10(x)` 那种写法因此不会被误改成乘法。
>
> ② **查出并修掉我上一批引入的一个真错**：`function.*` 被我路由到了 **`calculus`** ——
> 而那个工作区**已经退役**（`App.test.tsx` 钉着"外壳里不再提供"，`draftStorage` 钉着"旧草稿不许重开它"，
> `useAgentDocumentBinding` 只给三个在役工作区做绑定）。后果是 Agent 会把用户切进一个界面上不存在的工作区，
> 而**全量测试全绿**（3854 通过）—— 因为**没有任何用例问过"这个动作该去哪个工作区"**。
> 已改为 `conics`（函数图像现在就住在平面几何），并新增 `planWorkspaces.test.ts`：
> 钉住函数族去 `conics`，且**遍历全部动作 id、任何一族都不许路由到 `calculus`**。
>
> **教训（值得留着）**：这个事实其实**早就写在仓库里** ——
> `docs/research/2026-09-18-agent-capability-audit.md` 写着"calculus 为兼容 ID，独立 UI 已退役"。
> 我上一批改路由时没去查"这个工作区还在不在"，只看了 DSL 的 `Workspace` 联合类型里有它。
> **类型里有 ≠ 界面上有。**
>
> **本次读数**：全库非 Lean **330 文件 / 3865 通过 + 1 todo / 0 失败**（127.62 s，+7 = 本批新增用例：
> 3 条曲线判据 + 4 条路由守卫）；全量 e2e **204 通过 / 0 失败**；`typecheck` 0、`lint` 0 error / 13 warning。
> **变异**：让曲线差恒为 0 ⇒ "画了另一条函数"那条当场红，还原后复绿。
> **仍未做**：V0d 的本地入口与浏览器证据；双曲线 / 抛物线（**已于同日补齐**）。
>
> **2026-10-06 V0d 收口：曲线与切线一起画出来（含一处探针揪出的真缺陷）**
>
> 本地新增精确匹配入口（`画出 f(x)=x³−3x 的图像与它在 x=1 处的切线`），要 `functions` 与
> `conics-tangents` **两份**技能清单。浏览器证据：提交后读草稿里真实落盘的曲线与切线，
> **测试自己用中心差分求导**（与核验器那条实现无关，是第三份独立读数）再比对；
> **截图已目视核对** —— 三次曲线与切在右侧极小点上的水平切线同时显示，工作区标签为**平面几何**。
>
> **探针揪出一个真缺陷**：夹具写明 `x: 1`，编译出的切线却画在 **x = 0**。根因是登记表给
> `function.create_tangent` 的 `anchor` 配了默认值 `{kind:"parameter", parameter:0}`，
> **它盖掉了题面写明的 `x`**，并让 `compileTangent` 里"都不给就按 `x` 定位"那一支**永远不可达**。
> 已去掉该默认（纯修复：给了 `x` 就按 `x`，两样都没给仍落到 `x = 0`，与原来同解）。
> **探针方法本身也记一笔**：`x = 1` 那一例分不出"斜率真算了"还是"用了占位 0"（`f′(1)` 恰好是 0），
> 所以我特意用 **`x = 2`**（`f′(2) = 9`）再试一次。
>
> **两处连带记账**：① 触发器起初漏了 `function.*` 两笔，端到端压根不核验 —— 此前的单测直接调
> `verifyDiagramObligations` 绕过了这一层，是本地入口用例逼出来的；② `agentDslMetrics.test.ts`
> 钉死的 `auditedSlots` 由 55 → 54、遗漏率 0.055 → 0.056（登记表少一个默认字段）——
> **改的是被测实现，代价如实记账**。
>
> **本次读数**：全库非 Lean **330 文件 / 3868 通过 + 1 todo / 0 失败**（146.96 s）；
> 全量 e2e **205 通过 / 0 失败**（+1 = 新 spec）；`typecheck` 0、`lint` **0 error / 13 warning**（回到基线）。
> **V0d 测试面已齐**；双曲线 / 抛物线**已于同日补齐**（见下方"V0c 补齐"块），计划的 `V0 出口` 与 `V0 区块收口` **两项仍不能勾**。
>
> **2026-10-06 作图证据固化：把"人看图确认"变成可执行的一件事**
>
> `V0 出口` 的最后一条是"没有 e2e 与**人看图确认**时保持未勾"。机器那半已给全，另一半要人真的看一眼图 ——
> 而图原先只落在 `test-results/`（**gitignore，任何一次 e2e 都会覆盖**）：想看图的人得自己跑一遍测试，
> 还未必跑的是与文档同一版代码。现在四张截图与一份说明固化在 [`docs/evidence/`](evidence/README.md)
>（每张拍的是哪条题面、看什么、怎么重新生成；约 820 KB）。
>
> **逐张目视时抓到一处测试看不出的问题**：V0b 的夹具只建了三个点（那是核验器要的点名表），
> 而计划 V0b 的措辞是"A/B/C 实际点**线段**" —— 题面说"三角形"，画布上是**三个孤立的点**。
> 已补三条边并**再次目视**（A/B/C + 三边、直角在 A）；核验逻辑不受影响（点名表只认带标签的点）。
> 顺带把 `localPlanner.test.ts` 那条"动作列表恰好三笔"的断言改稳 —— 它本会因加边而**误伤**。
>
> **一次偶发如实记录**：本批首次全量 e2e 有单条失败（`agent-underdetermined-diagram.spec.ts`），
> 单独跑与重跑全量（**205 通过 / 0 失败**）均通过，且该 spec 与本批改动无关；按负载敏感记一次。
>
> **本次读数**：全库非 Lean **330 文件 / 3868 通过 + 1 todo / 0 失败**（147.13 s）；
> 全量 e2e **205 通过 / 0 失败**；`typecheck` 0、`lint` 0 error / 13 warning。
>
> **2026-10-06 V0c 补齐：双曲线与抛物线也进核验（轴是曲线的一部分）**
>
> 圆锥曲线原先只认椭圆。现在双曲线（`x²/9−y²/4=1` 与 y 在前的写法）与抛物线（`y²=4x` / `x²=4y`）
> 都会解析并核验。**这两种的判据必须"既比数值、又比轴"**：`x²/a² − y²/b² = 1` 与轴对调版是
> **两条互为镜像的曲线**（半轴一模一样也一样不是同一条），`y² = 2px` 与 `x² = 2py` 更是开口方向不同。
> 轴单独判、**不与数值差混在一起** —— 混进去的话"轴反了"会被报成"差了多少"，
> 而用户看到的两个半轴其实完全一样，那句话会让人以为系统算错了数。
>
> **`y² = 4x` 里的 `4` 是 `2p`，不是 `p`**（焦准距 `p = 2`）。这个坑与上一批"分母是半轴的平方"
> 是同一类：直接把系数当参数，**错得很像对的**。已写进 `parabolaAxis` 的注释。
>
> **变异**：让双曲线的轴判定恒假 ⇒ "轴反了"那条当场红，还原后复绿。
> **一次操作失误如实记**：第一次变异我把整个 `if` 块删掉、只留条件行，文件成了**语法错误**
>（用例报 "no tests"），变异没给出信号；改成"条件恒假但保留代码块"之后才拿到干净的红。
> **破坏性验证要保证改完仍能解析**，否则你看到的红是解析失败，不是判据命中。
>
> **本次读数**：全库非 Lean **330 文件 / 3874 通过 + 1 todo / 0 失败**（147.87 s，+6 = 本批新增用例）；
> 全量 e2e **205 通过 / 0 失败**；`typecheck` 0、`lint` 0 error / 13 warning。
> **V0c 三类圆锥曲线现已全部覆盖**；仍未做的只有计划的 `V0 出口` 要的"人看图确认"（§四 A）。
>
> **2026-10-06 V0c 浏览器证据补齐：三类各有截图**
>
> 上一批把双曲线与抛物线接进判据后，V0c 的浏览器证据**仍然只有椭圆那一张** —— 文档里那句
> "V0c 三类已覆盖"的举证因此**不对称**。本批补上 `e2e/agent-conic-kinds.spec.ts` 两条用例与两张截图。
>
> **独立回代按各自的焦点公式各算一遍**（不读面板结论），这正好说明"为什么轴必须是判据的一部分"：
> 椭圆 `c² = a² − b²`（焦点在长轴）、双曲线 `c² = a² + b²`（焦点在实轴）、
> 抛物线 `y² = 2px`（焦点在 `(p/2, 0)`）。三者都在测试里自己算。
>
> **两张图已目视核对**：双曲线**两支上下开口**（实轴沿 x）、抛物线**向右开口**（对称轴 x），
> 对象清单各 1 项、标签就是题面方程；一并收进 [`docs/evidence/`](evidence/README.md)（现共 **6 张**）。
>
> **一条待查现象**：全量 e2e **连续第二轮**出现"单条偶发"（本批首次跑 1 failed / 206 passed，
> 重跑 **207 全绿**；上一轮那次是 `agent-underdetermined-diagram.spec.ts`，单独跑与重跑都过）。
> 两轮都没改那些 spec、也都没抓到本批新 spec —— **连续两轮就不再是偶然**，列为待查项。
>
> **本次读数**：全库非 Lean **330 文件 / 3878 通过 + 1 todo / 0 失败**（147.73 s，+4 = 本批新增单测）；
> 全量 e2e **207 通过 / 0 失败**（+2 = 新 spec 两条）；`typecheck` 0、`lint` 0 error / 13 warning。

## 一、现在能不能跑（可复核的门禁读数）

### 1. 最近逐项实测读数（**按每行日期阅读**；旧读数不代表本次文档对应源码已重跑，以下「本批实测」均为过程）

| 门禁 | 命令 | 最近一次所列读数（见记录时间） | 退出码 | 记录于 |
| --- | --- | --- | --- | --- |
| 类型检查 | `npm.cmd run typecheck` | 全部工作区 + `e2e/` + `scripts/`，无错 | 0 | **2026-10-10 现场修复批次（3.3.10）复跑** |
| Lint | `npm.cmd run lint` | **0 error / 13 warning**（与基线逐条相同） | 0 | **2026-10-10 现场修复批次（3.3.10）复跑** |
| V0a **进行中**定向（不是阶段出口） | `npm.cmd exec vitest run -- packages/agent-core/src/diagramObligations.test.ts packages/agent-core/src/obligationIR.test.ts packages/agent-core/src/diagramVerification.test.ts packages/agent-core/src/planCompiler.test.ts packages/geometry-kernel/src/witness/constructors.test.ts apps/web/src/agent/diagramDraftStage.test.ts apps/web/src/agent/localPlanner.test.ts --reporter=dot`；`npm.cmd run test:e2e -- e2e/agent-diagram-free-apex.spec.ts --workers=1` | **7 文件 / 171 单测**、**仅新浏览器 spec 3/3**；尚未浏览器逐点坐标回代、截图目视、全量 e2e/全库、真 Lean。`V0a`/`V0` **未验收**。 | 0（所列命令） | **2026-10-06 工作树复验** |
| 历史全库（含 Lean 慢集成；本批未重跑） | `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **325 文件 / 3769 通过 + 1 todo / 0 失败**（**2026-10-06 实测**，529.54 s 与 568.19 s 两次全绿）。**同日另一次（940.93 s）跑出 1 条 5 秒超时** —— 就是本行下面记过的那条**既有抖动**（`fileExports.test.ts` 的 CAD 导出用例），**单跑三次全过、那条用例本身约 0.69 s**。**相对上一条读数（318 / 3659，2026-10-05）是 +7 文件 / +110 用例**，差额来自这两条读数之间合并的 N5a/N5b/N6 那几批，**本批不为它编归因** —— 本批只改文档、两处注释与一条既有测试的注入，**不改测试文件数也不改用例数**（修复前后两次读数的 325 文件 / 3770 项逐字相同）。**以下为上一条读数的原记录，留档**：**318 文件 / 3659 通过 + 1 todo / 0 失败**（**2026-10-05 N4b 后实测**，224 s，**本批 0 抖动**）。**相对 N4a 的 317 / 3645：+1 文件**（新增 `apps/web/src/agent/fixtures/benchmarkPlanningEval.test.ts`，10 条）**/ +14 用例**（另 4 条加在既有文件里：`benchmarkContract.test.ts` +1、`ProviderEval.test.tsx` +3）—— **3645 + 14 = 3659 对得上**。**与上一版记的 315 / 3627 的差额不能全记在 N4a 头上**：文档那个 315 本身已是旧读数 —— 我在 BASE `e96d0f5` 上直接数出 **316** 个被 vitest 收录的测试文件（`packages|apps|scripts` 下的 `*.test.ts(x)`），HEAD `f315cf6` 是 **317**，**唯一新增**是 N4a 那条应用侧判据 `apps/web/src/agent/fixtures/benchmarkContract.test.ts`（+1 文件 / +5 用例）；此外 `scripts/agent-benchmark` 的用例数**本批未变**：BASE `e96d0f5` 就已经是 **40** 条（`benchmark.test.ts` 27 + `run.test.ts` 13），本批只把其中一条断言**改严**（expect 计数 46 → 48）。**（2026-10-05 复核更正**：我上一版这里写成"由 34 条增至 40 条" —— 那个 34 是更早一轮的历史读数（`git show e96d0f5:scripts/agent-benchmark/*.test.ts` 数出来就是 40），被我当成了本批的增量；这是"看起来像实测、其实不存在的 delta"，复核抓出来后已改正。**）**其余差额来自这两个读数之间的其它提交，**不是本批**。**另如实记一次抖动**：独立复核时同一条命令在本机跑出 **1 条 5 秒超时**（`apps/web/src/persistence/fileExports.test.ts` 的 CAD 导出用例）—— 该文件**未被本批任何提交改动**（最后动它是 2026-10-02 的 `fc4df43`），**单跑 9/9 通过、那条用例本身 308 ms**，属**负载敏感的既有抖动**：按本仓口径**超时那次既不算绿也不算红**，但它确实存在、值得记 | 0（本批三次：两次 0，抖动那次为 1） | **2026-10-06 实测（控制器自跑三次）** |
| 本区块非 Lean 慢集成单测 | `npm.cmd exec vitest run -- --exclude scripts/proof-spike/lean4EndToEnd.test.ts --maxWorkers=2` | **353 文件 / 4151 通过 + 1 todo / 0 失败**（**2026-10-10 阶段 B（B1）复跑**，首跑即全绿；比上一读数 **+11 用例** = 本块新增的 **7 条内核 + 4 条搜索层**判据。上一读数 **353 文件 / 4139 通过 + 1 todo / 1 失败**（那是**已记过**的负载敏感抖动 `apps/web/src/persistence/fileExports.test.ts`，孤立复跑 9/9））。与含 Lean 慢集成的历史读数口径不同。 | 0 | **2026-10-10 阶段 B（B1）实测** |
| V0 内部作图范围与候选案例（**非产品已画图**） | `npm.cmd exec vitest run -- scripts/curriculum/diagramScope.test.ts scripts/curriculum/goldCases.test.ts scripts/curriculum/catalog.test.ts scripts/curriculum/examSources.test.ts scripts/docs-consistency/progress-claims.test.ts --reporter=dot` | **5 文件 / 35 通过**；4 个视觉候选、3 默认非图、134 未审；4 家族 × 正反欠定 = 12 条内部描述/坐标候选，其中欠定 4 条允许自由选择；**无真实图元/Lean/新付费 provider 结果**。 | 0 | **2026-10-06 当前本块定向复验** |
| H0b3a 高考来源分级（旧来源清册快照，不属现行分母） | `npm.cmd exec vitest run -- scripts/curriculum/examSources.test.ts scripts/curriculum/catalog.test.ts scripts/docs-consistency/progress-claims.test.ts --reporter=dot` | **3 文件 / 22 通过**：2 篇评析拆 3 卷别来源，8 个候选单元；**完整题目/答案均未审定、金标 0**，不会混进高考题型已覆盖分母。本块未复跑全库/Lean/e2e/Rust。 | 0 | **2026-10-06 H0b3a 实测** |
| H0b2 定向选修正文与 E 类开放边界（历史快照） | `npm.cmd exec vitest run -- scripts/curriculum/catalog.test.ts scripts/docs-consistency/progress-claims.test.ts --reporter=dot` | **2 文件 / 17 通过**：43 表层来源、131 规定性一级要求和 E 类 10 举例；4 类开放 E 范围不报穷尽，0 金标/高考标签，`ready=false`。本块未复跑全量 Vitest、Lean、浏览器或 Rust。 | 0 | **2026-10-06 H0b2 当时实测** |
| H0b1 定向正文索引（历史快照，详见 H0b2 当前读数） | `npm.cmd exec vitest run -- scripts/curriculum/catalog.test.ts scripts/docs-consistency/progress-claims.test.ts --reporter=dot` | **2 文件 / 14 通过**：课程表 43 来源条目，必修/选择性必修 67 条未分类正文一级条目，0 金标/0 高考标签；审计 `ready=false`。本块未复跑全量 Vitest、Lean、浏览器或 Rust。 | 0 | **2026-10-06 H0b1 实测** |
| H0a 定向索引审计（历史快照，详见 H0b1 当前读数） | `npm.cmd exec vitest run -- scripts/curriculum/catalog.test.ts scripts/docs-consistency/progress-claims.test.ts --reporter=dot` | **2 文件 / 11 通过**；课程表 43 源条目、0 原子子型和金标、0 高考标签，`ready=false`。源码 SHA 篡改测试单独验证会红；不代表 Lean 或真实模型成功。 | 0 | **2026-10-06 本区块实测** |
| H0a 非 Lean 慢集成全库回归 | `npm.cmd test -- --maxWorkers=2 --exclude scripts/proof-spike/lean4EndToEnd.test.ts --reporter=dot` | **exit 0**；这次输出过长，未保存可复核的文件/用例总数，不能沿用历史 324/3781 冒充本次计数。Lean 慢集成、浏览器与 Rust 本块未重跑。 | 0 | **2026-10-06 本区块实测** |
| Rust provider 测试 | `npm.cmd run test:rust` | **2026-10-10 复测：250 通过 / 3 ignored / 0 失败**（逐测试二进制加总：9+26+26+12+25+19+22+20+16+16+31+10+9+9 = 250；`ignored` 2+1 = 3；exit 0。与同日早先那次读数**逐项相同**）。新增的是 `tests/proof_command.rs` 9 条：受限证明命令的形状检查、执行类关键字逐个拒、工具链"配置而非发现"、UTF-8 尾部截断、**形状不过一个字都不执行**。再上一条读数是 **238 通过 / 3 ignored / 0 失败**（2026-10-05） | 0 | **2026-10-10 复测** |
| N3 空间线重合安全边界 | `npm.cmd exec vitest run -- apps/web/src/constrainedDrag3.test.ts`；`npm.cmd run test:e2e` | 定向 18/18；全量浏览器 196/196。关闭开关、无关点、禁用约束、零位移不误拦；相关定义点变更 fail-closed。 | 0 | **2026-10-06 本区块实测** |
| 全量 e2e | `npm.cmd run test:e2e` | **首跑 222 通过 / 1 失败**（2.7 m；**2026-10-10 阶段 B（B1）浏览器证据复跑**，比上一读数 **+1** = 新增的 `e2e/agent-apex-angle.spec.ts`）。那 1 条是本文档早已记过的负载敏感抖动 `main-thread-responsiveness.spec.ts`（帧间隔阈值被负载顶破），**孤立复跑 1 passed**；按本仓口径记成抖动，**不**说成全绿。同日更早几趟：**阶段 B（B1）实现复跑 221 / 1**（环境级 `page.goto: net::ERR_NO_BUFFER_SPACE`，孤立复跑 7 passed）、**222 通过 / 0 失败**（阶段 A 数值角的浏览器证据那一块）、221 / 0（四边形底面数值角）、平面数值角复跑 221 / 0（首跑 219 / 2）、圆台近似 221 / 0、直角梯形首跑 220 / 1、§3-D 221 / 0、P2-C 217 / 1、P0-A 215 / 3。此前 196 / 202 / 203 / 204 / 205 / 207 / 212 / 213 / 216 / 217 / 218 都是各自当次的读数，见下方按轮记录）。 | 0 / 1（已记过的抖动那次） | **2026-10-10 阶段 B（B1）浏览器证据复跑** |
| **CI 历史记录（非当前 HEAD 状态）** | 推送后自动跑（`.github/workflows/ci.yml`） | **2026-10-10 逐个提交核对**（查 API，不看推断）：**`1211345`（全仓进度文档 + README 对齐）⇒ #278，四 job（build / e2e / rust / checks）逐 job `success`**；`2c947bd`（空间线重合设计的因果改正）⇒ #276 四 job 全绿；`19aa6b6` ⇒ #275 `cancelled`（被紧随的 #276 取代，内容被它跑到）；**`0fed350` ⇒ #273、`e0e2f64` ⇒ #272、`40ce9b2` ⇒ #270 都是四 job 全绿**；`6105061` #269 `cancelled`（被 #270 取代）；**`e00dc99` ⇒ #267、`cfa9588` ⇒ #266、`48c2ee9` ⇒ #265 都是四 job 全绿**、`b699544` **#259** 四 job **全绿**、`549c85c` #258 绿、`4d13332` #256 绿、`12c3b47` #254 绿、`6a869bc` #252 绿、`5404a4a` #251 绿；更早的**三条 `cancelled`** —— `15102e9` #253、`d61b5cc` #255、`8db3cce` #257，同样是**被紧随其后的推送取代**。**核对范围与口径**：**本行这次写下时，本文件这次提交（docs-only）的 CI 未核对**（它推送之后才有 run）；按本仓那条老规矩，覆盖由**后续那次绿**承担 —— "不要从历史 SHA 推断当前 CI 必绿"，要看当前状态就当场查。**更早的历史**：**#214 / `43a8e6a`、#213 / `fa64943` 四个 job 全绿**（#211 / `29a5970`、#210 / `1893825`、#209 / `d61fe72`、#208 / `580727f`、#207 / `f77d067`、#186 / `0ed1d76`、#185 / `3293794`、#181 / `05a8109`、#180 / `82e85ae` 同样全绿）。**#212 / `baae5f0` 整条 `cancelled`** —— 同样被随后的推送取代，改动被 #213 / #214 跑到了。**`#182 / `2532c1a` 那次取消是真的漏网**：那条提交里**确实有一个真类型错误**（在 `WitnessSearchResult` 判别联合上读了不存在的 `reasons`），**取消意味着没有机器门禁拦住它**，是补跑 `typecheck` 才发现的。**另一类**：#177 / `2adc7d3`、#174 / `e238ac0` 同样整条 `cancelled`（`steps` 为空 ⇒ **没跑过**）。**历史**：run #136 / `2fd2533` 四 job 全绿；#135 / `ab0721e` 红在 `checks`（`lean4Toolchain.test.ts` 六条用例依赖宿主平台，已修）；#134 四 job 全 `cancelled`。 | 0 | **2026-10-10 控制器查 API 逐个提交核对（含 #272 / #273 / #276 / #278 逐 job 全绿）** |
| 性能基线 | `npm.cmd run test:perf` | **9/9**（2026-10-10 复测）；`drag/300-frames` **1652.3 / 1665.4 ms**（两次采样，一次在全套门禁里、一次在空载单独跑，读数一致）—— 比 2026-10-05 那次记录的 **479–488 ms** 高约 3.4 倍。**这不构成"变慢"的结论**：那条用例的护栏是 `expect(elapsed).toBeLessThan(30_000)`，注释写着"这里只抓**复杂度写错了**"——**绝对毫秒不是门禁**，而本仓早就写明"性能与机器负载相关"。校准那一对仍然是单调的：`calibration/solidStatusReport-1x` **15.9 ms** / `-4x` **55.5 ms**（比值 ≈3.5，四趟确实更慢）。历史上三组数字（**686–711** / **479–488** / **1652–1665**）**并存**，各自只代表写下它的那台机器与那次负载。 | 0 | **2026-10-10 复测（两次采样）** |
| 生产构建（web） | `npm.cmd run build --workspace @draw/web` | **成功**（22.32 s，机器同时段有别的负载）；入口 chunk **1,954.26 kB / gzip 577.66 kB**（比 2026-10-05 的 1,803.76 kB **+150.5 kB** —— 这中间落地了现场修复批次、题面改写通道、`solid.create_face`、形式证明入口与面板等；另 `engineeringExporters` 433.81 kB、`geometry.worker` 434.02 kB、CSS 106.15 kB）；产物落 `build-check/mathcanvas-current`（已 gitignore，构建后工作树干净） | 0 | **2026-10-10 复测** |
| Agent 评测 | `npm.cmd run eval:agent` | **2026-10-10 复测**（`deterministic_local`）：pass@1 **4/8**、pass@3 **4/8**、工具选择 **45/45**、工具错误 **3/45**、`average latency 7 ms (successful runs only)`、`provider not measured`、`average cost not measured` —— **与 2026-10-05 那次逐项相同**（离线回归没动）。**这一行的数字是离线回归，不是模型准确率**；真实 provider 那两条轴的状态见下面两行（**2026-10-05 更正**：这里原来写"真实 provider 的 harness 已落地，**但一次还没跑**" —— 那句话把两条轴混成一条：**题集 planning 轴已经跑过两次**，而**工具环 pass@1 轴以前根本跑不了**（请求形状缺陷，`90eba6e` 已修），**修好之后也没人跑过**） | 0 | **2026-10-10 复测**（**未接真实模型**，不是模型准确率） |
| Agent benchmark | `npm.cmd run bench:agent` | 抽取层：`cases=21 covered=14 empty=7 error=0`；`BENCHMARK_PREMISE obligations=24 residue=9 rate=0.727`；`BENCHMARK_EXTRACTION covered=14/21 rate=0.667`。**见证层**：`BENCHMARK_WITNESS verified=1 unverified=20 no_witness=0 error=0 solveRate=0.048`；`BENCHMARK_JUDGEABILITY supported=21 unsupported=3 ambiguous=0 totalObligations=24`；`BENCHMARK_WITNESS_CODES {"(no-code)":1,"requires-candidates":7,"witness-search":20,"unsupported-shape":9,"no-candidate-constructed":2,"unsupported-base-shape":2,"unverified-obligation":26}`（**2026-10-10 复测**：直角梯形那一块改前改后**逐字相同** —— 用 `git stash` 只 stash 内核源码跑了一遍改前。**本行此前的 `no-candidate-constructed:4` / `unsupported-base-shape:4` 是更早某次的分布**（本仓自己记过"码表构成变过、不是同一个分布"），今天实测 2 / 2，**这是重新测量并改正旧读数**） | 0 | **2026-10-10 复测** |
| **Agent benchmark（真实 provider，`planning`）** | 设置 → 真实 provider 评测：题集 planning | **两次运行（同一天、同一台机器、同一套 3 题）**：面板当时显示的都是 `planned 2/3` / `rejected 1/3` / `error 0/3` / `not measured 0/3`；`average latency` **13445 ms**（第一次）/ **8465 ms**（第二次，逐条渲染上线后那次）；`cost not measured`（**仓里没有价目表**）；provider `deepseek-v4-flash / deepseek-v4-flash`；`cases 3`（`layer=planning`，`seed=7`）。**按今天的词表**，那 1 条 `rejected` 其实是 **`clarification`**（模型在问，不是失败）⇒ 同两次运行现在会读成 `planned 2/3` / **`clarification 1/3`** / `rejected 0/3`。**这是计划 N4「先跑小样本真实 provider」那一条的落点** —— **n=3 的子集**，**不是全题集结论**；下面那段说清 `rejected` 那一格当时为什么会被读反。**第三次运行（2026-10-06，带人工可读性标注）**：`planned 1/3` / `clarification 1/3` / `rejected 0/3` / **`error 1/3`** / `not measured 0/3`；`average latency` **18153 ms**；`cost not measured`；**人工可读性第一次有标注**：`plan` 组 `已标 1 / 未标 0`、`clarification` 组 `已标 1 / 未标 0`，两组各 1 条**都判 `unreadable`** ⇒ 两组 `readable 比率 0.000`；`rejected` 组**本轮没有题**（`0/0`）⇒ 如实显示「未标注（分母 = 已标 0，不是 0 分）」，**合计已标 2** | 0 | **2026-10-06 用户在桌面端运行并回传读数原文**（控制器**未旁观**；`3=1+1+0+1+0` 自洽、层与 seed 对得上、非空 provider、`cost` 如实 `not measured`、标注合计 `2=1+1` 自洽，由控制器核对） |
| **Agent 评测（真实 provider，agent 工具环）** | 设置 → 真实 provider 评测：agent 工具环 | **2026-10-10 用户又跑一次（控制器未旁观）**：`pass@1 1/8` / `pass@3 2/8` / `tool selection 45/45` / **`tool error rate 5/45`**（上次 4/45；n=24 单模型单样本，不当"变差"）/ `visual verify not_supported for 1 task (visual-fit)`（**已知且有用例钉住**：`agentEvalRunner.test.ts:23`）/ `average latency 3704 ms` / `attempts 24` / `average cost not measured`（无价目表）。**历史读数**： **`pass@1 1/8`** / **`pass@3 2/8`** / `tool selection 45/45` / `tool error rate 4/45` / `average latency 4126 ms (successful runs only)` / `average cost not measured` / `attempts 24`；provider `deepseek-v4-flash / deepseek-v4-flash`。**口径**：`passAt1` = **第 1 轮就过**的题数（`agentEvalRunner.ts:52`）、`passAt3` = **三轮里任一轮过**（`:53`）。**这是 pass@1 轴的第一次真实读数**（那条通道的请求形状缺陷已在 `90eba6e` 修好）。**边界**：8 题 × 3 轮、**单模型单次采样**；与离线 `deterministic_local` 的 `pass@1 4/8` **不可直接比"谁更好"**（离线是确定性、且那是协议/几何回归，不是模型准确率）；**也不是**题集 `planning` 轴（3 题，另一个坐标系） | 0 | **2026-10-05 用户在桌面端运行并回传**（控制器**未旁观**；`2/8 ≥ 1/8` 单调性自洽、成本如实 `not measured`，由控制器核对） |
| 证明边界 smoke | `npm.cmd run proof:smoke` | **8 通过 / 0 失败**（2026-10-10 复测，与 2026-10-06 那次同数；此前 7）；**`PROOF_BACKENDS {"wired":["lean4"],"reviewed":1,"rows":[{"name":"lean4",…,"verdict":"passed","problems":[]}]}`** —— 接上名单**由 passed 记录推导**（不是手写数组），而**形状合格的伪造产物仍全部 `backend-not-wired`** | 0 | **2026-10-10 复测** |
| 依赖许可扫描 | `npm.cmd run licences:scan` | **2026-10-10 复测：`LICENCES_SCANNED packages=550 distinctExpressions=33`，exit 0**；写回 `scripts/dependency-licences/rust-licences.json`，而**文件内容一字未变**（`git diff` 与 `git diff -w` 都为空 —— 只有行尾差异，已 `git checkout` 还原）⇒ **快照与 `Cargo.lock` 仍然一致**（与 2026-10-05 那次同一条结论） | 0 | **2026-10-10 复测** |
| **形式证明后端（Lean 4，接上的第一个）**（**2026-10-10：Rust 侧也有了第一条窄的桌面命令** `check_lean_proof` / `lean_proof_availability` —— 只接受我们模板生成的那种文件（形状检查在起进程之前：生成标记 / 唯一允许的 import / 有上限的 `maxHeartbeats` / 白名单定理名的 `#print axioms`，另有 15 个"一个字都不许出现"的执行类关键字）、工具链**由 `DRAW_LEAN_LAKE` / `DRAW_LEAN_PROJECT` 配置而不搜 PATH**、固定 argv + 墙钟与输出上限；**它不做判定**（成立与否仍只在 TS 侧判），**也不接产品路径**（缺口③未做）。真起 `lake env lean` 的那条路本块未在测试里跑过） | 仓内 `proof/lean4` + `scripts/proof-spike/lean4EndToEnd.test.ts`（**显式 gated**：没有工具链就打印理由并 skip，**绝不静默通过**） | **真内核闭环成立**：`perpendicular` 的**一般命题**（`∀ E D u v`，不是某组坐标）⇒ **`status=formally_proved` / `judgement=verified` / `axioms ["propext","Classical.choice","Quot.sound"]` / 68277 ms**（另一次 68386 ms）；**同一条命题只把正文换成 `sorry` ⇒ `exit=0` 但 `judgement=failed`、状态**停在 `verified_instance`** —— 同一退出码、相反结论**；`IMPORT-WIDTH narrow=68317 ms / import Mathlib=149532 ms`（另一次 67800 / 157315，**两次都 `exit=0`**）。工具链 `leanprover/lean4:v4.35.0-rc3`（commit `470d5ce1…`；mathlib 的缓存就是它建的）。**⚠️ 口径**：这是**集成用例**（约 6 分钟、GB 级 I/O），**单独跑才是它的口径**；把它放进并行的全库套件里跑会因负载撞上 300 s 墙钟（两次实测）—— 那是负载抖动，不是回归。**⚠️ 2026-10-10 复核（冷/热两读，两者必须一起读）**：这一行的能力**成立，但首次跑要热缓存** —— 单跑 `npx vitest run scripts/proof-spike/lean4EndToEnd.test.ts`：**冷缓存的第一次**撞 300 s 墙钟被杀（`judgement=timeout`，实测 **300015 ms**，适配器如实报 timeout、不返回半成品）；**紧接着热跑同一条命题 ⇒ `status=formally_proved` / `judgement=verified` / `exit=0` / `69071 ms` / axioms `["propext","Classical.choice","Quot.sound"]`**（与历史 68277 ms 吻合，"**1 passed**"；**改完那条失败文案后又跑第三次：`67954 ms`，同一读数**）。同次导入宽度 `narrow=69021 ms / full Mathlib=583065 ms`（narrow 与历史吻合、**full 慢约 4 倍**）。**读法**：mathlib 展开后每工程 7.5 GB，第一次要把 olean 读进页缓存，成本全在第一趟 —— **红一次不要调预算或放宽判据，再跑一次即可区分「冷」与「真的慢」**（这条提示已写进那条用例的失败文案）。`sorry` 那条两种情况下都正确（`exit=0` 但 `judgement=failed`，报 `sorryAx`）。**2026-10-10 扩到四个目标类**（第三个是切线/导数，换了数学塔：实分析而不是内积空间）：新增 `linePlanePerpendicular`（**判定定理**：线⊥平面内两条**相交**直线 ⇒ 线⊥该平面；**原叫 `planePerpendicular`，同日改名** —— 因为解析层那个同名**题设种类**指的是**面⊥面**，同名会让两种题设混成一件，详见 §四 N5）已在本机真跑通过 —— `status=formally_proved` / `judgement=verified` / `exit=0` / **68392 ms** / axioms `["propext","Classical.choice","Quot.sound"]`；两类**定理名不同**（一份 `#print axioms` 报告不能冒充另一类，有用例钉住），两个前提**正好是题面那两条垂直**（比性质定理更接近原题，但**原题其余题设仍不在命题里 ⇒ 前提桥仍未做**）。**仍未做**：曲线性质 / 切线·导数 / 其余立体关系的模板、**产品路径接上自动调用**（库里已有一条会去调 Lean 的路：`automaticProof.ts`，四道门先问该不该跑，通道是注入的端口；**但没有任何产品代码调用它** —— web 侧接线（桌面通道 + 不可信 IPC 回包逐字段校验）已就位，**2026-10-10 产品调用点已接上**（`draftStore.stage` 第八个参数 `proofExport`；旗关着时预览里连 `proofAttempt` 这一栏都没有）；题面目标句 → 结构化目标（`proofGoalReader.ts`）与系统按类给的正文（`canonicalProof.ts`）都已就位 —— 那条链**不需要模型在场**也能走完。**但仍不许读成"自动证明可用"**：偏好打不开这个旗，桌面命令**已会报版本**（2026-10-10）⇒ 产物绑得上；**还差的**是实验入口（偏好打不开这个旗）。**2026-10-10 同日另加两件（都在 proof 模块内，没有产品路径）**：① **目标按点名形状消解** `declaredProofGoalForObligation`（`perpendicular`/`parallel` 各承载"线与线/线与面"两种读法；**面⊥面今天没有目标**，如实 `null`）；② **前提桥** `proofPremiseBridge.ts` —— 每条前提标成 `fromText`（题面原句）/ `fromDerivation`（一步定理，**点名**）/ `fromFigure`（图形蕴含，必须列出来）/ `invented`（**凭空编 ⇒ `ok=false`，不许生成命题**）。**这不是"原题前提桥已完成"**：原题其余题设（底面形状、P 在平面外…）仍不进命题。 | 0 | **2026-10-06 实测（控制器读它日志原文；那次运行控制器未旁观）；2026-10-10 冷跑超时 + 热跑复现（见左栏复核）** |
| N3 定向测试（**计划点名的那七件**） | `vitest run constraints / constraints3d / planar-constraints / reactive/constraints / operations / patches / scene-store` | **7 文件 / 241 通过 / 0 失败** | 0 | **第 31 轮** |
| **N3 出口：动态拖动的浏览器证据** | `npm.cmd run test:e2e -- e2e/agent-constrained-drag.spec.ts e2e/next-phase-flag-entry.spec.ts --workers=1` | **8 passed（27.6 s）/ exit 0** —— 入口 3 条 + spec 5 条（**过约束拒绝 / 冲突恢复 / 一步撤销**都在内）。**⚠️ 口径**：这是**针对性**跑那两个 spec 的读数（**不是**全量 e2e；全量基线 194 见下一行）；测量时刻 **2026-10-06 02:20** | 0 | **2026-10-06 实测（控制器自跑）** |

> **2026-10-05 真实 provider 的第一次读数（`planning`，N4）**：上面那行是**用户在自己的桌面端**跑出来、把面板原文回传的 ——
> **控制器没有旁观那次运行**，所以它是「**用户提供的实测**」，不是「控制器实测」。控制器只核了它的**内部自洽**：
> `3 = 2 + 1 + 0 + 0`、`layer=planning`、`seed=7`、provider/model 非空（契约要求 `real_provider` 必须有身份）、`cost` 如实 `not measured`。
> **读法边界**：这条通道发出去的是**空画布条件下的规划请求**（观察结果空场景、技能全量、**无只读工具**）⇒ 那个 `2/3` 只能读成
> 「**空画布条件下计划被接受的比例**」，**不是**"模型的规划能力"，也**不是**全题集（21 条）的结论（今天只跑了前 3 条，n=3）。
> **两处如实缺口**：① **被拒的那一条为什么被拒，这次没有留下来** —— 原因其实在 `runs[].evidence` 里（`code@path: detail`，或"模型给的是澄清/只读回答"），
> 但 `formatPlanningReport` **只渲染汇总、不渲染逐条**，所以那次的诊断信息随窗口一起没了（控制器本轮把"逐条渲染"列为改进点，并已修）；
> ② **成本仍然没有** —— 这条通道能给 token 数，但仓里没有价目表，所以 `cost` 只能是 `not measured`（不编一个钱数）。
> **它关掉了什么**：计划 N4 的 `:326`（"先跑小样本真实 provider；无凭据时写 `not_measured`、不伪造数字"）**两半都达成** ⇒ 已勾。
> **它没关掉什么**：`:324` 的「**人工可读性**」仍然**既没有字段也没有标注** —— 而且这次运行暴露出：
> 要标注它，得先把**模型给出的计划 / 澄清正文**呈现出来（今天的报告里只有计数与证据串，没有可读的产物）。
>
> **（2026-10-06 更正）上面那段最后两行的"仍然既没有字段也没有标注"已过期，分两次关掉**：
> ① **字段与呈现**由 N4e 补齐（提交 `dbe6fb1`：`BenchmarkRun.humanReadability` + 只读「人读区」）；
> ② **实际标注**由**用户**在 `2026-10-06` 的那次运行里做出（读数见 §一 那一行的第三次运行）。
> **标注口径**（写死在代码里，不是事后描述）：三值 `readable` / `partly` / `unreadable`；判断者是**一个不懂实现的人**；
> 分母**只算有对象可读的轮次**（`not_measured` / `error` **不进**），`plan` 与 `clarification` **各有各的分母**；
> **没标注 ≠ 0 分**（分母为 0 时比率处写的是「未标注（分母 = 已标 0，不是 0 分）」）。
> **这一批的实际结果**：`plan` 1 条 → `unreadable`；`clarification` 1 条 → `unreadable`；合计**已标 2**；
> `rejected` 组本轮**没有题**（不是"漏标"）。
> **⚠️ 读法边界（别把 0.000 读成趋势）**：这是**每组 n=1** 的两个 0.000 —— 它说明的是"**这一次**有一条计划、一条提问，
> 判的人都说看不懂"，**不是**"模型的可读性很差"，也不是全题集结论（全题集 21 条，本次只发前 3 条）。
> **它关掉了什么**：计划 N4 的 `:324`（"每题最多 3 轮，记录抽取率、求解率、题设覆盖率、verified/unverified/no_witness、
> 成本、延迟和**人工可读性**"）—— **七项里六项此前已在位，人工可读性这一项本次到位** ⇒ `:324` 勾。
> 仍如实留着的是**成本**：它永远是 `not measured`（仓里没有价目表），这一栏不是"没做"，是"没有可用的价目表"。
>
> **⚠️ 这次运行暴露的一条新的传输边界（真发现，已记，未修）**：`unsupported-expression` 这一条**没跑成**，
> 结局是 **`error`**，原始消息逐字是
> `ModelPlannerError: 传输失败已尝试 3 次（上限 3）：停下并如实报告。（底层原因：the provider could not be reached: the response exceeded 1048576 bytes）`。
> 也就是说：**那一次模型响应超过了 1 MiB 的上限**，重试到上限后**如实报错**（这正是 fail-closed 该有的行为 —— 它**没有**把没测到的东西记成 `rejected` 或 `planned`）。
> 后果是这条通道对**超大响应**的题**测不出来**；要么把上限做成可配、要么换传输方式，**都还没做**。
> 这条边界同时解释了为什么这次 `planned` 从 2/3 掉到 1/3：**分母没变、是那一条从"有结论"变成了"没测到"**（`error` 不计入 `rejected`）。

> **第二次运行（2026-10-05，逐条渲染上线之后）+ 一个必须说清的读数含义**：用户又跑了一次同样的 3 题，这次面板给出了**逐条行**
>（这正是第一次运行暴露的缺口、本轮修掉的那处），于是"被拒的那一条**为什么**被拒"第一次有了答案：
> - `underdetermined-pyramid-base` → **planned**（`ok=true`；诊断 0 条；可执行动作 1 条；草稿文档已产出）
> - `contradictory-two-lengths` → **rejected** —— **模型给的是澄清、不是计划**：它问的是
>   「线段 AB 的长度不能同时等于 3 和 5（同一线段只有一个长度），请二选一：你希望 AB = 3 还是 AB = 5？（或者给出另一个具体长度）」
> - `unsupported-expression` → **planned**（`ok=true`；诊断 1 条；可执行动作 1 条；草稿文档已产出）
>
> **⇒ 所以 `rejected 1/3` 绝不能读成"模型失败率 1/3"。** 这一格里**至少混着两种完全不同的东西**：
> ① **模型自己发现了矛盾、于是提问**（这次就是这种：它没有硬编一个长度，而是要求用户二选一 ——
> 这与本产品自己的可证矛盾检测是**同一个判断**，属于**好**行为）；② 编译器把计划拒了 / 模型压根没给计划。
> **把两者合成一个 `rejected` 计数，会让读数的方向恰好反过来**（把"模型做对了"读成"模型失败了"）。
>
> **处置（2026-10-05 已实施，用户批准）**：`planning` 层的词表**新增 `clarification`**（跨层词表里本来就有这个词，
> 见证层在用）—— 模型"在问"**独立成一支**，`rejected` 只留"编译器拒了 / 只读回答 / 什么都没给"。
> **fail-closed 那一半一个字没改**：澄清**不是** `planned`（"问了"不等于"计划被接受"）。
> 汇总里也多了一行 `clarification N/M`；逐条行照旧给出**问题原文**。
> **由结构化字段驱动**（信封的 `kind`），**没有**去解析中文证据串 —— 那是第二份判断。
> 判据：契约词表那条**精确相等**的哨兵按设计**先红了一次**
>（`expected ['planned','clarification',…] to deeply equal ['planned','rejected',…]`）才更新；
> 新判据另有**变异**证明它会咬人（把汇总行的标签改掉 ⇒ 红）。

> **2026-10-05 第三次真实运行：pass@1 轴的**第一次**读数（用户运行，控制器未旁观）**：跑的是面板**上面那块**「agent 工具环」
> （8 题 × 3 轮 = **24 次请求**）—— 那条通道的请求形状缺陷在 `90eba6e` 修好之后，这是它**第一次真的发出去并跑完**。
> 读数：**`pass@1 1/8`**、**`pass@3 2/8`**、`tool selection 45/45`、`tool error rate 4/45`、
> `average latency 4126 ms (successful runs only)`、`average cost not measured`、`attempts 24`。
> - **口径**（不许猜）：`passAt1` = **第 1 轮就过**的题数（`agentEvalRunner.ts:52`）；`passAt3` = **三轮里任一轮过**的题数（`:53`）。
>   这份读数内部自洽：`2/8 ≥ 1/8`（`pass@3` 的定义蕴含它不小于 `pass@1`）。
> - **与离线的对比要小心说**：离线 `deterministic_local` 是 `pass@1 4/8` —— **真实模型这一次比它低**（`1/8`）。
>   但这**不是**"模型比本地规划器差"这种结论：两边**不是同一个被测对象**（离线那条腿是**协议与几何回归**，
>   本仓的纪律一直是"**不许把 `deterministic_local` 读成模型准确率**"）；而且这里是 **8 题 × 3 轮、单模型、单次采样**，
>   离线那个数**确定可复现**、这个数是**一次抽样**。它证明的是一件更朴素的事：**这两个数确实不是一回事**。
> - **`semantic verify` 那一行的更正**：用户回传的原文里有 `semantic verify 1/8`，而它**就是 `pass@1` 的重复打印**
>   （`agentEvalReport.ts` 里同一个 `percent(scorecard.passAt1)` 打了两遍；`AgentEvalScorecard` 没有独立的语义验证字段）。
>   **那一行已删除** —— 也就是说门禁第 2 条点名的"**语义验证率**"**今天仍然没有被实现**（判据在 `verification/taskVerification.ts`
>   的任务级语义验证器；要做就得真的算它）。所以这次读数**只有 5 个数据点**，不是 6 个。

> **这一张表现在是同一批读数**（2026-10-05 第 27 轮，九道门禁**串行**跑完，14:47:49 → 14:52:12，
> 约 4 分 24 秒）。第 28 轮又补上了**生产构建**这一行 —— 于是**计划里 N6 出口点名的八道命令
> （`typecheck` / `test` / `lint` / **`build --workspace @draw/web`** / `test:e2e` / `test:rust` /
> `test:perf` / `eval:agent`）现在都有读数**，`bench:agent` 与 `proof:smoke` 是计划之外额外跑的。
> **`drag/300-frames` 的 1295 ms 不再可信**：第 12 轮那次是在**连跑五遍 `test:rust` 之后**测的，
> 本轮同样把 perf 放在整批最后、却得到 **685.9 ms**，与 2026-10-01 基线的 **682.5 ms** 吻合。
> 所以那个 1295 ms 是**测量条件造成的离散值，不是回归** —— 这一条现在有反证，不再是"存疑"。
> **怎么读**：没有一行是"应该没问题"；每一行都是**跑过的**。
> **第 37 轮：把上面这些读数抽出来重跑了一遍**（因为我在第 35 轮抓到过自己一次"假绿"，所以这些数字也该被抽查，而不是一直往上加新的）。**结论：逐条复现** ——
> `cargo metadata` **551 包 / 550 第三方 / 33 种表达式 / 0 个缺 `license` 字段 / 5 个 MPL-2.0-only**（与第 16 轮逐字相同）；
> `test:rust` **238 + 3 ignored / 0 失败**；`eval:agent` **pass@1 4/8、pass@3 4/8、工具选择 45/45、工具错误 3/45**；
> `proof:smoke` **7 通过** + `PROOF_BACKENDS {"wired":[],"reviewed":0}`；`bench:agent` **三条读数逐字相同**。
> **唯一动过的是性能**：`drag/300-frames` 这次是 **710.6 ms**（第 27 轮 685.9 ms）。所以那一行改成**区间**：
> 它是**采样的离散**（两次差 3.6%），不是单点真值 —— 这也进一步说明第 12 轮那个 **1295 ms** 是 1.8 倍的**离群值**。
> **两条统计性结论也顺带加固了**（它们本来只是"概率上说明"）：
> Rust 的 secrets 抖动**又跑了 40 次全绿**，累计 **0/100**（修前 1/15；若真率仍是 1/15，连绿 100 次的概率约 **0.1%**）；
> e2e **又跑了 3 次全绿**，累计 **0/7**（修前 6 次里 4 次红；若真率仍是 4/6，连绿 7 次的概率约 **0.46%**）。
> **第 38 轮：抽查我自己的"结构性论断"（数字能重跑，论断只能反向验证 —— 把条件破坏掉，看该红的是不是真的红）。**
> 这一栏是**反向验证台账**：哪条论断有守卫、守卫是哪条用例。**只有被变异验过的才算"有守卫"**，
> 剩下的只是"我读过一遍"。
>
> | 论断 | 变异（把条件破坏掉） | 结果 |
> | --- | --- | --- |
> | N5 边界：只有 `verified` 能让证据升级 | 改成**无条件**升级 | **3 条红**（含"证明了别的东西"那条） |
> | 表外目标绝不升级 | 停掉 `goalKind === null` 那道门 | **正好那一条红** |
> | `WIRED_PROOF_BACKENDS` **由通过的审查记录推导** | 改回**手写** `["lean4"]` | **3 条红**（含"接入不变量""今天的实况"） |
> | 静默丢句"**再也过不去**" | 从关键词表删掉 `相等` | **4 条红**（含题集级不变量那条） |
> | 每题最多 3 轮 | 上限从 `>` 改成 `> +99` | **正好那一条红** |
> | 每条 run 事件都带 flag 状态 | 抹掉 `revisions.nextPhaseFlags` | **正好那一条红** |
> | 并发：`drop(runs)` 是**锁序的一部分** | 删掉它 | **90 秒自锁、被强杀**（不是逃过） |
> | Rust 依赖里出现 GPL/AGPL/SSPL | 往快照里塞一个 `eviltool@1.0.0: GPL-3.0-only` | **2 条红**（硬禁 + copyleft-only） |
> | `Cargo.lock` 新增依赖却没重新扫描 | （判据本身就是它）本次实测：`lockPackages=550` 与快照 550 条对齐 |
>
> **一条方法教训（第 40 轮，差点把对的文档改成错的）**：我核 §二 里"10 条 / 7 条 / 5 条用例"时，
> 先用 `grep '^\s*it\('` 数 —— `geometryCompileStrategy.test.ts` 数出来是 **3**，与文档写的 **5** 不符，
> 我**差点**就去把文档改成 3。用 runner 一跑才发现：那个文件用的是 **`it.each(cases)`（2 个 case）**，
> 加上 3 条普通 `it(` = **正好 5 条**（三个文件合计 **22**，与 runner 输出一致）。
> **所以：数用例一律以 runner 的输出为准，`grep it(` 会漏掉 `.each` / 循环生成的用例。**
> 这一条也是"审计方法本身会制造缺陷"的现场例子 —— 我要是没多跑那一步，就会往一份**正确**的文档里
> 写进一个**错误**的更正。
> **没有守卫、只靠"我读过"的论断（如实列出）**：① "关闭 `constrainedDrag` 时旧路径就是原来那一行"
> （结构性的，只有注释与代码位置，没有用例；因为它是**同一行代码**，可漂移的东西不存在）；
> ② "两处约束模块互补而非重复"（一条读完两个模块文件的结论，不是可执行的判据）；
> ③ ~~"Rust 传递依赖无 GPL/AGPL/SSPL"（读 `cargo metadata` 得出）~~ —— **第 39 轮已升格为有守卫**：`scripts/dependency-licences/licences.test.ts`（快照 + `Cargo.lock`）。
> **这三条不是错的，是"没被机器挡住"** —— 引用它们时要知道这一点。
> `test-results/` 是 gitignore 的：e2e 的 trace 只在本机，**任何一次默认 e2e 跑都会覆盖它**
>（要留 `error-context.md` 就得用 `--retries=1 --output=...`，见下方过程记录）。

### 2. 待裁决与待办（**六件已解决、0 件等你点头**；表里每一件做完都能立刻推进一格）

| # | 要你定什么 | 为什么我定不了 | 定了之后能做什么 |
| --- | --- | --- | --- |
| 1 | ~~**`constrainedDrag` 怎么打开**~~ **✅ 全解决（2026-10-05）** | 入口：**设置 → 实验性功能 → 约束拖动**（`ExperimentalFeatures.tsx`，偏好存 `mathcanvas:next-phase-preferences`，`agentNextPhaseFlags()` **只**取这一个）。浏览器验收：`e2e/next-phase-flag-entry.spec.ts`（入口 3 条）+ **`e2e/agent-constrained-drag.spec.ts`（拖动正/反例 2 条）** —— 关着时拖动改变 \|AB\|、打开后同样的拖动 \|AB\| **仍是 1**（且断言 A 真的动过，不许用"没变"冒充"被约束住"）。顺带修掉顶栏那个**死的「设置」按钮** | **默认仍是关**（关着走原来的 `translatePrimitive3`）；**定向变异验证过判据**：把 `enabled` 写死 false ⇒ 正例红（实测 \|AB\|=1.539）；全量 e2e 191 通过 |
| 2 | ~~**N5 首批的「勾股」怎么办**~~ **✅ 已裁决（2026-10-05，用户决定）：判成 ⊥ 目标 + 用勾股定理那一步把结论接回来** | 代码里落成 **`inference` 字段**（`proofGoals.ts`）：勾股**仍然没有直接载体**（`obligationKinds` / `constraintTypes` 都空），多的是一条**显式推断路线** `{ from: "perpendicular", theorem: "勾股定理及其逆定理" }`；新增 `proofGoalDischargeRoute()`（`direct` / `via-inference` / `none`）。**关键：不做别名** —— 从约束层问 `perpendicular` **只**会得到 ⊥ | **"一处路线都没有"的首批目标现在是空的**（`goalsWithoutAnyRoute: []`）。`proof:smoke` 把路线一起打出来了。**定向变异验证过**：把 `"perpendicular"` 塞进勾股的载体（别名）⇒ **4 条红**；让路线恒为 `direct` ⇒ 1 条红 |
| 3 | ~~**`real_provider` 用哪个 provider、凭据放哪**~~ **已裁决** | 应用内两段式评测复用凭据库；planning 三轮与工具环一轮由用户运行过，CLI 侧未运行真实 provider。 | **仍缺**作图题真实题集实测、可核对价目表与更多人工判读；新付费请求必须再获明确授权，见 §四 C。 |
| 4 | ~~**旧阶段要不要 `git push`**~~ **已授权并曾执行** | 旧提交已推送，最近 N3 区块为 `7823682`；历史 CI 数不能当当前 CI。 | 此后每区块均更新文档、提交推送并以 `git ls-remote` 核对远端 SHA，发布另行验收。 |
| 5 | ~~**要不要为一句读不通的诊断文案去重新基线化黄金样本**~~ **✅ 已裁决（2026-10-12，用户选 A：面板侧改）** | 那句文案（关系型条件的失败原因说"题设要求 0"）是**用户可见**的（`ConfirmationPanel` 直接渲染 `reason`），但它是**编译器输出的一部分**，被"关闭 flag 时旧路径与 `4707b64` 逐字节相同"那份黄金样本钉着 —— **正因如此，裁决 A 不去动它**：面板本来就拿得到结构化字段（`DiagramCheck.expected` / `actual`），改由面板念一句读得懂的（新模块 `confirmationWording.ts`：`实测偏差 0.24254（这一类条件要求偏差归零）。`） | **黄金样本与编译器输出一个字没动** ⇒ "逐字节相同"那条保证**没有被放宽**。判据：`ConfirmationPanel.test.tsx` 新增 3 条（换掉旧句式 / 带 `detail` 的圆锥等**原样透传** / 通过档照旧）；**变异**（面板改回 `{item.reason}`）⇒ 1 条真红、还原复绿。**边界**：桌面 IPC / 日志 / 导出里仍是编译器那句原话 |
| 6 | ~~**要不要加一行 `.gitattributes`**~~ **✅ 已裁决（2026-10-12，用户决定加）** | 扫描器写出的 `scripts/dependency-licences/rust-licences.json` 是 **LF**，而本仓 `core.autocrlf=true` 期望工作树 **CRLF**，于是 `git status` 报"**假脏**"（`git diff` 是空的、两次扫描的 SHA256 相同）。**2026-10-12 实测复现**：跑 `npm run licences:scan` 后 `git status` 报 `M`，而 `git diff --numstat` 为空 | 已加 `.gitattributes`，**只有一条按路径的窄规则**（`…rust-licences.json text eol=lf`）+ 对该文件一次 `git add --renormalize` ⇒ **再跑一次扫描器仍 clean**。**原先担心的"改的是全仓行尾约定"不成立**：窄规则只动 1 个文件，而且实测 index 里本来就没有任何 `i/crlf`（0 个） |

> 这些我每轮都在问。写在这里，是因为**聊天里的提问会滚掉，这张表不会**。

---

**以下按轮倒序的「本批实测」是过程记录**（最新在最上面）。

**2026-10-05 N4 第四步（题集 7 → 21 条）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **306 文件 / 3567 通过 + 1 todo / 0 失败**（135 s） |
| `npm.cmd run bench:agent` | exit 0；`BENCHMARK_COVERAGE cases=21 covered=14 empty=7 error=0` |
| `npm.cmd exec -- vitest run scripts/agent-benchmark --maxWorkers=1` | **34 通过 / 0 失败**（原 33） |

> **题集从 7 条（每类 1 条）扩到 21 条（每类 3 条）**。归因是**机器展开**的（`BENCHMARK_REPORT` 逐条带 `caseId`/`status`/`evidence`）：`extracted` 14 条、`partial` 2 条（都是二面角/线段比，留下 residue）、`empty` 7 条且**全部带 residue**。
> **14 条新用例里没有一条"整句凭空消失"** —— 包括我**特意**按同一类写法挑的两条（`dynamic-drag-midpoint`「让 M 始终是 AB 的中点」、`dynamic-animate-perpendicular`「让 PA 始终垂直于平面 ABCD」：关系词在句子里、但状语把匹配隔开）。它们都留下了 residue，说明上一轮那个修法确实在管用。
> **新增一条题集级不变量用例**：每一条题都必须至少留下一条给定义或一条 residue（用的就是跑读数时的同一个 `parseObligationIR`，不另写判断）。以后往**题集**加新写法，静默丢掉会红在**题集**这一层。（**2026-10-05 更正**：题集已从 `scripts/agent-benchmark/cases.jsonl` 搬进 `packages/agent-core/src/benchmark/cases.ts` —— 格式仍是 JSONL，载体换成"能被 import 拿到的文本常量"，因为应用侧是浏览器、不能 `node:fs`；所以"往题集里加写法"现在是改那个常量，不是改一个 `.jsonl` 文件。）
> **一条不可比性（必须说清）**：`covered` 从 `5/7`（71%）到 `14/21`（67%）**不是下降，是不可比** —— 题集换了，新加的三类是**刻意偏难**的（`unsupported-expression` / `dynamic-request` / `dihedral-or-ratio`，现在占 9 条）。**这两个数字只记录、不比较。**
> **顺带一条正面的**：`contradictory-three-lengths`（同一条线段被赋三个不同长度）**没有**被静默合并 —— 读出 3 条 `fixedLength`。

**2026-10-05 N4 第三步（逐条归因 + benchmark 查出的缺陷）—— 本批实测：**

| 用例 | 类别 | 状态 | 证据 |
| --- | --- | --- | --- |
| `underdetermined-pyramid-base` | underdetermined | extracted | 3 条 |
| `contradictory-two-lengths` | contradictory | extracted | 2 条 |
| `unsupported-expression` | unsupported-expression | **empty** | 1 条 **unverified**（"AB"） |
| `shuffled-naming` | shuffled-naming | extracted | 1 条 |
| `dihedral-forty-five` | dihedral-or-ratio | **partial** | 2 条 |
| `dynamic-drag-request` | dynamic-request | **empty** | 1 条 **unverified**（修前是"（没有抽出任何子句）"） |
| `universal-proof-request` | universal-proof-request | extracted | 1 条 |

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **306 文件 / 3566 通过 + 1 todo / 0 失败**（135 s） |
| `npm.cmd run bench:agent` | exit 0；`BENCHMARK_COVERAGE cases=7 covered=5 empty=2 error=0` |
| `npm.cmd exec -- vitest run packages/agent-core/src/diagramObligations.test.ts --maxWorkers=1` | **12 通过 / 0 失败**（原 11） |

> **`empty` 的含义要读准**：它是"**0 条给定义**"，**不等于**"什么都没留下" —— 上表两个 `empty` 里都带着一条 residue。
> **benchmark 查出的真缺陷（已修）**：`dynamic-drag-request` 的原话「…**保持六条棱长始终相等**」修前 `givens=0` **且** `unverified=0` —— 一个几何条件词凭空消失，与 `diagramObligations.ts` 自己的纪律（"新写法必须显形，不许把非空题面静默变成空通过"）冲突。**根因**：residue 关键词表只认连续的 `等长`/`长度相等`/`线段相等`/`边相等`，而"棱长始终相等"里只有"相等"，不在表里。**修法**：表里补上 `相等`（一个词）。
> **按纪律走的顺序**：先写**失败**用例（用 benchmark 原话）→ 看到 RED（`expected 0 to be greater than 0`）→ 再改那一个词 → GREEN；"普通说明文字不许变成 residue"的既有用例仍全绿，说明没放宽过头。
> **修后**：该用例的 `evidence` 从"（没有抽出任何子句）"变成一条 `unverified` —— `covered=5 empty=2` 数字未变（定义使然），但记录从"什么都没有"变成"**有，但没核验**"。

**2026-10-05 N3 第五步（线状 `parallel` / `perpendicular` 的投影）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **306 文件 / 3565 通过 + 1 todo / 0 失败**（134 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd exec -- vitest run packages/geometry-kernel/src/constraints3dProjection.test.ts --maxWorkers=1` | **25 通过 / 0 失败**（原 20） |

> **内核最后一块缺口补上了**：线状 `parallel` / `perpendicular` 现在有投影规则 —— 保持**第一条**线不动、把**第二条**绕中点摆过去（取最小改动），**长度与中点都不变**。这与 2D `projectLineConstraint` 是同一口径，所以不需要新的产品裁决（此前我把它记成"要先决定旋转哪一侧"）。
> **三种如实跳过**：方向显式写死的直线（`pointDirection`）、`perpendicular` 而两条线已平行（转 90° 没有唯一答案）、第二条线有端点被锚住（转动要同时动两个端点）。
> **`no-projection-rule` 从此不可达**：有空间判据的约束种类现在都有规则了；代码与文档写明这一点，并**保留**那一支给下一个新增种类。
> **边界**：`constrainedDrag` 开关**仍默认关**，所以这块能力在产品里依然不可达。

**2026-10-05 N5 第三步（后端接线门 + smoke）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **306 文件 / 3560 通过 + 1 todo / 0 失败**（137 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd run proof:smoke` | exit 0；`PROOF_SPIKE {"wiredBackends":[],"firstBatchExpressible":6,"unexpressibleFirstBatch":["collinear","coplanar","pythagorean"],…}` |
| `npm.cmd run proof:smoke -- --mode=lean` | **exit 1**（"没有后端模式，假装有比失败更糟"） |

> **补上了上一版漏掉的一环**：`verifyProofArtifact` 原来只校验形状 / 版本 / 绑定，而**手工编的产物**可以把这些都满足。新增 `WIRED_PROOF_BACKENDS`（**空的**）+ `backend-not-wired`：生产默认一个后端都没接，所以**今天没有任何产物能升到 `formally_proved`**。
> **smoke 验的不是"能不能证明"，而是那条不变量**：首批每一个能表达的目标，用一份"看起来完美"的手工产物都升不上去、且理由必须是 `backend-not-wired`；同时钉住**反方向**（注入假后端后必须能升上去）—— 少了反向那条，一个"永远拒"的实现也能让不变量成立。
> **证据**：proof 目录 25 条 + smoke 6 条。
> **边界**：仍然**没有接任何后端**；加后端前必须先过依赖 / 许可证 / 进程与线程边界审查。

**2026-10-05 N5 第二步（短目标词表）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **305 文件 / 3551 通过 + 1 todo / 0 失败**（137 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd exec -- vitest run packages/agent-core/src/proof --maxWorkers=1` | **22 通过 / 0 失败** |

> **新增** `packages/agent-core/src/proof/proofGoals.ts`：10 种短目标的**封闭词表** + 支持矩阵 + `declaredProofGoal(obligationKind)`。映射按**题设种类**（结构化字段）走，**不做文本关键词匹配**。
> **接线（fail-closed）**：`ProofExpectation` 新增**必填**的 `goalKind`；为 `null`（不在首批）时无论产物多合法都**不升级**，报 `undeclared-goal`。这条门放在绑定检查之前。
> **本批最有价值的产出是一条事实**：计划首批点名的"共线/共面、勾股"**在解析层表达不出来** —— `DiagramObligationKind` 里根本没有这三种（只有 `fixedLength | equilateral | equalLength | midpoint | segmentRatio | planePerpendicular | dihedral | perpendicular | parallel`）。矩阵如实标注为"首批里、但现在表达不出来"，并单列成 `unexpressibleFirstBatchGoals()`；**要一个裁决**（扩解析层，还是从首批划掉）。见 §四 G。
> **证据**：`proofGoals.test.ts` 5 条 + `proofArtifact.test.ts` 17 条；定向变异（停掉 `goalKind === null` 那道门）→ **正好那一条红**。
> **边界**：仍然**没有接任何后端**；`dihedral` 能表达但**不在首批**，同样不升级。

**2026-10-05 N5 第一步（形式证明出口的边界）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **304 文件 / 3544 通过 + 1 todo / 0 失败**（136 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd exec -- vitest run packages/agent-core/src/proof --maxWorkers=1` | **15 通过 / 0 失败** |

> **N5 的判据第一次可执行了**：`verified_instance` / `sampled` **不能**变成 `formally_proved`；伪造、缺字段、版本不匹配、以及**"证明了别的东西"**（`claimId` 或 `inputHash` 不匹配）的产物一律拒绝。落点是 `packages/agent-core/src/proof/proofArtifact.ts` 的 `verifyProofArtifact` / `evidenceStatusWithProof`。
> **两条设计决定**：① 校验**必须**带 `expectation`（`claimId` + `inputHash`）—— 否则一份"证明了别的东西"的合格产物贴过来也看不出来；② **拒收不是第五种结局**，只报 `failed` + 机器可读 `reasons`。
> **证据**：15 条（一半反例）+ 一条定向变异（改成无条件升级 → 3 条红）。
> **当时边界（2026-10-05 快照，已过期）**：当时没有接任何后端，所以当时真实运行只会得到 `unsupported`；后来接入 `lean4` 一类条件引理，现况见本文件顶部与 §四 F。"一份证明该绑到多细的输入"**未裁决** → **2026-10-05 已裁决**（R51 + R56，落地在 `proofInputHash` 与 `ProofLevelNotice`；见 §四 G 那一节）。

**2026-10-05 N6 门禁复跑（**串行**跑完整套）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **303 文件 / 3529 通过 + 1 todo / 0 失败**（135 s） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd run test:rust` | 五次里**四次 236 通过 / 3 ignored / 0 失败**；**一次有 1 条失败** |
| `npm.cmd run test:e2e -- --workers=3` | **185 通过 / 1 失败**（`three-canvas-size.spec.ts:72`） |
| `npm.cmd run test:perf` | **9 / 9 通过**；`drag/300-frames` **1295 ms（≈4.3 ms/帧）** |
| `npm.cmd run eval:agent` | exit 0；`deterministic_local`：pass@1 **4/8**、pass@3 **4/8**、tool selection **45/45**、tool error rate **3/45** |
| `npm.cmd run bench:agent` | exit 0；`cases=7 covered=5 empty=2 error=0` |

> **两条红都不是稳定复现的 —— 定位记录紧接在下面。** 全量 e2e 跑了**两次**：一次 **186 通过 / 0 失败**，一次 **185 通过 / 1 失败**；那条单独跑 3 次全过（12/12）。`test:rust` 同理（五次里四次全绿）。按本仓纪律"不复现就不猜着改"，两条都记为**不稳定**，既不写成"已修"，也不写成"与本批无关"。

**2026-10-05 N6 门禁不稳定：把两条红定位到具体用例**

| 门禁 | 现象 | 定位 | 判据与边界 |
| --- | --- | --- | --- |
| 全量 e2e | **已修**（原来 6 次全量里 4 次红） | 四次现场**全部是同一条断言**：`data-preview-hovering` 期望 `"true"` 实收 `"false"`（`three-canvas-size.spec.ts:90` 与 `geometry3d-section.spec.ts:59` 是同一条） | 机制见下；**修后连续 4 次全量全绿**（186 passed，无 flaky） |
| `test:rust` | **已修**（原来五次里一次红） | 定位到 `tests/secrets.rs:149`（`put` 成功后 `with_secret` 读回 `None`）。判别实验：**默认并行 15 次红 1 次**、**`--test-threads=1` 20 次全绿** | 见下；**加锁后 60 次并行全绿 + 3 次全量 `test:rust` 236 通过 / 0 失败** |

> **为什么不"顺手加一次重试"把红压下去**：那会把一条**真实的不稳定**藏起来，而这个组件是**密钥库** —— 它报"没有配置"时，调用方会去发一次注定 401 的请求。要么找到根因，要么如实留着这条记录。
> **下一次要做的**：让 e2e 失败时的产物**在失败当次就留住**（Playwright 的 `error-context.md` 会被下一次运行清掉），至少先拿到**是哪一条断言**。

**2026-10-05 `test:rust` 的不稳定：判别、排除、修法与证据**

- **判别实验（把范围缩到一件事上）**：`node scripts/toolchain.mjs cargo test --manifest-path
  apps/desktop/src-tauri/Cargo.toml --test secrets` —— **默认并行：15 次里红 1 次**；
  同一命令加 `-- --test-threads=1`：**20 次全绿**。所以它**需要并发**才能发生。
- **排除掉"别的用例把它删了"**（读完整份 `tests/secrets.rs` 得到的，不是猜的）：每个用例用各自的
  profile 名（`SCRATCH_PROFILES` 那条等集断言钉着），`__probe__` 那条是 `#[ignore]`，
  **没有任何用例会删别人的格子**。
- **剩下的是什么**：所有用例共享**同一个凭据服务名**（`windows.rs` 的 `SERVICE = "MathCanvas"`，
  target 不同但服务相同），而 `keyring` 的 Windows 后端存在 `Error::Ambiguous`
  （"matched more than one entry"）这种**枚举**语义 —— 并发写/删会让另一次查找**瞬时**看不到条目。
- **修法**：`tests/secrets.rs` 里凡是走真实凭据库的用例（5 处 `create_store()`）先取一把
  `static STORE_LOCK: Mutex<()>`。**这不是"加重试"**：它只让**测试 harness** 不再制造一个产品里
  不存在的场景（产品里凭据的存/删是用户逐次触发的）。**它不主张"产品对并发凭据访问是安全的"** ——
  那件事本文件没有测，也没有因为这把锁变成已测。
- **证据**：加锁后 **60 次并行 `--test secrets` 全绿**（若真实故障率仍是 1/15，连绿 60 次的概率约
  **1.6%**），并且**连续 3 次全量 `test:rust` 都是 236 通过 / 0 失败**。
- **一处工具教训（留档）**：第一次跑"单线程 20 次"时得到 **20/20 失败**，险些当成"单线程必红"——
  其实是**我自己漏了 `--manifest-path`**，cargo 在仓库根找不到 `Cargo.toml`。这正是本仓那条纪律
  "环境错误不能算 RED / 每条读数要看自己的退出码"的现场例子：**20/20 这种整齐的失败率本身就是警报**。

**2026-10-05 e2e 抖动：修掉了（一条断言、一个机制、一处调用点）**

- **收敛成一条**：用上面那个配方又跑了 3 次全量，**又红 2 次、都在 `three-canvas-size.spec.ts:72`**；
  把这次留下的 `error-context.md` 读出来才发现，它和在 `geometry3d-section.spec.ts:42` 红的那次
  **是同一条断言** —— `data-preview-hovering` 期望 `"true"` 实收 `"false"`。
  **四次现场（含 round-12 那次硬失败）全部是同一条**，失败那一刻场景读数也一致
  （`data-preview-count="1"`、`data-scene-syncs="5"`）：**预览在，指针却不在它上面。**
- **机制（推断，与全部证据一致）**：`animateToFit` 约 250ms，在 rAF 里逐帧插值整份相机状态；
  而 `e2e/helpers/projection.ts` 的 `projectWorldPoint` **一上来就读** `data-camera-*`。
  动画没跑完时读到的是中途值，等 `mouse.move` 执行时相机又动过 —— 投影出的屏幕点不再对应那个世界点，
  而预览命中区只有那圈边界虚线，差一点就是空。指针事件不会再发一次。
  同类竞态本仓修过一次（`geometry3d.spec.ts:277`）。
- **修法（单源）**：把"等相机停稳"放进 `projectWorldPoint` **内部**，判据是**连续两次读数一致**
  （不写死 sleep），与既有的 `settleCamera` / `settledTarget` 同一套口径；画布盒子的读取挪到 settle **之后**。
- **证据（是证据，不是证明）**：修前 **6 次全量里 4 次红**这条断言；修后 **连续 4 次全量、4 次全绿**
  （`186 passed`、无 flaky）。若真实故障率仍是 4/6，"连绿 4 次"的概率约 **1.2%**。
  **我没有直接录到"投影那一刻相机还在动"的那一帧**，所以说的是"与全部证据一致"，不是"已证明"。

**2026-10-05 e2e 抖动：拿到了断言现场与复现配方**

- **配方**（这是本批真正有用的产出）：`playwright.config.ts` 里 `retries: process.env.CI ? 2 : 0`、
  `trace: "on-first-retry"` —— **本机 retries=0，所以一次抖动什么证据都不留**。加两个参数就有：
  ```
  npm.cmd run test:e2e -- --workers=3 --retries=1 --output=test-results/flake-probe-1
  ```
  `--retries=1` 让 `trace: "on-first-retry"` 生效（第一次失败就落 trace），
  `--output` 指向一个**新目录**就不会被下一次运行清掉。这一次就是这么拿到 `trace.zip` 与
  `error-context.md` 的（报告里写的是 `1 flaky`，整轮仍 exit 0）。
- **现场**：`geometry3d-section.spec.ts:42` 第 59 行 `data-preview-hovering` 期望 `"true"`、实收 `"false"`；
  失败那一刻场景的读数里 **`data-preview-count="1"`、`data-scene-syncs="5"`、`data-scene-reused="3"`** ——
  **预览是存在的**，只是"悬停"这个属性没被翻过来。
- **已经排除的**：自愈那条路是通的 —— `threeScene.tsx:307` 的 effect 依赖里含 `previews`，
  它调 `runtime.syncContent()`，而那个包装（`threeSceneEffect.ts:452-459`）在 `syncContent()` 之后
  调了 `refreshPreviewHover()`；`threeScenePreviewHover.ts:137` 确实用最后指针位置重算。
  **所以"指针先到、预览后到"这条老路已经被堵住了**，这次的 `false` 不是那条。
- **两个还没证实的假设**（**没有改代码**，因为这条抖动 1/N、拿"跑过一次绿"当证据不算验证）：
  1. **屏幕坐标是在布局稳定之前算的**：`grabPoint()` 用 `projectWorldPoint` 投影出屏幕点，
     而画布高度依赖状态栏高度；并行负载下投影时与 `mouse.move` 时的画布尺寸可能不同，
     同一个屏幕点因此落在预览**边界线之外**（预览的命中区只有那圈虚线）。这条假设能解释
     为什么"属性一直 false"（事件不会再来一次）以及为什么单独跑必过。
  2. **预览组的几何在 refresh 那一刻还没就位**：`previewHitAt` 对预览组做射线检测，
     若组已建、但对象的位置/几何在**同一趟同步的后半段**才写好，自愈那一次也会打空。
- **下一步**：把 `--retries=1 --output=<新目录>` 固化成抓抖动的常规做法；
  再拿到 2–3 份现场之后，按两次现场共同点去证伪上面两条假设中的一条 —— **证据不足之前不猜着改**。
> **性能读数要谨慎比较**：`drag/300-frames` 这次 **1295 ms**，而本文件 2026-10-01 的读数是 **682.5 ms（≈2.3 ms/帧）**。这一次是在**跑完一整套门禁之后**测的（机器不是空闲状态），所以**不能据此断言回归**；要判断趋势得在空闲机器上单独复跑。
> **`eval:agent` 的数字与 2026-09-29 那次逐项相同**（4/8、4/8、45/45、3/45），模式仍是 `deterministic_local` —— 计划的记分卡原文写明它**与模型能力无关**。
> **串行纪律**：这一套是**依次**跑的。把 `test:e2e` 与那几条 node 套件并行跑会污染主线程读数（本文件记过：拖动那一档从 16.8 ms 涨到 366.7 ms），那样跑出来的 e2e 不算一次有效验收。

**2026-10-05 N4 第二步（benchmark 运行入口与 `layer` 契约）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **303 文件 / 3529 通过 + 1 todo / 0 失败**（135 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd run bench:agent` | exit 0；**`BENCHMARK_COVERAGE cases=7 covered=5 empty=2 error=0`** |
| `npm.cmd run bench:agent -- --mode=real_provider` | exit 0；`measured: 0` / `notMeasured: 7`（适配器未实现） |
| `npm.cmd run bench:agent -- --mode=nonsense` | **exit 1** 并打出可选项 |

> **`layer` 契约**：运行记录分 `extraction` / `witness` 两层，**每层有自己的结局词表**，跨层用词被拒绝 —— 拿见证层的词描述抽取层是范畴错误，而一律写 `not_measured` 又会把"跑了抽取、没跑求解"说成"什么都没测"。
> **2026-10-05 N4b 追加（这一段是追加，不是改写）**：契约现在有**三层** —— 新增 `planning`（应用内真实 provider 评测记"模型给的计划有没有被 `compilePlan` 接受"）。它**不是**塞进 `extraction` 的：真实模型产出的是**规划**能力，拿抽取/见证的词描述它同样是范畴错误。CLI（`bench:agent`）仍然只发 `extraction` / `witness` 两层，所以上面那三条读数**逐字未变**。
> **第一个真实读数**：抽取层在七类起步题集上覆盖 5 道、**2 道一条子句都没抽出来**。这是**读数不是门禁**（刻意没有把任何阈值钉成断言）。
> **`real_provider` 整批 `not_measured`**：适配器还没写；`provider`/`model` 写 `null` 是被允许的，但只要不写 `not_measured` 就必须是非空字符串 —— 没凭据时编一个模型名字等于把"没测"说成"测过了"。
> **（2026-10-05 N4b 更正）**：上面那句"适配器还没写"**只对这条 CLI 路径成立**。生产侧的适配器早就在（`apps/web/src/agent/modelPlanner.ts` 的 `createModelPlanner`，密钥由 Rust 侧从系统凭据库借出、走回环代理），应用侧也已经有一条跑题集的通道（`apps/web/src/agent/fixtures/benchmarkPlanningEval.ts`，记 `planning` 层、3 题 × 1 轮）。**这条 CLI 入口没有把它接上**，所以这一路继续整批 `not_measured` —— 那是诚实的"没测"。（同一次更正也修了 `scripts/agent-benchmark/run.test.ts` 文件头里那句同样的旧措辞；行为未动。）
> **还没做**：真实 provider 一个都没跑；题集只有七类各一条；**没有按题归因那 2 道抽不出子句的是哪两道**。
> **（2026-10-05 N4b 更正）**：这一行里"题集只有七类各一条"与"没有按题归因"**两条已过期** —— 题集现在是 **21 条（七类各 3 条）**，逐条归因也已做完（见 §一 的 benchmark 那一行）。**仍然成立**的是：**那次真实 provider 运行一次都没跑过**（通道已接好、判据已写足，触发点在界面里、由人点）。（**2026-10-05 当天再次更正**：这句写下之后又不成立了 —— 用户随即在桌面端跑出了**两次**读数；而且"一次都没跑过"这个说法本身也把两条轴混了：**跑过的是题集 planning 轴**，**工具环 pass@1 轴是"跑不了"**（缺陷已在 `90eba6e` 修好，仍没人跑过）。见 §一 那一行与计划 N4 第七/九/十步。）

**2026-10-05 N4b（应用内评测接到 21 条题集 + 报告契约新增 `planning` 层）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd exec -- vitest run --maxWorkers=2`（全库） | **318 文件 / 3659 通过 + 1 todo / 0 失败**（224 s，**本批 0 抖动**） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd run bench:agent` | exit 0；**13 通过**，三条读数**逐字未变**（见 §一 的 benchmark 那一行） |
| `npm.cmd run test:e2e` | **194 通过 / 0 失败**（1.1 min） |
| 定向（`apps/web/src/agent/fixtures` + `ProviderEval.test.tsx` + `scripts/agent-benchmark` + `modelPlanner.test.ts`） | **12 文件 / 138 通过 / 0 失败** |

> **这一批把应用内评测真正接到那 21 条上**：报告契约新增 `planning` 层（词表 `planned` / `rejected` / `error` / `not_measured`，每个词的含义写在 `packages/agent-core/src/benchmark/report.ts` 的定义处）；应用侧新通道 `apps/web/src/agent/fixtures/benchmarkPlanningEval.ts` 跑题集的**前 3 条 × 1 轮**（`seed=7` 与 CLI 同一个、`cost` 显式 `null`、`latency` 实测），路径是 `createModelPlanner` → `plan(request)` → `compilePlan`。
> **判据只有编译器那一处**："计划被接受" = `compiled.ok` **且**信封是 `kind: "plan"`；**模型只给澄清不算接受**（fail-closed）。三处变异各自抓红（改了什么 → 哪条红）：编译失败写成 `planned` ⇒ 2 条红；澄清当接受 ⇒ 1 条红；拿掉 `rejected` 词 ⇒ 1 条红。全部还原并逐字节核对。
> **界面**：两套评测**各自独立、各自两段式、各自报请求数**（agent 工具环 **24** 次 / 题集 planning **3** 次）；旧那套 8 题记分卡的**行为一个字未改**（它那 3 条既有用例原样绿）。
> **读数该怎么读（边界，必须一起读）**：这条通道发出去的是**空画布条件下的规划请求** —— 观察结果是空场景（题集里每条题都从零作图）、技能清单是**全部技能**、而且**没有只读工具**（harness 没有 `ToolPort` 宿主，故 `readToolsAvailable: false`）。所以将来那个数字要读成「**空画布条件下计划被接受的比例**」，**不是**"模型的规划能力"（真实会话里模型有画布观察、有只读工具、技能也可能被裁剪）。差异逐条写在 `apps/web/src/agent/fixtures/benchmarkPlanningEval.ts` 的适配器注释里。（**2026-10-05 控制器补**：这句原来是**只写在模块注释里**的，`current-status` / `CHANGELOG` / 计划三处都没有 —— 一个会被误读成"模型能力"的数字放在状态文档里而不带边界，正是本仓最忌的那类。）
> **没有跑那次付费运行**：触发点在桌面端界面、密钥在系统凭据库里（浏览器只会得到 `no_desktop_shell`）⇒ **真实 provider 的读数一个都还没有**。（**2026-10-05 当天更正**：这句在写下之后就不成立了 —— 用户随后在桌面端跑出了**第一次真实读数**，见 §一 那一行与计划 N4 第七步。原句保留在这里，是为了让"哪一批是什么状态"可回溯。）
> **本批发现一处既有缺陷（未修，已上报）**：旧那条通道（`providerAgentEval.ts` + `offlineAgentEval.ts:30`）把请求写成 `{ userMessage } as never` —— 那对 `createLocalPlanner` 成立，对**真实** `createModelPlanner` **不成立**，实测抛 `TypeError: Cannot read properties of undefined (reading 'context')`，而且抛在**任何请求发出之前**。新通道不受影响（用完整 `PlanRequest`，并有"真规划器 + 假 transport"的用例钉着）；旧通道的修法会改变旧评测语义 ⇒ **留待裁决**。

**2026-10-05 N4 第一步（benchmark 题集与报告契约）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **302 文件 / 3520 通过 + 1 todo / 0 失败**（133 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd exec -- vitest run scripts/agent-benchmark --maxWorkers=1` | **24 通过 / 0 失败** |

> **这一批只交付"载体与判据"，不是测量结果**：`scripts/agent-benchmark/` 的题集 schema + 校验器、凭据检查、运行记录与报告契约，以及七类各一条的起步题集。
> **三条硬规矩**：必需字段必须**在**（"没测"写显式 `null`，不是删掉键）、**模式必须标识**（`deterministic_local` / `real_provider` 不许混报）、**claim 必须有证据**（唯一例外 `not_measured`）。
> **口径说明**：计划原文要"必须含 provider/model"，而 `deterministic_local` 本来就没有 provider —— 所以**键必须在、值可为 `null`**；`real_provider` 模式下两者必须是非空字符串。
> **证据**：24 条用例成对写（每条"必须失败"配一条"合法输入不许被判失败"）；两条定向变异各抓红对应用例。
> **尚未做**：`runner.mjs` 没写，**一个真实 provider 都没跑**，报告里没有任何 pass@1 / 成本 / 延迟数字。

**2026-10-05 N3 第四步（可证的矛盾）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **301 文件 / 3496 通过 + 1 todo / 0 失败**（134 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |

> **把"没能同时满足"与"本身不可能成立"分开。** 新增内核 `findConstraintContradictions`，**只报能证明的两种**：① 同一条线段两个不同的长度要求（按无序点对归组）；② 点既在线上又在面上、而线与面**平行且不相交**。投影结果新增 `contradictions`，接线层的拒绝文案**先**说矛盾、再退回"没能同时满足"。
> **四种能解的情形必须放过**（这一半用例比正例更重要）：直线**落在**平面里、直线与平面**相交**、同一个长度写两遍（冗余）、不同线段各自的长度要求。
> **已知边界**：**直线 ∥ 直线不相交没有判据** —— 投影在它上面照样振荡，所以只能说"没能同时满足"，有一条守门用例钉着这个边界。
> **证据**：内核 7 条（3 正 4 反）+ 接线层 1 条；三个定向变异 —— 过度报告 → **反例**红，拿掉"落在平面里"守卫 → 对应反例红，停掉检测 → **4 条正例全红**（含接线层）。
> **产品行为仍未变**：开关默认关着。

**2026-10-05 N3 第三步（拖动接线的决策层）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **301 文件 / 3488 通过 + 1 todo / 0 失败**（135 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |
| `npm.cmd run test:e2e -- e2e/geometry3d-drag.spec.ts e2e/geometry3d-creation.spec.ts --workers=1` | **19 通过 / 0 失败**（27 s）—— 含"一次自由拖动只撤销一步"与"拖动实体不转相机" |

> **这是第一批**摸到产品路径的 N3 工作：新增 `apps/web/src/constrainedDrag3.ts`（纯函数 `planConstrainedDrag3`），并把 `App.tsx` 的 3D 拖动抬手（`onDragEnd`）接上它。
> **但开关默认仍然关着**（`agentNextPhaseFlags()` 恒返回五关），关着时**逐字**走原来那一次 `apply({ op: "translatePrimitive3", id, delta })` —— 所以**产品行为与上一版完全相同**。
> **四条语义**：① 被拖点是**暖启动**不是硬锚（先放到"原位置 + delta"，再让投影把它连同别的点拉回约束 —— 所以它会贴回约束、可能不在指针正下方；做成硬锚会让"拖平面上的点"100% 被拒）；② 不许动的是锁定点与绑定点；③ 四种出口 `passthrough` / `noop` / `refused` / `commit` 分开，拒绝时一个坐标都不写、被抵消时不提交空事务；④ 提交走**一次** `applyBatch` → `commitTransaction`，所以一步撤销是白拿的。
> **前置已裁决**：op 工厂 `patchPoint3` 早就存在，所以"一次改多个点坐标"不需要新 op。
> **证据**：`constrainedDrag3.test.ts` 11 条（斜着拖 → 贴回平面并 commit；沿法向拖 → noop）。
> **浏览器用例已补（2026-10-05）**：`e2e/agent-constrained-drag.spec.ts` —— 关着开关时同样的拖动**改变 |AB|**、打开后 **|AB| 仍是 1**（并且正例**先断言 A 真的动过**，不许用"没变"冒充"被约束住"）。入口是顶栏「设置」→ 实验性功能 → 约束拖动。**N3 的出口（`constrainedDrag=true` 的浏览器正/反例）已达成。**

**2026-10-05 N3 第二步（拖动层的自由度与冗余诊断）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **300 文件 / 3477 通过 + 1 todo / 0 失败**（138 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |

> **又一批内核新增，同样没有接进任何产品路径。** 产品行为仍与 `9a65e6d` 之前完全相同。
> **新增内容**：`projectPoint3Constraints` 的结果加 `analysis` —— 在**最终构型**上对可动坐标做数值雅可比、算秩，得到"还剩多少自由度"与"有没有冗余约束"。同时新建内核 `linear-algebra.ts` 的 `rankRows`，并把 `agent-core/src/constraintIR.ts` 里那份 `rankOf` 删掉改调它（**消灭一处跨包重复**：拖动层与文档层问的是同一件事，两处各写一份就会出现"同一组几何、两个不同的秩"）。
> **三条必须分开的语义**：① `redundantConstraintIds`（重复/能推出）与 `unaffectedConstraintIds`（那一行恒为零）分开，混在一起会让正常文档被读成"过约束"；② 判据是"行是不是零"，**不是**"点名里有没有可动点"（`pointOnPlane(p, 平面)` 里 p 被锚住、平面定义点仍可动时行是非零的）；③ 本读数与 `reportFreeDegrees` 不是同一个问题（那个按绑定算、扣规范自由度；这个按锚点算、不扣），共用的只有秩。
> **明确不声称**：矛盾约束在顺序投影下**振荡**，只报 `exhausted` + `unsatisfiedConstraintIds`，**不报 `inconsistent`**（"无解"需要可证的冲突检测，本层没有）；`remainingDof` 是**一阶**读数。
> **证据**：`constraints3dProjection.test.ts` 13 → **20 条**，新建 `linear-algebra.test.ts` **8 条**；两条定向变异各自抓红（秩改成行数 → 9 条红，**含 `agent-core/constraintIR.test.ts` 的重复约束用例**；锚点被忽略 → 2 条红）。

**2026-10-05 N3 第一块砖（3D 约束的点投影，内核）—— 本批实测：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **299 文件 / 3462 通过 + 1 todo / 0 失败**（126 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |

> **这一批全是内核新增，没有接进任何产品路径。** `apps/web` 的 `threeScene*`、`scene-graph` 的约束事务与 undo/redo 一行未动，所以**产品行为与上一版完全相同**。
> **新增内容**：`packages/geometry-kernel/src/constraints3dProjection.ts` 的 `projectPoint3Constraints` —— 顺序投影，支持 `pointOnLine` / `pointOnPlane` / `collinear` / `coplanar` / `fixedDistance`，带 `anchoredPointIds`。判据是 fail-closed 的：`satisfied` 要求每条约束都被判过且在容差内，`skipped` 非空时恒为 `false`；`exhausted` 单独表示"次数用完还没到定点"。
> **如实跳过的**：`parallel` / `perpendicular` 的线状写法（要先决定旋转哪一侧的点，属产品判断）进 `no-projection-rule`；`coincident` 进 `planar-only`；几何退化进 `no-judge`；点全被锚住进 `no-movable-point`。
> **证据**：新增 13 条用例，先红后绿；两条定向变异各自抓红对应用例（① 投影改成原样返回 → pointOnLine 两条红；② 拿掉"已满足就早退" → "本来就满足"那条红）。
> **还没做**：接进拖动管线、`parallel`/`perpendicular` 的线状投影、与 `constraintIR.reportFreeDegrees` 合流、浏览器端 e2e。

**2026-10-05 N2（解析见证构造 + 有界见证搜索 + flag 接线）—— 控制器在 `9c5ae2f` 上复跑：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **298 文件 / 3449 通过 + 1 todo / 0 失败**（329 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |

> **N2 仍然没有改变默认行为。** `witnessSearch` 缺省**关**；关闭时编译结果与 `4707b64` **逐字节相同** —— 这条不是靠"看起来没变"，而是有一条**对着基线采的 golden 钉**（golden 由 **BASE 实现本身**跑出来：6 个输入 × 两种生产形状（缺省 / `false`），断言逐字节 JSON + 顶层 key 集合 + `diagramVerification` key 集合）。
> **这次真正接上的能力（关着 flag 时都不生效）**：原话题设受支持、而**模型给的坐标没能全部通过核验**时，系统自己生成一组见证坐标、**再走一遍同一个物化与核验路径**（只有 `passed` 才能进草稿）；模型坐标本来就合格时**根本不搜**（只救不抢）；搜不到就保持原样、**不产生半份草稿**。
> **N2 抓出并修掉的真缺陷（都有回归）**：① 搜索器曾把题设"洗白"后再判（丢掉解析器故意留下的未核验 residue），于是能对一个**产品路径会判未核验**的题面报 `verified_instance`（RED 实证：带 `∠ABC=60°` 的题面改前确实"通过"）；② 核验器在做**2D 点自由度**时按"有没有绑定"而不是按**绑定种类**判（线上点报 3），而 N1 的文件头承诺的是 1；③ 两个**新引入的模块环**（`parameterAudit → underdetermined → witnessSearch → planCompiler → parameterAudit` 与 `planCompiler ↔ witnessSearch`），前者已断、后者被有意记录并归 N3；④ 二面角求高的"歧义保障"先后两版都**是空操作**（先是对四次读数取最小值、后是只反转一个面环 —— 而内核的内角由**形心**方向算，两者都与环绕向/参数顺序无关），已删除并改成如实表述。
> **仍然没测的**：真实 provider 的开放题成功率（`deterministic_local` 不能冒充）；浏览器里"救援路径"的端到端验收（本阶段刻意不做测试后门，归 N4）；拖动保持关系（N3）；形式证明（N5）。**棱柱族**目前恒为"未核验"（原话解析把 `A′` 压成 `A`），这是设计出口允许的诚实结果，不是缺陷。

**2026-10-05 N1（统一数学状态 IR 与自由度诊断）—— 控制器在 `f997b3f` 上复跑：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | **292 文件 / 3362 通过 + 1 todo / 0 失败**（439 s） |
| `npm.cmd run typecheck` | exit 0（全部工作区 + `e2e/` + `scripts/`） |
| `npm.cmd run lint` | exit 0，**0 error / 13 warning**（与基线逐条相同） |

> **N1 是基础设施，不是新能力。** 统一 IR、`reportFreeDegrees` 与五个 feature flag 已就位，但 `obligationIR` 开关**缺省为关**；关闭时报告形状与 `b1ee3d3` 逐字相同（有断言钉住）。题设覆盖面、确认门禁与用户可见文案**本批未变**，所以"错图静默通过"那一类的**可判定范围没有扩大** —— 它要等 N2 的求解与候选生成。真实 provider 准确率、拖动保持关系、形式证明仍全部未测。
> **本批复核抓出并修掉三个真缺陷（各带回归）**：① `no_witness` 曾被映射成证据状态 `failed`（"我知道它不是"），已改为 `unknown`，冲突结论留给 N2 的 solver 报 `inconsistent`；② 受约束点的自由度按"有没有绑定"判而不是按绑定种类判（线上点报 3），已按 `free=2 / onPath=1 / derived=0` 修正，2D 与 3D 两组用例经变异证明互不掩盖；③ 生产 Worker 策略不转发开关，使开关在真实应用里**永不生效** —— 已补转发，并让**真实策略**（而非手写替身）驱动跨线程用例。另：控制器自己的验证脚本曾被 `eslint` 扫到并制造 2 个 error，已移出仓库树，lint 复跑回到基线。

**2026-10-04 本轮升级后实测（代码提交 `b1ee3d3`；文档同步提交 `666d651`，均已推送 `origin/main`）：**

| 命令 | 当次结果 |
| --- | --- |
| `npm.cmd test -- --maxWorkers=2 --reporter=dot` | 287 文件 / 3319 通过 + 1 todo / 0 失败；先前 `--maxWorkers=3` 的一次全库运行遇到无关的 CAD 导出用例 5 秒超时，该文件单跑 9/9 通过，随后以 2 worker 完整重跑通过，不把超时那次算绿 |
| `npm.cmd run typecheck` | exit 0（全部工作区、e2e、scripts） |
| `npm.cmd run lint` | exit 0，0 error / 13 warning（既有基线警告） |
| `npm.cmd run build --workspace @draw/web` | exit 0，仍有既有的大 chunk 提示 |
| `npm.cmd run test:e2e -- --workers=3` | 186 通过 / 0 失败（含示意图可确认正例和额外未知条件拒绝反例） |
| `npm.cmd run test:perf` / `npm.cmd run eval:agent` | 9/9、3/3；后者仍仅离线确定性回归，不是真实模型准确率 |
| `npm.cmd run test:rust` | 236 通过、3 项按预设忽略、0 失败 |

> 以上“通过”只覆盖现有判据和固定示例；不保证真实 provider 能画对开放题，也不代表符号证明或拖动保持关系。

**2026-10-01 球体 Task 9 全量复跑（当次实测；下面那张表是更早一批的读数，保留作对照）**：

| 命令 | 当次实际结果 |
| --- | --- |
| `npx vitest run --maxWorkers=3` | **278 文件 / 3178 项通过 + 1 todo / 0 失败** |
| `npm run typecheck` | exit 0（6 个 workspace + `e2e/` + `scripts/`） |
| `npm run lint` | exit 0，**0 error / 13 warning**（既有基线警告，非零警告） |
| `npx playwright test --workers=3`（**全量 e2e**） | **175 通过 / 1 失败**。失败的是 `e2e/geometry3d.spec.ts:277`「pans the 3D view along the camera axes within a bounded range」，`expect(z).toBeCloseTo(startZ, 6)`：期望 1.98 / 实收 2。**经核实不是本批引入的**：在球体工作之前的 `91ac837` 上同样失败（期望 1.99 / 实收 2），而且那个期望值**逐次运行会变**（1.98 / 1.99 都出现过）—— 属**本机环境敏感的既有不稳定用例**；CI 的 `e2e` 作业在 Linux 上 #52 / #54 / #55 均绿。**这条已如实记为"门禁不稳"，没有被当成通过。**
   **2026-10-02 更新（该条已修，但全量 e2e 仍有 1 条红，且换了另一条）**：`geometry3d.spec.ts:277` 那条已**根因定位并修掉** —— 根因是**测试读了自动取景动画中途的读数**（`animateToFit` 约 250ms，rAF 里插值整份相机状态；`data-camera-target` 每帧都在变）。它有**两个面孔**：读得早 → 第 299 行（精度 1，实测 `Expected -5 / Received -4.8`）红；读得不等于停稳 → 第 309 行（精度 6，`Expected 1.98 / Received 2`）红。顺带**排除**了两个旧怀疑：`clampCameraTarget` 是箱式夹取（±3×半径）够不到那 0.02；而"水平平移不动 z"**确实成立**（`cameraBasis` 的 `right` 第三分量恒为 0）。修法：取基准前**等相机停稳**（连续两次读数一致，不写死 sleep），与既有 `settledWidth` / `settleCamera` 同一口径。**修后 `--repeat-each=5` 5/5 通过**。
   **但全量 e2e 仍不是全绿**：修后读数为 **178 通过 / 1 失败**，红的是**另一条** —— `e2e/geometry3d-section.spec.ts:42` 第 59 行 `data-preview-hovering` 期望 `"true"` 实收 `"false"`（指针没落在虚线预览上），**单独跑 3/3 全过**，属**并行负载下才出现的抖动**，机制与刚修的那条**不同**（那是"读动画中途"，这是"负载下命中判定偏移"）。**本条尚未定位，本批未修** —— 所以"本机全量 e2e 已全绿"**不成立**。
   **2026-10-02 再更新（追查结论：证伪一条假设 + 查出一条代码级脆弱点，但**没有修**）**：① **按需复现失败** —— 单独跑 3/3 全过、全量 `--workers=6` **179/179 全过**，只在第 21 轮那次 `--workers=3` 里见过一次；**不复现就不猜着改**。② **我最初的假设被代码证伪**：原以为是"投影时取景动画还在跑"，但 `threeSceneCamera.ts:87-97` 显示取景只在**文档 id 变化**时触发（不是每次编辑），且调的是**立即**的 `fitToContent()` 而非 `animateToFit()` —— 加立方体根本不触发取景动画，真正那次取景在更早的"跳转到立体几何"，到 `grabPoint` 时早已结束。③ **新查出一条代码级可证的脆弱点**：`data-preview-hovering` **只在** `threeScenePreviewHover.ts:106` 的 `updatePreviewHover` 里写入，而它**只由 pointermove 事件驱动**（没有任何 effect 在其它状态变化时重算）—— 所以**一次性的合成指针移动天然竞态**：那一瞬间命中几何没准备好，属性就永远停在 `"false"`，而 `expect` 的 5 秒轮询**救不回来**（事件不会再发）。这与观察到的现象吻合，但**未复现，不算已证实的根因**。④ **没有顺手改**：两条可选修法（测试侧反复重发移动 / 产品侧在预览变化时重算悬停）都无法用一次前后对比证明修好了那次失败 —— **不拿未经验证的改动冒充修复**。
   **2026-10-02 第三次更新 —— 按其中的"产品侧重算"那条修掉了**：③ 里查出的脆弱点现在有了修法 —— **内容同步之后按最后一次指针位置重算一次悬停**（`threeScenePreviewHover` 新增 `refreshPreviewHover()`，由 `threeSceneEffect` 的 `syncContent` 包装调用；`pointerleave` 会清掉记住的位置，所以不会凭空造悬停）。**因为原来那次竞态不能按需复现，判据做成了确定性的**：指针**一动都不动**、只让内容变（选中一只立方体删除 ⇒ 预览消失），`data-preview-hovering` 必须从 `true` 变成 `false`。**变异检查**：把 `refreshPreviewHover()` 那一行拿掉 → 期望 `false` 实收 `true`（**陈旧读数**，正是那条脆弱点的症状）✓。回归：预览 / 创建 / 截面三个 spec **23/23**；全库单测 280 文件 / 3203 通过 + 1 todo / 0 失败。详见 `CHANGELOG.md` 同日「悬停读数不再只跟着指针」一节。 |
| `npm run test:rust` | **16 个测试二进制 / 236 通过 / 0 失败 / 3 ignored**，exit 0 |
| `npm run test:perf` | **9 / 9 通过**。关键读数：`roundTrip/large-mgeo` 24.8 ms、`dag/local-recompute-400` 0.9 ms（全量 0.5 ms）、`denseIntersections/200x200` 1.4 ms、`drag/300-frames` **682.5 ms（≈2.3 ms/帧**，60 fps 预算 16.7 ms/帧）；校准档 1× ≈6 ms vs 4× ≈16–22 ms（量具灵敏度自证） |

> **读法**：第一节的读数各自注明"当次范围"；**全量 e2e 已于 2026-10-02 复跑并全绿**（见下条），其余几条是各自当次的精确读数。
**2026-10-02 第四次更新 —— 全量 e2e 已复跑：`npx playwright test`（默认 workers）→ 184 通过 / 0 失败。** 那条 `geometry3d-section` 抖动在本轮修掉之后（见上面第三次更新：悬停按最后的指针位置自愈）不再出现。**这是本会话唯一一次全量 e2e 复跑**，读数按当次实跑记录 —— 至此第一节里"全量 e2e 未复跑"这条缺口关闭。

| 命令 | 本轮实际结果与范围 |
| --- | --- |
| `npm test -- --maxWorkers=3` | **266 个测试文件 / 3072 个用例通过 + 1 todo / 0 失败**（全库；比上一批多 6 项 = 创建状态机补的边界用例） |
| `npm run typecheck` | 6 个 workspace，以及 `e2e/` 与 `scripts/` 类型检查，全部 exit 0（本轮复跑） |
| `npm run lint` | exit 0，**0 error / 13 warning**（已有基线警告，并非全部无警告；本轮复跑） |
| `npm.cmd run build`（2026-10-01） | **exit 0**：根脚本遍历全部工作区；桌面 `tauri build --no-bundle` 完成 release exe（不是 MSI/NSIS 打包），Web 前置构建和工作区构建均通过，4 个 packages 的 `tsc -p tsconfig.json` 全通过。Web 入口 1701.84 kB，仍有 >500 kB 分块及混用动态/静态 import 警告；Rust 有 linker 消息警告。首次沙箱内尝试因 `Cargo.toml` 写入拒绝而失败，获准在沙箱外复跑成功。**不代表**全量 e2e、Rust 测试、性能测试或安装包实机验证通过。 |
| `npm --workspace @draw/web run build` | exit 0；入口 1694.22 kB、`engineeringExporters` 433.81 kB、`geometry.worker` 310.99 kB；仍有 >500 kB chunk 警告 |
| `npm.cmd test -- --maxWorkers=3`（2026-10-01，球体 Task 1 已核） | **269 文件 / 3110 项通过 + 1 todo，exit 0**。schema/codec 的球体目标用例先因未知 `sphere` 红，能力表/CSV 目标用例也红后转绿；提交 `ca03ed5` 的 CI checks 成功。 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01，球体 Task 1 已核） | **171 / 171 通过**，提交 `ca03ed5` 的 CI e2e 成功；尚无球体 UI 用例，只能证明旧浏览器功能未回退，**不能冒充球体已可创建**。 |
| `npm.cmd test -- --maxWorkers=3`（2026-10-01，相机同步） | **269 文件 / 3105 项通过 + 1 todo，exit 0**；无网格代刷新时标签与当前相机曾偏差约 386px，绘制入口在投影前显式同步矩阵后点名/测量两层均绿；提交 `a4e2f40` 的 CI checks 成功。 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01，相机同步） | **171 / 171 通过，exit 0**；教学标签用例去掉“松手后再抖鼠标”的补帧，单独连续 5 次通过；提交 `a4e2f40` 的 CI e2e 成功。 |
| `npm.cmd test -- --maxWorkers=3`（2026-10-01，实体体积标注） | **268 文件 / 3104 项通过 + 1 todo、exit 0**；用真实斜棱柱证明画布定位红→绿，缺顶点时不猜位置；GitHub CI run `36898807030` 的 checks 成功。 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01，实体体积标注） | **171 / 171 通过、exit 0**；真实浏览器验证 `data-measurement-labels=1`、48.000u³ 数字可见且保存重开仍在；本地实景截图核对实体中心清晰可读，GitHub CI run `36898807030` 的 e2e 成功。 |
| `npm.cmd test -- --maxWorkers=3`（2026-10-01，Task 6） | **268 / 268 文件、3103 项通过 + 1 todo / 0 失败，exit 0**；原始两条改单顶点目标用例曾红，面名唯一性、重合点拒绝、非凸布尔交集与合法外凸交集各有回归；提交 `cc9f533` 的 GitHub CI checks 成功。 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01，Task 6） | **171 / 171 通过，exit 0**：棱柱/模板实体的属性栏改单点、一步撤销/重做、保存重开、改后体积量测与截面；提交 `cc9f533` 的 GitHub CI e2e 成功。 |
| `npm.cmd run test:e2e -- --workers=3`（2026-10-01） | **169 / 169 通过，exit 0**（全量；Windows 本地）。修正 3 份旧 e2e 的测试几何输入：默认立方体已是 4×4×4，旧用例仍按 4×4×2 取剖切面/内切球；拖动截面的原落点在屏幕上与棱重合，棱按设计优先。修正前本地 165/169；**GitHub CI run `36890961011`（提交 `465788a`）四个作业全部成功**。 |
| 7 个相关 3D Playwright spec | **50 / 50 通过**（本批复跑；含创建、实体面板、原立体交互、旋转环、求交预览、棱柱旧文件、教学虚线；比 `a53b034` 记录的 44 项多 6 项 = 此后各批新增的用例）；**第二组 7 spec / 36 项也通过**（创建、棱柱、六类样题、拖动、相机记忆、求交预览、教学线型）；全量 2026-10-01 的新读数见上行（这里仍保留当时两组局部回归的历史读数） |
| `e2e/high-school-geometry-tasks.spec.ts`（Task 8 三批合计） | **7 / 7 通过**（本轮复跑）：三棱锥、四棱锥、斜三棱柱、异长长方体、圆锥截面、空间直线与平面的关系、已有文档恢复与撤销 —— **六类代表题全部覆盖**；断言顶点坐标、三边尺寸、拉伸向量、解析圆锥曲线离心率、平面方程判定的线面关系、旧文档迁移后的拓扑几何、刷新后逐 id 恢复、拓扑依赖、保存往返与一步撤销（三批各做过变异检查）；另含两条回归：**恢复后第一次改动必须写回草稿**（修复前红 Expected 112 / Received 84、修复后绿）与**点到平面距离与选择顺序无关**（两种顺序都量出 3.000u） |
| `apps/web/src/spatialPick.test.ts`（Task 3 补充用例） | **11 / 11 通过**：新增相机斜视（斜射线落点精确）、面背侧（命中优先于工作平面、不猜深度）、距离容差（`1e-8` 阈值两侧都钉住）、重叠点（身份来自命中而非坐标反查）；三次定向变异各自抓红对应用例 |
| `e2e/solid-prism.spec.ts`（Task 6） | **8 / 8 通过**：旧 6 项含棱柱体积 48 与保存/恢复；新增棱柱/模板改单顶点两项，覆盖 `.mgeo` 往返、棱柱一步撤销/重做、改后体积有效与截面成环。此行是 Task 6 当次读数；实体体积**画布数字**后续由 `374daa0` 独立修复并验收。 |
| `apps/web/src/persistence/mgeoRoundTrip.test.ts`（Task 4 补充） | **5 / 5 通过**：新增"画布新建的点 / 线段 / 直线 / 面"往返 —— id 集合与几何不变、三种引用写法（线段 `pointIds`、直线 `definition.pointIds`、面 `pointIds`）都仍指着存在的点，且重开后再引用旧点会**复用**（变异检查证过） |
| `e2e/geometry3d-teaching-lines.spec.ts`（Task 7 补充） | **2 / 2 通过**：新增「旋转视角后顶点标签仍逐点对齐」—— 对每个 `[data-point-id]` 断言其锚点等于**它自己那个顶点**的投影（±2px），旋转前后各查一遍，并用 `data-camera-azimuth` 确认真转了；变异检查（偏移 +10→+60）当场报 50px |
| `e2e/geometry3d-creation.spec.ts`（Task 5 / Task 3） | **10 / 10 通过**：创建悬停读数（工作平面 + 世界坐标 / 已有点 + **该点自己的**坐标，且**对象行数全程不变**）、切换工作区取消未提交状态（锚点归零、无半成品）、**创建优先于预览点击**（点交面预览只落地一个空间点，不多出交面图元、预览不被消耗）、**从「选择工具」退出**（工具与锚点归零、未提交锚点不落盘、退出后点空白回到选择语义不创建）、**锁定对象不被吸附**（同一坐标：未锁定读"已有点"、锁定读"工作平面 XY"、解锁又读回"已有点"，且点仍在画布上） |
| `e2e/geometry3d.spec.ts`（Task 1 基线补充） | **24 / 24 通过**（22→24）：新增 **Shift 两点多选→创建空间直线**（原用例只到"按钮可用"，现真的点下去建出对象，并以操作提示"对象 3"钉住复用已有两点不另建）与 **Esc 分级基线**（属性栏不再编辑任何对象、而对象行数一个不少 —— Esc 不是删除）；各带一条定向变异 |
| `apps/web/src/spatialCreationSession.test.ts`（Task 2 边界） | **10 / 10 通过**（4→10）：point3 一点完成 / line3+ray3 两点完成 / **face3 无论多少点都不自动完成、只有 Enter 收尾** / 首末点重合被拒且会话不前移 / 非有限坐标被拒且不留脏数据 / 拒绝提交的原因文案；三处变异各自精确抓红，并查明 face3 有"两层独立守卫" |
| `apps/web/src/spatialTools.test.ts` + `threeScene.test.ts`（Task 1 基线） | **74 / 74 通过**（16 + 58） |
| `e2e/html-export.spec.ts`（E3 HTML 导出） | **3 / 3 通过**（先红后绿，RED = 三条都卡在"导出 HTML"按钮不存在）：平面导出 `setContent` 打开后图可见且零外链、CAD 四个 `data-drawing-view` 且整份只有一个 `<svg>`、**立体几何明确拒绝且零下载** |
| `packages/agent-core/src/tools/interactionTools.test.ts`（E3 HTML 导出） | **12 / 12 通过**：新增"Agent 导出通道**恰好四个格式**"的**类型级**判据（`proposeExport` 与 `preflight` 两处联合各一条）。**两次变异**：改 `proposeExport` → `tsc` 报 `(149,11): Type 'true' is not assignable to type 'false'`；改 `preflight` → 报在 `(155,11)`。**第一次只钉一处时改另一处拦不住**（`tsc` 全绿），补上第二条后才拦得住 |
| `apps/web/src/persistence/htmlExporter.test.ts` + `fileExports.test.ts`（E3 HTML 导出） | **9 / 9** + **9 / 9 通过**：产出器（内嵌 SVG 逐字一致、零外部引用配反向对照、SVG 内无 id、存档 `encode→decode` 不动点、`</script>` 注入防护、损失清单有则列出无则写"无"、版本戳含 `unknown`）与导出路径（**立体几何明确拒绝且零下载**、平面产出自包含 HTML、CAD 走工程产出器且诊断进损失清单）；两处各带定向变异 |
| `npm --workspace @draw/desktop run bundle`（**2026-10-02，最新一次**） | 根 `npm run build` **exit 0** → `bundle`（`tauri build`）**exit 0**（Rust release 1m16s，WiX 出 MSI、NSIS 出 setup）。产出 **v3.2.0**：exe **17,209,344 B** / MSI **6,860,800 B** / NSIS **5,040,418 B**（哈希见 [`release/v3.2.0.md`](release/v3.2.0.md)）；**打包前核对了外壳前端来源**（`build-check/mathcanvas-current` 的那份 `index-*.js` 距打包 2.3 分钟且含「导出 HTML」等字符串）；免安装 exe 启动实测（句柄 `2886386`、存活 T+20s）。**tag `v3.2.0` + GitHub Release 已发布并独立复核**（匿名 API `releases/latest` = `v3.2.0`；三件资产重下载后 SHA-256 全部 MATCH）。与 **2026-10-01 根脚本 `npm.cmd run build` 的 v3.0.1 `--no-bundle` 构建是两次不同的验证**，不要混成同一件事。 |
| `npm.cmd run test:perf -- --reporter=verbose`（2026-10-01） | **9 / 9 通过，exit 0**；PERF 实际毫秒读数见下方新表，趋势/量级护栏不等于跨机器性能目标。 |
| `npm.cmd run test:rust`（2026-10-01） | **236 通过 / 0 失败 / 3 ignored，exit 0**（16 组测试/文档测试结果）；初次在沙箱中因 Cargo debug 构建锁写入拒绝而未运行，获准在沙箱外复跑。2 条真实 DeepSeek API 测试需凭据，1 条真实 Windows 凭据管理器写入测试按默认策略忽略；不能声称这些外部依赖已验证。 |

**本机性能趋势（2026-10-01，当次 `PERF` 毫秒，不跨机器作硬比较）**：`addPrimitives/1000-planar` **15.2**、`recomputeDerivedObjects/100-solid` **59.5**、`solidStatusReport/100-solid` **17.9**、`encodeMgeo/large` **12.7**、`roundTrip/large-mgeo` **40.4**、`denseIntersections/200x200` **3.3**、`drag/300-frames` **1680.5**（约 5.6 ms/帧）；`dag/full-recompute-400` **1.0** 与 `dag/local-recompute-400` **2.0**。本批所有量级护栏通过；局部重算耗时高于全量重算，是后续优化线索而非本批失败。

**性能读数（2026-09-26 历史基线；2026-10-01 的新读数见上表）**（当时本机实测，保留供历史比较；不同运行环境下不直接推断回归）：

| 场景 | 读数 | 它对应什么 |
| --- | ---: | --- |
| `addPrimitives/1000-planar` | ~6 ms | 1000 图元文档里的一笔编辑（每拖一下都要付） |
| `recomputeDerivedObjects/100-solid` | ~24 ms | 打开一份 100 实体（约 2800 图元）的文档 |
| `solidStatusReport/100-solid` | ~5 ms | 属性面板每次选中都跑（历史 G1 退化的现场） |
| `encodeMgeo/large` | ~4 ms | 保存 / Agent 提交算内容指纹 |
| `roundTrip/large-mgeo` | ~15–20 ms | 打开文件的另一半：解码 + 全量重算 |
| `denseIntersections/200x200` | ~1.5 ms | 密集两两相交（线性扩展：16 倍密度 → 6.2 ms） |
| `drag/300-frames` | ~750 ms（≈2.5 ms/帧） | 连续拖动 300 帧；60 fps 预算 16.7 ms/帧，**余量充足** |
| `dag/*` + 校准 | 见 `PERF` 行 | 局部/全量等价性判据 + "计时本身没坏"的校准 |

**主线程帧间隔（2026-10-01）**：`e2e/main-thread-responsiveness.spec.ts` **单独运行 1/1**，载入 max **316.7 ms**、拖动 24 步 max **150.0 ms**（p95 **16.8 ms**）、故意阻塞标定 **199.9 ms**；同日**全量 e2e 并行运行时该条也通过**，载入 max **333.4 ms**、拖动 max **83.2 ms**（p95 **16.8 ms**）、标定 **200.0 ms**。两次拖动最大空档均低于该测试的 250 ms 量级护栏；冷启动/并行抢 CPU 的载入数字不作硬门槛。

**主线程响应性读数（2026-09-26 历史基线；2026-10-01 新读数见上行）**（保留当时两种运行环境的读数，不当作现值）：

| 阶段 | 单独跑 | 整套并行跑 | 它对应什么 |
| --- | ---: | ---: | --- |
| 载入（冷启动 + 首帧） | max 99.9 ms | max 266.6 ms | 整个 bundle 的解析执行 + 首次渲染；并行跑时被其它 worker 抢 CPU，所以**不当门禁** |
| 拖动动点 24 步 | max 16.8 ms（p95 16.8） | max 116.7 ms（p95 33.5） | "每帧都要重算"的那类交互 —— 60 fps 预算是 16.7 ms |
| 故意阻塞 200 ms（量具标定） | max 183.3 ms | max 200.0 ms | **证明量具是准的**：连这都测不出来就说明是仪器坏了 |

> **这一条读数怕机器负载**：把整套 node 单测（2700 多条）与这套 e2e **并行**跑时，拖动那一档读到过 **366.7 ms**（单跑 16.8 ms，差 22 倍，阈值 250 ms）—— 所以"两套一起跑"的结果不算一次有效的 e2e 验收；CI 里它们本来就是两个作业。

**门禁已经自动化**：`.github/workflows/ci.yml`（`checks` = typecheck + lint + Vitest、`build`、`e2e`、`rust`）。

**e2e 现在也过类型检查**（本轮补上，此前**一处都没有**）：`e2e/` 不在任何 workspace 里，`apps/web/tsconfig.json` 只 include `src`，所以 42 个 spec 一直只被 Playwright **转译**、从不被 `tsc` 检查 —— 补上之后当场查出 **23 个类型错误**（既包括 `null` 没判、`Element` 当成 `SVGCircleElement` 用这类真问题，也包括找不到 node 内建类型）。现在 `npm run typecheck` 末尾会跑 `tsc -p e2e/tsconfig.json`。
选择**不装** `@types/node` 而只写一份最小声明（`e2e/nodeTypes.d.ts`）：它一旦进 `node_modules/@types`，所有没写 `types` 的 tsconfig 都会自动全局引入，`setTimeout` 的返回类型会从 `number` 变成 `NodeJS.Timeout`，动摇应用侧现在好端端的代码 —— 为给测试补类型而付这个代价不划算。
读数会随提交变化，**以 CI 最近一次运行为准**；上表是本地实测值。

## 本轮高中几何交互（功能分支，**2026-09-30 已合并进 `main`**；依次随 **v3.1.0** 与 **v3.2.0** 打包发布）

- **P0 已在功能分支完成**：直接在 3D 画布按步骤作空间点/线段/直线/射线/平面/面；XY/XZ/YZ/选中面工作平面落点、只预览不落盘、Esc 取消/Enter 完成、一笔事务一步撤销；保留原 Shift 多选和 Alt 选子对象路径。
- **P1 已完成**：常用立体参数面板可创建正方体、长方体、三/四棱柱（含斜棱柱）、三/四棱锥；改变参数显示未保存 3D 预览、确认后提交；原快速「添加立方体」新建尺寸更正为 4×4×4。教学线型模块支持独立空间线/棱的实线、虚线和点线，并保留到 `.mgeo`；「隐藏边」是另一套只影响视图的开关。**旧文件尺寸不迁移**。
- **仍未完成（2026-10-02 复核后的实情）**：① **教师/学生走查**（用户侧）；② ~~**MSI 的"装 → 启动 → 卸载"验收**~~ **✅ 2026-10-10 用户报告通过**（管理员权限；NSIS 那半此前已在本机走完一圈）；③ 画布拖动手柄 / 关联拉伸仍是独立后续范围（属性栏**单顶点数值编辑**已交付，提交 `cc9f533` 且 CI 全绿）。**曾经列在这一条里的两项已经交付**：球体与球截面随 **v3.1.0**、HTML 导出随 **v3.2.0**；题目截图识图、GeoGebra `.ggb`、平面/函数逐题补缺**仍未启动**（见 §四 E 类）。
- **Task 8 三批已落地并上传**（提交 `cecc1fe`、`0166845`、`1a82c97`）：`e2e/high-school-geometry-tasks.spec.ts` 六类代表题转成可重放操作序列，2026-09-29 的样题 e2e **7/7**；当次 `typecheck` exit 0、`lint` 0 error / 13 warning、全库单测 266 文件 / 3072 项通过 + 1 todo。**2026-10-01 单独补跑根脚本 `npm.cmd run build`，exit 0**（Web、桌面 release exe 和 4 个 packages）。计划 Task 8 第 2 项所列命令已有分次实测，仍不能视为整期验收完成：本地全量 e2e 于 2026-10-01 达到 169/169，教师/学生走查仍未做。
- **Task 8 第 4 项已收口**（提交 `f48d579`）：[功能目录](feature-catalog.md) 新增「本期收口（2026-09-29）：实际已完成 / 未完成」一节 —— 分别列出**已交付**（画布直接绘制 / 常用立体 / 教学线型 / 解析截面读数 / 六类样题可重放验收 / 两处缺陷修复）与**未交付且需要你决定是否启动**（球体与球截面、截图识图、HTML 与 GGB 导出、平面函数逐题补缺、教师走查与完整桌面打包），并写明「都在功能分支、未打包」（**2026-09-30 更正：该分支已通过 PR #1 合并进 `main`，见文末「本轮结束时的交接」**）。
## 二、按评审方案：做到哪一步了

**一句话进度（估计，口径写明）**：**七条方案全部落地并验收**；方案 2 的六个目标文件全部拆分完成（`operations.ts` 也走到 **2817→307**）。剩下的是**可选**项与长尾（`operations.ts` 内仍可细分、`App.tsx` 与 `threeSceneEffect.ts` 内仍可细分）。门禁面已无已知缺口（`e2e/` 与 `scripts/` 都进了 `tsc`）。

| 方案 | 优先级 | 状态 | 一句话 |
| --- | --- | --- | --- |
| 1. 统一实体构造与拓扑物化 | P0 | ✅ **已完成并验收** | 见下节 |
| 2. 拆分过大的编排和领域文件 | P1 | 🔶 **已开四十六批** | `operations.ts` 2817→**307**（→ 十一个模块）、`PropertiesBar.tsx` 1069→298（→`inspectorFields` / `inspectorLabels` / `inspectorReadings` / `inspectorModel`）、`App.tsx` 2000→**809**（→`fileExports` / `documentIds` / `creationCommands` / `solidCommands` / `recordCommands` / `structureCommands` / `anchorRotationCommands` / `point3ToolCommands` / `previewCommands` / `selectionCommands` / `canvasStatusPrompt` / `draftingCommands` / `appViewState` / `useDraftPersistence` / `commandDispatch` / `useKeyboardShortcuts`）、`threeScene.tsx` 1807→269（→`threeSceneEffect` + **七个阶段模块**）、Rust `lib.rs` 992→**168**（→`src/commands/` 五组）、`agent-core/schemas.ts` 1300→**180**（→`schemaReaders` / `actionRegistry` / `hashing` / `actionInputs` / `actionAudit`） |
| 3. 接入几何 Worker | P1 | ✅ **已完成并验收** | 宿主生命周期 + 如实降级；契约缺口全部填上 |
| 4. 工作区级代码分包 | P2 | ✅ **已完成** | 分包那一次：入口单 chunk 2 066.63 → 1 629.80 kB（−21.1%）。**当前入口是 1 801.18 kB**（2026-10-05 实测，之后的正常增长），见 §三 的"主 bundle 仍超 500 kB"一条 |
| 5. 正式 CI 门禁 | P2 | ✅ **已完成** | 四个作业按成本分层 |
| 6. 文档与过期注释收口 | P2 | ✅ **已完成**（当前 / 归档 / 变更记录三份分工） | 点名注释已修；`docs/current-status.md` 是"现在时"的唯一一处，变更记录见 `CHANGELOG.md` |
| 7. 大型场景性能基准 | 持续 | ✅ **已完成（八条场景 + 主线程响应性）** | 覆盖评审点名的场景，含密集相交、连续拖动 300 帧与浏览器里的帧间隔读数 |

### 方案 1（P0）：已完成，且逐条验收过

- **根因**：模板实体在文档里是**两件东西**（用户编辑的参数化图元 + 由它物化出来的一族拓扑）。手工按钮一次落盘两件，`solid.create_template` 只落盘第一件；没有 `polyhedron3` 拓扑时渲染落到"直接画模板"的分支，而那条分支**不读 `rotation`**。
- **修法**：动作层加唯一入口 `compileTemplateSolid`（刻意不传自定义 `BuilderContext`，与 `syncTemplateTopology` 的默认命名逐字一致），手工按钮改调同一入口，`DEFAULT_SOLID_SEGMENTS` 下沉到内核。
- **逐条验收**：①手工与 Agent 同参数创建四类模板 → **逐字节相同的文档**（4 条参数化用例）；②改朝向之后物化顶点**真的跟着转**（逐顶点比对解析值）；③确认面板的对象计数**如实**（一个立方体 28 个对象，全部计 `user`）；④长时记忆记的是**实体**而不是它的拓扑子对象。

### 方案 3（P1）：已完成（客户端 + 宿主生命周期 + 如实降级）

**已交付**：`apps/web/src/agent/geometryWorkerClient.ts` —— 宿主侧客户端，正是评审说"缺的那一块"。
它负责建 Worker、按 `requestId` 配对响应、核对外层信封、超时、丢弃过期响应、卸载。四条纪律各有具体的坏结果，也都各有用例：
①按 `requestId` 配对（不配 → 预览串版，最难复现的一类）；②核对 `runId` / `draftId` / `draftVersion`（旧版草稿的结果**不许**覆盖新预览）；③超时（否则界面永久卡在"处理中"）；④Worker 崩了要**如实失败**，不静默降级。
Worker 是**注入**的，所以这些规则在 jsdom 里能直接测（**10 条用例**）；生产侧由 `spawnGeometryWorker()` 用评审原文那个写法建真 Worker。

**宿主生命周期与降级在 `apps/web/src/agent/geometryWorkerHost.ts`**（**7 条用例**）：每个页面一份（同页面调两次必须是**同一只**）、丢弃单例时终止、`pagehide` 时终止（不终止就是泄漏线程）、能建 Worker 时**真的**走 Worker、建不起来时降级到**同一个** `compileInProcess` 且**用户原话照样传下去**、以及"降级要说出原因（每页一次）"。第 5 条是**回归用例**：它用同一份计划配两句原话（"画一个任意棱柱" vs "画一个棱柱"）断言结局**必须不同** —— 差别只可能来自"原话有没有传下去"，而兜底路上的那份副本正是漏传了它。这条用例**反向验证过**：把 `userMessage` 人为丢掉，它当场失败。

**还有 `apps/web/src/agent/geometryCompileStrategy.ts`**：把"同步编"与"交给 Worker 编"并排放在一处，并用**同一组代表题**证明**两条路的产物逐字节相同**（**5 条用例**，含"基准文档已有 `point-1` 时两条路都得从 `point-2` 接着发号"与"编不过时两条路都如实失败"）。为什么值得单独一个文件：两条路会**长期并存**（Worker 只在值得的场景启用），一旦它们对同一份计划给出不同结果，就会变成"某个形状只能在这一条路上编出来"—— 而这个项目已经几次因为"同一个判断写了两遍"吃过亏。用例里的假 Worker **真的**把消息交给 `handleGeometryRequest`，所以覆盖的是真链路，只把"线程"换成了函数调用。

**接线前的三处前置**（都是"接线之后会静默变差"的地方，所以先填）：

1. **契约缺口三个都填了**：`WorkerSuccess.completionAssumptions`（否则搬进 Worker 之后确认面板上"系统替你定了什么"会**静默变空**，用户会确认一件他没看过的事）；`WorkerFailure.repair` / `planDiagnostics` / `assumptions`（否则"编不过的计划"比现在**更难修** —— 协调器的一次性修复完全依赖它们）；`WorkerFailure.questions`（否则"本该问用户"的计划被报成笼统的 `compile_failed`，用户看到的是"编译失败"而不是"请你确认底面在哪"）。三处都在 `workerRuntime` 与 `parseWorkerResponse` 两侧钉了用例。
2. **`stage` 已异步化，编译策略可替换**：`DraftStore.stage` 返回 `Promise`，并新增 `CompileStrategy` 注入参数（默认就是原来那条"在当前线程上跑 `compilePlan`"，行为逐字不变）。`DraftStorePort.stage` / `preflight` → `Promise`，`DraftTools.stageActions` / `validate` → `Promise`，`CommitterAdapter` 与 `agentRuntime` 两处 `await`。有一条用例专门钉"注入的策略真的被调用、且它的产物真的落进草稿" —— **否则"可以换一条路"就是一句空话**，而这正是这个功能此前"能测不能跑"的成因（`geometry.worker.ts` 一直存在，但没有任何调用点）。
3. **`stage` 只要 7 个字段，而契约承诺 13 个** —— 这件事在收口时被查出来，并把类型改诚实了：新增 `StagedCompileResult`（`ok` / `draftDocument` / `operations` / `diagnostics` / `questions` / `assumptions` / `repair`），`CompileStrategy` 用它作返回类型。原因是 `PlanCompileResult` 里的 `actions` / `aliases` / `plan` / `completions` / `verification` **Worker 的响应并不携带**，而 `stage` 一个都不读；若返回类型仍写完整的 `PlanCompileResult`，"从 Worker 返回"就必然要**编造**那 5 个字段。收窄之后：两条实现都只交出真正被用到的东西，而哪天 `stage` 真需要新字段会**编译不过**，而不是悄悄拿到 `undefined`。

**接线（2026-09-24 完成）**：`apps/web/src/agent/geometryWorkerHost.ts` 把客户端绑成 `DraftStore` 要的那条 `CompileStrategy`。

- **Worker 的生命周期必须比一次运行长**：`createAgentRuntime` 是**每轮运行**建一次的（`agentRunner.ts` 的 `run()` 里调它），所以 Worker **不能在那里 `new`** —— 那会变成"每轮 Agent 运行泄漏一个 Worker"。改法是**模块级的懒建单例**（每个页面一份，`pagehide` 时 `terminate`）。懒建还有一个实际好处：没有 Worker 的测试环境不该因为"只是装配了一个运行时"就付建线程的代价。
- **必须能降级，而且降级必须如实**：`spawnGeometryWorker()` 用 `new Worker(new URL(...), { type: "module" })`，这条路径在**没有 `Worker` 的环境里直接抛**（node / vitest / 某些 WebView 设置）。实测后果是整轮运行从 `awaiting_confirmation` 变成 `failed` —— 让"这台机器没有 Worker"把一次作图变成失败，比"就地算"明显更糟。所以降级为**就地编译**，并往开发者控制台留一条能读的原因（每个页面只报一次：这条失败是必然的、不是偶发，每次编译都打会把控制台刷满）。这与评审警告的"静默降级"不是一回事：那说的是"明明能走 Worker 却悄悄不走"，这里是"这台环境压根没有 Worker"，而且它**说出来**了。

**接线时抓到的两件事**（都是用例如实抓出来的，不是顺手改的）：

- **客户端不再丢弃失败产物**（`geometryWorkerClient.ts`）：契约补上了 `repair` / `planDiagnostics` / `assumptions` / `questions`，但客户端此前只留 `code` + `detail` —— 于是"契约补上了"等于白补，数据到了主线程门口又被扔掉，**表现与没补一模一样**。已修 + 用例。
- **兜底路必须落在同一个 `compileInProcess` 上**：兜底最初自己抄了一份"就地编译"，而那份副本**漏传了 `prompt`（用户原话）**。后果很实：同一份计划在"默认路"与"兜底路"上编出**不同结果** —— 原话里带"任意"的棱柱计划本该被审计拒绝，在兜底路上却变成了澄清提问（`agentRuntime.test.ts` 与 `compilerRepair.test.ts` 各有一条用例当场抓到）。现在两条路只有**一处**实现（`draftStore.compileInProcess`），`geometryCompileStrategy` 只是转出去 —— 这种分叉不可能再长出来。

**关于"有没有更窄的缝"**（查实过，没有）：`CommitterPort.stage` **本来就是 `Promise`**、协调器**本来就 `await`** 它 → 那一侧零成本；`ToolPort.call` 也已经是 `Promise`，所以**工具派发本来就支持异步工具**。但把 Worker 只挂在 `CommitterPort` 一侧**不行** —— 两个端口**刻意共用一个草稿存储**（`agentRuntime.test.ts` 有一条用例钉着"tools 与 committer 共用同一个 draft store"），分叉会让模型看到的草稿与提交的不是同一份。`preflight` 同样经 `DraftStorePort` 暴露，也不是"另一条路"。

**所以接线的工作量已经是"接一根线"**：`DraftStore.stage` 与 `DraftStorePort.stage` 都已异步、编译策略已有注入点、契约两个缺口都已填 —— 剩下的是在 `agentRuntime.ts` 里造客户端、绑定策略、并把 `dispose` 挂到运行时的清理路径上。

**已有数据（本阶段实测，`compilePlan.bench.test.ts`）** —— 这是方案 3 那个决定的输入：

| 场景 | 读数 |
| --- | ---: |
| 代表题①（斜四棱柱 + 截面，小文档） | **4.8 ms** |
| 代表题②（圆锥曲线不变量） | **2.2 ms** |
| 同一份计划，基准文档 **2000 图元** | **73 ms** |
| **过线程边界的复制成本**（`structuredClone` 同一份 2000 图元文档） | **1.0 ms** |
| **比值**（编译 ÷ 复制） | **76 倍** |

**结论（本轮据读数更正过一次）**：
1. **典型文档上编译只要个位数毫秒**，而评审点名的目标场景是"约 100 个三维实体"；P0 之后一个立方体就是 28 个图元，所以约 2800 图元才是**真实**的大文档档位 —— 也就是上表第三行那一档，**约 70 ms 的主线程卡在"确认"这一步**。
2. **成本在"算"，不在"读文档"**：拆开量过 2000 图元的 `id` 数组（0.01 ms）、`new Map`（0.05 ms）、`createIdAllocator`（0.07 ms）—— 都不是瓶颈，瓶颈是 `compilePlan` 自己的扫描/校验。这一点决定 Worker 值不值：成本若在"读文档"，Worker 也要读一遍等于白搬；成本在"算"，Worker 就能把它挪出主线程。
3. **入场费可以忽略**：复制只要 **1.0 ms**，而编译 **73 ms** —— 花 1 ms 换掉 70 ms 的主线程卡顿，收益约 **76 倍**。

**因此方案 3 值得接线**（上一轮我按"复制成本可能抵消收益"判断为"暂不接线"，**那个判断基于没量过的假设，已被上面两条读数推翻**）。**已接线**（见本节开头），接线的成本确实只是那一处契约决定，**不是重写管线**。

**教训（已更正）**：此前几轮把这条记成"接进去要把 `stage()` **及其调用方全部**改成异步 —— 那是 Agent 管线的深度改造"。**那个判断是错的**：协调器本来就是异步的。一个记错的阻塞理由会让后来人**不去做本来做得到的事**，所以这条更正本身也是"如实"的一部分。

### 实机现场故障（2026-09-26，第四十六批）：一句话连挂两次，两次根因不同

用户在**装好的桌面版**里说"把正方体沿对角面剖开，标出截面"，连着碰到两次失败。两次都不是"模型不听话"，而是**Agent 说的话编译器没接住**；症状完全两样，所以分开记。

**第一次：`compile_failed: target_not_found … no object cube`（随后级联 `no object diagSection`）。**
规划器给的三步是"建正方体 → 建截面 → 标出截面"，但后两步把前一步**刚建出来的对象**写成了场景引用 / 裸名字（`cube`、`diagSection`），而别名表只认显式的 `{scope:"draft", alias}`。判据没有歧义：别名表里只有"这一份计划里、这一步之前"建出来的对象，命中就是那个刚建的对象。修法：`planCompiler.resolveReferences` 的两条分支（裸字符串 / 场景作用域）都先按别名查，查不到才报 `target_not_found`。宽容有边界 —— **编造的 id 仍旧被拒**；**形状错误的引用仍在传输层被拒**（`sourceId` 只收裸 id 字符串，喂对象形状报 `invalid_type` 且路径落在 `envelope.actions[1].inputs.sourceId`），不会拖到引用解析时变成一句"找不到对象"。三条都钉进了 `planCompiler.test.ts`。

**第二次：`commit_rejected: action_compile … section plane is invalid`（随后级联 `no object sec1`）。**
根因是**登记表承诺 ≠ 实现**：`section.create` 的默认问题是"截面用哪个平面？给法向与常数，**或者说明它过哪三个点**"，可 `actionInputs.parseActionInputs` 里**没有 `section.create` 分支** —— `plane` 走默认分支原样透传，"过三个点"那种写法（"沿对角面剖开"最自然的写法）一路走到**文档校验器**才被拒，而且报的是**动作级**路径，那条"一次性修复"够不到字段、改不动它，用户只看到一句"编译失败"。
修法：补 `section.create` 分支 + `normalizeSectionPlane`，把**三种写法收成一种**（单位法向 + 常数）：规范形 `{normal, constant}`（法向非单位向量则归一化，**常数同步缩放** —— 只归一化法向会把平面换掉，在立方体上正好是"切歪"）、**过三点** `{points:[…3]}`（`throughPoints` 也收，叉积求法向）、**点 + 法向** `{point, normal}`（`origin` 也收），坐标 `{x,y,z}` 与 `[x,y,z]` 两种写法都收。失败时错误路径**落在字段上**（`…inputs.plane`），码是 `invalid_plane` / `degenerate_plane`（三点共线），修复请求因此够得到它。同批把 `sourceId` 的判据一并收进这个分支。
**`plane` 缺省仍旧放行**：它登记着 `ask_user`，由审计去问用户（"缺平面 → `questions` 里出现 `envelope.actions[0].inputs.plane`"这条既有用例仍在钉）。在传输层替用户挑一个平面，等于替他改题。

**这两次暴露的是同一类风险**：动作登记表（`actionRegistry`）是"我们承诺收什么"的**唯一**声明处，而逐动作校验（`actionInputs`）里少一个分支，承诺就落空 —— 而且是**静默**落空（透传出去，直到文档校验器才被拒，报的还是够不到的路径）。判据：**登记表里写了 `ask_user` 问题、或写了可选字段的每个动作，都必须在校验层有一个显式分支**；新加一条测试钉住三种平面写法的等价性 + 共线时按字段路径拒绝。



## 三、还没做的（按建议顺序）

1. **方案 2 剩下的**：`App.tsx`（**809 行**，已无"有状态的整块"，剩下的是装配与 JSX）与 `threeSceneEffect.ts`（**489 行**；组件 `threeScene.tsx` **269 行**；已按阶段切出**七块**：`threeSceneCamera.ts`（相机取景）、`threeScenePreviewHover.ts`（预览悬停）、`threeSceneRender.ts`（一帧的绘制 + 两层标签覆盖层 + 曲线容差档位与手柄缩放）、`threeSceneGrid.ts`（网格与坐标轴落位）、`threeSceneContent.ts`（**内容同步**：`keepContent` 增量重建 + 整场 `syncContent` + `refreshPrimitiveObject`，604 行）、`threeSceneInteraction.ts`（指针按下 / 移动 / 抬起、拖拽会话、拾取判定 481 行）、`threeSceneDragVisuals.ts`（**拖动期间的画面**：半径预览 / 手柄落位 / 场景重建后补画），手法是"依赖对象 + 原文搬"；跨阶段的 `let` 一律改成稳定容器（`copy` / `clear` / 就地 push）），评审 md 点名的六个文件**全部拆完**（`agent-core/src/schemas.ts` 也已 1300→**180**）—— **Rust 侧已完成**：`lib.rs` 992→**168 行**（只剩模块声明、两个托管状态、`run()` 与命令清单），其余全部搬进 `src/commands/` 六组：proxy / secrets / conversations / repository（项目仓储 + 附件 + 运行账本，因碰同一份托管状态合成一个文件）/ providers。
   已拆出的部分：`PropertiesBar`（1069→298）的字段控件 / 名字与归属 / 派生读数 / **检查器模型**（`inspectorModel.ts`：只依赖三项，因此能脱离面板单独测）；`App.tsx`（2000→**809**）的导出、id 分配、九条创建命令（`creationCommands.ts`）、七条截面与宿主绑定命令（`solidCommands.ts`）、五条记录命令（`recordCommands.ts`）、三条结构命令（`structureCommands.ts`）、两条定点旋转命令（`anchorRotationCommands.ts`）、六条三维工具命令（`point3ToolCommands.ts`）、两条预览创建命令（`previewCommands.ts`）、七条选择与批量操作命令（`selectionCommands.ts`）、一条状态栏推导（`canvasStatusPrompt.ts`）、四条 2D 创建流程（`draftingCommands.ts`）、**派生视图状态**（`appViewState.ts`：选中了谁 / 能不能建某类对象 / 活动图层能不能画 / 标注与定点旋转的入参够不够，23 个字段的纯计算）、**启动恢复与自动保存**（`useDraftPersistence.ts`：两个 effect + 它们之间的时序守卫 + "换一世"的 `reset` 入口）、**命令分发**（`commandDispatch.ts`：CAD 那一张 switch 表 + 功能区那一张 + 换 CAD 模式，95 行原文搬）、**键盘快捷键**（`useKeyboardShortcuts.ts`：Esc 分级 / Delete / 撤销重做；搬动时顺手修掉两处依赖问题）。`agent-core/src/schemas.ts` 与 Rust `lib.rs` 按评审排在更后。
   - **`App.tsx` 里已经没有"有状态的整块"了**：命令分发、恢复与自动保存、键盘处理、派生状态全部搬完，剩下的 800 余行绝大多数是界面装配（各面板的 props 与 JSX）。要按"先定接口再搬"做。
      派生状态搬成**纯函数**之后第一次能直接问（过去只有渲染整棵 App 才能验）：新增 8 条用例钉住"空选中不算全锁定 / 全可见"、截面只认模板实体、交点只认 `@draw/dsl` 那张可采样表（圆 + 圆可以、圆 + 立方体不行）、空间工具"只认空间点"这条前提（混进一个平面点就全关）、线性与角标注各自独立计数（1 点 + 1 棱 → 线性可用、角不可用）、定点旋转要"一个点 + 一条未锁定的封闭曲线"、以及活动图层被隐藏 / 锁定时那句提示。
      启动恢复那一段更值：它那两条守卫本来是"只能靠整页 e2e 间接证明"的（一条是探针抓出来的、一条是 e2e 抓出来的），搬成 hook 时给它留了一道能控制 `restore()` 何时返回的缝，于是新增 9 条用例直接钉住 —— 恢复在途时**一个字都不写**（否则初始空文档会覆盖上一轮的草稿）、恢复自己带来的那次变化只跳过一次而用户下一次改动照常写、用户在恢复返回前动过手就**不覆盖**、切走工作区就不覆盖、网页版退回 localStorage 草稿、仓储本该可用却失败要**如实说且照样放行自动保存**、`not_a_desktop_shell` 不弹提示、保存失败**只报一次**，以及"换一世"那个 `reset` 入口。
      命令分发搬出来同样直接兑现：两张 switch 表过去与二十来个闭包 handler 挤在组件体里、只有点界面才能验，现在新增 12 条用例喂替身 handler 问"这一步该谁做、谁必须没被调到" —— 图层挡住时**只提示不创建**、非创建类命令在图层被挡时照常工作且清掉上一条提示、`select-all` / `modify-hide|show` / `inspect-sources`（投影来源去重）分别送到谁手里、`inspect-diagnostics` 拿到的必须是**更新函数**（连点两次要真的来回切）、导出按格式分派、未知 id 只做"进入命令"那一组动作，以及 CAD 工作区里功能区命令**整条转给 CAD 表**（连"只在功能区表里的 `create-cube` 在 CAD 工作区什么都不会发生"这条看着像 bug、其实是当前口径的行为也钉住了）。
      键盘处理最后一块搬完，顺带修掉两处**搬之前就存在**的依赖问题：依赖数组里有 `document` 与 `apply` 而函数体一个都没读（后果不是"多订阅一次"——`document` 每次编辑都换身份，等于**每提交一笔操作就把监听摘下来再挂回去**），以及 `deleteSelected` 漏写（基线那条 lint 警告就是它，补上后基线 14 → 13）。新增 9 条用例直接往 `window` 发按键：撤销/重做按平台修饰键、输入框里按 Ctrl+Z **不许**撤销整篇文档、`Alt+Ctrl+Z`（输入法组合）不算快捷键、Esc **分级**（先取消创建、再关指引、最后才清选择，且前者不得顺手清选择）、Delete/Backspace 删选中并 `preventDefault`、输入框里按 Delete **不删对象**、空选中不删、卸载后监听真的摘掉。
   - `threeScene.tsx` 现在**只剩装配**（269 行）：那个 **1445 行的挂载期效应整块**搬进 `threeSceneEffect.ts`（逐行原样；接口 = 组件作用域里被读到的那些 ref），随后按阶段切出**七块**。切法是先把 `sceneBounds` / `previewGroups` / `objectIndex` / `viewportHeight` 这批**共享可变局部量**收进一个 runtime 对象，再按阶段搬；每切一块跑一遍 `geometry3d-*` 那组 e2e。效应本体 **1445 → 489 行**，剩下的是**装配与编排**：建场景 / 相机 / 渲染器、七个阶段工厂的调用顺序、监听注册与注销、尺寸变化、键盘处理。
      `threeSceneContent` 搬出来之后第一次能**单独测**（它过去整块住在效应里，只能从整页外面看）：新增 6 条用例，钉住"重建粒度"这一类不变式 —— 同一份内容第二次同步要**沿用**（对象实例都不换）、只改一个图元时**只有那一个**重建（栅格与坐标轴不许跟着重建）、图元被删时收掉记录并如实计数（`sceneContent` 从 4 回到 3，那 3 条是栅格 / 主栅格 / 坐标轴）、`refreshPrimitiveObject` 画在 `points` 表里的坐标上、以及"就地重建之后紧接一次整场同步不会画出第二个对象"。
       `threeSceneDragVisuals` 是"拖动期间的画面"（拖动时文档不提交，画面全靠它）：半径预览按宿主参数**同半径**重算动点坐标，所以点始终贴在新的圆周上；三色环按构建时的轨道半径算同一个比例，**避免逐帧累积**；场景因选中 / 尺寸变化被重建后按**累计量**补画一次（旋转按累计角度、缩放按预览半径、平移按累计位移）。搬动里唯一的改写是那一处**必要的**：原来直接写 `resumeDragVisualRef.current = () => {...}`，现在工厂交出 `resumeDragVisual`、由调用方赋值 —— 语义不变，但从此这一段能在别处被单独调。
   - 这一块为什么不能"顺手再搬一段"：效应内部那批局部量是**跨阶段共享**的（`sceneBounds` 由内容同步写、被取景与指针读），先拆阶段就得在那一千多行里逐处改写引用 —— 其中还埋着 `const document = documentRef.current` 这种与 DOM 全局同名的局部，盲改会静默改错。**顺序也是坑**：搬完之后初始 `syncContent()` 必须排在取景 / 绘制工厂调用**之后**（放在前面会 TDZ 崩溃，而 typecheck、lint、2700 多条单测全绿，只有 e2e 抓得到）；预览悬停的工厂调用则要**前移**到指针处理之前，否则 `raycasterAt` / `previewHitAt` 在定义前被引用；**内容同步的工厂也不能紧跟容器声明** —— 它要用渲染工厂交出的 `syncPointHandleScales` 先把手柄按屏幕尺寸缩放、再算内容包围盒与面片尺寸（否则同一份内容会算出偏小的包围盒，实测 7.02 vs 7.11），所以只能排在渲染工厂之后。

### 如实缺口（不是缺陷，是没做或做不到）

- **CI 的首次运行是"三红一绿"，三个红都不是产品代码的问题，而是门禁自己要不要自足**（2026-09-25，run #1 / `96ff89f`；run #2 又暴露出两处，run #3 / `f10ee8e` **四个作业全绿**；两条修复提交 `26763e7` / `f10ee8e`，见 `CHANGELOG.md` 同日那一节）：
  1. `checks` 红在 `scripts/preview-server.test.ts` —— 它等 `127.0.0.1:4173` 返回 200，而那需要 `build-check/` 里有一份构建；本机一直有，CI 上没有（构建在另一个作业里），于是轮询到 vitest 的 5 秒超时。修法：用例自己造最小产物 + 随机端口，**不再依赖本机恰好有构建**（把真实产物挪走后复跑，仍然绿）。
  2. `build` 红在根目录的 `npm run build`（= `--workspaces`）连带去跑 `apps/desktop` 的 `tauri build`，而那个作业没有装 WebKitGTK。修法：这个作业只构建 web 工作区 —— 与它自己注释里"桌面打包刻意不进 CI"一致。
  3. `rust` 红在 `shell_smoke` 的 `the_web_entry_the_shell_loads_exists_and_is_the_web_build`：它断言外壳加载的 web 产物**真的在**，而 `cargo test` 不会跑 `tauri.conf.json` 的 `beforeBuildCommand`。修法：作业里先 `npm run build --workspace @draw/web` 再跑测试。
- **Rust `lib.rs` 的"大"有一半是被一份**守护性断言**钉住的**（2026-09-25 拆它时发现）：`tests/shell_smoke.rs` 原来要求**所有** `#[tauri::command]` 都写在 `src/lib.rs` 里（它按 `lib.rs` 的文本数 `#[tauri::command]` 的条数、并逐条找 `fn <名字>(`）。也就是说这个文件不是"没人拆"，而是"拆了就会红"。这一批把那份断言的口径从"扫 lib.rs"改成"扫整棵树"（`src/lib.rs` + `src/commands/*.rs`）—— **意图没变，覆盖面反而更大**：它现在守的是"只暴露具名命令、没有泛型命令、没有通用 shell / 文件读写出口"这条性质，而不是"命令住哪个文件"。登记清单仍逐字写在测试里（比对时只取路径的**最后一段**）。
- **`scripts/` 下的测试已纳入 `tsc`**（2026-09-25 补）：新增 `scripts/tsconfig.json` 与一份**最小的 node 类型声明**（`scripts/nodeTypes.d.ts`，只声明脚本真的用到的 `spawn` / `once` / `mkdtemp` 等）—— 与 `e2e/` 同一套做法，同样**刻意不装 `@types/node`**（它会全局引入并改变应用侧 `setTimeout` 的类型）。根 `typecheck` 现在末尾跑三段：workspaces + `e2e/tsconfig.json` + `scripts/tsconfig.json`。

- **几何 Worker 已接线，但"值不值"这条结论仍是**依据本轮读数**得出的**（编译 73 ms vs 复制 1 ms，约 76 倍）；**不是"管线全同步"** —— 那个判断此前记错了，已更正。降级路径（没有 `Worker` 的环境就地算）有独立用例，见方案 3 一节。
- **性能上的一件事还没做**：把 `applyOperation` 每次从整份文档 `structuredClone` 的成本降下来。基准显示这一档**固定成本压过增量收益**（局部重算比全量还慢）。注意这与方案 3 不是同一件事：编译那 73 ms 花在**算**上（复制只占 1 ms），所以 Worker 对它是有效杠杆；而重算那一档的固定成本才是复制。
- **主 bundle 仍超 500 kB 警告（2026-10-05 重新量过）**：入口 `index` chunk 现在是 **1 801.18 kB**（gzip 526.71 kB），比此前记的 1 614 kB **又长了约 11.6%**。上面那句"应用代码 ≈855 + React 221 + Three 530"是**当时那次的拆分读数**，本轮**没有重新拆**（要拆得单独做一次 bundle 分析）。`three` 仍在入口 —— 立体几何是首屏可达的顶级模块，拆它要连带改 `threeScene.tsx` 的装配方式。**同一次构建里还有** `engineeringExporters` 433.81 kB 与 `geometry.worker` 376.19 kB 两个独立 chunk。
- **`npm run test:rust` 已复跑**（**2026-10-05 更新：238 例通过 + 3 ignored / 0 失败**；2026-09-25 那次是 232 —— 差额来自第 21 轮给凭据库用例加的两条并发守卫，与第 27 / 37 轮两次复跑一致）—— Rust 侧其余部分本阶段零改动。
- **确认面板不按属主实体归并子对象**：用户要"一个立方体"，面板会说"会新增 28 个对象"。计数本身没错（28 个对象确实都会进文档），但"要不要按实体归并着说"是产品判断 —— 与方案 1 里"对象树以拓扑为依据"是同一个问题的另一面。**连带影响**：`agent-flow.spec.ts` 里有两条用例还在按"一个立方体 = 一个对象"断言（`共 2 个` / `会新增 1 个对象`），方案 1 之后它们必然为红 —— 已改成断言**不会随计数口径漂移**的性质（"共 N 个"必须大于"本次新增"，即草稿落在已有内容之上），同批 e2e 里 `solid-prism` / `agent-oblique-prism` 一直是按新口径断言的。
- **`longtask` API 在本机不可用（实测，不是猜的）**：评审方案 7 点名要的 `PerformanceObserver({ type: "longtask" })` 在**空白页**上、对一次**故意阻塞 200 ms** 的主线程占用，`observed` 与 `performance.getEntriesByType("longtask")` **都是空的**，而 `supportedEntryTypes` 里**确实**列着 `longtask`（Chromium 153 / Playwright headless）—— 即"声称支持、什么也不报"（一次性探针复核过，用完即删）。所以主线程读数改用**帧间隔**（`requestAnimationFrame` 间隔）实现：同一个 200 ms 阻塞必定表现为 ≥200 ms 的空档，量具灵敏度可以自证（用例里就有这条标定断言）。见 `e2e/main-thread-responsiveness.spec.ts`。
- **`section.create` 的平面已收口，但"登记表承诺 ≠ 校验层实现"这类风险只是**被识别出来**，没有机器挡住**（2026-09-26，见 §二「实机现场故障」）：`actionRegistry` 是"我们承诺收什么"的唯一声明处，而 `actionInputs` 里**少一个分支就静默落空** —— 字段会原样透传，直到文档校验器才被拒，报的还是够不到的**动作级**路径（那条一次性修复因此改不动它）。这一批把 `section.create` 补上了（三种平面写法收成一种，且共线时按**字段路径**拒绝），并留了判据："登记表里写了 `ask_user` 问题、或写了可选字段的每个动作都必须在校验层有显式分支"。**但这条判据目前只写在文档里**，没有一个测试逐动作核对登记表与 `parseActionInputs` 的分支覆盖面 —— 下一个新动作照样可能漏。
  - **2026-10-01 更正（范围收窄）**：上面这条**对"整张动作登记表"是过重的说法**。球体 Task 8 新增 `solid.create_sphere` 时实测：**动作目录这一层是有机器闸门的**，而且是它把我挡下来的 ——
    1. **编译期**：`skills/manifest.ts` 的 `CAPABILITY_FOR_ACTION` 是 `Record<DraftActionIdName, string>`，新增动作漏登记直接 `tsc` 报错（实测 `Property '"solid.create_sphere"' is missing in type …`）；
    2. **测试期**：`actionIds.test.ts` 钉动作总数（27→28）、`capabilities.test.ts` 钉各图元能力状态、`catalog.test.ts` 钉技能清单的**内容哈希**（改 `manifest.actionIds` 不更新 `EXPECTED_HASHES` 就 `hash_mismatch`）、`actionFieldParity.test.ts` 逐动作跑 `parseActionToolInput` 并把失败落到字段路径。
    **所以真正缺的只是"逐动作的字段覆盖面"这一层**（登记表写了可选字段 / `ask_user`，而 `actionInputs` 没有对应分支 —— 那种"字段被原样透传到文档校验器"的静默落空），不是"整个登记表没有守卫"。下一个新动作在三处会被机器逼着改齐，但**新加一个可选字段**仍可能漏。
- **平面写法上刻意只收三种**：规范形 `{normal, constant}`、过三点 `{points|throughPoints: […3]}`、点 + 法向 `{point|origin, normal}`（坐标 `{x,y,z}` / `[x,y,z]` 都收）。**不做**的：用两个方向向量定平面、用字符串别名指代平面（`"diagonal"`）、用曲面/多边形顶点集反推 —— 遇到这些会如实按 `invalid_plane` 拒绝并给出字段路径，而不是猜。
- **（已闭环，留档；不再是缺口）本轮查实并修掉两处真缺陷** —— 2026-09-29：① **恢复草稿后第一次改动不落盘**（会丢用户数据；提交 `4968051`）—— 根因是 `useDraftPersistence.ts` 里 `skipNextDraftSaveRef` 与 `restoreSettledRef` 的判断顺序赛跑（skip 被用户恢复后的第一次改动吃掉），修法是先消费 skip 再判 settled、两条原有守卫都不变松；回归钉在浏览器侧（修复前红 Expected 112 / Received 84、修复后绿），单测那 9 条钉语义、前后都绿。② **「距离」测量在"平面先选"时只得到无效读数**（提交 `e25cacb`）—— 根因是内核 distance 分支固定按 `sourceIds[0]` 是点取数（`pointFromPrimitive` 对 `plane3` 返回 `null`），修法是把"点那一侧"换到前面、`measurement.sourceIds` 仍记用户的选择顺序；回归在内核（`measurements3d.test.ts`，修复前红）与浏览器（两种顺序都量出 3.000u）两侧都有。详见 `CHANGELOG.md` 同日两节。
- **（已闭环，留档；此前那条"锁定不被吸附未实现"的记录是错的）「隐藏或锁定对象不被当作可吸附目标」两半现在都成立** —— 2026-09-29 复核更正。**更正的原因是我在错的层次上核对**：当时只看了纯函数 `resolveSpatialAnchor`（它只按命中物回答、**不认识文档**，所以不可能知道 `locked`），没看真正的过滤点 —— `threeSceneEffect.ts` 的 `resolveCreationAt` 里 `primitive.visible === false || primitive.locked || （生成的 point3）` 一律丢弃命中。**隐藏**那一半是构造性的（`threeSceneContent.ts` 先 `filter(isUserVisiblePrimitive)` 再建对象，隐藏图元根本不进场景），**锁定**那一半由上面那道门禁负责：锁定对象仍看得见、仍能选中，但创建时不再被吸附（退回工作平面）。证据是一条自带对照的 e2e（`e2e/geometry3d-creation.spec.ts`）：同一屏幕坐标，未锁定读"已有点 (0.00, 0.00, 0.00)"、锁定后读"工作平面 XY (…)"、解锁后又读回"已有点"；定向变异（摘掉 `primitive?.locked`）当场红。顺带澄清一处容易混的地方：`primitiveVisibility.ts` 的 `isUserVisiblePrimitive` 确实**不看** `locked` —— 那是**渲染可见性**判据，锁定不改变可见性，这正是我们要的语义；吸附门禁在创建拾取那一层，两件事不在一个函数里。
- **单顶点编辑的旧缺口（2026-09-29 查实；2026-10-01 已修且 GitHub CI 全绿）**：旧路径会因非共面四边形整笔拒绝；现将受影响面拆为合法三角片，保留原面 id、补内部细分棱并同步实体面/棱引用，不放宽 `face3` 共面校验。旧症状与更正记录见以下历史子项。
  - **更正**：此前这里记的是"属性栏改棱柱顶点坐标被**静默丢弃**、无任何提示"。走 UI 的真实路径复核后，那条**不准确**：`commitPatch`（`store.apply` 调的就是它）返回 `changed=false` + `error = "the change would make the document invalid: face3 points are not coplanar…"`，浏览器实测输入框弹回原值的同时**页面确实弹出了 `role="alert"`**，文案就是这一句（用一次性探针实测，探针已删）。
  - **根因**：棱柱（与模板实体一样）的侧面是**四边形**；改一个顶点会让相邻三个面立刻不共面，而文档校验器要求 `face3` 的点共面 → **校验层**把整笔退回。存储层本身是支持这件事的（`apply.ts` 会把描述翻成 `fromFaces` 再写顶点），但它先过不了校验层 —— 所以"存储层能改"不等于"属性栏能改"。
  - **另一条现象很可能是同一根因**：拖顶点手柄之后按 Ctrl+Z 被拒，报的是**同一条** `face3 points are not coplanar`。**推断**（未逐条验证）：那次拖动本身被拒、没有留下历史，于是 Ctrl+Z 撤掉的是上一步"创建棱柱"，画面因此变空、`data-content-bounds` 读出 NaN。
  - **已交付**：棱柱和模板实体属性栏改单顶点、一步撤销/重做、`.mgeo` 保存重开、改后体积量测和截面已通过本地真实浏览器及 GitHub CI（`cc9f533`、run `36895877862`）；移动到另一顶点同坐标时明确拒绝且不改原文档。拖动手柄/关联拉伸属独立后续范围。
  - **旧表征用例已更新**：`scene-store.test.ts`、`recomputeConsistency.test.ts`、`intersectionSolid.test.ts` 钉住面/棱引用、增量重算不动点、真实凹形拒绝与外凸体交集体积；`e2e/solid-prism.spec.ts` 走浏览器保存/撤销/量测/截面。
- **实体源体积的画布数字（2026-09-29 查实；2026-10-01 已修且 GitHub CI 全绿）**：原 `measurementVisuals.ts` 的 `pointPositions` 不认 `polyhedron3`，有效体积测量也没有画布数字；现以物化顶点求标签落点、缺顶点不造假坐标，复用现有 3D 叠层和样式。提交 `374daa0`；48.000u³ 实景清楚显示于实体中央，`.mgeo` 重开保持，CI run `36898807030` 四作业成功。
- **相机拖动后 HTML 标签滞后一帧（2026-09-29 查实；2026-10-01 修复且 GitHub CI 全绿）**：两层标签原在 `renderer.render` 更新相机矩阵之前投影；v3.0.1 的网格脚印计算曾碰巧提前刷新矩阵，掩盖无网格时约 386px 的偏差。现由 `threeSceneRender.render()` 在点名/测量标签投影前显式同步矩阵，不靠网格副作用或松手额外补帧。提交 `a4e2f40`，CI run `36901742182` 四作业成功。
- **（已闭环，留档）「自动取景动画会覆盖用户拖动」那个窗口已修**（2026-10-02，提交 `fd234fd`）：过去 `cancelFitAnimation()` 只在副作用清理（卸载）里被调用，用户拖动不取消进行中的取景，于是"换文档触发取景"之后在 **250 ms 窗口内开始拖**，拖动结束后剩下的帧会把用户刚拖出来的视角覆盖回去。现在 `pointerdown` 与滚轮都会先取消它。**顺带补了可观测状态** `data-fit-animation`（`running` / `done` / `cancelled`）—— 因为这条缺口的第一版用例是**假绿**的（触发条件搞错了：`shouldAutoFit` 只在换文档或内容出界时取景），现在用例要先抓到 `running` 才继续。证据：新增 `threeSceneCamera.test.ts`（该模块此前无测试，3/3，含"取消后不再排帧"）+ `geometry3d-drag.spec.ts` 一条 e2e（变异：去掉取消 → 期望 cancelled 实收 done，红）。
- **引用进度档案一律用小节标题，不写行号**：`project-progress.md:<行号>` 形式的引用会随任何一次编辑静默失效（本阶段就发生过三处，已全部改成按标题引用）。

## 旧一轮 N1–N6 的历史阶段记录（非现行 V0–V3 的完成判定）

以下只说明**旧计划**的实现与已知限制；新版作图题目标与进度以 [新任务追踪](agent-next-round-progress.md) 为准。旧 N1–N6 的检查项曾按当时范围完成，默认 Agent 与证明能力都没有因此自动升级：

1. **N1 统一数学状态（已完成）**：Obligation / Constraint / Claim IR，统一题设、目标、自由点、证据和 solver 状态。提交 `acd3bd5` / `2d62c4d` / `b5b33f9` / `f997b3f`；**在 flag 之后，默认关闭**。
2. **N2 解析构造与见证搜索（已完成）**：题面点名 + 关系（**无显式坐标**）时，系统自己解析构造候选（棱锥/棱柱）、按 seed/上限/预算做有界搜索，并**只把通过同一个核验器的候选**接进编译路径。提交 `c2314c9`..`e3fdb61`（内核）、`8648a13`..`ab05add`（搜索）、`ca1d0b2`..`9c5ae2f`（接线 + spike）。**`witnessSearch` 缺省关**；关闭时编译结果与 `4707b64` 逐字节相同。后端的可行性评估（Z3/NLSAT）只有**一次运行**的实测数字与原始产物，**没有接入产品**。
3. **N3 动态拖动保持**：约束进入文档状态，拖动变成临时约束求解和事务提交，显示自由度与冲突原因。
   **已完成（2026-10-06 出口达成：五步 + 入口 + 五条浏览器用例）**：内核的点投影、拖动层的自由度/冗余诊断、**拖动接线的决策层** `apps/web/src/constrainedDrag3.ts`（`App.tsx` 的 3D `onDragEnd` 已接上）、可证的矛盾判据、线状平行/垂直的投影都已落地并复核。**开关缺省关，关着时逐字走旧路径**，所以产品行为未变。**产品入口已通**（设置 → 实验性功能 → 约束拖动），浏览器正/反例已有（`e2e/agent-constrained-drag.spec.ts`）。**还没做**：`inconsistent`/`timeout` 的可证判据（矛盾目前只报"没能同时满足"）、拖动连带的撤销/重做与 inspector 提示。（**2026-10-05 更正**：这里原来还把"**过约束拒绝/冲突恢复/一步撤销的浏览器用例**"列在"还没做"里 —— 那三条**已在 N3 出口收尾时交付**，就是 `e2e/agent-constrained-drag.spec.ts` 的 5 条用例。）**秩已与 `reportFreeDegrees` 合流**（共用内核 `linear-algebra.ts` 的 `rankRows`），但两者的"可动集"口径按设计保持不同。
4. **N4 开放题理解与真实 Provider Benchmark**：自然语言先编译为 Obligation IR，再规划/求解/核验；建立真实 provider 的 pass@1、pass@3、成本、延迟和人工可读性基线。**已完成（2026-10-06 出口达成）**：题集（21 条）与报告契约已在 `packages/agent-core/src/benchmark/`，**CLI 与应用共用同一份**（提交 `f315cf6`；题集文本逐字节未变、`bench:agent` 读数逐字不变）。**N4b 已把应用内评测接到这 21 条上**：契约新增 `planning` 层（记"计划有没有被 `compilePlan` 接受"，客观、不需要金标准），应用侧新增题集通道（`benchmarkPlanningEval.ts`：3 题 × 1 轮、seed 7、`cost` 显式 `null`、`latency` 实测），设置面板里两套评测**各自独立、各自两段式、各自报请求数**（agent 工具环 24 次 / 题集 planning 3 次，合并按钮是不允许的）—— 旧那套 8 题记分卡的**行为一个字未改**。**（2026-10-06 已跑）** 那次**付费运行**本身（用户已授权、并已自己跑过；触发点在桌面端界面里，**由人点**；实施者从未代发）。
5. ~~**N5 形式证明出口**~~ **✅ 已完成，出口已达成（2026-10-06，但只覆盖一类目标）**：先支持少量短目标，区分 verified_instance、sampled、formally_proved，证明后端独立校验证书。

完整设计：`docs/superpowers/specs/2026-10-04-agent-full-next-phase-design.md`；实施计划：`docs/superpowers/plans/2026-10-04-agent-full-next-phase-implementation-plan.md`。外部项目调研：`docs/research/2026-10-04-github-project-survey.md`。

**当前明确不承诺**：下一阶段设计不等于已实现；**即使 N3–N6 的能力已交付，默认 Agent 仍只按当前已验证的静态示意图能力运行**（新能力全部在缺省关闭的 flag 之后）。**N2 的 `witnessSearch` 仍默认关闭，但设置 → 实验性功能现有独立入口；仅显式启用时允许替换候选，核验与人工确认不变。当前覆盖面仍很窄，不能称为通用解题。**
## 四、未完成任务总清单（2026-10-04 文档审查后；本节是“还差什么”的唯一权威处）

> 口径：只有在第一节当次真正跑过的内容才写成门禁读数。A–D、F–G 是未完成/边界，E 明确标注为**旧 N1–N6 历史阶段记录**，不能作 V0–V3 已完成证据；历史过程与失败尝试看 `docs/project-progress.md` / `CHANGELOG.md`。

### 先保留一条关键教训

**门禁全绿 ≠ 结果正确。** 修复前，用户现场的一张三棱锥错图曾通过全部已有门禁，因为系统当时只核验了中点，未覆盖等式、等边、比例、面面垂直和二面角。`b1ee3d3` 已对支持的题设增加逐条核验和 fail-closed 提交；这条历史事实仍保留，因为它解释了为什么后续必须继续分层建设求解、动态约束和证明证据。

### A. 用户侧验收（不需要管理员权限）

1. **教师/学生走查尚未完成**：验证“三点一面”目标（主操作数 ≤8、不必依赖 Shift）、误操作、取消、恢复、未核验提示和欠定示意图文案。
   - **2026-10-10 补：这一项现在是 V0 出口唯一缺的东西。** 四家族的**机器那半已齐**（四家族浏览器正例 15 passed、定向 6 文件 / 157 通过、反例与关旗反例都有真浏览器判据、`docs/evidence/` 六张截图**已逐张目视核对且与各自标签/方程相符** —— 明细见 [V0 出口对账](superpowers/plans/2026-10-06-diagram-agent-auto-lean-implementation-plan.md)）。**"人看图"这一步机器证据顶替不了**：需要教师/学生看这四类图，确认"图看得懂、直觉对"。所以计划的 `V0 出口` **保持未勾**（这是它自己那条纪律）。

### B. 管理员权限验收

1. **MSI 安装→启动→卸载：2026-10-10 用户报告通过**（管理员权限；控制器未旁观）。NSIS 曾在本机单独实测；两类安装包的证据不互相替代。新构建批次若要正式发布，仍须按目标产物重新核对版本、哈希和发行验收。

### C. 真实 provider 与 Agent 质量基线

1. **已有但远不足发布**：应用内真实 provider 的 planning 轴曾由用户运行三轮（一次只取 21 题的前 3 题），工具环另一次得 `pass@1 1/8`、`pass@3 2/8`；人工可读性只标注两条、每组 `n=1`。抽取层 `covered=14/21`、题设覆盖率 72.7% 是**离线抽取判据**，不是模型作图正确率。这些历史数只证明“确实测过这些小样本”，不是现行作图题的真实成功率；逐次时间和原始口径在 §一与归档。
2. **明确未测/测不到**：费用仍 `null`（有 token usage，无经审定价目表），其余 18 条旧题集与现行作图题集尚无真实 provider 完整读数，`>1 MiB` 响应那类在现有传输上报错，不能算 planned/rejected。开放题图形正确率、人工图面可读性的大样本与证明可信翻译均未放行。CLI `real_provider` 因不走应用凭据通道仍整批 `not_measured`；离线 `deterministic_local` 不能充当真人模型通过率。再付费运行需另经人确认。
3. 下一阶段完整任务与归属见 [V0–V3 作图题进度追踪](agent-next-round-progress.md)；**成本、延迟、pass@k、人工可读性必须各报自己的分母和提供者，不能合并成一个“质量已通过”状态**。

### D. 发布与仓库收尾

1. 公开 Release `v3.2.0` 对应较早产物，不能代表当前源码或新规划。下次发布需定版号、构建和签名/哈希、source tag、GitHub Release，并复核**推送后的 CI**；不要从历史 SHA 推断当前 CI 必绿。
   **2026-10-10 决定：本轮不发布**（理由与做法逐条写在 [下一步计划](superpowers/plans/2026-10-10-selftest-followups-and-release-plan.md) §3-A）：版号文件一直按用户口径留在提交之外，**本轮不替用户改这个口径**；而工作区比现场验过的 3.3.10 批次又多四件事（P0-A / P1-B / P2-C / §3-D），**其中三件用户还没在桌面上走过一遍** ⇒ 先走查、再定版号（建议 `3.3.11`）、再出 bundle 与 release。当前本机 exe 的 SHA-256 已记在那份计划里（`498769549DFB…393B1D`），**`bundle/` 下的 MSI/NSIS 仍是 10-10 11:48 那一批（3.3.10），比当前源码旧**。
2. **用户侧**教师/学生走查（无需管理员）仍未完成；**管理员侧** MSI 安装→启动→卸载已有 2026-10-10 用户报告通过（控制器未旁观），NSIS 有更早的本机证据。两项独立，不可互相替代。新自动 Lean 还须有许可证、固定 mathlib 版本、运行隔离、发行包与无工具链的真实桌面证据。

### E. 旧 N1–N6 阶段记录（历史切面；新 H0a 已实施、完整 H0 与 H1–H4 未完成）

**N1 与 N2 已实施并复核（2026-10-05，都在默认关闭的 flag 之后，不改变默认行为）；N3–N6 也已在 2026-10-06 全部实施并复核 —— N3/N4/N5 出口达成、N6 收口。** 以下逐条保留当时的记录，完成状态已就地更正：

1. ~~**N1：统一数学状态 IR**~~ —— **已完成**（`acd3bd5` / `2d62c4d` / `b5b33f9` / `f997b3f`；flag 默认关）。
2. ~~**N2：解析构造与见证搜索**~~ —— **已完成**（内核 `c2314c9`..`e3fdb61`；搜索 `8648a13`..`ab05add`；接线与 spike `ca1d0b2`..`9c5ae2f`；`witnessSearch` 默认关，关闭时与 `4707b64` 逐字节相同）。
3. ~~**N3：动态拖动保持约束**~~ **✅ 已完成，出口已达成（2026-10-06）**（自由度、过约束、无解、事务和恢复）—— 并承接 N2 留下的两件事：`planCompiler ↔ solver/witnessSearch` 的模块环（断法：给搜索器注入物化端口）与"**真正算出**自由度"（需先把 `ConstraintType` 扩到能表达线⊥面与角度）。**状态（2026-10-05 收尾：出口已达成）**：内核侧已经做完** —— 点投影、拖动层的自由度/冗余诊断、拖动接线的决策层（`apps/web/src/constrainedDrag3.ts` + `App.tsx` 的 3D `onDragEnd`）、可证的矛盾判据、以及**线状平行/垂直的投影**都已落地并复核；**按 `ConstraintType` 现有的全部 8 个成员枚举核过：7 个可投影 + `coincident`（平面内专有）⇒ "没有投影规则"那一支不可达**（是枚举出来的，不是断言的）。**计划 N3 的 RED 命令点名的那七件测试文件也补跑了：7 文件 / 241 通过。**
**但**：**开关缺省关，产品行为未变**。**产品入口已经补上**（顶栏「设置」→ 实验性功能 → 约束拖动，`ExperimentalFeatures.tsx`，偏好存 `mathcanvas:next-phase-preferences`；`agentNextPhaseFlags()` 只读取这项和独立的 `witnessSearch` 偏好），**浏览器正/反例也达成了**：`e2e/agent-constrained-drag.spec.ts` 两条 —— 关着时拖动**真的会改变** `|AB|`（少了这条，"打开时 |AB| 不变"可能只是拖没生效），打开后同样的拖动 `|AB|` **仍是 1**，且先断言 A 确实动过；入口本身另有 `e2e/next-phase-flag-entry.spec.ts` 3 条。**仍未达成的** → **已于 2026-10-05 收尾达成**：计划 N3 出口点名的**过约束拒绝 / 冲突恢复 / 一步撤销**三条**浏览器**用例补齐了（`e2e/agent-constrained-drag.spec.ts` 现在 **5 条**，提交 `d7fe702` + `2dd89ab`）—— 拒绝会**点名冲突的约束 id** 且草稿坐标逐字未变；拒绝**不写文档也不占一步历史**、修掉冲突后同一次拖动正常提交；一次 Ctrl+Z 让四个点回到拖动前且历史只占一步。三条都是**回归钉子而不是 RED**（首跑即绿、如实申报），每条都有**变异**证明会咬人（六个变异各自命中对应断言、全部还原）。**仍未实现**的只剩 `inconsistent` / `timeout` 两个**状态**（顺序投影下矛盾只会振荡，本层如实报 `exhausted` 而不报"无解"），**不影响该出口**。上面两件事里，**"真正算出自由度"只解决了拖动层那一半**（文档层的 `witnessSearch.degreesOfFreedom` 仍是 `null`），**模块环仍未动**。
4. ~~**N4：开放题编译与真实 Provider Benchmark**~~ **✅ 已完成，出口已达成（2026-10-06）** —— 并承接 N2 的浏览器端验收（flag 打开时救援路径的端到端）与 **flag 状态进入 trace/benchmark 记录**。
   **（2026-10-05，已完成）**后一条**已经做掉了**：五个开关的状态随 `RunRevisions` 一起进 run 事件（`RunEvent` 每次相变都 spread 整份 `revisions`），落点是 `runState.ts` 的 `RunRevisions.nextPhaseFlags` + `StartRequest.nextPhaseFlags` + `agentRunner.ts` 的调用点。**没接线就留空（`undefined`），不编一份"全关"** —— 正反两条用例钉着。所以"这份 trace 是在哪组开关下取的"现在**答得出来**了。
5. **N5：形式证明出口**（实例、采样、形式证明严格分级）。**状态（2026-10-05 到第四步；2026-10-06 出口已达成）**：① `proofArtifact.ts` 把判据落成可执行的（`verified_instance`/`sampled` 不得变成 `formally_proved`；伪造/缺字段/版本不匹配/"证明了别的东西"一律拒）；② `proofGoals.ts` 的**短目标封闭词表**（10 种）；③ **后端接线门** —— `WIRED_PROOF_BACKENDS` 由**通过的审查记录推导**；④ **后端准入契约**（`proofBackendReview.ts` 十栏，缺一栏就拒）。`npm run proof:smoke` 打印 `PROOF_BACKENDS {"wired":["lean4"],"reviewed":1}`、**8 通过**（此前 7 通过 / `{"wired":[]}`）。**已接一个后端 `lean4`（Lean 4 + mathlib）**：走的是**十栏准入记录**（`e401d9e`）+ 适配器闭环（`051e5fe`）；**可达范围 2026-10-10 起是两个目标类**（`perpendicular` 性质定理 + `linePlanePerpendicular` 判定定理，后者本机真跑 `formally_proved` / 68392 ms / 三个白名单公理），**其余目标类真实运行仍得到 `unsupported`**（曲线性质 / 切线·导数 / 其它立体关系今天没有模板）。**这一句原来写的是"只有一类目标"——那是 2026-10-06 的读数，2026-10-10 已就地更正。** **同日的改名与一处错配修正（要点）**：目标词表里那条"线垂直于平面"原来叫 `planePerpendicular`，还把解析层的 `planePerpendicular`（**面⊥面**）声明成它的载体 —— 于是一条"平面⊥平面"的题设会被读成"线⊥面"这个目标（拿它去配模板就会**证一条别的命题**）。今日修正：① 目标改名 `linePlanePerpendicular`；② 去掉那条错的载体声明（面⊥面今天**没有**证明目标，如实返回 `null`）；③ 新增按**点名形状**消解目标的入口 `declaredProofGoalForObligation`（`perpendicular`/`parallel` 各承载两种读法：4 个点名 = 线与线，≥5 = 线与面；线∥面与面⊥面都如实返回 `null`）；④ 只给 kind 时 `declaredProofGoal` 在 `ambiguous` 栏如实标 `true`，不静默按一种读法下结论。
6. **N6：feature flag、依赖/许可证/线程/WASM 审查、发布门槛与维护收口**。**状态（2026-10-05 到第十四步；2026-10-06 第十五步 + 全计划收口）** —— 五个开关的覆盖矩阵、JS 运行依赖的许可证清单、WASM/线程边界、**Rust 传递依赖的许可扫描**（`cargo metadata`：551 包 / 33 种表达式 / 无一缺 `license` 字段 / 无 GPL·AGPL·SSPL）、**并发正确性专项**（唯一一处两把锁嵌套的守卫 + 删掉 `drop(runs)` 会自锁的实测）、e2e 与 Rust 两条抖动的修复与前后计数、整批门禁（含**生产构建**）都在，写进 [`docs/acceptance/next-phase-flag-and-dependency-review.md`](acceptance/next-phase-flag-and-dependency-review.md) 与 [`docs/current-status.md`](current-status.md) §一。**那一份当时尚未回答的**：`obligationIR` / `witnessSearch` 两个开关的浏览器用例（**2026-10-05 的历史基线**；后来 `witnessSearch` 有设置入口及 V0a 狭窄浏览器 3/3，`obligationIR` 仍无用户入口）；依赖体积与供应链范围仍应逐项审查。另查出两处依赖归位问题（`apps/web` 的 `@vitejs/plugin-react` 放错在 `dependencies`、根 `package.json` 多余一个 `three`）—— **2026-10-07 已修**：`npm install` exit 0，lock 改动逐行核过（只有 112 处 `"dev": true` 翻转 + 5 行声明搬家，**未增删任何包**），typecheck / lint（0 error / 13 warning）/ web 生产构建 / 全库非 Lean（330 文件 / 3878 通过 + 1 todo / 0 失败）全过；副作用是生产安装不再带上构建期插件。**同日全量 e2e 首跑那条红**（`geometry3d-drag.spec.ts:95` 实收 `done` 而非 `cancelled`）已由 trace 定为**用例侧竞态**、产品行为正确（`cancelFitAnimation()` 无事可做时不报状态），单独跑 9/9、全量重跑 207 通过；用例改法已于同日落地：读数与派发收进**同一个页内任务**（`before` / `after` 精确夹住同步的 `pointerdown` 取消），竞速只决定能否拿到窗口；变异（注释掉 `cancelFitAnimation()`）当场红、还原复绿，单条 5/5、全量 e2e 207 通过。
7. 其他尚未启动的产品探索：题目截图识图、GeoGebra `.ggb` 互操作、平面/函数题型逐题补缺、3D 画面进入 HTML。

### F. 现行 V0–V3 与立体扩宽：只处理需要作图的题（整阶段未交付）

- [x] **V0 内部基础**：保留 2025 课程来源清册作候选参考，但独立 `diagram-scope-2025.json` 的 4 个宽泛图形领域只标 `helpful`，不能把同章节纯计算强制画图；3 个默认非图子型可由题目明确绘图请求覆盖，另 134 子型仍 `unknown`。内部题集已用三角、椭圆、导数曲线与四面体的 **12 条**原创正/反/欠定**文字/坐标候选**替代旧提交 `89b57f8` 中的纯集合/数列/恒等式九例，4 条欠定例给出可行自由点/参数样本。这批内部候选在当时还**没有内核/画布核验**（后续 V0a–V0d 的产品证据见 §一），`verified_instance` 不可仅凭文本产生；Lean 更未自动调用。
> **2026-10-06 产品接线初审（当时状态；下文三点已由 V0a–V0d 逐块补齐，见 §一与上方增量块）**：`planCompiler.ts` 和 `draftStore.ts` 的原文题设核验只在 `solid.create_polyhedron` 触发；平面曲线虽有创建动作，却未接相同的原文条件复核；DSL 能表示函数图像，但 Agent 无 `function.create_graph`，现有分析/切线动作需要来源。V0a–V0d 已按真实调用点写入新计划；当时发现线面垂直可识别而“上方”及显式坐标未有同等判据；V0a WIP 已在显式见证搜索开关下核验受限坐标写法，未知“上方”保持未核验，浏览器错坐标/下方反例仍欠。**当时 V0a 只有自由三棱锥的定向产品路径 3/3 浏览器记录；此后浏览器坐标独立回代（该 spec 现 6/6）、截图目检与全量回归均已补齐，四家族的题设核验也不再只挂多面体。仍未完成的：计划的 `V0 出口` 要的教师/学生目视走查、自动 Lean、真实 provider 作图质量。**

**（2026-10-10 V0 对账）** V0 的**机器那半已齐**：四家族浏览器正例 **15 passed**（每条提交后重放、读落盘坐标/参数自算）、定向 **6 文件 / 157 通过**、模糊输入与关旗旧路径都有真浏览器反例、`docs/evidence/` 六张截图逐张目视核对与各自标签/方程相符；**出口仍不勾**，唯一原因是**教师/学生看图走查**（§四 A，必须由人做，不需要管理员）。详见 [V0 实施计划](superpowers/plans/2026-10-06-diagram-agent-auto-lean-implementation-plan.md) 的出口对账表。
- [ ] **V0 产品出口**：实际生成 2D/函数/圆锥曲线/3D 图元，逐条核验题设与证据来源；负例拒绝，欠定自由点允许一张符合直觉且满足题设的示意图，旧路径关旗回归和浏览器可视/撤销正反验收齐备。
- [ ] **V1/V2/V3**：四类作图约束/拖动，限定作图主张可信形式化后桌面受限自动 Lean，真实 provider 作图图面可读性与成本门禁。教师/学生目视走查仍未完成；管理员 MSI 已由用户报告通过（控制器未旁观）；新增付费 provider 请求需要用户单独批准。各块具体文件/RED/接口见 [新实施计划](superpowers/plans/2026-10-06-diagram-agent-auto-lean-implementation-plan.md)。
  - **V1 已于 2026-10-10 逐条对账**：四类题可重复构造/拒绝（四家族浏览器正例 15 passed + 每族错误参数反例：`AB∥AC`、轴反了/半轴互换、`tangentAt` 失败、矛盾坐标被拒）、无空间判据约束**不得被拖坏**（`constrainedDrag3`：passthrough / 贴回平面 / 法向抵消报 `noop`）、未核验**逐条中文列出且不给确认**、一步撤销在各 e2e 里断言。**一处如实留着**：`ClaimEvidence.degreesOfFreedom` 仍是 `null`（R33 裁决、`claimEvidence.test.ts:48` 钉住；"系统替你选了哪些值"有列，**数值自由度没算**）。
- **立体图形扩宽（S1–S6，**2026-10-10 全部收口**）**：计划见 [立体图形覆盖扩宽实施计划](superpowers/plans/2026-10-07-solid-shape-coverage-implementation-plan.md)。S1 点名语法（含 S1.4 已裁决的 `A′′`）、S2 `SolidShapeSpec`、S4 棱台/圆台、S5 外接/内切球都已落地并有浏览器证据；**S3 四类形状各有正反例**（直棱柱 3–6 边、菱形底面、斜棱柱、正六边形底面；S3.4 的根因是关系抽取的点名块字母表不含 `′`，见 [变更记录](../CHANGELOG.md)）；**S6 入口语法已收口**（四族各有至少一条"读落盘坐标自己算"的浏览器正例；`freeApexIntentFor` 窄正则**评估后决定保留**，承重性已钉）。**S1–S6 的逐块对账、变异与读数见本页上方逐块摘要与 [任务追踪](agent-next-round-progress.md)。** 画布标签与核验顶点错位**已于 2026-10-10 修掉**；球状态词表**已于同日裁决并落地**（新增 `stale`）。

### H. §3-F 剩下的能力缺口（2026-10-10；**这就是"按需排期"那一栏的现况**）

> 这一栏是「下一步计划」§3-F 的对账结果：**两条已结清**（圆台近似口径、球状态词表），
> **一条已做一半并补完另一半**（底面点名数值角：阶段 A + 阶段 B 的 B1），剩下下面四条。

1. **数值角还差三类**（都不是缺陷，是**明确的覆盖面边界**，各有如实拒绝）：① **环上非第二位**的角（四边形 `∠BCD` —— 代表方向那条规则在那里不成立）；② **n ≥ 5 底面**的点名角（走"正 n 边形代表"，满足不了一个指名的角）；③ **顶点自己成角**（`∠APB` —— 顶点本身是角的顶点，位置要**两个以上未知量**才定得下来）。
2. **用角把侧棱方向钉死**（`∠A′AB=60°`）：**早已裁决不做**；它的方程形状与已实现的 B1 **一模一样**，所以现由**一条护栏判据**钉住（"斜棱柱 + 菱形底面 + `∠A′AB=60°` 仍不通过、去掉角那句仍通过"），防止那条路被顺手打开。
3. **棱柱顶环上的角**（`∠A′B′C′`）：数学上**等于**底环上的角（顶环是底环的平移），但要先把"环外"从"顶点"推广到"另一个环"并做点名映射，本期不做。
4. **空间"线重合"的判据与求解**（`coincident`）：**设计已写**（[空间线重合设计](superpowers/specs/2026-10-10-spatial-line-coincidence-design.md)），**卡在没有入口** —— 查实今天**没有任何产品路径能声明这条约束**（题面解析不产出 / `DRAFT_ACTION_IDS` 没有约束动作 / 界面没有约束编辑器，而 `capabilities.ts` 却把它记为 `available`）⇒ 按推荐**记为"已设计、暂不实施"**；入口三选一（题面 / Agent 动作 / 界面）都是独立的产品决定。

### G. N1/N2 旧阶段边界与 park 项（历史快照，不替代 V0a 当前进展）

> 本节原本记于 V0a 实现前；其中“仅支持点名直角/没有原话坐标判据”等旧结论只对应当时的旧路径。当前 V0a 狭窄自由三角底面和坐标写法的事实见 §四 F / §一；四家族全部完成仍无证据。

- **2026-10-06 N2 窄题型扩展（独立子区块）**：明确给出三角底面唯一一个直角、但直角不在原面环首位时，内核按点名循环旋转三角环后解析构造；搜索层复用同一规则选择自由底边，最终坐标仍经拓扑和原话题设双重核验。新增 `PB⊥平面ABC`、`AB⊥BC`（B 角直角）内核/搜索/真实编译链正例，以及“只有侧棱与底边垂直不能冒充底角”反例。定向 3 文件 / 97 项、全库不含慢 Lean 集成 324 文件 / 3775 项通过 + 1 todo，typecheck/build exit 0，lint 0 error / 13 warning；全量浏览器 195/195 通过。**仍不支持**四边形直角不在环首及带撇点名的棱柱；这道新题尚未收入 21 题 benchmark，4.8% 历史读数不能据此宣称改变。



- **2026-10-06 N2 入口补丁（本次独立区块）**：设置 → 实验性功能新增「示意图见证搜索」开关；默认关，明确只覆盖部分棱锥题型，用户显式打开并刷新后保留，坏偏好关；与约束拖动独立，其余三个尚未交付普通产品行为的开关仍不受存储控制。点击仅打开既有编译救援路径，仍须逐条核验与用户确认。定向 6 文件 / 61 项、UI 3 文件 / 17 项、浏览器入口 4/4、全工作区类型检查 exit 0、lint 0 error / 13 warning；还没有浏览器真实 provider 成功救援的证据，不声称提高真实模型通过率。



- **2026-10-06 N1 来源追溯补丁（本次提交，先于后续能力开放）**：`ClaimEvidenceStatus` 的设计/计划词表已补齐代码中存在的 `verified_instance`；用户原话中“求证”目标和显式自由点在解析时记录原文及起止区间，IR、兼容适配与开启 IR 后的报告原样传递。手工旧集合没有原话时继续用 `0/0`，不编造位置。定向 6 文件 / 68 项通过、黄金样本与文档检查 4 文件 / 28 项通过、全库非 Lean 慢集成 324 文件 / 3767 项通过 + 1 todo、全部工作区类型检查 exit 0、Web 构建 exit 0、lint 0 error / 13 warning；Lean 真集成按既有独立口径，本块未宣称重跑；该改动不启用任何默认关闭的开关，也不宣称补齐开放题理解或形式证明。

- **离线求解率只有 4.8%，而这是"设计覆盖面"决定的，不是缺陷（2026-10-05 查实）**：第 51 轮的码表显示卡点在构造阶段。第 52 轮去核了构造器本身 —— `packages/geometry-kernel/src/witness/constructors.ts` 的**文件头**写明首批只覆盖"棱锥 / 棱柱、底面 n = 3 或 4、**底面上有点名的直角**、顶点在**点名的垂足**正上方"，并且：**"覆盖不到的形状（斜平行四边形底面、直角不在环首的四边形…）明确拒绝并给出 `reason.code`，而不是悄悄换一个题目没说的形状 —— 那正是'特值化悄悄改题'的老毛病。"** 所以那 9 条 `unsupported-shape` + 4 条 `unsupported-base-shape` 是**落在这个覆盖面之外**（棱柱的带撇点名、只有线⊥线没有线⊥面的题面、没有立体点名的题面）。**要不要扩覆盖面是设计决定**，而且设计本身警告过硬扩的风险。

- **~~`deterministic_local` 的「求解率」缺一个定义~~（2026-10-05 更正：**这个结论错了，已经能跑了**）**：我原来的理由是"见证搜索只在救援路径里触发（`planCompiler.ts:235`），要先有一份模型给的计划失败才有东西可救，所以离线没有输入"。**那个理由错了** —— 救援路径传进去的只有两样：`first.obligations.ir`（**解析结果**）与 `witnessShapeFor(context.prompt)`（**从题面推出来的图形族**）。**两样都不来自模型。** 现在 `agent-core` 导出了离线入口 `searchWitnessForPrompt(prompt)`，`bench:agent` 的**见证层**用它，实测：`BENCHMARK_WITNESS verified=1 unverified=20 no_witness=0 solveRate=0.048`（**离线求解率 4.8%**，21 题里 1 题拿到通过核验的候选）。它与救援路径共用同一份组成（seed / 候选上限 / 超时 / 题面→图形族），不是又写一遍。

- **N5 的"输入绑定"与"只读展示"两条都已裁决并落地（2026-10-05，R51 + R56 + N5a）—— 此前这里记的是"未裁决 / 做不了"**：

  **① 输入绑定的边界（R51 + R56，落点在 `packages/agent-core/src/proof/proofArtifact.ts` 的 `proofInputHash`）**：
  **必绑** 题设原话 + 这条 claim 的原话 + 目标 + **系统替你定的假设**（`assumptions`）+ **被证明的那条命题原文**（`statement`）；
  **不绑** 文档内容指纹（坐标 / 形状 / 标签）—— 不是"默认不传"，而是**入参里根本没有这一栏**。
  规范化的两条决定：假设**先排序**（顺序不影响哈希）、**逐字去重**（同名假设两次与一次同哈希 —— 重复只可能来自"同一条被推导了两次"，
  让它参与哈希只会造成**假过期**；反过来逐字相同的两条不可能指两条不同的假设，所以去重不会制造假有效）；空数组与不传**同哈希**。
  **R56 的两个选项里选了 ①（命题原文），理由**：② 要发明的"命题模板注册表 + 版本"今天**没有生产者**，
  而它的保证挂在"改了模板记得升版本"这条**靠人守**的纪律上 —— 忘掉时旧证明被挂到新命题上，**那种错看起来完全正常**。
  三条失效模式都是"让信号说错话"：不绑假设 ⇒ **过度声称**、不绑命题 ⇒ **假有效**、绑文档指纹 ⇒ **假过期**（会被改个 `label` / 重解选到另一组坐标刷掉，且训练人忽略失效提示）。

  **②「证明级别」只读状态面**（`apps/web/src/components/agent/ProofLevelNotice.tsx` + `proofLevelStatus.ts`，插在 `ConfirmationPanel` 题设核验节之后）：
  文案**由事实推导**（`WIRED_PROOF_BACKENDS` / `PROOF_BACKEND_REVIEWS` 从包根导入，没有第二份副本）。今天它如实说
  "**当前没有接入任何形式证明后端**"以及后果 —— "本条的证明级别不可能升到 `formally_proved`；能给的只是**一个实例**的核验"。
  判据：注入一个假后端后文案里**必须出现它的名字**（写死的实现会在那里红），今天**不出现**"已证明 / 证明通过"这类字样。

  **③ 产物正文查看器：明确不做，而且不是"没时间做"**（查证结果）：`ProofArtifact` / `proofInputHash` / `evidenceStatusWithProof`
  在 `apps/` 与 `packages/` 里除 proof 模块自身、它的用例与 `scripts/proof-spike/` 之外**零引用** ⇒ **今天没有任何代码会生产 proof artifact**，
  也没有任何通道把它送进界面。为一个**永远跑不到**的生产路径做查看器，只能用注入的假数据测，按本仓口径那是**弱证据** ——
  它证明的是"组件能渲染假数据"，不是"用户能看到他的证明"。**等第一个后端过了十栏准入再做**（那时才有真数据）。
  **仍然没接的**：`agentStore` / run event schema 上的产物通道（`ClaimEvidence` 这套证据词汇至今没有进过 Web 界面）——
  那要等有产物可送，与"接一个真实后端"是同一件事。

> **（2026-10-06 更正：上面 ② 与 ③ 里的"今天"都不再成立 —— N5b 接上了第一个真实后端）**
> 提交 `e401d9e`（十栏准入记录 ⇒ `WIRED_PROOF_BACKENDS` **推导**出 `["lean4"]`）与 `051e5fe`（适配器 + `perpendicular` 的**一般命题**走完整条闭环）。
> - 上面那句"今天它如实说'**当前没有接入任何形式证明后端**'"**已过期**：默认现在说的是"**本构建接上了 1 个形式证明后端…**"。
>   那一支文案**仍然在**（`wired.length === 0`），但现在是**被"显式注入 0 个"的用例钉着**，而不再是"今天的实况"。
> - 上面"**今天没有任何代码会生产 proof artifact**"**也过期**：`packages/agent-core/src/proof/lean4Adapter.ts` 的**显式调用**路径
>   真的产出了 artifact（闭环用例里升到 `formally_proved`）。**但"不做查看器"这个决定不变**，理由换成两条事实：
>   **① 默认路径不调用它**（设计：证明后端不参与普通静态图的默认运行）；**② 仍没有任何通道把产物送进界面**。
> - **仍未达成（不许含糊）**：只覆盖**一个目标类**（`perpendicular`，一条真目标走通**不泛化**）；
>   **IR → Lean 命题的翻译本身未被证明**（一份可审计的小模板；`assumptions` **有意不进命题**，方向保守）；
>   `ProofInput.statement` **仍是可选** ⇒ "必绑"只被"**适配器记得传 + 一条用例**"堵住，**没被结构堵住**；
>   **强沙箱（只读+无网）下的证明运行未测**（这条仍在）；**mathlib 的 rev 已于 2026-10-10 钉住**（`rev = "c20717eaa791af9dd3f7847f5ba91623bda9ab6b"`，`lake-manifest.json` 一并提交；实测该 rev 下真证明仍 `formally_proved`）—— 原来那句话写的是"没有被 pin"（`rev = "master"`，
>   而 `lake-manifest.json` 是**每次运行都会重新生成**的产物，已加进 `proof/lean4/.gitignore`）⇒
>   **十栏里那个 mathlib commit 是"实测值"，不是"从仓库可复算"的保证**。
> - **仍然没接的**：`agentStore` / run event schema 的产物通道 —— 这一条**仍然成立**（理由与上面 ② 相同）。
> - 顺带一条由"接上后端"暴露的**工程缺陷（已修）**：`eslint` **不读 `.gitignore`**，于是它会去 lint `.lake/packages/` 里
>   **mathlib 依赖包自带的 JS** ⇒ 建过 Lean 工程的机器上 `npm run lint` 会从 `0 error / 13 warning` 变成
>   **14298 problems（14247 errors）**，而 **CI 上（无 `.lake`）仍是 0 error**。已按该文件既有的同一条原则
>   （"别人生成的产物不算我们的源码"）加 `"**/.lake/**"` 到 `ignores`，复验回到 **0 error / 13 warning**。
- **两处"约束"模块的分工（免得被误当成重复实现）**：`planar-constraints.ts` 管**"点能待在哪儿"**（一维曲线 + 自然参数，`project`/`evaluate`，拖拽与动画是同一条状态更新），是**点 ↔ 宿主**的一元关系；`constraints3dProjection.ts` 管**"几个对象之间必须保持什么关系"**（⊥ / ∥ / 等长 / 共面…），是**多元**关系，用顺序投影迭代。**两者互补，可以同时出现在同一份文档里**；分工已写进 `constraints3dProjection.ts` 的文件头。

- **N5「勾股」已裁决（2026-10-05，用户决定）**：走"**判成 ⊥ 目标 + 用勾股定理那一步把结论接回来**"。**这件事没有做成别名** —— 勾股仍然**没有直接载体**（两个载体字段都空），它多的是一条**显式的推断路线**（`inference: { from: "perpendicular", theorem: "勾股定理及其逆定理" }`），并且新函数 `proofGoalDischargeRoute()` 把它与"直接能判"分开报。理由写在第 50 轮那段更正里，也在代码注释里：**别名等于把一条推断藏进分类函数，而推断应当出现在证明里、看得见**。于是 `firstBatchGoalsWithoutAnyRoute()` **现在是空的**（`proof:smoke` 的读数里能看到 `goalsWithoutAnyRoute: []` 与 `pythagoreanRoute`）。
  `fixedLength | equilateral | equalLength | midpoint | segmentRatio | planePerpendicular | dihedral | perpendicular | parallel` —— **没有共线、共面、勾股**。所以照计划把它们列进"支持"只会得到一句没有载体的话（永远不会有 goal 被分类成它）。处置见 `packages/agent-core/src/proof/proofGoals.ts` 的 `unexpressibleFirstBatchGoals()`，两条路：**① 先扩解析层**（让这三类目标能被表达），或 **② 从首批里划掉**（N5 只声称支持能表达的那几类）。**这一条需要裁决，不是实现细节。**

- **棱柱族恒为"未核验"**：原话解析把 `A′` / `AA₁` 压成单个大写字母，且核验器的点名别名映射只收 `/^[A-Z]$/`，所以 `shape:"prism"` 稳定产出 `unverified_instance`。设计 §5 的 R2 出口本来就规定"**不支持**题稳定产出 `unverified_instance`"，故这是**符合出口**的诚实结果；带撇点名的支持是独立后续项（要动解析层，**不许**在内核或接线层"猜"）。
- **`degreesOfFreedom` 目前恒为 `null`**（窄豁免）：N1 的 `reportFreeDegrees` 要的是 DSL `ConstraintSpec[]`（`targets` 是**图元 id**），而 `ConstraintType` 表达不了线⊥面与角度；只映射子集会让数字**看不出漏了什么**，拿实测值冒充更是自证。要真算需扩 `dsl` + 内核判据 → 归 N3。**呈现纪律**：`null` 必须读作"未计算"，**不得**读作"自由度 0 / 刚性"。
- **有意保留的模块环** `planCompiler ↔ solver/witnessSearch`（`planCompiler.ts:24-37` 写明理由与安全性）：唯一干净的断法是给 `searchWitness` 注入物化端口，但那要改已复核的公开 API，故等 N3 的第二个消费者到场时一次定死。
- **把 `unverified` 当作救援触发条件**：即"模型给的草稿本身可用、但题面里有一条读不出的子句"时也会被替换成系统选的坐标 —— 这是 R37① 规定的语义，**有意的**。
- **后端 spike 的 `not_measured`**：Z3 自身的 `threads` 并行、浏览器内 WASM、内存占用、`z3` CLI（本机不存在）；数字是**一次运行**的墙钟读数（WASM 阻塞在两次运行里量到 28 / 139 ms 的差），原始产物在 `.superpowers/sdd/…/spike-z3-raw.json`（工作区产物，不在版本控制里）。
- **park 的小瑕疵（不影响正确性，留给最终整支复核 triage）**：`planCompiler.ts` 里 1500 ms 的墙钟预算（失败方向保守：超时即不救援）；异步假设项 `value` 仍是**候选序号**而物化后的是模型序号（今天只消费 `.text`）；Worker 契约把非数组 `materialisedActions` 当缺席（只损失纵深防御）；`relations:[null]` / `unverified:[null]` 这类**非类型合法**输入仍会抛；报告 §7.1 有两个 `npm view` 得来的数字不在原始产物里。

完整设计：`docs/superpowers/specs/2026-10-04-agent-full-next-phase-design.md`。
完整计划：`docs/superpowers/plans/2026-10-04-agent-full-next-phase-implementation-plan.md`。
GitHub 调研：`docs/research/2026-10-04-github-project-survey.md`。


## 2026-10-16 功能补完区块 A（Task 18）

实际补完异步证明生命周期：私有暂存 + 发布 CAS，失效/取代后不返回成功；原题与规范化题面分别绑定，保存真实形式输入哈希与后端版本。新增 5 个生命周期合同用例（含独立 review 发现的规范化碰撞，确认 RED 后 GREEN）。相关回归 4 文件 / 50 通过；全仓 typecheck exit 0；lint 0 error / 13 既有 warning。详细执行及边界见 `docs/superpowers/plans/2026-10-16-functional-completion.md`。**本区块功能修复已验，不外推真实 Lean/桌面发行已验，Task 20/21 仍未完成**。下一块 B：评测门禁。


## 2026-10-16 功能补完区块 B（Task 20）

评测门禁已按功能补完：固定 36 次工作量、非法请求/费用拒绝、完整人评覆盖要求、共享真实请求预算与重试超额拒绝均已落地并通过合同测试（20/20；冻结授权与评测 28/28）。全仓 typecheck 通过，lint 无 error（13 个既有 warning）。这不是实际 provider、人评或桌面发行验收；Task 20/21 的真实验收仍需分别执行并留证。

## 2026-10-16 功能补完 C1（Task 9：oracle 完整性）

已复现并修复：缺一条或全部实测读数时误判通过。现在按 oracle 条件名一一配对，缺失/重复/多余读数均拒绝；空 oracle 不能成为金标；无限数、非法容差及非实测状态不能通过。缺失项用明确的 missing 记录，不伪造测量值。新增 9 条边界测试，定向 20/20 通过；全仓 typecheck exit 0；lint 0 error / 13 既有 warning；diff 检查通过。

边界：此区块只补离线判据，不新增未经独立人工复核的真题答案，verifiedGoldCaseIds 仍为空。Task 16 仍在检查实际消费接线，区块 C 尚未整体验收。


### C2｜Task 16 真实画布证据消费（2026-10-16）
- 根因：旧实现只保存属性字符串；内容更新到下一次测量之间，旧读数仍会挂在新画布上。过期判据只在测试使用。
- 修复：2D/3D 保存真实测量快照，发布属性前用当前工作区与文档哈希消费证据。旧快照返回 stale，不发布旧盒子/标签/哈希读数；同哈希只换快照版本不误报。尚无实时文档绑定的读数为 unbound，不算通过。
- 区分结论：passed / partial / failed / stale / pending；3D WebGL 对象不可测只能 partial，即使 diagnostics 为空也不能 accepted；点名缺失判 failed；不能由调用方把不可测快照升级为可测。
- 验证：新增 5 条先红后绿；4 文件 55 条单测通过；真实浏览器 6/6（28.9 s），验证 2D accepted=true、3D partial/accepted=false、撤销后 failed/empty_canvas。首次 e2e 暴露旧选择器不能读取 stale 过渡态，改为稳定状态属性，并等待新测量再验空画布。
- 全仓 typecheck exit 0；lint 0 error / 13 既有 warning；diff 检查通过。
- 边界：这是提交后真实画布的证据消费，不是确认前候选图渲染，也不等于 HostBridge 在提交前已验证视觉。候选图视觉门禁、桌面画布与人工可读性仍未验收；Task 16 不据此升级为全部完成。数学条件仍由独立核验器判断。


## 2026-10-16 功能补完 D1（Task 12）

目标关系的有界折叠搜索已接入真实 `compilePlan`：当前支持单折叠的平面角、二面角、线面角。搜索预算、有限残差、跨极点保护和 `not-found`/`unreachable` 分级均有功能测试；固定距离解析结果逐支回代。定向 212/212、Task 13 原用户翻折浏览器链路与画布证据 7/7 通过；`typecheck` exit 0，lint 0 error / 13 existing warnings。Task 13 面上点/展开、Task 15 公切线产品闭环仍未完成。

## 2026-10-16 功能闭环增量：Task 13 面上点与 `solid.unfold`

本区块按真实运行链路验收，不以类型定义或文档存在作为完成依据。

- **面上点**：`dynamic.create_face_point` 已接通 `parseDraftAction → compileAction → commitPatch → resolveBoundPoint3`。测试覆盖面内坐标、跨文档引用、参数驱动更新、退化面与越界坐标拒绝；点以真实 `point3` 和 `onFace` binding 持久化。
- **多面体展开**：新增 `solid.unfold`，输入目标实体引用与 `[0,1]` 展开进度；编译为 `updatePrimitive`，由 `commitPatch` 写入文档的 `polyhedron3.unfoldProgress`。非多面体、越界/非有限进度、跨文档目标均拒绝。
- **渲染消费**：渲染器优先读取每个 `polyhedron3` 自身持久化的进度，未设置时才回退到 UI 全局进度；实体可独立展开。渲染测试通过 `sceneShell.dataset.unfoldObjects` 观察持久化值和 fallback 值。
- **新鲜证据**：定向测试 **6 个文件 / 28 个测试全部通过**；4 个相关 TypeScript 项目检查全部 exit 0；`npm run lint` exit 0（0 error，13 条既有 warning）。这是自动化闭环证据，不是人工视觉签收。
- **边界**：展开仅支持已有 `polyhedron3`，不声称任意曲面展开或自动选择展开树；Task 15、16、18、19、20、21 不因此升级。
- **提交**：功能提交 `4e0354a` 已推送到 `origin/main`。保留未提交的审查探针和桌面 Cargo 改动；本报告作为四份进度文档之一随区块提交。

## 2026-10-16 功能闭环增量：Task 15 函数公切线（支持范围内完成）

本区块已按真实产品路径验收：`function.create_tangent` 的 `anchor.kind = common` 从工具输入进入动作编译，提交到 scene graph 后由重算器维护真实切线几何；来源函数变更会重算，删除来源会级联清理依赖。题面“两条公切线”进入 `commonTangent` obligation，独立验证器重新求解并核验数量、branch、来源身份、两条曲线相切关系和直线参数，不能只相信图元自报的 slope/point。

当前支持范围是两条显式 `function` 图元、branch 0/1；`verified-numeric` 仅表示当前图形实例的独立数值证据，报告仍为 `figure-instance` / `not-proven`。非函数曲线、形式证明、真实模型评测、人工验收和完整桌面发行不在本区块完成范围。

新鲜证据：7 个定向测试文件 / 138 个测试通过；4 个相关 TypeScript 项目检查 exit 0；lint 0 error / 13 条既有 warning；diff 检查通过。

## 2026-10-16 功能闭环增量：Task 19 本地证明执行的实时输出上限

证明 runner 不再用 `wait_with_output()` 在内存中收集完整输出：stdout/stderr 由并行异步读取任务实时消费，各自只保留最后 4000 字节；超时先 kill/reap 再丢弃半成品输出。模板白名单、固定 lake 路径和墙钟预算仍保持不变。

证据：`cargo check --lib` exit 0；`cargo test --lib proof` 2 passed / 0 failed。此区块仍不宣称严格 OS 隔离、真实 Lean 慢集成、桌面发行或安装验收。

### 2026-10-16?Task 16 ???????????

??? HostBridge ?????????????????????/??/??/????????? fail-closed?????? commit ?????no-op draft ????????????? 71/71????? 12/12?Web typecheck exit 0?lint exit 0?13 ??? warning??

????? Task 16 ???`structured_only` ????????????????????? WebView/IPC/???????????????

## 2026-10-16 Functional audit: Task 9 gold cases and oracle evidence

This block records runtime evidence. Research summaries, structured fixtures, and documentation are not treated as independent human gold labels.

- **Runtime result:** Loaded `EXAM_CASES` and `HELD_OUT_CASES` directly. The development set has 8 cases and the held-out set has 4; `checkExamSet(EXAM_CASES, HELD_OUT_CASES)` returns no structural problems. However, `verifiedGoldCaseIds` is still `[]`; all 12 cases have `answerIndependentlyReviewed === false`; no case contains a valid oracle.
- **Functional guard result:** `judgeAgainstOracle` is fail-closed in the running implementation: an unreviewed case or an empty oracle returns `not_a_gold_case`; an independently reviewed synthetic case rejects empty or partial measurements, duplicate/extra measurements, non-finite values, and out-of-tolerance values, and accepts only when every required condition is measured exactly once. `packages/agent-core/src/benchmark/examSet.test.ts` passes 20/20.
- **Acceptance result:** Task 9 is **complete for the engineering/offline qualification scope**. The executable qualification rules and anti-false-pass oracle behavior are verified; the repository still has no human-reviewed gold case, so `verifiedGoldCaseIds=[]` remains a deliberate boundary for Task 20 model-quality acceptance.
- **Non-substitutable evidence:** A survey summary is not a verbatim exam prompt; a re-published answer is not an independent review; a clean `checkExamSet` result validates dataset structure only and does not create a gold case. Real review records and evidence must be added before `verifiedGoldCaseIds` can be populated and a real exam evaluation can be accepted.
- **Boundary:** This block does not promote offline synthetic oracle checks, unit tests, or documentation into human acceptance. Real provider evaluation (Task 20) and desktop/manual acceptance (Task 21) remain open.

## 2026-10-16 Functional audit: Task 20 real provider evaluation

This block records a real product run through the installed desktop WebView and its confirmation UI. It is not inferred from fixtures, mock models, or the CLI placeholder.

- **Provider actually used:** `deepseek-v4-flash / deepseek-v4-flash`, configured as an OpenAI-compatible cloud profile. The desktop IPC reported a configured secret and provider health `degraded`: strict JSON and streaming verified; tool calling and vision failed during health checks.
- **題集 planning (3 real provider requests):** `planned 1/3`, `clarification 1/3`, `rejected 0/3`, `error 1/3`, `not measured 0/3`; measured-run average latency `21376 ms`; cost `not measured` because the application has no price table. Cases were `underdetermined-pyramid-base` (planned), `contradictory-two-lengths` (clarification), and `unsupported-expression` (error after three transport attempts). Human-readable annotations were `0/2`; this is unannotated, not a zero score.
- **Agent tool-ring evaluation:** the product reported `attempts 24`, `pass@1 1/8`, `pass@3 1/8`, `tool selection 45/45`, `tool error rate 6/45`, `visual verify not_supported` for `visual-fit`, average successful-run latency `1300 ms`, and cost `not measured`. The product did complete the requested run, but the result is a failing/insufficient quality result, not a release pass.
- **CLI boundary:** `npm run bench:agent -- --mode=real_provider` still records every case as `not_measured`; it is not counted as a real provider result. The numbers above came from the confirmed desktop product path and are kept separate from the deterministic-local and planning-contract tests.
- **Acceptance:** Task 20 is **partially complete**. The real provider execution and honest failure/latency readout are functional. The frozen four-family gold evaluation is still not complete: there is no valid independent gold oracle for the 12 frozen cases, the planning run has no human annotations, cost is unavailable, and the 8-case tool-ring result is far below a publishable quality claim. No pass is inferred from the existence of the report.
- **Evidence file:** `audit-20261016/task20-provider-ui.txt` contains the rendered product report captured after the run.

## 2026-10-16 Functional audit: Task 21 desktop release and runtime boundary

This block records an actual release build, installer run, installed-app launch, and WebView IPC probe. It does not treat a successful compile as teacher/student acceptance.

- **Release build:** `npm --workspace @draw/desktop run build` exited `0` and produced `apps/desktop/src-tauri/target/release/mathcanvas-desktop.exe`.
- **Installers:** `npm --workspace @draw/desktop run bundle` exited `0` and produced both `MathCanvas_3.3.14_x64_en-US.msi` and `MathCanvas_3.3.14_x64-setup.exe`. The installer run exited `0`; the installed application launched with window title `MathCanvas` and `Responding=True`.
- **Installed WebView/IPC:** the real installed page loaded at `http://tauri.localhost/`. IPC returned active profile `deepseek-v4-flash`, one configured OpenAI-compatible profile, `has_secret=true`, and `run_event_count=82`. This is evidence that the installed WebView and Tauri bridge are alive, not merely that Rust code compiled.
- **Automatic Lean boundary:** the same installed IPC call returned `lean_proof_availability.outcome=unavailable`, with detail that neither `DRAW_LEAN_LAKE` nor `DRAW_LEAN_PROJECT` is configured. The desktop path therefore did not execute a Lean proof on this machine. This is separate from ordinary drawing and separate from provider evaluation.
- **Manual acceptance boundary:** no teacher acceptance record, student acceptance record, clean-machine/offline installation record, or end-to-end user confirmation/revise/undo acceptance record exists in this audit. These cannot be inferred from the installer exit code or from IPC health.
- **Acceptance:** Task 21 is **partially complete**. The release engineering path, installer generation, installation, launch, WebView load, and IPC smoke path are verified. Lean configuration and teacher/student acceptance remain incomplete, so the task is not release-accepted as a whole.
- **Evidence files:** `audit-20261016/task21-desktop-build.txt`, `task21-desktop-bundle.txt`, `task21-install.txt`, `task21-launch.txt`, and `task21-ipc-evidence.json` record the corresponding runtime evidence.

## 2026-10-16 Task 18 current-HEAD functional revalidation

This entry supersedes the initial defect reproduction as the current-state verdict. The earlier `F1 / P1` section remains historical evidence of the defect that motivated the fix; it is not a claim about the current HEAD.

- **Fresh executable evidence:** `npx vitest run apps/web/src/agent/draftStore.proofLifecycle.test.ts apps/web/src/agent/automaticProofStage.test.ts apps/web/src/agent/desktopProofChannel.test.ts --silent=false` completed with **3 test files / 20 tests passed / 0 failed / exit 0** on the current HEAD.
- **Observed behaviors:** invalidated drafts reject late proof as `unknown_draft`; a newer stage rejects a late result as `stale_draft_version` and keeps the newer preview; pending proof does not publish a half-staged candidate; prompt normalization/raw prompt hashes and the proof binding (`claimId`, `goalSourceId`, `inputHash`, `backendVersion`) stay attached to the original attempt.
- **Product boundary:** proof is best-effort and does not block ordinary drawing when the export flag is off; these tests do not constitute a real Lean execution, desktop installed UI lifecycle, or teacher/student acceptance.
- **Acceptance:** Task 18 is **complete for the asynchronous lifecycle/binding slice** and remains **partial for the full task card** because real Lean integration, desktop proof lifecycle, and release/manual acceptance are still not verified.


## 2026-10-16 Current functional status increment: Task 12

Task 12 now has a verified functional loop within its declared scope: bounded fold relation search is connected to the product compiler entry point; candidate layout evidence, undrawable-function fail-closed behavior, projection/area overflow protection, repair/workspace switching/consent/commit paths are all covered by current executable checks. Ordinary drawing for the solid representative and function/tangent representative passed separate browser E2E flows.

Boundary: structured_only candidate evidence is not screenshot/DOM/real-camera/vision acceptance; this does not claim generalization to every fold problem or exam, and does not claim automatic Lean is complete. Task 20 real-provider quality evaluation and Task 21 teacher/student release acceptance remain separate verdicts.

## 2026-10-16 Current-HEAD functional checkpoint

The current checkpoint includes product baseline `374bcd4` and the fresh Task 9/13 checks below; older test records retain their original baselines.

- **16/21 complete within declared support scope:** Tasks 1-15, 17.
- **3/21 partial:** Tasks 16, 18, 19.
- **2/21 not complete or not release-accepted:** Tasks 20, 21.

Ordinary drawing and automatic Lean remain separate. Representative ordinary drawing flows are executable and green within the supported geometry slice. Configured desktop runner evidence now includes successful real Lean execution for all four bounded templates; the installed IPC probe still reported Lean unavailable because the installed environment lacked the required project configuration. Task 20 still lacks a publishable real-provider evaluation, and Task 21 still lacks teacher/student, clean-machine/offline, and complete user-flow acceptance. Therefore the project must not be described as 21/21 complete or release-ready.

The detailed matrix and blocker list are in `audit-20261016/functional-review.md`. The latest functional code baseline is on `origin/main`; the final documentation commit will be checked against the remote after push.


## 2026-10-16 Task 19 current-HEAD bounded desktop admission and real runner smoke

This block records an executable functional change, not a documentation-only review.

- **Admission fix:** desktop Lean input now has positive closed-template admission for the four generated goal families (perpendicular, line-plane perpendicular, tangent slope, and line-in-plane). It binds theorem/report names, imports, heartbeat budget, declared points, repeated statement points, and the finite proof strategy; extra declarations/commands, substituted statements, block-comment wrapping, mismatched reports/imports, and arbitrary proof bodies are rejected before any process or temporary file is created. The old forbidden-token checks remain diagnostics, not the sole boundary.
- **Compatibility evidence:** actual TypeScript adapter output, including renamed identifiers, is snapshotted into `apps/desktop/src-tauri/tests/fixtures/lean-admission.json`; the Rust suite exercises eight real generated fixtures.
- **Fresh verification:** `proof_command` passed **19/19**; the seven proof TypeScript suites passed **97/97** before this block, and the combined admission/pinning/proof/benchmark contract slice passed **145/145**. Typecheck and changed-file lint were also clean.
- **Real configured desktop runner:** with explicit existing `DRAW_LEAN_LAKE` and `DRAW_LEAN_PROJECT`, offline/locked and without downloads, the ignored integration smoke ran all four generated templates through the Rust runner: **1 test passed**, all four Lean processes exited `0`, backend was `Lean 4.35.0-rc3`, and each raw axioms report contained exactly the expected theorem report. Measured durations were 257.961 s (cold first class), 69.156 s, 65.963 s, and 69.486 s. This proves real local execution through the desktop runner; it is not OS sandbox evidence and not installed-desktop release evidence.
- **Acceptance boundary:** Task 19 is **complete for the bounded source-admission and configured local runner scope**. It remains **partial for release acceptance** because OS sandbox testing, clean/offline packaged desktop validation, and an installed UI proof lifecycle are not evidenced here. Automatic Lean remains separate from ordinary drawing.
- **Evidence:** `audit-20261016/task19-real-admission.txt` and `audit-20261016/task19-real-admission.exit`.


## 2026-10-16 Task 9/13 fresh functional closure

- Task 9 engineering scope: 5 files / 92 tests passed. The offline set is 8 development + 4 held-out cases with provenance and anti-leakage checks; invalid or incomplete oracle measurements fail closed. `verifiedGoldCaseIds=[]` remains an honest human-gold boundary and is not a model-quality result.
- Task 13 declared representative scope: 6/6 browser E2E passed for folded quadrilateral, frustum, pentagonal pyramid, experiment-off negative path, cylinder and cone display. The original prompt checks seven points, eight conditions, PC=4√3, confirmation, return and undo.
- Evidence: `audit-20261016/task9-task13-functional-20261016.txt`; full fresh logs: `task9-offline-fresh.txt/.exit`, `task13-unit-fresh.txt/.exit`, `task13-browser-fresh.txt/.exit` (all in the same audit directory).

## 2026-10-16 Task 16: live 3D camera evidence regression

Functional defect reproduced before the fix: retained overlay nodes marked `hidden` were counted as visible, and camera-only frames did not trigger React-based evidence measurement. The browser RED independently observed six hidden point labels while evidence incorrectly reported none. Unit RED: 2 failed / 14 passed; browser RED: 1 failed.

The fix excludes hidden labels (including hidden ancestors) and refreshes evidence after actual overlay/WebGL frames, with document-bound subscriptions and cleanup. View-only camera changes do not change document identity. Recovery by Fit View is measured again; 3D evidence remains **partial**, never promoted to passed while object bounds are not measurable.

Fresh GREEN evidence: 5 unit files / **28 passed**; 2 browser files / **9 passed** (real WebGL camera failure/recovery plus proof-unavailable/flag-off paths); workspace typecheck and changed-file lint exit 0. Independent code review against `82dfdca` found no Critical or Important findings and independently reran 16/16 changed-file unit tests.

Logs: `audit-20261016/task16-camera-{red,green,browser-red,browser-green,typecheck,lint}.txt` and matching `.exit` files. RED logs deliberately have nonzero exits; they are reproduction evidence, not current failures.

**Acceptance boundary:** Task 16 stays partial: candidate pre-confirmation visual gating, complete WebGL object measurement, installed-desktop evidence and independent human readability are not established by this block. Task 18 browser downgrade is verified but installed real-Lean lifecycle is not. Current whole-card totals remain **16 complete (1-15,17), 3 partial (16,18,19), 2 not complete / not release-accepted (20,21)**. Task 19 bounded admission/configured runner success is a completed sub-scope, not completion of the whole card. The Goal stays active.

## 2026-10-16 Task 16: bind candidate render evidence to its actual run

- **Functional defect reproduced:** a render artifact from another run was accepted when draft ID and document content matched. Two new regression tests first failed (2 failed / 16 passed): preview incorrectly passed and a commit with substituted evidence succeeded.
- **Repair:** the host now checks the evidence run ID at preview, consent and commit. Matching content does not authorize cross-run artifact reuse. The commit path reacquires evidence, so switching it after consent is rejected as `stale_render`; both regressions assert zero live-document writes. Content-hash freshness and no-op behavior remain unchanged.
- **Verification:** focused 6 files / 137 passed; full unit 404 files / 4712 passed / 1 todo, exit 0; typecheck exit 0; lint 0 errors / 13 existing warnings. Independent read-only review found no actionable Critical, Important or Minor issue and separately ran 78 relevant tests successfully. Evidence: `audit-20261016/task16-render-run-{red,green,full-unit,typecheck,lint}.txt/.exit` and `task16-render-run-review.md`.
- **Browser regression is NOT green:** the full browser run against the preceding `f6bc646` source (started before this run-binding repair) finished **234 passed / 5 failed**, exit 1. Three conic commits and a sphere commit failed at consent; a sphere/solid seeded-document assertion read 29 primitives instead of 2. Original failure output is retained in `audit-20261016/final-e2e.txt/.exit`; traces and page contexts are preserved locally in `final-e2e-preserved/`. Root-cause investigation and repairs are a separate block, not hidden by this safety fix.
- **Acceptance boundary:** this is an evidence-identity safety repair, not real candidate DOM/screenshot evidence, WebGL object measurement, human readability, or desktop release acceptance. **Task 16 remains partial; matrix stays 16 complete / 3 partial / 2 not complete or not release-accepted.**

## 2026-10-16 功能补完：Task 16 解析图元候选门禁

- **真实故障与根因**：完整浏览器回归中椭圆、双曲线、抛物线、球体在确认提交时失败。候选结构布局缺少这四种图元的范围，空布局被诚实地判成 failed_render。现补入几何采样/球体 XY 范围；开放曲线使用明确的有限观察窗口，不声称全局范围或真实相机测量。
- **异常参数拒绝**：独立审查发现有效对象能掩盖非法解析图元。新增混合反例先得到 **14 failed / 24 passed**，修复后相关两文件 **96 passed**。非法半径/轴向/旋转、球心深度缺失或非有限、窗口与采样溢出均不能静默跳过或退化成一个假点；每个支持图元的全部采样必须有限。新增独立尺寸检查覆盖旋转、轴向与正负焦参。
- **完整功能链**：四类本地规划器均验证隔离草稿 → 确认 → 原子写入 → 一步撤销。球体布尔预览旧测试的“两对象”种子不完整：既有恢复逻辑会物化立方体拓扑，不是产品新增半成品。新测试独立检查 8 点/12 棱/6 面/1 体及引用完整，再对持久化 primitives 逐值相等检查零额外写入；两个立方体的正向预览对照保留。
- **最新最终验证**：全量单元 **404 文件 / 4741 passed / 1 todo**；当前源码重新构建后的全量浏览器 **239 passed**；全仓 typecheck exit 0；lint exit 0，0 errors / 13 条既有 warnings。证据为 `audit-20261016/task16-analytic-final-{unit,e2e,typecheck,lint}.txt/.exit`；异常 RED/GREEN 为 `task16-analytic-invalid-{red,green}.txt/.exit`。
- **历史不抹除**：此前 `final-e2e.txt/.exit` 的 234 passed / 5 failed 保留为修复前证据；新的 239 passed 才是本区块最终结果。修复异常参数前的 4717 单元/239 浏览器亦仅为中间快照。
- **验收边界**：候选证据仍明确是 `structured_only`，不是确认前真实 DOM/截图或人眼可读性。完整 WebGL 对象测量、桌面发行、干净/离线环境、教师/学生签收和 frozen 12×3 真实模型质量门禁尚未通过。**Task 16 仍 partial；总矩阵保持 16 complete / 3 partial（16、18、19）/ 2 not complete 或未发行验收（20、21）；Goal 保持 active。**

独立复审：异常参数 P1 已关闭；复审者实际重跑相关 2 文件 / 96 测试通过，未发现新的阻断问题，允许提交。完整范围和执行归属见 `audit-20261016/task16-analytic-render-review.md`。
