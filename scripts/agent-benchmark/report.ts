import { assertNoSecrets } from "./redaction"

/**
 * **benchmark 运行记录与报告**（实施计划 N4 的 `BenchmarkRun` / `BenchmarkReport`）。
 *
 * ## 三条硬规矩（缺一条就**抛**，不静默降级）
 *
 * 1. **必需字段必须"在"**：`caseId` / `provider` / `model` / `seed` / `mode` / `status` /
 *    `evidence` / `cost` / `latency` 九个字段一个都不能少。
 *    "没测"要写成**显式的 `null`**（`cost` / `latency` 允许），**不是**把这个键删掉 ——
 *    删掉之后，"没测"与"忘了写"在报告里长得一模一样。
 * 2. **模式必须标识**：`mode` 只能是 `deterministic_local` 或 `real_provider`。
 *    把两者混在一张表里报出来，等于拿离线确定性回归冒充模型准确率 —— 这个项目已经
 *    为此写过好几次警告。
 * 3. **claim 必须有证据**：`evidence` 里每一条都要有非空的 `claim` / `status` / `evidence`。
 *    唯一的例外是 `status: "not_measured"`（那一轮什么都没测，逼它给出证据等于逼它编）。
 *
 * ## 为什么 `provider` 允许为 `null`
 *
 * 计划原文写"必须含 provider/model"，而 `deterministic_local` **本来就没有 provider**。
 * 所以口径是：**键必须在**；值是 `null` 表示"这一轮没有真实 provider 参与"，
 * 而 `real_provider` 模式下 provider / model **必须是非空字符串**。
 * 这样既没有编造一个 provider 名字，也没有把两者混在一起。
 */

export const BENCHMARK_MODES = ["deterministic_local", "real_provider"] as const
export type BenchmarkMode = (typeof BENCHMARK_MODES)[number]

/**
 * **这一轮真正跑了哪一层**。
 *
 * 加这个字段是被"写 runner"逼出来的，不是设计洁癖：原来只有一套结局词（见证层的
 * `verified_instance` / `no_witness` / …），而"只跑原话 → 题设的抽取"那一轮**根本没有见证结论**
 * —— 拿见证词去描述抽取结果是**范畴错误**，而一律写 `not_measured` 又会把"跑了抽取、
 * 只是没跑求解"说成"什么都没测"。两者都会让报告读起来是绿的、实际什么都没说。
 */
export const BENCHMARK_LAYERS = ["extraction", "witness"] as const
export type BenchmarkLayer = (typeof BENCHMARK_LAYERS)[number]

/** 全部结局词（跨层并集）。 */
export type BenchmarkRunStatus =
  | "extracted" | "partial" | "empty"
  | "verified_instance" | "unverified_instance" | "no_witness" | "clarification"
  | "not_measured" | "error"

/**
 * **每一层各自的词表**。
 *
 * - `extraction`：`extracted`（子句都被处理）/ `partial`（有抽出来的、也有读不出的残留）/
 *   `empty`（一条都没抽出来）；
 * - `witness`：三个见证结论与 `clarification` 与 `agent-core` **同词**（那边改了这里要跟着改）；
 * - `not_measured` / `error` 两层都有：前者是"这一轮没有测量"（例如没有凭据），
 *   后者是"跑了但失败了"。
 */
export const BENCHMARK_STATUSES_BY_LAYER: Record<BenchmarkLayer, readonly BenchmarkRunStatus[]> = {
  extraction: ["extracted", "partial", "empty", "not_measured", "error"],
  witness: ["verified_instance", "unverified_instance", "no_witness", "clarification", "not_measured", "error"]
}

export const BENCHMARK_RUN_REQUIRED_FIELDS = [
  "caseId", "provider", "model", "seed", "mode", "layer", "status", "evidence", "cost", "latency"
] as const

export interface BenchmarkEvidenceEntry {
  claim: string
  status: string
  evidence: string
}

export interface BenchmarkRun {
  caseId: string
  provider: string | null
  model: string | null
  seed: number
  mode: BenchmarkMode
  layer: BenchmarkLayer
  status: BenchmarkRunStatus
  evidence: BenchmarkEvidenceEntry[]
  cost: { currency: string; amount: number } | null
  latency: { totalMs: number } | null
}

export interface BenchmarkModeReport {
  runs: BenchmarkRun[]
  byStatus: Record<string, number>
  byLayer: Record<string, number>
}

export interface BenchmarkReport {
  deterministicLocal: BenchmarkModeReport
  realProvider: BenchmarkModeReport & { measured: number; notMeasured: number }
}

