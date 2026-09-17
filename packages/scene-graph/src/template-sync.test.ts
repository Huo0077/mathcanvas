import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { applyOperation, recomputeDerivedObjects } from "./index"

/**
 * 模板实体的生成顶点只在**模板参数真的变了**的时候才按参数重写。
 * 旧实现每次重算都无条件重跑 `buildSolidTemplate` 并覆盖全部生成顶点：既让每次操作都付
 * O(模板面数) 的开销，也会把任何绕过 `updatePrimitive` 的顶点位移静默抹掉。
 */
describe("template topology sync", () => {
  function cubeDocument() {
    const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } }
    const built = buildSolidTemplate(cube)
    const document = createEmptyDocument("geometry3d")
    document.primitives = [cube, ...built.primitives]
    return { document, vertexId: built.primitives.find((primitive) => primitive.type === "point3")!.id }
  }

  const vertexXs = (document: ReturnType<typeof cubeDocument>["document"]) =>
    [...new Set(document.primitives.filter((primitive) => primitive.type === "point3").map((primitive) => primitive.position.x))].sort((first, second) => first - second)

  it("rewrites generated vertices when the template parameters change", () => {
    const { document } = cubeDocument()
    expect(vertexXs(document)).toEqual([-1, 1])

    const resized = applyOperation(document, { op: "updatePrimitive", id: "cube-1", patch: { size3: { x: 4, y: 2, z: 2 } } })

    expect(vertexXs(resized.document)).toEqual([-1, 3])
  })

  it("leaves generated vertices alone when an unrelated object changed", () => {
    const { document, vertexId } = cubeDocument()
    // 模拟"文档里这个顶点的坐标被改过"（外部工具、旧版本文件，或任何绕过 updatePrimitive 的路径）。
    const edited = {
      ...document,
      primitives: document.primitives.map((primitive) => primitive.id === vertexId && primitive.type === "point3" ? { ...primitive, position: { x: 7, y: 7, z: 7 } } : primitive)
    }

    const recomputed = recomputeDerivedObjects(edited, ["some-unrelated-object"])

    const vertex = recomputed.primitives.find((primitive) => primitive.id === vertexId)
    expect(vertex?.type === "point3" ? vertex.position : null).toEqual({ x: 7, y: 7, z: 7 })
  })

  it("still repairs the whole document on a full recompute", () => {
    const { document, vertexId } = cubeDocument()
    const edited = {
      ...document,
      primitives: document.primitives.map((primitive) => primitive.id === vertexId && primitive.type === "point3" ? { ...primitive, position: { x: 7, y: 7, z: 7 } } : primitive)
    }

    // 打开文件走的是全量重算：这时必须按模板参数把顶点修正回来。
    const repaired = recomputeDerivedObjects(edited)
    const vertex = repaired.primitives.find((primitive) => primitive.id === vertexId)
    expect(vertex?.type === "point3" ? vertex.position : null).not.toEqual({ x: 7, y: 7, z: 7 })
  })
})
