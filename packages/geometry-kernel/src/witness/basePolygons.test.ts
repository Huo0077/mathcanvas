import { describe, expect, it } from "vitest"

import type { Vector3 } from "../geometry3d"
import { rhombusPolygon, rightTrapezoidPolygon, snapToZero } from "./basePolygons"

/**
 * **T3：底面解析构造的纯数学部分**（2026-11-05 四题修复）。
 *
 * 判据一律**自己量**：长度用 `Math.hypot`、角度用点积/叉积，不读实现返回的自述。
 * 这一层不管"哪条关系对应哪个顶点"（那是 `constructors.ts` 的活），只管数值 → 坐标。
 */

const distance = (left: Vector3, right: Vector3): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)

/** 四边形各边长度，按环序。 */
function sideLengths(polygon: readonly Vector3[]): number[] {
  return polygon.map((point, index) => distance(point, polygon[(index + 1) % polygon.length]!))
}

function interiorAngleDegrees(polygon: readonly Vector3[], index: number): number {
  const current = polygon[index]!
  const before = polygon[(index + polygon.length - 1) % polygon.length]!
  const after = polygon[(index + 1) % polygon.length]!
  const first = { x: before.x - current.x, y: before.y - current.y }
  const second = { x: after.x - current.x, y: after.y - current.y }
  const dot = first.x * second.x + first.y * second.y
  const cross = first.x * second.y - first.y * second.x
  return (Math.atan2(Math.abs(cross), dot) * 180) / Math.PI
}

describe("T3 直角梯形：a, c, h → 闭式坐标", () => {
  it("a=2、c=1、h=2（Case 1 底面）：AB=2、AD=2、CD=1，AB 是 AD 与 DC 的公垂线", () => {
    const result = rightTrapezoidPolygon({ width: 2, height: 2, top: 1 })
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    const [a, b, c, d] = result.polygon as [Vector3, Vector3, Vector3, Vector3]
    expect(distance(a, b)).toBeCloseTo(2, 12)
    expect(distance(a, d)).toBeCloseTo(2, 12)
    expect(distance(c, d)).toBeCloseTo(1, 12)
    // AB 沿 +x、AD 沿 +y：A 处是直角；AB ∥ DC（AD 是公垂线）。
    expect(a.y).toBe(0)
    expect(b.y).toBe(0)
    expect(d.x).toBe(0)
    expect(c.y).toBe(d.y)
    // 全部严格在 z = 0 上（解析构造，不是"大致共面"）。
    for (const point of result.polygon) expect(point.z).toBe(0)
  })

  it("a=2、c=1、h=1（Case 4 折前底面）", () => {
    const result = rightTrapezoidPolygon({ width: 2, height: 1, top: 1 })
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    const sides = sideLengths(result.polygon)
    expect(sides[0]).toBeCloseTo(2, 12)
    expect(sides[1]).toBeCloseTo(Math.SQRT2, 12)
    expect(sides[2]).toBeCloseTo(1, 12)
    expect(sides[3]).toBeCloseTo(1, 12)
    expect(interiorAngleDegrees(result.polygon, 0)).toBeCloseTo(90, 12)
    /** `B` 处的斜角 = atan(h / (a − c)) = atan(1 / 1) = 45°；`C` 处是它的补角 135°。 */
    expect(interiorAngleDegrees(result.polygon, 1)).toBeCloseTo(45, 10)
    expect(interiorAngleDegrees(result.polygon, 2)).toBeCloseTo(135, 10)
  })

  it("a=5、c=2、h=3：显式数值原样使用，不套代表值", () => {
    const result = rightTrapezoidPolygon({ width: 5, height: 3, top: 2 })
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(distance(result.polygon[0]!, result.polygon[1]!)).toBeCloseTo(5, 12)
    expect(distance(result.polygon[0]!, result.polygon[3]!)).toBeCloseTo(3, 12)
    expect(distance(result.polygon[2]!, result.polygon[3]!)).toBeCloseTo(2, 12)
    // 斜面 BC 由 a、c、h 决定：√((a−c)² + h²) = √(9+9) = 3√2。
    expect(distance(result.polygon[1]!, result.polygon[2]!)).toBeCloseTo(3 * Math.SQRT2, 12)
  })

  it("负测：零 / 负 / 非有限边长都是结构化拒绝，不返回 NaN", () => {
    for (const input of [
      { width: 0, height: 2, top: 1 },
      { width: 2, height: -1, top: 1 },
      { width: 2, height: 2, top: 0 },
      { width: Number.NaN, height: 2, top: 1 },
      { width: Number.POSITIVE_INFINITY, height: 2, top: 1 }
    ]) {
      const result = rightTrapezoidPolygon(input)
      expect(result.status, JSON.stringify(input)).toBe("rejected")
      if (result.status === "rejected") {
        expect(result.message.length).toBeGreaterThan(0)
        // 拒绝里**没有坐标**：退化输入不许流成一组 NaN 顶点。
        expect(result).not.toHaveProperty("polygon")
      }
    }
  })
})

