import { isSampledPrimitiveType, type Coordinate, type GeometryDocument, type PrimitiveSpec } from "@draw/dsl"
import { adaptiveSampleFunctionSegments, arcConstraint, circleConstraint, constraintTangentAt, ellipseConstraint, evaluateParameterExpression, findExtrema, findInflectionPoints, findZeros, functionGraphConstraint, hyperbolaConstraint, lineConstraint, normalFromTangent, numericalDerivative, numericalIntegralWithDiagnostics, numericalSecondDerivative, parabolaConstraint, polylineConstraint, rayConstraint, segmentConstraint, tangentSegment, type CurveTangent, type PlanarConstraint, type SampledPrimitive } from "@draw/geometry-kernel"

/**
 * **解析类图元的重算**（从 `operations.ts` 拆出，评审方案 2）。
 *
 * 导数 / 切线 / 法线 / 割线 / 积分 / 分析集这六类都是"由一条函数曲线派生出来的"：它们的几何
 * **全部**从来源函数算出来，自己不含独立参数。所以这里只有一件事 —— 按来源函数在它自己的域上
 * 求值，再把结果摊成采样点或参数窗口。
 *
 * 三条口径随代码一起搬过来：
 * 1. **来源名单取自 `@draw/dsl` 的 `SAMPLED_PRIMITIVE_TYPES`**（这里以前抄的是一份会漂移的副本）；
 * 2. **无限切线要截断**（`INFINITE_TANGENT_EXTENT`）：不截断的话，一条竖直切线的端点会落在无穷远，
 *    取景与包围盒都会被它带飞；
 * 3. **动圆半径有下限**（`MIN_DYNAMIC_CIRCLE_RADIUS`）：退化成零半径的圆在后续求交里没有意义。
 */

function isSampledPrimitive(primitive: PrimitiveSpec | undefined): primitive is SampledPrimitive {
  /** 名单来自 `@draw/dsl` 的 `SAMPLED_PRIMITIVE_TYPES`：这里以前抄的是一份会漂移的副本。 */
  return Boolean(primitive && isSampledPrimitiveType(primitive.type))
}

/**
 * 几何运算（求交）用的取样来源。
 *
 * `connection` 在文档里只存两个点的 id，没有自己的坐标，所以要先解析成真实端点才能参与运算 ——
 * 否则"两个动点之间连的线段"就只是一根装饰线，量不了也交不了。
 * 抛物线连接用的是二次贝塞尔控制点，不是真正的抛物线，故不在此列。
 */
export function sampledSource(id: string, primitiveMap: Map<string, PrimitiveSpec>): SampledPrimitive | undefined {
  const primitive = primitiveMap.get(id)
  if (primitive?.type === "connection") {
    if (primitive.kind !== "segment" && primitive.kind !== "line" && primitive.kind !== "ray") return undefined
    const start = primitiveMap.get(primitive.startPointId)
    const end = primitiveMap.get(primitive.endPointId)
    if (start?.type !== "point" || end?.type !== "point") return undefined
    const a = { x: start.x, y: start.y }
    const b = { x: end.x, y: end.y }
    return { id: primitive.id, type: primitive.kind, a, b }
  }
  return isSampledPrimitive(primitive) ? primitive : undefined
}

export function recomputeDerivative(primitive: Extract<PrimitiveSpec, { type: "derivative" }>, source: Extract<PrimitiveSpec, { type: "function" }>, parameters: GeometryDocument["parameters"]): Extract<PrimitiveSpec, { type: "derivative" }> {
  const variables = Object.fromEntries(Object.entries(parameters).map(([id, parameter]) => [id, parameter.value]))
  const sourceValue = (x: number) => evaluateParameterExpression(source.expression, { ...variables, x })
  const derivativeValue = primitive.order === 1
    ? (x: number) => numericalDerivative(sourceValue, x)
    : (x: number) => numericalSecondDerivative(sourceValue, x)
  try {
    const segments = adaptiveSampleFunctionSegments(derivativeValue, primitive.domain, { initialSteps: primitive.samples, maxSteps: Math.max(primitive.samples, 2048) })
    const points = segments.flat()
    return points.length ? { ...primitive, points, status: "approximate", diagnostic: undefined } : { ...primitive, points: [], status: "undefined", diagnostic: "source function is undefined across the derivative domain" }
  } catch (error) {
    return { ...primitive, points: [], status: "failed", diagnostic: error instanceof Error ? error.message : "derivative evaluation failed" }
  }
}

