import type { GeometryDocument, PrimitiveSpec, ValidationResult } from "./types"

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
      if (!["point", "line", "segment", "circle", "arc", "intersection", "lineCircleIntersection", "circleIntersection"].includes(primitive.type)) {
        errors.push(`invalid primitive type: ${primitive.type}`)
      }
    }
  }
  if (Array.isArray(value.primitives)) {
    const primitives = value.primitives as PrimitiveSpec[]
    const byId = new Map(primitives.map((primitive) => [primitive.id, primitive]))
    for (const primitive of primitives) {
      if (primitive.type === "segment") {
        if (!Number.isFinite(primitive.a.x) || !Number.isFinite(primitive.a.y) || !Number.isFinite(primitive.b.x) || !Number.isFinite(primitive.b.y)) errors.push("segment endpoints must be finite")
        if (primitive.a.x === primitive.b.x && primitive.a.y === primitive.b.y) errors.push("segment endpoints must differ")
      }
      if (primitive.type === "circle" || primitive.type === "arc") {
        if (!Number.isFinite(primitive.center.x) || !Number.isFinite(primitive.center.y) || !Number.isFinite(primitive.radius) || primitive.radius <= 0) {
          errors.push(`${primitive.type} geometry is invalid`)
        }
      }
      if (primitive.type === "intersection" && (!byId.get(primitive.lineA) || !byId.get(primitive.lineB))) errors.push("intersection references missing line")
      if (primitive.type === "lineCircleIntersection" && (byId.get(primitive.lineId)?.type !== "line" || byId.get(primitive.circleId)?.type !== "circle")) errors.push("line-circle intersection references invalid objects")
      if (primitive.type === "circleIntersection" && (byId.get(primitive.circleA)?.type !== "circle" || byId.get(primitive.circleB)?.type !== "circle")) errors.push("circle intersection references invalid circles")
    }
    if (Array.isArray(value.constraints)) {
      const constraintIds = new Set<string>()
      for (const constraint of value.constraints) {
        if (!constraint || typeof constraint !== "object" || typeof constraint.id !== "string") {
          errors.push("every constraint needs a stable id")
          continue
        }
        if (constraintIds.has(constraint.id)) errors.push(`duplicate constraint id: ${constraint.id}`)
        constraintIds.add(constraint.id)
        if (!["parallel", "perpendicular", "coincident"].includes(constraint.type)) errors.push(`invalid constraint type: ${constraint.id}`)
        if (!Array.isArray(constraint.targets) || constraint.targets.length !== 2 || constraint.targets.some((target) => !byId.has(target))) errors.push(`constraint has invalid targets: ${constraint.id}`)
        if (Array.isArray(constraint.targets) && constraint.targets.length === 2 && constraint.targets[0] === constraint.targets[1]) errors.push(`constraint targets must differ: ${constraint.id}`)
        if ((constraint.type === "parallel" || constraint.type === "perpendicular") && constraint.targets.some((target) => byId.get(target)?.type !== "line")) errors.push(`constraint requires two lines: ${constraint.id}`)
      }
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true }
}
