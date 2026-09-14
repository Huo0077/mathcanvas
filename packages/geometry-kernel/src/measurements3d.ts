import type { Face3Primitive, Line3Primitive, Measurement3, Plane3Primitive, Polyhedron3Primitive, PrimitiveSpec, Point3Primitive, Vector3 } from "@draw/dsl"

import { addVector3, crossVector3, distanceVector3, dotVector3, lengthVector3, normalizeVector3, planeFromPoints, subtractVector3 } from "./geometry3d"

type LineLike3 = Extract<PrimitiveSpec, { type: "line3" | "segment3" | "ray3" | "edge3" }>
type MeasurementContext3 = readonly PrimitiveSpec[] | ReadonlyMap<string, PrimitiveSpec>

const EPSILON = 1e-10

function primitiveMap(primitives: MeasurementContext3): ReadonlyMap<string, PrimitiveSpec> {
  if (Array.isArray(primitives)) return new Map(primitives.map((primitive: PrimitiveSpec) => [primitive.id, primitive]))
  return primitives as ReadonlyMap<string, PrimitiveSpec>
}

function result(id: string, sourceIds: string[], metric: Measurement3["metric"], value: number, unit: string, explanation: string): Measurement3 {
  if (!Number.isFinite(value)) return invalidMeasurement(id, sourceIds, metric, "numeric-failure", "计算结果不是有限数值。")
  return { id, kind: "measurement3", sourceIds: [...sourceIds], metric, value, unit, precision: "numeric-approximation", status: "valid", explanation }
}

function invalidMeasurement(id: string, sourceIds: string[], metric: Measurement3["metric"], status: Measurement3["status"], explanation: string): Measurement3 {
  return { id, kind: "measurement3", sourceIds: [...sourceIds], metric, precision: "numeric-approximation", status, explanation }
}

function pointById(primitives: ReadonlyMap<string, PrimitiveSpec>, id: string): Vector3 | null {
  const primitive = primitives.get(id)
  return primitive?.type === "point3" ? primitive.position : null
}

function lineEndpoints(primitive: LineLike3, primitives: ReadonlyMap<string, PrimitiveSpec>): [Vector3, Vector3] | null {
  if (primitive.type === "line3") {
    if (primitive.definition.kind === "throughPoints") {
      const first = pointById(primitives, primitive.definition.pointIds[0])
      const second = pointById(primitives, primitive.definition.pointIds[1])
      return first && second ? [first, second] : null
    }
    const origin = pointById(primitives, primitive.definition.pointId)
    return origin ? [origin, addVector3(origin, primitive.definition.direction)] : null
  }
  const ids = primitive.type === "ray3" ? [primitive.originId, primitive.throughId] : primitive.pointIds
  const first = pointById(primitives, ids[0])
  const second = pointById(primitives, ids[1])
  return first && second ? [first, second] : null
}

function facePoints(face: Face3Primitive, primitives: ReadonlyMap<string, PrimitiveSpec>): Vector3[] | null {
  const points = face.pointIds.map((id) => pointById(primitives, id))
  return points.some((point) => !point) ? null : points as Vector3[]
}

function polygonArea(points: Vector3[]): number {
  if (points.length < 3) return 0
  const origin = points[0]
  let areaVector = { x: 0, y: 0, z: 0 }
  for (let index = 1; index < points.length - 1; index += 1) areaVector = addVector3(areaVector, crossVector3(subtractVector3(points[index], origin), subtractVector3(points[index + 1], origin)))
  return lengthVector3(areaVector) / 2
}

function faceNormal(face: Face3Primitive, primitives: ReadonlyMap<string, PrimitiveSpec>): Vector3 | null {
  const points = facePoints(face, primitives)
  if (!points || points.length < 3) return null
  const plane = planeFromPoints(points[0], points[1], points[2])
  return plane?.normal ?? null
}

function pointFromPrimitive(primitive: PrimitiveSpec | undefined, primitives: ReadonlyMap<string, PrimitiveSpec>): Vector3 | null {
  if (!primitive) return null
  if (primitive.type === "point3") return primitive.position
  if (primitive.type === "edge3" || primitive.type === "segment3") return pointById(primitives, primitive.pointIds[0])
  if (primitive.type === "ray3") return pointById(primitives, primitive.originId)
  return null
}

