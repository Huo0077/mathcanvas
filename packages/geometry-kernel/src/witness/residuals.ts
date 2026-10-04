/**
 * **见证候选的纯几何残差 / 退化 / 尺度判据**（N2 子任务 2a；计划 N2 的 Ownership 约定）。
 *
 * ## 这一层**不是**题设验收（控制器 R15）
 *
 * "这组坐标是否满足题面" 的权威判据只有两个，都在 `agent-core` / 内核既有代码里：
 * `verifyDiagramObligations`（逐条题设 + 残差）与 `buildFromPoints`（拓扑构造）。
 * 本文件只回答一个更小的问题：**这组候选坐标本身作为一张图，形状和尺度能不能用** ——
 * 零长边、共线 / 不共面的底面、退化面、量级不可表示的坐标、极端长宽比。
 *
 * 所以这里既不认识 `GeometryObligation`，也不返回"满足题设"的结论：
 * 把题设判据复制一份到这里，就会立刻出现"内核算合格、验证器算不合格"的双份真源。
 *
 * ## 两条纪律
 *
 * 1. **拒绝是值不是异常**：所有判据都收集进 `diagnostics`，调用方（2b 的搜索编排）要拿
 *    `reason.code` 做分类与排序，抛异常会把"这条候选不好"变成"整个搜索崩了"。
 * 2. **容差与模型尺度同源**（与 `prism.ts` 的 `extentOf` / `sphere.ts` 的 `RELATIVE_TOLERANCE`
 *    同一套思路）：绝对阈值在 1e-3 量级的模型上放过真退化，在 1e6 量级上把浮点噪声读成退化。
 */

import { areCoplanar, crossVector3, distanceVector3, lengthVector3, normalizeVector3, subtractVector3, type Vector3 } from "../geometry3d"

/**
 * 相对容差。与 `sphere.ts` 取同一个数量级：这里的量（边长、面积、垂距）都由两层以上的
 * 减法 / 乘法得到，比"两个半轴之差"少一层相消，`1e-9` 仍有足够判别力。
 */
const RELATIVE_TOLERANCE = 1e-9

/**
 * 长宽比上限：$\text{diameter} / \min\_\text{anchor}$。超过这个比例，双精度下的角度 / 面积
 * 判据已经不可信，图在画布上也是"一条线"。取 1e6 —— 它只拦真正的极端情形，不拦高中题里
 * 常见的细长图形（1e3 量级）。
 */
const MAX_ASPECT_RATIO = 1e6

/** 坐标量级相对容差：`max|坐标| / min(非零 |坐标|)` 超过它就无法用双精度可靠比较。 */
const MAGNITUDE_TOLERANCE = 1e12

/** 判据码。都是**机器可读**的（2b 用它排序 / 分类失败原因），不是给用户看的文案。 */
export type WitnessResidualCode =
  | "non-finite-value"
  | "magnitude-unrepresentable"
  | "ring-too-small"
  | "degenerate-edge"
  | "degenerate-collinear"
  | "non-coplanar-base"
  | "extreme-aspect-ratio"

export interface WitnessResidualDiagnostic {
  code: WitnessResidualCode
  /** 人可读理由（进 trace / 报告；面向用户的文案由 agent-core 组织）。 */
  message: string
}

export interface WitnessPointSpread {
  /** 坐标包围盒的最小值。 */
  min: Vector3
  max: Vector3
  center: Vector3
  /** 顶点集合的直径：最大两两距离。尺度判据一律以它为单位。 */
  diameter: number
  /** 相邻两点的最小边长（面环给出的顺序下）。 */
  minEdgeLength: number
  maxEdgeLength: number
  /**
   * 长宽比 = `diameter / max(minEdgeLength, diameter × 1e-12)`。
   * 极小边长不会把比值变成 `Infinity`（那会破坏"确定性与可比较"），所以分母带了相对下限。
   */
  aspectRatio: number
}

export interface WitnessResidualMetrics extends WitnessPointSpread {
  vertexCount: number
  /** 按顺序连接顶点得到的边长（闭合环）。 */
  edgeLengths: number[]
  /** 顶点集合是否共面（少于 4 个点时恒为 `true`）。 */
  coplanar: boolean
}

export interface WitnessResidualReport {
  acceptable: boolean
  diagnostics: WitnessResidualDiagnostic[]
  metrics: WitnessResidualMetrics
  kind: "point-set" | "faces"
  /** 这组值是谁给的（自由选取还是题面给出）；只作标注，不参与判据。 */
  source: "free-choice" | "stated"
}

