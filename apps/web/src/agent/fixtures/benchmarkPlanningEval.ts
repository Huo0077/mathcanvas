import {
  buildBenchmarkReport,
  buildContext,
  buildConversationContext,
  CAPABILITY_REGISTRY_REVISION,
  compilePlan,
  createBudget,
  createToolRegistry,
  parseBenchmarkCases,
  SKILL_MANIFESTS,
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
 * ## 为什么不能只给 `userMessage`
 *
 * 离线评测那条路可以只传 `{ userMessage } as never`（`offlineAgentEval.ts:30`），因为
 * `createLocalPlanner` 只读 `userMessage`。**真实**模型规划器不行：它要
 * `request.model.context` 组装提示词、要 `request.run` 拿 runId 与目标句柄、要
 * `request.budget` 记网络/生成预算、要 `request.signal` 挂取消与超时。
 * 少一样就是一次 `TypeError`（实测：`Cannot read properties of undefined (reading 'context')`），
 * 而且它发生在**任何请求发出之前** —— 于是付费按钮会"看起来在跑"，实际一次都没发。
 *
 * ## 这不是"第二份判断"
 *
 * 下面每一步都调**协调器自己用的那几个函数**（`coordinator.ts:263-337`：
 * `buildContext` → `buildConversationContext` → `registry.forModelPhase("planning", …)`），
 * 顺序也一样："哪个阶段发布哪些工具"仍然由 `@draw/agent-core` 的工具注册表决定，
 * 没有搬到应用层来（`coordinatorPorts.ts` 的 `PlanRequest.model` 注释点名了那条安全边界）。
 * 这个 harness 里没有协调器可用（协调器还带账本、暂存、确认、验收），所以由这里替它把
 * **同一批入参**喂给**同一批函数**。
 *
 * 两处**内容**上的差别是诚实写出来的，不是默认值：
 * - **观察结果是空场景**：这条通道从空画布开始（题集里的题都是"从零作图"），所以
 *   `facts` 是空数组、摘要只陈述一件可核对的事（本文档里几个图元）——
 *   它不是观察端口的产物（这里没有场景观察层），所以不假装有事实；
 * - **没有只读工具**：这个 harness 没有 `ToolPort` 宿主，所以 `readToolsAvailable: false`
 *  （协调器在 `dependencies.tools === undefined` 时传的也是这个值）。
 */
export function planRequestFor(prompt: string, workspace: "geometry3d" | "cad", runId: string): PlanRequest {
  const document = createEmptyDocument(workspace)
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
  const budget = createBudget()
  const requestedSkillIds = MODEL_PLANNER_SKILL_IDS
  // 与运行时那一行**同一口径**（`agentRuntime.ts:384-385`）：技能 id 先过清单，再从清单取动作。
  const availableActions = [...new Set(SKILL_MANIFESTS.filter((manifest) => requestedSkillIds.includes(manifest.id)).flatMap((manifest) => manifest.actionIds))]
  const observation = { facts: [], summary: `${document.primitives.length} object(s) in ${document.metadata.id}` }
  const context = buildContext({ run, observation, requestedSkillIds, selectedRefs: [], availableActions, budget })
  const conversation = buildConversationContext({
    binding: { conversationId: run.conversationId, projectId: handle.projectId, documentId: handle.documentId, workspace, generation: handle.generation },
    summary: "",
    // 空画布上还没有任何**已确认**事实：题集每一条都是从零开始。
    facts: [],
    messages: [],
    observation,
    request: prompt
  })
  const tools = createToolRegistry().forModelPhase("planning", { workspace, confirmed: false, readToolsAvailable: false, capabilityRevision: run.capabilityRevision })
  return { run, userMessage: prompt, budget, signal: new AbortController().signal, model: { context, tools }, conversation }
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
    const request = planRequestFor(entry.prompt, workspace, `benchmark-planning-${entry.id}-${trial}`)
    const envelope = (await createPlanner().plan(request)).plan
    const compiled = compilePlan(envelope, {
      document,
      prompt: entry.prompt,
      conversationId: request.run.conversationId,
      documentGeneration: document.revision
    })
    const latency = { totalMs: Math.max(0, Date.now() - started) }
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
 * 「被拒」的两种来源，**都带真实原文**（读者要能分辨是哪一种）：
 * - 编译器报了 error ⇒ 逐条 `code@path: detail`（不是我们概括的一句话）；
 * - 模型根本没给计划（澄清 / 只读回答）⇒ 它的**问题原文 / 回答原文**。
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
    evidence: envelope?.kind === "clarification"
      ? `模型给的是澄清、不是计划，它问的是：${envelope.questions.join(" / ")}`
      : envelope?.kind === "answer"
        ? `模型给的是只读回答、不是计划：${envelope.answer}`
        : "模型没有给出计划。"
  }]
}

/**
 * 把这一批读数渲染成有界文本（供面板显示，也供用例断言）。
 *
 * 每个数都**直接数 `runs`**，不在这里重算 —— 重算就是第二份口径。
 * 题数从 `runs` 的 `caseId` 去重得到（不重新解析题集：渲染路径上不该再解析一遍）。
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
    `rejected          ${count("rejected")}/${total}`,
    `error             ${count("error")}/${total}`,
    `not measured      ${count("not_measured")}/${total}`,
    `average latency   ${averageLatency === null ? NOT_MEASURED : `${averageLatency} ms (measured runs only)`}`,
    // 仓里没有价目表 ⇒ 成本写 `not measured`，而不是拿一个猜出来的钱数充数。
    `cost              ${NOT_MEASURED}（仓里没有价目表）`
  ].join("\n")
}
