import type { Coordinate, PrimitiveSpec } from "@draw/dsl"
import type { PrimitiveUpdatePatch } from "@draw/scene-graph"

import { anchoredCurve, dragRotationAngle, isRotatableCurve, placementPatch, radiusHandlePoint, resizedPlacement, rotationHandlePoint, type RotatableCurve } from "./curveRotation"

export type DragHandle = "body" | "a" | "b" | "radius" | "startAngle" | "endAngle" | "vertex" | "radiusX" | "radiusY" | "rotation" | "rotate" | `vertex-${number}`
export type DragAction = { kind: "translate"; delta: { x: number; y: number } } | { kind: "update"; patch: PrimitiveUpdatePatch }

/**
 * 拖动"绕定点旋转"的曲线时需要的东西：定点、基准中心，以及定点是不是一个点图元。
 *
 * 由界面在拖动开始时解析好传进来（`interaction.ts` 不读文档，保持纯函数好测）。
 */
export interface DragRotationTarget {
  pivot: Coordinate
  baseCenter: Coordinate
  pivotPrimitiveId: string | null
  /** 曲线当前的累积转角。 */
  angle: number
}

// 连接（connection）不含自己的坐标，完全由两个端点定义：拖它没有意义，要拖的是端点。
const derivedTypes = new Set(["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection", "intersectionSet", "connection"])

function distance(first: { x: number; y: number }, second: { x: number; y: number }): number {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function pointOnCircle(center: { x: number; y: number }, radius: number, angle: number): { x: number; y: number } {
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }
}

export function rotationHandlePointFor(primitive: Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }>): { x: number; y: number } {
  const radius = primitive.type === "parabola" ? 1.5 : Math.max(primitive.radiusX, primitive.radiusY) + 1
  const center = primitive.type === "parabola" ? primitive.vertex : primitive.center
  const rotation = primitive.rotation ?? 0
  return { x: center.x + radius * Math.cos(rotation), y: center.y + radius * Math.sin(rotation) }
}

function rotateToLocal(point: { x: number; y: number }, center: { x: number; y: number }, rotation: number): { x: number; y: number } {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const x = point.x - center.x
  const y = point.y - center.y
  return { x: x * cos + y * sin, y: -x * sin + y * cos }
}

/**
 * 放置后的曲线：把手柄摆到**基准几何**上。
 *
 * `center` 是派生值（转过之后的位置），直接拿它算手柄，半径手柄会跟着转、还能被拖回去一个
 * 与显示不符的半径；所以这里先归一回基准，再算手柄与控制点。
 */
function handleFrame(primitive: PrimitiveSpec): PrimitiveSpec {
  if (!isRotatableCurve(primitive) || !primitive.rotationAbout) return primitive
  const rotation = primitive.rotationAbout
  return { ...primitive, center: { ...rotation.baseCenter }, rotation: primitive.rotation === undefined ? undefined : (primitive.rotation - rotation.angle) }
}

/**
 * 指针落在哪个手柄上（没有手柄就是 `body`）。
 *
 * `selected` 是**必要的**：控制点只在选中时画出来，命中判定必须跟着一致。
 * 对"动圆"尤其关键 —— 它的半径手柄摆在"定点 + 半径"处，正好落在圆周上，
 * 不按选中过滤的话，那个手柄会替未选中的曲线吃掉圆周上那一小块的指针，
 * 用户想在圆周上按下拖动就变成了改半径（实测）。
 */
export function getDragHandle(primitive: PrimitiveSpec, pointer: { x: number; y: number }, tolerance = 0.35, rotation?: DragRotationTarget, selected = true): DragHandle | null {
  if (derivedTypes.has(primitive.type) || primitive.locked) return null
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") {
    if (distance(primitive.a, pointer) <= tolerance) return "a"
    if (distance(primitive.b, pointer) <= tolerance) return "b"
  }
  if (primitive.type === "polyline") {
    const index = primitive.points.findIndex((point) => distance(point, pointer) <= tolerance)
    if (index >= 0) return `vertex-${index}`
  }
  const frame = handleFrame(primitive)
  if (selected) {
    // 椭圆的独立旋转手柄优先：它就在曲线外侧，与半径手柄不会打架。
    // 用**基准**几何算位置，与半径手柄同一套（`center` 是转过之后的派生值）。
    if (rotation && isRotatableCurve(primitive) && primitive.type === "ellipse" && distance(rotationHandlePoint(frame as RotatableCurve, rotation.pivot), pointer) <= tolerance) return "rotate"
    if (frame.type === "circle") {
      // 动圆的半径手柄按**固定方向**（斜 40°）摆在圆周上，与 `primitiveHandlePoints` 同一套位置。
      const anchored = rotation && rotation.pivotPrimitiveId !== null
      const radiusPoint = anchored ? radiusHandlePoint(rotation!.pivot, frame.radius) : { x: frame.center.x + frame.radius, y: frame.center.y }
      if (distance(radiusPoint, pointer) <= tolerance) return "radius"
    }
  }
  if (frame.type === "arc") {
    if (distance(pointOnCircle(frame.center, frame.radius, frame.startAngle), pointer) <= tolerance) return "startAngle"
    if (distance(pointOnCircle(frame.center, frame.radius, frame.endAngle), pointer) <= tolerance) return "endAngle"
    const middleAngle = (frame.startAngle + frame.endAngle) / 2
    if (distance(pointOnCircle(frame.center, frame.radius, middleAngle), pointer) <= tolerance) return "radius"
  }
  if (selected) {
    if (frame.type === "parabola" && distance(frame.vertex, pointer) <= tolerance) return "vertex"
    if ((frame.type === "parabola" || frame.type === "ellipse" || frame.type === "hyperbola") && distance(rotationHandlePointFor(frame), pointer) <= tolerance) return "rotation"
    if ((frame.type === "ellipse" || frame.type === "hyperbola") && distance({ x: frame.center.x + frame.radiusX * Math.cos(frame.rotation ?? 0), y: frame.center.y + frame.radiusX * Math.sin(frame.rotation ?? 0) }, pointer) <= tolerance) return "radiusX"
    if ((frame.type === "ellipse" || frame.type === "hyperbola") && distance({ x: frame.center.x - frame.radiusY * Math.sin(frame.rotation ?? 0), y: frame.center.y + frame.radiusY * Math.cos(frame.rotation ?? 0) }, pointer) <= tolerance) return "radiusY"
  }
  return "body"
}

