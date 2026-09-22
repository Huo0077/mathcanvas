import { describe, expect, it } from "vitest"

import type { Coordinate } from "@draw/dsl"

import { circleConstraint } from "../planar-constraints"
import { measurementEdgeNode, planarMeasurementNode, solidSectionNode, tangentAtPointNode, tangentNode, type SectionValue, type TangentValue } from "./derivedNodes"
import { createTransientTrace, locusNode, sampleLocusFromGraph } from "./locus"
import { derivedNode, parameterNode, sourceNode } from "./evaluator"
import { createReactiveGraph } from "./graph"
import type { EvaluationResult } from "./types"

/**
 * **派生节点**（设计规格 §4.2/§4.4）：切线、截面、测量与轨迹。
 *
 * 规格把它们都算作 DAG 下游节点：
 *
 * ```text
 * 参数变化 -> 反向依赖闭包 -> 拓扑排序 -> 纯 evaluator -> 临时场景预览 -> 抬手后一次性提交
 * ```
 *
 * 三条要点：
 * 1. 切线的**切点参数**是唯一真值（圆上参数 θ 的切线垂直于半径，这条性质与实现无关，用例直接钉它）；
 * 2. 截面由"实体拓扑 + 平面"算出，平面一动截面跟着重算；平面离开实体时如实报 `none`，
 *    但绝不能留下上一圈的旧环；
 * 3. 轨迹是**自适应采样**：`sampleLocusFromGraph` 只驱动一个参数节点，靠图的增量求值取点；
 *    交互中的 Trace 只活在内存里，**不写文档、不进撤销历史**（规格 §4.4）。
 */

describe("tangent nodes", () => {
  it("keeps the tangent perpendicular to the radius while the parameter moves", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("theta", 0))
    graph.addNode(sourceNode("circle-1", { x: 0, y: 0 }))
    graph.addNode(tangentNode("tangent", { constraint: circleConstraint("circle-1", { x: 0, y: 0 }, 2), parameterId: "theta", hostIds: ["circle-1"] }))
    graph.evaluate()

    for (const theta of [0, Math.PI / 3, Math.PI, 4.5]) {
      graph.setParameter("theta", theta)
      graph.evaluate(["theta"])
      const tangent = graph.value("tangent") as TangentValue
      const radius = { x: tangent.point.x - 0, y: tangent.point.y - 0 }
      // 垂直：半径 · 切向 = 0。
      expect(radius.x * tangent.direction.x + radius.y * tangent.direction.y).toBeCloseTo(0, 10)
      // 切点严格在圆上（参数是唯一真值，坐标由它算出来）。
      expect(Math.hypot(radius.x, radius.y)).toBeCloseTo(2, 12)
      // 切线段中点就是切点。
      expect((tangent.a.x + tangent.b.x) / 2).toBeCloseTo(tangent.point.x, 12)
    }
  })

  it("takes the tangent where a dynamic point sits, not where the parameter says", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("theta", Math.PI / 2))
    graph.addNode(derivedNode("P", ["theta"], (inputs) => {
      const angle = Number((inputs.get("theta") as { value: number }).value)
      return { status: "exact" as const, value: { point: { x: 2 * Math.cos(angle), y: 2 * Math.sin(angle) } } }
    }))
    graph.addNode(tangentAtPointNode("tangent", { constraint: circleConstraint("circle-1", { x: 0, y: 0 }, 2), pointId: "P" }))
    graph.evaluate()
    const tangent = graph.value("tangent") as TangentValue
    expect(tangent.point.x).toBeCloseTo(0, 10)
    expect(tangent.point.y).toBeCloseTo(2, 10)
    // 在 (0,2) 处圆的切线是水平的。
    expect(Math.abs(tangent.direction.y)).toBeLessThan(1e-9)
  })

  it("reports a missing host as a diagnostic instead of a tangent", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("theta", 0))
    graph.addNode(tangentNode("tangent", { constraint: null, parameterId: "theta" }))
    const report = graph.evaluate()
    expect(report.diagnostics.map((diagnostic) => `${diagnostic.nodeId}:${diagnostic.code}`)).toContain("tangent:invalid_host")
    expect(graph.value("tangent")).toBeUndefined()
  })

  /**
   * 非有限的切点参数是 `non_finite`，不是退化（评审 M1）。
   *
   * 走图时这一支摸不到（产生非有限值的节点会先被 `runEvaluator` 的护栏拦下），所以这里直接
   * 调节点的 evaluator 喂一个"已解析但非有限"的输入 —— 这才是护栏本身该守的形状。
   */
  it("reports a non-finite tangent parameter as non_finite, not degenerate", () => {
    const node = tangentNode("tangent", { constraint: circleConstraint("circle-1", { x: 0, y: 0 }, 2), parameterId: "theta" })
    const inputs = new Map<string, EvaluationResult<unknown>>([["theta", { status: "exact", value: Number.NaN }]])
    expect(node.evaluate(inputs)).toMatchObject({ status: "undefined", diagnostic: { code: "non_finite", nodeId: "tangent" } })
  })
})

