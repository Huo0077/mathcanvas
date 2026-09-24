import type { RefObject } from "react"
import * as THREE from "three"

import { boxCorners, type CameraState } from "./threeCamera"
import { GRID_MAJOR_COLOR, GRID_MINOR_COLOR, buildGridGeometry, gridLayerOpacity } from "./threeGrid"
import { gridPlacement } from "./sceneGrid"

/**
 * **网格与坐标轴的落位**（从 `threeSceneEffect.ts` 里按阶段切出来的第四块，评审方案 2）。
 *
 * 每帧由 `render` 调用一次：按**当前相机与内容范围**算一份铺设（`gridPlacement`），覆盖半径跨档时
 * 换一份网格几何，按"一格占多少像素"调两层网格的透明度，并把读数写进 `dataset`。
 *
 * ## 两条写在这里的不变量
 *
 * 1. **坐标轴只缩放、绝不挪位置**：它是"世界原点在哪"的标记。栅格可以跟着内容走（覆盖要够），
 *    但零点只有一个、它不动。实测过一走就错 —— 内容挪到 (8,8) 后自动取景把视点中心带到 (10,10)，
 *    曾经这里跟着写了 `position.set(placement.centre...)`，坐标轴被画到 (10,10,0)，离真正的原点
 *    **191 像素**（`e2e/three-origin-marker.spec.ts` 守这条）。
 * 2. **只在覆盖半径跨档时换几何**（1 格 = 1 单位）：同一档内缩放时栅格位置与尺寸都不动 ——
 *    这正是用户要的"缩放不改变网格大小"，也避免每帧重建几何。
 *
 * 另外把 `axesOrigin` / `gridColors` 等读数写进 `dataset`：前者让上面那条不变量能被断言，
 * 后者让 e2e 能把格线色与平面几何的 CSS 令牌**逐字比对**（three.js 读不到 CSS 变量，颜色各写一份）。
 */

/** 三个场景对象 + 当前铺设半径（**稳定容器**：内容同步就地赋值，别处长期持有）。 */
export interface ThreeSceneGridHolder {
  helper: THREE.LineSegments | null
  majorHelper: THREE.LineSegments | null
  axes: THREE.AxesHelper | null
  radius: number
}

export interface ThreeSceneGridDeps {
  grid: ThreeSceneGridHolder
  camera: THREE.PerspectiveCamera
  cameraStateRef: RefObject<CameraState>
  /** 场景内容包围盒（**身份稳定**，内容同步用 `copy` 就地更新）。 */
  sceneBounds: THREE.Box3
  /** 视口高度（像素）。**稳定对象**，`height` 就地更新。 */
  viewport: { height: number }
  sceneShell: HTMLDivElement | null
}

export function createThreeSceneGrid({ grid, camera, cameraStateRef, sceneBounds, viewport, sceneShell }: ThreeSceneGridDeps) {
  const applyGridPlacement = () => {
    if (!grid.helper && !grid.axes) return
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
    if (placement.extent !== grid.radius) {
      grid.radius = placement.extent
      for (const [layer, options] of [[grid.helper, { skipMultiplesOf: placement.majorEvery }], [grid.majorHelper, { every: placement.majorEvery }]] as const) {
        if (!layer) continue
        layer.geometry.dispose()
        layer.geometry = buildGridGeometry(placement.extent, options)
      }
    }
    // 一格在屏幕上占多少像素：细线太密时淡出，主线在更远时才淡出，间距仍然是精确的 10 个单位。
    const pixelsPerUnit = viewport.height / (2 * Math.max(state.distance, 1e-4) * Math.tan((camera.fov * Math.PI) / 360))
    if (grid.helper) {
      grid.helper.position.set(placement.centre.x, placement.centre.y, 0)
      ;(grid.helper.material as THREE.LineBasicMaterial).opacity = gridLayerOpacity(pixelsPerUnit)
    }
    if (grid.majorHelper) {
      grid.majorHelper.position.set(placement.centre.x, placement.centre.y, 0)
      ;(grid.majorHelper.material as THREE.LineBasicMaterial).opacity = gridLayerOpacity(pixelsPerUnit * placement.majorEvery)
    }
    if (grid.axes) {
      /**
       * **只缩放，不挪位置。** 坐标轴就是"世界原点在哪"的标记：栅格可以跟着内容走（覆盖范围要够），
       * 但零点只有一个，而且它不动。
       *
       * 实测过一走就错：内容挪到 (8,8) 后自动取景把视点中心带到 (10,10)，曾经这里跟着写了一句
       * `position.set(placement.centre...)`，于是坐标轴被画在 (10,10,0)——离真正的原点 **191 像素**，
       * 用户看到的就是"原点位置错了、图有点怪"（`e2e/three-origin-marker.spec.ts` 守这条不变量）。
       */
      grid.axes.scale.setScalar(placement.axesLength)
    }
    if (sceneShell) {
      /**
       * 坐标轴对象的**世界位置**读数。它必须恒为世界原点 `0,0,0`——坐标轴就是"原点在哪"的标记，
       * 跟着栅格中心跑就等于告诉用户一个错的零点（实测：内容挪到 (8,8) 之后坐标轴离真正的原点
       * **191 像素**）。把它交出来，这条不变量才能被断言。
       */
      sceneShell.dataset.axesOrigin = grid.axes ? `${grid.axes.position.x.toFixed(3)},${grid.axes.position.y.toFixed(3)},${grid.axes.position.z.toFixed(3)}` : ""
      sceneShell.dataset.gridCell = String(placement.cell)
      sceneShell.dataset.gridMajor = String(placement.majorEvery)
      sceneShell.dataset.gridCentre = `${placement.centre.x},${placement.centre.y}`
      sceneShell.dataset.gridExtent = String(placement.extent)
      sceneShell.dataset.axesLength = String(placement.axesLength)
      /**
       * 栅格颜色读数：立体几何的格线色与平面几何的 CSS 令牌**两端同源**（`--color-graph-grid-minor/major`）。
       * three.js 读不到 CSS 变量，所以颜色各写了一份——把这个值暴露出来，e2e 才能拿它与
       * `getComputedStyle` 读到的令牌值逐字比对，而不是靠肉眼看两张截图。
       */
      sceneShell.dataset.gridColors = `${GRID_MINOR_COLOR},${GRID_MAJOR_COLOR}`
    }
  }

  return { applyGridPlacement }
}
