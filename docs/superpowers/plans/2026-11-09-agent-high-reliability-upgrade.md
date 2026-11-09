# Agent 接近100%解题目标的升级实施计划

> **执行要求：** 默认单执行者；逐工作包使用 test-driven-development 与 verification-before-completion。先复现失败，再实现最小闭环，最后验证生产可达性。未经用户明确授权不启动并行子代理。本计划本身不构成模型付费或发布授权；用户已授权 W0–W4 分包提交并推送，并指示继续推进 W5–W11。

**Goal：** 在冻结题目分布和预算下，将完整解题率推向98%—99%以上，并将错误认证保持为0观测事件；不能通过拒答或修改分母实现目标。

**Architecture：** 保留现有coordinator、草稿隔离与确认机制；让题意、图证据、确定性求解、数学核验进入同一生产流程；恢复使用共享会话预算。UI和评测调用同一服务，不创建第二套协调器。

**Tech Stack：** 现有TypeScript、React、Tauri/Rust provider、Vitest、Playwright、geometry-kernel；首期不新增通用CAS或任意代码执行能力。

**Spec：** D:/draw/draw/docs/superpowers/specs/2026-11-09-agent-high-reliability-design.md

**状态：** W0 `1e4f97db`、W1 `40cb3aba`、W2 `615fd9fd`、W3 `085cd768` 已分别提交并推送；W4 已实施并推送（见 [当前状态](../../current-status.md)），W5—W11 按用户指示继续实施。下文“新增”和未勾选步骤保留为原始设计/验收清单：已落地部分以代码、测试与 [当前状态](../../current-status.md) 为准，不因方案文字自动证明全部效果。基线提交8aa2d34d，版本4.4.0。对11月8日方案已落地模块先复用，不按旧文档“未实施”状态重新造轮子。

## 全局约束

1. 所有题目进入预先冻结的全量分母；澄清、超时、拒答、能力不支持和provider失败不从完整解题率中删除。
2. 模型只产生候选；只有宿主可创建可信核验记录。选项、候选推导和模型自报置信度不能反向成为题设。
3. 保留草稿隔离、动作白名单、版本校验和用户确认；任何修复、升级、回滚均不得绕过这些边界。
4. 原方案曾仅交付文档；用户已授权执行并逐包推送 W0—W4，并指示继续 W5—W11。不得自动启用新模型、运行付费评测或发布。
5. 复用已有ObligationIR、SolveResult、Budget和核验模块，不新建与其竞争的事实库或第二个运行协调器。
6. 证明、数值实例、抽样和图形验收分开表示；没有形式证明产物不得标为formally_proved。
7. 每个工作包必须提交真实生产入口到目标模块的运行证据；只有导出、单元测试或测试专用注入不能算完成。
8. 未获明确授权不启动并行子代理；实施过程中默认单执行者，角色分工不等于已授权并发。

## 0. 如何使用本计划

产品负责人先读设计文件第1—3、5—7节；W0→W4 已完成工程接线，W5—W11 按用户指示继续逐包推进，每包均须单独审查和回滚。命令在D:/draw/draw执行。下面展示的是原拟新增测试/接口的设计契约：已落地部分以实际代码为准，不能照抄未核对的示意类型；未实施部分仍按契约实现。测试中直接注入候选只可测试核验单元，不能冒充生产入口验收。

### 0.1 必须避免的旧问题

- 模块有测试、无生产消费者；开关能返回true、行为却不变。
- 以completed/answered代替解题正确；仅造conversation目标掩盖子问缺答。
- 评分器调整只重算新版本，或给失败题换分母。
- 同一个错误模型负责出题意、解题、审核，然后自称三重验证。
- 全量结果取多轮最好值；重复样本按独立题扩大置信度。
- 只是增加预算/重试次数，未修故障定位和状态恢复。

### 0.2 工作包概览

| 包 | 交付 | 依赖 | 工程人日粗估 |
|---|---|---|---:|
| W0 | 可信评分与新旧双轨基线 | 无 | 2—3 |
| W1 | 题目身份、真实子问、证据绑定 | W0 | 3—4 |
| W2 | 从识图起共享预算、取消、追踪 | W1 | 3—5 |
| W3 | 单一生产解题服务和共同验收出口 | W1、W2 | 4—6 |
| W4 | 图像证据与定向重读闭环 | W3 | 4—7 |
| W5 | 工具schema/引用的有限恢复 | W3 | 3—4 |
| W6 | 数学核验与题族扩展 | W3 | 5—8 |
| W7 | 三视图候选与反投影 | W4、W6 | 6—10 |
| W8 | 风险路由与独立候选 | W4—W7 | 3—5 |
| W9 | 逐问呈现与作图一致性 | W3、W6、W7 | 2—4 |
| W10 | 数据与真实入口多层评测 | W0起准备，最终依赖W4—W9 | 4—6 |
| W11 | 开关依赖、灰度、回滚与发布证据 | W10 | 2—3 |

总计41—65工程人日，另计标注、授权、API与人工审阅。日期不作承诺；若门槛未达成，继续开发或缩小对外承诺，而不是修改冻结分母。

## 1. 统一合同与文件职责

### 1.1 现有模块复用清单

| 职责 | 绝对路径 | 本轮动作 |
|---|---|---|
| 运行协调 | D:/draw/draw/packages/agent-core/src/coordinator.ts | 保留状态机，统一候选验收与恢复出口 |
| 答案合同/验收 | D:/draw/draw/packages/agent-core/src/answerResult.ts；D:/draw/draw/packages/agent-core/src/answerAcceptance.ts | 使用真实目标和绑定证据，兼容旧会话 |
| 题意/条件 | D:/draw/draw/packages/agent-core/src/problemUnderstanding.ts；D:/draw/draw/packages/agent-core/src/obligationIR.ts | 真入口调用，未识别目标不假装完成 |
| 数学判据 | D:/draw/draw/packages/agent-core/src/verification/mathAnswerVerification.ts | 接入可信facts，再扩展规则 |
| 图像证据 | D:/draw/draw/apps/web/src/services/problemImageEvidence.ts | 接审计、冲突、重读计划 |
| 三视图 | D:/draw/draw/packages/agent-core/src/orthographicProblem.ts | 复用已有两实体族，不扩张名称替代能力 |
| 模型规划 | D:/draw/draw/apps/web/src/agent/modelPlanner.ts | 接统一预算、结构化候选、定向修复 |
| 生产宿主 | D:/draw/draw/apps/web/src/agent/agentRunner.ts；D:/draw/draw/apps/web/src/agent/agentRuntime.ts | UI/评测同服务，保留确定性路由与会话钉住 |
| 原图入口 | D:/draw/draw/apps/web/src/components/agent/ProblemImageComposer.tsx | 识图即建立会话，原附件传递到求解 |
| 开关 | D:/draw/draw/apps/web/src/agent/reliabilityFlags.ts | 增加实际消费与兼容检查 |

