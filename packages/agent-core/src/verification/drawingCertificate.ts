import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { conicResidualAt, evaluateFunctionWithDomain, evaluateSymbolicDerivative, NUMERIC_POLICY_VERSION } from "@draw/geometry-kernel"
export { NUMERIC_POLICY_VERSION }
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import { routeDeterministicProblem } from "../deterministicProblemRoute"
import { resolveInfeasibleEllipseFallbackScope, verifyDiagramObligations, type DiagramVerificationReport } from "../diagramVerification"
import { normalizeGeometryPrompt } from "../latexNormalisation"
import { splitNumberedProblem, subquestionScopeId } from "../numberedProblem"
import { parseObligationWithLegacy } from "../obligationIR"

export type ObligationGateStatus = "passed" | "failed" | "unknown" | "approximate" | "not_supported"

export interface ObligationEvidence {
  obligationId: string
  status: ObligationGateStatus
  residual?: number
  candidateHash?: string
  detail?: string
}

export interface MathGateCoverage {
  requiredIds: readonly string[]
  checkedIds: readonly string[]
  unresolvedSource: readonly string[]
  missingEntityIds: readonly string[]
  nonFiniteGeometry?: boolean
}

export interface MathGateBinding {
  candidateHash: string
  sourceHash: string
  policyVersion: string
}

export interface MathGateInput {
  isDrawingRequest: boolean
  coverage: MathGateCoverage
  evidence: readonly ObligationEvidence[]
  binding: MathGateBinding
}

export type MathGateDecisionStatus = "passed" | "blocked" | "not_applicable"

export interface MathGateDecision {
  status: MathGateDecisionStatus
  blockers: string[]
  binding: MathGateBinding
}

export interface FailedObligationDetail {
  id: string
  scope?: string
  stateId?: string
  kind: string
  detail: string
}

export interface DrawingCertificateResult {
  certificateStatus: "passed" | "partial" | "blocked" | "unverified"
  gate: MathGateDecision
  report: DiagramVerificationReport | null
  numericPolicyVersion: string
  ignoredUntrustedSelfReport: boolean
  summary: string
  candidateHash?: string
  failedObligations?: FailedObligationDetail[]
  missingEntities?: string[]
  unresolvedClauses?: string[]
}

const DRAWING_KEYWORDS_RE =
  /([=<>]|椭圆|双曲线|抛物线|圆锥曲线|圆锥|圆柱|圆台|棱台|四面体|三棱锥|四棱锥|三棱柱|直棱柱|正方体|长方体|立方体|多面体|平行四边形|梯形|正方形|菱形|翻折|折叠|切线|公切线|焦点|准线|离心率|函数|导数|图像|作出|画出|画一个|作一个|绘制)/
const NON_DRAWING_QUERY_RE = /(画布上有几个|有多少个|是什么|天气|你好|怎么样|为什么|怎么算|概念)/

export function isDrawingRequestContract(prompt: string): boolean {
  const trimmed = prompt.trim()
  if (trimmed.length === 0) return false
  if (NON_DRAWING_QUERY_RE.test(trimmed) && !/作出|绘制|画一个|画个|作图|椭圆|抛物线|双曲线|翻折|切线/.test(trimmed)) {
    return false
  }
  return DRAWING_KEYWORDS_RE.test(trimmed)
}

export function evaluateMathGate(input: MathGateInput): MathGateDecision {
  if (!input.isDrawingRequest) {
    return { status: "not_applicable", blockers: [], binding: input.binding }
  }
  const blockers: string[] = []
  const required = new Set(input.coverage.requiredIds)
  const checks = new Map<string, ObligationEvidence>()

  if (required.size === 0) blockers.push("empty_required_contract")
  if (required.size !== input.coverage.requiredIds.length) blockers.push("duplicate_required_id")
  if (input.coverage.nonFiniteGeometry) blockers.push("non_finite_geometry")

  for (const ev of input.evidence) {
    if (checks.has(ev.obligationId)) blockers.push("duplicate_evidence")
    if (ev.residual !== undefined && !Number.isFinite(ev.residual)) blockers.push("non_finite_evidence")
    if (ev.candidateHash !== undefined && ev.candidateHash !== input.binding.candidateHash) {
      blockers.push(`stale_candidate_binding:${ev.obligationId}`)
    }
    checks.set(ev.obligationId, ev)
  }

  if (input.coverage.unresolvedSource.length > 0) blockers.push("source_coverage_incomplete")
  if (input.coverage.missingEntityIds.length > 0) blockers.push("required_entity_missing")

  for (const id of required) {
    if (!input.coverage.checkedIds.includes(id) || checks.get(id)?.status !== "passed") {
      blockers.push(`obligation_not_passed:${id}`)
    }
  }

  return {
    status: blockers.length > 0 ? "blocked" : "passed",
    blockers,
    binding: input.binding
  }
}

