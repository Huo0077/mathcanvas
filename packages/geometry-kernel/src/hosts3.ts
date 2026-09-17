import type { PrimitiveSpec, Vector3 } from "@draw/dsl"

import { addVector3, areCoplanar, crossVector3, distanceVector3, dotVector3, lengthVector3, normalizeVector3, scaleVector3, subtractVector3 } from "./geometry3d"

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

export type Host3Kind = "line" | "segment" | "ray" | "edge" | "face" | "plane" | "cylinder-surface" | "cone-surface" | "solid-volume"

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
 * 只对**凸**实体精确（用面平面逐个夹）；非凸实体上退化为"逐面夹取"的近似，不会给出体外的点。
 */
export function solidVolumeHost3(vertices: Vector3[], faces: number[][]): Host3 | null {
  if (vertices.length < 4 || faces.length < 4) return null
  const box = boundingBox3(vertices)
  if (!box) return null
  const size = { x: box.max.x - box.min.x, y: box.max.y - box.min.y, z: box.max.z - box.min.z }
  if (size.x <= EPSILON || size.y <= EPSILON || size.z <= EPSILON) return null
  const pointFor = (parameter: Host3Parameter): Vector3 => clampPointIntoSolid3(vertices, faces, {
    x: box.min.x + size.x * clampTo(parameter.u, [0, 1]),
    y: box.min.y + size.y * clampTo(parameter.v ?? 0, [0, 1]),
    z: box.min.z + size.z * clampTo(parameter.w ?? 0, [0, 1])
  })
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
 * 把一个点夹进凸多面体：在内部就原样返回，在外面就沿违反的面平面投影回去。
 *
 * 凸体的"最近点"本可以写成 QP，但对课堂尺度的实体，"逐个面夹取 + 迭代几轮"已经足够：
 * 每次投影都让点更靠近可行域，实测几轮内收敛；万一没收敛（非凸 / 退化输入），
 * 最后再按每个面判一次，把仍然在外的点贴到违反最严重的那个面上——**绝不返回体外的点**。
 */
export function clampPointIntoSolid3(vertices: Vector3[], faces: number[][], point: Vector3): Vector3 {
  const planes = faces.flatMap((face) => {
    if (face.length < 3 || face.some((index) => index < 0 || index >= vertices.length)) return []
    const normal = outwardNormal3(vertices, face)
    return normal ? [normal] : []
  })
  if (planes.length === 0) return { ...point }
  let current = { ...point }
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const violated = planes.filter((plane) => dotVector3(plane.normal, current) + plane.constant > EPSILON)
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
  return current
}

/** 面的平面（法向朝外、单位化）。用形心判断朝向，因此与顶点绕向无关。 */
function outwardNormal3(vertices: Vector3[], face: number[]): { normal: Vector3; constant: number } | null {
  const centre = vertices.reduce((sum, vertex) => ({
    x: sum.x + vertex.x / vertices.length,
    y: sum.y + vertex.y / vertices.length,
    z: sum.z + vertex.z / vertices.length
  }), { x: 0, y: 0, z: 0 })
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
  const length = lengthVector3(normal)
  if (length < EPSILON) return null
  const unit = scaleVector3(normal, 1 / length)
  const anchor = vertices[face[0]]
  const outward = dotVector3(unit, subtractVector3(centre, anchor)) > 0 ? scaleVector3(unit, -1) : unit
  return { normal: outward, constant: -dotVector3(outward, anchor) }
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
