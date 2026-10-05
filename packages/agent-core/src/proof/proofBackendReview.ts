/**
 * **接一个证明后端之前必须先交的审查记录**（实施计划 N5）。
 *
 * ## 计划原文要求的是"先输出这些，再谈支持"
 *
 * > Proof spike：创建 `scripts/proof-spike/` 的 adapter smoke runner；**先输出后端版本/许可证/进程模型/
 * > WASM 或原生依赖/启动耗时/超时状态**，未通过依赖审查时只允许 `unsupported`。
 * >
 * > 依赖审查任务（**必须在 GREEN 前完成**）：记录许可证、进程/线程边界、WASM/原生依赖、缓存/沙箱、
 * > 启动时间和失败/超时行为；**没有审查结论不得接入默认构建**。
 *
 * 这一层把那句话变成**可执行的门**：接后端不再是"往数组里加一个名字"，而是**交一份填满的记录**。
 * `WIRED_PROOF_BACKENDS` 由通过的记录**推导**出来（见 `proofArtifact.ts`），所以"没审查就接上"这件事
 * 在结构上做不到 —— 而不是靠记性。
 *
 * ## 为什么必须有"版本"和"超时行为"这两栏
 *
 * - **版本**：证明产物的可信度挂在"哪个后端、哪个版本"上。只写 `lean4` 而不写版本，等于把一年后的
 *   另一个 `lean4` 也算进来 —— 那正是"同一份产物在不同后端下可信度不同"这件事被抹掉的地方。
 * - **超时/失败行为**：一个会在超时后**返回半成品证明**的后端，比一个直接失败的后端危险得多。
 *   所以这两栏问的不是性能，是**产物还值不值得信**。
 *
 * ## 今天这份表是**空的**，而且那不是缺陷
 *
 * 一个后端都没接，所以没有任何记录 —— 于是 `WIRED_PROOF_BACKENDS` 是空数组，
 * 于是任何产物都升不到 `formally_proved`。**这三句话是同一个事实的三种说法。**
 */

/** 审查记录点名的字段。计划里列的那些**一个都不能少**。 */
export const PROOF_BACKEND_REVIEW_FIELDS = [
  "name",
  "version",
  "license",
  "processModel",
  "nativeOrWasmDependencies",
  "startupBudgetMs",
  "timeoutPolicy",
  "failureBehaviour",
  "cacheAndSandbox",
  "verdict"
] as const

/**
 * 后端跑在哪儿。**显式枚举**而不是自由文本：这一栏的用途是让审查者一眼看出
 * "它会不会起子进程 / 要不要加载原生库"，自由文本做不到这件事。
 */
export type ProofProcessModel = "in-process" | "child-process" | "wasm" | "remote-service" | "none"
export const PROOF_PROCESS_MODELS: readonly ProofProcessModel[] = ["in-process", "child-process", "wasm", "remote-service", "none"]

export type ProofReviewVerdict = "passed" | "rejected" | "not-reviewed"

export interface ProofBackendReview {
  /** 后端名。与产物 `backend.name` **逐字**对应 —— 大小写不同就是另一个后端。 */
  name: string
  version: string
  license: string
  processModel: ProofProcessModel
  /** 原生 / WASM 依赖。**纯 JS 后端写空数组**，但这一栏必须存在（"查过了，没有"要写出来）。 */
  nativeOrWasmDependencies: readonly string[]
  /** 启动耗时预算（毫秒）。**必须是一个有限的非负数** —— 写"很快"不算。 */
  startupBudgetMs: number
  timeoutPolicy: string
  failureBehaviour: string
  cacheAndSandbox: string
  verdict: ProofReviewVerdict
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

/**
 * 逐条点名这份记录**哪里不够**。返回空数组才算填齐。
 *
 * 说明性文字（超时策略 / 失败行为 / 缓存与沙箱）只要求非空 —— **本层不判断它们写得对不对**，
 * 那是人的审查结论；本层只保证"没有一栏被悄悄跳过"。
 */
export function reviewProblems(review: unknown): string[] {
  if (review === null || typeof review !== "object" || Array.isArray(review)) return ["审查记录必须是一个对象"]
  const record = review as Record<string, unknown>
  const problems: string[] = []

  for (const field of PROOF_BACKEND_REVIEW_FIELDS) {
    if (!(field in record)) problems.push(`缺少字段 ${field}`)
  }
  if (problems.length > 0) return problems

  for (const field of ["name", "version", "license", "timeoutPolicy", "failureBehaviour", "cacheAndSandbox"] as const) {
    if (!nonEmptyString(record[field])) problems.push(`${field} 必须是非空字符串（"没查"不能写成空）`)
  }
  if (!PROOF_PROCESS_MODELS.includes(record.processModel as ProofProcessModel)) {
    problems.push(`processModel「${String(record.processModel)}」不在词表里：${PROOF_PROCESS_MODELS.join(" / ")}`)
  }
  if (!Array.isArray(record.nativeOrWasmDependencies)) {
    problems.push("nativeOrWasmDependencies 必须是数组（没有原生/WASM 依赖就写空数组，别省掉这一栏）")
  } else if (record.nativeOrWasmDependencies.some((entry) => !nonEmptyString(entry))) {
    problems.push("nativeOrWasmDependencies 里有空项")
  }
  if (typeof record.startupBudgetMs !== "number" || !Number.isFinite(record.startupBudgetMs) || record.startupBudgetMs < 0) {
    problems.push("startupBudgetMs 必须是有限的非负数（单位毫秒）")
  }
  if (!["passed", "rejected", "not-reviewed"].includes(record.verdict as string)) {
    problems.push(`verdict「${String(record.verdict)}」不在词表里：passed / rejected / not-reviewed`)
  }
  return problems
}

/**
 * **这份审查记录能不能让后端进默认构建** —— 只有"填齐了**并且**结论是 `passed`"才算。
 *
 * 两种"不算"要分清：**填不齐**（`reviewProblems` 非空）与**填齐了但结论不是 `passed`**
 *（例如评审发现许可证有问题）。两者都挡住接入，但理由不同。
 */
export function isReviewPassed(review: unknown): boolean {
  return reviewProblems(review).length === 0 && (review as ProofBackendReview).verdict === "passed"
}

/**
 * **交过审查记录的后端**（今天：**一个都没有** —— 因为一个后端都没接）。
 *
 * 接一个后端 = 往这里加一份**十栏填齐、`verdict: "passed"`** 的记录，
 * `WIRED_PROOF_BACKENDS` 会自动把它接上。**没有"偷偷改那个字符串数组"这条路** ——
 * 这正是本文件存在的理由。
 */
export const PROOF_BACKEND_REVIEWS: readonly ProofBackendReview[] = []