function collectNonFiniteNumbers(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value === "number") return !Number.isFinite(value)
  if (typeof value !== "object" || value === null || seen.has(value)) return false
  seen.add(value)
  if (Array.isArray(value)) return value.some((item) => collectNonFiniteNumbers(item, seen))
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (key === "updatedAt" || key === "revision") continue
    if (collectNonFiniteNumbers(val, seen)) return true
  }
  return false
}

function normalizedLabel(label: string | undefined): string {
  if (!label) return ""
  return label
    .trim()
    .replaceAll("₁", "1")
    .replaceAll("₂", "2")
    .replaceAll("₃", "3")
    .replaceAll("₄", "4")
    .replaceAll("′", "'")
}

function collectPresentLabels(primitives: readonly PrimitiveSpec[]): Set<string> {
  const labels = new Set<string>()
  for (const p of primitives) {
    if (p.label) {
      labels.add(p.label.trim())
      labels.add(normalizedLabel(p.label))
    }
    const raw = p as unknown as Record<string, unknown>
    if (Array.isArray(raw.vertexNames)) {
      for (const name of raw.vertexNames) {
        if (typeof name === "string" && name.trim().length > 0) {
          labels.add(name.trim())
          labels.add(normalizedLabel(name))
        }
      }
    }
  }
  return labels
}

function checkPointsOnEllipseInPrompt(
  prompt: string,
  document: GeometryDocument
): ObligationEvidence[] {
  const conic = document.primitives.find((p) => p.type === "ellipse")
  if (!conic || conic.type !== "ellipse") return []
  const extras: ObligationEvidence[] = []
  const onEllipseMatch = /([A-Z]) 在椭圆上/.exec(prompt)
  if (onEllipseMatch) {
    const label = onEllipseMatch[1]!
    const pt = document.primitives.find((p) => p.type === "point" && p.label === label)
    if (!pt || pt.type !== "point") {
      extras.push({ obligationId: `point-on-ellipse:${label}`, status: "failed", detail: `缺少点 ${label}` })
    } else {
      const residualResult = conicResidualAt(conic, { x: pt.x, y: pt.y })
      const residual = residualResult?.residual ?? Number.POSITIVE_INFINITY
      extras.push({
        obligationId: `point-on-ellipse:${label}`,
        status: Number.isFinite(residual) && residual <= 1e-4 ? "passed" : "failed",
        residual,
        detail: `${label} 到椭圆 C 的残差为 ${residual}`
      })
    }
  }
  return extras
}