/**
 * 可拖动控制点的位置（数学画布与 CAD 2D 绘图共用同一份定义，避免两个视口各写一套手柄几何）。
 * 顺序即渲染顺序；派生对象、锁定对象和没有手柄的图元返回空数组。
 */
export function primitiveHandlePoints(primitive: PrimitiveSpec, rotation?: DragRotationTarget): { handle: DragHandle; point: { x: number; y: number } }[] {
  if (derivedTypes.has(primitive.type) || primitive.locked) return []
  const handles: { handle: DragHandle; point: { x: number; y: number } }[] = []
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") handles.push({ handle: "a", point: primitive.a }, { handle: "b", point: primitive.b })
  if (primitive.type === "polyline") primitive.points.forEach((point, index) => handles.push({ handle: `vertex-${index}`, point }))
  const frame = handleFrame(primitive)
  if (frame.type === "parabola") handles.push({ handle: "vertex", point: frame.vertex }, { handle: "rotation", point: rotationHandlePointFor(frame) })
  if (frame.type === "circle") {
    /**
     * 以某个点为**定点**的动圆：半径手柄摆在**定点**上，而不是基准圆心右侧。
     *
     * 动圆刚创建时基准圆心离定点恰好一个半径，于是"圆心 + 半径"那个手柄正好压在定点上，
     * 与点自己的命中区打架（实测：圆心附近点不到圆）。摆在定点上就没有这个问题，
     * 而且它的含意很直白——从定点量出去的长度就是半径。
     */
    const anchored = rotation && rotation.pivotPrimitiveId !== null
    handles.push({ handle: "radius", point: anchored ? radiusHandlePoint(rotation!.pivot, frame.radius) : { x: frame.center.x + frame.radius, y: frame.center.y } })
  }
  if (frame.type === "arc") {
    handles.push({ handle: "startAngle", point: pointOnCircle(frame.center, frame.radius, frame.startAngle) })
    handles.push({ handle: "endAngle", point: pointOnCircle(frame.center, frame.radius, frame.endAngle) })
    handles.push({ handle: "radius", point: pointOnCircle(frame.center, frame.radius, (frame.startAngle + frame.endAngle) / 2) })
  }
  if (frame.type === "ellipse" || frame.type === "hyperbola") {
    const rotation = frame.rotation ?? 0
    handles.push(
      { handle: "radiusX", point: { x: frame.center.x + frame.radiusX * Math.cos(rotation), y: frame.center.y + frame.radiusX * Math.sin(rotation) } },
      { handle: "radiusY", point: { x: frame.center.x - frame.radiusY * Math.sin(rotation), y: frame.center.y + frame.radiusY * Math.cos(rotation) } },
      { handle: "rotation", point: rotationHandlePointFor(frame) }
    )
  }
  /**
   * 绕定点旋转的独立手柄只给**椭圆**用：圆的拖动本身就是"绕定点转"（见 `createDragAction` 的 body 分支），
   * 再摆一个手柄反而多一个要解释的东西。
   */
  if (rotation && isRotatableCurve(frame) && frame.type === "ellipse") handles.push({ handle: "rotate", point: rotationHandlePoint(frame, rotation.pivot) })
  return handles
}

/** 已被放置的曲线：把补丁里的"局部几何"改回基准，避免平面编辑把转过的位置当基准。 */
function rebaseForPlacement(curve: RotatableCurve, patch: PrimitiveUpdatePatch, rotation: DragRotationTarget): PrimitiveUpdatePatch {
  if (curve.type === "circle" && patch.radius !== undefined) {
    // 与检查器里改半径走**同一个**函数：两条通路都必须重摆基准圆心，否则曲线不再过定点。
    const placement = resizedPlacement(curve, patch.radius, rotation.pivot)
    return placement ? { ...patch, rotationAbout: placement } : patch
  }
  if (curve.type === "ellipse" && (patch.radiusX !== undefined || patch.radiusY !== undefined)) {
    const next = { ...curve, ...patch }
    const anchored = anchoredCurve(next, rotation.pivot)
    return anchored ? { ...patch, rotationAbout: anchored.rotationAbout } : patch
  }
  return patch
}

