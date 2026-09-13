import type { ConstraintSpec, GeometryDocument, GroupSpec, PrimitiveSpec } from "@draw/dsl"
import { evaluateLineParameters, evaluateParameterExpressions, intersectCirclesDetailed, intersectLineCircleDetailed, intersectLinesDetailed, intersectSampledPrimitives, solveLineConstraints, type IntersectionResult, type SampledPrimitive } from "@draw/geometry-kernel"

export type DomainOperation =
  | { op: "addPrimitive"; primitive: PrimitiveSpec }
  | { op: "updatePrimitive"; id: string; patch: PrimitiveUpdatePatch }
  | { op: "toggleLock"; id: string; locked: boolean }
  | { op: "setParameter"; id: string; value: number }
  | { op: "setParameterExpression"; id: string; expression: string }
  | { op: "addConstraint"; constraint: ConstraintSpec }
  | { op: "deleteConstraint"; id: string }
  | { op: "deleteObject"; id: string }
  | { op: "toggleVisibility"; id: string; visible: boolean }
  | { op: "createGroup"; group: GroupSpec }
  | { op: "deleteGroup"; id: string }
  | { op: "alignPrimitives"; ids: string[]; alignment: Alignment }
  | { op: "setPrimitivesLocked"; ids: string[]; locked: boolean }
  | { op: "setPrimitivesVisible"; ids: string[]; visible: boolean }

export type Alignment = "left" | "right" | "top" | "bottom" | "horizontalCenter" | "verticalCenter"

export interface PrimitiveUpdatePatch {
  a?: { x: number; y: number }
  b?: { x: number; y: number }
  center?: { x: number; y: number }
  vertex?: { x: number; y: number }
  radius?: number
  radiusX?: number
  radiusY?: number
  focalParameter?: number
  axis?: "x" | "y"
  startAngle?: number
  endAngle?: number
  points?: { x: number; y: number }[]
  expression?: string
  domain?: [number, number]
  samples?: number
}

export interface OperationResult {
  document: GeometryDocument
  changed: boolean
  error?: string
}

interface PrimitiveBounds { minX: number; maxX: number; minY: number; maxY: number }

function angleOnArc(angle: number, start: number, end: number): boolean {
  const full = Math.PI * 2
  const normalized = (value: number) => (value % full + full) % full
  const delta = end - start
  const direction = delta >= 0 ? 1 : -1
  const span = Math.min(Math.abs(delta), full)
  return normalized(direction * (angle - start)) <= span + 1e-10
}

function primitiveBounds(primitive: PrimitiveSpec): PrimitiveBounds | null {
  if (primitive.type === "point") return { minX: primitive.x, maxX: primitive.x, minY: primitive.y, maxY: primitive.y }
  if (primitive.type === "line" || primitive.type === "segment") return {
    minX: Math.min(primitive.a.x, primitive.b.x), maxX: Math.max(primitive.a.x, primitive.b.x),
    minY: Math.min(primitive.a.y, primitive.b.y), maxY: Math.max(primitive.a.y, primitive.b.y)
  }
  if (primitive.type === "circle") return { minX: primitive.center.x - primitive.radius, maxX: primitive.center.x + primitive.radius, minY: primitive.center.y - primitive.radius, maxY: primitive.center.y + primitive.radius }
  if (primitive.type === "arc") {
    const angles = [primitive.startAngle, primitive.endAngle, 0, Math.PI / 2, Math.PI, Math.PI * 1.5].filter((angle) => angle === primitive.startAngle || angle === primitive.endAngle || angleOnArc(angle, primitive.startAngle, primitive.endAngle))
    const points = angles.map((angle) => ({ x: primitive.center.x + primitive.radius * Math.cos(angle), y: primitive.center.y + primitive.radius * Math.sin(angle) }))
    return { minX: Math.min(...points.map((point) => point.x)), maxX: Math.max(...points.map((point) => point.x)), minY: Math.min(...points.map((point) => point.y)), maxY: Math.max(...points.map((point) => point.y)) }
  }
  return null
}

function translatePrimitive(primitive: PrimitiveSpec, x: number, y: number): PrimitiveSpec {
  if (primitive.type === "point") return { ...primitive, x: primitive.x + x, y: primitive.y + y }
  if (primitive.type === "line" || primitive.type === "segment") return {
    ...primitive,
    a: { x: primitive.a.x + x, y: primitive.a.y + y },
    b: { x: primitive.b.x + x, y: primitive.b.y + y }
  }
  if (primitive.type === "circle" || primitive.type === "arc") return { ...primitive, center: { x: primitive.center.x + x, y: primitive.center.y + y } }
  return primitive
}

function primitiveDependencies(primitive: PrimitiveSpec): string[] {
  if (primitive.type === "line") return primitive.slopeParameter ? [primitive.slopeParameter] : []
  if (primitive.type === "intersection") return [primitive.lineA, primitive.lineB]
  if (primitive.type === "lineCircleIntersection") return [primitive.lineId, primitive.circleId]
  if (primitive.type === "circleIntersection") return [primitive.circleA, primitive.circleB]
  if (primitive.type === "curveIntersection") return [primitive.objectA, primitive.objectB]
  return []
}

