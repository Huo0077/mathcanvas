import type { Coordinate, CurveRotation, PrimitiveSpec } from "@draw/dsl"

/**
 * 封闭曲线绕定点旋转在**界面层**的几何：定点标记、旋转手柄的位置，以及拖动手柄时角度怎么变。
 *
 * 这里只做"看得见、拖得动"那部分；真正的旋转由内核 `placedConic` 负责（基准 + 定点 + 转角）。
 */
export type RotatableCurve = Extract<PrimitiveSpec, { type: "circle" | "ellipse" }>

/** 哪些图元支持绕定点旋转：只有封闭曲线（圆、椭圆）。弧 / 双曲线 / 抛物线不在内。 */
export function isRotatableCurve(primitive: PrimitiveSpec): primitive is RotatableCurve {
  return primitive.type === "circle" || primitive.type === "ellipse"
}

/** 曲线的尺度：手柄要按它摆，图形大小一变手柄不会跑到天上去。 */
function curveExtent(primitive: RotatableCurve): number {
  return primitive.type === "circle"
    ? primitive.radius
    : Math.max(primitive.radiusX, primitive.radiusY)
}

/** 手柄离定点的距离（世界单位）：在曲线外面一点，不跟曲线本身抢点击。 */
export const ROTATION_HANDLE_GAP = 0.6

/**
 * **动圆的半径手柄位置**：从定点出发、按一个固定方向摆到圆周上。
 *
 * 为什么不用"定点正右方"：那正好是圆的横向轴线端点（角度 0 时还是圆心所在方向），
 * 手柄画成小空心圆，看上去就跟"这里有个点 / 圆心被标出来了"一样（用户实测反馈："这不是有一个点（圆心）吗"）。
 * 斜 40° 摆放让它既不与定点重合、也不在坐标轴方向上，一眼就是控制点而不是数据点。
 */
export const RADIUS_HANDLE_ANGLE = (40 * Math.PI) / 180

export function radiusHandlePoint(pivot: Coordinate, radius: number): Coordinate {
  return { x: pivot.x + radius * Math.cos(RADIUS_HANDLE_ANGLE), y: pivot.y + radius * Math.sin(RADIUS_HANDLE_ANGLE) }
}

/**
 * 旋转手柄的位置：从定点朝**曲线中心**的方向往外放一段。
 *
 * 以"定点 → 中心"为基准方向是有意的：手柄始终落在曲线外侧、且在曲线所在的那一侧，
 * 定点在曲线内部（曲线绕自己内部一点转）时也不会把两个手柄叠在一起。
 */
export function rotationHandlePoint(curve: RotatableCurve, pivot: Coordinate): Coordinate {
  const center = curve.center
  const dx = center.x - pivot.x
  const dy = center.y - pivot.y
  const length = Math.hypot(dx, dy)
  const radius = curveExtent(curve) + ROTATION_HANDLE_GAP
  if (length <= 1e-9) return { x: pivot.x + radius, y: pivot.y }
  return { x: pivot.x + (dx / length) * radius, y: pivot.y + (dy / length) * radius }
}

/**
 * 拖动旋转手柄：由"指针相对定点转过了多少"反推新的累积转角。
 *
 * `origin` 是指针按下时的位置、`current` 是当前指针位置。用**差值**而不是绝对角，
 * 所以按下手柄的那一下不会让曲线跳一下（手柄与定点、中心三点不共线时绝对角并不等于当前转角）。
 */
export function dragRotationAngle(pivot: Coordinate, origin: Coordinate, current: Coordinate, startAngle: number): number {
  const start = Math.atan2(origin.y - pivot.y, origin.x - pivot.x)
  const now = Math.atan2(current.y - pivot.y, current.x - pivot.x)
  return startAngle + (now - start)
}

/**
 * 把"定点 + 转角"写成曲线上的完整放置。
 *
 * `baseCenter` 取曲线的**基准中心**：放置已经生效时它是 `rotationAbout.baseCenter`，
 * 还没放置时就是当前 `center`。缺了它会退化成"把转过的位置当基准"，重算一次就漂移（实测缺陷）。
 */
export function placementPatch(
  curve: RotatableCurve,
  pivot: Coordinate,
  angle: number
): { rotationAbout: CurveRotation; rotation: number } {
  return {
    rotationAbout: {
      pivot: { kind: "coordinate", x: pivot.x, y: pivot.y },
      angle,
      baseCenter: baseCenterOf(curve)
    },
    rotation: angle
  }
}

/** 曲线的基准中心：已经放置过的曲线要从 `rotationAbout` 里取，否则会被当成"没转过"。 */
export function baseCenterOf(curve: RotatableCurve): Coordinate {
  const placement = curve.rotationAbout
  return placement ? { x: placement.baseCenter.x, y: placement.baseCenter.y } : { x: curve.center.x, y: curve.center.y }
}

/**
 * 改半径之后，把基准圆心重新摆到"离定点恰好一个新半径"处 —— 定点因此不会掉出曲线。
 *
 * 半径有**两条**编辑通路（画布上拖半径手柄、检查器里改半径输入框），两条都必须走这一步：
 * 只改 `radius` 而不动基准圆心，曲线就不再经过那个定点
 * （实测：半径 2→5 之后圆心留在原处，定点到圆心只剩 2，而半径是 5）。
 *
 * 返回整块 `rotationAbout`，调用方连同 `radius` 一起写进补丁；不是圆、或没有放置信息时返回 `undefined`。
 */
