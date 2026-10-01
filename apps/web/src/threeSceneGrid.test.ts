import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { groundFootprintReach } from "./threeSceneGrid"

/**
 * **可见地面脚印**的求法（z=0 平面与视锥的交，取离中心最远的交点）。
 *
 * 它是"栅格无限延伸"那件事的**第一半**：覆盖半径必须按它来铺，否则贴地视角下方块的直边会进画面。
 * 纯函数（只吃相机与中心），所以这里用真的 `PerspectiveCamera` 直接喂姿态 —— 不需要浏览器。
 */
function cameraAt(position: [number, number, number], lookAt: [number, number, number], fov = 90, aspect = 1) {
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000)
  camera.position.set(...position)
  camera.lookAt(new THREE.Vector3(...lookAt))
  camera.updateMatrixWorld(true)
  return camera
}

describe("ground footprint of the visible frustum", () => {
  it("measures the ground directly under a top-down camera", () => {
    // 相机在 z = 10 垂直向下、fov = 90°、aspect = 1：看得见的是 20×20 的地面，最远的角离中心 10√2。
    const reach = groundFootprintReach(cameraAt([0, 0, 10], [0, 0, 0]), { x: 0, y: 0 })

    expect(reach).toBeCloseTo(10 * Math.SQRT2, 1)
  })

  it("sees no ground at all when the camera looks at the sky", () => {
    // 全部射线朝上 ⇒ 与 z=0 没有交点。这里必须是 0，而不是 NaN 或一个巨大的数。
    const reach = groundFootprintReach(cameraAt([0, 5, 0], [0, 50, 0]), { x: 0, y: 0 })

    expect(reach).toBe(0)
  })

  it("sees far more ground from a grazing angle than from above", () => {
    const overhead = groundFootprintReach(cameraAt([0, 0, 20], [0, 0, 0]), { x: 0, y: 0 })
    /**
     * 几乎贴地、只朝下偏一点点（世界 Z 朝上，所以"朝下"= 看向比自己更低的 z）。
     * 地平线方向的射线交点很远 —— 这正是"只看视口宽高会铺不够"的场景。
     */
    const grazing = groundFootprintReach(cameraAt([0, 0, 0.5], [0, 20, 0.4]), { x: 0, y: 0 })

    expect(grazing).toBeGreaterThan(overhead)
    expect(Number.isFinite(grazing)).toBe(true)
  })

  it("measures from the given centre, not from the projection of the camera", () => {
    // 视点中心挪到 (50,0) 时，脚印的半径要**相对它**算：这是"栅格跟着视点中心走"的前提。
    const camera = cameraAt([0, 0, 10], [0, 0, 0])
    const centred = groundFootprintReach(camera, { x: 0, y: 0 })
    const shifted = groundFootprintReach(camera, { x: 50, y: 0 })

    expect(shifted).toBeGreaterThan(centred)
    expect(shifted).toBeGreaterThan(50)
  })
})
