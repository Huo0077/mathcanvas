/**
 * **正方形底四棱锥的解析坐标**（2026-10-19，P1-1）。
 *
 * 题面：底面正方形边长 a，顶点 P 满足 PC=PD=r、∠PCA=θ。把底面放在
 * A(0,0)、B(a,0)、C(a,a)、D(0,a)，则 PC=PD 给出 x=a/2；∠PCA 给出 y；
 * z 由 |PC|=r 解出。纯数学层，返回 `null` 而不是 NaN；最终仍由题设核验。
 */

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
