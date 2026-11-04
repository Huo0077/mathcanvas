/**
 * **11 月 5 日四道立体几何题：阶段集成测试**（实施计划 T1 起的持续护栏）。
 *
 * 见 [实施计划](../../../../docs/superpowers/plans/2026-11-05-solid-geometry-four-cases.md) §3 T1。
 *
 * ## 这份文件怎么读
 *
 * 它把每一道题跑过**同一条产品链路**：`parseObligationWithLegacy → specForPrompt → searchWitness`
 * （`searchWitness` 内部走 `compilePlan` + `verifyDiagramObligations`），然后把**每一阶段**的实况
 * 打出来。一个失败消息里就能看出"卡在哪一层"，而不是只有一句"画不出来"。
 *
 * ## T1 的断言是"特征化基线"（characterization），不是验收
 *
 * 本轮只建立**可重复的基线**：断言的是**今天的实况**（哪一层通过、哪一层怎么失败的），
 * 目的是让 T2–T7 的每一刀都知道自己在改哪一格。
 *
 * **这份文件里所有"实况 = 缺口"的断言都会在对应任务里被替换成目标断言**（RED → GREEN）：
 * T2 换 Case 2 / Case 4 的入口、T3 换 Case 1 的底面、T4 换 Case 3 的垂足、T5 换点名分点、
 * T6 换翻折、T7 换目标证据。**最终验收时本文件不得残留任何"预期失败"的断言**
 * （计划 §Global Constraints：不得把断言永久改成预期报错来让测试变绿）。
 */

import { describe, expect, it } from "vitest"

import { parseObligationWithLegacy } from "./obligationIR"
import { searchWitness, specForPrompt } from "./solver/witnessSearch"
import {
  CASE_1,
  CASE_2,
  CASE_3,
  CASE_4_ORIGINAL,
  CASE_4_REVISED,
  ORIGINAL_CASES,
  REVISED_CASES,
  type SolidGeometryCase
} from "./fixtures/solidGeometryFourCases"

const MAX_CANDIDATES = 16
const TIMEOUT_MS = 10_000

/** 一条链路走完之后的逐阶段读数（**只描述实况，不含期望**）。 */
interface CaseStageReport {
  id: string
  parse: {
    givens: number
    /** 每条 `given` 的 `kind`，按题面顺序 —— 用来看"哪一句没进题设"。 */
    kinds: string[]
    unverified: { sourceText: string; reason: string }[]
  }
  shape:
    | { status: "ok"; family: string; base: string[]; apex: string | null; top: string[] | null; freeScalars: string[] }
    | { status: "unrecognised"; reason: string }
  search: { status: string; detail: string[] }
}

/** 跑一道题，把每个阶段的结果收集成一份读数。**不猜、不修、不吞异常。** */
function stagesOf(entry: SolidGeometryCase): CaseStageReport {
  const parsed = parseObligationWithLegacy(entry.prompt)
  const givens = parsed.ir.obligations.filter((obligation) => obligation.role === "given")
  const shaped = specForPrompt(entry.prompt, givens)
  const report: CaseStageReport = {
    id: entry.id,
    parse: {
      givens: givens.length,
      kinds: givens.map((obligation) => obligation.kind),
      unverified: parsed.ir.unverified.map((item) => ({ sourceText: item.sourceText, reason: item.reason }))
    },
    shape:
      shaped.status === "ok"
        ? {
            status: "ok",
            family: shaped.recognised.family,
            base: [...shaped.spec.base],
            apex: shaped.spec.apex?.at ?? null,
            top: shaped.spec.top === undefined ? null : [...shaped.spec.top],
            freeScalars: shaped.spec.freeScalars.map((scalar) => scalar.id)
          }
        : { status: "unrecognised", reason: shaped.reason },
    search: { status: "not-run", detail: ["形状描述没有成立，搜索层不会开始。"] }
  }
  if (shaped.status !== "ok") return report
  const searched = searchWitness({
    obligations: parsed.ir,
    shape: shaped.recognised.family,
    spec: shaped.spec,
    seed: 1,
    maxCandidates: MAX_CANDIDATES,
    timeoutMs: TIMEOUT_MS
  })
  const detail: string[] =
    searched.status === "verified_instance"
      ? [`names=${searched.candidate.names.join(",")}`]
      : searched.status === "no_witness"
        ? [...searched.failures]
        : [...searched.reasons]
  report.search = { status: searched.status, detail }
  return report
}

/** 失败消息里带上"卡在哪一层"，省得再手跑一遍。 */
function summary(report: CaseStageReport): string {
  return [
    `${report.id}`,
    `  解析：givens=${report.parse.givens}，残留=${report.parse.unverified.length}`,
    `  形状：${report.shape.status === "ok" ? `ok family=${report.shape.family} base=${report.shape.base.join("")}` : `unrecognised —— ${report.shape.reason}`}`,
    `  搜索：${report.search.status}`,
    ...report.search.detail.map((line) => `    ${line}`)
  ].join("\n")
}

