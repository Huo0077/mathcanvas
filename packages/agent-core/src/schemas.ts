import { PLAN_SCHEMA_VERSION, type DraftAction, type ParseError, type ParseResult, type PlanDefaultPolicy, type PlanEnvelope, type RepairRequest } from "./contracts"
// 可改字段白名单只有动作层那一份（Fix round 1 / I14）：传输层不再手抄一份更窄的。
import { updatableInputFields, type DraftActionId } from "@draw/scene-graph"
import { DEFAULT_CENTER_2D, DEFAULT_DYNAMIC_POINT_PARAMETER, DEFAULT_ORIGIN_3D, DEFAULT_PRISM_HEIGHT, DEFAULT_PRISM_SPAN, DEFAULT_SLOPE, DEFAULT_SOLID_HEIGHT, DEFAULT_SOLID_SIZE, defaultPrismBasePolygon, defaultPrismVector } from "./localPlanDefaults"

const UPDATABLE_INPUT_FIELDS = updatableInputFields()
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

/**
 * **模型写的名字能不能原样写进诊断**（修复轮 1 / M3）。
 *
 * `unexpected field '<键名>'`、`unregistered action '<动作名>'`、`unexpected kind '<kind>'`、
 * `action key '<键名>' ...` 里的名字**都是模型自己写的**，而解析错误会被回送出去
 *（修复提示、逐层诊断、账本、界面）。JSON 对这些名字没有形状限制：模型（或它读到的文档文本）
 * 可以把一整句话、甚至换行 + 一个假的 Markdown 小标题当字段名 —— 那就是"把散文再送回去"
 * 的自我强化循环，规格 §7 明令不许。
 *
 * 这里判一次，**所有消费者一起安全**（诊断的 `path` 也嵌着键名，只堵详情是堵不住的）。
 * 判据两条，任一成立才原样写出：
 * - 名字**真的在登记表里**（`radius` 用在棱柱上就是这一类：字段合法、动作不对）；
 * - 名字**长得就是一个标识符**（字母开头、字母数字下划线点、长度有界）。
 *
 * 挡住名字并不影响修复：位置由路径说清（`envelope.actions[0].inputs.…`），名字是附赠信息。
 */
export function isEchoableName(name: string): boolean {
  if (name in ACTIONS) return true
  if (Object.values(ACTIONS).some((spec: ActionSpec) => spec.inputFields.includes(name))) return true
  return /^[A-Za-z][A-Za-z0-9_.]{0,63}$/.test(name)
}

/** 名字被挡下来时写进 `detail` 的占位（路径里那一段见 `WITHHELD_PATH_SEGMENT`）。 */
const WITHHELD_NAME = "(name withheld)"
/** 名字被挡下来时写进**路径**的占位：路径要仍然是一串"段"，否则下游按段解析会断。 */
const WITHHELD_PATH_SEGMENT = "<unnamed_field>"

/** 诊断详情里的名字：可以回显就带引号写出来，否则只留占位。 */
function quotedName(name: string): string {
  return isEchoableName(name) ? `'${name}'` : WITHHELD_NAME
}

/** 字段白名单：多一个字段就拒绝 —— 模型不能自己发明"提交版本"或"授权"之类的东西。 */
function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: ParseError[]): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    /**
     * **路径与详情都不许原样带出模型写的任意文本**（M3）：键名不是标识符形状时，
     * 连路径那一段也换成占位 —— 位置（哪个动作、哪一层容器）仍然说得清。
     */
    if (isEchoableName(key)) {
      errors.push(fail("unknown_field", `${path}.${key}`, `unexpected field '${key}'`))
      continue
    }
    errors.push(fail("unknown_field", `${path}.${WITHHELD_PATH_SEGMENT}`, `unexpected field ${WITHHELD_NAME}`))
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

/** 平面坐标（圆锥曲线用）。与 `readVector3` 同一套判据，只是少一个 z。 */
function readPoint2(value: unknown, path: string, errors: ParseError[]): { x: number; y: number } | null {
  if (!isPlainObject(value)) {
    errors.push(fail("invalid_type", path, "expected an object"))
    return null
  }
  rejectUnknownFields(value, ["x", "y"], path, errors)
  const x = finiteNumber(value.x, `${path}.x`, errors)
  const y = finiteNumber(value.y, `${path}.y`, errors)
  return x === null || y === null ? null : { x, y }
}

