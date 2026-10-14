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

  it("**已收口（施工单①，2026-10-15）**：`P 是椭圆上任意一点` 现在读成一条**可核验**的题设", () => {
    /**
     * 这条断言原先钉的是**缺口本身**（"整句消失"）。现在它翻转成正面判据：
     * 那句话必须进 `givens`，带点名 `P` 与曲线种类 `ellipse`，而且**不许**再落进未核验
     *（同一句话在两处记账，就是这个仓最忌讳的那种乱账）。
     */
    const parsed = parseDiagramObligations("椭圆 x²/9+y²/4=1，P 是椭圆上任意一点，作 P 处的切线。")
    const pointOn = parsed.givens.filter((item) => item.kind === "pointOnConic")
    expect(pointOn.map((item) => item.targets), `给定：${JSON.stringify(parsed.givens.map((i) => [i.kind, i.targets]))}`).toEqual([["P"]])
    expect(pointOn[0]!.sourceText).toBe("P 是椭圆上任意一点")
    expect(pointOn[0]!.conicKind).toBe("ellipse")
    expect(parsed.unverified.some((entry) => entry.sourceText.includes("椭圆上"))).toBe(false)
  })

  it("三种说法 × 三类曲线都收：`是` / `在` / `为` × 椭圆 / 双曲线 / 抛物线", () => {
    const cases: [string, "ellipse" | "hyperbola" | "parabola"][] = [
      ["双曲线 x²/4−y²/3=1，P 是双曲线上一点", "hyperbola"],
      ["抛物线 y²=4x，Q 在抛物线上", "parabola"],
      ["椭圆 x²/9+y²/4=1，M 为椭圆上一点", "ellipse"]
    ]
    for (const [prompt, kind] of cases) {
      const parsed = parseDiagramObligations(prompt)
      const found = parsed.givens.find((item) => item.kind === "pointOnConic")
      expect(found?.conicKind, prompt).toBe(kind)
      expect(found?.targets.length, prompt).toBe(1)
    }
  })

  it("**不是**这一条的写法不许被顺手读成它：`外一点` 说的是相反的事", () => {
    /**
     * `P 是椭圆外一点` 与"在曲线上"是**相反**的两件事 —— 读成 `pointOnConic` 就是把题面读反，
     * 而"读反"比"读不出"更坏（用户拿到一个绿字，图上那点却在曲线里面）。
     *
     * 但"在外面"同样是一条题设，所以它也不许消失：这正是触发词表要接住的那一类
     *（与当年 `弦 AB 的长为 3` 同一种病）。
     */
    const outside = parseDiagramObligations("椭圆 x²/9+y²/4=1，P 是椭圆外一点。")
    expect(outside.givens.filter((item) => item.kind === "pointOnConic")).toEqual([])
    const accounted = [...outside.givens.map((item) => item.sourceText), ...outside.unverified.map((entry) => entry.sourceText)]
    expect(accounted.some((text) => text.includes("椭圆外")), `既没读出来、也没落进未核验：${JSON.stringify(accounted)}`).toBe(true)
  })
})
