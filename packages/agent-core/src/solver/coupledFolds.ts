import { solveFoldSystem, type FoldSystemOptions, type FoldSystemOutcome } from "@draw/geometry-kernel"
import type { PlanEnvelope } from "../contracts"
import { readFoldTransformations } from "../figureIntent"
import type { ObligationIR } from "../obligationIR"
import type { PlanCompileResult } from "../planCompiler"

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
