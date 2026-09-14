import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react"
import type { AnnotationFeature, PrimitiveSpec, Vector3 } from "@draw/dsl"
import { adaptiveSampleFunctionSegments, advanceAnimation, evaluateParameterExpression, parseExpression, type AnimationMode, type AnimationState } from "@draw/geometry-kernel"
import type { Alignment, PrimitiveUpdatePatch } from "@draw/scene-graph"

import { defaultStrokeFor } from "../primitiveStyle"
import { annotationFeatureOptions } from "../annotations"
import { insertFormulaTemplate } from "../formulaEditor"
import { FormulaKeyboard } from "./FormulaKeyboard"
import { useSceneStore } from "../store"
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
  onAddAnnotation: (feature: AnnotationFeature, index?: number, text?: string) => void
}

const alignments: { value: Alignment; label: string }[] = [
  { value: "left", label: "左对齐" }, { value: "right", label: "右对齐" },
  { value: "top", label: "上对齐" }, { value: "bottom", label: "下对齐" },
  { value: "horizontalCenter", label: "横向居中（X）" }, { value: "verticalCenter", label: "纵向居中（Y）" }
]

type LinearPrimitive = Extract<PrimitiveSpec, { type: "line" | "segment" | "ray" }>
type ConicPrimitive = Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }>
type SolidPrimitive = Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>

const primitiveTypeLabels: Record<PrimitiveSpec["type"], string> = {
  point: "点",
  point3: "空间点",
  line: "直线",
  line3: "空间直线",
  segment: "线段",
  segment3: "空间线段",
  ray: "射线",
  ray3: "空间射线",
  polyline: "折线",
  connection: "点连接",
  locus: "轨迹",
  parabola: "抛物线",
  ellipse: "椭圆",
  hyperbola: "双曲线",
  function: "函数",
  derivative: "导函数",
  tangent: "切线",
  normal: "法线",
  secant: "割线",
  integral: "积分区域",
  analysisSet: "分析结果",
  cube: "立方体",
  pyramid: "棱锥",
  cylinder: "圆柱",
  cone: "圆锥",
  plane3: "空间平面",
  circle3: "空间圆",
  edge3: "空间棱",
  face3: "空间面",
  polyhedron3: "多面体",
  section: "截面",
  circle: "圆",
  arc: "圆弧",
  intersection: "直线交点",
  lineCircleIntersection: "线圆交点",
  circleIntersection: "圆交点",
  curveIntersection: "曲线交点",
  intersectionSet: "交点集合"
}

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

function Vector3Fields({ prefix, value, disabled, onChange }: { prefix: string; value: Vector3; disabled: boolean; onChange: (axis: keyof Vector3, value: number) => void }) {
  return <div className="metric-grid"><CoordinateField label={`${prefix} X`} value={value.x} disabled={disabled} onChange={(next) => onChange("x", next)} /><CoordinateField label={`${prefix} Y`} value={value.y} disabled={disabled} onChange={(next) => onChange("y", next)} /><CoordinateField label={`${prefix} Z`} value={value.z} disabled={disabled} onChange={(next) => onChange("z", next)} /></div>
}