function resolveCertificatePromptAndScope(
  rawPrompt: string,
  requestedScopeId: string | undefined,
  document: GeometryDocument
): { parserPrompt: string; selectedScopeId: string | undefined } {
  let effectivePrompt = rawPrompt
  let effectiveScopeId = requestedScopeId
  const route = routeDeterministicProblem(rawPrompt)
  if (route) {
    const present = collectPresentLabels(document.primitives)
    const altScopeKey = requestedScopeId?.replace(/^subquestion:(\d+)$/, "($1)")
    const matchedScopePlan =
      (requestedScopeId && route.scopePlans?.[requestedScopeId]) ||
      (altScopeKey && route.scopePlans?.[altScopeKey])
    if (matchedScopePlan) {
      effectivePrompt = matchedScopePlan.diagramPrompt ?? route.diagramPrompt ?? rawPrompt
      effectiveScopeId = matchedScopePlan.selectedScopeId ?? route.selectedScopeId ?? requestedScopeId
    } else if (route.scopedStatePlans) {
      const hasPostFold = present.has("P") || document.primitives.some((p) => p.type === "polyhedron3")
      const stateKey = hasPostFold ? "after_fold" : "before_fold"
      const scopeEntry =
        (requestedScopeId && route.scopedStatePlans[requestedScopeId]) ||
        (altScopeKey && route.scopedStatePlans[altScopeKey]) ||
        Object.values(route.scopedStatePlans)[0]
      const sp = scopeEntry?.[stateKey] ?? (scopeEntry ? Object.values(scopeEntry)[0] : undefined)
      if (sp) {
        effectivePrompt = sp.diagramPrompt ?? route.diagramPrompt ?? rawPrompt
        effectiveScopeId = sp.selectedScopeId ?? route.selectedScopeId ?? requestedScopeId
      }
    } else if (route.statePlans) {
      const hasPostFold = present.has("P") || document.primitives.some((p) => p.type === "polyhedron3")
      const stateKey = hasPostFold ? "after_fold" : "before_fold"
      const sp = route.statePlans[stateKey] ?? Object.values(route.statePlans)[0]
      if (sp) {
        effectivePrompt = sp.diagramPrompt ?? route.diagramPrompt ?? rawPrompt
        effectiveScopeId = sp.selectedScopeId ?? route.selectedScopeId ?? requestedScopeId
      }
    } else if (route.diagramPrompt) {
      effectivePrompt = route.diagramPrompt
    }
    if ((effectiveScopeId === undefined || effectiveScopeId === "shared") && route.selectedScopeId !== undefined) {
      effectiveScopeId = route.selectedScopeId
    }
    if (effectiveScopeId === undefined || effectiveScopeId === "shared") {
      const split = splitNumberedProblem(normalizeGeometryPrompt(effectivePrompt))
      if (split && split.parts.length > 1) {
        effectiveScopeId = subquestionScopeId(split.parts[split.parts.length - 1]!.number)
      }
    }
  }
  const parserPrompt = normalizeGeometryPrompt(effectivePrompt)
  return { parserPrompt, selectedScopeId: effectiveScopeId }
}

function hasVerifiedFunctionTangentInDocument(document: GeometryDocument): boolean {
  const fns = document.primitives.filter((p) => p.type === "function") as unknown as Array<{
    id: string
    expression?: string
    domain?: [number, number]
  }>
  if (fns.length === 0) return false
  if (document.primitives.some((p) => p.type === "tangent")) return true
  const lines = document.primitives.filter((p) => p.type === "line") as unknown as Array<{
    a?: { x: number; y: number }
    b?: { x: number; y: number }
  }>
  const docPointXs = document.primitives
    .filter((p): p is Extract<GeometryDocument["primitives"][number], { type: "point" }> => p.type === "point" && Number.isFinite(p.x))
    .map((p) => p.x)
  for (const fn of fns) {
    if (typeof fn.expression !== "string") continue
    const [dLow, dHigh] = Array.isArray(fn.domain) && fn.domain.length === 2 && Number.isFinite(fn.domain[0]) && Number.isFinite(fn.domain[1]) && fn.domain[1] > fn.domain[0]
      ? fn.domain
      : [-10, 10]
    const sampleXs = new Set<number>([-2, -1, -0.5, 0, 0.5, 1, 1.5, 2, ...docPointXs])
    for (let i = 0; i <= 40; i += 1) {
      sampleXs.add(dLow + ((dHigh - dLow) * i) / 40)
    }
    for (const line of lines) {
      if (!line.a || !line.b) continue
      const dx = line.b.x - line.a.x
      const dy = line.b.y - line.a.y
      if (Math.hypot(dx, dy) <= 1e-9 || Math.abs(dx) <= 1e-9) continue
      const slope = dy / dx
      const intercept = line.a.y - slope * line.a.x
      for (const xTry of [line.a.x, line.b.x, ...sampleXs]) {
        const yRes = evaluateFunctionWithDomain(fn.expression, xTry)
        const dRes = evaluateSymbolicDerivative(fn.expression, xTry)
        if (
          yRes.ok &&
          dRes.ok &&
          Math.abs(dRes.value - slope) <= 1e-2 * Math.max(1, Math.abs(slope)) &&
          Math.abs(yRes.value - (slope * xTry + intercept)) <= 1e-2 * Math.max(1, Math.abs(yRes.value))
        ) {
          return true
        }
      }
    }
  }
  return false
}

