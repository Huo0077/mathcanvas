# 21 项升级：功能补完执行记录（2026-10-16）

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

## 验收原则

用户要求按原计划补齐剩余功能；每个区块以可复跑的功能测试验收，更新本记录、主进度文档与当前状态，再提交、推送 GitHub。原始功能审查见 `audit-20261016/functional-review.md`。

起点：`3632817016d5cab5e4939199467e0b557962b844`，分支 main，与 origin/main 同步。保留用户原有 `apps/desktop/src-tauri/Cargo.toml` 修改，不纳入本轮提交。

## 分块计划

| 区块 | 范围 | 状态 | 验收条件 |
|---|---|---|---|
| A | Task 18：异步证明生命周期 | 已实现并通过本地功能回归 | 失效/被替换/并发暂存的迟到结果不返回 verified，不覆盖新草稿；身份绑定原请求 |
| B | Task 20：评测门禁 | 已实现并通过本地功能回归 | 实际工作量及逐次预算检查；非法金额拒绝；人评覆盖不齐不放行 |
| C | Task 9、16：独立核验与画布证据 | 进行中：oracle 与实时画布消费已修复；候选视觉/桌面待验 | oracle 必需条件完整覆盖；隐藏点不误报；过期渲染证据消费时拒绝 |
| D | Task 12、13、15：缺失产品链路 | Task 12 已完成支持范围；Task 13 已完成面上点/展开支持范围；Task 15 已完成公切线支持范围 | Task 12 有界折叠关系搜索；Task 13 面上点/展开入口；Task 15 公切线从产品动作到最终核验 |
| E | Task 19：本地证明执行 | 部分完成：实时输出上限已补；真实 Lean/发行待验 | 严格受支持模板、实时有界输出及工具链校验；真实 Lean/Rust 验证 |
| F | Task 20、21：最终验收 | 待做 | 真实模型评测、全量回归、桌面/安装/离线/人评按实测分别记账 |

## 边界

- 12 完成、7 部分、2 未完成是原审查起点，不是本轮完成数量。
- 不以假通道单测替代真实 Lean、真实 provider 或桌面安装验收。
- 付费调用仅在合法授权与可执行预算闸齐备时运行，不输出凭据，不伪造费用。
- 人评、干净机器、设备条件若不可得，保留未验收状态；普通作图与自动 Lean 分开判断。

## 区块记录

### A｜Task 18（2026-10-16）

- 修复：stage 在编译/证明等待期间使用私有候选；发布时核对草稿对象与当前暂存租约，失效后返回 unknown_draft，被新请求取代后返回 stale_draft_version，不再半发布或覆盖新草稿。
- 身份：保留 core 已核验的原命题 inputHash、实际后端版本；claim 在请求前绑定原题哈希。原文哈希与规范化题面哈希分别保存，即使两段原文规范化后相同，旧证明仍过期。
- RED → GREEN：原有四个生命周期反例先复现；独立 review 追加规范化碰撞，移除原文比较时得到 expected stale / received verified，恢复后通过。
- 本地验证：4 文件 / 50 测试通过（draftStore 生命周期/既有草稿/automaticProofStage/hostBridge）；全仓 typecheck exit 0；lint 0 error / 13 既有 warning；diff --check 通过。
- 独立 review：发现的原文身份 P2 已修正。使用注入通道测试异步生命周期，**不代表真实 Lean、桌面 IPC、安装或整题证明验收**。
- 提交：本区块独立提交并推送 origin/main（提交号见 Git 历史）。

### B｜Task 20 评测门禁

进入执行：先补请求声明与实际工作量不一致、缺人评误放行、非法费用的失败合同测试，再在实际模型调用边界补预算控制。


### B｜Task 20（2026-10-16）

