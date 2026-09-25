import type { Coordinate, GeometryDocument, Point3Primitive, PointBinding, PrimitiveSpec, Vector3 } from "@draw/dsl"
import { buildSolidTemplate, createBuilderContext, host3FromPrimitive, intersectCirclesDetailed, intersectLineCircleDetailed, intersectLinesDetailed, normalizeHostParameter, solidVolumeHost3, type Host3, type IntersectionResult, type TemplateSolidPrimitive } from "@draw/geometry-kernel"
import { pathConstraint, projectOntoPath } from "./analysisRecompute"
import { solidTopology3 } from "./sectionRecompute"

/**
 * **三维对象怎么解析成几何**（从 `operations.ts` 拆出，评审方案 2）。
 *
 * 这一族回答"文档里写的东西算出来是什么"：绑定点的坐标怎么解（`resolveBoundPoint` /
 * `resolveBoundPoint3` / `dragBoundPoint`）、宿主参数怎么取（`bindingParameterValue` / `bindingTupleValue`）、
 * 截面怎么物化（`sectionMaterialization`）、模板拓扑怎么同步（`syncTemplateTopology`）、
 * 以及交面 / 交体怎么由来源推出来（`resolveIntersection`）。
 *
 * 两条口径随代码搬走：
 * 1. **绑定点是"参数 → 坐标"的函数**：宿主参数是唯一真源，拖动改的是参数，坐标每次现算；
 * 2. **拓扑同步与实体物化是一对**：只做一半会让画布显示的对象与文档声称的对象不是同一批。
 */

export function dragBoundPoint(point: Extract<PrimitiveSpec, { type: "point" }>, delta: Coordinate, primitiveMap: Map<string, PrimitiveSpec>, parameters: GeometryDocument["parameters"]): { point: Extract<PrimitiveSpec, { type: "point" }>; parameterValue: { id: string; value: number } | null } | null {
  if (point.binding?.kind !== "onPath") return null
  const path = primitiveMap.get(point.binding.pathId)
  if (!path) return null
  const projected = projectOntoPath(path, { x: point.x + delta.x, y: point.y + delta.y }, parameters, point.binding.branch)
  if (projected === null) return null
  const binding: PointBinding = { ...point.binding, parameter: projected }
  return {
    point: { ...point, binding },
    parameterValue: binding.parameterId ? { id: binding.parameterId, value: projected } : null
  }
}

export function resolveBoundPoint(binding: PointBinding, primitives: Map<string, PrimitiveSpec>, parameters: GeometryDocument["parameters"]): Coordinate | null {
  if (binding.kind !== "onPath") return null
  const path = primitives.get(binding.pathId)
  if (!path) return null
  const parameter = binding.parameterId ? parameters[binding.parameterId]?.value : binding.parameter
  if (parameter === undefined || !Number.isFinite(parameter)) return null
  return pathConstraint(path, parameters)?.evaluate(parameter, binding.branch ?? 0) ?? null
}

export function point3Position(primitive: PrimitiveSpec | undefined, points: Map<string, Point3Primitive>): Vector3 | null {
  if (!primitive) return null
  if (primitive.type === "point3") return primitive.position
  if (primitive.type === "segment3" || primitive.type === "edge3") {
    const first = points.get(primitive.pointIds[0])
    return first?.position ?? null
  }
  if (primitive.type === "ray3") return points.get(primitive.originId)?.position ?? null
  return null
}

export function resolveLine3Endpoints(primitive: Extract<PrimitiveSpec, { type: "line3" }>, points: Map<string, Point3Primitive>): { first: Vector3; second: Vector3 } | null {
  if (primitive.definition.kind === "throughPoints") {
    const first = points.get(primitive.definition.pointIds[0])
    const second = points.get(primitive.definition.pointIds[1])
    return first && second ? { first: first.position, second: second.position } : null
  }
  const point = points.get(primitive.definition.pointId)
  if (!point) return null
  return { first: point.position, second: { x: point.position.x + primitive.definition.direction.x, y: point.position.y + primitive.definition.direction.y, z: point.position.z + primitive.definition.direction.z } }
}

/**
 * 宿主参数的域语义只有一份：内核的 `normalizeHostParameter`（闭合宿主折回、有界宿主夹回、
 * 无界宿主原样）。这里曾经有一份"一律夹取"的本地实现，对空间圆轨道会把 `π/2 + 4π` 夹到 `2π`，
 * 于是同一个文档在文档层与 Reactive DAG 上给出**两个不同的点**（fix round 1 / I5）。
 */

/** 实体内约束的宿主：由实体的**物化拓扑**（顶点 + 面环）构造，解析不出来时返回 null。 */
export function solidVolumeHostFor(primitives: Map<string, PrimitiveSpec>, solidId: string): Host3 | null {
  const source = primitives.get(solidId)
  if (!source) return null
  const topology = solidTopology3(source, primitives)
  return topology ? solidVolumeHost3(topology.vertices, topology.faces) : null
}

