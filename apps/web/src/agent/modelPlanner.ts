import {
  PLAN_SCHEMA_VERSION,
  createRecoveryController,
  isCapabilityVerified,
  parseModelEnvelope,
  planModelRequest,
  type Budget,
  type CapabilityEvidence,
  type EnvelopeParseFailure,
  type ModelChannel,
  type ModelContext,
  type ModelEvent,
  type PlanEnvelope,
  type PlannerPort,
  type ProviderCapabilities,
  type RecoveryError,
  type RetryDecision
} from "@draw/agent-core"

import {
  listProviderProfiles,
  readActiveProviderProfile,
  readProviderHealth,
  type ProviderHealth,
  type ProviderProfile
} from "../services/providerProfileClient"
import { invokeDesktop } from "../services/desktopRuntime"
import { cancelModelRun, startModelRun, type ModelClientStart } from "../services/modelClient"

/**
 * **模型规划器**（Task 2.3 的 Step 6 + G2 接线的核心）。
 *
 * 它把 `PlannerPort` 接到**真实的 provider** 上：`provider_run` 发一次请求，
 * 回来的归一化事件拼成文本，再过 `parseModelEnvelope` 变成计划信封。
 *
 * ## 一、用的是**「使用中」的那一份**，不是调用方挑的那一份
 *
 * 用户口径（G1 第十三批）是"能够主动在不同的模型中进行切换"。切换写在
 * `active_profile_id` 里，而**消费它的地方就是这里** —— 规划器自己现取那份配置，
 * 于是"切了之后 Agent 就用它"成立，调用方（`agentRunner`）不需要、也不允许传
 * `profileId`。
 *
 * 现取而不是缓存：缓存会让"切了配置但这一轮还用旧的"变成一个说不清的现象，
 * 与句柄"每次现算内容哈希"是同一条纪律。
 *
 * ## 二、通道由**能力证据**决定，而不是由品牌名决定
 *
 * `planModelRequest` 的判据只有一条：`verified` 才算数（`declared` 是"文档里说支持"）。
 * 所以 `json` 验证过的服务走**严格 JSON 通道**（整段回复必须就是 JSON），
 * 其余走**文本通道**（允许恰好一层 ```json 围栏）。两者的区别不只是宽容度：
 * 发错通道的表现是"明明能用却一直解析失败"，所以通道建议会**按通道写进提示词**，
 * 而提示词与解析器用的是同一个 `channel` 值 —— 两处各判断一次必然分叉。
 *
 * ## 三、**原生工具通道这一轮到不了**（如实）
 *
 * `plan.set_plan` 这类工具本该以 provider 侧的工具表（function calling）形式发出去，
 * 而 `provider_run` 的入参只有 `messages` —— **IPC 契约里没有放工具表的位置**。
 * 所以这一轮走的是"动作菜单写进提示词 + 解析 JSON 信封"，而**没有**发任何工具 schema。
 * 这不会产生错误的结论（模型本来就是被要求返回 JSON 的），但它确实是一处缺口：
 * 要让 `native_tools` 通道可用，得先给 `provider_run` 加一个 `tools` 参数（Rust 侧改动）。
 * 上面那个 `channel === "native_tools"` 的分支因此是**如实拒绝**，而不是静默降级 ——
 * 降级会让人以为"工具通道通了"。
 *
 * ## 四、失败**抛**，解析失败**交出去**（两种不同的东西）
 *
 * - provider 失败（认证 / 限流 / 连不上）→ **抛**。协调器据此落到 `failed`，
 *   并把 `failure` 分类带出来，重试策略只认它。
 * - 模型答得不像话（散文、字段不对）→ **原样交出去**。协调器是唯一掌握
 *   "还有几次机会"与修复提示的地方（`PlanRequest.repair`），规划器在这里自己重试
 *   会把预算绕过去。
 */

export interface ModelPlannerProvider {
  id: string
  modelId: string
  /** 协议/方言名，**只用于诊断**：通道选择不看它。 */
  dialect: string
  revision: number
  capabilities: ProviderCapabilities
}

