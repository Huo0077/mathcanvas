import { useEffect, useLayoutEffect, useRef } from "react"
import { primitiveTypeLabels } from "./inspectorLabels"
import type { PrimitiveSpec } from "@draw/dsl"

export interface ContextMenuPosition {
  x: number
  y: number
}
export type ContextMenuTargetPrimitive = Pick<PrimitiveSpec, "id" | "label" | "type" | "visible" | "locked" | "style">

interface ContextMenuProps {
  position: ContextMenuPosition
  targetPrimitive: ContextMenuTargetPrimitive | null
  onClose: () => void
  onRename?: () => void
  onToggleVisibility?: () => void
  onToggleLock?: () => void
  onDelete?: () => void
  onInspectDependencies?: () => void
  onColorChange?: (color: string) => void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  onSelectAll?: () => void
  onSelectTool?: (tool: "point" | "segment" | "circle") => void
}

const PRESET_COLORS = [
  { value: "#2c3e50", label: "板岩黑" },
  { value: "#2563eb", label: "经典蓝" },
  { value: "#dc2626", label: "警示红" },
  { value: "#16a34a", label: "几何绿" },
  { value: "#d97706", label: "暖琥珀" },
  { value: "#9333ea", label: "优雅紫" },
]

const icons = {
  rename: <path d="m4 16-1 5 5-1L20 8l-4-4Zm10-10 4 4" />,
  eye: <><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 7.5-2" /></>,
  dependencies: <><rect x="9" y="3" width="6" height="5" rx="1" /><rect x="3" y="16" width="6" height="5" rx="1" /><rect x="15" y="16" width="6" height="5" rx="1" /><path d="M12 8v4m-6 4v-4h12v4" /></>,
  delete: <path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" />,
  undo: <path d="m9 5-6 6 6 6M3 11h11a6 6 0 0 1 6 6v2" />,
  redo: <path d="m15 5 6 6-6 6m6-6H10a6 6 0 0 0-6 6v2" />,
  point: <circle cx="12" cy="12" r="3" />,
  segment: <path d="m5 19 14-14M3 19h4m10-14h4" />,
  circle: <circle cx="12" cy="12" r="8" />,
  select: <path d="M3 8V3h5m8 0h5v5m0 8v5h-5m-8 0H3v-5" />,
}

interface MenuAction {
  icon: keyof typeof icons
  label: string
  run?: () => void
  shortcut?: string
  disabled?: boolean
  danger?: boolean
}

export function ContextMenu({ position, targetPrimitive, onClose, onRename, onToggleVisibility, onToggleLock, onDelete, onInspectDependencies, onColorChange, canUndo = true, canRedo = true, onUndo, onRedo, onSelectAll, onSelectTool }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const place = () => {
      const margin = 8
      menu.style.left = Math.max(margin, Math.min(position.x, window.innerWidth - menu.offsetWidth - margin)) + "px"
      menu.style.top = Math.max(margin, Math.min(position.y, window.innerHeight - menu.offsetHeight - margin)) + "px"
    }
    place()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place)
    observer?.observe(menu)
    window.addEventListener("resize", place)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", place)
    }
  }, [position])

  useLayoutEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    menuRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener("pointerdown", closeOutside, true)
    return () => window.removeEventListener("pointerdown", closeOutside, true)
  }, [onClose])

  const groups: MenuAction[][] = targetPrimitive
    ? [
      [
        { icon: "rename", label: "重命名", shortcut: "F2", run: onRename },
        { icon: "eye", label: targetPrimitive.visible === false ? "显示对象" : "隐藏对象", run: onToggleVisibility },
        { icon: targetPrimitive.locked ? "unlock" : "lock", label: targetPrimitive.locked ? "解锁几何位置" : "锁定几何位置", run: onToggleLock },
        { icon: "dependencies", label: "查看从属依赖拓扑", run: onInspectDependencies },
      ],
      [{ icon: "delete", label: "级联删除", shortcut: "Del", run: onDelete, disabled: targetPrimitive.locked, danger: true }],
    ]
    : [
      [
        { icon: "undo", label: "撤销", shortcut: "Ctrl+Z", run: onUndo, disabled: !canUndo },
        { icon: "redo", label: "重做", shortcut: "Ctrl+Y", run: onRedo, disabled: !canRedo },
      ],
      onSelectTool ? [
        { icon: "point", label: "绘制点", run: () => onSelectTool("point") },
        { icon: "segment", label: "绘制线段", run: () => onSelectTool("segment") },
        { icon: "circle", label: "绘制圆", run: () => onSelectTool("circle") },
      ] : [],
      [{ icon: "select", label: "全选图元", shortcut: "Ctrl+A", run: onSelectAll }],
    ]

  return <div
    ref={menuRef}
    className="canvas-context-menu"
    role="menu"
    aria-label="画布上下文菜单"
    tabIndex={-1}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
        previousFocus.current?.focus({ preventScroll: true })
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault()
        event.stopPropagation()
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"))
        if (!items.length) return
        const current = items.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
          : event.key === "ArrowDown" ? (current + 1) % items.length
          : (current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length)
        items[next]?.focus()
      }
    }}
    onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget) onClose()
    }}
  >
    <div className="context-menu-header" role="presentation">
      <span className="context-menu-title" title={targetPrimitive?.id}>{targetPrimitive?.label ?? targetPrimitive?.id ?? "几何画布"}</span>
      <span className="context-menu-badge">{targetPrimitive ? primitiveTypeLabels[targetPrimitive.type] ?? targetPrimitive.type : "全局"}</span>
    </div>
    {targetPrimitive && onColorChange && <div className="context-menu-color-row" role="group" aria-label="快捷颜色">
      {PRESET_COLORS.map((color) => <button key={color.value} type="button" className="context-menu-color-swatch"
        style={{ backgroundColor: color.value }} title={color.label} aria-label={color.label}
        aria-pressed={targetPrimitive.style?.stroke === color.value}
        onClick={() => { onColorChange(color.value); onClose() }}
      />)}
    </div>}
    {groups.map((group) => group.some((action) => action.run) && <div key={group[0].icon} className="context-menu-group" role="group">
      {group.filter((action) => action.run).map((action) => <button key={action.icon} type="button" role="menuitem" disabled={action.disabled}
        className={`context-menu-item${action.danger ? " is-danger" : ""}`}
        onClick={() => { action.run?.(); onClose() }}
      >
        <svg className="context-menu-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[action.icon]}</svg>
        <span className="context-menu-item-label">{action.label}</span>
        {action.shortcut && <kbd className="context-menu-item-shortcut" aria-hidden="true">{action.shortcut}</kbd>}
      </button>)}
    </div>)}
  </div>
}
