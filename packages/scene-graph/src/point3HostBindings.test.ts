import { describe, expect, it } from "vitest"

import { createEmptyDocument, encodeMgeo } from "@draw/dsl"

import { applyOperation, createPoint3, getAffectedPrimitiveIds, patchPoint3, recomputeDerivedObjects } from "./index"

/**
 * 绑到宿主上的 3D 动点：坐标永远由参数算出，宿主变了就跟着变。
 * 这是"参数是唯一真值"的可测判据——点不会自己漂，也不会在端点移动后留在原地。
 */
describe("3D host-bound points", () => {
  function segmentDocument() {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("point-a", { x: 0, y: 0, z: 0 }),
      createPoint3("point-b", { x: 2, y: 0, z: 0 }),
      { id: "segment-ab", type: "segment3", pointIds: ["point-a", "point-b"] },
      createPoint3("mover", { x: 9, y: 9, z: 9 }, { kind: "onHost", hostId: "segment-ab", parameter: 0.25 })
    ]
    return document
  }

  it("derives a host-bound point from its parameter, ignoring the stored coordinates", () => {
    const result = recomputeDerivedObjects(segmentDocument())

    expect(result.primitives.find((primitive) => primitive.id === "mover")).toMatchObject({ position: { x: 0.5, y: 0, z: 0 } })
  })

  it("keeps the point on the segment when an endpoint moves, and lists it as affected", () => {
    const moved = applyOperation(segmentDocument(), patchPoint3("point-b", { x: 4, y: 0, z: 0 }))

    expect(moved.document.primitives.find((primitive) => primitive.id === "mover")).toMatchObject({ position: { x: 1, y: 0, z: 0 } })
    expect([...getAffectedPrimitiveIds(segmentDocument(), ["point-b"])]).toEqual(["point-b", "segment-ab", "mover"])
  })

  it("clamps a host parameter to the segment's domain instead of leaving the host", () => {
    const document = segmentDocument()
    const mover = document.primitives.find((primitive) => primitive.id === "mover") as { binding: { parameter: number } }
    mover.binding.parameter = 2

    const result = recomputeDerivedObjects(document)

    expect(result.primitives.find((primitive) => primitive.id === "mover")).toMatchObject({ position: { x: 2, y: 0, z: 0 } })
  })

  it("derives surface-bound points from their uv parameter", () => {
    const document = createEmptyDocument("geometry3d")
    const cylinder = { id: "cylinder-1", type: "cylinder" as const, center: { x: 0, y: 0, z: 0 }, radius: 2, height: 4, segments: 8 }
    document.primitives = [cylinder, createPoint3("on-surface", { x: 9, y: 9, z: 9 }, { kind: "onSurface", solidId: "cylinder-1", uv: [0, 0.5] })]

    const result = recomputeDerivedObjects(document)
    const bound = result.primitives.find((primitive) => primitive.id === "on-surface")

    expect(bound).toMatchObject({ position: { x: 2, y: 0, z: 2 } })
  })

  it("derives face-bound points from their uv parameter", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      createPoint3("a", { x: 0, y: 0, z: 0 }),
      createPoint3("b", { x: 4, y: 0, z: 0 }),
      createPoint3("c", { x: 0, y: 4, z: 0 }),
      { id: "face-abc", type: "face3", pointIds: ["a", "b", "c"] },
      createPoint3("on-face", { x: 9, y: 9, z: 9 }, { kind: "onFace", faceId: "face-abc", uv: [1, 2] })
    ]

    const result = recomputeDerivedObjects(document)

    expect(result.primitives.find((primitive) => primitive.id === "on-face")).toMatchObject({ position: { x: 1, y: 2, z: 0 } })
  })

  it("keeps the stored coordinates when the host cannot be resolved, instead of moving the point", () => {
    const document = segmentDocument()
    document.primitives = document.primitives.filter((primitive) => primitive.id !== "segment-ab")

    const result = recomputeDerivedObjects(document)

    expect(result.primitives.find((primitive) => primitive.id === "mover")).toMatchObject({ position: { x: 9, y: 9, z: 9 } })
  })

  /**
   * 驱动参数路径（Reactive DAG 切片 Task 2）。
   *
   * `parameterId(s)` 给定时**只有文档参数说了算**：绑定里那个字面量退化成缓存，
   * 于是滑块 / 动画 / 轨迹扫描与拖拽共用同一个真值来源（设计规格 §4.1）。
   * 注意与上一条用例的**有意分工**：宿主解析不了时文档层保留上一次坐标（不把点挪走），
   * 而 Reactive DAG 那边必须报 `missing_source` —— 两条路径的失败语义不同，各有各的用例守着。
   */
  it("derives a host-bound point from its driver parameter instead of the cached literal", () => {
    const document = segmentDocument()
    document.parameters = { "t-mover": { id: "t-mover", value: 0.75, ownerId: "mover" } }
    const mover = document.primitives.find((primitive) => primitive.id === "mover") as { binding: Record<string, unknown> }
    mover.binding = { kind: "onHost", hostId: "segment-ab", parameter: 0.25, parameterId: "t-mover" }

    // 参数 0.75 × 段长 2 = 1.5；缓存里的 0.25 不参与求值。
    expect(recomputeDerivedObjects(document).primitives.find((primitive) => primitive.id === "mover")).toMatchObject({ position: { x: 1.5, y: 0, z: 0 } })

    const slid = applyOperation(document, { op: "setParameter", id: "t-mover", value: 0.1 })
    expect(slid.document.primitives.find((primitive) => primitive.id === "mover")).toMatchObject({ position: { x: 0.2, y: 0, z: 0 } })
    // 缓存字段不会被求值顺手改写：真值只有一个（参数）。
    expect((slid.document.primitives.find((primitive) => primitive.id === "mover") as { binding: { parameter: number } }).binding.parameter).toBe(0.25)
  })

  it("derives a face-bound point from its two driver parameters", () => {
    const document = createEmptyDocument("geometry3d")
    document.parameters = {
      "t-u": { id: "t-u", value: 1, ownerId: "on-face" },
      "t-v": { id: "t-v", value: 2, ownerId: "on-face" }
    }
    document.primitives = [
      createPoint3("a", { x: 0, y: 0, z: 0 }),
      createPoint3("b", { x: 4, y: 0, z: 0 }),
      createPoint3("c", { x: 0, y: 4, z: 0 }),
      { id: "face-abc", type: "face3", pointIds: ["a", "b", "c"] },
      createPoint3("on-face", { x: 9, y: 9, z: 9 }, { kind: "onFace", faceId: "face-abc", uv: [9, 9], parameterIds: ["t-u", "t-v"] })
    ]

    expect(recomputeDerivedObjects(document).primitives.find((primitive) => primitive.id === "on-face")).toMatchObject({ position: { x: 1, y: 2, z: 0 } })

    const moved = applyOperation(document, { op: "setParameter", id: "t-u", value: 3 })
    expect(moved.document.primitives.find((primitive) => primitive.id === "on-face")).toMatchObject({ position: { x: 3, y: 2, z: 0 } })

    // 驱动参数被删掉（或从未存在）时不能拿缓存顶替：这一趟解析不出来，坐标保持不变。
    const withoutParameter = structuredClone(document) as typeof document
    delete withoutParameter.parameters["t-u"]
    expect(recomputeDerivedObjects(withoutParameter).primitives.find((primitive) => primitive.id === "on-face")).toMatchObject({ position: { x: 9, y: 9, z: 9 } })
  })

  /**
   * **闭合 3D 宿主的域语义只有一份**（fix round 1 / I5）。
   *
   * 空间圆轨道的参数是圆周角：`π/2 + 4π` 与 `π/2` 是**同一个点**，必须折回 `[0, 2π)`。
   * 旧实现对所有宿主一律"夹取"，于是 `π/2 + 4π` 被夹到 `2π`（≈ 0），点落在整整差一个象限的地方 ——
   * 而图那一侧是折回的，同一个文档两条路径给出两个点。
   */
  it("wraps a closed host parameter instead of clamping it to the domain end", () => {
    const orbitDocument = (parameter: number) => {
      const document = createEmptyDocument("geometry3d")
      document.primitives = [
        { id: "orbit-1", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 },
        createPoint3("tracker", { x: 0, y: 0, z: 0 }, { kind: "onHost", hostId: "orbit-1", parameter })
      ]
      return document
    }
    const positionAt = (parameter: number) => {
      const primitive = recomputeDerivedObjects(orbitDocument(parameter)).primitives.find((candidate) => candidate.id === "tracker")
      return primitive?.type === "point3" ? primitive.position : null
    }
    const turned = positionAt(Math.PI / 2 + Math.PI * 4)
    const expected = positionAt(Math.PI / 2)!
    expect(turned).not.toBeNull()
    expect(turned!.x).toBeCloseTo(expected.x, 9)
    expect(turned!.y).toBeCloseTo(expected.y, 9)
    expect(turned!.z).toBeCloseTo(expected.z, 9)
    // 夹取会把它放在 2π（= 0）那一端（点落在轨道参数 0 的位置，与折回的结果差一个象限）。
    const clamped = positionAt(Math.PI * 2)!
    expect(Math.hypot(turned!.x - clamped.x, turned!.y - clamped.y)).toBeGreaterThan(0.5)
  })

  /**
   * **3D 绑定参数也是"被引用"**（Reactive DAG 切片 fix round 1 / I3）。
   *
   * `schema` 已经把 `point3.binding.parameterId(s)` 做成硬校验（悬空即非法），`encodeMgeo` 对非法文档
   * 直接抛，所以删除守卫与孤儿回收都必须认这几种引用 —— 否则一次普通的"删参数 / 删对象"
   * 就能造出一份**存不下去**的文档，或者把还在用的驱动参数当垃圾回收掉。
   */
  it("guards driver parameters that 3D host bindings still reference", () => {
    const document = createEmptyDocument("geometry3d")
    document.parameters = { "t-mover": { id: "t-mover", value: 0.5, ownerId: "point-owner" } }
    document.primitives = [
      createPoint3("point-a", { x: 0, y: 0, z: 0 }),
      createPoint3("point-b", { x: 2, y: 0, z: 0 }),
      { id: "segment-ab", type: "segment3", pointIds: ["point-a", "point-b"] },
      createPoint3("mover", { x: 0, y: 0, z: 0 }, { kind: "onHost", hostId: "segment-ab", parameter: 0.5, parameterId: "t-mover" }),
      // 归属对象：删掉它会触发"回收孤儿参数"那一步（它只被 3D 绑定引用，必须留下）。
      createPoint3("point-owner", { x: 9, y: 9, z: 9 })
    ]

    const refused = applyOperation(document, { op: "deleteParameter", id: "t-mover" })
    expect(refused.changed).toBe(false)
    expect(refused.error).toContain("referenced")

    const deleted = applyOperation(document, { op: "deleteObject", id: "point-owner" })
    expect(deleted.changed).toBe(true)
    expect(Object.keys(deleted.document.parameters)).toEqual(["t-mover"])
    // 文档仍然存得下去（悬空引用会让 encodeMgeo 抛）。
    expect(encodeMgeo(deleted.document)).toContain("t-mover")
  })

  it("guards both parameters of a face binding", () => {
    const document = createEmptyDocument("geometry3d")
    document.parameters = {
      "t-u": { id: "t-u", value: 1, ownerId: "on-face" },
      "t-v": { id: "t-v", value: 2, ownerId: "on-face" }
    }
    document.primitives = [
      createPoint3("a", { x: 0, y: 0, z: 0 }),
      createPoint3("b", { x: 4, y: 0, z: 0 }),
      createPoint3("c", { x: 0, y: 4, z: 0 }),
      { id: "face-abc", type: "face3", pointIds: ["a", "b", "c"] },
      createPoint3("on-face", { x: 1, y: 2, z: 0 }, { kind: "onFace", faceId: "face-abc", uv: [1, 2], parameterIds: ["t-u", "t-v"] })
    ]

    for (const id of ["t-u", "t-v"]) {
      const refused = applyOperation(document, { op: "deleteParameter", id })
      expect(refused.changed, `${id} must be protected`).toBe(false)
      expect(refused.error).toContain("referenced")
    }
    // 反过来：删掉那个绑定点本身（它正是这两个参数的归属与唯一引用者）之后，两个参数都成了孤儿 —— 回收它们是对的。
    const deleted = applyOperation(document, { op: "deleteObject", id: "on-face" })
    expect(deleted.changed).toBe(true)
    expect(Object.keys(deleted.document.parameters)).toEqual([])
  })
})
