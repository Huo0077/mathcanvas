# G3-DS Failure-Driven Implementation Plan

> **2026-11-17 Task 6 新证据（非退出）**：用户新授权的 `92981ebd` 强制DS冻结36题运行完成，77请求，数学合同0/36、1 partial、35 failed，2题非空候选；混合读/提交工具批次0，仍卡模型施工单实体/参数/格式。见[脱敏审计](../../audit/2026-11-17-g3-ds-live-retest-92981/README.md)。不将Task 6勾选为退出；新付费修复回归必须重新授权。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把冻结36题真实DS强制规划从当前合同0/36，按可追责失败边界修到同候选数学/证书/渲染/受控交付36/36；新题另计，不能保证任意新题100%。

**Architecture:** 在现有 `modelPlanner` 增加基于空场景/已有对象的分阶段工具发布；以脱敏 `G3CaseTrace` 跨层观察；`DsDrawingIntent` 缺必要数学参数即拒绝，不凭默认值生成错误图；评测入口复用已有 scoped/state/branch 合同与同版候选证书/真实渲染接口。各任务先完成零付费负例与回放，通过授权闸后才实测 DS。

**Tech Stack:** TypeScript、React/Three.js、Vitest、Playwright、Tauri 原生 provider 通道与当前 `agent-core`/`geometry-kernel`；不新增运行时依赖。

**Spec:** `docs/superpowers/specs/2026-11-17-g3-ds-failure-driven-design.md`；旧 `2026-11-16-g3-ds-live-upgrade-plan.md` 的 DS0–DS4 审计为历史，DS5 原未退出，本文为从 `f7cc9b76` 起的实施入口。

## Global Constraints

- 固定36题/18平面+18立体；真题合同 SHA-256 `c3671cc8196ebcded7e0bd53a6fd7160593506b6aad04719a636b5becb050a6d`；评测出口不得删除难题、放宽容差或以 partial/unknown/waiting 冒充通过。
- 历史强制DS报告 `0 passed / 3 partial / 33 failed`、10题有候选、26题零候选、7个混合工具题、93请求/91次usage 永不改写；新结果追加 revision/profile/路由/题集 hash 与独立口径。
- 冻结合同只供终判；不能向模型/构造器泄漏标准答案，不允许 `id` / 原题文本查表返回固定坐标。错误归因有证据才定性；`unclassified` 不可写成“DS不会数学”。
- 新付费测试必须重新明确模型、题集、最大请求/每题、token/美元上限与停止条件；历史4次预检和93次整批均已用完。保存凭据只走桌面原生链；不可输出/提交密钥、原始模型内容、题干及敏感请求。无授权本计划只运行无费回放和单测。
- 原有手工作图、确定性优先路由、草稿确认/撤销/重载、混合工具原子拒绝、CAS 和证书保鲜必须继续通过；不可拿浏览器 mock/历史离线截图当DS live同候选验收。
- 每完成一个可验收区块：RED→最小改动→定向GREEN→相关回归→独立反例复核→`docs/current-status.md` 与过程/计分/门禁对齐→commit→push→`HEAD...origin/feature/drawing-reliability-execution` 为 `0 0`。人工可读性与Windows桌面实机窗口仍单列，不代签。

---

## Task 0 — DS5 负例真源与阶段码，先补可观察性（零付费）

**Files:** Create `apps/web/src/agent/fixtures/g3DsCaseTrace.ts`, `apps/web/src/agent/fixtures/g3DsCaseTrace.test.ts`; Modify `apps/web/src/agent/fixtures/examRunCoordinated.ts`, `apps/web/src/agent/modelPlanner.ts` 的可注入诊断出口；Create `docs/audit/g3-ds-failure-driven-t0/README.md`。若临时运行器不属于产品依赖，把其脱敏转换逻辑抽到 fixture，不把 `eval-results` 的原始报告入Git。

