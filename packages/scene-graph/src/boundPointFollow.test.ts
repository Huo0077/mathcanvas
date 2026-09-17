import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { applyOperation, deletionPlan, getAffectedPrimitiveIds, recomputeDerivedObjects } from "./index"

/**
 * 用户反馈："动点的操作很不跟手，有时候约束移动了，动点却留在原地。"
 *
 * 这里查的是**宿主移动后，绑在它上面的空间点有没有跟着重算**：全量重算与"只把改动 id 交给重算"
 * 的增量路径都要查——后者才是拖动与数值编辑真正走的那条。
 */
function cubeWithBoundPoint(kind: "face" | "edge" | "surface") {
  const document = createEmptyDocument("geometry3d")
  const cube = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
  document.primitives = [cube, ...buildSolidTemplate(cube).primitives]
  const topology = document.primitives.find((primitive) => primitive.type === "polyhedron3")
  if (topology?.type !== "polyhedron3") throw new Error("expected the cube topology")
  const faceId = topology.faceIds[0]
  const edgeId = topology.edgeIds[0]
  const binding = kind === "face"
    ? { kind: "onFace" as const, faceId, uv: [0.5, 0.5] as [number, number] }
    : kind === "edge"
      ? { kind: "onHost" as const, hostId: edgeId, parameter: 0.5 }
      : { kind: "onSurface" as const, solidId: "cube-a", uv: [0, 0.5] as [number, number] }
  document.primitives = [...document.primitives, { id: "point-bound", type: "point3" as const, position: { x: 0, y: 0, z: 0 }, binding, label: "P" }]
  const initial = recomputeDerivedObjects(document)
  return { document: initial, faceId, edgeId }
}

