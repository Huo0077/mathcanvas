import { CAPABILITY_REGISTRY_REVISION, SKILL_MANIFESTS, factBelongsToDocument, type CommitOutcome, type ConversationContextSource, type ConversationDraftView, type DocumentHandle, type PlanEnvelope, type PlannerPort, type RunContext, type WorkspaceId } from "@draw/agent-core"
import type { GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import { useAgentStore, type AgentConversation } from "../agentStore"
import { useSceneStore } from "../store"
import { conversationRepository } from "../conversationRepository"
import { summaryOfDocument } from "../conversationSummary"
import { appendRunEvent } from "../services/runEventClient"
import { createAgentRuntime, type AgentRuntime } from "./agentRuntime"
import { createLocalPlanner, localIntentSkillIds } from "./localPlanner"
import { createModelPlanner, resolveActiveProvider, type ModelPlannerDependencies } from "./modelPlanner"

/**
 * **Agent 运行器**（Task 2.5 Step 2 的另一半）。
 *
 * 协调器是**按运行**建的（每次 `start` 都会重置账本），但"确认并提交"发生在运行**之后** ——
 * 那时必须还能拿到同一个运行时，否则用户点了确认却找不到那份草稿。
 * 所以这里持有一段**运行之间的状态**：上一次运行用的 `AgentRuntime`（以及它的草稿）。
 *
 * ## 一条安全边界
 *
 * 这个模块是界面**唯一**能触达提交的地方，而它只调 `runtime.confirmDraft()`，
 * 后者只调 `HostBridge.requestConsent` + `HostBridge.commit`。
 * 界面那一层拿不到 `commit`，也造不出同意凭据 —— 这是"提交不是模型可见工具"在装配层的落点。
 */

export interface RunPromptResult {
  phase: string
  /** 有草稿并且停在确认阶段时为它的 id。 */
  draftId: string | null
}

export interface AgentRunner {
  /** 跑一轮。事件会实时回流到 `useAgentStore`，所以界面不需要自己订阅。 */
  run(prompt: string, promptMessageId: string): Promise<RunPromptResult>
  /**
   * 用户确认：真正落盘。
   *
   * `runId` 是**用户点的那块面板所属的那一轮**（消息上盖着它）。传了就必须是已知的一轮，
   * 而且它的会话必须还是当前会话（规格 §5.4）—— 否则如实拒绝，绝不替另一轮提交。
   * 不传时退回"最近的那一轮"（老调用方与脚本化用例）。
   */
  confirm(runId?: string): CommitOutcome
  /** 用户丢弃草稿：文档不动。`runId` 语义同 `confirm`。 */
  discard(runId?: string): boolean
  /** 用户按了停止：取消当前运行（不再发事件，也不会写文档）。`runId` 语义同 `confirm`。 */
  stop(runId?: string): boolean
  /** 用户按了重试：用**同一句话**再跑一轮。 */
  retry(prompt: string, promptMessageId: string): Promise<RunPromptResult>
  /** 当前是否有一份等待确认的草稿（任意一轮）。 */
  hasDraft(): boolean
}

/** 阶段 → 给用户看的一句话（与 `RunStatus` 里的表分开：这张用于**轨迹摘要**）。 */
export const PHASE_SUMMARY: Record<string, string> = {
  preflight: "检查环境与目标文档",
  observing: "读取当前场景",
  planning: "规划这一步要做什么",
  answering: "只读作答，不改文档",
  compiling: "把计划编译成动作并暂存草稿",
  validating: "校验暂存的草稿",
  awaiting_confirmation: "等你确认这份草稿",
  committing: "提交已确认的改动",
  completed: "完成",
  waiting: "需要你补充信息",
  failed: "没有完成",
  cancelled: "已取消",
  interrupted: "已中断"
}

/**
 * 一轮运行**提交时要用的落点**（Task 5）：会话、用户消息、以及这次创建出来的对象 id。
 *
 * 提交发生在运行结束之后（用户看预览、点确认），所以运行器自己留一份 ——
 * 商店里这一轮的落点那时可能已经被终态回执清掉了。
 */
interface PendingCommit {
  runId: string
  conversationId: string
  promptMessageId: string
  createdObjects: string[]
}

function handleOf(document: GeometryDocument): DocumentHandle {
  return {
    projectId: "local",
    documentId: document.metadata.id,
    workspace: document.workspace as DocumentHandle["workspace"],
    epoch: `epoch:${document.metadata.id}`,
    generation: document.revision,
    contentHash: contentFingerprint(document)
  }
}

/**
 * **现在文档是第几版**（Fix round 2 / item 5）。
 *
 * 消息只在**第一次有内容**时落盘（幂等键），所以"追加那一刻的版本"就是这一列唯一诚实的值；
 * 运行器是唯一同时知道"这条消息"与"当前文档"的一层，所以由它读。
 */
function generation(): number {
  return useSceneStore.getState().document.revision
}

/**
 * **这一轮会话上下文的来源**（对话切片 Task 4；规格 §5.3）。
 *
 * 在运行**开始那一刻**读一次，之后整轮用它：绑定（会话 + 文档 + 版本）、结构化摘要、
 * 已确认事实、最近消息、以及那份**还没确认**的草稿视图。
 *
 * 三件事各自有理由：
 * - **会话按钉住的那条读，而不是"现在显示的那条"**（Fix round 1 / I1）：
 *   `selectPlanner` 在桌面端要过 IPC 问「使用中」的配置，用户完全可能在这个窗口里切走 ——
 *   而这一轮属于开始时钉住的那条会话（规格 §5.4）。读错会话的后果是
 *   "B 的历史与事实进了 A 这一轮的提示词，而事件写回 A"。
 * - **消息从界面状态取、摘要与事实从仓储取**：界面是这一轮说话的现场（包括刚发出去的那句），
 *   而摘要与事实是**存下来的**长期记忆 —— 它们存在的意义就是跨重启还在。
 * - **只带本文档的事实**：换工作区就是换文档，而事实表是会话级的（规格 §5.1）——
 *   别的文档确认的事实（"第 3 版新增 solid-1"）在这份文档里没有对应对象。
 * - **未确认的草稿只以视图形式进去**：草稿进的是 `draft` 字段，不是事实列表（规格 §1.2）。
 */
async function readConversationSource(pinnedConversationId: string | undefined): Promise<ConversationContextSource> {
  const document = useSceneStore.getState().document
  const state = useAgentStore.getState()
  const conversation = (pinnedConversationId ? state.conversations.find((candidate) => candidate.id === pinnedConversationId) : undefined) ?? state.activeConversation
  // 仓储读不到（浏览器里读的是同一份 localStorage 序列化器）就当作"还没有长期记忆"，
  // **不编**一份摘要或事实出来。
  const record = conversation ? await conversationRepository().readRecord(conversation.id) : null
  const draft = conversation ? awaitingDraftOf(conversation) : undefined
  const documentId = document.metadata.id
  /**
   * **摘要也按文档取**（Fix round 2 / C1 残余；规格 §5.1 + §9）。
   *
   * 存储形状是"一份文档一份摘要"（`summaryOfDocument`）；这里只取本次运行那份文档的那一份，
   * 别的文档那一份**端都不端出来** —— 否则"在立体几何里确认的事实"会以 `summary` 的形式
   * 出现在平面几何那一轮里（事实列表筛了，载体没筛等于没筛）。
   */
  const summary = record === null ? null : summaryOfDocument(record.summary, documentId)
  return {
    binding: {
      conversationId: conversation?.id ?? "local",
      projectId: state.binding.projectId,
      documentId,
      workspace: document.workspace as WorkspaceId,
      generation: document.revision
    },
    summary: summary === null ? "" : JSON.stringify(summary),
    // 只带**本文档**的事实（`factBelongsToDocument` 与 `buildConversationContext` 同一条判据）。
    facts: (record?.facts ?? []).filter((fact) => factBelongsToDocument(fact, documentId)),
    messages: (conversation?.messages ?? []).flatMap((message) => message.text.trim().length > 0
      ? [{ id: message.id, role: message.role, text: message.text, createdAt: message.createdAt }]
      : []),
    ...(draft === undefined ? {} : { draft })
  }
}

/** 会话里**等待确认**的那份草稿视图（有草稿、还没回执、也没失败）。 */
function awaitingDraftOf(conversation: AgentConversation): ConversationDraftView | undefined {
  const awaiting = [...conversation.messages].reverse().find((message) => message.draft && !message.commit && !message.failure)
  const draft = awaiting?.draft
  if (!draft) return undefined
  return {
    draftId: draft.draftId,
    draftVersion: draft.draftVersion,
    previewHash: draft.previewHash,
    stageCount: draft.stageCount,
    ...(draft.assumptions === undefined ? {} : { assumptions: draft.assumptions })
  }
}

/**
 * 这条计划需要哪个工作区。
 *
 * 判据放在这里而不是从计划里"推断"：它取决于**动作名**，而动作名与工作区的对应关系
 * 是动作层的知识。目前只有两类：
 * - `solid.*` / `section.*` / `dynamic.*`（三维那几族）→ `geometry3d`；
 * - `planar.*` → `conics`。
 *
 * 返回 `null` 表示"这次不需要切"（例如只读回答，或动作本身不绑定工作区）。
 */
function requiredWorkspace(plan: PlanEnvelope): "conics" | "geometry3d" | null {
  if (plan.kind !== "plan") return null
  for (const action of plan.actions) {
    if (action.actionId.startsWith("solid.") || action.actionId.startsWith("section.")) return "geometry3d"
    if (action.actionId.startsWith("dynamic.")) return "geometry3d"
    if (action.actionId.startsWith("planar.")) return "conics"
  }
  return null
}

/**
 * 把工作区切到计划需要的那个。
 *
 * **工程制图不参与自动切换**：在工图里说"建一个立方体"时，直接切走会让用户当前的图纸上下文消失，
 * 而这条指令本来就不属于那个工作区 —— 如实拒绝比悄悄切走更尊重用户。
 */
function prepareWorkspaceFor(plan: PlanEnvelope): { ok: true } | { ok: false; detail: string } {
  const wanted = requiredWorkspace(plan)
  if (!wanted) return { ok: true }
  const current = useSceneStore.getState().document.workspace
  if (current === wanted) return { ok: true }
  if (current === "cad") {
    return { ok: false, detail: `这条指令需要在${wanted === "geometry3d" ? "立体几何" : "平面几何"}工作区执行；请先离开工程制图，或者在图纸里用绘图工具。` }
  }
  /**
   * **标明这是 Agent 自己切的工作区**（Fix round 1 / C1）：它是"执行这条计划"的副作用，
   * 不是用户换了上下文。App 那一层据此**不**把 Agent 区的会话列表换走 ——
   * 否则用户正在读的那条会话与它的确认面板会在这一轮还没落地时被换掉。
   */
  useSceneStore.getState().switchWorkspace(wanted, "agent")
  return { ok: true }
}

/**
 * 运行器的可替换依赖。
 *
 * `planner` 可注入的**唯一**理由是测试：要验证"规划器声明的假设真的走到确认界面上"，
 * 就得有一个会说假设的规划器，而本地确定性规划器**从不声明假设**（它产出的是固定动作）。
 * 生产路径不传它，用的仍是下面 `selectPlanner` 自动选出来的那一份。
 */
export interface AgentRunnerDependencies {
  planner?: PlannerPort
  /**
   * 模型规划器的注入点（测试用）。
   *
   * 生产的缺省值走真实 IPC（读「使用中」的那一份配置 + `provider_run`），
   * 而这两件事在浏览器里都不成立 —— 所以测试必须能替换它们，否则
   * "选中了模型服务就用模型"这条判据只能靠人去点。
   */
  modelPlanner?: ModelPlannerDependencies
}

/**
 * **这一轮由谁规划**。
 *
 * 三样东西必须一起决定，因为它们互相约束：谁来规划（`planner`）、
 * 上下文里给哪些动作（`requestedSkillIds`）、以及这次运行自述用哪个 profile
 *（`textProfileId` —— 它进 `RunContext`，是"这段文字是谁产生的"这个事实的落点）。
 */
export interface PlannerSelection {
  planner: PlannerPort
  requestedSkillIds: readonly string[]
  textProfileId: string
}

/**
 * 模型路径下请求哪些技能：**全部已登记的清单**。
 *
 * 本地规划器能精确说出"我这条指令要用哪份清单"，因为它的指令表是写死的；
 * 而模型路径**不可能在发请求之前**知道用户想要什么 —— 这一趟请求本身就是为了问它。
 * 所以这里的取舍是：把整张菜单给它，靠**别的东西**兜底。
 *
 * 兜底的东西是真实存在的三层：传输层 schema（未知动作 / 未知字段 / 未作用域引用一律拒）、
 * 动作编译器的语义校验、以及"写入必须经用户确认"。按关键词猜技能看起来更"省"，
 * 但猜错的代价是**某些任务永远做不了**（模型看不到那个动作，于是只能问用户），
 * 而那种失败在界面上看起来像"模型不会做这件事"。
 */
export const MODEL_PLANNER_SKILL_IDS: readonly string[] = SKILL_MANIFESTS.map((manifest) => manifest.id)

export function createAgentRunner(dependencies: AgentRunnerDependencies = {}): AgentRunner {
  let sequence = 0
  /** 这一轮是谁在规划（`waiting` 那条分支要靠它说人话）。 */
  let lastSelection: PlannerSelection | null = null
  /**
   * **按 `runId` 索引的运行状态**（Fix round 1 / C2）。
   *
   * 原先只有模块级**单槽** `runtime`/`pendingCommit`：每个新运行都会覆盖它，而确认面板是
   * **按消息**渲染的 —— 于是"在 A 里暂存草稿 → 切到 B 再暂存一份 → 回到 A 点确认"
   * 会提交 **B** 的草稿，并把回执与事实写进 B（规格 §5.4 要的正是"确认时检查会话"）。
   * 现在每一轮都留着它自己的运行时与落点，界面上那块面板说哪一轮就确认哪一轮。
   */
  const runs = new Map<string, { runtime: AgentRuntime; commit: PendingCommit }>()
  /** 最近一轮（老调用方不传 `runId` 时用它）。 */
  let lastRunId: string | null = null

  /**
   * 用户指的那一轮。
   *
   * 传了 `runId` 就必须是**已知的**一轮（不认识就如实拒绝）；没传就退回最近一轮。
   * 另外，会话必须还是**当前**会话：面板挂在 A 的对话记录里，用户看得见它，
   * 而"当前会话"是 A 才算数（规格 §5.4 的会话检查）。
   */
  function resolveRun(runId?: string): { runtime: AgentRuntime; commit: PendingCommit } | null {
    const id = runId ?? lastRunId
    if (id === null) return null
    const entry = runs.get(id)
    if (!entry) return null
    const active = useAgentStore.getState().activeConversation?.id
    if (active !== undefined && entry.commit.conversationId !== active) return null
    return entry
  }

  /** 一轮用掉了：从表里删掉（`lastRunId` 跟着挪到还在的那一轮）。 */
  function retireRun(runId: string): void {
    runs.delete(runId)
    if (lastRunId === runId) lastRunId = [...runs.keys()].at(-1) ?? null
  }

  /**
   * 选出这一轮要用的规划器。
   *
   * **「使用中」的那一份配置就是在这里被消费的**：`resolveActiveProvider` 现取它，
   * 拿到就用模型规划器，拿不到（浏览器 / 还没选 / 没密钥）就用本地确定性规划器 ——
   * 后者认不出就问用户，**绝不编答案**（这是 G2 Gate 里"生产路径不再有演示回复"那条的延续）。
   *
   * 解析结果被**钉住**（`resolveProvider: async () => resolution`）：一次运行里模型可能被问
   * 两次（含那次修复），两次必须用同一份配置与同一批能力证据，否则第二次尝试其实换了题目，
   * 事后没法判断"是模型改好了还是条件变了"。
   */
  async function selectPlanner(prompt: string): Promise<PlannerSelection> {
    // 注入的规划器优先（测试用）：它一被给出来，就不该再去问 IPC。
    if (dependencies.planner) return { planner: dependencies.planner, requestedSkillIds: [], textProfileId: "local-planner" }

    const resolution = await (dependencies.modelPlanner?.resolveProvider ?? resolveActiveProvider)()
    if (!resolution.ok) {
      return { planner: createLocalPlanner(), requestedSkillIds: localIntentSkillIds(prompt), textProfileId: "local-planner" }
    }
    return {
      planner: createModelPlanner({ ...dependencies.modelPlanner, resolveProvider: async () => resolution }),
      requestedSkillIds: MODEL_PLANNER_SKILL_IDS,
      textProfileId: resolution.provider.id
    }
  }

  /** 实现在下面单独定义，`retry` 直接调它 —— 不依赖 `this`（对象字面量的方法里用 `this` 太脆）。 */
  async function runPrompt(prompt: string, promptMessageId: string): Promise<RunPromptResult> {
      sequence += 1
      const runId = `run-${sequence}-${Date.now().toString(36)}`
      /**
       * **钉住这一轮的落点**（Task 5；规格 §5.4）：在**任何 await 之前**做 ——
       * 下面两行都要等 IPC（选配置、读会话），而用户完全可能在这段时间里切到别的会话。
       * 钉住了，这一轮的事件与回执就只会写回它开始时的那条会话。
       */
      const pinned = useAgentStore.getState().pinRun({ runId, promptMessageId })
      // 钉不住（那条消息已经不在了）时退回"当前在途"那条老路径，而不是把事件丢掉。
      const eventRunId = pinned ? runId : undefined
      // 这一轮的提交落点（运行结束之后确认时才用得上）。
      const commit: PendingCommit | null = pinned ? { runId, conversationId: pinned.conversationId, promptMessageId, createdObjects: [] } : null
      const selection = await selectPlanner(prompt)
      lastSelection = selection
      /**
       * 会话上下文在**建运行时之前**读一次：绑定、历史、摘要、事实、草稿视图都钉在这一刻。
       *
       * **必须按上面钉住的那条会话读**（Fix round 1 / I1）：`selectPlanner` 上面那一行刚 await 过
       * IPC，用户完全可能在这段时间里切到另一条会话 —— 而这一轮属于开始时钉住的那条。
       */
      const conversation = await readConversationSource(pinned?.conversationId)
      /**
       * **这一轮到底看到了多少会话历史**（计数，不是内容）。
       *
       * 它是"会话之间有没有串线"最直接的判据：同一轮里 `confirmed fact(s)` 与 `message(s)`
       * 都是**这条会话**的。当前这一句（`promptMessageId`）不算历史 —— 它是这一轮的输入，
       * 由 `PlanRequest.userMessage` 单独承载（`buildConversationContext` 也会去重）。
       * 写在开发者详细视图那一层（默认折叠），所以它既不打扰用户，也不需要模型服务 ——
       * 浏览器里本地确定性规划器走的是同一条路。
       */
      const history = conversation.messages.filter((message) => message.id !== promptMessageId)
      useAgentStore.getState().recordDiagnostic(`[context] conversation ${conversation.binding.conversationId}: ${conversation.facts.length} confirmed fact(s), ${history.length} message(s)`, eventRunId)
      const active = createAgentRuntime({
        // 每次现取：句柄里的内容哈希就是 Compare-and-Swap 的依据。
        readDocument: () => useSceneStore.getState().document,
        // 提交成功后落盘。用 `commitCandidate`（压一步历史）而不是 `replace`（清历史）。
        writeDocument: (candidate) => useSceneStore.getState().commitCandidate(candidate),
        readSceneDocuments: () => {
          const live = useSceneStore.getState().document
          return [{ handle: handleOf(live), document: live }]
        },
        // 这一轮由谁规划由 `selectPlanner` 决定（「使用中」的那份配置在它里面被消费）。
        planner: selection.planner,
        /**
         * **这条指令要用到的技能**（决定上下文里的可用动作）。
         *
         * 必须在**建运行时之前**算出来：上下文是发请求前组装的，而它一旦定下来就决定了
         * 模型能看到哪几个动作。本地规划器能精确知道自己要用哪份清单（`localIntentSkillIds`）；
         * 模型路径给全部清单（理由见 `MODEL_PLANNER_SKILL_IDS`）。
         */
        requestedSkillIds: selection.requestedSkillIds,
        /**
         * 编译之前把工作区切到这条计划需要的那个。
         *
         * 动作编译器会拒"工作区不匹配"的动作（立方体在平面几何里会被拒），
         * 而用户在 Agent 里说"建一个立方体"时画布可能停在平面几何。没有这一步，
         * 用户就得自己先切工作区再重发一次 —— 那不是对话式作图。
         *
         * 只对**有动作的计划**做切换：只读回答不需要目标工作区（协调器也不会为此调 `prepare`）。
         */
        prepare: (plan) => prepareWorkspaceFor(plan),
        // 导出预检要投影结果，只有工程制图那套组件知道怎么取。Agent 触发的导出建议
        // 暂时**如实**回"无法预检"，而不是给一个假的"可以导出"。
        exportPreflight: { preflight: () => ({ error: "export preflight is not wired into the agent path yet" }) },
        // 会话上下文：**一次运行只取一次**（协调器在组装上下文时调它），两次尝试共用同一份。
        conversation: () => conversation,
        // 同意绑定这一轮的会话；提交时与**当前**会话比对（Fix round 1 / C2；规格 §5.4）。
        ...(pinned === null ? {} : { conversationId: pinned.conversationId }),
        readConversationId: () => useAgentStore.getState().activeConversation?.id ?? null,
        projectId: "local",
        runId
      })
      /**
       * **把这一轮登记进按 `runId` 索引的表**（Fix round 1 / C2）。
       *
       * 每个新运行都覆盖模块级的单槽，而上面那些 `await`（选配置、读会话、跑模型）期间
       * 用户完全可能切到别条会话并又跑一轮 —— 那次新运行会把旧的一轮挤掉。
       * 登记之后，"确认/丢弃/停止"都能指回**用户点的那一轮**。
       */
      if (commit) {
        runs.set(runId, { runtime: active, commit })
        lastRunId = runId
      }

      const live = useSceneStore.getState().document
      const runContext: RunContext = {
        runId,
        // **钉住的那条会话**，不是"现在显示的那条"（Fix round 1 / I1）：运行账本、事件与事实
        // 都按它归属，而用户可以在这一轮还在跑的时候切走。
        conversationId: pinned?.conversationId ?? useAgentStore.getState().activeConversation?.id ?? "local",
        promptMessageId,
        target: handleOf(live),
        sources: [],
        // 这次运行自述用哪个 profile：模型路径下就是「使用中」的那一份的 id（真话）。
        textProfileId: selection.textProfileId,
        capabilityRevision: CAPABILITY_REGISTRY_REVISION,
        policyRevision: "local"
      }

      for await (const event of active.coordinator.start({ run: runContext, userMessage: prompt })) {
        // 每一步都回流：用户看到的是"走到哪一步"，而不是一个转圈。
        // 带上 `eventRunId`：用户切走之后，这一步仍然写回**它自己那条会话**（规格 §5.4）。
        useAgentStore.getState().recordRunEvent({
          phase: event.phase,
          status: event.phase === "failed" ? "error" : "ok",
          summary: event.detail || PHASE_SUMMARY[event.phase] || event.phase,
          at: event.at
        }, eventRunId)
        /**
         * **另一层读者**：开发者详细视图（默认关着）。
         *
         * 只取账本已有的字段（用哪个阶段、从哪个阶段来、那句详情、第几步），
         * **不额外收集任何东西** —— 计划要求遥测不含模型推理与图像字节，而"只搬已有字段"
         * 是这条约束在实现层最省事的落法：这里根本没有可以塞进去的位置。
         */
        useAgentStore.getState().recordDiagnostic(`${event.sequence}. ${event.from} → ${event.phase}: ${event.detail}`, eventRunId)
        /**
         * **第三层读者：项目库里的账本**（Task 2.6）。
         *
         * 内存里那份诊断随会话消失，而"这次运行到底发生了什么"要能跨重启查。
         * 事件形状由 Rust 侧定死（`deny_unknown_fields`），所以这里只搬已有字段 ——
         * 与上面那条同一条纪律：**没有可以塞进去的位置**。
         *
         * **不 await**：账本是旁路，让它挡住这一步的推进没有任何好处（写失败会落到下面那句诊断里，
         * 而不是让运行停下来）。在浏览器里跑时它如实回 `no_desktop_shell`，那是预期状态，不报。
         */
        void appendRunEvent({
          eventId: `${runId}:${event.sequence}`,
          runId,
          conversationId: runContext.conversationId,
          phase: event.phase,
          status: event.phase === "failed" ? "error" : "ok",
          detail: event.detail || PHASE_SUMMARY[event.phase] || event.phase,
          at: event.at,
          promptMessageId,
          versions: { capabilityRevision: runContext.capabilityRevision, policyRevision: runContext.policyRevision }
        }).then((result) => {
          // "没有桌面外壳"是**预期**（浏览器里账本不可用）；真的写失败要说出来 ——
          // 否则"账本里少了几行"永远没人会知道。
          if (!result.ok && result.code === "ipc_failed") useAgentStore.getState().recordDiagnostic(`[ledger] append failed: ${result.detail}`)
        })
      }

      const phase = active.coordinator.phase()
      const draftId = active.draftId()

      if (draftId && phase === "awaiting_confirmation") {
        // 草稿**只是视图**（标识 + 计数）；候选文档留在宿主侧，不进聊天记录。
        // 计数由宿主侧的 `preview()` 从**真实文档**算出（界面不自己数）。
        const preview = active.host.preview(draftId)
        // 这次**创建出来的对象 id**（候选文档 vs 当前文档的差集）：提交成功之后它们要进事实。
        // **只取 id**：候选文档本身一个字节都不离开这一层。
        if (commit && preview.ok) {
          const before = new Set(useSceneStore.getState().document.primitives.map((primitive) => primitive.id))
          commit.createdObjects = preview.artifact.candidate.primitives.map((primitive) => primitive.id).filter((id) => !before.has(id)).slice(0, 24)
        }
        useAgentStore.getState().recordDraft({
          draftId,
          draftVersion: preview.ok ? preview.artifact.draftVersion : 1,
          previewHash: preview.ok ? preview.artifact.previewHash : "",
          stageCount: preview.ok ? preview.artifact.stageCount : 0,
          undoesInOneStep: true,
          counts: preview.ok ? preview.artifact.counts : undefined,
          baseCounts: preview.ok ? preview.artifact.baseCounts : undefined,
          // 假设在**计划解析成功那一刻**就知道，而草稿是运行结束之后才拿到的 —— 中间没有第二条路。
          assumptions: active.assumptions()
        }, eventRunId, generation())
        return { phase, draftId }
      }

      if (phase === "waiting") {
        /**
         * **把规划器真正问的那句话说出来**，而不是一句写死的"没有接入模型服务"。
         *
         * 那句话在接上模型之后就是**假话**：模型明明问了"半径是多少"，界面却告诉用户
         * "当前没有模型服务"。问题与假设同一处产生（计划解析那一刻），所以同一处取。
         */
        const questions = active.questions()
        useAgentStore.getState().failPendingReply({
          code: "needs_more_information",
          message: questions && questions.length > 0
            ? questions.join(" ")
            : `这一步需要你补充信息${lastSelection?.textProfileId === "local-planner" ? "。当前没有接入模型服务，本地规划器只认识几条固定指令" : ""}。`,
          retryable: false
        }, eventRunId, generation())
      } else if (phase === "failed") {
        const last = active.coordinator.ledger().at(-1)
        useAgentStore.getState().failPendingReply({ code: "run_failed", message: last?.detail || "这次运行没有完成。", retryable: false }, eventRunId, generation())
      } else if (phase === "completed") {
        useAgentStore.getState().recordReceipt({ status: "no_change" }, eventRunId, generation())
      }

      // 这一轮到此为止（没有草稿要等确认）：清掉落点，之后迟到的事件一律丢弃。
      if (eventRunId !== undefined) useAgentStore.getState().endRun(eventRunId)
      return { phase, draftId: null }
  }

  return {
    run: runPrompt,

    confirm(runId) {
      /**
       * **只认用户点的那一轮**（Fix round 1 / C2；规格 §5.4）。
       *
       * 不认识的 `runId`、或者它的会话已经不是当前会话 → 如实拒绝（`stale_source` 那一类：
       * "世界变了，重新看一遍"），绝不替另一轮提交。
       */
      const entry = resolveRun(runId)
      if (!entry) return { status: "rejected", detail: runId === undefined ? "there is no run to confirm" : `run ${runId} is not waiting for a confirmation in the active conversation` }
      const { runtime: run, commit } = entry
      const outcome = run.confirmDraft()
      // 只有宿主桥说成功才显示成功；被拒时**如实**把原因带回界面。
      useAgentStore.getState().recordReceipt(outcome.status === "committed"
        ? { status: "committed" }
        : outcome.status === "no_change"
          ? { status: "no_change" }
          : { status: "failed", detail: outcome.detail ?? outcome.status }, commit.runId, generation())
      /**
       * **只有真的提交了才写长期记忆**（Task 5；规格 §1.2/§10）：
       * 代数与这次创建的对象进事实表，长会话顺带压缩摘要。
       * `no_change` / 被拒 / 用户丢弃都**不写** —— 那些情况下"事实"并没有发生。
       */
      if (outcome.status === "committed") {
        void useAgentStore.getState().recordCommittedRun({
          runId: commit.runId,
          conversationId: commit.conversationId,
          promptMessageId: commit.promptMessageId,
          // 事实属于**这次提交真正落上去的那份文档**（Agent 自己可能刚为这条计划切过工作区）。
          documentId: useSceneStore.getState().document.metadata.id,
          generation: useSceneStore.getState().document.revision,
          createdObjects: commit.createdObjects
        })
      }
      /**
       * **只有真的落定才把这一轮用掉**（Fix round 2 / item 3）。
       *
       * `committed` / `no_change` = 同意已经消费、草稿已经用掉 → 退休。
       * 被拒（`stale_source` / `stale_conversation` / `commit_rejected` …）时**留着**：
       * 面板还挂在界面上，用户再点一次要看到**真正的原因**，而不是
       * "run … is not waiting for a confirmation"（那句话把真实原因盖掉了，而且
       * `hasDraft()` 变成 false，界面就再也说不出"这里还有一份草稿"）。
       */
      if (outcome.status === "committed" || outcome.status === "no_change") {
        useAgentStore.getState().endRun(commit.runId)
        // 提交之后这份草稿就用掉了：不清掉的话再点一次确认会去提交一个已消费的凭据。
        retireRun(commit.runId)
      }
      return outcome
    },

    discard(runId) {
      const entry = resolveRun(runId)
      if (!entry) return false
      const { runtime: run, commit } = entry
      const discarded = run.discardDraft()
      // 丢弃**不产生任何事实**：那份草稿从来没有发生过（规格 §1.2）。
      useAgentStore.getState().recordReceipt({ status: "no_change" }, commit.runId, generation())
      useAgentStore.getState().endRun(commit.runId)
      retireRun(commit.runId)
      return discarded
    },

    /**
     * 用户按了停止。
     *
     * 取消由协调器负责传播（它会置位、abort 掉端口、并把账本收尾到 `cancelled`），
     * 而运行器**只**报告结果：如果这一轮已经结束（没有运行时实例），如实返回 `false`，
     * 不假装取消成功。
     */
    stop(runId) {
      const entry = resolveRun(runId)
      if (!entry) return false
      const { runtime: run, commit } = entry
      const result = run.coordinator.cancel("user")
      if (!result.cancelled) {
        // 这一轮已经结束了（协调器的账本已经收尾）：它不可能再等确认 —— **顺手收掉**，
        // 否则这一条会永远留在表里（Fix round 2 / 残余 3 的后半）。
        retireRun(commit.runId)
        useAgentStore.getState().endRun(commit.runId)
        return false
      }
      // 取消之后草稿也作废：留着它会让用户看到一份永远不会生效的预览。
      run.discardDraft()
      useAgentStore.getState().failPendingReply({ code: "cancelled_by_user", message: "已按你的要求停下。没有改动文档。", retryable: true }, commit.runId, generation())
      useAgentStore.getState().endRun(commit.runId)
      retireRun(commit.runId)
      return true
    },

    /** 重试 = 用同一句话再跑一轮。它**不**复用上一轮的草稿（那份已经作废了）。 */
    async retry(prompt, promptMessageId) {
      return runPrompt(prompt, promptMessageId)
    },

    hasDraft() {
      // 任意一轮还挂着草稿都算（用户可能在另一条会话里也暂存了一份）。
      return [...runs.values()].some((entry) => entry.runtime.draftId() !== null)
    }
  }
}

/**
 * 界面用的**单例**运行器。
 *
 * 为什么是模块级单例而不是 React 状态：草稿必须跨"运行结束 → 用户点确认"这两件事活着，
 * 而组件在切换模块时会卸载。放进组件状态会让"切走再切回来"丢掉等待确认的草稿。
 */
export const agentRunner = createAgentRunner()
