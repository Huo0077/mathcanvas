import type { DocumentHandle, PlanDiagnostic, PlanEnvelope, PlanRelations, RepairRequest, RunContext, StructuredAssumption, ToolResult, VerificationReport } from "./contracts"
import type { DraftAction } from "@draw/scene-graph"
import type { Budget } from "./budget"
import { buildContext, buildConversationContext, conversationLimitsFor, type ConversationContext, type ConversationContextSource, type ModelContext, type ObservationSummary } from "./contextBuilder"
import type { RunEvent } from "./runState"
import type { ObservedDerivedStatus } from "./sceneObservation"
import { createToolRegistry, type ToolDescriptor, type ToolRegistry } from "./toolRegistry"
import type { AcceptanceCheck } from "./verification/taskAcceptance"

/**
 * **协调器的四组端口**（Task 2.1）。
 *
 * 计划原文只给了一个接口签名（`AgentCoordinator.start(runContext, userMessage): AsyncIterable<AgentEvent>`），
 * 但协调器要做的四件事都不能由它自己做：
 * - 问模型 → `planner`
 * - 读场景 → `observer`
 * - 编译与提交 → `committer`（**只有这一条路径能写文档**）
 * - 执行只读工具 → `tools`
 *
 * 所以它们全部是**注入的接口**。这样做有三个直接好处，都在本轮的用例里被用到：
 * 1. **没有网络**：`agent-core` 至今没有任何 `fetch` / provider 代码（这是 G0 Gate 第 5 条守的性质），
 *    协调器也不例外 —— 它只认这些接口。
 * 2. **可测**：九条场景（成功只读、成功草稿、缺事实、输出非法、草稿过期、提交前取消、提交中取消、
 *    provider 失败、应用中断）都能用脚本化的假端口跑出来，不需要任何真实模型。
 * 3. **取消可传播**：`AbortSignal` 从协调器发给每个端口，端口负责真的中断自己的 IO。
 */

