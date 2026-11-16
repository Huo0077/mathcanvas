import { compileExpression, evaluateExpression } from "@draw/geometry-kernel"

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
  | { kind: "entity-present"; entityId: string; space: "3d" | "2d" | "any" }
  | { kind: "distance-3d"; a: string; b: string; value: number }
  | { kind: "perp-3d"; a: string; b: string; c: string; d: string }
  | { kind: "parallel-3d"; a: string; b: string; c: string; d: string }
  | { kind: "angle-3d"; a: string; b: string; c: string; d: string; degrees: number }
  | { kind: "ratio-3d"; a: string; b: string; c: string; d: string; value: number }
  | { kind: "point-on-segment-ratio-3d"; p: string; a: string; b: string; t: number }
  | { kind: "vector-equal-3d"; a: string; b: string; c: string; d: string }
  | { kind: "sum-distance-3d"; p: string; a: string; b: string; total: number }
  | { kind: "planes-perpendicular-3d"; first: [string, string, string]; second: [string, string, string] }
  | { kind: "volume-tetrahedron-3d"; p: string; a: string; b: string; c: string; value: number }
  | { kind: "triangle-area-3d"; a: string; b: string; c: string; value: number }
  | { kind: "prism-3d"; hasEqualEdges?: boolean }
  | { kind: "circumsphere-3d" }
  | { kind: "cube-3d"; edgeLength: number }
  | { kind: "hemisphere-3d"; radius: number }
  | { kind: "point-2d"; label: string; x: number; y: number }
  | { kind: "point-y-2d"; label: string; y: number }
  | { kind: "point-on-ellipse-2d"; label: string; cx: number; cy: number; rx: number; ry: number }
  | { kind: "conic-2d"; curveType: "ellipse"; cx: number; cy: number; rx: number; ry: number }
  | { kind: "conic-2d"; curveType: "hyperbola"; cx: number; cy: number; axis: "x" | "y"; rx: number; ry: number }
  | { kind: "conic-2d"; curveType: "parabola"; vx: number; vy: number; axis: "x" | "y"; focalParameter: number }
  | { kind: "conic-2d"; curveType: "circle"; cx: number; cy: number; radius: number }
  | { kind: "line-through-2d"; x: number; y: number }
  | { kind: "line-vertical-2d"; x: number }
  | { kind: "collinear-2d"; a: string; b: string; c: string }
  | { kind: "vector-ratio-2d"; a: string; b: string; c: string; d: string; k: number }
  | { kind: "distance-2d"; a: string; b: string; value: number }
  | { kind: "perp-2d"; a: string; b: string; c: string; d: string }
  | { kind: "triangle-area-2d"; a: string; b: string; c: string; value: number }
  | { kind: "dot-2d"; a: string; b: string; c: string; d: string; value: number }
  | { kind: "function-sample-2d"; x: number; value: number }
  | { kind: "infeasible-branch"; subquestion: string }

