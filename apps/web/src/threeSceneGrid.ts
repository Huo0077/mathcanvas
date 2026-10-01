import type { RefObject } from "react"
import * as THREE from "three"

import { boxCorners, type CameraState } from "./threeCamera"
import { GRID_MAJOR_COLOR, GRID_MINOR_COLOR, buildGridGeometry, gridFadeBand, gridLayerOpacity } from "./threeGrid"
import { gridPlacement } from "./sceneGrid"

/**
 * **网格与坐标轴的落位**（从 `threeSceneEffect.ts` 里按阶段切出来的第四块，评审方案 2）。
 *
 * 每帧由 `render` 调用一次：按**当前相机与内容范围**算一份铺设（`gridPlacement`），覆盖半径跨档时
 * 换一份网格几何，按"一格占多少像素"调两层网格的透明度，并把读数写进 `dataset`。
 *
 * ## 三条写在这里的不变量
 *
 * 1. **坐标轴只缩放、绝不挪位置**：它是"世界原点在哪"的标记。栅格可以跟着内容走（覆盖要够），
 *    但零点只有一个、它不动。实测过一走就错 —— 内容挪到 (8,8) 后自动取景把视点中心带到 (10,10)，
 *    曾经这里跟着写了 `position.set(placement.centre...)`，坐标轴被画到 (10,10,0)，离真正的原点
 *    **191 像素**（`e2e/three-origin-marker.spec.ts` 守这条）。
 * 2. **只在覆盖半径跨档时换几何**（1 格 = 1 单位）：同一档内缩放时栅格位置与尺寸都不动 ——
 *    这正是用户要的"缩放不改变网格大小"，也避免每帧重建几何。
 * 3. **覆盖范围要盖住可见地面脚印，且淡出区落在脚印之外**（2026-10-01 新增）。
 *    用户口径："把 0 平面也就是 z=0 的格子网做成无限延伸的感觉。"栅格铺不到无穷远，
 *    但可以让它**在到达边界之前化开**：`gridPlacement` 按脚印倒推档位（满实区必须盖住脚印），
 *    材质里按"到块中心的距离"`smoothstep` 到 0 —— 于是那块方块的直边永远看不见。
 *
 * 另外把 `axesOrigin` / `gridColors` / `gridFade` 等读数写进 `dataset`：前者让上面那条不变量能被断言，
 * 后者让 e2e 能把格线色与平面几何的 CSS 令牌**逐字比对**（three.js 读不到 CSS 变量，颜色各写一份），
 * 以及断言"淡出起点不早于可见脚印"。
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

/**
 * **可见地面脚印**：z=0 平面与视锥的交里，离视点中心最远的那个交点到中心的距离。
 *
 * 为什么不能只看视口的宽高：贴地视角（相机压得很低）时 z=0 平面在画面上一直延伸到地平线，
 * 可见区域在**世界坐标**里比"视口宽高"远得多 —— 只按视口宽高铺，方块边界就会进画面。
 *
 * 做法：取样 9 条射线（3×3：四角 + 四边中点 + 中心）各自与 z=0 求交。
 * - 射线不朝下（`direction.z >= 0`）或交点在相机背后：这个方向没有可见地面，跳过；
 * - 交点离中心多远就记多远，取最大值。
 *
 * 纯函数（只吃相机与中心），所以能脱离浏览器单测。
 */
export function groundFootprintReach(camera: THREE.PerspectiveCamera, centre: { x: number; y: number }): number {
  const origin = camera.position
  camera.updateMatrixWorld()
  const corner = new THREE.Vector3()
  let reach = 0
  for (const ndcX of [-1, 0, 1]) {
    for (const ndcY of [-1, 0, 1]) {
      corner.set(ndcX, ndcY, 0.5).unproject(camera)
      const direction = corner.sub(origin)
      const length = direction.length()
      if (!Number.isFinite(length) || length < 1e-9) continue
      direction.divideScalar(length)
      // 只认"朝下"的射线：平地相机（`direction.z == 0`）与朝天看都没有可见地面。
      if (direction.z >= -1e-9) continue
      const distance = -origin.z / direction.z
      if (!(distance > 0) || !Number.isFinite(distance)) continue
      const hitX = origin.x + direction.x * distance
      const hitY = origin.y + direction.y * distance
      if (!Number.isFinite(hitX) || !Number.isFinite(hitY)) continue
      reach = Math.max(reach, Math.hypot(hitX - centre.x, hitY - centre.y))
    }
  }
  return reach
}

