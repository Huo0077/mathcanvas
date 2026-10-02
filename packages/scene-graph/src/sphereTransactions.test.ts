import { describe, expect, it } from "vitest"

import { decodeMgeo, encodeMgeo, createEmptyDocument, type GeometryDocument } from "@draw/dsl"

import { applyOperation, commitPatch } from "./index"

/**
 * 球的**场景事务**（实施计划 Task 3）：创建、数值编辑、平移、保存往返、以及"非法半径整笔拒绝"。
 *
 * 这一片的判据不是"字段被写进去了"，而是三件事：
 * ① 编辑走的是**唯一写入入口** `commitPatch`（`apply` / 草稿 / Agent 提交都走它），所以补丁校验与
 *    文档校验都会过一次；
 * ② **拒绝是原子的**：`changed=false` 且返回的文档就是**原来那一份**（同一引用），不是"改了一半又回滚"；
 * ③ 保存往返之后球心 / 半径**逐值不变**（球没有子对象，所以往返里不该多出任何东西）。
 */

const SPHERE = { id: "sphere-1", type: "sphere" as const, center: { x: 1, y: 2, z: 3 }, radius: 5 }

function sphereDocument(): GeometryDocument {
  const added = applyOperation(createEmptyDocument("geometry3d"), { op: "addPrimitive", primitive: { ...SPHERE } })
  if (!added.changed) throw new Error(`fixture could not add the sphere: ${added.error}`)
  return added.document
}

/** 夹具自检：取不到球就直接抛，避免下面的断言因为"本来就没有"而恒真。 */
function sphereIn(document: GeometryDocument) {
  const sphere = document.primitives.find((primitive) => primitive.id === "sphere-1")
  if (sphere?.type !== "sphere") throw new Error("expected the sphere in the document")
  return sphere
}

describe("sphere scene transactions", () => {
  it("creates a sphere through the ordinary addPrimitive operation", () => {
    const document = sphereDocument()

    expect(document.primitives).toHaveLength(1)
    expect(sphereIn(document)).toMatchObject({ center: { x: 1, y: 2, z: 3 }, radius: 5 })
    // 球是**自足**的解析实体：不像模板立体那样物化出一族子对象（点 / 棱 / 面 / polyhedron3）。
    expect(document.primitives.filter((primitive) => primitive.type === "polyhedron3")).toHaveLength(0)
  })

  it("edits the radius through the updatePrimitive patch without touching the centre", () => {
    const edited = commitPatch(sphereDocument(), { op: "updatePrimitive", id: "sphere-1", patch: { radius3: 4 } })

    expect(edited.changed).toBe(true)
    expect(edited.error).toBeUndefined()
    expect(sphereIn(edited.document)).toMatchObject({ radius: 4, center: { x: 1, y: 2, z: 3 } })
  })

  it("moves the centre through the same patch, including a partial patch", () => {
    const moved = commitPatch(sphereDocument(), { op: "updatePrimitive", id: "sphere-1", patch: { center3: { x: 3, y: 2, z: 3 } } })
    expect(moved.changed).toBe(true)
    expect(sphereIn(moved.document)).toMatchObject({ center: { x: 3, y: 2, z: 3 }, radius: 5 })

    // 补丁是**合并**语义（与圆柱 / 圆锥 / 轨道圆同一个口径）：只给 x 不该把 y/z 清零。
    const partial = commitPatch(sphereDocument(), { op: "updatePrimitive", id: "sphere-1", patch: { center3: { x: 4, y: 2, z: 3 } } })
    expect(sphereIn(partial.document).center).toEqual({ x: 4, y: 2, z: 3 })
  })

  it("rejects a zero or non-finite radius atomically, keeping the original document", () => {
    for (const radius3 of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const before = sphereDocument()
      const rejected = commitPatch(before, { op: "updatePrimitive", id: "sphere-1", patch: { radius3 } })

      expect(rejected.changed, `radius3=${radius3}`).toBe(false)
      expect(rejected.error, `radius3=${radius3}`).toBeTruthy()
      /**
       * 拒绝的理由必须是**半径本身不合法**（"必须为正"），不是"这个类型不支持半径"。
       * 少了这一条，下面那句 `changed=false` 会在"球压根不支持改半径"时也成立 ——
       * 于是这条用例会在实现之前就绿，等于什么都没钉住。
       */
      expect(rejected.error, `radius3=${radius3}`).toMatch(/radius must be positive/)
      // **原子**：返回的就是原来那一份，不是"改了一半又回滚"造出来的等价副本。
      expect(rejected.document, `radius3=${radius3}`).toBe(before)
      expect(sphereIn(rejected.document).radius).toBe(5)
    }
  })

  it("rejects a non-finite centre atomically", () => {
    const before = sphereDocument()
    const rejected = commitPatch(before, { op: "updatePrimitive", id: "sphere-1", patch: { center3: { x: Number.NaN, y: 2, z: 3 } } })

    expect(rejected.changed).toBe(false)
    expect(rejected.document).toBe(before)
  })

  it("translates the sphere with translatePrimitive3 as one document change", () => {
    const before = sphereDocument()
    const moved = applyOperation(before, { op: "translatePrimitive3", id: "sphere-1", delta: { x: 2, y: 0, z: 0 } })

    expect(moved.changed).toBe(true)
    expect(sphereIn(moved.document)).toMatchObject({ center: { x: 3, y: 2, z: 3 }, radius: 5 })
    // 圆心动了、半径不动 —— 平移不是"改大小"。
    expect(sphereIn(moved.document).radius).toBe(5)
  })

  it("keeps the centre and radius through a save/reopen round trip without inventing children", () => {
    const edited = commitPatch(sphereDocument(), { op: "updatePrimitive", id: "sphere-1", patch: { center3: { x: 3, y: 2, z: 3 }, radius3: 4 } }).document

    const reopened = decodeMgeo(encodeMgeo(edited))

    expect(sphereIn(reopened)).toMatchObject({ id: "sphere-1", type: "sphere", center: { x: 3, y: 2, z: 3 }, radius: 4 })
    expect(reopened.primitives).toHaveLength(1)
  })
})
