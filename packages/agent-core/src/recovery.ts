import type { SafeRetry } from "./contracts"

/**
 * **有界恢复**（Task 2.3 Step 4/5）。
 *
 * 计划原文：`RecoveryController.decide(error, state): RetryDecision`
 * 返回 retry/refresh/revise/stop **with a reason and budget cost**；
 * "Retry only transport 429/5xx/connectivity within the shared budget;
 * never retry auth, geometry, permission, or contradictory-fact failures automatically."
 *
 * ## 这份文件就是一条策略表，而不是一堆散落的 `if`
 *
 * 为什么值得单独成模块：**"要不要再试一次"是花钱的决定**（每次尝试都吃网络与生成预算，
 * 而且用户要等）。散在各处的重试判断迟早会出现"认证失败也重试三次"或
 * "几何求解失败被当成网络抖动"，而这两种错误的代价完全不同：
 * 前者是白等，后者是**让模型再写一遍注定失败的几何**。
 *
 * ## 四类错误的处置，各有理由
 *
 * | 类别 | 处置 | 理由 |
 * | --- | --- | --- |
 * | `auth` / `permission` | **停** | 凭据或权限不对，重试一百次也一样；应当让用户去修配置 |
 * | `transport`（429 / 5xx / 连接中断） | **重试同一请求** | 唯一确定"再试可能就好"的一类 |
 * | `malformed_stream`（流中断 / 半个 JSON） | **刷新上下文后重试** | 模型与工具状态可能已经不同步，原样重发容易得到同样的半截输出 |
 * | `schema` | **一次可见修复，之后停** | 第二次修复等于把同一句话再问一遍；给用户看路径错误比继续烧预算有用 |
 * | `geometry` / `contradictory_fact` / `permission` | **停** | 计划点名不许自动重试：几何失败要改的是计划，不是重试次数 |
 *
 * ## 预算与状态
 *
 * 每次重试都带 `budgetCost`（默认 1 次网络 + 1 次生成），调用方据此扣预算；
 * 预算不够时**不加尝试地停**（`budget_exhausted`）—— 由调用方在扣减前询问，
 * 而不是先扣再发现不够（`budget.ts` 的同一条纪律）。
 */

export type RecoveryErrorClass =
  | "transport"
  | "auth"
  | "permission"
  | "schema"
  | "geometry"
  | "contradictory_fact"
  | "malformed_stream"
  | "cancelled"
  | "unknown"

export interface RecoveryError {
  class: RecoveryErrorClass
  /** HTTP 状态码（若来自传输层）。 */
  status?: number
  /** 给用户看的一句话。 */
  message: string
}

export type RetryAction = "stop" | "retry" | "refresh_context" | "revise_input"

export type RetryReasonCode =
  | "auth_cannot_retry"
  | "permission_cannot_retry"
  | "geometry_needs_a_new_plan"
  | "contradictory_fact_needs_the_user"
  | "cancelled_by_user"
  | "transport_retryable"
  | "transport_status_not_retryable"
  | "malformed_stream_needs_fresh_context"
  | "schema_repair_available"
  | "schema_repair_already_used"
  | "attempts_exhausted"
  | "budget_exhausted"
  | "unclassified_error_stops"

export interface RetryDecision {
  action: RetryAction
  reason: RetryReasonCode
  /** 人类可读的理由（会进运行记录，也用于向用户解释"为什么停下了"）。 */
  detail: string
  /** 这次决定要花掉的预算（`stop` 时为全 0）。 */
  budgetCost: { network: number; generation: number }
  /** 建议的 `SafeRetry` 语义（与 `ToolResult.recovery` 同一套）。 */
  safeRetry: SafeRetry
}

export interface RecoveryState {
  /** 本类错误已经尝试过几次（含第一次失败）。 */
  attempts: number
  /** schema 修复是否已经用过（计划要求**一次性**）。 */
  repairUsed: boolean
  /** 上一次错误是不是同一类同一个签名 —— 用来实现"同样失败就停"。 */
  lastSignature: string | null
  /** 剩余预算（调用方提供；`undefined` 表示不作预算判断）。 */
  remaining?: { network: number; generation: number }
  /** 每类错误最多尝试几次。 */
  maxAttempts?: number
}

export interface RecoveryController {
  decide(error: RecoveryError, state: RecoveryState): RetryDecision
}

/** 只有这三类传输错误值得再试一次。 */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])

const STOP: RetryDecision["budgetCost"] = { network: 0, generation: 0 }
/** 一次重试固定花掉一次网络往返与一次逻辑生成（修复也走同一条通道）。 */
const RETRY_COST: RetryDecision["budgetCost"] = { network: 1, generation: 1 }

function classify(error: RecoveryError): RecoveryErrorClass {
  if (error.class !== "transport") return error.class
  // 传输层报的是状态码时，按状态码细分：401/403 属于"不该重试"。
  if (error.status === 401 || error.status === 403) return "auth"
  return "transport"
}

function isRetryableTransport(error: RecoveryError, kind: RecoveryErrorClass): boolean {
  if (kind !== "transport") return false
  // 连接类错误没有状态码，属于可重试。
  if (error.status === undefined) return true
  return RETRYABLE_STATUSES.has(error.status)
}