export interface PlanRequest {
  run: RunContext
  userMessage: string
  budget: Budget
  signal: AbortSignal
  /**
   * **模型这一次能看到的一切**（Task 2.2 Step 4 + Task 2.3）。
   *
   * 计划 Task 2.2 Step 4 与 Task 2.3 都要求模型看到"live handles, confirmed facts,
   * selected ordered refs, warnings"并按阶段拿到工具；而在此之前 `PlanRequest` 只有
   * `run` / `userMessage` / `budget` / `signal` —— **一个 provider 适配器拿不到任何场景信息**，
   * 只能自己再造一份。这正是 `contextBuilder` 与 `toolRegistry` 一直是
   * "有实现、有测试、没有生产调用方"的根因。
   *
   * 谁组装、为什么是协调器：上下文与工具都来自 `agent-core` 自己的部件
   * （`buildContext` + `createToolRegistry`），而协调器是唯一知道"现在是哪个阶段"的地方。
   * 让适配器自己组装，等于把"哪个阶段能看到什么"这条安全边界搬到 app 侧去。
   *
   * **做成一个整体字段而不是两个平铺字段**：它们是同一个问题的两面
   *（"这次生成允许看到什么"），平铺会让将来新增一项时又要改一次端口形状。
   */
  /** Scoped read-only tool execution provided by the coordinator, never by model output. */
  executeTool?: ToolPort["call"]
  model: {
    context: ModelContext
    /** 当前阶段发布的工具。只读阶段没有写入工具，观察阶段连计划工具都没有。 */
    tools: readonly ToolDescriptor[]
  }
  /**
   * **这一轮的会话上下文**（对话切片 Task 4；规格 §5.3）。
   *
   * 与 `model.context` 分开，是因为两者回答不同的问题：`model.context` 是"这一轮的场景
   * 与可用动作"（阶段相关，可能每次组装都不一样），`conversation` 是"这条会话到这一轮为止
   * 说过什么、确认过什么"。规划器（尤其是模型那一份）需要把两者**分别**渲染。
   *
   * **一次运行只有一个这个对象**：两次尝试（含修复）拿到的是同一个引用 ——
   * 否则"第二次机会"其实换了题目，事后没法判断是模型改好了还是条件变了。
   */
  conversation: ConversationContext
  /**
   * **上一次尝试为什么没被接受**（只有第二次尝试才有）。
   *
   * 计划 Task 2.3 Step 5 与 Task 2.1 Step 1 都点名了这件事："Implement visible one-time schema
   * repair. Include exact JSON path errors in the second prompt" / "invalid output"。
   *
   * 在它之前，协调器**确实**会再问一次（`MAX_PLAN_ATTEMPTS = 2`），但**不告诉规划器上一次错在哪** ——
   * 于是第二次尝试只会把同一份请求原样再发一遍，模型没有任何理由换个答案，
   * "一次性修复"实际上退化成"重试一次"。这正是"有实现、没接上"的一类缺口：
   * 修复提示的构造函数（`outputParser.describeRepairPrompt`）早就写好并有测试，只是没人调它。
   *
   * ## 它现在**就是** `RepairRequest`（Agent DSL 切片 Task 4 的接线）
   *
   * 修复请求只有一份真源：`RepairRequest`（`reason` / `errors`（code+path+detail）/
   * `allowedChanges` / `attempt`）。传输解析失败时由 `repairRequestFor` 造；
   * **编译阶段失败时是 `compilePlan` 已经造好的那一份**，经由
   * `CommitterPort.stage` 的失败结果原样带到这里 —— 协调器不再自己拼一个
   * （自己拼就意味着 `allowedChanges` 与"允许改哪几处"是它猜的）。
   *
   * `hint` 是唯一不在 `RepairRequest` 里的东西：它由**已注册的**提示构造函数生成
   *（`describeRepairPrompt` / `describeCompileRepairPrompt`），按通道给格式建议、
   * 且**绝不回显模型的原话**（避免把散文再送回去形成自我强化的循环）。
   */
  repair?: RepairRequest & {
    /** 可直接拼进下一次提示的可执行修复建议（来自已注册的提示构造函数）。 */
    hint: string
    /** 编译器的逐层诊断（层 + 原因码 + 路径）；传输解析失败时缺省（那一层还没有编译诊断）。 */
    diagnostics?: readonly PlanDiagnostic[]
    /**
     * **编译器在失败前已经补出来的假设**（"拉伸向量未指定，取高 3"）。
     *
     * 为什么修复请求要带上它们：修复的题目是"改哪几处"，而系统已经替用户定过的那几样
     * 必须仍然可见 —— 否则模型会以为那是它可以重新选择的字段，第二次尝试就会把
     * 一条已经写进 `assumptions` 的决定悄悄改掉。
     */
    assumptions?: readonly StructuredAssumption[]
  }
}

export interface PlanOutcome {
  plan: PlanEnvelope
  requestId: string
  attemptId: string
}

/**
 * **一次规划请求里"场景看到什么"**（N4d）。
 *
 * 与 `ObservationSummary`（`contextBuilder.ts`）**同一个形状**，但意图不同：这一份说的是
 * "调用方手里关于这一轮场景的那几个值"。`factIds` 不在其中 —— 它是协调器做
 * "计划引用的都是已确认事实"那道检查用的，规划器看不到它（`PlanRequest` 里从来没有这个字段）。
 *
 * 为什么要单独起个名字而不是直接写 `ObservationSummary`：两者今天恰好同形，
 * 但它们的**归属**不同 —— `ObservationSummary` 属于上下文组装，这一份属于请求构造。
 * 合成一个类型之后，"请求构造该收哪些输入"就只能靠读 `contextBuilder` 才能回答。
 */
export interface PlanObservationSource {
  facts: ObservationSummary["facts"]
  summary: string
  /** 派生立体读数（规格 §3.4 / §6.2）。缺省 = 这一轮没有读数，老调用方行为不变。 */
  derived?: readonly ObservedDerivedStatus[]
}

