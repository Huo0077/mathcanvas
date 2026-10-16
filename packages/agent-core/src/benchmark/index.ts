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
/**
 * **真题离线评测工件**（Task 9，2026-10-12）。
 *
 * 与 `./dataset`（21 条**合成**题集）分开导出，因为它是另一种东西：条目带**来源锚点**
 * （卷别 / 题号 / 证据等级 / 输入许可），而"够不够格当金标"是它自己的判据
 *（转载方的答案不能充 oracle、留出集不许是开发题的变式）。详见该文件头。
 */
export {
  assertExamSet,
  checkExamSet,
  EXAM_CASES,
  EXAM_FAMILIES,
  EXAM_PROMPT_KINDS,
  EXAM_SOURCE_LEVELS,
  HELD_OUT_CASES,
  judgeAgainstOracle,
  verifiedGoldCaseIds,
  type ExamCase,
  type ExamCaseSourceSpan,
  type ExamFamily,
  type ExamPromptKind,
  type ExamProvenance,
  type ExamSetProblem,
  type ExamSetProblemCode,
  type ExamSourceLevel,
  type OracleCheck,
  type OracleFailure,
  type OracleVerdict
} from "./examSet"
/**
 * **事先冻结的样本与阈值 + 付费授权闸**（Task 20，2026-10-12）。
 *
 * 计划那句"**在**看到付费结果前冻结每族样本、阈值并取得用户对请求数及最高费用的授权，
 * 方可运行真实 provider"落成代码：`assertPaidRunAllowed` 就是那道闸（未授权一律拒）。
 */
export {
  assertPaidRunAllowed,
  examCaseFor,
  familyFreeze,
  frozenCaseIds,
  frozenFamilyOf,
  frozenSample,
  FROZEN_FAMILIES,
  FROZEN_THRESHOLDS,
  type FamilyFreeze,
  type FrozenBenchmarkPlan,
  type FrozenSample,
  type PaidRunDecision,
  type PaidRunRequest
} from "./frozenThresholds"
/**
 * **Task 20 的记账与执行骨架**（2026-10-12）：pass@1/pass@3 的定义、"同轮修复"单独计、
 * 人评没标就是 `null`、阈值只对照不改写，以及**授权闸在执行入口上**（未授权时 `runCase`
 * 一次都不会被调用）。不碰网络：真正的调用由注入的 `runCase` 承担。
 */
export {
  examFailureLayerForStages,
  examRequestPlan,
  examTrialOutcomeOf,
  examTrialVerdictOf,
  EXAM_REPAIRED_OUTCOME,
  EXAM_SUCCESS_OUTCOMES,
  runExamEvaluation,
  summarizeExamEvaluation,
  type ExamAttemptFacts,
  type ExamAttemptVerdict,
  type ExamEvaluationContext,
  type ExamEvaluationReport,
  type ExamFailureLayer,
  type ExamFamilyResult,
  type ExamRepairPath,
  type ExamRequestPlan,
  type ExamRunBudget,
  type ExamRunCaseResult,
  type ExamRunOutcome,
  type ExamRunRequest,
  type ExamTrialObservation,
  type ExamTrialOutcome,
  type ExamVerdict
} from "./examEvaluation"
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
