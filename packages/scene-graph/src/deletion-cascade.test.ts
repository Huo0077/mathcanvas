import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"

import { applyOperation, createPoint3, deletionPlan, deletionTargets, recomputeDerivedObjects, validateDeletion } from "./index"
import { compileSolidPrism, compileSolidTetrahedron } from "./actions"

/**
 * **棱柱与模板实体是同一套删除语义**（外部审查 S2）。
 *
 * 两者都是"一只实体 + 它自己物化出来的拓扑"（顶点 / 棱 / 面）。原先 `deletionTargets`
 * 的族判定只认 `construction.kind === "template"`，于是删除棱柱时**只删掉 `polyhedron3` 本身**，
 * 它那 26 个成员全部留在文档里并**继续绘制** —— 用户看到的是"删了棱柱，一地碎片还在画布上"。
 * 而模板立方体删除时连同 28 个成员一起走、0 残留。这条把两者的等价性钉住。
 */
describe("deleting a prism removes its materialised topology too", () => {
  const base = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 3, z: 0 }, { x: 0, y: 3, z: 0 }]

  function prismDocument() {
    const built = compileSolidPrism("solid-1", base, { x: 1, y: 0.5, z: 3 }, "斜棱柱 1")
    const document = createEmptyDocument("geometry3d")
    document.primitives = built.primitives
    return document
  }

  it("deletes the polyhedron together with every vertex, edge and face it materialised", () => {
    const document = prismDocument()
    const solid = document.primitives.find((primitive) => primitive.id === "solid-1")
    if (solid?.type !== "polyhedron3") throw new Error("expected the prism solid")
    const family = [solid.id, ...solid.vertexIds, ...solid.edgeIds, ...solid.faceIds]
    // 夹具自检：这只棱柱真的带着一整族成员（否则下面的断言会因为"本来就没有"而恒真）。
    expect(family.length).toBeGreaterThan(4)
    expect(document.primitives.length).toBe(family.length)

    // 族判定必须把整族收进来 —— 从**任意一个成员**出发都一样。
    expect([...deletionTargets(document, "solid-1")].sort()).toEqual([...family].sort())
    expect([...deletionTargets(document, solid.vertexIds[0])].sort()).toEqual([...family].sort())

    const removed = applyOperation(document, { op: "deleteObject", id: "solid-1" })

    expect(removed.changed).toBe(true)
    // **0 残留**：没有孤儿顶点 / 棱 / 面留在画布上（模板实体那条路径的同一口径）。
    expect(removed.document.primitives).toEqual([])
  })

  it("also removes a prism when the user deletes one of its generated vertices", () => {
    // 用户可能在画布上点到的正是那个顶点：那时整族也必须一起走，而不是留下一堆碎片。
    const document = prismDocument()
    const solid = document.primitives.find((primitive) => primitive.id === "solid-1")
    if (solid?.type !== "polyhedron3") throw new Error("expected the prism solid")

    const removed = applyOperation(document, { op: "deleteObject", id: solid.vertexIds[0] })

    expect(removed.changed).toBe(true)
    expect(removed.document.primitives).toEqual([])
  })
})

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
    // 分组是用户的容器：只摘掉被删成员；但摘到只剩一个成员时组本身必须解散——
    // schema 要求 `members.length >= 2`，留着空壳会让整份文档再也存不下去（体检发现的真缺陷）。
    expect(removed.document.groups).toEqual([])
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

  /**
   * 体检发现的真缺陷（审计报告写宽了，实际只漏了这一个分支）：空间点的 `derived` 绑定在宿主被删时
   * 会降级为自由点，**平面点**的同名绑定却不会——留下一根指向已删对象的悬空引用。
   * 依赖图从此找不到来源，点静默冻在原地（与 schema 注释里点名过的"悬空引用让点静默冻住"同一类坑）。
   */
  it("downgrades a planar point derived from a deleted source instead of leaving a dangling binding", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "segment-1", type: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } },
      { id: "point-1", type: "point", x: 2, y: 0, binding: { kind: "derived", sourceId: "segment-1", feature: "midpoint" } }
    ]

    const removed = applyOperation(document, { op: "deleteObject", id: "segment-1" })

    expect(removed.changed).toBe(true)
    expect(removed.document.primitives).toEqual([{ id: "point-1", type: "point", x: 2, y: 0, binding: { kind: "free" } }])
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

/**
 * **`fromPoints` 的多面体也是同一套删除语义**（2026-09-23，用户现场："agent 创建的元素无法删除"）。
 *
 * 棱柱那条修完之后，族判定只认 `template` 与 `prism` —— 而 Agent 建的正四面体是**第三种构造**：
 * `fromPoints`（`solid.create_tetrahedron` → 内核的 `buildFromPoints`）。于是它掉进了缝里：
 *
 * 1. **删实体本身**只删掉 `polyhedron3`，4 个顶点 / 6 条棱 / 4 个面留在文档里继续绘制（与 S2 那条同一个病）；
 * 2. **删任意一个成员**（用户点的往往是画布上那个顶点）会被 `validateDeletion` 判成"被别的对象引用"而**拒绝** ——
 *    这正是用户看到的"删不掉"。
 *
 * 三者（模板 / 棱柱 / 点集构造）成员的来路完全一样（都由实体自己物化），删除语义必须一致。
 */
describe("deleting a fromPoints solid (the agent's tetrahedron) removes its topology too", () => {
  function tetrahedronDocument() {
    const built = compileSolidTetrahedron("solid-1", { baseCenter: { x: 0, y: 0, z: 0 }, edge: 3 }, "正四面体 1")
    const document = createEmptyDocument("geometry3d")
    document.primitives = built.primitives
    return document
  }

  it("deletes the polyhedron together with its four vertices, six edges and four faces", () => {
    const document = tetrahedronDocument()
    const solid = document.primitives.find((primitive) => primitive.id === "solid-1")
    if (solid?.type !== "polyhedron3") throw new Error("expected the tetrahedron")
    const family = [solid.id, ...solid.vertexIds, ...solid.edgeIds, ...solid.faceIds]
    // 夹具自检：这只四面体真的带着一整族成员（否则下面的断言会因为"本来就没有"而恒真）。
    expect(family).toHaveLength(15)
    expect(document.primitives).toHaveLength(15)

    // 族判定必须把整族收进来 —— 从**任意一个成员**出发都一样。
    expect([...deletionTargets(document, "solid-1")].sort()).toEqual([...family].sort())
    expect([...deletionTargets(document, solid.vertexIds[0])].sort()).toEqual([...family].sort())

    const removed = applyOperation(document, { op: "deleteObject", id: "solid-1" })

    expect(removed.changed).toBe(true)
    // **0 残留**：没有孤儿顶点 / 棱 / 面留在画布上。
    expect(removed.document.primitives).toEqual([])
  })

  it("lets the user delete it by clicking one of its vertices, instead of refusing the request", () => {
    const document = tetrahedronDocument()
    const solid = document.primitives.find((primitive) => primitive.id === "solid-1")
    if (solid?.type !== "polyhedron3") throw new Error("expected the tetrahedron")

    // 用户现场：这一步今天被判成"被别的对象引用"，于是界面上根本删不掉。
    expect(validateDeletion(document, [solid.vertexIds[0]])).toEqual({ valid: true })

    const removed = applyOperation(document, { op: "deleteObject", id: solid.vertexIds[0] })
    expect(removed.changed).toBe(true)
    expect(removed.document.primitives).toEqual([])
  })
})
