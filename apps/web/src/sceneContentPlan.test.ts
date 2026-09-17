import { describe, expect, it } from "vitest"

import { planContentSync, type ContentEntry } from "./sceneContentPlan"

/**
 * 内容同步的差分计划。
 *
 * 场景内容以前是"每次同步全清全建"：改一个图元、点一下选中、展开动画的每一帧，
 * 都要把整场对象（含网格与坐标轴）释放重建一遍。这里把"哪些能沿用、哪些要重建、哪些要丢"
 * 抽成纯函数，由它决定每个对象的重建与否——签名没变就绝不碰它。
 */

const entry = (key: string, signature: string): ContentEntry => ({ key, signature })

const previous = (pairs: [string, string][]) => new Map(pairs)

describe("planContentSync", () => {
  it("creates everything on the first sync", () => {
    const plan = planContentSync(new Map(), [entry("a", "1"), entry("b", "2")])

    expect(plan.created).toEqual(["a", "b"])
    expect(plan.reused).toEqual([])
    expect(plan.removed).toEqual([])
  })

  it("reuses everything when no signature changed", () => {
    const plan = planContentSync(previous([["a", "1"], ["b", "2"]]), [entry("a", "1"), entry("b", "2")])

    expect(plan.reused).toEqual(["a", "b"])
    expect(plan.created).toEqual([])
    expect(plan.removed).toEqual([])
  })

  it("rebuilds only the entry whose signature changed", () => {
    const plan = planContentSync(previous([["a", "1"], ["b", "2"], ["c", "3"]]), [
      entry("a", "1"),
      entry("b", "2-changed"),
      entry("c", "3")
    ])

    expect(plan.created).toEqual(["b"])
    expect(plan.reused).toEqual(["a", "c"])
    expect(plan.removed).toEqual([])
  })

  it("removes the entries that are gone", () => {
    const plan = planContentSync(previous([["a", "1"], ["b", "2"]]), [entry("a", "1")])

    expect(plan.removed).toEqual(["b"])
    expect(plan.reused).toEqual(["a"])
    expect(plan.created).toEqual([])
  })

  it("keeps the order of the new entries, so the scene can be re-ordered to match", () => {
    const plan = planContentSync(previous([["a", "1"], ["b", "2"], ["c", "3"]]), [entry("c", "3"), entry("a", "1"), entry("d", "4")])

    expect(plan.order).toEqual(["c", "a", "d"])
    expect(plan.created).toEqual(["d"])
    expect(plan.reused).toEqual(["c", "a"])
    expect(plan.removed).toEqual(["b"])
  })

  it("counts a rebuilt entry once even when it is also new to the list", () => {
    const plan = planContentSync(previous([["a", "1"]]), [entry("a", "2"), entry("a", "2")])

    expect(plan.created).toEqual(["a"])
    expect(plan.order).toEqual(["a"])
  })
})
