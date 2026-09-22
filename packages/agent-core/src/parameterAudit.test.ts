import { describe, expect, it } from "vitest"

import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "./contracts"
import { auditPlan, completeMissingParameter, type AuditContext } from "./parameterAudit"

/**
 * **参数审计与补全**（Agent DSL 切片 Task 2；规格 §6.3）。
 *
 * 这一层守的是 Global Constraints 里那条最容易做错的：
 *
 * ```text
 * Safe defaults are explicit assumptions; unsafe omissions become clarification.
 * ```
 *
 * 两条推论各自都有一条用例：
 * 1. **安全默认必须变成看得见的假设**：补了 `t = 0.4` 就必须有一条 `assumptions`，
 *    否则用户确认的是一件他没看过的事；
 * 2. **没有安全默认就必须问**：截面的平面无穷多、圆的半径没有公认默认 —— 那时
 *    **一条动作都不许产出**（编一个数字比停下来问更糟）。
 *
 * 第三条同样硬：**显式约束不许被默认值覆盖**。题目说"中点"时参数是 0.5，
 * 审计必须原样保留，而不是拿 0.4 去覆盖它。
 */

const CONTEXT: AuditContext = {
  documentId: "document-1",
  workspace: "geometry3d",
  parameters: [],
  facts: []
}

function plan(actions: unknown[]): PlanEnvelope {
  return { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "test", factIds: [], actions: actions as never }
}

function boundPoint(inputs: Record<string, unknown>) {
  return { actionId: "dynamic.create_bound_point", actionKey: `point-${String(inputs.alias)}`, factIds: [], inputs }
}

