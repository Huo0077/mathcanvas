import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { conicResidualAt, NUMERIC_POLICY_VERSION } from "@draw/geometry-kernel"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import { parseDiagramObligations } from "../diagramObligations"
import { verifyDiagramObligations, type DiagramVerificationReport } from "../diagramVerification"

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

export interface DrawingCertificateResult {
  certificateStatus: "passed" | "partial" | "blocked" | "unverified"
  gate: MathGateDecision
  report: DiagramVerificationReport | null
  numericPolicyVersion: string
  ignoredUntrustedSelfReport: boolean
  summary: string
}

const DRAWING_KEYWORDS_RE =
  /([=<>]|椭圆|双曲线|抛物线|圆锥曲线|四面体|三棱锥|四棱锥|三棱柱|直棱柱|正方体|立方体|多面体|翻折|折叠|切线|公切线|焦点|准线|离心率|函数|导数|图像|作出|画出|画一个|作一个|绘制)/
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

export function certifyDrawingAgainstContract(input: {
  prompt: string
  document: GeometryDocument
  candidateHash: string
  sourceHash: string
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
      summary: "完整数学证书开关已关闭：未完整核验（不回退为旧 passed）。"
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
      summary: "非作图问答，跳过数学作图证书门禁。"
    }
  }

  const nonFiniteGeometry = collectNonFiniteNumbers(input.document.primitives)
  const presentLabels = collectPresentLabels(input.document.primitives)
  const missingEntityIds = (input.requiredEntityLabels ?? []).filter(
    (label) => !presentLabels.has(label.trim()) && !presentLabels.has(normalizedLabel(label))
  )

  const parsedObligations = parseDiagramObligations(input.prompt)
  const neutralPlan: PlanEnvelope = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: input.prompt,
    factIds: [],
    actions: []
  }
  const entityBindings: Record<string, string> = {}
  for (const p of input.document.primitives) {
    if (typeof p.label === "string" && p.label.trim().length > 0 && !(p.label.trim() in entityBindings)) {
      entityBindings[p.label.trim()] = p.id
    }
  }
  const report = verifyDiagramObligations(parsedObligations, neutralPlan, input.document, undefined, { entityBindings })
  const evidence: ObligationEvidence[] = []
  const requiredIds: string[] = []
  const checkedIds: string[] = []
  const unresolvedSource: string[] = []

  report.checks.forEach((check, idx) => {
    const id = `obl-${idx}`
    requiredIds.push(id)
    if (check.status === "passed") {
      checkedIds.push(id)
      evidence.push({ obligationId: id, status: "passed", candidateHash: input.candidateHash, detail: check.reason })
    } else if (check.status === "failed") {
      checkedIds.push(id)
      evidence.push({ obligationId: id, status: "failed", candidateHash: input.candidateHash, detail: check.reason })
    } else {
      if (check.kind === "unparsed") {
        unresolvedSource.push(check.sourceText)
      }
      checkedIds.push(id)
      evidence.push({ obligationId: id, status: "unknown", candidateHash: input.candidateHash, detail: check.reason })
    }
  })

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
        : `数学证书未通过（${certificateStatus}）：${gate.blockers.join(", ")}`
  }
}
