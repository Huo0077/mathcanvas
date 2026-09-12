import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { parseExpression } from "@draw/geometry-kernel"

import { applyOperation, type DomainOperation, type OperationResult } from "./operations"

export type PatchValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] }

function primitiveIds(document: GeometryDocument): Set<string> {
  return new Set(document.primitives.map((primitive) => primitive.id))
}

function isPrimitive(value: unknown): value is PrimitiveSpec {
  return Boolean(value && typeof value === "object" && "id" in value && "type" in value)
}

export function validatePatch(document: GeometryDocument, operation: DomainOperation): PatchValidationResult {
  const ids = primitiveIds(document)
  const errors: string[] = []
  if (operation.op === "addPrimitive") {
    if (!isPrimitive(operation.primitive)) errors.push("primitive is invalid")
    if (ids.has(operation.primitive.id)) errors.push("duplicate object id")
    if (operation.primitive.type === "intersection") {
      const lineIds = new Set(document.primitives.filter((primitive) => primitive.type === "line").map((line) => line.id))
      if (!lineIds.has(operation.primitive.lineA) || !lineIds.has(operation.primitive.lineB)) errors.push("intersection references missing line")
    }
  }
  if (operation.op === "setParameter" && !Number.isFinite(operation.value)) errors.push("parameter value must be finite")
  if (operation.op === "setParameterExpression") {
    try {
      parseExpression(operation.expression)
    } catch {
      errors.push("invalid parameter expression")
    }
  }
  if ((operation.op === "deleteObject" || operation.op === "toggleVisibility") && !ids.has(operation.id)) errors.push("object not found")
  return errors.length ? { valid: false, errors } : { valid: true }
}

export function commitPatch(document: GeometryDocument, operation: DomainOperation): OperationResult {
  const validation = validatePatch(document, operation)
  if (!validation.valid) return { document, changed: false, error: validation.errors.join(", ") }
  return applyOperation(document, operation)
}
