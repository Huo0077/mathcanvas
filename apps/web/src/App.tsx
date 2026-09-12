import { useMemo, useRef, useState } from "react"

import { decodeMgeo, encodeMgeo } from "@draw/dsl"

import { AlgebraView } from "./components/AlgebraView"
import { AgentDock } from "./components/AgentDock"
import { GeometryToolbar } from "./components/GeometryToolbar"
import { GraphicsView } from "./components/GraphicsView"
import { PropertiesBar } from "./components/PropertiesBar"
import { WorkspaceHeader } from "./components/WorkspaceHeader"
import { useSceneStore } from "./store"

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

  return <div className="app-shell"><WorkspaceHeader /><div className="workbench"><GeometryToolbar onUndo={undo} onRedo={redo} onSave={save} onOpen={() => fileInputRef.current?.click()} onAddPoint={() => apply({ op: "addPrimitive", primitive: { id: nextPrimitiveId(document, "point"), type: "point", x: 2, y: 1, label: "新点 A" } })} onAddCircle={() => apply({ op: "addPrimitive", primitive: { id: nextPrimitiveId(document, "circle"), type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "新圆 C" } })} onAddArc={() => apply({ op: "addPrimitive", primitive: { id: nextPrimitiveId(document, "arc"), type: "arc", center: { x: 0, y: 0 }, radius: 4, startAngle: 0, endAngle: Math.PI / 2, label: "新圆弧" } })} /><AlgebraView primitives={document.primitives} onToggle={(id, visible) => apply({ op: "toggleVisibility", id, visible })} /><GraphicsView document={document} /><aside className="panel right"><PropertiesBar value={slope?.value ?? 0.5} min={slope?.min ?? 0.15} max={slope?.max ?? 0.85} step={slope?.step ?? 0.05} onChange={(value) => apply({ op: "setParameter", id: "slope", value })} /><AgentDock /></aside><div className="footer-note">revision {document.revision} · {slopeLine?.type === "line" ? "Scene Graph / Dependency DAG 已连接" : "等待图元"}</div></div>{fileError && <div role="alert" className="footer-note">{fileError}</div>}<input ref={fileInputRef} hidden aria-label="加载 .mgeo" type="file" accept=".mgeo,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; file.text().then(load).catch(() => setFileError("无法读取 .mgeo 文件")); event.target.value = "" }} /></div>
}