/** 「使用中」那一份配置的解析结果。失败是**带原因码**的，不是一句话。 */
export type ProviderResolution =
  | { ok: true; provider: ModelPlannerProvider }
  | { ok: false; code: "no_desktop_shell" | "no_active_profile" | "no_secret" | "ipc_failed" | "secret_not_allowed"; detail: string }

export type ModelPlannerErrorCode =
  | "no_desktop_shell"
  | "no_active_profile"
  | "no_secret"
  | "ipc_failed"
  | "secret_not_allowed"
  | "capability_unavailable"
  | "provider_failed"
  | "unexpected_tool_call"
  | "cancelled"

/**
 * 规划器自己抛的错。
 *
 * 带 `code` 与 `retryable` 而不是只带一句话：协调器与界面都要按分类说话，
 * 而"从一段文字里认分类"是一次必然会漏的判断（与 `modelClient` 那条口径一致）。
 */
export class ModelPlannerError extends Error {
  readonly code: ModelPlannerErrorCode
  readonly retryable: boolean

  constructor(code: ModelPlannerErrorCode, message: string, retryable = false) {
    super(message)
    this.name = "ModelPlannerError"
    this.code = code
    this.retryable = retryable
  }
}

/** 三个能力各自到"网关口径"的映射。**只有一处**，界面与规划器共用同一批证据。 */
function evidenceFor(profile: ProviderProfile, health: ProviderHealth | null, feature: string): CapabilityEvidence {
  // 采信的唯一判据来自 agent-core（`verified` + 证据必须属于当前修订号）。
  if (isCapabilityVerified(profile.capabilities, feature, profile.revision, health ?? undefined)) return "verified"
  const fromHealth = health && health.profileRevision === profile.revision ? health.capabilityEvidence.find((entry) => entry.feature === feature) : undefined
  const declared = fromHealth?.status ?? profile.capabilities.find((entry) => entry.feature === feature)?.status
  switch (declared) {
    // `failed` 是有信息量的一条（"试过了、被拒了"），原样保留。
    case "failed": return "failed"
    /**
     * `verified` 走到这里说明它**不可采信**（健康记录缺失或属于上一版）。
     * 降级成 `declared` 而不是 `unknown`：它仍然是一条**声明**，只是我们不认 ——
     * 两者对通道选择的影响相同（都不算已验证），但给人看时的意思完全不同。
     */
    case "verified":
    case "declared": return "declared"
    default: return "unknown"
  }
}

/** 一份配置 + 它的健康证据 → 网关视角的能力三档。**纯函数**，所以规则可以被钉住。 */
export function toGateCapabilities(profile: ProviderProfile, health: ProviderHealth | null): ProviderCapabilities {
  return {
    tools: evidenceFor(profile, health, "tools"),
    json: evidenceFor(profile, health, "json"),
    vision: evidenceFor(profile, health, "vision")
  }
}

/**
 * **现取「使用中」的那一份配置**（真实 IPC）。
 *
 * 三道检查各有理由，而且顺序不能反：
 * 1. 有没有桌面外壳 —— 浏览器里没有凭据库，问也是白问；
 * 2. 有没有选过 —— `null` 是"还没选"，不是"选了第一份"（G1 第十三批的判据）；
 * 3. **有没有密钥** —— `secretRef` 缺省说明这一份从来没存过密钥。拿它去发请求
 *    必然失败，而失败信息（"找不到凭据"）会指向凭据库，而不是指向"你还没填密钥"。
 */
export async function resolveActiveProvider(): Promise<ProviderResolution> {
  const active = await readActiveProviderProfile()
  if (!active.ok) return { ok: false, code: active.code, detail: active.detail }
  if (!active.value) return { ok: false, code: "no_active_profile", detail: "还没有选择「使用中」的模型服务（在「服务」里添加一份并点「使用」）。" }

  const listed = await listProviderProfiles()
  if (!listed.ok) return { ok: false, code: listed.code, detail: listed.detail }
  const profile = listed.value.find((candidate) => candidate.id === active.value)
  if (!profile) return { ok: false, code: "no_active_profile", detail: `「使用中」指向的配置 ${active.value} 已经不存在了（删掉那一份时选中会被清空，这里也如实拒绝）。` }
  if (!profile.secretRef) return { ok: false, code: "no_secret", detail: `配置 ${profile.id} 还没有保存密钥，先在同一张卡片上填一次。` }

  // 健康记录只读、零成本；读不到（IPC 失败）按"没有证据"处理 —— 那会让通道更保守。
  const health = await readProviderHealth(profile.id)
  return { ok: true, provider: { id: profile.id, modelId: profile.modelId, dialect: profile.dialect, revision: profile.revision, capabilities: toGateCapabilities(profile, health.ok ? health.value : null) } }
}

