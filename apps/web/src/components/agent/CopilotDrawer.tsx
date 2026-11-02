import { useEffect, useRef } from "react"
import { useAgentStore } from "../../agentStore"
import { AgentComposer } from "./AgentComposer"
import { AgentMessageList } from "./AgentMessageList"

export interface CopilotDrawerProps {
  open: boolean
  onClose: () => void
  onRun?: (prompt: string, promptMessageId: string) => void | Promise<void>
  onConfirm?: (runId?: string) => void
  onDiscard?: (runId?: string) => void
  onStop?: (runId?: string) => void
  onRetry?: () => void
}

/**
 * AI Copilot 同屏人机共创抽屉（规格 §7.1）。
 * 与几何画布同屏并存，不卸载画布，支持边看图边对话与交互检视。
 */
export function CopilotDrawer({
  open,
  onClose,
  onRun,
  onConfirm,
  onDiscard,
  onStop,
  onRetry
}: CopilotDrawerProps) {
  const conversations = useAgentStore((state) => state.conversations)
  const activeConversation = useAgentStore((state) => state.activeConversation)
  const pendingReplyId = useAgentStore((state) => state.pendingReplyId)
  const sendPrompt = useAgentStore((state) => state.sendPrompt)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const startedRef = useRef<string | null>(null)

  const pendingMessage = pendingReplyId
    ? conversations.flatMap((c) => c.messages).find((m) => m.id === pendingReplyId)
    : undefined

  // 侦听未结束的在途消息发起运行
  useEffect(() => {
    if (!open || !pendingReplyId || pendingMessage?.runId || startedRef.current === pendingReplyId) return
    startedRef.current = pendingReplyId
    const messages = activeConversation?.messages ?? []
    const pendingIndex = messages.findIndex((m) => m.id === pendingReplyId)
    const promptMessage = pendingIndex > 0 ? messages[pendingIndex - 1] : undefined
    if (!promptMessage) return
    void onRun?.(promptMessage.text, promptMessage.id)
  }, [open, pendingReplyId, pendingMessage?.runId, activeConversation, onRun])

  // 新消息滚动到底部
  useEffect(() => {
    if (!open) return
    globalThis.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight })
    })
  }, [open, pendingMessage?.trace?.length, pendingMessage?.draft, pendingMessage?.commit, pendingMessage?.failure])

  if (!open) return null

  return (
    <aside
      className="copilot-drawer"
      data-copilot-drawer="true"
      aria-label="AI 助手抽屉"
    >
      <header className="copilot-drawer-header">
        <div className="copilot-drawer-title">
          <span className="copilot-drawer-icon" aria-hidden="true">✨</span>
          <span>AI 助手</span>
          <span className="copilot-drawer-badge">同屏共创</span>
        </div>
        <button
          type="button"
          className="copilot-drawer-close"
          aria-label="关闭 AI 助手"
          title="关闭 AI 助手"
          onClick={onClose}
        >
          ✕
        </button>
      </header>
      <div className="copilot-drawer-scroll" ref={scrollRef}>
        <AgentMessageList
          conversation={activeConversation}
          onStop={onStop}
          onRetry={onRetry}
          onConfirm={onConfirm}
          onDiscard={onDiscard}
        />
      </div>
      <div className="copilot-drawer-composer">
        <AgentComposer onSend={sendPrompt} busy={pendingMessage !== undefined} />
      </div>
    </aside>
  )
}
