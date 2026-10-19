/**
 * **直四棱柱 + 梯形底**的解析坐标（2026-10-19，P1-1，solid-20）。
 *
 * 题面：直四棱柱 ABCD-A₁B₁C₁D₁，AB⊥AD，AB//CD，AB=2，AD=3，CD=4，体积 36。
 * 梯形面积 = (AB+CD)/2·AD = 9，所以高 = 4。取 A=(0,0)、AB 沿 x、AD 沿 y，
 * C=(CD,AD)；上底面整体 z=height。纯数学层，返回 null 而不是 NaN。
 */

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface RightTrapezoidPrismMeasures {
  ab: number
  ad: number
  cd: number
  volume: number
}

export interface RightTrapezoidPrismPoints {
  a: Point3
  b: Point3
  c: Point3
  d: Point3
  a1: Point3
  b1: Point3
  c1: Point3
  d1: Point3
}

export function constructRightTrapezoidPrism(measures: RightTrapezoidPrismMeasures): RightTrapezoidPrismPoints | null {
  const { ab, ad, cd, volume } = measures
  if (![ab, ad, cd, volume].every((value) => Number.isFinite(value) && value > 0)) return null
  const area = ((ab + cd) / 2) * ad
  if (!(area > 0)) return null
  const height = volume / area
  if (!Number.isFinite(height) || height <= 0) return null
  return {
    a: { x: 0, y: 0, z: 0 },
    b: { x: ab, y: 0, z: 0 },
    c: { x: cd, y: ad, z: 0 },
    d: { x: 0, y: ad, z: 0 },
    a1: { x: 0, y: 0, z: height },
    b1: { x: ab, y: 0, z: height },
    c1: { x: cd, y: ad, z: height },
    d1: { x: 0, y: ad, z: height }
  }
}
