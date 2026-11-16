import { buildFromPoints, buildOpenSurface, compileExpression, evaluateExpression, evaluateFunctionWithDomain, evaluateSymbolicDerivative, intersectPlanarLineAndConicExact, polynomialOf, rotatePointAboutHinge } from "@draw/geometry-kernel"

export interface ContractSourceSpan {
  text: string
  start: number
  end: number
}

export type ConicSpec2D =
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "hyperbola"; cx: number; cy: number; axis: "x" | "y"; rx: number; ry: number }
  | { kind: "parabola"; vx: number; vy: number; axis: "x" | "y"; focalParameter: number }
  | { kind: "circle"; cx: number; cy: number; radius: number }

export type ContractCheckSpec =
  | { kind: "entity-present"; entityId: string; space: "3d" | "2d" | "any"; primitiveType?: string }
  | { kind: "distance-3d"; a: string; b: string; value: number }
  | { kind: "perp-3d"; a: string; b: string; c: string; d: string }
  | { kind: "parallel-3d"; a: string; b: string; c: string; d: string }
  | { kind: "angle-3d"; a: string; b: string; c: string; d: string; degrees: number }
  | { kind: "dihedral-sine-3d" | "dihedral-cosine-3d"; edgeStart: string; edgeEnd: string; firstPoint: string; secondPoint: string; value: number }
  | { kind: "ratio-3d"; a: string; b: string; c: string; d: string; value: number }
  | { kind: "point-on-segment-ratio-3d"; p: string; a: string; b: string; t: number }
  | { kind: "point-on-segment-3d"; p: string; a: string; b: string }
  | { kind: "vector-equal-3d"; a: string; b: string; c: string; d: string }
  | { kind: "sum-distance-3d"; p: string; a: string; b: string; total: number }
  | { kind: "planes-perpendicular-3d"; first: [string, string, string]; second: [string, string, string] }
  | { kind: "fold-transform-3d"; beforeStateId: string; afterStateId: string; hinge: [string, string]; moving: readonly { before: string; after: string }[]; angleDegrees: number }
  | { kind: "volume-tetrahedron-3d"; p: string; a: string; b: string; c: string; value: number }
  | { kind: "triangle-area-3d"; a: string; b: string; c: string; value: number }
  | { kind: "prism-3d"; hasEqualEdges?: boolean }
  | { kind: "topology-3d"; solidId?: string; open?: boolean; expectedVertexIds?: readonly string[]; expectedFaceRings?: readonly (readonly string[])[] }
  | { kind: "coplanar-3d"; points: readonly string[] }
  | { kind: "circumsphere-3d" }
  | { kind: "cube-3d"; edgeLength: number }
  | { kind: "hemisphere-3d"; radius: number }
  | { kind: "point-2d"; label: string; x: number; y: number }
  | { kind: "point-y-2d"; label: string; y: number }
  | { kind: "point-x-2d"; label: string; x: number }
  | { kind: "point-on-ellipse-2d"; label: string; cx: number; cy: number; rx: number; ry: number }
  | { kind: "point-on-conic-2d"; label: string; conic: ConicSpec2D }
  | { kind: "conic-domain-2d"; conicId: string; conic: ConicSpec2D; excludePoints: readonly { x: number; y: number }[] }
  | { kind: "conic-2d"; curveType: "ellipse"; entityId?: string; cx: number; cy: number; rx: number; ry: number }
  | { kind: "conic-2d"; curveType: "hyperbola"; entityId?: string; cx: number; cy: number; axis: "x" | "y"; rx: number; ry: number }
  | { kind: "conic-2d"; curveType: "parabola"; entityId?: string; vx: number; vy: number; axis: "x" | "y"; focalParameter: number }
  | { kind: "conic-2d"; curveType: "circle"; entityId?: string; cx: number; cy: number; radius: number }
  | { kind: "point-on-line-2d"; point: string; lineId: string }
  | { kind: "point-on-segment-2d"; p: string; a: string; b: string }
  | { kind: "horizontal-2d"; a: string; b: string }
  | { kind: "vertical-2d"; a: string; b: string }
  | { kind: "line-through-2d"; entityId: string; x: number; y: number }
  | { kind: "line-equation-2d"; entityId: string; a: number; b: number; c: number }
  | { kind: "tangent-to-function-2d"; lineId: string; functionId: string; x: number }
  | { kind: "tangent-to-conic-2d"; lineId: string; conicId: string; touchPoint?: { x: number; y: number }; touchPointLabel?: string }
  | { kind: "line-vertical-2d"; entityId: string; x: number }
  | { kind: "collinear-2d"; a: string; b: string; c: string }
  | { kind: "distinct-2d"; a: string; b: string }
  | { kind: "vector-ratio-2d"; a: string; b: string; c: string; d: string; k: number }
  | { kind: "distance-2d"; a: string; b: string; value: number }
  | { kind: "secant-ratio-2d"; m: string; p: string; q: string; a: string; b: string; value: number }
  | { kind: "perp-2d"; a: string; b: string; c: string; d: string }
  | { kind: "parallel-2d"; a: string; b: string; c: string; d: string }
  | { kind: "triangle-area-2d"; a: string; b: string; c: string; value: number }
  | { kind: "quadrilateral-area-2d"; points: [string, string, string, string]; value: number }
  | { kind: "dot-2d"; a: string; b: string; c: string; d: string; value: number }
  | { kind: "parabola-circle-max-area-2d"; parabolaId: string; circleId: string; p: string; a: string; b: string; value: number; optimum: Vec2 }
  | { kind: "parabola-secant-min-distance-2d"; parabolaId: string; chordId: string; lineId: string; o: string; a: string; b: string; d: string; e: string; value: number; parameterSum: number }
  | { kind: "ellipse-secant-min-dot-2d"; ellipseId: string; lineId: string; b: string; p: string; q: string; e: string; f: string; value: number }
  | { kind: "function-sample-2d"; entityId: string; x: number; value: number }
  | { kind: "function-expression-2d"; functionId: string; expression: string }
  | { kind: "quadratic-with-constant-2d"; functionId: string; minimumConstant: number }
  | { kind: "common-tangent-range-2d"; cubicFunctionId: string; functionId: string; minimumConstant: number }
  | {
    kind: "infeasible-branch"
    subquestion: string
    forbiddenEntityIds: readonly string[]
    evidence?: ContractInfeasibleEvidence
  }

export type ContractInfeasibleEvidence =
  | { kind: "segment-dihedral-infeasible-3d"; hinge: [string, string]; fixedPoint: string; host: [string, string]; parameterDomain: readonly [number, number]; targetDegrees: number; sign: "positive" | "negative"; numerator: readonly [number, number, number]; denominator: readonly [number, number, number] }
  | { kind: "line-conic-intersections-2d"; lineId: string; conicId: string; bisectorOf: [string, string]; points: readonly [Vec2, Vec2] }
  | { kind: "ellipse-focal-right-angle-infeasible-2d"; conicId: string; focusA: string; focusB: string }
  | { kind: "parabola-directrix-cyclic-infeasible-2d"; conicId: string; tangentLineIds: [string, string]; tangentPointIds: [string, string]; footPointIds: [string, string]; intersectionPointId: string; slopeProduct: number }

export interface ContractObligation {
  id: string
  kind: string
  description: string
  scope: string
  branchId?: string
  stateId?: string
  sourceSpan: ContractSourceSpan
  expectedValue?: number | string
  check: ContractCheckSpec
}

export interface ContractSubquestion {
  id: string
  kind: "proof" | "compute" | "locus" | "judge" | "mcq" | "fill_in"
  text: string
  localAssumptions: string[]
  mustPreserveInDiagram: boolean
  feasible: boolean
  expectedResult?: string
  dependsOn?: readonly string[]
}

export interface ContractSharedScope {
  entities: string[]
  stemConditions: string[]
  subquestionScopes: {
    subquestion: string
    localConditions: string[]
    branchPolicy: string
  }[]
}

export interface ContractDisplayPolicy {
  requiresDiagram: boolean
  requiresVisualChecks: boolean
  allowOmittedSubquestion: boolean
  multiBranchHandling: string
  multiStateHandling?: string
  labelReadabilityRequired: boolean
}

export interface DrawingContractCase {
  id: string
  examType: "gaokao" | "joint"
  category: "solid" | "plane"
  format: "open_ended" | "fill_in" | "mcq"
  workspace: "geometry3d" | "conics"
  source: string
  prompt: string
  inputHash: string
  sourceHash: string
  expected: "plan" | "clarification" | "answer"
  requireVerification?: "passed"
  requiredOutputs?: readonly string[]
  inputMode: "text_only" | "text_with_figure_reference"
  independentReviewStatus: "pending_second_reviewer" | "approved"
  requiredEntityIds: string[]
  sharedScope: ContractSharedScope
  subquestions: ContractSubquestion[]
  requiredObligations: ContractObligation[]
  displayPolicy: ContractDisplayPolicy
  freeChoices: string[]
  unsupportedReasons: string[]
}

export interface ContractSuiteFile {
  version: number
  schemaVersion: string
  suite: string
  denominator: number
  enforceAllPass: boolean
  sourceManifest: string
  independentReviewStatus: "pending_second_reviewer" | "approved"
  notice?: string
  cases: DrawingContractCase[]
}

export interface ManifestCaseLike {
  id: string
  examType: string
  category: string
  format: string
  workspace: string
  source: string
  question: string
  questionSha256: string
}

export interface ManifestLike {
  count: number
  cases: readonly ManifestCaseLike[]
}

export type FailureBucket = "math" | "visual" | "interaction" | "partial" | "unknown" | "incomplete"

export interface ObligationEvaluation {
  id: string
  kind: string
  passed: boolean
  detail: string
}

export interface ContractEvaluationOptions {
  verificationStatus?: string | null
  answerText?: string | null
  infeasibleDiagnosedSubquestions?: readonly string[]
  incomplete?: boolean
  terminal?: string
  error?: string | null
  scopeId?: string
  branchId?: string
  stateId?: string
  stateCandidates?: Readonly<Record<string, unknown>>
}

export interface ContractEvaluationResult {
  id: string
  passed: boolean
  partial: boolean
  status: "passed" | "partial" | "failed" | "incomplete"
  bucket: FailureBucket | null
  objectCoverage: number
  obligationCoverage: number
  presentEntityIds: string[]
  missingEntityIds: string[]
  passedObligationIds: string[]
  failedObligationIds: string[]
  obligationResults: ObligationEvaluation[]
}

export interface ContractScopeEvaluationResult {
  passed: boolean
  status: ContractEvaluationResult["status"]
  missingScopeIds: string[]
  scopeResults: Record<string, ContractEvaluationResult>
}

export interface UnifiedCaseMetrics {
  id: string
  status: "passed" | "partial" | "failed" | "incomplete"
  bucket: FailureBucket | null
  passed: boolean
  partial: boolean
  objectCoverage: number
  obligationCoverage: number
  requests: number
  tokens: { input: number; output: number }
}

export interface UnifiedContractSummary {
  schemaVersion: "reliability-contract-summary.v1"
  suite: string
  denominator: number
  totals: {
    passed: number
    partial: number
    failed: number
    incomplete: number
  }
  buckets: Record<FailureBucket, number>
  meanObjectCoverage: number
  meanObligationCoverage: number
  requests: number
  tokens: { input: number; output: number }
  costUsd: null
  costKnown: false
  incompleteCaseIds: string[]
  caseStatuses: {
    id: string
    status: UnifiedCaseMetrics["status"]
    bucket: FailureBucket | null
    objectCoverage: number
    obligationCoverage: number
  }[]
}

