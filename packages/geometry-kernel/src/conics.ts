import type { CirclePrimitive, Coordinate, EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

function rotateAround(point: Coordinate, center: Coordinate, rotation: number): Coordinate {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const x = point.x - center.x
  const y = point.y - center.y
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }
}

const TWO_PI = Math.PI * 2

function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI
  return wrapped < 0 ? wrapped + TWO_PI : wrapped
}

/**
 * 能"绕定点旋转"的封闭曲线：圆与椭圆（用户口径："圆，椭圆"）。
 * 弧、抛物线、双曲线不在此列——它们不是封闭曲线，本文件也不为它们提供放置。
 * `rotation` 在这里是放宽的：圆没有自己的朝向，但它同样需要一个"参数基准"角。
 */
export type PlaceableConic =
  | (CirclePrimitive & { rotation?: number })
  | EllipsePrimitive

/**
 * **绕定点旋转的放置**。
 *
 * - `pivot`：那个定点。曲线转过任意角度都仍然过它——定点在曲线上的参数角从 θ₀ 变成
 *   θ₀ + angle，所以"过定点"这条性质与转角无关。
 * - `angle`：绕定点转过的角度（弧度，逆时针为正），**相对于 `baseCenter` 那份基准几何**。
 * - `baseCenter`：**基准图形的中心**（没转时圆心在哪）。
 *
 * 为什么必须单独存 `baseCenter`：`center` 是派生值、每趟重算都被结果覆盖，一旦只留结果，
 * 下一趟就再也分不清"这是基准还是转过的位置"。实测过一次重算就把圆心从 (1.5,-2.6) 推到
 * (4.5,-2.6)、曲线整个离开定点。基准与结果分开存，重算才幂等。
 */
export interface ConicPlacement {
  pivot: Coordinate
  angle: number
  baseCenter: Coordinate
}

function conicRotation(conic: PlaceableConic): number {
  return conic.rotation ?? 0
}

/** 参数化的两条半轴就是 (radiusX, radiusY) 这对方向，与哪条更长无关。 */
function conicRadii(conic: PlaceableConic): { x: number; y: number } {
  return conic.type === "circle" ? { x: conic.radius, y: conic.radius } : { x: conic.radiusX, y: conic.radiusY }
}

/**
 * 定点在曲线自然参数上的角度：`evaluate(θ)` 恰好落在 `pivot` 上。
 *
 * 这是**逆映射**：把"定点相对中心"的向量转回曲线自己的局部基，再按 (radiusX, radiusY)
 * 反算离心角。圆是它的特例（两条半轴相等，退化成极角）。
 * `center` 可以显式给（放置前的基准中心与放置后的中心不同，调用方要指明用哪一个）。
 */
export function conicPivotAngle(conic: PlaceableConic, pivot: Coordinate, center: Coordinate = conic.center): number {
  const rotation = conicRotation(conic)
  const radii = conicRadii(conic)
  const dx = pivot.x - center.x
  const dy = pivot.y - center.y
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const localX = dx * cos + dy * sin
  const localY = -dx * sin + dy * cos
  return Math.atan2(localY / radii.y, localX / radii.x)
}

function rotatePointAbout(point: Coordinate, pivot: Coordinate, angle: number): Coordinate {
  const dx = point.x - pivot.x
  const dy = point.y - pivot.y
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos }
}

/**
 * 把"绕定点旋转"落到曲线自己的几何上：**整个图形绕过定点的刚体转动**。
 *
 * 中心由 `baseCenter` 绕 `pivot` 转 `angle` 得到（结果写回 `center`），曲线自身的朝向也加 `angle`。
 * 定点是转动中心，所以它逐位不动，而它在曲线上的参数角从 θ₀ 变成 θ₀ + angle——
 * 于是"曲线始终过这个定点"与转角无关（用户要的就是这个）。
 *
 * **幂等**：起点永远是 `baseCenter`，反复重算不会累积旋转。
 * 没有放置信息时**原样返回**，旧文档的行为逐位不变。
 */
