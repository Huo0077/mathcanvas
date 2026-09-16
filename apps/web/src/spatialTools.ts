import type { ConstraintType, Measurement3Metric, PrimitiveSpec, Workspace } from "@draw/dsl"

/** Selection gating for spatial tools. Kept pure so the rules stay unit-testable and match the kernel's real
 * capabilities: every option offered here must be evaluable by `@draw/geometry-kernel`. */
const LINE_LIKE = ["line3", "segment3", "ray3", "edge3"]
const SOLID_LIKE = ["polyhedron3", "cube", "pyramid", "cylinder", "cone"]

export interface MeasurementOption { metric: Measurement3Metric; label: string; dihedralKind?: "interior" | "exterior" }
export interface ConstraintOption { type: ConstraintType; label: string; targets: string[] }

const isLineLike = (primitive: PrimitiveSpec) => LINE_LIKE.includes(primitive.type)
const isPoint = (primitive: PrimitiveSpec) => primitive.type === "point"
const isPoint3 = (primitive: PrimitiveSpec) => primitive.type === "point3"
const isPlane3 = (primitive: PrimitiveSpec) => primitive.type === "plane3"
const isFace3 = (primitive: PrimitiveSpec) => primitive.type === "face3"
const isCircle3 = (primitive: PrimitiveSpec) => primitive.type === "circle3"
const isSolidLike = (primitive: PrimitiveSpec) => SOLID_LIKE.includes(primitive.type)
const everyIs = (selection: PrimitiveSpec[], predicate: (primitive: PrimitiveSpec) => boolean) => selection.length > 0 && selection.every(predicate)

/**
 * 平面（2D）测量选项。只提供内核 `evaluatePlanarMeasurement` 真能算出来的组合 ——
 * 这里给出的每一个按钮都必须有对应的求值路径，否则就是一个点了没反应的死按钮。
 *
 * 角的顶点约定：`sourceIds` 的第 2 个（下标 1）是顶点，所以提示里写明"按 Shift 选择时先点边上一点"。
 * 距离取"第 3 个点到前两点确定的直线"的垂距。
 */
function planarMeasurementOptions(selection: PrimitiveSpec[]): MeasurementOption[] {
  const points = selection.filter(isPoint)
  const allPoints = points.length === selection.length
  const options: MeasurementOption[] = []
  if (selection.length === 2 && allPoints) options.push({ metric: "length", label: "长度" })
  if (selection.length === 3 && allPoints) {
    options.push(
      { metric: "angle", label: "角度（第二个点作顶点）", dihedralKind: "interior" },
      { metric: "area", label: "面积" },
      { metric: "distance", label: "距离（第三个点到前两点的直线）" }
    )
  }
  return options
}

export function measurementOptionsFor(workspace: Workspace, selection: PrimitiveSpec[]): MeasurementOption[] {
  if (workspace !== "geometry3d") return planarMeasurementOptions(selection)
  const lineCount = selection.filter(isLineLike).length
  const pointCount = selection.filter(isPoint3).length
  const options: MeasurementOption[] = []
  if ((selection.length === 1 && lineCount === 1) || (selection.length === 2 && pointCount === 2)) options.push({ metric: "length", label: "长度" })
  if (selection.length === 2 && (pointCount === 2 || (pointCount === 1 && selection.some((primitive) => isLineLike(primitive) || isPlane3(primitive))))) options.push({ metric: "distance", label: "距离" })
  if ((selection.length === 2 && lineCount === 2) || (selection.length === 3 && pointCount === 3)) options.push({ metric: "angle", label: "角度" })
  if ((selection.length === 1 && (isFace3(selection[0]) || isCircle3(selection[0]))) || (selection.length >= 3 && pointCount === selection.length)) options.push({ metric: "area", label: "面积" })
  if (selection.length === 1 && isSolidLike(selection[0])) options.push({ metric: "volume", label: "体积" })
  if (selection.length === 2 && everyIs(selection, isFace3)) options.push({ metric: "dihedral", label: "二面角内角", dihedralKind: "interior" }, { metric: "dihedral", label: "二面角外角", dihedralKind: "exterior" })
  return options
}

export interface Point3ToolAvailability { line: boolean; plane: boolean; face: boolean }

/**
 * What the three "由选中点创建…" tools can do right now. The selection has to be spatial points and nothing
 * else: a face picked alongside two points used to look like "two points" and fail with a confusing message.
 */
export function point3ToolAvailability(point3Count: number, selectionSize: number): Point3ToolAvailability {
  const pointsOnly = point3Count > 0 && point3Count === selectionSize
  return { line: pointsOnly && point3Count === 2, plane: pointsOnly && point3Count === 3, face: pointsOnly && point3Count >= 3 }
}

/** Plain-language guidance shown in the toolbar: the tools need Shift-clicked points and nothing said so before. */
export function point3ToolHint(point3Count: number, selectionSize = point3Count): string {
  if (point3Count > 0 && selectionSize !== point3Count) return `选中 ${selectionSize} 项，其中只有 ${point3Count} 个是空间点：请只保留空间点后再创建`
  if (point3Count === 0) return "按住 Shift 依次点选空间点：选 2 个建直线，选 3 个建平面，选 3 个以上建空间面"
  if (point3Count === 1) return "已选 1 个空间点：再选 1 个就能创建直线"
  if (point3Count === 2) return "已选 2 个空间点：现在可以创建直线"
  return `已选 ${point3Count} 个空间点：现在可以创建平面和空间面`
}

export function constraintOptionsFor(workspace: Workspace, selection: PrimitiveSpec[]): ConstraintOption[] {
  if (workspace !== "geometry3d") return []
  const ids = selection.map((primitive) => primitive.id)
  const lineCount = selection.filter(isLineLike).length
  const pointCount = selection.filter(isPoint3).length
  const point = selection.find(isPoint3)
  const line = selection.find(isLineLike)
  const plane = selection.find(isPlane3)
  const options: ConstraintOption[] = []
  if (selection.length === 2 && lineCount === 2) options.push({ type: "parallel", label: "平行", targets: ids }, { type: "perpendicular", label: "垂直", targets: ids })
  // Point-anchored constraints are click-order independent: the point always comes first for the patch boundary.
  if (selection.length === 2 && point && line) options.push({ type: "pointOnLine", label: "点在线", targets: [point.id, line.id] })
  if (selection.length === 2 && point && plane) options.push({ type: "pointOnPlane", label: "点在面", targets: [point.id, plane.id] })
  if (selection.length === 3 && pointCount === 3) options.push({ type: "collinear", label: "共线", targets: ids })
  if (selection.length === 4 && pointCount === 4) options.push({ type: "coplanar", label: "共面", targets: ids })
  return options
}
