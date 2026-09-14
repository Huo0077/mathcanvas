import { validateDocument, type AnnotationSpec, type ConstraintSpec, type GeometryDocument, type Measurement3, type PrimitiveSpec } from "@draw/dsl"
import { parseExpression } from "@draw/geometry-kernel"

import { applyOperation, deletionTargets, type DomainOperation } from "./operations"

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

function isMeasurement(value: unknown): value is Measurement3 {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<Measurement3>
  return typeof candidate.id === "string" && candidate.id.length > 0
    && candidate.kind === "measurement3"
    && Array.isArray(candidate.sourceIds)
    && ["length", "distance", "angle", "area", "volume", "dihedral"].includes(String(candidate.metric))
    && ["exact-input", "numeric-approximation"].includes(String(candidate.precision))
    && ["valid", "degenerate", "insufficient-data", "numeric-failure"].includes(String(candidate.status))
    && typeof candidate.explanation === "string"
}

function isCoordinate(value: unknown): value is { x: number; y: number } {
  return Boolean(value && typeof value === "object" && Number.isFinite((value as { x?: unknown }).x) && Number.isFinite((value as { y?: unknown }).y))
}

function isVector3(value: unknown): value is { x: number; y: number; z: number } {
  return Boolean(isCoordinate(value) && Number.isFinite((value as { z?: unknown }).z))
}

