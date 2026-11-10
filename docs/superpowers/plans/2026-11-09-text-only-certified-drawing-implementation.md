# 纯文字题可核验作图：分阶段实施方案（2026-11-09）

> 状态：**W0 已完成（证据冻结；非功能验收），W1–W5 未实施**。实施时每块先写失败测试（RED），再写最小修复（GREEN），过闸后单独提交并更新 `docs/current-status.md`。不把既有提交或本方案的勾选视为功能完成。

## 一、目标、边界和证据

**产品目标**：默认启用适用于文字题的升级能力；需要作图时，只允许把**原题所有必需条件均由宿主独立核验、且绑定当前候选图与现场版本**的实例图标为“符合题设”并提交。不支持或无法判定的题，明确说明缺什么、拒绝提交。这里的“百分百正确”是**零已知错误图获准提交的安全约束**，不是保证每一道开放题都能画出；覆盖率和拒画率必须另报。

**不做**：图片上传/OCR/识图复活；未经用户授权的第二模型调用；把实例核验称作全称证明；把选择题命中率、编译率当作图形正确率。历史旧对话中的图片只读，不能以旧附件重启图像处理。

**现状锚点**：`docs/audit/2026-11-09-text-only-live-evaluation.md` 中默认文字题严格选项交付 11/20、显式全开旧题 16/20、显式全开本地新题 19/20；它们**不是作图实测**，且没有宿主独立数学证明。`docs/agent-drawing-eval-20261019.md` 的 `joint-06/11/13/14/17/25` 是历史缺陷线索，不是当前复现结论。四题固定夹具中的 Case 1–3 已有确定性构图；**Case 4 原题现可从折痕端点固定推导 D→P 并生成实例图**，不能再把它当必然待澄清；缺关键信息的变体另测。E19、E23 已有专门回归，重点是防退化，不是重造功能。

## 二、实际接口与不变式（编码前先读）

- `packages/agent-core/src/contracts.ts` 的 `VerificationReport` 是**工具/暂存验收**（`passed|failed|unknown|approximate|not_supported`、`VerificationCheck[]`）；`packages/agent-core/src/diagramVerification.ts` 的 `DiagramVerificationReport` 是**图题条件核验**（`passed|failed|unverified`、逐条 `sourceText`、`obligationIR?`）。两者不可互换，也不可把后一种报告的 `status=passed` 单独视为完整证书。
- `packages/agent-core/src/solveContext.ts` 已有 `problemRevision/sourceRevision/sceneRevision` 和宿主证据绑定惯例；`problemUnderstanding.ts` 有 `ProblemUnderstanding {ir, goals, usage}`；`obligationIR.ts` 有目标 `GoalContext` 与条件消费状态。复用这些定义，不增加平行的题意解析器。
- `apps/web/src/agent/draftStore.ts` 的 `DraftRecord` 保留 `draftVersion`、候选文档、基础句柄与可选 `diagramVerification`；`apps/web/src/agent/hostBridge.ts` 的 `PreviewArtifact` 另有 `previewHash`，已有 consent nonce、渲染证据绑定和 CAS。证书必须针对**这份草稿和这份候选文档**，不能只靠 UI 状态或模型 JSON。
- `apps/web/src/agent/acceptance.ts` 的 `deriveAcceptance` 只覆盖有限 `AcceptanceCheck`（存在性、尺寸、unsupported 等）；当前空验收会在 `agentRunner` 遗漏；`coordinator.ts` 仅在已有 acceptance 或 stagedVerification 时调用工具 `verificationGate`；`hostBridge.ts` 在 `diagramVerification` 缺失时仍可能授权并提交。**已有单项检查通过≠全题条件已识别。**
- `ConfirmationPanel.tsx` 无报告时仍有确认按钮；`RunStatus.tsx` 的 `progressOf` 可能让已提交消息仍显示待确认。图形门禁必须在**协调器、授权和提交**重复核查，前端仅呈现结果。

## 三、模块与文件边界