export interface BaselineContractSummary extends UnifiedContractSummary {
  baselineMetrics: {
    revision: string
    previewProduced: number
    legacyHostPassed: number
    certificatePassed: null
    partialOracleExact: number
  }
}

const TOL = 1e-3

export function normalizeLabel(raw = ""): string {
  return raw
    .trim()
    .split(/[:(（]/)[0]!
    .replaceAll("₁", "1")
    .replaceAll("₂", "2")
    .replaceAll("₃", "3")
    .replaceAll("′", "'")
    .replaceAll("’", "'")
    .replace(/\s+/g, "")
}

export function validateContractSuite(
  suite: ContractSuiteFile,
  manifest: ManifestLike,
  sha256Fn?: (text: string) => string
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  if (suite.denominator !== 36 || manifest.count !== 36) {
    errors.push(`Expected fixed denominator 36, got suite=${suite.denominator}, manifest=${manifest.count}`)
  }
  if (!Array.isArray(suite.cases) || suite.cases.length !== 36) {
    errors.push(`Expected 36 cases, got ${suite.cases?.length ?? 0}`)
  }

  const byId = new Map<string, DrawingContractCase>()
  for (const c of suite.cases) {
    if (byId.has(c.id)) errors.push(`Duplicate contract case id: ${c.id}`)
    byId.set(c.id, c)
  }

  for (const m of manifest.cases) {
    const c = byId.get(m.id)
    if (!c) {
      errors.push(`Missing frozen contract case: ${m.id}`)
      continue
    }
    if (c.prompt !== m.question) errors.push(`${m.id}: prompt text mismatch against manifest.json`)
    if (c.inputHash !== m.questionSha256 || c.sourceHash !== m.questionSha256) {
      errors.push(`${m.id}: inputHash/sourceHash does not match manifest questionSha256`)
    }
    if (sha256Fn && sha256Fn(c.prompt) !== c.inputHash) {
      errors.push(`${m.id}: prompt SHA-256 hash mismatch against inputHash`)
    }
    if (c.examType !== m.examType || c.category !== m.category || c.format !== m.format || c.workspace !== m.workspace || c.source !== m.source) {
      errors.push(`${m.id}: metadata mismatch against manifest.json`)
    }
    if (c.requiredObligations.length === 0) {
      errors.push(`${m.id}: requiredObligations must be non-empty`)
    }
    for (const ob of c.requiredObligations) {
      const sliced = c.prompt.slice(ob.sourceSpan.start, ob.sourceSpan.end)
      if (sliced !== ob.sourceSpan.text) {
        errors.push(`${m.id}/${ob.id}: sourceSpan mismatch (${JSON.stringify(sliced)} !== ${JSON.stringify(ob.sourceSpan.text)})`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}

type Vec3 = { x: number; y: number; z: number }
type Vec2 = { x: number; y: number }

const sub3 = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
const len3 = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)
const dist3 = (a: Vec3, b: Vec3): number => len3(sub3(a, b))
const cross3 = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x
})

const near = (a: number, b: number, tol = TOL): boolean => Number.isFinite(a) && Math.abs(a - b) <= tol * Math.max(1, Math.abs(b))

function polyhedronVertexSets(prims: readonly Record<string, unknown>[]): Vec3[][] {
  const pointsById = new Map<string, Vec3>()
  for (const primitive of prims) {
    if (primitive.type !== "point3" || typeof primitive.id !== "string") continue
    const position = primitive.position as Vec3 | undefined
    if (position && [position.x, position.y, position.z].every((value) => typeof value === "number" && Number.isFinite(value))) {
      pointsById.set(primitive.id, position)
    }
  }
  const sets: Vec3[][] = []
  for (const primitive of prims) {
    if (primitive.type !== "polyhedron3" || !Array.isArray(primitive.vertexIds)) continue
    const points = primitive.vertexIds.map((id) => typeof id === "string" ? pointsById.get(id) : undefined)
    if (points.length > 0 && points.every((point): point is Vec3 => point !== undefined)) sets.push(points)
  }
  return sets
}

function evaluatePolyhedronTopology(
  prims: readonly Record<string, unknown>[],
  check: Extract<ContractCheckSpec, { kind: "topology-3d" }>
): { passed: boolean; detail: string } {
  const nameFor = (id: unknown) => {
    if (typeof id !== "string") return null
    const point = prims.find((primitive) => primitive.type === "point3" && primitive.id === id)
    return normalizeLabel(String(point?.label ?? id))
  }
  const positions = new Map<string, Vec3>()
  for (const primitive of prims) {
    if (primitive.type !== "point3" || typeof primitive.id !== "string") continue
    const position = primitive.position as Vec3 | undefined
    if (position && [position.x, position.y, position.z].every((value) => typeof value === "number" && Number.isFinite(value))) positions.set(primitive.id, position)
  }
  const expectedVertices = check.expectedVertexIds?.map(normalizeLabel) ?? (check.expectedFaceRings
    ? [...new Set(check.expectedFaceRings.flat().map(normalizeLabel))]
    : undefined)
  const matchingSolids = prims.filter((primitive) => {
    if (primitive.type !== "polyhedron3" || (check.solidId !== undefined && primitive.id !== check.solidId) || !Array.isArray(primitive.vertexIds)) return false
    if (expectedVertices === undefined) return true
    const actual = primitive.vertexIds.map(nameFor)
    return actual.every((name) => name !== null) && new Set(actual).size === actual.length && actual.length === expectedVertices.length && expectedVertices.every((name) => actual.includes(name))
  })
  if (matchingSolids.length === 0) return { passed: false, detail: `missing named polyhedron ${check.solidId ?? "candidate"}` }
  if (expectedVertices !== undefined && matchingSolids.length !== 1) return { passed: false, detail: "ambiguous named polyhedron" }
  for (const solid of matchingSolids) {
    if (!Array.isArray(solid.vertexIds) || !Array.isArray(solid.faceIds)) return { passed: false, detail: "polyhedron is missing vertexIds or faceIds" }
    const vertices = solid.vertexIds.map((id) => positions.get(id as string))
    if (vertices.some((point) => point === undefined)) return { passed: false, detail: "polyhedron references a missing or non-finite vertex" }
    const indices = new Map((solid.vertexIds as string[]).map((id, index) => [id, index]))
    const faces: number[][] = []
    const faceNames: string[][] = []
    for (const faceId of solid.faceIds) {
      const face = prims.find((primitive) => primitive.type === "face3" && primitive.id === faceId)
      if (!face || !Array.isArray(face.pointIds)) return { passed: false, detail: `missing face ring ${String(faceId)}` }
      const ring = face.pointIds.map((id) => typeof id === "string" ? indices.get(id) : undefined)
      if (ring.some((index) => index === undefined)) return { passed: false, detail: `face ring ${String(faceId)} references a vertex outside the polyhedron` }
      faces.push(ring as number[])
      faceNames.push(face.pointIds.map(nameFor).filter((name): name is string => name !== null))
    }
    if (check.expectedFaceRings) {
      const equivalentRing = (actual: readonly string[], expected: readonly string[]) => {
        if (actual.length !== expected.length || actual.length < 3) return false
        return actual.some((_, offset) => {
          const rotated = actual.map((__, index) => actual[(index + offset) % actual.length]!)
          return expected.every((name, index) => rotated[index] === name) || expected.every((name, index) => rotated[rotated.length - 1 - index] === name)
        })
      }
      const used = new Set<number>()
      const matched = check.expectedFaceRings.every((expected) => {
        const index = faceNames.findIndex((actual, faceIndex) => !used.has(faceIndex) && equivalentRing(actual, expected.map(normalizeLabel)))
        if (index < 0) return false
        used.add(index)
        return true
      })
      if (!matched || used.size !== faceNames.length) return { passed: false, detail: "polyhedron face rings do not match the named topology" }
    }
    let sequence = 0
    const result = check.open === true
      ? buildOpenSurface({ vertices: vertices as Vec3[], faces }, { allocateId: (namespace) => `${namespace}-${sequence++}` })
      : buildFromPoints({ vertices: vertices as Vec3[], faces }, { allocateId: (namespace) => `${namespace}-${sequence++}` })
    if (result.diagnostics.length > 0) {
      return { passed: false, detail: result.diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.message}`).join("; ") }
    }
  }
  return { passed: true, detail: check.open === true ? "named open surface topology passed" : "named closed polyhedron topology passed" }
}

function sortedPairDistances(points: readonly Vec3[]): number[] {
  const distances: number[] = []
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) distances.push(dist3(points[first]!, points[second]!))
  }
  return distances.sort((a, b) => a - b)
}

function distanceMultiplicityMatches(distances: readonly number[], edge: number, expected: readonly { ratio: number; count: number }[]): boolean {
  if (!(edge > 1e-9) || !Number.isFinite(edge)) return false
  let offset = 0
  for (const group of expected) {
    for (let index = 0; index < group.count; index += 1) {
      if (!near(distances[offset]! / edge, group.ratio)) return false
      offset += 1
    }
  }
  return offset === distances.length
}

function equalEdgeTriangularPrismPoints(prims: readonly Record<string, unknown>[]): Vec3[] | null {
  for (const points of polyhedronVertexSets(prims)) {
    if (points.length !== 6) continue
    const distances = sortedPairDistances(points)
    if (distanceMultiplicityMatches(distances, distances[0]!, [
      { ratio: 1, count: 9 },
      { ratio: Math.SQRT2, count: 6 }
    ])) return points
  }
  return null
}

function cubePoints(prims: readonly Record<string, unknown>[], edgeLength?: number): Vec3[] | null {
  for (const points of polyhedronVertexSets(prims)) {
    if (points.length !== 8) continue
    const distances = sortedPairDistances(points)
    const edge = distances[0]!
    if ((edgeLength === undefined || near(edge, edgeLength)) && distanceMultiplicityMatches(distances, edge, [
      { ratio: 1, count: 12 },
      { ratio: Math.SQRT2, count: 12 },
      { ratio: Math.sqrt(3), count: 4 }
    ])) return points
  }
  return null
}

function spheres(prims: readonly Record<string, unknown>[]): { center: Vec3; radius: number }[] {
  return prims.flatMap((primitive) => {
    if (primitive.type !== "sphere") return []
    const center = primitive.center as Vec3 | undefined
    const radius = primitive.radius
    return center && [center.x, center.y, center.z].every((value) => typeof value === "number" && Number.isFinite(value)) &&
      typeof radius === "number" && Number.isFinite(radius) && radius > 0
      ? [{ center, radius }]
      : []
  })
}

function uniqueEntity(prims: readonly Record<string, unknown>[], entityId: string, type: string): Record<string, unknown> | null {
  const matches = prims.filter((primitive) => primitive.type === type && (primitive.id === entityId || primitive.label === entityId))
  return matches.length === 1 ? matches[0]! : null
}

function uniqueConic(prims: readonly Record<string, unknown>[], conicId: string): Record<string, unknown> | null {
  const matches = prims.filter((primitive) =>
    ["circle", "ellipse", "hyperbola", "parabola"].includes(primitive.type as string) &&
    (primitive.id === conicId || primitive.label === conicId)
  )
  return matches.length === 1 ? matches[0]! : null
}

function conicParametersMatch(primitive: Record<string, unknown>, spec: ConicSpec2D): boolean {
  if (primitive.type !== spec.kind) return false
  if (spec.kind === "parabola") {
    const vertex = primitive.vertex as Vec2 | undefined
    return !!vertex && near(vertex.x, spec.vx) && near(vertex.y, spec.vy) && primitive.axis === spec.axis && near(Number(primitive.focalParameter), spec.focalParameter, 1e-2)
  }
  const center = primitive.center as Vec2 | undefined
  if (!center || !near(center.x, spec.cx) || !near(center.y, spec.cy)) return false
  if (spec.kind === "circle") return near(Number(primitive.radius), spec.radius)
  const axisMatches = spec.kind === "ellipse" || primitive.axis === spec.axis
  const tolerance = spec.kind === "hyperbola" ? 1e-2 : TOL
  return axisMatches && near(Number(primitive.radiusX), spec.rx, tolerance) && near(Number(primitive.radiusY), spec.ry, tolerance)
}

function conicResidual2d(spec: ConicSpec2D, point: Vec2): number | null {
  if (spec.kind === "circle") {
    return Math.abs(Math.hypot(point.x - spec.cx, point.y - spec.cy) / spec.radius - 1)
  }
  if (spec.kind === "ellipse") {
    return Math.abs(((point.x - spec.cx) / spec.rx) ** 2 + ((point.y - spec.cy) / spec.ry) ** 2 - 1)
  }
  if (spec.kind === "hyperbola") {
    const first = spec.axis === "x"
      ? ((point.x - spec.cx) / spec.rx) ** 2 - ((point.y - spec.cy) / spec.ry) ** 2
      : ((point.y - spec.cy) / spec.ry) ** 2 - ((point.x - spec.cx) / spec.rx) ** 2
    return Math.abs(first - 1)
  }
  const expected = spec.axis === "y"
    ? (point.x - spec.vx) ** 2 - 2 * spec.focalParameter * (point.y - spec.vy)
    : (point.y - spec.vy) ** 2 - 2 * spec.focalParameter * (point.x - spec.vx)
  const scale = Math.max(1, Math.abs(spec.axis === "y" ? 2 * spec.focalParameter * (point.y - spec.vy) : 2 * spec.focalParameter * (point.x - spec.vx)))
  return Math.abs(expected) / scale
}

function collectPrimitives(candidate: unknown): readonly Record<string, unknown>[] {
  const prims = (candidate as { primitives?: readonly unknown[] } | null | undefined)?.primitives
  return Array.isArray(prims) ? (prims as Record<string, unknown>[]) : []
}

function points3Of(prims: readonly Record<string, unknown>[]): Map<string, Vec3> {
  const map = new Map<string, Vec3>()
  for (const p of prims) {
    if (p.type !== "point3") continue
    const pos = p.position as { x?: unknown; y?: unknown; z?: unknown } | undefined
    if (!pos || ![pos.x, pos.y, pos.z].every((v) => typeof v === "number" && Number.isFinite(v))) continue
    const lbl = normalizeLabel(String(p.label ?? p.id ?? ""))
    if (lbl) map.set(lbl, { x: pos.x as number, y: pos.y as number, z: pos.z as number })
  }
  return map
}

function points2Of(prims: readonly Record<string, unknown>[]): Map<string, Vec2> {
  const map = new Map<string, Vec2>()
  for (const p of prims) {
    if (p.type !== "point") continue
    if (typeof p.x !== "number" || typeof p.y !== "number" || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const lbl = normalizeLabel(String(p.label ?? p.id ?? ""))
    if (lbl) map.set(lbl, { x: p.x, y: p.y })
  }
  return map
}

function labelsOf(prims: readonly Record<string, unknown>[]): Set<string> {
  const set = new Set<string>()
  for (const p of prims) {
    const raw = typeof p.label === "string" && p.label.length > 0 ? p.label : typeof p.id === "string" ? p.id : ""
    const lbl = normalizeLabel(raw)
    if (lbl) set.add(lbl)
  }
  return set
}

function finitePoint2(value: unknown): value is Vec2 {
  const point = value as Vec2 | undefined
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y)
}

function distancePointToLine2(point: Vec2, a: Vec2, b: Vec2): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  return length <= 1e-12 ? Number.POSITIVE_INFINITY : Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) / length
}

function evaluateInfeasibleEvidence(
  evidence: ContractInfeasibleEvidence,
  prims: readonly Record<string, unknown>[],
  pts2: Map<string, Vec2>,
  pts3: Map<string, Vec3>
): { passed: boolean; detail: string } {
  const point = (label: string) => pts2.get(normalizeLabel(label))
  if (evidence.kind === "segment-dihedral-infeasible-3d") {
    const hingeStart = pts3.get(normalizeLabel(evidence.hinge[0])), hingeEnd = pts3.get(normalizeLabel(evidence.hinge[1]))
    const fixedPoint = pts3.get(normalizeLabel(evidence.fixedPoint)), hostStart = pts3.get(normalizeLabel(evidence.host[0])), hostEnd = pts3.get(normalizeLabel(evidence.host[1]))
    if (!hingeStart || !hingeEnd || !fixedPoint || !hostStart || !hostEnd) return { passed: false, detail: "missing hinge, fixed point or segment host" }
    const hinge = sub3(hingeEnd, hingeStart), hingeLengthSquared = dot3(hinge, hinge)
    if (hingeLengthSquared <= 1e-18) return { passed: false, detail: "degenerate dihedral hinge" }
    const project = (vector: Vec3): Vec3 => {
      const scale = dot3(vector, hinge) / hingeLengthSquared
      return { x: vector.x - scale * hinge.x, y: vector.y - scale * hinge.y, z: vector.z - scale * hinge.z }
    }
    const fixed = project(sub3(fixedPoint, hingeStart)), start = project(sub3(hostStart, hingeStart)), direction = project(sub3(hostEnd, hostStart))
    const dot0 = dot3(start, fixed), dot1 = dot3(direction, fixed)
    const numerator: [number, number, number] = [dot0 * dot0, 2 * dot0 * dot1, dot1 * dot1]
    const fixedLengthSquared = dot3(fixed, fixed), startLengthSquared = dot3(start, start), directionLengthSquared = dot3(direction, direction)
    const denominator: [number, number, number] = [fixedLengthSquared * startLengthSquared, 2 * fixedLengthSquared * dot3(start, direction), fixedLengthSquared * directionLengthSquared]
    const scale = evidence.denominator[0] / denominator[0]
    const coefficientsMatch = Number.isFinite(scale) && scale > 0 && [0, 1, 2].every((index) =>
      near(numerator[index]! * scale, evidence.numerator[index]!, 1e-9) && near(denominator[index]! * scale, evidence.denominator[index]!, 1e-9)
    )
    const [parameterMin, parameterMax] = evidence.parameterDomain
    if (!Number.isFinite(parameterMin) || !Number.isFinite(parameterMax) || parameterMax <= parameterMin) return { passed: false, detail: "invalid segment parameter domain" }
    const dotAt = (t: number) => dot0 + dot1 * t
    const signMatches = evidence.sign === "negative" ? dotAt(parameterMin) < 0 && dotAt(parameterMax) < 0 : dotAt(parameterMin) > 0 && dotAt(parameterMax) > 0
    const constantNumerator = numerator[0] > 0 && Math.abs(numerator[1]) <= 1e-9 && Math.abs(numerator[2]) <= 1e-9
    if (!coefficientsMatch || !signMatches || !constantNumerator || denominator[2] <= 1e-12 || evidence.denominator[2] <= 0) {
      return { passed: false, detail: `unsupported or mismatched dihedral polynomial; numerator=${JSON.stringify(numerator)}, denominator=${JSON.stringify(denominator)}` }
    }
    const denominatorAt = (t: number) => denominator[0] + denominator[1] * t + denominator[2] * t * t
    const vertexT = -denominator[1] / (2 * denominator[2])
    const denominatorValues = [denominatorAt(parameterMin), denominatorAt(parameterMax), ...(vertexT >= parameterMin && vertexT <= parameterMax ? [denominatorAt(vertexT)] : [])]
    const denominatorMin = Math.min(...denominatorValues), denominatorMax = Math.max(...denominatorValues)
    if (!(denominatorMin > 1e-12) || !Number.isFinite(denominatorMax)) return { passed: false, detail: "dihedral projection degenerates on the segment" }
    const minimumCosSquared = numerator[0] / denominatorMax, maximumCosSquared = numerator[0] / denominatorMin
    const minimumCos = evidence.sign === "negative" ? -Math.sqrt(maximumCosSquared) : Math.sqrt(minimumCosSquared)
    const maximumCos = evidence.sign === "negative" ? -Math.sqrt(minimumCosSquared) : Math.sqrt(maximumCosSquared)
    const targetCos = Math.cos(evidence.targetDegrees * Math.PI / 180)
    const passed = targetCos < minimumCos || targetCos > maximumCos
    return { passed, detail: `cos²=${JSON.stringify(evidence.numerator)}/${JSON.stringify(evidence.denominator)}, cos∈[${minimumCos},${maximumCos}], target cos=${targetCos} is ${passed ? "unreachable" : "reachable"}` }
  }
  if (evidence.kind === "line-conic-intersections-2d") {
    const line = uniqueEntity(prims, evidence.lineId, "line")
    const conic = uniqueConic(prims, evidence.conicId)
    const first = point(evidence.bisectorOf[0]), second = point(evidence.bisectorOf[1])
    if (!line || !conic || !first || !second || !finitePoint2(line.a) || !finitePoint2(line.b)) return { passed: false, detail: "missing line, conic or segment endpoints" }
    const direction = { x: line.b.x - line.a.x, y: line.b.y - line.a.y }
    const segment = { x: second.x - first.x, y: second.y - first.y }
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    const perpendicular = Math.abs(direction.x * segment.x + direction.y * segment.y) <= 1e-9 * Math.max(1, Math.hypot(direction.x, direction.y) * Math.hypot(segment.x, segment.y))
    if (!perpendicular || distancePointToLine2(midpoint, line.a, line.b) > 1e-6) return { passed: false, detail: `${evidence.lineId} is not the perpendicular bisector of ${evidence.bisectorOf.join("/")}` }
    const result = intersectPlanarLineAndConicExact({ type: "line", a: line.a, b: line.b } as never, conic as never)
    const matches = result.kind === "secant" && evidence.points.every((expected) => result.points.some((actual) => near(actual.x, expected.x, 1e-6) && near(actual.y, expected.y, 1e-6)))
    return { passed: matches, detail: `${evidence.lineId} intersection=${result.kind}, expected two independently checked points` }
  }
  if (evidence.kind === "ellipse-focal-right-angle-infeasible-2d") {
    const conic = uniqueConic(prims, evidence.conicId)
    const first = point(evidence.focusA), second = point(evidence.focusB)
    if (conic?.type !== "ellipse" || !first || !second || !finitePoint2(conic.center) || (conic.rotation ?? 0) !== 0) return { passed: false, detail: "missing axis-aligned ellipse or foci" }
    const center = conic.center
    const a = Number(conic.radiusX), b = Number(conic.radiusY)
    if (!(a > b && b > 0)) return { passed: false, detail: "the focal-right-angle proof requires a > b > 0" }
    const c = Math.sqrt(a * a - b * b)
    const fociMatch = [first, second].some((focus) => near(focus.x, center.x - c, 1e-6) && near(focus.y, center.y, 1e-6)) &&
      [first, second].some((focus) => near(focus.x, center.x + c, 1e-6) && near(focus.y, center.y, 1e-6))
    const passed = fociMatch && b > c
    return { passed, detail: `ellipse b=${b}, c=${c}; focal dot product >= b²-c²=${b * b - c * c}, so perpendicularity is ${passed ? "impossible" : "not excluded"}` }
  }
  const conic = uniqueConic(prims, evidence.conicId)
  const [a, b] = evidence.tangentPointIds.map(point)
  const [c, d] = evidence.footPointIds.map(point)
  const p = point(evidence.intersectionPointId)
  if (conic?.type !== "parabola" || conic.axis !== "y" || conic.focalParameter !== 2 || (conic.rotation ?? 0) !== 0 ||
    !finitePoint2(conic.vertex) || conic.vertex.x !== 0 || conic.vertex.y !== 0 || !a || !b || !c || !d || !p || evidence.slopeProduct !== -2) {
    return { passed: false, detail: "unsupported parabola/directrix configuration or missing named points" }
  }
  const lines = evidence.tangentLineIds.map((lineId) => uniqueEntity(prims, lineId, "line"))
  const tangentsValid = lines.every((line, index) => {
    const touch = index === 0 ? a : b
    if (!line || !finitePoint2(line.a) || !finitePoint2(line.b)) return false
    const result = intersectPlanarLineAndConicExact({ type: "line", a: line.a, b: line.b } as never, conic as never)
    const slope = (line.b.y - line.a.y) / (line.b.x - line.a.x)
    const expectedSlope = (index === 0 ? a.x : b.x) / 2
    return result.kind === "tangent" && result.points.some((point) => near(point.x, touch.x, 1e-6) && near(point.y, touch.y, 1e-6)) &&
      Number.isFinite(slope) && near(slope, expectedSlope, 1e-6) && distancePointToLine2(p, line.a, line.b) <= 1e-6
  })
  const pointsValid = near(a.y, a.x * a.x / 4, 1e-6) && near(b.y, b.x * b.x / 4, 1e-6) &&
    near(c.x, a.x, 1e-6) && near(c.y, -1, 1e-6) && near(d.x, b.x, 1e-6) && near(d.y, -1, 1e-6) &&
    near(p.x, (a.x + b.x) / 2, 1e-6) && near(p.y, a.x * b.x / 4, 1e-6)
  const product = a.x * b.x
  const passed = tangentsValid && pointsValid && near(product / 4, -2, 1e-6) && Math.abs(a.x - b.x) > 1e-9
  return { passed, detail: `tangent abscissas a=${a.x}, b=${b.x}; ab=${product}; concyclicity would require a=b or b=0, contradicting ab=-8` }
}

function evaluateCheck(
  check: ContractCheckSpec,
  prims: readonly Record<string, unknown>[],
  pts3: Map<string, Vec3>,
  pts2: Map<string, Vec2>,
  allLabels: Set<string>,
  options: ContractEvaluationOptions
): { passed: boolean; detail: string } {
  const p3 = (name: string) => pts3.get(normalizeLabel(name))
  const p2 = (name: string) => pts2.get(normalizeLabel(name))

  switch (check.kind) {
    case "entity-present": {
      const key = normalizeLabel(check.entityId)
      const ok = check.primitiveType !== undefined
        ? uniqueEntity(prims, check.entityId, check.primitiveType) !== null
        : check.space === "3d" ? pts3.has(key) || allLabels.has(key) : check.space === "2d" ? pts2.has(key) || allLabels.has(key) : allLabels.has(key)
      return { passed: ok, detail: ok ? `entity ${check.entityId} present with required type` : `missing, ambiguous or wrongly typed entity ${check.entityId}` }
    }
    case "distance-3d": {
      const a = p3(check.a), b = p3(check.b)
      if (!a || !b) return { passed: false, detail: `missing 3d vertex ${!a ? check.a : check.b}` }
      const d = dist3(a, b)
      return { passed: near(d, check.value), detail: `|${check.a}${check.b}|=${d.toFixed(6)} vs ${check.value}` }
    }
    case "perp-3d": {
      const a = p3(check.a), b = p3(check.b), c = p3(check.c), d = p3(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 3d vertices for ${check.a}${check.b}⊥${check.c}${check.d}` }
      const u = sub3(b, a), v = sub3(d, c)
      const scale = len3(u) * len3(v)
      const err = scale > 1e-9 ? Math.abs(dot3(u, v)) / scale : Number.POSITIVE_INFINITY
      return { passed: err <= TOL, detail: `perp cosine error=${err}` }
    }
    case "parallel-3d": {
      const a = p3(check.a), b = p3(check.b), c = p3(check.c), d = p3(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 3d vertices for ${check.a}${check.b}∥${check.c}${check.d}` }
      const u = sub3(b, a), v = sub3(d, c)
      const scale = len3(u) * len3(v)
      const err = scale > 1e-9 ? len3(cross3(u, v)) / scale : Number.POSITIVE_INFINITY
      return { passed: err <= TOL, detail: `parallel sine error=${err}` }
    }
    case "angle-3d": {
      const a = p3(check.a), b = p3(check.b), c = p3(check.c), d = p3(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 3d vertices for angle` }
      const u = sub3(b, a), v = sub3(d, c)
      const scale = len3(u) * len3(v)
      if (scale <= 1e-9) return { passed: false, detail: "degenerate angle vector" }
      const cos = Math.max(-1, Math.min(1, dot3(u, v) / scale))
      const deg = (Math.acos(cos) * 180) / Math.PI
      return { passed: near(deg, check.degrees, 0.1), detail: `angle=${deg.toFixed(4)}° vs ${check.degrees}°` }
    }
    case "dihedral-sine-3d":
    case "dihedral-cosine-3d": {
      const edgeStart = p3(check.edgeStart), edgeEnd = p3(check.edgeEnd), first = p3(check.firstPoint), second = p3(check.secondPoint)
      if (!edgeStart || !edgeEnd || !first || !second) return { passed: false, detail: "missing 3d vertices for dihedral measurement" }
      const edge = sub3(edgeEnd, edgeStart)
      const firstVector = sub3(first, edgeStart), secondVector = sub3(second, edgeStart)
      const edgeLengthSquared = dot3(edge, edge)
      if (edgeLengthSquared <= 1e-18) return { passed: false, detail: "degenerate dihedral edge" }
      const project = (vector: Vec3): Vec3 => {
        const scale = dot3(vector, edge) / edgeLengthSquared
        return { x: vector.x - scale * edge.x, y: vector.y - scale * edge.y, z: vector.z - scale * edge.z }
      }
      const u = project(firstVector), v = project(secondVector)
      const scale = len3(u) * len3(v)
      if (scale <= 1e-12) return { passed: false, detail: "degenerate dihedral face projection" }
      const value = check.kind === "dihedral-sine-3d" ? len3(cross3(u, v)) / scale : dot3(u, v) / scale
      return { passed: near(value, check.value, 1e-2), detail: `${check.kind}=${value} vs ${check.value}` }
    }
    case "ratio-3d": {
      const a = p3(check.a), b = p3(check.b), c = p3(check.c), d = p3(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 3d vertices for ratio` }
      const den = dist3(c, d)
      if (den <= 1e-9) return { passed: false, detail: `zero denominator |${check.c}${check.d}|` }
      const r = dist3(a, b) / den
      return { passed: near(r, check.value), detail: `ratio=${r.toFixed(6)} vs ${check.value}` }
    }
    case "point-on-segment-ratio-3d": {
      const p = p3(check.p), a = p3(check.a), b = p3(check.b)
      if (!p || !a || !b) return { passed: false, detail: `missing 3d vertices for point-on-segment-ratio` }
      const ab = sub3(b, a)
      const expected = { x: a.x + check.t * ab.x, y: a.y + check.t * ab.y, z: a.z + check.t * ab.z }
      const err = dist3(p, expected)
      return { passed: err <= TOL, detail: `segment ratio error=${err}` }
    }
    case "point-on-segment-3d": {
      const p = p3(check.p), a = p3(check.a), b = p3(check.b)
      if (!p || !a || !b) return { passed: false, detail: `missing 3d vertices for point-on-segment ${check.p}` }
      const ab = sub3(b, a), ap = sub3(p, a)
      const lengthSquared = dot3(ab, ab)
      if (lengthSquared <= 1e-18) return { passed: false, detail: `degenerate segment ${check.a}${check.b}` }
      const length = Math.sqrt(lengthSquared)
      const distance = len3(cross3(ab, ap)) / length
      const t = dot3(ap, ab) / lengthSquared
      const ok = distance <= TOL * Math.max(1, length) && t >= -TOL && t <= 1 + TOL
      return { passed: ok, detail: `segment distance=${distance}, parameter=${t}` }
    }
    case "vector-equal-3d": {
      const a = p3(check.a), b = p3(check.b), c = p3(check.c), d = p3(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 3d vertices for vector equality` }
      const ab = sub3(b, a), cd = sub3(d, c)
      const err = dist3(ab, cd)
      return { passed: err <= TOL, detail: `vector diff=${err}` }
    }
    case "sum-distance-3d": {
      const p = p3(check.p), a = p3(check.a), b = p3(check.b)
      if (!p || !a || !b) return { passed: false, detail: `missing 3d vertices for distance sum` }
      const total = dist3(p, a) + dist3(p, b)
      return { passed: near(total, check.total, 1e-2), detail: `sum=${total} vs ${check.total}` }
    }
    case "planes-perpendicular-3d": {
      const f = check.first.map(p3), s = check.second.map(p3)
      if (f.some((x) => !x) || s.some((x) => !x)) return { passed: false, detail: `missing 3d vertices for plane perpendicularity` }
      const n1 = cross3(sub3(f[1]!, f[0]!), sub3(f[2]!, f[0]!))
      const n2 = cross3(sub3(s[1]!, s[0]!), sub3(s[2]!, s[0]!))
      const scale = len3(n1) * len3(n2)
      const err = scale > 1e-9 ? Math.abs(dot3(n1, n2)) / scale : Number.POSITIVE_INFINITY
      return { passed: err <= 1e-2, detail: `plane normal cosine=${err}` }
    }
    case "fold-transform-3d": {
      const beforeCandidate = options.stateCandidates?.[check.beforeStateId]
      const afterCandidate = options.stateCandidates?.[check.afterStateId]
      if (beforeCandidate === undefined || afterCandidate === undefined) return { passed: false, detail: "missing before/after fold state candidates" }
      const beforePoints = points3Of(collectPrimitives(beforeCandidate))
      const afterPoints = points3Of(collectPrimitives(afterCandidate))
      const hingeBefore = check.hinge.map((name) => beforePoints.get(normalizeLabel(name)))
      const hingeAfter = check.hinge.map((name) => afterPoints.get(normalizeLabel(name)))
      if (hingeBefore.some((point) => point === undefined) || hingeAfter.some((point) => point === undefined)) {
        return { passed: false, detail: "missing fold hinge endpoints in before/after states" }
      }
      const first = hingeBefore[0]!, second = hingeBefore[1]!
      const scale = Math.max(1, dist3(first, second), ...check.moving.map(({ before }) => {
        const point = beforePoints.get(normalizeLabel(before))
        return point === undefined ? 0 : dist3(point, first)
      }))
      for (let index = 0; index < hingeBefore.length; index += 1) {
        const drift = dist3(hingeBefore[index]!, hingeAfter[index]!)
        if (drift > TOL * scale) return { passed: false, detail: `fold hinge drift=${drift}, tolerance=${TOL * scale}` }
      }
      for (const mapping of check.moving) {
        const before = beforePoints.get(normalizeLabel(mapping.before))
        const after = afterPoints.get(normalizeLabel(mapping.after))
        if (!before || !after) return { passed: false, detail: `missing moving point ${mapping.before}→${mapping.after}` }
        const rotated = rotatePointAboutHinge(before, first, second, check.angleDegrees)
        if (rotated.status !== "ok") return { passed: false, detail: rotated.detail }
        const error = dist3(rotated.point, after)
        if (error > TOL * scale) return { passed: false, detail: `fold transform error for ${mapping.before}→${mapping.after}=${error}, tolerance=${TOL * scale}, before=${JSON.stringify(before)}, expected=${JSON.stringify(rotated.point)}, actual=${JSON.stringify(after)}` }
      }
      return { passed: true, detail: `verified rigid fold about ${check.hinge.join("-")} at ${check.angleDegrees} degrees` }
    }
    case "volume-tetrahedron-3d": {
      const p = p3(check.p), a = p3(check.a), b = p3(check.b), c = p3(check.c)
      if (!p || !a || !b || !c) return { passed: false, detail: `missing 3d vertices for volume` }
      const vol = Math.abs(dot3(cross3(sub3(b, a), sub3(c, a)), sub3(p, a))) / 6
      return { passed: near(vol, check.value, 1e-2), detail: `volume=${vol} vs ${check.value}` }
    }
    case "triangle-area-3d": {
      const a = p3(check.a), b = p3(check.b), c = p3(check.c)
      if (!a || !b || !c) return { passed: false, detail: `missing 3d vertices for triangle area` }
      const area = len3(cross3(sub3(b, a), sub3(c, a))) / 2
      return { passed: near(area, check.value, 1e-2), detail: `area=${area} vs ${check.value}` }
    }
    case "coplanar-3d": {
      const points = check.points.map(p3)
      if (points.some((point) => point === undefined)) return { passed: false, detail: `missing 3d vertices for coplanarity: ${check.points.join(",")}` }
      const origin = points[0]!
      let normal: Vec3 = { x: 0, y: 0, z: 0 }
      for (let first = 1; first < points.length - 1 && len3(normal) <= 1e-12; first += 1) {
        for (let second = first + 1; second < points.length && len3(normal) <= 1e-12; second += 1) {
          normal = cross3(sub3(points[first]!, origin), sub3(points[second]!, origin))
        }
      }
      const normalLength = len3(normal)
      if (normalLength <= 1e-12) return { passed: false, detail: "degenerate point set cannot establish a plane" }
      const span = Math.max(...points.flatMap((point, index) => points.slice(index + 1).map((other) => dist3(point!, other!))), 0)
      const deviation = Math.max(...points.map((point) => Math.abs(dot3(normal, sub3(point!, origin))) / normalLength))
      const ok = deviation <= span * 1e-9
      return { passed: ok, detail: `plane deviation=${deviation}, tolerance=${span * 1e-9}` }
    }
    case "topology-3d":
      return evaluatePolyhedronTopology(prims, check)
    case "prism-3d": {
      const ok = check.hasEqualEdges === true
        ? equalEdgeTriangularPrismPoints(prims) !== null
        : polyhedronVertexSets(prims).some((points) => points.length >= 6)
      return { passed: ok, detail: ok ? "verified right equal-edge triangular prism" : "missing equal-edge right triangular prism geometry" }
    }
    case "circumsphere-3d": {
      const sets = polyhedronVertexSets(prims)
      const ok = spheres(prims).some((sphere) => sets.some((points) => points.every((point) => near(dist3(point, sphere.center), sphere.radius))))
      return { passed: ok, detail: ok ? "all polyhedron vertices lie on the sphere" : "no sphere passes through the polyhedron vertices" }
    }
    case "hemisphere-3d": {
      const cube = cubePoints(prims)
      let ok = false
      if (cube) {
        for (const sphere of spheres(prims)) {
          if (!near(sphere.radius, check.radius)) continue
          for (let a = 0; a < 5 && !ok; a += 1) for (let b = a + 1; b < 6 && !ok; b += 1) for (let c = b + 1; c < 7 && !ok; c += 1) for (let d = c + 1; d < 8 && !ok; d += 1) {
            const baseIds = new Set([a, b, c, d])
            const base = [...baseIds].map((index) => cube[index]!)
            const center = base.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4, z: sum.z + point.z / 4 }), { x: 0, y: 0, z: 0 })
            const centered = near(center.x, sphere.center.x) && near(center.y, sphere.center.y) && near(center.z, sphere.center.z)
            const baseInside = base.every((point) => dist3(point, sphere.center) <= sphere.radius + TOL)
            const capOnSphere = cube.filter((_, index) => !baseIds.has(index)).every((point) => near(dist3(point, sphere.center), sphere.radius))
            ok = centered && baseInside && capOnSphere
          }
        }
      }
      return { passed: ok, detail: ok ? `verified hemisphere radius ${check.radius} with inscribed cube` : "missing cube base center or cap vertices on the required hemisphere" }
    }
    case "cube-3d": {
      const ok = cubePoints(prims, check.edgeLength) !== null
      return { passed: ok, detail: ok ? `verified cube edge length ${check.edgeLength}` : `missing cube with edge length ${check.edgeLength}` }
    }
    case "point-2d": {
      const pt = p2(check.label)
      if (!pt) return { passed: false, detail: `missing 2d point ${check.label}` }
      const ok = near(pt.x, check.x) && near(pt.y, check.y)
      return { passed: ok, detail: `${check.label}=(${pt.x},${pt.y}) vs (${check.x},${check.y})` }
    }
    case "point-y-2d": {
      const pt = p2(check.label)
      if (!pt) return { passed: false, detail: `missing 2d point ${check.label}` }
      return { passed: near(pt.y, check.y, 1e-2), detail: `${check.label}.y=${pt.y} vs ${check.y}` }
    }
    case "point-x-2d": {
      const pt = p2(check.label)
      if (!pt) return { passed: false, detail: `missing 2d point ${check.label}` }
      return { passed: near(pt.x, check.x, 1e-2), detail: `${check.label}.x=${pt.x} vs ${check.x}` }
    }
    case "point-on-ellipse-2d": {
      const pt = p2(check.label)
      if (!pt) return { passed: false, detail: `missing 2d point ${check.label}` }
      const lhs = ((pt.x - check.cx) / check.rx) ** 2 + ((pt.y - check.cy) / check.ry) ** 2
      return { passed: near(lhs, 1, 1e-2), detail: `ellipse eval(${check.label})=${lhs} vs 1` }
    }
    case "point-on-conic-2d": {
      const pt = p2(check.label)
      if (!pt) return { passed: false, detail: `missing 2d point ${check.label}` }
      const residual = conicResidual2d(check.conic, pt)
      const ok = residual !== null && Number.isFinite(residual) && residual <= 1e-2
      return { passed: ok, detail: `${check.label} conic residual=${residual}` }
    }
    case "conic-domain-2d": {
      const curve = uniqueEntity(prims, check.conicId, check.conic.kind)
      if (!curve || !conicParametersMatch(curve, check.conic)) return { passed: false, detail: `missing, ambiguous or mismatched conic ${check.conicId}` }
      if (!Array.isArray(curve.excludedPoints) || curve.excludedPoints.length !== check.excludePoints.length) {
        return { passed: false, detail: `conic ${check.conicId} must explicitly exclude ${check.excludePoints.length} points` }
      }
      const declared = curve.excludedPoints as { x?: unknown; y?: unknown }[]
      const valid = check.excludePoints.every((expected) => declared.some((actual) =>
        typeof actual.x === "number" && typeof actual.y === "number" && near(actual.x, expected.x, 1e-6) && near(actual.y, expected.y, 1e-6) &&
        (conicResidual2d(check.conic, expected) ?? Number.POSITIVE_INFINITY) <= 1e-2
      )) && declared.every((point) =>
        typeof point.x === "number" && typeof point.y === "number" &&
        (conicResidual2d(check.conic, { x: point.x, y: point.y }) ?? Number.POSITIVE_INFINITY) <= 1e-2
      )
      return { passed: valid, detail: valid ? `conic ${check.conicId} exclusions verified` : `invalid exclusions for ${check.conicId}` }
    }
    case "conic-2d": {
      const spec: ConicSpec2D = check.curveType === "ellipse"
        ? { kind: "ellipse", cx: check.cx, cy: check.cy, rx: check.rx, ry: check.ry }
        : check.curveType === "circle"
          ? { kind: "circle", cx: check.cx, cy: check.cy, radius: check.radius }
          : check.curveType === "hyperbola"
            ? { kind: "hyperbola", cx: check.cx, cy: check.cy, axis: check.axis, rx: check.rx, ry: check.ry }
            : { kind: "parabola", vx: check.vx, vy: check.vy, axis: check.axis, focalParameter: check.focalParameter }
      const candidates = prims.filter((primitive) => primitive.type === check.curveType &&
        (check.entityId === undefined || primitive.id === check.entityId || primitive.label === check.entityId))
      const bound = check.entityId === undefined || candidates.length === 1
      const ok = bound && candidates.some((primitive) => conicParametersMatch(primitive, spec))
      return { passed: ok, detail: ok ? `${check.curveType} ${check.entityId ?? "candidate"} matches` : `missing, ambiguous or mismatched ${check.curveType} ${check.entityId ?? "candidate"}` }
    }
    case "horizontal-2d": {
      const a = p2(check.a), b = p2(check.b)
      if (!a || !b) return { passed: false, detail: `missing points for horizontal line ${check.a}${check.b}` }
      const ok = Math.abs(a.y - b.y) <= 1e-2 && Math.abs(a.x - b.x) > 1e-9
      return { passed: ok, detail: `horizontal dy=${Math.abs(a.y - b.y)}, dx=${Math.abs(a.x - b.x)}` }
    }
    case "vertical-2d": {
      const a = p2(check.a), b = p2(check.b)
      if (!a || !b) return { passed: false, detail: `missing points for vertical line ${check.a}${check.b}` }
      const ok = Math.abs(a.x - b.x) <= 1e-2 && Math.abs(a.y - b.y) > 1e-9
      return { passed: ok, detail: `vertical dx=${Math.abs(a.x - b.x)}, dy=${Math.abs(a.y - b.y)}` }
    }
    case "point-on-segment-2d": {
      const p = p2(check.p), a = p2(check.a), b = p2(check.b)
      if (!p || !a || !b) return { passed: false, detail: `missing 2d points for segment ${check.a}${check.b}` }
      const dx = b.x - a.x, dy = b.y - a.y, lengthSquared = dx * dx + dy * dy
      if (lengthSquared <= 1e-18) return { passed: false, detail: `degenerate segment ${check.a}${check.b}` }
      const length = Math.sqrt(lengthSquared)
      const distance = Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / length
      const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared
      const ok = distance <= 1e-2 * Math.max(1, length) && t >= -1e-3 && t <= 1 + 1e-3
      return { passed: ok, detail: `segment distance=${distance}, parameter=${t}` }
    }
    case "point-on-line-2d": {
      const point = p2(check.point), line = uniqueEntity(prims, check.lineId, "line")
      if (!point || !line) return { passed: false, detail: `missing point ${check.point} or line ${check.lineId}` }
      const a = line.a as Vec2 | undefined, b = line.b as Vec2 | undefined
      if (!a || !b) return { passed: false, detail: `line ${check.lineId} has invalid endpoints` }
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy)
      if (length <= 1e-9) return { passed: false, detail: `degenerate line ${check.lineId}` }
      const distance = Math.abs(dx * (point.y - a.y) - dy * (point.x - a.x)) / length
      return { passed: distance <= 1e-2, detail: `${check.point} to ${check.lineId} distance=${distance}` }
    }
    case "line-equation-2d": {
      const line = uniqueEntity(prims, check.entityId, "line")
      if (!line) return { passed: false, detail: `missing or ambiguous line entity ${check.entityId}` }
      const start = line.a as Vec2 | undefined, end = line.b as Vec2 | undefined
      if (!start || !end) return { passed: false, detail: `line ${check.entityId} has invalid endpoints` }
      const actual = { a: end.y - start.y, b: start.x - end.x, c: (end.x - start.x) * start.y - (end.y - start.y) * start.x }
      const actualNorm = Math.hypot(actual.a, actual.b), expectedNorm = Math.hypot(check.a, check.b)
      if (actualNorm <= 1e-12 || expectedNorm <= 1e-12) return { passed: false, detail: `degenerate line equation for ${check.entityId}` }
      const sign = actual.a * check.a + actual.b * check.b < 0 ? -1 : 1
      const error = Math.max(
        Math.abs(actual.a / actualNorm - sign * check.a / expectedNorm),
        Math.abs(actual.b / actualNorm - sign * check.b / expectedNorm),
        Math.abs(actual.c / actualNorm - sign * check.c / expectedNorm)
      )
      return { passed: error <= 1e-6, detail: `${check.entityId} normalized equation error=${error}` }
    }
    case "line-through-2d": {
      const line = uniqueEntity(prims, check.entityId, "line")
      if (!line) return { passed: false, detail: `missing or ambiguous line entity ${check.entityId}` }
      const a = line.a as Vec2 | undefined, b = line.b as Vec2 | undefined
      if (!a || !b) return { passed: false, detail: `line ${check.entityId} has invalid endpoints` }
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy)
      const ok = len > 1e-9 && Math.abs(dx * (check.y - a.y) - dy * (check.x - a.x)) / len <= 1e-2
      return { passed: ok, detail: ok ? `line ${check.entityId} passes point` : `line ${check.entityId} does not pass (${check.x},${check.y})` }
    }
    case "tangent-to-function-2d": {
      const fn = uniqueEntity(prims, check.functionId, "function"), line = uniqueEntity(prims, check.lineId, "line")
      if (!fn || typeof fn.expression !== "string" || !line) return { passed: false, detail: `missing function ${check.functionId} or line ${check.lineId}` }
      const base = evaluateFunctionWithDomain(fn.expression, check.x)
      if (!base.ok) return { passed: false, detail: `function domain error: ${base.error}` }
      const derivative = evaluateSymbolicDerivative(fn.expression, check.x)
      if (!derivative.ok) return { passed: false, detail: `function derivative error: ${derivative.reason}` }
      const start = line.a as Vec2 | undefined, end = line.b as Vec2 | undefined
      if (!start || !end) return { passed: false, detail: `line ${check.lineId} has invalid endpoints` }
      if (Math.hypot(end.x - start.x, end.y - start.y) <= 1e-9) return { passed: false, detail: `degenerate function tangent ${check.lineId}` }
      const slope = derivative.value
      const error = (point: Vec2) => Math.abs(slope * (point.x - check.x) - (point.y - base.value)) / Math.hypot(slope, 1)
      const residual = Math.max(error(start), error(end))
      return { passed: residual <= 1e-2, detail: `function tangent residual=${residual}, derivative=${slope}` }
    }
    case "tangent-to-conic-2d": {
      const curve = uniqueConic(prims, check.conicId), line = uniqueEntity(prims, check.lineId, "line")
      if (!curve || !line) return { passed: false, detail: `missing conic ${check.conicId} or line ${check.lineId}` }
      const start = line.a as Vec2 | undefined, end = line.b as Vec2 | undefined
      if (!start || !end) return { passed: false, detail: `line ${check.lineId} has invalid endpoints` }
      const result = intersectPlanarLineAndConicExact({ type: "line", a: start, b: end } as never, curve as never)
      const touchMatches = check.touchPoint === undefined || result.points.some((point) => near(point.x, check.touchPoint!.x, 1e-5) && near(point.y, check.touchPoint!.y, 1e-5))
      const labelledTouch = check.touchPointLabel === undefined ? undefined : p2(check.touchPointLabel)
      const labelMatches = check.touchPointLabel === undefined || (labelledTouch !== undefined && result.points.some((point) => near(point.x, labelledTouch.x, 1e-5) && near(point.y, labelledTouch.y, 1e-5)))
      const ok = result.kind === "tangent" && touchMatches && labelMatches
      return { passed: ok, detail: `conic intersection=${result.kind}, points=${result.points.length}` }
    }
    case "line-vertical-2d": {
      const line = uniqueEntity(prims, check.entityId, "line")
      if (!line) return { passed: false, detail: `missing or ambiguous line entity ${check.entityId}` }
      const a = line.a as Vec2 | undefined, b = line.b as Vec2 | undefined
      const ok = !!a && !!b && near(a.x, check.x, 1e-2) && near(b.x, check.x, 1e-2)
      return { passed: ok, detail: ok ? `line ${check.entityId} is x=${check.x}` : `line ${check.entityId} is not x=${check.x}` }
    }
    case "collinear-2d": {
      const a = p2(check.a), b = p2(check.b), c = p2(check.c)
      if (!a || !b || !c) return { passed: false, detail: `missing 2d point for collinearity` }
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len <= 1e-9) return { passed: false, detail: `degenerate collinearity base ${check.a}${check.b}` }
      const dist = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / len
      return { passed: dist <= 1e-2, detail: `collinear distance=${dist}` }
    }
    case "distinct-2d": {
      const a = p2(check.a), b = p2(check.b)
      if (!a || !b) return { passed: false, detail: `missing points for distinctness ${check.a}/${check.b}` }
      const distance = Math.hypot(a.x - b.x, a.y - b.y)
      return { passed: distance > 1e-6, detail: `point distance=${distance}` }
    }
    case "vector-ratio-2d": {
      const a = p2(check.a), b = p2(check.b), c = p2(check.c), d = p2(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 2d points for vector ratio ${check.a}${check.b}=${check.k}${check.c}${check.d}` }
      const lhsX = b.x - a.x, lhsY = b.y - a.y
      const rhsX = check.k * (d.x - c.x), rhsY = check.k * (d.y - c.y)
      const cdLen = Math.hypot(d.x - c.x, d.y - c.y)
      const err = Math.hypot(lhsX - rhsX, lhsY - rhsY)
      const ok = cdLen > 1e-6 && err <= 1e-2 * Math.max(1, cdLen)
      return { passed: ok, detail: `vector ratio error=${err} (cdLen=${cdLen})` }
    }
    case "distance-2d": {
      const a = p2(check.a), b = p2(check.b)
      if (!a || !b) return { passed: false, detail: `missing 2d point for distance` }
      const d = Math.hypot(b.x - a.x, b.y - a.y)
      return { passed: near(d, check.value, 1e-2), detail: `|${check.a}${check.b}|=${d} vs ${check.value}` }
    }
    case "secant-ratio-2d": {
      const m = p2(check.m), p = p2(check.p), q = p2(check.q), a = p2(check.a), b = p2(check.b)
      if (!m || !p || !q || !a || !b) return { passed: false, detail: "missing 2d points for secant ratio" }
      const denominator = Math.hypot(b.x - a.x, b.y - a.y)
      if (denominator <= 1e-9) return { passed: false, detail: "degenerate secant denominator" }
      const value = Math.hypot(p.x - m.x, p.y - m.y) * Math.hypot(q.x - m.x, q.y - m.y) / denominator
      return { passed: near(value, check.value, 1e-2), detail: `secant ratio=${value} vs ${check.value}` }
    }
    case "perp-2d": {
      const a = p2(check.a), b = p2(check.b), c = p2(check.c), d = p2(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 2d points for perpendicularity` }
      const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - c.x, vy = d.y - c.y
      const scale = Math.hypot(ux, uy) * Math.hypot(vx, vy)
      const err = scale > 1e-9 ? Math.abs(ux * vx + uy * vy) / scale : Number.POSITIVE_INFINITY
      return { passed: err <= 1e-2, detail: `2d perp err=${err}` }
    }
    case "parallel-2d": {
      const a = p2(check.a), b = p2(check.b), c = p2(check.c), d = p2(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 2d points for parallel lines` }
      const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - c.x, vy = d.y - c.y
      const scale = Math.hypot(ux, uy) * Math.hypot(vx, vy)
      const err = scale > 1e-9 ? Math.abs(ux * vy - uy * vx) / scale : Number.POSITIVE_INFINITY
      return { passed: err <= 1e-2, detail: `2d parallel sine error=${err}` }
    }
    case "triangle-area-2d": {
      const a = p2(check.a), b = p2(check.b), c = p2(check.c)
      if (!a || !b || !c) return { passed: false, detail: `missing 2d points for triangle area` }
      const area = 0.5 * Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
      return { passed: near(area, check.value, 1e-2), detail: `area=${area} vs ${check.value}` }
    }
    case "quadrilateral-area-2d": {
      const points = check.points.map(p2)
      if (points.some((point) => point === undefined)) return { passed: false, detail: `missing 2d points for quadrilateral ${check.points.join(",")}` }
      const area = Math.abs(points.reduce((sum, point, index) => {
        const next = points[(index + 1) % points.length]!
        return sum + point!.x * next.y - next.x * point!.y
      }, 0)) / 2
      return { passed: near(area, check.value, 1e-2), detail: `quadrilateral area=${area} vs ${check.value}` }
    }
    case "dot-2d": {
      const a = p2(check.a), b = p2(check.b), c = p2(check.c), d = p2(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 2d points for dot` }
      const v = (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y)
      return { passed: near(v, check.value, 1e-2), detail: `dot=${v} vs ${check.value}` }
    }
    case "parabola-circle-max-area-2d": {
      const curve = uniqueConic(prims, check.parabolaId), circle = uniqueConic(prims, check.circleId)
      const p = p2(check.p), a = p2(check.a), b = p2(check.b)
      const shapeMatches = curve?.type === "parabola" && curve.axis === "y" && curve.focalParameter === 2 && (curve.rotation ?? 0) === 0 &&
        finitePoint2(curve.vertex) && curve.vertex.x === 0 && curve.vertex.y === 0 && circle?.type === "circle" && circle.radius === 1 && (circle.rotation ?? 0) === 0 &&
        finitePoint2(circle.center) && circle.center.x === 0 && circle.center.y === -4
      if (!shapeMatches || !p || !a || !b) return { passed: false, detail: "missing or mismatched parabola, circle or tangent points" }
      const q = p.x * p.x - 4 * p.y
      const area = q > 0 ? 0.5 * q ** 1.5 : Number.NaN
      const actualArea = Math.abs((a.x - p.x) * (b.y - p.y) - (a.y - p.y) * (b.x - p.x)) / 2
      const geometryMatches = near(p.x * p.x + (p.y + 4) ** 2, 1, 1e-6) && near(a.y, a.x * a.x / 4, 1e-6) && near(b.y, b.x * b.x / 4, 1e-6) &&
        near(p.x, (a.x + b.x) / 2, 1e-6) && near(p.y, a.x * b.x / 4, 1e-6) && Math.hypot(a.x - b.x, a.y - b.y) > 1e-9
      const passed = geometryMatches && near(area, actualArea, 1e-6) && near(actualArea, check.value, 1e-6) &&
        near(check.value, 20 * Math.sqrt(5), 1e-9) && near(p.x, check.optimum.x, 1e-6) && near(p.y, check.optimum.y, 1e-6)
      return { passed, detail: `area=${actualArea}; on the circle q=x²-4y=21-(y+6)², y∈[-5,-3] is decreasing, maximum 20√5 at (0,-5)` }
    }
    case "parabola-secant-min-distance-2d": {
      const curve = uniqueConic(prims, check.parabolaId)
      const origin = p2(check.o), a = p2(check.a), b = p2(check.b), d = p2(check.d), e = p2(check.e)
      const chord = uniqueEntity(prims, check.chordId, "line"), line = uniqueEntity(prims, check.lineId, "line")
      const shapeMatches = curve?.type === "parabola" && curve.axis === "x" && curve.focalParameter === 2 && (curve.rotation ?? 0) === 0 &&
        finitePoint2(curve.vertex) && curve.vertex.x === 0 && curve.vertex.y === 0
      if (!shapeMatches || !origin || !a || !b || !d || !e || !chord || !line || !finitePoint2(chord.a) || !finitePoint2(chord.b) || !finitePoint2(line.a) || !finitePoint2(line.b)) {
        return { passed: false, detail: "missing or mismatched parabola, secants, target line or named points" }
      }
      const u = a.y / 2, v = b.y / 2, sum = u + v
      if (Math.abs(2 - u) <= 1e-12 || Math.abs(2 - v) <= 1e-12) return { passed: false, detail: "OA/OB is parallel to l and has no finite D/E intersection" }
      const expectedD = { x: u / (2 - u), y: 2 / (2 - u) }, expectedE = { x: v / (2 - v), y: 2 / (2 - v) }
      const geometryMatches = near(origin.x, 0, 1e-6) && near(origin.y, 0, 1e-6) && near(a.x, u * u, 1e-6) && near(b.x, v * v, 1e-6) &&
        near(u * v, -2, 1e-6) && Math.hypot(a.x - b.x, a.y - b.y) > 1e-9 && distancePointToLine2({ x: 2, y: 0 }, chord.a, chord.b) <= 1e-6 &&
        distancePointToLine2(a, chord.a, chord.b) <= 1e-6 && distancePointToLine2(b, chord.a, chord.b) <= 1e-6 &&
        near(line.a.y - line.a.x, 1, 1e-6) && near(line.b.y - line.b.x, 1, 1e-6) &&
        near(d.x, expectedD.x, 1e-6) && near(d.y, expectedD.y, 1e-6) && near(e.x, expectedE.x, 1e-6) && near(e.y, expectedE.y, 1e-6)
      const distance = Math.hypot(d.x - e.x, d.y - e.y)
      const distanceSquared = 2 * (sum * sum + 8) / (sum - 1) ** 2
      const passed = geometryMatches && near(distance * distance, distanceSquared, 1e-6) && near(distance, check.value, 1e-6) &&
        near(check.value, 4 / 3, 1e-9) && check.parameterSum === -8 && near(sum, check.parameterSum, 1e-6)
      return { passed, detail: `parameter sum=${sum}, |DE|²=${distanceSquared}; |DE|²-16/9=2(s+8)²/(9(s-1)²)≥0, minimum 4/3 at s=-8` }
    }
    case "ellipse-secant-min-dot-2d": {
      const curve = uniqueConic(prims, check.ellipseId)
      const b = p2(check.b), p = p2(check.p), q = p2(check.q), e = p2(check.e), f = p2(check.f)
      const line = uniqueEntity(prims, check.lineId, "line")
      const shapeMatches = curve?.type === "ellipse" && curve.radiusX === 2 && curve.radiusY === 1 && (curve.rotation ?? 0) === 0 && finitePoint2(curve.center) && curve.center.x === 0 && curve.center.y === 0
      if (!shapeMatches || !b || !p || !q || !e || !f || !line || !finitePoint2(line.a) || !finitePoint2(line.b)) return { passed: false, detail: "missing or mismatched ellipse, secant or named points" }
      if (Math.abs(p.x - 2) <= 1e-12 || Math.abs(q.x - 2) <= 1e-12) return { passed: false, detail: "BP/BQ is undefined at B" }
      const geometryMatches = near(b.x, 2, 1e-6) && near(b.y, 0, 1e-6) && near(p.x * p.x / 4 + p.y * p.y, 1, 1e-6) && near(q.x * q.x / 4 + q.y * q.y, 1, 1e-6) &&
        Math.hypot(p.x - q.x, p.y - q.y) > 1e-9 && distancePointToLine2({ x: 1, y: 0 }, line.a, line.b) <= 1e-6 &&
        distancePointToLine2(p, line.a, line.b) <= 1e-6 && distancePointToLine2(q, line.a, line.b) <= 1e-6 &&
        near(e.x, 3, 1e-6) && near(e.y, p.y / (p.x - 2), 1e-6) && near(f.x, 3, 1e-6) && near(f.y, q.y / (q.x - 2), 1e-6)
      const dot = (e.x - p.x) * (f.x - q.x) + (e.y - p.y) * (f.y - q.y)
      const vertical = near(p.x, 1, 1e-6) && near(q.x, 1, 1e-6) && near(line.a.x, 1, 1e-6) && near(line.b.x, 1, 1e-6)
      const passed = geometryMatches && vertical && near(dot, check.value, 1e-6) && check.value === 1
      return { passed, detail: `PE·QF=${dot}; finite-slope chords give 1+1/(16k²+4)>1, vertical x=1 gives the minimum 1` }
    }
    case "function-sample-2d": {
      const fn = uniqueEntity(prims, check.entityId, "function")
      if (!fn || typeof fn.expression !== "string") return { passed: false, detail: `missing or ambiguous function entity ${check.entityId}` }
      try {
        const val = evaluateExpression(compileExpression(fn.expression), { x: check.x })
        return { passed: near(val, check.value, 1e-2), detail: `${check.entityId}(${check.x})=${val} vs ${check.value}` }
      } catch {
        return { passed: false, detail: `${check.entityId} cannot be evaluated at x=${check.x}` }
      }
    }
    case "function-expression-2d": {
      const fn = uniqueEntity(prims, check.functionId, "function")
      if (!fn || typeof fn.expression !== "string") return { passed: false, detail: `missing or ambiguous function entity ${check.functionId}` }
      try {
        const actual = polynomialOf(compileExpression(fn.expression))
        const expected = polynomialOf(compileExpression(check.expression))
        const passed = actual !== null && expected !== null && actual.length === expected.length && actual.every((value, index) => value === expected[index])
        return { passed, detail: passed ? `${check.functionId} matches the required polynomial identity` : `${check.functionId} polynomial coefficients ${JSON.stringify(actual)} vs ${JSON.stringify(expected)}` }
      } catch {
        return { passed: false, detail: `${check.functionId} expression cannot be compared as a polynomial identity` }
      }
    }
    case "quadratic-with-constant-2d": {
      const fn = uniqueEntity(prims, check.functionId, "function")
      if (!fn || typeof fn.expression !== "string") return { passed: false, detail: `missing or ambiguous function entity ${check.functionId}` }
      try {
        const coefficients = polynomialOf(compileExpression(fn.expression))
        const passed = coefficients !== null && coefficients.length === 3 && coefficients[1] === 0 && coefficients[2] === 1 &&
          Number.isFinite(coefficients[0]) && Number.isFinite(check.minimumConstant) && coefficients[0] >= check.minimumConstant
        return { passed, detail: `${check.functionId} coefficients=${JSON.stringify(coefficients)}, required constant >= ${check.minimumConstant}` }
      } catch {
        return { passed: false, detail: `${check.functionId} is not a supported quadratic expression` }
      }
    }
    case "common-tangent-range-2d": {
      const cubic = uniqueEntity(prims, check.cubicFunctionId, "function")
      const quadratic = uniqueEntity(prims, check.functionId, "function")
      if (!cubic || typeof cubic.expression !== "string" || !quadratic || typeof quadratic.expression !== "string") {
        return { passed: false, detail: `missing or ambiguous common-tangent function entities` }
      }
      try {
        const cubicCoefficients = polynomialOf(compileExpression(cubic.expression))
        const quadraticCoefficients = polynomialOf(compileExpression(quadratic.expression))
        const cubicMatches = cubicCoefficients?.length === 4 && cubicCoefficients.every((value, index) => value === [0, -1, 0, 1][index])
        const a = quadraticCoefficients?.length === 3 && quadraticCoefficients[1] === 0 && quadraticCoefficients[2] === 1 ? quadraticCoefficients[0] : null
        const passed = cubicMatches && a !== null && Number.isFinite(a) && check.minimumConstant === -1 && a >= check.minimumConstant
        return { passed, detail: `common-tangent cubic=${JSON.stringify(cubicCoefficients)}, a=${a}, proven range=[-1,+∞)` }
      } catch {
        return { passed: false, detail: `common-tangent functions are not supported polynomial expressions` }
      }
    }
    case "infeasible-branch": {
      const explicitFlag = options.infeasibleDiagnosedSubquestions?.includes(check.subquestion) === true
      const textDiagnosed = check.evidence === undefined && typeof options.answerText === "string" && /无解|不存在|不成立|矛盾|不可行|infeasible/i.test(options.answerText)
      const fabricatedEntity = check.forbiddenEntityIds.find((label) => {
        const key = normalizeLabel(label)
        return pts2.has(key) || pts3.has(key) || allLabels.has(key)
      })
      const evidence = check.evidence === undefined ? { passed: true, detail: "legacy disclosure without specialized evidence" } : evaluateInfeasibleEvidence(check.evidence, prims, pts2, pts3)
      const diagnosed = check.evidence === undefined ? explicitFlag || textDiagnosed : explicitFlag
      const ok = diagnosed && fabricatedEntity === undefined && evidence.passed
      return {
        passed: ok,
        detail: ok
          ? `subquestion ${check.subquestion} infeasibility disclosed with scoped evidence`
          : fabricatedEntity !== undefined
            ? `infeasible branch ${check.subquestion} contains forbidden entity ${fabricatedEntity}`
            : !evidence.passed
              ? `infeasible branch ${check.subquestion} evidence failed: ${evidence.detail}`
              : `infeasible branch ${check.subquestion} not disclosed in its structured scope`
      }
    }
    default:
      return { passed: false, detail: "unsupported contract check" }
  }
}

