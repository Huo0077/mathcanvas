import { describe, expect, it } from "vitest"

import { createDependencyGraph, createReactiveGraph, topologicalLayers, type ReactiveNode } from "./dependency-graph"

/**
 * Every dependency that is *also in the list* must appear earlier in it.
 * A subset (a dirty closure, a recomputed list) legitimately omits upstream nodes that did not change,
 * so `complete: true` is used only when checking a full topological order.
 */
function assertDependencyFirst(graph: ReturnType<typeof createDependencyGraph>, order: readonly string[], complete = false): void {
  const position = new Map(order.map((id, index) => [id, index]))
  for (const id of order) {
    for (const upstream of graph.dependenciesOf(id)) {
      const upstreamIndex = position.get(upstream)
      if (upstreamIndex === undefined) {
        expect(complete, `${upstream} must be present when the whole order is checked`).toBe(false)
        continue
      }
      expect(upstreamIndex, `${upstream} must appear before ${id}`).toBeLessThan(position.get(id)!)
    }
  }
}

function buildChain() {
  const graph = createDependencyGraph()
  // P -> line-AP -> Q -> area-APQ, plus a circle that also feeds Q.
  graph.addNode("P")
  graph.addNode("circle")
  graph.addNode("line-AP", ["P"])
  graph.addNode("Q", ["line-AP", "circle"])
  graph.addNode("area-APQ", ["P", "Q", "line-AP"])
  graph.addNode("unrelated")
  return graph
}

describe("dependency graph structure", () => {
  it("tracks nodes and both directions of every edge", () => {
    const graph = buildChain()
    expect(graph.size).toBe(6)
    expect(graph.has("P")).toBe(true)
    expect(graph.has("missing")).toBe(false)
    expect([...graph.dependenciesOf("Q")].sort()).toEqual(["circle", "line-AP"])
    expect([...graph.dependentsOf("P")].sort()).toEqual(["area-APQ", "line-AP"])
    expect(graph.dependenciesOf("P")).toEqual([])
    expect(graph.dependentsOf("Q")).toEqual(["area-APQ"])
  })

  it("is idempotent and rejects self-dependency", () => {
    const graph = createDependencyGraph()
    graph.addNode("a")
    graph.addNode("a")
    graph.addNode("b", ["a"])
    graph.addNode("b", ["a"])
    expect(graph.size).toBe(2)
    expect(graph.dependenciesOf("b")).toEqual(["a"])
    expect(() => graph.addNode("c", ["c"])).toThrow(/cycle/)
  })

  it("implicitly creates an unknown upstream node", () => {
    const graph = createDependencyGraph()
    graph.addNode("child", ["absent-parent"])
    expect(graph.has("absent-parent")).toBe(true)
    expect(graph.dependentsOf("absent-parent")).toEqual(["child"])
  })

  it("replaces rather than merges dependencies and detaches the old edges", () => {
    const graph = createDependencyGraph()
    graph.addNode("a")
    graph.addNode("b")
    graph.addNode("c", ["a"])
    graph.setDependencies("c", ["b"])
    expect(graph.dependenciesOf("c")).toEqual(["b"])
    expect(graph.dependentsOf("a")).toEqual([])
    expect(graph.dependentsOf("b")).toEqual(["c"])
  })

  it("detaches a removed node from both sides", () => {
    const graph = buildChain()
    graph.removeNode("Q")
    expect(graph.has("Q")).toBe(false)
    expect(graph.size).toBe(5)
    // area-APQ keeps its other two upstreams, it only loses Q.
    expect(graph.dependenciesOf("area-APQ")).toEqual(["P", "line-AP"])
    // line-AP keeps area-APQ as a dependent; only Q is gone.
    expect(graph.dependentsOf("line-AP")).toEqual(["area-APQ"])
    expect(graph.topologicalOrder()).not.toContain("Q")
  })

  it("bumps the structure version only when the structure changes", () => {
    const graph = createDependencyGraph()
    graph.addNode("a")
    const version = graph.version
    expect(graph.version).toBe(version)
    graph.topologicalOrder()
    graph.dirtyClosure(["a"])
    expect(graph.version).toBe(version)
    graph.addNode("b", ["a"])
    expect(graph.version).toBeGreaterThan(version)
  })
})