- 修复请求工作量门禁：执行入口先按冻结样本计算固定工作量（12 题 × 3 次 = 36），声明为 1 等不一致请求在任何 `runCase` 前拒绝。
- 修复授权参数校验：请求上限必须为正整数；授权最高费用必须为有限非负数；本次预估费用必须为有限非负数；`NaN`、负数不会再绕过门禁。
- 修复人评覆盖门禁：只有一族的全部试验都有 readability 标注时才计算 `unreadableShare`；部分覆盖返回 `null` 并判定不通过。
- 修复真实调用预算：评测入口向 `runCase` 传入共享预算。适配器可为重试/额外 provider 调用显式消费请求；超授权时立即拒绝。旧的二参数适配器在没有显式消费时按一次逻辑试验计一次，避免已有夹具失效。
- 失败 → 修复验证：新增 4 条合同测试，先观察到固定工作量、人评覆盖、预算边界失败，再实现；当前评测测试 **20/20**，冻结授权测试与评测合计 **28/28** 通过。
- 全仓验证：`typecheck` exit 0；`lint` exit 0、0 error / 13 existing warnings；`git diff --check` 通过。
- 边界：这只证明评测门禁会阻止错误声明和超预算；没有执行真实 provider、真实人评或桌面发行验收，不能据此宣称 Task 20 的真实模型评测已完成。
- 提交：本区块独立提交并推送 origin/main（提交号见 Git 历史）。

### C1｜Task 9 oracle 完整性（2026-10-16）
已复现并修复：缺一条或全部实测读数时误判通过。现在按 oracle 条件名一一配对，缺失/重复/多余读数均拒绝；空 oracle 不能成为金标；无限数、非法容差及非实测状态不能通过。缺失项用明确的 missing 记录，不伪造测量值。新增 9 条边界测试，定向 20/20 通过；全仓 typecheck exit 0；lint 0 error / 13 既有 warning；diff 检查通过。

边界：此区块只补离线判据，不新增未经独立人工复核的真题答案，verifiedGoldCaseIds 仍为空。Task 16 仍在检查实际消费接线，区块 C 尚未整体验收。


### C2｜Task 16 真实画布证据消费（2026-10-16）
- 根因：旧实现只保存属性字符串；内容更新到下一次测量之间，旧读数仍会挂在新画布上。过期判据只在测试使用。
- 修复：2D/3D 保存真实测量快照，发布属性前用当前工作区与文档哈希消费证据。旧快照返回 stale，不发布旧盒子/标签/哈希读数；同哈希只换快照版本不误报。尚无实时文档绑定的读数为 unbound，不算通过。
- 区分结论：passed / partial / failed / stale / pending；3D WebGL 对象不可测只能 partial，即使 diagnostics 为空也不能 accepted；点名缺失判 failed；不能由调用方把不可测快照升级为可测。
- 验证：新增 5 条先红后绿；4 文件 55 条单测通过；真实浏览器 6/6（28.9 s），验证 2D accepted=true、3D partial/accepted=false、撤销后 failed/empty_canvas。首次 e2e 暴露旧选择器不能读取 stale 过渡态，改为稳定状态属性，并等待新测量再验空画布。
- 全仓 typecheck exit 0；lint 0 error / 13 既有 warning；diff 检查通过。
- 边界：这是提交后真实画布的证据消费，不是确认前候选图渲染，也不等于 HostBridge 在提交前已验证视觉。候选图视觉门禁、桌面画布与人工可读性仍未验收；Task 16 不据此升级为全部完成。数学条件仍由独立核验器判断。


### D1｜Task 12（2026-10-16）

- 在既有固定距离解析求角之外，新增 `searchFoldAngles`：有限区间、有限评估预算、均匀采样与二分回代；只接受有限残差且回代误差在容差内。跨极点的符号变化不会直接当根。
- 结论分级：`solved` 只表示找到数值见证；`not-found` 永远不是 `unreachable`，并明确 `complete:false`；非法区间/预算/容差零评估拒绝；下端点不含、上端点可含。
- 产品接线：`compilePlan` 对单折叠的 planarAngle、dihedral、linePlaneAngle 关系进行有界搜索；每个候选重新走完整 `compileOnce`，最后必须由最终坐标核验整份题设通过才发布。折叠数超过一笔不猜耦合解。
- 修复解析支路漏解：固定距离的每个解析候选逐支回代，不再只尝试第一支；其余合法支继续写入假设披露。
- RED→GREEN：新增 12 个内核/编译链路测试，先观察到搜索接口不存在及真实编译失败，随后 **212/212** 定向测试通过；当前 `typecheck` exit 0；`lint` 0 error / 13 existing warnings；Task 13 原用户翻折浏览器用例与画布证据用例 **7/7** 通过。
- 边界：这是 Task 12 与翻折代表链路的功能证据，不把 Task 13 的面上点/展开入口、不把 Task 15 公切线产品闭环写成完成。
- 提交：本区块待独立提交并推送，提交号在区块完成时回填。

