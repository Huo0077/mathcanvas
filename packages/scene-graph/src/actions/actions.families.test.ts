import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compileActions } from "./index"
import type { ActionContext, DraftAction, IdAllocator } from "./types"

/**
 * Task 0.5 第二批：把剩余动作族补上（计划 Step 2 点名的"函数分析、切线 anchor、半径规则"）。
 *
 * 与第一批相同的纪律：不改输入文档、id 幂等、前置条件失败给**可读诊断码**。
 * 对照表见 `actions.test.ts` 顶部 —— 新抽出的回调在那里补行。
 */

function makeAllocator(): IdAllocator {
  const known = new Map<string, string>()
  let counter = 0
  return {
    allocate(kind, alias) {
      const key = `${kind}:${alias}`
      const existing = known.get(key)
      if (existing) return existing
      counter += 1
      const id = `${kind}-${counter}`
      known.set(key, id)
      return id
    }
  }
}

function contextWith(document = createEmptyDocument("conics")): ActionContext {
  return { targetDocument: document, targetWorkspace: document.workspace, orderedSelection: [], capabilityRevision: "test.1", idAllocator: makeAllocator() }
}

function action(partial: Record<string, unknown>): DraftAction {
  return { actionKey: "k1", factIds: [], ...partial } as unknown as DraftAction
}

