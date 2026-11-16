import type { Budget, BudgetKind, BudgetDecision, ExamRunBudget } from "@draw/agent-core"

type CappedBudget = Budget & {
  beforeProviderRequest: (amount?: number) => boolean
}

export function budgetWithProviderRequestCap(inner: Budget, outer: ExamRunBudget): CappedBudget {
  // Retry/tool-continuation paths pre-reserve network budget through `consume`.
  // The guard consumes only requests that reach the actual transport boundary.
  let preReservedRequests = 0
  return {
    consume(kind: BudgetKind, amount = 1): BudgetDecision {
      const internal = inner.consume(kind, amount)
      if (!internal.ok || kind !== "network") return internal
      if (outer.consumeRequest(amount)) {
        preReservedRequests += amount
        return internal
      }
      return { ok: false, kind, requested: amount, remaining: outer.remainingRequests(), reason: "exceeds_limit" }
    },
    consumeAll(items) {
      const netAmount = items
        .filter((item) => item.kind === "network")
        .reduce((sum, item) => sum + (item.amount ?? 1), 0)
      if (netAmount > outer.remainingRequests()) {
        return { ok: false, kind: "network", requested: netAmount, remaining: outer.remainingRequests(), reason: "exceeds_limit" }
      }
      const internal = inner.consumeAll(items)
      if (!internal.ok || netAmount <= 0) return internal
      if (outer.consumeRequest(netAmount)) {
        preReservedRequests += netAmount
        return internal
      }
      return { ok: false, kind: "network", requested: netAmount, remaining: outer.remainingRequests(), reason: "exceeds_limit" }
    },
    beforeProviderRequest(amount = 1) {
      if (!Number.isInteger(amount) || amount <= 0) return false
      if (preReservedRequests >= amount) {
        preReservedRequests -= amount
        return true
      }
      return outer.consumeRequest(amount)
    },
    beginStage: () => inner.beginStage(),
    remaining(kind) {
      return kind === "network" ? Math.min(inner.remaining(kind), outer.remainingRequests()) : inner.remaining(kind)
    },
    snapshot: () => inner.snapshot(),
    exhausted: () => inner.exhausted() || outer.remainingRequests() <= 0
  }
}
