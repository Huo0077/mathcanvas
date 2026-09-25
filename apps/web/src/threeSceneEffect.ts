import { createThreeSceneInteraction } from "./threeSceneInteraction"
import { createThreeSceneGrid, type ThreeSceneGridHolder } from "./threeSceneGrid"
import { createThreeSceneRender } from "./threeSceneRender"
import { createThreeScenePreviewHover } from "./threeScenePreviewHover"
import { createThreeSceneCamera } from "./threeSceneCamera"
import { createThreeSceneDragVisuals } from "./threeSceneDragVisuals"
import { createThreeSceneContent } from "./threeSceneContent"
/**
 * **三维场景的运行时**（从 `threeScene.tsx` 拆出，评审方案 2 —— 那个文件原本 1807 行）。
 *
 * 这里装的是**挂载期只建一次**的那一个效应：建渲染器与场景、按内容签名增量同步场景对象、
 * 指针 / 滚轮 / 键盘交互、取景动画、以及卸载时的清理。搬动是**逐行原样**的：效应体一行没改，
 * 只是把"它从组件作用域读的那些名字"改成经 `deps` 传入（并给两处规则提示写了说明）。
 *
 * ## 为什么第一步搬的是"整块"，而不是先按阶段拆成三块
 *
 * 这个效应内部有约 30 个**互相共享的可变局部量**：`sceneBounds` 由内容同步写、被取景与指针读；
 * `previewGroups` / `previewByKey` / `objectIndex` / `viewportHeight` 同理。按阶段拆成多个 hook
 * 就得先把它们收进一个 runtime 对象，而那意味着在 1400 行里逐处改写引用 —— 其中还埋着
 * `const document = documentRef.current` 这类**与 DOM 全局同名**的局部（盲改会静默改错，
 * 类型检查未必拦得住）。所以第一步搬"整块"：接口只有"组件作用域里被读到的名字"这一层，
 * 是**可逐行核对**的，风险与收益都在明处。
 *
 * ## 已经切出去的六块（按阶段）
 *
 * 手法统一是"**依赖对象 + 原文搬**"：跨阶段的可变值先变成**稳定容器**（`copy` / `clear` / 就地 push），
 * 搬动的行一行不改，接口是一个 deps 对象。每切一块都跑 `geometry3d-*` 那一组 e2e —— 它们就是
 * 这一块的验收面：
 *
 * | 模块 | 职责 |
 * | --- | --- |
 * | `./threeSceneCamera` | 相机状态、复位 / 取景与约 250ms 的过渡 |
 * | `./threeSceneRender` | 一帧的绘制 + 两层标签覆盖层 + 手柄缩放与容差档位 |
 * | `./threeSceneGrid` | 网格与坐标轴落位 |
 * | `./threeSceneContent` | 内容同步（本文件里曾是最长的一块） |
 * | `./threeScenePreviewHover` | 预览的悬停判定与高亮 |
 * | `./threeSceneInteraction` | 指针按下 / 移动 / 抬起、拖拽会话、拾取判定 |
 *
 * 本文件剩下的是**装配与编排**：建场景 / 相机 / 渲染器、注册与注销监听、尺寸变化、拖拽画面用的
 * 一次性辅助（轨道半径预览、旋转手柄落位）与键盘处理。
 *
 * 下面两节保留当初的记录 —— 它们是"为什么按这个顺序切"的由来。
 *
 * ## 已经切出去的第一块（相机取景与动画）
 *
 * `./threeSceneCamera`：`setCameraState` / 复位 / 取景 / 约 250ms 的过渡，以及"只在换文档时取景"
 * 那一段。用的手法就是上面说的"**依赖对象 + 原文搬**"：移动过去的 52 行**一行没改**
 *（只整体缩进两格），接口是一个 deps 对象。
 *
 * 其中有一个值得记住的**前置改动**：`sceneBounds` 原来是 `let`、每次内容同步**重新赋值**，
 * 那样它没法作为"稳定身份"的依赖传出去。改成 `const` + `sceneBounds.copy(...)`（同一只盒子就地更新）
 * 之后，读它的人（相机、指针夹取、越界判断）永远看到最新边界，而引用始终是同一只对象。
 * **后面每切一块，遇到"跨阶段的 `let`"就照这个办法处理。**
 *
 * ## 第二块（3D 预览的悬停判定与高亮）
 *
 * `./threeScenePreviewHover`：射线求交、挑"更具体的一份"、就地改材质高亮、把"悬停在哪一份"告诉状态栏。
 * 同样 72 行原文搬。这里的两个 Map（`previewGroups` / `previewByKey`）原来也是每次同步**重新赋值**，
 * 按上面那条办法改成 `.clear()` 就地清空再填 —— **同一只 Map，语义不变**。
 *
 * **注册与注销监听仍留在本函数**（`addEventListener` / `removeEventListener` 成对出现才算清楚谁负责），
 * 切出去的是监听器本身。
 */

