import { beforeEach, describe, expect, it } from "vitest"

import { loadConstrainedDragEnabled, loadWitnessSearchEnabled, NEXT_PHASE_PREFERENCES_KEY, saveConstrainedDragEnabled, saveWitnessSearchEnabled } from "./nextPhasePreferences"

/**
 * **N3 的第一个产品入口**（开关从哪来）。
 *
 * 这一组用例守的是三件事，缺一不可：
 *
 * 1. **默认是关** —— 没存过就必须是 `false`。一个"默认开"的实验性开关等于没有开关，
 *    而 N3 的离路径（关着时走原来的 `translatePrimitive3`）也就无从验证。
 * 2. **存了能读回来** —— 用户的意图要跨会话保持。
 * 3. **坏数据当作关** —— 存储里可能是任何东西（旧版本、手改、别的程序写的）。
 *    读偏好这件事**绝不允许**把坏数据变成"开"，也不允许抛异常把整个工作台带崩；
 *    与 `draftStorage.ts` 里 `loadViewPreference3d` 的口径一致：**存不下 / 读不出属于可接受降级**。
 */
describe("next-phase 偏好（localStorage）", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("没存过 → 关（默认必须是关，不是开）", () => {
    expect(loadConstrainedDragEnabled()).toBe(false)
  })

  it("存了再做一轮 → 读回来是同一个值", () => {
    saveConstrainedDragEnabled(true)

    expect(loadConstrainedDragEnabled()).toBe(true)

    saveConstrainedDragEnabled(false)

    expect(loadConstrainedDragEnabled()).toBe(false)
  })

  it("见证搜索**默认开**（2026-10-15 用户裁决）；显式关掉才关，且不覆盖约束拖动", () => {
    /**
     * 与同组那两条实验开关口径相反，这里是刻意的：这条救援「只救不抢」——
     * 第一遍核验通过时它一步都不动，第二遍必须真的通过才采用（见 `nextPhasePreferences.ts` 的说明）。
     * 所以默认开是单调变好；`false` 仍然有效，让用户在设置里关掉它。
     */
    expect(loadWitnessSearchEnabled()).toBe(true)
    saveConstrainedDragEnabled(true)
    saveWitnessSearchEnabled(true)
    expect(loadWitnessSearchEnabled()).toBe(true)
    expect(loadConstrainedDragEnabled()).toBe(true)
    saveWitnessSearchEnabled(false)
    expect(loadWitnessSearchEnabled()).toBe(false)
    expect(loadConstrainedDragEnabled()).toBe(true)
  })

  it("坏数据**不会把默认能力关掉**：畸形 JSON 与字符串 `\"true\"` 都按默认（开）读", () => {
    /**
     * 原先这一条钉的是"坏数据不能**启用**"（那时默认是关）。默认翻转之后它钉的是反面：
     * 坏数据不能**关掉**一个默认能力 —— 两条都成立的原因是同一个：**偏好只认布尔 `false`**。
     */
    localStorage.setItem(NEXT_PHASE_PREFERENCES_KEY, '{ bad json')
    expect(loadWitnessSearchEnabled()).toBe(true)
    localStorage.setItem(NEXT_PHASE_PREFERENCES_KEY, JSON.stringify({ witnessSearch: "true" }))
    expect(loadWitnessSearchEnabled()).toBe(true)
  })
  it("存的是坏东西 → 当作关，不抛异常", () => {
    localStorage.setItem(NEXT_PHASE_PREFERENCES_KEY, "{ 这不是 JSON")

    expect(loadConstrainedDragEnabled()).toBe(false)

    // 形状不对（不是布尔）也必须当作关 —— 不能把 `"yes"` 这种真值当成 true。
    localStorage.setItem(NEXT_PHASE_PREFERENCES_KEY, JSON.stringify({ constrainedDrag: "yes" }))

    expect(loadConstrainedDragEnabled()).toBe(false)
  })

  it("存的是别的键 → 仍然关（不许把无关的偏好读成这个开关）", () => {
    localStorage.setItem(NEXT_PHASE_PREFERENCES_KEY, JSON.stringify({ 别的东西: true }))

    expect(loadConstrainedDragEnabled()).toBe(false)
  })
})