describe("T3 菱形：边长 + 显式角（60° / 75°）", () => {
  for (const degrees of [60, 75]) {
    it(`s=2、∠BAD=${degrees}° ⇒ 四边相等且 A 处内角正是 ${degrees}°`, () => {
      const result = rhombusPolygon({ side: 2, angleDegrees: degrees })
      expect(result.status).toBe("ok")
      if (result.status !== "ok") return
      const sides = sideLengths(result.polygon)
      for (const side of sides) expect(side).toBeCloseTo(2, 12)
      expect(interiorAngleDegrees(result.polygon, 0)).toBeCloseTo(degrees, 10)
      // 对角相等、邻角互补（这是菱形，不是"边长凑巧相等"的任意四边形）。
      expect(interiorAngleDegrees(result.polygon, 2)).toBeCloseTo(degrees, 10)
      expect(interiorAngleDegrees(result.polygon, 1)).toBeCloseTo(180 - degrees, 10)
    })
  }

  it("75° 与 60° 得到**不同**的图形（代表角不许顶掉显式角）", () => {
    const sixty = rhombusPolygon({ side: 2, angleDegrees: 60 })
    const seventyFive = rhombusPolygon({ side: 2, angleDegrees: 75 })
    expect(sixty.status === "ok" && seventyFive.status === "ok").toBe(true)
    if (sixty.status !== "ok" || seventyFive.status !== "ok") return
    expect(sixty.polygon[1]).toEqual(seventyFive.polygon[1])
    expect(sixty.polygon[3]!.x).not.toBeCloseTo(seventyFive.polygon[3]!.x, 6)
    expect(sixty.polygon[3]!.y).not.toBeCloseTo(seventyFive.polygon[3]!.y, 6)
  })

  it("负测：0° / 180° / 负角 / 非有限角 / 零或负边长都是结构化拒绝", () => {
    for (const input of [
      { side: 2, angleDegrees: 0 },
      { side: 2, angleDegrees: 180 },
      { side: 2, angleDegrees: -30 },
      { side: 2, angleDegrees: Number.NaN },
      { side: 0, angleDegrees: 60 },
      { side: -1, angleDegrees: 60 }
    ]) {
      const result = rhombusPolygon(input)
      expect(result.status, JSON.stringify(input)).toBe("rejected")
    }
  })

  it("浮点噪声按回 0（而不是放宽内核的尺度守卫）", () => {
    // 90° 的 cos 是 6.1e-17；不按回去，内核会判"坐标量级跨度过大"。
    const square = rhombusPolygon({ side: 2, angleDegrees: 90 })
    expect(square.status).toBe("ok")
    if (square.status !== "ok") return
    expect(square.polygon[3]!.x).toBe(0)
    expect(snapToZero(1e-17)).toBe(0)
    expect(snapToZero(1e-6)).toBe(1e-6)
  })
})
