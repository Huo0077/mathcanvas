import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import type { GeometryDocument, IntersectionFacePrimitive, IntersectionPoint3Primitive, IntersectionSolidPrimitive, Plane3Primitive, Point3Primitive, Polyhedron3Primitive, SectionPrimitive, Vector3 } from "@draw/dsl"
import { dihedralAngleDegrees, host3FromPrimitive, unfoldPolyhedron3, type Host3, type Host3Parameter } from "@draw/geometry-kernel"
import { solidVolumeHostFor } from "@draw/scene-graph"
import { resolveMeasurementVisual } from "./measurementVisuals"
import { syncOverlay } from "./overlaySync"
import type { SceneControlMode } from "./statusPrompts"
import { isFreeDraggable3, planeThroughPoints, resolveDihedralMarker3, resolvePolyhedronTopology, sectionSourceVertices, templateTopologyIds } from "@draw/scene-graph"

import { loadViewPreference3d, saveViewPreference3d } from "./persistence/draftStorage"
import { GRID_MAJOR_EVERY, GRID_MIN_RADIUS, gridPlacement } from "./sceneGrid"
import { buildGridGeometry, GRID_MAJOR_COLOR, GRID_MINOR_COLOR, gridLayerOpacity } from "./threeGrid"
import { sceneContentKey, sceneSyncDecision } from "./sceneContentKey"
import { createContentSigner } from "./sceneContentSignature"
import { applyCameraState, boxCorners, clampCameraTarget, contentBounds, contentRadiusExcluding, createCameraState, FIT_ANIMATION_MS, fitCameraState, interpolateCameraState, isContentOutOfView, panCameraState, resetCameraState, rotateCameraState, shouldAutoFit, zoomCameraState, type CameraState } from "./threeCamera"
import { loadRememberedCamera, rememberCamera } from "./cameraMemory"
import type { ThreeScenePreview } from "./threeScenePreview"

import { dragWorldPoint, dragFamilyIds, offsetSceneObjects, applyDragOffsets } from "./threeDrag"
import { PICK_TOLERANCE_PX, pointHandleWorldRadius, pickRaycastHit3, templateTopologyOwners, pickSectionAt, resolveSelectableHit, previewBeatsPick } from "./threePicking"
import { sectionUnitNormal, createPlane3Mesh, createSectionMesh, createIntersectionSolidGroup, createIntersectionFaceGroup, createIntersectionPointGroup, createUnfoldNetGroup, createDihedralMarkerGroup, prefersReducedMotion, nextUnfoldProgress, createPlanePatch, createSolidGroup, visibleSolids, buildPointDrivenObject, disposeObject, disposeScene, createPreviewGroup, applyPreviewHighlight, hasDrawablePreview } from "./threePrimitives"

const scenePalette = {
  background: "#fbfcff",
  grid: "#d9deea"
} as const

/** Pointer bookkeeping for one press; lives at component scope so a scene rebuild cannot end a drag. */
interface PointerState {
  pointerId: number
  x: number
  y: number
  lastX: number
  lastY: number
  button: number
  moved: boolean
  shiftKey: boolean
}

/**
 * 一次自由拖动。拖动期间文档完全不提交，只把位移按帧画到场景里的对象上；抬手时才提交唯一一次操作。
 * 这正是"一次拖动 = 一步撤销"的保证：中途每提交一次，撤销栈里就多一步，用户要按好几次 Ctrl+Z 才能回到原状
 * （实测：一次 90px 的拖动会留下 4 步）。`total` 是这次拖动的总位移，`applied` 表示画面已经动过。
 */
interface DragSessionState {
  targetId: string
  family: Set<string>
  anchor: THREE.Vector3
  origin: THREE.Vector3
  /** 这次拖动的世界位移（截面时已投影到法向）。 */
  total: THREE.Vector3
  /** 已经画进场景的那一段，用来算增量，避免重复叠加。 */
  visualApplied: THREE.Vector3
  applied: boolean
  /** 拖动截面时：把屏幕位移投影到该法向上，得到剖切面要走的世界距离。 */
  slideNormal?: THREE.Vector3
  /**
   * 拖动**绑定点**时：宿主约束（evaluate / closestParameter / residual）、它的下游对象 id，
   * 以及这次拖动最新的宿主参数。参数是唯一真值——每帧只更新参数与受影响对象，抬手才提交文档。
   */
  hostConstraint?: Host3
  hostDependents?: string[]
  hostParameter?: Host3Parameter
}

export interface ThreeSceneViewProps {  document: GeometryDocument
  selectedIds: string[]
  onSelect: (id: string | null, additive?: boolean) => void
  /** Reports which display switch is on so the shell can explain what it draws; null when both are off. */
  onStatusPromptChange?: (sceneControl: SceneControlMode | null) => void
  /**
   * 画布上要画的全部预览（自动交线 / 交面 / 截面）。每一份由 `key` 标识，
   * 场景按 key 增量同步：只重建变了的那一份，其余原样沿用。
   */
  previews?: ThreeScenePreview[]
  onPreviewHover?: (hovering: boolean, preview: ThreeScenePreview) => void
  /** 指针正落在某一份预览上时点击：交给 App 创建那一个图元，而不是重新选择来源对象。 */
  onPreviewClick?: (preview: ThreeScenePreview) => void
  /** 拖动结束时上报这次拖动的总位移（屏幕平面内的世界向量）。只在抬手时回调一次：拖动期间文档不提交，
   * 这样一次拖动就是一步撤销。拖动过程中的画面由场景自己按帧平移，不经过文档。 */
  onDragEnd?: (id: string, delta: Vector3) => void
  /** 选中截面时，把拖动/键盘微调解释为"沿法向平移剖切面"的世界距离。 */
  onMoveSection?: (id: string, distance: number) => void
  /** 拖动绑定点结束：提交宿主参数（点 / 面 / 曲面的自然参数）。 */
  onHostDragEnd?: (pointId: string, parameter: Host3Parameter) => void
  /** 开启"以面为剖切面"后，点到的那个面就成为截面 `<id>` 的剖切面。 */
  onPickSectionFace?: (id: string, plane: { normal: Vector3; constant: number }) => void
}

