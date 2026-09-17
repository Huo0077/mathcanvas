/**
 * 解析圆锥曲线的**读数**：把 `Conic3` 的规范数据翻成"标签 + 数值"的行，检查器直接渲染。
 *
 * 抽成纯函数的理由：圆锥曲线的读数规则（圆只报半径、椭圆报长短半轴与离心率、抛物线报焦点与准距…）
 * 值得被单测钉住，而检查器组件本身不适合跑这些断言。用户口径："我需要一个真的圆"——
 * 那就要能看见"它确实是圆（离心率 0）"，而不是只能数折线点数。
 */
import type { Conic3, Conic3Kind, CurvePiece3, PrimitiveSpec } from "@draw/dsl"
import { conic3Area, conic3Perimeter } from "@draw/geometry-kernel"

export interface ConicMetricRow {
  label: string
  value: string
}

const kindLabels: Record<Conic3Kind, string> = {
  circle: "圆",
  ellipse: "椭圆",
  parabola: "抛物线",
  hyperbola: "双曲线",
  line: "一条直线",
  lines: "两条直线",
  point: "一点",
  empty: "空集（平面没切到实体）",
  "insufficient-data": "数据不足"
}

export function conicKindLabel(kind: Conic3Kind): string {
  return kindLabels[kind] ?? kind
}

/** 截面解析边界里的那条圆锥曲线：边界可能由"曲线弧 + 端面弦"拼成，取第一段曲线。 */
export function exactConicOf(section: Extract<PrimitiveSpec, { type: "section" }>): Conic3 | null {
  const exact = section.exact
  if (!exact) return null
  for (const loop of exact.loops as CurvePiece3[][]) {
    for (const piece of loop) if (piece.kind === "conic") return piece.conic
  }
  return null
}

/**
 * **没被端面裁切**的整条闭合圆锥曲线（唯一的片段、参数域恰好 `2π`、圆或椭圆）。
 *
 * 只有这种情形面积/周长才有解析闭式：斜切到端面的截面是"椭圆弧 + 端面弦"围成的区域，
 * 它的面积不是 `πab`——照抄 `πab` 就是一个看着有效、其实错的读数。
 */
export function fullClosedConicOf(section: Extract<PrimitiveSpec, { type: "section" }>): Conic3 | null {
  const exact = section.exact
  if (!exact || exact.loops.length !== 1) return null
  const loop = exact.loops[0]
  if (loop.length !== 1) return null
  const piece = loop[0]
  if (piece.kind !== "conic") return null
  if (piece.conic.kind !== "circle" && piece.conic.kind !== "ellipse") return null
  const span = Math.abs(piece.parameterRange[1] - piece.parameterRange[0])
  return Math.abs(span - Math.PI * 2) <= 1e-9 ? piece.conic : null
}

const formatPoint = (point: { x: number; y: number; z: number }) => `(${point.x.toFixed(3)}, ${point.y.toFixed(3)}, ${point.z.toFixed(3)})`
const formatNumber = (value: number) => value.toFixed(3)

/**
 * 圆锥曲线的读数行。退化情形只报结论（不编数字）；椭圆/双曲线给长短半轴与离心率，
 * 圆只给半径与离心率（0）——"一个圆"就是一个数说得清的东西。
 */
export function conicMetrics(conic: Conic3): ConicMetricRow[] {
  const rows: ConicMetricRow[] = [{ label: "结论", value: conicKindLabel(conic.kind) }]
  if (conic.kind === "circle") {
    if (conic.center) rows.push({ label: "圆心", value: formatPoint(conic.center) })
    if (conic.semiMajor !== undefined) rows.push({ label: "半径", value: formatNumber(conic.semiMajor) })
    if (conic.eccentricity !== undefined) rows.push({ label: "离心率", value: formatNumber(conic.eccentricity) })
    return rows
  }
  if (conic.kind === "ellipse" || conic.kind === "hyperbola") {
    if (conic.center) rows.push({ label: "中心", value: formatPoint(conic.center) })
    if (conic.semiMajor !== undefined) rows.push({ label: conic.kind === "ellipse" ? "长半轴" : "实半轴", value: formatNumber(conic.semiMajor) })
    if (conic.semiMinor !== undefined) rows.push({ label: conic.kind === "ellipse" ? "短半轴" : "虚半轴", value: formatNumber(conic.semiMinor) })
    if (conic.eccentricity !== undefined) rows.push({ label: "离心率", value: formatNumber(conic.eccentricity) })
    if (conic.foci?.length) rows.push({ label: "焦点", value: conic.foci.map(formatPoint).join(" / ") })
    return rows
  }
  if (conic.kind === "parabola") {
    if (conic.vertex) rows.push({ label: "顶点", value: formatPoint(conic.vertex) })
    if (conic.focalParameter !== undefined) rows.push({ label: "焦准距 p", value: formatNumber(conic.focalParameter) })
    if (conic.foci?.length) rows.push({ label: "焦点", value: conic.foci.map(formatPoint).join(" / ") })
    return rows
  }
  if (conic.kind === "point" && conic.point) rows.push({ label: "切点", value: formatPoint(conic.point) })
  if ((conic.kind === "line" || conic.kind === "lines") && conic.lines) {
    rows.push({ label: "直线条数", value: String(conic.lines.length) })
  }
  return rows
}

/**
 * 截面的完整解析读数：形状数据 + 面积 / 周长。
 *
 * 面积与周长**只在整条圆锥曲线没被端面裁切时**才给闭式（`πab` 精确、椭圆周长级数标近似）；
 * 被裁切的截面如实说明"由端面裁切"，不拿 `πab` 冒充这个区域的面积。
 */
export function sectionConicMetrics(section: Extract<PrimitiveSpec, { type: "section" }>): ConicMetricRow[] {
  const conic = exactConicOf(section)
  if (!conic) return []
  const rows = conicMetrics(conic)
  const full = fullClosedConicOf(section)
  if (!full) {
    if (conic.kind === "circle" || conic.kind === "ellipse") rows.push({ label: "面积", value: "由端面裁切，无解析闭式" })
    return rows
  }
  const area = conic3Area(full)
  const perimeter = conic3Perimeter(full)
  if (area) rows.push({ label: "面积", value: area.exact ? `${formatNumber(area.value)}（πab 精确）` : formatNumber(area.value) })
  if (perimeter) rows.push({ label: "周长", value: perimeter.exact ? `${formatNumber(perimeter.value)}（2πr 精确）` : `${formatNumber(perimeter.value)}（椭圆级数，数值近似）` })
  return rows
}
