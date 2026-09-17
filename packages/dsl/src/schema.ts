import type { GeometryDocument, PrimitiveSpec, ValidationResult } from "./types"

const workspaces = new Set(["calculus", "conics", "cad", "geometry3d"])
const primitiveTypes = new Set(["point", "point3", "line", "line3", "segment", "segment3", "ray", "ray3", "polyline", "connection", "locus", "parabola", "ellipse", "hyperbola", "function", "derivative", "tangent", "normal", "secant", "integral", "analysisSet", "cube", "pyramid", "cylinder", "cone", "plane3", "circle3", "edge3", "face3", "polyhedron3", "section", "intersectionLine", "intersectionSolid", "intersectionFace", "intersectionPoint3", "circle", "arc", "intersection", "lineCircleIntersection", "circleIntersection", "curveIntersection", "intersectionSet"])
const sampledTypes = new Set(["line", "segment", "ray", "polyline", "circle", "arc", "parabola", "ellipse", "hyperbola", "function"])
const solidTypes = new Set(["cube", "pyramid", "cylinder", "cone", "polyhedron3"])
const annotationFeatures = new Set(["point", "center", "focus", "vertex", "intersection", "start", "end"])
const conic3Kinds = new Set(["circle", "ellipse", "parabola", "hyperbola", "line", "lines", "point", "empty", "insufficient-data"])

/** 帧内的一条直线（过点 + 方向）。 */
function isConic3Line(value: unknown): boolean {
  if (!isRecord(value)) return false
  const through = value.through
  const direction = value.direction
  return isRecord(through) && Number.isFinite(through.s) && Number.isFinite(through.t)
    && isRecord(direction) && Number.isFinite(direction.s) && Number.isFinite(direction.t)
}

/** 解析圆锥曲线：`coefficients` 是精确真源（六个有限数必须齐），规范数据是可选的派生值。 */
function isConic3(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!conic3Kinds.has(String(value.kind)) || typeof value.closed !== "boolean") return false
  const frame = value.frame
  if (!isRecord(frame) || !isFiniteCoordinate3(frame.origin) || !isFiniteCoordinate3(frame.u) || !isFiniteCoordinate3(frame.v) || !isFiniteCoordinate3(frame.normal)) return false
  if (!Array.isArray(value.coefficients) || value.coefficients.length !== 6 || value.coefficients.some((entry) => !Number.isFinite(entry))) return false
  if (value.center !== undefined && !isFiniteCoordinate3(value.center)) return false
  if (value.point !== undefined && !isFiniteCoordinate3(value.point)) return false
  if (value.vertex !== undefined && !isFiniteCoordinate3(value.vertex)) return false
  if (value.foci !== undefined && (!Array.isArray(value.foci) || value.foci.some((focus) => !isFiniteCoordinate3(focus)))) return false
  if (value.axes !== undefined && (!isRecord(value.axes) || !isFiniteCoordinate3(value.axes.major) || !isFiniteCoordinate3(value.axes.minor))) return false
  if (value.lines !== undefined && (!Array.isArray(value.lines) || value.lines.some((line) => !isConic3Line(line)))) return false
  return true
}

/**
 * 片段环：`[[{kind:"conic",…} | {kind:"segment",…}, …], …]`。
 *
 * 参数区间**不要求升序**：把片段串成环时会翻转片段方向（反向遍历是合法表示）。
 */
function isCurvePieceLoops(value: unknown): boolean {
  if (!Array.isArray(value)) return false
  return value.every((loop) => Array.isArray(loop) && loop.every((piece) => {
    if (!isRecord(piece)) return false
    if (piece.kind === "segment") return isFiniteCoordinate3(piece.a) && isFiniteCoordinate3(piece.b)
    if (piece.kind !== "conic") return false
    if (!isConic3(piece.conic)) return false
    if (!Array.isArray(piece.parameterRange) || piece.parameterRange.length !== 2 || piece.parameterRange.some((entry) => !Number.isFinite(entry))) return false
    if (piece.branch !== undefined && (!Number.isInteger(piece.branch) || (piece.branch as number) < 0)) return false
    return true
  }))
}

type RecordValue = Record<string, unknown>

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function isFiniteCoordinate(value: unknown): value is { x: number; y: number } {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
}

