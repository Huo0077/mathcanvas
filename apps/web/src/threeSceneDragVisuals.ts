import * as THREE from "three"

import type { PrimitiveSpec } from "@draw/dsl"
import { host3FromPrimitive } from "@draw/geometry-kernel"
import type { ThreeSceneEffectDeps } from "./threeSceneEffect"
import { applyDragOffsets, applyRotationSkew, circleRadiusHandlePoint, offsetSceneObjects, rotationHandleRadius } from "./threeDrag"

/**
 * **拖动期间的画面**（从 `threeSceneEffect.ts` 切出来的第七块，评审方案 2）。
 *
 * 拖动时文档**不提交**，画面全靠这几个函数维持；抬手才写一次文档 —— 这正是"一次拖动 = 一步撤销"
 * 的前提。三件事在这里：
 *
 * 1. **半径预览**（`applyTrackRadiusPreview`）：圆本体按预览半径重建；绑在它上面的点用**同一个半径**
 *    重算坐标并重建（宿主参数是唯一真源，所以点始终贴在新的圆周上，不会等抬手才跳过去）；
 *    半径手柄移到新圆周；三色环按比例整体缩放（比例用构建时的轨道半径算同一个
 *    `rotationHandleRadius`，避免逐帧累积）。
 * 2. **手柄落位**（`moveRotationHandles`）：环画在**世界轴**上（所以旋转时它不跟着转，那是它的意义），
 *    但它的**位置**必须跟着对象，否则拖着拖着环留在原地、实体自己走了。
 * 3. **场景重建后的补画**（`resumeDragVisual`）：场景因为选中变化 / 窗口尺寸变化被重建时，
 *    这次拖动已经画上去的偏移会丢 —— 按**累计量**一次补画回去（旋转按累计角度、缩放按预览半径、
 *    平移按累计位移），与逐帧增量等价。它由"内容同步效应"在签名变化时调用，
 *    所以调用方把它挂进 `resumeDragVisualRef`（**每次挂载换一份新闭包**）。
 *
 * 搬动口径照旧：这些行逐字未改，只有一处**必要的**改写 ——
 * 原来这里是 `resumeDragVisualRef.current = () => { ... }`（直接给 ref 赋值），
 * 现在工厂交出 `resumeDragVisual`、由调用方赋值（语义不变）。
 */
export interface ThreeSceneDragVisualsDeps {
  scene: THREE.Scene
  documentRef: ThreeSceneEffectDeps["documentRef"]
  dragSessionRef: ThreeSceneEffectDeps["dragSessionRef"]
  trackRadiusHandleRef: ThreeSceneEffectDeps["trackRadiusHandleRef"]
  rotationHandleRef: ThreeSceneEffectDeps["rotationHandleRef"]
  circleRadiusPreviewRef: ThreeSceneEffectDeps["circleRadiusPreviewRef"]
  /** 同步刷新出来的点表（预览半径要先按宿主参数重算点坐标）。 */
  points: Map<string, import("@draw/dsl").Point3Primitive>
  /** 重建一个点驱动对象（内容同步那一块交出来的）。 */
  refreshPrimitiveObject: (id: string) => void
  /** 重画一帧。 */
  render: () => void
}