### 1.2 拟议合同（新增，W1—W3实现）

核心放D:/draw/draw/packages/agent-core/src/solveContext.ts，不从核心包反向import应用层图像服务：

~~~ts
import type { ProblemUnderstanding } from "./problemUnderstanding"
import type { GoalAnswer, EvidenceRecord, SolveResult } from "./answerResult"

export interface SourceAttachment {
  attachmentId: string
  sha256: string
  page: number
}
export interface ProblemSource {
  runId: string
  conversationId: string
  prompt: string
  attachments: readonly SourceAttachment[]
  corrections: readonly { id: string; text: string }[]
  sceneRevision: string
}
export interface SolveContext extends ProblemSource {
  problemRevision: string
  sourceRevision: string
  understanding: ProblemUnderstanding
}
export interface BoundEvidenceRecord extends EvidenceRecord {
  candidateHash: string
  sourceRevision: string
  verifierVersion: string
}
export type HashText = (text: string) => Promise<string>
export function createSolveContext(source: ProblemSource, hash: HashText): Promise<SolveContext>
export function candidateHash(answer: GoalAnswer, hash: HashText): Promise<string>
export function bindHostEvidence(
  context: SolveContext, answerHash: string, record: EvidenceRecord,
  verifierVersion: string
): BoundEvidenceRecord
export function acceptSolvedCandidate(input: {
  context: SolveContext
  candidates: readonly GoalAnswer[]
  candidateHashes: Readonly<Record<string, string>>
  evidence: readonly BoundEvidenceRecord[]
  resolution: "answer" | "clarification" | "inconsistent" | "unsupported" | "failed"
  questions: readonly string[]
}): SolveResult
~~~

上面是函数签名契约，不是可直接粘贴的实现文件。生产createSolveContext必须调用understandProblem；目标来自其结果，不能来自模型的requiredGoalIds。哈希使用稳定序列化、SHA256；附件排序和用户修正顺序规则固定并测试。prompt使用原文，不改span。

problemRevision绑定题面/附件/修正，sceneRevision单独保存；sourceRevision还包含有效图证据修订。候选hash至少覆盖goalId、kind、结构值与关键数学结论，不含随机时间。模型数据经过schema后仍不是BoundEvidenceRecord；bindHostEvidence只能由宿主核验通道调用，不能作为模型工具暴露。

旧EvidenceRecord新增绑定字段可选以保持读取兼容；新流缺绑定字段不能升级可信标签。新合同只增加宿主上下文，不强迫改变所有旧SolveResult持久化版本；未知版本依旧按历史未核验处理。

### 1.3 会话与生产服务（W2—W3实现）

应用层新增D:/draw/draw/apps/web/src/services/solveSession.ts、D:/draw/draw/apps/web/src/agent/problemSolveService.ts。

~~~ts
export type CallPurpose = "vision" | "plan" | "repair" | "independent"
export interface RequestReservation {
  id: string
  purpose: CallPurpose
  inputTokens: number
  maxOutputTokens: number
}
export interface SolveSessionLimits {
  requests: number
  inputTokens: number
  outputTokens: number
  wallTimeMs: number
}
export interface SolveSession {
  readonly id: string
  readonly signal: AbortSignal
  reserve(purpose: CallPurpose, inputTokens: number, maxOutputTokens: number): RequestReservation | null
  settle(id: string, usage?: { inputTokens: number; outputTokens: number }): void
  cancel(reason: string): void
  pauseForUser(): void
  resume(): boolean
  snapshot(): { requests: number; inputTokens: number; outputTokens: number; pending: number }
}
export function createSolveSession(id: string, limits: SolveSessionLimits, now: () => number): SolveSession
~~~

会话预算是现有Budget的应用层适配，不另建独立放行通道；所有provider调用必须通过reserve，拒绝后不得调用。原生层的内部网络重试也须计入尝试/usage，不能假定一次IPC只发一次HTTP。输出预留按请求上限封顶，失败也结算或保留预留，settle幂等；重复settle不释放两次。

problemSolveService抽取agentRunner现有路由与运行构建，UI继续负责事件呈现；不是复制一份runner。测试宿主注入场景、附件、provider transport，但不能注入已经完成的SolveResult。注册一个可复用生产场景测试驱动，其接口在W3定义，供W4—W9复用。


### 1.4 生产服务边界与预算唯一扣账点

W3的生产服务使用以下明确签名（类型从现有模块导入，新增类型在1.2/1.3定义）。生产只允许服务选择planner，评测不能注入finished答案：

~~~ts
import type { RunContext, RunEvent } from "@draw/agent-core"
import type { AgentRuntime, AgentRuntimeDependencies } from "./agentRuntime"
import type { ModelPlannerDependencies } from "./modelPlanner"
import type { AgentReliabilityFlags } from "./reliabilityFlags"
import type { SolveContext } from "@draw/agent-core"
import type { SolveSession } from "../services/solveSession"

export interface ProblemSolveRequest {
  context: SolveContext
  session: SolveSession
  run: RunContext
  flags: AgentReliabilityFlags
  imageNotes: string
}
export interface ProblemSolveHost {
  runtime: Omit<AgentRuntimeDependencies, "planner" | "budget" | "runId">
  modelPlanner?: ModelPlannerDependencies
}
export interface ProblemSolveHandle {
  runtime: AgentRuntime
  events: AsyncIterable<RunEvent>
}
export function startProblemSolve(
  host: ProblemSolveHost, input: ProblemSolveRequest
): Promise<ProblemSolveHandle>
~~~

实现服务抽取而不复制原selectPlanner；context.runId、session对应运行、run.runId和会话身份必须在启动前一致。返回runtime是为了保留现有confirm/discard/stop能力，评测只读events，未经确认不得调用commit。runtime.dependencies新增上下文/核验注入项时向后兼容并明确新版必传。

