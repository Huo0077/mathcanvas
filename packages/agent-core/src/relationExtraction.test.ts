import { describe, expect, it } from "vitest"

import { extractRelations } from "./relationExtraction"

/**
 * **从原话抽关系**（方案 C）。首要判据就是用户现场那一句 —— 它的失败促成了这条路线。
 *
 * 抽取器收一个 `indexOf`（点名 → 顶点下标），targets 一律是下标名 `v0`、`v1`…
 * （与 `relations.ts` 的判据同口径）。下面用顶点顺序 P、A、B、C、D 做映射。
 */
const PYRAMID_ORDER = ["P", "A", "B", "C", "D"]
const indexOf = (names: string[]) => (name: string) => names.indexOf(name)

describe("extractRelations", () => {
  it("reads the user's reported sentence — the one the model would not declare", () => {
    const prompt = "在四棱锥 P-ABCD 中，PA垂直 平面 ABCD，BC平行 AD，AB垂直AD，画出P-ABCD"

    const { relations, unverified } = extractRelations(prompt, indexOf(PYRAMID_ORDER))

    // 三条关系全部抽到，一条不少。**顺序按关系词表**（perpendicular → parallel → …），
    // 不是按句子里的出现顺序 —— 所以这里比集合，不比序列。
    expect(unverified).toEqual([])
    expect(relations).toHaveLength(3)
    expect(new Set(relations.map((entry) => entry.relation.kind))).toEqual(new Set(["perpendicular", "parallel"]))

    const targetsOf = (entry: { relation: { targets: { vertex: string }[] } }) => entry.relation.targets.map((target) => target.vertex)
    const byTargets = (targets: string[]) => relations.find((entry) => JSON.stringify(targetsOf(entry)) === JSON.stringify(targets))
    // PA ⊥ 平面 ABCD：线 - 面，前两点定线、后三点定面。
    expect(byTargets(["v0", "v1", "v1", "v2", "v3"])?.relation.kind).toBe("perpendicular")
    expect(relations.find((entry) => entry.evidence.includes("线 - 平面"))).toBeTruthy()
    // BC ∥ AD：线 - 线。
    expect(byTargets(["v2", "v3", "v1", "v4"])?.relation.kind).toBe("parallel")
    // AB ⊥ AD：线 - 线。
    expect(byTargets(["v1", "v2", "v1", "v4"])?.relation.kind).toBe("perpendicular")
  })

  it("reads the symbol spellings too", () => {
    const { relations, unverified } = extractRelations("PA ⊥ 平面ABCD，BC ∥ AD", indexOf(PYRAMID_ORDER))

    expect(unverified).toEqual([])
    expect(relations.map((entry) => entry.relation.kind)).toEqual(["perpendicular", "parallel"])
    expect(relations[0].relation.targets.map((target) => target.vertex)).toEqual(["v0", "v1", "v1", "v2", "v3"])
  })

  it("reads a midpoint spelled as point-plus-segment", () => {
    const names = ["A", "B", "C", "M", "P", "D"]
    const { relations } = extractRelations("M是中点 AD", indexOf(names))

    expect(relations).toHaveLength(1)
    expect(relations[0].relation.kind).toBe("midpoint")
    // M 是下标 3，A 是 0，D 是 5。
    expect(relations[0].relation.targets.map((target) => target.vertex)).toEqual(["v3", "v0", "v5"])
  })

  it("reads equal length and ratio as segment pairs", () => {
    // `等长` / `之比` 是**后缀词**：两条线段写在它前面（`BC与AD等长`），
    // 所以左侧要取**倒数第二段**，不是紧邻的那一段。实测踩到过。
    const equal = extractRelations("BC与AD等长", indexOf(PYRAMID_ORDER))
    expect(equal.relations).toHaveLength(1)
    expect(equal.relations[0].relation.kind).toBe("equalLength")
    expect(equal.relations[0].relation.targets.map((target) => target.vertex)).toEqual(["v2", "v3", "v1", "v4"])

    const ratio = extractRelations("BC与AD之比", indexOf(PYRAMID_ORDER))
    expect(ratio.relations).toHaveLength(1)
    expect(ratio.relations[0].relation.kind).toBe("ratio")
    expect(ratio.relations[0].relation.targets.map((target) => target.vertex)).toEqual(["v2", "v3", "v1", "v4"])
  })

  /**
   * **不假装读懂**：抽不出来的一律进 `unverified`，由调用方如实告诉用户"这条没被核验"。
   * 空说"已全部核验"是这类工作里最容易犯的错。
   */
  it("reports what it could not read instead of silently verifying nothing", () => {
    // 点名不在计划里（E 不是这份四棱锥的顶点）。
    const notInPlan = extractRelations("AE垂直 平面ABCD", indexOf(PYRAMID_ORDER))
    expect(notInPlan.relations).toEqual([])
    expect(notInPlan.unverified.some((line) => line.includes("不在这份计划里"))).toBe(true)

    // 关系词两侧读不到点名。
    const noNames = extractRelations("这两个东西互相垂直", indexOf(PYRAMID_ORDER))
    expect(noNames.relations).toEqual([])
    expect(noNames.unverified.some((line) => line.includes("没有读到两侧的点名"))).toBe(true)
  })

  it("does not fire on words that merely contain a relation character", () => {
    // 踩过的坑：宽口径下"一角 60°"会被当成垂直关系。
    expect(extractRelations("底面边长 2、一角 60° 的菱形斜四棱柱", indexOf(PYRAMID_ORDER)).relations).toEqual([])
    // "比如"里的"比"同理。
    expect(extractRelations("比如画一个棱柱", indexOf(PYRAMID_ORDER)).relations).toEqual([])
  })

  it("returns nothing (and says so) for a sentence with no relation words at all", () => {
    const result = extractRelations("画一个四棱锥", indexOf(PYRAMID_ORDER))
    expect(result.relations).toEqual([])
    expect(result.unverified).toEqual([])
  })

  /**
   * **用户现场第二句（2026-10-04）**：三棱锥 A-BCD 的题面。它同时含三种关系，
   * 而且点名有 6 个（A B C D O E）—— 是抽取器目前见过最复杂的一句。
   *
   * 这条用例的价值：它把"抽取器对真实题面到底读出什么"变成可复核的读数。
   * 真实运行里那一句**没有**报 `relation_not_declared`（说明它过了门禁），
   * 但到底抽出几条、有没有误抽，只有这里能看清。
   */
  it("reads the tetrahedron sentence: the midpoint, and honestly reports the plane-perpendicular it cannot check", () => {
    const prompt = "在三棱锥 A-BCD中，平面 ABD⊥平面 BCD，且 AB=AD，O为 BD的中点"
    // 点名按原话出现顺序：A、B、C、D、O。
    const order = ["A", "B", "C", "D", "O"]

    const { relations, unverified } = extractRelations(prompt, indexOf(order))

    // 中点必须抽到，而且指向正确的下标对（O 是 v4、B v1、D v3）。
    const midpoint = relations.find((entry) => entry.relation.kind === "midpoint")
    expect(midpoint, JSON.stringify(relations)).toBeTruthy()
    expect(midpoint!.relation.targets.map((target) => target.vertex)).toEqual(["v4", "v1", "v3"])

    /**
     * **平面⊥平面 本批不支持 —— 但它必须被如实报成"未核验"，不能静默丢掉。**
     *
     * 我们只实现了"线-线"与"线-面"（3 个 / 5 个顶点）。`平面 ABD⊥平面 BCD` 是**面-面**，
     * 判据不存在。这条断言钉住的正是诚实性：宁可说"这条没法验"，也不许它悄悄消失、
     * 然后整个计划被宣布"关系全部成立"。
     */
    expect(relations.some((entry) => entry.relation.kind === "perpendicular")).toBe(false)
    expect(unverified.some((line) => line.includes("⊥"))).toBe(true)

    // 这一句里没有"平行/共面/等长/比例"的可靠写法，尤其**不许凭 `AB=AD` 猜等长**。
    const kinds = relations.map((entry) => entry.relation.kind)
    expect(kinds).not.toContain("parallel")
    expect(kinds).not.toContain("coplanar")
    expect(kinds).not.toContain("equalLength")
  })
})