export function evaluateDrawingContract(
  contract: DrawingContractCase,
  candidate: unknown,
  options: ContractEvaluationOptions = {}
): ContractEvaluationResult {
  if (options.incomplete === true) {
    return {
      id: contract.id,
      passed: false,
      partial: false,
      status: "incomplete",
      bucket: "incomplete",
      objectCoverage: 0,
      obligationCoverage: 0,
      presentEntityIds: [],
      missingEntityIds: [...contract.requiredEntityIds],
      passedObligationIds: [],
      failedObligationIds: contract.requiredObligations.map((ob) => ob.id),
      obligationResults: []
    }
  }

  const prims = collectPrimitives(candidate)
  const pts3 = points3Of(prims)
  const pts2 = points2Of(prims)
  const allLabels = labelsOf(prims)

  const presentEntityIds: string[] = []
  const missingEntityIds: string[] = []
  for (const id of contract.requiredEntityIds) {
    const key = normalizeLabel(id)
    if (pts3.has(key) || pts2.has(key) || allLabels.has(key)) presentEntityIds.push(id)
    else missingEntityIds.push(id)
  }

  const objectCoverage = contract.requiredEntityIds.length === 0 ? 1 : presentEntityIds.length / contract.requiredEntityIds.length

  const inheritedScopeIds = new Set<string>(["stem"])
  const inheritScope = (scopeId: string) => {
    if (inheritedScopeIds.has(scopeId)) return
    inheritedScopeIds.add(scopeId)
    const subquestion = contract.subquestions.find((item) => item.id === scopeId)
    for (const dependency of subquestion?.dependsOn ?? []) inheritScope(dependency)
  }
  if (options.scopeId !== undefined) inheritScope(options.scopeId)
  const scopedObligations = contract.requiredObligations.filter((ob) =>
    (options.scopeId === undefined || inheritedScopeIds.has(ob.scope)) &&
    (options.branchId === undefined || ob.branchId === undefined || ob.branchId === options.branchId) &&
    (options.stateId === undefined || ob.stateId === undefined || ob.stateId === options.stateId)
  )
  const obligationResults: ObligationEvaluation[] = scopedObligations.map((ob) => {
    const outcome = evaluateCheck(ob.check, prims, pts3, pts2, allLabels, options)
    return { id: ob.id, kind: ob.kind, passed: outcome.passed, detail: outcome.detail }
  })

  const passedObligationIds = obligationResults.filter((r) => r.passed).map((r) => r.id)
  const failedObligationIds = obligationResults.filter((r) => !r.passed).map((r) => r.id)
  const obligationCoverage = obligationResults.length === 0 ? 1 : passedObligationIds.length / obligationResults.length

  const verificationOk = contract.requireVerification === undefined || options.verificationStatus === contract.requireVerification
  const passed = missingEntityIds.length === 0 && failedObligationIds.length === 0 && verificationOk
  const partial = !passed && (passedObligationIds.length > 0 || presentEntityIds.length > 0) && prims.length > 0

  let bucket: FailureBucket | null = null
  if (!passed) {
    if (options.terminal === "waiting" || options.error?.includes("clarif")) bucket = "interaction"
    else if (prims.length === 0) bucket = "math"
    else if (missingEntityIds.length > 0 && failedObligationIds.length === 0) bucket = "visual"
    else if (partial) bucket = "partial"
    else if (failedObligationIds.length > 0) bucket = "math"
    else bucket = "unknown"
  }

  return {
    id: contract.id,
    passed,
    partial,
    status: passed ? "passed" : partial ? "partial" : "failed",
    bucket,
    objectCoverage,
    obligationCoverage,
    presentEntityIds,
    missingEntityIds,
    passedObligationIds,
    failedObligationIds,
    obligationResults
  }
}

