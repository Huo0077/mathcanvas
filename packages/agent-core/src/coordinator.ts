import type { Budget } from "./budget"
import { buildContext, buildConversationContext, type ConversationContextSource, type Fact } from "./contextBuilder"
import { parsePlanEnvelope, repairRequestFor } from "./schemas"
import { MAX_REPAIR_ATTEMPTS, type PlanEnvelope, type RunContext } from "./contracts"
import type { CancelReason, CancelResult, CommitterPort, ConsentToken, ObserverPort, PlannerPort, PlanRequest, ToolPort } from "./coordinatorPorts"
import { createBudget, type BudgetLimits } from "./budget"
import { describeRepairPrompt } from "./outputParser"
import { describeCompileRepairPrompt } from "./planCompiler"
import { createToolRegistry, type ToolRegistry } from "./toolRegistry"
import { createRunLedger, type RunEvent, type RunLedger } from "./runState"

/**
 * **协调器**（Task 2.1）。
 *
 * 它是"谁在什么时候能做什么"的唯一裁决者，而它自己**不做任何 IO** ——
 * 模型、场景、编译提交、只读工具全部是注入的端口（见 `coordinatorPorts.ts`）。
 *
 * 五条纪律，逐条都有用例：
 * 1. **模型输出永远不可信**：`plan` 端口回来的东西必须过 `parsePlanEnvelope`，落草稿前还要过
 *    六层编译管线。**两个阶段共用那一次"可见的修复机会"**（计划 Task 2.3/2.4 的 repair 通道）：
 *    修形状还是修字段由失败的位置决定，用完仍是失败则整次运行 `failed` ——
 *    而且**没有修复请求就不再问模型**（无请求的重试只是一次盲目的重复）。
 * 2. **缺事实不许猜**：计划信封引用的 `factId` 必须在观察结果里。缺了就走 `waiting`
 *    （**不是**失败）—— 问用户比编一个数字好。
 * 3. **写入只有一条路**：`CommitterPort.commit`，且必须带 `ConsentToken`。协调器**不构造**同意凭据，
 *    只把它从调用方传下去。
 * 4. **取消可传播**：一个 `AbortController` 贯穿所有端口；取消后**不再发出任何事件**，
 *    也就不会有迟到结果写进账本（计划 Step 5）。
 * 5. **预算是闸不是装饰**：每一步之前 `budget.consume(...)`，被拒即停止；预算被拒**不改文档**。
 */

