import type { PrimitiveSpec, Vector3 } from "@draw/dsl"

import { addVector3, areCoplanar, crossVector3, distanceVector3, dotVector3, lengthVector3, normalizeVector3, scaleVector3, subtractVector3 } from "./geometry3d"
import { circleConic3 } from "./quadrics"

/**
 * 3D 宿主约束：一个一维或二维的参数域 + 正反映射 + 违反度。
 *
 * 与 2D 的 `planar-constraints.ts` 同构，只回答三件事：
 * - `evaluate(参数)`：参数 → 世界坐标（正向映射）；
 * - `closestParameter(点)`：世界坐标 → 域内最近参数（反向映射）；
 * - `residual(点)`：到这个宿主的最短距离（违反度）。
 *
 * 唯一的**不变式**是"参数是唯一真值、坐标只是派生缓存"：点永远由参数算出来，
 * 因此连续拖动不会像"每帧叠加位移"那样逐渐漂离宿主（借鉴 JSXGraph 的 Glider 语义）。
 */
export interface Host3Parameter {
  /** 主参数：线上是仿射比例（`evaluate(0)` 是起点、`evaluate(1)` 是终点）、面上与曲面上是横坐标/方位角。 */
  u: number
  /** 次参数：只在二维宿主（面、平面、曲面）上使用。 */
  v?: number
  /** 第三个参数：只在三维宿主（实体内部）上使用，是包围盒内的轴向比例。 */
  w?: number
}

export type Host3Kind = "line" | "segment" | "ray" | "edge" | "face" | "plane" | "circle" | "cylinder-surface" | "cone-surface" | "solid-volume"

export interface Host3 {
  readonly kind: Host3Kind
  readonly domain: { u: readonly [number, number]; v?: readonly [number, number]; w?: readonly [number, number]; closedU?: boolean }
  evaluate(parameter: Host3Parameter): Vector3
  closestParameter(point: Vector3): Host3Parameter
  project(point: Vector3): { parameter: Host3Parameter; point: Vector3; distance: number }
  residual(point: Vector3): number
}

const EPSILON = 1e-9
const TAU = Math.PI * 2

const clampTo = (value: number, domain: readonly [number, number]) => Math.min(Math.max(value, domain[0]), domain[1])

/** 角度归一到 `[0, 2π)`：闭合方向的宿主必须折回声明域，否则参数会无限增长。 */
export function normalizeAzimuth(angle: number): number {
  if (!Number.isFinite(angle)) return 0
  return ((angle % TAU) + TAU) % TAU
}

function wrapHost(kind: Host3Kind, domain: Host3["domain"], evaluate: (parameter: Host3Parameter) => Vector3, closestParameter: (point: Vector3) => Host3Parameter): Host3 {
  return {
    kind,
    domain,
    evaluate,
    closestParameter,
    project: (point: Vector3) => {
      const parameter = closestParameter(point)
      const projected = evaluate(parameter)
      return { parameter, point: projected, distance: distanceVector3(point, projected) }
    },
    residual: (point: Vector3) => distanceVector3(point, evaluate(closestParameter(point)))
  }
}

/**
 * 直线 / 线段 / 射线 / 棱。
 * `evaluate(0) = first`、`evaluate(1) = second`；域由 `kind` 决定：
 * 线段与棱是 `[0,1]`、射线是 `[0,∞)`、直线是 `(-∞,∞)`。
 */
