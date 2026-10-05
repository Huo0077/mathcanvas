import { beforeEach, describe, expect, it } from "vitest"

import { loadConstrainedDragEnabled, NEXT_PHASE_PREFERENCES_KEY, saveConstrainedDragEnabled } from "./nextPhasePreferences"

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
