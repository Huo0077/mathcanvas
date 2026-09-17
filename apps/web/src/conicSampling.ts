/**
 * 按**屏幕误差**决定曲线细分多少段——这是"放大不看出棱"的关键一步。
 *
 * 旧做法是固定段数（48 段圆在任何缩放级别都是 48 段）：48 段弦高偏差是
 * `R(1 − cos(π/48)) = 0.002141·R`，屏幕半径超过约 467 px 就超过 1 像素，用户一放大就看到棱。
 * 现在段数由"当前一个世界单位占多少像素"反推：`tol_world = tol_px × 世界单位每像素`。
 *
 * 参考同款实现：GeoGebra 的 `DrawConic3D.updateCircle` 调 `brush.calcArcLongitudesNeeded(…, getView3D().getScale())`
 * ——曲线是符号存储的、段数由视图尺度算出来的，既不固定也不烘进几何。
 *
 * 本模块只做"参数 → 点列"，不认识 three.js，因此可以单测。
 */
import type { Conic3, CurvePiece3, Vector3 } from "@draw/dsl"
import { conic3PointAt } from "@draw/geometry-kernel"

import { worldUnitsPerPixel } from "./threeCamera"

/** 段数上限：再密也不会有人看出差别，但会拖慢渲染。 */
export const MAX_CURVE_SEGMENTS = 8192
/** 闭合曲线的最低段数。 */
export const MIN_CURVE_SEGMENTS = 3
/** 曲线的屏幕误差容差（像素）：亚像素即可，0.5px 是业界常用的默认。 */
export const CURVE_PIXEL_TOLERANCE = 0.5

/**
 * 屏幕误差容差 → 世界单位容差：`tol_px × 世界单位每像素`。
 *
 * 相机拉远时每像素代表更多世界单位，容差自动变大（段数变少）；拉近则反过来——这就是
 * "放大不看出棱、缩远不浪费"的机制。
 */
export function curveToleranceFor(camera: { fov: number }, distance: number, viewportHeight: number, pixelTolerance = CURVE_PIXEL_TOLERANCE): number {
  const value = pixelTolerance * worldUnitsPerPixel(camera, distance, viewportHeight)
  // 相机状态非有限（或距离为负）时给一个保守的小容差：曲线会多采一些点，但绝不会得到 NaN 几何。
  if (!Number.isFinite(value) || value <= 0) return 0.001
  return Math.max(value, 1e-9)
}

/**
 * 容差**滞回档**：量化到 2 的幂。
 *
 * 相机连续缩放时容差每帧都在变，若把它直接当作重建签名，曲线每帧都要重新采样上传。
 * 量化成 2 的幂之后，只有缩放跨过一档（不到 2×）才重建——视觉上分辨不出、开销却少一个数量级。
 */
export function toleranceBucket(tolerance: number): number {
  if (!Number.isFinite(tolerance) || tolerance <= 0) return 1
  return 2 ** Math.ceil(Math.log2(tolerance))
}

/**
 * `n` 段折线的最大弦高是 `R(1 − cos(π/n))`；解 `h ≤ tolerance` 得段数（[MathWorld sagitta](https://mathworld.wolfram.com/Sagitta.html)）。
 *
 * 退化输入如实退到下限：`tolerance ≤ 0`、`radius ≤ 0` 或非有限值时给 3 段，而不是给 `NaN` 或无穷。
 */
export function segmentsForSagitta(radius: number, tolerance: number, maxSegments = MAX_CURVE_SEGMENTS): number {
  if (!Number.isFinite(radius) || !Number.isFinite(tolerance) || radius <= 0 || tolerance <= 0) return MIN_CURVE_SEGMENTS
  const cosine = 1 - tolerance / radius
  if (cosine <= -1) return MIN_CURVE_SEGMENTS
  const needed = Math.ceil(Math.PI / Math.acos(Math.min(1, cosine)))
  return Math.max(MIN_CURVE_SEGMENTS, Math.min(maxSegments, Number.isFinite(needed) ? needed : maxSegments))
}

/**
 * 闭合圆锥曲线（圆 / 椭圆）的采样点：**首尾重合**（最后一点与第一点相同），渲染成闭合折线直接用。
 *
 * 段数用**最大曲率半径** `a²/b` 而不是 `a`：椭圆在短轴端弯得最厉害（曲率半径 `a²/b` 最大），
 * 用 `a` 会低估弦高、留下可见的棱。
 */
export function sampleClosedConic(conic: Conic3, tolerance: number, maxSegments = MAX_CURVE_SEGMENTS): Vector3[] {
  const semiMajor = conic.semiMajor ?? 0
  const semiMinor = conic.semiMinor ?? 0
  if (!(semiMajor > 0)) return []
  const curvatureRadius = semiMinor > 0 ? (semiMajor * semiMajor) / semiMinor : semiMajor
  const segments = segmentsForSagitta(Math.max(curvatureRadius, semiMajor), tolerance, maxSegments)
  const points: Vector3[] = []
  for (let index = 0; index <= segments; index += 1) {
    const point = conic3PointAt(conic, (index / segments) * Math.PI * 2)
    if (point) points.push(point)
  }
  return points.length >= 2 ? points : []
}

