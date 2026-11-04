import { describe, expect, it } from "vitest"

import { parseShapeClause } from "./shapeGrammar"

/**
 * **入口语法（S6）的正反例表**。
 *
 * 判据是设计 §6 的那条纪律：**"认不出就问路"优先于"多认一句"**。
 * 所以这里两半同等重要 —— 认得出的必须**逐字段**对（族、底环、锥顶 / 顶环），
 * 认不出的必须**返回 `null`**（`null` = 问路），而不是猜一个形状出来。
 */
describe("入口语法：形状说法", () => {
  describe("认得出", () => {
    it("四棱锥 P-ABCD：前半是锥顶，后半是底环", () => {
      const shape = parseShapeClause("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，画出这个四棱锥")
      expect(shape).toEqual({ family: "pyramid", phrase: "在四棱锥 P-ABCD 中", base: ["A", "B", "C", "D"], apex: "P" })
    })

    it("三棱锥 A-BCD：锥顶在最前面（不是 `P-` 开头也一样认）", () => {
      const shape = parseShapeClause("在三棱锥 A-BCD 中，BD=2，画一张示意图")
      expect(shape?.family).toBe("pyramid")
      expect(shape?.apex).toBe("A")
      expect(shape?.base).toEqual(["B", "C", "D"])
    })

    it("三棱柱 ABC-A′B′C′：前半是底环，后半是顶环", () => {
      const shape = parseShapeClause("在三棱柱ABC-A′B′C′中，AA′⊥平面ABC，画出这个三棱柱")
      expect(shape?.family).toBe("prism")
      expect(shape?.base).toEqual(["A", "B", "C"])
      expect(shape?.top).toEqual(["A′", "B′", "C′"])
    })

    it("六棱柱：环长 6 也认（内核上界）", () => {
      const shape = parseShapeClause("在六棱柱ABCDEF-A′B′C′D′E′F′中，AA′⊥平面ABCDEF，画出这个六棱柱")
      expect(shape?.family).toBe("prism")
      expect(shape?.base).toEqual(["A", "B", "C", "D", "E", "F"])
      expect(shape?.top).toEqual(["A′", "B′", "C′", "D′", "E′", "F′"])
    })

    it("四棱台：同一套两段写法，族是台体", () => {
      const shape = parseShapeClause("在四棱台ABCD-A′B′C′D′中，AB⊥AD，画出这个四棱台")
      expect(shape?.family).toBe("frustum")
      expect(shape?.base).toEqual(["A", "B", "C", "D"])
      expect(shape?.top).toEqual(["A′", "B′", "C′", "D′"])
    })

    it("修饰词与 ASCII 撇：`正四棱锥` 认得出，`A'` 与 `A′` 是同一个名字", () => {
      expect(parseShapeClause("在正四棱锥 P-ABCD 中，PA⊥平面ABCD")?.family).toBe("pyramid")
      expect(parseShapeClause("在三棱柱ABC-A'B'C'中，AA'⊥平面ABC")?.top).toEqual(["A'", "B'", "C'"])
    })
  })

  describe("认不出（一律 `null` = 问路）", () => {
    it("数词与环长不符：写『四棱锥』却给 5 个点名", () => {
      expect(parseShapeClause("在四棱锥 P-ABCDE 中，PA ⊥ 平面 ABCDE")).toBeNull()
    })

    it("顶环与底环对不上：`ABCD-A′C′B′D′` 不按顺序硬配", () => {
      expect(parseShapeClause("在四棱柱ABCD-A′C′B′D′中，AA′⊥平面ABCD")).toBeNull()
    })

    it("棱柱只有一段点名（缺顶环）", () => {
      expect(parseShapeClause("在四棱柱 P-ABCD 中，PA ⊥ 平面 ABCD")).toBeNull()
    })

    it("ASCII 数字下标（`A1`）不是本仓点名", () => {
      expect(parseShapeClause("在三棱柱A1B1C1-A2B2C2中，AA1⊥平面ABC")).toBeNull()
    })

    it("没有点名表：`在棱柱中`", () => {
      expect(parseShapeClause("在棱柱中，A′B=1")).toBeNull()
    })

    it("锥顶同时是底面顶点：`A-ABCD` 自相矛盾", () => {
      expect(parseShapeClause("在四棱锥 A-ABCD 中，AO⊥平面ABCD")).toBeNull()
    })

    it("没有『在…中』从句：没有点名表就产不出 spec，不替用户编一套", () => {
      expect(parseShapeClause("底面边长 2 的棱柱，AB垂直AD")).toBeNull()
      expect(parseShapeClause("画一个四棱锥")).toBeNull()
    })

    it("分析题 / 无关句", () => {
      expect(parseShapeClause("在三棱锥 A-BCD 中，BD=2。求证 OA⊥CD")).not.toBeNull()
      expect(parseShapeClause("求证：OA⊥CD")).toBeNull()
      expect(parseShapeClause("")).toBeNull()
    })

    it("球与多面体的关系：S5 未落地，**有意不认**（认了也造不出来）", () => {
      expect(parseShapeClause("在球O中，AB=2")).toBeNull()
      expect(parseShapeClause("求三棱锥 P-ABC 的外接球半径")).toBeNull()
    })
  })

  /**
   * **「正 / 斜 / 直」修饰词必须被保留**（S3 斜棱柱那一刀）。
   *
   * 此前它在正则里是个**非捕获组**、`RecognisedShape` 里也没有这个字段 —— 于是
   * `在斜三棱柱ABC-A′B′C′中，AA′⊥平面ABC` 会被**当成普通（直）棱柱画出来**：
   * 题面说"斜"、系统画"直"，而且一路绿到提交。这是"静默换一个题面没说的形状"，
   * 所以修饰词必须成为**读得出来的字段**，让下游能就"斜 + 侧棱⊥底面"这种自相矛盾发话。
   */
  it("保留「正 / 斜 / 直」修饰词（此前被正则吃掉，下游看不见）", () => {
    expect(parseShapeClause("在斜三棱柱ABC-A′B′C′中，AB=2，画出这个斜三棱柱")?.modifier).toBe("斜")
    expect(parseShapeClause("在正四棱柱ABCD-A′B′C′D′中，AB=2")?.modifier).toBe("正")
    expect(parseShapeClause("在直三棱柱ABC-A′B′C′中，AA′⊥平面ABC")?.modifier).toBe("直")
    // 没写修饰词就是没写：不许默认成"直"（那同样是把题面没说的事替用户定了）。
    expect(parseShapeClause("在三棱柱ABC-A′B′C′中，AA′⊥平面ABC")?.modifier).toBeUndefined()
  })
})

