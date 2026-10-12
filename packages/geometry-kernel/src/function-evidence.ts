import { findZeros, numericalDerivative, sampleFunctionSegments, type FunctionSamplePoint } from "./calculus"
import { compileExpression, evaluateExpression, type ExpressionNode } from "./expression"

/**
 * **函数与导数的证据分级**（计划 `Task 15｜函数与导数真题纵向交付`）。
 *
 * ## 这个模块存在的唯一理由
 *
 * 计划原文两句话：**"可由代数或经独立验算的数值根构造切线/交点时才称已核验，
 * '数值图像'与'全区间根数/单调性已证明'分开状态"**，以及
 * **"同一题的数值画图成功不得升级为形式证明"**。
 *
 * 所以每条读数都带两个**互相独立**的字段：
 *
 * - `grade`：这条读数**是怎么来的** ——
 *   `algebraic`（判别式给出的重数结构，不依赖采样分辨率）、
 *   `verified-numeric`（采样定界 + 每个根/切点自己回代）、
 *   `plot-only`（只有采样折线，**不足以**声称任何个数）；
 * - `complete`：**个数能不能当个数用**。为假时 `roots.length` / `tangents.length`
 *   只是"找到的个数"，不是"恰好这么多"。
 *
 * ## 记录的边界（如实写在这里，不含糊）
 *
 * ① `algebraic` 只覆盖**多项式且次数 ≤ 2**：判别式的符号在双精度下判定，
 *    这不是符号计算；次数 ≥ 3 的多项式走数值路径（`verified-numeric`），
 *    因为本仓没有三次及以上的代数根式/重数求解器。
 * ② `complete` 是**数值完备性**，不是形式证明：它由"两个采样分辨率给出的零点个数一致"
 *    与"没有残差降到零附近却不变号的格子"两条合成。它能挡住漏近重根，
 *    但推不出"全区间根数已证明"——后者要有单调性/介值定理的证明，本任务不做。
 * ③ 超出一元显式函数（隐式、分段手写、抽象函数）一律 `unsupported`，
 *    不许拿采样图冒充。
 */

export type EvidenceGrade = "algebraic" | "verified-numeric" | "plot-only"

/** 斜截式直线 `y = slope·x + intercept`（函数族的题面直线）。 */
export interface TangentLine {
  slope: number
  intercept: number
}

export interface EvidenceOptions {
  /** 采样步数（会被归一化到 [32, 4096]）。 */
  steps?: number
  /** 判零相对容差（乘上该函数的取值尺度）。 */
  tolerance?: number
}

/** 采样图像：折线本身 + 采样中判出的断点。**永远只是折线**，`grade` 恒为 `plot-only`。 */
export interface GraphEvidence {
  segments: FunctionSamplePoint[][]
  /** 两条折线之间那道缝的位置（间断点/无定义点的横坐标估计）。 */
  breaks: number[]
  grade: EvidenceGrade
  note: string
}

export interface FunctionRoot {
  x: number
  y: number
  /** 重数：代数路径给得出 2 的才是真重根；数值路径只在"分辨不出的近重根"上给 2。 */
  multiplicity: 1 | 2
}

export interface RootSet {
  roots: FunctionRoot[]
  grade: EvidenceGrade
  /** `roots.length` 能否当**根数**用。 */
  complete: boolean
  diagnostic?: string
}

/** 过定点的切线（2021 新高考Ⅰ卷 7 题：从曲线外一点作切线）。 */
export interface ExternalTangent {
  /** 切点的自变量取值。 */
  parameter: number
  x: number
  y: number
  slope: number
  intercept: number
  /** 直线过定点这件事的残差：`|point.y − (y + slope·(point.x − x))|`。 */
  residual: number
}

/** 一条同时切两条曲线的直线（2024 新课标Ⅰ卷 13 题）。 */
export interface CommonTangent extends TangentLine {
  first: { parameter: number; x: number; y: number }
  second: { parameter: number; x: number; y: number }
  /** 四个回代量的最大值：两处点在线上的偏差、两处斜率与导数的偏差。 */
  residual: number
}

export interface TangentSet<T> {
  status: "solved" | "none" | "unsupported"
  tangents: T[]
  grade: EvidenceGrade
  /** 切线**条数**是否被复核过（见文件头边界②）。 */
  complete: boolean
  diagnostic?: string
}

export interface TangentVerdict {
  tangent: boolean
  parameter: number | null
  /** 直线与曲线在最近处的偏差（不相切时就是"离得多远"）。 */
  residual: number
  reason: string
}

/**
 * **这一点可不可导**（反例"错切点"的第二半）。
 *
 * 判据用**单侧差商**：`|x|` 在 `x = 0` 处左导 −1、右导 +1 —— 中心差分
 * `(|h| − |−h|)/2h` 会给出漂亮的 `0`，于是判据"斜率 = 0 通过"，把尖点当成水平切点。
 * 今天实测就是这条路（见 `diagramVerification.test.ts` 的红例）。
 *
 * 三种拒绝理由分开写：该点无定义 / 只有单侧导数 / 左右导数不等（尖点）。
 */