describe("topological order", () => {
  it("places every dependency before its dependent", () => {
    const graph = buildChain()
    const order = graph.topologicalOrder()
    expect(order).toHaveLength(6)
    assertDependencyFirst(graph, order, true)
  })

  it("is stable and puts incomparable nodes in insertion order", () => {
    const first = createDependencyGraph()
    const second = createDependencyGraph()
    for (const graph of [first, second]) {
      graph.addNode("alpha")
      graph.addNode("beta")
      graph.addNode("gamma", ["alpha"])
    }
    expect(first.topologicalOrder()).toEqual(["alpha", "beta", "gamma"])
    expect(second.topologicalOrder()).toEqual(first.topologicalOrder())
  })

  it("omits cyclic nodes but keeps the acyclic part", () => {
    const graph = createDependencyGraph()
    graph.addNode("root")
    graph.addNode("ok", ["root"])
    graph.addNode("x", ["y"])
    graph.addNode("y", ["x"])
    const order = graph.topologicalOrder()
    expect(order).toContain("root")
    expect(order).toContain("ok")
    expect(order).not.toContain("x")
    expect(order).not.toContain("y")
  })
})

describe("dirty closure", () => {
  it("contains the seeds and everything downstream but nothing else", () => {
    const graph = buildChain()
    expect(graph.dirtyClosure(["P"]).sort()).toEqual(["P", "Q", "area-APQ", "line-AP"])
    expect(graph.dirtyClosure(["unrelated"])).toEqual(["unrelated"])
    expect(graph.dirtyClosure(["P"])).not.toContain("circle")
  })

  it("is dependency-first and duplicate free", () => {
    const graph = buildChain()
    const dirty = graph.dirtyClosure(["P", "circle"])
    expect(new Set(dirty).size).toBe(dirty.length)
    assertDependencyFirst(graph, dirty)
    // Q is downstream of two dirty seeds and must appear exactly once, after both.
    expect(dirty.filter((id) => id === "Q")).toHaveLength(1)
    expect(dirty.indexOf("Q")).toBeGreaterThan(dirty.indexOf("line-AP"))
    expect(dirty.indexOf("Q")).toBeGreaterThan(dirty.indexOf("circle"))
    expect(dirty.indexOf("area-APQ")).toBeGreaterThan(dirty.indexOf("Q"))
  })

  it("ignores seeds that are not in the graph and tolerates duplicates", () => {
    const graph = buildChain()
    expect(graph.dirtyClosure(["ghost"])).toEqual([])
    expect(graph.dirtyClosure(["P", "P"])).toEqual(graph.dirtyClosure(["P"]))
  })

  it("propagates the motivating dynamic-geometry chain end to end", () => {
    const graph = buildChain()
    const dirty = graph.dirtyClosure(["P"])
    expect(dirty).toContain("line-AP")
    expect(dirty).toContain("Q")
    expect(dirty).toContain("area-APQ")
    assertDependencyFirst(graph, dirty)
  })
})

describe("cycle detection", () => {
  it("returns no path for a DAG", () => {
    expect(buildChain().findCycle()).toEqual([])
  })

  it("returns a closed path that follows real dependency edges", () => {
    const graph = createDependencyGraph()
    graph.addNode("a", ["c"])
    graph.addNode("b", ["a"])
    graph.addNode("c", ["b"])
    const cycle = graph.findCycle()
    expect(cycle.length).toBeGreaterThanOrEqual(2)
    expect(cycle[0]).toBe(cycle[cycle.length - 1])
    // The path walks the *dependency* direction: each step is a dependency of the previous node.
    for (let index = 1; index < cycle.length; index += 1) {
      expect(graph.dependenciesOf(cycle[index - 1])).toContain(cycle[index])
    }
  })
})

describe("topological layers", () => {
  it("groups nodes so every dependency sits in an earlier layer", () => {
    const graph = buildChain()
    const layers = topologicalLayers(graph)
    const layerOf = new Map<string, number>()
    layers.forEach((layer, index) => layer.forEach((id) => layerOf.set(id, index)))
    for (const id of graph.topologicalOrder()) {
      for (const upstream of graph.dependenciesOf(id)) {
        expect(layerOf.get(upstream)!).toBeLessThan(layerOf.get(id)!)
      }
    }
    const flattened = layers.flat()
    expect(new Set(flattened).size).toBe(flattened.length)
    expect(flattened.sort()).toEqual([...graph.ids()].sort())
  })

  it("puts exactly the source nodes in the first layer", () => {
    const graph = buildChain()
    expect([...topologicalLayers(graph)[0]].sort()).toEqual(["P", "circle", "unrelated"])
  })

  it("produces one layer per node for a linear chain", () => {
    const graph = createDependencyGraph()
    graph.addNode("a")
    graph.addNode("b", ["a"])
    graph.addNode("c", ["b"])
    graph.addNode("d", ["c"])
    expect(topologicalLayers(graph)).toEqual([["a"], ["b"], ["c"], ["d"]])
  })
})