export function lineHost3(first: Vector3, second: Vector3, kind: "line" | "segment" | "ray" | "edge" = "segment"): Host3 | null {
  const direction = subtractVector3(second, first)
  const lengthSquared = dotVector3(direction, direction)
  if (!Number.isFinite(lengthSquared) || lengthSquared < EPSILON * EPSILON) return null
  const bounded = kind === "segment" || kind === "edge"
  const domain: readonly [number, number] = bounded
    ? [0, 1]
    : kind === "ray" ? [0, Number.POSITIVE_INFINITY] : [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
  return wrapHost(
    kind,
    { u: domain },
    (parameter) => addVector3(first, scaleVector3(direction, parameter.u)),
    (point) => ({ u: clampTo(dotVector3(subtractVector3(point, first), direction) / lengthSquared, domain) })
  )
}

/** uv 空间的多边形内外判定（奇偶规则）；边界上的点按"在内部"处理。 */
function pointInRing(point: Host3Parameter, ring: Host3Parameter[]): boolean {
  let inside = false
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const current = ring[index]
    const last = ring[previous]
    if ((current.v! > point.v!) !== (last.v! > point.v!)) {
      const crossingU = ((last.u - current.u) * (point.v! - current.v!)) / (last.v! - current.v!) + current.u
      if (point.u < crossingU) inside = !inside
    }
  }
  return inside
}

/** uv 空间里到环边界的最近点：环内的点不该被夹，环外的点必须落到真实的边界上。 */
function closestPointOnRing(point: Host3Parameter, ring: Host3Parameter[]): Host3Parameter {
  let best: Host3Parameter = ring[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index]
    const end = ring[(index + 1) % ring.length]
    const edge = { u: end.u - start.u, v: end.v! - start.v! }
    const lengthSquared = edge.u * edge.u + edge.v * edge.v
    const raw = lengthSquared < 1e-18 ? 0 : ((point.u - start.u) * edge.u + (point.v! - start.v!) * edge.v) / lengthSquared
    const t = Math.min(1, Math.max(0, raw))
    const candidate = { u: start.u + edge.u * t, v: start.v! + edge.v * t }
    const distance = Math.hypot(candidate.u - point.u, candidate.v! - point.v!)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
}

/**
 * 面（`face3` 的点环）：以第一个顶点为原点、`u` 沿第一条边、法向取环的多边形法向。
 * 域是顶点 uv 的包围盒；投影时先正交投影到平面，落在环外的点**夹到环边界**——
 * 否则"把点绑到一个三角形面上"会允许它停在面外的虚空里。
 */
export function faceHost3(vertices: Vector3[], tolerance = EPSILON): Host3 | null {
  if (vertices.length < 3) return null
  const origin = vertices[0]
  const first = subtractVector3(vertices[1], origin)
  const second = subtractVector3(vertices[2], origin)
  const axisU = normalizeVector3(first)
  const normal = normalizeVector3(crossVector3(first, second))
  if (lengthVector3(axisU) < EPSILON || lengthVector3(normal) < EPSILON) return null
  // 共面容差按点集尺寸缩放：大坐标下的顶点会有更大的绝对误差。
  const extent = Math.max(...vertices.map((vertex) => lengthVector3(subtractVector3(vertex, origin))), 1)
  if (!areCoplanar(vertices, tolerance * extent)) return null
  const axisV = crossVector3(normal, axisU)
  const ring = vertices.map((vertex) => {
    const offset = subtractVector3(vertex, origin)
    return { u: dotVector3(offset, axisU), v: dotVector3(offset, axisV) }
  })
  const minU = Math.min(...ring.map((entry) => entry.u))
  const maxU = Math.max(...ring.map((entry) => entry.u))
  const minV = Math.min(...ring.map((entry) => entry.v!))
  const maxV = Math.max(...ring.map((entry) => entry.v!))
  return wrapHost(
    "face",
    { u: [minU, maxU], v: [minV, maxV] },
    (parameter) => addVector3(origin, addVector3(scaleVector3(axisU, parameter.u), scaleVector3(axisV, parameter.v ?? 0))),
    (point) => {
      const offset = subtractVector3(point, origin)
      const projected = { u: dotVector3(offset, axisU), v: dotVector3(offset, axisV) }
      return pointInRing(projected, ring) ? projected : closestPointOnRing(projected, ring)
    }
  )
}