export interface DifferentiabilityVerdict {
  differentiable: boolean
  /** 可导时的导数（左右导数的平均）。 */
  derivative: number | null
  left: number | null
  right: number | null
  reason: string
}

export function differentiabilityAt(source: string, x: number, domain?: [number, number]): DifferentiabilityVerdict {
  const evaluate = compiledOrNull(source)
  if (evaluate === null) {
    return { differentiable: false, derivative: null, left: null, right: null, reason: `表达式 ${source} 解析不了，判不了可导性。` }
  }
  if (domain !== undefined && (x < domain[0] || x > domain[1])) {
    return { differentiable: false, derivative: null, left: null, right: null, reason: `x = ${formatNumber(x)} 不在定义域 [${formatNumber(domain[0])}, ${formatNumber(domain[1])}] 里。` }
  }
  const center = evaluate(x)
  if (!Number.isFinite(center)) {
    return { differentiable: false, derivative: null, left: null, right: null, reason: `x = ${formatNumber(x)} 处函数没有定义（${formatNumber(center)}），那里不可能有切线。` }
  }
  const scale = Math.max(1, Math.abs(center))
  const h = 1e-6 * scale
  const forward = evaluate(x + h)
  const backward = evaluate(x - h)
  const right = Number.isFinite(forward) ? (forward - center) / h : null
  const left = Number.isFinite(backward) ? (center - backward) / h : null
  if (left === null || right === null) {
    return {
      differentiable: false,
      derivative: null,
      left,
      right,
      reason: `x = ${formatNumber(x)} 处只有单侧导数（左 ${left === null ? "不存在" : formatNumber(left)}、右 ${right === null ? "不存在" : formatNumber(right)}），该点没有切线。`
    }
  }
  const tolerance = 1e-4 * Math.max(1, Math.abs(left), Math.abs(right))
  if (Math.abs(left - right) > tolerance) {
    return {
      differentiable: false,
      derivative: null,
      left,
      right,
      reason: `x = ${formatNumber(x)} 处**左右导数不等**（左 ${formatNumber(left)}、右 ${formatNumber(right)}）：这是尖点/角点，该点没有切线。`
    }
  }
  return { differentiable: true, derivative: (left + right) / 2, left, right, reason: `x = ${formatNumber(x)} 处可导，导数 ≈ ${formatNumber((left + right) / 2)}。` }
}


export interface UniversalClaim {
  scope: "at-parameters" | "all-parameters"
  parameterNames: readonly string[]
}

export interface UniversalClaimVerdict {
  /** 这条主张**实际**被支持到的范围 —— 只有 `at-parameters` 这一种可能。 */
  scope: "at-parameters" | "all-parameters"
  grade: EvidenceGrade
  upheld: boolean
  reason: string
}

const DEFAULT_STEPS = 256

function normalizedSteps(value: number | undefined, fallback = DEFAULT_STEPS): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(32, Math.min(4096, Math.floor(value)))
}

function normalizedTolerance(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 1e-9
  return Math.min(1, value)
}

/** 表达式求值器；解析不了就返回 `null`（调用方一律落到"未核验"，不许猜）。 */
function compiledOrNull(source: string): ((x: number) => number) | null {
  try {
    const compiled = compileExpression(source)
    return (x: number) => evaluateExpression(compiled, { x })
  } catch {
    return null
  }
}

/** 区间上 |取值| 的尺度，用来把"绝对容差"变成"相对容差"。 */
function valueScale(values: readonly number[]): number {
  let scale = 1
  for (const value of values) if (Number.isFinite(value)) scale = Math.max(scale, Math.abs(value))
  return scale
}

/** 二分求根；两端必须异号，过程中出现非有限值就放弃（返 `null`，不硬编一个数）。 */
function bisect(g: (x: number) => number, low: number, high: number, iterations = 64): number | null {
  let a = low
  let b = high
  let fa = g(a)
  if (!Number.isFinite(fa)) return null
  for (let index = 0; index < iterations; index += 1) {
    const midpoint = (a + b) / 2
    const value = g(midpoint)
    if (!Number.isFinite(value)) return null
    if (value === 0) return midpoint
    if (fa * value < 0) {
      b = midpoint
    } else {
      a = midpoint
      fa = value
    }
  }
  return (a + b) / 2
}

