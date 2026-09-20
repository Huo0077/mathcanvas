import { describe, expect, it } from "vitest"

import { createRecoveryController, type RecoveryError, type RecoveryState } from "./recovery"

/**
 * Task 2.3 Step 1/4/5 的恢复部分。
 *
 * 这份用例的核心不是"能重试"，而是**什么情况下绝不自动重试** ——
 * 计划逐字点名了 auth / geometry / permission / contradictory-fact 四类。
 */
function state(overrides: Partial<RecoveryState> = {}): RecoveryState {
  return { attempts: 1, repairUsed: false, lastSignature: null, ...overrides }
}

function transport(status?: number): RecoveryError {
  return { class: "transport", status, message: `transport failed${status ? ` with ${status}` : ""}` }
}

describe("errors that are never retried automatically", () => {
  it("stops on an authentication failure and says why", () => {
    const decision = createRecoveryController().decide({ class: "auth", status: 401, message: "unauthorized" }, state())

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("auth_cannot_retry")
    expect(decision.budgetCost).toEqual({ network: 0, generation: 0 })
    // 理由要能直接给用户看：告诉他去修配置，而不是"出错了"。
    expect(decision.detail).toContain("密钥")
  })

  it("treats a 401 reported by the transport layer as an auth failure", () => {
    // 传输层只会报状态码；401 不该被当成"网络抖动"重试三次。
    const decision = createRecoveryController().decide(transport(401), state())

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("auth_cannot_retry")
  })

  it("stops on a permission failure", () => {
    const decision = createRecoveryController().decide({ class: "permission", message: "key lacks vision scope" }, state())

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("permission_cannot_retry")
  })

  it("stops on a geometry failure and points at the plan, not at retries", () => {
    const decision = createRecoveryController().decide({ class: "geometry", message: "section is degenerate" }, state())

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("geometry_needs_a_new_plan")
    expect(decision.safeRetry).toBe("revise_input")
  })

  it("stops on a contradictory fact and hands the decision to the user", () => {
    const decision = createRecoveryController().decide({ class: "contradictory_fact", message: "radius is both 3 and 5" }, state())

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("contradictory_fact_needs_the_user")
  })

  it("stops on cancellation without spending anything", () => {
    const decision = createRecoveryController().decide({ class: "cancelled", message: "user pressed stop" }, state())

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("cancelled_by_user")
    expect(decision.budgetCost.network).toBe(0)
  })

  it("does not retry an unclassified error, because guessing is what the plan forbids", () => {
    const decision = createRecoveryController().decide({ class: "unknown", message: "something odd" }, state())

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("unclassified_error_stops")
  })
})

describe("transport retries", () => {
  it("retries a 429 and charges the shared budget", () => {
    const decision = createRecoveryController().decide(transport(429), state())

    expect(decision.action).toBe("retry")
    expect(decision.reason).toBe("transport_retryable")
    // 每次重试都要花钱，所以决定里必须带上代价。
    expect(decision.budgetCost).toEqual({ network: 1, generation: 1 })
    expect(decision.safeRetry).toBe("same_request")
  })

  it("retries 5xx and a bare connectivity failure", () => {
    const controller = createRecoveryController()

    for (const status of [500, 502, 503, 504, undefined]) {
      expect(controller.decide(transport(status), state()).action, `status ${status}`).toBe("retry")
    }
  })

  it("does not retry a 400", () => {
    const decision = createRecoveryController().decide(transport(400), state())

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("transport_status_not_retryable")
  })

  it("stops once the attempt cap is reached instead of retrying forever", () => {
    const decision = createRecoveryController().decide(transport(503), state({ attempts: 3, maxAttempts: 3 }))

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("attempts_exhausted")
  })

  it("stops when the shared budget cannot afford another attempt", () => {
    const decision = createRecoveryController().decide(transport(503), state({ remaining: { network: 0, generation: 5 } }))

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("budget_exhausted")
  })

  it("respects a caller-provided attempt cap", () => {
    const decision = createRecoveryController().decide(transport(503), state({ attempts: 2, maxAttempts: 2 }))

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("attempts_exhausted")
  })
})

describe("schema repair is visible and one-time", () => {
  it("offers exactly one repair when the plan is malformed", () => {
    const decision = createRecoveryController().decide({ class: "schema", message: "envelope.actions[0].inputs.radius: expected a finite number" }, state())

    expect(decision.action).toBe("retry")
    expect(decision.reason).toBe("schema_repair_available")
    expect(decision.detail).toContain("字段路径")
  })

  it("stops when the repair was already used, even though retrying is possible", () => {
    // 第二次修复只是把同一句话再问一遍；把字段路径给用户看更有用。
    const decision = createRecoveryController().decide({ class: "schema", message: "still malformed" }, state({ repairUsed: true }))

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("schema_repair_already_used")
    expect(decision.safeRetry).toBe("revise_input")
  })

  it("does not spend the repair when there is no budget for it", () => {
    const decision = createRecoveryController().decide({ class: "schema", message: "malformed" }, state({ remaining: { network: 1, generation: 0 } }))

    expect(decision.action).toBe("stop")
    expect(decision.reason).toBe("budget_exhausted")
  })
})

describe("malformed streams refresh the context", () => {
  it("refreshes the context rather than resending the same request", () => {
    const decision = createRecoveryController().decide({ class: "malformed_stream", message: "stream ended mid-object" }, state())

    expect(decision.action).toBe("refresh_context")
    expect(decision.reason).toBe("malformed_stream_needs_fresh_context")
    expect(decision.safeRetry).toBe("refresh_context")
    expect(decision.budgetCost).toEqual({ network: 1, generation: 1 })
  })

  it("stops when the same stream damage happens twice in a row", () => {
    const controller = createRecoveryController()
    const error: RecoveryError = { class: "malformed_stream", message: "stream ended mid-object" }
    const first = controller.decide(error, state())
    const second = controller.decide(error, state({ attempts: 2, lastSignature: `${error.class}:none:${error.message}` }))

    expect(first.action).toBe("refresh_context")
    // 同样的失败再来一次说明"刷新"没帮上忙。
    expect(second.action).toBe("stop")
    expect(second.reason).toBe("attempts_exhausted")
  })
})

describe("decision shape", () => {
  it("always returns a reason, a detail and a safe-retry semantics", () => {
    const controller = createRecoveryController()
    const errors: RecoveryError[] = [
      { class: "auth", message: "x" },
      { class: "permission", message: "x" },
      { class: "geometry", message: "x" },
      { class: "contradictory_fact", message: "x" },
      { class: "cancelled", message: "x" },
      { class: "schema", message: "x" },
      { class: "malformed_stream", message: "x" },
      transport(429),
      transport(400),
      { class: "unknown", message: "x" }
    ]

    for (const error of errors) {
      const decision = controller.decide(error, state())
      expect(decision.reason, error.class).toBeTruthy()
      expect(decision.detail.length, error.class).toBeGreaterThan(0)
      expect(["none", "same_request", "refresh_context", "revise_input"]).toContain(decision.safeRetry)
      // 停下时不许收费。
      if (decision.action === "stop") expect(decision.budgetCost, error.class).toEqual({ network: 0, generation: 0 })
    }
  })
})
