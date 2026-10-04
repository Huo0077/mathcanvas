import { updatableInputFields } from "@draw/scene-graph"
import type { DraftAction, ParseResult } from "./contracts"
import { parseDraftAction } from "./schemas"
import { ACTIONS, declaredFieldKind, type ActionId, type ActionSpec } from "./actionRegistry"

/** Minimal JSON Schema subset used to publish model-facing tool contracts. */
export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean"
  description?: string
  enum?: readonly string[]
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
  additionalProperties?: boolean
  items?: JsonSchema
  oneOf?: readonly JsonSchema[]
  minimum?: number
  minItems?: number
  maxItems?: number
}

export interface ActionToolSchema {
  actionId: ActionId
  name: string
  description: string
  inputSchema: JsonSchema
}

/**
 * 可改字段的类型表：**只有 `object.update_inputs` 的 `patch` 用**。
 *
 * 其余字段的种类一律读登记表的 `FIELD_KINDS`（见 `actionRegistry` 的「字段种类（schema 真源）」），
 * 这里不再维护第二份。
 */
const PATCH_FIELD_TYPES: Record<string, JsonSchema["type"]> = {
  x: "number", y: "number", radius: "number", label: "string", visible: "boolean", locked: "boolean"
}

const pointSchema: JsonSchema = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
  additionalProperties: false
}

const vectorSchema: JsonSchema = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    z: { type: "number" }
  },
  required: ["x", "y", "z"],
  additionalProperties: false
}

const scopedReferenceSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      properties: { scope: { type: "string", enum: ["draft"] }, alias: { type: "string" } },
      required: ["scope", "alias"],
      additionalProperties: false
    },
    {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["scene"] },
        ref: {
          type: "object",
          properties: { documentId: { type: "string" }, entityId: { type: "string" } },
          required: ["documentId", "entityId"],
          additionalProperties: false
        }
      },
      required: ["scope", "ref"],
      additionalProperties: false
    }
  ]
}

const planeSchema: JsonSchema = {
  oneOf: [
    { type: "object", properties: { normal: vectorSchema, constant: { type: "number" } }, required: ["normal", "constant"], additionalProperties: false },
    { type: "object", properties: { points: { type: "array", items: vectorSchema, minItems: 3, maxItems: 3 } }, required: ["points"], additionalProperties: false },
    { type: "object", properties: { throughPoints: { type: "array", items: vectorSchema, minItems: 3, maxItems: 3 } }, required: ["throughPoints"], additionalProperties: false },
    { type: "object", properties: { point: vectorSchema, normal: vectorSchema }, required: ["point", "normal"], additionalProperties: false },
    { type: "object", properties: { origin: vectorSchema, normal: vectorSchema }, required: ["origin", "normal"], additionalProperties: false }
  ]
}

const tangentAnchorSchema: JsonSchema = {
  oneOf: [
    { type: "object", properties: { kind: { type: "string", enum: ["point"] }, pointId: { type: "string" } }, required: ["kind", "pointId"], additionalProperties: false },
    { type: "object", properties: { kind: { type: "string", enum: ["parameter"] }, parameter: { type: "number" }, branch: { type: "integer" } }, required: ["kind", "parameter"], additionalProperties: false }
  ]
}

/**
 * 把登记表里的一个字段翻成 JSON Schema。
 *
 * 优先级是**枚举 > 引用 > 字段种类表的显式例外 > 字段种类表**：
 * 前两者是逐动作登记的（同一个字段在不同动作里可能一个是闭集、一个是自由字符串），
 * 后两者来自 `actionRegistry` 的全局种类表。
 */
