import { HeaderIcon, type HeaderIconName } from "../HeaderIcon"
import type { AgentConversation, AgentMessage } from "../../agentStore"
import { formatMessageTime, splitTranscript } from "../../agentTranscript"
import { highlightCode } from "../../codeHighlight"
import { ConfirmationPanel } from "./ConfirmationPanel"
import { RunStatus } from "./RunStatus"
import { TranscriptText } from "./TranscriptText"
import { proofDraftForScene } from "../../agent/proofViewBinding"
import { useSceneStore } from "../../store"
import { splitImagePrompt } from "../../services/problemImagePrompt"

/**
 * 展示区：上方预留的**对话结果与代码输出**区域。
 *
 * 代码块单独成栏（等宽字体 + 语言标签 + 复制按钮），因为"能不能把 Agent 给的代码直接拿走"
 * 是这个区域存在的主要理由；散文与代码混在一段里会让人无法整段复制。
 *
 * 助手消息下面还挂**运行状态卡**（`RunStatus`）：真实运行的进度、草稿预览与失败原因都在那里。
 * 它与代码块是两件事 —— 代码块讲"Agent 说了什么"，状态卡讲"这一步做到哪了"。
 */
interface AgentMessageListProps {
  conversation: AgentConversation | undefined
  /** 运行状态卡上的动作；不传时只显示状态，不显示按钮。参数是**这条消息所属的那一轮**。 */
  onExample?: (prompt: string) => void
  onRetry?: () => void
  onRevise?: () => void
  onStop?: (runId?: string) => void
  onConfirm?: (runId?: string) => void
  onDiscard?: (runId?: string) => void
}

function CopyCodeButton({ code }: { code: string }) {
  return <button
    type="button"
    className="agent-code-copy"
    onClick={() => { void navigator.clipboard?.writeText(code).catch(() => {}) }}
  >复制</button>
}

function AssistantBody({ message }: { message: AgentMessage }) {
  return <>
    {message.draft?.diagramVerification && message.text.trim() && <small className="agent-run-detail">上方的题设核验针对草稿图形。</small>}
    {splitTranscript(message.text).map((section, index) => section.kind === "code"
    ? <div className="agent-code" key={`${message.id}-code-${index}`} data-code-language={section.language}>
      <div className="agent-code-head"><span>{section.language || "code"}</span><CopyCodeButton code={section.code} /></div>
      {/* 高亮由 `codeHighlight` 的纯函数给出 token，这里只负责着色 ——
          不生成 HTML 字符串，所以代码内容永远不会被当成标记解析。 */}
      <pre className="agent-code-body"><code>{highlightCode(section.code, section.language).map((token, tokenIndex) => <span className={`code-${token.kind}`} key={tokenIndex}>{token.value}</span>)}</code></pre>
    </div>
    : <p className="agent-bubble-text" key={`${message.id}-text-${index}`}><TranscriptText text={section.text} /></p>
  )}</>
}

const examples: { label: string; prompt: string; icon: HeaderIconName; description: string }[] = [
  { label: "探索空间折叠", icon: "cube", description: "矩形折叠后的距离", prompt: "矩形 ABCD 中，AB=4，BC=2。沿 AC 将三角形 ABC 折起 90°，画出折后示意图并求 BD 的长。" },
  { label: "观察函数与切线", icon: "curve", description: "函数图像与切线", prompt: "绘制函数 y = 0.1x³ − 0.7x，并画出它在 x=2 处的切线。" },
  { label: "绘制圆与直线", icon: "grid", description: "圆与直线的交点", prompt: "绘制以原点为圆心、半径为 3 的圆和直线 y=1，标出交点。" },
]

export function AgentMessageList({ conversation, onExample, onRetry, onRevise, onStop, onConfirm, onDiscard }: AgentMessageListProps) {
  const messages = conversation?.messages ?? []
  const document = useSceneStore((state) => state.document)

  return <section className="agent-transcript" aria-label="对话结果" data-empty={messages.length === 0}>
    <div className="agent-transcript-scroll" role="log" aria-label="对话记录" aria-live="polite">
      {messages.length === 0
        ? <div className="agent-empty">
          <h2 className="agent-empty-title">把数学想法，画出来。</h2>
          <p className="agent-empty-text">描述你的问题，或从一个例题开始。</p>
          {onExample && <ul className="agent-empty-samples">
            {examples.map(({ label, prompt, icon, description }) => <li key={label}>
              <button type="button" aria-label={label} onClick={() => onExample(prompt)}><HeaderIcon name={icon} /><span>{label}</span><small>{description}</small></button>
            </li>)}
          </ul>}
        </div>
        : <ul className="agent-messages">
          {messages.map((message) => <li className="agent-message" key={message.id} data-message-role={message.role} data-pending={message.pending === true}>
            <div className="agent-message-head">
              <span className="agent-avatar" aria-hidden="true">
                {message.role === "user" ? "我" : (
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
                    <path d="M12 2L14.3 9.7L22 12L14.3 14.3L12 22L9.7 14.3L2 12L9.7 9.7L12 2Z" />
                  </svg>
                )}
              </span>
              <span className="agent-message-role">{message.role === "user" ? "你" : "AI 助手"}</span>
              <time className="agent-message-time">{formatMessageTime(message.createdAt)}</time>
            </div>
            {message.role === "assistant" && <RunStatus message={message} onRetry={onRetry} onRevise={onRevise} onStop={() => onStop?.(message.runId)} onConfirm={() => onConfirm?.(message.runId)} onDiscard={() => onDiscard?.(message.runId)} />}
            {(message.pending || message.role === "user" || message.text.trim().length > 0) && (
              <div className="agent-bubble">
                {message.pending
                  ? <div className="agent-bubble-pending-wrap">
                      <div className="agent-gemini-shimmer" aria-hidden="true"><span /><span /><span /></div>
                      <p className="agent-bubble-pending" role="status">正在生成回复…</p>
                    </div>
                  : message.role === "user"
                    ? <UserBody text={message.text} />
                    : <AssistantBody message={message} />}
              </div>
            )}
            {message.role === "assistant" && message.draft && <ConfirmationPanel draft={proofDraftForScene(message.draft, message.commit, document)} assumptions={message.draft.assumptions} onConfirm={message.commit ? undefined : () => onConfirm?.(message.runId)} onDiscard={message.commit ? undefined : () => onDiscard?.(message.runId)} />}
          </li>)}
        </ul>}
    </div>
  </section>
}

function UserBody({ text }: { text: string }) {
  const { prompt, imageNotes } = splitImagePrompt(text)
  return <>
    <p className="agent-bubble-text">{prompt}</p>
    {imageNotes && <details className="problem-image-observations">
      <summary>配图参考</summary>
      <p className="agent-bubble-text">{imageNotes}</p>
    </details>}
  </>
}
