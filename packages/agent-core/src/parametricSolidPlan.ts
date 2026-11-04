/**
 * **参数化立体的确定性计划适配**（T5，2026-11-05 四题修复）。
 *
 * 见 [实施计划](../../../../docs/superpowers/plans/2026-11-05-solid-geometry-four-cases.md) T5。
 *
 * ## 它解决的是什么
 *
 * 见证搜索能算出**顶点坐标**，但"可提交的草稿"还需要把**点名的辅助点**（中点、棱上分点、
 * 对角线交点）落成动作。此前这件事在两个产品入口里各写一遍（`localPlanner` 的两处
 * `solid.create_polyhedron`），而辅助点根本没进计划 —— 于是 Case 1/2/3 的草稿上
 * 永远缺 `E` / `D` / `M` / `O`，题设里那几条按名字说的条件一条都核不了。
 *
 * 这一层把"题面 → spec → 见证候选 → 动作链"收成**一处**，两个入口都从这里取：
 *
 * ```text
 * parseObligationWithLegacy → specForPrompt → searchWitness（内部 compilePlan + 独立核验）
 *   → solidWitnessActions（多面体 / 棱柱 + dynamic.create_bound_point）
 * ```
 *
 * ## 三条纪律
 *
 * - **只复用现有动作**：`solid.create_polyhedron` / `solid.create_face` / `solid.create_segment`
 *   / `dynamic.create_bound_point`。不新增公开宏动作、不改 actionRegistry。
 * - **点名不许被默认名字覆盖**：`vertexNames` 直接来自候选（题面的 `A₁B₁C₁` 就是 `A₁B₁C₁`）。
 * - **辅助点是绑定点**：宿主棱 + 参数，不是"位置碰巧正确的自由坐标点"。
 */

import type { PlanEnvelope } from "./contracts"
import { PLAN_SCHEMA_VERSION } from "./contracts"
import { parseObligationWithLegacy } from "./obligationIR"
import { searchWitness, solidWitnessActions, specForPrompt } from "./solver/witnessSearch"
import type { PolyhedronWitness } from "./solver/solverContracts"

export interface ParametricSolidPlanInput {
  prompt: string
  /** 透传给见证搜索的预算（缺省与既有产品路径一致）。 */
  seed?: number
  maxCandidates?: number
  timeoutMs?: number
  /** 空间点坐标写法是否交给同一个解析器（与 `localPlanner` 的三棱锥入口一致）。 */
  spatialPointConditions?: boolean
}

export type ParametricSolidPlanResult =
  /** 题设通过独立核验，草稿可以提交。 */
  | { status: "ok"; plan: PlanEnvelope; candidate: PolyhedronWitness; assumptions: string[] }
  /** 入口认得出、但这组题设给不出可核验的图形：把搜索自己的理由带上。 */
  | { status: "clarification"; reason: string }
  /** 入口语法认不出这种题面（不是本层的活，交给别的意图）。 */
  | { status: "not-applicable"; reason: string }

/**
 * 题面 → 可提交的参数化立体计划。**不写死任何题号 / 字母**：一切来自解析出来的 spec 与关系。
 */
export function tryBuildParametricSolidPlan(input: ParametricSolidPlanInput): ParametricSolidPlanResult {
  const parsed = parseObligationWithLegacy(input.prompt, input.spatialPointConditions === true ? { spatialPointConditions: true } : undefined)
  const givens = parsed.ir.obligations.filter((obligation) => obligation.role === "given")
  const shaped = specForPrompt(input.prompt, givens)
  if (shaped.status !== "ok") return { status: "not-applicable", reason: shaped.reason }

  const searched = searchWitness({
    obligations: parsed.ir,
    shape: shaped.recognised.family,
    spec: shaped.spec,
    seed: input.seed ?? 1,
    maxCandidates: input.maxCandidates ?? 16,
    timeoutMs: input.timeoutMs ?? 10_000
  })
  if (searched.status !== "verified_instance") {
    const detail = searched.status === "no_witness" ? searched.failures.join("；") : searched.reasons.join("；")
    return { status: "clarification", reason: `这条题设目前给不出可核验的图形：${detail.length > 0 ? detail : "搜索没有给出原因文本。"}` }
  }

  const label = shaped.recognised.family === "pyramid"
    ? "棱锥"
    : shaped.recognised.family === "prism"
      ? "棱柱"
      : shaped.recognised.family === "frustum"
        ? "台体"
        : "平面图形"
  const alias = "parametric-solid"
  const plan = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: `按点名关系画一组${label}示意图`,
    factIds: [],
    assumptions: searched.assumptions,
    actions: solidWitnessActions(searched.candidate, alias)
  } as unknown as PlanEnvelope
  return { status: "ok", plan, candidate: searched.candidate, assumptions: searched.assumptions }
}