/**
 * **组装一条 `PlanRequest` 需要什么**（N4d）。
 *
 * 每一项都是**协调器在构造请求时真正用到的东西** —— 没有"整个依赖对象"这种偷懒的口子，
 * 否则这个函数就变成了"把协调器搬过来"，而不是"把请求的形状收成一处"。
 *
 * 三样**不在**这里，因为选择它们的不是规划请求：
 * - `repair` / `executeTool`：协调器在**每次尝试**之间才决定（第一次尝试没有修复请求；
 *   没接只读工具端口时没有 `executeTool`）。它们是"这一次尝试"的输入，由调用方在
 *   `planner.plan(...)` 那一行补上 —— 见 `coordinator.ts` 的循环体；
 * - `reportContextSpend`：**计费**不是形状。协调器把 `estimatedCharacters` 折算成 token
 *   去扣共享预算，而"这是评测，不该扣谁的预算"的那一侧传 `undefined`。计费留在调用方，
 *   是因为它决定的是"这一次运行为什么停下"，不是"模型看到什么"。
 */
export interface PlanRequestInputs {
  run: RunContext
  userMessage: string
  budget: Budget
  signal: AbortSignal
  observation: PlanObservationSource
  /**
   * 这一轮请求的技能 id。**技能目录校验发生在 `buildContext` 里**：这里给的是"请求了哪些"，
   * 加载失败的会在上下文的 `warnings` 里留痕，而不是被这个函数静默丢掉。
   */
  requestedSkillIds: readonly string[]
  /**
   * 只读阶段可用的动作名（来自能力注册表 / 技能清单）。
   *
   * 由调用方给，因为"哪些动作现在可用"是**环境的事实**，不是请求构造能推出来的：
   * 协调器从依赖里拿（`CoordinatorDependencies.availableActions`），应用侧那条运行时路径
   * 从 `SKILL_MANIFESTS` 按 `requestedSkillIds` 现算（`agentRuntime.ts`）。
   * 缺省 `[]` 与协调器一直以来的缺省一致。
   */
  availableActions?: readonly string[]
  /** 有序的选中引用。缺省 `[]`：没有宿主给出的选中集时，上下文里就没有引用。 */
  selectedRefs?: Parameters<typeof buildContext>[0]["selectedRefs"]
  /**
   * **这一轮有没有接上只读工具端口**。
   *
   * 它决定 `createToolRegistry().forModelPhase` 会不会把只读工具发布给模型
   * （注册表自己的判据：`environment.readToolsAvailable`）。缺省 `false` ——
   * 与"没接工具端口的调用方"一致。协调器传的是 `dependencies.tools !== undefined`。
   */
  readToolsAvailable?: boolean
  /**
   * **会话上下文的来源**（缺省时按 `run` 造一份最小的）。
   *
   * ## 为什么是 **thunk** 而不是值（N4d；控制器点名的那条顺序判据）
   *
   * 计费时机在 `buildContext` 之后（`reportContextSpend`），而**会话来源必须在计费之后
   * 才被碰** —— 这是协调器一直以来的顺序（旧代码里 `dependencies.conversation?.()` 就在
   * `budget_context` 那一支**之后**）。传一个已经取好的值等于把那次读取提前到计费之前：
   * **预算耗尽的那一轮会先调一次宿主的读取**，而旧代码在那条路径上根本不会调它。
   *
   * 今天生产里的那一份是纯读（`agentRunner` 传的是 `runPrompt` 里已经读好的快照），
   * 所以没有可观测的副作用；但这是一道真实的边界（将来会话来源变成现读 store / 记日志 /
   * 计费，那一次多余的调用就会变成一个说不清的现象），所以宁可让类型强制它惰性。
   * 钉住这条性质的用例：`coordinator.test.ts` 的
   * "never asks the host for the conversation source when the context budget is exhausted"。
   */
  conversation?: () => ConversationContextSource | undefined
  /** 上下文条数上限。只有协调器会传它 —— "这一轮该看多少"是运行那一层的事。 */
  contextLimits?: { facts?: number; refs?: number; derived?: number }
  /**
   * 工具注册表。缺省用真实目录（`createToolRegistry()`）。
   *
   * 为什么它必须是**可注入**的：协调器自己有一个可替换的注册表
   *（`CoordinatorDependencies.toolRegistry`，测试用它观察"哪个阶段发布了哪些工具"），
   * 而"发布哪些工具"正是 `PlanRequest.model.tools` 的一半内容。不把它递进来，
   * 协调器就只能绕开这个函数去另拼一次 `model.tools` —— 那正是本批要消灭的"第二份请求构造"。
   * 应用侧两处调用方不传，用真实目录。
   */
  toolRegistry?: ToolRegistry
  /**
   * **上下文组装完那一刻的计费机会**（同步）。
   *
   * 时机是刻意的：协调器必须在**会话上下文组装之前**就知道预算够不够
   *（`coordinator.ts` 的 `budget_context` 那一支），所以回调放在 `buildContext` 之后、
   * `buildConversationContext` 之前。它抛错就是"这一轮不该继续"，调用方自己决定抛什么。
   * 不传 = 不计费（评测通道就是这样：它没有共享预算可扣）。
   */
  reportContextSpend?: (estimatedTokens: number) => void
}

