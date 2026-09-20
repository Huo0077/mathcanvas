import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { countDraftObjects } from "./draftCounts"
import { DERIVED_PRIMITIVE_TYPES } from "./derivedPrimitives"

/**
 * 这些夹具只喂计数逻辑，不需要通过整份文档的 schema 校验（`validateDocument` 另有测试）。
 * 用一次显式断言把"我知道这些图元字段不全"写在类型层，而不是让每个夹具都补全无关字段。
 */
function countsDocument(primitives: unknown[]): GeometryDocument {
  return { ...createEmptyDocument("conics"), primitives } as unknown as GeometryDocument
}

/**
 * Task 0.8 Step 4 要求预览显示"用户 / 派生 / 内部"三类计数。
 * 判据必须与画布、对象树共用同一份（`primitiveVisibility.ts` + 派生素型清单），
 * 否则"预览说 8 个用户对象、画布只画 4 个"这类不一致会长期潜伏。
 */
describe("draft object counts", () => {
  it("separates editable, derived and tessellation objects", () => {
    const document = countsDocument([
      { id: "point-1", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "A" },
      { id: "point-2", type: "point3", position: { x: 1, y: 0, z: 0 }, label: "B" },
      // 派生：由别的对象算出来，拖不动。
      { id: "ix-1", type: "intersection", lineA: "line-1", lineB: "line-2", x: 0.5, y: 0 },
      // 内部：圆类实体多边形近似的细分顶点与母线。
      { id: "point3-tess", type: "point3", position: { x: 0, y: 1, z: 0 }, tessellation: true },
      { id: "edge3-tess", type: "edge3", startId: "point-1", endId: "point-2", tessellation: true }
    ])

    expect(countDraftObjects(document)).toEqual({ user: 2, hidden: 0, derived: 1, internal: 2, total: 5 })
  })

  it("counts a hidden user object separately instead of pretending it stays visible", () => {
    const document = countsDocument([
      { id: "point-1", type: "point", x: 1, y: 1 },
      { id: "point-2", type: "point", x: 2, y: 2, visible: false }
    ])

    // "看不见"与"不是用户对象"是两件事：确认后画布上只会多一个点。
    expect(countDraftObjects(document)).toEqual({ user: 1, hidden: 1, derived: 0, internal: 0, total: 2 })
  })

  it("keeps a derived object classified as derived even when it is hidden", () => {
    const document = countsDocument([{ id: "conn-1", type: "connection", kind: "segment", startPointId: "point-1", endPointId: "point-2", visible: false }])

    // 分类问的是"它是什么"；隐藏只是开关。否则"我有多少个改不了的对象"会失真。
    expect(countDraftObjects(document)).toEqual({ user: 0, hidden: 0, derived: 1, internal: 0, total: 1 })
  })

  it("treats an empty document as nothing to change", () => {
    expect(countDraftObjects(createEmptyDocument("conics"))).toEqual({ user: 0, hidden: 0, derived: 0, internal: 0, total: 0 })
  })

  it("exposes the derived type set so interaction and preview cannot drift apart", () => {
    // `interaction.ts` 用手柄判据、预览用计数判据，两边必须是同一份清单。
    expect([...DERIVED_PRIMITIVE_TYPES]).toContain("intersection")
    expect([...DERIVED_PRIMITIVE_TYPES]).toContain("connection")
  })
})