function isFiniteCoordinate3(value: unknown): value is { x: number; y: number; z: number } {
  return isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isFiniteVector3(value: unknown): value is { x: number; y: number; z: number } {
  return isFiniteCoordinate3(value)
}

function isNonZeroVector3(value: unknown): boolean {
  return isFiniteVector3(value) && (value.x !== 0 || value.y !== 0 || value.z !== 0)
}

function isDistinctStringList(value: unknown, minimumLength: number): value is string[] {
  return Array.isArray(value) && value.length >= minimumLength && value.every((item) => typeof item === "string") && new Set(value).size === value.length
}

function referencesTypes(byId: Map<string, unknown>, value: unknown, allowedTypes: Set<string>): boolean {
  return Array.isArray(value) && value.every((id) => typeof id === "string" && allowedTypes.has(referenceType(byId, id) ?? ""))
}

function point3Position(byId: Map<string, unknown>, id: unknown): { x: number; y: number; z: number } | undefined {
  if (typeof id !== "string") return undefined
  const primitive = byId.get(id)
  if (!isRecord(primitive) || primitive.type !== "point3" || !isFiniteVector3(primitive.position)) return undefined
  return primitive.position
}

function areCollinearPoint3s(byId: Map<string, unknown>, pointIds: unknown): boolean {
  if (!Array.isArray(pointIds) || pointIds.length !== 3) return false
  const positions = pointIds.map((id) => point3Position(byId, id))
  if (positions.some((position) => !position)) return false
  const [first, second, third] = positions as [{ x: number; y: number; z: number }, { x: number; y: number; z: number }, { x: number; y: number; z: number }]
  const ab = { x: second.x - first.x, y: second.y - first.y, z: second.z - first.z }
  const ac = { x: third.x - first.x, y: third.y - first.y, z: third.z - first.z }
  return ab.y * ac.z - ab.z * ac.y === 0 && ab.z * ac.x - ab.x * ac.z === 0 && ab.x * ac.y - ab.y * ac.x === 0
}

function areCollinearPoint3List(byId: Map<string, unknown>, pointIds: unknown): boolean {
  if (!Array.isArray(pointIds) || pointIds.length < 3) return false
  const positions = pointIds.map((id) => point3Position(byId, id))
  if (positions.some((position) => !position)) return false
  const definedPositions = positions as Array<{ x: number; y: number; z: number }>
  const first = definedPositions[0]
  const second = definedPositions.find((position) => position.x !== first.x || position.y !== first.y || position.z !== first.z)
  if (!second) return true
  const ab = { x: second.x - first.x, y: second.y - first.y, z: second.z - first.z }
  return definedPositions.every((position) => {
    const ac = { x: position.x - first.x, y: position.y - first.y, z: position.z - first.z }
    return ab.y * ac.z - ab.z * ac.y === 0 && ab.z * ac.x - ab.x * ac.z === 0 && ab.x * ac.y - ab.y * ac.x === 0
  })
}

function areCoplanarPoint3s(byId: Map<string, unknown>, pointIds: unknown): boolean {
  if (!Array.isArray(pointIds) || pointIds.length < 4) return true
  const positions = pointIds.map((id) => point3Position(byId, id))
  if (positions.some((position) => !position)) return false
  const definedPositions = positions as Array<{ x: number; y: number; z: number }>
  const first = definedPositions[0]
  let second: { x: number; y: number; z: number } | undefined
  let third: { x: number; y: number; z: number } | undefined
  for (let secondIndex = 1; secondIndex < definedPositions.length && !second; secondIndex += 1) {
    for (let thirdIndex = secondIndex + 1; thirdIndex < definedPositions.length; thirdIndex += 1) {
      const candidateSecond = definedPositions[secondIndex]
      const candidateThird = definedPositions[thirdIndex]
      const ab = { x: candidateSecond.x - first.x, y: candidateSecond.y - first.y, z: candidateSecond.z - first.z }
      const ac = { x: candidateThird.x - first.x, y: candidateThird.y - first.y, z: candidateThird.z - first.z }
      const cross = { x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x }
      if (cross.x !== 0 || cross.y !== 0 || cross.z !== 0) {
        second = candidateSecond
        third = candidateThird
        break
      }
    }
  }
  if (!second || !third) return true
  const ab = { x: second.x - first.x, y: second.y - first.y, z: second.z - first.z }
  const ac = { x: third.x - first.x, y: third.y - first.y, z: third.z - first.z }
  const normal = { x: ab.y * ac.z - ab.z * ac.y, y: ab.z * ac.x - ab.x * ac.z, z: ab.x * ac.y - ab.y * ac.x }
  const scale = Math.max(1, ...definedPositions.flatMap((position) => [Math.abs(position.x), Math.abs(position.y), Math.abs(position.z)]))
  return definedPositions.every((position) => Math.abs(normal.x * (position.x - first.x) + normal.y * (position.y - first.y) + normal.z * (position.z - first.z)) <= 1e-8 * scale)
}

function areIndependentVectors3(first: unknown, second: unknown): boolean {
  if (!isFiniteVector3(first) || !isFiniteVector3(second)) return false
  return first.y * second.z - first.z * second.y !== 0 || first.z * second.x - first.x * second.z !== 0 || first.x * second.y - first.y * second.x !== 0
}

function isValidPlaneFrame(value: unknown): boolean {
  return isRecord(value) && isFiniteVector3(value.origin) && areIndependentVectors3(value.u, value.v)
}

/** 二维参数对（面的 uv、曲面的 (方位角, 轴向比例)）：必须是恰好两个有限数。 */
function isFiniteUvPair(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && value.every(isFiniteNumber)
}

/**
 * 交点的"解引用"：`solutionIndex` 必须是非负整数（**不设上界**：采样曲线可以有任意多个解），
 * `hint` 必须是有限坐标（它是按最近解匹配的锚点）。
 */
function isValidSolutionRef(value: Record<string, unknown>): boolean {
  if (value.solutionIndex !== undefined && (!isFiniteNumber(value.solutionIndex) || !Number.isInteger(value.solutionIndex) || value.solutionIndex < 0)) return false
  if (value.hint !== undefined && !(isRecord(value.hint) && isFiniteNumber(value.hint.x) && isFiniteNumber(value.hint.y))) return false
  return true
}

function hasClosedFaceBoundary(byId: Map<string, unknown>, pointIds: unknown, edgeIds: unknown): boolean {
  if (!Array.isArray(pointIds) || !Array.isArray(edgeIds) || pointIds.length !== edgeIds.length) return false
  const pointSet = new Set(pointIds.filter((id): id is string => typeof id === "string"))
  const degrees = new Map<string, number>()
  const adjacency = new Map<string, Set<string>>()
  for (const pointId of pointSet) adjacency.set(pointId, new Set())
  for (const edgeId of edgeIds) {
    if (typeof edgeId !== "string") return false
    const edge = byId.get(edgeId)
    if (!isRecord(edge) || edge.type !== "edge3" || !Array.isArray(edge.pointIds) || edge.pointIds.length !== 2) return false
    const [start, end] = edge.pointIds
    if (typeof start !== "string" || typeof end !== "string" || !pointSet.has(start) || !pointSet.has(end) || start === end) return false
    degrees.set(start, (degrees.get(start) ?? 0) + 1)
    degrees.set(end, (degrees.get(end) ?? 0) + 1)
    adjacency.get(start)?.add(end)
    adjacency.get(end)?.add(start)
  }
  if (!pointIds.every((id) => typeof id === "string" && degrees.get(id) === 2)) return false
  const firstPoint = pointIds[0]
  if (typeof firstPoint !== "string") return false
  const visited = new Set<string>()
  const pending = [firstPoint]
  while (pending.length > 0) {
    const pointId = pending.pop()
    if (!pointId || visited.has(pointId)) continue
    visited.add(pointId)
    for (const neighbor of adjacency.get(pointId) ?? []) if (!visited.has(neighbor)) pending.push(neighbor)
  }
  return visited.size === pointSet.size
}

/**
 * 绕定点旋转：定点要么是一个有限的固定坐标，要么指向一个真实存在的点图元；
 * 转角必须是有限弧度，基准圆心必须是有限坐标（缺了它重算就会把结果当基准、越转越偏）。
 */
function isCurveRotation(byId: Map<string, unknown>, value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!isFiniteNumber(value.angle) || !isFiniteCoordinate(value.baseCenter)) return false
  const pivot = value.pivot
  if (!isRecord(pivot)) return false
  if (pivot.kind === "coordinate") return isFiniteCoordinate(pivot)
  if (pivot.kind === "primitive") return typeof pivot.primitiveId === "string" && referenceType(byId, pivot.primitiveId) === "point"
  return false
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

function validatePrimitive(value: unknown, byId: Map<string, unknown>, parameterIds: Set<string>): string[] {
  if (!isRecord(value) || typeof value.id !== "string") return ["every primitive needs a stable id"]
  const errors: string[] = []
  const type = primitiveType(value)
  if (!type || !primitiveTypes.has(type)) return [`invalid primitive type: ${String(value.type)}`]
  validatePresentation(value, errors)
  if (type === "point" && (!isFiniteNumber(value.x) || !isFiniteNumber(value.y))) errors.push("point coordinates must be finite")
  if (type === "point" && value.binding !== undefined) {
    if (!isRecord(value.binding) || !["free", "onPath", "derived"].includes(String(value.binding.kind))) errors.push("point binding is invalid")
    else if (value.binding.kind === "onPath") {
      if (typeof value.binding.pathId !== "string" || !isFiniteNumber(value.binding.parameter)) errors.push("point path binding is invalid")
      // `domain` 是抛物线/双曲线这类无界自然参数曲线的扫描窗口，必须是递增的有限区间。
      else if (value.binding.domain !== undefined && (!Array.isArray(value.binding.domain) || value.binding.domain.length !== 2 || !value.binding.domain.every(isFiniteNumber) || value.binding.domain[0] >= value.binding.domain[1])) errors.push("point path binding domain is invalid")
      else if (value.binding.branch !== undefined && value.binding.branch !== 0 && value.binding.branch !== 1) errors.push("point path binding branch is invalid")
    }
    else if (value.binding.kind === "derived" && (typeof value.binding.sourceId !== "string" || typeof value.binding.feature !== "string")) errors.push("point derived binding is invalid")
  }
  if (type === "point3") {
    if (!isFiniteVector3(value.position)) errors.push("point3 position must be finite")
    // 细分顶点标记（圆类实体近似的内部顶点）：只允许布尔，缺省表示"用户点"。
    if (value.tessellation !== undefined && typeof value.tessellation !== "boolean") errors.push("point3 tessellation flag is invalid")
    if (value.binding !== undefined) {
      if (!isRecord(value.binding) || !["free", "onLine", "onPlane", "derived", "onHost", "onFace", "onSurface", "inSolid"].includes(String(value.binding.kind))) errors.push("point3 binding is invalid")
      else if (value.binding.kind === "onLine" && (typeof value.binding.lineId !== "string" || !["line3", "segment3", "ray3"].includes(referenceType(byId, value.binding.lineId) ?? "") || !isFiniteNumber(value.binding.parameter))) errors.push("point3 line binding is invalid")
      else if (value.binding.kind === "onPlane" && (typeof value.binding.planeId !== "string" || referenceType(byId, value.binding.planeId) !== "plane3" || !Array.isArray(value.binding.coordinates) || value.binding.coordinates.length !== 2 || !value.binding.coordinates.every(isFiniteNumber) || !isValidPlaneFrame(value.binding.frame))) errors.push("point3 plane binding is invalid")
      else if (value.binding.kind === "derived" && (!Array.isArray(value.binding.sourceIds) || value.binding.sourceIds.length === 0 || value.binding.sourceIds.some((sourceId) => typeof sourceId !== "string" || !byId.has(sourceId)) || typeof value.binding.feature !== "string")) errors.push("point3 derived binding is invalid")
      // 宿主绑定的引用必须存在且类型正确：悬空引用会让点静默冻住，而且文档依然能保存（实测过的坑）。
      else if (value.binding.kind === "onHost" && (typeof value.binding.hostId !== "string" || !["line3", "segment3", "ray3", "edge3"].includes(referenceType(byId, value.binding.hostId) ?? "") || !isFiniteNumber(value.binding.parameter))) errors.push("point3 host binding is invalid")
      else if (value.binding.kind === "onFace" && (typeof value.binding.faceId !== "string" || referenceType(byId, value.binding.faceId) !== "face3" || !isFiniteUvPair(value.binding.uv))) errors.push("point3 face binding is invalid")
      else if (value.binding.kind === "onSurface" && (typeof value.binding.solidId !== "string" || !["cylinder", "cone"].includes(referenceType(byId, value.binding.solidId) ?? "") || !isFiniteUvPair(value.binding.uv))) errors.push("point3 surface binding is invalid")
      // 实体内：宿主必须是**实体**（点要有体积才谈得上"在里面"），参数是三个 [0,1] 比例。
      else if (value.binding.kind === "inSolid" && (typeof value.binding.solidId !== "string" || !solidTypes.has(referenceType(byId, value.binding.solidId) ?? "") || !Array.isArray(value.binding.uvw) || value.binding.uvw.length !== 3 || !value.binding.uvw.every(isFiniteNumber))) errors.push("point3 solid binding is invalid")
    }
  }
  if (type === "line3") {
    const definition = isRecord(value.definition) ? value.definition : undefined
    if (!definition || !["throughPoints", "pointDirection"].includes(String(definition.kind))) errors.push("line3 definition is invalid")
    else if (definition.kind === "throughPoints" && (!Array.isArray(definition.pointIds) || definition.pointIds.length !== 2 || definition.pointIds[0] === definition.pointIds[1] || !referencesTypes(byId, definition.pointIds, new Set(["point3"])))) errors.push("line3 references invalid points")
    else if (definition.kind === "pointDirection" && (typeof definition.pointId !== "string" || referenceType(byId, definition.pointId) !== "point3" || !isNonZeroVector3(definition.direction))) errors.push("line3 point-direction definition is invalid")
  }
  if (type === "segment3") {
    if (!Array.isArray(value.pointIds) || value.pointIds.length !== 2 || value.pointIds[0] === value.pointIds[1] || !referencesTypes(byId, value.pointIds, new Set(["point3"]))) errors.push("segment3 references invalid points")
  }
  if (type === "ray3") {
    if (typeof value.originId !== "string" || typeof value.throughId !== "string" || value.originId === value.throughId || referenceType(byId, value.originId) !== "point3" || referenceType(byId, value.throughId) !== "point3") errors.push("ray3 references invalid points")
  }
  if (type === "plane3") {
    const definition = isRecord(value.definition) ? value.definition : undefined
    if (!definition || !["throughPoints", "pointNormal"].includes(String(definition.kind))) errors.push("plane3 definition is invalid")
    else if (definition.kind === "throughPoints") {
      if (!Array.isArray(definition.pointIds) || definition.pointIds.length !== 3 || !isDistinctStringList(definition.pointIds, 3)) errors.push("plane3 points must be distinct")
      else if (!referencesTypes(byId, definition.pointIds, new Set(["point3"]))) errors.push("plane3 references invalid points")
      else if (areCollinearPoint3s(byId, definition.pointIds)) errors.push("plane3 points are collinear")
    }
    else if (definition.kind === "pointNormal" && (typeof definition.pointId !== "string" || referenceType(byId, definition.pointId) !== "point3" || !isNonZeroVector3(definition.normal))) errors.push("plane3 point-normal definition is invalid")
  }
  if (type === "circle3") {
    if (typeof value.centerId !== "string" || referenceType(byId, value.centerId) !== "point3" || !isNonZeroVector3(value.normal) || !isFiniteNumber(value.radius) || value.radius <= 0) errors.push("circle3 geometry is invalid")
  }
  if (type === "edge3") {
    if (!Array.isArray(value.pointIds) || value.pointIds.length !== 2 || value.pointIds[0] === value.pointIds[1] || !referencesTypes(byId, value.pointIds, new Set(["point3"]))) errors.push("edge3 references invalid points")
    if (value.faceIds !== undefined && (!isDistinctStringList(value.faceIds, 1) || !referencesTypes(byId, value.faceIds, new Set(["face3"])))) errors.push("edge3 references invalid faces")
    // 母线标记（圆类实体近似的内部棱）：只允许布尔，缺省表示普通的用户棱。
    if (value.tessellation !== undefined && typeof value.tessellation !== "boolean") errors.push("edge3 tessellation flag is invalid")
  }
  if (type === "face3") {
    const facePointIds = Array.isArray(value.pointIds) ? value.pointIds : []
    const faceEdgeIds = Array.isArray(value.edgeIds) ? value.edgeIds : []
    const validFacePoints = isDistinctStringList(facePointIds, 3) && referencesTypes(byId, facePointIds, new Set(["point3"]))
    if (!validFacePoints) errors.push("face3 needs at least three distinct points")
    else if (areCollinearPoint3List(byId, facePointIds)) errors.push("face3 points are collinear")
    else if (facePointIds.length >= 4 && !areCoplanarPoint3s(byId, facePointIds)) errors.push("face3 points are not coplanar")
    if (value.edgeIds !== undefined) {
      const validFaceEdges = isDistinctStringList(faceEdgeIds, 1) && referencesTypes(byId, faceEdgeIds, new Set(["edge3"]))
      if (!validFaceEdges) errors.push("face3 references invalid edges")
      else if (!hasClosedFaceBoundary(byId, facePointIds, faceEdgeIds)) errors.push("face3 boundary is not closed")
    }
    if (value.planeId !== undefined && (typeof value.planeId !== "string" || referenceType(byId, value.planeId) !== "plane3")) errors.push("face3 references invalid plane")
  }
  if (type === "polyhedron3") {
    const vertexIds = Array.isArray(value.vertexIds) ? value.vertexIds : []
    const edgeIds = Array.isArray(value.edgeIds) ? value.edgeIds : []
    const faceIds = Array.isArray(value.faceIds) ? value.faceIds : []
    const validVertices = isDistinctStringList(vertexIds, 4) && referencesTypes(byId, vertexIds, new Set(["point3"]))
    const validEdges = edgeIds.length >= 6 && edgeIds.every((edgeId) => typeof edgeId === "string" && referenceType(byId, edgeId) === "edge3")
    const validFaces = faceIds.length >= 4 && faceIds.every((faceId) => typeof faceId === "string" && referenceType(byId, faceId) === "face3")
    if (!validVertices) errors.push("polyhedron3 references missing vertex")
    if (!validEdges) errors.push("polyhedron3 references invalid edges")
    if (!validFaces) errors.push("polyhedron3 references invalid faces")
    if (Array.isArray(value.edgeIds) && new Set(edgeIds).size !== edgeIds.length) errors.push("polyhedron3 edge references must be unique")
    if (Array.isArray(value.faceIds) && new Set(faceIds).size !== faceIds.length) errors.push("polyhedron3 face references must be unique")
    if (validVertices && areCoplanarPoint3s(byId, vertexIds)) errors.push("polyhedron3 vertices are coplanar")
    if (validVertices && validEdges) {
      const vertexSet = new Set(vertexIds)
      for (const edgeId of edgeIds) {
        const edge = byId.get(edgeId)
        if (!isRecord(edge) || !Array.isArray(edge.pointIds) || edge.pointIds.length !== 2 || edge.pointIds.some((pointId) => typeof pointId !== "string" || !vertexSet.has(pointId))) {
          errors.push("polyhedron3 edge is outside vertex set")
          break
        }
      }
    }
    if (validVertices && validFaces) {
      const vertexSet = new Set(vertexIds)
      for (const faceId of faceIds) {
        const face = byId.get(faceId)
        if (!isRecord(face) || !Array.isArray(face.pointIds) || face.pointIds.some((pointId) => typeof pointId !== "string" || !vertexSet.has(pointId))) {
          errors.push("polyhedron3 face is outside vertex set")
          break
        }
      }
    }
    if (value.construction !== undefined) {
      const construction = isRecord(value.construction) ? value.construction : undefined
      if (!construction || !["template", "fromPoints", "fromFaces"].includes(String(construction.kind)) || !Array.isArray(construction.sourceIds) || construction.sourceIds.some((sourceId) => typeof sourceId !== "string" || !byId.has(sourceId))) errors.push("polyhedron3 construction is invalid")
      if (construction?.kind === "template" && (typeof construction.templateId !== "string" || (construction.parameterIds !== undefined && (!isDistinctStringList(construction.parameterIds, 1) || construction.parameterIds.some((parameterId) => !parameterIds.has(parameterId)))))) errors.push("polyhedron3 template construction is invalid")
      // `fromFaces` 的 `sourceId` 是"这条拓扑属于哪个实体"：必须指向文档里真实存在的图元。
      if (construction?.sourceId !== undefined && (typeof construction.sourceId !== "string" || !byId.has(construction.sourceId))) errors.push("polyhedron3 construction sourceId is invalid")
    }
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
    if (value.kind === "parabola") {
      const control = isRecord(value.control) ? value.control : undefined
      const hasThirdPoint = typeof control?.thirdPointId === "string" && referenceType(byId, control.thirdPointId) === "point"
      const hasVertexModel = isFiniteCoordinate(control?.vertex) && ["x", "y"].includes(String(control?.axis)) && isFiniteNumber(control?.focalParameter) && control.focalParameter !== 0
      if (!hasThirdPoint && !hasVertexModel) errors.push("parabola connection needs a third point or vertex model")
    }
  }
  if (type === "locus") {
    if (referenceType(byId, value.sourcePointId) !== "point" || typeof value.parameterId !== "string" || !Array.isArray(value.domain) || value.domain.length !== 2 || !value.domain.every(isFiniteNumber) || value.domain[0] >= value.domain[1] || !isFiniteNumber(value.samples) || !Number.isInteger(value.samples) || value.samples < 2 || value.samples > 4096) errors.push("locus geometry is invalid")
  }
  if (type === "parabola" && (!isFiniteCoordinate(value.vertex) || !isFiniteNumber(value.focalParameter) || value.focalParameter === 0 || !["x", "y"].includes(String(value.axis)) || (value.rotation !== undefined && !isFiniteNumber(value.rotation)))) errors.push("parabola geometry is invalid")
  if (type === "ellipse" || type === "hyperbola") {
    if (!isFiniteCoordinate(value.center) || !isFiniteNumber(value.radiusX) || !isFiniteNumber(value.radiusY) || value.radiusX <= 0 || value.radiusY <= 0 || (value.rotation !== undefined && !isFiniteNumber(value.rotation))) errors.push(`${type} geometry is invalid`)
    if (type === "hyperbola" && !["x", "y"].includes(String(value.axis))) errors.push("hyperbola axis is invalid")
    // 只有椭圆支持绕定点旋转：双曲线不封闭，"过一个定点"对它的两支没有这种含义。
    if (value.rotationAbout !== undefined && (type !== "ellipse" || !isCurveRotation(byId, value.rotationAbout))) errors.push(`${type} rotation about a fixed point is invalid`)
  }
  if (type === "function") {
    if (typeof value.expression !== "string" || !value.expression.trim()) errors.push("function expression is required")
    if (!Array.isArray(value.domain) || value.domain.length !== 2 || !value.domain.every(isFiniteNumber) || value.domain[0] >= value.domain[1]) errors.push("function domain is invalid")
    if (value.samples !== undefined && (!isFiniteNumber(value.samples) || !Number.isInteger(value.samples) || value.samples < 2 || value.samples > 2048)) errors.push("function sample count is invalid")
  }
  if (type === "derivative") {
    if (referenceType(byId, value.sourceId) !== "function") errors.push("derivative references invalid function")
    if (![1, 2].includes(Number(value.order))) errors.push("derivative order is invalid")
    if (!Array.isArray(value.domain) || value.domain.length !== 2 || !value.domain.every(isFiniteNumber) || value.domain[0] >= value.domain[1]) errors.push("derivative domain is invalid")
    if (!isFiniteNumber(value.samples) || !Number.isInteger(value.samples) || value.samples < 2 || value.samples > 2048) errors.push("derivative sample count is invalid")
    if (!Array.isArray(value.points) || value.points.some((point) => !isFiniteCoordinate(point))) errors.push("derivative points are invalid")
    if (!["approximate", "undefined", "failed"].includes(String(value.status))) errors.push("derivative status is invalid")
    if (value.diagnostic !== undefined && typeof value.diagnostic !== "string") errors.push("derivative diagnostic is invalid")
  }
  if (type === "tangent" || type === "normal") {
    if (referenceType(byId, value.sourceId) !== "function") errors.push(`${type} references invalid function`)
    if (!isFiniteNumber(value.x) || !isFiniteCoordinate(value.point) || !isFiniteNumber(value.slope) || !isFiniteCoordinate(value.a) || !isFiniteCoordinate(value.b)) errors.push(`${type} geometry is invalid`)
    if (value.vertical !== undefined && typeof value.vertical !== "boolean") errors.push(`${type} vertical state is invalid`)
    if (!["approximate", "undefined", "failed"].includes(String(value.status))) errors.push(`${type} status is invalid`)
    if (value.diagnostic !== undefined && typeof value.diagnostic !== "string") errors.push(`${type} diagnostic is invalid`)
  }
  if (type === "secant") {
    if (referenceType(byId, value.sourceId) !== "function") errors.push("secant references invalid function")
    if (!isFiniteNumber(value.x1) || !isFiniteNumber(value.x2) || value.x1 === value.x2 || !Array.isArray(value.points) || (value.points.length !== 0 && (value.points.length !== 2 || value.points.some((point) => !isFiniteCoordinate(point)))) || !isFiniteNumber(value.slope) || !isFiniteCoordinate(value.a) || !isFiniteCoordinate(value.b)) errors.push("secant geometry is invalid")
    if (value.vertical !== undefined && typeof value.vertical !== "boolean") errors.push("secant vertical state is invalid")
    if (!["approximate", "undefined", "failed"].includes(String(value.status))) errors.push("secant status is invalid")
    if (value.diagnostic !== undefined && typeof value.diagnostic !== "string") errors.push("secant diagnostic is invalid")
  }
  if (type === "integral") {
    if (referenceType(byId, value.sourceId) !== "function") errors.push("integral references invalid function")
    if (!Array.isArray(value.domain) || value.domain.length !== 2 || !value.domain.every(isFiniteNumber) || value.domain[0] >= value.domain[1]) errors.push("integral domain is invalid")
    if (!isFiniteNumber(value.steps) || !Number.isInteger(value.steps) || value.steps < 2 || value.steps > 8192) errors.push("integral step count is invalid")
    if (!Array.isArray(value.points) || value.points.some((point) => !isFiniteCoordinate(point))) errors.push("integral points are invalid")
    if (value.area !== null && !isFiniteNumber(value.area)) errors.push("integral area is invalid")
    if (!["approximate", "undefined", "failed"].includes(String(value.status))) errors.push("integral status is invalid")
    if (value.diagnostic !== undefined && typeof value.diagnostic !== "string") errors.push("integral diagnostic is invalid")
  }
  if (type === "analysisSet") {
    if (referenceType(byId, value.sourceId) !== "function") errors.push("analysis set references invalid function")
    if (!Array.isArray(value.domain) || value.domain.length !== 2 || !value.domain.every(isFiniteNumber) || value.domain[0] >= value.domain[1]) errors.push("analysis set domain is invalid")
    if (!isFiniteNumber(value.samples) || !Number.isInteger(value.samples) || value.samples < 2 || value.samples > 2048) errors.push("analysis set sample count is invalid")
    if (!Array.isArray(value.results) || value.results.some((result) => !isRecord(result) || !["zero", "maximum", "minimum", "inflection"].includes(String(result.kind)) || !isFiniteNumber(result.x) || !isFiniteNumber(result.y) || result.approximate !== true)) errors.push("analysis set results are invalid")
    if (!["approximate", "undefined", "failed"].includes(String(value.status))) errors.push("analysis set status is invalid")
    if (value.diagnostic !== undefined && typeof value.diagnostic !== "string") errors.push("analysis set diagnostic is invalid")
  }
  if (type === "cube") {
    if (!isFiniteCoordinate3(value.origin) || !isFiniteCoordinate3(value.size) || value.size.x <= 0 || value.size.y <= 0 || value.size.z <= 0) errors.push("cube geometry is invalid")
  }
  if (type === "pyramid") {
    if (!isFiniteCoordinate3(value.baseCenter) || !isRecord(value.baseSize) || !isFiniteNumber(value.baseSize.x) || !isFiniteNumber(value.baseSize.y) || value.baseSize.x <= 0 || value.baseSize.y <= 0 || !isFiniteNumber(value.height) || value.height <= 0) errors.push("pyramid geometry is invalid")
  }
  if (type === "cylinder" || type === "cone") {
    if (!isFiniteCoordinate3(value.center) || !isFiniteNumber(value.radius) || value.radius <= 0 || !isFiniteNumber(value.height) || value.height <= 0 || !isFiniteNumber(value.segments) || !Number.isInteger(value.segments) || value.segments < 3 || value.segments > 256) errors.push(`${type} geometry is invalid`)
  }
  if (["cube", "pyramid", "cylinder", "cone"].includes(type) && value.rotation !== undefined && !isFiniteCoordinate3(value.rotation)) errors.push(`${type} rotation must be three finite radians`)
  if (type === "plane3" && value.halfSize !== undefined && (!isFiniteNumber(value.halfSize) || value.halfSize <= 0)) errors.push("plane3 halfSize must be a positive finite number")
  if (type === "section") {
    if (typeof value.sourceId !== "string" || !byId.has(value.sourceId) || !solidTypes.has(referenceType(byId, value.sourceId) ?? "")) errors.push("section references invalid solid")
    if (!isRecord(value.plane) || !isFiniteCoordinate3(value.plane.normal) || !isFiniteNumber(value.plane.constant)) errors.push("section plane is invalid")
    if (!Array.isArray(value.points) || value.points.some((point) => !isFiniteCoordinate3(point))) errors.push("section points are invalid")
    /**
     * `loops` 是可选的完整边界（带孔 / 分块的截面靠它），直接喂给 3D 预览的描边与三角化。
     * 之前只校验了 `points`：`loops: "x"`、`loops: [点, "环"]` 或环里带 NaN 坐标都能存进来，
     * 渲染层要么抛异常要么画出 NaN 顶点。
     */
    if (value.loops !== undefined && (!Array.isArray(value.loops) || value.loops.some((loop) => !Array.isArray(loop) || loop.some((point) => !isFiniteCoordinate3(point))))) errors.push("section loops are invalid")
    if (value.exact !== undefined) {
      const exact = value.exact
      if (!isRecord(exact) || !conic3Kinds.has(String(exact.kind)) || !isCurvePieceLoops(exact.loops)) errors.push("section exact boundary is invalid")
    }
    if (value.classification !== undefined && !["none", "point", "segment", "polygon", "insufficient-data"].includes(String(value.classification))) errors.push("section classification is invalid")
    if (!["approximate", "exact", "undefined", "failed"].includes(String(value.status))) errors.push("section status is invalid")
    if (value.diagnostic !== undefined && typeof value.diagnostic !== "string") errors.push("section diagnostic is invalid")
  }
  if (type === "intersectionLine") {
    const sources = value.sourceIds
    if (!Array.isArray(sources) || sources.length !== 2 || sources.some((id) => typeof id !== "string")) errors.push("intersectionLine needs exactly two source ids")
    else if (sources[0] === sources[1]) errors.push("intersectionLine sources must differ")
    else if (sources.some((id) => !byId.has(id as string))) errors.push("intersectionLine references a missing source")
    else if (!sources.every((id) => solidTypes.has(referenceType(byId, id as string) ?? "") || ["face3", "plane3"].includes(referenceType(byId, id as string) ?? ""))) errors.push("intersectionLine sources must be solids, faces or planes")
    if (!Array.isArray(value.segments) || value.segments.some((segment) => !isRecord(segment) || !isFiniteCoordinate3(segment.a) || !isFiniteCoordinate3(segment.b))) errors.push("intersectionLine segments are invalid")
    if (value.classification !== undefined && !["none", "segment", "polyline", "insufficient-data"].includes(String(value.classification))) errors.push("intersectionLine classification is invalid")
    if (!["valid", "degenerate", "insufficient-data"].includes(String(value.status))) errors.push("intersectionLine status is invalid")
    if (value.diagnostic !== undefined && typeof value.diagnostic !== "string") errors.push("intersectionLine diagnostic is invalid")
  }
  if (type === "intersectionSolid") {
    const sources = value.sourceIds
    if (!Array.isArray(sources) || sources.length !== 2 || sources.some((id) => typeof id !== "string")) errors.push("intersectionSolid needs exactly two source ids")
    else if (sources[0] === sources[1]) errors.push("intersectionSolid sources must differ")
    else if (sources.some((id) => !byId.has(id as string))) errors.push("intersectionSolid references a missing source")
    // 交面是**布尔交集**：只有凸实体之间才有确定的结果，平面/面都没有体积可言。
    else if (!sources.every((id) => solidTypes.has(referenceType(byId, id as string) ?? ""))) errors.push("intersectionSolid sources must be solids")
    if (!Array.isArray(value.vertices) || value.vertices.some((vertex) => !isFiniteCoordinate3(vertex))) errors.push("intersectionSolid vertices are invalid")
    const vertexCount = Array.isArray(value.vertices) ? value.vertices.length : 0
    if (!Array.isArray(value.faces) || value.faces.some((face) => !Array.isArray(face) || face.length < 3 || face.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount))) errors.push("intersectionSolid faces are invalid")
    if (!isFiniteNumber(value.volume) || value.volume < 0) errors.push("intersectionSolid volume is invalid")
    if (!isFiniteNumber(value.area) || value.area < 0) errors.push("intersectionSolid area is invalid")
    if (!["polyhedron", "flat", "point", "segment", "none", "insufficient-data"].includes(String(value.status))) errors.push("intersectionSolid status is invalid")
    if (value.diagnostic !== undefined && typeof value.diagnostic !== "string") errors.push("intersectionSolid diagnostic is invalid")
  }
  if (type === "intersectionFace" || type === "intersectionPoint3") {
    const sources = value.sourceIds
    const kindLabel = type === "intersectionFace" ? "intersectionFace" : "intersectionPoint3"
    if (!Array.isArray(sources) || sources.length !== 2 || sources.some((id) => typeof id !== "string")) errors.push(`${kindLabel} needs exactly two source ids`)
    else if (sources[0] === sources[1]) errors.push(`${kindLabel} sources must differ`)
    else if (sources.some((id) => !byId.has(id as string))) errors.push(`${kindLabel} references a missing source`)
    // 交面是**布尔交集的一个面**：只有实体才有面可言；交点是交线的端点，面 / 平面也能给（平面没有边界，重算时会报诊断）。
    else if (type === "intersectionFace" && !sources.every((id) => solidTypes.has(referenceType(byId, id as string) ?? ""))) errors.push("intersectionFace sources must be solids")
    else if (type === "intersectionPoint3" && !sources.every((id) => solidTypes.has(referenceType(byId, id as string) ?? "") || ["face3", "plane3"].includes(referenceType(byId, id as string) ?? ""))) errors.push("intersectionPoint3 sources must be solids, faces or planes")
    if (!isFiniteCoordinate3(value.hint)) errors.push(`${kindLabel} hint is invalid`)
    if (!["valid", "none", "insufficient-data"].includes(String(value.status))) errors.push(`${kindLabel} status is invalid`)
    if (value.diagnostic !== undefined && typeof value.diagnostic !== "string") errors.push(`${kindLabel} diagnostic is invalid`)
    if (type === "intersectionFace") {
      if (!Array.isArray(value.points) || value.points.some((point) => !isFiniteCoordinate3(point))) errors.push("intersectionFace points are invalid")
      if (!isFiniteCoordinate3(value.normal)) errors.push("intersectionFace normal is invalid")
      if (!isFiniteNumber(value.area) || value.area < 0) errors.push("intersectionFace area is invalid")
      // 面积精度标注：闭式（平面 / 整圆 πab）还是网格求和（曲面区域）。可选，旧文档没有它。
      if (value.areaExact !== undefined && typeof value.areaExact !== "boolean") errors.push("intersectionFace areaExact is invalid")
      // 前导外环的顶点数（曲面区域缝了不止一圈时才有）：必须是"≥3 的整数"，否则渲染方缝不出环向条带。
      if (value.outerRingLength !== undefined && (!isFiniteNumber(value.outerRingLength) || !Number.isInteger(value.outerRingLength) || value.outerRingLength < 3)) errors.push("intersectionFace outerRingLength is invalid")
      if (value.exactLoops !== undefined && !isCurvePieceLoops(value.exactLoops)) errors.push("intersectionFace exact loops are invalid")
    } else if (!isFiniteCoordinate3(value.position)) errors.push("intersectionPoint3 position is invalid")
  }
  if (type === "circle" || type === "arc") {
    if (!isFiniteCoordinate(value.center) || !isFiniteNumber(value.radius) || value.radius <= 0) errors.push(`${type} geometry is invalid`)
    if (type === "arc" && (!isFiniteNumber(value.startAngle) || !isFiniteNumber(value.endAngle))) errors.push("arc angles must be finite")
    // 圆可以绕定点旋转（这是用户要的那类题）；弧不是封闭曲线，不给这个能力。
    if (value.rotation !== undefined && !isFiniteNumber(value.rotation)) errors.push(`${type} rotation is invalid`)
    if (value.rotationAbout !== undefined && (type !== "circle" || !isCurveRotation(byId, value.rotationAbout))) errors.push(`${type} rotation about a fixed point is invalid`)
  }
  if (type === "intersection") {
    if (typeof value.lineA !== "string" || typeof value.lineB !== "string" || !byId.has(value.lineA) || !byId.has(value.lineB)) errors.push("intersection references missing line")
    else if (referenceType(byId, value.lineA) !== "line" || referenceType(byId, value.lineB) !== "line" || value.lineA === value.lineB) errors.push("intersection references invalid lines")
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) errors.push("intersection coordinates must be finite")
  }
  if (type === "lineCircleIntersection") {
    if (referenceType(byId, value.lineId) !== "line" || referenceType(byId, value.circleId) !== "circle") errors.push("line-circle intersection references invalid objects")
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) errors.push("intersection coordinates must be finite")
    if (!isValidSolutionRef(value)) errors.push("intersection solution reference is invalid")
  }
  if (type === "circleIntersection") {
    if (referenceType(byId, value.circleA) !== "circle" || referenceType(byId, value.circleB) !== "circle" || value.circleA === value.circleB) errors.push("circle intersection references invalid circles")
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) errors.push("intersection coordinates must be finite")
    if (!isValidSolutionRef(value)) errors.push("intersection solution reference is invalid")
  }
  if (type === "curveIntersection") {
    if (value.objectA === value.objectB || !sampledTypes.has(referenceType(byId, value.objectA) ?? "") || !sampledTypes.has(referenceType(byId, value.objectB) ?? "")) errors.push("curve intersection references invalid objects")
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) errors.push("intersection coordinates must be finite")
    if (!isValidSolutionRef(value)) errors.push("intersection solution reference is invalid")
  }
  if (type === "intersectionSet") {
    if (value.objectA === value.objectB || !sampledTypes.has(referenceType(byId, value.objectA) ?? "") || !sampledTypes.has(referenceType(byId, value.objectB) ?? "")) errors.push("intersection set references invalid objects")
    if (!Array.isArray(value.points) || value.points.some((point) => !isFiniteCoordinate(point))) errors.push("intersection set points are invalid")
    if (value.selectedIndex !== undefined && (!isFiniteNumber(value.selectedIndex) || !Number.isInteger(value.selectedIndex) || value.selectedIndex < 0)) errors.push("intersection set selection is invalid")
  }
  return errors
}

