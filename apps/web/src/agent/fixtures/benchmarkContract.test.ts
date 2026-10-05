import {
  BENCHMARK_CATEGORIES,
  BENCHMARK_CASES_JSONL,
  BENCHMARK_LAYERS,
  BENCHMARK_MODES,
  BENCHMARK_STATUSES_BY_LAYER,
  BenchmarkReportError,
  buildBenchmarkReport,
  categoryCoverage,
  parseBenchmarkCases,
  parseBenchmarkDataset,
  sha256Hex,
  type BenchmarkReport,
  type BenchmarkRun
} from "@draw/agent-core"
import { describe, expect, it } from "vitest"

/**
 * **应用侧判据：题集与报告契约必须"能被应用共用"**（子任务 N4a 的交付物）。
 *
 * ## 这条用例在钉什么
 *
 * 它**只从 `@draw/agent-core` import** —— 不碰 `node:fs`、不写任何路径、不读任何文件。
 * 这正是应用（浏览器）唯一能做到的拿法，也是本任务存在的理由：在这之前，benchmark 的
 * 21 条题与报告契约在 `scripts/` 下（**不是工作区**），应用拿不到，于是应用内的真实
 * provider 评测用的是自己那套旧 8 题固定样本 —— 两边都自称"跑过了"，数字却**不可比**。
 * 少了这条，"能被应用共用"只是宣称。
 *
 * ## 这条用例**不是**在测 N4b 的行为
 *
 * 它不跑真实 provider、不改应用内评测的行为（那是 N4b）：合成的 `BenchmarkRun` 就是
 * 一份**没花钱**的运行记录，用它证明"报告契约在应用的 import 路径下**真的可调用**"。
 *
 * ## 哪些是钉子、哪些是新判断（诚实说明）
 *
 * - "共 21 条 / 七类各 3 条 / 题面非空"：**钉子** —— 它们钉的是"搬过来的就是原来那 21 条"。
 *   搬迁本身不该让它们变绿或变红。
 * - "报告契约在这条 import 路径下可调用并给出正确分组"：**钉子**（钉住 `buildBenchmarkReport`
 *   的行为没在搬迁里被改坏）。
 * - "题集文本的冻结指纹（5488 字节 / sha256）"：**钉子，而且是会咬人的那枚** ——
 *   它挡的不是"两份副本分叉"（现在**只有一份**，没有第二份可分叉），而是
 *   **这一份被静默改动**：题集改一个字节就红，改题集的人必须显式更新指纹。
 * - **真正的新业务判断**只有一条：*这份题集与契约**能在应用侧的 import 路径下拿到***
 *  —— 即 `@draw/agent-core` 的 barrel 真的导出了它们，而且导出的东西是**一份**、
 *   不是应用侧另抄的副本（故这里只 import，不复制任何题面字面量）。
 */

/** 一份**合成**的运行记录：合法、`deterministic_local`、不需要任何凭据。 */
function synthesisedRun(overrides: Partial<BenchmarkRun> = {}): BenchmarkRun {
  return {
    caseId: "underdetermined-pyramid-base",
    provider: null,
    model: null,
    seed: 7,
    mode: "deterministic_local",
    layer: "extraction",
    status: "extracted",
    evidence: [{ claim: "PA ⊥ 平面 ABCD", status: "perpendicular", evidence: "角色 given；判定力 supported" }],
    cost: null,
    latency: null,
    ...overrides
  }
}

