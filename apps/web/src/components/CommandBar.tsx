import { useEffect } from "react"

export type CommandCategoryId = "select" | "create" | "modify" | "annotate" | "inspect" | "export"

export interface CommandDefinition {
  id: string
  label: string
  /** Instruction shown in the status bar while this command is running. */
  prompt?: string
  disabled?: boolean
  disabledReason?: string
}

export interface CommandCategory {
  id: CommandCategoryId
  label: string
  commands: CommandDefinition[]
}

interface CommandBarProps {
  categories: CommandCategory[]
  activeCategory: CommandCategoryId | null
  activeCommand: string | null
  onCategoryChange: (category: CommandCategoryId | null) => void
  onCommandChange: (commandId: string) => void
  onBack: () => void
  onCancel: () => void
}

/** Escape must stay available to text fields, selects and contenteditable regions. */
function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

export function CommandBar({ categories, activeCategory, activeCommand, onCategoryChange, onCommandChange, onBack, onCancel }: CommandBarProps) {
  const active = categories.find((category) => category.id === activeCategory) ?? null
  const commandActive = activeCategory !== null || activeCommand !== null

  useEffect(() => {
    if (!commandActive) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isTextEditingTarget(event.target)) return
      onCancel()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [commandActive, onCancel])

  return <nav className="command-bar" aria-label="工程命令栏">
    <div className="command-bar-primary" role="group" aria-label="任务类别">
      {categories.map((category) => <button
        key={category.id}
        type="button"
        aria-pressed={category.id === activeCategory}
        data-active={category.id === activeCategory}
        onClick={() => onCategoryChange(category.id === activeCategory ? null : category.id)}
      >{category.label}</button>)}
    </div>
    {active && <div className="command-bar-secondary" role="region" aria-label={`${active.label}命令`}>
      <button className="command-bar-back" type="button" onClick={onBack}>返回</button>
      <div className="command-bar-commands" role="group" aria-label={`${active.label}命令列表`}>
        {active.commands.map((command) => <button
          key={command.id}
          type="button"
          aria-pressed={command.id === activeCommand}
          data-active={command.id === activeCommand}
          disabled={command.disabled}
          title={command.disabled ? command.disabledReason : command.prompt}
          onClick={() => onCommandChange(command.id)}
        >{command.label}</button>)}
      </div>
    </div>}
  </nav>
}
