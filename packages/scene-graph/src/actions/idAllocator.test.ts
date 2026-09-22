import { createEmptyDocument, encodeMgeo, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { applyOperation } from "../operations"
import { compileActions, compileSolidPrism, createIdAllocator } from "./index"
import type { ActionContext, DraftAction } from "./types"

/**
 * **分配器的"占用"语义**（2026-09-21 补，来自真实现场）。
 *
 * 真缺陷：`createIdAllocator()` 的计数器从 1 开始，**完全不知道目标文档里已经有哪些 id**。
 * 于是在一个已经有 `solid-1` 的画布上，Agent 新建的第一个立体又被分配成 `solid-1` →
 * `validatePatch` 判 `duplicate object id` → 整轮运行以 `compile_failed` 结束
 * （现场见 `apps/web/src/agent/draftStore.test.ts` 里那条用例与 run 账本 `run-6-mubf109e`）。
 *
 * 这里钉住两条：
 * 1. **不发出已被占用的 id**；
 * 2. **别名幂等**依旧成立（同一 alias 再来一次还是同一个 id）—— 修复不许把这条弄丢。
 */
describe("id allocator occupancy", () => {
  it("skips ids the target document already occupies", () => {
    const allocator = createIdAllocator(["solid-1", "point-1", "point-2"])

    // 同类已占两个 → 从 point-3 开始。
    expect(allocator.allocate("point", "A")).toBe("point-3")
    expect(allocator.allocate("point", "B")).toBe("point-4")
    // 别的 kind 的已占用 id 不影响这一族。
    expect(allocator.allocate("solid", "cube")).toBe("solid-2")
    expect(allocator.allocate("circle", "c")).toBe("circle-1")
  })

  it("keeps alias idempotency while skipping occupied ids", () => {
    const allocator = createIdAllocator(["point-1"])

    expect(allocator.allocate("point", "A")).toBe("point-2")
    expect(allocator.allocate("point", "A")).toBe("point-2")
    expect(allocator.allocate("point", "B")).toBe("point-3")
  })

  it("never hands out an id twice, even with a sparse occupied set", () => {
    const allocator = createIdAllocator(["point-2", "point-5"])

    const ids = ["A", "B", "C", "D"].map((alias) => allocator.allocate("point", alias))

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain("point-2")
    expect(ids).not.toContain("point-5")
  })
})

/**
 * **Solid 的真源与稳定子 id**（Solid/Prism 切片 Task 3）。
 *
 * 规格 §3.3 的两条硬要求：
 * 1. Solid ID 取自**文档占用集**（`createIdAllocator(taken)`），非空画布上新建不许撞 id；
 * 2. 子对象名是 `solidId:v0` / `solidId:e0` / `solidId:f0` 的**确定性**命名 ——
 *    拓扑重算之后名字必须一模一样，否则下游引用（截面 / 交线 / 已绑定的点）会集体失效。
 */
const SQUARE = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]
const TRIANGLE = SQUARE.slice(0, 3)
const OBLIQUE = { x: 1, y: 0.5, z: 3 }

function contextOver(document: GeometryDocument): ActionContext {
  return {
    targetDocument: document,
    targetWorkspace: document.workspace,
    orderedSelection: [],
    capabilityRevision: "test.1",
    // 占用集来自目标文档的**全部**图元 id：这正是"Solid ID 用文档占用集"的落点。
    idAllocator: createIdAllocator(document.primitives.map((primitive) => primitive.id))
  }
}

function prismAction(alias: string): DraftAction {
  return { actionId: "solid.create_prism", actionKey: alias, factIds: [], inputs: { alias, basePolygon: TRIANGLE, vector: OBLIQUE } } as unknown as DraftAction
}

