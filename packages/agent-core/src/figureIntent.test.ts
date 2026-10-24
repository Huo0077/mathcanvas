import { describe, expect, it } from "vitest"

import { FIGURE_INTENT_VERSION, buildFigureIntent, readFoldTransformations } from "./figureIntent"
import { parseObligationWithLegacy } from "./obligationIR"

/**
 * **Task 6（2026-10-12）：来源可追溯的四族图形意图。**
 *
 * 这一层要回答的问题只有一个：**"图上应该有什么"这件事，能不能不带任何坐标地说清楚，
 * 而且每一句都能追回用户原话里的那一段？**
 *
 * 计划 Global Constraints 的原话是"坐标由构造器决定"，而可追溯性在本仓有一条**可被程序核验**的形式
 *（`claimEvidence.ts` 写着）：`sourceText` 必须等于 `prompt.slice(start, end)`。
 * 断言就照这一条写 —— 不靠"看着差不多"。
 *
 * 夹具用**计划 §3 那句原题**（八条能读懂的条件）与仓里既有的"读不懂"样本 `sin∠PAB=0.5`（第九条）。
 * 不写死"恰好八条"：条数由解析器决定，这里钉的是**解析器给出几条、意图里就有几条且一一对应**
 *（写死数字会让这条判据在解析器改进时变成假红）。
 */
const PROMPT = "四边形 ABCD，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3；E/F 在边上定比分；AEF 沿 EF 翻至 PEF 且 PC=4√3"

/** 第九条：解析器读不出来的残留（与 `witnessSearch.test.ts` 用的是同一个"读不懂"样本）。 */
const NINTH = "，sin∠PAB=0.5"

