import { describe, expect, it } from "vitest"

import {
  BENCHMARK_RUN_REQUIRED_FIELDS,
  HUMAN_READABILITY_GROUPS,
  HUMAN_READABILITY_VALUES,
  buildBenchmarkReport,
  type BenchmarkReadability,
  type BenchmarkRun
} from "./report"

/**
 * **人工可读性（计划 N4 第 `:324` 条的最后一项）** —— 报告契约这一半。
 *
 * ## 它在量什么
 *
 * 计划要求报告里记「抽取率 / 求解率 / 题设覆盖率 / `verified`·`unverified`·`no_witness` /
 * 成本 / 延迟 / **人工可读性**」。前六项在 N4/N4b 就位；这一项在本文件里落地：
 * 契约多一个**三值**标注字段 `humanReadability`，报告多一组**标注计数**。
 *
 * ## 口径（写在这里，因为**口径不是实现细节**）
 *
 * - **三值**：`readable` / `partly` / `unreadable`，只问一件事：
 *   「一个不懂实现的人，能不能看懂它打算建什么、依据是什么？」
 * - **判断者是「不懂实现的人」**，不是实现者 —— 所以软件里**必须有地方让人输入**这个判断
 *   （界面上的三值按钮；本文件只负责把标好的值收下、数出来）；
 * - **`not_measured` / `error` 不进分母**：那两种记录**没有对象可读**（没跑 / 跑挂了，
 *   根本没有「模型给的那段东西」）。这与 `premiseCoverage` 在「一条子句都没读到」时报 `null`
 *   而不是 `0` 是同一条纪律：**「没有对象」不能被写成一个数**；
 * - **`plan` 与 `clarification` 不共用分母**：模型在**问**的时候，可读性问的是
 *   「**它的问法清不清楚**」，不是「计划好不好」。合成一个分母会把两件不同的事平均成一个数
 *   —— 这正是本仓在 `planning` 词表上刚踩过一次的那类错（把好行为读成失败）；
 * - **rate 在分母为 0 时是 `null`，不是 `0`**：这里 rate 的分母是**已标注的条数**，
 *   所以「一条都没标」给出的是 `null`。若写成 `readable ÷ 对象数`，没人标注时会算出 `0`，
 *   而那读起来就是「可读性 0 分」—— **「未标注」与「0 分」必须可分辨**（本批做完正是这个状态：
 *   已标注 = 0，报告里该出现的是「未标注」）。
 */

/**
 * 一份合成的 `planning` 轮次。默认可读性是显式的 `null` —— **未标注**，
 * 不是某个缺省值（「没标」与「忘了写」必须能分辨）。
 */
function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    caseId: "case-a",
    provider: "p-eval",
    model: "m-eval",
    seed: 7,
    mode: "real_provider",
    layer: "planning",
    status: "planned",
    evidence: [{ claim: "case-a", status: "planned", evidence: "ok=true；诊断 0 条；可执行动作 1 条" }],
    cost: null,
    latency: { totalMs: 12 },
    humanReadability: null,
    ...overrides
  }
}

/** 一批 `real_provider` 记录的可读性读数（走**真的**报告契约，不自己数一遍）。 */
function readabilityOf(runs: readonly Record<string, unknown>[]): BenchmarkReadability {
  return buildBenchmarkReport([...runs], "N4e 合成记录").realProvider.readability
}

function groupOf(readability: BenchmarkReadability, group: "plan" | "clarification" | "rejected") {
  const found = readability.groups.find((entry) => entry.group === group)
  if (found === undefined) throw new Error(`报告里没有 ${group} 这一组`)
  return found
}

const CLARIFICATION_EVIDENCE = [{ claim: "case-c", status: "clarification", evidence: "模型没给计划，而是在问：请说明底面四边形的形状" }]