/**
 * 3D 宿主绑定的参数真值（设计规格 §4.1）：给了 `parameterId(s)` 就**只看文档参数**，
 * 绑定里那个字面量退化成缓存。参数不存在或非有限时返回 `null`（调用方保留上一次的坐标，
 * 不静默把点挪到别处），而不是拿缓存顶替。
 */
export function bindingParameterValue(parameters: GeometryDocument["parameters"], literal: number, parameterId?: string): number | null {
  if (parameterId === undefined) return Number.isFinite(literal) ? literal : null
  const resolved = parameters[parameterId]?.value
  return resolved !== undefined && Number.isFinite(resolved) ? resolved : null
}

export function bindingTupleValue(parameters: GeometryDocument["parameters"], literal: readonly number[], parameterIds?: readonly string[]): number[] | null {
  if (parameterIds !== undefined) {
    if (parameterIds.length !== literal.length) return null
    const resolved = parameterIds.map((id) => parameters[id]?.value)
    return resolved.every((value) => value !== undefined && Number.isFinite(value)) ? resolved as number[] : null
  }
  return literal.every(Number.isFinite) ? [...literal] : null
}

export function resolveBoundPoint3(primitive: Extract<PrimitiveSpec, { type: "point3" }>, primitives: Map<string, PrimitiveSpec>, parameters: GeometryDocument["parameters"]): Vector3 | null {
  const binding = primitive.binding
  if (!binding || binding.kind === "free") return null
  const points = new Map([...primitives.values()].filter((candidate): candidate is Point3Primitive => candidate.type === "point3").map((point) => [point.id, point]))
  if (binding.kind === "onLine") {
    const line = primitives.get(binding.lineId)
    if (!line || line.type !== "line3") return null
    const endpoints = resolveLine3Endpoints(line, points)
    if (!endpoints || !Number.isFinite(binding.parameter)) return null
    return { x: endpoints.first.x + (endpoints.second.x - endpoints.first.x) * binding.parameter, y: endpoints.first.y + (endpoints.second.y - endpoints.first.y) * binding.parameter, z: endpoints.first.z + (endpoints.second.z - endpoints.first.z) * binding.parameter }
  }
  if (binding.kind === "onPlane") {
    const plane = primitives.get(binding.planeId)
    if (!plane || plane.type !== "plane3") return null
    return { x: binding.frame.origin.x + binding.coordinates[0] * binding.frame.u.x + binding.coordinates[1] * binding.frame.v.x, y: binding.frame.origin.y + binding.coordinates[0] * binding.frame.u.y + binding.coordinates[1] * binding.frame.v.y, z: binding.frame.origin.z + binding.coordinates[0] * binding.frame.u.z + binding.coordinates[1] * binding.frame.v.z }
  }
  /**
   * 宿主绑定：坐标完全由参数算出（参数是唯一真值）。
   * 宿主解析不了时返回 null，调用方会保留点上一次的坐标——不静默把点挪到别处。
   */
  if (binding.kind === "onHost" || binding.kind === "onFace" || binding.kind === "onSurface" || binding.kind === "inSolid") {
    const solidHost = binding.kind === "inSolid" ? solidVolumeHostFor(primitives, binding.solidId) : null
    if (binding.kind === "inSolid") {
      // 实体内：参数是三个 [0,1] 比例；越界会被夹回实体表面（`solidVolumeHost3` 负责）。
      const uvw = bindingTupleValue(parameters, binding.uvw, binding.parameterIds)
      if (!solidHost || !uvw) return null
      return solidHost.evaluate({ u: uvw[0], v: uvw[1], w: uvw[2] })
    }
    const sourceId = binding.kind === "onHost" ? binding.hostId : binding.kind === "onFace" ? binding.faceId : binding.solidId
    const source = primitives.get(sourceId)
    const host = source ? host3FromPrimitive(source, primitives) : null
    if (!host) return null
    if (binding.kind === "onHost") {
      const parameter = bindingParameterValue(parameters, binding.parameter, binding.parameterId)
      if (parameter === null) return null
      return host.evaluate({ u: normalizeHostParameter(host, "u", parameter) })
    }
    const uv = bindingTupleValue(parameters, binding.uv, binding.parameterIds)
    if (!uv) return null
    return host.evaluate({ u: normalizeHostParameter(host, "u", uv[0]), v: normalizeHostParameter(host, "v", uv[1]) })
  }
  if (binding.feature === "midpoint" && binding.sourceIds.length >= 2) {
    const first = point3Position(primitives.get(binding.sourceIds[0]), points)
    const second = point3Position(primitives.get(binding.sourceIds[1]), points)
    if (first && second) return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 }
  }
  return null
}

