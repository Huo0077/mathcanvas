import type { Dispatch, RefObject, SetStateAction } from "react"
import * as THREE from "three"

import type { Point3Primitive } from "@draw/dsl"

import { curveToleranceFor, toleranceBucket } from "./conicSampling"
import { pointLabelPlacements } from "./pointLabels"
import { syncOverlay } from "./overlaySync"
import { resolveMeasurementVisual } from "./measurementVisuals"
import { pointHandleWorldRadius } from "./threePicking"
import type { CameraState } from "./threeCamera"
import type { ThreeSceneViewProps } from "./threeScene"

/**
 * **一帧的绘制**（从 `threeSceneEffect.ts` 里按阶段切出来的第三块，评审方案 2）。
 *
 * `render` 做四件事，顺序不能乱：先把点手柄按屏幕尺寸缩放到当前距离、再看缩放有没有跨过容差档位
 *（跨了才让下一次内容同步重算曲线）、摆好网格，然后**把测量标签与点标签投影到屏幕上**（两层 HTML
 * 覆盖层，用 `syncOverlay` 做增量 diff），最后把相机读数写回 DOM 供 e2e 与排查读，最后才真正
 * `renderer.render`。
 *
 * ## 两条写在这里的口径
 *
 * 1. **覆盖层是 DOM，不是 WebGL**：标签用 `project()` 算屏幕坐标后交给 CSS 定位，所以它跟着相机走
 *    却不受渲染分辨率影响。每一步都靠 `syncOverlay` 增量更新（键相同的节点原地复用）。
 * 2. **相机读数写进 `dataset`**：自动取景开关、距离、方位角、仰角都写出去 —— e2e 与排查都读它，
 *    不靠肉眼。
 *
 * ## 依赖里那三个数组是"稳定容器"
 *
 * `measurementVisuals` / `visiblePointLabels` / `objectIndex` 原来由内容同步**重新赋值**
 *（`= []` / `= new Map()`），为了让本模块能长期持有它们，内容同步改成**就地更新**
 *（`.length = 0` + `push` / `.clear()`）。语义不变：两边读的都是"当前这一份"，只是引用不再换。
 */

export interface ThreeSceneRenderDeps {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  cameraStateRef: RefObject<CameraState>
  sceneShell: HTMLDivElement | null
  autoFitRef: RefObject<boolean>
  selectedIdsRef: RefObject<string[]>
  measurementOverlayRef: RefObject<HTMLDivElement | null>
  pointLabelOverlayRef: RefObject<HTMLDivElement | null>
  /** 测量标签的**稳定容器**（内容同步就地更新，见文件头）。 */
  measurementVisuals: NonNullable<ReturnType<typeof resolveMeasurementVisual>>[]
  /** 可见空间点的**稳定容器**（同上）。 */
  visiblePointLabels: Point3Primitive[]
  /** 图元 id → 场景对象（同上，`Map` 就地 `clear` + `set`）。 */
  objectIndex: Map<string, THREE.Object3D>
  /** 点手柄的**稳定容器**：内容同步就地 push / 移除，本模块只负责按相机距离缩放。 */
  pointHandles: THREE.Mesh[]
  /** 当前视口高度（像素）。**稳定对象**，`height` 就地更新（缩放/改窗口时）。 */
  viewport: { height: number }
  /** 曲线细分档位：由本模块的 `syncCurveToleranceBucket` 写、由内容同步读（跨阶段共享，因此走 ref + setter）。 */
  curveToleranceBucketRef: RefObject<number>
  setCurveToleranceBucket: Dispatch<SetStateAction<number | null>>
  /** 网格与坐标轴的落位仍定义在运行时模块里，按依赖传进来（本模块只负责调用顺序）。 */
  applyGridPlacement: () => void
  onPreviewHoverChange?: ThreeSceneViewProps["onPreviewHover"]
}

export function createThreeSceneRender({ renderer, scene, camera, cameraStateRef, sceneShell, autoFitRef, selectedIdsRef, measurementOverlayRef, pointLabelOverlayRef, measurementVisuals, visiblePointLabels, objectIndex, pointHandles, viewport, curveToleranceBucketRef, setCurveToleranceBucket, applyGridPlacement }: ThreeSceneRenderDeps) {
  const syncCurveToleranceBucket = () => {
    const bucket = toleranceBucket(curveToleranceFor(camera, cameraStateRef.current.distance, viewport.height))
    curveToleranceBucketRef.current = bucket
    setCurveToleranceBucket((previous) => (previous === bucket ? previous : bucket))
  }
  const syncPointHandleScales = () => {
    /**
     * 手柄的世界半径按**相机到视点中心的距离**统一取，而不是逐个手柄按各自深度取：
     * 逐个取深度会让近处手柄小、远处手柄大，于是内容包围盒变得**不对称**——
     * 而包围盒既驱动自动取景（中心就是相机的 target）又驱动平面片的自动尺寸，
     * 中心会因此偏掉（实测立方体自动取景后 target 是 -0.01,-0.01,-0.00 而不是 0,0,0）。
     * 统一取值同时还让"画出来的手柄"与"拾取容差"（下面 pickTolerance 用的是同一个量）一致。
     */
    const radius = pointHandleWorldRadius(camera, cameraStateRef.current.distance, viewport.height)
    for (const handle of pointHandles) handle.scale.setScalar(radius)
  }

  const render = () => {
    syncPointHandleScales()
    // 缩放会改变曲线的误差容差：档位一变就让同步重算（跨不到一档就不重建）。
    syncCurveToleranceBucket()
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
            // 选中这条测量时标签高亮：常驻之后"我选中的是哪一条"必须还看得出（`data-selected` 由 CSS 用）。
            dataset: { measurementId: visual.id, selected: String(visual.sourceIds.some((id) => selectedIdsRef.current.includes(id))) }
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
        pointLabelPlacements(visiblePointLabels, (id) => objectIndex.get(id), camera, bounds),
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

  /** `syncPointHandleScales` 也要给出去：内容同步在算包围盒之前要先把手柄缩放到位。 */
  return { render, syncPointHandleScales }
}
