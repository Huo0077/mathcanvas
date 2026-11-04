import { useRef } from "react"

import { DEFAULT_INSPECTOR_WIDTH, MIN_INSPECTOR_WIDTH } from "../persistence/inspectorWidth"

export function InspectorResizeHandle({ controls, width, onResize }: { controls: string; width: number; onResize: (width: number) => void }) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null)
  const maxWidth = () => Math.min(500, Math.round(window.innerWidth * 0.37))
  const currentWidth = () => document.getElementById(controls)?.getBoundingClientRect().width || width
  const resize = (next: number) => onResize(Math.round(Math.max(MIN_INSPECTOR_WIDTH, Math.min(maxWidth(), next))))

  return <div
    className="inspector-resize-handle"
    role="separator"
    aria-label="调整属性栏宽度"
    aria-orientation="vertical"
    aria-controls={controls}
    aria-valuemin={MIN_INSPECTOR_WIDTH}
    aria-valuemax={500}
    aria-valuenow={width}
    tabIndex={0}
    title="拖动调整宽度，双击恢复默认"
    onPointerDown={(event) => {
      if (event.button !== 0 || drag.current) return
      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      drag.current = { pointerId: event.pointerId, x: event.clientX, width: currentWidth() }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={(event) => {
      const active = drag.current
      if (active?.pointerId === event.pointerId) resize(active.width + active.x - event.clientX)
    }}
    onLostPointerCapture={() => { drag.current = null }}
    onDoubleClick={() => resize(DEFAULT_INSPECTOR_WIDTH)}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 48 : 16
      const next = event.key === "ArrowLeft" ? currentWidth() + step
        : event.key === "ArrowRight" ? currentWidth() - step
        : event.key === "Home" ? MIN_INSPECTOR_WIDTH
        : event.key === "End" ? maxWidth()
        : null
      if (next === null) return
      event.preventDefault()
      event.stopPropagation()
      resize(next)
    }}
  />
}
