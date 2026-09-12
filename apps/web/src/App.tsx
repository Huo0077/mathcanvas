import { useMemo, useRef, useState } from "react"

import { decodeMgeo, encodeMgeo } from "@draw/dsl"

import { AlgebraView } from "./components/AlgebraView"
import { AgentDock } from "./components/AgentDock"
import { GeometryToolbar } from "./components/GeometryToolbar"
import { GraphicsView } from "./components/GraphicsView"
import { PropertiesBar } from "./components/PropertiesBar"
import { WorkspaceHeader } from "./components/WorkspaceHeader"
import { useSceneStore } from "./store"

type CreationMode = "circle" | "arc" | null
type CreationStep = { mode: "circle" | "arc"; center: { x: number; y: number } | null; start?: { x: number; y: number } }

function nextPrimitiveId(document: ReturnType<typeof useSceneStore.getState>["document"], prefix: string): string {
  let index = 1
  while (document.primitives.some((primitive) => primitive.id === `${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

export function App() {
  const document = useSceneStore((state) => state.document)
  const apply = useSceneStore((state) => state.apply)
  const undo = useSceneStore((state) => state.undo)
  const redo = useSceneStore((state) => state.redo)
  const replace = useSceneStore((state) => state.replace)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [creationStep, setCreationStep] = useState<CreationStep | null>(null)
  const slope = document.parameters.slope
  const slopeLine = useMemo(() => document.primitives.find((primitive) => primitive.id === "line-slope"), [document.primitives])

  const save = () => {
    const blob = new Blob([encodeMgeo(document)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = globalThis.document.createElement("a")
    anchor.href = url
    anchor.download = `${document.metadata.name.replace(/\s+/g, "-")}.mgeo`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const load = (serialized: string) => {
    try {
      replace(decodeMgeo(serialized))
      setFileError(null)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "无法打开 .mgeo 文件")
    }
  }

  const creationMode: CreationMode = creationStep?.mode ?? null
  const startCreation = (mode: "circle" | "arc") => setCreationStep({ mode, center: null })
  const handleCanvasClick = (coordinate: { x: number; y: number }) => {
    if (!creationStep) return
    if (!creationStep.center) {
      setCreationStep({ ...creationStep, center: coordinate })
      return
    }
    if (creationStep.mode === "circle") {
      const radius = Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y)
      if (radius < 0.05) return
      const id = nextPrimitiveId(document, "circle")
      apply({ op: "addPrimitive", primitive: { id, type: "circle", center: creationStep.center, radius, label: `圆 ${id.split("-").at(-1)}` } })
      setSelectedId(id)
      setCreationStep(null)
      return
    }
    if (!creationStep.start) {
      setCreationStep({ ...creationStep, start: coordinate })
      return
    }
    const radius = Math.hypot(creationStep.start.x - creationStep.center.x, creationStep.start.y - creationStep.center.y)
    if (radius < 0.05) return
    const startAngle = Math.atan2(creationStep.start.y - creationStep.center.y, creationStep.start.x - creationStep.center.x)
    const endAngle = Math.atan2(coordinate.y - creationStep.center.y, coordinate.x - creationStep.center.x)
    const id = nextPrimitiveId(document, "arc")
    apply({ op: "addPrimitive", primitive: { id, type: "arc", center: creationStep.center, radius, startAngle, endAngle, label: `圆弧 ${id.split("-").at(-1)}` } })
    setSelectedId(id)
    setCreationStep(null)
  }

  const handleCanvasCreationClick = (coordinate: { x: number; y: number }) => {
    handleCanvasClick(coordinate)
  }

  const selectedPrimitive = selectedId ? document.primitives.find((primitive) => primitive.id === selectedId) ?? null : null

  return <div className="app-shell"><WorkspaceHeader /><div className="workbench"><GeometryToolbar creationMode={creationMode} onUndo={undo} onRedo={redo} onSave={save} onOpen={() => fileInputRef.current?.click()} onAddPoint={() => apply({ op: "addPrimitive", primitive: { id: nextPrimitiveId(document, "point"), type: "point", x: 2, y: 1, label: "新点 A" } })} onAddCircle={() => startCreation("circle")} onAddArc={() => startCreation("arc")} /><AlgebraView primitives={document.primitives} selectedId={selectedId} onSelect={setSelectedId} onToggle={(id, visible) => apply({ op: "toggleVisibility", id, visible })} /><GraphicsView document={document} selectedId={selectedId} creationMode={creationMode} onSelect={setSelectedId} onCanvasClick={handleCanvasCreationClick} /><aside className="panel right"><PropertiesBar selectedPrimitive={selectedPrimitive} onUpdatePrimitive={(patch) => selectedId && apply({ op: "updatePrimitive", id: selectedId, patch })} value={slope?.value ?? 0.5} min={slope?.min ?? 0.15} max={slope?.max ?? 0.85} step={slope?.step ?? 0.05} onChange={(value) => apply({ op: "setParameter", id: "slope", value })} /><AgentDock /></aside><div className="footer-note">revision {document.revision} · {creationMode ? `${creationMode === "circle" ? "圆" : "圆弧"}创建：${creationStep?.mode === "arc" ? (creationStep.start ? "点击终点" : "点击起点") : creationStep?.start ? "点击边缘" : "点击圆心"}` : slopeLine?.type === "line" ? "Scene Graph / Dependency DAG 已连接" : "等待图元"}</div></div>{fileError && <div role="alert" className="footer-note">{fileError}</div>}<input ref={fileInputRef} hidden aria-label="加载 .mgeo" type="file" accept=".mgeo,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; file.text().then(load).catch(() => setFileError("无法读取 .mgeo 文件")); event.target.value = "" }} /></div>
}