/** 一条函数图形 + 一个圆 + 一条边界清晰的圆弧。 */
function planarDocument() {
  const document = createEmptyDocument("conics")
  document.primitives = [
    { id: "fn-1", type: "function", expression: "x*x", domain: [-3, 3], samples: 64 },
    { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
    { id: "point-1", type: "point", x: 1, y: 1 },
    { id: "point-2", type: "point", x: 2, y: 2 }
  ]
  document.parameters = { "param-1": { id: "param-1", value: 0.5, min: 0, max: 1 } }
  return document
}

describe("function analysis family", () => {
  it("creates a derivative of a selected function", () => {
    const document = planarDocument()
    const result = compileActions(document, [action({ actionId: "function.analyze", inputs: { alias: "d", sourceId: "fn-1", analysis: "derivative" } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    // 几何留空：导数点集由内核在同一事务里重算填进去（与属性栏同一条路径）。
    expect(result.operations[0]).toMatchObject({ op: "addPrimitive", primitive: { id: "derivative-1", type: "derivative", sourceId: "fn-1", domain: [-3, 3], points: [] } })
  })

  it("creates an integral only when the domain is bounded", () => {
    const document = planarDocument()
    document.primitives = [...document.primitives, { id: "fn-unbounded", type: "function", expression: "x", domain: [Number.NEGATIVE_INFINITY, 3], samples: 64 }]

    const ok = compileActions(document, [action({ actionId: "function.analyze", inputs: { alias: "i", sourceId: "fn-1", analysis: "integral" } })], contextWith(document))
    expect(ok.diagnostics).toEqual([])

    const bad = compileActions(document, [action({ actionId: "function.analyze", inputs: { alias: "i2", sourceId: "fn-unbounded", analysis: "integral" } })], contextWith(document))
    expect(bad.operations).toHaveLength(0)
    expect(bad.diagnostics[0].code).toBe("unbounded_domain")
  })

  it("refuses analysis on a source that is not a function", () => {
    const document = planarDocument()
    const result = compileActions(document, [action({ actionId: "function.analyze", inputs: { alias: "d", sourceId: "circle-1", analysis: "derivative" } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("source_not_function")
  })
})

describe("dynamic binding to a curve", () => {
  it("binds a planar point to a path with an explicit natural parameter", () => {
    const document = planarDocument()
    const result = compileActions(document, [action({ actionId: "dynamic.bind_curve", inputs: { target: { documentId: document.metadata.id, entityId: "point-1" }, pathId: "circle-1", parameter: 0.5 } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations).toEqual([{ op: "updatePrimitive", id: "point-1", patch: { binding: { kind: "onPath", pathId: "circle-1", parameter: 0.5 } } }])
  })

  it("refuses a path that does not exist, and a non-point target", () => {
    const document = planarDocument()
    const missing = compileActions(document, [action({ actionId: "dynamic.bind_curve", inputs: { target: { documentId: document.metadata.id, entityId: "point-1" }, pathId: "nope", parameter: 0 } })], contextWith(document))
    expect(missing.diagnostics[0].code).toBe("path_not_found")

    const notPoint = compileActions(document, [action({ actionId: "dynamic.bind_curve", inputs: { target: { documentId: document.metadata.id, entityId: "circle-1" }, pathId: "fn-1", parameter: 0 } })], contextWith(document))
    expect(notPoint.diagnostics[0].code).toBe("target_not_point")
  })

  it("refuses a non-finite parameter instead of freezing the point", () => {
    const document = planarDocument()
    const result = compileActions(document, [action({ actionId: "dynamic.bind_curve", inputs: { target: { documentId: document.metadata.id, entityId: "point-1" }, pathId: "circle-1", parameter: Number.NaN } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("invalid_parameter")
  })
})

describe("circle radius rule", () => {
  it("lets a circle take its radius from a driving point", () => {
    const document = planarDocument()
    const result = compileActions(document, [action({ actionId: "dynamic.set_radius_rule", inputs: { circleId: "circle-1", pointId: "point-2", factor: 1.5 } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations).toEqual([{ op: "updatePrimitive", id: "circle-1", patch: { radiusFrom: { pointId: "point-2", factor: 1.5 } } }])
  })

  it("refuses a driving point that does not exist", () => {
    const document = planarDocument()
    const result = compileActions(document, [action({ actionId: "dynamic.set_radius_rule", inputs: { circleId: "circle-1", pointId: "ghost" } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("driver_not_found")
  })
})

describe("curve tangent anchor", () => {
  it("anchors a tangent on a curve by natural parameter", () => {
    const document = planarDocument()
    const result = compileActions(document, [action({ actionId: "function.create_tangent", inputs: { alias: "t", sourceId: "circle-1", anchor: { kind: "parameter", parameter: 1.2, branch: 0 } } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations[0]).toMatchObject({ op: "addPrimitive", primitive: { type: "tangent", sourceId: "circle-1", anchor: { kind: "parameter", parameter: 1.2, branch: 0 } } })
  })

  it("anchors a tangent on a dynamic point, so it follows that point", () => {
    const document = planarDocument()
    /**
     * 动点必须已经绑在轨道上；引用写成参数而不是抄下当前坐标，切线才会跟着动。
     *
     * 收窄成 `type === "point"` 再改：无差别地给每个图元加 `binding` 会推断出
     * 一个不属于 `PrimitiveSpec` 联合的对象（第一版就是这么被 typecheck 拦住的）。
     */
    document.primitives = document.primitives.map((primitive) => primitive.type === "point" && primitive.id === "point-1"
      ? { ...primitive, binding: { kind: "onPath" as const, pathId: "circle-1", parameter: 0.3 } }
      : primitive)

    const result = compileActions(document, [action({ actionId: "function.create_tangent", inputs: { alias: "t", sourceId: "point-1", anchor: { kind: "point", pointId: "point-1" } } })], contextWith(document))

    expect(result.diagnostics).toEqual([])
    expect(result.operations[0]).toMatchObject({ op: "addPrimitive", primitive: { type: "tangent", sourceId: "circle-1", anchor: { kind: "point", pointId: "point-1" } } })
  })

  it("refuses a point anchor on a point that is not bound to a path", () => {
    const document = planarDocument()
    const result = compileActions(document, [action({ actionId: "function.create_tangent", inputs: { alias: "t", sourceId: "point-1", anchor: { kind: "point", pointId: "point-1" } } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("point_not_bound")
  })
})

describe("parameter family", () => {
  it("sets a parameter value and refuses an unknown parameter", () => {
    const document = planarDocument()
    const ok = compileActions(document, [action({ actionId: "parameter.set", inputs: { id: "param-1", value: 0.75 } })], contextWith(document))
    expect(ok.operations).toEqual([{ op: "setParameter", id: "param-1", value: 0.75 }])

    const bad = compileActions(document, [action({ actionId: "parameter.set", inputs: { id: "param-9", value: 1 } })], contextWith(document))
    expect(bad.operations).toHaveLength(0)
    expect(bad.diagnostics[0].code).toBe("parameter_not_found")
  })

  it("refuses a non-finite parameter value", () => {
    const document = planarDocument()
    const result = compileActions(document, [action({ actionId: "parameter.set", inputs: { id: "param-1", value: Number.POSITIVE_INFINITY } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("invalid_value")
  })

  it("refuses an empty expression", () => {
    const document = planarDocument()
    const result = compileActions(document, [action({ actionId: "parameter.set_expression", inputs: { id: "param-1", expression: "  " } })], contextWith(document))

    expect(result.operations).toHaveLength(0)
    expect(result.diagnostics[0].code).toBe("empty_expression")
  })
})