export function createThreeSceneDragVisuals({ scene, documentRef, dragSessionRef, trackRadiusHandleRef, rotationHandleRef, circleRadiusPreviewRef, points, refreshPrimitiveObject, render }: ThreeSceneDragVisualsDeps) {
    /**
     * 把"预览半径"画出来（拖动期间文档不提交，画面全靠这里）：
     * ①圆本体按预览半径重建；②绑在它上面的点用**同一个半径**重算坐标并重建（参数是唯一真源，
     * 所以点始终贴在新的圆周上，不会等抬手才跳过去）；③半径手柄移到新圆周；④三色环按比例整体缩放
     * （比例用构建时的轨道半径算同一个 `rotationHandleRadius`，避免逐帧累积）。
     */
    const applyTrackRadiusPreview = (id: string, trackPrimitive: Extract<PrimitiveSpec, { type: "circle3" }>, radius: number) => {
      refreshPrimitiveObject(id)
      const host = host3FromPrimitive({ ...trackPrimitive, radius }, documentRef.current.primitives)
      if (host) {
        for (const candidate of documentRef.current.primitives) {
          if (candidate.type !== "point3" || candidate.binding?.kind !== "onHost" || candidate.binding.hostId !== id) continue
          points.set(candidate.id, { ...candidate, position: host.evaluate({ u: candidate.binding.parameter }) })
          refreshPrimitiveObject(candidate.id)
        }
      }
      const handle = trackRadiusHandleRef.current
      if (handle && handle.id === id) {
        const point = circleRadiusHandlePoint(trackPrimitive.center, trackPrimitive.normal, radius)
        handle.point.copy(point)
        handle.group.userData.handlePoint = point.clone()
        for (const target of (handle.group.userData.hitTargets as THREE.Object3D[] | undefined) ?? []) target.position.copy(point)
        for (const child of handle.group.children) {
          if (!(child instanceof THREE.Line)) continue
          child.geometry.dispose()
          child.geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(trackPrimitive.center.x, trackPrimitive.center.y, trackPrimitive.center.z), point])
          child.computeLineDistances()
          const material = child.material as THREE.LineDashedMaterial
          material.dashSize = Math.max(0.08, radius * 0.08)
          material.gapSize = Math.max(0.05, radius * 0.05)
        }
      }
      const rings = rotationHandleRef.current
      if (rings && handle && handle.id === id && handle.radius > 0) rings.group.scale.setScalar(rotationHandleRadius(radius) / rotationHandleRadius(handle.radius))
    }
    /** 抬手时把预览交还给文档：清掉预览并把圆与它的动点按文档里的值重建一次。 */
    const clearTrackRadiusPreview = (id: string) => {
      circleRadiusPreviewRef.current = null
      const trackPrimitive = documentRef.current.primitives.find((candidate) => candidate.id === id)
      if (trackPrimitive?.type === "circle3") applyTrackRadiusPreview(id, trackPrimitive, trackPrimitive.radius)
    }
    /**
     * 平移拖动时手柄跟着图形走。
     *
     * 环画在**世界轴**上（所以旋转时它不能跟着转，那是它的意义所在），但它的**位置**必须跟着对象，
     * 否则拖着拖着环就落在原地、实体自己走了。提交后内容同步会按新中心重建手柄。
     */
    const moveRotationHandles = (delta: THREE.Vector3) => {
      const handle = rotationHandleRef.current
      if (handle) handle.group.position.add(delta)
    }
    /** 把这次拖动已经画上去的偏移补画到（可能是刚重建的）场景上，见 resumeDragVisualRef 的说明。 */
    const resumeDragVisual = () => {
      const session = dragSessionRef.current
      if (!session?.applied) return
      /**
       * 旋转：场景被重建（选中变化 / 尺寸变化）后，新对象回到文档里的姿态，临时旋转就丢了。
       * 这里按**累计角度**一次补画回去（与逐帧增量等价：同一根轴上的旋转可以直接相加）。
       * 它用 `applied` 而不是 `visualApplied` 判断——旋转根本不走位移那条账。
       */
      if (session.rotation) {
        if (Math.abs(session.rotation.state.applied) > 1e-12) applyRotationSkew(scene, session.rotation.family, session.rotation.state.pivot, session.rotation.state.axis, session.rotation.state.applied)
        render()
        return
      }
      /**
       * 缩放：场景被重建（窗口尺寸变化等）后手柄与圆都回到文档里的半径，这里按预览值补画一次。
       */
      if (session.scale) {
        const trackPrimitive = documentRef.current.primitives.find((candidate) => candidate.id === session.targetId)
        if (trackPrimitive?.type === "circle3") applyTrackRadiusPreview(session.targetId, trackPrimitive, session.scale.current)
        render()
        return
      }
      if (session.visualApplied.lengthSq() < 1e-12) return
      if (session.slideNormal) offsetSceneObjects(scene, session.targetId, session.slideNormal.clone().multiplyScalar(session.visualApplied.dot(session.slideNormal)))
      else applyDragOffsets(scene, session.family, session.visualApplied.clone())
      moveRotationHandles(session.visualApplied)
      render()
    }
  return { applyTrackRadiusPreview, clearTrackRadiusPreview, moveRotationHandles, resumeDragVisual }
}
