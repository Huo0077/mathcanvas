import { useEffect, useState, type ChangeEvent, type ReactNode } from "react"
import type { PrimitiveSpec } from "@draw/dsl"
import { evaluateParameterExpression, parseExpression, sampleFunctionSegments } from "@draw/geometry-kernel"
import type { Alignment, PrimitiveUpdatePatch } from "@draw/scene-graph"

import { defaultStrokeFor } from "../primitiveStyle"
interface PropertiesBarProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  selectedPrimitive: PrimitiveSpec | null
  selectedCount: number
  selectedGroupId: string | null
  allSelectedVisible: boolean
  canCreateIntersection: boolean
  onUpdatePrimitive: (patch: PrimitiveUpdatePatch) => void
  onToggleSelectedVisibility: () => void
  onToggleSelectedLock: () => void
  onCreateGroup: () => void
  onDeleteGroup: () => void
  onCreateIntersection: () => void
  onAlign: (alignment: Alignment) => void
  onToggleBatchVisibility: () => void
}

const alignments: { value: Alignment; label: string }[] = [
  { value: "left", label: "左对齐" }, { value: "right", label: "右对齐" },
  { value: "top", label: "上对齐" }, { value: "bottom", label: "下对齐" },
  { value: "horizontalCenter", label: "横向居中（X）" }, { value: "verticalCenter", label: "纵向居中（Y）" }
]

type LinearPrimitive = Extract<PrimitiveSpec, { type: "line" | "segment" | "ray" }>
type ConicPrimitive = Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }>

function numberValue(event: ChangeEvent<HTMLInputElement>): number {
  return Number(event.target.value)
}

function rotationDegrees(rotation = 0): number {
  return rotation * 180 / Math.PI
}

function rotationRadians(degrees: number): number {
  return degrees * Math.PI / 180
}

function rotatePoint(center: { x: number; y: number }, x: number, y: number, rotation: number): { x: number; y: number } {
  return { x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) }
}

function lineSlope(line: LinearPrimitive): number | null {
  const deltaX = line.b.x - line.a.x
  return Math.abs(deltaX) < 1e-9 ? null : (line.b.y - line.a.y) / deltaX
}

function lineAngle(line: LinearPrimitive): number {
  return Math.atan2(line.b.y - line.a.y, line.b.x - line.a.x) * 180 / Math.PI
}

function lineLength(line: LinearPrimitive): number {
  return Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label>{label}{children}</label>
}

function CoordinateField({ label, value, onChange, disabled = false, readOnly = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean; readOnly?: boolean }) {
  return <Field label={label}><input aria-label={label} type="number" step="0.1" value={value} disabled={disabled} readOnly={readOnly} onChange={(event) => onChange(numberValue(event))} /></Field>
}

