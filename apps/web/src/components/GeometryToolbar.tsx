import { useState } from "react"
import type { Workspace } from "@draw/dsl"

interface GeometryToolbarProps {
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onOpen: () => void
  onExportSvg: () => void
  onExportCsv: () => void
  onExportPng: () => void
  onAddPoint: () => void
  onAddLine: () => void
  onAddSegment: () => void
  onAddRay: () => void
  onAddPolyline: () => void
  onAddCircle: () => void
  onAddArc: () => void
  onAddParabola: () => void
  onAddEllipse: () => void
  onAddHyperbola: () => void
  onAddFunction: () => void
  onAddCube: () => void
  onAddPyramid: () => void
  onAddCylinder: () => void
  onAddCone: () => void
  onAddSection: () => void
  onDelete: () => void
  onToggleLock: () => void
  onSelectTool: () => void
  creationMode: "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null
  hasSelection: boolean
  allSelectedLocked: boolean
  workspace: Workspace
  canCreateSection: boolean
}

type ToolbarIconName = "select" | "point" | "line" | "circle" | "curve" | "function" | "undo" | "redo" | "trash" | "lock" | "save" | "text" | "camera" | "brush"

function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const paths = {
    select: <path d="m6 4 11 8-5 .8 3 5-2.4 1.3-3-5L6 18V4Z" />,
    point: <circle cx="12" cy="12" r="4" />,
    line: <path d="M5 19 19 5M5 19h5M19 5v5" />,
    circle: <circle cx="12" cy="12" r="7" />,
    curve: <path d="M4 17c3-8 6-10 9-5s5 4 7-5" />,
    function: <><path d="M4 19h16M5 16c2-9 4-9 6-2s4 7 8-8" /><path d="M5 5h3" /></>,
    undo: <><path d="M9 8 5 12l4 4" /><path d="M5 12h8a5 5 0 0 1 5 5" /></>,
    redo: <><path d="m15 8 4 4-4 4" /><path d="M19 12h-8a5 5 0 0 0-5 5" /></>,
    trash: <><path d="M5 7h14M10 4h4l1 3H9l1-3ZM8 10v7M12 10v7M16 10v7M7 7l1 13h8l1-13" /></>,
    lock: <><rect x="6" y="10" width="12" height="10" rx="2" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>,
    save: <><path d="M5 4h12l2 2v14H5V4Z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></>,
    text: <><path d="M5 6V4h14v2M12 4v16M8 20h8" /></>,
    camera: <><path d="M5 8h3l1.3-2h5.4L16 8h3v10H5V8Z" /><circle cx="12" cy="13" r="3" /></>,
    brush: <><path d="m15 5 4 4-8.8 8.8-5 1 1-5L15 5Z" /><path d="m13 7 4 4" /></>
  }
  return <svg className="toolbar-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

function ToolButton({ label, icon, onClick, active = false, disabled = false, primary = false, title }: { label: string; icon?: ToolbarIconName; onClick: () => void; active?: boolean; disabled?: boolean; primary?: boolean; title?: string }) {
  return <button type="button" className={`tool-button${primary ? " primary" : ""}`} aria-label={label} aria-pressed={icon === "select" || active ? active : undefined} data-active={active} disabled={disabled} title={title} onClick={onClick}>{icon && <ToolbarIcon name={icon} />}<span>{label}</span></button>
}

