/**
 * **三视图轮廓反投影（W7，2026-11-09）**。
 *
 * 从**实体本身**（底面多边形 + 高度）投影出主/俯/左三个视图的轮廓，再与题面声明的视图比。
 * 这是"尺寸对得上就给答案"之外的第三道判据：同一组外轮廓尺寸可以对应**不同实体**
 * （长方体与同底棱锥、贯穿槽与浅槽），只有轮廓（包围盒 + 顶点数）一致的候选才算通过反投影。
 *
 * 边界：只做轴对齐棱柱/棱锥的**轮廓**。曲面、斜截面、遮挡后的内部不可见线不在本模块；
 * 它们必须由调用方明确判 `unknown`，不能拿"包围盒一致"冒充重建成功。
 */

export interface OutlinePoint2D {
  x: number
  y: number
}

export interface Outline2D {
  /** 视图横向尺寸。 */
  width: number
  /** 视图纵向尺寸。 */
  height: number
  /** 视图轮廓的多边形顶点（按 x/y 平面给出；矩形为 4 个，L 形为 6 个）。 */
  vertices: readonly OutlinePoint2D[]
  /** 只声明顶点数（题面没逐点给出轮廓时）；给了就以它为准。 */
  vertexCount?: number
}

export interface ProjectedViews {
  front: Outline2D
  top: Outline2D
  side: Outline2D
}

export interface OutlineAgreement {
  ok: boolean
  reasonCodes: string[]
}

const TOLERANCE = 1e-9

function closeTo(left: number, right: number, tolerance = TOLERANCE): boolean {
  return Math.abs(left - right) <= tolerance * Math.max(1, Math.abs(left), Math.abs(right))
}

function finite(value: number): boolean {
  return Number.isFinite(value)
}

/** 去掉重复的末点与共线点：轮廓比较看的是"形状"，不是顶点书写顺序。 */
export function simplifyOutline(points: readonly OutlinePoint2D[], tolerance = TOLERANCE): OutlinePoint2D[] {
  const deduped: OutlinePoint2D[] = []
  for (const point of points) {
    const last = deduped[deduped.length - 1]
    if (last !== undefined && closeTo(last.x, point.x, tolerance) && closeTo(last.y, point.y, tolerance)) continue
    deduped.push({ x: point.x, y: point.y })
  }
  const first = deduped[0]
  const last = deduped[deduped.length - 1]
  if (first !== undefined && last !== undefined && deduped.length > 1 && closeTo(first.x, last.x, tolerance) && closeTo(first.y, last.y, tolerance)) deduped.pop()
  if (deduped.length < 3) return deduped

  // 逐点删除共线点（凸/凹都适用：只看叉积是否为零）。
  const result: OutlinePoint2D[] = []
  for (let index = 0; index < deduped.length; index += 1) {
    const previous = deduped[(index - 1 + deduped.length) % deduped.length]!
    const current = deduped[index]!
    const next = deduped[(index + 1) % deduped.length]!
    const cross = (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x)
    if (Math.abs(cross) > tolerance) result.push(current)
  }
  return result.length >= 3 ? result : deduped
}

function bounds(points: readonly OutlinePoint2D[]): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Number.POSITIVE_INFINITY, maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY
  for (const point of points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y)
  }
  return { minX, maxX, minY, maxY }
}

function rectangle(width: number, height: number): Outline2D {
  return {
    width,
    height,
    vertices: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]
  }
}

function validBase(base: readonly OutlinePoint2D[]): boolean {
  return base.length >= 3 && base.every((point) => finite(point.x) && finite(point.y)) && simplifyOutline(base).length >= 3
}

/**
 * 直棱柱（底面在多边形上、沿 z 拉伸）的三视图轮廓。
 *
 * 主视图 = x 方向宽 × z 高；俯视图 = 底面多边形本身；左视图 = y 方向深 × z 高。
 * 底面退化（小于 3 个有效顶点、面积为 0）时返回 `null`，不生成"看起来能算"的视图。
 */
export function projectPrismViews(base: readonly OutlinePoint2D[], height: number, tolerance = TOLERANCE): ProjectedViews | null {
  if (!validBase(base) || !finite(height) || height <= 0) return null
  const outline = simplifyOutline(base, tolerance)
  const box = bounds(outline)
  const width = box.maxX - box.minX
  const depth = box.maxY - box.minY
  if (width <= tolerance || depth <= tolerance) return null
  return {
    front: rectangle(width, height),
    top: { width, height: depth, vertices: outline.map((point) => ({ x: point.x - box.minX, y: point.y - box.minY })) },
    side: rectangle(depth, height)
  }
}

/**
 * 正四棱锥（矩形底 + 顶点在底面中心上方）的三视图轮廓。
 *
 * 主/左视图是**三角形**（3 个顶点），俯视图是矩形 —— 顶点数本身就是"棱柱还是棱锥"的判据：
 * 同一包围盒、不同顶点数 ⇒ 不是同一个实体，体积也就不能互换。
 */
export function projectPyramidViews(width: number, depth: number, height: number, tolerance = TOLERANCE): ProjectedViews | null {
  if (!finite(width) || !finite(depth) || !finite(height) || width <= tolerance || depth <= tolerance || height <= tolerance) return null
  const triangle = (base: number): Outline2D => ({
    width: base,
    height,
    vertices: [{ x: 0, y: 0 }, { x: base, y: 0 }, { x: base / 2, y: height }]
  })
  return {
    front: triangle(width),
    top: rectangle(width, depth),
    side: triangle(depth)
  }
}

/**
 * 声明的视图与反投影出来的视图是否一致。
 *
 * 判据只有两条（都可观测）：**包围盒尺寸**与**轮廓顶点数**。
 * 不给顶点数时只比尺寸 —— 那种情况下调用方不能宣称"模型唯一"（见 `resolveInvariantVolume` 的完整性要求）。
 */
export function outlinesAgree(declared: Outline2D, projected: Outline2D, tolerance = TOLERANCE): OutlineAgreement {
  const reasonCodes: string[] = []
  if (!closeTo(declared.width, projected.width, tolerance)) reasonCodes.push("outline_width_mismatch")
  if (!closeTo(declared.height, projected.height, tolerance)) reasonCodes.push("outline_height_mismatch")
  const declaredVertices = simplifyOutline(declared.vertices, tolerance)
  const projectedVertices = simplifyOutline(projected.vertices, tolerance)
  const declaredCount = declared.vertexCount ?? declaredVertices.length
  if (declaredCount > 0 && declaredCount !== projectedVertices.length) {
    reasonCodes.push("outline_vertex_mismatch")
  }
  return { ok: reasonCodes.length === 0, reasonCodes }
}