/** 采样折线 + 采样中判出的断点。 */
export function functionGraphEvidence(source: string, domain: [number, number], options: EvidenceOptions = {}): GraphEvidence {
  const evaluate = compiledOrNull(source)
  if (evaluate === null) {
    return { segments: [], breaks: [], grade: "plot-only", note: `表达式 ${source} 解析不了，没有图像可读。` }
  }
  if (!Number.isFinite(domain[0]) || !Number.isFinite(domain[1]) || !(domain[0] < domain[1])) {
    return { segments: [], breaks: [], grade: "plot-only", note: "定义域不是有限递增区间，采样没有意义。" }
  }
  const steps = normalizedSteps(options.steps)
  const segments = sampleFunctionSegments(evaluate, domain, steps)
  const breaks: number[] = []
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1]
    const next = segments[index]
    if (previous.length === 0 || next.length === 0) continue
    breaks.push((previous[previous.length - 1].x + next[0].x) / 2)
  }
  const note = breaks.length > 0
    ? `采样在 ${breaks.map((entry) => formatNumber(entry)).join("、")} 处断开：那是无定义点或间断点，折线不许跨过去连。`
    : "采样没有发现断点 —— 这只说明**这些采样点之间**没看出断点，不是「处处连续」的证明。"
  return { segments, breaks, grade: "plot-only", note }
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(6)).toString()
}

/**
 * **单变量多项式的系数向量**（下标 = 次数，末尾零系数去掉）。
 *
 * 只认 `+ − * /（除常数）^（非负整数指数）`；出现任何函数调用（`sin`/`exp`/`ln`…）
 * 或变量除变量就返回 `null` —— 那时这条曲线不是多项式，必须走数值路径。
 */
type Coefficients = number[]

function trim(coefficients: Coefficients): Coefficients {
  const next = [...coefficients]
  while (next.length > 1 && next[next.length - 1] === 0) next.pop()
  return next
}

function polynomialAdd(first: Coefficients, second: Coefficients): Coefficients {
  const length = Math.max(first.length, second.length)
  const out: Coefficients = []
  for (let index = 0; index < length; index += 1) out.push((first[index] ?? 0) + (second[index] ?? 0))
  return trim(out)
}

function polynomialMultiply(first: Coefficients, second: Coefficients): Coefficients {
  const out: Coefficients = new Array(first.length + second.length - 1).fill(0)
  for (let index = 0; index < first.length; index += 1) {
    for (let other = 0; other < second.length; other += 1) out[index + other] += first[index] * second[other]
  }
  return trim(out)
}

function polynomialPower(base: Coefficients, exponent: number): Coefficients {
  let out: Coefficients = [1]
  for (let index = 0; index < exponent; index += 1) out = polynomialMultiply(out, base)
  return out
}

function constantValue(coefficients: Coefficients): number | null {
  return coefficients.length === 1 ? coefficients[0] : null
}

function polynomialOf(node: ExpressionNode, variable = "x"): Coefficients | null {
  if (node.type === "number") return [node.value]
  if (node.type === "variable") return node.name === variable ? [0, 1] : null
  if (node.type === "call") return null
  if (node.type === "unary") {
    const inner = polynomialOf(node.argument, variable)
    if (inner === null) return null
    return node.operator === "+" ? inner : inner.map((value) => -value)
  }
  const left = polynomialOf(node.left, variable)
  const right = polynomialOf(node.right, variable)
  if (left === null || right === null) return null
  if (node.operator === "+") return polynomialAdd(left, right)
  if (node.operator === "-") return polynomialAdd(left, right.map((value) => -value))
  if (node.operator === "*") return polynomialMultiply(left, right)
  if (node.operator === "/") {
    const divisor = constantValue(right)
    return divisor === null || divisor === 0 ? null : left.map((value) => value / divisor)
  }
  const exponent = constantValue(right)
  if (exponent === null || !Number.isInteger(exponent) || exponent < 0 || exponent > 16) return null
  return polynomialPower(left, exponent)
}

function coefficientsOf(source: string): Coefficients | null {
  try {
    return polynomialOf(compileExpression(source))
  } catch {
    return null
  }
}

/**
 * **二次判别式给出的重数结构** —— 本模块里唯一敢叫 `algebraic` 的那条路。
 *
 * `a x² + b x + c`：判别式 `b² − 4ac` 的符号直接决定"0 / 1（重根）/ 2"，
 * 与采样分辨率无关。两个根相距 2e-5 时采样必然漏掉，判别式不会。
 *
 * **判零用相对容差**：`|判别式| ≤ 1e-12 · (b² + |4ac| + 1)` 当重根 —— 双精度下的
 * 判别式本身有约 1e-16 相对误差，写死 `=== 0` 会把真重根判成两个虚根。
 */
function quadraticRoots(a: number, b: number, c: number): { roots: number[]; multiplicity: 1 | 2 } | null {
  const discriminant = b * b - 4 * a * c
  const scale = b * b + Math.abs(4 * a * c) + 1
  if (Math.abs(discriminant) <= 1e-12 * scale) return { roots: [-b / (2 * a)], multiplicity: 2 }
  if (discriminant < 0) return { roots: [], multiplicity: 1 }
  const spread = Math.sqrt(discriminant)
  return { roots: [(-b - spread) / (2 * a), (-b + spread) / (2 * a)].sort((first, second) => first - second), multiplicity: 1 }
}

