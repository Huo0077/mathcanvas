import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "../diagramObligations"
import { bridgeProofPremises } from "./proofPremiseBridge"

/**
 * **前提桥**（V2 GREEN 缺口②的后半）：把"命题要的前提"逐条对照**原题题面**。
 *
 * ## 它解决的是什么问题
 *
 * 适配器文件头一直写着一条诚实边界：**模板里的前提是"模板给的"，不是从题设消解出来的**。
 * 那条边界不是靠一句注释解决的 —— 它是靠**把每一前提标出来源**解决的。这一层就是干这个的：
 *
 * - `fromText`：这条前提**就是题面里的哪一句话**（带 `sourceText`，可以指给用户看）；
 * - `fromFigure`：题面**没说**，但由图形自身的构造蕴含（例如"B、D 都是底面的顶点" ⇒
 *   "BD 落在底面内"）。**必须列出来**，因为它确实是系统补的；
 * - `invented`：既不在题面、也不由图形蕴含 —— 那就是**凭空加前提**，**桥必须失败**。
 *
 * 判据的关键是第③类：**只要有一条前提要凭空编，就不许往下走**（`ok === false`）。
 * 这与"证不出来"是两件事（那是 Lean 的结论），这里说的是"我们连命题都还没资格生成"。
 */
describe("前提桥：每条前提都要指得出出处", () => {
  it("判定定理那条路：两个前提**逐字来自题面**（而且指得出是哪一句）", () => {
    const set = parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC")
    const bridge = bridgeProofPremises(
      {
        goalKind: "linePlanePerpendicular",
        line: { first: "P", second: "A" },
        planeLines: [
          { first: "A", second: "B" },
          { first: "A", second: "C" }
        ]
      },
      set
    )

    expect(bridge.ok).toBe(true)
    expect(bridge.invented).toEqual([])
    expect(bridge.fromText.map((entry) => entry.premise).sort()).toEqual(["PA ⊥ AB", "PA ⊥ AC"])
    // **指得出出处**：每一条都带着题面里的那一句原文（不是我们自己编的说明）。
    for (const entry of bridge.fromText) {
      expect(set.givens.some((given) => given.sourceText === entry.sourceText)).toBe(true)
    }
  })

  it("性质定理那条路：**线⊥面那一条来自题面**，而「目标线落在平面内」只能如实标成**图形蕴含**", () => {
    const set = parseDiagramObligations("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，求证 PA ⊥ BD")
    const bridge = bridgeProofPremises(
      {
        goalKind: "perpendicular",
        lineA: { first: "P", second: "A" },
        planePoints: ["A", "B", "C"],
        lineB: { first: "B", second: "D" }
      },
      set
    )

    // 题面里确实有"PA ⊥ 平面 ABCD"这一句 ⇒ 前提一来自题面。
    expect(bridge.fromText.map((entry) => entry.premise)).toEqual(["PA ⊥ 平面 ABCD"])
    // 而"BD 落在平面 ABCD 内"题面**没有说** —— 它是图形构造蕴含的，必须**列出来**而不是默认掉。
    expect(bridge.fromFigure).toHaveLength(1)
    expect(bridge.fromFigure[0]!.premise).toContain("BD")
    expect(bridge.fromFigure[0]!.reason.length).toBeGreaterThan(0)
    // 没有凭空编的前提 ⇒ 桥通过（但上面那条 fromFigure 是**系统补的**，如实记着）。
    expect(bridge.invented).toEqual([])
    expect(bridge.ok).toBe(true)
  })

  it("**题面根本没给垂直 ⇒ 桥失败**：不许替题面补一条它没说的前提", () => {
    const set = parseDiagramObligations("在四棱锥 P-ABCD 中，底面 ABCD 是正方形，求证 PA ⊥ BD")
    const bridge = bridgeProofPremises(
      {
        goalKind: "perpendicular",
        lineA: { first: "P", second: "A" },
        planePoints: ["A", "B", "C"],
        lineB: { first: "B", second: "D" }
      },
      set
    )

    expect(bridge.ok).toBe(false)
    expect(bridge.fromText).toEqual([])
    // 标签按**目标自己的点名**渲染：这条目标只知道平面 ABC（模板只吃三个点），所以写成 `平面 ABC`。
    expect(bridge.invented.map((entry) => entry.premise)).toEqual(["PA ⊥ 平面 ABC"])
  })

  it("**「面⊥面」不许被当成「线⊥面」这条前提**（与目标消解同一口径）", () => {
    const set = parseDiagramObligations("在正方体中，平面A₁B₁C₁D₁⊥平面ABCD，求证 AA₁ ⊥ 平面ABCD")
    const bridge = bridgeProofPremises(
      {
        goalKind: "linePlanePerpendicular",
        line: { first: "A", second: "A₁" },
        planeLines: [
          { first: "A", second: "B" },
          { first: "A", second: "C" }
        ]
      },
      set
    )

    // 题面那条给的是"面⊥面"，它**不是**"AA₁ ⊥ AB"也不是"AA₁ ⊥ AC" ⇒ 两条前提都得算凭空编。
    expect(bridge.fromText).toEqual([])
    expect(bridge.invented).toHaveLength(2)
    expect(bridge.ok).toBe(false)
  })

  it("题面给的是**线⊥面**时，判定定理那两条前提算**一步导出**（走性质定理），不算凭空编", () => {
    const set = parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ 平面 ABC")
    const bridge = bridgeProofPremises(
      {
        goalKind: "linePlanePerpendicular",
        line: { first: "P", second: "A" },
        planeLines: [
          { first: "A", second: "B" },
          { first: "A", second: "C" }
        ]
      },
      set
    )

    // 两条前提都不是题面**直接**给的（题面只给了"线⊥面"），但都可以由它**一步**导出。
    expect(bridge.fromText).toEqual([])
    expect(bridge.invented).toEqual([])
    expect(bridge.fromDerivation).toHaveLength(2)
    for (const entry of bridge.fromDerivation) {
      // 那一步要**点名**（不许写成一句"等价"）：这是线面垂直的性质定理。
      expect(entry.theorem).toContain("性质定理")
      // 而它的来源仍然指得回题面那一句。
      expect(entry.viaSourceText).toBe("PA ⊥ 平面 ABC")
    }
    expect(bridge.ok).toBe(true)
  })

  it("**「线⊥面」那一步不能乱用**：平面里没有的那条线，接不出来（必须算凭空编）", () => {
    const set = parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ 平面 ABC")
    const bridge = bridgeProofPremises(
      {
        goalKind: "linePlanePerpendicular",
        line: { first: "P", second: "A" },
        planeLines: [
          { first: "A", second: "B" },
          { first: "D", second: "E" } // D、E 根本不在平面 ABC 上
        ]
      },
      set
    )

    expect(bridge.fromDerivation).toHaveLength(1) // AB 那一条接得出来
    expect(bridge.invented).toHaveLength(1) // DE 那一条接不出来
    expect(bridge.invented[0]!.premise).toBe("PA ⊥ DE")
    expect(bridge.ok).toBe(false)
  })

  it("**切线那一类今天走不通产品链路**：命题是条件命题，而「可导」题面没给（也不许替它编）", () => {
    const set = parseDiagramObligations("已知函数 f(x)=x³−3x，求曲线在 x=1 处的切线")
    const bridge = bridgeProofPremises({ goalKind: "tangentSlope", tangentSlope: { functionName: "f" } }, set)

    expect(bridge.ok).toBe(false)
    expect(bridge.fromText).toEqual([])
    expect(bridge.invented).toHaveLength(1)
    // 理由要点名**缺哪一条**，并说清它是这条命题唯一的前提。
    expect(bridge.invented[0]!.premise).toContain("可导")
    expect(bridge.invented[0]!.why).toContain("唯一")
    expect(bridge.invented[0]!.why).toContain("数学事实")
  })

  it("**题面写了「可导」也一样走不通**（解析层没有读它的句型，所以那句话进的是 `unverified`）", () => {
    const set = parseDiagramObligations("已知函数 f(x)=x³−3x 可导，求曲线在 x=1 处的切线")
    const bridge = bridgeProofPremises({ goalKind: "tangentSlope", tangentSlope: { functionName: "f" } }, set)

    // **先钉住上游那件事**：这句话没有被解析成题设（`givens` 里没有它）——
    // 所以桥不能"假装查到了"，只能如实说"没有出处"。
    expect(set.givens.some((given) => given.sourceText.includes("可导"))).toBe(false)
    expect(bridge.ok).toBe(false)
    expect(bridge.invented).toHaveLength(1)
  })
  it("题面把两条垂直写成**没有共享端点**的两句 ⇒ 也不能当判定定理的前提（相交是前提的一部分）", () => {
    const set = parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ AB，PB ⊥ BC")
    const bridge = bridgeProofPremises(
      {
        goalKind: "linePlanePerpendicular",
        line: { first: "P", second: "A" },
        planeLines: [
          { first: "A", second: "B" },
          { first: "B", second: "C" }
        ]
      },
      set
    )

    // 题面给的是"PA ⊥ AB"与"PB ⊥ BC"：第二条讲的不是 PA，所以它**不是**这条命题的前提。
    expect(bridge.fromText.map((entry) => entry.premise)).toEqual(["PA ⊥ AB"])
    expect(bridge.invented.map((entry) => entry.premise)).toEqual(["PA ⊥ BC"])
    expect(bridge.ok).toBe(false)
  })
})
