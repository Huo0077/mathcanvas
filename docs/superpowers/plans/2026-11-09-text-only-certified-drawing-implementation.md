# 文字题可核验作图升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在文字题 Agent 中默认启用适用的升级能力；仅当作图满足原题全部必需义务、核验绑定到候选图且提交前仍有效时，允许把图标为正确并提交。

**Architecture:** 单一题意 IR 负责逐条题设和目标；语义构图器优先输出命名形状与关系，模型只提供候选；宿主独立生成完整证书；协调器和提交端双重 fail-closed。读答案与作图分路，保存旧对话只读；不恢复识图。

**Tech Stack:** TypeScript/Vitest、React/Playwright、现有 `@draw/agent-core`、`@draw/geometry-kernel`、`@draw/scene-graph`、Tauri 原生 Provider（只有明确授权的评测才使用）。

**Spec:** `docs/superpowers/specs/2026-11-09-text-only-certified-drawing-design.md`

## Global Constraints

- 当前范围只有**文字题**；任何任务不得重新发布题图上传、识别或补读入口。
- 证书缺失、义务未消费、`not_supported`、`unknown`、`failed`、候选/场景/题干哈希过期，均不能显示“正确图”或执行提交。
- 只读回答可以标“未核验”；实例验证不能标“形式证明”；第二模型仍以用户显式授权为前提。
- 保留旧历史报告与原题；旧评测的编译成功/选项正确率不可提升为新作图成功率。
- 每块先 RED 后 GREEN；当前版本提交推送不等于下列未实施任务完成。

---

### Task 0: 冻结作图失败集与独立 oracle

**Files:** Create `test-fixtures/drawing-regression-20261109/cases.json` and `README.md`; create `scripts/drawing-regression/manifest.test.ts`; reuse `packages/agent-core/src/fixtures/solidGeometryFourCases.ts` and `apps/web/src/agent/fixtures/examSolid30.problems.ts`.

**Interfaces:** `cases.json` 对有可靠原文的每项至少 `{id, source, prompt, expectedDisposition, requiredConditions, forbiddenBehaviors}`；无法取得原题者列入 `missingSources` 并排除验收分母。`expectedDisposition` 仅为 `verified_drawing | clarification | unsupported | reject_candidate`，独立坐标/量值 oracle 存 `README.md` 的来源说明或单独 fixture，不能调用生产求解器生成期望。

- [ ] **Step 1 RED:** 写 manifest 测试，要求 `joint-06/11/13/14/17/25`、Case 1–4（含原题与修订版）及 E19/E23 的每个题号**恰落在** `cases` 或 `missingSources` 一侧；已入 cases 者必须有固定原文、来源和预期；首次运行应因文件缺失失败。
- [ ] **Step 2 GREEN:** 从 `docs/agent-drawing-eval-20261019.md`、四题固定夹具与 24 题夹具逐字收录；若某 `joint-*` 原文不在仓库，列入 `missingSources` 并在 `README.md` 标“缺原文/不可入验收”，不得凭报告摘要编题。
- [ ] **Step 3:** `node node_modules/vitest/vitest.mjs run scripts/drawing-regression/manifest.test.ts`；固定 JSON SHA-256 与版本、统计各类数量及不可用原文数。
- [ ] **Step 4:** 人工复核独立 oracle 和负例，再提交本块；原始真实 provider 记录仍留 Git 忽略目录。

### Task 1: 默认升级只开启文字相关能力，不恢复图片

**Files:** Modify `apps/web/src/persistence/rolloutPreferences.ts`, `apps/web/src/agent/reliabilityFlags.ts`, `apps/web/src/agent/agentRunner.ts`; test `apps/web/src/agent/reliabilityRollout.test.ts`, `apps/web/src/agent/agentRunner.test.ts`.

**Interfaces:** `readRolloutPercentage()` 对未设置偏好的新安装返回 `100`；已有显式 0 保留作为**解题功能回滚**，但 Task 4 的图形证书门禁始终生效；`createAgentReliabilityFlagsForSession` 在文字模式下开启 `answerSemanticsV1/goalTrackingV1/mathVerificationV1`，已停用的 `imageRereadV1` 保持 false；三视图只在纯文字支持域里启用。

