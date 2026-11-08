# Agent 错题与未完成问题整改实施计划

> **执行要求：** 逐任务使用 test-driven-development 与 verification-before-completion，先看失败测试再做最小实现。默认单执行者，未经用户明确授权不启动并行子代理。以下任务尚未实施。

**Goal：** 减少历史错题的机制性原因，做到题意有来源、每问有交付、答案有证据等级，且真实入口可验收。

**Architecture：** 保留现有 runtime、草稿隔离、确认提交与几何核验。扩展已有 obligation/claim 结构承载目标、状态与来源；增加答案级验收和有限数学核验；给图片建立受控重读闭环。渐进适配现有解法，不重写整个 Agent。

**Tech Stack：** 现有 TypeScript、React、Vitest、Playwright、geometry-kernel、agent-core；首期不新增通用 CAS，不强制引入 Lean 自动证明。

**Spec：** [根因报告及证据](../../audit/2026-11-08-agent-failure-root-cause-analysis.md)，基线9a4fdf1a，2026-11-08。

**状态：** 完整实施方案，待批准执行；标为“新增”的文件/接口尚不存在，文档中的预期值不代表已达成结果。第7–15节补齐接口、工作包、逐项验收、评测门槛、迁移和回滚；本轮只完善文档。

**阅读顺序：** 产品负责人看第7、11、14、15节；实施者先看根因报告，再按第8–9节逐包实施；测试/发布按第10–13节验收。

## 1. 全局约束