**扣账所有权：** coordinator负责逻辑generation和工具预算；session负责整次任务provider请求与token、自动执行时间；现有network预算映射至session同一本请求账，不能两处独立放行或两次扣同一attempt。使用reservation.id贯穿模型日志/原生request；一次传输只扣一次，修复和重试新建reservation。默认档generation/network映射上限均不超过8；高精度显式传入上限12及对应time/tool覆盖，不能保留旧generation=8却宣称12次完整能力；actions_per_stage=32、actions_per_run=128继续保持，除非单独评审修改。若原生adapter内存在不可观测的自动HTTP重试，在session模式停用隐式重试，由应用预算控制显式新attempt；不能只统计IPC却宣称包含全部网络尝试。

**图证据更新：** W4新增applyImageAudit(context: SolveContext, audit: ImageEvidenceAudit, hash: HashText): Promise<SolveContext>，放problemImagePipeline.ts。它保留原始文本span，不接受模型改原文；审计内容按稳定规则生成新sourceRevision，使旧证据失效。用户真正修改题干时重新createSolveContext，不能只更新imageNotes而沿用旧problemRevision。

**生产服务必测用例：** 同一原题分别走UI适配器和服务评测，断言problemRevision、requiredGoalIds、路由、预算策略相同；只允许UI会话ID、时间、随机对象ID不同。不得靠“测试直接调用verifyMathAnswer”代替此项。


---

## W0. 先让统计与评分可信

**文件：**
- 修改D:/draw/draw/scripts/agent-reliability-eval/report.cjs；新增同目录report.test.cjs。
- 修改D:/draw/draw/scripts/real-exam-eval/score.cjs及score.test.cjs；保留旧extractChoice不变，新增版本化提取入口。
- 新增D:/draw/draw/scripts/agent-reliability-eval/regrade.cjs及regrade.test.cjs。

**输入/输出：** 输入不可变原始记录；输出legacy-option-v1、structured-final-v2及完整解题审阅状态，不能覆盖原始分数。新增extractFinalChoiceV2(text)返回唯一终答或null；优先结构化AnswerValue，其次最后一个明确终答句，最后才用无冲突“选 B”。多次相互矛盾的最终答案必须ambiguous，不简单取最后一次掩盖冲突。

- [ ] 写下列失败测试及多最终答案冲突、provider失败、未审结、零分母、重复题号测试。

~~~js
const assert = require('node:assert/strict')
const { summarize } = require('./report.cjs')
const result = summarize({ cases: [
  { correct: true }, { correct: true }, { correct: true },
  { correct: null, clarification: true }
] })
assert.equal(result.totals.fullAccuracy, 0.75)
assert.equal(result.totals.scoredAccuracy, 1)
~~~

- [ ] 运行node --test scripts/agent-reliability-eval/report.test.cjs，确认旧分母测试失败（当前会出现1.5）。
- [ ] 将scored类别作为明确互斥谓词逐题累计；clarification/providerFailed若与correct=true矛盾，数据验证报错，不能继续静默聚合。full denominator始终N。
- [ ] 新评分规则给mm-034提取B；mm-008中间讨论C、最终A可提取A；两个相互矛盾的“最终答案”不得自动合并。普通证明不强制提选项。
- [ ] 运行node --test scripts/real-exam-eval/score.test.cjs scripts/agent-reliability-eval/report.test.cjs scripts/agent-reliability-eval/regrade.test.cjs；预期0失败。
- [ ] 同一新评分器离线重评两轮已有50题；保存新artifact，不调用API、不改旧31/50与32/50记录；提交审查补丁，不自动git commit。

**验收：** 所有比例在[0,1]或null，分组相加等于总体；报告清楚区分选项与完整解题；基线包含未审阅推导数量。

## W1. 真实目标、题目身份与证据绑定

**文件：**
- 新增D:/draw/draw/packages/agent-core/src/solveContext.ts、solveContext.test.ts。
- 修改D:/draw/draw/packages/agent-core/src/answerResult.ts、answerAcceptance.ts及对应测试、index.ts。
- 复用D:/draw/draw/packages/agent-core/src/problemUnderstanding.ts；仅扩展已复现的目标解析缺口。

**接口：** 按1.2契约；acceptSolvedCandidate内部调用既有acceptAnswer，不能复制另一套评分状态机。

- [ ] 写独立题面身份红测，hash在测试使用真实Node SHA256，生产由WebCrypto/宿主注入。

~~~ts
import { createHash } from "node:crypto"
import { expect, it } from "vitest"
import { createSolveContext } from "./solveContext"
it("空画布不让两道题共享题面身份", async () => {
  const hash = async (text: string) => createHash("sha256").update(text).digest("hex")
  const base = { runId: "r1", conversationId: "c1", attachments: [], corrections: [], sceneRevision: "empty-scene" }
  const a = await createSolveContext({ ...base, prompt: "求AB的长度" }, hash)
  const b = await createSolveContext({ ...base, prompt: "求CD的长度" }, hash)
  expect(a.problemRevision).not.toBe(b.problemRevision)
})
~~~

- [ ] 运行node node_modules/vitest/vitest.mjs run packages/agent-core/src/solveContext.test.ts；确认未实现/错误身份失败。
- [ ] 实现稳定身份、调用understandProblem、从真实goals派生AnswerGoal；数学题解析无目标时显式unknown/partial，不默认conversation。
- [ ] 加候选A的证据用于候选B、用户更正后旧证据、跨会话附件、同目标重复候选、两问只答一问、折前/后混用测试；错误绑定均不得获得可信认证。
- [ ] 测试非数学聊天仍可完整交付；旧会话正文保留但未核验；未知结构版本不崩溃。
- [ ] 运行solveContext、answerAcceptance、answerResult、problemUnderstanding四组测试与npm run typecheck；检查补丁只覆盖本包范围。

**验收：** 同一场景不同题有不同修订；每个必答子问有独立状态；变更题设/候选即使旧证据失效；不影响普通聊天。

## W2. 全会话共享预算、取消与追踪

