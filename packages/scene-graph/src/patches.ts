import { validateDocument, type AnnotationSpec, type ConstraintSpec, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { parseExpression } from "@draw/geometry-kernel"

import { applyOperation, type DomainOperation } from "./operations"

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

function isAnnotation(value: unknown): value is AnnotationSpec {
  return Boolean(value && typeof value === "object" && "id" in value && "text" in value)
}

function isCoordinate(value: unknown): value is { x: number; y: number } {
  return Boolean(value && typeof value === "object" && Number.isFinite((value as { x?: unknown }).x) && Number.isFinite((value as { y?: unknown }).y))
}

function isReferenced(document: GeometryDocument, id: string): boolean {
  return document.groups.some((group) => group.members.includes(id)) || document.constraints.some((constraint) => constraint.targets.includes(id)) || document.annotations.some((annotation) => annotation.target === id || (annotation.anchor?.kind === "primitive" && annotation.anchor.primitiveId === id)) || document.primitives.some((primitive) => (
    (primitive.type === "intersection" && (primitive.lineA === id || primitive.lineB === id)) ||
    (primitive.type === "lineCircleIntersection" && (primitive.lineId === id || primitive.circleId === id)) ||
    (primitive.type === "circleIntersection" && (primitive.circleA === id || primitive.circleB === id)) ||
    (primitive.type === "curveIntersection" && (primitive.objectA === id || primitive.objectB === id))
    || (primitive.type === "intersectionSet" && (primitive.objectA === id || primitive.objectB === id))
    || (primitive.type === "derivative" && primitive.sourceId === id)
    || ((primitive.type === "tangent" || primitive.type === "normal" || primitive.type === "secant") && primitive.sourceId === id)
    || ((primitive.type === "integral" || primitive.type === "analysisSet") && primitive.sourceId === id)
  ))
}

export function validatePatch(document: GeometryDocument, operation: DomainOperation): PatchValidationResult {
  const ids = primitiveIds(document)
  const errors: string[] = []
  if (operation.op === "addPrimitive") {
    const primitive = operation.primitive
    if (!isPrimitive(primitive)) errors.push("primitive is invalid")
    else {
      if (ids.has(primitive.id)) errors.push("duplicate object id")
      const validation = validateDocument({ ...document, primitives: [...document.primitives, primitive] })
      if (!validation.valid) errors.push(...validation.errors.filter((error) => !error.startsWith("duplicate primitive id:")))
    }
  }
  if (operation.op === "updatePrimitive") {
    const primitive = document.primitives.find((candidate) => candidate.id === operation.id)
    const editable = ["point", "line", "segment", "ray", "polyline", "parabola", "ellipse", "hyperbola", "function", "circle", "arc"]
    if (!primitive || !editable.includes(primitive.type)) errors.push("object is not editable")
    if (primitive?.locked) errors.push("object is locked")
    if (operation.patch.a && !isCoordinate(operation.patch.a)) errors.push("line start must be finite")
    if (operation.patch.b && !isCoordinate(operation.patch.b)) errors.push("line end must be finite")
    if (operation.patch.x !== undefined && !Number.isFinite(operation.patch.x)) errors.push("point X must be finite")
    if (operation.patch.y !== undefined && !Number.isFinite(operation.patch.y)) errors.push("point Y must be finite")
    if (operation.patch.center && !isCoordinate(operation.patch.center)) errors.push("center must be finite")
    if (operation.patch.vertex && !isCoordinate(operation.patch.vertex)) errors.push("vertex must be finite")
    if (operation.patch.radius !== undefined && (!Number.isFinite(operation.patch.radius) || operation.patch.radius <= 0)) errors.push("radius must be positive")
    if (operation.patch.radiusX !== undefined && (!Number.isFinite(operation.patch.radiusX) || operation.patch.radiusX <= 0)) errors.push("radius X must be positive")
    if (operation.patch.radiusY !== undefined && (!Number.isFinite(operation.patch.radiusY) || operation.patch.radiusY <= 0)) errors.push("radius Y must be positive")
    if (operation.patch.focalParameter !== undefined && (!Number.isFinite(operation.patch.focalParameter) || operation.patch.focalParameter === 0)) errors.push("focal parameter must be non-zero")
    if (operation.patch.axis !== undefined && !["x", "y"].includes(operation.patch.axis)) errors.push("axis is invalid")
    if (operation.patch.startAngle !== undefined && !Number.isFinite(operation.patch.startAngle)) errors.push("start angle must be finite")
    if (operation.patch.endAngle !== undefined && !Number.isFinite(operation.patch.endAngle)) errors.push("end angle must be finite")
    if (primitive?.type === "circle" && (operation.patch.startAngle !== undefined || operation.patch.endAngle !== undefined)) errors.push("circle does not support arc angles")
    if (primitive && !["line", "segment", "ray"].includes(primitive.type) && (operation.patch.a !== undefined || operation.patch.b !== undefined)) errors.push("only lines, segments, and rays support endpoints")
    if (primitive?.type !== "point" && (operation.patch.x !== undefined || operation.patch.y !== undefined)) errors.push("only points support coordinates")
    if (operation.patch.center && primitive && !["circle", "arc", "ellipse", "hyperbola"].includes(primitive.type)) errors.push("only circles and conics support center")
    if (operation.patch.points !== undefined && primitive?.type !== "polyline") errors.push("only polylines support vertices")
    if (operation.patch.expression !== undefined) {
      if (primitive?.type !== "function") errors.push("only functions support expressions")
      else {
        try { parseExpression(operation.patch.expression) } catch { errors.push("invalid function expression") }
      }
    }
    if (operation.patch.domain !== undefined && (!Array.isArray(operation.patch.domain) || operation.patch.domain.length !== 2 || !operation.patch.domain.every(Number.isFinite) || operation.patch.domain[0] >= operation.patch.domain[1])) errors.push("function domain is invalid")
    if (operation.patch.samples !== undefined && (!Number.isInteger(operation.patch.samples) || operation.patch.samples < 2 || operation.patch.samples > 2048)) errors.push("function sample count is invalid")
    if (operation.patch.rotation !== undefined && !Number.isFinite(operation.patch.rotation)) errors.push("rotation must be finite")
    if (operation.patch.label !== undefined && typeof operation.patch.label !== "string") errors.push("label is invalid")
    if (operation.patch.style !== undefined) {
      const style = operation.patch.style
      if (!style || typeof style !== "object" || Array.isArray(style)) errors.push("style is invalid")
      else {
        if (style.stroke !== undefined && typeof style.stroke !== "string") errors.push("stroke is invalid")
        if (style.fill !== undefined && typeof style.fill !== "string") errors.push("fill is invalid")
        if (style.dash !== undefined && typeof style.dash !== "string") errors.push("dash is invalid")
        if (style.strokeWidth !== undefined && (!Number.isFinite(style.strokeWidth) || style.strokeWidth <= 0)) errors.push("stroke width must be positive")
        if (style.opacity !== undefined && (!Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1)) errors.push("opacity must be between 0 and 1")
      }
    }
    if (operation.patch.style !== undefined && primitive?.type === undefined) errors.push("object is not editable")
    if (primitive?.type === "ray") {
      const nextA = operation.patch.a ?? primitive.a
      const nextB = operation.patch.b ?? primitive.b
      if (isCoordinate(nextA) && isCoordinate(nextB) && nextA.x === nextB.x && nextA.y === nextB.y) errors.push("ray direction must differ")
    }
    if (primitive?.type === "polyline" && operation.patch.points !== undefined) {
      if (!Array.isArray(operation.patch.points) || operation.patch.points.length < 2) errors.push("polyline needs at least two points")
      if (Array.isArray(operation.patch.points)) {
        if (operation.patch.points.some((point) => !isCoordinate(point))) errors.push("polyline points must be finite")
        for (let index = 1; index < operation.patch.points.length; index += 1) if (isCoordinate(operation.patch.points[index - 1]) && isCoordinate(operation.patch.points[index]) && operation.patch.points[index - 1].x === operation.patch.points[index].x && operation.patch.points[index - 1].y === operation.patch.points[index].y) errors.push("polyline consecutive points must differ")
      }
    }
    if (primitive?.type === "segment") {
      const nextA = operation.patch.a ?? primitive.a
      const nextB = operation.patch.b ?? primitive.b
      if (isCoordinate(nextA) && isCoordinate(nextB) && nextA.x === nextB.x && nextA.y === nextB.y) errors.push("segment endpoints must differ")
    }
  }
  if (operation.op === "addAnnotation") {
    if (!isAnnotation(operation.annotation)) errors.push("annotation is invalid")
    else {
      if (document.annotations.some((annotation) => annotation.id === operation.annotation.id)) errors.push("duplicate annotation id")
      const validation = validateDocument({ ...document, annotations: [...document.annotations, operation.annotation] })
      if (!validation.valid) errors.push(...validation.errors.filter((error) => !error.startsWith("duplicate annotation id:")))
    }
  }
  if (operation.op === "deleteAnnotation" && !document.annotations.some((annotation) => annotation.id === operation.id)) errors.push("annotation not found")
  if (operation.op === "translatePrimitive") {
    const primitive = document.primitives.find((candidate) => candidate.id === operation.id)
    if (!primitive || ["intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection", "intersectionSet", "locus"].includes(primitive.type)) errors.push("object is not editable")
    if (primitive?.locked) errors.push("object is locked")
    if (!isCoordinate(operation.delta)) errors.push("translation must be finite")
  }
  if (operation.op === "toggleLock" && !ids.has(operation.id)) errors.push("object not found")
  if (operation.op === "setParameter" && !Number.isFinite(operation.value)) errors.push("parameter value must be finite")
  if (operation.op === "setParameterExpression") {
    try { parseExpression(operation.expression) } catch { errors.push("invalid parameter expression") }
  }
  if (operation.op === "addConstraint") {
    if (!isConstraint(operation.constraint)) errors.push("constraint is invalid")
    else {
      if (document.constraints.some((constraint) => constraint.id === operation.constraint.id)) errors.push("duplicate constraint id")
      if (!["parallel", "perpendicular", "coincident"].includes(operation.constraint.type)) errors.push("constraint type is invalid")
      if (operation.constraint.targets.length !== 2 || operation.constraint.targets[0] === operation.constraint.targets[1] || operation.constraint.targets.some((target) => !ids.has(target))) errors.push("constraint has invalid targets")
      if ((operation.constraint.type === "parallel" || operation.constraint.type === "perpendicular") && operation.constraint.targets.some((target) => document.primitives.find((primitive) => primitive.id === target)?.type !== "line")) errors.push("constraint requires two lines")
    }
  }
  if (operation.op === "deleteConstraint" && !document.constraints.some((constraint) => constraint.id === operation.id)) errors.push("constraint not found")
  if ((operation.op === "deleteObject" || operation.op === "toggleVisibility") && !ids.has(operation.id)) errors.push("object not found")
  if ((operation.op === "deleteObject" || operation.op === "toggleVisibility") && document.primitives.find((primitive) => primitive.id === operation.id)?.locked) errors.push("object is locked")
  if (operation.op === "deleteObject" && isReferenced(document, operation.id)) errors.push("object is referenced by another object")
  if (operation.op === "createGroup") {
    if (document.groups.some((group) => group.id === operation.group.id)) errors.push("duplicate group id")
    if (operation.group.members.length < 2 || new Set(operation.group.members).size !== operation.group.members.length || operation.group.members.some((id) => !ids.has(id))) errors.push("group has invalid members")
    if (operation.group.members.some((id) => document.groups.some((group) => group.members.includes(id)))) errors.push("primitive already belongs to a group")
  }
  if (operation.op === "deleteGroup" && !document.groups.some((group) => group.id === operation.id)) errors.push("group not found")
  if (operation.op === "alignPrimitives" || operation.op === "setPrimitivesVisible" || operation.op === "setPrimitivesLocked") {
    if (!operation.ids.length || new Set(operation.ids).size !== operation.ids.length || operation.ids.some((id) => !ids.has(id))) errors.push("selection has invalid objects")
  }
  if (operation.op === "alignPrimitives") {
    if (!["left", "right", "top", "bottom", "horizontalCenter", "verticalCenter"].includes(operation.alignment)) errors.push("alignment is invalid")
    if (operation.ids.length < 2) errors.push("alignment requires multiple objects")
    if (operation.ids.some((id) => document.primitives.find((primitive) => primitive.id === id)?.locked)) errors.push("selection contains locked object")
    if (operation.ids.some((id) => !["point", "line", "segment", "circle", "arc"].includes(document.primitives.find((primitive) => primitive.id === id)?.type ?? ""))) errors.push("selection contains non-movable object")
    const affected = new Set(operation.ids)
    const queue = [...operation.ids]
    while (queue.length) {
      const current = queue.shift()!
      for (const constraint of document.constraints) {
        if (!constraint.targets.includes(current)) continue
        for (const target of constraint.targets) {
          if (affected.has(target)) continue
          affected.add(target)
          queue.push(target)
        }
      }
    }
    if ([...affected].some((id) => !operation.ids.includes(id) && document.primitives.find((primitive) => primitive.id === id)?.locked)) errors.push("alignment would move locked constrained object")
  }
  if (operation.op === "setPrimitivesVisible" && operation.ids.some((id) => document.primitives.find((primitive) => primitive.id === id)?.locked)) errors.push("selection contains locked object")
  return errors.length ? { valid: false, errors } : { valid: true }
}

export function commitPatch(document: GeometryDocument, operation: DomainOperation) {
  const validation = validatePatch(document, operation)
  if (!validation.valid) return { document, changed: false, error: validation.errors.join(", ") }
  return applyOperation(document, operation)
}