function signatureOf(error: RecoveryError, kind: RecoveryErrorClass): string {
  return `${kind}:${error.status ?? "none"}:${error.message}`
}

export function createRecoveryController(): RecoveryController {
  return {
    decide(error, state) {
      const kind = classify(error)
      const maxAttempts = state.maxAttempts ?? 3
      const sameAsLast = state.lastSignature !== null && state.lastSignature === signatureOf(error, kind)

      // ---- 一律不自动重试的几类（计划逐字点名） ----
      if (kind === "auth") {
        return { action: "stop", reason: "auth_cannot_retry", detail: `认证失败（${error.status ?? "无状态码"}）：重试不会改变结果，请检查配置里的密钥或权限。`, budgetCost: STOP, safeRetry: "none" }
      }
      if (kind === "permission") {
        return { action: "stop", reason: "permission_cannot_retry", detail: "权限不足：需要先让用户授予或修好权限。", budgetCost: STOP, safeRetry: "none" }
      }
      if (kind === "geometry") {
        return { action: "stop", reason: "geometry_needs_a_new_plan", detail: "几何求解失败：要改的是计划（约束或尺寸），不是重试次数。", budgetCost: STOP, safeRetry: "revise_input" }
      }
      if (kind === "contradictory_fact") {
        return { action: "stop", reason: "contradictory_fact_needs_the_user", detail: "与已确认的事实矛盾：必须由用户决定信哪一条。", budgetCost: STOP, safeRetry: "revise_input" }
      }
      if (kind === "cancelled") {
        return { action: "stop", reason: "cancelled_by_user", detail: "用户取消了这次运行。", budgetCost: STOP, safeRetry: "none" }
      }

      // ---- schema：一次性可见修复 ----
      if (kind === "schema") {
        if (state.repairUsed) {
          return { action: "stop", reason: "schema_repair_already_used", detail: "已经做过一次格式修复，仍然不合法：请用户介入（第二次修复只是把同一句话再问一遍）。", budgetCost: STOP, safeRetry: "revise_input" }
        }
        if (!canAfford(state)) {
          return { action: "stop", reason: "budget_exhausted", detail: "预算不足以再做一次修复尝试。", budgetCost: STOP, safeRetry: "revise_input" }
        }
        return { action: "retry", reason: "schema_repair_available", detail: "格式不合法：给模型一次可见的修复机会（提示里带上精确的字段路径）。", budgetCost: RETRY_COST, safeRetry: "same_request" }
      }

      // ---- 流损坏：刷新上下文再试（原样重发容易得到同样的半截输出） ----
      if (kind === "malformed_stream") {
        if (sameAsLast) {
          return { action: "stop", reason: "attempts_exhausted", detail: "流再次损坏：刷新上下文也没有改善，停下让用户决定。", budgetCost: STOP, safeRetry: "revise_input" }
        }
        if (state.attempts >= maxAttempts) {
          return { action: "stop", reason: "attempts_exhausted", detail: `已经尝试 ${state.attempts} 次：不再自动重试。`, budgetCost: STOP, safeRetry: "revise_input" }
        }
        if (!canAfford(state)) {
          return { action: "stop", reason: "budget_exhausted", detail: "预算不足以刷新上下文重试。", budgetCost: STOP, safeRetry: "revise_input" }
        }
        return { action: "refresh_context", reason: "malformed_stream_needs_fresh_context", detail: "流在传输中损坏：先刷新场景上下文再重试。", budgetCost: RETRY_COST, safeRetry: "refresh_context" }
      }

      // ---- 传输：唯一"再试一次可能就好"的一类 ----
      if (isRetryableTransport(error, kind)) {
        if (state.attempts >= maxAttempts) {
          return { action: "stop", reason: "attempts_exhausted", detail: `传输失败已尝试 ${state.attempts} 次（上限 ${maxAttempts}）：停下并如实报告。`, budgetCost: STOP, safeRetry: "revise_input" }
        }
        if (!canAfford(state)) {
          return { action: "stop", reason: "budget_exhausted", detail: "预算已不足以再试一次传输。", budgetCost: STOP, safeRetry: "revise_input" }
        }
        return { action: "retry", reason: "transport_retryable", detail: `传输失败（${error.status ?? "连接中断"}）：在共享预算内重试同一请求。`, budgetCost: RETRY_COST, safeRetry: "same_request" }
      }

      if (kind === "transport") {
        // 有状态码但不在可重试集合里（例如 400）。
        return { action: "stop", reason: "transport_status_not_retryable", detail: `传输层返回 ${error.status}：这类错误重试不会改变结果。`, budgetCost: STOP, safeRetry: "revise_input" }
      }

      // ---- 兜底：不认识的错误**不自动重试** ----
      return { action: "stop", reason: "unclassified_error_stops", detail: `未归类的错误（${error.message}）：默认不自动重试，交给人判断。`, budgetCost: STOP, safeRetry: "revise_input" }
    }
  }
}

function canAfford(state: RecoveryState): boolean {
  if (!state.remaining) return true
  return state.remaining.network >= 1 && state.remaining.generation >= 1
}
