/**
 * **正方形底四棱锥的解析坐标**（2026-10-19，P1-1）。
 *
 * 题面：底面正方形边长 a，顶点 P 满足 PC=PD=r、∠PCA=θ。把底面放在
 * A(0,0)、B(a,0)、C(a,a)、D(0,a)，则 PC=PD 给出 x=a/2；∠PCA 给出 y；
 * z 由 |PC|=r 解出。纯数学层，返回 `null` 而不是 NaN；最终仍由题设核验。
 */

import {
  buildFromPoints,
  createBuilderContext,
  hasNonZeroArea,
  hasSelfIntersectingPolygon,
  maxPlaneDeviation,
  modelSpan,
  signedPolyhedronVolume
} from "@draw/geometry-kernel"

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface SquarePyramidMeasures {
  side: number
  apexToC: number
  apexToD: number
  anglePcaDegrees: number
}

export interface SquarePyramidPoints {
  a: Point3
  b: Point3
  c: Point3
  d: Point3
  p: Point3
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function distance(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function constructSquarePyramid(measures: SquarePyramidMeasures): SquarePyramidPoints | null {
  const { side, apexToC, apexToD, anglePcaDegrees } = measures
  if (![side, apexToC, apexToD].every(finitePositive)) return null
  if (!Number.isFinite(anglePcaDegrees) || anglePcaDegrees <= 0 || anglePcaDegrees >= 180) return null
  const scale = Math.max(side, apexToC, apexToD)
  const epsilon = scale * 1e-9
  // 只有 PC=PD 才保证顶点在 CD 的垂直平分面上；不等距不是这一族的解析构造。
  if (Math.abs(apexToC - apexToD) > epsilon) return null

  const a = side
  const r = apexToC
  const x = a / 2
  const angle = (anglePcaDegrees * Math.PI) / 180
  // CA=(-a,-a)，CP=(x-a,y-a,z)，∠PCA 的余弦 = (2a-x-y)/(√2 r)。
  const y = 2 * a - x - Math.SQRT2 * r * Math.cos(angle)
  const zSquared = r * r - (x - a) ** 2 - (y - a) ** 2
  if (zSquared <= epsilon * epsilon) return null
  const z = Math.sqrt(zSquared)

  const points: SquarePyramidPoints = {
    a: { x: 0, y: 0, z: 0 },
    b: { x: a, y: 0, z: 0 },
    c: { x: a, y: a, z: 0 },
    d: { x: 0, y: a, z: 0 },
    p: { x, y, z }
  }

  const ca = { x: points.a.x - points.c.x, y: points.a.y - points.c.y, z: points.a.z - points.c.z }
  const cp = { x: points.p.x - points.c.x, y: points.p.y - points.c.y, z: points.p.z - points.c.z }
  const cosine = (ca.x * cp.x + ca.y * cp.y + ca.z * cp.z) / (Math.hypot(ca.x, ca.y, ca.z) * Math.hypot(cp.x, cp.y, cp.z))
  const residual = Math.max(
    Math.abs(distance(points.p, points.c) - apexToC),
    Math.abs(distance(points.p, points.d) - apexToD),
    Math.abs(cosine - Math.cos(angle))
  )
  return residual <= scale * 1e-9 ? points : null
}

export interface PyramidFromFootInput {
  base: readonly Point3[]
  foot: Point3
  height: number
  side?: "positive" | "negative"
}

export type PyramidFromFootResult =
  | {
    ok: true
    base: Point3[]
    foot: Point3
    apex: Point3
    orthogonalResidual: number
    signedVolume: number
  }
  | { ok: false; reason: string }

function pyramidBaseNormal(points: readonly Point3[]): Point3 | null {
  let nx = 0
  let ny = 0
  let nz = 0
  for (let i = 0; i < points.length; i += 1) {
    const c = points[i]!
    const n = points[(i + 1) % points.length]!
    nx += (c.y - n.y) * (c.z + n.z)
    ny += (c.z - n.z) * (c.x + n.x)
    nz += (c.x - n.x) * (c.y + n.y)
  }
  const len = Math.hypot(nx, ny, nz)
  return len > 1e-12 ? { x: nx / len, y: ny / len, z: nz / len } : null
}

export function constructPyramidFromFoot(input: PyramidFromFootInput): PyramidFromFootResult {
  const base = input.base.map((p) => ({ ...p }))
  if (base.length < 3 || base.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) {
    return { ok: false, reason: "invalid_pyramid_base" }
  }
  if (!Number.isFinite(input.foot.x) || !Number.isFinite(input.foot.y) || !Number.isFinite(input.foot.z)) {
    return { ok: false, reason: "invalid_apex_foot" }
  }
  if (!finitePositive(input.height)) return { ok: false, reason: "invalid_pyramid_height" }

  const span = modelSpan(base)
  if (!hasNonZeroArea(base, span)) return { ok: false, reason: "degenerate_base_area" }
  if (base.length >= 4 && maxPlaneDeviation(base) > span * 1e-9) return { ok: false, reason: "non_planar_base" }
  if (hasSelfIntersectingPolygon(base)) return { ok: false, reason: "self_intersecting_base" }

  const normal = pyramidBaseNormal(base)
  if (!normal) return { ok: false, reason: "degenerate_base_normal" }
  // Ensure foot itself lies on the base plane
  if (maxPlaneDeviation([...base, input.foot]) > Math.max(span, Math.hypot(input.foot.x - base[0]!.x, input.foot.y - base[0]!.y, input.foot.z - base[0]!.z)) * 1e-8) {
    return { ok: false, reason: "foot_not_on_base_plane" }
  }

  const sign = input.side === "negative" ? -1 : 1
  const apex: Point3 = {
    x: input.foot.x + sign * input.height * normal.x,
    y: input.foot.y + sign * input.height * normal.y,
    z: input.foot.z + sign * input.height * normal.z
  }

  const n = base.length
  const orderedBase = sign > 0 ? [...base] : [...base].reverse()
  const baseRing = Array.from({ length: n }, (_, i) => n - 1 - i)
  const faces = [baseRing, ...Array.from({ length: n }, (_, i) => [i, (i + 1) % n, n])]
  const vertices = [...orderedBase, apex]
  const built = buildFromPoints({ vertices, faces }, createBuilderContext("foot-pyramid"))
  if (built.diagnostics.length > 0) {
    return { ok: false, reason: built.diagnostics.map((d) => d.code).join(",") }
  }

  const axisVec = { x: apex.x - input.foot.x, y: apex.y - input.foot.y, z: apex.z - input.foot.z }
  const axisLen = Math.hypot(axisVec.x, axisVec.y, axisVec.z)
  let orthogonalResidual = 0
  for (let i = 0; i < n; i += 1) {
    const a = base[i]!
    const b = base[(i + 1) % n]!
    const edge = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    const edgeLen = Math.hypot(edge.x, edge.y, edge.z)
    if (edgeLen > 1e-12 && axisLen > 1e-12) {
      orthogonalResidual = Math.max(
        orthogonalResidual,
        Math.abs(axisVec.x * edge.x + axisVec.y * edge.y + axisVec.z * edge.z) / (axisLen * edgeLen)
      )
    }
  }
  const signedVolume = signedPolyhedronVolume(vertices, faces)
  return { ok: true, base, foot: { ...input.foot }, apex, orthogonalResidual, signedVolume }
}

export function describePyramidApexDomain(input: { base: readonly Point3[]; apexFootKnown: boolean }):
  | { status: "free_domain"; reason: string }
  | { status: "constrained_normal"; reason: string } {
  if (!input.apexFootKnown) {
    return {
      status: "free_domain",
      reason: "垂足未定，未知垂足或自由顶点应声明自由域，禁止擅自默认顶点在底面中心。"
    }
  }
  return { status: "constrained_normal", reason: "已知垂足时顶点沿底面法向定高构造。" }
}
