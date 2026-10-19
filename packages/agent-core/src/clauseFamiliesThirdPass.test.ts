import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

/**
 * **「有判据却读不出」与「没判据却静默」的第三批**（2026-10-20）。
 *
 * 探针（41 个常见写法逐个喂进解析器）照出两类问题，这一批各修一半：
 *
 * 1. **有判据、但读取器不认这种写法**：`线段 AB 的长度为 3` / `AB 的长为 3` / `AB 的长是 3`
 *    曾经**既不产义务也不落未核验**（只有带「弦」字的那种写法能读）—— 而这是卷面上最常见的
 *    长度说法之一。另外 `AD 是 BC 边上的中线` 也是一条**能被唯一确定**的条件：中线到 BC ⇒
 *    `D` 就是 `BC` 的中点，直接落 `midpoint`。
 * 2. **没判据、但也不显形**：角平分线 / 中位线 / 内心 / 旁心 / 弦心距 / 弧长 / 轴截面 / 展开图 /
 *    球的面积与半径 / 棱数 / 仰角 / 俯角 / 坡度 —— 这一族的判据今天确实没有，但它们**不许消失**，
 *    要落进未核验并说清是哪一族。
 *
 * **一条假的义务比一条读不出更糟**：`|AB|=2|AC|` 曾经被读成"AB 长 2"（把 `|AC|` 那半截丢了）。
 * 长度读取器的尾部负向断言因此多带一个 `|` —— 右边还跟着东西就不算一个长度。
 */
const lengths = (prompt: string) =>
  parseDiagramObligations(prompt).givens.filter((item) => item.kind === "fixedLength").map((item) => [item.targets, item.value])

const unverified = (prompt: string) => parseDiagramObligations(prompt).unverified.map((entry) => `${entry.sourceText}｜${entry.reason}`).join("\n")

describe("长度写成「的长度 / 的长」", () => {
  it("`线段AB的长度为3` ⇒ fixedLength", () => {
    expect(lengths("线段AB的长度为3")).toEqual([[["A", "B"], 3]])
  })

  it("`AB的长为3` 与 `AB的长是3` 都读得出", () => {
    expect(lengths("AB的长为3")).toEqual([[["A", "B"], 3]])
    expect(lengths("AB的长是3")).toEqual([[["A", "B"], 3]])
  })

  it("带「弦」的老写法照旧（不回归）", () => {
    expect(lengths("弦AB的长为3")).toEqual([[["A", "B"], 3]])
  })

  /**
   * **反向判据**：`|AB|=2|AC|` 说的是"AB 是 AC 的两倍"，**不是**"AB 长 2"。
   * 读成后者会为一句题面里没有的条件报"不满足"。
   */
  it("`|AB|=2|AC|` 不许被读成 AB 的长度", () => {
    expect(lengths("|AB|=2|AC|")).toEqual([])
    expect(unverified("|AB|=2|AC|")).toContain("|AB|=2|AC|")
  })

  it("`|AB|=2` 仍然是一个长度（右边没有跟着东西）", () => {
    expect(lengths("|AB|=2")).toEqual([[["A", "B"], 2]])
  })
})

describe("中线：能唯一确定的就读成中点", () => {
  it("`AD是BC边上的中线` ⇒ D 是 BC 的中点", () => {
    const midpoints = parseDiagramObligations("在△ABC中，AD是BC边上的中线").givens.filter((item) => item.kind === "midpoint")
    expect(midpoints.map((item) => item.targets)).toEqual([["D", "B", "C"]])
  })

  it("`AD是△ABC的中线` ⇒ 不猜是哪条边，但显形", () => {
    const parsed = parseDiagramObligations("在△ABC中，AD是△ABC的中线")
    expect(parsed.givens.filter((item) => item.kind === "midpoint")).toEqual([])
    expect(parsed.unverified.map((entry) => entry.sourceText).join("｜")).toContain("中线")
  })
})

describe("没判据的家族要显形（而且说清是哪一族）", () => {
  const cases: [string, string][] = [
    ["在△ABC中，AD是角平分线", "角平分线"],
    ["在△ABC中，DE是△ABC的中位线", "中位线"],
    ["在△ABC中，O为△ABC的内心", "内心"],
    ["在△ABC中，O为△ABC的旁心", "旁心"],
    ["AB是⊙O的弦，弦心距为2", "弦心距"],
    ["弧AB的长为π", "弧"],
    ["圆柱的轴截面是正方形", "轴截面"],
    ["圆锥的侧面展开图是半径为3的半圆", "展开图"],
    ["球的表面积为16π", "球"],
    ["仰角为60°，俯角为30°", "仰角"],
    ["已知斜面坡度为1:2", "坡度"]
  ]

  it.each(cases)("`%s` ⇒ 落未核验，理由点名 %s", (prompt, keyword) => {
    const text = unverified(prompt)
    expect(text, text).toContain(keyword)
    // 不是那句"什么都可能"的兜底 —— 用户要能看出是哪一族没判据。
    expect(text).not.toBe("")
  })
})
