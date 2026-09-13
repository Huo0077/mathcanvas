import type { GeometryDocument, PrimitiveSpec, ValidationResult } from "./types"

const workspaces = new Set(["calculus", "conics", "cad", "geometry3d"])
const primitiveTypes = new Set(["point", "line", "segment", "ray", "polyline", "connection", "locus", "parabola", "ellipse", "hyperbola", "function", "circle", "arc", "intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection"])
const sampledTypes = new Set(["line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function"])

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isFiniteCoordinate(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function validatePresentation(value: RecordValue, errors: string[]): void {
  if (value.label !== undefined && typeof value.label !== "string") errors.push("primitive label is invalid")
  if (value.visible !== undefined && typeof value.visible !== "boolean") errors.push("primitive visibility is invalid")
  if (value.locked !== undefined && typeof value.locked !== "boolean") errors.push("primitive lock state is invalid")
  if (value.style !== undefined) {
    if (!isRecord(value.style)) errors.push("primitive style is invalid")
    else {
      if (value.style.stroke !== undefined && typeof value.style.stroke !== "string") errors.push("primitive stroke is invalid")
      if (value.style.fill !== undefined && typeof value.style.fill !== "string") errors.push("primitive fill is invalid")
      if (value.style.strokeWidth !== undefined && (!isFiniteNumber(value.style.strokeWidth) || value.style.strokeWidth <= 0)) errors.push("primitive stroke width is invalid")
      if (value.style.opacity !== undefined && (!isFiniteNumber(value.style.opacity) || value.style.opacity < 0 || value.style.opacity > 1)) errors.push("primitive opacity is invalid")
      if (value.style.dash !== undefined && typeof value.style.dash !== "string") errors.push("primitive dash is invalid")
    }
  }
}

function primitiveType(value: unknown): string | undefined {
  return isRecord(value) && typeof value.type === "string" ? value.type : undefined
}

function referenceType(byId: Map<string, unknown>, value: unknown): string | undefined {
  return typeof value === "string" ? primitiveType(byId.get(value)) : undefined
}

function validatePrimitive(value: unknown, byId: Map<string, unknown>): string[] {
  if (!isRecord(value) || typeof value.id !== "string") return ["every primitive needs a stable id"]
  const errors: string[] = []
  const type = primitiveType(value)
  if (!type || !primitiveTypes.has(type)) return [`invalid primitive type: ${String(value.type)}`]
  validatePresentation(value, errors)
  if (type === "point" && (!isFiniteNumber(value.x) || !isFiniteNumber(value.y))) errors.push("point coordinates must be finite")
  if (type === "point" && value.binding !== undefined) {
    if (!isRecord(value.binding) || !["free", "onPath", "derived"].includes(String(value.binding.kind))) errors.push("point binding is invalid")
    else if (value.binding.kind === "onPath" && (typeof value.binding.pathId !== "string" || !isFiniteNumber(value.binding.parameter))) errors.push("point path binding is invalid")
    else if (value.binding.kind === "derived" && (typeof value.binding.sourceId !== "string" || typeof value.binding.feature !== "string")) errors.push("point derived binding is invalid")
  }
  if (type === "line" || type === "segment" || type === "ray") {
    if (!isFiniteCoordinate(value.a) || !isFiniteCoordinate(value.b)) errors.push(`${type} endpoints must be finite`)
    else if ((type === "segment" || type === "ray") && value.a.x === value.b.x && value.a.y === value.b.y) errors.push(type === "segment" ? "segment endpoints must differ" : "ray direction must differ")
    if (value.slopeParameter !== undefined && typeof value.slopeParameter !== "string") errors.push("line slope parameter is invalid")
  }
  if (type === "polyline") {
    if (!Array.isArray(value.points) || value.points.length < 2) errors.push("polyline needs at least two points")
    if (Array.isArray(value.points)) {
      if (value.points.some((point) => !isFiniteCoordinate(point))) errors.push("polyline points must be finite")
      for (let index = 1; index < value.points.length; index += 1) {
        const previous = value.points[index - 1]
        const current = value.points[index]
        if (isFiniteCoordinate(previous) && isFiniteCoordinate(current) && previous.x === current.x && previous.y === current.y) errors.push("polyline consecutive points must differ")
      }
    }
  }
  if (type === "connection") {
    if (!["segment", "line", "ray", "polyline", "parabola"].includes(String(value.kind)) || referenceType(byId, value.startPointId) !== "point" || referenceType(byId, value.endPointId) !== "point" || value.startPointId === value.endPointId) errors.push("connection references invalid points")
  }
  if (type === "locus") {
    if (referenceType(byId, value.sourcePointId) !== "point" || typeof value.parameterId !== "string" || !Array.isArray(value.domain) || value.domain.length !== 2 || !value.domain.every(isFiniteNumber) || value.domain[0] >= value.domain[1] || !isFiniteNumber(value.samples) || !Number.isInteger(value.samples) || value.samples < 2 || value.samples > 4096) errors.push("locus geometry is invalid")
  }
  if (type === "parabola" && (!isFiniteCoordinate(value.vertex) || !isFiniteNumber(value.focalParameter) || value.focalParameter === 0 || !["x", "y"].includes(String(value.axis)) || (value.rotation !== undefined && !isFiniteNumber(value.rotation)))) errors.push("parabola geometry is invalid")
  if (type === "ellipse" || type === "hyperbola") {
    if (!isFiniteCoordinate(value.center) || !isFiniteNumber(value.radiusX) || !isFiniteNumber(value.radiusY) || value.radiusX <= 0 || value.radiusY <= 0 || (value.rotation !== undefined && !isFiniteNumber(value.rotation))) errors.push(`${type} geometry is invalid`)
    if (type === "hyperbola" && !["x", "y"].includes(String(value.axis))) errors.push("hyperbola axis is invalid")
  }
  if (type === "function") {
    if (typeof value.expression !== "string" || !value.expression.trim()) errors.push("function expression is required")
    if (!Array.isArray(value.domain) || value.domain.length !== 2 || !value.domain.every(isFiniteNumber) || value.domain[0] >= value.domain[1]) errors.push("function domain is invalid")
    if (value.samples !== undefined && (!isFiniteNumber(value.samples) || !Number.isInteger(value.samples) || value.samples < 2 || value.samples > 2048)) errors.push("function sample count is invalid")
  }
  if (type === "circle" || type === "arc") {
    if (!isFiniteCoordinate(value.center) || !isFiniteNumber(value.radius) || value.radius <= 0) errors.push(`${type} geometry is invalid`)
    if (type === "arc" && (!isFiniteNumber(value.startAngle) || !isFiniteNumber(value.endAngle))) errors.push("arc angles must be finite")
  }
  if (type === "intersection") {
    if (typeof value.lineA !== "string" || typeof value.lineB !== "string" || !byId.has(value.lineA) || !byId.has(value.lineB)) errors.push("intersection references missing line")
    else if (referenceType(byId, value.lineA) !== "line" || referenceType(byId, value.lineB) !== "line" || value.lineA === value.lineB) errors.push("intersection references invalid lines")
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) errors.push("intersection coordinates must be finite")
  }
  if (type === "lineCircleIntersection") {
    if (referenceType(byId, value.lineId) !== "line" || referenceType(byId, value.circleId) !== "circle") errors.push("line-circle intersection references invalid objects")
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) errors.push("intersection coordinates must be finite")
  }
  if (type === "circleIntersection") {
    if (referenceType(byId, value.circleA) !== "circle" || referenceType(byId, value.circleB) !== "circle" || value.circleA === value.circleB) errors.push("circle intersection references invalid circles")
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) errors.push("intersection coordinates must be finite")
  }
  if (type === "curveIntersection") {
    if (value.objectA === value.objectB || !sampledTypes.has(referenceType(byId, value.objectA) ?? "") || !sampledTypes.has(referenceType(byId, value.objectB) ?? "")) errors.push("curve intersection references invalid objects")
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) errors.push("intersection coordinates must be finite")
  }
  return errors
}

