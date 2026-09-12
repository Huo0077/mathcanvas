import { useMemo, useRef } from "react"

import { decodeMgeo, encodeMgeo } from "@draw/dsl"

import { AlgebraView } from "./components/AlgebraView"
import { AgentDock } from "./components/AgentDock"
import { GeometryToolbar } from "./components/GeometryToolbar"
import { GraphicsView } from "./components/GraphicsView"
import { PropertiesBar } from "./components/PropertiesBar"
import { WorkspaceHeader } from "./components/WorkspaceHeader"
import { useSceneStore } from "./store"

export function App() {
  const document = useSceneStore((state) => state.document)
  const apply = useSceneStore((state) => state.apply)
  const undo = useSceneStore((state) => state.undo)
  const redo = useSceneStore((state) => state.redo)
  const replace = useSceneStore((state) => state.replace)
  const fileInputRef = useRef<HTMLInputElement>(null)
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

  const load = (serialized: string) => replace(decodeMgeo(serialized))

  return <div className="app-shell"><WorkspaceHeader /><div className="workbench"><GeometryToolbar onUndo={undo} onRedo={redo} onSave={save} onOpen={() => fileInputRef.current?.click()} onAddPoint={() => apply({ op: "addPrimitive", primitive: { id: `point-${document.revision + 1}`, type: "point", x: 2, y: 1, label: "新点 A" } })} /><AlgebraView primitives={document.primitives} onToggle={(id, visible) => apply({ op: "toggleVisibility", id, visible })} /><GraphicsView document={document} /><aside className="panel right"><PropertiesBar value={slope?.value ?? 0.5} min={slope?.min ?? 0.15} max={slope?.max ?? 0.85} step={slope?.step ?? 0.05} onChange={(value) => apply({ op: "setParameter", id: "slope", value })} /><AgentDock /></aside><div className="footer-note">revision {document.revision} · {slopeLine?.type === "line" ? "Scene Graph / Dependency DAG 已连接" : "等待图元"}</div></div><input ref={fileInputRef} hidden aria-label="加载 .mgeo" type="file" accept=".mgeo,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; file.text().then(load) }} /></div>
}
