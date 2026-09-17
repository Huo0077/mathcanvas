/**
 * 交面按**支撑曲面**分组（A2）。
 *
 * 用户口径："重要的问题还在交面上，圆柱和立方体交面会被切成很多个片，这样很不合理。"
 *
 * 实测：立方体(4×4×4) ∩ 圆柱(R=2, h=6, 48 段) 的布尔交集有 **50 个面片**——2 个圆盘（12.5305）+
 * 圆柱侧面被切成 48 个小四边形（1.0465 × 48），而那 48 个细条**法向各不相同**（每一片切在圆柱的不同方位），
 * 所以"合并共面片"一片都减不掉。分组只能按支撑曲面做：顶点都落在**同一张**来源二次曲面上、且本身只张开
 * 一个网格步长的面片，属于同一个曲面区域。
 *
 * 为什么不能只判"顶点都在二次曲面上"：圆柱的**端面圆盘**顶点也全都在侧面上（48 边形内接于半径 R 的圆），
 * 只判顶点会把两个圆盘并进侧面（实测 50 个面片**全部**满足"顶点在二次曲面上"）。所以还要判这个面本身
 * 是不是**侧面上的一片**：
 * 1. 它张开的角度不超过一个网格步长（`MAX_FACET_SPAN`；圆盘张开整整一圈，切平面穿轴的矩形张开 180°）；
 * 2. 它张开的角度区间里没有**别的**网格顶点（近切的切平面会在圆柱上切出一张张开几十度、顶点也都落在
 *    圆柱上的平面矩形——它不是侧面的一部分）。
 *
 * 诚实边界（spec §4）：平面区域面积精确（边界是解析圆时用 πr²）；曲面区域面积是**网格面片求和**并如实标
 * `areaExact: false`（48 面片偏小 0.07%，绝不写成精确）；串不成闭合环时不写 `exactLoops`，退回 `points`
 * 多边形，绝不编一段圆弧出来。
 */
import type { CurvePiece3 } from "@draw/dsl"

import type { SolidIntersectionResult } from "./boolean3d"
import { addVector3, crossVector3, dotVector3, lengthVector3, normalizeVector3, scaleVector3, subtractVector3, type Vector3 } from "./geometry3d"
import { circleConic3, conic3Area, quadricScaleOf, type Quadric3 } from "./quadrics"

export type IntersectionSurfaceKind = "plane" | "cylinder" | "cone"

export interface IntersectionSurfaceRegion {
  kind: IntersectionSurfaceKind
  /** 平面区域：合并后的外环；曲面区域：边界里最大的那条顶点环（渲染兜底）。 */
  points: Vector3[]
  /** 解析边界：曲面区域有；平面区域的边界来自二次曲面时也有。串不成闭合环时**不写**。 */
  exactLoops?: CurvePiece3[][]
  /** 平面区域：法向；曲面区域：该二次曲面的轴。 */
  normal: Vector3
  /** 面积：平面区域精确；曲面区域是网格面片求和（`areaExact: false`）。 */
  area: number
  areaExact: boolean
}

/** 与 A1 同一套口径：容差按**模型尺度相对**取，不用绝对阈值。 */
const RELATIVE_TOLERANCE = 1e-9
/**
 * 一个面最多张开多少弧度还算"二次曲面的一个网格面片"。
 *
 * 60°：默认 48 段的一片张开 7.5°，留了 8 倍余量；而"顶点也落在圆柱上"的平面矩形至少张开 90°（近切时更小，
 * 那种情况由"张开区间里有别人的顶点"那条判据挡住）。宁可小一点：判不出就逐个保留，也不假装它属于曲面。
 */
const MAX_FACET_SPAN = Math.PI / 3
const TAU = Math.PI * 2