/** 可选字段的有限数：**缺省不等于 0**（默认策略在审计那一层决定回填什么）。 */
function optionalFiniteNumber(value: unknown, path: string, errors: ParseError[]): number | null | undefined {
  if (value === undefined) return undefined
  return finiteNumber(value, path, errors)
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
  /**
   * **这个动作的引用字段**（Fix round 1 / I12、I16、M4）。
   *
   * 从"只有一个 `requireReference`"改成**列表**，因为有的动作同时有多个引用：
   * `dynamic.bind_point` 既有 `target`（要绑的点）又有 `host`（绑到谁身上）。
   * 只登记一个的后果是另一个既不解析也不校验 —— 模型按提示词写
   * `host: {scope:"draft", alias:"E"}` 时，编译器读到 `documentId === undefined`
   * 就报 `cross_document_reference`，把"别名没解析"误报成"跨文档"。
   *
   * 这份列表同时是**编译器的引用解析表**（`planCompiler` 直接读它，不再有第二份）。
   */
  references?: readonly {
    field: string
    /** `scoped` = 带 documentId 的对象引用；`id` = 同文档内的对象 id；`parameter` = 文档参数 id。 */
    kind: "scoped" | "id" | "parameter"
    /** 一批 id（`object.delete_many.targets`）。 */
    list?: boolean
    /** 嵌套在对象里的引用（切线的 `anchor.pointId`）。 */
    nested?: { outer: string; inner: string; when: { field: string; equals: string } }
  }[]
  /**
   * 取值只能是这个集合的字段（例如 `solid.create_template` 的 `template`）。
   *
   * **为什么要登记在这一处**：提示词必须让模型知道每个动作能填哪些字段、哪些字段只能取固定值，
   * 而"能填什么"的判据就是这张表。第一版提示词只给了动作名，于是**真实模型**产出了
   * `solid.create_template` 却把 `template` 填成了别的值 —— 校验拒绝它（`invalid_template`），
   * 而模型没有任何办法知道该填什么。在提示词里手抄一份值域就是第二份真源，迟早与被校验的那份不一致。
   */
  enumValues?: Record<string, readonly string[]>
  /** 闭集字段的稳定错误码（缺省 `invalid_${field}`）。 */
  enumCodes?: Record<string, string>
  /**
   * **没有它这个动作就不成立**的字段（规格 §6.3 的"显式约束"）。
   *
   * 缺了它**不等于**失败：审计会先看这个字段有没有安全默认（`defaults`），
   * 有就回填并写进 `assumptions`，没有就走 `clarification` 问用户。
   */
  required?: readonly string[]
  /**
   * **字段缺失时的默认策略**（规格 §6.3）。
   *
   * 只登记"缺了会怎么办"的字段：没登记的字段一律是"可选字段，给了就用"
   *（例如 `label`）—— 那不需要策略，也不需要用户回答。
   */
  defaults?: Record<string, FieldPolicy>
}

/**
 * 一个字段的默认策略。`safe_default` 必须带 `reason`（那句话会进 `assumptions`，
 * 用户据此知道系统替他定了什么），`ask_user` 必须带 `question`（具体到能直接回答）。
 */
export interface FieldPolicy {
  policy: PlanDefaultPolicy
  value?: unknown
  reason?: string
  question?: string
  /** `infer_from_facts` 时从哪一类事实里读（`size` = 棱长/边长，`height` = 高度）。 */
  infer?: "size" | "height" | "label" | "position"
  /**
   * **这条策略只对某些取值生效**（例如 `radiusX` 只对椭圆/双曲线有意义）。
   *
   * 少了它会出一个很糟的症状：给椭圆作计划时被问"抛物线的焦准距是多少？" ——
   * 用户看得见的问题里混进了与本题无关的那一个，而这类噪声会让人不再读提问。
   */
  appliesWhen?: { field: string; in: readonly string[] }
}

/** 一条给模型/审计看的字段说明（**从登记表生成**，不手抄）。 */
export interface ActionAuditDescription {
  actionId: string
  requiresAlias: boolean
  inputs: readonly string[]
  enums: Record<string, readonly string[]>
  /**
   * **引用字段**（Fix round 1 / I12、I16、M4）。
   *
   * 编译器用它把 `{scope:"draft", alias}` / `draft:<alias>` 解析成真 id ——
   * 这张表只有这一份（`planCompiler` 直接读它），所以"注册表说它是引用、解析器却不知道"
   * 这种漂移不可能再发生。
   */
  references: readonly {
    field: string
    kind: "scoped" | "id" | "parameter"
    list?: boolean
    nested?: { outer: string; inner: string; when: { field: string; equals: string } }
  }[]
  required: readonly string[]
  defaults: readonly { field: string; policy: PlanDefaultPolicy; value?: unknown; reason?: string; question?: string; infer?: "size" | "height" | "label" | "position"; appliesWhen?: { field: string; in: readonly string[] } }[]
}

/** 空间模板的闭集。**只有一处**：下面那张登记表与运行期校验都读它。 */
const SOLID_TEMPLATES = ["cube", "pyramid", "cylinder", "cone"] as const

/** 平面圆锥曲线的闭集（规格 §8.2）。 */
const CONIC_KINDS = ["ellipse", "parabola", "hyperbola"] as const

/** 函数分析动作的闭集（Fix round 1 / I15）。 */
const ANALYSIS_KINDS = ["derivative", "tangent", "integral"] as const