**文件：**
- 新增D:/draw/draw/apps/web/src/services/solveSession.ts、solveSession.test.ts。
- 修改D:/draw/draw/apps/web/src/services/problemImageReader.ts及测试、D:/draw/draw/apps/web/src/agent/modelPlanner.ts及测试。
- 修改D:/draw/draw/apps/web/src/components/agent/ProblemImageComposer.tsx；必要时扩展现有Budget适配，不改全局默认值掩盖问题。
- 审计D:/draw/draw/apps/desktop/src-tauri/src/providers/adapter.rs和commands/providers.rs内部重试；只有发现绕过账本时修改，并增加Rust测试。

**接口：** 1.3；profile/revision快照、会话取消、预算和诊断都由同一session携带。识图到发送沿用session；用户明确新建另一道题才创建新账本。wallTimeMs约束自动执行段累计时间，人工核对阶段由宿主pauseForUser/resume明确暂停计时，但请求/token不重置；会话绝对存活最长30分钟，过期resume返回false并提示重新发起，不静默续费。

- [ ] 写红测，证明识图用掉的额度不会在规划时消失。

~~~ts
import { expect, it } from "vitest"
import { createSolveSession } from "./solveSession"
it("识图和计划共用一个额度", () => {
  const s = createSolveSession("s1", { requests: 1, inputTokens: 1000, outputTokens: 1000, wallTimeMs: 1000 }, () => 0)
  const r = s.reserve("vision", 100, 200)!
  s.settle(r.id, { inputTokens: 90, outputTokens: 100 })
  expect(s.reserve("plan", 100, 200)).toBeNull()
  expect(s.snapshot().requests).toBe(1)
})
~~~

- [ ] 运行node node_modules/vitest/vitest.mjs run apps/web/src/services/solveSession.test.ts确认红测。
- [ ] 将所有模型网络入口接入调用前预留；vision/repair/continuation/独立候选均相同规则，不允许旁路调用。输入token估计与已报告usage分列。
- [ ] 实现截止时间、取消传播、原生cancel、settle幂等、无usage保守结算；缓存命中记录cached且不假装实时调用。
- [ ] 故障测试：第9次默认请求不得出网；重读耗尽仍有明确终态；取消后晚返回不写回；窗口切换不串会话；无usage不为0账单；并发预留无超卖。
- [ ] 跑solveSession、problemImageReader、modelPlanner相关测试及typecheck；若改Rust则运行node scripts/toolchain.mjs cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml。

**验收：** 真实传输调用计数与会话账本一致；默认8、高精度12的总限额含识图，不是每阶段各8/12。

## W3. 接通唯一生产解题流程

**文件：**
- 新增D:/draw/draw/apps/web/src/agent/problemSolveService.ts、problemSolveService.test.ts。
- 修改D:/draw/draw/apps/web/src/agent/agentRunner.ts、agentRuntime.ts及测试。
- 修改D:/draw/draw/packages/agent-core/src/coordinator.ts及测试：只读回答和作图两个出口都走acceptSolvedCandidate。
- 新增D:/draw/draw/apps/web/src/agent/fixtures/productionSolveScenario.ts，作为后续包的生产流程测试宿主。

**接口：** problemSolveService使用W1上下文、W2会话，复用原selectPlanner与routeDeterministicProblem。不得删除确定性题族、离线兜底、会话钉住和草稿确认。

测试宿主导出下列接口，内部真实调用problemSolveService，只有transport等I/O可模拟。工作区必须使用现有cad/conics/geometry3d；函数、数列等纯数学回答不是重启已退役的calculus工作区：

~~~ts
export interface ProductionScenario {
  prompt: string
  workspace: "cad" | "conics" | "geometry3d"
  providerReplies: readonly unknown[]
  attachments?: readonly { name: string; bytes: Uint8Array }[]
  flags: "legacy" | "reliability"
}
export interface ProductionScenarioResult {
  stageNames: string[]
  solveStatus: string
  unansweredGoalIds: string[]
  requiredGoalCount: number
  providerCalls: number
  liveWrites: number
}
export function runProductionScenario(input: ProductionScenario): Promise<ProductionScenarioResult>
~~~

- [ ] 写“2个必答目标只返回一问不能completed”的生产入口红测；providerReplies是合法模型信封，不注入SolveResult。
- [ ] 运行node node_modules/vitest/vitest.mjs run apps/web/src/agent/problemSolveService.test.ts，确认当前旁路无法满足。
- [ ] 抽出共同服务，接createSolveContext→路由→现有runtime→逐问核验→交付。观测事件增加understand/verify/accept，携带revision、goalId、attemptId，不记录密钥或整张base64。
- [ ] schema扩展模型候选goalAnswers，旧answer只能按真实题型适配；无法唯一对应的多问回答保留partial，不能凭非空正文凑完整。
- [ ] 写legacy/reliability开关对照、确定性路由、模型路由、无provider离线、读场景工具、awaiting_confirmation五类可达测试。
- [ ] 加生产否证测试：替换verifyMathAnswer为只记录调用的spy但保留实际判定，错误候选必须触发真实核验并阻断；只断言函数被调用不够。
- [ ] 跑problemSolveService、agentRunner、agentRuntime、coordinator全定向测试，确认liveWrites=0直到用户确认。

**验收：** 新旧路径显式分流；新版不存在绕开共同验收的answer/plan出口；新增模块的命中轨迹来自UI相同入口，而不是评测独有入口。

## W4. 从图像定位升级为可用证据

**文件：**
- 新增D:/draw/draw/apps/web/src/services/problemImagePipeline.ts、problemImagePipeline.test.ts。
- 修改D:/draw/draw/apps/web/src/services/problemImageEvidence.ts、problemImageReader.ts、problemImagePrompt.ts及相关测试。
- 修改D:/draw/draw/apps/web/src/components/agent/ProblemImageComposer.tsx和W3服务；原附件引用不能只剩imageNotes字符串。

**接口：** 新增requiredImageGaps(target: "volume" | "graph-choice", facts: readonly ImageEvidenceFact[]): ImageEvidenceGap[]，放problemImageEvidence.ts；调用已有auditProblemImage、planImageReread和mergeImageEvidence。返回gap不等于已解决，重读结束必须再审计。

- [ ] 写“图1不能当体积尺寸”的红测。

