import type { DrawingIntentSourceRef } from "./drawingIntent"

export type ConstraintKind =
  | "distance"
  | "ratio"
  | "perpendicular"
  | "parallel"
  | "angle"
  | "incidence"
  | "collinear"
  | "coplanar"
  | "tangent"
  | "topology"
  | "fold_transform"

export type ConstraintStatus =
  | "satisfied"
  | "violated"
  | "unknown"
  | "repairable"
  | "inconsistent"
  | "underdetermined"

export interface ConstraintNode {
  readonly id: string
  readonly kind: ConstraintKind
  readonly targets: readonly string[]
  readonly scopeId: string
  readonly stateId: string
  readonly sourceRefs: readonly DrawingIntentSourceRef[]
  readonly status: ConstraintStatus
  readonly residual?: number
  readonly conflictWith?: readonly string[]
}

export interface PendingParameterVar {
  readonly name: string
  readonly entityId: string
  readonly scopeId: string
  readonly solvableFromConstraintIds: readonly string[]
  readonly kind: "solvable" | "missing"
}

export interface ConstraintGraph {
  readonly schemaVersion: "mathcanvas.constraint_graph.v1"
  readonly nodes: Record<string, ConstraintNode>
  readonly pendingVars: Record<string, PendingParameterVar>
}

export type TriStateVerdict = "accepted" | "repairable" | "blocked"

export function createConstraintGraph(): ConstraintGraph {
  return {
    schemaVersion: "mathcanvas.constraint_graph.v1",
    nodes: {},
    pendingVars: {}
  }
}

export function addConstraintNode(graph: ConstraintGraph, node: ConstraintNode): ConstraintGraph {
  return {
    ...graph,
    nodes: {
      ...graph.nodes,
      [node.id]: {
        ...node,
        targets: [...node.targets],
        sourceRefs: [...node.sourceRefs],
        ...(node.conflictWith === undefined ? {} : { conflictWith: [...node.conflictWith] })
      }
    }
  }
}

export function registerPendingParameterVar(
  graph: ConstraintGraph,
  variable: PendingParameterVar
): ConstraintGraph {
  return {
    ...graph,
    pendingVars: {
      ...graph.pendingVars,
      [variable.name]: {
        ...variable,
        solvableFromConstraintIds: [...variable.solvableFromConstraintIds]
      }
    }
  }
}

export function evaluateConstraintGraphStatus(graph: ConstraintGraph): TriStateVerdict {
  const nodes = Object.values(graph.nodes)
  const pending = Object.values(graph.pendingVars)

  if (nodes.some((n) => n.status === "inconsistent")) {
    return "blocked"
  }
  if (pending.some((v) => v.kind === "missing" || v.solvableFromConstraintIds.length === 0)) {
    return "blocked"
  }
  if (
    nodes.some((n) => n.status === "violated" || n.status === "repairable" || n.status === "unknown" || n.status === "underdetermined") ||
    pending.some((v) => v.kind === "solvable")
  ) {
    return "repairable"
  }
  return "accepted"
}

export function serializeConstraintGraph(graph: ConstraintGraph): string {
  return JSON.stringify(graph)
}

export function parseConstraintGraph(
  raw: string
): { readonly ok: true; readonly value: ConstraintGraph } | { readonly ok: false; readonly error: string } {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Record<string, unknown>).schemaVersion !== "mathcanvas.constraint_graph.v1" ||
      typeof (parsed as Record<string, unknown>).nodes !== "object" ||
      (parsed as Record<string, unknown>).nodes === null ||
      typeof (parsed as Record<string, unknown>).pendingVars !== "object" ||
      (parsed as Record<string, unknown>).pendingVars === null
    ) {
      return { ok: false, error: "invalid constraint graph payload" }
    }
    return { ok: true, value: parsed as ConstraintGraph }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