function evaluateSource(source: Extract<PrimitiveSpec, { type: "function" }>, x: number, parameters: GeometryDocument["parameters"]): number {
  const variables = Object.fromEntries(Object.entries(parameters).map(([id, parameter]) => [id, parameter.value]))
  return evaluateParameterExpression(source.expression, { ...variables, x })
}

function lineEndpoints(point: Coordinate, slope: number, domain: [number, number], vertical = false): { a: Coordinate; b: Coordinate } {
  if (vertical) return { a: { x: point.x, y: domain[0] }, b: { x: point.x, y: domain[1] } }
  return { a: { x: domain[0], y: point.y + slope * (domain[0] - point.x) }, b: { x: domain[1], y: point.y + slope * (domain[1] - point.x) } }
}

export function recomputeTangent(primitive: Extract<PrimitiveSpec, { type: "tangent" | "normal" }>, source: Extract<PrimitiveSpec, { type: "function" }>, parameters: GeometryDocument["parameters"]): Extract<PrimitiveSpec, { type: "tangent" | "normal" }> {
  try {
    const y = evaluateSource(source, primitive.x, parameters)
    const sourceValue = (x: number) => evaluateSource(source, x, parameters)
    const derivative = numericalDerivative(sourceValue, primitive.x)
    if (!Number.isFinite(y) || !Number.isFinite(derivative)) return { ...primitive, point: { x: primitive.x, y: 0 }, status: "undefined" as const, diagnostic: "source function is undefined at the selected x" }
    const vertical = primitive.type === "normal" && Math.abs(derivative) < 1e-8
    const slope = primitive.type === "normal" ? (vertical ? 0 : -1 / derivative) : derivative
    // 缺省无限长；显式填了 halfLength 的才修剪（见 INFINITE_TANGENT_EXTENT）。
    return { ...primitive, point: { x: primitive.x, y }, slope, vertical, ...extendedTangentEndpoints({ x: primitive.x, y }, slope, vertical, primitive.halfLength ?? INFINITE_TANGENT_EXTENT), status: "approximate" as const, diagnostic: undefined }
  } catch (error) {
    return { ...primitive, point: { x: primitive.x, y: 0 }, status: "failed" as const, diagnostic: error instanceof Error ? error.message : "line evaluation failed" }
  }
}

/** 驱动的半径退化成 0 时圆会消失（schema 也要求 radius > 0）；给一个可视的下限而不是拒绝重算。 */
export const MIN_DYNAMIC_CIRCLE_RADIUS = 1e-3

/**
 * 缺省切线的"无限长"延伸量（世界单位，沿切向两侧各伸这么远）。
 *
 * 用户口径（2026-09-18）："切线长度还要增长一点，**最好是无限长**"。
 * 真写一个无穷大进文档没有意义 —— 导出、检查器、既有代码都按线段读 `a/b` —— 所以用
 * **固定的大长度**表达"无限"：1e4 世界单位远大于任何实际视野（默认 1 格 = 1 世界单位），
 * 画面外那部分由画布的 viewBox 自然裁掉。
 *
 * **刻意不按视口算**：视口一变就改文档，缩放与取景会污染脏状态、撤销历史与"保存过没有"。
 */
const INFINITE_TANGENT_EXTENT = 10000

/**
 * 以 `point` 为中心、沿单位方向两侧各伸 `extent` 的线段。
 *
 * 用单位方向（而不是按定义域给 x 范围）是为了让端点坐标与斜率无关地保持有界：
 * 斜率很大时按 x 延伸会把 y 甩到 1e10 量级。
 */
