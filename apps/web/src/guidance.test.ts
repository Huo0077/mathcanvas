import { describe, expect, it } from "vitest"

import { guidanceFor, type GuidanceAction } from "./guidance"

/** 指引显示在画布左下角的一块小浮层里，太长就会变成一块挡视线的面板。 */
const MAX_HINT_LENGTH = 64

describe("feature button guidance", () => {
  it("explains the full dihedral workflow once a dihedral angle was created", () => {
    const text = guidanceFor({ kind: "measurement", metric: "dihedral", dihedralKind: "interior", outcome: "created" })

    expect(text).toContain("公共棱")
    expect(text).toContain("外角")
  })

  it("explains how to select the two faces a dihedral angle needs", () => {
    const text = guidanceFor({ kind: "measurement", metric: "dihedral", outcome: "blocked" })

    // 二面角最常见的卡点是不知道要按住 Alt 才能单独选中模板实体的面。
    expect(text).toContain("Alt")
    expect(text).toContain("两个面")
  })

  it("names the required sources for every measurement", () => {
    expect(guidanceFor({ kind: "measurement", metric: "length", outcome: "blocked" })).toContain("棱")
    expect(guidanceFor({ kind: "measurement", metric: "distance", outcome: "blocked" })).toContain("点")
    expect(guidanceFor({ kind: "measurement", metric: "angle", outcome: "blocked" })).toContain("3")
    expect(guidanceFor({ kind: "measurement", metric: "area", outcome: "blocked" })).toContain("面")
    expect(guidanceFor({ kind: "measurement", metric: "volume", outcome: "blocked" })).toContain("实体")
  })

  it("says how many space points a blocked spatial tool still needs", () => {
    const line = guidanceFor({ kind: "point3Tool", tool: "line", outcome: "blocked", point3Count: 1 })
    const plane = guidanceFor({ kind: "point3Tool", tool: "plane", outcome: "blocked", point3Count: 2 })
    const face = guidanceFor({ kind: "point3Tool", tool: "face", outcome: "blocked", point3Count: 1 })

    expect(line).toContain("2")
    expect(line).toContain("1")
    expect(plane).toContain("3")
    expect(face).toContain("3")
  })

  it("confirms a created spatial tool and points at the source objects", () => {
    const text = guidanceFor({ kind: "point3Tool", tool: "line", outcome: "created" })

    expect(text).toContain("空间直线")
    expect(text).toContain("来源点")
  })

  it("walks through every planar creation click sequence", () => {
    expect(guidanceFor({ kind: "creation", mode: "line" })).toContain("起点")
    expect(guidanceFor({ kind: "creation", mode: "line" })).toContain("Esc")
    expect(guidanceFor({ kind: "creation", mode: "circle" })).toContain("圆心")
    expect(guidanceFor({ kind: "creation", mode: "arc" })).toContain("圆心")
    expect(guidanceFor({ kind: "creation", mode: "arc" })).toContain("终点")
    expect(guidanceFor({ kind: "creation", mode: "polyline" })).toContain("双击")
  })

  it("points at the inspector for one-click objects", () => {
    expect(guidanceFor({ kind: "conic", type: "ellipse" })).toContain("属性栏")
    expect(guidanceFor({ kind: "function" })).toContain("预设")
    expect(guidanceFor({ kind: "point", workspace: "conics" })).toContain("坐标")
    expect(guidanceFor({ kind: "solid", solid: "cube" })).toContain("朝向")
    expect(guidanceFor({ kind: "section" })).toContain("截面")
  })

  it("explains the Alt modifier that makes template faces individually selectable", () => {
    const text = guidanceFor({ kind: "selectSolid" })

    expect(text).toContain("Alt")
    expect(text).toContain("面")
  })

  it("keeps every hint short enough for a corner overlay", () => {
    const actions: GuidanceAction[] = [
      { kind: "point", workspace: "conics" },
      { kind: "point", workspace: "geometry3d" },
      { kind: "creation", mode: "line" },
      { kind: "creation", mode: "segment" },
      { kind: "creation", mode: "ray" },
      { kind: "creation", mode: "polyline" },
      { kind: "creation", mode: "circle" },
      { kind: "creation", mode: "arc" },
      { kind: "conic", type: "parabola" },
      { kind: "conic", type: "ellipse" },
      { kind: "conic", type: "hyperbola" },
      { kind: "function" },
      { kind: "functionAnalysis", analysis: "derivative" },
      { kind: "functionAnalysis", analysis: "tangent" },
      { kind: "functionAnalysis", analysis: "integral" },
      { kind: "solid", solid: "cube" },
      { kind: "solid", solid: "pyramid" },
      { kind: "solid", solid: "cylinder" },
      { kind: "solid", solid: "cone" },
      { kind: "section" },
      { kind: "selectSolid" },
      { kind: "measurement", metric: "length", outcome: "created" },
      { kind: "measurement", metric: "distance", outcome: "created" },
      { kind: "measurement", metric: "angle", outcome: "created" },
      { kind: "measurement", metric: "area", outcome: "created" },
      { kind: "measurement", metric: "volume", outcome: "created" },
      { kind: "measurement", metric: "dihedral", dihedralKind: "interior", outcome: "created" },
      { kind: "measurement", metric: "dihedral", dihedralKind: "exterior", outcome: "created" },
      { kind: "measurement", metric: "length", outcome: "blocked" },
      { kind: "measurement", metric: "distance", outcome: "blocked" },
      { kind: "measurement", metric: "angle", outcome: "blocked" },
      { kind: "measurement", metric: "area", outcome: "blocked" },
      { kind: "measurement", metric: "volume", outcome: "blocked" },
      { kind: "measurement", metric: "dihedral", outcome: "blocked" },
      { kind: "constraint", type: "parallel" },
      { kind: "constraint", type: "perpendicular" },
      { kind: "constraint", type: "pointOnLine" },
      { kind: "constraint", type: "pointOnPlane" },
      { kind: "constraint", type: "collinear" },
      { kind: "constraint", type: "coplanar" },
      { kind: "constraint", type: "coincident" },
      { kind: "constraint", type: "fixedDistance" },
      { kind: "point3Tool", tool: "line", outcome: "created" },
      { kind: "point3Tool", tool: "plane", outcome: "created" },
      { kind: "point3Tool", tool: "face", outcome: "created" },
      { kind: "point3Tool", tool: "line", outcome: "blocked", point3Count: 0 },
      { kind: "point3Tool", tool: "plane", outcome: "blocked", point3Count: 0 },
      { kind: "point3Tool", tool: "face", outcome: "blocked", point3Count: 0 }
    ]

    for (const action of actions) {
      const text = guidanceFor(action)
      expect(text.length, `${action.kind} 指引过长：${text}`).toBeLessThanOrEqual(MAX_HINT_LENGTH)
      expect(text.trim()).toBe(text)
    }
  })
})
