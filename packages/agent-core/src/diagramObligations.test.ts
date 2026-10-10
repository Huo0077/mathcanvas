import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"

const USER_PROMPT = "在三棱锥 A-BCD 中，BD=2，△OCD为等边三角形，AB=AD，O为BD的中点，DE=2EA，平面ABD⊥平面BCD，二面角E-BC-D=45°。求证 OA⊥CD"

describe("parseDiagramObligations", () => {
  it("lists the original seven givens without turning a proposition into a given", () => {
    const parsed = parseDiagramObligations(USER_PROMPT)
    expect(parsed.givens.map(({ kind }) => kind)).toEqual([
      "fixedLength", "equilateral", "equalLength", "midpoint", "segmentRatio", "planePerpendicular", "dihedral"
    ])
    expect(parsed.givens.map(({ sourceText }) => sourceText)).toEqual([
      "BD=2", "△OCD为等边三角形", "AB=AD", "O为BD的中点", "DE=2EA", "平面ABD⊥平面BCD", "二面角E-BC-D=45°"
    ])
    expect(parsed.goals).toEqual(["OA⊥CD"])
    expect(parsed.unverified).toEqual([])
  })

  it("retains numeric values, named targets and traceable source ranges", () => {
    const parsed = parseDiagramObligations(USER_PROMPT)
    expect(parsed.givens[0]).toMatchObject({ kind: "fixedLength", targets: ["B", "D"], value: 2 })
    expect(parsed.givens[4]).toMatchObject({ kind: "segmentRatio", targets: ["D", "E", "E", "A"], value: 2 })
    expect(parsed.givens[6]).toMatchObject({ kind: "dihedral", targets: ["E", "B", "C", "D"], value: 45 })
    for (const item of parsed.givens) {
      expect(USER_PROMPT.slice(item.start, item.end)).toBe(item.sourceText)
    }
  })

  /**
   * **"读不懂的条件"与"空成功"必须分得开**（2026-10-10 更新）。
   *
   * 这条用例原先拿 `∠ABC=60°` 当"读不懂"的样本 —— 它现在是**读得懂的**（`planarAngle`，
   * 见下面那条），所以样本换成**真正读不懂**的那一类：`sin∠PAB = 0.5`（三角函数值，
   * 不是角本身）。**意图一字未改**：不管读不读得懂，都不许出现"什么都没读到却算通过"。
   */
  it("does not confuse an unrecognized geometric condition with an empty success", () => {
    const parsed = parseDiagramObligations("在三角形 ABC 中，sin∠ABC=0.5，画出图形")
    expect(parsed.givens).toEqual([])
    expect(parsed.unverified).toEqual([{ sourceText: "sin∠ABC=0.5", reason: expect.any(String) }])
  })

  /**
   * **平面上的数值角现在读得懂**（§3-F，2026-10-10）：`∠ABC=60°` ⇒ `planarAngle` 一条 given，
   * 三个点名原样给出（**中间那个是顶点**）、度数是 `value`；`unverified` 里**不再有它**。
   *
   * 判据里同时钉住"三种退化写法读不出来"：0°、180°、以及三点名重复 —— 句法对但几何退化，
   * 如实留在未核验，而不是当成一个角放行。
   */
  it("reads a planar numeric angle as a judged given, and leaves degenerate ones unverified", () => {
    const parsed = parseDiagramObligations("在三角形 ABC 中，∠ABC=60°，画出图形")
    expect(parsed.givens).toEqual([expect.objectContaining({ kind: "planarAngle", targets: ["A", "B", "C"], value: 60 })])
    expect(parsed.unverified).toEqual([])

    for (const degenerate of ["∠ABC=0°", "∠ABC=180°", "∠ABA=60°"]) {
      const text = `在三角形 ABC 中，${degenerate}，画出图形`
      expect(parseDiagramObligations(text).givens, degenerate).toEqual([])
      expect(parseDiagramObligations(text).unverified.some((item) => item.sourceText.includes(degenerate)), degenerate).toBe(true)
    }
  })

  it("flags unmatched conditions and invalid dimensions rather than dropping them", () => {
    const unsupported = parseDiagramObligations("在△ABC中，AB:AC=2，画出图形")
    expect(unsupported.givens).toEqual([])
    expect(unsupported.unverified.some(({ sourceText }) => sourceText.includes("AB:AC=2"))).toBe(true)

    const impossibleLength = parseDiagramObligations("在△ABC中，AB=0，画出图形")
    expect(impossibleLength.givens).toEqual([])
    expect(impossibleLength.unverified.some(({ sourceText }) => sourceText.includes("AB=0"))).toBe(true)
  })

  /**
   * **三种用户随手就会打的写法**（2026-10-10 现场：四棱锥那句题面）。
   *
   * 它们此前都落进"未核验"，而门禁是"全部核验通过才提交" ⇒ 用户永远拿不到图。
   * 三条各钉一条判据（都不是"图不对"，而是"我们读不懂"）。
   */
  it("reads 「底面」 as the plane word, not only 「平面」", () => {
    const parsed = parseDiagramObligations("在四棱锥 P-ABCD 中，PA⊥底面 ABCD，画出这个四棱锥")

    expect(parsed.unverified).toEqual([])
    expect(parsed.givens.some((given) => given.kind === "perpendicular")).toBe(true)
  })

  it("reads a trailing length on a ratio clause: `AD=2AB=2`", () => {
    const parsed = parseDiagramObligations("在四棱锥 P-ABCD 中，设 AD=2AB=2，画示意图")

    expect(parsed.unverified).toEqual([])
    expect(parsed.givens).toContainEqual(expect.objectContaining({ kind: "segmentRatio", targets: ["A", "D", "A", "B"], value: 2 }))
    expect(parsed.givens).toContainEqual(expect.objectContaining({ kind: "fixedLength", targets: ["A", "D"], value: 2 }))
  })

  it("treats 「（即 …）」 as a restatement, not as an unread condition", () => {
    const parsed = parseDiagramObligations("在四棱锥 P-ABCD 中，设 AD=2AB=2（即 AB=BC=1, AD=2），画出这个四棱锥")

    expect(parsed.unverified).toEqual([])
    // 括号里的等式照旧被认成条件（不是被丢掉）。
    expect(parsed.givens.filter((given) => given.kind === "fixedLength").length).toBeGreaterThanOrEqual(2)
  })
  it("recognizes an explicitly free point as a choice, not an unverified condition", () => {
    const parsed = parseDiagramObligations("在三棱锥A-BCD中，BD=2，任取点A，画一张示意图")
    expect(parsed.givens.map((item) => item.sourceText)).toEqual(["BD=2"])
    expect(parsed.freeChoices).toEqual(["A"])
    expect(parsed.unverified).toEqual([])
  })
  it("surfaces unsupported geometric operators and a missing dihedral unit", () => {
    const parallelPlanes = parseDiagramObligations("在六面体 ABCDEF 中，平面ABC∥平面DEF，画出图形")
    expect(parallelPlanes.givens).toEqual([])
    expect(parallelPlanes.unverified.some((item) => item.sourceText.includes("平面ABC∥平面DEF"))).toBe(true)

    const missingUnit = parseDiagramObligations("在三棱锥 A-BCD 中，二面角E-BC-D=45，画出图形")
    expect(missingUnit.givens).toEqual([])
    expect(missingUnit.unverified.some((item) => item.sourceText.includes("二面角E-BC-D=45"))).toBe(true)
  })
  it("**带空格的条件也要整句引用** —— 这串文字会**原样显示给用户**（`diagramVerification` 把 residue 的 sourceText 直接当 check 文案）", () => {
    /**
     * 修前这里是 `["∠PAB"]`：**值被截掉**。样本换成"仍然读不懂"的那一类（`sin∠PAB = 0.5`）——
     * `∠PAB = 60°`（带空格）现在**整条读得懂**了（`planarAngle`），于是它根本不会出现在 residue 里，
     * 拿它当样本就测不到"整句引用"这件事了。
     */
    const parsed = parseDiagramObligations("在四棱锥 P-ABCD 中，sin∠PAB = 0.5")

    expect(parsed.unverified.map((item) => item.sourceText)).toEqual(["sin∠PAB = 0.5"])
  })

  it("同一类写法，**带不带空格都要拿到整条**（既有用例只覆盖了不带空格那位 —— 缺陷正好藏在另一侧）", () => {
    // `∠ABC=60°` 那一支现在是 given（读得懂），所以这一组只留"仍然读不懂"的两种形状。
    for (const prompt of ["在四棱锥 P-ABCD 中，sin∠PAB = 0.5", "在四棱锥 P-ABCD 中，AB:AD = 1:2"]) {
      const text = parseDiagramObligations(prompt).unverified[0]?.sourceText ?? ""

      // 每条都是"某个量 = 某个值"的形状：整句引用必然含 `=`，碎片则不会。
      expect(text, prompt).toContain("=")
    }
  })
  it("does not accept a prefix of an unsupported algebraic value as an exact given", () => {
    for (const expression of ["AB=1/2", "AB=2√3", "AB=AD+1", "DE=2EA/3"]) {
      const parsed = parseDiagramObligations(`在四棱锥P-ABCD中，${expression}，画示意图`)
      expect(parsed.givens, expression).toEqual([])
      expect(parsed.unverified.some((item) => item.sourceText.includes(expression)), expression).toBe(true)
    }
  })
  it("never drops the legacy equal-length spelling when the plan omits names", () => {
    const parsed = parseDiagramObligations("在四棱锥P-ABCD中，BC与AD等长，画示意图")
    expect(parsed.givens.length + parsed.unverified.length).toBeGreaterThan(0)
    expect([...parsed.givens.map((item) => item.sourceText), ...parsed.unverified.map((item) => item.sourceText)]).toContain("BC与AD等长")
  })
  it("surfaces common point-plane and collinearity language that has no supported judge yet", () => {
    for (const sentence of ["点A在平面BCD内", "A、B、C三点共线"]) {
      const parsed = parseDiagramObligations(`在四棱锥P-ABCD中，${sentence}，画示意图`)
      expect(parsed.givens.length + parsed.unverified.length, sentence).toBeGreaterThan(0)
    }
  })
  it("surfaces a bare 相等 phrasing that has no supported judge (由 benchmark 查出的，2026-10-05)", () => {
    // 原话来自 `scripts/agent-benchmark` 的 dynamic-request 用例。修前它**一个子句都没留下**：
    // 既没有给定义、也没有 residue —— 而这句话里明明有一个几何条件词（"相等"）。
    // 这与本文件上面那条纪律冲突：**新写法必须显形，不许把非空题面静默变成空通过**。
    const parsed = parseDiagramObligations("拖动这个正四面体的一个顶点，保持六条棱长始终相等")

    expect(parsed.givens.length + parsed.unverified.length).toBeGreaterThan(0)
    expect(parsed.unverified.some((item) => item.sourceText.includes("相等"))).toBe(true)
  })
  it("keeps ordinary explanations outside geometric condition coverage", () => {
    const parsed = parseDiagramObligations("比如画一张四棱锥 P-ABCD 的示意图")
    expect(parsed.givens).toEqual([])
    expect(parsed.unverified).toEqual([])
  })

  it("reads existing line-plane relations and leaves unrecognized targets visible", () => {
    const parsed = parseDiagramObligations("在四棱锥 P-ABCD 中，PA垂直平面ABCD，BC∥AD，画出示意图")
    expect(parsed.givens.map(({ kind }) => kind)).toEqual(["perpendicular", "parallel"])
    expect(parsed.unverified).toEqual([])
  })
})


