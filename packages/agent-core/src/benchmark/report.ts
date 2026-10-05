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
 *
 * **`planning` 是第三个这样的范畴**（N4b；用户 2026-10-05 裁决 A）：应用内那次真实
 * provider 评测测的是"模型给出的计划有没有被 `compilePlan` 接受"，它**既不是抽取也不是见证** ——
 * 没有题设子句可数、也没有候选可核验。所以它同样必须是**自己一层、自己一套词**，
 * 而不是塞进上面两层里凑一个看起来正常的数字：那样报告会读起来是绿的、实际什么都没说
 * （这正是本文件 `:29-36` 警告的那种范畴错误）。
 */
export const BENCHMARK_LAYERS = ["extraction", "witness", "planning"] as const
export type BenchmarkLayer = (typeof BENCHMARK_LAYERS)[number]

/** 全部结局词（跨层并集）。 */
export type BenchmarkRunStatus =
  | "extracted" | "partial" | "empty"
  | "verified_instance" | "unverified_instance" | "no_witness" | "clarification"
  | "planned" | "rejected"
  | "not_measured" | "error"

/**
 * **每一层各自的词表**。
 *
 * - `extraction`：`extracted`（子句都被处理）/ `partial`（有抽出来的、也有读不出的残留）/
 *   `empty`（一条都没抽出来）；
 * - `witness`：三个见证结论与 `clarification` 与 `agent-core` **同词**（那边改了这里要跟着改）；
 * - `planning`（N4b）：`planned` / `rejected` —— 含义见下面那段，**不许含糊**；
 * - `not_measured` / `error` 每一层都有：前者是"这一轮没有测量"（例如没有凭据），
 *   后者是"跑了但失败了"。
 *
 * ## `planning` 层四个词的确切含义
 *
 * - **`planned`**：`compilePlan` 返回 `ok === true`，**并且**它产出的信封是 `kind: "plan"`。
 *   判据只有编译器那一个返回值：**不看模型自述**（"我觉得这个计划对"不算），
 *   也不需要金标准（这正是用户选这条口径的理由 —— 接受与否是客观的）。
 * - **`rejected`**：**没被接受**。它覆盖两种，`evidence` 里都带**真实原文**，读者能分辨是哪种：
 *   ① 编译器拒了（`ok === false`，逐条诊断的 `code@path: detail`）；
 *   ② 模型根本没给出计划（`ok === true` 但信封是 `clarification` / `answer`）。
 *   ②也算 `rejected` 而不是 `planned`：这一层测的是"**计划**被编译接受"，
 *   把澄清记成接受会让"没给计划"读起来像"计划通过了"——错的方向必须朝保守那边偏（fail-closed）。
 * - **`error`**：这一条题在跑的过程中**抛了**（`evidence` 带错误消息原文）。
 * - **`not_measured`**：这一轮**什么都没测**（没有 provider / 没有凭据），
 *   显式写 `null` 的 `provider` / `model` —— 这是 `real_provider` 唯一允许缺身份的一支
 *   （见本文件 `:262-268` 那条判据）。**没有凭据时不许"跳过"，也不许编一个数字**。
 */
