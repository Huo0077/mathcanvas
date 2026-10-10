import type { GeometryDocument, PrimitiveSpec } from "@draw/dsl"
import { compileExpression, crossVector3, dihedralAngleDetail3, distanceVector3, dotVector3, evaluateExpression, isPointName, lengthVector3, subtractVector3, type Vector3 } from "@draw/geometry-kernel"

import type { PlanEnvelope } from "./contracts"
import type { DiagramObligation, DiagramObligationKind, DiagramObligationSet } from "./diagramObligations"
import { buildObligationIR, type ObligationIR } from "./obligationIR"
import { relationResidual } from "./relations"

export type DiagramCheckStatus = "passed" | "failed" | "unverified"
export interface DiagramCheck {
  kind: DiagramObligationKind | "unparsed"
  sourceText: string
  status: DiagramCheckStatus
  reason: string
  expected?: number
  actual?: number
}
export interface DiagramVerificationReport {
  status: DiagramCheckStatus
  checks: DiagramCheck[]
  sampleValues: string[]
  /**
   * **统一 IR 的同一次解析结果**（Phase N1；设计 §3"任何 UI、Agent trace 都只读这份状态"）。
   *
   * 为什么挂在**这份报告**上，而不是另开一个返回值：现有三处消费点
   *（`planCompiler` 的诊断、`draftStore` 的预览、`ConfirmationPanel` 的展示）
   * 都已经在读这份报告，而报告本身就是"这一批题设核验到了什么"的载体。
   * 另开一条并行通道的代价是"有人读了新通道、有人还在读旧的"，两者一旦分叉就再也说不清
   * 哪一份是真相 —— 这个项目在"同一个判断写了两遍"上已经踩过好几次。
   *
   * 可选：`flags.obligationIR=false` 时**不生成**它（旧路径行为不变，
   * 见 `apps/web/src/agent/featureFlags.ts` 的验收条件）。
   */
  obligationIR?: ObligationIR
}

/**
 * 核验的可选项。
 *
 * **`obligationIR` 必须显式为 `true` 才产出 IR**（控制器裁决 R6）：缺省 / `undefined` / `false`
 * 一律返回**旧形状**的报告 —— 没有那个字段，而不是"值是 undefined"。
 *
 * R6 之前这里是"缺省 `true`"。那样写的代价不是形式问题：生产调用方根本没传过这个参数，
 * 于是开关**事实上从不生效**，"默认关闭的新能力"这条约束在这条路上是空的。
 * 保守方向才是对的：旧路径是缺省，IR 由显式决定产生。
 */
export interface DiagramVerificationOptions {
  obligationIR?: boolean
}

const UNITLESS_TOLERANCE = 1e-6
const ANGLE_TOLERANCE_DEGREES = 1e-3
const distanceTolerance = (value: number): number => Math.max(1e-6, 1e-6 * Math.max(1, value))
const length = (first: Vector3, second: Vector3): number => distanceVector3(first, second)

