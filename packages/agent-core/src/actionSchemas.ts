import { updatableInputFields } from "@draw/scene-graph"
import type { DraftAction, ParseResult } from "./contracts"
import { parseDraftAction } from "./schemas"
import { ACTIONS, type ActionId, type ActionSpec } from "./actionRegistry"

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

const NUMBER_FIELDS = new Set([
  "radius", "radiusX", "radiusY", "height", "edge", "sides", "focalParameter", "rotation", "startAngle", "endAngle",
  "x", "y", "factor", "parameter", "value", "min", "max", "step", "strokeWidth", "opacity"
])

const STRING_FIELDS = new Set([
  "alias", "label", "id", "expression", "sourceId", "sourcePointId", "circleId", "pointId", "sectionId", "pathId",
  "parameterId", "analysis", "template", "kind", "axis", "stroke", "fill"
])

const PLANAR_FIELDS = new Set(["center", "vertex"])
const SPATIAL_FIELDS = new Set(["origin", "baseCenter", "size", "vector"])
const BOOLEAN_FIELDS = new Set(["visible", "locked"])

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

function schemaForField(field: string, spec: ActionSpec, actionId: ActionId): JsonSchema {
  const enumValues = spec.enumValues?.[field]
  if (enumValues !== undefined) return { type: "string", enum: enumValues }
  const reference = spec.references?.find((entry) => entry.field === field && entry.nested === undefined)
  if (reference?.list) return { type: "array", items: reference.kind === "scoped" ? scopedReferenceSchema : { type: "string" } }
  if (reference !== undefined) return reference.kind === "scoped" ? scopedReferenceSchema : { type: "string" }
  if (field === "hostSub") return { type: "integer", minimum: 0 }
  if (field === "sides") return { type: "integer" }
  if (NUMBER_FIELDS.has(field)) return { type: "number" }
  if (BOOLEAN_FIELDS.has(field)) return { type: "boolean" }
  if (STRING_FIELDS.has(field)) return { type: "string" }
  if (PLANAR_FIELDS.has(field)) return pointSchema
  if (SPATIAL_FIELDS.has(field)) return vectorSchema
  if (field === "anchor" && actionId === "function.create_tangent") return tangentAnchorSchema
  if (field === "plane") return planeSchema
  if (field === "points") return { type: "array", items: pointSchema }
  if (field === "basePolygon") return { type: "array", items: vectorSchema, minItems: 3 }
  if (field === "vertices") return { type: "array", items: vectorSchema, minItems: 4 }
  if (field === "faces") return { type: "array", items: { type: "array", items: { type: "integer", minimum: 0 }, minItems: 3 }, minItems: 4 }
  if (field === "patch") return {
    type: "object",
    properties: Object.fromEntries(updatableInputFields().map((key) => [key, schemaForField(key, { inputFields: [], requiresAlias: false }, actionId)])),
    additionalProperties: false
  }
  throw new Error(`no schema mapping for ${actionId}.${field}`)
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