export function ThreeSceneView({ document, selectedIds, onSelect, onStatusPromptChange, previews = [], onPreviewHover, onPreviewClick, onDragEnd, onMoveSection, onHostDragEnd, onPickSectionFace }: ThreeSceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const renderTargetRef = useRef<HTMLDivElement>(null)
  const measurementOverlayRef = useRef<HTMLDivElement>(null)
  const pointLabelOverlayRef = useRef<HTMLDivElement>(null)
  /**
   * 相机状态：优先用"上次离开这个文档时的视角"（见 `cameraMemory.ts`）。
   * 组件是随工作区卸载重建的，不记的话切到平面几何再回来就回到默认视角。
   */
  const cameraStateRef = useRef<CameraState>(loadRememberedCamera(document.metadata.id) ?? createCameraState())
  const resetCameraRef = useRef<() => void>(() => undefined)
  const fitCameraRef = useRef<() => void>(() => undefined)
  const fittedDocumentRef = useRef<string | null>(null)
  const panModeRef = useRef(false)
  const dragModeRef = useRef(false)
  const pointerStateRef = useRef<PointerState | null>(null)
  const dragSessionRef = useRef<DragSessionState | null>(null)
  /** The selection the rebuilt scene must highlight; the pointer handlers read it without re-subscribing. */
  const selectedIdsRef = useRef<string[]>(selectedIds)
  selectedIdsRef.current = selectedIds
  /** The drag callback, read through a ref so a parent re-render never restarts the scene. */
  const dragEndRef = useRef(onDragEnd)
  dragEndRef.current = onDragEnd
  /**
   * 指针落在哪一份预览上（key）。点击时要**按点击位置重新判定**，这个 ref 只用于画高亮与状态栏；
   * 高亮是就地改材质，不进内容签名——否则每次悬停都要重建一遍场景内容。
   */
  const previewHoverKeyRef = useRef<string | null>(null)
  /** 移动剖切面（沿法向的世界位移），与拖动回调解耦，方便键盘微调共用。 */
  const moveSectionRef = useRef(onMoveSection)
  moveSectionRef.current = onMoveSection
  /** 拖动绑定点结束：提交宿主参数（点/面/曲面的自然参数）。 */
  const hostDragEndRef = useRef(onHostDragEnd)
  hostDragEndRef.current = onHostDragEnd
  /** 以面为剖切面的回调，以及"正在等待拾取"的开关。 */
  const pickSectionFaceRef = useRef(onPickSectionFace)
  pickSectionFaceRef.current = onPickSectionFace
  /** 键盘微调用：当前的文档与选择，避免把 keydown 监听器绑在频繁变化的值上。 */
  const documentRef = useRef(document)
  documentRef.current = document
  /**
   * 把进行中的拖动偏移补画到当前场景上。拖动途中场景会被重建（选中变化、窗口尺寸变化都会重建），
   * 新场景的对象回到文档里的位置，已经"画上去"的偏移就丢了 —— 观感是一次回弹/闪跳。
   * 由场景构建流程在 render 之后调用；也用于拖动自身的逐帧重画。
   */
  const resumeDragVisualRef = useRef<() => void>(() => undefined)
  const [showHiddenEdges, setShowHiddenEdges] = useState(false)
  const [showNormals, setShowNormals] = useState(false)
  const [transparentFaces, setTransparentFaces] = useState(false)
  const [unfolded, setUnfolded] = useState(false)
  const [unfoldProgress, setUnfoldProgress] = useState(0)
  const [showAngle, setShowAngle] = useState(false)
  const [panMode, setPanMode] = useState(false)
  const [dragMode, setDragMode] = useState(false)
  /** 「以面为剖切面」的一次性拾取模式：开启后下一次点击面即取该面为剖切面。 */
  const [facePickMode, setFacePickMode] = useState(false)
  const facePickModeRef = useRef(false)
  facePickModeRef.current = facePickMode
  const [webglAvailable, setWebglAvailable] = useState(true)
  const statusPromptChangeRef = useRef(onStatusPromptChange)
  statusPromptChangeRef.current = onStatusPromptChange
  const previewHoverRef = useRef(onPreviewHover)
  previewHoverRef.current = onPreviewHover
  /**
   * 场景内容的输入：文档 / 选择 / 显示开关 / 预览 / 选中回调。
   * 挂载效应只读这些 ref，因此父组件重渲染不会再重建渲染器（见下面的挂载效应说明）。
   */
  const previewsRef = useRef(previews)
  previewsRef.current = previews
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  /**
   * 预览点击回调也必须走 ref：App 里的实现闭包着它自己那份 `document`，
   * 直接调用首次渲染的函数会拿到空文档，点击虚线预览将什么都不创建（实测回归）。
   */
  const previewClickRef = useRef(onPreviewClick)
  previewClickRef.current = onPreviewClick
  const displayFlagsRef = useRef({ showHiddenEdges, showNormals, transparentFaces, unfoldProgress })
  displayFlagsRef.current = { showHiddenEdges, showNormals, transparentFaces, unfoldProgress }
  /** 场景运行时：挂载时创建一次，之后所有内容同步都走它。 */
  const runtimeRef = useRef<{ syncContent: () => void } | null>(null)
  /** 内容同步签名：同一个签名不重复同步（见 sceneContentKey）。 */
  const contentKeyRef = useRef<string | null>(null)
  /** 回归读数：本次挂载创建渲染器的次数（恒为 1）与内容同步次数。 */
  const sceneBuildsRef = useRef(0)
  const sceneSyncsRef = useRef(0)
  /** 自动取景：开关、用户是否动过相机（动过就不再抢视角）、已自动取景的次数、上一次的内容 AABB。 */
  const [autoFit, setAutoFit] = useState(() => loadViewPreference3d().autoFit)
  const autoFitRef = useRef(autoFit)
  autoFitRef.current = autoFit
  const cameraFitRef = useRef(0)
  /** 重新打开「自动取景」时立刻拟合一次。 */
  const fitWithoutTouchRef = useRef<() => void>(() => undefined)
  /**
   * Which display switch was toggled last. Both can be on at once, so the shell's hint follows the most recent
   * user action instead of a hard-coded priority; toggling the last one off clears the hint.
   */
  const lastControlRef = useRef<SceneControlMode | null>(null)

  const toggleNormals = () => {
    const next = !showNormals
    lastControlRef.current = next ? "normals" : lastControlRef.current === "normals" ? null : lastControlRef.current
    setShowNormals(next)
    statusPromptChangeRef.current?.(lastControlRef.current)
  }
  const toggleAngleDemo = () => {
    const next = !showAngle
    lastControlRef.current = next ? "dihedral-demo" : lastControlRef.current === "dihedral-demo" ? null : lastControlRef.current
    setShowAngle(next)
    statusPromptChangeRef.current?.(lastControlRef.current)
  }

  useEffect(() => () => statusPromptChangeRef.current?.(null), [])

  // A ref keeps the pointer handler current without rebuilding the whole scene on every mode toggle.
  useEffect(() => {
    panModeRef.current = panMode
  }, [panMode])

  useEffect(() => {
    dragModeRef.current = dragMode
  }, [dragMode])

  /** 两个模式互斥：同时开着的话，左键拖动到底算平移视角还是拖图形就说不清了。 */
  const enterMode = (mode: "pan" | "drag") => {
    const nextPan = mode === "pan" ? !panMode : false
    const nextDrag = mode === "drag" ? !dragMode : false
    setPanMode(nextPan)
    setDragMode(nextDrag)
    lastControlRef.current = nextDrag ? "free-drag" : lastControlRef.current === "free-drag" ? null : lastControlRef.current
    statusPromptChangeRef.current?.(lastControlRef.current)
  }

  useEffect(() => {
    const target = unfolded ? 1 : 0
    if (prefersReducedMotion()) {
      setUnfoldProgress(target)
      return
    }
    let frame = 0
    const animate = () => {
      setUnfoldProgress((current) => {
        const next = nextUnfoldProgress(current, target)
        if (next !== target) frame = requestAnimationFrame(animate)
        return next
      })
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [unfolded])

  useEffect(() => {
    const container = renderTargetRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(scenePalette.background)
    // The shell owns the viewport height, so measure it exactly: clamping here would desync the drawing
    // buffer from the CSS box and stretch the projection.
    const viewportSize = () => ({ width: Math.max(container.clientWidth, 1), height: Math.max(container.clientHeight, 1) })
    const { width, height } = viewportSize()
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000)
    applyCameraState(camera, cameraStateRef.current)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setWebglAvailable(false)
      return
    }
    setWebglAvailable(true)
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)
    renderer.domElement.setAttribute("role", "img")
    renderer.domElement.setAttribute("aria-label", "3D 几何画布")
    renderer.domElement.dataset.sceneCanvas = "true"
    container.replaceChildren(renderer.domElement)
    const sceneShell = containerRef.current
    sceneBuildsRef.current += 1
    if (sceneShell) {
      sceneShell.dataset.sceneBuilds = String(sceneBuildsRef.current)
      sceneShell.dataset.sceneSyncs = String(sceneSyncsRef.current)
    }

    scene.add(new THREE.AmbientLight("#ffffff", 1.7))
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.4)
    keyLight.position.set(6, 10, 8)
    scene.add(keyLight)

    /**
     * 场景内容：每次同步先释放再重建，但**渲染器与 canvas 不再重建**。
     *
     * 这段代码过去直接写在效应体内，而效应依赖含 `document` 与每次渲染都换身份的 `onSelect`，
     * 于是任何一次父组件重渲染（悬停、提示、错误、展开动画的每一帧）都会
     * `renderer.dispose()` + `new THREE.WebGLRenderer()` 并换掉 canvas —— 既是性能灾难
     * （浏览器 WebGL 上下文数量有限），也让相机动画与拖动预览随时被打断。
     *
     * 说明：下面整段保持原有缩进以便与历史实现逐行对照，逻辑上它在 `syncContent()` 内部。
     */
    /**
     * 内容对象的记录表：key → { 对象, 签名 }。
     *
     * 以前这里是 `contentObjects: Object3D[]` + `clearContent()`：每次同步全清全建。
     * 现在按签名增量（`sceneContentPlan.ts` 定的规则）：签名没变就**沿用原对象**，
     * 只重建真的变了的那几个。展开动画过去每帧重建整场（内容签名里带 `unfoldProgress`），
     * 现在每帧只重建那张展开网。
     */
    const contentRecords = new Map<string, { object: THREE.Object3D; signature: string }>()    /** 本次同步的重建/沿用/释放计数，写成 `data-scene-*` 读数（e2e 与排查都读它）。 */
    let syncCounts = { created: 0, reused: 0, removed: 0 }
    /** 本次同步重建了哪些 key：排查"为什么这个对象被重建了"时，比只数个数有用得多。 */
    let createdKeys: string[] = []

    /** 同步时刷新的闭包变量：render() 与指针处理函数都读它们。 */
    let pointHandles: THREE.Mesh[] = []
    let visiblePointLabels: Point3Primitive[] = []
    let measurementVisuals: NonNullable<ReturnType<typeof resolveMeasurementVisual>>[] = []
    let previewGroups = new Map<string, THREE.Group>()
    /** 本轮同步活着的预览：key → 预览内容（命中判定与状态栏都用它，避免每次线性查找）。 */
    let previewByKey = new Map<string, ThreeScenePreview>()
    let sceneBounds = new THREE.Box3()
    /** 空间点索引与"模板子元素归属模板实体"的映射：指针处理函数要用，必须随同步一起刷新。 */
    let points = new Map<string, Point3Primitive>()
    let topologyOwners = new Map<string, string>()
    /** 背景坐标系：单位尺寸的栅格与坐标轴，真实大小与位置每帧按可见范围设置。 */
    let gridHelper: THREE.LineSegments | null = null
    let gridMajorHelper: THREE.LineSegments | null = null
    /** 当前栅格几何的覆盖半径（格数）：只有跨档才换几何，缩放过程中不动。 */
    let gridRadius = 0
    let axesHelper: THREE.AxesHelper | null = null
    /** 点驱动对象的索引：拖动绑定点时按 id 就地重建受影响的那些。 */
    let objectIndex = new Map<string, THREE.Object3D>()

    const currentContentKey = () => sceneContentKey({
      document: documentRef.current,
      selectedIds: selectedIdsRef.current,
      ...displayFlagsRef.current,
      // 预览由文档与选择派生，这里只把"有哪些预览"写进签名，便于排查"为什么内容没同步"。
      previewKeys: previewsRef.current.map((item) => `${item.key}:${item.kind}`).join("|")
    })

    /**
     * 取一个内容对象：签名没变就沿用原来的（连场景图里的位置都不动），否则重建它。
     * `build` 是惰性的——沿用的时候**不许**构造，否则省下的只是内存拷贝、白算的还是白算。
     */
    const keepContent = (key: string, signature: string, build: () => THREE.Object3D | null, alive: Set<string>, order: string[]): THREE.Object3D | null => {
      alive.add(key)
      if (!order.includes(key)) order.push(key)
      const previous = contentRecords.get(key)
      if (previous && previous.signature === signature) {
        syncCounts.reused += 1
        return previous.object
      }
      if (previous) {
        scene.remove(previous.object)
        disposeObject(previous.object)
        contentRecords.delete(key)
      }
      const object = build()
      if (!object) {
        // 这次没有这个对象（例如平面片退化）：算作释放，别把它记成"重建了一个"。
        if (previous) syncCounts.removed += 1
        return null
      }
      syncCounts.created += 1
      createdKeys.push(key)
      scene.add(object)
      contentRecords.set(key, { object, signature })
      return object
    }

    const syncContent = () => {
    sceneSyncsRef.current += 1
    /**
     * 本次同步"活着"的 key（`alive`）与它们在场景里的顺序（`order`）。
     *
     * 两者刻意分开：顺序只能由"实际构造的顺序"决定，而 `alive` 需要**提前**把
     * 平面片 / 预览 / 背景坐标系这些"后面才加进来"的 key 登记进去——否则释放过期对象时
     * 会把它们当成过期删掉、这一轮再重建一次（实测：每次同步都重建栅格与坐标轴）。
     */
    const alive = new Set<string>()
    const order: string[] = []
    syncCounts = { created: 0, reused: 0, removed: 0 }
    createdKeys = []
    pointHandles = []
    visiblePointLabels = []
    measurementVisuals = []
    previewGroups = new Map<string, THREE.Group>()
    previewByKey = new Map<string, ThreeScenePreview>()
    objectIndex = new Map<string, THREE.Object3D>()
    if (sceneShell) sceneShell.dataset.sceneSyncs = String(sceneSyncsRef.current)
    const document = documentRef.current
    const selectedIds = selectedIdsRef.current
    const { showHiddenEdges, showNormals, transparentFaces, unfoldProgress } = displayFlagsRef.current
    const signer = createContentSigner(document)
    points = new Map(document.primitives.filter((primitive): primitive is Point3Primitive => primitive.type === "point3").map((primitive) => [primitive.id, primitive]))
    topologyOwners = templateTopologyOwners(document)

    const unfoldedPolyhedra = unfoldProgress > 0.001
      ? document.primitives.filter((primitive): primitive is Polyhedron3Primitive => primitive.type === "polyhedron3" && primitive.visible !== false)
      : []
    const unfoldedChildIds = new Set(unfoldedPolyhedra.flatMap((polyhedron) => [...polyhedron.edgeIds, ...polyhedron.faceIds]))
    document.primitives.filter((primitive) => primitive.visible !== false).forEach((primitive) => {
      if (unfoldedChildIds.has(primitive.id)) return
      const selected = selectedIds.includes(primitive.id)
      const object = keepContent(`point:${primitive.id}`, signer.of(primitive.id, `sel:${selected}`), () => buildPointDrivenObject(primitive, points, selected), alive, order)
      if (!object) return
      if (primitive.type === "point3") pointHandles.push(object as THREE.Mesh)
      objectIndex.set(primitive.id, object)
    })

    visibleSolids(document).forEach((primitive) => {
      const selected = selectedIds.includes(primitive.id)
      const flags = `sel:${selected};hidden:${showHiddenEdges};normals:${showNormals};transparent:${transparentFaces};unfold:${unfoldProgress > 0.001 ? unfoldProgress.toFixed(4) : "0"}`
      keepContent(`solid:${primitive.id}`, signer.of(primitive.id, flags), () => createSolidGroup(primitive, selected, { showHiddenEdges, showNormals, transparentFaces, unfoldProgress }), alive, order)
    })
    document.primitives.filter((primitive): primitive is SectionPrimitive => primitive.type === "section" && primitive.visible !== false).forEach((primitive) => {
      const selected = selectedIds.includes(primitive.id)
      // 面片尺寸取自来源实体的**物化拓扑**：拓扑变了面片也得跟着重算，所以把拓扑签名一并带上。
      const topology = signer.topologyOf(primitive.sourceId)
      const mesh = keepContent(`section:${primitive.id}`, signer.of(primitive.id, `topo:${topology}`), () => createSectionMesh(primitive), alive, order)
      if (!mesh) return
      // 选中截面时把剖切面本身也画出来：只看到一圈交线的话，"刀口在哪、往哪边挪"都无从判断。
      if (!selected) return
      keepContent(`section-plane:${primitive.id}`, signer.of(primitive.id, `plane;topo:${topology}`), () => {
        const patch = createPlanePatch(primitive.plane, sectionSourceVertices(document, primitive.sourceId), { color: "#f97316", opacity: 0.1 })
        if (!patch) return null
        // 剖切面片只是"刀口在哪"的指示物，不能参与拾取：它又大又正对相机，否则点击/拖动都会命中它
        // 而不是截面本身（实测：拖它会平移面片，截面却没动）。
        patch.traverse((child) => { child.raycast = () => undefined })
        patch.userData.visualRole = "section-plane"
        return patch
      }, alive, order)
    })
    // 已持久化的截线：虚线，与"预览"用同一种视觉语言，但颜色更深、实心可选中。
    document.primitives.filter((primitive) => primitive.type === "intersectionLine" && primitive.visible !== false).forEach((primitive) => {
      if (primitive.type !== "intersectionLine") return
      keepContent(`intersection-line:${primitive.id}`, signer.of(primitive.id), () => {
        const points = primitive.segments.flatMap((segment) => [new THREE.Vector3(segment.a.x, segment.a.y, segment.a.z), new THREE.Vector3(segment.b.x, segment.b.y, segment.b.z)])
        if (points.length < 2) return null
        const line = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: primitive.style?.stroke ?? "#dc2626", dashSize: 0.3, gapSize: 0.2 }))
        line.computeLineDistances()
        line.userData.primitiveId = primitive.id
        line.userData.primitiveType = primitive.type
        line.userData.visualRole = "intersection-line"
        return line
      }, alive, order)
    })
    // 已创建的交面：**一个**平面面片（填色可改）；已创建的交点：交线的拐点。
    document.primitives.filter((primitive): primitive is IntersectionFacePrimitive => primitive.type === "intersectionFace" && primitive.visible !== false).forEach((primitive) => {
      keepContent(`intersection-face:${primitive.id}`, signer.of(primitive.id, `sel:${selectedIds.includes(primitive.id)}`), () => createIntersectionFaceGroup(primitive, selectedIds.includes(primitive.id)), alive, order)
    })
    document.primitives.filter((primitive): primitive is IntersectionPoint3Primitive => primitive.type === "intersectionPoint3" && primitive.visible !== false).forEach((primitive) => {
      const marker = keepContent(`intersection-point:${primitive.id}`, signer.of(primitive.id, `sel:${selectedIds.includes(primitive.id)}`), () => createIntersectionPointGroup(primitive, selectedIds.includes(primitive.id)), alive, order)
      // 与空间点手柄一起按屏幕尺寸缩放：远看近看都一样大、都好点。
      if (marker instanceof THREE.Mesh) pointHandles.push(marker)
    })
    // 已创建的交面（整体）：布尔交集的多面体表面（旧文档里可能存在，仍然要画得出来）。
    document.primitives.filter((primitive): primitive is IntersectionSolidPrimitive => primitive.type === "intersectionSolid" && primitive.visible !== false).forEach((primitive) => {
      keepContent(`intersection-solid:${primitive.id}`, signer.of(primitive.id, `sel:${selectedIds.includes(primitive.id)}`), () => createIntersectionSolidGroup(primitive, selectedIds.includes(primitive.id)), alive, order)
    })
    let unfoldFaceCount = 0
    unfoldedPolyhedra.forEach((polyhedron) => {
      const topology = resolvePolyhedronTopology(document, polyhedron.id)
      if (!topology) return
      const layout = unfoldPolyhedron3(topology.vertices, topology.faces, unfoldProgress, topology.rootFaceId)
      if (layout.status !== "ok") return
      keepContent(`unfold:${polyhedron.id}`, signer.of(polyhedron.id, `unfold:${unfoldProgress.toFixed(4)};sel:${selectedIds.includes(polyhedron.id)}`), () => createUnfoldNetGroup(polyhedron.id, layout, selectedIds.includes(polyhedron.id)), alive, order)
      unfoldFaceCount += layout.faces.length
    })
    // 3D point labels: an HTML overlay above the canvas, so the classroom names A/B/C stay readable at any zoom.
    // The overlay never receives pointer events, so picking still goes through the renderer.
    visiblePointLabels = document.primitives.filter((primitive): primitive is Point3Primitive => primitive.type === "point3" && primitive.visible !== false)
    let dihedralMarkerCount = 0
    let planeCount = 0
    document.measurements
      .filter((measurement) => measurement.metric === "dihedral" && measurement.status === "valid" && measurement.sourceIds.some((id) => selectedIds.includes(id)))
      .forEach((measurement) => {
        const marker = resolveDihedralMarker3(document, measurement.id)
        if (!marker) return
        const allSelected = measurement.sourceIds.every((id) => selectedIds.includes(id))
        keepContent(`dihedral:${measurement.id}`, signer.ofReferences(measurement.sourceIds, `dihedral:${JSON.stringify(measurement)};sel:${allSelected}`), () => createDihedralMarkerGroup(marker, allSelected), alive, order)
        dihedralMarkerCount += 1
      })
    measurementVisuals = document.measurements
      .filter((measurement) => measurement.sourceIds.some((id) => selectedIds.includes(id)))
      .map((measurement) => resolveMeasurementVisual(document, measurement.id))
      .filter((visual): visual is NonNullable<ReturnType<typeof resolveMeasurementVisual>> => Boolean(visual))
    measurementVisuals.filter((visual) => visual.kind === "label").forEach((visual) => {
      const measurement = document.measurements.find((candidate) => candidate.id === visual.id)
      const signature = signer.ofReferences(measurement?.sourceIds ?? [], `visual:${JSON.stringify(visual)}`)
      visual.segments.forEach((segment, index) => {
        keepContent(`measurement-helper:${visual.id}:${index}`, signature, () => {
          const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(segment.start.x, segment.start.y, segment.start.z), new THREE.Vector3(segment.end.x, segment.end.y, segment.end.z)])
          const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: "#604fda", transparent: true, opacity: 0.75 }))
          line.userData.measurementId = visual.id
          line.userData.visualRole = "measurement-helper"
          return line
        }, alive, order)
      })
    })
    /**
     * 先登记"后面几个阶段才会加进来"的 key，再释放过期对象。
     *
     * 顺序很关键：沿用的对象还留在场景里，而"上一份文档"的残留对象如果拖到后面才释放，
     * 就会参与 `contentBounds` 的计算——实测打开新文件时相机取景会偏（target 0.48 而不是 0.50）。
     * 但平面片 / 预览 / 背景坐标系要到下面几步才加进来，不先登记就会被误删再重建
     *（实测：每次同步都重建栅格与坐标轴）。
     */
    alive.add("static:grid")
    alive.add("static:grid-major")
    alive.add("static:axes")
    for (const item of previewsRef.current) {
      if (hasDrawablePreview(item)) alive.add(`preview:${item.key}`)
    }
    for (const primitive of document.primitives) {
      if (primitive.type === "plane3" && primitive.visible !== false) alive.add(`plane:${primitive.id}`)
    }
    for (const [key, record] of contentRecords) {
      if (alive.has(key)) continue
      scene.remove(record.object)
      disposeObject(record.object)
      contentRecords.delete(key)
      syncCounts.removed += 1
    }
    // Planes are drawn last: their patch is sized from the figure they belong to, so the figure must exist first.
    /**
     * 先把手柄按屏幕尺寸缩放**再**算包围盒：手柄的世界半径取决于相机距离，而
     * 内容包围盒（相机取景）与面片自动尺寸都把它算在内。刚建出来的手柄还是初始尺寸，
     * 不先缩放就会在同一份内容上算出偏小的包围盒（实测：三点建平面 7.02 vs 7.11）。
     */
    syncPointHandleScales()
    // 面片尺寸要排除平面片自身：旧面片在"沿用"时还在场景里，算进去会自我膨胀
    //（实测：手动半边长恢复自动之后，7.02 变成了 36.21）。
    const contentRadius = contentRadiusExcluding(scene, [...contentRecords].filter(([key]) => key.startsWith("plane:")).map(([, record]) => record.object))
    const planeHalfSize = Math.max(Math.min(contentRadius * 1.6, 60), 1.2)
    document.primitives.filter((primitive): primitive is Plane3Primitive => primitive.type === "plane3" && primitive.visible !== false).forEach((primitive) => {
      const plane = keepContent(`plane:${primitive.id}`, signer.of(primitive.id, `sel:${selectedIds.includes(primitive.id)};half:${planeHalfSize.toFixed(3)}`), () => createPlane3Mesh(primitive, points, selectedIds.includes(primitive.id), planeHalfSize), alive, order)
      if (!plane) return
      planeCount += 1
    })
    /**
     * 预览层最后加入：盖在实体之上，但仍用虚线 / 半透明表达"还没创建"。
     * 每一份预览按自己的 key 增量同步——改了其中一个实体，只有与它相关的那几份重建。
     */
    const previews = previewsRef.current.filter(hasDrawablePreview)
    for (const item of previews) {
      const group = keepContent(`preview:${item.key}`, `kind:${item.kind};${JSON.stringify(item)}`, () => createPreviewGroup(item, previewHoverKeyRef.current === item.key, (hovering) => previewHoverRef.current?.(hovering, item)), alive, order)
      if (!group) continue
      previewGroups.set(item.key, group as THREE.Group)
      previewByKey.set(item.key, item)
    }
    // 悬停的那一份可能已经不存在了（来源被删 / 挪开）：清掉高亮状态，别让读数指向空气。
    if (previewHoverKeyRef.current && !previewGroups.has(previewHoverKeyRef.current)) previewHoverKeyRef.current = null
    if (sceneShell) {
      const focused = previews.find((item) => item.focused) ?? null
      sceneShell.dataset.intersectionPreview = focused ? focused.kind : "none"
      sceneShell.dataset.previewCount = String(previews.length)
      sceneShell.dataset.previewFaceCount = String(previews.filter((item) => item.kind === "face").length)
      sceneShell.dataset.previewPointCount = String(previews.filter((item) => item.kind === "point").length)
      sceneShell.dataset.previewLineCount = String(previews.filter((item) => item.kind === "intersection").length)
      sceneShell.dataset.previewKeys = previews.map((item) => item.key).join(",")
      sceneShell.dataset.previewHoverKey = previewHoverKeyRef.current ?? ""
      sceneShell.dataset.unfoldFaces = String(unfoldFaceCount)
      sceneShell.dataset.unfoldProgress = unfoldProgress.toFixed(2)
      sceneShell.dataset.dihedralMarkers = String(dihedralMarkerCount)
      sceneShell.dataset.planeCount = String(planeCount)
      sceneShell.dataset.measurementLabelCount = String(measurementVisuals.length)
      // 剖切面的读数：剖面有没有真的动、动到哪，靠这几个数看，不靠肉眼。
      const sections = document.primitives.filter((primitive): primitive is SectionPrimitive => primitive.type === "section")
      const firstSection = sections[0]
      sceneShell.dataset.sectionCount = String(sections.length)
      sceneShell.dataset.sectionPlaneConstant = firstSection ? firstSection.plane.constant.toFixed(3) : ""
      sceneShell.dataset.sectionPlaneNormal = firstSection ? `${firstSection.plane.normal.x.toFixed(3)},${firstSection.plane.normal.y.toFixed(3)},${firstSection.plane.normal.z.toFixed(3)}` : ""
      sceneShell.dataset.sectionPointCount = firstSection ? String(firstSection.points.length) : ""
    }

    sceneBounds = contentBounds(scene)
    if (sceneShell) {
      const size = sceneBounds.getSize(new THREE.Vector3())
      const centre = sceneBounds.getCenter(new THREE.Vector3())
      sceneShell.dataset.contentBounds = sceneBounds.isEmpty() ? "empty" : `${centre.x.toFixed(2)},${centre.y.toFixed(2)},${centre.z.toFixed(2)} size ${size.x.toFixed(2)},${size.y.toFixed(2)},${size.z.toFixed(2)}`
    }
    // Grid and axes follow the figure, but the grid's **cell is always one world unit**:
    // 用户要求"网格大小要严格对应一比一"，所以缩放的只是覆盖范围，不是格边长。
    /** 背景坐标系：1 单位细线 + 每 10 格主线；两者都只在覆盖半径跨档时换一份几何。 */
    gridHelper = keepContent("static:grid", "grid", () => {
      const grid = new THREE.LineSegments(
        buildGridGeometry(GRID_MIN_RADIUS, { skipMultiplesOf: GRID_MAJOR_EVERY }),
        new THREE.LineBasicMaterial({ color: GRID_MINOR_COLOR, transparent: true })
      )
      grid.userData.excludeFromFit = true
      return grid
    }, alive, order) as THREE.LineSegments | null
    gridMajorHelper = keepContent("static:grid-major", "grid-major", () => {
      const major = new THREE.LineSegments(
        buildGridGeometry(GRID_MIN_RADIUS, { every: GRID_MAJOR_EVERY }),
        new THREE.LineBasicMaterial({ color: GRID_MAJOR_COLOR, transparent: true })
      )
      major.userData.excludeFromFit = true
      return major
    }, alive, order) as THREE.LineSegments | null
    // AxesHelper already draws X/Y/Z along the world axes, so blue points up once Z is the vertical axis.
    axesHelper = keepContent("static:axes", "axes", () => {
      const axes = new THREE.AxesHelper(1)
      axes.userData.excludeFromFit = true
      return axes
    }, alive, order) as THREE.AxesHelper | null

    /**
     * 内容顺序必须跟着本次同步的顺序走：被沿用的对象还停在原来的位置，新对象却追加在末尾。
     * 顺序乱了会让透明面的叠加次序与同一射线上的命中排序跟着变，所以只在真的不一致时才重排。
     * 这里同时补一次过期对象的清理：上面"先登记后释放"是为包围盒服务的，
     * 若某个已登记的 key 最终没能构造出对象（例如平面片退化），它的旧记录要在这里收掉。
     */
    for (const [key, record] of contentRecords) {
      if (alive.has(key)) continue
      scene.remove(record.object)
      disposeObject(record.object)
      contentRecords.delete(key)
      syncCounts.removed += 1
    }
    const desired = order.flatMap((key) => {
      const record = contentRecords.get(key)
      return record ? [record.object] : []
    })
    const orderMatches = scene.children.length === desired.length && desired.every((object, index) => scene.children[index] === object)
    if (!orderMatches) {
      for (const object of desired) scene.remove(object)
      for (const object of desired) scene.add(object)
    }
    if (sceneShell) {
      sceneShell.dataset.sceneCreated = String(syncCounts.created)
      sceneShell.dataset.sceneReused = String(syncCounts.reused)
      sceneShell.dataset.sceneRemoved = String(syncCounts.removed)
      sceneShell.dataset.sceneContent = String(contentRecords.size)
      sceneShell.dataset.sceneCreatedKeys = createdKeys.join(",")
    }
    }

    /**
     * 只重建**一个**点驱动对象：拖动绑定点时用它让下游实时跟随。
     * 位置已经在 `points` 里按新参数写好，所以这里不需要重建整场、也不进撤销历史。
     * 走的是与整场同步同一张记录表，所以拖完之后的整场同步不会把它当成"没见过的对象"再建一次。
     */
    const refreshPrimitiveObject = (id: string) => {
      const primitive = documentRef.current.primitives.find((candidate) => candidate.id === id)
      if (!primitive) return
      const previous = objectIndex.get(id)
      const selected = selectedIdsRef.current.includes(id)
      const replacement = buildPointDrivenObject(primitive, points, selected)
      if (previous) {
        scene.remove(previous)
        disposeObject(previous)
        if (previous instanceof THREE.Mesh) pointHandles = pointHandles.filter((handle) => handle !== previous)
      }
      if (!replacement) {
        contentRecords.delete(`point:${id}`)
        objectIndex.delete(id)
        return
      }
      scene.add(replacement)
      contentRecords.set(`point:${id}`, { object: replacement, signature: createContentSigner(documentRef.current).of(id, `sel:${selected}`) })
      objectIndex.set(id, replacement)
      if (replacement instanceof THREE.Mesh && primitive.type === "point3") pointHandles.push(replacement)
    }

    let viewportHeight = height
    const syncPointHandleScales = () => {
      /**
       * 手柄的世界半径按**相机到视点中心的距离**统一取，而不是逐个手柄按各自深度取：
       * 逐个取深度会让近处手柄小、远处手柄大，于是内容包围盒变得**不对称**——
       * 而包围盒既驱动自动取景（中心就是相机的 target）又驱动平面片的自动尺寸，
       * 中心会因此偏掉（实测立方体自动取景后 target 是 -0.01,-0.01,-0.00 而不是 0,0,0）。
       * 统一取值同时还让"画出来的手柄"与"拾取容差"（下面 pickTolerance 用的是同一个量）一致。
       */
      const radius = pointHandleWorldRadius(camera, cameraStateRef.current.distance, viewportHeight)
      for (const handle of pointHandles) handle.scale.setScalar(radius)
    }
    /**
     * 首次内容同步放在这里（而不是 `syncContent` 定义之后立刻调用）：同步里要用到
     * `syncPointHandleScales` 把点手柄先按屏幕尺寸缩放，再算内容包围盒与面片尺寸——
     * 否则"刚建出来的手柄"还是初始尺寸，同一份内容会算出一个偏小的包围盒
     *（实测：三点建平面时自动半边长 7.02，而下一次同步同样内容算出 7.11）。
     */
    syncContent()

    /**
     * 栅格与坐标轴按当前相机与内容自动铺满可见范围。
     * 旧实现是"固定 14 格、以原点为中心、只按内容对角线取整"，于是内容离原点一远
     * （用户报告：点的坐标到 20 左右）就落在坐标面之外的空白里。
     */
    const applyGridPlacement = () => {
      if (!gridHelper && !axesHelper) return
      const state = cameraStateRef.current
      const span = sceneBounds.isEmpty() ? 0 : sceneBounds.getSize(new THREE.Vector3()).length()
      const reach = sceneBounds.isEmpty() ? 0 : Math.max(...boxCorners(sceneBounds).map((corner) => Math.hypot(corner.x, corner.y)))
      const placement = gridPlacement({
        distance: state.distance,
        fovDegrees: camera.fov,
        aspect: camera.aspect,
        target: state.target,
        contentSpan: span,
        contentReach: reach
      })
      /**
       * 1 格 = 1 单位：几何本身按整数格建好，所以这里**只在覆盖半径跨档时**换一份几何。
       * 同一档内缩放，栅格的位置与尺寸都不动——这正是用户要的"缩放不改变网格大小"。
       */
      if (placement.extent !== gridRadius) {
        gridRadius = placement.extent
        for (const [layer, options] of [[gridHelper, { skipMultiplesOf: placement.majorEvery }], [gridMajorHelper, { every: placement.majorEvery }]] as const) {
          if (!layer) continue
          layer.geometry.dispose()
          layer.geometry = buildGridGeometry(placement.extent, options)
        }
      }
      // 一格在屏幕上占多少像素：细线太密时淡出，主线在更远时才淡出，间距仍然是精确的 10 个单位。
      const pixelsPerUnit = viewportHeight / (2 * Math.max(state.distance, 1e-4) * Math.tan((camera.fov * Math.PI) / 360))
      if (gridHelper) {
        gridHelper.position.set(placement.centre.x, placement.centre.y, 0)
        ;(gridHelper.material as THREE.LineBasicMaterial).opacity = gridLayerOpacity(pixelsPerUnit)
      }
      if (gridMajorHelper) {
        gridMajorHelper.position.set(placement.centre.x, placement.centre.y, 0)
        ;(gridMajorHelper.material as THREE.LineBasicMaterial).opacity = gridLayerOpacity(pixelsPerUnit * placement.majorEvery)
      }
      if (axesHelper) {
        axesHelper.scale.setScalar(placement.axesLength)
        axesHelper.position.set(placement.centre.x, placement.centre.y, 0)
      }
      if (sceneShell) {
        sceneShell.dataset.gridCell = String(placement.cell)
        sceneShell.dataset.gridMajor = String(placement.majorEvery)
        sceneShell.dataset.gridCentre = `${placement.centre.x},${placement.centre.y}`
        sceneShell.dataset.gridExtent = String(placement.extent)
        sceneShell.dataset.axesLength = String(placement.axesLength)
      }
    }
    const render = () => {
      syncPointHandleScales()
      applyGridPlacement()
      const bounds = renderer.domElement.getBoundingClientRect()
      const overlay = measurementOverlayRef.current
      if (overlay) {
        syncOverlay(
          overlay,
          measurementVisuals.map((visual) => {
            const projected = new THREE.Vector3(visual.position.x, visual.position.y, visual.position.z).project(camera)
            return {
              key: visual.id,
              text: visual.label,
              visible: projected.z >= -1 && projected.z <= 1,
              left: (projected.x * 0.5 + 0.5) * bounds.width,
              top: (-projected.y * 0.5 + 0.5) * bounds.height,
              dataset: { measurementId: visual.id }
            }
          }),
          () => {
            const label = globalThis.document.createElement("div")
            label.className = "three-measurement-label"
            label.setAttribute("role", "status")
            return label
          }
        )
      }
      const labelOverlay = pointLabelOverlayRef.current
      if (labelOverlay) {
        syncOverlay(
          labelOverlay,
          visiblePointLabels.map((primitive) => {
            const projected = new THREE.Vector3(primitive.position.x, primitive.position.y, primitive.position.z).project(camera)
            const label = primitive.label ?? primitive.id
            return {
              key: primitive.id,
              text: label,
              visible: projected.z >= -1 && projected.z <= 1,
              // 点标记的半径是固定像素，所以标注也按像素偏移，不随缩放漂移。
              left: (projected.x * 0.5 + 0.5) * bounds.width + 10,
              top: (-projected.y * 0.5 + 0.5) * bounds.height - 10,
              dataset: { pointLabel: label, pointId: primitive.id }
            }
          }),
          () => {
            const label = globalThis.document.createElement("span")
            label.className = "three-point-label"
            return label
          }
        )
      }
      if (sceneShell) {
        sceneShell.dataset.cameraDistance = cameraStateRef.current.distance.toFixed(2)
        sceneShell.dataset.cameraTarget = `${cameraStateRef.current.target.x.toFixed(2)},${cameraStateRef.current.target.y.toFixed(2)},${cameraStateRef.current.target.z.toFixed(2)}`
        // 自动取景开关的状态：e2e 与排查都靠它读，不靠肉眼。
        sceneShell.dataset.autofit = autoFitRef.current ? "true" : "false"
        // 视角角度的读数：旋转不改变视点中心，所以"有没有转"只能从这里看出来。
        sceneShell.dataset.cameraAzimuth = cameraStateRef.current.azimuth.toFixed(2)
        sceneShell.dataset.cameraElevation = cameraStateRef.current.elevation.toFixed(2)
      }
      renderer.render(scene, camera)
    }
    /** Click tolerance in world units, so a grab is always the same number of pixels wide. */
    const pickTolerance = () => pointHandleWorldRadius(camera, cameraStateRef.current.distance, viewportHeight, PICK_TOLERANCE_PX)
    /** 自由拖动：把对象沿屏幕平面平移的世界位移。深度不变，所以拖完图形还在原来的纵深上。 */
    const dragDeltaFor = (session: { anchor: THREE.Vector3; origin: THREE.Vector3 }, point: { x: number; y: number }): THREE.Vector3 | null => {
      const current = dragWorldPoint(camera, session.anchor, point)
      return current ? current.sub(session.origin) : null
    }
    const setCameraState = (nextState: CameraState) => {
      cameraStateRef.current = nextState
      applyCameraState(camera, nextState)
      render()
    }
    resetCameraRef.current = () => setCameraState(resetCameraState())
    const fitToContent = () => {
      setCameraState(fitCameraState(cameraStateRef.current, sceneBounds, camera))
    }
    fitCameraRef.current = fitToContent
    fitWithoutTouchRef.current = () => animateToFit()
    /**
     * 自动取景的过渡：约 250ms 的 ease-out 插值，`prefersReducedMotion` 时直接跳变。
     * 直接写 `cameraStateRef` 而不走 `setCameraState`，因为自动取景不该把自己标记成"用户动过相机"。
     */
    let fitAnimation: number | null = null
    const cancelFitAnimation = () => {
      if (fitAnimation !== null) cancelAnimationFrame(fitAnimation)
      fitAnimation = null
    }
    const animateToFit = () => {
      const fitted = fitCameraState(cameraStateRef.current, sceneBounds, camera)
      cancelFitAnimation()
      if (prefersReducedMotion()) {
        cameraStateRef.current = fitted
        applyCameraState(camera, fitted)
        render()
        return
      }
      const from = cameraStateRef.current
      const started = performance.now()
      const step = () => {
        const ratio = Math.min(1, (performance.now() - started) / FIT_ANIMATION_MS)
        const eased = 1 - (1 - ratio) ** 3
        cameraStateRef.current = interpolateCameraState(from, fitted, eased)
        applyCameraState(camera, cameraStateRef.current)
        render()
        fitAnimation = ratio < 1 ? requestAnimationFrame(step) : null
      }
      fitAnimation = requestAnimationFrame(step)
    }
    // Fit when a different document arrives (open file, switch workspace, restore draft), not on every edit:
    // re-framing while the user is working would fight their own camera moves.
    contentKeyRef.current = currentContentKey()
    const fittedId = documentRef.current.metadata.id
    // 从别的视角回来的同一份文档不算"新文档"：记着视角就别再取景，否则用户转过的角度与缩放会被覆盖。
    const remembered = loadRememberedCamera(fittedId) ? fittedId : null
    if (remembered) fittedDocumentRef.current = remembered
    if (fittedDocumentRef.current !== fittedId) {
      fittedDocumentRef.current = fittedId
      fitToContent()
    }
    render()
    // 场景重建后把进行中的拖动偏移补画回去，避免拖动中途回弹（见 resumeDragVisualRef）。
    resumeDragVisualRef.current()
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const next = viewportSize()
      viewportHeight = next.height
      camera.aspect = next.width / next.height
      camera.updateProjectionMatrix()
      renderer.setSize(next.width, next.height, false)
      render()
    })
    resizeObserver?.observe(container)

    /** 拖动期间的重画次数：拖动必须逐次跟手重画，否则画面会一格一格跳（见 handlePointerMove）。 */
    let dragFrames = 0
    /** 把这次拖动已经画上去的偏移补画到（可能是刚重建的）场景上，见 resumeDragVisualRef 的说明。 */
    resumeDragVisualRef.current = () => {
      const session = dragSessionRef.current
      if (!session?.applied || session.visualApplied.lengthSq() < 1e-12) return
      if (session.slideNormal) offsetSceneObjects(scene, session.targetId, session.slideNormal.clone().multiplyScalar(session.visualApplied.dot(session.slideNormal)))
      else applyDragOffsets(scene, session.family, session.visualApplied.clone())
      render()
    }
    /**
     * 场景运行时句柄：内容同步 + 补画进行中的拖动偏移 + 重画。
     * 由"内容同步效应"在签名变化时调用；渲染器与事件监听都留在本次挂载里，不再重建。
     */
    runtimeRef.current = {
      syncContent: () => {
        syncContent()
        /**
         * 自动取景的决策：文档换了或内容越界一定要拟合；内容变了但用户没动过相机也拟合；
         * 用户一旦手动调过视角，就只有"内容越界"才允许再抢（见 shouldAutoFit）。
         */
        const documentId = documentRef.current.metadata.id
        const documentChanged = fittedDocumentRef.current !== documentId
        const outOfView = isContentOutOfView(cameraStateRef.current, sceneBounds, camera)
        const shouldFit = shouldAutoFit({
          enabled: autoFitRef.current,
          dragging: dragSessionRef.current !== null,
          documentChanged,
          outOfView
        })
        fittedDocumentRef.current = documentId
        resumeDragVisualRef.current()
        render()
        if (shouldFit) {
          cameraFitRef.current += 1
          if (sceneShell) sceneShell.dataset.cameraFit = String(cameraFitRef.current)
          animateToFit()
        }
      }
    }
    const pointFromEvent = (event: PointerEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect()
      return { x: (event.clientX - bounds.left) / Math.max(bounds.width, 1), y: (event.clientY - bounds.top) / Math.max(bounds.height, 1) }
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return
      event.preventDefault()
      const point = pointFromEvent(event)
      pointerStateRef.current = { pointerId: event.pointerId, x: point.x, y: point.y, lastX: point.x, lastY: point.y, button: event.button, moved: false, shiftKey: event.shiftKey }
      dragSessionRef.current = null
      if (sceneShell) sceneShell.dataset.dragTarget = ""
      // 以面为剖切面：这一次点击只用来取面，取到就退出该模式。
      if (facePickModeRef.current && event.button === 0) {
        const hit = pickRaycastHit3(scene, camera, point, { tolerance: pickTolerance() })
        const face = hit ? documentRef.current.primitives.find((primitive) => primitive.id === hit.primitiveId) : undefined
        const section = documentRef.current.primitives.find((primitive): primitive is SectionPrimitive => primitive.type === "section" && selectedIdsRef.current.includes(primitive.id))
        if (hit?.kind === "face" && face?.type === "face3" && section) {
          // 由面的点环求它所在的平面；不共面的环（例如曲面侧面）会被 planeThroughPoints 直接拒绝。
          const vertices = face.pointIds.map((id) => points.get(id)?.position).filter((position): position is Vector3 => Boolean(position))
          const plane = planeThroughPoints(vertices)
          if (plane) {
            pickSectionFaceRef.current?.(section.id, plane)
            setFacePickMode(false)
          }
        }
        renderer.domElement.releasePointerCapture(event.pointerId)
        return
      }
      if (dragModeRef.current && event.button === 0) {
        const hit = pickRaycastHit3(scene, camera, point, { tolerance: pickTolerance() })
        const targetId = resolveSelectableHit(hit?.primitiveId ?? null, topologyOwners)
        const target = targetId ? documentRef.current.primitives.find((primitive) => primitive.id === targetId) : undefined
        // 拖动排查用读数：这一次按下到底抓到了什么。
        if (sceneShell) sceneShell.dataset.dragTarget = `${hit?.kind ?? "none"}:${hit?.primitiveId ?? "-"}->${target?.type ?? "none"}`
        // 截面要单独判定：它画在实体内部，按深度永远排不到，但用户指向那圈线时就是要挪刀口。
        const sectionId = pickSectionAt(scene, camera, point, pickTolerance(), hit?.kind === "point" || hit?.kind === "edge")
        const section = sectionId ? documentRef.current.primitives.find((primitive) => primitive.id === sectionId) : undefined
        if (section && section.type === "section") {
          // 拖动一个截面 = 沿法向平移剖切面。截面没有自己的实体几何，拖它就是挪刀口。
          const normal = sectionUnitNormal(section.plane.normal)
          if (normal) {
            // 需要一个真实的世界锚点（拖动位移由屏幕平面求交得出），用指针射线在截面所在平面上的落点。
            const anchor = dragWorldPoint(camera, new THREE.Vector3(0, 0, 0), point)
            if (anchor) {
              const sectionPoint = section.points[0]
              if (sectionPoint) anchor.set(sectionPoint.x, sectionPoint.y, sectionPoint.z)
              dragSessionRef.current = { targetId: section.id, family: new Set([section.id]), anchor, origin: anchor.clone(), total: new THREE.Vector3(), visualApplied: new THREE.Vector3(), applied: false, slideNormal: normal }
            }
          }
        } else if (hit && target && target.type === "point3" && target.binding && target.binding.kind !== "free") {
          /**
           * 绑定点的拖动：指针位置投影回**宿主的参数域**，点由参数算出坐标，所以永远贴住宿主
           * （不像自由拖动那样"叠加屏幕位移"，拖久了也不会漂离）。拖动期间只更新参数与受影响对象。
           */
          const binding = target.binding
          const hostId = binding.kind === "onHost" ? binding.hostId : binding.kind === "onFace" ? binding.faceId : binding.kind === "onSurface" || binding.kind === "inSolid" ? binding.solidId : null
          const hostPrimitive = hostId ? documentRef.current.primitives.find((candidate) => candidate.id === hostId) : undefined
          // 实体内不是"投影到低维宿主"，而是体积约束：由实体的物化拓扑构造（见 `solidVolumeHostFor`）。
          const hostConstraint = hostPrimitive
            ? host3FromPrimitive(hostPrimitive, documentRef.current.primitives)
              ?? (binding.kind === "inSolid" ? solidVolumeHostFor(new Map(documentRef.current.primitives.map((primitive) => [primitive.id, primitive])), hostPrimitive.id) : null)
            : null
          if (hostConstraint) {
            const anchor = new THREE.Vector3(hit.worldPoint.x, hit.worldPoint.y, hit.worldPoint.z)
            const origin = dragWorldPoint(camera, anchor, point) ?? anchor.clone()
            const dependents = dragFamilyIds(documentRef.current, target.id)
            dependents.delete(target.id)
            dragSessionRef.current = {
              targetId: target.id,
              family: new Set([target.id]),
              anchor,
              origin,
              total: new THREE.Vector3(),
              visualApplied: new THREE.Vector3(),
              applied: false,
              hostConstraint,
              hostDependents: [...dependents].filter((id) => ["line3", "segment3", "ray3", "edge3", "face3"].includes(documentRef.current.primitives.find((candidate) => candidate.id === id)?.type ?? ""))
            }
          }
        } else if (hit && target && isFreeDraggable3(target, points, templateTopologyIds(documentRef.current))) {
          const anchor = new THREE.Vector3(hit.worldPoint.x, hit.worldPoint.y, hit.worldPoint.z)
          const origin = dragWorldPoint(camera, anchor, point) ?? anchor.clone()
          dragSessionRef.current = { targetId: target.id, family: dragFamilyIds(documentRef.current, target.id), anchor, origin, total: new THREE.Vector3(), visualApplied: new THREE.Vector3(), applied: false }
        }
      }
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const handlePointerMove = (event: PointerEvent) => {
      const pointerState = pointerStateRef.current
      if (!pointerState || pointerState.pointerId !== event.pointerId) return
      const point = pointFromEvent(event)
      const deltaX = point.x - pointerState.lastX
      const deltaY = point.y - pointerState.lastY
      pointerState.moved ||= Math.hypot(point.x - pointerState.x, point.y - pointerState.y) > 0.008
      const session = dragSessionRef.current
      if (session) {
        const world = dragDeltaFor(session, point)
        if (world) {
          if (session.hostConstraint) {
            /**
             * 绑定点：把指针在世界平面上的落点**投影回宿主参数域**，再由参数算出坐标。
             * 每帧只重建这个点与它的下游对象（不整场重建、不进撤销历史），抬手才提交参数。
             */
            const worldPoint = session.origin.clone().add(world)
            const parameter = session.hostConstraint.closestParameter({ x: worldPoint.x, y: worldPoint.y, z: worldPoint.z })
            const projected = session.hostConstraint.evaluate(parameter)
            session.hostParameter = parameter
            session.applied = true
            const current = points.get(session.targetId)
            if (current) points.set(session.targetId, { ...current, position: projected })
            refreshPrimitiveObject(session.targetId)
            for (const dependentId of session.hostDependents ?? []) refreshPrimitiveObject(dependentId)
            pointerState.lastX = point.x
            pointerState.lastY = point.y
            render()
            dragFrames += 1
            if (sceneShell) {
              sceneShell.dataset.dragFrames = String(dragFrames)
              sceneShell.dataset.dragParameter = parameter.v === undefined ? parameter.u.toFixed(4) : `${parameter.u.toFixed(4)},${parameter.v.toFixed(4)}`
              // 残差应当恒为 0：坐标就是从参数算出来的（这条读数是"严格贴住宿主"的直接证据）。
              sceneShell.dataset.hostResidual = session.hostConstraint.residual(projected).toFixed(6)
              // 这次拖动里有多少下游对象跟着重建（0 表示这个点还没有下游）。
              sceneShell.dataset.hostDependents = String(session.hostDependents?.length ?? 0)
            }
            return
          }
          // 截面只认法向分量：屏幕位移先投影到法向，切向拖动不会让剖切面乱跑。
          if (session.slideNormal) session.total.copy(session.slideNormal).multiplyScalar(world.dot(session.slideNormal))
          else session.total.copy(world)
          // 只画"还没画的那一段"：画面跟手，文档在整次拖动期间保持不动。
          const step = session.total.clone().sub(session.visualApplied)
          if (step.lengthSq() > 1e-12) {
            if (session.slideNormal) {
              // 截面：屏幕位移投影到法向，画面上把截面与剖切面片一起挪，抬手再提交文档。
              const distance = step.dot(session.slideNormal)
              if (Math.abs(distance) > 1e-12) offsetSceneObjects(scene, session.targetId, session.slideNormal.clone().multiplyScalar(distance))
            } else {
              applyDragOffsets(scene, session.family, step)
            }
            session.visualApplied.copy(session.total)
            session.applied = true
            /**
             * 立刻重画。这些偏移只是改了 Three.js 对象的位置，**不会自己触发渲染**；
             * 少了这一句，画面就要等到下一次别的渲染（相机、尺寸、提交后的场景重建）才更新，
             * 拖动看起来就是"一帧一帧"跳（实测：20 次 pointermove 里只有 3 次真的重画）。
             */
            render()
            dragFrames += 1
            if (sceneShell) sceneShell.dataset.dragFrames = String(dragFrames)
          }
          /**
           * 拖动期间**不提交文档**：每次提交都会重建整个 3D 场景（几何与材质全部重建），
           * 那正是拖动中"顿一下"的来源，而且一次拖动会变成多步撤销。画面由上面的临时偏移负责，
           * 抬手时再一次性提交（见 handlePointerUp）。
           */
        }
        pointerState.lastX = point.x
        pointerState.lastY = point.y
        return
      }
      const state = cameraStateRef.current
      const scale = state.distance * 1.5
      // Ctrl drags along the view axis; middle drag, Shift+drag and the pan mode drag across the screen plane.
      const depthPan = event.ctrlKey || event.metaKey
      const screenPan = pointerState.button === 1 || pointerState.shiftKey || panModeRef.current
      const moved = depthPan
        ? panCameraState(state, 0, 0, deltaY * scale)
        : screenPan ? panCameraState(state, -deltaX * scale, deltaY * scale, 0) : rotateCameraState(state, deltaX * 140, deltaY * 140)
      pointerState.lastX = point.x
      pointerState.lastY = point.y
      setCameraState({ ...moved, target: clampCameraTarget(moved.target, sceneBounds) })
    }
    const handlePointerUp = (event: PointerEvent) => {
      const pointerState = pointerStateRef.current
      if (!pointerState || pointerState.pointerId !== event.pointerId) return
      const point = pointFromEvent(event)
      const session = dragSessionRef.current
      if (session) {
        dragSessionRef.current = null
        // 拖动期间一次都没提交，所以这里的一次提交就是整次拖动唯一的一步撤销。
        if (session.hostConstraint && session.hostParameter && session.applied) {
          // 绑定点：提交的是**宿主参数**；坐标由重算派生，所以点不会因为浮点累积而漂离宿主。
          hostDragEndRef.current?.(session.targetId, session.hostParameter)
        } else if (session.applied && session.total.lengthSq() > 1e-8) {
          if (session.slideNormal) moveSectionRef.current?.(session.targetId, session.total.dot(session.slideNormal))
          else dragEndRef.current?.(session.targetId, session.total)
        }
        // 选中放在抬手：拖动本身不该因为高亮重建而多一次场景重建。
        if (!selectedIdsRef.current.includes(session.targetId)) onSelectRef.current(session.targetId, false)
      } else if (!pointerState.moved && pointerState.button === 0) {
        /**
         * 点击优先级：**点 / 棱的拾取优先于"创建"**。
         * 否则虚线预览会抢走顶点手柄的点击（实测回归：点顶点手柄变成创建截线），
         * 而细粒度的空间元素本来就是用户更明确的目标；只有落到实体/面的点击才解释为创建。
         *
         * 截面预览是例外，但要有条件：它的那圈虚线落在实体**内部**，任何点击都会先命中实体的面，
         * 按上面的规则永远轮不到它（实测"点虚线创建截面"完全无效）。所以指针停在预览上时让预览优先，
         * 除非用户明确指到了一个**比剖切面更靠前**的顶点/棱手柄——那种情况下用户要的是那个手柄。
         */
        const hit = pickRaycastHit3(scene, camera, point, { tolerance: pickTolerance() })
        const precise = hit?.kind === "point" || hit?.kind === "edge"
        // 按点击位置重新判定预览（不能用 pointermove 留下的标志：原地点击可能根本没有移动事件）。
        const pointerRay = raycasterAt(point)
        const previewHit = previewHitAt(point)
        /**
         * "预览在前面"带一个拾取容差的余量：交点标记与来源实体的顶点手柄常常**共心**
         *（交线的拐点就是那个顶点），半径不同会让大一点的那个在深度上先被命中——
         * 差在一个容差之内就算"同一深度"，由 `previewBeatsPick` 决定该听谁的。
         */
        const previewInFront = previewHit.depth === null || !hit || previewHit.depth <= hit.depth + pickTolerance()
        const previewWins = previewHit.preview !== null && previewBeatsPick({
          previewKind: previewHit.preview.kind,
          previewInFront,
          hitKind: hit?.kind ?? null,
          hitDistanceToRay: hit ? pointerRay.ray.distanceToPoint(new THREE.Vector3(hit.worldPoint.x, hit.worldPoint.y, hit.worldPoint.z)) : Number.POSITIVE_INFINITY,
          tolerance: pickTolerance()
        })
        // 排查读数：这一次点击到底被哪条规则拦下（粗拾取到了什么、预览有没有命中、谁更靠前）。
        if (sceneShell) sceneShell.dataset.pickReadout = `${hit?.kind ?? "none"}|${hit?.primitiveId ?? "-"}|${precise ? "precise" : "coarse"}|${previewHit.hovering ? "hover" : "off"}|${previewInFront ? "front" : "behind"}`
        if (previewWins && previewClickRef.current) previewClickRef.current(previewHit.preview!)
        else onSelectRef.current(resolveSelectableHit(hit?.primitiveId ?? null, topologyOwners, event.altKey), event.shiftKey)
      }
      renderer.domElement.releasePointerCapture(event.pointerId)
      pointerStateRef.current = null
    }
    /**
     * 指针落在哪一份预览上？用射线与预览命中区求交，阈值按屏幕像素给（与实体拾取同一套思路），
     * 这样"点击创建"只在真的指向预览时生效，不会抢走普通选择。
     * 独立成函数是因为 **点击时必须按点击位置重新判定一次**：浏览器不需要在 pointerdown 之前先发
     * pointermove，只靠 pointermove 维护的标志会让"原地点击"读到过期状态（实测：剖切面确实在指针下、
     * 却因为标志是 false 而创建不了截面）。
     *
     * 多份预览叠在一起时（交面片 + 它的交线轮廓）取**最近**的一份；距离几乎相同时优先交线：
     * 交线是细目标，用户特意指到那条线上，多半是想创建交线而不是交面。
     */
    /** 指向某个归一化指针位置的世界射线（预览命中与"棱在不在指针下"共用同一条）。 */
    const raycasterAt = (normalizedPoint: { x: number; y: number }) => {
      const raycaster = new THREE.Raycaster()
      raycaster.params.Line = { threshold: pickTolerance() }
      raycaster.setFromCamera(new THREE.Vector2(normalizedPoint.x * 2 - 1, -(normalizedPoint.y * 2 - 1)), camera)
      return raycaster
    }
    /**
     * 同一处同时命中好几份预览时，取**更具体**的那一份：点 > 线 > 面。
     * 交线的拐点上同时压着交点标记、交线命中带和它两边的交面片，用户点的是那个点；
     * 交线的边上压着交面片，点的是那条线；只有面片中间没有更具体的东西，才归交面。
     */
    const previewSpecificity = (kind: ThreeScenePreview["kind"]): number => kind === "point" ? 3 : kind === "intersection" ? 2 : kind === "face" ? 1 : 0
    const previewHitAt = (normalizedPoint: { x: number; y: number }): { hovering: boolean; depth: number | null; preview: ThreeScenePreview | null } => {
      const lookup = new Map<THREE.Object3D, ThreeScenePreview>()
      for (const [key, group] of previewGroups) {
        // 每轮同步建好的 key → 预览 表：这里不必再线性查找（预览数量会随实体数增长）。
        const preview = previewByKey.get(key)
        if (!preview) continue
        for (const target of (group.userData.hitTargets as THREE.Object3D[] | undefined) ?? []) lookup.set(target, preview)
      }
      if (lookup.size === 0) return { hovering: false, depth: null, preview: null }
      const hits = raycasterAt(normalizedPoint).intersectObjects([...lookup.keys()], false)
      let best: { distance: number; preview: ThreeScenePreview } | null = null
      for (const hit of hits) {
        const preview = lookup.get(hit.object)
        if (!preview) continue
        if (!best) { best = { distance: hit.distance, preview }; continue }
        const tolerance = Math.max(1e-3, hit.distance * 0.02)
        if (hit.distance < best.distance - tolerance) { best = { distance: hit.distance, preview }; continue }
        // 距离几乎相同（同一处同时命中好几份预览）时取**更具体**的那一份：点 > 线 > 面。
        if (Math.abs(hit.distance - best.distance) <= tolerance && previewSpecificity(preview.kind) > previewSpecificity(best.preview.kind)) {
          best = { distance: hit.distance, preview }
        }
      }
      return { hovering: best !== null, depth: best?.distance ?? null, preview: best?.preview ?? null }
    }
    /** 高亮是**就地改材质**：悬停不该触发内容重建（一次重建要重算整场几何）。 */
    const setPreviewHoverKey = (key: string | null) => {
      if (previewHoverKeyRef.current === key) return
      const previous = previewHoverKeyRef.current ? previewGroups.get(previewHoverKeyRef.current) : null
      previewHoverKeyRef.current = key
      if (previous) applyPreviewHighlight(previous, false)
      const next = key ? previewGroups.get(key) : null
      if (next) applyPreviewHighlight(next, true)
      if (sceneShell) sceneShell.dataset.previewHoverKey = key ?? ""
    }
    const updatePreviewHover = (event: PointerEvent) => {
      const point = pointFromEvent(event)
      const { hovering, preview } = previewHitAt(point)
      if (sceneShell) sceneShell.dataset.previewHovering = hovering ? "true" : "false"
      setPreviewHoverKey(preview?.key ?? null)
      // 状态栏要跟着指针换：从一份预览滑到另一份时，"这一份是什么、点下去创建什么"必须重新说一遍。
      if (preview && preview.key !== lastPreview?.key) {
        lastPreview = preview
        previewHoverRef.current?.(true, preview)
        previewHovering = true
        return
      }
      if (hovering === previewHovering) return
      previewHovering = hovering
      if (hovering && preview) previewHoverRef.current?.(true, preview)
      else if (lastPreview) previewHoverRef.current?.(false, lastPreview)
    }
    let previewHovering = false
    let lastPreview: ThreeScenePreview | null = null
    const handlePointerMoveForPreview = (event: PointerEvent) => updatePreviewHover(event)
    const handlePointerLeaveForPreview = () => {
      setPreviewHoverKey(null)
      if (!previewHovering) return
      previewHovering = false
      if (lastPreview) previewHoverRef.current?.(false, lastPreview)
    }
    renderer.domElement.addEventListener("pointermove", handlePointerMoveForPreview)
    renderer.domElement.addEventListener("pointerleave", handlePointerLeaveForPreview)
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      setCameraState(zoomCameraState(cameraStateRef.current, Math.exp(event.deltaY * 0.001)))
    }
    const handleContextMenu = (event: MouseEvent) => event.preventDefault()
    /**
     * 方向键微调剖切面：只在「自由拖动」开着、且选中的是截面时生效（与拖动的语义一致）。
     * 上下键沿法向 1 个单位、左右键反向；按住 Shift 走 0.2，用来贴近某个面。
     */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!dragModeRef.current || event.altKey || event.ctrlKey || event.metaKey) return
      const section = documentRef.current.primitives.find((primitive): primitive is SectionPrimitive => primitive.type === "section" && selectedIdsRef.current.includes(primitive.id))
      if (!section || !sectionUnitNormal(section.plane.normal)) return
      const direction = event.key === "ArrowUp" || event.key === "ArrowRight" ? 1 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -1 : 0
      if (direction === 0) return
      event.preventDefault()
      moveSectionRef.current?.(section.id, direction * (event.shiftKey ? 0.2 : 1))
    }
    globalThis.addEventListener("keydown", handleKeyDown)
    renderer.domElement.addEventListener("pointerdown", handlePointerDown)
    renderer.domElement.addEventListener("pointermove", handlePointerMove)
    renderer.domElement.addEventListener("pointerup", handlePointerUp)
    renderer.domElement.addEventListener("pointercancel", handlePointerUp)
    renderer.domElement.addEventListener("wheel", handleWheel, { passive: false })
    renderer.domElement.addEventListener("contextmenu", handleContextMenu)
    return () => {
      // 卸载前把视角记下来：工作区来回切换时才能回到用户离开时的样子。
      rememberCamera(documentRef.current.metadata.id, cameraStateRef.current)
      resetCameraRef.current = () => undefined
      fitCameraRef.current = () => undefined
      runtimeRef.current = null
      contentKeyRef.current = null
      cancelFitAnimation()
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown)
      renderer.domElement.removeEventListener("pointermove", handlePointerMove)
      renderer.domElement.removeEventListener("pointerup", handlePointerUp)
      renderer.domElement.removeEventListener("pointercancel", handlePointerUp)
      renderer.domElement.removeEventListener("pointermove", handlePointerMoveForPreview)
      renderer.domElement.removeEventListener("pointerleave", handlePointerLeaveForPreview)
      renderer.domElement.removeEventListener("wheel", handleWheel)
      renderer.domElement.removeEventListener("contextmenu", handleContextMenu)
      globalThis.removeEventListener("keydown", handleKeyDown)
      resizeObserver?.disconnect()
      disposeScene(scene)
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
    // 挂载期只建一次：文档、选择与显示开关都经 ref 读取，父组件的任何重渲染都不再重建渲染器。
  }, [])

  /** 开关的状态立刻反映到 DOM 读数上：切换开关不会重建场景，所以不能只靠 render() 去写。 */
  useEffect(() => {
    const shell = containerRef.current
    if (shell) shell.dataset.autofit = autoFit ? "true" : "false"
  }, [autoFit])

  /**
   * 内容同步：只在"场景内容签名"变化时跑。文档编辑、选中、显示开关、预览与展开进度会改变签名；
   * 相机、指针、提示文案不会，因此悬停与提示不再触发任何场景工作。
   */
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const key = sceneContentKey({
      document,
      selectedIds,
      showHiddenEdges,
      showNormals,
      transparentFaces,
      unfoldProgress,
      previewKeys: previews.map((item) => `${item.key}:${item.kind}`).join("|")
    })
    if (!sceneSyncDecision(contentKeyRef.current, key)) return
    contentKeyRef.current = key
    runtime.syncContent()
  }, [document, selectedIds, showHiddenEdges, showNormals, transparentFaces, unfoldProgress, previews])

  const hasGeometry = document.primitives.some((primitive) => ["point3", "line3", "segment3", "ray3", "edge3", "face3", "polyhedron3", "cube", "pyramid", "cylinder", "cone"].includes(primitive.type) && primitive.visible !== false)
  /** 「以面为剖切面」需要有选中的截面作为目标。 */
  const hasSelectedSection = selectedIds.some((id) => document.primitives.some((primitive) => primitive.id === id && primitive.type === "section"))
  const angle = dihedralAngleDegrees({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
  return <div className="three-canvas-shell" ref={containerRef} data-3d-scene="true" data-pan-mode={panMode ? "true" : "false"} data-drag-mode={dragMode ? "true" : "false"} aria-label="3D 几何场景"><div className="three-render-target" ref={renderTargetRef} /><div className="three-measurement-overlay" ref={measurementOverlayRef} aria-label="三维测量标注" /><div className="three-point-label-overlay" ref={pointLabelOverlayRef} aria-label="三维点标注" />{webglAvailable && <div className="three-scene-controls" aria-label="3D显示控制"><button type="button" aria-pressed={transparentFaces} onClick={() => setTransparentFaces((visible) => !visible)}>透明面</button><button type="button" aria-pressed={showHiddenEdges} onClick={() => setShowHiddenEdges((visible) => !visible)}>隐藏边</button><button type="button" aria-pressed={showNormals} onClick={toggleNormals}>法向量</button><button type="button" aria-pressed={unfolded} onClick={() => setUnfolded((visible) => !visible)}>{unfolded ? "折叠" : "展开"}</button><button type="button" aria-pressed={showAngle} onClick={toggleAngleDemo}>测量二面角</button><button type="button" aria-label="自动取景" aria-pressed={autoFit} title="开启后，加载文件、增删图元或内容跑出视野时会自动把视角调整到框住全部可见图元（保留 30% 安全边距）；你手动转动过视角之后就不再主动抢" onClick={() => { const next = !autoFit; setAutoFit(next); saveViewPreference3d({ autoFit: next }); if (next) fitWithoutTouchRef.current() }}>自动取景</button><button type="button" aria-label="以面为剖切面" aria-pressed={facePickMode} title="点一下这个按钮，再点实体上的某个面，该面就成为选中截面的剖切面" disabled={!hasSelectedSection} onClick={() => setFacePickMode((active) => !active)}>取面</button></div>}{webglAvailable && <div className="three-camera-controls" aria-label="3D视角控制"><button type="button" aria-label="自由拖动" aria-pressed={dragMode} title="开启后左键按住图形即整体拖动：实体、点、以及由点驱动的棱/线/面/平面都会跟着指针在屏幕平面内移动，其它对象不受影响" onClick={() => enterMode("drag")}>自由拖动</button><button type="button" aria-label="平移视角" aria-pressed={panMode} title="开启后左键拖动画布即平移视角，按 Ctrl 拖动沿视线前后移动" onClick={() => enterMode("pan")}>平移视角</button><button type="button" aria-label="适应视图" title="把视角调整到刚好框住当前图形，并把视角中心移回图形" onClick={() => fitCameraRef.current()}>适应视图</button><button type="button" aria-label="重置3D视角" title="回到默认视角" onClick={() => resetCameraRef.current()}>重置视角</button></div>}{webglAvailable && <p className="three-camera-hint" data-camera-hint="true">{dragMode ? "自由拖动已开启：左键按住图形整体移动 · 关掉按钮后左键拖动恢复为旋转视角 · 滚轮缩放" : panMode ? "平移视角已开启：左键拖动平移 · 按 Ctrl 拖动沿视线前后移动 · 滚轮缩放" : "左键拖动旋转 · 中键或 Shift+左键拖动平移 · Ctrl+拖动沿视线前后移动 · 滚轮缩放"}</p>}{showAngle && webglAvailable && <div className="three-angle-readout" role="status">二面角：{angle.toFixed(1)}°（示例法向量 X/Y）</div>}{!webglAvailable && <div className="three-scene-status" role="status">当前浏览器不支持 WebGL，无法显示 3D 场景。</div>}{webglAvailable && !hasGeometry && <div className="three-scene-status" role="status">添加点、线或面开始探索三维空间。</div>}</div>
}
