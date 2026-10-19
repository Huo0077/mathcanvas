/**
 * **正四棱锥的解析坐标**（2026-10-19，P1-1）：底面正方形边长 a，侧棱长 l。
 * 顶点在底面中心正上方，h² = l² − a²/2。纯数学层，非法输入返回 `null`。
 */
export interface RegularPyramidPoint {
  x: number
  y: number
  z: number
}

export interface RegularPyramidPoints {
  a: RegularPyramidPoint
  b: RegularPyramidPoint
  c: RegularPyramidPoint
  d: RegularPyramidPoint
  p: RegularPyramidPoint
}

export function constructRegularSquarePyramid(side: number, lateral: number): RegularPyramidPoints | null {
  if (!Number.isFinite(side) || !Number.isFinite(lateral) || side <= 0 || lateral <= 0) return null
  const heightSquared = lateral * lateral - side * side / 2
  if (!(heightSquared > (Math.max(side, lateral) * 1e-9) ** 2)) return null
  const height = Math.sqrt(heightSquared)
  return {
    a: { x: 0, y: 0, z: 0 },
    b: { x: side, y: 0, z: 0 },
    c: { x: side, y: side, z: 0 },
    d: { x: 0, y: side, z: 0 },
    p: { x: side / 2, y: side / 2, z: height }
  }
}
