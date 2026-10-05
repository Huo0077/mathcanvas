import { BENCHMARK_CASES_JSONL, buildBenchmarkReport, EXTRACTION_RESIDUE_STATUS, MAX_ROUNDS_PER_CASE, parseBenchmarkDataset, parseObligationIR, searchWitnessForPrompt, type BenchmarkRun, type BenchmarkRunStatus } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

/**
 * **benchmark 真正的运行入口**（实施计划 N4）。
 *
 * 它写成 `.test.ts` 而不是 `.mjs`：只有 vitest 能 import 工作区的 TS 源码
 *（`@draw/agent-core` 的 `exports` 直接指向 `./src/index.ts`），
 * 而 `runner.mjs` 只负责把命令接上来、把退出码传出去（与 `scripts/agent-eval.mjs` 同一条纪律）。
 *
 * ## 这一轮**只**实现了两个模式里的一个半
 *
 * - `deterministic_local`：跑**抽取层** —— 原话 → 题设子句。这是真测量，读数是"抽取覆盖"。
 * - `real_provider`：**适配器还没写**。所以整批如实写 `status: "not_measured"`：
 *   没有凭据（或没有适配器）时编一个数字，等于把"没测"说成"测过了"。
 *
 * ## 为什么不在这里断言"抽取率必须 ≥ X"
 *
 * 那是**基线**，不是门禁。把当前读数钉成阈值，会让"今天测得差"变成"明天必须犯同样的错"。
 * 抽取率由报告如实报出来，阈值等有真实 provider 基线之后再谈（N4 的后半段）。
 *
 * ## scripts 侧已经不是题集的持有者，只是它的调用方之一（子任务 N4a）
 *
 * 这个文件过去用 `readFileSync` 读 `cases.jsonl`。现在题集住在包里
 *（`packages/agent-core/src/benchmark/cases.ts` 的 `BENCHMARK_CASES_JSONL`），
 * 因为**应用侧是浏览器、不能 `node:fs`**，而"随仓库走的题集"必须有**一处**定义
 *（两份必然分叉：bench 说 21 条、应用说 8 条，而两边都自称跑过了）。
 * 所以这里与 CLI **共用同一份 import**，而不是继续读一份本地副本。
 */

/** 固定种子：同一份题集必须给同一份读数（报告要可重现）。 */
const SEED = 7

const MODE: "deterministic_local" | "real_provider" = process.env.BENCHMARK_MODE === "real_provider"
  ? "real_provider"
  : "deterministic_local"

const cases = parseBenchmarkDataset(BENCHMARK_CASES_JSONL, "cases.jsonl")

/** 抽取层的三种结局：一条都没抽出来 / 有抽出来的也有残留 / 子句都被处理。 */
function extractionStatus(extracted: number, residue: number): BenchmarkRunStatus {
  if (extracted === 0) return "empty"
  return residue === 0 ? "extracted" : "partial"
}

function extractionRun(caseId: string, prompt: string): BenchmarkRun {
  const base = { caseId, provider: null, model: null, seed: SEED, mode: "deterministic_local" as const, layer: "extraction" as const, cost: null, latency: null }
  try {
    const ir = parseObligationIR(prompt)
    return {
      ...base,
      status: extractionStatus(ir.obligations.length, ir.unverified.length),
      evidence: [
        ...ir.obligations.map((item) => ({ claim: item.sourceText, status: item.kind, evidence: `角色 ${item.role}；判定力 ${item.judgeability}` })),
        ...ir.unverified.map((item) => ({ claim: item.sourceText, status: EXTRACTION_RESIDUE_STATUS, evidence: item.reason })),
        /**
         * 一条都没抽出来时 `evidence` 会是空的，而"除了 not_measured 每轮都必须给出凭什么这么说"
         * 那条规则会把它判失败 —— 那是对的：**"没读出来"也是一个结论，要有理由**。
         */
        ...(ir.obligations.length === 0 && ir.unverified.length === 0
          ? [{ claim: "（没有抽出任何子句）", status: "empty", evidence: "解析器在这句原话里没有认出任何题设子句 —— 这是「没读出来」，不是「已满足」。" }]
          : [])
      ]
    }
  } catch (error) {
    return {
      ...base,
      status: "error",
      evidence: [{ claim: prompt, status: "error", evidence: error instanceof Error ? error.message : String(error) }]
    }
  }
}

/**
 * 没有适配器就没有读数。`provider` / `model` 写 `null` 是**被允许**的
 * （`report.ts` 里 `not_measured` 那一支），因为它诚实地表示"这一轮没有真实 provider 参与"。
 */
