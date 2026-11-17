import {
  evaluateFunctionWithDomain,
  evaluateSymbolicDerivative,
  rotatePointAboutHinge
} from "@draw/geometry-kernel"
import type { DraftAction } from "@draw/scene-graph"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { compileConstructionDag, type DrawingEntityKind, type DrawingIntentNode } from "./drawingIntent"
import { irClauseSummaryForPrompt, type IrPromptClauseSummary } from "./obligationIR"
import { constructPerpendicularPyramid } from "./solver/perpendicularPyramid"
import { constructRegularSquarePyramid } from "./solver/regularPyramid"
import { constructRightPrism } from "./solver/prism"
import { constructTetrahedron } from "./solver/tetrahedron"

export const DS_INTENT_SCHEMA_VERSION = "mathcanvas.ds_intent.v1" as const

export const DS_CONSTRUCTION_STRATEGIES = [
  "conic_from_equation_or_properties",
  "function_curve_and_tangent",
  "planar_point_on_host",
  "planar_line_or_segment",
  "solid_base_and_prism_or_pyramid",
  "solid_point_on_edge_or_face",
  "solid_fold_along_hinge",
  "infeasible_disclosure"
] as const

export type DsConstructionStrategyKind = (typeof DS_CONSTRUCTION_STRATEGIES)[number]

export interface DsSourceSpan {
  text: string
  start?: number
  end?: number
}

export interface DsIntentEntity {
  id: string
  kind: DrawingEntityKind
  label?: string
  scopeId: string
  stateId: string
  hostEntityId?: string
  dependencyIds?: string[]
  sourceSpan?: DsSourceSpan
  params?: Record<string, unknown>
}

export interface DsIntentRelation {
  kind: string
  targets: string[]
  value?: number | string
  scopeId: string
  stateId: string
  sourceSpan?: DsSourceSpan
}

export interface DsIntentSubquestion {
  id: string
  dependsOn: string[]
  stateId: string
  relations: string[]
  sourceSpan?: DsSourceSpan
}

export interface DsConstructionStrategy {
  nodeId: string
  outputEntityId: string
  outputKind: DrawingEntityKind
  strategy: DsConstructionStrategyKind
  scopeId: string
  stateId: string
  hostEntityId?: string
  dependencyIds: string[]
  foldPhase?: "pre_fold" | "post_fold"
  params?: Record<string, unknown>
  assumptions?: string[]
  sourceSpan?: DsSourceSpan
}

export interface DsIntentUnknown {
  kind: "missing_figure" | "underdetermined" | "ambiguous_relation" | "unsupported_feature"
  scopeId: string
  detail: string
  blocking: boolean
}

export interface DsDrawingIntent {
  schemaVersion: typeof DS_INTENT_SCHEMA_VERSION
  goal: string
  workspaceHint?: "plane" | "conics" | "geometry3d"
  entities: DsIntentEntity[]
  givenRelations: DsIntentRelation[]
  subquestions: DsIntentSubquestion[]
  constructionStrategies: DsConstructionStrategy[]
  unknowns: DsIntentUnknown[]
}

export type DsIntentDiagnosticCode =
  | "invalid_schema"
  | "unsupported_strategy"
  | "undeclared_entity_ref"
  | "cross_scope_violation"
  | "unsourced_constant"
  | "hand_computed_vertices_forbidden"
  | "pre_fold_host_violation"
  | "cyclic_dependency"
  | "missing_host"
  | "wrong_host_kind"

export interface DsIntentDiagnostic {
  code: DsIntentDiagnosticCode
  path: string
  detail: string
}

const VALID_ENTITY_KINDS = new Set<DrawingEntityKind>([
  "point", "segment", "line", "ray", "polygon", "solid",
  "conic", "circle", "function", "tangent", "focus", "fold_state"
])
const VALID_STRATEGIES = new Set<string>(DS_CONSTRUCTION_STRATEGIES)
const TRIVIAL_SCALARS = new Set([0, 1, -1, 2, 90])

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function asNonEmptyStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null
}

function hasValidSourceOrAssumption(
  span: unknown,
  assumptions: unknown
): boolean {
  const hasSpan = isPlainObj(span) && typeof span.text === "string" && span.text.trim().length > 0
  const hasAssump = Array.isArray(assumptions) && assumptions.some((a) => typeof a === "string" && a.trim().length > 0)
  return hasSpan || hasAssump
}

