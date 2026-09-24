import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { buildSolidTemplate } from "@draw/geometry-kernel"
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

  /**
   * **一只真实的模板实体**（P0 之后的形状）：`solid.create_template` 现在一次落盘
   * 模板图元 + 整族物化拓扑，所以一个立方体在文档里是 28 个图元。
   *
   * 这条用例回答一个产品问题："确认面板说'会新增 27 个对象'，这句话对吗？"
   * 判据是**按可见性口径逐类核对**，而不是照抄一个数字：
   *
   * - 8 顶点 / 12 棱 / 6 面 / 1 个 `polyhedron3` / 1 个模板图元 = **28 个用户对象** ——
   *   它们在对象树里真的占行、能选中、能删，所以算 28 是**如实**的；
   *   （第一版这里手算成 27，忘了把模板图元自己算进去 —— 所以下面逐类核对，
   *   而不是只信一个手算出来的总数。）
   * - 内部细节 0：模板实体（立方体）没有圆类近似；`tessellation` 只有圆柱 / 圆锥才有；
   * - 派生 0：`polyhedron3` 与它的子对象**不是** `DERIVED_PRIMITIVE_TYPES` 里的东西 ——
   *   它们不是"由别的对象算出来所以拖不动"，而是实体本身。
   *
   * 这条同时是"P0 没有把计数搞坏"的回归：如果哪天 `solid.create_template` 又只落盘模板图元，
   * `total` 会掉到 1，这里立刻会红。
   *
   * **一条留给产品的观察**（不是缺陷，所以只记录）：用户要"一个立方体"，确认面板会说
   * "会新增 28 个对象" —— 因为子对象不按属主实体归并。计数本身没错（28 个对象确实都会进文档），
   * 但"要不要按实体归并着说"是产品判断，与评审方案 1 里"对象树以拓扑为依据"是同一个问题。
   */
  it("counts a real compiled template solid honestly", () => {
    const cube = { id: "solid-1", type: "cube" as const, origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 } }
    const built = buildSolidTemplate(cube)
    const document = countsDocument([cube, ...built.primitives])

    const counts = countDraftObjects(document)
    // 28 = 模板图元 1 + 8 顶点 + 12 棱 + 6 面 + 1 多面体。
    expect(counts.total).toBe(28)
    expect(counts.derived).toBe(0)
    expect(counts.internal).toBe(0)
    expect(counts.hidden).toBe(0)
    expect(counts.user).toBe(28)
    // 逐类核对而不是只信一个总数：拓扑在图元种类上真的都在。
    const byType = new Map<string, number>()
    for (const primitive of built.primitives) byType.set(primitive.type, (byType.get(primitive.type) ?? 0) + 1)
    expect(byType.get("point3")).toBe(8)
    expect(byType.get("edge3")).toBe(12)
    expect(byType.get("face3")).toBe(6)
    expect(byType.get("polyhedron3")).toBe(1)
  })
})