function algebraicRootsX(coefficients: Coefficients): { roots: { x: number; multiplicity: 1 | 2 }[]; unsupported?: string } | null {
  const degree = coefficients.length - 1
  if (degree <= 0) {
    return coefficients[0] === 0
      ? { roots: [], unsupported: "恒为零多项式：整条定义域上都是根，根集不是一个有限数。" }
      : { roots: [] }
  }
  if (degree === 1) return { roots: [{ x: -coefficients[0] / coefficients[1], multiplicity: 1 }] }
  if (degree === 2) {
    const solved = quadraticRoots(coefficients[2], coefficients[1], coefficients[0])
    if (solved === null) return null
    return { roots: solved.roots.map((x) => ({ x, multiplicity: solved.multiplicity })) }
  }
  return null
}

interface ResidualSolution {
  xs: { x: number; multiplicity: 1 | 2 }[]
  complete: boolean
  diagnostic?: string
}

/** 每个格子上残差是否变号（用于两个分辨率的个数一致性）。 */
function signChangeCount(residual: (x: number) => number, domain: [number, number], steps: number): number {
  let count = 0
  for (const segment of sampleFunctionSegments(residual, domain, steps)) {
    for (let index = 1; index < segment.length; index += 1) {
      const first = segment[index - 1]
      const second = segment[index]
      if (first.y * second.y < 0) count += 1
    }
  }
  return count
}

/**
 * **残差降到零附近却不变号的格子** —— 近重根/切根藏在这里。
 *
 * 均匀采样的每格两端同号时，朴素做法报"这格没有根"；但一对相距小于格宽的根
 * （或一个重根）恰恰长这样。这里把它标出来：**发现不了就承认发现不了**。
 */
function nearZeroDips(residual: (x: number) => number, domain: [number, number], steps: number, floor: number): number[] {
  const dips: number[] = []
  for (const segment of sampleFunctionSegments(residual, domain, steps)) {
    for (let index = 1; index < segment.length; index += 1) {
      const first = segment[index - 1]
      const second = segment[index]
      if (first.y * second.y < 0) continue
      const midpoint = residual((first.x + second.x) / 2)
      if (Number.isFinite(midpoint) && Math.abs(midpoint) <= floor) dips.push((first.x + second.x) / 2)
    }
  }
  return dips
}

/**
 * **残差的临界点**（`r′ = 0`）—— 重根/切根一定出现在这里。
 *
 * 用均匀扫描 + 二分，而不是复用 `findZeros`：数值导数的自适应细化会在
 * 噪声上继续细分成百上千次，既慢又给出不稳定的位置。
 */
function criticalPoints(residual: (x: number) => number, domain: [number, number], steps: number): number[] {
  const derivative = (x: number) => numericalDerivative(residual, x)
  /**
   * 导数落在判零带内的**采样点本身**也算候选：重根处的对称性常常正好落在格点上
   * （例如 `r(t) = 0.5 − eᵗ(1 − t)` 在 `t = 0` 的极大、`2021Ⅰ-7` 的临界就是它），
   * 而"严格异号"的扫描这时两边都推不出一对异号值，会把临界点漏掉。
   * 误报无害：候选还要过"残差本身落在判零带内"那一关。
   */
  const derivativeFloor = 1e-6 * valueScale([residual(domain[0]), residual(domain[1]), residual((domain[0] + domain[1]) / 2)])
  return zerosOf(derivative, domain, steps, derivativeFloor)
}

/**
 * **牛顿抛光**：二分把根定到约 1e-8 就停了，而回代判据是 1e-9 —— 直接拿二分结果
 * 回代，残差会被 `|r′|·δt` 顶到 1e-8 量级，于是**每一条真切线都被自己的判据丢掉**
 * （2026-10-12 实测：`(0, 0.5)` 向 `eˣ` 的两条切线只活下来一条）。
 *
 * 抛光保留"过程中绝对值最小的那个点"，重根处牛顿步会发散，那时退回二分结果。
 */
function polish(g: (x: number) => number, start: number, iterations = 24): number {
  let best = start
  let bestValue = Math.abs(g(start))
  let current = start
  for (let index = 0; index < iterations; index += 1) {
    if (bestValue === 0) break
    const slope = numericalDerivative(g, current)
    if (!Number.isFinite(slope) || slope === 0) break
    const next = current - g(current) / slope
    if (!Number.isFinite(next)) break
    const value = Math.abs(g(next))
    if (value < bestValue) {
      best = next
      bestValue = value
    }
    current = next
  }
  return best
}

/** `g(x) = 0` 的零点：均匀扫描 + 二分 + 落在采样点上的精确零。 */
function zerosOf(g: (x: number) => number, domain: [number, number], steps: number, floor: number): number[] {
  const width = (domain[1] - domain[0]) / steps
  const zeros: number[] = []
  let previousX = domain[0]
  let previousValue = g(previousX)
  for (let index = 0; index <= steps; index += 1) {
    const x = domain[0] + width * index
    const value = g(x)
    if (index > 0 && Number.isFinite(previousValue) && Number.isFinite(value) && previousValue * value < 0) {
      const zero = bisect(g, previousX, x)
      if (zero !== null) zeros.push(polish(g, zero))
    } else if (Number.isFinite(value) && Math.abs(value) <= floor) {
      zeros.push(x)
    }
    previousX = x
    previousValue = value
  }
  return zeros
}

