import { describe, expect, it } from "vitest"

import type { Coordinate } from "@draw/dsl"

import { derivedCircleNode, triangleCircleNodes, type DerivedCircle } from "./derivedCircles"
import { derivedNode, parameterNode, sourceNode } from "./evaluator"
import { createReactiveGraph } from "./graph"
import { triangleCenter, triangleCenter2, triangleCenterNode, triangleRadius, triangleRadius2, triangleRadiusNode, type TriangleCenterKind } from "./triangleCenters"

/**
 * **五心与圆**（设计规格 §4.3）。
 *
 * 规格原文：
 *
 * ```text
 * G = (A+B+C)/3
 * I = (aA+bB+cC)/(a+b+c)
 * r_in = 2*area/(a+b+c)
 * H = A+B+C-2O
 * ```
 *
 * 外心在三角形**自身二维基底**里解垂直平分线，因此三角形躺在一个斜平面上也必须算对。
 * 所有中心、半径和圆都是 DAG 下游节点：源点一动，它们按拓扑序重算。
 *
 * 退化（三点共线）必须如实返回 `degenerate` —— 共线三角形没有外心 / 内心 / 垂心，
 * 硬套公式只会得到一个看起来像答案的点。
 */

/** 直角三角形 A(0,0) B(4,0) C(0,3)：直角在 A，边长 a=5、b=3、c=4，面积 6。 */

const expectExact = <Value>(result: { status: string; value?: Value }): Value => {
  expect(result.status).toBe("exact")
  return result.value as Value
}

const distance = (first: Coordinate, second: Coordinate): number => Math.hypot(first.x - second.x, first.y - second.y)

/** 点到直线的距离：用来独立验证"内心到三边等距"（不复用被测实现的任何中间量）。 */
const distanceToLine = (point: Coordinate, first: Coordinate, second: Coordinate): number =>
  Math.abs((second.x - first.x) * (first.y - point.y) - (first.x - point.x) * (second.y - first.y)) / distance(first, second)

