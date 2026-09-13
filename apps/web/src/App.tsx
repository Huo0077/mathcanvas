import { useEffect, useMemo, useRef, useState } from "react"

import { decodeMgeo, encodeMgeo } from "@draw/dsl"
import { validatePatch } from "@draw/scene-graph"
import type { Alignment } from "@draw/scene-graph"

import { AlgebraView } from "./components/AlgebraView"
import { AgentDock } from "./components/AgentDock"
import { GeometryToolbar } from "./components/GeometryToolbar"
import { GraphicsView } from "./components/GraphicsView"
import { PropertiesBar } from "./components/PropertiesBar"
import { WorkspaceHeader } from "./components/WorkspaceHeader"
import { useSceneStore } from "./store"

type CreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null
type CreationStep = { mode: Exclude<CreationMode, null>; center: { x: number; y: number } | null; start?: { x: number; y: number }; points?: { x: number; y: number }[] }

function nextPrimitiveId(document: ReturnType<typeof useSceneStore.getState>["document"], prefix: string): string {
  let index = 1
  while (document.primitives.some((primitive) => primitive.id === `${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function nextGroupId(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  let index = 1
  while (document.groups.some((group) => group.id === `group-${index}`)) index += 1
  return `group-${index}`
}

export function App() {
  const document = useSceneStore((state) => state.document)
  const apply = useSceneStore((state) => state.apply)
  const undo = useSceneStore((state) => state.undo)
  const redo = useSceneStore((state) => state.redo)
  const replace = useSceneStore((state) => state.replace)
  const operationError = useSceneStore((state) => state.error)
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
    if (creationStep.mode === "polyline") {
      const points = creationStep.points ?? []
      if (!points.length || Math.hypot(coordinate.x - points.at(-1)!.x, coordinate.y - points.at(-1)!.y) >= 0.05) setCreationStep({ ...creationStep, points: [...points, coordinate] })
      return
    }
    if (!creationStep.center) {
      setCreationStep({ ...creationStep, center: coordinate })
      return
    }
    if (creationStep.mode === "line" || creationStep.mode === "segment" || creationStep.mode === "ray") {
      if (Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y) < 0.05) return
      const type = creationStep.mode
      const id = nextPrimitiveId(document, type)
      apply({ op: "addPrimitive", primitive: { id, type, a: creationStep.center, b: coordinate, label: `${type === "line" ? "直线" : type === "ray" ? "射线" : "线段"} ${id.split("-").at(-1)}` } })
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
  const handleCanvasDoubleClick = (coordinate: { x: number; y: number }) => {
    if (!creationStep || creationStep.mode !== "polyline") return
    const points = creationStep.points ?? []
    const finalPoints = !points.length || Math.hypot(coordinate.x - points.at(-1)!.x, coordinate.y - points.at(-1)!.y) < 0.05 ? points : [...points, coordinate]
    if (finalPoints.length < 2) return
    const id = nextPrimitiveId(document, "polyline")
    apply({ op: "addPrimitive", primitive: { id, type: "polyline", points: finalPoints, label: `折线 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setCreationStep(null)
  }

  const addDefaultPrimitive = (type: "parabola" | "ellipse" | "hyperbola" | "function") => {
    const id = nextPrimitiveId(document, type)
    const primitive = type === "parabola"
      ? { id, type, vertex: { x: 0, y: -1 }, focalParameter: 2, axis: "y" as const, label: `抛物线 ${id.split("-").at(-1)}` }
      : type === "ellipse"
        ? { id, type, center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2, label: `椭圆 ${id.split("-").at(-1)}` }
        : type === "hyperbola"
          ? { id, type, center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" as const, label: `双曲线 ${id.split("-").at(-1)}` }
          : { id, type, expression: "x*x", domain: [-6, 6] as [number, number], samples: 128, label: `函数 ${id.split("-").at(-1)}` }
    apply({ op: "addPrimitive", primitive })
    setSelectedIds([id])
  }

  const selectedPrimitive = selectedId ? document.primitives.find((primitive) => primitive.id === selectedId) ?? null : null
  const allSelectedLocked = selectedIds.length > 0 && selectedIds.every((id) => document.primitives.find((primitive) => primitive.id === id)?.locked)
  const allSelectedVisible = selectedIds.length > 0 && selectedIds.every((id) => document.primitives.find((primitive) => primitive.id === id)?.visible !== false)
  const selectedGroup = document.groups.find((group) => group.members.length === selectedIds.length && group.members.every((id) => selectedIds.includes(id))) ?? null
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
      if (primitive.type === "ray") return [primitive.a, primitive.b].every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "polyline") return primitive.points.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "circle" || primitive.type === "arc") return primitive.center.x >= bounds.minX && primitive.center.x <= bounds.maxX && primitive.center.y >= bounds.minY && primitive.center.y <= bounds.maxY
      if (primitive.type === "parabola") return primitive.vertex.x >= bounds.minX && primitive.vertex.x <= bounds.maxX && primitive.vertex.y >= bounds.minY && primitive.vertex.y <= bounds.maxY
      if (primitive.type === "ellipse" || primitive.type === "hyperbola") return primitive.center.x >= bounds.minX && primitive.center.x <= bounds.maxX && primitive.center.y >= bounds.minY && primitive.center.y <= bounds.maxY
      if (primitive.type === "function") return primitive.domain[0] >= bounds.minX && primitive.domain[1] <= bounds.maxX
      return primitive.x >= bounds.minX && primitive.x <= bounds.maxX && primitive.y >= bounds.minY && primitive.y <= bounds.maxY
    }).map((primitive) => primitive.id)
    setSelectedIds(contained)
  }
  const toggleLock = () => apply({ op: "setPrimitivesLocked", ids: selectedIds, locked: !allSelectedLocked })
  const createGroup = () => apply({ op: "createGroup", group: { id: nextGroupId(document), label: `分组 ${document.groups.length + 1}`, members: selectedIds } })
  const deleteGroup = () => selectedGroup && apply({ op: "deleteGroup", id: selectedGroup.id })
  const alignSelection = (alignment: Alignment) => apply({ op: "alignPrimitives", ids: selectedIds, alignment })
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

  const creationLabel = creationMode === "line" ? "直线" : creationMode === "segment" ? "线段" : creationMode === "ray" ? "射线" : creationMode === "polyline" ? "折线" : creationMode === "circle" ? "圆" : "圆弧"
  const creationHint = creationMode === "polyline" ? "点击添加顶点，双击结束" : creationMode === "line" || creationMode === "segment" || creationMode === "ray" ? (creationStep?.center ? "点击终点" : "点击起点") : creationStep?.mode === "arc" ? (creationStep.start ? "点击终点" : "点击起点") : creationStep?.center ? "点击边缘" : "点击圆心"

  return <div className="app-shell"><WorkspaceHeader /><div className="workbench"><GeometryToolbar hasSelection={selectedIds.length > 0} allSelectedLocked={allSelectedLocked} creationMode={creationMode} onSelectTool={() => setCreationStep(null)} onDelete={deleteSelected} onToggleLock={toggleLock} onUndo={undo} onRedo={redo} onSave={save} onOpen={() => fileInputRef.current?.click()} onAddPoint={() => apply({ op: "addPrimitive", primitive: { id: nextPrimitiveId(document, "point"), type: "point", x: 2, y: 1, label: "新点 A" } })} onAddLine={() => startCreation("line")} onAddSegment={() => startCreation("segment")} onAddRay={() => startCreation("ray")} onAddPolyline={() => startCreation("polyline")} onAddCircle={() => startCreation("circle")} onAddArc={() => startCreation("arc")} onAddParabola={() => addDefaultPrimitive("parabola")} onAddEllipse={() => addDefaultPrimitive("ellipse")} onAddHyperbola={() => addDefaultPrimitive("hyperbola")} onAddFunction={() => addDefaultPrimitive("function")} /><AlgebraView primitives={document.primitives} selectedIds={selectedIds} onSelect={updateSelection} onToggle={(id, visible) => apply({ op: "toggleVisibility", id, visible })} /><GraphicsView document={document} selectedIds={selectedIds} creationMode={creationMode} onSelect={updateSelection} onBoxSelect={selectBox} onCanvasClick={handleCanvasCreationClick} onCanvasDoubleClick={handleCanvasDoubleClick} /><aside className="panel right"><PropertiesBar selectedPrimitive={selectedPrimitive} selectedCount={selectedIds.length} selectedGroupId={selectedGroup?.id ?? null} allSelectedVisible={allSelectedVisible} onCreateGroup={createGroup} onDeleteGroup={deleteGroup} onAlign={alignSelection} onToggleBatchVisibility={() => apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: !allSelectedVisible })} onUpdatePrimitive={(patch) => selectedId && apply({ op: "updatePrimitive", id: selectedId, patch })} value={slope?.value ?? 0.5} min={slope?.min ?? 0.15} max={slope?.max ?? 0.85} step={slope?.step ?? 0.05} onChange={(value) => apply({ op: "setParameter", id: "slope", value })} /><AgentDock /></aside><div className="footer-note">revision {document.revision} · {creationMode ? `${creationLabel}创建：${creationHint}` : slopeLine?.type === "line" ? "Scene Graph / Dependency DAG 已连接" : "等待图元"}</div></div>{(fileError || operationError) && <div role="alert" className="footer-note">{fileError ?? operationError}</div>}<input ref={fileInputRef} hidden aria-label="加载 .mgeo" type="file" accept=".mgeo,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; file.text().then(load).catch(() => setFileError("无法读取 .mgeo 文件")); event.target.value = "" }} /></div>
}
