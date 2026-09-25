import { PLAN_SCHEMA_VERSION, type DraftAction, type ParseError, type ParseResult, type PlanEnvelope, type RepairRequest } from "./contracts"
// 可改字段白名单只有动作层那一份（Fix round 1 / I14）：传输层不再手抄一份更窄的。
import { updatableInputFields } from "@draw/scene-graph"

import { ACTIONS, CONIC_KINDS, SOLID_TEMPLATES, type ActionAuditDescription, type ActionSpec } from "./actionRegistry"
import { MAX_ACTIONS, isPlainObject, boundedArray, boundedString, fail, finiteNumber, optionalFiniteNumber, readPoint2, readScopedReference, readStringArray, readVector3, quotedName, rejectUnknownFields } from "./schemaReaders"

// 这两个模块的东西**继续从这里出去**：`index.ts` 是 `export * from "./schemas"`，
// 所以把它们搬走之后必须在这里转出去，否则包的公开面就变了（调用方一行都不用改）。

export { canonicalContentHash, newDraftId, newRunId, sha256Hex, sha256HexBytes } from "./hashing"
// 回显判据留在了读取层（它要读登记表），所以在这里继续对包外可见。
export { isEchoableName } from "./schemaReaders"
// 登记表与两个公开类型也照旧从本文件出去。
export { ACTIONS, type ActionAuditDescription, type FieldPolicy } from "./actionRegistry"

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

    case "solid.create_polyhedron": {
      /**
       * 任意多面体：`vertices` 是一串空间点、`faces` 是**二层整数数组**（顶点下标，0 起）。
       *
       * 这里只挡**形状**：点少于 4 个、面少于 4 个、环里不是整数 / 越界 / 重复。
       * **几何语义**留给内核（见登记表那条注释）—— 那条边界是刻意的，不要往这里搬。
       */
      const out: Record<string, unknown> = withAlias({})
      if (!Array.isArray(value.vertices)) {
        errors.push(fail("invalid_type", `${path}.vertices`, "expected an array of spatial points"))
        return null
      }
      if (value.vertices.length < 4) {
        errors.push(fail("invalid_type", `${path}.vertices`, "a polyhedron needs at least four vertices"))
        return null
      }
      const vertices: { x: number; y: number; z: number }[] = []
      for (const [index, point] of value.vertices.entries()) {
        const read = readVector3(point, `${path}.vertices[${index}]`, errors)
        if (read === null) return null
        vertices.push(read)
      }
      out.vertices = vertices

      if (!Array.isArray(value.faces)) {
        errors.push(fail("invalid_type", `${path}.faces`, "expected an array of face rings"))
        return null
      }
      if (value.faces.length < 4) {
        errors.push(fail("invalid_type", `${path}.faces`, "a polyhedron needs at least four faces"))
        return null
      }
      const faces: number[][] = []
      for (const [faceIndex, ring] of value.faces.entries()) {
        if (!Array.isArray(ring) || ring.length < 3) {
          errors.push(fail("invalid_type", `${path}.faces[${faceIndex}]`, "a face ring needs at least three vertex indexes"))
          return null
        }
        const indexes: number[] = []
        for (const [cornerIndex, corner] of ring.entries()) {
          if (!Number.isInteger(corner) || corner < 0 || corner >= vertices.length) {
            errors.push(fail("invalid_type", `${path}.faces[${faceIndex}][${cornerIndex}]`, `a face ring index must be an integer in 0..${vertices.length - 1}`))
            return null
          }
          if (indexes.includes(corner)) {
            errors.push(fail("duplicate_index", `${path}.faces[${faceIndex}][${cornerIndex}]`, "a face ring must not repeat a vertex"))
            return null
          }
          indexes.push(corner)
        }
        faces.push(indexes)
      }
      out.faces = faces
      if (typeof value.label === "string") out.label = value.label
      return out
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