## 2026-10-16 功能闭环增量：Task 13 面上点与 `solid.unfold`

本区块按真实运行链路验收，不以类型定义或文档存在作为完成依据。

- **面上点**：`dynamic.create_face_point` 已接通 `parseDraftAction → compileAction → commitPatch → resolveBoundPoint3`。测试覆盖面内坐标、跨文档引用、参数驱动更新、退化面与越界坐标拒绝；点以真实 `point3` 和 `onFace` binding 持久化。
- **多面体展开**：新增 `solid.unfold`，输入目标实体引用与 `[0,1]` 展开进度；编译为 `updatePrimitive`，由 `commitPatch` 写入文档的 `polyhedron3.unfoldProgress`。非多面体、越界/非有限进度、跨文档目标均拒绝。
- **渲染消费**：渲染器优先读取每个 `polyhedron3` 自身持久化的进度，未设置时才回退到 UI 全局进度；实体可独立展开。渲染测试通过 `sceneShell.dataset.unfoldObjects` 观察持久化值和 fallback 值。
- **新鲜证据**：定向测试 **6 个文件 / 28 个测试全部通过**；4 个相关 TypeScript 项目检查全部 exit 0；`npm run lint` exit 0（0 error，13 条既有 warning）。这是自动化闭环证据，不是人工视觉签收。
- **边界**：展开仅支持已有 `polyhedron3`，不声称任意曲面展开或自动选择展开树；Task 15、16、18、19、20、21 不因此升级。
- **提交**：功能提交 `4e0354a` 已推送到 `origin/main`。保留未提交的审查探针和桌面 Cargo 改动；本报告作为四份进度文档之一随区块提交。

## D2｜Task 15 函数公切线（2026-10-16）

- `function.create_tangent` 新增 common anchor：引用另一条显式 `function`，用 `branch: 0/1` 选择两条公切线；真实进入动作解析、编译、patch 提交和 `recomputeCurveTangent`。来源函数更新会重算，删除来源会级联删除。
- 题面解析新增 `commonTangent` obligation，并排在普通函数图像 obligation 之前；独立验证器重新计算候选公切线，检查数量、branch、来源函数、两条曲线相切及直线参数。通过后为 `verified-numeric` / `figure-instance`，不宣称形式证明。
- 支持边界：两条显式 `function`、branch 0/1；圆/椭圆/任意曲线、形式证明、真实模型、人工验收和完整桌面发行仍未做。
- RED→GREEN 与门禁：7 个测试文件 / 138 个测试通过；4 个相关 TypeScript 项目 typecheck exit 0；lint 0 error / 13 既有 warning；diff check 通过。
- **状态**：Task 15 在支持范围内完成。

## E1｜Task 19 实时输出上限（2026-10-16）

- 证明 runner 的 stdout/stderr 改为并行异步流式消费，每路固定只保留最后 4000 字节；不再等 `wait_with_output()` 收集完整输出后再截断。

- 墙钟超时会 kill/reap 子进程，超时和等待错误均不返回半成品证明；成功退出才发布有界尾部。

- 证据：`cargo check --lib` exit 0；`cargo test --lib proof` 2 passed / 0 failed。

- 边界：严格 OS 隔离、真实 Lean 慢集成、桌面 UI/IPC proof 生命周期、发行/安装验收仍未完成。

### F1?Task 16 ?????????2026-10-16?

- ???????????????????????????????????????? mint consent?
- ????? `CandidateRenderEvidencePort`????? `runId`?`draftId`?`draftVersion`?`documentHash`??????? draft ?? renderer ? fail-closed?consent ??????commit ????????????????????? `stale_render`/???????no-op draft ??????
- ??????? 12/12?Task 16 ?????????? 71/71????????? 8/8?Web typecheck exit 0?lint exit 0?0 error / 13 existing warnings?`git diff --check` ???
- ???`structured_only` ?????????????????????????????? WebView/IPC/???????/??????????? Task 16 ?????????
- ????????????? `origin/main`????? Git ???

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


## 2026-10-16 Task 12 functional closure revalidation (current worktree)

**Status: complete within the declared support scope; not a claim that platform-wide visual acceptance or automatic Lean is complete.**

