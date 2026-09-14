import type { ConstraintType, Measurement3Metric, PrimitiveSpec, Workspace } from "@draw/dsl"

/** Selection gating for spatial tools. Kept pure so the rules stay unit-testable and match the kernel's real
 * capabilities: every option offered here must be evaluable by `@draw/geometry-kernel`. */
const LINE_LIKE = ["line3", "segment3", "ray3", "edge3"]
const SOLID_LIKE = ["polyhedron3", "cube", "pyramid", "cylinder", "cone"]

export interface MeasurementOption { metric: Measurement3Metric; label: string; dihedralKind?: "interior" | "exterior" }
export interface ConstraintOption { type: ConstraintType; label: string; targets: string[] }

const isLineLike = (primitive: PrimitiveSpec) => LINE_LIKE.includes(primitive.type)
const isPoint3 = (primitive: PrimitiveSpec) => primitive.type === "point3"
const isPlane3 = (primitive: PrimitiveSpec) => primitive.type === "plane3"
const isFace3 = (primitive: PrimitiveSpec) => primitive.type === "face3"
const isCircle3 = (primitive: PrimitiveSpec) => primitive.type === "circle3"
const isSolidLike = (primitive: PrimitiveSpec) => SOLID_LIKE.includes(primitive.type)
const everyIs = (selection: PrimitiveSpec[], predicate: (primitive: PrimitiveSpec) => boolean) => selection.length > 0 && selection.every(predicate)

export function measurementOptionsFor(workspace: Workspace, selection: PrimitiveSpec[]): MeasurementOption[] {
  if (workspace !== "geometry3d") return []
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