~~~ts
import { expect, it } from "vitest"
import { requiredImageGaps } from "./problemImageEvidence"
it("只有定位标签仍缺体积输入", () => {
  const gaps = requiredImageGaps("volume", [{
    id: "f1", text: "图1", confidence: "high",
    ref: { attachmentId: "a1", sha256: "a".repeat(64), page: 1,
      region: { x: 0, y: 0, width: 1, height: 1 }, sourceKind: "ocr" }
  }])
  expect(gaps.some(g => g.required && g.code === "missing_dimension")).toBe(true)
})
~~~

- [ ] 跑problemImageEvidence测试确认缺口；建立mm-005、mm-009、mm-012、mm-024、mm-068的脱敏失败回放，不把参考答案给模型。
- [ ] 实现原图/裁图坐标回映、目标所需尺寸和拓扑字段、完整JSON/截断检查；重读请求指明缺失字段和区域。
- [ ] 2次重读总限额、重复无变化停止、冲突保留、用户修正优先；model_guess不能通过“置信度high”提升为given。
- [ ] 图形选项解析零点/极值/符号，文字解析成功但选项图没解析不能直接终答。
- [ ] 测不清晰图、缺图、裁图映射、跨会话附件、篡改hash、OCR注入、超过预算；任何情况下不从选项倒推尺寸。
- [ ] 跑相关服务单测和problemSolveService生产集成测试；每题图审计和重读次数写轨迹。

**验收：** mm-005若仍只有“图1”，必须先重读或明确未完成，不能猜棱锥；这是安全验收，不等于完整解题成功。成功率验收还要求清晰题图能提取足够条件并求解。

## W5. 计划协议与证据引用的定向恢复

**文件：**
- 修改D:/draw/draw/apps/web/src/agent/modelPlanner.ts、D:/draw/draw/packages/agent-core/src/schemas.ts和contracts.ts。
- 新增D:/draw/draw/packages/agent-core/src/planRecovery.ts、planRecovery.test.ts；coordinator消费恢复决定。
- 修改D:/draw/draw/apps/web/src/agent/systemPrompt.ts时仅更新由注册表生成的示例，不复制静态动作表。

**接口：** 新增decidePlanRecovery(input)返回repair/stop；输入必须包含失败类型、已用schema修复次数、引用修复次数、可引用真实ID和总预算剩余。恢复提示限长继续保留4096字符纪律，不能截掉关键字段错误。

~~~ts
export interface PlanRecoveryInput {
  failure: "schema" | "tool_reference" | "auth" | "cancelled"
  schemaRepairsUsed: number
  referenceRepairsUsed: number
  callsRemaining: number
  availableResultIds: readonly string[]
}
export function decidePlanRecovery(input: PlanRecoveryInput):
  { action: "repair"; allowedResultIds: readonly string[] } |
  { action: "stop"; reason: string }
~~~

- [ ] 红测：缺alias只允许修一次；已用一次再次缺失必须stop；auth/cancelled永不repair；预算0不出网。

~~~ts
expect(decidePlanRecovery({ failure: "schema", schemaRepairsUsed: 1,
  referenceRepairsUsed: 0, callsRemaining: 8, availableResultIds: [] }).action).toBe("stop")
~~~

- [ ] 运行node node_modules/vitest/vitest.mjs run packages/agent-core/src/planRecovery.test.ts确认红测。
- [ ] schema与工具例子从availableActions生成；修alias、字段x/y和空actions的消息必须指出具体字段与合法形式。纯answer不再生成空plan。
- [ ] 工具返回可复制引用ID表，修复仅能选当前真实结果；若所需工具未执行，走有权限的真实执行，不伪造ID。
- [ ] 用mm-022/mm-051/mm-063/text-176测格式恢复；mm-029/mm-055/mm-066/text-190测错引用；安全门禁不弱化。
- [ ] 跑planRecovery/schema/coordinator/modelPlanner测试；增加重复修复、工具调用副作用幂等、过期引用回放。

**验收：** 注入的可恢复协议错误恢复后正常交付；不可恢复错误有明确原因；真实API格式失败率目标<1%，由正式数据证明，不以mock成功代替。

## W6. 数学核验与第二批题族

**文件：**
- 修改D:/draw/draw/packages/agent-core/src/verification/mathAnswerVerification.ts及测试。
- 新增D:/draw/draw/packages/agent-core/src/verification/trustedFactAdapters.ts及测试。
- 新增D:/draw/draw/packages/agent-core/src/verification/sequenceChecks.ts及测试、functionChecks.ts及测试。
- 如需精确有理数，新增D:/draw/draw/packages/geometry-kernel/src/rational.ts及测试；复用expression.ts安全AST，不eval。
- 修改D:/draw/draw/packages/agent-core/src/capabilityManifest.ts及测试，把支持域写成能力事实。

**接口：** trustedFactAdapters仅从context的来源绑定条件生成既有MathFact[]；模型提供的坐标只能作candidate待验，不可直接当facts。sequenceChecks导出evaluateContinuedFraction(coefficients: readonly bigint[]): { numerator: bigint; denominator: bigint }，表示1+1/(a1+1/(a2+...))；禁止零/负系数输入本规则。

- [ ] 写text-128、text-198、mm-012、text-203机制红测，不按题号写特殊分支。

~~~ts
import { expect, it } from "vitest"
import { evaluateContinuedFraction } from "./sequenceChecks"
it("全1连分数不是整体单调递减", () => {
  const b2 = evaluateContinuedFraction([1n, 1n])
  const b3 = evaluateContinuedFraction([1n, 1n, 1n])
  expect(b2).toEqual({ numerator: 3n, denominator: 2n })
  expect(b3).toEqual({ numerator: 5n, denominator: 3n })
  expect(b3.numerator * b2.denominator > b2.numerator * b3.denominator).toBe(true)
})
~~~

- [ ] 跑sequenceChecks与mathAnswerVerification红测；再实现有理数计算、反例证据、适用域检查。
- [ ] 垂足必须同时满足落在线上及垂直，不接受P=(a,b)只因在渐近线上；椭圆范围分端点/顶点；绝对值在跨符号区间保留分段。
- [ ] 核验器输出supported/refuted/unknown；只有覆盖目标与前提的supported可认证。refuted不只是日志，必须影响acceptSolvedCandidate。unknown保留保守标签，不能写pass。
- [ ] 对所有事实适配器加题设来源篡改、错误单位、退化参数、分母0、区间开闭端点、非有限数及超时测试。
- [ ] 连分数反例只否证单调性；一般序列正确结论需递推/归纳检查，不用前10项相符宣布证明。
- [ ] 平面/概率统计独立适配器按冻结题型逐一补齐；每个加入capabilityManifest前有正确/错误/域外三类生产测试，未完成不得通过G3。
- [ ] 跑verification目录、几何内核新增模块及生产问题服务测试；加入对反例否证被忽略的突变测试。

