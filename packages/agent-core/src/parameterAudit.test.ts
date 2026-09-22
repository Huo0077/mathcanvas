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

  it("asks which host a bound point belongs to instead of inventing one", () => {    const result = auditPlan(plan([boundPoint({ alias: "E" })]), CONTEXT)

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
    /**
     * 补不出来的字段由**第四层**（`parameter_completion`）报出来（Fix round 1 / I13）：
     * 以前标成 `field_audit`，于是六层里第四层永远发不出诊断 —— 一层是死的。
     * 现在这一层承载"我补不出来、需要人来定"，`field_audit` 只管策略与矛盾。
     */
    expect(result.diagnostics.some((entry) => entry.stage === "parameter_completion" && entry.code === "unsafe_omission")).toBe(true)
  })

  /**
   * **"任意/恒定"的题目不许被特值化**（Fix round 1 / I4；Global Constraints）。
   *
   * 第一版在 witness 返回 `symbolic` 之后**继续往下走**，于是同一份结果里同时有
   * "题目要求任意，请给特值"和"底面未指定，取边长 4"两句话 —— 前半句是对的，
   * 后半句直接违反了规格 §6.3。现在 `symbolic` 分支直接返回，只留下提问。
   */
  it("keeps an invariant prism request symbolic instead of also filling a witness", () => {
    const result = auditPlan(plan([
      // 底面与向量都缺，而题目要求"任意"。
      { actionId: "solid.create_prism", actionKey: "prism", factIds: [], inputs: { alias: "prism" } }
    ]), { ...CONTEXT, prompt: "画一个任意棱柱" })

    expect(result.ok).toBe(false)
    expect(result.actions).toEqual([])
    expect(result.questions).toHaveLength(1)
    // **没有**任何特值化假设（"底面边长 4"这类）。
    expect(result.assumptions.filter((entry) => entry.text.includes("底面边长"))).toEqual([])
    expect(result.diagnostics.some((entry) => entry.code === "needs_concrete_value" && entry.stage === "parameter_completion")).toBe(true)
  })

  it("fills the size a pyramid needs, instead of letting it die with a cube-shaped error", () => {
    // 棱锥与立方体一样需要 `size`（Fix round 1 / I3）：漏了它，审计会静默放过，
    // 最后在动作编译层报 "a cube needs positive finite x/y/z"。
    const result = auditPlan(plan([
      { actionId: "solid.create_template", actionKey: "pyramid", factIds: [], inputs: { alias: "p", template: "pyramid", origin: { x: 0, y: 0, z: 0 } } }
    ]), CONTEXT)

    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    expect(result.actions[0].inputs).toMatchObject({ size: { x: 2, y: 2, z: 2 } })
    expect(result.assumptions.some((entry) => entry.text.includes("棱长"))).toBe(true)
  })

  it("does not raise a useless assumption when the binding is driven by a document parameter", () => {
    /**
     * `parameterId` 在场时 `parameter` 那个字面量对结果没有影响（内核只看参数），
     * 但它**必须**写进绑定（DSL 校验要求有限数）。所以值照填、假设不写 ——
     * 否则用户会在假设列表里看到"动点位置未指定，取参数 0.4"，而它其实由 θ 驱动（M19）。
     */
    const result = auditPlan(plan([
      { actionId: "dynamic.create_bound_point", actionKey: "P", factIds: [], inputs: { alias: "P", host: { scope: "draft", alias: "ellipse" }, parameterId: "theta" } }
    ]), { ...CONTEXT, parameters: ["theta"], prompt: undefined })

    expect(result.ok).toBe(true)
    expect(result.actions[0].inputs).toMatchObject({ parameter: 0.4, parameterId: "theta" })
    expect(result.assumptions.filter((entry) => entry.path?.endsWith(".parameter") ?? false)).toEqual([])
  })

  it("reports contradictory constraints instead of silently picking one", () => {    // 同一个参数在一次计划里被两处写成不同的初值：只能有一个真值。
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
