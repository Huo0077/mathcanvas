import { PLAN_SCHEMA_VERSION, type DraftAction, type ParseError, type ParseResult, type PlanEnvelope } from "./contracts"
// 可改字段白名单只有动作层那一份（Fix round 1 / I14）：传输层不再手抄一份更窄的。

import { ACTIONS, type ActionSpec } from "./actionRegistry"
import { MAX_ACTIONS, isPlainObject, boundedArray, boundedString, fail, readStringArray, quotedName, rejectUnknownFields } from "./schemaReaders"

// 这两个模块的东西**继续从这里出去**：`index.ts` 是 `export * from "./schemas"`，
// 所以把它们搬走之后必须在这里转出去，否则包的公开面就变了（调用方一行都不用改）。

export { canonicalContentHash, newDraftId, newRunId, sha256Hex, sha256HexBytes } from "./hashing"
// 回显判据留在了读取层（它要读登记表），所以在这里继续对包外可见。
export { isEchoableName } from "./schemaReaders"
// 登记表与两个公开类型也照旧从本文件出去。
export { ACTIONS, type ActionAuditDescription, type FieldPolicy } from "./actionRegistry"
export { parseActionInputs } from "./actionInputs"
export { UNSUPPORTED_ACTION_IDS, auditEntryFor, describeActions, describeDefaultPolicies, isRegisteredActionId, repairRequestFor, unsupportedActionReason } from "./actionAudit"

/**
 * 运行时 schema 校验与确定性 ID / 哈希（计划 Task 0.2）。
 *
 * 两条纪律来自计划与设计规格：
 * 1. **`unknown` 永不 cast 成 TS 类型** —— 一律经过 `parse*` 收敛（"never cast unknown to a TypeScript type"）；
 * 2. 模型的输出是**不可信数据**：未知 kind / 未知字段 / 未知 actionId / 重复 actionKey / 非有限数值 /
 *    超长字符串与数组 / 未加作用域的引用，全部**拒绝**并给出稳定的错误码，而不是"尽力修补"。
 *
 * 错误码是给 Agent 侧用来走"可见修复路径"的（设计规格 L990），所以它们必须稳定、可枚举。
 */

export type { PlanDefaultPolicy } from "./contracts"
export type { ActionId } from "./actionRegistry"
import type { ActionId } from "./actionRegistry"
import { parseActionInputs } from "./actionInputs"
import { unsupportedActionReason } from "./actionAudit"

/**
 * **认得出但承载不了的名字**（Agent DSL 切片 Task 1）。
 *
 * 球体与三角形五心是**派生量**：内核算得出来（`solveCircumsphere3` / `solveInsphere3` /
 * `triangleCenter2`），但 DSL 里还没有承载它们的图元，也没有"由实体重算出一颗球"的路径。
 * 于是模型照着规格 §1.1 说"给我这个四面体的外接球"时，只有两种可能的行为：
 *
 * 1. 报 `unknown_action` —— 排障者会以为**模型编了一个动作**，而事实是登记表里
 *    没有承载它的位置。这两种失败的性质完全不同（一个是模型的错，一个是我们的缺口）；
 * 2. 报 `unsupported_action` 并说清原因 —— 模型据此可以改成"用观察工具读出半径与球心"，
 *    用户看到的也是一句实话。
 *
 * 所以这张表存在的唯一理由是**把"我们还做不到"与"你在瞎编"分开**（与 `actionIds.ts`
 * 头注释里那次真实故障同源：登记表过期会被误读成模型乱来）。
 */

export function parseDraftAction(input: unknown, path = "action"): ParseResult<DraftAction> {
  const errors: ParseError[] = []
  if (!isPlainObject(input)) {
    return { ok: false, errors: [fail("invalid_type", path, "expected an object")] }
  }
  rejectUnknownFields(input, ["actionId", "actionKey", "inputs", "factIds"], path, errors)

  const actionId = input.actionId
  if (typeof actionId !== "string" || !(actionId in ACTIONS)) {
    /**
     * 两类"不认"必须分得开（见 `UNSUPPORTED_ACTION_IDS` 的头注释）：
     * - `unsupported_action`：这个名字我们**认得**，只是还没有承载它的图元/动作；
     * - `unknown_action`：这个名字谁都没实现过（模型编的，或者登记表过期）。
     */
    const reason = typeof actionId === "string" ? unsupportedActionReason(actionId) : null
    return {
      ok: false,
      errors: [
        ...errors,
        reason === null
          ? fail("unknown_action", `${path}.actionId`, `unregistered action ${quotedName(String(actionId))}`)
          : fail("unsupported_action", `${path}.actionId`, reason)
      ]
    }
  }
  const spec: ActionSpec = ACTIONS[actionId as ActionId]
  const actionKey = boundedString(input.actionKey, `${path}.actionKey`, errors)
  const factIds = readStringArray(input.factIds, `${path}.factIds`, errors)
  const inputs = parseActionInputs(actionId as ActionId, input.inputs, `${path}.inputs`, errors)

  if (inputs !== null) {
    const alias = inputs.alias
    if (spec.requiresAlias && typeof alias !== "string") {
      errors.push(fail("missing_field", `${path}.inputs.alias`, "a new object must declare an alias"))
    }
  }
  if (errors.length > 0) return { ok: false, errors }
  /**
   * 这里构造的是**动作层**的 `DraftAction`（联合类型，`inputs` 按动作名各有形状）。
   *
   * 载荷确实是 `parseActionInputs` 逐字段构造出来的（不是断言出来的），但**类型系统推不出来**：
   * 动作名是运行时的字符串，字段是运行时按白名单装配的。所以这一处的 `as` 是在说明
   * "形状已由上面的校验保证"，而不是绕过校验 —— 上面的每一条 error 都是先决条件。
   */
  return { ok: true, value: { actionId, actionKey: actionKey as string, inputs: inputs as never, factIds: factIds as string[] } as DraftAction }
}