**Interfaces:** `G3Boundary = "provider" | "tool_protocol" | "schema" | "dag" | "stage" | "verification" | "contract" | "render" | "delivery"`; `G3CaseTrace = {caseId, runId, revision, candidateHash?, modelInvoked, requests:[{index, toolNames:string[], responseKind, usageKnown}], firstFailure?:{boundary:G3Boundary, code:string, fieldPath?:string}}`；公开 `recordBoundary(trace, event)` 只记录闭集码/路径/工具名，报告 `explainFirstFailure(trace)` 返回第一个能证实的阶段，否则 `unknown`。**不得**用解析模型正文推断原因码。

- [x] **输入审计**：逐题核查R4的 `GK-S02/GK-S03/JT-S06/JT-S07` 对题图的依赖；无用户核对的必要题图则登记 `input_figure_missing` 并阻断完整通过，不凭题号或历史答案补图；题图经用户补全后固定版本/hash且分母仍为36。历史纯文字实测不改写。
- [x] **RED**：在 `g3DsCaseTrace.test.ts` 用 GK-S08 的 `['scene_inspect','plan_set_plan']` 验证首失败 `tool_protocol/mixed_read_plan`；用 GK-P03 的 `cross_scope_violation` 保留字段路径；含 `prompt` / `apiKey` / `toolInput` 的序列化写入必须拒绝。Run: `npm.cmd exec -- vitest run apps/web/src/agent/fixtures/g3DsCaseTrace.test.ts --testTimeout=30000`；预期新增测试失败。
- [x] **最小实现**：使用明确的字段白名单组装，不传任何原始对象；把 `modelPlanner` 的 `onDiagnostic` 改为另可注入的结构化错误出口，保持旧诊断/错误兼容。重复失败不覆盖首次失败、请求序号与原生 usage 缺失分别记录。
- [x] **GREEN及反例**：同上命令通过；跑 `apps/web/src/agent/modelPlanner.test.ts` 与 `apps/web/src/agent/fixtures/examRunCoordinated.test.ts`；对36条旧脱敏记录建立阶段覆盖表，无法定位的写 `unknown`，**不能承诺全部旧记录都能追溯**。结束该区块同步文档、提交推送；不调用真实DS。

## Task 1 — 空场景构造与已有场景观察分流（零付费）

**Files:** Create `apps/web/src/agent/modelToolPolicy.ts`, `apps/web/src/agent/modelToolPolicy.test.ts`; Modify `apps/web/src/agent/modelPlanner.ts`, `apps/web/src/agent/modelPlanner.test.ts`, `apps/web/src/agent/agentRunner.ts`, `apps/web/src/agent/agentRunner.test.ts`; Create `docs/audit/g3-ds-failure-driven-t1/README.md`。

**Interfaces:** `selectToolPhase(input:{intentMode:"ds_intent"|"legacy_actions", hasExistingGeometry:boolean, hasSelectedRefs:boolean, requiresSceneObservation:boolean, observationCompleted:boolean}):"construct"|"observe"`。DS空白文档且无外部引用时 `construct` 仅发布 `plan_set_plan`；已有画布需读取则 `observe` 只发布只读工具，回传后单独 `construct`。`legacy_actions` 原路由必须兼容；非法工具或混合批仍由旧原子拒绝规则拦截。

- [x] **RED**：新单测先用冻结 GK-S08 同型的空文档（不是题号判断）断言首请求 `tools.map(t=>t.function.name)` **只有** `plan_set_plan`，而有已选实体的文档首轮只能读；已有 `modelPlanner.test.ts` 的混合批次 `executeTool` 零调用断言保持。Run: `npm.cmd exec -- vitest run apps/web/src/agent/modelToolPolicy.test.ts apps/web/src/agent/modelPlanner.test.ts --testTimeout=30000`；新用例先失败。
- [x] **最小实现**：`agentRunner` 从真实 `DocumentHandle`、当前文档图元/选区计算场景上下文并传到 planner，不用 `case.id`/关键词；`modelPlanner` 在每次请求前选互斥工具集，不把 `scene_inspect` 与 `plan_set_plan` 同时发给DS。仅在观察真的完成且预算足够后进入构造阶段。空场景不扣无意义场景读取请求。
- [x] **GREEN及负例**：同上再跑 `apps/web/src/agent/agentRunner.test.ts`；复播7个已知混合题的工具批次，区分“旧批次仍应拒绝”和“新工具表不诱导旧批次”；断言用户取消、无预算、重复callId和已有场景中只读工具在观察阶段都 fail-closed。同步文档、提交推送；此项**不能仅凭回放声称DS live7题获救**。