interface SurfaceFrame {
  kind: "cylinder" | "cone"
  /** 轴向单位向量。 */
  axis: Vector3
  /** 轴上的一个点（有限实体是底面中心；无 `bounds` 时由矩阵反解出来）。 */
  origin: Vector3
  /** 圆柱半径 / 圆锥底半径；推不出来时为 `null`（那就不写解析边界）。 */
  radius: number | null
  /** 有限实体的高（轴向范围 `[0, height]`）；无 `bounds` 时为 `null`（不裁轴向范围）。 */
  height: number | null
  /** 绕轴的角参数与 `circleConic3` 的帧同源，`conic3PointAt` 才能复现端点。 */
  frameU: Vector3
  frameV: Vector3
  /** 模型尺度：面积判定与容差用它。 */
  scale: number
}

interface SurfaceEntry {
  quadric: Quadric3
  frame: SurfaceFrame
  /** 落在这张二次曲面上的交点顶点：键 → 绕轴角 / 轴向坐标。 */
  onSurface: Map<string, { angle: number; axial: number }>
}

interface SourceFace {
  /** 面环的顶点键（首尾不重复），顶点身份按模型尺度量化。 */
  keys: string[]
  normal: Vector3
  area: number
}

/** 圆柱矩阵的二次部 `A`（对称 3×3 的 6 个独立元素）。 */
function quadraticPartOf(quadric: Quadric3): [number, number, number, number, number, number] {
  const q = quadric.matrix
  return [q[0], q[1], q[2], q[5], q[6], q[10]]
}

/** 无 `bounds` 的圆柱：从矩阵反解轴、轴上的点与半径（`f = s|x⊥|² - sR²`）。 */
function cylinderFrameFromMatrix(quadric: Quadric3): { axis: Vector3; origin: Vector3; radius: number } | null {
  const [a11, a12, a13, a22, a23, a33] = quadraticPartOf(quadric)
  const rows = [[a11, a12, a13], [a12, a22, a23], [a13, a23, a33]]
  const candidates: Vector3[] = []
  for (const [first, second] of [[0, 1], [0, 2], [1, 2]]) candidates.push(crossVector3({ x: rows[first][0], y: rows[first][1], z: rows[first][2] }, { x: rows[second][0], y: rows[second][1], z: rows[second][2] }))
  const best = candidates.reduce((largest, current) => (lengthVector3(current) > lengthVector3(largest) ? current : largest))
  const norm = lengthVector3(best)
  if (!(norm > 0)) return null
  const axis = scaleVector3(best, 1 / norm)
  const scale = (a11 + a22 + a33) / 2
  if (!(scale > 0)) return null
  const q = quadric.matrix
  const linear = { x: q[3] + q[12], y: q[7] + q[13], z: q[11] + q[14] }
  const along = dotVector3(linear, axis)
  // 圆柱沿轴平移不变 ⇒ 线性项没有轴向分量；有的话它就不是圆柱（例如圆锥），如实放弃。
  if (Math.abs(along) > RELATIVE_TOLERANCE * Math.max(lengthVector3(linear), scale)) return null
  const perpendicular = subtractVector3(linear, scaleVector3(axis, along))
  const origin = scaleVector3(perpendicular, -1 / (2 * scale))
  const radiusSquared = dotVector3(origin, origin) - q[15] / scale
  if (!(radiusSquared > 0)) return null
  return { axis, origin, radius: Math.sqrt(radiusSquared) }
}

