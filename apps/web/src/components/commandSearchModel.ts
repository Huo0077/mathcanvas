export interface SearchableCommand {
  id: string
  label: string
  /** 命令的一句话说明（Ribbon 的 `prompt`），也参与匹配。 */
  prompt?: string
  /** 所在分组名，显示在结果右侧，帮助用户认路（"它原来在『立体与截面』里"）。 */
  group?: string
  disabled?: boolean
  disabledReason?: string
}

const MAX_RESULTS = 8

/** 纯函数：按名称 > 说明 > id 的顺序打分，名称前缀命中最靠前。导出给单测。 */
export function searchCommands(commands: readonly SearchableCommand[], query: string): SearchableCommand[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const scored: Array<{ command: SearchableCommand; score: number; index: number }> = []
  commands.forEach((command, index) => {
    const label = command.label.toLowerCase()
    const score = label.startsWith(needle) ? 0
      : label.includes(needle) ? 1
        : (command.group ?? "").toLowerCase().includes(needle) ? 2
          : (command.prompt ?? "").toLowerCase().includes(needle) ? 3
            : command.id.toLowerCase().includes(needle) ? 4 : -1
    if (score >= 0) scored.push({ command, score, index })
  })
  const seen = new Set<string>()
  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.command)
    .filter((command) => (seen.has(command.id) ? false : (seen.add(command.id), true)))
    .slice(0, MAX_RESULTS)
}
