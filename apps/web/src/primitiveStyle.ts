import type { PrimitiveSpec } from "@draw/dsl"

/**
 * 画布内文字（点名 P1、直线名 l1、圆心名 c1、交点读数）的墨色。
 *
 * 刻意**导出常量**而不是只用 CSS 变量：`.svg` / `.png` 导出是一份**独立文件**，
 * 没有 `:root` 令牌可继承，写 `var(--color-drawing-ink)` 导出出去会变成"没有颜色"。
 * 所以这里是一个真值来源，CSS 侧的同名令牌（`--color-drawing-ink`）只是给画布上的
 * 其它文字元素用，两者取值必须一致。
 */
export const DRAWING_INK = "#2c3e50"

const defaultStrokes: Record<PrimitiveSpec["type"], string> = {
  // 平面几何的"基本图形"按用户口径定色（2026-09-18 视觉重构）：
  // **直线用深红褐色，圆用板岩蓝**，点用更重的板岩蓝以便在三者里最跳。
  // 其余圆锥曲线 / 函数 / 派生曲线保持各自的冷色族（免得"克制的色彩"变成一片灰）。
  point: "#2f4a68",
  point3: "#1d4ed8",
  line: "#8a4b3c",
  line3: "#1e3a8a",
  segment: "#5a6b7d",
  segment3: "#0e7490",
  ray: "#7b5e57",
  ray3: "#6d28d9",
  polyline: "#7a6a5d",
  connection: "#3d5a80",
  locus: "#6c5f8a",
  parabola: "#a8486b",
  ellipse: "#3d6b7d",
  hyperbola: "#6b4f8a",
  function: "#3f7d5c",
  derivative: "#2f6f68",
  tangent: "#4a6b8a",
  normal: "#6c5f8a",
  secant: "#7a6a5d",
  integral: "#a8453f",
  analysisSet: "#6b4f8a",
  cube: "#3d5a80",
  pyramid: "#a8486b",
  cylinder: "#3d6b7d",
  cone: "#b06a3a",
  plane3: "#3d5a80",
  circle3: "#2f6f68",
  edge3: "#3d6b7d",
  face3: "#b5853f",
  polyhedron3: "#6b4f8a",
  section: "#b06a3a",
  intersectionLine: "#b2544f",
  intersectionSolid: "#9e3b3b",
  intersectionFace: "#a8483f",
  intersectionPoint3: "#8f3030",
  // 圆 = 板岩蓝（用户口径）。
  circle: "#3d5a80",
  arc: "#b07a3a",
  intersection: "#b2544f",
  lineCircleIntersection: "#b2544f",
  circleIntersection: "#b2544f",
  curveIntersection: "#b2544f",
  intersectionSet: "#b2544f"
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