describe("solid prism creation and stable child ids", () => {
  it("skips ids the target document already occupies", () => {
    const document = createEmptyDocument("geometry3d")
    // 画布上已有一只 `solid-1`（比如手工建的立方体）：新棱柱不许也叫 `solid-1`。
    document.primitives = [{ id: "solid-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } }]

    const compiled = compileActions(document, [prismAction("prism")], contextOver(document))

    expect(compiled.diagnostics).toEqual([])
    const ids = compiled.operations.flatMap((operation) => operation.op === "addPrimitives" ? operation.primitives.map((primitive) => primitive.id) : [])
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain("solid-2")
    expect(ids.every((id) => id === "solid-2" || id.startsWith("solid-2:"))).toBe(true)
  })

  it("leaves the live document untouched: the compiler only produces operations", () => {
    const document = createEmptyDocument("geometry3d")
    const before = JSON.stringify(document)

    const compiled = compileActions(document, [prismAction("prism")], contextOver(document))

    expect(compiled.diagnostics).toEqual([])
    expect(compiled.operations.length).toBeGreaterThan(0)
    expect(JSON.stringify(document)).toBe(before)
  })

  it("recreates byte-identical child ids when the topology is rebuilt for the same solid id", () => {
    const first = compileSolidPrism("solid-1", TRIANGLE, OBLIQUE)
    const second = compileSolidPrism("solid-1", TRIANGLE, OBLIQUE)

    expect(first.diagnostics).toEqual([])
    expect(second.diagnostics).toEqual([])
    expect(second.primitives.map((primitive) => primitive.id)).toEqual(first.primitives.map((primitive) => primitive.id))
    // 子 id 的命名口径：`<solidId>:v<i>` / `<solidId>:e<i>` / `<solidId>:f<i>`（规格 §3.3）。
    expect(first.vertexIds).toEqual(["solid-1:v0", "solid-1:v1", "solid-1:v2", "solid-1:v3", "solid-1:v4", "solid-1:v5"])
    expect(first.edgeIds[0]).toBe("solid-1:e0")
    expect(first.faceIds[0]).toBe("solid-1:f0")
    // 构造函数本身也是纯的：同一份输入两次得到同一份几何。
    expect(second.primitives).toEqual(first.primitives)
  })

  it("keeps the construction descriptor as the source of truth on the solid primitive", () => {
    const result = compileSolidPrism("solid-7", TRIANGLE, OBLIQUE)
    const solid = result.primitives.find((primitive) => primitive.id === "solid-7")

    expect(solid?.type).toBe("polyhedron3")
    if (solid?.type !== "polyhedron3") throw new Error("expected a polyhedron")
    expect(solid.construction).toEqual({ kind: "prism", base: { polygon: TRIANGLE }, vector: OBLIQUE })
    /**
     * 棱柱的子对象有**自己的**标签词表（Fix round 2 / M5）。
     *
     * 模板的 `A…Z` / `棱 N` 是模板迁移的判据（`solidTemplates.ts` 按它判断"这个名字是不是自动生成的"），
     * 两族对象共用一套名字的话，将来改任何一边的迁移规则都会误伤另一边。
     * 注意**子 id 不受影响**：规格 §3.3 定的 `solidId:v0 / e0 / f0` 一个字都不许变。
     */
    expect(result.primitives.find((primitive) => primitive.id === "solid-7:v0")?.label).toBe("P1")
    expect(result.primitives.find((primitive) => primitive.id === "solid-7:e0")?.label).toBe("棱柱棱 1")
    expect(result.vertexIds[0]).toBe("solid-7:v0")
    // 生成出来的子对象不许留 `undefined` 值的外观键（JSON 往返会丢键，内存与磁盘必须是同一份数据）。
    for (const primitive of result.primitives) {
      for (const [key, value] of Object.entries(primitive)) expect(value === undefined ? key : undefined).toBeUndefined()
    }
  })

  it("applies to a document whose schema validates and round-trips through the codec", () => {
    const document = createEmptyDocument("geometry3d")
    const compiled = compileActions(document, [prismAction("prism")], contextOver(document))
    expect(compiled.diagnostics).toEqual([])

    let next = document
    for (const operation of compiled.operations) {
      const result = applyOperation(next, operation)
      expect(result.error).toBeUndefined()
      next = result.document
    }

    expect(next.primitives.filter((primitive) => primitive.type === "polyhedron3")).toHaveLength(1)
    // 一只三棱柱：6 顶点 + 9 棱 + 5 面 + 1 实体。
    expect(next.primitives).toHaveLength(21)
    expect(() => encodeMgeo(next)).not.toThrow()
  })

  it("refuses a degenerate prism instead of fabricating a flat solid", () => {
    const document = createEmptyDocument("geometry3d")
    const context = contextOver(document)
    const zeroVector = { actionId: "solid.create_prism", actionKey: "p", factIds: [], inputs: { alias: "p", basePolygon: TRIANGLE, vector: { x: 0, y: 0, z: 0 } } } as unknown as DraftAction

    const compiled = compileActions(document, [zeroVector], context)

    expect(compiled.operations).toEqual([])
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toContain("degenerate_prism")
  })

  it("refuses a prism in a planar workspace", () => {
    const document = createEmptyDocument("conics")
    const compiled = compileActions(document, [prismAction("p")], contextOver(document))

    expect(compiled.operations).toEqual([])
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toContain("workspace_mismatch")
  })
})
