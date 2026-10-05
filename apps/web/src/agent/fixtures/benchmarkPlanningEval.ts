import {
  buildBenchmarkReport,
  buildPlanRequest,
  CAPABILITY_REGISTRY_REVISION,
  compilePlan,
  createBudget,
  parseBenchmarkCases,
  readabilityGroupFor,
  type BenchmarkCase,
  type BenchmarkEvidenceEntry,
  type BenchmarkReport,
  type BenchmarkRun,
  type BenchmarkRunStatus,
  type DocumentHandle,
  type HumanReadability,
  type PlanEnvelope,
  type PlannerPort,
  type PlanCompileResult,
  type PlanRequest,
  type ReadabilityGroup,
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
  /**
   * **人读区要呈现的那段正文**（N4e）—— 每条题一轮，与 `runs` 一一对应。
   *
   * 数据源是 harness 手里本来就有的**信封**（`planner.plan(...)` 的返回值），**不去解析证据串**：
   * 证据是「凭什么这么说」，正文是「说了什么」，两回事。
   *
   * **不放进 `BenchmarkRun.evidence`**（那会让证据变成正文），所以它是**并列的一支**。
   */
  readable: PlanningReadableCase[]
  /** 同一批记录过**报告契约**的校验与分组：不合法会在 `runProviderPlanningEval` 里抛。 */
  report: BenchmarkReport
}

/**
 * 一条题要读的那段东西（N4e）。
 *
 * `text` 是**未截断的原文**；渲染时按 `PER_CASE_READABLE_LIMIT` 截断并如实写原长
 *（沿用本仓既有的"有界文本"纪律）。
 */
export interface PlanningReadableCase {
  caseId: string
  trial: number
  status: BenchmarkRunStatus
  /**
   * 这一轮**有没有对象可读**、属于哪一组；`null` = 没有（`not_measured` / `error`）。
   *
   * 判据来自报告契约那一份（`readabilityGroupFor`）—— 界面据此决定"要不要给标注按钮"，
   * 不在这里另写一套（两套判据必然分叉：例如只看 `status` 会把见证层的同名 `clarification`
   * 也算成"有对象"）。
   */
  group: ReadabilityGroup | null
  /** 模型给的那段东西本身；空串 = 这一轮没有正文可读。 */
  text: string
}

export interface PlanningEvalDependencies {
  /** 现取「使用中」的那一份。缺省走真实 IPC（`resolveActiveProvider`）。 */
  resolveProvider?: () => Promise<ProviderResolution>
  /** 造一个规划器。缺省接真实 provider；用例注入假规划器就能确定性地跑完整条扫描。 */
  createPlanner?: (resolution: Extract<ProviderResolution, { ok: true }>) => PlannerPort
}

/** 报告契约的"哪里出错了"标签：**一处定义**（运行、标注重算两条路都用它）。 */
const PLANNING_REPORT_WHERE = "应用内题集 planning 运行记录"

/**
 * **一次运行有几条记录**：题 × 轮 —— **两条支路共用这一个公式**（fix round，复核 m5）。
 *
 * 为什么要有它：没 provider 的那一支原来是 `cases.map(...)` + **写死的 `trial: 1`**，
 * 而成功那一支是两层循环。两处各写一遍 ⇒ `PLANNING_EVAL_TRIALS` 一变，两支的可读区长度就分叉
 *（而"分叉"在这里的表现是"人读区少了几块"或"多出几块对不上的区块"，不会报错）。
 * 现在"有几条"只由这一个函数回答，两支只管怎么造那一条。
 */
function attemptsFor(cases: readonly BenchmarkCase[]): { entry: BenchmarkCase; trial: number }[] {
  const attempts: { entry: BenchmarkCase; trial: number }[] = []
  for (const entry of cases) {
    for (let trial = 1; trial <= PLANNING_EVAL_TRIALS; trial += 1) attempts.push({ entry, trial })
  }
  return attempts
}

