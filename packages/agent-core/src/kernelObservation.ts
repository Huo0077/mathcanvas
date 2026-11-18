import type { ConstraintGraph, ConstraintStatus, TriStateVerdict } from "./constraintGraph"
import { evaluateConstraintGraphStatus } from "./constraintGraph"
import type { EntityGraph } from "./entityGraph"

export interface KernelConstraintReading {
  readonly id: string
  readonly status: ConstraintStatus
  readonly residual?: number
}

export interface KernelObservation {
  readonly status: TriStateVerdict
  readonly entityCount: number
  readonly resolvedEntityCount: number
  readonly blockedEntityIds: readonly string[]
  readonly constraintReadings: readonly KernelConstraintReading[]
  readonly pendingParamNames: readonly string[]
  readonly repairHints: readonly string[]
  readonly blockers: readonly string[]
}

export function buildKernelObservation(input: {
  readonly entities: EntityGraph
  readonly constraints: ConstraintGraph
  readonly repairHints?: readonly string[]
  readonly blockers?: readonly string[]
}): KernelObservation {
  const entityValues = Object.values(input.entities.nodes)
  const blockedEntities = entityValues.filter((e) => e.status === "blocked").map((e) => e.id)
  const resolvedCount = entityValues.filter((e) => e.status === "resolved").length
  const constraintNodes = Object.values(input.constraints.nodes)
  const pendingNames = Object.keys(input.constraints.pendingVars)

  const blockers = [...(input.blockers ?? [])]
  for (const bId of blockedEntities) {
    blockers.push(`blocked_entity:${bId}`)
  }

  let status = evaluateConstraintGraphStatus(input.constraints)
  if (blockers.length > 0) {
    status = "blocked"
  } else if ((input.repairHints?.length ?? 0) > 0 && status === "accepted") {
    status = "repairable"
  }

  return {
    status,
    entityCount: entityValues.length,
    resolvedEntityCount: resolvedCount,
    blockedEntityIds: blockedEntities,
    constraintReadings: constraintNodes.map((c) => ({
      id: c.id,
      status: c.status,
      ...(c.residual === undefined ? {} : { residual: c.residual })
    })),
    pendingParamNames: pendingNames,
    repairHints: [...(input.repairHints ?? [])],
    blockers
  }
}