/** 取原点这类"最小复杂度"默认；写成常量而不是每处 new 一个字面量。 */
const CENTER_2D = { ...DEFAULT_CENTER_2D }
const ORIGIN_3D = { ...DEFAULT_ORIGIN_3D }

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
  // 点的位置是**显式约束**：不给我就不该替用户挑一个坐标（欠定 ≠ 有安全默认）。
  "planar.create_point": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["points"],
    defaults: { points: { policy: "ask_user", question: "这个点画在哪里？给一个坐标（x, y）。" } }
  },
  "planar.create_line": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["points"],
    defaults: { points: { policy: "ask_user", question: "这条线过哪两点？给两个坐标。" } }
  },
  "planar.create_segment": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["points"],
    defaults: { points: { policy: "ask_user", question: "这条线段的两个端点坐标是什么？" } }
  },
  "planar.create_ray": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["points"],
    defaults: { points: { policy: "ask_user", question: "这条射线的端点与方向上的一点分别在哪里？" } }
  },
  "planar.create_polyline": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["points"],
    defaults: { points: { policy: "ask_user", question: "这条折线依次经过哪些点？" } }
  },
  /**
   * 圆的半径没有公认默认（单位圆是一种猜测，不是"安全"），所以缺半径就**问**。
   * 圆心取原点是常见的默认（规格 §6.3 的"最小化复杂度"），但要写进 `assumptions`。
   */
  "planar.create_circle": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["radius"],
    defaults: {
      center: { policy: "safe_default", value: CENTER_2D, reason: "圆心未指定，取原点。", },
      radius: { policy: "ask_user", question: "圆的半径是多少？" }
    }
  },
  "planar.create_arc": {
    inputFields: ["alias", "points", "center", "radius", "startAngle", "endAngle", "label"],
    requiresAlias: true,
    required: ["radius", "startAngle", "endAngle"],
    defaults: {
      center: { policy: "safe_default", value: CENTER_2D, reason: "圆心未指定，取原点。" },
      radius: { policy: "ask_user", question: "圆弧的半径是多少？" },
      startAngle: { policy: "safe_default", value: 0, reason: "起始角未指定，取 0。" },
      endAngle: { policy: "safe_default", value: Math.PI / 2, reason: "终止角未指定，取四分之一圆（π/2）。" }
    }
  },
  /**
   * 平面圆锥曲线（规格 §8.2）。中心取原点、轴向取 x 是安全默认；
   * **半轴与焦准距不是** —— 猜错就等于换了题目里的一条曲线。
   */
  "planar.create_conic": {
    inputFields: ["alias", "kind", "center", "radiusX", "radiusY", "vertex", "focalParameter", "axis", "rotation", "label"],
    requiresAlias: true,
    enumValues: { kind: CONIC_KINDS },
    required: ["kind"],
    defaults: {
      center: { policy: "safe_default", value: CENTER_2D, reason: "圆锥曲线中心未指定，取原点。", appliesWhen: { field: "kind", in: ["ellipse", "hyperbola"] } },
      vertex: { policy: "safe_default", value: CENTER_2D, reason: "抛物线顶点未指定，取原点。", appliesWhen: { field: "kind", in: ["parabola"] } },
      axis: { policy: "safe_default", value: "x", reason: "圆锥曲线轴向未指定，取 x 轴。", appliesWhen: { field: "kind", in: ["parabola", "hyperbola"] } },
      radiusX: { policy: "ask_user", question: "这条圆锥曲线的半轴长（x 方向）是多少？", appliesWhen: { field: "kind", in: ["ellipse", "hyperbola"] } },
      radiusY: { policy: "ask_user", question: "这条圆锥曲线的半轴长（y 方向）是多少？", appliesWhen: { field: "kind", in: ["ellipse", "hyperbola"] } },
      focalParameter: { policy: "ask_user", question: "抛物线的焦准距是多少？", appliesWhen: { field: "kind", in: ["parabola"] } }
    }
  },

  // --- 空间模板：字段须与 `SolidCreateTemplateAction` 一致（不能带 segments，动作层没有） ---
  "solid.create_template": {
    inputFields: ["alias", "template", "origin", "size", "radius", "height", "label"],
    requiresAlias: true,
    enumValues: { template: SOLID_TEMPLATES },
    required: ["template"],
    defaults: {
      origin: { policy: "safe_default", value: ORIGIN_3D, reason: "实体位置未指定，放在原点。" },
      size: { policy: "infer_from_facts", infer: "size", value: { x: DEFAULT_SOLID_SIZE, y: DEFAULT_SOLID_SIZE, z: DEFAULT_SOLID_SIZE }, reason: `棱长未指定：先从你的话里读，读不到取 ${DEFAULT_SOLID_SIZE}。`, appliesWhen: { field: "template", in: ["cube", "pyramid"] } },
      height: { policy: "infer_from_facts", infer: "height", value: DEFAULT_SOLID_HEIGHT, reason: `高度未指定：先从你的话里读，读不到取 ${DEFAULT_SOLID_HEIGHT}。`, appliesWhen: { field: "template", in: ["cylinder", "cone"] } },
      radius: { policy: "ask_user", question: "底面半径是多少？", appliesWhen: { field: "template", in: ["cylinder", "cone"] } }
    }
  },
  /**
   * 拉伸式棱柱（规格 §3.2/§3.3）：底面多边形 + 拉伸向量。
   *
   * 白名单里**没有** `faces`：侧面由内核按 `[Bi, B(i+1), T(i+1), Ti]` 生成，
   * 传输层连这个字段都不接受，模型就没有"把散面拼成 Prism"的入口（规格 §7）。
   */
  "solid.create_prism": {
    inputFields: ["alias", "basePolygon", "vector", "label"],
    requiresAlias: true,
    required: ["basePolygon", "vector"],
    defaults: {
      basePolygon: { policy: "safe_default", value: defaultPrismBasePolygon(DEFAULT_PRISM_SPAN), reason: `底面未指定，取边长 ${DEFAULT_PRISM_SPAN} 的正方形（规格 §6.3）。` },
      vector: { policy: "safe_default", value: defaultPrismVector(DEFAULT_PRISM_HEIGHT), reason: `拉伸向量未指定，取高 ${DEFAULT_PRISM_HEIGHT} 的直棱柱（规格 §6.3）。` }
    }
  },
  /**
   * **正四面体**（用户口径："画一个正四面体 ABCD，棱长为 3"）。
   *
   * 形状由 `baseCenter` + `edge` 两个数唯一确定，所以它既不是模板动作（字段是 `origin + size` 或
   * `center + radius + height`），也不是棱柱（底面多边形 + 向量）—— 独立一项最省心。
   *
   * `edge` 走 `infer_from_facts`：先从用户原话里读数字（"棱长为 3"），读不到取
   * `DEFAULT_SOLID_SIZE` —— 与立方体"棱长未指定"那条**完全同一口径**（含写进 `assumptions` 的那句）。
   */
  "solid.create_tetrahedron": {
    inputFields: ["alias", "baseCenter", "edge", "label"],
    requiresAlias: true,
    required: [],
    defaults: {
      baseCenter: { policy: "safe_default", value: ORIGIN_3D, reason: "底面中心未指定，放在原点。" },
      edge: { policy: "infer_from_facts", infer: "size", value: DEFAULT_SOLID_SIZE, reason: `棱长未指定：先从你的话里读，读不到取 ${DEFAULT_SOLID_SIZE}。` }
    }
  },
  /**
   * **正 N 棱锥**（第 1 层，用户口径："如果有正 N 面体呢？"）。
   *
   * `pyramid` 模板的底面是**矩形**（只能四棱锥），而正三 / 五 / 六…棱锥由"边数 + 底面外接圆半径 + 高"
   * 唯一确定；**正四面体是 `sides = 3` 的特例**（两者走内核同一个构造器）。
   *
   * **边数没有公认的默认值** —— 替用户挑一个"正五棱锥"就是替他改题，所以 `sides` 走 `ask_user`；
   * 半径与高按老口径从原话里读数字、读不到取默认值并写进 `assumptions`。
   */
  "solid.create_regular_pyramid": {
    inputFields: ["alias", "baseCenter", "sides", "radius", "height", "label"],
    requiresAlias: true,
    required: [],
    defaults: {
      baseCenter: { policy: "safe_default", value: ORIGIN_3D, reason: "底面中心未指定，放在原点。" },
      sides: { policy: "ask_user", question: "底面是正几边形？（3 = 三棱锥，也就是正四面体那一族）" },
      radius: { policy: "infer_from_facts", infer: "size", value: DEFAULT_SOLID_SIZE, reason: `底面外接圆半径未指定：先从你的话里读，读不到取 ${DEFAULT_SOLID_SIZE}。` },
      height: { policy: "infer_from_facts", infer: "height", value: DEFAULT_SOLID_HEIGHT, reason: `高未指定：先从你的话里读，读不到取 ${DEFAULT_SOLID_HEIGHT}。` }
    }
  },

  // --- 动点 ---
  // 引用是两个**带 documentId** 的引用：跨文档绑定必须能说清是哪两份文档里的哪两个对象。
  "dynamic.bind_point": {
    inputFields: ["target", "host", "parameter"],
    requiresAlias: false,
    references: [{ field: "target", kind: "scoped" }, { field: "host", kind: "scoped" }],
    required: ["target", "host"],
    defaults: { parameter: { policy: "safe_default", value: DEFAULT_DYNAMIC_POINT_PARAMETER, reason: `动点位置未指定，取参数 ${DEFAULT_DYNAMIC_POINT_PARAMETER}。` } }
  },
  /**
   * 新建宿主驱动的动点：`hostSub` 指宿主内部第几条棱（规格 §3.3 的 `solidId:e{i}` 命名）。
   *
   * `parameter` 的默认是 **0.4**（规格 §6.3 的普通动点），而**中点由调用方显式给 0.5** ——
   * 审计不许把显式约束覆盖成默认值（`parameterAudit.test.ts` 钉住这条）。
   */
  "dynamic.create_bound_point": {
    inputFields: ["alias", "host", "hostSub", "parameter", "parameterId", "label"],
    requiresAlias: true,
    references: [{ field: "host", kind: "scoped" }],
    required: ["alias", "host"],
    defaults: {
      host: { policy: "ask_user", question: "这个动点绑在哪个对象上？（曲线、棱或实体）" },
      parameter: { policy: "safe_default", value: DEFAULT_DYNAMIC_POINT_PARAMETER, reason: `动点位置未指定，取参数 ${DEFAULT_DYNAMIC_POINT_PARAMETER}。` }
    }
  },
  // 这里是**同文档内的裸 id**（动作层用 `findPrimitive` 在目标文档里查），不是作用域引用。
  "dynamic.bind_curve": {
    inputFields: ["target", "pathId", "parameter"],
    requiresAlias: false,
    references: [{ field: "target", kind: "scoped" }, { field: "pathId", kind: "id" }],
    required: ["target", "pathId"],
    defaults: { parameter: { policy: "safe_default", value: DEFAULT_DYNAMIC_POINT_PARAMETER, reason: `动点位置未指定，取参数 ${DEFAULT_DYNAMIC_POINT_PARAMETER}。` } }
  },
  "dynamic.create_locus": {
    inputFields: ["alias", "sourcePointId"],
    requiresAlias: true,
    references: [{ field: "sourcePointId", kind: "id" }],
    required: ["sourcePointId"]
  },
  "dynamic.set_radius_rule": {
    inputFields: ["circleId", "pointId", "factor"],
    requiresAlias: false,
    references: [{ field: "circleId", kind: "id" }, { field: "pointId", kind: "id" }],
    required: ["circleId", "pointId"],
    defaults: { factor: { policy: "safe_default", value: 1, reason: "半径比例未指定，取 1（距离即半径）。" } }
  },

  // --- 函数 ---
  "function.create_tangent": {
    inputFields: ["alias", "sourceId", "x", "anchor"],
    requiresAlias: true,
    // 平铺的 `sourceId` 与**嵌套的** `anchor.pointId`：跟随动点时两处都是那个点，
    // 都可以指向同一份计划里新建的对象（漏掉嵌套那条会报 `target_not_found: draft:P`）。
    references: [{ field: "sourceId", kind: "id", nested: { outer: "anchor", inner: "pointId", when: { field: "kind", equals: "point" } } }],
    required: ["sourceId"],
    defaults: {
      x: { policy: "safe_default", value: 0, reason: "切点横坐标未指定，取 x = 0。" },
      anchor: { policy: "safe_default", value: { kind: "parameter", parameter: DEFAULT_SLOPE, branch: 0 }, reason: `切点未指定，取曲线参数 ${DEFAULT_SLOPE}（规格 §6.3：未定斜率取水平）。` }
    }
  },
  "function.analyze": {
    inputFields: ["alias", "sourceId", "analysis"],
    requiresAlias: true,
    references: [{ field: "sourceId", kind: "id" }],
    required: ["sourceId", "analysis"],
    /**
     * `analysis` 是**闭集**（Fix round 1 / I15）：不校验的话，编译器的兜底分支会把任何取值
     * 编成一条切线（要"定积分"、文档里多出一条切线），而规格 §7 明令不许这种静默错误。
     */
    enumValues: { analysis: ANALYSIS_KINDS },
    enumCodes: { analysis: "invalid_analysis" },
    defaults: { analysis: { policy: "ask_user", question: "要算导数、切线还是定积分？" } }
  },

  // --- 截面 ---
  // `SectionCreateAction` 收的是裸 `sourceId`（**不是** scoped 引用），与 `section.materialize` 一致。
  /**
   * 截面平面是**不安全**的省略：过一点有无数个平面，替用户挑一个等于换了一道题。
   * 所以缺平面就问（而不是拿 z = 0 顶上）。
   */
  "section.create": {
    inputFields: ["alias", "sourceId", "plane"],
    requiresAlias: true,
    references: [{ field: "sourceId", kind: "id" }],
    required: ["sourceId"],
    defaults: { plane: { policy: "ask_user", question: "截面用哪个平面？给法向与常数，或者说明它过哪三个点。" } }
  },
  "section.materialize": {
    inputFields: ["sectionId"],
    requiresAlias: false,
    references: [{ field: "sectionId", kind: "id" }],
    required: ["sectionId"]
  },

  // --- 对象与参数 ---
  "object.delete_many": {
    inputFields: ["targets"],
    requiresAlias: false,
    references: [{ field: "targets", kind: "id", list: true }],
    required: ["targets"]
  },
  "object.update_inputs": {
    inputFields: ["target", "patch"],
    requiresAlias: false,
    references: [{ field: "target", kind: "scoped" }],
    required: ["target", "patch"]
  },
  /**
   * **新建参数**（规格 §4.1/§8.2）。`parameter.set` 只改已存在的参数，所以"符号参数 θ"
   * 必须有一个创建入口。`id` 是**新名字**，不是引用 —— 所以这里没有 `references`。
   */
  "parameter.create": {
    inputFields: ["id", "value", "min", "max", "step", "label"],
    requiresAlias: false,
    required: ["id"],
    defaults: { value: { policy: "safe_default", value: 0, reason: "参数初值未指定，取 0。" } }
  },
  "parameter.set": {
    inputFields: ["id", "value", "min", "max", "step", "label"],
    requiresAlias: false,
    references: [{ field: "id", kind: "parameter" }],
    required: ["id"],
    /**
     * **缺新值就问，不取 0**（Fix round 1 / M24）：用户说"把 θ 调大一点"而模型漏了数值时，
     * 取 0 会把一个活参数清零 —— 那不是一个"公认默认"，而是一次静默的破坏。
     */
    defaults: { value: { policy: "ask_user", question: "这个参数要改成多少？" } }
  },
  "parameter.set_expression": {
    inputFields: ["id", "expression"],
    requiresAlias: false,
    references: [{ field: "id", kind: "parameter" }],
    required: ["id", "expression"]
  }
} as const satisfies Record<DraftActionId, ActionSpec>

