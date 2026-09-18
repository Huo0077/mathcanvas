import { type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from "react"
import type { Coordinate, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { adaptiveSampleFunctionSegments, evaluateParameterExpression, sampleEllipse, sampleHyperbolaBranches, sampleLocus, sampleParabola } from "@draw/geometry-kernel"
import { applyOperation, getAffectedPrimitiveIds, pathConstraint, recomputeDerivedObjects, type DomainOperation } from "@draw/scene-graph"
import type { BoxSelectionMode } from "@draw/geometry-kernel"

import { createDragAction, getDragHandle, primitiveHandlePoints, type DragAction, type DragHandle, type DragRotationTarget, type DragTangentTarget } from "../interaction"
import { isRotatableCurve, placementPivot } from "../curveRotation"
import { CONNECTION_HIT_INSET_PX, insetSegment } from "../connectionHitBand"
import { resolveAnnotationPoint } from "../annotations"
import { clipFunctionSegmentsToBounds } from "../functionGraph"
import { computeIntersectionPreviews, nearestPreview, PREVIEW_HIT_RADIUS, type IntersectionPreview } from "../intersectionPreview"
import { dashFor, fillFor, opacityFor, strokeFor, strokeWidthFor } from "../primitiveStyle"
import { planarMeasurementVisuals } from "../planarMeasurementVisuals"
import { DEFAULT_VIEWPORT, VIEWBOX, gridLinePositions, rayToViewport, svgToWorld, visibleWorldBounds, worldToSvg, zoomViewport, zoomViewportAt, type Viewport } from "../viewport"
import { GRID_CELL, GRID_MAJOR_EVERY } from "../sceneGrid"

type CreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null

/**
 * 点的可见半径（屏幕像素）。
 *
 * 两轮用户反馈：先"点的模型都过大了"（6 → 4），再"点也还是过大"（4 → 2.5）。
 * 现在直径 5px，与 1.5px 的线宽相称；密一点的作图里点不会再盖住曲线。
 * 命中区**不跟着缩** —— 那决定的是"点不点得中"，不是"看起来多大"（见下面的 `r="12"`）。
 */
const POINT_MARKER_RADIUS = 2.5

interface GraphicsViewProps {
  document: GeometryDocument
  selectedIds: string[]
  creationMode: CreationMode
  onSelect: (id: string | null, additive?: boolean) => void
  onCanvasClick: (coordinate: Coordinate) => void
  onCanvasDoubleClick: (coordinate: Coordinate) => void
  onBoxSelect: (bounds: { minX: number; minY: number; maxX: number; maxY: number }, mode: BoxSelectionMode) => void
  onDragEnd: (id: string, action: DragAction) => void
  onCreateIntersection: (preview: IntersectionPreview) => void
  onPointerCoordinate?: (coordinate: Coordinate | null) => void
  /** 用户口径：空白画布上**不要**任何说明文字或快捷入口，画布保持干净。 */
}

/** Pointer position in the SVG's own coordinate system, which is fixed by `viewBox` and independent of zoom. */
function pointToSvg(svg: SVGSVGElement, clientX: number, clientY: number): Coordinate {
  const bounds = svg.getBoundingClientRect()
  const width = bounds.width || VIEWBOX.width
  const height = bounds.height || VIEWBOX.height
  return { x: ((clientX - bounds.left) / width) * VIEWBOX.width, y: ((clientY - bounds.top) / height) * VIEWBOX.height }
}

function eventToSvg(event: ReactMouseEvent<SVGElement> | ReactPointerEvent<SVGElement>): Coordinate {
  const svg = event.currentTarget.ownerSVGElement ?? event.currentTarget as SVGSVGElement
  return pointToSvg(svg, event.clientX, event.clientY)
}

function eventToWorld(event: ReactMouseEvent<SVGElement> | ReactPointerEvent<SVGElement>, viewport: Viewport): Coordinate {
  return svgToWorld(eventToSvg(event), viewport)
}

function rotateFeature(center: Coordinate, x: number, y: number, rotation: number): Coordinate {
  return { x: center.x + x * Math.cos(rotation) - y * Math.sin(rotation), y: center.y + x * Math.sin(rotation) + y * Math.cos(rotation) }
}

/** 连线命中带在两端各让出的屏幕像素（几何在 `connectionHitBand.ts`，见那里的说明）。 */

function conicFeatures(primitive: Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }>): Array<{ label: string; point: Coordinate }> {
  if (primitive.type === "parabola") {
    const distance = primitive.focalParameter / 2
    return [
      { label: "V", point: primitive.vertex },
      { label: "F", point: rotateFeature(primitive.vertex, primitive.axis === "x" ? distance : 0, primitive.axis === "y" ? distance : 0, primitive.rotation ?? 0) }
    ]
  }
  const major = Math.max(primitive.radiusX, primitive.radiusY)
  const minor = Math.min(primitive.radiusX, primitive.radiusY)
  const distance = primitive.type === "ellipse" ? Math.sqrt(Math.max(major ** 2 - minor ** 2, 0)) : Math.sqrt(primitive.radiusX ** 2 + primitive.radiusY ** 2)
  const alongX = primitive.type === "hyperbola" ? primitive.axis === "x" : primitive.radiusX >= primitive.radiusY
  return [
    { label: "C", point: primitive.center },
    { label: "F₁", point: rotateFeature(primitive.center, alongX ? distance : 0, alongX ? 0 : distance, primitive.rotation ?? 0) },
    { label: "F₂", point: rotateFeature(primitive.center, alongX ? -distance : 0, alongX ? 0 : -distance, primitive.rotation ?? 0) }
  ]
}

function pointsAttribute(points: Coordinate[], viewport: Viewport): string {
  return points.map((point) => `${worldToSvg({ x: point.x, y: 0 }, viewport).x},${worldToSvg({ x: 0, y: point.y }, viewport).y}`).join(" ")
}

export function GraphicsView({ document, selectedIds, creationMode, onSelect, onCanvasClick, onCanvasDoubleClick, onBoxSelect, onDragEnd, onCreateIntersection, onPointerCoordinate }: GraphicsViewProps) {
  const workspace = document.workspace
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT)
  const [dragStart, setDragStart] = useState<Coordinate | null>(null)
  const [dragCurrent, setDragCurrent] = useState<Coordinate | null>(null)
  const [dragState, setDragState] = useState<{ id: string; handle: DragHandle; origin: Coordinate; pointerId: number; tangentOffset: number } | null>(null)
  const [panState, setPanState] = useState<{ start: Coordinate; center: Coordinate; pointerId: number } | null>(null)
  const [spacePressed, setSpacePressed] = useState(false)
  const [hoverCoordinate, setHoverCoordinate] = useState<Coordinate | null>(null)
  const [hoverPrimitiveType, setHoverPrimitiveType] = useState<string | null>(null)
  const suppressClick = useRef(false)
  /**
   * 这一次指针按下已经在 `beginDrag` 里处理过选择了，随后的 `click` 不要**再处理一遍**。
   *
   * 用户反馈："选中一个点 → Shift 选中一个圆或椭圆 → 点「绕定点旋转」无法实现"。
   * 探针读代数区的选中行发现：`pointerDown` 按加选把圆加进去，紧接着 `click` 又按加选处理一次，
   * 而"加选"的语义是**切换** —— 同一个对象被加了又删，选择最终变成空集，命令一直禁用。
   */
  const selectionHandled = useRef(false)
  const svgRef = useRef<SVGSVGElement>(null)
  /** 上一次算出的交点（含被"已保存交点"过滤掉的那些），作为拖动时增量计算的基准。 */
  const previousPreviewsRef = useRef<IntersectionPreview[]>([])
  /** 最近一次交点评算的读数：重算了几对、沿用了几个（e2e 与排查都读它）。 */
  const previewStatsRef = useRef({ recomputedPairs: 0, reusedPreviews: 0 })
  const worldBounds = visibleWorldBounds(viewport)
  const toX = (x: number) => worldToSvg({ x, y: 0 }, viewport).x
  const toY = (y: number) => worldToSvg({ x: 0, y }, viewport).y
  /**
   * 曲线绕的定点与基准中心（拖动、手柄、拖动预览都要用）。
   *
   * 定点的两种写法都在这里解析掉：固定坐标直接用；点图元引用去文档里取当前位置，
   * 于是"在圆上取一个动点、让圆绕它转"时定点随手拖动，而曲线始终过它。
   */
  const rotationTargetOf = (primitive: PrimitiveSpec, source: readonly PrimitiveSpec[]): DragRotationTarget | null => {
    if (!isRotatableCurve(primitive) || !primitive.rotationAbout) return null
    const pivot = placementPivot(primitive, (id) => source.find((candidate) => candidate.id === id))
    if (!pivot) return null
    return {
      pivot,
      baseCenter: { x: primitive.rotationAbout.baseCenter.x, y: primitive.rotationAbout.baseCenter.y },
      pivotPrimitiveId: primitive.rotationAbout.pivot.kind === "primitive" ? primitive.rotationAbout.pivot.primitiveId : null,
      angle: primitive.rotationAbout.angle
    }
  }
  /**
   * 曲线切线的拖动目标：把指针投影回来源曲线，算出"切点该挪到哪个参数"。
   *
   * 投影用内核的 `pathConstraint(...).project` —— 与动点、与检查器里切换切点定位方式**同一份定义**，
   * 所以拖出来的切点与算出来的切点永远落在同一条曲线上、同一套参数上。
   *
   * 给了 `grabOrigin`（指针按下的世界坐标）就顺带算出"按下偏移"，拖起来切点才不会跳到指针脚下。
   * `previousParameter` 用当前切点参数：拖动过程中切线不会跳到双曲线的另一支或曲线上另一个局部最近点。
   */
  const tangentTargetOf = (primitive: PrimitiveSpec, source: readonly PrimitiveSpec[], parameters: GeometryDocument["parameters"], grabOrigin?: Coordinate): DragTangentTarget | null => {
    if (primitive.type !== "tangent" && primitive.type !== "normal") return null
    const anchor = primitive.anchor
    if (anchor?.kind !== "parameter") return null
    const path = source.find((candidate) => candidate.id === primitive.sourceId)
    const constraint = path ? pathConstraint(path, parameters) : null
    if (!constraint) return null
    const parameterAt = (point: Coordinate) => {
      const projection = constraint.project(point, { previousParameter: anchor.parameter, previousBranch: anchor.branch ?? 0 })
      return projection ? { parameter: projection.parameter, branch: projection.branch } : null
    }
    const projectedGrab = grabOrigin ? parameterAt(grabOrigin) : null
    return { parameterAt, parameterOffset: projectedGrab ? anchor.parameter - projectedGrab.parameter : 0 }
  }
  const previewDocument = useMemo(() => {
    if (!dragState || !dragCurrent) return document
    const primitive = document.primitives.find((candidate) => candidate.id === dragState.id)
    if (!primitive) return document
    const tangent = tangentTargetOf(primitive, document.primitives, document.parameters)
    const action = createDragAction(primitive, dragState.handle, dragState.origin, dragCurrent, rotationTargetOf(primitive, document.primitives) ?? undefined, tangent ? { ...tangent, parameterOffset: dragState.tangentOffset } : undefined)
    if (!action) return document
    const operation: DomainOperation = action.kind === "translate"
      ? { op: "translatePrimitive", id: primitive.id, delta: action.delta }
      : { op: "updatePrimitive", id: primitive.id, patch: action.patch }
    const result = applyOperation(document, operation)
    return result.changed ? result.document : document
  }, [document, dragCurrent, dragState])
  const displayPrimitives = previewDocument.primitives
  /**
   * A saved intersection must hide only the solution it captured. Filtering the whole pair instead dropped the
   * sibling crossing of a line and a circle the moment one of them became a persistent point.
   *
   * 拖动时走**增量**：只有一个图元（及它的下游闭包）会变，其余图元对的交点沿用上一次的结果。
   * 全量两两求交在一次 pointermove 里要 ~49ms（52 个图元 / 6 条采样曲线实测），
   * 这正是"动点拖起来不流畅"的根源；拖动时那一步现在只重算与改动相关的对。
   */
  const previewResult = useMemo(() => {
    const affected = dragState ? getAffectedPrimitiveIds(previewDocument, [dragState.id]) : null
    return computeIntersectionPreviews(previewDocument, affected ? { recomputeFor: affected, previous: previousPreviewsRef.current } : {})
  }, [previewDocument, dragState])
  // 缓存要在渲染之后写入：useMemo 里写 ref 在并发渲染下可能被丢弃。
  useEffect(() => {
    previousPreviewsRef.current = previewResult.previews
    previewStatsRef.current = { recomputedPairs: previewResult.recomputedPairs, reusedPreviews: previewResult.reusedPreviews }
    const svg = svgRef.current
    if (!svg) return
    svg.dataset.previewPairs = String(previewResult.recomputedPairs)
    svg.dataset.previewReused = String(previewResult.reusedPreviews)
    svg.dataset.previewCount = String(previewResult.previews.length)
  }, [previewResult])
  const intersectionPreviews = useMemo(() => {
    const savedPairs = new Set<string>()
    const savedPoints = new Set<string>()
    const key = (x: number, y: number) => `${Math.round(x * 1e6)}::${Math.round(y * 1e6)}`
    for (const primitive of previewDocument.primitives) {
      // Only an intersection *set* materialises every solution of a pair, so only it may hide the whole pair.
      if (primitive.type === "intersectionSet" && primitive.points.length > 0) savedPairs.add([primitive.objectA, primitive.objectB].sort().join("::"))
      if (primitive.type === "intersection") savedPoints.add(key(primitive.x, primitive.y))
      if (primitive.type === "lineCircleIntersection") savedPoints.add(key(primitive.x, primitive.y))
      if (primitive.type === "circleIntersection") savedPoints.add(key(primitive.x, primitive.y))
      if (primitive.type === "curveIntersection") savedPoints.add(key(primitive.x, primitive.y))
    }
    return previewResult.previews.filter((preview) => {
      const pair = [preview.objectA, preview.objectB].sort().join("::")
      if (savedPairs.has(pair)) return false
      return !savedPoints.has(key(preview.point.x, preview.point.y))
    })
  }, [previewDocument, previewResult])
  const pointById = new Map(displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.type === "point").map((point) => [point.id, point]))
  const connectionEndpoints = (connection: Extract<PrimitiveSpec, { type: "connection" }>) => {
    const start = pointById.get(connection.startPointId)
    const end = pointById.get(connection.endPointId)
    return start && end ? { start, end } : null
  }
  const connectionControl = (connection: Extract<PrimitiveSpec, { type: "connection" }>) => connection.control?.thirdPointId ? pointById.get(connection.control.thirdPointId) : undefined

  /**
   * 连线的命中带要从两端**缩进**一段，别把端点盖住。
   *
   * 用户反馈："把动点放在轨道上、动点又和另一个定点连了线，移动轨道会带着定点一起移动"。
   * 取证发现真正的毛病在这里：连线在点**之后**渲染，而它的命中带是 18px 宽（±9px），
   * 于是端点（动点 / 连着的定点）正中心的那一下指针按下落在**连线**上；连线是派生对象、
   * `getDragHandle` 返回 null，拖动直接不成立，还会退化成框选——点看起来"抓不住"。
   * 命中带缩进 `CONNECTION_HIT_INSET_PX` 之后，端点那一小块归还给点本身，
   * 连线中段照旧好点好选（短连线至少保留一半长度可点）。
   */
  const connectionHitInset = (scale: number) => Math.max(0.02, CONNECTION_HIT_INSET_PX / Math.max(scale, 1e-6))
  /**
   * 轨迹采样交给内核的 `sampleLocus`。相对之前的实现有两点关键差别：
   *
   * 1. **按曲率自适应细分**，而不是把 `samples` 个点盲跑一遍。直线段上不额外加点，
   *    急弯处才二分加密，因此在同样的"整文档重算"预算下曲线更准。
   * 2. **跨越渐近线/间断点时切成多条分支**。旧实现把所有采样点连成一条折线，
   *    于是双曲线型轨迹在渐近线两侧被一条凭空出现的竖线连起来 —— 那是不存在的图形。
   *    这里返回 `Coordinate[][]`，渲染层逐条画 polyline，绝不跨分支连线。
   */
  const locusSegments = (locus: Extract<PrimitiveSpec, { type: "locus" }>): Coordinate[][] => {
    const source = displayPrimitives.find((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.id === locus.sourcePointId && primitive.type === "point")
    const parameter = previewDocument.parameters[locus.parameterId]
    if (!source || source.binding?.kind !== "onPath" || !parameter) return []
    const samples = Math.max(2, Math.min(4096, locus.samples))
    // 一次求值 = 一次整文档重算，代价很高，所以细分容差按"世界坐标下的可视精度"给：
    // 约 1/400 个视野宽度，肉眼分辨不出折线，同时避免为看不见的精度付钱。
    const tolerance = Math.max(1e-9, (worldBounds.maxX - worldBounds.minX) / 400)
    const drivenAt = (value: number): Coordinate | null => {
      const nextParameters = { ...previewDocument.parameters, [locus.parameterId]: { ...parameter, value, expression: undefined } }
      const nextDocument = recomputeDerivedObjects({ ...previewDocument, parameters: nextParameters }, [locus.parameterId, source.id])
      const nextPoint = nextDocument.primitives.find((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.id === source.id && primitive.type === "point")
      return nextPoint && Number.isFinite(nextPoint.x) && Number.isFinite(nextPoint.y) ? { x: nextPoint.x, y: nextPoint.y } : null
    }
    const result = sampleLocus(drivenAt, {
      domain: [locus.domain[0], locus.domain[1]],
      samples,
      tolerance,
      jumpFactor: 4,
      maxDepth: 5,
      breakDepth: 20,
      maxEvaluations: Math.max(samples * 8, 256)
    })
    return result.branches.map((branch) => branch.points)
  }

  const viewportLine = (line: Extract<PrimitiveSpec, { type: "line" }>) => {
    const deltaX = line.b.x - line.a.x
    if (Math.abs(deltaX) < 1e-9) return { a: { x: line.a.x, y: worldBounds.minY }, b: { x: line.a.x, y: worldBounds.maxY } }
    const slope = (line.b.y - line.a.y) / deltaX
    return { a: { x: worldBounds.minX, y: line.a.y + slope * (worldBounds.minX - line.a.x) }, b: { x: worldBounds.maxX, y: line.a.y + slope * (worldBounds.maxX - line.a.x) } }
  }
  const functionSegments = (primitive: Extract<PrimitiveSpec, { type: "function" }>) => {
    try { return clipFunctionSegmentsToBounds(adaptiveSampleFunctionSegments((x) => evaluateParameterExpression(primitive.expression, { x }), primitive.domain, { initialSteps: primitive.samples ?? 128, maxSteps: Math.max(primitive.samples ?? 128, 2048) }), worldBounds) } catch { return [] }
  }
  const handleObjectClick = (event: ReactMouseEvent<SVGElement>, id: string) => {
    event.stopPropagation()
    if (creationMode) { onCanvasClick(eventToWorld(event, viewport)); return }
    // 按下时已经选过了：这里再按"加选=切换"处理一次会把刚加进来的对象又删掉。
    if (selectionHandled.current) { selectionHandled.current = false; return }
    // 拖动（而不是点击）结束时不改选择：`finishDrag` 已经判定过这次手势是拖动。
    if (suppressClick.current) return
    onSelect(id, event.shiftKey)
  }
  const beginDrag = (event: ReactPointerEvent<SVGElement>, id: string) => {
    if (event.button === 1 || (event.button === 0 && spacePressed)) return
    event.stopPropagation()
    if (creationMode) return
    const primitive = document.primitives.find((candidate) => candidate.id === id)
    if (!primitive) return
    onSelect(id, event.shiftKey)
    selectionHandled.current = true
    const handle = getDragHandle(primitive, eventToWorld(event, viewport), 0.35, rotationTargetOf(primitive, document.primitives) ?? undefined, selectedIds.includes(id))
    if (!handle) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    // 曲线切线：记下按下那一刻的"切点参数 − 指针投影参数"，拖动时保持它（切点不会跳到指针脚下）。
    const tangentGrab = tangentTargetOf(primitive, document.primitives, document.parameters, eventToWorld(event, viewport))
    setDragState({ id, handle, origin: eventToWorld(event, viewport), pointerId: event.pointerId, tangentOffset: tangentGrab?.parameterOffset ?? 0 })
  }
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (creationMode || dragState) return
    if (event.button === 1 || (event.button === 0 && spacePressed)) {
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
      setPanState({ start: eventToSvg(event), center: viewport.center, pointerId: event.pointerId })
      return
    }
    const coordinate = eventToWorld(event, viewport)
    setDragStart(coordinate)
    setDragCurrent(coordinate)
  }
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panState && event.pointerId === panState.pointerId) {
      const current = eventToSvg(event)
      setViewport({ ...viewport, center: { x: panState.center.x + (panState.start.x - current.x) / viewport.scale, y: panState.center.y + (current.y - panState.start.y) / viewport.scale } })
      return
    }
    const coordinate = eventToWorld(event, viewport)
    setHoverCoordinate(coordinate)
    onPointerCoordinate?.(coordinate)
    const primitiveGroup = (event.target as Element).closest<SVGGElement>("[data-primitive-type]")
    setHoverPrimitiveType(primitiveGroup?.getAttribute("data-primitive-type") ?? null)
    if (dragState) { if (event.pointerId === dragState.pointerId) setDragCurrent(coordinate); return }
    if (dragStart) setDragCurrent(coordinate)
  }
  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (panState && event.pointerId === panState.pointerId) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
      setPanState(null)
      return
    }
    if (dragState && event.pointerId === dragState.pointerId) {
      const primitive = document.primitives.find((candidate) => candidate.id === dragState.id)
      const current = eventToWorld(event, viewport)
      const tangent = primitive ? tangentTargetOf(primitive, document.primitives, document.parameters) : null
      const action = primitive && createDragAction(primitive, dragState.handle, dragState.origin, current, rotationTargetOf(primitive, document.primitives) ?? undefined, tangent ? { ...tangent, parameterOffset: dragState.tangentOffset } : undefined)
      if (primitive && action && Math.hypot(current.x - dragState.origin.x, current.y - dragState.origin.y) > 0.01) { suppressClick.current = true; onDragEnd(primitive.id, action) }
      setDragState(null)
      setDragCurrent(null)
      return
    }
    if (!dragStart) return
    const end = eventToWorld(event, viewport)
    const bounds = { minX: Math.min(dragStart.x, end.x), minY: Math.min(dragStart.y, end.y), maxX: Math.max(dragStart.x, end.x), maxY: Math.max(dragStart.y, end.y) }
    if (Math.abs(end.x - dragStart.x) > 0.15 || Math.abs(end.y - dragStart.y) > 0.15) { suppressClick.current = true; onBoxSelect(bounds, end.x >= dragStart.x ? "window" : "crossing") }
    setDragStart(null)
    setDragCurrent(null)
  }
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.code === "Space") { event.preventDefault(); setSpacePressed(true) } }
    const handleKeyUp = (event: KeyboardEvent) => { if (event.code === "Space") setSpacePressed(false) }
    const handleBlur = () => setSpacePressed(false)
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("blur", handleBlur)
    return () => { window.removeEventListener("keydown", handleKeyDown); window.removeEventListener("keyup", handleKeyUp); window.removeEventListener("blur", handleBlur) }
  }, [])
  /**
   * The wheel listener is attached natively with `passive: false` because React's synthetic wheel handler cannot
   * preventDefault, and a zoom that also scrolls the page is unusable.
   */
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.0015)
      setViewport((current) => zoomViewportAt(current, factor, pointToSvg(svg, event.clientX, event.clientY)))
    }
    svg.addEventListener("wheel", handleWheel, { passive: false })
    return () => svg.removeEventListener("wheel", handleWheel)
  }, [])
  const selectionRect = dragStart && dragCurrent ? { x: toX(Math.min(dragStart.x, dragCurrent.x)), y: toY(Math.max(dragStart.y, dragCurrent.y)), width: Math.abs(toX(dragCurrent.x) - toX(dragStart.x)), height: Math.abs(toY(dragCurrent.y) - toY(dragStart.y)), mode: dragCurrent.x >= dragStart.x ? "window" as const : "crossing" as const } : null
  const renderHandles = (primitive: PrimitiveSpec) => {
    if (!selectedIds.includes(primitive.id) || primitive.locked) return null
    // 控制点几何与 CAD 2D 绘图共用 interaction.ts 的定义，两个视口不再各写一份。
    const handles = primitiveHandlePoints(primitive, rotationTargetOf(primitive, displayPrimitives) ?? undefined)
    /**
     * 控制点半径。用户反馈整块画布"线太粗、点太大"之后从 5 收到 4：
     * 它现在是画布上最大的圆点，若留在 5，缩小后的图形（点半径 2.5）旁边会挂着一个两倍大的手柄。
     * 4（直径 8px）仍是舒服的抓取目标 —— 手柄本身就**是**命中区，不能再小。
     */
    return <g className="drag-handles" aria-hidden="true">{handles.map(({ handle, point }) => <circle key={handle} data-drag-handle={handle} cx={toX(point.x)} cy={toY(point.y)} r="4" onPointerDown={(event) => beginDrag(event, primitive.id)} />)}</g>
  }
  /**
   * 定点的标记：一个空心小圈 + 十字。它**不可拖动**（定点是参数，靠拖曲线或改数值来动），
   * 只负责回答"曲线正绕哪个点转"，所以 `pointerEvents="none"`。
   *
   * **只在选中这条曲线时出现**（用户口径："这个动圆不需要标出圆心"）。
   * 选中时它是"定点在哪"的唯一说明；未选中时画布上不留任何多余标记 ——
   * 定点本身通常就是一个可见的点图元，再叠一个红圈只会被当成"圆心又被画出来了"。
   */
  const renderRotationAnchors = () => displayPrimitives.flatMap((primitive) => {
    if (!selectedIds.includes(primitive.id)) return []
    const target = rotationTargetOf(primitive, displayPrimitives)
    if (!target) return []
    const x = toX(target.pivot.x)
    const y = toY(target.pivot.y)
    return [<g key={`anchor-${primitive.id}`} className="rotation-anchor" data-rotation-anchor={primitive.id} pointerEvents="none">
      <circle cx={x} cy={y} r="3.5" fill="none" stroke="#d94a4a" strokeWidth="1.5" />
      <line x1={x - 8} y1={y} x2={x + 8} y2={y} stroke="#d94a4a" strokeWidth="1.5" />
      <line x1={x} y1={y - 8} x2={x} y2={y + 8} stroke="#d94a4a" strokeWidth="1.5" />
    </g>]
  })
  const renderAnnotations = () => previewDocument.annotations.filter((annotation) => annotation.visible !== false).map((annotation) => {
    const point = resolveAnnotationPoint(annotation, displayPrimitives)
    if (!point) return null
    const offset = annotation.offset ?? { x: 0.25, y: 0.25 }
    const labelPoint = { x: point.x + offset.x, y: point.y + offset.y }
    return <g key={annotation.id} data-annotation-id={annotation.id} className="annotation-marker" pointerEvents="none"><line x1={toX(point.x)} y1={toY(point.y)} x2={toX(labelPoint.x)} y2={toY(labelPoint.y)} /><circle cx={toX(point.x)} cy={toY(point.y)} r="3" /><text x={toX(labelPoint.x) + 5} y={toY(labelPoint.y) - 5}>{annotation.text}</text></g>
  })
  /**
   * 点预览创建交点：**按屏幕像素距离就近取解**。
   * 两个解挨得近时，命中谁不再由 SVG 绘制顺序决定（后画的会吃掉点击）。
   * 没有布局信息的环境（jsdom 里 `getScreenCTM()` 返回 null）退回"被点到的那个"。
   */
  const handlePreviewClick = (event: React.MouseEvent<SVGGElement>, preview: IntersectionPreview) => {
    event.stopPropagation()
    const svg = event.currentTarget.ownerSVGElement
    // jsdom 的 SVG 元素没有 `getScreenCTM` / `DOMPoint`：那里退回"被点到的那个"，
    // 浏览器里才用 CTM 把光标换算进 SVG 坐标系做就近判定。
    const matrix = typeof svg?.getScreenCTM === "function" ? svg.getScreenCTM() : null
    if (!svg || !matrix || typeof DOMPoint === "undefined") {
      onCreateIntersection(preview)
      return
    }
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
    const nearest = nearestPreview(intersectionPreviews, local, (point) => ({ x: toX(point.x), y: toY(point.y) }))
    onCreateIntersection(nearest ?? preview)
  }
  const renderIntersectionPreviews = () => intersectionPreviews.map((preview) => <g key={`${preview.objectA}-${preview.objectB}-${preview.solutionIndex}`} data-auto-intersection="true" onClick={(event) => handlePreviewClick(event, preview)}><circle data-hit-target="true" cx={toX(preview.point.x)} cy={toY(preview.point.y)} r={PREVIEW_HIT_RADIUS} fill="transparent" pointerEvents="all" /><circle cx={toX(preview.point.x)} cy={toY(preview.point.y)} r="3" fill="var(--color-panel)" stroke="var(--color-warning)" strokeWidth="1.5" strokeDasharray="3 2" /></g>)

  /**
   * 固定网格：**一格恒为 1 个世界单位**（与 3D 背景网格同一套语义），缩放只改变可见范围。
   * 每 `GRID_MAJOR_EVERY` 格再画一条主线：缩得很远时细线会变密，主线仍是可靠的标尺。
   */
  const verticalGrid = gridLinePositions(worldBounds.minX, worldBounds.maxX)
  const horizontalGrid = gridLinePositions(worldBounds.minY, worldBounds.maxY)
  const isMajorGridLine = (value: number) => Math.abs(value % GRID_MAJOR_EVERY) < 1e-9
  const zoomFactor = viewport.scale / DEFAULT_VIEWPORT.scale
  const zoomPercentage = `${Math.round(zoomFactor * 100)}%`
  /**
   * 两种画布表面现在**共用同一组冷色格线令牌**（2026-09-18 视觉重构）：
   * 平面几何从"淡黄草稿纸"改成冷白纸，立体几何 / 工程制图本来就是冷色工作台，
   * 于是 `gridStroke` 不再需要分叉 —— 分叉留着只会让两边慢慢漂开。
   *
   * 用 `data-canvas-surface` 把"纸 vs 工作台"交给 CSS：SVG 内部的底与格线用行内属性（它们是 SVG），
   * 纸张底纹、卡片边框、控制条那层用 CSS。两处都读同一组 `--color-graph-*` 令牌。
   */
  const graphPaper = workspace === "conics" || workspace === "calculus"
  /** 常驻的测量数字：纯函数算位置与文本（`pointer-events: none`，不参与拾取）。 */
  const measurementLabels = planarMeasurementVisuals(document, selectedIds)
  const gridStroke = { minor: "var(--color-graph-grid-minor)", major: "var(--color-graph-grid-major)", axis: "var(--color-graph-axis)" }
  return <main className="graphics" data-canvas-surface={graphPaper ? "graph-paper" : "workbench"}><div className="canvas-card">{hoverCoordinate && <div className="coordinate-readout" data-coordinate-readout="true" role="presentation">{hoverPrimitiveType ? `${hoverPrimitiveType} · ` : ""}({hoverCoordinate.x.toFixed(2)}, {hoverCoordinate.y.toFixed(2)})</div>}