**验收：** 已知错题机制能泛化到改数、改字母、换问法；错误不会再被标已核验；不是仅把错题变拒答，还需正确变式完成率达到验证门槛。


### W6子包与精确反例（必须逐个交付，不能笼统写“增加数学能力”）

**W6-A 圆锥曲线及定义域：** 扩现有trustedFactAdapters/mathAnswerVerification。双曲线a=3、b=4、c=5，渐近线y=(4/3)x，F2=(5,0)，正确垂足P=(9/5,12/5)，|OP|=3；错误P=(3,4)虽然在渐近线上但不垂直，必须refuted。椭圆a=2、b=1时e=√3/2，顶点参数u=-1/3落域，不能接受“所有P到上顶点距离≤2b”；a=√2、b=1时边界成立。每个用例通过生产事实适配器，不能将期待结论直接写入facts。

**W6-B 函数/绝对值/图形选项：** functionChecks.ts增加函数定义域与分段采样反例检查。f(x)=|sin(x)cos(x)|，候选g(x)=sin(2x)/2，在x=3π/4时分别1/2和-1/2，必须refuted。给正确绝对值表达式时可继续做适用域内解析规则检查；只采样通过只能sampled。新增单位弧度/角度、端点非定义、连续性断点用例。

**W6-C 数列/有限算术：** sequenceChecks.ts用有理数计算，n=2和n=3的反例已定义；对全部正整数系数的奇偶单调结论，注册有前提的递推规则并逐步检查归纳，不把具体全1例子当一般证明。新增巨整数、分母0、系数不正、n=1边界、预算用尽测试。

**W6-D 有限概率与平面基础：** 新增D:/draw/draw/packages/agent-core/src/verification/discreteProbabilityChecks.ts及测试、planeGeometryChecks.ts及测试。首批只支持有限等可能样本、无放回组合计数、三角形距离/角度/面积与圆基础约束，不承诺任意统计推断。模型必须声明样本空间与事件，宿主检查题设的等可能/独立条件是否真存在。

定义discreteProbabilityChecks中的exactProbability(outcomeCount: bigint, favorableCount: bigint): { numerator: bigint; denominator: bigint }，拒绝总数≤0或有利数越界并约分。例：公平六面骰偶数3/6=1/2；从3红2蓝无放回取2个全红=C(3,2)/C(5,2)=3/10，不能按独立有放回得9/25。仅调用3/10计算器不能认证“无放回”解析，必须有原题条件绑定。

planeGeometryChecks中的checkRightTriangle(points: readonly [readonly [number,number], readonly [number,number], readonly [number,number]], candidateArea: number): { decision: "supported" | "refuted" | "unknown" }，只检查非退化直角三角形实例；(0,0)、(3,0)、(0,4)面积6通过，候选12否证；非直角输入unknown而非套公式。任意三角形或圆的扩展单独声明支持域。

每个子包最低有“正确、错误、域外、退化、改写/改数、生产接线”六类测试。正式500题有更广题型时需继续加注册适配器；上述有限支持不是已经具备全高考覆盖。若仍达不到G3，明确列能力缺口与追加工作，不靠调整模型置信度过关。


## W7. 三视图重建、候选消歧与反投影

**文件：**
- 修改D:/draw/draw/packages/agent-core/src/orthographicProblem.ts、orthographicProblem.test.ts。
- 新增D:/draw/draw/packages/agent-core/src/orthographicCandidates.ts及测试。
- 新增D:/draw/draw/packages/geometry-kernel/src/orthographicProjection.ts及测试。
- W4图像管线输出结构化视图；W3路由注册实体族适配器。

**接口：** 新增resolveInvariantVolume(candidates: readonly { id: string; volume: number; reprojectionPassed: boolean }[], tolerance: number)，返回unique_value/ambiguous/none，unique_value带volume。它只合并已通过反投影的候选；候选清单必须完整覆盖当前有限支持域，不能只生成一个就声称唯一。

~~~ts
expect(resolveInvariantVolume([
  { id: "solid-a", volume: 9, reprojectionPassed: true },
  { id: "solid-b", volume: 12, reprojectionPassed: true }
], 1e-9).status).toBe("ambiguous")
~~~

- [ ] 用同外轮廓但内部/遮挡不同导致体积不同的红测，和前/侧视图换标签的冲突测试。
- [ ] 跑orthographicCandidates红测，确认旧“只有尺寸即可给唯一模型”不能过。
- [ ] 第一子包保留长方体/L形，补实际轮廓反投影；第二子包增加直棱柱、棱锥/四面体、柱体组合；每族独立提交验收。
- [ ] 实体维度必须来自网格或标注，不以选项补维度；检查虚实线、视图身份、公共轴和孔洞/遮挡。旋转与参数自由度在支持域里显式枚举或判unknown。
- [ ] 对每候选反投影并核对可观测线；解析体积和闭合网格求和比对。检查闭合、方向、退化/自交；曲面数值离散带误差界，不假装精确。
- [ ] 多候选目标不一致→澄清；一致可交付共同值并说明模型不唯一，作图不得冒称唯一原体。
- [ ] 变式测试：尺寸同比缩放体积按立方、平移/旋转不变、图像换清晰度、不提供选项仍得相同数值、选项置换只改变标签。
- [ ] 跑orthographic系列、geometry-kernel投影、production服务测试；预览图与数字对应同一模型版本。

**验收：** mm-005不能再把棱台改成棱锥凑B；mm-009的视觉冲突实际处理；不支持的斜切/曲面明确边界。仅解析/网格一致但未匹配原图不认证。

## W8. 按风险升级模型与独立解法

**文件：**
- 新增D:/draw/draw/apps/web/src/agent/solveStrategyPolicy.ts及测试。
- 修改D:/draw/draw/apps/web/src/agent/problemSolveService.ts、modelPlanner.ts。
- 修改D:/draw/draw/apps/web/src/components/settings/ProviderSettings.tsx及对应测试，只保存profile角色引用，不复制密钥、不静默新增provider。