/** 无穷平面：域无界，`closestParameter` 就是正交投影。 */
export function planeHost3(origin: Vector3, u: Vector3, v: Vector3): Host3 | null {
  const axisU = normalizeVector3(u)
  if (lengthVector3(axisU) < EPSILON) return null
  // 把 v 对 u 正交化：调用方给的基不保证正交，非正交点会让 uv 不再是平面内的直角坐标。
  const orthoV = normalizeVector3(subtractVector3(v, scaleVector3(axisU, dotVector3(v, axisU))))
  if (lengthVector3(orthoV) < EPSILON) return null
  const unbounded = Number.POSITIVE_INFINITY
  return wrapHost(
    "plane",
    { u: [-unbounded, unbounded], v: [-unbounded, unbounded] },
    (parameter) => addVector3(origin, addVector3(scaleVector3(axisU, parameter.u), scaleVector3(orthoV, parameter.v ?? 0))),
    (point) => {
      const offset = subtractVector3(point, origin)
      return { u: dotVector3(offset, axisU), v: dotVector3(offset, orthoV) }
    }
  )
}

/**
 * 圆轨道（空间圆）：**一维闭合宿主**，参数是圆周角 `[0, 2π)`。
 *
 * 用户口径："增加一些可以旋转，平移的平面图元……主要作用是作为约束轨道。"
 *
 * 与线段 / 棱宿主的关键差别只有一处：`closedU: true`——首尾相接，所以参数必须折回声明域
 *（`normalizeAzimuth` 就是给这种宿主准备的），否则拖过一整圈之后参数会一直涨。
 *
 * 帧**直接复用解析圆那一套**（`circleConic3` → `frameThroughPoint` → 与 `planeFrame3` 同一约定：
 * 取与法向最不对齐的世界轴当种子、`u = normalize(cross(helper, normal))`、`v = cross(normal, u)`）。
 * 于是"点沿轨道的参数 0 在哪"和"圆上参数 0 在哪"是**同一个点**——宿主参数、圆上读数、法向输入框
 * 说的都是同一件事，不会各说各话（用例里用 `conic3PointAt(circleConic3(...), u)` 逐点钉住）。
 * 退化输入（零法向、半径非正或非有限）如实返回 `null`：不编一条轨道出来。
 */
export function circleHost3(center: Vector3, normal: Vector3, radius: number): Host3 | null {
  if (!Number.isFinite(radius) || radius <= EPSILON) return null
  /**
   * 零法向**在这里必须拒绝**（`circleConic3` 为渲染稳健会把它兜成 +z，但宿主不能这么兜：
   * 用户给的圆没有朝向时说"它躺在 +z 平面上"是编出来的）。所以先自己判一次。
   */
  const unit = normalizeVector3(normal)
  if (![unit.x, unit.y, unit.z].every((value) => Number.isFinite(value)) || lengthVector3(unit) < 0.5) return null
  const conic = circleConic3(center, normal, radius)
  if (!conic) return null
  const { u: axisU, v: axisV } = conic.frame
  const pointAt = (angle: number): Vector3 => addVector3(center, addVector3(scaleVector3(axisU, radius * Math.cos(angle)), scaleVector3(axisV, radius * Math.sin(angle))))
  return wrapHost(
    "circle",
    { u: [0, TAU], closedU: true },
    (parameter) => pointAt(parameter.u),
    (point) => {
      const offset = subtractVector3(point, center)
      return { u: normalizeAzimuth(Math.atan2(dotVector3(offset, axisV), dotVector3(offset, axisU))) }
    }
  )
}

/**
 * 圆柱侧面（世界为 Z 轴朝上，与 `buildSolidTemplate` 一致：底面在 `z = center.z`、顶面在 `z + height`）。
 * `u` 是方位角（`[0, 2π)`，闭合），`v` 是轴向比例（`[0,1]`）。
 */
export function cylinderSurfaceHost3(center: Vector3, radius: number, height: number): Host3 | null {
  if (!Number.isFinite(radius) || radius <= EPSILON) return null
  if (!Number.isFinite(height) || Math.abs(height) < EPSILON) return null
  return wrapHost(
    "cylinder-surface",
    { u: [0, TAU], v: [0, 1], closedU: true },
    (parameter) => ({
      x: center.x + radius * Math.cos(parameter.u),
      y: center.y + radius * Math.sin(parameter.u),
      z: center.z + height * (parameter.v ?? 0)
    }),
    (point) => {
      const dx = point.x - center.x
      const dy = point.y - center.y
      return { u: normalizeAzimuth(Math.atan2(dy, dx)), v: clampTo((point.z - center.z) / height, [0, 1]) }
    }
  )
}

