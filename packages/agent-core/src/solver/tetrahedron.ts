/**
 * **六条棱长 → 四面体坐标**（2026-10-19，P1-1）。
 *
 * 模型在坐标心算上反复出错（PB=2.08、PC=2.08 这类）。对“六条棱都给了”的四面体，
 * 坐标本可以解析构造：把 A 放在原点、B 放在 x 轴、C 放在 xy 平面，P 由三个距离方程解出。
 *
 * 这里是纯数学层：只返回坐标或 `null`，**不判断题设是否成立**；核验仍由
 * `verifyDiagramObligations` 按最终坐标做。返回前自己回代六个距离，避免把数值退化
 * 的坐标交给编译层。
 */

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface TetrahedronMeasures {
  /** 底面三条棱。 */
  ab: number
  ac: number
  bc: number
  /** 顶点 P 到 A/B/C 的三条棱。 */
  pa: number
  pb: number
  pc: number
}

export interface TetrahedronPoints {
  a: Point3
  b: Point3
  c: Point3
  p: Point3
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function distance(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

export function constructTetrahedron(measures: TetrahedronMeasures): TetrahedronPoints | null {
  const { ab, ac, bc, pa, pb, pc } = measures
  if (![ab, ac, bc, pa, pb, pc].every(finitePositive)) return null

  const scale = Math.max(ab, ac, bc, pa, pb, pc)
  const epsilon = scale * 1e-9

  // C：由 |AC|、|BC| 与 AB 在 x 轴上的位置定出。
  const xC = (ac * ac + ab * ab - bc * bc) / (2 * ab)
  const yCSquared = ac * ac - xC * xC
  if (yCSquared <= epsilon * epsilon) return null
  const yC = Math.sqrt(yCSquared)

  // P：由 |PA|、|PB| 定 x；再由 |PC| 定 y；z 由 |PA| 定。
  const xP = (pa * pa - pb * pb + ab * ab) / (2 * ab)
  const yP = (pa * pa - pc * pc - 2 * xP * xC + xC * xC + yC * yC) / (2 * yC)
  const zPSquared = pa * pa - xP * xP - yP * yP
  if (zPSquared <= epsilon * epsilon) return null
  const zP = Math.sqrt(zPSquared)

  const points: TetrahedronPoints = {
    a: { x: 0, y: 0, z: 0 },
    b: { x: ab, y: 0, z: 0 },
    c: { x: xC, y: yC, z: 0 },
    p: { x: xP, y: yP, z: zP }
  }

  const residual = Math.max(
    Math.abs(distance(points.a, points.b) - ab),
    Math.abs(distance(points.a, points.c) - ac),
    Math.abs(distance(points.b, points.c) - bc),
    Math.abs(distance(points.p, points.a) - pa),
    Math.abs(distance(points.p, points.b) - pb),
    Math.abs(distance(points.p, points.c) - pc)
  )
  return residual <= scale * 1e-9 ? points : null
}
