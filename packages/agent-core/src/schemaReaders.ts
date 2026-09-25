import { ACTIONS, type ActionSpec } from "./actionRegistry"

import type { ParseError } from "./contracts"

/**
 * **运行时校验的基础读取层**（从 `schemas.ts` 拆出，评审方案 2）。
 *
 * 这里全是"把 `unknown` 收敛成一个具体形状"的小函数：有限数、有界字符串 / 数组、平面与空间坐标、
 * 作用域引用、字段白名单。两条纪律写在每个函数的判据里，而不是靠调用方自觉：
 *
 * 1. **`unknown` 永不 cast 成 TS 类型**（设计规格："never cast unknown to a TypeScript type"）——
 *    一律经过这里收敛；
 * 2. 模型的输出是**不可信数据**：非有限数、超长字符串 / 数组、未加作用域的引用、白名单外的字段，
 *    全部**拒绝**并给出稳定错误码，而不是"尽力修补"。
 *
 * 错误码是给 Agent 侧走"可见修复路径"的（设计规格 L990），所以它们必须稳定、可枚举 ——
 * 这也是为什么 `fail` 的 code 一律是字面量。
 */

/// 上限：一条字符串、一个数组、一次计划里的动作数、规范化哈希的递归深度。
export const MAX_STRING = 512
export const MAX_ARRAY = 32
export const MAX_ACTIONS = 32
export const MAX_DEPTH = 12

// ---------------------------------------------------------------- 错误与基础校验
// ---------------------------------------------------------------- 错误与基础校验

export function fail(code: string, path: string, detail: string): ParseError {
  return { code, path, detail }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/** 有限数检查：`NaN` / `±Infinity` 一律拒绝（非有限数会污染几何内核）。 */
export function finiteNumber(value: unknown, path: string, errors: ParseError[]): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(fail("non_finite_number", path, "expected a finite number"))
    return null
  }
  return value
}

export function boundedString(value: unknown, path: string, errors: ParseError[], { allowEmpty = false } = {}): string | null {
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

export function boundedArray(value: unknown, path: string, errors: ParseError[]): unknown[] | null {
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

export function readStringArray(value: unknown, path: string, errors: ParseError[]): string[] | null {
  const items = boundedArray(value, path, errors)
  if (!items) return null
  const out: string[] = []
  for (const [index, item] of items.entries()) {
    const text = boundedString(item, `${path}[${index}]`, errors)
    if (text !== null) out.push(text)
  }
  return out
}

export function readVector3(value: unknown, path: string, errors: ParseError[]): { x: number; y: number; z: number } | null {
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
export function readPoint2(value: unknown, path: string, errors: ParseError[]): { x: number; y: number } | null {
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
export function optionalFiniteNumber(value: unknown, path: string, errors: ParseError[]): number | null | undefined {
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
export function readScopedReference(value: unknown, path: string, errors: ParseError[]): unknown | null {
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
export function quotedName(name: string): string {
  return isEchoableName(name) ? `'${name}'` : WITHHELD_NAME
}

/** 字段白名单：多一个字段就拒绝 —— 模型不能自己发明"提交版本"或"授权"之类的东西。 */

export function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], path: string, errors: ParseError[]): void {
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
