import type { Coordinate, GeometryDocument, Vector3 } from "@draw/dsl"
import {
  DS_ACTION_CLOSED_SET,
  PLAN_SCHEMA_VERSION,
  isDsActionName,
  solveConstraint3d,
  type ConstraintSolve3dRequest,
  type DsActionName,
  type NamedVertex3,
  type PlanEnvelope
} from "@draw/agent-core"
import {
  intersectPlanarLineAndConicExact,
  tangentLineToConicAt,
  type PlanarConic
} from "@draw/geometry-kernel"
import type { DraftAction } from "@draw/scene-graph"
import { createSpeculativeCanvas } from "./speculativeCanvas"

export const DS_ACTION_TOOL_NAMES = DS_ACTION_CLOSED_SET

export type DsActionStatus = "accepted" | "repairable" | "blocked"

export interface DsActionToolCallParsed {
  readonly ok: true
  readonly name: DsActionName
  readonly input: Record<string, unknown>
}

export interface DsActionToolCallInvalid {
  readonly ok: false
  readonly status: Exclude<DsActionStatus, "accepted">
  readonly code: string
  readonly detail: string
}

export interface DsActionExecutionResult {
  readonly ok: boolean
  readonly status: DsActionStatus
  readonly action: DsActionName
  readonly stateChanged: boolean
  readonly entity?: string
  readonly position?: Coordinate
  readonly candidateHash: string
  readonly stepIndex: number
  readonly primitiveCount: number
  readonly measurement?: Record<string, unknown>
  readonly constraintStatus?: string
  readonly repairHint?: string
  readonly blockerCode?: string
  readonly terminated?: { readonly plan: PlanEnvelope }
}

/** Closed subset of DS actions backed by real kernel execution / state transitions or real observations. */
export const IMPLEMENTED_DS_ACTION_TOOLS: readonly DsActionName[] = [
  "declare_entity",
  "add_relation",
  "choose_strategy",
  "construct_point",
  "construct_line",
  "construct_segment",
  "construct_intersection",
  "construct_circle",
  "construct_conic",
  "construct_tangent",
  "construct_perpendicular",
  "construct_parallel",
  "construct_solid",
  "repair_entity",
  "repair_constraint",
  "finish_candidate",
  "request_clarification"
]

export const NON_CONSTRUCTIVE_DS_ACTIONS: ReadonlySet<DsActionName> = new Set<DsActionName>([
  "declare_entity",
  "add_relation",
  "choose_strategy",
  "query_measurement",
  "query_constraint_status",
  "request_clarification"
])

export interface DsActionSession {
  execute(toolName: string, rawInput: unknown): DsActionExecutionResult
  currentSnapshot(): ReturnType<ReturnType<typeof createSpeculativeCanvas>["snapshot"]>
}

const DS_ACTION_DESCRIPTIONS: Record<DsActionName, string> = {
  declare_entity: "Declare a named entity (point/line/segment/conic/circle/solid/function) in scope/state.",
  add_relation: "Attach a named geometric relation (length/perpendicular/parallel/angle/ratio/tangent).",
  choose_strategy: "Select a geometric construction strategy for an entity.",
  construct_base: "Construct a base polygon or reference frame in 2D/3D.",
  construct_point: "Construct a 2D/3D point by coordinates or ratio/midpoint host.",
  construct_line: "Construct a 2D line through two points or line equation a*x+b*y+c=0.",
  construct_segment: "Construct a segment between two existing named points.",
  construct_intersection: "Compute intersection between two lines or a line and a conic/circle.",
  construct_circle: "Construct a circle by center and radius.",
  construct_conic: "Construct an ellipse, parabola, or hyperbola from equation or semi-axes.",
  construct_tangent: "Construct a tangent line to a conic at a point.",
  construct_perpendicular: "Construct a line through a point perpendicular to a line.",
  construct_parallel: "Construct a line through a point parallel to a line.",
  construct_solid: "Construct a named parametric solid via kernel solver (never raw hand vertices).",
  construct_face: "Construct a named polygonal face from existing points.",
  construct_fold_state: "Record a pre_fold/post_fold state transition along a hinge.",
  query_measurement: "Inspect distance/coordinates of currently staged entities.",
  query_constraint_status: "Inspect satisfied or missing entities/constraints on current speculative candidate.",
  repair_entity: "Rollback or replace a previously staged entity step.",
  repair_constraint: "Update/re-check a constraint status after repair.",
  finish_candidate: "Finalize all speculative actions into a plan envelope for independent verification.",
  request_clarification: "Stop construction honestly when a required figure or parameter cannot be determined."
}

