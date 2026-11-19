import { createEmptyDocument, type Coordinate, type GeometryDocument, type Vector3 } from "@draw/dsl"
import {
  DS_ACTION_CLOSED_SET,
  PLAN_SCHEMA_VERSION,
  foldPointAboutHinge,
  isDsActionName,
  solveConstraint2d,
  solveConstraint3d,
  type ConstraintSolve3dRequest,
  type DsActionName,
  type NamedVertex3,
  type PlanEnvelope
} from "@draw/agent-core"
import {
  distanceVector3,
  fitOriginConicThroughPoints,
  intersectPlanarLineAndConicExact,
  planeFromPoints,
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
  readonly toolName: DsActionName
  readonly progressSignature: string
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
  readonly terminated?: {
    readonly plan: PlanEnvelope
    readonly slices?: readonly DsActionStateSlice[]
  }
}

type DsActionRawResult = Omit<DsActionExecutionResult, "toolName" | "progressSignature">

/** Closed subset of DS actions backed by real kernel execution / state transitions or real observations. */
export const IMPLEMENTED_DS_ACTION_TOOLS: readonly DsActionName[] = [
  "declare_entity",
  "add_relation",
  "choose_strategy",
  "construct_base",
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
  "construct_equal_edge_triangular_prism",
  "construct_circumsphere",
  "construct_face",
  "construct_fold_state",
  "query_measurement",
  "query_constraint_status",
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

export interface DsActionStateSlice {
  readonly scopeId: string
  readonly stateId?: string
  readonly branchId?: string
  readonly candidateHash: string
  readonly actions: readonly DraftAction[]
}

export interface DsActionReferenceDirectory {
  readonly materializedPoints: readonly string[]
  readonly materializedLines: readonly string[]
  readonly materializedConics: readonly string[]
  readonly declaredOnly: readonly string[]
  readonly truncated: boolean
}

export interface DsActionSession {
  referenceDirectory(branchId?: string): DsActionReferenceDirectory
  execute(toolName: string, rawInput: unknown): DsActionExecutionResult
  currentSnapshot(): ReturnType<ReturnType<typeof createSpeculativeCanvas>["snapshot"]>
  stateSlices(): readonly DsActionStateSlice[]
}

const DS_ACTION_DESCRIPTIONS: Record<DsActionName, string> = {
  declare_entity: "Declare an entity name/kind in scope/state; this does not draw geometry. Use construct_point or another construction action to materialize it.",
  add_relation: "Attach a named geometric relation (length/perpendicular/parallel/angle/ratio/tangent).",
  choose_strategy: "Select a geometric construction strategy for an entity.",
  construct_base: "Construct a base polygon or reference frame in 2D/3D.",
  construct_point: "Construct a named point: id with 2D x,y or 3D x,y,z, or id with from,to,ratio referencing materialized points.",
  construct_line: "Construct a named 2D line with id: use existing point names from and to, or finite equation coefficients a,b,c for a*x+b*y+c=0; never guess missing coefficients.",
  construct_segment: "Construct a segment between two existing named points.",
  construct_intersection: "Compute intersection between two lines or a line and a conic/circle.",
  construct_circle: "Construct a circle by center and radius.",
  construct_conic: "Give id and conicType. Ellipse/hyperbola require positive radiusX and radiusY, OR throughPointIds with exactly two existing points of a centered axis-aligned conic; never guess semi-axes. Optional center cx, cy (default origin). Hyperbola axis x or y. Parabola requires nonzero focalParameter and axis x or y (default y), optional vertex vx, vy. Raw equation strings are not supported.",
  construct_tangent: "Construct a tangent line to a conic at a point.",
  construct_perpendicular: "Construct a line through a point perpendicular to a line.",
  construct_parallel: "Construct a line through a point parallel to a line.",
  construct_solid: "Construct a named parametric solid via kernel solver (never raw hand vertices).",
  construct_equal_edge_triangular_prism: "For a right triangular prism whose every edge has symbolic length a: give a named solid id and a positive displayScale; the kernel builds all geometry, not a numeric value for a.",
  construct_circumsphere: "Derive a real circumsphere from an existing named solid; never provide center or radius.",
  construct_face: "Construct a named polygonal face from existing points.",
  construct_fold_state: "Record a pre_fold/post_fold state transition along a hinge.",
  query_measurement: "Use metric=distance with targets of exactly two materialized points, or metric=position/coordinates with target naming one materialized point.",
  query_constraint_status: "Use targets of existing named points and kind=coplanar, fixed_distance (with positive expected), or collinear to inspect constraint status.",
  repair_entity: "Rollback or replace a previously staged entity step.",
  repair_constraint: "Update/re-check a constraint status after repair.",
  finish_candidate: "Finalize all speculative actions into a plan envelope for independent verification.",
  request_clarification: "Stop construction honestly when a required figure or parameter cannot be determined."
}

/** The public geometry vocabulary is shared with the kernel dispatch below. */
export const SOLID_KIND_FAMILIES = {
  regular_pyramid: ["regular_pyramid", "square_pyramid"],
  tetrahedron: ["tetrahedron", "regular_tetrahedron"],
  prism: ["prism", "triangular_prism", "rectangular_prism", "square_prism", "right_prism"],
  perpendicular_pyramid: ["perpendicular_pyramid"]
} as const

const SOLID_KINDS = Object.values(SOLID_KIND_FAMILIES).flat()

const CONSTRUCT_EQUAL_EDGE_TRIANGULAR_PRISM_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["id", "displayScale"],
  properties: {
    id: { type: "string" }, displayScale: { type: "number", exclusiveMinimum: 0 },
    vertexNames: { type: "array", items: { type: "string" } },
    label: { type: "string" }, scopeId: { type: "string" }, stateId: { type: "string" }, branchId: { type: "string" }
  }
} as const

const CONSTRUCT_CIRCUMSPHERE_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["solidId"],
  properties: { solidId: { type: "string" }, id: { type: "string" }, label: { type: "string" },
    scopeId: { type: "string" }, stateId: { type: "string" }, branchId: { type: "string" } }
} as const

const CONSTRUCT_SOLID_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: { type: "string", enum: SOLID_KINDS },
    shape: { type: "string", enum: SOLID_KINDS },
    symbol: { type: "string", enum: ["a"] },
    displayScale: { type: "number", exclusiveMinimum: 0 },
    id: { type: "string" }, output: { type: "string" }, label: { type: "string" },
    sideLength: { type: "number", exclusiveMinimum: 0 },
    baseSide: { type: "number", exclusiveMinimum: 0 },
    edgeLength: { type: "number", exclusiveMinimum: 0 },
    height: { type: "number", exclusiveMinimum: 0 },
    lateralEdge: { type: "number", exclusiveMinimum: 0 },
    ab: { type: "number", exclusiveMinimum: 0 }, ac: { type: "number", exclusiveMinimum: 0 },
    bc: { type: "number", exclusiveMinimum: 0 }, pa: { type: "number", exclusiveMinimum: 0 },
    pb: { type: "number", exclusiveMinimum: 0 }, pc: { type: "number", exclusiveMinimum: 0 },
    width: { type: "number", exclusiveMinimum: 0 }, depth: { type: "number", exclusiveMinimum: 0 },
    vertexNames: { type: "array", items: { type: "string" } },
    baseVertexNames: { type: "array", items: { type: "string" } },
    baseLabels: { type: "array", items: { type: "string" } },
    topLabels: { type: "array", items: { type: "string" } },
    apexName: { type: "string" }, footName: { type: "string" },
    scopeId: { type: "string" }, stateId: { type: "string" }, branchId: { type: "string" }
  }
} as const

const PLANAR_ENTITY_FIELDS = {
  id: { type: "string" }, output: { type: "string" }, label: { type: "string" },
  scopeId: { type: "string" }, stateId: { type: "string" }, branchId: { type: "string" }
} as const

const DECLARE_ENTITY_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["id"],
  properties: { id: { type: "string" }, kind: { type: "string" }, scopeId: { type: "string" },
    stateId: { type: "string" }, branchId: { type: "string" } }
} as const

