import type { PrimitiveSpec } from "@draw/dsl"

/**
 * 平面几何的**预设调色板**。
 *
 * 用户反馈："增加让平面几何的元素可以让用户选择不同颜色的功能" —— 功能本来就在（检查器里的原生取色框），
 * 但一个窄窄的原生控件既看不出"这里有颜色可选"，也点不出一个想要的颜色。把常用色摊开成可点的色板，
 * 是"让功能明显一些"最直接的做法。
 *
 * 顺序按使用频率排：黑 / 蓝 / 青绿（默认那几种）在前，教学常用的红、橙、紫在后。
 * 颜色取值与 `defaultStrokes` 保持同一族色相，换色时不会突然跳到另一种审美。
 */
export interface PaletteColour {
  value: string
  label: string
}

export const PLANAR_PALETTE: PaletteColour[] = [
  { value: "#172033", label: "墨黑" },
  { value: "#2563eb", label: "蓝" },
  { value: "#0f8a63", label: "青绿" },
  { value: "#0891b2", label: "青" },
  { value: "#7c3aed", label: "紫" },
  { value: "#db2777", label: "品红" },
  { value: "#dc2626", label: "红" },
  { value: "#f08a24", label: "橙" },
  { value: "#b45309", label: "棕" },
  { value: "#16a34a", label: "绿" }
]

/**
 * 填充色板：比线条少两个（填充是面，太相近的色相在浅色底上分不出来），并且**多一个"无填充"**。
 *
 * "无填充"是真实需求：圆 / 椭圆默认不填充，用户改成填充后再想回到空心，之前只能手动改颜色，
 * 现在有一个明确的出口。
 */
export const NO_FILL = "none"

export const FILL_PALETTE: PaletteColour[] = [
  { value: NO_FILL, label: "无填充" },
  { value: "#ffffff", label: "白" },
  { value: "#e8eefc", label: "淡蓝" },
  { value: "#e6f4ef", label: "淡青" },
  { value: "#fdeef4", label: "淡粉" },
  { value: "#fdf4e3", label: "淡黄" },
  { value: "#efeafd", label: "淡紫" },
  { value: "#2563eb", label: "蓝" },
  { value: "#0f8a63", label: "青绿" },
  { value: "#dc2626", label: "红" }
]

/** 规范成小写：浏览器把 `<input type="color">` 的值统一成小写，比较时两边要一致。 */
export function normalizeColour(value: string | undefined): string | undefined {
  return value?.toLowerCase()
}

/**
 * 当前值在色板里的哪一项；不在色板里（用户用自定义取色器挑的）时返回 `undefined`。
 * 界面据此决定"没有预设被选中"，而不是硬把最接近的一格点亮。
 */
export function paletteValueOf(palette: readonly PaletteColour[], value: string | undefined, fallback: string): string | undefined {
  const current = normalizeColour(value ?? fallback)
  return palette.find((entry) => normalizeColour(entry.value) === current)?.value
}

/** 这一格是不是当前值。 */
export function isActiveColour(entry: string, value: string | undefined, fallback: string): boolean {
  return normalizeColour(entry) === normalizeColour(value ?? fallback)
}

/**
 * 哪些图元有"填充"这一说。
 *
 * 点与交点的填充**恒等于自身线条色**（见 `fillFor`），给它们一个独立的填充色没有意义；
 * 其余闭合图形与面都有内外之分，可以填。
 */
const fillableTypes = new Set<PrimitiveSpec["type"]>([
  "circle", "ellipse", "parabola", "hyperbola", "function", "integral",
  "face3", "plane3", "polyhedron3", "section",
  "intersectionFace", "intersectionSolid", "cube", "pyramid", "cylinder", "cone"
])

export function supportsFill(primitive: PrimitiveSpec): boolean {
  return fillableTypes.has(primitive.type)
}