1. 不放宽草稿核验、用户确认、阶段工具权限与文档版本检查；模型不能直接写用户文档。
2. 缺条件时允许合理澄清；未验证回答可展示，但不得冒充已验证。
3. 复用 obligationIR.ts、claimEvidence.ts、numberedProblem.ts、verification/*。适配层不能成为第二套事实源；模型 relations、假设、选项不自动成为题设。
4. 区分实例成立、抽样通过、适用域内解析判据和形式证明。找到反例可以否证；未找到反例不等于证明。
5. 题设矛盾、能力不支持、图片不确定、协议错误分别处理，不共用无脑重试。
6. 保留4096字符修复；字符上限不同于输出token预算；超限不静默截断结论。
7. 真模型评测须显式批准模型、题量与预算，默认离线；不提交凭证、图片base64或本机任意文件内容。
8. 普通聊天、数点、选择、数值、区间、证明、作图分型验收，不强制所有回答有选项。

## 2. 分期、依赖与粗估

| 批次 | 任务 | 可交付收益 | 粗估实施量 |
| --- | --- | --- | --- |
| P0-A | T1合同、T2状态 | 减少格式失败、空答及澄清误完成 | 2–3人日 |
| P0-B | T3题意适配、T4折叠闭环 | 修目标遗漏、条件矛盾、角度不显示 | 3–5人日 |
| P1-A | T5数学核验 | 拦截错误关系、反向范围、代回失败 | 3–5人日 |
| P1-B | T6图像证据、T7三视图 | 降低漏尺寸后编题设 | 5–8人日 |
| P2 | T8题族评测、T9发布 | 验证泛化与生产入口收益 | 3–5人日，另计模型和人工标注 |

仅为任务粗估，含定向测试，不是交付承诺，不包含任意题型通用求解。依赖：T1→T2→T3→T4；T3→T5/T6；T6→T7；T8数据准备可提前，最终验收依赖所选任务完成。不在一次提交中混入全部系统。

## 3. 文件职责与拟议接口

### 3.1 文件边界

表内核心文件位于 packages/agent-core/src；图像服务位于 apps/web/src/services；生产宿主位于 apps/web/src/agent。

| 职责 | 复用/修改 | 建议新增 |
| --- | --- | --- |
| 合同与恢复 | schemas.ts、contracts.ts、modelPlanner.ts、systemPrompt.ts | 确有必要时抽 plannerRecovery.ts |
| 答案验收 | coordinator.ts、claimEvidence.ts、verification/taskAcceptance.ts | answerResult.ts、answerAcceptance.ts |
| 题意适配 | obligationIR.ts、numberedProblem.ts、rectangleFoldPlan.ts | problemUnderstanding.ts |
| 数学判据 | geometry-kernel/src/expression.ts、conics.ts | verification/mathAnswerVerification.ts |
| 视觉闭环 | problemImageFiles/Reader/Prompt/Review.ts | problemImageEvidence.ts |
| 三视图 | 现有solid编译与核验 | orthographicProblem.ts |
| 呈现 | agentRuntime.ts、agentRunner.ts、apps/web/src/agentStore.ts、components/agent/AgentMessageList.tsx | 对应定向测试 |
| 题族/评测 | deterministicProblemRoute.ts、skills/manifest.ts、scripts/real-exam-eval/* | 生产入口评测适配器、留出题清单 |

实施前确认导出点、旧会话存储与开关，不静默破坏对外合同。不为了“模块化”先拆大量与缺陷无关的文件。

### 3.2 最小接口方向（拟议）

~~~ts
// 摘要；完整可实施类型与宿主信任边界见第8.2节。
type SolveStatus = "answered" | "partial" | "needs_clarification"
  | "inconsistent" | "unsupported" | "failed"
type AnswerKind = "single_choice" | "multiple_choice" | "numeric"
  | "interval" | "proof" | "drawing" | "conversation" | "unknown"
interface GoalAnswer {
  goalId: string
  kind: AnswerKind
  displayText: string
  value?: AnswerValue // 第8.2节的判别联合，不是任意JSON。
  evidenceRefs: string[]
}
interface SolveResult {
  schemaVersion: "mathcanvas.solve.v1"
  problemRevision: string
  status: SolveStatus
  answers: GoalAnswer[]
  unansweredGoalIds: string[]
  evidence: EvidenceRecord[] // 第8.2节：身份信息+现有ClaimEvidence。
  reasonCodes: string[]
  clarificationQuestions: string[]
}
~~~

- RunPhase.completed继续表示一次计算结束；界面从SolveResult读取是否回答、部分回答、待澄清与证据等级，不重命名整套状态机代替语义层。
- T2允许旧envelope适配为“已回答但未核验”；无法可靠提取类型时保留正文并标unknown，不伪造结构和证据。
- Goal补稳定id、partId、source span、state、dependencies、expected kind；state表示折前/折后/第几次操作，不仅靠撇号猜。
- 每项题设保持parsed/ambiguous/unsupported及消费者清单。关键条件未消费不能悄悄消失。
- T5拟议verifyMathAnswer(problem, answer, budget)返回decision=supported/refuted/unknown、方法、适用域、容差、来源及反例；映射现有证据等级。抽样不得标formally_proved。
- T6拟议ImageEvidenceRef包含attachmentId、sha256、region、sourceKind，仅限本次用户授权附件，不给模型任意文件路径。

## 4. 逐任务实施清单

每项按“红测→最小实现→定向回归→审查→独立提交”执行；提交/推送按用户授权另行操作。修复期间保留旧证据快照。

### T1 / P0：合同同源与有预算的协议纠错

**修改**：schemas.ts、contracts.ts；宿主modelPlanner.ts、systemPrompt.ts。只有恢复逻辑确实需要抽离时新增plannerRecovery.ts。

**测试**：schemas.test.ts、modelPlanner.test.ts、systemPrompt.test.ts；新增模块配同名测试。

- [ ] 写失败测试：answer误带normalisations；read+plan混批；未知工具；faces索引类型错；4096/4097字符边界。正确拒绝的断言应保持通过，红测针对缺失的清晰反馈或恢复机会。
- [ ] 从共享分支定义生成合法字段说明与示例，明确normalisations仅在plan分支；继续拒绝未知字段，不通过删字段掩盖问题。
- [ ] 协议失败给错误码、字段路径、允许分支，纳入现有共享调用/时间/修复预算。可定位格式错最多一次针对性纠错；已有机会则复用，不能额外叠加重试。
- [ ] 混批全批拒绝、零部分执行；阶段内只发布合法工具。已校验的纯只读批次仍可执行，不退化为全串行。
- [ ] 验证预算耗尽、取消、错误反馈可见，记录“格式通过不等于数学正确”。

**验收**：非法批次零执行；合法批次不退化；schema、运行时与说明一致；mm-035等只做解析回放，不宣称题目端到端已解对。

### T2 / P0：答案状态与非空交付门禁

**新增**：answerResult.ts、answerAcceptance.ts及测试。

**修改**：coordinator.ts、agentRuntime.ts、agentRunner.ts、apps/web/src/agentStore.ts、components/agent/AgentMessageList.tsx。

**测试**：answerAcceptance.test.ts、agentRuntime.test.ts、agentRunner.test.ts、agentStore.runStatus.test.ts；新增components/agent/AnswerResult.test.tsx。

- [ ] 红测覆盖空白答案、请求补图却kind=answer、单选缺结论、多问漏问、内部有值但无正文。
- [ ] 按任务类型判定；空答不得标已作答。优先结构化clarification；文字中的“请补充”只能兜底提示，不能靠关键词决定所有终态。
- [ ] 分开保存答案和核验状态；未验证回答可见并明确标注未核验，缺严格证明证据不显示已证明。
- [ ] 存储新增可选版本字段；旧消息读取为unknown，不默认已验证；保留旧对话、复制和追问能力。
- [ ] UI先展示逐问回答与缺项，再放作图确认和技术细节；不改变确认提交机制。
- [ ] 测普通聊天、数点、取消、追问续答、撤销，确保兼容。

**验收**：三类本轮故障注入不再显示完整作答/已验证。T2尚不能识别的数学错误只能标未核验，不承诺单独解决错答案；合法短答案不误拦。

### T3 / P0：条件、子问、状态贯穿交付

**修改/新增**：obligationIR.ts、claimEvidence.ts、numberedProblem.ts、problemUnderstanding.ts；适配现有解析器，不同时重写所有parser。

**测试**：新增problemUnderstanding.test.ts；扩现有IR和rectangleFoldPlan.test.ts。

- [ ] 红测：合并折前/折后、①②与(1)(2)、辅助定义、题设和待证区分、矛盾条件、不同小问条件作用域。
- [ ] 目标生成稳定goalId、source span、partId、state、依赖；不能识别的原文保留unsupported，不能用空目标列表代表完成。
- [ ] 题设建立消费清单，标记哪个求解/核验器使用。未处理关键条件时partial/unknown或澄清，不忽略后继续给无条件结论。
- [ ] 按目标需求构建：只问折前不依赖折角，辅助点先定义再使用，待证结论不得成为题设。
- [ ] 做legacy round-trip、稳定ID与作用域隔离测试，保证已有几何核验读到的题设不变；先接一个题族再扩展。

**验收**：合并两问得到两个目标；条件可回指原文；小问互不污染；明确保留未读懂条件，不能仅拿解析条数当覆盖率。

### T4 / P0：闭环修复折叠题已知缺口

**修改**：rectangleFold.ts、rectangleFoldPlan.ts；复用现有状态核验。

**测试**：rectangleFold.test.ts、rectangleFoldPlan.test.ts、rectangleFoldStateVerification.test.ts；新增e2e/agent-fold-answer-coverage.spec.ts。

- [ ] 以E06/E10/E13/E15/E18/E19/E23用户可见期望写红测，不只查内部geometry。
- [ ] E18对角线条件输出前一致性检查，冲突返回题设矛盾及来源，不继续无条件回答。
- [ ] E10/E13/E23逐目标组装答案，保留折前/折后/角度，内部解出的角度必须进入正文。
- [ ] E15按依赖跳过无关折后构造；E06正方形规约为等边矩形；E19将垂足定义构建为辅助点并核验。
- [ ] 生产入口检验确认前零写入、提交后答案保留、一次撤销恢复原文档；保存新版本结果。

**验收**：原24/24满足独立核心判据；角度正文等交付另加断言，仍不等于完整证明均完成。至少12个未用于写实现的等价/边界变式，避免只追原题全绿。

### T5 / P1：有限、独立的数学答案核验

**新增**：verification/mathAnswerVerification.ts及测试；接answerAcceptance.ts，复用geometry-kernel表达式AST、坐标、圆锥曲线能力。

- [ ] 红测覆盖text-128/text-198错误答案，并加入正确答案、定义域、分母零、驻点越界、等号边界。
- [ ] 首期仅支持坐标距离与垂直依据、候选值代回、限定二次函数区间最值、参数范围边界；超域或不可解析返回unknown。
- [ ] 判据使用独立路径，防同一公式转换错误污染求解与验证；参考值手算复核入夹具，不调用受测函数生成。
- [ ] 返回适用域、证据来源、残差或反例。数值通过仅标实例/抽样；全称范围须完整区间分支分析，不能冒充形式证明。
- [ ] 数学失败后依既有共享预算最多一次证据驱动修正；仍冲突交付“未通过核验”，不循环至偶然通过。
- [ ] 宿主先做确定性核验；当前原生只读发布面没有通用expr/CAS工具，本任务不顺便暴露任意执行能力。

**验收**：两条旧错结论可否证；正确边界不误杀；随机没找到反例不得升级证明；预算/超时可见，证据引用不可伪造。

### T6 / P1：图像来源与受控局部重读

**修改/新增**：problemImageEvidence.ts、现有图像Files/Reader/Prompt/Review服务、ProblemImageComposer.tsx、agentRunner.ts、modelPlanner.ts。若公开新只读工具，更新readToolSchemas.ts、toolRegistry.ts、toolDispatch.ts及权限/parity测试。

**测试**：problemImageReader.test.ts、problemImageReview.test.ts；新增problemImagePrompt.test.ts、problemImageEvidence.test.ts；扩工具权限和planner测试。

- [ ] 红测：尺寸遗漏、主图与选项次序变化、视觉与用户编辑冲突、向量方向/坐标负号漏读。
- [ ] 保存附件句柄/hash/区域与题设映射，区分OCR、模型猜测、用户更正、已确认线条；无声明疑点不等于绝对正确。
- [ ] 仅因关键证据缺失/冲突触发指定附件局部重读。默认每题至多2次，可更严格，计入共享预算；校验裁剪坐标与附件归属，不允许跨对话或任意文件读取。
- [ ] 冲突不静默覆盖：列来源，保留用户显式更正，必要时请确认；用户更正仍须数学核验。
- [ ] 保留已修坏框回退、受限JSON修复、选项核对和未确认线条隔离，日志仅记句柄/hash/短摘要。

**验收**：结论可追到原图区域；缺尺寸不借“常见版本”补数；权限/预算不足时澄清不猜；文字题不触发视觉调用。

### T7 / P1：三视图约束建模与体积核验

**新增**：orthographicProblem.ts及测试；接T3条件、T6图像证据与现有solid编译核验。

- [ ] 以mm-005/mm-009/mm-075正确材料建来源测试，加入尺寸不足、非唯一、投影互相矛盾样例。
- [ ] 显式记录正/侧/俯视轴、尺度、格数、可见/隐藏边与单位；关键尺寸无来源时不确定唯一实体。
- [ ] 首版限制支持几何族；候选实体逐一重投影比对，两个合法候选体积不同则报告信息不足。
- [ ] 分解公式与封闭网格有向四面体求和等独立体积方法互验；检查闭合、尺度三次方、单位与容差。
- [ ] 选项只匹配计算结果，不反向改参数；失败不自动提交草稿。

**验收**：缺尺寸进入重读/澄清；非唯一不强行确定；支持族两种体积一致；不宣称解决任意三视图重建。

### T8 / P2：题族能力与双轨评测

**修改**：deterministicProblemRoute.ts、trigMonotonicityPlan.ts、skills/manifest.ts、scripts/real-exam-eval/*；新增题族适配、生产入口评测与留出题清单，保留显式live开关。

- [ ] 能力清单声明输入族、求解域、答案类型、核验方法、回退条件；复用共享表达式，减少一句措辞决定能力。
- [ ] 同式递增/递减/自然问法/限定域/多曲线回归；图像显示域不改变数学求解域。
- [ ] 旧50题仅作已暴露回归；新增100道有授权公开来源题，建议函数25、圆锥曲线25、空间/三视图25、折叠构造25，标来源、题号、原图、参考推导与目标。
- [ ] 新题按原题身份预分dev40/holdout60，同源/改数/同题变式不跨组；holdout一旦用于修复即移入开发集并补新留出题。
- [ ] 联考/模拟须核实原卷、版本、题号与参考，主观题至少双人独立复核，不自动采信网络答案。
- [ ] A轨保留旧核心模型链路作纵向比较；B轨覆盖真实AgentRunner/runPrompt、图片核对、UI、提交/撤销；已配模型与无模型本地路径分开报告。
- [ ] 每配置独立3次，逐题关联全量正确率、条件正确率、首答/修复后、遗漏、澄清、错误却声称核验通过、证据覆盖、延迟/调用量/成本；价格不明只报用量。
- [ ] 按原题聚类，3次不是300道独立题；客观正确率给样本量与Wilson区间。合理澄清计入全量未解，但另报是否必要，不鼓励瞎答。

**拟定放行门槛，需跑前预注册**：已知回归不得退化；受控注入中“错误却标已核验”须为0；留出集按同模型同入口对照报告差值和不确定性。若约定至少提升10个百分点，必须提前固定分母与配置，未达不得宣传提升。**不预先承诺90%或95%。**

### T9 / P2：灰度、迁移与发布

- [ ] 答案层、题意层、数学核验、视觉重读分别可灰度关闭；无绕过安全门禁的开关。
- [ ] 旧对话/计划/草稿迁移有测试；关闭能力不把未知证据升级为已验证，答案原文仍保留。
- [ ] fresh类型检查、定向回归、既有离线reliability、文档检查、相关e2e；按改动范围补全量和桌面构建。固定revision、flags、model profile与产物hash。
- [ ] 无模型/有模型生产入口分别可见验收；本地测试不替代provider、桌面包或远端CI。
- [ ] 发布说明分开机制修复和题集实测，用户授权后提交/推送/release。

**回滚**：先关闭新路由/重读/核验，再回退对应任务提交；保留状态诚实性与历史证据，不破坏旧会话，不放宽几何门禁。额外模型调用异常优先禁自动重读，改用户确认。

## 5. 验证方式与证据管理

当前安全离线入口：

~~~powershell
npx vitest run --config scripts/agent-failure-audit/vitest.config.mts
npx vitest run packages/agent-core/src/schemas.test.ts packages/agent-core/src/latexNormalisation.test.ts packages/agent-core/src/diagramVerification.test.ts apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/agentRuntime.test.ts apps/web/src/services/problemImageReview.test.ts apps/web/src/services/problemImageReader.test.ts --maxWorkers=2
node --test scripts/real-exam-eval/score.test.cjs
~~~

实施每项先红→绿再相关回归，最后按T9验收。本轮行为探针的“缺陷存在”断言不是永久产品标准；修复时将其更新为正确语义，并增加独立产品回归。保留本轮JSON历史快照，新结果写新目录，不覆盖旧审计事实。

真模型运行另设新输出目录、请求上限、单题时限、总预算，经确认后才开。不能由“测试绿”推出真实题成功率提升。现有文档规范检查的5文件BOM问题见根因报告，另开最小维护修复，不和数学能力整改混淆。

## 6. 建议先批准的切片

**先做T1+T2**：统一分支说明和预算化恢复，明确空答/澄清/未核验状态，兼容普通回答，不改求解算法、不增加模型调用、不放宽草稿门禁。验收后接T3/T4解决已复现折叠漏答和条件遗漏，再做独立数学核验与视觉闭环。

---

## 7. 完整执行版：范围、决策与完成定义

**本节至第15节为2026-11-08补充的执行细则。** 前六节说明方向与任务分组；接口、预算、验收的歧义以本节后的明确约定为准。全部接口均是拟实施设计，不是现有产品能力。本轮仅完善文档。

### 7.1 为什么不直接“加强提示词”

| 路线 | 好处 | 主要问题 | 决定 |
| --- | --- | --- | --- |
| 仅换模型、加提示 | 侵入小，容易试验 | 无法强制逐问交付、来源约束、核验诚实性 | 只作为对照，不作为主方案 |
| 给每道错题加专用规则 | 老题见效快 | 容易记住题目，变式失效 | 仅把原题转为回归，不写题号分支 |
| 重写通用数学Agent | 理论边界大 | 工期和回归风险不可控 | 本轮不做 |
| 复用现有架构，分层补闭环 | 每层可测试、可撤回，保留安全门禁 | 需要明确模块合同与数据迁移 | **采用** |

**本轮整改覆盖**：协议可靠性、答案交付、题设和目标、折叠题、有限圆锥曲线核验、图像重读、有限三视图，以及真实入口评测。**不覆盖**任意数学题自动证明、任意三维重建、全新CAS、模型训练、全部CAD能力、无条件90%准确率。

### 7.2 定义三个不能混淆的完成

1. **工程完成**：该任务红测→绿测、兼容测试、相关构建/检查通过，证据归档。
2. **题目答对**：按独立参考逐小问判定，答案、条件、范围、单位符合要求；“有回复”不算答对。
3. **数学已核验**：本地可信核验器对指定结论产生相应等级证据；模型自述、一次数值采样、图形看着正确都不能当严格证明。

RunPhase.completed只意味着本轮流程结束。SolveResult.status=answered只意味着目标已有可交付回答，**不意味着答案数学正确**。界面必须同时显示证据等级。被本地反例否证的答案保留在历史轨迹，但不能作为当前可交付答案。

### 7.3 一条题目的目标链路

输入/附件 → 题意与证据提取 → 目标清单 → 题族能力匹配 → 求解或澄清 → 独立核验 → 逐目标验收 → 正文与草稿分开交付 → 用户确认后才写文档。

贯穿字段：runId、problemRevision、goalId、sourceRef、evidenceId。任一目标的证据只能引用同一题目修订或经过依赖检查确认仍有效的事实，不能引用上一轮已被用户更正的尺寸。

---

## 8. 数据与模块合同：先冻结接口，再按任务实现

### 8.1 分工边界

- **题意层**回答“原题给了什么、问了什么”；不求值、不把模型猜测写成given。
- **求解器**返回候选答案和用过的条件；不自行提升证据等级。
- **核验器**只处理自己声明的输入域，域外返回unknown；不能改题目以让答案通过。
- **答案验收层**校验目标覆盖、正文、类型、证据引用和已知反例；不把格式通过说成数学正确。
- **宿主/界面**负责附件授权、预算、取消、旧会话兼容和显示；不重复实现数学判据。
- **评测器**独立比较参考答案，不直接相信产品status或verified标签。

### 8.2 首期最小答案合同

新增 packages/agent-core/src/answerResult.ts，导出下列类型；保留现有ClaimEvidence词表，不另造“证明等级”。下列类型是第3.2节的规范化补充，EvidenceRecord为引用增加身份，不修改ClaimEvidence的既有字段含义。

~~~ts
import type { ClaimEvidence } from "./claimEvidence"

export type SolveStatus = "answered" | "partial" | "needs_clarification"
  | "inconsistent" | "unsupported" | "failed"
export type AnswerKind = "single_choice" | "multiple_choice" | "numeric"
  | "interval" | "proof" | "drawing" | "conversation" | "unknown"
export type AnswerValue =
  | { kind: "single_choice"; optionId: string }
  | { kind: "multiple_choice"; optionIds: string[] }
  | { kind: "numeric"; expression: string; approximation?: number; unit?: string }
  | { kind: "interval"; expression: string }
  | { kind: "proof"; conclusion: string }
  | { kind: "drawing"; draftId: string }
  | { kind: "conversation"; text: string }
  | { kind: "unknown"; text: string }
export interface AnswerGoal {
  id: string
  kind: AnswerKind
  required: boolean
}
export interface GoalAnswer {
  goalId: string
  kind: AnswerKind
  displayText: string
  value?: AnswerValue
  evidenceRefs: string[]
}
export interface EvidenceRecord {
  id: string
  goalId: string
  problemRevision: string
  producer: "host_verifier" | "legacy_adapter"
  method: string
  evidence: ClaimEvidence
}
export interface SolveResult {
  schemaVersion: "mathcanvas.solve.v1"
  problemRevision: string
  status: SolveStatus
  answers: GoalAnswer[]
  unansweredGoalIds: string[]
  evidence: EvidenceRecord[]
  reasonCodes: string[]
  clarificationQuestions: string[]
}
~~~

**信任边界**：SolveResult由宿主产生，不直接接受模型提交的“已核验”SolveResult。模型可提候选正文、候选结构值和工具结果引用，只有宿主核验器能生成可信EvidenceRecord。producer字段本身不构成授权，必须通过内部调用来源控制。T1/T2不要求一次性改变外部模型信封：先适配现有answer，再在后续任务中增加有版本的结构输出。

**值的校验**：已识别的选择/数值/区间目标须有匹配kind的结构值；缺失时保留正文但列为未完整交付，不通过从推导中随意抓一个数字补值。旧会话适配为unknown，不伪造匹配。kind与value.kind必须一致。只接受有限数值；NaN/Infinity拒绝。选项ID来自原题列表；多选去重且与题设列表比对；区间保留开闭端点和定义域；numeric.expression不经eval执行。proof的conclusion存在只代表有结论，不代表证明正确。drawing.draftId必须引用当前运行已编译草稿，但有草稿不代表全部作图义务通过。

### 8.3 答案验收函数

新增 packages/agent-core/src/answerAcceptance.ts：

~~~ts
import type { AnswerGoal, GoalAnswer, EvidenceRecord, SolveResult } from "./answerResult"
export interface AnswerAcceptanceInput {
  problemRevision: string
  goals: readonly AnswerGoal[]
  candidates: readonly GoalAnswer[]
  evidence: readonly EvidenceRecord[]
  resolution: "answer" | "clarification" | "inconsistent" | "unsupported" | "failed"
  clarificationQuestions: readonly string[]
}
export function acceptAnswer(input: AnswerAcceptanceInput): SolveResult
~~~

acceptAnswer为纯函数，不访问模型、不写文档、不扣预算。候选答案是否可信由宿主提供证据；本函数负责引用一致性和交付裁决。若需要与现有taskAcceptance统一，使用显式适配，不把几何草稿验收直接当答案验收。

| 输入情形 | 裁决 | 显示规则 |
| --- | --- | --- |
| 所有必答目标有非空合法回答，无已知否证 | answered | 可显示“已作答”；证据不足明确“未核验” |
| 只有部分目标合格，或部分答案被否证 | partial | 展示有效部分和缺项；被否证部分不作为最终结论 |
| 需要用户补条件且没有有效答案 | needs_clarification | 显示具体问题，不显示“已解答” |
| 已有有效答案，另有待澄清小问 | partial | 同时显示答案与澄清，不吞掉已有结果 |
| 有可信冲突证据且不能继续 | inconsistent | 显示冲突条件及来源；不是“模型没算出来” |
| 能力清单不支持，且无可交付结果 | unsupported | 说明范围，不伪造解法 |
| 空/全空白、内部异常、候选全被否证且无法恢复 | failed | 明确未完成；保留原始轨迹 |

补充约束：
- evidenceRefs缺失、串goalId或串problemRevision属于无效引用，不可升级等级；记录reasonCodes。
- clarification/inconsistent不能仅凭模型一句话成立：前者须有明确缺项，后者须有可信矛盾证据；否则降级为未核验解释或failed并保留诊断。
- goals为空不能用every([])=true宣布answered。普通聊天显式创建conversation目标；未识别数学目标使用unknown目标保留全文，不能说已完整覆盖。
- 只有证明文字但无证明产物：可以answered、证据unknown；有局部验证只标局部，不给整题“已证明”。
- 一份图形实例通过几何核验，不提升全称命题的证据等级。适用域内解析判据记录method、域及残差；没有可独立校验证明产物时不标formally_proved。

### 8.4 题意合同与来源

在obligationIR.ts扩展现有IR元信息；problemUnderstanding.ts只导出同一IR的构建/适配函数，不维护独立事实库。

~~~ts
export interface SourceSpan {
  sourceId: string
  start: number
  end: number
}
export interface GoalContext {
  goalId: string
  partId: string
  source: SourceSpan
  stateId: string
  dependsOnGoalIds: string[]
  expectedKind: import("./answerResult").AnswerKind
}
export interface ConditionUsage {
  obligationId: string
  requiredForGoalIds: string[]
  consumedBy: string[]
  disposition: "used" | "redundant_proved" | "ambiguous" | "unsupported" | "unprocessed"
  explanation: string
}
~~~

元信息通过现有obligationId关联，不复制条件内容。goalId以problemRevision+原文跨度+局部序号生成，同一输入稳定；编辑题面产生新revision并重新建立依赖，不把文本排序索引当跨修订永久ID。source span的单位统一为JavaScript字符串UTF-16索引，原文与规范化文本必须维护映射，不能混用。

“未消费条件”不等于“数学答案错”：存在冗余条件，但须由解析判据证明冗余或保留待处理标记。关键条件unprocessed不能显示完整核验。未知条件不得静默删除，也不得统一误报题设矛盾。

### 8.5 数学核验与恢复合同

新增 packages/agent-core/src/verification/mathAnswerVerification.ts：

~~~ts
import type { Budget } from "../budget"
import type { ObligationIR } from "../obligationIR"
import type { GoalAnswer, EvidenceRecord } from "../answerResult"
export interface MathVerificationRequest {
  problemRevision: string
  goalId: string
  ir: ObligationIR
  candidate: GoalAnswer
}
export interface MathVerificationResult {
  decision: "supported" | "refuted" | "unknown"
  method: string
  domain: string
  reasonCodes: string[]
  counterexample?: Record<string, number>
  evidence?: EvidenceRecord
}
export function verifyMathAnswer(
  request: MathVerificationRequest,
  budget: Budget,
  signal: AbortSignal
): MathVerificationResult
~~~

首期限定为有界同步内核，循环中检查signal与geometry/time预算；不能中断的耗时求解不得直接塞进主线程。若后续引入worker或异步后端，另行版本化接口。

**同一失败不无脑重试**：protocol_error进入现有repair；missing_evidence进入受控重读；refuted_answer进入至多一次受限修正；inconsistent等待用户修订；unsupported进入明确回退；cancelled/budget_exhausted立即停止。数学修正和视觉重读复用既有总预算，不提高默认generation/network/tool限额。

| 动作 | 局部上限 | 全局预算归属 |
| --- | --- | --- |
| 协议定点纠错 | 同一错误类别至多1次 | 现有generation/network/repair计数，已有机会不再叠加 |
| 数学反例修正 | 同一goal至多1次 | 同一运行generation/network预算 |
| 视觉局部重读 | 同一运行至多2次 | generation/network/tool/time；命中缓存不发新模型调用 |
| 确定性核验 | 按判据有界 | geometry/time；不足返回unknown |

局部上限不是额外配额；即使重读次数未到2，剩余全局预算不足也必须停止。时间预算按真实经过时间计，禁止重复扣同一耗时。

---

## 9. 可执行工作包：每包独立红绿测试与评审

以下在第4节T1–T9基础上给出落地顺序。新文件必须通过agent-core/src/index.ts显式导出需要跨包调用的接口；宿主不能通过深层路径绕过公共导出。每项末尾只准备独立提交，是否实际提交/推送由用户另行授权。

### W0：冻结基线与清理已有文档门禁（先于T1）

**修改**：按字节移除以下五文件开头的UTF-8 BOM，不重编码、不改变换行：docs/audit/2026-11-05-real-exam-evaluation-protocol.md、scripts/real-exam-eval/score.cjs、scripts/real-exam-eval/score.test.cjs、scripts/real-exam-eval/vitest.config.mts、test-fixtures/real-exams-20261105/README.md。不可同时改评分规则或题面。

- [ ] 记录git revision、工作区变动、Node/npm版本及当前flags；为已有用户修改保留边界，不重置工作区。
- [ ] 重跑npm run test:docs，确认失败仍是上述编码问题；若不同先记录新原因，不按旧结果假定。
- [ ] 按字节去除开头3字节BOM，逐文件确认其余字节完全不变。
- [ ] 再跑文档检查与node --test scripts/real-exam-eval/score.test.cjs，存退出码和日志。
- [ ] 保存当前诊断JSON为不可覆盖的基线；后续探针输出改用新目录，不用改历史快照证明“已修”。

**独立交付**：无行为变化的文档门禁修复。**退出条件**：仅编码差异且门禁通过；若有其他既有失败，单独列为阻塞，不掩盖。

### W1 / T1：合同一致性与协议恢复

**改动路径**：packages/agent-core/src/schemas.ts、contracts.ts、coordinator.ts、coordinatorPorts.ts；apps/web/src/agent/modelPlanner.ts、systemPrompt.ts。测试对应schemas.test.ts、coordinator.test.ts、modelPlanner.test.ts、systemPrompt.test.ts。

**接口增量**：沿用现有RepairRequest与PlanOutcome，不另起第二个重试器；在现有诊断中携带稳定code、JSON字段path、branch和allowedChanges。错误信息不得包含凭证、整张图片或无关文档。

- [ ] 在schemas.test.ts保留非法输入拒绝绿测；在coordinator/modelPlanner测试加入“拒绝后只获一次合预算纠错”的红测。
- [ ] 为answer/plan等分支分别从共享定义生成字段说明和合法例子，normalisations只在plan说明中出现。
- [ ] 整批预检所有工具调用；遇read+plan、未知工具、错误faces类型时，执行计数保持0。
- [ ] 恢复反馈只让模型纠正字段或重发合法阶段，不允许自动删字段、执行合法子集或切换到写工具。
- [ ] 运行四个定向测试文件；覆盖取消、余额0、重复同错、合法只读批次并发。

**最小测试设计**：注入第一次含未知字段的answer、第二次合法answer；断言第一次未执行工具、repair附精确路径、总生成计数增加一次；把余额设为0后同一夹具应只调用planner一次且文档版本不变。

**验收**：4096字符合法、4097明确拒绝；空answer的schema兼容处理由T2验收层负责，不能把所有协议失败都改成运行异常。历史12信封继续按预期接受/拒绝，不以“12全放行”为目标。

### W2 / T2：逐问交付与诚实状态

**新增**：packages/agent-core/src/answerResult.ts、answerAcceptance.ts、answerAcceptance.test.ts；apps/web/src/components/agent/AnswerResult.tsx、AnswerResult.test.tsx。

**修改**：packages/agent-core/src/index.ts、coordinator.ts、events.ts；apps/web/src/agent/agentRuntime.ts、agentRunner.ts；apps/web/src/agentStore.ts、components/agent/AgentMessageList.tsx。配套现有events/coordinator/runtime/runner/store测试。

**接口**：实现第8.2/8.3节，运行事件可选携带solveResult，先读兼容再写新字段；正常终态的答案语义由宿主派生，不让模型直接决定verified。

- [ ] 先加入以下纯函数红测，不调用模型或文档服务。

~~~ts
import { describe, expect, it } from "vitest"
import { acceptAnswer } from "./answerAcceptance"
const base = {
  problemRevision: "r1",
  goals: [{ id: "g1", kind: "numeric" as const, required: true }],
  evidence: [], resolution: "answer" as const, clarificationQuestions: []
}
describe("answer delivery", () => {
  it("does not accept whitespace as a delivered answer", () => {
    const r = acceptAnswer({ ...base, candidates: [
      { goalId: "g1", kind: "numeric", displayText: " \n ", evidenceRefs: [] }
    ] })
    expect(r.status).toBe("failed")
    expect(r.unansweredGoalIds).toEqual(["g1"])
  })
  it("does not turn an empty goal list into success", () => {
    expect(acceptAnswer({ ...base, goals: [], candidates: [] }).status).not.toBe("answered")
  })
  it("keeps an unverified but nonempty answer visible", () => {
    const r = acceptAnswer({ ...base, candidates: [
      { goalId: "g1", kind: "numeric", displayText: "2", evidenceRefs: [],
        value: { kind: "numeric", expression: "2" } }
    ] })
    expect(r.status).toBe("answered")
    expect(r.evidence).toEqual([])
  })
})
~~~

- [ ] 用上述纯函数串联现有answer分支；补needs_clarification/partial/refuted的表驱动测试。模型纯文字请求补图如无结构语义，仅显示待确认提示，不靠关键词把所有回答强制归类。
- [ ] UI分行显示“第1问/第2问”、答案、缺项、核验说明；未知旧消息显示“历史回答，未重新核验”，不覆盖原文。
- [ ] 持久化字段可选；未知schemaVersion仅保留安全文本，不执行其工具/草稿，不抛错导致整个会话打不开。
- [ ] 增加浏览器测试e2e/agent-answer-delivery.spec.ts：空答不显示已解答、澄清不显示成功、未核验标签、复制正文、追问续答、停止后不再更新。
- [ ] 确认回答流程没有写文档；确认/拒绝草稿和撤销继续使用原机制。

**可见交付**：用户能分辨“回答了”“只答了一部分”“需要补图”“尚未核验”。**不包含**自动发现所有数学错解。

### W3 / T3：题意、条件与目标追踪

**新增**：packages/agent-core/src/problemUnderstanding.ts、problemUnderstanding.test.ts。**修改**：obligationIR.ts、claimEvidence.ts、numberedProblem.ts及对应测试、rectangleFoldPlan.ts适配入口。扩展而不复制已有IR。

- [ ] 红测至少包含：①②/(1)(2)、同句双问、折前/折后、撇号点、E为垂足、仅折前、子问局部条件、未知自然语言条件。
- [ ] 用第8.4节元信息关联现有条件；实现原文跨度映射、稳定goalId、stateId与依赖。
- [ ] 题设长度、模型自行选取坐标、待证明关系分别维持given/free_choice/goal角色；候选构造不能回灌原题。
- [ ] 新增条件消费记录：每个求解器报告用到的obligationId，未消费条件返回明确disposition和说明。
- [ ] 重答只复用未失效事实。用户把AB从3改成4时，依赖AB的解与证据失效；无关目标可保留。

**红测断言示例**：输入“求折前BC与折后B'C的长度”，目标数必须为2且state不同；输入“E是C在AB上的垂足”，E是construction，不是待证明命题；未知条件必须出现在unverified/usage中。

**可见交付**：多问题不会只答最后一问；缺失条件有原文定位。**阻塞条件**：若source映射不可靠，不允许以猜测跨度上线该解析器。

### W4 / T4：折叠题闭环

**修改**：packages/agent-core/src/rectangleFoldPlan.ts、rectangleFold.ts、rectangleFoldPlan.test.ts、rectangleFoldStateVerification.test.ts；apps/web/src/agent/agentRunner.test.ts。新增test-fixtures/agent-reliability/fold-holdout.json与生产入口e2e/agent-fold-delivery.spec.ts。

| 失败实例 | 施工动作 | 必须观察的断言 |
| --- | --- | --- |
| E06正方形变式 | 正方形映射到矩形约束并保留等边条件 | 进入支持族且结果正确 |
| E10折前+折后 | 两目标分开求解和交付 | 两问都有值、正文、状态 |
| E13口语长度 | 将目标语义转为length，不靠固定句式 | 不再“有计划无长度” |
| E15只问折前 | 依赖图裁掉无关折角需求 | 不追问折角，可直接给长度 |
| E18条件矛盾 | 在求解前校验对角线与边长关系 | 报冲突及来源，不继续编解 |
| E19辅助垂足E | 先构造、绑定状态、再验收目标 | 点与垂足关系均可核验 |
| E23内部角度 | 将结构结果送入答案组装 | 正文包含对应角及约135.951374°，不是只看内部值 |

- [ ] 先给上述实例加端到端交付红测，再改求解/组装；不能只测内部数值。
- [ ] 运行原24题；以人工核验参考对每个goal比较值/区间/角和证据，不只比较是否返回plan。
- [ ] 加至少12个**在实现前封存**的未见变式，覆盖缩放、换标签、不同折角、前后状态、多问、辅助点。若用于调试即转开发集，补新的留出变式。
- [ ] 场景数值容差与显示舍入分开：内部按内核容差核验，UI允许合理位数，不用字符串等值比较小数。
- [ ] 生产入口跑创建草稿、显示逐问答案、确认、撤销；约束和证据随文档版本变化失效。

**门槛**：运行前冻结原24题的支持域与目标清单，不能测试后将失败题临时改成域外。原24题逐问正确交付24/24；留出变式支持域内全部交付正确、域外明确unsupported。若未达，公开未过题号和目标，不把核心18/24改名为“全部通过”。

### W5 / T5：独立数学否证与有限判据

**新增**：packages/agent-core/src/verification/mathAnswerVerification.ts、mathAnswerVerification.test.ts。**复用**：geometry-kernel/src/expression.ts、conics.ts及现有容差。**修改**：coordinator.ts的答案核验连接和对应测试。

- [ ] 先建两道历史反例的独立测试，不把模型原推导当参考：

~~~ts
import { expect, it } from "vitest"
it("rejects the old hyperbola identity by an independent point", () => {
  const a = 1, c = Math.sqrt(5), b = Math.sqrt(c*c-a*a)
  const x = a*a/c, y = a*b/c
  const pf1Squared = (x+c)**2 + y*y
  expect(pf1Squared).toBeCloseTo(8, 10)
  expect(pf1Squared).not.toBeCloseTo(a*a+c*c, 8)
})
it("finds an ellipse counterexample inside the parameter domain", () => {
  const a = 2, b = 1, t = -1/3
  const distanceSquared = (b*b-a*a)*t*t - 2*b*b*t + a*a+b*b
  expect(distanceSquared).toBeCloseTo(16/3, 10)
  expect(distanceSquared).toBeGreaterThan(4*b*b)
})
~~~

- [ ] 实现支持域路由：点距/代回、定义域与分母、二次式闭区间最值、单调性端点及方向；每项声明前提和返回unknown的原因。
- [ ] text-128使用PF1²=c²+3a²及OP²=a²检查，得到e=√3；旧e=√5必须否证。text-198检查q(t)在[-1,1]的最大值，得到0<e≤√2/2，旧反向范围必须否证。
- [ ] 全称命题找反例即可refuted；要supported须有覆盖整个适用域的判据，随机没找到反例只能sampled/unknown。
- [ ] 反例回传模型时只给与目标相关的合法数据、失败关系和允许修正范围；最多一次、共享预算、不能改变题设。仍失败则保留诊断不交付错误终答。
- [ ] 对退化a=b、分母0、开区间端点、浮点临界、极大极小尺度、超预算、取消分别写测试。

**门槛**：已知错解被拦、正确变式不误杀；域外unknown；抽样零“已证明”升级。有限核验提升的是特定错误拦截能力，不是对任意证明题的正确保证。

### W6 / T6：图像证据和受控重读

**新增**：apps/web/src/services/problemImageEvidence.ts、problemImageEvidence.test.ts。**修改**：problemImageFiles.ts、problemImageReader.ts、problemImagePrompt.ts、problemImageReview.ts及测试；agent/modelPlanner.ts、agent/agentRunner.ts适配授权附件和预算。

**最小图像引用**：attachmentId、sha256、page、region={x,y,width,height}、sourceKind。region使用[0,1]归一化坐标，必须全在有效区域且宽高>0；旋转/裁剪时保留到原图的变换，不把缩略图坐标当原图坐标。

- [ ] 红测使用仓库小型合成图或已授权样本：尺寸缺失、数字模糊、选项遮挡、裁剪越界、附件已移除、hash改变、重复重读。
- [ ] 宿主从本次附件注册表解析引用；模型不能传D盘路径或外部URL请求随意读取。附件删除或切换会话立即失效。
- [ ] 读图事实保存原图区域、原始文字、解析值、单位、置信疑点与冲突，不保存base64到诊断日志。
- [ ] 触发重读仅针对“必需尺寸缺失/冲突/标签身份不确定”；局部读失败可请求整图一次，但计入同一个至多2次上限。
- [ ] 以sha256+region+reader profile+prompt version作缓存key；同图不同版本不误复用。重读冲突并列保存，不静默覆盖。
- [ ] 恢复后仍缺条件，转具体澄清；不得依据选项或“常见版本”补尺寸。

**门槛**：mm-005/mm-009式故障注入中，缺失数字不会被编造；可恢复案例读到正确区域，不能恢复案例明确询问。mm-075不再以无最终结论的answer显示完整完成。原图人工盲核对后才判识图内容正确，“JSON可解析”不是指标。

### W7 / T7：有限三视图与体积双核验

**新增**：packages/agent-core/src/orthographicProblem.ts、orthographicProblem.test.ts。**修改**：题族manifest、现有solid编译/核验连接及对应测试；输入复用T3/T6的条件和图像证据。

**首期支持域**：带明确尺寸和视图身份的正交轴对齐长方体及其长方体组合/轴对齐长方体切除；三视图能唯一确定所选模板。圆柱/圆锥、斜截面、任意曲面与遮挡歧义不默认支持，进入显式回退。增加新族必须独立登记前提和判据。

- [ ] 红测：主/俯/左视图身份互换、缺高、尺寸矛盾、两实体同三视图、单位错、缺口不可确定深度。
- [ ] 将带来源的视图事实匹配有限模板；不是只凭轮廓长得像就确认模型。
- [ ] 重投影候选实体，逐视图比较轮廓、孔洞/缺口与尺寸；不可观测参数保持自由度，不默认选零或某个常见数。
- [ ] 对支持族做两种独立体积：按几何分块/切除解析计算；按候选闭合网格的有向四面体体积求和。两者不能共用同一份预算体积字段；网格不闭合/退化时unknown。
- [ ] 多候选且体积不唯一必须澄清；多候选但体积相同可只回答体积，但须有覆盖候选域的不变量判据，首期没有该判据就仍澄清。
- [ ] 对选项只做结果匹配，不用选项改变候选尺寸。超出首期支持域的mm-009/mm-075不承诺自动解出，但必须不瞎补数据。

**门槛**：有限族重投影一致、两种体积一致、单位一致；非唯一不强解；若网格后端不能提供独立计算则该族只能未核验交付，不标双核验通过。

### W8 / T8：题族能力与双轨评测落地

**修改**：packages/agent-core/src/deterministicProblemRoute.ts、trigMonotonicityPlan.ts、skills/manifest.ts及测试；scripts/real-exam-eval/score.cjs、score.test.cjs。**新增**：test-fixtures/agent-reliability/dataset.schema.json、development.json、holdout.manifest.json；scripts/agent-reliability-eval/production.eval.test.ts、vitest.config.mts、README.md；e2e/agent-reliability.spec.ts。

- [ ] 能力路由先定义结构域和不支持原因，再匹配语义；三角函数递增/递减/自然问法用同一数学表达式表示，绘图显示域不取代求解域。
- [ ] 评分器先加红测：多选顺序、区间开闭、精确/小数等价、单位、缺问、合理澄清、错误却标verified、请求失败。客观题不得只搜任意正文中出现的A/B/C/D。
- [ ] 冻结题集、参考、分组和阈值后才运行live。题库清单和报告保存hash；评测人能看到holdout但实现过程中不读取其题文。
- [ ] A轨保留旧核心入口，B轨调用真实AgentRunner，浏览器端验证上传图像、显示、确认与撤销。注入式离线B轨验证状态；真模型B轨测实际求解，两者分开报。
- [ ] 旧50题只做已暴露回归；新100题40开发/60留出，按原题去重分组。3次运行只增加稳定性观测，不等于300独立题。
- [ ] 输出每goal结果、整题全对、证据、耗时、token/调用量、失败阶段、预算终止、模型配置和入口；不得过滤网络失败后只报剩余正确率。

**反过拟合约束**：holdout.manifest.json只含身份、hash和分组，留出题文/参考由评测负责人独立保管；开发流程不读取。若同一执行者无法隔离材料，必须明确标为开放验证集，不宣传为严格盲测。

**验收**：评分器对人工参考一致；可复算分母；报告标识配置与revision；同一题在多次运行中可追踪。具体数值门槛见第11节，不事后挑对本版本有利的配置。

### W9 / T9：迁移、灰度与发布

**修改**：答案结果持久化适配、能力flag配置、docs/current-status.md、CHANGELOG.md；发布工作流仅在确有必要时更改，不混入新的CI改造。

- [ ] 补旧消息/未知schemaVersion/已失效证据/被撤销草稿/切换会话测试；新代码读取旧数据不崩溃，旧数据不自动变已核验。
- [ ] 默认离线验收完成后，本地开启逐个flag；先答案语义，再题意/折叠，再数学核验，再视觉/三视图。
- [ ] 每次开启记录启动revision、flags、产物hash与用户可见变化；灰度不是静默上传用户题目。
- [ ] 跑第12节fresh门禁，整理已知失败；未经解释的失败阻止正式发布。
- [ ] 经用户明确批准后再提交、推送、打tag、构建和发布；确认产物确来自tag，而不是带未提交修改的工作区。

**退出条件**：发布说明区分已修机制与实测题集收益，提供已知限制与回退方式。没有真模型预算则只交付“离线工程验收版”，不宣称实测准确率提升。

---

## 10. 历史问题到任务、测试、验收的追踪矩阵

| 问题 | 主任务 | 产品验证 | 不接受的替代证据 |
| --- | --- | --- | --- |
| normalisations误放answer | T1 | 精确反馈+一次有预算纠错 | 自动删字段后解析成功 |
| read/plan混批 | T1 | 全批零执行+合法下一轮 | 只执行合法子集 |
| 空答/补图也completed | T2 | phase结束但solve状态诚实 | 改成功提示文案而无语义层 |
| 单选无最终选项 | T2/T3 | 与原题选项匹配的明确交付 | 推导里出现某个字母 |
| 折叠多问漏答 | T3/T4 | 每goal正文+数值+状态 | plan步骤数增加 |
| E23角度不显示 | T2/T4 | 浏览器可见对应角和数值 | 内部变量正确 |
| 题设矛盾仍继续 | T3/T4 | 冲突及原文证据可见 | 模型口头说无解 |
| 双曲线错误关系 | T5 | 原错解被独立点距否证 | 复用同一错误公式代回 |
| 椭圆范围方向错 | T5 | 区间最值/边界+反例 | 随机采样没发现问题 |
| 漏尺寸后借选项编条件 | T6/T7 | 来源审计、重读或澄清 | JSON解析成功率高 |
| 三视图高度/视图错 | T6/T7 | 身份、重投影、唯一性 | 只看渲染图像像原图 |
| 体积结果错误 | T7 | 解析/闭合网格双核验 | 两处读取同一体积缓存 |
| 改措辞路由失效 | T8 | 同源语义变式与新留出 | 原题通过 |
| 核心测试替代真实入口 | T8/T9 | B轨+浏览器+发布产物 | A轨通过即宣传产品可用 |

---

## 11. 评测设计与预注册放行门槛

### 11.1 数据清单

每道题至少保存：caseId、examName、year、paperVersion、questionNumber、source/授权说明、problemText、imageRefs/hash、answerKinds、goals、referenceAnswer、referenceDerivation、reviewers、family、split、originalProblemId。题名为“著名联考”不构成来源证明，必须对原卷版本和题号。

参考复核至少两次：客观题检查选项和原图对应关系；主观题由两名独立复核者核对每小问和关键条件。无人复核的题进入quarantined，不计主要准确率。版权不清的原卷不批量提交GitHub，仓库只留许可允许的材料和清单。

原50题中mm-000/mm-012/mm-058材料错配必须保留版本差异。需要做历史对比时分别报告“原始材料结果”和“纠正材料后重跑结果”，不把合并29/50当单轮。联考/模拟是否覆盖以已核验清单为准，不把识图专项32题当完整求解测试。

### 11.2 评分公式

- 全量整题正确率 = 所有必答小问均正确的题数 / 预注册全部有效题数。
- 条件正确率 = 正确题数 / 有可评分完整终答题数，同时报告分母。
- 逐问准确率 = 正确必答goal数 / 全部必答goal数，不能替代整题率。
- 交付率 = 有完整可评分终答题数 / 全部题数。
- 错误核验率分别报告：错误且标已核验题数/全部题数，及错误且标已核验题数/标已核验题数。
- 合理澄清单独统计必要性；在主全量解题率中不算解对。失败、超时、预算终止也保留在分母。
- 主观题全对/部分正确分开；作图另报草稿可编译、义务通过、用户确认及撤销成功，不能都压成一个成功率。

对每次运行分别报告原题级Wilson区间，配对提升用按原题聚类的重采样/不一致对计数表达不确定性。小样本区间宽，应如实呈现；三次运行不能当三倍独立样本。人工裁判对不知道版本的输出评分，争议保留记录。

### 11.3 建议默认门槛（实施前由负责人确认冻结）

| 层级 | 放行标准 |
| --- | --- |
| 安全硬门禁 | 受控注入中越权写入0；非法混批执行0；取消后新增写入0；已知反例标已核验0 |
| P0-A工程 | W1/W2定向、旧会话、状态UI与回归全部通过；不要求真实准确率在此时提升 |
| P0-B折叠 | 原24题支持域内逐问24/24；封存变式按T4标准通过 |
| P1核验 | 两类原错解稳定否证；正确边界不误杀；域外unknown；无伪证明标签 |
| P1视觉 | 故障注入零编造必需条件；有权限重读有界，缺条件澄清；不以此替代真实识图准确率 |
| P2正式收益 | 同模型同B轨同材料，留出集平均整题率至少提升10个百分点；每次均不低于基线；无题族稳定退化超过1/15题；同时报告差值区间，不把点估计当显著性 |
| 资源护栏 | 同配置B轨p95延迟不超过基线1.3倍，单题平均generation/network不超过1.25倍；上限仍受现有总预算约束 |

若基线为0或样本不足，资源比值不适用，改报绝对差并在运行前固定可接受上限。若以稳健性而非提升10个百分点为发布目标，可在开跑前改为“明确降低某类严重错误且总体不退化”的预注册方案，**不能看完结果再改主指标**。

未过收益门槛：允许交付状态诚实性等确定工程修复，但不发布“准确率提升版”的宣传结论；保留失败题、缩小支持域或继续修复，并用新的未见留出集复验。

### 11.4 真模型预算审批单

在启动前向用户列出：供应商/模型版本、A/B入口、已暴露/留出题量、每配置运行次数、最大生成/网络/工具调用、单题时限、总token上限、已知单价或仅用量、预计上界及停止阈值。100题×3次×2配置为600次题目运行，不等于600次模型请求，A/B两轨都跑还需再乘入口数。

没有价格时不报虚构金额；由用户批准总token和调用量上限。先小批冒烟再放大；429连续出现、凭证错误、预算阈值达到立即停，不继续烧预算。默认不新增付费调用。

---

## 12. 验证命令与证据归档

以下是计划中的命令，不代表本轮已执行。新增文件在对应任务落地后才能运行，使用直接Node入口避免npx启动器不稳定掩盖问题。

~~~powershell
# W1（已有文件）
node node_modules/vitest/vitest.mjs run packages/agent-core/src/schemas.test.ts packages/agent-core/src/coordinator.test.ts apps/web/src/agent/modelPlanner.test.ts apps/web/src/agent/systemPrompt.test.ts --maxWorkers=2
# W2/W3（新增文件须先实现）
node node_modules/vitest/vitest.mjs run packages/agent-core/src/answerAcceptance.test.ts packages/agent-core/src/problemUnderstanding.test.ts apps/web/src/components/agent/AnswerResult.test.tsx apps/web/src/agent/agentRuntime.test.ts apps/web/src/agent/agentRunner.test.ts --maxWorkers=2
# W4/W5（核验模块须先实现）
node node_modules/vitest/vitest.mjs run packages/agent-core/src/rectangleFoldPlan.test.ts packages/agent-core/src/rectangleFoldStateVerification.test.ts packages/agent-core/src/verification/mathAnswerVerification.test.ts --maxWorkers=2
# W6/W7（新增模块须先实现）
node node_modules/vitest/vitest.mjs run apps/web/src/services/problemImageReader.test.ts apps/web/src/services/problemImageReview.test.ts apps/web/src/services/problemImageEvidence.test.ts packages/agent-core/src/orthographicProblem.test.ts --maxWorkers=2
# 共用门禁
node --test scripts/real-exam-eval/score.test.cjs
npm run typecheck
npm run test:docs
npm run lint
npm run test -- --maxWorkers=2
npm run build --workspace @draw/web
# 新浏览器用例须先实现，provider调用使用显式离线mock
node node_modules/@playwright/test/cli.js test e2e/agent-answer-delivery.spec.ts e2e/agent-fold-delivery.spec.ts e2e/agent-reliability.spec.ts
# 桌面发布还需
npm run build --workspace @draw/desktop
~~~

已有eval:reliability等脚本必须先阅读其入口/配置确认不发live请求，再执行；名称叫eval不代表无网络。全量测试可能包含环境依赖，需记录失败分类、退出码和是否本次引入；不靠删除测试或降低断言来通过。只有文档改动的本轮不需要把这些产品命令全跑一遍。

每个工作包归档到docs/audit/artifacts/agent-reliability/<run-id>/，包含manifest.json、commands.txt、test-summary.json、goal-results.json、人工复核说明和必要截图。run-id含日期与短revision；manifest记录dirty状态与patch hash、flags、dataset/reference hash、模型/提示/reader版本、随机种子或注明不支持、起止时间、预算消耗、退出码。

只提交精简脱敏证据；原始模型日志、用户图片和凭证留在授权本地目录。不覆盖2026-11-08-current-probe基线；探针依赖ignored日志缺失时标missing，不把未跑回放计作通过。

每个任务采用：写最小失败用例 → 跑到预期失败 → 最小实现 → 跑定向绿测 → 相关回归 → 人工审查 → 更新证据 → 准备独立提交。失败必须由目标缺陷导致，不能以import不存在作为最终回归设计。接口初建时import失败只用于第一步，功能实现后需验证行为断言确实能抓住回归。

---

## 13. 迁移、灰度、失败处置与回滚细则

### 13.1 能力开关（拟新增宿主内部配置）

- answerSemanticsV1：新状态/逐问显示；回退时旧视图也必须提示核验未知，不退回“completed=解对”。
- goalTrackingV1：新目标解析和消费记录；关闭后保留原始题文和旧结果，不清空历史。
- mathVerificationV1：独立数学判据；关闭后证据降为未核验，不能沿用过期通过标签。
- imageRereadV1：自动受控重读；异常成本时优先关此项，转用户确认补图。
- orthographicTemplatesV1：有限三视图族；关闭后回退为未核验回答/澄清，不绕过现有几何门禁。

开关不是模型工具参数，不由模型开启；默认先在测试配置启用。没有用户同意不新增远程遥测。

### 13.2 存储兼容

1. 第一步读路径容忍solveResult缺失与未知版本；运行/历史消息原文保持不变。
2. 第二步事件加入可选solveResult，宿主新版本产生v1；旧消息只用legacy_adapter标未知。
3. 重放历史记录不重发模型、不自动确认草稿、不把旧verified外观当新证据。
4. 文档/题面变更后仅保留仍匹配revision与依赖的证据。撤销后草稿链接失效，正文可保留但标明场景不再存在。
5. 回滚旧代码前备份会话数据；不做不可逆全库重写，不为了兼容清掉用户对话。

### 13.3 操作性回滚流程

- 发现越权写入、错误核验标签、旧会话打不开：立即停止灰度，禁用相关新增能力，保留脱敏故障证据。
- 发现延迟/调用量超护栏：先关自动重读与数学修正，再定位消耗；不先提高总预算。
- 若只关flag不足，按W9→依赖任务的逆序回退对应提交，保留W0编码清理及必要的状态诚实性修复。
- 用最小回滚冒烟验证：旧会话打开、普通回答、缺图澄清、创建/确认/撤销草稿、取消零写入。
- 发布产物回退需明确旧tag和产物hash；数据库没有破坏性迁移时才直接切换。回滚后报告受影响范围，不声称所有历史答案被重新核验。

---

## 14. 工作量、责任与里程碑

### 14.1 责任划分

默认一个实施者串行执行；表中角色是责任，不代表已经分配人员或启动子代理。

| 角色 | 责任 |
| --- | --- |
| 实施者 | 红绿测试、模块实现、证据、兼容性、变更说明 |
| 数学复核者 | 独立参考推导、反例/边界、证明与抽样区分 |
| 测试/产品验收者 | 浏览器体验、逐问交付、旧会话、作图确认与撤销 |
| 发布负责人/用户 | 批准支持域、评测门槛、live预算、提交推送和发布 |

数学复核优先与实现独立；若暂时只有一个人，明确为单人复核，不宣称已双盲或双人审核。

### 14.2 里程碑与预计投入

前述任务粗估合计16–26人日，另给约20%–25%环境/复核缓冲，整体暂按**20–33人日**规划；不是工期承诺。题库版权整理、双人标注、真模型等待和桌面打包环境另计。实际排期在W0确认后更新，不能将人日简单理解为连续自然日。

| 里程碑 | 累计主交付 | 继续条件 |
| --- | --- | --- |
| M0：基线可复核 | W0、冻结证据、门禁清单 | 知道原有失败，不带病误判 |
| M1：先不误报完成 | W1/W2，答案/澄清/未核验可见 | P0-A硬门禁与兼容全过 |
| M2：逐问能交付 | W3/W4，折叠闭环 | 24题和封存变式按域验收 |
| M3：特定错解可拦 | W5，两类圆锥曲线及边界 | 反例有效、域外unknown、零伪证明 |
| M4：图题不补编 | W6/W7，证据重读/有限三视图 | 有界调用、来源、唯一性、双核验 |
| M5：真实收益有证据 | W8/W9，预注册对照及发布材料 | 预算批准、指标通过、用户批准发布 |

W8的题库清单/评分器可以在设计阶段准备，但默认不启动并行工作；最终live必须等配置冻结。M1可独立交付，不需要等“通用解题器”完成。

### 14.3 最主要风险与处置

| 风险 | 早期信号 | 处置 |
| --- | --- | --- |
| 老题全过、变式不行 | 原24题与留出差距大 | 停止加题号规则，收紧题族域，补新留出 |
| 核验器与解法同错 | 两者共用错误关系 | 用坐标/反例/独立网格交叉，不以双调用冒充独立 |
| 过多澄清假装稳健 |交付率下降、用户反复补充 | 只问影响目标的必需信息，主全量率保留未解 |
| 新解析器破坏旧题 | 旧回归漏问或点身份变 | 按题族灰度，回退新适配器 |
| 视觉预算暴涨 | 重读循环、同区域重复 | 全局预算+2次上限+缓存，优先关自动重读 |
| UI仍显示成功 | 仅底层状态改变 | 浏览器断言标签与正文，不只测纯函数 |
| 题库或参考有错 | 图文/题号不对应、复核分歧 | 隔离样本，改版本并重跑，不静默删错题 |
| 大改难回滚 | 多模块一提交、破坏性迁移 | 每W包独立，先兼容读再写，不全库重写 |

---

## 15. 最终交付清单与开工建议

### 15.1 每阶段都交付的材料

- [ ] 对应文件变更及边界说明，未改部分明确列出。
- [ ] 失败用例、红测原因、绿测日志和相关回归结果。
- [ ] 产品截图/录屏，展示答案状态而不只展示内部日志。
- [ ] 题目逐问验收表，区分正确、遗漏、澄清、域外、超预算。
- [ ] 配置/revision/题库/参考hash和已知限制。
- [ ] 开关与回退说明，不把未核验答案伪装成已核验。

### 15.2 本轮文档的验收，不冒充产品验收

本轮只核对方案：文件路径、接口命名与类型一致、任务覆盖所有已确认根因、测试和发布条件可执行、无占位条目、UTF-8无BOM和链接有效。未运行新设计尚不存在的产品测试，未调用真模型、未修改生产代码、未提交推送或发布。上一轮240项等测试是调查基线，不是本轮新代码成果。

**2026-11-08本轮文档复核记录**：方案UTF-8无BOM、无尾随空白、无占位条目，15个章节和W0–W9齐全，方案内本地Markdown链接有效；git diff --check通过。文档门禁初跑还暴露状态页日期与变更归档不同步及默认5秒扫描超时，已同步日期/归档记录，并以2个worker、60秒单测上限重跑：8文件中7通过/1失败，22项中21通过/1失败，剩余为前述5文件既有BOM。未改变测试断言；该门禁仍非全绿。新增未跟踪方案另作显式内容检查，不能只依赖扫描受跟踪文件的门禁。

### 15.3 建议批准的第一批

**批准W0+W1+W2，M1完成后再决定下一批。** 这批不改主要求解算法，不增加默认模型配额，不放宽安全门禁；先修合同反馈、空答误完成、逐问状态与旧会话兼容。

第一批验收重点：非法工具零执行；纠错不超预算；空答不显示已解答；缺图请求待澄清；普通短答可见且未核验；旧会话能打开；取消/确认/撤销不退化。之后按W3/W4→W5→W6/W7→W8/W9推进。**本方案不构成对付费调用、GitHub推送或正式release的授权。**
