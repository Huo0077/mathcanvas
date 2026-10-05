import { describe, expect, it } from "vitest"

import {
  BENCHMARK_CASE_REQUIRED_FIELDS,
  BENCHMARK_CASES_JSONL,
  BENCHMARK_CATEGORIES,
  BenchmarkDatasetError,
  BenchmarkReportError,
  buildBenchmarkReport,
  categoryCoverage,
  findSecrets,
  parseBenchmarkDataset
} from "@draw/agent-core"

/**
 * **N4 的 RED 条件**（实施计划 Phase N4）：
 * "缺 `provider/model/seed/status`、包含 secret、claim 缺 evidence、模式未标识时报告生成必须失败"。
 *
 * 这个文件的用例成对写：**每一条"必须失败"的旁边，都有一条"合法输入不许被判失败"** ——
 * 校验器最容易犯的错不是漏报，而是把合法输入拒掉（那样 benchmark 就跑不起来，
 * 而"跑不起来"会被误读成"没有数据"）。
 */

function run(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    caseId: "underdetermined-pyramid-base",
    provider: null,
    model: null,
    seed: 7,
    mode: "deterministic_local",
    layer: "witness",
    status: "verified_instance",
    evidence: [{ claim: "底面四点共面", status: "verified_instance", evidence: "内核核验通过，残差 0" }],
    cost: null,
    latency: { totalMs: 12 },
    ...overrides
  }
}

describe("benchmark 题集", () => {
  it("合法的 JSONL 解析出每一条，空行忽略", () => {
    const cases = parseBenchmarkDataset([
      '{"id":"a","category":"underdetermined","workspace":"geometry3d","prompt":"随便一句"}',
      "",
      '{"id":"b","category":"contradictory","workspace":"geometry3d","prompt":"再来一句","note":"给人看的"}'
    ].join("\n"))

    expect(cases.map((entry) => entry.id)).toEqual(["a", "b"])
    expect(cases[1]?.note).toBe("给人看的")
  })

  it("缺必填字段要抛，而且**点名字段**与行号", () => {
    expect(() => parseBenchmarkDataset('{"id":"a","category":"underdetermined"}'))
      .toThrow(/第 1 行缺少必填字段 workspace/)
  })

  it("category 不在词表里要抛，并把词表列出来", () => {
    expect(() => parseBenchmarkDataset('{"id":"a","category":"乱写的","workspace":"geometry3d","prompt":"x"}'))
      .toThrow(/不在词表里/)
  })

  it("未声明的字段要抛（多写一个键不是无害的）", () => {
    expect(() => parseBenchmarkDataset('{"id":"a","category":"underdetermined","workspace":"geometry3d","prompt":"x","expect":"随便"}'))
      .toThrow(/未声明的字段 expect/)
  })

  it("id 重复要抛：报告里两条记录会分不清谁是谁", () => {
    const line = '{"id":"same","category":"underdetermined","workspace":"geometry3d","prompt":"x"}'
    expect(() => parseBenchmarkDataset(`${line}\n${line}`)).toThrow(/重复/)
  })

  it("原话里带凭据要抛 —— 题集是从真实报障原话长出来的，贴 key 是最常见的泄漏方式", () => {
    expect(() => parseBenchmarkDataset('{"id":"a","category":"underdetermined","workspace":"geometry3d","prompt":"用 sk-abcdefghijklmnopqrstuvwxyz012345 试一下"}'))
      .toThrow(/疑似凭据/)
  })

  it("多处问题一次列齐，不是只报第一条", () => {
    let message = ""
    try {
      parseBenchmarkDataset('{"id":"a","category":"乱写的","workspace":"geometry3d"}\n{"id":"a"}')
    } catch (error) {
      message = error instanceof Error ? error.message : ""
    }

    expect(message).toContain("workspace")
    expect(message).toContain("不在词表里")
    expect(message).toContain("prompt")
    expect(message).toContain("第 2 行")
  })

  it("抛的是专门的错误类型，调用方能按类型分流", () => {
    expect(() => parseBenchmarkDataset('{"id":"a"}')).toThrow(BenchmarkDatasetError)
  })

  it("随仓库走的那份题集本身合法，而且**七类各三条**（21 条）", () => {
    /**
     * **这条读的是"真的题面文本"**：题集现在住在包里（`cases.ts` 的 `BENCHMARK_CASES_JSONL`，
     * 子任务 N4a 从 `scripts/agent-benchmark/cases.jsonl` 搬进来），而且**只有那一份** ——
     * 解析走的仍然是 `parseBenchmarkDataset`（校验规则一条都不绕过），
     * 所以这条判据咬的是"随仓库走的那份题集本身"，不是一份再抄出来的副本。
     *
     * 为什么不再 `readFileSync`：应用侧是浏览器，不能 `node:fs`；题集必须能被 **import** 拿到，
     * 否则"bench 的 21 条"与"应用内那套旧 8 题"就会永远是两份真相。
     */
    const cases = parseBenchmarkDataset(BENCHMARK_CASES_JSONL, "cases.jsonl")

    // 七类 × 3 = 21：**每一格**都点名数出来（"至少覆盖到"挡不住"某一类只有一条"）。
    expect(cases).toHaveLength(21)
    expect(categoryCoverage(cases).map((entry) => [entry.category, entry.count]))
      .toEqual(BENCHMARK_CATEGORIES.map((category) => [category, 3]))
    expect(categoryCoverage(cases).filter((entry) => !entry.covered)).toEqual([])
    // 题面是真的读进来了（不是空字符串占位）：每条都要有非空 prompt。
    expect(cases.every((entry) => entry.prompt.trim().length > 0)).toBe(true)
  })

  it("schema 与校验器的必需字段是同一份（校验器直接从 schema 读）", () => {
    expect([...BENCHMARK_CASE_REQUIRED_FIELDS]).toEqual(["id", "category", "workspace", "prompt"])
  })
})