describe("应用侧：benchmark 题集与报告契约来自 @draw/agent-core（不读文件）", () => {
  it("题集能在浏览器路径下拿到：21 条 = 七类各 3 条", () => {
    const cases = parseBenchmarkCases("cases.jsonl")

    expect(cases).toHaveLength(21)
    expect(categoryCoverage(cases).map((entry) => [entry.category, entry.count]))
      .toEqual(BENCHMARK_CATEGORIES.map((category) => [category, 3]))
    /**
     * **复核更正（2026-10-05）**：这里原来还有一条
     * `expect(cases.every((entry) => entry.prompt.trim().length > 0)).toBe(true)`，
     * 标题把它算作"题面非空"的钉子 —— 但它在当前实现下**不可能红**：
     * `parseBenchmarkCases()` 就是 `parseBenchmarkDataset(BENCHMARK_CASES_JSONL, where)`，
     * 而解析器只把 `prompt` 通过 `nonEmptyString`（即 `trim().length > 0`）的记录放进数组
     * （`dataset.ts` 的必填字段循环），所以"数组里的每条 prompt 都非空"是**解析器的定义**，不是可违反的性质。
     * 空题面会让那条 case **被丢弃**，红的是上面的 `toHaveLength(21)`。
     * 删掉它、换成一条**真的会咬人**的内容钉子：应用拿到的是那份**真的题集**（首条 id 与题面都对得上）。
     * 更强的内容钉子是同文件的**冻结指纹**（字节数 + sha256），这里只补一条能指明"是这份题"的锚点。
     */
    expect(cases[0]!.id).toBe("underdetermined-pyramid-base")
    expect(cases[0]!.prompt).toContain("PA ⊥ 平面 ABCD")
  })

  it("题集文本有一枚**冻结指纹**：改一个字节就红（这一份没有被静默改动）", () => {
    /**
     * ## 这条钉什么
     *
     * 题集现在**只有一份**（`BENCHMARK_CASES_JSONL`）—— 没有第二份副本可以分叉，所以
     * 这里**不**去断言"两份相等"（那种断言恒真，挡不住任何东西）。它钉的是：
     * **这一份没有被静默改动**。
     *
     * 口径：题集改一个字节 → 这条红 → 改题集的人必须**显式**更新下面这两行。
     * `cases.ts` 注释里那句"锁定了 blob（5488 字节 / sha256 7bc7b49c…）"就是这枚指纹的
     * 散文版；**注释不会咬人，这两行会**。
     *
     * ## 两个口径陷阱
     *
     * 1. 字节长度必须过 `TextEncoder`：JS 的 `.length` 数的是 UTF-16 码元，而题集里有中文
     *  （题目 3720 个码元 vs 5488 字节），直接写 `.length === 5488` 是错的。
     * 2. 哈希复用包里**已有**的 `sha256Hex`（FIPS 180-4，同步、零依赖，浏览器与 Node 同结果），
     *    不自己再写一份 —— "判断依据只有一处"这条纪律在本仓是有代价记录的
     *    （见 `sceneObservation.ts` 关于自写哈希的注释）。
     */
    expect(new TextEncoder().encode(BENCHMARK_CASES_JSONL).length).toBe(5488)
    expect(sha256Hex(BENCHMARK_CASES_JSONL)).toBe("7bc7b49c074b85f3fc09cbbf91a1eb1a64883ce9078424741ee2d047af54769e")
    // 指纹算的是"应用 import 到的那份文本"：它必须真的能被解析成那 21 条。
    expect(parseBenchmarkDataset(BENCHMARK_CASES_JSONL, "cases.jsonl")).toHaveLength(21)
  })

  it("词表与状态常量也在应用侧可用（N4b 要按它们分流）", () => {
    expect([...BENCHMARK_CATEGORIES]).toHaveLength(7)
    expect([...BENCHMARK_MODES]).toEqual(["deterministic_local", "real_provider"])
    expect([...BENCHMARK_LAYERS]).toEqual(["extraction", "witness"])
    /**
     * 两层各自的结局词表：见证层的词描述不了抽取层（这条口径是报告契约的一部分）。
     *
     * **复核更正（2026-10-05）**：这里原来是 `not.toContain("verified_instance")` —— 那是**单词级否定**，
     * 把 extraction 词表改成 `[]`、或塞进一个 `"junk"`，它**都还是绿的**，
     * 而这个用例自称在钉"两层各自的词表"。改成**逐项相等**：词表增删改任何一项都会红。
     * 真实定义在 `packages/agent-core/src/benchmark/report.ts` 的 `BENCHMARK_STATUSES_BY_LAYER`。
     */
    expect([...BENCHMARK_STATUSES_BY_LAYER.extraction]).toEqual(["extracted", "partial", "empty", "not_measured", "error"])
    expect([...BENCHMARK_STATUSES_BY_LAYER.witness]).toEqual(["verified_instance", "unverified_instance", "no_witness", "clarification", "not_measured", "error"])
  })

  it("报告契约可调用：对一份合成的 BenchmarkRun 建出报告", () => {
    const report: BenchmarkReport = buildBenchmarkReport([synthesisedRun()], "应用侧合成记录")

    expect(report.deterministicLocal.runs).toHaveLength(1)
    expect(report.deterministicLocal.byStatus).toEqual({ extracted: 1 })
    expect(report.deterministicLocal.byLayer).toEqual({ extraction: 1 })
    expect(report.deterministicLocal.extractionRate).toEqual({ covered: 1, total: 1, rate: 1 })
    // `real_provider` 那一侧没有被合成记录污染：它仍然是空的（两模式分开报，不混）。
    expect(report.realProvider.runs).toEqual([])
    expect(report.realProvider.measured).toBe(0)
  })

  it("报告契约的判据在应用侧同样咬人（缺字段要点名）", () => {
    // 搬迁不许改动语义：这条钉的是 `buildBenchmarkReport` 的错误类型与文案都没变。
    expect(() => buildBenchmarkReport([{ caseId: "x" }])).toThrowError(BenchmarkReportError)
    expect(() => buildBenchmarkReport([{ caseId: "x" }])).toThrow(/缺少必需字段/)
  })
})
