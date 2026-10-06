import { describe, expect, it } from "vitest"

import { isPointName, splitPointNames } from "./pointNames"

/**
 * **点名语法的唯一来源**（S1；见 [立体图形覆盖扩宽实施计划](../../../docs/superpowers/plans/2026-10-07-solid-shape-coverage-implementation-plan.md)）。
 *
 * 为什么要有这个模块：同一个判断此前写在**三处** —— 解析器的 `names()`（`[...value]` 拆字）、
 * 核验器的 `candidatePoints`（`/^[A-Z]$/`）、内核顶面的 `A′` 生成。三处各写一份，棱柱就卡在
 * "解析层产不出带撇点名"上：实测 `在三棱柱ABCD-A₁B₁C₁D₁中，AA₁⊥平面ABCD` **一条 given 都产不出**
 * （设计 §1.1 的探针读数）。
 *
 * 本仓的点名 = 一个大写字母 + **可选的撇或下标**（`A′` / `A'` / `A₁`）。
 * ASCII 的 `A1` **不是**本仓写法：它必须留在"读不出"那一侧，不许被凑合解析成 `A₁`。
 */

describe("点名语法", () => {
  it("按点名切开连写串，而不是按码位切", () => {
    // `[...value]` 会把 "A′B" 切成 ["A","′","B"] —— 这正是解析层读不出带撇点名的原因。
    expect(splitPointNames("A′B")).toEqual(["A′", "B"])
    expect(splitPointNames("AA₁")).toEqual(["A", "A₁"])
    expect(splitPointNames("ABCD")).toEqual(["A", "B", "C", "D"])
  })

  it("单个点名带撇或下标都算点名", () => {
    expect(isPointName("A")).toBe(true)
    expect(isPointName("A′")).toBe(true)
    expect(isPointName("A'")).toBe(true)
    expect(isPointName("A₁")).toBe(true)
  })

  it("不是点名的写法不许被凑合", () => {
    expect(isPointName("AB")).toBe(false)
    expect(isPointName("A1")).toBe(false)
    expect(isPointName("a")).toBe(false)
    expect(isPointName("")).toBe(false)
  })

  it("拆出来的点名必须正好铺满输入，否则如实报『拆不出』而不是丢掉看不懂的字符", () => {
    expect(splitPointNames("A1")).toEqual([])
    expect(splitPointNames("A,B")).toEqual([])
    expect(splitPointNames("")).toEqual([])
  })
})