function candidatePoints(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): Map<string, Vector3> | null {  if (plan.kind !== "plan") return null
  const actions = plan.actions.filter((action) => action.actionId === "solid.create_polyhedron")
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const solids = candidate.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "polyhedron3" }> => primitive.type === "polyhedron3" && !priorIds.has(primitive.id))
  const points = new Map<string, Vector3>()
  /**
   * **多面体这一支只在计划里真的有它时才跑**（V0b）：平面图形没有 `solid.create_polyhedron`，
   * 若照旧**无条件**要求"恰好一只新多面体"，平面图就永远拿不到点名表 ——
   * 而那正是"平面作图从不进入核验"的机制本身。
   *
   * **多面体在场时的守卫逐字未改**：数量不是恰好一个、或点名表建不出来，仍然返回 `null`。
   * `null` 的含义是"这份候选图没有可靠的点名映射"，与"点名表恰好是空的"是两件事，
   * 混起来会让失败的**理由**变味（前者是映射不可靠，后者是图上没这个点）。
   */
  if (actions.length > 0) {
    // Without a unique solid there is no reliable alias → candidate solid mapping.
    if (actions.length !== 1 || solids.length !== 1) return null
    const input = actions[0].inputs
    if (typeof input !== "object" || input === null || !("vertexNames" in input)) return null
    const names = input.vertexNames
    const solid = solids[0]
    if (!Array.isArray(names) || names.length !== solid.vertexIds.length || !names.every((name) => typeof name === "string" && isPointName(name)) || new Set(names).size !== names.length) return null
    for (const [index, name] of names.entries()) {
      const vertex = candidate.primitives.find((primitive) => primitive.id === solid.vertexIds[index])
      if (vertex?.type !== "point3") return null
      const position = vertex.position
      if (![position.x, position.y, position.z].every(Number.isFinite)) return null
      points.set(name as string, position)
    }
  }

  /**
   * **平面多边形这一支**（2026-10-10 用户现场）：`solid.create_face` 物化出来的是一只 `face3`，
   * 点名表与多面体**同一口径** —— `vertexNames` 与 `pointIds` 按下标配对。
   *
   * 与多面体那一支同一条纪律：计划里真有几笔、候选图里就必须有几只**新增**的面；
   * 数量对不上、或点名不可靠，返回 `null`（"映射不可靠"与"图上没这个点"是两件事）。
   */
  const faceActions = plan.actions.filter((action) => action.actionId === "solid.create_face")
  if (faceActions.length > 0) {
    const faces = candidate.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "face3" }> => primitive.type === "face3" && !priorIds.has(primitive.id))
    if (faces.length !== faceActions.length) return null
    for (const [faceIndex, action] of faceActions.entries()) {
      const input = action.inputs
      if (typeof input !== "object" || input === null || !("vertexNames" in input)) return null
      const names = input.vertexNames
      const face = faces[faceIndex]!
      if (!Array.isArray(names) || names.length !== face.pointIds.length || !names.every((name) => typeof name === "string" && isPointName(name)) || new Set(names).size !== names.length) return null
      for (const [nameIndex, name] of names.entries()) {
        const vertex = candidate.primitives.find((primitive) => primitive.id === face.pointIds[nameIndex])
        if (vertex?.type !== "point3") return null
        const position = vertex.position
        if (![position.x, position.y, position.z].every(Number.isFinite)) return null
        points.set(name as string, position)
      }
    }
  }

  /**
   * **再扫一遍带 `label` 的点**（2026-10-05，用户报的现场）。
   *
   * ## 为什么必须有这一步
   *
   * 上面那张表**只**从 `solid.create_polyhedron` 的 `vertexNames` 建。于是**任何由别的动作
   * 创建的点**在核验里**根本不存在** —— 最典型的就是"O 是 BD 的中点"：
   * `dynamic.create_bound_point` 能把 O 精确放到中点（实测坐标就是 (0,0,0)），
   * 但那条题设仍然报"点名缺失…未核验"。**用户看到的错句，根源在这里，不在题面。**
   *
   * ## 三条语义（缺一条就会引入新的静默错误）
   *
   * 1. **顶点名优先**：`vertexNames` 已经定了的名字，标签不许覆盖它；
   * 2. **同名只许一个**：同一个标签出现两次 ⇒ 这个**名字缺失**（依赖它的题设如实未核验）。
   *    这里**不猜** —— 猜一个就等于把"图里有两个 O"这件事静默吞掉；
   * 3. **不是点名的标签不进表**：点名 = 一个大写字母 + 可选的撇或下标（内核 `pointNames` 的
   *    **同一份**定义，与解析层共用），别的标签（"中点"、"O1"、"A1"）不是题面点名。
   */
  const labelled = new Map<string, Vector3 | null>()
  for (const primitive of candidate.primitives) {
    /**
     * **2D 与 3D 的点都要收**（V0b）：`point3` 自带 `position`，平面 `point` 用 `x`/`y`。
     * 平面点补上 `z = 0` 之后交给**同一套**判据 —— 平面题的垂直/平行本来就在 z = 0 的平面上算，
     * 为"2D"再开一条数学分支等于把同一个判断写两遍。
     *
     * **但只在平面工作区收**（2026-10-10 用户现场）。三维文档里的一个平面点**画不出来**
     * （三维画布只画 `point3`，属性栏给它的也是「点坐标 + 创建动圆」那一套），把它按 `z = 0`
     * 收进点名表，就等于让"题设已核验"挂在一个用户**根本看不见的对象**上：现场就是
     * `O为 BD的中点` 被一个平面 `O` 满足了 ⇒ 兜底补建不触发 ⇒ 图上永远没有那个点，
     * 底部还提示"空间直线需要 2 个空间点，当前 0 个"。
     * 判据：三维工作区里平面点不进表 ⇒ 名字"缺失"，由 `missingNamedPoints` 如实报出、
     * 由编译器按题设补建一个**空间点**。
     */
    const planarPointsCount = candidate.workspace !== "geometry3d"
    const position: Vector3 | undefined = primitive.type === "point3"
      ? primitive.position
      : primitive.type === "point" && planarPointsCount
        ? { x: primitive.x, y: primitive.y, z: 0 }
        : undefined
    if (position === undefined) continue
    /**
     * **"顶点名优先"只在这一处判**（收集时**不**跳过与顶点同名的标签，只在下面写入时挡）。
     *
     * 原先两处都判过（收集时 `points.has(label) → continue` + 写入时 `!points.has(label)`），
     * 后果是**同一个判断写了两遍**、互为冗余：单点变异改不动行为，
     * 于是那条"顶点名优先"的用例**看着有守卫、实际抓不到任何东西**（试过，变异两次都全绿）。
     * 这与本仓那句"同一个判断不许写两遍"是同一条账。
     */
    const label = (primitive as { label?: unknown }).label
    if (typeof label !== "string" || !isPointName(label)) continue
    labelled.set(label, labelled.has(label) || ![position.x, position.y, position.z].every(Number.isFinite) ? null : position)
  }
  for (const [label, position] of labelled) {
    if (position !== null && !points.has(label)) points.set(label, position)
  }
  return points
}

