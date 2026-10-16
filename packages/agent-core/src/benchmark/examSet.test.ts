import { describe, expect, it } from "vitest"

import { assertExamSet, checkExamSet, EXAM_SOURCE_LEVELS, EXAM_CASES, HELD_OUT_CASES, judgeAgainstOracle, verifiedGoldCaseIds, type ExamCase } from "./examSet"

/**
 * **Task 9（2026-10-12）：真题离线评测工件 —— 两条守卫，先红后绿。**
 *
 * 调研（[`2026-10-11-four-family-exam-diagram-survey.md`](../../../docs/research/2026-10-11-four-family-exam-diagram-survey.md)）
 * 已经把四家族真题的作图需求归纳完，并在 §3.5 写明一句**约束**：
 * "上述来源完成了**题型需求调研**，目前并没有逐题建立有独立答案复核、使用许可、录入哈希、
 * 预期图证据的正式高考金标准。因此仓库既有 `verifiedGoldCaseIds: []` 的事实不变。"
 *
 * 所以这一层要挡的正是"把调研当成金标"的两条**静默**路径：
 * ① **转载方给的答案被当成 oracle** —— §1 对 2021 新高考Ⅰ卷的原话是"含解答但发布方为转载；
 *    按 A 的题面证据使用，**不当作独立答案来源**"；
 * ② **同一道原题的变式同时进了开发集与留出集** —— §3.4"真题开发样本与留出样本要隔离"。
 *
 * 两条都不会让程序崩：它们只会让评测**看起来合格**。所以判据必须是显式的、可执行的。
 */
function caseWith(overrides: Partial<ExamCase> = {}): ExamCase {
  const base: ExamCase = {
    id: "probe",
    family: "triangle",
    promptKind: "survey-summary",
    prompt: "在三角形ABC中，AB=8，AC=6，∠A=60°，画示意图",
    sourceRef: "https://example.invalid/fixture（用例夹具，不是真实来源页）",
    provenance: { paper: "2021 新高考Ⅰ卷", number: "19", sourceLevel: "A", inputLicence: "题面转载（A 级证据）", answerIndependentlyReviewed: false },
    requiredFigure: "三角形 ABC 与边角标注"
  }
  return { ...base, ...overrides }
}

describe("Task 9 — 真题评测集的两条守卫", () => {
  it("refuses to let a reprint's answer stand in as an oracle", () => {
    // 转载方**给了**解答，但那不是独立复核过的答案（调研 §1）。
    const problem = checkExamSet([caseWith({ oracle: ["|AB| = 8"] })], [])

    expect(problem.map((entry) => entry.code)).toContain("oracle_without_review")
    // 说清是哪一条题、为什么。
    const finding = problem.find((entry) => entry.code === "oracle_without_review")!
    expect(finding.detail).toContain("probe")
  })

  it("accepts an oracle only once the answer has been independently reviewed", () => {
    const reviewed = caseWith({
      provenance: { paper: "2021 新高考Ⅰ卷", number: "19", sourceLevel: "A", inputLicence: "题面转载（A 级证据）", answerIndependentlyReviewed: true },
      oracle: ["|AB| = 8"]
    })

    expect(checkExamSet([reviewed], []).filter((entry) => entry.code === "oracle_without_review")).toEqual([])
  })

  it("refuses a held-out item that is a variant of a development item", () => {
    // 同一道原题（卷别 + 题号）**换了个说法**进了留出集 —— 换名字、换常数都还是同一题。
    const dev = [caseWith({ id: "dev-a" })]
    const leaked = [caseWith({ id: "held-a", prompt: "在三角形ABC中，AB=7，AC=5，∠A=60°，画示意图" })]

    const problem = checkExamSet(dev, leaked)

    expect(problem.map((entry) => entry.code)).toContain("held_out_leakage")
    expect(problem.find((entry) => entry.code === "held_out_leakage")!.detail).toContain("2021 新高考Ⅰ卷")
  })

  it("keeps a genuine held-out question (a different paper and number) separate", () => {
    const dev = [caseWith({ id: "dev-a" })]
    const heldOut = [caseWith({ id: "held-b", provenance: { paper: "2022 新高考Ⅰ卷", number: "21", sourceLevel: "A", inputLicence: "卷面转载（A 级证据）", answerIndependentlyReviewed: false } })]

    expect(checkExamSet(dev, heldOut)).toEqual([])
  })

  it("rejects a malformed provenance instead of silently accepting it as evidence", () => {
    const problems = checkExamSet([
      caseWith({ id: "bad-level", provenance: { paper: "2021 新高考Ⅰ卷", number: "19", sourceLevel: "Z" as never, inputLicence: "", answerIndependentlyReviewed: false } }),
      caseWith({ id: "no-paper", provenance: { paper: "  ", number: "19", sourceLevel: "A", inputLicence: "x", answerIndependentlyReviewed: false } })
    ], [])

    expect(problems.map((entry) => entry.code)).toContain("missing_provenance")
    expect(problems.map((entry) => entry.detail).join(" ")).toContain("bad-level")
    expect(problems.map((entry) => entry.detail).join(" ")).toContain("no-paper")
  })

  it("throws once, listing every problem, instead of returning a half-valid set", () => {
    // 与 `dataset.ts` 同一条纪律：题集是**喂给评测的输入**，不能"跑一半、悄悄少几道题"。
    expect(() => assertExamSet([caseWith({ oracle: ["x"] })], [caseWith({ id: "held" })])).toThrow(/held_out_leakage|oracle_without_review/)
  })

  it("ships the real exam cases with source anchors, and keeps verifiedGoldCaseIds empty", () => {
    // ① 随仓走的那份题集**每条都带来源锚点**（卷别 / 题号 / 等级 / 许可）。
    const problems = checkExamSet(EXAM_CASES, HELD_OUT_CASES)
    expect(problems, JSON.stringify(problems)).toEqual([])
    expect(EXAM_CASES.length).toBeGreaterThan(0)
    for (const entry of EXAM_CASES) {
      expect(EXAM_SOURCE_LEVELS).toContain(entry.provenance.sourceLevel)
      expect(entry.provenance.paper.length).toBeGreaterThan(0)
      expect(entry.provenance.number.length).toBeGreaterThan(0)
    }
    // ② 四家族都至少有一条（调研的四族需求，不是只挑一族）。
    expect(new Set(EXAM_CASES.map((entry) => entry.family))).toEqual(new Set(["triangle", "conic", "function", "solid"]))
    /**
     * ③ **`verifiedGoldCaseIds` 仍然是空的** —— 调研 §3.5 的结论原文：
     * 目前没有逐题建立独立答案复核的金标准。这一条**不是**"暂时留空"，
     * 而是"还没有任何一条够格"。谁要往里加 id，得先拿出独立复核过的答案。
     */
    expect(verifiedGoldCaseIds).toEqual([])
  })
})