export function createThreeSceneGrid({ grid, camera, cameraStateRef, sceneBounds, viewport, sceneShell }: ThreeSceneGridDeps) {
  const applyGridPlacement = () => {
    if (!grid.helper && !grid.axes) return
    const state = cameraStateRef.current
    const span = sceneBounds.isEmpty() ? 0 : sceneBounds.getSize(new THREE.Vector3()).length()
    const reach = sceneBounds.isEmpty() ? 0 : Math.max(...boxCorners(sceneBounds).map((corner) => Math.hypot(corner.x, corner.y)))
    /**
     * 脚印按**吸附后的中心**算：中心本身就是整格吸附的，用未吸附的 target 会让脚印随平移抖。
     * （`gridPlacement` 内部做同样的吸附，这里先算一份只是为了喂给它。）
     */
    const centreCandidate = { x: Math.round(state.target.x), y: Math.round(state.target.y) }
    const groundReach = groundFootprintReach(camera, centreCandidate)
    const placement = gridPlacement({
      distance: state.distance,
      fovDegrees: camera.fov,
      aspect: camera.aspect,
      target: state.target,
      contentSpan: span,
      contentReach: reach,
      groundReach
    })
    /**
     * 1 格 = 1 单位：几何本身按整数格建好，所以这里**只在覆盖半径跨档时**换一份几何。
     * 同一档内缩放，栅格的位置与尺寸都不动——这正是用户要的"缩放不改变网格大小"。
     */
    if (placement.extent !== grid.radius) {
      grid.radius = placement.extent
      for (const [layer, options] of [[grid.helper, { skipMultiplesOf: placement.majorEvery, color: GRID_MINOR_COLOR }], [grid.majorHelper, { every: placement.majorEvery, color: GRID_MAJOR_COLOR }]] as const) {
        if (!layer) continue
        layer.geometry.dispose()
        layer.geometry = buildGridGeometry(placement.extent, { ...options, fade: gridFadeBand(placement.extent) })
      }
    }
    // 一格在屏幕上占多少像素：细线太密时淡出，主线在更远时才淡出，间距仍然是精确的 10 个单位。
    const pixelsPerUnit = viewport.height / (2 * Math.max(state.distance, 1e-4) * Math.tan((camera.fov * Math.PI) / 360))
    /**
     * 两层线共用的**距离淡出**端点（世界单位）：到 `end`（= 覆盖半径）处透明度正好为 0，
     * 所以方块的直边看不见。最终 alpha 是"密度淡出"（一格占多少像素）× 这里的"距离淡出"。
     */
    const band = gridFadeBand(placement.extent)
    const styleLayer = (layer: THREE.LineSegments | null, opacity: number) => {
      if (!layer) return
      layer.position.set(placement.centre.x, placement.centre.y, 0)
      ;(layer.material as THREE.LineBasicMaterial).opacity = opacity
      // 已回退到 LineBasicMaterial：透明度直接写在上面的材质上
      // （着色器版的径向淡出撤回了：它编译通过却没画出来，见 CHANGELOG 同日一节）
      // 读数 data-grid-fade 仍然照给，供排查用
    }
    styleLayer(grid.helper, gridLayerOpacity(pixelsPerUnit))
    styleLayer(grid.majorHelper, gridLayerOpacity(pixelsPerUnit * placement.majorEvery))
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
       * 淡出区间与可见脚印的读数：e2e 靠它断言"满实区盖住了可见地面脚印"
       *（`fadeStart >= groundReach`）—— 这条不成立的话，方块那条边就会在画面上化开。
       */
      sceneShell.dataset.gridFade = `${band.start.toFixed(2)},${band.end.toFixed(2)}`
      sceneShell.dataset.gridGroundReach = groundReach.toFixed(2)
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