function isSampledPrimitive(primitive: PrimitiveSpec | undefined): primitive is SampledPrimitive {
  return Boolean(primitive && ["line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function"].includes(primitive.type))
}

export function getAffectedPrimitiveIds(document: GeometryDocument, changedIds: string[]): Set<string> {
  const dependents = new Map<string, string[]>()
  for (const primitive of document.primitives) {
    for (const dependency of primitiveDependencies(primitive)) {
      dependents.set(dependency, [...(dependents.get(dependency) ?? []), primitive.id])
    }
  }
  for (const constraint of document.constraints) {
    if (constraint.targets.length !== 2) continue
    const [first, second] = constraint.targets
    dependents.set(first, [...(dependents.get(first) ?? []), second])
    dependents.set(second, [...(dependents.get(second) ?? []), first])
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

function resolveIntersection(primitive: Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" }>, lines: Map<string, Extract<PrimitiveSpec, { type: "line" }>>, circles: Map<string, Extract<PrimitiveSpec, { type: "circle" }>>): IntersectionResult {
  if (primitive.type === "intersection") {
    const first = lines.get(primitive.lineA)
    const second = lines.get(primitive.lineB)
    return first && second ? intersectLinesDetailed(first, second) : { kind: "degenerate", reason: "intersection references missing line" }
  }
  if (primitive.type === "lineCircleIntersection") {
    const line = lines.get(primitive.lineId)
    const circle = circles.get(primitive.circleId)
    return line && circle ? intersectLineCircleDetailed(line, circle) : { kind: "degenerate", reason: "line-circle intersection references missing object" }
  }
  const first = circles.get(primitive.circleA)
  const second = circles.get(primitive.circleB)
  return first && second ? intersectCirclesDetailed(first, second) : { kind: "degenerate", reason: "circle intersection references missing circle" }
}

export function recomputeDerivedObjects(document: GeometryDocument, changedIds?: string[]): GeometryDocument {
  const parameters = evaluateParameterExpressions(document.parameters)
  const evaluatedDocument = {
    ...document,
    parameters,
    primitives: document.primitives.map((primitive) => primitive.type === "line" ? evaluateLineParameters({ ...document, parameters }, primitive) : primitive)
  }
  const affected = changedIds === undefined
    ? new Set(document.primitives.map((primitive) => primitive.id))
    : getAffectedPrimitiveIds(document, changedIds)
  const projectedPrimitives = [...evaluatedDocument.primitives]
  const projectedLines = new Map(
    projectedPrimitives
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "line" }> => primitive.type === "line")
      .map((line) => [line.id, line])
  )
  const activeLineIds = changedIds === undefined
    ? undefined
    : new Set([...affected].filter((id) => projectedLines.has(id)))
  const activeConstraintIds = changedIds === undefined
    ? undefined
    : new Set(evaluatedDocument.constraints
      .filter((constraint) => constraint.targets.length === 2 && constraint.targets.every((target) => affected.has(target)))
      .map((constraint) => constraint.id))
  const solved = solveLineConstraints(projectedLines, evaluatedDocument.constraints, undefined, undefined, changedIds === undefined ? undefined : activeLineIds, activeConstraintIds)
  if (!solved.converged) throw new Error("constraint solving failed to converge")
  const lines = solved.lines
  const primitiveIndexById = new Map(projectedPrimitives.map((primitive, index) => [primitive.id, index]))
  for (const [id, projected] of lines) {
    const primitiveIndex = primitiveIndexById.get(id)
    if (primitiveIndex !== undefined) projectedPrimitives[primitiveIndex] = projected
  }
  const circles = new Map(
    projectedPrimitives
      .filter((primitive): primitive is Extract<PrimitiveSpec, { type: "circle" }> => primitive.type === "circle")
      .map((circle) => [circle.id, circle])
  )
  const primitiveMap = new Map(projectedPrimitives.map((primitive) => [primitive.id, primitive]))
  const primitives = projectedPrimitives.map((primitive) => {
    if (!affected.has(primitive.id)) return primitive
    if (primitive.type === "line") return lines.get(primitive.id) ?? primitive
    if (primitive.type === "curveIntersection") {
      const first = primitiveMap.get(primitive.objectA)
      const second = primitiveMap.get(primitive.objectB)
      if (!isSampledPrimitive(first) || !isSampledPrimitive(second)) throw new Error("curve intersection references unsupported objects")
      const result = intersectSampledPrimitives(first, second)
      if (result.kind === "degenerate") throw new Error(`degenerate curve intersection: ${result.reason}`)
      if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
      if (result.kind === "point" || result.kind === "tangent") return { ...primitive, x: result.point.x, y: result.point.y, visible: true }
      const point = result.points[primitive.solutionIndex ?? 0]
      return { ...primitive, x: point.x, y: point.y, visible: true }
    }
    if (primitive.type !== "intersection" && primitive.type !== "lineCircleIntersection" && primitive.type !== "circleIntersection") return primitive
    const result = resolveIntersection(primitive, lines, circles)
    if (result.kind === "degenerate") throw new Error(`degenerate intersection: ${result.reason}`)
    if (result.kind === "none" || result.kind === "coincident") return { ...primitive, visible: false }
    if (result.kind === "point" || result.kind === "tangent") return { ...primitive, x: result.point.x, y: result.point.y, visible: true }
    const point = result.points[primitive.type === "intersection" ? 0 : primitive.solutionIndex ?? 0]
    return { ...primitive, x: point.x, y: point.y, visible: true }
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
  } else if (operation.op === "updatePrimitive") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || !["line", "segment", "ray", "polyline", "parabola", "ellipse", "hyperbola", "function", "circle", "arc"].includes(primitive.type) || primitive.locked) return { document, changed: false, error: primitive?.locked ? "object is locked" : "object is not editable" }
    if (primitive.type === "line" || primitive.type === "segment" || primitive.type === "ray") {
      if (operation.patch.a) primitive.a = { ...primitive.a, ...operation.patch.a }
      if (operation.patch.b) primitive.b = { ...primitive.b, ...operation.patch.b }
    }
    if (primitive.type === "polyline" && operation.patch.points) primitive.points = operation.patch.points
    if (primitive.type === "parabola") {
      if (operation.patch.vertex) primitive.vertex = { ...primitive.vertex, ...operation.patch.vertex }
      if (operation.patch.focalParameter !== undefined) primitive.focalParameter = operation.patch.focalParameter
      if (operation.patch.axis !== undefined) primitive.axis = operation.patch.axis
    }
    if (primitive.type === "ellipse" || primitive.type === "hyperbola") {
      if (operation.patch.center) primitive.center = { ...primitive.center, ...operation.patch.center }
      if (operation.patch.radiusX !== undefined) primitive.radiusX = operation.patch.radiusX
      if (operation.patch.radiusY !== undefined) primitive.radiusY = operation.patch.radiusY
      if (primitive.type === "hyperbola" && operation.patch.axis !== undefined) primitive.axis = operation.patch.axis
    }
    if (primitive.type === "function") {
      if (operation.patch.expression !== undefined) primitive.expression = operation.patch.expression
      if (operation.patch.domain !== undefined) primitive.domain = operation.patch.domain
      if (operation.patch.samples !== undefined) primitive.samples = operation.patch.samples
    }
    if (primitive.type === "circle" || primitive.type === "arc") {
      if (operation.patch.center) primitive.center = { ...primitive.center, ...operation.patch.center }
      if (operation.patch.radius !== undefined) primitive.radius = operation.patch.radius
    }
    if (primitive.type === "arc") {
      if (operation.patch.startAngle !== undefined) primitive.startAngle = operation.patch.startAngle
      if (operation.patch.endAngle !== undefined) primitive.endAngle = operation.patch.endAngle
    }
    changedIds = [operation.id]
  } else if (operation.op === "toggleLock") {
    const primitive = next.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive) return { document, changed: false, error: "object not found" }
    primitive.locked = operation.locked
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
    changedIds = operation.constraint.targets
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
  } else if (operation.op === "createGroup") {
    next.groups.push(operation.group)
  } else if (operation.op === "deleteGroup") {
    next.groups = next.groups.filter((group) => group.id !== operation.id)
  } else if (operation.op === "setPrimitivesLocked") {
    for (const primitive of next.primitives) if (operation.ids.includes(primitive.id)) primitive.locked = operation.locked
  } else if (operation.op === "setPrimitivesVisible") {
    for (const primitive of next.primitives) if (operation.ids.includes(primitive.id)) primitive.visible = operation.visible
  } else if (operation.op === "alignPrimitives") {
    const selected = next.primitives.filter((primitive) => operation.ids.includes(primitive.id))
    const bounds = selected.map((primitive) => primitiveBounds(primitive)!)
    const target = operation.alignment === "left" ? Math.min(...bounds.map((value) => value.minX))
      : operation.alignment === "right" ? Math.max(...bounds.map((value) => value.maxX))
        : operation.alignment === "top" ? Math.max(...bounds.map((value) => value.maxY))
          : operation.alignment === "bottom" ? Math.min(...bounds.map((value) => value.minY))
            : operation.alignment === "horizontalCenter" ? bounds.reduce((sum, value) => sum + (value.minX + value.maxX) / 2, 0) / bounds.length
              : bounds.reduce((sum, value) => sum + (value.minY + value.maxY) / 2, 0) / bounds.length
    next.primitives = next.primitives.map((primitive) => {
      if (!operation.ids.includes(primitive.id)) return primitive
      const value = primitiveBounds(primitive)!
      const x = operation.alignment === "left" ? target - value.minX
        : operation.alignment === "right" ? target - value.maxX
          : operation.alignment === "horizontalCenter" ? target - (value.minX + value.maxX) / 2 : 0
      const y = operation.alignment === "top" ? target - value.maxY
        : operation.alignment === "bottom" ? target - value.minY
          : operation.alignment === "verticalCenter" ? target - (value.minY + value.maxY) / 2 : 0
      return translatePrimitive(primitive, x, y)
    })
    changedIds = operation.ids
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