function notMeasuredRun(caseId: string): BenchmarkRun {
  return {
    caseId,
    provider: null,
    model: null,
    seed: SEED,
    mode: "real_provider",
    layer: "witness",
    status: "not_measured",
    evidence: [],
    cost: null,
    latency: null
  }
}

/**
 * **见证层的一轮**（`deterministic_local`）：题面 → **离线**见证搜索。
 *
 * 用的是 `searchWitnessForPrompt`（agent-core 导出的离线入口）—— 于是这一层与**救援路径**
 * 用的是同一份"题面 → 图形族 → 有界搜索"的口径，不是又写一遍。
 *
 * `status` 与 `BENCHMARK_STATUSES_BY_LAYER.witness` 的词表**逐字对应**
 *（`verified_instance` / `unverified_instance` / `no_witness`），所以这里**不需要任何新判断**。
 */
function witnessRun(caseId: string, prompt: string): BenchmarkRun {
  const base = { caseId, provider: null, model: null, seed: SEED, mode: "deterministic_local" as const, layer: "witness" as const, cost: null, latency: null }
  try {
    const result = searchWitnessForPrompt(prompt)
    const evidence = result.status === "verified_instance"
      ? [{ claim: caseId, status: "verified_instance" as const, evidence: `候选通过统一核验器；系统替你定了 ${result.assumptions.length} 条` }]
      : result.status === "no_witness"
        ? result.failures.map((failure) => ({ claim: caseId, status: "no_witness" as const, evidence: failure }))
        : result.reasons.map((reason) => ({ claim: caseId, status: "unverified_instance" as const, evidence: reason }))

    return {
      ...base,
      status: result.status,
      evidence: evidence.length > 0 ? evidence : [{ claim: caseId, status: result.status, evidence: "搜索给了结论，但没有留下原因文本。" }]
    }
  } catch (error) {
    return { ...base, status: "error", evidence: [{ claim: caseId, status: "error", evidence: error instanceof Error ? error.message : String(error) }] }
  }
}
const runs: BenchmarkRun[] = MODE === "real_provider"
  ? cases.map((entry) => notMeasuredRun(entry.id))
  : cases.flatMap((entry) => [extractionRun(entry.id, entry.prompt), witnessRun(entry.id, entry.prompt)])

const report = buildBenchmarkReport(runs, `${MODE} 运行记录`)