/** 候选图里那条圆锥曲线。**不含"是否满足题设"的结论** —— 那是 `calculate` 的事。 */
type FigureConic =
  | { kind: "ellipse"; radiusX: number; radiusY: number }
  | { kind: "hyperbola"; radiusX: number; radiusY: number; axis: "x" | "y" }
  | { kind: "parabola"; focalParameter: number; axis: "x" | "y" }

/**
 * **候选图里那条唯一的、新画出来的圆锥曲线**（V0c）。
 *
 * 与多面体那条同一条纪律：**恰好一个**才谈得上"题面说的就是它"。多一条就说不清
 * 判的是哪一条，宁可返回 `null`（报告里表现为"未核验"，而不是"通过"）。
 *
 * 只认 `ellipse`：`hyperbola` / `parabola` 的题面写法与判据都还没做，
 * 把它们也收进来只会让"我支持圆锥曲线"听起来比实际宽 —— 而它们会走
 * "解析器不认识 ⇒ 未核验"那条诚实路径。
 */
function candidateConic(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): FigureConic | null {
  if (plan.kind !== "plan") return null
  if (!plan.actions.some((action) => action.actionId === "planar.create_conic")) return null
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const conics = candidate.primitives.filter((primitive) => (primitive.type === "ellipse" || primitive.type === "hyperbola" || primitive.type === "parabola") && !priorIds.has(primitive.id))
  if (conics.length !== 1) return null
  const [conic] = conics
  // 逐种显式分支，而不是靠"剩下的一定是抛物线" —— 上面那个 `filter` 没有做类型守卫，
  // 兜底分支拿不到窄化，`focalParameter` / `axis` 会报"不存在于联合类型上"。
  if (conic.type === "ellipse") return { kind: "ellipse", radiusX: conic.radiusX, radiusY: conic.radiusY }
  if (conic.type === "hyperbola") return { kind: "hyperbola", radiusX: conic.radiusX, radiusY: conic.radiusY, axis: conic.axis }
  if (conic.type === "parabola") return { kind: "parabola", focalParameter: conic.focalParameter, axis: conic.axis }
  return null
}

/** 数字的可读写法：整数不带小数点，其余最多六位。 */
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(6)).toString()
}

/** 候选图里那条切线。同样**不含"是否满足题设"的结论**。 */
interface FigureTangent {
  /** 切点的横坐标（函数来源时就是它）。 */
  x: number
  /** 图元里存着的斜率。**判据不直接信它** —— 见 `derivativeAt`。 */
  slope: number
  /** 来源函数那条曲线；没有就是"切线的来源不是函数"，算不出导数 ⇒ 未核验。 */
  source: { expression: string } | null
}

/**
 * **候选图里那条唯一的、新画出来的切线**（V0d）。
 *
 * 与多面体、圆锥曲线同一条纪律：恰好一条才谈得上"题面说的就是它"。
 * 同时把它的**来源函数**一并取出来：没有来源就求不了导，那条路必须如实走到"未核验"。
 */
function candidateTangent(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): FigureTangent | null {
  if (plan.kind !== "plan") return null
  if (!plan.actions.some((action) => action.actionId === "function.create_tangent")) return null
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const tangents = candidate.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "tangent" }> => primitive.type === "tangent" && !priorIds.has(primitive.id))
  if (tangents.length !== 1) return null
  const [tangent] = tangents
  const source = candidate.primitives.find((primitive) => primitive.id === tangent.sourceId)
  return {
    x: tangent.x,
    slope: tangent.slope,
    source: source?.type === "function" ? { expression: source.expression } : null
  }
}

/** 候选图里那条函数曲线。 */
interface FigureFunction {
  expression: string
  domain: [number, number]
}