/** 面环（元素是 `points` 的下标）。只用来展开面棱，不参与绕向判断（那是 `buildFromPoints` 的事）。 */
export interface WitnessFaceRing {
  indexes: readonly number[]
}

/** 面环 → 棱（去重，保持首次出现的顺序）。 */
export function faceRingEdges(rings: readonly (readonly number[])[]): Array<[number, number]> {
  const seen = new Set<string>()
  const edges: Array<[number, number]> = []
  for (const ring of rings) {
    for (let index = 0; index < ring.length; index += 1) {
      const first = ring[index]
      const second = ring[(index + 1) % ring.length]
      const key = first < second ? `${first}:${second}` : `${second}:${first}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push([first, second])
    }
  }
  return edges
}

function isFiniteVector(point: Vector3): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

/**
 * 顶点集合的**形状 / 尺度摘要**。纯量测，不下结论 —— 调用方（`pointSetResiduals`、
 * `candidateResiduals`，以及 2b 的排序）共享同一份量尺，避免"这里算一个直径、那里算另一个"。
 */
export function pointSpread(points: readonly Vector3[], edges: readonly (readonly [number, number])[]): WitnessPointSpread {
  if (points.length === 0) {
    return { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 }, center: { x: 0, y: 0, z: 0 }, diameter: 0, minEdgeLength: 0, maxEdgeLength: 0, aspectRatio: 0 }
  }
  const min = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY }
  const max = { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY }
  for (const point of points) {
    min.x = Math.min(min.x, point.x)
    min.y = Math.min(min.y, point.y)
    min.z = Math.min(min.z, point.z)
    max.x = Math.max(max.x, point.x)
    max.y = Math.max(max.y, point.y)
    max.z = Math.max(max.z, point.z)
  }
  let diameter = 0
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) diameter = Math.max(diameter, distanceVector3(points[first], points[second]))
  }
  let minEdgeLength = Number.POSITIVE_INFINITY
  let maxEdgeLength = 0
  for (const [first, second] of edges) {
    const length = distanceVector3(points[first], points[second])
    minEdgeLength = Math.min(minEdgeLength, length)
    maxEdgeLength = Math.max(maxEdgeLength, length)
  }
  if (!Number.isFinite(minEdgeLength)) minEdgeLength = 0
  else if (!Number.isFinite(maxEdgeLength)) maxEdgeLength = 0
  const denominator = Math.max(minEdgeLength, diameter * 1e-12)
  return {
    min,
    max,
    center: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2 },
    diameter,
    minEdgeLength,
    maxEdgeLength,
    aspectRatio: denominator > 0 ? diameter / denominator : 0
  }
}

/** 闭合环的边长，按顶点顺序（`[0-1, 1-2, …, n-1-0]`）。 */
function ringEdgeLengths(points: readonly Vector3[]): number[] {
  const lengths: number[] = []
  for (let index = 0; index < points.length; index += 1) lengths.push(distanceVector3(points[index], points[(index + 1) % points.length]))
  return lengths
}

function ringEdges(count: number): Array<[number, number]> {
  return Array.from({ length: count }, (_, index) => [index, (index + 1) % count] as [number, number])
}

/**
 * 环是否退化到"一条线"：所有顶点共线（或全部重合）。
 *
 * 判据取**整只环的直径**作为尺度（`Σ` 里第一对不重合的点给出方向），
 * 叉积模长与 `diameter²` 比较 —— 与 `prism.ts` 的 `hasNonZeroArea` 同思路，
 * 但它用"整只多边形"的稳健方向（`baseNormal` 那条教训：别看头三个点）。
 */
function isDegenerateCollinear(points: readonly Vector3[], diameter: number): boolean {
  if (points.length < 3) return true
  if (!(diameter > 0)) return true
  let direction: Vector3 | null = null
  for (let index = 1; index < points.length && !direction; index += 1) {
    const candidate = subtractVector3(points[index], points[0])
    if (lengthVector3(candidate) > 0) direction = candidate
  }
  if (!direction) return true
  const unit = normalizeVector3(direction)
  const threshold = diameter * diameter * RELATIVE_TOLERANCE
  for (const point of points) {
    if (lengthVector3(crossVector3(unit, subtractVector3(point, points[0]))) > threshold) return false
  }
  return true
}

/**
 * **点集**的残差：非有限坐标、量级不可表示、共面性与长宽比。
 *
 * 不含边长判据 —— 没有面环就没有"边"，而凭"最近两点"去猜边会把合法的近邻当退化边拒掉。
 */
export function pointSetResiduals(points: readonly Vector3[]): { diagnostics: WitnessResidualDiagnostic[]; metrics: WitnessResidualMetrics } {
  const diagnostics: WitnessResidualDiagnostic[] = []
  if (points.some((point) => !isFiniteVector(point))) {
    diagnostics.push({ code: "non-finite-value", message: "候选坐标里出现非有限数值（NaN / ±Infinity），无法作为几何点使用。" })
  }
  if (!points.every((point) => isFiniteVector(point))) {
    // 已经报了非有限，后面的量测没有意义（会全是 NaN）。
    return { diagnostics, metrics: emptyMetrics(points.length) }
  }
  const metrics = metricsFor(points, ringEdges(points.length), false)
  const largest = Math.max(Math.abs(metrics.max.x), Math.abs(metrics.max.y), Math.abs(metrics.max.z), Math.abs(metrics.min.x), Math.abs(metrics.min.y), Math.abs(metrics.min.z))
  const smallest = smallestNonZeroMagnitude(points)
  if (largest > 0 && smallest > 0 && largest / smallest > MAGNITUDE_TOLERANCE) {
    diagnostics.push({
      code: "magnitude-unrepresentable",
      message: `候选坐标的量级跨度过大（最大 ${largest}、最小非零 ${smallest}），双精度下无法可靠比较距离与角度。`
    })
  }
  if (metrics.aspectRatio > MAX_ASPECT_RATIO) {
    diagnostics.push({
      code: "extreme-aspect-ratio",
      message: `候选的长宽比 ${metrics.aspectRatio.toExponential(2)} 超过上限 ${MAX_ASPECT_RATIO.toExponential(0)}，图形会退化成一条线。`
    })
  }
  return { diagnostics, metrics }
}

function smallestNonZeroMagnitude(points: readonly Vector3[]): number {
  let smallest = Number.POSITIVE_INFINITY
  for (const point of points) {
    for (const value of [point.x, point.y, point.z]) {
      const magnitude = Math.abs(value)
      if (magnitude > 0) smallest = Math.min(smallest, magnitude)
    }
  }
  return Number.isFinite(smallest) ? smallest : 0
}

function emptyMetrics(vertexCount: number): WitnessResidualMetrics {
  return {
    vertexCount,
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
    center: { x: 0, y: 0, z: 0 },
    diameter: 0,
    minEdgeLength: 0,
    maxEdgeLength: 0,
    aspectRatio: 0,
    edgeLengths: [],
    coplanar: true
  }
}

function metricsFor(points: readonly Vector3[], edges: readonly (readonly [number, number])[], closedRing: boolean): WitnessResidualMetrics {
  const spread = pointSpread(points, edges)
  const edgeLengths = closedRing ? ringEdgeLengths(points) : edges.map(([first, second]) => distanceVector3(points[first], points[second]))
  return {
    vertexCount: points.length,
    ...spread,
    edgeLengths,
    coplanar: points.length < 4 ? true : areCoplanar([...points], Math.max(spread.diameter * spread.diameter, 1) * RELATIVE_TOLERANCE)
  }
}

/**
 * **多边形环**（底面 / 一个面）的残差：顶点数、边长、共线、共面、长宽比。
 *
 * 共面判据用于底面：环上第 4 个点起若离开前三点定的平面，底面就不是一个平面多边形，
 * 实体构造必然失败（`buildFromPoints` 会报 `non-planar-base`）—— 这里提前用同一套几何拒掉，
 * 让 2b 在花掉一次拓扑构造之前就知道原因。
 */
export function polygonResiduals(points: readonly Vector3[]): { diagnostics: WitnessResidualDiagnostic[]; metrics: WitnessResidualMetrics } {
  const base = pointSetResiduals(points)
  const diagnostics = [...base.diagnostics]
  if (base.metrics.vertexCount === 0 && points.length > 0) return { diagnostics, metrics: base.metrics }
  if (points.length < 3) {
    diagnostics.push({ code: "ring-too-small", message: `多边形环至少需要三个顶点，收到 ${points.length} 个。` })
    return { diagnostics, metrics: metricsFor(points, ringEdges(points.length), true) }
  }
  const metrics = metricsFor(points, ringEdges(points.length), true)
  const finite = points.every((point) => isFiniteVector(point))
  if (finite) {
    if (metrics.minEdgeLength <= metrics.diameter * RELATIVE_TOLERANCE) {
      diagnostics.push({
        code: "degenerate-edge",
        message: `环上存在长度为 ${metrics.minEdgeLength} 的边（直径 ${metrics.diameter}），两个顶点实质重合。`
      })
    }
    if (isDegenerateCollinear(points, metrics.diameter)) {
      diagnostics.push({ code: "degenerate-collinear", message: "环上所有顶点共线，围不出面积。" })
    } else if (!metrics.coplanar) {
      diagnostics.push({ code: "non-coplanar-base", message: "环上顶点不共面，不能作为平面多边形（底面）。" })
    }
    if (metrics.aspectRatio > MAX_ASPECT_RATIO) {
      diagnostics.push({
        code: "extreme-aspect-ratio",
        message: `环的长宽比 ${metrics.aspectRatio.toExponential(2)} 超过上限 ${MAX_ASPECT_RATIO.toExponential(0)}。`
      })
    }
  }
  return { diagnostics, metrics }
}

/**
 * **完整候选**（点集 + 可选面环）的残差报告。
 *
 * 没给面环时按点集判（并额外要求"存在不共线的三点"），给了面环时逐环按多边形判
 * —— 面环由构造器按规则生成，所以这里判的是"规则生成的面有没有塌掉"。
 */
export function candidateResiduals(candidate: {
  points: readonly Vector3[]
  faces?: readonly WitnessFaceRing[]
  source?: "free-choice" | "stated"
}): WitnessResidualReport {
  const points = candidate.points
  const source = candidate.source ?? "free-choice"
  const rings = candidate.faces?.map((face) => [...face.indexes]) ?? []
  if (rings.length === 0) {
    const pointSet = points.length >= 3 ? polygonResiduals(points) : pointSetResiduals(points)
    return { acceptable: pointSet.diagnostics.length === 0, diagnostics: pointSet.diagnostics, metrics: pointSet.metrics, kind: "point-set", source }
  }
  const diagnostics: WitnessResidualDiagnostic[] = []
  const edges = faceRingEdges(rings)
  const finite = points.every((point) => isFiniteVector(point))
  if (!finite) {
    diagnostics.push({ code: "non-finite-value", message: "候选坐标里出现非有限数值（NaN / ±Infinity），无法作为几何点使用。" })
    return { acceptable: false, diagnostics, metrics: emptyMetrics(points.length), kind: "faces", source }
  }
  const metrics = metricsFor(points, edges, false)
  const largest = Math.max(Math.abs(metrics.max.x), Math.abs(metrics.max.y), Math.abs(metrics.max.z))
  const smallest = smallestNonZeroMagnitude(points)
  if (largest > 0 && smallest > 0 && largest / smallest > MAGNITUDE_TOLERANCE) {
    diagnostics.push({
      code: "magnitude-unrepresentable",
      message: `候选坐标的量级跨度过大（最大 ${largest}、最小非零 ${smallest}），双精度下无法可靠比较距离与角度。`
    })
  }
  if (metrics.minEdgeLength <= metrics.diameter * RELATIVE_TOLERANCE) {
    diagnostics.push({
      code: "degenerate-edge",
      message: `拓扑里存在长度为 ${metrics.minEdgeLength} 的边（直径 ${metrics.diameter}），两个顶点实质重合。`
    })
  }
  for (const ring of rings) {
    if (ring.length < 3) {
      diagnostics.push({ code: "ring-too-small", message: `面环至少需要三个顶点，收到 ${ring.length} 个。` })
      continue
    }
    const ringPoints = ring.map((index) => points[index])
    if (ringPoints.some((point) => point === undefined || !isFiniteVector(point))) {
      diagnostics.push({ code: "non-finite-value", message: "面环引用了不存在或非有限的顶点。" })
      continue
    }
    if (isDegenerateCollinear(ringPoints, pointSpread(ringPoints, ringEdges(ringPoints.length)).diameter)) {
      diagnostics.push({ code: "degenerate-collinear", message: "面环上所有顶点共线，该面面积为 0。" })
    }
  }
  if (metrics.aspectRatio > MAX_ASPECT_RATIO) {
    diagnostics.push({
      code: "extreme-aspect-ratio",
      message: `候选的长宽比 ${metrics.aspectRatio.toExponential(2)} 超过上限 ${MAX_ASPECT_RATIO.toExponential(0)}。`
    })
  }
  return { acceptable: diagnostics.length === 0, diagnostics, metrics, kind: "faces", source }
}