/**
 * **裸的平面图形**（2026-10-11 用户现场；乙案实施计划 Task 1）。
 *
 * 探针实测：用户那句题面八个从句全读得懂，但 `specForPrompt` 返回
 * `unrecognised`，理由是「题面里没有可识别的『在…中』形状从句」——
 * 而那句题面**有**「平面四边形ABCD中」。原因在这个文件的词表里：
 * `RecognisedFamily` 只有 `pyramid | prism | frustum`，`SHAPE_CLAUSE` 也要求
 * `棱锥 | 棱柱 | 棱台`，所以**平面图形这一类根本没有分支接它**。
 *
 * 这一支只**新增**一条分支，立体那三族的识别**逐字不变**（下面那条护栏钉住它）。
 */
describe("平面图形从句（乙案 Task 1）", () => {
  it("认出「平面四边形ABCD中」", () => {
    const shape = parseShapeClause("平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°")
    expect(shape?.family).toBe("planar-figure")
    expect(shape?.base).toEqual(["A", "B", "C", "D"])
    // 原文照留（面板与日志要引题面原话，不改写）。
    expect(shape?.phrase).toBe("平面四边形ABCD中")
  })

  it("不带「平面」二字的写法也认", () => {
    expect(parseShapeClause("四边形ABCD中，AB=8")?.base).toEqual(["A", "B", "C", "D"])
  })

  it("三角形也认", () => {
    expect(parseShapeClause("在三角形ABC中，AB=3")?.family).toBe("planar-figure")
    expect(parseShapeClause("在三角形ABC中，AB=3")?.base).toEqual(["A", "B", "C"])
  })

  /**
   * **`Rt△ABC` 与 `△ABC` 也要认**（2026-10-15 用户现场：`Rt△ABC 中，∠C=90°，AC=3，BC=4。`）。
   *
   * 现场读数：`∠C=90°` 落成"题面里没有可识别的形状从句（点名环）…不知道是哪两条边"，
   * 而三条长度条件也没能帮上忙 —— 根因就是这一句**没被认出来**：`Rt` 是修饰词、`△` 是
   * 三角形的符号，而这条正则只收"三角形"三个字。
   *
   * **只认环，不从 `Rt` 推出"哪个顶点是直角"**：`Rt△ABC` 这个写法本身**不说**直角在哪个顶点
   *（题面下一句才说 `∠C=90°`），凭 `Rt` 猜一个顶点就是替题面编条件。
   */
  it("`Rt△ABC 中` 与 `△ABC 中` 认得出环（但不从 `Rt` 猜哪个是直角）", () => {
    const right = parseShapeClause("Rt△ABC 中，∠C=90°，AC=3，BC=4。")
    expect(right?.family).toBe("planar-figure")
    expect(right?.base).toEqual(["A", "B", "C"])
    expect(parseShapeClause("△ABC中，∠C=90°")?.base).toEqual(["A", "B", "C"])
    // 直角由题面那句 `∠C=90°` 说，不由 `Rt` 猜 —— 形状这一层不带角度。
    expect(right).not.toHaveProperty("rightAngle")
  })

  it("护栏：立体那三族与既有问路**逐字不变**", () => {
    expect(parseShapeClause("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，画出这个四棱锥")?.family).toBe("pyramid")
    expect(parseShapeClause("在三棱柱ABC-A′B′C′中，AA′⊥平面ABC")?.family).toBe("prism")
    expect(parseShapeClause("在四棱台ABCD-A′B′C′D′中，AB⊥AD，画出这个四棱台")?.family).toBe("frustum")
    // 「在球O中」不是多边形：仍然问路，不许被新分支顺手收进来。
    expect(parseShapeClause("在球O中，AB=2")).toBeNull()
    expect(parseShapeClause("画一个四棱锥")).toBeNull()
  })
})