export function PropertiesBar({ value, min, max, step, onChange, selectedPrimitive, selectedCount, selectedGroupId, allSelectedVisible, canCreateIntersection, onUpdatePrimitive, onToggleSelectedVisibility, onToggleSelectedLock, onCreateGroup, onDeleteGroup, onCreateIntersection, onAlign, onToggleBatchVisibility, onAddAnnotation }: PropertiesBarProps) {
  const selectedPoint = selectedPrimitive?.type === "point" ? selectedPrimitive : null
  const selectedLinear = selectedPrimitive?.type === "line" || selectedPrimitive?.type === "segment" || selectedPrimitive?.type === "ray" ? selectedPrimitive : null
  const selectedPolyline = selectedPrimitive?.type === "polyline" ? selectedPrimitive : null
  const selectedParabola = selectedPrimitive?.type === "parabola" ? selectedPrimitive : null
  const selectedEllipseOrHyperbola = selectedPrimitive?.type === "ellipse" || selectedPrimitive?.type === "hyperbola" ? selectedPrimitive : null
  const selectedFunction = selectedPrimitive?.type === "function" ? selectedPrimitive : null
  const selectedCircleOrArc = selectedPrimitive?.type === "circle" || selectedPrimitive?.type === "arc" ? selectedPrimitive : null
  const selectedSolid = selectedPrimitive && ["cube", "pyramid", "cylinder", "cone"].includes(selectedPrimitive.type) ? selectedPrimitive as SolidPrimitive : null
  const selectedDerivedPoint = selectedPrimitive && (selectedPrimitive.type === "tangent" || selectedPrimitive.type === "normal" || selectedPrimitive.type === "secant") ? ("point" in selectedPrimitive ? selectedPrimitive.point : selectedPrimitive.points[0]) : null
  const selectedIntersection = selectedPrimitive && ["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection", "intersectionSet"].includes(selectedPrimitive.type) ? selectedPrimitive as Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" | "curveIntersection" | "intersectionSet" }> : null
  const selectedSlope = selectedLinear ? lineSlope(selectedLinear) : null
  const showSlopeParameter = selectedLinear?.type === "line" && Boolean(selectedLinear.slopeParameter)
  const editable = selectedPrimitive?.locked !== true
  const [expressionDraft, setExpressionDraft] = useState(selectedFunction?.expression ?? "")
  const [expressionError, setExpressionError] = useState<string | null>(null)
  const [logBase, setLogBase] = useState("10")
  const formulaRef = useRef<HTMLTextAreaElement>(null)
  const [annotationText, setAnnotationText] = useState("")
  const beginPreview = useSceneStore((state) => state.beginPreview)
  const previewParameter = useSceneStore((state) => state.previewParameter)
  const commitPreview = useSceneStore((state) => state.commitPreview)
  const sceneDocument = useSceneStore((state) => state.document)
  const applySceneOperation = useSceneStore((state) => state.apply)
  const annotationOptions = selectedPrimitive ? annotationFeatureOptions(selectedPrimitive) : []
  const selectedAnnotations = selectedPrimitive ? sceneDocument.annotations.filter((annotation) => annotation.target === selectedPrimitive.id || (annotation.anchor?.kind === "primitive" && annotation.anchor.primitiveId === selectedPrimitive.id)) : []
  const pathPrimitives = sceneDocument.primitives.filter((primitive) => ["line", "segment", "ray", "polyline", "circle", "arc", "function"].includes(primitive.type))
  const [animationMode, setAnimationMode] = useState<AnimationMode>("loop")
  const [animationPlaying, setAnimationPlaying] = useState(false)
  const animationRef = useRef<AnimationState>({ value, direction: 1, mode: "loop", playing: false, speed: 0.2 })

  useEffect(() => {
    setExpressionDraft(selectedFunction?.expression ?? "")
    setExpressionError(null)
  }, [selectedFunction?.id, selectedFunction?.expression])

  useEffect(() => {
    setAnnotationText(selectedPrimitive ? selectedPrimitive.label ?? selectedPrimitive.id : "")
  }, [selectedPrimitive?.id, selectedPrimitive?.label])

  useEffect(() => {
    if (!animationPlaying) animationRef.current = { ...animationRef.current, value, mode: animationMode, playing: false, speed: Math.max((max - min) / 4, step) }
  }, [animationPlaying, animationMode, max, min, step, value])

  useEffect(() => {
    if (!animationPlaying) return
    const timer = window.setInterval(() => {
      const next = advanceAnimation(animationRef.current, 0.05, [min, max])
      animationRef.current = next
      previewParameter("slope", next.value)
      if (!next.playing) {
        setAnimationPlaying(false)
        commitPreview()
      }
    }, 50)
    return () => window.clearInterval(timer)
  }, [animationPlaying, commitPreview, max, min, previewParameter])

  const updatePoint = (axis: "x" | "y", next: number) => selectedPoint && editable && onUpdatePrimitive({ [axis]: next })
  const updatePointBinding = (pathId: string) => selectedPoint && editable && onUpdatePrimitive({ binding: pathId ? { kind: "onPath", pathId, parameterId: Object.keys(sceneDocument.parameters)[0], parameter: selectedPoint.binding?.kind === "onPath" ? selectedPoint.binding.parameter : 0 } : { kind: "free" } })
  const updatePointParameter = (parameter: number) => selectedPoint?.binding?.kind === "onPath" && editable && onUpdatePrimitive({ binding: { ...selectedPoint.binding, parameter } })
  const createLocus = () => {
    if (!selectedPoint?.binding || selectedPoint.binding.kind !== "onPath" || !editable) return
    const parameterId = selectedPoint.binding.parameterId ?? Object.keys(sceneDocument.parameters)[0]
    const parameter = parameterId ? sceneDocument.parameters[parameterId] : undefined
    if (!parameterId || !parameter) return
    let index = 1
    while (sceneDocument.primitives.some((primitive) => primitive.id === `locus-${index}`)) index += 1
    applySceneOperation({ op: "addPrimitive", primitive: { id: `locus-${index}`, type: "locus", sourcePointId: selectedPoint.id, parameterId, domain: [parameter.min ?? 0, parameter.max ?? 1], samples: 128, label: `轨迹 ${index}` } })
  }
  const createDerivedAnalysis = (type: "derivative" | "tangent" | "normal" | "secant" | "integral" | "analysisSet") => {
    if (!selectedFunction || !editable) return
    let index = 1
    while (sceneDocument.primitives.some((primitive) => primitive.id === `${type}-${index}`)) index += 1
    const x = Math.max(selectedFunction.domain[0], Math.min(selectedFunction.domain[1], 0))
    const primitive: PrimitiveSpec = type === "derivative"
      ? { id: `${type}-${index}`, type, sourceId: selectedFunction.id, order: 1, domain: selectedFunction.domain, samples: selectedFunction.samples ?? 128, points: [], status: "approximate", label: `导函数 ${index}` }
      : type === "tangent" || type === "normal"
        ? { id: `${type}-${index}`, type, sourceId: selectedFunction.id, x, point: { x, y: 0 }, slope: 0, a: { x: selectedFunction.domain[0], y: 0 }, b: { x: selectedFunction.domain[1], y: 0 }, status: "failed", label: `${type === "tangent" ? "切线" : "法线"} ${index}` }
        : type === "secant"
          ? { id: `${type}-${index}`, type, sourceId: selectedFunction.id, x1: selectedFunction.domain[0], x2: selectedFunction.domain[1], points: [], slope: 0, a: { x: selectedFunction.domain[0], y: 0 }, b: { x: selectedFunction.domain[1], y: 0 }, status: "failed", label: `割线 ${index}` }
          : type === "integral"
            ? { id: `${type}-${index}`, type, sourceId: selectedFunction.id, domain: [Math.max(0, selectedFunction.domain[0]), Math.min(1, selectedFunction.domain[1])], steps: 256, points: [], area: null, status: "failed", label: `积分区域 ${index}` }
            : { id: `${type}-${index}`, type, sourceId: selectedFunction.id, domain: selectedFunction.domain, samples: selectedFunction.samples ?? 128, results: [], status: "failed", label: `分析结果 ${index}` }
    applySceneOperation({ op: "addPrimitive", primitive })
  }
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
  const insertFunctionTemplate = (template: string) => {
    if (!selectedFunction || !editable) return
    const input = formulaRef.current
    const start = input?.selectionStart ?? expressionDraft.length
    const end = input?.selectionEnd ?? start
    const insertion = insertFormulaTemplate(expressionDraft, start, end, template)
    setExpressionDraft(insertion.value)
    try {
      parseExpression(insertion.value)
      setExpressionError(null)
      onUpdatePrimitive({ expression: insertion.value })
    } catch {
      setExpressionError("公式还需要补全")
    }
    requestAnimationFrame(() => {
      formulaRef.current?.focus()
      formulaRef.current?.setSelectionRange(insertion.cursorStart, insertion.cursorEnd)
    })
  }
  const toggleAnimation = () => {
    if (animationPlaying) {
      setAnimationPlaying(false)
      animationRef.current = { ...animationRef.current, playing: false }
      commitPreview()
      return
    }
    beginPreview()
    animationRef.current = { value, direction: 1, mode: animationMode, playing: true, speed: Math.max((max - min) / 4, step) }
    setAnimationPlaying(true)
  }
  const stopAnimation = () => {
    if (!animationPlaying) return
    setAnimationPlaying(false)
    animationRef.current = { ...animationRef.current, playing: false, value: min }
    previewParameter("slope", min)
    commitPreview()
  }
  const functionMetrics = selectedFunction ? (() => {
    try {
      const segments = adaptiveSampleFunctionSegments((x) => evaluateParameterExpression(selectedFunction.expression, { x }), selectedFunction.domain, { initialSteps: selectedFunction.samples ?? 128, maxSteps: Math.max(selectedFunction.samples ?? 128, 2048) })
      const values = segments.flat().map((point) => point.y)
      if (!values.length) return null
      return { min: Math.min(...values), max: Math.max(...values) }
    } catch {
      return null
    }
  })() : null

  return <section className="panel-section properties" aria-label="属性检查器">
    <div className="inspector-heading"><div><span className="panel-kicker">选中对象</span><h2 className="panel-title">属性面板</h2></div><span className="inspector-indicator" aria-hidden="true" /></div>
    <div className="inspector-tabs" role="tablist" aria-label="属性面板标签"><button type="button" role="tab" aria-selected="true" data-active="true">属性</button><button type="button" role="tab" aria-selected="false">约束与智能体</button></div>
    <div className="animation-controls" aria-label="动态控制">
      <span className="properties-label"><strong>动画演示</strong><small>参数动态演变</small></span>
      <div className="property-actions">
        <button type="button" aria-label={animationPlaying ? "暂停动画" : "播放动画"} onClick={toggleAnimation}>{animationPlaying ? "暂停" : "播放"}</button>
        <button type="button" aria-label="停止动画" onClick={stopAnimation} disabled={!animationPlaying}>停止</button>
        <select aria-label="动画模式" value={animationMode} onChange={(event) => setAnimationMode(event.target.value as AnimationMode)}>
          <option value="loop">循环</option>
          <option value="once">单次</option>
          <option value="pingPong">往返</option>
        </select>
      </div>
    </div>
    {selectedSolid && <div className="primitive-properties"><h3>立体几何属性</h3>{selectedSolid.type === "cube" && <><Vector3Fields prefix="原点" value={selectedSolid.origin} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ origin3: { ...selectedSolid.origin, [axis]: next } })} /><Vector3Fields prefix="尺寸" value={selectedSolid.size} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ size3: { ...selectedSolid.size, [axis]: Math.max(0.01, next) } })} /></>}{selectedSolid.type === "pyramid" && <><Vector3Fields prefix="底面中心" value={selectedSolid.baseCenter} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ baseCenter3: { ...selectedSolid.baseCenter, [axis]: next } })} /><CoordinateField label="底面尺寸 X" value={selectedSolid.baseSize.x} disabled={!editable} onChange={(next) => onUpdatePrimitive({ baseSize3: { ...selectedSolid.baseSize, x: Math.max(0.01, next) } })} /><CoordinateField label="底面尺寸 Y" value={selectedSolid.baseSize.y} disabled={!editable} onChange={(next) => onUpdatePrimitive({ baseSize3: { ...selectedSolid.baseSize, y: Math.max(0.01, next) } })} /><CoordinateField label="高度" value={selectedSolid.height} disabled={!editable} onChange={(next) => onUpdatePrimitive({ height: Math.max(0.01, next) })} /></>}{(selectedSolid.type === "cylinder" || selectedSolid.type === "cone") && <><Vector3Fields prefix="中心" value={selectedSolid.center} disabled={!editable} onChange={(axis, next) => onUpdatePrimitive({ center3: { ...selectedSolid.center, [axis]: next } })} /><CoordinateField label="半径 3D" value={selectedSolid.radius} disabled={!editable} onChange={(next) => onUpdatePrimitive({ radius3: Math.max(0.01, next) })} /><CoordinateField label="高度" value={selectedSolid.height} disabled={!editable} onChange={(next) => onUpdatePrimitive({ height: Math.max(0.01, next) })} /><Field label="分段数"><input aria-label="分段数" type="number" min="3" max="256" step="1" disabled={!editable} value={selectedSolid.segments} onChange={(event) => onUpdatePrimitive({ segments: Math.max(3, Math.min(256, Math.round(numberValue(event)))) })} /></Field></>}</div>}
    {!selectedPrimitive && <>
      <label className="properties-label" htmlFor="slope-slider"><span>直线斜率参数</span><strong className="metric">{value.toFixed(2)}</strong></label>
      <input id="slope-slider" aria-label="直线斜率" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(numberValue(event))} />
      <p className="footer-note">选择图元后，这里会切换为对应的几何属性。</p>
    </>}
    {selectedPrimitive && <div className="primitive-properties">
      <div className="property-card-heading"><div><span className="property-kicker">当前图元</span><h3>{selectedPrimitive.label ?? selectedPrimitive.id}</h3></div><span className="property-type-badge">{primitiveTypeLabels[selectedPrimitive.type]}</span></div>
      <h3 className="property-subheading">外观</h3>
      <Field label="图元名称"><input aria-label="图元名称" type="text" value={selectedPrimitive.label ?? ""} placeholder={selectedPrimitive.id} onChange={(event) => onUpdatePrimitive({ label: event.target.value })} /></Field>
      <div className="property-actions">
        <button type="button" onClick={onToggleSelectedVisibility}>{selectedPrimitive.visible === false ? "显示图元" : "隐藏图元"}</button>
        <button type="button" onClick={onToggleSelectedLock}>{selectedPrimitive.locked ? "解锁图元" : "锁定图元"}</button>
      </div>
      <Field label="线条颜色"><input aria-label="线条颜色" type="color" disabled={!editable} value={selectedPrimitive.style?.stroke ?? defaultStrokeFor(selectedPrimitive)} onChange={(event) => onUpdatePrimitive({ style: { stroke: event.target.value } })} /></Field>
      {(["point", "circle", "ellipse", "intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection", "intersectionSet"] as PrimitiveSpec["type"][]).includes(selectedPrimitive.type) && <Field label="填充颜色"><input aria-label="填充颜色" type="color" disabled={!editable} value={selectedPrimitive.style?.fill ?? "#ffffff"} onChange={(event) => onUpdatePrimitive({ style: { fill: event.target.value } })} /></Field>}
      <Field label="线宽"><input aria-label="线宽" type="number" disabled={!editable} min="0.5" max="20" step="0.5" value={selectedPrimitive.style?.strokeWidth ?? 3} onChange={(event) => onUpdatePrimitive({ style: { strokeWidth: Math.max(0.5, numberValue(event)) } })} /></Field>
      <Field label="透明度"><input aria-label="透明度" type="number" disabled={!editable} min="0" max="1" step="0.05" value={selectedPrimitive.style?.opacity ?? 1} onChange={(event) => onUpdatePrimitive({ style: { opacity: Math.min(1, Math.max(0, numberValue(event))) } })} /></Field>
      <Field label="线型"><select aria-label="线型" disabled={!editable} value={selectedPrimitive.style?.dash ?? "solid"} onChange={(event) => onUpdatePrimitive({ style: { dash: event.target.value === "solid" ? undefined : event.target.value } })}><option value="solid">实线</option><option value="8 6">虚线</option><option value="2 5">点线</option></select></Field>
    </div>}
     {showSlopeParameter && <div className="primitive-properties"><label className="properties-label" htmlFor="selected-slope-slider"><span>直线斜率参数</span><strong className="metric">{value.toFixed(2)}</strong></label><input id="selected-slope-slider" aria-label="选中直线斜率" type="range" disabled={!editable} min={min} max={max} step={step} value={value} onChange={(event) => onChange(numberValue(event))} /></div>}
     {selectedPoint && <div className="primitive-properties"><h3>点坐标</h3><CoordinateField label="点 X" value={selectedPoint.x} disabled={!editable || selectedPoint.binding?.kind === "onPath"} onChange={(next) => updatePoint("x", next)} /><CoordinateField label="点 Y" value={selectedPoint.y} disabled={!editable || selectedPoint.binding?.kind === "onPath"} onChange={(next) => updatePoint("y", next)} /><Field label="路径绑定"><select aria-label="点路径绑定" disabled={!editable} value={selectedPoint.binding?.kind === "onPath" ? selectedPoint.binding.pathId : ""} onChange={(event) => updatePointBinding(event.target.value)}><option value="">自由点</option>{pathPrimitives.map((path) => <option key={path.id} value={path.id}>{path.label ?? path.id}</option>)}</select></Field>{selectedPoint.binding?.kind === "onPath" && <><Field label="路径参数"><input aria-label="路径参数" type="number" min="0" max="1" step="0.01" disabled={!editable} value={selectedPoint.binding.parameter} onChange={(event) => updatePointParameter(numberValue(event))} /></Field><button type="button" aria-label="记录轨迹" disabled={!editable} onClick={createLocus}>记录轨迹</button></>}</div>}
     {selectedLinear && <div className="primitive-properties"><h3>斜率特征</h3><div className="metric-grid"><span>倾角<strong>{lineAngle(selectedLinear).toFixed(2)}°</strong></span><span>长度<strong>{lineLength(selectedLinear).toFixed(2)}</strong></span><span>方向向量<strong>({(selectedLinear.b.x - selectedLinear.a.x).toFixed(2)}, {(selectedLinear.b.y - selectedLinear.a.y).toFixed(2)})</strong></span><span>截距<strong>{selectedSlope === null ? "垂直线" : (selectedLinear.a.y - selectedSlope * selectedLinear.a.x).toFixed(2)}</strong></span></div>{selectedSlope === null ? <button type="button" disabled={!editable} onClick={() => updateSlope(0)}>设为水平线</button> : <Field label="斜率"><input aria-label="选中直线斜率值" type="number" step="0.1" value={selectedSlope} readOnly={showSlopeParameter} disabled={!editable} onChange={(event) => updateSlope(numberValue(event))} /></Field>}{(["a", "b"] as const).map((endpoint) => <div key={endpoint} className="endpoint-group"><strong>{selectedLinear.type === "ray" && endpoint === "a" ? "起点 A" : selectedLinear.type === "ray" && endpoint === "b" ? "方向点 B" : `端点 ${endpoint.toUpperCase()}`}</strong><CoordinateField label={`${selectedLinear.type === "ray" ? endpoint === "a" ? "起点" : "方向点" : "端点"} ${endpoint.toUpperCase()} X`} value={selectedLinear[endpoint].x} disabled={!editable} onChange={(next) => updateEndpoint(endpoint, "x", next)} /><CoordinateField label={`${selectedLinear.type === "ray" ? endpoint === "a" ? "起点" : "方向点" : "端点"} ${endpoint.toUpperCase()} Y`} value={selectedLinear[endpoint].y} disabled={!editable || (selectedLinear.type === "line" && Boolean(selectedLinear.slopeParameter) && endpoint === "b")} onChange={(next) => updateEndpoint(endpoint, "y", next)} /></div>)}</div>}
     {selectedPolyline && <div className="primitive-properties"><h3>折线属性</h3><p className="footer-note">共 {selectedPolyline.points.length} 个顶点</p>{selectedPolyline.points.map((point, index) => <div key={`${selectedPolyline.id}-${index}`} className="endpoint-group"><strong>顶点 {index + 1}</strong><CoordinateField label={`顶点 ${index + 1} X`} value={point.x} disabled={!editable} onChange={(next) => updatePolylinePoint(index, "x", next)} /><CoordinateField label={`顶点 ${index + 1} Y`} value={point.y} disabled={!editable} onChange={(next) => updatePolylinePoint(index, "y", next)} /></div>)}</div>}
     {selectedParabola && <div className="primitive-properties"><h3>抛物线属性</h3><CoordinateField label="顶点 X" value={selectedParabola.vertex.x} disabled={!editable} onChange={(next) => updateParabolaVertex("x", next)} /><CoordinateField label="顶点 Y" value={selectedParabola.vertex.y} disabled={!editable} onChange={(next) => updateParabolaVertex("y", next)} /><Field label="焦参数"><input aria-label="焦参数" type="number" disabled={!editable} step="0.1" value={selectedParabola.focalParameter} onChange={(event) => onUpdatePrimitive({ focalParameter: numberValue(event) })} /></Field><Field label="轴向"><select aria-label="抛物线轴向" disabled={!editable} value={selectedParabola.axis} onChange={(event) => onUpdatePrimitive({ axis: event.target.value as "x" | "y" })}><option value="x">横轴</option><option value="y">纵轴</option></select></Field><Field label="旋转角度（度）"><input aria-label="抛物线旋转角度" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedParabola.rotation)} onChange={(event) => updateRotation(numberValue(event))} /></Field><p className="footer-note">焦点：{(() => { const focus = parabolaFocus(selectedParabola); return `(${focus.x.toFixed(2)}, ${focus.y.toFixed(2)})` })()}</p></div>}
     {selectedEllipseOrHyperbola && <div className="primitive-properties"><h3>{selectedEllipseOrHyperbola.type === "ellipse" ? "椭圆属性" : "双曲线属性"}</h3><CoordinateField label="中心 X" value={selectedEllipseOrHyperbola.center.x} disabled={!editable} onChange={(next) => updateConicCenter("x", next)} /><CoordinateField label="中心 Y" value={selectedEllipseOrHyperbola.center.y} disabled={!editable} onChange={(next) => updateConicCenter("y", next)} /><Field label="横向半径"><input aria-label="横向半径" type="number" disabled={!editable} min="0.01" step="0.1" value={selectedEllipseOrHyperbola.radiusX} onChange={(event) => onUpdatePrimitive({ radiusX: Math.max(0.01, numberValue(event)) })} /></Field><Field label="纵向半径"><input aria-label="纵向半径" type="number" disabled={!editable} min="0.01" step="0.1" value={selectedEllipseOrHyperbola.radiusY} onChange={(event) => onUpdatePrimitive({ radiusY: Math.max(0.01, numberValue(event)) })} /></Field>{selectedEllipseOrHyperbola.type === "hyperbola" && <Field label="轴向"><select aria-label="双曲线轴向" disabled={!editable} value={selectedEllipseOrHyperbola.axis} onChange={(event) => onUpdatePrimitive({ axis: event.target.value as "x" | "y" })}><option value="x">横轴</option><option value="y">纵轴</option></select></Field>}<Field label="旋转角度（度）"><input aria-label={`${selectedEllipseOrHyperbola.type === "ellipse" ? "椭圆" : "双曲线"}旋转角度`} type="number" disabled={!editable} step="1" value={rotationDegrees(selectedEllipseOrHyperbola.rotation)} onChange={(event) => updateRotation(numberValue(event))} /></Field><p className="footer-note">焦点：{(() => { const focus = conicFoci(selectedEllipseOrHyperbola); return `(${focus.first.x.toFixed(2)}, ${focus.first.y.toFixed(2)}) / (${focus.second.x.toFixed(2)}, ${focus.second.y.toFixed(2)})` })()}</p>{ellipseMetrics && <div className="metric-grid"><span>长半轴<strong>{ellipseMetrics.major.toFixed(2)}</strong></span><span>短半轴<strong>{ellipseMetrics.minor.toFixed(2)}</strong></span><span>离心率<strong>{ellipseMetrics.eccentricity.toFixed(3)}</strong></span><span>面积<strong>{(Math.PI * selectedEllipseOrHyperbola.radiusX * selectedEllipseOrHyperbola.radiusY).toFixed(2)}</strong></span></div>}{hyperbolaMetrics && <div className="metric-grid"><span>离心率<strong>{hyperbolaMetrics.eccentricity.toFixed(3)}</strong></span><span>渐近线角<strong>{hyperbolaMetrics.asymptoteAngle.toFixed(2)}°</strong></span></div>}</div>}
     {selectedFunction && <div className="primitive-properties function-properties"><h3>函数图像属性</h3><Field label="公式"><textarea ref={formulaRef} aria-label="函数表达式" rows={2} placeholder="例如：y = e^x 或 sin(ln(x))" disabled={!editable} value={expressionDraft} onChange={(event) => updateFunctionExpression(event.target.value)} /></Field><FormulaKeyboard logBase={logBase} onLogBaseChange={setLogBase} onInsert={insertFunctionTemplate} />{expressionError && <p className="footer-note" role="alert">{expressionError}</p>}<CoordinateField label="定义域起点" value={selectedFunction.domain[0]} disabled={!editable} onChange={(next) => updateFunctionDomain(0, next)} /><CoordinateField label="定义域终点" value={selectedFunction.domain[1]} disabled={!editable} onChange={(next) => updateFunctionDomain(1, next)} /><Field label="采样点数"><input aria-label="采样点数" type="number" disabled={!editable} min="2" max="2048" step="1" value={selectedFunction.samples ?? 128} onChange={(event) => onUpdatePrimitive({ samples: numberValue(event) })} /></Field><p className="footer-note">定义域 [{selectedFunction.domain[0]}, {selectedFunction.domain[1]}] · {selectedFunction.samples ?? 128} 个采样点</p>{functionMetrics && <p className="footer-note">值域 [{functionMetrics.min.toFixed(2)}, {functionMetrics.max.toFixed(2)}]</p>}<div className="property-actions" aria-label="微积分分析工具"><button type="button" aria-label="创建导函数" disabled={!editable} onClick={() => createDerivedAnalysis("derivative")}>导函数</button><button type="button" aria-label="创建切线" disabled={!editable} onClick={() => createDerivedAnalysis("tangent")}>切线</button><button type="button" aria-label="创建法线" disabled={!editable} onClick={() => createDerivedAnalysis("normal")}>法线</button><button type="button" aria-label="创建割线" disabled={!editable} onClick={() => createDerivedAnalysis("secant")}>割线</button><button type="button" aria-label="创建积分区域" disabled={!editable} onClick={() => createDerivedAnalysis("integral")}>积分区域</button><button type="button" aria-label="创建分析结果" disabled={!editable} onClick={() => createDerivedAnalysis("analysisSet")}>分析结果</button></div></div>}
     {selectedCircleOrArc && <div className="primitive-properties"><h3>{selectedCircleOrArc.type === "circle" ? "圆属性" : "圆弧属性"}</h3><CoordinateField label="圆心 X" value={selectedCircleOrArc.center.x} disabled={!editable} onChange={(next) => updateCenter("x", next)} /><CoordinateField label="圆心 Y" value={selectedCircleOrArc.center.y} disabled={!editable} onChange={(next) => updateCenter("y", next)} /><Field label="半径"><input aria-label="半径" type="number" disabled={!editable} min="0.01" step="0.1" value={selectedCircleOrArc.radius} onChange={(event) => onUpdatePrimitive({ radius: Math.max(0.01, numberValue(event)) })} /></Field>{selectedCircleOrArc.type === "arc" && <><Field label="起始角（度）"><input aria-label="起始角" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedCircleOrArc.startAngle)} onChange={(event) => onUpdatePrimitive({ startAngle: rotationRadians(numberValue(event)) })} /></Field><Field label="结束角（度）"><input aria-label="结束角" type="number" disabled={!editable} step="1" value={rotationDegrees(selectedCircleOrArc.endAngle)} onChange={(event) => onUpdatePrimitive({ endAngle: rotationRadians(numberValue(event)) })} /></Field></>}{selectedCircleOrArc.type === "circle" ? <div className="metric-grid"><span>周长<strong>{(2 * Math.PI * selectedCircleOrArc.radius).toFixed(2)}</strong></span><span>面积<strong>{(Math.PI * selectedCircleOrArc.radius ** 2).toFixed(2)}</strong></span></div> : <div className="metric-grid"><span>圆心角<strong>{(arcAngle * 180 / Math.PI).toFixed(2)}°</strong></span><span>弧长<strong>{(arcAngle * selectedCircleOrArc.radius).toFixed(2)}</strong></span></div>}</div>}
     {selectedPrimitive?.type === "derivative" && <div className="primitive-properties"><h3>导函数分析</h3><p className="footer-note">来源：{selectedPrimitive.sourceId} · {selectedPrimitive.order} 阶 · 采样近似</p><p className="footer-note">状态：{selectedPrimitive.status}{selectedPrimitive.diagnostic ? ` · ${selectedPrimitive.diagnostic}` : ""}</p></div>}
     {(selectedPrimitive?.type === "tangent" || selectedPrimitive?.type === "normal" || selectedPrimitive?.type === "secant") && <div className="primitive-properties"><h3>{primitiveTypeLabels[selectedPrimitive.type]}分析</h3><p className="footer-note">来源：{selectedPrimitive.sourceId} · 状态：{selectedPrimitive.status}</p><div className="metric-grid"><span>斜率<strong>{selectedPrimitive.vertical ? "垂直" : selectedPrimitive.slope.toFixed(3)}</strong></span><span>计算点<strong>{selectedDerivedPoint ? `(${selectedDerivedPoint.x.toFixed(2)}, ${selectedDerivedPoint.y.toFixed(2)})` : "—"}</strong></span></div>{selectedPrimitive.diagnostic && <p className="footer-note">{selectedPrimitive.diagnostic}</p>}</div>}
     {selectedPrimitive?.type === "integral" && <div className="primitive-properties"><h3>积分区域</h3><p className="footer-note">来源：{selectedPrimitive.sourceId} · 区间 [{selectedPrimitive.domain[0]}, {selectedPrimitive.domain[1]}]</p><p className="footer-note">状态：{selectedPrimitive.status}{selectedPrimitive.diagnostic ? ` · ${selectedPrimitive.diagnostic}` : ""}</p><div className="metric-grid"><span>面积<strong>{selectedPrimitive.area === null ? "—" : selectedPrimitive.area.toFixed(4)}</strong></span><span>步数<strong>{selectedPrimitive.steps}</strong></span></div></div>}
     {selectedPrimitive?.type === "analysisSet" && <div className="primitive-properties"><h3>分析结果集合</h3><p className="footer-note">来源：{selectedPrimitive.sourceId} · 状态：{selectedPrimitive.status}</p><div className="metric-grid"><span>结果数量<strong>{selectedPrimitive.results.length}</strong></span></div>{selectedPrimitive.diagnostic && <p className="footer-note">{selectedPrimitive.diagnostic}</p>}</div>}
      {selectedIntersection && <div className="primitive-properties"><h3>{selectedIntersection.type === "intersectionSet" ? "交点集合" : "派生交点"}</h3>{selectedIntersection.type === "intersectionSet" ? <><p className="footer-note">共 {selectedIntersection.points.length} 个交点；位置会随来源图元更新。</p>{selectedIntersection.points.map((point, index) => <div className="metric-grid" key={`${selectedIntersection.id}-point-${index}`}><span>交点 {index + 1}<strong>({point.x.toFixed(2)}, {point.y.toFixed(2)})</strong></span></div>)}</> : <><p className="footer-note">该点由其他图元计算，不可直接拖动。</p><CoordinateField label="交点 X" value={selectedIntersection.x} readOnly onChange={() => undefined} /><CoordinateField label="交点 Y" value={selectedIntersection.y} readOnly onChange={() => undefined} /></>}</div>}
    {selectedCount > 1 && <div className="batch-properties"><h3>批量编辑 · {selectedCount} 个对象</h3><div className="batch-actions">{canCreateIntersection && (selectedPrimitive?.type === "point" ? <button aria-label={selectedCount === 3 ? "创建三点抛物线" : "连接选中点"} onClick={onCreateIntersection}>{selectedCount === 3 ? "创建三点抛物线" : "连接选中点"}</button> : <button aria-label="添加交点" onClick={onCreateIntersection}>添加交点</button>)}<button aria-label={selectedGroupId ? "取消分组" : "创建分组"} onClick={selectedGroupId ? onDeleteGroup : onCreateGroup}>{selectedGroupId ? "取消分组" : "创建分组"}</button><button aria-label={allSelectedVisible ? "批量隐藏" : "批量显示"} onClick={onToggleBatchVisibility}>{allSelectedVisible ? "批量隐藏" : "批量显示"}</button>{alignments.map((alignment) => <button key={alignment.value} aria-label={alignment.label} onClick={() => onAlign(alignment.value)}>{alignment.label}</button>)}</div></div>}
    {selectedPrimitive && <div className="primitive-properties annotation-properties"><h3>图元标注</h3><Field label="标注文本"><input aria-label="标注文本" type="text" value={annotationText} onChange={(event) => setAnnotationText(event.target.value)} /></Field><div className="property-actions">{annotationOptions.map((option) => <button key={`${option.feature}-${option.index ?? "default"}`} type="button" aria-label={`添加${option.label}标注`} disabled={!editable} onClick={() => onAddAnnotation(option.feature, option.index, annotationText)}>{`添加${option.label}`}</button>)}</div>{selectedAnnotations.length > 0 && <div className="annotation-list" aria-label="当前图元标注">{selectedAnnotations.map((annotation) => <div className="annotation-row" key={annotation.id}><span>{annotation.text}</span><button type="button" aria-label={`删除标注 ${annotation.text}`} onClick={() => applySceneOperation({ op: "deleteAnnotation", id: annotation.id })}>删除</button></div>)}</div>}</div>}
  </section>
}