describe("solid section nodes", () => {
  const cube = {
    vertices: [
      { x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 }, { x: 1, y: 1, z: -1 }, { x: -1, y: 1, z: -1 },
      { x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 }, { x: 1, y: 1, z: 1 }, { x: -1, y: 1, z: 1 }
    ],
    faces: [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
  }

  function graphWithSection(offsetId: string, offset: number) {
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("cube-1", cube))
    graph.addNode(parameterNode(offsetId, offset))
    graph.addNode(derivedNode("plane", [offsetId], (inputs) => ({ status: "exact" as const, value: { normal: { x: 0, y: 0, z: 1 }, constant: -Number((inputs.get(offsetId) as { value: number }).value) } })))
    graph.addNode(solidSectionNode("section", { solidId: "cube-1", planeId: "plane" }))
    return graph
  }

  it("cuts a square section through the middle of a cube", () => {
    const graph = graphWithSection("z", 0)
    graph.evaluate()
    const section = graph.value("section") as SectionValue
    expect(section.classification).toBe("polygon")
    expect(section.points).toHaveLength(4)
    for (const point of section.points) expect(point.z).toBeCloseTo(0, 12)
  })

  it("refreshes the section when the cutting plane moves", () => {
    const graph = graphWithSection("z", 0)
    graph.evaluate()
    graph.setParameter("z", 0.5)
    const report = graph.evaluate(["z"])
    expect(report.evaluated).toEqual(expect.arrayContaining(["plane", "section"]))
    const section = graph.value("section") as SectionValue
    expect(section.points.every((point) => Math.abs(point.z - 0.5) < 1e-9)).toBe(true)
  })

  it("reports an empty cut as none instead of leaving the previous ring", () => {
    const graph = graphWithSection("z", 0)
    graph.evaluate()
    graph.setParameter("z", 5)
    const report = graph.evaluate(["z"])
    expect(report.evaluated).toContain("section")
    // 规格 §3.4 要求 none/point/segment/polygon 可区分：空截面是**合法结果**，不是错误。
    // 关键是它不能被上一圈的四点环顶替（那正是"用旧缓存伪装正常结果"）。
    const section = graph.value("section") as SectionValue
    expect(section.classification).toBe("none")
    expect(section.points).toEqual([])
    expect(report.diagnostics).toEqual([])
  })
})

describe("measurement nodes", () => {
  it("recomputes a distance only when one of its endpoints changes", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("bx", 4))
    graph.addNode(sourceNode("A", { x: 0, y: 0 }))
    graph.addNode(derivedNode("B", ["bx"], (inputs) => ({ status: "exact" as const, value: { x: Number((inputs.get("bx") as { value: number }).value), y: 0 } })))
    graph.addNode(sourceNode("C", { x: 0, y: 30 }))
    graph.addNode(planarMeasurementNode("ab", { metric: "distance", pointIds: ["A", "B"] }))
    graph.addNode(planarMeasurementNode("ac", { metric: "distance", pointIds: ["A", "C"] }))
    graph.evaluate()
    expect(graph.value("ab")).toBeCloseTo(4, 12)

    graph.setParameter("bx", 10)
    const report = graph.evaluate(["bx"])
    // 只有与 B 有关的那条测量被重算：这正是"一次参数变化只重算下游闭包"。
    expect(report.evaluated).toEqual(expect.arrayContaining(["B", "ab"]))
    expect(report.evaluated).not.toContain("ac")
    expect(graph.value("ab")).toBeCloseTo(10, 12)
    expect(graph.value("ac")).toBeCloseTo(30, 12)
  })

  it("measures angles, areas and perimeters from the same point set", () => {
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("A", { x: 0, y: 0 }))
    graph.addNode(sourceNode("B", { x: 4, y: 0 }))
    graph.addNode(sourceNode("C", { x: 0, y: 3 }))
    // 约定：`pointIds` 的**中间那个点是顶点**（∠ABC 的 B 在中间）。
    graph.addNode(planarMeasurementNode("angle-a", { metric: "angle", pointIds: ["B", "A", "C"] }))
    graph.addNode(planarMeasurementNode("angle-b", { metric: "angle", pointIds: ["A", "B", "C"] }))
    graph.addNode(planarMeasurementNode("area", { metric: "area", pointIds: ["A", "B", "C"] }))
    graph.addNode(planarMeasurementNode("perimeter", { metric: "perimeter", pointIds: ["A", "B", "C"] }))
    graph.evaluate()
    expect(graph.value("angle-a")).toBeCloseTo(Math.PI / 2, 12)
    expect(graph.value("angle-b")).toBeCloseTo(Math.atan2(3, 4), 12)
    expect(graph.value("area")).toBeCloseTo(6, 12)
    expect(graph.value("perimeter")).toBeCloseTo(12, 12)
  })

  it("reports a degenerate measurement (collinear area / missing source)", () => {
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("A", { x: 0, y: 0 }))
    graph.addNode(sourceNode("B", { x: 1, y: 0 }))
    graph.addNode(sourceNode("C", { x: 2, y: 0 }))
    graph.addNode(planarMeasurementNode("area", { metric: "area", pointIds: ["A", "B", "C"] }))
    graph.addNode(planarMeasurementNode("broken", { metric: "distance", pointIds: ["A", "ghost"] }))
    const report = graph.evaluate()
    expect(report.diagnostics.map((diagnostic) => `${diagnostic.nodeId}:${diagnostic.code}`)).toEqual(expect.arrayContaining(["area:degenerate", "broken:missing_source"]))
    expect(graph.value("area")).toBeUndefined()
  })

  it("measures the distance from a point to a line", () => {
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("P", { x: 0, y: 5 }))
    graph.addNode(sourceNode("line", { a: { x: -1, y: 0 }, b: { x: 1, y: 0 } }))
    graph.addNode(measurementEdgeNode("height", { metric: "distanceToLine", pointIds: ["P"], lineId: "line" }))
    graph.evaluate()
    expect(graph.value("height")).toBeCloseTo(5, 12)
  })

  /**
   * 上一条用例里 `broken` 的 `missing_source` 其实由**图**的"声明依赖不在图里"分支产生，
   * 测量节点自己的"来源没有可用坐标"分支从没被执行过（评审 M9）。
   * 这一条把来源节点**注册上**、但给它一个没有坐标的值，逼测量节点自己报错。
   */
  it("reports missing_source from the measurement node itself when a source holds no coordinate", () => {
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("A", { x: 0, y: 0 }))
    graph.addNode(sourceNode("B", null))
    graph.addNode(planarMeasurementNode("ab", { metric: "distance", pointIds: ["A", "B"] }))
    const report = graph.evaluate()
    expect(report.diagnostics.map((diagnostic) => `${diagnostic.nodeId}:${diagnostic.code}`)).toContain("ab:missing_source")
    expect(graph.result("ab")).toMatchObject({ diagnostic: { upstream: "B", message: expect.stringContaining("没有可用的坐标") } })
    expect(graph.value("ab")).toBeUndefined()
  })
})

