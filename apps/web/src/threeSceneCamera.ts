import type { RefObject } from "react"
import * as THREE from "three"

import { loadRememberedCamera } from "./cameraMemory"
import { applyCameraState, FIT_ANIMATION_MS, fitCameraState, interpolateCameraState, resetCameraState, type CameraState } from "./threeCamera"
import { prefersReducedMotion } from "./threePrimitives"
import type { ThreeSceneViewProps } from "./threeScene"

/**
 * **相机的取景与动画**（从 `threeSceneEffect.ts` 里按阶段切出来的第一块，评审方案 2）。
 *
 * 三件事：把一份 `CameraState` 落到真相机（`setCameraState`）、"复位/取景"两个入口挂到 ref 上
 *（外部按钮与自动取景都经这两个 ref 调用）、以及约 250ms 的取景过渡（`prefersReducedMotion`
 * 时直接跳变）。
 *
 * ## 两条写在这里的口径
 *
 * 1. **自动取景不标记"用户动过相机"**：过渡里直接写 `cameraStateRef`，不走 `setCameraState`
 *    —— 后者的语义是"用户改了视角"，而自动取景不该把用户的相机记忆覆盖掉。
 * 2. **只在换了文档时取景**（`fittedDocumentRef` 与当前文档 id 比对）：编辑过程中重新取景
 *    会跟用户自己的相机操作打架。从别的视角回到同一份文档也不算"新文档"——记着视角就别再取景。
 *
 * ## 依赖面
 *
 * 全部是**身份稳定**的东西：ref、THREE 对象、以及两个函数（`render` / `currentContentKey`）。
 * `sceneBounds` 也传对象本身 —— 它原来是"每次内容同步重新赋值"的 `let`，为了让这块能收下它，
 * 内容同步改成了 `sceneBounds.copy(...)`（同一只盒子就地更新），于是这里永远读到最新的边界。
 */

export interface ThreeSceneCameraDeps {
  camera: THREE.PerspectiveCamera
  cameraStateRef: RefObject<CameraState>
  render: () => void
  /** 场景内容的包围盒。**身份稳定**，内容同步用 `copy` 就地更新（见文件头）。 */
  sceneBounds: THREE.Box3
  resetCameraRef: RefObject<() => void>
  fitCameraRef: RefObject<() => void>
  fitWithoutTouchRef: RefObject<() => void>
  contentKeyRef: RefObject<string | null>
  documentRef: RefObject<ThreeSceneViewProps["document"]>
  fittedDocumentRef: RefObject<string | null>
  currentContentKey: () => string
}

export function createThreeSceneCamera({ camera, cameraStateRef, render, sceneBounds, resetCameraRef, fitCameraRef, fitWithoutTouchRef, contentKeyRef, documentRef, fittedDocumentRef, currentContentKey }: ThreeSceneCameraDeps) {
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

  return { setCameraState, animateToFit, cancelFitAnimation }
}