/** **候选图里那条唯一的、新画出来的函数曲线**（V0d）。与其它几类同一条"恰好一条"纪律。 */
function candidateCurve(plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): FigureFunction | null {
  if (plan.kind !== "plan") return null
  if (!plan.actions.some((action) => action.actionId === "function.create_graph")) return null
  const priorIds = new Set(base?.primitives.map((primitive) => primitive.id) ?? [])
  const curves = candidate.primitives.filter((primitive): primitive is Extract<PrimitiveSpec, { type: "function" }> => primitive.type === "function" && !priorIds.has(primitive.id))
  if (curves.length !== 1) return null
  const [curve] = curves
  if (!Number.isFinite(curve.domain[0]) || !Number.isFinite(curve.domain[1]) || !(curve.domain[0] < curve.domain[1])) return null
  return { expression: curve.expression, domain: [curve.domain[0], curve.domain[1]] }
}

/** 采样点数。判的是**函数值**，不是字符串。 */
const CURVE_SAMPLES = 9

/**
 * **两条曲线在定义域上的最大函数值差**。
 *
 * ## 为什么是采样，而不是字符串比较、也不是我自己化简
 *
 * 题面写 `x³ − 3x`、图元里存 `x^3-3*x` —— **同一条曲线、两种写法**。字符串比会把它们判成
 * "不是这条函数"；而"先化简再比"要我另写一套化简，判据就变成"我的化简对不对"了。
 *
 * ## 边界（如实写在这里，不含糊）
 *
 * 采样等价**不是**符号证明 —— 两个不同的表达式恰好在 9 个点上取值相同是可能的。
 * 对高中阶段的有理 / 三角曲线，9 个点足以把"少一项""系数写错"这类错分开；
 * 但它证明的是"**在这 9 个点上没发现差异**"，不是"处处相同"。
 */
function curveGap(stated: string, drawn: FigureFunction): number | null {
  try {
    const expected = compileExpression(stated)
    const actual = compileExpression(drawn.expression)
    const [low, high] = drawn.domain
    let worst = 0
    for (let index = 0; index < CURVE_SAMPLES; index += 1) {
      const x = low + (high - low) * (index / (CURVE_SAMPLES - 1))
      const left = evaluateExpression(expected, { x })
      const right = evaluateExpression(actual, { x })
      if (!Number.isFinite(left) || !Number.isFinite(right)) return null
      worst = Math.max(worst, Math.abs(left - right))
    }
    return worst
  } catch {
    return null
  }
}

/**
 * **核验器自己算的导数**（中心差分）。
 *
 * ## 为什么不用内核那个
 *
 * 内核重算切线时会把 `slope` **写进图元**。若判据去读那个数，就是在拿系统自证：
 * 无论切点画在哪、斜率算成什么，图元里的数都会"符合"它自己。所以这里独立地
 * 从**表达式**出发数值求导 —— 与内核那条符号路径是两套实现，能互相证伪。
 *
 * 步长取 `1e-5 · max(1, |x|)`：对三次函数，中心差分的截断误差在这个步长下约 `1e-10`，
 * 远小于判据容差；而太小会让浮点相消吃掉全部有效位。
 */