## Task 2 — 施工单数学参数来源与编译 fail-closed（零付费）

**Files:** Modify `packages/agent-core/src/dsDrawingIntent.ts`, `packages/agent-core/src/dsDrawingIntent.test.ts`, `apps/web/src/agent/systemPrompt.ts`, `apps/web/src/agent/modelPlanner.test.ts`; Create `docs/audit/g3-ds-failure-driven-t2/README.md`。

**Interfaces:** `validateRequiredParameters(intent): {ok:true}|{ok:false,code:"missing_required_parameter"|"unsupported_construction"|"unproven_parameter",path:string}`；每个数学必要参数有题设 sourceSpan/合法推导/显式可审查假设，缺失不得以默认 `"x"`, `0`, `[-5,5]` 替换。显示宽高/相机仍可合理默认但不能影响合同数学语义。`compileConstructionDag` 失败直接返回带 `cyclic_dependency/missing_host/cross_scope_violation` 的拒绝，不能退回原始顺序。

- [x] **RED**：分别对 `function_curve_and_tangent` 缺 `expression`、`x0`、`domain` 写负例，必须拒绝或澄清，不可生成看似有效直线；对有合法原文参数的切线作正例；DAG环/错宿主/跨问引用必须失败。Run: `npm.cmd exec -- vitest run packages/agent-core/src/dsDrawingIntent.test.ts --testTimeout=30000`；先观察负例失败。
- [x] **最小实现**：建立每种 `DS_CONSTRUCTION_STRATEGIES` 所需参数表与来源规则，沿现有 `DsSourceSpan`/`givenRelations` 验证；编译遇缺参返回结构化拒绝并保留已有安全澄清语义。对应提示从“请猜坐标”改为“缺参先指出来源”，不新建外部CAS。
- [x] **GREEN及反例**：同上、`packages/agent-core/src/planCompiler.subquestionCoverage.test.ts`、`apps/web/src/agent/modelPlanner.test.ts` 与 `npm.cmd run typecheck`；复核 GK-P08 `objCov=1, obCov=0` 的有图不正确负例。同步文档、提交推送。此阶段可能使有候选题减少：**不能把减少候选误报为能力退化或改善，必须按正确率分项披露**。

## Task 3 — 用26题零候选与10题错误候选驱动能力族（零付费回放，付费另授权）

**Files:** Modify `packages/agent-core/src/dsDrawingIntent.ts`, `packages/agent-core/src/drawingIntent.ts`, `packages/agent-core/src/solver/` 中经 Task 0 证实缺口的具体文件、对应 `.test.ts`；Extend `packages/agent-core/src/verification/drawingCertificate.test.ts`; Create `docs/audit/g3-ds-failure-driven-t3/README.md`。

**Interfaces:** 合法 `DsDrawingIntent` → 带来源与 scope/state 的可执行 `PlanEnvelope` → 独立候选及 `failedObligations`。每次只修一个按条件签名归组的实际失败，模型不接触黄金答案。首批基准：GK-S05（立体27图元，0.667/0.714），GK-P03（7图元，0.25/0.125），JT-P02（5图元，0.167/0）；GK-P08（2图元、对象覆盖1、义务0）作“表面齐全”反例。对其余零候选若尚无结构化施工单，先留 Task 0 边界，不能硬写算法。

- [x] **RED**：以首批三个题的失败义务种类构造**非题号化**相同几何关系测试（输入可变参数、对象改名），断言缺实体/错误长度/错误关联/错scope仍被证书及独立合同拒绝；保留这三个历史失败数据不修改。
- [x] **最小实现**：把 `givenRelations` 中已验证的长度/交点/拓扑/切线/折叠条件送进现有相应求解器，按依赖顺序物化需要的命名实体；求不到值或条件矛盾须披露 `not_supported/infeasible`，不返回空动作假成功。优先解决证实的共同原因；不因 GK-S05 题号写特殊坐标。
- [x] **GREEN及反例**：对相关 `.test.ts`、`scripts/reliability-eval/drawingContracts.test.ts` 跑定向 Vitest，检查已通过原样本和参数变体；`partial` 只在全体必要义务和对象、证书均过后升格，记录当前仍失败的case ID。每个能力族独立审计/进度/提交推送，不等待全部36题才保存负面证据。