function containsNonTrivialScalar(params: Record<string, unknown> | undefined): boolean {
  if (!params) return false
  for (const [k, v] of Object.entries(params)) {
    if (k === "domain" || k === "axis" || k === "sides" || k === "open") continue
    if (typeof v === "number" && Number.isFinite(v) && !TRIVIAL_SCALARS.has(v)) return true
  }
  return false
}

function canReferenceScope(
  dependentScope: string,
  targetScope: string,
  subqById: ReadonlyMap<string, DsIntentSubquestion>
): boolean {
  if (dependentScope === targetScope || targetScope === "shared") return true
  const depSub = subqById.get(dependentScope)
  return depSub !== undefined && depSub.dependsOn.includes(targetScope)
}

/** Strictly parses and validates a DS structured construction intent before DAG compilation. */
export function parseAndValidateDsDrawingIntent(
  input: unknown,
  prompt?: string
):
  | { ok: true; value: DsDrawingIntent; executionOrder: DrawingIntentNode[]; irSummary: IrPromptClauseSummary | null }
  | { ok: false; diagnostics: DsIntentDiagnostic[] } {
  const diagnostics: DsIntentDiagnostic[] = []
  if (!isPlainObj(input)) {
    return { ok: false, diagnostics: [{ code: "invalid_schema", path: "intent", detail: "intent must be a plain object" }] }
  }
  if (input.schemaVersion !== DS_INTENT_SCHEMA_VERSION) {
    diagnostics.push({ code: "invalid_schema", path: "intent.schemaVersion", detail: `expected schemaVersion ${DS_INTENT_SCHEMA_VERSION}` })
  }
  const goal = asNonEmptyStr(input.goal)
  if (!goal) {
    diagnostics.push({ code: "invalid_schema", path: "intent.goal", detail: "goal must be a non-empty string" })
  }
  if (!Array.isArray(input.entities) || !Array.isArray(input.givenRelations) || !Array.isArray(input.subquestions) || !Array.isArray(input.constructionStrategies) || !Array.isArray(input.unknowns)) {
    diagnostics.push({ code: "invalid_schema", path: "intent", detail: "entities, givenRelations, subquestions, constructionStrategies, and unknowns must be arrays" })
    return { ok: false, diagnostics }
  }

  const subquestions: DsIntentSubquestion[] = []
  const subqById = new Map<string, DsIntentSubquestion>()
  for (let i = 0; i < input.subquestions.length; i += 1) {
    const raw = input.subquestions[i]
    if (!isPlainObj(raw) || !asNonEmptyStr(raw.id) || !Array.isArray(raw.dependsOn) || !asNonEmptyStr(raw.stateId) || !Array.isArray(raw.relations)) {
      diagnostics.push({ code: "invalid_schema", path: `intent.subquestions[${i}]`, detail: "invalid subquestion entry" })
      continue
    }
    const sub: DsIntentSubquestion = {
      id: String(raw.id).trim(),
      dependsOn: raw.dependsOn.filter((x): x is string => typeof x === "string"),
      stateId: String(raw.stateId).trim(),
      relations: raw.relations.filter((x): x is string => typeof x === "string"),
      ...(isPlainObj(raw.sourceSpan) && typeof raw.sourceSpan.text === "string" ? { sourceSpan: { text: raw.sourceSpan.text } } : {})
    }
    subquestions.push(sub)
    subqById.set(sub.id, sub)
  }

  const entities: DsIntentEntity[] = []
  const declaredIds = new Set<string>()
  const entityScope = new Map<string, string>()

  for (let i = 0; i < input.entities.length; i += 1) {
    const raw = input.entities[i]
    const id = isPlainObj(raw) ? asNonEmptyStr(raw.id) : null
    const kind = isPlainObj(raw) && typeof raw.kind === "string" && VALID_ENTITY_KINDS.has(raw.kind as DrawingEntityKind)
      ? (raw.kind as DrawingEntityKind)
      : null
    const scopeId = isPlainObj(raw) ? asNonEmptyStr(raw.scopeId) : null
    const stateId = isPlainObj(raw) ? asNonEmptyStr(raw.stateId) : null
    if (!id || !kind || !scopeId || !stateId) {
      diagnostics.push({ code: "invalid_schema", path: `intent.entities[${i}]`, detail: "entity requires valid id, kind, scopeId, stateId" })
      continue
    }
    declaredIds.add(id)
    entityScope.set(id, scopeId)
    entities.push({
      id,
      kind,
      scopeId,
      stateId,
      ...(typeof raw.label === "string" ? { label: raw.label } : {}),
      ...(typeof raw.hostEntityId === "string" ? { hostEntityId: raw.hostEntityId } : {}),
      ...(Array.isArray(raw.dependencyIds) ? { dependencyIds: raw.dependencyIds.filter((x: unknown): x is string => typeof x === "string") } : {}),
      ...(isPlainObj(raw.sourceSpan) && typeof raw.sourceSpan.text === "string" ? { sourceSpan: { text: raw.sourceSpan.text } } : {}),
      ...(isPlainObj(raw.params) ? { params: raw.params } : {})
    })
  }

  for (let i = 0; i < entities.length; i += 1) {
    const ent = entities[i]!
    if (ent.hostEntityId !== undefined) {
      if (!declaredIds.has(ent.hostEntityId)) {
        diagnostics.push({ code: "undeclared_entity_ref", path: `intent.entities[${i}].hostEntityId`, detail: `undeclared host entity "${ent.hostEntityId}"` })
      } else {
        const hostScope = entityScope.get(ent.hostEntityId)!
        if (!canReferenceScope(ent.scopeId, hostScope, subqById)) {
          diagnostics.push({ code: "cross_scope_violation", path: `intent.entities[${i}].scopeId`, detail: `entity "${ent.id}" (scope ${ent.scopeId}) cannot host on "${ent.hostEntityId}" (scope ${hostScope})` })
        }
      }
    }
  }

  const givenRelations: DsIntentRelation[] = []
  for (let i = 0; i < input.givenRelations.length; i += 1) {
    const raw = input.givenRelations[i]
    if (!isPlainObj(raw) || !asNonEmptyStr(raw.kind) || !Array.isArray(raw.targets) || !asNonEmptyStr(raw.scopeId) || !asNonEmptyStr(raw.stateId)) {
      diagnostics.push({ code: "invalid_schema", path: `intent.givenRelations[${i}]`, detail: "invalid relation entry" })
      continue
    }
    const targets = raw.targets.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    for (const target of targets) {
      if (!declaredIds.has(target)) {
        diagnostics.push({ code: "undeclared_entity_ref", path: `intent.givenRelations[${i}].targets`, detail: `relation references undeclared entity "${target}"` })
      } else {
        const tScope = entityScope.get(target)!
        if (!canReferenceScope(String(raw.scopeId), tScope, subqById)) {
          diagnostics.push({ code: "cross_scope_violation", path: `intent.givenRelations[${i}].scopeId`, detail: `relation in scope "${String(raw.scopeId)}" cannot bind entity "${target}" from "${tScope}"` })
        }
      }
    }
    if (typeof raw.value === "number" && Number.isFinite(raw.value) && !TRIVIAL_SCALARS.has(raw.value) && !hasValidSourceOrAssumption(raw.sourceSpan, undefined)) {
      diagnostics.push({ code: "unsourced_constant", path: `intent.givenRelations[${i}].value`, detail: `numeric relation value ${raw.value} requires sourceSpan` })
    }
    givenRelations.push({
      kind: String(raw.kind).trim(),
      targets,
      scopeId: String(raw.scopeId).trim(),
      stateId: String(raw.stateId).trim(),
      ...(typeof raw.value === "number" || typeof raw.value === "string" ? { value: raw.value } : {}),
      ...(isPlainObj(raw.sourceSpan) && typeof raw.sourceSpan.text === "string" ? { sourceSpan: { text: raw.sourceSpan.text } } : {})
    })
  }

  const strategies: DsConstructionStrategy[] = []
  const dagNodes: DrawingIntentNode[] = []
  const unknowns: DsIntentUnknown[] = input.unknowns
    .filter((u): u is Record<string, unknown> => isPlainObj(u) && typeof u.kind === "string" && typeof u.detail === "string")
    .map((u) => ({
      kind: (["missing_figure", "underdetermined", "ambiguous_relation", "unsupported_feature"].includes(u.kind as string)
        ? u.kind
        : "underdetermined") as DsIntentUnknown["kind"],
      scopeId: typeof u.scopeId === "string" ? u.scopeId : "shared",
      detail: String(u.detail),
      blocking: Boolean(u.blocking)
    }))

  const hasBlockingUnknown = unknowns.some((u) => u.blocking)

  for (let i = 0; i < input.constructionStrategies.length; i += 1) {
    const raw = input.constructionStrategies[i]
    if (!isPlainObj(raw) || !asNonEmptyStr(raw.nodeId) || !asNonEmptyStr(raw.outputEntityId) || typeof raw.outputKind !== "string" || !VALID_ENTITY_KINDS.has(raw.outputKind as DrawingEntityKind) || typeof raw.strategy !== "string" || !asNonEmptyStr(raw.scopeId) || !asNonEmptyStr(raw.stateId) || !Array.isArray(raw.dependencyIds)) {
      diagnostics.push({ code: "invalid_schema", path: `intent.constructionStrategies[${i}]`, detail: "invalid construction strategy entry" })
      continue
    }
    if (!VALID_STRATEGIES.has(raw.strategy)) {
      diagnostics.push({ code: "unsupported_strategy", path: `intent.constructionStrategies[${i}].strategy`, detail: `unsupported strategy "${raw.strategy}"` })
      continue
    }
    const strategy = raw.strategy as DsConstructionStrategyKind
    const outputEntityId = String(raw.outputEntityId).trim()
    if (!declaredIds.has(outputEntityId)) {
      diagnostics.push({ code: "undeclared_entity_ref", path: `intent.constructionStrategies[${i}].outputEntityId`, detail: `strategy outputs undeclared entity "${outputEntityId}"` })
    }
    if (typeof raw.hostEntityId === "string" && !declaredIds.has(raw.hostEntityId)) {
      diagnostics.push({ code: "undeclared_entity_ref", path: `intent.constructionStrategies[${i}].hostEntityId`, detail: `strategy references undeclared host "${raw.hostEntityId}"` })
    }
    const params = isPlainObj(raw.params) ? raw.params : undefined

    // Forbid raw hand-computed vertices inside parametric solid / fold strategies.
    if ((strategy === "solid_base_and_prism_or_pyramid" || strategy === "solid_fold_along_hinge") && params && Array.isArray(params.vertices)) {
      diagnostics.push({
        code: "hand_computed_vertices_forbidden",
        path: `intent.constructionStrategies[${i}].params.vertices`,
        detail: "named solids and folds must declare structural parameters/relations rather than hand-computed vertex coordinates"
      })
    }

    if (!hasBlockingUnknown && containsNonTrivialScalar(params) && !hasValidSourceOrAssumption(raw.sourceSpan, raw.assumptions)) {
      diagnostics.push({
        code: "unsourced_constant",
        path: `intent.constructionStrategies[${i}].params`,
        detail: "non-trivial scalar parameter requires sourceSpan or explicit assumption"
      })
    }

    const entry: DsConstructionStrategy = {
      nodeId: String(raw.nodeId).trim(),
      outputEntityId,
      outputKind: raw.outputKind as DrawingEntityKind,
      strategy,
      scopeId: String(raw.scopeId).trim(),
      stateId: String(raw.stateId).trim(),
      ...(typeof raw.hostEntityId === "string" ? { hostEntityId: raw.hostEntityId } : {}),
      dependencyIds: raw.dependencyIds.filter((x): x is string => typeof x === "string"),
      ...(raw.foldPhase === "pre_fold" || raw.foldPhase === "post_fold" ? { foldPhase: raw.foldPhase } : {}),
      ...(params ? { params } : {}),
      ...(Array.isArray(raw.assumptions) ? { assumptions: raw.assumptions.filter((x): x is string => typeof x === "string") } : {}),
      ...(isPlainObj(raw.sourceSpan) && typeof raw.sourceSpan.text === "string" ? { sourceSpan: { text: raw.sourceSpan.text } } : {})
    }
    strategies.push(entry)
    dagNodes.push({
      nodeId: entry.nodeId,
      outputEntityId: entry.outputEntityId,
      outputKind: entry.outputKind,
      operator: `ds.${entry.strategy}`,
      dependencyIds: entry.dependencyIds,
      ...(entry.hostEntityId === undefined ? {} : { hostEntityId: entry.hostEntityId }),
      scopeId: entry.scopeId,
      stateId: entry.stateId,
      ...(entry.foldPhase === undefined ? {} : { foldPhase: entry.foldPhase }),
      sourceRefs: entry.sourceSpan ? [{ sourceText: entry.sourceSpan.text, start: entry.sourceSpan.start ?? 0, end: entry.sourceSpan.end ?? 0 }] : []
    })
  }

  if (dagNodes.length > 0 && diagnostics.length === 0) {
    const dag = compileConstructionDag(dagNodes)
    if (!dag.ok) {
      for (const diag of dag.diagnostics) {
        diagnostics.push({
          code: (diag.code === "cross_scope_violation"
            || diag.code === "pre_fold_host_violation"
            || diag.code === "cyclic_dependency"
            || diag.code === "missing_host"
            || diag.code === "wrong_host_kind"
            ? diag.code
            : "invalid_schema"),
          path: `intent.dag.${diag.nodeId ?? "graph"}`,
          detail: diag.reason
        })
      }
      return { ok: false, diagnostics }
    }
    const value: DsDrawingIntent = {
      schemaVersion: DS_INTENT_SCHEMA_VERSION,
      goal: goal!,
      ...(input.workspaceHint === "plane" || input.workspaceHint === "conics" || input.workspaceHint === "geometry3d"
        ? { workspaceHint: input.workspaceHint }
        : {}),
      entities,
      givenRelations,
      subquestions,
      constructionStrategies: strategies,
      unknowns
    }
    return { ok: true, value, executionOrder: dag.executionOrder, irSummary: prompt ? irClauseSummaryForPrompt(prompt) : null }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics }

  const value: DsDrawingIntent = {
    schemaVersion: DS_INTENT_SCHEMA_VERSION,
    goal: goal!,
    entities,
    givenRelations,
    subquestions,
    constructionStrategies: strategies,
    unknowns
  }
  return { ok: true, value, executionOrder: [], irSummary: prompt ? irClauseSummaryForPrompt(prompt) : null }
}

function asNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

function vec3(x: number, y: number, z: number) {
  return { x, y, z }
}

/**
 * Compiles a validated DsDrawingIntent strictly from its structural entities, strategies,
 * and kernel mathematical solvers (zero exam-ID or prompt-keyword heuristic shortcuts).
 */
export function compileDsDrawingIntentToPlan(intent: DsDrawingIntent): PlanEnvelope {
  const blockingUnknowns = intent.unknowns.filter((u) => u.blocking)
  if (blockingUnknowns.length > 0) {
    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "clarification",
      goal: intent.goal,
      factIds: [],
      questions: blockingUnknowns.slice(0, 4).map((u) => u.detail)
    }
  }

  const actions: DraftAction[] = []
  const assumptions: string[] = []
  const point3Registry = new Map<string, { x: number; y: number; z: number }>()
  let keySeq = 0
  const nextKey = (prefix: string) => `${prefix}-${++keySeq}`

  const strategyByNodeId = new Map(intent.constructionStrategies.map((s) => [s.nodeId, s]))
  const nodes: DrawingIntentNode[] = intent.constructionStrategies.map((s) => ({
    nodeId: s.nodeId,
    outputEntityId: s.outputEntityId,
    outputKind: s.outputKind,
    operator: `ds.${s.strategy}`,
    dependencyIds: s.dependencyIds,
    ...(s.hostEntityId === undefined ? {} : { hostEntityId: s.hostEntityId }),
    scopeId: s.scopeId,
    stateId: s.stateId,
    ...(s.foldPhase === undefined ? {} : { foldPhase: s.foldPhase }),
    sourceRefs: []
  }))
  const dag = compileConstructionDag(nodes)
  const orderedStrategies = dag.ok
    ? dag.executionOrder.map((n) => strategyByNodeId.get(n.nodeId)!).filter(Boolean)
    : intent.constructionStrategies

  for (const step of orderedStrategies) {
    for (const a of step.assumptions ?? []) {
      if (assumptions.length < 4 && !assumptions.includes(a)) assumptions.push(a)
    }
    const p = step.params ?? {}

    if (step.strategy === "function_curve_and_tangent") {
      if (p.mode === "tangent_at_x") {
        const expr = typeof p.expression === "string" ? p.expression : "x"
        const x0 = asNum(p.x0, 0)
        const y0 = evaluateFunctionWithDomain(expr, x0)
        const slope = evaluateSymbolicDerivative(expr, x0)
        if (y0.ok && slope.ok) {
          const xL = x0 - 1
          const xR = x0 + 1
          actions.push({
            actionId: "planar.create_line",
            actionKey: nextKey("ds-tan"),
            factIds: [],
            inputs: {
              alias: step.outputEntityId,
              label: typeof p.tangentLabel === "string" ? p.tangentLabel : step.outputEntityId,
              points: [
                { x: xL, y: y0.value + slope.value * (xL - x0) },
                { x: xR, y: y0.value + slope.value * (xR - x0) }
              ]
            }
          } as DraftAction)
        }
      } else {
        const expr = typeof p.expression === "string" ? p.expression : "x"
        const domain = Array.isArray(p.domain) && p.domain.length === 2 && typeof p.domain[0] === "number" && typeof p.domain[1] === "number"
          ? [p.domain[0], p.domain[1]] as [number, number]
          : [-3, 3] as [number, number]
        actions.push({
          actionId: "function.create_graph",
          actionKey: nextKey("ds-fn"),
          factIds: [],
          inputs: {
            alias: step.outputEntityId,
            label: typeof p.label === "string" ? p.label : step.outputEntityId,
            expression: expr,
            domain
          }
        } as DraftAction)
      }
      continue
    }

    if (step.strategy === "conic_from_equation_or_properties") {
      const conicType = p.conicType === "ellipse" || p.conicType === "hyperbola" || p.conicType === "parabola" || p.conicType === "circle"
        ? p.conicType
        : "ellipse"
      const label = typeof p.label === "string" ? p.label : step.outputEntityId
      if (conicType === "circle") {
        actions.push({
          actionId: "planar.create_circle",
          actionKey: nextKey("ds-circ"),
          factIds: [],
          inputs: {
            alias: step.outputEntityId,
            label,
            center: { x: asNum(p.cx, 0), y: asNum(p.cy, 0) },
            radius: Math.max(0.1, asNum(p.radius, 1))
          }
        } as DraftAction)
      } else if (conicType === "parabola") {
        actions.push({
          actionId: "planar.create_conic",
          actionKey: nextKey("ds-conic"),
          factIds: [],
          inputs: {
            alias: step.outputEntityId,
            label,
            kind: "parabola",
            vertex: { x: asNum(p.vx, 0), y: asNum(p.vy, 0) },
            axis: p.axis === "y" ? "y" : "x",
            focalParameter: Math.max(0.1, asNum(p.focalParameter, 2))
          }
        } as DraftAction)
      } else {
        actions.push({
          actionId: "planar.create_conic",
          actionKey: nextKey("ds-conic"),
          factIds: [],
          inputs: {
            alias: step.outputEntityId,
            label,
            kind: conicType,
            center: { x: asNum(p.cx, 0), y: asNum(p.cy, 0) },
            axis: p.axis === "y" ? "y" : "x",
            radiusX: Math.max(0.1, asNum(p.radiusX, 2)),
            radiusY: Math.max(0.1, asNum(p.radiusY, 1))
          }
        } as DraftAction)
      }
      continue
    }

    if (step.strategy === "planar_point_on_host") {
      actions.push({
        actionId: "planar.create_point",
        actionKey: nextKey("ds-pt"),
        factIds: [],
        inputs: {
          alias: step.outputEntityId,
          label: typeof p.label === "string" ? p.label : step.outputEntityId,
          points: [{ x: asNum(p.x, 0), y: asNum(p.y, 0) }]
        }
      } as DraftAction)
      continue
    }

    if (step.strategy === "planar_line_or_segment") {
      if (p.mode === "tangent_to_conic" && isPlainObj(p.touchPoint)) {
        const tx = asNum(p.touchPoint.x, 0)
        const ty = asNum(p.touchPoint.y, 0)
        let dx = 1
        let dy = 0
        if (p.conicType === "parabola") {
          const focal = Math.max(0.1, asNum(p.focalParameter, 2))
          if (p.axis === "y") {
            // x^2 = 2*p*y => y' = x / p
            dx = 1
            dy = tx / focal
          } else {
            // y^2 = 2*p*x => 2*y*y' = 2*p => tangent direction (y, p)
            dx = ty
            dy = focal
          }
        }
        actions.push({
          actionId: "planar.create_line",
          actionKey: nextKey("ds-line"),
          factIds: [],
          inputs: {
            alias: step.outputEntityId,
            label: typeof p.label === "string" ? p.label : step.outputEntityId,
            points: [
              { x: tx - dx, y: ty - dy },
              { x: tx + dx, y: ty + dy }
            ]
          }
        } as DraftAction)
      } else if (Array.isArray(p.points) && p.points.length >= 2) {
        const pts = p.points.slice(0, 2).map((pt) => isPlainObj(pt) ? { x: asNum(pt.x, 0), y: asNum(pt.y, 0) } : { x: 0, y: 0 })
        actions.push({
          actionId: p.segment === true ? "planar.create_segment" : "planar.create_line",
          actionKey: nextKey("ds-line"),
          factIds: [],
          inputs: {
            alias: step.outputEntityId,
            label: typeof p.label === "string" ? p.label : step.outputEntityId,
            points: pts
          }
        } as DraftAction)
      }
      continue
    }

    if (step.strategy === "solid_base_and_prism_or_pyramid") {
      const shape = typeof p.shape === "string" ? p.shape : "prism"
      const vNames = Array.isArray(p.vertexNames) ? p.vertexNames.filter((x): x is string => typeof x === "string") : []
      if (shape === "regular_pyramid") {
        const side = Math.max(0.1, asNum(p.baseSide, 2))
        const h = Math.max(0.1, asNum(p.height, 3))
        const solved = constructRegularSquarePyramid(side, Math.hypot(h, (side * Math.SQRT2) / 2))
        if (solved) {
          const verts = [solved.a, solved.b, solved.c, solved.d, solved.p]
          const names = vNames.length === 5 ? vNames : ["A", "B", "C", "D", "P"]
          names.forEach((name, idx) => point3Registry.set(name, verts[idx]!))
          actions.push({
            actionId: "solid.create_polyhedron",
            actionKey: nextKey("ds-pyr"),
            factIds: [],
            inputs: {
              alias: step.outputEntityId,
              vertices: verts,
              vertexNames: names,
              faces: [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
            }
          } as DraftAction)
        }
      } else if (shape === "perpendicular_pyramid") {
        const solved = constructPerpendicularPyramid({
          ab: Math.max(0.1, asNum(p.ab, 2)),
          bc: Math.max(0.1, asNum(p.bc, 2)),
          angleABC: asNum(p.angleABC, 60),
          pa: Math.max(0.1, asNum(p.pa, 2))
        })
        if (solved) {
          const verts = [solved.a, solved.b, solved.c, solved.d, solved.p]
          const names = vNames.length === 5 ? vNames : ["A", "B", "C", "D", "P"]
          names.forEach((name, idx) => point3Registry.set(name, verts[idx]!))
          actions.push({
            actionId: "solid.create_polyhedron",
            actionKey: nextKey("ds-pyr"),
            factIds: [],
            inputs: {
              alias: step.outputEntityId,
              vertices: verts,
              vertexNames: names,
              faces: [[0, 3, 2, 1], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]]
            }
          } as DraftAction)
        }
      } else if (shape === "right_triangular_prism") {
        const solved = constructRightPrism({
          lateralLength: Math.max(0.5, asNum(p.lateralLength, 4)),
          apexToPlane: Math.max(0.2, asNum(p.apexToPlane, 1.5)),
          lateralLineDistance: Math.max(0.2, asNum(p.lateralLineDistance, 2))
        })
        if (solved) {
          const names = vNames.length === 6 ? vNames : ["A", "B", "C", "A₁", "B₁", "C₁"]
          const verts = [solved.a, solved.b, solved.c, solved.a1, solved.b1, solved.c1]
          names.forEach((name, idx) => point3Registry.set(name, verts[idx]!))
          actions.push({
            actionId: "solid.create_prism",
            actionKey: nextKey("ds-prism"),
            factIds: [],
            inputs: {
              alias: step.outputEntityId,
              basePolygon: [solved.a, solved.b, solved.c],
              vector: vec3(solved.a1.x - solved.a.x, solved.a1.y - solved.a.y, solved.a1.z - solved.a.z),
              vertexNames: names
            }
          } as DraftAction)
        }
      } else if (shape === "tetrahedron") {
        const solved = constructTetrahedron({
          ab: Math.max(0.1, asNum(p.ab, 2)),
          bc: Math.max(0.1, asNum(p.bc, 2)),
          ac: Math.max(0.1, asNum(p.ac, 2)),
          pa: Math.max(0.1, asNum(p.pa, 2)),
          pb: Math.max(0.1, asNum(p.pb, 2)),
          pc: Math.max(0.1, asNum(p.pc, 2))
        })
        if (solved) {
          const names = vNames.length === 4 ? vNames : ["A", "B", "C", "P"]
          const verts = [solved.a, solved.b, solved.c, solved.p]
          names.forEach((name, idx) => point3Registry.set(name, verts[idx]!))
          actions.push({
            actionId: "solid.create_polyhedron",
            actionKey: nextKey("ds-tet"),
            factIds: [],
            inputs: {
              alias: step.outputEntityId,
              vertices: verts,
              vertexNames: names,
              faces: [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]]
            }
          } as DraftAction)
        }
      } else if (shape === "right_trapezoid_open_base") {
        const b = Math.max(0.2, asNum(p.bottomLength, 4))
        const top = Math.max(0.2, asNum(p.topLength, 2))
        const h = Math.max(0.2, asNum(p.height, 4))
        const names = vNames.length === 4 ? vNames : ["B", "C", "D", "A"]
        const verts = [vec3(b, 0, 0), vec3(0, 0, 0), vec3(0, h, 0), vec3(top, h, 0)]
        names.forEach((name, idx) => point3Registry.set(name, verts[idx]!))
        actions.push({
          actionId: "solid.create_face",
          actionKey: nextKey("ds-face"),
          factIds: [],
          inputs: { alias: step.outputEntityId, vertices: verts, vertexNames: names }
        } as DraftAction)
      } else if (shape === "prism_box" || shape === "prism") {
        const w = Math.max(0.2, asNum(p.width, 2))
        const d = Math.max(0.2, asNum(p.depth, 2))
        const h = Math.max(0.2, asNum(p.height, 2))
        const names = vNames.length === 8 ? vNames : ["A", "B", "C", "D", "A₁", "B₁", "C₁", "D₁"]
        const base = [vec3(0, 0, 0), vec3(w, 0, 0), vec3(w, d, 0), vec3(0, d, 0)]
        base.forEach((pt, idx) => point3Registry.set(names[idx]!, pt))
        base.forEach((pt, idx) => point3Registry.set(names[idx + 4]!, vec3(pt.x, pt.y, h)))
        actions.push({
          actionId: "solid.create_prism",
          actionKey: nextKey("ds-prism"),
          factIds: [],
          inputs: { alias: step.outputEntityId, basePolygon: base, vector: vec3(0, 0, h), vertexNames: names }
        } as DraftAction)
      }
      continue
    }

    if (step.strategy === "solid_point_on_edge_or_face") {
      const fromName = typeof p.from === "string" ? p.from : ""
      const toName = typeof p.to === "string" ? p.to : ""
      const t = Math.min(1, Math.max(0, asNum(p.ratioFromFirst, 0.5)))
      const a = point3Registry.get(fromName)
      const b = point3Registry.get(toName)
      if (a && b) {
        const pos = vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
        const label = typeof p.label === "string" ? p.label : step.outputEntityId
        point3Registry.set(label, pos)
        actions.push({
          actionId: "solid.create_point",
          actionKey: nextKey("ds-pt3"),
          factIds: [],
          inputs: { alias: step.outputEntityId, label, position: pos }
        } as DraftAction)
      }
      continue
    }

    if (step.strategy === "solid_fold_along_hinge") {
      const hingePair = Array.isArray(p.hinge) && p.hinge.length === 2 ? [String(p.hinge[0]), String(p.hinge[1])] : null
      const preMoving = Array.isArray(p.preMovingTriangleVertices) ? p.preMovingTriangleVertices : []
      const movingNames = Array.isArray(p.movingVertexNames) ? p.movingVertexNames.map(String) : []
      const afterNames = Array.isArray(p.afterVertexNames) ? p.afterVertexNames.map(String) : []
      for (const item of preMoving) {
        if (!isPlainObj(item) || typeof item.name !== "string") continue
        if (typeof item.onEdgeFrom === "string" && typeof item.to === "string") {
          const a = point3Registry.get(item.onEdgeFrom)
          const b = point3Registry.get(item.to)
          if (a && b) {
            const t = asNum(item.ratioFromFirst, 0.5)
            point3Registry.set(item.name, vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t))
          }
        }
      }
      if (hingePair && movingNames.length > 0 && afterNames.length === movingNames.length) {
        const h0 = point3Registry.get(hingePair[0]!)
        const h1 = point3Registry.get(hingePair[1]!)
        const apexBeforeName = movingNames[0]!
        const apexBefore = point3Registry.get(apexBeforeName)
        const deg = asNum(p.angleDegrees, 90)
        if (h0 && h1 && apexBefore) {
          const sign = p.direction === "negative" ? -1 : 1
          const rotated = rotatePointAboutHinge(apexBefore, h0, h1, sign * deg)
          if (rotated.status === "ok") {
            point3Registry.set(afterNames[0]!, rotated.point)
            actions.push({
              actionId: "solid.fold",
              actionKey: nextKey("ds-fold"),
              factIds: [],
              inputs: {
                alias: step.outputEntityId,
                vertices: [h0, h1, apexBefore],
                vertexNames: [hingePair[0]!, hingePair[1]!, apexBeforeName],
                hinge: { from: hingePair[0]!, to: hingePair[1]! },
                apex: apexBeforeName,
                apexAs: afterNames[0]!,
                angle: sign * deg
              }
            } as DraftAction)
          }
        }
      }
      continue
    }
  }

  if (actions.length === 0) {
    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "clarification",
      goal: intent.goal,
      factIds: [],
      questions: ["未能从结构化施工单构造有效图元，请补充明确几何对象或约束条件。"]
    }
  }

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: intent.goal,
    factIds: [],
    ...(assumptions.length > 0 ? { assumptions } : {}),
    actions
  }
}