/**
 * **数值求根 + 完备性读数**。这是 `verified-numeric` 那一档的全部实现。
 *
 * `complete` 的三条合成（缺一即为假）：
 * ① 没有"分辨不出的近重根"（临界点上残差落在判零带内且两侧同号）；
 * ② 两倍分辨率的采样给出的零点个数一致；
 * ③ 没有残差降到判零带内却不变号的格子。
 */
function solveResidual(residual: (x: number) => number, domain: [number, number], options: EvidenceOptions): ResidualSolution {
  const steps = normalizedSteps(options.steps)
  const tolerance = normalizedTolerance(options.tolerance)
  const floor = tolerance * valueScale([residual(domain[0]), residual(domain[1]), residual((domain[0] + domain[1]) / 2)])
  const found: { x: number; multiplicity: 1 | 2 }[] = findZeros(residual, domain, steps).map((point) => ({ x: polish(residual, point.x), multiplicity: 1 as const }))
  const width = (domain[1] - domain[0]) / steps

  const touching: number[] = []
  for (const point of criticalPoints(residual, domain, steps)) {
    const value = residual(point)
    if (!Number.isFinite(value) || Math.abs(value) > floor) continue
    const left = residual(point - width / 4)
    const right = residual(point + width / 4)
    // 变号的临界点就是普通零点（`findZeros` 已经找到了），不算近重根。
    if (Number.isFinite(left) && Number.isFinite(right) && left * right < 0) continue
    touching.push(polish(residual, point))
  }

  const xs = [...found]
  for (const point of touching) {
    const existing = xs.find((entry) => Math.abs(entry.x - point) <= Math.max(1e-6, width / 4))
    if (existing) existing.multiplicity = 2
    else xs.push({ x: point, multiplicity: 2 })
  }
  xs.sort((first, second) => first.x - second.x)

  if (touching.length > 0) {
    const where = touching.map((entry) => formatNumber(entry)).join("、")
    return {
      xs,
      complete: false,
      diagnostic: `在 x ≈ ${where} 处残差取到极小值并落在判零带内，两侧却同号：那里是**重根或一对分辨不出的近重根**，个数随分辨率/参数微扰会从 1 变到 0 或 2（**退化**）。`
    }
  }
  const coarse = signChangeCount(residual, domain, steps)
  const fine = signChangeCount(residual, domain, steps * 2)
  if (coarse !== fine) {
    return {
      xs,
      complete: false,
      diagnostic: `两个采样分辨率给出的零点个数不同（${coarse} 与 ${fine}）：个数不可用，必须换更细的定位或改用代数方法。`
    }
  }
  const dips = nearZeroDips(residual, domain, steps, floor)
  if (dips.length > 0) {
    return {
      xs,
      complete: false,
      diagnostic: `在 x ≈ ${dips.map((entry) => formatNumber(entry)).join("、")} 处残差降到判零带内却没有变号：可能是**未分辨的近重根**，个数不可用。`
    }
  }
  return { xs, complete: true }
}

function rootSetFromXs(xs: readonly { x: number; multiplicity: 1 | 2 }[], valueAt: (x: number) => number, grade: EvidenceGrade, complete: boolean, diagnostic?: string): RootSet {
  return {
    roots: xs.map((entry) => {
      const y = valueAt(entry.x)
      return { x: entry.x, y: Number.isFinite(y) ? y : 0, multiplicity: entry.multiplicity }
    }),
    grade,
    complete,
    ...(diagnostic === undefined ? {} : { diagnostic })
  }
}

/** `y = f(x)` 与一条直线的交点（2022 新高考Ⅰ卷 22 题、2024 新课标Ⅰ卷 7 题的形状）。 */
export function functionLineRoots(source: string, domain: [number, number], line: TangentLine, options: EvidenceOptions = {}): RootSet {
  const evaluate = compiledOrNull(source)
  if (evaluate === null) {
    return { roots: [], grade: "plot-only", complete: false, diagnostic: `表达式 ${source} 解析不了，交点算不出来。` }
  }
  const residual = (x: number) => evaluate(x) - (line.slope * x + line.intercept)
  const coefficients = coefficientsOf(source)
  if (coefficients !== null) {
    const exact = algebraicRootsX(polynomialAdd(coefficients, [-line.intercept, -line.slope]))
    if (exact !== null) {
      if (exact.unsupported !== undefined) {
        return { roots: [], grade: "algebraic", complete: false, diagnostic: exact.unsupported }
      }
      return rootSetFromXs(exact.roots, (x) => line.slope * x + line.intercept, "algebraic", true)
    }
  }
  const solved = solveResidual(residual, domain, options)
  return rootSetFromXs(solved.xs, (x) => line.slope * x + line.intercept, "verified-numeric", solved.complete, solved.diagnostic)
}