function extendedTangentEndpoints(point: Coordinate, slope: number, vertical: boolean, extent: number): { a: Coordinate; b: Coordinate } {
  const direction = vertical
    ? { x: 0, y: 1 }
    : (() => {
        const length = Math.hypot(1, slope)
        return { x: 1 / length, y: slope / length }
      })()
  return {
    a: { x: point.x - direction.x * extent, y: point.y - direction.y * extent },
    b: { x: point.x + direction.x * extent, y: point.y + direction.y * extent }
  }
}

/**
 * **曲线来源**的切线 / 法线（圆、圆弧、抛物线、椭圆、双曲线）。
 *
 * 与函数来源的 `recomputeTangent` 是同一件事的两种来源，但定位方式完全不同：
 * 函数用横坐标 `x` 定位（那是它唯一的自然参数），曲线用 `anchor` 定位 ——
 * 要么是曲线自己的自然参数，要么是**一个点图元**（动点在哪就切在哪）。
 *
 * 动点锚点优先读**它绑定里的参数**，而不是它的坐标：坐标是派生缓存、参数才是真值。
 * 读坐标会在拖动那一帧上落后半步（缓存还没刷完），用户看到的就是"切线追着点跑"。
 *
 * 几何由内核 `constraintTangentAt` 给出（点 + 单位方向），并用 `tangentSegment` 展开成可见线段。
 * 之所以不用斜截式：圆的左右顶点切线是**竖直**的，斜率在那里是无穷大。
 */
export function recomputeCurveTangent(
  primitive: Extract<PrimitiveSpec, { type: "tangent" | "normal" }>,
  source: PrimitiveSpec,
  primitiveMap: Map<string, PrimitiveSpec>,
  parameters: GeometryDocument["parameters"]
): Extract<PrimitiveSpec, { type: "tangent" | "normal" }> {
  const anchor = primitive.anchor
  const constraint = pathConstraint(source, parameters)
  if (!anchor || !constraint) return { ...primitive, status: "failed" as const, diagnostic: "切线来源曲线不支持参数化" }
  const lastBranch = Math.max(0, constraint.branchCount - 1)
  const clampBranch = (branch: number | undefined) => Math.min(Math.max(branch ?? 0, 0), lastBranch)
  const target = ((): { parameter: number; branch: number } | null => {
    if (anchor.kind === "parameter") return { parameter: anchor.parameter, branch: clampBranch(anchor.branch) }
    const point = primitiveMap.get(anchor.pointId)
    if (point?.type !== "point") return null
    const binding = point.binding?.kind === "onPath" && point.binding.pathId === source.id ? point.binding : null
    if (binding) {
      const parameter = binding.parameterId ? parameters[binding.parameterId]?.value ?? binding.parameter : binding.parameter
      return { parameter, branch: clampBranch(binding.branch) }
    }
    // 锚点没有绑在这条曲线上（自由点 / 绑在别处）：把它的坐标投影上来，取离它最近的切点。
    // 这比拒绝用户有用得多 —— "在曲线附近放一个点，再在它那里作切线"是完全合理的用法。
    const projection = constraint.project({ x: point.x, y: point.y })
    return projection ? { parameter: projection.parameter, branch: projection.branch } : null
  })()
  if (!target) return { ...primitive, status: "failed" as const, diagnostic: "切线的定位点不存在" }
  const raw = constraintTangentAt(constraint, target.parameter, target.branch)
  if (!raw) return { ...primitive, status: "undefined" as const, diagnostic: "这条曲线在该位置没有切线" }
  const tangent: CurveTangent = primitive.type === "normal" ? normalFromTangent(raw) : raw
  // 缺省无限长；显式填了 halfLength 的才修剪（见 INFINITE_TANGENT_EXTENT）。
  const { a, b } = tangentSegment(tangent, primitive.halfLength ?? INFINITE_TANGENT_EXTENT)
  // 竖直切线的斜率写成 0 而不是 Infinity：`slope` 在 schema 里必须有限，
  // 竖直这件事实由 `vertical` 单独表达（与函数切线的约定一致）。
  const vertical = Math.abs(tangent.direction.x) <= 1e-9
  return {
    ...primitive,
    x: tangent.point.x,
    point: tangent.point,
    slope: vertical ? 0 : tangent.direction.y / tangent.direction.x,
    vertical,
    a,
    b,
    status: "approximate" as const,
    diagnostic: undefined
  }
}

