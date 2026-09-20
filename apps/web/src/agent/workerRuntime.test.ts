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
    const response = handleGeometryRequest(compileRequest())

    expect(response.kind).toBe("geometry.compile.result")
    expect(response.requestId).toBe("req-1")
    if (response.kind !== "geometry.compile.result") throw new Error("expected a result")
    expect(response.operations).toHaveLength(1)
    expect(response.document.primitives).toHaveLength(1)
    // 基准文档没有被就地改写（worker 不能拥有调用方的对象）。
    expect(compileRequest().base.primitives).toHaveLength(0)
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
})