/**
 * **一条规划请求只有这一处构造**（N4d）。
 *
 * ## 它解决的是哪个洞
 *
 * 2026-10-05 复核 I-2 与控制器各自独立复现的缺陷：旧那条「agent 工具环」通道
 *（`apps/web/src/agent/fixtures/offlineAgentEval.ts`）把请求写成
 * `plan({ userMessage } as never)` —— 那对本地确定性规划器成立，对**真实**
 * `createModelPlanner` 不成立：它在发出任何网络请求**之前**就读 `request.model.context`，
 * 于是抛 `TypeError: Cannot read properties of undefined (reading 'context')`。
 * 后果不是"报错"，而是**那条会花钱的通道（agent 工具环，两个会花钱的入口之一）从来没有真正工作过**。
 *
 * 修法不是"去 fixtures 里再拼一份完整请求"（那就是第二份"模型能看到什么"），
 * 而是把这件事收回它该在的地方：`PlanRequest.model` 的注释写着"模型这一次能看到的一切"
 * 归协调器管（`contextBuilder` + `toolRegistry` 都是这个包自己的部件，而"哪个阶段发布
 * 哪些工具"是安全边界）。所以这个函数**只调协调器自己用的那几个函数、同样的顺序**：
 * `buildContext` → `buildConversationContext` → `createToolRegistry().forModelPhase("planning", …)`。
 *
 * ## 它不是什么
 *
 * - 它**不是**协调器的替身：账本（`ledger.record`）、预算的 token 折算、暂存、确认、
 *   验收、只读工具的执行，全都还在 `coordinator.ts` 里。这里只产出"请求长什么样"；
 * - 它**不发明字段**：`conversation` 缺省时按 `run` 造一份最小绑定（与协调器
 *   `dependencies.conversation` 缺省时逐字相同的那一份，包括 `summary: ""` 与空
 *   `facts` / `messages`）—— 不是"忘了传所以随便糊一个"。
 *
 * ## 与调用方的关系（三处，逐条）
 *
 * 1. **协调器**（`coordinator.ts` 的运行循环）：它自己用这个函数，于是"生产请求长什么样"
 *    与"评测请求长什么样"在结构上不可能再分叉。`repair` / `executeTool` / 计费仍由它补；
 * 2. **旧 8 题夹具通道**（`offlineAgentEval.ts`）：本批修的正是它；
 * 3. **应用内题集 planning 通道**（`benchmarkPlanningEval.ts` 的 `planRequestFor`）：
 *    它原先自己拼了一份（同一批函数、同样的顺序，但是**第二份字面量**），现在被这一处取代。
 *
 * 三处仍然各自决定"这一轮观察到什么""请求了哪些技能"——那是**输入**，
 * 不是请求的形状；形状只有这一处。
 */
