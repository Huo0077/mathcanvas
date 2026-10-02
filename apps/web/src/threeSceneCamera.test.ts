import * as THREE from "three"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createThreeSceneCamera, type FitAnimationState } from "./threeSceneCamera"
import { FIT_ANIMATION_MS, resetCameraState } from "./threeCamera"
import type { CameraState } from "./threeCamera"

/**
 * **取景动画的三态与"取消后不再有帧"**（`threeSceneCamera.ts` 的第一个单测文件）。
 *
 * 为什么单独测这个模块：它的行为是"**按时间推进的帧循环**"，而 e2e 只能从外面看结果
 * （`data-fit-animation` 从 running 变 cancelled）。"取消之后到底还有没有帧在跑"这件事
 * 在浏览器外面看不见，只能在这里用受控的 rAF 直接钉住。
 *
 * 复现手法：自己接管 `requestAnimationFrame` / `cancelAnimationFrame` 与 `performance.now`。
 * 交给假定时器反而看不清"取消之后还有没有帧"—— 被取消的帧在真实浏览器里就是**不会执行**。
 */
describe("three scene camera fit animation", () => {
  let pending: Map<number, FrameRequestCallback>
  let nextFrameId: number
  let now: number
  let framesRun: number
  let states: FitAnimationState[]
  let originalRaf: typeof globalThis.requestAnimationFrame
  let originalCancel: typeof globalThis.cancelAnimationFrame
  let originalNow: () => number

  /** 跑掉当前排队的帧（真实 rAF 一帧一次；被取消的帧已经不在表里，所以不会跑）。 */
  const flushFrame = () => {
    const queued = [...pending.entries()]
    pending.clear()
    for (const [, callback] of queued) {
      framesRun += 1
      callback(now)
    }
  }

  const harness = () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
    const initial = resetCameraState()
    const stateRef = { current: initial }
    const bounds = new THREE.Box3()
    bounds.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 4, 4))
    const noop = { current: () => undefined }

    const cameraTools = createThreeSceneCamera({
      camera,
      cameraStateRef: stateRef,
      render: () => undefined,
      sceneBounds: bounds,
      resetCameraRef: noop,
      fitCameraRef: noop,
      fitWithoutTouchRef: noop,
      contentKeyRef: { current: "key" },
      documentRef: { current: { metadata: { id: "doc-1" } } as never },
      fittedDocumentRef: { current: null },
      currentContentKey: () => "key",
      onFitAnimationChange: (state) => states.push(state)
    })

    return { cameraTools, stateRef, initial }
  }

  const snapshot = (state: { current: CameraState }) => ({ ...state.current })

  beforeEach(() => {
    pending = new Map()
    nextFrameId = 1
    now = 0
    framesRun = 0
    states = []
    originalRaf = globalThis.requestAnimationFrame
    originalCancel = globalThis.cancelAnimationFrame
    originalNow = performance.now.bind(performance)
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      const id = nextFrameId
      nextFrameId += 1
      pending.set(id, callback)
      return id
    }) as typeof globalThis.requestAnimationFrame
    globalThis.cancelAnimationFrame = ((id: number) => { pending.delete(id) }) as typeof globalThis.cancelAnimationFrame
    performance.now = () => now
  })

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRaf
    globalThis.cancelAnimationFrame = originalCancel
    performance.now = originalNow
  })

  it("reports running while interpolating and done when it reaches the fitted state", () => {
    const { cameraTools, stateRef } = harness()

    cameraTools.animateToFit()
    expect(states).toEqual(["running"])

    now = FIT_ANIMATION_MS / 2
    flushFrame()
    const midway = snapshot(stateRef)
    expect(midway).not.toEqual(resetCameraState())

    now = FIT_ANIMATION_MS
    flushFrame()   // ratio = 1 -> 不再排下一帧
    expect(states).toEqual(["running", "done"])
    expect(pending.size).toBe(0)
  })

  it("reports cancelled and stops scheduling frames, so the fit cannot overwrite the user", () => {
    const { cameraTools, stateRef } = harness()

    cameraTools.animateToFit()
    now = FIT_ANIMATION_MS / 2
    flushFrame()
    const atCancel = snapshot(stateRef)
    expect(pending.size).toBe(1)   // 动画还在跑

    cameraTools.cancelFitAnimation()
    expect(states).toEqual(["running", "cancelled"])
    expect(pending.size).toBe(0)

    // 取消之后即使时间继续走、再怎么刷帧，相机也不动了 —— 这正是"用户拖完不会被覆盖"的那条性质。
    const framesBefore = framesRun
    now = FIT_ANIMATION_MS * 4
    flushFrame()
    flushFrame()
    expect(framesRun).toBe(framesBefore)
    expect(snapshot(stateRef)).toEqual(atCancel)
  })

  it("does not report cancelled when nothing was running", () => {
    const { cameraTools } = harness()

    cameraTools.cancelFitAnimation()

    expect(states).toEqual([])
  })
})
