import { describe, expect, it } from "vitest"

import type { PrimitiveSpec } from "@draw/dsl"

import { dynamicPointPaths, isDynamicPointPath } from "./dynamicPointPaths"

/**
 * "能把点变成动点"的路径类型。
 *
 * 属性栏的「路径绑定」下拉与状态栏的绑定提示必须用**同一份**列表：用户在提示里看到的候选，
 * 就是下拉里真的能选到的那几个（反馈原话："我也不知道如何将点固定到我创立的曲线或直线轨迹上面"）。
 */
describe("dynamic point paths", () => {
  const primitive = (type: string): PrimitiveSpec => ({ id: `${type}-1`, type } as PrimitiveSpec)

  it("accepts every curve a point can slide along", () => {
    for (const type of ["line", "segment", "ray", "polyline", "circle", "arc", "function", "ellipse", "parabola", "hyperbola"]) {
      expect(isDynamicPointPath(primitive(type)), type).toBe(true)
    }
  })

  it("rejects objects a point cannot be bound to", () => {
    for (const type of ["point", "connection", "locus", "measurement", "annotation", "group"]) {
      expect(isDynamicPointPath(primitive(type)), type).toBe(false)
    }
  })

  it("lists the paths of a document in order", () => {
    const document = [primitive("point"), primitive("line"), primitive("circle"), primitive("group")]

    expect(dynamicPointPaths(document).map((item) => item.type)).toEqual(["line", "circle"])
  })
})
