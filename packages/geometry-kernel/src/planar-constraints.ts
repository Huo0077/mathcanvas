import type { Coordinate, EllipsePrimitive, HyperbolaPrimitive, ParabolaPrimitive } from "@draw/dsl"

/**
 * 平面约束模型（Dynamic Point Constraint Model）
 *
 * 一个「约束」就是一条**一维曲线**，加上它自己的**自然参数**。动点的全部自由度被压缩成那个标量参数，
 * 于是「点沿曲线运动」在数学上就是「参数 t 在区间内变化」。约束对象只回答三类问题：
 *
 *   evaluate(t)        —— 正向映射：参数 → 世界坐标（轨迹采样、动画、滑块拖动都靠它）
 *   project(q)         —— 反向映射：世界坐标 → 最近的参数（鼠标拖拽靠它，即"投影最近点"）
 *   residual(q)        —— 违反度：坐标到曲线集的欧氏距离（命中测试、约束松弛靠它）
 *
 * 这套设计把「拖拽」和「动画」统一成同一个状态更新：
 *   拖拽 = project(鼠标位置) → t → evaluate(t)
 *   动画 = t += Δt           → evaluate(t)
 * 两条路径写同一个参数，因此下游依赖图完全不需要区分用户是拖出来的还是播放出来的。
 *
 * 参数语义按约束种类固定，不做全局统一（统一成 [0,1] 会让非线性约束在参数域上分布极不均匀，
 * 牛顿法/采样都会退化）：
 *   segment / line / ray  仿射参数 t（方向上的比例；segment 截断到 [0, 1]，ray 截断到 [0, +∞)）
 *   circle / arc          角度 θ（弧度），circle 周期 2π，arc 限制在 [startAngle, endAngle]
 *   ellipse / hyperbola   同一套；椭圆取离心角 θ ∈ [0, 2π)，双曲线取轴向参数 u ∈ ℝ 且分两个分支
 *   parabola              轴向参数 u ∈ ℝ（与 `sampleParabola` 的约定一致）
 *   polyline              按弧长归一化的比例 t ∈ [0, 1]
 *   functionGraph         x 坐标本身
 *   implicitCurve        没有自然参数时不可参数化，只支持投影
 */

export type ConstraintKind =
  | "line"
  | "ray"
  | "segment"
  | "circle"
  | "arc"
  | "polyline"
  | "functionGraph"
  | "parabola"
  | "ellipse"
  | "hyperbola"
  | "implicitCurve"

export interface ParameterBounds {
  min: number
  max: number
  /** 参数是周期的（圆、椭圆），`max - min` 就是一个周期。 */
  wrap: boolean
}

export interface ConstraintProjection {
  parameter: number
  branch: number
  point: Coordinate
  /** 请求坐标到投影点的欧氏距离（"吸附"掉的距离）。 */
  distance: number
  converged: boolean
  iterations: number
  /**
   * 结果被参数域的边界截断：无界曲线上的最近点在约束域之外，被拉回了端点。
   * UI 用它来提示"已经拖到线段/圆弧/定义域的尽头"，而不是把这种情形和普通吸附混为一谈。
   */
  clamped: boolean
}

export interface ProjectOptions {
  /**
   * 上一次的参数。拖动时传入，用来保证**连续性**：宁可取一个稍远的局部最近点，
   * 也不让点瞬间跳到另一条分支或曲线的另一侧。这比"全局最近点"更符合拖拽的直觉。
   */
  previousParameter?: number
  /** 上一次的分支。给定后只在同一分支上搜索（双曲线跨渐近线时不会换支）。 */
  previousBranch?: number
  /** 牛顿迭代上限（仅隐式约束使用）。 */
  maxIterations?: number
  tolerance?: number
}

export interface PlanarConstraint {
  readonly kind: ConstraintKind
  readonly id: string
  /** 不连通分支数量：双曲线为 2，其余为 1。 */
  readonly branchCount: number
  parameterBounds(branch?: number): ParameterBounds
  evaluate(parameter: number, branch?: number): Coordinate | null
  project(desired: Coordinate, options?: ProjectOptions): ConstraintProjection | null
  residual(point: Coordinate): number
  /** 单位切向；尖点或参数无定义处返回 null。 */
  tangent(parameter: number, branch?: number): Coordinate | null
}

const TWO_PI = Math.PI * 2
const EPSILON = 1e-12

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

/** 归一化到 [0, 2π)。 */
export function normalizeAngle(angle: number): number {
  const wrapped = angle % TWO_PI
  return wrapped < 0 ? wrapped + TWO_PI : wrapped
}

function pointDistance(first: Coordinate, second: Coordinate): number {
  return Math.hypot(first.x - second.x, first.y - second.y)
}

function finitePoint(point: Coordinate | null): Coordinate | null {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null
}

function rotateAround(point: Coordinate, center: Coordinate, rotation: number): Coordinate {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const x = point.x - center.x
  const y = point.y - center.y
  return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos }
}

/** 反向旋转：把世界坐标表达成以 `center` 为原点、旋转 `-rotation` 后的局部坐标。 */
function toLocal(point: Coordinate, center: Coordinate, rotation: number): Coordinate {
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const x = point.x - center.x
  const y = point.y - center.y
  return { x: x * cos + y * sin, y: -x * sin + y * cos }
}

// ---------------------------------------------------------------------------
// 一维最近点搜索
//
// 线性/圆形约束有闭式解，不需要搜索。圆锥曲线、函数图像、折线的一般最近点没有闭式解，
// 统一走"粗扫定位低谷 → 黄金分割细化"。粗扫是为了**避免落到错误的局部极小**（双曲线两支、
// 函数图像的多个波谷），黄金分割则是无导数、对拐点稳健的一维极小化。
// ---------------------------------------------------------------------------

interface NearestSample {
  parameter: number
  point: Coordinate
  distance: number
}

type ParameterEvaluator = (parameter: number) => Coordinate | null

function coarsestSample(evaluate: ParameterEvaluator, desired: Coordinate, from: number, to: number, count: number): NearestSample | null {
  let best: NearestSample | null = null
  const step = (to - from) / count
  for (let index = 0; index <= count; index += 1) {
    const parameter = index === count ? to : from + step * index
    const point = finitePoint(evaluate(parameter))
    if (!point) continue
    const distance = pointDistance(point, desired)
    if (!best || distance < best.distance) best = { parameter, point, distance }
  }
  return best
}

function goldenRefine(evaluate: ParameterEvaluator, desired: Coordinate, low: number, high: number, iterations: number): NearestSample | null {
  const ratio = (Math.sqrt(5) - 1) / 2
  let left = low
  let right = high
  let first = right - ratio * (right - left)
  let second = left + ratio * (right - left)
  let firstPoint = finitePoint(evaluate(first))
  let secondPoint = finitePoint(evaluate(second))
  for (let iteration = 0; iteration < iterations && right - left > EPSILON; iteration += 1) {
    const firstDistance = firstPoint ? pointDistance(firstPoint, desired) : Number.POSITIVE_INFINITY
    const secondDistance = secondPoint ? pointDistance(secondPoint, desired) : Number.POSITIVE_INFINITY
    if (firstDistance <= secondDistance) {
      right = second
      second = first
      secondPoint = firstPoint
      first = right - ratio * (right - left)
      firstPoint = finitePoint(evaluate(first))
    } else {
      left = first
      first = second
      firstPoint = secondPoint
      second = left + ratio * (right - left)
      secondPoint = finitePoint(evaluate(second))
    }
  }
  const candidates: NearestSample[] = []
  for (const [parameter, point] of [[left, finitePoint(evaluate(left))], [right, finitePoint(evaluate(right))], [first, firstPoint], [second, secondPoint]] as const) {
    if (point) candidates.push({ parameter, point, distance: pointDistance(point, desired) })
  }
  if (candidates.length === 0) return null
  return candidates.reduce((best, candidate) => (candidate.distance < best.distance ? candidate : best))
}

