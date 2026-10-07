import { describe, expect, it } from "vitest"

import { parseShapeClause } from "./shapeGrammar"

/**
 * **入口语法（S6）的正反例表**。
 *
 * 判据是设计 §6 的那条纪律：**"认不出就问路"优先于"多认一句"**。
 * 所以这里两半同等重要 —— 认得出的必须**逐字段**对（族、底环、锥顶 / 顶环），
 * 认不出的必须**返回 `null`**（`null` = 问路），而不是猜一个形状出来。
 */
describe("入口语法：形状说法", () => {
  describe("认得出", () => {
    it("四棱锥 P-ABCD：前半是锥顶，后半是底环", () => {
      const shape = parseShapeClause("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，画出这个四棱锥")
      expect(shape).toEqual({ family: "pyramid", phrase: "在四棱锥 P-ABCD 中", base: ["A", "B", "C", "D"], apex: "P" })
    })

    it("三棱锥 A-BCD：锥顶在最前面（不是 `P-` 开头也一样认）", () => {
      const shape = parseShapeClause("在三棱锥 A-BCD 中，BD=2，画一张示意图")
      expect(shape?.family).toBe("pyramid")
      expect(shape?.apex).toBe("A")
      expect(shape?.base).toEqual(["B", "C", "D"])
    })

    it("三棱柱 ABC-A′B′C′：前半是底环，后半是顶环", () => {
      const shape = parseShapeClause("在三棱柱ABC-A′B′C′中，AA′⊥平面ABC，画出这个三棱柱")
      expect(shape?.family).toBe("prism")
      expect(shape?.base).toEqual(["A", "B", "C"])
      expect(shape?.top).toEqual(["A′", "B′", "C′"])
    })

    it("六棱柱：环长 6 也认（内核上界）", () => {
      const shape = parseShapeClause("在六棱柱ABCDEF-A′B′C′D′E′F′中，AA′⊥平面ABCDEF，画出这个六棱柱")
      expect(shape?.family).toBe("prism")
      expect(shape?.base).toEqual(["A", "B", "C", "D", "E", "F"])
      expect(shape?.top).toEqual(["A′", "B′", "C′", "D′", "E′", "F′"])
    })

    it("四棱台：同一套两段写法，族是台体", () => {
      const shape = parseShapeClause("在四棱台ABCD-A′B′C′D′中，AB⊥AD，画出这个四棱台")
      expect(shape?.family).toBe("frustum")
      expect(shape?.base).toEqual(["A", "B", "C", "D"])
      expect(shape?.top).toEqual(["A′", "B′", "C′", "D′"])
    })

    it("修饰词与 ASCII 撇：`正四棱锥` 认得出，`A'` 与 `A′` 是同一个名字", () => {
      expect(parseShapeClause("在正四棱锥 P-ABCD 中，PA⊥平面ABCD")?.family).toBe("pyramid")
      expect(parseShapeClause("在三棱柱ABC-A'B'C'中，AA'⊥平面ABC")?.top).toEqual(["A'", "B'", "C'"])
    })
  })

  describe("认不出（一律 `null` = 问路）", () => {
    it("数词与环长不符：写『四棱锥』却给 5 个点名", () => {
      expect(parseShapeClause("在四棱锥 P-ABCDE 中，PA ⊥ 平面 ABCDE")).toBeNull()
    })

    it("顶环与底环对不上：`ABCD-A′C′B′D′` 不按顺序硬配", () => {
      expect(parseShapeClause("在四棱柱ABCD-A′C′B′D′中，AA′⊥平面ABCD")).toBeNull()
    })

    it("棱柱只有一段点名（缺顶环）", () => {
      expect(parseShapeClause("在四棱柱 P-ABCD 中，PA ⊥ 平面 ABCD")).toBeNull()
    })

    it("ASCII 数字下标（`A1`）不是本仓点名", () => {
      expect(parseShapeClause("在三棱柱A1B1C1-A2B2C2中，AA1⊥平面ABC")).toBeNull()
    })

    it("没有点名表：`在棱柱中`", () => {
      expect(parseShapeClause("在棱柱中，A′B=1")).toBeNull()
    })

    it("锥顶同时是底面顶点：`A-ABCD` 自相矛盾", () => {
      expect(parseShapeClause("在四棱锥 A-ABCD 中，AO⊥平面ABCD")).toBeNull()
    })

    it("没有『在…中』从句：没有点名表就产不出 spec，不替用户编一套", () => {
      expect(parseShapeClause("底面边长 2 的棱柱，AB垂直AD")).toBeNull()
      expect(parseShapeClause("画一个四棱锥")).toBeNull()
    })

    it("分析题 / 无关句", () => {
      expect(parseShapeClause("在三棱锥 A-BCD 中，BD=2。求证 OA⊥CD")).not.toBeNull()
      expect(parseShapeClause("求证：OA⊥CD")).toBeNull()
      expect(parseShapeClause("")).toBeNull()
    })

    it("球与多面体的关系：S5 未落地，**有意不认**（认了也造不出来）", () => {
      expect(parseShapeClause("在球O中，AB=2")).toBeNull()
      expect(parseShapeClause("求三棱锥 P-ABC 的外接球半径")).toBeNull()
    })
  })
})
