# G3-DS 真实模型作图升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 保存的 DeepSeek（DS）实质参与冻结36道真题的题意理解与构造决策，在独立数学、生产证书、同候选真实渲染及受控交付门禁下达到 **36/36 完整通过**；未见题另计，不承诺任意题100%。

**Architecture:** DS 产出结构化对象、条件、分问作用域与构造意图；复用既有 ProblemContract/ObligationIR、planCompiler、solver、draftStore 和渲染链，确定性求参/物化，不要求 DS 直接猜最终坐标。独立裁判仅在生成后判题，返回逐义务诊断；限定次数的局部修复重新验证全题，隔离草稿经明确确认才写入主画布。冻结36题的输入不含标准构造或裁判答案。

**Tech Stack:** 仓库现有 TypeScript、Vitest、Playwright、React/Three.js、Tauri 原生 provider 凭据通道；不新建第二套作图引擎、不新增付费 provider。

**Spec:** `docs/superpowers/specs/2026-11-15-drawing-reliability-design.md` 的 G3-DS 增补；本计划扩充 `2026-11-16-g3-completion-plan.md`，不重写已退出的 G3-Math 历史证据。

## Global Constraints / 不可交换的口径

- **唯一目标口径**：冻结36题（平面18、立体18）逐题 `DS 被实际调用并产生题意/构造决策` ∧ `独立完整合同 passed` ∧ `生产证书 passed` ∧ `同候选浏览器画布真实渲染 passed` ∧ `隔离工作区经确认提交及重开验证 passed`；任一项缺失都不计入端到端 36/36。人工可读性、非沙盒 Windows 实机窗口签收仍是独立发布门槛，未签不能写 G3 整体退出。
- 同时报 `DS 首轮完整通过率`、`有上限的修复后通过率`、`主画布受控提交率`、18/18 平面和18/18立体、缺候选/partial/失败、警告、实际请求与 provider usage；不得只报最好的一个百分比。`sceneWrites=0` 在未确认草稿阶段是安全行为，不用它抵销候选通过或冒充交付通过。
- 冻结合同只供独立裁判，不进 DS 提示、构造器或题号路由；禁止按题号特判、删除失败题、放宽容差、以 `partial`/`unknown`/`waiting` 冒充 passed，禁止拿确定性优先的 36/36 改名为 DS 36/36。评测明确记录 DS 调用证明、route、模型标识、版本及候选 hash；绕过 DS 的用例单列产品对照，主分子不得计入。
- 保存的 DS 凭据只走既有原生链路，密钥、原始敏感请求及用户私密数据不写入 Git。**现有36题授权已用于历史实测**；下一次付费小批及整批都须先由用户批准请求数、token/费用上限与停止条件；没有授权只跑零费用诊断/回放，不复用旧授权。provider 未返回费用时填 `unknown`，不得写0元。
- 每个区块：失败样本和根因证据 → RED → 最小修复 → 定向 GREEN → 回归 → 独立复核 → 脱敏证据和活动进度同步 → commit → push → 远端核对。未达到退出门槛时保留失败状态，不为赶进度推进下一批付费调用。

## 已实测基线（冻结历史，不是新任务成绩）

- 2026-11-16 America/Los_Angeles，本地 `eval-results/ds-live-36-20261116/official-36/summary.json`，修订 `06648346634aa0760ba329419de041e5296add77`：**强制 DS 规划**，36完成，完整通过2/36（GK-S08、GK-S09），21 partial，13 failed；23/36 有非空候选；`confirmable=4`（含真通过 GK-S08/GK-S09 与 **2 例假阳性放行 GK-P09/JT-P09**）；80次原生请求（单题平均约 `67.5–69.8 KB` 系统上下文）、usage 输入1,724,928 / 输出66,549 tokens（可能不完整），费用未知；主画布0写入（没有自动确认）。这不是默认确定性优先生产路线，也没有逐题同候选浏览器渲染或真实主画布提交。
- 13道无候选先定位生成/动作/编译/等待原因（含 `JT-S04` 停在 `terminal="waiting"` / `bucket="interaction"`）；21道 partial 中19道仍有对象或义务缺口（其中 6 道 `prims > 0` 在 `req=1` 即死于 `validating`，因协调器尚无验证失败→修复回路），另 **JT-S07、JT-S09** 对象/义务覆盖均为1，但生产验证 `not_supported`、证书 `partial`；同时 **`GK-P09`（`obCov=0.00`）、`JT-P09`（`obCov=0.23`）** 存在生产证书 `passed` 并进入 `awaiting_confirmation` 的假阳性分叉。`drawingContracts.ts` 还要求 `verificationStatus === requireVerification`；不能把 `JT-S07/JT-S09` 直接改判，也不能放过 `GK-P09/JT-P09` 的 `draftStore.ts` 空题面/漏句旁路，必须双向追查真实验证接线。
- 历史确定性路线 36/36 与本轮 DS 2/36 不可并表。原始逐题文件仍留在忽略目录，提交的审计件只能是去敏摘要、输入哈希、失败分类及可复算统计，不提交原始事件或密钥。

