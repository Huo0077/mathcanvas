import { CAPABILITY_REGISTRY_REVISION, type CommitOutcome, type DocumentHandle, type PlanEnvelope, type PlannerPort, type RunContext } from "@draw/agent-core"
import type { GeometryDocument } from "@draw/dsl"
import { contentFingerprint } from "@draw/scene-graph"

import { useAgentStore } from "../agentStore"
import { useSceneStore } from "../store"
import { createAgentRuntime, type AgentRuntime } from "./agentRuntime"
import { createLocalPlanner } from "./localPlanner"

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
 * 生产路径不传它，用的仍是本地规划器。
 */
export interface AgentRunnerDependencies {
  planner?: PlannerPort
}

export function createAgentRunner(dependencies: AgentRunnerDependencies = {}): AgentRunner {
  let runtime: AgentRuntime | null = null
  let sequence = 0

  /** 实现在下面单独定义，`retry` 直接调它 —— 不依赖 `this`（对象字面量的方法里用 `this` 太脆）。 */
  async function runPrompt(prompt: string, promptMessageId: string): Promise<RunPromptResult> {
      sequence += 1
      const runId = `run-${sequence}-${Date.now().toString(36)}`
      runtime = createAgentRuntime({
        // 每次现取：句柄里的内容哈希就是 Compare-and-Swap 的依据。
        readDocument: () => useSceneStore.getState().document,
        // 提交成功后落盘。用 `commitCandidate`（压一步历史）而不是 `replace`（清历史）。
        writeDocument: (candidate) => useSceneStore.getState().commitCandidate(candidate),
        readSceneDocuments: () => {
          const live = useSceneStore.getState().document
          return [{ handle: handleOf(live), document: live }]
        },
        // 真实 provider 接进来时只换这一行 —— 这也是 `PlannerPort` 存在的理由。
        planner: dependencies.planner ?? createLocalPlanner(),
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

      const live = useSceneStore.getState().document
      const runContext: RunContext = {
        runId,
        conversationId: useAgentStore.getState().activeConversation?.id ?? "local",
        promptMessageId,
        target: handleOf(live),
        sources: [],
        textProfileId: "local-planner",
        capabilityRevision: CAPABILITY_REGISTRY_REVISION,
        policyRevision: "local"
      }

      for await (const event of runtime.coordinator.start({ run: runContext, userMessage: prompt })) {
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
      }

      const phase = runtime.coordinator.phase()
      const draftId = runtime.draftId()

      if (draftId && phase === "awaiting_confirmation") {
        // 草稿**只是视图**（标识 + 计数）；候选文档留在宿主侧，不进聊天记录。
        // 计数由宿主侧的 `preview()` 从**真实文档**算出（界面不自己数）。
        const preview = runtime.host.preview(draftId)
        useAgentStore.getState().recordDraft({
          draftId,
          draftVersion: preview.ok ? preview.artifact.draftVersion : 1,
          previewHash: preview.ok ? preview.artifact.previewHash : "",
          stageCount: preview.ok ? preview.artifact.stageCount : 0,
          undoesInOneStep: true,
          counts: preview.ok ? preview.artifact.counts : undefined,
          baseCounts: preview.ok ? preview.artifact.baseCounts : undefined,
          // 假设在**计划解析成功那一刻**就知道，而草稿是运行结束之后才拿到的 —— 中间没有第二条路。
          assumptions: runtime.assumptions()
        })
        return { phase, draftId }
      }

      if (phase === "waiting") {
        useAgentStore.getState().failPendingReply({
          code: "needs_more_information",
          message: "这一步需要你补充信息。当前没有接入模型服务，本地规划器只认识几条固定指令。",
          retryable: false
        })
      } else if (phase === "failed") {
        const last = runtime.coordinator.ledger().at(-1)
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
