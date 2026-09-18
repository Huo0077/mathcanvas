import { describe, expect, it } from "vitest"

import type { PrimitiveSpec } from "@draw/dsl"

import { DEFAULT_TANGENT_PARAMETER, defaultTangentAnchor, isTangentSource, tangentAnchorLabel, tangentSources, TANGENT_SOURCE_TYPES } from "./curveTangents"

function primitive(type: PrimitiveSpec["type"]): PrimitiveSpec {
  return { id: `${type}-1`, type } as PrimitiveSpec
}

/**
 * 用户口径："曲线包括抛物线，双曲线，圆，椭圆。"
 *
 * 这份名单是**按钮可用性、提示文案、切点默认值**的共同真源，所以它自己必须被钉住：
 * 名单一旦与界面上真的能点的东西走偏，用户看到的就又是"提示说有、点了却不行"。
 */
describe("which curves can grow a tangent", () => {
  it("includes the four curves the user named", () => {
    for (const type of ["parabola", "hyperbola", "circle", "ellipse"] as const) {
      expect(isTangentSource(primitive(type)), type).toBe(true)
      expect(TANGENT_SOURCE_TYPES).toContain(type)
    }
  })

  it("includes the function graph and the arc, which are the same construction", () => {
    expect(isTangentSource(primitive("function"))).toBe(true)
    expect(isTangentSource(primitive("arc"))).toBe(true)
  })

  it("excludes the straight entities, where 'tangent' has no meaning", () => {
    for (const type of ["line", "segment", "ray", "polyline", "point", "locus", "connection"] as const) {
      expect(isTangentSource(primitive(type)), type).toBe(false)
    }
    expect(isTangentSource(null)).toBe(false)
    expect(isTangentSource(undefined)).toBe(false)
  })

  it("filters a document down to the tangent sources, in document order", () => {
    const primitives = [primitive("line"), primitive("circle"), primitive("point"), primitive("ellipse")]
    expect(tangentSources(primitives).map((candidate) => candidate.id)).toEqual(["circle-1", "ellipse-1"])
  })

  it("starts the tangent at the curve's natural origin, which is a vertex on all four", () => {
    expect(DEFAULT_TANGENT_PARAMETER).toBe(0)
    expect(defaultTangentAnchor()).toEqual({ kind: "parameter", parameter: 0, branch: 0 })
  })
})

describe("describing where a tangent touches", () => {
  it("names the point a point-anchored tangent follows", () => {
    expect(tangentAnchorLabel({ kind: "point", pointId: "point-3" }, () => "P")).toBe("跟随动点 P")
  })

  it("says so when the anchor point is gone instead of showing nothing", () => {
    expect(tangentAnchorLabel({ kind: "point", pointId: "point-gone" }, () => null)).toBe("定位点已不存在")
  })

  it("reports the parameter for a parameter-anchored tangent", () => {
    expect(tangentAnchorLabel({ kind: "parameter", parameter: 1.23456 }, () => null)).toBe("曲线参数 1.235")
    expect(tangentAnchorLabel(undefined, () => null)).toBe("函数图像上的横坐标")
  })
})
