import { describe, expect, it } from "vitest"

import { FIGURE_INTENT_VERSION, buildFigureIntent } from "./figureIntent"
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