/** 来源二次曲面 → 可用的轴 / 轴上的点 / 半径。平面二次型不是曲面区域，直接跳过。 */
function surfaceFrameOf(quadric: Quadric3 | undefined): SurfaceFrame | null {
  if (!quadric || quadric.kind === "plane") return null
  const bounds = quadric.bounds
  let axis: Vector3
  let origin: Vector3
  let radius: number | null
  let height: number | null
  if (bounds) {
    const length = lengthVector3(bounds.axis)
    if (!(length > 0)) return null
    axis = scaleVector3(bounds.axis, 1 / length)
    origin = { ...bounds.origin }
    radius = Number.isFinite(bounds.radius) && bounds.radius > 0 ? bounds.radius : null
    height = Number.isFinite(bounds.height) && bounds.height > 0 ? bounds.height : null
  } else {
    // 无 `bounds` 的二次曲面：只有圆柱能反解出轴与半径（圆锥要解矩阵特征值，本片不做——如实跳过）。
    if (quadric.kind !== "cylinder") return null
    const derived = cylinderFrameFromMatrix(quadric)
    if (!derived) return null
    axis = derived.axis
    origin = derived.origin
    radius = derived.radius
    height = null
  }
  for (const value of [axis.x, axis.y, axis.z, origin.x, origin.y, origin.z]) if (!Number.isFinite(value)) return null
  // 帧只跟轴有关（与 `planeFrame3` 同一套 helper 约定）：`circleConic3` 用同一个轴给出同一个 u/v，
  // 所以这里算出来的角参数与 `conic3PointAt` 的参数完全一致。
  const probe = circleConic3(origin, axis, 1)
  if (!probe) return null
  return { kind: quadric.kind, axis, origin, radius, height, frameU: probe.frame.u, frameV: probe.frame.v, scale: quadricScaleOf(quadric) }
}

function axialOf(frame: SurfaceFrame, point: Vector3): number {
  return dotVector3(subtractVector3(point, frame.origin), frame.axis)
}

/** 绕轴角：先把径向分量投影出来，再用与 `circleConic3` 同源的 u/v 取角度。 */
function angleOf(frame: SurfaceFrame, point: Vector3): number {
  const radial = subtractVector3(point, frame.origin)
  const flattened = subtractVector3(radial, scaleVector3(frame.axis, dotVector3(radial, frame.axis)))
  return Math.atan2(dotVector3(flattened, frame.frameV), dotVector3(flattened, frame.frameU))
}

/** 轴向坐标 `level` 处的半径（圆锥随高度线性收缩）。 */
function radiusAt(frame: SurfaceFrame, level: number): number | null {
  if (frame.radius === null) return null
  if (frame.kind === "cylinder") return frame.radius
  if (frame.height === null) return null
  const ratio = 1 - level / frame.height
  return ratio > 0 ? frame.radius * ratio : null
}

/**
 * 顶点是否落在这张二次曲面上。
 *
 * 判据用的是二次曲面的**几何定义**（与 spec §3.1 规则 2 的写法一致）：圆柱 `|径向 − R| ≤ 容差`、
 * 圆锥 `|径向 − R(1 − 轴向/h)| ≤ 容差`；有 `bounds` 的有限实体还要求轴向落在 `[0, h]` 内。
 *
 * 为什么不用 `quadricValueAt(quadric, point)`（任务书里的那条）：`quadric3FromPrimitive` 对**未旋转**的
 * 图元返回的是**局部**矩阵（底面在 z=0、径向中心在世界原点），并没有搬到 `center` 去。实测：
 * App 默认圆柱 `center:{x:3,y:0,z:0}` 的真曲面点 (4.5,0,1) 上 `quadricValueAt = 18`（应为 0），
 * `intersectPlaneQuadric3` 也把截面圆心算成 (0,0,1) 而不是 (3,0,1)。**平移过的图元矩阵不可信，
 * `bounds` 帧才是世界坐标**（`rimCircles3` 与端面裁剪都读它，旋转过的图元两种口径本来也一致）。
 * 这条差异在报告里单独说明：`quadrics.ts` 的 `buildSolidQuadric` 非旋转分支需要把局部矩阵搬到 `center`。
 */
function onSurfaceAt(frame: SurfaceFrame, point: Vector3): boolean {
  const axial = axialOf(frame, point)
  if (frame.height !== null && (axial < -RELATIVE_TOLERANCE * frame.scale || axial > frame.height + RELATIVE_TOLERANCE * frame.scale)) return false
  const radius = radiusAt(frame, axial)
  if (radius === null) return false
  const radial = subtractVector3(point, frame.origin)
  const flattened = subtractVector3(radial, scaleVector3(frame.axis, dotVector3(radial, frame.axis)))
  return Math.abs(lengthVector3(flattened) - radius) <= RELATIVE_TOLERANCE * frame.scale
}

