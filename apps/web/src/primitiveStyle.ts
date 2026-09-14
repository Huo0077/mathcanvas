import type { PrimitiveSpec } from "@draw/dsl"

const defaultStrokes: Record<PrimitiveSpec["type"], string> = {
  point: "#3d5afe",
  line: "#172033",
  segment: "#0b7285",
  ray: "#7c3aed",
  polyline: "#b45309",
  connection: "#2563eb",
  locus: "#7c3aed",
  parabola: "#db2777",
  ellipse: "#0891b2",
  hyperbola: "#9333ea",
  function: "#16a34a",
  derivative: "#0f766e",
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

export function strokeWidthFor(primitive: PrimitiveSpec, selected: boolean): number {
  return primitive.style?.strokeWidth ?? (selected ? 5 : 3)
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
