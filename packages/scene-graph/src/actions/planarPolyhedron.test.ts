import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compileActions } from "./index"
import type { ActionContext, DraftAction, IdAllocator } from "./types"

/**
 * **`solid.create_polyhedron` 的“单面”形态**（2026-10-17 用户现场）。
 *
 * 现场那道题的第一笔是“平面四边形 ABCD”，模型写的是 `solid.create_polyhedron`
 * （`faces: []` / `faces: [[0,1,2,3]]`），信封回的是
 * `a polyhedron needs at least four faces` —— 而模型**两轮都只想到这一个动作**。
 *
 * 用户裁定：**让现有动作兼容 1 个面**，而不是再教模型认一个新动作名。
 * 所以 1 个面环 = 平面多边形（物化成 `face3` + 它的顶点 / 棱），≥4 个面仍旧走内核的闭合体；
 * 2–3 个面既不是平面多边形、也围不出闭合体，**明确拒绝**并说清该用哪一条。
 *
 * 本文件钉住：物化出什么、环序优先于顶点序、以及什么时候拒。
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

function context(): ActionContext {
  return { targetDocument: createEmptyDocument("geometry3d"), targetWorkspace: "geometry3d", orderedSelection: [], capabilityRevision: "test.1", idAllocator: makeAllocator() }
}

const SQUARE = [{ x: 0, y: 0, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 8, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }]

function polyAction(
  vertices: { x: number; y: number; z: number }[],
  faces: number[][],
  vertexNames?: string[]
): DraftAction {
  return {
    actionId: "solid.create_polyhedron",
    actionKey: "quad",
    factIds: [],
    inputs: { alias: "quad", vertices, faces, label: "平面四边形 ABCD", ...(vertexNames === undefined ? {} : { vertexNames }) }
  } as unknown as DraftAction
}

function addedPrimitives(result: ReturnType<typeof compileActions>) {
  return result.operations.flatMap((operation) => (operation.op === "addPrimitives" ? operation.primitives : []))
}

describe("solid.create_polyhedron with a single face", () => {
  it("物化出一只平面多边形（顶点 + 闭合的棱 + 一只面），不是 polyhedron3", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [polyAction(SQUARE, [[0, 1, 2, 3]], ["A", "B", "C", "D"])], context())

    expect(result.diagnostics).toEqual([])
    const primitives = addedPrimitives(result)
    expect(primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(4)
    expect(primitives.filter((primitive) => primitive.type === "edge3")).toHaveLength(4)
    expect(primitives.filter((primitive) => primitive.type === "polyhedron3")).toHaveLength(0)

    const faces = primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "face3" }> => primitive.type === "face3")
    expect(faces).toHaveLength(1)
    expect(faces[0]?.pointIds).toHaveLength(4)
    expect(faces[0]?.edgeIds).toHaveLength(4)
    // 点名按顶点下标落到点上。
    expect(primitives.filter((primitive) => primitive.type === "point3").map((primitive) => ("label" in primitive ? primitive.label : undefined))).toEqual(["A", "B", "C", "D"])
    // alias → 那只面（后续折 / 核验按 alias 找它）。
    expect(result.aliasToId).toEqual({ quad: faces[0]?.id })
  })

  it("**面环的顺序优先于顶点数组的顺序**：环从 B 开始，点与点名就按 B、C、D、A 落", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [polyAction(SQUARE, [[1, 2, 3, 0]], ["A", "B", "C", "D"])], context())

    expect(result.diagnostics).toEqual([])
    const primitives = addedPrimitives(result)
    const points = primitives.filter((primitive) => primitive.type === "point3")
    expect(points.map((primitive) => ("label" in primitive ? primitive.label : undefined))).toEqual(["B", "C", "D", "A"])
    expect(points.map((primitive) => ("position" in primitive ? primitive.position : undefined))).toEqual([SQUARE[1], SQUARE[2], SQUARE[3], SQUARE[0]])
  })

  it("三角形也可以：3 个顶点 + 1 个面环", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [polyAction([SQUARE[0]!, SQUARE[1]!, SQUARE[3]!], [[0, 1, 2]], ["A", "B", "D"])], context())

    expect(result.diagnostics).toEqual([])
    const primitives = addedPrimitives(result)
    expect(primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(3)
    expect(primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(1)
  })

  it("**单个面必须用上每一个顶点**：环里漏了点就拒，且一条图元都不产出", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [polyAction(SQUARE, [[0, 1, 2]], ["A", "B", "C", "D"])], context())

    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toContain("degenerate_face")
    expect(result.diagnostics.map((entry) => entry.message).join(" ")).toContain("每一个顶点")
  })

  it("**2–3 个面仍旧拒绝**：那不是平面多边形，也围不出闭合体", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [polyAction(SQUARE, [[0, 1, 2], [0, 1, 3]])], context())

    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toContain("unsupported_face_count")
    expect(result.diagnostics.map((entry) => entry.message).join(" ")).toContain("1 个面")
  })
})
