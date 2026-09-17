import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react"

import type { DrawingViewSpec, GeometryDocument, PrimitiveSpec } from "@draw/dsl"

import { applyOperation, type DomainOperation } from "@draw/scene-graph"

import type { PlanarCreationMode } from "../guidance"
import { createDragAction, getDragHandle, primitiveHandlePoints, type DragAction, type DragHandle } from "../interaction"
import {
  DRAFT_SNAP_PIXELS,
  boxSelectionMode,
  clientToDraft,
  constrainAngle,
  draftGrid,
  draftGridSnapStep,
  draftMeasurement,
  draftSnapCandidates,
  draftWindow,
  normalizeSelectionBox,
  rankDraftSnaps,
  snapToGrid,
  type DraftPoint,
  type DraftWindow,
  type SnapCandidate,
  type SnapKind
} from "../drafting"
import type { DraftControls as DraftControlsContract } from "./DraftControlsRow"
import type { BoxSelectionMode, SelectionBox } from "@draw/geometry-kernel"
import type { GeometryEditRequest } from "../draftEditing"
import { applyAngle, applyDistance, parseDraftAngle, parseDraftCoordinate, parseDraftDistance } from "../draftCoordinate"
import { drawingViewLabels, type ProjectedDrawing, type ProjectedPrimitive } from "../projectionVisuals"
import { TreeEyeIcon } from "./LayerTree"

export type DrawingViewportMode = "projection" | "draft"

export type DrawingViewPatch = Partial<Omit<DrawingViewSpec, "id">>

/** 进行中的二维创建步骤；App 拥有状态，视口只负责把它画成橡皮筋预览。 */
export interface DraftCreation {
  mode: PlanarCreationMode
  center: DraftPoint | null
  start?: DraftPoint
  points?: DraftPoint[]
}

/** 极轴追踪的吸附阈值：指针偏离射线超过这个角度就保持自由落点。 */
const DRAFT_POLAR_THRESHOLD_DEGREES = 4

/** 动态输入占位符里显示当前尺寸，去掉多余小数位。 */
function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)))
}

/** 夹点捕捉半径（屏幕像素）与夹点视觉半径（按约 520px 宽的视口折算成窗口单位）。 */
const DRAFT_GRIP_PIXELS = 8
const DRAFT_GRIP_RADIUS_RATIO = 6 / 520

/**
 * 2D 绘图的命令区由 DrawingViewport 持有状态，但**渲染在图纸之外**的工具栏里（见 `DraftControlsRow`）：
 * 这些控件如果留在图纸坐标系内，会随图纸一起缩放并与画布内容重叠。
 */
export type { DraftControls } from "./DraftControlsRow"

/** 角度约束模式：自由 → 正交 → 45° 极轴。 */
export type DraftConstraint = "free" | "ortho" | "polar45"

interface DrawingViewportProps {
  view: DrawingViewSpec
  sheetName: string
  mode: DrawingViewportMode
  document: GeometryDocument
  selectedIds: string[]
  active?: boolean
  projectedDrawing?: ProjectedDrawing | null
  /** 进行中的创建步骤；有值时才画橡皮筋预览。 */
  creation?: DraftCreation | null
  /** Temporary projection-line override; the persisted `view.showProjectionLines` is the fallback. */
  projectionLinesOverride?: boolean
  onSelect: (id: string | null, additive?: boolean) => void
  onActivate?: (viewId: string) => void
  onLayoutChange?: (viewId: string, patch: DrawingViewPatch) => void
  onCreateAt?: (coordinate: { x: number; y: number }) => void
  /** 夹点拖动提交：与数学画布共用同一套 DragAction 语义。 */
  onDragEnd?: (id: string, action: DragAction) => void
  /** 框选提交：`window`（左→右，完全包含）或 `crossing`（右→左，相交）。 */
  onBoxSelect?: (box: SelectionBox, mode: BoxSelectionMode) => void
  /** 偏移 / 修剪 / 延伸：视口只发请求，几何与补丁由 App + draftEditing 负责。 */
  onEditSelected?: (request: GeometryEditRequest) => void
  /** 把命令区的渲染交给外层工具条；不传时保持在视口内（测试与独立用法）。 */
  onDraftControls?: (controls: DraftControlsContract | null) => void
  /** 空视图时的下一步操作（例如切换投影来源）；只在没有可画内容时显示。 */
  emptyStateAction?: { label: string; onClick: () => void } | null
  /** 覆盖默认的空状态文案（投影来源不同，"空"的原因也不同）。 */
  emptyMessage?: string
  /**
   * 工具条已经接管命令区：此时**任何**视口都不在图纸内渲染命令，避免出现两份输入框。
   * 与 `onDraftControls` 的区别是它只表示"由外层负责"，不需要上报。
   */
  draftControlsHandledExternally?: boolean
}

const drawingMetrics = {
  defaultMin: -4,
  defaultSpan: 8,
  paddingRatio: 0.12,
  minimumPadding: 0.6,
  pointRadiusRatio: 0.018
}

export interface DrawingBounds {
  minX: number
  minY: number
  width: number
  height: number
}

function boundsForPoints(points: { x: number; y: number }[]): DrawingBounds {
  if (points.length === 0) return { minX: drawingMetrics.defaultMin, minY: drawingMetrics.defaultMin, width: drawingMetrics.defaultSpan, height: drawingMetrics.defaultSpan }
  const minX = Math.min(...points.map((point) => point.x))
  const maxX = Math.max(...points.map((point) => point.x))
  const minY = Math.min(...points.map((point) => point.y))
  const maxY = Math.max(...points.map((point) => point.y))
  const padding = Math.max((maxX - minX) * drawingMetrics.paddingRatio, (maxY - minY) * drawingMetrics.paddingRatio, drawingMetrics.minimumPadding)
  return { minX: minX - padding, minY: -(maxY + padding), width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 }
}

function primitivePoints(primitive: ProjectedPrimitive) {
  return primitive.kind === "point" ? [primitive.point] : primitive.points
}

