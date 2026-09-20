import { PLAN_SCHEMA_VERSION, type DraftAction, type ParseError, type ParseResult, type PlanEnvelope } from "./contracts"
import type { DraftActionId } from "@draw/scene-graph"
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

const MAX_STRING = 512
const MAX_ARRAY = 32
const MAX_ACTIONS = 32
const MAX_DEPTH = 12

// ---------------------------------------------------------------- 错误与基础校验

function fail(code: string, path: string, detail: string): ParseError {
  return { code, path, detail }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/** 有限数检查：`NaN` / `±Infinity` 一律拒绝（非有限数会污染几何内核）。 */
function finiteNumber(value: unknown, path: string, errors: ParseError[]): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(fail("non_finite_number", path, "expected a finite number"))
    return null
  }
  return value
}

function boundedString(value: unknown, path: string, errors: ParseError[], { allowEmpty = false } = {}): string | null {
  if (typeof value !== "string") {
    errors.push(fail("invalid_type", path, "expected a string"))
    return null
  }
  if (!allowEmpty && value.length === 0) {
    errors.push(fail("empty_string", path, "expected a non-empty string"))
    return null
  }
  if (value.length > MAX_STRING) {
    errors.push(fail("string_too_long", path, `max ${MAX_STRING} characters`))
    return null
  }
  return value
}

function boundedArray(value: unknown, path: string, errors: ParseError[]): unknown[] | null {
  if (!Array.isArray(value)) {
    errors.push(fail("invalid_type", path, "expected an array"))
    return null
  }
  if (value.length > MAX_ARRAY) {
    errors.push(fail("array_too_long", path, `max ${MAX_ARRAY} items`))
    return null
  }
  return value
}

/** 字段白名单：多一个字段就拒绝 —— 模型不能自己发明"提交版本"或"授权"之类的东西。 */
function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: ParseError[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(fail("unknown_field", `${path}.${key}`, `unexpected field '${key}'`))
  }
}

function readStringArray(value: unknown, path: string, errors: ParseError[]): string[] | null {
  const items = boundedArray(value, path, errors)
  if (!items) return null
  const out: string[] = []
  for (const [index, item] of items.entries()) {
    const text = boundedString(item, `${path}[${index}]`, errors)
    if (text !== null) out.push(text)
  }
  return out
}

function readVector3(value: unknown, path: string, errors: ParseError[]): { x: number; y: number; z: number } | null {
  if (!isPlainObject(value)) {
    errors.push(fail("invalid_type", path, "expected an object"))
    return null
  }
  rejectUnknownFields(value, ["x", "y", "z"], path, errors)
  const x = finiteNumber(value.x, `${path}.x`, errors)
  const y = finiteNumber(value.y, `${path}.y`, errors)
  const z = finiteNumber(value.z, `${path}.z`, errors)
  return x === null || y === null || z === null ? null : { x, y, z }
}

// ---------------------------------------------------------------- 作用域引用

/**
 * 新对象用 `{scope:"draft",alias}`；既有对象用 `{scope:"scene",ref:{documentId,entityId}}`。
 *
 * ## 为什么返回值有两种形状（这不是笔误）
 *
 * **输入**只有上面那一种写法 —— 只给 `entityId` 的裸引用一律 `unscoped_reference`，
 * 因为"名字不是 ID"（设计规格 §6）。**输出**必须与**动作层真正读的字段**逐字一致，
 * 而动作层在这两类引用上是不同的：
 *
 * - `scope:"draft"` 的别名不在 `inputs` 里解析，而是由编译器经 `idAllocator` 换成真 id，
 *   所以别名**原样带过去**（`{scope:"draft",alias}`）。
 * - `scope:"scene"` 的既有对象引用，动作层 `SceneReference` 就是**扁平**的
 *   `{documentId,entityId}`（`packages/scene-graph/src/actions/types.ts`），
 *   编译器读的是 `inputs.target.documentId`。所以这里必须**摊平**成那个形状。
 *
 * 摊平之前这里返回 `{scope:"scene",ref:{…}}`，而编译器读 `inputs.target.documentId`
 * ——于是 `object.update_inputs` / `dynamic.bind_point` / `dynamic.bind_curve`
 * **不存在任何一种能同时通过校验并被正确编译的输入**：传输层唯一接受的形状让编译器
 * 读到 `undefined`，编译器真正需要的形状被传输层判 `unscoped_reference`。
 * 缝没有被发现，是因为两侧的测试各自只喂自己那一半的形状
 * （见 `planToCompile.seam.test.ts`，那里现在用**已校验的输出**钉住这条接缝）。
 *
 * 注意这里**没有放宽任何校验**：形状、字段白名单、`documentId`/`entityId` 的边界
 * 与去重都照旧执行，变的只是"交给下一层时写哪个形状"。
 */
