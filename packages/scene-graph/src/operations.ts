import type { ConstraintSpec, GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { evaluateLineParameters, evaluateParameterExpressions, intersectCircles, intersectLineCircle, intersectLines } from "@draw/geometry-kernel"

export type DomainOperation =
  | { op: "addPrimitive"; primitive: PrimitiveSpec }
  | { op: "setParameter"; id: string; value: number }
  | { op: "setParameterExpression"; id: string; expression: string }
  | { op: "addConstraint"; constraint: ConstraintSpec }
  | { op: "deleteConstraint"; id: string }
  | { op: "deleteObject"; id: string }
  | { op: "toggleVisibility"; id: string; visible: boolean }

export interface OperationResult {
  document: GeometryDocument
  changed: boolean
  error?: string
}

function primitiveDependencies(primitive: PrimitiveSpec): string[] {
  if (primitive.type === "line") return primitive.slopeParameter ? [primitive.slopeParameter] : []
  if (primitive.type === "intersection") return [primitive.lineA, primitive.lineB]
  if (primitive.type === "lineCircleIntersection") return [primitive.lineId, primitive.circleId]
  if (primitive.type === "circleIntersection") return [primitive.circleA, primitive.circleB]
  return []
}

export function getAffectedPrimitiveIds(document: GeometryDocument, changedIds: string[]): Set<string> {
  const dependents = new Map<string, string[]>()
  for (const primitive of document.primitives) {
    for (const dependency of primitiveDependencies(primitive)) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), primitive.id])
    }
  }
  const affected = new Set(changedIds)
  const queue = [...changedIds]
  while (queue.length) {
    const changedId = queue.shift()!
    for (const dependent of dependents.get(changedId) ?? []) {
      if (affected.has(dependent)) continue
      affected.add(dependent)
      queue.push(dependent)
    }
  }
  return affected
}

function resolveIntersection(primitive: Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" }>, lines: Map<string, Extract<PrimitiveSpec, { type: "line" }>>, circles: Map<string, Extract<PrimitiveSpec, { type: "circle" }>>): { x: number; y: number } | null {
  if (primitive.type === "intersection") {
    const first = lines.get(primitive.lineA)
    const second = lines.get(primitive.lineB)
    return first && second ? intersectLines(first, second) : null
  }
  if (primitive.type === "lineCircleIntersection") {
    const line = lines.get(primitive.lineId)
    const circle = circles.get(primitive.circleId)
    const point = line && circle ? intersectLineCircle(line, circle)[primitive.solutionIndex ?? 0] : undefined
    return point ?? null
  }
  const first = circles.get(primitive.circleA)
  const second = circles.get(primitive.circleB)
  const point = first && second ? intersectCircles(first, second)[primitive.solutionIndex ?? 0] : undefined
  return point ?? null
}

export function recomputeDerivedObjects(document: GeometryDocument, changedIds?: string[]): GeometryDocument {
  const parameters = evaluateParameterExpressions(document.parameters)
  const evaluatedDocument = { ...document, parameters }
  const affected = changedIds === undefined
    ? new Set(document.primitives.map((primitive) => primitive.id))
    : getAffectedPrimitiveIds(document, changedIds)
  const lines = new Map(
    evaluatedDocument.primitives
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "line" }> => primitive.type === "line")
      .map((line) => [line.id, evaluateLineParameters(evaluatedDocument, line)])
  )
  const circles = new Map(
    evaluatedDocument.primitives
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "circle" }> => primitive.type === "circle")
      .map((circle) => [circle.id, circle])
  )
  const primitives = evaluatedDocument.primitives.map((primitive) => {
    if (!affected.has(primitive.id)) return primitive
    if (primitive.type === "line") return lines.get(primitive.id) ?? primitive
    if (primitive.type !== "intersection" && primitive.type !== "lineCircleIntersection" && primitive.type !== "circleIntersection") return primitive
    const point = resolveIntersection(primitive, lines, circles)
    return point ? { ...primitive, x: point.x, y: point.y, visible: true } : { ...primitive, visible: false }
  })
  return { ...evaluatedDocument, primitives }
}

export function applyOperation(document: GeometryDocument, operation: DomainOperation): OperationResult {
  const next = structuredClone(document) as GeometryDocument
  let changedIds: string[] = []
  if (operation.op === "addPrimitive") {
    if (next.primitives.some((primitive) => primitive.id === operation.primitive.id)) return { document, changed: false, error: "duplicate object id" }
    next.primitives.push(operation.primitive)
    changedIds = [operation.primitive.id]
  } else if (operation.op === "setParameter") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: operation.value }
    next.parameters[operation.id] = { ...parameter, value: operation.value, expression: undefined }
    changedIds = [operation.id]
  } else if (operation.op === "setParameterExpression") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: 0 }
    next.parameters[operation.id] = { ...parameter, expression: operation.expression }
    changedIds = [operation.id]
  } else if (operation.op === "addConstraint") {
    if (next.constraints.some((constraint) => constraint.id === operation.constraint.id)) return { document, changed: false, error: "duplicate constraint id" }
    next.constraints.push(operation.constraint)
  } else if (operation.op === "deleteObject") {
    const before = next.primitives.length
    next.primitives = next.primitives.filter((primitive) => primitive.id !== operation.id)
    if (before === next.primitives.length) return { document, changed: false, error: "object not found" }
    changedIds = [operation.id]
  } else if (operation.op === "deleteConstraint") {
    const before = next.constraints.length
    next.constraints = next.constraints.filter((constraint) => constraint.id !== operation.id)
    if (before === next.constraints.length) return { document, changed: false, error: "constraint not found" }
  } else if (operation.op === "toggleVisibility") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    primitive.visible = operation.visible
  }
  try {
    const recomputed = recomputeDerivedObjects(next, changedIds)
    recomputed.revision += 1
    recomputed.metadata.updatedAt = new Date().toISOString()
    return { document: recomputed, changed: true }
  } catch (error) {
    return { document, changed: false, error: error instanceof Error ? error.message : "Failed to recompute document" }
  }
}