/**
 * 圆锥侧面：半径随轴向比例线性收缩到 0。
 *
 * 最近点是**解析解**而不是搜索：绕轴对称，所以最近点与给定点同方位角，
 * 只需最小化 `(ρ - r + r·v)² + (dz - h·v)²`，其驻点为 `v = (h·dz - r·(ρ - r)) / (r² + h²)`。
 */
export function coneSurfaceHost3(center: Vector3, radius: number, height: number): Host3 | null {
  if (!Number.isFinite(radius) || radius <= EPSILON) return null
  if (!Number.isFinite(height) || Math.abs(height) < EPSILON) return null
  const radiusAt = (v: number) => radius * (1 - v)
  return wrapHost(
    "cone-surface",
    { u: [0, TAU], v: [0, 1], closedU: true },
    (parameter) => {
      const localRadius = radiusAt(parameter.v ?? 0)
      return {
        x: center.x + localRadius * Math.cos(parameter.u),
        y: center.y + localRadius * Math.sin(parameter.u),
        z: center.z + height * (parameter.v ?? 0)
      }
    },
    (point) => {
      const dx = point.x - center.x
      const dy = point.y - center.y
      const rho = Math.hypot(dx, dy)
      const dz = point.z - center.z
      const raw = (height * dz - radius * (rho - radius)) / (radius * radius + height * height)
      return { u: rho < EPSILON ? 0 : normalizeAzimuth(Math.atan2(dy, dx)), v: clampTo(raw, [0, 1]) }
    }
  )
}

/**
 * 实体的**内部**：点可以在里面自由移动，但出不去。
 *
 * 与线 / 面 / 曲面宿主的区别：那些是"投影到低维宿主上"，而这是一个**体积约束**——
 * 点在内部时 `project` 不动它（`residual = 0`），跑到外面才夹回最近的表面。
 * 因此参数取"包围盒内的比例" `uvw ∈ [0,1]³`：实体平移 / 缩放时参数不变、坐标跟着走
 *（参数仍然是唯一真值），而夹取保证结果永远落在实体里。
 *
 * 只对**凸**实体成立（逐面夹取等价于"夹进半空间之交"）。凹实体的形心可能落在体外，
 * 逐面夹取会停在空腔里、甚至把点留在空中，因此这类实体**不提供**宿主（返回 null，
 * 上层据此报"数据不足"），而不是伪造一个体外坐标。绕向自相矛盾的拓扑同样被拒绝。
 */
export function solidVolumeHost3(vertices: Vector3[], faces: number[][]): Host3 | null {
  if (vertices.length < 4 || faces.length < 4) return null
  const box = boundingBox3(vertices)
  if (!box) return null
  const size = { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z }
  const diagonal = Math.hypot(size.x, size.y, size.z)
  if (!(diagonal > 0)) return null
  // 构造期探针：拿包围盒中心试夹一次。夹不进去（凹 / 退化 / 绕向不一致）就说明这个实体
  // 不能当体积宿主——返回 null 让上层报"数据不足"，而不是伪造一个体外坐标。
  const anchor = clampPointIntoSolid3(vertices, faces, {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2
  })
  if (!anchor) return null
  // 实体几何在宿主构造之后不再变化，因此这里的兜底只在"理论上不会再失败"的前提下生效；
  // 万一真的失败，退回探针点（一个已经验证过的内点），绝不放行体外坐标。
  const pointFor = (parameter: Host3Parameter): Vector3 => clampPointIntoSolid3(vertices, faces, {
    x: box.min.x + size.x * clampTo(parameter.u, [0, 1]),
    y: box.min.y + size.y * clampTo(parameter.v ?? 0, [0, 1]),
    z: box.min.z + size.z * clampTo(parameter.w ?? 0, [0, 1])
  }) ?? anchor
  return wrapHost(
    "solid-volume",
    { u: [0, 1], v: [0, 1], w: [0, 1] },
    pointFor,
    (point) => ({
      u: clampTo((point.x - box.min.x) / size.x, [0, 1]),
      v: clampTo((point.y - box.min.y) / size.y, [0, 1]),
      w: clampTo((point.z - box.min.z) / size.z, [0, 1])
    })
  )
}

