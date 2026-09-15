import { useEffect, useRef, type ReactNode } from "react"

import type { RibbonCommand, RibbonGroup, RibbonIcon, RibbonTabId } from "../uiState"

export type { RibbonCommand, RibbonGroup, RibbonIcon, RibbonTabId }

interface RibbonProps {
  groups: RibbonGroup[]
  activeTab: RibbonTabId | null
  expanded: boolean
  pinned: boolean
  onTabChange: (tab: RibbonTabId | null) => void
  onCommand: (commandId: string) => void
  onExpandedChange: (expanded: boolean) => void
  onPinnedChange: (pinned: boolean) => void
  showControls?: boolean
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

function RibbonGlyph({ name }: { name: RibbonIcon }): ReactNode {
  const paths: Record<RibbonIcon, ReactNode> = {
    select: <path d="m5 4 10 8-5 1 3 6-2 1-3-6-3 4Z" />,
    point: <circle cx="12" cy="12" r="4" />,
    line: <path d="m5 19 14-14M5 5h3M16 19h3" />,
    segment: <path d="m6 18 12-12M5 18h3M16 6h3" />,
    ray: <path d="m5 19 14-14M15 5h4v4" />,
    polyline: <path d="m4 17 5-8 5 5 6-8M4 17h.01M9 9h.01M14 14h.01M20 6h.01" />,
    circle: <circle cx="12" cy="12" r="7" />,
    arc: <path d="M5 16a8 8 0 0 1 12-9M5 16h4M5 16l2-4" />,
    parabola: <path d="M6 5c8 2 8 12 0 14M18 5c-8 2-8 12 0 14" />,
    ellipse: <ellipse cx="12" cy="12" rx="8" ry="5" />,
    hyperbola: <path d="M5 5c4 4 4 10 0 14M19 5c-4 4-4 10 0 14" />,
    function: <path d="M4 17c3-8 6-10 9-5s5 4 7-5M4 20h16" />,
    text: <path d="M5 5h14M12 5v14M8 19h8" />,
    quiz: <><path d="M8 8a4 4 0 1 1 6 3c-2 1-2 2-2 3" /><path d="M12 18h.01" /></>,
    pen: <path d="m5 19 3.5-.8L19 7.7a2 2 0 0 0-2.8-2.8L5.7 15.4Z" />,
    delete: <><path d="M5 7h14M10 4h4l1 3H9Z" /><path d="M7 7v13h10V7M10 10v7M14 10v7" /></>,
    lock: <><rect x="6" y="10" width="12" height="10" rx="2" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>,
    svg: <><path d="M7 4h8l3 3v13H7Z" /><path d="M15 4v4h4M10 14l2 2 4-5" /></>,
    csv: <><path d="M5 4h14v16H5Z" /><path d="M5 9h14M10 9v11M15 9v11" /></>,
    png: <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m5 17 4-4 3 3 2-2 5 4" /></>
  }
  return <svg className="ribbon-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

export function Ribbon({ groups, activeTab, expanded, pinned, onTabChange, onCommand, onExpandedChange, onPinnedChange, showControls = true }: RibbonProps) {
  const visible = expanded || activeTab !== null
  const ribbonRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F1" || !(event.ctrlKey || event.metaKey) || event.altKey || isTextEditingTarget(event.target)) return
      event.preventDefault()
      onExpandedChange(!expanded)
      if (expanded) onTabChange(null)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [expanded, onExpandedChange, onTabChange])

  useEffect(() => {
    if (expanded || !activeTab || pinned) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-ribbon-control]")) return
      if (!ribbonRef.current?.contains(event.target as Node)) onTabChange(null)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [activeTab, expanded, onTabChange, pinned])

  return <section ref={ribbonRef} className={`ribbon ${visible ? "is-visible" : "is-collapsed"} ${expanded ? "is-expanded" : "is-floating"}`} data-ribbon-expanded={expanded ? "true" : "false"} data-ribbon-pinned={pinned ? "true" : "false"} aria-label="功能区">
    {showControls && <div className="ribbon-controls" role="toolbar" aria-label="功能区控制">
      <button type="button" className="ribbon-control" aria-label={expanded ? "收起功能区" : "展开功能区"} onClick={() => { onExpandedChange(!expanded); if (expanded) onTabChange(null) }}><span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button>
      <button type="button" className={`ribbon-control ${pinned ? "is-active" : ""}`} aria-label={pinned ? "取消固定功能区" : "固定功能区"} aria-pressed={pinned} onClick={() => onPinnedChange(!pinned)}><span aria-hidden="true">{pinned ? "●" : "○"}</span></button>
    </div>}
    {visible && <div className="ribbon-body">
      {groups.map((group) => <div className="ribbon-group" key={group.id} data-ribbon-group={group.id}>
        <div className="ribbon-group-commands">{group.commands.map((command) => <button key={command.id} type="button" className="ribbon-command" aria-label={command.label} title={command.disabled ? command.disabledReason : command.prompt} disabled={command.disabled} onClick={() => { onCommand(command.id); if (!expanded && !pinned) onTabChange(null) }}><RibbonGlyph name={command.icon} /><span>{command.label}</span></button>)}</div>
        <span className="ribbon-group-label">{group.label}</span>
      </div>)}
    </div>}
  </section>
}
