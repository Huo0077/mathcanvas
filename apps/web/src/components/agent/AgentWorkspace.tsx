import { useEffect, useRef } from "react"

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
 * ## 这里**不再自己造回复**
 *
 * 早先这个组件挂一个 `setTimeout` 调 `composeDemoReply(prompt)` 给一条本地占位回复。
 * 那与真实运行是**两套东西**：真实运行产出事件流与草稿状态，而占位回复是一段常量文本。
 * 计划 G2 Gate 明确要求生产路径上不再有演示回复，所以现在改成：
 *
 * - 组件只负责**发起**（调 `onRun(prompt, promptMessageId)`）与**显示**（读 store 里的运行状态）；
 * - 谁去跑、跑出什么，全由注入的 `onRun` 决定 —— App 注入真实的协调器运行时，
 *   测试注入脚本化的运行时。组件这一层**没有任何"如果没有模型就自己编一段"的分支**，
 *   因为那种分支正是把假成功带回生产路径的方式。
 */
interface AgentWorkspaceProps {
  onBackToWorkspace: () => void
  /**
   * 跑一轮真实运行。
   *
   * `promptMessageId` 是这一轮**用户消息的 id**：运行账本与界面消息靠它对应
   *（计划 Step 2 的 "route `sendPrompt` to Coordinator with promptMessageId"）。
   * 返回的 promise 在运行结束时 settle；组件**不**等它（事件是通过 store 回流到界面的）。
   */
  onRun?: (prompt: string, promptMessageId: string) => void | Promise<void>
  /**
   * 用户在草稿预览上点了"确认并提交"。
   *
   * 组件**不**自己提交：它只把这个意图转给上层（`agentRunner.confirm`）。
   * 提交要经过 `HostBridge` 的一次性同意与 Compare-and-Swap，而那两样都不在这一层手里 ——
   * 界面拿得到的最多是"用户点了这个按钮"这个事实。
   *
   * 参数是**用户点的那块面板所属的那一轮**（消息上的 `runId`；Fix round 1 / C2）：
   * 少了它，上层只能猜"最近那一轮"，而在两条会话都暂存过草稿时会提交错的那一份。
   */
  onConfirm?: (runId?: string) => void
  onDiscard?: (runId?: string) => void
  onStop?: (runId?: string) => void
  onRetry?: () => void
}

export function AgentWorkspace({ onBackToWorkspace, onRun, onConfirm, onDiscard, onStop, onRetry }: AgentWorkspaceProps) {
  const conversations = useAgentStore((state) => state.conversations)
  const activeConversation = useAgentStore((state) => state.activeConversation)
  const activeConversationId = useAgentStore((state) => state.activeConversationId)
  const pendingReplyId = useAgentStore((state) => state.pendingReplyId)
  const createConversation = useAgentStore((state) => state.createConversation)
  const selectConversation = useAgentStore((state) => state.selectConversation)
  const deleteConversation = useAgentStore((state) => state.deleteConversation)
  const sendPrompt = useAgentStore((state) => state.sendPrompt)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  /** 已经发起过运行的那条用户消息：StrictMode 的二次挂载不能让同一轮跑两遍。 */
  const startedRef = useRef<string | null>(null)

  const pendingMessage = pendingReplyId
    ? conversations.flatMap((conversation) => conversation.messages).find((message) => message.id === pendingReplyId)
    : undefined

  // 发起运行：只在**出现新的在途消息**时做一次。
  useEffect(() => {
    if (!pendingReplyId || startedRef.current === pendingReplyId) return
    startedRef.current = pendingReplyId
    // 在途助手消息的前一条就是刚才那条用户消息 —— 它的 id 要交给运行账本。
    const messages = activeConversation?.messages ?? []
    const pendingIndex = messages.findIndex((message) => message.id === pendingReplyId)
    const promptMessage = pendingIndex > 0 ? messages[pendingIndex - 1] : undefined
    if (!promptMessage) return
    void onRun?.(promptMessage.text, promptMessage.id)
  }, [pendingReplyId, activeConversation, onRun])

  // 有新内容就滚到底：用户永远先看到最新的一条。
  // `?.()`：`scrollTo` 不是每个环境都有（jsdom 就没有），而"滚动失败"不该把一次渲染炸掉。
  useEffect(() => {
    globalThis.requestAnimationFrame(() => { scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight }) })
  }, [pendingMessage?.trace?.length, pendingMessage?.draft, pendingMessage?.commit, pendingMessage?.failure])

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
          <p>{pendingMessage ? "正在运行…" : "Agent 工作区 · 对话式作图"}</p>
        </div>
        <div className="agent-stage-actions">
          <button type="button" className="agent-back" onClick={onBackToWorkspace}>返回画布</button>
        </div>
      </header>
      <div className="agent-stage-scroll" ref={scrollRef}>
        <AgentMessageList
          conversation={activeConversation}
          onStop={onStop}
          onRetry={onRetry}
          onConfirm={onConfirm}
          onDiscard={onDiscard}
        />
      </div>
      <div className="agent-stage-composer">
        <AgentComposer onSend={sendPrompt} busy={pendingMessage !== undefined} />
      </div>
    </div>
  </div>
}
