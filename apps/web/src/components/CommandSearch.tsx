import { useEffect, useId, useMemo, useRef, useState } from "react"

import { isTextEditingTarget } from "../documentIds"
import { HeaderIcon } from "./HeaderIcon"
import { searchCommands, type SearchableCommand } from "./commandSearchModel"

interface CommandSearchProps {
  commands: readonly SearchableCommand[]
  onRun: (commandId: string) => void
}

/**
 * 顶部搜索框 = **命令面板**（UI/UX 优化规格 §整体工作流）。
 *
 * 以前它只是一个摆设：能打字，但打什么都没反应。现在输入即列出匹配的功能区命令，
 * ↑/↓ 选择、Enter 执行、Esc 清空；Ctrl+K（⌘K）从任何地方把焦点送进来。
 * 命令执行走的是与点 Ribbon 按钮**同一个** `onRun`，所以行为不会分叉。
 *
 * 输入框保留原来的无障碍名字与占位符（"搜索" / "搜索工具、命令或定理..."），既有查询不受影响。
 */
export function CommandSearch({ commands, onRun }: CommandSearchProps) {
  const [query, setQuery] = useState("")
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const results = useMemo(() => searchCommands(commands, query), [commands, query])
  const open = focused && query.trim().length > 0

  useEffect(() => { setActiveIndex(0) }, [query])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (isTextEditingTarget(event.target) && event.target !== inputRef.current) return
      event.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const run = (command: SearchableCommand | undefined) => {
    if (!command || command.disabled) return
    onRun(command.id)
    setQuery("")
    inputRef.current?.blur()
  }

  return <div className="command-search" data-open={open ? "true" : "false"}>
    <label className="search-box"><HeaderIcon name="search" /><input
      ref={inputRef}
      aria-label="搜索"
      placeholder="搜索工具、命令或定理..."
      title="搜索功能区命令（Ctrl+K）"
      value={query}
      aria-autocomplete="list"
      aria-controls={listId}
      aria-activedescendant={open && results[activeIndex] ? `${listId}-${activeIndex}` : undefined}
      onChange={(event) => setQuery(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key === "ArrowDown") { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, Math.max(results.length - 1, 0))) }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)) }
        else if (event.key === "Enter") { event.preventDefault(); run(results[activeIndex]) }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQuery(""); inputRef.current?.blur() }
      }}
    /><kbd className="search-shortcut" aria-hidden="true">Ctrl K</kbd></label>
    {open && <div className="command-search-results" id={listId} role="listbox" aria-label="搜索结果">
      {results.length === 0
        ? <p className="command-search-empty" role="presentation">没有匹配的命令</p>
        : results.map((command, index) => <div
          key={command.id}
          id={`${listId}-${index}`}
          role="option"
          aria-selected={index === activeIndex}
          aria-disabled={command.disabled || undefined}
          className="command-search-option"
          data-active={index === activeIndex ? "true" : "false"}
          title={command.disabled ? command.disabledReason : command.prompt}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActiveIndex(index)}
          onClick={() => run(command)}
        ><span className="command-search-label">{command.label}</span>{command.group && <span className="command-search-group">{command.group}</span>}</div>)}
    </div>}
  </div>
}