export interface ModelPlannerDependencies {
  /** 现取「使用中」的那一份。缺省走真实 IPC（`resolveActiveProvider`）。 */
  resolveProvider?: () => Promise<ProviderResolution>
  /** 发一次请求。缺省走 `provider_run`。第二个参数是"这次还能不能继续"的判据（取消用）。 */
  runModel?: (request: { runId: string; profileId: string; profileRevision: number; messages: { role: string; content: string }[]; tools: unknown[] }, signal: { isCancelled: () => boolean }) => Promise<ModelClientStart>
  /** 让 Rust 侧真的停下来（缺省走 `provider_cancel`）。 */
  cancelRun?: (runId: string) => Promise<boolean>
}

/** 一次请求要用的消息。**只有 role 与 content** —— provider 方言由 Rust 侧适配。 */
type ChatMessage = { role: string; content: string }

/**
 * **原生工具通道上唯一发给模型的工具**。
 *
 * 它的参数**就是计划信封本身**。这样 `native_tools` 通道不需要多轮工具循环：
 * 模型"调用计划工具"这件事，与文本通道里"回一段 JSON"是同一个决定，
 * 只是承载方式不同（一个结构化参数、一段文本）。
 *
 * 名字用下划线而不是点号：点号在部分兼容服务上会被拒，而拒的形状是 400 ——
 * 那会被读成"这家不支持工具"，正是最不该误报的地方。
 */
export const PLAN_TOOL_NAME = "plan_set_plan"

export const PLAN_TOOL_SCHEMA = {
  type: "function",
  function: {
    name: PLAN_TOOL_NAME,
    description: "Hand back the plan envelope for this run. The arguments ARE the envelope: { schemaVersion, kind, goal, factIds, assumptions?, actions | questions | answer | toolResultRefs }.",
    parameters: {
      type: "object",
      description: "A plan envelope: { schemaVersion: \"mathcanvas.plan.v1\", kind: \"plan\" | \"clarification\" | \"answer\", goal: string, factIds: string[], assumptions?: string[] } plus `actions` for a plan, `questions` for a clarification, or `answer` + `toolResultRefs` for a read-only answer.",
      additionalProperties: true
    }
  }
}

const MAX_PROMPT_FACTS = 12
const MAX_PROMPT_REFS = 16

/**
 * 把上下文**序列化成模型能读的一段 JSON**。
 *
 * 两点刻意：
 * - **不给哈希**：模型不能引用版本，`contentHash` / `epoch` 对它没有用处，只会占字符。
 *   引用能用的部分（`documentId` / `entityId` / `label`）都在，因为"对象引用必须带
 *   documentId"是一条硬要求。
 * - **上限在这里再收一次**：`buildContext` 已经收过，但它是"上游给了多少"，
 *   而这里是"发出去多少" —— 两处的预算含义不同，所以不是重复。
 */
function sceneSnapshot(context: ModelContext): string {
  return JSON.stringify({
    preamble: context.preamble,
    workspace: context.workspace,
    target: { documentId: context.handles.target.documentId, workspace: context.handles.target.workspace, generation: context.handles.target.generation },
    sources: context.handles.sources.map((source) => ({ documentId: source.documentId, workspace: source.workspace })),
    facts: context.facts.slice(0, MAX_PROMPT_FACTS).map((fact) => ({ id: fact.id, text: fact.text, origin: fact.origin })),
    selectedRefs: context.selectedRefs.slice(0, MAX_PROMPT_REFS).map((ref) => ({ documentId: ref.documentId, entityId: ref.entityId, label: ref.label })),
    skills: context.skills.map((skill) => ({ id: skill.id, title: skill.title })),
    warnings: context.warnings.map((warning) => ({ code: warning.code, detail: warning.detail }))
  })
}

