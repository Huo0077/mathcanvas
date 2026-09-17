import { useEffect, useMemo, useRef, useState } from "react"

import { decodeMgeo, encodeMgeo, type AnnotationFeature, type DrawingSheetSpec, type EngineeringAnnotationKind, type Measurement3Metric, type PrimitiveSpec, type Vector3, type Workspace } from "@draw/dsl"
import { buildSolidTemplate, createMeasurement3, evaluatePlanarMeasurement, host3FromPrimitive, selectPrimitivesInBox, type BoxSelectionMode, type PlanarMetric } from "@draw/geometry-kernel"
import { deletionTargets, sectionMaterialization, sectionPivot, sectionPlaneThroughSource, sectionSourceVertices, solidVolumeHostFor, validateDeletion, validatePatch } from "@draw/scene-graph"
import type { Alignment } from "@draw/scene-graph"

import { AlgebraView } from "./components/AlgebraView"
import { AppChrome } from "./components/AppChrome"
import { DocumentTreePanel } from "./components/DocumentTreePanel"
import { DrawingSheetView } from "./components/DrawingSheetView"
import { DraftControlsRow } from "./components/DraftControlsRow"
import { DrawingTree } from "./components/DrawingTree"
import type { DrawingViewPatch } from "./components/DrawingViewport"
import { EngineeringDrawingView, type ProjectionSource } from "./components/EngineeringDrawingView"
import { EngineeringInspector, type InspectorSource } from "./components/EngineeringInspector"
import { EngineeringWorkbench, type CadMode } from "./components/EngineeringWorkbench"
import type { InspectorTab } from "./components/InspectorTabs"
import { GraphicsView } from "./components/GraphicsView"
import { GuidanceHint } from "./components/GuidanceHint"
import { guidanceFor } from "./guidance"
import { LayerTree } from "./components/LayerTree"
import { PropertiesBar, type PropertiesBarProps } from "./components/PropertiesBar"
import { StatusBar } from "./components/StatusBar"
import { createRibbonGroups } from "./ribbonCommands"
import { anchoredCurve } from "./curveRotation"
import { PaperTexture } from "./components/PaperTexture"
import { resolveIntersectionPreview } from "./intersectionPreview3d"
import { ThreeSceneView } from "./threeScene"
import type { RibbonTabId } from "./uiState"
import type { IntersectionPreview } from "./intersectionPreview"
import { loadActiveWorkspace, loadDraft, saveDraft } from "./persistence/draftStorage"
import { resolveGeometryEdit, type GeometryEditRequest } from "./draftEditing"
import { exportCsv, exportSvg } from "./persistence/exporters"
import { exportEngineeringDxf, exportEngineeringPdf, exportEngineeringSvg, selectExportableDrawings } from "./persistence/engineeringExporters"
import { defaultDraftView, drawingViewLabels, resolveProjectedDrawing } from "./projectionVisuals"
import { migrateLegacySolids } from "./solidTemplates"
import { pointHostOptions, parsePointHostValue } from "./pointHostOptions"
import { ROUND_SOLID_SEGMENTS } from "./solidDefaults"
import { point3ToolAvailability } from "./spatialTools"
import { resolveStatusPrompt, resolveIntersectionPreviewPrompt, resolvePreviewInventoryPrompt, type SceneControlMode } from "./statusPrompts"
import { computeIntersectionPreviews3d, type IntersectionPreview3dCache } from "./intersectionPreviews3d"
import { toScenePreview, toSectionScenePreview, toSelectionLineScenePreview, type ThreeScenePreview } from "./threeScenePreview"
import { dynamicPointPaths, isDynamicPointPath } from "./dynamicPointPaths"
import { useSceneStore } from "./store"

type CreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null
type CreationStep = { mode: Exclude<CreationMode, null>; center: { x: number; y: number } | null; start?: { x: number; y: number }; points?: { x: number; y: number }[] }
const engineeringDrawingViews = ["front", "top", "left", "axonometric"] as const