export function buildDsActionToolSchemas(options: { includeUnimplemented?: boolean } = {}) {
  const names = options.includeUnimplemented ? DS_ACTION_TOOL_NAMES : IMPLEMENTED_DS_ACTION_TOOLS
  return names.map((name) => ({
    type: "function",
    function: {
      name,
      description: DS_ACTION_DESCRIPTIONS[name],
      parameters: {
        type: "object",
        additionalProperties: true
      }
    }
  }))
}

export function parseDsActionToolCall(
  toolName: string,
  rawInput: unknown
): DsActionToolCallParsed | DsActionToolCallInvalid {
  if (!isDsActionName(toolName)) {
    return {
      ok: false,
      status: "blocked",
      code: "unexpected_tool_call",
      detail: `tool ${toolName} is outside the closed DS action set`
    }
  }
  let inputObj: unknown = rawInput
  if (typeof rawInput === "string") {
    try {
      inputObj = JSON.parse(rawInput)
    } catch {
      return {
        ok: false,
        status: "repairable",
        code: "invalid_json",
        detail: `action ${toolName} argument must be a JSON object`
      }
    }
  }
  if (typeof inputObj !== "object" || inputObj === null || Array.isArray(inputObj)) {
    return {
      ok: false,
      status: "repairable",
      code: "invalid_schema",
      detail: `action ${toolName} argument must be a plain object`
    }
  }
  return { ok: true, name: toolName, input: inputObj as Record<string, unknown> }
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null
}

function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function asPositiveNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null
}

function asStringList(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const item of v) {
    const s = asString(item)
    if (!s) return null
    out.push(s)
  }
  return out
}

type SolidResolution =
  | { ok: true; request: ConstraintSolve3dRequest; explicitNames?: string[] }
  | { ok: false; status: "repairable" | "blocked"; blockerCode: string; repairHint: string }

