import type { ClarificationQuestion, PlanDiagnostic, PlanEnvelope, StructuredAssumption } from "./contracts"
import type { DraftAction } from "@draw/scene-graph"

import { auditDescriptionFor, fieldPoliciesFor, inferNumberFromText, requiredFieldsFor, type AuditContext, type FieldPolicyReading } from "./defaultPolicies"
import { DEFAULT_PRISM_HEIGHT } from "./localPlanDefaults"
import { selectWitness } from "./underdetermined"

/**
 * **参数审计与补全**（Agent DSL 切片 Task 2；规格 §6.3 + Global Constraints）。
 *
 * ```
 * Safe defaults are explicit assumptions; unsafe omissions become clarification.
 * ```
 *
 * ## 三条纪律，逐条有用例
 *
 * 1. **显式约束优先**：字段给了就**逐字保留**（题目说"中点"→ 参数 0.5 原样留着，
 *    绝不被 `t = 0.4` 的默认覆盖）。这是"审计"与"补全"的区别所在 —— 补全只填空，
 *    不重写已经写好的东西；
 * 2. **回填必须看得见**：每一条安全默认都产出**结构化假设**（`id`/`text`/`kind`/`value`/
 *    `overridable`），界面据此让用户看到"我替你定了什么"；
 * 3. **没有安全默认就问**：`ask_user` 的字段缺失时，**一条动作都不产出**
 *    （`actions: []`）—— 编一个数字比停下来问更糟，因为用户确认的会是一件他没说过的事。
 *
 * ## 为什么默认值要分动作登记，而不是一个通用的零 / 中点
 *
 * 一个"万能默认"（例如缺数字就取 0、缺点就取中点）会让所有动作都长得像能跑，
 * 而错的地方**恰好是几何语义**：截面平面取 z = 0 是换了一道题，圆心取原点却只是排版。
 * 所以策略按 `(动作, 字段)` 登记在传输层那张表里（`schemas.ts`），这里只执行它。
 */

export type { AuditContext } from "./defaultPolicies"

/** 一个字段的最终处理结果（给诊断与测试看：这条字段是被给定的还是被补的）。 */export interface FieldCompletion {
  actionId: string
  actionKey: string
  field: string
  path: string
  policy: "given" | "safe_default" | "inferred"
  value?: unknown
  reason?: string
}

export interface CompletionResult {
  /** 补全之后的动作（未被补全时**原样**返回同一个对象）。 */
  action: DraftAction
  completions: FieldCompletion[]
  assumptions: StructuredAssumption[]
  questions: ClarificationQuestion[]
  diagnostics: PlanDiagnostic[]
  /** 命中 `reject` 策略：这个动作**不该被执行**。 */
  rejected: boolean
}

