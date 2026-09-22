import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { useAgentStore } from "./agentStore"
import { useSceneStore } from "./store"
import { DEFAULT_CONVERSATION_BINDING, createConversationRepository, setConversationRepository } from "./conversationRepository"
import { useAgentDocumentBinding } from "./useAgentDocumentBinding"

/**
 * **会话绑定跟着文档走**（Fix round 1 / C1；规格 §5.1）。
 *
 * "一个会话绑定一个 projectId、documentId 和 workspace" —— 而这个应用里换工作区**就是换文档**
 * （`switchWorkspace` 换掉 `document`，第一次访问还会新建一份）。所以"当前在 Agent 里说话的是
 * 哪条会话"必须跟着文档走：否则所有会话都写在占位绑定 `{local, local, conics}` 上，
 * 而在立体几何里确认的事实会被注入平面几何那一轮（§9 门的"会话之间不串事实"）。
 *
 * 这一层是**生产接线**（`App.tsx` 调它），所以它在生产路径上被测：两份文档各自一份列表，
 * 切回去历史还在。
 */
describe("agent conversation binding", () => {
  beforeEach(() => {
    localStorage.clear()
    setConversationRepository(null)
    useSceneStore.setState({ documentChangeReason: "user" })
    const conversation = useAgentStore.getState().conversations[0] ?? null
    useAgentStore.setState({
      conversations: conversation ? [conversation] : [],
      activeConversation: conversation ?? undefined,
      activeConversationId: null,
      pendingReplyId: null,
      binding: DEFAULT_CONVERSATION_BINDING
    })
  })

  it("follows the document: two documents keep two separate conversation lists", async () => {
    const planar = createEmptyDocument("conics")
    const spatial = createEmptyDocument("geometry3d")

    const { rerender } = renderHook(({ document }) => useAgentDocumentBinding(document), { initialProps: { document: planar } })

    // 第一份文档：绑定钉在它上面，在这里说的话属于它。
    await waitFor(() => expect(useAgentStore.getState().binding.documentId).toBe(planar.metadata.id))
    useAgentStore.getState().sendPrompt("平面几何里的一句话")
    // 这一轮结束之后才换文档（未结束的一轮会**推迟**换绑定，见下面那条用例）。
    useAgentStore.getState().resolvePendingReply("好的。")

    // 换到另一份文档（换工作区）：列表换成它的，另一份文档的话不在这里。
    rerender({ document: spatial })
    await waitFor(() => expect(useAgentStore.getState().binding.documentId).toBe(spatial.metadata.id))
    expect(useAgentStore.getState().binding.workspace).toBe("geometry3d")
    expect(useAgentStore.getState().conversations.flatMap((conversation) => conversation.messages)).toEqual([])

    useAgentStore.getState().sendPrompt("立体几何里的一句话")
    useAgentStore.getState().resolvePendingReply("好的。")

    // 切回去：那一份文档的列表与历史原样还在。
    rerender({ document: planar })
    await waitFor(() => expect(useAgentStore.getState().binding.documentId).toBe(planar.metadata.id))
    expect(useAgentStore.getState().conversations.flatMap((conversation) => conversation.messages).map((message) => message.text)).toEqual(["平面几何里的一句话", "好的。"])
  })

  it("does not pull the conversation out from under a run that is still waiting for the user", async () => {
    const planar = createEmptyDocument("conics")
    const spatial = createEmptyDocument("geometry3d")

    const { rerender } = renderHook(({ document }) => useAgentDocumentBinding(document), { initialProps: { document: planar } })
    await waitFor(() => expect(useAgentStore.getState().binding.documentId).toBe(planar.metadata.id))

    /**
     * Agent 自己会为了执行计划**切工作区**（"建一个立方体"要切到立体几何），
     * 而那一刻用户正在看的这条会话里还挂着一份等待确认的草稿。
     * 这时候换绑定会把草稿面板一起换走 —— 用户看到的是"我的对话没了"。
     * 所以有未结束的一轮时**推迟**，等它落地（回执/丢弃）再切。
     */
    useAgentStore.getState().sendPrompt("建一个立方体")
    const conversationId = useAgentStore.getState().activeConversation!.id
    useAgentStore.getState().recordDraft({ draftId: "draft-1", draftVersion: 1, previewHash: "h", stageCount: 1, undoesInOneStep: true })

    rerender({ document: spatial })
    await Promise.resolve()
    expect(useAgentStore.getState().binding.documentId).toBe(planar.metadata.id)
    expect(useAgentStore.getState().activeConversation?.id).toBe(conversationId)

    // 这一轮结束（用户确认）之后再切：绑定与列表跟上当前文档。
    useAgentStore.getState().recordReceipt({ status: "committed" })
    await waitFor(() => expect(useAgentStore.getState().binding.documentId).toBe(spatial.metadata.id))
  })

  /**
   * **Agent 自己切的工作区不换列表**（Fix round 1 / C1 的第二条例外）。
   *
   * "建一个立方体"会让 Agent 把画布切到立体几何（= 另一份文档），而那一刻用户正在读的
   * 那条会话里还挂着一份等待确认的草稿。跟着换列表 = 草稿面板一起消失，
   * 用户看到的是"我的对话没了"（`e2e/agent-flow.spec.ts` 当场抓到的正是这个）。
   * 用户**自己**换文档时才跟（下一条用例覆盖）。
   */
  it("does not follow a workspace switch the agent made for its own plan", async () => {
    const planar = createEmptyDocument("conics")
    const spatial = createEmptyDocument("geometry3d")

    const { rerender } = renderHook(({ document }) => useAgentDocumentBinding(document), { initialProps: { document: planar } })
    await waitFor(() => expect(useAgentStore.getState().binding.documentId).toBe(planar.metadata.id))
    useAgentStore.getState().sendPrompt("建一个棱长 3 的立方体")
    useAgentStore.getState().resolvePendingReply("好的。")

    // Agent 自己切的（`prepareWorkspaceFor` 就是带上这个理由调的）。
    useSceneStore.setState({ documentChangeReason: "agent" })
    rerender({ document: spatial })
    await Promise.resolve()

    expect(useAgentStore.getState().binding.documentId).toBe(planar.metadata.id)

    // 用户**自己**再换一次文档：这时候才跟。
    const cad = createEmptyDocument("cad")
    useSceneStore.setState({ documentChangeReason: "user" })
    rerender({ document: cad })
    await waitFor(() => expect(useAgentStore.getState().binding.documentId).toBe(cad.metadata.id))
  })

  /**
   * **慢的那次绑定读不许盖掉新的一次**（Fix round 1：e2e 在真实浏览器里抓到的竞态）。
   *
   * 应用启动时那一次绑定要读一份文档的列表，而用户可能立刻切了工作区（= 换文档）——
   * 两次读的回来顺序不保证。慢的那一次后到，就会把绑定与列表按**旧文档**写下去：
   * 界面在立体几何里，而会话全写在平面几何那份绑定上，下一次绑定刷新时它们就"消失"了。
   */
  it("ignores a stale binding load when the document changed while it was in flight", async () => {
    const planar = createEmptyDocument("conics")
    const spatial = createEmptyDocument("geometry3d")
    const settle: (() => void)[] = []
    setConversationRepository({
      ...createConversationRepository(),
      loadList: (binding) => new Promise((resolve) => {
        settle.push(() => resolve([{ id: `conversation-${binding.documentId}`, title: "x", createdAt: 1, updatedAt: 1, messages: [] }]))
      })
    })

    const { rerender } = renderHook(({ document }) => useAgentDocumentBinding(document), { initialProps: { document: planar } })
    await waitFor(() => expect(settle).toHaveLength(1))
    // 第一次读还没回来，用户就换了文档（= 换工作区）。
    rerender({ document: spatial })
    await waitFor(() => expect(settle).toHaveLength(2))

    // 放行顺序故意反过来：**新**的那次先回来，旧的那次后回来。
    settle[1]!()
    await waitFor(() => expect(useAgentStore.getState().binding.documentId).toBe(spatial.metadata.id))
    settle[0]!()
    await Promise.resolve()

    // 旧的那次结果被丢掉：绑定与列表仍然是**新**文档那一份。
    expect(useAgentStore.getState().binding.documentId).toBe(spatial.metadata.id)
    expect(useAgentStore.getState().conversations.map((conversation) => conversation.id)).toEqual([`conversation-${spatial.metadata.id}`])
  })
})