function readScopedReference(value: unknown, path: string, errors: ParseError[]): unknown | null {
  if (!isPlainObject(value)) {
    errors.push(fail("invalid_type", path, "expected an object"))
    return null
  }
  const scope = value.scope
  if (scope === "draft") {
    rejectUnknownFields(value, ["scope", "alias"], path, errors)
    const alias = boundedString(value.alias, `${path}.alias`, errors)
    return alias === null ? null : { scope: "draft", alias }
  }
  if (scope === "scene") {
    rejectUnknownFields(value, ["scope", "ref"], path, errors)
    if (!isPlainObject(value.ref)) {
      errors.push(fail("invalid_type", `${path}.ref`, "expected an object"))
      return null
    }
    rejectUnknownFields(value.ref, ["documentId", "entityId"], `${path}.ref`, errors)
    const documentId = boundedString(value.ref.documentId, `${path}.ref.documentId`, errors)
    const entityId = boundedString(value.ref.entityId, `${path}.ref.entityId`, errors)
    // 摊平成动作层的 `SceneReference`（见函数头注释）：编译器读的就是这两个字段。
    return documentId === null || entityId === null ? null : { documentId, entityId }
  }
  // 缺 scope（或 scope 不认识）= 未加作用域的引用：只给 alias 或只给 entityId 都不算数。
  errors.push(fail("unscoped_reference", path, "a reference must declare scope: 'draft' (alias) or 'scene' (ref)"))
  return null
}

// ---------------------------------------------------------------- 动作注册表

interface ActionSpec {
  /** inputs 里除 `alias` 之外允许出现的字段。 */
  inputFields: readonly string[]
  /** 是否要求 inputs.alias（新建对象都要，修改既有对象不需要）。 */
  requiresAlias: boolean
  /** 是否存在"必须有"的引用字段（`scoped` = 带 documentId 的引用，`id` = 同文档内的裸 id）。 */
  requireReference?: { field: string; kind: "scoped" | "id" }
}

/**
 * **传输层的动作登记表**。
 *
 * ## 这份表曾经是错的（实测缺陷，已修）
 *
 * 它原先只登记了 4 个动作，而动作层（`packages/scene-graph/src/actions/`）实现了 **20** 个。
 * 后果是静默的：模型给出一个合法动作 → `parseDraftAction` 报 `unknown_action` →
 * 看起来像"模型编了个不存在的动作"，实际是登记表过期，于是**十几个已实现的动作
 * 根本无法从模型输出到达编译器**。更糟的是其中两项（`object.delete` / `object.update`）
 * **动作层根本不存在**，等于教模型用错名字。
 *
 * ## 两条纪律
 *
 * 1. **名字必须与动作层一致**：下面的 `satisfies` 用 `DraftActionId`（从动作层联合类型导出）
 *    做双向检查 —— 少一个、多一个都编译失败。运行期另有 `actionIds.test.ts` 再核对一次。
 * 2. **这里只做"认名字 + 拒绝畸形载荷"**：半径必须为正、坐标必须有限、工作区是否允许该动作……
 *    这些**语义**校验已经完整地存在于动作编译器里，而且是唯一一份。传输层再抄一遍必然分叉，
 *    后果是"schema 放行、编译器拒绝"这类莫名其妙的失败。所以载荷的语义留给编译器。
 */
