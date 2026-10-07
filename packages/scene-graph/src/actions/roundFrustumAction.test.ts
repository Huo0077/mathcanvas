import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compileActions } from "./index"
import type { ActionContext, DraftAction, IdAllocator } from "./types"

/**
 * **`solid.create_round_frustum`**（S4.3）：两个半径 + 高 + 分段数 ⇒ 一只**多边形近似**的多面体。
 *
 * 判据从**产出的那批图元**自己算，不读构造方的自述：
 * ① 恰好一只 `polyhedron3` + `segments × 2` 个点 + `segments + 2` 个面；
 * ② 顶点按 `vertexIds` 顺序：前 `segments` 个在下底（到中心轴等距 `radiusBottom`、同高），
 *    后 `segments` 个在上底（等距 `radiusTop`、`z + height`）—— **上下底不能画反**；
 * ③ 每个侧面都是**四边形**（三角形的话那是圆锥）；
 * ④ **两个半径相等 ⇒ 一条操作都不产出**，诊断说明那是圆柱；
 * ⑤ 非立体几何工作区 ⇒ `workspace_mismatch`。
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

function contextWith(document: GeometryDocument): ActionContext {
  return { targetDocument: document, targetWorkspace: document.workspace, orderedSelection: [], capabilityRevision: "test.1", idAllocator: makeAllocator() }
}

const action = (inputs: Record<string, unknown>): DraftAction =>
  ({ actionKey: "k1", factIds: [], actionId: "solid.create_round_frustum", inputs }) as unknown as DraftAction

const compile = (inputs: Record<string, unknown>, document = createEmptyDocument("geometry3d")) =>
  compileActions(document, [action(inputs)], contextWith(document))

interface Primitive {
  id: string
  type: string
  position?: { x: number; y: number; z: number }
  pointIds?: string[]
  vertexIds?: string[]
}

const primitivesOf = (result: ReturnType<typeof compileActions>): Primitive[] =>
  result.operations.flatMap((entry) => (entry.op === "addPrimitives" ? (entry.primitives as unknown as Primitive[]) : []))

const SEGMENTS = 48

describe("solid.create_round_frustum", () => {
  it("emits one polyhedron with two real rings, and the top ring is the smaller one", () => {
    const result = compile({ alias: "frustum", center: { x: 0, y: 0, z: 0 }, radiusBottom: 2, radiusTop: 1, height: 3 })
    expect(result.diagnostics).toEqual([])

    const primitives = primitivesOf(result)
    const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]))
    const solids = primitives.filter((primitive) => primitive.type === "polyhedron3")
    expect(solids).toHaveLength(1)
    expect(primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(SEGMENTS * 2)
    expect(primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(SEGMENTS + 2)

    const vertexIds = solids[0]!.vertexIds!
    expect(vertexIds).toHaveLength(SEGMENTS * 2)
    const positions = vertexIds.map((id) => byId.get(id)!.position!)
    for (const point of positions.slice(0, SEGMENTS)) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(2, 9)
      expect(point.z).toBeCloseTo(0, 9)
    }
    for (const point of positions.slice(SEGMENTS)) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(1, 9)
      expect(point.z).toBeCloseTo(3, 9)
    }
    // 侧面四边形：`face3` 的 `pointIds` 长度分布应当是「48 个四边形 + 2 个 48 边形底面」。
    const sizes = primitives.filter((primitive) => primitive.type === "face3").map((face) => face.pointIds!.length)
    expect(sizes.filter((size) => size === 4)).toHaveLength(SEGMENTS)
    expect(sizes.filter((size) => size === SEGMENTS)).toHaveLength(2)
  })

  it("produces no operation at all when the two radii are equal, and says that is a cylinder", () => {
    const result = compile({ alias: "frustum", center: { x: 0, y: 0, z: 0 }, radiusBottom: 2, radiusTop: 2, height: 3 })
    expect(primitivesOf(result)).toHaveLength(0)
    expect(result.diagnostics.map((entry) => entry.code)).toContain("invalid_round_frustum")
    expect(result.diagnostics.map((entry) => entry.message).join(" ")).toContain("圆柱")
  })

  it("refuses a non-solid workspace", () => {
    const planar = createEmptyDocument("conics")
    const result = compile({ alias: "frustum", center: { x: 0, y: 0, z: 0 }, radiusBottom: 2, radiusTop: 1, height: 3 }, planar)
    expect(primitivesOf(result)).toHaveLength(0)
    expect(result.diagnostics.map((entry) => entry.code)).toContain("workspace_mismatch")
  })
})