export interface AuditResult {
  /** 审计通过（没有错误、没有问题）才为 true。 */
  ok: boolean
  /** 可以交给编译器的一批动作；有任何错误/问题时为**空数组**（宁可不做，也不做一半）。 */
  actions: DraftAction[]
  assumptions: StructuredAssumption[]
  questions: ClarificationQuestion[]
  completions: FieldCompletion[]
  diagnostics: PlanDiagnostic[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** 变体条件：`appliesWhen.field` 的取值落在 `in` 里（缺省视为不匹配）。 */
function matchesVariant(inputs: Record<string, unknown>, appliesWhen: { field: string; in: readonly string[] }): boolean {
  const value = inputs[appliesWhen.field]
  return typeof value === "string" && appliesWhen.in.includes(value)
}

/** 字段给了没有：`undefined` 等于"没给"（与 JSON 语义一致，见 `canonicalize` 的注释）。 */
function isProvided(inputs: Record<string, unknown>, field: string): boolean {
  return inputs[field] !== undefined
}

/** 推断出来的值要按字段形状包一层：`size` 是三元组，`height` 是一个数。 */
function shapeInferred(field: string, value: number): unknown {
  return field === "size" ? { x: value, y: value, z: value } : value
}

function assumptionId(actionKey: string, field: string): string {
  return `${actionKey}:${field}`
}

/**
 * **审计并补全一个动作**。
 *
 * `pathPrefix` 决定诊断里的字段路径（`envelope.actions[2].inputs` 或 `action.inputs`），
 * 因为一次性修复只允许改**指得出的那几处** —— 路径写错，修复就等于重发一遍。
 */
export function completeMissingParameter(action: DraftAction, context: AuditContext, pathPrefix = "action.inputs"): CompletionResult {
  const actionId = action.actionId
  const actionKey = action.actionKey
  const description = auditDescriptionFor(actionId)
  const completions: FieldCompletion[] = []
  const assumptions: StructuredAssumption[] = []
  const questions: ClarificationQuestion[] = []
  const diagnostics: PlanDiagnostic[] = []

  if (description === null) {
    // 传输层已经挡过未知动作；审计这一层再挡一次，是因为**审计也可能被直接调用**。
    diagnostics.push({ stage: "field_audit", code: "unknown_action", path: `${pathPrefix.replace(/\.inputs$/, "")}.actionId`, detail: `no registry entry for '${actionId}'`, severity: "error" })
    return { action, completions, assumptions, questions, diagnostics, rejected: true }
  }

  const inputs = isRecord(action.inputs) ? { ...(action.inputs as Record<string, unknown>) } : {}
  let changed = false

  /**
   * **欠定的立体尺寸交给 witness 选择**（Task 3 的入口，规格 §6.3）。
   *
   * 棱柱的底面与向量是同一条几何事实的两半：只补一半（例如向量取默认而底面留着）会得到
   * 一只用户没描述过的实体，而且"题目要求任意/恒定"时**根本不该**给出具体尺寸 ——
   * 那条判据在 `selectWitness` 里（`symbolic` 分支），所以这里必须走它，
   * 而不是自己按登记表塞一组数字。
   */
  if (actionId === "solid.create_prism" && (!isProvided(inputs, "basePolygon") || !isProvided(inputs, "vector"))) {
    const witness = selectWitness({
      kind: "prism",
      prompt: context.prompt,
      constraints: {
        ...(isProvided(inputs, "basePolygon") ? { prism: { basePolygon: inputs.basePolygon as never, vector: (inputs.vector as never) ?? { x: 0, y: 0, z: DEFAULT_PRISM_HEIGHT } } } : {})
      }
    })
    if (witness.status === "witness" && witness.value.kind === "prism") {
      const basePolygon = isProvided(inputs, "basePolygon") ? inputs.basePolygon : witness.value.basePolygon
      const vector = isProvided(inputs, "vector") ? inputs.vector : witness.value.vector
      const baseChanged = basePolygon !== inputs.basePolygon
      const vectorChanged = vector !== inputs.vector
      inputs.basePolygon = basePolygon
      inputs.vector = vector
      changed = true
      if (baseChanged) completions.push({ actionId, actionKey, field: "basePolygon", path: `${pathPrefix}.basePolygon`, policy: "safe_default", value: basePolygon, reason: witness.assumption.text })
      if (vectorChanged) completions.push({ actionId, actionKey, field: "vector", path: `${pathPrefix}.vector`, policy: "safe_default", value: vector, reason: witness.assumption.text })
      assumptions.push({ ...witness.assumption, path: baseChanged ? `${pathPrefix}.basePolygon` : `${pathPrefix}.vector` })
      diagnostics.push(...witness.diagnostics)
      if (!baseChanged && !vectorChanged) {
        // 一个字段都没缺：不需要再多做什么（保持显式约束）。
        assumptions.pop()
      }
    } else if (witness.status === "symbolic") {
      questions.push({
        id: `${actionKey}:size`,
        text: "这道题要求任意/恒定的结论：请给出具体的底面与高度，或者允许我取一组满足条件的特值。",
        reason: witness.value.reason,
        path: `${pathPrefix}.vector`
      })
      diagnostics.push({ stage: "field_audit", code: "needs_concrete_value", path: `${pathPrefix}.vector`, detail: witness.value.reason, severity: "error" })
    } else {
      diagnostics.push(...witness.diagnostics)
    }
  }

  const policies = new Map<string, FieldPolicyReading>(fieldPoliciesFor(actionId).map((policy) => [policy.field, policy]))
  for (const field of requiredFieldsFor(actionId)) {
    if (!policies.has(field)) policies.set(field, { field, policy: "reject" })
  }

  for (const [field, policy] of policies) {
    const path = `${pathPrefix}.${field}`
    /**
     * **变体相关的策略**：椭圆不该被问"抛物线的焦准距"。条件读的是同一个动作里
     * 另一个**已经给定**的字段（`kind` / `template`），所以它不会引入新的输入。
     */
    if (policy.appliesWhen && !matchesVariant(inputs, policy.appliesWhen)) {
      continue
    }
    if (isProvided(inputs, field)) {
      // 显式约束：原样保留。**这一条是整个审计最重要的分支** —— 覆盖它等于改用户的题。
      completions.push({ actionId, actionKey, field, path, policy: "given" })
      continue
    }

    if (policy.policy === "safe_default") {
      inputs[field] = policy.value
      changed = true
      completions.push({ actionId, actionKey, field, path, policy: "safe_default", value: policy.value, reason: policy.reason })
      assumptions.push({
        id: assumptionId(actionKey, field),
        text: policy.reason ?? `未指定 ${field}，取默认值。`,
        kind: "safe_default",
        value: policy.value,
        overridable: true,
        path
      })
      continue
    }

    if (policy.policy === "infer_from_facts") {
      const inferred = policy.infer ? inferNumberFromText(context.prompt ?? "", policy.infer) : null
      const value = inferred === null ? policy.value : shapeInferred(field, inferred)
      if (value === undefined) {
        questions.push({ id: assumptionId(actionKey, field), text: policy.question ?? `请说明 ${field}。`, reason: "这句话里没有可读出的数值，也没有公认的默认值。", path })
        diagnostics.push({ stage: "field_audit", code: "missing_required_field", path, detail: `no value and nothing to infer for '${field}'`, severity: "error" })
        continue
      }
      inputs[field] = value
      changed = true
      completions.push({ actionId, actionKey, field, path, policy: "inferred", value, reason: policy.reason })
      assumptions.push({
        id: assumptionId(actionKey, field),
        text: inferred === null ? (policy.reason ?? `未指定 ${field}，取默认值。`) : `${field} 按你话里的数字取 ${inferred}。`,
        kind: inferred === null ? "safe_default" : "inferred",
        value,
        overridable: true,
        path
      })
      continue
    }

    if (policy.policy === "ask_user") {
      questions.push({
        id: assumptionId(actionKey, field),
        text: policy.question ?? `请说明 ${field}。`,
        reason: "这个字段没有公认的默认值：替你挑一个就是替你改题。",
        path
      })
      diagnostics.push({ stage: "field_audit", code: "unsafe_omission", path, detail: policy.question ?? `'${field}' has no safe default`, severity: "error" })
      continue
    }

    // `reject`：连问都不该问（例如"把散面拼成 Prism"）。
    diagnostics.push({ stage: "field_audit", code: "rejected_by_policy", path, detail: `'${field}' must be provided explicitly`, severity: "error" })
  }

  const rejected = diagnostics.some((diagnostic) => diagnostic.code === "rejected_by_policy" || diagnostic.code === "unknown_action")
  const completed = changed && isRecord(action.inputs) ? ({ ...action, inputs } as DraftAction) : action
  return { action: completed, completions, assumptions, questions, diagnostics, rejected }
}

/**
 * **跨动作的一致性检查**（"矛盾约束"）。
 *
 * 单看一个字段是看不出矛盾的：同一个参数被两处写成不同的初值，只有在**整份计划**上才成立。
 * 这类矛盾必须报出来而不是"后写的赢" —— 后者会让用户看到一份他没法预料的结果，
 * 而且事后无从追查（两处都是"合法"的）。
 */
export function auditPlan(plan: PlanEnvelope, context: AuditContext): AuditResult {
  const assumptions: StructuredAssumption[] = []
  const questions: ClarificationQuestion[] = []
  const completions: FieldCompletion[] = []
  const diagnostics: PlanDiagnostic[] = []
  const completed: DraftAction[] = []

  if (plan.kind !== "plan") {
    // 澄清/只读回答里没有动作可审：审计在这里**明确说没有可审的东西**，而不是给一个空 ok。
    return { ok: true, actions: [], assumptions, questions, completions, diagnostics }
  }

  const parameterWriters = new Map<string, { value: number; path: string }>()

  for (const [index, action] of plan.actions.entries()) {
    const prefix = `envelope.actions[${index}].inputs`
    const result = completeMissingParameter(action, context, prefix)
    completions.push(...result.completions)
    assumptions.push(...result.assumptions)
    questions.push(...result.questions)
    diagnostics.push(...result.diagnostics)
    if (result.rejected) continue
    completed.push(result.action)

    const inputs = isRecord(result.action.inputs) ? (result.action.inputs as Record<string, unknown>) : {}

    // ---- 矛盾一：同一个**新参数**被两处写成不同的初值 ----
    if (action.actionId === "parameter.create" && typeof inputs.id === "string" && typeof inputs.value === "number") {
      const previous = parameterWriters.get(inputs.id)
      if (previous && previous.value !== inputs.value) {
        diagnostics.push({
          stage: "field_audit",
          code: "contradictory_constraint",
          path: `${prefix}.value`,
          detail: `parameter '${inputs.id}' is created twice with different values (${previous.value} at ${previous.path}, ${inputs.value} here)`,
          severity: "error"
        })
      } else if (!previous) {
        parameterWriters.set(inputs.id, { value: inputs.value, path: `${prefix}.value` })
      }
    }

    // ---- 矛盾二：棱上的参数是仿射比例，必须落在 [0, 1] ----
    if (action.actionId === "dynamic.create_bound_point" && inputs.hostSub !== undefined && typeof inputs.parameter === "number") {
      if (inputs.parameter < 0 || inputs.parameter > 1) {
        diagnostics.push({
          stage: "field_audit",
          code: "parameter_out_of_domain",
          path: `${prefix}.parameter`,
          detail: `a parameter along an edge is an affine ratio in [0, 1]; got ${inputs.parameter}`,
          severity: "error"
        })
      }
    }
  }

  const failed = diagnostics.some((diagnostic) => diagnostic.severity === "error") || questions.length > 0
  return {
    ok: !failed,
    // 有任何错误或问题时，**一条动作都不交给编译器**：半份计划比没有计划更难解释。
    actions: failed ? [] : completed,
    assumptions,
    questions,
    completions,
    diagnostics
  }
}