function viewBounds(drawing: ProjectedDrawing): DrawingBounds {
  return boundsForPoints([
    ...drawing.primitives.flatMap(primitivePoints),
    ...drawing.projectionLines.flatMap((line) => [line.from, line.to]),
    ...drawing.annotations.flatMap((annotation) => annotation.position ? [annotation.position] : [])
  ])
}

const planarTypes = new Set(["point", "line", "segment", "ray", "polyline", "circle", "arc"])

/** Planar primitives that survive both their own visibility flag and their layer's visibility. */
function visiblePlanarPrimitives(document: GeometryDocument): PrimitiveSpec[] {
  const hiddenLayers = new Set((document.layers ?? []).filter((layer) => layer.visible === false).map((layer) => layer.id))
  return document.primitives.filter((primitive) => {
    if (primitive.visible === false) return false
    if (!planarTypes.has(primitive.type)) return false
    return !(primitive.layerId && hiddenLayers.has(primitive.layerId))
  })
}

function svgPoints(primitive: Exclude<ProjectedPrimitive, { kind: "point" }>): string {
  return primitive.points.map((point) => `${point.x},${-point.y}`).join(" ")
}

function sourceLabel(document: GeometryDocument, sourceId: string): string {
  const primitive = document.primitives.find((candidate) => candidate.id === sourceId)
  return primitive?.label ? `${primitive.label} (${sourceId})` : sourceId
}

function sourceInteraction(sourceId: string, selected: boolean, label: string, onSelect: DrawingViewportProps["onSelect"]) {
  return {
    "aria-label": `选择 ${label}`,
    "aria-pressed": selected,
    "data-selected": selected ? "true" : "false",
    "data-source-id": sourceId,
    role: "button" as const,
    tabIndex: 0,
    onClick: (event: ReactMouseEvent<SVGGElement>) => {
      event.stopPropagation()
      onSelect(sourceId, event.shiftKey)
    },
    onKeyDown: (event: ReactKeyboardEvent<SVGGElement>) => {
      if (event.key !== "Enter" && event.key !== " ") return
      event.preventDefault()
      onSelect(sourceId, event.shiftKey)
    }
  }
}

function renderProjectedPrimitive(primitive: ProjectedPrimitive, bounds: DrawingBounds, document: GeometryDocument, selectedIds: string[], onSelect: DrawingViewportProps["onSelect"]) {
  const selected = selectedIds.includes(primitive.sourceId)
  const label = sourceLabel(document, primitive.sourceId)
  const interaction = sourceInteraction(primitive.sourceId, selected, label, onSelect)
  const className = `engineering-drawing-primitive engineering-drawing-${primitive.kind}${selected ? " is-selected" : ""}`
  const pointRadius = Math.max(bounds.width, bounds.height) * drawingMetrics.pointRadiusRatio
  if (primitive.kind === "point") return <g key={primitive.sourceId} className={className} {...interaction}><circle cx={primitive.point.x} cy={-primitive.point.y} r={pointRadius} /></g>
  if (primitive.kind === "polygon") return <g key={primitive.sourceId} className={className} {...interaction}><polygon points={svgPoints(primitive)} /><polygon data-drawing-hit="true" style={hitStyle()} points={svgPoints(primitive)} /></g>
  return <g key={primitive.sourceId} className={className} {...interaction}><polyline points={svgPoints(primitive)} /><polyline data-drawing-hit="true" style={hitStyle()} points={svgPoints(primitive)} /></g>
}

function renderAnnotation(annotation: ProjectedDrawing["annotations"][number]) {
  if (!annotation.position) return null
  /**
   * 标注只是**读数**，不参与交互：它没有自己的点击处理，但 SVG 文本默认会吃掉指针事件，
   * 压在某个图元上时那一下点击就落不到图元上（平面画布的标注一直是 `pointerEvents="none"`）。
   */
  return <g key={annotation.id} className={`engineering-drawing-annotation engineering-drawing-annotation-${annotation.status}`} data-testid="engineering-annotation" data-annotation-id={annotation.id} data-status={annotation.status} data-source-ids={annotation.sourceIds.join(",")} pointerEvents="none"><text x={annotation.position.x} y={-annotation.position.y}>{annotation.text}</text></g>
}

function renderInvalidAnnotation(annotation: ProjectedDrawing["annotations"][number]) {
  if (annotation.position) return null
  return <div key={annotation.id} className={`engineering-drawing-annotation engineering-drawing-annotation-${annotation.status}`} data-testid="engineering-annotation" data-annotation-id={annotation.id} data-status={annotation.status}>{annotation.id}: {annotation.status} · {annotation.explanation}</div>
}