function schemaForField(field: string, spec: ActionSpec, actionId: ActionId): JsonSchema {
  const enumValues = spec.enumValues?.[field]
  if (enumValues !== undefined) return { type: "string", enum: enumValues }
  /**
   * 一批 id：种类说"这是数组"，元素形状由引用的 `kind` 决定。
   *
   * `id` 引用 的元素是**裸 id 字符串**（`object.delete_many.targets`），
   * 与解析器摊平后的形状一致 —— 发布出去的 schema 与真正接受的载荷必须是同一种东西。
   */
  const reference = spec.references?.find((entry) => entry.field === field && entry.nested === undefined)
  if (reference?.list) return { type: "array", items: reference.kind === "scoped" ? scopedReferenceSchema : { type: "string" } }
  const kind = declaredFieldKind(spec, field)
  switch (kind) {
    case "string": return { type: "string" }
    case "number": return { type: "number" }
    case "integer": return { type: "integer" }
    case "boolean": return { type: "boolean" }
    case "point": return pointSchema
    case "vector": return vectorSchema
    case "pointList": return { type: "array", items: pointSchema }
    case "vectorList": return { type: "array", items: vectorSchema, minItems: 3 }
    case "vertexList": return { type: "array", items: vectorSchema, minItems: 4 }
    case "stringList": return { type: "array", items: { type: "string" } }
    case "faceRings": return { type: "array", items: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 3 }, minItems: 4 }
    case "plane": return planeSchema
    case "tangentAnchor": return tangentAnchorSchema
    case "updatablePatch": return { type: "object", properties: Object.fromEntries(updatableInputFields().map((key) => [key, schemaForPatchField(key)])), additionalProperties: false }
    case "scopedRef": return scopedReferenceSchema
    case "idList": return { type: "array", items: { type: "string" } }
    default:
      /**
       * **这里必须抛，不能兜底成 `{}`**：登记表加了新字段而种类表没跟上时，静默发布一个
       * 无类型约束的属性，等于把"我们承诺收什么"变成一句空话，而模型会照着它乱填。
       * 抛出来会在 `actionFieldParity.test.ts` 的"每个字段都有种类"那条用例上立刻红。
       */
      throw new Error(`no field kind registered for ${actionId}.${field}`)
  }
}

/**
 * `patch` 内部的字段 schema。种类来自动作层的 `updatableInputFields()` 白名单
 * （那是**唯一**一份可改字段清单），这里只补一层"每个字段是什么类型"，
 * 认不出的字段按数字处理并由用例钉住覆盖面 —— 白名单与这张类型表一旦分叉，patch 就会
 * 要么漏字段、要么把字符串字段标成数字。
 */
function schemaForPatchField(key: string): JsonSchema {
  return { type: PATCH_FIELD_TYPES[key] ?? "number" }
}

function requiredFieldsOf(spec: ActionSpec): string[] {
  // A field with a completion policy is required for the *geometry*, not necessarily from the model.
  // Only an explicit alias and fields without a completion policy must be present in this tool call.
  return [...new Set([...(spec.requiresAlias ? ["alias"] : []), ...(spec.required ?? []).filter((field) => spec.defaults?.[field] === undefined)])]
}

export function actionToolSchema(actionId: ActionId): ActionToolSchema {
  const spec = ACTIONS[actionId]
  const properties = Object.fromEntries(spec.inputFields.map((field) => [field, schemaForField(field, spec, actionId)]))
  return {
    actionId,
    name: actionId,
    description: `Execute the ${actionId} geometry action in the isolated draft.`,
    inputSchema: {
      type: "object",
      properties,
      required: requiredFieldsOf(spec),
      additionalProperties: false
    }
  }
}

export function allActionToolSchemas(): readonly ActionToolSchema[] {
  return (Object.keys(ACTIONS) as ActionId[]).map(actionToolSchema)
}


/** Reuse the plan parser for untrusted tool arguments; schema publication is not validation. */
export function parseActionToolInput(actionId: ActionId, input: unknown, actionKey: string): ParseResult<DraftAction> {
  return parseDraftAction({ actionId, actionKey, factIds: [], inputs: input }, "tool")
}
