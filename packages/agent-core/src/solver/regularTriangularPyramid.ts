/**
 * **正三棱锥的解析坐标**（2026-10-19，P1-1）：底面正三角形边长 a，侧棱长 l。
 * 顶点在底面中心正上方，h² = l² − a²/3。非法输入返回 `null`。
 */
export interface RegularTriangularPyramidPoint {
  x: number
  y: number
  z: number
}

export interface RegularTriangularPyramidPoints {
  a: RegularTriangularPyramidPoint
  b: RegularTriangularPyramidPoint
  c: RegularTriangularPyramidPoint
  p: RegularTriangularPyramidPoint
}

export function constructRegularTriangularPyramid(side: number, lateral: number): RegularTriangularPyramidPoints | null {
  if (!Number.isFinite(side) || !Number.isFinite(lateral) || side <= 0 || lateral <= 0) return null
  const heightSquared = lateral * lateral - side * side / 3
  if (!(heightSquared > (Math.max(side, lateral) * 1e-9) ** 2)) return null
  const height = Math.sqrt(heightSquared)
  return {
    a: { x: 0, y: 0, z: 0 },
    b: { x: side, y: 0, z: 0 },
    c: { x: side / 2, y: (Math.sqrt(3) * side) / 2, z: 0 },
    p: { x: side / 2, y: (Math.sqrt(3) * side) / 6, z: height }
  }
}
