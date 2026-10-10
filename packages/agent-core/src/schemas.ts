import { PLAN_SCHEMA_VERSION, type DraftAction, type ParseError, type ParseResult, type PlanEnvelope, type PlanRelation, type PlanRelationKind, type PlanRelationTarget, type PromptNormalisations } from "./contracts"
// 可改字段白名单只有动作层那一份（Fix round 1 / I14）：传输层不再手抄一份更窄的。

import { ACTIONS, type ActionSpec } from "./actionRegistry"
import { MAX_ACTIONS, isPlainObject, boundedArray, boundedString, fail, optionalFiniteNumber, readStringArray, quotedName, rejectUnknownFields } from "./schemaReaders"

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

/**
 * 本批能核验的关系种类（设计 2026-10-03 §5.1）。**与 `contracts.ts` 的 `PlanRelationKind` 对齐**，
 * 由 `const RELATION_KINDS: readonly PlanRelationKind[]` 这一行注解保证：漏一个会在编译期报错。
 *
 * 为什么要有这张表而不是"kind 是任意字符串"：内核**没有判据**的关系（例如"相切"）如果被放进来，
 * 下游核验取不到残差，只能当"无法判定" —— 那是最容易被读成"已满足"的一种状态。
 */
const RELATION_KINDS: readonly PlanRelationKind[] = ["perpendicular", "parallel", "coplanar", "pointOn", "equalLength", "ratio", "midpoint"]

/**
 * 读关系表。
 *
 * 只挡**形状**（是不是对象 / kind 认不认识 / targets 是不是非空顶点数组），
 * **几何含义**留给 `relations.ts` 的残差 —— 那条边界与 `solid.create_polyhedron` 的注释同源：
 * 传输层不抄一遍几何语义。
 */
/**
 * **模型给的题面改写**的形状校验（2026-10-10 第二件）。
 *
 * 这里只校验"两条非空字符串"这一层；**语义**（指不回原文 / 编造点名 / 关系换弱 / 改写后仍读不出）
 * 由 `promptNormalization.ts` 判 —— 那些判据只有一个家，这里不抄第二遍。
 */
function readNormalisations(value: unknown, path: string, errors: ParseError[]): PromptNormalisations | null {
  const items = boundedArray(value, path, errors)
  if (!items) return null
  const out: PromptNormalisations = []
  for (const [index, entry] of items.entries()) {
    if (!isPlainObject(entry)) { errors.push(fail("invalid_type", `${path}[${index}]`, "a normalisation must be an object")); continue }
    const original = entry.original
    const normalized = entry.normalized
    if (typeof original !== "string" || typeof normalized !== "string" || original.trim().length === 0 || normalized.trim().length === 0) {
      errors.push(fail("invalid_type", `${path}[${index}]`, "a normalisation needs non-empty original and normalized strings"))
      continue
    }
    out.push({ original, normalized })
  }
  return out
}

function readRelations(value: unknown, path: string, errors: ParseError[]): PlanRelation[] | null {
  const items = boundedArray(value, path, errors)
  if (!items) return null
  /**
   * **空数组 = 没声明**（2026-10-04 放宽，用户同意）。
   *
   * 原先这里报 `empty_relations`，理由是"声明了却一条都没有，等于什么也没回应"。那在
   * **关系由模型声明**的时代说得通；现在关系改由**系统从原话里抽**，`relations` 只是
   * "自愿补充"，空数组与不写是同一件事。用户现场就撞上过：模型写了 `relations: []`，
   * 被拒一次、白跑一轮修复。
   *
   * 与 `assumptions` / `factIds` 同一条口径：**空 = 没声明**。
   */
  if (items.length === 0) return []
  const relations: PlanRelation[] = []
  for (const [index, item] of items.entries()) {
    const itemPath = `${path}[${index}]`
    if (!isPlainObject(item)) {
      errors.push(fail("invalid_type", itemPath, "expected a relation object"))
      continue
    }
    rejectUnknownFields(item, ["id", "kind", "targets", "value"], itemPath, errors)

    const kind = item.kind
    if (typeof kind !== "string" || !RELATION_KINDS.includes(kind as PlanRelationKind)) {
      errors.push(fail("invalid_type", `${itemPath}.kind`, `expected one of ${RELATION_KINDS.join(" | ")}`))
      continue
    }
    const relationKind = kind as PlanRelationKind

    const rawTargets = boundedArray(item.targets, `${itemPath}.targets`, errors)
    if (!rawTargets) continue
    if (rawTargets.length === 0) {
      errors.push(fail("empty_targets", `${itemPath}.targets`, "a relation needs at least one target vertex"))
      continue
    }
    const targets: PlanRelationTarget[] = []
    for (const [targetIndex, rawTarget] of rawTargets.entries()) {
      const targetPath = `${itemPath}.targets[${targetIndex}]`
      if (!isPlainObject(rawTarget)) {
        errors.push(fail("invalid_type", targetPath, "expected a target object"))
        continue
      }
      rejectUnknownFields(rawTarget, ["vertex"], targetPath, errors)
      const vertex = boundedString(rawTarget.vertex, `${targetPath}.vertex`, errors)
      if (vertex === null) continue
      targets.push({ vertex })
    }

    const id = item.id === undefined ? undefined : boundedString(item.id, `${itemPath}.id`, errors)
    const value = optionalFiniteNumber(item.value, `${itemPath}.value`, errors)
    relations.push({
      ...(id === null || id === undefined ? {} : { id }),
      kind: relationKind,
      targets,
      ...(value === null || value === undefined ? {} : { value })
    })
  }
  return relations
}