/**
 * 把"喂进来的东西是什么形状"说成一句话。
 *
 * 为什么要有它：原先这里只说 `expected an object`，于是真实运行里用户看到的是
 * `the plan never matched the schema: invalid_type@envelope` —— 模型回的是数组、字符串还是 `null`，
 * **谁也不知道**，而**修复通道**同样拿不到可执行的信息（它只能把同一句话再说一遍给模型听）。
 */
function describePlanShape(input: unknown): string {
  if (Array.isArray(input)) return "an array — the envelope is an object with schemaVersion / kind / goal and one of actions / questions / answer"
  if (input === null) return "null"
  if (typeof input === "string") return "a string — the envelope must be a JSON object, not text that contains one"
  return `a ${typeof input}`
}

/** 解析整个 PlanEnvelope；三个分支的字段集**互不混杂**。 */
export function parsePlanEnvelope(input: unknown): ParseResult<PlanEnvelope> {
  const errors: ParseError[] = []
  if (!isPlainObject(input)) return { ok: false, errors: [fail("invalid_type", "envelope", `expected the plan envelope object, got ${describePlanShape(input)}`)] }

  const kind = input.kind
  if (kind !== "plan" && kind !== "clarification" && kind !== "answer") {
    return { ok: false, errors: [fail("unknown_kind", "envelope.kind", `unexpected kind ${quotedName(String(kind))}`)] }
  }

  const allowed = kind === "plan"
    ? ["schemaVersion", "kind", "goal", "factIds", "assumptions", "actions"]
    : kind === "clarification"
      ? ["schemaVersion", "kind", "goal", "factIds", "assumptions", "questions"]
      : ["schemaVersion", "kind", "goal", "factIds", "assumptions", "answer", "toolResultRefs"]
  rejectUnknownFields(input, allowed, "envelope", errors)

  if (input.schemaVersion !== PLAN_SCHEMA_VERSION) {
    errors.push(fail("schema_version_mismatch", "envelope.schemaVersion", `expected '${PLAN_SCHEMA_VERSION}'`))
  }
  const goal = boundedString(input.goal, "envelope.goal", errors)
  const factIds = readStringArray(input.factIds, "envelope.factIds", errors)

  /**
   * `assumptions` 是**三个分支共用**的可选字段：无论"要作图 / 要问 / 只回答"，
   * 规划器都替用户定了一些东西，而那些东西都要能被看见（见 `contracts.ts` 的 `EnvelopeAssumptions`）。
   *
   * 两种写法都当"没有假设"：字段缺失、显式 `undefined`、以及空数组。
   * "没有假设"与"我检查过、确实没有"在线上只承载一种语义，所以空数组**归一为 `undefined`**，
   * 免得下游出现"`length > 0` 与 `!== undefined` 哪一个才是真"这种分叉。
   */
  const rawAssumptions = "assumptions" in input && input.assumptions !== undefined
    ? readStringArray(input.assumptions, "envelope.assumptions", errors)
    : undefined
  const assumptions = !rawAssumptions || rawAssumptions.length === 0 ? undefined : rawAssumptions

  if (kind === "plan") {
    const rawActions = boundedArray(input.actions, "envelope.actions", errors)
    if (rawActions && rawActions.length === 0) errors.push(fail("empty_actions", "envelope.actions", "a plan needs at least one action"))
    if (rawActions && rawActions.length > MAX_ACTIONS) errors.push(fail("array_too_long", "envelope.actions", `max ${MAX_ACTIONS} actions`))
    const actions: DraftAction[] = []
    const keys = new Set<string>()
    for (const [index, raw] of (rawActions ?? []).entries()) {
      const parsed = parseDraftAction(raw, `envelope.actions[${index}]`)
      if (!parsed.ok) { errors.push(...parsed.errors); continue }
      if (keys.has(parsed.value.actionKey)) {
        errors.push(fail("duplicate_action_key", `envelope.actions[${index}].actionKey`, `action key ${quotedName(parsed.value.actionKey)} is already used in this run`))
        continue
      }
      keys.add(parsed.value.actionKey)
      actions.push(parsed.value)
    }
    if (errors.length > 0) return { ok: false, errors }
    return { ok: true, value: { schemaVersion: PLAN_SCHEMA_VERSION, kind, goal: goal as string, factIds: factIds as string[], assumptions, actions } }
  }

  if (kind === "clarification") {
    const questions = readStringArray(input.questions, "envelope.questions", errors)
    if (questions && questions.length === 0) errors.push(fail("empty_questions", "envelope.questions", "ask at least one concrete question"))
    if (errors.length > 0) return { ok: false, errors }
    return { ok: true, value: { schemaVersion: PLAN_SCHEMA_VERSION, kind, goal: goal as string, factIds: factIds as string[], assumptions, questions: questions as string[] } }
  }

  const answer = boundedString(input.answer, "envelope.answer", errors, { allowEmpty: true })
  const toolResultRefs = readStringArray(input.toolResultRefs, "envelope.toolResultRefs", errors)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, value: { schemaVersion: PLAN_SCHEMA_VERSION, kind, goal: goal as string, factIds: factIds as string[], assumptions, answer: answer as string, toolResultRefs: toolResultRefs as string[] } }
}