function derivativeAt(source: { expression: string }, x: number): number | null {
  try {
    const compiled = compileExpression(source.expression)
    const step = 1e-5 * Math.max(1, Math.abs(x))
    const value = (evaluateExpression(compiled, { x: x + step }) - evaluateExpression(compiled, { x: x - step })) / (2 * step)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

/**
 * 椭圆的**人话描述**：半轴 + 由半轴决定的焦点。
 *
 * 焦点必须一起说：半轴对调时用户看到的是"两个数换了位置"，而后果其实是"焦点换了轴" ——
 * 后者才是他关心的事。
 */
function describeEllipse(radiusX: number, radiusY: number): string {
  const major = Math.max(radiusX, radiusY)
  const minor = Math.min(radiusX, radiusY)
  const focal = Math.sqrt(Math.max(0, major * major - minor * minor))
  const foci = radiusX >= radiusY ? `(±${formatNumber(focal)}, 0)` : `(0, ±${formatNumber(focal)})`
  return `半轴 (${formatNumber(radiusX)}, ${formatNumber(radiusY)})、焦点 ${foci}`
}

/** 三类圆锥曲线的人话描述。**都把"由参数决定、但用户真正关心"的那个量一起说出来**。 */
function describeConic(conic: FigureConic): string {
  if (conic.kind === "ellipse") return describeEllipse(conic.radiusX, conic.radiusY)
  if (conic.kind === "hyperbola") return `半轴 (${formatNumber(conic.radiusX)}, ${formatNumber(conic.radiusY)})、实轴沿 ${conic.axis} 轴`
  return `焦准距 p = ${formatNumber(conic.focalParameter)}、对称轴为 ${conic.axis} 轴`
}

/** 没有点名、由"恰好一条"确定的那几类图形。它们各自独立，缺谁就只有谁判不了。 */
interface FigureContext {
  conic: FigureConic | null
  tangent: FigureTangent | null
  curve: FigureFunction | null
}

function calculate(item: DiagramObligation, points: Map<string, Vector3>, figures: FigureContext): { actual: number; expected: number; tolerance: number; detail?: string } | null {
  /**
   * **圆锥曲线不走点名表**（V0c）：它没有顶点名，自己就是被核验的对象。
   *
   * 判据只比**半轴**，但结论包含**焦点** —— 因为焦点是半轴的函数（`c = √(a² − b²)`），
   * 两个半轴对调会把焦点从 `(±√5, 0)` 挪到 `(0, ±√5)`，那是另一条曲线。
   * 把这两个数一起写进 `detail`，用户才看得出"为什么半轴错了等于焦点错了"。
   */
  if (item.kind === "conicAxes") {
    const stated = item.conic
    const drawn = figures.conic
    if (stated === undefined || drawn === null) return null
    const tolerance = distanceTolerance(1)
    if (stated.kind === "ellipse" && drawn.kind === "ellipse") {
      const gap = Math.max(Math.abs(drawn.radiusX - stated.radiusX), Math.abs(drawn.radiusY - stated.radiusY))
      return { actual: gap, expected: 0, tolerance, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)}。` }
    }
    if (stated.kind === "hyperbola" && drawn.kind === "hyperbola") {
      /**
       * **轴单独判、不与数值差混在一起**：混进去的话"轴反了"会被当成"差了多少"报出来，
       * 而用户看到的两个半轴其实**一模一样** —— 那句话会让人以为系统算错了数。
       */
      if (drawn.axis !== stated.axis) {
        return { actual: 1, expected: 0, tolerance: 1e-9, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)} —— 半轴相同也是另一条曲线。` }
      }
      const gap = Math.max(Math.abs(drawn.radiusX - stated.radiusX), Math.abs(drawn.radiusY - stated.radiusY))
      return { actual: gap, expected: 0, tolerance, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)}。` }
    }
    if (stated.kind === "parabola" && drawn.kind === "parabola") {
      if (drawn.axis !== stated.axis) {
        return { actual: 1, expected: 0, tolerance: 1e-9, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)} —— 开口方向不同就是另一条曲线。` }
      }
      const gap = Math.abs(drawn.focalParameter - stated.focalParameter)
      return { actual: gap, expected: 0, tolerance, detail: `实测 ${describeConic(drawn)}；题设要求 ${describeConic(stated)}。` }
    }
    // 种类不同 ⇒ 图上根本不是题面说的那种曲线。
    return null
  }
  /**
   * **切线**（V0d）：题面只说"在 `x = 1` 处的切线"，斜率由**函数**决定。
   *
   * 所以两个数都要比，而且都不许读图元里那个自报的 `slope`：
   * ① 切点的横坐标必须就是题面说的那个 `x`（管"切在不在题面说的位置"）；
   * ② 斜率必须等于核验器**自己数值求出来**的 `f′(x)`（管"斜率对不对"）。
   *
   * 没有来源函数 ⇒ 求不了导 ⇒ 返回 `null`，由调用方如实报"未核验"。
   * **不许**退化成"那就只查横坐标吧" —— 那只核验了一半，却看起来像全过了。
   */
  if (item.kind === "tangentAt") {
    const stated = item.value
    const tangent = figures.tangent
    if (stated === undefined || tangent === null || tangent.source === null) return null
    const abscissaGap = Math.abs(tangent.x - stated)
    const expectedSlope = derivativeAt(tangent.source, stated)
    if (expectedSlope === null) return null
    if (abscissaGap > 1e-9) {
      return {
        actual: abscissaGap,
        expected: 0,
        tolerance: distanceTolerance(1),
        detail: `切点画在 x = ${formatNumber(tangent.x)}，题设要求 x = ${formatNumber(stated)}。`
      }
    }
    const slopeGap = Math.abs(tangent.slope - expectedSlope)
    return {
      actual: slopeGap,
      expected: 0,
      tolerance: distanceTolerance(expectedSlope),
      detail: `切线斜率实测 ${formatNumber(tangent.slope)}；由函数算得 f′(${formatNumber(stated)}) = ${formatNumber(expectedSlope)}。`
    }
  }
  if (item.kind === "functionGraph") {
    const stated = item.expression
    if (stated === undefined || figures.curve === null) return null
    const gap = curveGap(stated, figures.curve)
    if (gap === null) return null
    return {
      actual: gap,
      expected: 0,
      tolerance: distanceTolerance(1),
      detail: `图上画的是 ${figures.curve.expression}；题设要求 ${stated}（在 ${CURVE_SAMPLES} 个采样点上比函数值）。`
    }
  }
  const vertices = item.targets.map((name) => points.get(name))
  if (vertices.some((point) => point === undefined)) return null
  const at = (index: number): Vector3 => vertices[index]!
  const numeric = item.value
  if (item.kind === "pointCoordinate") {
    const coordinate = item.coordinate
    if (item.targets.length !== 1 || coordinate === undefined || ![coordinate.x, coordinate.y, coordinate.z].every(Number.isFinite)) return null
    return { actual: length(at(0), coordinate), expected: 0, tolerance: distanceTolerance(1) }
  }
  if (item.kind === "fixedLength") {
    if (numeric === undefined) return null
    return { actual: length(at(0), at(1)), expected: numeric, tolerance: distanceTolerance(numeric) }
  }
  if (item.kind === "equalLength") {
    const first = length(at(0), at(1))
    const second = length(at(2), at(3))
    if (Math.min(first, second) <= 1e-10) return null
    return { actual: second, expected: first, tolerance: distanceTolerance(first) }
  }
  if (item.kind === "equilateral") {
    const ab = length(at(0), at(1))
    const bc = length(at(1), at(2))
    const ca = length(at(2), at(0))
    if (Math.min(ab, bc, ca) <= 1e-10 || lengthVector3(crossVector3(subtractVector3(at(1), at(0)), subtractVector3(at(2), at(0)))) <= 1e-10) return null
    return { actual: Math.max(ab, bc, ca) - Math.min(ab, bc, ca), expected: 0, tolerance: distanceTolerance(ab) }
  }
  if (item.kind === "segmentRatio") {
    if (numeric === undefined) return null
    const [d, e, eAgain, a] = vertices as Vector3[]
    /**
     * **同一个 kind 装两种写法**（2026-10-10 用户现场）：
     * - `DE=2EA` —— **一个点把一条线段分开**：targets `[D,E,E,A]`（中间那个点名重复），判 `DE/EA`，
     *   而且要求 E **在线段 DA 上**（只看比值会把"斜着放在旁边"也判过）；
     * - `AD=2AB` —— **两条不同线段的倍数**：targets `[A,D,A,B]`（不重复），判 `|AD|/|AB|`。
     *
     * 判据原先只有第一支（`e !== eAgain` 直接 `return null`），于是第二支**永远核不了** ——
     * 只要题面里写了「AD=2AB」这种"两条线段成倍数"，门禁就永远不放行。抽取器早就把两种形状
     * 编得不一样（重复 / 不重复），缺的只是判据这一支。
     */
    if (e !== eAgain) {
      const numerator = length(d, e)
      const denominator = length(eAgain, a)
      if (denominator <= 1e-10) return null
      return { actual: numerator / denominator, expected: numeric, tolerance: UNITLESS_TOLERANCE }
    }
    const de = length(d, e)
    const ea = length(e, a)
    const da = length(d, a)
    if (ea <= 1e-10 || da <= 1e-10) return null
    // DE=2EA includes E on the segment DA, not merely a coincidental length ratio.
    const segmentGap = Math.abs(de + ea - da)
    if (segmentGap > distanceTolerance(da)) return { actual: segmentGap, expected: 0, tolerance: distanceTolerance(da) }
    return { actual: de / ea, expected: numeric, tolerance: UNITLESS_TOLERANCE }
  }
  if (item.kind === "midpoint") {
    const middle = at(0)
    const average = { x: (at(1).x + at(2).x) / 2, y: (at(1).y + at(2).y) / 2, z: (at(1).z + at(2).z) / 2 }
    if (length(at(1), at(2)) <= 1e-10) return null
    return { actual: length(middle, average), expected: 0, tolerance: distanceTolerance(length(at(1), at(2))) }
  }
  if (item.kind === "planePerpendicular") {
    const firstCount = item.planeLengths?.[0] ?? item.targets.length / 2
    const secondCount = item.planeLengths?.[1] ?? item.targets.length - firstCount
    if (![3, 4].includes(firstCount) || ![3, 4].includes(secondCount) || firstCount + secondCount !== vertices.length) return null
    const normal = (start: number) => crossVector3(subtractVector3(at(start + 1), at(start)), subtractVector3(at(start + 2), at(start)))
    const first = normal(0)
    const second = normal(firstCount)
    const firstMagnitude = lengthVector3(first)
    const secondMagnitude = lengthVector3(second)
    if (Math.min(firstMagnitude, secondMagnitude) <= 1e-10) return null
    if (firstCount === 4 && Math.abs(dotVector3(first, subtractVector3(at(3), at(0)))) / firstMagnitude > distanceTolerance(1)) return null
    if (secondCount === 4 && Math.abs(dotVector3(second, subtractVector3(at(firstCount + 3), at(firstCount)))) / secondMagnitude > distanceTolerance(1)) return null
    return { actual: Math.abs(dotVector3(first, second)) / (firstMagnitude * secondMagnitude), expected: 0, tolerance: UNITLESS_TOLERANCE }
  }
  if (item.kind === "dihedral") {
    if (numeric === undefined) return null
    const [e, b, c, d] = vertices as Vector3[]
    const detail = dihedralAngleDetail3([b, c, e], [b, c, d], b, c)
    return detail === null ? null : { actual: detail.interiorDegrees, expected: numeric, tolerance: ANGLE_TOLERANCE_DEGREES }
  }
  const kind = item.kind === "perpendicular" ? "perpendicular" : "parallel"
  /**
   * **平面可以用 3–6 个点名**（S2：底面支持 3–6 边）。多余的点先核**共面性**，
   * 再把前三个点交给既有的"线面残差"（它只认三点平面）。
   *
   * 此前只处理了"恰好四点"（`vertices.length === 6`）：五边形底面的 `PA ⊥ 平面 ABCDE`
   * 于是掉进 `checkedTargets = 全部 7 个` 那一支，残差认不出来 ⇒ 一律"未核验"。
   */
  const planeCount = vertices.length - 2
  if (planeCount > 3) {
    const origin = at(2)
    const normal = crossVector3(subtractVector3(at(3), origin), subtractVector3(at(4), origin))
    const magnitude = lengthVector3(normal)
    if (magnitude <= 1e-10) return null
    for (let index = 5; index < vertices.length; index += 1) {
      if (Math.abs(dotVector3(normal, subtractVector3(at(index), origin))) / magnitude > distanceTolerance(1)) return null
    }
  }
  const checkedTargets = planeCount > 3 ? item.targets.slice(0, 5) : item.targets
  const residual = relationResidual({ kind, targets: checkedTargets.map((vertex) => ({ vertex })) }, (target) => points.get(target.vertex) ?? null)
  return residual === null ? null : { actual: residual, expected: 0, tolerance: UNITLESS_TOLERANCE }
}

