import * as THREE from "three"

import type { PrimitiveSpec, Point3Primitive } from "@draw/dsl"
import type { CameraState } from "./threeCamera"
import type { DragSessionState, ThreeSceneEffectDeps } from "./threeSceneEffect"
import type { ThreeScenePreview } from "./threeScenePreview"
import type { SectionPrimitive, Vector3 } from "@draw/dsl"
import { host3FromPrimitive, reactive, type Host3, type Host3Parameter } from "@draw/geometry-kernel"
import { solidVolumeHostFor } from "@draw/scene-graph"
import { getAffectedPrimitiveIds, isFreeDraggable3, planeThroughPoints, templateTopologyIds } from "@draw/scene-graph"
import { cameraDragMode, clampCameraTarget, panCameraState, rotateCameraState } from "./threeCamera"
import { advanceRotationDrag, beginRotationDrag, dragFamilyIds, dragOffsetDrift, dragWorldPoint, hasRotationMovement, lineParameterAtRay, orbitParameterAt, rotationAngleAt, rotationDragDegrees, rotationHandleAxisAt, ROTATION_SNAP_DEGREES, trackRadiusAt, trackRadiusHandleHit } from "./threeDrag"
import { pickRaycastHit3, pickSectionAt, resolveSelectableHit, previewBeatsPick, type RaycastHit3 } from "./threePicking"
import { sectionUnitNormal } from "./threePrimitives"

/**
 * **这次按下，这个用户级对象能不能开一次拖动会话**（S5；拖动拾取的过滤与拖动分支**共用这一条口径**）。
 *
 * 为什么不能直接用 `isFreeDraggable3`：它回答的是"**自由**拖动能不能动它"。而拖动分支还有**另一条**
 * 会话 —— **绑定点**沿宿主 / 轨道拖（走参数域那条路，`binding.kind !== "free"`），
 * `isFreeDraggable3` 对绑定点**说不**，但它确实能拖。
 *
 * 本批把它抽出来，是因为"只抓最近命中"曾经让拖动抓错东西：**派生球**包住宿主时，
 * 用户按在实体上其实按在球上，而球拖不动（球心半径由宿主算出来）。过滤若只认
 * `isFreeDraggable3`，就会把绑定点一起筛掉 —— 实测打红 `three-orbit-tracks`（拾取落到圆周上：
 * `data-drag-target` 读作 `line:circle3-1->circle3`）与 `geometry3d-host-drag`。**两条一起认才对。**
 */
function canStartDragSession(primitive: PrimitiveSpec | undefined, points: Map<string, Point3Primitive>, generated: Set<string>): boolean {
  if (primitive === undefined || primitive.visible === false) return false
  // 点：自由的走"自由拖动"，绑定的走"沿宿主 / 轨道拖" —— 两种都能开拖动会话。
  if (primitive.locked) return false
  if (primitive.type === "point3") {
    if (primitive.binding && primitive.binding.kind !== "free" && primitive.binding.kind !== "derived") return true
    return isFreeDraggable3(primitive, points, generated)
  }
  return isFreeDraggable3(primitive, points, generated)
}

/**
 * **指针交互**（从 `threeSceneEffect.ts` 里按阶段切出来的第五块，评审方案 2）：按下 / 移动 / 抬起、
 * 自由拖动与旋转环 / 轨道半径手柄的拖拽会话、以及"指针在哪个对象上"的拾取判定。
 *
 * ## 依赖面为什么这么宽
 *
 * 它是"用户的手"这一层：几乎每一步都要读某个 ref 或场景对象。属于运行时依赖的那些用
 * `ThreeSceneEffectDeps["x"]` 取类型（**只有一处定义**）；属于本效应的那些（场景 / 相机 / 渲染器 /
 * 几只索引 / 几个小函数）在这里写清签名 —— 它们都定义在工厂调用之前，所以传进来是安全的。
 *
 * ## 三条写在这里的口径
 *
 * 1. **拖动期间不提交文档**：只改画面，抬手才回调一次（`dragEndRef` / `rotateEndRef` /
 *    `trackRadiusEndRef` 都是"抬手报一次"）—— 这样一次拖动就是一步撤销。
 * 2. **完整依赖预览**：临时文档复用正式几何计算，渲染时只重建签名变化的对象。
 * 3. **拾取按"模板子元素 → 模板实体"归属**（`topologyOwners`）：点到的是子元素，选中的是实体。
 */

