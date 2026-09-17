import { describe, expect, it } from "vitest"

import type { PolylinePrimitive, RayPrimitive } from "@draw/dsl"

import { distanceToPolyline, pointOnRay, polylineLength } from "./polyline"

const ray: RayPrimitive = { id: "ray-1", type: "ray", a: { x: 1, y: 2 }, b: { x: 3, y: 3 } }
const polyline: PolylinePrimitive = { id: "polyline-1", type: "polyline", points: [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 4 }] }

describe("ray and polyline geometry", () => {
  it("accepts points on the ray forward from its origin", () => {
    expect(pointOnRay(ray, { x: 5, y: 4 })).toBe(true)
    expect(pointOnRay(ray, { x: -1, y: 1 })).toBe(false)
    expect(pointOnRay(ray, { x: 5, y: 4.1 })).toBe(false)
  })

  it("rejects a degenerate ray instead of accepting every point", () => {
    expect(pointOnRay({ ...ray, a: { x: 1, y: 2 }, b: { x: 1, y: 2 } }, { x: 100, y: 100 })).toBe(false)
  })

  it("keeps ray predicates meaningful at extreme finite scales", () => {
    const extremeRay: RayPrimitive = { id: "extreme-ray", type: "ray", a: { x: 0, y: 0 }, b: { x: 1e308, y: 0 } }
    expect(pointOnRay(extremeRay, { x: 5e307, y: 0 })).toBe(true)
    expect(pointOnRay(extremeRay, { x: 5e307, y: 1e300 })).toBe(false)
  })

  /**
   * 体检发现的真缺陷：`pointOnRay` 用**绝对**容差（1e-9）比叉积残差，而残差是长度量纲。
   * 在 ~1e9 的坐标上，一个确实落在射线上的点算出来的残差就有 ~1e-7，于是被判成"不在射线上"
   * （与 `intersections.onRay` 已修的同一类缺陷）。
   */
  it("keeps an off-axis ray point at large coordinates", () => {
    const offset = 1e9
    const largeRay: RayPrimitive = { id: "large-ray", type: "ray", a: { x: offset, y: offset }, b: { x: offset + 1, y: offset + 0.001 } }
    // 沿射线方向走 0.5 个单位的点：数学上严格在射线上。
    const onRay = { x: offset + 0.5, y: offset + 0.0005 }

    expect(pointOnRay(largeRay, onRay)).toBe(true)
    // 真在射线外（横向偏 0.5 个单位 = 坐标尺度的 5e-10）仍然要被判掉。
    expect(pointOnRay(largeRay, { x: offset + 0.5, y: offset + 0.5 })).toBe(false)
    // 反向：起点之后的点依旧拒绝。
    expect(pointOnRay(largeRay, { x: offset - 0.5, y: offset - 0.0005 })).toBe(false)
  })

  it("computes polyline length from ordered vertices", () => {
    expect(polylineLength(polyline)).toBe(8)
  })

  it("computes the minimum distance to any polyline segment", () => {
    expect(distanceToPolyline(polyline, { x: 1.5, y: 2 })).toBeCloseTo(0)
    expect(distanceToPolyline(polyline, { x: 6, y: 7 })).toBeCloseTo(3)
  })

  /**
   * 同一次体检：只有一个点的折线是"退化成点"的折线，距离应当是**到那个点**的距离；
   * 旧实现直接返回 `+Infinity`（调用方会把它当成"无穷远"，画出错误的最远距离）。
   * 一个点都没有时才真的无从定义。
   */
  it("treats a single-point polyline as a point instead of returning infinity", () => {
    expect(distanceToPolyline({ id: "p", type: "polyline", points: [{ x: 1, y: 1 }] }, { x: 1, y: 3 })).toBeCloseTo(2)
    expect(distanceToPolyline({ id: "p", type: "polyline", points: [] }, { x: 1, y: 3 })).toBe(Number.POSITIVE_INFINITY)
  })

  it("avoids squared-length overflow for large finite polylines", () => {
    const extremePolyline: PolylinePrimitive = { id: "extreme-polyline", type: "polyline", points: [{ x: 0, y: 0 }, { x: 1e308, y: 0 }] }
    expect(distanceToPolyline(extremePolyline, { x: 5e307, y: 1 })).toBeCloseTo(1)
    expect(polylineLength(extremePolyline)).toBe(1e308)
  })
})
