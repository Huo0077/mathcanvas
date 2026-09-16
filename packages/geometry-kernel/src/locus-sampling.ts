import type { Coordinate } from "@draw/dsl"

/**
 * 轨迹采样（Locus Generation）
 *
 * 问题：动点 P 在约束域内遍历时，从动点 Q 的坐标是 P 的参数 t 的连续（但未必处处连续、未必单值）函数。
 * 我们要的是一条能画出来的曲线，而现在只有"逐点求值"这一个原语。
 *
 * 三个必须解决的麻烦：
 *
 * 1. **代价**。每次求值 Q 都要跑一遍下游依赖图；均匀加密到 4096 点在 60fps 下是不可能的。
 *    解法：先均匀粗扫，再只在"曲线明显离开弦"的地方自适应细分（曲率驱动，而不是长度驱动）。
 *
 * 2. **渐近线**。Q 沿双曲线一支跑向无穷时，参数稍微一变 Q 就跳到很远处；
 *    如果按顺序把采样点连成一条折线，画面上会出现一条本该不存在的竖线。
 *    解法：用**中位数步长**做鲁棒基准，找出异常跨步，再二分定位断点，把轨迹切成多条分支。
 *
 * 3. **无定义点**。函数图像的间断点、圆锥曲线的复根区间会让 `evaluate` 返回 null。
 *    这些位置同样必须切断，而不是拿前一个点顶上。
 *
 * 采样器本身纯函数：它只调用传入的 `evaluate`，不碰任何几何状态，因此可以脱机测试，
 * 也可以复用于 3D 轨迹。
 */

export interface LocusSamplingOptions {
  /** 参数区间 `[t0, t1]`。 */
  domain: readonly [number, number]
  /** 均匀粗扫的采样点数（含两端）。 */
  samples: number
  /** 形状细分阈值：采样中点到弦的距离超过它就继续二分（世界单位）。 */
  tolerance?: number
  /** 异常跨步的判定倍数：步长 > `jumpFactor × 中位数步长` 视为可疑断点。 */
  jumpFactor?: number
  /** 单步的绝对上限（世界单位）。与 `jumpFactor` 取更严的那个。 */
  maxJump?: number
  /** 形状细分的最大递归深度。 */
  maxDepth?: number
  /** 断点二分定位的最大深度（分辨率约 `区间 / 2^breakDepth`）。 */
  breakDepth?: number
  /** 求值总次数上限，超过就截断并置 `truncated`。 */
  maxEvaluations?: number
  /** 分支号（双曲线等）。 */
  branch?: number
}

export interface LocusBranch {
  /** 该分支上的采样点（无重复点、按参数升序）。 */
  points: Coordinate[]
  /** 该分支覆盖的参数区间。 */
  from: number
  to: number
}

export interface LocusResult {
  /** 按参数顺序排列的**连通分支**。消费方不要跨分支连线。 */
  branches: LocusBranch[]
  /** 实际调用 `evaluate` 的次数。 */
  evaluations: number
  /** 断点参数：渐近线、间断点、约束域的边界。 */
  breaks: number[]
  /** 求值为 null / 非有限的采样点数。 */
  undefinedCount: number
  /** 是否因为 `maxEvaluations` 而提前结束。 */
  truncated: boolean
}

interface Sample {
  parameter: number
  point: Coordinate | null
}

function pointToSegmentDistance(point: Coordinate, start: Coordinate, end: Coordinate): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq <= 1e-24) return Math.hypot(point.x - start.x, point.y - start.y)
  const raw = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq
  const ratio = raw < 0 ? 0 : raw > 1 ? 1 : raw
  return Math.hypot(point.x - (start.x + dx * ratio), point.y - (start.y + dy * ratio))
}

/** 中位数：比均值更抗异常值，正好用来分辨"真正的跳跃"和"正常的粗步长"。 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((first, second) => first - second)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function isFinitePoint(point: Coordinate | null): point is Coordinate {
  return Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y))
}

/**
 * 对动点驱动的从动点采样出轨迹分支。
 *
 * **求值顺序约定**：自适应细分会产生非单调的求值顺序（先算大步的中点，再回头补算它的半边）。
 * 因此 `evaluate` 必须是参数的**纯函数**。若求值器依赖预热状态（例如交点求解要在两个解之间
 * 保持同一支），请先调用 `monotoneWarmup` 沿参数升序把它驱到稳定状态。
 *
 * @param evaluate 参数 → 从动点坐标。返回 null 表示该参数处从动点无定义。
 */
