import type { GeometryDocument, PrimitiveSpec, Vector3 } from "@draw/dsl"
import { commitTransaction, compileSolidPolyhedron, compileSolidPrism, compileTemplateSolid, planeThroughPoints, type DomainOperation } from "@draw/scene-graph"

import { nextPrimitiveId } from "./documentIds"

export type TeachingSolidInput =
  | { kind: "box"; origin: Vector3; size: Vector3 }
  | { kind: "prism"; base: Vector3[]; vector: Vector3 }
  | { kind: "pyramid"; base: Vector3[]; apex: Vector3 }

export type TeachingSolidResult = { operations: DomainOperation[]; selectedId: string } | { error: string }

/** Build a whole solid and its stable topology without partially changing the document. */
export function buildTeachingSolid(document: GeometryDocument, input: TeachingSolidInput): TeachingSolidResult {
  if (document.workspace !== "geometry3d") return { error: "请先切换到立体几何工作区" }
  let selectedId: string
  let primitives: PrimitiveSpec[]
  if (input.kind === "box") {
    if (![...Object.values(input.origin), ...Object.values(input.size)].every(Number.isFinite) || Object.values(input.size).some((length) => length <= 0)) {
      return { error: "长方体三条边长必须是有限正数" }
    }
    selectedId = nextPrimitiveId(document, "cube")
    const isCube = input.size.x === input.size.y && input.size.y === input.size.z
    const label = `${isCube ? "正方体" : "长方体"} ${selectedId.split("-").at(-1)}`
    const primitive: Extract<PrimitiveSpec, { type: "cube" }> = { id: selectedId, type: "cube", origin: input.origin, size: input.size, label }
    const built = compileTemplateSolid(selectedId, primitive)
    if (built.diagnostics.length > 0) return { error: built.diagnostics.map((item) => item.message).join("；") }
    primitives = [primitive, ...built.primitives]
  } else if (input.kind === "prism") {
    selectedId = nextPrimitiveId(document, "solid")
    const label = `${input.base.length === 3 ? "三棱柱" : input.base.length === 4 ? "四棱柱" : `${input.base.length} 棱柱`} ${selectedId.split("-").at(-1)}`
    const built = compileSolidPrism(selectedId, input.base, input.vector, label)
    if (built.diagnostics.length > 0) return { error: built.diagnostics.map((item) => item.message).join("；") }
    primitives = built.primitives
  } else {
    selectedId = nextPrimitiveId(document, "solid")
    const plane = planeThroughPoints(input.base)
    if (!plane) return { error: "棱锥底面至少需要三个不共线的共面顶点" }
    const apexSide = plane.normal.x * (input.apex.x - input.base[0].x) + plane.normal.y * (input.apex.y - input.base[0].y) + plane.normal.z * (input.apex.z - input.base[0].z)
    const count = input.base.length
    const baseRing = Array.from({ length: count }, (_, index) => apexSide >= 0 ? count - 1 - index : index)
    const sides = Array.from({ length: count }, (_, index) => apexSide >= 0
      ? [index, (index + 1) % count, count]
      : [(index + 1) % count, index, count])
    const label = `${count === 3 ? "三棱锥" : count === 4 ? "四棱锥" : `${count} 棱锥`} ${selectedId.split("-").at(-1)}`
    const built = compileSolidPolyhedron(selectedId, { vertices: [...input.base, input.apex], faces: [baseRing, ...sides] }, label)
    if (built.diagnostics.length > 0) return { error: built.diagnostics.map((item) => item.message).join("；") }
    primitives = built.primitives
  }
  const operations: DomainOperation[] = [{ op: "addPrimitives", primitives }]
  const checked = commitTransaction({ base: document, operations })
  if (!checked.changed) return { error: checked.errors.join("；") || "无法创建实体" }
  return { operations, selectedId }
}