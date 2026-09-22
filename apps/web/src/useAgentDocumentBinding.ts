import { useEffect } from "react"

import type { GeometryDocument } from "@draw/dsl"

import { useAgentStore } from "./agentStore"
import { useSceneStore } from "./store"

/**
 * **把 Agent 的会话绑定钉在当前文档上**（Fix round 1 / C1；规格 §5.1）。
 *
 * ## 为什么必须在生产路径上做这件事
 *
 * §5.1："一个会话绑定一个 projectId、documentId 和 workspace"。这个应用里换工作区**就是换文档**
 *（`switchWorkspace` 换掉 `document`，第一次访问还会新建一份），而在这个函数存在之前，
 * 没有任何生产代码调过 `setBinding` —— 于是每条会话都写在占位绑定 `{local, local, conics}` 上，
 * 而在立体几何里确认的事实会被注入平面几何那一轮（§9 门的"会话之间不串事实"）。
 *
 * ## 两条例外，各自有理由
 *
 * 1. **Agent 自己为执行计划切的工作区不算用户换上下文**（`documentChangeReason === "agent"`）。
 *    "建一个立方体"会切到立体几何，而那一刻用户正在读的那条会话里往往还挂着一份等待确认的草稿 ——
 *    跟着换列表会把草稿面板一起换走（用户看到的是"我的对话没了"）。
 *    Agent 既然已经把会话与文档钉在运行开始时（§5.4），这里就**不跟**；等用户自己换文档时再跟。
 * 2. **未结束的一轮不换**：有在途回复 / 等待确认的草稿时先不动，等这一轮落地
 *    （effect 会在那时再跑一次）。否则运行的事件与草稿会落到一条不在列表里的会话上。
 */
export function useAgentDocumentBinding(document: GeometryDocument, projectId = "local"): void {
  // 有未结束的一轮（在途回复 / 等待确认的草稿）时不动绑定。
  const busy = useAgentStore((state) => state.pendingReplyId !== null)
  const reason = useSceneStore((state) => state.documentChangeReason)
  const documentId = document.metadata.id
  const workspace = document.workspace

  useEffect(() => {
    if (busy) return
    // 只有 Agent 面向的三个工作区才有会话绑定（`calculus` 已退役，见 WorkspaceId）。
    if (workspace !== "conics" && workspace !== "geometry3d" && workspace !== "cad") return
    const current = useAgentStore.getState().binding
    if (current.projectId === projectId && current.documentId === documentId && current.workspace === workspace) return
    /**
     * **Agent 自己切的工作区不换列表**（见文件头第 1 条）。
     *
     * 判断放在"要不要换"之后：绑定已经是这一份文档时什么都不用做（例如用户手动切回 Agent
     * 执行过的那份工作区，文档没变），只有真的要换时才需要看是谁引起的。
     */
    if (reason === "agent") return
    void useAgentStore.getState().setBinding({ projectId, documentId, workspace })
  }, [busy, documentId, workspace, projectId, reason])
}