export class BenchmarkReportError extends Error {
  constructor(problems: readonly string[]) {
    super(`运行记录不合法（${problems.length} 处）：\n- ${problems.join("\n- ")}`)
    this.name = "BenchmarkReportError"
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function countByStatus(runs: readonly BenchmarkRun[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const run of runs) counts[run.status] = (counts[run.status] ?? 0) + 1
  return counts
}

function countByLayer(runs: readonly BenchmarkRun[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const run of runs) counts[run.layer] = (counts[run.layer] ?? 0) + 1
  return counts
}

/**
 * 校验一批运行记录并分组。
 *
 * @param where 出错时点名的位置。
 */
export function buildBenchmarkReport(runs: readonly unknown[], where = "运行记录"): BenchmarkReport {
  const problems: string[] = []
  const accepted: BenchmarkRun[] = []

  for (const [index, raw] of runs.entries()) {
    const label = `${where} 第 ${index + 1} 条`
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      problems.push(`${label} 必须是一个对象`)
      continue
    }
    const record = raw as Record<string, unknown>

    // ① 必需字段必须"在"（`in` 判存在性，不是判真假 —— `null` 是合法值）。
    const missing = BENCHMARK_RUN_REQUIRED_FIELDS.filter((field) => !(field in record))
    if (missing.length > 0) {
      problems.push(`${label} 缺少必需字段：${missing.join("、")}（"没测"要写显式的 null，不能删掉这个键）`)
      continue
    }
    // ② 模式必须标识。
    if (!BENCHMARK_MODES.includes(record.mode as BenchmarkMode)) {
      problems.push(`${label} 的 mode「${String(record.mode)}」未标识：只能是 ${BENCHMARK_MODES.join(" / ")} —— 两种模式混报就是拿离线回归冒充模型准确率`)
      continue
    }
    const mode = record.mode as BenchmarkMode
    // ②' 层也必须标识：见证层的结局词描述不了抽取层。
    if (!BENCHMARK_LAYERS.includes(record.layer as BenchmarkLayer)) {
      problems.push(`${label} 的 layer「${String(record.layer)}」未标识：只能是 ${BENCHMARK_LAYERS.join(" / ")} —— 见证层的结局词描述不了抽取层`)
      continue
    }
    const layer = record.layer as BenchmarkLayer
    if (!BENCHMARK_STATUSES_BY_LAYER[layer].includes(record.status as BenchmarkRunStatus)) {
      problems.push(`${label} 在 ${layer} 层里的 status「${String(record.status)}」不在词表里：${BENCHMARK_STATUSES_BY_LAYER[layer].join(" / ")}`)
      continue
    }
    const status = record.status as BenchmarkRunStatus
    if (typeof record.seed !== "number" || !Number.isFinite(record.seed)) {
      problems.push(`${label} 的 seed 必须是有限数`)
      continue
    }
    /**
     * `real_provider` 要说得出 provider / model —— **除非这一轮什么都没测**。
     * 那样写 `null` 才是诚实的：没有凭据时逼出一个模型名字，等于伪造"这轮用了什么"。
     */
    if (mode === "real_provider" && status !== "not_measured" && (!nonEmptyString(record.provider) || !nonEmptyString(record.model))) {
      problems.push(`${label} 是 real_provider，provider / model 必须是非空字符串（这正是在测什么模型；确实没测就写 status: not_measured）`)
      continue
    }
    // ③ claim 必须有证据；唯一的例外是"这一轮什么都没测"。
    if (!Array.isArray(record.evidence)) {
      problems.push(`${label} 的 evidence 必须是数组`)
      continue
    }
    const evidence = record.evidence as unknown[]
    if (status !== "not_measured") {
      if (evidence.length === 0) {
        problems.push(`${label} 的 evidence 是空的：除了 not_measured，每一轮都必须给出"凭什么这么说"`)
        continue
      }
      const incomplete = evidence.filter((entry) => {
        if (entry === null || typeof entry !== "object") return true
        const candidate = entry as Record<string, unknown>
        return !nonEmptyString(candidate.claim) || !nonEmptyString(candidate.status) || !nonEmptyString(candidate.evidence)
      })
      if (incomplete.length > 0) {
        problems.push(`${label} 有 ${incomplete.length} 条 claim 缺证据：每条都要有非空的 claim / status / evidence`)
        continue
      }
    }

    try {
      assertNoSecrets(JSON.stringify(record), label)
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
      continue
    }

    accepted.push({
      caseId: record.caseId as string,
      provider: nonEmptyString(record.provider) ? record.provider : null,
      model: nonEmptyString(record.model) ? record.model : null,
      seed: record.seed,
      mode,
      layer,
      status,
      evidence: evidence as BenchmarkEvidenceEntry[],
      cost: (record.cost ?? null) as BenchmarkRun["cost"],
      latency: (record.latency ?? null) as BenchmarkRun["latency"]
    })
  }

  if (problems.length > 0) throw new BenchmarkReportError(problems)

  const local = accepted.filter((run) => run.mode === "deterministic_local")
  const real = accepted.filter((run) => run.mode === "real_provider")
  return {
    deterministicLocal: { runs: local, byStatus: countByStatus(local), byLayer: countByLayer(local) },
    realProvider: {
      runs: real,
      byStatus: countByStatus(real),
      byLayer: countByLayer(real),
      measured: real.filter((run) => run.status !== "not_measured").length,
      notMeasured: real.filter((run) => run.status === "not_measured").length
    }
  }
}