describe("V0a experimental spatial point conditions", () => {
  it("reads explicitly named 3D coordinates with original spans rather than guessing from a model plan", () => {
    const prompt = "在三棱锥D-ABC中，A=(0,0,0)，B=(3,0,0)，C=(1,2,0)，AD⊥平面ABC，画示意图"
    const result = parseDiagramObligations(prompt, { spatialPointConditions: true })
    const coordinates = result.givens.filter((item) => item.kind === "pointCoordinate")
    expect(coordinates.map((item) => [item.targets, item.coordinate])).toEqual([
      [["A"], { x: 0, y: 0, z: 0 }], [["B"], { x: 3, y: 0, z: 0 }], [["C"], { x: 1, y: 2, z: 0 }]
    ])
    expect(coordinates.map((item) => prompt.slice(item.start, item.end))).toEqual(["A=(0,0,0)", "B=(3,0,0)", "C=(1,2,0)"])
    expect(result.unverified).toEqual([])
  })

  it("exposes an above-the-base condition until an oriented half-space judge is available", () => {
    const parsed = parseDiagramObligations("在三棱锥D-ABC中，AD⊥平面ABC，D在底面ABC上方，画示意图", { spatialPointConditions: true })
    expect(parsed.givens.map((item) => item.kind)).toContain("perpendicular")
    expect(parsed.unverified.some((item) => item.sourceText.includes("D在底面ABC上方"))).toBe(true)
  })

  it("exposes an unrecognized no-equals coordinate spelling instead of treating it as decoration", () => {
    const parsed = parseDiagramObligations("在三棱锥D-ABC中，A(0,0,0)，AD⊥平面ABC，画示意图", { spatialPointConditions: true })
    expect(parsed.unverified.some((item) => item.sourceText.includes("A(0,0,0)"))).toBe(true)
  })

  it("keeps the opt-out path unchanged and recognises an explicitly free apex", () => {
    const prompt = "在三棱锥D-ABC中，AD⊥平面ABC，自由点D，画示意图"
    expect(parseDiagramObligations(prompt, { spatialPointConditions: false })).toEqual(parseDiagramObligations(prompt))
    const parsed = parseDiagramObligations(prompt, { spatialPointConditions: true })
    expect(parsed.givens.map((item) => item.sourceText)).toEqual(["AD⊥平面ABC"])
    expect(parsed.freeChoices).toEqual(["D"])
    expect(parsed.unverified).toEqual([])
  })
})

