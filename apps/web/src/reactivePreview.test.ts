import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import type { Coordinate } from "@draw/dsl"

import { buildDocumentGraph, evaluateDocumentGraph, locusDriverParameterId, sampleLocusThroughGraph } from "./reactivePreview"

/**
 * **文档 → Reactive DAG** 的适配层（Reactive DAG 切片 Task 4）。
 *
 * 这一层只做"把文档里能进图的东西建成一张图"，几何一律来自内核：
 * 绑定点是"参数 → 约束求值 → 坐标"的节点，三角形派生的圆是"顶点 → 圆心 / 半径 → 圆"的链，
 * 跟随动点的切线是"动点坐标 → 投影回曲线 → 切线"的节点。
 *
 * 界面上真正被它驱动的是三件事：**拖动中的临时轨迹**（`createTransientTrace`，不进撤销历史）、
 * **拖动闭包的读数与诊断**（`data-reactive-*`），以及**轨迹采样**（一个参数节点反复驱动，
 * 不做整文档重算）。预览几何本身仍然走既有的 `applyOperation` + `recomputeDerivedObjects`，
 * 所以这里绝不重复实现任何几何。
 */

/** 圆轨道 + 圆上的动点 P + 跟随 P 的切线 + 三角形内切圆。 */
function fixture(): GeometryDocument {
  const document = createEmptyDocument("conics")
  document.parameters = { "t-P": { id: "t-P", value: 1, min: 0, max: Math.PI * 2, step: 0.05, ownerId: "point-P" } }
  document.primitives = [
    { id: "circle-track", type: "circle", center: { x: 0, y: 0 }, radius: 3 },
    { id: "point-P", type: "point", x: 3 * Math.cos(1), y: 3 * Math.sin(1), binding: { kind: "onPath", pathId: "circle-track", parameterId: "t-P", parameter: 1 } },
    { id: "tangent-P", type: "tangent", sourceId: "circle-track", x: 0, point: { x: 0, y: 0 }, slope: 0, a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, status: "approximate", anchor: { kind: "point", pointId: "point-P" } },
    { id: "point-A", type: "point", x: 0, y: 0, label: "A" },
    { id: "point-B", type: "point", x: 4, y: 0, label: "B" },
    { id: "point-C", type: "point", x: 0, y: 3, label: "C" },
    { id: "circle-in", type: "circle", center: { x: 1, y: 1 }, radius: 1, radiusFrom: { kind: "triangle", triangleIds: ["point-A", "point-B", "point-C"], metric: "inradius" } },
    { id: "locus-P", type: "locus", sourcePointId: "point-P", parameterId: "t-P", domain: [0, Math.PI * 2], samples: 48 }
  ]
  return document
}

const pointOf = (source: { point: Coordinate }) => source.point