export function recomputeSecant(primitive: Extract<PrimitiveSpec, { type: "secant" }>, source: Extract<PrimitiveSpec, { type: "function" }>, parameters: GeometryDocument["parameters"]): Extract<PrimitiveSpec, { type: "secant" }> {
  try {
    const first = { x: primitive.x1, y: evaluateSource(source, primitive.x1, parameters) }
    const second = { x: primitive.x2, y: evaluateSource(source, primitive.x2, parameters) }
    if (!Number.isFinite(first.y) || !Number.isFinite(second.y)) return { ...primitive, points: [], status: "undefined" as const, diagnostic: "source function is undefined at a secant endpoint" }
    const vertical = Math.abs(second.x - first.x) < 1e-8
    const slope = vertical ? 0 : (second.y - first.y) / (second.x - first.x)
    return { ...primitive, points: [first, second], slope, vertical, ...lineEndpoints(first, slope, source.domain, vertical), status: "approximate" as const, diagnostic: undefined }
  } catch (error) {
    return { ...primitive, points: [], status: "failed" as const, diagnostic: error instanceof Error ? error.message : "secant evaluation failed" }
  }
}

export function recomputeIntegral(primitive: Extract<PrimitiveSpec, { type: "integral" }>, source: Extract<PrimitiveSpec, { type: "function" }>, parameters: GeometryDocument["parameters"]): Extract<PrimitiveSpec, { type: "integral" }> {
  const sourceValue = (x: number) => evaluateSource(source, x, parameters)
  const result = numericalIntegralWithDiagnostics(sourceValue, primitive.domain, primitive.steps)
  const points = adaptiveSampleFunctionSegments(sourceValue, primitive.domain, { initialSteps: Math.min(primitive.steps, 512), maxSteps: Math.max(primitive.steps, 2048) }).flat()
  return { ...primitive, points, area: result.value, status: result.status, diagnostic: result.diagnostic }
}

export function recomputeAnalysisSet(primitive: Extract<PrimitiveSpec, { type: "analysisSet" }>, source: Extract<PrimitiveSpec, { type: "function" }>, parameters: GeometryDocument["parameters"]): Extract<PrimitiveSpec, { type: "analysisSet" }> {
  const sourceValue = (x: number) => evaluateSource(source, x, parameters)
  const results = [...findZeros(sourceValue, primitive.domain, primitive.samples), ...findExtrema(sourceValue, primitive.domain, primitive.samples), ...findInflectionPoints(sourceValue, primitive.domain, primitive.samples)]
  const hasDefinedSamples = adaptiveSampleFunctionSegments(sourceValue, primitive.domain, { initialSteps: Math.min(primitive.samples, 256), maxSteps: Math.max(primitive.samples, 512) }).some((segment) => segment.length > 0)
  return hasDefinedSamples
    ? { ...primitive, results, status: "approximate" as const, diagnostic: undefined }
    : { ...primitive, results: [], status: "undefined" as const, diagnostic: "source function is undefined across the analysis domain" }
}

/**
 * 由文档里的曲线对象构造内核约束。
 *
 * **绑定参数就是该约束的自然参数**，不再一律归一化到 [0, 1]：
 *
 *   直线 / 射线 / 线段  仿射比例 t（直线与射线**不截断**）
 *   圆 / 弧 / 椭圆      角度 θ（弧度）
 *   折线               按弧长归一化的比例
 *   函数图像           x 本身
 *
 * 统一归一化对直线是致命的：直线在画布上横贯整个视野，但 `clamp(t, 0, 1)` 会把点锁在
 * `a..b` 这一段里 —— 用户看到一条长线，点却只能在中间一小段滑动。
 * 交给内核约束之后，正向映射（`evaluate`）与反向映射（`project`）由同一份定义保证互逆。
 */
