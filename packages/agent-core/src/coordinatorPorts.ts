import type { DocumentHandle, PlanDiagnostic, PlanEnvelope, RepairRequest, RunContext, StructuredAssumption, ToolResult } from "./contracts"
import type { DraftAction } from "@draw/scene-graph"
import type { Budget } from "./budget"
import type { ConversationContext, ModelContext } from "./contextBuilder"
import type { RunEvent } from "./runState"
import type { ObservedDerivedStatus } from "./sceneObservation"
import type { ToolDescriptor } from "./toolRegistry"

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
   * 要落盘的**动作本身**。
   *
   * 第一版这里只有 `actionCount` —— 那是个真实的设计缺口：适配器拿不到动作，
   * 于是"暂存"这一步在真实接线时**无中生有**。计数是给人看的说明，动作才是要编译的东西，
   * 两者都要有，而动作不能靠计数推出来。
   */
  actions: DraftAction[]
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
    | { ok: true; draftVersion: number; previewHash: string }
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