export function placedConic<T extends PlaceableConic>(conic: T, placement?: ConicPlacement): T {
  if (!placement || !Number.isFinite(placement.angle)) return conic
  const { pivot, baseCenter } = placement
  if (!Number.isFinite(pivot.x) || !Number.isFinite(pivot.y) || !Number.isFinite(baseCenter.x) || !Number.isFinite(baseCenter.y)) return conic
  return {
    ...conic,
    center: rotatePointAbout(baseCenter, pivot, placement.angle),
    rotation: normalizeAngle(conicRotation(conic) + placement.angle)
  } as T
}

/**
 * 把曲线**归一回基准几何**：`center` 变回 `baseCenter`、朝向减去转角。
 *
 * 半径 / 半轴 / 中心这类"改基准"的编辑要先做这一步再改，否则会把转过之后的位置当基准。
 */
export function baseConic<T extends PlaceableConic>(conic: T, placement?: ConicPlacement): T {
  if (!placement || !Number.isFinite(placement.angle)) return conic
  return {
    ...conic,
    center: { x: placement.baseCenter.x, y: placement.baseCenter.y },
    rotation: normalizeAngle(conicRotation(conic) - placement.angle)
  } as T
}

/**
 * 半径 / 半轴被改过之后，把基准圆心重新摆到"离定点恰好一个半轴"的地方。
 *
 * `pivotAngle` 是定点在曲线上应处的参数角（取改动之前的那个），于是改完半径定点仍在曲线上。
 */
export function reanchorBaseCenter(conic: PlaceableConic, placement: ConicPlacement, pivotAngle: number): ConicPlacement {
  const radii = conicRadii(conic)
  const rotation = conicRotation(conic)
  const local = { x: -radii.x * Math.cos(pivotAngle), y: -radii.y * Math.sin(pivotAngle) }
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  return {
    ...placement,
    baseCenter: {
      x: placement.pivot.x + local.x * cos - local.y * sin,
      y: placement.pivot.y + local.x * sin + local.y * cos
    }
  }
}

export function sampleParabola(parabola: ParabolaPrimitive, domain: [number, number], steps = 64): Coordinate[] {
  const points: Coordinate[] = []
  for (let index = 0; index <= steps; index += 1) {
    const parameter = domain[0] + (domain[1] - domain[0]) * index / steps
    const value = parameter * parameter / (2 * parabola.focalParameter)
    const local = parabola.axis === "x" ? { x: parabola.vertex.x + value, y: parabola.vertex.y + parameter } : { x: parabola.vertex.x + parameter, y: parabola.vertex.y + value }
    points.push(rotateAround(local, parabola.vertex, parabola.rotation ?? 0))
  }
  return points
}

export function sampleEllipse(ellipse: EllipsePrimitive, steps = 128): Coordinate[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = Math.PI * 2 * index / steps
    return rotateAround({ x: ellipse.center.x + ellipse.radiusX * Math.cos(angle), y: ellipse.center.y + ellipse.radiusY * Math.sin(angle) }, ellipse.center, ellipse.rotation ?? 0)
  })
}

export function sampleHyperbola(hyperbola: HyperbolaPrimitive, domain: [number, number], steps = 64): Coordinate[] {
  const points: Coordinate[] = []
  for (let index = 0; index <= steps; index += 1) {
    const parameter = domain[0] + (domain[1] - domain[0]) * index / steps
    const value = hyperbola.radiusY * Math.sqrt(1 + (parameter * parameter) / (hyperbola.radiusX * hyperbola.radiusX))
    const local = hyperbola.axis === "x" ? { x: hyperbola.center.x + parameter, y: hyperbola.center.y + value } : { x: hyperbola.center.x + value, y: hyperbola.center.y + parameter }
    points.push(rotateAround(local, hyperbola.center, hyperbola.rotation ?? 0))
  }
  return points
}

export function sampleHyperbolaBranches(hyperbola: HyperbolaPrimitive, domain: [number, number], steps = 64): [Coordinate[], Coordinate[]] {
  const first = sampleHyperbola(hyperbola, domain, steps)
  const second = first.map((point) => ({
    x: 2 * hyperbola.center.x - point.x,
    y: 2 * hyperbola.center.y - point.y
  }))
  return [first, second]
}