function lineDirection(primitive: LineLike3, primitives: ReadonlyMap<string, PrimitiveSpec>): Vector3 | null {
  const endpoints = lineEndpoints(primitive, primitives)
  if (!endpoints) return null
  const direction = subtractVector3(endpoints[1], endpoints[0])
  return lengthVector3(direction) > EPSILON ? direction : null
}

function volumeOfPolyhedron(polyhedron: Polyhedron3Primitive, primitives: ReadonlyMap<string, PrimitiveSpec>): number | null {
  const faces = polyhedron.faceIds.map((id) => primitives.get(id)).filter((primitive): primitive is Face3Primitive => primitive?.type === "face3")
  if (faces.length !== polyhedron.faceIds.length) return null
  const origin = pointById(primitives, polyhedron.vertexIds[0])
  if (!origin) return null
  let signedVolume = 0
  for (const face of faces) {
    const points = facePoints(face, primitives)
    if (!points || points.length < 3) return null
    for (let index = 1; index < points.length - 1; index += 1) signedVolume += dotVector3(subtractVector3(points[0], origin), crossVector3(subtractVector3(points[index], origin), subtractVector3(points[index + 1], origin))) / 6
  }
  return Math.abs(signedVolume)
}

export function measureLength3(id: string, sourceIds: string[], first: Vector3, second: Vector3): Measurement3 {
  const value = distanceVector3(first, second)
  return value > EPSILON ? result(id, sourceIds, "length", value, "u", `由 ${sourceIds.join("、")} 的两个端点计算空间长度。`) : invalidMeasurement(id, sourceIds, "length", "degenerate", "两个端点重合，无法形成有效长度。")
}

export function measureDistance3(id: string, sourceIds: string[], value: number, explanation: string): Measurement3 {
  return value >= 0 && Number.isFinite(value) ? result(id, sourceIds, "distance", value, "u", explanation) : invalidMeasurement(id, sourceIds, "distance", "numeric-failure", "距离计算失败。")
}

export function measureAngle3(id: string, sourceIds: string[], first: Vector3, second: Vector3, vertex?: Vector3): Measurement3 {
  const firstVector = vertex ? subtractVector3(first, vertex) : first
  const secondVector = vertex ? subtractVector3(second, vertex) : second
  const firstLength = lengthVector3(firstVector)
  const secondLength = lengthVector3(secondVector)
  if (firstLength <= EPSILON || secondLength <= EPSILON) return invalidMeasurement(id, sourceIds, "angle", "degenerate", "角的两条边中至少有一条退化。")
  const cosine = Math.min(1, Math.max(-1, dotVector3(firstVector, secondVector) / (firstLength * secondLength)))
  return result(id, sourceIds, "angle", Math.acos(cosine) * 180 / Math.PI, "°", `由 ${sourceIds.join("、")} 的方向向量计算夹角。`)
}

export function measureArea3(id: string, sourceIds: string[], points: Vector3[]): Measurement3 {
  const value = polygonArea(points)
  return value > EPSILON ? result(id, sourceIds, "area", value, "u²", `由 ${sourceIds.join("、")} 的有序面顶点三角剖分计算面积。`) : invalidMeasurement(id, sourceIds, "area", "degenerate", "面顶点共线或数据不足，无法形成面积。")
}

export function measureVolume3(id: string, sourceIds: string[], value: number): Measurement3 {
  return value > EPSILON ? result(id, sourceIds, "volume", value, "u³", `由 ${sourceIds.join("、")} 的闭合面边界计算体积。`) : invalidMeasurement(id, sourceIds, "volume", "degenerate", "实体体积为零或拓扑退化。")
}

