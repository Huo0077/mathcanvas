import type { GeometryDocument, Measurement3, PrimitiveSpec, Vector3 } from "@draw/dsl"
import { resolveDihedralMarker3 } from "@draw/scene-graph"

export interface MeasurementVisual {
  id: string
  kind: "label" | "dihedral"
  sourceIds: string[]
  label: string
  position: Vector3
  segments: Array<{ start: Vector3; end: Vector3 }>
  arc?: Vector3[]
}

function midpoint(first: Vector3, second: Vector3): Vector3 {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2, z: (first.z + second.z) / 2 }
}

function average(points: Vector3[]): Vector3 {
  return points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length, z: sum.z + point.z / points.length }), { x: 0, y: 0, z: 0 })
}

function pointPositions(document: GeometryDocument, primitive: PrimitiveSpec): Vector3[] {
  const primitives = new Map(document.primitives.map((candidate) => [candidate.id, candidate]))
  if (primitive.type === "point3") return [primitive.position]
  if (primitive.type === "line3") {
    const ids = primitive.definition.kind === "throughPoints" ? primitive.definition.pointIds : [primitive.definition.pointId]
    const points = ids.map((id) => primitives.get(id)).filter((candidate): candidate is Extract<PrimitiveSpec, { type: "point3" }> => candidate?.type === "point3").map((point) => point.position)
    if (primitive.definition.kind === "pointDirection" && points.length === 1) points.push({ x: points[0].x + primitive.definition.direction.x, y: points[0].y + primitive.definition.direction.y, z: points[0].z + primitive.definition.direction.z })
    return points
  }
  if (primitive.type === "segment3" || primitive.type === "edge3") return primitive.pointIds.map((id) => primitives.get(id)).filter((candidate): candidate is Extract<PrimitiveSpec, { type: "point3" }> => candidate?.type === "point3").map((point) => point.position)
  if (primitive.type === "ray3") return [primitive.originId, primitive.throughId].map((id) => primitives.get(id)).filter((candidate): candidate is Extract<PrimitiveSpec, { type: "point3" }> => candidate?.type === "point3").map((point) => point.position)
  if (primitive.type === "face3") return primitive.pointIds.map((id) => primitives.get(id)).filter((candidate): candidate is Extract<PrimitiveSpec, { type: "point3" }> => candidate?.type === "point3").map((point) => point.position)
  if (primitive.type === "plane3" && primitive.definition.kind === "throughPoints") return primitive.definition.pointIds.map((id) => primitives.get(id)).filter((candidate): candidate is Extract<PrimitiveSpec, { type: "point3" }> => candidate?.type === "point3").map((point) => point.position)
  if (primitive.type === "cube") return [{ x: primitive.origin.x + primitive.size.x / 2, y: primitive.origin.y + primitive.size.y / 2, z: primitive.origin.z + primitive.size.z / 2 }]
  if (primitive.type === "pyramid") return [primitive.baseCenter]
  if (primitive.type === "cylinder" || primitive.type === "cone") return [primitive.center]
  return []
}

function measurementLabel(measurement: Measurement3): string {
  const names: Record<Measurement3["metric"], string> = { length: "长度", distance: "距离", angle: "角度", area: "面积", volume: "体积", dihedral: measurement.dihedralKind === "exterior" ? "二面角外角" : "二面角内角" }
  return `${names[measurement.metric]}：${measurement.value?.toFixed(3) ?? "—"}${measurement.unit ?? ""}`
}

export function resolveMeasurementVisual(document: GeometryDocument, measurementId: string): MeasurementVisual | null {
  const measurement = document.measurements.find((candidate) => candidate.id === measurementId)
  if (!measurement || measurement.status !== "valid" || measurement.value === undefined || !Number.isFinite(measurement.value)) return null
  if (measurement.metric === "dihedral") {
    const marker = resolveDihedralMarker3(document, measurement.id)
    if (!marker || marker.arc.length < 2) return null
    const arcMidpoint = marker.arc[Math.floor(marker.arc.length / 2)]
    return { id: measurement.id, kind: "dihedral", sourceIds: [...measurement.sourceIds], label: measurementLabel(measurement), position: arcMidpoint, segments: [{ start: marker.hingeStart, end: marker.hingeEnd }, marker.firstNormal, marker.secondNormal], arc: marker.arc }
  }
  const sourcePositions = measurement.sourceIds.flatMap((sourceId) => {
    const primitive = document.primitives.find((candidate) => candidate.id === sourceId)
    return primitive ? pointPositions(document, primitive) : []
  })
  if (sourcePositions.length === 0) return null
  const segments = sourcePositions.length === 2 ? [{ start: sourcePositions[0], end: sourcePositions[1] }] : []
  return { id: measurement.id, kind: "label", sourceIds: [...measurement.sourceIds], label: measurementLabel(measurement), position: average(sourcePositions), segments }
}

export function measurementLabelScale(cameraDistance: number, viewportHeight: number): number {
  if (!Number.isFinite(cameraDistance) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0.35
  return Math.min(2, Math.max(0.35, cameraDistance / viewportHeight * 12))
}

/**
 * 画布上**常驻**的测量数字：不再要求"来源被选中"。
 *
 * 用户口径："我希望数学测量的结果能在图中浮现一个数字，而不是非要去看右侧属性栏（这一点无论是平面几何
 * 还是立体几何都要优化）。" "不画假数字"这条规则在 `resolveMeasurementVisual` 那一层（退化 / 值非有限
 * 一律 `null`），所以这里不再额外过滤——**没有选中任何对象时也照画**。
 * 辅助线段与二面角标记仍按选中显示（见 `threeScene.tsx`：那是引导线，几十条一起铺会把画布刷满）。
 */
export function measurementVisualsForDocument(document: GeometryDocument): MeasurementVisual[] {
  return document.measurements
    .map((measurement) => resolveMeasurementVisual(document, measurement.id))
    .filter((visual): visual is MeasurementVisual => visual !== null)
}

export function measurementSegmentMidpoint(segment: { start: Vector3; end: Vector3 }): Vector3 {
  return midpoint(segment.start, segment.end)
}