function validateAnnotation(value: unknown, byId: Map<string, unknown>): string[] {
  if (!isRecord(value) || typeof value.id !== "string") return ["every annotation needs a stable id"]
  const errors: string[] = []
  if (typeof value.text !== "string" || !value.text.trim()) errors.push(`annotation text is required: ${value.id}`)
  if (value.visible !== undefined && typeof value.visible !== "boolean") errors.push(`annotation visibility is invalid: ${value.id}`)
  if (value.offset !== undefined && !isFiniteCoordinate(value.offset)) errors.push(`annotation offset is invalid: ${value.id}`)
  if (value.target !== undefined) {
    if (typeof value.target !== "string" || !byId.has(value.target)) errors.push(`annotation references missing primitive: ${value.id}`)
  }
  if (value.x !== undefined || value.y !== undefined) {
    if (!isFiniteNumber(value.x) || !isFiniteNumber(value.y)) errors.push(`annotation coordinates are invalid: ${value.id}`)
  }
  if (value.anchor !== undefined) {
    if (!isRecord(value.anchor) || !["coordinate", "primitive"].includes(String(value.anchor.kind))) errors.push(`annotation anchor is invalid: ${value.id}`)
    else if (value.anchor.kind === "coordinate" && (!isFiniteNumber(value.anchor.x) || !isFiniteNumber(value.anchor.y))) errors.push(`annotation anchor coordinates are invalid: ${value.id}`)
    else if (value.anchor.kind === "primitive") {
      if (typeof value.anchor.primitiveId !== "string" || !byId.has(value.anchor.primitiveId)) errors.push(`annotation references missing primitive: ${value.id}`)
      if (value.anchor.feature !== undefined && !annotationFeatures.has(String(value.anchor.feature))) errors.push(`annotation feature is invalid: ${value.id}`)
      if (value.anchor.index !== undefined && (typeof value.anchor.index !== "number" || !Number.isInteger(value.anchor.index) || value.anchor.index < 0)) errors.push(`annotation feature index is invalid: ${value.id}`)
    }
  } else if (value.target === undefined && (value.x === undefined || value.y === undefined)) {
    errors.push(`annotation needs an anchor: ${value.id}`)
  }
  return errors
}