describe("triangle centers", () => {
  it("computes the five centers of a right triangle from the closed-form formulas", () => {
    expect(expectExact(triangleCenter2("centroid", { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }))).toMatchObject({ x: 4 / 3, y: 1 })
    // I = (aA + bB + cC)/(a+b+c) = (3B + 4C)/12 = (1, 1)
    expect(expectExact(triangleCenter2("incenter", { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }))).toMatchObject({ x: 1, y: 1 })
    // 直角三角形的外心是斜边中点 (2, 1.5)。
    expect(expectExact(triangleCenter2("circumcenter", { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }))).toMatchObject({ x: 2, y: 1.5 })
    // H = A + B + C − 2O = (4,3) − (4,3) = (0,0)：直角顶点就是垂心。
    expect(expectExact(triangleCenter2("orthocenter", { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }))).toMatchObject({ x: 0, y: 0 })
    // 旁心：A 旁心 (6,6)、B 旁心 (−2,2)、C 旁心 (3,−3)。
    expect(expectExact(triangleCenter2("excenter", { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }, { excenterVertex: 0 }))).toMatchObject({ x: 6, y: 6 })
    expect(expectExact(triangleCenter2("excenter", { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }, { excenterVertex: 1 }))).toMatchObject({ x: -2, y: 2 })
    expect(expectExact(triangleCenter2("excenter", { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }, { excenterVertex: 2 }))).toMatchObject({ x: 3, y: -3 })
  })

  it("computes the inradius, circumradius and exradius", () => {
    // r = 2*area/(a+b+c) = 12/12 = 1；R = abc/(4*area) = 5*3*4/24 = 2.5；r_A = area/(s−a) = 6.
    expect(expectExact(triangleRadius2("inradius", { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }))).toBeCloseTo(1, 12)
    expect(expectExact(triangleRadius2("circumradius", { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }))).toBeCloseTo(2.5, 12)
    expect(expectExact(triangleRadius2("exradius", { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }, { excenterVertex: 0 }))).toBeCloseTo(6, 12)
  })

  it("solves centers of a triangle lying in a tilted plane", () => {
    // 平面 z = x 上的三角形：a=(0,0,0)、b=(4,0,4)、c=(0,3,0)。
    const a = { x: 0, y: 0, z: 0 }
    const b = { x: 4, y: 0, z: 4 }
    const c = { x: 0, y: 3, z: 0 }
    const triangle = { a, b, c }
    const centroid = expectExact(triangleCenter("centroid", triangle))
    expect(centroid.x).toBeCloseTo(4 / 3, 12)
    expect(centroid.y).toBeCloseTo(1, 12)
    expect(centroid.z).toBeCloseTo(4 / 3, 12)

    // 外心到三个顶点等距（这就是"外心"的定义，且与基底选择无关）。
    const circumcenter = expectExact(triangleCenter("circumcenter", triangle))
    const radius = Math.hypot(circumcenter.x - a.x, circumcenter.y - a.y, circumcenter.z - a.z)
    for (const vertex of [b, c]) expect(Math.hypot(circumcenter.x - vertex.x, circumcenter.y - vertex.y, circumcenter.z - vertex.z)).toBeCloseTo(radius, 10)

    // 内心到三条边等距（同样是定义本身）。
    const incenter = expectExact(triangleCenter("incenter", triangle))
    const planeDistance = (point: { x: number; y: number; z: number }, first: typeof a, second: typeof a): number => {
      const ux = second.x - first.x, uy = second.y - first.y, uz = second.z - first.z
      const px = point.x - first.x, py = point.y - first.y, pz = point.z - first.z
      const cross = { x: uy * pz - uz * py, y: uz * px - ux * pz, z: ux * py - uy * px }
      return Math.hypot(cross.x, cross.y, cross.z) / Math.hypot(ux, uy, uz)
    }
    const distances = [planeDistance(incenter, a, b), planeDistance(incenter, b, c), planeDistance(incenter, c, a)]
    expect(distances[1]).toBeCloseTo(distances[0], 10)
    expect(distances[2]).toBeCloseTo(distances[0], 10)

    // 垂心：H = A + B + C − 2O。
    const orthocenter = expectExact(triangleCenter("orthocenter", triangle))
    expect(orthocenter.x).toBeCloseTo(a.x + b.x + c.x - 2 * circumcenter.x, 10)
    expect(orthocenter.y).toBeCloseTo(a.y + b.y + c.y - 2 * circumcenter.y, 10)
    expect(orthocenter.z).toBeCloseTo(a.z + b.z + c.z - 2 * circumcenter.z, 10)
  })

  it("reports collinear input as degenerate instead of inventing a center", () => {
    const collinear = { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 }, c: { x: 3, y: 0, z: 0 } }
    const degenerateKinds: TriangleCenterKind[] = ["incenter", "circumcenter", "orthocenter", "excenter"]
    for (const kind of degenerateKinds) expect(triangleCenter(kind, collinear)).toMatchObject({ status: "degenerate" })
    // 半径同样没有定义。
    expect(triangleRadius("inradius", collinear)).toMatchObject({ status: "degenerate" })
    expect(triangleRadius("circumradius", collinear)).toMatchObject({ status: "degenerate" })
    // 形心是三点平均，对共线点依然良定义 —— 这是有意保留的例外，不是漏判。
    expect(expectExact(triangleCenter("centroid", collinear)).x).toBeCloseTo(4 / 3, 12)
    // 非有限输入一律 `undefined`（缺数据），而不是退化。
    expect(triangleCenter("centroid", { a: { x: Number.NaN, y: 0, z: 0 }, b: collinear.b, c: collinear.c })).toMatchObject({ status: "undefined" })
  })

  it("recomputes every downstream center when a source point moves", () => {
    const graph = createReactiveGraph()
    const freePoint = (id: string, xId: string, yId: string) =>
      derivedNode(id, [xId, yId], (inputs) => {
        const read = (key: string) => {
          const result = inputs.get(key)
          return result && (result.status === "exact" || result.status === "approximate") ? Number(result.value) : Number.NaN
        }
        return { status: "exact" as const, value: { x: read(xId), y: read(yId) } }
      })
    for (const [id, value] of [["ax", 0], ["ay", 0], ["bx", 4], ["by", 0], ["cx", 0], ["cy", 3]] as const) {
      graph.addNode(parameterNode(id, value))
    }
    // 每个点由它的两个坐标参数驱动（与动点"参数是真值、坐标是派生"是同一条路子）。
    graph.addNode(freePoint("A", "ax", "ay"))
    graph.addNode(freePoint("B", "bx", "by"))
    graph.addNode(freePoint("C", "cx", "cy"))
    graph.addNode(triangleCenterNode("incenter", { kind: "incenter", pointIds: ["A", "B", "C"] }))
    graph.addNode(triangleRadiusNode("inradius", { metric: "inradius", pointIds: ["A", "B", "C"] }))
    graph.evaluate()
    expect(graph.value("incenter")).toMatchObject({ x: 1, y: 1 })
    expect(graph.value("inradius")).toBeCloseTo(1, 12)

    // 把 C 抬到 (0,6)：内心与内切半径都必须跟着变（面积 12、周长 6+4+2√13）。
    graph.setParameter("cy", 6)
    const report = graph.evaluate(["cy"])
    expect(report.evaluated).toContain("incenter")
    expect(report.evaluated).toContain("inradius")
    const expectedPerimeter = 6 + 4 + 2 * Math.sqrt(13)
    expect(graph.value("inradius")).toBeCloseTo(24 / expectedPerimeter, 10)
    const incenter = graph.value("incenter") as Coordinate
    const c = { x: 0, y: 6 }
    expect(distanceToLine(incenter, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeCloseTo(distanceToLine(incenter, c, { x: 0, y: 0 }), 10)
    expect(distanceToLine(incenter, { x: 4, y: 0 }, c)).toBeCloseTo(distanceToLine(incenter, c, { x: 0, y: 0 }), 10)
  })
})

describe("derived circles", () => {
  const circleOf = (graph: ReturnType<typeof createReactiveGraph>, id: string): DerivedCircle => graph.value(id) as DerivedCircle

  it("registers an incircle as a chain of center, radius and circle nodes", () => {
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("A", { x: 0, y: 0 }))
    graph.addNode(sourceNode("B", { x: 4, y: 0 }))
    graph.addNode(sourceNode("C", { x: 0, y: 3 }))
    const nodes = triangleCircleNodes("incircle", { metric: "incircle", pointIds: ["A", "B", "C"] })
    graph.addNode(nodes.center)
    graph.addNode(nodes.radius)
    graph.addNode(nodes.circle)
    graph.evaluate()

    // 圆引用"圆心节点 + 半径节点"，两者又引用同一个三角形的顶点节点 —— 依赖链是真的，不是各算一遍。
    expect(nodes.circle.dependsOn).toEqual(["incircle:center", "incircle:radius"])
    expect(nodes.radius.dependsOn).toEqual(["A", "B", "C"])
    expect(circleOf(graph, "incircle")).toMatchObject({ center: { x: 1, y: 1 }, radius: 1, kind: "incircle" })
  })

  it("moves a derived circle when the triangle changes", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("cx", 0))
    graph.addNode(parameterNode("cy", 3))
    graph.addNode(sourceNode("A", { x: 0, y: 0 }))
    graph.addNode(sourceNode("B", { x: 4, y: 0 }))
    graph.addNode(derivedNode("C", ["cx", "cy"], (inputs) => {
      const read = (id: string) => Number((inputs.get(id) as { value: number }).value)
      return { status: "exact" as const, value: { x: read("cx"), y: read("cy") } }
    }))
    const nodes = triangleCircleNodes("circumcircle", { metric: "circumcircle", pointIds: ["A", "B", "C"] })
    graph.addNode(nodes.center)
    graph.addNode(nodes.radius)
    graph.addNode(nodes.circle)
    graph.evaluate()
    expect(circleOf(graph, "circumcircle")).toMatchObject({ center: { x: 2, y: 1.5 }, radius: 2.5 })

    graph.setParameter("cy", 4)
    const report = graph.evaluate(["cy"])
    expect(report.evaluated).toEqual(expect.arrayContaining(["C", "circumcircle:center", "circumcircle:radius", "circumcircle"]))
    // 外接圆永远过三个顶点。
    const circle = circleOf(graph, "circumcircle")
    for (const vertex of [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 4 }]) expect(distance(circle.center, vertex)).toBeCloseTo(circle.radius, 10)
  })

  it("can wrap one explicit center and radius pair into a circle node", () => {
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("center", { x: 1, y: 2 }))
    graph.addNode(sourceNode("radius", 3))
    graph.addNode(derivedCircleNode("circle", { centerId: "center", radiusId: "radius" }))
    graph.evaluate()
    expect(circleOf(graph, "circle")).toMatchObject({ center: { x: 1, y: 2 }, radius: 3 })
  })

  it("reports a degenerate triangle as a diagnostic instead of a circle", () => {
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("A", { x: 0, y: 0 }))
    graph.addNode(sourceNode("B", { x: 1, y: 0 }))
    graph.addNode(sourceNode("C", { x: 3, y: 0 }))
    const nodes = triangleCircleNodes("incircle", { metric: "incircle", pointIds: ["A", "B", "C"] })
    graph.addNode(nodes.center)
    graph.addNode(nodes.radius)
    graph.addNode(nodes.circle)
    const report = graph.evaluate()
    expect(report.diagnostics.map((diagnostic) => `${diagnostic.nodeId}:${diagnostic.code}`)).toEqual(expect.arrayContaining(["incircle:center:degenerate"]))
    expect(graph.value("incircle")).toBeUndefined()
  })

  it("rejects a non-finite radius instead of drawing a broken circle", () => {
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("center", { x: 0, y: 0 }))
    graph.addNode(sourceNode("radius", Number.POSITIVE_INFINITY))
    graph.addNode(derivedCircleNode("circle", { centerId: "center", radiusId: "radius" }))
    const report = graph.evaluate()
    expect(report.diagnostics.map((diagnostic) => `${diagnostic.nodeId}:${diagnostic.code}`)).toEqual(expect.arrayContaining(["radius:non_finite", "circle:missing_source"]))
    expect(graph.value("circle")).toBeUndefined()
  })
})