/**
 * **退出条件之一："错图 oracle 会拒绝"。**
 *
 * 这条**不是**"oracle 存在就算数"，而是"它真的有牙"：拿一组实测读数去判，
 * 超出容差就不许通过。另一半同样重要 —— **没有独立复核过答案的题，连判都不许判**：
 * 那正是"转载方的答案不能充金标"最彻底的形式（连一个"通过"都不该由它发出）。
 */
describe("Task 9 — 错图必须被 oracle 拒掉；没复核过的题不许判任何东西", () => {
  const reviewed = caseWith({
    provenance: { paper: "2021 新高考Ⅰ卷", number: "19", sourceLevel: "A", inputLicence: "题面转载", answerIndependentlyReviewed: true },
    oracle: ["|AB| = 8", "∠DAC = 90°"]
  })

  it("rejects a figure that does not satisfy the independently reviewed conditions", () => {
    const verdict = judgeAgainstOracle(reviewed, [
      { condition: "|AB|", measured: 4, expected: 8, tolerance: 1e-9 },
      { condition: "∠DAC", measured: 90, expected: 90, tolerance: 1e-9 }
    ])

    expect(verdict.accepted).toBe(false)
    expect(verdict.failed.map((entry) => entry.condition)).toEqual(["|AB|"])
  })

  it("accepts a figure that does satisfy them", () => {
    const verdict = judgeAgainstOracle(reviewed, [
      { condition: "|AB|", measured: 8, expected: 8, tolerance: 1e-9 },
      { condition: "∠DAC", measured: 90, expected: 90, tolerance: 1e-9 }
    ])

    expect(verdict.accepted).toBe(true)
    expect(verdict.failed).toEqual([])
  })

  it("rejects a reviewed oracle when a required condition has no measurement", () => {
    const verdict = judgeAgainstOracle(reviewed, [
      { condition: "|AB|", measured: 8, expected: 8, tolerance: 1e-9 }
    ])

    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toBe("condition_failed")
    expect(verdict.failed).toHaveLength(1)
  })

  it("rejects empty measurements and reports every missing condition", () => {
    const verdict = judgeAgainstOracle(reviewed, [])
    expect(verdict.accepted).toBe(false)
    expect(verdict.failed.map(check => check.status)).toEqual(["missing", "missing"])
  })

  it("rejects duplicate measurements even when the count matches the oracle", () => {
    const check = { condition: "|AB|", measured: 8, expected: 8, tolerance: 1e-9 }
    const verdict = judgeAgainstOracle(reviewed, [check, check])
    expect(verdict.accepted).toBe(false)
    expect(verdict.failed.map(check => check.status)).toEqual(["unexpected", "missing"])
  })

  it("rejects extra measurements instead of silently ignoring them", () => {
    const single = { ...reviewed, oracle: ["|AB| = 8"] }
    const check = { condition: "|AB|", measured: 8, expected: 8, tolerance: 1e-9 }
    expect(judgeAgainstOracle(single, [check, check]).accepted).toBe(false)
  })

  it("does not treat an empty reviewed oracle as a gold case", () => {
    expect(judgeAgainstOracle({ ...reviewed, oracle: [] }, []).reason).toBe("not_a_gold_case")
  })

  it.each([
    { measured: Infinity, expected: 8, tolerance: Infinity },
    { measured: 8, expected: 4, tolerance: Infinity },
    { measured: 8, expected: 8, tolerance: -1 },
    { measured: 8, expected: 8, tolerance: 1e-9, status: "missing" as const }
  ])("rejects invalid measurement contracts: %j", values => {
    const single = { ...reviewed, oracle: ["|AB| = 8"] }
    expect(judgeAgainstOracle(single, [{ condition: "|AB|", ...values }]).accepted).toBe(false)
  })

  it("refuses to judge at all when the answer was never independently reviewed", () => {
    // 同一个"图是对的"读数，换到一条**没复核过**的题上 —— 不许它发出"通过"。
    const unreviewed = caseWith({ oracle: ["|AB| = 8"] })
    const verdict = judgeAgainstOracle(unreviewed, [{ condition: "|AB|", measured: 8, expected: 8, tolerance: 1e-9 }])

    expect(verdict.accepted).toBe(false)
    expect(verdict.reason).toBe("not_a_gold_case")
  })

  it("is deterministic, so the offline artifact can be re-run", () => {
    const first = checkExamSet(EXAM_CASES, HELD_OUT_CASES)
    const second = checkExamSet(EXAM_CASES, HELD_OUT_CASES)
    expect(second).toEqual(first)
  })
})
