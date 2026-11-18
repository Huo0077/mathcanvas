import type { DrawingEntityKind, DrawingIntentSourceRef } from "./drawingIntent"

export type EntityStatus = "declared" | "derived" | "resolved" | "blocked"

export interface EntityNode {
  readonly id: string
  readonly kind: DrawingEntityKind
  readonly label?: string
  readonly scopeId: string
  readonly stateId: string
  readonly hostEntityId?: string
  readonly sourceRefs: readonly DrawingIntentSourceRef[]
  readonly status: EntityStatus
  readonly candidateHash?: string
}

export interface EntityGraph {
  readonly schemaVersion: "mathcanvas.entity_graph.v1"
  readonly nodes: Record<string, EntityNode>
}

export type EntityScopeAccessOutcome =
  | { readonly status: "accepted"; readonly entity: EntityNode }
  | { readonly status: "repairable"; readonly reason: string; readonly placeholderId: string }
  | { readonly status: "blocked"; readonly reason: string }

export function createEntityGraph(): EntityGraph {
  return {
    schemaVersion: "mathcanvas.entity_graph.v1",
    nodes: {}
  }
}

export function declareEntityNode(
  graph: EntityGraph,
  input: Omit<EntityNode, "status"> & { readonly status?: EntityStatus }
): EntityGraph {
  const node: EntityNode = {
    id: input.id,
    kind: input.kind,
    ...(input.label === undefined ? {} : { label: input.label }),
    scopeId: input.scopeId,
    stateId: input.stateId,
    ...(input.hostEntityId === undefined ? {} : { hostEntityId: input.hostEntityId }),
    sourceRefs: [...input.sourceRefs],
    status: input.status ?? "declared",
    ...(input.candidateHash === undefined ? {} : { candidateHash: input.candidateHash })
  }
  return {
    ...graph,
    nodes: { ...graph.nodes, [node.id]: node }
  }
}

export function transitionEntityStatus(
  graph: EntityGraph,
  entityId: string,
  status: EntityStatus,
  options: { readonly candidateHash?: string } = {}
): EntityGraph {
  const existing = graph.nodes[entityId]
  if (!existing) return graph
  const updated: EntityNode = {
    ...existing,
    status,
    ...(options.candidateHash === undefined ? {} : { candidateHash: options.candidateHash })
  }
  return {
    ...graph,
    nodes: { ...graph.nodes, [entityId]: updated }
  }
}

export function resolveEntityScopeAccess(
  graph: EntityGraph,
  query: {
    readonly entityId: string
    readonly consumerScopeId: string
    readonly subquestions: readonly { readonly id: string; readonly dependsOn: readonly string[] }[]
    readonly sourceRefs?: readonly DrawingIntentSourceRef[]
  }
): EntityScopeAccessOutcome {
  const node = graph.nodes[query.entityId]
  if (!node) {
    if ((query.sourceRefs?.length ?? 0) > 0) {
      return {
        status: "repairable",
        reason: `undeclared_entity_ref:${query.entityId}:placeholder_with_source_ref`,
        placeholderId: query.entityId
      }
    }
    return {
      status: "blocked",
      reason: `undeclared_entity_ref:${query.entityId}:no_source_ref`
    }
  }

  if (node.scopeId === "shared" || node.scopeId === query.consumerScopeId) {
    return { status: "accepted", entity: node }
  }

  const subq = query.subquestions.find((s) => s.id === query.consumerScopeId)
  if (subq && subq.dependsOn.includes(node.scopeId)) {
    return { status: "accepted", entity: node }
  }

  return {
    status: "blocked",
    reason: `cross_scope_violation:${query.consumerScopeId}->${node.scopeId}:${node.id}`
  }
}

export function serializeEntityGraph(graph: EntityGraph): string {
  return JSON.stringify(graph)
}

export function parseEntityGraph(
  raw: string
): { readonly ok: true; readonly value: EntityGraph } | { readonly ok: false; readonly error: string } {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as Record<string, unknown>).schemaVersion !== "mathcanvas.entity_graph.v1" ||
      typeof (parsed as Record<string, unknown>).nodes !== "object" ||
      (parsed as Record<string, unknown>).nodes === null
    ) {
      return { ok: false, error: "invalid entity graph payload" }
    }
    return { ok: true, value: parsed as EntityGraph }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