/**
 * 在 `[from, to]` 内搜索离 `desired` 最近的参数。
 * 粗扫步长决定了能分辨多细的低谷；细化把结果收敛到机器精度。
 */
function nearestBySearch(
  evaluate: ParameterEvaluator,
  desired: Coordinate,
  options: { from: number; to: number; scan?: number; refineIterations?: number }
): NearestSample | null {
  const scan = options.scan ?? 32
  const sweep = coarsestSample(evaluate, desired, options.from, options.to, scan)
  if (!sweep) return null
  const step = (options.to - options.from) / scan
  // 低谷两侧各留一格：黄金分割要求区间内包含一个局部极小，且端点不比内部更优。
  const low = Math.max(options.from, sweep.parameter - step)
  const high = Math.min(options.to, sweep.parameter + step)
  return goldenRefine(evaluate, desired, low, high, options.refineIterations ?? 64) ?? sweep
}

function toProjection(sample: NearestSample, branch: number, iterations: number, converged = true, clamped = false): ConstraintProjection {
  return { parameter: sample.parameter, branch, point: sample.point, distance: sample.distance, converged, iterations, clamped }
}

// ---------------------------------------------------------------------------
// 线性约束：点在线 / 射线 / 线段上
// ---------------------------------------------------------------------------

/**
 * 一维线性约束。参数 t 是方向向量上的仿射比例，`parameterBounds` 负责承载"直线 / 射线 / 线段"的差别：
 *
 *   line    t ∈ (-∞, +∞)
 *   ray     t ∈ [0, +∞)
 *   segment t ∈ [0, 1]
 *
 * 正反映射都是闭式的，没有迭代：投影就是把 `desired - a` 投到方向向量上（一次点积）。
 * 退化（a 与 b 重合）时整条曲线塌缩成一个点，投影恒定、切向无定义。
 */