export type { PlanDefaultPolicy } from "./contracts"
export type ActionId = keyof typeof ACTIONS

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
export const UNSUPPORTED_ACTION_IDS: Readonly<Record<string, string>> = {
  "derived.create_sphere": "球体是派生量：内核能解外接球/内切球（solveCircumsphere3 / solveInsphere3），但 DSL 还没有承载球的图元与重算路径。",
  "derived.create_circumsphere": "外接球是派生量：内核能解（solveCircumsphere3），但还没有承载它的图元与重算路径。",
  "derived.create_insphere": "内切球是派生量：内核能解（solveInsphere3），但还没有承载它的图元与重算路径。",
  "derived.create_triangle_center": "三角形五心是派生量：内核有纯函数（triangleCenter2），但还没有派生点特征与重算路径。",
  "derived.create_triangle_circle": "三角形的内切圆/外接圆目前只能作为派生圆规则存在，还没有独立动作。"
}

/** 这个名字是不是"认得出但目前承载不了"。 */
export function unsupportedActionReason(actionId: string): string | null {
  return UNSUPPORTED_ACTION_IDS[actionId] ?? null
}

/** 这个名字是不是登记在册的动作。 */
export function isRegisteredActionId(value: string): boolean {
  return value in ACTIONS
}

/**
 * **给模型看的动作形状**：只列调用方允许的那几个动作，字段白名单与固定取值都取自上面那张表。
 *
 * 为什么从这里生成、而不是在提示词里手写一份：**校验读的就是这张表**。两处各写一份必然分叉，
 * 而分叉的表现是"模型按提示词填了、校验却拒了" —— 第一次真实运行正是这样
 *（模型产出了 `solid.create_template`，`template` 填了别的值，报 `invalid_template`）。
 */
