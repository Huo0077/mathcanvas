import { useState, type ReactNode } from "react"

import type { GeometryDocument } from "@draw/dsl"

export type CadMode = "projection" | "draft"

interface EngineeringWorkbenchProps {
  document: GeometryDocument
  mode: CadMode
  onModeChange: (mode: CadMode) => void
  /** Slots owned by App so object-edit logic is never duplicated inside the shell. */
  commandBar: ReactNode
  leftDock: ReactNode
  canvas: ReactNode
  inspector: ReactNode
  statusBar: ReactNode
}

const modes: { value: CadMode; label: string }[] = [
  { value: "projection", label: "3D 投影" },
  { value: "draft", label: "2D 绘图" }
]

export function EngineeringWorkbench({ document, mode, onModeChange, commandBar, leftDock, canvas, inspector, statusBar }: EngineeringWorkbenchProps) {
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)

  return <div className="engineering-workbench" data-cad-mode={mode} data-revision={document.revision} data-workspace={document.workspace}>
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
        <button type="button" aria-expanded={leftOpen} onClick={() => setLeftOpen((open) => !open)}>{leftOpen ? "收起" : "展开"}模型与图纸树</button>
        <button type="button" aria-expanded={rightOpen} onClick={() => setRightOpen((open) => !open)}>{rightOpen ? "收起" : "展开"}工程属性检查器</button>
      </div>
    </div>
    <div className="workbench-command-region" role="region" aria-label="工程命令栏">{commandBar}</div>
    <div className="workbench-body">
      {leftOpen && <div className="workbench-dock workbench-dock-left" role="region" aria-label="模型与图纸树">{leftDock}</div>}
      <div className="workbench-canvas-slot" role="region" aria-label="工程图视口">{canvas}</div>
      {rightOpen && <div className="workbench-dock workbench-dock-right" role="region" aria-label="工程属性检查器">{inspector}</div>}
    </div>
    <div className="workbench-status-region" role="region" aria-label="工程状态栏">{statusBar}</div>
  </div>
}