export function linearConstraint(kind: "line" | "ray" | "segment", id: string, a: Coordinate, b: Coordinate): PlanarConstraint {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy
  const length = Math.sqrt(lengthSq)
  const degenerate = lengthSq <= EPSILON
  const bounds: ParameterBounds = kind === "segment"
    ? { min: 0, max: 1, wrap: false }
    : kind === "ray"
      ? { min: 0, max: Number.POSITIVE_INFINITY, wrap: false }
      : { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY, wrap: false }

  const evaluate = (parameter: number): Coordinate => degenerate
    ? { x: a.x, y: a.y }
    : { x: a.x + dx * parameter, y: a.y + dy * parameter }

  return {
    kind,
    id,
    branchCount: 1,
    // 每次都回一份新对象：调用方（滑块 / 动点）拿到的是自己的副本，改它不会污染约束本身。
    parameterBounds: () => ({ ...bounds }),
    evaluate: (parameter) => finitePoint(evaluate(parameter)),
    project(desired, options) {
      if (degenerate) {
        return { parameter: 0, branch: 0, point: { x: a.x, y: a.y }, distance: pointDistance(a, desired), converged: true, iterations: 0, clamped: false }
      }
      /**
       * 非有限输入必须显式失败：直线的参数域本来就是整条实轴，`clamp(∞, −∞, +∞)` 拦不住它，
       * 于是 `parameter = ∞`、坐标 `{∞, 0}` 会被当成 `converged: true` 的合法结果返回，
       * 并写进动点参数（文档里出现 ∞）。返回 null 走 `moveTo` 的"未收敛、不移动"分支。
       */
      if (!Number.isFinite(desired.x) || !Number.isFinite(desired.y)) return null
      const raw = ((desired.x - a.x) * dx + (desired.y - a.y) * dy) / lengthSq
      const parameter = clamp(raw, bounds.min, bounds.max)
      const point = evaluate(parameter)
      if (!Number.isFinite(parameter) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
      void options
      // 只有射线/线段会截断；直线的参数域是整条实轴。
      const clamped = parameter !== raw || !Number.isFinite(raw)
      return { parameter, branch: 0, point, distance: pointDistance(point, desired), converged: true, iterations: 1, clamped }
    },
    residual(point) {
      if (degenerate) return pointDistance(point, a)
      // 到"约束集"的欧氏距离：先把点投到**受边界约束的**垂足，再量距离。
      // 只算点到无限直线的垂距是错的 —— 线段外的点会被报成 0（实测：线段 (0,0)-(4,0)
      // 上的点 (7,0) 会得到 0 而不是 3）。
      const raw = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq
      return pointDistance(point, evaluate(clamp(raw, bounds.min, bounds.max)))
    },
    tangent() {
      return degenerate ? null : { x: dx / length, y: dy / length }
    }
  }
}

export function segmentConstraint(id: string, a: Coordinate, b: Coordinate): PlanarConstraint {
  return linearConstraint("segment", id, a, b)
}

export function lineConstraint(id: string, a: Coordinate, b: Coordinate): PlanarConstraint {
  return linearConstraint("line", id, a, b)
}

export function rayConstraint(id: string, a: Coordinate, b: Coordinate): PlanarConstraint {
  return linearConstraint("ray", id, a, b)
}

// ---------------------------------------------------------------------------
// 圆形约束：点在圆 / 圆弧上
// ---------------------------------------------------------------------------

function circularConstraint(kind: "circle" | "arc", id: string, center: Coordinate, radius: number, startAngle: number, endAngle: number): PlanarConstraint {
  const safeRadius = Math.abs(radius)
  const stable = safeRadius > EPSILON
  const span = endAngle - startAngle
  /**
   * 圆弧的参数域必须**有序**：顺时针弧（`span < 0`）的 `[endAngle, startAngle]` 才是升序区间。
   * 原样返回 `{min: startAngle, max: endAngle}` 会让下游 `clamp(parameter, min, max)` 得到一个
   * 恒等于 max 的"夹取"，滑块窗口也会拿到倒过来的区间。
   */
  const bounds: ParameterBounds = kind === "circle"
    ? { min: 0, max: TWO_PI, wrap: true }
    : span >= 0
      ? { min: startAngle, max: endAngle, wrap: false }
      : { min: endAngle, max: startAngle, wrap: false }

  const pointAt = (angle: number): Coordinate => ({ x: center.x + safeRadius * Math.cos(angle), y: center.y + safeRadius * Math.sin(angle) })
  const evaluate = (parameter: number): Coordinate | null => finitePoint(pointAt(parameter))

  /**
   * 弧上的参数投影。先取极角，再判断它是否落在弧的张角内；
   * 落在外面时不属于弧，此时最近点一定在某一端点上 —— 直接比两端的**欧氏距离**。
   * （不能比角度差：`delta` 在 [0, 2π) 上，弧外靠近起点的角度算出来是接近 2π 的大数，
   *   按数值比较会错误地吸附到终点。）
   *
   * 返回的参数必须落在**弧自身的角度区间**内：`delta` 只是"从起点顺时针走过的量"，
   * 对顺时针弧要整体减一个 2π 才是弧上的角度，否则参数会跑到 `[endAngle, startAngle]` 之外
   *（甚至超过 2π），下游夹取时点会跳回端点。
   */
  const projectArc = (desired: Coordinate): { parameter: number; clamped: boolean } => {
    const angle = Math.atan2(desired.y - center.y, desired.x - center.x)
    const delta = normalizeAngle(angle - startAngle)
    const inside = span >= 0 ? delta <= span : delta - TWO_PI >= span
    if (inside) return { parameter: span >= 0 ? startAngle + delta : startAngle + delta - TWO_PI, clamped: false }
    const startDistance = pointDistance(pointAt(startAngle), desired)
    const endDistance = pointDistance(pointAt(endAngle), desired)
    return startDistance <= endDistance ? { parameter: startAngle, clamped: true } : { parameter: endAngle, clamped: true }
  }

  return {
    kind,
    id,
    branchCount: 1,
    parameterBounds: () => ({ ...bounds }),
    evaluate: (parameter) => evaluate(parameter),
    project(desired) {
      if (!Number.isFinite(desired.x) || !Number.isFinite(desired.y)) return null
      if (!stable) {
        return { parameter: 0, branch: 0, point: { x: center.x, y: center.y }, distance: pointDistance(center, desired), converged: true, iterations: 0, clamped: false }
      }
      // 圆心与目标点重合时极角无定义，退化为任取起点（距离恒等于半径）。
      const coincident = Math.hypot(desired.x - center.x, desired.y - center.y) <= EPSILON
      let parameter: number
      let clamped = false
      if (coincident) parameter = bounds.min
      else if (kind === "circle") parameter = normalizeAngle(Math.atan2(desired.y - center.y, desired.x - center.x))
      else {
        const resolved = projectArc(desired)
        parameter = resolved.parameter
        clamped = resolved.clamped
      }
      if (!Number.isFinite(parameter)) return null
      const point = pointAt(parameter)
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
      return { parameter, branch: 0, point, distance: pointDistance(point, desired), converged: true, iterations: 1, clamped }
    },
    residual(point) {
      if (!stable) return pointDistance(point, center)
      const radial = Math.abs(Math.hypot(point.x - center.x, point.y - center.y) - safeRadius)
      if (kind === "circle") return radial
      const angle = Math.atan2(point.y - center.y, point.x - center.x)
      const span = endAngle - startAngle
      const delta = normalizeAngle(angle - startAngle)
      const inside = span >= 0 ? delta <= span : delta - TWO_PI >= span
      if (inside) return radial
      return Math.min(pointDistance(point, pointAt(startAngle)), pointDistance(point, pointAt(endAngle)))
    },
    tangent(parameter) {
      if (!stable) return null
      return { x: -Math.sin(parameter), y: Math.cos(parameter) }
    }
  }
}

export function circleConstraint(id: string, center: Coordinate, radius: number): PlanarConstraint {
  return circularConstraint("circle", id, center, radius, 0, TWO_PI)
}

export function arcConstraint(id: string, center: Coordinate, radius: number, startAngle: number, endAngle: number): PlanarConstraint {
  return circularConstraint("arc", id, center, radius, startAngle, endAngle)
}

// ---------------------------------------------------------------------------
// 折线约束
// ---------------------------------------------------------------------------

/**
 * 折线约束：参数是按**弧长**归一化的比例 t ∈ [0, 1]，这是唯一能让鼠标匀速拖过的参数化方式
 * （按点序号归一化会让长边拖得飞快、短边几乎不动）。
 * 顶点处两个 t 映射到同一个点，投影时用 `previousParameter` 打破平局，避免在顶点抖动。
 */
export function polylineConstraint(id: string, points: readonly Coordinate[]): PlanarConstraint {
  const vertices = points.map((point) => ({ x: point.x, y: point.y }))
  const lengths: number[] = []
  for (let index = 1; index < vertices.length; index += 1) lengths.push(pointDistance(vertices[index - 1], vertices[index]))
  const total = lengths.reduce((sum, value) => sum + value, 0)
  const cumulative: number[] = [0]
  for (const length of lengths) cumulative.push(cumulative[cumulative.length - 1] + length)
  const usable = vertices.length >= 2 && total > EPSILON

  const locate = (parameter: number): { index: number; ratio: number } => {
    if (!usable) return { index: 0, ratio: 0 }
    const distance = clamp(parameter, 0, 1) * total
    for (let index = 0; index < lengths.length; index += 1) {
      if (distance <= cumulative[index + 1] || index === lengths.length - 1) {
        return { index, ratio: lengths[index] > EPSILON ? (distance - cumulative[index]) / lengths[index] : 0 }
      }
    }
    return { index: lengths.length - 1, ratio: 1 }
  }

  const evaluate = (parameter: number): Coordinate | null => {
    if (vertices.length === 0) return null
    if (!usable) return finitePoint(vertices[0])
    const { index, ratio } = locate(parameter)
    const first = vertices[index]
    const second = vertices[index + 1]
    return finitePoint({ x: first.x + (second.x - first.x) * ratio, y: first.y + (second.y - first.y) * ratio })
  }

  const projectPoint = (desired: Coordinate, options?: ProjectOptions): ConstraintProjection | null => {
    if (vertices.length === 0) return null
    if (!usable) {
      return { parameter: 0, branch: 0, point: { ...vertices[0] }, distance: pointDistance(vertices[0], desired), converged: true, iterations: 0, clamped: false }
    }
    let best: NearestSample | null = null
    for (let index = 0; index < lengths.length; index += 1) {
      const first = vertices[index]
      const second = vertices[index + 1]
      const dx = second.x - first.x
      const dy = second.y - first.y
      const lengthSq = dx * dx + dy * dy
      const ratio = lengthSq <= EPSILON ? 0 : clamp(((desired.x - first.x) * dx + (desired.y - first.y) * dy) / lengthSq, 0, 1)
      const point = { x: first.x + dx * ratio, y: first.y + dy * ratio }
      const parameter = (cumulative[index] + lengths[index] * ratio) / total
      const candidate: NearestSample = { parameter, point, distance: pointDistance(point, desired) }
      // 顶点处两段的投影完全重合，用上一次的参数打破平局，避免留在顶点上来回抖。
      const tie = options?.previousParameter !== undefined && best !== null && Math.abs(candidate.distance - best.distance) <= 1e-12
      const keepsContinuity = tie && Math.abs(candidate.parameter - options!.previousParameter!) < Math.abs(best!.parameter - options!.previousParameter!)
      if (!best || candidate.distance < best.distance || keepsContinuity) best = candidate
    }
    return best ? toProjection(best, 0, lengths.length) : null
  }

  return {
    kind: "polyline",
    id,
    branchCount: 1,
    parameterBounds: () => ({ min: 0, max: 1, wrap: false }),
    evaluate,
    project: projectPoint,
    residual(point) {
      const projection = projectPoint(point)
      return projection ? projection.distance : Number.POSITIVE_INFINITY
    },
    tangent(parameter) {
      if (!usable) return null
      const { index } = locate(parameter)
      const first = vertices[index]
      const second = vertices[index + 1]
      const length = lengths[index]
      if (length <= EPSILON) return null
      return { x: (second.x - first.x) / length, y: (second.y - first.y) / length }
    }
  }
}

// ---------------------------------------------------------------------------
// 函数图像约束：点在 y = f(x) 上
// ---------------------------------------------------------------------------

/**
 * 函数图像约束。参数就是 x 本身 —— 这是函数图像唯一自然的参数化，也保证了
 * 沿图像运动时 x 单调，不会在竖直切线上翻面。
 *
 * 投影不能简单地取 `(q.x, f(q.x))`：那求的是"同一 x 上的点"，不是最近点。
 * 真正要极小化的是 d(x)² = (x - q.x)² + (f(x) - q.y)²，用粗扫 + 黄金分割求解；
 * 当鼠标离图像很近时两者差别可以忽略，但在陡峭段（例如 x³）差别很大。
 */
export function functionGraphConstraint(id: string, value: (x: number) => number, domain: readonly [number, number]): PlanarConstraint {
  const min = Math.min(domain[0], domain[1])
  const max = Math.max(domain[0], domain[1])
  const safeValue = (x: number): number => {
    const result = value(x)
    return Number.isFinite(result) ? result : Number.NaN
  }
  const evaluate = (parameter: number): Coordinate | null => {
    const y = safeValue(parameter)
    return Number.isFinite(y) ? { x: parameter, y } : null
  }
  const span = Math.max(max - min, EPSILON)
  const scanCount = 64
  /**
   * 最近点落在定义域端点上 = 用户把点拖出了函数图像的可画范围。
   * 判据用相对容差，避免把"恰好在端点附近但在内部"的最近点误判为截断。
   */
  const isAtDomainEdge = (parameter: number): boolean => parameter <= min + span * 1e-9 || parameter >= max - span * 1e-9

  const projectPoint = (desired: Coordinate, options?: ProjectOptions): ConstraintProjection | null => {
    const sample = coarsestSample(evaluate, desired, min, max, scanCount)
    if (!sample) return null
    const step = span / scanCount
    const refined = goldenRefine(evaluate, desired, Math.max(min, sample.parameter - step), Math.min(max, sample.parameter + step), 64) ?? sample
    // 陡峭段的全局最近点会跳变，用上一次参数做一次窗口内细化，保证拖动连续。
    const previous = options?.previousParameter
    if (previous === undefined || !Number.isFinite(previous)) return toProjection(refined, 0, 1 + scanCount + 64, true, isAtDomainEdge(refined.parameter))
    const seed = clamp(previous, min, max)
    const local = nearestBySearch(evaluate, desired, {
      from: Math.max(min, seed - step),
      to: Math.min(max, seed + step),
      scan: 8,
      refineIterations: 48
    })
    const best = local && local.distance < refined.distance ? local : refined
    return toProjection(best, 0, 1 + scanCount + 64, true, isAtDomainEdge(best.parameter))
  }

  return {
    kind: "functionGraph",
    id,
    branchCount: 1,
    parameterBounds: () => ({ min, max, wrap: false }),
    evaluate,
    project: projectPoint,
    // 投影就是到图像的真实欧氏距离；同 x 的竖直距离在陡峭段会严重高估，不能用作命中判据。
    residual(point) {
      const projection = projectPoint(point)
      return projection ? projection.distance : Number.POSITIVE_INFINITY
    },
    tangent(parameter) {
      const y = safeValue(parameter)
      if (!Number.isFinite(y)) return null
      const step = Math.max(1e-6, Math.abs(parameter) * 1e-6)
      const forward = safeValue(parameter + step)
      const backward = safeValue(parameter - step)
      const slope = Number.isFinite(forward) && Number.isFinite(backward)
        ? (forward - backward) / (2 * step)
        : Number.isFinite(forward) ? (forward - y) / step : Number.isFinite(backward) ? (y - backward) / step : Number.NaN
      if (!Number.isFinite(slope)) return null
      const length = Math.hypot(1, slope)
      return { x: 1 / length, y: slope / length }
    }
  }
}

// ---------------------------------------------------------------------------
// 圆锥曲线约束
// ---------------------------------------------------------------------------

/** 一般二次式 A x² + B xy + C y² + D x + E y + F = 0 的系数。 */
export interface ConicCoefficients {
  A: number
  B: number
  C: number
  D: number
  E: number
  F: number
}

export function conicValue(coefficients: ConicCoefficients, point: Coordinate): number {
  const { A, B, C, D, E, F } = coefficients
  return A * point.x * point.x + B * point.x * point.y + C * point.y * point.y + D * point.x + E * point.y + F
}

export function conicGradient(coefficients: ConicCoefficients, point: Coordinate): Coordinate {
  const { A, B, C, D, E } = coefficients
  return { x: 2 * A * point.x + B * point.y + D, y: B * point.x + 2 * C * point.y + E }
}

export function conicHessian(coefficients: ConicCoefficients): { xx: number; xy: number; yy: number } {
  return { xx: 2 * coefficients.A, xy: coefficients.B, yy: 2 * coefficients.C }
}

/**
 * 椭圆的隐式系数。局部坐标 (X, Y) = R(-φ)(p - c) 满足 (X/a)² + (Y/b)² = 1；
 * 两边乘 a²b² 后展开，得到 b²X² + a²Y² - a²b² = 0，再代入旋转矩阵的展开式。
 */
export function ellipseConicCoefficients(ellipse: EllipsePrimitive): ConicCoefficients {
  const a = ellipse.radiusX
  const b = ellipse.radiusY
  const rotation = ellipse.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const A = b * b * cos * cos + a * a * sin * sin
  const B = 2 * (b * b - a * a) * sin * cos
  const C = b * b * sin * sin + a * a * cos * cos
  const { x: cx, y: cy } = ellipse.center
  return {
    A,
    B,
    C,
    D: -2 * A * cx - B * cy,
    E: -B * cx - 2 * C * cy,
    F: A * cx * cx + B * cx * cy + C * cy * cy - a * a * b * b
  }
}

/**
 * 双曲线的隐式系数。
 *
 * `sampleHyperbola` 的坐标约定容易被字面误读：`axis: "x"` 表示**参数沿 x 方向跑**，
 * 局部点是 `(u, ±b√(1 + u²/a²))`，于是**横轴其实落在 y 方向**上：
 *
 *     axis "x":  Y²/b² − X²/a² = 1   →   a²Y² − b²X² − a²b² = 0
 *     axis "y":  X²/b² − Y²/a² = 1   →   a²X² − b²Y² − a²b² = 0
 *
 * 两边同乘 `a²b²` 后，A、C 直接就是 X²、Y² 的系数，常数项两种情形都是 `−a²b²`。
 * （按字面取 `axis "x" → b²X² − a²Y²` 是错的：在 u=0 的顶点 (0, b) 上会算出 −72 而不是 0。）
 */
export function hyperbolaConicCoefficients(hyperbola: HyperbolaPrimitive): ConicCoefficients {
  const a = hyperbola.radiusX
  const b = hyperbola.radiusY
  const rotation = hyperbola.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const parameterAlongX = hyperbola.axis === "x"
  const qxx = parameterAlongX ? -b * b : a * a
  const qyy = parameterAlongX ? a * a : -b * b
  const A = qxx * cos * cos + qyy * sin * sin
  const B = 2 * (qxx - qyy) * sin * cos
  const C = qxx * sin * sin + qyy * cos * cos
  const { x: cx, y: cy } = hyperbola.center
  return {
    A,
    B,
    C,
    D: -2 * A * cx - B * cy,
    E: -B * cx - 2 * C * cy,
    F: A * cx * cx + B * cx * cy + C * cy * cy - a * a * b * b
  }
}

/**
 * 抛物线：axis "x" → Y² = 2p X；axis "y" → X² = 2p Y（局部坐标以顶点为原点，再按 rotation 旋转）。
 * 与 `sampleParabola` 的约定保持一致：axis "x" 表示开口沿 X 方向、参数 u 是纵向偏移。
 */
export function parabolaConicCoefficients(parabola: ParabolaPrimitive): ConicCoefficients {
  const focal = parabola.focalParameter
  const rotation = parabola.rotation ?? 0
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const opensAlongX = parabola.axis === "x"
  // 局部二次型与一次项：Y² - 2p X（或 X² - 2p Y）。
  const qxx = opensAlongX ? 0 : 1
  const qyy = opensAlongX ? 1 : 0
  const linearX = opensAlongX ? -2 * focal : 0
  const linearY = opensAlongX ? 0 : -2 * focal
  const A = qxx * cos * cos + qyy * sin * sin
  const B = 2 * (qxx - qyy) * sin * cos
  const C = qxx * sin * sin + qyy * cos * cos
  // 一次项跟着局部坐标轴转：world = c + R · local，所以 local 的线性系数变换为 R 作用在 (linearX, linearY) 上。
  const D0 = linearX * cos - linearY * sin
  const E0 = linearX * sin + linearY * cos
  const { x: cx, y: cy } = parabola.vertex
  return {
    A,
    B,
    C,
    D: D0 - 2 * A * cx - B * cy,
    E: E0 - B * cx - 2 * C * cy,
    F: A * cx * cx + B * cx * cy + C * cy * cy - D0 * cx - E0 * cy
  }
}

export type ConicPrimitive = ParabolaPrimitive | EllipsePrimitive | HyperbolaPrimitive

export function conicCoefficients(primitive: ConicPrimitive): ConicCoefficients {
  if (primitive.type === "ellipse") return ellipseConicCoefficients(primitive)
  if (primitive.type === "hyperbola") return hyperbolaConicCoefficients(primitive)
  return parabolaConicCoefficients(primitive)
}

/**
 * 椭圆约束。参数是**离心角** θ（不是极角）：P(θ) = c + R(φ)·(a cosθ, b sinθ)。
 * 这个参数化是精确、光滑、周期的，且天然只有一个分支 —— 轨迹采样用它不会碰到任何分支问题。
 * 投影用一维搜索，因为椭圆上"同离心角"的点并不是最近点（除非 a = b）。
 */
export function ellipseConstraint(id: string, ellipse: EllipsePrimitive): PlanarConstraint {
  const { center } = ellipse
  const a = Math.abs(ellipse.radiusX)
  const b = Math.abs(ellipse.radiusY)
  const rotation = ellipse.rotation ?? 0
  const evaluate = (parameter: number): Coordinate | null => finitePoint(rotateAround(
    { x: center.x + a * Math.cos(parameter), y: center.y + b * Math.sin(parameter) },
    center,
    rotation
  ))
  const projectPoint = (desired: Coordinate, options?: ProjectOptions): ConstraintProjection | null => {
    if (a <= EPSILON || b <= EPSILON) return null
    const local = toLocal(desired, center, rotation)
    // 用"把目标点缩放到单位圆"得到的离心角当种子：离心率不大时它几乎就是答案。
    const seed = Math.atan2(local.y / b, local.x / a)
    // 椭圆上可能有多个驻点，先整周粗扫再细化；传了上一次参数就对半个周期做加密搜索。
    const previous = options?.previousParameter
    const scan = previous === undefined ? 96 : 192
    const best = nearestBySearch(evaluate, desired, { from: seed - Math.PI, to: seed + Math.PI, scan, refineIterations: 80 })
    if (!best) return null
    // 参数是**周期**的（`parameterBounds` 声明 wrap，域 [0, 2π)），所以投影结果必须折回该域内。
    // 搜索窗口是围绕种子展开的，落在下半部分时会得到负角；不折回的话调用方按 [0, 1] 归一化时
    // 负角会被截断成 0，整段下半部分会塌到右顶点（实测：拖到 (0,-1) 会弹回 (4,0)）。
    return toProjection({ ...best, parameter: normalizeAngle(best.parameter) }, 0, scan + 80)
  }

  return {
    kind: "ellipse",
    id,
    branchCount: 1,
    parameterBounds: () => ({ min: 0, max: TWO_PI, wrap: true }),
    evaluate,
    project: projectPoint,
    residual(point) {
      const projection = projectPoint(point)
      return projection ? projection.distance : Number.POSITIVE_INFINITY
    },
    tangent(parameter) {
      const localTangent = { x: -a * Math.sin(parameter), y: b * Math.cos(parameter) }
      const length = Math.hypot(localTangent.x, localTangent.y)
      if (length <= EPSILON) return null
      const cos = Math.cos(rotation)
      const sin = Math.sin(rotation)
      return { x: (localTangent.x * cos - localTangent.y * sin) / length, y: (localTangent.x * sin + localTangent.y * cos) / length }
    }
  }
}

/**
 * 双曲线约束。参数 u ∈ ℝ，分支 0/1 分别取 ±：P(u) = c + R(φ)·(u, ±b√(1 + u²/a²))（axis "x"）。
 * u 是"轴向坐标"，在顶点附近均匀、在无穷远处近似按指数拉伸，正好匹配双曲线自身的伸缩。
 * `project` 传 `previousBranch` 时只在该分支搜索，这是拖动跨过渐近线时不换支的关键。
 */
export function hyperbolaConstraint(id: string, hyperbola: HyperbolaPrimitive): PlanarConstraint {
  const { center } = hyperbola
  const a = Math.abs(hyperbola.radiusX)
  const b = Math.abs(hyperbola.radiusY)
  const rotation = hyperbola.rotation ?? 0
  const opensAlongX = hyperbola.axis === "x"
  const evaluate = (parameter: number, branch = 0): Coordinate | null => {
    if (a <= EPSILON || b <= EPSILON) return null
    const transverse = b * Math.sqrt(1 + (parameter * parameter) / (a * a))
    const sign = branch === 1 ? -1 : 1
    const local = opensAlongX
      ? { x: parameter, y: sign * transverse }
      : { x: sign * transverse, y: parameter }
    return finitePoint(rotateAround({ x: center.x + local.x, y: center.y + local.y }, center, rotation))
  }
  const search = (desired: Coordinate, branch: number): NearestSample | null => {
    const local = toLocal(desired, center, rotation)
    const seed = opensAlongX ? local.x : local.y
    // 横向尺度取顶点间距离与目标纵向偏移的较大者，保证窗口覆盖住真正的最近点。
    const scale = Math.max(a, Math.abs(seed), Math.abs(opensAlongX ? local.y : local.x))
    const from = seed - scale
    const to = seed + scale
    const branchEvaluate = (parameter: number) => evaluate(parameter, branch)
    return nearestBySearch(branchEvaluate, desired, { from, to, scan: 64, refineIterations: 80 })
  }
  const projectPoint = (desired: Coordinate, options?: ProjectOptions): ConstraintProjection | null => {
    if (a <= EPSILON || b <= EPSILON) return null
    // 传了上一次分支就只在该分支搜索：拖动跨过渐近线时不换支，这是双曲线拖拽的正确语义。
    if (options?.previousBranch !== undefined) {
      const locked = search(desired, options.previousBranch)
      return locked ? toProjection(locked, options.previousBranch, 144) : null
    }
    const first = search(desired, 0)
    const second = search(desired, 1)
    if (!first && !second) return null
    if (!first) return toProjection(second!, 1, 144)
    if (!second) return toProjection(first, 0, 144)
    return first.distance <= second.distance ? toProjection(first, 0, 288) : toProjection(second, 1, 288)
  }

  return {
    kind: "hyperbola",
    id,
    branchCount: 2,
    parameterBounds: () => ({ min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY, wrap: false }),
    evaluate: (parameter, branch) => evaluate(parameter, branch),
    project: projectPoint,
    residual(point) {
      const projection = projectPoint(point)
      return projection ? projection.distance : Number.POSITIVE_INFINITY
    },
    tangent(parameter, branch = 0) {
      if (a <= EPSILON || b <= EPSILON) return null
      const transverse = b * Math.sqrt(1 + (parameter * parameter) / (a * a))
      if (transverse <= EPSILON) return null
      const sign = branch === 1 ? -1 : 1
      // d/du (±b√(1 + u²/a²)) = ±(b²u) / (a² · transverse)
      const slope = sign * (b * b * parameter) / (a * a * transverse)
      const localTangent = opensAlongX ? { x: 1, y: slope } : { x: slope, y: 1 }
      const length = Math.hypot(localTangent.x, localTangent.y)
      const cos = Math.cos(rotation)
      const sin = Math.sin(rotation)
      return { x: (localTangent.x * cos - localTangent.y * sin) / length, y: (localTangent.x * sin + localTangent.y * cos) / length }
    }
  }
}

/**
 * 抛物线约束。参数 u 与 `sampleParabola` 完全一致：axis "x" 时局部坐标 (u²/2p, u)，
 * axis "y" 时 (u, u²/2p)。投影用一维搜索，因为最小值满足一个三次方程（见 `parabolaNearestCubic`），
 * 数值求解比写 Cardano 公式更稳、也更容易处理 p < 0 的开口方向。
 */
export function parabolaConstraint(id: string, parabola: ParabolaPrimitive): PlanarConstraint {
  const focal = parabola.focalParameter
  const { vertex } = parabola
  const rotation = parabola.rotation ?? 0
  const opensAlongX = parabola.axis === "x"
  const usable = Number.isFinite(focal) && Math.abs(focal) > EPSILON
  const evaluate = (parameter: number): Coordinate | null => {
    if (!usable) return null
    const value = (parameter * parameter) / (2 * focal)
    const local = opensAlongX ? { x: value, y: parameter } : { x: parameter, y: value }
    return finitePoint(rotateAround({ x: vertex.x + local.x, y: vertex.y + local.y }, vertex, rotation))
  }
  const projectPoint = (desired: Coordinate, options?: ProjectOptions): ConstraintProjection | null => {
    if (!usable) return null
    const local = toLocal(desired, vertex, rotation)
    // 参数就是纵向/横向偏移本身，所以它直接给出一个很好的种子。
    const seed = options?.previousParameter !== undefined && Number.isFinite(options.previousParameter)
      ? options.previousParameter
      : opensAlongX ? local.y : local.x
    const scale = Math.max(1, Math.abs(seed), Math.abs(opensAlongX ? local.x : local.y))
    const best = nearestBySearch(evaluate, desired, { from: seed - scale, to: seed + scale, scan: 64, refineIterations: 80 })
    if (!best) return null
    return toProjection(best, 0, 144)
  }

  return {
    kind: "parabola",
    id,
    branchCount: 1,
    parameterBounds: () => ({ min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY, wrap: false }),
    evaluate,
    project: projectPoint,
    residual(point) {
      const projection = projectPoint(point)
      return projection ? projection.distance : Number.POSITIVE_INFINITY
    },
    tangent(parameter) {
      if (!usable) return null
      // d/du (u²/2p) = u/p
      const slope = parameter / focal
      const localTangent = opensAlongX ? { x: slope, y: 1 } : { x: 1, y: slope }
      const length = Math.hypot(localTangent.x, localTangent.y)
      const cos = Math.cos(rotation)
      const sin = Math.sin(rotation)
      return { x: (localTangent.x * cos - localTangent.y * sin) / length, y: (localTangent.x * sin + localTangent.y * cos) / length }
    }
  }
}

export function conicConstraint(id: string, primitive: ConicPrimitive): PlanarConstraint {
  if (primitive.type === "ellipse") return ellipseConstraint(id, primitive)
  if (primitive.type === "hyperbola") return hyperbolaConstraint(id, primitive)
  return parabolaConstraint(id, primitive)
}

// ---------------------------------------------------------------------------
// 隐式约束：F(x, y) = 0
// ---------------------------------------------------------------------------

export interface ImplicitCurve {
  /** F(x, y)，零水平集就是约束曲线。 */
  value(point: Coordinate): number
  gradient(point: Coordinate): Coordinate
  /** 二阶偏导 ∂²F/∂x², ∂²F/∂x∂y, ∂²F/∂y²；缺省时用中心差分近似。 */
  hessian?(point: Coordinate): { xx: number; xy: number; yy: number }
  /** 可选的精确参数化。没有它时该约束无法用于轨迹采样（只能投影）。 */
  parameterize?(parameter: number, branch: number): Coordinate | null
  branchCount?: number
  parameterBounds?: (branch: number) => ParameterBounds
  /** 投影的牛顿种子：给定目标点，返回若干初始参数。 */
  seed?(desired: Coordinate): number[]
}

function numericHessian(curve: ImplicitCurve, point: Coordinate): { xx: number; xy: number; yy: number } {
  const step = Math.max(1e-5, Math.hypot(point.x, point.y) * 1e-5)
  const fx = (x: number, y: number) => curve.value({ x, y })
  const xx = (fx(point.x + step, point.y) - 2 * fx(point.x, point.y) + fx(point.x - step, point.y)) / (step * step)
  const yy = (fx(point.x, point.y + step) - 2 * fx(point.x, point.y) + fx(point.x, point.y - step)) / (step * step)
  const xy = (fx(point.x + step, point.y + step) - fx(point.x + step, point.y - step) - fx(point.x - step, point.y + step) + fx(point.x - step, point.y - step)) / (4 * step * step)
  return { xx, xy, yy }
}

function solve3x3(matrix: number[][], rhs: number[]): number[] | null {
  const a = matrix.map((row, index) => [...row, rhs[index]])
  for (let column = 0; column < 3; column += 1) {
    let pivot = column
    for (let row = column + 1; row < 3; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row
    }
    if (Math.abs(a[pivot][column]) < 1e-14) return null
    ;[a[column], a[pivot]] = [a[pivot], a[column]]
    for (let row = column + 1; row < 3; row += 1) {
      const factor = a[row][column] / a[column][column]
      for (let index = column; index < 4; index += 1) a[row][index] -= factor * a[column][index]
    }
  }
  const solution = [0, 0, 0]
  for (let row = 2; row >= 0; row -= 1) {
    let sum = a[row][3]
    for (let column = row + 1; column < 3; column += 1) sum -= a[row][column] * solution[column]
    solution[row] = sum / a[row][row]
  }
  return solution
}

/**
 * 隐式曲线上的**最近点投影**（拉格朗日–牛顿法）。
 *
 * 问题：min ½|p - q|²  s.t.  F(p) = 0。
 * 拉格朗日条件给出方程组
 *
 *     G(p, λ) = [ p - q + λ ∇F(p) ]  = 0
 *               [ F(p)            ]
 *
 * 其雅可比矩阵为
 *
 *     J = [ I + λ H(p)   ∇F(p) ]
 *         [ ∇F(p)ᵀ        0    ]
 *
 * 每次迭代解一个 3×3 线性系统 J·[Δp; Δλ] = -G，再做一次带回退的线搜索。
 * 对二次曲线 H 是常数矩阵，收敛是二次的（通常 3~5 次迭代到机器精度）。
 *
 * 多起点（`curve.seed`）是为了绕开局部极小：隐式曲线可能有多支、多个驻点，
 * 单起点会系统性地落到错误的一支上。
 */
export function projectToImplicitCurve(
  curve: ImplicitCurve,
  desired: Coordinate,
  options: { seeds?: readonly Coordinate[]; maxIterations?: number; tolerance?: number } = {}
): ConstraintProjection | null {
  const tolerance = options.tolerance ?? 1e-12
  /**
   * 调用方给的迭代上限必须归一化：`maxIterations: 0`（或负数 / NaN）会让内层循环一次都不跑，
   * 于是要么把**种子点**当成投影返回（一个没迭代过的"投影"），要么直接返回 null 让拖拽卡住。
   * 0 / 负数 / 非有限值都视为"没有有效偏好"，用默认 40；正的有限值照旧尊重（哪怕是 1）。
   */
  const requestedIterations = options.maxIterations
  const maxIterations = Number.isFinite(requestedIterations) && (requestedIterations as number) >= 1 ? Math.floor(requestedIterations as number) : 40
  const seeds = options.seeds && options.seeds.length > 0 ? options.seeds : [desired]
  let best: ConstraintProjection | null = null

  for (const seed of seeds) {
    let x = seed.x
    let y = seed.y
    let lambda = 0
    let converged = false
    let iterations = 0

    for (; iterations < maxIterations; iterations += 1) {
      const point = { x, y }
      const f = curve.value(point)
      const gradient = curve.gradient(point)
      const residualPoint = { x: point.x - desired.x + lambda * gradient.x, y: point.y - desired.y + lambda * gradient.y }
      const norm = Math.hypot(residualPoint.x, residualPoint.y, f)
      if (!Number.isFinite(norm)) break
      if (norm <= tolerance) {
        converged = true
        break
      }
      const hessian = curve.hessian ? curve.hessian(point) : numericHessian(curve, point)
      const jacobian = [
        [1 + lambda * hessian.xx, lambda * hessian.xy, gradient.x],
        [lambda * hessian.xy, 1 + lambda * hessian.yy, gradient.y],
        [gradient.x, gradient.y, 0]
      ]
      const step = solve3x3(jacobian, [-residualPoint.x, -residualPoint.y, -f])
      if (!step) break
      // 回退线搜索：隐式约束的牛顿步可能把点甩到很远处，必须保证残差单调下降。
      let scale = 1
      let accepted = false
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const nextX = x + step[0] * scale
        const nextY = y + step[1] * scale
        const nextLambda = lambda + step[2] * scale
        if (!Number.isFinite(nextX) || !Number.isFinite(nextY) || !Number.isFinite(nextLambda)) {
          scale *= 0.5
          continue
        }
        const nextGradient = curve.gradient({ x: nextX, y: nextY })
        const nextF = curve.value({ x: nextX, y: nextY })
        const nextNorm = Math.hypot(nextX - desired.x + nextLambda * nextGradient.x, nextY - desired.y + nextLambda * nextGradient.y, nextF)
        if (Number.isFinite(nextNorm) && nextNorm < norm) {
          x = nextX
          y = nextY
          lambda = nextLambda
          accepted = true
          break
        }
        scale *= 0.5
      }
      if (!accepted) break
    }

    const point = { x, y }
    const distance = pointDistance(point, desired)
    if (!Number.isFinite(distance)) continue
    // 只接受真正落在曲线上的解；残差过大的解会让点"浮"在曲线旁边。
    const scale = Math.max(1, Math.abs(desired.x), Math.abs(desired.y))
    if (Math.abs(curve.value(point)) > 1e-6 * Math.max(1, Math.abs(scale * scale))) continue
    const candidate: ConstraintProjection = { parameter: 0, branch: 0, point, distance, converged, iterations, clamped: false }
    if (!best || candidate.distance < best.distance) best = candidate
  }
  return best
}