/**
 * 把一个截面物化成**独立图元**：每一环生成 point3 + edge3 + face3。
 *
 * 刻意不写 `sourceId`——物化出来的几何与来源解耦：删掉宿主不影响它们，
 * 它们也能被移动、求交、测量（这正是"可以获取截面图元"的含义）。
 * 返回的数组顺序是"点 → 棱 → 面"，调用方用一条 `addPrimitives` 提交即可。
 */
export function sectionMaterialization(document: GeometryDocument, sectionId: string): PrimitiveSpec[] | null {
  const section = document.primitives.find((primitive) => primitive.id === sectionId)
  if (section?.type !== "section") return null
  const loops = (section.loops && section.loops.length > 0 ? section.loops : [section.points]).filter((loop) => loop.length >= 3)
  if (loops.length === 0) return null
  const label = section.label ?? section.id
  const stroke = section.style?.stroke ?? "#f97316"
  const primitives: PrimitiveSpec[] = []
  loops.forEach((loop, loopIndex) => {
    const suffix = loops.length > 1 ? ` ${loopIndex + 1}` : ""
    const pointIds = loop.map((point, pointIndex) => {
      const id = `${section.id}-p${loopIndex + 1}-${pointIndex + 1}`
      primitives.push({ id, type: "point3", position: { ...point }, binding: { kind: "free" }, label: `${label} 顶点${suffix}-${pointIndex + 1}`, style: { stroke, fill: stroke } })
      return id
    })
    const edgeIds = loop.map((_, pointIndex) => {
      const id = `${section.id}-e${loopIndex + 1}-${pointIndex + 1}`
      primitives.push({ id, type: "edge3", pointIds: [pointIds[pointIndex], pointIds[(pointIndex + 1) % loop.length]], label: `${label} 棱${suffix}-${pointIndex + 1}`, style: { stroke } })
      return id
    })
    primitives.push({ id: `${section.id}-f${loopIndex + 1}`, type: "face3", pointIds, edgeIds, label: `${label} 面${suffix}`, style: { stroke, fill: `${stroke}33` } })
  })
  return primitives
}

/**
 * 把模板实体生成的顶点位置同步回模板参数。
 *
 * `dirty` 给定时**只处理参数真的进了脏集的模板**：旧实现每次重算都无条件重跑
 * `buildSolidTemplate` 并覆盖全部生成顶点——既让每次操作都付 O(模板面数) 的开销，
 * 也会把任何绕过 `updatePrimitive` 的顶点位移静默抹掉。
 */
export function syncTemplateTopology(primitives: PrimitiveSpec[], dirty?: Set<string>): void {
  const primitiveMap = new Map(primitives.map((primitive) => [primitive.id, primitive]))
  for (const polyhedron of primitives) {
    if (polyhedron.type !== "polyhedron3" || polyhedron.construction?.kind !== "template") continue
    if (dirty && !polyhedron.construction.sourceIds.some((id) => dirty.has(id))) continue
    const source = polyhedron.construction.sourceIds.map((id) => primitiveMap.get(id)).find((candidate): candidate is TemplateSolidPrimitive => Boolean(candidate && ["cube", "pyramid", "cylinder", "cone"].includes(candidate.type)))
    if (!source || source.type !== polyhedron.construction.templateId) continue
    const result = buildSolidTemplate(source, createBuilderContext(source.id))
    const generatedPoints = new Map(result.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "point3" }> => primitive.type === "point3").map((primitive) => [primitive.id, primitive.position]))
    for (let index = 0; index < primitives.length; index += 1) {
      const primitive = primitives[index]
      if (primitive.type !== "point3") continue
      const position = generatedPoints.get(primitive.id)
      if (position) primitives[index] = { ...primitive, position: { ...position } }
    }
  }
}

export function resolveIntersection(primitive: Extract<PrimitiveSpec, { type: "intersection" | "lineCircleIntersection" | "circleIntersection" }>, lines: Map<string, Extract<PrimitiveSpec, { type: "line" }>>, circleOf: (id: string) => Extract<PrimitiveSpec, { type: "circle" }> | undefined): IntersectionResult {
  if (primitive.type === "intersection") {
    const first = lines.get(primitive.lineA)
    const second = lines.get(primitive.lineB)
    return first && second ? intersectLinesDetailed(first, second) : { kind: "degenerate", reason: "intersection references missing line" }
  }
  if (primitive.type === "lineCircleIntersection") {
    const line = lines.get(primitive.lineId)
    const circle = circleOf(primitive.circleId)
    return line && circle ? intersectLineCircleDetailed(line, circle) : { kind: "degenerate", reason: "line-circle intersection references missing object" }
  }
  const first = circleOf(primitive.circleA)
  const second = circleOf(primitive.circleB)
  return first && second ? intersectCirclesDetailed(first, second) : { kind: "degenerate", reason: "circle intersection references missing circle" }
}
