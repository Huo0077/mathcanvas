import { CAPABILITY_REGISTRY_REVISION, SKILL_MANIFESTS, type CommitOutcome, type DocumentHandle, type PlanEnvelope, type PlannerPort, type RunContext } from "@draw/agent-core"
import type { GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import { useAgentStore } from "../agentStore"
import { useSceneStore } from "../store"
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
  /** 用户确认：真正落盘。 */
  confirm(): CommitOutcome
  /** 用户丢弃草稿：文档不动。 */
  discard(): boolean
  /** 用户按了停止：取消当前运行（不再发事件，也不会写文档）。 */
  stop(): boolean
  /** 用户按了重试：用**同一句话**再跑一轮。 */
  retry(prompt: string, promptMessageId: string): Promise<RunPromptResult>
  /** 当前是否有一份等待确认的草稿。 */
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
  useSceneStore.getState().switchWorkspace(wanted)
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
  let runtime: AgentRuntime | null = null
  let sequence = 0
  /** 这一轮是谁在规划（`waiting` 那条分支要靠它说人话）。 */
  let lastSelection: PlannerSelection | null = null

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
      const selection = await selectPlanner(prompt)
      lastSelection = selection
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
        projectId: "local",
        runId
      })
      /**
       * **这一次运行自己持有它的运行时**（2026-09-21 修的真实缺陷）。
       *
       * `runtime` 是模块级的：`confirm()` / `discard()` / `stop()` 都会把它置空，而它们
       * 完全可能在这一轮还在 `await` 模型的时候被点到（上一轮留下的草稿面板还挂在界面上时
       * 尤其容易）。运行回来再读 `runtime.coordinator.phase()` 就抛
       * `Cannot read properties of null (reading 'coordinator')` —— 界面上只显示"没有完成"。
       *
       * 所以：**模块级那个字段只用来"让面板找到当前这一轮"，而运行自己走这条 `active`**。
       */
      runtime = active

      const live = useSceneStore.getState().document
      const runContext: RunContext = {
        runId,
        conversationId: useAgentStore.getState().activeConversation?.id ?? "local",
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
        useAgentStore.getState().recordRunEvent({
          phase: event.phase,
          status: event.phase === "failed" ? "error" : "ok",
          summary: event.detail || PHASE_SUMMARY[event.phase] || event.phase,
          at: event.at
        })
        /**
         * **另一层读者**：开发者详细视图（默认关着）。
         *
         * 只取账本已有的字段（用哪个阶段、从哪个阶段来、那句详情、第几步），
         * **不额外收集任何东西** —— 计划要求遥测不含模型推理与图像字节，而"只搬已有字段"
         * 是这条约束在实现层最省事的落法：这里根本没有可以塞进去的位置。
         */
        useAgentStore.getState().recordDiagnostic(`${event.sequence}. ${event.from} → ${event.phase}: ${event.detail}`)
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
        })
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
        })
      } else if (phase === "failed") {
        const last = active.coordinator.ledger().at(-1)
        useAgentStore.getState().failPendingReply({ code: "run_failed", message: last?.detail || "这次运行没有完成。", retryable: false })
      } else if (phase === "completed") {
        useAgentStore.getState().recordReceipt({ status: "no_change" })
      }

      return { phase, draftId: null }
  }

  return {
    run: runPrompt,

    confirm() {
      if (!runtime) return { status: "rejected", detail: "there is no run to confirm" }
      const outcome = runtime.confirmDraft()
      // 只有宿主桥说成功才显示成功；被拒时**如实**把原因带回界面。
      useAgentStore.getState().recordReceipt(outcome.status === "committed"
        ? { status: "committed" }
        : outcome.status === "no_change"
          ? { status: "no_change" }
          : { status: "failed", detail: outcome.detail ?? outcome.status })
      // 提交之后这份草稿就用掉了：不清掉的话再点一次确认会去提交一个已消费的凭据。
      runtime = null
      return outcome
    },

    discard() {
      if (!runtime) return false
      const discarded = runtime.discardDraft()
      useAgentStore.getState().recordReceipt({ status: "no_change" })
      runtime = null
      return discarded
    },

    /**
     * 用户按了停止。
     *
     * 取消由协调器负责传播（它会置位、abort 掉端口、并把账本收尾到 `cancelled`），
     * 而运行器**只**报告结果：如果这一轮已经结束（没有运行时实例），如实返回 `false`，
     * 不假装取消成功。
     */
    stop() {
      if (!runtime) return false
      const result = runtime.coordinator.cancel("user")
      if (!result.cancelled) return false
      // 取消之后草稿也作废：留着它会让用户看到一份永远不会生效的预览。
      runtime.discardDraft()
      useAgentStore.getState().failPendingReply({ code: "cancelled_by_user", message: "已按你的要求停下。没有改动文档。", retryable: true })
      runtime = null
      return true
    },

    /** 重试 = 用同一句话再跑一轮。它**不**复用上一轮的草稿（那份已经作废了）。 */
    async retry(prompt, promptMessageId) {
      runtime = null
      return runPrompt(prompt, promptMessageId)
    },

    hasDraft() {
      return runtime !== null && runtime.draftId() !== null
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