export interface ThreeSceneInteractionDeps {
  cameraStateRef: ThreeSceneEffectDeps["cameraStateRef"]
  panModeRef: ThreeSceneEffectDeps["panModeRef"]
  dragModeRef: ThreeSceneEffectDeps["dragModeRef"]
  pointerStateRef: ThreeSceneEffectDeps["pointerStateRef"]
  dragSessionRef: ThreeSceneEffectDeps["dragSessionRef"]
  selectedIdsRef: ThreeSceneEffectDeps["selectedIdsRef"]
  dragEndRef: ThreeSceneEffectDeps["dragEndRef"]
  moveSectionRef: ThreeSceneEffectDeps["moveSectionRef"]
  hostDragEndRef: ThreeSceneEffectDeps["hostDragEndRef"]
  rotateEndRef: ThreeSceneEffectDeps["rotateEndRef"]
  trackRadiusEndRef: ThreeSceneEffectDeps["trackRadiusEndRef"]
  rotationHandleRef: ThreeSceneEffectDeps["rotationHandleRef"]
  trackRadiusHandleRef: ThreeSceneEffectDeps["trackRadiusHandleRef"]
  circleRadiusPreviewRef: ThreeSceneEffectDeps["circleRadiusPreviewRef"]
  pickSectionFaceRef: ThreeSceneEffectDeps["pickSectionFaceRef"]
  documentRef: ThreeSceneEffectDeps["documentRef"]
  setFacePickMode: ThreeSceneEffectDeps["setFacePickMode"]
  facePickModeRef: ThreeSceneEffectDeps["facePickModeRef"]
  onSelectRef: ThreeSceneEffectDeps["onSelectRef"]
  previewClickRef: ThreeSceneEffectDeps["previewClickRef"]
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  sceneShell: HTMLDivElement | null
  sceneBounds: THREE.Box3
  points: Map<string, Point3Primitive>
  topologyOwners: Map<string, string>
  previewDrag: (session: DragSessionState) => boolean | void
  clearDragPreview: () => void
  render: () => void
  pickTolerance: () => number
  dragDeltaFor: (session: { anchor: THREE.Vector3; origin: THREE.Vector3 }, point: { x: number; y: number }) => THREE.Vector3 | null
  setCameraState: (nextState: CameraState) => void
  pointFromEvent: (event: PointerEvent) => { x: number; y: number }
  raycasterAt: (normalizedPoint: { x: number; y: number }) => THREE.Raycaster
  previewHitAt: (normalizedPoint: { x: number; y: number }) => { hovering: boolean; depth: number | null; preview: ThreeScenePreview | null }
}