describe("人工可读性：词表与字段（计划 N4 :324）", () => {
  it("三值就是 readable / partly / unreadable；分组键就是 plan / clarification / rejected", () => {
    // 词表本身是口径的一部分（「问法清不清楚 ≠ 计划好不好」这条要靠分组键承载）。
    expect([...HUMAN_READABILITY_VALUES]).toEqual(["readable", "partly", "unreadable"])
    expect([...HUMAN_READABILITY_GROUPS]).toEqual(["plan", "clarification", "rejected"])
  })

  it("**`humanReadability` 这个键必须在**（与 cost / latency 同一条纪律：漏写要能被点名）", () => {
    expect([...BENCHMARK_RUN_REQUIRED_FIELDS]).toContain("humanReadability")

    const broken = run()
    delete broken.humanReadability
    // 「忘了写」必须显形为一条**点名字段**的错误，而不是静默变成「未标注」。
    expect(() => buildBenchmarkReport([broken])).toThrow(/humanReadability/)
  })

  it("三个值都能被收下；`null`（= 未标注）也能", () => {
    for (const value of HUMAN_READABILITY_VALUES) {
      const report = buildBenchmarkReport([run({ humanReadability: value })])
      expect(report.realProvider.runs[0]!.humanReadability).toBe(value)
    }
    expect(buildBenchmarkReport([run({ humanReadability: null })]).realProvider.runs[0]!.humanReadability).toBeNull()
  })

  it("词表外的标注值要抛（拼错的值不许被静默当成「未标注」或别的值）", () => {
    expect(() => buildBenchmarkReport([run({ humanReadability: "good" })])).toThrow(/humanReadability/)
    expect(() => buildBenchmarkReport([run({ humanReadability: "" })])).toThrow(/humanReadability/)
    // 也不能拿布尔/数字顶上（`true` 不是「可读」）。
    expect(() => buildBenchmarkReport([run({ humanReadability: true })])).toThrow(/humanReadability/)
  })
})