describe("11-05 四道立体几何题：阶段基线（T1）", () => {
  const original = new Map(ORIGINAL_CASES.map((entry) => [entry.id, stagesOf(entry)]))
  const revised = new Map(REVISED_CASES.map((entry) => [entry.id, stagesOf(entry)]))

  it("Case 1：解析与形状已成立，卡在『点 E 没有落地』这一层", () => {
    const report = original.get(CASE_1.id)!
    /** 连等式 `PA=AB=AD=2` 已经被展开成三条定长 + 两条等长（T2 只需加回归，不重复实现）。 */
    expect(report.parse.givens, summary(report)).toBe(10)
    expect(report.parse.unverified, summary(report)).toEqual([])
    expect(report.shape.status, summary(report)).toBe("ok")
    if (report.shape.status !== "ok") return
    expect(report.shape.base).toEqual(["A", "B", "C", "D"])
    expect(report.shape.apex).toBe("P")
    /**
     * **缺口在点名点 `E`**：底面环与顶点都在，可是"E 为 PB 中点"这一条要求图上有 `E` ——
     * 搜索层能造出 A/B/C/D/P，却没有把 `E` 绑到 `PB` 上的出口（T5）。
     * 也就是说 Case 1 的失败**不是底面几何**，而是"命名分点没有落地"。
     */
    expect(report.search.status, summary(report)).toBe("unverified_instance")
    expect(report.search.detail.join("\n"), summary(report)).toContain("E为棱PB的中点")
    expect(report.search.detail.join("\n"), summary(report)).toContain("点名缺失：E")
  })

  it("Case 2：解析已成立，卡在 `A₁` 这类棱柱顶面点名（入口层不认）", () => {
    const report = original.get(CASE_2.id)!
    expect(report.parse.givens, summary(report)).toBe(5)
    expect(report.parse.kinds).toEqual(["fixedLength", "fixedLength", "midpoint", "pointOnSegment", "fixedLength"])
    expect(report.parse.unverified, summary(report)).toEqual([])
    /**
     * **缺口在入口层的顶环对应**：`A₁` 与内核顶面命名约定 `A′` 不是同一个字形。
     * 题面写的是 `A₁`，而 `shapeGrammar` 用 `canonicalPointName(base) + "′"` 去比 ——
     * 于是整句形状从句返回 `null`。T2 要按"同一个下标"认出来并**保留题面原名**。
     */
    expect(report.shape.status, summary(report)).toBe("unrecognised")
    expect(report.search.status, summary(report)).toBe("not-run")
  })

  it("Case 3：卡在垂足 O 不是底面环顶点（且解析器读不出菱形/交点两句）", () => {
    const report = original.get(CASE_3.id)!
    expect(report.parse.givens, summary(report)).toBe(4)
    /**
     * **两条残留**：「AC 与 BD 相交于点 O」与「底面 ABCD 是边长为 2 的菱形」。
     * 它们必须显形（不是静默丢掉），T2/T4 才谈得上"读全"。
     */
    expect(report.parse.unverified.map((item) => item.sourceText), summary(report)).toEqual([
      "AC与BD相交于点O",
      "底面ABCD是边长为2的菱形"
    ])
    expect(report.shape.status, summary(report)).toBe("unrecognised")
    expect(report.shape.status === "unrecognised" ? report.shape.reason : "", summary(report)).toContain(
      "两个端点都不在所点名的平面内"
    )
  })

  it("Case 4 原题：入口层认不出『直角梯形』，正确结局应是澄清而不是断言", () => {
    const report = original.get(CASE_4_ORIGINAL.id)!
    expect(report.parse.givens, summary(report)).toBe(8)
    /** `AD=CD=1` 的连等式同样已展开；两条长度都在。 */
    expect(report.parse.kinds.filter((kind) => kind === "fixedLength")).toHaveLength(3)
    expect(report.shape.status, summary(report)).toBe("unrecognised")
    expect(report.search.status, summary(report)).toBe("not-run")
    /** 原题**必须**带着歧义说明；没有这一句就不许说"题面读全了"。 */
    expect(CASE_4_ORIGINAL.ambiguity, "原题必须保留 D→P 与 CD 折前/折后的歧义说明").not.toBeNull()
  })

  it("Case 4 修订版：与原题是不同的固定题面（不覆盖原题）", () => {
    const report = revised.get(CASE_4_REVISED.id)!
    expect(report.parse.givens, summary(report)).toBe(8)
    expect(report.shape.status, summary(report)).toBe("unrecognised")
    /** 修订版与原文**不是**同一段题面：`D→P` 与 `CD 指折前` 都写进去了。 */
    expect(CASE_4_REVISED.prompt).not.toBe(CASE_4_ORIGINAL.prompt)
    expect(CASE_4_REVISED.prompt).toContain("固定A、C")
    expect(CASE_4_REVISED.prompt).toContain("指折前")
    expect(CASE_4_REVISED.ambiguity).toBeNull()
  })

  it("四题的独立 oracle 是手抄坐标，且不满足『用实现生成期望值』（自检）", () => {
    /** 坐标数量与点名必须自洽：参考图里有几个点，goals 就必须有来源说明。 */
    for (const entry of [...ORIGINAL_CASES, ...REVISED_CASES]) {
      const names = Object.keys(entry.reference.points)
      expect(names.length, entry.id).toBeGreaterThan(0)
      for (const goal of entry.reference.goals) {
        expect(goal.statement.length, `${entry.id} 的目标缺少说明`).toBeGreaterThan(0)
      }
    }
    /**
     * **Case 1/2 的第一个待证结论是假的**（设计 §3）：这条 oracle 与"必须证出来"的直觉相反，
     * 所以单独钉住 —— 谁把实现改成"硬证出垂直"，这里就会说话。
     */
    expect(CASE_1.reference.goals[0]?.holds).toBe(false)
    expect(CASE_2.reference.goals[0]?.holds).toBe(false)
  })
})