/** 跑一轮真实 provider 的题集 planning 评测。 */
export async function runProviderPlanningEval(dependencies: PlanningEvalDependencies = {}): Promise<PlanningEvalResult> {
  const cases = planningEvalCases()
  const attempts = attemptsFor(cases)
  const resolveProvider = dependencies.resolveProvider ?? resolveActiveProvider
  const resolution = await resolveProvider()

  if (!resolution.ok) {
    /**
     * **一次请求都不发**：解析失败时连规划器都不造（与 `providerAgentEval.ts:58` 同一顺序）。
     * 整批写 `not_measured` + 显式 `null` 的身份 —— 没有凭据时不许"跳过"，也不许编一个数字。
     */
    const runs = attempts.map(({ entry }): BenchmarkRun => ({
      caseId: entry.id,
      provider: null,
      model: null,
      seed: PLANNING_EVAL_SEED,
      mode: "real_provider",
      layer: "planning",
      status: "not_measured",
      evidence: [],
      cost: null,
      latency: null,
      // 没跑 ⇒ 没人标过 ⇒ 未标注（显式 `null`，不是缺省值）。
      humanReadability: null
    }))
    return {
      mode: "real_provider",
      provider: null,
      unavailable: { code: resolution.code, detail: resolution.detail },
      runs,
      // 一行都没跑，所以一条正文都没有（`text` 是空的），但每条题每一轮仍然占一行区块 ——
      // 读者要能看出"这几条没有对象可读"，而不是以为人读区漏了东西。
      readable: attempts.map(({ entry, trial }): PlanningReadableCase => readableCaseFor(entry, trial, "not_measured", "")),
      report: buildReport(runs, PLANNING_REPORT_WHERE)
    }
  }

  const createPlanner = dependencies.createPlanner ?? ((resolved) => createModelPlanner({ resolveProvider: async () => resolved }))
  const identity = { id: resolution.provider.id, modelId: resolution.provider.modelId }
  const runs: BenchmarkRun[] = []
  const readable: PlanningReadableCase[] = []
  for (const { entry, trial } of attempts) {
    // 每条题一个新的规划器实例：真实那一侧因此每次重新解析 provider、拿新的 runId
    //（与 `offlineAgentEval.ts` 的"每次尝试都新建"同一条口径）。
    // **顺序 `await`**（不是并行）：这是一条会花钱的路径，不许把它变成并发请求。
    const one = await runOneCase(entry, trial, identity, () => createPlanner(resolution))
    runs.push(one.run)
    readable.push(one.readable)
  }

  return { mode: "real_provider", provider: identity, unavailable: null, runs, readable, report: buildReport(runs, PLANNING_REPORT_WHERE) }
}

/**
 * **把内存里的标注套到这一批记录上，再用同一份报告契约重算计数**（N4e）。
 *
 * 为什么要有这个函数，而不是让界面自己数一遍：
 * - 界面上每点一次按钮，报告里的"已标 / 未标 / 各自几比几"就要跟着动，而**口径只有一份**
 *   （`buildBenchmarkReport` 的 `readability()`）。界面自己数 = 第二份口径，早晚与报告分叉；
 * - **纯函数**：它返回一份新的结果，不改动传进来的 `result` —— 标注是界面上的内存状态，
 *   **不回写**到这一批记录里（这一版不做任何持久化，也**没有**存储位置）。
 * - 没标注的题记 `null`（= 未标注）。这**不是**给 `humanReadability` 一个缺省值：
 *   `null` 的含义就是"没人标过"，与"默认成 readable"相反。
 */
export function annotateReadability(result: PlanningEvalResult, annotations: Readonly<Record<string, HumanReadability>>): PlanningEvalResult {
  const runs = result.runs.map((run): BenchmarkRun => ({ ...run, humanReadability: annotations[run.caseId] ?? null }))
  return { ...result, runs, report: buildReport(runs, PLANNING_REPORT_WHERE) }
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
): Promise<{ run: BenchmarkRun; readable: PlanningReadableCase }> {
  const base = {
    caseId: entry.id,
    provider: identity.id,
    model: identity.modelId,
    seed: PLANNING_EVAL_SEED,
    mode: "real_provider" as const,
    layer: "planning" as const,
    cost: null,
    // **没有人标过**（标注由人在面板上按三值口径给；这一版没有持久化）。
    humanReadability: null
  }
  const started = Date.now()
  /**
   * **正文在 `try` 内算一次，`catch` 复用同一个值**（fix round，复核 C1）。
   *
   * 初始值是 `""` 是这条纪律的另一半：万一 `readableBody` 还是抛了（不可信输入没有下限），
   * 抛点落在"算正文"这一步时 `text` 仍然是 `""` —— 这一条会**如实记 `error`**，
   * **整批不会被拖垮**，也不会出现半截正文。
   *
   * 改动前是"在 `catch` 里再调一次 `readableBody`"：`try` 内抛 ⇒ 被 `catch` 接住 ⇒
   * `catch` 里**又**调一次同一个无保护的构造 ⇒ 二次抛出直接逃出 `runOneCase` ⇒
   * `runProviderPlanningEval` reject，**一条记录都留不下**（复核员的探针实测：
   * `TypeError: Cannot read properties of undefined (reading 'map')`）。
   */
  let text = ""
  try {
    const workspace = workspaceFor(entry)
    const document = createEmptyDocument(workspace)
    /**
     * **走产品同一条路径**：`createModelPlanner` → `planner.plan(request)` → `compilePlan`。
     * 判题口径只有 `compilePlan` 那一处；这里不另写"模型调用 + 解析"。
     *（`request` 为什么必须完整，见 `planRequestFor` 的注释。）
     */
    const request = planRequestFor(entry.prompt, workspace, `benchmark-planning-${entry.id}-${trial}`, document)
    /**
     * 信封**只在 `try` 里活着**（不再声明到外面）：`catch` 需要的是**已经算好的那段正文**，
     * 不是信封本身 —— 这正是"不许在 `catch` 里再调一次构造"的结构保证。
     */
    const envelope = (await createPlanner().plan(request)).plan
    text = readableBody(envelope)
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
      return outcome(entry, trial, { ...base, status: "clarification", evidence: clarificationEvidence(entry.id, compiled.plan), latency }, text)
    }
    return compiled.ok && compiled.plan?.kind === "plan"
      ? outcome(entry, trial, { ...base, status: "planned", evidence: acceptedEvidence(compiled.diagnostics.length, compiled.actions.length, compiled.draftDocument !== null), latency }, text)
      : outcome(entry, trial, { ...base, status: "rejected", evidence: rejectionEvidence(entry.id, compiled), latency }, text)
  } catch (error) {
    return outcome(entry, trial, {
      ...base,
      status: "error",
      // 原始消息，不加工：这一条读数说的是"跑的时候抛了"，把它概括成一句话会让排障无从下手。
      evidence: [{ claim: entry.id, status: "error", evidence: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }],
      latency: { totalMs: Math.max(0, Date.now() - started) }
      // **复用** `try` 里算过的那一份 —— 不许在这里再调一次构造（那正是 C1 的机制）。
    }, text)
  }
}