export function createDragAction(
  primitive: PrimitiveSpec,
  handle: DragHandle,
  origin: { x: number; y: number },
  current: { x: number; y: number },
  rotation?: DragRotationTarget
): DragAction | null {
  if (derivedTypes.has(primitive.type) || primitive.locked) return null
  if (handle === "body") {
    const delta = { x: current.x - origin.x, y: current.y - origin.y }
    /*
     * 动圆（定点是**点图元**）：拖它就是**绕那个定点转**。
     *
     * 这是用户口径里"动圆"的核心动作：定点不动、曲线绕着它转，于是"始终过这个定点"永远成立。
     * 转角用指针绕定点的差值算，所以按下的那一下不会跳。
     */
    if (rotation && isRotatableCurve(primitive) && primitive.rotationAbout && rotation.pivotPrimitiveId) {
      const angle = dragRotationAngle(rotation.pivot, origin, current, rotation.angle)
      return { kind: "update", patch: { rotation: angle, rotationAbout: { ...primitive.rotationAbout, angle } } }
    }
    /*
     * 定点是固定坐标的放置曲线：拖它平移——定点与基准中心一起搬，否则重算会用旧基准把曲线拉回去。
     */
    if (rotation && isRotatableCurve(primitive) && primitive.rotationAbout) {
      const patch = placementPatch(primitive, { x: rotation.pivot.x + delta.x, y: rotation.pivot.y + delta.y }, rotation.angle)
      return {
        kind: "update",
        patch: {
          ...patch,
          rotationAbout: {
            pivot: { kind: "coordinate", x: rotation.pivot.x + delta.x, y: rotation.pivot.y + delta.y },
            angle: rotation.angle,
            baseCenter: { x: rotation.baseCenter.x + delta.x, y: rotation.baseCenter.y + delta.y }
          }
        }
      }
    }
    return { kind: "translate", delta }
  }
  if (handle === "rotate") {
    // 定点是**点图元**时不能改写它的位置（定点是独立图元），所以这种情况下只更新转角。
    if (!rotation || !isRotatableCurve(primitive) || !primitive.rotationAbout) return null
    const angle = dragRotationAngle(rotation.pivot, origin, current, rotation.angle)
    if (rotation.pivotPrimitiveId) return { kind: "update", patch: { rotationAbout: { ...primitive.rotationAbout, angle }, rotation: angle } }
    return { kind: "update", patch: placementPatch(primitive, rotation.pivot, angle) }
  }
  if ((primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") && (handle === "a" || handle === "b")) return { kind: "update", patch: { [handle]: current } }
  if (primitive.type === "polyline" && handle.startsWith("vertex-")) {
    const index = Number(handle.slice("vertex-".length))
    return Number.isInteger(index) && index >= 0 && index < primitive.points.length
      ? { kind: "update", patch: { points: primitive.points.map((point, pointIndex) => pointIndex === index ? current : point) } }
      : null
  }
  const frame = handleFrame(primitive)
  if ((frame.type === "circle" || frame.type === "arc") && handle === "radius") {
    const patch = { radius: Math.max(0.01, distance(frame.center, current)) }
    return { kind: "update", patch: rotation && isRotatableCurve(primitive) && primitive.rotationAbout ? rebaseForPlacement(primitive, patch, rotation) : patch }
  }
  if (frame.type === "arc" && (handle === "startAngle" || handle === "endAngle")) {
    const angle = Math.atan2(current.y - frame.center.y, current.x - frame.center.x)
    return { kind: "update", patch: { [handle]: angle } }
  }
  if (frame.type === "parabola" && handle === "vertex") return { kind: "update", patch: { vertex: current } }
  if ((frame.type === "parabola" || frame.type === "ellipse" || frame.type === "hyperbola") && handle === "rotation") {
    const center = frame.type === "parabola" ? frame.vertex : frame.center
    return { kind: "update", patch: { rotation: Math.atan2(current.y - center.y, current.x - center.x) } }
  }
  if ((frame.type === "ellipse" || frame.type === "hyperbola") && handle === "radiusX") {
    const patch = { radiusX: Math.max(0.01, Math.abs(rotateToLocal(current, frame.center, frame.rotation ?? 0).x)) }
    return { kind: "update", patch: rotation && isRotatableCurve(primitive) && primitive.rotationAbout ? rebaseForPlacement(primitive, patch, rotation) : patch }
  }
  if ((frame.type === "ellipse" || frame.type === "hyperbola") && handle === "radiusY") {
    const patch = { radiusY: Math.max(0.01, Math.abs(rotateToLocal(current, frame.center, frame.rotation ?? 0).y)) }
    return { kind: "update", patch: rotation && isRotatableCurve(primitive) && primitive.rotationAbout ? rebaseForPlacement(primitive, patch, rotation) : patch }
  }
  return null
}