/** 解析整个 PlanEnvelope；三个分支的字段集**互不混杂**。 */
export function parsePlanEnvelope(input: unknown): ParseResult<PlanEnvelope> {
  const errors: ParseError[] = []
  if (!isPlainObject(input)) return { ok: false, errors: [fail("invalid_type", "envelope", `expected the plan envelope object, got ${describePlanShape(input)}`)] }

  /**
   * **`kind` 可以推断**（2026-10-04，用户同意放宽）。
   *
   * 实测四次不合格的信封，模型每次缺的顶层字段都不同（`kind` / `actions` / `factIds`），
   * 而它稳定产出的是**动作本身**。`kind` 的信息量几乎为零：带 `actions` 就是 plan。
   * 所以缺 `kind` 时按内容推断，**不再因为一个推断得出来的字段把整份计划拒掉**。
   *
   * 推断不出来（既没有 actions，也没有 questions/answer）时才真拒 —— 那时确实不知道它想干什么。
   */
  const kind = input.kind ?? ("actions" in input ? "plan" : "questions" in input ? "clarification" : "answer" in input ? "answer" : undefined)
  if (kind !== "plan" && kind !== "clarification" && kind !== "answer") {
    return { ok: false, errors: [fail("unknown_kind", "envelope.kind", `unexpected kind ${quotedName(String(input.kind))}`)] }
  }

  const allowed = kind === "plan"
    ? ["schemaVersion", "kind", "goal", "factIds", "assumptions", "relations", "normalisations", "actions"]
    : kind === "clarification"
      ? ["schemaVersion", "kind", "goal", "factIds", "assumptions", "questions"]
      : ["schemaVersion", "kind", "goal", "factIds", "assumptions", "answer", "toolResultRefs"]
  rejectUnknownFields(input, allowed, "envelope", errors)

  /**
   * **样板字段漏了就当默认值**（2026-10-04，用户同意放宽）。
   *
   * 两处都不是"内容"，而是**只有一个合理取值的样板**：
   * - `schemaVersion`：系统自己知道当前版本，模型漏了补上即可（它没有第二种取值）；
   * - `factIds`：下游本来就归一到"空 = 没声明"（与 `assumptions` 同一条口径）。
   *
   * 为什么值得放宽：实测模型连续四次在不同的样板字段上翻车（`kind` / `actions` / `factIds`），
   * 而**要求 `factIds: []` 这种零信息字段必须出现，收益为零、代价是每次运行都在这里失败**。
   * 这与方案 C 是同一条原则：**质量门禁不能依赖模型稳定产出它能做对、但做不稳的东西。**
   *
   * 仍然必填的是 `goal`（给人看的一句话，模型一直写得出）与 `actions`（真正的意图）。
   * `goal` **原样保留模型的话**，系统不替它编。
   */
  // 只在"给了但给错"时报错；缺失走默认值。
  if (input.schemaVersion !== undefined) {
    if (input.schemaVersion !== PLAN_SCHEMA_VERSION) {
      errors.push(fail("schema_version_mismatch", "envelope.schemaVersion", `expected '${PLAN_SCHEMA_VERSION}'`))
    }
  }
  const goal = boundedString(input.goal, "envelope.goal", errors)
  const factIds = input.factIds === undefined ? [] : readStringArray(input.factIds, "envelope.factIds", errors)

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

  /**
   * **关系表**（设计 2026-10-03 §5.1）：题目显式给出的几何关系，供执行前逐条核验。
   *
   * 只放行**这一个具名字段**，白名单不整体放宽 —— 提示词里"白名单之外的字段一律被拒"
   * 那条纪律对别的字段仍然成立（实测：这个字段当初就是被 `rejectUnknownFields` 拒掉的）。
   *
   * 与 `assumptions` 同一条归一规则：缺省 / 显式 undefined / **空数组**都当"没声明"
   *（2026-10-04 放宽：关系改由系统从原话里抽之后，`relations` 只是自愿补充，空数组与不写
   * 是同一件事 —— 原先报 `empty_relations` 会让模型白跑一轮修复）。
   */
  const rawRelations = "relations" in input && input.relations !== undefined
    ? readRelations(input.relations, "envelope.relations", errors)
    : undefined
  const relations = !rawRelations || rawRelations.length === 0 ? undefined : rawRelations

  /**
   * **模型给的题面改写**（2026-10-10 第二件）。与 `relations` 同一条口径：只放行这一个具名字段，
   * 形状在这里校验（两条非空字符串），**语义**由 `promptNormalization.ts` 判 ——
   * "指不回原文 / 编造点名 / 关系换弱"那些判据只有一个家，不在这里再写一遍。
   * 缺省 / 空数组都当"没写"。
   */
  const rawNormalisations = "normalisations" in input && input.normalisations !== undefined
    ? readNormalisations(input.normalisations, "envelope.normalisations", errors)
    : undefined
  const normalisations = !rawNormalisations || rawNormalisations.length === 0 ? undefined : rawNormalisations

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
    return { ok: true, value: { schemaVersion: PLAN_SCHEMA_VERSION, kind, goal: goal as string, factIds: factIds as string[], assumptions, relations, ...(normalisations === undefined ? {} : { normalisations }), actions } }
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