describe(`benchmark 运行入口（mode=${MODE}）`, () => {
  it("每条题都恰好留下应有的轮次，不多不少", () => {
    const total = report.deterministicLocal.runs.length + report.realProvider.runs.length
    // `deterministic_local` 每题**两层各一轮**（抽取 + 见证）；`real_provider` 仍是每题一轮 `not_measured`。
    expect(total).toBe(MODE === "real_provider" ? cases.length : cases.length * 2)
    expect(new Set(runs.map((entry) => entry.caseId)).size).toBe(cases.length)
  })

  it("报告按层计数，每一层都覆盖到全部题", () => {
    const mode = MODE === "real_provider" ? report.realProvider : report.deterministicLocal
    const byLayer = Object.values(mode.byLayer).reduce((sum, count) => sum + count, 0)

    expect(byLayer).toBe(MODE === "real_provider" ? cases.length : cases.length * 2)
    if (MODE !== "real_provider") {
      expect(mode.byLayer.extraction).toBe(cases.length)
      expect(mode.byLayer.witness).toBe(cases.length)
    }
  })

  it("**见证层读数（求解率）**：verified / unverified / no_witness 各多少（**不是门禁**，是读数）", () => {
    if (MODE !== "deterministic_local") return
    const witness = report.deterministicLocal.runs.filter((entry) => entry.layer === "witness")
    const count = (status: string) => witness.filter((entry) => entry.status === status).length
    const verified = count("verified_instance")

    console.log(
      `BENCHMARK_WITNESS verified=${verified} unverified=${count("unverified_instance")} ` +
        `no_witness=${count("no_witness")} error=${count("error")} ` +
        `solveRate=${(verified / witness.length).toFixed(3)}`
    )

    /**
     * **失败原因码的分布** —— 没有它，"求解率 4.8%" 只是一个孤零零的数，看不出该往哪儿使劲。
     *
     * 有了它就能把数字**解释开**（2026-10-05 实测）：判据不是瓶颈（24 条题设里 21 条 `supported`），
     * 卡住的是**构造阶段** —— `requires-candidates`（题面没点名一个构造器认得的立体）、
     * `unsupported-shape`（缺"某条线段 ⊥ 某个点名平面"这种写法）、
     * `no-candidate-constructed`（构造出候选但全被构造期拒掉）。
     * **这三种指向的下一步完全不同**（扩构造器 vs 扩解析 vs 修约束），所以它是必要的读数。
     */
    const codes: Record<string, number> = {}
    for (const entry of witness) {
      for (const item of entry.evidence) {
        const code = /^([a-z][a-z-]*):/.exec(item.evidence)?.[1] ?? "(no-code)"
        codes[code] = (codes[code] ?? 0) + 1
      }
    }
    console.log(`BENCHMARK_WITNESS_CODES ${JSON.stringify(codes)}`)
    // 计数必须盖满：四种结局不重不漏（否则"求解率"的分母是编出来的）。
    expect(verified + count("unverified_instance") + count("no_witness") + count("error")).toBe(witness.length)
  })
  it("**判定力（judgeability）分布**：supported / unsupported / ambiguous 各多少", () => {
    /**
     * 计划 N4 第 4 条点名的"judgeability"。它是**内核已经算好**的一个字段
     *（`obligationIR.ts` 的 `claimOf(..)` 决定 `GeometryObligation.judgeability`），所以这里只是**读出来**，
     * 不引入任何新判断。
     *
     * 它和求解率一起看才有意义：离线求解率只有 4.8%，如果那是因为**多数题设本来就判不了**
     *（`unsupported`），那 4.8% 就不是"搜索差"而是"判据没覆盖" —— 两种解释指向完全不同的下一步。
     */
    const counts = { supported: 0, unsupported: 0, ambiguous: 0 }
    for (const entry of cases) {
      for (const obligation of parseObligationIR(entry.prompt).obligations) {
        counts[obligation.judgeability] += 1
      }
    }
    const total = counts.supported + counts.unsupported + counts.ambiguous

    console.log(`BENCHMARK_JUDGEABILITY supported=${counts.supported} unsupported=${counts.unsupported} ambiguous=${counts.ambiguous} totalObligations=${total}`)
    // 三种取值不重不漏 —— 否则这个"分布"是编出来的。
    expect(total).toBeGreaterThan(0)
    expect(total).toBe(cases.reduce((sum, entry) => sum + parseObligationIR(entry.prompt).obligations.length, 0))
  })
  it("打印报告（`--silent=false` 就是给它看的）", () => {
    console.log(`BENCHMARK_REPORT ${JSON.stringify({ mode: MODE, seed: SEED, cases: cases.length, report }, null, 2)}`)
    expect(report).toBeDefined()
  })

  it("deterministic_local：跑的是抽取层，每一轮的证据都非空", () => {
    if (MODE !== "deterministic_local") return
    for (const entry of report.deterministicLocal.runs) {
      /**
       * **两层各自在自己的词表里** —— 判据的来源就是 `report.ts` 的 `BENCHMARK_STATUSES_BY_LAYER`，
       * 这里只是按层取那一份（不是又写一套）。加了见证层之后，"本地只跑抽取层"这句话就不再成立了。
       */
      const allowed = entry.layer === "extraction"
        ? ["extracted", "partial", "empty", "error"]
        : ["verified_instance", "unverified_instance", "no_witness", "error"]
      expect(allowed, `${entry.caseId} / ${entry.layer}`).toContain(entry.status)
      expect(entry.evidence.length).toBeGreaterThan(0)
    }
  })

  it("real_provider：整批是 not_measured —— 适配器还没写，不伪造数字", () => {
    if (MODE !== "real_provider") return
    expect(report.realProvider.measured).toBe(0)
    expect(report.realProvider.notMeasured).toBe(cases.length)
    for (const entry of report.realProvider.runs) {
      expect(entry.provider).toBeNull()
      expect(entry.cost).toBeNull()
      expect(entry.latency).toBeNull()
    }
  })

  it("每题超过 MAX_ROUNDS_PER_CASE 轮要**整份拒收**（计划 N4：「每题最多 3 轮」）", () => {
    const one = cases[0]!
    const overCap = Array.from({ length: MAX_ROUNDS_PER_CASE + 1 }, () => extractionRun(one.id, one.prompt))

    expect(() => buildBenchmarkReport(overCap)).toThrow(/超过上限/)
  })

  it("恰好 MAX_ROUNDS_PER_CASE 轮是允许的（边界要钉住，否则上限会被写成 off-by-one）", () => {
    const one = cases[0]!
    const atCap = Array.from({ length: MAX_ROUNDS_PER_CASE }, () => extractionRun(one.id, one.prompt))

    expect(buildBenchmarkReport(atCap).deterministicLocal.runs).toHaveLength(MAX_ROUNDS_PER_CASE)
  })

  it("题设覆盖率：给定义 ÷（给定义 + residue）；**一条子句都没读到时报 null 而不是 0**", () => {
    const one = cases[0]!
    const withObligations = buildBenchmarkReport([extractionRun(one.id, one.prompt)]).deterministicLocal.premiseCoverage
    expect(withObligations.obligations).toBeGreaterThan(0)
    expect(withObligations.residue).toBe(0)
    expect(withObligations.rate).toBe(1)

    // 只有 residue 的题：0 ÷ (0+1) = 0 —— "读到的全都核验不了"就是 0，不许和"没读到"混为一谈。
    const residueOnly = buildBenchmarkReport([extractionRun("only-residue", "拖动这个正四面体的一个顶点，保持六条棱长始终相等")]).deterministicLocal.premiseCoverage
    expect(residueOnly.obligations).toBe(0)
    expect(residueOnly.residue).toBe(1)
    expect(residueOnly.rate).toBe(0)

    // 整批的读数也打出来（`--silent=false` 就是给它看的）：口径见 `report.ts` 的
    // `BenchmarkPremiseCoverage` —— 只看抽取层、not_measured 不进统计。
    const whole = buildBenchmarkReport(cases.map((entry) => extractionRun(entry.id, entry.prompt))).deterministicLocal.premiseCoverage
    console.log(`BENCHMARK_PREMISE obligations=${whole.obligations} residue=${whole.residue} rate=${whole.rate === null ? "null" : whole.rate.toFixed(3)}`)
    // 完全空的一批：没有子句可算 → null。
    expect(buildBenchmarkReport([]).deterministicLocal.premiseCoverage.rate).toBeNull()
  })
  it("**抽取率（题级）与题设覆盖率（子句级）是两个数**，不许混成一个", () => {
    const one = cases[0]!
    const single = buildBenchmarkReport([extractionRun(one.id, one.prompt)]).deterministicLocal
    expect(single.extractionRate).toEqual({ covered: 1, total: 1, rate: 1 })
    expect(single.premiseCoverage.rate).toBe(1)

    // 一道"一条都没读懂"的题：题级是 0/1，子句级也是 0 —— 但两者问的不是同一件事。
    const empty = buildBenchmarkReport([extractionRun("only-residue-2", "拖动这个正四面体的一个顶点，保持六条棱长始终相等")]).deterministicLocal
    expect(empty.extractionRate).toEqual({ covered: 0, total: 1, rate: 0 })
    expect(empty.premiseCoverage).toEqual({ obligations: 0, residue: 1, rate: 0 })

    // 同一题跑多轮**不把分母撑大**（按题去重）。
    const twice = buildBenchmarkReport([extractionRun(one.id, one.prompt), extractionRun(one.id, one.prompt)]).deterministicLocal
    expect(twice.extractionRate).toEqual({ covered: 1, total: 1, rate: 1 })

    // 一道题都没有：`rate` 是 null（没有题就没有率），不是 0。
    expect(buildBenchmarkReport([]).deterministicLocal.extractionRate).toEqual({ covered: 0, total: 0, rate: null })

    const whole = buildBenchmarkReport(cases.map((entry) => extractionRun(entry.id, entry.prompt))).deterministicLocal
    console.log(`BENCHMARK_EXTRACTION covered=${whole.extractionRate.covered}/${whole.extractionRate.total} rate=${whole.extractionRate.rate === null ? "null" : whole.extractionRate.rate.toFixed(3)}`)
  })
  it("每一条题都至少留下一条痕迹（给定义或 residue）—— 让静默丢句再也过不去", () => {
    // 这条不变量写在 `diagramObligations.ts` 自己的注释里（"新写法必须显形为 unverified，
    // 不许把非空题面静默变成空通过"），而题集里**真的**有一条曾经整句消失
    //（"保持六条棱长始终相等"）。放在题集这一层挡：以后往题集（`packages/agent-core/src/benchmark/cases.ts`）里加的新写法，
    // 只要静默丢掉就会红在这里，而不必等谁去逐条读归因。
    for (const entry of cases) {
      const ir = parseObligationIR(entry.prompt)
      expect(ir.obligations.length + ir.unverified.length, `${entry.id}：${entry.prompt}`).toBeGreaterThan(0)
    }
  })
  it("抽取覆盖率如实报出来（**不是门禁**，是读数）", () => {
    if (MODE !== "deterministic_local") return
    const byStatus = report.deterministicLocal.byStatus
    const covered = (byStatus.extracted ?? 0) + (byStatus.partial ?? 0)
    console.log(`BENCHMARK_COVERAGE cases=${cases.length} covered=${covered} empty=${byStatus.empty ?? 0} error=${byStatus.error ?? 0}`)
    // 只断言"读数自洽"，不断言"覆盖率必须达到多少"。
    expect(covered + (byStatus.empty ?? 0) + (byStatus.error ?? 0)).toBe(cases.length)
  })
})