describe("parameter audit and completion", () => {
  it("fills an unstated moving point with t = 0.4 and records it as an overridable assumption", () => {
    const result = auditPlan(plan([
      { actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: { alias: "prism", basePolygon: [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 4, y: 4, z: 0 }, { x: 0, y: 4, z: 0 }], vector: { x: 0, y: 0, z: 3 } } },
      boundPoint({ alias: "P", host: { scope: "draft", alias: "prism" }, hostSub: 0 })
    ]), CONTEXT)

    expect(result.ok).toBe(true)
    const point = result.actions[1]
    expect(point.inputs).toMatchObject({ parameter: 0.4 })
    const assumption = result.assumptions.find((entry) => entry.kind === "safe_default" && entry.value === 0.4)
    expect(assumption).toBeDefined()
    expect(assumption?.text).toContain("0.4")
    expect(assumption?.overridable).toBe(true)
    expect(assumption?.path).toBe("envelope.actions[1].inputs.parameter")
    // 假设只有一句人话，界面直接显示它。
    expect(assumption?.text.length ?? 0).toBeLessThan(80)
  })

  it("preserves an explicitly stated midpoint parameter instead of overwriting it with the default", () => {
    const result = auditPlan(plan([
      boundPoint({ alias: "E", host: { scope: "draft", alias: "prism" }, hostSub: 3, parameter: 0.5 })
    ]), CONTEXT)

    expect(result.ok).toBe(true)
    expect(result.actions[0].inputs).toMatchObject({ parameter: 0.5 })
    // 显式约束**不进假设**（它不是"我替你定的"，而是用户说的）。
    expect(result.assumptions).toEqual([])
    expect(result.completions.find((entry) => entry.field === "parameter")?.policy).toBe("given")
  })

  it("infers a stated height from the user's words and falls back to the documented default", () => {
    const cylinder = (prompt: string | undefined) => auditPlan(plan([
      { actionId: "solid.create_template", actionKey: "c", factIds: [], inputs: { alias: "c", template: "cylinder", origin: { x: 0, y: 0, z: 0 }, radius: 2 } }
    ]), { ...CONTEXT, prompt })

    const stated = cylinder("画一个半径 2、高 5 的圆柱")
    expect(stated.actions[0].inputs).toMatchObject({ height: 5 })
    expect(stated.assumptions.some((entry) => entry.kind === "inferred" && entry.value === 5)).toBe(true)

    const unstated = cylinder("画一个半径 2 的圆柱")
    expect(unstated.actions[0].inputs).toMatchObject({ height: 3 })
    expect(unstated.assumptions.some((entry) => entry.value === 3)).toBe(true)

    // 没有半径（既没说、也没有安全默认）→ **问**，而不是拿 1 顶上。
    const noRadius = auditPlan(plan([
      { actionId: "solid.create_template", actionKey: "c", factIds: [], inputs: { alias: "c", template: "cylinder", origin: { x: 0, y: 0, z: 0 } } }
    ]), CONTEXT)
    expect(noRadius.questions.map((question) => question.path)).toContain("envelope.actions[0].inputs.radius")
    expect(noRadius.actions).toEqual([])
  })

  it("asks which host a bound point belongs to instead of inventing one", () => {
    const result = auditPlan(plan([boundPoint({ alias: "E" })]), CONTEXT)

    expect(result.ok).toBe(false)
    expect(result.actions).toEqual([])
    const question = result.questions.find((entry) => entry.path === "envelope.actions[0].inputs.host")
    expect(question).toBeDefined()
    expect(question?.text).toContain("绑在哪个对象")
    // 问题必须带"为什么不能替你定"，否则界面只能说一句"缺信息"。
    expect(question?.reason.length ?? 0).toBeGreaterThan(0)
  })

  it("turns an unsafe omission (a section plane) into a clarification instead of a guess", () => {
    const result = auditPlan(plan([
      { actionId: "section.create", actionKey: "cut", factIds: [], inputs: { alias: "cut", sourceId: "solid-1" } }
    ]), CONTEXT)

    expect(result.ok).toBe(false)
    expect(result.actions).toEqual([])
    expect(result.questions.some((entry) => entry.path === "envelope.actions[0].inputs.plane")).toBe(true)
    expect(result.diagnostics.some((entry) => entry.stage === "field_audit" && entry.code === "unsafe_omission")).toBe(true)
  })

  it("reports contradictory constraints instead of silently picking one", () => {
    // 同一个参数在一次计划里被两处写成不同的初值：只能有一个真值。
    const twoWriters = auditPlan(plan([
      { actionId: "parameter.create", actionKey: "a", factIds: [], inputs: { id: "theta", value: 0.4 } },
      { actionId: "parameter.create", actionKey: "b", factIds: [], inputs: { id: "theta", value: 0.9 } }
    ]), CONTEXT)

    expect(twoWriters.ok).toBe(false)
    expect(twoWriters.actions).toEqual([])
    expect(twoWriters.diagnostics.some((entry) => entry.code === "contradictory_constraint")).toBe(true)

    // 棱上的参数是仿射比例，必须落在 [0, 1]：给 5 不是"默认值问题"，是这条约束本身不成立。
    const outOfRange = auditPlan(plan([
      boundPoint({ alias: "E", host: { scope: "draft", alias: "prism" }, hostSub: 3, parameter: 5 })
    ]), CONTEXT)

    expect(outOfRange.ok).toBe(false)
    expect(outOfRange.diagnostics.some((entry) => entry.code === "parameter_out_of_domain")).toBe(true)
    expect(outOfRange.diagnostics[0].path).toBe("envelope.actions[0].inputs.parameter")
  })

  it("audits one action at a time through the documented interface", () => {
    const result = completeMissingParameter(boundPoint({ alias: "P", host: { scope: "draft", alias: "prism" }, hostSub: 1 }) as never, CONTEXT)

    expect(result.assumptions).toHaveLength(1)
    expect(result.action.inputs).toMatchObject({ parameter: 0.4 })
    // 没有缺失、没有被拒的动作也不产出诊断。
    expect(result.diagnostics).toEqual([])

    // 未登记的动作：审计说"我不认识它"，而不是编一份策略出来。
    const unknown = completeMissingParameter({ actionId: "planar.create_dragon", actionKey: "x", factIds: [], inputs: {} } as never, CONTEXT)
    expect(unknown.diagnostics[0].code).toBe("unknown_action")
    expect(unknown.assumptions).toEqual([])
  })
})
