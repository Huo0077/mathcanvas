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
})
