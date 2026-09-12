import type { ConstraintSpec, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
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

function isConstraint(value: unknown): value is ConstraintSpec {
  return Boolean(value && typeof value === "object" && "id" in value && "type" in value && "targets" in value)
}

export function validatePatch(document: GeometryDocument, operation: DomainOperation): PatchValidationResult {
  const ids = primitiveIds(document)
  const errors: string[] = []
  if (operation.op === "addPrimitive") {
    const primitive = operation.primitive
    if (!isPrimitive(primitive)) errors.push("primitive is invalid")
    if (ids.has(primitive.id)) errors.push("duplicate object id")
    if (primitive.type === "intersection") {
      const lineIds = new Set(document.primitives.filter((primitive) => primitive.type === "line").map((line) => line.id))
      if (!lineIds.has(primitive.lineA) || !lineIds.has(primitive.lineB)) errors.push("intersection references missing line")
    }
    if (primitive.type === "lineCircleIntersection") {
      const line = document.primitives.find((candidate) => candidate.id === primitive.lineId)
      const circle = document.primitives.find((candidate) => candidate.id === primitive.circleId)
      if (line?.type !== "line" || circle?.type !== "circle") errors.push("line-circle intersection references invalid objects")
    }
    if (primitive.type === "circleIntersection") {
      const first = document.primitives.find((candidate) => candidate.id === primitive.circleA)
      const second = document.primitives.find((candidate) => candidate.id === primitive.circleB)
      if (first?.type !== "circle" || second?.type !== "circle") errors.push("circle intersection references invalid circles")
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
  if (operation.op === "addConstraint") {
    if (!isConstraint(operation.constraint)) errors.push("constraint is invalid")
    if (document.constraints.some((constraint) => constraint.id === operation.constraint.id)) errors.push("duplicate constraint id")
    if (operation.constraint.targets.length !== 2 || operation.constraint.targets.some((target) => !ids.has(target))) errors.push("constraint has invalid targets")
    if ((operation.constraint.type === "parallel" || operation.constraint.type === "perpendicular") && operation.constraint.targets.some((target) => document.primitives.find((primitive) => primitive.id === target)?.type !== "line")) errors.push("constraint requires two lines")
  }
  if (operation.op === "deleteConstraint" && !document.constraints.some((constraint) => constraint.id === operation.id)) errors.push("constraint not found")
  if ((operation.op === "deleteObject" || operation.op === "toggleVisibility") && !ids.has(operation.id)) errors.push("object not found")
  if (operation.op === "deleteObject" && document.constraints.some((constraint) => constraint.targets.includes(operation.id))) errors.push("object is referenced by constraint")
  return errors.length ? { valid: false, errors } : { valid: true }
}

export function commitPatch(document: GeometryDocument, operation: DomainOperation): OperationResult {
  const validation = validatePatch(document, operation)
  if (!validation.valid) return { document, changed: false, error: validation.errors.join(", ") }
  return applyOperation(document, operation)
}
