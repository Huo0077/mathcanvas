# G3 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前 `feature/drawing-reliability-execution` 分支完成 G3-Math 与 G3-UX 的真实验收，不以 T01–T14 的提交记录替代 36 题退出证据。

**Architecture:** 沿用既有 ProblemContract/ObligationIR、确定性构造器、独立证书、草稿确认和真实画布证据。生产与离线评测共用决策入口，黄金合同只作独立裁判，不反向给构造器提供答案；按失败族最小闭环，避免新建第二套引擎。

**Tech Stack:** TypeScript、React、Three.js、Vitest、Playwright、Tauri/Rust；不新增 CAS、SMT、provider 或运行时依赖。

**Spec:** `docs/superpowers/specs/2026-11-15-drawing-reliability-design.md`；执行合同为 `docs/superpowers/plans/2026-11-15-main-restart-master-plan.md`、`2026-11-15-drawing-reliability-repair-plan.md`、`2026-11-15-drawing-reliability-execution-handbook.md` 和 `2026-11-15-implementation-task-ledger.json`。

## Global Constraints

- 固定分母为 36（平面 18、立体 18）；`partial`、`unknown`、澄清、不可行披露、未运行均不冒充完整通过。
- 不按题号硬编码，不删除失败样本，不放宽数学判据或截图阈值，不用 mock/结构化估计冒充真实桌面或渲染。
- 每块遵循 RED → 最小实现 → 定向 GREEN → 回归 → 独立复核 → 证据/活动文档对齐 → commit → push → 核对远端。
- 活动状态只维护 `docs/current-status.md`；`docs/project-progress.md` 只追加过程，`docs/agent-next-round-progress.md` 只维护下一步导航；同步主计划、P0–P8 附录、release gate 中受影响的“当前状态”文字，历史证据不改写。
- 不进入 P8，不进行付费 provider 请求，不合并 main，不发布产品；RustSec 既有 `unknown` 不得写成无风险。
- AI 的截图审查只能记为 `agent_visual_review`，不能冒充用户/教师人工签收。没有必需的人工或桌面证据时不得宣布 G3 完成。

## Review Focus

- 多问/多 scope：公共条件与局部条件不得互相污染；Task 2、3、4 分别用跨 scope 反例固定。
- 合同与生产校验分叉：独立合同正确的图不能靠自报 `passed` 放行，也不能因未接证书误报完成；Task 2 用 GK-P01 回放和伪造证据负例固定。
- 有图元但条件不完整：Task 3、4 每题同时断言对象覆盖与义务覆盖，不只断言 `draft` 存在。
- 画布与候选不同版：Task 5 断言截图、渲染测量、document/candidate hash 一致，并覆盖相机变化。
- 迟到/重复交互与存档破坏：Task 6 断言 sceneWrites、一次确认、撤销/重做、重载及证书失效，保留原稿。

## 当前实核基线（Task 1 必须保存，不得抹除）

2026-11-16 在 HEAD `8c26544c0d440c1605b1fbc7c677bbd3783277fe` 执行：

```bash
npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json
```

Vitest 驱动本身 `1 file / 3 tests passed`，但冻结合同结果为 **2 passed / 10 partial / 24 failed / 0 incomplete**，`meanObjectCoverage=0.2800925925925926`、`meanObligationCoverage=0.25667989417989423`。证据：`eval-results/reliability/offline-2026-11-16T04-29-01.189Z-40284/`（忽略目录，审计中保存最小汇总与索引）。

已观察两类差异，实施前仍须逐层确认，不能据此批量猜修：

