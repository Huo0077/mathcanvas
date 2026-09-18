import type { PrimitiveSpec } from "@draw/dsl"

const defaultStrokes: Record<PrimitiveSpec["type"], string> = {
  point: "#3d5afe",
  point3: "#1d4ed8",
  line: "#172033",
  line3: "#1e3a8a",
  segment: "#0b7285",
  segment3: "#0e7490",
  ray: "#7c3aed",
  ray3: "#6d28d9",
  polyline: "#b45309",
  connection: "#2563eb",
  locus: "#7c3aed",
  parabola: "#db2777",
  ellipse: "#0891b2",
  hyperbola: "#9333ea",
  function: "#16a34a",
  derivative: "#0f766e",
  tangent: "#2563eb",
  normal: "#7c3aed",
  secant: "#b45309",
  integral: "#dc2626",
  analysisSet: "#9333ea",
  cube: "#2563eb",
  pyramid: "#db2777",
  cylinder: "#0891b2",
  cone: "#f97316",
  plane3: "#2563eb",
  circle3: "#0f766e",
  edge3: "#0891b2",
  face3: "#f59e0b",
  polyhedron3: "#9333ea",
  section: "#f97316",
  intersectionLine: "#f04f5f",
  intersectionSolid: "#d92b3a",
  intersectionFace: "#e0453f",
  intersectionPoint3: "#b91c1c",
  circle: "#0f8a63",
  arc: "#f08a24",
  intersection: "#f04f5f",
  lineCircleIntersection: "#f04f5f",
  circleIntersection: "#f04f5f",
  curveIntersection: "#f04f5f",
  intersectionSet: "#f04f5f"
}

export function defaultStrokeFor(primitive: PrimitiveSpec): string {
  return defaultStrokes[primitive.type]
}

export function strokeFor(primitive: PrimitiveSpec): string {
  return primitive.style?.stroke ?? defaultStrokeFor(primitive)
}

export function fillFor(primitive: PrimitiveSpec): string {
  return primitive.style?.fill ?? (primitive.type === "point" || primitive.type.endsWith("Intersection") || primitive.type === "intersection" ? strokeFor(primitive) : "none")
}

/**
 * 平面画布上图元的默认线宽。
 *
 * 用户反馈（第二轮）："平面画布中的线都太粗了"。原来是 `选中 5 / 未选中 3`（px），
 * 与 1px 的网格线放在一起时，图形像用马克笔画的、网格像草稿纸，主次关系也不对。
 * 现在收到 `2.5 / 1.5`：仍然明显比网格（1px）重，但不再压掉图形本身的结构
 * （圆锥曲线的两支、切线贴曲线的位置都更容易看清）。
 *
 * 这里同时管着 SVG 导出（`svgStyleFor`），所以导出的图与屏幕是一致的。
 * 用户显式设过 `style.strokeWidth` 的对象不受影响 —— 自定义永远优先。
 */
export function strokeWidthFor(primitive: PrimitiveSpec, selected: boolean): number {
  return primitive.style?.strokeWidth ?? (selected ? 2.5 : 1.5)
}

export function opacityFor(primitive: PrimitiveSpec): number {
  return primitive.style?.opacity ?? 1
}

export function dashFor(primitive: PrimitiveSpec): string | undefined {
  return primitive.style?.dash
}

export function svgStyleFor(primitive: PrimitiveSpec, selected = false, fill = "none"): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  const dash = dashFor(primitive)
  return `fill="${escape(fill === "none" ? fillFor(primitive) : fill)}" stroke="${escape(strokeFor(primitive))}" stroke-width="${strokeWidthFor(primitive, selected)}" opacity="${opacityFor(primitive)}"${dash ? ` stroke-dasharray="${escape(dash)}"` : ""}`
}
