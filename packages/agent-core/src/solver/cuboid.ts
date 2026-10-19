/**
 * **长方体的解析坐标**（2026-10-19，P1-1）：长、宽、高分别为 l、w、h。
 * 底面 A(0,0,0)、B(l,0,0)、C(l,w,0)、D(0,w,0)，上底沿 +z。非法输入返回 `null`。
 */
export interface CuboidPoint {
  x: number
  y: number
  z: number
}

export interface CuboidPoints {
  a: CuboidPoint
  b: CuboidPoint
  c: CuboidPoint
  d: CuboidPoint
  a1: CuboidPoint
  b1: CuboidPoint
  c1: CuboidPoint
  d1: CuboidPoint
}

export function constructCuboid(length: number, width: number, height: number): CuboidPoints | null {
  if (![length, width, height].every((value) => Number.isFinite(value) && value > 0)) return null
  return {
    a: { x: 0, y: 0, z: 0 },
    b: { x: length, y: 0, z: 0 },
    c: { x: length, y: width, z: 0 },
    d: { x: 0, y: width, z: 0 },
    a1: { x: 0, y: 0, z: height },
    b1: { x: length, y: 0, z: height },
    c1: { x: length, y: width, z: height },
    d1: { x: 0, y: width, z: height }
  }
}
