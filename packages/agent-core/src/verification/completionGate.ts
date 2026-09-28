import type { VerificationReport } from "../contracts"

/**
 * **"没有验证证据就不许进入确认"**（Phase 3 / Task 3.3）。
 *
 * ## 这一层挡的是什么
 *
 * 计划的判据原话：**"Forbid inferring task success from revision growth, draft stage success,
 * or model text claims."** 以及 **"没有验证证据时，Agent 只能停在修复、等待或失败，
 * 不能报告完成。"**
 *
 * 在它之前，协调器从 `validating` 直接走到 `awaiting_confirmation`，**中间没有任何检查**：
 * 只要草稿暂存成功就摆出确认面板。于是那三种"不是证据的东西"事实上都被当成了证据：
 * - 草稿版本涨了（`draftVersion += 1`）—— 只说明暂存发生了；
 * - 动作编译通过了（`compilePlan.ok`）—— 只说明**计划合法**；
 * - 模型说"已完成" —— 那是自述。
 *
 * ## 为什么这是一个**纯函数**、而不是直接写进协调器
 *
 * 判据（"什么算证据"）与编排（"在哪个阶段检查"）是两件事，混在一起就没法单独测：
 * 要验证"没有证据时不许确认"得跑完一整个运行。抽成纯函数之后，每一条拒绝理由
 * 都能用一行输入钉住。
 *
 * ## 判据（精确到可以逐条反驳）
 *
 * `passed` 的报告**必须**自带证据：
 * - 至少一条 check（空报告不是证据）；
 * - 每条 check 都是 `passed`（只要有一条不是，就不能说"验证通过"）；
 * - 报告里不能有 `not_supported`（"我们没验"不能被读成"验过了"）。
 *
 * 缺一项就**不放行**，并按缺什么给出可执行的下一步 —— 一个只说"验证失败"的判据
 * 会让模型反复重试同一件事。
 */

/** 放行 / 拦截的结果。`proceed` 为假时 `reason` 一定可读、可执行。 */
export type VerificationGate =
  | { proceed: true; report: VerificationReport }
  | { proceed: false; reason: string; code: VerificationGateCode; report: VerificationReport | null; next_actions: readonly string[] }

export type VerificationGateCode =
  /** 根本没有验证报告（协调器没接线 / 验证器没跑）。 */
  | "no_verification_report"
  /** 报告是 `failed`：答案在文档里不成立。 */
  | "verification_failed"
  /** 报告是 `unknown` / `approximate`：信息不足以判定。 */
  | "verification_inconclusive"
  /** 报告含 `not_supported`：有一部分我们没验。 */
  | "verification_incomplete"
  /** `passed` 但没有任何 check：空报告不算证据。 */
  | "verification_has_no_checks"
  /** `passed` 但有一条 check 不是 passed：报告自相矛盾。 */
  | "verification_self_inconsistent"

/**
 * **判据的唯一定义处**。协调器、用例、以及将来的门禁脚本都读它 ——
 * 判据写两遍就会出现"协调器放行、门禁拒绝"这种最难查的分叉。
 */