/** 顶点的世界轴对齐包围盒；没有顶点时返回 null。 */
function boundingBox3(vertices: Vector3[]): { min: Vector3; max: Vector3 } | null {
  if (vertices.length === 0) return null
  return vertices.reduce((box, vertex) => ({
    min: { x: Math.min(box.min.x, vertex.x), y: Math.min(box.min.y, vertex.y), z: Math.min(box.min.z, vertex.z) },
    max: { x: Math.max(box.max.x, vertex.x), y: Math.max(box.max.y, vertex.y), z: Math.max(box.max.z, vertex.z) }
  }), { min: { ...vertices[0] }, max: { ...vertices[0] } })
}

/**
 * 面法向的退化判据必须**随实体尺度缩放**：Newell 法向的模长约等于两倍面面积，
 * 用绝对 EPSILON 去比，1e-5 量级的实体会被判成"所有面都退化"，体积宿主静默失效。
 */
const RELATIVE_EPSILON = 1e-9

interface FacePlane3 {
  normal: Vector3
  constant: number
}

/**
 * 把一个点夹进**凸**多面体：在内部就原样返回，在外面就沿违反的面平面投影回去。
 *
 * 凸体的"最近点"本可以写成 QP，但对课堂尺度的实体，"逐个面夹取 + 迭代几轮"已经足够。
 * 收尾还有一道保证：迭代没收敛时，从**顶点形心**（凸体的形心必在体内）向当前点做一次二分，
 * 取仍然满足全部半空间的最远点——于是返回值永远在实体内。
 *
 * 返回 `null` 表示"这个实体不能当凸体积用"：凹、退化、绕向自相矛盾或点非有限。
 * 这种情况下**不能**返回任何坐标，否则绑定点会被停在空气里却报告"已满足"。
 */
export function clampPointIntoSolid3(vertices: Vector3[], faces: number[][], point: Vector3): Vector3 | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) return null
  const box = boundingBox3(vertices)
  if (!box) return null
  const diagonal = Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z)
  if (!(diagonal > 0)) return null
  const tolerance = diagonal * RELATIVE_EPSILON
  const planes = closedFacePlanes3(vertices, faces)
  if (!planes) return null
  // 凸性判据：凸实体的内部就是所有外法向半空间之交。只要有一个顶点落在某个面平面之外，
  // 实体就是凹的，逐面夹取不再等价于"夹进实体"。
  for (const vertex of vertices) {
    if (planes.some((plane) => dotVector3(plane.normal, vertex) + plane.constant > tolerance)) return null
  }
  const inside = (candidate: Vector3) => planes.every((plane) => dotVector3(plane.normal, candidate) + plane.constant <= tolerance)
  let current = { ...point }
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const violated = planes.filter((plane) => dotVector3(plane.normal, current) + plane.constant > tolerance)
    if (violated.length === 0) return current
    for (const plane of violated) {
      const distance = dotVector3(plane.normal, current) + plane.constant
      current = {
        x: current.x - plane.normal.x * distance,
        y: current.y - plane.normal.y * distance,
        z: current.z - plane.normal.z * distance
      }
    }
  }
  if (inside(current)) return current
  // 兜底：从凸体内部的一点朝当前点二分，返回仍然合法的那个端点（一定落在实体边界上）。
  const anchor = vertices.reduce((sum, vertex) => addVector3(sum, vertex), { x: 0, y: 0, z: 0 })
  const reference = scaleVector3(anchor, 1 / vertices.length)
  if (!inside(reference)) return null
  let low = 0
  let high = 1
  for (let step = 0; step < 48; step += 1) {
    const middle = (low + high) / 2
    const candidate = {
      x: reference.x + (current.x - reference.x) * middle,
      y: reference.y + (current.y - reference.y) * middle,
      z: reference.z + (current.z - reference.z) * middle
    }
    if (inside(candidate)) low = middle
    else high = middle
  }
  const clamped = {
    x: reference.x + (current.x - reference.x) * low,
    y: reference.y + (current.y - reference.y) * low,
    z: reference.z + (current.z - reference.z) * low
  }
  return inside(clamped) ? clamped : null
}

