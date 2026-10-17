import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compileActions } from "./index"
import type { ActionContext, DraftAction, IdAllocator } from "./types"

/**
 * **三维工作区里的 `planar.*` 动作 → z=0 的三维图元**（2026-10-17 用户现场）。
 *
 * 现场：模型在 `geometry3d` 草稿里用 `planar.create_point` 画 A–D、再用 `solid.fold`
 * 折出 P/E/F。编译通过、图也“建成了”，但三维画布**不画二维点**，核验器也不收它们 ——
 * 于是四条边、四个角、两条定比分点全部报“点名缺失”，而折片上的 P/E/F 明明在。
 *
 * 用户裁定：**适配**（与“让 create_polyhedron 兼容 1 个面”同一条思路）——
 * 三维文档里的平面动作物化成 **z = 0 的三维图元**：点 → `point3`、线段 → `segment3`、
 * 直线 → `line3`、射线 → `ray3`、折线 → 线段链、圆 → `circle3`（法向 z）。
 * 几何不变（仍在 z = 0 平面上），但**画得出来、也进得了点名表**。
 *
 * 二维工作区的行为**逐字不变**（本文件最后一条钉住）。
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

function context(workspace: "geometry3d" | "conics", document = createEmptyDocument(workspace)): ActionContext {
  return { targetDocument: document, targetWorkspace: workspace, orderedSelection: [], capabilityRevision: "test.1", idAllocator: makeAllocator() }
}

function planar(actionId: string, inputs: Record<string, unknown>): DraftAction {
  return { actionId, actionKey: "planar", factIds: [], inputs } as unknown as DraftAction
}

function primitivesOf(result: ReturnType<typeof compileActions>) {
  return result.operations.flatMap((operation) =>
    operation.op === "addPrimitives" ? operation.primitives : operation.op === "addPrimitive" ? [operation.primitive] : []
  )
}

describe("planar.* in the 3D workspace", () => {
  it("平面点 → z = 0 的 point3（带点名）", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [planar("planar.create_point", { alias: "A", label: "A", points: [{ x: 3, y: 4 }] })], context("geometry3d"))

    expect(result.diagnostics).toEqual([])
    const primitives = primitivesOf(result)
    expect(primitives).toHaveLength(1)
    expect(primitives[0]).toMatchObject({ type: "point3", label: "A", position: { x: 3, y: 4, z: 0 } })
    expect(result.aliasToId).toEqual({ A: primitives[0]!.id })
    // 不再是二维 `point`。
    expect(primitives.some((primitive) => primitive.type === "point")).toBe(false)
  })

  it("平面线段 → segment3，端点落在 z = 0；已有同名点时**复用**它，不另造一个点", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives.push({ id: "existing-a", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" }, label: "A" })
    const result = compileActions(document, [planar("planar.create_segment", { alias: "AB", points: [{ x: 0, y: 0 }, { x: 8, y: 0 }] })], context("geometry3d", document))

    expect(result.diagnostics).toEqual([])
    const primitives = primitivesOf(result)
    const segment = primitives.find((primitive) => primitive.type === "segment3")
    expect(segment).toBeDefined()
    expect((segment as unknown as { pointIds: string[] }).pointIds[0]).toBe("existing-a")
    // A 没有被重复创建；只补了 B。
    expect(primitives.filter((primitive) => primitive.type === "point3")).toHaveLength(1)
    expect((segment as unknown as { pointIds: string[] }).pointIds).toHaveLength(2)
    expect(result.aliasToId).toEqual({ AB: segment!.id })
  })

  it("平面折线 → 一串可见的 segment3（顶点 z = 0）", () => {
    const points = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 9, y: 2 }, { x: 7.5, y: 4 }]
    const result = compileActions(createEmptyDocument("geometry3d"), [planar("planar.create_polyline", { alias: "quad", points })], context("geometry3d"))

    expect(result.diagnostics).toEqual([])
    const segments = primitivesOf(result).filter((primitive) => primitive.type === "segment3")
    expect(segments).toHaveLength(3)
    expect(result.aliasToId.quad).toBe(segments[0]!.id)
  })

  it("平面直线 / 射线 → line3 / ray3", () => {
    const line = compileActions(createEmptyDocument("geometry3d"), [planar("planar.create_line", { alias: "l", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })], context("geometry3d"))
    const ray = compileActions(createEmptyDocument("geometry3d"), [planar("planar.create_ray", { alias: "r", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })], context("geometry3d"))

    expect(primitivesOf(line).some((primitive) => primitive.type === "line3")).toBe(true)
    expect(primitivesOf(ray).some((primitive) => primitive.type === "ray3")).toBe(true)
  })

  it("平面圆 → circle3（圆心 z = 0、法向 +z）", () => {
    const result = compileActions(createEmptyDocument("geometry3d"), [planar("planar.create_circle", { alias: "c", center: { x: 1, y: 2 }, radius: 3 })], context("geometry3d"))

    expect(result.diagnostics).toEqual([])
    const circle = primitivesOf(result).find((primitive) => primitive.type === "circle3")
    expect(circle).toMatchObject({ center: { x: 1, y: 2, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 3 })
  })

  it("二维工作区的行为逐字不变：还是 point / polyline", () => {
    const point = compileActions(createEmptyDocument("conics"), [planar("planar.create_point", { alias: "A", points: [{ x: 1, y: 2 }] })], context("conics"))
    const polyline = compileActions(createEmptyDocument("conics"), [planar("planar.create_polyline", { alias: "p", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })], context("conics"))

    expect(primitivesOf(point)[0]).toMatchObject({ type: "point", x: 1, y: 2 })
    expect(primitivesOf(polyline)[0]).toMatchObject({ type: "polyline" })
  })
})
