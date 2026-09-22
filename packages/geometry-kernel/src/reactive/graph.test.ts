import { describe, expect, it, vi } from "vitest"

import type { Coordinate } from "@draw/dsl"

import { derivedNode, missingSourceDiagnostic, parameterNode, sourceNode } from "./evaluator"
import { createReactiveGraph } from "./graph"
import type { EvaluationResult } from "./types"

/**
 * **Reactive DAG 的调度契约**（设计规格 §4.1/§4.2）。
 *
 * 规格原文：
 *
 * ```text
 * 参数变化 -> 反向依赖闭包 -> 拓扑排序 -> 纯 evaluator -> 临时场景预览 -> 抬手后一次性提交
 * ```
 *
 * 以及两条硬约束（规格 §4.2 + 全局约束）：
 * - 检测到环时返回 `dependency_cycle`，**不得使用旧缓存伪装正常结果**；
 * - 缺失来源、非有限值、退化输入都必须是**结构化诊断**，既不能回落到世界原点，也不能沿用上一次的缓存。
 *
 * 这个文件只测调度层（谁被算、按什么顺序算、算不出来时报告什么），不含任何具体几何。
 */

/** 测试里读输入的小工具：解析不出数值就返回 NaN，让断言暴露问题而不是抛异常。 */
function numberValue(inputs: ReadonlyMap<string, EvaluationResult<unknown>>, id: string): number {
  const result = inputs.get(id)
  return result && (result.status === "exact" || result.status === "approximate") ? Number(result.value) : Number.NaN
}

function coordinateValue(inputs: ReadonlyMap<string, EvaluationResult<unknown>>, id: string): Coordinate | null {
  const result = inputs.get(id)
  if (!result || (result.status !== "exact" && result.status !== "approximate")) return null
  const value = result.value as Coordinate | undefined
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null
}

const codes = (report: { diagnostics: readonly { code: string; nodeId: string }[] }): string[] => report.diagnostics.map((diagnostic) => `${diagnostic.nodeId}:${diagnostic.code}`)