/**
 * 开曲线（抛物线 / 双曲线 / 直线段）的自适应采样：离弦太远就二分，深度到顶为止。
 *
 * 与闭曲线的公式法不同，开曲线的曲率沿参数变化很大（抛物线远端几乎是直线、顶点附近弯得厉害），
 * 用固定段数要么在直的地方浪费、要么在弯的地方出棱。
 *
 * **平坦度判据在 1/4、1/2、3/4 三处取最大偏差**，不能只看中点：`y = x³` 在 `[-2, 2]` 上中点偏差
 * 恰好为 0（偏差的解析式是 `(3/8)h²|2a + h|`，这里 `2a + h = 0`），只看中点会给出一条只含两个点、
 * 却离弦非常远的折线——实测就是这么被测试抓住的。
 */
export function sampleOpenCurve(pointAt: (parameter: number) => Vector3 | null, range: [number, number], tolerance: number, maxDepth = 16): Vector3[] {
  const start = pointAt(range[0])
  const end = pointAt(range[1])
  if (!start || !end) return []
  const points: Vector3[] = [start]
  const deviationFractions = [0.25, 0.5, 0.75]
  const subdivide = (from: number, to: number, fromPoint: Vector3, toPoint: Vector3, depth: number) => {
    let worst = 0
    for (const fraction of deviationFractions) {
      const point = pointAt(from + (to - from) * fraction)
      if (!point) return
      const chord = {
        x: fromPoint.x + (toPoint.x - fromPoint.x) * fraction,
        y: fromPoint.y + (toPoint.y - fromPoint.y) * fraction,
        z: fromPoint.z + (toPoint.z - fromPoint.z) * fraction
      }
      worst = Math.max(worst, Math.hypot(point.x - chord.x, point.y - chord.y, point.z - chord.z))
    }
    const middle = (from + to) / 2
    const middlePoint = pointAt(middle)
    if (!middlePoint) return
    if (depth >= maxDepth || worst <= tolerance) {
      points.push(toPoint)
      return
    }
    subdivide(from, middle, fromPoint, middlePoint, depth + 1)
    subdivide(middle, to, middlePoint, toPoint, depth + 1)
  }
  subdivide(range[0], range[1], start, end, 0)
  if (points.length === 1) points.push(end)
  return points
}

/**
 * 片段环 → 折线点列（相邻片段共享端点只保留一份），渲染与导出共用。
 * 片段用 `branch` 指定双曲线的哪一支。
 */
export function sampleCurvePieces(pieces: CurvePiece3[], tolerance: number): Vector3[] {
  const points: Vector3[] = []
  const push = (point: Vector3) => {
    const last = points[points.length - 1]
    if (last && Math.hypot(last.x - point.x, last.y - point.y, last.z - point.z) <= 1e-12) return
    points.push(point)
  }
  for (const piece of pieces) {
    if (piece.kind === "segment") {
      push(piece.a)
      push(piece.b)
      continue
    }
    const conicPoints = sampleConicRange(piece.conic, piece.parameterRange, tolerance, piece.branch ?? 0)
    for (const point of conicPoints) push(point)
  }
  // 闭合环补齐首点，折线能一次画完。
  const first = points[0]
  const last = points[points.length - 1]
  if (first && last && points.length >= 3 && Math.hypot(last.x - first.x, last.y - first.y, last.z - first.z) > 1e-12) points.push(first)
  return points
}

function sampleConicRange(conic: Conic3, range: [number, number], tolerance: number, branch: number): Vector3[] {
  if (conic.kind === "line" || conic.kind === "lines") {
    const start = conic3PointAt(conic, range[0], branch)
    const end = conic3PointAt(conic, range[1], branch)
    return start && end ? [start, end] : []
  }
  /**
   * **整圈**的闭曲线片段用闭式段数公式（`sampleClosedConic`），不走自适应二分。
   *
   * 整圈的片段首尾是同一点，那根弦是退化的（长度 0），采样点离它差不多一整个半径——平坦度判据永远
   * 不满足，只能一路二分，而二分只给 **2 的幂**段数：实测弦高公式要 40 段时它给 64 段（65 个点对 41 个），
   * 参数间隔还不均匀。闭曲线有闭式解，没有理由去逼近它。
   */
  if (conic.closed && Math.abs(range[1] - range[0]) >= Math.PI * 2 - 1e-9) return sampleClosedConic(conic, tolerance)
  return sampleOpenCurve((parameter) => conic3PointAt(conic, parameter, branch), range, tolerance)
}