function validateLayers(value: unknown, errors: string[]): Set<string> {
  const layerIds = new Set<string>()
  if (!Array.isArray(value)) return layerIds
  for (const layer of value) {
    if (!isRecord(layer) || typeof layer.id !== "string" || !layer.id) {
      errors.push("every layer needs a stable id")
      continue
    }
    if (layerIds.has(layer.id)) errors.push(`duplicate layer id: ${layer.id}`)
    layerIds.add(layer.id)
  }
  for (const layer of value) {
    if (!isRecord(layer) || typeof layer.id !== "string" || !layer.id) continue
    if (typeof layer.name !== "string") errors.push(`layer name is invalid: ${layer.id}`)
    if (!["geometry", "dimension", "construction", "annotation", "reference"].includes(String(layer.kind))) errors.push(`layer kind is invalid: ${layer.id}`)
    if (typeof layer.visible !== "boolean") errors.push(`layer visibility is invalid: ${layer.id}`)
    if (typeof layer.locked !== "boolean") errors.push(`layer lock state is invalid: ${layer.id}`)
    if (typeof layer.printable !== "boolean") errors.push(`layer printable state is invalid: ${layer.id}`)
    if (layer.parentId !== undefined && (typeof layer.parentId !== "string" || !layerIds.has(layer.parentId) || layer.parentId === layer.id)) errors.push(`layer parent is missing: ${layer.id}`)
    if (layer.color !== undefined && typeof layer.color !== "string") errors.push(`layer color is invalid: ${layer.id}`)
    if (layer.lineStyle !== undefined && !["continuous", "dashed", "center"].includes(String(layer.lineStyle))) errors.push(`layer line style is invalid: ${layer.id}`)
  }
  return layerIds
}