export function describeActions(actionIds?: readonly string[]): { actionId: string; inputs: readonly string[]; enums: Record<string, readonly string[]> }[] {
  return (Object.keys(ACTIONS) as ActionId[])
    .filter((actionId) => !actionIds || actionIds.includes(actionId))
    .map((actionId) => {
      const spec: ActionSpec = ACTIONS[actionId]
      return { actionId, inputs: spec.inputFields, enums: spec.enumValues ?? {} }
    })
}

/** 一个动作的**审计说明**：必填字段 + 引用字段 + 每个字段缺失时的默认策略（规格 §6.2）。 */
function auditDescription(actionId: ActionId, spec: ActionSpec): ActionAuditDescription {
  return {
    actionId,
    requiresAlias: spec.requiresAlias,
    inputs: spec.inputFields,
    enums: spec.enumValues ?? {},
    // 引用字段从这里出去（Fix round 1 / M4）：编译器的引用解析表由它生成，不再有第二份。
    references: (spec.references ?? []).map((reference) => ({ ...reference })),
    required: spec.required ?? [],
    defaults: Object.entries(spec.defaults ?? {}).map(([field, policy]) => ({
      field,
      policy: policy.policy,
      ...(policy.value === undefined ? {} : { value: policy.value }),
      ...(policy.reason === undefined ? {} : { reason: policy.reason }),
      ...(policy.question === undefined ? {} : { question: policy.question }),
      ...(policy.infer === undefined ? {} : { infer: policy.infer }),
      ...(policy.appliesWhen === undefined ? {} : { appliesWhen: policy.appliesWhen })
    }))
  }
}