describe("Task 6 — 来源可追溯的图形意图", () => {
  it("keeps one clause per parsed condition, with the same id, the same原文 span and the same点名", () => {
    const parsed = parseObligationWithLegacy(PROMPT)
    const intent = buildFigureIntent({ prompt: PROMPT, ir: parsed.ir, family: "solid" })

    expect(intent.version).toBe(FIGURE_INTENT_VERSION)
    expect(intent.family).toBe("solid")
    // 解析器给出几条，意图里就有几条 —— 一一对应，不增不减。
    expect(intent.clauses).toHaveLength(parsed.ir.obligations.length)
    /**
     * **这条钉的是"§3 那句转述读出几条"，不是"用户原话读出几条"**（2026-10-12 定因）。
     *
     * 上面的 `PROMPT` 逐字就是**计划 §3 的那句转述** —— 它把定比分点写成"E/F 在边上定比分"，
     * **没有那两个显式比例**，所以这里读出 **6** 条（五条四边形条件 + `PC=4√3`）。
     *
     * **用户原话读出 8 条**，而且这件事早有判据钉着：`diagramObligations.test.ts` 的
     * "reads both radicals and both colon ratios from the real user sentence" 用的就是那句原话
     * （与 `e2e/agent-exam-solid.spec.ts:20-24` 逐字相同），断言 `givens` 恰好是那 8 条；
     * 端到端那半由同一条 e2e 的面板断言钉住。**8 − 6 = 那两条比例。**
     *
     * ⚠️ **还有一个同名但不同源的 6，别读混**：`current-status.md` 里记的"第 11 轮实测 6 条"
     * 是拿**原话**测的，当时 Task 10 还没修好"部分比整体"的写法 ⇒ 那两条比读不出来。
     * **两个 6 是两回事**：这里是"转述缺信息"，那里是"解析器当时读不出"。今天原话读出 8。
     *
     * 所以这条**不**把 6 当真理：它钉的是"这句转述今天读出几条"。谁把 `PROMPT` 换成原话，
     * 这条就该跟着变成 8 —— 那时要回答的是"为什么换"，不是把数字改掉。
     */
    expect(intent.clauses).toHaveLength(6)
    expect(intent.unverified).toHaveLength(0)

    for (const [index, clause] of intent.clauses.entries()) {
      const obligation = parsed.ir.obligations[index]
      // ① **条件 ID 是同一条**（跨层要能对上同一个东西）。
      expect(clause.clauseId).toBe(obligation.id)
      // ② **原文片段位置**：`sourceText` 必须等于 `prompt.slice(start, end)`。
      expect(clause.span.sourceText).toBe(PROMPT.slice(clause.span.start, clause.span.end))
      expect(clause.span.sourceText).toBe(obligation.sourceText)
      // ③ **点名**原样带过来。
      expect(clause.refs).toEqual(obligation.targets)
      // 每一条都有自己的 kind（构造器据此决定拿哪种几何去解）。
      expect(clause.kind.length).toBeGreaterThan(0)
    }

    /**
     * **命名对象只到"点名"这一层**：每个名字都必须出现在某条条件的点名列里。
     * 拓扑（哪几个点连成一个面、哪只实体是闭合的）由 Task 7 的物化决定 ——
     * 这一层**不猜**，猜出来的拓扑会让下游把一只开放图形当成闭合实体。
     */
    const named = new Set(intent.objects.filter((object) => object.kind === "point").map((object) => object.name))
    for (const clause of intent.clauses) {
      for (const ref of clause.refs) expect(named.has(ref), `${ref} 不在命名对象里`).toBe(true)
    }
  })

  it("keeps an unreadable ninth clause as a traceable residue instead of dropping it", () => {
    const withNinth = PROMPT + NINTH
    const before = buildFigureIntent({ prompt: PROMPT, ir: parseObligationWithLegacy(PROMPT).ir, family: "solid" })
    const after = buildFigureIntent({ prompt: withNinth, ir: parseObligationWithLegacy(withNinth).ir, family: "solid" })

    // ① 能读懂的那几条**一条都没变**（同一个 id、同一段原文）—— 第九条不许把前面的挤掉。
    expect(after.clauses.map((clause) => [clause.clauseId, clause.span.sourceText]))
      .toEqual(before.clauses.map((clause) => [clause.clauseId, clause.span.sourceText]))
    // ② 第九条如实留在残留里，而且**指得出它在原话里的位置**。
    expect(after.unverified).toHaveLength(before.unverified.length + 1)
    const residue = after.unverified.at(-1)!
    expect(residue.sourceText).toContain("sin")
    expect(residue.span).not.toBeNull()
    expect(withNinth.slice(residue.span!.start, residue.span!.end)).toBe(residue.sourceText)
  })

  it("does not let model-supplied relations rewrite or weaken the parsed clause set", () => {
    const parsed = parseObligationWithLegacy(PROMPT)
    const plain = buildFigureIntent({ prompt: PROMPT, ir: parsed.ir, family: "solid" })
    /**
     * **模型自报的 relations 只能进 `relations`，一个字都不许改 `clauses`。**
     * 这正是 `GeometryObligation` 那段注释的判据："模型自报的 relations **不能**取代这份原话清单"。
     * 所以这里故意塞一条**与题面无关**的关系，看它能不能把任何一条条件挤掉或改弱。
     */
    const withModelRelations = buildFigureIntent({
      prompt: PROMPT,
      ir: parsed.ir,
      family: "solid",
      relations: [{ sourceClauseId: "made-up", kind: "perpendicular", refs: ["A", "B"] }]
    })

    expect(withModelRelations.clauses).toEqual(plain.clauses)
    // 而且**来源追不回原句**的那一条不许被当成"来自原题"。
    expect(withModelRelations.relations[0].sourceClauseId).toBe("made-up")
    expect(plain.clauses.some((clause) => clause.clauseId === "made-up")).toBe(false)
  })
})