- `GK-S02`：`routeDeterministicProblem(prompt)` 无路由，回退 `createLocalPlanner()` 后 `waiting`，问题文本为“本地规划器无法识别”，零图元。
- `GK-P01`：独立合同对象/义务覆盖均为 1，但最终 `verificationStatus=not_supported`、无草稿，说明生成结果与生产完整验收尚未闭环。
- 第二独立 reviewer 已逐题复核36/36，结论为 `changes_required`：仅 GK-P08 作图数学合同可批准，其余35题须整改。Task 1 不得以“已完成审阅”代替“复核通过”；先保存并推送否定性审计 checkpoint，再继续同一 Task 1 的合同/评测语义 RED→GREEN 整改，T01/P0 保持未退出。证据：`docs/audit/2026-11-16-g3-truth-baseline/README.md`。
- 第一批合同安全整改已完成并验证：不可行伪造、双scope、JT-S02目标/题设、结构谓词、GK-P04/JT-P04数学错误及函数/直线绑定。最新36题为1 passed/10 partial/25 failed；这是补齐漏检后的诚实下降。T01仍未批准，继续剩余关联义务、拓扑、显示策略和统一scope入口。证据：`docs/audit/2026-11-16-g3-contract-safety/README.md`。
- 第二批拓扑与宿主整改已完成并验证：闭合/开放拓扑、共面、线段域、垂足第二方向、棱柱对应向量及GK-P01/P02、JT-P02/P07关联义务；定向25项、全量540文件/5721通过+1todo。T01仍未批准，下一步处理JT-P08定义域/分支及其余合同。证据：`docs/audit/2026-11-16-g3-host-topology/README.md`。
- 第三批定义域与切线整改已完成并验证：JT-P08排除点与双分支、JT-P09圆上/弦/面积、函数符号导数与圆锥代数切线；定向29项、全量540文件/5725通过+1todo。最新36题为0 passed/11 partial/25 failed，旧JT-P08因漏排除点不再通过。T01仍未批准，继续其余合同及生产支持。证据：`docs/audit/2026-11-16-g3-domain-tangent/README.md`。

- 第二轮独立 reviewer 逐题复核36/36，结论为4题可批准、32题需整改；T01仍未关闭。已针对 GK-P03 最优直线、GK-P06 三分支、JT-S04 真实旋转夹具和 JT-S09 闭合拓扑实施修正，仍须复审。最新离线结果为0 passed/12 partial/24 failed，生产未路由失败不能由合同GREEN抵销。证据：`docs/audit/2026-11-16-g3-contract-review-r2/README.md`。

- scope/实体试点已完成：JT-P05/P08 显式继承并绑定实际曲线，JT-S01 父条件与局部球O分离，函数切线拒绝退化；四类反例 RED→GREEN。其余合同推广、指定拓扑和折叠谱系仍在 Task 1，最新离线0/12/24不变。证据：`docs/audit/2026-11-16-g3-scope-entities/README.md`。

- 公共曲线整改已完成：前问确定的共享曲线按 stem 实核并绑定命名实体，GK-P02 补交点互异；跨问错曲线、匿名替身和不可行披露搭配错误 C 均成为反例。离线0/12/24不变，下一区块为指定拓扑与折叠谱系。证据：`docs/audit/2026-11-16-g3-shared-curves/README.md`。

- 指定拓扑区块完成：14个可确定合同绑定顶点与面环，GK-S03四面体反例先RED后拒绝，GK-S09/JT-S09补辅助命名。最新离线0/11/25，对象/义务覆盖约23.50%/20.39%；未提供题图不猜面环。下一区块为fold-transform跨状态谱系。证据：`docs/audit/2026-11-16-g3-named-topology/README.md`。

---

### Task 1: G3 真相基线、T01 第二独立审题与文档纠偏

**Files:**
- Create: `docs/audit/2026-11-16-g3-truth-baseline/README.md`
- Modify: `docs/current-status.md`
- Modify: `docs/project-progress.md`
- Modify: `docs/agent-next-round-progress.md`
- Modify: `docs/superpowers/plans/2026-11-15-main-restart-master-plan.md`
- Modify: `docs/superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md`
- Modify: `docs/superpowers/plans/2026-11-16-g3-completion-plan.md`
- Review: `test-fixtures/reliability/drawing-contracts-36.json`
- Test: `scripts/reliability-eval/drawingContracts.test.ts`

**Interfaces:**
- Consumes: `ContractSuiteFile.independentReviewStatus`、`DrawingContractCase.requiredEntityIds/requiredObligations/sharedScope/subquestions`。
- Produces: 版本化 T01 复核记录与真实 G3-Math 基线；只有逐题复核无未解决错误后才允许把 suite/case 的 `independentReviewStatus` 改为 `"approved"`。

- [ ] **Step 1: 固定当前失败证据并核对分类**