export function certifyDrawingAgainstContract(input: {
  prompt: string
  document: GeometryDocument
  candidateHash: string
  sourceHash: string
  baseDocument?: GeometryDocument
  plan?: PlanEnvelope
  entityBindings?: Readonly<Record<string, string>>
  obligationIR?: boolean
  witnessSearch?: boolean
  selectedScopeId?: string
  staleEarlierObligations?: boolean
  requiredEntityLabels?: readonly string[]
  expectedFunctions?: Readonly<Record<string, string>>
  untrustedSelfReportedChecks?: readonly unknown[]
  enableCompleteCertificate?: boolean
}): DrawingCertificateResult {
  const binding: MathGateBinding = {
    candidateHash: input.candidateHash,
    sourceHash: input.sourceHash,
    policyVersion: NUMERIC_POLICY_VERSION
  }

  if (input.enableCompleteCertificate === false) {
    return {
      certificateStatus: "unverified",
      gate: { status: "blocked", blockers: ["certificate_disabled"], binding },
      report: null,
      numericPolicyVersion: NUMERIC_POLICY_VERSION,
      ignoredUntrustedSelfReport: true,
      summary: "完整数学证书开关已关闭：未完整核验（不回退为旧 passed）。",
      candidateHash: input.candidateHash,
      failedObligations: [],
      missingEntities: [],
      unresolvedClauses: []
    }
  }

  if (input.staleEarlierObligations === true) {
    return {
      certificateStatus: "unverified",
      gate: { status: "blocked", blockers: ["stale_earlier_obligations"], binding },
      report: null,
      numericPolicyVersion: NUMERIC_POLICY_VERSION,
      ignoredUntrustedSelfReport: true,
      summary: "草稿已追加/变更操作，早期题设需在新候选图上重新完整核验（不沿用旧通过状态）。",
      candidateHash: input.candidateHash,
      failedObligations: [],
      missingEntities: [],
      unresolvedClauses: []
    }
  }

  const isDrawing = isDrawingRequestContract(input.prompt)
  if (!isDrawing) {
    return {
      certificateStatus: "unverified",
      gate: { status: "not_applicable", blockers: [], binding },
      report: null,
      numericPolicyVersion: NUMERIC_POLICY_VERSION,
      ignoredUntrustedSelfReport: (input.untrustedSelfReportedChecks?.length ?? 0) > 0,
      summary: "非作图问答，跳过数学作图证书门禁。",
      candidateHash: input.candidateHash,
      failedObligations: [],
      missingEntities: [],
      unresolvedClauses: []
    }
  }

  const nonFiniteGeometry = collectNonFiniteNumbers(input.document.primitives)
  const presentLabels = collectPresentLabels(input.document.primitives)
  const missingEntityIds = (input.requiredEntityLabels ?? []).filter(
    (label) => !presentLabels.has(label.trim()) && !presentLabels.has(normalizedLabel(label))
  )

  const { parserPrompt, selectedScopeId: initialScopeId } = resolveCertificatePromptAndScope(
    input.prompt,
    input.selectedScopeId,
    input.document
  )
  const neutralPlan: PlanEnvelope = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: input.prompt,
    factIds: [],
    actions: []
  }
  const effectiveScopeId = resolveInfeasibleEllipseFallbackScope({
    prompt: parserPrompt,
    document: input.document,
    plan: input.plan ?? neutralPlan,
    ...(input.baseDocument === undefined ? {} : { baseDocument: input.baseDocument }),
    ...(initialScopeId === undefined ? {} : { requestedScopeId: initialScopeId })
  })
  const parsedObligations = parseObligationWithLegacy(parserPrompt, {
    spatialPointConditions: input.witnessSearch === true,
    ...(effectiveScopeId === undefined ? {} : { selectedScopeId: effectiveScopeId })
  }).legacy
  const entityBindings: Record<string, string> = { ...(input.entityBindings ?? {}) }
  const curveLabelCounts = new Map<string, string[]>()
  for (const p of input.document.primitives) {
    if (
      (p.type === "circle" || p.type === "ellipse" || p.type === "parabola" || p.type === "hyperbola" || p.type === "function") &&
      typeof p.label === "string" &&
      p.label.trim().length > 0
    ) {
      const lbl = p.label.trim()
      curveLabelCounts.set(lbl, [...(curveLabelCounts.get(lbl) ?? []), p.id])
    }
  }
  for (const [lbl, ids] of curveLabelCounts) {
    if (ids.length === 1 && !(lbl in entityBindings)) {
      entityBindings[lbl] = ids[0]!
    }
  }
  const report = verifyDiagramObligations(parsedObligations, input.plan ?? neutralPlan, input.document, input.baseDocument, {
    obligationIR: input.obligationIR === true,
    prompt: parserPrompt,
    entityBindings,
    ...(effectiveScopeId === undefined ? {} : { activeScopeId: effectiveScopeId })
  })
  const evidence: ObligationEvidence[] = []
  const requiredIds: string[] = []
  const checkedIds: string[] = []
  const unresolvedSource: string[] = []
  const failedObligations: FailedObligationDetail[] = []

  report.checks.forEach((check, idx) => {
    const id = `obl-${idx}`
    requiredIds.push(id)
    if (check.status === "passed") {
      checkedIds.push(id)
      evidence.push({ obligationId: id, status: "passed", candidateHash: input.candidateHash, detail: check.reason })
    } else if (check.status === "failed") {
      checkedIds.push(id)
      evidence.push({ obligationId: id, status: "failed", candidateHash: input.candidateHash, detail: check.reason })
      failedObligations.push({
        id,
        ...(effectiveScopeId === undefined ? {} : { scope: effectiveScopeId }),
        kind: check.kind,
        detail: `${check.sourceText}: ${check.reason}`
      })
    } else {
      unresolvedSource.push(check.sourceText)
      checkedIds.push(id)
      evidence.push({ obligationId: id, status: "unknown", candidateHash: input.candidateHash, detail: check.reason })
      failedObligations.push({
        id,
        ...(effectiveScopeId === undefined ? {} : { scope: effectiveScopeId }),
        kind: check.kind,
        detail: `${check.sourceText}: ${check.reason}`
      })
    }
  })

  // Unparsed premise clause coverage guards (never silently treat unparsed function-tangent or circle extreme-chord constraints as passed).
  if (parsedObligations.givens.some((given) => given.kind === "functionGraph") && /(?:公?切线)/.test(parserPrompt) && !report.checks.some((check) => check.kind === "tangentAt")) {
    const id = "unparsed:tangent"
    requiredIds.push(id)
    checkedIds.push(id)
    if (hasVerifiedFunctionTangentInDocument(input.document)) {
      evidence.push({ obligationId: id, status: "passed", candidateHash: input.candidateHash, detail: "函数切线已由导数斜率与切点核验通过" })
    } else {
      const clause = "函数切线条件尚未形成可核验检查"
      unresolvedSource.push(clause)
      evidence.push({ obligationId: id, status: "unknown", candidateHash: input.candidateHash, detail: clause })
      failedObligations.push({ id, kind: "unparsed", detail: clause })
    }
  }

  const extremeChordMatch = /过(?:点\s*)?([A-Z])(?:\([^)]*\))?[^，,。；\n]*最长弦和最短弦分别是\s*([A-Z])([A-Z])\s*和\s*([A-Z])([A-Z])/.exec(parserPrompt)
  if (extremeChordMatch) {
    const [, throughLbl, aLbl, cLbl, bLbl, dLbl] = extremeChordMatch as unknown as [string, string, string, string, string, string]
    const id = `circle-extreme-chords:${aLbl}${cLbl}-${bLbl}${dLbl}`
    requiredIds.push(id)
    checkedIds.push(id)
    const circle = input.document.primitives.find((p) => p.type === "circle")
    const ptOf = (lbl: string) => {
      const p = input.document.primitives.find((prim) => prim.type === "point" && prim.label === lbl)
      return p && p.type === "point" ? { x: p.x, y: p.y } : null
    }
    const P = ptOf(throughLbl), A = ptOf(aLbl), C = ptOf(cLbl), B = ptOf(bLbl), D = ptOf(dLbl)
    if (!circle || circle.type !== "circle" || !P || !A || !C || !B || !D) {
      const detail = "缺少圆或最长弦/最短弦端点（点名未物化）"
      evidence.push({ obligationId: id, status: "failed", candidateHash: input.candidateHash, detail })
      failedObligations.push({ id, kind: "conicChord", detail })
    } else {
      const onCirc = (pt: { x: number; y: number }) => Math.abs(Math.hypot(pt.x - circle.center.x, pt.y - circle.center.y) - circle.radius) <= 1e-3 * Math.max(1, circle.radius)
      const acx = C.x - A.x, acy = C.y - A.y
      const bdx = D.x - B.x, bdy = D.y - B.y
      const acLen = Math.hypot(acx, acy)
      const bdLen = Math.hypot(bdx, bdy)
      const dotPerp = Math.abs(acx * bdx + acy * bdy)
      const throughCenter = acLen > 1e-6 && Math.abs((circle.center.x - A.x) * acy - (circle.center.y - A.y) * acx) / acLen <= 1e-3
      const pOnAc = acLen > 1e-6 && Math.abs((P.x - A.x) * acy - (P.y - A.y) * acx) / acLen <= 1e-3
      const pOnBd = bdLen > 1e-6 && Math.abs((P.x - B.x) * bdy - (P.y - B.y) * bdx) / bdLen <= 1e-3
      const ok = onCirc(A) && onCirc(B) && onCirc(C) && onCirc(D) && throughCenter && pOnAc && pOnBd && dotPerp <= 1e-3 * acLen * bdLen
      const detail = ok ? `已核验过 ${throughLbl} 的直径弦 ${aLbl}${cLbl} ⊥ 最短弦 ${bLbl}${dLbl}` : `最长/最短弦 ${aLbl}${cLbl}、${bLbl}${dLbl} 未满足圆内垂直共点直径几何条件`
      evidence.push({ obligationId: id, status: ok ? "passed" : "failed", candidateHash: input.candidateHash, detail })
      if (!ok) failedObligations.push({ id, kind: "conicChord", detail })
    }
  }

  for (const extra of checkPointsOnEllipseInPrompt(input.prompt, input.document)) {
    requiredIds.push(extra.obligationId)
    checkedIds.push(extra.obligationId)
    evidence.push({ ...extra, candidateHash: input.candidateHash })
  }

  if (input.expectedFunctions) {
    for (const [label, expectedExpr] of Object.entries(input.expectedFunctions)) {
      const id = `fn-binding:${label}`
      requiredIds.push(id)
      checkedIds.push(id)
      const normExpected = expectedExpr.replaceAll(/\s+/g, "")
      const matched = input.document.primitives.find((p) => {
        if (p.label !== label) return false
        const raw = p as unknown as Record<string, unknown>
        return typeof raw.expression === "string" && raw.expression.replaceAll(/\s+/g, "") === normExpected
      })
      evidence.push({
        obligationId: id,
        status: matched ? "passed" : "failed",
        candidateHash: input.candidateHash,
        detail: matched ? `${label}(x)=${expectedExpr} 已独立绑核` : `函数曲线 ${label} 与题设表达式 ${expectedExpr} 不匹配或被交换`
      })
    }
  }

  for (const entityLabel of input.requiredEntityLabels ?? []) {
    const id = `entity:${entityLabel}`
    requiredIds.push(id)
    checkedIds.push(id)
    const present = presentLabels.has(entityLabel.trim()) || presentLabels.has(normalizedLabel(entityLabel))
    evidence.push({
      obligationId: id,
      status: present && !nonFiniteGeometry ? "passed" : "failed",
      candidateHash: input.candidateHash,
      detail: present ? `必需实体 ${entityLabel} 已物化` : `必需实体 ${entityLabel} 缺失`
    })
  }

  const gate = evaluateMathGate({
    isDrawingRequest: true,
    coverage: {
      requiredIds,
      checkedIds,
      unresolvedSource,
      missingEntityIds,
      nonFiniteGeometry
    },
    evidence,
    binding
  })

  const hasHardFailure =
    nonFiniteGeometry ||
    missingEntityIds.length > 0 ||
    evidence.some((e) => e.status === "failed") ||
    gate.blockers.some((b) =>
      b === "empty_required_contract" ||
      b === "duplicate_required_id" ||
      b === "duplicate_evidence" ||
      b === "non_finite_evidence"
    )

  const certificateStatus: DrawingCertificateResult["certificateStatus"] =
    gate.status === "passed"
      ? "passed"
      : !hasHardFailure && unresolvedSource.length > 0
        ? "partial"
        : "blocked"

  return {
    certificateStatus,
    gate,
    report,
    numericPolicyVersion: NUMERIC_POLICY_VERSION,
    ignoredUntrustedSelfReport: true,
    summary:
      gate.status === "passed"
        ? `完整数学证书通过（${requiredIds.length} 项义务，策略 ${NUMERIC_POLICY_VERSION}）。`
        : `数学证书未通过（${certificateStatus}）：${gate.blockers.join(", ")}`,
    candidateHash: input.candidateHash,
    failedObligations,
    missingEntities: [...missingEntityIds],
    unresolvedClauses: [...new Set(unresolvedSource)]
  }
}

