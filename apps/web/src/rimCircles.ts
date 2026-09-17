/**
 * 圆类实体的**边界圆**：圆柱的上下底圆、圆锥的底圆。
 *
 * 用户口径："我不要一个逼近的圆，我需要一个真的圆。" 48 段近似下这些圆是 96 段折线
 *（弦高偏差 `R(1 − cos(π/48)) = 0.002141·R`，屏幕半径超过约 467px 就看出棱），
 * 现在改由解析圆按屏幕误差细分来画——多边形环棱仍留在文档里（列表、拾取、面片要用），
 * 只是画布上不再逐段画那些弦。
 */
import type { Conic3, GeometryDocument, Vector3 } from "@draw/dsl"
import { rimCircles3 } from "@draw/geometry-kernel"

export interface SolidRimCircles {
  id: string
  circles: Conic3[]
}

/** 文档里每个圆柱 / 圆锥的边界圆（按文档顺序；没有边界圆的实体不出现）。 */
export function collectRimCircles(document: GeometryDocument): SolidRimCircles[] {
  return document.primitives
    .filter((primitive) => primitive.type === "cylinder" || primitive.type === "cone")
    .map((primitive) => ({ id: primitive.id, circles: rimCircles3(primitive) }))
    .filter((entry) => entry.circles.length > 0)
}

/** 点是否落在某个边界圆上（轴向偏移与半径都按相对容差判，避免绝对阈值在大/小模型上失效）。 */
function onRim(circle: Conic3, point: Vector3): boolean {
  const center = circle.center
  const radius = circle.semiMajor
  if (!center || radius === undefined || !(radius > 0)) return false
  const normal = circle.frame.normal
  const offset = { x: point.x - center.x, y: point.y - center.y, z: point.z - center.z }
  const axial = offset.x * normal.x + offset.y * normal.y + offset.z * normal.z
  const radial = Math.hypot(offset.x - axial * normal.x, offset.y - axial * normal.y, offset.z - axial * normal.z)
  const tolerance = radius * 1e-9
  return Math.abs(axial) <= tolerance && Math.abs(radial - radius) <= tolerance
}

/**
 * 落在边界圆上的**可见棱**（也就是那些弦）的 id。
 *
 * 画布用解析圆画这两圈，所以这些弦不再逐段画；它们仍可被选中——选中时照旧画出来（见 `threeScene`）。
 * 只认"两个端点落在**同一个**边界圆上"的棱：连接上下底的母线因此不在集合里（它们本来也已经是
 * `tessellation` 的内部拓扑）。
 */
export function rimChordEdgeIds(document: GeometryDocument): Set<string> {
  const ids = new Set<string>()
  const circles = collectRimCircles(document).flatMap((entry) => entry.circles)
  if (circles.length === 0) return ids
  const points = new Map<string, Vector3>()
  document.primitives.forEach((primitive) => {
    if (primitive.type === "point3") points.set(primitive.id, primitive.position)
  })
  for (const primitive of document.primitives) {
    if (primitive.type !== "edge3" || primitive.tessellation === true) continue
    const first = points.get(primitive.pointIds[0])
    const second = points.get(primitive.pointIds[1])
    if (!first || !second) continue
    if (circles.some((circle) => onRim(circle, first) && onRim(circle, second))) ids.add(primitive.id)
  }
  return ids
}