function validateDrawingViews(value: unknown, errors: string[]): Set<string> {
  const viewIds = new Set<string>()
  if (!Array.isArray(value)) return viewIds
  for (const view of value) {
    if (!isRecord(view) || typeof view.id !== "string" || !view.id) {
      errors.push("every drawing view needs a stable id")
      continue
    }
    if (viewIds.has(view.id)) errors.push(`duplicate drawing view id: ${view.id}`)
    viewIds.add(view.id)
    if (!["model", "front", "top", "left", "axonometric"].includes(String(view.kind))) errors.push(`drawing view kind is invalid: ${view.id}`)
    if (view.sourceIds !== undefined && (!Array.isArray(view.sourceIds) || view.sourceIds.some((sourceId) => typeof sourceId !== "string"))) errors.push(`drawing view sources are invalid: ${view.id}`)
    if (!isFiniteNumber(view.x)) errors.push(`drawing view x is invalid: ${view.id}`)
    if (!isFiniteNumber(view.y)) errors.push(`drawing view y is invalid: ${view.id}`)
    if (!isFiniteNumber(view.width) || view.width <= 0) errors.push(`drawing view width is invalid: ${view.id}`)
    if (!isFiniteNumber(view.height) || view.height <= 0) errors.push(`drawing view height is invalid: ${view.id}`)
    if (!isFiniteNumber(view.scale) || view.scale <= 0) errors.push(`drawing view scale is invalid: ${view.id}`)
    if (typeof view.visible !== "boolean") errors.push(`drawing view visibility is invalid: ${view.id}`)
    if (typeof view.showProjectionLines !== "boolean") errors.push(`drawing view projection lines are invalid: ${view.id}`)
  }
  return viewIds
}

