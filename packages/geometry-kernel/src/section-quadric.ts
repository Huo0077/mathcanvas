/**
 * 有限二次曲面实体的**解析截面边界**：把解析圆锥曲线裁剪到实体的端面之间。
 *
 * 无界柱面 ∩ 平面给出完整圆锥曲线，但有限实体的截面还要被端面裁掉——否则画布上会出现一条
 * "伸出实体之外的椭圆"。所以截面边界是**片段环**：圆锥曲线弧（落在侧面上）＋ 端面弦（落在底/顶面上）。
 *
 * 直线 / 点 / 空集这三类**不生成解析片段**：它们的边界本来就是直线段，既有的多边形路径给的是精确几何
 *（48 边形只影响弯曲边界），所以这里只报 `kind` 让上层如实说明，几何仍走原路径。
 */
import type { CurvePiece3 } from "@draw/dsl"

import { dotVector3, subtractVector3, type Plane3, type Vector3 } from "./geometry3d"
import { conic3PointAt, intersectPlaneQuadric3, type Conic3, type Conic3Kind, type Quadric3 } from "./quadrics"

/** 片段类型定义在 DSL 里（它是文档数据）；这里再导出，内核 API 保持不变。 */
export type { CurvePiece3 }

export interface SectionQuadricResult {
  /** 解析结论。与 `Section3Classification`（描述多边形边界形态）不是一回事，见 spec §5.4。 */
  kind: Conic3Kind
  loops: CurvePiece3[][]
}

const TAU = Math.PI * 2

interface AxialAxis {
  /** 点到实体底面的轴向坐标。 */
  at(point: Vector3): number
  /** 轴向单位向量（把曲线参数展开成轴向坐标要用它）。 */
  direction: Vector3
}

function distanceBetween(first: Vector3, second: Vector3): number {
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z)
}

function quadraticRoots(a: number, b: number, c: number, tolerance: number): number[] {
  if (Math.abs(a) <= tolerance) {
    if (Math.abs(b) <= tolerance) return []
    return [-c / b]
  }
  const discriminant = b * b - 4 * a * c
  if (discriminant < -tolerance) return []
  if (Math.abs(discriminant) <= tolerance) return [-b / (2 * a)]
  const root = Math.sqrt(discriminant)
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)]
}

/** 曲线与某个端面（轴向坐标 = `level`）相交处的参数。双曲线要指明哪一支：两支的轴向表达式只差横向项的符号。 */
function crossingParameters(conic: Conic3, level: number, axial: AxialAxis, tolerance: number, branch = 0): number[] {
  const axes = conic.axes
  if ((conic.kind === "circle" || conic.kind === "ellipse") && conic.center && axes && conic.semiMajor !== undefined && conic.semiMinor !== undefined) {
    const mean = axial.at(conic.center)
    const alongMajor = dotVector3(axes.major, axial.direction) * conic.semiMajor
    const alongMinor = dotVector3(axes.minor, axial.direction) * conic.semiMinor
    const amplitude = Math.hypot(alongMajor, alongMinor)
    const target = level - mean
    if (amplitude <= tolerance || Math.abs(target) > amplitude) return []
    const phase = Math.atan2(alongMinor, alongMajor)
    const delta = Math.acos(Math.max(-1, Math.min(1, target / amplitude)))
    const wrap = (value: number) => ((value % TAU) + TAU) % TAU
    return [wrap(phase + delta), wrap(phase - delta)]
  }
  if (conic.kind === "parabola" && conic.vertex && axes && conic.focalParameter) {
    // a(t) = a(顶点) + (t²/4p)·(major·轴) + t·(minor·轴)
    return quadraticRoots(
      dotVector3(axes.major, axial.direction) / (4 * conic.focalParameter),
      dotVector3(axes.minor, axial.direction),
      axial.at(conic.vertex) - level,
      tolerance
    )
  }
  if (conic.kind === "hyperbola" && conic.center && axes && conic.semiMajor !== undefined && conic.semiMinor !== undefined) {
    // 第 σ 支：a(t) = mean + σ·A·cosh t + B·sinh t；令 u = eᵗ 后是二次方程。
    const sign = branch === 0 ? 1 : -1
    const mean = axial.at(conic.center)
    const A = sign * dotVector3(axes.major, axial.direction) * conic.semiMajor
    const B = dotVector3(axes.minor, axial.direction) * conic.semiMinor
    const target = level - mean
    return quadraticRoots((A + B) / 2, -target, (A - B) / 2, tolerance)
      .filter((value) => value > tolerance)
      .map((value) => Math.log(value))
  }
  return []
}

/** 把参数轴按"落在带内/带外"切成区间：按交点排序，再用中点判定每一段。 */
function insideRanges(crossings: number[], closed: boolean, isInside: (parameter: number) => boolean): [number, number][] {
  const sorted = crossings
    .slice()
    .sort((first, second) => first - second)
    .filter((value, index, all) => index === 0 || Math.abs(value - all[index - 1]) > 1e-12)
  if (sorted.length === 0) {
    // 开曲线两端都跑到带外：没有交点就没有内部区间。闭曲线要测一个点才知道是整条在内还是整条在外。
    return closed && isInside(0) ? [[0, TAU]] : []
  }
  const boundaries = closed ? [...sorted, sorted[0] + TAU] : sorted
  const ranges: [number, number][] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const from = boundaries[index]
    const to = boundaries[index + 1]
    if (to - from <= 1e-12) continue
    if (isInside((from + to) / 2)) ranges.push([from, to])
  }
  return ranges
}

interface OrientedPiece {
  piece: CurvePiece3
  start: Vector3
  end: Vector3
}