describe("reactive graph scheduling", () => {
  it("evaluates in dependency order and reports the affected closure", () => {
    const order: string[] = []
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("p", 2))
    graph.addNode(derivedNode("double", ["p"], (inputs) => {
      order.push("double")
      return { status: "exact", value: numberValue(inputs, "p") * 2 }
    }))
    graph.addNode(derivedNode("plus", ["double"], (inputs) => {
      order.push("plus")
      return { status: "exact", value: numberValue(inputs, "double") + 1 }
    }))
    graph.addNode(parameterNode("unrelated", 100))

    const first = graph.evaluate()
    // 拓扑序：上游先算，下游读到的是**刚算出来的**上游值（2*2+1 = 5），不是上一趟的快照。
    expect(order).toEqual(["double", "plus"])
    expect(first.evaluated).toEqual(["double", "plus"])
    expect(graph.value("plus")).toBe(5)

    // 反向依赖闭包：只有 p 的下游被算。
    expect(graph.affectedNodes(["p"])).toEqual(["p", "double", "plus"])

    graph.setParameter("p", 3)
    const second = graph.evaluate(["p"])
    expect(second.evaluated).toEqual(["double", "plus"])
    expect(graph.value("plus")).toBe(7)
  })

  it("does not evaluate nodes outside the changed closure", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("p", 1))
    graph.addNode(derivedNode("near", ["p"], (inputs) => ({ status: "exact", value: numberValue(inputs, "p") + 1 })))
    const far = vi.fn((inputs: ReadonlyMap<string, EvaluationResult<unknown>>) => ({ status: "exact" as const, value: numberValue(inputs, "other") * 10 }))
    graph.addNode(parameterNode("other", 4))
    graph.addNode(derivedNode("far", ["other"], far))

    graph.evaluate()
    expect(far).toHaveBeenCalledTimes(1)
    far.mockClear()

    graph.setParameter("p", 9)
    const report = graph.evaluate(["p"])
    expect(report.evaluated).toEqual(["near"])
    expect(far).not.toHaveBeenCalled()
    expect(graph.value("far")).toBe(40)
  })

  it("reports a removed source as a missing_source diagnostic instead of falling back", () => {
    const mirror = vi.fn((inputs: ReadonlyMap<string, EvaluationResult<unknown>>) => {
      const host = coordinateValue(inputs, "host")
      return host ? { status: "exact" as const, value: { x: -host.x, y: -host.y } } : { status: "undefined" as const, diagnostic: missingSourceDiagnostic("mirror", "host") }
    })
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("host", { x: 3, y: 4 }))
    graph.addNode(derivedNode("mirror", ["host"], mirror))

    graph.evaluate()
    expect(graph.value("mirror")).toEqual({ x: -3, y: -4 })
    expect(mirror).toHaveBeenCalledTimes(1)

    /**
     * 来源被删除（宿主对象消失）：**以被删掉的那个 id 为种子**求值 —— 拖动 / 删除 / 宿主变化
     * 在本切片里都是这个形状。闭包必须自己把"声明依赖过它的节点"补回来（底层依赖图在
     * `removeNode` 时会把反向边一起摘掉），否则这里会是 `affected = ∅`、`diagnostics = []`，
     * 而 `mirror` 还留着上一趟那个 `exact` 的旧坐标 —— 规格 §4.2 明令禁止。
     */
    graph.removeNode("host")
    mirror.mockClear()
    expect(graph.affectedNodes(["host"])).toContain("mirror")
    const report = graph.evaluate(["host"])
    expect(codes(report)).toContain("mirror:missing_source")
    expect(report.evaluated).not.toContain("mirror")
    expect(mirror).not.toHaveBeenCalled()
    expect(graph.value("mirror")).toBeUndefined()
    expect(graph.result("mirror")).toMatchObject({ status: "undefined", diagnostic: { code: "missing_source", nodeId: "mirror" } })
    expect(graph.value("mirror")).not.toEqual({ x: 0, y: 0 })
    // 不带种子的全量求值同样不能把旧值留下。
    graph.evaluate()
    expect(graph.value("mirror")).toBeUndefined()
  })

  it("rejects a dependency cycle with a structured diagnostic before calling any evaluator", () => {
    const first = vi.fn(() => ({ status: "exact" as const, value: 1 }))
    const second = vi.fn(() => ({ status: "exact" as const, value: 2 }))
    const graph = createReactiveGraph()
    graph.addNode(derivedNode("a", ["b"], first))
    graph.addNode(derivedNode("b", ["a"], second))

    const report = graph.evaluate()
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(codes(report).filter((entry) => entry.endsWith(":dependency_cycle")).length).toBe(2)
    expect(new Set(graph.cycle())).toEqual(new Set(["a", "b"]))
    expect(graph.value("a")).toBeUndefined()
    expect(graph.value("b")).toBeUndefined()
  })

  it("rejects non-finite evaluator output and prunes its downstream", () => {
    const downstream = vi.fn(() => ({ status: "exact" as const, value: 0 }))
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("p", 1))
    graph.addNode(derivedNode("bad", ["p"], () => ({ status: "exact", value: Number.NaN })))
    graph.addNode(derivedNode("downstream", ["bad"], downstream))

    const report = graph.evaluate()
    expect(codes(report)).toContain("bad:non_finite")
    expect(graph.value("bad")).toBeUndefined()
    // 下游拿不到可用的上游值：不执行、不缓存 0（那正是"用假值冒充"）。
    expect(downstream).not.toHaveBeenCalled()
    expect(graph.value("downstream")).toBeUndefined()
    expect(codes(report)).toContain("downstream:missing_source")
  })

  it("refuses a non-finite parameter value and keeps the previous finite one", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("p", 1))
    graph.addNode(derivedNode("next", ["p"], (inputs) => ({ status: "exact", value: numberValue(inputs, "p") + 1 })))
    graph.evaluate()
    expect(graph.value("next")).toBe(2)

    const rejected = graph.setParameter("p", Number.POSITIVE_INFINITY)
    /**
     * 被拒绝的写入**不是**一次成功写入：报 `exact` + 旧值会让调用方以为"参数已经是这个值了"
     * （这正是 `threeScene` 的 3D 拖动会踩到的形状：非有限宿主参数仍照旧移动那个点）。
     */
    expect(rejected).toMatchObject({ status: "undefined", diagnostic: { code: "non_finite", nodeId: "p" } })
    expect(graph.parameterValue("p")).toBe(1)
    expect(graph.diagnostics().some((diagnostic) => diagnostic.code === "non_finite" && diagnostic.nodeId === "p")).toBe(true)
    graph.evaluate(["p"])
    expect(graph.value("next")).toBe(2)
  })

  it("keeps a rejected parameter write observable after the next evaluation", () => {
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("p", 1))
    graph.setParameter("p", Number.NaN)

    // 调用者按本切片自己的模式写 `setParameter(); evaluate([id])`：这条诊断**不得**被抹掉。
    const report = graph.evaluate(["p"])
    expect(report.diagnostics.map((diagnostic) => `${diagnostic.nodeId}:${diagnostic.code}`)).toContain("p:non_finite")
    expect(graph.diagnostics().some((diagnostic) => diagnostic.code === "non_finite" && diagnostic.nodeId === "p")).toBe(true)

    // 一次合法写入之后诊断才消失（被拒绝的那次没有改写真值）。
    graph.setParameter("p", 2)
    graph.evaluate(["p"])
    expect(graph.parameterValue("p")).toBe(2)
    expect(graph.diagnostics().some((diagnostic) => diagnostic.code === "non_finite")).toBe(false)
  })

  it("lets an external source value be updated and propagates only downstream", () => {
    const double = vi.fn((inputs: ReadonlyMap<string, EvaluationResult<unknown>>) => ({ status: "exact" as const, value: coordinateValue(inputs, "host")!.x * 2 }))
    const graph = createReactiveGraph()
    graph.addNode(sourceNode("host", { x: 1, y: 0 }))
    graph.addNode(derivedNode("double", ["host"], double))
    graph.evaluate()
    expect(graph.value("double")).toBe(2)

    // 来源值由外部写入（图元的新坐标 / 新的宿主几何）：与参数一样是"真源"，只向下游传播。
    graph.setSource("host", { x: 3, y: 0 })
    const report = graph.evaluate(["host"])
    expect(report.evaluated).toEqual(["double"])
    expect(graph.value("double")).toBe(6)
    expect(double).toHaveBeenCalledTimes(2)
  })

  it("invalidates a failed node instead of serving its previous value", () => {
    let broken = false
    const graph = createReactiveGraph()
    graph.addNode(parameterNode("p", 1))
    graph.addNode(derivedNode("derived", ["p"], (inputs) => {
      if (broken) return { status: "undefined", diagnostic: missingSourceDiagnostic("derived", "p") }
      return { status: "exact", value: numberValue(inputs, "p") * 5 }
    }))
    graph.evaluate()
    expect(graph.value("derived")).toBe(5)

    broken = true
    graph.setParameter("p", 2)
    const report = graph.evaluate(["p"])
    expect(codes(report)).toContain("derived:missing_source")
    // 上一趟的 5 是**过期缓存**：规格禁止拿它伪装正常结果。
    expect(graph.value("derived")).toBeUndefined()
  })
})