export function GeometryToolbar(props: GeometryToolbarProps) {
  const [objectsOpen, setObjectsOpen] = useState(true)
  return <div className="toolbar" aria-label="几何工具栏">
    <section className={`toolbar-group object-tools${objectsOpen ? " is-open" : ""}`}>
      <div className="toolbar-group-heading"><div><span className="toolbar-kicker">创建</span><strong>添加对象</strong></div><button className="toolbar-expand" type="button" aria-label="添加对象" aria-expanded={objectsOpen} onClick={() => setObjectsOpen((open) => !open)}>⌄</button></div>
      <div className="object-tool-grid">
        <ToolButton label={props.workspace === "geometry3d" ? "添加空间点" : "添加点"} icon="point" primary onClick={props.onAddPoint} />
        <ToolButton label="选择工具" icon="select" active={props.creationMode === null} onClick={props.onSelectTool} />
        {props.workspace !== "geometry3d" && <>
          <ToolButton label="添加直线" icon="line" active={props.creationMode === "line"} onClick={props.onAddLine} />
          <ToolButton label="添加线段" icon="line" active={props.creationMode === "segment"} onClick={props.onAddSegment} />
          <ToolButton label="添加射线" icon="line" active={props.creationMode === "ray"} onClick={props.onAddRay} />
          <ToolButton label="添加折线" icon="curve" active={props.creationMode === "polyline"} onClick={props.onAddPolyline} />
          <ToolButton label="添加圆" icon="circle" active={props.creationMode === "circle"} onClick={props.onAddCircle} />
          <ToolButton label="添加圆弧" icon="curve" active={props.creationMode === "arc"} onClick={props.onAddArc} />
          <ToolButton label="添加抛物线" icon="curve" onClick={props.onAddParabola} />
          <ToolButton label="添加椭圆" icon="circle" onClick={props.onAddEllipse} />
          <ToolButton label="添加双曲线" icon="curve" onClick={props.onAddHyperbola} />
          <ToolButton label="添加函数图像" icon="function" onClick={props.onAddFunction} />
        </>}
        {props.workspace === "geometry3d" && <ToolButton label="添加立方体" icon="curve" onClick={props.onAddCube} />}
        {props.workspace === "geometry3d" && <ToolButton label="添加棱锥" icon="curve" onClick={props.onAddPyramid} />}
        {props.workspace === "geometry3d" && <ToolButton label="添加圆柱" icon="circle" onClick={props.onAddCylinder} />}
        {props.workspace === "geometry3d" && <ToolButton label="添加圆锥" icon="curve" onClick={props.onAddCone} />}
        {props.workspace === "geometry3d" && <ToolButton label="由选中点创建空间直线" icon="line" onClick={props.onAddLine} />}
        {props.workspace === "geometry3d" && <ToolButton label="由选中点创建空间平面" icon="line" onClick={props.onAddSegment} />}
        {props.workspace === "geometry3d" && <ToolButton label="由选中点创建空间面" icon="curve" onClick={props.onAddPolyline} />}
        {props.workspace === "geometry3d" && <ToolButton label="创建截面" icon="curve" disabled={!props.canCreateSection} onClick={props.onAddSection} />}
      </div>
    </section>
    <section className="toolbar-group multimodal-tools">
      <div className="toolbar-group-heading"><div><span className="toolbar-kicker">输入</span><strong>多模态输入</strong></div></div>
      <div className="toolbar-inline-actions"><ToolButton label="文本输入" icon="text" onClick={() => undefined} /><ToolButton label="拍照识题" icon="camera" onClick={() => undefined} /><ToolButton label="画笔标注" icon="brush" onClick={() => undefined} /></div>
    </section>
    <section className="toolbar-group editing-tools">
      <div className="toolbar-group-heading"><div><span className="toolbar-kicker">编辑</span><strong>画布操作</strong></div></div>
      <div className="toolbar-inline-actions"><ToolButton label="撤销" icon="undo" onClick={props.onUndo} /><ToolButton label="重做" icon="redo" onClick={props.onRedo} /><ToolButton label="删除对象" icon="trash" disabled={!props.hasSelection || props.allSelectedLocked} onClick={props.onDelete} /><ToolButton label={props.allSelectedLocked ? "解锁对象" : "锁定对象"} icon="lock" disabled={!props.hasSelection} onClick={props.onToggleLock} /></div>
    </section>
    <section className="toolbar-group export-tools">
      <div className="toolbar-group-heading"><div><span className="toolbar-kicker">文件</span><strong>保存 / 导出</strong></div></div>
      <div className="toolbar-inline-actions"><ToolButton label="保存 .mgeo" icon="save" onClick={props.onSave} /><ToolButton label="打开 .mgeo" onClick={props.onOpen} /><ToolButton label="导出 SVG" disabled={props.workspace === "geometry3d"} title={props.workspace === "geometry3d" ? "立体几何暂不提供 SVG 投影导出，将在 P7 工程制图切片接入；当前可导出 .mgeo 和 CSV" : undefined} onClick={props.onExportSvg} /><ToolButton label="导出 CSV" onClick={props.onExportCsv} /><ToolButton label="导出 PNG" disabled={props.workspace === "geometry3d"} title={props.workspace === "geometry3d" ? "立体几何暂不提供 PNG 投影导出，将在 P7 工程制图切片接入；当前可导出 .mgeo 和 CSV" : undefined} onClick={props.onExportPng} /></div>
    </section>
  </div>
}