## 依赖图、阶段目标和停点

`DS0 脱敏基线/调用证明 → DS1 结构化题意及13题无候选 → DS2 内核构造及19题partial → DS3 证书/局部修复及2题验证分叉 → DS4 同候选渲染/受控提交 → DS5 经授权的付费36题+未见题复核`。

DS1–DS4 的单测与录制/脱敏回放仅检验实现，不计“DS live pass”。即使 DS2、DS3 本地全绿，也必须保留 DS live **2/36 的最近一次实测口径**，直到 DS5 产生新证据。若 DS 模型遇无法判定的题图或信息不足，应澄清/拒画，不凭空补值；因此任意新题100%并非产品承诺。

### DS0：真实基线、脱敏逐题账本与失败边界

**Files:** Create `docs/audit/2026-11-16-g3-ds-live-baseline/README.md`, `docs/audit/2026-11-16-g3-ds-live-baseline/cases.json`, `packages/agent-core/src/verification/dsLiveBaseline.ts`, `packages/agent-core/src/verification/dsLiveBaseline.test.ts`; Modify `apps/web/src/agent/fixtures/examRunCoordinated.ts`、`apps/web/src/agent/fixtures/examRunAdapter.ts`、`apps/web/src/agent/fixtures/examRunCoordinated.test.ts` 与 `scripts/reliability-eval/drawingContracts.ts` 的诊断呈现（不更改判题语义）。

**Interfaces:** Input 为忽略目录原始逐题结果和冻结合同 ID；output 为不含 prompt、模型原话或密钥的 `{id, route, dsInvoked, hasCandidate, confirmable, terminal, objectCoverage, obligationCoverage, certificateStatus, verificationStatus, missingEntityIds, failedObligationKinds, failureBoundary, requestCount}`。每个计数与原始摘要相等（`2/21/13`、`23` 候选、`4` 可确认、`80` 请求、`1,724,928/66,549` tokens），人工/代码双向复核 `GK-S01`、`GK-P09`、`JT-P09`（假阳性）、`JT-S07`、`JT-S09`（假阴性）、`JT-S04`（`waiting`）与零候选例 `GK-S02`。

- [x] 写纯函数摘要与脱敏守卫测试：固定36个ID、2 passed/21 partial/13 failed、23非空候选、4可确认（含 GK-P09/JT-P09 假阳性标注）、80请求、费用 `unknown`；篡改/漏记录/重复ID/泄漏原始 prompt 或密钥字段时拒绝生成。先跑 RED，再实现最小脱敏汇总，跑 GREEN。
- [x] 逐阶段定位并写测试钉住真实中断/分叉边界：零候选（`GK-S02`、`GK-P04`、`JT-S04` `waiting`）、假阴性 `not_supported`（`JT-S07`/`JT-S09`）、**假阳性 `passed` 放行（`GK-P09`/`JT-P09`，追踪 `draftStore.ts` `prompt: ""` / 漏句旁路）**，以及 `req=1` 即死于 `validating` 无修复环（`coordinator.ts` lines 776–784）。**先证实中断位置才给出修复**；归因不确定时写 `unknown`，不一概归咎模型。
- [x] 仅提交脱敏报告和证据索引；同步 `docs/current-status.md`、`docs/project-progress.md`、`docs/agent-next-round-progress.md`，核查 Git 没有原始请求、token/secret；提交并推送。无新付费调用。

### DS1：DS 结构化施工单与紧凑两阶段协议，先消除13道无候选

**Files:** Modify `apps/web/src/agent/modelPlanner.ts`, `apps/web/src/agent/systemPrompt.ts`, `apps/web/src/agent/agentRunner.ts`, `packages/agent-core/src/drawingIntent.ts`, `packages/agent-core/src/obligationIR.ts`；Create `packages/agent-core/src/dsDrawingIntent.ts`, `packages/agent-core/src/dsDrawingIntent.test.ts`；Extend `apps/web/src/agent/modelPlanner.test.ts`、`apps/web/src/agent/systemPrompt.test.ts`、`agentRunner.test.ts`。

**Interfaces:** `DsDrawingIntent` 携带 `entities[]`, `givenRelations[]`, `subquestions[{id,dependsOn,stateId,relations[]}]`, `constructionStrategies[]`, `unknowns[]` 与 source-span/证据；它是模型规划输入到现有通用 DAG/编译器的中间件，不承载标准答案。阶段 1 对 `systemPrompt` 瘦身（将单次 `~67.5 KB` 全量动作垃圾箱降为紧凑施工单协议，**禁止 DS 手算多面体顶点或无理数坐标**），接通用正交构造原语与 `compileConstructionDag`（设 Anti-Heuristic-Router 守卫，禁止退化成 36 题关键词/模板路由器）。验证层拒绝未声明引用、跨 scope 条件污染、无证据常数和无法支持的动作，返回稳定诊断码。不能因为有字段就假定数学正确。