/**
 * 通用隐式曲线约束。没有精确参数化时 `evaluate` 返回 null，此时该约束只支持拖拽与命中测试；
 * 需要轨迹采样就请提供 `parameterize`（具名圆锥曲线用 `conicConstraint` 会自动带上）。
 *
 * `project` 返回的参数：若曲线给了参数化，就用投影点重新逼近一个参数（先找最近种子再做局部细化），
 * 否则返回 0 —— 调用方应把"参数无意义"当作正常情况，只使用 `point`。
 */
export function implicitCurveConstraint(id: string, curve: ImplicitCurve, options: { branchCount?: number; tolerance?: number } = {}): PlanarConstraint {
  const branchCount = options.branchCount ?? curve.branchCount ?? 1
  const bounds = (branch: number): ParameterBounds => curve.parameterBounds?.(branch) ?? { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY, wrap: false }
  const seedsFor = (desired: Coordinate): Coordinate[] => {
    const explicit = curve.seed?.(desired)
    if (explicit && explicit.length > 0 && curve.parameterize) {
      const points = explicit.map((parameter) => curve.parameterize!(parameter, 0)).filter((point): point is Coordinate => Boolean(point))
      if (points.length > 0) return points
    }
    // 默认多起点：目标点本身，加上围绕它的一圈点，用来跳出错误的局部极小。
    const scale = Math.max(1, Math.hypot(desired.x, desired.y))
    return [
      desired,
      { x: desired.x + scale, y: desired.y },
      { x: desired.x - scale, y: desired.y },
      { x: desired.x, y: desired.y + scale },
      { x: desired.x, y: desired.y - scale }
    ]
  }
  return {
    kind: "implicitCurve",
    id,
    branchCount,
    parameterBounds: (branch) => ({ ...bounds(branch ?? 0) }),
    evaluate: (parameter, branch) => (curve.parameterize ? finitePoint(curve.parameterize(parameter, branch ?? 0)) : null),
    project(desired, projectOptions) {
      const projection = projectToImplicitCurve(curve, desired, {
        seeds: seedsFor(desired),
        maxIterations: projectOptions?.maxIterations,
        tolerance: projectOptions?.tolerance ?? options.tolerance
      })
      if (!projection) return null
      // 参数化可用时，把最近点映射回参数，让下游（轨迹、滑块）拿到一个连续坐标。
      if (curve.parameterize) {
        const branch = projectOptions?.previousBranch ?? 0
        const range = bounds(branch)
        if (Number.isFinite(range.min) && Number.isFinite(range.max)) {
          const best = nearestBySearch((parameter) => curve.parameterize!(parameter, branch), projection.point, {
            from: range.min,
            to: range.max,
            scan: 64,
            refineIterations: 48
          })
          if (best) return { ...projection, parameter: best.parameter, branch }
        }
      }
      return projection
    },
    residual(point) {
      const gradient = curve.gradient(point)
      const slope = Math.hypot(gradient.x, gradient.y)
      const value = curve.value(point)
      // F 的梯度模长就是"F 随距离的变化率"，用它把 F 值换算成近似欧氏距离。
      if (slope > 1e-12) return Math.abs(value) / slope
      /**
       * 梯度为零时上式不成立：`|F|` 的量纲**不是**距离（椭圆中心会得到 F 的缩放值，例如 16，
       * 而真实距离是短半轴 1）。这种点用精确投影的距离——投影只读 `value` / `gradient` / `hessian`，
       * 不会回到 `residual`，因此这里不会递归。
       */
      const projection = projectToImplicitCurve(curve, point, { seeds: seedsFor(point), tolerance: options.tolerance })
      return projection ? projection.distance : Math.abs(value)
    },
    tangent(parameter, branch) {
      if (!curve.parameterize) return null
      const point = curve.parameterize(parameter, branch ?? 0)
      if (!point) return null
      const gradient = curve.gradient(point)
      const length = Math.hypot(gradient.x, gradient.y)
      return length <= EPSILON ? null : { x: -gradient.y / length, y: gradient.x / length }
    }
  }
}

