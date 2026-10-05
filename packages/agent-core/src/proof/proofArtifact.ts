import type { ClaimEvidenceStatus } from "../claimEvidence"
import { canonicalContentHash } from "../hashing"
import type { ProofGoalKind } from "./proofGoals"

/**
 * **形式证明出口的边界**（实施计划 Phase N5 的第一步；设计 2026-10-04 §4C）。
 *
 * ## 这一层只做一件事：让"有证明"这句话**不可能随口说**
 *
 * 计划原文的判据是：`verified_instance` / `sampled` **不能**变成 `formally_proved`；
 * 伪造、缺字段、版本不匹配的产物一律**拒绝**。这一层就是把那条判据落成可执行的东西。
 *
 * 它**不做**形式化，也**不理解**证明正文 —— 正文明文照搬，一个字都不解释。真正的证明由后端
 * （Lean/mathlib 或 AlphaGeometry/Newclid 风格的 adapter）产生。**本批没有接任何后端**：
 * `proof/` 里目前只有"产物长什么样、凭什么算数"，adapter 归后一步（而且要**先过依赖与许可证审查**，
 * 见计划 N5 的那条硬要求）。
 *
 * ## 为什么校验**必须**带一个 `expectation`
 *
 * 只校验产物自身是**不够的**：一份"证明了别的东西"的合格产物可以被贴到这条 claim 上，
 * 而它看起来处处合法。所以 `verifyProofArtifact` **要求**调用方给出期望的 `claimId` 与
 * `inputHash` —— 没有"只看看形状就算通过"的那条路（fail-closed by construction）。
 *
 * ## 四个结局一个都不能少，也一个都不能多
 *
 * `verified` / `failed` / `unsupported` / `timeout`。**拒收一份产物不是第五种结局**：
 * 那意味着"这次没有得到证明"，所以报 `failed`，而**为什么拒**逐条落在 `reasons` 的
 * 机器可读 `code` 上（"它不是证明"与"它证明了别的东西"是两件事，不许混成一句）。
 */

/**
 * **这个构建里真正接上的证明后端**（今天是**空**）。
 *
 * ## 为什么必须有这张名单（上一版漏掉的那一环）
 *
 * 上一版只校验产物的**形状、版本与绑定** —— 而一份**手工编的**产物可以把这些都满足：
 * `backend.name` 写 `lean4`、`proof` 里放一段字符串、`result.status` 写 `verified`。
 * 校验器**没有任何办法**从产物本身判断"这段话真的被 Lean 内核接受过"。
 * 所以"有没有证明"这件事最终只能由**我们这边**回答：这个后端**接上了没有**。
 * 名单是空的，今天就没有任何产物能升到 `formally_proved` —— 这不是保守，这是事实。
 *
 * ## 要把一个后端加进这张名单，先过这几关（计划 N5 的硬要求）
 *
 * 许可证与依赖审查、进程 / 线程边界、WASM 或原生依赖、启动耗时、超时与失败行为 ——
 * 做法见 `docs/acceptance/next-phase-flag-and-dependency-review.md`。
 * **没有审查结论不许加进来。**
 */
export const WIRED_PROOF_BACKENDS: readonly string[] = []

export interface ProofVerifyOptions {
  /**
   * 允许哪些后端。**缺省就是"一个都没接"**（`WIRED_PROOF_BACKENDS`），
   * 于是今天任何 `verified` 产物都过不去。测试可以注入一个假后端来验"这条路本身是通的"。
   */
  wiredBackends?: readonly string[]
}
/** 产物格式版本。**不匹配就拒**，不做"兼容猜测"。 */
export const PROOF_ARTIFACT_VERSION = 1

/** 后端自己的判定。**只有 `verified` 能让一条 claim 升到 `formally_proved`。** */
export type ProofCheckStatus = "verified" | "failed" | "unsupported" | "timeout"
export const PROOF_CHECK_STATUSES: readonly ProofCheckStatus[] = ["verified", "failed", "unsupported", "timeout"]

export interface ProofBackendIdentity {
  /** 后端名（例如 `lean4` / `newclid`）。空名字一律拒 —— 说不清是谁证的不算证。 */
  name: string
  version: string
}

export interface ProofArtifact {
  version: number
  /** 这份产物证明的是**哪一条** claim。 */
  claimId: string
  /** 它是对**哪一份输入**证出来的（见 `proofInputHash`）。输入变了，产物就失效。 */
  inputHash: string
  backend: ProofBackendIdentity
  /** 后端自己的证明正文。本模块**不解释**它。 */
  proof: string
  result: { status: ProofCheckStatus; detail: string }
}