- [ ] 用零候选族写 RED：折叠立体（GK-S02 / JT-S04 `waiting`）、函数（GK-P04）、切线（GK-P06）分别验证 `DS已调用 → 结构化意图 → 编译/拒绝原因`；补**改点名/换数字/换叙事的通用变体测试**及题图缺信息、网络中断、无效 schema 和作用域交叉污染负例。
- [ ] 仅修实核发现的第一处中断，接既有 planner 和 compiler，不另造36题模式表；逐题增加可复现回放与真实意图，而非复制标准坐标。不能识别的题要产生可解释澄清/失败，不能为得到候选数编造图。
- [ ] 出口：13道历史零候选对应的每道都有可验候选，或有经审题确认的题图缺失/不可构造原因与正确安全终态；“零候选消除”本身不是36/36，通过仍取最终合同。定向测试/类型检查/复核后同步文档、提交推送。

### DS2：19道有候选但不正确，按义务族补构造与求解

**Files:** Modify `packages/agent-core/src/planCompiler.ts`, `packages/agent-core/src/solver/` 内已证实需要的求解器, `packages/agent-core/src/diagramObligations.ts` 和对应定向测试；Modify `apps/web/src/agent/agentRunner.ts` 只做与现有构造器的接线。

**Interfaces:** 意图 → 求参/构造 → 实体对象与候选文档；裁判接口不反向把答案注入求解器。按失败签名分组而非题号：①对象/关联/拓扑（发生最多的 incidence）；②长度/比例/角与垂直平行；③函数/圆锥曲线/相切；④立体/折叠前后 state 与多问。每族选择正例和反例、记录影响题目。

- [ ] 先写 `GK-S01` 第二问 `AD⊥DC` 与二面角的 RED：旧候选19图元仍不得通过；新增求解后两约束同时满足，并验证第一问不退化。另以 GK-P01 缺曲线/对象与 JT-S08 对象缺失为覆盖负例。
- [ ] 对一族只修一个共同根因并运行定向 GREEN；对改动前已通过的 GK-S08/GK-S09 和同族未见反例运行回归。禁止通过放宽容差、补题号固定坐标、缩小合同作用域使之变绿。
- [ ] 出口：19题的完整对象/义务/条件由裁判逐题证明；证书为下一阶段单列门禁，不能把“有图”当“作图成功”。每个独立失败族产出证据/文档/提交/推送。

### DS3：生产证书和逐义务局部修复

**Files:** Modify `packages/agent-core/src/verification/drawingCertificate.ts`, `packages/agent-core/src/coordinator.ts`, `apps/web/src/agent/draftStore.ts`, `apps/web/src/agent/agentRunner.ts`, `packages/agent-core/src/planCompiler.ts`；Extend `packages/agent-core/src/verification/drawingCertificate.test.ts`、`packages/agent-core/src/coordinator.test.ts`、`apps/web/src/agent/draftStore.test.ts` 和 `apps/web/src/agent/agentRunner.test.ts`。

**Interfaces:** 验证产出 `failedObligations[{id,scope,stateId,kind,detail}]`, `missingEntities[]`, `unresolvedClauses[]`, `candidateHash`, `certificateStatus`。首先**堵死 `draftStore.ts` 空题面 `prompt: ""` 证书旁路与无解析从句静默放行**（消除 `GK-P09`/`JT-P09` 假阳性）；并在 `coordinator.ts` 开通**有界 `validating -> repair` 回环**（消除 6 题 `req=1` 即死）。修复器只读取**合法生产反馈**而不是黄金合同的预期答案，仅修改失败依赖的子图；每轮重验全题，最多按用户批准的请求上限，过期 hash/相互冲突/无进展立即停机。重新选分支不能悄悄改题设。

- [ ] 用 **JT-S07/JT-S09（假阴性）** 与 **`GK-P09/JT-P09`（假阳性：`verif=passed` 但契约 `obCov=0/0.23`）** 写双向 RED：对象/义务均满但 `not_supported` 时不可伪造证书，**有未解析/未核验题干从句时也绝不返回 `passed`**。
- [ ] 写 RED：同一约束反复失败不无限请求（触发停滞停机）、修补第二问不破坏第一问、全量重验、篡改候选后旧证书失效、`validating` 失败能在配额内触发有界修复、无用户确认时主画布仍零写入。
- [ ] 出口：在结构化回放中合同和真实生产证书 36/36（0 假阳性、0 假阴性）；此结果仍**不**是 live DS 36/36。类型检查与定向回归后同步文档、提交推送。