保存上述命令、退出码、revision、2/10/24/0 和分类计数；逐题区分“无确定性路由”“候选生成但生产核验未闭环”“合同或实现数学错误”。不得把 Vitest 驱动的 3 项通过写成 36 题通过。

- [ ] **Step 2: 独立复核 36 份合同**

使用 `superpowers:requesting-code-review` 的独立复核流程，让未参与合同撰写的 reviewer 逐题对照 `docs/audit/2026-11-15-drawing-baseline/manifest.json` 与 `test-fixtures/reliability/drawing-contracts-36.json`：原文/hash/sourceSpan、对象、公共/局部 scope、可行/不可行分支、自由值与显示要求。发现错误先加能复现该错误的合同测试并修正，不能由作者自签第二位 reviewer。

- [ ] **Step 3: 验证合同与文档一致性**

Run: `npm.cmd exec -- vitest run scripts/reliability-eval/drawingContracts.test.ts scripts/docs-consistency --testTimeout=30000`
Expected: 全部通过；`pending_second_reviewer` 只有真实复核完成后才改变。

- [ ] **Step 4: 对齐活动文档并推送此区块**

明确区分“B4/T01–T14 工作包已有提交”与“G3-Math 尚未退出”；修正 `current-status.md` 后半部仍写“下一步 T04”等陈旧内容。审计保存独立 reviewer 身份、结论、未解决项与证据索引。提交 `test(eval): establish independent G3 math baseline`，推送并运行 `git rev-list --left-right --count HEAD...@{upstream}` 确认 `0 0`。

### Task 2: 生产完整证书与统一评测入口闭环

**Files:**
- Modify: `packages/agent-core/src/verification/drawingCertificate.ts`
- Modify: `packages/agent-core/src/planCompiler.ts`
- Modify: `packages/agent-core/src/problemContract.ts`
- Modify: `packages/agent-core/src/committerAdapter.ts`
- Modify: `apps/web/src/agent/agentRuntime.ts`
- Modify: `apps/web/src/agent/agentRunner.ts`
- Modify: `apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts`
- Test: `packages/agent-core/src/verification/drawingCertificate.test.ts`
- Test: `packages/agent-core/src/verification/drawingMutation.test.ts`
- Test: `apps/web/src/agent/drawingCertificateStaleness.test.ts`

**Interfaces:**
- Consumes: 既有 `certifyDrawingAgainstContract(input): DrawingCertificateResult`、`buildProblemContract(...)`、`verifyCertificateFreshness(...)` 和 `CandidateRenderEvidencePort`。
- Produces: 生产 stage/确认使用的同一 `DrawingCertificateResult`，含独立 coverage、绑定、policyVersion 与 freshness；禁止从 36 题 fixture 向生产构造器或证书注入预期答案。

- [ ] **Step 1: 写生产接线 RED**

以 GK-P01 的独立正确候选为回归：证明仅调用证书函数与真实 stage 不同；补伪造自报 passed、空合同、漏 scope、过期候选和非有限坐标负例。测试必须先在现有生产入口重现 `not_supported`/未接线，而不是直接调用新函数制造假红。

- [ ] **Step 2: 确认根因后最小接线**

Run: 上一步定向 Vitest，记录实际失败原因。
Expected: 生产入口未消费完整证书或错误使用旧 host 结论被明确复现。
Implementation: 沿现有 stage → draft.preview → consent 链传递并核验 `DrawingCertificateResult`；生产合同来自原题/已确认题图，不读取黄金答案。保持非画图问答豁免和 `enableCompleteCertificate=false → unverified`。

- [ ] **Step 3: 定向与统一评测验证**

Run: `npm.cmd exec -- vitest run packages/agent-core/src/verification/drawingCertificate.test.ts packages/agent-core/src/verification/drawingMutation.test.ts apps/web/src/agent/drawingCertificateStaleness.test.ts apps/web/src/agent/agentRuntime.test.ts --testTimeout=30000`
Expected: 全过，错误/过期候选不能进入确认。

Run: `npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`
Expected: 保存新分子/分母；未覆盖题保持失败，不为了提高计数放宽门禁。

- [ ] **Step 4: 回归、证据、文档和推送**

