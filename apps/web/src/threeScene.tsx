import * as THREE from "three"
import { useEffect, useRef, useState } from "react"
import type { GeometryDocument, Vector3 } from "@draw/dsl"
import { dihedralAngleDegrees, type Host3Parameter } from "@draw/geometry-kernel"
import type { SceneControlMode } from "./statusPrompts"
import { loadViewPreference3d, saveViewPreference3d } from "./persistence/draftStorage"
import { sceneContentKey, sceneSyncDecision } from "./sceneContentKey"
import { createCameraState, type CameraState } from "./threeCamera"
import { loadRememberedCamera } from "./cameraMemory"
import type { ThreeScenePreview } from "./threeScenePreview"
import { prefersReducedMotion, nextUnfoldProgress } from "./threePrimitives"

/**
 * 场景生命周期与其中搬出去的两个类型（`PointerState` / `DragSessionState`）都在 `./threeSceneEffect`。
 */
import { useThreeSceneEffect, type DragSessionState, type PointerState } from "./threeSceneEffect"
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
  /** 拖动旋转环结束：提交绕世界轴转过的角度（度）。一次拖动只回调一次，所以一次旋转就是一步撤销。 */
  onRotateEnd?: (id: string, axis: "x" | "y" | "z", degrees: number) => void
  /** 拖动轨道圆的半径手柄结束：提交新的半径（正数）。同样一次拖动只回调一次。 */
  onTrackRadiusEnd?: (id: string, radius: number) => void
  /** 开启"以面为剖切面"后，点到的那个面就成为截面 `<id>` 的剖切面。 */
  onPickSectionFace?: (id: string, plane: { normal: Vector3; constant: number }) => void
}

