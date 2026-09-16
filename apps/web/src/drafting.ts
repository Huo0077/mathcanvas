import type { PrimitiveSpec } from "@draw/dsl"
import { nearestPointOnPrimitive, perpendicularPointOnPrimitive, planarIntersections, quadrantPointsOnPrimitive, type BoxSelectionMode, type PlanarSnapPrimitive, type SelectionBox } from "@draw/geometry-kernel"

/** 能提供捕捉几何的二维图元；`point` 单独处理（它自己就是一个端点）。 */
const snapGeometryTypes = ["line", "segment", "ray", "polyline", "circle", "arc"] as const

function isSnapGeometry(primitive: PrimitiveSpec): primitive is PlanarSnapPrimitive {
  return (snapGeometryTypes as readonly string[]).includes(primitive.type)
}

/**
 * 「2D 绘图」模式的纯几何内核：坐标窗口、对象捕捉、正交/极轴约束与实时读数。
 *
 * 之前这些逻辑都散在 `DrawingViewport` 的点击处理里，而且窗口是按内容自适应算出来的——画下第一个点，
 * 整个坐标系就会跳一次，用户根本没法画。这里把窗口固定成「以原点为中心、跨 span 的方窗」，只随
 * `view.scale` 缩放，于是坐标可预期、−/＋ 按钮也真正生效。
 */