import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react"
import * as THREE from "three"

import type { Point3Primitive, SectionPrimitive } from "@draw/dsl"
import { reactive, type Host3, type Host3Parameter } from "@draw/geometry-kernel"
import { resolveMeasurementVisual } from "./measurementVisuals"
import { sceneContentKey } from "./sceneContentKey"
import { applyCameraState, isContentOutOfView, shouldAutoFit, zoomCameraState, type CameraState } from "./threeCamera"
import { rememberCamera } from "./cameraMemory"
import type { ThreeScenePreview } from "./threeScenePreview"
import { dragWorldPoint, type RotationDragState } from "./threeDrag"
import { PICK_TOLERANCE_PX, pointHandleWorldRadius } from "./threePicking"
import { sectionUnitNormal, disposeScene } from "./threePrimitives"

/**
 * 3D 画布**不再自带底色**：纸底色由 CSS 令牌 `--color-graph-paper` 一处定义（见 `scene.background = null`
 * 那里的说明）。这里刻意不留一份 JS 的颜色副本——留了就是第二个真源。
 */

/** Pointer bookkeeping for one press; lives at component scope so a scene rebuild cannot end a drag. */
export interface PointerState {
  pointerId: number
  x: number
  y: number
  lastX: number
  lastY: number
  button: number
  moved: boolean
}

/**
 * 一次自由拖动。拖动期间文档完全不提交，只把位移按帧画到场景里的对象上；抬手时才提交唯一一次操作。
 * 这正是"一次拖动 = 一步撤销"的保证：中途每提交一次，撤销栈里就多一步，用户要按好几次 Ctrl+Z 才能回到原状
 * （实测：一次 90px 的拖动会留下 4 步）。`total` 是这次拖动的总位移，`applied` 表示画面已经动过。
 */
export interface DragSessionState {
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
  /**
   * 绑定点的坐标由 **Reactive DAG** 求出（Reactive DAG 切片 Task 4）：宿主是来源节点、
   * 宿主参数（u/v/w）是三个参数节点、点本身是约束节点。每帧只写参数、求一次闭包，
   * 坐标来自 evaluator —— 与 2D 的动点是同一条"参数是唯一真值"的路子。
   */
  reactiveHost?: { graph: reactive.ReactiveGraph; pointId: string; parameterIds: readonly [string, string, string] }
  /**
   * 拖动**旋转环**：这次转的是哪根世界轴、枢轴在哪、已经转到哪儿，以及画面上要跟着转的族。
   * 与平移共用同一个会话（一次拖动仍然只提交一步），只是几何含义不同。
   */
  rotation?: { state: RotationDragState; family: Set<string> }
  /**
   * 拖**半径手柄**（缩放轨道圆）：这次把半径拉到多少。拖动期间只改画面（预览），抬手才提交一次
   * `radius3`——与平移 / 旋转同一条"一次拖动 = 一步撤销"的规则。
   */
  scale?: { id: string; original: number; current: number }
}

/**
 * 为一次"绑定点拖动"建一张最小的 Reactive DAG：
 *
 * ```text
 * 宿主(来源) --\
 *  u 参数 ------> 点(约束节点) --> 坐标
 *  v 参数 -----/
 *  w 参数 ---/
 * ```
 *
 * 图的规模与这次拖动无关的部分完全无关，所以"每帧只重算这个点"在读数上可验证
 * （`data-reactive-evaluated`）。三维宿主即使只有一维（棱 / 线段），多出来的 v/w 参数也不会
 * 参与求值：`hostPointNode` 只读宿主真正声明了的维度。
 */

