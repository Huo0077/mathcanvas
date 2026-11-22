import { useEffect, useState, type ReactNode } from "react"

import type { GeometryDocument } from "@draw/dsl"
import { InspectorResizeHandle } from "./InspectorResizeHandle"

export type CadMode = "projection" | "draft"

function isCompactViewport(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 680px)").matches
}

interface EngineeringWorkbenchProps {
  document: GeometryDocument
  mode: CadMode
  onModeChange: (mode: CadMode) => void
  /** Slots owned by App so object-edit logic is never duplicated inside the shell. */
  commandBar: ReactNode
  leftDock: ReactNode
  canvas: ReactNode
  inspector: ReactNode
  inspectorWidth?: number
  onInspectorResize?: (width: number) => void
  statusBar: ReactNode
}

const modes: { value: CadMode; label: string }[] = [
  { value: "projection", label: "3D 投影" },
  { value: "draft", label: "2D 绘图" }
]

export function EngineeringWorkbench({ document, mode, onModeChange, commandBar, leftDock, canvas, inspector, inspectorWidth, onInspectorResize, statusBar }: EngineeringWorkbenchProps) {
  const [leftOpen, setLeftOpen] = useState(() => !isCompactViewport())
  const [rightOpen, setRightOpen] = useState(() => !isCompactViewport())

  useEffect(() => {
    const onAndroidBack = (event: Event) => {
      if (!isCompactViewport()) return
      if (leftOpen || rightOpen) {
        event.preventDefault()
        setLeftOpen(false)
        setRightOpen(false)
      }
    }
    window.addEventListener("mathcanvas:android-back", onAndroidBack)
    return () => window.removeEventListener("mathcanvas:android-back", onAndroidBack)
  }, [leftOpen, rightOpen])

  const toggleLeft = () => {
    setLeftOpen((open) => {
      const next = !open
      if (next && isCompactViewport()) setRightOpen(false)
      return next
    })
  }
  const toggleRight = () => {
    setRightOpen((open) => {
      const next = !open
      if (next && isCompactViewport()) setLeftOpen(false)
      return next
    })
  }

  return <div className="engineering-workbench" data-cad-mode={mode} data-revision={document.revision} data-workspace={document.workspace} data-left-open={leftOpen ? "true" : "false"} data-right-open={rightOpen ? "true" : "false"}>
    <div className="workbench-mode-row">
      <div className="workbench-mode-switch" role="group" aria-label="视图模式">
        {modes.map((candidate) => <button
          key={candidate.value}
          type="button"
          aria-pressed={mode === candidate.value}
          data-active={mode === candidate.value}
          onClick={() => onModeChange(candidate.value)}
        >{candidate.label}</button>)}
      </div>
      <div className="workbench-dock-toggles">
        <button type="button" aria-expanded={leftOpen} onClick={toggleLeft}>{leftOpen ? "收起" : "展开"}模型与图纸树</button>
        <button type="button" aria-expanded={rightOpen} onClick={toggleRight}>{rightOpen ? "收起" : "展开"}工程属性检查器</button>
      </div>
    </div>
    <div className="workbench-command-region" role="region" aria-label="工程命令栏">{commandBar}</div>
    <div className="workbench-body">
      {isCompactViewport() && (leftOpen || rightOpen) && (
        <button
          type="button"
          className="cad-mobile-backdrop"
          aria-label="关闭工程面板"
          onClick={() => { setLeftOpen(false); setRightOpen(false) }}
        />
      )}
      {leftOpen && <div className="workbench-dock workbench-dock-left" role="region" aria-label="模型与图纸树">{leftDock}</div>}
      <div className="workbench-canvas-slot" role="region" aria-label="工程图视口">{canvas}</div>
      {rightOpen && <div id="engineering-properties-dock" className="workbench-dock workbench-dock-right" role="region" aria-label="工程属性检查器">{inspector}</div>}
      {rightOpen && inspectorWidth !== undefined && onInspectorResize && <InspectorResizeHandle controls="engineering-properties-dock" width={inspectorWidth} onResize={onInspectorResize} />}
    </div>
    <div className="workbench-status-region" role="region" aria-label="工程状态栏">{statusBar}</div>
  </div>
}