/**
 * 把"这一轮的记录"与"这一轮要读的那段东西"配成一对。
 *
 * **两样东西一起返回**（而不是各建一次）是为了它们不可能对不上：人读区第 N 行永远是
 * `runs` 第 N 行的正文。
 */
function outcome(entry: BenchmarkCase, trial: number, run: BenchmarkRun, text: string): { run: BenchmarkRun; readable: PlanningReadableCase } {
  return { run, readable: readableCaseFor(entry, trial, run.status, text) }
}

/** 一条可读区记录：分组用报告契约那一份判据（不在这里另写一套）。 */
function readableCaseFor(entry: BenchmarkCase, trial: number, status: BenchmarkRunStatus, text: string): PlanningReadableCase {
  return { caseId: entry.id, trial, status, group: readabilityGroupFor({ layer: "planning", status }), text }
}

/**
 * **要读的那段东西**（模型给的原话，逐字不加工）：
 * 计划的 `goal` 与动作摘要 / 澄清的问题 / 只读回答的正文。
 *
 * 只做"把结构摊成人能读的几行"，**不解释、不概括、不补**：一旦这里做了概括，
 * 可读性标注量的就是我们的概括，而不是模型给的东西。
 *
 * ## 这个函数的输入是**不可信输出**（fix round，复核 C1）
 *
 * 信封来自模型，`modelPlanner.ts:315-316` 自己的注释就写着"**不可信输出**"：
 * `:585` 在 `parsePlanEnvelope` 失败时**原样**交出模型给的形状（`actions` 可能根本没有），
 * `:606` 与 `:325-329`（文本通道）在 `JSON.parse` 失败时交出的是**原始字符串**。
 *
 * 所以这里**逐项防御**，两条纪律：
 * - **认不出的形状一律返回 `""`**（= 没有可读正文）。**不抛** —— 抛了会把这一条变成"跑的时候抛了"，
 *   而在改动之前它甚至会把**整批**拖垮（见 `runOneCase` 的注释）；
 * - **不拼接**：`只读回答：${undefined}` 这种"我们自己编出来的正文"绝不许出现 ——
 *   面板会把它当"模型给的那段东西"摆出来，旁边就是三个可读性按钮，**人会拿它去打分**。
 */
