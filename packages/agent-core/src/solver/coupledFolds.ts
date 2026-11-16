import {
  classifyFoldSystemResult,
  rotatePointAboutHinge,
  solveFoldSystem,
  type FoldSystemOptions,
  type FoldSystemOutcome,
  type Vector3
} from "@draw/geometry-kernel"
import type { PlanEnvelope } from "../contracts"
import { readFoldTransformations } from "../figureIntent"
import type { ObligationIR } from "../obligationIR"
import type { PlanCompileResult } from "../planCompiler"
import { buildFoldLineage, type FoldLineageStep, type FoldLineageStepInput } from "./foldHinges"

type Plan = Extract<PlanEnvelope, { kind: "plan" }>
export type CoupledFoldResult =
  | { status: "solved"; plan: Plan; search: FoldSystemOutcome; solutions: number[][]; unknownActions: number[] }
  | { status: "failed"; code: string; detail: string }

/** Every residual evaluates the real compiler; no stale point or face copies are used. */
export function solvePlanFoldSystem(plan: Plan, ir: ObligationIR, prompt: string,
  compile: (plan: Plan) => PlanCompileResult, options: FoldSystemOptions = {}): CoupledFoldResult | null {
  const folds = plan.actions.flatMap((action, index) => action.actionId === "solid.fold" ? [{ action, index }] : [])
  if (folds.length < 2) return null
  const transformations = readFoldTransformations(prompt)
  const paired = folds.map(({ action }) => {
    const input = action.inputs as { apexAs?: string; hinge?: { from: string; to: string } }
    const matches = transformations.filter(t => t.apexAs === input.apexAs && t.hinge.from === input.hinge?.from && t.hinge.to === input.hinge?.to)
    return matches.length === 1 ? matches[0] : undefined
  })
  if (paired.some(t => t === undefined)) return null
  const unknownActions = folds.filter((_, i) => paired[i]!.angleDegrees === undefined).map(f => f.index)
  if (unknownActions.length === 0) return null
  if (unknownActions.length > 3) return { status: "failed", code: "fold_system_unsupported", detail: "当前联合求解最多支持3个未知折角，请拆分构造或补充部分折角。" }
  const produced = new Set(paired.map(t => t!.apexAs))
  const constraints = ir.obligations.filter(o => o.role === "given" && o.judgeability === "supported" && o.targets.some(name => produced.has(name)))
  if (constraints.length < unknownActions.length) return { status: "failed", code: "fold_system_underdetermined", detail: `有${unknownActions.length}个未知折角，只有${constraints.length}条可计算的终态条件。请补充独立条件；不能把默认角度当作求解结果。` }
  const initial = unknownActions.map(index => {
    const angle = (plan.actions[index]!.inputs as { angle?: number }).angle
    return typeof angle === "number" && Number.isFinite(angle) && angle > 0 && angle <= 180 ? angle : 90
  })
  const at = (angles: readonly number[]): Plan => ({ ...plan, actions: plan.actions.map((action, index) => {
    const unknown = unknownActions.indexOf(index)
    const foldIndex = folds.findIndex(f => f.index === index)
    if (foldIndex < 0) return action
    const angle = unknown >= 0 ? angles[unknown]! : paired[foldIndex]!.angleDegrees!
    return { ...action, inputs: { ...(action.inputs as Record<string, unknown>), angle } } as typeof action
  }) })
  const seed = compile(at(initial))
  if (seed.diagramVerification?.checks.some(check => check.status === "failed" && check.kind !== "fold"
    && !constraints.some(c => c.kind === check.kind && c.sourceText === check.sourceText))) return null
  const search = solveFoldSystem(angles => {
    const trial = compile(at(angles))
    const checks = trial.diagramVerification?.checks ?? []
    return constraints.map(c => {
      const check = checks.find(entry => entry.kind === c.kind && entry.sourceText === c.sourceText)
      if (check?.actual === undefined || check.expected === undefined) return NaN
      const tolerance = c.tolerance?.value ?? Math.max(1e-6, Math.abs(check.expected) * 1e-6)
      return (check.actual - check.expected) / tolerance
    })
  }, initial, { ...options, residualTolerance: 0.25 })
  if (search.status !== "solved") return {
    status: "failed", code: `fold_system_${search.status.replaceAll("-", "_")}`,
    detail: search.status === "underdetermined"
      ? "终态条件的数值雅可比矩阵秩不足，不能可靠确定全部折角；请补充独立条件。"
      : `联合折角搜索未完成求解（${search.termination}，${search.evaluations}次评估）。未找到不等于证明无解。`
  }
  const solutions = search.degrees.filter(angles => {
    const verified = compile(at(angles))
    return verified.ok && verified.draftDocument !== null && verified.diagramVerification?.status === "passed"
  })
  if (solutions.length === 0) return { status: "failed", code: "fold_system_unverified", detail: "找到数值候选，但没有任何候选通过全部题设的独立回代核验；不生成草稿。" }
  return { status: "solved", plan: at(solutions[0]!), search, solutions, unknownActions }
}

export interface CoupledFoldStepSpec {
  stepId: string
  hingeFrom: string
  hingeTo: string
  apex: string
  apexAs: string
  movingFaceIds: readonly string[]
  initialDegrees?: number
  side?: "positive" | "negative"
}

export interface CoupledDistanceTarget {
  point: string
  target: string
  distance: number
}

export interface CoupledFoldSequenceInput {
  points: Record<string, Vector3>
  folds: readonly CoupledFoldStepSpec[]
  distanceTargets: readonly CoupledDistanceTarget[]
  options?: FoldSystemOptions
}

