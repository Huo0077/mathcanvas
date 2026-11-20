import { useEffect, useRef, useState } from "react"
import { useAgentStore } from "../../agentStore"
import { formatConversationTime } from "../../agentTranscript"
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

function GeminiSparkle({ spinning = false }: { spinning?: boolean }) {
  return (
    <svg
      className={`gemini-sparkle-icon${spinning ? " is-thinking" : ""}`}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2L14.3 9.7L22 12L14.3 14.3L12 22L9.7 14.3L2 12L9.7 9.7L12 2Z" />
    </svg>
  )
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
  const createConversation = useAgentStore((state) => state.createConversation)
  const selectConversation = useAgentStore((state) => state.selectConversation)
  const deleteConversation = useAgentStore((state) => state.deleteConversation)
  const [historyOpen, setHistoryOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const startedRef = useRef<string | null>(null)

  const visibleHistory = conversations.filter(
    (conv) => conv.id === activeConversation?.id || conv.messages.length > 0 || conv.title !== "新对话"
  )
  const pendingMessage = pendingReplyId
    ? conversations.flatMap((c) => c.messages).find((m) => m.id === pendingReplyId)
    : undefined
  // recordDraft 会先把 message.pending 置为 false 但保留 pendingReplyId 等用户确认；
  // 只有真正生成中（pending === true）才锁定输入框与新建对话按钮。
  const isGenerating = pendingMessage?.pending === true

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

  // 新消息/实时思考步骤滚动到底部
  useEffect(() => {
    if (!open) return
    globalThis.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight })
    })
  }, [
    open,
    pendingMessage?.trace?.length,
    pendingMessage?.diagnostics?.length,
    pendingMessage?.draft,
    pendingMessage?.commit,
    pendingMessage?.failure
  ])

  if (!open) return null

  return (
    <aside
      className="copilot-drawer"
      data-copilot-drawer="true"
      aria-label="AI 助手抽屉"
    >
      <header className="copilot-drawer-header">
        <div className="copilot-drawer-title">
          <span className="copilot-drawer-icon"><GeminiSparkle spinning={isGenerating} /></span>
          <span>AI 助手</span>
          <span className="copilot-drawer-badge">同屏共创</span>
        </div>
        <div className="copilot-drawer-actions">
          <button
            type="button"
            className={`copilot-drawer-history${historyOpen ? " is-active" : ""}`}
            aria-label="往期对话"
            aria-pressed={historyOpen}
            title="查看并切换往期对话"
            disabled={isGenerating}
            onClick={() => setHistoryOpen((current) => !current)}
          >
            {`往期 (${visibleHistory.length})`}
          </button>
          <button
            type="button"
            className="copilot-drawer-new"
            aria-label="新建对话"
            title="开启新对话"
            disabled={isGenerating}
            onClick={() => {
              setHistoryOpen(false)
              void createConversation()
            }}
          >
            + 新对话
          </button>
          <button
            type="button"
            className="copilot-drawer-close"
            aria-label="关闭 AI 助手"
            title="关闭 AI 助手"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </header>
      {historyOpen && (
        <section className="copilot-history-panel" aria-label="往期对话列表">
          <div className="copilot-history-head">
            <span>往期对话（点击查看内容并切换）</span>
            <button type="button" className="copilot-history-close" onClick={() => setHistoryOpen(false)}>收起</button>
          </div>
          {visibleHistory.length === 0 ? (
            <p className="copilot-history-empty">暂无历史对话记录。</p>
          ) : (
            <ul className="copilot-history-list">
              {visibleHistory.map((conv) => {
                const isActive = conv.id === activeConversation?.id
                const turns = conv.messages.filter((m) => m.role === "user").length
                const lastPreview = conv.messages.at(-1)?.text?.trim()
                return (
                  <li key={conv.id} className={`copilot-history-item${isActive ? " is-active" : ""}`}>
                    <button
                      type="button"
                      className="copilot-history-open"
                      onClick={() => {
                        void selectConversation(conv.id).then((ok) => {
                          if (ok) setHistoryOpen(false)
                        })
                      }}
                    >
                      <span className="copilot-history-title">{conv.title || "未命名对话"}</span>
                      <span className="copilot-history-meta">
                        {turns > 0 ? `${turns} 轮对话` : conv.title !== "新对话" ? "点击查看详情" : "空白对话"} · {formatConversationTime(conv.updatedAt)}
                      </span>
                      {lastPreview && <span className="copilot-history-preview">{lastPreview}</span>}
                    </button>
                    <button
                      type="button"
                      className="copilot-history-delete"
                      aria-label={`删除对话：${conv.title}`}
                      title="删除该条对话"
                      onClick={() => void deleteConversation(conv.id)}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
      <div className="copilot-drawer-scroll" ref={scrollRef}>
        <AgentMessageList
          conversation={activeConversation}
          onExample={(prompt) => { void sendPrompt(prompt) }}
          onStop={onStop}
          onRetry={onRetry}
          onConfirm={onConfirm}
          onDiscard={onDiscard}
        />
      </div>
      <div className="copilot-drawer-composer">
        <AgentComposer onSend={sendPrompt} busy={isGenerating} />
      </div>
    </aside>
  )
}