### DS4：DS 候选的真实浏览器渲染、冻结复播工件和隔离工作区交付

**Files:** Extend `e2e/drawing-reliability-36-render.spec.ts`, `e2e/drawing-reliability-lifecycle.spec.ts`; Modify `apps/web/src/agent/renderLayoutInput.ts`, `apps/web/src/canvasEvidence.ts` 和 `apps/web/src/agent/hostBridge.ts` **仅在 RED 证明现有同版证据不足时**。

**Interfaces:** 同一 `{runId,candidateHash,documentHash,cameraHash,viewportHash}` 串联 DS 施工单、证书、截图、确认及重开文档；导出**零费用可复播 `ds-candidate-bundle`**（置于忽略产物目录），让浏览器渲染/生命周期缺陷回归无需重复消耗付费 DS 额度。不可把已有确定性36张截图重命名为DS截图。受控提交只在隔离临时工作区通过模拟用户真实点击执行，产品正式画布保持人工确认。

- [ ] 写浏览器 RED：候选/截图异版、对象在视野外或点名不可读、已确认候选被二次提交、取消后迟到写入；记录警告和失败，不把 warning 自动记成人工通过。
- [ ] 对 DS **同一**候选逐题跑数学/生产证书→真实渲染→隔离工作区确认→撤销/重载；保存36题可审阅索引，人工和 AI 审查字段分开。浏览器工程自动通过与用户/教师签收分开报告。
- [ ] 出口：在已授权真实 DS 候选基础上能独立证明每题各闸通过；未获模型复测授权时只能完成桥接/回放，标为待实测。定向 E2E `--workers=1 --retries=0` 和必要回归后同步文档、提交推送。

### DS5：受控付费复测、未见题与最终门禁

**Files:** Modify `apps/web/src/agent/fixtures/examRunCoordinated.ts`、相关测试及 `scripts/reliability-eval/finalOutcome.ts`（以实核现有 runner 为准，保持单一评测入口）；Create `docs/audit/g3-ds-live-exit/README.md`、脱敏逐题结果与证据索引；Update `docs/current-status.md`, `docs/agent-next-round-progress.md`, `docs/project-progress.md`, `docs/acceptance/agent-tool-loop-scorecard.md`, `docs/acceptance/agent-release-gate.md` 以及主计划中的门禁引用。

**Interfaces:** 请求预算账本有 `maxRequests`, `maxPerCase`, `maxInputTokens`, `maxOutputTokens`, `costCap(仅在可核实价格/usage时)` 和硬停止条件；账本写模型/route/修订/hash/总数/usage/费用状态。每题记录 `firstAttemptPassed`, `repairedPassed`, `contractPassed`, `certificatePassed`, `renderPassed`, `controlledCommitPassed`, `humanReviewed`，不存在/缺失不得默认为 true。

- [ ] **先向用户取得新的明确授权**：模型/固定题集、预检批量、整批最大请求数及 token/费用上限、失败停止点。历史80/108请求不是本次免费额度；禁止用已有保存密钥自动发起新批。
- [ ] 先做少量代表题现场预检：1道历史通过、1道零候选、1道部分正确、1道验证分叉。若模型配置/用量/提交安全不满足预检，停止整批并分类，不扩大付费消耗。
- [ ] 固定 revision、题集 hash、模型配置、采样参数和重试上限，跑36题实测；所有题必须提供 DS 实际参与证明。`firstAttemptPassed`、`repairedPassed` 分开计；只在合同、证书、同候选渲染、隔离工作区受控提交全部通过时计入“端到端通过”。未达36/36不得宣布 G3-DS 完成，回到对应失败族继续修复，重新申请付费复测授权。
- [ ] 通过冻结题后用不参与调参的未见题/题图另行验收并独立披露；不要求其100%来篡改冻结题成绩，不对新题做100%保证。人工可读性、Windows实机及发布门禁分别签收，不由模型代签。
- [ ] 完整验证：目标 Vitest、`npm.cmd run typecheck`, `npm.cmd run test:docs`, 定向/全量 Playwright（`--workers=1 --retries=0`）、Git 脱敏检查；按每个区块更新唯一实时进度并推送，核对远端一致。只有所有**对应口径**门槛有同版本证据，才在状态文档把 G3-DS 标为已退出。

## 自审与执行约束

每个 DS 阶段都需要一组应通过/必须失败的反例；DS0 的基线、DS1 的候选、DS2 的完整数学、DS3 的证书、DS4 的真实画布、DS5 的真实模型付费结果不得相互代替。执行者必须先确定每个旧文件的当前接口，再定小补丁；本计划中的路径是责任区而非授权一次性重写大模块。旧 Task 1–7 的勾选只表示旧口径曾经做过，**不自动勾选 DS0–DS5**。
