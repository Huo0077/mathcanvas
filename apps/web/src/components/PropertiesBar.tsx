import type { ChangeEvent } from "react"
import type { PrimitiveSpec } from "@draw/dsl"
import type { PrimitiveUpdatePatch } from "@draw/scene-graph"

interface PropertiesBarProps { value: number; min: number; max: number; step: number; onChange: (value: number) => void; selectedPrimitive: PrimitiveSpec | null; onUpdatePrimitive: (patch: PrimitiveUpdatePatch) => void }

export function PropertiesBar({ value, min, max, step, onChange, selectedPrimitive, onUpdatePrimitive }: PropertiesBarProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => onChange(Number(event.target.value))
  const selectedCircleOrArc = selectedPrimitive?.type === "circle" || selectedPrimitive?.type === "arc" ? selectedPrimitive : null
  const selectedLine = selectedPrimitive?.type === "line" || selectedPrimitive?.type === "segment" ? selectedPrimitive : null
  const updateNumber = (field: "radius" | "startAngle" | "endAngle", event: ChangeEvent<HTMLInputElement>) => onUpdatePrimitive({ [field]: Number(event.target.value) })
  const updateCenter = (axis: "x" | "y", event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedCircleOrArc) return
    onUpdatePrimitive({ center: { ...selectedCircleOrArc.center, [axis]: Number(event.target.value) } })
  }
  const updateEndpoint = (endpoint: "a" | "b", axis: "x" | "y", event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedLine) return
    onUpdatePrimitive({ [endpoint]: { ...selectedLine[endpoint], [axis]: Number(event.target.value) } })
  }
  return <section className="panel-section properties"><h2 className="panel-title">Properties Bar</h2><label className="properties-label" htmlFor="slope-slider"><span>直线斜率</span><strong className="metric">{value.toFixed(2)}</strong></label><input id="slope-slider" aria-label="直线斜率" type="range" min={min} max={max} step={step} value={value} onChange={handleChange} /><p className="footer-note">拖动滑块，交点会通过 DAG 自动重算。</p>{selectedLine && <div className="primitive-properties"><h3>{selectedLine.label ?? selectedLine.id}</h3>{(["a", "b"] as const).map((endpoint) => <div key={endpoint} className="endpoint-group"><strong>端点 {endpoint.toUpperCase()}</strong><label>X<input aria-label={`端点 ${endpoint.toUpperCase()} X`} type="number" step="0.1" value={selectedLine[endpoint].x} onChange={(event) => updateEndpoint(endpoint, "x", event)} /></label><label>Y<input aria-label={`端点 ${endpoint.toUpperCase()} Y`} type="number" step="0.1" value={selectedLine[endpoint].y} onChange={(event) => updateEndpoint(endpoint, "y", event)} /></label></div>)}</div>}{selectedCircleOrArc && <div className="primitive-properties"><h3>{selectedCircleOrArc.label ?? selectedCircleOrArc.id}</h3><label>圆心 X<input aria-label="圆心 X" type="number" step="0.1" value={selectedCircleOrArc.center.x} onChange={(event) => updateCenter("x", event)} /></label><label>圆心 Y<input aria-label="圆心 Y" type="number" step="0.1" value={selectedCircleOrArc.center.y} onChange={(event) => updateCenter("y", event)} /></label><label>半径<input aria-label="半径" type="number" min="0.01" step="0.1" value={selectedCircleOrArc.radius} onChange={(event) => updateNumber("radius", event)} /></label>{selectedCircleOrArc.type === "arc" && <><label>起始角<input aria-label="起始角" type="number" step="0.1" value={selectedCircleOrArc.startAngle} onChange={(event) => updateNumber("startAngle", event)} /></label><label>结束角<input aria-label="结束角" type="number" step="0.1" value={selectedCircleOrArc.endAngle} onChange={(event) => updateNumber("endAngle", event)} /></label></>}</div>}</section>
}
