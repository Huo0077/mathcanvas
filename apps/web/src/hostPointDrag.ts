import type { GeometryDocument, Point3Binding } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"

/** Commit a constrained drag to its source parameters, not just the binding's cached literals.
 * Callers must apply the returned operations in one transaction (one drag = one undo step).
 */
export function hostPointDragOperations(document: GeometryDocument, id: string, parameter: { u: number; v?: number; w?: number }): DomainOperation[] {
  const primitive = document.primitives.find(candidate => candidate.id === id)
  if (primitive?.type !== "point3" || !primitive.binding) return []
  const binding = primitive.binding
  let next: Point3Binding
  let driverIds: readonly string[] = []
  let values: number[]
  const currentValue = (driverId: string | undefined, literal: number) => driverId ? document.parameters[driverId]?.value ?? NaN : literal
  if (binding.kind === "onHost" || binding.kind === "onLine") {
    values = [parameter.u]
    next = { ...binding, parameter: parameter.u }
    if (binding.kind === "onHost" && binding.parameterId) driverIds = [binding.parameterId]
  } else if (binding.kind === "onFace" || binding.kind === "onSurface") {
    const uv: [number, number] = [parameter.u, parameter.v ?? currentValue(binding.parameterIds?.[1], binding.uv[1])]
    values = uv
    next = { ...binding, uv }
    driverIds = binding.parameterIds ?? []
  } else if (binding.kind === "inSolid") {
    const uvw: [number, number, number] = [parameter.u, parameter.v ?? currentValue(binding.parameterIds?.[1], binding.uvw[1]), parameter.w ?? currentValue(binding.parameterIds?.[2], binding.uvw[2])]
    values = uvw
    next = { ...binding, uvw }
    driverIds = binding.parameterIds ?? []
  } else return []
  if (!values.every(Number.isFinite) || driverIds.some(driverId => !document.parameters[driverId])) return []
  const operations: DomainOperation[] = driverIds.map((driverId, index) => ({
    op: "setParameter", id: driverId, value: values[index]
  }))
  operations.push({ op: "updatePrimitive", id, patch: { binding3: next } })
  return operations
}