export interface CertificateBinding {
  runId: string
  draftId: string
  draftVersion: number
  documentHash: string
  promptHash?: string
  scopeId?: string
  conversationId?: string
  baseRevision?: number
  policyVersion?: string
}

export type CertificateFreshnessReason =
  | "fresh"
  | "run_changed"
  | "draft_replaced"
  | "document_changed"
  | "prompt_changed"
  | "scope_changed"
  | "conversation_changed"
  | "revision_changed"
  | "policy_changed"

export function verifyCertificateFreshness(
  bound: CertificateBinding,
  current: CertificateBinding
): { fresh: true; reason: "fresh" } | { fresh: false; reason: Exclude<CertificateFreshnessReason, "fresh">; detail: string } {
  if (bound.runId !== current.runId) {
    return { fresh: false, reason: "run_changed", detail: `runId changed from ${bound.runId} to ${current.runId}` }
  }
  if (bound.draftId !== current.draftId) {
    return { fresh: false, reason: "draft_replaced", detail: `draftId changed from ${bound.draftId} to ${current.draftId}` }
  }
  if (bound.conversationId !== undefined && current.conversationId !== undefined && bound.conversationId !== current.conversationId) {
    return { fresh: false, reason: "conversation_changed", detail: `conversation changed from ${bound.conversationId} to ${current.conversationId}` }
  }
  if (bound.promptHash !== undefined && current.promptHash !== undefined && bound.promptHash !== current.promptHash) {
    return { fresh: false, reason: "prompt_changed", detail: `prompt changed (${bound.promptHash} vs ${current.promptHash})` }
  }
  if (bound.scopeId !== undefined && current.scopeId !== undefined && bound.scopeId !== current.scopeId) {
    return { fresh: false, reason: "scope_changed", detail: `scope changed from ${bound.scopeId} to ${current.scopeId}` }
  }
  if (bound.documentHash !== current.documentHash) {
    return { fresh: false, reason: "document_changed", detail: `documentHash changed (${bound.documentHash} vs ${current.documentHash})` }
  }
  if (bound.baseRevision !== undefined && current.baseRevision !== undefined && bound.baseRevision !== current.baseRevision) {
    return { fresh: false, reason: "revision_changed", detail: `baseRevision changed from ${bound.baseRevision} to ${current.baseRevision}` }
  }
  if (bound.policyVersion !== undefined && current.policyVersion !== undefined && bound.policyVersion !== current.policyVersion) {
    return { fresh: false, reason: "policy_changed", detail: `policyVersion changed from ${bound.policyVersion} to ${current.policyVersion}` }
  }
  return { fresh: true, reason: "fresh" }
}