export function PropertiesBar({ value, min, max, step, onChange, selectedPrimitive, selectedCount, selectedGroupId, allSelectedVisible, canCreateIntersection, onUpdatePrimitive, onToggleSelectedVisibility, onToggleSelectedLock, onCreateGroup, onDeleteGroup, onCreateIntersection, onAlign, onToggleBatchVisibility }: PropertiesBarProps) {
  const selectedPoint = selectedPrimitive?.type === "point" ? selectedPrimitive : null
  const selectedLinear = selectedPrimitive?.type === "line" || selectedPrimitive?.type === "segment" || selectedPrimitive?.type === "ray" ? selectedPrimitive : null
  const selectedPolyline = selectedPrimitive?.type === "polyline" ? selectedPrimitive : null
  const selectedParabola = selectedPrimitive?.type === "parabola" ? selectedPrimitive : null
  const selectedEllipseOrHyperbola = selectedPrimitive?.type === "ellipse" || selectedPrimitive?.type === "hyperbola" ? selectedPrimitive : null
  const selectedFunction = selectedPrimitive?.type === "function" ? selectedPrimitive : null
  const selectedCircleOrArc = selectedPrimitive?.type === "circle" || selectedPrimitive?.type === "arc" ? selectedPrimitive : null
  const selectedIntersection = selectedPrimitive && ["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection"].includes(selectedPrimitive.type) ? selectedPrimitive as Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" | "curveIntersection" }> : null
  const selectedSlope = selectedLinear ? lineSlope(selectedLinear) : null
  const showSlopeParameter = selectedLinear?.type === "line" && Boolean(selectedLinear.slopeParameter)
  const editable = selectedPrimitive?.locked !== true
  const [expressionDraft, setExpressionDraft] = useState(selectedFunction?.expression ?? "")
  const [expressionError, setExpressionError] = useState<string | null>(null)

  useEffect(() => {
    setExpressionDraft(selectedFunction?.expression ?? "")
    setExpressionError(null)
  }, [selectedFunction?.id, selectedFunction?.expression])

  const updatePoint = (axis: "x" | "y", next: number) => selectedPoint && editable && onUpdatePrimitive({ [axis]: next })
  const updateCenter = (axis: "x" | "y", next: number) => selectedCircleOrArc && editable && onUpdatePrimitive({ center: { ...selectedCircleOrArc.center, [axis]: next } })
  const updateEndpoint = (endpoint: "a" | "b", axis: "x" | "y", next: number) => selectedLinear && editable && !(selectedLinear.type === "line" && selectedLinear.slopeParameter && endpoint === "b" && axis === "y") && onUpdatePrimitive({ [endpoint]: { ...selectedLinear[endpoint], [axis]: next } })
  const updateSlope = (next: number) => {
    if (!selectedLinear || showSlopeParameter || !editable) return
    const deltaX = Math.abs(selectedLinear.b.x - selectedLinear.a.x) < 1e-9 ? 1 : selectedLinear.b.x - selectedLinear.a.x
    onUpdatePrimitive({ b: { x: selectedLinear.a.x + deltaX, y: selectedLinear.a.y + next * deltaX } })
  }
  const updatePolylinePoint = (index: number, axis: "x" | "y", next: number) => selectedPolyline && editable && onUpdatePrimitive({ points: selectedPolyline.points.map((point, pointIndex) => pointIndex === index ? { ...point, [axis]: next } : point) })
  const updateFunctionDomain = (index: 0 | 1, next: number) => {
    if (!selectedFunction || !editable) return
    const domain: [number, number] = [...selectedFunction.domain]
    domain[index] = next
    onUpdatePrimitive({ domain })
  }
  const updateConicCenter = (axis: "x" | "y", next: number) => selectedEllipseOrHyperbola && editable && onUpdatePrimitive({ center: { ...selectedEllipseOrHyperbola.center, [axis]: next } })
  const updateParabolaVertex = (axis: "x" | "y", next: number) => selectedParabola && editable && onUpdatePrimitive({ vertex: { ...selectedParabola.vertex, [axis]: next } })
  const updateRotation = (next: number) => editable && onUpdatePrimitive({ rotation: rotationRadians(next) })
  const parabolaFocus = (conic: Extract<ConicPrimitive, { type: "parabola" }>) => {
    const distance = conic.focalParameter / 2
    return rotatePoint(conic.vertex, conic.axis === "x" ? distance : 0, conic.axis === "y" ? distance : 0, conic.rotation ?? 0)
  }

  const conicFoci = (conic: Extract<ConicPrimitive, { type: "ellipse" | "hyperbola" }>) => {
    const majorRadius = Math.max(conic.radiusX, conic.radiusY)
    const minorRadius = Math.min(conic.radiusX, conic.radiusY)
    const distance = conic.type === "ellipse"
      ? Math.sqrt(Math.max(majorRadius ** 2 - minorRadius ** 2, 0))
      : Math.sqrt(conic.radiusX ** 2 + conic.radiusY ** 2)
    const alongX = conic.type === "hyperbola" ? conic.axis === "x" : conic.radiusX >= conic.radiusY
    const first = rotatePoint(conic.center, alongX ? distance : 0, alongX ? 0 : distance, conic.rotation ?? 0)
    const second = rotatePoint(conic.center, alongX ? -distance : 0, alongX ? 0 : -distance, conic.rotation ?? 0)
    return { first, second }
  }
  const ellipseMetrics = selectedEllipseOrHyperbola?.type === "ellipse" ? {
    major: Math.max(selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.radiusY),
    minor: Math.min(selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.radiusY),
    eccentricity: Math.sqrt(Math.max(Math.max(selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.radiusY) ** 2 - Math.min(selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.radiusY) ** 2, 0)) / Math.max(selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.radiusY)
  } : null
  const hyperbolaMetrics = selectedEllipseOrHyperbola?.type === "hyperbola" ? {
    eccentricity: Math.sqrt(selectedEllipseOrHyperbola.radiusX ** 2 + selectedEllipseOrHyperbola.radiusY ** 2) / (selectedEllipseOrHyperbola.axis === "x" ? selectedEllipseOrHyperbola.radiusX : selectedEllipseOrHyperbola.radiusY),
    asymptoteAngle: Math.atan2(selectedEllipseOrHyperbola.axis === "x" ? selectedEllipseOrHyperbola.radiusY : selectedEllipseOrHyperbola.radiusX, selectedEllipseOrHyperbola.axis === "x" ? selectedEllipseOrHyperbola.radiusX : selectedEllipseOrHyperbola.radiusY) * 180 / Math.PI + (selectedEllipseOrHyperbola.rotation ?? 0) * 180 / Math.PI
  } : null
  const arcAngle = selectedCircleOrArc?.type === "arc" ? Math.abs(selectedCircleOrArc.endAngle - selectedCircleOrArc.startAngle) : 0
  const updateFunctionExpression = (source: string) => {
    setExpressionDraft(source)
    try {
      parseExpression(source)
      setExpressionError(null)
      onUpdatePrimitive({ expression: source })
    } catch {
      setExpressionError("表达式暂不可计算")
    }
  }
  const functionMetrics = selectedFunction ? (() => {
    try {
      const segments = sampleFunctionSegments((x) => evaluateParameterExpression(selectedFunction.expression, { x }), selectedFunction.domain, selectedFunction.samples ?? 128)
      const values = segments.flat().map((point) => point.y)
      if (!values.length) return null
      return { min: Math.min(...values), max: Math.max(...values) }
    } catch {
      return null
    }
  })() : null

  return <section className="panel-section properties">
    <h2 className="panel-title">Properties Bar</h2>
    {!selectedPrimitive && <>
      <label className="properties-label" htmlFor="slope-slider"><span>直线斜率参数</span><strong className="metric">{value.toFixed(2)}</strong></label>
      <input id="slope-slider" aria-label="直线斜率" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(numberValue(event))} />
      <p className="footer-note">选择图元后，这里会切换为对应的几何属性。</p>
    </>}
    {selectedPrimitive && <div className="primitive-properties">
      <h3>{selectedPrimitive.label ?? selectedPrimitive.id}</h3>
      <Field label="图元名称"><input aria-label="图元名称" type="text" value={selectedPrimitive.label ?? ""} placeholder={selectedPrimitive.id} onChange={(event) => onUpdatePrimitive({ label: event.target.value })} /></Field>
      <div className="property-actions">
        <button type="button" onClick={onToggleSelectedVisibility}>{selectedPrimitive.visible === false ? "显示图元" : "隐藏图元"}</button>
        <button type="button" onClick={onToggleSelectedLock}>{selectedPrimitive.locked ? "解锁图元" : "锁定图元"}</button>
      </div>
      <Field label="线条颜色"><input aria-label="线条颜色" type="color" disabled={!editable} value={selectedPrimitive.style?.stroke ?? defaultStrokeFor(selectedPrimitive)} onChange={(event) => onUpdatePrimitive({ style: { stroke: event.target.value } })} /></Field>
      {(["point", "circle", "ellipse", "intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection"] as PrimitiveSpec["type"][]).includes(selectedPrimitive.type) && <Field label="填充颜色"><input aria-label="填充颜色" type="color" disabled={!editable} value={selectedPrimitive.style?.fill ?? "#ffffff"} onChange={(event) => onUpdatePrimitive({ style: { fill: event.target.value } })} /></Field>}
      <Field label="线宽"><input aria-label="线宽" type="number" disabled={!editable} min="0.5" max="20" step="0.5" value={selectedPrimitive.style?.strokeWidth ?? 3} onChange={(event) => onUpdatePrimitive({ style: { strokeWidth: Math.max(0.5, numberValue(event)) } })} /></Field>
      <Field label="透明度"><input aria-label="透明度" type="number" disabled={!editable} min="0" max="1" step="0.05" value={selectedPrimitive.style?.opacity ?? 1} onChange={(event) => onUpdatePrimitive({ style: { opacity: Math.min(1, Math.max(0, numberValue(event))) } })} /></Field>
      <Field label="线型"><select aria-label="线型" disabled={!editable} value={selectedPrimitive.style?.dash ?? "solid"} onChange={(event) => onUpdatePrimitive({ style: { dash: event.target.value === "solid" ? undefined : event.target.value } })}><option value="solid">实线</option><option value="8 6">虚线</option><option value="2 5">点线</option></select></Field>
    </div>}
     {showSlopeParameter && <div className="primitive-properties"><label className="properties-label" htmlFor="selected-slope-slider"><span>直线斜率参数</span><strong className="metric">{value.toFixed(2)}</strong></label><input id="selected-slope-slider" aria-label="选中直线斜率" type="range" disabled={!editable} min={min} max={max} step={step} value={value} onChange={(event) => onChange(numberValue(event))} /></div>}
     {selectedPoint && <div className="primitive-properties"><h3>点坐标</h3><CoordinateField label="点 X" value={selectedPoint.x} disabled={!editable} onChange={(next) => updatePoint("x", next)} /><CoordinateField label="点 Y" value={selectedPoint.y} disabled={!editable} onChange={(next) => updatePoint("y", next)} /></div>}
     {selectedLinear && <div className="primitive-properties"><h3>斜率特征</h3><div className="metric-grid"><span>倾角<strong>{lineAngle(selectedLinear).toFixed(2)}°</strong></span><span>长度<strong>{lineLength(selectedLinear).toFixed(2)}</strong></span><span>方向向量<strong>({(selectedLinear.b.x - selectedLinear.a.x).toFixed(2)}, {(selectedLinear.b.y - selectedLinear.a.y).toFixed(2)})</strong></span><span>截距<strong>{selectedSlope === null ? "垂直线" : (selectedLinear.a.y - selectedSlope * selectedLinear.a.x).toFixed(2)}</strong></span></div>{selectedSlope === null ? <button type="button" disabled={!editable} onClick={() => updateSlope(0)}>设为水平线</button> : <Field label="斜率"><input aria-label="选中直线斜率值" type="number" step="0.1" value={selectedSlope} readOnly={showSlopeParameter} disabled={!editable} onChange={(event) => updateSlope(numberValue(event))} /></Field>}{(["a", "b"] as const).map((endpoint) => <div key={endpoint} className="endpoint-group"><strong>{selectedLinear.type === "ray" && endpoint === "a" ? "起点 A" : selectedLinear.type === "ray" && endpoint === "b" ? "方向点 B" : `端点 ${endpoint.toUpperCase()}`}</strong><CoordinateField label={`${selectedLinear.type === "ray" ? endpoint === "a" ? "起点" : "方向点" : "端点"} ${endpoint.toUpperCase()} X`} value={selectedLinear[endpoint].x} disabled={!editable} onChange={(next) => updateEndpoint(endpoint, "x", next)} /><CoordinateField label={`${selectedLinear.type === "ray" ? endpoint === "a" ? "起点" : "方向点" : "端点"} ${endpoint.toUpperCase()} Y`} value={selectedLinear[endpoint].y} disabled={!editable || (selectedLinear.type === "line" && Boolean(selectedLinear.slopeParameter) && endpoint === "b")} onChange={(next) => updateEndpoint(endpoint, "y", next)} /></div>)}</div>}
     {selectedPolyline && <div className="primitive-properties"><h3>折线属性</h3><p className="footer-note">共 {selectedPolyline.points.length} 个顶点</p>{selectedPolyline.points.map((point, index) => <div key={`${selectedPolyline.id}-${index}`} className="endpoint-group"><strong>顶点 {index + 1}</strong><CoordinateField label={`顶点 ${index + 1} X`} value={point.x} disabled={!editable} onChange={(next) => updatePolylinePoint(index, "x", next)} /><CoordinateField label={`顶点 ${index + 1} Y`} value={point.y} disabled={!editable} onChange={(next) => updatePolylinePoint(index, "y", next)} /></div>)}</div>}
     {selectedParabola && <div className="primitive-properties"><h3>抛物线属性</h3><CoordinateField label="顶点 X" value={selectedParabola.vertex.x} disabled={!editable} onChange={(next) => updateParabolaVertex("x", next)} /><CoordinateField label="顶点 Y" value={selectedParabola.vertex.y} disabled={!editable} onChange={(next) => updateParabolaVertex("y", next)} /><Field label="焦参数"><input aria-label="焦参数" type="number" disabled={!editable} step="0.1" value={selectedParabola.focalParameter} onChange={(event) => onUpdatePrimitive({ focalParameter: numberValue(event) })} /></Field><Field label="轴向"><select aria-label="抛物线轴向" disabled={!editable} value={selectedParabola.axis} onChange={(event) => onUpdatePrimitive({ axis: event.target.value as "x" | "y" })}><option value="x">横轴</option><option value="y">纵轴</option></select></Field><Field label="旋转角度（度）"><input aria-label="抛物线旋转角度" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedParabola.rotation)} onChange={(event) => updateRotation(numberValue(event))} /></Field><p className="footer-note">焦点：{(() => { const focus = parabolaFocus(selectedParabola); return `(${focus.x.toFixed(2)}, ${focus.y.toFixed(2)})` })()}</p></div>}
     {selectedEllipseOrHyperbola && <div className="primitive-properties"><h3>{selectedEllipseOrHyperbola.type === "ellipse" ? "椭圆属性" : "双曲线属性"}</h3><CoordinateField label="中心 X" value={selectedEllipseOrHyperbola.center.x} disabled={!editable} onChange={(next) => updateConicCenter("x", next)} /><CoordinateField label="中心 Y" value={selectedEllipseOrHyperbola.center.y} disabled={!editable} onChange={(next) => updateConicCenter("y", next)} /><Field label="横向半径"><input aria-label="横向半径" type="number" disabled={!editable} min="0.01" step="0.1" value={selectedEllipseOrHyperbola.radiusX} onChange={(event) => onUpdatePrimitive({ radiusX: Math.max(0.01, numberValue(event)) })} /></Field><Field label="纵向半径"><input aria-label="纵向半径" type="number" disabled={!editable} min="0.01" step="0.1" value={selectedEllipseOrHyperbola.radiusY} onChange={(event) => onUpdatePrimitive({ radiusY: Math.max(0.01, numberValue(event)) })} /></Field>{selectedEllipseOrHyperbola.type === "hyperbola" && <Field label="轴向"><select aria-label="双曲线轴向" disabled={!editable} value={selectedEllipseOrHyperbola.axis} onChange={(event) => onUpdatePrimitive({ axis: event.target.value as "x" | "y" })}><option value="x">横轴</option><option value="y">纵轴</option></select></Field>}<Field label="旋转角度（度）"><input aria-label={`${selectedEllipseOrHyperbola.type === "ellipse" ? "椭圆" : "双曲线"}旋转角度`} type="number" disabled={!editable} step="1" value={rotationDegrees(selectedEllipseOrHyperbola.rotation)} onChange={(event) => updateRotation(numberValue(event))} /></Field><p className="footer-note">焦点：{(() => { const focus = conicFoci(selectedEllipseOrHyperbola); return `(${focus.first.x.toFixed(2)}, ${focus.first.y.toFixed(2)}) / (${focus.second.x.toFixed(2)}, ${focus.second.y.toFixed(2)})` })()}</p>{ellipseMetrics && <div className="metric-grid"><span>长半轴<strong>{ellipseMetrics.major.toFixed(2)}</strong></span><span>短半轴<strong>{ellipseMetrics.minor.toFixed(2)}</strong></span><span>离心率<strong>{ellipseMetrics.eccentricity.toFixed(3)}</strong></span><span>面积<strong>{(Math.PI * selectedEllipseOrHyperbola.radiusX * selectedEllipseOrHyperbola.radiusY).toFixed(2)}</strong></span></div>}{hyperbolaMetrics && <div className="metric-grid"><span>离心率<strong>{hyperbolaMetrics.eccentricity.toFixed(3)}</strong></span><span>渐近线角<strong>{hyperbolaMetrics.asymptoteAngle.toFixed(2)}°</strong></span></div>}</div>}
     {selectedFunction && <div className="primitive-properties"><h3>函数图像属性</h3><Field label="表达式"><input aria-label="函数表达式" type="text" disabled={!editable} value={expressionDraft} onChange={(event) => updateFunctionExpression(event.target.value)} /></Field>{expressionError && <p className="footer-note" role="alert">{expressionError}</p>}<CoordinateField label="定义域起点" value={selectedFunction.domain[0]} disabled={!editable} onChange={(next) => updateFunctionDomain(0, next)} /><CoordinateField label="定义域终点" value={selectedFunction.domain[1]} disabled={!editable} onChange={(next) => updateFunctionDomain(1, next)} /><Field label="采样点数"><input aria-label="采样点数" type="number" disabled={!editable} min="2" max="2048" step="1" value={selectedFunction.samples ?? 128} onChange={(event) => onUpdatePrimitive({ samples: numberValue(event) })} /></Field><p className="footer-note">定义域 [{selectedFunction.domain[0]}, {selectedFunction.domain[1]}] · {selectedFunction.samples ?? 128} 个采样点</p>{functionMetrics && <p className="footer-note">值域 [{functionMetrics.min.toFixed(2)}, {functionMetrics.max.toFixed(2)}]</p>}</div>}
     {selectedCircleOrArc && <div className="primitive-properties"><h3>{selectedCircleOrArc.type === "circle" ? "圆属性" : "圆弧属性"}</h3><CoordinateField label="圆心 X" value={selectedCircleOrArc.center.x} disabled={!editable} onChange={(next) => updateCenter("x", next)} /><CoordinateField label="圆心 Y" value={selectedCircleOrArc.center.y} disabled={!editable} onChange={(next) => updateCenter("y", next)} /><Field label="半径"><input aria-label="半径" type="number" disabled={!editable} min="0.01" step="0.1" value={selectedCircleOrArc.radius} onChange={(event) => onUpdatePrimitive({ radius: Math.max(0.01, numberValue(event)) })} /></Field>{selectedCircleOrArc.type === "arc" && <><Field label="起始角（度）"><input aria-label="起始角" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedCircleOrArc.startAngle)} onChange={(event) => onUpdatePrimitive({ startAngle: rotationRadians(numberValue(event)) })} /></Field><Field label="结束角（度）"><input aria-label="结束角" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedCircleOrArc.endAngle)} onChange={(event) => onUpdatePrimitive({ endAngle: rotationRadians(numberValue(event)) })} /></Field></>}{selectedCircleOrArc.type === "circle" ? <div className="metric-grid"><span>周长<strong>{(2 * Math.PI * selectedCircleOrArc.radius).toFixed(2)}</strong></span><span>面积<strong>{(Math.PI * selectedCircleOrArc.radius ** 2).toFixed(2)}</strong></span></div> : <div className="metric-grid"><span>圆心角<strong>{(arcAngle * 180 / Math.PI).toFixed(2)}°</strong></span><span>弧长<strong>{(arcAngle * selectedCircleOrArc.radius).toFixed(2)}</strong></span></div>}</div>}
     {selectedIntersection && <div className="primitive-properties"><h3>派生交点</h3><p className="footer-note">该点由其他图元计算，不可直接拖动。</p><CoordinateField label="交点 X" value={selectedIntersection.x} readOnly onChange={() => undefined} /><CoordinateField label="交点 Y" value={selectedIntersection.y} readOnly onChange={() => undefined} /></div>}
    {selectedCount > 1 && <div className="batch-properties"><h3>批量编辑 · {selectedCount} 个对象</h3><div className="batch-actions">{canCreateIntersection && <button aria-label="添加交点" onClick={onCreateIntersection}>添加交点</button>}<button aria-label={selectedGroupId ? "取消分组" : "创建分组"} onClick={selectedGroupId ? onDeleteGroup : onCreateGroup}>{selectedGroupId ? "取消分组" : "创建分组"}</button><button aria-label={allSelectedVisible ? "批量隐藏" : "批量显示"} onClick={onToggleBatchVisibility}>{allSelectedVisible ? "批量隐藏" : "批量显示"}</button>{alignments.map((alignment) => <button key={alignment.value} aria-label={alignment.label} onClick={() => onAlign(alignment.value)}>{alignment.label}</button>)}</div></div>}
  </section>
}