export function buildPlanRequest(inputs: PlanRequestInputs): PlanRequest {
  const { run, userMessage, budget, signal } = inputs
  const observation: ObservationSummary = {
    facts: inputs.observation.facts,
    summary: inputs.observation.summary,
    ...(inputs.observation.derived === undefined ? {} : { derived: inputs.observation.derived })
  }
  const context = buildContext({
    run,
    observation,
    requestedSkillIds: inputs.requestedSkillIds,
    selectedRefs: inputs.selectedRefs ?? [],
    availableActions: inputs.availableActions ?? [],
    budget,
    ...(inputs.contextLimits === undefined ? {} : { limits: inputs.contextLimits })
  })
  /**
   * 协调器在这里决定"上下文这一笔预算够不够"。放在会话上下文组装**之前**，
   * 与它原来的顺序逐字相同（那时被拒的运行不会继续组装下去）。
   */
  inputs.reportContextSpend?.(Math.ceil(context.estimatedCharacters / 4))
  /**
   * **宿主的会话来源在计费之后才被碰**（见 `PlanRequestInputs.conversation` 的注释）：
   * 预算被拒的那一轮，这个 thunk 一次都不会被调用。
   */
  const source = inputs.conversation?.()
  // 上限的合并口径只有一处（`conversationLimitsFor`）：协调器从前在这里内联过一遍。
  const conversationLimits = conversationLimitsFor(source, inputs.contextLimits)
  const conversation = buildConversationContext({
    binding: source?.binding ?? {
      conversationId: run.conversationId,
      projectId: run.target.projectId,
      documentId: run.target.documentId,
      workspace: run.target.workspace,
      generation: run.target.generation
    },
    summary: source?.summary ?? "",
    facts: source?.facts ?? [],
    messages: source?.messages ?? [],
    ...(source?.draft === undefined ? {} : { draft: source.draft }),
    ...(conversationLimits === undefined ? {} : { limits: conversationLimits }),
    observation,
    request: userMessage
  })
  const tools = (inputs.toolRegistry ?? createToolRegistry()).forModelPhase("planning", {
    workspace: run.target.workspace,
    confirmed: false,
    readToolsAvailable: inputs.readToolsAvailable ?? false,
    capabilityRevision: run.capabilityRevision
  })
  return { run, userMessage, budget, signal, model: { context, tools }, conversation }
}

export interface PlannerPort {
  /** 产出计划信封。**不可信输出**：协调器必须用 `parsePlanEnvelope` 校验之后才认。 */
  plan(request: PlanRequest): Promise<PlanOutcome>
}

export interface ObservationRequest {
  run: RunContext
  signal: AbortSignal
}

export interface Observation {
  /** 已确认的事实 id（计划信封里的 `factIds` 必须都在这里，否则就是"缺事实"）。 */
  factIds: string[]
  /** 供模型使用的场景摘要（有界）。 */
  summary: string
  /**
   * 事实的**文本与来源**（可选，但给了就会被带进模型上下文）。
   *
   * ## 为什么要加这两个字段
   *
   * `buildContext` 的 `Fact` 有 `text` 与 `origin`（用户明说 / 视觉推断 / 系统假设），
   * 而观察端口原先**只有 id 列表**。也就是说：即使把 `buildContext` 接上，
   * 上下文里的事实也只有一串 id —— 模型看得到"有一个事实 fact-1"，
   * 却看不到"fact-1 是**点 A 在原点**"。
   *
   * 这是"接口缺字段"这一类缺口里最容易被漏掉的一种：**两边各自都能自洽**，
   * 只有把两个类型摆在一起才发现接不上。`factIds` 仍然保留，因为协调器用它做
   * "计划引用的都是已确认事实"那道检查，而那道检查不需要文本。
   */
  facts?: readonly { id: string; text: string; origin: "user" | "inferred" | "assumed" }[]
  /**
   * **派生立体读数**（规格 §3.4 / §6.2；可选，给了就进模型上下文）。
   *
   * 与 `facts` 同一条理由、同一个教训：读数只在观察端口产出，而**消费它的地方在协调器**
   * （组装 `ModelContext` / `ConversationContext`）。端口不带这个字段，观察层算得再对，
   * 模型看到的也还是"场景里有三只多面体"——"它有没有外接球"只能靠猜。
   * 状态由内核给出（`sceneObservation.derivedStatuses` → `solidStatusReport`），
   * 这一层不重新解释几何语义。
   */
  derived?: readonly ObservedDerivedStatus[]
}