function wrapToPi(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

/** 一组角度张开的那段弧（补上最大空隙）：返回起点角、张角，以及"里面"的判定依据。 */
function angularSpan(angles: number[]): { span: number; start: number } | null {
  if (angles.length === 0) return null
  const sorted = [...angles].sort((first, second) => first - second)
  if (sorted.length === 1) return { span: 0, start: sorted[0] }
  let largestGap = -1
  let gapIndex = 0
  for (let index = 0; index < sorted.length; index += 1) {
    const next = index === sorted.length - 1 ? sorted[0] + TAU : sorted[index + 1]
    const gap = next - sorted[index]
    if (gap > largestGap) {
      largestGap = gap
      gapIndex = index
    }
  }
  return { span: TAU - largestGap, start: sorted[(gapIndex + 1) % sorted.length] }
}

/** 角度是否严格落在 `[start, start + span]` 这段弧的内部。 */
function insideArc(angle: number, start: number, span: number): boolean {
  const delta = ((angle - start) % TAU + TAU) % TAU
  return delta > RELATIVE_TOLERANCE && delta < span - RELATIVE_TOLERANCE
}

function vertexKeyOf(point: Vector3, quantum: number): string {
  return `${Math.round(point.x / quantum)},${Math.round(point.y / quantum)},${Math.round(point.z / quantum)}`
}

function newellNormal(points: Vector3[]): Vector3 | null {
  let normal = { x: 0, y: 0, z: 0 }
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    normal = {
      x: normal.x + (current.y - next.y) * (current.z + next.z),
      y: normal.y + (current.z - next.z) * (current.x + next.x),
      z: normal.z + (current.x - next.x) * (current.y + next.y)
    }
  }
  const length = lengthVector3(normal)
  return length > 0 ? scaleVector3(normal, 1 / length) : null
}

interface MergedRing {
  keys: string[]
  /** 有向面积模长（多环时用来挑外环）。 */
  area: number
  /** 相对参考法向的有向面积（外环为正、洞为负）。 */
  signed: number
}

interface RingMerge {
  rings: MergedRing[]
  /** 每条有向边都配上了反向边、且每条链都闭合了才为 `true`。 */
  complete: boolean
}

function ringMeasure(points: Vector3[], referenceNormal: Vector3 | null): { area: number; signed: number } {
  let vector = { x: 0, y: 0, z: 0 }
  for (let index = 0; index < points.length; index += 1) vector = addVector3(vector, crossVector3(points[index], points[(index + 1) % points.length]))
  vector = scaleVector3(vector, 0.5)
  const area = lengthVector3(vector)
  return { area, signed: referenceNormal ? dotVector3(vector, referenceNormal) : area }
}

/**
 * 取消内部共享边、把一组面并成边界环。
 *
 * 内部边在相邻两个面里方向相反，所以"成对反向的有向边"就是内部边；剩下的有向边首尾相接就是边界环。
 * 串不成闭合链时如实报 `complete: false`，调用方退回 `points` 多边形。
 */