Executable evidence:

1. The real runner path covers candidate generation, isolated draft, confirmation, rejection, and unchanged live document. A mixed point plus sqrt(-x^2) candidate returns rejected/failed_render on confirmation.
2. Layout-model tests cover function samples/tangent endpoints, undrawable functions, function projection overflow, and finite dimensions whose area overflows. Render evidence fails closed on non-finite viewport/box geometry or area overflow.
3. Five targeted Vitest files passed 121/121; solid and function/tangent browser E2E passed 1/1 each; both TypeScript projects and changed-file lint passed.
4. The second independent review found no Critical or Important issue. The only Minor note is the optional promotion of overflow cases into permanent runner-level regression tests.

Boundary: structured_only is not screenshot/DOM/camera/vision proof. This block does not claim all fold problems or all exam variants, and does not change the partial verdicts for Task 20 real-provider evaluation or Task 21 teacher/student acceptance. Automatic Lean remains separately adjudicated.

## Current-HEAD checkpoint (2026-10-16)

The recorded functional blocks above were checked against product code baseline `374bcd4` (including bounded Lean admission); historical checks retain their original baselines.

Current matrix:

- **Complete within declared support scope:** Tasks 1-15, 17 (16 tasks). Task 19 has completed bounded admission/configured-runner sub-scope only.
- **Partial:** Tasks 16, 18, 19 (3 tasks).
- **Not complete / not release-accepted:** Tasks 20, 21 (2 tasks).

The remaining items are not being marked complete by documentation: Task 16 needs candidate visual/3D/human evidence gates; Task 18 needs installed proof lifecycle and release acceptance; Task 19 still needs strict isolation and packaged release validation; Task 20 needs the authorized real-provider quality evaluation; Task 21 needs teacher/student and clean-machine/offline release acceptance. Task 9 human gold remains empty by explicit boundary and is not silently treated as model quality.

Ordinary drawing is adjudicated separately from automatic Lean. The ordinary drawing representative paths are functional within their supported scope. Configured desktop runner evidence now includes successful real Lean execution for all four bounded templates; installed-desktop proof and release claims remain closed. This is the current checkpoint, not completion of the active Goal; no task is promoted from partial or not-complete solely because its documentation exists.


## 2026-10-16 Task 19 current-HEAD bounded desktop admission and real runner smoke

This block records an executable functional change, not a documentation-only review.

- **Admission fix:** desktop Lean input now has positive closed-template admission for the four generated goal families (perpendicular, line-plane perpendicular, tangent slope, and line-in-plane). It binds theorem/report names, imports, heartbeat budget, declared points, repeated statement points, and the finite proof strategy; extra declarations/commands, substituted statements, block-comment wrapping, mismatched reports/imports, and arbitrary proof bodies are rejected before any process or temporary file is created. The old forbidden-token checks remain diagnostics, not the sole boundary.
- **Compatibility evidence:** actual TypeScript adapter output, including renamed identifiers, is snapshotted into `apps/desktop/src-tauri/tests/fixtures/lean-admission.json`; the Rust suite exercises eight real generated fixtures.
- **Fresh verification:** `proof_command` passed **19/19**; the seven proof TypeScript suites passed **97/97** before this block, and the combined admission/pinning/proof/benchmark contract slice passed **145/145**. Typecheck and changed-file lint were also clean.
- **Real configured desktop runner:** with explicit existing `DRAW_LEAN_LAKE` and `DRAW_LEAN_PROJECT`, offline/locked and without downloads, the ignored integration smoke ran all four generated templates through the Rust runner: **1 test passed**, all four Lean processes exited `0`, backend was `Lean 4.35.0-rc3`, and each raw axioms report contained exactly the expected theorem report. Measured durations were 257.961 s (cold first class), 69.156 s, 65.963 s, and 69.486 s. This proves real local execution through the desktop runner; it is not OS sandbox evidence and not installed-desktop release evidence.
- **Acceptance boundary:** Task 19 is **complete for the bounded source-admission and configured local runner scope**. It remains **partial for release acceptance** because OS sandbox testing, clean/offline packaged desktop validation, and an installed UI proof lifecycle are not evidenced here. Automatic Lean remains separate from ordinary drawing.
- **Evidence:** `audit-20261016/task19-real-admission.txt` and `audit-20261016/task19-real-admission.exit`.


