/**
 * **等腰直角 + 等边 + 二面角**的解析坐标（2026-10-19，P1-1，trig-23）。
 *
 * AB 是等腰直角三角形 ABC 的斜边，△ABD 是等边三角形；把 AB 放 x 轴，
 * C 在 xy 平面，D 由等边三角形绕 AB 旋转到给定二面角。纯数学层，不做题设判断。
 */

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface DihedralTriangleMeasures {
  ab: number
  dihedralDegrees: number
}

export interface DihedralTrianglePoints {
  a: Point3
  b: Point3
  c: Point3
  d: Point3
}

export function constructDihedralTriangle(measures: DihedralTriangleMeasures): DihedralTrianglePoints | null {
  const { ab, dihedralDegrees } = measures
  if (!Number.isFinite(ab) || ab <= 0) return null
  if (!Number.isFinite(dihedralDegrees) || dihedralDegrees <= 0 || dihedralDegrees >= 180) return null
  const half = ab / 2
  const height = (Math.sqrt(3) / 2) * ab
  const angle = (dihedralDegrees * Math.PI) / 180
  return {
    a: { x: -half, y: 0, z: 0 },
    b: { x: half, y: 0, z: 0 },
    c: { x: 0, y: half, z: 0 },
    d: { x: 0, y: -height * Math.cos(angle), z: -height * Math.sin(angle) }
  }
}