/** 两条曲线的交点（`f(x) = g(x)`）。 */
export function functionIntersections(first: string, second: string, domain: [number, number], options: EvidenceOptions = {}): RootSet {
  const firstValue = compiledOrNull(first)
  const secondValue = compiledOrNull(second)
  if (firstValue === null || secondValue === null) {
    return { roots: [], grade: "plot-only", complete: false, diagnostic: "两条曲线里至少有一条的表达式解析不了，交点算不出来。" }
  }
  const residual = (x: number) => firstValue(x) - secondValue(x)
  const firstCoefficients = coefficientsOf(first)
  const secondCoefficients = coefficientsOf(second)
  if (firstCoefficients !== null && secondCoefficients !== null) {
    const exact = algebraicRootsX(polynomialSubtract(firstCoefficients, secondCoefficients))
    if (exact !== null && exact.unsupported === undefined) {
      return rootSetFromXs(exact.roots, firstValue, "algebraic", true)
    }
  }
  const solved = solveResidual(residual, domain, options)
  return rootSetFromXs(solved.xs, firstValue, "verified-numeric", solved.complete, solved.diagnostic)
}

function polynomialSubtract(first: Coefficients, second: Coefficients): Coefficients {
  return polynomialAdd(first, second.map((value) => -value))
}

/**
 * **过定点的切线**（2021 新高考Ⅰ卷 7 题：从曲线外一点向 `y = eˣ` 作切线）。
 *
 * 切点参数 `t` 满足 `point.y − f(t) − f′(t)·(point.x − t) = 0`：
 * 直线 `y = f(t) + f′(t)(x − t)` 过定点，当且仅当这个残差为零。
 *
 * 每个解都**自己回代**（点在曲线上、直线过定点），不读任何中间量。
 */
export function tangentsFromPoint(source: string, domain: [number, number], point: { x: number; y: number }, options: EvidenceOptions = {}): TangentSet<ExternalTangent> {
  const evaluate = compiledOrNull(source)
  if (evaluate === null) return { status: "unsupported", tangents: [], grade: "plot-only", complete: false, diagnostic: `表达式 ${source} 解析不了。` }
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return { status: "unsupported", tangents: [], grade: "plot-only", complete: false, diagnostic: "定点坐标不是有限数。" }
  const derivative = (t: number) => numericalDerivative(evaluate, t)
  const residual = (t: number) => {
    const slope = derivative(t)
    return point.y - evaluate(t) - slope * (point.x - t)
  }
  const solved = solveResidual(residual, domain, options)
  const tangents: ExternalTangent[] = []
  for (const entry of solved.xs) {
    const y = evaluate(entry.x)
    const slope = derivative(entry.x)
    if (!Number.isFinite(y) || !Number.isFinite(slope)) continue
    const gap = Math.abs(point.y - (y + slope * (point.x - entry.x)))
    const tolerance = normalizedTolerance(options.tolerance) * valueScale([point.y, y])
    if (gap > tolerance) continue
    tangents.push({ parameter: entry.x, x: entry.x, y, slope, intercept: y - slope * entry.x, residual: gap })
  }
  const status = tangents.length > 0 ? "solved" : solved.complete ? "none" : "unsupported"
  return {
    status,
    tangents,
    grade: "verified-numeric",
    complete: solved.complete,
    ...(solved.diagnostic === undefined ? {} : { diagnostic: solved.diagnostic })
  }
}

/** 导数取值区间；用来判断公切线的斜率有没有公共部分。 */
function derivativeRange(evaluate: (x: number) => number, domain: [number, number], steps = 64): [number, number] | null {
  let low = Number.POSITIVE_INFINITY
  let high = Number.NEGATIVE_INFINITY
  for (let index = 0; index <= steps; index += 1) {
    const x = domain[0] + (domain[1] - domain[0]) * index / steps
    const value = numericalDerivative(evaluate, x)
    if (!Number.isFinite(value)) continue
    low = Math.min(low, value)
    high = Math.max(high, value)
  }
  return Number.isFinite(low) && Number.isFinite(high) && low <= high ? [low, high] : null
}

/**
 * **公切线**（2024 新课标Ⅰ卷 13 题）。
 *
 * 一条直线与两条曲线都相切 ⟺ 存在斜率 `m`、两个切点 `t(m)`、`s(m)`，使
 * 两条曲线在该点的**截距相等**：`f(t) − m·t = g(s) − m·s`。
 * 于是把问题压成一维：`φ(m) = [f(t(m)) − m·t(m)] − [g(s(m)) − m·s(m)]` 的零点。
 *
 * **前提是各自的导数在该区间上单调**（否则 `t(m)` 不是单值，同一斜率可能切在多处）；
 * 单调性由采样检查，**不单调就如实报 `unsupported`**，不许硬算一个切点出来。
 */
