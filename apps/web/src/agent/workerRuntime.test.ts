import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { createWorkerRequest, WORKER_SCHEMA_VERSION } from "./workerContracts"
import { handleGeometryRequest } from "./workerRuntime"

/**
 * 几何 worker 的**规则**（与 `geometry.worker.ts` 的"接线"分开测）。
 *
 * 规则里最重要的两条：
 * 1. 失败**不抛异常跨边界**，而是收敛成 `geometry.error`（异常穿过 `postMessage` 会变成
 *    `ErrorEvent`，调用方拿不到原因码，用户只看到"没反应"）；
 * 2. 编译与执行走 `compileActions` + `commitTransaction` 这条**唯一**的写入路径。
 */
const envelope = { runId: "run-1", requestId: "req-1", draftId: "draft_1", draftVersion: 1 }

function compileRequest(x = 1) {
  return createWorkerRequest("geometry.compile", envelope, {
    base: createEmptyDocument("conics"),
    actions: [{ actionId: "planar.create_point", actionKey: "p", factIds: [], inputs: { alias: "p", points: [{ x, y: 0 }] } }]
  })
}

describe("geometry worker runtime", () => {
  it("compiles and applies actions, returning both the operations and the document", () => {
    // **同一个 base 对象**：以前这里写成 `compileRequest().base`（每次新建一份空文档），
    // 那条隔离断言永远为真、检测不到"传进去的文档被就地改写"（Fix round 1 / M21）。
    const base = createEmptyDocument("conics")
    const request = createWorkerRequest("geometry.compile", envelope, {
      base,
      actions: [{ actionId: "planar.create_point", actionKey: "p", factIds: [], inputs: { alias: "p", points: [{ x: 1, y: 0 }] } }]
    })

    const response = handleGeometryRequest(request)

    expect(response.kind).toBe("geometry.compile.result")
    expect(response.requestId).toBe("req-1")
    if (response.kind !== "geometry.compile.result") throw new Error("expected a result")
    expect(response.operations).toHaveLength(1)
    expect(response.document.primitives).toHaveLength(1)
    // 基准文档没有被就地改写（worker 不能拥有调用方的对象）。
    expect(base.primitives).toHaveLength(0)
    expect(request.base.primitives).toHaveLength(0)
  })

  it("reports a refused action as a typed error instead of throwing", () => {
    // 圆锥曲线工作区建不了立方体：动作层会拒。
    const request = createWorkerRequest("geometry.compile", envelope, {
      base: createEmptyDocument("conics"),
      actions: [{ actionId: "solid.create_template", actionKey: "c", factIds: [], inputs: { alias: "c", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } } }]
    })

    const response = handleGeometryRequest(request)

    expect(response.kind).toBe("geometry.error")
    if (response.kind !== "geometry.error") throw new Error("expected an error")
    expect(response.code).toBe("compile_failed")
    expect(response.detail.length).toBeGreaterThan(0)
  })

  /**
   * 与 `draftStore.test.ts` 里那条同源：worker 也是"动作层 + 分配器"的调用方，
   * 所以非空基准文档上的同类新建必须也能落下去（以前会撞 id → `commit_rejected`）。
   */
  it("compiles onto a base document that already uses the id the allocator would mint", () => {
    const base = createEmptyDocument("conics")
    base.primitives = [{ id: "point-1", type: "point", x: 9, y: 9 }] as never
    const request = createWorkerRequest("geometry.compile", envelope, {
      base,
      actions: [{ actionId: "planar.create_point", actionKey: "p", factIds: [], inputs: { alias: "p", points: [{ x: 1, y: 0 }] } }]
    })

    const response = handleGeometryRequest(request)

    expect(response.kind).toBe("geometry.compile.result")
    if (response.kind !== "geometry.compile.result") throw new Error("expected a result")
    expect(response.document.primitives.map((primitive) => primitive.id)).toEqual(["point-1", "point-2"])
  })

  it("keeps a real error message when the geometry path throws", () => {
    // 构造一份"会让内核抛"的文档：revision 不是数字时内容指纹会炸。
    const broken = { ...createEmptyDocument("conics"), revision: Number.NaN } as never
    const request = createWorkerRequest("geometry.compile", envelope, { base: broken, actions: compileRequest().actions })

    const response = handleGeometryRequest(request)

    // 无论内部分支怎么走，边界上永远是"一条带原因码的响应"，绝不是一个抛出去的异常。
    expect(["worker_threw", "commit_rejected", "compile_failed"]).toContain(response.kind === "geometry.error" ? response.code : "unknown")
    expect(response.schemaVersion).toBe(WORKER_SCHEMA_VERSION)
  })

  it("checks operations without applying them when asked to", () => {
    const base = createEmptyDocument("conics")
    // 与 `store.test.ts` 里同一形状的操作：这是仓库里已知能通过 `validatePatch` 的最小写法。
    const request = createWorkerRequest("geometry.check", envelope, { base, operations: [{ op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 1, y: 0 } }] })

    const response = handleGeometryRequest(request)

    expect(response.kind).toBe("geometry.compile.result")
    // `check` 也要能说明"这批操作会得到什么"，否则调用方还得再问一次。
    if (response.kind === "geometry.compile.result") expect(response.document.primitives).toHaveLength(1)
    expect(base.primitives).toHaveLength(0)
  })

  it("rejects an invalid operation through the check path too", () => {
    // 第二条操作引用一个不存在的对象：即便第一条合法，整批也必须被拒（all-or-nothing）。
    const request = createWorkerRequest("geometry.check", envelope, {
      base: createEmptyDocument("conics"),
      operations: [
        { op: "addPrimitive", primitive: { id: "point-1", type: "point", x: 1, y: 0 } },
        { op: "toggleVisibility", id: "point-does-not-exist", visible: false }
      ]
    })

    const response = handleGeometryRequest(request)

    expect(response.kind).toBe("geometry.error")
    if (response.kind === "geometry.error") expect(["patch_invalid", "commit_rejected"]).toContain(response.code)
  })

  /**
   * **diff / check / artifact 信封**（Task 2.4 Step 4）。
   *
   * 计划原文："Connect the geometry worker to the existing compiler and return
   * **diff/check/artifact envelopes**."
   *
   * 在这三样之前，响应只说"操作列表 + 结果文档"—— 那对调用方是不够的：
   * - 它没法回答"**到底改了什么**"，只能自己把两份文档对着比（而两份文档可能很大）；
   * - 它没法回答"这批操作**检查过了吗**"（走的是哪条路径、校验有没有全过）；
   * - 它没法回答"**产物是哪一份**"（哪一版草稿、拿哪个基准算出来的），
   *   而这三件事恰恰是"用户确认的是不是我给他看的那一份"要用的。
   */
  it("returns a diff envelope so the caller can say what actually changed", () => {
    const response = handleGeometryRequest(compileRequest())

    if (response.kind !== "geometry.compile.result") throw new Error("expected a result")
    expect(response.changed).toBe(true)
    expect(response.diff.added).toHaveLength(1)
    expect(response.diff.removed).toEqual([])
    expect(response.diff.updated).toEqual([])
    // 前后指纹：调用方靠它判断"这份产物是不是从我给的那份算出来的"。
    expect(response.beforeHash).not.toBe(response.afterHash)
    expect(response.beforeHash.length).toBeGreaterThan(0)
  })

  it("returns a check envelope that says whether the batch was validated", () => {
    const response = handleGeometryRequest(compileRequest())

    if (response.kind !== "geometry.compile.result") throw new Error("expected a result")
    expect(response.checked).toBe(true)
    expect(response.problems).toEqual([])
  })

  it("returns an artifact envelope tying the result to the draft it came from", () => {
    const response = handleGeometryRequest(compileRequest())

    if (response.kind !== "geometry.compile.result") throw new Error("expected a result")
    // 信封的五个字段来自请求，逐字回带 —— "这份产物是哪一版草稿的"必须能对上。
    expect(response.artifact).toEqual({ runId: "run-1", draftId: "draft_1", draftVersion: 1, requestId: "req-1" })
  })

  it("reports a no-op batch as unchanged instead of pretending something happened", () => {
    // 把可见性设成它已经是的值：语义没有变化。
    const base = createEmptyDocument("conics")
    base.primitives.push({ id: "point-1", type: "point", x: 1, y: 0 } as never)
    const request = createWorkerRequest("geometry.check", envelope, { base, operations: [{ op: "toggleVisibility", id: "point-1", visible: true }] })

    const response = handleGeometryRequest(request)

    if (response.kind !== "geometry.compile.result") throw new Error("expected a result")
    expect(response.changed).toBe(false)
    expect(response.diff).toEqual({ added: [], removed: [], updated: [] })
  })

  /**
   * **斜棱柱在隔离草稿里编译，真实文档一动不动**（Solid/Prism 切片 Task 5）。
   *
   * 这是计划对 Agent 路径的两条硬要求合一：
   * - `solid.create_prism` 从动作层一路通到几何（底面多边形 + 向量 → 顶点 / 棱 / 面）；
   * - 编译发生在**草稿/ worker 的基准文档**上，调用方手里那份文档不许被就地改写
   *   （规格 §1.2："模型只能提出声明式计划，不能直接修改真实文档"）。
   */
  it("compiles an oblique prism into an isolated draft and leaves the live document unchanged", () => {
    const base = createEmptyDocument("geometry3d")
    const request = createWorkerRequest("geometry.compile", envelope, {
      base,
      actions: [{
        actionId: "solid.create_prism",
        actionKey: "prism",
        factIds: [],
        inputs: {
          alias: "prism",
          basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 5, y: 2, z: 0 }, { x: 1, y: 2, z: 0 }],
          vector: { x: 1, y: 0.5, z: 3 }
        }
      }]
    })

    const response = handleGeometryRequest(request)

    expect(response.kind).toBe("geometry.compile.result")
    if (response.kind !== "geometry.compile.result") throw new Error(`expected a result, got ${response.code}: ${response.detail}`)

    // 一次 `addPrimitives`：4 顶点 ×2 + 12 棱 + 6 面 + 1 实体 = 27 个图元，原子落地。
    expect(response.operations).toHaveLength(1)
    const solid = response.document.primitives.find((primitive) => primitive.type === "polyhedron3")
    expect(solid?.type).toBe("polyhedron3")
    if (solid?.type !== "polyhedron3") throw new Error("expected a polyhedron")
    expect(solid.vertexIds).toHaveLength(8)
    expect(solid.edgeIds).toHaveLength(12)
    expect(solid.faceIds).toHaveLength(6)
    // 构造描述是真源（规格 §1.2）：它必须原样落在文档里，而不是只剩一份拓扑。
    expect(solid.construction).toEqual({
      kind: "prism",
      base: { polygon: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 5, y: 2, z: 0 }, { x: 1, y: 2, z: 0 }] },
      vector: { x: 1, y: 0.5, z: 3 }
    })
    // 子 id 确定性命名（规格 §3.3）：重算之后名字不变，下游引用才不会集体失效。
    expect(solid.vertexIds[0]).toBe(`${solid.id}:v0`)
    expect(solid.faceIds.at(-1)).toBe(`${solid.id}:f5`)

    // 调用方那份文档**一个图元都没多**：草稿是隔离的。
    expect(base.primitives).toHaveLength(0)
  })

  /**
   * **六层编译管线在 worker 这条真实入口上生效**（Agent DSL 切片 Task 4）。
   *
   * 两条可观察的行为变化：
   * 1. **缺省字段由审计回填**：棱柱没给拉伸向量时，以前会以 `degenerate_prism`
   *    （向量非有限）直接失败；现在按默认策略回填"高 3 的直棱柱"并如实编译出来；
   * 2. **同一批里的依赖顺序**：中点引用同一批里刚建的棱柱的某条棱 —— 动作编译器
   *    看不到同一批前面的动作，所以这条只能靠逐笔推进工作文档才能成立。
   * 基准文档在这两种情况下都**一动不动**（隔离草稿）。
   */
  it("completes an audited omission and resolves dependencies inside one batch", () => {
    const base = createEmptyDocument("geometry3d")
    const request = createWorkerRequest("geometry.compile", envelope, {
      base,
      actions: [
        {
          actionId: "solid.create_prism",
          actionKey: "prism",
          factIds: [],
          // 刻意**不给** vector：默认策略回填"高 3 的直棱柱"。
          inputs: { alias: "prism", basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }] }
        },
        {
          actionId: "dynamic.create_bound_point",
          actionKey: "mid",
          factIds: [],
          // `{scope:"draft"}` 是**传输形状**：引用会在编译期被解析成真 id
          //（`PlanEnvelope.actions` 的类型是解析之后的形状，所以这里断言一次）。
          inputs: { alias: "E", host: { scope: "draft", alias: "prism" }, hostSub: 0, parameter: 0.5 }
        }
      ] as unknown as Parameters<typeof createWorkerRequest<"geometry.compile">>[2]["actions"]
    })

    const response = handleGeometryRequest(request)

    expect(response.kind).toBe("geometry.compile.result")
    if (response.kind !== "geometry.compile.result") throw new Error(`expected a result, got ${response.code}: ${response.detail}`)

    const solid = response.document.primitives.find((primitive) => primitive.type === "polyhedron3")
    expect(solid?.type).toBe("polyhedron3")
    if (solid?.type !== "polyhedron3") throw new Error("expected a polyhedron")
    // 回填的默认向量 = 规格 §6.3 的"高 3 的直棱柱"。
    expect(solid.construction).toMatchObject({ kind: "prism", vector: { x: 0, y: 0, z: 3 } })
    // 中点落在**同一批**建出来的那条棱上（solid-1:e0），参数是题目的显式约束 0.5。
    const midpoint = response.document.primitives.find((primitive) => primitive.id === "point3-1")
    expect(midpoint).toMatchObject({ type: "point3", binding: { kind: "onHost", hostId: "solid-1:e0", parameter: 0.5 } })
    // 隔离：调用方那份基准文档里一个图元都没多。
    expect(base.primitives).toHaveLength(0)
  })

  /**
   * **worker 这条入口也要把用户原话带进审计**（Fix round 1 / C3）。
   *
   * 与 `draftStore.stage` 同一件事：没有原话时"任意/恒定必须保留符号参数"这条判据
   * 永远不生效，缺省会被当成"有安全默认"回填成一组特值 —— 那正是规格 §6.3 禁止的。
   */
  it("carries the user's words so an invariant request asks instead of taking a witness", () => {
    const base = createEmptyDocument("geometry3d")
    const request = createWorkerRequest("geometry.compile", envelope, {
      base,
      prompt: "画一个任意棱柱",
      actions: [{
        actionId: "solid.create_prism",
        actionKey: "prism",
        factIds: [],
        // 底面与向量都缺：题目说"任意"时不该替它取特值（传输形状，见 `parsePlanEnvelope`）。
        inputs: { alias: "prism" }
      }] as unknown as Parameters<typeof createWorkerRequest<"geometry.compile">>[2]["actions"]
    })

    const response = handleGeometryRequest(request)

    expect(response.kind).toBe("geometry.error")
    if (response.kind === "geometry.error") {
      expect(response.code).toBe("compile_failed")
      expect(response.detail).toContain("needs_concrete_value")
    }
    expect(base.primitives).toHaveLength(0)
  })

  it("refuses a prism with a zero extrusion vector instead of writing a flat solid", () => {    const request = createWorkerRequest("geometry.compile", envelope, {
      base: createEmptyDocument("geometry3d"),
      actions: [{
        actionId: "solid.create_prism",
        actionKey: "prism",
        factIds: [],
        inputs: { alias: "prism", basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], vector: { x: 0, y: 0, z: 0 } }
      }]
    })

    const response = handleGeometryRequest(request)

    expect(response.kind).toBe("geometry.error")
    if (response.kind === "geometry.error") {
      expect(response.code).toBe("compile_failed")
      expect(response.detail).toContain("degenerate_prism")
    }
  })

  /**
   * **M2（评审）：占用集的生产接线必须有一条 worker 级证据。**
   *
   * 分配器的占用集是在 `handleGeometryRequest` 里从**基准文档的 primitive id** 现取的
   * （`workerRuntime.ts` 的 `createIdAllocator(request.base.primitives.map(...))`）。
   * 之前的"跳过已占用 id"只用测试自造的 `ActionContext` 验过，
   * 而 worker 的用例都从空文档出发 —— 于是"非空画布上新建棱柱会不会撞 `solid-1`"这条
   * 恰恰没有被任何用例从**真实入口**走过（真实现场就是这么撞的：`run-6-mubf109e`）。
   */
  it("names a new prism after the ids the live document already occupies", () => {
    const base = createEmptyDocument("geometry3d")
    base.primitives = [{ id: "solid-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } }] as never
    const request = createWorkerRequest("geometry.compile", envelope, {
      base,
      actions: [{
        actionId: "solid.create_prism",
        actionKey: "prism",
        factIds: [],
        inputs: {
          alias: "prism",
          basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 0, y: 3, z: 0 }],
          vector: { x: 0, y: 0, z: 3 }
        }
      }]
    })

    const response = handleGeometryRequest(request)

    expect(response.kind).toBe("geometry.compile.result")
    if (response.kind !== "geometry.compile.result") throw new Error(`expected a result, got ${response.code}: ${response.detail}`)

    const solid = response.document.primitives.find((primitive) => primitive.type === "polyhedron3")
    expect(solid?.id).toBe("solid-2")
    if (solid?.type !== "polyhedron3") throw new Error("expected a polyhedron")
    // 子 id 一律挂在**新** Solid 名下，一个都不许撞到已占用的 `solid-1`。
    expect(solid.vertexIds).toEqual(["solid-2:v0", "solid-2:v1", "solid-2:v2", "solid-2:v3", "solid-2:v4", "solid-2:v5"])
    expect(solid.edgeIds.every((id) => id.startsWith("solid-2:"))).toBe(true)
    expect(solid.faceIds.every((id) => id.startsWith("solid-2:"))).toBe(true)
    // 落下来的文档里 id 不重复（`validateDocument` 的硬要求）。
    const ids = response.document.primitives.map((primitive) => primitive.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain("solid-1")
  })
})