## Task 4 — 多问/多状态/多分支的同版评测入口（零付费）

**Files:** Create `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts`, `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts`; Modify `apps/web/src/agent/fixtures/examRunCoordinated.ts`, `scripts/reliability-eval/drawingContracts.ts` **仅接口编排不改容差**； Extend `scripts/reliability-eval/drawingContracts.test.ts`; Create `docs/audit/g3-ds-failure-driven-t4/README.md`。

**Interfaces:** `runFrozenDsCase(publicCaseInput, provider, budget)` 输出 `{candidateSet:{scopeId,stateId?,branchId?,candidateHash,certificateStatus}[], modelInvoked, contractStatus, renderStatus:"pending"|"passed"|"failed", commitStatus:"pending"|"passed"|"failed"}`。按 `displayPolicy` 将 `enumerate:before_fold,after_fold` 等需要多候选的题分别验证；使用既有 `evaluateDrawingContractScopes`, `evaluateDrawingContractStates`, `evaluateDrawingContractBranches`；不再仅因 `MODE === "local"` 才看子计划。只投影 `{id,prompt,confirmedFigureRefs,workspace}` 给 `createModelPlanner`，黄金合同/标准坐标只传给独立裁判，断言任何 `requiredObligations`/`expected` 不得出现在请求中。多分支中只生成一个合法结果也不得算整题通过。

- [x] **RED**：用 GK-S02/JT-S04 前后折叠状态、JT-S08 两参数分支、GK-P06 三支切线设计正负输入；删除一支、交换 stateId、只画公共主图、修改 candidateHash 必须失败。旧单候选路径的 0/36 原始报告不变。Run: `npm.cmd exec -- vitest run apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.test.ts scripts/reliability-eval/drawingContracts.test.ts --testTimeout=30000`；新用例先失败。
- [x] **最小实现**：从同一次合法施工单按 scope/state/branch 生成隔离候选集合，逐份完整证书，然后按原合同聚合；不要向模型回填题库标准构造。若一个候选数学正确但生产证书未过或绑定旧 hash，整题仍失败。
- [x] **GREEN及对照**：同上，`npm.cmd run typecheck`，再跑零付费 replay 中新旧入口分歧清单；人工复核差异以防错放，绝不“重新解释”历史0/36。同步文档、提交推送。

## Task 5 — 同一真实DS候选的浏览器和隔离交付门禁（零付费桥接，真实调用另授权）

**Files:** Modify `packages/agent-core/src/dsCandidateBundle.ts`, `apps/web/src/agent/hostBridge.ts`（仅在现有接口证据不足时）； Extend `e2e/drawing-reliability-36-render.spec.ts`, `e2e/drawing-reliability-lifecycle.spec.ts`; Create `docs/audit/g3-ds-failure-driven-t5/README.md`。

**Interfaces:** 延用 `mathcanvas.ds_candidate_bundle.v1` 的 `{runId,candidateHash,documentHash,cameraHash,viewportHash}`；证书与浏览器截图同版；隔离临时工作区模拟用户明确确认、撤销、重开。没有 DS 真实候选时只能标 `bridge_replay_passed` 而非 `dsLiveRendered`。`humanReviewed` 默认 pending，AI审阅与用户/教师签收分列。

