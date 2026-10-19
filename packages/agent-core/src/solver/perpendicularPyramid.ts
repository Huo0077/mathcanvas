/**
 * **PA⊥底面 + AD=CD + ∠ABC + 平面 PAC⊥平面 PBD** 的解析坐标
 * （2026-10-19，P1-1，solid-9）。
 *
 * A 在原点、B 在 x 轴、P 在 z 轴；C 由 `BC` 与 `∠ABC` 定出。D 要同时满足
 * `AD=CD` 与 `平面 PAC⊥平面 PBD`；这两条在题设数据下给出同一条垂直平分线，
 * 所以 D 在垂直平分线上任取一个不共线的位置。纯数学层，最后回代条件。
 */

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface PerpendicularPyramidMeasures {
  ab: number
  bc: number
  angleABC: number
  pa: number
}

export interface PerpendicularPyramidPoints {
  a: Point3
  b: Point3
  c: Point3
  d: Point3
  p: Point3
}

export function constructPerpendicularPyramid(measures: PerpendicularPyramidMeasures): PerpendicularPyramidPoints | null {
  const { ab, bc, angleABC, pa } = measures
  if (![ab, bc, pa].every((value) => Number.isFinite(value) && value > 0)) return null
  if (!Number.isFinite(angleABC) || angleABC <= 0 || angleABC >= 180) return null
  const theta = (angleABC * Math.PI) / 180
  const c = { x: ab - bc * Math.cos(theta), y: bc * Math.sin(theta), z: 0 }
  const length = Math.hypot(c.x, c.y)
  if (!(length > 0)) return null
  const midpoint = { x: c.x / 2, y: c.y / 2 }
  const perpendicular = { x: -c.y / length, y: c.x / length }
  const offset = length / Math.sqrt(3)
  const d = { x: midpoint.x + perpendicular.x * offset, y: midpoint.y + perpendicular.y * offset, z: 0 }
  const points: PerpendicularPyramidPoints = {
    a: { x: 0, y: 0, z: 0 },
    b: { x: ab, y: 0, z: 0 },
    c,
    d,
    p: { x: 0, y: 0, z: pa }
  }

  const ad = Math.hypot(d.x, d.y)
  const cd = Math.hypot(d.x - c.x, d.y - c.y)
  const plane1 = { x: -c.y, y: c.x, z: 0 }
  const pb = { x: ab, y: 0, z: -pa }
  const pd = { x: d.x, y: d.y, z: -pa }
  const plane2 = {
    x: pb.y * pd.z - pb.z * pd.y,
    y: pb.z * pd.x - pb.x * pd.z,
    z: pb.x * pd.y - pb.y * pd.x
  }
  const dot = plane1.x * plane2.x + plane1.y * plane2.y + plane1.z * plane2.z
  const scale = Math.max(1, length * pa * ad)
  if (Math.abs(ad - cd) > scale * 1e-9) return null
  if (Math.abs(dot) > scale * 1e-9) return null
  const cross = c.x * plane2.x + c.y * plane2.y
  if (Math.abs(c.x * ab - length * length / 2) > scale * 1e-9) return null
  if (Math.abs(cross) < 1e-12) return null
  return points
}
