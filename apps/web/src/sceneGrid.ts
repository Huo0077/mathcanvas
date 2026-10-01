/**
 * 背景坐标系（栅格 + 坐标轴）的尺寸与位置。
 *
 * 用户反馈："立体缩放不要改变网格图大小，网格大小要严格对应一比一。"
 *
 * 旧实现按可见范围挑一个"好读"的格边长（1/2/5 × 10ⁿ），于是缩放时格子的**世界尺寸**一直在变，
 * 网格就不再是一把可靠的尺子。现在：
 * - **格边长恒为 1 个世界单位**（`GRID_CELL`），一比一；
 * - 只有**覆盖范围**随视图长大——缩小看到的是"更多格"，不是"每格被放大"；
 * - 覆盖范围按 2 的幂分档（`gridRadius`），同档内缩放时栅格**完全不动**（位置与尺寸都不变），
 *   跨档才重建几何，所以缩放不会一路重建；
 * - 每 10 格一条更粗的主线（`GRID_MAJOR_EVERY`），缩得很远时细线被淡出、主线仍在，
 *   但主线间距仍然是精确的 10 个单位。
 *
 * 2026-10-01 起还多一条：覆盖范围要按**可见地面脚印**算（`groundReach`）——
 * 用户口径"把 0 平面也就是 z=0 的格子网做成无限延伸的感觉"。贴地视角下可见脚印比视口宽高远得多，
 * 只按 `visibleWidth/Height` 铺，方块的直边就会进画面。
 */
export const GRID_CELL = 1
export const GRID_MAJOR_EVERY = 10
/** 最小覆盖半径（格）。空场景也至少铺这么大，免得只剩原点周围一小块。 */
export const GRID_MIN_RADIUS = 8
/** 覆盖半径上限：再远就靠主线表达，"1 格 = 1 单位"的读数不变。 */
export const GRID_MAX_RADIUS = 4096
/**
 * 径向淡出从覆盖半径的这个比例开始（到边界正好为 0）。
 *
 * 它同时是**覆盖率**的依据：要"满实区盖住可见地面脚印"，覆盖半径就得 ≥ 脚印 / 这个比例。
 * `threeGrid.gridFadeBand` 用的是同一个常量（那边只管画，这边管铺多大）。
 */
export const GRID_FADE_START_RATIO = 0.6

/** 把半个可见跨度向上取到 2 的幂档，保证覆盖范围不小于请求值。 */
export function gridRadius(halfSpan: number): number {
  if (!Number.isFinite(halfSpan) || halfSpan <= 0) return GRID_MIN_RADIUS
  const steps = Math.ceil(Math.log2(halfSpan / GRID_MIN_RADIUS))
  return GRID_MIN_RADIUS * 2 ** Math.max(0, steps)
}

/** 取一个"好读"的格边长（1/2/5 × 10ⁿ）。保留给历史对照与其它比例尺场景使用。 */
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
  /**
   * **可见地面脚印**上离视点中心最远的距离（z=0 平面与视锥取样射线的交点，见 `threeSceneGrid`）。
   * 相机平视 / 朝天看、或空场景时传 0（可选，缺省即 0）。
   */
  groundReach?: number
}

export interface GridPlacement {
  /** 格边长（世界单位）。恒为 `GRID_CELL`；保留在读数里是为了让"一比一"可被断言。 */
  cell: number
  centre: { x: number; y: number }
  /** 从中心到栅格边缘的距离，单位是格（= 覆盖半径）。 */
  extent: number
  axesLength: number
  /** 每多少格一条主线。 */
  majorEvery: number
}

export function gridPlacement(inputs: GridInputs): GridPlacement {
  const vertical = (inputs.fovDegrees * Math.PI) / 360
  const visibleHeight = 2 * inputs.distance * Math.tan(vertical)
  const visibleWidth = visibleHeight * Math.max(inputs.aspect, 0.1)
  // `contentReach * 2` 是让栅格铺到"最远的那个角"：从吸附后的中心往两边各铺 extent，覆盖范围是中点的 ±extent。
  const span = Math.max(visibleWidth, visibleHeight, inputs.contentSpan, inputs.contentReach * 2, 4)
  /**
   * 可见脚印要落在**满实区**里（淡出从 `GRID_FADE_START_RATIO × extent` 才开始），
   * 所以先按这个比例把脚印折算成"需要的覆盖半径"，再交给 2 的幂分档。
   */
  const groundReach = Number.isFinite(inputs.groundReach) ? Math.max(0, inputs.groundReach ?? 0) : 0
  const requiredReach = Math.max(span / 2, groundReach / GRID_FADE_START_RATIO)
  return {
    cell: GRID_CELL,
    // 吸附到整格：轨道旋转 / 平移时线不会跟着爬。
    centre: { x: Math.round(inputs.target.x / GRID_CELL) * GRID_CELL, y: Math.round(inputs.target.y / GRID_CELL) * GRID_CELL },
    extent: Math.min(gridRadius(requiredReach), GRID_MAX_RADIUS),
    axesLength: Math.max(span * 0.6, 1.2),
    majorEvery: GRID_MAJOR_EVERY
  }
}
