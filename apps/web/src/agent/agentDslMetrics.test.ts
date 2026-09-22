import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { compilePlan, PLAN_SCHEMA_VERSION, type PlanCompileResult } from "@draw/agent-core"
import { describe, expect, it } from "vitest"

import { conicInvariantPlan, obliquePrismSectionPlan } from "./representativeFixtures"

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

const PRISM_BASE = [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: Math.sqrt(3), z: 0 }, { x: 1, y: Math.sqrt(3), z: 0 }]

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
  const prism = { actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: { alias: "prism", basePolygon: PRISM_BASE.map((point) => ({ ...point })), vector: { x: 1, y: 0, z: 4 } } }
  return [
    { name: "representative: oblique prism section", document: createEmptyDocument("geometry3d"), plan: obliquePrismSectionPlan() },
    { name: "representative: conic invariant", document: createEmptyDocument("conics"), plan: conicInvariantPlan(), prompt: "求证 9/OA²+4/OB² 恒为 1" },
    // 缺省字段有安全默认（向量）→ 审计回填、写进 assumptions、照样出草稿。
    { name: "audited omission: prism without a vector", document: createEmptyDocument("geometry3d"), plan: envelope([{ ...prism, inputs: { alias: "prism", basePolygon: PRISM_BASE.map((point) => ({ ...point })) } }]) },
    // 没有安全默认（截面平面）→ **问用户**，不产草稿。
    { name: "unsafe omission: section without a plane", document: createEmptyDocument("geometry3d"), plan: envelope([{ actionId: "section.create", actionKey: "cut", factIds: [], inputs: { alias: "section", sourceId: "solid-1" } }]) },
    // 模型发明字段 → 一次性修复请求（只有路径与原因码）。
    { name: "malformed: unknown field", document: createEmptyDocument("geometry3d"), plan: envelope([{ ...prism, inputs: { ...prism.inputs, faces: [] } }]) }
  ]
}

function auditedSlots(result: PlanCompileResult): { total: number; filled: number } {
  const filled = result.completions.filter((entry) => entry.policy === "safe_default" || entry.policy === "inferred").length
  const given = result.completions.filter((entry) => entry.policy === "given").length
  return { total: given + filled, filled }
}

describe("the Agent DSL slice metrics", () => {
  it("reports the four rates for the representative fixtures and pins them", () => {
    const fixtures = cases()
    const results = fixtures.map((fixture) => ({ fixture, result: compilePlan(fixture.plan, { document: fixture.document, workspace: fixture.document.workspace, prompt: fixture.prompt, conversationId: "metrics", documentGeneration: fixture.document.revision }) }))

    const slots = results.map((entry) => auditedSlots(entry.result))
    const totalSlots = slots.reduce((sum, entry) => sum + entry.total, 0)
    const filledSlots = slots.reduce((sum, entry) => sum + entry.filled, 0)
    const withDraft = results.filter((entry) => entry.result.ok).length
    const clarifications = results.filter((entry) => entry.result.questions.length > 0).length
    const repairs = results.filter((entry) => entry.result.repair !== undefined).length

    const metrics = {
      fixtures: fixtures.length,
      parameterOmissionRate: Number((filledSlots / totalSlots).toFixed(3)),
      repairRate: Number((repairs / fixtures.length).toFixed(3)),
      clarificationRate: Number((clarifications / fixtures.length).toFixed(3)),
      successfulDraftRate: Number((withDraft / fixtures.length).toFixed(3))
    }
    console.log("AGENT_DSL_METRICS", JSON.stringify(metrics))

    /**
     * 口径的断言：**两道代表题都必须成功出草稿**（这是切片的核心承诺），
     * 而遗漏率、澄清率、修复率必须反映夹具里那三条边界路径的存在。
     */
    expect(metrics.fixtures).toBe(5)
    expect(results[0].result.ok).toBe(true)
    expect(results[1].result.ok).toBe(true)
    // 参数遗漏率：只有"棱柱缺向量"与"代表题里的动点 P"这两处需要回填。
    expect(metrics.parameterOmissionRate).toBeGreaterThan(0)
    expect(metrics.parameterOmissionRate).toBeLessThan(0.2)
    // 澄清 1/5（截面缺平面）、修复 2/5（未知字段 + 零向量不属于这一批）。
    expect(metrics.clarificationRate).toBe(0.2)
    expect(metrics.repairRate).toBe(0.2)
    // 成功草稿 3/5（两道代表题 + 缺省被回填的棱柱）。
    expect(metrics.successfulDraftRate).toBe(0.6)
  })
})