export function validateDocument(document: unknown): ValidationResult {
  const errors: string[] = []
  if (!isRecord(document)) return { valid: false, errors: ["document must be an object"] }
  if (document.schemaVersion !== "0.1") errors.push("schemaVersion must be 0.1")
  if (!Number.isInteger(document.revision) || Number(document.revision) < 0) errors.push("revision must be a non-negative integer")
  if (typeof document.workspace !== "string" || !workspaces.has(document.workspace)) errors.push("workspace is invalid")
  if (!isRecord(document.parameters) || Array.isArray(document.parameters)) errors.push("parameters must be an object")
  if (!Array.isArray(document.primitives)) errors.push("primitives must be an array")
  if (!Array.isArray(document.groups)) errors.push("groups must be an array")
  if (!Array.isArray(document.constraints)) errors.push("constraints must be an array")
  if (!Array.isArray(document.dynamics)) errors.push("dynamics must be an array")
  if (!Array.isArray(document.annotations)) errors.push("annotations must be an array")
  if (!isRecord(document.metadata) || typeof document.metadata.id !== "string" || !document.metadata.id) errors.push("metadata.id is required")

  const primitives = Array.isArray(document.primitives) ? document.primitives : []
  const primitiveIds = new Set<string>()
  const primitiveById = new Map<string, unknown>()
  for (const primitive of primitives) {
    if (isRecord(primitive) && typeof primitive.id === "string") {
      if (primitiveIds.has(primitive.id)) errors.push(`duplicate primitive id: ${primitive.id}`)
      primitiveIds.add(primitive.id)
      primitiveById.set(primitive.id, primitive)
    }
  }
  for (const primitive of primitives) errors.push(...validatePrimitive(primitive, primitiveById))

  if (Array.isArray(document.groups)) {
    const groupIds = new Set<string>()
    const groupedMembers = new Set<string>()
    for (const group of document.groups) {
      if (!isRecord(group) || typeof group.id !== "string") {
        errors.push("every group needs a stable id")
        continue
      }
      if (groupIds.has(group.id)) errors.push(`duplicate group id: ${group.id}`)
      groupIds.add(group.id)
      if (!Array.isArray(group.members) || group.members.length < 2 || group.members.some((member) => typeof member !== "string" || !primitiveIds.has(member))) errors.push(`group has invalid members: ${group.id}`)
      if (Array.isArray(group.members) && new Set(group.members).size !== group.members.length) errors.push(`group has duplicate members: ${group.id}`)
      if (Array.isArray(group.members)) for (const member of group.members) {
        if (typeof member === "string" && groupedMembers.has(member)) errors.push(`primitive belongs to multiple groups: ${member}`)
        if (typeof member === "string") groupedMembers.add(member)
      }
    }
  }

  if (Array.isArray(document.constraints)) {
    const constraintIds = new Set<string>()
    for (const constraint of document.constraints) {
      if (!isRecord(constraint) || typeof constraint.id !== "string") {
        errors.push("every constraint needs a stable id")
        continue
      }
      if (constraintIds.has(constraint.id)) errors.push(`duplicate constraint id: ${constraint.id}`)
      constraintIds.add(constraint.id)
      if (!["parallel", "perpendicular", "coincident"].includes(String(constraint.type))) errors.push(`invalid constraint type: ${constraint.id}`)
      if (!Array.isArray(constraint.targets) || constraint.targets.length !== 2 || constraint.targets.some((target) => typeof target !== "string" || !primitiveIds.has(target)) || constraint.targets[0] === constraint.targets[1]) errors.push(`constraint has invalid targets: ${constraint.id}`)
      if ((constraint.type === "parallel" || constraint.type === "perpendicular") && Array.isArray(constraint.targets) && constraint.targets.some((target) => referenceType(primitiveById, target) !== "line")) errors.push(`constraint requires two lines: ${constraint.id}`)
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true }
}
