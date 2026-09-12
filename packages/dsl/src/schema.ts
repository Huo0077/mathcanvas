import type { GeometryDocument, ValidationResult } from "./types"

const workspaces = new Set(["calculus", "conics", "cad", "geometry3d"])

export function validateDocument(document: unknown): ValidationResult {
  const errors: string[] = []
  if (!document || typeof document !== "object") return { valid: false, errors: ["document must be an object"] }
  const value = document as Partial<GeometryDocument>
  if (value.schemaVersion !== "0.1") errors.push("schemaVersion must be 0.1")
  if (!Number.isInteger(value.revision) || (value.revision ?? -1) < 0) errors.push("revision must be a non-negative integer")
  if (!workspaces.has(value.workspace ?? "")) errors.push("workspace is invalid")
  if (!value.parameters || typeof value.parameters !== "object") errors.push("parameters must be an object")
  if (!Array.isArray(value.primitives)) errors.push("primitives must be an array")
  if (!Array.isArray(value.constraints)) errors.push("constraints must be an array")
  if (!Array.isArray(value.dynamics)) errors.push("dynamics must be an array")
  if (!Array.isArray(value.annotations)) errors.push("annotations must be an array")
  if (!value.metadata || typeof value.metadata !== "object" || !value.metadata.id) errors.push("metadata.id is required")
  if (Array.isArray(value.primitives)) {
    const ids = new Set<string>()
    for (const primitive of value.primitives) {
      if (!primitive || typeof primitive !== "object" || typeof primitive.id !== "string") {
        errors.push("every primitive needs a stable id")
        continue
      }
      if (ids.has(primitive.id)) errors.push(`duplicate primitive id: ${primitive.id}`)
      ids.add(primitive.id)
      if (!["point", "line", "circle", "intersection"].includes(primitive.type)) errors.push(`invalid primitive type: ${primitive.type}`)
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true }
}