export interface ObserverPort {
  observe(request: ObservationRequest): Promise<Observation>
}

export interface CommitOutcome {
  status: "committed" | "no_change" | "stale_source" | "rejected"
  detail?: string
  /** 提交成功后的新句柄；失败时为 null。 */
  handle?: DocumentHandle | null
}

export interface CommitRequest {
  run: RunContext
  /** 已通过校验、即将落盘的动作数（用于预算与说明）。 */
  actionCount: number
  /**
   * **这一次请求的用户原话**（Fix round 1 / C3）。
   *
   * 为什么它必须一路走到暂存：参数审计的三条判据都只看用户说了什么 ——
   * "任意/恒定/定值必须保留符号参数"（规格 §6.3）、"从用户原话里读出没说全的尺寸"
   *（`infer_from_facts`）、以及"数值采样不是形式证明"（§8.2/§10 的披露）。
   * 审计发生在**编译期**（暂存那一步），而用户原话只有协调器手里有 ——
   * 不传下去，那三条在真实管线里恒不生效（只有提示词在兜，机制是死的）。
   */
  userMessage?: string
  /**
   * **这次运行要用哪几条验收条件来判定"做完了"**（Phase 3 接线）。
   *
   * 只有协调器的调用方说得清这件事，而**跑验证需要候选文档**（只有适配器有），
   * 所以它随 `stage` 一路传下去，报告再随成功结果回来。
   *
   * 缺省 = 调用方没有声明验收条件。那时不跑验证、也不拦 —— 行为与接线之前逐字相同。
   * 这与"声明了空数组"不同：空数组会得到一份 `not_supported` 报告，从而被门禁拦住。
   */
  acceptance?: readonly AcceptanceCheck[]
  /**
   * 要落盘的**动作本身**。
   *
   * 第一版这里只有 `actionCount` —— 那是个真实的设计缺口：适配器拿不到动作，
   * 于是"暂存"这一步在真实接线时**无中生有**。计数是给人看的说明，动作才是要编译的东西，
   * 两者都要有，而动作不能靠计数推出来。
   */
  actions: DraftAction[]
  /**
   * **题目显式给出的关系表**（设计 2026-10-03 §5.1），随 `actions` 一起下去。
   *
   * 与 `userMessage` 是**同一类东西**：判据发生在编译期（关系核验那一层），而这张表只有
   * 协调器手里的计划有。不传下去，`planCompiler` 的覆盖度检查会对每一份声明了关系的计划
   * 报 `relation_not_declared` —— 实测踩到的正是这个：直接调 `compilePlan` 一切正常，
   * 走真实运行时 100% 失败，因为中间有两处按 `actions` 重造了信封而没有带上它。
   */
  relations?: PlanRelations
  signal: AbortSignal
}