/**
 * **带撇 / 带下标点名**（S1 接缝先行）。
 *
 * 实测（设计 §1.1）：`在三棱柱ABCD-A₁B₁C₁D₁中，AA₁⊥平面ABCD` 在 `AA₁` / `AA1` / `AA′`
 * 三种写法下都产出 **0 条给定**，只能作为 `unverified` 残留显形。机制是两处各写了一份点名判断：
 * 规则里写死了 `[A-Z]{2}` / `[A-Z]{3,4}`，而 `names()` 又按**码位**拆字（`A′` → `A` + `′`）。
 * 两处现在都从内核的 `pointNames` 取同一份定义。
 */
describe("带撇与带下标的点名", () => {
  it("下标写法能读出线面垂直，且下游按**点名个数**切得出平面", () => {
    const parsed = parseDiagramObligations("在三棱柱ABCD-A₁B₁C₁D₁中，AA₁⊥平面ABCD")
    expect(parsed.givens.map((item) => item.kind)).toEqual(["perpendicular"])
    expect(parsed.givens[0]!.sourceText).toBe("AA₁⊥平面ABCD")
    expect(parsed.givens[0]!.targets).toEqual(["A", "A₁", "A", "B", "C", "D"])
    /**
     * 下游（`witnessSearch.lineAndPlane`）按**点名个数**把 targets 切成"线段 + 平面"：
     * 前两个是线段端点、后三个或四个是平面。带下标时**字串长度**会骗人（`A₁B₁C₁D₁` 长 8），
     * 点名个数不会 —— 所以这里钉的是"后四个正好是平面"这条性质。
     *
     * 注意：`planeLengths` 是 `平面X⊥平面Y` 才有的字段，线面垂直**不带**它（那是既有契约，
     * 下游按长度还原切点；见 `witnessSearch.lineAndPlane` 的文件内注释）。
     */
    expect(parsed.givens[0]!.targets.slice(2)).toEqual(["A", "B", "C", "D"])
    expect(parsed.unverified.filter((item) => item.sourceText.includes("AA₁"))).toEqual([])
  })

  it("撇写法同样读得出；平面⊥平面的长度按**点名个数**算而不是字串长度", () => {
    const parsed = parseDiagramObligations("在正方体中，平面A₁B₁C₁D₁⊥平面ABCD")
    expect(parsed.givens.map((item) => item.kind)).toEqual(["planePerpendicular"])
    expect(parsed.givens[0]!.targets).toEqual(["A₁", "B₁", "C₁", "D₁", "A", "B", "C", "D"])
    // 4 与 4 —— 按**字串长度**算会得到 8 与 4，而那会让下游把平面切错。
    expect(parsed.givens[0]!.planeLengths).toEqual([4, 4])
  })

  it("ASCII 下标不是本仓写法：不许被凑合成给定，必须如实报未核验", () => {
    const parsed = parseDiagramObligations("在三棱柱ABCD-A1B1C1D1中，AA1⊥平面ABCD")
    expect(parsed.givens).toEqual([])
    expect(parsed.unverified.some((item) => item.sourceText.includes("AA1"))).toBe(true)
  })

  /**
   * **撇这一支单独钉一条**（2026-10-07 补：块级变异发现的覆盖缺口）。
   *
   * 下面这条是被变异逼出来的：把共享词表里的**撇**去掉（只留下标）时，
   * 内核、核验器与词表自身都有用例变红，**只有解析层全绿** —— 说明"解析器认撇"
   * 此前没有任何用例真的咬住过。补上它，三层的覆盖才是对称的。
   */
  it("撇写法在解析层也单独成立（与下标写法各有一条）", () => {
    const parsed = parseDiagramObligations("在三棱柱ABCD-A′B′C′D′中，AA′⊥平面ABCD")
    expect(parsed.givens.map((item) => item.kind)).toEqual(["perpendicular"])
    expect(parsed.givens[0]!.sourceText).toBe("AA′⊥平面ABCD")
    expect(parsed.givens[0]!.targets).toEqual(["A", "A′", "A", "B", "C", "D"])
    expect(parsed.unverified.filter((item) => item.sourceText.includes("AA′"))).toEqual([])
  })

  /**
   * **「底面 ABCD 是菱形」（S3）**：菱形就是"四条边两两相等"。
   *
   * 判据**不新造**：拆成三条**已有的** `equalLength`（`AB=BC` / `BC=CD` / `CD=DA`，链起来覆盖四条边），
   * 交给既有唯一判据（`diagramVerification` 的 `equalLength` 分支）逐条核验 —— 与题面直接写
   * `AB=BC=CD=DA` 走**同一套**数学。这样"菱形"既不是别名，也不是一句自证。
   */
  it("底面 ABCD 是菱形 ⇒ 三条 equalLength（链起来覆盖四条边）", () => {
    const parsed = parseDiagramObligations("在四棱柱ABCD-A′B′C′D′中，底面ABCD是菱形，AA′⊥平面ABCD，画出这个四棱柱")

    const equal = parsed.givens.filter((item) => item.kind === "equalLength").map((item) => item.targets.join(""))
    expect(equal).toEqual(["ABBC", "BCCD", "CDDA"])
    expect(parsed.givens.map((item) => item.kind)).toEqual(["equalLength", "equalLength", "equalLength", "perpendicular"])
    expect(parsed.unverified).toEqual([])
  })

  it("菱形从句里的环不是四边形（五边形）⇒ 读不出，且**显形为 unverified**", () => {
    const parsed = parseDiagramObligations("在五棱锥 P-ABCDE 中，底面ABCDE是菱形")

    expect(parsed.givens.filter((item) => item.kind === "equalLength")).toEqual([])
    expect(parsed.unverified.some((item) => item.sourceText.includes("菱形"))).toBe(true)
  })
})