describe("benchmark 报告", () => {
  it("合法的一批记录分成两种模式，各自按状态计数", () => {
    const report = buildBenchmarkReport([
      run(),
      run({ caseId: "b", status: "no_witness", evidence: [{ claim: "AB=3 与 AB=5", status: "inconsistent", evidence: "可证的矛盾" }] }),
      run({ caseId: "c", mode: "real_provider", provider: "deepseek", model: "deepseek-chat", status: "not_measured", evidence: [], cost: null, latency: null })
    ])

    expect(report.deterministicLocal.runs).toHaveLength(2)
    expect(report.realProvider.runs).toHaveLength(1)
    expect(report.realProvider.measured).toBe(0)
    expect(report.realProvider.notMeasured).toBe(1)
  })

  it("缺 provider / model / seed / status / layer 任何一个都要抛，并点名缺了哪些", () => {
    for (const field of ["provider", "model", "seed", "status", "layer"]) {
      const broken = run()
      delete broken[field]
      expect(() => buildBenchmarkReport([broken])).toThrow(new RegExp(field))
    }
  })

  it("「没测」必须写显式的 null，不能把这个键删掉", () => {
    const broken = run()
    delete broken.cost

    expect(() => buildBenchmarkReport([broken])).toThrow(/显式的 null/)
    // 写成 null 就合法。
    expect(() => buildBenchmarkReport([run({ cost: null })])).not.toThrow()
  })

  it("模式未标识要抛：两种模式混报就是拿离线回归冒充模型准确率", () => {
    expect(() => buildBenchmarkReport([run({ mode: "whatever" })])).toThrow(/未标识/)
    expect(() => buildBenchmarkReport([run({ mode: undefined })])).toThrow(/未标识/)
  })

  it("层必须标识，而且 status 必须属于**那一层**的词表", () => {
    // 见证层的词拿来描述抽取层是范畴错误 —— 它会让报告读起来是绿的、实际什么都没说。
    expect(() => buildBenchmarkReport([run({ layer: "extraction", status: "verified_instance" })])).toThrow(/不在词表里/)
    expect(() => buildBenchmarkReport([run({ layer: "witness", status: "extracted" })])).toThrow(/不在词表里/)
    expect(() => buildBenchmarkReport([run({ layer: "乱写的" })])).toThrow(/layer/)
    // 每层自己的词是合法的。
    expect(() => buildBenchmarkReport([run({ layer: "extraction", status: "partial" })])).not.toThrow()
  })

  it("按层各自计数（同一批记录里可以混两层）", () => {
    const report = buildBenchmarkReport([run(), run({ caseId: "b", layer: "extraction", status: "partial" })])

    expect(report.deterministicLocal.byLayer).toEqual({ witness: 1, extraction: 1 })
    expect(report.deterministicLocal.byStatus).toEqual({ verified_instance: 1, partial: 1 })
  })

  it("real_provider 却说不出 provider / model 要抛（那正是这一轮在测什么）", () => {
    expect(() => buildBenchmarkReport([run({ mode: "real_provider", provider: null, model: null })])).toThrow(/必须是非空字符串/)
  })

  it("但没凭据时允许 provider / model 为 null —— 逼出一个模型名字就是伪造", () => {
    expect(() => buildBenchmarkReport([
      run({ mode: "real_provider", provider: null, model: null, status: "not_measured", evidence: [], cost: null, latency: null })
    ])).not.toThrow()
  })

  it("claim 缺证据要抛", () => {
    expect(() => buildBenchmarkReport([run({ evidence: [] })])).toThrow(/凭什么这么说/)
    expect(() => buildBenchmarkReport([run({ evidence: [{ claim: "底面四点共面", status: "verified_instance" }] })])).toThrow(/缺证据/)
  })

  it("但 not_measured 允许空证据 —— 逼它给证据就是逼它编", () => {
    expect(() => buildBenchmarkReport([run({ status: "not_measured", evidence: [], cost: null, latency: null })])).not.toThrow()
  })

  it("status 不在词表里要抛", () => {
    expect(() => buildBenchmarkReport([run({ status: "挺好" })])).toThrow(/不在词表里/)
  })

  it("运行记录里带凭据也要抛", () => {
    expect(() => buildBenchmarkReport([run({ evidence: [{ claim: "x", status: "unknown", evidence: "Bearer abcdefghijklmnopqrst" }] })]))
      .toThrow(/疑似凭据/)
  })

  it("抛的是专门的错误类型", () => {
    expect(() => buildBenchmarkReport([{}])).toThrow(BenchmarkReportError)
  })
})

