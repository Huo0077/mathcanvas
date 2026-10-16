import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { commitPatch } from "../patches"
import { compileActions } from "./index"
import type { ActionContext, DraftAction, IdAllocator } from "./types"
import { recomputeCurveTangent } from "../analysisRecompute"

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

  /**
   * **过曲线外一点作切线**（2026-10-16，Task 15 的边界「外点双切线没有产品动作」）。
   *
   * 判据全部**自己算**：那条直线要真的过那个点、而且要真的与曲线相切（切点处斜率 = 导数）。
   * 题面形状就是 2021 新高考Ⅰ卷 7 题那一类（外点向曲线作多条切线）。
   */
  describe("过外点的切线", () => {
    /** 把 `point-1` 挪到外点位置：`y = x²` 下方 (0, −1) ⇒ 恰好两条切线。 */
    function documentWithExternalPoint(x: number, y: number) {
      const document = planarDocument()
      document.primitives = document.primitives.map((primitive) => primitive.type === "point" && primitive.id === "point-1" ? { ...primitive, x, y } : primitive)
      return document
    }

    function compileThrough(document: ReturnType<typeof planarDocument>, branch: number) {
      return compileActions(document, [action({ actionId: "function.create_tangent", inputs: { alias: `t${branch}`, sourceId: "fn-1", anchor: { kind: "through", pointId: "point-1", branch } } })], contextWith(document))
    }

    it("`(0, −1)` 向 `y = x²` 的两支各作一条：编译期先解出来，再落一个带锚点的图元", () => {
      const document = documentWithExternalPoint(0, -1)
      for (const branch of [0, 1]) {
        const result = compileThrough(document, branch)
        expect(result.diagnostics, `branch=${branch}`).toEqual([])
        expect(result.operations[0]).toMatchObject({ op: "addPrimitive", primitive: { type: "tangent", sourceId: "fn-1", anchor: { kind: "through", pointId: "point-1", branch } } })
      }
    })

    it("重算之后两条切线**都真的过那个点、也都真的相切**（自己算，不读图元自报的斜率）", () => {
      const document = documentWithExternalPoint(0, -1)
      const source = document.primitives.find((primitive) => primitive.id === "fn-1")
      if (source?.type !== "function") throw new Error("fixture 里应有函数曲线 fn-1")
      const map = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))

      const slopes: number[] = []
      for (const branch of [0, 1]) {
        const compiled = compileThrough(document, branch)
        const tangent = compiled.operations[0]
        if (tangent?.op !== "addPrimitive") throw new Error(`branch=${branch} 没产出图元`)
        const recomputed = recomputeCurveTangent(tangent.primitive as never, source, map as never, document.parameters)
        // ① 过外点：`(P − 切点)` 与直线方向共线。
        const along = { x: recomputed.b.x - recomputed.a.x, y: recomputed.b.y - recomputed.a.y }
        const toPoint = { x: 0 - recomputed.point.x, y: -1 - recomputed.point.y }
        expect(Math.abs(along.x * toPoint.y - along.y * toPoint.x) / Math.hypot(along.x, along.y), `branch=${branch} 过外点`).toBeLessThan(1e-9)
        // ② 相切：切点在曲线上（`y = x²`），且斜率 = `2x`。
        expect(recomputed.point.y, `branch=${branch} 切点在曲线上`).toBeCloseTo(recomputed.point.x ** 2, 6)
        expect(recomputed.slope, `branch=${branch} 斜率 = 2x`).toBeCloseTo(2 * recomputed.point.x, 6)
        slopes.push(recomputed.slope)
      }
      // ③ 两条是**不同**的切线（否则"两条"这件事没发生）。
      expect(Math.abs(slopes[0]! - slopes[1]!)).toBeGreaterThan(0.5)
    })

    it("`(0, 1)` 在抛物线**里面** ⇒ 作不出切线：编译期就拒（`no_tangent`），不落一个空图元", () => {
      const result = compileThrough(documentWithExternalPoint(0, 1), 0)
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics[0]?.code).toBe("no_tangent")
    })

    it("非函数曲线（圆）如实拒绝：`unsupported_source` —— 不假装读过（内核那一侧还没有同一个求解器）", () => {
      const document = documentWithExternalPoint(0, -1)
      const result = compileActions(document, [action({ actionId: "function.create_tangent", inputs: { alias: "t", sourceId: "circle-1", anchor: { kind: "through", pointId: "point-1", branch: 0 } } })], contextWith(document))
      expect(result.operations).toHaveLength(0)
      expect(result.diagnostics[0]?.code).toBe("unsupported_source")
    })
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