export function resizedPlacement(curve: RotatableCurve, radius: number, pivot: Coordinate): CurveRotation | undefined {
  const placement = curve.rotationAbout
  if (!placement || curve.type !== "circle") return undefined
  const dx = placement.baseCenter.x - pivot.x
  const dy = placement.baseCenter.y - pivot.y
  const length = Math.hypot(dx, dy)
  // 基准圆心与定点重合（理论上不该出现）时退回"定点正右方"：保证方向确定、不产生 NaN。
  const direction = length > 1e-9 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 }
  return { ...placement, baseCenter: { x: pivot.x + direction.x * radius, y: pivot.y + direction.y * radius } }
}

/**
 * 把"定点"解析成世界坐标（`rotationAbout` 里两种写法都支持）。
 * `lookup` 用来取点图元引用；引用悬空时返回 `null`，调用方按"没有定点"处理。
 */
export function placementPivot(curve: RotatableCurve, lookup: (id: string) => PrimitiveSpec | undefined): Coordinate | null {
  const placement = curve.rotationAbout
  if (!placement) return null
  if (placement.pivot.kind === "coordinate") return { x: placement.pivot.x, y: placement.pivot.y }
  const point = lookup(placement.pivot.primitiveId)
  return point?.type === "point" ? { x: point.x, y: point.y } : null
}

/**
 * 把选中的点定为曲线的旋转中心。
 *
 * 定点**必须落在曲线上**才谈得上"曲线过这个定点"：点不在曲线上时先把它投影到曲线上
 * （圆取径向、椭圆用内核的参数投影），而不是干脆拒绝 —— 用户点选一个近处的点是很自然的动作。
 * 返回 `null` 表示这个点无法作为定点（例如曲线退化）。
 */
export function anchorPointFor(curve: RotatableCurve, point: Coordinate): Coordinate | null {
  if (curve.type === "circle") {
    const dx = point.x - curve.center.x
    const dy = point.y - curve.center.y
    const length = Math.hypot(dx, dy)
    if (length <= 1e-9) return null
    return { x: curve.center.x + (dx / length) * curve.radius, y: curve.center.y + (dy / length) * curve.radius }
  }
  // 椭圆：把点缩放成单位圆上的方向再映射回椭圆（长轴对齐的近似投影，够用且稳定）。
  const rotation = curve.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const localX = (point.x - curve.center.x) * cos + (point.y - curve.center.y) * sin
  const localY = -(point.x - curve.center.x) * sin + (point.y - curve.center.y) * cos
  const scaled = { x: localX / curve.radiusX, y: localY / curve.radiusY }
  const length = Math.hypot(scaled.x, scaled.y)
  if (length <= 1e-9) return null
  const onUnit = { x: scaled.x / length, y: scaled.y / length }
  const onEllipse = { x: onUnit.x * curve.radiusX, y: onUnit.y * curve.radiusY }
  return {
    x: curve.center.x + onEllipse.x * cos - onEllipse.y * sin,
    y: curve.center.y + onEllipse.x * sin + onEllipse.y * cos
  }
}

/**
 * 让"定点落在曲线上"这件事在数值上成立：返回**定型后的曲线**（`center` 摆到离定点恰好一个半轴处）
 * 与配套的放置信息。
 *
 * 用户点选的定点往往差几个像素，直接存下来就是"曲线并不真的过定点"。
 * 这里把圆心挪到位，同时把基准中心一并写好（角为 0，于是基准与结果重合）。
 */
export function anchoredCurve(
  curve: RotatableCurve,
  pivot: Coordinate
): { curve: RotatableCurve; pivot: Coordinate; rotationAbout: CurveRotation } | null {
  const anchored = anchorPointFor(curve, pivot)
  if (!anchored) return null
  if (curve.type === "circle") {
    const dx = curve.center.x - anchored.x
    const dy = curve.center.y - anchored.y
    const length = Math.hypot(dx, dy)
    if (length <= 1e-9) return null
    const baseCenter = { x: anchored.x + (dx / length) * curve.radius, y: anchored.y + (dy / length) * curve.radius }
    return {
      curve: { ...curve, center: baseCenter, rotation: 0 },
      pivot: anchored,
      rotationAbout: { pivot: { kind: "coordinate", x: anchored.x, y: anchored.y }, angle: 0, baseCenter }
    }
  }
  // 椭圆：把基准中心摆到"定点在参数 0 方向的反侧"那一处，于是定点落在椭圆上。
  const rotation = curve.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const local = { x: -curve.radiusX, y: 0 }
  const baseCenter = {
    x: anchored.x + local.x * cos - local.y * sin,
    y: anchored.y + local.x * sin + local.y * cos
  }
  return {
    curve: { ...curve, center: baseCenter },
    pivot: anchored,
    rotationAbout: { pivot: { kind: "coordinate", x: anchored.x, y: anchored.y }, angle: 0, baseCenter }
  }
}

/** 读数用：把转角写成"0°..360°"的度数，负角折回正区间。 */
export function rotationDegrees(angle: number): number {
  const full = 360
  const degrees = (angle * 180) / Math.PI % full
  return degrees < 0 ? degrees + full : degrees
}
