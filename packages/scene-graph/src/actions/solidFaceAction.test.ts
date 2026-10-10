import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compileActions } from "./index"
import type { ActionContext, DraftAction, IdAllocator } from "./types"

/**
 * **`solid.create_face`：立体工作区里的平面多边形 / 面片**（2026-10-10 用户现场）。
 *
 * 现场：题面是"平面四边形 ABCD + 一个翻折片"（**开放曲面**），而 `geometry3d` 原先只能建
 * 闭合多面体 ⇒ 模型只能拿 `solid.create_polyhedron` 去套 ⇒ 信封当场拒
 *（`a polyhedron needs at least four faces`）⇒ 用户看到的是 `budget exhausted: budget_repair`。
 *
 * 图元层（`face3`）早就有（手工工具「绘制空间面」用的就是它），缺的只是这个动作入口。
 * 本文件钉住两件事：**物化出什么**（顶点 + 棱 + 一只面）与**什么时候拒**
 *（与手工工具同口径：至少三点、互异、不共线、共面）。
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

function faceAction(vertices: { x: number; y: number; z: number }[], vertexNames?: string[]): DraftAction {
  return { actionId: "solid.create_face", actionKey: "quad", factIds: [], inputs: { alias: "quad", vertices, label: "平面四边形 ABCD", ...(vertexNames === undefined ? {} : { vertexNames }) } } as unknown as DraftAction
}

describe("solid.create_face", () => {
  it("物化出顶点、闭合的棱与一只面，并把 alias 指向那只面", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [faceAction(SQUARE, ["A", "B", "C", "D"])], context())

    expect(result.diagnostics).toEqual([])
    const primitives = result.operations.flatMap((operation) => (operation.op === "addPrimitives" ? operation.primitives : []))
    expect(primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(4)
    expect(primitives.filter((primitive) => primitive.type === "edge3")).toHaveLength(4)
    const faces = primitives.filter((primitive): primitive is Extract<typeof primitive, { type: "face3" }> => primitive.type === "face3")
    expect(faces).toHaveLength(1)
    expect(faces[0]?.pointIds).toHaveLength(4)
    expect(faces[0]?.edgeIds).toHaveLength(4)
    // 点名落到点上（模型给的 vertexNames 就是"关系按下标认顶点"的依据）。
    expect(primitives.filter((primitive) => primitive.type === "point3").map((primitive) => ("label" in primitive ? primitive.label : undefined))).toEqual(["A", "B", "C", "D"])
    // alias → 那只面（后续动作/核验要按 alias 找它）。
    expect(result.aliasToId).toEqual({ quad: faces[0]?.id })
  })

  it("**少于三个顶点就一条图元都不产出**（与手工工具同口径）", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [faceAction(SQUARE.slice(0, 2))], context())

    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toContain("degenerate_face")
  })

  it("**共线的三点被拒**（'共面'放行不了没有面积的面）", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [faceAction([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }])], context())

    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toContain("degenerate_face")
    expect(result.diagnostics.map((entry) => entry.message).join(" ")).toContain("共线")
  })

  it("**不共面的四点被拒**（面必须是平的）", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [faceAction([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }])], context())

    expect(result.operations).toEqual([])
    expect(result.diagnostics.map((entry) => entry.code)).toContain("degenerate_face")
  })
})
