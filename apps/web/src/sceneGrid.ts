/**
 * 背景坐标系（栅格 + 坐标轴）的尺寸与位置。
 *
 * 旧实现把栅格固定成 **14 格、以原点为中心**，尺寸只按内容对角线取整——于是内容离原点一远
 * （用户报告：点的坐标到 20 左右），栅格只铺到 ±14、坐标轴只画到 12 左右，那个点就落在
 * "坐标系之外"的空白里。这里改成：
 * - 格边长随**可见范围**与内容到达范围自适应（1/2/5 × 10ⁿ）；
 * - 栅格中心跟着视点中心走（并吸附到格，避免轨道旋转时线在抖动）；
 * - 坐标轴长度与可见范围同量级，内容再远也看得到坐标参照。
 */
export const GRID_CELLS = 14

/** 取一个"好读"的格边长（1/2/5 × 10ⁿ），向上取整，保证栅格不小于请求的范围。 */
export function niceGridStep(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  return (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude
}

export interface GridInputs {
  /** 相机到视点中心的距离。 */
  distance: number
  /** 垂直视角（度）。 */
  fovDegrees: number
  /** 画布宽高比。 */
  aspect: number
  /** 视点中心在地面上的投影。 */
  target: { x: number; y: number }
  /** 内容 AABB 的对角线长度（空场景传 0）。 */
  contentSpan: number
  /** 内容里离原点最远的角在地面上的距离（空场景传 0）。 */
  contentReach: number
}

export interface GridPlacement {
  cell: number
  centre: { x: number; y: number }
  /** 从中心到栅格边缘的距离。 */
  extent: number
  axesLength: number
}

export function gridPlacement(inputs: GridInputs, cells = GRID_CELLS): GridPlacement {
  const vertical = (inputs.fovDegrees * Math.PI) / 360
  const visibleHeight = 2 * inputs.distance * Math.tan(vertical)
  const visibleWidth = visibleHeight * Math.max(inputs.aspect, 0.1)
  // `contentReach * 2` 是让栅格铺到"最远的那个角"：从吸附后的中心往两边各铺 extent，覆盖范围是中点的 ±extent。
  const span = Math.max(visibleWidth, visibleHeight, inputs.contentSpan, inputs.contentReach * 2, 4)
  const cell = niceGridStep(span / cells)
  return {
    cell,
    centre: { x: Math.round(inputs.target.x / cell) * cell, y: Math.round(inputs.target.y / cell) * cell },
    extent: (cells / 2) * cell,
    axesLength: Math.max(span * 0.6, 1.2)
  }
}