/** 单个动作的审计说明；未登记的名字返回 `null`（审计据此走 unknown/unsupported 分支，**不编**一份出来）。 */
export function auditEntryFor(actionId: string): ActionAuditDescription | null {
  if (!(actionId in ACTIONS)) return null
  return auditDescription(actionId as ActionId, ACTIONS[actionId as ActionId])
}

/**
 * **默认策略表**：给提示词与审计共用的那一份。
 *
 * 为什么由这里生成而不是在提示词里手写：提示词要告诉模型"缺哪个字段会怎样"，
 * 而**校验与补全读的是同一张表**。两处各写一份必然分叉，症状是"模型按提示词省略了、
 * 结果被问了一遍"或者反过来。
 */
export function describeDefaultPolicies(actionIds?: readonly string[]): ActionAuditDescription[] {
  return (Object.keys(ACTIONS) as ActionId[])
    .filter((actionId) => !actionIds || actionIds.includes(actionId))
    .map((actionId) => auditDescription(actionId, ACTIONS[actionId]))
}

/**
 * 把解析错误整理成**一次性修复请求**（计划 Task 4 + 规格 §7）。
 *
 * 只带 `reason` / `errors`（路径 + 原因码）/ `allowedChanges`（从错误路径去重而来）。
 *
 * `attempt` **不夹上限**（Fix round 1 / M7）：以前夹成恒等于 1，调用方永远分不清"第一次"与
 * "第三次"，于是"超出上限就拒绝再修"这条判据在调用方一侧根本无法实现。上限由
 * `MAX_REPAIR_ATTEMPTS` 表达，调用方自己比。
 */
