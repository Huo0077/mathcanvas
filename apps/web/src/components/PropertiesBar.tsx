import type { ChangeEvent } from "react"
import type { PrimitiveSpec } from "@draw/dsl"
import type { Alignment, PrimitiveUpdatePatch } from "@draw/scene-graph"

interface PropertiesBarProps { value: number; min: number; max: number; step: number; onChange: (value: number) => void; selectedPrimitive: PrimitiveSpec | null; selectedCount: number; selectedGroupId: string | null; allSelectedVisible: boolean; onUpdatePrimitive: (patch: PrimitiveUpdatePatch) => void; onCreateGroup: () => void; onDeleteGroup: () => void; onAlign: (alignment: Alignment) => void; onToggleBatchVisibility: () => void }

const alignments: { value: Alignment; label: string }[] = [
  { value: "left", label: "左对齐" }, { value: "right", label: "右对齐" },
  { value: "top", label: "上对齐" }, { value: "bottom", label: "下对齐" },
  { value: "horizontalCenter", label: "横向居中（X）" }, { value: "verticalCenter", label: "纵向居中（Y）" }
]

export function PropertiesBar({ value, min, max, step, onChange, selectedPrimitive, selectedCount, selectedGroupId, allSelectedVisible, onUpdatePrimitive, onCreateGroup, onDeleteGroup, onAlign, onToggleBatchVisibility }: PropertiesBarProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))
  const selectedCircleOrArc = selectedPrimitive?.type === "circle" || selectedPrimitive?.type === "arc" ? selectedPrimitive : null
  const selectedLinear = selectedPrimitive?.type === "line" || selectedPrimitive?.type === "segment" || selectedPrimitive?.type === "ray" ? selectedPrimitive : null
  const selectedPolyline = selectedPrimitive?.type === "polyline" ? selectedPrimitive : null
  const updateNumber = (field: "radius" | "startAngle" | "endAngle", event: ChangeEvent<HTMLInputElement>) => onUpdatePrimitive({ [field]: Number(event.target.value) })
  const updateCenter = (axis: "x" | "y", event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedCircleOrArc) return
    onUpdatePrimitive({ center: { ...selectedCircleOrArc.center, [axis]: Number(event.target.value) } })
  }
  const updateEndpoint = (endpoint: "a" | "b", axis: "x" | "y", event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedLinear) return
    onUpdatePrimitive({ [endpoint]: { ...selectedLinear[endpoint], [axis]: Number(event.target.value) } })
  }
  const updatePolylinePoint = (index: number, axis: "x" | "y", event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedPolyline) return
    onUpdatePrimitive({ points: selectedPolyline.points.map((point, pointIndex) => pointIndex === index ? { ...point, [axis]: Number(event.target.value) } : point) })
  }
  return <section className="panel-section properties"><h2 className="panel-title">Properties Bar</h2><label className="properties-label" htmlFor="slope-slider"><span>直线斜率</span><strong className="metric">{value.toFixed(2)}</strong></label><input id="slope-slider" aria-label="直线斜率" type="range" min={min} max={max} step={step} value={value} onChange={handleChange} /><p className="footer-note">拖动滑块，交点会通过 DAG 自动重算。</p>{selectedCount > 1 && <div className="batch-properties"><h3>批量编辑 · {selectedCount} 个对象</h3><div className="batch-actions"><button aria-label={selectedGroupId ? "取消分组" : "创建分组"} onClick={selectedGroupId ? onDeleteGroup : onCreateGroup}>{selectedGroupId ? "取消分组" : "创建分组"}</button><button aria-label={allSelectedVisible ? "批量隐藏" : "批量显示"} onClick={onToggleBatchVisibility}>{allSelectedVisible ? "批量隐藏" : "批量显示"}</button>{alignments.map((alignment) => <button key={alignment.value} aria-label={alignment.label} onClick={() => onAlign(alignment.value)}>{alignment.label}</button>)}</div></div>}{selectedLinear && <div className="primitive-properties"><h3>{selectedLinear.label ?? selectedLinear.id}</h3>{(["a", "b"] as const).map((endpoint) => <div key={endpoint} className="endpoint-group"><strong>{selectedLinear.type === "ray" && endpoint === "a" ? "起点 A" : selectedLinear.type === "ray" && endpoint === "b" ? "方向点 B" : `端点 ${endpoint.toUpperCase()}`}</strong><label>X<input aria-label={`${selectedLinear.type === "ray" ? endpoint === "a" ? "起点" : "方向点" : "端点"} ${endpoint.toUpperCase()} X`} type="number" step="0.1" value={selectedLinear[endpoint].x} onChange={(event) => updateEndpoint(endpoint, "x", event)} /></label><label>Y<input aria-label={`${selectedLinear.type === "ray" ? endpoint === "a" ? "起点" : "方向点" : "端点"} ${endpoint.toUpperCase()} Y`} type="number" step="0.1" value={selectedLinear[endpoint].y} onChange={(event) => updateEndpoint(endpoint, "y", event)} /></label></div>)}</div>}{selectedPolyline && <div className="primitive-properties"><h3>{selectedPolyline.label ?? selectedPolyline.id}</h3><p className="footer-note">共 {selectedPolyline.points.length} 个顶点</p>{selectedPolyline.points.map((point, index) => <div key={`${selectedPolyline.id}-${index}`} className="endpoint-group"><strong>顶点 {index + 1}</strong><label>X<input aria-label={`顶点 ${index + 1} X`} type="number" step="0.1" value={point.x} onChange={(event) => updatePolylinePoint(index, "x", event)} /></label><label>Y<input aria-label={`顶点 ${index + 1} Y`} type="number" step="0.1" value={point.y} onChange={(event) => updatePolylinePoint(index, "y", event)} /></label></div>)}</div>}{selectedCircleOrArc && <div className="primitive-properties"><h3>{selectedCircleOrArc.label ?? selectedCircleOrArc.id}</h3><label>圆心 X<input aria-label="圆心 X" type="number" step="0.1" value={selectedCircleOrArc.center.x} onChange={(event) => updateCenter("x", event)} /></label><label>圆心 Y<input aria-label="圆心 Y" type="number" step="0.1" value={selectedCircleOrArc.center.y} onChange={(event) => updateCenter("y", event)} /></label><label>半径<input aria-label="半径" type="number" min="0.01" step="0.1" value={selectedCircleOrArc.radius} onChange={(event) => updateNumber("radius", event)} /></label>{selectedCircleOrArc.type === "arc" && <><label>起始角<input aria-label="起始角" type="number" step="0.1" value={selectedCircleOrArc.startAngle} onChange={(event) => updateNumber("startAngle", event)} /></label><label>结束角<input aria-label="结束角" type="number" step="0.1" value={selectedCircleOrArc.endAngle} onChange={(event) => updateNumber("endAngle", event)} /></label></>}</div>}</section>
}