export interface CoordinatorDependencies {
  planner: PlannerPort
  observer: ObserverPort
  committer: CommitterPort
  tools?: ToolPort
  /**
   * 模型技能的请求列表（`buildContext` 会去技能目录校验并按哈希加载）。
   *
   * 缺省为空：**没有请求的技能就不进上下文**。技能是"这次允许模型用哪些做法"的声明，
   * 而"什么都没声明"与"声明的都加载失败"是两回事 —— 后者会在上下文的 `warnings` 里留痕。
   */
  requestedSkillIds?: readonly string[]
  /**
   * 只读阶段可用的动作名（来自能力注册表 / 技能清单）。
   *
   * 为什么由调用方给而不是协调器自己算：动作名的**可用性**判据在能力注册表里，
   * 而注册表是"这一版软件能做什么"的事实，可能随环境变化；协调器只管把它原样放进上下文。
   */
  availableActions?: readonly string[]
  /**
   * 上下文条数上限（只能**收紧**，两个组装器内部另有硬上限）。
   *
   * `derived` 必须在这里：提示词渲染的是**会话那一份**派生读数
   *（`conversation.observation.derived ?? context.derived`），所以只把上限递给
   * `buildContext` 时，"这一轮少给几条读数"看着生效了，模型看到的却没变。
   * 协调器把同一个数递给两个组装器（见 `conversationLimitsFor`）。
   */
  contextLimits?: { facts?: number; refs?: number; derived?: number }
  /**
   * **会话上下文的来源**（对话切片 Task 4；规格 §5.3）。
   *
   * 函数而不是值：宿主拿它的时候要现读会话（消息、摘要、已确认事实），
   * 而"哪条会话"由宿主自己钉住 —— 协调器只管**一次运行取一次**。
   *
   * 缺省（不传）时协调器用运行自述造一份最小的：绑定来自 `RunContext`，
   * 历史、摘要、事实都是空的。这样"端口形状"不因为老调用方而变成可空。
   */
  conversation?: () => ConversationContextSource
  /**
   * 有序的选中引用。
   *
   * 函数而不是数组：引用带内容哈希，而哈希必须**现取**才准（缓存会让"过期"永远检测不到，
   * 与句柄那条纪律同一理由）。
   */
  selectedRefs?: () => Parameters<typeof buildContext>[0]["selectedRefs"]
  /** 已由宿主创建的同意凭据；没有它就只能停在 `awaiting_confirmation`。 */
  consent?: ConsentToken
  limits?: Partial<BudgetLimits>
  /** 可替换的工具注册表（测试用；缺省用真实目录）。 */
  toolRegistry?: ToolRegistry
  now?: () => number
  /** 每次运行拿到的预算；默认按 `limits` 新建。注入点供测试观察用量。 */
  budget?: Budget
  /**
   * **已校验的计划**到手时的通知点（可选）。
   *
   * 存在的理由：计划里有几样东西协调器自己**用不到**，但宿主必须看得见 ——
   * 最典型的是 `assumptions`（"我替你定了半径 3"）。它们既不该塞进 `RunEvent.detail`
   * （那是给日志看的一句话），也不该让宿主再去问一次规划器（那就等于跑两遍模型）。
   *
   * 传的是**已校验的值**（`parsePlanEnvelope` 的输出），所以接收方可以放心读字段；
   * 解析失败的计划**不会**走到这里。
   */
  onPlanParsed?: (plan: PlanEnvelope) => void
  /**
   * **编译之前**的一次准备机会（例如把工作区切到这条计划需要的那个）。
   *
   * 为什么需要它：动作编译器会拒绝"工作区不匹配"的动作（`solid.create_template` 在
   * 平面几何里会被拒），而**用户在 Agent 里说"建一个立方体"时，画布可能停在平面几何**。
   * 没有这一步，用户就必须先自己切工作区再重发一次 —— 那不是"对话式作图"。
   *
   * 它拿得到的是**已校验的计划**（不是模型的原始输出），所以准备逻辑可以放心读 `actions`。
   * 返回 `ok: false` 时协调器停在 `failed` 并把原因带出来（例如"这条指令需要先离开工程制图"）。
   */
  prepare?: (plan: PlanEnvelope) => { ok: true } | { ok: false; detail: string }
}

export interface StartRequest {
  run: RunContext
  userMessage: string
  /** 用户在预览里点了确认；没有它协调器不会尝试提交。 */
  confirmed?: boolean
}

export interface AgentCoordinator {
  start(request: StartRequest): AsyncIterable<RunEvent>
  cancel(reason?: CancelReason): CancelResult
  /** 供宿主在取消/中断之后查询账本（计划 Step 5 的 "unless commit status is queried by idempotency key"）。 */
  ledger(): readonly RunEvent[]
  phase(): RunEvent["phase"]
  /**
   * **用户确认之后把账本走完**（外部审查 A4）。
   *
   * `start()` 在 `awaiting_confirmation` 就返回了 —— 这是对的，同意凭据要等用户点确认才存在。
   * 但**落库的 `run_events` 就是这份账本**：少了"确认之后"这一步，生产里的账本永远停在
   * "等用户确认"，**即使文档真的提交了** —— `committing` / `completed` 于是只有测试够得到，
   * 而"运行账本"作为一份事实记录就是**失真的**（它说没提交，可画布已经变了）。
   *
   * 宿主在 `HostBridge.commit` 拿到结果之后调用它，把 `committing → completed` 补进账本，
   * 并返回这几条事件（宿主负责让它们回流到界面与持久化）。
   *
   * **只有成功才补记**：提交被拒时这一轮**仍然停在"等用户确认"**（面板还挂着、用户还能再点一次，
   * 见 `agentRunner.confirm` 的 "只有真的落定才把这一轮用掉"）。那时把账本推成 `failed`
   * 会与界面状态互相矛盾，而且会把一个还能重试的运行钉成终态 —— 于是重试成功也记不进去了。
   * 相位不是 `awaiting_confirmation` 时同样什么都不做（幂等）。
   */
  settleConfirmation(outcome: { status: string; detail?: string }): RunEvent[]
}