function resolveBasePolygonFromParams(
  kind: string,
  input: Record<string, unknown>,
  points3: ReadonlyMap<string, Vector3>
):
  | { ok: true; baseVertices: NamedVertex3[]; defaultTopPrefix?: boolean }
  | { ok: false; status: "repairable" | "blocked"; blockerCode: string; repairHint: string } {
  const baseRefs = asStringList(input.baseVertexNames ?? input.baseLabels)
  const wantTriangle = kind === "triangular_prism" || kind === "tetrahedron"
  if (baseRefs && Array.isArray(input.baseVertexNames)) {
    if (baseRefs.length < 3) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "baseVertexNames requires at least 3 distinct point names" }
    }
    const baseVertices: NamedVertex3[] = []
    for (const name of baseRefs) {
      const pt = points3.get(name)
      if (!pt) {
        return { ok: false, status: "repairable", blockerCode: "undeclared_entity_ref", repairHint: `undeclared base point "${name}"` }
      }
      baseVertices.push({ name, point: pt })
    }
    return { ok: true, baseVertices }
  }

  const side = asPositiveNumber(input.sideLength ?? input.baseSide)
  const w = asPositiveNumber(input.width ?? input.ab)
  const d = asPositiveNumber(input.depth ?? input.bc)
  if (wantTriangle) {
    const ab = asPositiveNumber(input.ab ?? side)
    const bc = asPositiveNumber(input.bc ?? side)
    const ac = asPositiveNumber(input.ac ?? side)
    const names = baseRefs && baseRefs.length === 3 ? baseRefs : ["A", "B", "C"]
    if (ab !== null && ac !== null && bc !== null) {
      const xC = (ac * ac + ab * ab - bc * bc) / (2 * ab)
      const ySq = ac * ac - xC * xC
      if (!(ySq > 1e-12)) {
        return { ok: false, status: "blocked", blockerCode: "infeasible", repairHint: "base triangle side lengths violate triangle inequality" }
      }
      return {
        ok: true,
        baseVertices: [
          { name: names[0]!, point: { x: 0, y: 0, z: 0 } },
          { name: names[1]!, point: { x: ab, y: 0, z: 0 } },
          { name: names[2]!, point: { x: xC, y: Math.sqrt(ySq), z: 0 } }
        ]
      }
    }
    if (ab !== null && bc !== null) {
      return {
        ok: true,
        baseVertices: [
          { name: names[0]!, point: { x: 0, y: 0, z: 0 } },
          { name: names[1]!, point: { x: ab, y: 0, z: 0 } },
          { name: names[2]!, point: { x: 0, y: bc, z: 0 } }
        ]
      }
    }
    return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "triangular base requires positive sideLength or edge lengths" }
  }

  const quadW = w ?? side
  const quadD = d ?? side
  if (quadW === null || quadD === null) {
    return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "base requires positive sideLength or width and depth" }
  }
  const names = baseRefs && baseRefs.length === 4 ? baseRefs : ["A", "B", "C", "D"]
  return {
    ok: true,
    baseVertices: [
      { name: names[0]!, point: { x: 0, y: 0, z: 0 } },
      { name: names[1]!, point: { x: quadW, y: 0, z: 0 } },
      { name: names[2]!, point: { x: quadW, y: quadD, z: 0 } },
      { name: names[3]!, point: { x: 0, y: quadD, z: 0 } }
    ]
  }
}

