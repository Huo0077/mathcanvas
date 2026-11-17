import type { Coordinate } from "@draw/dsl"
import {
  conicFoci,
  ellipseFromFociAndPoint,
  evaluateFunctionWithDomain,
  evaluateSymbolicDerivative,
  hyperbolaFromFociAndPoint,
  intersectPlanarLineAndConicExact,
  rotatePointAboutHinge,
  tangentLineToConicAt,
  type PlanarConic
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
  | "unsupported_construction"
  | "missing_required_parameter"
  | "unproven_parameter"
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

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

function isPosNum(v: unknown): v is number {
  return isFiniteNum(v) && v > 0
}

function isFiniteDomain(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && isFiniteNum(v[0]) && isFiniteNum(v[1]) && v[0] < v[1]
}

const SOLID_SHAPE_REQUIRED_FIELDS: Record<string, readonly string[]> = {
  regular_pyramid: ["baseSide", "height"],
  perpendicular_pyramid: ["ab", "bc", "angleABC", "pa"],
  right_triangular_prism: ["lateralLength", "apexToPlane", "lateralLineDistance"],
  tetrahedron: ["ab", "bc", "ac", "pa", "pb", "pc"],
  pyramid_perp_base_quad: ["pa", "ab", "ad", "bc"],
  right_trapezoid_open_base: ["bottomLength", "topLength", "height"],
  prism_box: ["width", "depth", "height"],
  prism: ["width", "depth", "height"]
}

export type RequiredParameterValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code: "missing_required_parameter" | "unsupported_construction" | "unproven_parameter"
      readonly path: string
    }