/**
 * 闭合面环 → **朝外**的单位平面。
 *
 * 朝向不能用"全体顶点的形心"来定：凹实体的形心可能落在实体之外，内凹面的法向会被翻反，
 * 于是"点在外面"的判据根本看不到那些面。改用**有符号体积**：闭合多面体按一致绕向
 *（从外面看逆时针）给出时，各面 Newell 法向一致朝外，散度和（体积的 6 倍）为正；
 * 为负说明整体绕向相反，全体翻转即可。体积退化说明绕向自相矛盾或实体塌陷——不猜，返回 null。
 */
function closedFacePlanes3(vertices: Vector3[], faces: number[][]): FacePlane3[] | null {
  const usable = faces.filter((face) => face.length >= 3 && face.every((index) => Number.isInteger(index) && index >= 0 && index < vertices.length))
  if (usable.length === 0) return null
  const box = boundingBox3(vertices)
  if (!box) return null
  const diagonal = Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z)
  const raw = usable.map((face) => ({ face, normal: newellNormal3(vertices, face) }))
  if (raw.some((entry) => !entry.normal || lengthVector3(entry.normal) <= diagonal * diagonal * RELATIVE_EPSILON)) return null
  const volume6 = signedVolume6(vertices, usable)
  if (Math.abs(volume6) <= Math.pow(diagonal, 3) * RELATIVE_EPSILON) return null
  const flip = volume6 > 0 ? 1 : -1
  return raw.map(({ face, normal }) => {
    const unit = scaleVector3(normal!, flip / lengthVector3(normal!))
    return { normal: unit, constant: -dotVector3(unit, vertices[face[0]]) }
  })
}

/**
 * 多边形点环的**单位**法向（Newell，方向随绕向）。点少于 3 个或环塌成一条线时返回 `null`。
 *
 * 导出给界面显示「当前朝向」用：属性栏要显示的正是这个法向，自己再写一份 Newell 就会和这一份漂移
 *（这份是 `closedFacePlanes3` 判"点在里面/在外面"用的，绝不是只给显示看的近似）。
 */
export function polygonNormal3(points: Vector3[]): Vector3 | null {
  if (points.length < 3) return null
  const raw = newellNormal3(points, points.map((_, index) => index))
  if (!raw) return null
  const length = lengthVector3(raw)
  if (!Number.isFinite(length) || length <= EPSILON) return null
  return scaleVector3(raw, 1 / length)
}

/** 面环的 Newell 法向（未单位化，方向随绕向）；环塌成一条线时返回 null。 */
function newellNormal3(vertices: Vector3[], face: number[]): Vector3 | null {
  let normal = { x: 0, y: 0, z: 0 }
  for (let index = 0; index < face.length; index += 1) {
    const current = vertices[face[index]]
    const next = vertices[face[(index + 1) % face.length]]
    normal = {
      x: normal.x + (current.y - next.y) * (current.z + next.z),
      y: normal.y + (current.z - next.z) * (current.x + next.x),
      z: normal.z + (current.x - next.x) * (current.y + next.y)
    }
  }
  return Number.isFinite(normal.x) && Number.isFinite(normal.y) && Number.isFinite(normal.z) ? normal : null
}