/**
 * **圆锥曲线 / 切线 / 函数曲线都不带点名**：拿"点表建不出来"当理由会给出一个与它们无关的解释。
 * （切线的来源是**函数**，曲线的来源是**表达式**，都不是点名点集。）
 *
 * 抽成一个函数是因为它现在有**两处**消费者：核验本身，与"题设点到、图上却没有的点名"那条
 * 查询（`missingNamedPoints`）—— 两处各写一遍就是"同一个判断写了两遍"。
 */
function isPointBased(kind: DiagramObligationKind): boolean {
  return kind !== "conicAxes" && kind !== "tangentAt" && kind !== "functionGraph"
}

/** 题设点到、而候选图上**没有**的那个点名。 */
export interface MissingNamedPoint {
  kind: DiagramObligationKind
  /** 题设原文（面板与假设文案都要用它）。 */
  sourceText: string
  /** 这条题设点到的全部点名，按题面顺序。 */
  targets: readonly string[]
  /** 其中图上的点名表里确实没有的那些（去重、保持题面顺序）。 */
  missing: readonly string[]
  /** 题面写下的数值（`DE=2EA` 的 `2`）—— 比例分点的构造参数由它算出来。 */
  value?: number
}

/**
 * **题设点到、而候选图上没有的点名**（2026-10-10）。
 *
 * 现场（用户这台机器上 7 次、逐字相同的失败）：模型只交了一笔四面体，题面里的
 * `O为 BD的中点` 是**系统自己**从原话抽的题设，而 `O` 在图上不存在 ⇒ 那条题设永远无法核验
 * ⇒ 门禁判 `failed`、整轮不提交。这一条查询就是"缺哪些名字"的唯一来源：
 * 编译器拿它去**按题设补建**（只补题设唯一确定了构造的那些，见 `planCompiler`），
 * 核验器拿它把理由**说清缺谁**。
 *
 * **点名表建不出来时（`null`）返回空数组**：那时"缺谁"根本无从谈起，报告给的是另一句理由
 *（"候选图缺少唯一、可靠的顶点名映射"），两边不许混。
 */
