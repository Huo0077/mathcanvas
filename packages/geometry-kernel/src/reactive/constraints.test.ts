import { describe, expect, it } from "vitest"

import { circleHost3, faceHost3, lineHost3, solidVolumeHost3 } from "../hosts3"
import { circleConstraint, lineConstraint, segmentConstraint } from "../planar-constraints"
import { generatedHostParameter, generatedParameterId, hostPointNode, normalizeHostParameter, planarPointNode, type ConstrainedPoint2, type ConstrainedPoint3 } from "./constraints"
import { parameterNode, sourceNode } from "./evaluator"
import { createReactiveGraph } from "./graph"

/**
 * **参数化点约束**（设计规格 §4.1/§4.2）。
 *
 * 规格把动点的真值定成"参数 + 绑定"，坐标只是派生缓存：
 *
 * ```text
 * point = constraint.evaluate(parameter, branch)
 * ```
 *
 * 这组用例钉住四件事：
 * 1. 线段 / 直线 / 圆上的**一维参数**都走同一条求值路径（自然参数各不相同，不归一化）；
 * 2. 圆与闭合宿主的参数**折回**声明域、线段与面的参数**夹回**边界，并如实报告 `clamped`；
 * 3. 宿主解析不了（`null`）时报 `invalid_host`，参数非有限时报诊断 —— 绝不产出 NaN 或 (0,0)；
 * 4. 生成出来的驱动参数带 `ownerId`（归属点），宿主消失后由删除计划回收。
 */

const codesOf = (report: { diagnostics: readonly { code: string; nodeId: string }[] }): string[] =>
  report.diagnostics.map((diagnostic) => `${diagnostic.nodeId}:${diagnostic.code}`)

function planarPoint(graph: ReturnType<typeof createReactiveGraph>, id: string): ConstrainedPoint2 {
  return graph.value(id) as ConstrainedPoint2
}

function hostPoint(graph: ReturnType<typeof createReactiveGraph>, id: string): ConstrainedPoint3 {
  return graph.value(id) as ConstrainedPoint3
}