/**
 * **T2：入口语法与关系保真**（2026-11-05 四题修复）。
 *
 * 这一组挡的是 T1 基线实测出来的两个入口缺口 + 计划点名要补的排版变体：
 *
 * 1. **棱柱顶环的 `A₁` 字形**：`在正三棱柱ABC-A₁B₁C₁中` 今天整句返回 `null` ——
 *    顶环对应规则写死了 `A′`，于是题面用**下标**写的顶面点名一个都配不上。
 *    设计 §4.3 的口径是"保留上下环一一对应及题面原名，**不让默认 `A′` 覆盖已给 `A₁`**"。
 * 2. **没写「在」的形状从句**：`四棱锥P-ABCD中` / `以…为底面的四棱锥…中` 今天认不出。
 * 3. **`A_1` / `A_{1}` 排版变体**：只做**有边界的下标归一**，不碰 ASCII `A1`
 *   （`A1` 不是点名，仍须留在"读不出"那一侧 —— 那是 `pointNames` 的既有裁决）。
 */
describe("T2 入口语法：棱柱下标顶环、无「在」从句、排版变体", () => {
  it("题面用下标写顶环（`A₁B₁C₁`）⇒ 认得出，且**保留原名**，不改成 `A′`", () => {
    const shape = parseShapeClause("如图，在正三棱柱ABC-A₁B₁C₁中，底面边长AB=2，侧棱长AA₁=3")
    expect(shape, "首选原句：`在正三棱柱ABC-A₁B₁C₁中`").not.toBeNull()
    expect(shape?.family).toBe("prism")
    expect(shape?.base).toEqual(["A", "B", "C"])
    expect(shape?.top).toEqual(["A₁", "B₁", "C₁"])
    expect(shape?.modifier).toBe("正")
  })

  it("排版变体 `A_1` / `A_{1}` 与 `A₁` 归一到同一个结果", () => {
    const expected = { family: "prism", base: ["A", "B", "C"], top: ["A₁", "B₁", "C₁"] }
    for (const written of ["ABC-A₁B₁C₁", "ABC-A_1B_1C_1", "ABC-A_{1}B_{1}C_{1}"]) {
      const shape = parseShapeClause(`在正三棱柱${written}中，AB=2`)
      expect(shape, `写法：${written}`).not.toBeNull()
      expect(shape?.family, `写法：${written}`).toBe(expected.family)
      expect(shape?.base, `写法：${written}`).toEqual(expected.base)
      expect(shape?.top, `写法：${written}`).toEqual(expected.top)
    }
  })

  it("撇号写法仍然认，且**原样保留**（不强制改写成某种字形）", () => {
    const shape = parseShapeClause("在三棱柱ABC-A'B'C'中，AA'⊥平面ABC")
    expect(shape?.family).toBe("prism")
    expect(shape?.top).toEqual(["A'", "B'", "C'"])
  })

  it("没写「在」的形状从句也认（`四棱锥P-ABCD中`）", () => {
    expect(parseShapeClause("四棱锥P-ABCD中，PA⊥平面ABCD")?.family).toBe("pyramid")
    expect(parseShapeClause("四棱锥P-ABCD中，PA⊥平面ABCD")?.base).toEqual(["A", "B", "C", "D"])
    expect(parseShapeClause("三棱柱ABC-A′B′C′中，AA′⊥平面ABC")?.family).toBe("prism")
  })

  it("插入底面描述（`以…为底面的四棱锥…中`）也认", () => {
    const shape = parseShapeClause("如图，在以直角梯形ABCD为底面的四棱锥P-ABCD中，PA⊥平面ABCD")
    expect(shape?.family).toBe("pyramid")
    expect(shape?.base).toEqual(["A", "B", "C", "D"])
    expect(shape?.apex).toBe("P")
  })

  it("负测：上下环后缀不一致 ⇒ 问路（不按顺序硬配）", () => {
    // 顶环第 2 个用撇、其余用下标：说不出是哪一套对应关系。
    expect(parseShapeClause("在三棱柱ABC-A₁B′C₁中，AB=2")).toBeNull()
    // 顶环点数与底环不同。
    expect(parseShapeClause("在三棱柱ABC-A₁B₁中，AB=2")).toBeNull()
    // 顶环点名不是"底环点名 + 后缀"。
    expect(parseShapeClause("在三棱柱ABC-A₁B₁D₁中，AB=2")).toBeNull()
  })

  it("负测：ASCII `A1` 仍不是点名（既有裁决不变），重复点与环数不符也问路", () => {
    expect(parseShapeClause("在三棱柱ABC-A1B1C1中，AB=2")).toBeNull()
    expect(parseShapeClause("在四棱锥P-ABCA中，PA⊥平面ABCD")).toBeNull()
    expect(parseShapeClause("在四棱锥P-ABCDE中，PA⊥平面ABCDE")).toBeNull()
  })
})
