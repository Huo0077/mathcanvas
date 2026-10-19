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
