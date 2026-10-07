import { describe, expect, it } from "vitest"

import { canonicalPointName, isPointName, pointNameSuffixCount, splitPointNames } from "./pointNames"

/**
 * **点名语法的唯一来源**（S1；见 [立体图形覆盖扩宽实施计划](../../../docs/superpowers/plans/2026-10-07-solid-shape-coverage-implementation-plan.md)）。
 *
 * 为什么要有这个模块：同一个判断此前写在**三处** —— 解析器的 `names()`（`[...value]` 拆字）、
 * 核验器的 `candidatePoints`（`/^[A-Z]$/`）、内核顶面的 `A′` 生成。三处各写一份，棱柱就卡在
 * "解析层产不出带撇点名"上：实测 `在三棱柱ABCD-A₁B₁C₁D₁中，AA₁⊥平面ABCD` **一条 given 都产不出**
 * （设计 §1.1 的探针读数）。
 *
 * 本仓的点名 = 一个大写字母 + **至多两个后缀**（`A′` / `A'` / `A₁` / `A′′`）；
 * 后缀是撇或下标。ASCII 的 `A1` **不是**本仓写法：它必须留在"读不出"那一侧，不许被凑合解析成 `A₁`。
 */

describe("点名语法", () => {
  it("按点名切开连写串，而不是按码位切", () => {
    // `[...value]` 会把 "A′B" 切成 ["A","′","B"] —— 这正是解析层读不出带撇点名的原因。
    expect(splitPointNames("A′B")).toEqual(["A′", "B"])
    expect(splitPointNames("AA₁")).toEqual(["A", "A₁"])
    expect(splitPointNames("ABCD")).toEqual(["A", "B", "C", "D"])
    // 两个后缀的名字也要整块切出来（底面已带撇时顶面是 `A′′` —— 用户 2026-10-07 的裁决）。
    expect(splitPointNames("A′′B")).toEqual(["A′′", "B"])
  })

  it("单个点名带撇或下标都算点名", () => {
    expect(isPointName("A")).toBe(true)
    expect(isPointName("A′")).toBe(true)
    expect(isPointName("A'")).toBe(true)
    expect(isPointName("A₁")).toBe(true)
  })

  /**
   * **两层后缀**（2026-10-07 按用户裁决扩宽）。
   *
   * 为什么需要它：内核给棱柱顶面起名是"底面名 + 一层后缀"，而底面**自己**可能已经带撇
   * （题面 `ABCD-A′B′C′D′`）。此时 `A′` 被占，顶面只能是 `A′′` —— 裁决选的是**扩语法**
   * （另一条"明确拒绝整道题"被否掉）。**三层及以上没有真实来源，仍不算点名。**
   */
  it("两层后缀合法，三层不算", () => {
    expect(isPointName("A′′")).toBe(true)
    expect(isPointName("A′₁")).toBe(true)
    expect(isPointName("A₁₂")).toBe(true)
    expect(isPointName("A′′′")).toBe(false)
    expect(pointNameSuffixCount("A")).toBe(0)
    expect(pointNameSuffixCount("A′")).toBe(1)
    expect(pointNameSuffixCount("A′′")).toBe(2)
    expect(pointNameSuffixCount("A′′′")).toBe(-1)
  })

  it("`′` 与 `'` 是同一个后缀的两种字形，比较时要归一", () => {
    expect(canonicalPointName("A'")).toBe("A′")
    expect(canonicalPointName("A'₁")).toBe("A′₁")
    expect(canonicalPointName("A′")).toBe("A′")
  })

  it("不是点名的写法不许被凑合", () => {
    expect(isPointName("AB")).toBe(false)
    expect(isPointName("A1")).toBe(false)
    // ASCII 数字后缀**任何时候**都不是本仓写法 —— 包括"撇 + 数字"这种旧回退产物。
    expect(isPointName("A′2")).toBe(false)
    expect(isPointName("a")).toBe(false)
    expect(isPointName("")).toBe(false)
  })

  it("拆出来的点名必须正好铺满输入，否则如实报『拆不出』而不是丢掉看不懂的字符", () => {
    expect(splitPointNames("A1")).toEqual([])
    expect(splitPointNames("A,B")).toEqual([])
    expect(splitPointNames("")).toEqual([])
  })
})
