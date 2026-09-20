/**
 * **WinAnsi 文本损失**（Task 2.4 Step 3 的 `interaction.propose_export` 需要）。
 *
 * WinAnsi 是 DXF（以及 PDF 里的标准字体）实际使用的编码：可打印 ASCII 与 Latin-1 补充区能过，
 * 中文、CJK 标点、emoji 一律过不去。不可编码的字符必须被替换，否则 `drawText` 会抛编码错误、
 * **整份导出失败** —— 只要图纸里有一条中文诊断就导不出来（实测过）。
 *
 * ## 为什么这段规则放在 `@draw/agent-core`
 *
 * 它原先只写在 `apps/web/src/persistence/engineeringExporters.ts` 里，但**导出预检**也要报同一条损失：
 * 界面要告诉用户"这些字会被写成 `?`"，而 Agent 侧提出导出建议时必须说同样的话。
 * 两处各写一份必然分叉，而分叉的症状是**界面说有损失、Agent 说没有** ——
 * 用户按 Agent 的说法确认，结果文件里一片 `?`。这个项目已经因为"同一个判断写两遍"吃过三次亏。
 *
 * 依赖方向是 `@draw/web → @draw/agent-core`，所以中立点在这里，app 侧从这里导入。
 */

/** 不可编码字符的替换字符。用一个 ASCII 的问号而不是 U+FFFD，因为后者也过不了 WinAnsi。 */
export const WIN_ANSI_SUBSTITUTE = "?"

/** 把一个字符串压成 WinAnsi 能承载的形式。 */
export function winAnsiSafe(text: string): string {
  let safe = ""
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    // 可打印 ASCII + Latin-1 补充区是 WinAnsi 的子集；C1 控制区与所有非拉丁字符一律替换。
    safe += (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? character : WIN_ANSI_SUBSTITUTE
  }
  return safe
}

export interface FontLoss {
  original: string
  substituted: string
  reason: string
}

/**
 * 收集一批带 `label` 的对象里会被写坏的文字。
 *
 * 只报**真的会变**的那些（`winAnsiSafe(label) !== label`），否则一份全中文的图纸会报出
 * 每一条无变化的标签，把"有损失"变成噪音。同一条原文只报一次：用户要的是一份"哪些字打不出来"的
 * 清单，不是"有多少个对象叫这个名字"。
 */
export function collectWinAnsiLoss(entities: readonly { label?: string }[], reason = "DXF text is encoded as WinAnsi"): FontLoss[] {
  const losses = new Map<string, FontLoss>()
  for (const entity of entities) {
    const label = entity.label
    if (!label) continue
    const substituted = winAnsiSafe(label)
    if (substituted !== label && !losses.has(label)) losses.set(label, { original: label, substituted, reason })
  }
  return [...losses.values()]
}
