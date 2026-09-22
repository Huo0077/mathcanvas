import { useEffect, useMemo, useRef, useState } from "react"

import { createEmptyDocument, decodeMgeo, encodeMgeo, isSampledPrimitiveType, type AnnotationFeature, type DrawingSheetSpec, type EngineeringAnnotationKind, type Measurement3Metric, type PrimitiveSpec, type Vector3, type Workspace } from "@draw/dsl"
import { buildSolidTemplate, createMeasurement3, entityResolverFor, evaluatePlanarMeasurement, host3FromPrimitive, selectPrimitivesInBox, type BoxSelectionMode, type PlanarMetric } from "@draw/geometry-kernel"
import { compileActions, createIdAllocator, planeThroughPoints, sectionMaterialization, sectionPivot, sectionPlaneThroughSource, sectionSourceVertices, solidVolumeHostFor, validateDeletion, validatePatch } from "@draw/scene-graph"
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
import { ModuleRail } from "./components/ModuleRail"
import { WorkspaceHeader } from "./components/WorkspaceHeader"
import { AgentWorkspace } from "./components/agent/AgentWorkspace"
import { ProviderSettings } from "./components/settings/ProviderSettings"
import { ProjectPackagePanel } from "./components/ProjectPackagePanel"
import { readDesktopRuntime, type DesktopRuntimeInfo } from "./services/desktopRuntime"
import { agentRunner } from "./agent/agentRunner"
import { useAgentStore } from "./agentStore"
import { useAgentDocumentBinding } from "./useAgentDocumentBinding"
import { DEFAULT_APP_MODULE, type AppModuleId } from "./shellModules"
import { resolveIntersectionPreview } from "./intersectionPreview3d"
import { ThreeSceneView } from "./threeScene"
import type { RibbonTabId } from "./uiState"
import type { IntersectionPreview } from "./intersectionPreview"
import { loadActiveWorkspace, loadDraft, saveDraft } from "./persistence/draftStorage"
import { createDocumentRepository } from "./services/documentRepository"
import { createDocumentPersistence, type DocumentPersistence } from "./services/documentPersistence"
import { invokeDesktop } from "./services/desktopRuntime"
import { resolveGeometryEdit, type GeometryEditRequest } from "./draftEditing"
import { exportCsv, exportSvg } from "./persistence/exporters"
import { exportEngineeringDxf, exportEngineeringPdf, exportEngineeringSvg, selectExportableDrawings } from "./persistence/engineeringExporters"
import { defaultDraftView, drawingViewLabels, resolveProjectedDrawing } from "./projectionVisuals"
import { resolveProjectionSource, resolveProjectionSourceEntity } from "./projectionSource"
import { migrateLegacySolids } from "./solidTemplates"
import { pointHostOptions, parsePointHostValue } from "./pointHostOptions"
import { ROUND_SOLID_SEGMENTS } from "./solidDefaults"
import { point3ToolAvailability } from "./spatialTools"
import { resolveStatusPrompt, resolveIntersectionPreviewPrompt, resolvePreviewInventoryPrompt, type SceneControlMode } from "./statusPrompts"
import { computeIntersectionPreviews3d, type IntersectionPreview3dCache } from "./intersectionPreviews3d"
import { toScenePreview, toSectionScenePreview, toSelectionLineScenePreview, type ThreeScenePreview } from "./threeScenePreview"
import { dynamicPointPaths, isDynamicPointPath } from "./dynamicPointPaths"
import { defaultTangentAnchor, isTangentSource } from "./curveTangents"
import { CAPABILITY_REGISTRY_REVISION } from "@draw/agent-core"
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
 * 新建**空间圆轨道**的默认半径（世界单位）。只选了一个点时用它：与默认取景相称，
 * 用户随后可以在属性栏改成想要的圈。
 */
const DEFAULT_CIRCLE3_TRACK_RADIUS = 1.5

/**
 * "以点为圆心作圆"的默认半径。比动圆小一点：它是一个真正的圆（要标圆心），
 * 摆在点的正右侧一个半径处，视觉上不会一出来就压住旁边的图形。
 */