- [x] **RED**：混入旧离线36题截图/旧证书、缺图元、可见但条件未过、换相机不更新 hash、未确认仍写主画布必须失败；Run: `npm.cmd exec -- playwright test e2e/drawing-reliability-36-render.spec.ts e2e/drawing-reliability-lifecycle.spec.ts --workers=1 --retries=0`，目标新增反例先失败。（已完成先红校验：`dsCandidateBundle.test.ts` 新增 `classification` / `trace_candidate_hash_mismatch` / `stale_camera_hash_after_orbit` / `unconfirmed_write_to_main_canvas` 反例先红，`e2e` 新增 3D 相机拖动校验未配 `geometry3d` 与 `[data-3d-scene="true"] canvas` 前先失败。）
- [x] **最小实现**：让 `G3CaseTrace` 的候选版本与 DOM `data-candidate-hash` 绑定，真实 DS 同一候选数学/生产证书双过后才进入浏览器；隔离工作区单次提交+撤销/重开通过后单列交付率。禁止批量替真实用户确认正式文档。（已实现 `dsCandidateBundle.ts` 的 `traceCandidateHash`、`DsRenderDeliveryClassification` (`bridge_replay_passed` vs `dsLiveRendered`)、相机滞后与未确认写入主画布拦截，`drawing-reliability-36-render.spec.ts` `3D` 相机拖拽与 `manifest.json` 保守标注，`drawing-reliability-lifecycle.spec.ts` 撤销/重做/重载闭环。）
- [x] **GREEN及证据**：目标 Playwright 0重试，全量关键浏览器回归；36题人工可读性还没签时显示 `pending`，警告逐题保留。同步文档、提交推送。（`dsCandidateBundle.test.ts` `3 passed`；Playwright `--workers=1 --retries=0` `41 passed`；`manifest.json` 已标 `dsRenderGateStatus: "bridge_replay_passed"` 与 `humanReviewed.status: "pending"`；全仓 `npm test` `550 files / 5847 passed | 1 todo`、`typecheck`、`lint`、`test:rust` 与 [Task 5 审计](../../audit/g3-ds-failure-driven-t5/README.md) 全部通过。）

## Task 6 — 分层真实DS复测和最终退出（需要新的独立付费授权）

**Files:** Modify `apps/web/src/agent/fixtures/g3DsFrozenCaseRunner.ts`（预算/报告）；Create `docs/audit/g3-ds-live-retest/README.md`、脱敏逐题结果； Update `docs/current-status.md`, `docs/project-progress.md`, `docs/agent-next-round-progress.md`, `docs/acceptance/agent-tool-loop-scorecard.md`, `docs/acceptance/agent-release-gate.md`、实施主入口中G3门禁引用。

- [ ] **先获授权，不复用前两次预算**：固定 revision+题集 hash、`deepseek-v4-flash` profile版本、预检题/整批分母、最大请求与单题上限、每次输入大小/输出 token、美元上限、价格来源及异常中断策略；若官方价目表无法核对或隐藏计费不可上界则不开始，服务商账单不由应用硬性保证。缺任何项时0请求；服务商未报真实账单写 `unknown`，不能写0。
- [ ] **梯度试点**：第一批 GK-S08 + 一个以前零候选立体 + GK-S05 + GK-P03（覆盖工具协议、立体、错误候选）；若混合工具/空白读场景、证书假阳性或费用硬闸重现，停批，回对应 Task；下一批验证平面/立体/折叠分支，达标后才开冻结36题整批。
- [ ] **全题验收**：对36个固定ID逐题给出 DS 已实际参与、首轮与修复后合同、生产证书、同一候选真画布、隔离受控提交/重开的证据，完整端到端必须36/36； `not_supported`, `partial`, `waiting`, 只见图不对都计失败。没有DS候选的题不能偷用确定性路由补分子；每题请求数与总账一致，缺usage/价格另列。
- [ ] **发布后置**：未见题/真实题图另测并披露分母，不能把冻结36/36宣称任意新题100%；人工可读性、Windows交互式桌面窗口与发布/回滚单列签收。复核敏感信息、按区块提交推送、远端一致后才更新 G3-DS 已退出状态。

## 自审：重点拒绝的错误“提效”

- 只加重试、删掉7个混合工具负例、改名绕过 DS 路由、按题号插标准坐标、将 `prompt`/模型原文提交Git、给模型黄金合同、强行把多状态折成一张图、用离线截图顶替真实DS候选、把价格上界写成实际账单，全部拒绝。
- Task 0–5 实施代码/测试/文档时本地零新增付费请求；Task 6 的真实费用经用户新授权后才能触发。任何新的“完成”声明必须附同一 revision 的测试运行记录；原有 DS0–DS4 的已完成状态不自动等于本计划任何一项已完成。