export function commonTangents(first: string, second: string, firstDomain: [number, number], secondDomain: [number, number], options: EvidenceOptions = {}): TangentSet<CommonTangent> {
  const firstValue = compiledOrNull(first)
  const secondValue = compiledOrNull(second)
  if (firstValue === null || secondValue === null) {
    return { status: "unsupported", tangents: [], grade: "plot-only", complete: false, diagnostic: "两条曲线里至少有一条的表达式解析不了。" }
  }
  const firstDerivative = (t: number) => numericalDerivative(firstValue, t)
  const secondDerivative = (s: number) => numericalDerivative(secondValue, s)
  const firstRange = derivativeRange(firstValue, firstDomain)
  const secondRange = derivativeRange(secondValue, secondDomain)
  if (firstRange === null || secondRange === null) {
    return { status: "unsupported", tangents: [], grade: "plot-only", complete: false, diagnostic: "导数在定义域上取不到有限值，公切线算不出来。" }
  }
  const low = Math.max(firstRange[0], secondRange[0])
  const high = Math.min(firstRange[1], secondRange[1])
  if (!(low <= high)) {
    return {
      status: "none",
      tangents: [],
      grade: "verified-numeric",
      complete: true,
      diagnostic: `两条曲线的斜率取值范围没有交集（${formatNumber(firstRange[0])}…${formatNumber(firstRange[1])} 与 ${formatNumber(secondRange[0])}…${formatNumber(secondRange[1])}）：斜率上就不可能是同一条直线。`
    }
  }
  const invert = (derivative: (x: number) => number, domain: [number, number]) => (m: number): number | null => {
    const at = (x: number) => derivative(x) - m
    const lowValue = at(domain[0])
    const highValue = at(domain[1])
    if (Number.isFinite(lowValue) && lowValue === 0) return domain[0]
    if (Number.isFinite(highValue) && highValue === 0) return domain[1]
    if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || lowValue * highValue > 0) return null
    return bisect(at, domain[0], domain[1])
  }
  const monotone = (derivative: (x: number) => number, domain: [number, number]): "increasing" | "decreasing" | null => {
    const steps = 64
    let previous = derivative(domain[0] + (domain[1] - domain[0]) / steps)
    const width = (domain[1] - domain[0]) / steps
    let increasing = true
    let decreasing = true
    for (let index = 2; index <= steps; index += 1) {
      const x = domain[0] + width * index
      const value = derivative(x)
      if (!Number.isFinite(value) || !Number.isFinite(previous)) return null
      if (value < previous - 1e-9) increasing = false
      if (value > previous + 1e-9) decreasing = false
      previous = value
    }
    if (increasing && !decreasing) return "increasing"
    if (decreasing && !increasing) return "decreasing"
    return null
  }
  const firstMonotone = monotone(firstDerivative, firstDomain)
  const secondMonotone = monotone(secondDerivative, secondDomain)
  if (firstMonotone === null || secondMonotone === null) {
    return {
      status: "unsupported",
      tangents: [],
      grade: "plot-only",
      complete: false,
      diagnostic: "至少有一条曲线的导数在定义域上不单调：同一斜率可能切在多处，本实现不硬算切点。"
    }
  }
  const firstT = invert(firstDerivative, firstDomain)
  const secondS = invert(secondDerivative, secondDomain)
  const interceptOf = (evaluate: (x: number) => number, at: (m: number) => number | null) => (m: number): number | null => {
    const parameter = at(m)
    if (parameter === null) return null
    const value = evaluate(parameter)
    return Number.isFinite(value) ? value - m * parameter : null
  }
  const firstIntercept = interceptOf(firstValue, firstT)
  const secondIntercept = interceptOf(secondValue, secondS)
  const phi = (m: number): number => {
    const left = firstIntercept(m)
    const right = secondIntercept(m)
    return left === null || right === null ? Number.NaN : left - right
  }
  const solved = solveResidual(phi, [low, high], options)
  const tangents: CommonTangent[] = []
  for (const entry of solved.xs) {
    const m = entry.x
    const t = firstT(m)
    const s = secondS(m)
    if (t === null || s === null) continue
    const firstY = firstValue(t)
    const secondY = secondValue(s)
    if (!Number.isFinite(firstY) || !Number.isFinite(secondY)) continue
    const intercept = firstY - m * t
    const residual = Math.max(
      Math.abs(firstY - (m * t + intercept)),
      Math.abs(secondY - (m * s + intercept)),
      Math.abs(firstDerivative(t) - m),
      Math.abs(secondDerivative(s) - m)
    )
    tangents.push({ slope: m, intercept, first: { parameter: t, x: t, y: firstY }, second: { parameter: s, x: s, y: secondY }, residual })
  }
  tangents.sort((first, second) => first.slope - second.slope)
  const status = tangents.length > 0 ? "solved" : solved.complete ? "none" : "unsupported"
  return {
    status,
    tangents,
    grade: "verified-numeric",
    complete: solved.complete,
    ...(solved.diagnostic === undefined ? {} : { diagnostic: solved.diagnostic })
  }
}

