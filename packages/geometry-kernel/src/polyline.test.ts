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

  it("computes polyline length from ordered vertices", () => {
    expect(polylineLength(polyline)).toBe(8)
  })

  it("computes the minimum distance to any polyline segment", () => {
    expect(distanceToPolyline(polyline, { x: 1.5, y: 2 })).toBeCloseTo(0)
    expect(distanceToPolyline(polyline, { x: 6, y: 7 })).toBeCloseTo(3)
  })

  it("avoids squared-length overflow for large finite polylines", () => {
    const extremePolyline: PolylinePrimitive = { id: "extreme-polyline", type: "polyline", points: [{ x: 0, y: 0 }, { x: 1e308, y: 0 }] }
    expect(distanceToPolyline(extremePolyline, { x: 5e307, y: 1 })).toBeCloseTo(1)
    expect(polylineLength(extremePolyline)).toBe(1e308)
  })
})