/** 通道建议。**必须与解析器用的是同一个通道值**，所以它按参数给，不按"猜"。 */
function channelAdvice(channel: ModelChannel): string {
  if (channel === "native_tools") {
    return `用工具 \`${PLAN_TOOL_NAME}\` 回答：把计划放在它的 arguments 里（arguments 就是一个计划信封）。这一轮**不要**用普通文本回答。`
  }
  return channel === "strict_json"
    ? "整段回复必须**就是**一个 JSON 对象：不要用代码围栏，也不要在前后添加任何文字。"
    : "如果要包代码围栏，请只包一层 ```json，且围栏内只有这个 JSON；围栏之外不要有别的字。"
}

/**
 * 组装这一轮要说的话。
 *
 * `tools` 的用处是**这一阶段允许做什么**：`plan.set_plan` 在表里才允许返回 `kind:"plan"`。
 * 这是 `PlanRequest.model.tools` 真正的落点 —— 它不该只是"声明了没用"的字段。
 */
function buildMessages(request: { userMessage: string; model: { context: ModelContext; tools: readonly { id: string }[] }; repair?: { reason: string; errors: readonly { code: string; path: string; detail: string }[]; hint: string } }, channel: ModelChannel): ChatMessage[] {
  const context = request.model.context
  const canPlan = request.model.tools.some((tool) => tool.id === "plan.set_plan")
  const shapes: string[] = []
  if (canPlan) {
    shapes.push(`计划：${JSON.stringify({ schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "一句话说清这次要做什么", factIds: [], assumptions: [], actions: [{ actionId: "从下面的动作菜单里选", actionKey: "本次运行内唯一的名字", factIds: [], inputs: {} }] })}`)
  }
  shapes.push(`提问（信息不足时用它，不要编数值）：${JSON.stringify({ schemaVersion: PLAN_SCHEMA_VERSION, kind: "clarification", goal: "一句话", factIds: [], questions: ["一个具体的、用户能回答的问题"] })}`)
  shapes.push(`只读回答（不改文档时用它）：${JSON.stringify({ schemaVersion: PLAN_SCHEMA_VERSION, kind: "answer", goal: "一句话", factIds: [], answer: "回答本身", toolResultRefs: [] })}`)

  const sections = [
    "你是 MathCanvas 的构图助手。你只能返回一个 JSON 对象；系统会校验它，然后编译成动作、生成隔离草稿、等用户确认之后才可能落盘。",
    canPlan
      ? "你不能自己提交：写入必须由用户在看到预览后确认。"
      : "这一阶段**不允许**返回计划：你只能提问或作答。",
    "",
    "## 输出形状（多一个字段都会被拒绝）",
    channelAdvice(channel),
    ...shapes,
    "",
    "## 本轮允许的动作（`actionId` 只能从这里选）",
    ...(context.availableActions.length > 0 ? context.availableActions.map((action) => `- ${action}`) : ["（这一轮没有任何可用动作：只能提问或作答）"]),
    "",
    "## 本轮场景（JSON）",
    sceneSnapshot(context),
    "",
    "对象引用必须带 documentId；不要凭标签猜对象，标签可能重复。没看到的事实不要假设：缺信息时问。"
  ]
  if (request.repair) {
    // 一次性修复机会：给**字段路径 + 原因**，并且**不回显**模型上一轮的原话
    //（回显会把它的散文再送回去，形成自我强化的循环）。
    sections.push("", "## 上一轮的输出没有被接受", request.repair.hint)
  }

  const messages: ChatMessage[] = [{ role: "system", content: sections.join("\n") }, { role: "user", content: request.userMessage }]
  return messages
}