export interface ContractStateEvaluationResult extends ContractScopeEvaluationResult {
  lineageResult: ContractEvaluationResult | null
}

export function evaluateDrawingContractStates(
  contract: DrawingContractCase,
  inputs: Readonly<Record<string, { candidate: unknown; options?: ContractEvaluationOptions }>>
): ContractStateEvaluationResult {
  const policy = contract.displayPolicy.multiStateHandling
  const enumerated = policy?.startsWith("enumerate:")
    ? policy.slice("enumerate:".length).split(",").map((stateId) => stateId.trim()).filter(Boolean)
    : Object.keys(inputs)
  const missingScopeIds = enumerated.filter((stateId) => inputs[stateId] === undefined)
  const stateCandidates = Object.fromEntries(Object.entries(inputs).map(([stateId, input]) => [stateId, input.candidate]))
  const stateResults: Record<string, ContractEvaluationResult> = {}
  for (const stateId of enumerated) {
    const input = inputs[stateId]
    if (input === undefined) continue
    stateResults[stateId] = evaluateDrawingContract(contract, input.candidate, { ...input.options, stateId, stateCandidates })
  }
  const foldObligations = contract.requiredObligations.filter((obligation) => obligation.check.kind === "fold-transform-3d")
  const lineageResult = foldObligations.length > 0
    ? evaluateDrawingContract(
        { ...contract, requiredObligations: foldObligations },
        Object.values(inputs)[0]?.candidate,
        { ...Object.values(inputs)[0]?.options, scopeId: "fold_lineage", stateCandidates }
      )
    : null
  const passed = missingScopeIds.length === 0 && enumerated.length > 0 && enumerated.every((stateId) => stateResults[stateId]?.passed === true) && (lineageResult?.passed ?? true)
  const partial = !passed && (Object.values(stateResults).some((result) => result.partial) || lineageResult?.partial === true)
  return {
    passed,
    status: passed ? "passed" : missingScopeIds.length > 0 ? "incomplete" : partial ? "partial" : "failed",
    missingScopeIds,
    scopeResults: stateResults,
    lineageResult
  }
}