/** 端面弦：把落在同一个端面上的两个端点连起来。超过两个端点说明几何比这里支持的更复杂，如实放弃。 */
function capChords(arcs: OrientedPiece[], levels: number[], axial: AxialAxis, tolerance: number): { a: Vector3; b: Vector3 }[] | null {
  const chords: { a: Vector3; b: Vector3 }[] = []
  for (const level of levels) {
    const endpoints: Vector3[] = []
    for (const arc of arcs) {
      for (const point of [arc.start, arc.end]) {
        if (Math.abs(axial.at(point) - level) > tolerance * 10) continue
        if (endpoints.some((candidate) => distanceBetween(candidate, point) <= tolerance * 10)) continue
        endpoints.push(point)
      }
    }
    if (endpoints.length > 2) return null
    if (endpoints.length === 2 && distanceBetween(endpoints[0], endpoints[1]) > tolerance * 10) chords.push({ a: endpoints[0], b: endpoints[1] })
  }
  return chords
}

function reversePiece(piece: CurvePiece3): CurvePiece3 {
  if (piece.kind === "segment") return { kind: "segment", a: piece.b, b: piece.a }
  return { kind: "conic", conic: piece.conic, parameterRange: [piece.parameterRange[1], piece.parameterRange[0]], ...(piece.branch === undefined ? {} : { branch: piece.branch }) }
}

/** 按端点重合把片段串成闭合环；串不起来（有悬空端）就返回 `null`，由调用方回退多边形路径。 */
function assembleLoops(arcs: OrientedPiece[], chords: { a: Vector3; b: Vector3 }[], tolerance: number): CurvePiece3[][] | null {
  const all: OrientedPiece[] = [
    ...arcs,
    ...chords.map((chord) => ({ piece: { kind: "segment" as const, a: chord.a, b: chord.b }, start: chord.a, end: chord.b }))
  ]
  const used = all.map(() => false)
  const loops: CurvePiece3[][] = []
  const matches = (first: Vector3, second: Vector3) => distanceBetween(first, second) <= tolerance * 10

  for (let index = 0; index < all.length; index += 1) {
    if (used[index]) continue
    used[index] = true
    const walk: CurvePiece3[] = [all[index].piece]
    const start = all[index].start
    let current = all[index].end
    let steps = 0
    while (!matches(current, start)) {
      if (steps > all.length) return null
      const nextIndex = all.findIndex((candidate, candidateIndex) => !used[candidateIndex] && (matches(candidate.start, current) || matches(candidate.end, current)))
      if (nextIndex < 0) return null
      used[nextIndex] = true
      const next = all[nextIndex]
      const oriented = matches(next.start, current) ? next : { piece: reversePiece(next.piece), start: next.end, end: next.start }
      walk.push(oriented.piece)
      current = oriented.end
      steps += 1
    }
    loops.push(walk)
  }
  return loops
}

/**
 * 平面切一个有限二次曲面实体：解析结论 + 片段环。
 *
 * 返回 `null` 表示**这个来源不是二次曲面实体**（没有 `bounds`，例如平面本身），调用方回退既有多边形路径。
 */
export function sectionQuadric3(source: Quadric3, plane: Plane3): SectionQuadricResult | null {
  const bounds = source.bounds
  if (!bounds) return null
  const conic = intersectPlaneQuadric3(plane, source)
  if (conic.kind === "insufficient-data") return null
  if (conic.kind === "empty" || conic.kind === "point" || conic.kind === "line" || conic.kind === "lines") {
    return { kind: conic.kind, loops: [] }
  }

  const axial: AxialAxis = { at: (point) => dotVector3(subtractVector3(point, bounds.origin), bounds.axis), direction: bounds.axis }
  const tolerance = Math.max(bounds.radius, bounds.height) * 1e-9
  const levels = [0, bounds.height]
  const closed = conic.kind === "circle" || conic.kind === "ellipse"
  // 双曲线有两支：落在实体内的可能只是其中一支（另一支在另一个锥面上），所以逐支裁剪。
  const branches = conic.kind === "hyperbola" ? [0, 1] : [0]

  const arcs: OrientedPiece[] = []
  let crossingCount = 0
  for (const branch of branches) {
    const crossings = levels.flatMap((level) => crossingParameters(conic, level, axial, tolerance, branch))
    crossingCount += crossings.length
    const isInside = (parameter: number) => {
      const point = conic3PointAt(conic, parameter, branch)
      if (!point) return false
      const value = axial.at(point)
      return value >= -tolerance && value <= bounds.height + tolerance
    }
    for (const [from, to] of insideRanges(crossings, closed, isInside)) {
      const start = conic3PointAt(conic, from, branch)
      const end = conic3PointAt(conic, to, branch)
      if (!start || !end) return null
      arcs.push({ piece: { kind: "conic", conic, parameterRange: [from, to], branch }, start, end })
    }
  }
  if (arcs.length === 0) return { kind: "empty", loops: [] }
  // 整条曲线都在实体内：闭曲线自成一环，开曲线在没有端面约束时闭合不了，如实放弃。
  if (arcs.length === 1 && crossingCount === 0 && !closed) return null

  const chords = capChords(arcs, levels, axial, tolerance)
  if (chords === null) return null
  const loops = assembleLoops(arcs, chords, tolerance)
  if (!loops) return null
  return { kind: conic.kind, loops }
}

/** 片段环的全部端点（测试与上层校验"环确实闭合"用）。 */
export function curvePieceEndpoints(pieces: CurvePiece3[]): Vector3[] {
  return pieces.flatMap((piece) =>
    piece.kind === "segment"
      ? [piece.a, piece.b]
      : [conic3PointAt(piece.conic, piece.parameterRange[0], piece.branch ?? 0), conic3PointAt(piece.conic, piece.parameterRange[1], piece.branch ?? 0)].filter((point): point is Vector3 => point !== null)
  )
}