/** 由一般二次式构造隐式约束，梯度与海森矩阵都是解析的（因此投影收敛很快）。 */
export function implicitConicConstraint(id: string, coefficients: ConicCoefficients, options: { branchCount?: number } = {}): PlanarConstraint {
  const hessian = conicHessian(coefficients)
  return implicitCurveConstraint(id, {
    value: (point) => conicValue(coefficients, point),
    gradient: (point) => conicGradient(coefficients, point),
    hessian: () => hessian
  }, options)
}

/**
 * 具名圆锥曲线 → 同时带**精确参数化**与**隐式系数**的约束。
 * 这是最适合实际使用的形态：拖拽走投影，轨迹采样走参数化，两者共享同一条曲线。
 */
export function primitiveConicConstraint(id: string, primitive: ConicPrimitive): PlanarConstraint {
  return conicConstraint(id, primitive)
}

// ---------------------------------------------------------------------------
// 曲线切线
// ---------------------------------------------------------------------------

/** 周期参数折叠到 [min, max)，避免长时间动画后参数无限增大而丢精度。 */
function wrapIntoDomain(parameter: number, min: number, max: number): number {
  const span = max - min
  if (!(span > 0) || !Number.isFinite(span)) return parameter
  const offset = (parameter - min) % span
  return min + (offset < 0 ? offset + span : offset)
}