export function evaluateDrawingContractBranches(
  contract: DrawingContractCase,
  scopeId: string,
  inputs: Readonly<Record<string, { candidate: unknown; options?: ContractEvaluationOptions }>>
): ContractScopeEvaluationResult {
  const enumerated = contract.displayPolicy.multiBranchHandling.startsWith("enumerate:")
    ? contract.displayPolicy.multiBranchHandling.slice("enumerate:".length).split(",").map((branchId) => branchId.trim()).filter(Boolean)
    : Object.keys(inputs)
  const missingScopeIds = enumerated.filter((branchId) => inputs[branchId] === undefined)
  const scopeResults: Record<string, ContractEvaluationResult> = {}
  for (const branchId of enumerated) {
    const input = inputs[branchId]
    if (input === undefined) continue
    scopeResults[branchId] = evaluateDrawingContract(contract, input.candidate, { ...input.options, scopeId, branchId })
  }
  const passed = missingScopeIds.length === 0 && enumerated.length > 0 && enumerated.every((branchId) => scopeResults[branchId]?.passed === true)
  const partial = !passed && Object.values(scopeResults).some((result) => result.passed || result.partial)
  return {
    passed,
    status: passed ? "passed" : missingScopeIds.length > 0 ? "incomplete" : partial ? "partial" : "failed",
    missingScopeIds,
    scopeResults
  }
}