/** Draft primitives reuse the P7 selection contract: the payload stays the stable document object id. */
function renderDraftPrimitive(primitive: PrimitiveSpec, span: number, selectedIds: string[], onPrimitiveClick: (event: ReactMouseEvent<SVGGElement>, id: string) => void, onPointerDown: (event: ReactPointerEvent<SVGGElement>, primitive: PrimitiveSpec) => void) {
  const selected = selectedIds.includes(primitive.id)
  const label = `${(primitive as { label?: string }).label ?? primitive.id}`
  // onClick 换成"创建优先"的版本：创建进行中点图元是落点，不是选中（见组件里的 handleDraftPrimitiveClick）。
  const interaction = { ...sourceInteraction(primitive.id, selected, label, () => undefined), onClick: (event: ReactMouseEvent<SVGGElement>) => onPrimitiveClick(event, primitive.id) }
  const className = `engineering-drawing-primitive engineering-drawing-draft engineering-drawing-draft-${primitive.type}${selected ? " is-selected" : ""}`
  const pointRadius = span * drawingMetrics.pointRadiusRatio
  const wrap = (child: React.ReactNode) => <g key={primitive.id} className={className} data-primitive-id={primitive.id} {...interaction} onPointerDown={(event) => onPointerDown(event, primitive)}>{child}</g>

  if (primitive.type === "point") return wrap(<><circle cx={primitive.x} cy={-primitive.y} r={pointRadius} /><circle data-drawing-hit="true" style={hitStyle()} cx={primitive.x} cy={-primitive.y} r={Math.max(pointRadius, span * 0.02)} /></>)
  if (primitive.type === "circle") return wrap(<><circle cx={primitive.center.x} cy={-primitive.center.y} r={primitive.radius} /><circle data-drawing-hit="true" style={hitStyle()} cx={primitive.center.x} cy={-primitive.center.y} r={primitive.radius} /></>)
  if (primitive.type === "arc") {
    const steps = 24
    const points: string[] = []
    for (let index = 0; index <= steps; index += 1) {
      const angle = primitive.startAngle + (primitive.endAngle - primitive.startAngle) * (index / steps)
      points.push(`${primitive.center.x + primitive.radius * Math.cos(angle)},${-(primitive.center.y + primitive.radius * Math.sin(angle))}`)
    }
    return wrap(<><polyline points={points.join(" ")} /><polyline data-drawing-hit="true" style={hitStyle()} points={points.join(" ")} /></>)
  }
  if (primitive.type === "polyline") return wrap(<><polyline points={primitive.points.map((point) => `${point.x},${-point.y}`).join(" ")} /><polyline data-drawing-hit="true" style={hitStyle()} points={primitive.points.map((point) => `${point.x},${-point.y}`).join(" ")} /></>)
  if (primitive.type === "line") {
    const dx = primitive.b.x - primitive.a.x
    const dy = primitive.b.y - primitive.a.y
    const length = Math.hypot(dx, dy) || 1
    const reach = span * 2
    const from = { x: primitive.a.x - (dx / length) * reach, y: primitive.a.y - (dy / length) * reach }
    const to = { x: primitive.b.x + (dx / length) * reach, y: primitive.b.y + (dy / length) * reach }
    return wrap(<><line x1={from.x} y1={-from.y} x2={to.x} y2={-to.y} /><line data-drawing-hit="true" style={hitStyle()} x1={from.x} y1={-from.y} x2={to.x} y2={-to.y} /></>)
  }
  if (primitive.type === "ray") {
    const dx = primitive.b.x - primitive.a.x
    const dy = primitive.b.y - primitive.a.y
    const length = Math.hypot(dx, dy) || 1
    const reach = span * 2
    const to = { x: primitive.b.x + (dx / length) * reach, y: primitive.b.y + (dy / length) * reach }
    return wrap(<><line x1={primitive.a.x} y1={-primitive.a.y} x2={to.x} y2={-to.y} /><line data-drawing-hit="true" style={hitStyle()} x1={primitive.a.x} y1={-primitive.a.y} x2={to.x} y2={-to.y} /></>)
  }
  if (primitive.type === "segment") return wrap(<><line x1={primitive.a.x} y1={-primitive.a.y} x2={primitive.b.x} y2={-primitive.b.y} /><line data-drawing-hit="true" style={hitStyle()} x1={primitive.a.x} y1={-primitive.a.y} x2={primitive.b.x} y2={-primitive.b.y} /></>)
  return null
}

/** 透明加宽命中带的屏幕像素宽度（配 `non-scaling-stroke`，所以数值本身就是像素）。 */
const DRAFT_HIT_PIXELS = 14

/**
 * 命中带宽度用**内联样式**给，不走 CSS：`.engineering-drawing-draft.is-selected line`（0,2,1）
 * 这类选择器会压过 `.engineering-drawing-hit`（0,2,0），之前两次尝试都被级联吃掉。
 */
function hitStyle(): React.CSSProperties {
  return { fill: "none", stroke: "transparent", strokeWidth: DRAFT_HIT_PIXELS, vectorEffect: "non-scaling-stroke", pointerEvents: "stroke" }
}

const snapLabels: Record<SnapKind, string> = { endpoint: "端点", intersection: "交点", midpoint: "中点", center: "圆心", quadrant: "象限点", perpendicular: "垂足", tangent: "切点", nearest: "最近点", grid: "栅格" }

/** 上一步落点：正交/极轴约束都相对它生效，也就是「从最后一次点击的地方量角度」。 */
function creationAnchor(creation: DraftCreation | null | undefined): DraftPoint | null {
  if (!creation) return null
  return creation.points?.at(-1) ?? creation.start ?? creation.center ?? null
}

/** 当前指针解析结果：命中候选的有序列表 + 正在使用的序号（Tab 循环用）。 */
interface DraftHover {
  point: DraftPoint
  snap: SnapKind | null
  ranked: SnapCandidate[]
  index: number
}

/** 正在创建的图元预览：和最终结果同一个形状，所以落点前就能看出对不对。 */
function renderCreationPreview(creation: DraftCreation, hover: DraftPoint, span: number) {
  const anchor = creationAnchor(creation)
  if (!anchor) return null
  const common = { className: "engineering-drawing-draft-preview", "data-draft-preview": creation.mode, fill: "none" }
  if (creation.mode === "circle") return <circle {...common} cx={anchor.x} cy={-anchor.y} r={Math.hypot(hover.x - anchor.x, hover.y - anchor.y)} />
  if (creation.mode === "arc") {
    const radius = Math.hypot(hover.x - anchor.x, hover.y - anchor.y)
    const startAngle = Math.atan2((creation.start?.y ?? hover.y) - anchor.y, (creation.start?.x ?? hover.x) - anchor.x)
    const endAngle = Math.atan2(hover.y - anchor.y, hover.x - anchor.x)
    const steps = 24
    const points: string[] = []
    for (let index = 0; index <= steps; index += 1) {
      const angle = startAngle + (endAngle - startAngle) * (index / steps)
      points.push(`${anchor.x + radius * Math.cos(angle)},${-(anchor.y + radius * Math.sin(angle))}`)
    }
    return <polyline {...common} points={points.join(" ")} />
  }
  if (creation.mode === "polyline") {
    const points = [...(creation.points ?? []), hover]
    return <polyline {...common} points={points.map((point) => `${point.x},${-point.y}`).join(" ")} />
  }
  if (creation.mode === "ray") {
    const dx = hover.x - anchor.x
    const dy = hover.y - anchor.y
    const length = Math.hypot(dx, dy) || 1
    const to = { x: hover.x + (dx / length) * span * 2, y: hover.y + (dy / length) * span * 2 }
    return <line {...common} x1={anchor.x} y1={-anchor.y} x2={to.x} y2={-to.y} />
  }
  return <line {...common} x1={anchor.x} y1={-anchor.y} x2={hover.x} y2={-hover.y} />
}