- [ ] **Step 1 RED:** 新安装、显式 0、错误偏好、跨重启同会话分桶四类用例；原默认 0 的用例按产品决策更正，验证显式回滚仍不得绕过图形提交门禁。
- [ ] **Step 2 GREEN:** 调整偏好缺省与依赖派生，不在历史图片消息恢复调用图像 provider；独立候选引用仅授权、不得自动收费调用。
- [ ] **Step 3:** 运行 `node node_modules/vitest/vitest.mjs run apps/web/src/agent/reliabilityRollout.test.ts apps/web/src/agent/agentRunner.test.ts`，并查 `apps/web/src/agent/reliabilityFlags.ts` 的非法组合仍 fail closed。
- [ ] **Step 4:** 提交本块；若默认切换造成现有文字题/作图回归红，先恢复而不是带红推进。

### Task 2: 文字答案、作图与多目标路由明确分离

**Files:** Modify `packages/agent-core/src/problemUnderstanding.ts`, `packages/agent-core/src/coordinator.ts`, `apps/web/src/agent/problemSolveService.ts`, `apps/web/src/agent/agentRunner.ts`; test `packages/agent-core/src/problemUnderstanding.test.ts`, `packages/agent-core/src/answerAcceptance.test.ts`, `apps/web/src/agent/problemSolveService.test.ts`, `packages/agent-core/src/rectangleFoldPlan.delivery.test.ts`.

**Interfaces:** 规划前得到 `readonly-answer | drawing | drawing-and-answer | clarification` 一种任务意图；`drawing` 必须由用户的明确作图动词或产品明确的文字作图请求产生。`如图` 且缺图示条件只请求文字补充；单选目标不获作图动作。

- [ ] **Step 1 RED:** 使用 `text-131/143/151/158/167/176/186/204`；原文仅求选择/证明时不得产草稿；用户说“作直角梯形示意图”时必须进入作图。E10 合并问、E15 只问折前、E19/E23 图与正文仍逐目标对应。文字单选的“最终答案：B（42）”及其余三道历史假拒绝应正确解析为 B；“无匹配选项”及与结构值冲突仍拒绝。
- [ ] **Step 2 GREEN:** 基于已有 `GoalContext.expectedKind` 与原文 span 做保守路由；不要用“题面提到圆锥/三角形”代替“用户要求画”；终答只抽唯一合法选项，括号里的数学解释与选项分开解析。
- [ ] **Step 3:** `node node_modules/vitest/vitest.mjs run packages/agent-core/src/problemUnderstanding.test.ts packages/agent-core/src/answerAcceptance.test.ts packages/agent-core/src/rectangleFoldPlan.delivery.test.ts apps/web/src/agent/problemSolveService.test.ts`；负例不可意外进入几何编译。
- [ ] **Step 4:** 提交本块；记录 default 100% 下仅文字题不被误送作图的结果。

### Task 3: 构图语义与编译错误定向修复

**Files:** Modify `packages/agent-core/src/planCompiler.ts`, `packages/agent-core/src/parametricSolidPlan.ts`, `packages/geometry-kernel/src/witness/basePolygons.ts`; test `packages/agent-core/src/planCompiler.hostNotFoundAdvice.test.ts`, `packages/agent-core/src/planCompiler.faceRingAdvice.test.ts`, `packages/agent-core/src/solidGeometryFourCases.test.ts`.

**Interfaces:** 题面命名点/棱/面只引用执行期生成的类型化别名；对“已支持的梯形底、菱形底、三棱柱、折片与分点”优先选择内核构造，剩余原始 `polyhedron` 顶点仍需闭合、共面、自交、体积/绕向检查。

- [ ] **Step 1 RED:** `joint-06` 的不存在宿主必须在暂存前拒绝；`joint-11` 自交与 `joint-13` 不共面不得靠坐标挪动静默修正；Case 1–3 改点名/缩放仍由确定性构造；错边/错点名不得通过。
- [ ] **Step 2 GREEN:** 保留现有纠错提示，补上别名依赖检查和组合体语义构造的最小缺口；仅允许有界一次同类修复，每次请求计入现有预算。
- [ ] **Step 3:** 运行上述 3 个文件及 `packages/geometry-kernel/src/witness/constructors.test.ts`；确认正确/错误双向变异。
- [ ] **Step 4:** 提交本块；不把“计划编译通过”写成“题设验证通过”。

### Task 4: 强制作图完整证书，提交端二次校验

**Files:** Create `packages/agent-core/src/verification/drawingCertificate.ts` and `.test.ts`; modify `packages/agent-core/src/verification/completionGate.ts`, `packages/agent-core/src/coordinator.ts`, `apps/web/src/agent/acceptance.ts`, `apps/web/src/agent/hostBridge.ts`, `apps/web/src/components/agent/ConfirmationPanel.tsx`, `apps/web/src/components/agent/RunStatus.tsx`, `apps/web/src/components/agent/AgentMessageList.tsx`; matching tests in these modules.

