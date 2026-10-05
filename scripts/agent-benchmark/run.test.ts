import { readFileSync } from "node:fs"

import { parseObligationIR } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { parseBenchmarkDataset } from "./dataset"
import { buildBenchmarkReport, type BenchmarkRun, type BenchmarkRunStatus } from "./report"

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
 */

const DATASET = "scripts/agent-benchmark/cases.jsonl"
/** 固定种子：同一份题集必须给同一份读数（报告要可重现）。 */
const SEED = 7

const MODE: "deterministic_local" | "real_provider" = process.env.BENCHMARK_MODE === "real_provider"
  ? "real_provider"
  : "deterministic_local"

const cases = parseBenchmarkDataset(readFileSync(DATASET, "utf8"), "cases.jsonl")

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
        ...ir.obligations.map((item) => ({ claim: item.sourceText, status: item.kind, evidence: `角色 ${item.role}` })),
        ...ir.unverified.map((item) => ({ claim: item.sourceText, status: "unverified", evidence: item.reason })),
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

const runs: BenchmarkRun[] = MODE === "real_provider"
  ? cases.map((entry) => notMeasuredRun(entry.id))
  : cases.map((entry) => extractionRun(entry.id, entry.prompt))

const report = buildBenchmarkReport(runs, `${MODE} 运行记录`)

describe(`benchmark 运行入口（mode=${MODE}）`, () => {
  it("每条题都恰好有一轮记录，不多不少", () => {
    const total = report.deterministicLocal.runs.length + report.realProvider.runs.length
    expect(total).toBe(cases.length)
    expect(new Set(runs.map((entry) => entry.caseId)).size).toBe(cases.length)
  })

  it("报告按层计数，且层计数之和等于题数", () => {
    const mode = MODE === "real_provider" ? report.realProvider : report.deterministicLocal
    const byLayer = Object.values(mode.byLayer).reduce((sum, count) => sum + count, 0)

    expect(byLayer).toBe(cases.length)
  })

  it("打印报告（`--silent=false` 就是给它看的）", () => {
    console.log(`BENCHMARK_REPORT ${JSON.stringify({ mode: MODE, seed: SEED, cases: cases.length, report }, null, 2)}`)
    expect(report).toBeDefined()
  })

  it("deterministic_local：跑的是抽取层，每一轮的证据都非空", () => {
    if (MODE !== "deterministic_local") return
    for (const entry of report.deterministicLocal.runs) {
      expect(entry.layer).toBe("extraction")
      expect(["extracted", "partial", "empty", "error"]).toContain(entry.status)
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

  it("每一条题都至少留下一条痕迹（给定义或 residue）—— 让静默丢句再也过不去", () => {
    // 这条不变量写在 `diagramObligations.ts` 自己的注释里（"新写法必须显形为 unverified，
    // 不许把非空题面静默变成空通过"），而题集里**真的**有一条曾经整句消失
    //（"保持六条棱长始终相等"）。放在题集这一层挡：以后往 `cases.jsonl` 里加的新写法，
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