| 单元 | 修改/新增位置 | 单一责任 |
| --- | --- | --- |
| 题集/独立判据 | `test-fixtures/drawing-regression-20261109/`、`scripts/drawing-regression/` | 固定原题、来源、负例、人工 oracle 和题集哈希；不调用生产求解器生成期望 |
| 路由/答题 | `problemUnderstanding.ts`、`coordinator.ts`、`answerAcceptance.ts`、`problemSolveService.ts`、`agentRunner.ts` | 只读答案、明确作图、作图并回答、缺条件澄清分流 |
| 图形证书 | 新增 `packages/agent-core/src/verification/drawingCertificate.ts` | 纯函数校验义务清单、宿主检查与身份绑定；不负责写文档 |
| 宿主证书生成与保存 | `apps/web/src/agent/draftStore.ts`、`hostBridge.ts`，必要时 `committerAdapter.ts` | 在真实 stage 后签发、在 requestConsent/commit 比对最新身份；保留现有渲染校验与 CAS |
| 构图/核验 | `planCompiler.ts`、`parametricSolidPlan.ts`、`diagramObligations.ts`、`diagramVerification.ts`、`geometry-kernel/src/witness/basePolygons.ts` | 命名图元、拓扑和关系的最小增量支持，不能掩盖不支持条件 |
| UI/发布 | `ConfirmationPanel.tsx`、`RunStatus.tsx`、`AgentMessageList.tsx`、`rolloutPreferences.ts`、`reliabilityFlags.ts` | 清楚披露、不重复确认；仅在安全链绿后默认启用文字能力 |

**推荐证书契约（新类型；以现有类型为准实现）**：`DrawingCertificate = { kind:'drawing'; draftId; draftVersion; previewHash; candidateHash; problemRevision; sourceRevision; sceneRevision; verifierVersion; obligationManifestHash; requiredGoalIds; obligations: [{obligationId, sourceSpan, sourceText, entityIds, disposition, checkStatus, evidenceScope}]; status }`。`candidateHash` 对候选 `GeometryDocument` 使用现有 `canonicalContentHash`；`obligationManifestHash` 对原题条件和目标的**稳定排序规范化集合**计算，防止删掉一个未知条件后仍得到“全通过”。`sceneRevision` 用于题意来源，实际提交还要比对现有 `DocumentHandle` 与 `previewHash/draftVersion`。不要把可变对象的单个 revision 字符串视为证书授权。`sourceSpan` 对应 `ProblemUnderstanding.sourceUnit='utf16'`，必须校验能切回原文。证书来自宿主内部能力，不接纳模型伪造或客户端回填的序列化证书。

`canCommitDrawing(certificate, liveContext, preview)` 必须同时满足：非空、宿主签发、至少一个真实作图动作、必需目标与原文义务**一一覆盖且无重复/遗漏**、每项 `used + passed`（`redundant_proved` 也必须有独立证据）、无 `unprocessed/ambiguous/unsupported/failed/unverified`、所有身份字段一致、渲染检查通过、现有 consent/CAS 通过。没有义务、只有工具 `VerificationReport`、只有 `DiagramVerificationReport` 或只读答案都不能凭空产生图形证书。对目前无法穷举完整题设的输入，结果是 `unsupported_check` 或 `missing_given`，而不是空集 passed。证书只代表**所标实例**，UI 不写“普遍正确/已证明”。

## 四、执行顺序与任务卡

### W0：冻结证据及基线（先做，允许单独交付）

**文件**：新增 `test-fixtures/drawing-regression-20261109/{cases.json,README.md}`、`scripts/drawing-regression/manifest.test.ts`；只读 `packages/agent-core/src/fixtures/solidGeometryFourCases.ts`、`apps/web/src/agent/fixtures/examSolid30.problems.ts`、历史报告。

1. RED：测试断言 `joint-06/11/13/14/17/25`、Case 1–4、E19/E23 每个标识恰落在 `cases` 或 `missingSources`；有原题者须含 `{id, source, prompt, expectedDisposition, requiredConditions, forbiddenBehaviors}`；重复 id、空题、无法定位来源、没有负例立即失败。
2. GREEN：逐字从可信夹具收录；若 `joint-*` 只有摘要无原文，列 `missingSources` 并排除题目验收分母，不准用摘要补写原题。Case 4 原题与修订版分开编号；缺折后点名/角度的合成变体待 W3 编写时单独登记，不能冒充原题。独立 oracle 记录由人工或独立几何计算得出的坐标/量值、容差和来源，不复用被测生产校验器。
3. W0 已执行：`node node_modules/vitest/vitest.mjs run scripts/drawing-regression/manifest.test.ts --maxWorkers=2`，**3/3 通过**；清单 SHA-256 `9e9a58b6ff2a5fa0fec03097190331a3f3d0ddca6d0db7e3257e5476efa34a1f`，可用原文 7、缺原文 6。此后改题集须提升版本并重新审定；独立人工复核仍列 W5 发布前闸，**不声称历史原题现已通过**。

### W1：先堵提交漏洞与重复确认（P0；W0 后、所有放量前）

**文件**：新增 `packages/agent-core/src/verification/drawingCertificate{.ts,.test.ts}`；改 `coordinator.ts`、`draftStore.ts`、`hostBridge.ts`、`ConfirmationPanel.tsx`、`RunStatus.tsx`、`AgentMessageList.tsx` 与相应测试。工具 `verificationGate` 保留原职责；若扩展 `completionGate.ts`，只加图形证书的显式组合，不能把两个 Report 强转为同一种类型。