function readableBody(envelope: PlanEnvelope | null): string {
  if (typeof envelope !== "object" || envelope === null) return ""
  const shape = envelope as { kind?: unknown }
  if (shape.kind === "plan") {
    const plan = envelope as { goal?: unknown; actions?: unknown }
    if (typeof plan.goal !== "string" || !Array.isArray(plan.actions)) return ""
    // 动作名也逐项查：`actionId` 不是非空字符串时**不编一个名字**（"undefined" 与占位串都是编的）。
    const ids = plan.actions.map((action) => (typeof action === "object" && action !== null ? (action as { actionId?: unknown }).actionId : undefined))
    if (!ids.every((id): id is string => typeof id === "string" && id.trim().length > 0)) return ""
    const actions = ids.map((id, index) => `${index + 1}. ${id}`)
    return [
      `目标：${plan.goal}`,
      `动作（${plan.actions.length} 条）：${actions.length === 0 ? "（这份计划没有动作）" : actions.join("；")}`
    ].join("\n")
  }
  if (shape.kind === "clarification") {
    const questions = (envelope as { questions?: unknown }).questions
    if (!Array.isArray(questions) || !questions.every((question): question is string => typeof question === "string")) return ""
    return `提问：${questions.join(" / ")}`
  }
  if (shape.kind === "answer") {
    const answer = (envelope as { answer?: unknown }).answer
    return typeof answer === "string" ? `只读回答：${answer}` : ""
  }
  // 连 `kind` 都不是那三种之一（例如交上来一个**原始字符串**）：**没有可读正文**。
  return ""
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
 * **人读区每条的截断上限**：与证据那条上限分开写，因为它们会各自演进
 *（正文是"要读的东西"，比一句理由长得多；共用一个常量会让调其中一个时误伤另一个）。
 */
export const PER_CASE_READABLE_LIMIT = 480

/** 有界文本：截断时**如实写原长**（本仓既有的做法，两处用同一份实现）。 */
function boundedText(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…（已截断，原长 ${text.length}）` : text
}

/**
 * **这一条有没有正文可读**（空串 / 全空白都算没有）。
 *
 * 定义只有一处：呈现（`readableTextForDisplay`）与界面（人读区那一句说明）共用它 ——
 * 否则会出现"正文明明有，旁边却写着'没有正文可读'"这种**同屏自相矛盾**
 *（fix round，复核 m7）。
 */
export function hasReadableBody(entry: PlanningReadableCase): boolean {
  return entry.text.trim().length > 0
}

/**
 * 人读区里显示的那段文本：**空正文如实说"没有正文可读"**，否则按上限截断。
 *
 * 空正文**不是**"渲染失败"：`not_measured` / `error` 那两条本来就没有对象可读
 *（它们也因此不进可读性分母、不给标注按钮）。
 */
export function readableTextForDisplay(entry: PlanningReadableCase): string {
  return hasReadableBody(entry) ? boundedText(entry.text, PER_CASE_READABLE_LIMIT) : "（这一条没有正文可读）"
}

/** `readableRate` 的呈文：**分母为 0 时说的是"未标注"，不是一个 0 分**。 */
function readabilityRateText(rate: number | null): string {
  return rate === null ? "未标注（分母 = 已标 0，不是 0 分）" : rate.toFixed(3)
}

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
  const readability = result.report.realProvider.readability

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
    ...formatReadabilitySection(readability),
    "",
    `per case（每条题一行：题 id / 结局 / 理由原文）`,
    ...result.runs.map((run) => {
      const evidence = run.evidence.map((entry) => entry.evidence).join(" | ")
      return `  ${run.caseId}  ${run.status}  ${boundedText(evidence, PER_CASE_EVIDENCE_LIMIT) || "（这一轮没测）"}`
    })
  ].join("\n")
}

/**
 * **人工可读性的计数行**（N4e）—— 口径先写死，再谈数字。
 *
 * 三条必须能从这五行里读出来：
 * 1. **判断者是谁**：一个**不懂实现的人**（不是实现者）—— 所以那个判断只能由人给；
 * 2. **分母是什么**：只有"有对象可读"的轮次；`not_measured` / `error` 不进；
 *    `plan` 与 `clarification` **各有各的分母**（问法清不清楚 ≠ 计划好不好）；
 * 3. **"未标注"与"0 分"可分辨**：一条都没标时比率写的是「未标注（分母 = 已标 0，不是 0 分）」，
 *    而**不是** `0.000`。本批做完的真实状态正是这个 —— 不许拿 0 或占位比率凑。
 */
function formatReadabilitySection(readability: BenchmarkReport["realProvider"]["readability"]): string[] {
  return [
    "人工可读性（判断者：一个不懂实现的人 —— 只问「它打算建什么、依据是什么」能不能看懂）",
    "  三值 readable / partly / unreadable；没标注就是「未标注」，**不是** 0 分。",
    "  分母只算有对象可读的轮次：not_measured / error 不进；plan 与 clarification 各有各的分母。",
    ...readability.groups.map((group) =>
      `  ${group.group.padEnd(14)}已标 ${group.annotated} / 未标 ${group.unannotated}   ` +
      `readable ${group.byValue.readable} / partly ${group.byValue.partly} / unreadable ${group.byValue.unreadable}   ` +
      `readable 比率 ${readabilityRateText(group.readableRate)}`
    ),
    `  ${"合计".padEnd(12)}已标 ${readability.annotated} / 未标 ${readability.unannotated}`
  ]
}