function validateStrategyParameters(
  step: DsConstructionStrategy,
  index: number
): Exclude<RequiredParameterValidationResult, { ok: true }> | null {
  const prefix = `intent.constructionStrategies[${index}]`
  const p = step.params ?? {}

  if (step.strategy === "infeasible_disclosure") {
    if (!asNonEmptyStr(p.summary)) {
      return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.summary` }
    }
    return null
  }

  const hasProvenance = hasValidSourceOrAssumption(step.sourceSpan, step.assumptions)
  if (!hasProvenance && (step.dependencyIds.length === 0 || containsNonTrivialScalar(step.params))) {
    return { ok: false, code: "unproven_parameter", path: prefix }
  }

  switch (step.strategy) {
    case "function_curve_and_tangent": {
      if (!asNonEmptyStr(p.expression)) {
        return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.expression` }
      }
      if (p.mode === "tangent_at_x") {
        if (!isFiniteNum(p.x0)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.x0` }
        }
        return null
      }
      if (p.mode === "tangent_from_external_point") {
        if (!asVec2(p.externalPoint) && !(isFiniteNum(p.px) && isFiniteNum(p.py))) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.externalPoint` }
        }
        if (!isFiniteDomain(p.domain)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.domain` }
        }
        return null
      }
      if (p.mode !== undefined && p.mode !== "curve") {
        return { ok: false, code: "unsupported_construction", path: `${prefix}.params.mode` }
      }
      if (!isFiniteDomain(p.domain)) {
        return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.domain` }
      }
      return null
    }
    case "conic_from_equation_or_properties": {
      const ct = p.conicType
      if (ct !== "ellipse" && ct !== "hyperbola" && ct !== "parabola" && ct !== "circle") {
        return { ok: false, code: "unsupported_construction", path: `${prefix}.params.conicType` }
      }
      if (ct === "circle") {
        if (!isPosNum(p.radius)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.radius` }
        }
        return null
      }
      if (ct === "parabola") {
        if (!isPosNum(p.focalParameter)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.focalParameter` }
        }
        return null
      }
      const hasAxes = isPosNum(p.radiusX) && isPosNum(p.radiusY)
      const hasFoci = Array.isArray(p.foci) && p.foci.length === 2 && asVec2(p.foci[0]) !== null && asVec2(p.foci[1]) !== null && asVec2(p.throughPoint) !== null
      const hasEcc = isPosNum(p.majorSemiAxis) && isPosNum(p.eccentricity)
      if (!hasAxes && !hasFoci && !hasEcc) {
        return { ok: false, code: "missing_required_parameter", path: `${prefix}.params` }
      }
      return null
    }
    case "planar_point_on_host": {
      const mode = p.mode === undefined ? "explicit_coords" : p.mode
      if (mode === "focus") {
        if (!asNonEmptyStr(p.conicId ?? step.hostEntityId)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.conicId` }
        }
        return null
      }
      if (mode === "on_conic") {
        if (!asNonEmptyStr(p.conicId ?? step.hostEntityId)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.conicId` }
        }
        if (!isFiniteNum(p.parameter)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.parameter` }
        }
        return null
      }
      if (mode === "line_conic_intersection") {
        if (!asNonEmptyStr(p.lineId)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.lineId` }
        }
        if (!asNonEmptyStr(p.conicId ?? step.hostEntityId)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.conicId` }
        }
        return null
      }
      if (mode === "midpoint") {
        if (!asNonEmptyStr(p.from) || !asNonEmptyStr(p.to)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params` }
        }
        return null
      }
      if (mode === "segment_ratio") {
        if (!asNonEmptyStr(p.from) || !asNonEmptyStr(p.to)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params` }
        }
        if (!isFiniteNum(p.ratioFromFirst)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.ratioFromFirst` }
        }
        return null
      }
      if (mode === "line_intersection") {
        if (!asNonEmptyStr(p.firstLineId) || !asNonEmptyStr(p.secondLineId)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params` }
        }
        return null
      }
      if (mode === "explicit_coords") {
        if (!isFiniteNum(p.x)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.x` }
        }
        if (!isFiniteNum(p.y)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.y` }
        }
        return null
      }
      return { ok: false, code: "unsupported_construction", path: `${prefix}.params.mode` }
    }
    case "planar_line_or_segment": {
      const mode = p.mode
      if (mode === "equation") {
        if (!isFiniteNum(p.a) || !isFiniteNum(p.b) || !isFiniteNum(p.c) || (Math.abs(p.a) <= 1e-12 && Math.abs(p.b) <= 1e-12)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params` }
        }
        return null
      }
      if (mode === "through_points" || mode === "perpendicular_bisector") {
        if (!asNonEmptyStr(p.from) || !asNonEmptyStr(p.to)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params` }
        }
        return null
      }
      if (mode === "tangent_to_conic") {
        const hasConic = asNonEmptyStr(p.conicId) !== null || (p.conicType === "parabola" && isPosNum(p.focalParameter))
        if (!hasConic) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.conicId` }
        }
        if (!asNonEmptyStr(p.touchPointId) && asVec2(p.touchPoint) === null) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.touchPoint` }
        }
        return null
      }
      if (mode === undefined && Array.isArray(p.points) && p.points.length >= 2 && asVec2(p.points[0]) && asVec2(p.points[1])) {
        return null
      }
      return { ok: false, code: "unsupported_construction", path: `${prefix}.params.mode` }
    }
    case "solid_base_and_prism_or_pyramid": {
      const shape = typeof p.shape === "string" ? p.shape : ""
      const reqFields = SOLID_SHAPE_REQUIRED_FIELDS[shape]
      if (!reqFields) {
        return { ok: false, code: "unsupported_construction", path: `${prefix}.params.shape` }
      }
      for (const field of reqFields) {
        if (!isPosNum(p[field])) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.${field}` }
        }
      }
      return null
    }
    case "solid_point_on_edge_or_face": {
      const mode = p.mode === undefined ? "edge_ratio" : p.mode
      if (mode === "segment") {
        if (!asNonEmptyStr(p.from) || !asNonEmptyStr(p.to)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params` }
        }
        return null
      }
      if (mode === "perpendicular_foot_on_plane") {
        if (!asNonEmptyStr(p.sourcePoint)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.sourcePoint` }
        }
        if (!Array.isArray(p.planePoints) || p.planePoints.length < 3) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.planePoints` }
        }
        return null
      }
      if (mode === "perpendicular_foot_on_line") {
        if (!asNonEmptyStr(p.sourcePoint) || !asNonEmptyStr(p.lineFrom ?? p.from) || !asNonEmptyStr(p.lineTo ?? p.to)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params` }
        }
        return null
      }
      if (mode === "edge_ratio") {
        if (!asNonEmptyStr(p.from) || !asNonEmptyStr(p.to)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params` }
        }
        if (!isFiniteNum(p.ratioFromFirst)) {
          return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.ratioFromFirst` }
        }
        return null
      }
      return { ok: false, code: "unsupported_construction", path: `${prefix}.params.mode` }
    }
    case "solid_fold_along_hinge": {
      if (!Array.isArray(p.hinge) || p.hinge.length !== 2) {
        return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.hinge` }
      }
      if (!Array.isArray(p.movingVertexNames) || p.movingVertexNames.length === 0) {
        return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.movingVertexNames` }
      }
      if (!Array.isArray(p.afterVertexNames) || p.afterVertexNames.length !== p.movingVertexNames.length) {
        return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.afterVertexNames` }
      }
      if (!isFiniteNum(p.angleDegrees)) {
        return { ok: false, code: "missing_required_parameter", path: `${prefix}.params.angleDegrees` }
      }
      return null
    }
  }
}

export function validateRequiredParameters(intent: DsDrawingIntent): RequiredParameterValidationResult {
  if (intent.unknowns.some((u) => u.blocking) && intent.constructionStrategies.length === 0) {
    return { ok: true }
  }
  for (let i = 0; i < intent.constructionStrategies.length; i += 1) {
    const err = validateStrategyParameters(intent.constructionStrategies[i]!, i)
    if (err) return err
  }
  return { ok: true }
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
    const candidateIntent: DsDrawingIntent = {
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
    if (!hasBlockingUnknown) {
      const paramValidation = validateRequiredParameters(candidateIntent)
      if (!paramValidation.ok) {
        diagnostics.push({
          code: paramValidation.code,
          path: paramValidation.path,
          detail: `required parameter validation failed (${paramValidation.code}) at ${paramValidation.path}`
        })
        return { ok: false, diagnostics }
      }
    }
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
    return { ok: true, value: candidateIntent, executionOrder: dag.executionOrder, irSummary: prompt ? irClauseSummaryForPrompt(prompt) : null }
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

function asVec2(v: unknown): Coordinate | null {
  if (!isPlainObj(v) || typeof v.x !== "number" || typeof v.y !== "number") return null
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null
  return { x: v.x, y: v.y }
}

/** Intersect circle(c1, r1) with circle(c2, r2) on XY plane (returns positive-side candidate). */
function solveQuadVertexByEdgeLengths(
  a: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
  ab: number,
  bc: number
): { x: number; y: number; z: number } | null {
  const dx = c.x - a.x
  const dy = c.y - a.y
  const dist = Math.hypot(dx, dy)
  if (!(dist > 1e-9) || dist > ab + bc + 1e-9 || dist < Math.abs(ab - bc) - 1e-9) return null
  const ex = dx / dist
  const ey = dy / dist
  const xProj = (ab * ab - bc * bc + dist * dist) / (2 * dist)
  const hSq = Math.max(0, ab * ab - xProj * xProj)
  const h = Math.sqrt(hSq)
  // Pick the side (-ey, ex) that forms a convex non-self-intersecting base with D in +x/+y quadrant.
  return { x: a.x + ex * xProj - ey * h, y: a.y + ey * xProj + ex * h, z: 0 }
}

/** Collects target scope, "shared", and any explicit parent subquestions via dependsOn. */
export function resolveAllowedScopes(intent: DsDrawingIntent, targetScopeId?: string): Set<string> {
  if (!targetScopeId || targetScopeId === "shared") {
    return new Set(["shared", ...intent.subquestions.map((s) => s.id)])
  }
  const subqById = new Map(intent.subquestions.map((s) => [s.id, s]))
  const allowed = new Set<string>(["shared", targetScopeId])
  const queue = [targetScopeId]
  while (queue.length > 0) {
    const cur = queue.shift()!
    const sub = subqById.get(cur)
    if (!sub) continue
    for (const dep of sub.dependsOn) {
      if (!allowed.has(dep)) {
        allowed.add(dep)
        queue.push(dep)
      }
    }
  }
  return allowed
}

/**
 * Compiles a validated DsDrawingIntent strictly for a single subquestion scope (preserving shared
 * prerequisites while isolating sibling-subquestion entities/actions).
 */
export function compileDsDrawingIntentByScope(intent: DsDrawingIntent, targetScopeId?: string): PlanEnvelope {
  if (!targetScopeId) return compileDsDrawingIntentToPlan(intent)
  const allowed = resolveAllowedScopes(intent, targetScopeId)
  const filtered: DsDrawingIntent = {
    ...intent,
    entities: intent.entities.filter((e) => allowed.has(e.scopeId)),
    givenRelations: intent.givenRelations.filter((r) => allowed.has(r.scopeId)),
    constructionStrategies: intent.constructionStrategies.filter((s) => allowed.has(s.scopeId)),
    unknowns: intent.unknowns.filter((u) => allowed.has(u.scopeId))
  }
  return compileDsDrawingIntentToPlan(filtered)
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
  const disclosures: string[] = []
  const point2Registry = new Map<string, Coordinate>()
  const line2Registry = new Map<string, { a: Coordinate; b: Coordinate }>()
  const conicRegistry = new Map<string, PlanarConic>()
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
  if (!dag.ok) {
    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "clarification",
      goal: intent.goal,
      factIds: [],
      questions: dag.diagnostics.slice(0, 4).map((diag) => `[${diag.code}@${diag.nodeId ?? "graph"}] ${diag.reason}`)
    }
  }
  const paramValidation = validateRequiredParameters(intent)
  if (!paramValidation.ok) {
    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      kind: "clarification",
      goal: intent.goal,
      factIds: [],
      questions: [`[${paramValidation.code}@${paramValidation.path}] 缺少或未证实必要数学参数，请先指明原文依据或补全参数。`]
    }
  }
  const orderedStrategies = dag.executionOrder.map((n) => strategyByNodeId.get(n.nodeId)!).filter(Boolean)

  for (const step of orderedStrategies) {
    for (const a of step.assumptions ?? []) {
      if (assumptions.length < 4 && !assumptions.includes(a)) assumptions.push(a)
    }
    const p = step.params ?? {}

    if (step.strategy === "function_curve_and_tangent") {
      const expr = asNonEmptyStr(p.expression)
      if (!expr) continue
      if (p.mode === "tangent_at_x") {
        if (!isFiniteNum(p.x0)) continue
        const x0 = p.x0
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
      } else if (p.mode === "tangent_from_external_point") {
        const ext = asVec2(p.externalPoint) ?? (isFiniteNum(p.px) && isFiniteNum(p.py) ? { x: p.px, y: p.py } : null)
        if (!ext || !isFiniteDomain(p.domain)) continue
        const domain = p.domain
        const targetIndex = Math.max(0, Math.trunc(asNum(p.index, 0)))
        const residual = (t: number): number | null => {
          const ft = evaluateFunctionWithDomain(expr, t)
          const dt = evaluateSymbolicDerivative(expr, t)
          if (!ft.ok || !dt.ok) return null
          return ft.value + dt.value * (ext.x - t) - ext.y
        }
        const roots: number[] = []
        const steps = 120
        const dx = (domain[1] - domain[0]) / steps
        let prevT = domain[0]
        let prevR = residual(prevT)
        for (let i = 1; i <= steps; i += 1) {
          const curT = domain[0] + dx * i
          const curR = residual(curT)
          if (prevR !== null && curR !== null && prevR * curR <= 0) {
            let lo = prevT, hi = curT, rLo = prevR
            for (let b = 0; b < 30; b += 1) {
              const mid = 0.5 * (lo + hi)
              const rMid = residual(mid)
              if (rMid === null) break
              if (rLo * rMid <= 0) {
                hi = mid
              } else {
                lo = mid
                rLo = rMid
              }
            }
            const root = 0.5 * (lo + hi)
            if (!roots.some((r) => Math.abs(r - root) < 1e-4)) roots.push(root)
          }
          prevT = curT
          prevR = curR
        }
        const tStar = roots[Math.min(targetIndex, Math.max(0, roots.length - 1))]
        if (tStar !== undefined) {
          const yStar = evaluateFunctionWithDomain(expr, tStar)
          const slope = evaluateSymbolicDerivative(expr, tStar)
          if (yStar.ok && slope.ok) {
            actions.push({
              actionId: "planar.create_line",
              actionKey: nextKey("ds-tan-ext"),
              factIds: [],
              inputs: {
                alias: step.outputEntityId,
                label: typeof p.tangentLabel === "string" ? p.tangentLabel : step.outputEntityId,
                points: [
                  { x: ext.x - 1, y: yStar.value + slope.value * (ext.x - 1 - tStar) },
                  { x: ext.x + 1, y: yStar.value + slope.value * (ext.x + 1 - tStar) }
                ]
              }
            } as DraftAction)
          }
        }
      } else {
        if (!isFiniteDomain(p.domain)) continue
        actions.push({
          actionId: "function.create_graph",
          actionKey: nextKey("ds-fn"),
          factIds: [],
          inputs: {
            alias: step.outputEntityId,
            label: typeof p.label === "string" ? p.label : step.outputEntityId,
            expression: expr,
            domain: p.domain
          }
        } as DraftAction)
      }
      continue
    }

    if (step.strategy === "infeasible_disclosure") {
      if (typeof p.summary === "string" && p.summary.trim().length > 0) {
        disclosures.push(p.summary.trim())
      }
      continue
    }

    if (step.strategy === "conic_from_equation_or_properties") {
      const conicType = p.conicType === "ellipse" || p.conicType === "hyperbola" || p.conicType === "parabola" || p.conicType === "circle"
        ? p.conicType
        : "ellipse"
      const label = typeof p.label === "string" ? p.label : step.outputEntityId
      if (conicType === "circle") {
        const center = { x: asNum(p.cx, 0), y: asNum(p.cy, 0) }
        const radius = Math.max(0.1, asNum(p.radius, 1))
        conicRegistry.set(step.outputEntityId, { id: step.outputEntityId, type: "circle", center, radius })
        actions.push({
          actionId: "planar.create_circle",
          actionKey: nextKey("ds-circ"),
          factIds: [],
          inputs: { alias: step.outputEntityId, label, center, radius }
        } as DraftAction)
      } else if (conicType === "parabola") {
        const vertex = { x: asNum(p.vx, 0), y: asNum(p.vy, 0) }
        const axis: "x" | "y" = p.axis === "y" ? "y" : "x"
        const focalParameter = Math.max(0.1, asNum(p.focalParameter, 2))
        conicRegistry.set(step.outputEntityId, { id: step.outputEntityId, type: "parabola", vertex, axis, focalParameter })
        actions.push({
          actionId: "planar.create_conic",
          actionKey: nextKey("ds-conic"),
          factIds: [],
          inputs: { alias: step.outputEntityId, label, kind: "parabola", vertex, axis, focalParameter }
        } as DraftAction)
      } else {
        let center = { x: asNum(p.cx, 0), y: asNum(p.cy, 0) }
        let axis: "x" | "y" = p.axis === "y" ? "y" : "x"
        let rx = asNum(p.radiusX, 0)
        let ry = asNum(p.radiusY, 0)

        const fociRaw = Array.isArray(p.foci) && p.foci.length === 2 ? [asVec2(p.foci[0]), asVec2(p.foci[1])] : null
        const throughPt = asVec2(p.throughPoint)
        if (fociRaw && fociRaw[0] && fociRaw[1] && throughPt) {
          const inv = conicType === "ellipse"
            ? ellipseFromFociAndPoint([fociRaw[0], fociRaw[1]], throughPt)
            : hyperbolaFromFociAndPoint([fociRaw[0], fociRaw[1]], throughPt)
          if (inv.kind === "solved") {
            center = inv.conic.center
            rx = inv.conic.radiusX
            ry = inv.conic.radiusY
            if ("axis" in inv.conic && inv.conic.axis === "y") axis = "y"
          }
        } else if (typeof p.majorSemiAxis === "number" && Number.isFinite(p.majorSemiAxis) && typeof p.eccentricity === "number" && Number.isFinite(p.eccentricity)) {
          const a = Math.max(0.1, p.majorSemiAxis)
          const e = p.eccentricity
          if (conicType === "ellipse" && e > 0 && e < 1) {
            const b = a * Math.sqrt(1 - e * e)
            rx = axis === "y" ? b : a
            ry = axis === "y" ? a : b
          } else if (conicType === "hyperbola" && e > 1) {
            const b = a * Math.sqrt(e * e - 1)
            rx = axis === "y" ? b : a
            ry = axis === "y" ? a : b
          }
        }
        rx = Math.max(0.1, rx || 2)
        ry = Math.max(0.1, ry || 1)
        const conic: PlanarConic = conicType === "ellipse"
          ? { id: step.outputEntityId, type: "ellipse", center, radiusX: rx, radiusY: ry }
          : { id: step.outputEntityId, type: "hyperbola", center, axis, radiusX: rx, radiusY: ry }
        conicRegistry.set(step.outputEntityId, conic)
        const excludedPoints = Array.isArray(p.excludedPoints)
          ? p.excludedPoints.map(asVec2).filter((pt): pt is Coordinate => pt !== null)
          : undefined
        actions.push({
          actionId: "planar.create_conic",
          actionKey: nextKey("ds-conic"),
          factIds: [],
          inputs: {
            alias: step.outputEntityId,
            label,
            kind: conicType,
            center,
            axis,
            radiusX: rx,
            radiusY: ry,
            ...(excludedPoints && excludedPoints.length > 0 ? { excludedPoints } : {})
          }
        } as DraftAction)
      }
      continue
    }

    if (step.strategy === "planar_point_on_host") {
      const label = typeof p.label === "string" ? p.label : step.outputEntityId
      const mode = typeof p.mode === "string" ? p.mode : "explicit_coords"
      let solvedPt: Coordinate | null = null

      if (mode === "focus") {
        const conic = conicRegistry.get(String(p.conicId ?? step.hostEntityId ?? ""))
        if (conic) {
          const foci = conicFoci(conic)
          const idx = Math.max(0, Math.min(foci.length - 1, Math.trunc(asNum(p.index, 0))))
          solvedPt = foci[idx] ?? null
        }
      } else if (mode === "on_conic") {
        const conic = conicRegistry.get(String(p.conicId ?? step.hostEntityId ?? ""))
        const param = asNum(p.parameter, Math.PI / 4)
        if (conic) {
          if (conic.type === "ellipse") {
            solvedPt = { x: conic.center.x + conic.radiusX * Math.cos(param), y: conic.center.y + conic.radiusY * Math.sin(param) }
          } else if (conic.type === "circle") {
            solvedPt = { x: conic.center.x + conic.radius * Math.cos(param), y: conic.center.y + conic.radius * Math.sin(param) }
          } else if (conic.type === "parabola") {
            const pVal = conic.focalParameter
            solvedPt = conic.axis === "y"
              ? { x: conic.vertex.x + param, y: conic.vertex.y + (param * param) / (2 * pVal) }
              : { x: conic.vertex.x + (param * param) / (2 * pVal), y: conic.vertex.y + param }
          } else {
            const c = Math.cos(param)
            const s = Math.sin(param)
            if (Math.abs(c) > 1e-6) {
              solvedPt = conic.axis === "x"
                ? { x: conic.center.x + conic.radiusX / c, y: conic.center.y + conic.radiusY * (s / c) }
                : { x: conic.center.x + conic.radiusX * (s / c), y: conic.center.y + conic.radiusY / c }
            }
          }
        }
      } else if (mode === "line_conic_intersection") {
        const line = line2Registry.get(String(p.lineId ?? ""))
        const conic = conicRegistry.get(String(p.conicId ?? step.hostEntityId ?? ""))
        if (line && conic) {
          const res = intersectPlanarLineAndConicExact({ type: "line", a: line.a, b: line.b }, conic)
          if (res.points.length > 0) {
            const idx = Math.max(0, Math.min(res.points.length - 1, Math.trunc(asNum(p.index, 0))))
            solvedPt = res.points[idx] ?? null
          }
        }
      } else if (mode === "midpoint" || mode === "segment_ratio") {
        const pFrom = point2Registry.get(String(p.from ?? ""))
        const pTo = point2Registry.get(String(p.to ?? ""))
        const t = mode === "midpoint" ? 0.5 : asNum(p.ratioFromFirst, 0.5)
        if (pFrom && pTo) {
          solvedPt = { x: pFrom.x + (pTo.x - pFrom.x) * t, y: pFrom.y + (pTo.y - pFrom.y) * t }
        }
      } else if (mode === "line_intersection") {
        const l1 = line2Registry.get(String(p.firstLineId ?? ""))
        const l2 = line2Registry.get(String(p.secondLineId ?? ""))
        if (l1 && l2) {
          const dx1 = l1.b.x - l1.a.x, dy1 = l1.b.y - l1.a.y
          const dx2 = l2.b.x - l2.a.x, dy2 = l2.b.y - l2.a.y
          const det = dx1 * dy2 - dy1 * dx2
          if (Math.abs(det) > 1e-9) {
            const rx = l2.a.x - l1.a.x, ry = l2.a.y - l1.a.y
            const t = (rx * dy2 - ry * dx2) / det
            solvedPt = { x: l1.a.x + t * dx1, y: l1.a.y + t * dy1 }
          }
        }
      } else {
        solvedPt = { x: asNum(p.x, 0), y: asNum(p.y, 0) }
      }

      if (solvedPt) {
        point2Registry.set(step.outputEntityId, solvedPt)
        point2Registry.set(label, solvedPt)
        actions.push({
          actionId: "planar.create_point",
          actionKey: nextKey("ds-pt"),
          factIds: [],
          inputs: { alias: step.outputEntityId, label, points: [solvedPt] }
        } as DraftAction)
      }
      continue
    }

    if (step.strategy === "planar_line_or_segment") {
      const label = typeof p.label === "string" ? p.label : step.outputEntityId
      const mode = typeof p.mode === "string" ? p.mode : ""
      let endpoints: [Coordinate, Coordinate] | null = null

      if (mode === "equation") {
        const a = asNum(p.a, 0), b = asNum(p.b, 0), c = asNum(p.c, 0)
        if (Math.abs(b) > Math.abs(a) && Math.abs(b) > 1e-12) {
          endpoints = [{ x: -4, y: -(a * -4 + c) / b }, { x: 4, y: -(a * 4 + c) / b }]
        } else if (Math.abs(a) > 1e-12) {
          endpoints = [{ x: -(b * -4 + c) / a, y: -4 }, { x: -(b * 4 + c) / a, y: 4 }]
        }
      } else if (mode === "through_points") {
        const p1 = point2Registry.get(String(p.from ?? ""))
        const p2 = point2Registry.get(String(p.to ?? ""))
        if (p1 && p2) endpoints = [p1, p2]
      } else if (mode === "perpendicular_bisector") {
        const p1 = point2Registry.get(String(p.from ?? ""))
        const p2 = point2Registry.get(String(p.to ?? ""))
        if (p1 && p2) {
          const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
          const dx = p2.x - p1.x, dy = p2.y - p1.y
          endpoints = [{ x: mid.x - dy, y: mid.y + dx }, { x: mid.x + dy, y: mid.y - dx }]
        }
      } else if (mode === "tangent_to_conic") {
        const conic = conicRegistry.get(String(p.conicId ?? ""))
        const touchPt = (typeof p.touchPointId === "string" ? point2Registry.get(p.touchPointId) : undefined) ?? asVec2(p.touchPoint)
        if (conic && touchPt) {
          const tan = tangentLineToConicAt(conic, touchPt, 5)
          if (tan) endpoints = [tan.line.a, tan.line.b]
        } else if (touchPt && p.conicType === "parabola") {
          const focal = Math.max(0.1, asNum(p.focalParameter, 2))
          const para: PlanarConic = { id: "inline-para", type: "parabola", vertex: { x: 0, y: 0 }, axis: p.axis === "y" ? "y" : "x", focalParameter: focal }
          const tan = tangentLineToConicAt(para, touchPt, 5)
          if (tan) endpoints = [tan.line.a, tan.line.b]
        }
      } else if (Array.isArray(p.points) && p.points.length >= 2) {
        const pts = p.points.slice(0, 2).map(asVec2)
        if (pts[0] && pts[1]) endpoints = [pts[0], pts[1]]
      }

      if (endpoints) {
        line2Registry.set(step.outputEntityId, { a: endpoints[0], b: endpoints[1] })
        line2Registry.set(label, { a: endpoints[0], b: endpoints[1] })
        actions.push({
          actionId: p.segment === true ? "planar.create_segment" : "planar.create_line",
          actionKey: nextKey("ds-line"),
          factIds: [],
          inputs: { alias: step.outputEntityId, label, points: endpoints }
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
      } else if (shape === "pyramid_perp_base_quad") {
        const pa = Math.max(0.1, asNum(p.pa, 2))
        const ab = Math.max(0.1, asNum(p.ab, 1))
        const ad = Math.max(0.1, asNum(p.ad, 1))
        const bc = Math.max(0.1, asNum(p.bc, 2))
        const names = vNames.length === 5 ? vNames : ["A", "B", "C", "D", "P"]
        const A = vec3(0, 0, 0)
        const D = vec3(ad, 0, 0)
        const P = vec3(0, 0, pa)
        let C: { x: number; y: number; z: number }
        let B: { x: number; y: number; z: number }
        if (p.requireAdPerpDc === true && ab > Math.abs(bc - ad) + 1e-6) {
          const dc = Math.sqrt(ab * ab - (bc - ad) * (bc - ad))
          C = vec3(ad, dc, 0)
          B = vec3(ad - bc, dc, 0)
        } else if (p.requireAdPerpDc === true) {
          const dc = asNum(p.dc, 1)
          C = vec3(ad, dc, 0)
          B = solveQuadVertexByEdgeLengths(A, C, ab, bc) ?? vec3(0, ab, 0)
        } else {
          B = vec3(0, ab, 0)
          C = vec3(bc, ab, 0)
        }
        const verts = [A, B, C, D, P]
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
      const mode = typeof p.mode === "string" ? p.mode : "edge_ratio"
      const label = typeof p.label === "string" ? p.label : step.outputEntityId
      if (mode === "segment") {
        const fromName = typeof p.from === "string" ? p.from : ""
        const toName = typeof p.to === "string" ? p.to : ""
        if (point3Registry.has(fromName) && point3Registry.has(toName)) {
          actions.push({
            actionId: "solid.create_segment",
            actionKey: nextKey("ds-seg3"),
            factIds: [],
            inputs: { alias: step.outputEntityId, label, vertexNames: [fromName, toName] }
          } as DraftAction)
        }
      } else if (mode === "perpendicular_foot_on_plane") {
        const src = point3Registry.get(String(p.sourcePoint ?? ""))
        const planeNames = Array.isArray(p.planePoints) ? p.planePoints.map(String) : []
        const p1 = planeNames[0] ? point3Registry.get(planeNames[0]) : undefined
        const p2 = planeNames[1] ? point3Registry.get(planeNames[1]) : undefined
        const p3 = planeNames[2] ? point3Registry.get(planeNames[2]) : undefined
        if (src && p1 && p2 && p3) {
          const ux = p2.x - p1.x, uy = p2.y - p1.y, uz = p2.z - p1.z
          const vx = p3.x - p1.x, vy = p3.y - p1.y, vz = p3.z - p1.z
          const nx = uy * vz - uz * vy
          const ny = uz * vx - ux * vz
          const nz = ux * vy - uy * vx
          const nSq = nx * nx + ny * ny + nz * nz
          if (nSq > 1e-12) {
            const d = ((src.x - p1.x) * nx + (src.y - p1.y) * ny + (src.z - p1.z) * nz) / nSq
            const pos = vec3(src.x - d * nx, src.y - d * ny, src.z - d * nz)
            point3Registry.set(label, pos)
            actions.push({
              actionId: "solid.create_point",
              actionKey: nextKey("ds-pt3"),
              factIds: [],
              inputs: { alias: step.outputEntityId, label, position: pos }
            } as DraftAction)
          }
        }
      } else if (mode === "perpendicular_foot_on_line") {
        const src = point3Registry.get(String(p.sourcePoint ?? ""))
        const a = point3Registry.get(String(p.lineFrom ?? p.from ?? ""))
        const b = point3Registry.get(String(p.lineTo ?? p.to ?? ""))
        if (src && a && b) {
          const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z
          const abSq = abx * abx + aby * aby + abz * abz
          if (abSq > 1e-12) {
            const t = ((src.x - a.x) * abx + (src.y - a.y) * aby + (src.z - a.z) * abz) / abSq
            const pos = vec3(a.x + t * abx, a.y + t * aby, a.z + t * abz)
            point3Registry.set(label, pos)
            actions.push({
              actionId: "solid.create_point",
              actionKey: nextKey("ds-pt3"),
              factIds: [],
              inputs: { alias: step.outputEntityId, label, position: pos }
            } as DraftAction)
          }
        }
      } else {
        const fromName = typeof p.from === "string" ? p.from : ""
        const toName = typeof p.to === "string" ? p.to : ""
        const t = Math.min(1, Math.max(0, asNum(p.ratioFromFirst, 0.5)))
        const a = point3Registry.get(fromName)
        const b = point3Registry.get(toName)
        if (a && b) {
          const pos = vec3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)
          point3Registry.set(label, pos)
          actions.push({
            actionId: "solid.create_point",
            actionKey: nextKey("ds-pt3"),
            factIds: [],
            inputs: { alias: step.outputEntityId, label, position: pos }
          } as DraftAction)
        }
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
    if (disclosures.length > 0) {
      return {
        schemaVersion: PLAN_SCHEMA_VERSION,
        kind: "answer",
        goal: intent.goal,
        factIds: [],
        answer: disclosures.join("；"),
        toolResultRefs: []
      }
    }
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
    ...(disclosures.length > 0 ? { answer: disclosures.join("；") } : {}),
    actions
  }
}