export function calculateMeasurement3(measurement: Measurement3, context: MeasurementContext3): Measurement3 {
  const primitives = primitiveMap(context)
  const sources = measurement.sourceIds.map((id) => primitives.get(id))
  if (sources.some((source) => !source)) return invalidMeasurement(measurement.id, measurement.sourceIds, measurement.metric, "insufficient-data", "测量来源对象不存在。")
  if (measurement.metric === "length") {
    const source = sources[0]
    if (source && ["line3", "segment3", "ray3", "edge3"].includes(source.type)) {
      const endpoints = lineEndpoints(source as LineLike3, primitives)
      return endpoints ? measureLength3(measurement.id, measurement.sourceIds, endpoints[0], endpoints[1]) : invalidMeasurement(measurement.id, measurement.sourceIds, "length", "insufficient-data", "无法解析长度来源的端点。")
    }
    const first = pointById(primitives, measurement.sourceIds[0])
    const second = pointById(primitives, measurement.sourceIds[1])
    return first && second ? measureLength3(measurement.id, measurement.sourceIds, first, second) : invalidMeasurement(measurement.id, measurement.sourceIds, "length", "insufficient-data", "长度需要一个线性对象或两个空间点。")
  }
  if (measurement.metric === "distance") {
    const firstSource = sources[0]
    const secondSource = sources[1]
    const firstPoint = pointFromPrimitive(firstSource, primitives)
    if (firstPoint && secondSource?.type === "plane3") {
      const definition = secondSource.definition
      if (definition.kind === "pointNormal") {
        const origin = pointById(primitives, definition.pointId)
        if (!origin) return invalidMeasurement(measurement.id, measurement.sourceIds, "distance", "insufficient-data", "平面法向量来源点不存在，无法确定平面位置。")
        const normal = normalizeVector3(definition.normal)
        return measureDistance3(measurement.id, measurement.sourceIds, Math.abs(dotVector3(normal, subtractVector3(firstPoint, origin))), `由点 ${measurement.sourceIds[0]} 到平面 ${measurement.sourceIds[1]} 的法向距离计算。`)
      }
      const planePoints = definition.pointIds.map((id) => pointById(primitives, id))
      const plane = planePoints.every(Boolean) ? planeFromPoints(planePoints[0]!, planePoints[1]!, planePoints[2]!) : null
      return plane ? measureDistance3(measurement.id, measurement.sourceIds, Math.abs(dotVector3(plane.normal, firstPoint) + plane.constant), `由点 ${measurement.sourceIds[0]} 到平面 ${measurement.sourceIds[1]} 的法向距离计算。`) : invalidMeasurement(measurement.id, measurement.sourceIds, "distance", "insufficient-data", "无法解析平面来源。")
    }
    if (firstPoint && secondSource && ["line3", "segment3", "ray3", "edge3"].includes(secondSource.type)) {
      const endpoints = lineEndpoints(secondSource as LineLike3, primitives)
      if (!endpoints) return invalidMeasurement(measurement.id, measurement.sourceIds, "distance", "insufficient-data", "无法解析直线来源。")
      const direction = subtractVector3(endpoints[1], endpoints[0])
      const length = lengthVector3(direction)
      return length > EPSILON ? measureDistance3(measurement.id, measurement.sourceIds, lengthVector3(crossVector3(subtractVector3(firstPoint, endpoints[0]), direction)) / length, `由点 ${measurement.sourceIds[0]} 到直线 ${measurement.sourceIds[1]} 的垂距计算。`) : invalidMeasurement(measurement.id, measurement.sourceIds, "distance", "degenerate", "距离来源直线退化。")
    }
    const secondPoint = pointById(primitives, measurement.sourceIds[1])
    return firstPoint && secondPoint ? measureDistance3(measurement.id, measurement.sourceIds, distanceVector3(firstPoint, secondPoint), `由两个空间点 ${measurement.sourceIds.join("、")} 的坐标计算距离。`) : invalidMeasurement(measurement.id, measurement.sourceIds, "distance", "insufficient-data", "距离需要两个空间点，或点与直线/平面。")
  }
  if (measurement.metric === "angle") {
    const lineSources = sources.filter((source): source is LineLike3 => Boolean(source && ["line3", "segment3", "ray3", "edge3"].includes(source.type)))
    if (lineSources.length === 2) {
      const firstDirection = lineDirection(lineSources[0], primitives)
      const secondDirection = lineDirection(lineSources[1], primitives)
      return firstDirection && secondDirection ? measureAngle3(measurement.id, measurement.sourceIds, firstDirection, secondDirection) : invalidMeasurement(measurement.id, measurement.sourceIds, "angle", "degenerate", "角度来源中至少有一条线退化。")
    }
    const points = measurement.sourceIds.map((id) => pointById(primitives, id))
    return points.length === 3 && points.every(Boolean) ? measureAngle3(measurement.id, measurement.sourceIds, points[0]!, points[2]!, points[1]!) : invalidMeasurement(measurement.id, measurement.sourceIds, "angle", "insufficient-data", "角度需要两条线，或按顶点顺序提供三个空间点。")
  }
  if (measurement.metric === "area") {
    const source = sources[0]
    if (source?.type === "face3") {
      const points = facePoints(source, primitives)
      return points ? measureArea3(measurement.id, measurement.sourceIds, points) : invalidMeasurement(measurement.id, measurement.sourceIds, "area", "insufficient-data", "无法解析面的顶点。")
    }
    if (source?.type === "circle3") return result(measurement.id, measurement.sourceIds, "area", Math.PI * source.radius ** 2, "u²", `由空间圆 ${source.id} 的半径计算圆面积。`)
    const points = measurement.sourceIds.map((id) => pointById(primitives, id))
    return points.length >= 3 && points.every(Boolean) ? measureArea3(measurement.id, measurement.sourceIds, points as Vector3[]) : invalidMeasurement(measurement.id, measurement.sourceIds, "area", "insufficient-data", "面积需要一个空间面、空间圆或有序顶点。")
  }
  if (measurement.metric === "volume") {
    const source = sources[0]
    if (source?.type === "polyhedron3") {
      const volume = volumeOfPolyhedron(source, primitives)
      return volume === null ? invalidMeasurement(measurement.id, measurement.sourceIds, "volume", "insufficient-data", "无法从多面体面引用解析体积。") : measureVolume3(measurement.id, measurement.sourceIds, volume)
    }
    if (source?.type === "cube") return measureVolume3(measurement.id, measurement.sourceIds, source.size.x * source.size.y * source.size.z)
    if (source?.type === "pyramid") return measureVolume3(measurement.id, measurement.sourceIds, source.baseSize.x * source.baseSize.y * source.height / 3)
    if (source?.type === "cylinder") return measureVolume3(measurement.id, measurement.sourceIds, Math.PI * source.radius ** 2 * source.height)
    if (source?.type === "cone") return measureVolume3(measurement.id, measurement.sourceIds, Math.PI * source.radius ** 2 * source.height / 3)
    return invalidMeasurement(measurement.id, measurement.sourceIds, "volume", "insufficient-data", "体积需要一个多面体或参数化实体。")
  }
  const faces = sources.filter((source): source is Face3Primitive => source?.type === "face3")
  if (faces.length !== 2) return invalidMeasurement(measurement.id, measurement.sourceIds, "dihedral", "insufficient-data", "二面角需要两个相邻空间面。")
  const firstNormal = faceNormal(faces[0], primitives)
  const secondNormal = faceNormal(faces[1], primitives)
  return firstNormal && secondNormal ? { ...measureAngle3(measurement.id, measurement.sourceIds, firstNormal, secondNormal), metric: "dihedral", explanation: `由相邻面 ${measurement.sourceIds.join("、")} 的法向量计算夹角；当前结果为两条法向量的夹角，等于凸多面体内二面角的补角，内角/外角选择在空间关系教学切片接入。` } : invalidMeasurement(measurement.id, measurement.sourceIds, "dihedral", "degenerate", "二面角来源面退化，无法确定法向量。")
}

export function createMeasurement3(id: string, metric: Measurement3["metric"], sourceIds: string[], context: MeasurementContext3): Measurement3 {
  return calculateMeasurement3({ id, kind: "measurement3", sourceIds, metric, precision: "numeric-approximation", status: "insufficient-data", explanation: "等待来源对象计算。" }, context)
}

export const measure3d = createMeasurement3