export function ThreeSceneView({ document, selectedIds, onSelect, onStatusPromptChange, previews = [], onPreviewHover, onPreviewClick, onDragEnd, onMoveSection, onHostDragEnd, onRotateEnd, onTrackRadiusEnd, onPickSectionFace }: ThreeSceneViewProps) {
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
  /** 拖动旋转环结束：提交绕世界轴转过的角度（度）。 */
  const rotateEndRef = useRef(onRotateEnd)
  rotateEndRef.current = onRotateEnd
  /** 拖动半径手柄结束：提交新的半径。 */
  const trackRadiusEndRef = useRef(onTrackRadiusEnd)
  trackRadiusEndRef.current = onTrackRadiusEnd
  /**
   * 当前选中的可转对象与它的手柄几何（环心 / 半径）。指针按下与拖动都要读它，
   * 但它随选中变化——放 ref 里，指针处理函数就不必因为选择变化而重新订阅。
   */
  const rotationHandleRef = useRef<{ id: string; center: THREE.Vector3; radius: number; group: THREE.Group } | null>(null)
  /** 当前选中轨道的**半径手柄**（缩放用）。 */
  const trackRadiusHandleRef = useRef<{ id: string; radius: number; group: THREE.Group; point: THREE.Vector3 } | null>(null)
  /**
   * 缩放拖动期间的**半径预览**。文档在整次拖动期间不提交，画面靠它重建：
   * `refreshPrimitiveObject` 会用它替换半径再建那个圆，绑在圆上的点也按同一个半径重算坐标。
   */
  const circleRadiusPreviewRef = useRef<{ id: string; radius: number } | null>(null)
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
  /** 解析曲线的细分档位（2 的幂）。相机缩放只改它，再由同步依赖触发重建——见 `syncCurveToleranceBucket`。 */
  const [curveToleranceBucket, setCurveToleranceBucket] = useState<number | null>(null)
  /** 渲染器只在挂载期建一次，`syncContent` 里的实时值一律经 ref 读——容差也一样。 */
  const curveToleranceBucketRef = useRef(0)
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

  /**
   * 场景的**整个生命周期**（建渲染器 / 同步内容 / 指针交互 / 取景 / 清理）在 `./threeSceneEffect`：
   * 它是挂载期只建一次的效应（依赖 `[]`），读的东西全经 ref，所以入参就是一组 ref 加几个显示开关。
   * 本文件从此只剩下"组件怎么画"：ref 的声明、两个小效应、以及 JSX。
   */
  useThreeSceneEffect({ containerRef, renderTargetRef, measurementOverlayRef, pointLabelOverlayRef, cameraStateRef, resetCameraRef, fitCameraRef, fittedDocumentRef, panModeRef, dragModeRef, pointerStateRef, dragSessionRef, selectedIdsRef, dragEndRef, previewHoverKeyRef, moveSectionRef, hostDragEndRef, rotateEndRef, trackRadiusEndRef, rotationHandleRef, trackRadiusHandleRef, circleRadiusPreviewRef, pickSectionFaceRef, documentRef, resumeDragVisualRef, setCurveToleranceBucket, curveToleranceBucketRef, setFacePickMode, facePickModeRef, setWebglAvailable, previewHoverRef, previewsRef, onSelectRef, previewClickRef, displayFlagsRef, runtimeRef, contentKeyRef, sceneBuildsRef, sceneSyncsRef, autoFitRef, cameraFitRef, fitWithoutTouchRef })

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
    /**
     * 只有画布上**真的存在解析曲线 / 解析曲面**（空间圆 / 带解析边界的截面 / 带解析边界的交面 /
     * 带解析曲面的交面预览）时，缩放才需要重新采样。
     * 否则把容差档写进签名会让"只有立方体"的文档在每次缩放时白跑一次同步——那既浪费，
     * 又可能顺手触发自动取景重新构图（实测：相交预览用例预先算好的投影点因此失效）。
     */
    const wantsExactCurves = document.primitives.some((primitive) =>
      primitive.type === "circle3" ||
      (primitive.type === "section" && primitive.exact !== undefined) ||
      (primitive.type === "intersectionFace" && primitive.exactLoops !== undefined && primitive.exactLoops.length > 0)
    ) || previews.some((preview) => preview.kind === "face" && preview.surface !== undefined)
    const key = sceneContentKey({
      document,
      selectedIds,
      showHiddenEdges,
      showNormals,
      transparentFaces,
      unfoldProgress,
      previewKeys: previews.map((item) => `${item.key}:${item.kind}`).join("|"),
      curveToleranceBucket: wantsExactCurves ? curveToleranceBucket ?? 0 : 0
    })
    if (!sceneSyncDecision(contentKeyRef.current, key)) return
    contentKeyRef.current = key
    runtime.syncContent()
  }, [document, selectedIds, showHiddenEdges, showNormals, transparentFaces, unfoldProgress, previews, curveToleranceBucket])

  const hasGeometry = document.primitives.some((primitive) => ["point3", "line3", "segment3", "ray3", "edge3", "face3", "polyhedron3", "cube", "pyramid", "cylinder", "cone"].includes(primitive.type) && primitive.visible !== false)
  /** 「以面为剖切面」需要有选中的截面作为目标。 */
  const hasSelectedSection = selectedIds.some((id) => document.primitives.some((primitive) => primitive.id === id && primitive.type === "section"))
  const angle = dihedralAngleDegrees({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })
  return <div className="three-canvas-shell" ref={containerRef} data-3d-scene="true" data-canvas-surface="graph-paper" data-pan-mode={panMode ? "true" : "false"} data-drag-mode={dragMode ? "true" : "false"} aria-label="3D 几何场景"><div className="three-render-target" ref={renderTargetRef} /><div className="three-measurement-overlay" ref={measurementOverlayRef} aria-label="三维测量标注" /><div className="three-point-label-overlay" ref={pointLabelOverlayRef} aria-label="三维点标注" />{webglAvailable && <div className="three-scene-controls" aria-label="3D显示控制"><button type="button" aria-pressed={transparentFaces} onClick={() => setTransparentFaces((visible) => !visible)}>透明面</button><button type="button" aria-pressed={showHiddenEdges} onClick={() => setShowHiddenEdges((visible) => !visible)}>隐藏边</button><button type="button" aria-pressed={showNormals} onClick={toggleNormals}>法向量</button><button type="button" aria-pressed={unfolded} onClick={() => setUnfolded((visible) => !visible)}>{unfolded ? "折叠" : "展开"}</button><button type="button" aria-pressed={showAngle} onClick={toggleAngleDemo}>测量二面角</button><button type="button" aria-label="自动取景" aria-pressed={autoFit} title="开启后，加载文件、增删图元或内容跑出视野时会自动把视角调整到框住全部可见图元（保留 30% 安全边距）；你手动转动过视角之后就不再主动抢" onClick={() => { const next = !autoFit; setAutoFit(next); saveViewPreference3d({ autoFit: next }); if (next) fitWithoutTouchRef.current() }}>自动取景</button><button type="button" aria-label="以面为剖切面" aria-pressed={facePickMode} title="点一下这个按钮，再点实体上的某个面，该面就成为选中截面的剖切面" disabled={!hasSelectedSection} onClick={() => setFacePickMode((active) => !active)}>取面</button></div>}{webglAvailable && <div className="three-camera-controls" aria-label="3D视角控制"><button type="button" aria-label="自由拖动" aria-pressed={dragMode} title="开启后左键按住图形即整体拖动：实体、点、以及由点驱动的棱/线/面/平面都会跟着指针在屏幕平面内移动，其它对象不受影响" onClick={() => enterMode("drag")}>自由拖动</button><button type="button" aria-label="平移视角" aria-pressed={panMode} title="开启后左键拖动画布即平移视角，按 Ctrl 拖动沿视线前后移动" onClick={() => enterMode("pan")}>平移视角</button><button type="button" aria-label="适应视图" title="把视角调整到刚好框住当前图形，并把视角中心移回图形" onClick={() => fitCameraRef.current()}>适应视图</button><button type="button" aria-label="重置3D视角" title="回到默认视角" onClick={() => resetCameraRef.current()}>重置视角</button></div>}{webglAvailable && <p className="three-camera-hint" data-camera-hint="true">{dragMode ? "自由拖动已开启：左键按住图形整体移动 · 关掉按钮后左键拖动恢复为旋转视角 · 滚轮缩放" : panMode ? "平移视角已开启：左键拖动平移 · 按 Ctrl 拖动沿视线前后移动 · 滚轮缩放" : "左键拖动旋转 · 中键或 Shift+左键拖动平移 · Ctrl+拖动沿视线前后移动 · 滚轮缩放"}</p>}{showAngle && webglAvailable && <div className="three-angle-readout" role="status">二面角：{angle.toFixed(1)}°（示例法向量 X/Y）</div>}{!webglAvailable && <div className="three-scene-status" role="status">当前浏览器不支持 WebGL，无法显示 3D 场景。</div>}{webglAvailable && !hasGeometry && <div className="three-scene-status" role="status">添加点、线或面开始探索三维空间。</div>}</div>
}