function mergeBoundaryRings(faceRings: string[][], pointOf: Map<string, Vector3>, referenceNormal: Vector3 | null): RingMerge {
  const edges: { from: string; to: string }[] = []
  const forward = new Map<string, number[]>()
  const push = (from: string, to: string) => {
    if (from === to) return
    const index = edges.length
    edges.push({ from, to })
    const key = `${from}>${to}`
    const list = forward.get(key)
    if (list) list.push(index)
    else forward.set(key, [index])
  }
  for (const ring of faceRings) for (let index = 0; index < ring.length; index += 1) push(ring[index], ring[(index + 1) % ring.length])

  const cancelled = edges.map(() => false)
  for (let index = 0; index < edges.length; index += 1) {
    if (cancelled[index]) continue
    const reverse = forward.get(`${edges[index].to}>${edges[index].from}`)
    const opposite = reverse?.find((candidate) => !cancelled[candidate])
    if (opposite === undefined) continue
    cancelled[index] = true
    cancelled[opposite] = true
  }

  const remaining = edges.filter((_, index) => !cancelled[index])
  const outgoing = new Map<string, number[]>()
  remaining.forEach((edge, index) => {
    const list = outgoing.get(edge.from)
    if (list) list.push(index)
    else outgoing.set(edge.from, [index])
  })

  const used = remaining.map(() => false)
  const rings: MergedRing[] = []
  let complete = true
  for (let start = 0; start < remaining.length; start += 1) {
    if (used[start]) continue
    used[start] = true
    const startKey = remaining[start].from
    const keys = [startKey]
    let current = remaining[start].to
    let steps = 0
    while (current !== startKey) {
      if (steps > remaining.length) {
        complete = false
        break
      }
      const next = (outgoing.get(current) ?? []).find((index) => !used[index])
      if (next === undefined) {
        complete = false
        break
      }
      used[next] = true
      keys.push(current)
      current = remaining[next].to
      steps += 1
    }
    if (current !== startKey) continue
    const points = keys.map((key) => pointOf.get(key) as Vector3)
    const measure = ringMeasure(points, referenceNormal)
    rings.push({ keys, area: measure.area, signed: measure.signed })
  }
  return { rings, complete }
}

/** 片段分类：这条边界边落在二次曲面上（`conic`）还是切平面上（`segment`）。 */
interface EdgeClass {
  kind: "conic" | "segment"
  frame?: SurfaceFrame
}

/**
 * 把一条闭合边界环写成解析片段。
 *
 * 连续的 `conic` 边合成**一个**圆锥曲线片段（圆柱侧带的一整圈弧就是一条 `conic`），连续的 `segment`
 * 边各写一条线段。参数区间由端点角度确定（逐边取最近代表角累加），因此 `conic3PointAt` 能复现两端顶点；
 * 单条边跨过 180° 时角度方向就有歧义了——如实放弃整环，不猜。
 */
function piecesFromRing(keys: string[], pointOf: Map<string, Vector3>, classify: (index: number) => EdgeClass): CurvePiece3[] | null {
  const points = keys.map((key) => pointOf.get(key) as Vector3)
  const count = points.length
  if (count < 3) return null
  const classes = Array.from({ length: count }, (_, index) => classify(index))
  let boundary = classes.findIndex((current, index) => current.kind !== classes[(index - 1 + count) % count].kind)
  if (boundary < 0) boundary = 0

  const pieces: CurvePiece3[] = []
  let offset = 0
  while (offset < count) {
    const start = (boundary + offset) % count
    const kind = classes[start].kind
    let run = 1
    while (offset + run < count && classes[(boundary + offset + run) % count].kind === kind) run += 1
    if (kind === "segment") {
      for (let step = 0; step < run; step += 1) {
        const from = points[(start + step) % count]
        const to = points[(start + step + 1) % count]
        pieces.push({ kind: "segment", a: { ...from }, b: { ...to } })
      }
    } else {
      const frame = classes[start].frame
      if (!frame) return null
      for (let step = 0; step < run; step += 1) if (classes[(start + step) % count].frame !== frame) return null
      const vertices = Array.from({ length: run + 1 }, (_, step) => points[(start + step) % count])
      const level = vertices.reduce((sum, vertex) => sum + axialOf(frame, vertex), 0) / vertices.length
      const radius = radiusAt(frame, level)
      if (radius === null) return null
      const conic = circleConic3(addVector3(frame.origin, scaleVector3(frame.axis, level)), frame.axis, radius)
      if (!conic) return null
      const parameterOf = (point: Vector3) => {
        const radial = subtractVector3(point, conic.center as Vector3)
        return Math.atan2(dotVector3(radial, conic.frame.v), dotVector3(radial, conic.frame.u))
      }
      const from = parameterOf(vertices[0])
      let accumulated = from
      for (const vertex of vertices.slice(1)) {
        const delta = wrapToPi(parameterOf(vertex) - accumulated)
        // 跨过 180° 就分不清走哪半圈：不猜，整环退回 `points`。
        if (Math.abs(delta) >= Math.PI - RELATIVE_TOLERANCE) return null
        accumulated += delta
      }
      pieces.push({ kind: "conic", conic, parameterRange: [from, accumulated] })
    }
    offset += run
  }
  return pieces
}