/**
 * 一共允许问模型几次：**一次原始尝试 + 一次修复**。
 *
 * 与 `MAX_REPAIR_ATTEMPTS`（`contracts.ts`，全局约束 "Repair is limited to one request"）
 * 绑在一起而不是各写一个数字：两处各写一份，迟早会出现"给了修复却还允许第三次尝试"
 * 或者反过来"修复额度说 0 但这里还在问"。修复**共用运行预算**，不另开配额（见 `budget.ts`）。
 */
const MAX_PLAN_ATTEMPTS = 1 + MAX_REPAIR_ATTEMPTS

/**
 * **这一轮生效的会话上下文上限**：宿主声明的 + 协调器这一轮要求收紧的。
 *
 * `derived` 以协调器为准（它设了就用它）：这一条决定了**提示词渲染几条派生读数**
 *（提示词读的是会话那一份），而"这一轮不该看那么多"只有运行这一层知道。
 * 两种上限最终都会被组装器夹进硬上限里，所以这里只管把数递下去。
 */
function conversationLimitsFor(source: ConversationContextSource | undefined, limits: CoordinatorDependencies["contextLimits"]): NonNullable<ConversationContextSource["limits"]> | undefined {
  const merged = { ...(source?.limits ?? {}), ...(limits?.derived === undefined ? {} : { derived: limits.derived }) }
  return Object.keys(merged).length === 0 ? undefined : merged
}