function validateDrawingSheets(value: unknown, viewIds: Set<string>, errors: string[]): Set<string> {
  const sheetIds = new Set<string>()
  if (!Array.isArray(value)) return sheetIds
  for (const sheet of value) {
    if (!isRecord(sheet) || typeof sheet.id !== "string" || !sheet.id) {
      errors.push("every drawing sheet needs a stable id")
      continue
    }
    if (sheetIds.has(sheet.id)) errors.push(`duplicate drawing sheet id: ${sheet.id}`)
    sheetIds.add(sheet.id)
    if (typeof sheet.name !== "string") errors.push(`drawing sheet name is invalid: ${sheet.id}`)
    if (!["A4", "A3", "A2", "custom"].includes(String(sheet.paper))) errors.push(`drawing sheet paper is invalid: ${sheet.id}`)
    if (!["portrait", "landscape"].includes(String(sheet.orientation))) errors.push(`drawing sheet orientation is invalid: ${sheet.id}`)
    if (!isFiniteNumber(sheet.scale) || sheet.scale <= 0) errors.push(`drawing sheet scale is invalid: ${sheet.id}`)
    if (!Array.isArray(sheet.viewIds) || sheet.viewIds.some((viewId) => typeof viewId !== "string" || !viewIds.has(viewId))) errors.push(`drawing sheet references missing view: ${sheet.id}`)
  }
  return sheetIds
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
  if (document.measurements !== undefined && !Array.isArray(document.measurements)) errors.push("measurements must be an array")
  if (document.engineeringAnnotations !== undefined && !Array.isArray(document.engineeringAnnotations)) errors.push("engineeringAnnotations must be an array")
  if (document.layers !== undefined && !Array.isArray(document.layers)) errors.push("layers must be an array")
  if (document.drawingViews !== undefined && !Array.isArray(document.drawingViews)) errors.push("drawingViews must be an array")
  if (document.drawingSheets !== undefined && !Array.isArray(document.drawingSheets)) errors.push("drawingSheets must be an array")
  if (!isRecord(document.metadata) || typeof document.metadata.id !== "string" || !document.metadata.id) errors.push("metadata.id is required")
  /**
   * `metadata.name` 也要查：导出路径读 `metadata.name.replace(...)`（文件名），
   * 缺字段的文档之前能通过校验，打开后一点"导出"就抛 TypeError。
   */
  else if (typeof document.metadata.name !== "string" || !document.metadata.name) errors.push("metadata.name is required")

  const layerIds = validateLayers(document.layers, errors)
  const drawingViewIds = validateDrawingViews(document.drawingViews, errors)
  const drawingSheetIds = validateDrawingSheets(document.drawingSheets, drawingViewIds, errors)
  if (document.activeLayerId !== undefined && (typeof document.activeLayerId !== "string" || !layerIds.has(document.activeLayerId))) errors.push("activeLayerId references missing layer")
  if (document.activeSheetId !== undefined && (typeof document.activeSheetId !== "string" || !drawingSheetIds.has(document.activeSheetId))) errors.push("activeSheetId references missing sheet")

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
  /**
   * 参数条目**逐个**校验，而不只是"容器是对象"。
   *
   * 之前只查容器：`parameters: null` 能通过校验，随后 `App.tsx` 渲染时读 `document.parameters.slope`
   * 直接白屏；`{ "area": { id: "other", … } }` 让按 key 的查找/删除找不到条目，编辑静默丢失；
   * `value: "3"` 一路传进几何计算变成 NaN，而这样的文档再也存不回去（编码时校验失败）。
   */
  const parameterIds = new Set<string>()
  if (isRecord(document.parameters)) {
    for (const [key, parameter] of Object.entries(document.parameters)) {
      if (!isRecord(parameter)) {
        errors.push(`parameter must be an object: ${key}`)
        continue
      }
      parameterIds.add(key)
      if (parameter.id !== key) errors.push(`parameter id must match its key: ${key}`)
      if (!isFiniteNumber(parameter.value)) errors.push(`parameter value must be a finite number: ${key}`)
      if (parameter.expression !== undefined && typeof parameter.expression !== "string") errors.push(`parameter expression must be a string: ${key}`)
      if (parameter.min !== undefined && !isFiniteNumber(parameter.min)) errors.push(`parameter min must be a finite number: ${key}`)
      if (parameter.max !== undefined && !isFiniteNumber(parameter.max)) errors.push(`parameter max must be a finite number: ${key}`)
      if (parameter.step !== undefined && (!isFiniteNumber(parameter.step) || parameter.step <= 0)) errors.push(`parameter step must be a positive finite number: ${key}`)
      if (parameter.label !== undefined && typeof parameter.label !== "string") errors.push(`parameter label must be a string: ${key}`)
      if (parameter.ownerId !== undefined && typeof parameter.ownerId !== "string") errors.push(`parameter ownerId must be a string: ${key}`)
    }
  }
  for (const primitive of primitives) {
    if (isRecord(primitive) && primitive.layerId !== undefined && (typeof primitive.layerId !== "string" || !layerIds.has(primitive.layerId))) errors.push(`primitive layer is missing: ${isRecord(primitive) && typeof primitive.id === "string" ? primitive.id : "unknown"}`)
    errors.push(...validatePrimitive(primitive, primitiveById, parameterIds))
  }

  if (Array.isArray(document.annotations)) {
    const annotationIds = new Set<string>()
    for (const annotation of document.annotations) {
      if (isRecord(annotation) && typeof annotation.id === "string") {
        if (annotationIds.has(annotation.id)) errors.push(`duplicate annotation id: ${annotation.id}`)
        annotationIds.add(annotation.id)
      }
      errors.push(...validateAnnotation(annotation, primitiveById))
    }
  }

  if (Array.isArray(document.engineeringAnnotations)) {
    const engineeringAnnotationIds = new Set<string>()
    for (const annotation of document.engineeringAnnotations) {
      if (!isRecord(annotation) || typeof annotation.id !== "string") {
        errors.push("every engineering annotation needs a stable id")
        continue
      }
      if (engineeringAnnotationIds.has(annotation.id)) errors.push(`duplicate engineering annotation id: ${annotation.id}`)
      engineeringAnnotationIds.add(annotation.id)
      if (!["linear", "angular", "tolerance", "fillet", "chamfer"].includes(String(annotation.kind))) errors.push(`engineering annotation kind is invalid: ${annotation.id}`)
      if (!Array.isArray(annotation.sourceIds) || annotation.sourceIds.length === 0 || annotation.sourceIds.some((sourceId) => typeof sourceId !== "string" || !primitiveIds.has(sourceId))) errors.push(`engineering annotation has invalid sources: ${annotation.id}`)
      if (!["front", "top", "left", "axonometric"].includes(String(annotation.view))) errors.push(`engineering annotation view is invalid: ${annotation.id}`)
      if (annotation.value !== undefined && !isFiniteNumber(annotation.value)) errors.push(`engineering annotation value is invalid: ${annotation.id}`)
      if (annotation.unit !== undefined && typeof annotation.unit !== "string") errors.push(`engineering annotation unit is invalid: ${annotation.id}`)
      if (annotation.tolerance !== undefined && (!isRecord(annotation.tolerance) || !isFiniteNumber(annotation.tolerance.upper) || !isFiniteNumber(annotation.tolerance.lower))) errors.push(`engineering annotation tolerance is invalid: ${annotation.id}`)
      if (!["valid", "degenerate", "insufficient-data"].includes(String(annotation.status))) errors.push(`engineering annotation status is invalid: ${annotation.id}`)
      if (typeof annotation.explanation !== "string") errors.push(`engineering annotation explanation is invalid: ${annotation.id}`)
    }
  }

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
      const type = String(constraint.type)
      const validConstraintTypes = ["parallel", "perpendicular", "coincident", "pointOnLine", "pointOnPlane", "collinear", "coplanar", "fixedDistance"]
      if (!validConstraintTypes.includes(type)) errors.push(`invalid constraint type: ${constraint.id}`)
      const targetCount = type === "collinear" ? 3 : type === "coplanar" ? 4 : 2
      if (!Array.isArray(constraint.targets) || constraint.targets.length !== targetCount || constraint.targets.some((target) => typeof target !== "string" || !primitiveIds.has(target)) || new Set(constraint.targets).size !== constraint.targets.length) errors.push(`constraint has invalid targets: ${constraint.id}`)
      const targetTypes = Array.isArray(constraint.targets) ? constraint.targets.map((target) => referenceType(primitiveById, target)) : []
      const lineTypes = new Set(["line", "line3", "segment3", "ray3", "edge3"])
      if ((type === "parallel" || type === "perpendicular" || type === "coincident") && targetTypes.some((target) => !lineTypes.has(target ?? ""))) errors.push(`constraint requires two lines: ${constraint.id}`)
      if (type === "pointOnLine" && (targetTypes[0] !== "point3" || !lineTypes.has(targetTypes[1] ?? ""))) errors.push(`pointOnLine requires a point and line: ${constraint.id}`)
      if (type === "pointOnPlane" && (targetTypes[0] !== "point3" || targetTypes[1] !== "plane3")) errors.push(`pointOnPlane requires a point and plane: ${constraint.id}`)
      if ((type === "collinear" || type === "coplanar") && targetTypes.some((target) => target !== "point3")) errors.push(`constraint requires spatial points: ${constraint.id}`)
      if (type === "fixedDistance" && (targetTypes.some((target) => target !== "point3") || typeof constraint.value !== "number" || !Number.isFinite(constraint.value) || constraint.value < 0)) errors.push(`fixedDistance requires two points and a non-negative value: ${constraint.id}`)
      if (constraint.value !== undefined && (typeof constraint.value !== "number" || !Number.isFinite(constraint.value) || constraint.value < 0)) errors.push(`constraint value is invalid: ${constraint.id}`)
      if (constraint.tolerance !== undefined && (typeof constraint.tolerance !== "number" || !Number.isFinite(constraint.tolerance) || constraint.tolerance <= 0)) errors.push(`constraint tolerance is invalid: ${constraint.id}`)
    }
  }
  if (Array.isArray(document.measurements)) {
    const measurementIds = new Set<string>()
    for (const measurement of document.measurements) {
      if (!isRecord(measurement) || typeof measurement.id !== "string" || measurement.kind !== "measurement3") { errors.push("measurement is invalid"); continue }
      if (measurementIds.has(measurement.id)) errors.push(`duplicate measurement id: ${measurement.id}`)
      measurementIds.add(measurement.id)
      if (!Array.isArray(measurement.sourceIds) || measurement.sourceIds.length === 0 || measurement.sourceIds.some((sourceId) => typeof sourceId !== "string" || !primitiveIds.has(sourceId))) errors.push(`measurement has invalid sources: ${measurement.id}`)
      if (!["length", "angle", "area", "volume", "distance", "dihedral"].includes(String(measurement.metric))) errors.push(`measurement metric is invalid: ${measurement.id}`)
      if (measurement.dihedralKind !== undefined && !["interior", "exterior"].includes(String(measurement.dihedralKind))) errors.push(`measurement dihedral kind is invalid: ${measurement.id}`)
      if (!["exact-input", "numeric-approximation"].includes(String(measurement.precision))) errors.push(`measurement precision is invalid: ${measurement.id}`)
      if (!["valid", "degenerate", "insufficient-data", "numeric-failure"].includes(String(measurement.status))) errors.push(`measurement status is invalid: ${measurement.id}`)
      if (typeof measurement.explanation !== "string") errors.push(`measurement explanation is invalid: ${measurement.id}`)
      if (measurement.value !== undefined && !Number.isFinite(measurement.value)) errors.push(`measurement value is invalid: ${measurement.id}`)
    }
  }
  return errors.length ? { valid: false, errors } : { valid: true }
}