describe("reactive graph", () => {
  const buildNumberGraph = (calls: string[], equals?: (next: number, previous: number) => boolean) => {
    const nodes: ReactiveNode<number>[] = [
      { id: "a", dependsOn: [], compute: () => { calls.push("a"); return 1 } },
      { id: "b", dependsOn: ["a"], compute: (inputs) => { calls.push("b"); return (inputs.get("a") ?? 0) * 2 }, ...(equals ? { equals } : {}) },
      { id: "c", dependsOn: ["b"], compute: (inputs) => { calls.push("c"); return (inputs.get("b") ?? 0) + 1 } }
    ]
    return createReactiveGraph<number>(nodes)
  }

  it("computes every node from scratch on recomputeAll, including sources", () => {
    const calls: string[] = []
    const graph = buildNumberGraph(calls)
    const report = graph.recomputeAll()
    expect(report.recomputed).toEqual(["a", "b", "c"])
    expect(calls).toEqual(["a", "b", "c"])
    expect(graph.value("a")).toBe(1)
    expect(graph.value("b")).toBe(2)
    expect(graph.value("c")).toBe(3)
    expect(report.errors.size).toBe(0)
  })

  it("propagates an externally written value without recomputing the seed", () => {
    const calls: string[] = []
    const graph = buildNumberGraph(calls)
    graph.recomputeAll()
    calls.length = 0
    graph.setValue("a", 5)
    const report = graph.update(["a"])
    expect(calls).toEqual(["b", "c"])
    expect(report.recomputed).toEqual(["b", "c"])
    expect(graph.value("c")).toBe(11)
  })

  it("prunes a node whose value did not change and everything downstream of it", () => {
    const calls: string[] = []
    const graph = buildNumberGraph(calls)
    graph.recomputeAll()
    calls.length = 0
    // Same value: Object.is makes b unchanged, so c must never run.
    graph.setValue("a", 1)
    const report = graph.update(["a"])
    expect(calls).toEqual(["b"])
    expect(report.recomputed).toEqual([])
    expect(report.pruned).toContain("b")
    expect(report.pruned).toContain("c")
    expect(calls).not.toContain("c")
  })

  it("honours a custom equals so float noise does not dirty the whole graph", () => {
    const calls: string[] = []
    const graph = buildNumberGraph(calls, (next, previous) => Math.abs(next - previous) <= 1e-6)
    graph.recomputeAll()
    calls.length = 0
    graph.setValue("a", 1 + 1e-12)
    const report = graph.update(["a"])
    // b recomputes to 2 + 2e-12, which its tolerance-based equals treats as unchanged.
    expect(calls).toEqual(["b"])
    expect(report.pruned).toContain("c")
    expect(graph.value("c")).toBe(3)
  })

  it("propagates a real change through the tolerance comparison", () => {
    const calls: string[] = []
    const graph = buildNumberGraph(calls, (next, previous) => Math.abs(next - previous) <= 1e-6)
    graph.recomputeAll()
    calls.length = 0
    graph.setValue("a", 4)
    const report = graph.update(["a"])
    expect(calls).toEqual(["b", "c"])
    expect(report.recomputed).toEqual(["b", "c"])
    expect(graph.value("c")).toBe(9)
  })

  it("records a throwing compute, keeps the old value, and prunes its downstream", () => {
    const calls: string[] = []
    const graph = createReactiveGraph<number>([
      { id: "a", dependsOn: [], compute: () => { calls.push("a"); return 1 } },
      { id: "b", dependsOn: ["a"], compute: (inputs) => { calls.push("b"); if ((inputs.get("a") ?? 0) < 0) throw new Error("negative"); return (inputs.get("a") ?? 0) * 2 } },
      { id: "c", dependsOn: ["b"], compute: (inputs) => { calls.push("c"); return (inputs.get("b") ?? 0) + 1 } }
    ])
    graph.recomputeAll()
    expect(graph.value("b")).toBe(2)
    calls.length = 0
    graph.setValue("a", -1)
    const report = graph.update(["a"])
    expect(report.errors.get("b")?.message).toBe("negative")
    expect(graph.value("b")).toBe(2)
    expect(calls).not.toContain("c")
    expect(report.pruned).toContain("c")
  })

  it("returns recomputed nodes in dependency order", () => {
    const calls: string[] = []
    const graph = buildNumberGraph(calls)
    graph.recomputeAll()
    graph.setValue("a", 7)
    const report = graph.update(["a"])
    expect(report.recomputed).toEqual(["b", "c"])
    assertDependencyFirst(graph.graph, report.recomputed)
  })

  it("rejects a cyclic node table", () => {
    expect(() => createReactiveGraph<number>([
      { id: "x", dependsOn: ["y"], compute: () => 0 },
      { id: "y", dependsOn: ["x"], compute: () => 0 }
    ])).toThrow(/cycle/)
  })

  it("hands out a snapshot that does not alias internal state", () => {
    const graph = buildNumberGraph([])
    graph.recomputeAll()
    const snapshot = graph.snapshot()
    expect(snapshot.get("c")).toBe(3)
    ;(snapshot as Map<string, number>).set("c", 999)
    expect(graph.value("c")).toBe(3)
  })
})