/** 一个区域在合并前收集到的原始面片。 */
interface RegionCandidate {
  kind: IntersectionSurfaceKind
  normal: Vector3
  faces: SourceFace[]
  frame?: SurfaceFrame
}

function regionFromCandidate(candidate: RegionCandidate, pointOf: Map<string, Vector3>, hoopEdges: Map<string, SurfaceFrame>): IntersectionSurfaceRegion {
  const referenceNormal = candidate.kind === "plane" ? candidate.normal : null
  const faceRings = candidate.faces.map((face) => face.keys)
  const merged = mergeBoundaryRings(faceRings, pointOf, referenceNormal)
  const closed = merged.rings.filter((ring) => ring.keys.length >= 3)
  const ringPoints = (keys: string[]) => keys.map((key) => ({ ...(pointOf.get(key) as Vector3) }))

  // 曲面区域装不下"一整条带"（`points` 只有一个环）：取边界里最大的那条环当渲染兜底。
  const outer = [...closed].sort((first, second) => second.area - first.area)[0]
  const largestFace = [...candidate.faces].sort((first, second) => second.area - first.area)[0]
  const points = outer ? ringPoints(outer.keys) : largestFace ? ringPoints(largestFace.keys) : []

  let exactLoops: CurvePiece3[][] | undefined
  if (merged.complete && closed.length > 0) {
    const loops = closed.map((ring) => {
      if (candidate.kind !== "plane") {
        const frame = candidate.frame as SurfaceFrame
        return piecesFromRing(ring.keys, pointOf, (index) => {
          const current = ring.keys[index]
          const next = ring.keys[(index + 1) % ring.keys.length]
          const first = pointOf.get(current) as Vector3
          const second = pointOf.get(next) as Vector3
          return Math.abs(axialOf(frame, first) - axialOf(frame, second)) <= RELATIVE_TOLERANCE * frame.scale
            ? { kind: "conic", frame }
            : { kind: "segment" }
        })
      }
      // 平面区域的边界来自二次曲面时也要写解析边界，但**只认网格自己的弧弦**：边必须与某个
      // 侧面面片的"环向边"重合。切平面穿轴切出来的那张平面矩形，它的边也连着半径 R 上的两个顶点，
      // 却不是任何面片的环向边——那是一条真的直线，不许写成圆弧。
      return piecesFromRing(ring.keys, pointOf, (index) => {
        const current = ring.keys[index]
        const next = ring.keys[(index + 1) % ring.keys.length]
        const frame = hoopEdges.get(current < next ? `${current}>${next}` : `${next}>${current}`)
        return frame ? { kind: "conic", frame } : { kind: "segment" }
      })
    })
    if (loops.every((loop): loop is CurvePiece3[] => loop !== null)) {
      const flatLoops = loops as CurvePiece3[][]
      // 全是线段等于没写：那本来就是多边形路径，别多此一举。
      if (flatLoops.some((loop) => loop.some((piece) => piece.kind === "conic"))) exactLoops = flatLoops
    }
  }

  if (candidate.kind !== "plane") {
    return {
      kind: candidate.kind,
      points,
      ...(exactLoops ? { exactLoops } : {}),
      normal: { ...candidate.normal },
      // 曲面区域：网格面片面积求和，如实标近似。
      area: candidate.faces.reduce((sum, face) => sum + face.area, 0),
      areaExact: false
    }
  }

  const polygonArea = Math.abs(closed.reduce((sum, ring) => sum + ring.signed, 0))
  const fallbackArea = largestFace ? largestFace.area : 0
  const measured = closed.length > 0 ? polygonArea : fallbackArea
  if (!exactLoops) {
    // 纯多边形边界：`points` 就是它的精确边界。
    return { kind: "plane", points, normal: { ...candidate.normal }, area: measured, areaExact: true }
  }
  // 边界整体是一个闭合圆锥曲线（圆 / 椭圆）时，面积有闭式 πab——那才是精确值。
  const closedConics = exactLoops.map((loop) => (loop.length === 1 && loop[0].kind === "conic" ? loop[0] : null))
  const areas = closedConics.map((piece) => (piece && Math.abs(Math.abs(piece.parameterRange[1] - piece.parameterRange[0]) - TAU) <= 1e-9 ? conic3Area(piece.conic) : null))
  if (areas.length > 0 && areas.every((measure): measure is { value: number; exact: boolean } => measure !== null && measure.exact)) {
    return { kind: "plane", points, exactLoops, normal: { ...candidate.normal }, area: areas.reduce((sum, measure) => sum + (measure as { value: number }).value, 0), areaExact: true }
  }
  // 圆弧 + 弦的混合边界：多边形面积只是网格的下界，不许说精确。
  return { kind: "plane", points, exactLoops, normal: { ...candidate.normal }, area: measured, areaExact: false }
}