**Interfaces:** `buildDrawingCertificate({ context, candidate, scene, checks, verifierVersion })` 只收宿主生成的 `VerificationReport`，证书含 `problemRevision/sourceRevision/candidateHash/sceneRevision/verifierVersion`、`requiredGoalIds` 和每条义务的 `sourceText/status/entityId`；`canCommitDrawing(certificate, currentHandle)` 仅在证书完整且版本相等返回 true。若 IR 不能穷举原文条件，证书状态为 `unsupported` 而非 `passed`。

- [ ] **Step 1 RED:** `deriveAcceptance` 返回空、`diagramVerification===undefined`、空 checks、`not_supported`、`unprocessed`、错误题设残差、伪造模型证书、草稿/场景/题干任一哈希变化均**不能**确认或提交；只读答案仍能交付“未核验”。
- [ ] **Step 2 GREEN:** 计划 kind=`plan` 的验证无条件执行；扩充 `AcceptanceCheck` 为逐原文义务与实体绑定（只增加当前可独立核验的关系），让 `verificationGate` 和 `HostBridge.commit` 共用证书判定；确认按钮只作为用户体验，不是安全唯一防线。含答案正文的提交回执必须优先于 `draft` 状态渲染；提交后面板不能继续显示可再次提交的按钮。
- [ ] **Step 3:** `node node_modules/vitest/vitest.mjs run packages/agent-core/src/verification/drawingCertificate.test.ts packages/agent-core/src/verification/completionGate.test.ts packages/agent-core/src/coordinator.test.ts apps/web/src/agent/acceptance.test.ts apps/web/src/agent/hostBridge.test.ts apps/web/src/components/agent/ConfirmationPanel.test.tsx apps/web/src/components/agent/RunStatus.test.tsx`。
- [ ] **Step 4:** 验证 Case 4 原题和修订版均有实例核验；删除折后点名或折角的变体 `clarification` 且无草稿；`joint-25` 缺焦点弦判据不得标整题 passed；提交后重新取得的场景版本必须与证书一致；对含答案正文的草稿断言“回执是已提交、确认按钮消失、第二次点击不重复写入”，再提交本块。

### Task 5: 真实 UI 与冻结题集分轨验收

**Files:** Create `e2e/agent-certified-drawing.spec.ts` and `scripts/drawing-regression/report.test.ts`; modify `docs/current-status.md` 和本实施计划的进度勾选；复用 `e2e/agent-solid-four-cases.spec.ts`, `apps/web/src/agent/fixtures/examSolid30.problems.ts`.

**Interfaces:** 报告独立输出 `attempted/draft/staged/verified/committed/committedWithKnownError/clarification/unsupported`、义务覆盖率、逐题精确原因及构建/题集哈希；**文字答案成绩与作图成绩分轨**。

- [ ] **Step 1 RED:** 浏览器正例 Case 1–3（查看草稿→确认→一步撤销），负例 `joint-06/11/13/14/17`、Case 4 缺折后点名或缺折角的变体、未核报告；原题与修订版为正例，无报告/过期证书不得显示“确认并提交”。
- [ ] **Step 2 GREEN:** 让 UI 呈现每条失败义务及用户下一步，而不是笼统“没画出来”；如无可信原卷材料，报告不得宣称跑过对应 `joint-*` 原题。
- [ ] **Step 3:** 完整运行 `npm run typecheck`、`npm test -- --maxWorkers=4`、`npm run test:docs`、`npx playwright test e2e/agent-certified-drawing.spec.ts e2e/agent-solid-four-cases.spec.ts --workers=1`，并通过 `git diff --check`、改动文件 lint；记录每条命令退出码与失败数。
- [ ] **Step 4:** 冻结一份未参与修复的**纯文字作图**留出卷，人工审定题设和独立量值；任何真实 provider 测试先明确次数/费用上限，只跑一次且不自动写文档，原始请求留在 Git 忽略目录。
- [ ] **Step 5:** 提交验收结果；只有“已提交图发现的题设错误 0、无证书图不能确认、旧成功家族不退化”三项同时满足，才考虑默认全量发布（不承诺所有开放题可画）。

## Spec coverage self-review

- 旧失败家族 `joint-06/11/13/14/17/25`：Tasks 0、3、4、5；四题 Case 1–4：Tasks 0、3、4、5；E19/E23：Task 2；文字默认档：Tasks 1、2。
- 没有把历史 2/30、4/30、文字题 19/20 当成当前画图成绩；真正的图题材料仍在历史档案，生产输入只允许文字。
- 设计中的证书 API 在 Task 4 明确定义；完成前所有签发/提交处应保持现有安全行为，不提前声称“100%”。