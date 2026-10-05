import {
  buildBenchmarkReport,
  buildPlanRequest,
  CAPABILITY_REGISTRY_REVISION,
  compilePlan,
  createBudget,
  parseBenchmarkCases,
  type BenchmarkCase,
  type BenchmarkEvidenceEntry,
  type BenchmarkReport,
  type BenchmarkRun,
  type DocumentHandle,
  type PlannerPort,
  type PlanCompileResult,
  type PlanRequest,
  type RunContext
} from "@draw/agent-core"
import { createEmptyDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import { MODEL_PLANNER_SKILL_IDS } from "../agentRunner"
import { createModelPlanner, resolveActiveProvider, type ProviderResolution } from "../modelPlanner"
import { NOT_MEASURED } from "./agentEvalReport"
import { availableActionsFor } from "./offlineAgentEval"

/**
 * **应用内真实 provider 的题集 planning 通道**（子任务 N4b）。
 *
 * ## 它在测什么（一句话）
 *
 * 端到端"**模型产出的计划有没有被 `compilePlan` 接受**"：对题集里的每条题走一次
 * `createModelPlanner` → `compilePlan`，如实记下 planned / rejected / error。
 *
 * **判据只有编译器那一个返回值**（`compiled.ok`），所以这条读数**不需要金标准**：
 * "接受与否"是客观的。这也是用户 2026-10-05 裁决这条口径的理由 ——
 * 拿离线回归冒充模型准确率是另一回事，这里不碰。
 *
 * ## 为什么是**新增一层**而不是塞进 `extraction`
 *
 * `report.ts:29-36` 自己写着："只跑原话 → 题设的抽取"那一轮**根本没有见证结论**，
 * 拿见证词描述它是范畴错误。反过来一样：真实模型给的是**规划**，不是"原话 → 题设子句"的
 * 抽取，塞进 `extraction` 会让报告读起来是绿的、实际什么都没说。所以契约新增 `planning` 层
 * （见 `packages/agent-core/src/benchmark/report.ts`）。
 *
 * ## 与旧那套 8 题夹具的关系：**并存，不取代**
 *
 * `providerAgentEval.ts` / `offlineAgentEval.ts` / `agentTaskFixtures.ts` 的行为一个字不改 ——
 * 那套测的是"agent 工具环能不能按要求把图形建出来"（pass@1 / pass@3 / 工具选择），
 * 与这一套（题集 planning 的接受率）**不是同一个坐标系**。两套在界面上各自独立、
 * 各自两段式、各自报自己的请求数（合并按钮会让"我点了什么、会花多少钱"说不清）。
 *
 * ## 资金与凭据
 *
 * - **先解析 provider，再决定要不要跑**（照抄 `providerAgentEval.ts:48-60` 的顺序）：
 *   解析失败时**一次请求都不发**，整批如实写 `not_measured`（显式 `null` 的 provider / model）——
 *   这是 `report.ts` 唯一允许 `real_provider` 缺身份的一支；
 * - **成本一律 `null`**：这条通道能给 token 数，但仓里**没有价目表**，编一个钱数比留空坏得多；
 * - 它不发请求除非被显式调用：没有定时器、没有模块级副作用，触发点在设置面板上。
 */

/**
 * **本次小样本规模：3 题 × 1 轮**（用户 2026-10-05 授权的规模）。
 *
 * **只有这一处定义**：界面文案与请求数都由它算出来（不在文案里手写一个 3、代码里再写一个 3）。
 * 它不是"题集有多大"（那是 21 条），也不是"每题最多几轮"（那是契约的 `MAX_ROUNDS_PER_CASE = 3`）——
 * 三件事是三样东西，混起来会让"这次会花多少钱"说不清。
 */
export const PLANNING_EVAL_CASE_COUNT = 3
/** 本次**固定 1 轮**。上限仍由契约的 `MAX_ROUNDS_PER_CASE`（3）挡着 —— 两者不是同一个东西。 */
export const PLANNING_EVAL_TRIALS = 1
/** 固定种子：与 CLI（`scripts/agent-benchmark/run.test.ts` 的 `SEED`）**同一个 7**，便于两份读数对照。 */
export const PLANNING_EVAL_SEED = 7
/** 这次点下去会发几次请求 = 题数 × 轮数（界面文案与用例都读它，不各自算一遍）。 */
export const PLANNING_EVAL_REQUESTS = PLANNING_EVAL_CASE_COUNT * PLANNING_EVAL_TRIALS

/**
 * **题集总数**（只用于界面文案说清"前 3 条是从多少条里取的"）。
 *
 * **为什么是手写的 21 而不是 `parseBenchmarkCases().length`**（2026-10-05 复核 M-4 的处置）：
 * 渲染路径上**不该再解析一遍题集**（本文件自己的注释就写着这句），而在模块顶层解析会让
 * **任何** import agent-core 的代码都承担"坏题集 ⇒ 抛在导入期"的风险（那会把一个评测路径的
 * 问题变成整个应用打不开）。所以这里留一个字面量，**但有用例钉着它与真实条数相等** ——
 * 题集一变，红在**这个文件自己的用例**里，而不是等到界面文案先撒谎。
 */
export const PLANNING_EVAL_TOTAL_CASES = 21

/**
 * **这次要跑的那套题集**：`@draw/agent-core` 的 `parseBenchmarkCases()`（21 条）里的前 3 条。
 *
 * 两条纪律：
 * - **不复制题面字面量**：题面从包里的那一份来（应用侧是浏览器，不能 `node:fs`）；
 * - **不加缓存**（N4a 刻意没加）：加缓存就是"第二份可以漂移的东西"。渲染路径上只调一次即可。
 */
export function planningEvalCases(where = "benchmark 题集"): BenchmarkCase[] {
  return parseBenchmarkCases(where).slice(0, PLANNING_EVAL_CASE_COUNT)
}

/**
 * 题集里声明的 workspace → DSL 的空文档工作区。
 *
 * **不许静默替换**：题集 schema 允许 `draft`，而 DSL 的 `Workspace` 里没有它
 *（`calculus | conics | cad | geometry3d`）。把 `draft` 当成 `geometry3d` 会让报告里
 * 记着一条"在另一个工作区跑过"的记录 —— 那是编的。认不出就抛，由调用方如实记成 `error`。
 */
export function workspaceFor(entry: BenchmarkCase): "geometry3d" | "cad" {
  if (entry.workspace === "geometry3d" || entry.workspace === "cad") return entry.workspace
  throw new Error(`题集里的 workspace「${entry.workspace}」没有对应的空文档工作区（DSL 只认 geometry3d / cad）`)
}

/**
 * **这一轮的 `PlanRequest`** —— 真实模型规划器要的那一份。
 *
 * ## 请求的形状**不在这个文件里**（N4d 改）
 *
 * 这里原先自己拼了一份完整请求（同一批函数、同样的顺序，但是**第二份字面量**）。
 * 现在它只是 `@draw/agent-core` 的 `buildPlanRequest` 的一层薄封装：那道"模型能看到什么"
 * 归协调器管（`coordinatorPorts.ts` 的 `PlanRequest.model` 注释点名了这条安全边界），
 * 而 `buildPlanRequest` 调的就是协调器自己用的那几个函数
 *（`buildContext` → `buildConversationContext` → `createToolRegistry().forModelPhase("planning", …)`）。
 *
 * 这个封装留下的唯一理由是**参数形状**：`runOneCase` 手里是
 *（题面 / 工作区 / runId / 文档）这四样，而 `buildPlanRequest` 要的是 `RunContext` 与
 * "这一轮观察到什么"。把四样变成那两样的过程仍然只有一处（就在下面）。
 *
 * ## 为什么不能只给 `userMessage`
 *
 * 离线那条路曾经可以只传 `{ userMessage } as never`（`offlineAgentEval.ts` 的注释记着这件事），
 * 因为本地规划器只读 `userMessage`。**真实**模型规划器不行：它要
 * `request.model.context` 组装提示词、要 `request.run` 拿 runId 与目标句柄、要
 * `request.budget` 记网络/生成预算、要 `request.signal` 挂取消与超时。
 * 少一样就是一次 `TypeError`（实测：`Cannot read properties of undefined (reading 'context')`），
 * 而且它发生在**任何请求发出之前** —— 于是付费按钮会"看起来在跑"，实际一次都没发。
 * 本批把两处都换成了同一个构造函数，所以那种退化现在只能同时发生在两处（而且有用例钉着）。
 *
 * ## 两处**内容**上的差别是诚实写出来的，不是默认值
 *
 * - **观察结果是空场景**：这条通道从空画布开始（题集里的题都是"从零作图"），所以
 *   `facts` 是空数组、摘要只陈述一件可核对的事（本文档里几个图元）——
 *   它不是观察端口的产物（这里没有场景观察层），所以不假装有事实；
 * - **没有只读工具**：这个 harness 没有 `ToolPort` 宿主，所以 `readToolsAvailable: false`
 *   （协调器在 `dependencies.tools === undefined` 时传的也是这个值）。
 *
 * **另外三处差异（2026-10-05 复核要求逐条写明）** —— 不写出来，"这条请求 = 生产请求"就是一句不可核的话：
 * - **`signal` 永不可中止**：这里是 `new AbortController().signal`，永远不会 abort；
 *   协调器用的是用户按"停止"时真的会触发的 `controller.signal`（`modelPlanner` 会读它）。
 *   评测里没有"用户按停止"这回事，所以今天不可达；但**它意味着这条通道不会因为取消而中断**；
 * - **`compilePlan` 未带 `diagramWitnessSearch` / `obligationIR` 两个 flag**：也就是"接受与否"是在
 *   **默认 flag 配置**（两个都关）下测的，而生产 stage 路径会把运行时的 flag 传进去。
 *   今天两个 flag 默认都关 ⇒ 与生产等价；**它们将来默认打开时，这个读数就不再等于生产路径**；
 * - **`conversationId === runId`**：真实运行里 conversationId 是会话 id、runId 是另一回事
 *  （`agentRunner` 里两者不同）。评测每条题都是独立的一次，没有会话可归属，所以拿 runId 顶上。
 */
export function planRequestFor(prompt: string, workspace: "geometry3d" | "cad", runId: string, document: ReturnType<typeof createEmptyDocument>): PlanRequest {
  /**
   * **文档由调用方传进来，不在这里再建一份**（2026-10-05 复核 M-1）。
   *
   * 原来这里自己 `createEmptyDocument`，而 `runOneCase` 另建一份给 `compilePlan` ——
   * 两份的 `metadata.id` 是**两个不同的随机 UUID**（`createEmptyDocument` 用 `crypto.randomUUID()`），
   * 于是"模型看到的 `documentId`"与"真正被编译的那份"**对不上**。
   * 今天它不影响判定（revision 都是 0、`PlanCompileContext` 也不收 handle），但那是**巧合**，
   * 不是设计：一个"模型看到的文档 ≠ 被编译的文档"的评测，迟早会在某个读 `documentId` 的地方说谎。
   */
  const handle: DocumentHandle = {
    projectId: "local",
    documentId: document.metadata.id,
    workspace,
    epoch: `epoch:${document.metadata.id}`,
    generation: document.revision,
    contentHash: contentFingerprint(document)
  }
  const run: RunContext = {
    runId,
    conversationId: runId,
    promptMessageId: `${runId}-prompt`,
    target: handle,
    sources: [],
    // 这一轮是**评测**在问，不是某一份用户配置 —— 名字要说清这件事。
    textProfileId: "benchmark-planning",
    capabilityRevision: CAPABILITY_REGISTRY_REVISION,
    policyRevision: "local"
  }
  // 与运行时那一行**同一口径**（`agentRuntime.ts:384-385`）：技能 id 先过清单，再从清单取动作。
  // 推导只有一处（`availableActionsFor`），因为它与旧 8 题那条通道共用同一个上下文形状。
  const requestedSkillIds = MODEL_PLANNER_SKILL_IDS
  return buildPlanRequest({
    run,
    userMessage: prompt,
    budget: createBudget(),
    signal: new AbortController().signal,
    observation: { facts: [], summary: `${document.primitives.length} object(s) in ${document.metadata.id}` },
    requestedSkillIds,
    availableActions: availableActionsFor(requestedSkillIds)
  })
}

export interface PlanningEvalResult {
  mode: "real_provider"
  /** provider 是谁（解析成功时）；解析失败时 `null`。 */
  provider: { id: string; modelId: string } | null
  /** **没测的原因**（解析失败时）。成功时 `null` —— 两个字段互斥。 */
  unavailable: { code: string; detail: string } | null
  /** 一次请求都没发时这里是 3 条 `not_measured`（**不是**"跑了 0 分"）。 */
  runs: BenchmarkRun[]
  /** 同一批记录过**报告契约**的校验与分组：不合法会在 `runProviderPlanningEval` 里抛。 */
  report: BenchmarkReport
}

export interface PlanningEvalDependencies {
  /** 现取「使用中」的那一份。缺省走真实 IPC（`resolveActiveProvider`）。 */
  resolveProvider?: () => Promise<ProviderResolution>
  /** 造一个规划器。缺省接真实 provider；用例注入假规划器就能确定性地跑完整条扫描。 */
  createPlanner?: (resolution: Extract<ProviderResolution, { ok: true }>) => PlannerPort
}

/** 跑一轮真实 provider 的题集 planning 评测。 */
export async function runProviderPlanningEval(dependencies: PlanningEvalDependencies = {}): Promise<PlanningEvalResult> {
  const cases = planningEvalCases()
  const resolveProvider = dependencies.resolveProvider ?? resolveActiveProvider
  const resolution = await resolveProvider()

  const where = "应用内题集 planning 运行记录"
  if (!resolution.ok) {
    /**
     * **一次请求都不发**：解析失败时连规划器都不造（与 `providerAgentEval.ts:58` 同一顺序）。
     * 整批写 `not_measured` + 显式 `null` 的身份 —— 没有凭据时不许"跳过"，也不许编一个数字。
     */
    const runs = cases.map((entry): BenchmarkRun => ({
      caseId: entry.id,
      provider: null,
      model: null,
      seed: PLANNING_EVAL_SEED,
      mode: "real_provider",
      layer: "planning",
      status: "not_measured",
      evidence: [],
      cost: null,
      latency: null
    }))
    return { mode: "real_provider", provider: null, unavailable: { code: resolution.code, detail: resolution.detail }, runs, report: buildReport(runs, where) }
  }

  const createPlanner = dependencies.createPlanner ?? ((resolved) => createModelPlanner({ resolveProvider: async () => resolved }))
  const identity = { id: resolution.provider.id, modelId: resolution.provider.modelId }
  const runs: BenchmarkRun[] = []
  for (const entry of cases) {
    for (let trial = 1; trial <= PLANNING_EVAL_TRIALS; trial += 1) {
      // 每条题一个新的规划器实例：真实那一侧因此每次重新解析 provider、拿新的 runId
      //（与 `offlineAgentEval.ts` 的"每次尝试都新建"同一条口径）。
      runs.push(await runOneCase(entry, trial, identity, () => createPlanner(resolution)))
    }
  }

  return { mode: "real_provider", provider: identity, unavailable: null, runs, report: buildReport(runs, where) }
}

function buildReport(runs: readonly BenchmarkRun[], where: string) {
  // 报告契约自己会校验（缺字段 / 模式未标识 / 层词表 / 每题轮数上限）—— 不合法就在这里抛。
  return buildBenchmarkReport(runs, where)
}

/** 一条题的一轮：**接受 / 被拒 / 抛出**三选一，`latency` 是实测的墙钟毫秒。 */
async function runOneCase(
  entry: BenchmarkCase,
  trial: number,
  identity: { id: string; modelId: string },
  createPlanner: () => PlannerPort
): Promise<BenchmarkRun> {
  const base = {
    caseId: entry.id,
    provider: identity.id,
    model: identity.modelId,
    seed: PLANNING_EVAL_SEED,
    mode: "real_provider" as const,
    layer: "planning" as const,
    cost: null
  }
  const started = Date.now()
  try {
    const workspace = workspaceFor(entry)
    const document = createEmptyDocument(workspace)
    /**
     * **走产品同一条路径**：`createModelPlanner` → `planner.plan(request)` → `compilePlan`。
     * 判题口径只有 `compilePlan` 那一处；这里不另写"模型调用 + 解析"。
     *（`request` 为什么必须完整，见 `planRequestFor` 的注释。）
     */
    const request = planRequestFor(entry.prompt, workspace, `benchmark-planning-${entry.id}-${trial}`, document)
    const envelope = (await createPlanner().plan(request)).plan
    const compiled = compilePlan(envelope, {
      document,
      prompt: entry.prompt,
      conversationId: request.run.conversationId,
      documentGeneration: document.revision
    })
    const latency = { totalMs: Math.max(0, Date.now() - started) }
    /**
     * **三支，不是两支**（2026-10-05 第二次真实运行之后改）：`planned` / `clarification` / `rejected`。
     *
     * 澄清**单独一支**的理由见 `report.ts` 的 `planning` 词表说明，一句话：
     * "**模型发现矛盾、于是提问**"与"**编译器把计划拒了 / 模型压根没给计划**"是**相反**的两件事 ——
     * 那次真实运行里被记成 `rejected` 的恰恰是前者（模型要求用户二选一），
     * 合成一个计数会把"模型做对了"读成"模型失败了"。
     * **fail-closed 那一半一个字不改**：澄清**不是** `planned`（"问了"不等于"计划被接受"）。
     */
    if (compiled.ok && compiled.plan?.kind === "clarification") {
      return { ...base, status: "clarification", evidence: clarificationEvidence(entry.id, compiled.plan), latency }
    }
    return compiled.ok && compiled.plan?.kind === "plan"
      ? { ...base, status: "planned", evidence: acceptedEvidence(compiled.diagnostics.length, compiled.actions.length, compiled.draftDocument !== null), latency }
      : { ...base, status: "rejected", evidence: rejectionEvidence(entry.id, compiled), latency }
  } catch (error) {
    return {
      ...base,
      status: "error",
      // 原始消息，不加工：这一条读数说的是"跑的时候抛了"，把它概括成一句话会让排障无从下手。
      evidence: [{ claim: entry.id, status: "error", evidence: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }],
      latency: { totalMs: Math.max(0, Date.now() - started) }
    }
  }
}

/** 「被接受」是一条**客观**结论，所以证据写的是编译器自己给出的那几个量。 */
function acceptedEvidence(diagnostics: number, actions: number, producedDraft: boolean): BenchmarkEvidenceEntry[] {
  return [{ claim: "计划被 compilePlan 接受", status: "planned", evidence: `ok=true；诊断 ${diagnostics} 条；可执行动作 ${actions} 条；草稿文档${producedDraft ? "已产出" : "未产出"}` }]
}

/**
 * 「模型在问」这一支的证据：**把它的原话带上**（问题原文）。
 *
 * 它独立于 `rejected`：这一支说的是"模型没给计划，而是要求用户先澄清"，
 * 不是"计划被拒了"。读者要能一眼看出是哪一种 —— 这也是它独立成一支的**全部**理由。
 */
function clarificationEvidence(caseId: string, envelope: { questions: readonly string[] }): BenchmarkEvidenceEntry[] {
  return [{ claim: caseId, status: "clarification", evidence: `模型没给计划，而是在问：${envelope.questions.join(" / ")}` }]
}

/**
 * 「被拒」的两种来源，**都带真实原文**（读者要能分辨是哪一种）：
 * - 编译器报了 error ⇒ 逐条 `code@path: detail`（不是我们概括的一句话）；
 * - 模型给的是**只读回答**（`kind: "answer"`）或者**什么都没给**。
 *
 * **注意**：`kind: "clarification"` **不在这里**（它走 `clarificationEvidence`，是另一支）——
 * 这一支与那一支说的是相反的两件事。
 */
function rejectionEvidence(caseId: string, compiled: PlanCompileResult): BenchmarkEvidenceEntry[] {
  if (!compiled.ok) {
    const errors = compiled.diagnostics.filter((entry) => entry.severity === "error")
    return [{
      claim: caseId,
      status: "rejected",
      evidence: errors.length > 0
        ? errors.map((entry) => `${entry.code}@${entry.path}: ${entry.detail}`).join(" | ")
        : "编译器拒绝了这份计划，但没有给出 error 级诊断（兜底句，正常路径不该出现）。"
    }]
  }
  const envelope = compiled.plan
  return [{
    claim: caseId,
    status: "rejected",
    evidence: envelope?.kind === "answer"
      ? `模型给的是只读回答、不是计划：${envelope.answer}`
      : "模型没有给出计划。"
  }]
}

/**
 * **逐条证据的截断上限**：够看出形状，又不让一条长证据把面板撑爆（"有界文本"这条纪律）。
 * 截断时**如实写原长**，不假装这就是全文。
 */
const PER_CASE_EVIDENCE_LIMIT = 240

/**
 * 把这一批读数渲染成有界文本（供面板显示，也供用例断言）。
 *
 * 每个数都**直接数 `runs`**，不在这里重算 —— 重算就是第二份口径。
 * 题数从 `runs` 的 `caseId` 去重得到（不重新解析题集：渲染路径上不该再解析一遍）。
 *
 * ## 为什么**汇总之外还要逐条**（2026-10-05 第一次真实运行暴露的缺口）
 *
 * 那次真实运行的面板只打汇总：`planned 2/3 / rejected 1/3`。于是"**被拒的那一条为什么被拒**"
 * 变成了一个查不到的问题 —— 而理由其实就在 `runs[].evidence` 里（`code@path: detail`，
 * 或"模型给的是澄清 / 只读回答"）。**诊断信息留在内存里而没渲染，等于这次运行白跑一半**：
 * 一条被拒的计划往往正好是下一步该修的地方。所以逐条也要打出来。
 */
export function formatPlanningReport(result: PlanningEvalResult): string {
  const total = result.runs.length
  const cases = new Set(result.runs.map((run) => run.caseId)).size
  const count = (status: BenchmarkRun["status"]): number => result.runs.filter((run) => run.status === status).length
  const measured = result.runs.filter((run) => run.status !== "not_measured")
  const averageLatency = measured.length === 0 ? null : Math.round(measured.reduce((sum, run) => sum + (run.latency?.totalMs ?? 0), 0) / measured.length)

  return [
    "mode: real_provider — 题集 planning（计划是否被 compilePlan 接受）",
    `provider          ${result.provider ? `${result.provider.id} / ${result.provider.modelId}` : NOT_MEASURED}`,
    `cases             ${cases}（layer=planning，seed=${PLANNING_EVAL_SEED}）`,
    "",
    `planned           ${count("planned")}/${total}`,
    // **澄清单独一行**（2026-10-05 第二次真实运行之后加）：它与 `rejected` 说的是相反的两件事 ——
    // "模型在问"不是失败。合成一行会把读数方向读反。
    `clarification     ${count("clarification")}/${total}`,
    `rejected          ${count("rejected")}/${total}`,
    `error             ${count("error")}/${total}`,
    `not measured      ${count("not_measured")}/${total}`,
    `average latency   ${averageLatency === null ? NOT_MEASURED : `${averageLatency} ms (measured runs only)`}`,
    // 仓里没有价目表 ⇒ 成本写 `not measured`，而不是拿一个猜出来的钱数充数。
    `cost              ${NOT_MEASURED}（仓里没有价目表）`,
    "",
    `per case（每条题一行：题 id / 结局 / 理由原文）`,
    ...result.runs.map((run) => {
      const evidence = run.evidence.map((entry) => entry.evidence).join(" | ")
      const bounded = evidence.length > PER_CASE_EVIDENCE_LIMIT
        ? `${evidence.slice(0, PER_CASE_EVIDENCE_LIMIT)}…（已截断，原长 ${evidence.length}）`
        : evidence
      return `  ${run.caseId}  ${run.status}  ${bounded.length === 0 ? "（这一轮没测）" : bounded}`
    })
  ].join("\n")
}