const DEFAULT_CENTERED_CIRCLE_RADIUS = 1.5

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
  /**
   * **会话绑定跟着当前文档走**（对话切片 Fix round 1 / C1；规格 §5.1）。
   *
   * 一个会话绑定一个 project/document/workspace，而这个应用里换工作区就是换文档 ——
   * 少了这一步，所有会话都写在占位绑定上，而在立体几何里确认的事实会被注入平面几何那一轮。
   * 有未结束的一轮时它会**推迟**（Agent 自己切工作区时不能让草稿面板被换走），见那个 hook。
   */
  useAgentDocumentBinding(document)
  const apply = useSceneStore((state) => state.apply)
  // 整批提交（Task 0.4）：批量删除走它，整批只占一步撤销。
  const applyBatch = useSceneStore((state) => state.applyBatch)
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
  /**
   * 启动恢复**是否已经结束**。
   *
   * 自动保存那个 effect 在挂载时就会跑一次，而那时恢复还没回来 ——
   * 没有这道闸，它会把初始的空文档写进 localStorage，**覆盖掉上一轮的草稿**
   * （实测：刷新后草稿从 3044 字符变成 2663、`图层 1` 消失，而页面没有任何报错）。
   */
  const restoreSettledRef = useRef(false)
  /** 项目仓储的适配器（Task 1.6）。**惰性建**：在浏览器里它只会如实报"没有桌面外壳"。 */
  const persistenceRef = useRef<DocumentPersistence | null>(null)
  /** 保存失败的提示**只报一次**：反复弹同一条没有任何意义，还会把状态栏刷掉。 */
  const persistenceErrorShownRef = useRef(false)
  const [fileError, setFileError] = useState<string | null>(null)
  /**
   * 项目包面板是否打开（Task 1.6 Step 4/5 的界面入口）。
   *
   * 它是**按需渲染**的：面板一打开就会去问 IPC（读 head），而"没打开却一直在问"
   * 会在浏览器里刷出一串没人看的失败。
   */
  const [packagePanelOpen, setPackagePanelOpen] = useState(false)
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
  /**
   * 顶级模块：A「传统工作区」（画布：CAD / 平面几何 / 立体几何）与 B「Agent 工作区」。
   *
   * 刻意**不持久化**、默认回到 A：用户口径里 A 就是默认界面；把它落到 localStorage 之后，
   * 上一次退出时停在 Agent 区会让刷新后"画布不见了"，排查成本远大于那一次点击。
   * 切模块时把文档草稿、工作区文档原样留着，所以来回切换不会丢任何几何内容。
   */
  const [activeModule, setActiveModule] = useState<AppModuleId>(DEFAULT_APP_MODULE)
  /**
   * 桌面自述（G1 Task 1.1/1.2）。
   *
   * 在浏览器里读回来的是 `desktop: false` —— 那**不是错误**，而是"这个功能需要桌面版"的
   * 事实依据。模型服务界面据此如实说明，而不是让用户填完才发现存不下。
   * 读不到（IPC 失败）时同样留 `null`，界面会说"没问到"，不会编一份。
   */
  const [desktopInfo, setDesktopInfo] = useState<DesktopRuntimeInfo | null>(null)
  useEffect(() => {
    let alive = true
    void readDesktopRuntime().then((result) => {
      if (alive && result.ok && result.desktop) setDesktopInfo(result.info)
    })
    return () => { alive = false }
  }, [])
  const desktopRuntimeHint = desktopInfo ? undefined : "密钥保存在 Windows 凭据管理器里，需要桌面版（Windows 应用）；当前在浏览器里运行，配置无法保存。"
  const selectedId = selectedIds.at(-1) ?? null
  const slope = document.parameters.slope
  const slopeLine = useMemo(() => document.primitives.find((primitive) => primitive.id === "line-slope"), [document.primitives])
  // Projection geometry is derived once per revision and shared by the four viewports and every exporter.
  /**
   * **显示与导出必须解析同一个来源**（Task 0.6 Step 3，计划点名的"display and export use the
   * same scoped source context"）。
   *
   * 实测到的真实缺陷：`EngineeringDrawingView` 按 `projectionSource` 选文档
   *（`geometry3d` → 空间文档，否则本图纸），而这里过去**永远**用 `document`。
   * 于是切到"投影立体几何"之后，四个视图显示的是立方体，**导出的 SVG/DXF/PDF 里却是本图纸
   * 那份（往往是空的）内容** —— 用户拿到一个和眼前不一样的模型。
   */
  const projectionSourceDocument = resolveProjectionSource(projectionSource, document, workspaceDocuments.geometry3d ?? null)
  const engineeringDrawings = useMemo(() => engineeringDrawingViews.map((view) => resolveProjectedDrawing(projectionSourceDocument, view)), [projectionSourceDocument])
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
      const opened = migrateLegacySolids(decodeMgeo(serialized))
      replace(opened)
      /**
       * **打开文件是"换一世"**（Task 1.6）：留在仓储里的是新文档的 epoch，
       * 于是上一次编辑那次**可能还在途**的自动保存会立刻 CAS 失败 ——
       * 否则用户刚打开的文档会被旧内容覆盖，而那条路径在界面上表现为
       * "打开的文件又变回去了"，几乎无法复现。
       */
      void persistenceRef.current?.reset(opened)
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

  /**
   * **跑一轮真实运行**（Task 2.5 Step 2）。
   *
   * 逻辑全在 `agentRunner` 里（它持有运行时，因为"确认并提交"发生在运行之后，
   * 那时必须还能拿到同一份草稿）。这里只做转发 —— App 不该再有一份自己的运行实现，
   * 否则界面行为与 `agentRunner` 的测试会慢慢分叉。
   */
  const runAgentPrompt = async (prompt: string, promptMessageId: string) => {
    await agentRunner.run(prompt, promptMessageId)
  }

  /**
   * 重试：用**上一句话**再跑一轮。
   *
   * 取的是那条失败消息之前最近的一条用户消息 —— 判据与自动运行完全一样（都在消息列表里找），
   * 所以不会出现"重试了另一句话"的情况。找不到就什么都不做（而不是编一个空 prompt 去跑）。
   */
  const retryLastPrompt = () => {
    const messages = useAgentStore.getState().activeConversation?.messages ?? []
    const lastUser = [...messages].reverse().find((message) => message.role === "user")
    if (!lastUser) return
    // 新的一轮要有自己的用户消息与在途助手消息，所以走 `sendPrompt` 再交给运行器。
    useAgentStore.getState().sendPrompt(lastUser.text)
    const after = useAgentStore.getState()
    const userMessage = [...(after.activeConversation?.messages ?? [])].reverse().find((message) => message.role === "user")
    if (!userMessage) return
    void agentRunner.retry(userMessage.text, userMessage.id)
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
    /**
     * 恢复期间**用户**已经动过手吗？
     *
     * **这条守卫是被 e2e 抓出来的**：`restore()` 是异步的，而它一完成就 `replace(...)`。
     * 如果用户在它返回之前建了一个对象，那次 `replace` 会把用户刚做的事情**整个盖掉**。
     *
     * 判据用 `document.revision`：**任何一次改动都会推进它** ——
     * 包括**我们在上面那行自己做的** `switchWorkspace(workspace)`。
     *
     * 所以这里有一个顺序上的坑，是第二次才被 e2e 抓出来的（`显示 图层 1` 找不到）：
     * 用 `document`（effect 闭包里的那个值，是**切换工作区之前**的 revision）当基准，
     * 那么"切回上次的工作区"这一步本身就会被判成"用户动过手"，
     * 于是**刷新之后永远不恢复草稿** —— 表现正是那三条用例失败。
     *
     * 修法：基准要在**自己那一步之后**取。`useSceneStore.getState()` 拿的是当前值，
     * 而 effect 的闭包是旧的 —— 这个区别在这里就是正确与错误的区别。
     */
    const revisionAtStartup = useSceneStore.getState().document.revision
    const workspaceAtStartup = useSceneStore.getState().document.workspace
    const actedSinceStartup = () => useSceneStore.getState().document.revision !== revisionAtStartup
    const stillOnTheSameWorkspace = () => useSceneStore.getState().document.workspace === workspaceAtStartup
    /**
     * **先从项目仓储恢复**（Task 1.6），再退回 localStorage 草稿。
     *
     * 顺序是有意义的：仓储是**事务性**的那一层（有历史、有 CAS），localStorage 只是
     * "会话内别丢"的兜底。桌面版里两者都有 —— 仓储先答，因为它才是权威。
     *
     * 浏览器里 `restore()` 会如实报 `not_a_desktop_shell`，于是走到 localStorage 那条路，
     * 行为与加这个功能之前**完全一样**（这一点很重要：不能在网页版上把已有草稿弄丢）。
     */
    void (async () => {
      if (!persistenceRef.current) persistenceRef.current = createDocumentPersistence({
        repository: createDocumentRepository(invokeDesktop),
        projectId: "local",
        emptyDocument: () => createEmptyDocument("conics")
      })
      const restored = await persistenceRef.current.restore()
      /**
       * **用户已经动过手就不再覆盖**（见上面那段注释：这条守卫是被 e2e 抓出来的）。
       * 只在"什么都没发生"和"还在同一个工作区"时才应用恢复结果 ——
       * 前者保证不丢用户的工作，后者保证不会把 B 工作区的文档盖到 A 工作区上。
       */
      if (actedSinceStartup() || !stillOnTheSameWorkspace()) return
      if (!restored.created && restored.document.primitives.length > 0) {
        // 仓储里有东西：用它，并跳过下一次自动保存（刚恢复的内容不该立刻回写一遍）。
        skipNextDraftSaveRef.current = true
        replace(migrateLegacySolids(restored.document))
        return
      }
      // 仓储里没有（网页版就是这样）：退回 localStorage 草稿。
      // 读不出来的草稿会被**保留**在旁路键上（绝不静默删除用户的草稿），这里如实告诉用户发生了什么。
      try {
        const draft = loadDraft(workspace ?? document.workspace)
        if (draft) {
          const restoredDraft = migrateLegacySolids(draft)
          /**
           * 草稿也要过同一条守卫，而且这里**额外**比对一次工作区：
           * `loadDraft` 是按工作区读的，而用户可能在读盘期间切走了 ——
           * 把一个工作区的草稿 `replace` 到另一个工作区上就是这个功能最容易犯的错。
           */
          if (!actedSinceStartup() && useSceneStore.getState().document.workspace === (workspace ?? document.workspace)) {
            skipNextDraftSaveRef.current = true
            replace(restoredDraft)
          }
        }
      } catch (error) {
        setFileError(error instanceof Error ? error.message : "无法恢复上次的草稿")
      }
      if (restored.failure && restored.failure.code !== "not_a_desktop_shell") {
        // 仓储**本该可用**却失败了：如实说，用户才知道"这次改动关掉就没了"。
        setFileError(`本地项目库不可用，改动只保留在会话内：${restored.failure.detail}`)
      }
    })().finally(() => {
      /**
       * **恢复这一段结束了**，自动保存从这一刻起可以写。
       *
       * ## 这条标记是探针抓出来的（本片最隐蔽的一个缺陷）
       *
       * 自动保存那个 effect 挂在 `[document]` 上，而它在**挂载时就会跑一次** ——
       * 那时恢复还没回来，于是它把**初始的空文档**写进了 localStorage。
       * 后果是：刷新之后草稿先被空文档覆盖（实测 3044 → 2663 字符、`图层 1` 消失），
       * 恢复再去读那份**已经被覆盖了的**副本 —— 用户看到的就是"刷新之后我建的东西没了"。
       *
       * 探针输出的决定性证据就是那两行：
       * `draft has 图层 1 = true`（刷新前）→ `false`（刷新后），而页面上没有任何报错。
       *
       * 为什么不在"恢复成功"时才置位：恢复**失败**时也必须放行自动保存，
       * 否则用户之后的改动一次都存不下去 —— 那是比覆盖更糟的失败。
       */
      restoreSettledRef.current = true
    })
  }, [document.workspace, replace, switchWorkspace])

  useEffect(() => {
    /**
     * **恢复还没结束就什么都不写**（见上面那段证据）。
     * 这一条挡的是"初始空文档覆盖掉上一轮的草稿"，而不是"别存"。
     */
    if (!restoreSettledRef.current) return
    if (skipNextDraftSaveRef.current) { skipNextDraftSaveRef.current = false; return }
    // localStorage 那一份照旧：它是网页版的**唯一**持久化，也是桌面版的兜底。
    try { saveDraft(document) } catch (error) { reportFileError(error, "无法自动保存草稿") }
    /**
     * 项目仓储那一份：**每次改动都写**（防丢），但适配器会在内容没变时**在本地挡掉**，
     * 所以高频拖动不会在仓储里留下几百个 generation。
     *
     * 这里刻意**不 await**：自动保存是后台动作，让它挡住渲染没有任何好处。
     * 失败**不静默** —— 一次失败就够告诉用户"本地项目库写不进去了"（反复弹同一条没有意义）。
     */
    void persistenceRef.current?.save(document, document.primitives.length).then((result) => {
      if (!result.ok && result.code !== "not_a_desktop_shell" && !persistenceErrorShownRef.current) {
        persistenceErrorShownRef.current = true
        setFileError(`本地项目库保存失败，改动只保留在会话内：${result.detail}`)
      }
    })
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
  /**
   * 在一条**曲线**上作切线（用户口径 1：「创建一条曲线后，可以点击这条曲线，右侧功能栏里应有一个选项
   * 是创建一条在这个曲线上的切线。曲线包括抛物线，双曲线，圆，椭圆」）。
   *
   * 切点落在曲线的**自然参数原点**上 —— 四条曲线的参数 0 都恰好是它们的一个顶点
   * （圆的右顶点、椭圆的长轴端点、双曲线的顶点、抛物线的顶点），因此这是"教科书上那条切线"。
   * 之后用户可以在右侧拖「切点参数」把它沿曲线滑到任意位置，或者改用「跟随动点」。
   *
   * 几何不在这里算：只写 `anchor` + 一个占位几何，重算会立刻把真正的切点与切向填进去
   * （与函数切线同一条路径，见 `addFunctionAnalysis`）。
   */
  const addCurveTangent = (sourceId: string) => {
    const source = document.primitives.find((primitive) => primitive.id === sourceId)
    if (!isTangentSource(source)) return
    const id = nextPrimitiveId(document, "tangent")
    apply({
      op: "addPrimitive",
      primitive: {
        id,
        type: "tangent",
        sourceId,
        x: 0,
        point: { x: 0, y: 0 },
        slope: 0,
        a: { x: 0, y: 0 },
        b: { x: 0, y: 0 },
        status: "approximate",
        anchor: defaultTangentAnchor(),
        label: `切线 ${id.split("-").at(-1)}`
      }
    })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "curveTangent", source: source.type }))
  }
  /**
   * 在**动点**处作切线（用户口径 2 的前半：「动点在轨道上能够在动点位置画切线，同时切线能根据动点位置
   * 进行动态变化」）。
   *
   * 定位写成 `{ kind: "point", pointId }` 而不是把当前参数抄下来：抄下来的是一次性的快照，
   * 动点再动切线就不跟了。写成引用之后，"点动 → 切线动"由依赖图保证（见 `primitiveDependencies`）。
   * 动点必须已经绑在一条曲线轨道上 —— 没有轨道就没有"在它那里作切线"这回事。
   */
  const addPointTangent = (pointId: string) => {
    const point = document.primitives.find((primitive) => primitive.id === pointId)
    // 收窄先落到局部常量上：`point.binding!.pathId` 这种写法过不了类型检查（`!` 不参与辨识联合的收窄）。
    const binding = point?.type === "point" ? point.binding : undefined
    if (point?.type !== "point" || binding?.kind !== "onPath") return
    const source = document.primitives.find((primitive) => primitive.id === binding.pathId)
    if (!isTangentSource(source)) return
    const id = nextPrimitiveId(document, "tangent")
    apply({
      op: "addPrimitive",
      primitive: {
        id,
        type: "tangent",
        sourceId: source.id,
        x: point.x,
        point: { x: point.x, y: point.y },
        slope: 0,
        a: { x: point.x, y: point.y },
        b: { x: point.x, y: point.y },
        status: "approximate",
        anchor: { kind: "point", pointId },
        label: `切线 ${id.split("-").at(-1)}`
      }
    })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "pointTangent", point: point.label ?? point.id }))
  }
  /**
   * 以选中的点为**圆心**作圆（用户口径 2 的后半：「第二动点能够作为圆心作圆，圆的半径能够调节，
   * 也能够根据动点位置进行动态变化」）。
   *
   * 只写 `centerPointId`，半径先给一个默认值 —— 「半径是否随动点走」是用户下一步的选择：
   * 想固定就在右侧改数字，想跟随就选一个驱动点（`radiusFrom`）。圆心一开始就摆在点上，
   * 所以第一帧起"圆心就是这个点"就成立。
   */
  const createCircleAtPoint = (pointId: string) => {
    const point = document.primitives.find((primitive) => primitive.id === pointId)
    if (point?.type !== "point") return
    const id = nextPrimitiveId(document, "circle")
    apply({
      op: "addPrimitive",
      primitive: {
        id,
        type: "circle",
        center: { x: point.x, y: point.y },
        radius: DEFAULT_CENTERED_CIRCLE_RADIUS,
        centerPointId: point.id,
        label: `圆 ${id.split("-").at(-1)}`
      }
    })
    setSelectedIds([id])
    setGuidance(guidanceFor({ kind: "circleAtPoint", point: point.label ?? point.id }))
  }
  const selectedPointIds = selectedIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point")
  const selectedPoint3Ids = selectedIds.filter((id) => document.primitives.find((primitive) => primitive.id === id)?.type === "point3")
  const point3ToolState = point3ToolAvailability(selectedPoint3Ids.length, selectedIds.length)
  const canCreateLine3 = point3ToolState.line
  const canCreatePlane3 = point3ToolState.plane
  const canCreateFace3 = point3ToolState.face
  const canCreateCircle3 = point3ToolState.circle
  const canCreatePointConnection = (selectedIds.length === 2 || selectedIds.length === 3) && selectedPointIds.length === selectedIds.length
  /**
   * "能不能由这两个对象创建交点"用的是**全仓库同一张表**（`@draw/dsl` 的 `SAMPLED_PRIMITIVE_TYPES`）。
   * 这里以前自己抄了一份类型名单，切线因此既不能预览交点、也不能手动创建 —— 用户报的正是这一条。
   */
  const canCreateIntersection = canCreatePointConnection || (selectedIds.length === 2 && selectedIds.every((id) => {
    const primitive = document.primitives.find((candidate) => candidate.id === id)
    return primitive ? isSampledPrimitiveType(primitive.type) : false
  }))
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

  /**
   * 四类模板的默认落点：**都坐在地面上**（底面 z = 0），并分在四个象限里**互不重叠**。
   *
   * 用户反馈："你的立体几何内容好像原点位置错了，图有点怪。" 量出来是四套互相矛盾的约定：
   * 立方体 / 棱锥"中心在原点"（一半埋在地面下）、圆柱躺在地面上、圆锥悬空 3 格；而且立方体与棱锥的
   * 水平足迹本来就相交（x ∈ [−2,0]），先后添加两个会直接穿在一起。现在统一成"实体放在桌上"：
   * 网格是地板，底面落在 z = 0 上，四个象限各一个（±5），原点正好落在它们中间。
   */
  const addDefaultCube = () => {
    const id = nextPrimitiveId(document, "cube")
    addSolidTemplate({ id, type: "cube", origin: { x: -7, y: 3, z: 0 }, size: { x: 4, y: 4, z: 2 }, label: `立方体 ${id.split("-").at(-1)}` })
  }
  const addDefaultSolid = (type: "pyramid" | "cylinder" | "cone") => {
    const id = nextPrimitiveId(document, type)
    const primitive = type === "pyramid"
      ? { id, type, baseCenter: { x: 5, y: 5, z: 0 }, baseSize: { x: 4, y: 4 }, height: 4, label: `棱锥 ${id.split("-").at(-1)}` }
      : type === "cylinder"
        ? { id, type, center: { x: 5, y: -5, z: 0 }, radius: 1.5, height: 3, segments: ROUND_SOLID_SEGMENTS, label: `圆柱 ${id.split("-").at(-1)}` }
        : { id, type, center: { x: -5, y: -5, z: 0 }, radius: 1.5, height: 3, segments: ROUND_SOLID_SEGMENTS, label: `圆锥 ${id.split("-").at(-1)}` }
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
  /**
   * 对象朝向的**相对**旋转（空间面 / 圆轨道）：枢轴缺省由域操作取"它拥有的点的形心"，
   * 也就是面绕自己的重心转、圆轨道绕圆心转——界面不需要先算一次中心。
   */
  const rotateSelected3 = (axis: "x" | "y" | "z", degrees: number) => {
    if (!selectedId) return
    apply({ op: "rotatePrimitive3", id: selectedId, axis, degrees })
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
  /**
   * 空间圆轨道（`circle3`）：三种选点法都有确定的几何含义，绝不靠猜——
   * 1 个点 = 圆心（法向默认 +Z 水平放置，半径默认 1.5，属性栏可改）；
   * 2 个点 = 圆心 + 圆周上一点（半径 = 两点距离）；
   * 3 个点 = 三点定平面（法向 = 三点平面法向、圆心 = 第一个点、半径 = 到第二个点的距离）。
   *
   * 三点共线时平面法向没有定义：如实拒绝并说明，而不是退回 +Z 假装成功。
   */
  function addCircle3Track() {
    if (!canCreateCircle3) return
    const centres = selectedPoint3Ids
      .map((id) => document.primitives.find((primitive) => primitive.id === id))
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point3" }> => primitive?.type === "point3")
    const center = centres[0]
    if (!center) return
    // 三个点时法向取三点平面；`planeThroughPoints` 对共线输入返回 null——那就不猜，如实拒绝。
    const plane = centres.length === 3 ? planeThroughPoints(centres.map((point) => point.position)) : null
    if (centres.length === 3 && !plane) {
      setFileError("三个点共线，定不出圆轨道所在的平面：请换一个不共线的点")
      return
    }
    const normal = plane ? plane.normal : { x: 0, y: 0, z: 1 }
    const rim = centres[1]
    // 半径优先取"圆心到第二个点的距离"：用户点两个点就是想要那么大一个圈。
    const delta = rim ? { x: rim.position.x - center.position.x, y: rim.position.y - center.position.y, z: rim.position.z - center.position.z } : null
    const radius = delta ? Math.hypot(delta.x, delta.y, delta.z) : DEFAULT_CIRCLE3_TRACK_RADIUS
    if (!(radius > 1e-6)) {
      setFileError("圆心与圆周点重合，定不出半径：请让两点分开")
      return
    }
    const id = nextPrimitiveId(document, "circle3")
    /**
     * **取一次坐标就脱钩**：选中的点只用来量出圆心 / 半径 / 平面，圆自己不引用任何点。
     * 用户口径："我要的轨道圆是点在圆上而不是圆跟着点走"——所以建完之后拖那些点不会动这条轨道。
     */
    apply({ op: "addPrimitive", primitive: { id, type: "circle3", center: { ...center.position }, normal, radius, label: `圆轨道 ${id.split("-").at(-1)}` } })
    setSelectedIds([id])
    setFileError(null)
    setGuidance(guidanceFor({ kind: "point3Tool", tool: "circle", outcome: "created" }))
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
      /**
       * 与 scene-graph 的重算**用同一个实体解析器**（点 / 线 / 圆），否则这里预检会把
       * "切线与直线的夹角"当成无意义的来源直接拒掉 —— 按钮点了没反应。
       */
      const reading = evaluatePlanarMeasurement({
        id,
        metric: metric as PlanarMetric,
        sourceIds: selectedIds,
        angleKind: dihedralKind === "exterior" ? "exterior" : "interior"
      }, entityResolverFor(document.primitives))
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
    /**
     * 拖动"以动点为圆心"的圆 = 拖动那个圆心点。
     *
     * 直接把位移写进圆的 `center` 会被下一趟重算覆盖回去（圆心是那个点图元的派生缓存），
     * 用户看到的是"拖了没反应"。把位移转给圆心点，圆自然跟着走 —— 这与"定点是曲线自己的属性、
     * 曲线跟着定点走"是同一条设计（见下面的动圆分支）。
     */
    const dragged = document.primitives.find((primitive) => primitive.id === id)
    if (action.kind === "translate" && dragged?.type === "circle" && dragged.centerPointId) {
      apply({ op: "translatePrimitive", id: dragged.centerPointId, delta: action.delta })
      return
    }
    /**
     * 拖动"跟随动点"的切线 = 拖动那个定位动点。
     *
     * 切线的几何是算出来的，平移它自己没有意义（`translatePrimitive` 对切线是空操作，拖了等于没拖）。
     * 把位移转给定位点，点沿它的轨道滑动、切线自然跟着走 —— 复用已经跑通的"拖动动点"那条路。
     */
    if (action.kind === "translate" && (dragged?.type === "tangent" || dragged?.type === "normal") && dragged.anchor?.kind === "point") {
      apply({ op: "translatePrimitive", id: dragged.anchor.pointId, delta: action.delta })
      return
    }
    /**
     * 函数来源的**旧切线**（没有 `anchor`）：横向拖动改切点的横坐标。
     *
     * 它的切点由 `x` 定位，所以"沿函数图像滑动"就是把指针的横向位移加到 `x` 上。
     * 纵向不动 —— 切点的纵坐标是算出来的，跟着指针走会让切线离开曲线。
     */
    if (action.kind === "translate" && (dragged?.type === "tangent" || dragged?.type === "normal") && !dragged.anchor && action.delta.x !== 0) {
      apply({ op: "updatePrimitive", id, patch: { x: dragged.x + action.delta.x } })
      return
    }
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
     * **一次批量删除**（Task 0.4）：整批当作并集提交，所以与选择顺序无关，
     * 而且只占**一步撤销**。以前是逐个 `apply({op:"deleteObject"})` ——
     * 虽然已经用 `validateDeletion` 做过并集校验，但 N 个对象会留下 N 步撤销。
     *
     * `validateDeletion` 仍然先行：它给出的是**用户可读**的拒绝理由
     *（"对象被另一个对象引用"），而事务的 `errors` 是给 run 记录看的实现细节。
     */
    const validation = validateDeletion(document, selectedIds)
    if (!validation.valid) {
      setFileError(validation.errors.join(", "))
      return
    }
    /**
     * 手工按钮与 Agent 走**同一份动作编译器**（设计规格 §7.4：不复制一份 Agent 专用语义）。
     * `validateDeletion` 仍然先行，因为它给的是**用户可读**的拒绝理由（"对象被另一个对象引用"）；
     * 编译器的诊断是给 run 记录与模型修复路径看的，措辞面向执行而非面向人。
     */
    const compiled = compileActions(document, [{ actionId: "object.delete_many", actionKey: "manual-delete", factIds: [], inputs: { targets: [...selectedIds] } }], {
      targetDocument: document,
      targetWorkspace: document.workspace,
      orderedSelection: [...selectedIds],
      capabilityRevision: CAPABILITY_REGISTRY_REVISION,
      idAllocator: createIdAllocator(document.primitives.map((primitive) => primitive.id))
    })
    if (compiled.diagnostics.length > 0) {
      setFileError(compiled.diagnostics.map((entry) => entry.message).join("；"))
      return
    }
    applyBatch(compiled.operations)
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
    canCreateCircle3,
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
      case "create-circle3-track": addCircle3Track(); break
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
      case "create-circle3-track": addCircle3Track(); break
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

  /**
   * 切换工作区（平面几何 / 立体几何 / 工程制图）。顶栏标签、左侧模块栏、Agent 区的「返回画布」
   * 三个入口都走这一个函数：选择、创建步骤、指引与移动端抽屉统统要按**新画布**清空，
   * 否则切过去之后属性栏还在编辑上一个工作区的图元 id。
   *
   * Ribbon 折叠时顺带把它**临时呼出**（与标签栏点击同一行为）：从左侧栏切工作区的人
   * 接下来多半就是要用命令，留一个空白的命令区只会让他以为切换失败了。
   */
  const handleWorkspaceChange = (workspace: Workspace) => {
    setSelectedIds([])
    setCreationStep(null)
    setGuidance(workspace === "geometry3d" ? guidanceFor({ kind: "point3Tool", tool: "line", outcome: "blocked", point3Count: 0 }) : null)
    setMobileDock(null)
    setActiveCommand(null)
    if (!ribbonExpanded) setActiveRibbonTab("home")
    switchWorkspace(workspace)
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
   * 空白画布上**不再有任何**说明文字或快捷按钮（用户口径：中间那块文字与四个按钮都去掉）。
   * 之前这里有一个 `runQuickStart`，把画布上的快捷按钮转发到功能区命令；
   * 入口撤掉之后它没有任何调用者，因此一并删除 —— 功能区那四个按钮仍然照旧工作。
   */

  const planarCanvas = <GraphicsView document={document} selectedIds={selectedIds} creationMode={creationMode} onSelect={updateSelection} onBoxSelect={selectBox} onCanvasClick={handleCanvasCreationClick} onCanvasDoubleClick={handleCanvasDoubleClick} onDragEnd={handleDragEnd} onCreateIntersection={createIntersectionFromPreview} onPointerCoordinate={setPointerCoordinate} />

  /**
   * 可作宿主的图元：空间直线 / 线段 / 射线 / 棱 / 面 / 圆柱与圆锥侧面，以及**实体的内部**
   *（用户要求："动点的约束应该可以在立方体内"）。列什么与取值编码见 `pointHostOptions`。
   */
  const pointHostCandidates = useMemo(
    () => pointHostOptions(document.primitives).map((option) => ({ id: option.value, label: option.label })),
    [document.primitives]
  )

  const propertiesBarProps: PropertiesBarProps = { selectedPrimitive, selectedIds, selectedCount: selectedIds.length, selectedGroupId: selectedGroup?.id ?? null, allSelectedVisible, canCreateIntersection, onCreateGroup: createGroup, onDeleteGroup: deleteGroup, onCreateIntersection: createIntersection, onAlign: alignSelection, onToggleSelectedVisibility: () => selectedId && apply({ op: "toggleVisibility", id: selectedId, visible: selectedPrimitive?.visible === false }), onToggleSelectedLock: () => selectedId && apply({ op: "toggleLock", id: selectedId, locked: !selectedPrimitive?.locked }), onDeleteSelected: deleteSelected, onToggleBatchVisibility: () => apply({ op: "setPrimitivesVisible", ids: selectedIds, visible: !allSelectedVisible }), onUpdatePrimitive: (patch) => selectedId && apply({ op: "updatePrimitive", id: selectedId, patch }), onRotateSection: rotateSelectedSection, onRotate3: rotateSelected3, onMaterializeSection: materializeSelectedSection, pointHostCandidates, onBindPointHost: bindPointToHost, onChangeHostParameter: setPointHostParameter, onAddAnnotation: addAnnotation, onAddEngineeringAnnotation: addEngineeringAnnotation, onCreateMeasurement: addMeasurement, onDeleteMeasurement: deleteMeasurement, onCreateMovingCircle: createMovingCircle, onCreateCircleAtPoint: createCircleAtPoint, onCreateCurveTangent: addCurveTangent, onCreatePointTangent: addPointTangent, onUpdateSelectionStyle: (style) => apply({ op: "setPrimitivesStyle", ids: selectedIds, style }), onCreateDerivative: (sourceId) => addFunctionAnalysis(sourceId, "derivative"), onCreateTangent: (sourceId) => addFunctionAnalysis(sourceId, "tangent"), onCreateIntegral: (sourceId) => addFunctionAnalysis(sourceId, "integral"), value: slope?.value ?? 0.5, min: slope?.min ?? 0.15, max: slope?.max ?? 0.85, step: slope?.step ?? 0.05, onChange: (value) => apply({ op: "setParameter", id: "slope", value }) }

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
  /**
   * 来源标签与检查器的"投影来源"解析**必须在两份文档里找**（Task 0.6 Step 3 后半）。
   * 过去两者都只查布局文档，于是切到"投影立体几何"之后，看得见的空间对象会被标成"来源已删除"。
   * 同 id 同时存在于两份文档时，以**当前显示的那一份**（`projectionSourceDocument`）为准。
   */
  /** 引用稳定：它是 `cadInspectorSources` 的依赖，每次渲染新建对象会让那个 memo 白做。 */
  const sourceDocuments = useMemo(
    () => ({ layoutDocument: document, spatialDocument: workspaceDocuments.geometry3d ?? null }),
    [document, workspaceDocuments.geometry3d]
  )

  // Sources referenced by engineering annotations and drawing views; deleted ones stay visible as diagnostics.
  const cadInspectorSources: InspectorSource[] = useMemo(() => {
    const ids = new Set<string>()
    for (const annotation of document.engineeringAnnotations ?? []) for (const id of annotation.sourceIds) ids.add(id)
    for (const view of document.drawingViews ?? []) for (const id of view.sourceIds ?? []) ids.add(id)
    return [...ids].map((id) => ({ id, ...resolveProjectionSourceEntity(id, projectionSourceDocument, sourceDocuments) }))
  }, [document, projectionSourceDocument, sourceDocuments])

  /** 图纸树用的标签表：与检查器同一批 id、同一套解析，避免两处各写一份查找。 */
  const sourceLabels = useMemo(() => Object.fromEntries(cadInspectorSources.map((source) => [source.id, source.label])), [cadInspectorSources])

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

  return <div className="app-shell" data-app-module={activeModule}>
    {/* 纸纹滤镜的定义。放在 App 里（而不是只放在入口）是因为整个界面的 CSS 都引用 `#paper-grain`，
        任何渲染 App 的地方（含测试与嵌入）都必须有这份定义，否则纹理层会渲染成空白。 */}
    <PaperTexture />
    {/* 顶级导航：模块 A 传统工作区 / 模块 B Agent 工作区。它常驻在最左侧（两个模块都在），
        所以"现在在哪个大板块、怎么换回去"永远看得见，而不是藏在 Agent 区内部的一个按钮里。 */}
    <ModuleRail
      activeModule={activeModule}
      onModuleChange={setActiveModule}
      activeWorkspace={document.workspace}
      onWorkspaceChange={handleWorkspaceChange}
    />
    {activeModule === "traditional" ? <div className="app-module" data-module="traditional">
      {/* 顶栏只剩品牌（含动态粒子与打字光标）；文件命令 / 搜索 / 设置下沉到标签栏右端。 */}
      <WorkspaceHeader />
      <AppChrome activeWorkspace={document.workspace} onWorkspaceChange={handleWorkspaceChange} ribbonGroups={ribbonGroups} activeRibbonTab={activeRibbonTab} ribbonExpanded={ribbonExpanded} ribbonPinned={ribbonPinned} onRibbonTabChange={setActiveRibbonTab} onRibbonCommand={runRibbonCommand} onRibbonExpandedChange={setRibbonExpanded} onRibbonPinnedChange={setRibbonPinned} onUndo={undo} onRedo={redo} canUndo={canUndo} canRedo={canRedo} onSave={save} onOpen={() => fileInputRef.current?.click()} onPackage={() => setPackagePanelOpen(true)} />
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
        }} onRotateEnd={(id, axis, degrees) => apply({ op: "rotatePrimitive3", id, axis, degrees })} onTrackRadiusEnd={(id, radius) => apply({ op: "updatePrimitive", id, patch: { radius3: radius } })} onPickSectionFace={applySectionFace} /> : planarCanvas}
        {inspectorPanel}
        <div className="status-bar" role="status" aria-live="polite" aria-label="操作提示"><span className="status-bar-prompt">{statusPrompt}</span><span className="status-bar-item">{pointerCoordinate ? `坐标 (${pointerCoordinate.x.toFixed(2)}, ${pointerCoordinate.y.toFixed(2)})` : "坐标 —"}</span><span className="status-bar-item">对象 {document.primitives.length}</span><span className="status-bar-item">工作区 {document.workspace}</span></div>
      </div>}
      {(fileError || operationError) && <div role="alert" className="footer-note">{fileError ?? operationError}</div>}
      {document.workspace !== "cad" && guidance && <GuidanceHint text={guidance} onDismiss={() => setGuidance(null)} />}
      {/* 项目包（`.mcanvas` 导出/导入 + 附件）：文件级动作，与"打开/保存 .mgeo"同一组入口。
          导入走的是 `load` —— 与打开文件**同一条路**（换文档 + 换一世），所以不需要第二套逻辑。 */}
      {packagePanelOpen && <ProjectPackagePanel
        document={document}
        projectId="local"
        onImported={load}
        onNotice={(notice) => setFileError(notice.kind === "error" ? notice.text : null)}
        onClose={() => setPackagePanelOpen(false)}
        unavailableReason={desktopRuntimeHint}
      />}
    </div> : activeModule === "agent" ? <div className="app-module" data-module="agent">
      {/* 模块 B 不含任何从几何文档派生的 UI（Ribbon / 画布 / 检查器），所以文档一步都不订阅，
          切进 Agent 区不会因为画布重渲染而卡一下。 */}
      <AgentWorkspace
        onBackToWorkspace={() => setActiveModule(DEFAULT_APP_MODULE)}
        onRun={runAgentPrompt}
        // 点的是哪块面板就确认哪一轮（`runId` 来自那条消息；Fix round 1 / C2）。
        onConfirm={(runId) => { agentRunner.confirm(runId) }}
        onDiscard={(runId) => { agentRunner.discard(runId) }}
        onStop={(runId) => { agentRunner.stop(runId) }}
        onRetry={retryLastPrompt}
      />
      {(fileError || operationError) && <div role="alert" className="footer-note">{fileError ?? operationError}</div>}
    </div> : <div className="app-module" data-module="settings">
      {/* 模块 C **模型服务**（G1 Task 1.3）：provider 配置与密钥是**应用级**的东西 ——
          不属于任何一个工作区，也不属于对话区。
          在桌面外壳里它是真的能存的地方；在浏览器里如实说明"需要桌面版"，
          而不是让用户填完才发现存不下。 */}
      <ProviderSettings unavailableReason={desktopRuntimeHint} />
    </div>}
    <input ref={fileInputRef} hidden aria-label="加载 .mgeo 文件" type="file" accept=".mgeo,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; file.text().then(load).catch(() => setFileError("无法读取 .mgeo 文件")); event.target.value = "" }} />
  </div>
}

