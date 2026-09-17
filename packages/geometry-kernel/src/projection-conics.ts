/**
 * 空间圆锥曲线的**解析投影**：把"真圆"投影成真椭圆，而不是把一个多边形近似的点环投出去。
 *
 * 正交视图（`projections3d.ts` 的四个视图都是正交的）下，圆 `C + r(cos t·u + sin t·v)` 的像仍然是同一条
 * 参数曲线：`proj(C) + r·cos t·P(u) + r·sin t·P(v)`，其中 `P` 是投影的**线性部分**。于是
 * `A = r·P(u)`、`B = r·P(v)`，像是 `{proj(C) + A cos t + B sin t}`——它是 `N = [A B]` 的单位圆像，
 * 因此半轴 = `N` 的奇异值 = `M = A·Aᵀ + B·Bᵀ` 的特征值开方，长轴方向 = `λ₁` 的特征向量。
 *
 * 这正是设计文档 §5.5 第 7 项的验收口径："视线与圆平面夹角 θ 时投影椭圆离心率 = sin θ"：
 * 视线与**法向**成 θ 时 `λ₂/λ₁ = cos²θ`，`e = √(1 − λ₂/λ₁) = sin θ`。
 *
 * 纯函数、零依赖（不引 three.js），投影约定直接由 `projectVector3` 派生——绝不另立一套。
 */
import { addVector3, scaleVector3, type Vector3 } from "./geometry3d"
import { projectVector3, type DrawingView, type ProjectedPoint } from "./projections3d"
import type { Conic3 } from "./quadrics"

/**
 * 投影后的圆锥曲线（`projectionVisuals` 的 `polyline` 由它采样而来）。
 *
 * `ellipse`：`center + semiMajor·cos t·major + semiMinor·sin t·minor`，
 * 其中 `major = (cos rotation, sin rotation)`、`minor = (−sin rotation, cos rotation)`。
 * **`rotation` 的约定**：长轴方向在投影二维坐标系里的极角，从该视图的**水平轴**（`x`）量向**垂直轴**（`y`），
 * 弧度制，取值落在 `(−π/2, π/2]`——轴是无向的，所以把 `x < 0` 的那支翻过来，避免同一个椭圆给出两个差 π 的角。
 *
 * `segment`：边视（视线落在曲线平面内）时的像——半径方向被压成零长度，如实报线段。
 */
export type ProjectedConic2 =
  | { kind: "ellipse"; center: ProjectedPoint; semiMajor: number; semiMinor: number; rotation: number }
  | { kind: "segment"; a: ProjectedPoint; b: ProjectedPoint }

/**
 * 两条半轴之比小于它时判为退化（视线落在曲线平面内）→ 报线段。
 * 与内核既有的"零判定按相对量"一致：`λ₂` 与 `λ₁` 同量纲，比值无尺度依赖。
 */
const DEGENERATE_RELATIVE_TOLERANCE = 1e-12

/** 特征向量分支的相对阈值（`m12` 相对矩阵量级），避免绝对阈值在大/小模型上失效。 */
const EIGEN_OFFDIAGONAL_RELATIVE_TOLERANCE = 1e-15

interface Direction2 {
  x: number
  y: number
}

/**
 * 方向的投影：投影 `origin` 与 `origin + direction` 两点再作差——就是 `projectVector3` 的线性部分，
 * 因此与既有投影约定逐位同源（不是另写一份点积）。
 */
function projectedDirection(origin: Vector3, direction: Vector3, view: DrawingView): Direction2 | null {
  const base = projectVector3(origin, view)
  const tip = projectVector3(addVector3(origin, direction), view)
  if (!base || !tip) return null
  return { x: tip.x - base.x, y: tip.y - base.y }
}