export type CoupledFoldSequenceResult =
  | {
    status: "solved"
    complete: false
    solvedDegrees: number[]
    candidateSolutions: number[][]
    points: Record<string, Vector3>
    lineage: FoldLineageStep[]
  }
  | {
    status: "not-found" | "underdetermined" | "invalid_order" | "unsupported" | "cancelled"
    complete: false
    provenUnsat: false
    reason: string
  }

const MAX_COUPLED_FOLDS = 3

function evaluateChain(
  initialPoints: Readonly<Record<string, Vector3>>,
  folds: readonly CoupledFoldStepSpec[],
  degrees: readonly number[]
): { ok: true; points: Record<string, Vector3>; stepInputs: FoldLineageStepInput[] } | { ok: false; reason: string } {
  const pts: Record<string, Vector3> = {}
  for (const [k, v] of Object.entries(initialPoints)) pts[k] = { ...v }
  const stepInputs: FoldLineageStepInput[] = []
  let parentStateId = "s0"

  for (let i = 0; i < folds.length; i += 1) {
    const fold = folds[i]!
    const stateId = `s${i + 1}`
    const hFrom = pts[fold.hingeFrom]
    const hTo = pts[fold.hingeTo]
    const apexPt = pts[fold.apex]
    if (!hFrom || !hTo || !apexPt) {
      return {
        ok: false,
        reason: `折叠顺序非法：步骤 "${fold.stepId}" 依赖尚未物化的点（${fold.hingeFrom}, ${fold.hingeTo}, ${fold.apex}）。`
      }
    }
    const deg = degrees[i] ?? 0
    const side = fold.side ?? "positive"
    const signedDeg = side === "negative" ? -Math.abs(deg) : deg
    const rotated = rotatePointAboutHinge(apexPt, hFrom, hTo, signedDeg)
    if (rotated.status !== "ok") return { ok: false, reason: rotated.detail }
    pts[fold.apexAs] = rotated.point
    stepInputs.push({
      stepId: fold.stepId,
      parentStateId,
      stateId,
      hingeEntityId: `edge:${fold.hingeFrom}-${fold.hingeTo}`,
      hingeFrom: { name: fold.hingeFrom, position: hFrom },
      hingeTo: { name: fold.hingeTo, position: hTo },
      apexFrom: { name: fold.apex, position: apexPt },
      apexAs: fold.apexAs,
      postApexOverride: rotated.point,
      movingFaceIds: fold.movingFaceIds,
      fixedEntities: Object.keys(pts).filter((id) => id !== fold.apexAs),
      angleDegrees: deg,
      side
    })
    parentStateId = stateId
  }
  return { ok: true, points: pts, stepInputs }
}

export function solveCoupledFoldSequence(input: CoupledFoldSequenceInput): CoupledFoldSequenceResult {
  const { points, folds, distanceTargets, options } = input
  if (folds.length === 0 || folds.length > MAX_COUPLED_FOLDS) {
    return {
      status: "unsupported",
      complete: false,
      provenUnsat: false,
      reason: `耦合折叠步数 ${folds.length} 超出受支持范围 [1, ${MAX_COUPLED_FOLDS}]，显式拒绝而不作错误示意。`
    }
  }

  // Validate chronological topological availability of hinge/apex points before solving
  const known = new Set(Object.keys(points))
  for (const fold of folds) {
    if (!known.has(fold.hingeFrom) || !known.has(fold.hingeTo) || !known.has(fold.apex)) {
      return {
        status: "invalid_order",
        complete: false,
        provenUnsat: false,
        reason: `折叠顺序非法：步骤 "${fold.stepId}" 引用了前序未生成顶点。`
      }
    }
    if (known.has(fold.apexAs) || fold.apex === fold.apexAs) {
      return {
        status: "invalid_order",
        complete: false,
        provenUnsat: false,
        reason: `折叠后点名 "${fold.apexAs}" 与已有顶点重名，违背折前/折后身份隔离。`
      }
    }
    known.add(fold.apexAs)
  }

  const initialAngles = folds.map((f) => f.initialDegrees ?? 60)
  const residual = (degrees: readonly number[]): number[] => {
    const evalRes = evaluateChain(points, folds, degrees)
    if (!evalRes.ok) return distanceTargets.map(() => Number.NaN)
    return distanceTargets.map((target) => {
      const a = evalRes.points[target.point]
      const b = evalRes.points[target.target]
      if (!a || !b) return Number.NaN
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) - target.distance
    })
  }

  const outcome = solveFoldSystem(residual, initialAngles, options)
  if (outcome.status !== "solved" || outcome.degrees.length === 0) {
    const classified = classifyFoldSystemResult(outcome)
    return {
      status: outcome.status === "underdetermined"
        ? "underdetermined"
        : outcome.status === "cancelled"
          ? "cancelled"
          : "not-found",
      complete: false,
      provenUnsat: false,
      reason: classified.reason
    }
  }

  const best = outcome.degrees[0]!
  const finalChain = evaluateChain(points, folds, best)
  if (!finalChain.ok) {
    return {
      status: "not-found",
      complete: false,
      provenUnsat: false,
      reason: finalChain.reason
    }
  }
  const lineage = buildFoldLineage(finalChain.stepInputs)
  if (!lineage.ok) {
    return {
      status: "invalid_order",
      complete: false,
      provenUnsat: false,
      reason: lineage.diagnostics.map((d) => d.reason).join("；")
    }
  }
  return {
    status: "solved",
    complete: false,
    solvedDegrees: best,
    candidateSolutions: outcome.degrees,
    points: finalChain.points,
    lineage: lineage.steps
  }
}