const CONSTRUCT_CONIC_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["id", "conicType"],
  properties: { ...PLANAR_ENTITY_FIELDS, conicType: { type: "string", enum: ["ellipse", "hyperbola", "parabola"] },
    radiusX: { type: "number", exclusiveMinimum: 0 }, radiusY: { type: "number", exclusiveMinimum: 0 },
    focalParameter: { type: "number" }, axis: { type: "string", enum: ["x", "y"] },
    throughPointIds: { type: "array", items: { type: "string" } },
    vx: { type: "number" }, vy: { type: "number" }, cx: { type: "number" }, cy: { type: "number" }
  }
} as const
const CONSTRUCT_POINT_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["id"],
  properties: { ...PLANAR_ENTITY_FIELDS, x: { type: "number" }, y: { type: "number" }, z: { type: "number" },
    from: { type: "string" }, to: { type: "string" }, ratio: { type: "number" } }
} as const
const CONSTRUCT_LINE_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["id"],
  properties: { ...PLANAR_ENTITY_FIELDS, from: { type: "string" }, to: { type: "string" },
    a: { type: "number" }, b: { type: "number" }, c: { type: "number" } }
} as const
const QUERY_MEASUREMENT_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["metric"],
  properties: { metric: { type: "string", enum: ["distance", "position", "coordinates"] },
    targets: { type: "array", items: { type: "string" } }, target: { type: "string" } }
} as const
const QUERY_CONSTRAINT_STATUS_PARAMETERS = {
  type: "object", additionalProperties: false, required: ["targets"],
  properties: { kind: { type: "string", enum: ["coplanar", "fixed_distance", "collinear"] },
    targets: { type: "array", items: { type: "string" } }, expected: { type: "number", exclusiveMinimum: 0 },
    value: { type: "number", exclusiveMinimum: 0 } }
} as const