export const BENCHMARK_STATUSES_BY_LAYER: Record<BenchmarkLayer, readonly BenchmarkRunStatus[]> = {
  extraction: ["extracted", "partial", "empty", "not_measured", "error"],
  witness: ["verified_instance", "unverified_instance", "no_witness", "clarification", "not_measured", "error"],
  planning: ["planned", "rejected", "not_measured", "error"]
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

/**
 * **每题最多几轮**（实施计划 N4 第 4 条：「每题最多 3 轮」）。
 *
 * 按 `(mode, caseId)` 计：两种模式是**两次独立评测**（一次离线回归、一次真实模型），各自上限
 * `MAX_ROUNDS_PER_CASE`。超了**整份拒收** —— 一份"某一题跑了 9 轮"的报告会让聚合数字失去可比性，
 * 而它看起来完全正常。
 */
export const MAX_ROUNDS_PER_CASE = 3

/**
 * 抽取层里 **residue（没被可靠解析的子句）** 在 `evidence[].status` 上用的记号。
 *
 * **单源**：`run.test.ts` 构造 residue 证据时用它，`report.ts` 统计覆盖率时也用它 ——
 * 不然"哪条算 residue"就会有两份判断。
 */
export const EXTRACTION_RESIDUE_STATUS = "unverified"

/**
 * **题设覆盖率**：变成给定义的子句 ÷（给定义 + residue）。
 *
 * 口径写在这里，因为**这是本仓自己的定义**，不是行业标准：
 * - 只看**抽取层**（见证层的 evidence 讲的是候选，不是子句）；
 * - `not_measured` 的轮次不进统计；
 * - 一条子句都没读到（`total === 0`）时 `rate` 是 **`null` 而不是 0** ——
 *   "没读到任何子句"与"读到的全都核验不了"是两件事。
 */
/**
 * **抽取率（题级）**：至少抽出一条给定义的题数 ÷ 总题数。
 *
 * **与 `BenchmarkPremiseCoverage` 不是一回事**，所以两个名字分开、定义各写一遍：
 * - 这一条是**题级**的 —— "这道题有没有读懂"（分子是题数）；
 * - `premiseCoverage` 是**子句级**的 —— "读出来的子句里有多少真的落成了给定义"（分子是子句数）。
 *
 * 一道题可以"读懂了但有 5 条子句没核验"，也可以"一条都没读懂" —— 两个比率会给出不同答案，
 * 混成一个数就会把"没读懂"与"读懂了但没核验"说成同一件事。
 *
 * `total === 0` 时 `rate` 是 `null`（没有题就没有率），不是 0。
 */
export interface BenchmarkExtractionRate {
  covered: number
  total: number
  rate: number | null
}
export interface BenchmarkPremiseCoverage {
  obligations: number
  residue: number
  rate: number | null
}
export interface BenchmarkModeReport {
  runs: BenchmarkRun[]
  byStatus: Record<string, number>
  byLayer: Record<string, number>
  premiseCoverage: BenchmarkPremiseCoverage
  extractionRate: BenchmarkExtractionRate
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

function extractionRate(runs: readonly BenchmarkRun[]): BenchmarkExtractionRate {
  // 只看抽取层、只算跑过的轮次；**按题去重**（同一题跑多轮不该把分母撑大）。
  const extraction = runs.filter((run) => run.layer === "extraction" && run.status !== "not_measured")
  const caseIds = [...new Set(extraction.map((run) => run.caseId))]
  const covered = new Set(extraction.filter((run) => run.status !== "empty").map((run) => run.caseId))
  return { covered: covered.size, total: caseIds.length, rate: caseIds.length === 0 ? null : covered.size / caseIds.length }
}
function premiseCoverage(runs: readonly BenchmarkRun[]): BenchmarkPremiseCoverage {
  const extraction = runs.filter((run) => run.layer === "extraction" && run.status !== "not_measured")
  let obligations = 0
  let residue = 0
  for (const run of extraction) {
    for (const entry of run.evidence) {
      if (entry.status === EXTRACTION_RESIDUE_STATUS) residue += 1
      else obligations += 1
    }
  }
  const total = obligations + residue
  return { obligations, residue, rate: total === 0 ? null : obligations / total }
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
    // ②' 层也必须标识：每一层有自己的结局词表，跨层用词会被拒（拿见证词描述抽取层是范畴错误）。
    if (!BENCHMARK_LAYERS.includes(record.layer as BenchmarkLayer)) {
      /**
       * 这句**刻意不点名"哪两层"**（2026-10-05 N4b 改）：加层之前它写的是
       * "见证层的结局词描述不了抽取层"，于是加进第三层之后，那句话读起来像"只有这两层"。
       * 层名清单已经由 `${BENCHMARK_LAYERS.join(" / ")}` 给全，后半句要说的是**道理**
       *（每一层各有词表），不是再抄一遍名单 —— 下次再加层，这句不用改。
       */
      problems.push(`${label} 的 layer「${String(record.layer)}」未标识：只能是 ${BENCHMARK_LAYERS.join(" / ")} —— 每一层有自己的结局词表，跨层用词会被拒`)
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

  /**
   * **每题最多 `MAX_ROUNDS_PER_CASE` 轮**（计划 N4 第 4 条）。放在形状校验之后：
   * 形状问题先报，读者才不会被"轮数超限"引开。
   */
  const roundsByKey = new Map<string, number>()
  for (const run of accepted) {
    const key = `${run.mode}\u0000${run.caseId}`
    roundsByKey.set(key, (roundsByKey.get(key) ?? 0) + 1)
  }
  const overCap = [...roundsByKey.entries()].filter(([, count]) => count > MAX_ROUNDS_PER_CASE)
  if (overCap.length > 0) {
    throw new BenchmarkReportError(overCap.map(([key, count]) => {
      const [mode, caseId] = key.split("\u0000")
      return `${caseId} 在 ${mode} 下记了 ${count} 轮，超过上限 ${MAX_ROUNDS_PER_CASE}（否则聚合数字失去可比性）`
    }))
  }
  const local = accepted.filter((run) => run.mode === "deterministic_local")
  const real = accepted.filter((run) => run.mode === "real_provider")
  return {
    deterministicLocal: { runs: local, byStatus: countByStatus(local), byLayer: countByLayer(local), premiseCoverage: premiseCoverage(local), extractionRate: extractionRate(local) },
    realProvider: {
      runs: real,
      byStatus: countByStatus(real),
      byLayer: countByLayer(real),
      premiseCoverage: premiseCoverage(real),
      extractionRate: extractionRate(real),
      measured: real.filter((run) => run.status !== "not_measured").length,
      notMeasured: real.filter((run) => run.status === "not_measured").length
    }
  }
}