**接口：** chooseSolveStrategy({ failure, mode, callsRemaining, hasAuthorizedIndependentProfile })返回primary/vision_reread/independent/stop；mode为default/high_accuracy，failure为none/image_gap/refuted/disagreement/auth。

- [ ] 红测：default无授权不能选独立模型；auth停止；image_gap先读图，不能升级纯文字模型补猜。

~~~ts
expect(chooseSolveStrategy({ failure: "refuted", mode: "default",
  callsRemaining: 6, hasAuthorizedIndependentProfile: false })).toBe("stop")
~~~

- [ ] 运行solveStrategyPolicy红测，再实现决策表，不用模型自报confidence作为唯一触发条件。
- [ ] 高精度独立候选首轮看原题+可信事实，不看旧选项；新attempt冻结profile/revision，记录升级理由；最多两个候选。
- [ ] 冲突时由独立核验或保守终态决策；两候选一致但共享错误前提仍不能认证。
- [ ] 在验证集先比较当前配置与用户批准的新配置；同题同预算、记录缺失usage和费用未知。请求上限只在授权批次中启用，不能本任务自动开测。
- [ ] 跑策略、会话预算、生产服务测试；没有额外配置时现有模型正常工作，不出现无穷等待。

**验收：** 有实际新增成功题且未增加错误认证，单位新增成功的调用成本可量化；没有收益的升级不默认启用。

## W9. 逐问终答、数学与作图一致

**文件：**
- 修改D:/draw/draw/apps/web/src/components/agent/AgentMessageList.tsx、D:/draw/draw/apps/web/src/agentStore.ts及对应测试。
- 新增D:/draw/draw/apps/web/src/components/agent/agentDeliveryBadge.ts、agentDeliveryBadge.test.ts。
- 新增D:/draw/draw/e2e/agent-verified-delivery.spec.ts。
- 修改D:/draw/draw/e2e/agent-answer-delivery.spec.ts与agent-fold-delivery.spec.ts，保留原有9项界面回归。

**接口：** 直接消费SolveResult与BoundEvidence，不从正文关键词猜“已核验”。新增纯函数deliveryBadge({ status, requiredGoals, verifiedGoals, refutedGoals })，返回verified/partial/unverified/failed，放agentDeliveryBadge.ts并测试。

~~~ts
expect(deliveryBadge({ status: "answered", requiredGoals: 2,
  verifiedGoals: 1, refutedGoals: 0 })).not.toBe("verified")
~~~

- [ ] 写两问只核验一问不能整题绿色、旧记录空evidence未核验、反例导致失败、用户修正后标记失效红测。
- [ ] 运行新增展示测试，再实现目标逐项标签、缺问列表和准确澄清，不把格式失败伪装“需要你补条件”。
- [ ] 最终文字从结构化终答渲染，候选解释不得改变数值/范围；两处最终答案冲突时显示未完成并触发恢复，不择一个显示成功。
- [ ] 作图请求检查对应约束、标签、可见性、草稿版本；确认前liveWrites=0。没有作图要求时不强制图形成功。
- [ ] 验证取消、切会话、重启、旧持久化、撤销重做、参数拖动后证据失效/重算；已核验数值不能跟随错误旧图继续显示。
- [ ] 运行node node_modules/@playwright/test/cli.js test e2e/agent-verified-delivery.spec.ts e2e/agent-answer-delivery.spec.ts e2e/agent-fold-delivery.spec.ts --workers=1；测试必须构建当前Web。

**验收：** UI显示与宿主状态一致，不能因正文提到“已验证”出现认证；数学/图形/状态均来自同一修订。

## W10. 真生产评测、盲测与失败闭环

**文件：**
- 新增D:/draw/draw/scripts/agent-reliability-eval/production.eval.mjs、production-eval.config.mts、manifest.cjs及测试。
- 扩展D:/draw/draw/scripts/agent-reliability-eval/dataset.cjs及测试、report.cjs。
- 新增D:/draw/draw/test-fixtures/agent-reliability-v2/manifest.json、README.md；开发题与受控评分真值分离，原卷图片按授权处理，不默认全部上传。
- 保留D:/draw/draw/scripts/real-exam-eval/live.eval.mjs作为legacy轨道，不改名冒充生产UI评测。

**数据合同：** case有id、family、split、source、question、attachments、requiredGoalKinds、materialHash；reference/关键步骤仅评分进程可见。manifest有corpusHash、scorerVersion、buildId、binarySha256、revision、profileRevision、flagSnapshot、budgetSnapshot、entryTrack和不可重叠题号清单。

- [ ] 数据红测：重复题号、同图跨split、模型可记忆的原题与变式未分组、如图无附件、答案混进prompt、冻结后materialHash变动必须拒绝，不启动API。

~~~js
const assert = require('node:assert/strict')
const { validateManifest } = require('./manifest.cjs')
assert.throws(() => validateManifest({
  cases: [{ id: 'q1', split: 'dev', materialHash: 'same' },
          { id: 'q2', split: 'holdout', materialHash: 'same' }]
}), /cross.split|duplicate/)
~~~

- [ ] 先运行node --test scripts/agent-reliability-eval/manifest.test.cjs scripts/agent-reliability-eval/dataset.test.cjs确认红测；再实现验证，禁止模型可读reference。
- [ ] 实时入口调用W3同服务，原生凭据仅provider使用。运行前构建新binary并核验Web buildId/原生版本；版本不符失败关闭，不继续跑。
- [ ] 默认离线。实时要求显式MATHCANVAS_REAL_EXAM_LIVE=1、模型/题量/请求/token预算全部记录；取消有批次总开关，不仅单题超时。
- [ ] 按设计准备300开发、100验证、500盲测、100异常题；分卷/模板去重，所有计入S的关键推导被独立审阅。题库未准备完不得声称完成G3。
- [ ] 阶梯运行：离线回归→获批准的10题冒烟→50题三轮→100验证→500正式；每层不过不继续花下一层费用。10/50冒烟题不来自保留盲测。
- [ ] 正式第一轮记主结果；重复两轮分别报、不择优。500题重复仍只有500道不同题；报告Wilson及按卷相关性限制。
- [ ] 至少40道分层完整UI真实调用验收，和核心服务500题分开报告；覆盖原附件识图、逐问展示、需要时确认作图。
- [ ] 对每个失败记录firstFaultStage、原因、条件/图区域、候选、核验、恢复、最终状态、用量。曝光盲测转回归，下次使用新保留集。
- [ ] 核对全量题号覆盖、无重复付费、无超额、liveWrites规则和所有失败保留分母；报告脚本禁止成功率>100%。