function resolveConstructSolidRequest(
  input: Record<string, unknown>,
  points3: ReadonlyMap<string, Vector3>
): SolidResolution {
  if (Array.isArray(input.vertices)) {
    return {
      ok: false,
      status: "blocked",
      blockerCode: "hand_computed_vertices_forbidden",
      repairHint: "never pass hand-computed vertices; pass parametric shape parameters"
    }
  }
  const rawKind = asString(input.kind ?? input.shape)
  if (!rawKind) {
    return {
      ok: false,
      status: "repairable",
      blockerCode: "missing_required_parameter",
      repairHint: "construct_solid requires kind (regular_pyramid | prism | perpendicular_pyramid | tetrahedron)"
    }
  }
  const kind = rawKind.toLowerCase()
  const vNames = asStringList(input.vertexNames)
  if (input.vertexNames !== undefined && (!vNames || new Set(vNames).size !== vNames.length)) {
    return {
      ok: false,
      status: "repairable",
      blockerCode: "duplicate_vertex_name",
      repairHint: "vertexNames must contain distinct non-empty names"
    }
  }

  if (kind === "regular_pyramid" || kind === "square_pyramid") {
    const side = asPositiveNumber(input.sideLength ?? input.baseSide ?? input.ab)
    if (side === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive sideLength / baseSide` }
    }
    const directLat = asPositiveNumber(input.lateralEdge)
    const height = asPositiveNumber(input.height)
    const lateral = directLat ?? (height !== null ? Math.hypot(height, (side * Math.SQRT2) / 2) : null)
    if (lateral === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive height or lateralEdge` }
    }
    if (vNames && vNames.length !== 5) {
      return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `${rawKind} vertexNames must have length 5` }
    }
    const baseLabels = vNames
      ? ([vNames[0]!, vNames[1]!, vNames[2]!, vNames[3]!] as const)
      : (["A", "B", "C", "D"] as const)
    const apexName = vNames ? vNames[4]! : (asString(input.apexName) ?? "P")
    return {
      ok: true,
      request: { kind: "regular_pyramid", baseSide: side, lateralEdge: lateral, baseLabels, apexName },
      ...(vNames ? { explicitNames: vNames } : {})
    }
  }

  if (kind === "tetrahedron" || kind === "regular_tetrahedron") {
    const edge = asPositiveNumber(input.edgeLength ?? input.sideLength)
    const ab = asPositiveNumber(input.ab) ?? edge
    const ac = asPositiveNumber(input.ac) ?? edge
    const bc = asPositiveNumber(input.bc) ?? edge
    const pa = asPositiveNumber(input.pa) ?? edge
    const pb = asPositiveNumber(input.pb) ?? edge
    const pc = asPositiveNumber(input.pc) ?? edge
    if (ab === null || ac === null || bc === null || pa === null || pb === null || pc === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "tetrahedron requires edgeLength or all six positive edge lengths (ab, ac, bc, pa, pb, pc)" }
    }
    if (vNames && vNames.length !== 4) {
      return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: "tetrahedron vertexNames must have length 4" }
    }
    const names = vNames
      ? ([vNames[0]!, vNames[1]!, vNames[2]!, vNames[3]!] as const)
      : (["P", "A", "B", "C"] as const)
    return {
      ok: true,
      request: { kind: "tetrahedron", names, ab, ac, bc, pa, pb, pc },
      ...(vNames ? { explicitNames: vNames } : {})
    }
  }

  if (kind === "prism" || kind === "triangular_prism" || kind === "rectangular_prism" || kind === "square_prism" || kind === "right_prism") {
    const height = asPositiveNumber(input.height)
    if (height === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: `${rawKind} requires positive height` }
    }
    const base = resolveBasePolygonFromParams(kind, input, points3)
    if (!base.ok) return base
    const n = base.baseVertices.length
    if (vNames && vNames.length !== 2 * n) {
      return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `prism vertexNames must have length ${2 * n}` }
    }
    const baseVertices = vNames
      ? base.baseVertices.map((bv, i) => ({ name: vNames[i]!, point: bv.point }))
      : base.baseVertices
    const explicitTop = asStringList(input.topLabels)
    const topLabels = vNames
      ? vNames.slice(n)
      : explicitTop && explicitTop.length === n
        ? explicitTop
        : baseVertices.map((bv) => `${bv.name}1`)
    return {
      ok: true,
      request: { kind: "prism", baseVertices, topLabels, height }
    }
  }

  if (kind === "perpendicular_pyramid") {
    const height = asPositiveNumber(input.height ?? input.pa)
    if (height === null) {
      return { ok: false, status: "repairable", blockerCode: "missing_required_parameter", repairHint: "perpendicular_pyramid requires positive height" }
    }
    const base = resolveBasePolygonFromParams(kind, input, points3)
    if (!base.ok) return base
    const n = base.baseVertices.length
    if (vNames && vNames.length !== n + 1) {
      return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `perpendicular_pyramid vertexNames must have length ${n + 1}` }
    }
    const baseVertices = vNames
      ? base.baseVertices.map((bv, i) => ({ name: vNames[i]!, point: bv.point }))
      : base.baseVertices
    const apexName = vNames ? vNames[n]! : (asString(input.apexName) ?? "S")
    const footName = asString(input.footName) ?? baseVertices[0]!.name
    return {
      ok: true,
      request: { kind: "perpendicular_pyramid", apexName, baseVertices, footName, height }
    }
  }

  return {
    ok: false,
    status: "blocked",
    blockerCode: "unsupported_action",
    repairHint: `solid kind "${rawKind}" is unsupported`
  }
}