/**
 * **解析失败时交给协调器的东西**。
 *
 * 契约里 `PlanOutcome.plan` 是 `PlanEnvelope`，而它的注释写着"**不可信输出**：
 * 协调器必须用 `parsePlanEnvelope` 校验之后才认" —— 这一处就是那句话的落点：
 * 交出去的是**模型自己说的那个值**（能 JSON 解析就是那个对象，不能就是那段原文），
 * 于是协调器报出来的是**真实的字段路径**，而不是我们编的一句话。
 *
 * 为什么不在这里抛：抛出会绕过协调器的**一次性修复通道**（`PlanRequest.repair` 与
 * `MAX_PLAN_ATTEMPTS` 都在它手里），第二次机会就没了。
 *
 * 两处 `as` 是在说明"这个值的形状由协调器负责校验"，不是在绕过校验。
 */
function asUntrustedEnvelope(failure: EnvelopeParseFailure): PlanEnvelope {
  try {
    return JSON.parse(failure.payload) as PlanEnvelope
  } catch {
    return failure.payload as unknown as PlanEnvelope
  }
}

/**
 * 造一个模型规划器。
 *
 * `resolveProvider` **每次调用都现取**（不是构造时取一次）：一次运行里模型可能被问两次
 *（含那次修复），而两次必须用同一份配置与同一批能力证据 —— 否则第二次尝试其实换了题目。
 * 所以调用方（`agentRunner`）拿到解析结果之后会**钉住**它，把 `resolveProvider` 注入成常量。
 */
