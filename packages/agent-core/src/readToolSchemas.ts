import type { ToolDescriptor } from "./toolRegistry"
import type { ParseResult } from "./contracts"
import { boundedString, fail, isPlainObject, rejectUnknownFields } from "./schemaReaders"

/** Native read-tool schemas are published only when the host ToolPort is connected. */
export const toolInputs = {
  "scene.inspect": { required: ["documentId"], properties: { documentId: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 } } },
  "scene.search_entities": { required: ["documentId", "query"], properties: { documentId: { type: "string" }, query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 } } },
  "scene.describe_entities": { required: ["documentId", "entityIds"], properties: { documentId: { type: "string" }, entityIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200 } } },
  "scene.dependencies": { required: ["documentId", "entityId"], properties: { documentId: { type: "string" }, entityId: { type: "string" } } }
} as const

export type ReadToolId = keyof typeof toolInputs

export function nativeReadToolName(id: ReadToolId): string {
  return id.replaceAll(".", "_")
}

export function readToolIdFromNative(name: string): ReadToolId | null {
  return (Object.keys(toolInputs) as ReadToolId[]).find((id) => nativeReadToolName(id) === name) ?? null
}

export function nativeReadToolSchema(tool: ToolDescriptor): { type: "function"; function: { name: string; description: string; parameters: unknown } } | null {
  if (!(tool.id in toolInputs) || tool.effect !== "none") return null
  const id = tool.id as ReadToolId
  return {
    type: "function",
    function: {
      name: nativeReadToolName(id),
      description: tool.description,
      parameters: { type: "object", ...toolInputs[id], additionalProperties: false }
    }
  }
}

export function isReadToolId(value: string): value is ReadToolId {
  return Object.prototype.hasOwnProperty.call(toolInputs, value)
}

/** One runtime parser for native and host read calls. Never pass unchecked model arguments to SceneTools. */
export function parseReadToolInput(toolId: ReadToolId, input: unknown): ParseResult<Record<string, unknown>> {
  if (!isPlainObject(input)) return { ok: false, errors: [fail("invalid_arguments", "tool.input", "expected an object")] }
  const errors: import("./contracts").ParseError[] = []
  const spec = toolInputs[toolId]
  const fields = Object.keys(spec.properties)
  rejectUnknownFields(input, fields, "tool.input", errors)
  for (const field of spec.required) if (input[field] === undefined) errors.push(fail("missing_field", `tool.input.${field}`, "required tool field"))
  const output: Record<string, unknown> = {}
  for (const field of fields) {
    if (input[field] === undefined) continue
    if (field === "limit") {
      if (!Number.isInteger(input[field]) || (input[field] as number) < 1 || (input[field] as number) > 200) {
        errors.push(fail("invalid_arguments", `tool.input.${field}`, "limit must be an integer between 1 and 200"))
      } else output[field] = input[field]
    } else if (field === "entityIds") {
      const ids = input[field]
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
        errors.push(fail("invalid_arguments", `tool.input.${field}`, "expected 1..200 entity ids"))
      } else {
        const values = ids.map((id, index) => boundedString(id, `tool.input.${field}[${index}]`, errors))
        if (values.every((id) => id !== null)) output[field] = values
      }
    } else {
      const value = boundedString(input[field], `tool.input.${field}`, errors)
      if (value !== null) output[field] = value
    }
  }
  return errors.length === 0 ? { ok: true, value: output } : { ok: false, errors }
}