## 2026-10-16 Task 9/13 fresh functional closure

- Task 9: 5 files / 92 tests passed; 8 development + 4 held-out offline cases, provenance and anti-leakage, and fail-closed oracle behavior are executable. `verifiedGoldCaseIds=[]` remains a human-gold boundary.
- Task 13: 6/6 browser E2E passed for the folded quadrilateral, frustum, pentagonal pyramid, experiment-off negative path, cylinder and cone display; the original prompt checks seven points, eight conditions, `PC = 4√3`, confirmation, return and undo.
- Evidence: `audit-20261016/task9-task13-functional-20261016.txt`; full fresh logs: `task9-offline-fresh.txt/.exit`, `task13-unit-fresh.txt/.exit`, `task13-browser-fresh.txt/.exit` (all in the same audit directory).

## 2026-10-16 Task 16: live 3D camera evidence regression

Functional defect reproduced before the fix: retained overlay nodes marked `hidden` were counted as visible, and camera-only frames did not trigger React-based evidence measurement. The browser RED independently observed six hidden point labels while evidence incorrectly reported none. Unit RED: 2 failed / 14 passed; browser RED: 1 failed.

The fix excludes hidden labels (including hidden ancestors) and refreshes evidence after actual overlay/WebGL frames, with document-bound subscriptions and cleanup. View-only camera changes do not change document identity. Recovery by Fit View is measured again; 3D evidence remains **partial**, never promoted to passed while object bounds are not measurable.

Fresh GREEN evidence: 5 unit files / **28 passed**; 2 browser files / **9 passed** (real WebGL camera failure/recovery plus proof-unavailable/flag-off paths); workspace typecheck and changed-file lint exit 0. Independent code review against `82dfdca` found no Critical or Important findings and independently reran 16/16 changed-file unit tests.

Logs: `audit-20261016/task16-camera-{red,green,browser-red,browser-green,typecheck,lint}.txt` and matching `.exit` files. RED logs deliberately have nonzero exits; they are reproduction evidence, not current failures.

**Acceptance boundary:** Task 16 stays partial: candidate pre-confirmation visual gating, complete WebGL object measurement, installed-desktop evidence and independent human readability are not established by this block. Task 18 browser downgrade is verified but installed real-Lean lifecycle is not. Current whole-card totals remain **16 complete (1-15,17), 3 partial (16,18,19), 2 not complete / not release-accepted (20,21)**. Task 19 bounded admission/configured runner success is a completed sub-scope, not completion of the whole card. The Goal stays active.


## 2026-10-16 Task 18 live proof freshness and native desktop lifecycle

- **Functional defect reproduced and fixed:** after a real desktop Lean acceptance, confirming 19 objects and undoing to zero previously left the transcript saying the restricted lemma was proved for the current canvas. Proof messages now retain their historical backend result but derive freshness from the pinned base/candidate document identity and semantic content hash. Undo, edits, document replacement, and legacy messages without a binding fail closed as stale; redo of exactly the bound content restores the historical display without claiming a new Lean run. Backend version and proposition input hash are visible.
- **Real Windows desktop evidence:** a release binary built from the current source with the isolated `com.mathcanvas.audit.task18` identity (not the standard installer) and no configured provider ran the local planner through the actual Rust/Lean child process. The native UI reported `Lean 4.35.0-rc3` and proposition hash `70d0cdd3851789e4ac8c02abdb5d94c36ee1a42b37b5a6b08c89a5dba4e3b037`, restricted-lemma acceptance, confirm -> 19 objects, undo -> 0 objects, and then stale in the transcript. The theorem remains a restricted lemma, not a proof of the whole question.
- **Verification:** initial production-wiring regression tests failed before the fix; four focused suites / 88 tests then passed, typecheck and changed-file lint exited 0, browser proof lifecycle 2/2 passed, and the isolated release build exited 0. Native UI captures are `audit-20261016/task18-native-fixed-{settings,flag,during,result,confirmed,undo,stale}.txt` and `task18-native-fixed-processes.json`; automated evidence is `task18-live-proof-{red,green,typecheck,lint,browser,desktop-build}.txt/.exit`.
- **Separate release blocker found:** the real desktop still reports a local-project save failure (`no document ... in project local`) after changing workspace. This is not hidden by the proof success and will be handled as a separate persistence block.
- **Boundary:** Task 18's configured native proof/confirm/undo/freshness path is evidenced. Task 18 remains partial pending standard packaged/clean-machine release acceptance. Task 19 remains partial (no OS sandbox or packaged release evidence). Overall adjudication remains **16 complete / 3 partial / 2 not complete or not release-accepted**; no human gold or teacher/student acceptance has been fabricated.
- **Evidence hygiene:** existing tracked BOM/UTF-16 evidence and two BOM-prefixed test files were normalized to UTF-8 without BOM, without relaxing the repository's hygiene gate or changing test semantics.


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