export function verificationGate(report: VerificationReport | null | undefined): VerificationGate {
  if (report === null || report === undefined) {
    return {
      proceed: false,
      code: "no_verification_report",
      reason: "the run produced no verification report, so nothing proves the task was achieved",
      report: null,
      next_actions: ["run the deterministic task verifier against the candidate document before offering confirmation"]
    }
  }

  /**
   * **优先级刻意与 `taskVerification` 的汇总口径一致**：
   * `failed` > `not_supported` > `unknown`/`approximate` > 自相矛盾。
   *
   * 为什么"自相矛盾"排在最后，而不是最先：一份 `status: "passed"` 却含 `failed` 的
   * 报告，**最诚实的解读是"它其实失败了"**（`status` 那个字段填错了），
   * 而不是"我们无法判断"。先报 `verification_self_inconsistent` 会把一个
   * **确定的失败**说成一次**记账错误**，而后者听起来像可以忽略。
   * 只有剩下的情况（`passed` 里混着 `not_supported` 之外的怪状态）才归为契约违反。
   */
  const failed = report.checks.filter((check) => check.status === "failed")
  if (report.status === "failed" || failed.length > 0) {
    return {
      proceed: false,
      code: "verification_failed",
      reason: `verification failed: ${failed[0]?.detail ?? report.next_actions[0] ?? "the document does not satisfy the task"}`,
      report,
      // 下一步来自**报告自己的检查项**，不是这里另编一句 —— 否则协调器会丢掉具体位置。
      next_actions: report.checks.filter((check) => check.status === "failed").map((check) => `${check.id}: ${check.detail}`).slice(0, 3)
    }
  }

  const notSupported = report.checks.filter((check) => check.status === "not_supported")
  if (report.status === "not_supported" || notSupported.length > 0) {
    return {
      proceed: false,
      code: "verification_incomplete",
      reason: `verification is incomplete: ${notSupported[0]?.detail ?? "some checks have no judge"}`,
      report,
      next_actions: ["either implement a judge for these checks or report them to the user as unverified"]
    }
  }

  /**
   * 到这里已经没有 `failed` 与 `not_supported` 了。若 `status` 仍自称 `passed`
   * 而还剩别的非 `passed` check（例如 `unknown`），那才是**报告自相矛盾**：
   * 判据说"通过"，证据说"不知道"。
   */
  const nonPassing = report.checks.filter((check) => check.status !== "passed")
  if (report.status === "passed" && nonPassing.length > 0) {
    return {
      proceed: false,
      code: "verification_self_inconsistent",
      reason: `the report claims passed but includes ${nonPassing.length} non-passing check(s): ${nonPassing[0].detail}`,
      report,
      next_actions: ["fix the report; a passed status must not coexist with non-passing checks"]
    }
  }

  if (report.status === "unknown" || report.status === "approximate") {
    return {
      proceed: false,
      code: "verification_inconclusive",
      reason: `verification is ${report.status}: ${report.checks.find((check) => check.status === report.status)?.detail ?? "the evidence is not conclusive"}`,
      report,
      next_actions: ["gather the missing evidence, or stop and tell the user this cannot be confirmed"]
    }
  }

  /**
   * 走到这里 `status === "passed"`。但**光看 status 不够**：
   * 一份"通过但一条 check 都没有"的报告是最危险的一种 —— 它长得像成功。
   */
  if (report.checks.length === 0) {
    return {
      proceed: false,
      code: "verification_has_no_checks",
      reason: "the report claims passed but carries no checks, so it is not evidence",
      report,
      next_actions: ["produce at least one concrete check before claiming the task is done"]
    }
  }

  return { proceed: true, report }
}

/**
 * **一次运行的验证请求**（Task 3.1 的 `TaskSpec` 在这里落地为最小形状）。
 *
 * 刻意只收"判据需要什么"，而不是"我们手头有什么"：这一层要能回答
 * "这份候选文档满足了用户的哪几条验收条件"，因此它只要**验收条件**与**候选文档**。
 *
 * 与 `AgentTaskFixture.expected.acceptance` 的关系：那是**评测夹具**用的形状
 * （字符串 `type` + 可选 `expected`），这里是**运行期**用的判别联合。
 * 两者不合并，因为夹具要能被非 TypeScript 的读者（与将来的真实 provider 评测）
 * 直接写出来，而运行期需要穷尽的类型检查。
 */
export interface TaskVerificationRequest {
  runId: string
  /** 这一份候选文档属于哪一版草稿 —— 证据必须绑在版本上（同 `draftStore` 的 `previewHash` 口径）。 */
  draftVersion: number
  /** 什么时候可以声称"做完了"。空数组**不放行**（没有验收条件的运行没有成功可言）。 */
  acceptance: readonly string[]
}