/** `M = A·Aᵀ + B·Bᵀ` 的长轴特征向量（无向轴，统一取 `x > 0`，`x = 0` 时取 `y > 0`）。 */
function majorAxisDirection(m11: number, m12: number, m22: number, lambda1: number): Direction2 {
  let direction: Direction2 = { x: 0, y: 1 }
  const matrixScale = Math.max(Math.abs(m11), Math.abs(m12), Math.abs(m22))
  if (Math.abs(m12) > EIGEN_OFFDIAGONAL_RELATIVE_TOLERANCE * matrixScale) {
    // (M − λI)v = 0 的一个解是 v = (m12, λ − m11)。
    const length = Math.hypot(m12, lambda1 - m11)
    if (length > 0) direction = { x: m12 / length, y: (lambda1 - m11) / length }
  } else if (m11 >= m22) {
    direction = { x: 1, y: 0 }
  }
  if (direction.x < 0 || (direction.x === 0 && direction.y < 0)) direction = { x: -direction.x, y: -direction.y }
  return direction
}

/**
 * 圆 / 椭圆的解析投影；其余类型（抛物线、双曲线、直线、退化形）与退化输入一律返回 `null`——不编几何。
 *
 * 只支持 `circle` / `ellipse`：它们是有心闭曲线，投影后仍是同族的圆锥曲线；抛物线 / 双曲线投影后
 * 需要在屏幕空间重新做一次分类与参数化，本次切片不做，因此明确返回 `null` 让调用方回退。
 */
export function projectConic3(conic: Conic3, view: DrawingView): ProjectedConic2 | null {
  if (conic.kind !== "circle" && conic.kind !== "ellipse") return null
  const center = conic.center
  const axes = conic.axes
  const semiMajor = conic.semiMajor
  const semiMinor = conic.semiMinor
  if (!center || !axes || semiMajor === undefined || semiMinor === undefined) return null
  if (!(semiMajor > 0) || !(semiMinor > 0)) return null
  const projectedCenter = projectVector3(center, view)
  if (!projectedCenter) return null

  // `A = a·P(major)`、`B = b·P(minor)`：曲线是 `proj(C) + A cos t + B sin t`。
  const first = projectedDirection(center, scaleVector3(axes.major, semiMajor), view)
  const second = projectedDirection(center, scaleVector3(axes.minor, semiMinor), view)
  if (!first || !second) return null

  const m11 = first.x * first.x + second.x * second.x
  const m12 = first.x * first.y + second.x * second.y
  const m22 = first.y * first.y + second.y * second.y
  if (![m11, m12, m22].every(Number.isFinite)) return null

  const mean = (m11 + m22) / 2
  const spread = Math.hypot(m11 - m22, 2 * m12) / 2
  const lambda1 = mean + spread
  const lambda2 = mean - spread
  // 像退化成一点（例如半径为零、两个方向都被压平）：没有任何曲线可画。
  if (!(lambda1 > 0) || !Number.isFinite(lambda1)) return null
  const direction = majorAxisDirection(m11, m12, m22, lambda1)

  if (!(lambda2 > DEGENERATE_RELATIVE_TOLERANCE * lambda1)) {
    /**
     * 边视：半径方向被压成零长度，像是**线段**。端点取圆上真实的两个点（参数 `t*` 让
     * `A cos t + B sin t` 与长轴同向）再投影——这样 `depth` 也是这两个点的真实深度，不是圆心的深度。
     */
    const parameter = Math.atan2(second.x * direction.x + second.y * direction.y, first.x * direction.x + first.y * direction.y)
    const offset = addVector3(
      scaleVector3(axes.major, semiMajor * Math.cos(parameter)),
      scaleVector3(axes.minor, semiMinor * Math.sin(parameter))
    )
    const a = projectVector3(addVector3(center, offset), view)
    const b = projectVector3(addVector3(center, scaleVector3(offset, -1)), view)
    if (!a || !b) return null
    return { kind: "segment", a, b }
  }

  return {
    kind: "ellipse",
    center: projectedCenter,
    semiMajor: Math.sqrt(lambda1),
    semiMinor: Math.sqrt(Math.max(lambda2, 0)),
    rotation: Math.atan2(direction.y, direction.x)
  }
}
