import { useEffect, useRef } from "react"
import { primitiveTypeLabels } from "./inspectorLabels"
import type { PrimitiveSpec } from "@draw/dsl"

export interface ContextMenuPosition {
  x: number
  y: number
}

export interface ContextMenuTargetPrimitive {
  id: string
  label?: string
  type: PrimitiveSpec["type"]
  visible?: boolean
  locked?: boolean
  style?: { stroke?: string; fill?: string; strokeWidth?: number; opacity?: number; dash?: string }
}

export interface ContextMenuProps {
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

export function ContextMenu({
  position,
  targetPrimitive,
  onClose,
  onRename,
  onToggleVisibility,
  onToggleLock,
  onDelete,
  onInspectDependencies,
  onColorChange,
  canUndo = true,
  canRedo = true,
  onUndo,
  onRedo,
  onSelectAll,
  onSelectTool,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDownOutside = (event: MouseEvent | PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
      }
    }

    window.addEventListener("pointerdown", handlePointerDownOutside, true)
    window.addEventListener("keydown", handleKeyDown, true)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDownOutside, true)
      window.removeEventListener("keydown", handleKeyDown, true)
    }
  }, [onClose])

  // Clamp menu inside viewport window bounds
  const menuWidth = 230
  const menuHeight = targetPrimitive ? 290 : 250
  const clampedX = Math.max(12, Math.min(position.x, window.innerWidth - menuWidth - 12))
  const clampedY = Math.max(12, Math.min(position.y, window.innerHeight - menuHeight - 12))

  return (
    <div
      ref={menuRef}
      className="canvas-context-menu"
      role="menu"
      aria-label="画布上下文菜单"
      style={{
        left: `${clampedX}px`,
        top: `${clampedY}px`,
      }}
    >
      {targetPrimitive ? (
        <>
          <div className="context-menu-header" role="presentation">
            <span className="context-menu-title" title={targetPrimitive.id}>
              {targetPrimitive.label ?? targetPrimitive.id}
            </span>
            <span className="context-menu-badge">
              {primitiveTypeLabels[targetPrimitive.type] ?? targetPrimitive.type}
            </span>
          </div>

          <div className="context-menu-color-row" role="group" aria-label="快捷颜色">
            {PRESET_COLORS.map((color) => {
              const active = targetPrimitive.style?.stroke === color.value
              return (
                <button
                  key={color.value}
                  type="button"
                  className={`context-menu-color-swatch${active ? " is-active" : ""}`}
                  style={{ backgroundColor: color.value }}
                  title={color.label}
                  aria-label={color.label}
                  onClick={() => {
                    onColorChange?.(color.value)
                    onClose()
                  }}
                />
              )
            })}
          </div>

          <div className="context-menu-divider" role="separator" />

          {onRename && (
            <button
              type="button"
              className="context-menu-item"
              role="menuitem"
              onClick={() => {
                onRename()
                onClose()
              }}
            >
              <span className="context-menu-item-icon">✏️</span>
              <span className="context-menu-item-label">重命名</span>
              <span className="context-menu-item-shortcut">F2</span>
            </button>
          )}

          {onToggleVisibility && (
            <button
              type="button"
              className="context-menu-item"
              role="menuitem"
              onClick={() => {
                onToggleVisibility()
                onClose()
              }}
            >
              <span className="context-menu-item-icon">👁️</span>
              <span className="context-menu-item-label">
                {targetPrimitive.visible === false ? "显示对象" : "隐藏对象"}
              </span>
            </button>
          )}

          {onToggleLock && (
            <button
              type="button"
              className="context-menu-item"
              role="menuitem"
              onClick={() => {
                onToggleLock()
                onClose()
              }}
            >
              <span className="context-menu-item-icon">
                {targetPrimitive.locked ? "🔓" : "🔒"}
              </span>
              <span className="context-menu-item-label">
                {targetPrimitive.locked ? "解锁几何位置" : "锁定几何位置"}
              </span>
            </button>
          )}

          {onInspectDependencies && (
            <button
              type="button"
              className="context-menu-item"
              role="menuitem"
              onClick={() => {
                onInspectDependencies()
                onClose()
              }}
            >
              <span className="context-menu-item-icon">🔍</span>
              <span className="context-menu-item-label">查看从属依赖拓扑</span>
            </button>
          )}

          <div className="context-menu-divider" role="separator" />

          {onDelete && (
            <button
              type="button"
              className="context-menu-item is-danger"
              role="menuitem"
              onClick={() => {
                onDelete()
                onClose()
              }}
            >
              <span className="context-menu-item-icon">🗑️</span>
              <span className="context-menu-item-label">级联删除</span>
              <span className="context-menu-item-shortcut">Del</span>
            </button>
          )}
        </>
      ) : (
        <>
          <div className="context-menu-header" role="presentation">
            <span className="context-menu-title">几何画布</span>
            <span className="context-menu-badge">全局</span>
          </div>

          {onUndo && (
            <button
              type="button"
              className="context-menu-item"
              role="menuitem"
              disabled={!canUndo}
              onClick={() => {
                onUndo()
                onClose()
              }}
            >
              <span className="context-menu-item-icon">↶</span>
              <span className="context-menu-item-label">撤销</span>
              <span className="context-menu-item-shortcut">Ctrl+Z</span>
            </button>
          )}

          {onRedo && (
            <button
              type="button"
              className="context-menu-item"
              role="menuitem"
              disabled={!canRedo}
              onClick={() => {
                onRedo()
                onClose()
              }}
            >
              <span className="context-menu-item-icon">↷</span>
              <span className="context-menu-item-label">重做</span>
              <span className="context-menu-item-shortcut">Ctrl+Y</span>
            </button>
          )}

          <div className="context-menu-divider" role="separator" />

          {onSelectTool && (
            <>
              <button
                type="button"
                className="context-menu-item"
                role="menuitem"
                onClick={() => {
                  onSelectTool("point")
                  onClose()
                }}
              >
                <span className="context-menu-item-icon">📐</span>
                <span className="context-menu-item-label">绘制点</span>
                <span className="context-menu-item-shortcut">P</span>
              </button>

              <button
                type="button"
                className="context-menu-item"
                role="menuitem"
                onClick={() => {
                  onSelectTool("segment")
                  onClose()
                }}
              >
                <span className="context-menu-item-icon">📏</span>
                <span className="context-menu-item-label">绘制线段</span>
                <span className="context-menu-item-shortcut">L</span>
              </button>

              <button
                type="button"
                className="context-menu-item"
                role="menuitem"
                onClick={() => {
                  onSelectTool("circle")
                  onClose()
                }}
              >
                <span className="context-menu-item-icon">⭕</span>
                <span className="context-menu-item-label">绘制圆</span>
                <span className="context-menu-item-shortcut">C</span>
              </button>
            </>
          )}

          <div className="context-menu-divider" role="separator" />

          {onSelectAll && (
            <button
              type="button"
              className="context-menu-item"
              role="menuitem"
              onClick={() => {
                onSelectAll()
                onClose()
              }}
            >
              <span className="context-menu-item-icon">📋</span>
              <span className="context-menu-item-label">全选图元</span>
              <span className="context-menu-item-shortcut">Ctrl+A</span>
            </button>
          )}
        </>
      )}
    </div>
  )
}