export interface CurveTangent {
  /** 切点，**严格落在曲线上**（由 `evaluate` 求得，不是从切向推出来的）。 */
  point: Coordinate
  /** 单位切向。 */
  direction: Coordinate
  /** 实际使用的参数（周期曲线的参数会被折回参数域）。 */
  parameter: number
  branch: number
}

/**
 * 曲线在某个参数处的切线：**一个点 + 一个单位方向**。
 *
 * 这个抽象刻意不返回"斜截式"：曲线切线存在**竖直**的情形（圆的左右顶点、抛物线顶端在横轴朝向下），
 * 斜率在那里是无穷大，`y = kx + b` 会直接坏掉。点 + 方向对竖直/水平一视同仁。
 *
 * 切点必须由 `evaluate` 求出、而不是从切向积分回去 —— 后者会累积漂移，切点会慢慢离开曲线，
 * 这正是动态几何软件最经典的数值缺陷（与 `dynamic-points.ts` 是同一条原则）。
 *
 * 参数无定义（函数间断点、退化的圆锥曲线）或切向退化时返回 null，调用方据此报告"无法作切线"。
 */
export function constraintTangentAt(constraint: PlanarConstraint, parameter: number, branch = 0): CurveTangent | null {
  if (!Number.isFinite(parameter)) return null
  const safeBranch = clamp(Math.round(branch), 0, Math.max(0, constraint.branchCount - 1))
  const bounds = constraint.parameterBounds(safeBranch)
  // 周期曲线的参数折叠回参数域：圆上转过十圈之后参数是 20π，切向仍然对，
  // 但读数与"参数滑块"会一路飘走（同一个切点在滑块上显示成完全不同的数字）。
  const normalized = bounds.wrap && Number.isFinite(bounds.min) && Number.isFinite(bounds.max)
    ? wrapIntoDomain(parameter, bounds.min, bounds.max)
    : parameter
  const point = constraint.evaluate(normalized, safeBranch)
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null
  const tangent = constraint.tangent(normalized, safeBranch)
  if (!tangent) return null
  const length = Math.hypot(tangent.x, tangent.y)
  if (!Number.isFinite(length) || length <= EPSILON) return null
  return { point, direction: { x: tangent.x / length, y: tangent.y / length }, parameter: normalized, branch: safeBranch }
}

/**
 * 把切线表示成一段可视的线段：以切点为中心、沿单位方向向两侧各伸出 `halfLength`。
 *
 * 用线段（而不是无界直线）是刻意的：可见范围由调用方按曲线尺度给出，
 * 于是"圆上一点的切线"画出来和圆的直径差不多长，而不是横贯整个视野。
 */
export function tangentSegment(tangent: CurveTangent, halfLength: number): { a: Coordinate; b: Coordinate } {
  const half = Number.isFinite(halfLength) && halfLength > 0 ? halfLength : 1
  return {
    a: { x: tangent.point.x - tangent.direction.x * half, y: tangent.point.y - tangent.direction.y * half },
    b: { x: tangent.point.x + tangent.direction.x * half, y: tangent.point.y + tangent.direction.y * half }
  }
}

/** 法线：把切向转 90°。与切线共享同一份"点 + 方向"契约，因此竖直/水平同样一视同仁。 */
export function normalFromTangent(tangent: CurveTangent): CurveTangent {
  return { ...tangent, direction: { x: -tangent.direction.y, y: tangent.direction.x } }
}