/** 调用方期望这份产物证明什么。**三个字段都必须给** —— 见文件头"为什么必须带 expectation"。 */
export interface ProofExpectation {
  claimId: string
  inputHash: string
  /**
   * 这条 goal 属于哪个**已声明**的短目标（`proofGoals.ts` 的封闭词表）。
   *
   * **`null` 表示"它不在我们声称支持的首批里"**，此时无论产物多合法都**不许**升级 ——
   * 这就是"表外目标绝不变成 `formally_proved`"那条判据的落点。刻意不做成可选参数：
   * 调用方**必须**显式回答这个问题，而不是靠默认值蒙过去。
   */
  goalKind: ProofGoalKind | null
}

export type ProofRejectionCode =
  /** 根本不是对象（模型直接给了一句话 / 一个数组）。 */
  | "not-an-object"
  /** 缺必需字段。 */
  | "missing-field"
  /** 字段类型不对。 */
  | "wrong-type"
  /** `result.status` 不在四个结局里。 */
  | "unknown-status"
  /** 产物版本与本模块不一致。 */
  | "version-mismatch"
  /** 声称 `verified` 却拿不出正文。 */
  | "empty-proof"
  /** 声称 `verified` 却说不清是哪个后端（空名字）。 */
  | "unnamed-backend"
  /** 产物证明的是另一条 claim。 */
  | "claim-mismatch"
  /** 产物是对另一份输入证出来的 —— 输入变了，它就不再证明这件事。 */
  | "input-mismatch"
  /** 这条 goal 不在我们声称支持的首批短目标里（`proofGoals.ts`）—— 表外目标绝不升级。 */
  | "undeclared-goal"
  /** 产物自称来自一个**没有接进这个构建**的后端：形状再合格也不等于真的验过。 */
  | "backend-not-wired"
  /** 产物自身合法，是**后端**报的 failed / unsupported / timeout。 */
  | "backend-verdict"

export interface ProofRejection {
  code: ProofRejectionCode
  detail: string
}

export interface ProofVerification {
  status: ProofCheckStatus
  /** `verified` 时为空；其余情况逐条说明。 */
  reasons: ProofRejection[]
  /** 只有结构、版本、绑定**全部**通过时才是那份产物；否则 `null`。 */
  artifact: ProofArtifact | null
}

/**
 * **证明输入的指纹**：题设原话 + 这条 claim 的原话 + 目标（可选：文档指纹）。
 *
 * 用仓库既有的 `canonicalContentHash`（与别处**同一份**规范化与散列），不另写一套 ——
 * 两套散列会在"输入到底变没变"这件事上给出两个答案。
 *
 * **本版已知边界**：`documentFingerprint` 是可选参数，而"一份证明到底该绑到多细的输入上"
 *（只绑原话？还是连坐标/文档一起绑？）**没有裁决** —— 见 `docs/current-status.md` §四 F。
 * 调用方现在必须显式传它关心的东西，而不是指望本函数替它决定。
 */