export interface DraftWindow {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface DraftPoint {
  x: number
  y: number
}

/** 对象捕捉类型，按 CAD 惯例排序；`grid` 是兜底（不进候选列表），`nearest` 必须垫底。 */
export type SnapKind = "endpoint" | "intersection" | "midpoint" | "center" | "quadrant" | "perpendicular" | "nearest" | "grid"

export interface SnapCandidate {
  point: DraftPoint
  kind: Exclude<SnapKind, "grid">
}

export interface DraftSnap {
  point: DraftPoint
  kind: SnapKind
}

export interface DraftBox {
  left: number
  top: number
  width: number
  height: number
}

/** 比例 1 时绘图窗口跨 100（图纸单位，即 mm），与内容无关。 */
export const DRAFT_DEFAULT_SPAN = 100
/** 主网格 10mm；次网格 1mm 只在放大到能看清时才画。 */
export const DRAFT_GRID_MAJOR = 10
export const DRAFT_GRID_MINOR = 1
/** 次网格最小屏幕间距（像素），低于它就只保留主网格。 */
const DRAFT_GRID_MINIMUM_PIXELS = 8
/** 捕捉半径，按屏幕像素给，因此缩放后手感一致。 */
export const DRAFT_SNAP_PIXELS = 12

/** 落点坐标直接写进 `.mgeo`，所以统一收敛到 0.001（远小于屏幕精度），不留 1e-16 之类的浮点尘埃。 */
function roundDraft(value: number, decimals = 3): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

/**
 * 捕捉优先级。特征点越"确定"越靠前：端点/交点比中点/圆心更常被指到，
 * 而 `nearest` 在数学上永远最近，所以必须排在最后，否则它会吃掉所有其他候选。
 */
const ENDPOINT_PRIORITY = 0
const INTERSECTION_PRIORITY = 1
const MIDPOINT_PRIORITY = 2
const CENTER_PRIORITY = 3
const QUADRANT_PRIORITY = 4
const PERPENDICULAR_PRIORITY = 5
const NEAREST_PRIORITY = 6

const priority: Record<Exclude<SnapKind, "grid">, number> = {
  endpoint: ENDPOINT_PRIORITY,
  intersection: INTERSECTION_PRIORITY,
  midpoint: MIDPOINT_PRIORITY,
  center: CENTER_PRIORITY,
  quadrant: QUADRANT_PRIORITY,
  perpendicular: PERPENDICULAR_PRIORITY,
  nearest: NEAREST_PRIORITY
}

export function draftWindowSpan(scale: number): number {
  const safe = Number.isFinite(scale) && scale > 0 ? scale : 1
  return DRAFT_DEFAULT_SPAN / safe
}

export function draftWindow(scale: number): DraftWindow {
  const half = draftWindowSpan(scale) / 2
  return { minX: -half, maxX: half, minY: -half, maxY: half }
}

/** 屏幕像素 → 图纸坐标（y 轴向上），窗口固定所以同一个像素永远对应同一个坐标。 */
export function clientToDraft(client: DraftPoint, box: DraftBox, window: DraftWindow): DraftPoint {
  if (box.width <= 0 || box.height <= 0) return { x: window.minX, y: window.maxY }
  return {
    x: roundDraft(window.minX + ((client.x - box.left) / box.width) * (window.maxX - window.minX)),
    y: roundDraft(window.maxY - ((client.y - box.top) / box.height) * (window.maxY - window.minY))
  }
}

/**
 * 网格随缩放自适应：先保证主网格不超过约 60 条线（否则缩小后会画成一片灰），
 * 次网格再在"屏幕上真的能看清"（≥8px）时才显示。
 */
export function draftGrid(scale: number): { minor: number | null; major: number } {
  const span = draftWindowSpan(scale)
  let major = DRAFT_GRID_MAJOR
  while (span / major > 60) major *= 10
  const minorCandidate = major / 10
  const estimatedViewportPixels = 520
  const minorPixels = minorCandidate * (estimatedViewportPixels / span)
  return { minor: minorPixels >= DRAFT_GRID_MINIMUM_PIXELS ? minorCandidate : null, major }
}

/** 栅格捕捉用最细的可见网格步长：放大到能看见 1mm 次网格时就按 1mm 吸，否则退回主网格。 */
export function draftGridSnapStep(scale: number): number {
  const grid = draftGrid(scale)
  return grid.minor ?? grid.major
}

function pushCandidate(candidates: SnapCandidate[], point: DraftPoint, kind: SnapCandidate["kind"]): void {
  const duplicate = candidates.some((candidate) => candidate.kind === kind && Math.abs(candidate.point.x - point.x) < 1e-9 && Math.abs(candidate.point.y - point.y) < 1e-9)
  if (!duplicate) candidates.push({ point, kind })
}

/** 端点 / 中点 / 圆心 / 象限点 / 交点，以及（给了锚点时）垂足。 */
export function draftSnapCandidates(primitives: PrimitiveSpec[], options: { from?: DraftPoint | null } = {}): SnapCandidate[] {
  const candidates: SnapCandidate[] = []
  for (const primitive of primitives) if (primitive.type === "point") pushCandidate(candidates, { x: primitive.x, y: primitive.y }, "endpoint")
  const geometry = primitives.filter(isSnapGeometry)
  for (const primitive of geometry) {
    if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") {
      pushCandidate(candidates, { x: primitive.a.x, y: primitive.a.y }, "endpoint")
      pushCandidate(candidates, { x: primitive.b.x, y: primitive.b.y }, "endpoint")
      pushCandidate(candidates, { x: (primitive.a.x + primitive.b.x) / 2, y: (primitive.a.y + primitive.b.y) / 2 }, "midpoint")
    }
    if (primitive.type === "polyline") {
      for (const point of primitive.points) pushCandidate(candidates, { x: point.x, y: point.y }, "endpoint")
      for (let index = 1; index < primitive.points.length; index += 1) {
        const previous = primitive.points[index - 1]
        const current = primitive.points[index]
        pushCandidate(candidates, { x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2 }, "midpoint")
      }
    }
    if (primitive.type === "circle" || primitive.type === "arc") {
      pushCandidate(candidates, { x: primitive.center.x, y: primitive.center.y }, "center")
      for (const point of quadrantPointsOnPrimitive(primitive)) pushCandidate(candidates, point, "quadrant")
    }
    if (options.from) {
      const foot = perpendicularPointOnPrimitive(primitive, options.from)
      if (foot) pushCandidate(candidates, foot, "perpendicular")
    }
  }
  // 两两交点：工程量级下 O(n²) 可接受（可见二维图元通常只有几十个）。
  for (let first = 0; first < geometry.length; first += 1) {
    for (let second = first + 1; second < geometry.length; second += 1) {
      for (const point of planarIntersections(geometry[first], geometry[second])) pushCandidate(candidates, point, "intersection")
    }
  }
  return candidates
}

/**
 * 按「优先级 → 距离」排序出所有命中的候选，供 Tab 循环切换。
 * 传了 `primitives` 才会补上 `nearest`（它依赖指针位置，不能预先列举）。
 */