<div className="canvas-viewport-controls" role="group" aria-label="画布缩放"><button type="button" aria-label="缩小画布" title="缩小画布（滚轮向下）" onClick={() => setViewport((current) => zoomViewport(current, 1 / 1.25))}>−</button><span className="zoom-readout" data-zoom-readout="true" aria-live="polite">{zoomPercentage}</span><button type="button" aria-label="放大画布" title="放大画布（滚轮向上）" onClick={() => setViewport((current) => zoomViewport(current, 1.25))}>＋</button><button type="button" aria-label="重置视图" title="重置视图（居中并恢复默认缩放）" onClick={() => setViewport(DEFAULT_VIEWPORT)}>重置</button></div><svg ref={svgRef} className={panState ? "is-panning" : dragState ? "is-dragging" : undefined} data-viewport-center={`${viewport.center.x},${viewport.center.y}`} data-viewport-scale={viewport.scale} data-grid-cell={GRID_CELL} data-grid-major={GRID_MAJOR_EVERY} data-measurement-labels={measurementLabels.length} viewBox={`0 0 ${VIEWBOX.width} ${VIEWBOX.height}`} role="img" aria-label="几何画布" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerLeave={() => { setHoverCoordinate(null); setHoverPrimitiveType(null); onPointerCoordinate?.(null) }} onPointerUp={finishDrag} onPointerCancel={finishDrag} onDoubleClick={(event) => creationMode === "polyline" && onCanvasDoubleClick(eventToWorld(event, viewport))} onClick={(event) => { if (suppressClick.current) { suppressClick.current = false; return }; if (creationMode) onCanvasClick(eventToWorld(event, viewport)); else if (!dragStart) onSelect(null) }}>
    <g data-grid-layer="minor" stroke={gridStroke.minor} strokeWidth="1">{verticalGrid.filter((x) => !isMajorGridLine(x)).map((x) => <line key={`v-${x}`} x1={toX(x)} y1={VIEWBOX.top} x2={toX(x)} y2={VIEWBOX.bottom} />)}{horizontalGrid.filter((y) => !isMajorGridLine(y)).map((y) => <line key={`h-${y}`} x1={VIEWBOX.left} y1={toY(y)} x2={VIEWBOX.right} y2={toY(y)} />)}</g>
    <g data-grid-layer="major" stroke={gridStroke.major} strokeWidth="1">{verticalGrid.filter(isMajorGridLine).map((x) => <line key={`vm-${x}`} x1={toX(x)} y1={VIEWBOX.top} x2={toX(x)} y2={VIEWBOX.bottom} />)}{horizontalGrid.filter(isMajorGridLine).map((y) => <line key={`hm-${y}`} x1={VIEWBOX.left} y1={toY(y)} x2={VIEWBOX.right} y2={toY(y)} />)}</g>
    <line x1={VIEWBOX.left} y1={toY(0)} x2={VIEWBOX.right} y2={toY(0)} stroke={gridStroke.axis} strokeWidth="1.25" /><line x1={toX(0)} y1={VIEWBOX.top} x2={toX(0)} y2={VIEWBOX.bottom} stroke={gridStroke.axis} strokeWidth="1.25" />
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "line" }> => primitive.type === "line" && primitive.visible !== false).map((line) => { const visible = viewportLine(line); return <g key={line.id} data-primitive-type="line" opacity={opacityFor(line)} onPointerDown={(event) => beginDrag(event, line.id)} onClick={(event) => handleObjectClick(event, line.id)}><line data-hit-target="true" x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke={strokeFor(line)} strokeWidth={strokeWidthFor(line, selectedIds.includes(line.id))} strokeDasharray={dashFor(line)} />{renderHandles(line)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "ray" }> => primitive.type === "ray" && primitive.visible !== false).map((ray) => { const visible = rayToViewport(ray, worldBounds); return <g key={ray.id} data-primitive-type="ray" opacity={opacityFor(ray)} onPointerDown={(event) => beginDrag(event, ray.id)} onClick={(event) => handleObjectClick(event, ray.id)}><line data-hit-target="true" x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(visible.a.x)} y1={toY(visible.a.y)} x2={toX(visible.b.x)} y2={toY(visible.b.y)} stroke={strokeFor(ray)} strokeWidth={strokeWidthFor(ray, selectedIds.includes(ray.id))} strokeDasharray={dashFor(ray)} />{renderHandles(ray)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "segment" }> => primitive.type === "segment" && primitive.visible !== false).map((segment) => <g key={segment.id} data-primitive-type="segment" opacity={opacityFor(segment)} onPointerDown={(event) => beginDrag(event, segment.id)} onClick={(event) => handleObjectClick(event, segment.id)}><line data-hit-target="true" x1={toX(segment.a.x)} y1={toY(segment.a.y)} x2={toX(segment.b.x)} y2={toY(segment.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(segment.a.x)} y1={toY(segment.a.y)} x2={toX(segment.b.x)} y2={toY(segment.b.y)} stroke={strokeFor(segment)} strokeWidth={strokeWidthFor(segment, selectedIds.includes(segment.id))} strokeDasharray={dashFor(segment)} />{renderHandles(segment)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "polyline" }> => primitive.type === "polyline" && primitive.visible !== false).map((polyline) => <g key={polyline.id} data-primitive-type="polyline" opacity={opacityFor(polyline)} onPointerDown={(event) => beginDrag(event, polyline.id)} onClick={(event) => handleObjectClick(event, polyline.id)}><polyline data-hit-target="true" points={pointsAttribute(polyline.points, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(polyline.points, viewport)} fill="none" stroke={strokeFor(polyline)} strokeWidth={strokeWidthFor(polyline, selectedIds.includes(polyline.id))} strokeDasharray={dashFor(polyline)} />{renderHandles(polyline)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "parabola" }> => primitive.type === "parabola" && primitive.visible !== false).map((parabola) => { const sampled = sampleParabola(parabola, [worldBounds.minX, worldBounds.maxX], 128); return <g key={parabola.id} data-primitive-type="parabola" opacity={opacityFor(parabola)} onPointerDown={(event) => beginDrag(event, parabola.id)} onClick={(event) => handleObjectClick(event, parabola.id)}><polyline data-hit-target="true" points={pointsAttribute(sampled, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(sampled, viewport)} fill="none" stroke={strokeFor(parabola)} strokeWidth={strokeWidthFor(parabola, selectedIds.includes(parabola.id))} strokeDasharray={dashFor(parabola)} />{renderHandles(parabola)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "ellipse" }> => primitive.type === "ellipse" && primitive.visible !== false).map((ellipse) => { const sampled = sampleEllipse(ellipse, 160); return <g key={ellipse.id} data-primitive-type="ellipse" opacity={opacityFor(ellipse)} onPointerDown={(event) => beginDrag(event, ellipse.id)} onClick={(event) => handleObjectClick(event, ellipse.id)}><polyline data-hit-target="true" points={pointsAttribute(sampled, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(sampled, viewport)} fill={fillFor(ellipse)} stroke={strokeFor(ellipse)} strokeWidth={strokeWidthFor(ellipse, selectedIds.includes(ellipse.id))} strokeDasharray={dashFor(ellipse)} />{renderHandles(ellipse)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "hyperbola" }> => primitive.type === "hyperbola" && primitive.visible !== false).map((hyperbola) => { const [branch, opposite] = sampleHyperbolaBranches(hyperbola, [worldBounds.minX, worldBounds.maxX], 128); return <g key={hyperbola.id} data-primitive-type="hyperbola" opacity={opacityFor(hyperbola)} onPointerDown={(event) => beginDrag(event, hyperbola.id)} onClick={(event) => handleObjectClick(event, hyperbola.id)}><polyline data-hit-target="true" points={pointsAttribute(branch, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline data-hit-target="true" points={pointsAttribute(opposite, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(branch, viewport)} fill="none" stroke={strokeFor(hyperbola)} strokeWidth={strokeWidthFor(hyperbola, selectedIds.includes(hyperbola.id))} strokeDasharray={dashFor(hyperbola)} /><polyline points={pointsAttribute(opposite, viewport)} fill="none" stroke={strokeFor(hyperbola)} strokeWidth={strokeWidthFor(hyperbola, selectedIds.includes(hyperbola.id))} strokeDasharray={dashFor(hyperbola)} />{renderHandles(hyperbola)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "function" }> => primitive.type === "function" && primitive.visible !== false).map((primitive) => <g key={primitive.id} data-primitive-type="function" opacity={opacityFor(primitive)} onPointerDown={(event) => beginDrag(event, primitive.id)} onClick={(event) => handleObjectClick(event, primitive.id)}>{functionSegments(primitive).map((points, index) => <polyline key={`${primitive.id}-hit-${index}`} data-hit-target="true" points={pointsAttribute(points, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" />)}{functionSegments(primitive).map((points, index) => <polyline key={`${primitive.id}-${index}`} points={pointsAttribute(points, viewport)} fill="none" stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selectedIds.includes(primitive.id))} strokeDasharray={dashFor(primitive)} />)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "derivative" }> => primitive.type === "derivative" && primitive.visible !== false).map((primitive) => <g key={primitive.id} data-primitive-type="derivative" opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}><polyline data-hit-target="true" points={pointsAttribute(primitive.points, viewport)} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><polyline points={pointsAttribute(primitive.points, viewport)} fill="none" stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selectedIds.includes(primitive.id))} strokeDasharray={dashFor(primitive)} /></g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "tangent" | "normal" | "secant" }> => ["tangent", "normal", "secant"].includes(primitive.type) && primitive.visible !== false).map((primitive) => <g key={primitive.id} data-primitive-type={primitive.type} opacity={opacityFor(primitive)} onPointerDown={(event) => beginDrag(event, primitive.id)} onClick={(event) => handleObjectClick(event, primitive.id)}><line data-hit-target="true" x1={toX(primitive.a.x)} y1={toY(primitive.a.y)} x2={toX(primitive.b.x)} y2={toY(primitive.b.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(primitive.a.x)} y1={toY(primitive.a.y)} x2={toX(primitive.b.x)} y2={toY(primitive.b.y)} stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selectedIds.includes(primitive.id))} strokeDasharray={dashFor(primitive)} /></g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "integral" }> => primitive.type === "integral" && primitive.visible !== false && primitive.points.length > 1).map((primitive) => <g key={primitive.id} data-primitive-type="integral" opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}><polygon points={pointsAttribute([{ x: primitive.domain[0], y: 0 }, ...primitive.points, { x: primitive.domain[1], y: 0 }], viewport)} fill={fillFor(primitive)} fillOpacity="0.25" stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selectedIds.includes(primitive.id))} /></g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "analysisSet" }> => primitive.type === "analysisSet" && primitive.visible !== false).map((primitive) => <g key={primitive.id} data-primitive-type="analysisSet" opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}>{primitive.results.map((result, index) => <g key={`${primitive.id}-${result.kind}-${index}`} data-analysis-kind={result.kind}><circle cx={toX(result.x)} cy={toY(result.y)} r="4" fill={fillFor(primitive)} stroke={strokeFor(primitive)} strokeWidth="1.5" /><text x={toX(result.x) + 8} y={toY(result.y) - 8} fill={strokeFor(primitive)} fontSize="12" fontWeight="700">{result.kind}</text></g>)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "circle" }> => primitive.type === "circle" && primitive.visible !== false).map((circle) => {
      /**
       * 以某个点为**定点**的曲线（动圆）不画那个小圆心标记，也不把标签钉在圆心旁。
       *
       * 用户口径："这个动圆不需要标出圆心"。圆心在这里是派生量（由定点 + 半径 + 转角算出），
       * 标出来反而会和定点标记打架、也让人以为圆心是个可以抓的对象。
       */
      const anchored = Boolean(circle.rotationAbout)
      return <g key={circle.id} data-primitive-type="circle" opacity={opacityFor(circle)} onPointerDown={(event) => beginDrag(event, circle.id)} onClick={(event) => handleObjectClick(event, circle.id)}><circle data-hit-target="true" cx={toX(circle.center.x)} cy={toY(circle.center.y)} r={circle.radius * viewport.scale} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" />{!anchored && <circle data-shape-centre={circle.id} cx={toX(circle.center.x)} cy={toY(circle.center.y)} r="2" fill="var(--color-drawing-ink)" />}<circle cx={toX(circle.center.x)} cy={toY(circle.center.y)} r={circle.radius * viewport.scale} fill={fillFor(circle)} stroke={strokeFor(circle)} strokeWidth={strokeWidthFor(circle, selectedIds.includes(circle.id))} strokeDasharray={dashFor(circle)} />{!anchored && <text x={toX(circle.center.x) + circle.radius * viewport.scale + 8} y={toY(circle.center.y)} fill="var(--color-drawing-ink)" fontSize="14" fontWeight="700">{circle.label ?? circle.id}</text>}{anchored && <text x={toX(circle.center.x) + circle.radius * viewport.scale + 8} y={toY(circle.center.y)} fill="#2f6f4f" fontSize="13" fontWeight="700">{circle.label ?? circle.id}</text>}{renderHandles(circle)}</g>
    })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "arc" }> => primitive.type === "arc" && primitive.visible !== false).map((arc) => { const path = `M ${toX(arc.center.x + arc.radius * Math.cos(arc.startAngle))} ${toY(arc.center.y + arc.radius * Math.sin(arc.startAngle))} A ${arc.radius * viewport.scale} ${arc.radius * viewport.scale} 0 ${Math.abs(arc.endAngle - arc.startAngle) > Math.PI ? 1 : 0} ${arc.endAngle >= arc.startAngle ? 0 : 1} ${toX(arc.center.x + arc.radius * Math.cos(arc.endAngle))} ${toY(arc.center.y + arc.radius * Math.sin(arc.endAngle))}`; return <g key={arc.id} data-primitive-type="arc" opacity={opacityFor(arc)} onPointerDown={(event) => beginDrag(event, arc.id)} onClick={(event) => handleObjectClick(event, arc.id)}><path data-hit-target="true" d={path} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><path d={path} fill="none" stroke={strokeFor(arc)} strokeWidth={strokeWidthFor(arc, selectedIds.includes(arc.id))} strokeDasharray={dashFor(arc)} />{renderHandles(arc)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.type === "point" && primitive.visible !== false).map((point) => <g key={point.id} data-primitive-type="point" opacity={opacityFor(point)} onPointerDown={(event) => beginDrag(event, point.id)} onClick={(event) => handleObjectClick(event, point.id)}><circle data-hit-target="true" cx={toX(point.x)} cy={toY(point.y)} r="12" fill="transparent" pointerEvents="all" /><circle cx={toX(point.x)} cy={toY(point.y)} r={POINT_MARKER_RADIUS} fill={fillFor(point)} stroke={strokeFor(point)} strokeWidth={strokeWidthFor(point, selectedIds.includes(point.id))} strokeDasharray={dashFor(point)} /><text x={toX(point.x) + 10} y={toY(point.y) + 4} fill="var(--color-drawing-ink)" fontSize="13" fontWeight="700">{point.label ?? point.id}</text></g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" | "curveIntersection" }> => ["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection"].includes(primitive.type) && primitive.visible !== false).map((primitive) => { const selected = selectedIds.includes(primitive.id); return <g key={primitive.id} data-primitive-type={primitive.type} opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}><circle data-hit-target="true" cx={toX(primitive.x)} cy={toY(primitive.y)} r="14" fill="transparent" pointerEvents="all" /><circle cx={toX(primitive.x)} cy={toY(primitive.y)} r={selected ? 3.5 : 2.5} fill={fillFor(primitive)} stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selected)} strokeDasharray={dashFor(primitive)} />{selected && <text data-intersection-info="true" x={toX(primitive.x) + 9} y={toY(primitive.y) - 9} fill="var(--color-drawing-ink)" fontSize="11" fontWeight="600">{primitive.label ?? "交点 P"} ({primitive.x.toFixed(2)}, {primitive.y.toFixed(2)})</text>}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "intersectionSet" }> => primitive.type === "intersectionSet" && primitive.visible !== false).map((primitive) => { const selected = selectedIds.includes(primitive.id); return <g key={primitive.id} data-primitive-type="intersectionSet" opacity={opacityFor(primitive)} onClick={(event) => handleObjectClick(event, primitive.id)}>{primitive.points.map((point, index) => <g key={`${primitive.id}-point-${index}`}><circle data-hit-target="true" cx={toX(point.x)} cy={toY(point.y)} r="14" fill="transparent" pointerEvents="all" /><circle cx={toX(point.x)} cy={toY(point.y)} r={selected ? 3.5 : 2.5} fill={fillFor(primitive)} stroke={strokeFor(primitive)} strokeWidth={strokeWidthFor(primitive, selected)} strokeDasharray={dashFor(primitive)} />{selected && <text data-intersection-info="true" x={toX(point.x) + 9} y={toY(point.y) - 9} fill="var(--color-drawing-ink)" fontSize="11" fontWeight="600">{primitive.label ?? "交点集合"} {index + 1} ({point.x.toFixed(2)}, {point.y.toFixed(2)})</text>}</g>)}</g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }> => selectedIds.includes(primitive.id) && ["parabola", "ellipse", "hyperbola"].includes(primitive.type) && primitive.visible !== false).map((primitive) => <g key={`${primitive.id}-features`} data-feature-marker="true">{conicFeatures(primitive).map((feature) => <g key={`${primitive.id}-${feature.label}`}><circle cx={toX(feature.point.x)} cy={toY(feature.point.y)} r="3.5" fill="#ffffff" stroke="#f04f5f" strokeWidth="1.5" /><text x={toX(feature.point.x) + 9} y={toY(feature.point.y) - 9} fill="#f04f5f" fontSize="13" fontWeight="700">{feature.label}</text></g>)}</g>)}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "connection" }> => primitive.type === "connection" && primitive.kind !== "parabola" && primitive.visible !== false).map((connection) => { const endpoints = connectionEndpoints(connection); if (!endpoints) return null; const hit = insetSegment(endpoints, connectionHitInset(viewport.scale)); return <g key={connection.id} data-primitive-type="connection" opacity={opacityFor(connection)} onClick={(event) => handleObjectClick(event, connection.id)}><line data-hit-target="true" x1={toX(hit.start.x)} y1={toY(hit.start.y)} x2={toX(hit.end.x)} y2={toY(hit.end.y)} stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><line x1={toX(endpoints.start.x)} y1={toY(endpoints.start.y)} x2={toX(endpoints.end.x)} y2={toY(endpoints.end.y)} stroke={strokeFor(connection)} strokeWidth={strokeWidthFor(connection, selectedIds.includes(connection.id))} strokeDasharray={dashFor(connection)} /></g> })}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "connection" }> => primitive.type === "connection" && primitive.kind === "parabola" && primitive.visible !== false).map((connection) => { const endpoints = connectionEndpoints(connection); const control = connectionControl(connection); if (!endpoints || !control) return null; const path = `M ${toX(endpoints.start.x)} ${toY(endpoints.start.y)} Q ${toX(control.x)} ${toY(control.y)} ${toX(endpoints.end.x)} ${toY(endpoints.end.y)}`; return <g key={connection.id} data-primitive-type="connection" data-connection-kind="parabola" opacity={opacityFor(connection)} onClick={(event) => handleObjectClick(event, connection.id)}><path data-hit-target="true" d={path} fill="none" stroke="transparent" strokeWidth="18" pointerEvents="stroke" /><path d={path} fill="none" stroke={strokeFor(connection)} strokeWidth={strokeWidthFor(connection, selectedIds.includes(connection.id))} strokeDasharray={dashFor(connection)} /></g> })}
    {/* 轨迹画在点**之前**：动点永远落在自己的轨迹上，轨迹若压在点的命中区之上，点就再也拖不动了。 */}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "locus" }> => primitive.type === "locus" && primitive.visible !== false).map((locus) => <g key={locus.id} data-primitive-type="locus" opacity={opacityFor(locus)} onClick={(event) => handleObjectClick(event, locus.id)}>{locusSegments(locus).map((points, index) => <polyline key={`${locus.id}-${index}`} points={pointsAttribute(points, viewport)} fill="none" stroke={strokeFor(locus)} strokeWidth={strokeWidthFor(locus, selectedIds.includes(locus.id))} strokeDasharray={dashFor(locus)} />)}</g>)}
    {renderAnnotations()}
    {/* 定点标记：告诉用户"曲线正绕哪个点转"，它本身不接指针事件。 */}
    {renderRotationAnchors()}
    {/* 交点预览画在曲线之上、但在**点之下**：预览的命中圆同样是 14px，若画在最后会把点抢走。 */}
    {renderIntersectionPreviews()}
    {/**
       * 点的命中区在**最上面再画一遍**（透明，只接指针事件）。
       *
       * 用户反馈："把动点放在轨道上，动点又和另一个定点连了线，那我移动轨道会带着设置好的定点一起移动"。
       * 取证（Playwright 读 `elementFromPoint`）发现真正的问题是：连线与轨迹都画在点**之后**，
       * 而连线那根可见线正好从两端点穿过（轨迹更是必然穿过动点自己），于是"点正中心"的那一下
       * 指针按下落在它们身上——它们是派生对象、`getDragHandle` 返回 null，拖动根本不成立，
       * 还会退化成框选：点看起来"抓不住"，连带定点也拖不动。
       *
       * 与其把整层绘制顺序倒过来（连线 / 轨迹 / 交点预览自身仍要能被点选），
       * 不如把点的命中区补在最上面：点始终赢，派生曲线与预览中段照旧可选。
       */}
    {displayPrimitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point" }> => primitive.type === "point" && primitive.visible !== false).map((point) => <circle key={`${point.id}-hit-top`} data-primitive-type="point" data-point-hit="top" data-hit-target="true" cx={toX(point.x)} cy={toY(point.y)} r="12" fill="transparent" pointerEvents="all" onPointerDown={(event) => beginDrag(event, point.id)} onClick={(event) => handleObjectClick(event, point.id)} />)}
    {selectionRect && <rect className="selection-rect" data-selection-mode={selectionRect.mode} x={selectionRect.x} y={selectionRect.y} width={selectionRect.width} height={selectionRect.height} />}
    {/**
      * 测量数字**常驻画布**（最上层，压在图形之上）：不需要选中任何对象就能看到有效测量的数值。
      *
      * 用户口径："我希望数学测量的结果能在图中浮现一个数字，而不是非要去看右侧属性栏。"
      * 文本与右侧属性栏是**同一份**（`planarMeasurementVisuals.planarMeasurementText`），
      * 位置按度量类型算（中点 / 垂足中点 / 角平分线 / 形心），算不出位置就不画。
      * 这一层 `pointer-events: none`（见 CSS），所以拾取行为一字不变。
      */}
    {measurementLabels.map((label) => <text key={label.id} className="planar-measurement-label" data-measurement-label={label.id} data-selected={label.selected ? "true" : "false"} x={toX(label.position.x)} y={toY(label.position.y)} textAnchor="middle">{label.text}</text>)}
  </svg></div></main>
}