import type { ThreeSceneViewProps } from "./threeScene"

export interface ThreeSceneEffectDeps {
  containerRef: RefObject<HTMLDivElement | null>
  renderTargetRef: RefObject<HTMLDivElement | null>
  measurementOverlayRef: RefObject<HTMLDivElement | null>
  pointLabelOverlayRef: RefObject<HTMLDivElement | null>
  cameraStateRef: RefObject<CameraState>
  resetCameraRef: RefObject<() => void>
  fitCameraRef: RefObject<() => void>
  fittedDocumentRef: RefObject<string | null>
  panModeRef: RefObject<boolean>
  dragModeRef: RefObject<boolean>
  pointerStateRef: RefObject<PointerState | null>
  dragSessionRef: RefObject<DragSessionState | null>
  selectedIdsRef: RefObject<string[]>
  dragEndRef: RefObject<ThreeSceneViewProps["onDragEnd"]>
  previewHoverKeyRef: RefObject<string | null>
  moveSectionRef: RefObject<ThreeSceneViewProps["onMoveSection"]>
  hostDragEndRef: RefObject<ThreeSceneViewProps["onHostDragEnd"]>
  rotateEndRef: RefObject<ThreeSceneViewProps["onRotateEnd"]>
  trackRadiusEndRef: RefObject<ThreeSceneViewProps["onTrackRadiusEnd"]>
  rotationHandleRef: RefObject<{ id: string; center: THREE.Vector3; radius: number; group: THREE.Group } | null>
  trackRadiusHandleRef: RefObject<{ id: string; radius: number; group: THREE.Group; point: THREE.Vector3 } | null>
  circleRadiusPreviewRef: RefObject<{ id: string; radius: number } | null>
  pickSectionFaceRef: RefObject<ThreeSceneViewProps["onPickSectionFace"]>
  documentRef: RefObject<ThreeSceneViewProps["document"]>
  resumeDragVisualRef: RefObject<() => void>
  setCurveToleranceBucket: Dispatch<SetStateAction<number | null>>
  curveToleranceBucketRef: RefObject<number>
  setFacePickMode: Dispatch<SetStateAction<boolean>>
  facePickModeRef: RefObject<boolean>
  setWebglAvailable: Dispatch<SetStateAction<boolean>>
  previewHoverRef: RefObject<ThreeSceneViewProps["onPreviewHover"]>
  previewsRef: RefObject<NonNullable<ThreeSceneViewProps["previews"]>>
  onSelectRef: RefObject<ThreeSceneViewProps["onSelect"]>
  previewClickRef: RefObject<ThreeSceneViewProps["onPreviewClick"]>
  displayFlagsRef: RefObject<{ showHiddenEdges: boolean; showNormals: boolean; transparentFaces: boolean; unfoldProgress: number }>
  runtimeRef: RefObject<{ syncContent: () => void } | null>
  contentKeyRef: RefObject<string | null>
  sceneBuildsRef: RefObject<number>
  sceneSyncsRef: RefObject<number>
  autoFitRef: RefObject<boolean>
  cameraFitRef: RefObject<number>
  fitWithoutTouchRef: RefObject<() => void>
}