export function rankDraftSnaps(raw: DraftPoint, candidates: SnapCandidate[], options: { tolerance: number; primitives?: PrimitiveSpec[] }): SnapCandidate[] {
  const tolerance = options.tolerance
  if (!Number.isFinite(tolerance) || tolerance <= 0) return []
  const pool: SnapCandidate[] = [...candidates]
  for (const primitive of options.primitives ?? []) {
    if (!isSnapGeometry(primitive)) continue
    const point = nearestPointOnPrimitive(primitive, raw)
    if (point) pool.push({ point, kind: "nearest" })
  }
  const ranked = pool
    .map((candidate) => ({ candidate, distance: Math.hypot(candidate.point.x - raw.x, candidate.point.y - raw.y) }))
    .filter((entry) => entry.distance <= tolerance)
    .sort((first, second) => priority[first.candidate.kind] - priority[second.candidate.kind] || first.distance - second.distance)
    .map((entry) => entry.candidate)
  // 同一位置上可能同时有"端点"和"交点"（两条线段共端点），循环时按位置去重，保留优先级更高的那个。
  return ranked.filter((candidate, index) => !ranked.slice(0, index).some((kept) => Math.hypot(kept.point.x - candidate.point.x, kept.point.y - candidate.point.y) < 1e-6))
}

/** 容差内最优候选；既有点击路径也在用，保留旧签名。 */
export function resolveDraftSnap(raw: DraftPoint, candidates: SnapCandidate[], tolerance: number, primitives?: PrimitiveSpec[]): DraftSnap | null {
  const best = rankDraftSnaps(raw, candidates, { tolerance, primitives })[0]
  return best ? { point: best.point, kind: best.kind } : null
}

/** 网格吸附：正交/极轴之外的最后一道保险，保证落点永远是整数栅格。 */
export function snapToGrid(point: DraftPoint, step: number): DraftPoint {
  if (!Number.isFinite(step) || step <= 0) return point
  return { x: Math.round(point.x / step) * step, y: Math.round(point.y / step) * step }
}

/**
 * 把点约束到以 `origin` 为起点、`stepDegrees` 为间隔的方向上（投影到该方向，保留沿该方向的距离）。
 *
 * - `stepDegrees = 90` 就是正交模式（AutoCAD 的 Ortho）：**无论指针在哪都压到轴上**。
 * - 给了 `thresholdDegrees` 就变成极轴追踪（Polar tracking）：只有指针落在射线附近才吸附，
 *   否则保持自由落点。没有阈值的话就退化成"把光标永久锁死在 45° 的倍数上"，那不是极轴。
 */
export function constrainAngle(origin: DraftPoint, point: DraftPoint, stepDegrees: number, options: { thresholdDegrees?: number } = {}): DraftPoint {
  if (!Number.isFinite(stepDegrees) || stepDegrees <= 0) return point
  const deltaX = point.x - origin.x
  const deltaY = point.y - origin.y
  if (deltaX === 0 && deltaY === 0) return point
  const step = (Math.PI * stepDegrees) / 180
  const pointerAngle = Math.atan2(deltaY, deltaX)
  const angle = Math.round(pointerAngle / step) * step
  const threshold = options.thresholdDegrees
  if (threshold !== undefined && Number.isFinite(threshold)) {
    const deviation = Math.abs(pointerAngle - angle) * 180 / Math.PI
    if (deviation > threshold) return point
  }
  const direction = { x: Math.cos(angle), y: Math.sin(angle) }
  const projected = deltaX * direction.x + deltaY * direction.y
  return { x: roundDraft(origin.x + direction.x * projected), y: roundDraft(origin.y + direction.y * projected) }
}

/** 实时读数：长度 + 0–360° 方位角。 */
export function draftMeasurement(origin: DraftPoint, point: DraftPoint): { length: number; angleDeg: number } {
  const length = Math.hypot(point.x - origin.x, point.y - origin.y)
  const raw = (Math.atan2(point.y - origin.y, point.x - origin.x) * 180) / Math.PI
  return { length: Number(length.toFixed(3)), angleDeg: Number(((raw + 360) % 360).toFixed(2)) }
}

/** 拖框方向决定选择语义：**从左往右**只选完全包含的对象，**从右往左**选相交的对象（AutoCAD 约定）。 */
export function boxSelectionMode(anchor: DraftPoint, current: DraftPoint): BoxSelectionMode {
  return current.x >= anchor.x ? "window" : "crossing"
}

/** 任意方向拖出的矩形都归一成 min/max。 */
export function normalizeSelectionBox(anchor: DraftPoint, current: DraftPoint): SelectionBox {
  return {
    minX: Math.min(anchor.x, current.x),
    minY: Math.min(anchor.y, current.y),
    maxX: Math.max(anchor.x, current.x),
    maxY: Math.max(anchor.y, current.y)
  }
}
