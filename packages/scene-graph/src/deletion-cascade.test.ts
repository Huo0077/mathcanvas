import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { applyOperation, createPoint3, deletionPlan, recomputeDerivedObjects, validateDeletion } from "./index"

/**
 * 删除语义（用户已确认）：**派生对象与标注随宿主一起注销**，用户自己搭出来的构造引用仍拒绝删除
 * （除非一起选中——由 `validateDeletion` 做并集校验）；绑定点在宿主消失时降级为自由点、保留位置。
 */
describe("deletion cascade", () => {
  function documentWithAttachments() {
    const document = createEmptyDocument("geometry3d")
    const cube = { id: "cube-1", type: "cube" as const, origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 }, label: "立方体 1" }
    const built = buildSolidTemplate(cube)
    // 用**真实存在**的棱 id：模板实体的 id 序列是 cube-1-point-1…、cube-1-edge-15…（共用一个计数器）。
    const firstEdge = built.primitives.find((primitive) => primitive.type === "edge3")!.id
    document.primitives = [
      cube,
      ...built.primitives,
      createPoint3("point-b", { x: 4, y: 0, z: 0 }),
      createPoint3("on-edge", { x: 0, y: 0, z: 0 }, { kind: "onHost", hostId: firstEdge, parameter: 0.5 })
    ]
    document.measurements = [{ id: "m-1", kind: "measurement3", sourceIds: ["cube-1"], metric: "volume", precision: "numeric-approximation", status: "valid", explanation: "体积" }]
    document.annotations = [{ id: "note-1", text: "注意", target: "cube-1" }]
    document.engineeringAnnotations = [{ id: "eng-1", kind: "linear", sourceIds: ["cube-1"], view: "front", status: "valid", explanation: "尺寸" }]
    document.constraints = [{ id: "c-1", type: "coplanar", targets: ["on-edge", "cube-1"] }]
    document.groups = [{ id: "g-1", label: "一组", members: ["cube-1", "point-b"] }]
    // 先重算一次：让绑定点真的落到棱上，后面的"位置保留"才有意义。
    return recomputeDerivedObjects(document)
  }

  it("counts everything the host drags down with it", () => {
    const plan = deletionPlan(documentWithAttachments(), ["cube-1"])

    // 模板实体的整族拓扑 + 它的截面一类的派生对象都在图元集合里。
    expect(plan.primitives.has("cube-1")).toBe(true)
    expect(plan.primitives.size).toBeGreaterThan(1)
    expect([...plan.measurements]).toEqual(["m-1"])
    expect([...plan.annotations]).toEqual(["note-1"])
    expect([...plan.engineeringAnnotations]).toEqual(["eng-1"])
    expect([...plan.constraints]).toEqual(["c-1"])
    expect([...plan.groupMembers]).toEqual(["cube-1"])
  })

  it("unregisters measurements, annotations, engineering annotations and constraints on delete", () => {
    const removed = applyOperation(documentWithAttachments(), { op: "deleteObject", id: "cube-1" })

    expect(removed.changed).toBe(true)
    expect(removed.document.primitives.some((primitive) => primitive.id === "cube-1")).toBe(false)
    expect(removed.document.measurements).toEqual([])
    expect(removed.document.annotations).toEqual([])
    expect(removed.document.engineeringAnnotations).toEqual([])
    expect(removed.document.constraints).toEqual([])
    // 分组是用户的容器：只摘掉被删成员，组本身保留。
    expect(removed.document.groups).toEqual([{ id: "g-1", label: "一组", members: ["point-b"] }])
  })

  it("downgrades a point bound to the deleted host instead of deleting it", () => {
    const document = documentWithAttachments()
    const before = document.primitives.find((primitive) => primitive.id === "on-edge")!
    expect(before.type === "point3" ? before.binding?.kind : null).toBe("onHost")

    const removed = applyOperation(document, { op: "deleteObject", id: "cube-1" })

    const freed = removed.document.primitives.find((primitive) => primitive.id === "on-edge")
    expect(freed).toMatchObject({ type: "point3", binding: { kind: "free" } })
    // 位置保留：解绑不该把用户看得到的点挪走。
    expect(freed?.type === "point3" ? freed.position : null).toEqual(before.type === "point3" ? before.position : null)
  })

  it("cascades a section with the solid it cuts", () => {
    const document = documentWithAttachments()
    const withSection = applyOperation(document, {
      op: "addPrimitive",
      primitive: { id: "section-1", type: "section", sourceId: "cube-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [], classification: "none", status: "undefined" }
    })
    expect(withSection.changed).toBe(true)

    const removed = applyOperation(withSection.document, { op: "deleteObject", id: "cube-1" })
    expect(removed.document.primitives.some((primitive) => primitive.type === "section")).toBe(false)
  })

  it("validates a batch as a union, so a point and the line that needs it can go together", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("point-a", { x: 0, y: 0, z: 0 }),
      createPoint3("point-b", { x: 2, y: 0, z: 0 }),
      { id: "line-ab", type: "line3", definition: { kind: "throughPoints", pointIds: ["point-a", "point-b"] } }
    ]

    // 单删点仍然被拒绝：它是用户搭出来的构造来源（这条语义没有变）。
    expect(validateDeletion(document, ["point-a"]).valid).toBe(false)
    // 一起删就合法——这正是"两个都删不掉"那个实测缺陷的修复。
    expect(validateDeletion(document, ["point-a", "line-ab"])).toEqual({ valid: true })
    expect(validateDeletion(document, ["locked-absent"]).valid).toBe(false)
  })

  it("still refuses to delete a locked object", () => {
    const document = documentWithAttachments()
    document.primitives = document.primitives.map((primitive) => primitive.id === "cube-1" ? { ...primitive, locked: true } : primitive)

    expect(validateDeletion(document, ["cube-1"])).toEqual({ valid: false, errors: ["object is locked"] })
  })

  it("keeps the document valid after a cascade delete", () => {
    const removed = applyOperation(documentWithAttachments(), { op: "deleteObject", id: "cube-1" })
    // 级联之后不留悬空引用：重算一遍不该抛错，被解绑的点仍在。
    expect(() => recomputeDerivedObjects(removed.document)).not.toThrow()
    expect(removed.document.primitives.some((primitive) => primitive.id === "point-b")).toBe(true)
  })
})