export function createCoordinator(dependencies: CoordinatorDependencies): AgentCoordinator {
  const now = dependencies.now ?? (() => Date.now())
  let ledger: RunLedger | null = null
  let controller: AbortController | null = null
  let cancelled = false
  /** 最近一次 `start` 的目标句柄：补记确认结果时 `record` 的 patch 用它。 */
  let lastTarget: RunContext["target"] | undefined

  function cancel(reason: CancelReason = "user"): CancelResult {
    if (!ledger) return { cancelled: false, phase: "created" }
    if (ledger.finished()) return { cancelled: false, phase: ledger.phase() }
    cancelled = true
    // 端口负责真的中断自己的 IO；协调器只保证信号发出去、之后不再发事件。
    controller?.abort()
    ledger.transition(reason === "interrupted" ? "interrupted" : "cancelled", reason === "interrupted" ? "the app was interrupted" : "the user cancelled the run")
    return { cancelled: true, phase: ledger.phase() }
  }

  async function* run(request: StartRequest): AsyncGenerator<RunEvent> {
    const budget = dependencies.budget ?? createBudget(dependencies.limits)
    lastTarget = request.run.target
    ledger = createRunLedger({ runId: request.run.runId, promptMessageId: request.run.promptMessageId, handle: request.run.target, now })
    controller = new AbortController()
    const signal = controller.signal

    const started = ledger.transition("preflight", "checking capabilities and the target handle", { handle: request.run.target })
    if (started.ok) yield started.event

    try {
      // ---- 观察场景 ----------------------------------------------------
      if (!spend(budget, "tool")) return yield* stop("budget_tool")
      const observing = ledger.transition("observing", "reading the scene")
      if (observing.ok) yield observing.event
      const observation = await dependencies.observer.observe({ run: request.run, signal })
      if (cancelled) return
      ledger.record(`observed ${observation.factIds.length} confirmed fact(s)`, { requestId: null })

      // ---- 组装模型这一次能看到的一切（上下文 + 按阶段发布的工具） --------------
      /**
       * 两件事都在**发请求之前**做，而且**只做一次**：两次尝试（含那次修复）必须看到
       * 同一份上下文与同一批工具 —— 否则"第二次机会"其实换了题目，事后没法判断是模型改好了
       * 还是条件变了。
       *
       * 为什么放在 agent-core 而不是让 app 侧适配器自己组装（见 `PlanRequest.model` 的注释）：
       * `buildContext` 与 `createToolRegistry` 都是这个包自己的部件，而"哪个阶段发布什么工具"
       * 是安全边界，不该搬到 app 侧去。
       */
      const registry: ToolRegistry = dependencies.toolRegistry ?? createToolRegistry()
      const modelContext = buildContext({
        run: request.run,
        // 观察端口给的事实文本与来源原样带进去（只有 `factIds` 时，上下文里的事实就只剩一串 id）。
        // **派生立体读数**（内核给出的四态结论）同样从观察结果里搬：它是 §6.2 明令
        // schema 不许自己重算的东西，所以协调器只负责原样转交，不解释也不补全。
        observation: {
          facts: (observation.facts ?? []).map((fact): Fact => ({ id: fact.id, text: fact.text, origin: fact.origin })),
          summary: observation.summary,
          ...(observation.derived === undefined ? {} : { derived: observation.derived })
        },
        requestedSkillIds: dependencies.requestedSkillIds ?? [],
        selectedRefs: dependencies.selectedRefs?.() ?? [],
        availableActions: dependencies.availableActions ?? [],
        budget,
        limits: dependencies.contextLimits
      })
      /**
       * **上下文预算真的计费**（外部审查 M2）。
       *
       * `buildContext` 一直收着 `budget` 却**从不使用**它，`estimatedCharacters` 也算了出来
       * （它的注释就写着"供调用方核对预算"）却没人核对 —— 于是 `context` / `time` / `geometry`
       * 三类永远扣不了费，`budget.exhausted()` 的那三段判断**永远不可能为真**，
       * 而比上限还长的场景摘要照样发出去。预算模块自己的文档把这种情况叫"装饰"。
       *
       * ## 为什么除以 4（这一步是量纲，不是凑数）
       *
       * `BudgetKind` 的文档把 `context` 写成"上下文 **token** 估算"，而 `estimatedCharacters`
       * 是**字符数** —— 直接拿字符去扣是把两种量纲混在一起。实测：这条路径上一个
       * "13 只立体、读数已经夹到上限"的**正常**场景就已经是 **79,293 字符**，
       * 拿它去扣 32,000 的额度会把一次完全正常的运行判成预算耗尽 —— 那说明 32,000 这个数
       * 不可能是字符。按通行的 ~4 字符/token 折算之后它约 19.8k token，落在额度之内。
       *
       * 这也让这条额度回到"真正的安全阀"的位置：默认 32k token 对应约 128k 字符，
       * 只有异常膨胀的上下文才会撞上它 —— 而不是每次正常运行都撞。
       */
      const estimatedTokens = Math.ceil(modelContext.estimatedCharacters / 4)
      if (estimatedTokens > 0 && !spend(budget, "context", estimatedTokens)) return yield* stop("budget_context")
      /**
       * **会话上下文**：宿主的来源（消息/摘要/事实/草稿）+ 运行里的观察 + 这一轮的请求。
       *
       * 与 `modelContext` 一样**只组装一次**，两次尝试共用同一个对象 —— "第二次机会"
       * 必须是同一个题目下的第二次尝试。
       */
      const source = dependencies.conversation?.()
      const conversationLimits = conversationLimitsFor(source, dependencies.contextLimits)
      const conversation = buildConversationContext({
        binding: source?.binding ?? {
          conversationId: request.run.conversationId,
          projectId: request.run.target.projectId,
          documentId: request.run.target.documentId,
          workspace: request.run.target.workspace,
          generation: request.run.target.generation
        },
        summary: source?.summary ?? "",
        facts: source?.facts ?? [],
        messages: source?.messages ?? [],
        ...(source?.draft === undefined ? {} : { draft: source.draft }),
        ...(conversationLimits === undefined ? {} : { limits: conversationLimits }),
        // 会话上下文那一份也要带派生读数：它是提示词渲染 `scene` 的另一条来源。
        observation: {
          facts: (observation.facts ?? []).map((fact): Fact => ({ id: fact.id, text: fact.text, origin: fact.origin })),
          summary: observation.summary,
          ...(observation.derived === undefined ? {} : { derived: observation.derived })
        },
        request: request.userMessage
      })
      const phaseTools = registry.forPhase("planning", {
        workspace: request.run.target.workspace,
        // 规划阶段还没有确认：提交工具在这个阶段根本不该出现（注册表自己保证）。
        confirmed: false,
        capabilityRevision: request.run.capabilityRevision
      })
      ledger.record(`context ready: ${modelContext.facts.length} scene fact(s), ${conversation.facts.length} confirmed fact(s), ${conversation.messages.length} message(s), ${phaseTools.length} tool(s)`, { requestId: null })

      // ---- 向模型要计划 ------------------------------------------------
      if (!spend(budget, "generation")) return yield* stop("budget_generation")
      if (!spend(budget, "network")) return yield* stop("budget_network")
      const planning = ledger.transition("planning", "asking for a plan")
      if (planning.ok) yield planning.event

      /**
       * 通过六层编译、真正要落草稿的那一份计划。
       *
       * 声明成 `kind: "plan"` 那一支（而不是整个信封联合）是刻意的：循环结束时它是唯一
       * 还能继续走下去的形状 —— "只读回答"与"澄清"两条路径都在循环里 `return` 了。
       */
      let stagedPlan: Extract<PlanEnvelope, { kind: "plan" }> | null = null
      /** 暂存成功的产物：**只有它非空时**这次运行才有草稿可走下去。 */
      let staged: { draftVersion: number; previewHash: string } | null = null
      let lastDetail = ""
      /**
       * `requestId` / `attemptId` 在**第一次往返之后**才知道，而 `planning` 事件在往返之前就发出来了。
       * 所以这里把它们挂到"计划已到手"的那条事件上（`ledger.record` 的 patch 会累积到后续事件），
       * 这样"哪个请求、哪次尝试产生了这份计划"始终可查 —— 计划 Step 4 要的正是这个。
       */
      let lastAttemptIds: { requestId: string; attemptId: string } | null = null
      /**
       * 上一次尝试的失败，供**第二次尝试**带上（Task 2.3 Step 5："Include exact JSON path
       * errors in the second prompt"）。
       *
       * 没有它，"一次性修复"只是把同一份请求再发一遍 —— 模型没有任何理由换个答案。
       *
       * 它有两个**来源**，但只有一份真源 `RepairRequest`（`reason` / `errors` /
       * `allowedChanges` / `attempt`）：
       * - 传输解析失败 → `repairRequestFor(解析错误, attempt)`，提示用 `describeRepairPrompt`；
       * - **编译阶段失败 → `compilePlan` 已经造好的那一份**，经 `CommitterPort.stage`
       *   的失败结果原样带回来，提示用 `describeCompileRepairPrompt`。
       */
      let repair: PlanRequest["repair"]
      /**
       * **已经开始的修复次数**（整次运行**只允许一次**）。
       *
       * 计划 Global Constraints："Repair is limited to one request and shares the run budget."
       * 计数放在协调器而不是各端口里：只有它同时知道"这一次是原始尝试还是修复"与"预算还剩多少"。
       */
      let repairsStarted = 0

      /**
       * **一次原始尝试 + 一次可见修复**的循环。
       *
       * 修复可能发生在**两个位置**，但永远不会重来第三次：
       * - 计划连信封都不合法（传输解析这一层就拒）→ 修的是形状；
       * - 计划合法但编译阶段拒了它（字段审计 / 引用解析 / 参数补全 / 几何语义 / 动作编译）
       *   → 修的是字段，请求来自编译器。
       *
       * 两条路径共用 `repair` 与 `repairsStarted`，所以"总共只修一次"是结构性的，
       * 而不是靠每个分支各自记得别多问一次。
       */
      for (let attempt = 1; attempt <= MAX_PLAN_ATTEMPTS && stagedPlan === null; attempt += 1) {
        if (attempt > 1) {
          // 第二次尝试是**可见的修复**：它花掉的是同一份预算的另一个名额。
          if (!spend(budget, "generation") || !spend(budget, "network")) return yield* stop("budget_repair")
          /**
           * 上一次失败发生在**编译阶段**时账本现在停在 `compiling`，而这一次是重新提问 ——
           * 所以先回到 `planning`（`compiling → planning` 这条边只由这条路径用到，
           * 它让账本与界面都能看出"这是同一份运行里的第二次规划"）。
           * 上一次失败发生在传输解析时账本仍在 `planning`，不需要（也不允许）再转移一次。
           */
          if (ledger.phase() !== "planning") {
            const replanning = ledger.transition("planning", `asking for the one repair (${repairsStarted}/${MAX_REPAIR_ATTEMPTS})`)
            if (replanning.ok) yield replanning.event
          }
        }
        const outcome = await dependencies.planner.plan({ run: request.run, userMessage: request.userMessage, budget, signal, model: { context: modelContext, tools: phaseTools }, conversation, repair })
        if (cancelled) return
        lastAttemptIds = { requestId: outcome.requestId, attemptId: outcome.attemptId }
        ledger.record(`plan attempt ${attempt} returned`, lastAttemptIds)

        const result = parsePlanEnvelope(outcome.plan)
        if (!result.ok) {
          lastDetail = result.errors.map((error) => `${error.code}@${error.path}`).join(", ").slice(0, 512)
          ledger.record(`plan attempt ${attempt} was rejected: ${lastDetail}`)
          /**
           * 组装**下一次**要用的修复提示。
           *
           * `describeRepairPrompt` 收的是 `EnvelopeParseFailure`；协调器这一层拿到的是
           * `parsePlanEnvelope` 的错误列表。`reason` 用 `schema_invalid`（两边同名），
           * `channel` 给 `fenced_text` —— 那是**最宽松**的通道（一次外层围栏 + 围栏内只有 JSON），
           * 所以在"不知道对方用哪个通道"时说它不会给出错误的格式建议。
           *
           * 请求本身走已注册的 `repairRequestFor`：于是"允许改哪几处"（`allowedChanges`）
           * 与编译阶段那一份是同一个算法，不再是这里手写的一句话。
           */
          const next = repairRequestFor(result.errors, repairsStarted + 1)
          if (repairsStarted >= MAX_REPAIR_ATTEMPTS || next.attempt > MAX_REPAIR_ATTEMPTS) break
          repairsStarted += 1
          repair = { ...next, hint: describeRepairPrompt({ ok: false, reason: "schema_invalid", errors: result.errors, payload: "", channel: "fenced_text" }) }
          continue
        }

        /**
         * 计划已通过校验：把它交给宿主（假设、以及其他协调器自己用不上的东西都从这里出去）。
         *
         * 放在循环里是刻意的：修复那一次同样要交出去，而且**后一份覆盖前一份** ——
         * 真正要落地的是最后通过编译的那一份计划。
         */
        const candidate = result.value
        dependencies.onPlanParsed?.(candidate)

        // ---- 缺事实 → 等用户补充（不是失败） --------------------------------
        const known = new Set(observation.factIds)
        const missing = candidate.factIds.filter((factId) => !known.has(factId))
        if (missing.length > 0) {
          /**
           * **缺事实要说清"缺的是哪个"**（外部审查 Agent-M4）。
           *
           * 原先这句文案是 `waiting for the user to confirm: <ids>` —— 两处都不对：
           * ①"等你确认"是**另一个**来源（规划器给的澄清问题）的说法，这里其实是"计划引用了
           * 本次观察里没有的对象"；②而宿主那条 `waiting` 消息只看 `questions()`
           *（这条路径上它是空的），于是**连这几个 id 都到不了用户眼前** ——
           * 用户看到的是一句写死的"这一步需要你补充信息。"，既不点名、也无从回答。
           *
           * 现在如实说"缺的是哪些对象"，宿主再把这句话原样转给用户
           *（`agentRunner` 在 `waiting` 分支里读账本最后一条）。
           */
          const detail = `the plan needs objects this run did not observe: ${missing.join(", ")}`
          const waiting = ledger.transition("waiting", detail)
          if (waiting.ok) yield waiting.event
          return
        }

        // ---- 只读回答：没有动作，走显式的 `answering` 路径 --------------------
        if (candidate.kind !== "plan") {
          const answering = ledger.transition("answering", candidate.kind === "answer" ? "answering from the scene" : "asking the user a clarifying question")
          if (answering.ok) yield answering.event
          if (candidate.kind === "clarification") {
            const waiting = ledger.transition("waiting", "waiting for the user's answer")
            if (waiting.ok) yield waiting.event
            return
          }
          const completed = ledger.transition("completed", "the run produced no draft")
          if (completed.ok) yield completed.event
          return
        }

        // 走到这里它必然是 `kind: "plan"`（另外两种信封在上面那条分支里已经走完了）。
        const plan = candidate

        // ---- 草稿：编译 → 校验 → 等确认 → 提交 -------------------------------
        // 编译之前给宿主一次准备机会（例如切到这条计划需要的工作区）。
        // 放在编译**之前**是必须的：工作区不匹配的动作会被编译器直接拒。
        if (dependencies.prepare) {
          const prepared = dependencies.prepare(plan)
          if (!prepared.ok) {
            const failed = ledger.transition("failed", `could not prepare the target: ${prepared.detail}`)
            if (failed.ok) yield failed.event
            return
          }
        }

        const actionCount = plan.actions.length
        /**
         * **每次暂存之前重置"单次暂存的动作数"**（外部审查 M1）。
         *
         * `Budget.beginStage()` 的文档写着"进入下一次暂存：重置 `actions_per_stage`"，
         * 而它在整个仓库里**没有任何调用方**（只有 `budget.test.ts` 调过）——
         * 于是这个"每次暂存重置"的名额退化成了**第二个整次运行计数器**，修复那一次也来分它。
         * 实测（审计探针）：20 个动作的计划、committer 失败一次并给出修复请求之后，
         * 这一轮会以 `budget exhausted: budget_actions_per_stage` 结束 ——
         * 而 `actions_per_run` 还剩 108，每一次暂存也都没超过 32。
         * 它报了一次**没有发生**的预算耗尽，还丢掉了那唯一一次修复机会。
         */
        budget.beginStage()
        if (!spend(budget, "actions_per_stage", actionCount)) return yield* stop("budget_actions_per_stage")
        if (!spend(budget, "actions_per_run", actionCount)) return yield* stop("budget_actions_per_run")

        const compiling = ledger.transition("compiling", `staging ${actionCount} action(s)`)
        if (compiling.ok) yield compiling.event

        // 用户原话随暂存一起下去：参数审计的三条判据（符号参数 / 从原话读数字 / 采样≠证明）
        // 都在编译这一层，而原话只有协调器手里有（Fix round 1 / C3）。
        const stagedResult = await dependencies.committer.stage({ run: request.run, actionCount, actions: plan.actions, userMessage: request.userMessage, signal })
        if (cancelled) return
        if (stagedResult.ok) {
          staged = stagedResult
          // 只有**编译通过**的那一份才算数：修复那一次失败时循环会继续，这份仍是空的。
          stagedPlan = plan
          ledger.record(`draft v${stagedResult.draftVersion} staged`, { draftVersion: stagedResult.draftVersion })
          break
        }

        const detail = `${stagedResult.reason}${stagedResult.detail ? `: ${stagedResult.detail}` : ""}`
        lastDetail = detail
        ledger.record(`plan attempt ${attempt} was refused by the compiler: ${lastDetail}`)
        /**
         * **编译阶段的那一次修复**（Agent DSL 切片 Task 4 的接线缺口）。
         *
         * 判据只有一条：**编译器给了修复请求**（`compilePlan` 的 `repair`）。
         * 没有请求就**不再问模型** —— 那只是一次盲目的重复；"用户能回答的澄清问题"
         * 正是这种形状（规格 §7：无安全默认时返回 clarification，问用户比让模型重发好）。
         *
         * `attempt` 由协调器写死成它自己的计数：`MAX_REPAIR_ATTEMPTS` 是**整次运行**的额度，
         * 不是某个端口的。编译器那一份给的是 1，两处在这里对齐。
         */
        const compileRepair = stagedResult.repair
        if (stagedResult.reason === "compile_failed" && compileRepair !== undefined && compileRepair.attempt <= MAX_REPAIR_ATTEMPTS && repairsStarted < MAX_REPAIR_ATTEMPTS) {
          repairsStarted += 1
          repair = {
            ...compileRepair,
            attempt: repairsStarted,
            hint: describeCompileRepairPrompt(compileRepair, stagedResult.planDiagnostics ?? []),
            ...(stagedResult.planDiagnostics === undefined ? {} : { diagnostics: stagedResult.planDiagnostics }),
            ...(stagedResult.assumptions === undefined ? {} : { assumptions: stagedResult.assumptions })
          }
          continue
        }

        // 不可修的失败（文档被改过、草稿过期、没有修复请求）→ 如实失败，**绝不静默重试**。
        const failed = ledger.transition("failed", detail)
        if (failed.ok) yield failed.event
        return
      }

      if (stagedPlan === null || staged === null) {
        const failed = ledger.transition("failed", `the plan never matched the schema: ${lastDetail}`, lastAttemptIds ?? undefined)
        if (failed.ok) yield failed.event
        return
      }

      const validating = ledger.transition("validating", "checking the staged draft against the document")
      if (validating.ok) yield validating.event

      /**
       * **永远先停在 `awaiting_confirmation`**，哪怕调用方这次已经带上了 `confirmed`。
       *
       * 我第一版在这里走了 `validating → committing` 的捷径（有同意就跳过确认状态），
       * 结果被转移表当场拒绝（`illegal_transition`）—— 那条捷径是错的：
       * 确认状态不是"等用户点按钮"的 UI 细节，而是**账本必须留下的记录**。
       * 跳过它，事后就无法区分"用户确认过"与"调用方直接调了提交"。
       */
      const confirming = ledger.transition("awaiting_confirmation", "waiting for the user to confirm the preview")
      if (confirming.ok) yield confirming.event

      if (!request.confirmed || !dependencies.consent) return

      const committing = ledger.transition("committing", "applying the confirmed draft")
      if (committing.ok) yield committing.event

      // 提交用的是**通过编译的那一份**计划（修复之后可能是第二份）。
      const outcome = await dependencies.committer.commit({ run: request.run, actionCount: stagedPlan.actions.length, actions: stagedPlan.actions, userMessage: request.userMessage, signal, consent: dependencies.consent })
      if (cancelled) return

      if (outcome.status === "committed" || outcome.status === "no_change") {
        ledger.record(`commit ${outcome.status}`, { handle: outcome.handle ?? request.run.target })
        const completed = ledger.transition("completed", outcome.status === "committed" ? "the document was updated" : "nothing needed to change")
        if (completed.ok) yield completed.event
        return
      }

      // 提交被拒：如实失败，绝不假装成功（计划 G2 Gate："model claims success without receipt" 是不允许的）。
      const failed = ledger.transition("failed", `commit refused: ${outcome.status}${outcome.detail ? ` (${outcome.detail})` : ""}`)
      if (failed.ok) yield failed.event
    } catch (error) {
      // provider 失败等异常统一落到 `failed`；已取消时不再补一条失败事件（取消已经是终态）。
      if (cancelled || (ledger?.finished() ?? true)) return
      const failed = ledger.transition("failed", describe(error))
      if (failed.ok) yield failed.event
    }
  }

  function spend(budget: Budget, kind: Parameters<Budget["consume"]>[0], amount = 1): boolean {
    return budget.consume(kind, amount).ok
  }

  /** 预算被拒：**什么都不做**（不改文档），如实落到 failed 并说明是哪一项额度用尽。 */
  function* stop(reason: string): Generator<RunEvent> {
    const failed = ledger?.transition("failed", `budget exhausted: ${reason}`)
    if (failed?.ok) yield failed.event
  }

  function describe(error: unknown): string {
    return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 512)
  }

  /**
   * **用户确认之后把账本走完**（外部审查 A4）。判据与理由见 `AgentCoordinator` 上的说明。
   */
  function settleConfirmation(outcome: { status: string; detail?: string }): RunEvent[] {
    const events: RunEvent[] = []
    // 只补记**成功**：被拒时这一轮仍停在"等用户确认"（面板还挂着、还能再点一次），
    // 把它推成 `failed` 既与界面矛盾，又会把还能重试的运行钉成终态。
    if (outcome.status !== "committed" && outcome.status !== "no_change") return events
    if (!ledger || ledger.phase() !== "awaiting_confirmation") return events

    const committing = ledger.transition("committing", "applying the confirmed draft")
    if (committing.ok) events.push(committing.event)
    ledger.record(`commit ${outcome.status}`, lastTarget === undefined ? undefined : { handle: lastTarget })
    const completed = ledger.transition("completed", outcome.status === "committed" ? "the document was updated" : "nothing needed to change")
    if (completed.ok) events.push(completed.event)
    return events
  }

  return {
    start(request) {
      return run(request)
    },
    cancel,
    ledger() {
      return ledger?.ledger() ?? []
    },
    phase() {
      return ledger?.phase() ?? "created"
    },
    settleConfirmation
  }
}
