import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { FIT_MARGIN, fitCameraState, interpolateCameraState, isContentOutOfView, shouldAutoFit, type CameraState } from "./threeCamera"

const camera = () => new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 1000)
const state = (overrides: Partial<CameraState> = {}): CameraState => ({ azimuth: 45, elevation: 30, distance: 16, target: { x: 0, y: 0, z: 0 }, ...overrides })
const box = (size: [number, number, number], centre: [number, number, number] = [0, 0, 0]) => {
  const half = size.map((value) => value / 2) as [number, number, number]
  return new THREE.Box3(
    new THREE.Vector3(centre[0] - half[0], centre[1] - half[1], centre[2] - half[2]),
    new THREE.Vector3(centre[0] + half[0], centre[1] + half[1], centre[2] + half[2])
  )
}
/** 把相机摆到某个相机状态上（与组件里 applyCameraState 的做法一致），用于投影检验。 */
function placeCamera(target: THREE.PerspectiveCamera, fitted: CameraState) {
  const vertical = (fitted.elevation * Math.PI) / 180
  const horizontal = (fitted.azimuth * Math.PI) / 180
  const cos = Math.cos(vertical)
  target.position.set(
    fitted.target.x + fitted.distance * cos * Math.cos(horizontal),
    fitted.target.y + fitted.distance * cos * Math.sin(horizontal),
    fitted.target.z + fitted.distance * Math.sin(vertical)
  )
  target.up.set(0, 0, 1)
  target.lookAt(fitted.target.x, fitted.target.y, fitted.target.z)
  target.updateMatrixWorld(true)
  target.updateProjectionMatrix()
  return target
}
function maxAbsNdc(bounds: THREE.Box3, fitted: CameraState) {
  const placed = placeCamera(camera(), fitted)
  const min = bounds.min
  const max = bounds.max
  let worst = 0
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        const projected = new THREE.Vector3(x, y, z).project(placed)
        worst = Math.max(worst, Math.abs(projected.x), Math.abs(projected.y))
      }
    }
  }
  return worst
}

describe("camera auto-fit", () => {
  it("keeps every corner inside the frustum and leaves a 30% margin", () => {
    const bounds = box([4, 4, 2])
    const fitted = fitCameraState(state(), bounds, camera())

    // 视角不变，只挪视点中心与距离。
    expect(fitted.azimuth).toBe(45)
    expect(fitted.elevation).toBe(30)
    expect(fitted.target).toEqual({ x: 0, y: 0, z: 0 })

    const worst = maxAbsNdc(bounds, fitted)
    expect(worst).toBeLessThanOrEqual(1)
    // 30% 边距 ⇒ 最紧的那一轴约占满 70%；既能证明边距生效，也能证明没有退得太远。
    expect(worst).toBeLessThanOrEqual(0.7001)
    expect(worst).toBeGreaterThan(0.6)
  })

  it("fits an elongated box far tighter than the old bounding-sphere maths", () => {
    const bounds = box([20, 0.2, 0.2])
    const fitted = fitCameraState(state(), bounds, camera())
    const radius = bounds.getSize(new THREE.Vector3()).length() / 2
    const vertical = (42 * Math.PI) / 360
    const horizontal = Math.atan(Math.tan(vertical) * (16 / 9))
    const sphereFit = Math.max(radius / Math.sin(vertical), radius / Math.sin(horizontal)) * 1.25

    expect(fitted.distance).toBeLessThan(sphereFit)
    expect(maxAbsNdc(bounds, fitted)).toBeLessThanOrEqual(1)
  })

  it("allows a tiny figure to be framed closely, which the old [3, 60] clamp prevented", () => {
    const fitted = fitCameraState(state(), box([0.01, 0.01, 0.01]), camera())

    expect(fitted.distance).toBeLessThan(3)
    expect(fitted.distance).toBeGreaterThanOrEqual(0.005)
    expect(maxAbsNdc(box([0.01, 0.01, 0.01]), fitted)).toBeGreaterThan(0.6)
  })

  it("falls back to the default view for an empty scene", () => {
    expect(fitCameraState(state(), new THREE.Box3(), camera()).distance).toBe(16)
  })
})

describe("content out of view", () => {
  it("detects a figure outside the frustum and accepts one inside it", () => {
    const fitted = fitCameraState(state(), box([4, 4, 2]), camera())
    const inside = box([4, 4, 2])

    expect(isContentOutOfView(fitted, inside, camera())).toBe(false)
    expect(isContentOutOfView(fitted, box([4, 4, 2], [200, 0, 0]), camera())).toBe(true)
    expect(isContentOutOfView(fitted, new THREE.Box3(), camera())).toBe(false)
  })
})

describe("camera interpolation", () => {
  it("walks from one state to the other", () => {
    const from = state({ distance: 10, target: { x: 0, y: 0, z: 0 } })
    const to = state({ distance: 20, target: { x: 2, y: -2, z: 1 } })

    expect(interpolateCameraState(from, to, 0)).toEqual(from)
    expect(interpolateCameraState(from, to, 1)).toEqual(to)
    expect(interpolateCameraState(from, to, 0.5)).toMatchObject({ distance: 15, target: { x: 1, y: -1, z: 0.5 } })
    // 越界的 t 被夹到 [0,1]，不会把相机甩出去。
    expect(interpolateCameraState(from, to, 3)).toEqual(to)
    expect(interpolateCameraState(from, to, -1)).toEqual(from)
  })
})

describe("auto-fit policy", () => {
  const inputs = (overrides: Partial<Parameters<typeof shouldAutoFit>[0]> = {}) => ({
    enabled: true,
    dragging: false,
    documentChanged: false,
    outOfView: false,
    ...overrides
  })

  it("never fires while disabled or during a drag", () => {
    expect(shouldAutoFit(inputs({ enabled: false, documentChanged: true, outOfView: true }))).toBe(false)
    expect(shouldAutoFit(inputs({ dragging: true, documentChanged: true, outOfView: true }))).toBe(false)
  })

  it("fires when the document changed or the content is out of view", () => {
    expect(shouldAutoFit(inputs({ documentChanged: true }))).toBe(true)
    expect(shouldAutoFit(inputs({ outOfView: true }))).toBe(true)
  })

  it("stays out of the way while the user is only editing", () => {
    // 这条是实测回归换来的：只要"编辑也拟合"，拖动实体会把相机一起拖走、移动截面会让视角跳、
    // 按已知屏幕坐标点击的用例全部失准（7 条既有浏览器流程）。
    expect(shouldAutoFit(inputs())).toBe(false)
  })
})

describe("fit margin constant", () => {
  it("is the documented 30%", () => {
    expect(FIT_MARGIN).toBeCloseTo(0.3, 10)
  })
})
