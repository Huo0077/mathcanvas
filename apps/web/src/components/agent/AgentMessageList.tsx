import type { AgentConversation, AgentMessage } from "../../agentStore"
import { formatMessageTime, splitTranscript } from "../../agentTranscript"

/**
 * 展示区：上方预留的**对话结果与代码输出**区域。
 *
 * 代码块单独成栏（等宽字体 + 语言标签 + 复制按钮），因为"能不能把 Agent 给的代码直接拿走"
 * 是这个区域存在的主要理由；散文与代码混在一段里会让人无法整段复制。
 */
interface AgentMessageListProps {
  conversation: AgentConversation | undefined
}

function CopyCodeButton({ code }: { code: string }) {
  return <button
    type="button"
    className="agent-code-copy"
    onClick={() => { void navigator.clipboard?.writeText(code).catch(() => {}) }}
  >复制</button>
}

function AssistantBody({ message }: { message: AgentMessage }) {
  return <>{splitTranscript(message.text).map((section, index) => section.kind === "code"
    ? <div className="agent-code" key={`${message.id}-code-${index}`} data-code-language={section.language}>
      <div className="agent-code-head"><span>{section.language || "code"}</span><CopyCodeButton code={section.code} /></div>
      <pre className="agent-code-body"><code>{section.code}</code></pre>
    </div>
    : <p className="agent-bubble-text" key={`${message.id}-text-${index}`}>{section.text}</p>
  )}</>
}

export function AgentMessageList({ conversation }: AgentMessageListProps) {
  const messages = conversation?.messages ?? []

  return <section className="agent-transcript" aria-label="对话结果" data-empty={messages.length === 0}>
    <div className="agent-transcript-scroll" role="log" aria-label="对话记录" aria-live="polite">
      {messages.length === 0
        ? <div className="agent-empty">
          <h2 className="agent-empty-title">有什么数学问题要一起做？</h2>
          <p className="agent-empty-text">可以把要求写清楚，例如「以 A 为圆心作一个半径 3 的圆，并标出它与直线 l 的交点」。发送第一条指令后，回答、推理过程与代码会显示在这里。</p>
          <ul className="agent-empty-samples">
            <li>作一条过点 A 的抛物线切线</li>
            <li>把正方体沿对角面剖开，标出截面</li>
            <li>给我一段生成平面几何文档的脚本</li>
          </ul>
        </div>
        : <ul className="agent-messages">
          {messages.map((message) => <li className="agent-message" key={message.id} data-message-role={message.role} data-pending={message.pending === true}>
            <div className="agent-message-head">
              <span className="agent-avatar" aria-hidden="true">{message.role === "user" ? "我" : "∑"}</span>
              <span className="agent-message-role">{message.role === "user" ? "你" : "Agent"}</span>
              <time className="agent-message-time">{formatMessageTime(message.createdAt)}</time>
            </div>
            <div className="agent-bubble">
              {message.pending
                ? <p className="agent-bubble-pending" role="status">正在生成回复…</p>
                : message.role === "user"
                  ? <p className="agent-bubble-text">{message.text}</p>
                  : <AssistantBody message={message} />}
            </div>
          </li>)}
        </ul>}
    </div>
  </section>
}