/**
 * 捕捉标签与实时读数写在 `viewBox` 坐标系里，所以字号必须按"用户单位"给：写 `font-size: 11px` 会被当成
 * 11 个用户单位（窗口跨度只有 100），渲染成约 98px 的巨字并溢出图纸。按跨度折算成约 12px 的可读大小。
 */
function readoutFontUserUnits(span: number): number {
  return Number((span / 42).toFixed(4))
}

export function DrawingViewport({ view, sheetName, mode, document, selectedIds, active = false, projectedDrawing = null, creation = null, projectionLinesOverride, onSelect, onActivate, onLayoutChange, onCreateAt, onDragEnd, onBoxSelect, onEditSelected, onDraftControls, draftControlsHandledExternally = false, emptyStateAction = null, emptyMessage }: DrawingViewportProps) {
  const label = drawingViewLabels[view.kind]
  const title = `${sheetName} · ${label}`
  const [hover, setHover] = useState<DraftHover | null>(null)
  const [constraint, setConstraint] = useState<DraftConstraint>("free")
  const [gridSnap, setGridSnap] = useState(false)
  const [drag, setDrag] = useState<{ id: string; handle: DragHandle; origin: DraftPoint; pointerId: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<DraftPoint | null>(null)
  const [boxDrag, setBoxDrag] = useState<{ anchor: DraftPoint; current: DraftPoint; pointerId: number } | null>(null)
  const [coordinateDraft, setCoordinateDraft] = useState("")
  const [dynamicDistance, setDynamicDistance] = useState("")
  const [dynamicAngle, setDynamicAngle] = useState("")
  const [coordinateError, setCoordinateError] = useState<string | null>(null)
  const [offsetDistance, setOffsetDistance] = useState("5")
  /** 上一次上报给工具条的命令区状态，用于按值去重（指针移动只改 placeholder）。 */
  const lastPublishedRef = useRef<DraftControlsContract | null>(null)
  /** 最新一次指针与落点回调：命令区的回调保持稳定引用，避免发布 effect 每帧重跑。 */
  const hoverRef = useRef<DraftHover | null>(null)
  const onCreateAtRef = useRef(onCreateAt)
  onCreateAtRef.current = onCreateAt
  const onEditSelectedRef = useRef(onEditSelected)
  onEditSelectedRef.current = onEditSelected

  /**
   * 拖动期间用临时文档做预览（与数学画布同一套做法）：`applyOperation` 会顺带重算派生对象，
   * 所以拖端点时关联的交点也跟着动。指针抬起才把动作交给 App 提交，不逐帧污染撤销历史。
   */
  const displayDocument = useMemo(() => {
    if (!drag || !dragCurrent) return document
    const primitive = document.primitives.find((candidate) => candidate.id === drag.id)
    if (!primitive) return document
    const action = createDragAction(primitive, drag.handle, drag.origin, dragCurrent)
    if (!action) return document
    const operation: DomainOperation = action.kind === "translate"
      ? { op: "translatePrimitive", id: primitive.id, delta: action.delta }
      : { op: "updatePrimitive", id: primitive.id, patch: action.patch }
    const result = applyOperation(document, operation)
    return result.changed ? result.document : document
  }, [document, drag, dragCurrent])
  const draftPrimitives = useMemo(() => mode === "draft" ? visiblePlanarPrimitives(displayDocument) : [], [displayDocument, mode])
  // 2D 绘图用固定的坐标窗口（只随 view.scale 缩放）：以前按内容自适应，画下第一个点整个坐标系就会跳。
  const window: DraftWindow = draftWindow(view.scale)
  const span = window.maxX - window.minX
  const grid = draftGrid(view.scale)
  const anchor = creationAnchor(creation)
  // 候选包含两两交点（O(n²)）与垂足，所以按文档与锚点缓存，避免每次指针移动重算。
  const anchorX = anchor?.x ?? null
  const anchorY = anchor?.y ?? null
  const snapCandidates = useMemo(
    () => draftSnapCandidates(draftPrimitives, { from: anchorX === null || anchorY === null ? null : { x: anchorX, y: anchorY } }),
    [draftPrimitives, anchorX, anchorY]
  )
  const bounds = mode === "draft" ? boundsForPoints([]) : projectedDrawing ? viewBounds(projectedDrawing) : boundsForPoints([])
  const showProjectionLines = mode === "projection" && (projectionLinesOverride ?? view.showProjectionLines)
  const hasDrawingContent = mode === "draft"
    ? draftPrimitives.length > 0
    : Boolean(projectedDrawing && (projectedDrawing.primitives.length > 0 || projectedDrawing.annotations.some((annotation) => annotation.position)))
  const statusText = mode === "draft"
    ? `${draftPrimitives.length} 个二维图元`
    : projectedDrawing && projectedDrawing.primitives.length > 0 ? `${projectedDrawing.primitives.length} 个图元` : "空视图"
  const changeScale = (delta: number) => onLayoutChange?.(view.id, { scale: Math.max(0.1, Number((view.scale + delta).toFixed(2))) })

  /**
   * 指针位置 → 图纸坐标，按 CAD 的既有优先级：
   * ① 对象捕捉（端点 / 交点 / 中点 / 圆心 / 象限点 / 垂足，最后才是"最近点"）——可用 Tab 循环候选；
   * ② 栅格捕捉（可选开关）——把落点量化到最细可见网格；
   * ③ 角度约束（Shift 临时正交 / 正交 / 45° 极轴）。
   */
  const resolvePointer = (svg: SVGSVGElement, clientX: number, clientY: number, shiftKey: boolean, cycleIndex: number): DraftHover => {
    const rect = svg.getBoundingClientRect()
    const raw = clientToDraft({ x: clientX, y: clientY }, rect, window)
    const tolerance = rect.width > 0 ? (DRAFT_SNAP_PIXELS / rect.width) * span : 0
    const ranked = rankDraftSnaps(raw, snapCandidates, { tolerance, primitives: draftPrimitives })
    if (ranked.length > 0) {
      const index = ((cycleIndex % ranked.length) + ranked.length) % ranked.length
      return { point: ranked[index].point, snap: ranked[index].kind, ranked, index }
    }
    const base = gridSnap ? snapToGrid(raw, draftGridSnapStep(view.scale)) : raw
    // Shift 与「正交」都是严格正交（始终压到轴上）；「45°」是极轴追踪，只在指针贴近射线时吸附。
    if (anchor && (shiftKey || constraint === "ortho")) return { point: constrainAngle(anchor, base, 90), snap: null, ranked, index: 0 }
    if (anchor && constraint === "polar45") return { point: constrainAngle(anchor, base, 45, { thresholdDegrees: DRAFT_POLAR_THRESHOLD_DEGREES }), snap: null, ranked, index: 0 }
    return { point: base, snap: gridSnap ? "grid" : null, ranked, index: 0 }
  }

  const pointerToHover = (event: ReactMouseEvent<SVGElement> | ReactPointerEvent<SVGElement>, cycleIndex: number): DraftHover => {
    const svg = (event.currentTarget as SVGGElement).ownerSVGElement ?? event.currentTarget as SVGSVGElement
    return resolvePointer(svg, event.clientX, event.clientY, event.shiftKey, cycleIndex)
  }

  /**
   * 创建进行中点到图元必须**落点**，而不是取消创建去选中它——数学画布早就是这个语义
   * （`GraphicsView` 的 `handleObjectClick`），绘图视口以前漏了这条：命中带一加宽，
   * 落在已有图元附近的第二次点击就会把创建静默取消（revision 不变、也没有报错）。
   */
  const handleDraftPrimitiveClick = (event: ReactMouseEvent<SVGGElement>, id: string) => {
    event.stopPropagation()
    if (creation) {
      if (onCreateAt) onCreateAt(pointerToHover(event, hover?.index ?? 0).point)
      return
    }
    onSelect(id, event.shiftKey)
  }

  const handleSvgClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (mode !== "draft" || !onCreateAt) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    // 用点击自身的位置重新解析，但保留 Tab 选中的候选序号。
    onCreateAt(resolvePointer(event.currentTarget, event.clientX, event.clientY, event.shiftKey, hover?.index ?? 0).point)
  }

  /**
   * 空白处按下开始框选：只在没有进行中的创建、且按下的不是图元/夹点时启动，
   * 否则会把"点第一个点"或"拖夹点"误判成框选。
   */
  const beginBoxSelect = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (mode !== "draft" || !onBoxSelect || creation || drag || event.button !== 0) return
    const target = event.target as Element | null
    if (target?.closest("[data-primitive-id], [data-draft-handle]")) return
    const rect = event.currentTarget.getBoundingClientRect()
    const anchor = clientToDraft({ x: event.clientX, y: event.clientY }, rect, window)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setBoxDrag({ anchor, current: anchor, pointerId: event.pointerId })
  }

  const finishBoxSelect = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!boxDrag || event.pointerId !== boxDrag.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const current = clientToDraft({ x: event.clientX, y: event.clientY }, rect, window)
    setBoxDrag(null)
    if (Math.abs(current.x - boxDrag.anchor.x) < 0.4 && Math.abs(current.y - boxDrag.anchor.y) < 0.4) return
    onBoxSelect?.(normalizeSelectionBox(boxDrag.anchor, current), boxSelectionMode(boxDrag.anchor, current))
  }

  /** 按下控制点或图元本体时，指针抬起由 finishGripDrag 处理；两者共用 pointerUp。 */
  const handleSvgPointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (boxDrag) { finishBoxSelect(event); return }
    finishGripDrag(event)
  }

  /** Tab 在命中的候选之间循环：多个特征点重叠时（端点压着交点）靠它选。 */
  const handleSvgKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (mode !== "draft" || event.key !== "Tab" || !hover || hover.ranked.length < 2) return
    event.preventDefault()
    const index = (hover.index + 1) % hover.ranked.length
    setHover({ ...hover, index, point: hover.ranked[index].point, snap: hover.ranked[index].kind })
  }

  /**
   * 夹点容差必须由屏幕像素换算：`getDragHandle` 的默认 0.35 是**世界单位**，
   * 在跨度 100 的绘图窗口里只相当于约 1.7px，根本点不中。
   */
  const gripTolerance = (width: number) => width > 0 ? (DRAFT_GRIP_PIXELS / width) * span : 0

  const beginGripDrag = (event: ReactPointerEvent<SVGCircleElement>, primitive: PrimitiveSpec, handle: DragHandle) => {
    if (mode !== "draft" || !onDragEnd || event.button !== 0) return
    event.stopPropagation()
    const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget as unknown as SVGSVGElement
    const rect = svg.getBoundingClientRect()
    const origin = clientToDraft({ x: event.clientX, y: event.clientY }, rect, window)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({ id: primitive.id, handle, origin, pointerId: event.pointerId })
    setDragCurrent(origin)
  }

  /**
   * 按住图元本体：先问 `getDragHandle` 是否落在控制点上（容差按屏幕像素换算），
   * 否则整体平移。与数学画布同一套判定，只是容差必须由像素换算。
   */
  const beginBodyDrag = (event: ReactPointerEvent<SVGGElement>, primitive: PrimitiveSpec) => {
    if (mode !== "draft" || !onDragEnd || event.button !== 0 || primitive.locked) return
    const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget as unknown as SVGSVGElement
    const rect = svg.getBoundingClientRect()
    const origin = clientToDraft({ x: event.clientX, y: event.clientY }, rect, window)
    const handle = getDragHandle(primitive, origin, gripTolerance(rect.width)) ?? "body"
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDrag({ id: primitive.id, handle, origin, pointerId: event.pointerId })
    setDragCurrent(origin)
  }

  /** 指针抬起才提交：拖动期间只是预览，不写文档也不进撤销历史。 */
  const finishGripDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || event.pointerId !== drag.pointerId) return
    const rect = event.currentTarget.getBoundingClientRect()
    const current = clientToDraft({ x: event.clientX, y: event.clientY }, rect, window)
    const primitive = document.primitives.find((candidate) => candidate.id === drag.id)
    const action = primitive && createDragAction(primitive, drag.handle, drag.origin, current)
    const moved = Math.hypot(current.x - drag.origin.x, current.y - drag.origin.y) > gripTolerance(rect.width) / 2
    setDrag(null)
    setDragCurrent(null)
    if (primitive && action && moved) onDragEnd?.(primitive.id, action)
  }

  const handleSvgPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (mode !== "draft") return
    if (boxDrag) {
      if (event.pointerId === boxDrag.pointerId) setBoxDrag({ ...boxDrag, current: clientToDraft({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), window) })
      return
    }
    if (!onCreateAt) return
    if (drag) {
      if (event.pointerId === drag.pointerId) setDragCurrent(clientToDraft({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), window))
      return
    }
    // 指针移动重新解析时把候选序号复位到最优候选。
    const resolved = resolvePointer(event.currentTarget, event.clientX, event.clientY, event.shiftKey, 0)
    hoverRef.current = resolved
    setHover(resolved)
  }

  /** 命令行坐标：绝对 / 相对 / 极坐标都走这里，落点走与鼠标点击同一条 `onCreateAt` 路径。 */
  const submitCoordinate = useCallback(() => {
    const create = onCreateAtRef.current
    if (!create) return
    const result = parseDraftCoordinate(coordinateDraft, { last: anchor })
    if (!result.ok) { setCoordinateError(result.error); return }
    setCoordinateError(null)
    setCoordinateDraft("")
    setDynamicDistance("")
    setDynamicAngle("")
    create(result.point)
  }, [coordinateDraft, anchor])

  /** 动态输入：只改长度或只改角度，另一次元沿用当前指针（AutoCAD 的动态输入语义）。 */
  const submitDistance = useCallback(() => {
    const create = onCreateAtRef.current
    if (!create || !anchor) return
    const result = parseDraftDistance(dynamicDistance)
    if (!result.ok) { setCoordinateError(result.error); return }
    setCoordinateError(null)
    setDynamicDistance("")
    create(applyDistance(anchor, hoverRef.current?.point ?? anchor, result.value))
  }, [anchor, dynamicDistance])

  const submitAngle = useCallback(() => {
    const create = onCreateAtRef.current
    if (!create || !anchor) return
    const result = parseDraftAngle(dynamicAngle)
    if (!result.ok) { setCoordinateError(result.error); return }
    setCoordinateError(null)
    setDynamicAngle("")
    create(applyAngle(anchor, hoverRef.current?.point ?? anchor, result.value))
  }, [anchor, dynamicAngle])

  /**
   * 把命令区交给外层工具条（图纸之外）。视口内的 `resolvePointer` / `submit*` 都依赖 svg 的实时矩形，
   * 所以坐标输入仍走同一条 `onCreateAt` 路径；这里只交出状态与回调，不改变任何落点语义。
   * 指针每移动一次 placeholder 就会变，所以按值比较后再上报，避免父层无意义重渲染（也更省一次布局）。
   */
  useEffect(() => {
    if (!onDraftControls) return
    if (mode !== "draft") { onDraftControls(null); return }
    const measurement = anchor ? draftMeasurement(anchor, hover?.point ?? anchor) : null
    const next: DraftControlsContract = {
      constraint,
      cycleConstraint: () => setConstraint((current) => current === "free" ? "ortho" : current === "ortho" ? "polar45" : "free"),
      gridSnap,
      toggleGridSnap: () => setGridSnap((current) => !current),
      coordinateDraft,
      setCoordinateDraft: (value) => { setCoordinateDraft(value); setCoordinateError(null) },
      dynamicDistance,
      setDynamicDistance: (value) => { setDynamicDistance(value); setCoordinateError(null) },
      dynamicAngle,
      setDynamicAngle: (value) => { setDynamicAngle(value); setCoordinateError(null) },
      offsetDistance,
      setOffsetDistance,
      hasAnchor: Boolean(anchor),
      lengthPlaceholder: measurement ? formatNumber(measurement.length) : "—",
      anglePlaceholder: measurement ? formatNumber(measurement.angleDeg) : "—",
      submitCoordinate,
      submitDistance,
      submitAngle,
      coordinateError,
      canEdit: Boolean(onEditSelectedRef.current),
      offsetEnabled: selectedIds.length === 1,
      trimExtendEnabled: selectedIds.length === 2,
      applyEdit: (request) => onEditSelectedRef.current?.(request),
      selectedCount: selectedIds.length
    }
    const previous = lastPublishedRef.current
    if (previous
      && previous.constraint === next.constraint
      && previous.gridSnap === next.gridSnap
      && previous.coordinateDraft === next.coordinateDraft
      && previous.dynamicDistance === next.dynamicDistance
      && previous.dynamicAngle === next.dynamicAngle
      && previous.offsetDistance === next.offsetDistance
      && previous.hasAnchor === next.hasAnchor
      && previous.lengthPlaceholder === next.lengthPlaceholder
      && previous.anglePlaceholder === next.anglePlaceholder
      && previous.coordinateError === next.coordinateError
      && previous.canEdit === next.canEdit
      && previous.offsetEnabled === next.offsetEnabled
      && previous.trimExtendEnabled === next.trimExtendEnabled) return
    lastPublishedRef.current = next
    onDraftControls(next)
  }, [onDraftControls, mode, constraint, gridSnap, coordinateDraft, dynamicDistance, dynamicAngle, offsetDistance, anchor, hover, coordinateError, selectedIds.length, submitCoordinate, submitDistance, submitAngle])

  const gridLines = (step: number, keyPrefix: string) => {
    const vertical: React.ReactNode[] = []
    const horizontal: React.ReactNode[] = []
    const firstX = Math.ceil(window.minX / step) * step
    const firstY = Math.ceil(window.minY / step) * step
    for (let x = firstX; x <= window.maxX + 1e-9; x += step) vertical.push(<line key={`${keyPrefix}-v-${x}`} x1={x} y1={-window.maxY} x2={x} y2={-window.minY} />)
    for (let y = firstY; y <= window.maxY + 1e-9; y += step) horizontal.push(<line key={`${keyPrefix}-h-${y}`} x1={window.minX} y1={-y} x2={window.maxX} y2={-y} />)
    return [...vertical, ...horizontal]
  }

  const readout = hover && creationAnchor(creation)
    ? (() => {
      const anchor = creationAnchor(creation)!
      const measurement = draftMeasurement(anchor, hover.point)
      return creation?.mode === "circle" || creation?.mode === "arc"
        ? `R ${measurement.length}`
        : `${measurement.length} · ${measurement.angleDeg}°`
    })()
    : hover ? `X ${hover.point.x} Y ${hover.point.y}` : null
  const labelUserUnits = readoutFontUserUnits(span)

  return <section
    className={`engineering-drawing-panel drawing-viewport${active ? " is-active" : ""}`}
    role="region"
    aria-label={title}
    title={title}
    data-drawing-view={view.kind}
    data-view-id={view.id}
    data-viewport-mode={mode}
    data-active={active ? "true" : "false"}
    data-view-visible={view.visible === false ? "false" : "true"}
    onFocusCapture={() => onActivate?.(view.id)}
    onMouseDown={() => onActivate?.(view.id)}
  >
    <div className="drawing-viewport-heading">
      <div className="drawing-viewport-label"><span>工程视图</span><h3>{label}</h3></div>
      <span className="engineering-drawing-panel-status">{statusText}</span>
      <div className="drawing-viewport-actions">
        {/* 角度约束与栅格捕捉现在只在图纸之外的工具栏上有一份（见 DraftControlsRow）；这里不再重复渲染。 */}
        <button type="button" aria-label={`缩小 ${label}`} disabled={view.scale <= 0.1} onClick={() => changeScale(-0.5)}>−</button>
        <button type="button" aria-label={`放大 ${label}`} onClick={() => changeScale(0.5)}>＋</button>
        <button className="icon-button" type="button" aria-label={`${view.visible === false ? "显示" : "隐藏"} ${label}`} aria-pressed={view.visible === false} onClick={() => onLayoutChange?.(view.id, { visible: view.visible === false })}><TreeEyeIcon visible={view.visible !== false} /></button>
      </div>
    </div>
    {/* 命令行 / 动态输入 / 修改命令渲染在图纸之外的工具栏（见 DraftControls）：放在图纸坐标系里会随缩放重叠。 */}
    {mode === "draft" && !onDraftControls && !draftControlsHandledExternally && <div className="drawing-viewport-input" data-draft-input="true">
      <label><span>坐标</span><input aria-label="坐标输入" value={coordinateDraft} placeholder="10,20 / @10,5 / @20<45" onChange={(event) => { setCoordinateDraft(event.target.value); setCoordinateError(null) }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitCoordinate() } }} /></label>
      {anchor && <>
        <label><span>长度</span><input aria-label="输入长度" value={dynamicDistance} placeholder={hover ? formatNumber(draftMeasurement(anchor, hover.point).length) : "—"} onChange={(event) => { setDynamicDistance(event.target.value); setCoordinateError(null) }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitDistance() } }} /></label>
        <label><span>角度</span><input aria-label="输入角度" value={dynamicAngle} placeholder={hover ? formatNumber(draftMeasurement(anchor, hover.point).angleDeg) : "—"} onChange={(event) => { setDynamicAngle(event.target.value); setCoordinateError(null) }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitAngle() } }} /></label>
        <span className="drawing-viewport-input-hint">回车按输入的尺寸落点；Tab 切换角度约束</span>
      </>}
      {coordinateError && <span className="drawing-viewport-input-error" role="alert">{coordinateError}</span>}
    </div>}
    {mode === "draft" && !onDraftControls && !draftControlsHandledExternally && onEditSelected && <div className="drawing-viewport-input" data-draft-edit-row="true">
      <label><span>偏移距离</span><input aria-label="偏移距离" value={offsetDistance} onChange={(event) => setOffsetDistance(event.target.value)} /></label>
      <button type="button" data-draft-edit="offset" disabled={selectedIds.length !== 1} title="按偏移距离新建一个平行对象（正值在行进方向左侧，负值在右侧）；需恰好选中一个图元" onClick={() => { const distance = Number(offsetDistance); onEditSelected({ kind: "offset", distance: Number.isFinite(distance) ? distance : 0 }) }}>偏移</button>
      <button type="button" data-draft-edit="trim" disabled={selectedIds.length !== 2} title="先选边界、再选被修剪的对象；保留目标 a 端所在的一半" onClick={() => onEditSelected({ kind: "trim" })}>修剪</button>
      <button type="button" data-draft-edit="extend" disabled={selectedIds.length !== 2} title="先选边界、再选被延伸的对象；把目标 b 端拉到边界" onClick={() => onEditSelected({ kind: "extend" })}>延伸</button>
      <span className="drawing-viewport-input-hint">偏移需选中 1 个；修剪/延伸需选中 2 个（先边界、后目标）</span>
    </div>}
    {/* 未物化的视图不画坐标轴：四个空框已经由标题的「空视图」说明，重复的占位文字只会变成噪声。 */}
    {(mode === "draft" || hasDrawingContent) && <svg className="engineering-drawing-svg" data-draft-window={`${window.minX},${window.minY},${window.maxX},${window.maxY}`} viewBox={mode === "draft" ? `${window.minX} ${-window.maxY} ${span} ${span}` : `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`} role="img" aria-label={`${title}投影视图`} data-viewport-mode={mode} data-draft-dragging={drag ? "true" : "false"} tabIndex={mode === "draft" ? 0 : undefined} onClick={handleSvgClick} onPointerDown={beginBoxSelect} onPointerMove={handleSvgPointerMove} onPointerUp={handleSvgPointerUp} onPointerLeave={() => setHover(null)} onKeyDown={handleSvgKeyDown}>
      {mode === "draft"
        ? <g className="engineering-drawing-grid" aria-hidden="true">{grid.minor !== null && <g className="engineering-drawing-grid-minor">{gridLines(grid.minor, "minor")}</g>}<g className="engineering-drawing-grid-major">{gridLines(grid.major, "major")}</g></g>
        : <g className="engineering-drawing-axes" aria-hidden="true"><line x1={bounds.minX} y1="0" x2={bounds.minX + bounds.width} y2="0" /><line x1="0" y1={bounds.minY} x2="0" y2={bounds.minY + bounds.height} /></g>}
      {mode === "draft" && <g className="engineering-drawing-axes" aria-hidden="true"><line x1={window.minX} y1="0" x2={window.maxX} y2="0" /><line x1="0" y1={-window.maxY} x2="0" y2={-window.minY} /></g>}
      {showProjectionLines && projectedDrawing && <g className="engineering-drawing-projection-lines" aria-hidden="true">{projectedDrawing.projectionLines.map((line) => <line key={`${line.sourceId}-${line.targetView}`} data-testid="projection-line" data-source-id={line.sourceId} data-origin-view={line.originView} data-target-view={line.targetView} x1={line.from.x} y1={-line.from.y} x2={line.to.x} y2={-line.to.y} />)}</g>}
      <g className="engineering-drawing-primitives">{mode === "draft" ? draftPrimitives.map((primitive) => renderDraftPrimitive(primitive, span, selectedIds, handleDraftPrimitiveClick, beginBodyDrag)) : (projectedDrawing?.primitives ?? []).map((primitive) => renderProjectedPrimitive(primitive, bounds, document, selectedIds, onSelect))}</g>
      {/* 预览与捕捉标记只属于当前操作，不写进文档。 */}
      {mode === "draft" && creation && hover && <g className="engineering-drawing-preview-layer" aria-hidden="true">{renderCreationPreview(creation, hover.point, span)}</g>}
      {mode === "draft" && hover && <g className="engineering-drawing-snap-layer" aria-hidden="true" data-draft-snap={hover.snap ?? "free"} data-draft-snap-candidates={hover.ranked.length}>
        <circle className="engineering-drawing-snap-marker" cx={hover.point.x} cy={-hover.point.y} r={span * 0.012} />
        {hover.snap && <text className="engineering-drawing-snap-label" fontSize={labelUserUnits} x={hover.point.x + span * 0.02} y={-hover.point.y - span * 0.02}>{snapLabels[hover.snap]}{hover.ranked.length > 1 ? ` ${hover.index + 1}/${hover.ranked.length}（Tab 切换）` : ""}</text>}
        {readout && <text className="engineering-drawing-readout" fontSize={labelUserUnits} data-draft-readout="true" x={hover.point.x + span * 0.02} y={-hover.point.y + span * 0.04}>{readout}</text>}
      </g>}
      {/* 框选矩形：方向决定语义，视觉上也要能区分（窗口=实线，相交=虚线）。 */}
      {mode === "draft" && boxDrag && <rect className="engineering-drawing-box-select" data-draft-box={boxSelectionMode(boxDrag.anchor, boxDrag.current)} x={Math.min(boxDrag.anchor.x, boxDrag.current.x)} y={-Math.max(boxDrag.anchor.y, boxDrag.current.y)} width={Math.abs(boxDrag.current.x - boxDrag.anchor.x)} height={Math.abs(boxDrag.current.y - boxDrag.anchor.y)} />}
      {/* 夹点：只有选中且未锁定、并且宿主提供了拖动回调时才画。 */}
      {mode === "draft" && onDragEnd && <g className="engineering-drawing-grips" aria-hidden="true">{draftPrimitives.filter((primitive) => selectedIds.includes(primitive.id)).flatMap((primitive) => primitiveHandlePoints(primitive).map(({ handle, point }) => <circle key={`${primitive.id}-${handle}`} data-draft-handle={handle} data-primitive-id={primitive.id} cx={point.x} cy={-point.y} r={span * DRAFT_GRIP_RADIUS_RATIO} onPointerDown={(event) => beginGripDrag(event, primitive, handle)} />))}</g>}
      {mode === "projection" && <g className="engineering-drawing-annotations">{(projectedDrawing?.annotations ?? []).map(renderAnnotation)}</g>}
    </svg>}
    {/* The drafting surface stays clickable while empty so the first 2D object can be placed. */}
    {/* 空视图不是一个死胡同：说明状态，并在另一份文档有内容时给出下一步操作。 */}
    {!hasDrawingContent && <div className="engineering-drawing-empty" role="status">
      <p>{emptyMessage ?? (mode === "draft" ? "当前图层还没有二维图元" : "暂无可投影的空间对象")}</p>
      {emptyStateAction && <button type="button" data-empty-action="true" onClick={emptyStateAction.onClick}>{emptyStateAction.label}</button>}
    </div>}
    {mode === "projection" && <div className="engineering-drawing-annotation-statuses">{(projectedDrawing?.annotations ?? []).map(renderInvalidAnnotation)}</div>}
    {mode === "projection" && projectedDrawing && projectedDrawing.diagnostics.length > 0 && <details className="engineering-drawing-diagnostics"><summary>诊断 {projectedDrawing.diagnostics.length} 条</summary><ul>{projectedDrawing.diagnostics.map((diagnostic) => <li key={diagnostic}>{diagnostic}</li>)}</ul></details>}
  </section>
}
