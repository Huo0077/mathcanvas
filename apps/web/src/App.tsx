import { useEffect, useMemo, useRef, useState } from "react"

import { decodeMgeo, encodeMgeo } from "@draw/dsl"
import { validatePatch } from "@draw/scene-graph"

import { AlgebraView } from "./components/AlgebraView"
import { AgentDock } from "./components/AgentDock"
import { GeometryToolbar } from "./components/GeometryToolbar"
import { GraphicsView } from "./components/GraphicsView"
import { PropertiesBar } from "./components/PropertiesBar"
import { WorkspaceHeader } from "./components/WorkspaceHeader"
import { useSceneStore } from "./store"

type CreationMode = "line" | "segment" | "circle" | "arc" | null
type CreationStep = { mode: Exclude<CreationMode, null>; center: { x: number; y: number } | null; start?: { x: number; y: number } }

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
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [creationStep, setCreationStep] = useState<CreationStep | null>(null)
  const selectedId = selectedIds.at(-1) ?? null
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
  const startCreation = (mode: Exclude<CreationMode, null>) => setCreationStep({ mode, center: null })
  const handleCanvasClick = (coordinate: { x: number; y: number }) => {
    if (!creationStep) return
    if (!creationStep.center) {
      setCreationStep({ ...creationStep, center: coordinate })
      return
    }
    if (creationStep.mode === "line" || creationStep.mode === "segment") {
      if (Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y) < 0.05) return
      const type = creationStep.mode
      const id = nextPrimitiveId(document, type)
      apply({ op: "addPrimitive", primitive: { id, type, a: creationStep.center, b: coordinate, label: `${type === "line" ? "直线" : "线段"} ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
      setCreationStep(null)
      return
    }
    if (creationStep.mode === "circle") {
      const radius = Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y)
      if (radius < 0.05) return
      const id = nextPrimitiveId(document, "circle")
      apply({ op: "addPrimitive", primitive: { id, type: "circle", center: creationStep.center, radius, label: `圆 ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
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
    setSelectedIds([id])
    setCreationStep(null)
  }

  const handleCanvasCreationClick = (coordinate: { x: number; y: number }) => {
    handleCanvasClick(coordinate)
  }

  const selectedPrimitive = selectedId ? document.primitives.find((primitive) => primitive.id === selectedId) ?? null : null
  const allSelectedLocked = selectedIds.length > 0 && selectedIds.every((id) => document.primitives.find((primitive) => primitive.id === id)?.locked)
  const updateSelection = (id: string | null, additive = false) => {
    setCreationStep(null)
    if (!id) {
      setSelectedIds([])
      return
    }
    setSelectedIds((current) => additive ? (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]) : [id])
  }
  const selectBox = (bounds: { minX: number; minY: number; maxX: number; maxY: number }) => {
    const contained = document.primitives.filter((primitive) => {
      if (primitive.type === "point") return primitive.x >= bounds.minX && primitive.x <= bounds.maxX && primitive.y >= bounds.minY && primitive.y <= bounds.maxY
      if (primitive.type === "line" || primitive.type === "segment") return [primitive.a, primitive.b].every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "circle" || primitive.type === "arc") return primitive.center.x >= bounds.minX && primitive.center.x <= bounds.maxX && primitive.center.y >= bounds.minY && primitive.center.y <= bounds.maxY
      return primitive.x >= bounds.minX && primitive.x <= bounds.maxX && primitive.y >= bounds.minY && primitive.y <= bounds.maxY
    }).map((primitive) => primitive.id)
    setSelectedIds(contained)
  }
  const toggleLock = () => selectedIds.forEach((id) => apply({ op: "toggleLock", id, locked: !allSelectedLocked }))
  const deleteSelected = () => {
    if (!selectedIds.length) return
    const validations = selectedIds.map((id) => validatePatch(document, { op: "deleteObject", id }))
    const invalid = validations.find((validation) => !validation.valid)
    if (invalid && !invalid.valid) {
      setFileError(invalid.errors.join(", "))
      return
    }
    for (const id of [...selectedIds].reverse()) apply({ op: "deleteObject", id })
    setSelectedIds([])
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreationStep(null)
        return
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0 && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedIds, document, apply])

  const creationLabel = creationMode === "line" ? "直线" : creationMode === "segment" ? "线段" : creationMode === "circle" ? "圆" : "圆弧"
  const creationHint = creationMode === "line" || creationMode === "segment" ? (creationStep?.center ? "点击终点" : "点击起点") : creationStep?.mode === "arc" ? (creationStep.start ? "点击终点" : "点击起点") : creationStep?.center ? "点击边缘" : "点击圆心"

  return <div className="app-shell"><WorkspaceHeader /><div className="workbench"><GeometryToolbar hasSelection={selectedIds.length > 0} allSelectedLocked={allSelectedLocked} creationMode={creationMode} onSelectTool={() => setCreationStep(null)} onDelete={deleteSelected} onToggleLock={toggleLock} onUndo={undo} onRedo={redo} onSave={save} onOpen={() => fileInputRef.current?.click()} onAddPoint={() => apply({ op: "addPrimitive", primitive: { id: nextPrimitiveId(document, "point"), type: "point", x: 2, y: 1, label: "新点 A" } })} onAddLine={() => startCreation("line")} onAddSegment={() => startCreation("segment")} onAddCircle={() => startCreation("circle")} onAddArc={() => startCreation("arc")} /><AlgebraView primitives={document.primitives} selectedIds={selectedIds} onSelect={updateSelection} onToggle={(id, visible) => apply({ op: "toggleVisibility", id, visible })} /><GraphicsView document={document} selectedIds={selectedIds} creationMode={creationMode} onSelect={updateSelection} onBoxSelect={selectBox} onCanvasClick={handleCanvasCreationClick} /><aside className="panel right"><PropertiesBar selectedPrimitive={selectedPrimitive} onUpdatePrimitive={(patch) => selectedId && apply({ op: "updatePrimitive", id: selectedId, patch })} value={slope?.value ?? 0.5} min={slope?.min ?? 0.15} max={slope?.max ?? 0.85} step={slope?.step ?? 0.05} onChange={(value) => apply({ op: "setParameter", id: "slope", value })} /><AgentDock /></aside><div className="footer-note">revision {document.revision} · {creationMode ? `${creationLabel}创建：${creationHint}` : slopeLine?.type === "line" ? "Scene Graph / Dependency DAG 已连接" : "等待图元"}</div></div>{fileError && <div role="alert" className="footer-note">{fileError}</div>}<input ref={fileInputRef} hidden aria-label="加载 .mgeo" type="file" accept=".mgeo,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; file.text().then(load).catch(() => setFileError("无法读取 .mgeo 文件")); event.target.value = "" }} /></div>
}
