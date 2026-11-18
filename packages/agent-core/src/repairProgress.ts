export type RepairProgressStopReason =
  | "satisfied"
  | "no_progress"
  | "stagnant_signature"
  | "preserved_obligation_regressed"
  | "max_rounds_reached"

export interface RepairProgressCheckInput {
  readonly id: string
  readonly kind?: string
  readonly status: string
  readonly detail?: string
  readonly targetEntities?: readonly string[]
}

export interface RepairTargetScope {
  readonly targetEntities: readonly string[]
  readonly targetConstraintIds: readonly string[]
  readonly preservedObligationIds: readonly string[]
  readonly failureSignature: string
}

export interface RepairScopeDirective {
  readonly allowRepair: boolean
  readonly round: number
  readonly stopReason?: RepairProgressStopReason
  readonly targetEntities: readonly string[]
  readonly targetConstraintIds: readonly string[]
  readonly preservedObligationIds: readonly string[]
  readonly signature: string
  readonly summary: string
}

export function formatTargetedRepairSummary(scope: RepairTargetScope & { readonly round: number }): string {
  const parts = [
    `targeted_repair(round=${scope.round})`,
    scope.targetConstraintIds.length > 0 ? `fix_constraints=[${scope.targetConstraintIds.join(", ")}]` : "fix_constraints=[]",
    scope.targetEntities.length > 0 ? `fix_entities=[${scope.targetEntities.join(", ")}]` : "fix_entities=[]",
    scope.preservedObligationIds.length > 0
      ? `preserve_passed=[${scope.preservedObligationIds.join(", ")}]`
      : "preserve_passed=[]"
  ]
  return parts.join("; ")
}

export function createTargetedRepairTracker(options: { maxRounds?: number } = {}) {
  const maxRounds = Math.max(0, Math.floor(options.maxRounds ?? 3))
  const seenSignatures = new Set<string>()
  const preservedPassedIds = new Set<string>()
  let round = 0
  let bestFailingCount: number | undefined
  let bestMaxResidual: number | undefined

  return {
    evaluate(input: {
      candidateHash: string
      checks: readonly RepairProgressCheckInput[]
      maxResidual?: number
    }): RepairScopeDirective {
      round += 1
      const passedChecks = input.checks.filter((c) => c.status === "passed")
      const failingChecks = input.checks.filter((c) => c.status !== "passed")

      const targetConstraintIds = [...new Set(failingChecks.map((c) => c.id))].sort()
      const entitySet = new Set<string>()
      for (const check of failingChecks) {
        if (check.targetEntities) {
          for (const ent of check.targetEntities) {
            if (ent.trim().length > 0) entitySet.add(ent.trim())
          }
        }
      }
      const targetEntities = [...entitySet].sort()

      const signature = `${input.candidateHash}::${failingChecks
        .map((c) => `${c.id}:${c.status}`)
        .sort()
        .join("|")}`

      if (failingChecks.length === 0) {
        return {
          allowRepair: false,
          round,
          stopReason: "satisfied",
          targetEntities: [],
          targetConstraintIds: [],
          preservedObligationIds: [...new Set(passedChecks.map((c) => c.id))].sort(),
          signature,
          summary: "all constraints passed"
        }
      }

      // 1. Guard previously passed obligations from regression.
      const failingSet = new Set(targetConstraintIds)
      for (const kept of preservedPassedIds) {
        if (failingSet.has(kept)) {
          return {
            allowRepair: false,
            round,
            stopReason: "preserved_obligation_regressed",
            targetEntities,
            targetConstraintIds,
            preservedObligationIds: [...preservedPassedIds].sort(),
            signature,
            summary: `preserved obligation regressed during repair: ${kept}`
          }
        }
      }

      for (const p of passedChecks) {
        preservedPassedIds.add(p.id)
      }
      const preservedObligationIds = [...preservedPassedIds].sort()

      // 2. Enforce round ceiling before examining progress metrics.
      if (round > maxRounds) {
        return {
          allowRepair: false,
          round,
          stopReason: "max_rounds_reached",
          targetEntities,
          targetConstraintIds,
          preservedObligationIds,
          signature,
          summary: `repair rounds reached ceiling (${round - 1}/${maxRounds})`
        }
      }

      // 3. Reject repeated candidate+failure signatures.
      if (seenSignatures.has(signature)) {
        return {
          allowRepair: false,
          round,
          stopReason: "stagnant_signature",
          targetEntities,
          targetConstraintIds,
          preservedObligationIds,
          signature,
          summary: `repeated failure signature without delta: ${signature}`
        }
      }
      seenSignatures.add(signature)

      // 4. Require monotonic decrease in failing count or maxResidual.
      const hasResidual = typeof input.maxResidual === "number" && Number.isFinite(input.maxResidual)
      if (bestFailingCount !== undefined) {
        const countImproved = failingChecks.length < bestFailingCount
        const residualImproved =
          hasResidual && bestMaxResidual !== undefined && input.maxResidual! < bestMaxResidual - 1e-9
        if (!countImproved && !residualImproved) {
          return {
            allowRepair: false,
            round,
            stopReason: "no_progress",
            targetEntities,
            targetConstraintIds,
            preservedObligationIds,
            signature,
            summary: `no monotonic repair progress (failing=${failingChecks.length}, best=${bestFailingCount})`
          }
        }
      }

      bestFailingCount =
        bestFailingCount === undefined ? failingChecks.length : Math.min(bestFailingCount, failingChecks.length)
      if (hasResidual) {
        bestMaxResidual =
          bestMaxResidual === undefined ? input.maxResidual! : Math.min(bestMaxResidual, input.maxResidual!)
      }

      return {
        allowRepair: true,
        round,
        targetEntities,
        targetConstraintIds,
        preservedObligationIds,
        signature,
        summary: formatTargetedRepairSummary({
          targetEntities,
          targetConstraintIds,
          preservedObligationIds,
          failureSignature: signature,
          round
        })
      }
    }
  }
}
