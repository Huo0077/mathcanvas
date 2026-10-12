import { describe, expect, it } from "vitest"

import { parseObligationWithLegacy } from "../obligationIR"
import { searchWitness, specForPrompt } from "./witnessSearch"

/**
 * 题设按**产品路径的同一份形状**取：`parseObligationWithLegacy(prompt).ir`
 *（与 `planCompiler.witnessSearchInput` 逐字一致）。用 `parseDiagramObligations` 的
 * `givens` 会拿到**另一种类型**，`tsc` 会当场拒绝 —— 这条我踩过一次。
 */
const givensOf = (prompt: string) =>
  parseObligationWithLegacy(prompt).ir.obligations.filter((obligation) => obligation.role === "given")

/**
 * **平面图形这一族**（乙案实施计划 Task 1 / Task 2）。
 *
 * Task 1 只**认出**了它（`parseShapeClause` 的新分支）；**构造规格**是 Task 2。
 * 两份之间那段时间，`specForPrompt` 必须**如实说"这一类还没有构造器"** ——
 * 不许掉进棱锥那一支去拿一句**对平面题是假话**的理由（"缺锥顶 / 缺侧棱⊥底面"），
 * 那会让用户照着去补一个题面根本没提的立体条件。
 */
const PROMPT = "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3"

describe("平面图形（乙案）", () => {
  /**
   * **期望在 Task 2 有意改了**：上一轮这一条断言的是"如实说这一类还没有构造器"
   *（那是 Task 1 与 Task 2 之间的过渡状态）。Task 2 把那个"没有"变成了"有" ——
   * 所以它现在断言的是**规格真的被推出来了**。
   */
  it("把针对环上点名的度量条件抽成一份平面构造规格", () => {
    const result = specForPrompt(PROMPT, givensOf(PROMPT))

    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.spec.family).toBe("planar-figure")
    expect(result.spec.base).toEqual(["A", "B", "C", "D"])
    /**
     * 五条四边形条件各自成一条关系：三条长度（`AB` / `AD` / `CD` ⇒ `segment-length`）
     * 与两个角（`∠BAD` / `∠ADC` ⇒ `planarAngle`）。**这一条是 Task 2 的核心读数**：
     * 条件**不需要模型复述**，它们本来就是解析器从原话抽出来的。
     */
    expect(result.spec.relations).toHaveLength(5)
    expect(result.spec.relations.filter((relation) => relation.kind === "segment-length")).toHaveLength(3)
    expect(result.spec.relations.filter((relation) => relation.kind === "planarAngle")).toHaveLength(2)
    // 每一条长度都带值（不是"只记形状"，值就是题面写的那个数）。
    for (const relation of result.spec.relations.filter((entry) => entry.kind === "segment-length")) {
      expect(typeof relation.value).toBe("number")
    }
  })

  it("护栏：环外点名的条件**不进**这份规格（`PC=4√3` 属于折，不属于平面四边形）", () => {
    const withFoldTarget = `${PROMPT}，且PC=4√3`
    const result = specForPrompt(withFoldTarget, givensOf(withFoldTarget))

    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    const touched = result.spec.relations.flatMap((relation) => ("segments" in relation ? relation.segments.flat() : relation.targets))
    expect(touched).not.toContain("P")
  })

  it("护栏：立体题面仍然照旧推出 spec（新分支没抢走它们）", () => {
    const solid = "在四棱锥P-ABCD中，PA⊥平面ABCD，底面ABCD是菱形，画出这个四棱锥"
    const result = specForPrompt(solid, givensOf(solid))
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.spec.family).toBe("pyramid")
  })

  /**
   * **接线**（乙案 Task 3A）：一份平面规格喂进 `searchWitness`，要能拿到**通过核验**的坐标。
   *
   * 这一条同时钉住两件事，缺一条它就红：
   * 1. 内核按 `family` 分派到平面构造器（否则是 `missing-apex`）；
   * 2. 物化走的是 `solid.create_face`（平面片）而**不是** `solid.create_polyhedron` ——
   *    后者要求至少四个面，一张四边形的环当场被拒（这正是用户现场那句
   *    `a polyhedron needs at least four faces`），于是候选会以 `materialisation-failed` 收场。
   *
   * 所以这里断言的是"**端到端真能通过**"，而不是某一个中间函数的返回值：
   * 只要物化那一步还挂在多面体上，`status` 就不可能是 `verified_instance`。
   */
  it("平面规格喂进搜索器能拿到通过核验的坐标（物化走平面片那一条）", () => {
    const parsed = parseObligationWithLegacy(PROMPT)
    const shaped = specForPrompt(PROMPT, givensOf(PROMPT))
    expect(shaped.status).toBe("ok")
    if (shaped.status !== "ok") return

    const result = searchWitness({
      obligations: parsed.ir,
      shape: "planar-figure",
      spec: shaped.spec,
      seed: 1,
      maxCandidates: 8,
      timeoutMs: 10_000
    })
    expect(result.status, result.status === "unverified_instance" ? result.reasons.join(" / ") : "已经拿到核验通过的候选").toBe("verified_instance")
    if (result.status !== "verified_instance") return

    const at = new Map(result.candidate.names.map((name, index) => [name, result.candidate.vertices[index]!]))
    // 系统自己把 B、C、D 造出来了（用户那句题面原先只画得出 A、E、F、P）。
    expect([...at.keys()]).toEqual(["A", "B", "C", "D"])
    const distance = (first: string, second: string): number => {
      const left = at.get(first)!
      const right = at.get(second)!
      return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
    }
    const angle = (vertex: string, first: string, second: string): number => {
      const corner = at.get(vertex)!
      const alongFirst = { x: at.get(first)!.x - corner.x, y: at.get(first)!.y - corner.y }
      const alongSecond = { x: at.get(second)!.x - corner.x, y: at.get(second)!.y - corner.y }
      const cosine = (alongFirst.x * alongSecond.x + alongFirst.y * alongSecond.y) / (Math.hypot(alongFirst.x, alongFirst.y) * Math.hypot(alongSecond.x, alongSecond.y))
      return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
    }
    expect(distance("A", "B")).toBeCloseTo(8, 9)
    expect(distance("A", "D")).toBeCloseTo(5 * Math.sqrt(3), 9)
    expect(distance("C", "D")).toBeCloseTo(3, 9)
    expect(angle("A", "B", "D")).toBeCloseTo(30, 9)
    expect(angle("D", "A", "C")).toBeCloseTo(90, 9)
  })
})