Run: `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd test -- --testTimeout=30000`、`npm.cmd run --workspace @draw/web build`、`npm.cmd run eval:reliability -- --offline`。
写入 `docs/audit/2026-11-16-g3-production-certificate/`，同步活动文档后提交 `fix(verification): connect complete drawing certificates to production` 并推送核对。

### Task 3: 平面/圆锥曲线/函数 18 题数学合同闭环

**Files:**
- Modify: `packages/agent-core/src/deterministicProblemRoute.ts`
- Modify: `packages/agent-core/src/solver/planarDrawing.ts`
- Modify: `packages/geometry-kernel/src/expression.ts`
- Modify: `packages/geometry-kernel/src/conic-parameters.ts`
- Modify: `packages/geometry-kernel/src/conic-line.ts`
- Modify: `packages/geometry-kernel/src/function-evidence.ts`
- Modify: `packages/agent-core/src/diagramVerification.ts`
- Test: `packages/agent-core/src/solver/planarDrawing.test.ts`
- Test: `packages/agent-core/src/solver/functionDrawing.test.ts`
- Test: `packages/geometry-kernel/src/numericRobustness.test.ts`

**Interfaces:**
- Consumes: Task 2 的生产证书、`ProblemContract` 的 scope/实体/域、`compileConstructionDag(...)` 与版本化数值策略。
- Produces: 平面 18 题逐题对象与数学义务独立回代报告；不支持的解析或分支如实保留，不把单支 witness 写成完备枚举。

- [ ] **Step 1: 按共同根因分组并逐组写 RED**

从最新 36 题报告提取全部平面 case，逐个追踪 prompt → route → ProblemContract/IR → plan → candidate → certificate。每组先用原题和至少一个改名/换数/等价语法变体写失败测试；优先共同机制，禁止 `if (caseId === ...)` 或题面全文白名单。

- [ ] **Step 2: 单组实现并确认无“只出图不核题”**

每次只处理一个已证实根因，复用现有 AST、符号圆锥、交/切、导数、宿主依赖与 DAG。Run 对应 owning test，Expected: 原例、变体和错图负例同时通过；若连续三次修复假设失败，停止并复审架构，不叠加第四补丁。

- [ ] **Step 3: 验证平面 18/18**

Run: `npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`
Expected: 独立裁判中平面 `category=plane` 的 18 题全部 `passed`，对象/义务覆盖均为 1；不可行小问只按审核合同验证诚实披露，不伪造点。保存逐题结果，立体失败不归入平面区块。

- [ ] **Step 4: 全回归、独立复核、文档与推送**

执行 Task 2 Step 4 的标准命令及必要变异/尺度测试；证据写入 `docs/audit/2026-11-16-g3-planar-math/`，更新活动文档并提交 `feat(geometry): close planar drawing math contracts`，推送核对。

### Task 4: 立体/折叠 18 题与 G3-Math 总门禁