export interface ContractObligation {
  id: string
  kind: string
  description: string
  scope: string
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
      const ok = check.space === "3d" ? pts3.has(key) || allLabels.has(key) : check.space === "2d" ? pts2.has(key) || allLabels.has(key) : allLabels.has(key)
      return { passed: ok, detail: ok ? `entity ${check.entityId} present` : `missing entity ${check.entityId}` }
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
    case "prism-3d": {
      const ok = prims.some((p) => p.type === "polyhedron3" || p.type === "face3" || p.type === "prism3")
      return { passed: ok && pts3.size >= 6, detail: ok ? "prism geometry present" : "missing 3d prism primitives" }
    }
    case "circumsphere-3d":
    case "hemisphere-3d": {
      const ok = prims.some((p) => p.type === "sphere3" || p.type === "surface3" || p.type === "hemisphere3")
      return { passed: ok, detail: ok ? "sphere/hemisphere present" : "missing 3d sphere/hemisphere primitive" }
    }
    case "cube-3d": {
      const ok = prims.some((p) => p.type === "polyhedron3" || p.type === "face3") && pts3.size >= 8
      return { passed: ok, detail: ok ? "cube geometry present" : "missing cube vertices/polyhedron" }
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
    case "point-on-ellipse-2d": {
      const pt = p2(check.label)
      if (!pt) return { passed: false, detail: `missing 2d point ${check.label}` }
      const lhs = ((pt.x - check.cx) / check.rx) ** 2 + ((pt.y - check.cy) / check.ry) ** 2
      return { passed: near(lhs, 1, 1e-2), detail: `ellipse eval(${check.label})=${lhs} vs 1` }
    }
    case "conic-2d": {
      if (check.curveType === "ellipse") {
        const ok = prims.some((p) => {
          if (p.type !== "ellipse") return false
          const center = p.center as Vec2 | undefined
          return !!center && near(center.x, check.cx) && near(center.y, check.cy) && near(Number(p.radiusX), check.rx) && near(Number(p.radiusY), check.ry)
        })
        return { passed: ok, detail: ok ? "ellipse matches" : "missing/mismatched ellipse" }
      }
      if (check.curveType === "circle") {
        const ok = prims.some((p) => {
          if (p.type !== "circle") return false
          const center = p.center as Vec2 | undefined
          return !!center && near(center.x, check.cx) && near(center.y, check.cy) && near(Number(p.radius), check.radius)
        })
        return { passed: ok, detail: ok ? "circle matches" : "missing/mismatched circle" }
      }
      if (check.curveType === "hyperbola") {
        const ok = prims.some((p) => {
          if (p.type !== "hyperbola") return false
          const center = p.center as Vec2 | undefined
          return !!center && near(center.x, check.cx) && near(center.y, check.cy) && p.axis === check.axis && near(Number(p.radiusX), check.rx, 1e-2) && near(Number(p.radiusY), check.ry, 1e-2)
        })
        return { passed: ok, detail: ok ? "hyperbola matches" : "missing/mismatched hyperbola" }
      }
      const ok = prims.some((p) => {
        if (p.type !== "parabola") return false
        const v = p.vertex as Vec2 | undefined
        return !!v && near(v.x, check.vx) && near(v.y, check.vy) && p.axis === check.axis && near(Number(p.focalParameter), check.focalParameter, 1e-2)
      })
      return { passed: ok, detail: ok ? "parabola matches" : "missing/mismatched parabola" }
    }
    case "line-through-2d": {
      const lines = prims.filter((p) => p.type === "line")
      const ok = lines.some((l) => {
        const a = l.a as Vec2 | undefined, b = l.b as Vec2 | undefined
        if (!a || !b) return false
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy)
        return len > 1e-9 && Math.abs(dx * (check.y - a.y) - dy * (check.x - a.x)) / len <= 1e-2
      })
      return { passed: ok, detail: ok ? "line passes point" : `no line passing (${check.x},${check.y})` }
    }
    case "line-vertical-2d": {
      const ok = prims.some((p) => {
        if (p.type !== "line") return false
        const a = p.a as Vec2 | undefined, b = p.b as Vec2 | undefined
        return !!a && !!b && near(a.x, check.x, 1e-2) && near(b.x, check.x, 1e-2)
      })
      return { passed: ok, detail: ok ? `line x=${check.x} present` : `missing vertical line x=${check.x}` }
    }
    case "collinear-2d": {
      const a = p2(check.a), b = p2(check.b), c = p2(check.c)
      if (!a || !b || !c) return { passed: false, detail: `missing 2d point for collinearity` }
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len <= 1e-9) return { passed: false, detail: `degenerate collinearity base ${check.a}${check.b}` }
      const dist = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / len
      return { passed: dist <= 1e-2, detail: `collinear distance=${dist}` }
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
    case "perp-2d": {
      const a = p2(check.a), b = p2(check.b), c = p2(check.c), d = p2(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 2d points for perpendicularity` }
      const ux = b.x - a.x, uy = b.y - a.y, vx = d.x - c.x, vy = d.y - c.y
      const scale = Math.hypot(ux, uy) * Math.hypot(vx, vy)
      const err = scale > 1e-9 ? Math.abs(ux * vx + uy * vy) / scale : Number.POSITIVE_INFINITY
      return { passed: err <= 1e-2, detail: `2d perp err=${err}` }
    }
    case "triangle-area-2d": {
      const a = p2(check.a), b = p2(check.b), c = p2(check.c)
      if (!a || !b || !c) return { passed: false, detail: `missing 2d points for triangle area` }
      const area = 0.5 * Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
      return { passed: near(area, check.value, 1e-2), detail: `area=${area} vs ${check.value}` }
    }
    case "dot-2d": {
      const a = p2(check.a), b = p2(check.b), c = p2(check.c), d = p2(check.d)
      if (!a || !b || !c || !d) return { passed: false, detail: `missing 2d points for dot` }
      const v = (b.x - a.x) * (d.x - c.x) + (b.y - a.y) * (d.y - c.y)
      return { passed: near(v, check.value, 1e-2), detail: `dot=${v} vs ${check.value}` }
    }
    case "function-sample-2d": {
      const fns = prims.filter((p) => p.type === "function" && typeof p.expression === "string")
      for (const fn of fns) {
        try {
          const val = evaluateExpression(compileExpression(fn.expression as string), { x: check.x })
          if (near(val, check.value, 1e-2)) return { passed: true, detail: `function sample f(${check.x})=${val}` }
        } catch {
          // ignore non-matching curve
        }
      }
      return { passed: false, detail: `no function primitive matched sample (${check.x}, ${check.value})` }
    }
    case "infeasible-branch": {
      const explicitFlag = options.infeasibleDiagnosedSubquestions?.includes(check.subquestion) === true
      const textDiagnosed = typeof options.answerText === "string" && /无解|不存在|不成立|矛盾|不可行|infeasible/i.test(options.answerText)
      const fabricatedFakePoint = check.subquestion === "(2)" && pts2.has("P") && !explicitFlag && !textDiagnosed
      const ok = (explicitFlag || textDiagnosed) && !fabricatedFakePoint
      return {
        passed: ok,
        detail: ok ? `subquestion ${check.subquestion} infeasibility explicitly disclosed` : `infeasible branch ${check.subquestion} not disclosed or fabricated`
      }
    }
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

  const obligationResults: ObligationEvaluation[] = contract.requiredObligations.map((ob) => {
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