export function pathConstraint(path: PrimitiveSpec, parameters: GeometryDocument["parameters"]): PlanarConstraint | null {
  if (path.type === "line") return lineConstraint(path.id, path.a, path.b)
  if (path.type === "segment") return segmentConstraint(path.id, path.a, path.b)
  if (path.type === "ray") return rayConstraint(path.id, path.a, path.b)
  if (path.type === "circle") return circleConstraint(path.id, path.center, path.radius)
  if (path.type === "arc") return arcConstraint(path.id, path.center, path.radius, path.startAngle, path.endAngle)
  if (path.type === "polyline") return polylineConstraint(path.id, path.points)
  if (path.type === "ellipse") return ellipseConstraint(path.id, path)
  // 抛物线与双曲线的自然参数是无界的轴向参数 u，所以它们需要绑定自带一个 `domain` 作为扫描窗口。
  if (path.type === "parabola") return parabolaConstraint(path.id, path)
  if (path.type === "hyperbola") return hyperbolaConstraint(path.id, path)
  if (path.type === "function") {
    const variables = Object.fromEntries(Object.entries(parameters).map(([id, spec]) => [id, spec.value]))
    return functionGraphConstraint(path.id, (x) => evaluateParameterExpression(path.expression, { ...variables, x }), path.domain)
  }
  return null
}

/**
 * 滑块、动画与轨迹扫描用的**参数窗口**。
 *
 * 有界约束直接用它的参数域；无界约束（直线、射线、抛物线、双曲线）没有有限域：
 * 抛物线与双曲线优先用绑定自带的 `domain`（用户可编辑），没有就取一个与图形尺度成比例的窗口；
 * 直线与射线用与 `a→b` 长度成比例的窗口。
 *
 * 注意这个窗口**只决定滑块与轨迹扫多远**，拖动本身不受它限制（`dragBoundPoint` 直接写参数值）。
 */
export function parameterWindow(path: PrimitiveSpec, parameters: GeometryDocument["parameters"], domain?: readonly [number, number]): { min: number; max: number } {
  const bounds = pathConstraint(path, parameters)?.parameterBounds()
  if (bounds && Number.isFinite(bounds.min) && Number.isFinite(bounds.max)) return { min: bounds.min, max: bounds.max }
  // 抛物线/双曲线：绑定里的 domain 是权威的（用户可改），否则给一个与焦参数/半径成比例的默认窗口。
  if (domain && Number.isFinite(domain[0]) && Number.isFinite(domain[1]) && domain[0] < domain[1]) return { min: domain[0], max: domain[1] }
  // 直线的 t 以 a→b 为单位长度，所以 ±2 就是"往两头各延伸两个 a..b 那么长"。
  if (path.type === "line") return { min: -2, max: 2 }
  if (path.type === "ray") return { min: 0, max: 3 }
  if (path.type === "parabola") {
    const scale = Math.max(1, Math.abs(path.focalParameter) * 2)
    return { min: -scale, max: scale }
  }
  if (path.type === "hyperbola") {
    const scale = Math.max(1, Math.abs(path.radiusX) * 2)
    return { min: -scale, max: scale }
  }
  return { min: 0, max: 1 }
}

/** 把世界坐标投影到约束曲线上，返回自然参数。与 `resolveBoundPoint` 是同一份定义的正反两面。 */
export function projectOntoPath(path: PrimitiveSpec, desired: Coordinate, parameters: GeometryDocument["parameters"], branch?: 0 | 1): number | null {
  // 双曲线必须锁在绑定记录的那一支上，否则拖过渐近线时点会跳到对面那一支。
  const projection = pathConstraint(path, parameters)?.project(desired, branch === undefined ? {} : { previousBranch: branch })
  return projection ? projection.parameter : null
}
