import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { auditEntryFor, compilePlan, parsePlanEnvelope, PLAN_SCHEMA_VERSION, type PlanCompileResult } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { CONIC_INVARIANT_PROMPT, OBLIQUE_PRISM_PROMPT, OBLIQUE_VECTOR, RHOMBUS_BASE, conicInvariantPlan, obliquePrismSectionPlan } from "./representativeFixtures"

/**
 * **Agent DSL 切片的四个度量**（Task 7）。
 *
 * 计划的最后一个 checkbox 要"记录参数遗漏率、修复率、澄清率、成功草稿率"。这四个数字
 * 如果只写在报告里，就没人能复核；所以它们在这里**被算出来并被断言钉住**：
 * 夹具变了、审计策略变了，数字会跟着变并且这条会红 —— 那时必须重新记录，而不是留一个
 * 过期数字在文档里。
 *
 * ## 每个数字的口径（写死在下面，避免"率"的定义漂移）
 *
 * - **参数遗漏率** = 审计回填的字段数 ÷ 审计看过的字段槽位数
 *   （槽位 = 每个动作的必填字段 + 登记了默认策略的字段；"给了"与"回填"都算一个槽位，
 *   "要问用户"的也算 —— 它同样是"规划器没给"的那一类）。
 * - **修复率** = 需要一次性修复请求的计划数 ÷ 尝试过的计划数。
 * - **澄清率** = 产出澄清问题（而不是草稿）的计划数 ÷ 尝试过的计划数。
 * - **成功草稿率** = 编译成功（可以进草稿）的计划数 ÷ 尝试过的计划数。
 *
 * 三个"率"的分母都是同一批夹具，所以它们可以直接相加比较（一份计划只会落到
 * 成功 / 澄清 / 修复后仍失败这三种结局之一）。
 */

function envelope(actions: unknown[], assumptions: string[] = []) {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "metric fixture", factIds: [], assumptions, actions }
}

interface MetricCase {
  name: string
  document: GeometryDocument
  plan: unknown
  prompt?: string
}

/** 度量用的夹具集：两道代表题 + 三条真实会走到的边界路径。 */
function cases(): MetricCase[] {
  // 底面与向量都从**夹具自己的导出**取（Fix round 1 / M13）：这里重打一遍数字，
  // 就正好违反 `representativeFixtures.ts` 里"这些数字只有一处"的声明。
  const prism = { actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: { alias: "prism", basePolygon: RHOMBUS_BASE.map((point) => ({ ...point })), vector: { ...OBLIQUE_VECTOR } } }
  return [
    { name: "representative: oblique prism section", document: createEmptyDocument("geometry3d"), plan: obliquePrismSectionPlan(), prompt: OBLIQUE_PRISM_PROMPT },
    { name: "representative: conic invariant", document: createEmptyDocument("conics"), plan: conicInvariantPlan(), prompt: CONIC_INVARIANT_PROMPT },
    // 缺省字段有安全默认（向量）→ 审计回填、写进 assumptions、照样出草稿。
    { name: "audited omission: prism without a vector", document: createEmptyDocument("geometry3d"), plan: envelope([{ ...prism, inputs: { alias: "prism", basePolygon: RHOMBUS_BASE.map((point) => ({ ...point })) } }]) },
    // 没有安全默认（截面平面）→ **问用户**，不产草稿。
    { name: "unsafe omission: section without a plane", document: createEmptyDocument("geometry3d"), plan: envelope([{ actionId: "section.create", actionKey: "cut", factIds: [], inputs: { alias: "section", sourceId: "solid-1" } }]) },
    // 模型发明字段 → 一次性修复请求（只有路径与原因码）。
    { name: "malformed: unknown field", document: createEmptyDocument("geometry3d"), plan: envelope([{ ...prism, inputs: { ...prism.inputs, faces: [] } }]) }
  ]
}

/**
 * **审计槽位**（Fix round 1 / I6）—— 分母的口径必须与注释一致：
 *
 * 一个槽位 = `(动作, 字段)`，其中字段属于该动作的**必填字段 ∪ 登记了默认策略的字段**。
 * 三种结局都算槽位：给了（`given`）、回填了（`safe_default`/`inferred`）、要问用户 / 被拒
 *（`ask_user`/`reject` —— 它们**不产生 completion**，所以分母必须从登记表推导，
 *  不能只数 `completions`，否则"要问用户"的那些槽位被系统性排除、遗漏率被低估）。
 */
function auditedSlots(plan: unknown, result: PlanCompileResult): { total: number; filled: number } {
  const filled = result.completions.filter((entry) => entry.policy === "safe_default" || entry.policy === "inferred").length
  const parsed = parsePlanEnvelope(plan)
  if (!parsed.ok || parsed.value.kind !== "plan") return { total: filled, filled }
  let total = 0
  for (const action of parsed.value.actions) {
    const description = auditEntryFor(action.actionId)
    if (!description) continue
    const fields = new Set([...description.required, ...description.defaults.map((policy) => policy.field)])
    total += fields.size
  }
  return { total, filled }
}

describe("the Agent DSL slice metrics", () => {
  it("reports the four rates for the representative fixtures and pins them", () => {
    const fixtures = cases()
    const results = fixtures.map((fixture) => ({ fixture, result: compilePlan(fixture.plan, { document: fixture.document, workspace: fixture.document.workspace, prompt: fixture.prompt, conversationId: "metrics", documentGeneration: fixture.document.revision }) }))

    const slots = results.map((entry) => auditedSlots(entry.fixture.plan, entry.result))
    const totalSlots = slots.reduce((sum, entry) => sum + entry.total, 0)
    const filledSlots = slots.reduce((sum, entry) => sum + entry.filled, 0)
    const withDraft = results.filter((entry) => entry.result.ok).length
    const clarifications = results.filter((entry) => entry.result.questions.length > 0).length
    const repairs = results.filter((entry) => entry.result.repair !== undefined).length

    const metrics = {
      fixtures: fixtures.length,
      auditedSlots: totalSlots,
      filledSlots,
      parameterOmissionRate: Number((filledSlots / totalSlots).toFixed(3)),
      repairRate: Number((repairs / fixtures.length).toFixed(3)),
      clarificationRate: Number((clarifications / fixtures.length).toFixed(3)),
      successfulDraftRate: Number((withDraft / fixtures.length).toFixed(3))
    }
    console.log("AGENT_DSL_METRICS", JSON.stringify(metrics))

    /**
     * 口径的断言：**两道代表题都必须成功出草稿**（这是切片的核心承诺），
     * 而遗漏率、澄清率、修复率必须反映夹具里那三条边界路径的存在。
     * 四个率都**钉死具体数值**（Fix round 1 / I6：以前只用 `> 0` / `< 0.2` 框着，
     * 回归成两倍遗漏也照样绿）。
     */
    expect(metrics.fixtures).toBe(5)
    expect(results[0].result.ok).toBe(true)
    expect(results[1].result.ok).toBe(true)
    // 分母口径：从登记表推导（含 ask_user/reject 槽位），不是只数 completions。
    expect(metrics.auditedSlots).toBe(55)
    expect(metrics.filledSlots).toBe(3)
    expect(metrics.parameterOmissionRate).toBe(0.055)
    // 澄清 1/5（截面缺平面）、修复 1/5（模型发明字段）。
    expect(metrics.clarificationRate).toBe(0.2)
    expect(metrics.repairRate).toBe(0.2)
    // 成功草稿 3/5（两道代表题 + 缺省被回填的棱柱）。
    expect(metrics.successfulDraftRate).toBe(0.6)
  })
})