export function repairRequestFor(errors: readonly ParseError[], attempt: number, reason = "schema_invalid"): RepairRequest {
  return {
    reason,
    errors: errors.map((error) => ({ code: error.code, path: error.path, detail: error.detail })),
    allowedChanges: [...new Set(errors.map((error) => error.path))],
    attempt: Math.max(1, Math.trunc(attempt))
  }
}

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
      /**
       * 不同模板的要求不同，不能把 size 通用于所有实体（设计规格 L968）。
       *
       * 这里只挡**自相矛盾**的那一种：圆柱/圆锥给了 `size`（它没有"棱长"这回事）。
       * 缺 `radius` / 缺 `size` 由**默认策略**处理（`ask_user` 会去问用户，`infer_from_facts`
       * 会从原话里读）—— 在传输层提前拒掉，用户看到的就是一句 `missing_field`，
       * 而不是"请问底面半径是多少？"。
       */
      if ((template === "cube" || template === "pyramid") && out.size === null && value.radius !== undefined) {
        errors.push(fail("unexpected_field", `${path}.radius`, `${template} takes size, not radius`))
      }
      return out
    }

    case "solid.create_prism": {
      /**
       * 载荷形状**逐字段**读出来（不做类型断言）：底面是一串空间点、向量是一个空间向量。
       *
       * 这里只挡"明显畸形"（点数不足、缺分量、非有限数），**语义**（是否共面、是否自交、向量是否为零）
       * 全部留给动作编译器的 `validatePrismInput` —— 传输层再抄一遍必然分叉（见本文件头注释）。
       *
       * 底面与向量**缺字段是合法的**：它们登记了默认策略（规格 §6.3 的底跨 4 / 高度 3），
       * 由审计在编译前回填并写进 `assumptions`。在这里要求它们，会把"我替你取了默认值"
       * 变成一句硬邦邦的 `missing_field` —— 而用户本来是可以看到那条假设的。
       */
      const out: Record<string, unknown> = withAlias({})
      if (value.basePolygon !== undefined) {
        if (!Array.isArray(value.basePolygon)) {
          errors.push(fail("invalid_type", `${path}.basePolygon`, "expected an array of spatial points"))
          return null
        }
        if (value.basePolygon.length < 3) {
          errors.push(fail("invalid_type", `${path}.basePolygon`, "a prism base needs at least three points"))
          return null
        }
        const basePolygon: { x: number; y: number; z: number }[] = []
        for (const [index, point] of value.basePolygon.entries()) {
          const read = readVector3(point, `${path}.basePolygon[${index}]`, errors)
          if (read === null) return null
          basePolygon.push(read)
        }
        out.basePolygon = basePolygon
      }
      if (value.vector !== undefined) {
        const vector = readVector3(value.vector, `${path}.vector`, errors)
        if (vector === null) return null
        out.vector = vector
      }
      if (typeof value.label === "string") out.label = value.label
      return out
    }

    case "planar.create_conic": {
      /**
       * 圆锥曲线：`kind` 是闭集（不认识的名字要指到那个字段），三种曲线各自需要的字段不同，
       * 所以只做**有限性**这一层，语义（半径为正、焦准距非零）留给动作编译器（规格 §6.2）。
       */
      const kind = value.kind
      if (typeof kind !== "string" || !(CONIC_KINDS as readonly string[]).includes(kind)) {
        errors.push(fail("invalid_conic_kind", `${path}.kind`, `expected one of ${CONIC_KINDS.join(", ")}`))
        return null
      }
      const out: Record<string, unknown> = withAlias({ kind })
      if (value.center !== undefined) out.center = readPoint2(value.center, `${path}.center`, errors)
      if (value.vertex !== undefined) out.vertex = readPoint2(value.vertex, `${path}.vertex`, errors)
      if (value.radiusX !== undefined) out.radiusX = finiteNumber(value.radiusX, `${path}.radiusX`, errors)
      if (value.radiusY !== undefined) out.radiusY = finiteNumber(value.radiusY, `${path}.radiusY`, errors)
      if (value.focalParameter !== undefined) out.focalParameter = finiteNumber(value.focalParameter, `${path}.focalParameter`, errors)
      if (value.rotation !== undefined) out.rotation = finiteNumber(value.rotation, `${path}.rotation`, errors)
      if (value.axis !== undefined) {
        if (value.axis !== "x" && value.axis !== "y") errors.push(fail("invalid_axis", `${path}.axis`, "expected 'x' or 'y'"))
        else out.axis = value.axis
      }
      if (typeof value.label === "string") out.label = value.label
      return out
    }

    case "dynamic.create_bound_point": {
      const host = readScopedReference(value.host, `${path}.host`, errors)
      const out: Record<string, unknown> = withAlias({ host })
      if (value.hostSub !== undefined) {
        if (typeof value.hostSub !== "number" || !Number.isInteger(value.hostSub) || value.hostSub < 0) {
          errors.push(fail("invalid_host_sub", `${path}.hostSub`, "hostSub must be a non-negative integer"))
        } else out.hostSub = value.hostSub
      }
      // `parameter` 有安全默认（0.4），所以**缺省是合法的**：回填发生在审计那一层，并写进 assumptions。
      const parameter = optionalFiniteNumber(value.parameter, `${path}.parameter`, errors)
      if (parameter !== undefined && parameter !== null) out.parameter = parameter
      if (value.parameterId !== undefined) out.parameterId = boundedString(value.parameterId, `${path}.parameterId`, errors)
      if (typeof value.label === "string") out.label = value.label
      return out
    }

    case "parameter.create": {
      // 这是**新名字**而不是引用：所以只要求它是一个有界的非空字符串，不去文档里找它。
      const id = boundedString(value.id, `${path}.id`, errors)
      const out: Record<string, unknown> = { id }
      const initial = optionalFiniteNumber(value.value, `${path}.value`, errors)
      if (initial !== undefined && initial !== null) out.value = initial
      for (const key of ["min", "max", "step"] as const) {
        const read = optionalFiniteNumber(value[key], `${path}.${key}`, errors)
        if (read !== undefined && read !== null) out[key] = read
      }
      if (typeof value.label === "string") out.label = value.label
      return out
    }

    case "object.update_inputs": {
      const target = readScopedReference(value.target, `${path}.target`, errors)
      const patch = isPlainObject(value.patch)
        // 白名单**只有一份**：直接读动作层的 `UPDATABLE_INPUT_FIELDS`（Fix round 1 / I14）。
        // 手抄一份更窄的列表会把"把点挪到 (1,2)"判成 `unknown_field` 并浪费唯一一次修复。
        ? (rejectUnknownFields(value.patch, UPDATABLE_INPUT_FIELDS, `${path}.patch`, errors), value.patch)
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
      const out: Record<string, unknown> = { ...value }

      // 闭集字段（Fix round 1 / I15）：不校验的话，编译器的兜底分支会把任何取值编成别的东西。
      for (const [field, allowed] of Object.entries(spec.enumValues ?? {})) {
        const provided = out[field]
        if (provided === undefined) continue
        if (typeof provided !== "string" || !allowed.includes(provided)) {
          errors.push(fail(spec.enumCodes?.[field] ?? `invalid_${field}`, `${path}.${field}`, `expected one of ${allowed.join(", ")}`))
          return null
        }
      }

      /**
       * **每一个**引用字段都要过作用域校验并摊平（Fix round 1 / I12、I16）。
       *
       * scoped 引用摊平成动作层读的 `{documentId, entityId}`；`id` / `parameter` 引用是
       * 字符串（同文档内的 id 或参数名），这里只挡明显畸形（非字符串、超长），
       * 存在性由编译器的引用解析负责。
       */
      for (const reference of spec.references ?? []) {
        const provided = out[reference.field]
        if (reference.list) {
          if (provided === undefined) continue
          if (!Array.isArray(provided)) {
            errors.push(fail("invalid_type", `${path}.${reference.field}`, "expected an array of ids"))
            return null
          }
          const ids = provided.map((entry, index) => boundedString(entry, `${path}.${reference.field}[${index}]`, errors))
          if (ids.some((entry) => entry === null)) return null
          out[reference.field] = ids
          continue
        }
        if (provided === undefined) {
          /**
           * 缺字段在这里**放行**（Fix round 1 / I17）：审计会按默认策略处理 ——
           * 有安全默认就回填并写进 assumptions，标着 `ask_user` 的就去问用户
           *（"这个动点绑在哪个对象上？"）。在传输层提前拒掉，用户看到的只会是一句
           * `invalid_type`，而登记表里那条 `ask_user` 就成了**永远走不到的死策略**。
           */
          continue
        }
        if (reference.kind === "scoped") {
          const resolved = readScopedReference(provided, `${path}.${reference.field}`, errors)
          if (resolved === null) return null
          out[reference.field] = resolved
          continue
        }
        const id = boundedString(provided, `${path}.${reference.field}`, errors)
        if (id === null) return null
        out[reference.field] = id
      }

      // 嵌套引用（切线的 `anchor.pointId`）：形状与作用域都按同一个判据走。
      for (const reference of spec.references ?? []) {
        if (!reference.nested) continue
        const outer = out[reference.nested.outer]
        if (!isPlainObject(outer) || outer[reference.nested.when.field] !== reference.nested.when.equals) continue
        const inner = outer[reference.nested.inner]
        if (inner === undefined) continue
        if (typeof inner !== "string") {
          errors.push(fail("invalid_type", `${path}.${reference.nested.outer}.${reference.nested.inner}`, "expected an id"))
          return null
        }
        out[reference.nested.outer] = { ...outer, [reference.nested.inner]: boundedString(inner, `${path}.${reference.nested.outer}.${reference.nested.inner}`, errors) }
      }

      return withAlias(out)
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

/**
 * 规范化 JSON：键排序、丢视图/时间类字段、拒绝非有限数（NaN 会悄悄变成 null，语义必须显式）。
 *
 * **`undefined` 视同"没有这个字段"**（2026-09-21 修的真实故障）。判据是"哈希值等于同一份数据
 * JSON 往返之后的哈希值" —— 因为文档的**每一处**落盘与比对路径都是 JSON 语义：
 * `JSON.stringify` 直接丢键、`contentFingerprint`（CAS 基准）也是 JSON 比语义。
 * 只有这里曾经把 `undefined` 当垃圾抛出去，于是"内核物化出来的子对象带 `style: undefined`"
 * 这种完全正常的数据会让整轮 Agent 运行死在 `unsupported value of type undefined`
 * （现场：启动恢复 → `migrateLegacySolids` → 让 Agent 规划 → `run_failed`）。
 *
 * 真正无法用 JSON 表达的值（函数 / symbol / bigint）**照旧拒绝**，但错误信息必须指出**在哪**。
 */
function canonicalize(value: unknown, path: string, depth: number): string {
  if (depth > MAX_DEPTH) throw new Error(`canonicalContentHash: value is too deep at ${path}`)
  // 对象里的 `undefined` 键在上面被丢掉了，所以走到这里只可能是数组元素 —— 与 JSON 一样记作 null。
  if (value === undefined) return "null"
  if (value === null) return "null"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`canonicalContentHash: non-finite number at ${path}`)
    return JSON.stringify(value)
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`, depth + 1)).join(",")}]`
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .filter((key) => !HASH_IGNORED_KEYS.has(key) && value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], `${path}.${key}`, depth + 1)}`)
    return `{${entries.join(",")}}`
  }
  throw new Error(`canonicalContentHash: unsupported value of type ${typeof value} at ${path}`)
}

/**
 * 内容哈希（SHA-256，64 位十六进制）。
 *
 * 覆盖**影响语义**的内容（几何、语义链接、已确认事实、关联标注），
 * **不包含**时间、运行日志、视图临时状态 —— 否则"只是滚了一下画布"就会让预览失效。
 * 值域上与 JSON 对齐：`undefined` 等于"没有这个字段"（见 `canonicalize`）。
 * 纯 TypeScript 实现，因此浏览器与 Node 结果一致、也不需要任何依赖。
 */
export function canonicalContentHash(value: unknown): string {
  return sha256Hex(canonicalize(value, "$", 0))
}

/** FIPS 180-4 的 SHA-256（同步、无依赖）。内部用；字符串先过 UTF-8。 */
function sha256Hex(message: string): string {
  return sha256HexBytes(new TextEncoder().encode(message))
}

/**
 * **按原始字节**算 SHA-256。
 *
 * 为什么要有一个"按字节"的入口，而不是只留收字符串的那一个：**附件的内容哈希必须是字节的哈希**。
 * `put_attachment` 会拿调用方声明的哈希去校验它落盘的字节（`BlobStore::write` 里那道门），
 * 而字符串入口会先过 `TextEncoder` —— 一张 PNG 的开头 `0x89 0x50` 会被编码成四个字节，
 * 于是**同一份附件在前端与 Rust 侧算出两个哈希**，表现为"每一次附加都失败，理由却是哈希不符"。
 *
 * 两个入口共用同一份实现（这里），所以"哈希算法"仍然只有一处。
 */
export function sha256HexBytes(bytes: Uint8Array): string {
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