describe("document graph adapter", () => {
  it("evaluates a bound point from its driver parameter", () => {
    const document = fixture()
    const { graph, geometryNodeIds } = buildDocumentGraph(document)
    expect(geometryNodeIds.get("point-P")).toBe("point-P")
    graph.evaluate()

    const value = graph.value("point-P") as { point: Coordinate; parameter: number; clamped: boolean }
    expect(value.point.x).toBeCloseTo(3 * Math.cos(1), 12)
    expect(value.point.y).toBeCloseTo(3 * Math.sin(1), 12)
    expect(value.clamped).toBe(false)

    // 参数一改，坐标立刻跟着走（参数是唯一真值）。
    graph.setParameter("t-P", 0)
    graph.evaluate(["t-P"])
    expect(pointOf(graph.value("point-P") as { point: Coordinate }).x).toBeCloseTo(3, 12)
  })

  it("chains a triangle-derived circle onto its vertices", () => {
    const document = fixture()
    const { graph } = buildDocumentGraph(document)
    graph.evaluate()
    const circle = graph.value("circle-in") as { center: Coordinate; radius: number }
    expect(circle.center.x).toBeCloseTo(1, 10)
    expect(circle.center.y).toBeCloseTo(1, 10)
    expect(circle.radius).toBeCloseTo(1, 10)
  })

  it("reports the downstream closure of a dragged point and leaves unrelated nodes alone", () => {
    const document = fixture()
    const { graph } = buildDocumentGraph(document)
    evaluateDocumentGraph(graph, document, [])

    // 拖动 P：把新参数写进图，再求值它的闭包。真拖动会把**参数与绑定缓存一起写**
    // （`dragBoundPoint`，operations.ts），所以这里两份都改。
    const dragged: GeometryDocument = {
      ...document,
      parameters: { ...document.parameters, "t-P": { ...document.parameters["t-P"], value: 2 } },
      primitives: document.primitives.map((primitive) => primitive.id === "point-P" && primitive.type === "point"
        ? { ...primitive, binding: { kind: "onPath" as const, pathId: "circle-track", parameterId: "t-P", parameter: 2 } }
        : primitive)
    }
    const report = evaluateDocumentGraph(graph, dragged, ["point-P"])
    expect(report.affected).toContain("point-P")
    // 切线是 P 的下游：P 一动它必须重算（这是"动点处切线随动点变化"这条口径的图论表达）。
    expect(report.evaluated).toContain("tangent-P")
    // 与 P 无关的三角形内切圆既不在闭包里、也**没有被求值**（"整图重算"会在这里露出来）。
    expect(report.affected).not.toContain("circle-in")
    expect(report.evaluated).not.toContain("circle-in")
    expect(report.points.get("point-P")!.x).toBeCloseTo(3 * Math.cos(2), 10)
    expect(report.diagnostics).toEqual([])
  })

  /**
   * 同步方向以**文档参数**为真值（评审 M7）：绑定里那个 `parameter` 只是缓存。
   * 只改文档参数（不碰 binding）时，点也必须落在新参数处。
   */
  it("syncs a bound point from the document parameter rather than the cached binding field", () => {
    const document = fixture()
    const withParameter = { ...document, parameters: { ...document.parameters, "t-P": { ...document.parameters["t-P"], value: 2 } } }
    const { graph } = buildDocumentGraph(withParameter)
    evaluateDocumentGraph(graph, withParameter, [])
    // 绑定缓存被改成 0（旧值），但参数真值是 2：闭包必须按 2 算。
    const stale = { ...withParameter, primitives: withParameter.primitives.map((primitive) => primitive.id === "point-P" && primitive.type === "point"
      ? { ...primitive, binding: { kind: "onPath" as const, pathId: "circle-track", parameterId: "t-P", parameter: 0 } }
      : primitive) }
    evaluateDocumentGraph(graph, stale, ["point-P"])
    expect((graph.value("point-P") as { point: Coordinate }).point.x).toBeCloseTo(3 * Math.cos(2), 10)
  })

  it("samples a locus through the graph and restores the driver parameter", () => {
    const document = fixture()
    const { graph } = buildDocumentGraph(document)
    evaluateDocumentGraph(graph, document, [])
    const result = sampleLocusThroughGraph(graph, { pointId: "point-P", parameterId: "t-P", domain: [0, Math.PI * 2], samples: 24 })
    expect(result.branches.length).toBeGreaterThan(0)
    for (const point of result.branches.flatMap((branch) => branch)) expect(Math.hypot(point.x, point.y)).toBeCloseTo(3, 6)
    // 采样是只读遍历：驱动参数回到原值。
    expect(graph.parameterValue("t-P")).toBe(1)
  })

  /**
   * 采样预算透传（评审 M2）：旧渲染显式给了 `maxEvaluations`，新接线如果只传 domain/samples/tolerance
   * 就会吃内核默认值（更贵、形状也不同）。这里用一个很小的预算钉住"确实透传下去了"。
   */
  it("forwards the sampling budget to the adaptive sampler", () => {
    const document = fixture()
    const { graph } = buildDocumentGraph(document)
    evaluateDocumentGraph(graph, document, [])
    const result = sampleLocusThroughGraph(graph, { pointId: "point-P", parameterId: "t-P", domain: [0, Math.PI * 2], samples: 24, maxEvaluations: 30 })
    expect(result.truncated).toBe(true)
    expect(result.evaluations).toBeLessThanOrEqual(31)
  })

  /**
   * 轨迹该驱动哪个参数（评审 M3）：声明的参数解析不出来时**什么都不画**，
   * 而不是偷偷换一个参数扫一遍（那会画出一条误导曲线）。
   */
  it("prefers the locus's declared parameter and draws nothing when it does not resolve", () => {
    const document = fixture()
    const locus = document.primitives.find((primitive): primitive is Extract<PrimitiveSpec, { type: "locus" }> => primitive.type === "locus")!
    const hasNode = (id: string) => id === "t-P" || id === "point-P:t"
    /** 老文档（JSON 里没有这个字段）在类型上表达不出来，所以这里显式删掉。 */
    const withoutParameterId = (source: Extract<PrimitiveSpec, { type: "locus" }>): Extract<PrimitiveSpec, { type: "locus" }> => {
      const copy: { parameterId?: string } & Omit<Extract<PrimitiveSpec, { type: "locus" }>, "parameterId"> = { ...source }
      delete copy.parameterId
      return copy as Extract<PrimitiveSpec, { type: "locus" }>
    }

    expect(locusDriverParameterId(document, locus, hasNode)).toBe("t-P")
    // 另一条切片写过的那种不存在的 id：不画。
    expect(locusDriverParameterId(document, { ...locus, parameterId: "locus-1" }, hasNode)).toBeNull()
    // 老文档没声明：回退到动点自己的驱动参数。
    expect(locusDriverParameterId(document, withoutParameterId(locus), hasNode)).toBe("t-P")
    // 动点没有绑定（自由点）也没有驱动参数：不画。
    expect(locusDriverParameterId(document, { ...withoutParameterId(locus), sourcePointId: "point-A" }, hasNode)).toBeNull()
  })

  it("turns a removed source into a diagnostic instead of a coordinate", () => {
    const document = fixture()
    // 轨道被删除：动点没有宿主了。宿主节点**不再登记**，于是这是"缺少来源"而不是"宿主不合法"。
    const withoutTrack = { ...document, primitives: document.primitives.filter((primitive) => primitive.id !== "circle-track") }
    const rebuilt = buildDocumentGraph(withoutTrack)
    const report = evaluateDocumentGraph(rebuilt.graph, withoutTrack, ["point-P"])
    expect(report.diagnostics.map((diagnostic) => `${diagnostic.nodeId}:${diagnostic.code}`)).toContain("point-P:missing_source")
    expect(report.points.get("point-P")).toBeUndefined()
  })

  it("reports an unusable host as invalid_host when the host exists but is not a curve", () => {
    const document = fixture()
    const withBadHost = { ...document, primitives: document.primitives.map((primitive) => primitive.id === "point-P" && primitive.type === "point"
      ? { ...primitive, binding: { kind: "onPath" as const, pathId: "point-A", parameterId: "t-P", parameter: 1 } }
      : primitive) }
    const { graph } = buildDocumentGraph(withBadHost)
    const report = evaluateDocumentGraph(graph, withBadHost, ["point-P"])
    expect(report.diagnostics.map((diagnostic) => `${diagnostic.nodeId}:${diagnostic.code}`)).toContain("point-P:invalid_host")
    expect(report.points.get("point-P")).toBeUndefined()
  })
})