/**
 * **T4（2026-10-24）：翻折句式的点名语法**
 *
 * 执行任务书 §2 的 E6 给出了六种真实写法，旧读取器只认前两种。这一组钉住：
 * ① 六种写法里语义明确的都要产出**等价结构**（`fold` / `rotate` 分开记）；
 * ② 点名支持撇号与下标（`A′`、`A₁`），不再用 `[A-Z]{3}` 当代名；
 * ③ 折痕对不上、或只说了"翻折"没说折到哪儿的，**不猜**；
 * ④ 连续两折读成两条，顺序与出现顺序一致（T6 的读取层前提）。
 */
describe("T4 — reading fold phrasing", () => {
  it("reads the delta and word forms identically", () => {
    const word = readFoldTransformations("将三角形AEF沿EF翻折至三角形PEF")
    const delta = readFoldTransformations("将△AEF沿EF翻折至△PEF")

    expect(word).toHaveLength(1)
    // `sourceText` 是逐字片段，两种写法本来就不同；比较的是**结构**。
    const shape = (fold: { face: string; hinge: { from: string; to: string }; apex: string; apexAs: string }) =>
      ({ face: fold.face, hinge: fold.hinge, apex: fold.apex, apexAs: fold.apexAs })
    expect(delta.map(shape)).toEqual(word.map(shape))
    expect(delta[0]).toMatchObject({ kind: "fold", face: "AEF", hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P" })
  })

  it("reads 折叠 as the same fold as 翻折", () => {
    const folds = readFoldTransformations("将△AEF沿EF折叠至△PEF")

    expect(folds).toHaveLength(1)
    expect(folds[0]).toMatchObject({ face: "AEF", apex: "A", apexAs: "P" })
  })

  it("reads the 使点 A 到达点 P phrasing", () => {
    const folds = readFoldTransformations("将△AEF沿EF翻折，使点A到达点P，且PC=4√3")

    expect(folds).toHaveLength(1)
    expect(folds[0]).toMatchObject({ face: "AEF", hinge: { from: "E", to: "F" }, apex: "A", apexAs: "P" })
  })

  it("keeps 绕边旋转 as its own motion instead of silently calling it a fold", () => {
    const rotations = readFoldTransformations("将△ABC绕BC旋转到△PBC")

    expect(rotations).toHaveLength(1)
    expect(rotations[0]).toMatchObject({ motion: "rotate", face: "ABC", hinge: { from: "B", to: "C" }, apex: "A", apexAs: "P" })
  })

  it("reads primed point names (A′BC) instead of stopping at [A-Z]{3}", () => {
    const folds = readFoldTransformations("将△ABC沿BC翻折至△A′BC")

    expect(folds).toHaveLength(1)
    expect(folds[0]).toMatchObject({ face: "ABC", apex: "A", apexAs: "A′" })
  })

  it("reads subscript point names and spacing/punctuation variants", () => {
    const folds = readFoldTransformations("将 △A₁E₁F₁ 沿 E₁F₁ 翻折至 △P₁E₁F₁。")

    expect(folds).toHaveLength(1)
    expect(folds[0]).toMatchObject({ face: "A₁E₁F₁", apex: "A₁", apexAs: "P₁" })
  })

  it("refuses when the hinge is not on the moving face, instead of guessing", () => {
    expect(readFoldTransformations("将△AEF沿BD翻折至△PEF")).toEqual([])
  })

  it("refuses a fold with no target: the moved point is unknown", () => {
    expect(readFoldTransformations("将△AEF沿EF翻折，使点A落到平面内")).toEqual([])
  })

  it("reads two sequential folds in the order they appear", () => {
    // 第二次折的是**第一次折后的那张面**（△PEF），折痕 PF 在它上面 —— 这是真的连续折叠。
    const folds = readFoldTransformations("先将△AEF沿EF翻折至△PEF，再将△PEF沿PF折叠至△QPF")

    expect(folds.map((fold) => [fold.face, fold.apex, fold.apexAs])).toEqual([["AEF", "A", "P"], ["PEF", "E", "Q"]])
  })
})