function nextPrimitiveId(document: ReturnType<typeof useSceneStore.getState>["document"], prefix: string): string {
  let index = 1
  while (document.primitives.some((primitive) => primitive.id === `${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function nextGroupId(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  let index = 1
  while (document.groups.some((group) => group.id === `group-${index}`)) index += 1
  return `group-${index}`
}

function nextAnnotationId(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  let index = 1
  while (document.annotations.some((annotation) => annotation.id === `annotation-${index}`)) index += 1
  return `annotation-${index}`
}

function nextEngineeringAnnotationId(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  let index = 1
  while (document.engineeringAnnotations?.some((annotation) => annotation.id === `engineering-annotation-${index}`)) index += 1
  return `engineering-annotation-${index}`
}

function nextMeasurementId(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  let index = 1
  while (document.measurements.some((measurement) => measurement.id === `measurement3-${index}`)) index += 1
  return `measurement3-${index}`
}

/**
 * 新建"动圆"的默认半径（世界单位）。与画布默认取景相称：够大能看清，又不至于一出来就超出视野。
 */
const DEFAULT_MOVING_CIRCLE_RADIUS = 2

/**
 * Planar points use the classroom labels A…Z; after Z the counter falls back to a running number so a
 * long construction never reuses a label. Existing documents keep whatever labels they already stored.
 */
function nextPointLabel(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  const usedLabels = new Set(document.primitives.filter((primitive) => primitive.type === "point").map((primitive) => primitive.label))
  for (let index = 0; index < 26; index += 1) {
    const label = String.fromCharCode(65 + index)
    if (!usedLabels.has(label)) return label
  }
  return `P${document.primitives.filter((primitive) => primitive.type === "point").length + 1}`
}

function nextPoint3Label(document: ReturnType<typeof useSceneStore.getState>["document"]): string {
  const usedLabels = new Set(document.primitives.filter((primitive) => primitive.type === "point3").map((primitive) => primitive.label))
  for (let index = 0; index < 26; index += 1) {
    const label = String.fromCharCode(65 + index)
    if (!usedLabels.has(label)) return label
  }
  return `P${document.primitives.filter((primitive) => primitive.type === "point3").length + 1}`
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable)
}

/** Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y redo — unless a text field owns the keystroke. */
function historyShortcut(event: KeyboardEvent): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || isTextEditingTarget(event.target)) return null
  const key = event.key.toLowerCase()
  if (key === "z") return event.shiftKey ? "redo" : "undo"
  return key === "y" ? "redo" : null
}

export function App() {
  const document = useSceneStore((state) => state.document)
  const apply = useSceneStore((state) => state.apply)
  const undo = useSceneStore((state) => state.undo)
  const redo = useSceneStore((state) => state.redo)
  const switchWorkspace = useSceneStore((state) => state.switchWorkspace)
  const replace = useSceneStore((state) => state.replace)
  const operationError = useSceneStore((state) => state.error)
  const treeTab = useSceneStore((state) => state.treeTab)
  const workspaceDocuments = useSceneStore((state) => state.workspaceDocuments)
  const expandedIds = useSceneStore((state) => state.expandedIds)
  const filterQuery = useSceneStore((state) => state.filterQuery)
  const setTreeTab = useSceneStore((state) => state.setTreeTab)
  const toggleExpanded = useSceneStore((state) => state.toggleExpanded)
  const setExpandedIds = useSceneStore((state) => state.setExpandedIds)
  const setFilterQuery = useSceneStore((state) => state.setFilterQuery)
  const canUndo = useSceneStore((state) => state.history.length > 0)
  const canRedo = useSceneStore((state) => state.future.length > 0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const draftLoadedRef = useRef(false)
  const skipNextDraftSaveRef = useRef(false)
  const [fileError, setFileError] = useState<string | null>(null)
  /**
   * 左下角的一次性操作指引：只在点击功能键时写入，由用户关闭、Esc、切换工作区或「创建动作完成」
   * 清空，所以它不会变成一块常驻的说明面板。
   */
  const [guidance, setGuidance] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [mobileDock, setMobileDock] = useState<"objects" | "properties" | null>(null)
  const [creationStep, setCreationStep] = useState<CreationStep | null>(null)
  const [cadMode, setCadMode] = useState<CadMode>("projection")
  const [activeCommand, setActiveCommand] = useState<string | null>(null)
  const [showProjectionDiagnostics, setShowProjectionDiagnostics] = useState(false)
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null)
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [pointerCoordinate, setPointerCoordinate] = useState<{ x: number; y: number } | null>(null)
  const [layerNotice, setLayerNotice] = useState<string | null>(null)
  const [sceneControl, setSceneControl] = useState<SceneControlMode | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("data")
  /**
   * 工程制图的投影来源。工作区文档是独立的，用户在立体几何里建的模型默认不会出现在工程制图里；
   * 这里允许显式切换成投影立体几何文档，而不是让他去猜"为什么四个视图都是空的"。
   */
  const [projectionSource, setProjectionSource] = useState<ProjectionSource>("cad")
  /**
   * 指针当前落在哪一份 3D 预览上（存 **key** 而不是对象本身：文档一变，标签与体积读数要跟着更新，
   * 存对象会让状态栏停在上一次的那份内容上）。
   */
  const [hoveredPreviewKey, setHoveredPreviewKey] = useState<string | null>(null)
  /**
   * 3D 预览 = **自动**枚举出的所有两两交线 / 交面（与平面画布一致：交点一直在那儿，点一下就创建），
   * 外加"单个实体选中时的默认剖切平面截面"这一份既有预览。
   *
   * 求交结果按来源几何签名缓存：拖动一个实体时只有与它相关的那几对重算，其余沿用上一次的结论。
   */
  const previewCacheRef = useRef<IntersectionPreview3dCache | null>(null)
  const previewSweep = useMemo(() => {
    if (document.workspace !== "geometry3d") return null
    const sweep = computeIntersectionPreviews3d(document, { previous: previewCacheRef.current ?? undefined })
    previewCacheRef.current = sweep.cache
    return sweep
  }, [document])
  /**
   * 选择驱动的预览只保留"单个实体 → 默认剖切平面截面"，同时承担"为什么这里没有交线"的解释责任
   *（`insufficient` 的 `reason` 就是状态栏要说的话）。
   */
  const selectionPreview = useMemo(
    () => (document.workspace === "geometry3d" ? resolveIntersectionPreview(document, selectedIds) : null),
    [document, selectedIds]
  )
  const scenePreviews = useMemo(() => {
    const list = (previewSweep?.previews ?? []).map((preview) => toScenePreview(preview, selectedIds))
    const keys = new Set(list.map((item) => item.key))
    /**
     * 自动枚举只覆盖顶层实体；用户选中两个**面 / 平面**时，交线预览回到选择驱动的老路径。
     * 按 key 去重：同一对（两个实体都选中）不会画两遍。
     */
    const selectionLine = toSelectionLineScenePreview(selectionPreview)
    if (selectionLine && !keys.has(selectionLine.key)) list.push(selectionLine)
    const section = toSectionScenePreview(selectionPreview)
    if (section) list.push(section)
    return list
  }, [previewSweep, selectionPreview, selectedIds])
  /**
   * 状态栏要说的是**指针下这一份**：按 key 从当前预览里查，所以文档一变（体积、段数、标签）
   * 读数就是最新的；没有悬停时退回到选择解释（例如"两个平面没有有界交线"）。
   */
  const hoveredPreview = hoveredPreviewKey ? scenePreviews.find((item) => item.key === hoveredPreviewKey) ?? null : null
  const previewStatus = hoveredPreview ?? selectionPreview
  const [activeRibbonTab, setActiveRibbonTab] = useState<RibbonTabId | null>("home")
  const [ribbonExpanded, setRibbonExpanded] = useState(true)
  const [ribbonPinned, setRibbonPinned] = useState(false)
  const selectedId = selectedIds.at(-1) ?? null
  const slope = document.parameters.slope
  const slopeLine = useMemo(() => document.primitives.find((primitive) => primitive.id === "line-slope"), [document.primitives])
  // Projection geometry is derived once per revision and shared by the four viewports and every exporter.
  const engineeringDrawings = useMemo(() => engineeringDrawingViews.map((view) => resolveProjectedDrawing(document, view)), [document])
  // Hidden sheet views are dropped from exports instead of being replaced with fabricated geometry.
  const exportableEngineeringDrawings = useMemo(() => selectExportableDrawings(engineeringDrawings, document.drawingViews ?? []), [engineeringDrawings, document.drawingViews])
  const cadDiagnosticCount = engineeringDrawings.reduce((total, drawing) => total + drawing.diagnostics.length, 0)

  const downloadBlob = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = globalThis.document.createElement("a")
    anchor.href = url
    anchor.download = `${document.metadata.name.replace(/\s+/g, "-")}.${extension}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const download = (content: string, type: string, extension: string) => downloadBlob(new Blob([content], { type }), extension)
  const reportFileError = (error: unknown, fallback: string) => setFileError(error instanceof Error ? error.message : fallback)
  const save = () => {
    try { download(encodeMgeo(document), "application/json", "mgeo"); setFileError(null) } catch (error) { reportFileError(error, "无法保存 .mgeo 文件") }
  }
  const exportSvgFile = async (format: "svg" | "dxf" | "pdf" = "svg") => {
    try {
      if (format === "pdf") {
        if (document.workspace !== "cad") return
        const content = await exportEngineeringPdf(exportableEngineeringDrawings)
        downloadBlob(new Blob([content.buffer as ArrayBuffer], { type: "application/pdf" }), "pdf")
        setFileError(null)
        return
      }
      if (format === "dxf") {
        if (document.workspace !== "cad") return
        download(exportEngineeringDxf(exportableEngineeringDrawings), "application/dxf", "dxf")
        setFileError(null)
        return
      }
      const content = document.workspace === "cad" ? exportEngineeringSvg(exportableEngineeringDrawings) : exportSvg(document)
      download(content, "image/svg+xml", "svg")
      setFileError(null)
    } catch (error) { reportFileError(error, "无法导出 SVG 文件") }
  }
  const exportCsvFile = () => {
    try { download(exportCsv(document), "text/csv;charset=utf-8", "csv"); setFileError(null) } catch (error) { reportFileError(error, "无法导出 CSV 文件") }
  }
  const exportPngFile = () => {
    try {
      const svgUrl = URL.createObjectURL(new Blob([exportSvg(document)], { type: "image/svg+xml" }))
      const image = new Image()
      image.onload = () => {
        const canvas = globalThis.document.createElement("canvas")
        canvas.width = 1600
        canvas.height = 760
        const context = canvas.getContext("2d")
        if (!context) { URL.revokeObjectURL(svgUrl); setFileError("当前浏览器不支持 PNG 导出"); return }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => { URL.revokeObjectURL(svgUrl); if (!blob) setFileError("无法生成 PNG 文件"); else { downloadBlob(blob, "png"); setFileError(null) } }, "image/png")
      }
      image.onerror = () => { URL.revokeObjectURL(svgUrl); setFileError("无法渲染 PNG 导出内容") }
      image.src = svgUrl
    } catch (error) { reportFileError(error, "无法导出 PNG 文件") }
  }
  const load = (serialized: string) => {
    try {
      replace(migrateLegacySolids(decodeMgeo(serialized)))
      /**
       * 换文档必须**清掉选中状态**：图元 id 是确定性的（每个文档都从 `point-1` 开始），
       * 留着旧选中项会让属性栏继续编辑"打开来的同名对象"——用户下一次改属性就悄悄改了别人。
       * 创建流程与活动图纸同理：它们描述的是上一份文档的操作状态。
       */
      setSelectedIds([])
      setCreationStep(null)
      setActiveSheetId(null)
      setActiveViewId(null)
      setFileError(null)
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "无法打开 .mgeo 文件")
    }
  }

  const creationMode: CreationMode = creationStep?.mode ?? null
  const startCreation = (mode: Exclude<CreationMode, null>) => {
    if (document.workspace === "geometry3d") {
      // 预置条件不足时给左下角指引，而不是弹一条不知道该怎么做的报错。
      if (mode === "line") {
        if (canCreateLine3) addLine3()
        else setGuidance(guidanceFor({ kind: "point3Tool", tool: "line", outcome: "blocked", point3Count: selectedPoint3Ids.length }))
      }
      if (mode === "segment") {
        if (canCreatePlane3) addPlane3()
        else setGuidance(guidanceFor({ kind: "point3Tool", tool: "plane", outcome: "blocked", point3Count: selectedPoint3Ids.length }))
      }
      if (mode === "ray" || mode === "polyline") {
        if (canCreateFace3) addFace3()
        else setGuidance(guidanceFor({ kind: "point3Tool", tool: "face", outcome: "blocked", point3Count: selectedPoint3Ids.length }))
      }
      return
    }
    setCreationStep({ mode, center: null })
    setGuidance(guidanceFor({ kind: "creation", mode }))
  }
  /** New 2D objects join the active CAD layer so the layer tree can hide or lock them. */
  const cadLayerFields = (): { layerId?: string } => document.workspace === "cad" && document.activeLayerId ? { layerId: document.activeLayerId } : {}
  const handleCanvasClick = (coordinate: { x: number; y: number }) => {
    if (!creationStep) return
    if (creationStep.mode === "polyline") {
      const points = creationStep.points ?? []
      if (!points.length || Math.hypot(coordinate.x - points.at(-1)!.x, coordinate.y - points.at(-1)!.y) >= 0.05) setCreationStep({ ...creationStep, points: [...points, coordinate] })
      return
    }
    if (!creationStep.center) {
      setCreationStep({ ...creationStep, center: coordinate })
      return
    }
    if (creationStep.mode === "line" || creationStep.mode === "segment" || creationStep.mode === "ray") {
      if (Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y) < 0.05) return
      const type = creationStep.mode
      const id = nextPrimitiveId(document, type)
      apply({ op: "addPrimitive", primitive: { id, type, a: creationStep.center, b: coordinate, ...cadLayerFields(), label: `${type === "line" ? "直线" : type === "ray" ? "射线" : "线段"} ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
      setCreationStep(null)
      return
    }
    if (creationStep.mode === "circle") {
      const radius = Math.hypot(coordinate.x - creationStep.center.x, coordinate.y - creationStep.center.y)
      if (radius < 0.05) return
      const id = nextPrimitiveId(document, "circle")
      apply({ op: "addPrimitive", primitive: { id, type: "circle", center: creationStep.center, radius, ...cadLayerFields(), label: `圆 ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
      setCreationStep(null)
      return
    }
    if (!creationStep.start) {
      setCreationStep({ ...creationStep, start: coordinate })
      return
    }
    const radius = Math.hypot(creationStep.start.x - creationStep.center.x, creationStep.start.y - creationStep.center.y)
    if (radius < 0.05) return
    const startAngle = Math.atan2(creationStep.start.y - creationStep.center.y, creationStep.start.x - creationStep.center.x)
    const endAngle = Math.atan2(coordinate.y - creationStep.center.y, coordinate.x - creationStep.center.x)
    const id = nextPrimitiveId(document, "arc")
    apply({ op: "addPrimitive", primitive: { id, type: "arc", center: creationStep.center, radius, startAngle, endAngle, ...cadLayerFields(), label: `圆弧 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setCreationStep(null)
  }

  const handleCanvasCreationClick = (coordinate: { x: number; y: number }) => {
    handleCanvasClick(coordinate)
  }
  const handleCanvasDoubleClick = (coordinate: { x: number; y: number }) => {
    if (!creationStep || creationStep.mode !== "polyline") return
    const points = creationStep.points ?? []
    const finalPoints = !points.length || Math.hypot(coordinate.x - points.at(-1)!.x, coordinate.y - points.at(-1)!.y) < 0.05 ? points : [...points, coordinate]
    if (finalPoints.length < 2) return
    const id = nextPrimitiveId(document, "polyline")
    apply({ op: "addPrimitive", primitive: { id, type: "polyline", points: finalPoints, ...cadLayerFields(), label: `折线 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setCreationStep(null)
  }

  useEffect(() => {
    if (draftLoadedRef.current) return
    draftLoadedRef.current = true
    const workspace = loadActiveWorkspace()
    if (workspace && workspace !== document.workspace) switchWorkspace(workspace)
    // 读不出来的草稿会被**保留**在旁路键上（绝不静默删除用户的草稿），这里如实告诉用户发生了什么。
    try {
      const draft = loadDraft(workspace ?? document.workspace)
      if (draft) { skipNextDraftSaveRef.current = true; replace(migrateLegacySolids(draft)) }
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "无法恢复上次的草稿")
    }
  }, [document.workspace, replace, switchWorkspace])

  useEffect(() => {
    if (skipNextDraftSaveRef.current) { skipNextDraftSaveRef.current = false; return }
    try { saveDraft(document) } catch (error) { reportFileError(error, "无法自动保存草稿") }
  }, [document])

  /**
   * 新建出来的对象要**自动选中**，否则用户点完按钮什么都看不到（检查器里还是上一个对象）。
   * 放在 effect 里做：`apply` 之后 `document` 才会更新，`selectedPrimitive` 也才认得出这个新 id。
   */
  const pendingSelectionRef = useRef<string | null>(null)
  useEffect(() => {
    const pending = pendingSelectionRef.current
    if (!pending) return
    if (!document.primitives.some((primitive) => primitive.id === pending)) return
    pendingSelectionRef.current = null
    setSelectedIds([pending])
  }, [document])

  /**
   * 一次多步创建（直线/圆/圆弧/折线）画完就撤掉指引：已经完成的点击序列留着只会变成过期说明。
   * 用「上一步是否 pending」判断，避免把一次性指引（添加函数、测量）也一起清掉。
   */
  const pendingCreationRef = useRef(false)
  useEffect(() => {
    if (pendingCreationRef.current && !creationStep) setGuidance(null)
    pendingCreationRef.current = creationStep !== null
  }, [creationStep])

  const addDefaultPrimitive = (type: "parabola" | "ellipse" | "hyperbola" | "function") => {
    const id = nextPrimitiveId(document, type)
    const primitive = type === "parabola"
      ? { id, type, vertex: { x: 0, y: -1 }, focalParameter: 2, axis: "y" as const, label: `抛物线 ${id.split("-").at(-1)}` }
      : type === "ellipse"
        ? { id, type, center: { x: 0, y: 0 }, radiusX: 4, radiusY: 2, label: `椭圆 ${id.split("-").at(-1)}` }
        : type === "hyperbola"
          ? { id, type, center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2, axis: "x" as const, label: `双曲线 ${id.split("-").at(-1)}` }
          : { id, type, expression: "x*x", domain: [-6, 6] as [number, number], samples: 128, label: `函数 ${id.split("-").at(-1)}` }
    apply({ op: "addPrimitive", primitive })
    setSelectedIds([id])
    setGuidance(guidanceFor(type === "function" ? { kind: "function" } : { kind: "conic", type }))
  }

  const selectedPrimitive = selectedId ? document.primitives.find((primitive) => primitive.id === selectedId) ?? null : null
  /**
   * Calculus entry points for the planar workspace. The retired 微积分 workspace used to build these objects, but
   * the kernel and the DSL still model them; creating them from a selected function keeps the feature reachable
   * without restoring a whole workspace. `applyOperation` recomputes the derived geometry in the same patch.
   */
  const addFunctionAnalysis = (sourceId: string, kind: "derivative" | "tangent" | "integral") => {
    const source = document.primitives.find((primitive): primitive is Extract<PrimitiveSpec, { type: "function" }> => primitive.id === sourceId && primitive.type === "function")
    if (!source) return
    const id = nextPrimitiveId(document, kind)
    const index = id.split("-").at(-1)
    const midpoint = (source.domain[0] + source.domain[1]) / 2
    const primitive: PrimitiveSpec = kind === "derivative"
      ? { id, type: "derivative", sourceId, order: 1, domain: [...source.domain], samples: source.samples ?? 128, points: [], status: "approximate", label: `导函数 ${index}` }
      : kind === "tangent"
        ? { id, type: "tangent", sourceId, x: midpoint, point: { x: midpoint, y: 0 }, slope: 0, a: { x: source.domain[0], y: 0 }, b: { x: source.domain[1], y: 0 }, status: "approximate", label: `切线 ${index}` }
        : { id, type: "integral", sourceId, domain: [...source.domain], steps: 256, points: [], area: null, status: "approximate", label: `积分区域 ${index}` }
    apply({ op: "addPrimitive", primitive })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "functionAnalysis", analysis: kind }))
  }
  const intersectionTypes = ["point", "line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function"] as const
  const selectedPointIds = selectedIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point")
  const selectedPoint3Ids = selectedIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point3")
  const point3ToolState = point3ToolAvailability(selectedPoint3Ids.length, selectedIds.length)
  const canCreateLine3 = point3ToolState.line
  const canCreatePlane3 = point3ToolState.plane
  const canCreateFace3 = point3ToolState.face
  const canCreatePointConnection = (selectedIds.length === 2 || selectedIds.length === 3) && selectedPointIds.length === selectedIds.length
  const canCreateIntersection = canCreatePointConnection || (selectedIds.length === 2 && selectedIds.every((id) => intersectionTypes.includes(document.primitives.find((primitive) => primitive.id === id)?.type as typeof intersectionTypes[number])))
  const allSelectedLocked = selectedIds.length > 0 && selectedIds.every((id) => document.primitives.find((primitive) => primitive.id === id)?.locked)
  const allSelectedVisible = selectedIds.length > 0 && selectedIds.every((id) => document.primitives.find((primitive) => primitive.id === id)?.visible !== false)
  const selectedGroup = document.groups.find((group) => group.members.length === selectedIds.length && group.members.every((id) => selectedIds.includes(id))) ?? null
  const updateSelection = (id: string | null, additive = false) => {
    setCreationStep(null)
    if (!id) {
      setSelectedIds([])
      return
    }
    // 选中模板实体时说明 Alt 修饰键，否则用户永远找不到「单独选中一个面」的入口（二面角、剖切都靠它）。
    const picked = document.primitives.find((primitive) => primitive.id === id)
    if (picked && ["cube", "pyramid", "cylinder", "cone"].includes(picked.type)) setGuidance(guidanceFor({ kind: "selectSolid" }))
    setSelectedIds((current) => additive ? (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]) : [id])
  }
  /**
   * 框选：**左→右**只选完全包含的对象，**右→左**选相交的对象（CAD 约定）。
   * 平面基础图元交给内核的 `selectPrimitivesInBox`；函数、圆锥曲线和派生曲线仍按原有的
   * "完全包含"判定（它们没有解析的框相交几何，相交语义只覆盖平面基础图元）。
   */
  const planarBoxTypes = new Set(["point", "line", "segment", "ray", "polyline", "circle", "arc"])
  const selectBox = (bounds: { minX: number; minY: number; maxX: number; maxY: number }, mode: BoxSelectionMode = "window") => {
    const planar = selectPrimitivesInBox(document.primitives, bounds, mode)
    const rest = document.primitives.filter((primitive) => {
      if (planarBoxTypes.has(primitive.type)) return false
      if (primitive.type === "parabola") return primitive.vertex.x >= bounds.minX && primitive.vertex.x <= bounds.maxX && primitive.vertex.y >= bounds.minY && primitive.vertex.y <= bounds.maxY
      if (primitive.type === "ellipse" || primitive.type === "hyperbola") return primitive.center.x >= bounds.minX && primitive.center.x <= bounds.maxX && primitive.center.y >= bounds.minY && primitive.center.y <= bounds.maxY
      if (primitive.type === "function") return primitive.domain[0] >= bounds.minX && primitive.domain[1] <= bounds.maxX
      if (primitive.type === "derivative") return primitive.points.length > 0 && primitive.points.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "tangent" || primitive.type === "normal") return [primitive.a, primitive.b].every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "secant") return [primitive.a, primitive.b].every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "integral") return primitive.points.length > 0 && primitive.points.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "analysisSet") return primitive.results.length > 0 && primitive.results.every((point) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY)
      if (primitive.type === "intersection" || primitive.type === "lineCircleIntersection" || primitive.type === "circleIntersection" || primitive.type === "curveIntersection") return primitive.x >= bounds.minX && primitive.x <= bounds.maxX && primitive.y >= bounds.minY && primitive.y <= bounds.maxY
      return false
    }).map((primitive) => primitive.id)
    setSelectedIds([...planar, ...rest])
  }
  const toggleLock = () => apply({ op: "setPrimitivesLocked", ids: selectedIds, locked: !allSelectedLocked })
  const createGroup = () => apply({ op: "createGroup", group: { id: nextGroupId(document), label: `分组 ${document.groups.length + 1}`, members: selectedIds } })
  const deleteGroup = () => selectedGroup && apply({ op: "deleteGroup", id: selectedGroup.id })
  const alignSelection = (alignment: Alignment) => apply({ op: "alignPrimitives", ids: selectedIds, alignment })
  const createIntersection = () => {
    if (!canCreateIntersection) return
    const [objectA, objectB] = selectedIds
    if (canCreatePointConnection) {
      const id = nextPrimitiveId(document, "connection")
      const isParabola = selectedIds.length === 3
      apply({ op: "addPrimitive", primitive: isParabola
        ? { id, type: "connection", kind: "parabola", startPointId: objectA, endPointId: objectB, control: { thirdPointId: selectedIds[2] }, label: `抛物线连接 ${id.split("-").at(-1)}` }
        : { id, type: "connection", kind: "segment", startPointId: objectA, endPointId: objectB, label: `连接 ${id.split("-").at(-1)}` } })
      setSelectedIds([id])
      return
    }
    const id = nextPrimitiveId(document, "intersectionSet")
    apply({ op: "addPrimitive", primitive: { id, type: "intersectionSet", objectA, objectB, points: [], label: `交点集合 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
  }

  const addDefaultCube = () => {
    const id = nextPrimitiveId(document, "cube")
    addSolidTemplate({ id, type: "cube", origin: { x: -2, y: -2, z: -1 }, size: { x: 4, y: 4, z: 2 }, label: `立方体 ${id.split("-").at(-1)}` })
  }
  const addDefaultSolid = (type: "pyramid" | "cylinder" | "cone") => {
    const id = nextPrimitiveId(document, type)
    const primitive = type === "pyramid"
      ? { id, type, baseCenter: { x: -2, y: 0, z: -2 }, baseSize: { x: 4, y: 4 }, height: 4, label: `棱锥 ${id.split("-").at(-1)}` }
      : type === "cylinder"
        ? { id, type, center: { x: 3, y: 0, z: 0 }, radius: 1.5, height: 3, segments: ROUND_SOLID_SEGMENTS, label: `圆柱 ${id.split("-").at(-1)}` }
        : { id, type, center: { x: -3, y: 0, z: 3 }, radius: 1.5, height: 3, segments: ROUND_SOLID_SEGMENTS, label: `圆锥 ${id.split("-").at(-1)}` }
    addSolidTemplate(primitive)
  }
  const addSolidTemplate = (primitive: Extract<PrimitiveSpec, { type: "cube" | "pyramid" | "cylinder" | "cone" }>) => {
    const result = buildSolidTemplate(primitive)
    if (result.diagnostics.length > 0) { setFileError(result.diagnostics.map((diagnostic) => diagnostic.message).join("；")); return }
    apply({ op: "addPrimitives", primitives: [primitive, ...result.primitives] })
    setSelectedIds([primitive.id])
    setGuidance(guidanceFor({ kind: "solid", solid: primitive.type }))
  }
  const solidTypes = ["cube", "pyramid", "cylinder", "cone", "polyhedron3"] as const
  const canCreateSection = selectedPrimitive !== null && solidTypes.includes(selectedPrimitive.type as typeof solidTypes[number])
  /**
   * 点击 3D 预览即创建图元（与平面画布同一套心智：看到什么就创建什么）：
   * - 交面：新建 `intersectionFace`，来源是两个实体 + 这一面的形心 `hint`——**点哪块建哪块**，
   *   重算时按"离 hint 最近的面"继续认领同一面；
   * - 交点：新建 `intersectionPoint3`，来源是两个对象 + 那个拐点的位置 `hint`；
   * - 交线：新建 `intersectionLine`，来源是两个对象，`segments` 由内核在同一事务里重算；
   * - 截面：单个实体的默认剖切平面，走既有 `addSection`。
   * 创建后把选择切到新图元，与"保存交点"的心智模型一致。
   */
  const createFromPreview = (preview: ThreeScenePreview) => {
    if (preview.kind === "section") {
      addSection()
      return
    }
    const [firstId, secondId] = preview.sourceIds
    if (!firstId || !secondId) return
    if (preview.kind === "face") {
      const id = nextPrimitiveId(document, "intersectionFace")
      apply({
        op: "addPrimitive",
        primitive: {
          id,
          type: "intersectionFace",
          sourceIds: [firstId, secondId],
          // 几何留空：`addPrimitive` 会在同一事务里按来源重算，界面上看不到"先空后有"的一帧。
          points: [],
          normal: { x: 0, y: 0, z: 0 },
          area: 0,
          hint: preview.hint ?? { x: 0, y: 0, z: 0 },
          status: "none",
          label: `交面 ${id.split("-").at(-1)}`
        }
      })
      setSelectedIds([id])
      setLayerNotice("已创建交面图元")
      return
    }
    if (preview.kind === "point") {
      const id = nextPrimitiveId(document, "intersectionPoint3")
      const hint = preview.position ?? preview.hint ?? { x: 0, y: 0, z: 0 }
      apply({
        op: "addPrimitive",
        primitive: {
          id,
          type: "intersectionPoint3",
          sourceIds: [firstId, secondId],
          position: { ...hint },
          hint: { ...hint },
          status: "none",
          label: `交点 ${id.split("-").at(-1)}`
        }
      })
      setSelectedIds([id])
      setLayerNotice("已创建交点图元")
      return
    }
    const id = nextPrimitiveId(document, "intersectionLine")
    apply({
      op: "addPrimitive",
      primitive: {
        id,
        type: "intersectionLine",
        sourceIds: [firstId, secondId],
        segments: preview.segments,
        classification: preview.segments.length > 1 ? "polyline" : "segment",
        status: "valid",
        label: `交线 ${id.split("-").at(-1)}`
      }
    })
    setSelectedIds([id])
    setLayerNotice("已创建交线图元")
  }
  const addSection = () => {
    if (!selectedPrimitive || !solidTypes.includes(selectedPrimitive.type as typeof solidTypes[number])) return
    const plane = sectionPlaneThroughSource(document, selectedPrimitive.id)
    if (!plane) {
      setFileError("无法解析该实体的顶点，暂时不能创建截面。")
      return
    }
    const id = nextPrimitiveId(document, "section")
    apply({ op: "addPrimitive", primitive: { id, type: "section", sourceId: selectedPrimitive.id, plane, points: [], classification: "none", status: "undefined", label: `截面 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "section" }))
  }
  /**
   * 剖切面绕**实体中心**旋转：绕平面自身垂足转会把刀口推出实体（实测平面到原点距离从 1.5 掉到 0.15），
   * 而学生想要的"把刀口摆斜"是绕着图形转，倾斜后截面还要看得见。
   */
  const sectionPivotFor = (section: Extract<PrimitiveSpec, { type: "section" }>) => {
    const source = document.primitives.find((primitive) => primitive.id === section.sourceId)
    const vertices = sectionSourceVertices(document, section.sourceId)
    return source && vertices.length > 0 ? sectionPivot(vertices) : null
  }
  const rotateSelectedSection = (axis: "x" | "y" | "z", degrees: number) => {
    const section = document.workspace === "geometry3d" && selectedPrimitive?.type === "section" ? selectedPrimitive : null
    if (!section) return
    const pivot = sectionPivotFor(section)
    apply({ op: "rotateSectionPlane", id: section.id, axis, degrees, ...(pivot ? { pivot } : {}) })
  }
  /** 「以面为剖切面」由 3D 场景在拾取到面后回调，这里只负责把平面落到选中的截面上。 */
  const applySectionFace = (id: string, plane: { normal: Vector3; constant: number }) => {
    apply({ op: "setSectionPlane", id, normal: plane.normal, constant: plane.constant })
    setGuidance("已用该面作为剖切面：拖动截面或按方向键仍可沿新法向平移。")
  }
  /**
   * 把空间点物化/解绑到宿主：绑定参数取**点当前坐标在宿主上的最近点**（内核的 closestParameter），
   * 所以"绑上去"这一步点不会跳，之后的移动完全由参数决定（参数是唯一真值）。
   */
  /**
   * 把选中的空间点绑到宿主上。下拉的值是 `<模式>:<图元 id>`（见 `pointHostOptions`）：
   * - `host` 一维宿主（直线 / 线段 / 射线 / 棱）：存参数 `u`；
   * - `face` / `surface` 二维宿主（面 / 圆柱与圆锥侧面）：存 `uv`；
   * - `solid` **实体内**：存包围盒内的三个比例 `uvw`，越界会被夹回实体表面。
   *
   * 绑定的一刻先做一次反投影，所以"绑上去"这一步点不会跳，之后的移动完全由参数决定（参数是唯一真值）。
   */
  const bindPointToHost = (value: string | null) => {
    if (selectedPrimitive?.type !== "point3") return
    const target = value ? parsePointHostValue(value) : null
    if (!target) {
      apply({ op: "updatePrimitive", id: selectedPrimitive.id, patch: { binding3: { kind: "free" } } })
      setGuidance("已解绑为自由点：坐标仍由你直接编辑。")
      return
    }
    const host = document.primitives.find((primitive) => primitive.id === target.primitiveId)
    const constraint = host
      ? host3FromPrimitive(host, document.primitives) ?? (target.mode === "solid" ? solidVolumeHostFor(new Map(document.primitives.map((primitive) => [primitive.id, primitive])), host.id) : null)
      : null
    if (!host || !constraint) {
      setFileError("这个图元不能作为宿主动点：只有空间直线 / 线段 / 射线 / 棱 / 面 / 圆柱与圆锥侧面，以及实体的内部可以。")
      return
    }
    const projected = constraint.closestParameter(selectedPrimitive.position)
    const binding3 = target.mode === "face"
      ? { kind: "onFace" as const, faceId: host.id, uv: [projected.u, projected.v ?? 0] as [number, number] }
      : target.mode === "surface"
        ? { kind: "onSurface" as const, solidId: host.id, uv: [projected.u, projected.v ?? 0] as [number, number] }
        : target.mode === "solid"
          ? { kind: "inSolid" as const, solidId: host.id, uvw: [projected.u, projected.v ?? 0, projected.w ?? 0] as [number, number, number] }
          : { kind: "onHost" as const, hostId: host.id, parameter: projected.u }
    apply({ op: "updatePrimitive", id: selectedPrimitive.id, patch: { binding3 } })
    setGuidance(target.mode === "solid"
      ? `已绑定到「${host.label ?? host.id}」的**内部**：点可以在实体内自由移动，但出不去——拖到外面会被夹回表面，实体移动时它跟着走。`
      : `已绑定到「${host.label ?? host.id}」：点由宿主参数算出坐标，之后拖动或改参数都沿宿主滑动。`)
  }
  /** 改宿主参数：一维宿主只用 u；面与曲面用 (u, v)；实体内用 (u, v, w)，只改给出的维度。 */
  const setPointHostParameter = (u: number, v?: number, w?: number) => {
    if (selectedPrimitive?.type !== "point3") return
    const binding = selectedPrimitive.binding
    if (!binding) return
    if (binding.kind === "onHost") {
      if (!Number.isFinite(u)) return
      apply({ op: "updatePrimitive", id: selectedPrimitive.id, patch: { binding3: { ...binding, parameter: u } } })
      return
    }
    if (binding.kind === "inSolid") {
      if (!Number.isFinite(u)) return
      apply({ op: "updatePrimitive", id: selectedPrimitive.id, patch: { binding3: { ...binding, uvw: [u, v ?? binding.uvw[1], w ?? binding.uvw[2]] } } })
      return
    }
    if (binding.kind !== "onFace" && binding.kind !== "onSurface") return
    if (!Number.isFinite(u) || !Number.isFinite(v ?? binding.uv[1])) return
    apply({ op: "updatePrimitive", id: selectedPrimitive.id, patch: { binding3: { ...binding, uv: [u, v ?? binding.uv[1]] } } })
  }

  /** 把截面物化成独立图元：每一环 → 点 / 棱 / 面，且**不写来源引用**，
   * 所以物化之后删掉宿主实体也不影响它们（这就是"可以获取截面图元"）。
   */
  const materializeSelectedSection = () => {
    if (selectedPrimitive?.type !== "section") return
    const primitives = sectionMaterialization(document, selectedPrimitive.id)
    if (!primitives || primitives.length === 0) {
      setGuidance("这个截面没有可物化的闭合边界：它只是相切的一点或一段。")
      return
    }
    apply({ op: "addPrimitives", primitives })
    setSelectedIds(primitives.filter((primitive) => primitive.type === "face3").map((primitive) => primitive.id))
    setGuidance(`已把截面物化为 ${primitives.length} 个独立图元（点 / 棱 / 面），它们不再随来源变化。`)
  }
  const createIntersectionFromPreview = (preview: IntersectionPreview) => {
    const first = document.primitives.find((primitive) => primitive.id === preview.objectA)
    const second = document.primitives.find((primitive) => primitive.id === preview.objectB)
    if (!first || !second) return
    const id = nextPrimitiveId(document, "intersection")
    const solutionIndex = Math.max(0, Math.floor(preview.solutionIndex))
    // hint = 用户点的那个解：重算按"离它最近的解"匹配，解的数量或顺序变化时不会串位。
    const hint = { x: preview.point.x, y: preview.point.y }
    const label = `交点 ${id.split("-").at(-1)}`
    let primitive: PrimitiveSpec
    if (first.type === "line" && second.type === "line") {
      primitive = { id, type: "intersection", lineA: first.id, lineB: second.id, x: preview.point.x, y: preview.point.y, label }
    } else if (first.type === "line" && second.type === "circle") {
      primitive = { id, type: "lineCircleIntersection", lineId: first.id, circleId: second.id, solutionIndex, hint, x: preview.point.x, y: preview.point.y, label }
    } else if (first.type === "circle" && second.type === "line") {
      primitive = { id, type: "lineCircleIntersection", lineId: second.id, circleId: first.id, solutionIndex, hint, x: preview.point.x, y: preview.point.y, label }
    } else if (first.type === "circle" && second.type === "circle") {
      primitive = { id, type: "circleIntersection", circleA: first.id, circleB: second.id, solutionIndex, hint, x: preview.point.x, y: preview.point.y, label }
    } else {
      primitive = { id, type: "curveIntersection", objectA: first.id, objectB: second.id, solutionIndex, hint, x: preview.point.x, y: preview.point.y, label }
    }
    apply({ op: "addPrimitive", primitive })
    setSelectedIds([id])
  }
  const addPoint = () => {
    if (document.workspace === "geometry3d") {
      addPoint3()
      return
    }
    const id = nextPrimitiveId(document, "point")
    apply({ op: "addPrimitive", primitive: { id, type: "point", x: 2, y: 1, ...cadLayerFields(), label: nextPointLabel(document) } })
    setGuidance(guidanceFor({ kind: "point", workspace: document.workspace }))
  }
  function addPoint3() {
    const pointCount = document.primitives.filter((primitive) => primitive.type === "point3").length
    const id = nextPrimitiveId(document, "point3")
    // Walk a 2x2xk lattice: the first three points must never be collinear (a plane needs three non-collinear
    // points) and no two points may land on top of each other. The old row-major layout put A, B and C on one
    // line, so "add three points, build a plane" always failed.
    const position = { x: (pointCount % 2) * 3, y: (Math.floor(pointCount / 2) % 2) * 3, z: Math.floor(pointCount / 4) * 3 }
    apply({ op: "addPrimitive", primitive: { id, type: "point3", position, binding: { kind: "free" }, label: nextPoint3Label(document) } })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "point", workspace: "geometry3d" }))
  }
  function addLine3() {
    if (!canCreateLine3) return
    const id = nextPrimitiveId(document, "line3")
    apply({ op: "addPrimitive", primitive: { id, type: "line3", definition: { kind: "throughPoints", pointIds: selectedPoint3Ids as [string, string] }, label: `空间直线 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "point3Tool", tool: "line", outcome: "created" }))
  }
  function addPlane3() {
    if (!canCreatePlane3) return
    const id = nextPrimitiveId(document, "plane3")
    apply({ op: "addPrimitive", primitive: { id, type: "plane3", definition: { kind: "throughPoints", pointIds: selectedPoint3Ids as [string, string, string] }, label: `空间平面 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "point3Tool", tool: "plane", outcome: "created" }))
  }
  function addFace3() {
    if (!canCreateFace3) return
    const id = nextPrimitiveId(document, "face3")
    apply({ op: "addPrimitive", primitive: { id, type: "face3", pointIds: [...selectedPoint3Ids], label: `空间面 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "point3Tool", tool: "face", outcome: "created" }))
  }
  const addAnnotation = (feature: AnnotationFeature, index?: number, text?: string) => {
    if (!selectedPrimitive) return
    const id = nextAnnotationId(document)
    const annotationText = text?.trim() || `${selectedPrimitive.label ?? selectedPrimitive.id} · ${feature}${index !== undefined ? ` ${index + 1}` : ""}`
    apply({ op: "addAnnotation", annotation: { id, text: annotationText, anchor: { kind: "primitive", primitiveId: selectedPrimitive.id, feature, ...(index === undefined ? {} : { index }) }, offset: { x: 0.25, y: 0.25 }, visible: true } })
  }
  const addEngineeringAnnotation = (kind: EngineeringAnnotationKind) => {
    if (document.workspace !== "cad") return
    const sourceIds = selectedIds.filter((id) => {
      const primitive = document.primitives.find((candidate) => candidate.id === id)
      return primitive?.type === "point3" || primitive?.type === "edge3"
    })
    const pointCount = sourceIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point3").length
    const edgeCount = sourceIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "edge3").length
    const validSources = kind === "angular"
      ? pointCount === 3 || edgeCount === 2
      : pointCount === 2 || edgeCount === 1
    if (!validSources) {
      setFileError(kind === "angular" ? "选择三个空间点或两条空间棱后再创建角度标注" : "选择两个空间点或一条空间棱后再创建尺寸标注")
      return
    }
    apply({ op: "addEngineeringAnnotation", annotation: { id: nextEngineeringAnnotationId(document), kind, sourceIds, view: "front", unit: kind === "angular" ? "deg" : "mm", ...(kind === "tolerance" ? { tolerance: { upper: 0.1, lower: 0.1 } } : {}), status: "valid", explanation: "" } })
    setFileError(null)
  }
  /**
   * 手工新建一个参数。它不带 `ownerId`（不是某个对象生成的），所以删除对象时不会被回收。
   * 值/上下界/步长一次给全，否则滑块会没有可用的范围。
   */
  const addParameter = () => {
    let index = 1
    while (document.parameters[`p${index}`]) index += 1
    apply({ op: "setParameter", id: `p${index}`, value: 0.5, min: 0, max: 1, step: 0.01, label: `参数 ${index}` })
  }
  const addMeasurement = (metric: Measurement3Metric, dihedralKind?: "interior" | "exterior") => {
    const id = nextMeasurementId(document)
    /**
     * 平面测量与空间测量共用 `Measurement3` 容器，但求值走内核的平面求值器
     * （见 scene-graph 的 `calculatePlanarMeasurement`）。这里先算一次只为拒绝无意义的来源，
     * 与空间分支"来源不够就提示要选什么"的行为保持一致。
     */
    if (document.workspace !== "geometry3d") {
      const positions = new Map(document.primitives.filter((primitive) => primitive.type === "point").map((point) => [point.id, { x: point.x, y: point.y }]))
      const reading = evaluatePlanarMeasurement({
        id,
        metric: metric as PlanarMetric,
        sourceIds: selectedIds,
        angleKind: dihedralKind === "exterior" ? "exterior" : "interior"
      }, (sourceId) => positions.get(sourceId) ?? null)
      if (reading.status === "insufficient-data" || reading.status === "degenerate") {
        setGuidance(guidanceFor({ kind: "measurement", metric, outcome: "blocked" }))
        return
      }
      apply({ op: "addMeasurement", measurement: {
        id,
        kind: "measurement3",
        sourceIds: [...selectedIds],
        metric,
        ...(dihedralKind ? { dihedralKind } : {}),
        precision: "numeric-approximation",
        status: reading.status,
        explanation: reading.explanation
      } })
      setGuidance(guidanceFor({ kind: "measurement", metric, outcome: "created", ...(dihedralKind ? { dihedralKind } : {}) }))
      setFileError(null)
      return
    }
    const measurement = createMeasurement3(id, metric, selectedIds, document.primitives, dihedralKind)
    if (measurement.status === "insufficient-data" || measurement.status === "degenerate") {
      // 来源不够时给出「要选什么」，比抛一条测量说明更能让人继续操作。
      setGuidance(guidanceFor({ kind: "measurement", metric, outcome: "blocked" }))
      return
    }
    apply({ op: "addMeasurement", measurement })
    setGuidance(guidanceFor({ kind: "measurement", metric, outcome: "created", ...(dihedralKind ? { dihedralKind } : {}) }))
    setFileError(null)
  }
  const deleteMeasurement = (id: string) => {
    const validation = validatePatch(document, { op: "deleteMeasurement", id })
    if (!validation.valid) {
      setFileError(validation.errors.join(", "))
      return
    }
    apply({ op: "deleteMeasurement", id })
    setFileError(null)
  }
  /**
   * 拖动之后的提交。两件事：
   *
   * 1. 照旧把这次拖动写进文档（平移或补丁）。
   * 2. **拖动的是某个曲线的定点时，把那条曲线整体搬同样的位移**。
   *    定点是点图元引用，只让点动、基准中心不动的话，下一趟重算会拿"新定点 + 旧基准"重新解一次，
   *    曲线形状就变了 —— 实测：圆被拖成一个不再过定点的圆（定点落进圆内部，距离只剩半径的 0.47 倍）。
   *    整体平移才符合"定点是曲线自己的属性"：曲线跟着定点走，转了多少度、半径多大都不变。
   */
  const handleDragEnd = (id: string, action: import("./interaction").DragAction) => {
    if (action.kind === "translate") apply({ op: "translatePrimitive", id, delta: action.delta })
    else apply({ op: "updatePrimitive", id, patch: action.patch })
    // 位移取自"这次拖动之后"的文档：点已经被搬过去了，差值就是它实际走的位移。
    const after = useSceneStore.getState().document
    const moved = after.primitives.find((primitive) => primitive.id === id)
    if (moved?.type !== "point" || (action.kind === "translate" && action.delta.x === 0 && action.delta.y === 0)) return
    const before = document.primitives.find((primitive) => primitive.id === id)
    if (before?.type !== "point") return
    const delta = { x: moved.x - before.x, y: moved.y - before.y }
    if (delta.x === 0 && delta.y === 0) return
    const affected = after.primitives.flatMap((primitive) => {
      if (primitive.type !== "circle" && primitive.type !== "ellipse") return []
      const placement = primitive.rotationAbout
      return placement?.pivot.kind === "primitive" && placement.pivot.primitiveId === id ? [{ curve: primitive, placement }] : []
    })
    for (const { curve, placement } of affected) {
      apply({
        op: "updatePrimitive",
        id: curve.id,
        patch: {
          center: { x: curve.center.x + delta.x, y: curve.center.y + delta.y },
          rotationAbout: {
            ...placement,
            baseCenter: { x: placement.baseCenter.x + delta.x, y: placement.baseCenter.y + delta.y }
          }
        }
      })
    }
  }
  /**
   * 以选中的点为**定点**创建一条"动圆"（用户口径）。
   *
   * 和"选中点 + Shift 选曲线 → 绕定点旋转"是同一个几何（曲线始终过这个定点），
   * 区别在入口与默认值：这里是一条新曲线，定点是它的基准，圆心不画、半径可改。
   * 圆心摆成"离定点恰好一个默认半径"，于是曲线一开始就过定点。
   */
  const createMovingCircle = () => {
    const point = rotationAnchor?.point ?? (selectedPrimitive?.type === "point" ? selectedPrimitive : null)
    if (!point || point.type !== "point") return
    const radius = DEFAULT_MOVING_CIRCLE_RADIUS
    const id = nextPrimitiveId(document, "circle")
    // 基准圆心放在定点的正右方一个半径处：参数 0 落在定点上，于是"过定点"从第一帧就成立。
    const baseCenter = { x: point.x + radius, y: point.y }
    apply({
      op: "addPrimitive",
      primitive: {
        id,
        type: "circle",
        center: baseCenter,
        radius,
        rotation: 0,
        label: `动圆 ${id.split("-").at(-1)}`,
        rotationAbout: { pivot: { kind: "primitive", primitiveId: point.id }, angle: 0, baseCenter }
      }
    })
    // 新曲线自动选中：用户马上就能在检查器里改半径。
    pendingSelectionRef.current = id
  }
  /**
   * 把选中的点定为选中曲线上那个**定点**：曲线从此绕它旋转，转过任意角度都仍然过它。
   *
   * 两件事都要做，少一件这条性质就不成立：
   * 1. **点本身要挪到曲线上**（`anchored.pivot`）。定点是点图元引用，曲线只保证过"那个坐标"；
   *    点若留在原地（实测：点在 (5,0)、曲线被摆到过 (3,0)），用户看到的仍然不是"过这个定点"。
   * 2. 曲线的基准中心摆到"离定点恰好一个半轴"处，于是放置出来的曲线确实经过它。
   *
   * 用点图元引用而不是把坐标拷下来：这样定点还是一个活的点（可以继续拖动、可以约束），
   * "在曲线上取一个动点再让它当旋转中心"那类做法才成立。
   */
  const anchorRotation = () => {
    if (!rotationAnchor) return
    const { point, curve } = rotationAnchor
    // 定点必须落在曲线上：点不在曲线上时先投影上去，而不是拒绝用户。
    const anchored = anchoredCurve(curve, { x: point.x, y: point.y })
    if (!anchored) {
      setFileError("这个点无法作为旋转中心：它落在曲线中心，没有确定的方向。")
      return
    }
    // 两次补丁：定点先落到位，曲线再摆到"过它"的位置。分开写是因为每一步都要过校验，而
    // `addPrimitives` 这类"新增"操作对已存在的 id 会被拒绝；两次更新各自重算，结果一致。
    apply({ op: "updatePrimitive", id: point.id, patch: { x: anchored.pivot.x, y: anchored.pivot.y } })
    apply({
      op: "updatePrimitive",
      id: curve.id,
      patch: {
        center: anchored.curve.center,
        rotation: anchored.curve.rotation,
        rotationAbout: {
          pivot: { kind: "primitive", primitiveId: point.id },
          angle: 0,
          baseCenter: anchored.rotationAbout.baseCenter
        }
      }
    })
  }
  const deleteSelected = () => {
    if (!selectedIds.length) return
    /**
     * **并集校验**：一次选中要删的全部 id 一起算作"自己人"。
     * 逐个 id 校验会让"点 + 依赖它的线"互相挡——实测两个都删不掉。
     */
    const validation = validateDeletion(document, selectedIds)
    if (!validation.valid) {
      setFileError(validation.errors.join(", "))
      return
    }
    // A solid and its generated topology are one object, so a selection covering both must delete it once.
    const removed = new Set<string>()
    for (const id of [...selectedIds].reverse()) {
      if (removed.has(id)) continue
      for (const target of deletionTargets(document, id)) removed.add(target)
      apply({ op: "deleteObject", id })
    }
    // 中间失败不再被静默吞掉：一次删除里的最后一次错误由 `operationError` 渲染出来。
    setSelectedIds([])
    setFileError(null)
  }

  const nextLayerId = (): string => {
    let index = 1
    while (document.layers?.some((layer) => layer.id === `layer-${index}`)) index += 1
    return `layer-${index}`
  }
  const addLayer = (parentId?: string) => {
    const id = nextLayerId()
    const kind = document.layers?.find((layer) => layer.id === parentId)?.kind ?? "geometry"
    apply({ op: "addLayer", layer: { id, name: `图层 ${id.split("-").at(-1)}`, ...(parentId ? { parentId } : {}), kind, visible: true, locked: false, printable: true } })
    if (parentId && !expandedIds.includes(parentId)) setExpandedIds([...expandedIds, parentId])
  }
  const deleteLayer = (id: string) => {
    const fallback = document.layers?.find((layer) => layer.kind === "geometry" && layer.id !== id)?.id
    apply({ op: "deleteLayer", id, ...(fallback ? { reassignTo: fallback } : {}) })
  }

  /** The active layer must be visible and unlocked before a drafting command may commit new geometry. */
  const cadActiveLayer = (document.layers ?? []).find((layer) => layer.id === document.activeLayerId) ?? null
  const cadActiveLayerBlockedReason = cadActiveLayer?.visible === false
    ? `图层「${cadActiveLayer.name}」已隐藏，无法创建对象`
    : cadActiveLayer?.locked ? `图层「${cadActiveLayer.name}」已锁定，无法创建对象` : null

  const cadAnnotationSources = selectedIds.filter((id) => {    const primitive = document.primitives.find((candidate) => candidate.id === id)
    return primitive?.type === "point3" || primitive?.type === "edge3"
  })
  const cadPoint3SourceCount = cadAnnotationSources.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point3").length
  const cadEdge3SourceCount = cadAnnotationSources.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "edge3").length
  const canCreateLinearAnnotation = cadPoint3SourceCount === 2 || cadEdge3SourceCount === 1
  const canCreateAngularAnnotation = cadPoint3SourceCount === 3 || cadEdge3SourceCount === 2
  /**
   * "绕定点旋转"要先有一个点、再有一条封闭曲线（圆 / 椭圆）。
   * 顺序无所谓：命令自己会把点投影到曲线上，所以用户点一个近处的点也能用。
   */
  const rotationAnchor = (() => {
    const selected = selectedIds.map((id) => document.primitives.find((primitive) => primitive.id === id)).filter((primitive): primitive is PrimitiveSpec => Boolean(primitive))
    const point = selected.find((primitive) => primitive.type === "point")
    const curve = selected.find((primitive) => primitive.type === "circle" || primitive.type === "ellipse")
    return point?.type === "point" && curve && (curve.type === "circle" || curve.type === "ellipse") ? { point, curve } : null
  })()
  const canAnchorRotation = rotationAnchor !== null && !rotationAnchor.curve.locked

  const ribbonGroups = createRibbonGroups({
    workspace: document.workspace,
    cadMode,
    selectedCount: selectedIds.length,
    allSelectedLocked,
    canCreateSection,
    canCreateLine3,
    canCreatePlane3,
    canCreateFace3,
    canCreateLinearAnnotation,
    canCreateAngularAnnotation,
    canAnchorRotation,
    diagnosticVisible: showProjectionDiagnostics
  })

  const runCadCommand = (commandId: string) => {
    setActiveCommand(commandId)
    if (cadMode === "draft" && commandId.startsWith("create-") && cadActiveLayerBlockedReason) {
      setLayerNotice(cadActiveLayerBlockedReason)
      return
    }
    setLayerNotice(null)
    switch (commandId) {
      case "select-tool": setCreationStep(null); break
      case "select-all": setSelectedIds(document.primitives.map((primitive) => primitive.id)); break
      case "select-clear": setSelectedIds([]); break
      case "create-point3": addPoint3(); break
      case "create-line3": addLine3(); break
      case "create-plane3": addPlane3(); break
      case "create-face3": addFace3(); break
      case "create-point": addPoint(); break
      case "create-line": startCreation("line"); break
      case "create-segment": startCreation("segment"); break
      case "create-ray": startCreation("ray"); break
      case "create-polyline": startCreation("polyline"); break
      case "create-circle": startCreation("circle"); break
      case "create-arc": startCreation("arc"); break
      case "modify-delete": deleteSelected(); break
      case "modify-lock": toggleLock(); break
      case "modify-hide": apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: false }); break
      case "modify-show": apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: true }); break
      case "modify-group": createGroup(); break
      case "annotate-linear": addEngineeringAnnotation("linear"); break
      case "annotate-angular": addEngineeringAnnotation("angular"); break
      case "annotate-tolerance": addEngineeringAnnotation("tolerance"); break
      case "inspect-diagnostics": setShowProjectionDiagnostics((visible) => !visible); break
      case "inspect-sources": {
        const sourceIds = new Set<string>()
        for (const drawing of engineeringDrawings) for (const primitive of drawing.primitives) sourceIds.add(primitive.sourceId)
        setSelectedIds([...sourceIds])
        break
      }
      case "export-svg": void exportSvgFile("svg"); break
      case "export-dxf": void exportSvgFile("dxf"); break
      case "export-pdf": void exportSvgFile("pdf"); break
      case "export-csv": exportCsvFile(); break
      case "export-mgeo": save(); break
      default: break
    }
  }
  const runRibbonCommand = (commandId: string) => {
    setActiveCommand(commandId)
    if (document.workspace === "cad") {
      runCadCommand(commandId)
      return
    }
    switch (commandId) {
      case "select-tool": setCreationStep(null); break
      case "create-point3": addPoint3(); break
      case "create-line3": addLine3(); break
      case "create-plane3": addPlane3(); break
      case "create-face3": addFace3(); break
      case "create-point": addPoint(); break
      case "create-line": startCreation("line"); break
      case "create-segment": startCreation("segment"); break
      case "create-ray": startCreation("ray"); break
      case "create-polyline": startCreation("polyline"); break
      case "create-circle": startCreation("circle"); break
      case "create-arc": startCreation("arc"); break
      case "create-parabola": addDefaultPrimitive("parabola"); break
      case "create-ellipse": addDefaultPrimitive("ellipse"); break
      case "create-hyperbola": addDefaultPrimitive("hyperbola"); break
      case "create-function": addDefaultPrimitive("function"); break
      case "create-cube": addDefaultCube(); break
      case "create-pyramid": addDefaultSolid("pyramid"); break
      case "create-cylinder": addDefaultSolid("cylinder"); break
      case "create-cone": addDefaultSolid("cone"); break
      case "create-section": addSection(); break
      case "modify-delete": deleteSelected(); break
      case "modify-lock": toggleLock(); break
      case "modify-anchor-rotation": anchorRotation(); break
      case "modify-hide": apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: false }); break
      case "modify-show": apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: true }); break
      case "modify-group": createGroup(); break
      case "export-svg": void exportSvgFile(); break
      case "export-csv": exportCsvFile(); break
      case "export-png": exportPngFile(); break
      case "export-mgeo": save(); break
      default: break
    }
  }
  const handleCadModeChange = (mode: CadMode) => {
    setCadMode(mode)
    setCreationStep(null)
    setActiveCommand(null)
    setLayerNotice(null)
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = historyShortcut(event)
      if (shortcut) {
        event.preventDefault()
        if (shortcut === "undo") undo()
        else redo()
        return
      }
      if (event.key === "Escape") {
        // Esc 分级：先取消进行中的创建（含 CAD 命令），再关掉指引，最后才清空选择。
        if (creationStep || activeCommand) { setCreationStep(null); setActiveCommand(null); setGuidance(null); return }
        if (guidance) { setGuidance(null); return }
        if (selectedIds.length > 0) { setSelectedIds([]); return }
        return
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0 && !isTextEditingTarget(event.target)) {
        event.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedIds, document, apply, undo, redo, creationStep, activeCommand, guidance])

  // 优先级：创建步骤 > 3D 显示开关提示（法向量/二面角示例）> 交线预览 > 默认选择提示。
  // 显示开关是用户刚刚按下按钮触发的，必须盖过"选择带来的预览"，否则状态栏会像没反应。
  /**
   * 选中单个平面「点」时的绑定状态：把它交给状态栏，回答"怎么把点固定到曲线上"。
   * 只在平面/立体工作区、且恰好选中一个对象时给——多选时这句话没有意义。
   */
  const promptPoint = document.workspace === "cad" || selectedIds.length !== 1 || selectedPrimitive?.type !== "point" ? null : selectedPrimitive
  const promptPathId = promptPoint?.binding?.kind === "onPath" ? promptPoint.binding.pathId : null
  const promptPointBinding = promptPoint
    ? {
        bound: promptPathId !== null,
        hasPaths: dynamicPointPaths(document.primitives).some((primitive) => primitive.id !== promptPoint.id),
        pathLabel: promptPathId ? document.primitives.find((primitive) => primitive.id === promptPathId)?.label ?? null : null
      }
    : null
  const promptPathSelected = document.workspace !== "cad" && selectedIds.length === 1 && Boolean(selectedPrimitive && isDynamicPointPath(selectedPrimitive))
  /** 选中的是一条"动圆"（以某个点为定点的曲线）：提示它怎么转、半径在哪改。 */
  const promptMovingCircle = document.workspace !== "cad" && selectedIds.length === 1
    && Boolean(selectedPrimitive && (selectedPrimitive.type === "circle" || selectedPrimitive.type === "ellipse") && selectedPrimitive.rotationAbout)
  /**
   * 绕定点旋转的提示：`ready` 是"两样都选中了、命令可用"，`available` 是"文档里两样都有、只是还没选中组合"。
   * 没有这条提示，用户不会知道这个能力存在（与路径绑定当初的缺口同一个问题）。
   */
  const promptRotationAnchor = document.workspace === "cad" ? null : {
    ready: canAnchorRotation,
    available: document.primitives.some((primitive) => primitive.type === "point")
      && document.primitives.some((primitive) => primitive.type === "circle" || primitive.type === "ellipse")
  }
  const basePrompt = resolveStatusPrompt({ mode: creationMode, selectedCount: selectedIds.length, selectedLabel: selectedPrimitive?.label ?? selectedPrimitive?.id ?? null, hasCenter: Boolean(creationStep?.center), hasStart: Boolean(creationStep?.start), pointCount: creationStep?.points?.length ?? 0, sceneControl, pointBinding: promptPointBinding, pathSelected: promptPathSelected, rotationAnchor: promptRotationAnchor, movingCircleSelected: promptMovingCircle })
  const previewPrompt = document.workspace === "geometry3d" && !sceneControl && previewStatus && previewStatus.kind !== "none"
    ? resolveIntersectionPreviewPrompt(previewStatus, hoveredPreview !== null)
    : null
  /**
   * 没有悬停也没有选择时，仍要把"画布上这些虚线 / 面片是什么、能点什么"说清楚——
   * 用户反馈过"画布上有东西却完全没有任何提示"。
   */
  const previewInventoryPrompt = document.workspace === "geometry3d" && !sceneControl && !previewPrompt
    ? resolvePreviewInventoryPrompt({
        lines: scenePreviews.filter((item) => item.kind === "intersection").length,
        points: scenePreviews.filter((item) => item.kind === "point").length,
        faces: scenePreviews.filter((item) => item.kind === "face").length,
        truncated: previewSweep?.truncatedPairs ?? 0,
        dropped: previewSweep?.droppedPairs ?? 0
      })
    : null
  const statusPrompt = previewPrompt ?? previewInventoryPrompt ?? basePrompt

  const activeCommandPrompt = ribbonGroups
    .flatMap((group) => group.commands)
    .find((command) => command.id === activeCommand)?.prompt ?? null
  const cadStatusPrompt = creationMode
    ? statusPrompt
    : activeCommandPrompt ?? (cadMode === "draft"
      ? "2D 绘图：在视口中创建对象，新对象写入当前图层。"
      : "工程制图根据当前文档的 3D 点、棱和面显示四个视图。")

  const algebraPanel = <AlgebraView id="algebra-dock" className={`panel${mobileDock === "objects" ? " is-mobile-open" : ""}`} primitives={document.primitives} measurements={document.measurements} parameters={document.parameters} workspace={document.workspace} selectedIds={selectedIds} filter={filterQuery} onSelect={updateSelection} onToggle={(id, visible) => apply({ op: "toggleVisibility", id, visible })} onSetParameter={(id, patch) => {
    // 一次提交值 + 元数据。未给出的字段沿用现值（清空输入框暂时等于不改，见文档的已知限制）。
    const current = document.parameters[id]
    if (!current) return
    apply({ op: "setParameter", id, value: patch.value ?? current.value, min: patch.min ?? current.min, max: patch.max ?? current.max, step: patch.step ?? current.step, label: patch.label ?? current.label, ownerId: current.ownerId })
  }} onDeleteParameter={(id) => apply({ op: "deleteParameter", id })} onAddParameter={addParameter} />

  /**
   * 空白画布上"快速开始"那一行按钮。
   *
   * 与功能区按钮走**同一条路**（`runRibbonCommand`）：从画布上点一下与从功能区点一下永远不会变成两套行为。
   * 用户的反馈是"很多功能藏得很深"，而空白画布是唯一一个用户一定看到的地方。
   * 按钮文案与功能区**不同名**（见 `GraphicsView` 里的说明），避免屏幕上出现两个同名按钮。
   */
  const runQuickStart = (action: "point" | "circle" | "line" | "function") => {
    if (action === "point") runRibbonCommand("create-point")
    else if (action === "circle") runRibbonCommand("create-circle")
    else if (action === "line") runRibbonCommand("create-line")
    else runRibbonCommand("create-function")
  }

  const planarCanvas = <GraphicsView document={document} selectedIds={selectedIds} creationMode={creationMode} onSelect={updateSelection} onBoxSelect={selectBox} onCanvasClick={handleCanvasCreationClick} onCanvasDoubleClick={handleCanvasDoubleClick} onDragEnd={handleDragEnd} onCreateIntersection={createIntersectionFromPreview} onPointerCoordinate={setPointerCoordinate} onQuickStart={runQuickStart} />

  /**
   * 可作宿主的图元：空间直线 / 线段 / 射线 / 棱 / 面 / 圆柱与圆锥侧面，以及**实体的内部**
   *（用户要求："动点的约束应该可以在立方体内"）。列什么与取值编码见 `pointHostOptions`。
   */
  const pointHostCandidates = useMemo(
    () => pointHostOptions(document.primitives).map((option) => ({ id: option.value, label: option.label })),
    [document.primitives]
  )

  const propertiesBarProps: PropertiesBarProps = { selectedPrimitive, selectedIds, selectedCount: selectedIds.length, selectedGroupId: selectedGroup?.id ?? null, allSelectedVisible, canCreateIntersection, onCreateGroup: createGroup, onDeleteGroup: deleteGroup, onCreateIntersection: createIntersection, onAlign: alignSelection, onToggleSelectedVisibility: () => selectedId && apply({ op: "toggleVisibility", id: selectedId, visible: selectedPrimitive?.visible === false }), onToggleSelectedLock: () => selectedId && apply({ op: "toggleLock", id: selectedId, locked: !selectedPrimitive?.locked }), onDeleteSelected: deleteSelected, onToggleBatchVisibility: () => apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: !allSelectedVisible }), onUpdatePrimitive: (patch) => selectedId && apply({ op: "updatePrimitive", id: selectedId, patch }), onRotateSection: rotateSelectedSection, onMaterializeSection: materializeSelectedSection, pointHostCandidates, onBindPointHost: bindPointToHost, onChangeHostParameter: setPointHostParameter, onAddAnnotation: addAnnotation, onAddEngineeringAnnotation: addEngineeringAnnotation, onCreateMeasurement: addMeasurement, onDeleteMeasurement: deleteMeasurement, onCreateMovingCircle: createMovingCircle, onUpdateSelectionStyle: (style) => apply({ op: "setPrimitivesStyle", ids: selectedIds, style }), onCreateDerivative: (sourceId) => addFunctionAnalysis(sourceId, "derivative"), onCreateTangent: (sourceId) => addFunctionAnalysis(sourceId, "tangent"), onCreateIntegral: (sourceId) => addFunctionAnalysis(sourceId, "integral"), value: slope?.value ?? 0.5, min: slope?.min ?? 0.15, max: slope?.max ?? 0.85, step: slope?.step ?? 0.05, onChange: (value) => apply({ op: "setParameter", id: "slope", value }) }

  const propertiesPanel = <PropertiesBar {...propertiesBarProps} />

  const inspectorPanel = <aside id="properties-dock" className={`panel right${mobileDock === "properties" ? " is-mobile-open" : ""}`} data-mobile-dock="properties">{propertiesPanel}</aside>


  const layers = document.layers ?? []
  const drawingViews = document.drawingViews ?? []
  const drawingSheets = document.drawingSheets ?? []
  const currentSheet = drawingSheets.find((sheet) => sheet.id === (activeSheetId ?? document.activeSheetId)) ?? drawingSheets[0] ?? null
  const fallbackSheet: DrawingSheetSpec = { id: "sheet-1", name: "工程图纸", paper: "A4", orientation: "landscape", scale: 1, viewIds: [] }
  const sheetForCanvas = currentSheet ?? fallbackSheet
  const draftViewSpec = defaultDraftView(currentSheet, drawingViews)
  const activeLayerName = cadActiveLayer?.name ?? "几何"
  const activeSheetScale = currentSheet?.scale ?? 1
  const sourceLabels = Object.fromEntries(document.primitives.map((primitive) => [primitive.id, primitive.label ?? primitive.id]))

  // Sources referenced by engineering annotations and drawing views; deleted ones stay visible as diagnostics.
  const cadInspectorSources: InspectorSource[] = useMemo(() => {
    const ids = new Set<string>()
    for (const annotation of document.engineeringAnnotations ?? []) for (const id of annotation.sourceIds) ids.add(id)
    for (const view of document.drawingViews ?? []) for (const id of view.sourceIds ?? []) ids.add(id)
    return [...ids].map((id) => {
      const primitive = document.primitives.find((candidate) => candidate.id === id)
      return { id, label: primitive?.label ?? id, missing: !primitive }
    })
  }, [document])

  const activeViewLabel = activeViewId ? drawingViewLabels[drawingViews.find((view) => view.id === activeViewId)?.kind ?? "front"] : null
  const cadInspector = <EngineeringInspector
    activeTab={inspectorTab}
    onTabChange={setInspectorTab}
    context={{
      sheetName: sheetForCanvas.name,
      viewName: activeViewLabel,
      layerName: activeLayerName,
      layerVisible: cadActiveLayer?.visible !== false,
      layerLocked: Boolean(cadActiveLayer?.locked),
      commandPrompt: cadStatusPrompt,
      unit: "mm",
      selectedLayerName: selectedPrimitive?.layerId ? layers.find((layer) => layer.id === selectedPrimitive.layerId)?.name ?? selectedPrimitive.layerId : null
    }}
    sources={cadInspectorSources}
    properties={propertiesBarProps}
  />

  const documentTreePanel = <DocumentTreePanel
    activeTab={treeTab}
    onTabChange={setTreeTab}
    filter={filterQuery}
    onFilterChange={setFilterQuery}
    model={algebraPanel}
    layers={<LayerTree layers={layers} activeLayerId={document.activeLayerId ?? null} expandedIds={expandedIds} filter={filterQuery} onToggleExpanded={toggleExpanded} onActivate={(id) => apply({ op: "setActiveLayer", id })} onToggleVisibility={(id, visible) => apply({ op: "updateLayer", id, patch: { visible } })} onToggleLocked={(id, locked) => apply({ op: "updateLayer", id, patch: { locked } })} onAdd={addLayer} onDelete={deleteLayer} />}
    drawings={<DrawingTree sheets={drawingSheets} views={drawingViews} activeSheetId={currentSheet?.id ?? null} activeViewId={activeViewId} expandedIds={expandedIds} filter={filterQuery} sourceLabels={sourceLabels} onToggleExpanded={toggleExpanded} onSelectSheet={setActiveSheetId} onSelectView={setActiveViewId} onToggleView={(id, visible) => apply({ op: "updateDrawingView", id, patch: { visible } })} />}
  />

  const handleViewLayoutChange = (viewId: string, patch: DrawingViewPatch) => apply({ op: "updateDrawingView", id: viewId, patch })

  /**
   * 偏移 / 修剪 / 延伸：几何与前置条件都在 `draftEditing` 里判定，这里只负责把结果落成一次文档操作。
   * 失败的说明写进 CAD 状态栏提示（`layerNotice`），成功也给一句确认——和命令栏的反馈通道一致。
   */
  const editSelectedGeometry = (request: GeometryEditRequest) => {
    const selected = selectedIds.map((id) => document.primitives.find((primitive) => primitive.id === id)).filter((primitive): primitive is PrimitiveSpec => Boolean(primitive))
    const outcome = resolveGeometryEdit(selected, request, { nextId: nextPrimitiveId(document, request.kind === "offset" ? selected[0]?.type ?? "primitive" : "primitive") })
    if (!outcome.ok) { setLayerNotice(outcome.error); return }
    if (outcome.kind === "create") {
      apply({ op: "addPrimitive", primitive: outcome.primitive })
      setSelectedIds([outcome.primitive.id])
      setLayerNotice("已偏移出一个新对象")
      return
    }
    apply({ op: "updatePrimitive", id: outcome.id, patch: outcome.patch })
    setLayerNotice(request.kind === "trim" ? "已修剪" : "已延伸到边界")
  }

  const cadCanvas = <>
    {cadMode === "draft"
      ? <DrawingSheetView
        sheet={sheetForCanvas}
        views={[draftViewSpec]}
        document={document}
        selectedIds={selectedIds}
        mode="draft"
        activeViewId={draftViewSpec.id}
        ariaLabel="二维绘图视图"
        creation={creationStep}
        onDragEnd={handleDragEnd}
        onBoxSelect={selectBox}
        onEditSelected={editSelectedGeometry}
        draftControlsSlot={(controls) => <DraftControlsRow controls={controls} />}
        draftControlsHandledExternally
        onSelect={updateSelection}
        onViewSelect={setActiveViewId}
        onViewLayoutChange={handleViewLayoutChange}
        onCreateAt={handleCanvasCreationClick}
      />
      : <EngineeringDrawingView
        document={document}
        selectedIds={selectedIds}
        activeViewId={activeViewId}
        spatialDocument={workspaceDocuments.geometry3d ?? null}
        projectionSource={projectionSource}
        onProjectionSourceChange={setProjectionSource}
        onSelect={updateSelection}
        onViewSelect={setActiveViewId}
        onViewLayoutChange={handleViewLayoutChange}
      />}
    {showProjectionDiagnostics && <details className="engineering-drawing-diagnostics workbench-diagnostics" open><summary>投影诊断 {cadDiagnosticCount} 条</summary>{cadDiagnosticCount > 0 ? <ul>{engineeringDrawings.flatMap((drawing) => drawing.diagnostics).map((diagnostic, index) => <li key={`${index}-${diagnostic}`}>{diagnostic}</li>)}</ul> : <p role="status">当前四个投影视图没有诊断信息。</p>}</details>}
  </>

  const cadWorkbench = <EngineeringWorkbench
    document={document}
    mode={cadMode}
    onModeChange={handleCadModeChange}
    commandBar={null}
    leftDock={documentTreePanel}
    canvas={cadCanvas}
    inspector={cadInspector}
    statusBar={<StatusBar commandPrompt={cadStatusPrompt} activeLayerName={activeLayerName} unit="mm" scale={activeSheetScale} diagnosticCount={cadDiagnosticCount} notice={layerNotice} />}
  />

  return <div className="app-shell">
    {/* 纸纹滤镜的定义。放在 App 里（而不是只放在入口）是因为整个界面的 CSS 都引用 `#paper-grain`，
        任何渲染 App 的地方（含测试与嵌入）都必须有这份定义，否则纹理层会渲染成空白。 */}
    <PaperTexture />
    <AppChrome activeWorkspace={document.workspace} onWorkspaceChange={(workspace: Workspace) => { setSelectedIds([]); setCreationStep(null); setGuidance(workspace === "geometry3d" ? guidanceFor({ kind: "point3Tool", tool: "line", outcome: "blocked", point3Count: 0 }) : null); setMobileDock(null); setActiveCommand(null); switchWorkspace(workspace) }} ribbonGroups={ribbonGroups} activeRibbonTab={activeRibbonTab} ribbonExpanded={ribbonExpanded} ribbonPinned={ribbonPinned} onRibbonTabChange={setActiveRibbonTab} onRibbonCommand={runRibbonCommand} onRibbonExpandedChange={setRibbonExpanded} onRibbonPinnedChange={setRibbonPinned} onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo} onSave={save} onOpen={() => fileInputRef.current?.click()} />
    {document.workspace === "cad" ? cadWorkbench : <div className="workbench">
      <div className="workbench-mobile-controls" role="toolbar" aria-label="画布面板">
        <button type="button" aria-controls="algebra-dock" aria-expanded={mobileDock === "objects"} onClick={() => setMobileDock((current) => current === "objects" ? null : "objects")}>对象列表</button>
        <button type="button" aria-controls="properties-dock" aria-expanded={mobileDock === "properties"} onClick={() => setMobileDock((current) => current === "properties" ? null : "properties")}>属性检查器</button>
      </div>
      {algebraPanel}
      {document.workspace === "geometry3d" ? <ThreeSceneView document={document} selectedIds={selectedIds} onSelect={updateSelection} onStatusPromptChange={setSceneControl} previews={scenePreviews} onPreviewHover={(hovering, preview) => setHoveredPreviewKey(hovering ? preview.key : null)} onPreviewClick={createFromPreview} onDragEnd={(id, delta) => apply({ op: "translatePrimitive3", id, delta })} onMoveSection={(id, distance) => apply({ op: "moveSectionPlane", id, distance })} onHostDragEnd={(id, parameter) => {
        const primitive = document.primitives.find((candidate) => candidate.id === id)
        if (primitive?.type !== "point3" || !primitive.binding) return
        // 只提交参数：坐标由重算从参数算出，所以点永远精确落在宿主上。
        if (primitive.binding.kind === "onHost") apply({ op: "updatePrimitive", id, patch: { binding3: { ...primitive.binding, parameter: parameter.u } } })
        else if (primitive.binding.kind === "onFace" || primitive.binding.kind === "onSurface") apply({ op: "updatePrimitive", id, patch: { binding3: { ...primitive.binding, uv: [parameter.u, parameter.v ?? primitive.binding.uv[1]] } } })
        // 实体内：三个比例都提交（拖动时夹取已经把点限制在体内，提交的参数就是夹取后的位置）。
        else if (primitive.binding.kind === "inSolid") apply({ op: "updatePrimitive", id, patch: { binding3: { ...primitive.binding, uvw: [parameter.u, parameter.v ?? primitive.binding.uvw[1], parameter.w ?? primitive.binding.uvw[2]] } } })
      }} onPickSectionFace={applySectionFace} /> : planarCanvas}
      {inspectorPanel}
      <div className="status-bar" role="status" aria-live="polite" aria-label="操作提示"><span className="status-bar-prompt">{statusPrompt}</span><span className="status-bar-item">{pointerCoordinate ? `坐标 (${pointerCoordinate.x.toFixed(2)}, ${pointerCoordinate.y.toFixed(2)})` : "坐标 —"}</span><span className="status-bar-item">对象 {document.primitives.length}</span><span className="status-bar-item">工作区 {document.workspace}</span></div>
    </div>}
    {(fileError || operationError) && <div role="alert" className="footer-note">{fileError ?? operationError}</div>}
    {document.workspace !== "cad" && guidance && <GuidanceHint text={guidance} onDismiss={() => setGuidance(null)} />}
    <input ref={fileInputRef} hidden aria-label="加载 .mgeo 文件" type="file" accept=".mgeo,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; file.text().then(load).catch(() => setFileError("无法读取 .mgeo 文件")); event.target.value = "" }} />
  </div>
}