/** 闭合多面体的有符号体积 × 6（散度定理，逐面扇形三角化）。 */
function signedVolume6(vertices: Vector3[], faces: number[][]): number {
  let total = 0
  for (const face of faces) {
    const origin = vertices[face[0]]
    for (let index = 1; index < face.length - 1; index += 1) {
      const second = vertices[face[index]]
      const third = vertices[face[index + 1]]
      total += origin.x * (second.y * third.z - second.z * third.y)
        - origin.y * (second.x * third.z - second.z * third.x)
        + origin.z * (second.x * third.y - second.y * third.x)
    }
  }
  return total
}

type HostContext = readonly PrimitiveSpec[] | ReadonlyMap<string, PrimitiveSpec>

function hostContextMap(context: HostContext): ReadonlyMap<string, PrimitiveSpec> {
  if (context instanceof Map) return context
  return new Map((context as readonly PrimitiveSpec[]).map((primitive) => [primitive.id, primitive]))
}

/** 从 DSL 图元解析宿主；不可作为宿主的类型与缺失引用一律返回 `null`（不伪造几何）。 */
export function host3FromPrimitive(primitive: PrimitiveSpec, context: HostContext): Host3 | null {
  const map = hostContextMap(context)
  const point = (id: string): Vector3 | null => {
    const candidate = map.get(id)
    return candidate?.type === "point3" ? candidate.position : null
  }
  const endpoints = (firstId: string, secondId: string): [Vector3, Vector3] | null => {
    const first = point(firstId)
    const second = point(secondId)
    return first && second ? [first, second] : null
  }
  const ring = (ids: string[]): Vector3[] | null => {
    const vertices: Vector3[] = []
    for (const id of ids) {
      const vertex = point(id)
      if (!vertex) return null
      vertices.push(vertex)
    }
    return vertices
  }

  if (primitive.type === "line3") {
    if (primitive.definition.kind === "pointDirection") {
      const origin = point(primitive.definition.pointId)
      return origin ? lineHost3(origin, addVector3(origin, primitive.definition.direction), "line") : null
    }
    const ends = endpoints(primitive.definition.pointIds[0], primitive.definition.pointIds[1])
    return ends ? lineHost3(ends[0], ends[1], "line") : null
  }
  if (primitive.type === "segment3") {
    const ends = endpoints(primitive.pointIds[0], primitive.pointIds[1])
    return ends ? lineHost3(ends[0], ends[1], "segment") : null
  }
  if (primitive.type === "ray3") {
    const ends = endpoints(primitive.originId, primitive.throughId)
    return ends ? lineHost3(ends[0], ends[1], "ray") : null
  }
  if (primitive.type === "edge3") {
    const ends = endpoints(primitive.pointIds[0], primitive.pointIds[1])
    return ends ? lineHost3(ends[0], ends[1], "edge") : null
  }
  if (primitive.type === "face3") {
    const vertices = ring(primitive.pointIds)
    return vertices ? faceHost3(vertices) : null
  }
  if (primitive.type === "circle3") {
    const center = point(primitive.centerId)
    return center ? circleHost3(center, primitive.normal, primitive.radius) : null
  }
  if (primitive.type === "plane3") {
    if (primitive.definition.kind === "pointNormal") {
      const origin = point(primitive.definition.pointId)
      if (!origin) return null
      const normal = normalizeVector3(primitive.definition.normal)
      if (lengthVector3(normal) < EPSILON) return null
      // 任取一个与法向不平行的轴造平面基（与法向最不对齐的世界轴最稳定）。
      const seed = Math.abs(normal.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
      const axisU = normalizeVector3(crossVector3(normal, seed))
      return planeHost3(origin, axisU, crossVector3(normal, axisU))
    }
    const [firstId, secondId, thirdId] = primitive.definition.pointIds
    const vertices = ring([firstId, secondId, thirdId])
    if (!vertices) return null
    return planeHost3(vertices[0], subtractVector3(vertices[1], vertices[0]), subtractVector3(vertices[2], vertices[0]))
  }
  if (primitive.type === "cylinder") return cylinderSurfaceHost3(primitive.center, primitive.radius, primitive.height)
  if (primitive.type === "cone") return coneSurfaceHost3(primitive.center, primitive.radius, primitive.height)
  return null
}