const ACTIONS = {
  // --- 平面创建：输入形状见 `PlanarCreateAction`（points / center / radius / 角度） ---
  "planar.create_point": { inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"], requiresAlias: true },
  "planar.create_line": { inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"], requiresAlias: true },
  "planar.create_segment": { inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"], requiresAlias: true },
  "planar.create_ray": { inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"], requiresAlias: true },
  "planar.create_polyline": { inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"], requiresAlias: true },
  "planar.create_circle": { inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"], requiresAlias: true },
  "planar.create_arc": { inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"], requiresAlias: true },

  // --- 空间模板：字段须与 `SolidCreateTemplateAction` 一致（不能带 segments，动作层没有） ---
  "solid.create_template": { inputFields: ["alias", "template", "origin", "size", "radius", "height", "label"], requiresAlias: true },

  // --- 动点 ---
  // 引用是两个**带 documentId** 的引用：跨文档绑定必须能说清是哪两份文档里的哪两个对象。
  "dynamic.bind_point": { inputFields: ["target", "host", "parameter"], requiresAlias: false, requireReference: { field: "target", kind: "scoped" } },
  // 这里是**同文档内的裸 id**（动作层用 `findPrimitive` 在目标文档里查），不是作用域引用。
  "dynamic.bind_curve": { inputFields: ["target", "pathId", "parameter"], requiresAlias: false, requireReference: { field: "target", kind: "scoped" } },
  "dynamic.create_locus": { inputFields: ["alias", "sourcePointId"], requiresAlias: true, requireReference: { field: "sourcePointId", kind: "id" } },
  "dynamic.set_radius_rule": { inputFields: ["circleId", "pointId", "factor"], requiresAlias: false, requireReference: { field: "circleId", kind: "id" } },

  // --- 函数 ---
  "function.create_tangent": { inputFields: ["alias", "sourceId", "x", "anchor"], requiresAlias: true, requireReference: { field: "sourceId", kind: "id" } },
  "function.analyze": { inputFields: ["alias", "sourceId", "analysis"], requiresAlias: true, requireReference: { field: "sourceId", kind: "id" } },

  // --- 截面 ---
  // `SectionCreateAction` 收的是裸 `sourceId`（**不是** scoped 引用），与 `section.materialize` 一致。
  "section.create": { inputFields: ["alias", "sourceId", "plane"], requiresAlias: true, requireReference: { field: "sourceId", kind: "id" } },
  "section.materialize": { inputFields: ["sectionId"], requiresAlias: false, requireReference: { field: "sectionId", kind: "id" } },

  // --- 对象与参数 ---
  "object.delete_many": { inputFields: ["targets"], requiresAlias: false, requireReference: { field: "targets", kind: "id" } },
  "object.update_inputs": { inputFields: ["target", "patch"], requiresAlias: false, requireReference: { field: "target", kind: "scoped" } },
  "parameter.set": { inputFields: ["id", "value", "min", "max", "step", "label"], requiresAlias: false, requireReference: { field: "id", kind: "id" } },
  "parameter.set_expression": { inputFields: ["id", "expression"], requiresAlias: false, requireReference: { field: "id", kind: "id" } }
} as const satisfies Record<DraftActionId, ActionSpec>

export type ActionId = keyof typeof ACTIONS

const SOLID_TEMPLATES = ["cube", "pyramid", "cylinder", "cone"] as const

function parseActionInputs(actionId: ActionId, value: unknown, path: string, errors: ParseError[]): Record<string, unknown> | null {
  if (!isPlainObject(value)) {
    errors.push(fail("invalid_type", path, "expected an object"))
    return null
  }
  const spec: ActionSpec = ACTIONS[actionId]
  rejectUnknownFields(value, spec.inputFields, path, errors)

  // 新对象由 `inputs.alias` 定义（设计规格 L932）。**要把 alias 带进解析结果**，
  // 否则下游拿到的是一个"看起来合法但没有别名"的 inputs。
  const alias = spec.requiresAlias ? boundedString(value.alias, `${path}.alias`, errors) : null
  const withAlias = (fields: Record<string, unknown>) => (alias === null ? fields : { alias, ...fields })

  switch (actionId) {
    case "solid.create_template": {
      const template = value.template
      if (typeof template !== "string" || !(SOLID_TEMPLATES as readonly string[]).includes(template)) {
        errors.push(fail("invalid_template", `${path}.template`, `expected one of ${SOLID_TEMPLATES.join(", ")}`))
        return null
      }
      const origin = readVector3(value.origin, `${path}.origin`, errors)
      const out: Record<string, unknown> = withAlias({ template, origin })
      if (value.size !== undefined) out.size = readVector3(value.size, `${path}.size`, errors)
      if (value.radius !== undefined) out.radius = finiteNumber(value.radius, `${path}.radius`, errors)
      if (value.height !== undefined) out.height = finiteNumber(value.height, `${path}.height`, errors)
      if (typeof value.label === "string") out.label = value.label
      // 不同模板的要求不同，不能把 size 通用于所有实体（设计规格 L968）。
      if (template === "cube" && out.size === null) {
        errors.push(fail("missing_field", `${path}.size`, "cube requires origin and size"))
      }
      if ((template === "cylinder" || template === "cone") && out.radius === null) {
        errors.push(fail("missing_field", `${path}.radius`, `${template} requires radius`))
      }
      return out
    }

    case "object.update_inputs": {
      const target = readScopedReference(value.target, `${path}.target`, errors)
      const patch = isPlainObject(value.patch)
        ? (rejectUnknownFields(value.patch, ["label", "visible", "locked", "stroke", "fill", "opacity"], `${path}.patch`, errors), value.patch)
        : (errors.push(fail("invalid_type", `${path}.patch`, "expected an object")), null)
      return withAlias({ target, patch })
    }

    case "object.delete_many": {
      // 整批删除：目标是一个裸 id 数组（动作层会把它编成**一个** `deleteObjects` 操作）。
      if (!Array.isArray(value.targets)) {
        errors.push(fail("invalid_type", `${path}.targets`, "expected an array of object ids"))
        return null
      }
      const targets = value.targets.map((entry, index) => boundedString(entry, `${path}.targets[${index}]`, errors))
      if (targets.some((entry) => entry === null)) return null
      return withAlias({ targets })
    }

    default: {
      /**
       * 其余动作的载荷按登记表的字段白名单**原样透传**。
       *
       * 这不是"不校验"：字段白名单已经在上面 `rejectUnknownFields` 里执行过，
       * 而**语义**校验（半径为正、坐标有限、工作区是否允许）在动作编译器里，且只有那一份。
       * 在这里再抄一遍必然分叉，症状是"schema 放行、编译器拒绝"。
       */
      const reference = spec.requireReference
      if (reference?.kind === "scoped") {
        const resolved = readScopedReference(value[reference.field], `${path}.${reference.field}`, errors)
        if (resolved === null) return null
        return withAlias({ ...value, [reference.field]: resolved })
      }
      return withAlias({ ...value })
    }
  }
}

/** 解析单个动作；`unknown` 一律走校验，不做任何类型断言。 */
export function parseDraftAction(input: unknown, path = "action"): ParseResult<DraftAction> {
  const errors: ParseError[] = []
  if (!isPlainObject(input)) {
    return { ok: false, errors: [fail("invalid_type", path, "expected an object")] }
  }
  rejectUnknownFields(input, ["actionId", "actionKey", "inputs", "factIds"], path, errors)

  const actionId = input.actionId
  if (typeof actionId !== "string" || !(actionId in ACTIONS)) {
    return { ok: false, errors: [...errors, fail("unknown_action", `${path}.actionId`, `unregistered action '${String(actionId)}'`)] }
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

/** 解析整个 PlanEnvelope；三个分支的字段集**互不混杂**。 */
export function parsePlanEnvelope(input: unknown): ParseResult<PlanEnvelope> {
  const errors: ParseError[] = []
  if (!isPlainObject(input)) return { ok: false, errors: [fail("invalid_type", "envelope", "expected an object")] }

  const kind = input.kind
  if (kind !== "plan" && kind !== "clarification" && kind !== "answer") {
    return { ok: false, errors: [fail("unknown_kind", "envelope.kind", `unexpected kind '${String(kind)}'`)] }
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
        errors.push(fail("duplicate_action_key", `envelope.actions[${index}].actionKey`, `action key '${parsed.value.actionKey}' is already used in this run`))
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

// ---------------------------------------------------------------- 确定性 ID

let idCounter = 0

function mintId(prefix: string): string {
  idCounter += 1
  // 计数器保证同一毫秒内也不重复；随机段避免跨进程碰撞。
  const random = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36).padStart(3, "0")}${random}`
}

export function newRunId(): string { return mintId("run_") }
export function newDraftId(): string { return mintId("draft_") }

// ---------------------------------------------------------------- 规范化哈希

const HASH_IGNORED_KEYS = new Set([
  "viewport", "zoom", "panX", "panY", "selection", "selectedIds", "hoveredId",
  "updatedAt", "createdAt", "timestamp", "logs", "transcript", "cursor"
])

/** 规范化 JSON：键排序、丢视图/时间类字段、拒绝非有限数（NaN 会悄悄变成 null，语义必须显式）。 */
function canonicalize(value: unknown, depth = 0): string {
  if (depth > MAX_DEPTH) throw new Error("canonicalContentHash: value is too deep")
  if (value === null) return "null"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalContentHash: non-finite number")
    return JSON.stringify(value)
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item, depth + 1)).join(",")}]`
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .filter((key) => !HASH_IGNORED_KEYS.has(key))
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], depth + 1)}`)
    return `{${entries.join(",")}}`
  }
  throw new Error(`canonicalContentHash: unsupported value of type ${typeof value}`)
}

/**
 * 内容哈希（SHA-256，64 位十六进制）。
 *
 * 覆盖**影响语义**的内容（几何、语义链接、已确认事实、关联标注），
 * **不包含**时间、运行日志、视图临时状态 —— 否则"只是滚了一下画布"就会让预览失效。
 * 纯 TypeScript 实现，因此浏览器与 Node 结果一致、也不需要任何依赖。
 */
export function canonicalContentHash(value: unknown): string {
  return sha256Hex(canonicalize(value))
}

/** FIPS 180-4 的 SHA-256（同步、无依赖）。 */
function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message)
  const bitLength = bytes.length * 8

  const withPadding = new Uint8Array((((bytes.length + 9) >> 6) + 1) << 6)
  withPadding.set(bytes)
  withPadding[bytes.length] = 0x80
  const view = new DataView(withPadding.buffer)
  view.setUint32(withPadding.length - 4, bitLength >>> 0, false)
  view.setUint32(withPadding.length - 8, Math.floor(bitLength / 0x100000000), false)

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ])

  const w = new Uint32Array(64)
  const rotr = (value: number, bits: number) => ((value >>> bits) | (value << (32 - bits))) >>> 0

  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const s0 = (rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3)) >>> 0
      const s1 = (rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10)) >>> 0
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let index = 0; index < 64; index += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const temp1 = (hh + s1 + ch + k[index] + w[index]) >>> 0
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const temp2 = (s0 + maj) >>> 0
      hh = g; g = f; f = e
      e = (d + temp1) >>> 0
      d = c; c = b; b = a
      a = (temp1 + temp2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0
  }

  return [...h].map((word) => word.toString(16).padStart(8, "0")).join("")
}