/**
 * 把布尔交集的网格面片按**支撑曲面**并成区域（平面组 / 二次曲面组），其余逐个保留。
 *
 * 退化输入（没有面、状态不是 `polyhedron`/`flat`、坐标非有限、面环或法向不可用）一律返回 `[]`，从不抛。
 */
export function mergeIntersectionSurfaces3(
  intersection: SolidIntersectionResult,
  sources: { quadric?: Quadric3 }[]
): IntersectionSurfaceRegion[] {
  if (intersection.status !== "polyhedron" && intersection.status !== "flat") return []
  if (intersection.faces.length === 0 || intersection.vertices.length === 0) return []
  if (intersection.vertices.some((vertex) => !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y) || !Number.isFinite(vertex.z))) return []

  const extent = intersection.vertices.reduce((largest, vertex) => Math.max(largest, Math.abs(vertex.x), Math.abs(vertex.y), Math.abs(vertex.z)), 1)
  const scale = Math.max(extent, 1)
  const quantum = Math.max(scale * RELATIVE_TOLERANCE, 1e-12)
  const pointOf = new Map<string, Vector3>()
  for (const vertex of intersection.vertices) {
    const key = vertexKeyOf(vertex, quantum)
    if (!pointOf.has(key)) pointOf.set(key, { ...vertex })
  }

  const faces: SourceFace[] = []
  for (let index = 0; index < intersection.faces.length; index += 1) {
    const ring = intersection.faces[index]
    if (ring.length < 3 || ring.some((vertexIndex) => !Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= intersection.vertices.length)) return []
    const keys: string[] = []
    for (const vertexIndex of ring) {
      const key = vertexKeyOf(intersection.vertices[vertexIndex], quantum)
      if (keys[keys.length - 1] !== key) keys.push(key)
    }
    if (keys.length > 1 && keys[0] === keys[keys.length - 1]) keys.pop()
    if (keys.length < 3) return []
    const supplied = intersection.faceNormals[index]
    const normal = supplied && lengthVector3(supplied) > 0.5 ? normalizeVector3(supplied) : newellNormal(keys.map((key) => pointOf.get(key) as Vector3))
    if (!normal) return []
    faces.push({ keys, normal, area: Math.abs(intersection.faceAreas[index] ?? 0) })
  }

  const entries: SurfaceEntry[] = []
  for (const source of sources) {
    const quadric = source?.quadric
    const frame = surfaceFrameOf(quadric)
    if (frame && quadric) entries.push({ quadric, frame, onSurface: new Map() })
  }
  for (const entry of entries) {
    for (const [key, point] of pointOf) {
      if (!onSurfaceAt(entry.frame, point)) continue
      entry.onSurface.set(key, { angle: angleOf(entry.frame, point), axial: axialOf(entry.frame, point) })
    }
  }

  /** 这个面是不是这张二次曲面上的一片（详见文件头的两条判据）。 */
  const isFacet = (face: SourceFace, entry: SurfaceEntry): boolean => {
    const vertices = face.keys.map((key) => entry.onSurface.get(key))
    if (vertices.some((vertex) => vertex === undefined)) return false
    const angles = vertices.map((vertex) => (vertex as { angle: number }).angle)
    const span = angularSpan(angles)
    if (!span || !(span.span > 0) || span.span > MAX_FACET_SPAN) return false
    const axials = vertices.map((vertex) => (vertex as { axial: number }).axial)
    const lowest = Math.min(...axials)
    const highest = Math.max(...axials)
    const own = new Set(face.keys)
    for (const [key, vertex] of entry.onSurface) {
      if (own.has(key)) continue
      if (vertex.axial < lowest - RELATIVE_TOLERANCE * scale || vertex.axial > highest + RELATIVE_TOLERANCE * scale) continue
      if (insideArc(vertex.angle, span.start, span.span)) return false
    }
    return true
  }

  const candidates: RegionCandidate[] = []
  const planeGroups: { normal: Vector3; constant: number; faces: SourceFace[] }[] = []
  const quadricGroups = entries.map((entry) => ({ entry, faces: [] as SourceFace[] }))
  for (const face of faces) {
    const entry = entries.find((candidate) => isFacet(face, candidate))
    if (entry) {
      const group = quadricGroups.find((candidate) => candidate.entry === entry)
      if (group) group.faces.push(face)
      continue
    }
    const constant = -dotVector3(face.normal, pointOf.get(face.keys[0]) as Vector3)
    const group = planeGroups.find((candidate) => dotVector3(candidate.normal, face.normal) >= 1 - 1e-12 && Math.abs(candidate.constant - constant) <= RELATIVE_TOLERANCE * scale)
    if (group) group.faces.push(face)
    else planeGroups.push({ normal: face.normal, constant, faces: [face] })
  }
  for (const group of quadricGroups) {
    if (group.faces.length > 0) candidates.push({ kind: group.entry.frame.kind, normal: group.entry.frame.axis, faces: group.faces, frame: group.entry.frame })
  }
  for (const group of planeGroups) candidates.push({ kind: "plane", normal: group.normal, faces: group.faces })

  /** 二次曲面面片的"环向边"：平面区域靠它认出"这一段边界真的是一段圆弧"。 */
  const hoopEdges = new Map<string, SurfaceFrame>()
  for (const group of quadricGroups) {
    for (const face of group.faces) {
      for (let index = 0; index < face.keys.length; index += 1) {
        const current = face.keys[index]
        const next = face.keys[(index + 1) % face.keys.length]
        const first = pointOf.get(current) as Vector3
        const second = pointOf.get(next) as Vector3
        if (Math.abs(axialOf(group.entry.frame, first) - axialOf(group.entry.frame, second)) > RELATIVE_TOLERANCE * group.entry.frame.scale) continue
        hoopEdges.set(current < next ? `${current}>${next}` : `${next}>${current}`, group.entry.frame)
      }
    }
  }

  return candidates
    .map((candidate) => regionFromCandidate(candidate, pointOf, hoopEdges))
    .sort((first, second) => second.area - first.area)
}