export function sampleLocus(evaluate: (parameter: number) => Coordinate | null, options: LocusSamplingOptions): LocusResult {
  const [rawStart, rawEnd] = options.domain
  const start = Math.min(rawStart, rawEnd)
  const end = Math.max(rawStart, rawEnd)
  const sampleCount = Math.max(2, Math.floor(options.samples))
  const tolerance = options.tolerance ?? 1e-3
  const jumpFactor = options.jumpFactor ?? 4
  const maxDepth = options.maxDepth ?? 6
  const breakDepth = options.breakDepth ?? 24
  const maxEvaluations = options.maxEvaluations ?? 8192

  let evaluations = 0
  let truncated = false
  const cache = new Map<number, Coordinate | null>()

  const evaluateAt = (parameter: number): Coordinate | null => {
    const cached = cache.get(parameter)
    if (cached !== undefined) return cached
    if (evaluations >= maxEvaluations) {
      truncated = true
      return null
    }
    evaluations += 1
    const raw = evaluate(parameter)
    const normalized = isFinitePoint(raw) ? raw : null
    cache.set(parameter, normalized)
    return normalized
  }

  if (!(end > start) || !Number.isFinite(start) || !Number.isFinite(end)) {
    return { branches: [], evaluations: 0, breaks: [], undefinedCount: 0, truncated: false }
  }

  // ---- 第 1 轮：均匀粗扫 ----------------------------------------------------
  const step = (end - start) / (sampleCount - 1)
  const baseParameters: number[] = []
  for (let index = 0; index < sampleCount; index += 1) baseParameters.push(index === sampleCount - 1 ? end : start + step * index)
  const basePoints = baseParameters.map(evaluateAt)
  const undefinedCount = basePoints.filter((point) => !isFinitePoint(point)).length

  // 中位数步长只统计"两端都有定义"的相邻对，异常跳跃不会污染基准。
  const steps: number[] = []
  for (let index = 1; index < basePoints.length; index += 1) {
    const previous = basePoints[index - 1]
    const current = basePoints[index]
    if (isFinitePoint(previous) && isFinitePoint(current)) steps.push(Math.hypot(current.x - previous.x, current.y - previous.y))
  }
  const typicalStep = median(steps)
  const jumpThreshold = Math.max(
    typicalStep * jumpFactor,
    // 中位数为 0（轨迹退化成一点）时仍然需要一个下限，否则任何微小步长都会被当成断点。
    Math.max(typicalStep, 1e-9),
    Number.isFinite(options.maxJump ?? Number.POSITIVE_INFINITY) ? (options.maxJump as number) : 0
  )

  // ---- 第 2 轮：定位断点 ----------------------------------------------------
  const breaks: number[] = []
  const continuousPairs: boolean[] = []

  const bisectBreak = (lowSample: Sample, highSample: Sample): number | null => {
    let low = lowSample.parameter
    let high = highSample.parameter
    let lowPoint = lowSample.point as Coordinate
    let highPoint = highSample.point as Coordinate
    for (let iteration = 0; iteration < breakDepth; iteration += 1) {
      const middle = (low + high) / 2
      if (middle === low || middle === high) break
      const middlePoint = evaluateAt(middle)
      if (!isFinitePoint(middlePoint)) {
        // 中点无定义：断点就在这里，再二分一次取更贴近的一侧。
        return middle
      }
      const lowGap = Math.hypot(middlePoint.x - lowPoint.x, middlePoint.y - lowPoint.y)
      const highGap = Math.hypot(highPoint.x - middlePoint.x, highPoint.y - middlePoint.y)
      // 两侧都短了，说明这一对本来就连续，只是粗扫步长太大。
      if (lowGap <= jumpThreshold / 2 && highGap <= jumpThreshold / 2) return null
      // 往更长的一侧收缩，把断点夹在中间。
      if (lowGap >= highGap) {
        high = middle
        highPoint = middlePoint
      } else {
        low = middle
        lowPoint = middlePoint
      }
    }
    if (!(Math.abs(high - low) > (end - start) * 1e-9)) return null
    return (low + high) / 2
  }

  for (let index = 1; index < baseParameters.length; index += 1) {
    const previous = basePoints[index - 1]
    const current = basePoints[index]
    if (!isFinitePoint(previous) || !isFinitePoint(current)) {
      continuousPairs.push(false)
      breaks.push((baseParameters[index - 1] + baseParameters[index]) / 2)
      continue
    }
    const gap = Math.hypot(current.x - previous.x, current.y - previous.y)
    if (gap <= jumpThreshold) {
      continuousPairs.push(true)
      continue
    }
    const located = bisectBreak(
      { parameter: baseParameters[index - 1], point: previous },
      { parameter: baseParameters[index], point: current }
    )
    continuousPairs.push(located === null)
    if (located !== null) breaks.push(located)
  }

  const sortedBreaks = [...breaks].sort((first, second) => first - second)

  // ---- 第 3 轮：形状自适应细分 ---------------------------------------------
  // 断点已经定好了，这里只在"连续段内部"加密，绝不会跨过断点，因此不会把两支连起来。
  const refineSegment = (low: Sample, high: Sample, depth: number, out: Sample[]): void => {
    if (depth >= maxDepth || out.length > maxEvaluations) return
    const lowPoint = low.point as Coordinate
    const highPoint = high.point as Coordinate
    const middle = (low.parameter + high.parameter) / 2
    if (middle === low.parameter || middle === high.parameter) return
    const middlePoint = evaluateAt(middle)
    if (!isFinitePoint(middlePoint)) return
    const deviation = pointToSegmentDistance(middlePoint, lowPoint, highPoint)
    if (deviation <= tolerance) {
      // 弦已经足够贴合曲线，中点不必保留 —— 这正是"无冗余采样"的体现。
      return
    }
    refineSegment(low, { parameter: middle, point: middlePoint }, depth + 1, out)
    out.push({ parameter: middle, point: middlePoint })
    refineSegment({ parameter: middle, point: middlePoint }, high, depth + 1, out)
  }

  const branches: LocusBranch[] = []
  let runStart = 0
  const flushRun = (runEnd: number) => {
    const run: Sample[] = []
    for (let index = runStart; index <= runEnd; index += 1) {
      const point = basePoints[index]
      if (isFinitePoint(point)) run.push({ parameter: baseParameters[index], point })
    }
    runStart = runEnd + 1
    if (run.length < 2) return
    const refined: Sample[] = []
    for (let index = 1; index < run.length; index += 1) {
      refineSegment(run[index - 1], run[index], 0, refined)
    }
    const merged = [...run, ...refined].sort((first, second) => first.parameter - second.parameter)
    const points = merged.map((sample) => sample.point as Coordinate)
    if (points.length < 2) return
    branches.push({ points, from: merged[0].parameter, to: merged[merged.length - 1].parameter })
  }

  for (let index = 1; index < baseParameters.length; index += 1) {
    if (!continuousPairs[index - 1]) flushRun(index - 1)
  }
  flushRun(baseParameters.length - 1)

  return { branches, evaluations: evaluations, breaks: sortedBreaks, undefinedCount, truncated }
}

/**
 * 单调预热。
 *
 * 依赖"上一次状态"的求值器（典型例子：交点在两个解之间定支、投影沿分支连续）在非单调的
 * 细分顺序下可能选错支。沿参数升序先空跑一遍，把状态驱到稳定，再交给 `sampleLocus` 做自适应细分。
 * 代价是 `count` 次额外求值，换来的是细分阶段可以安全地乱序调用。
 */
export function monotoneWarmup(evaluate: (parameter: number) => Coordinate | null, domain: readonly [number, number], count = 64): number {
  const start = Math.min(domain[0], domain[1])
  const end = Math.max(domain[0], domain[1])
  const steps = Math.max(2, Math.floor(count))
  for (let index = 0; index < steps; index += 1) evaluate(index === steps - 1 ? end : start + (end - start) * index / (steps - 1))
  return steps
}
