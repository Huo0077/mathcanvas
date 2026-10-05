/**
 * **benchmark 的题集与报告契约**（实施计划 N4；子任务 N4a 把它从 `scripts/` 搬进包里）。
 *
 * ## 为什么它必须住在包里而不是 `scripts/`
 *
 * `scripts/` **不是工作区**（根 `package.json` 的 `workspaces` 只有 `apps/*` + `packages/*`），
 * 所以应用侧（`apps/web`，浏览器）**拿不到它** —— 于是应用内那次真实 provider 评测用的是
 * 自己那套旧 8 题固定样本，而 `bench:agent` 跑的是这 21 条。两边都自称"跑过了"，
 * 数字却**不可比**。搬到包里之后，题集与报告契约在 CLI 与应用之间是**同一份**。
 *
 * ## 应用侧的限制：不能 `node:fs`
 *
 * 所以题集不是"包里读一个 `.jsonl` 文件"，而是 `./cases` 里的一个**文本常量**
 *（格式仍是 JSONL，`parseBenchmarkDataset` 逐字不变地解析它）。这样浏览器与 Node
 * 走的是同一条 import 路径，`apps/web/src/agent/fixtures/benchmarkContract.test.ts`
 * 钉着这件事。
 *
 * ## 逐项导出而不是 `export *`（与包根同一条纪律）
 *
 * 让"这个模块对外提供哪些名字"是**看得见的**。加名字要改这里，于是不会有人顺手把一个
 * 内部符号变成公共契约。
 *
 * ## 本次**不动**应用内的评测行为
 *
 * N4a 只搬"一份定义"；把应用内评测切成这 21 条是 **N4b**。这里只把契约交出去。
 */

export { BENCHMARK_CASES_JSONL } from "./cases"
export {
  BENCHMARK_CASE_REQUIRED_FIELDS,
  BENCHMARK_CATEGORIES,
  BenchmarkDatasetError,
  categoryCoverage,
  parseBenchmarkCases,
  parseBenchmarkDataset,
  type BenchmarkCase
} from "./dataset"
export { assertNoSecrets, findSecrets, type SecretFinding } from "./redaction"
export {
  BENCHMARK_LAYERS,
  BENCHMARK_MODES,
  BENCHMARK_RUN_REQUIRED_FIELDS,
  BENCHMARK_STATUSES_BY_LAYER,
  BenchmarkReportError,
  buildBenchmarkReport,
  EXTRACTION_RESIDUE_STATUS,
  HUMAN_READABILITY_GROUPS,
  HUMAN_READABILITY_VALUES,
  MAX_ROUNDS_PER_CASE,
  readabilityGroupFor,
  type BenchmarkEvidenceEntry,
  type BenchmarkExtractionRate,
  type BenchmarkLayer,
  type BenchmarkMode,
  type BenchmarkModeReport,
  type BenchmarkPremiseCoverage,
  type BenchmarkReadability,
  type BenchmarkReadabilityGroup,
  type BenchmarkReport,
  type BenchmarkRun,
  type BenchmarkRunStatus,
  type HumanReadability,
  type ReadabilityGroup
} from "./report"