1. RED：分别构造 `acceptance=undefined`、工具报告缺失、图题报告缺失/空 checks、未识别条件、`unverified/failed/not_supported`、候选图变更、草稿版本变更、题干/场景变更、模型伪造证书、无有效同意、同意后改画布；逐一断言协调器不得自动提交，`requestConsent` 和 `commit` 都拒绝且文档哈希不变。只读无作图答案不受图形门禁误拦。对零动作/零义务 no-op 保留现有合同，但不得宣称“作图成功”。
2. GREEN：stage 完成后用 `ProblemUnderstanding` 的条件/目标与 `DiagramVerificationReport` 逐条匹配、与工具验收状态做独立交叉核验，在宿主创建内部证书并绑定预览；第二次 stage 使旧证书失效。计划含图形动作时**无条件**走图形证书校验；`HostBridge.requestConsent` 与 `commit` 从保存的草稿重算/复查身份，不能只读取 UI 传回报告。对无法建立原题完整性映射的旧草稿采取保守拒绝、提示重新生成，不自动迁移为 passed。保留 CAS、渲染证据、nonce 一次消费。
3. RED→GREEN（UI）：提交含答案正文后状态应为“已提交”，确认按钮消失；重复确认被拒、候选图元数不再增加；无报告时仅显示未核验原因与继续/放弃，不显示“正确图”或确认按钮。修复 `progressOf` 的 `commit` 与 `draft` 优先级并按终态清理按钮。
4. 验证：`npx vitest run packages/agent-core/src/verification/drawingCertificate.test.ts packages/agent-core/src/verification/completionGate.test.ts packages/agent-core/src/coordinator.test.ts apps/web/src/agent/hostBridge.test.ts apps/web/src/components/agent/ConfirmationPanel.test.tsx apps/web/src/components/agent/RunStatus.test.tsx`；增加一条现有四题浏览器回执回归。完成标志：**无证书不能授权也不能落盘**；若旧成功题被拦，应修证据生产，不回退硬闸。

### W2：只读/作图分流与文字答题纠偏（W1 后；可与 W3 独立开发、不得提前发布）

**文件**：`problemUnderstanding.ts`、`answerAcceptance.ts`、`coordinator.ts`、`problemSolveService.ts`、`agentRunner.ts` 和对应测试。

1. RED：`text-131/143/151/158/167/176/186/204` 仅求选项时不得产生作图草稿；明确“请画/作图”的文字题进入作图；“如图”缺必要图示条件请求用户**用文字**补齐；混合题不得漏目标。E10 合并问、E15 折前、E19/E23 的既有分问保持对应；`最终答案：B（42）` 解析为 B，结构化答案真冲突/无匹配继续拒绝。
2. GREEN：路由类型固定为 `readonly-answer | drawing | drawing-and-answer | clarification`；依据原文目标 span 与用户明确动作定路由，不能由“提到立体”推断必须画图。先答后画的两个子结果分别标记，只有**图形提交**需要证书；不将文字选项的宿主校验与图的实例核验混称。
3. 验证：`npx vitest run packages/agent-core/src/problemUnderstanding.test.ts packages/agent-core/src/answerAcceptance.test.ts apps/web/src/agent/problemSolveService.test.ts apps/web/src/agent/agentRunner.test.ts`；完成标志：只读题不产生草稿，明确作图题走 W1 硬闸。

### W3：历史“画不出/画错”定向扩展（W0、W1 后）

**文件**：`planCompiler.ts`、`parametricSolidPlan.ts`、必要时 `diagramObligations.ts`/`diagramVerification.ts`、`geometry-kernel/src/witness/basePolygons.ts` 与就近测试；不进行无关构图重写。

1. RED 负例：`joint-06` 假宿主 `solid-1:e0` 不能暂存；`joint-11` 自交面环、`joint-13` 不共面面环不能靠“图像看起来像”通过；`joint-14` 垂直残差 0.6/0.73、`joint-17` 等边残差 0.65634 不能证书通过；`joint-25` 只核焦点弦的一条方程不能当全题通过。若缺原题，用确切的**合成负例**测试对应机制，报告标明不是原题回测。
2. GREEN：实体别名必须由同一暂存/合法场景生成并指向预期类型；棱柱、梯形/菱形底、折片、棱上分点优先使用已有确定性构造器；原始多面体需闭合、非自交、共面、朝向/体积与题设残差独立检查。模型可以提候选，但不能通过静默改题、任意缩放凑选项、丢掉未识别条件取得 passed；最多一次受预算约束的定向修复，失败给明确位置/原因。
3. 保留已修正项：Case 1–3 点名变换/缩放的正例与错边负例，Case 4 原题及修订版正例；缺关键命名/角度变体仅澄清。E19/E23 只加防退化回归。
4. 验证：`npx vitest run packages/agent-core/src/planCompiler.hostNotFoundAdvice.test.ts packages/agent-core/src/planCompiler.faceRingAdvice.test.ts packages/agent-core/src/solidGeometryFourCases.test.ts packages/agent-core/src/diagramObligations.test.ts packages/agent-core/src/diagramVerification.test.ts`（执行前核对最后一文件是否存在，缺则新建定向测试）；对每项正例做错边、错名、错残差的变异测试。完成标志：旧构造仍可用、错图不能取证；不可验证域仍明确拒画。

