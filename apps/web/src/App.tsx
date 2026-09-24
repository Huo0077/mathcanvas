import { useEffect, useMemo, useRef, useState } from "react"

import { decodeMgeo, type DrawingSheetSpec, type PrimitiveSpec, type Workspace } from "@draw/dsl"
import { commitPatch } from "@draw/scene-graph"
import type { DomainOperation } from "@draw/scene-graph"

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
import { useKeyboardShortcuts } from "./useKeyboardShortcuts"
import { createCommandDispatch } from "./commandDispatch"
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
import { useDraftPersistence } from "./useDraftPersistence"
import { DEFAULT_APP_MODULE, type AppModuleId } from "./shellModules"
import { resolveIntersectionPreview } from "./intersectionPreview3d"
import { ThreeSceneView } from "./threeScene"
import type { RibbonTabId } from "./uiState"
import { resolveGeometryEdit, type GeometryEditRequest } from "./draftEditing"
import { createFileExports } from "./persistence/fileExports"
import { selectExportableDrawings } from "./persistence/exportableDrawings"
import { defaultDraftView, drawingViewLabels, resolveProjectedDrawing } from "./projectionVisuals"
import { resolveProjectionSource, resolveProjectionSourceEntity } from "./projectionSource"
import { migrateLegacySolids } from "./solidTemplates"
import { pointHostOptions } from "./pointHostOptions"
import { type SceneControlMode } from "./statusPrompts"
import { computeIntersectionPreviews3d, type IntersectionPreview3dCache } from "./intersectionPreviews3d"
import { toScenePreview, toSectionScenePreview, toSelectionLineScenePreview } from "./threeScenePreview"
import { useSceneStore } from "./store"
/**
 * id 与自动标签的分配、以及键盘判据（Esc / 撤销快捷键 / 焦点是否在输入框）都在
 * `./documentIds`：它们是**纯函数**，此前是这里的模块级函数，`useSceneStore` 只被当作类型用，
 * 于是既进不了别的模块、也没法单独测。见那个文件的头注释。
 */
import { nextPrimitiveId } from "./documentIds"
/**
 * "把选中的东西变成一个新图元"那一族命令（默认圆锥曲线 / 函数、函数分析、两类切线、
 * 以点为圆心作圆、四类模板与正四面体）在 `./creationCommands`：依赖只有
 * "文档 + apply + 三个 setter"。
 */
import { createCreationCommands } from "./creationCommands"
/**
 * 立体几何的"截面与宿主绑定"那一族（建截面 / 转朝向 / 把截面物化 / 空间点绑到宿主 /
 * 改宿主参数）在 `./solidCommands`；`solidTypes` 也随之搬过去（两处都在用，只准有一份定义）。
 */
import { createSolidCommands } from "./solidCommands"
import { deriveAppViewState } from "./appViewState"
/**
 * 标注 / 参数 / 测量那三条"记录"命令（加一条、删一条）在 `./recordCommands`：
 * 它们都不是几何，而是挂在图元或文档上的记录，几何一律由 `applyOperation` 重算。
 */
import { createRecordCommands } from "./recordCommands"
/**
 * 文档**结构**编辑那一族（批量删除选中对象、图层的增删）在 `./structureCommands`：
 * 删除走"校验先行 + 整批一步撤销"，图层是文档的骨架而不是几何。
 */
import { createStructureCommands } from "./structureCommands"
/**
 * "动圆"与"绕定点旋转"两条命令在 `./anchorRotationCommands`：同一个几何（曲线始终过那个定点），
 * 两个入口。它们的工厂调用点在 `rotationAnchor` 之后 —— 那是它们的入参。
 */
import { createAnchorRotationCommands } from "./anchorRotationCommands"
/**
 * 三维工具的创建命令（空间点 / 直线 / 平面 / 面 / 圆轨道）在 `./point3ToolCommands`：
 * 入参里那几个 `canCreateXxx` 与按钮的禁用判据同源，不在模块里重判一遍。
 */