**验收：** 满足设计G0—G4的适用门槛；使用完整解题指标时不能只拿选项评分，人工未审结明确计未成功。

## W11. 可消费的开关、灰度与回滚

**文件：**
- 修改D:/draw/draw/apps/web/src/agent/reliabilityFlags.ts及测试、problemSolveService.ts。
- 新增D:/draw/draw/apps/web/src/agent/reliabilityRollout.test.ts。
- 更新D:/draw/draw/docs/current-status.md、docs/project-progress.md；实际发布时另写release文档，本任务不发布。

**接口：** validateReliabilityConfig(flags)返回ok或精确依赖错误：mathVerificationV1要求goalTrackingV1+answerSemanticsV1，orthographicTemplatesV1要求goalTrackingV1+mathVerificationV1；imageRereadV1要求可用session与原附件能力。旧W2标签展示不因新开关关闭而消失。

- [ ] 红测：数学核验开、目标跟踪关时拒绝启动新模式；关闭核验后答案保留但无认证；同会话分桶稳定。
- [ ] 运行reliabilityFlags/reliabilityRollout红测；再将现有开关接实际消费点，不仅返回对象。
- [ ] 首先离线和本地shadow，shadow不升级标签。需要模型的shadow仍计费且须批准，不能隐藏运行。
- [ ] 10%→50%→100%各档至少收集100个合规会话并复核故障，保持至少24小时观察；不足样本不因时间到就自动扩量。低流量时人工测试补证据，但不冒充真实用户数据。
- [ ] 任意错误认证/越权/过期证据/预算绕过立即停新策略；交付退步>2个百分点、P95超时、题族退步>5个百分点暂停扩量并复查样本可比性。
- [ ] 回滚保留只读正文与历史数据，清除新认证资格，保留草稿确认和既有安全门禁；进行真实UI回滚演练。
- [ ] 更新状态文档写清已支持/未支持域、实际成绩、样本与预算；未达G3不写“接近100%已完成”。

**验收：** 配置有实际作用、违规组合被拒、回滚不产生错误认证、发布证据与构建版本一致。

## 2. 机制→测试→验收追踪矩阵

| 当前失败 | 主包 | 必须新增的机制断言 | 成功率验收而非仅安全验收 |
|---|---|---|---|
| mm-005按选项改题设 | W4/W7 | 只有图1不足、候选不能反向补条件 | 清晰原图及缩放变式真正求得正确数值 |
| mm-009视觉冲突 | W4/W7 | 冲突触发定向补证据 | 补读后选项与重建都匹配 |
| mm-012绝对值/图形选项 | W4/W6 | 定义域分段、零点/符号核验 | 唯一正确图形选项及推导 |
| mm-022/051/063、text-176格式 | W5 | alias/坐标/空计划修复有界 | 真模型正常交付且内容正确 |
| mm-029/055/066、text-190引用 | W5 | 当前工具结果ID，假引用拒绝 | 恢复后交付，不只是waiting更清楚 |
| text-128垂足错误 | W6 | 落线和垂直同时验证 | 多组轴长变式正确，不甩锅题面 |
| text-198范围反向 | W6 | 端点/顶点及开闭区间 | 连续参数变式正确 |
| text-203自相矛盾 | W6 | 精确反例阻断原结论 | 完整递推/奇偶结论正确 |
| mm-034评分漏识别 | W0 | 选B被新评分器识别 | 同时重评旧、新，不冒充Agent变强 |
| 40个answered空证据 | W1/W3/W9 | 真实目标与绑定宿主证据 | 认证覆盖率提升且错误认证0 |
| 测试不是生产入口 | W3/W10 | 路由/识图/核验同服务 | 完整UI抽测与服务评测分别报告 |

## 3. 验证命令与发布阻断清单

所有命令在D:/draw/draw执行，付费命令不在本次自动运行。

~~~powershell
npm run typecheck
npm run lint
node --test scripts/real-exam-eval/score.test.cjs scripts/agent-reliability-eval/dataset.test.cjs scripts/agent-reliability-eval/report.test.cjs
node node_modules/vitest/vitest.mjs run packages/agent-core/src apps/web/src/agent apps/web/src/services
node node_modules/vitest/vitest.mjs run scripts/docs-consistency
node node_modules/@playwright/test/cli.js test e2e/agent-answer-delivery.spec.ts e2e/agent-fold-delivery.spec.ts e2e/geometry3d-host-drag.spec.ts e2e/inspector-derived-sphere.spec.ts e2e/volume-measurement-updates.spec.ts e2e/agent-verified-delivery.spec.ts --workers=1
git diff --check
~~~

真实发布还必须重新桌面构建并跑W10获授权批次；仅上述离线通过不允许宣布真实成功率。若Rust有改动加Rust测试；检查失败就停止并保留日志，不用重复运行偶然绿掩盖失败。

### 发布阻断

- [ ] G3/G4尚未达到，不得声明接近100%。
- [ ] 无效题被静默删除、澄清移出分母、重复题当独立样本，阻断。
- [ ] 任意错误认证、任意失败后真实文档写入，阻断。
- [ ] 真值泄漏、原附件不可追溯、模型不经预算出网，阻断。
- [ ] 无生产命中轨迹、仍只测试模块，阻断。
- [ ] 模型、程序、前端buildId或题库hash不对应报告，阻断。
- [ ] 仅选项核对却报告完整数学/作图正确率，阻断。

## 4. 开工建议与需批准的边界

本轮按 W4→W11 逐包推进：W0—W4 已接通统计、身份、预算、生产入口与图像证据闭环，但尚未拿到新的真实模型同口径基线；扩大模型/题库投入仍需另行批准。W0离线重评分不花API；任何真实10题冒烟须另确认模型与总预算。

用户已授权 W4—W11 逐包提交并推送，但没有授权打tag/GitHub Release；默认仍用当前模型与预算档，不加通用CAS，不启动并行子代理。高精度档、新provider、付费盲测、外部题库采购均单独确认。目标保持高标准，但每次汇报都基于实际证据，不以“方案已写”代替“成功率已达成”。