describe("parameterized point constraints", () => {
  it("maps a segment parameter to a point and clamps it into the segment domain", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("t", 0.5))
    graph.addNode(planarPointNode("p", { constraint: segmentConstraint("seg-1", { x: 0, y: 0 }, { x: 4, y: 0 }), parameterId: "t" }))
    graph.evaluate()

    expect(planarPoint(graph, "p")).toMatchObject({ point: { x: 2, y: 0 }, parameter: 0.5, clamped: false })

    // 线段域是 [0,1]：参数 3 被夹到端点，并把"被截断"如实报出来（而不是把点扔到线段之外）。
    graph.setParameter("t", 3)
    graph.evaluate(["t"])
    expect(planarPoint(graph, "p")).toMatchObject({ point: { x: 4, y: 0 }, parameter: 1, clamped: true })
  })

  it("keeps a line parameter unbounded", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("t", 5))
    graph.addNode(planarPointNode("p", { constraint: lineConstraint("line-1", { x: 0, y: 0 }, { x: 1, y: 1 }), parameterId: "t" }))
    graph.evaluate()
    // 直线的 t 是仿射比例、**不截断**：夹到 [0,1] 会把点锁在画出来的那一小段里（实测缺陷）。
    expect(planarPoint(graph, "p")).toMatchObject({ point: { x: 5, y: 5 }, parameter: 5, clamped: false })
  })

  it("treats a circle parameter as an angle and wraps it into one turn", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("t", Math.PI * 2 + Math.PI / 2))
    graph.addNode(planarPointNode("p", { constraint: circleConstraint("circle-1", { x: 0, y: 0 }, 2), parameterId: "t" }))
    graph.evaluate()
    const value = planarPoint(graph, "p")
    expect(value.parameter).toBeCloseTo(Math.PI / 2, 12)
    expect(value.clamped).toBe(false)
    expect(value.point.x).toBeCloseTo(0, 12)
    expect(value.point.y).toBeCloseTo(2, 12)
  })

  it("reports an unusable host as invalid_host instead of a coordinate", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("t", 0.5))
    graph.addNode(planarPointNode("p", { constraint: null, parameterId: "t" }))
    const report = graph.evaluate()
    expect(codesOf(report)).toContain("p:invalid_host")
    expect(graph.value("p")).toBeUndefined()
  })

  it("never turns a non-finite parameter into a coordinate", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("t", Number.NaN))
    graph.addNode(planarPointNode("p", { constraint: segmentConstraint("seg-1", { x: 0, y: 0 }, { x: 4, y: 0 }), parameterId: "t" }))
    const report = graph.evaluate()
    expect(codesOf(report)).toContain("t:non_finite")
    // 下游没有可用的参数：一条诊断，而不是 (0,0) 或 NaN 坐标。
    expect(codesOf(report)).toContain("p:missing_source")
    expect(graph.value("p")).toBeUndefined()
  })

  it("maps two parameters onto a face and clamps them into the face ring", () => {
    const face = faceHost3([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }])
    expect(face).not.toBeNull()
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("u", 1))
    graph.addNode(parameterNode("v", 3))
    // 宿主本身也是一个节点（图元）：它变了，绑在它上面的点必须跟着失效。
    graph.addNode(sourceNode("face-1", face))
    graph.addNode(hostPointNode("q", { host: face, parameterIds: ["u", "v"], hostIds: ["face-1"] }))
    graph.evaluate()
    expect(hostPoint(graph, "q").point).toEqual({ x: 1, y: 3, z: 0 })

    graph.setParameter("u", 9)
    graph.evaluate(["u"])
    const clamped = hostPoint(graph, "q")
    expect(clamped.parameter.u).toBe(4)
    expect(clamped.clamped).toBe(true)
    expect(clamped.point).toEqual({ x: 4, y: 3, z: 0 })
  })

  it("maps three parameters into a solid volume and clamps them into the box", () => {
    const cube = {
      vertices: [
        { x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 },
        { x: 0, y: 0, z: 4 }, { x: 4, y: 0, z: 4 }, { x: 4, y: 4, z: 4 }, { x: 0, y: 4, z: 4 }
      ],
      faces: [
        [0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]
      ]
    }
    const host = solidVolumeHost3(cube.vertices, cube.faces)
    expect(host).not.toBeNull()
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("u", 0.5))
    graph.addNode(parameterNode("v", 0.5))
    graph.addNode(parameterNode("w", 0.5))
    graph.addNode(sourceNode("cube-1", host))
    graph.addNode(hostPointNode("inside", { host, parameterIds: ["u", "v", "w"], hostIds: ["cube-1"] }))
    graph.evaluate()
    expect(hostPoint(graph, "inside").point).toEqual({ x: 2, y: 2, z: 2 })

    graph.setParameter("w", 2)
    graph.evaluate(["w"])
    expect(hostPoint(graph, "inside")).toMatchObject({ parameter: { u: 0.5, v: 0.5, w: 1 }, clamped: true })
  })

  it("wraps the parameter of a closed (circular) host back into its domain", () => {
    const orbit = circleHost3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2)
    expect(orbit).not.toBeNull()
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("angle", Math.PI / 2 + Math.PI * 4))
    graph.addNode(sourceNode("circle3-1", orbit))
    graph.addNode(hostPointNode("track", { host: orbit, parameterIds: ["angle"], hostIds: ["circle3-1"] }))
    graph.evaluate()
    const value = hostPoint(graph, "track")
    expect(value.parameter.u).toBeCloseTo(Math.PI / 2, 12)
    expect(value.clamped).toBe(false)
  })

  it("reports an unusable spatial host as invalid_host", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("u", 0.5))
    graph.addNode(hostPointNode("q", { host: null, parameterIds: ["u"] }))
    const report = graph.evaluate()
    expect(codesOf(report)).toContain("q:invalid_host")
    expect(graph.value("q")).toBeUndefined()
  })

  it("declares generated driver parameters as owned by the point that uses them", () => {
    expect(generatedParameterId("point-7")).toBe("t-point-7")
    const spec = generatedHostParameter({ pointId: "point-7", value: 1.5, min: 0, max: 3, step: 0.03, label: "A 的路径参数" })
    // 归属写进 `ownerId`：宿主被删除、点被降级为自由点之后，这个参数就是孤儿，由删除计划回收。
    expect(spec).toEqual({ id: "t-point-7", value: 1.5, min: 0, max: 3, step: 0.03, label: "A 的路径参数", ownerId: "point-7" })
  })

  /**
   * `normalizeHostParameter` 是**文档层与图共用的**那一份宿主参数归一化（fix round 1 / I5）：
   * 闭合宿主折回、有界宿主夹回、无界宿主原样、非有限原样返回（由诊断层负责报）。
   */
  it("normalizes host parameters with one shared rule", () => {
    const orbit = circleHost3({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, 2)!
    const face = faceHost3([{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }])!
    const line = lineHost3({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, "line")!

    // 闭合：折回 [0, 2π)，而不是夹到域的末端。
    expect(normalizeHostParameter(orbit, "u", Math.PI / 2 + Math.PI * 4)).toBeCloseTo(Math.PI / 2, 12)
    // 有界：夹回边界。
    expect(normalizeHostParameter(face, "u", 9)).toBe(4)
    expect(normalizeHostParameter(face, "v", -3)).toBe(0)
    // 无界：原样（直线的参数可以是 1234.5）。
    expect(normalizeHostParameter(line, "u", 1234.5)).toBe(1234.5)
    // 非有限：原样返回，交给求值层的 `non_finite` 诊断。
    expect(Number.isNaN(normalizeHostParameter(face, "u", Number.NaN))).toBe(true)
  })
})
