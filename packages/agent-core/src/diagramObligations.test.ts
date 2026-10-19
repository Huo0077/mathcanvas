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

  /**
   * **根号数字**（2026-10-11 用户现场）。
   *
   * `AD=5√3` 今天读不出来：长度句型匹配到 `AD=5` 之后，紧跟的 `√` 命中那道
   * 「这个数字后面还跟着东西」的守卫（`diagramObligations.ts` 里那个含 `√`、`°`、`π` 的字符类），
   * **整条匹配被丢弃** ⇒ 这句落进残留、变成一条"未核验的条件" ⇒ 门禁不放行
   *（`题设尚未核验，本次不会提交`）。
   *
   * 缺的不是那道守卫（它拦得对：`AD=5√3` 不是"AD 等于 5"），是**根号数字**本身。
   */
  it("reads a length written with a radical instead of leaving the clause unverified", () => {
    const parsed = parseDiagramObligations("AB=8，AD=5√3")
    expect(parsed.givens.map(({ kind, sourceText }) => [kind, sourceText])).toEqual([
      ["fixedLength", "AB=8"],
      ["fixedLength", "AD=5√3"]
    ])
    const radical = parsed.givens[1] as { targets: string[]; value: number }
    expect(radical.targets).toEqual(["A", "D"])
    expect(radical.value).toBeCloseTo(5 * Math.sqrt(3), 12)
    expect(parsed.unverified).toEqual([])
  })

  it("reads a bare radical as well", () => {
    const parsed = parseDiagramObligations("AD=√3")
    const given = parsed.givens[0] as { kind: string; targets: string[]; value: number }
    expect(given.kind).toBe("fixedLength")
    expect(given.targets).toEqual(["A", "D"])
    expect(given.value).toBeCloseTo(Math.sqrt(3), 12)
    expect(parsed.unverified).toEqual([])
  })

  /**
   * **冒号比例**（2026-10-11 用户现场）：`点E在AD上，且AE:AD=2:5`。
   *
   * 残留扫描器（`UNREAD_CONDITION`）**早就把 `AE:AD=2` 这种形状当条件看**，只是没有读取器
   * 接它 —— 于是它必然变成一条"未核验的条件"。判据形状沿用已有的 `segmentRatio`：
   * 四个点名 = 两条线段，值 = 前比后（与 `AD=2AB` 判 `|AD|/|AB|` 同一条约定）。
   */
  it("reads a colon ratio between two segments", () => {
    const parsed = parseDiagramObligations("AE:AD=2:5")
    const given = parsed.givens[0] as { kind: string; targets: string[]; value: number }
    expect(given.kind).toBe("segmentRatio")
    expect(given.targets).toEqual(["A", "E", "A", "D"])
    expect(given.value).toBeCloseTo(2 / 5, 12)
    expect(parsed.unverified).toEqual([])
  })

  it("reads both radicals and both colon ratios from the real user sentence", () => {
    const prompt = [
      "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。",
      "点E在AD上，且AE:AD=2:5；",
      "点F在AB上，且AF:AB=1:2。",
      "将三角形AEF沿EF翻折至三角形PEF，使得PC=4√3。"
    ].join("")
    const parsed = parseDiagramObligations(prompt)
    expect(parsed.givens.map(({ sourceText }) => sourceText)).toEqual([
      "AB=8", "AD=5√3", "∠BAD=30°", "∠ADC=90°", "CD=3", "AE:AD=2:5", "AF:AB=1:2", "PC=4√3"
    ])
    // **这一句是整条链的关口**：只要还有一条读不懂，门禁就会把整轮拦下。
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
    /**
     * 样本必须选"**仍然读不懂**"的形状：这一条测的是 residue 的整句引用。
     *
     * **2026-10-11 改**：第二个样本原先是 `AB:AD = 1:2`，它现在**读得懂了**
     *（冒号比例的读取器，见下方那条用例）⇒ 它不再进 residue，拿它当样本就测不到这件事。
     * 换成同样带空格的 `AB:AD = 1:2:3`：**三段比没有判据**（`segmentRatio` 是两条线段之比），
     * 如实读不懂 —— 而且它必须整条留下，不许被半吃成 `AB:AD = 1:2`。
     */
    for (const prompt of ["在四棱锥 P-ABCD 中，sin∠PAB = 0.5", "在四棱锥 P-ABCD 中，AB:AD = 1:2:3"]) {
      const text = parseDiagramObligations(prompt).unverified[0]?.sourceText ?? ""

      // 每条都是"某个量 = 某个值"的形状：整句引用必然含 `=`，碎片则不会。
      expect(text, prompt).toContain("=")
    }
  })
  it("does not accept a prefix of an unsupported algebraic value as an exact given", () => {
    /**
     * **2026-10-11 改**：样本里的 `AB=2√3` 改了归属 —— 根号是**支持**的写法
     *（见「reads a length written with a radical」那条），它整条读得懂，不再属于"不支持"这一组。
     *
     * 这一条要守的一直是"**不支持**的代数式不许被读成它的前缀"（`AB=1/2` 不许读成 `AB=1`）。
     * 根号那一位现在守的是同一件事的另一半：`AB=2√3` 必须读成 `2√3`，**不许**读成 `2`。
     */
    for (const expression of ["AB=1/2", "AB=AD+1", "DE=2EA/3"]) {
      const parsed = parseDiagramObligations(`在四棱锥P-ABCD中，${expression}，画示意图`)
      expect(parsed.givens, expression).toEqual([])
      expect(parsed.unverified.some((item) => item.sourceText.includes(expression)), expression).toBe(true)
    }
    // 根号那一位：读的是**整个** `2√3`，不是它的前缀 `2`。
    const radical = parseDiagramObligations("在四棱锥P-ABCD中，AB=2√3，画示意图")
    expect(radical.givens).toHaveLength(1)
    expect((radical.givens[0] as { value: number }).value).toBeCloseTo(2 * Math.sqrt(3), 12)
    expect(radical.unverified).toEqual([])
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

/**
 * **Task 14：直线与圆锥曲线的交点义务**（`conicChord`）。
 *
 * 这一组里最要紧的一条是「**不会吃掉曲线那条义务**」：解析器按**字符占位**去重，
 * 新匹配器只要把曲线方程也圈进自己的匹配范围，`conicAxes` 那条就会被整条吞掉 ——
 * 症状是"圆锥曲线的半轴/轴突然不再核验了"，而且只在带直线的那种题面上出现。
 */
describe("Task 14：直线与圆锥曲线的交点义务", () => {
  const chordOf = (prompt: string) => parseDiagramObligations(prompt).givens.find((item) => item.kind === "conicChord")

  it("斜截式 + 「相交于 A、B 两点」，且曲线那条义务**并存**", () => {
    const parsed = parseDiagramObligations("椭圆 x²/9+y²/4=1 与直线 y=x+1 相交于 A、B 两点")
    const chord = parsed.givens.find((item) => item.kind === "conicChord")
    expect(chord?.line).toEqual({ kind: "slope", slope: 1, intercept: 1 })
    expect(chord?.expectation).toBe("secant")
    expect(chord?.targets).toEqual(["A", "B"])
    expect(parsed.givens.some((item) => item.kind === "conicAxes")).toBe(true)
  })

  it("`y = x` 的斜率是 1、`y = −x` 是 −1（省略系数与只写符号都不能读成 0）", () => {
    expect(chordOf("椭圆 x²/9+y²/4=1 与直线 y=x 相交于 A、B 两点")?.line).toEqual({ kind: "slope", slope: 1, intercept: 0 })
    expect(chordOf("椭圆 x²/9+y²/4=1 与直线 y=-x 相交于 A、B 两点")?.line).toEqual({ kind: "slope", slope: -1, intercept: 0 })
  })

  it("水平线 `y = 2` 不会被斜截式那条读成 `y = 2x`", () => {
    expect(chordOf("椭圆 x²/9+y²/4=1 与直线 y=2 相切")?.line).toEqual({ kind: "slope", slope: 0, intercept: 2 })
  })

  it("竖直线 `x = 3` 单独成支（斜截式表达不了它）", () => {
    const chord = chordOf("双曲线 x²/9−y²/4=1 与直线 x=3 相切")
    expect(chord?.line).toEqual({ kind: "vertical", x: 3 })
    expect(chord?.expectation).toBe("tangent")
    expect(chord?.targets).toEqual([])
  })

  /**
   * **直线的一般式**（2026-10-19 联考 `joint-21`：`直线l：3x+4y+15=0`）。
   *
   * 卷面上"一般式"和斜截式一样常见，而读取器此前只收斜截式与竖直线。换成
   * `Ax + By + C = 0` ⇒ 斜率 `−A/B`、截距 `−C/B`；`B = 0` 时它就是竖直线。
   * **右端不是 0 不认**：`3x+4y+15=1` 是另一条直线，但写成一般式以外的形态，猜不得。
   */
  it("`直线l：3x+4y+15=0` ⇒ 斜率 −3/4、截距 −15/4", () => {
    const chord = chordOf("椭圆 x²/9+y²/4=1 与直线l：3x+4y+15=0 相交于 A、B 两点")
    expect(chord?.line).toEqual({ kind: "slope", slope: -3 / 4, intercept: -15 / 4 })
    expect(chord?.expectation).toBe("secant")
    expect(chord?.targets).toEqual(["A", "B"])
  })

  it("一般式右端**不是 0** ⇒ 不认（不猜）", () => {
    expect(chordOf("椭圆 x²/9+y²/4=1 与直线 3x+4y+15=1 相交于 A、B 两点")).toBeUndefined()
  })

  /**
   * **直线写在曲线前面**（`joint-21` 的另一半）。
   *
   * 此前的匹配器要求"直线 + 情形"紧挨着，所以 `直线 … 与椭圆 … 相交于 A、B` 走不到。
   * 这一批让"直线"与"情形"之间可以夹一个**带曲线名的从句**；曲线名必须真的出现在那里，
   * 所以 `直线 y=x 与三角形 ABC 相交于 P、Q` 不会被读成"与圆锥曲线相交"。
   */
  it("**直线在先**：`直线 3x+4y+15=0 与椭圆 … 相交于 A、B` 也读得出", () => {
    const parsed = parseDiagramObligations("直线 3x+4y+15=0 与椭圆 x²/9+y²/4=1 相交于 A、B 两点")
    const chord = parsed.givens.find((item) => item.kind === "conicChord")
    expect(chord?.line).toEqual({ kind: "slope", slope: -3 / 4, intercept: -15 / 4 })
    expect(chord?.expectation).toBe("secant")
    expect(chord?.targets).toEqual(["A", "B"])
    // 曲线那条义务**照样并存**：桥接的那一段允许重叠，但不能把方程那条吃掉。
    expect(parsed.givens.some((item) => item.kind === "conicAxes")).toBe(true)
  })

  it("斜截式写在前面同样收：`直线 y=x+1 与椭圆 … 相切`", () => {
    const chord = chordOf("直线 y=x+1 与椭圆 x²/9+y²/4=1 相切")
    expect(chord?.line).toEqual({ kind: "slope", slope: 1, intercept: 1 })
    expect(chord?.expectation).toBe("tangent")
  })

  it("**与三角形相交不算**：桥接那段必须带曲线名", () => {
    expect(chordOf("直线 y=x 与三角形 ABC 相交于 P、Q 两点")).toBeUndefined()
  })

  it("「没有交点」也读得出来", () => {
    expect(chordOf("椭圆 x²/9+y²/4=1 与直线 y=3 没有交点")?.expectation).toBe("none")
  })

  it("直线写在曲线前面**现在能读**（旧断言是「不猜」，2026-10-20 起由「必须带曲线名的桥」取代）", () => {
    const parsed = parseDiagramObligations("直线 y=x+1 与椭圆 x²/9+y²/4=1 相交于 A、B 两点")
    const chord = parsed.givens.find((item) => item.kind === "conicChord")
    expect(chord?.line).toEqual({ kind: "slope", slope: 1, intercept: 1 })
    expect(chord?.targets).toEqual(["A", "B"])
    // 曲线那条照样读得出来：桥接允许重叠，但没有把方程那条吃掉。
    expect(parsed.givens.some((item) => item.kind === "conicAxes")).toBe(true)
  })
})

/**
 * **命名圆锥曲线：`椭圆C：…` 这种带标签的写法**（2026-10-19 联考评测的最大一类未核验）。
 *
 * 现场读数：30 道联考新卷里 **8 次**报"这条曲线方程没有被归入本仓支持的三类标准圆锥曲线"，
 * 而其中一部分**方程本身完全标准**，只是前面多了一个曲线名 + 标签 + 全角冒号
 *（`椭圆C：x²/16+y²/4=1`、`抛物线C：y²=4x`）。根因是 `parseDiagramObligations` 里那条
 * "后缀守卫"（防止把 `∠ABC=60°` 的后缀当成 `BC=60`）连**标签冒号**也一起挡了。
 *
 * 判据两条、方向相反：
 * - 标签冒号后面的标准方程**必须读得出**（否则图都画了、读数停在"未核验"）；
 * - 比例写法 `AE:AD=2:5` 里的 `AD=2` **仍然不许**被当成一条长度（守卫不能整体拆掉）。
 */
describe("命名圆锥曲线：标签冒号不该把方程挡在外面", () => {
  const conicOf = (prompt: string) => parseDiagramObligations(prompt).givens.find((item) => item.kind === "conicAxes")?.conic

  it("`椭圆C：x²/16+y²/4=1` ⇒ 半轴 4 / 2", () => {
    expect(conicOf("椭圆C：x²/16+y²/4=1")).toEqual({ kind: "ellipse", radiusX: 4, radiusY: 2 })
  })

  it("`抛物线C：y²=4x` ⇒ 焦点参数 2、轴沿 x", () => {
    expect(conicOf("抛物线C：y²=4x")).toEqual({ kind: "parabola", focalParameter: 2, axis: "x" })
  })

  it("`双曲线C：x²/4−y²/9=1` ⇒ 半轴 2 / 3、实轴沿 x", () => {
    expect(conicOf("双曲线C：x²/4−y²/9=1")).toEqual({ kind: "hyperbola", radiusX: 2, radiusY: 3, axis: "x" })
  })

  it("**比例冒号不受影响**：`AE:AD=2:5` 仍不许被读成一条长度", () => {
    const parsed = parseDiagramObligations("点E在AD上，且AE:AD=2:5")
    expect(parsed.givens.some((item) => item.kind === "fixedLength")).toBe(false)
  })

  /**
   * **函数式写法的抛物线**：`y=x²/4`（2026-10-19 联考 `joint-28`）。
   *
   * 标准式是 `x² = 2py`，题面却常写成 `y = x²/4` —— 同一条曲线，只是把 y 解出来了。
   * `y = x²/4` ⇔ `x² = 4y` ⇒ `2p = 4` ⇒ `p = 2`；`y = 2x²` ⇔ `x² = y/2` ⇒ `2p = 0.5`。
   * **只收"顶点在原点、对称轴是坐标轴"的那一类**：`y = x²/4 + 1` 是被平移过的抛物线，
   * 它的焦点与准线都变了，不能按标准式核验 —— 那种一律不认，留在未核验。
   */
  it("`曲线 y=x²/4` ⇒ 抛物线 `p=2`、轴沿 y", () => {
    expect(conicOf("曲线 y=x²/4")).toEqual({ kind: "parabola", focalParameter: 2, axis: "y" })
  })

  it("`y = x^2/4`（脱字符写法）同样读得出", () => {
    expect(conicOf("已知 y = x^2/4")).toEqual({ kind: "parabola", focalParameter: 2, axis: "y" })
  })

  it("`y = 2x²` ⇒ `x² = y/2` ⇒ `p=0.25`", () => {
    expect(conicOf("曲线 y = 2x²")).toEqual({ kind: "parabola", focalParameter: 0.25, axis: "y" })
  })

  it("`x = y²/4` ⇒ 抛物线 `p=2`、轴沿 x", () => {
    expect(conicOf("曲线 x = y²/4")).toEqual({ kind: "parabola", focalParameter: 2, axis: "x" })
  })

  it("**被平移过的抛物线不收**：`y = x²/4 + 1` 与 `y = x²/4 − 1` 都不许按标准式读", () => {
    expect(conicOf("曲线 y = x²/4 + 1")).toBeUndefined()
    expect(conicOf("曲线 y = x²/4 − 1")).toBeUndefined()
  })

  /**
   * **圆的一般方程**：`圆M：x²+y²−4x+2y−4=0`（2026-10-19 联考 `joint-27`）。
   *
   * 圆不在"三类标准圆锥曲线"里 —— 它需要**圆心**，而椭圆/双曲线/抛物线那三档假定
   * 曲线以原点为中心。`x²+y²+Dx+Ey+F=0` ⇒ 圆心 `(−D/2, −E/2)`、半径 `√((D²+E²)/4 − F)`。
   * 半径平方不为正就不是圆（一个点或虚圆），一律不认。
   */
  it("`圆M：x²+y²−4x+2y−4=0` ⇒ 圆心 (2, −1)、半径 3", () => {
    expect(conicOf("圆M：x²+y²−4x+2y−4=0")).toEqual({ kind: "circle", centerX: 2, centerY: -1, radius: 3 })
  })

  it("`圆 x²+y²=4` ⇒ 圆心在原点、半径 2", () => {
    expect(conicOf("圆 x²+y²=4")).toEqual({ kind: "circle", centerX: 0, centerY: 0, radius: 2 })
  })

  it("**半径平方不为正的不认**：`x²+y²+2x+2y+8=0` 不是圆（虚圆）", () => {
    expect(conicOf("圆 x²+y²+2x+2y+8=0")).toBeUndefined()
  })

  /**
   * **"曲线过点"**（2026-10-19 联考 `joint-30`：`双曲线过点 A、B`）。
   *
   * 这不是曲线**方程**的写法问题，而是一条**条件**：那两个点必须落在这条曲线上。
   * 判据层已经有"点到圆锥曲线的残差"（`pointOnConic`），所以这里只需要一个读取器 ——
   * 每个点名各读成一条 `pointOnConic`（判据只处理一个点，一条义务对一个点最干净）。
   */
  it("`椭圆过点 P、Q` ⇒ 两条 pointOnConic（各一个点名、曲线种类是椭圆）", () => {
    const parsed = parseDiagramObligations("椭圆过点 P、Q")
    const onConic = parsed.givens.filter((given) => given.kind === "pointOnConic")
    expect(onConic.map((given) => [given.targets, given.conicKind])).toEqual([
      [["P"], "ellipse"],
      [["Q"], "ellipse"]
    ])
  })

  it("`双曲线经过点 A 和 B` 同样读得出；`直线过点 A` **不**读成曲线条件（主语不是曲线）", () => {
    const hyperbola = parseDiagramObligations("双曲线经过点 A 和 B")
    expect(hyperbola.givens.filter((given) => given.kind === "pointOnConic").map((given) => given.targets)).toEqual([["A"], ["B"]])

    const line = parseDiagramObligations("过点 A 作直线 l")
    expect(line.givens.some((given) => given.kind === "pointOnConic")).toBe(false)
  })

  it("曲线名与「过」之间夹着**方程**也读得出；但没有等号的那半句不读（防误读）", () => {
    // 方程夹在中间：`椭圆 x²/9+y²/4=1 过点 P、Q`
    const withEquation = parseDiagramObligations("椭圆 x²/9+y²/4=1 过点 P、Q")
    expect(withEquation.givens.filter((given) => given.kind === "pointOnConic").map((given) => given.targets)).toEqual([["P"], ["Q"]])

    // 同一句里"椭圆内有一点 P"与"过点 P 作直线"是**两件事**，不能读成"P 在椭圆上"。
    const notOnCurve = parseDiagramObligations("椭圆内有一点 P，过点 P 作直线 l")
    expect(notOnCurve.givens.some((given) => given.kind === "pointOnConic")).toBe(false)
  })
})

/**
 * **非标准曲线的「明确不归类」**（Task 14 的边界，2026-10-14 收口）。
 *
 * 调研 §C 原文：`2024 新课标Ⅰ卷第 11 题`是**非标准曲线**，"暂记范围外/跨家族候选，
 * **不伪装成椭圆/双曲线/抛物线**"。而今天的实情是：这类方程落进**通用**的未核验文案
 *（"这个条件没有被可靠解析或数值非法"）—— 那句话把**范围外**说成了**没写清楚**：
 * 用户会以为换个写法就能被认出来，然后一遍遍改题面。
 *
 * 判据两条、方向相反：
 * - 曲线方程（**小写** `x` / `y` 的平方项）⇒ 明说"没有归入三类标准圆锥曲线"，记**明确不归类**；
 * - `AB²=4` 这类**点名线段的平方**（大写字母）⇒ 照旧是通用文案。少了这条反向判据，
 *   贴上"非标准曲线"标签就是**过度解释**，那比不解释更糟。
 */
describe("非标准曲线：明确不归类（不是「没写清楚」）", () => {
  const reasonOf = (prompt: string, needle: string): string => parseDiagramObligations(prompt).unverified.find((item) => item.sourceText.includes(needle))?.reason ?? ""

  it("`x²+xy+y²=1` 这类方程：明说是范围外，不许只说「没被可靠解析」", () => {
    const reason = reasonOf("平面直角坐标系中，曲线 x²+xy+y²=1，画出这条曲线", "x²+xy+y²=1")
    expect(reason, reason).toContain("明确不归类")
    expect(reason, reason).toContain("椭圆")
    expect(reason, reason).not.toContain("没有被可靠解析")
  })

  it("点名的线段平方 `AB²=4` **不**贴「非标准曲线」标签（那是过度解释）", () => {
    const reason = reasonOf("在三角形ABC中，AB²=4，画出三角形ABC", "AB²=4")
    expect(reason, reason).toBe("原题出现了尚未被可靠解析的几何条件，未核验。")
  })
})

/**
 * **线面角：`AA′与底面所成角为45°`**（Task 13 的边界「斜棱柱明说倾角」，2026-10-14）。
 *
 * 此前解析器里**没有"所成角"的读取器**，于是这句话既进不了 `relations`、也改不动
 * `lateralTiltDegrees` —— 题面写 45° 还是 60°，搜索层取的都是同一个**代表值**，
 * 而图上那条侧棱与底面实际成 30°（60° 是**与法向**的夹角）。那是"题面明说的条件等于没发生"。
 *
 * 两条要点：
 * - **"底面"要能解析出来**：那句话里写的是"底面"，不是点名列 —— 底环由**形状从句**
 *   （`在斜三棱柱ABC-A′B′C′中`）给出，而形状从句的解析只有一处（`parseShapeClause`），
 *   所以这里读出来的就是那一处的结果，不另写一套"哪几个点是底面"；
 * - **认不出就如实落未核验**：没有形状从句 ⇒ 没有底环 ⇒ 读不出来（不猜一个平面）。
 */
describe("线面角（斜棱柱的明说倾角）", () => {
  const angleOf = (prompt: string) => parseDiagramObligations(prompt).givens.find((item) => item.kind === "linePlaneAngle")

  it("`AA′与底面所成角为45°` ⇒ 线段两个点名 + **底环三个点名**（来自形状从句）", () => {
    const angle = angleOf("在斜三棱柱ABC-A′B′C′中，AB=2，AA′与底面所成角为45°，画出这个斜三棱柱")
    expect(angle?.targets).toEqual(["A", "A′", "A", "B", "C"])
    expect(angle?.value).toBe(45)
    // 与 `planePerpendicular` 同一条约定：前两个是线段、其余是平面。
    expect(angle?.planeLengths).toEqual([2, 3])
  })

  it("`AA′与平面ABC所成角为60°` 也认（平面点名直接写出来的那一半）", () => {
    const angle = angleOf("在斜三棱柱ABC-A′B′C′中，AA′与平面ABC所成角为60°")
    expect(angle?.targets).toEqual(["A", "A′", "A", "B", "C"])
    expect(angle?.value).toBe(60)
  })

  it("写 `0°` / `90°` ⇒ 读不出来（前者不是角，后者侧棱躺进底面）", () => {
    expect(angleOf("在斜三棱柱ABC-A′B′C′中，AA′与底面所成角为0°")).toBeUndefined()
    expect(angleOf("在斜三棱柱ABC-A′B′C′中，AA′与底面所成角为90°")).toBeUndefined()
  })

  it("**没有形状从句 ⇒ 没有底环 ⇒ 不猜**：如实落进未核验", () => {
    const parsed = parseDiagramObligations("在斜三棱柱中，AA′与底面所成角为45°，画出这个斜三棱柱")
    expect(parsed.givens.some((item) => item.kind === "linePlaneAngle")).toBe(false)
    expect(parsed.unverified.some((item) => item.sourceText.includes("所成角"))).toBe(true)
  })
})

/**
 * **`∠A` 单字母角**（Task 11 的边界，2026-10-14）。
 *
 * 边界原文逐字：「`∠A` 单字母角不认」。三条读取器都要三个点名（`∠ABC`），而卷面上
 * `∠A=60°` 更常见 —— 它只给了一个点名，**两条边是哪两条**要看**形状从句的环**
 *（`平面三角形ABC中` ⇒ 顶点 `A` 的邻点是 `C` 与 `B`）。所以这一档的修法与"底面"那条同形：
 * 读取器先留占位，整句解析完**再问形状从句**（环的解析只有 `parseShapeClause` 一处）；
 * 问不出来就**如实落未核验**（不猜两条边）。
 *
 * 判据与构造**一个字都不改**：落成 `[前一个点名, 顶点, 后一个点名]` 之后走的就是既有的
 * `planarAngle`（核验器量内部角、内核 `deriveAngledTriangleBase` 构造）。
 */
describe("单字母角：靠形状从句把两条边定出来", () => {
  const angleOf = (prompt: string) => parseDiagramObligations(prompt).givens.find((item) => item.kind === "planarAngle")

  it("`平面三角形ABC中，AB=8，∠A=60°` ⇒ 落成 `[C, A, B]`（中间是顶点）", () => {
    const angle = angleOf("平面三角形ABC中，AB=8，∠A=60°")
    expect(angle?.targets).toEqual(["C", "A", "B"])
    expect(angle?.value).toBe(60)
  })

  it("四边形按同一套取邻点：`平面四边形ABCD中，AB=2，∠B=90°` ⇒ `[A, B, C]`（环上第二位）", () => {
    expect(angleOf("平面四边形ABCD中，AB=2，∠B=90°")?.targets).toEqual(["A", "B", "C"])
  })

  it("三个点名的写法照旧走前面那条读取器（不被单字母那条半吃）", () => {
    expect(angleOf("平面三角形ABC中，∠BAC=30°")?.targets).toEqual(["B", "A", "C"])
  })

  it("**没有形状从句 ⇒ 不知道两条边是哪两条**：如实落未核验（不猜）", () => {
    const parsed = parseDiagramObligations("∠A=60°，画出这个三角形")
    expect(parsed.givens.some((item) => item.kind === "planarAngle")).toBe(false)
    expect(parsed.unverified.some((item) => item.sourceText.includes("∠A"))).toBe(true)
  })

  it("顶点不在环上 ⇒ 也不猜", () => {
    const parsed = parseDiagramObligations("平面三角形ABC中，∠D=60°")
    expect(parsed.givens.some((item) => item.kind === "planarAngle")).toBe(false)
    expect(parsed.unverified.some((item) => item.sourceText.includes("∠D"))).toBe(true)
  })

  it("退化的度数读不出来：`∠A=180°` / `∠A=0°`", () => {
    expect(angleOf("平面三角形ABC中，∠A=180°")).toBeUndefined()
    expect(angleOf("平面三角形ABC中，∠A=0°")).toBeUndefined()
  })
})

/**
 * **弦长与面积：Task 14 的边界到底缺什么**（2026-10-14 量清楚再动手）。
 *
 * 边界原文只有四个字「弦长/面积未接」，没有写修法方向 —— 所以先量：
 *
 * - **面积这一半不是读取器缺口**：`△OAB的面积为3` 今天就读成 `area`（三个点名 + 值）。
 *   它核不核得出来只取决于**图上有没有点名 `O`**（那是作图那一侧的事，不是解析）。
 * - **弦长这一半是真缺口，而且比"未核验"更糟**：`弦 AB 的长为 3` 这种卷面常见写法
 *   **两条读取器都不认**，而这句里**没有 `=`** ⇒ 残留扫描器的触发词也够不到它
 *   ⇒ 结果是**静默丢掉一条题设**（既不进 `givens`，也不进 `unverified`）。本仓把
 *   "静默丢掉一个条件"当最贵的一类错，所以这一条要读出来。
 */
describe("弦长与面积：边界实测", () => {
  const lengthsOf = (prompt: string) => parseDiagramObligations(prompt).givens.filter((item) => item.kind === "fixedLength").map((item) => [item.targets.join(""), item.value])

  it("**面积这一半读得出来**：`△OAB的面积为3` ⇒ `area`（三个点名 + 值）", () => {
    const parsed = parseDiagramObligations("椭圆 x²/9+y²/4=1 与直线 y=0.5 相交于 A、B 两点，△OAB的面积为3")
    const area = parsed.givens.find((item) => item.kind === "area")
    expect(area?.targets).toEqual(["O", "A", "B"])
    expect(area?.value).toBe(3)
  })

  it("**静默丢掉**（修之前）：`弦 AB 的长为 3` 既不进给定、也不进未核验 —— 这句话**消失**了", () => {
    const parsed = parseDiagramObligations("椭圆 x²/9+y²/4=1 与直线 y=0.5 相交于 A、B 两点，弦 AB 的长为 3")
    expect(lengthsOf("椭圆 x²/9+y²/4=1 与直线 y=0.5 相交于 A、B 两点，弦 AB 的长为 3")).toEqual([["AB", 3]])
    // 它必须是**读出来**的，不是"落进未核验" —— 后者只是把消失换成了噪声。
    expect(parsed.unverified.filter((item) => item.sourceText.includes("弦 AB"))).toEqual([])
  })

  it("`|AB|=3` 这种绝对值记法也认（今天它落进未核验：句子里有 `=`）", () => {
    expect(lengthsOf("椭圆 x²/9+y²/4=1 与直线 y=0.5 相交于 A、B 两点，|AB|=3")).toEqual([["AB", 3]])
  })

  it("根号写法照收：`弦 AB 的长为 3√2`", () => {
    expect(lengthsOf("椭圆 x²/9+y²/4=1 与直线 y=0.5 相交于 A、B 两点，弦 AB 的长为 3√2")[0]?.[1]).toBeCloseTo(3 * Math.sqrt(2), 9)
  })
})

/**
 * **函数与直线的交点个数**（Task 15 的边界，2026-10-14）。
 *
 * 边界原文：「函数与直线的**交点数**尚未有义务种类与匹配器 ⇒ 真题里"多交点"那一型的
 * 产品入口仍是作图 + 内核读数，**未进核验面板**」。内核那一侧早就有 `functionLineRoots`
 *（代数路径给精确根、数值路径带 `complete`），缺的是"题面写了几个交点"这条判据。
 */
describe("函数与直线的交点个数", () => {
  const intersectionsOf = (prompt: string) => parseDiagramObligations(prompt).givens.find((item) => item.kind === "functionLineIntersections")

  it("`直线 y=0.5 与 f(x)=sin x 的图像有三个交点` ⇒ 直线 + 个数（中文数字也认）", () => {
    const item = intersectionsOf("直线 y=0.5 与 f(x)=sin x 的图像有三个交点")
    expect(item?.line).toEqual({ kind: "slope", slope: 0, intercept: 0.5 })
    expect(item?.value).toBe(3)
  })

  it("顺序反过来、个数写阿拉伯数字也认：`f(x)=x³−3x 的图像与直线 y=1 恰有 2 个交点`", () => {
    const item = intersectionsOf("f(x)=x³−3x 的图像与直线 y=1 恰有 2 个交点")
    expect(item?.line).toEqual({ kind: "slope", slope: 0, intercept: 1 })
    expect(item?.value).toBe(2)
  })

  it("斜线与竖线两种写法都收", () => {
    expect(intersectionsOf("直线 y=x+1 与 f(x)=x^3-3*x 的图像有两个交点")?.line).toEqual({ kind: "slope", slope: 1, intercept: 1 })
    expect(intersectionsOf("直线 x=2 与 f(x)=x^3-3*x 的图像有一个交点")?.line).toEqual({ kind: "vertical", x: 2 })
  })

  it("**直线一般式**也认：`2x−y+1=0` ⇒ `y = 2x + 1`", () => {
    const item = intersectionsOf("直线 2x−y+1=0 与 f(x)=x² 的图像有两个交点")
    expect(item?.line).toEqual({ kind: "slope", slope: 2, intercept: 1 })
    expect(item?.value).toBe(2)
  })

  it("**没写个数就不产这条**：如实落进未核验，不拿「相交」当个数", () => {
    const parsed = parseDiagramObligations("直线 y=0.5 与 f(x)=sin x 的图像相交")
    expect(parsed.givens.some((item) => item.kind === "functionLineIntersections")).toBe(false)
    expect(parsed.unverified.some((item) => item.sourceText.includes("相交"))).toBe(true)
  })
})

/**
 * **三角形类型与中点：常见写法不能静默消失**（2026-10-20，联考 `joint-19` 那一类）。
 *
 * 探针抓到两件事：
 * 1. `△ABC 为直角三角形` —— ABC 与「为」之间**有一个空格**，三条三角形类型读取器都要求紧贴，
 *    于是整句**既不产判据、也不落未核验**（残留扫描器的触发词表里没有"直角三角形"）。
 *    这是本仓最忌讳的"静默丢掉一条题设"。
 * 2. `M 为线段 AB 的中点` 带「线段」量词、`AB 的中点为 M` 把点写在后面 —— 中点读取器都不收。
 */
describe("三角形类型与中点：常见写法", () => {
  it("`△ABC 为直角三角形`（带空格）⇒ rightTriangle，且**不静默消失**", () => {
    const parsed = parseDiagramObligations("△ABC 为直角三角形")
    expect(parsed.givens.find((item) => item.kind === "rightTriangle")?.targets).toEqual(["A", "B", "C"])
    expect(parsed.unverified.map((entry) => entry.sourceText)).toEqual([])
  })

  it("钝角 / 锐角三角形的空格写法同样读得出", () => {
    expect(parseDiagramObligations("△ABC 为钝角三角形").givens.some((item) => item.kind === "obtuseTriangle")).toBe(true)
    expect(parseDiagramObligations("△ABC 为锐角三角形").givens.some((item) => item.kind === "acuteTriangle")).toBe(true)
  })

  it("`M 为线段 AB 的中点`（带「线段」量词）⇒ midpoint[M, A, B]", () => {
    expect(parseDiagramObligations("M 为线段 AB 的中点").givens.find((item) => item.kind === "midpoint")?.targets).toEqual(["M", "A", "B"])
  })

  it("`AB 的中点为 M`（点写在后面）⇒ midpoint[M, A, B]", () => {
    expect(parseDiagramObligations("AB 的中点为 M").givens.find((item) => item.kind === "midpoint")?.targets).toEqual(["M", "A", "B"])
  })

  it("垂直的**文字写法**也读得出：`AC 与 BC 垂直` / `AC 垂直于 BC` / `AB 与 CD 平行`", () => {
    expect(parseDiagramObligations("AC 与 BC 垂直").givens.find((item) => item.kind === "perpendicular")?.targets).toEqual(["A", "C", "B", "C"])
    expect(parseDiagramObligations("AC 垂直于 BC").givens.find((item) => item.kind === "perpendicular")?.targets).toEqual(["A", "C", "B", "C"])
    expect(parseDiagramObligations("AB 与 CD 平行").givens.find((item) => item.kind === "parallel")?.targets).toEqual(["A", "B", "C", "D"])
  })
})

/**
 * **链式等号**（2026-10-19 联考 `joint-04` / `joint-05`：`∥FE`、`=AA₁` 那种碎片）。
 *
 * 现场读数：`AB=AC=AA₁` 只读出第一对，剩下的 `=AA₁` 在残留里变成一条"未核验的条件"；
 * 带尾巴时更糟 —— `AB=AC=AA₁=2` 会先被**单段长度读取器**吃掉 `AA₁=2`，留一个孤立的 `=`。
 * 所以这一条必须排在单段读取器**之前**（与"先长的、再短的"同一条纪律）。
 */
describe("链式等号：AB=AC=AA₁", () => {
  it("`AB=AC=AA₁` ⇒ 两条 equalLength（相邻两段），不留 `=AA₁` 碎片", () => {
    const parsed = parseDiagramObligations("AB=AC=AA₁")
    expect(parsed.givens.filter((item) => item.kind === "equalLength").map((item) => item.targets)).toEqual([
      ["A", "B", "A", "C"],
      ["A", "C", "A", "A₁"]
    ])
    expect(parsed.unverified.map((entry) => entry.sourceText)).toEqual([])
  })

  it("`AB=AC=AA₁=2` ⇒ 两条 equalLength + 三段 fixedLength=2，不留孤立 `=`", () => {
    const parsed = parseDiagramObligations("AB=AC=AA₁=2")
    expect(parsed.givens.filter((item) => item.kind === "equalLength")).toHaveLength(2)
    expect(
      parsed.givens.filter((item) => item.kind === "fixedLength").map((item) => [item.targets, item.value])
    ).toEqual([
      [["A", "B"], 2],
      [["A", "C"], 2],
      [["A", "A₁"], 2]
    ])
    expect(parsed.unverified.map((entry) => entry.sourceText)).toEqual([])
  })

  it("单段与两段写法不受影响：`AB=2` 仍是 fixedLength，`AB=AC` 仍是一条 equalLength", () => {
    expect(parseDiagramObligations("AB=2").givens.map((item) => item.kind)).toEqual(["fixedLength"])
    expect(parseDiagramObligations("AB=AC").givens.map((item) => item.kind)).toEqual(["equalLength"])
  })
})