export function useThreeSceneEffect(deps: ThreeSceneEffectDeps) {
  const { containerRef, renderTargetRef, measurementOverlayRef, pointLabelOverlayRef, cameraStateRef, resetCameraRef, fitCameraRef, fittedDocumentRef, panModeRef, dragModeRef, pointerStateRef, dragSessionRef, selectedIdsRef, dragEndRef, previewHoverKeyRef, moveSectionRef, hostDragEndRef, rotateEndRef, trackRadiusEndRef, rotationHandleRef, trackRadiusHandleRef, circleRadiusPreviewRef, pickSectionFaceRef, documentRef, resumeDragVisualRef, setCurveToleranceBucket, curveToleranceBucketRef, setFacePickMode, facePickModeRef, setWebglAvailable, previewHoverRef, previewsRef, onSelectRef, previewClickRef, displayFlagsRef, runtimeRef, contentKeyRef, sceneBuildsRef, sceneSyncsRef, autoFitRef, cameraFitRef, fitWithoutTouchRef } = deps
  /**
   * **挂载期只建一次**：渲染器 / 场景 / 事件监听只该建一遍，父组件的任何重渲染都不重建它。
   * 这句话成立的前提是"它读的一切都经 ref"—— 组件把 props 与显示开关逐个镜像进 ref 就是为了这个
   *（见 `displayFlagsRef` / `onSelectRef` 一类）。
   *
   * 规则在这里报 40 个缺失依赖，是因为它**看不出入参是 ref**：本 hook 收的是一个 deps 对象，
   * 而不是在本函数里 `useRef` 出来的。ref 的身份稳定、setter 也稳定，真按它说的列全会
   * 每次渲染重建渲染器 —— 那不是修复，是把性能问题写进去。
   */
  useEffect(() => {
    const container = renderTargetRef.current
    if (!container) return

    const scene = new THREE.Scene()
    /**
     * 背景交给 CSS，不在这里填色。
     *
     * 用户要求"优化立体几何的 ui 设计，主要参考平面几何的 ui 设计"：纸底色、内沿阴影、纸纹与右上角水印
     * 都是**一条** CSS 规则（`data-canvas-surface="graph-paper"`，见 `styles/global.css`）。
     * 渲染器本来就是 `alpha: true`，把 `scene.background` 留空，画布就透出后面那层纸——
     * 纸色只有一处定义，改 CSS 就等于改了两边；在这里再填一个 `#fdfbf3` 就是第二个真源。
     */
    scene.background = null
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
     * 说明：下面这段是**跨阶段共享的稳定容器**：内容同步就地清空再填，取景 / 一帧绘制 / 指针处理都
     * 长期持有它们的引用，所以它们**不能**重新赋值，只能就地里改。内容同步本身已切到
     * `./threeSceneContent`。
     */

    /** 同步时刷新的闭包变量：render() 与指针处理函数都读它们。 */
    const pointHandles: THREE.Mesh[] = []
    const visiblePointLabels: Point3Primitive[] = []
    const measurementVisuals: NonNullable<ReturnType<typeof resolveMeasurementVisual>>[] = []
    const previewGroups = new Map<string, THREE.Group>()
    /** 本轮同步活着的预览：key → 预览内容（命中判定与状态栏都用它，避免每次线性查找）。 */
    const previewByKey = new Map<string, ThreeScenePreview>()
    const sceneBounds = new THREE.Box3()
    /**
     * 空间点索引与"子元素归属哪只模板实体"的映射：指针处理要用，随每次内容同步刷新。
     * **稳定容器**：内容同步就地 `clear` 后重填（见 `./threeSceneContent` 里那两行），交互阶段长期持有。
     */
    const points = new Map<string, Point3Primitive>()
    const topologyOwners = new Map<string, string>()
    /**
     * 三个场景对象 + 当前铺设半径。**稳定容器**：内容同步就地赋值（`keepContent`），栅格落位长期
     * 持有它 —— 别处重新赋值会让引用过期。
     */
    const grid: ThreeSceneGridHolder = { helper: null, majorHelper: null, axes: null, radius: 0 }
    /** 点驱动对象的索引：拖动绑定点时按 id 就地重建受影响的那些。 */
    const objectIndex = new Map<string, THREE.Object3D>()

    const currentContentKey = () => sceneContentKey({
      document: documentRef.current,
      selectedIds: selectedIdsRef.current,
      ...displayFlagsRef.current,
      // 预览由文档与选择派生，这里只把"有哪些预览"写进签名，便于排查"为什么内容没同步"。
      previewKeys: previewsRef.current.map((item) => `${item.key}:${item.kind}`).join("|")
    })

    const viewport = { height }
    /**
     * 曲线细分档位：`0.5px × 世界单位每像素` 量化成 2 的幂。
     *
     * 相机缩放**不会**触发内容同步（同步只认文档 / 选中 / 显示开关 / 预览），所以"放大后真圆的细分点变多"
     * 必须靠这个状态把缩放带进同步依赖里；量化成 2 的幂就是滞回——跨过一档才重建，不是每帧重建。
     * 实现（与"手柄按屏幕尺寸缩放"一起）在 `./threeSceneRender`。
     */

    /**
     * 栅格与坐标轴按当前相机与内容自动铺满可见范围。
     * 旧实现是"固定 14 格、以原点为中心、只按内容对角线取整"，于是内容离原点一远
     * （用户报告：点的坐标到 20 左右）就落在坐标面之外的空白里。
     */
    /**
     * 网格与坐标轴的落位在 `./threeSceneGrid`：收下那三个场景对象（稳定容器）、相机、包围盒、
     * 视口高度与 `sceneShell`，交出 `applyGridPlacement`（由 `render` 每帧调用）。
     */
    const { applyGridPlacement } = createThreeSceneGrid({ grid, camera, cameraStateRef, sceneBounds, viewport, sceneShell })
    /**
     * 一帧的绘制在 `./threeSceneRender`：它收下渲染器 / 场景 / 相机与三个**稳定容器**、点手柄容器与
     * 视口高度，以及仍定义在本函数里的网格落位。**曲线细分档位与手柄缩放也归它**（它们都是"每帧
     * 先做的一点点显示同步"），所以它交回 `syncPointHandleScales` 给下面的首次同步用。
     */
    const { render, syncPointHandleScales } = createThreeSceneRender({ renderer, scene, camera, cameraStateRef, sceneShell, autoFitRef, selectedIdsRef, measurementOverlayRef, pointLabelOverlayRef, measurementVisuals, visiblePointLabels, objectIndex, pointHandles, viewport, curveToleranceBucketRef, setCurveToleranceBucket, applyGridPlacement })
    /**
     * **内容同步**已切到 `./threeSceneContent`：按内容签名增量重建场景对象，并把这一轮的重建 / 沿用 /
     * 释放计数写进 `data-scene-*`；`refreshPrimitiveObject`（拖动绑定点时只重建那一个对象）与它共用
     * 同一张记录表，所以一起切了过去。它读写的那批跨阶段共享量都是上面那些**稳定容器**
     *（就地 `clear` / `push` / `copy`），因此传引用是安全的。
     *
     * **工厂调用排在这里**（而不是紧跟在容器声明之后）：同步里要用 `syncPointHandleScales` 先把点手柄
     * 按屏幕尺寸缩放、再算内容包围盒与面片尺寸，而那个函数由上面那行工厂交出 —— 排在它前面会撞上
     * 暂时性死区。
     */
    const { syncContent, refreshPrimitiveObject } = createThreeSceneContent({
      documentRef, selectedIdsRef, displayFlagsRef, previewsRef, previewHoverKeyRef, previewHoverRef,
      curveToleranceBucketRef, circleRadiusPreviewRef, rotationHandleRef, trackRadiusHandleRef,
      sceneSyncsRef, cameraStateRef, scene, camera, sceneShell, viewportSize, syncPointHandleScales,
      pointHandles, visiblePointLabels, measurementVisuals, previewGroups, previewByKey,
      sceneBounds, points, topologyOwners, objectIndex, grid
    })
    /**
     * **首次内容同步放在这里**（而不是 `syncContent` 定义之后立刻调用）：同步里要用到
     * `syncPointHandleScales` 把点手柄先按屏幕尺寸缩放，再算内容包围盒与面片尺寸——
     * 否则"刚建出来的手柄"还是初始尺寸，同一份内容会算出一个偏小的包围盒
     *（实测：三点建平面时自动半边长 7.02，而下一次同步同样内容算出 7.11）。
     *
     * 那个函数现在住在 `./threeSceneRender` 里，所以这一句必须排在**上面那两行工厂调用之后** ——
     * 排在前面会撞上暂时性死区（`const` 还没初始化），整个效应会直接抛错、什么都画不出来。
     */
    syncContent()
    /** Click tolerance in world units, so a grab is always the same number of pixels wide. */
    const pickTolerance = () => pointHandleWorldRadius(camera, cameraStateRef.current.distance, viewport.height, PICK_TOLERANCE_PX)
    /** 自由拖动：把对象沿屏幕平面平移的世界位移。深度不变，所以拖完图形还在原来的纵深上。 */
    const dragDeltaFor = (session: { anchor: THREE.Vector3; origin: THREE.Vector3 }, point: { x: number; y: number }): THREE.Vector3 | null => {
      const current = dragWorldPoint(camera, session.anchor, point)
      return current ? current.sub(session.origin) : null
    }
    /**
     * 相机的取景与动画在 `./threeSceneCamera`：它收下真相机 / ref / 渲染函数与**稳定**的
     * `sceneBounds`，并挂好"复位"与"取景"两个 ref；这里只留后面还要用的两个入口。
     */
    const { setCameraState, animateToFit, cancelFitAnimation } = createThreeSceneCamera({ camera, cameraStateRef, render, sceneBounds, resetCameraRef, fitCameraRef, fitWithoutTouchRef, contentKeyRef, documentRef, fittedDocumentRef, currentContentKey })
    render()
    // 场景重建后把进行中的拖动偏移补画回去，避免拖动中途回弹（见 resumeDragVisualRef）。
    resumeDragVisualRef.current()
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const next = viewportSize()
    viewport.height = next.height
      camera.aspect = next.width / next.height
      camera.updateProjectionMatrix()
      renderer.setSize(next.width, next.height, false)
      render()
    })
    resizeObserver?.observe(container)

    /**
     * 拖动期间的画面（半径预览 / 手柄落位 / 场景重建后补画）在 `./threeSceneDragVisuals`。
     * 调用方照旧把它挂进 `resumeDragVisualRef`：内容同步效应在签名变化时调它补画。
     */
    const { applyTrackRadiusPreview, clearTrackRadiusPreview, moveRotationHandles, resumeDragVisual } = createThreeSceneDragVisuals({
      scene, documentRef, dragSessionRef, trackRadiusHandleRef, rotationHandleRef, circleRadiusPreviewRef,
      points, refreshPrimitiveObject, render
    })
    resumeDragVisualRef.current = resumeDragVisual
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
    /**
     * 预览的悬停判定与高亮在 `./threeScenePreviewHover`：它收下相机、两张"稳定身份"的预览表与
     * 指针换算，交出两个监听器（注册与注销仍在本函数里，见下面的 addEventListener）。
     */
    const { raycasterAt, previewHitAt, handlePointerMoveForPreview, handlePointerLeaveForPreview } = createThreeScenePreviewHover({ camera, previewGroups, previewByKey, previewHoverKeyRef, previewHoverRef, sceneShell, pointFromEvent, pickTolerance })
    /**
     * 指针交互（按下 / 移动 / 抬起、拖拽会话、拾取判定）在 `./threeSceneInteraction`：约 380 行。
     * 依赖面宽是这一层的性质；三个监听器由下面的注册行使用。
     */
    const { handlePointerDown, handlePointerMove, handlePointerUp } = createThreeSceneInteraction({ 
cameraStateRef, panModeRef, dragModeRef, pointerStateRef, dragSessionRef, selectedIdsRef, dragEndRef, moveSectionRef, hostDragEndRef, rotateEndRef, trackRadiusEndRef, rotationHandleRef, trackRadiusHandleRef, circleRadiusPreviewRef, pickSectionFaceRef, documentRef, setFacePickMode, facePickModeRef, onSelectRef, previewClickRef, scene, camera, renderer, sceneShell, sceneBounds, points, topologyOwners, refreshPrimitiveObject, render, pickTolerance, dragDeltaFor, setCameraState, applyTrackRadiusPreview, clearTrackRadiusPreview, moveRotationHandles, pointFromEvent, raycasterAt, previewHitAt
 })
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
      /**
       * 卸载前把视角记下来：工作区来回切换时才能回到用户离开时的样子。
       *
       * 这里**必须**读 `documentRef.current` 的最新值（"卸载那一刻是哪份文档"），规则提示
       * "ref 到 cleanup 时可能已经变了"说的正是我们要的那件事 —— 所以不改写法，只说明原因。
       */
      // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 入参是 ref（见上面那段说明），规则看不出
  }, [])
}