### W4：默认文字能力全开，但安全闸不可回滚（W1–W3 验收后）

**文件**：`apps/web/src/persistence/rolloutPreferences.ts`、`apps/web/src/agent/reliabilityFlags.ts`、`agentRunner.ts`、`reliabilityRollout.test.ts`。

1. RED：未配置的新安装默认 100%；已保存显式 0 仍被尊重；坏数据安全退化；同会话一致分桶；无论显式 0/100，W1 图形证书门禁始终不可关闭；`imageRereadV1` 必须 false；仅允许纯文字支持域的三视图相关能力，不恢复上传/识图。
2. GREEN：只变更文字解题能力的默认比例和依赖派生，不用“全部 flag=true”；第二模型仍需明确用户授权与预算，否则不调用。
3. 验证：`npx vitest run apps/web/src/agent/reliabilityRollout.test.ts apps/web/src/agent/agentRunner.test.ts`，再跑 W1 安全负例与 W2 路由正例。完成标志：默认全开与拒绝未经验证的图同时成立；若回滚解题能力，不能回滚 W1 硬闸。

### W5：真实用户流程、盲测与发布（W1–W4 全绿后）

**文件**：新增 `e2e/agent-certified-drawing.spec.ts`、`scripts/drawing-regression/report.test.ts`；更新 `docs/current-status.md`、本计划勾选与评测报告。旧 `e2e/agent-solid-four-cases.spec.ts` 保持覆盖。

1. 浏览器流：Case 1–4 的可信原题分别验证草稿→逐义务→用户确认→提交→一步撤销；无证书/过期证书/缺条件/错误残差不能点击提交，也不能绕过 UI 调桥提交；答案正文提交后按钮消失，二次确认无重复对象。若 `joint-*` 原文缺失，只运行对应合成负例，不在报告中记为“原题已通过”。
2. 独立留出卷：从**纯文字作图**题冻结未参与调参的样本、原文和教师/独立数值 oracle；固定 SHA-256、版本、支持域、容差及模糊题处理规则。统计 `attempted/drafted/staged/verified/committed/committedWithKnownError/clarification/unsupported`、完整义务覆盖率（分母为全部必需义务）、拒画率、误拒率及每题失败原因；文字选项分开报告。至少一次全 UI 真流程与一次独立重跑，区分确定性夹具与随机真实 Provider。
3. 付费调用前由用户确认模型/题数/请求上限/费用上限（无法获准或成本不可估就只做离线和浏览器夹具）；不读取、展示或提交 API 密钥；原始请求与逐题输出仅存 Git 忽略目录，报告只提交脱敏聚合与版本指纹。不能自动“失败后重试到成功”择优计分。
4. 检查：`npm run typecheck`、`npm test -- --maxWorkers=4`、`npm run test:docs`、`npx playwright test e2e/agent-certified-drawing.spec.ts e2e/agent-solid-four-cases.spec.ts --workers=1`、`npm run lint`、`git diff --check`；记录退出码/失败数/构建提交/题集哈希。任一未过不发布。
5. 发布闸：**已提交图的已知题设错误 0**；未核验图可点提交 0；旧已支持四题无退化；无新图像入口/无越权第二模型调用；报告公开支持边界、覆盖率与未完成案例。零错样本不是“任意题 100%”证明。发布后先监测拒画率、提交错误与重复提交，出现错图或绕闸立即停用作图提交/回滚放量，并保留复现题；不得通过关闭安全门禁恢复服务。

## 五、交付节奏与记录

依赖：`W0 → W1 → (W2 与 W3 可并行但互不改同一文件时才并行) → W4 → W5`；其中 `coordinator.ts` 的 W1/W2 变更必须顺序集成。每块至少留一条 RED 失败记录、GREEN 命令及退出码、改动文件、题目分母、剩余不支持项、提交 hash；完成一块再把 `docs/current-status.md` 的“规划/已实现/已实测”三栏对齐。若实施时仍要求“每块上传 GitHub”，先确认本轮授权与目标仓库，再逐块推送；**本次只交付文档，不提交代码、不宣称功能已经升级**。