describe("a point constrained inside a solid", () => {
  /** 立方体 (-2..2)³ 里绑一个"在实体内"的点：uvw 是包围盒内的比例。 */
  function cubeWithInteriorPoint(uvw: [number, number, number]) {
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-a", type: "cube" as const, origin: { x: -2, y: -2, z: -2 }, size: { x: 4, y: 4, z: 4 } }
    document.primitives = [cube, ...buildSolidTemplate(cube).primitives, {
      id: "point-in",
      type: "point3" as const,
      position: { x: 0, y: 0, z: 0 },
      binding: { kind: "inSolid" as const, solidId: "cube-a", uvw },
      label: "P"
    }]
    return recomputeDerivedObjects(document)
  }

  it("puts the point where the parameter says, inside the solid", () => {
    // uvw = (0.5, 0.5, 0.5) 是立方体中心。
    const document = cubeWithInteriorPoint([0.5, 0.5, 0.5])
    const point = document.primitives.find((primitive) => primitive.id === "point-in")
    if (point?.type !== "point3") throw new Error("expected the bound point")
    expect(point.position).toEqual({ x: 0, y: 0, z: 0 })

    // uvw = (0.75, 0.25, 0.5) → (1, -1, 0)。
    const off = cubeWithInteriorPoint([0.75, 0.25, 0.5]).primitives.find((primitive) => primitive.id === "point-in")
    if (off?.type !== "point3") throw new Error("expected the bound point")
    expect(off.position.x).toBeCloseTo(1, 6)
    expect(off.position.y).toBeCloseTo(-1, 6)
    expect(off.position.z).toBeCloseTo(0, 6)
  })

  it("keeps the point inside the solid even when the parameter would put it outside", () => {
    // 参数越界（用户手改参数或拖动到很远）：夹回表面，而不是跑到盒子外面去。
    const document = cubeWithInteriorPoint([4, 0.5, 0.5])
    const point = document.primitives.find((primitive) => primitive.id === "point-in")
    if (point?.type !== "point3") throw new Error("expected the bound point")
    expect(point.position.x).toBeLessThanOrEqual(2 + 1e-9)
    expect(point.position.x).toBeGreaterThanOrEqual(-2 - 1e-9)
  })

  it("follows the solid when the solid moves", () => {
    const before = cubeWithInteriorPoint([0.75, 0.25, 0.5]).primitives.find((primitive) => primitive.id === "point-in")
    if (before?.type !== "point3") throw new Error("expected the bound point")

    const moved = applyOperation(cubeWithInteriorPoint([0.75, 0.25, 0.5]), { op: "translatePrimitive3", id: "cube-a", delta: { x: 0, y: 0, z: 3 } }).document
    const after = moved.primitives.find((primitive) => primitive.id === "point-in")
    if (after?.type !== "point3") throw new Error("expected the bound point")
    // 立方体沿 +z 挪 3：体内的点跟着走（参数不变，坐标随之更新）。
    expect(after.position.z - before.position.z).toBeCloseTo(3, 6)
    expect(after.position.x).toBeCloseTo(before.position.x, 6)
  })

  it("is deleted together with the solid, or unbound when the solid disappears", () => {
    const document = cubeWithInteriorPoint([0.5, 0.5, 0.5])
    // 依赖索引认得这条绑定：删立方体时绑定点会被降级为自由点（保留位置），不会留下悬空引用。
    const plan = deletionPlan(document, ["cube-a"])
    expect(plan.primitives.has("point-in")).toBe(false)
    const deleted = applyOperation(document, { op: "deleteObject", id: "cube-a" }).document
    const point = deleted.primitives.find((primitive) => primitive.id === "point-in")
    if (point?.type !== "point3") throw new Error("expected the point to survive as a free point")
    expect(point.binding?.kind).toBe("free")
    expect(point.position).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe("bound points follow their host", () => {
  it("recomputes a point bound to a cube face when the cube moves (full and incremental)", () => {
    const { document } = cubeWithBoundPoint("face")
    const before = document.primitives.find((primitive) => primitive.id === "point-bound")
    if (before?.type !== "point3") throw new Error("expected the bound point")
    expect(before.binding?.kind).toBe("onFace")

    // 数值改原点（与属性栏里改「原点 X」是同一条路）：changedIds 只有 cube-a。
    const moved = applyOperation(document, { op: "updatePrimitive", id: "cube-a", patch: { origin3: { x: 2, y: -2, z: -2 } } }).document
    const after = moved.primitives.find((primitive) => primitive.id === "point-bound")
    if (after?.type !== "point3") throw new Error("expected the bound point")
    // 立方体沿 +x 挪了 4：绑在面上的点必须跟着走，不能留在原地。
    expect(after.position.x - before.position.x).toBeCloseTo(4, 6)
    expect(after.position.y).toBeCloseTo(before.position.y, 6)
    expect(after.position.z).toBeCloseTo(before.position.z, 6)
  })

  it("recomputes a point bound to a cube edge when the cube moves", () => {
    const { document } = cubeWithBoundPoint("edge")
    const before = document.primitives.find((primitive) => primitive.id === "point-bound")
    if (before?.type !== "point3") throw new Error("expected the bound point")

    const moved = applyOperation(document, { op: "translatePrimitive3", id: "cube-a", delta: { x: 0, y: 5, z: 0 } }).document
    const after = moved.primitives.find((primitive) => primitive.id === "point-bound")
    if (after?.type !== "point3") throw new Error("expected the bound point")
    expect(after.position.y - before.position.y).toBeCloseTo(5, 6)
  })

  it("lists the bound point as affected when only the cube is marked dirty", () => {
    const { document } = cubeWithBoundPoint("face")
    // 增量重算的闭包必须包含绑定点：拖动宿主时真正传给重算的就是这份 id 集合。
    expect([...getAffectedPrimitiveIds(document, ["cube-a"])]).toContain("point-bound")
    expect([...getAffectedPrimitiveIds(document, ["cube-a-point-1"])]).toContain("point-bound")
  })
})