/**
 * **Task 11（2026-10-12）：三角形真题纵向 —— 分支与失败分类。**
 *
 * 判据照调研 §3.2 那句："**多解与边界是常态**……'求解器没找到' ≠ 数学无解，
 * '画得像' ≠ 题设成立"。所以这一组不给"生成了点"就勾（计划原话："不能只断言'生成了点'"），
 * 而是逐条问：**这一句题面今天是哪一种结局？该是哪一种？**
 *
 * 四个样本对着计划 RED 列的那几格：无解（三角不等式）/ 欠定 / 角顶点不在环上（写错）/
 * SSA（两边一对角，可能两解）。
 */
const triangle = (clauses: string): string => `三角形ABC中，${clauses}`

function searchTriangle(clauses: string) {
  const prompt = triangle(clauses)
  const parsed = parseObligationWithLegacy(prompt)
  const shaped = specForPrompt(prompt, givensOf(prompt))
  if (shaped.status !== "ok") return { shaped: shaped.status as string, prompt, result: null }
  return {
    shaped: "ok",
    prompt,
    result: searchWitness({ obligations: parsed.ir, shape: "planar-figure", spec: shaped.spec, seed: 1, maxCandidates: 8, timeoutMs: 10_000 })
  }
}

describe("Task 11 — 三角形的分支与失败分类", () => {
  it("无解（三角不等式）不许只说'没找到'，要说成矛盾", () => {
    const probe = searchTriangle("AB=2，BC=1，AC=10")
    expect(probe.shaped, probe.prompt).toBe("ok")
    const result = probe.result!
    const why = result.status === "verified_instance" ? "verified_instance（不该通过）" : (result.status === "no_witness" ? result.failures.join(" / ") : result.reasons.join(" / "))

    // 三条边满足 2 + 1 < 10 ⇒ 这样的三角形**不存在**，这是可以判定的矛盾，不是"没搜到"。
    //
    // 实测读数：状态是 `unverified_instance`，而理由里带着**机器可读的码**
    // `contradictory-planar`，原文是"这几条条件互相不可能同时成立"。所以口径是
    // "**放行但不当作已核验** + 说清是矛盾"，而不是把它降级成一句"没找到"。
    expect(result.status, `今天读到的是：${result.status}；理由：${why}`).toBe("unverified_instance")
    expect(why, `今天读到的是：${why}`).toMatch(/contradictory-planar/)
    expect(why, `今天读到的是：${why}`).toMatch(/不可能同时成立/)
  })

  it("欠定（只给一条边）如实说清缺哪个点，不许当成无解", () => {
    const probe = searchTriangle("AB=8")
    expect(probe.shaped, probe.prompt).toBe("ok")
    const result = probe.result!
    const why = result.status === "verified_instance" ? "verified_instance" : (result.status === "no_witness" ? result.failures.join(" / ") : result.reasons.join(" / "))

    /**
     * **实测读数**：状态 `unverified_instance`，理由是 `underdetermined-planar`，
     * 并且**点名哪一个点**还没有条件钉住它（"C：没有任何条件把它定出来"）。
     *
     * 这是这一层**有意**的边界（原文："本层只做每条边、每个角都由题面钉死的情形"）——
     * 所以本任务钉的是"**欠定要说成欠定、并说清缺谁**"，而不是"必须画出来"：
     * 按仓里的口径，另一种做法（挑一组示例值画出来）属于"系统替用户定了题面没说的事"，
     * 那要么带 `freeChoices` 披露、要么不做。
     */
    expect(result.status, `今天读到的是：${result.status}；理由：${why}`).toBe("unverified_instance")
    expect(why, `今天读到的是：${why}`).toMatch(/underdetermined-planar/)
    expect(why, `今天读到的是：${why}`).toMatch(/C/)
  })

  it("角顶点不在环上时必须如实拒绝，不许当没看见", () => {
    // `∠ADB` 的顶点 `D` 根本不在这只三角形上 ⇒ 这条题设无法核验。
    const probe = searchTriangle("AB=8，AC=6，∠ADB=30°")
    const result = probe.result
    const why = result === null ? `specForPrompt=${probe.shaped}` : result.status === "verified_instance" ? "verified_instance" : (result.status === "no_witness" ? result.failures.join(" / ") : result.reasons.join(" / "))
    // 通过 = 把一个环外点名的角当成成立，那是"画得像"冒充"题设成立"。
    expect(result?.status ?? probe.shaped, `今天读到的是：${why}`).not.toBe("verified_instance")
  })

  it("SSA 构造出来的那一支必须自己满足全部三条题设", () => {
    const probe = searchTriangle("AB=8，∠A=30°，BC=4")
    expect(probe.shaped, probe.prompt).toBe("ok")
    const result = probe.result!
    if (result.status !== "verified_instance") {
      // 若今天给不出，如实记下它给的是哪一种 —— 但 **不能** 是"无解"。
      expect(result.status, `今天读到的是：${result.status}`).not.toBe("no_witness")
      return
    }
    const at = new Map(result.candidate.names.map((name, index) => [name, result.candidate.vertices[index]!]))
    const distance = (first: string, second: string): number => Math.hypot(at.get(first)!.x - at.get(second)!.x, at.get(first)!.y - at.get(second)!.y, at.get(first)!.z - at.get(second)!.z)
    const angle = (vertex: string, first: string, second: string): number => {
      const corner = at.get(vertex)!
      const u = { x: at.get(first)!.x - corner.x, y: at.get(first)!.y - corner.y }
      const v = { x: at.get(second)!.x - corner.x, y: at.get(second)!.y - corner.y }
      const cosine = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))
      return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
    }
    expect(distance("A", "B")).toBeCloseTo(8, 9)
    expect(angle("A", "B", "C")).toBeCloseTo(30, 9)
    expect(distance("B", "C")).toBeCloseTo(4, 9)
  })

  /**
   * **面积条件**（计划 Task 11 的第一句："边角**面积**联立"）。
   *
   * 调研 §2.1 把"解三角形条件与面积条件联立"列为真题难点，并明确"只满足正弦定理而不核面积的图
   * 是**错误图**"。所以面积必须**进规格**（否则它连"要核验的东西"都不是）。
   *
   * 这条是**探针**：它先把今天的 `kind` 清单打出来，再断言里面有 `area`。
   */
  it("面积条件进规格，而且造出来的图**面积真的对**（缺口已补）", () => {
    // 角必须写成**三个点名**（`∠BAC`）—— 单字母 `∠A` 不是解析器认的句型。
    const prompt = "三角形ABC中，AB=8，∠BAC=30°，且△ABC的面积为6"
    const parsed = parseObligationWithLegacy(prompt)
    const shaped = specForPrompt(prompt, givensOf(prompt))
    expect(shaped.status).toBe("ok")
    if (shaped.status !== "ok") return

    /**
     * **这一条是从"缺口已钉住"反向改过来的**（Task 11，2026-10-12）：
     * 上一轮它断言的是"今天**就是** `["segment-length","planarAngle"]`，面积不进"，
     * 并按仓里做法写明"谁把面积做出来就改成 `toContain("area")`"。现在改过来了。
     */
    expect(shaped.spec.relations.map((relation) => relation.kind)).toContain("area")

    const result = searchWitness({ obligations: parsed.ir, shape: "planar-figure", spec: shaped.spec, seed: 1, maxCandidates: 8, timeoutMs: 10_000 })
    const why = result.status === "verified_instance" ? "verified_instance" : result.status === "no_witness" ? result.failures.join(" / ") : result.reasons.join(" / ")
    expect(result.status, `今天读到的是：${why}`).toBe("verified_instance")
    if (result.status !== "verified_instance") return

    const at = new Map(result.candidate.names.map((name, index) => [name, result.candidate.vertices[index]!]))
    const [a, b, c] = ["A", "B", "C"].map((name) => at.get(name)!)
    // **自己算**面积（二维叉积的一半），不读构造过程留下的任何量。
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2
    expect(area).toBeCloseTo(6, 9)
    // 顺带把另外两条也自算一遍：面积对但边长/角不对同样是错图。
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(8, 9)
  })

  /**
   * **换点名**（计划 Task 11 的 RED 里点名的最后一格）。
   *
   * 与正例是**同一个三角形**，只是环从 `B` 起、角改写成 `∠CBA`（顶点 `B`）——
   * 条件一字未改。判据要求：环顺序跟着题面走、三条条件仍然逐条自算成立。
   * 这一格挡的是"顶点顺序靠猜"那个静默假设（仓里 `shuffled-naming` 那条 benchmark 用例
   * 问的是同一件事）。
   */
  it("换点名：同一个三角形换个起名字，环与条件都跟着题面走", () => {
    const prompt = "平面三角形BCA中，BC=8，∠CBA=30°，△BCA的面积为6"
    const parsed = parseObligationWithLegacy(prompt)
    const shaped = specForPrompt(prompt, givensOf(prompt))
    expect(shaped.status).toBe("ok")
    if (shaped.status !== "ok") return
    // 环顺序就是题面写的那个（不是被系统排成字母序）。
    expect(shaped.spec.base).toEqual(["B", "C", "A"])

    const result = searchWitness({ obligations: parsed.ir, shape: "planar-figure", spec: shaped.spec, seed: 1, maxCandidates: 8, timeoutMs: 10_000 })
    const why = result.status === "verified_instance" ? "verified_instance" : result.status === "no_witness" ? result.failures.join(" / ") : result.reasons.join(" / ")
    expect(result.status, `今天读到的是：${why}`).toBe("verified_instance")
    if (result.status !== "verified_instance") return

    const at = new Map(result.candidate.names.map((name, index) => [name, result.candidate.vertices[index]!]))
    const b = at.get("B")!
    const c = at.get("C")!
    const a = at.get("A")!
    const alongBc = { x: c.x - b.x, y: c.y - b.y }
    const alongBa = { x: a.x - b.x, y: a.y - b.y }
    expect(Math.hypot(alongBc.x, alongBc.y)).toBeCloseTo(8, 9)
    const cosine = (alongBc.x * alongBa.x + alongBc.y * alongBa.y) / (Math.hypot(alongBc.x, alongBc.y) * Math.hypot(alongBa.x, alongBa.y))
    expect((Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI).toBeCloseTo(30, 9)
    expect(Math.abs(alongBc.x * alongBa.y - alongBc.y * alongBa.x) / 2).toBeCloseTo(6, 9)
  })

  /**
   * **两解的出口早就有了 —— 在 `assumptions` 里，而不是在新增的 `alternatives` 里。**
   *
   * 第四轮我先加了 `alternatives`（给 `verified_instance` 收"其余通过核验的支"），
   * 然后测出平面这一族的候选池只有一条解析候选、`alternatives` 永远是空的 ——
   * 当时我把它读成"两解没有出口"。**那个读法不完整**：内核在
   * `constructPlanarWitness` 里**自己数过**有几组解，并写进假设：
   * *"满足全部条件的坐标有 N 组，系统取第一组（各组都满足题面，差别只在镜像 / 另一支）。"*
   * 那一行是**用户能在面板上看到的**披露。
   *
   * 所以这一条钉的是：**两解确实被披露了，出口是那一行**。
   * 按本仓"同一个判断写两遍必然分叉"的纪律，`alternatives` 那条通道因此是**第二份**，
   * 已被撤掉（见 CHANGELOG）。
   */
  it("两解：由 `assumptions` 那行如实披露（出口早就有，不需要第二处）", () => {
    for (const clauses of ["AB=8，∠BAC=30°，△ABC的面积为6", "AB=8，∠BAC=30°，BC=4"]) {
      const probe = searchTriangle(clauses)
      const result = probe.result!
      const why = result.status === "verified_instance" ? "verified_instance" : (result.status === "no_witness" ? result.failures.join(" / ") : result.reasons.join(" / "))
      expect(result.status, `${clauses} 今天读到的是：${why}`).toBe("verified_instance")
      if (result.status !== "verified_instance") continue
      const text = result.assumptions.join(" / ")
      // 内核自己数过有几组解，并把它写进了用户看得见的那一行。
      expect(text, `${clauses} 的假设是：${text}`).toMatch(/满足全部条件的坐标有 \d+ 组/)
    }
  })

  /**
   * **SSA 现在真的解得出来了**（Task 11，2026-10-12 第四轮）。
   *
   * ## 先把上一轮的错记清楚
   *
   * 第三轮我把这一格记成"**SSA ⇒ 通过且逐条自算成立**" —— **那是错的**：
   * 当时的断言写成"要么 `verified_instance`，要么**至少不是 `no_witness`**"，
   * 而它走的正是后半支，等于**用一条宽松的断言给自己报了一个不存在的成功**。
   * 第四轮改成严断言，它当场红了，实测是 `unverified_instance` + `underdetermined-planar`：
   * *"C：角已经点名，但缺一条定长 AC…本层只做每条边、每个角都由题面钉死的情形。"*
   *
   * ## 而那句话本身在数学上是假话
   *
   * SSA（两边一对角、角不在两边之间）**不是欠定** —— 它由正余弦定理**唯一或两解**地定形，
   * AC 由另外三条**算得出来**。真实缺口是这一层只会"角 + **那条臂**的定长"或
   * "两条到已定点的定长"，**不会联立**。
   *
   * ## 所以这一轮补的是那条规则本身
   *
   * 内核新增 `ray-circle`：角给一条**射线**、`BC` 给一个**圆**，相交即解（**最多两解**）。
   * 这条断言现在要的是：SSA 解得出来，而且三条题设**逐条自算**成立。
   */
  it("SSA：角 + 另一条到已定点的定长 ⇒ 解得出来，且三条题设逐条自算成立", () => {
    const probe = searchTriangle("AB=8，∠BAC=30°，BC=4")
    const result = probe.result!
    const why = result.status === "verified_instance" ? "verified_instance" : (result.status === "no_witness" ? result.failures.join(" / ") : result.reasons.join(" / "))
    expect(result.status, `今天读到的是：${why}`).toBe("verified_instance")
    if (result.status !== "verified_instance") return

    const at = new Map(result.candidate.names.map((name, index) => [name, result.candidate.vertices[index]!]))
    const a = at.get("A")!
    const b = at.get("B")!
    const c = at.get("C")!
    const d = (left: { x: number; y: number; z: number }, right: { x: number; y: number; z: number }): number => Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z)
    expect(d(a, b)).toBeCloseTo(8, 9)
    expect(d(b, c)).toBeCloseTo(4, 9)
    const alongAb = { x: b.x - a.x, y: b.y - a.y }
    const alongAc = { x: c.x - a.x, y: c.y - a.y }
    const cosine = (alongAb.x * alongAc.x + alongAb.y * alongAc.y) / (Math.hypot(alongAb.x, alongAb.y) * Math.hypot(alongAc.x, alongAc.y))
    expect((Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI).toBeCloseTo(30, 9)
  })
})
