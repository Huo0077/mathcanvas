import { useEffect, useRef } from "react"

import { composeDemoReply } from "../../agentDemoReply"
import { useAgentStore } from "../../agentStore"
import { AgentComposer } from "./AgentComposer"
import { AgentConversationSidebar } from "./AgentConversationSidebar"
import { AgentMessageList } from "./AgentMessageList"

/**
 * 模块 B：**Agent 工作区**（参考 DSH / Codex 的干净版式）。
 *
 * 骨架自左到右三段：会话侧栏 → 对话结果与代码展示区 → 底部居中的多行输入框。
 * 布局本身交给 `styles/agent.css`（这里只负责结构与状态），因为它要按容器宽度做响应式。
 *
 * 这一轮**没有接入模型服务**：发送后由 `composeDemoReply` 给一条本地占位回复。
 * 之所以仍然把"在途回复"整条链路走完（pending 气泡 + 禁用发送键 + 播报），
 * 是为了让接真实服务时只需要替换那一个函数，界面行为不用重写。
 */
const DEMO_REPLY_DELAY_MS = 320

interface AgentWorkspaceProps {
  onBackToWorkspace: () => void
}

export function AgentWorkspace({ onBackToWorkspace }: AgentWorkspaceProps) {
  const conversations = useAgentStore((state) => state.conversations)
  const activeConversation = useAgentStore((state) => state.activeConversation)
  const activeConversationId = useAgentStore((state) => state.activeConversationId)
  const pendingReplyId = useAgentStore((state) => state.pendingReplyId)
  const createConversation = useAgentStore((state) => state.createConversation)
  const selectConversation = useAgentStore((state) => state.selectConversation)
  const deleteConversation = useAgentStore((state) => state.deleteConversation)
  const sendPrompt = useAgentStore((state) => state.sendPrompt)
  const resolvePendingReply = useAgentStore((state) => state.resolvePendingReply)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** 已经安排过回复的那条 pending 消息：StrictMode 的二次挂载不能让回复发两遍。 */
  const handledRef = useRef<string | null>(null)

  const pendingMessage = pendingReplyId
    ? conversations.flatMap((conversation) => conversation.messages).find((message) => message.id === pendingReplyId)
    : undefined

  useEffect(() => {
    if (!pendingReplyId || handledRef.current === pendingReplyId) return
    handledRef.current = pendingReplyId
    const prompt = activeConversation?.messages.find((message) => message.role === "user")?.text ?? ""
    const timer = globalThis.setTimeout(() => {
      resolvePendingReply(composeDemoReply(prompt))
      // 回复落屏之后滚到底：用户永远先看到最新的一条。
      globalThis.requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }) })
    }, DEMO_REPLY_DELAY_MS)
    return () => globalThis.clearTimeout(timer)
  }, [pendingReplyId, resolvePendingReply, activeConversation])

  return <div className="agent-workspace">
    <AgentConversationSidebar
      conversations={conversations}
      activeId={activeConversation?.id ?? activeConversationId}
      onSelect={selectConversation}
      onCreate={createConversation}
      onDelete={deleteConversation}
    />
    <div className="agent-stage">
      <header className="agent-stage-head">
        <div className="agent-stage-title">
          <h1>{activeConversation?.title ?? "新对话"}</h1>
          <p>{pendingMessage ? "正在生成回复…" : "Agent 工作区 · 对话式作图"}</p>
        </div>
        <div className="agent-stage-actions">
          <button type="button" className="agent-back" onClick={onBackToWorkspace}>返回画布</button>
        </div>
      </header>
      <div className="agent-stage-scroll" ref={scrollRef}>
        <AgentMessageList conversation={activeConversation} />
      </div>
      <div className="agent-stage-composer">
        <AgentComposer onSend={sendPrompt} busy={pendingMessage !== undefined} />
      </div>
    </div>
  </div>
}
