import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

/**
 * **圆柱 / 圆锥那一类：曲线上的点**（2026-10-15，覆盖清单里剩下的两块硬欠账之一）。
 *
 * ## 今天的事实（本轮量出来的）
 *
 * - **读取器一个都没有**：`圆周` / `圆上` / `母线` / `底面圆` 在 `diagramObligations.ts` 里
 *   一处都不出现 —— 所以「A、B 分别为下底面圆周上的点」读不成任何题设；
 * - 动作侧**有落点的家伙**：`dynamic.bind_curve`（`{ target, pathId, parameter }`），
 *   也就是"把一个点绑到某条曲线上、按参数定位" —— 补建要复用的正是它。
 *
 * ## 这一轮做了什么、没做什么
 *
 * **做了**：把 `圆周 / 圆上 / 母线 / 底面圆` 加进残留扫描器的触发词 ⇒ 这类句子
 * **至少不会静默消失**（会落进"未核验"，用户与门禁都看得见）。
 * 在此之前它与当年那条 `弦 AB 的长为 3` 是同一种病：**既不进给定、也不进未核验**。
 *
 * **没做**：真正的补建（要能从题面认出"是哪条曲线"与"参数是多少"，再落成
 * `dynamic.bind_curve`）。所以下面第二条用例仍然钉着"整轮不许假装核验过"。
 */
describe("曲线上的点：今天不能被静默丢掉", () => {
  it("「下底面圆周上的点」这类句子**必须**出现在未核验里（不是消失）", () => {
    const prompt = "在圆柱OO₁中，A、B分别为下底面圆周上的点，且AB=2。"
    const parsed = parseDiagramObligations(prompt)
    const accounted = [...parsed.givens.map((item) => item.sourceText), ...parsed.unverified.map((entry) => entry.sourceText)]
    // 不许被"读懂"（今天没有读取器）……
    expect(parsed.givens.filter((item) => item.sourceText.includes("圆周"))).toEqual([])
    // ……但更不许消失：这一句必须留下痕迹。
    expect(accounted.some((text) => text.includes("圆周")), `既没读出来、也没落进未核验：给定=${JSON.stringify(parsed.givens.map((i) => i.sourceText))} 未核验=${JSON.stringify(parsed.unverified.map((i) => i.sourceText))}`).toBe(true)
  })

  it("母线中点同样留下痕迹（这是「补建」将来要接的口）", () => {
    const parsed = parseDiagramObligations("在圆柱OO₁中，M为母线AA₁的中点。")
    const accounted = [...parsed.givens.map((item) => item.sourceText), ...parsed.unverified.map((entry) => entry.sourceText)]
    expect(accounted.some((text) => text.includes("母线")), `给定/未核验：${JSON.stringify(accounted)}`).toBe(true)
  })

  it("**另一处同类缺口（如实钉住）**：「P 是椭圆上任意一点」今天也读不出来，而且**整句消失**", () => {
    /**
     * 这条是上一轮那次**子串误伤顺带照出来的**：`圆上` 命中「椭**圆上**」时，这句会落进未核验；
     * 把触发词收窄成 `(?<!椭)圆上` 之后，它又回到"**没人管**"的状态。
     *
     * 今天的事实与当年那条 `弦 AB 的长为 3` 是同一种病：**既不进给定、也不进未核验**。
     * 补上"点在圆锥曲线上"的读取器之后，这条断言要**翻转**成"落进未核验 / 能核验"。
     */
    const parsed = parseDiagramObligations("椭圆 x²/9+y²/4=1，P 是椭圆上任意一点，作 P 处的切线。")
    const accounted = [...parsed.givens, ...parsed.unverified].map((item) => item.sourceText)
    expect(parsed.givens.filter((item) => item.sourceText.includes("椭圆上")), "今天读不出来").toEqual([])
    expect(accounted.some((text) => text.includes("椭圆上")), `今天它应当是**消失**的（这正是缺口本身）：${JSON.stringify(accounted)}`).toBe(false)
  })
})