export function createThreeSceneInteraction({ 
cameraStateRef, panModeRef, dragModeRef, pointerStateRef, dragSessionRef, selectedIdsRef, dragEndRef, moveSectionRef, hostDragEndRef, rotateEndRef, trackRadiusEndRef, rotationHandleRef, trackRadiusHandleRef, circleRadiusPreviewRef, pickSectionFaceRef, documentRef, setFacePickMode, facePickModeRef, onSelectRef, previewClickRef, scene, camera, renderer, sceneShell, sceneBounds, points, topologyOwners, previewDrag, clearDragPreview, render, pickTolerance, dragDeltaFor, setCameraState, pointFromEvent, raycasterAt, previewHitAt
 }: ThreeSceneInteractionDeps) {
function buildHostPointGraph(pointId: string, host: Host3, primitive: PrimitiveSpec): { graph: reactive.ReactiveGraph; pointId: string; parameterIds: readonly [string, string, string] } {
  const graph = reactive.createReactiveGraph()
  const hostNodeId = `${pointId}:host`
  const parameterIds = [`${pointId}:u`, `${pointId}:v`, `${pointId}:w`] as const
  // Store the finite DSL source, not Host3: unbounded hosts legitimately have
  // infinite domain limits, which the graph rejects as non-finite source data.
  // hostPointNode captures the resolved host for this immutable drag session.
  graph.addNode(reactive.sourceNode(hostNodeId, primitive))
  for (const parameterId of parameterIds) graph.addNode(reactive.parameterNode(parameterId, 0))
  graph.addNode(reactive.hostPointNode(pointId, { host, parameterIds, hostIds: [hostNodeId] }))
  graph.evaluate()
  return { graph, pointId, parameterIds }
}

    /** 拖动期间的重画次数：拖动必须逐次跟手重画，否则画面会一格一格跳（见 handlePointerMove）。 */
    let dragFrames = 0
    /** 旋转拖动期间的临时旋转帧数（与平移同一个读数思路：画面有没有真的跟手）。 */
    let rotationFrames = 0
    /** 缩放拖动期间的重画帧数（同上）。 */
    let scaleFrames = 0

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 && event.button !== 1) return
      event.preventDefault()
      const point = pointFromEvent(event)
      pointerStateRef.current = { pointerId: event.pointerId, x: point.x, y: point.y, lastX: point.x, lastY: point.y, button: event.button, moved: false }
      dragSessionRef.current = null
      if (sceneShell) sceneShell.dataset.dragTarget = ""
      // 以面为剖切面：这一次点击只用来取面，取到就退出该模式。
      if (facePickModeRef.current && event.button === 0) {
        const hit = pickRaycastHit3(scene, camera, point, { tolerance: pickTolerance() })
        const face = hit ? documentRef.current.primitives.find((primitive) => primitive.id === hit.primitiveId) : undefined
        const section = documentRef.current.primitives.find((primitive): primitive is SectionPrimitive => primitive.type === "section" && selectedIdsRef.current.includes(primitive.id))
        if (hit?.kind === "face" && face?.type === "face3" && section) {
          // 由面的点环求它所在的平面；不共面的环（例如曲面侧面）会被 planeThroughPoints 直接拒绝。
          const vertices = face.pointIds.map((id) => points.get(id)?.position).filter((position): position is Vector3 => Boolean(position))
          const plane = planeThroughPoints(vertices)
          if (plane) {
            pickSectionFaceRef.current?.(section.id, plane)
            setFacePickMode(false)
          }
        }
        renderer.domElement.releasePointerCapture(event.pointerId)
        return
      }
      /**
       * **半径手柄的优先级最高**：它压在圆周上，而"拖圆周"也可以解释成平移——手柄是更具体的靶子
       * （与拾取哲学一致：点 > 棱 > 面 > 线）。抓到手柄就是"改半径"，不需要先开「自由拖动」。
       */
      const radiusHandle = trackRadiusHandleRef.current
      if (event.button === 0 && radiusHandle && trackRadiusHandleHit(radiusHandle.group, camera, point)) {
        const trackPrimitive = documentRef.current.primitives.find((candidate) => candidate.id === radiusHandle.id)
        if (trackPrimitive?.type === "circle3") {
          dragSessionRef.current = {
            targetId: radiusHandle.id,
            family: new Set([radiusHandle.id]),
            anchor: new THREE.Vector3(trackPrimitive.center.x, trackPrimitive.center.y, trackPrimitive.center.z),
            origin: new THREE.Vector3(trackPrimitive.center.x, trackPrimitive.center.y, trackPrimitive.center.z),
            total: new THREE.Vector3(),
            visualApplied: new THREE.Vector3(),
            applied: false,
            scale: { id: radiusHandle.id, original: trackPrimitive.radius, current: trackPrimitive.radius }
          }
          if (sceneShell) sceneShell.dataset.trackRadius = trackPrimitive.radius.toFixed(4)
          try { renderer.domElement.setPointerCapture(event.pointerId) } catch {}
          return
        }
      }
      /**
       * 旋转环的优先级**最高**，而且不需要先开「自由拖动」：
       * 用户抓住了那个环，意图没有第二种解释（环本身就是显式手柄，不是图形的一部分）。
       * 判定只对三个环做射线求交，所以被实体挡住的那半圈也抓得到。
       */
      const handle = rotationHandleRef.current
      if (event.button === 0 && handle) {
        const axis = rotationHandleAxisAt(handle.group, camera, point)
        const angle = axis ? rotationAngleAt(camera, handle.center, axis, point) : null
        if (axis && angle !== null) {
          const family = dragFamilyIds(documentRef.current, handle.id)
          dragSessionRef.current = {
            targetId: handle.id,
            family: new Set([handle.id]),
            anchor: handle.center.clone(),
            origin: handle.center.clone(),
            total: new THREE.Vector3(),
            visualApplied: new THREE.Vector3(),
            applied: false,
            rotation: { state: beginRotationDrag(axis, handle.center, angle), family }
          }
          if (sceneShell) {
            sceneShell.dataset.rotationAxis = axis
            sceneShell.dataset.rotationDegrees = "0.00"
          }
          renderer.domElement.setPointerCapture(event.pointerId)
          return
        }
      }
      /**
       * **不必先开"自由拖动"就能抓点**（UI/UX 优化规格 §3D 直抓）。
       * 主流 3D 几何软件里，按住一个点就是拖它；旋转视角是按在空白处 / 实体上。
       * 这里只放行**点**（`hit.kind === "point"` 且解析出来是 point3）：实体 / 棱 / 面仍然是旋转视角，
       * 原来"左键拖动旋转"的手感不变。带修饰键（Shift 平移 / Ctrl 纵深 / Alt）时一律不抓。
       */
      const directPointDrag = !dragModeRef.current && !panModeRef.current && event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
      if ((dragModeRef.current || directPointDrag) && event.button === 0) {
        /**
         * **拖动只抓"能拖的那个"**（S5 拖动那一半挖出来的）。
         *
         * 不给拾取过滤的话，射线命中的**最近**物体常常是**拖不动**的那一个 —— 最典型的是**派生球**：
         * 它把宿主整个包住，用户想拖宿主，却永远先按到球（而球是派生量，拖它只会被重算覆盖）。
         * 症状就是"按在实体上怎么拖都不动"（本仓为此记过三次失败尝试），而它看着像"这一版不支持"。
         * 过滤按**解析后的用户级对象**判，与下面真正开拖动会话用的是同一条判据（`isFreeDraggable3`）。
         */
        const generated = templateTopologyIds(documentRef.current)
        const hit = pickRaycastHit3(scene, camera, point, {
          tolerance: pickTolerance(),
          accept: (primitiveId) => {
            const resolved = resolveSelectableHit(primitiveId, topologyOwners)
            const candidate = resolved === null ? undefined : documentRef.current.primitives.find((primitive) => primitive.id === resolved)
            return canStartDragSession(candidate, points, generated) && (dragModeRef.current || candidate?.type === "point3")
          }
        })
        const domRect = renderer.domElement.getBoundingClientRect()
        const viewW = Math.max(domRect.width, 1)
        const viewH = Math.max(domRect.height, 1)
        const pointerRay = raycasterAt(point).ray
        const tolerance = pickTolerance()
        const POINT_SCREEN_TOLERANCE_PX = 18
        let priorityPointHit: RaycastHit3 | null = null
        let bestDistancePx = POINT_SCREEN_TOLERANCE_PX
        let bestPriority = -1

        for (const candidate of documentRef.current.primitives) {
          if (candidate.type !== "point3" || !canStartDragSession(candidate, points, generated)) continue
          const live = points.get(candidate.id)
          const pos = new THREE.Vector3(live?.position.x ?? candidate.position.x, live?.position.y ?? candidate.position.y, live?.position.z ?? candidate.position.z)
          const ndc = pos.clone().project(camera)
          if (ndc.z > 1) continue
          const screenX = (ndc.x + 1) * 0.5 * viewW
          const screenY = (1 - ndc.y) * 0.5 * viewH
          const cursorX = point.x * viewW
          const cursorY = point.y * viewH
          const distPx = Math.hypot(screenX - cursorX, screenY - cursorY)
          const rayDist = pointerRay.distanceToPoint(pos)
          if (distPx <= POINT_SCREEN_TOLERANCE_PX || rayDist <= tolerance) {
            const isSelected = selectedIdsRef.current.includes(candidate.id)
            const isBound = Boolean(candidate.binding && candidate.binding.kind !== "free" && candidate.binding.kind !== "derived")
            const priority = isSelected ? 3 : isBound ? 2 : 1
            if (priority > bestPriority || (priority === bestPriority && distPx < bestDistancePx)) {
              bestPriority = priority
              bestDistancePx = distPx
              priorityPointHit = {
                primitiveId: candidate.id,
                kind: "point",
                depth: pointerRay.origin.distanceTo(pos),
                worldPoint: { x: pos.x, y: pos.y, z: pos.z }
              }
            }
          }
        }

        const effectiveHit = priorityPointHit && (
          !hit || hit.kind !== "point" || (bestPriority >= 1 && hit.primitiveId !== priorityPointHit.primitiveId)
        ) ? priorityPointHit : hit
        const targetId = resolveSelectableHit(effectiveHit?.primitiveId ?? null, topologyOwners)
        const target = targetId ? documentRef.current.primitives.find((primitive) => primitive.id === targetId) : undefined
        // 拖动排查用读数：这一次按下到底抓到了什么。
        // 直抓只认"真的按在点上"；自由拖动模式下沿用原来的判据。
        const grabAllowed = dragModeRef.current || effectiveHit?.kind === "point"
        if (sceneShell && (dragModeRef.current || (grabAllowed && target))) sceneShell.dataset.dragTarget = `${effectiveHit?.kind ?? "none"}:${effectiveHit?.primitiveId ?? "-"}->${target?.type ?? "none"}`
        // 截面要单独判定：它画在实体内部，按深度永远排不到，但用户指向那圈线时就是要挪刀口。
        const sectionId = dragModeRef.current ? pickSectionAt(scene, camera, point, pickTolerance(), effectiveHit?.kind === "point" || effectiveHit?.kind === "edge") : null
        const section = sectionId ? documentRef.current.primitives.find((primitive) => primitive.id === sectionId) : undefined
        if (section && section.type === "section") {
          // 拖动一个截面 = 沿法向平移剖切面。截面没有自己的实体几何，拖它就是挪刀口。
          const normal = sectionUnitNormal(section.plane.normal)
          if (normal) {
            // 需要一个真实的世界锚点（拖动位移由屏幕平面求交得出），用指针射线在截面所在平面上的落点。
            const anchor = dragWorldPoint(camera, new THREE.Vector3(0, 0, 0), point)
            if (anchor) {
              const sectionPoint = section.points[0]
              if (sectionPoint) anchor.set(sectionPoint.x, sectionPoint.y, sectionPoint.z)
              dragSessionRef.current = { targetId: section.id, family: new Set([section.id]), anchor, origin: anchor.clone(), total: new THREE.Vector3(), visualApplied: new THREE.Vector3(), applied: false, slideNormal: normal }
            }
          }
        } else if (grabAllowed && effectiveHit && target && target.type === "point3" && target.binding && target.binding.kind !== "free") {
          /**
           * 绑定点的拖动：指针位置投影回**宿主的参数域**，点由参数算出坐标，所以永远贴住宿主
           * （不像自由拖动那样"叠加屏幕位移"，拖久了也不会漂离）。拖动期间只更新参数与受影响对象。
           */
          const binding = target.binding
          const hostId = (binding.kind === "onHost" || binding.kind === "onLine") ? (binding.kind === "onHost" ? binding.hostId : binding.lineId) : binding.kind === "onFace" ? binding.faceId : binding.kind === "onSurface" || binding.kind === "inSolid" ? binding.solidId : null
          const hostPrimitive = hostId ? documentRef.current.primitives.find((candidate) => candidate.id === hostId) : undefined
          // 实体内不是"投影到低维宿主"，而是体积约束：由实体的物化拓扑构造（见 `solidVolumeHostFor`）。
          const hostConstraint = hostPrimitive
            ? host3FromPrimitive(hostPrimitive, documentRef.current.primitives)
              ?? (binding.kind === "inSolid" ? solidVolumeHostFor(new Map(documentRef.current.primitives.map((primitive) => [primitive.id, primitive])), hostPrimitive.id) : null)
            : null
          if (hostConstraint && hostPrimitive) {
            const anchor = new THREE.Vector3(target.position.x, target.position.y, target.position.z)
            const origin = dragWorldPoint(camera, anchor, point) ?? anchor.clone()
            const projectedAnchor = anchor.clone().project(camera)
            const dependents = getAffectedPrimitiveIds(documentRef.current, [target.id])
            dependents.delete(target.id)
            dragSessionRef.current = {
              targetId: target.id,
              family: new Set([target.id]),
              anchor,
              origin,
              total: new THREE.Vector3(),
              visualApplied: new THREE.Vector3(),
              applied: false,
              hostConstraint,
              hostParameter: hostConstraint.closestParameter(target.position),
              orbitGrabOffset: hostConstraint.kind === "circle"
                ? { x: (1 + projectedAnchor.x) / 2 - point.x, y: (1 - projectedAnchor.y) / 2 - point.y }
                : undefined,
              hostDependents: [...dependents],
              reactiveHost: buildHostPointGraph(target.id, hostConstraint, hostPrimitive),
              direct: directPointDrag
            }
          }
        } else if (grabAllowed && effectiveHit && target && isFreeDraggable3(target, points, templateTopologyIds(documentRef.current))) {
          const anchor = new THREE.Vector3(effectiveHit.worldPoint.x, effectiveHit.worldPoint.y, effectiveHit.worldPoint.z)
          const origin = dragWorldPoint(camera, anchor, point) ?? anchor.clone()
          const family = dragFamilyIds(documentRef.current, target.id)
          dragSessionRef.current = {
            targetId: target.id,
            family,
            anchor,
            origin,
            total: new THREE.Vector3(),
            visualApplied: new THREE.Vector3(),
            applied: false
          }
        }
      }
      if (!dragModeRef.current && dragSessionRef.current) dragSessionRef.current.direct = true
      if (dragSessionRef.current && !dragSessionRef.current.direct && sceneShell) {
        sceneShell.dataset.dragging = "true"
      }
      renderer.domElement.setPointerCapture(event.pointerId)
    }
    const handlePointerMove = (event: PointerEvent) => {
      const pointerState = pointerStateRef.current
      if (!pointerState) {
        if (sceneShell) {
          const point = pointFromEvent(event)
          const radiusHandle = trackRadiusHandleRef.current
          const handle = rotationHandleRef.current
          const hoveringHandle = Boolean(
            (radiusHandle && trackRadiusHandleHit(radiusHandle.group, camera, point))
            || (handle && rotationHandleAxisAt(handle.group, camera, point))
          )
          let hoveringDraggable = hoveringHandle
          if (!hoveringDraggable && !panModeRef.current && !facePickModeRef.current) {
            const generated = templateTopologyIds(documentRef.current)
            const hit = pickRaycastHit3(scene, camera, point, {
              tolerance: pickTolerance(),
              accept: (primitiveId) => {
                const resolved = resolveSelectableHit(primitiveId, topologyOwners)
                const candidate = resolved === null ? undefined : documentRef.current.primitives.find((primitive) => primitive.id === resolved)
                return canStartDragSession(candidate, points, generated) && (dragModeRef.current || candidate?.type === "point3")
              }
            })
            const domRect = renderer.domElement.getBoundingClientRect()
            const viewW = Math.max(domRect.width, 1)
            const viewH = Math.max(domRect.height, 1)
            const cursorX = point.x * viewW
            const cursorY = point.y * viewH
            const hoverRay = raycasterAt(point).ray
            const hoverTol = pickTolerance()
            const pointNear = Boolean(documentRef.current.primitives.some((candidate) => {
              if (candidate.type !== "point3" || !canStartDragSession(candidate, points, generated)) return false
              const live = points.get(candidate.id)
              const pos = new THREE.Vector3(live?.position.x ?? candidate.position.x, live?.position.y ?? candidate.position.y, live?.position.z ?? candidate.position.z)
              const ndc = pos.clone().project(camera)
              if (ndc.z > 1) return false
              const screenX = (ndc.x + 1) * 0.5 * viewW
              const screenY = (1 - ndc.y) * 0.5 * viewH
              return Math.hypot(screenX - cursorX, screenY - cursorY) <= 18 || hoverRay.distanceToPoint(pos) <= hoverTol
            }))
            hoveringDraggable = Boolean((hit && (dragModeRef.current || hit.kind === "point")) || pointNear)
          }
          sceneShell.dataset.hoverDraggable = hoveringDraggable ? "true" : "false"
        }
        return
      }
      if (pointerState.pointerId !== event.pointerId) return
      const point = pointFromEvent(event)
      const deltaX = point.x - pointerState.lastX
      const deltaY = point.y - pointerState.lastY
      const domRect = renderer.domElement.getBoundingClientRect()
      const movePx = Math.hypot((point.x - pointerState.x) * Math.max(domRect.width, 1), (point.y - pointerState.y) * Math.max(domRect.height, 1))
      pointerState.moved ||= movePx > 2
      const session = dragSessionRef.current
      // 直抓的会话在指针真正移动之前什么都不改：原地点一下仍然是"选中"，不会顺手把点挪一丝。
      if (session?.direct && !pointerState.moved) return
      if (session) {
        if (sceneShell) sceneShell.dataset.dragging = "true"
        /**
         * 拖**半径手柄**（缩放）：指针落在圆所在平面上的点到圆心的距离。拖动期间**不提交文档**——
         * 只改画面（预览半径），一次拖动因此仍然是"抬手提交一次 = 一步撤销"。
         */
        if (session.scale) {
          const trackPrimitive = documentRef.current.primitives.find((candidate) => candidate.id === session.targetId)
          if (trackPrimitive?.type === "circle3") {
            const center = new THREE.Vector3(trackPrimitive.center.x, trackPrimitive.center.y, trackPrimitive.center.z)
            const radius = trackRadiusAt(camera, center, new THREE.Vector3(trackPrimitive.normal.x, trackPrimitive.normal.y, trackPrimitive.normal.z), point)
            if (radius !== null && Math.abs(radius - session.scale.current) > 1e-9) {
              const previousRadius = session.scale.current
              session.scale.current = radius
              if (previewDrag(session) === false) { session.scale.current = previousRadius; return }
              session.applied = true
              render()
              scaleFrames += 1
              if (sceneShell) {
                sceneShell.dataset.trackRadius = radius.toFixed(4)
                sceneShell.dataset.trackRadiusFrames = String(scaleFrames)
              }
            }
          }
          pointerState.lastX = point.x
          pointerState.lastY = point.y
          return
        }
        /**
         * 拖动旋转环：指针位置 → 绕该世界轴的角度，累计后按 15° 吸附（按住 Alt 不吸附）。
         * 拖动期间**不提交文档**，画面由临时旋转负责——一次拖动因此就是一步撤销，
         * 与平移走的是同一条会话与同一条"抬手才提交"的规则。
         */
        if (session.rotation) {
          const handle = rotationHandleRef.current
          const angle = handle ? rotationAngleAt(camera, handle.center, session.rotation.state.axis, point) : null
          if (angle !== null) {
            const advanced = advanceRotationDrag(session.rotation.state, angle, event.altKey ? null : (ROTATION_SNAP_DEGREES * Math.PI) / 180)
            const previousRotation = session.rotation.state
            session.rotation.state = advanced.state
            if (Math.abs(advanced.step) > 1e-12) {
              if (previewDrag(session) === false) { session.rotation.state = previousRotation; return }
              session.applied = true
              render()
              rotationFrames += 1
            }
            if (sceneShell) {
              sceneShell.dataset.rotationAxis = advanced.state.axis
              sceneShell.dataset.rotationDegrees = rotationDragDegrees(advanced.state).toFixed(2)
              sceneShell.dataset.rotationFrames = String(rotationFrames)
            }
          }
          pointerState.lastX = point.x
          pointerState.lastY = point.y
          return
        }
        const world = dragDeltaFor(session, point)
        if (world) {
          if (session.hostConstraint) {
            /**
             * 绑定点：把指针在世界平面上的落点**投影回宿主参数域**，再由参数算出坐标。
             * 每帧只重建这个点与它的下游对象（不整场重建、不进撤销历史），抬手才提交参数。
             *
             * 坐标这一步走 **Reactive DAG**（Reactive DAG 切片 Task 4）：宿主几何是来源节点、
             * u/v/w 是三个参数节点、"点"是约束节点。求一次闭包就拿到坐标与夹取标记，
             * 并且**同时**得到诊断（宿主解析不出来时不再是"悄悄不动"）。
             */
            if (!pointerState.moved) return
            const offset = session.orbitGrabOffset
            let parameter: Host3Parameter | null = null
            if (offset) {
              parameter = { u: orbitParameterAt(camera, session.hostConstraint, { x: point.x + offset.x, y: point.y + offset.y }, session.hostParameter?.u ?? 0) }
            } else if (["line", "segment", "ray", "edge"].includes(session.hostConstraint.kind)) {
              const u = lineParameterAtRay(raycasterAt(point).ray, session.hostConstraint)
              if (u !== null) parameter = { u }
            }
            if (!parameter) {
              const worldPoint = session.anchor.clone().add(world)
              parameter = session.hostConstraint.closestParameter({ x: worldPoint.x, y: worldPoint.y, z: worldPoint.z })
            }
            const previousParameter = session.hostParameter
            session.hostParameter = parameter
            let projected: { x: number; y: number; z: number } | null = null
            let reactiveEvaluated = 0
            let reactiveDiagnostics = 0
            if (session.reactiveHost) {
              const { graph, pointId, parameterIds } = session.reactiveHost
              graph.setParameter(parameterIds[0], parameter.u)
              graph.setParameter(parameterIds[1], parameter.v ?? 0)
              graph.setParameter(parameterIds[2], parameter.w ?? 0)
              const report = graph.evaluate([...parameterIds])
              reactiveEvaluated = report.evaluated.length
              reactiveDiagnostics = report.diagnostics.length
              const value = graph.value(pointId) as { point: Vector3 } | undefined
              // 图没有给出坐标时**不动这个点**（宁可这一帧不跟手，也不拿旧坐标或原点冒充）。
              if (value) projected = { ...value.point }
            } else {
              projected = session.hostConstraint.evaluate(parameter)
            }
            if (projected) {
              if (previewDrag(session) === false) { session.hostParameter = previousParameter; return }
              session.applied = true
              if (sceneShell) {
                sceneShell.dataset.reactiveEvaluated = String(reactiveEvaluated)
                sceneShell.dataset.reactiveDiagnostics = String(reactiveDiagnostics)
              }
            }
            pointerState.lastX = point.x
            pointerState.lastY = point.y
            render()
            dragFrames += 1
            if (sceneShell && projected) {
              sceneShell.dataset.dragFrames = String(dragFrames)
              sceneShell.dataset.dragParameter = parameter.v === undefined ? parameter.u.toFixed(4) : `${parameter.u.toFixed(4)},${parameter.v.toFixed(4)}`
              // 残差应当恒为 0：坐标就是从参数算出来的（这条读数是"严格贴住宿主"的直接证据）。
              sceneShell.dataset.hostResidual = session.hostConstraint.residual(projected).toFixed(6)
              // 这次拖动里有多少下游对象跟着重建（0 表示这个点还没有下游）。
              sceneShell.dataset.hostDependents = String(session.hostDependents?.length ?? 0)
            }
            return
          }
          // 截面只认法向分量：屏幕位移先投影到法向，切向拖动不会让剖切面乱跑。
          if (session.slideNormal) session.total.copy(session.slideNormal).multiplyScalar(world.dot(session.slideNormal))
          else session.total.copy(world)
          // 累计位移变化时重算临时文档，正式文档在整次拖动期间保持不动。
          const step = session.total.clone().sub(session.visualApplied)
          if (step.lengthSq() > 1e-12) {
            if (previewDrag(session) === false) { session.total.copy(session.visualApplied); return }
            session.visualApplied.copy(session.total)
            session.applied = true
            /**
             * 立刻重画。同步后的几何与标注**不会自己触发渲染**；
             * 少了这一句，画面就要等到下一次别的渲染（相机、尺寸、提交后的场景重建）才更新，
             * 拖动看起来就是"一帧一帧"跳（实测：20 次 pointermove 里只有 3 次真的重画）。
             */
            render()
            dragFrames += 1
            if (sceneShell) sceneShell.dataset.dragFrames = String(dragFrames)
          }
          // 临时文档仅用于预览；抬手时再提交唯一一次正式操作。
        }
        pointerState.lastX = point.x
        pointerState.lastY = point.y
        return
      }
      const state = cameraStateRef.current
      const scale = state.distance * 1.5
      // 修饰键取**当前**事件的状态：先按住左键再按 Shift 也要能平移（pointerdown 的快照会漏掉这种顺序）。
      const mode = cameraDragMode(event, panModeRef.current)
      const moved = mode === "depth-pan"
        ? panCameraState(state, 0, 0, deltaY * scale)
        : mode === "screen-pan" ? panCameraState(state, -deltaX * scale, deltaY * scale, 0) : rotateCameraState(state, deltaX * 140, deltaY * 140)
      pointerState.lastX = point.x
      pointerState.lastY = point.y
      setCameraState({ ...moved, target: clampCameraTarget(moved.target, sceneBounds) })
    }
    const handlePointerUp = (event: PointerEvent) => {
      const pointerState = pointerStateRef.current
      if (!pointerState || pointerState.pointerId !== event.pointerId) return
      const point = pointFromEvent(event)
      const session = dragSessionRef.current
      /** 直抓但没拖动：当作一次普通点击，走下面完全不变的拾取 / 预览优先级分支。 */
      const directClick = Boolean(session?.direct && !session.applied && !pointerState.moved)
      if (directClick) dragSessionRef.current = null
      if (session && !directClick) {
        dragSessionRef.current = null
        /**
         * 抬手前检查是否残留旧式对象偏移：几何已由临时文档求出，不能再叠加一层偏移。
         */
        if (sceneShell && session.applied) {
          // Geometry is recomputed in place, not represented by object offsets.
          // Any residual legacy dragOffset would now be a double transform.
          const appliedOffset = new THREE.Vector3()
          sceneShell.dataset.dragOffsetDrift = dragOffsetDrift(scene, session.family, appliedOffset).toFixed(4)
        }
        if (session.applied) clearDragPreview()
        if (session.scale) {
          circleRadiusPreviewRef.current = null
          if (session.applied && Math.abs(session.scale.current - session.scale.original) > 1e-9) trackRadiusEndRef.current?.(session.targetId, session.scale.current)
        } else if (session.rotation) {
          const rotation = session.rotation.state
          if (sceneShell) sceneShell.dataset.rotationDegrees = rotationDragDegrees(rotation).toFixed(2)
          if (hasRotationMovement(rotation)) rotateEndRef.current?.(session.targetId, rotation.axis, rotationDragDegrees(rotation))
        } else if (session.hostConstraint && session.hostParameter && session.applied) {
          hostDragEndRef.current?.(session.targetId, session.hostParameter)
        } else if (session.applied && session.total.lengthSq() > 1e-8) {
          if (session.slideNormal) moveSectionRef.current?.(session.targetId, session.total.dot(session.slideNormal))
          else dragEndRef.current?.(session.targetId, session.total)
        } else if (session.applied) {
          // Returning to the origin is a no-op and may not trigger a React sync.
          render()
        }
        // 选中放在抬手：拖动本身不该因为高亮重建而多一次场景重建。
        // Commit may be refused or a no-op, with no document sync to repaint.
        // Wait until the next frame so a successful React commit can sync first.
        if (session.applied) requestAnimationFrame(render)
        if (!selectedIdsRef.current.includes(session.targetId)) onSelectRef.current(session.targetId, false)
      } else if (!pointerState.moved && pointerState.button === 0) {
        /**
         * 点击优先级：**点 / 棱的拾取优先于"创建"**。
         * 否则虚线预览会抢走顶点手柄的点击（实测回归：点顶点手柄变成创建截线），
         * 而细粒度的空间元素本来就是用户更明确的目标；只有落到实体/面的点击才解释为创建。
         *
         * 截面预览是例外，但要有条件：它的那圈虚线落在实体**内部**，任何点击都会先命中实体的面，
         * 按上面的规则永远轮不到它（实测"点虚线创建截面"完全无效）。所以指针停在预览上时让预览优先，
         * 除非用户明确指到了一个**比剖切面更靠前**的顶点/棱手柄——那种情况下用户要的是那个手柄。
         */
        const hit = pickRaycastHit3(scene, camera, point, { tolerance: pickTolerance() })
        const precise = hit?.kind === "point" || hit?.kind === "edge"
        // 按点击位置重新判定预览（不能用 pointermove 留下的标志：原地点击可能根本没有移动事件）。
        const pointerRay = raycasterAt(point)
        const previewHit = previewHitAt(point)
        /**
         * "预览在前面"带一个拾取容差的余量：交点标记与来源实体的顶点手柄常常**共心**
         *（交线的拐点就是那个顶点），半径不同会让大一点的那个在深度上先被命中——
         * 差在一个容差之内就算"同一深度"，由 `previewBeatsPick` 决定该听谁的。
         */
        const previewInFront = previewHit.depth === null || !hit || previewHit.depth <= hit.depth + pickTolerance()
        const previewWins = previewHit.preview !== null && previewBeatsPick({
          previewKind: previewHit.preview.kind,
          previewInFront,
          hitKind: hit?.kind ?? null,
          hitDistanceToRay: hit ? pointerRay.ray.distanceToPoint(new THREE.Vector3(hit.worldPoint.x, hit.worldPoint.y, hit.worldPoint.z)) : Number.POSITIVE_INFINITY,
          tolerance: pickTolerance()
        })
        // 排查读数：这一次点击到底被哪条规则拦下（粗拾取到了什么、预览有没有命中、谁更靠前）。
        if (sceneShell) sceneShell.dataset.pickReadout = `${hit?.kind ?? "none"}|${hit?.primitiveId ?? "-"}|${precise ? "precise" : "coarse"}|${previewHit.hovering ? "hover" : "off"}|${previewInFront ? "front" : "behind"}`
        if (previewWins && previewClickRef.current) previewClickRef.current(previewHit.preview!)
        else onSelectRef.current(resolveSelectableHit(hit?.primitiveId ?? null, topologyOwners, event.altKey), event.shiftKey)
      }
      if (sceneShell) delete sceneShell.dataset.dragging
      renderer.domElement.releasePointerCapture(event.pointerId)
      pointerStateRef.current = null
    }

  return { handlePointerDown, handlePointerMove, handlePointerUp }
}