/**
 * **这条直线真的与曲线相切吗**（反例"错切点"的判据）。
 *
 * 相切 ⟺ `g(x) = f(x) − (mx + c)` 在某个临界点上取到零（重根）。
 * 所以只要求 `f′(x) = m` 的那些点，再看 `|g|` 有没有到零 —— **不看斜率对不对**，
 * 因为"斜率对、截距错"正是要挡住的那一类（例如 `y = 0.5` 与 `y = 2` 对 `x³ − 3x`
 * 斜率都是 0，可只有后者相切）。
 */
export function verifyTangentLine(source: string, domain: [number, number], line: TangentLine, options: EvidenceOptions = {}): TangentVerdict {
  const evaluate = compiledOrNull(source)
  if (evaluate === null) return { tangent: false, parameter: null, residual: Number.NaN, reason: `表达式 ${source} 解析不了，判不了相切。` }
  const gap = (x: number) => evaluate(x) - (line.slope * x + line.intercept)
  const derivativeGap = (x: number) => numericalDerivative(evaluate, x) - line.slope
  /**
   * 相切的候选点是**导数差的零点**（`f′(x) = m`），所以这里要的是 `derivativeGap` 的零点。
   * 写成"`derivativeGap` 的临界点"就变成 `f″(x) = 0` —— 那会把**割线交点**当成切点
   * （2026-10-12 实测：`y = 9x` 与 `x³ − 3x` 的割线交点 `x = 0` 混进来了）。
   */
  const candidates = zerosOf(derivativeGap, domain, normalizedSteps(options.steps), normalizedTolerance(options.tolerance))
  // 定义域端点也可能是切点（例如切线正好切在区间端点上）。
  for (const endpoint of domain) candidates.push(endpoint)
  let best: { x: number; residual: number } | null = null
  for (const candidate of candidates) {
    const value = gap(candidate)
    if (!Number.isFinite(value)) continue
    if (best === null || Math.abs(value) < Math.abs(best.residual)) best = { x: candidate, residual: value }
  }
  if (best === null) return { tangent: false, parameter: null, residual: Number.NaN, reason: "曲线在这段定义域上取不到有限值，判不了相切。" }
  const polished = polish(gap, best.x)
  best = { x: polished, residual: gap(polished) }
  const tolerance = normalizedTolerance(options.tolerance) * valueScale([evaluate(best.x), line.intercept, 1])
  if (Math.abs(best.residual) <= tolerance) {
    return { tangent: true, parameter: best.x, residual: Math.abs(best.residual), reason: `在 x = ${formatNumber(best.x)} 处直线与曲线相切（偏差 ${best.residual.toPrecision(3)}）。` }
  }
  return {
    tangent: false,
    parameter: null,
    residual: Math.abs(best.residual),
    reason: `直线与曲线**不相切**：在最接近的 x = ${formatNumber(best.x)} 处偏差还有 ${best.residual.toPrecision(3)}。`
  }
}

/**
 * **"一个参数实例"能不能升级成"所有参数成立"**（反例四）。
 *
 * 答案今天**永远是不能**：数值图形是**一个取值上的实例**，`all-parameters` 需要
 * 全称的数学证据（符号计算或已证明的单调性），本仓没有这类证据链 ⇒ 一律降级成
 * `at-parameters` + `plot-only` + `upheld: false`，并把理由写清楚。
 *
 * 这不是"保守"，而是"图上成立"与"对所有参数成立"本来就是两句不同的话：
 * 把它们混起来，用户会拿一张 `a = 1` 的图当"任意 `a > 0` 都成立"的依据。
 */
export function judgeUniversalClaim(claim: UniversalClaim, instances: readonly Record<string, number>[]): UniversalClaimVerdict {
  const names = claim.parameterNames.join("、")
  if (instances.length === 0) {
    return { scope: "at-parameters", grade: "plot-only", upheld: false, reason: `没有任何参数取值被核验过，${names || "参数"}上的主张一条都不成立。` }
  }
  const rendered = instances
    .map((instance) => names === "" ? "（无参数）" : claim.parameterNames.map((name) => `${name} = ${formatNumber(instance[name] ?? Number.NaN)}`).join("、"))
    .join("；")
  if (claim.scope === "all-parameters") {
    return {
      scope: "at-parameters",
      grade: "plot-only",
      upheld: false,
      reason: `图上只核验了 ${instances.length} 个参数取值（${rendered}）：这是**参数实例**，推不出"对所有参数成立"。要全称结论必须另给数学证据（本仓没有这类证据链）。`
    }
  }
  return {
    scope: "at-parameters",
    grade: "plot-only",
    upheld: true,
    reason: `只声称在 ${rendered} 这些取值上成立 —— 这是如实标注的参数实例，不是全称结论。`
  }
}
