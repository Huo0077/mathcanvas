import type { AgentConversation } from "../../agentStore"
import { formatConversationTime } from "../../agentTranscript"

/**
 * Agent 区的对话列表（参考 Codex / DSH 的会话侧栏）：新建、切换、删除。
 *
 * 删除按钮单独出现（不与列表行嵌套）：一个按钮里套一个按钮在 HTML 里是非法的，
 * 而且"点行 = 切换对话"和"点 × = 删掉对话"是两种完全不同的破坏性操作，必须分得开。
 */
interface AgentConversationSidebarProps {
  conversations: AgentConversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function AgentConversationSidebar({ conversations, activeId, onSelect, onCreate, onDelete }: AgentConversationSidebarProps) {
  return <aside className="agent-sidebar" aria-label="对话列表">
    <div className="agent-sidebar-head">
      <span className="agent-sidebar-title">对话</span>
      <button type="button" className="agent-new-chat" onClick={onCreate}>新建对话</button>
    </div>
    <ul className="agent-conversations">
      {conversations.map((conversation) => <li key={conversation.id} className="agent-conversation" data-active={conversation.id === activeId}>
        <button type="button" className="agent-conversation-open" aria-pressed={conversation.id === activeId} onClick={() => onSelect(conversation.id)}>
          <span className="agent-conversation-name">{conversation.title}</span>
          <span className="agent-conversation-meta">{conversation.messages.length > 0 ? `${conversation.messages.filter((message) => message.role === "user").length} 轮` : "空对话"} · {formatConversationTime(conversation.updatedAt)}</span>
        </button>
        <button type="button" className="agent-conversation-delete" aria-label={`删除对话：${conversation.title}`} title={`删除对话：${conversation.title}`} onClick={() => onDelete(conversation.id)}>×</button>
      </li>)}
    </ul>
  </aside>
}