export function evaluateDrawingContractScopes(
  contract: DrawingContractCase,
  inputs: Readonly<Record<string, { candidate: unknown; options?: ContractEvaluationOptions }>>
): ContractScopeEvaluationResult {
  const requiredScopeIds = contract.subquestions.map((subquestion) => subquestion.id)
  const missingScopeIds = requiredScopeIds.filter((scopeId) => inputs[scopeId] === undefined)
  const scopeResults: Record<string, ContractEvaluationResult> = {}
  for (const scopeId of requiredScopeIds) {
    const input = inputs[scopeId]
    if (input === undefined) continue
    scopeResults[scopeId] = evaluateDrawingContract(contract, input.candidate, { ...input.options, scopeId })
  }
  const passed = missingScopeIds.length === 0 && requiredScopeIds.every((scopeId) => scopeResults[scopeId]?.passed === true)
  const partial = !passed && Object.values(scopeResults).some((result) => result.passed || result.partial)
  return {
    passed,
    status: passed ? "passed" : missingScopeIds.length > 0 ? "incomplete" : partial ? "partial" : "failed",
    missingScopeIds,
    scopeResults
  }
}

export function summarizeContractReports(suite: ContractSuiteFile, items: readonly UnifiedCaseMetrics[]): UnifiedContractSummary {
  const byId = new Map(items.map((item) => [item.id, item]))
  const buckets: Record<FailureBucket, number> = {
    math: 0,
    visual: 0,
    interaction: 0,
    partial: 0,
    unknown: 0,
    incomplete: 0
  }

  let passed = 0
  let partial = 0
  let failed = 0
  let incomplete = 0
  let objectCoverageSum = 0
  let obligationCoverageSum = 0
  let requests = 0
  let inputTokens = 0
  let outputTokens = 0
  const incompleteCaseIds: string[] = []
  const caseStatuses: UnifiedContractSummary["caseStatuses"] = []

  for (const contract of suite.cases) {
    const item = byId.get(contract.id)
    if (!item || item.status === "incomplete" || item.bucket === "incomplete") {
      incomplete += 1
      buckets.incomplete += 1
      incompleteCaseIds.push(contract.id)
      caseStatuses.push({ id: contract.id, status: "incomplete", bucket: "incomplete", objectCoverage: 0, obligationCoverage: 0 })
      continue
    }

    requests += item.requests
    inputTokens += item.tokens.input
    outputTokens += item.tokens.output
    objectCoverageSum += item.objectCoverage
    obligationCoverageSum += item.obligationCoverage

    if (item.passed) {
      passed += 1
      caseStatuses.push({ id: contract.id, status: "passed", bucket: null, objectCoverage: item.objectCoverage, obligationCoverage: item.obligationCoverage })
    } else {
      if (item.partial || item.status === "partial") partial += 1
      else failed += 1
      const bucket = item.bucket ?? (item.partial ? "partial" : "unknown")
      buckets[bucket] += 1
      caseStatuses.push({ id: contract.id, status: item.partial ? "partial" : "failed", bucket, objectCoverage: item.objectCoverage, obligationCoverage: item.obligationCoverage })
    }
  }

  return {
    schemaVersion: "reliability-contract-summary.v1",
    suite: suite.suite,
    denominator: suite.denominator,
    totals: { passed, partial, failed, incomplete },
    buckets,
    meanObjectCoverage: suite.denominator === 0 ? 0 : objectCoverageSum / suite.denominator,
    meanObligationCoverage: suite.denominator === 0 ? 0 : obligationCoverageSum / suite.denominator,
    requests,
    tokens: { input: inputTokens, output: outputTokens },
    costUsd: null,
    costKnown: false,
    incompleteCaseIds,
    caseStatuses
  }
}

