interface GeometryToolbarProps {
  onUndo: () => void
  onRedo: () => void
  onSave: () => void
  onOpen: () => void
  onAddPoint: () => void
  onAddLine: () => void
  onAddSegment: () => void
  onAddRay: () => void
  onAddPolyline: () => void
  onAddCircle: () => void
  onAddArc: () => void
  onDelete: () => void
  onToggleLock: () => void
  onSelectTool: () => void
  creationMode: "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null
  hasSelection: boolean
  allSelectedLocked: boolean
}

export function GeometryToolbar(props: GeometryToolbarProps) {
  return <div className="toolbar" aria-label="几何工具栏">
    <button className="primary" aria-label="添加点" onClick={props.onAddPoint}>＋ 添加点</button>
    <button aria-label="选择工具" aria-pressed={props.creationMode === null} data-active={props.creationMode === null} onClick={props.onSelectTool}>选择</button>
    <button aria-label="添加直线" aria-pressed={props.creationMode === "line"} data-active={props.creationMode === "line"} onClick={props.onAddLine}>直线</button>
    <button aria-label="添加线段" aria-pressed={props.creationMode === "segment"} data-active={props.creationMode === "segment"} onClick={props.onAddSegment}>线段</button>
    <button aria-label="添加射线" aria-pressed={props.creationMode === "ray"} data-active={props.creationMode === "ray"} onClick={props.onAddRay}>射线</button>
    <button aria-label="添加折线" aria-pressed={props.creationMode === "polyline"} data-active={props.creationMode === "polyline"} onClick={props.onAddPolyline}>折线</button>
    <button aria-label="添加圆" aria-pressed={props.creationMode === "circle"} data-active={props.creationMode === "circle"} onClick={props.onAddCircle}>圆</button>
    <button aria-label="添加圆弧" aria-pressed={props.creationMode === "arc"} data-active={props.creationMode === "arc"} onClick={props.onAddArc}>圆弧</button>
    <button aria-label="删除对象" disabled={!props.hasSelection || props.allSelectedLocked} onClick={props.onDelete}>删除</button>
    <button aria-label={props.allSelectedLocked ? "解锁对象" : "锁定对象"} disabled={!props.hasSelection} onClick={props.onToggleLock}>{props.allSelectedLocked ? "解锁" : "锁定"}</button>
    <button onClick={props.onUndo}>撤销</button><button onClick={props.onRedo}>重做</button><button onClick={props.onSave}>保存 .mgeo</button><button onClick={props.onOpen}>打开 .mgeo</button>
  </div>
}
