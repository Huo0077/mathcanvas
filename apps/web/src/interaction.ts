import type { PrimitiveSpec } from "@draw/dsl"
import type { PrimitiveUpdatePatch } from "@draw/scene-graph"

export type DragHandle = "body" | "a" | "b" | "radius" | "startAngle" | "endAngle" | "vertex" | "radiusX" | "radiusY" | "rotation" | `vertex-${number}`
export type DragAction = { kind: "translate"; delta: { x: number; y: number } } | { kind: "update"; patch: PrimitiveUpdatePatch }

const derivedTypes = new Set(["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection", "intersectionSet"])

function distance(first: { x: number; y: number }, second: { x: number; y: number }): number {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function pointOnCircle(center: { x: number; y: number }, radius: number, angle: number): { x: number; y: number } {
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) }
}

export function rotationHandlePoint(primitive: Extract<PrimitiveSpec, { type: "parabola" | "ellipse" | "hyperbola" }>): { x: number; y: number } {
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

export function getDragHandle(primitive: PrimitiveSpec, pointer: { x: number; y: number }, tolerance = 0.35): DragHandle | null {
  if (derivedTypes.has(primitive.type) || primitive.locked) return null
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") {
    if (distance(primitive.a, pointer) <= tolerance) return "a"
    if (distance(primitive.b, pointer) <= tolerance) return "b"
  }
  if (primitive.type === "polyline") {
    const index = primitive.points.findIndex((point) => distance(point, pointer) <= tolerance)
    if (index >= 0) return `vertex-${index}`
  }
  if (primitive.type === "circle") {
    if (distance({ x: primitive.center.x + primitive.radius, y: primitive.center.y }, pointer) <= tolerance) return "radius"
  }
  if (primitive.type === "arc") {
    if (distance(pointOnCircle(primitive.center, primitive.radius, primitive.startAngle), pointer) <= tolerance) return "startAngle"
    if (distance(pointOnCircle(primitive.center, primitive.radius, primitive.endAngle), pointer) <= tolerance) return "endAngle"
    const middleAngle = (primitive.startAngle + primitive.endAngle) / 2
    if (distance(pointOnCircle(primitive.center, primitive.radius, middleAngle), pointer) <= tolerance) return "radius"
  }
  if (primitive.type === "parabola" && distance(primitive.vertex, pointer) <= tolerance) return "vertex"
  if ((primitive.type === "parabola" || primitive.type === "ellipse" || primitive.type === "hyperbola") && distance(rotationHandlePoint(primitive), pointer) <= tolerance) return "rotation"
  if ((primitive.type === "ellipse" || primitive.type === "hyperbola") && distance({ x: primitive.center.x + primitive.radiusX * Math.cos(primitive.rotation ?? 0), y: primitive.center.y + primitive.radiusX * Math.sin(primitive.rotation ?? 0) }, pointer) <= tolerance) return "radiusX"
  if ((primitive.type === "ellipse" || primitive.type === "hyperbola") && distance({ x: primitive.center.x - primitive.radiusY * Math.sin(primitive.rotation ?? 0), y: primitive.center.y + primitive.radiusY * Math.cos(primitive.rotation ?? 0) }, pointer) <= tolerance) return "radiusY"
  return "body"
}

/**
 * 可拖动控制点的位置（数学画布与 CAD 2D 绘图共用同一份定义，避免两个视口各写一套手柄几何）。
 * 顺序即渲染顺序；派生对象、锁定对象和没有手柄的图元返回空数组。
 */
export function primitiveHandlePoints(primitive: PrimitiveSpec): { handle: DragHandle; point: { x: number; y: number } }[] {
  if (derivedTypes.has(primitive.type) || primitive.locked) return []
  const handles: { handle: DragHandle; point: { x: number; y: number } }[] = []
  if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") handles.push({ handle: "a", point: primitive.a }, { handle: "b", point: primitive.b })
  if (primitive.type === "polyline") primitive.points.forEach((point, index) => handles.push({ handle: `vertex-${index}`, point }))
  if (primitive.type === "parabola") handles.push({ handle: "vertex", point: primitive.vertex }, { handle: "rotation", point: rotationHandlePoint(primitive) })
  if (primitive.type === "circle") handles.push({ handle: "radius", point: { x: primitive.center.x + primitive.radius, y: primitive.center.y } })
  if (primitive.type === "arc") {
    handles.push({ handle: "startAngle", point: pointOnCircle(primitive.center, primitive.radius, primitive.startAngle) })
    handles.push({ handle: "endAngle", point: pointOnCircle(primitive.center, primitive.radius, primitive.endAngle) })
    handles.push({ handle: "radius", point: pointOnCircle(primitive.center, primitive.radius, (primitive.startAngle + primitive.endAngle) / 2) })
  }
  if (primitive.type === "ellipse" || primitive.type === "hyperbola") {
    const rotation = primitive.rotation ?? 0
    handles.push(
      { handle: "radiusX", point: { x: primitive.center.x + primitive.radiusX * Math.cos(rotation), y: primitive.center.y + primitive.radiusX * Math.sin(rotation) } },
      { handle: "radiusY", point: { x: primitive.center.x - primitive.radiusY * Math.sin(rotation), y: primitive.center.y + primitive.radiusY * Math.cos(rotation) } },
      { handle: "rotation", point: rotationHandlePoint(primitive) }
    )
  }
  return handles
}

export function createDragAction(primitive: PrimitiveSpec, handle: DragHandle, origin: { x: number; y: number }, current: { x: number; y: number }): DragAction | null {
  if (derivedTypes.has(primitive.type) || primitive.locked) return null
  if (handle === "body") return { kind: "translate", delta: { x: current.x - origin.x, y: current.y - origin.y } }
  if ((primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") && (handle === "a" || handle === "b")) return { kind: "update", patch: { [handle]: current } }
  if (primitive.type === "polyline" && handle.startsWith("vertex-")) {
    const index = Number(handle.slice("vertex-".length))
    return Number.isInteger(index) && index >= 0 && index < primitive.points.length
      ? { kind: "update", patch: { points: primitive.points.map((point, pointIndex) => pointIndex === index ? current : point) } }
      : null
  }
  if ((primitive.type === "circle" || primitive.type === "arc") && handle === "radius") return { kind: "update", patch: { radius: Math.max(0.01, distance(primitive.center, current)) } }
  if (primitive.type === "arc" && (handle === "startAngle" || handle === "endAngle")) {
    const angle = Math.atan2(current.y - primitive.center.y, current.x - primitive.center.x)
    return { kind: "update", patch: { [handle]: angle } }
  }
  if (primitive.type === "parabola" && handle === "vertex") return { kind: "update", patch: { vertex: current } }
  if ((primitive.type === "parabola" || primitive.type === "ellipse" || primitive.type === "hyperbola") && handle === "rotation") {
    const center = primitive.type === "parabola" ? primitive.vertex : primitive.center
    return { kind: "update", patch: { rotation: Math.atan2(current.y - center.y, current.x - center.x) } }
  }
  if ((primitive.type === "ellipse" || primitive.type === "hyperbola") && handle === "radiusX") return { kind: "update", patch: { radiusX: Math.max(0.01, Math.abs(rotateToLocal(current, primitive.center, primitive.rotation ?? 0).x)) } }
  if ((primitive.type === "ellipse" || primitive.type === "hyperbola") && handle === "radiusY") return { kind: "update", patch: { radiusY: Math.max(0.01, Math.abs(rotateToLocal(current, primitive.center, primitive.rotation ?? 0).y)) } }
  return null
}