import { createPoint3ToolCommands } from "./point3ToolCommands"
/**
 * "点预览就建图元"那两条命令在 `./previewCommands`（3D 预览 → 交面 / 交点 / 交线 / 截面，
 * 平面预览 → 交点）。预览里的"截面"复用 `addSection`，不在预览这条路上另写一份。
 */
import { createPreviewCommands } from "./previewCommands"
/**
 * 选择与批量操作（点选 / 框选 / 锁定 / 分组 / 对齐）在 `./selectionCommands`：
 * "全选了没有""选中的是不是都锁着"这类判据与界面显示同源，不在模块里重判一遍。
 */
import { createSelectionCommands } from "./selectionCommands"
/**
 * 2D 绘图的创建流程（开始创建 → 画布点击 → 折线双击收尾）在 `./draftingCommands`：
 * `CreationMode` / `CreationStep` 两个类型也随之搬过去（只准有一份定义）。
 */
import { createDraftingCommands, type CreationMode, type CreationStep } from "./draftingCommands"
/**
 * 状态栏那句话的推导（创建步骤 > 显示开关 > 交线预览 > 默认提示）在 `./canvasStatusPrompt`：
 * 解析器留在 `./statusPrompts`（只认结构化输入），这一层负责把画布现在的样子折算成它的入参。
 */
import { deriveCanvasStatusPrompt } from "./canvasStatusPrompt"

const engineeringDrawingViews = ["front", "top", "left", "axonometric"] as const

/**
 * 新建"动圆"的默认半径（世界单位）。与画布默认取景相称：够大能看清，又不至于一出来就超出视野。
 */

/**
 * 新建**空间圆轨道**的默认半径（世界单位）。只选了一个点时用它：与默认取景相称，
 * 用户随后可以在属性栏改成想要的圈。
 */