export function reconstructBaselineContractSummary(
  suite: ContractSuiteFile,
  artifacts: {
    baselineReport: {
      drawing: {
        revision: string
        actualInputTokens: number
        actualOutputTokens: number
        overall: { previewProduced: number; hostPassed: number; certPassed: null }
        cases: { id: string; hostStatus: string | null; previewProduced: boolean; requests: number; terminal: string; primitiveCount: number }[]
      }
    }
    partialAudit: { id: string; oracle: { grade: string; passed?: number; total?: number } }[]
    triage: { cases: { id: string; allDiagnosticCodes: string[]; observedRejection: string[] }[] }
  }
): BaselineContractSummary {
  const baselineById = new Map(artifacts.baselineReport.drawing.cases.map((c) => [c.id, c]))
  const auditById = new Map(artifacts.partialAudit.map((c) => [c.id, c]))
  const triageById = new Map(artifacts.triage.cases.map((c) => [c.id, c]))

  const items: UnifiedCaseMetrics[] = suite.cases.map((contract) => {
    const base = baselineById.get(contract.id)
    const audit = auditById.get(contract.id)
    const tr = triageById.get(contract.id)
    if (!base) {
      return {
        id: contract.id,
        status: "incomplete",
        bucket: "incomplete",
        passed: false,
        partial: false,
        objectCoverage: 0,
        obligationCoverage: 0,
        requests: 0,
        tokens: { input: 0, output: 0 }
      }
    }
    const hostOk = base.hostStatus === "passed" && base.terminal === "awaiting_confirmation"
    const exactOk = audit?.oracle.grade === "exact"
    // Baseline had partial oracle gaps and zero full certificates; only hostPassed & exact cases count tentatively passed under host+partial check.
    const passed = hostOk && exactOk
    const partial = !passed && (exactOk || audit?.oracle.grade === "partial" || base.previewProduced)
    const hasVisual = tr?.allDiagnosticCodes.some((d) => d.includes("label")) === true && tr.observedRejection.length === 0
    const bucket: FailureBucket | null = passed ? null : partial ? "partial" : hasVisual ? "visual" : base.primitiveCount === 0 ? "math" : "unknown"
    const cov = passed ? 1 : audit?.oracle.total && audit.oracle.total > 0 ? (audit.oracle.passed ?? 0) / audit.oracle.total : base.previewProduced ? 0.5 : 0
    return {
      id: contract.id,
      status: passed ? "passed" : partial ? "partial" : "failed",
      bucket,
      passed,
      partial,
      objectCoverage: cov,
      obligationCoverage: cov,
      requests: base.requests,
      tokens: { input: 0, output: 0 }
    }
  })

  const summary = summarizeContractReports(suite, items)
  summary.tokens = {
    input: artifacts.baselineReport.drawing.actualInputTokens,
    output: artifacts.baselineReport.drawing.actualOutputTokens
  }
  return {
    ...summary,
    baselineMetrics: {
      revision: artifacts.baselineReport.drawing.revision,
      previewProduced: artifacts.baselineReport.drawing.overall.previewProduced,
      legacyHostPassed: artifacts.baselineReport.drawing.overall.hostPassed,
      certificatePassed: artifacts.baselineReport.drawing.overall.certPassed,
      partialOracleExact: artifacts.partialAudit.filter((a) => a.oracle.grade === "exact").length
    }
  }
}