function isReferenced(document: GeometryDocument, id: string, ignoredReferrers: Set<string> = new Set()): boolean {
  return document.groups.some((group) => group.members.includes(id)) || document.constraints.some((constraint) => constraint.targets.includes(id)) || document.measurements.some((measurement) => measurement.sourceIds.includes(id)) || document.annotations.some((annotation) => annotation.target === id || (annotation.anchor?.kind === "primitive" && annotation.anchor.primitiveId === id)) || document.primitives.some((primitive) => !ignoredReferrers.has(primitive.id) && (
    (primitive.type === "intersection" && (primitive.lineA === id || primitive.lineB === id)) ||
    (primitive.type === "lineCircleIntersection" && (primitive.lineId === id || primitive.circleId === id)) ||
    (primitive.type === "circleIntersection" && (primitive.circleA === id || primitive.circleB === id)) ||
    (primitive.type === "curveIntersection" && (primitive.objectA === id || primitive.objectB === id))
     || (primitive.type === "intersectionSet" && (primitive.objectA === id || primitive.objectB === id))
     || (primitive.type === "point3" && primitive.binding && ((primitive.binding.kind === "onLine" && primitive.binding.lineId === id) || (primitive.binding.kind === "onPlane" && primitive.binding.planeId === id) || (primitive.binding.kind === "derived" && primitive.binding.sourceIds.includes(id))))
     || (primitive.type === "line3" && (primitive.definition.kind === "throughPoints" ? primitive.definition.pointIds.includes(id) : primitive.definition.pointId === id))
     || (primitive.type === "segment3" && primitive.pointIds.includes(id))
     || (primitive.type === "ray3" && (primitive.originId === id || primitive.throughId === id))
     || (primitive.type === "plane3" && (primitive.definition.kind === "throughPoints" ? primitive.definition.pointIds.includes(id) : primitive.definition.pointId === id))
     || (primitive.type === "circle3" && primitive.centerId === id)
     || (primitive.type === "edge3" && (primitive.pointIds.includes(id) || primitive.faceIds?.includes(id)))
     || (primitive.type === "face3" && (primitive.pointIds.includes(id) || primitive.edgeIds?.includes(id) || primitive.planeId === id))
     || (primitive.type === "polyhedron3" && (primitive.vertexIds.includes(id) || primitive.edgeIds.includes(id) || primitive.faceIds.includes(id) || primitive.construction?.sourceIds.includes(id)))
     || (primitive.type === "derivative" && primitive.sourceId === id)
    || ((primitive.type === "tangent" || primitive.type === "normal" || primitive.type === "secant") && primitive.sourceId === id)
    || ((primitive.type === "integral" || primitive.type === "analysisSet") && primitive.sourceId === id)
    || (primitive.type === "section" && primitive.sourceId === id)
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
  if (operation.op === "addPrimitives") {
    const batchIds = new Set<string>()
    if (!Array.isArray(operation.primitives) || operation.primitives.length === 0) errors.push("primitives are invalid")
    else {
      for (const primitive of operation.primitives) {
        if (!isPrimitive(primitive)) errors.push("primitive is invalid")
        else if (ids.has(primitive.id) || batchIds.has(primitive.id)) errors.push("duplicate object id")
        else batchIds.add(primitive.id)
      }
      if (errors.length === 0) {
        const validation = validateDocument({ ...document, primitives: [...document.primitives, ...operation.primitives] })
        if (!validation.valid) errors.push(...validation.errors.filter((error) => !error.startsWith("duplicate primitive id:")))
      }
    }
  }
  if (operation.op === "updatePrimitive") {
    const primitive = document.primitives.find((candidate) => candidate.id === operation.id)
    const editable = ["point", "point3", "line", "segment", "ray", "polyline", "parabola", "ellipse", "hyperbola", "function", "circle", "arc", "cube", "pyramid", "cylinder", "cone"]
    // Style and label are presentation, so any unlocked object may change them even when its geometry is derived.
    const geometryPatchKeys = Object.keys(operation.patch).filter((key) => key !== "style" && key !== "label")
    if (!primitive || (geometryPatchKeys.length > 0 && !editable.includes(primitive.type))) errors.push("object is not editable")
    if (primitive?.locked) errors.push("object is locked")
    if (operation.patch.a && !isCoordinate(operation.patch.a)) errors.push("line start must be finite")
    if (operation.patch.b && !isCoordinate(operation.patch.b)) errors.push("line end must be finite")
    if (operation.patch.x !== undefined && !Number.isFinite(operation.patch.x)) errors.push("point X must be finite")
    if (operation.patch.y !== undefined && !Number.isFinite(operation.patch.y)) errors.push("point Y must be finite")
    if (operation.patch.position3 !== undefined && (!isVector3(operation.patch.position3) || primitive?.type !== "point3")) errors.push(primitive?.type === "point3" ? "point position must be finite" : "only point3 supports position")
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
    if (operation.patch.origin3 !== undefined && (!isVector3(operation.patch.origin3) || primitive?.type !== "cube")) errors.push(primitive?.type === "cube" ? "origin must be finite" : "only cubes support origin")
    if (operation.patch.size3 !== undefined && (!isVector3(operation.patch.size3) || primitive?.type !== "cube" || operation.patch.size3.x <= 0 || operation.patch.size3.y <= 0 || operation.patch.size3.z <= 0)) errors.push(primitive?.type === "cube" ? "cube size must be positive" : "only cubes support size")
    if (operation.patch.baseCenter3 !== undefined && (!isVector3(operation.patch.baseCenter3) || primitive?.type !== "pyramid")) errors.push(primitive?.type === "pyramid" ? "base center must be finite" : "only pyramids support base center")
    if (operation.patch.baseSize3 !== undefined && (!operation.patch.baseSize3 || !Number.isFinite(operation.patch.baseSize3.x) || !Number.isFinite(operation.patch.baseSize3.y) || primitive?.type !== "pyramid" || operation.patch.baseSize3.x <= 0 || operation.patch.baseSize3.y <= 0)) errors.push(primitive?.type === "pyramid" ? "pyramid base size must be positive" : "only pyramids support base size")
    if (operation.patch.center3 !== undefined && (!isVector3(operation.patch.center3) || !["cylinder", "cone"].includes(primitive?.type ?? ""))) errors.push(["cylinder", "cone"].includes(primitive?.type ?? "") ? "center must be finite" : "only cylinders and cones support center")
    if (operation.patch.height !== undefined && (!Number.isFinite(operation.patch.height) || operation.patch.height <= 0 || !["pyramid", "cylinder", "cone"].includes(primitive?.type ?? ""))) errors.push(["pyramid", "cylinder", "cone"].includes(primitive?.type ?? "") ? "height must be positive" : "only solids with height support height")
    if (operation.patch.radius3 !== undefined && (!Number.isFinite(operation.patch.radius3) || operation.patch.radius3 <= 0 || !["cylinder", "cone"].includes(primitive?.type ?? ""))) errors.push(["cylinder", "cone"].includes(primitive?.type ?? "") ? "3D radius must be positive" : "only cylinders and cones support radius")
    if (operation.patch.segments !== undefined && (!Number.isInteger(operation.patch.segments) || operation.patch.segments < 3 || operation.patch.segments > 256 || !["cylinder", "cone"].includes(primitive?.type ?? ""))) errors.push(["cylinder", "cone"].includes(primitive?.type ?? "") ? "segment count is invalid" : "only cylinders and cones support segments")
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
      const validTypes = ["parallel", "perpendicular", "coincident", "pointOnLine", "pointOnPlane", "collinear", "coplanar", "fixedDistance"]
      if (!validTypes.includes(operation.constraint.type)) errors.push("constraint type is invalid")
      const targetCount = operation.constraint.type === "collinear" ? 3 : operation.constraint.type === "coplanar" ? 4 : 2
      if (operation.constraint.targets.length !== targetCount || new Set(operation.constraint.targets).size !== operation.constraint.targets.length || operation.constraint.targets.some((target) => !ids.has(target))) errors.push("constraint has invalid targets")
      const targetTypes = operation.constraint.targets.map((target) => document.primitives.find((primitive) => primitive.id === target)?.type)
      const lineTypes = new Set(["line", "line3", "segment3", "ray3", "edge3"])
      if ((operation.constraint.type === "parallel" || operation.constraint.type === "perpendicular" || operation.constraint.type === "coincident") && targetTypes.some((type) => !lineTypes.has(type ?? ""))) errors.push("constraint requires two lines")
      if (operation.constraint.type === "pointOnLine" && (targetTypes[0] !== "point3" || !lineTypes.has(targetTypes[1] ?? ""))) errors.push("pointOnLine requires a point and line")
      if (operation.constraint.type === "pointOnPlane" && (targetTypes[0] !== "point3" || targetTypes[1] !== "plane3")) errors.push("pointOnPlane requires a point and plane")
      if ((operation.constraint.type === "collinear" || operation.constraint.type === "coplanar") && targetTypes.some((type) => type !== "point3")) errors.push("constraint requires spatial points")
      if (operation.constraint.type === "fixedDistance" && (targetTypes.some((type) => type !== "point3") || operation.constraint.value === undefined || !Number.isFinite(operation.constraint.value) || operation.constraint.value < 0)) errors.push("fixedDistance requires two points and a non-negative value")
    }
  }
  if (operation.op === "addMeasurement") {
    if (!isMeasurement(operation.measurement)) errors.push("measurement is invalid")
    else {
      if (document.measurements.some((measurement) => measurement.id === operation.measurement.id)) errors.push("duplicate measurement id")
      if (!operation.measurement.sourceIds.length || operation.measurement.sourceIds.some((id) => !ids.has(id))) errors.push("measurement has invalid sources")
    }
  }
  if (operation.op === "deleteMeasurement" && !document.measurements.some((measurement) => measurement.id === operation.id)) errors.push("measurement not found")
  if (operation.op === "deleteConstraint" && !document.constraints.some((constraint) => constraint.id === operation.id)) errors.push("constraint not found")
  if ((operation.op === "deleteObject" || operation.op === "toggleVisibility") && !ids.has(operation.id)) errors.push("object not found")
  if ((operation.op === "deleteObject" || operation.op === "toggleVisibility") && document.primitives.find((primitive) => primitive.id === operation.id)?.locked) errors.push("object is locked")
  if (operation.op === "deleteObject") {
    // References that come from the object's own generated topology do not protect it.
    const targets = deletionTargets(document, operation.id)
    if ([...targets].some((target) => isReferenced(document, target, targets))) errors.push("object is referenced by another object")
  }
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