/**
 * "以点为圆心作圆"的默认半径。比动圆小一点：它是一个真正的圆（要标圆心），
 * 摆在点的正右侧一个半径处，视觉上不会一出来就压住旁边的图形。
 */

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
  const [fileError, setFileError] = useState<string | null>(null)
  /**
   * 启动恢复与自动保存都在 `./useDraftPersistence`（两个 effect + 它们之间的时序守卫）。
   * 这里只留一行调用与"换一世"那个入口 —— 那段时序的证据与口径随代码一起搬过去了。
   *
   * 调用点**排在 `load` 之前**：`load` 里要用它的 `reset`，"用到"发生在用户操作时，
   * 但把调用点放在前面才不必依赖"这个函数一定不会在渲染期被调到"。
   */
  const { reset: resetPersistence } = useDraftPersistence({ document, replace, switchWorkspace, setFileError })
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

  /**
   * **文件下载与导出**已经拆到 `./persistence/fileExports`（约 70 行闭包 → 一处工厂）。
   *
   * 传进去的是**取值函数**而不是当次的文档：命令面板会在 React 之外调用这些入口，
   * 拿快照会让它导出"上一次渲染时"的文档。见那个文件的头注释。
   */
  const fileExports = createFileExports({ getDocument: () => document, getExportableDrawings: () => exportableEngineeringDrawings, setFileError })
  const save = () => fileExports.save()
  const exportSvgFile = (format: "svg" | "dxf" | "pdf" = "svg") => fileExports.exportSvgFile(format)
  const exportCsvFile = () => fileExports.exportCsvFile()
  const exportPngFile = () => fileExports.exportPngFile()
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
      void resetPersistence(opened)
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
  /** New 2D objects join the active CAD layer so the layer tree can hide or lock them. */
  const cadLayerFields = (): { layerId?: string } => document.workspace === "cad" && document.activeLayerId ? { layerId: document.activeLayerId } : {}

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

  const { addDefaultPrimitive, addFunctionAnalysis, addCurveTangent, addPointTangent, createCircleAtPoint, addDefaultCube, addDefaultSolid, addTetrahedron } = createCreationCommands({ document, apply, setSelectedIds, setGuidance, setFileError })
  /**
   * 派生视图状态（选中了谁、能不能建、活动图层能不能画、标注与定点旋转的入参够不够）全部在
   * `./appViewState` 里算，这里只解构 —— 名字与搬走之前逐字一致，所以下面所有引用一行没改。
   */
  const {
    selectedId, selectedPrimitive, selectedPoint3Ids,
    canCreateLine3, canCreatePlane3, canCreateFace3, canCreateCircle3,
    canCreatePointConnection, canCreateIntersection, canCreateSection,
    allSelectedLocked, allSelectedVisible, cadActiveLayer, cadActiveLayerBlockedReason,
    canCreateLinearAnnotation, canCreateAngularAnnotation, rotationAnchor, canAnchorRotation
  } = deriveAppViewState({ document, selectedIds })
  const { selectedGroup, updateSelection, selectBox, toggleLock, createGroup, deleteGroup, alignSelection } = createSelectionCommands({ document, selectedIds, allSelectedLocked, apply, setSelectedIds, setCreationStep, setGuidance })
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

  const { addSection, rotateSelectedSection, rotateSelected3, applySectionFace, bindPointToHost, setPointHostParameter, materializeSelectedSection } = createSolidCommands({ document, selectedPrimitive, selectedId, apply, setSelectedIds, setGuidance, setFileError })
  const { createFromPreview, createIntersectionFromPreview } = createPreviewCommands({ document, apply, setSelectedIds, setLayerNotice, addSection })
  const { addPoint, addPoint3, addLine3, addPlane3, addFace3, addCircle3Track } = createPoint3ToolCommands({ document, selectedPoint3Ids, canCreateLine3, canCreatePlane3, canCreateFace3, canCreateCircle3, apply, setSelectedIds, setGuidance, setFileError, cadLayerFields })
  const { startCreation, handleCanvasCreationClick, handleCanvasDoubleClick } = createDraftingCommands({ document, creationStep, addLine3, addPlane3, addFace3, canCreateLine3, canCreatePlane3, canCreateFace3, selectedPoint3Ids, apply, setCreationStep, setSelectedIds, setGuidance, cadLayerFields })
  const { addAnnotation, addEngineeringAnnotation, addParameter, addMeasurement, deleteMeasurement } = createRecordCommands({ document, selectedPrimitive, selectedIds, apply, setGuidance, setFileError })
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
    /**
     * **整次拖动只压一条撤销记录**（外部审查 S1）。
     *
     * 原先这里对主位移 `apply` 一次、再对每条受影响的曲线各 `apply` 一次 ——
     * 一次拖动因此压**两条**（或更多）撤销记录，而一次 Ctrl+Z 只退一条：
     * 用户看到的是"点退回去了、动圆却没跟回来"，圆不再过它的定点
     *（审计实测 `dist = 4.123` vs `r = 3`），要按两次才回得到原状。
     * `applyBatch` 就是为"一次交互 = 多笔补丁"准备的：事务里逐笔校验、逐笔应用，
     * 但**整批只压一步**。
     *
     * 位移必须仍然取自**主位移实际生效之后**的那份文档：受限的点（绑在宿主上的）
     * 可能只走了一部分、甚至拒绝整段位移。所以这里用纯函数 `commitPatch` **先试算一次**，
     * 而不是"先写进 store、再读回来" —— 试算与真写入走的是同一条 `applyOperation`，
     * 结果一致，但不会在中途留下一条撤销记录。
     */
    const primary: DomainOperation = action.kind === "translate"
      ? { op: "translatePrimitive", id, delta: action.delta }
      : { op: "updatePrimitive", id, patch: action.patch }
    const probe = commitPatch(document, primary)
    const moved = probe.document.primitives.find((primitive) => primitive.id === id)
    const before = document.primitives.find((primitive) => primitive.id === id)
    const zeroDelta = action.kind === "translate" && action.delta.x === 0 && action.delta.y === 0
    if (!probe.changed || moved?.type !== "point" || before?.type !== "point" || zeroDelta) {
      apply(primary)
      return
    }
    const delta = { x: moved.x - before.x, y: moved.y - before.y }
    if (delta.x === 0 && delta.y === 0) {
      apply(primary)
      return
    }
    const followers = probe.document.primitives.flatMap((primitive) => {
      if (primitive.type !== "circle" && primitive.type !== "ellipse") return []
      const placement = primitive.rotationAbout
      return placement?.pivot.kind === "primitive" && placement.pivot.primitiveId === id ? [{ curve: primitive, placement }] : []
    })
    if (followers.length === 0) {
      apply(primary)
      return
    }
    applyBatch([
      primary,
      ...followers.map(({ curve, placement }) => ({
        op: "updatePrimitive" as const,
        id: curve.id,
        patch: {
          center: { x: curve.center.x + delta.x, y: curve.center.y + delta.y },
          rotationAbout: {
            ...placement,
            baseCenter: { x: placement.baseCenter.x + delta.x, y: placement.baseCenter.y + delta.y }
          }
        }
      }))
    ])
  }

  const { deleteSelected, addLayer, deleteLayer } = createStructureCommands({ document, selectedIds, apply, applyBatch, setSelectedIds, setFileError, expandedIds, setExpandedIds })

  /** The active layer must be visible and unlocked before a drafting command may commit new geometry. */
  const { createMovingCircle, anchorRotation } = createAnchorRotationCommands({ document, selectedPrimitive, rotationAnchor, apply, applyBatch, setFileError, setPendingSelection: (id) => { pendingSelectionRef.current = id } })

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

  /**
   * 命令分发（CAD 那一张表 + 功能区那一张表 + 换 CAD 模式）在 `./commandDispatch`：
   * 它只收 handler 与 setter，不认识 store 也不认识 React，所以能直接喂替身验。
   */
  const { runRibbonCommand, handleCadModeChange } = createCommandDispatch({
    document, selectedIds, cadMode, cadActiveLayerBlockedReason, engineeringDrawings, apply,
    setActiveCommand, setLayerNotice, setCreationStep, setSelectedIds, setShowProjectionDiagnostics, setCadMode,
    addPoint3, addLine3, addPlane3, addFace3, addCircle3Track, addPoint, startCreation,
    deleteSelected, toggleLock, createGroup, addEngineeringAnnotation,
    addDefaultPrimitive, addDefaultCube, addDefaultSolid, addTetrahedron, addSection, anchorRotation,
    exportSvgFile, exportCsvFile, exportPngFile, save
  })

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

  /**
   * 键盘快捷键（Esc 分级 / Delete / 撤销重做）在 `./useKeyboardShortcuts`：
   * 搬动时顺手修掉两处依赖问题（多余的 `document`、漏掉的 `deleteSelected`），见那个文件的头注释。
   */
  useKeyboardShortcuts({ creationStep, activeCommand, guidance, selectedIds, undo, redo, deleteSelected, setCreationStep, setActiveCommand, setGuidance, setSelectedIds })

  // 优先级：创建步骤 > 3D 显示开关提示（法向量/二面角示例）> 交线预览 > 默认选择提示。
  // 显示开关是用户刚刚按下按钮触发的，必须盖过"选择带来的预览"，否则状态栏会像没反应。
  const statusPrompt = deriveCanvasStatusPrompt({ document, selectedIds, selectedPrimitive, creationMode, creationStep, sceneControl, previewStatus, hovering: hoveredPreview !== null, scenePreviews, previewSweep, canAnchorRotation })

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