export interface CommitterPort {
  /**
   * 草稿阶段：**只产生隔离草稿与预览，绝不写文档**。
   * 返回失效原因（例如手工编辑之后草稿过期），供协调器决定是回到编译还是失败。
   *
   * **失败结果要带上编译器的那一份修复请求**（Agent DSL 切片 Task 4 的接线）：
   * 编译是六层管线的最后一站，`compilePlan` 在可修的失败上会给出
   * `reason` / `errors`（code+path+detail）/ `allowedChanges` / `attempt`。
   * 端口过去只回一句话（`detail`），于是协调器拿不到"允许改哪几处"，
   * 只能自己拿解析错误另造一份、或者干脆不再问模型 —— 编译器的那一份从未被消费。
   *
   * 判据是**有请求才修**：`repair` 缺省（例如用户能回答的澄清问题）时协调器
   * **不许**再问模型一次，因为没有请求的重试只是一次盲目的重复。
   */
  stage(request: CommitRequest): Promise<
    | {
        ok: true
        draftVersion: number
        previewHash: string
        /**
         * **这次暂存出来的候选文档"满足了哪几条验收条件"**（Phase 3 接线的回程通道）。
         *
         * 为什么报告要从这里回来，而不是协调器自己算：**协调器手里从来就没有候选文档**
         *（`stage` 成功只回版本与预览哈希），而验证必须对着文档跑。
         * 适配器那一侧拿得到（`staged.preview.candidate`），所以验证在那一侧跑、
         * **只把结论带回来** —— 候选文档本身不进协调器，也就不进任何模型上下文。
         *
         * `undefined` 表示**这次运行没有声明验收条件**：调用方没接线。
         * 那种情况下协调器**不拦**（行为与接线之前逐字相同），
         * 但也因此没有任何验证证据 —— 这是如实缺口，不是"验证通过"。
         */
        verification?: VerificationReport
      }
    | {
        ok: false
        reason: StageFailureReason
        detail?: string
        /** 编译器给的一次性修复请求；只有 `reason === "compile_failed"` 且失败可修时才有。 */
        repair?: RepairRequest
        /** 编译器的逐层诊断（层 + 原因码 + 路径），修复提示据此说清"卡在哪一层"。 */
        planDiagnostics?: readonly PlanDiagnostic[]
        /** 编译器在失败前补出来的假设（见 `PlanRequest.repair.assumptions`）。 */
        assumptions?: readonly StructuredAssumption[]
      }
  >
  /** 提交阶段：**唯一能写文档的调用**，必须带用户同意与幂等键。 */
  commit(request: CommitRequest & { consent: ConsentToken }): Promise<CommitOutcome>
}

/** 暂存可能失败的原因。与 G0.5 的 `DraftStore.StageReason` 同一套名字。 */
export type StageFailureReason = "unknown_draft" | "stale_draft" | "stale_draft_version" | "compile_failed" | "unsupported"

/**
 * 用户同意的凭据。
 *
 * 它**只能由宿主/UI 创建**（G0.5 的 `HostBridge`），协调器只是把它原样传下去。
 * 类型上做成"不透明载荷"是刻意的：协调器既不能伪造它，也不能从模型输出里读出一个来 ——
 * 这是计划 Task 0.8 Step 3 那句"do not expose `commit` as a model-facing tool"在类型层的落点。
 */
export interface ConsentToken {
  readonly kind: "user_consent"
  readonly nonce: string
  readonly previewHash: string
}

/**
 * 一次只读工具调用。
 *
 * `toolId` 与 `input` 曾经**不在这个类型里** —— 第一版只有 `run` / `toolCallId` /
 * `actionCount` / `signal`，于是"接上 `ToolPort`"是一句空话：端口根本不知道要执行哪个工具，
 * 也没有参数。名称与宿主侧的分发表（`toolDispatch.ts` 的 `DISPATCHABLE_TOOL_IDS`）
 * 对应；分发器**不认**任何写文档的工具（`draft.confirm_commit` 在其中被明确拒绝）。
 */
export type ToolCallRequest = {
  run: RunContext
  toolCallId: string
  /** 要执行的工具名，必须是宿主分发表里认识的只读工具。 */
  toolId: string
  /** 工具参数。**不可信输入**：分发器逐项校验后才交给下层。 */
  input: Record<string, unknown>
  actionCount: number
  signal: AbortSignal
}

export interface ToolPort {
  /** 只读工具（观察类）。**不许改文档** —— 写入只有 `CommitterPort.commit` 一条路。 */
  call(request: ToolCallRequest): Promise<ToolResult<unknown>>
}

export type CancelReason = "user" | "interrupted"

export type CancelResult = {
  cancelled: boolean
  phase: RunPhaseAtCancel
}

/** 只为本模块的类型自足而引；语义见 `runState.ts`。 */
type RunPhaseAtCancel = RunEvent["phase"]