**Files:**
- Modify: `packages/agent-core/src/parametricSolidPlan.ts`
- Modify: `packages/agent-core/src/deterministicProblemRoute.ts`
- Modify: `packages/agent-core/src/solver/prism.ts`
- Modify: `packages/agent-core/src/solver/pyramid.ts`
- Modify: `packages/agent-core/src/solver/tetrahedron.ts`
- Modify: `packages/agent-core/src/solver/foldHinges.ts`
- Modify: `packages/agent-core/src/solver/coupledFolds.ts`
- Modify: `packages/agent-core/src/solver/witnessSearch.ts`
- Modify: `packages/geometry-kernel/src/solid-builders.ts`
- Test: `packages/agent-core/src/solver/solidDrawingContracts.test.ts`
- Test: `packages/agent-core/src/planCompiler.foldBranches.test.ts`
- Test: `packages/agent-core/src/planCompiler.coupledFolds.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 的合同、DAG、数值与生产证书。
- Produces: 立体 18 题逐题对象、尺寸、拓扑、折叠 lineage 与分支证据，以及平面/立体合计 36/36 G3-Math 报告。

- [ ] **Step 1: 以原题回放逐组建立 RED**

区分路由缺失、宿主/辅助点、参数求解、面环/开放面拓扑、折前折后身份、耦合顺序与分支。每组保留原题、变体、错拓扑/错角/错 scope 反例，先跑出现有失败再改实现。

- [ ] **Step 2: 最小构造修复与独立回代**

只使用参数化构造与有界求解；失败搜索不映射 `provenUnsat`，镜像/多折不声称完备。逐组运行 owning tests，确认合法开放面与闭合实体不混用检查器。

- [ ] **Step 3: 验证 G3-Math 36/36**

Run: `npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`
Expected: `denominator=36`、`totals.passed=36`、`partial=failed=incomplete=0`，平面 18/18、立体 18/18，平均对象/义务覆盖均为 1，`liveWrites=0`。若未达，Task 4 不得收口。

- [ ] **Step 4: 全回归、独立数学复核、文档与推送**

执行完整 Vitest/typecheck/lint/Web build/offline smoke 与相关 Rust 回归；证据写入 `docs/audit/2026-11-16-g3-math-exit/`。独立 reviewer 复核反例与代表题解析参考后，才更新 G3-Math 为完成；提交 `test(verification): close G3 math acceptance` 并推送核对。

### Task 5: T15 真实候选渲染、可见性与可读性

**Files:**
- Modify: `packages/agent-core/src/verification/renderEvidence.ts`
- Modify: `packages/agent-core/src/verification/layoutModel.ts`
- Modify: `apps/web/src/canvasEvidence.ts`
- Modify: `apps/web/src/agent/renderLayoutInput.ts`
- Modify: `apps/web/src/agent/hostBridge.ts`
- Modify: `apps/web/src/agent/agentRunner.ts`
- Modify: `apps/web/src/components/GraphicsView.tsx`
- Modify: `apps/web/src/threeScene.tsx`
- Create: `e2e/drawing-reliability-render.spec.ts`
- Test: `packages/agent-core/src/verification/renderEvidence.test.ts`
- Test: `apps/web/src/canvasEvidence.test.ts`

**Interfaces:**
- Consumes: 既有 `CandidateRenderEvidenceInput`、`canvasEvidenceOf(...)`、2D 渲染 DOM、3D 投影/标签/隐藏棱读数及 Task 4 的同版候选。
- Produces: 真正的 `mode: "rendered"` 候选证据（运行/草稿/内容/相机/视口/截图绑定），外部版本化 `agent_visual_review` 与用户/教师人工走查记录；`structured_only` 不得升级为 `rendered`。

- [ ] **Step 1: 写真实渲染 RED**

覆盖对象在文档中但画布外、缺标签/重复标签/遮挡、错误虚实线、函数间断连线、截图 hash 不匹配、相机只变视觉不变数学。先证明当前 `candidateRenderEvidence` 仍为 `structured_only`，再写产品入口失败用例。

- [ ] **Step 2: 接通候选实际渲染而非伪造盒子**

复用 `canvasEvidenceOf` 与真实渲染器输出，让候选在实际预览画布形成稳定帧后采集测量与截图；3D 不可由 DOM 量取的对象必须读 renderer/投影证据，不能继续以 `objectsMeasurable=false` 充当通过。等待使用条件，不使用固定 sleep。

- [ ] **Step 3: 四族定向 Playwright**

Run: `npm.cmd exec -- playwright test e2e/drawing-reliability-render.spec.ts --workers=1 --retries=0`
Expected: 平面、立体、折叠、函数正反例全过，截图与候选 hash 一致；警告不能静默当作失败，也不能把严重不可见降级成警告。

- [ ] **Step 4: 36 题渲染与人工审阅包**

固定浏览器/字体/视口/deviceScaleFactor/相机/动画状态，逐题采集同候选渲染结果与截图，输出 36 题索引和四族联系表。AI 看图结果单列 `agent_visual_review`，用户/教师人工走查另留签收；没有签收不得写成 `human_reviewed`。

- [ ] **Step 5: 回归、证据、文档与推送**

运行完整相关 Vitest、typecheck、lint、Web build、目标及全量串行 Playwright（retries=0）。证据写入 `docs/audit/2026-11-16-g3-render-exit/`，同步活动文档并提交 `feat(render): verify actual diagram visibility and labels`，推送核对。

### Task 6: T16 确认、撤销、保存重载、拖动与配图生命周期

**Files:**
- Modify: `apps/web/src/agent/agentRuntime.ts`
- Modify: `apps/web/src/agent/draftStore.ts`
- Modify: `apps/web/src/agent/agentRunner.ts`
- Modify: `packages/agent-core/src/committerAdapter.ts`
- Create: `e2e/drawing-reliability-lifecycle.spec.ts`
- Create: `docs/audit/2026-11-16-g3-interaction-exit/README.md`

**Interfaces:**
- Consumes: Task 5 同版 rendered 证据、T14 的 `verifyCertificateFreshness`/一次确认锁、既有保存/撤销/宿主依赖及 R07 题图复核。
- Produces: 36 题最小生命周期矩阵、四族复杂交互正反矩阵、独立配图集结果、浏览器与实际 Windows 桌面同版证据。

- [ ] **Step 1: 从真实 UI 写生命周期 RED**

覆盖确认前零写入、连点一次提交、撤销/重做、保存关闭重开、绑定点拖动、破坏条件后证书失效、取消后迟到零写入、旧证书不跨会话、OCR 错标必须复核。不得直接写 scene store 代替用户操作。

- [ ] **Step 2: 修实际暴露的问题并跑定向浏览器闭环**

Run: `npm.cmd exec -- playwright test e2e/drawing-reliability-lifecycle.spec.ts --workers=1 --retries=0`
Expected: 全过；每次只修一个已证实根因，保留反例与 sceneWrites 断言。

- [ ] **Step 3: 36 题与四族复杂矩阵**

逐题记录输入 → 草稿 → 数学/视觉 → 确认一次 → 撤销/重做 → 保存重载 → 相关拖动；配图/OCR 集独立计数，不混入 36 题纯文本分母。不可行/澄清案例验证零误导提交。

- [ ] **Step 4: 实际 Windows 桌面验证**

用当前源码 Web build 与 Tauri no-bundle/实际可执行程序完成同版桌面走查，保存 revision、binary hash、启动环境、截图/交互记录和退出码。浏览器 mock 不得顶替此步骤；安装包/冷启动属于 P8，不在此冒称已验。

- [ ] **Step 5: 全回归、证据、文档与推送**

运行完整 Vitest/typecheck/lint/Web build/offline eval、全量串行 Playwright 与相关 Rust 测试；证据写入 `docs/audit/2026-11-16-g3-interaction-exit/`，同步活动文档并提交 `test(delivery): verify G3 diagram lifecycle in real UI and desktop`，推送核对。

### Task 7: G3 总验收与停点

**Files:**
- Create: `docs/audit/2026-11-16-g3-final/README.md`
- Modify: `docs/current-status.md`
- Modify: `docs/project-progress.md`
- Modify: `docs/agent-next-round-progress.md`
- Modify: `docs/superpowers/plans/2026-11-15-main-restart-master-plan.md`
- Modify: `docs/superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md`
- Modify: `docs/acceptance/agent-release-gate.md`

- [ ] **Step 1: 对照 B4/B5 每一条退出门槛**

汇总 36 题 scope/数学、反例、真实渲染、生命周期、四族复杂交互、浏览器与桌面证据，确认全部绑定同一最终 revision。任何 pending/unknown/未跑项单列，不删除。

- [ ] **Step 2: 最终标准验证**

Run: `npm.cmd run test:docs -- --testTimeout=30000`
Run: `npm.cmd run typecheck`
Run: `npm.cmd run lint`
Run: `npm.cmd test -- --testTimeout=30000`
Run: `npm.cmd run test:rust`
Run: `npm.cmd run eval:reliability -- --offline`
Run: `npm.cmd run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`
Run: `npm.cmd exec -- playwright test --workers=1 --retries=0`
Expected: 所有命令退出 0；36 题合同 36/36，实际 E2E 计数按最终输出记录。

- [ ] **Step 3: 独立最终复核与人工签收**

独立 reviewer 检查没有评测后门、题号特判、mock 冒充桌面、AI 冒充人工或文档夸大。必需的用户/教师可读性签收未返回时保持 G3 未完全退出，继续等待，不伪造签名。

- [ ] **Step 4: 文档、提交、推送与目标状态**

只有全部退出条件满足才把 G3-Math/G3-UX 标完成、P8 标为下一阶段未授权；提交 `test(verification): close G3 acceptance evidence`，推送并确认 ahead/behind `0 0`。否则保留活动目标、明确剩余阻断，不调用 goal complete。