describe("locus sampling over the graph", () => {
  /** 动点 P 在圆上，参数 θ 是唯一真值。 */
  function circleGraph() {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("theta", 0))
    graph.addNode(sourceNode("circle-1", { x: 1, y: 0 }))
    graph.addNode(derivedNode("P", ["theta", "circle-1"], (inputs) => {
      const angle = Number((inputs.get("theta") as { value: number }).value)
      return { status: "exact" as const, value: { point: { x: 1 + 2 * Math.cos(angle), y: 2 * Math.sin(angle) }, parameter: angle, branch: 0, clamped: false } }
    }))
    return graph
  }

  it("subdivides adaptively and leaves the parameter where it found it", () => {
    const graph = circleGraph()
    graph.evaluate()
    const result = sampleLocusFromGraph({ graph, pointId: "P", parameterId: "theta", domain: [0, Math.PI * 2], samples: 24, tolerance: 0.01 })
    expect(result.branches.length).toBeGreaterThan(0)
    const points = result.branches.flatMap((branch) => branch)
    expect(points.length).toBeGreaterThanOrEqual(24)
    // 每一个采样点都在圆上：轨迹是**算出来**的，不是把拖动路径录下来。
    for (const point of points) expect(Math.hypot(point.x - 1, point.y)).toBeCloseTo(2, 6)
    // 采样结束后参数回到原处（预览不能顺手改真值）。
    expect(graph.parameterValue("theta")).toBe(0)

    // 自适应：曲率半径恒定的圆不需要每个区间都二分到底，采样预算必须远小于上限。
    expect(result.evaluations).toBeLessThan(24 * 8)
  })

  it("keeps a locus node in the graph only when its samples are valid", () => {
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("samples", { branches: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] }))
    graph.addNode(locusNode("locus-1", { samplesId: "samples" }))
    graph.evaluate()
    expect(graph.value("locus-1")).toEqual([[{ x: 0, y: 0 }, { x: 1, y: 1 }]])

    // 采不到点（动点在轨道上没有定义）：轨迹为空是**退化**，不是"零条线所以画没有"。
    graph.setSource("samples", { branches: [] })
    graph.evaluate(["samples"])
    expect(graph.result("locus-1")).toMatchObject({ status: "degenerate" })

    graph.setSource("samples", { branches: [[{ x: 0, y: 0 }]] })
    graph.evaluate(["samples"])
    expect(graph.result("locus-1")).toMatchObject({ status: "degenerate" })
    expect(graph.value("locus-1")).toBeUndefined()
  })

  it("records a transient trace in memory without touching the document or history", () => {
    const trace = createTransientTrace({ maxPoints: 3 })
    const record = (coordinate: Coordinate) => trace.record(coordinate)
    for (const point of [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: -1 }]) record(point)
    // 只保留最近 maxPoints 个点：交互轨迹是"就地滚动"的缓冲区。
    expect(trace.points).toEqual([{ x: 1, y: 1 }, { x: 2, y: 0 }, { x: 3, y: -1 }])
    trace.clear()
    expect(trace.points).toEqual([])
  })
})