## 2026-10-16 Task 20 coordinator-driven evaluation engineering

- **Product path, not a parallel repair simulation:** the shell-triggered exam run now selects `repairPath: coordinator-driven` and uses the real `createAgentRuntime`, coordinator, observer, tools, staging and geometry compiler. The historical adapter still defaults to `not-driven` for compatibility. Each case starts with isolated empty workspace documents; it never grants commit consent, rejects document writes, and discards the preview afterward. Experimental compile flags are explicit; user preferences and automatic Lean are not enabled implicitly.
- **Functional repair and truthful verdicts:** regressions exercise schema repair, real compile-diagnostic repair, cross-workspace staging, answer/clarification, native read-tool continuation, and retry paths. Missing facts cannot become `planned`; schema/compile/verification failures remain distinct. A successful compile must also pass diagram verification and reach the real `awaiting_confirmation` phase. Cost callbacks receive every planner attempt, not just the final repaired plan.
- **Authorization is unchanged:** coordinator repairs, transport retries and native read-tool continuations share the outer request cap without charging a reserved transport twice. The frozen authorization remains **36 actual provider requests / $12 declared maximum**; it is not expanded to make a 36-logical-trial report look complete. When one repair consumes one of those 36 requests, the remaining logical trial is denied and evaluation does not pass. Without a price table, `costUsd` stays `null`; this is not a demonstrated real-time dollar stop-loss.
- **RED to GREEN and current checks:** the initial coordinator suite reproduced **4 failed / 2 passed**; the shell suite reproduced **2 failed / 2 passed** before enabling this path. Final focused tests: **4 files / 56 passed**; fresh precommit run including four documentation-consistency suites: **8 files / 68 passed**, exit 0 (`task20-precommit.txt/.exit`); full unit suite: **404 files / 4710 passed / 1 todo**, exit 0. Typecheck exit 0; lint **0 errors / 13 pre-existing warnings**. All-workspace production build, including the desktop executable, exited 0 on the final unlocked rerun.
- **Build evidence correction:** `task20-build.txt/.exit` actually records exit **1**, caused by the isolated audit executable holding the release file open. It is retained as a failure, not cited as passing. After verifying the executable path and audit PID, only audit process 55192 was stopped; the user's original process 7920 was untouched. `task20-build-unlocked.txt/.exit` records the subsequent exit 0. Existing Vite size/dynamic-import and linker warnings are retained.
- **Independent review:** a bounded read-only review of the eight source/test files against `6b10196468b7631e0f88713c0718ee552970e5b8` found no remaining Critical/Important issue. The reviewer inspected behavior/call paths but did not independently rerun the checks; see `audit-20261016/task20-coordinator-review.md`.
- **Evidence:** `audit-20261016/task20-{coordinator-red,shell-red,focused,full-unit,typecheck-final,lint-final,build,build-unlocked}.txt/.exit`; permanent tests are `examRunCoordinated.test.ts` (15), `examRunCli.test.ts` (4), plus existing adapter/runtime suites (7/30).
- **Acceptance boundary:** these are synthetic provider-response engineering smokes through the real product coordinator, **not** a new real-provider quality run or frozen 12 x 3 gold evaluation. `verifiedGoldCaseIds=[]`, human readability and dollar cost remain unmeasured. The previous installed-product real-provider failures remain valid historical measurements; `bench:agent --mode=real_provider` is still `not_measured`. **Task 20 remains not complete as a whole; the matrix stays 16 complete / 3 partial / 2 not complete or not release-accepted.** Task 16 visual/human gates, Task 18/19 installed real-Lean lifecycle/distribution, and Task 21 clean/offline/teacher/student acceptance are not passed by this block.

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