export function missingNamedPoints(set: DiagramObligationSet, plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument): MissingNamedPoint[] {
  const points = candidatePoints(plan, candidate, base)
  if (points === null) return []
  const out: MissingNamedPoint[] = []
  for (const item of set.givens) {
    if (!isPointBased(item.kind)) continue
    const missing = [...new Set(item.targets.filter((name) => !points.has(name)))]
    if (missing.length === 0) continue
    out.push({
      kind: item.kind,
      sourceText: item.sourceText,
      targets: item.targets,
      missing,
      ...(item.value === undefined ? {} : { value: item.value })
    })
  }
  return out
}

export function verifyDiagramObligations(set: DiagramObligationSet, plan: PlanEnvelope, candidate: GeometryDocument, base?: GeometryDocument, options: DiagramVerificationOptions = {}): DiagramVerificationReport {
  const points = candidatePoints(plan, candidate, base)
  const figures: FigureContext = { conic: candidateConic(plan, candidate, base), tangent: candidateTangent(plan, candidate, base), curve: candidateCurve(plan, candidate, base) }
  const checks: DiagramCheck[] = set.givens.map((item) => {
    const pointBased = isPointBased(item.kind)
    if (pointBased && points === null) return { kind: item.kind, sourceText: item.sourceText, status: "unverified", reason: "候选图缺少唯一、可靠的顶点名映射；不能按题面顺序猜坐标。" }
    const result = calculate(item, points ?? new Map(), figures)
    if (result === null) {
      /**
       * **先说清缺谁**（2026-10-10）：原先只有一句把三种成因混起来的
       * "点名缺失、图形退化或角度无法计算"，用户与模型都读不出下一步。
       * 点名表在手上时，"缺谁"是**算得出来的**，所以这一段把它写出来；
       * 退化 / 算不出角度仍然落回原句（那时缺的不是名字）。
       */
      const missing = pointBased && points !== null ? [...new Set(item.targets.filter((name) => !points.has(name)))] : []
      return {
        kind: item.kind,
        sourceText: item.sourceText,
        status: "unverified",
        reason: missing.length > 0
          ? `点名缺失：${missing.join("、")} —— 题面点到了它${missing.length > 1 ? "们" : ""}，图上没有这个对象，未核验。`
          : item.kind === "conicAxes"
            ? "候选图里没有唯一、可读的圆锥曲线（少了或多了一条），未核验。"
            : item.kind === "tangentAt"
              ? "候选图里没有唯一、可读的切线，或那条切线没有函数来源（求不了导），未核验。"
              : item.kind === "functionGraph"
                ? "候选图里没有唯一、可读的函数曲线（少了或多了一条），或题面表达式解析不了，未核验。"
                : "点名缺失、图形退化或角度无法计算，未核验。"
      }
    }
    const status = Math.abs(result.actual - result.expected) <= result.tolerance ? "passed" : "failed"
    const reason = result.detail !== undefined
      ? (status === "passed" ? result.detail : `${result.detail}最大偏差 ${result.actual.toPrecision(5)}，容差 ${result.tolerance.toPrecision(5)}。`)
      : (status === "passed" ? "已按候选图坐标核验。" : `实测 ${result.actual.toPrecision(5)}，题设要求 ${result.expected}。`)
    return { kind: item.kind, sourceText: item.sourceText, status, reason, expected: result.expected, actual: result.actual }
  })
  checks.push(...set.unverified.map((entry): DiagramCheck => ({ kind: "unparsed", sourceText: entry.sourceText, status: "unverified", reason: entry.reason })))
  const sampleValues: string[] = []
  for (const name of set.freeChoices) {
    const point = points?.get(name)
    if (!point) checks.push({ kind: "unparsed", sourceText: `自由点 ${name}`, status: "unverified", reason: "此自由点未能对应候选图中的点名。" })
    else sampleValues.push(`自由点 ${name} 采用示例坐标 (${point.x}, ${point.y}, ${point.z})`)
  }
  if (checks.length === 0) checks.push({ kind: "unparsed", sourceText: "题设", status: "unverified", reason: "没有可靠识别到可核验的题设，不能用空报告宣布全部通过。" })
  const status = checks.some((entry) => entry.status === "failed") ? "failed" : checks.some((entry) => entry.status === "unverified") ? "unverified" : "passed"
  return {
    status,
    checks,
    sampleValues,
    ...(options.obligationIR === true ? { obligationIR: buildObligationIR(set) } : {})
  }
}