describe("人工可读性：分母与比率", () => {
  it("**分母只算有对象可读的轮次**：`not_measured` / `error` 不进可读性统计", () => {
    const readability = readabilityOf([
      run({ caseId: "a" }),
      run({ caseId: "b" }),
      run({ caseId: "c", status: "clarification", evidence: CLARIFICATION_EVIDENCE }),
      // 这两条**没有对象可读**：一条什么都没测、一条跑挂了。
      run({ caseId: "d", status: "not_measured", evidence: [], latency: null }),
      run({ caseId: "e", status: "error", evidence: [{ claim: "e", status: "error", evidence: "TypeError: boom" }] })
    ])

    // 5 条记录里只有 3 条有「要读的那段东西」。
    expect(readability.total).toBe(3)
    expect(readability.annotated).toBe(0)
    expect(readability.unannotated).toBe(3)
    expect(groupOf(readability, "plan").total).toBe(2)
    expect(groupOf(readability, "clarification").total).toBe(1)
    // 那两条一个组都不进（进任何一个组都是把分母撑大）。
    expect(readability.groups.reduce((sum, entry) => sum + entry.total, 0)).toBe(3)
  })

  it("**`plan` 与 `clarification` 各有各的分母**（问法清不清楚 ≠ 计划好不好）", () => {
    const readability = readabilityOf([
      run({ caseId: "a", humanReadability: "readable" }),
      run({ caseId: "b", humanReadability: "unreadable" }),
      // 这条澄清**没人标** —— 它不能把 plan 那组的比率拉低。
      run({ caseId: "c", status: "clarification", evidence: CLARIFICATION_EVIDENCE })
    ])

    const plan = groupOf(readability, "plan")
    const clarification = groupOf(readability, "clarification")
    expect([plan.total, plan.annotated, plan.unannotated]).toEqual([2, 2, 0])
    expect([clarification.total, clarification.annotated, clarification.unannotated]).toEqual([1, 0, 1])
    // 若两个组共用一个分母，这里会算成 1/3（分子 1、分母 3 条对象）；各自算才是 1/2。
    expect(plan.readableRate).toBe(0.5)
    expect(plan.readableRate).not.toBeCloseTo(1 / 3)
    // 一条都没标的那一组：分母是 0 ⇒ 比率是 `null`（不是 0，也不是拿别人的标注算出来的数）。
    expect(clarification.readableRate).toBeNull()
  })

  it("**这一版做完「已标注」就是 0**：比率是 `null` 而不是 `0`（「未标注」与「0 分」必须可分辨）", () => {
    const readability = readabilityOf([run({ caseId: "a" }), run({ caseId: "b" }), run({ caseId: "c" })])

    expect(readability.annotated).toBe(0)
    expect(readability.unannotated).toBe(3)
    for (const entry of readability.groups) {
      expect(entry.readableRate).toBeNull()
      expect(entry.byValue).toEqual({ readable: 0, partly: 0, unreadable: 0 })
    }
  })

  it("各自几比几：三种值各自的条数都数出来，比率只拿 `readable` 当分子", () => {
    const readability = readabilityOf([
      run({ caseId: "a", humanReadability: "readable" }),
      run({ caseId: "b", humanReadability: "partly" }),
      run({ caseId: "c", humanReadability: "partly" })
    ])

    const plan = groupOf(readability, "plan")
    expect(plan.byValue).toEqual({ readable: 1, partly: 2, unreadable: 0 })
    expect(plan.readableRate).toBeCloseTo(1 / 3)
    expect([readability.annotated, readability.unannotated]).toEqual([3, 0])
  })

  it("三组**恒在**（顺序固定），没有轮次的组是 `total 0 / rate null`，不折叠", () => {
    // 「这一组没有轮次」与「这一组还没人标」是两件事；折叠掉空组会让两者长得一样
    //（与 `premiseCoverage` 在 total 为 0 时仍报 `{0, 0, null}` 同一条纪律）。
    const empty = buildBenchmarkReport([]).deterministicLocal.readability

    expect(empty.groups.map((entry) => entry.group)).toEqual([...HUMAN_READABILITY_GROUPS])
    expect(empty.total).toBe(0)
    for (const entry of empty.groups) {
      expect(entry).toMatchObject({ total: 0, annotated: 0, unannotated: 0, readableRate: null })
    }
  })

  it("**只有 `planning` 层有「要读的那段东西」**：见证层的同名 `clarification` 不进可读性分母", () => {
    /**
     * 见证层的词表里**也有** `clarification`（`BENCHMARK_STATUSES_BY_LAYER.witness`）。
     * 若分组只看 `status`，那条记录会被算进「问法清不清楚」的分母里 —— 而它根本没有模型
     * 给出的正文（CLI 那一路不经过任何模型）。所以分组必须**同时**看层。
     */
    const witness: Record<string, unknown> = {
      caseId: "w",
      provider: null,
      model: null,
      seed: 7,
      mode: "deterministic_local",
      layer: "witness",
      status: "clarification",
      evidence: [{ claim: "w", status: "clarification", evidence: "证据不足，需要用户确认" }],
      cost: null,
      latency: null,
      humanReadability: null
    }
    const readability = buildBenchmarkReport([witness]).deterministicLocal.readability

    expect(readability.total).toBe(0)
    expect(groupOf(readability, "clarification").total).toBe(0)
  })

  it("`humanReadability` 是记录上的**一个字段**：标了它，其余读数一个字不动", () => {
    const before = buildBenchmarkReport([run({ caseId: "a" })])
    const after = buildBenchmarkReport([run({ caseId: "a", humanReadability: "readable" })])

    expect(after.realProvider.byStatus).toEqual(before.realProvider.byStatus)
    expect(after.realProvider.measured).toBe(before.realProvider.measured)
    expect(after.realProvider.extractionRate).toEqual(before.realProvider.extractionRate)
  })
})

/** 编译期钉子：`BenchmarkRun` 上这个字段是**必需的键 + 可 null 的值**（不是可选键）。 */
const _keyIsRequired: BenchmarkRun = {
  caseId: "x",
  provider: null,
  model: null,
  seed: 7,
  mode: "deterministic_local",
  layer: "extraction",
  status: "extracted",
  evidence: [{ claim: "x", status: "extracted", evidence: "一条子句" }],
  cost: null,
  latency: null,
  humanReadability: null
}
void _keyIsRequired
