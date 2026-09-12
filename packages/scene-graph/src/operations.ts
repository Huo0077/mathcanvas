import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { evaluateLineParameters, evaluateParameterExpressions, intersectLines } from "@draw/geometry-kernel"

export type DomainOperation =
  | { op: "addPrimitive"; primitive: PrimitiveSpec }
  | { op: "setParameter"; id: string; value: number }
  | { op: "setParameterExpression"; id: string; expression: string }
  | { op: "deleteObject"; id: string }
  | { op: "toggleVisibility"; id: string; visible: boolean }

export interface OperationResult {
  document: GeometryDocument
  changed: boolean
  error?: string
}

export function recomputeDerivedObjects(document: GeometryDocument): GeometryDocument {
  const parameters = evaluateParameterExpressions(document.parameters)
  const evaluatedDocument = { ...document, parameters }
  const lines = new Map(
    evaluatedDocument.primitives
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "line" }> => primitive.type === "line")
      .map((line) => [line.id, evaluateLineParameters(evaluatedDocument, line)])
  )
  const primitives = evaluatedDocument.primitives.map((primitive) => {
    if (primitive.type === "line") return lines.get(primitive.id) ?? primitive
    if (primitive.type !== "intersection") return primitive
    const first = lines.get(primitive.lineA)
    const second = lines.get(primitive.lineB)
    if (!first || !second) return { ...primitive, visible: false }
    const point = intersectLines(first, second)
    return point ? { ...primitive, x: point.x, y: point.y, visible: true } : { ...primitive, visible: false }
  })
  return { ...evaluatedDocument, primitives }
}

export function applyOperation(document: GeometryDocument, operation: DomainOperation): OperationResult {
  const next = structuredClone(document) as GeometryDocument
  if (operation.op === "addPrimitive") {
    if (next.primitives.some((primitive) => primitive.id === operation.primitive.id)) return { document, changed: false, error: "duplicate object id" }
    next.primitives.push(operation.primitive)
  } else if (operation.op === "setParameter") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: operation.value }
    next.parameters[operation.id] = { ...parameter, value: operation.value, expression: undefined }
  } else if (operation.op === "setParameterExpression") {
    const parameter = next.parameters[operation.id] ?? { id: operation.id, value: 0 }
    next.parameters[operation.id] = { ...parameter, expression: operation.expression }
  } else if (operation.op === "deleteObject") {
    const before = next.primitives.length
    next.primitives = next.primitives.filter((primitive) => primitive.id !== operation.id)
    if (before === next.primitives.length) return { document, changed: false, error: "object not found" }
  } else if (operation.op === "toggleVisibility") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    primitive.visible = operation.visible
  }
  try {
    const recomputed = recomputeDerivedObjects(next)
    recomputed.revision += 1
    recomputed.metadata.updatedAt = new Date().toISOString()
    return { document: recomputed, changed: true }
  } catch (error) {
    return { document, changed: false, error: error instanceof Error ? error.message : "Failed to recompute document" }
  }
}