describe("common tangent product path", () => {
  it("compiles a common tangent and recomputes one verified line from two function sources", () => {
    const document = planarDocument()
    document.primitives = [
      ...document.primitives,
      { id: "fn-2", type: "function", expression: "-(x-2)*(x-2)+1", domain: [-2, 3], samples: 64 }
    ]
    const result = compileActions(document, [action({
      actionId: "function.create_tangent",
      inputs: { alias: "ct", sourceId: "fn-1", anchor: { kind: "common", otherSourceId: "fn-2", branch: 0 } }
    })], contextWith(document))
    expect(result.diagnostics).toEqual([])
    const operation = result.operations[0]
    expect(operation).toMatchObject({ op: "addPrimitive", primitive: { type: "tangent", sourceId: "fn-1", anchor: { kind: "common", otherSourceId: "fn-2", branch: 0 } } })
    if (operation?.op !== "addPrimitive") throw new Error("common tangent operation missing")
    const source = document.primitives.find((primitive) => primitive.id === "fn-1")
    if (source?.type !== "function") throw new Error("first function missing")
    const map = new Map(document.primitives.map((primitive) => [primitive.id, primitive]))
    const recomputed = recomputeCurveTangent(operation.primitive as never, source, map as never, document.parameters)
    expect(recomputed.status).toBe("approximate")
    expect(recomputed.point.y).toBeCloseTo(recomputed.point.x * recomputed.point.x, 6)
    expect(recomputed.slope).toBeCloseTo(2 - Math.sqrt(2), 6)
    const other = recomputed.point.y - recomputed.slope * recomputed.point.x
    const secondX = 2 - recomputed.slope / 2
    const secondY = -((secondX - 2) ** 2) + 1
    expect(secondY - recomputed.slope * secondX).toBeCloseTo(other, 6)
  })
})


describe("common tangent edit lifecycle", () => {
  function committedCommon() {
    const document = planarDocument()
    document.primitives.push({ id: "fn-2", type: "function", expression: "-(x-2)*(x-2)+1", domain: [-2, 3], samples: 64 })
    const compiled = compileActions(document, [action({ actionId: "function.create_tangent", inputs: { alias: "ct", sourceId: "fn-1", anchor: { kind: "common", otherSourceId: "fn-2", branch: 0 } } })], contextWith(document))
    expect(compiled.diagnostics).toEqual([])
    const committed = commitPatch(document, compiled.operations[0])
    expect(committed.error).toBeUndefined()
    expect(committed.changed).toBe(true)
    return committed.document
  }

  it("recomputes on editing the second source and stops drawing a branch that disappears", () => {
    const document = committedCommon()
    const before = document.primitives.find(p => p.type === "tangent")
    if (before?.type !== "tangent") throw new Error("tangent missing")
    const moved = commitPatch(document, { op: "updatePrimitive", id: "fn-2", patch: { expression: "-(x-2)*(x-2)+0.5" } })
    expect(moved.error).toBeUndefined()
    const after = moved.document.primitives.find(p => p.id === before.id)
    if (after?.type !== "tangent") throw new Error("tangent missing after edit")
    expect(after.status).toBe("approximate")
    expect(after.slope).toBeCloseTo(2 - Math.sqrt(3), 6)
    expect(after.slope).not.toBeCloseTo(before.slope, 4)
    const gone = commitPatch(moved.document, { op: "updatePrimitive", id: "fn-2", patch: { expression: "x*x+1" } })
    expect(gone.error).toBeUndefined()
    expect(gone.document.primitives.find(p => p.id === before.id)).toMatchObject({ status: "undefined", anchor: { kind: "common", otherSourceId: "fn-2", branch: 0 } })
  })

  it("deleting the second source also deletes its dependent tangent", () => {
    const document = committedCommon()
    const removed = commitPatch(document, { op: "deleteObjects", ids: ["fn-2"] })
    expect(removed.error).toBeUndefined()
    expect(removed.document.primitives.some(p => p.type === "tangent")).toBe(false)
  })

  it.each([
    ["ghost", 0, "unsupported_source"],
    ["circle-1", 0, "unsupported_source"],
    ["fn-1", 0, "invalid_anchor"],
    ["fn-2", 2, "invalid_anchor"]
  ])("refuses invalid common anchor %s / %s without operations", (otherSourceId, branch, code) => {
    const document = committedCommon()
    const result = compileActions(document, [action({ actionId: "function.create_tangent", inputs: { alias: "bad", sourceId: "fn-1", anchor: { kind: "common", otherSourceId, branch } } })], contextWith(document))
    expect(result.operations).toEqual([])
    expect(result.diagnostics[0]?.code).toBe(code)
  })

  it.each([["x*x+1", "no_tangent"], ["notAFunc(x)", "unsupported_source"]])("refuses unsolved source %s without an empty tangent", (expression, code) => {
    const document = planarDocument()
    document.primitives.push({ id: "fn-2", type: "function", expression, domain: [-2, 3], samples: 64 })
    const result = compileActions(document, [action({ actionId: "function.create_tangent", inputs: { alias: "bad", sourceId: "fn-1", anchor: { kind: "common", otherSourceId: "fn-2" } } })], contextWith(document))
    expect(result.operations).toEqual([])
    expect(result.diagnostics[0]?.code).toBe(code)
  })
})