export function proofInputHash(input: { prompt: string; claimSourceText: string; goal?: string; documentFingerprint?: string }): string {
  return canonicalContentHash({
    prompt: input.prompt,
    claim: input.claimSourceText,
    goal: input.goal ?? null,
    document: input.documentFingerprint ?? null
  })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function reject(status: ProofCheckStatus, code: ProofRejectionCode, detail: string): ProofVerification {
  return { status, reasons: [{ code, detail }], artifact: null }
}

/**
 * **校验一份产物**：形状 → 版本 → 绑定 → 后端判定。
 *
 * 只要任何一步不过，返回的 `artifact` 就是 `null` —— 调用方拿不到"半个产物"去贴到别处。
 * 输入来自不可信的一侧（模型），所以这里**不抛异常**：坏形状退化成 `failed` + `reasons`。
 */
export function verifyProofArtifact(artifact: unknown, expectation: ProofExpectation, options: ProofVerifyOptions = {}): ProofVerification {
  const record = asRecord(artifact)
  if (record === null) return reject("failed", "not-an-object", "证明产物必须是一个对象。")

  for (const field of ["version", "claimId", "inputHash", "backend", "proof", "result"]) {
    if (!(field in record)) return reject("failed", "missing-field", `证明产物缺少字段 ${field}。`)
  }
  if (typeof record.version !== "number") return reject("failed", "wrong-type", "version 必须是数字。")
  if (typeof record.claimId !== "string" || typeof record.inputHash !== "string") {
    return reject("failed", "wrong-type", "claimId 与 inputHash 必须是字符串。")
  }
  if (typeof record.proof !== "string") return reject("failed", "wrong-type", "proof 必须是字符串。")

  const backend = asRecord(record.backend)
  if (backend === null || typeof backend.name !== "string" || typeof backend.version !== "string") {
    return reject("failed", "wrong-type", "backend 必须是 { name, version } 且两者都是字符串。")
  }
  const result = asRecord(record.result)
  if (result === null || typeof result.detail !== "string") {
    return reject("failed", "wrong-type", "result 必须是 { status, detail } 且 detail 是字符串。")
  }
  if (!PROOF_CHECK_STATUSES.includes(result.status as ProofCheckStatus)) {
    return reject("failed", "unknown-status", `result.status「${String(result.status)}」不在词表里：${PROOF_CHECK_STATUSES.join(" / ")}`)
  }
  const status = result.status as ProofCheckStatus

  /**
   * **表外目标绝不升级**：这一步与产物自身是否合法无关，所以放在绑定检查之前 ——
   * 一份"证明了别的东西"的产物会先撞上这条，报的是"这个目标我们不声称支持"，
   * 而不是让调用方误以为"产物有问题、但目标本身是支持的"。
   */
  if (expectation.goalKind === null) {
    return reject("failed", "undeclared-goal", "这条目标不在形式证明出口声称支持的首批短目标里（见 proofGoals.ts 的支持矩阵）：不许升级成 formally_proved。")
  }
  if (record.version !== PROOF_ARTIFACT_VERSION) {
    return reject("failed", "version-mismatch", `产物版本 ${record.version} 与本模块的 ${PROOF_ARTIFACT_VERSION} 不一致：不做兼容猜测。`)
  }
  if (record.claimId !== expectation.claimId) {
    return reject("failed", "claim-mismatch", `产物证明的是「${record.claimId}」，而这里是「${expectation.claimId}」。`)
  }
  if (record.inputHash !== expectation.inputHash) {
    return reject("failed", "input-mismatch", "产物是对另一份输入证出来的：输入变了，它就不再证明这件事。")
  }

  const verified: ProofArtifact = {
    version: record.version,
    claimId: record.claimId,
    inputHash: record.inputHash,
    backend: { name: backend.name, version: backend.version },
    proof: record.proof,
    result: { status, detail: result.detail }
  }

  if (status !== "verified") {
    // 产物自身合法，是**后端**说没证成 —— 如实转述，不替它加分也不替它减分。
    return { status, reasons: [{ code: "backend-verdict", detail: result.detail }], artifact: null }
  }
  if (backend.name.trim().length === 0) {
    return reject("failed", "unnamed-backend", "声称 verified 却说不清是哪个后端：没有名字的证明不算证明。")
  }
  if (record.proof.trim().length === 0) {
    return reject("failed", "empty-proof", "声称 verified 却拿不出证明正文。")
  }
  /**
   * **最后一道，也是最要紧的一道**：这个后端**接上了没有**。
   * 前面几条只能证明"这份产物长得像一份证明"；只有这一条问的是"我们真的跑过它吗"。
   */
  const wired = options.wiredBackends ?? WIRED_PROOF_BACKENDS
  if (!wired.includes(backend.name)) {
    return reject("failed", "backend-not-wired", `后端「${backend.name}」没有接进这个构建（当前接上的：${wired.length === 0 ? "一个都没有" : wired.join(" / ")}）：形状合格的产物不等于真的验过。`)
  }

  return { status: "verified", reasons: [], artifact: verified }
}

export interface ProofEvidenceOutcome {
  /**
   * 这条 claim 应该显示的**证据状态**。没有合格产物时**恒等于 `base`** ——
   * 这就是计划那条判据（`verified_instance` / `sampled` 不能变成 `formally_proved`）的落点。
   */
  status: ClaimEvidenceStatus
  verification: ProofVerification
}

/**
 * **把一条 claim 的证据状态升级成 `formally_proved`** —— 只有在该 claim 有一份
 * `verified`、且绑定到**同一份输入**的产物时才升。其余一切情况原样返回 `base`。
 *
 * 传进来的 `artifacts` 是不可信的一侧给的（可能是模型贴的），所以逐份校验；
 * 多份里只要有一份真通过就用它，一份都没有就带上**第一份失败的原因**（便于诊断）。
 */
export function evidenceStatusWithProof(
  base: ClaimEvidenceStatus,
  expectation: ProofExpectation,
  artifacts: readonly unknown[],
  options: ProofVerifyOptions = {}
): ProofEvidenceOutcome {
  let firstFailure: ProofVerification | null = null
  for (const artifact of artifacts) {
    const verification = verifyProofArtifact(artifact, expectation, options)
    if (verification.status === "verified") return { status: "formally_proved", verification }
    if (firstFailure === null) firstFailure = verification
  }
  return {
    status: base,
    verification: firstFailure ?? reject("unsupported", "backend-verdict", "没有任何与本条 claim、这份输入绑定的证明产物。")
  }
}