/** Single-action exploratory execution backing iterative DS calls (Task F2). */
export function createDsActionSession(options: {
  readonly workspace: GeometryDocument["workspace"]
  readonly baseDocument: GeometryDocument
  readonly runId?: string
}): DsActionSession {
  const speculative = createSpeculativeCanvas(options.baseDocument, { runId: options.runId })
  const entities = new Map<string, { id: string; kind: string; scopeId: string; stateId: string }>()
  const points2 = new Map<string, Coordinate>()
  const points3 = new Map<string, Vector3>()
  const lines2 = new Map<string, { a: Coordinate; b: Coordinate }>()
  const conics2 = new Map<string, PlanarConic>()
  const relations: Array<{ kind: string; targets: string[] }> = []
  const pointHistory: Array<{ points2: Map<string, Coordinate>; points3: Map<string, Vector3> }> = [
    { points2: new Map(), points3: new Map() }
  ]

  const failRepairable = (action: DsActionName, blockerCode: string, repairHint: string): DsActionExecutionResult => {
    const snap = speculative.snapshot()
    return {
      ok: false,
      status: "repairable",
      action,
      stateChanged: false,
      candidateHash: snap.candidateHash,
      stepIndex: snap.stepIndex,
      primitiveCount: snap.primitiveCount,
      blockerCode,
      repairHint
    }
  }

  const failBlocked = (action: DsActionName, blockerCode: string, repairHint: string): DsActionExecutionResult => {
    const snap = speculative.snapshot()
    return {
      ok: false,
      status: "blocked",
      action,
      stateChanged: false,
      candidateHash: snap.candidateHash,
      stepIndex: snap.stepIndex,
      primitiveCount: snap.primitiveCount,
      blockerCode,
      repairHint
    }
  }

  const stageDraftAction = (
    actionName: DsActionName,
    draftAction: DraftAction,
    entityId?: string,
    position?: Coordinate
  ): DsActionExecutionResult => {
    const before = speculative.snapshot()
    const step = speculative.applyAction(draftAction)
    if (!step.ok) {
      return {
        ok: false,
        status: step.status,
        action: actionName,
        stateChanged: false,
        ...(entityId === undefined ? {} : { entity: entityId }),
        candidateHash: step.candidateHash,
        stepIndex: step.stepIndex,
        primitiveCount: step.primitiveCount,
        blockerCode: step.diagnostics[0]?.code ?? "compile_failed",
        repairHint: step.detail ?? "adjust parameters and retry"
      }
    }
    pointHistory.push({ points2: new Map(points2), points3: new Map(points3) })
    return {
      ok: true,
      status: "accepted",
      action: actionName,
      stateChanged: step.stepIndex > before.stepIndex || step.candidateHash !== before.candidateHash,
      ...(entityId === undefined ? {} : { entity: entityId }),
      ...(position === undefined ? {} : { position }),
      candidateHash: step.candidateHash,
      stepIndex: step.stepIndex,
      primitiveCount: step.primitiveCount
    }
  }

  return {
    currentSnapshot: () => speculative.snapshot(),

    execute(toolName, rawInput) {
      const parsed = parseDsActionToolCall(toolName, rawInput)
      const snap = speculative.snapshot()
      if (!parsed.ok) {
        return {
          ok: false,
          status: parsed.status,
          action: isDsActionName(toolName) ? toolName : "declare_entity",
          stateChanged: false,
          candidateHash: snap.candidateHash,
          stepIndex: snap.stepIndex,
          primitiveCount: snap.primitiveCount,
          blockerCode: parsed.code,
          repairHint: parsed.detail
        }
      }
      const { name, input } = parsed
      const stepSeq = snap.stepIndex + 1

      if (name === "declare_entity") {
        const id = asString(input.id)
        if (!id) return failRepairable(name, "missing_required_parameter", "declare_entity requires non-empty id")
        entities.set(id, {
          id,
          kind: asString(input.kind) ?? "point",
          scopeId: asString(input.scopeId) ?? "shared",
          stateId: asString(input.stateId) ?? "shared"
        })
        return { ok: true, status: "accepted", action: name, stateChanged: false, entity: id, candidateHash: snap.candidateHash, stepIndex: snap.stepIndex, primitiveCount: snap.primitiveCount }
      }

      if (name === "add_relation") {
        const kind = asString(input.kind)
        const targets = Array.isArray(input.targets) ? input.targets.filter((x): x is string => typeof x === "string") : []
        if (!kind || targets.length === 0) {
          return failRepairable(name, "missing_required_parameter", "add_relation requires kind and targets")
        }
        relations.push({ kind, targets })
        return { ok: true, status: "accepted", action: name, stateChanged: false, candidateHash: snap.candidateHash, stepIndex: snap.stepIndex, primitiveCount: snap.primitiveCount }
      }

      if (name === "choose_strategy") {
        return { ok: true, status: "accepted", action: name, stateChanged: false, candidateHash: snap.candidateHash, stepIndex: snap.stepIndex, primitiveCount: snap.primitiveCount }
      }

      if (name === "query_measurement" || name === "query_constraint_status") {
        return failBlocked(name, "unsupported_action", `${name} observation handler is not wired yet`)
      }

      if (name === "repair_entity" || name === "repair_constraint") {
        const rolled = speculative.rollback(1)
        const snapshotPts = pointHistory[Math.min(rolled.stepIndex, pointHistory.length - 1)] ?? pointHistory[0]!
        pointHistory.length = Math.max(1, rolled.stepIndex + 1)
        points2.clear()
        for (const [k, v] of snapshotPts.points2) points2.set(k, v)
        points3.clear()
        for (const [k, v] of snapshotPts.points3) points3.set(k, v)
        return {
          ok: true,
          status: "accepted",
          action: name,
          stateChanged: rolled.stepIndex < snap.stepIndex,
          candidateHash: rolled.candidateHash,
          stepIndex: rolled.stepIndex,
          primitiveCount: rolled.primitiveCount
        }
      }

      if (name === "construct_point") {
        const id = asString(input.id ?? input.output) ?? `P${stepSeq}`
        const label = asString(input.label) ?? id
        const x = asFiniteNumber(input.x)
        const y = asFiniteNumber(input.y)
        if (x === null || y === null) {
          return failRepairable(name, "missing_required_parameter", "construct_point requires finite x and y coordinates")
        }
        const pt = { x, y }
        points2.set(id, pt)
        points2.set(label, pt)
        entities.set(id, { id, kind: "point", scopeId: asString(input.scopeId) ?? "shared", stateId: asString(input.stateId) ?? "shared" })
        return stageDraftAction(
          name,
          { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, points: [pt] } },
          id,
          pt
        )
      }

      if (name === "construct_segment" || name === "construct_line") {
        const id = asString(input.id ?? input.output) ?? `L${stepSeq}`
        const label = asString(input.label) ?? id
        const fromId = asString(input.from)
        const toId = asString(input.to)
        const p1 = fromId ? points2.get(fromId) : undefined
        const p2 = toId ? points2.get(toId) : undefined
        if (!p1 || !p2) {
          return failRepairable(name, "undeclared_entity_ref", `construct points before referencing "${fromId ?? "?"}" and "${toId ?? "?"}"`)
        }
        lines2.set(id, { a: p1, b: p2 })
        lines2.set(label, { a: p1, b: p2 })
        return stageDraftAction(
          name,
          {
            actionId: name === "construct_segment" ? "planar.create_segment" : "planar.create_line",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: { alias: id, label, points: [p1, p2] }
          },
          id
        )
      }

      if (name === "construct_intersection") {
        const outId = asString(input.output ?? input.id) ?? `X${stepSeq}`
        const lA = asString(input.lineA) ? lines2.get(String(input.lineA)) : undefined
        const lB = asString(input.lineB) ? lines2.get(String(input.lineB)) : undefined
        const conicId = asString(input.conicId)
        if (lA && conicId && conics2.has(conicId)) {
          const res = intersectPlanarLineAndConicExact({ type: "line", a: lA.a, b: lA.b }, conics2.get(conicId)!)
          const pt = res.points[0]
          if (!pt) return failRepairable(name, "no_intersection", "line does not intersect conic")
          points2.set(outId, pt)
          return stageDraftAction(
            name,
            { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: outId, label: outId, points: [pt] } },
            outId,
            pt
          )
        }
        if (!lA || !lB) {
          return failRepairable(name, "undeclared_entity_ref", `declare/construct lines before construct_intersection`)
        }
        const dx1 = lA.b.x - lA.a.x, dy1 = lA.b.y - lA.a.y
        const dx2 = lB.b.x - lB.a.x, dy2 = lB.b.y - lB.a.y
        const det = dx1 * dy2 - dy1 * dx2
        if (Math.abs(det) <= 1e-9) {
          return failRepairable(name, "parallel_lines", "lines are parallel or collinear")
        }
        const t = ((lB.a.x - lA.a.x) * dy2 - (lB.a.y - lA.a.y) * dx2) / det
        const pt = { x: lA.a.x + t * dx1, y: lA.a.y + t * dy1 }
        points2.set(outId, pt)
        return stageDraftAction(
          name,
          { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: outId, label: outId, points: [pt] } },
          outId,
          pt
        )
      }

      if (name === "construct_circle") {
        const id = asString(input.id ?? input.output) ?? `C${stepSeq}`
        const cx = asFiniteNumber(input.cx) ?? 0
        const cy = asFiniteNumber(input.cy) ?? 0
        const r = asFiniteNumber(input.radius)
        if (r === null || !(r > 0)) {
          return failRepairable(name, "missing_required_parameter", "construct_circle requires positive radius")
        }
        const circ: PlanarConic = { id, type: "circle", center: { x: cx, y: cy }, radius: r }
        conics2.set(id, circ)
        return stageDraftAction(
          name,
          { actionId: "planar.create_circle", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label: id, center: { x: cx, y: cy }, radius: r } },
          id
        )
      }

      if (name === "construct_conic") {
        const id = asString(input.id ?? input.output) ?? `C${stepSeq}`
        const rx = asFiniteNumber(input.radiusX)
        const ry = asFiniteNumber(input.radiusY)
        const kind = input.conicType === "hyperbola" ? "hyperbola" : "ellipse"
        if (rx === null || ry === null || !(rx > 0 && ry > 0)) {
          return failRepairable(name, "missing_required_parameter", "construct_conic requires positive radiusX and radiusY")
        }
        const conic: PlanarConic =
          kind === "ellipse"
            ? { id, type: "ellipse", center: { x: 0, y: 0 }, radiusX: rx, radiusY: ry }
            : { id, type: "hyperbola", center: { x: 0, y: 0 }, axis: "x", radiusX: rx, radiusY: ry }
        conics2.set(id, conic)
        return stageDraftAction(
          name,
          { actionId: "planar.create_conic", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label: id, kind, center: { x: 0, y: 0 }, radiusX: rx, radiusY: ry } },
          id
        )
      }

      if (name === "construct_tangent") {
        const id = asString(input.id ?? input.output) ?? `T${stepSeq}`
        const conicId = asString(input.conicId)
        const ptId = asString(input.pointId)
        const conic = conicId ? conics2.get(conicId) : undefined
        const pt = ptId ? points2.get(ptId) : undefined
        if (!conic || !pt) return failRepairable(name, "undeclared_entity_ref", "construct_tangent requires valid conicId and pointId")
        const tan = tangentLineToConicAt(conic, pt, 5)
        if (!tan) return failRepairable(name, "not_on_conic", "point does not lie on conic")
        lines2.set(id, { a: tan.line.a, b: tan.line.b })
        return stageDraftAction(
          name,
          { actionId: "planar.create_line", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label: id, points: [tan.line.a, tan.line.b] } },
          id
        )
      }

      if (name === "construct_perpendicular" || name === "construct_parallel") {
        const id = asString(input.id ?? input.output) ?? `L${stepSeq}`
        const lineId = asString(input.lineId)
        const ptId = asString(input.throughPointId)
        const ref = lineId ? lines2.get(lineId) : undefined
        const pt = ptId ? points2.get(ptId) : undefined
        if (!ref || !pt) return failRepairable(name, "undeclared_entity_ref", `${name} requires existing lineId and throughPointId`)
        const dx = ref.b.x - ref.a.x
        const dy = ref.b.y - ref.a.y
        const len = Math.hypot(dx, dy)
        if (!(len > 1e-12)) return failRepairable(name, "degenerate_line", "reference line is degenerate")
        const ux = dx / len, uy = dy / len
        const dirX = name === "construct_perpendicular" ? -uy : ux
        const dirY = name === "construct_perpendicular" ? ux : uy
        const endpoints: [Coordinate, Coordinate] = [
          { x: pt.x - dirX * 5, y: pt.y - dirY * 5 },
          { x: pt.x + dirX * 5, y: pt.y + dirY * 5 }
        ]
        lines2.set(id, { a: endpoints[0], b: endpoints[1] })
        return stageDraftAction(
          name,
          { actionId: "planar.create_line", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label: id, points: endpoints } },
          id
        )
      }

      if (name === "finish_candidate") {
        if (snap.actions.length === 0) {
          return failRepairable(name, "empty_candidate", "stage at least one geometric action before finish_candidate")
        }
        const plan: PlanEnvelope = {
          schemaVersion: PLAN_SCHEMA_VERSION,
          kind: "plan",
          goal: asString(input.goal) ?? "DS 动作级构图候选",
          factIds: [],
          actions: [...snap.actions]
        }
        return {
          ok: true,
          status: "accepted",
          action: name,
          stateChanged: false,
          candidateHash: snap.candidateHash,
          stepIndex: snap.stepIndex,
          primitiveCount: snap.primitiveCount,
          terminated: { plan }
        }
      }

      if (name === "request_clarification") {
        const questions = Array.isArray(input.questions)
          ? input.questions.filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          : []
        const fallback = asString(input.reason) ?? "题目缺少关键几何信息，请补充后重试。"
        const plan: PlanEnvelope = {
          schemaVersion: PLAN_SCHEMA_VERSION,
          kind: "clarification",
          goal: asString(input.goal) ?? "请求用户澄清",
          factIds: [],
          questions: questions.length > 0 ? questions : [fallback]
        }
        return {
          ok: true,
          status: "blocked",
          action: name,
          stateChanged: false,
          candidateHash: snap.candidateHash,
          stepIndex: snap.stepIndex,
          primitiveCount: snap.primitiveCount,
          blockerCode: "needs_clarification",
          terminated: { plan }
        }
      }

      if (name === "construct_solid") {
        const resolved = resolveConstructSolidRequest(input, points3)
        if (!resolved.ok) {
          return resolved.status === "blocked"
            ? failBlocked(name, resolved.blockerCode, resolved.repairHint)
            : failRepairable(name, resolved.blockerCode, resolved.repairHint)
        }
        const solved = solveConstraint3d(resolved.request)
        if (solved.status !== "solved" || !solved.topologyValid || !solved.vertices || !solved.faceRings) {
          return solved.status === "infeasible" || solved.status === "degenerate"
            ? failBlocked(name, solved.status, solved.reason ?? "solid parameters are infeasible or degenerate")
            : failRepairable(name, solved.status, solved.reason ?? "solid parameters need adjustment")
        }
        const id = asString(input.id ?? input.output) ?? `SOLID_${stepSeq}`
        const label = asString(input.label) ?? id
        const vertexNames = Object.keys(solved.pointRegistry)
        const vertices = vertexNames.map((vn) => solved.pointRegistry[vn]!)
        const nameToIdx = new Map(vertexNames.map((vn, idx) => [vn, idx]))
        const faces = solved.namedFaceRings
          ? solved.namedFaceRings.map((ring) => ring.map((vn) => nameToIdx.get(vn)!))
          : solved.faceRings
        for (const [vn, pt] of Object.entries(solved.pointRegistry)) {
          points3.set(vn, pt)
        }
        const staged = stageDraftAction(
          name,
          {
            actionId: "solid.create_polyhedron",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: { alias: id, label, vertices, vertexNames, faces }
          } as DraftAction,
          id
        )
        if (!staged.ok) {
          const rollbackSnap = pointHistory[Math.min(snap.stepIndex, pointHistory.length - 1)]!
          points3.clear()
          for (const [k, v] of rollbackSnap.points3) points3.set(k, v)
        }
        return staged
      }

      return failBlocked(name, "unsupported_action", `${name} kernel execution is not implemented yet`)
    }
  }
}