export function buildDsActionToolSchemas(options: { includeUnimplemented?: boolean } = {}) {
  const names = options.includeUnimplemented ? DS_ACTION_TOOL_NAMES : IMPLEMENTED_DS_ACTION_TOOLS
  return names.map((name) => ({
    type: "function",
    function: {
      name,
      description: DS_ACTION_DESCRIPTIONS[name],
      parameters: name === "declare_entity" ? DECLARE_ENTITY_PARAMETERS
        : name === "construct_solid" ? CONSTRUCT_SOLID_PARAMETERS
        : name === "construct_equal_edge_triangular_prism" ? CONSTRUCT_EQUAL_EDGE_TRIANGULAR_PRISM_PARAMETERS
        : name === "construct_circumsphere" ? CONSTRUCT_CIRCUMSPHERE_PARAMETERS
        : name === "construct_conic" ? CONSTRUCT_CONIC_PARAMETERS
        : name === "construct_point" ? CONSTRUCT_POINT_PARAMETERS
        : name === "construct_line" ? CONSTRUCT_LINE_PARAMETERS
        : name === "query_measurement" ? QUERY_MEASUREMENT_PARAMETERS
        : name === "query_constraint_status" ? QUERY_CONSTRAINT_STATUS_PARAMETERS : {
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

/** A dimension symbol in the problem is not an actual numeric dimension. */
function hasEqualEdgeSymbolA(text: string): boolean {
  return /\u6240\u6709\u68f1\u957f\u90fd\u4e3a\s*\$?a\b/i.test(text) ||
    /(?:edge(?:s)?\s+(?:have\s+)?length|all\s+edges).*\ba\b/i.test(text)
}

/** Constructing a right prism needs an affirmative rightness condition, not just equal edges. */
function hasRightTriangularPrismSource(text: string): boolean {
  if (/\b(?:oblique|non[- ]right|not\s+(?:a\s+)?right)\b/i.test(text) ||
      /lateral\s+edges?\s+(?:are\s+)?not\s+perpendicular/i.test(text) ||
      /(?:\u659c\u4e09\u68f1\u67f1|\u4fa7\u68f1\u4e0d\u5782\u76f4|\u4fa7\u68f1\u4e0d\u22a5)/.test(text)) return false
  return /(?:\u4fa7\u68f1\s*\u5782\u76f4\u4e8e\s*\u5e95\u9762|\u76f4\u4e09\u68f1\u67f1|\u6b63\u4e09\u68f1\u67f1)/.test(text) ||
    /\bright\s+triangular\s+prism\b/i.test(text) ||
    /lateral\s+edges?\s+(?:are\s+)?perpendicular\s+to\s+(?:the\s+|its\s+)?base/i.test(text)
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
  const unknownField = Object.keys(input).find((key) => !(key in CONSTRUCT_SOLID_PARAMETERS.properties))
  if (unknownField !== undefined) {
    return { ok: false, status: "repairable", blockerCode: "invalid_schema", repairHint: `construct_solid does not accept field "${unknownField}"` }
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

  if ((SOLID_KIND_FAMILIES.regular_pyramid as readonly string[]).includes(kind)) {
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

  if ((SOLID_KIND_FAMILIES.tetrahedron as readonly string[]).includes(kind)) {
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

  if ((SOLID_KIND_FAMILIES.prism as readonly string[]).includes(kind)) {
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

  if ((SOLID_KIND_FAMILIES.perpendicular_pyramid as readonly string[]).includes(kind)) {
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
  readonly problemText?: string
}): DsActionSession {
  const speculative = createSpeculativeCanvas(options.baseDocument, { runId: options.runId })
  const entities = new Map<string, { id: string; kind: string; scopeId: string; stateId: string }>()
  const explicitDeclarations = new Map<string, Set<string>>()
  const points2 = new Map<string, Coordinate>()
  const points3 = new Map<string, Vector3>()
  const lines2 = new Map<string, { a: Coordinate; b: Coordinate }>()
  const conics2 = new Map<string, PlanarConic>()
  const branchPoints2 = new Map<string, Map<string, Coordinate>>()
  const branchPoints3 = new Map<string, Map<string, Vector3>>()
  const branchLines2 = new Map<string, Map<string, { a: Coordinate; b: Coordinate }>>()
  const branchConics2 = new Map<string, Map<string, PlanarConic>>()
  const sharedBranchlessActions: DraftAction[] = []
  const branchActionBuckets = new Map<string, { scopeId: string; stateId?: string; branchId: string; actions: DraftAction[] }>()
  const branchCanvases = new Map<string, ReturnType<typeof createSpeculativeCanvas>>()
  let monotonicActionSeq = 0
  const getTargetCanvas = (branchId?: string) => {
    if (!branchId) return speculative
    let canvas = branchCanvases.get(branchId)
    if (!canvas) {
      canvas = createSpeculativeCanvas(
        options.baseDocument ?? createEmptyDocument(options.workspace)
      )
      for (const act of sharedBranchlessActions) {
        canvas.applyAction(act)
      }
      branchCanvases.set(branchId, canvas)
    }
    return canvas
  }
  const symbolicDisplays = new Map<string, { symbol: "a"; displayScale: number }>()
  const relations: Array<{ kind: string; targets: string[] }> = []
  const recordedSlices: DsActionStateSlice[] = []
  const sliceHistory: Array<{
    slices: DsActionStateSlice[]
    sharedActions: DraftAction[]
    branchBuckets: Array<[string, { scopeId: string; stateId?: string; branchId: string; actions: DraftAction[] }]>
  }> = [{ slices: [], sharedActions: [], branchBuckets: [] }]
  const copyBranches = <T>(source: Map<string, Map<string, T>>) =>
    new Map([...source].map(([branch, values]) => [branch, new Map(values)]))
  const snapshotRefs = () => ({
    points2: new Map(points2), points3: new Map(points3),
    lines2: new Map(lines2), conics2: new Map(conics2),
    branchPoints2: copyBranches(branchPoints2), branchPoints3: copyBranches(branchPoints3),
    branchLines2: copyBranches(branchLines2), branchConics2: copyBranches(branchConics2)
  })
  const restoreRefs = (saved: ReturnType<typeof snapshotRefs>) => {
    const restore = <T>(target: Map<string, T>, values: Map<string, T>) => {
      target.clear()
      for (const [key, value] of values) target.set(key, value)
    }
    restore(points2, saved.points2)
    restore(points3, saved.points3)
    restore(lines2, saved.lines2)
    restore(conics2, saved.conics2)
    restore(branchPoints2, saved.branchPoints2)
    restore(branchPoints3, saved.branchPoints3)
    restore(branchLines2, saved.branchLines2)
    restore(branchConics2, saved.branchConics2)
  }
  const branchHistory = new Map<string, Array<{
    stepIndex: number
    refs: ReturnType<typeof snapshotRefs>
    slices: DsActionStateSlice[]
    buckets: Array<[string, { scopeId: string; stateId?: string; branchId: string; actions: DraftAction[] }]>
  }>>()
  const restoreBranchRefs = (saved: ReturnType<typeof snapshotRefs>, branchId: string) => {
    const restore = <T>(target: Map<string, Map<string, T>>, source: Map<string, Map<string, T>>) => {
      const values = source.get(branchId)
      if (values) target.set(branchId, new Map(values))
      else target.delete(branchId)
    }
    restore(branchPoints2, saved.branchPoints2)
    restore(branchPoints3, saved.branchPoints3)
    restore(branchLines2, saved.branchLines2)
    restore(branchConics2, saved.branchConics2)
  }
  const pointHistory: Array<ReturnType<typeof snapshotRefs>> = [snapshotRefs()]

  const branchMapGet = <T>(
    sharedMap: Map<string, T>,
    branchMaps: Map<string, Map<string, T>>,
    key: string,
    branchId?: string
  ): T | undefined => (branchId ? branchMaps.get(branchId)?.get(key) : undefined) ?? sharedMap.get(key)

  const branchMapSet = <T>(
    sharedMap: Map<string, T>,
    branchMaps: Map<string, Map<string, T>>,
    key: string,
    val: T,
    branchId?: string
  ) => {
    if (!branchId) {
      sharedMap.set(key, val)
      return
    }
    let m = branchMaps.get(branchId)
    if (!m) {
      m = new Map<string, T>()
      branchMaps.set(branchId, m)
    }
    m.set(key, val)
  }

  const readP2 = (key: string, branchId?: string) => branchMapGet(points2, branchPoints2, key, branchId)
  const writeP2 = (key: string, val: Coordinate, branchId?: string) => branchMapSet(points2, branchPoints2, key, val, branchId)
  const readP3 = (key: string, branchId?: string) => branchMapGet(points3, branchPoints3, key, branchId)
  const writeP3 = (key: string, val: Vector3, branchId?: string) => branchMapSet(points3, branchPoints3, key, val, branchId)
  const readL2 = (key: string, branchId?: string) => branchMapGet(lines2, branchLines2, key, branchId)
  const writeL2 = (key: string, val: { a: Coordinate; b: Coordinate }, branchId?: string) => branchMapSet(lines2, branchLines2, key, val, branchId)
  const readC2 = (key: string, branchId?: string) => branchMapGet(conics2, branchConics2, key, branchId)
  const writeC2 = (key: string, val: PlanarConic, branchId?: string) => branchMapSet(conics2, branchConics2, key, val, branchId)

  const upsertSlice = (slice: DsActionStateSlice) => {
    const key = `${slice.scopeId}::${slice.stateId ?? ""}::${slice.branchId ?? ""}`
    const idx = recordedSlices.findIndex(
      (s) => `${s.scopeId}::${s.stateId ?? ""}::${s.branchId ?? ""}` === key
    )
    if (idx >= 0) recordedSlices[idx] = slice
    else recordedSlices.push(slice)
  }

  const failRepairable = (action: DsActionName, blockerCode: string, repairHint: string): DsActionRawResult => {
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

  const failBlocked = (action: DsActionName, blockerCode: string, repairHint: string): DsActionRawResult => {
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
    position?: Coordinate,
    sliceTarget?: { readonly scopeId: string; readonly stateId?: string; readonly branchId?: string }
  ): DsActionRawResult => {
    if (!sliceTarget?.branchId && branchActionBuckets.size > 0) {
      return failBlocked(actionName, "active_branch_dependency", "finish or repair active branches before adding shared geometry")
    }
    const canvas = getTargetCanvas(sliceTarget?.branchId)
    const before = canvas.snapshot()
    const step = canvas.applyAction(draftAction)
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
    if (sliceTarget?.branchId) {
      const bKey = `${sliceTarget.scopeId}::${sliceTarget.stateId ?? ""}::${sliceTarget.branchId}`
      let bucket = branchActionBuckets.get(bKey)
      if (!bucket) {
        bucket = {
          scopeId: sliceTarget.scopeId,
          ...(sliceTarget.stateId === undefined ? {} : { stateId: sliceTarget.stateId }),
          branchId: sliceTarget.branchId,
          actions: [...sharedBranchlessActions]
        }
        branchActionBuckets.set(bKey, bucket)
      }
      bucket.actions.push(draftAction)
      upsertSlice({
        scopeId: sliceTarget.scopeId,
        ...(sliceTarget.stateId === undefined ? {} : { stateId: sliceTarget.stateId }),
        branchId: sliceTarget.branchId,
        candidateHash: step.candidateHash,
        actions: [...bucket.actions]
      })
    } else {
      sharedBranchlessActions.push(draftAction)
      if (sliceTarget !== undefined) {
        const curSnap = canvas.snapshot()
        upsertSlice({
          scopeId: sliceTarget.scopeId,
          ...(sliceTarget.stateId === undefined ? {} : { stateId: sliceTarget.stateId }),
          candidateHash: curSnap.candidateHash,
          actions: [...curSnap.actions]
        })
      }
    }
    if (!sliceTarget?.branchId) {
      pointHistory[step.stepIndex] = snapshotRefs()
      pointHistory.length = step.stepIndex + 1
      sliceHistory[step.stepIndex] = {
        slices: [...recordedSlices],
        sharedActions: [...sharedBranchlessActions],
        branchBuckets: [...branchActionBuckets.entries()].map(([k, v]) => [k, { ...v, actions: [...v.actions] }])
      }
      sliceHistory.length = step.stepIndex + 1
    }
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

  const executeRaw = (toolName: string, rawInput: unknown): DsActionRawResult => {
      const parsed = parseDsActionToolCall(toolName, rawInput)
      const branchHint =
        rawInput && typeof rawInput === "object"
          ? (asString((rawInput as Record<string, unknown>).branchId) ?? undefined)
          : undefined
      const snap = getTargetCanvas(branchHint).snapshot()
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
      const { name } = parsed
      if (name === "construct_equal_edge_triangular_prism") {
        const supplied = parsed.input
        if (Object.keys(supplied).some((key) => !(key in CONSTRUCT_EQUAL_EDGE_TRIANGULAR_PRISM_PARAMETERS.properties))) {
          return failBlocked(name, "invalid_schema", "symbolic prism accepts only its published fields")
        }
        if (!asString(supplied.id) || asPositiveNumber(supplied.displayScale) === null) {
          return failRepairable(name, "missing_required_parameter", "symbolic prism requires id and positive displayScale")
        }
      }
      const input = name === "construct_equal_edge_triangular_prism"
        ? { ...parsed.input, kind: "triangular_prism", symbol: "a" }
        : parsed.input
      const stepSeq = ++monotonicActionSeq

      if (name === "declare_entity") {
        if (Object.keys(input).some(key => !Object.hasOwn(DECLARE_ENTITY_PARAMETERS.properties, key)) ||
          ["kind", "scopeId", "stateId", "branchId"].some(key => input[key] !== undefined && !asString(input[key]))) {
          return failRepairable(name, "invalid_schema", "declare_entity only names an entity; use construct_point or another construction action to draw geometry")
        }
        const id = asString(input.id)
        if (!id) return failRepairable(name, "missing_required_parameter", "declare_entity requires non-empty id")
        entities.set(id, {
          id,
          kind: asString(input.kind) ?? "point",
          scopeId: asString(input.scopeId) ?? "shared",
          stateId: asString(input.stateId) ?? "shared"
        })
        const declarationBranch = asString(input.branchId) ?? ""
        let branchDeclarations = explicitDeclarations.get(declarationBranch)
        if (!branchDeclarations) {
          branchDeclarations = new Set<string>()
          explicitDeclarations.set(declarationBranch, branchDeclarations)
        }
        branchDeclarations.add(id)
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

      if (name === "query_measurement") {
        const metric = asString(input.metric)
        if (!metric) {
          return failRepairable(name, "missing_required_parameter", "query_measurement requires metric (distance | position)")
        }
        if (metric === "distance") {
          const targets = asStringList(input.targets)
          if (!targets || targets.length !== 2) {
            return failRepairable(name, "missing_required_parameter", "distance query requires exactly two named targets")
          }
          const [tA, tB] = [targets[0]!, targets[1]!]
          const p3A = readP3(tA, branchHint)
          const p3B = readP3(tB, branchHint)
          if (p3A && p3B) {
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: {
                metric: "distance",
                value: distanceVector3(p3A, p3B),
                sourceEntityIds: [tA, tB]
              }
            }
          }
          const p2A = readP2(tA, branchHint)
          const p2B = readP2(tB, branchHint)
          if (p2A && p2B) {
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: {
                metric: "distance",
                value: Math.hypot(p2B.x - p2A.x, p2B.y - p2A.y),
                sourceEntityIds: [tA, tB]
              }
            }
          }
          return failRepairable(name, "undeclared_entity_ref", `point(s) not currently materialized: ${targets.join(", ")}`)
        }
        if (metric === "position" || metric === "coordinates") {
          const target = asString(input.target) ?? asStringList(input.targets)?.[0] ?? null
          if (!target) {
            return failRepairable(name, "missing_required_parameter", "position query requires target entity name")
          }
          const p3 = readP3(target, branchHint)
          if (p3) {
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              entity: target,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { metric: "position", value: p3, sourceEntityIds: [target] }
            }
          }
          const p2 = readP2(target, branchHint)
          if (p2) {
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              entity: target,
              position: p2,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { metric: "position", value: p2, sourceEntityIds: [target] }
            }
          }
          return failRepairable(name, "undeclared_entity_ref", `point "${target}" is not currently materialized`)
        }
        return failBlocked(name, "unsupported_observation", `measurement metric "${metric}" is not supported`)
      }

      if (name === "query_constraint_status") {
        const kind = asString(input.kind) ?? "coplanar"
        const targets = asStringList(input.targets)
        if (!targets || targets.length === 0) {
          return failRepairable(name, "missing_required_parameter", "query_constraint_status requires targets")
        }
        if (kind === "coplanar") {
          if (targets.length < 3) {
            return failRepairable(name, "missing_required_parameter", "coplanar check requires at least 3 targets")
          }
          const pts: Vector3[] = []
          for (const t of targets) {
            const pt = readP3(t, branchHint)
            if (!pt) return failRepairable(name, "undeclared_entity_ref", `undeclared 3D point "${t}"`)
            pts.push(pt)
          }
          if (pts.length === 3) {
            const plane = planeFromPoints(pts[0]!, pts[1]!, pts[2]!)
            const status = plane ? "satisfied" : "violated"
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              constraintStatus: status,
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { kind, residual: plane ? 0 : Number.POSITIVE_INFINITY, sourceEntityIds: targets }
            }
          }
          const solved = solveConstraint3d({ kind: "coplanar", points: pts })
          return {
            ok: true,
            status: "accepted",
            action: name,
            stateChanged: false,
            constraintStatus: solved.constraintStatus,
            candidateHash: snap.candidateHash,
            stepIndex: snap.stepIndex,
            primitiveCount: snap.primitiveCount,
            measurement: { kind, residual: solved.residuals.coplanar ?? Number.POSITIVE_INFINITY, sourceEntityIds: targets }
          }
        }
        if (kind === "fixed_distance") {
          const expected = asPositiveNumber(input.expected ?? input.value)
          if (targets.length !== 2 || expected === null) {
            return failRepairable(name, "missing_required_parameter", "fixed_distance check requires 2 targets and positive expected length")
          }
          const pA = readP3(targets[0]!, branchHint)
          const pB = readP3(targets[1]!, branchHint)
          if (pA && pB) {
            const actual = distanceVector3(pA, pB)
            const residual = Math.abs(actual - expected)
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              constraintStatus: residual <= 1e-6 ? "satisfied" : "violated",
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { kind, expected, actual, residual, sourceEntityIds: targets }
            }
          }
          const d2A = readP2(targets[0]!, branchHint)
          const d2B = readP2(targets[1]!, branchHint)
          if (d2A && d2B) {
            const actual = Math.hypot(d2B.x - d2A.x, d2B.y - d2A.y)
            const residual = Math.abs(actual - expected)
            return {
              ok: true,
              status: "accepted",
              action: name,
              stateChanged: false,
              constraintStatus: residual <= 1e-6 ? "satisfied" : "violated",
              candidateHash: snap.candidateHash,
              stepIndex: snap.stepIndex,
              primitiveCount: snap.primitiveCount,
              measurement: { kind, expected, actual, residual, sourceEntityIds: targets }
            }
          }
          return failRepairable(name, "undeclared_entity_ref", `point(s) not materialized: ${targets.join(", ")}`)
        }
        if (kind === "collinear" && targets.length === 3) {
          const pts = targets.map((t) => readP2(t, branchHint))
          if (pts.some((p) => !p)) return failRepairable(name, "undeclared_entity_ref", "collinear check requires materialized 2D points")
          const res = solveConstraint2d({ kind: "collinear", points: [pts[0]!, pts[1]!, pts[2]!] })
          return {
            ok: true,
            status: "accepted",
            action: name,
            stateChanged: false,
            constraintStatus: res.constraintStatus,
            candidateHash: snap.candidateHash,
            stepIndex: snap.stepIndex,
            primitiveCount: snap.primitiveCount,
            measurement: { kind, residual: res.residual, sourceEntityIds: targets }
          }
        }
        return failBlocked(name, "unsupported_observation", `constraint query kind "${kind}" is not supported`)
      }

      if (name === "repair_entity" || name === "repair_constraint") {
        const branchId = asString(input.branchId)
        if (branchId) {
          const history = branchHistory.get(branchId)
          const previous = history?.pop()
          if (!previous) return failRepairable(name, "no_branch_step", "no materialized step exists in this branch")
          const rolled = getTargetCanvas(branchId).revertToStep(previous.stepIndex)
          restoreBranchRefs(previous.refs, branchId)
          for (let i = recordedSlices.length - 1; i >= 0; i -= 1) {
            if (recordedSlices[i]?.branchId === branchId) recordedSlices.splice(i, 1)
          }
          recordedSlices.push(...previous.slices)
          for (const key of branchActionBuckets.keys()) {
            if (key.endsWith(`::${branchId}`)) branchActionBuckets.delete(key)
          }
          for (const [key, bucket] of previous.buckets) branchActionBuckets.set(key, bucket)
          if (history?.length === 0) branchCanvases.delete(branchId)
          return { ok: true, status: "accepted", action: name, stateChanged: true,
            candidateHash: rolled.candidateHash, stepIndex: rolled.stepIndex, primitiveCount: rolled.primitiveCount }
        }
        if ([...branchHistory.values()].some((history) => history.length > 0)) {
          return failBlocked(name, "active_branch_dependency", "repair a branch first; shared rollback with active branches is unsafe")
        }
        const rolled = speculative.rollback(1)
        const idx = Math.min(rolled.stepIndex, pointHistory.length - 1)
        const snapshotPts = pointHistory[idx] ?? pointHistory[0]!
        pointHistory.length = Math.max(1, rolled.stepIndex + 1)
        restoreRefs(snapshotPts)
        const snapSliceState = sliceHistory[Math.min(rolled.stepIndex, sliceHistory.length - 1)]
        sliceHistory.length = Math.max(1, rolled.stepIndex + 1)
        recordedSlices.splice(0, recordedSlices.length, ...(snapSliceState?.slices ?? []))
        sharedBranchlessActions.splice(0, sharedBranchlessActions.length, ...(snapSliceState?.sharedActions ?? []))
        branchActionBuckets.clear()
        branchCanvases.clear()
        for (const [bk, bv] of snapSliceState?.branchBuckets ?? []) {
          branchActionBuckets.set(bk, { ...bv, actions: [...bv.actions] })
        }
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
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const stateId = explicitStateId ?? "shared"
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const fromId = asString(input.from)
        const toId = asString(input.to)
        const ratio = asFiniteNumber(input.ratio)

        if (fromId && toId && ratio !== null) {
          const p3A = readP3(fromId, branchId)
          const p3B = readP3(toId, branchId)
          if (p3A && p3B) {
            const solved = solveConstraint3d({ kind: "interior_ratio", targetKind: "edge", anchors: [p3A, p3B], ratio, resultName: id })
            const pos3 = solved.status === "solved" ? solved.pointRegistry[id] : undefined
            if (!pos3) return failRepairable(name, "invalid_ratio", solved.reason ?? "ratio must fall in [0, 1]")
            writeP3(id, pos3, branchId)
            writeP3(label, pos3, branchId)
            entities.set(id, { id, kind: "point", scopeId, stateId })
            return stageDraftAction(
              name,
              { actionId: "solid.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, position: pos3 } } as DraftAction,
              id,
              undefined,
              sliceTarget
            )
          }
          const p2A = readP2(fromId, branchId)
          const p2B = readP2(toId, branchId)
          if (p2A && p2B) {
            const solved2 = solveConstraint2d({ kind: "segment_ratio", a: p2A, b: p2B, ratio, splitBetween: true })
            const pos2 = solved2.status === "solved" ? solved2.roots[0]?.point : undefined
            if (!pos2) return failRepairable(name, "invalid_ratio", solved2.reason ?? "ratio out of range")
            writeP2(id, pos2, branchId)
            writeP2(label, pos2, branchId)
            entities.set(id, { id, kind: "point", scopeId, stateId })
            return stageDraftAction(
              name,
              { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, points: [pos2] } },
              id,
              pos2,
              sliceTarget
            )
          }
          return failRepairable(name, "undeclared_entity_ref", `missing endpoint(s) "${fromId}", "${toId}"`)
        }

        const x = asFiniteNumber(input.x)
        const y = asFiniteNumber(input.y)
        const z = asFiniteNumber(input.z)
        if (options.workspace === "geometry3d" || z !== null) {
          if (x === null || y === null || z === null) {
            return failRepairable(name, "missing_required_parameter", "3D construct_point requires finite x, y, z or edge ratio (from, to, ratio)")
          }
          const pos3: Vector3 = { x, y, z }
          writeP3(id, pos3, branchId)
          writeP3(label, pos3, branchId)
          entities.set(id, { id, kind: "point", scopeId, stateId })
          return stageDraftAction(
            name,
            { actionId: "solid.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, position: pos3 } } as DraftAction,
            id,
            undefined,
            sliceTarget
          )
        }
        if (x === null || y === null) {
          return failRepairable(name, "missing_required_parameter", "construct_point requires finite x and y coordinates")
        }
        const pt = { x, y }
        writeP2(id, pt, branchId)
        writeP2(label, pt, branchId)
        entities.set(id, { id, kind: "point", scopeId, stateId })
        return stageDraftAction(
          name,
          { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, points: [pt] } },
          id,
          pt,
          sliceTarget
        )
      }

      if (name === "construct_segment" || name === "construct_line") {
        const id = asString(input.id ?? input.output) ?? `L${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const fromId = asString(input.from)
        const toId = asString(input.to)
        const hasEquation = name === "construct_line" && ["a", "b", "c"].some((key) => Object.hasOwn(input, key))
        if (hasEquation) {
          if (Object.hasOwn(input, "from") || Object.hasOwn(input, "to")) {
            return failRepairable(name, "ambiguous_geometry_input", "use from/to or a,b,c, never both")
          }
          const a = asFiniteNumber(input.a)
          const b = asFiniteNumber(input.b)
          const c = asFiniteNumber(input.c)
          if (a === null || b === null || c === null) {
            return failRepairable(name, "missing_required_parameter", "line equation requires finite numeric a,b,c")
          }
          if (a === 0 && b === 0) return failRepairable(name, "degenerate_line", "a and b cannot both be zero")
          const endpoints: [Coordinate, Coordinate] = Math.abs(b) >= Math.abs(a)
            ? [{ x: 0, y: -c / b }, { x: 1, y: -(a + c) / b }]
            : [{ x: -c / a, y: 0 }, { x: -(b + c) / a, y: 1 }]
          if (endpoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ||
              Math.hypot(endpoints[0].x - endpoints[1].x, endpoints[0].y - endpoints[1].y) < 1e-9) {
            return failRepairable(name, "degenerate_line", "equation cannot produce two distinct finite points")
          }
          const staged = stageDraftAction(
            name,
            { actionId: "planar.create_line", actionKey: `ds-act-${stepSeq}`, factIds: [],
              inputs: { alias: id, label, points: endpoints } },
            id, undefined, sliceTarget
          )
          if (staged.ok) {
            writeL2(id, { a: endpoints[0], b: endpoints[1] }, branchId)
            writeL2(label, { a: endpoints[0], b: endpoints[1] }, branchId)
          }
          return staged
        }
        if (name === "construct_line" && (!fromId || !toId)) {
          return failRepairable(name, "missing_required_parameter", "construct_line requires both from/to or finite a,b,c")
        }
        const p3A = fromId ? readP3(fromId, branchId) : undefined
        const p3B = toId ? readP3(toId, branchId) : undefined
        if (p3A && p3B && fromId && toId) {
          return stageDraftAction(
            name,
            { actionId: "solid.create_segment", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, vertexNames: [fromId, toId] } } as DraftAction,
            id,
            undefined,
            sliceTarget
          )
        }
        const p1 = fromId ? readP2(fromId, branchId) : undefined
        const p2 = toId ? readP2(toId, branchId) : undefined
        if (!p1 || !p2) {
          return failRepairable(name, "undeclared_entity_ref", `construct points before referencing "${fromId ?? "?"}" and "${toId ?? "?"}"`)
        }
        writeL2(id, { a: p1, b: p2 }, branchId)
        writeL2(label, { a: p1, b: p2 }, branchId)
        return stageDraftAction(
          name,
          {
            actionId: name === "construct_segment" ? "planar.create_segment" : "planar.create_line",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: { alias: id, label, points: [p1, p2] }
          },
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "construct_intersection") {
        const outId = asString(input.output ?? input.id) ?? `X${stepSeq}`
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const lA = asString(input.lineA) ? readL2(String(input.lineA), branchId) : undefined
        const lB = asString(input.lineB) ? readL2(String(input.lineB), branchId) : undefined
        const conicId = asString(input.conicId)
        const conic = conicId ? readC2(conicId, branchId) : undefined
        if (lA && conic) {
          const res = intersectPlanarLineAndConicExact({ type: "line", a: lA.a, b: lA.b }, conic)
          const pt = res.points[0]
          if (!pt) return failRepairable(name, "no_intersection", "line does not intersect conic")
          writeP2(outId, pt, branchId)
          return stageDraftAction(
            name,
            { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: outId, label: outId, points: [pt] } },
            outId,
            pt,
            sliceTarget
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
        writeP2(outId, pt, branchId)
        return stageDraftAction(
          name,
          { actionId: "planar.create_point", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: outId, label: outId, points: [pt] } },
          outId,
          pt,
          sliceTarget
        )
      }

      if (name === "construct_circle") {
        const id = asString(input.id ?? input.output) ?? `C${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const cx = asFiniteNumber(input.cx) ?? 0
        const cy = asFiniteNumber(input.cy) ?? 0
        const r = asFiniteNumber(input.radius)
        if (r === null || !(r > 0)) {
          return failRepairable(name, "missing_required_parameter", "construct_circle requires positive radius")
        }
        const circ: PlanarConic = { id, type: "circle", center: { x: cx, y: cy }, radius: r }
        writeC2(id, circ, branchId)
        return stageDraftAction(
          name,
          { actionId: "planar.create_circle", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, center: { x: cx, y: cy }, radius: r } },
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "construct_conic") {
        const id = asString(input.id ?? input.output) ?? `C${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const rawType = asString(input.conicType)?.toLowerCase()
        if (!rawType) return failRepairable(name, "missing_required_parameter", "construct_conic requires conicType (ellipse | hyperbola | parabola)")
        if (rawType !== "ellipse" && rawType !== "hyperbola" && rawType !== "parabola") {
          return failRepairable(name, "unsupported_conic_kind", "construct_conic supports only ellipse, hyperbola, or parabola")
        }
        if (input.axis !== undefined && input.axis !== "x" && input.axis !== "y") {
          return failRepairable(name, "invalid_axis", "axis must be x or y")
        }
        for (const field of ["cx", "cy", "vx", "vy"] as const) {
          if (input[field] !== undefined && asFiniteNumber(input[field]) === null) {
            return failRepairable(name, "invalid_center", `${field} must be a finite number`)
          }
        }
        const incompatible = rawType === "parabola"
          ? ["radiusX", "radiusY", "throughPointIds"].some((field) => input[field] !== undefined)
          : ["vx", "vy", "focalParameter", ...(rawType === "ellipse" ? ["axis"] : [])].some((field) => input[field] !== undefined)
        if (incompatible) return failRepairable(name, "incompatible_conic_fields", "the selected conic kind cannot use these geometry fields")
        if (rawType === "parabola") {
          const focalParameter = asFiniteNumber(input.focalParameter)
          const axis = input.axis === "x" ? "x" : "y"
          const vx = asFiniteNumber(input.vx ?? input.cx) ?? 0
          const vy = asFiniteNumber(input.vy ?? input.cy) ?? 0
          if (focalParameter === null || Math.abs(focalParameter) <= 1e-9) {
            return failRepairable(name, "missing_required_parameter", "parabola requires non-zero focalParameter")
          }
          const conic: PlanarConic = { id, type: "parabola", vertex: { x: vx, y: vy }, axis, focalParameter }
          writeC2(id, conic, branchId)
          return stageDraftAction(
            name,
            { actionId: "planar.create_conic", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, kind: "parabola", vertex: { x: vx, y: vy }, axis, focalParameter } },
            id,
            undefined,
            sliceTarget
          )
        }
        const center = { x: asFiniteNumber(input.cx) ?? 0, y: asFiniteNumber(input.cy) ?? 0 }
        const kind = rawType === "hyperbola" ? "hyperbola" : "ellipse"
        let rx = asFiniteNumber(input.radiusX)
        let ry = asFiniteNumber(input.radiusY)
        let axis: "x" | "y" = input.axis === "y" ? "y" : "x"
        if (input.throughPointIds !== undefined) {
          if (input.radiusX !== undefined || input.radiusY !== undefined) {
            return failRepairable(name, "ambiguous_geometry_input", "use throughPointIds or semi-axes, never both")
          }
          const ids = asStringList(input.throughPointIds)
          if (!ids || ids.length !== 2 || ids[0] === ids[1]) {
            return failRepairable(name, "conic_fit_unsatisfied", "throughPointIds requires two distinct existing points")
          }
          const first = readP2(ids[0]!, branchId)
          const second = readP2(ids[1]!, branchId)
          if (!first || !second) {
            return failRepairable(name, "undeclared_entity_ref", "construct both throughPointIds before fitting the conic")
          }
          const fit = fitOriginConicThroughPoints(
            [{ x: first.x - center.x, y: first.y - center.y }, { x: second.x - center.x, y: second.y - center.y }],
            kind === "hyperbola" && input.axis !== undefined ? axis : undefined, kind
          )
          if (!fit) return failRepairable(name, "conic_fit_unsatisfied", "points do not uniquely determine the requested centered conic")
          rx = fit.radiusX
          ry = fit.radiusY
          if (fit.kind === "hyperbola") axis = fit.axis
        }
        if (rx === null || ry === null || !(rx > 0 && ry > 0)) {
          return failRepairable(name, "missing_required_parameter", "construct_conic requires positive radiusX/radiusY or two materialized throughPointIds")
        }
        const conic: PlanarConic =
          kind === "ellipse"
            ? { id, type: "ellipse", center, radiusX: rx, radiusY: ry }
            : { id, type: "hyperbola", center, axis, radiusX: rx, radiusY: ry }
        writeC2(id, conic, branchId)
        return stageDraftAction(
          name,
          { actionId: "planar.create_conic", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, kind, center, radiusX: rx, radiusY: ry,
            ...(kind === "hyperbola" ? { axis } : {}) } },
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "construct_tangent") {
        const id = asString(input.id ?? input.output) ?? `T${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const conicId = asString(input.conicId)
        const ptId = asString(input.pointId)
        const conic = conicId ? readC2(conicId, branchId) : undefined
        const pt = ptId ? readP2(ptId, branchId) : undefined
        if (!conic || !pt) return failRepairable(name, "undeclared_entity_ref", "construct_tangent requires valid conicId and pointId")
        const tan = tangentLineToConicAt(conic, pt, 5)
        if (!tan) return failRepairable(name, "not_on_conic", "point does not lie on conic")
        writeL2(id, { a: tan.line.a, b: tan.line.b }, branchId)
        return stageDraftAction(
          name,
          { actionId: "planar.create_line", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, points: [tan.line.a, tan.line.b] } },
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "construct_perpendicular" || name === "construct_parallel") {
        const id = asString(input.id ?? input.output) ?? `L${stepSeq}`
        const label = asString(input.label) ?? id
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const lineId = asString(input.lineId)
        const ptId = asString(input.throughPointId)
        const ref = lineId ? readL2(lineId, branchId) : undefined
        const pt = ptId ? readP2(ptId, branchId) : undefined
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
        writeL2(id, { a: endpoints[0], b: endpoints[1] }, branchId)
        return stageDraftAction(
          name,
          { actionId: "planar.create_line", actionKey: `ds-act-${stepSeq}`, factIds: [], inputs: { alias: id, label, points: endpoints } },
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "finish_candidate") {
        const primaryActions = snap.actions.length > 0 ? snap.actions : recordedSlices[0]?.actions ?? []
        if (primaryActions.length === 0) {
          return failRepairable(name, "empty_candidate", "stage at least one geometric action before finish_candidate")
        }
        const plan: PlanEnvelope = {
          schemaVersion: PLAN_SCHEMA_VERSION,
          kind: "plan",
          goal: asString(input.goal) ?? "DS 动作级构图候选",
          factIds: [],
          actions: [...primaryActions],
          ...(symbolicDisplays.size === 0 ? {} : {
            assumptions: primaryActions.flatMap((action) => {
              const display = symbolicDisplays.get(action.actionKey)
              return display === undefined ? [] : [
                `${display.symbol} > 0; display ${display.displayScale} is a drawing scale only, not a value inferred for ${display.symbol}`
              ]
            })
          })
        }
        return {
          ok: true,
          status: "accepted",
          action: name,
          stateChanged: false,
          candidateHash: snap.candidateHash,
          stepIndex: snap.stepIndex,
          primitiveCount: snap.primitiveCount,
          terminated: {
            plan,
            ...(recordedSlices.length > 0 ? { slices: [...recordedSlices] } : {})
          }
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

      if (name === "construct_solid" || name === "construct_equal_edge_triangular_prism") {
        const symbol = asString(input.symbol)
        const text = options.problemText ?? ""
        if (symbol === null && input.displayScale === undefined && asString(input.kind ?? input.shape) === "triangular_prism" && hasEqualEdgeSymbolA(text)) {
          return failBlocked(name, "symbol_source_required", "this prompt gives a symbolic edge length; provide symbol and displayScale instead of invented dimensions")
        }
        let normalizedInput: Record<string, unknown> = input
        if (symbol !== null || input.displayScale !== undefined) {
          const positiveSource = /\ba\s*>\s*0\b/i.test(text) || hasEqualEdgeSymbolA(text)
          const equalEdgeSource = hasEqualEdgeSymbolA(text)
          if (symbol !== "a" || !positiveSource || !equalEdgeSource) {
            return failBlocked(name, "symbol_source_missing", "symbolic display needs a confirmed source with positive edge parameter a")
          }
          if (!hasRightTriangularPrismSource(text)) {
            return failBlocked(name, "symbolic_prism_shape_mismatch", "a right triangular prism requires an affirmative rightness condition in the prompt")
          }
          const scale = asPositiveNumber(input.displayScale)
          if (scale === null || !Number.isFinite(scale) || scale > 1e6 || input.height !== undefined || input.sideLength !== undefined || input.ab !== undefined || input.ac !== undefined || input.bc !== undefined) {
            return failBlocked(name, "invalid_symbolic_scale", "provide a finite positive displayScale only; no contradictory numeric dimensions")
          }
          if (asString(input.kind ?? input.shape) !== "triangular_prism") {
            return failBlocked(name, "unsupported_symbolic_kind", "symbolic equal-edge display currently supports triangular_prism")
          }
          normalizedInput = { ...input, sideLength: scale, height: scale }
        }
        const resolved = resolveConstructSolidRequest(normalizedInput, points3)
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
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = {
          scopeId,
          ...(explicitStateId === undefined ? {} : { stateId: explicitStateId }),
          ...(branchId === undefined ? {} : { branchId })
        }
        const staged = stageDraftAction(
          name,
          resolved.request.kind === "prism"
            ? {
                actionId: "solid.create_prism",
                actionKey: `ds-act-${stepSeq}`,
                factIds: [],
                inputs: {
                  alias: id, label,
                  basePolygon: resolved.request.baseVertices.map((v) => v.point),
                  vector: {
                    x: solved.pointRegistry[resolved.request.topLabels[0]!]!.x - resolved.request.baseVertices[0]!.point.x,
                    y: solved.pointRegistry[resolved.request.topLabels[0]!]!.y - resolved.request.baseVertices[0]!.point.y,
                    z: solved.pointRegistry[resolved.request.topLabels[0]!]!.z - resolved.request.baseVertices[0]!.point.z
                  },
                  vertexNames: [...resolved.request.baseVertices.map((v) => v.name), ...resolved.request.topLabels]
                }
              } as DraftAction
            : {
                actionId: "solid.create_polyhedron",
                actionKey: `ds-act-${stepSeq}`,
                factIds: [],
                inputs: { alias: id, label, vertices, vertexNames, faces }
              } as DraftAction,
          id,
          undefined,
          sliceTarget
        )
        if (staged.ok && symbol === "a") symbolicDisplays.set(`ds-act-${stepSeq}`, { symbol: "a", displayScale: Number(input.displayScale) })
        if (!staged.ok) {
          const rollbackSnap = pointHistory[Math.min(snap.stepIndex, pointHistory.length - 1)]!
          points3.clear()
          for (const [k, v] of rollbackSnap.points3) points3.set(k, v)
        } else if (!branchId && !explicitStateId) {
          const curSnap = speculative.snapshot()
          upsertSlice({
            scopeId,
            candidateHash: curSnap.candidateHash,
            actions: [...curSnap.actions]
          })
        }
        return staged
      }

      if (name === "construct_circumsphere") {
        if (options.workspace !== "geometry3d") return failBlocked(name, "workspace_mismatch", "circumsphere requires geometry3d")
        const unknownField = Object.keys(input).find((field) => !(field in CONSTRUCT_CIRCUMSPHERE_PARAMETERS.properties))
        if (unknownField) return failBlocked(name, "invalid_schema", "circumsphere accepts only solidId, id, label and slice identifiers")
        const solidId = asString(input.solidId)
        if (!solidId) return failRepairable(name, "missing_required_parameter", "circumsphere requires a named solidId")
        const scopeId = asString(input.scopeId) ?? "shared"
        const stateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const canvas = getTargetCanvas(branchId)
        const hostExists = canvas.snapshot().actions.some((action) =>
          (action.actionId === "solid.create_polyhedron" || action.actionId === "solid.create_prism") && action.inputs.alias === solidId
        )
        if (!hostExists) return failBlocked(name, "missing_host", "circumsphere host must be an existing staged polyhedron")
        const id = asString(input.id) ?? `SPHERE_${stepSeq}`
        const label = asString(input.label) ?? id
        return stageDraftAction(name, {
          actionId: "derived.create_circumsphere", actionKey: `ds-act-${stepSeq}`, factIds: [],
          inputs: { alias: id, label, solidId: { scope: "draft", alias: solidId } }
        } as unknown as DraftAction, id, undefined, { scopeId,
          ...(stateId === undefined ? {} : { stateId }), ...(branchId === undefined ? {} : { branchId }) })
      }

      if (name === "construct_base") {
        const shape = asString(input.shape ?? input.kind)?.toLowerCase() ?? "rectangle"
        const mappedKind = shape === "triangle" ? "triangular_prism" : shape
        const scopeId = asString(input.scopeId) ?? "shared"
        const stateId = asString(input.stateId) ?? "before_fold"
        const branchId = asString(input.branchId) ?? undefined
        const base = resolveBasePolygonFromParams(mappedKind, input, points3)
        if (!base.ok) {
          return base.status === "blocked"
            ? failBlocked(name, base.blockerCode, base.repairHint)
            : failRepairable(name, base.blockerCode, base.repairHint)
        }
        const rawNames = asStringList(input.vertexNames)
        const baseVertices = rawNames && rawNames.length === base.baseVertices.length
          ? base.baseVertices.map((bv, idx) => ({ name: rawNames[idx]!, point: bv.point }))
          : base.baseVertices
        const id = asString(input.id ?? input.output) ?? `BASE_${stepSeq}`
        const label = asString(input.label) ?? id
        for (const bv of baseVertices) {
          writeP3(bv.name, bv.point, branchId)
          writeP2(bv.name, { x: bv.point.x, y: bv.point.y }, branchId)
        }
        const staged = stageDraftAction(
          name,
          {
            actionId: "solid.create_face",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: {
              alias: id,
              label,
              vertices: baseVertices.map((bv) => bv.point),
              vertexNames: baseVertices.map((bv) => bv.name)
            }
          } as DraftAction,
          id,
          undefined,
          { scopeId, stateId, ...(branchId === undefined ? {} : { branchId }) }
        )
        if (!staged.ok) {
          const rollbackSnap = pointHistory[Math.min(snap.stepIndex, pointHistory.length - 1)]!
          points3.clear()
          for (const [k, v] of rollbackSnap.points3) points3.set(k, v)
          points2.clear()
          for (const [k, v] of rollbackSnap.points2) points2.set(k, v)
        }
        return staged
      }

      if (name === "construct_face") {
        const vertexNames = asStringList(input.vertexNames ?? input.pointIds)
        if (!vertexNames || vertexNames.length < 3) {
          return failRepairable(name, "missing_required_parameter", "construct_face requires vertexNames with at least 3 distinct names")
        }
        if (new Set(vertexNames).size !== vertexNames.length) {
          return failRepairable(name, "duplicate_vertex_name", "construct_face vertexNames must be distinct")
        }
        const scopeId = asString(input.scopeId) ?? "shared"
        const explicitStateId = asString(input.stateId) ?? undefined
        const branchId = asString(input.branchId) ?? undefined
        const sliceTarget = explicitStateId || branchId ? { scopeId, ...(explicitStateId ? { stateId: explicitStateId } : {}), ...(branchId ? { branchId } : {}) } : undefined
        const verts: Vector3[] = []
        for (const vn of vertexNames) {
          const pt = readP3(vn, branchId)
          if (!pt) return failRepairable(name, "undeclared_entity_ref", `undeclared 3D vertex "${vn}"`)
          verts.push(pt)
        }
        const basePlane = planeFromPoints(verts[0]!, verts[1]!, verts[2]!)
        if (!basePlane) {
          return failBlocked(name, "degenerate_face", "face vertices cannot be collinear")
        }
        if (verts.length >= 4) {
          const coplanar = solveConstraint3d({ kind: "coplanar", points: verts })
          if (coplanar.constraintStatus !== "satisfied") {
            return failBlocked(name, "non_coplanar_face", "face vertices must be coplanar")
          }
        }
        const id = asString(input.id ?? input.output) ?? `FACE_${stepSeq}`
        const label = asString(input.label) ?? id
        return stageDraftAction(
          name,
          {
            actionId: "solid.create_face",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: { alias: id, label, vertices: verts, vertexNames }
          } as DraftAction,
          id,
          undefined,
          sliceTarget
        )
      }

      if (name === "construct_fold_state") {
        const vertexNames = asStringList(input.vertexNames)
        const hingeRaw = input.hinge as { from?: unknown; to?: unknown } | undefined
        const hFrom = hingeRaw ? asString(hingeRaw.from) : null
        const hTo = hingeRaw ? asString(hingeRaw.to) : null
        const apex = asString(input.apex)
        const apexAs = asString(input.apexAs)
        const angle = asFiniteNumber(input.angle)
        if (!vertexNames || vertexNames.length < 3 || !hFrom || !hTo || !apex || !apexAs || angle === null) {
          return failRepairable(name, "missing_required_parameter", "construct_fold_state requires vertexNames (>=3), hinge {from, to}, apex, apexAs, and numeric angle")
        }
        if (Math.abs(angle % 360) <= 1e-6 || apex === apexAs) {
          return failBlocked(name, "degenerate_fold", "fold angle must be non-zero mod 360 and apexAs must differ from apex")
        }
        const verts: Vector3[] = []
        for (const vn of vertexNames) {
          const pt = points3.get(vn)
          if (!pt) return failRepairable(name, "undeclared_entity_ref", `undeclared 3D fold vertex "${vn}"`)
          verts.push(pt)
        }
        const pFrom = points3.get(hFrom)
        const pTo = points3.get(hTo)
        const pApex = points3.get(apex)
        if (!pFrom || !pTo || !pApex || !planeFromPoints(pFrom, pTo, pApex)) {
          return failBlocked(name, "degenerate_fold", "hinge endpoints and apex must be materialized and non-collinear")
        }

        const preSnap = speculative.snapshot()
        const scopeId = asString(input.scopeId) ?? "shared"
        const preStateId = asString(input.preStateId) ?? "before_fold"
        if (preSnap.actions.length > 0) {
          upsertSlice({ scopeId, stateId: preStateId, candidateHash: preSnap.candidateHash, actions: preSnap.actions })
        }

        const rotated = foldPointAboutHinge(pApex, pFrom, pTo, angle)
        if (distanceVector3(rotated, pApex) <= 1e-6) {
          return failBlocked(name, "degenerate_fold", "fold produced zero displacement from pre-fold position")
        }
        points3.set(apexAs, rotated)

        const id = asString(input.id ?? input.output) ?? `FOLD_${stepSeq}`
        const staged = stageDraftAction(
          name,
          {
            actionId: "solid.fold",
            actionKey: `ds-act-${stepSeq}`,
            factIds: [],
            inputs: {
              alias: id,
              label: asString(input.label) ?? id,
              vertices: verts,
              vertexNames,
              hinge: { from: hFrom, to: hTo },
              apex,
              apexAs,
              angle
            }
          } as DraftAction,
          id
        )
        if (!staged.ok) {
          const rollbackSnap = pointHistory[Math.min(snap.stepIndex, pointHistory.length - 1)]!
          points3.clear()
          for (const [k, v] of rollbackSnap.points3) points3.set(k, v)
          return staged
        }
        if (staged.candidateHash === preSnap.candidateHash) {
          return failBlocked(name, "duplicate_lineage_hash", "post_fold candidateHash matched pre_fold candidateHash")
        }
        const postSnap = speculative.snapshot()
        const postStateId = asString(input.stateId) ?? "after_fold"
        const branchId = asString(input.branchId) ?? undefined
        upsertSlice({
          scopeId,
          stateId: postStateId,
          ...(branchId === undefined ? {} : { branchId }),
          candidateHash: postSnap.candidateHash,
          actions: postSnap.actions
        })
        return staged
      }

      return failBlocked(name, "unsupported_action", `${name} kernel execution is not implemented yet`)
  }

  const attachTelemetry = (res: DsActionRawResult): DsActionExecutionResult => ({
    ...res,
    toolName: res.action,
    progressSignature: `${res.action}:${res.status}:${res.blockerCode ?? "none"}:${res.candidateHash}:${res.stepIndex}:${res.primitiveCount}`
  })

  const referenceDirectory = (branchId?: string): DsActionReferenceDirectory => {
    const actions = getTargetCanvas(branchId).snapshot().actions
    const points = new Set<string>()
    const lines = new Set<string>()
    const conics = new Set<string>()
    const add = (target: Set<string>, name: unknown, materialized: (key: string) => boolean) => {
      const id = asString(name)
      if (id && id.length <= 48 && /^[\p{L}\p{N}_\u2080-\u2089-]+$/u.test(id) && materialized(id)) target.add(id)
    }
    for (const action of actions) {
      const inputs = action.inputs as Record<string, unknown>
      const names = [inputs.alias, inputs.label]
      if (action.actionId === "planar.create_point" || action.actionId === "solid.create_point") {
        for (const name of names) add(points, name, (key) => readP2(key, branchId) !== undefined || readP3(key, branchId) !== undefined)
      } else if (action.actionId === "planar.create_line") {
        for (const name of names) add(lines, name, (key) => readL2(key, branchId) !== undefined)
      } else if (action.actionId === "planar.create_conic" || action.actionId === "planar.create_circle") {
        for (const name of names) add(conics, name, (key) => readC2(key, branchId) !== undefined)
      }
      if (action.actionId === "solid.create_face" || action.actionId === "solid.create_prism" || action.actionId === "solid.create_polyhedron") {
        for (const vertex of Array.isArray(inputs.vertexNames) ? inputs.vertexNames : []) {
          add(points, vertex, (key) => readP3(key, branchId) !== undefined)
        }
      }
    }
    const max = 24
    let remaining = 32
    const take = (values: string[]) => {
      const selected = values.slice(0, Math.min(max, remaining))
      remaining -= selected.length
      return selected
    }
    const sorted = (values: Set<string>) => [...values].sort()
    const materialized = new Set([...points, ...lines, ...conics])
    const visibleDeclarations = [...(explicitDeclarations.get("") ?? []), ...(branchId ? explicitDeclarations.get(branchId) ?? [] : [])]
    const declared = sorted(new Set(visibleDeclarations.filter((name) => !materialized.has(name) && name.length <= 48 && /^[\p{L}\p{N}_\u2080-\u2089-]+$/u.test(name))))
    const pointIds = sorted(points), lineIds = sorted(lines), conicIds = sorted(conics)
    const materializedPoints = take(pointIds)
    const materializedLines = take(lineIds)
    const materializedConics = take(conicIds)
    const declaredOnly = take(declared)
    return { materializedPoints, materializedLines, materializedConics, declaredOnly,
      truncated: pointIds.length > materializedPoints.length || lineIds.length > materializedLines.length ||
        conicIds.length > materializedConics.length || declared.length > declaredOnly.length }
  }

  return {
    referenceDirectory,
    currentSnapshot: () => speculative.snapshot(),
    stateSlices: () => [...recordedSlices],
    execute(toolName, rawInput) {
      const before = snapshotRefs()
      const branchId = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? asString((rawInput as Record<string, unknown>).branchId) : null
      const beforeBranchStep = branchId ? getTargetCanvas(branchId).snapshot().stepIndex : null
      const beforeBranchSlices = branchId ? recordedSlices.filter((slice) => slice.branchId === branchId).map((slice) => ({ ...slice, actions: [...slice.actions] })) : []
      const beforeBranchBuckets = branchId ? [...branchActionBuckets.entries()]
        .filter(([key]) => key.endsWith(`::${branchId}`))
        .map(([key, bucket]): [string, typeof bucket] => [key, { ...bucket, actions: [...bucket.actions] }]) : []
      const result = executeRaw(toolName, rawInput)
      if (!result.ok) restoreRefs(before)
      else if (branchId && beforeBranchStep !== null && result.stateChanged && toolName !== "repair_entity" && toolName !== "repair_constraint") {
        let history = branchHistory.get(branchId)
        if (!history) { history = []; branchHistory.set(branchId, history) }
        history.push({ stepIndex: beforeBranchStep, refs: before, slices: beforeBranchSlices, buckets: beforeBranchBuckets })
      }
      return attachTelemetry(result)
    }
  }
}