export function createModelPlanner(dependencies: ModelPlannerDependencies = {}): PlannerPort {
  const resolveProvider = dependencies.resolveProvider ?? resolveActiveProvider
  const runModel = dependencies.runModel ?? ((request: { runId: string; profileId: string; profileRevision: number; messages: ChatMessage[] }, signal: { isCancelled: () => boolean }) =>
    startModelRun(
      { runId: request.runId, profileId: request.profileId, profileRevision: request.profileRevision, messages: request.messages },
      {
        invoke: (command, args) => invokeDesktop(command, args),
        // 取消之后不再产出事件（与 Rust 侧同一套语义）。
        isCancelled: signal.isCancelled
      }
    ))
  const cancelRun = dependencies.cancelRun ?? ((runId: string) => cancelModelRun(runId, (command, args) => invokeDesktop(command, args)))

  let sequence = 0

  return {
    async plan(request) {
      sequence += 1
      const resolved = await resolveProvider()
      if (!resolved.ok) throw new ModelPlannerError(resolved.code === "no_desktop_shell" ? "no_desktop_shell" : resolved.code, resolved.detail)

      const provider = resolved.provider
      /**
       * **两个通道之间选一个**，而选择只看**已验证的证据**：
       * `tools === "verified"` → 原生工具通道（发工具表，模型"调用计划工具"）；
       * 否则按 `json` / 文本通道（发提示词，模型回一个 JSON 信封）。
       */
      const planned = planModelRequest({
        profile: { id: provider.id, dialect: provider.dialect, modelId: provider.modelId, capabilities: provider.capabilities },
        context: request.model.context,
        needsTools: provider.capabilities.tools === "verified",
        withImages: false
      })
      if (!planned.ok) throw new ModelPlannerError("capability_unavailable", planned.detail)
      const channel = planned.channel
      // 只有原生工具通道带工具表。Rust 侧还会按**存下来的证据**再判一次
      //（`tools_verified`）：调用方说"这家支持工具"不算数，验过才算数。
      const tools = channel === "native_tools" ? [PLAN_TOOL_SCHEMA] : []

      const runId = request.run.runId
      const messages = buildMessages(request, channel)
      /**
       * 用户按了停止 → 让 Rust 侧**真的**停下来。
       *
       * 光把事件过滤掉不够：那一次 HTTP 会继续跑到超时，而用户看到的是"按了没反应"。
       * 监听器在发请求之前就挂上（取消可能发生在等待期间），发完摘掉（免得泄漏）。
       */
      const onAbort = () => { void cancelRun(runId) }

      /**
       * **有界恢复**（Task 2.3 Step 4：`RecoveryController.decide`）。
       *
       * 这一层能做的只有"传输类失败再试一次"，而它必须满足两个条件，缺一不可：
       * 1. **判定来自策略表**（`recovery.ts`）：`transport` / 429 / 5xx 才重试，
       *    认证、权限、几何、事实矛盾、未归类一律**停**。散在这里写 `if` 迟早会出现
       *    "认证失败也重试三次"，而那只是让用户白等。
       * 2. **重试真的花掉共享预算**（`budget.consume`）。不扣就等于把协调器的预算绕过去 ——
       *    计划原文那句"retry/fallback/repair share one budget"就落在这里。
       *    预算不够时**不加尝试地停**（先问 `remaining`，与 `budget.ts` 同一条纪律）。
       *
       * **格式（schema）修复不在这里**：那是协调器的 `repair` 通道，它掌握"还剩几次机会"
       * 与修复提示的构造。这一层只处理"这次请求根本没成功"。
       */
      const recovery = createRecoveryController()
      let attempts = 0
      let lastSignature: string | null = null
      /** 事件 id 优先：诊断时"这次请求对应哪条运行记录"要能对上代理里的账。 */
      let ids = { requestId: `model-request-${sequence}`, attemptId: `model-attempt-${sequence}` }

      for (;;) {
        attempts += 1
        request.signal.addEventListener("abort", onAbort)
        let result: ModelClientStart
        try {
          result = await runModel({ runId, profileId: provider.id, profileRevision: provider.revision, messages, tools }, { isCancelled: () => request.signal.aborted })
        } finally {
          request.signal.removeEventListener("abort", onAbort)
        }

        const first = result.ok ? result.events[0] : undefined
        if (first) ids = { requestId: first.requestId, attemptId: first.attemptId }

        const failure = failureOf(result)
        if (failure) {
          const error = recoveryErrorOf(failure)
          const decision = recovery.decide(error, {
            attempts,
            // 格式修复由协调器掌握，这一层从来没用过那次机会。
            repairUsed: false,
            lastSignature,
            remaining: { network: request.budget.remaining("network"), generation: request.budget.remaining("generation") },
            maxAttempts: MAX_TRANSPORT_ATTEMPTS
          })
          if (decision.action !== "retry") {
            /**
             * **把底层那句话带上**（2026-09-21 修）。
             *
             * 原先这里只抛 `decision.detail`，而那句话说清的是**决定**（"传输失败已尝试 3 次，
             * 停下并如实报告"），不是**原因**（`the provider could not be reached: …`）。
             * 后果在一次真实运行里立刻显现：界面上只有"传输失败已尝试 3 次"，而排查需要知道
             * 到底是 DNS、TLS、超时还是连接被拒 —— 那句话本来就在 `failure.message` 里，
             * 却在决策文字里丢掉了。
             */
            throw new ModelPlannerError("provider_failed", `${decision.detail}（底层原因：${failure.message}）`, failure.retryable)
          }
          // 取消优先于重试：用户按了停止就不该再发一次。
          if (request.signal.aborted) throw new ModelPlannerError("cancelled", "这次运行已取消。", false)
          if (!spend(request.budget, decision)) throw new ModelPlannerError("provider_failed", `预算已不足以再试一次（${decision.detail}；底层原因：${failure.message}）`, failure.retryable)
          lastSignature = `${error.class}:${error.status ?? "none"}:${error.message}`
          continue
        }

        const events: readonly ModelEvent[] = result.ok ? result.events : []
        const toolCall = events.find((event) => event.kind === "tool_call")
        if (toolCall && toolCall.kind === "tool_call") {
          /**
           * **原生工具通道上，唯一发给模型的工具就是 `plan_set_plan`**，而它的参数
           * 就是一个计划信封。所以"模型调用了它"这件事，与文本通道里"回了一段 JSON"
           * 是同一个决定，只是承载方式不同 —— 这里把它原样交给协调器校验
           *（**在这里不校验**：`parsePlanEnvelope` 是协调器的职责，它掌握修复通道）。
           */
          if (channel === "native_tools" && toolCall.toolId === PLAN_TOOL_NAME) {
            return { plan: toolCall.input as PlanEnvelope, ...ids }
          }
          // 其余情况一律拒绝：我们**没有**发过那个工具，静默忽略它等于把
          // "模型以为它调用了什么"变成"什么都没发生"。
          throw new ModelPlannerError("unexpected_tool_call", `the provider returned a tool call (${toolCall.toolId}) that no tool schema of ours asked for — refusing to guess what it meant`)
        }

        // 取消已经置位：不再产出任何东西（协调器也不会再收事件）。
        if (request.signal.aborted) throw new ModelPlannerError("cancelled", "这次运行已取消。", false)

        const text = events.filter((event) => event.kind === "delta").map((event) => (event.kind === "delta" ? event.text : "")).join("")
        /**
         * 原生工具通道上模型没调工具、而是回了一段文本时，**仍然按文本通道解析一次**：
         * 有些服务在给了工具表的情况下照旧用文本作答，而那段文本还是同一个信封合同。
         * 让它走一次解析，比让用户白等一次修复往返要好；解析不通过时协调器照样会拒。
         */
        const parsed = parseModelEnvelope(text, channel === "native_tools" ? "fenced_text" : channel)
        if (!parsed.ok) return { plan: asUntrustedEnvelope(parsed), ...ids }
        return { plan: parsed.value, ...ids }
      }
    }
  }
}

