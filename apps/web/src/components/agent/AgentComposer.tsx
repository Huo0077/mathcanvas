import { useRef, useState } from "react"

/**
 * Agent 区的输入框：整块界面的**视觉焦点**（页面中央），支持多行输入。
 *
 * 快捷键按 Codex / DSH 的通行做法：Enter 发送、Shift+Enter 换行。
 * 中文输入法必须能被正确对待——组合期间的 Enter 是"选字"，不是"发送"，
 * 所以 `compositionstart/end` 期间一律放过按键，否则打一个"切线"就会误发两次。
 */
interface AgentComposerProps {
  /**
   * 发送。
   *
   * 返回值是"这条指令被接受了吗"：`false`（或一个 resolve 成 `false` 的 promise）时
   * **输入框不清空**，并显示一句可照做的说明（Fix round 1 / Minor 1）。
   * 不返回结果（`undefined`）时按老口径清空 —— 老调用方与只关心"我发了什么"的用例不受影响。
   */
  onSend: (prompt: string) => void | boolean | Promise<boolean>
  /** 有回复在途：发送键变成"回复中"并禁用，避免连点发出重复指令。 */
  busy?: boolean
  disabled?: boolean
}

export function AgentComposer({ onSend, busy = false, disabled = false }: AgentComposerProps) {
  const [value, setValue] = useState("")
  const [refusal, setRefusal] = useState<string | null>(null)
  const composingRef = useRef(false)
  const canSend = value.trim().length > 0 && !busy && !disabled

  const submit = () => {
    if (!canSend) return
    setRefusal(null)
    const outcome = onSend(value)
    /**
     * **被拒时把话还给用户**：`sendPrompt` 会因为"内容像密钥"或"保存失败"而拒绝，
     * 而输入框原先在按下发送的那一刻就清空了 —— 用户看到的是自己的指令凭空消失。
     */
    const refuse = () => setRefusal("这条指令没有被接受（可能是内容里含密钥样串，或者没能保存）。输入还留着，改一改再发一次。")
    if (outcome === undefined) { setValue(""); return }
    if (typeof outcome === "boolean") { if (outcome) setValue(""); else refuse(); return }
    void outcome.then((accepted) => { if (accepted) setValue(""); else refuse() }).catch(() => refuse())
  }

  return <form className="agent-composer" aria-label="对话输入框" onSubmit={(event) => { event.preventDefault(); submit() }}>
    <textarea
      className="agent-composer-input"
      aria-label="对话输入"
      rows={1}
      value={value}
      placeholder="描述你要做的几何图形或数学问题…（Enter 发送，Shift + Enter 换行）"
      onChange={(event) => setValue(event.target.value)}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" || event.shiftKey || composingRef.current || event.nativeEvent.isComposing) return
        event.preventDefault()
        submit()
      }}
    />
    <div className="agent-composer-bar">
      <p className="agent-composer-hint" id="agent-composer-hint">Enter 发送 · Shift + Enter 换行 · 结果与代码会显示在上方</p>
      <button type="submit" className="agent-send" name="send" disabled={!canSend}>{busy ? "回复中" : "发送"}</button>
    </div>
    {busy && <p className="agent-composer-status" role="status">正在生成回复…</p>}
    {refusal && <p className="agent-composer-refusal" role="alert">{refusal}</p>}
  </form>
}