describe("凭据检查本身", () => {
  it("普通中文题面一条都不命中", () => {
    expect(findSecrets("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD")).toEqual([])
  })

  it("认得几种结构明确的形状", () => {
    expect(findSecrets("sk-abcdefghijklmnopqrstuvwxyz01").map((entry) => entry.name)).toEqual(["openai-style-key"])
    expect(findSecrets("DEEPSEEK_API_KEY=abcdefgh12345").map((entry) => entry.name)).toEqual(["generic-env-secret"])
    expect(findSecrets("-----BEGIN RSA PRIVATE KEY-----").map((entry) => entry.name)).toEqual(["private-key-block"])
  })

  it("同一次扫描里多个命中都报出来，并按位置排序", () => {
    const found = findSecrets("前缀 sk-abcdefghijklmnopqrstuvwxyz01 中间 AKIAIOSFODNN7EXAMPLE 结尾")

    expect(found.map((entry) => entry.name)).toEqual(["openai-style-key", "aws-access-key-id"])
    expect(found[0]!.index).toBeLessThan(found[1]!.index)
  })

  it("带 /g 的正则不会在两次调用之间记住位置（否则第二次会漏）", () => {
    const text = "sk-abcdefghijklmnopqrstuvwxyz01"

    expect(findSecrets(text)).toHaveLength(1)
    expect(findSecrets(text)).toHaveLength(1)
  })
})
