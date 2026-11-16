/**
 * **右三棱柱的解析坐标**（2026-10-19，P1-1，solid-13）。
 *
 * 题面：三棱柱 ABC-A₁B₁C₁，AA₁=L，A₁C⊥底面 ABC，∠ACB=90°，
 * A₁ 到平面 BCC₁B₁ 的距离 d1，直线 AA₁ 与 BB₁ 的距离 d2。
 *
 * 取 C=(0,0,0)、A=(x,0,0)、B=(0,y,0)。A₁C⊥底面 ⇒ A₁=(0,0,h)，侧棱 v=(-x,0,h)。
 * 于是 x²+h²=L²、xh/L=d1、直线 AA₁ 与 BB₁ 的距离=y=d2。
 * 纯数学层；最终仍由题设核验。
 */

import {
  buildPrism,
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

export interface RightPrismMeasures {
  lateralLength: number
  apexToPlane: number
  lateralLineDistance: number
}

export interface RightPrismPoints {
  a: Point3
  b: Point3
  c: Point3
  a1: Point3
  b1: Point3
  c1: Point3
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

export function constructRightPrism(measures: RightPrismMeasures): RightPrismPoints | null {
  const { lateralLength, apexToPlane, lateralLineDistance } = measures
  if (![lateralLength, apexToPlane, lateralLineDistance].every(finitePositive)) return null
  const L = lateralLength
  const d1 = apexToPlane
  const d2 = lateralLineDistance
  const discriminant = L * L - 2 * d1 * L
  if (discriminant < 0) return null
  const sum = Math.sqrt(L * L + 2 * d1 * L)
  const difference = Math.sqrt(discriminant)
  const x = (sum + difference) / 2
  const h = (sum - difference) / 2
  if (!(x > 0) || !(h > 0)) return null
  const y = d2

  return {
    c: { x: 0, y: 0, z: 0 },
    a: { x, y: 0, z: 0 },
    b: { x: 0, y, z: 0 },
    a1: { x: 0, y: 0, z: h },
    b1: { x: -x, y, z: h },
    c1: { x: -x, y: 0, z: h }
  }
}

export interface ParameterizedPrismInput {
  kind: "right" | "oblique"
  base: readonly Point3[]
  height?: number
  direction?: Point3
}

export type ParameterizedPrismResult =
  | {
    ok: true
    kind: "right" | "oblique"
    base: Point3[]
    top: Point3[]
    vector: Point3
    signedVolume: number
  }
  | { ok: false; reason: string }

function newellUnitNormal(points: readonly Point3[]): Point3 | null {
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
  if (!(len > 1e-12)) return null
  return { x: nx / len, y: ny / len, z: nz / len }
}

export function constructParameterizedPrism(input: ParameterizedPrismInput): ParameterizedPrismResult {
  const base = input.base.map((p) => ({ ...p }))
  if (base.length < 3 || base.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) {
    return { ok: false, reason: "invalid_prism_base" }
  }
  const span = modelSpan(base)
  if (!hasNonZeroArea(base, span)) return { ok: false, reason: "degenerate_base_area" }
  if (base.length >= 4 && maxPlaneDeviation(base) > span * 1e-9) {
    return { ok: false, reason: "non_planar_base" }
  }
  if (hasSelfIntersectingPolygon(base)) return { ok: false, reason: "self_intersecting_base" }

  const normal = newellUnitNormal(base)
  if (!normal) return { ok: false, reason: "degenerate_base_normal" }

  let vector: Point3
  if (input.kind === "right") {
    if (input.direction !== undefined) {
      if (!Number.isFinite(input.direction.x) || !Number.isFinite(input.direction.y) || !Number.isFinite(input.direction.z)) {
        return { ok: false, reason: "invalid_direction" }
      }
      const dotN = input.direction.x * normal.x + input.direction.y * normal.y + input.direction.z * normal.z
      const perp = Math.hypot(
        input.direction.x - dotN * normal.x,
        input.direction.y - dotN * normal.y,
        input.direction.z - dotN * normal.z
      )
      const dirLen = Math.hypot(input.direction.x, input.direction.y, input.direction.z)
      if (perp > Math.max(span, dirLen) * 1e-9) {
        return { ok: false, reason: "right_prism_cannot_have_oblique_tilt" }
      }
      if (Math.abs(dotN) <= 1e-9) return { ok: false, reason: "degenerate_prism_height" }
      vector = { ...input.direction }
    } else {
      if (input.height === undefined || !finitePositive(input.height)) {
        return { ok: false, reason: "invalid_prism_height" }
      }
      vector = { x: normal.x * input.height, y: normal.y * input.height, z: normal.z * input.height }
    }
  } else {
    if (!input.direction || !Number.isFinite(input.direction.x) || !Number.isFinite(input.direction.y) || !Number.isFinite(input.direction.z)) {
      return { ok: false, reason: "oblique_prism_requires_direction" }
    }
    const d = input.direction
    const dotN = d.x * normal.x + d.y * normal.y + d.z * normal.z
    if (Math.abs(dotN) <= span * 1e-9) {
      return { ok: false, reason: "coplanar_oblique_direction" }
    }
    const tang = Math.hypot(d.x - dotN * normal.x, d.y - dotN * normal.y, d.z - dotN * normal.z)
    if (tang <= Math.max(span, Math.abs(dotN)) * 1e-9) {
      return { ok: false, reason: "oblique_prism_missing_lateral_tilt" }
    }
    vector = { ...d }
  }

  const built = buildPrism({ base, vector }, createBuilderContext("param-prism"))
  if (built.diagnostics.length > 0) {
    return { ok: false, reason: built.diagnostics.map((d) => `${d.code}:${d.message}`).join("; ") }
  }
  const top = base.map((p) => ({ x: p.x + vector.x, y: p.y + vector.y, z: p.z + vector.z }))
  const n = base.length
  const ordered = (built.primitives
    .filter((p) => p.type === "point3")
    .slice(0, n) as { position: Point3 }[]).map((p) => p.position)
  const orderedTop = ordered.map((p) => ({ x: p.x + vector.x, y: p.y + vector.y, z: p.z + vector.z }))
  const faces = [
    Array.from({ length: n }, (_, i) => n - 1 - i),
    Array.from({ length: n }, (_, i) => n + i),
    ...Array.from({ length: n }, (_, i) => [i, (i + 1) % n, n + ((i + 1) % n), n + i])
  ]
  const signedVolume = signedPolyhedronVolume([...ordered, ...orderedTop], faces)
  return { ok: true, kind: input.kind, base, top, vector, signedVolume }
}