/**
 * 传输类失败最多尝试几次（含第一次）。
 *
 * 与 `recovery.ts` 的缺省上限一致，写在这里是为了让"这一层最多花掉几次"在调用处看得见 ——
 * 用户为每一次往返付钱与等待时间。
 */
const MAX_TRANSPORT_ATTEMPTS = 3

/** 从一次调用的结果里取出"这次根本没成功"（命令失败与 `failed` 事件是同一件事）。 */
function failureOf(result: ModelClientStart): { failure: string; message: string; retryable: boolean } | null {
  if (!result.ok) return result
  const failed = result.events.find((event) => event.kind === "failed")
  return failed && failed.kind === "failed" ? { failure: failed.failure, message: failed.message, retryable: failed.retryable } : null
}

/**
 * 把 `modelEvents` 的失败分类翻成恢复策略的**错误类别**。
 *
 * 两套词汇**故意不合并**：一套讲"provider 说了什么"（`rate_limited` / `server_error`），
 * 一套讲"该怎么处置"（`transport` + 状态码）。映射只有这一处，所以"哪些能重试"仍然只有一个答案；
 * 逐个 if 写在调用处则会出现"这条路径重试、那条不重试"。
 */
function recoveryErrorOf(failure: { failure: string; message: string }): RecoveryError {
  switch (failure.failure) {
    // 连接中断没有状态码 → 可重试。
    case "transport": return { class: "transport", message: failure.message }
    case "rate_limited": return { class: "transport", status: 429, message: failure.message }
    case "server_error": return { class: "transport", status: 503, message: failure.message }
    case "auth": return { class: "auth", status: 401, message: failure.message }
    case "permission": return { class: "permission", status: 403, message: failure.message }
    // 半个 JSON / 流中断：**不自己重发**（见 `plan` 里的说明：那需要一份新上下文）。
    case "malformed_output": return { class: "malformed_stream", message: failure.message }
    case "cancelled": return { class: "cancelled", message: failure.message }
    default: return { class: "unknown", message: failure.message }
  }
}

/** 花掉这次重试的预算。**先问再扣**：策略表已经确认能负担，这里只是执行与兜底。 */
function spend(budget: Budget, decision: RetryDecision): boolean {
  const network = budget.consume("network", decision.budgetCost.network)
  if (!network.ok) return false
  return budget.consume("generation", decision.budgetCost.generation).ok
}

/** 供界面显示"Agent 会用哪一份"：与 `resolveActiveProvider` 同一批判据。 */
export function describeProviderResolution(resolution: ProviderResolution): string {
  if (!resolution.ok) return resolution.detail
  const { provider } = resolution
  const verified = (["tools", "json", "vision"] as const).filter((feature) => provider.capabilities[feature] === "verified")
  return verified.length > 0
    ? `${provider.modelId}（已验证：${verified.join(" / ")}）`
    : `${provider.modelId}（还没有验证过的能力：走文本通道）`
}
