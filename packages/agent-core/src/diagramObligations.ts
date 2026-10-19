import { canonicalPointName, POINT_NAME_SOURCE, splitPointNames } from "@draw/geometry-kernel"

import { parseShapeClause } from "./solver/shapeGrammar"

/** 题设来自用户原话而不是模型的 relations 声明。只读有确定点名的窄句型。 */
export type DiagramObligationKind =
  | "fixedLength" | "equilateral" | "equalLength" | "midpoint" | "segmentRatio"
  | "planePerpendicular" | "dihedral" | "vectorDot" | "perpendicular" | "parallel" | "pointCoordinate"
  | "acuteTriangle" | "rightTriangle" | "obtuseTriangle" | "pointInsideTriangle"
  /**
   * **角平分线**（2026-10-20）：`AD 平分 ∠BAC` ⇒ `targets: ["D", "A", "B", "C"]`
   * （点在先、顶点其次、两边端点在后，与 `midpoint` 同一条约定）。
   *
   * 判据判**两件事，必须一起**：① `∠BAD = ∠DAC`（两个角相等）；② `∠BAD + ∠DAC = ∠BAC`
   * （点在角**内部**）。少了第②条，`D` 落在平分线的**反方向**上时两个角照样相等 ——
   * 而那条射线根本不在角里（实测反例见 `angleBisector.test.ts`）。
   */
  | "angleBisector"
  /**
   * **平面上的数值角**（§3-F，2026-10-10）：`∠ABC=60°` ⇒ `targets: ["A","B","C"]`（中间是顶点）、
   * `value` 是度数。它与 `dihedral`（二面角）是两件事：这一档说的是**同一个平面内**两条边的内部角。
   */
  | "planarAngle"
  /**
   * **面积**（Task 11，2026-10-12）：`△ABC的面积为6` ⇒ `targets: ["A","B","C"]`、`value` 是面积。
   *
   * 调研 §2.1 的硬要求："只满足正弦定理而**不核面积**的图是**错误图**" —— 所以面积必须
   * 从"读不懂的残留"变成一条**有读取器、有核验**的条件。
   */
  | "area"
  | "conicAxes"
  /**
   * **实体的标量尺寸**（2026-10-20，联考「无核验项」审计的 A 类）：`圆锥的底面半径为2`、
   * `母线长为3`、`底面积为π`、`侧面积为2π`、`高为4`。
   *
   * 为什么它必须是一种**义务**而不是"画的时候顺手用一下"：这一族条件的**判据与点名无关** ——
   * 它问的是"这条实体的这个度量是不是题面说的那个数"，而度量可以从实体自己的
   * `radius` / `height` 算出来（母线 / 底面积 / 侧面积都是这两个数的函数）。
   *
   * **它也是 `planHasVerifiableFigure` 之外的那条窄闸**（`planCompiler` 里 `solidDimensionGate`）：
   * 圆锥 / 圆柱**不带题面点名**，所以此前这三个字面量根本没进过核验。
   */
  | "solidDimension"
  /**
   * **直线与这条圆锥曲线的交点**（Task 14）。
   *
   * 为什么单开一种、而不是并进 `conicAxes`：`conicAxes` 比的是**曲线自己的参数**，
   * 这一条比的是**交点的个数与位置** —— 两件事的判据、失败文案和错法都不一样
   *（轴反了 vs 丢了一个交点）。计划对 Task 14 点名的"相切 / 无交 / 竖直线 / 丢一交点"
   * 全都落在这条上。
   */
  | "conicChord"
  | "tangentAt"
  | "functionGraph"
  | "commonTangent"
  /**
   * **线面角**（Task 13 的边界「斜棱柱明说倾角」，2026-10-14）：`AA′与底面所成角为45°`
   * ⇒ `targets` 前两个是线段的两个点名、其余是平面的点名（与 `planePerpendicular` 同一条约定，
   * `planeLengths` 也是同一个含义）。
   *
   * 为什么它必须是一条**判据**而不是"构造时顺手读一下"：题面明说的倾角此前**完全没进链**
   *（解析器里没有"所成角"的读取器）⇒ 写 45° 与写 60° 取到的是同一个**代表值**，
   * 图上那条侧棱与底面实际成 30°。那是"题面明说的条件等于没发生"，比读不懂更糟。
   */
  | "linePlaneAngle"
  /**
   * **函数与直线的交点个数**（Task 15 的边界，2026-10-14）：`直线 y=0.5 与 f(x)=sin x 的图像有三个交点`
   * ⇒ `line` 是题面那条直线、`value` 是题面写的**个数**；`targets` 为空（这一条不带点名）。
   *
   * 边界原文：内核那一侧早就有 `functionLineRoots`（代数路径给精确根、数值路径带 `complete`），
   * 缺的是"题面写了几个交点"这条判据 ⇒ 真题里"多交点"那一型的产品入口只有作图 + 内核读数，
   * **进不了核验面板**。
   */
  | "functionLineIntersections"
  /**
   * **点在圆锥曲线上**（施工单①，2026-10-15）：`P 是椭圆上任意一点` ⇒ `targets: ["P"]`、
   * `conicKind` 是题面说的那一种曲线。
   *
   * 为什么它是一条**判据**而不是"读一下就算了"：这句话此前**整句消失**（既不进给定、也不进
   * 未核验），于是"图上那个 P 到底在不在椭圆上"从来没人问过 —— 把 P 画在椭圆里面，报告照样全绿。
   * 那是与当年 `弦 AB 的长为 3` 同一种病：**一条题设等于没发生**。
   *
   * **"任意一点"那层普遍性不属于这一条**：这里核的是图上这一点（实例），普遍性由报告的
   * `proofScope` / `universalClaims` 如实承担，判据不许假装证明了它。
   */
  | "pointOnConic"
  /**
   * **点在一条线段上**（2026-10-15 用户现场，Rt△ABC 折起那道题）：`D 为 AC 上一点`
   * ⇒ `targets: ["D", "A", "C"]`（**点在先**，与 `midpoint` 同一条约定）。
   *
   * 与 `pointOnConic` **只差一个字**（`上` 后面是两个点名而不是曲线名），但它此前
   * **只有触发词、没有判据** ⇒ 落"未核验"，一句"今天还没有判据"。而它是**量得动**的：
   * ① 与这条直线共线、② 落在线段内（参数 `t ∈ [0,1]`）。两件事**都要判**，
   * 因为它们**不是同一种错**：`D 在 AC 的延长线上` 与 `D 根本不在 AC 这条线上`
   * 是两种不同的读错法（判据文案会指名是哪一种，见 `diagramVerification` 那一支）。
   */
  | "pointOnSegment"

/**
 * 题面写下的**直线**（用于 `conicChord`）。
 *
 * 只收两种写法：斜截式（`y = kx + m`，`k` 省略即 1、`m` 省略即 0）与竖直线（`x = c`）。
 * **竖直线必须单独一支**：它是斜截式表达不了的那一半，而真题里恰恰常见
 *（双曲线顶点处的切线就是竖直的）。
 */
export type DiagramStatedLine =
  | { kind: "slope"; slope: number; intercept: number }
  | { kind: "vertical"; x: number }

/**
 * 题面写下的圆锥曲线参数。
 *
 * 只收**方程直接给出的**那一组：`x²/9+y²/4=1` ⇒ 沿 x 的半轴 3、沿 y 的半轴 2。
 * 焦点位置**不单独存** —— 它由这两个半轴决定（`c = √(a² − b²)`），
 * 存第二份就会多出一个可能与第一份打架的来源。
 */
export type DiagramConicStated =
  | { kind: "ellipse"; radiusX: number; radiusY: number }
  /**
   * 双曲线：**轴是曲线的一部分**，不是摆设 —— `x²/a² − y²/b² = 1` 与它的轴对调版
   * 是两条互为镜像的曲线，半轴一模一样也一样不是同一条。
   */
  | { kind: "hyperbola"; radiusX: number; radiusY: number; axis: "x" | "y" }
  /** 抛物线：焦准距 `p`（`y² = 2px` 里的 `p`，所以 `y² = 4x` 的 `p = 2`）与对称轴。 */
  | { kind: "parabola"; focalParameter: number; axis: "x" | "y" }
  /**
   * **圆**：它需要**圆心**，所以不能并进椭圆 —— 椭圆那一档假定曲线以原点为中心，
   * 把一个平移过的圆塞进去只会得到一条"位置错了的椭圆"。
   *
   * 从一般方程 `x²+y²+Dx+Ey+F=0` 读：圆心 `(−D/2, −E/2)`、半径 `√((D²+E²)/4 − F)`；
   * 半径平方不为正（一个点 / 虚圆）就**不是圆**，读取器返回 `null`。
   */
  | { kind: "circle"; centerX: number; centerY: number; radius: number }

export interface DiagramObligation {
  kind: DiagramObligationKind
  sourceText: string
  start: number
  end: number
  targets: string[]
  value?: number
  planeLengths?: [number, number]
  coordinate?: { x: number; y: number; z: number }
  conic?: DiagramConicStated
  /**
   * `pointOnConic` 专用：题面那句里写的**是哪一种**圆锥曲线（`P 是椭圆上一点` ⇒ `"ellipse"`）。
   * 只记种类，不记半轴 —— 那句话里没有半轴，记了就是给半轴造出第二个来源。
   */
  conicKind?: "ellipse" | "hyperbola" | "parabola" | "circle"
  /** `conicChord` 专用：题面写下的那条直线。 */
  line?: DiagramStatedLine
  /** `conicChord` 专用：题面声称的交点情形（**代数重数**那一套，与 `intersectLineWithConic` 的档位同名）。 */
  expectation?: "secant" | "tangent" | "single" | "none"
  /** 题面写下的函数表达式（**已规范化**：上标转 `^`、隐式乘号补 `*`）。 */
  expression?: string
  /** `commonTangent` 专用：题面写下的两条函数表达式。 */
  expressions?: [string, string]
  /**
   * `solidDimension` 专用：**哪一个实体的哪一个度量**（`value` 是题面写下的那个数）。
   *
   * 只记形状与度量名，不记实体 id —— 这条义务说的是"图上那条圆锥"，而具体是哪一条，
   * 由核验层在**候选图**里认（与 `conicAxes` 认曲线同一条纪律：不在计划里猜）。
   */
  solid?: {
    shape: "cone" | "cylinder" | "pyramid"
    metric: "radius" | "height" | "slantHeight" | "baseArea" | "lateralArea" | "baseEdge" | "lateralEdge" | "basePerimeter"
  }
}

export interface DiagramSourceSpan {
  sourceText: string
  start: number
  end: number
}

export interface DiagramObligationSet {
  givens: DiagramObligation[]
  goals: string[]
  /** Optional for legacy/manual sets; parsed prompts carry exact original text and offsets. */
  goalSources?: DiagramSourceSpan[]
  freeChoices: string[]
  freeChoiceSources?: (DiagramSourceSpan & { name: string })[]
  unverified: { sourceText: string; reason: string }[]
}

/** 读取器的产物：一条判据，或**多条**（一个句型蕴含多条判据时用 —— 例如"底面 ABCD 是菱形" ⇒ 三条等长）。 */
type ObligationDraft = Pick<DiagramObligation, "kind" | "targets" | "value" | "planeLengths" | "coordinate" | "conic" | "conicKind" | "line" | "expectation" | "expression" | "expressions">

interface Matcher {
  pattern: RegExp
  read: (match: RegExpExecArray) => ObligationDraft | ObligationDraft[] | null
  /**
   * 允许这一条在**标签冒号**之后匹配（`椭圆C：x²/16+y²/4=1`）。
   *
   * 默认的"后缀守卫"要挡住比例写法（`AE:AD=2:5` 里的 `AD=2` 不是一条长度）与
   * `∠ABC=60°` 的后缀，所以匹配前面是 `[A-Z∠:：]` 时一律跳过。但**曲线方程**是例外：
   * 题面常写成「曲线名 + 标签 + 全角冒号 + 标准方程」，冒号前面那个字母是曲线的名字，
   * 不是点名的尾巴。只有把开关打开的这几条（椭圆/双曲线/抛物线）能穿过守卫，
   * 别的读取器照旧被挡住 —— 拆掉整条守卫会让比例写法立刻读错。
   */
  allowAfterLabelColon?: boolean
  /**
   * 允许这一条的匹配**跨过别的读取器已经吃掉的字符**（默认不允许）。
   *
   * 目前只有"曲线过点"需要它：`椭圆 x²/9+y²/4=1 过点 P、Q` 这一句里，方程那一段已经被
   * 椭圆读取器用掉，而"过点"条件必须**带着前面的曲线名**才读得出种类 —— 两段天然重叠。
   * 标记仍然照做（幂等），所以残留扫描不会把这一句再报成未核验。
   */
  allowOverlap?: boolean
}

export interface DiagramParseOptions { spatialPointConditions?: boolean }

/** Only the explicit V0a experimental path recognizes these narrow 3D coordinates. */
const POINT_COORDINATE_MATCHER: Matcher = {
  pattern: /([A-Z])\s*=\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g,
  read: (match) => {
    const values = match.slice(2, 5).map(Number)
    return values.every(Number.isFinite)
      ? { kind: "pointCoordinate", targets: [match[1]], coordinate: { x: values[0], y: values[1], z: values[2] } }
      : null
  }
}

/**
 * 点名串 → 点名列表。
 *
 * **不再按码位拆字**：`[...value]` 会把 `A′B` 切成 `["A","′","B"]`，于是带撇 / 带下标的点名
 * 在解析层**根本读不出来**（棱柱题面 `AA₁⊥平面ABCD` 实测 0 条给定，只能作为 `unverified` 残留）。
 * 现在与核验器、内核顶面命名共用内核的 `pointNames`（S1，设计 §3.3）。
 */
/**
 * 拆点名。**顺带把撇的排版变体归一**（`canonicalPointName`）：题面写 `C'`、模型写 `C’`、
 * 文档标签写 `C′` 都归成同一种字符 —— 否则核验按名字查表时永远对不上（2026-10-15 用户现场）。
 */
const names = (value: string): string[] => splitPointNames(value).map(canonicalPointName)

/**
 * 规则里拼点名子模式的**唯一**来源 —— 与 `names()` 同出一处。
 *
 * 为什么不能继续写死 `[A-Z]{2}`：那个字面量就是"三处各写一份判断"里的第一处。
 * 线段 = 两个点名；三角/平面 = 三到四个点名（平面多为四点，但要收三点的写法）。
 */
const POINT_NAME = POINT_NAME_SOURCE
const SEGMENT_NAME = `${POINT_NAME}${POINT_NAME}`
const TRIANGLE_NAME = `${POINT_NAME}${POINT_NAME}${POINT_NAME}`
/**
 * 平面点名的个数是 **3–6**：首批底面范围是 3–6 边（用户裁决），`平面ABCDE` 这种五边形底面
 * 必须能读出来。此前只到 4 —— 于是"五棱锥 + `PA ⊥ 平面 ABCDE`"在解析层整句消失，
 * 搜索层只能报"题面没有给出线段⊥平面的写法"（**题面明明给了**，是解析层没产出来）。
 */
const PLANE_NAME = `${TRIANGLE_NAME}(?:${POINT_NAME}){0,3}`
/**
 * 题面写"底面"时留下的**占位**（不是点名）：整句解析完之后由 `resolveStatedBasePlane`
 * 落成具体点名。写成一个常量是因为它要跨两个函数用，而"哪个字面量表示占位"不该有第二份。
 */
const STATED_BASE = "底面"
/**
 * **单字母角**（`∠A`）留下的占位：它只给了一个点名，**两条边是哪两条**要看形状从句的环。
 * 由 `resolveStatedVertexAngle` 落成 `[前一个点名, 顶点, 后一个点名]`（判据与构造照旧）。
 */
const STATED_VERTEX_ANGLE = "顶点角"
const finitePositive = (value: string): number | null => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/**
 * 从方程的分母还原半轴：`x²/9 + y²/4 = 1` 的分母是**半轴的平方**（`a²` / `b²`），
 * 所以半轴是 `√9 = 3` 与 `√4 = 2`。**直接拿分母当半轴是错的**，而那个错误看起来完全合理 ——
 * 实测就是这么错的：`(9, 4)` 被当成半轴报了出去，直到用例把正确答案摆出来才发现。
 *
 * 分母必须是有限正数：`x²/0+y²/4=1` 不是椭圆，`x²/-1+…` 更不是 —— 一律不认，交回未核验。
 */
/**
 * **根号数字**（2026-10-11 用户现场）。
 *
 * `AD=5√3` 此前读不出来，而原因不是"没人想到"：长度句型匹配到 `AD=5` 之后，紧跟的 `√`
 * 命中句型表里那道**刻意的守卫**（"这个数字后面还跟着东西就不算一个长度"），整条匹配被丢弃 ⇒
 * 这一句落进残留、变成一条"未核验的条件" ⇒ 门禁把整轮拦下（`题设尚未核验，本次不会提交`）。
 *
 * 守卫拦得对（`AD=5√3` 确实不是"AD 等于 5"），**缺的是根号数字本身**。
 *
 * 写法只收三种，且**整条必须被吃干净**：`5√3`、`√3`、`5`。
 * `5√`、`5√3√2`、`√` 一律不认 —— 由负向断言与 `radicalValue` 双重把关，
 * 认不出来就照旧落进残留、如实报"未核验"，不许猜一个数出来。
 *
 * 它必须定义在 `DIAGRAM_OBLIGATION_MATCHERS` **之前**：那张表在模块初始化时就构造正则，
 * 放到后面会是一个 `Cannot access … before initialization`（本轮实测踩到）。
 */
const RADICAL_NUMBER_SOURCE = String.raw`(\d+(?:\.\d+)?\s*√\s*\d+(?:\.\d+)?|√\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?)`

function ellipseAxes(denominatorX: number, denominatorY: number): Pick<DiagramObligation, "kind" | "targets" | "conic"> | null {
  if (!Number.isFinite(denominatorX) || !Number.isFinite(denominatorY) || denominatorX <= 0 || denominatorY <= 0) return null
  return { kind: "conicAxes", targets: [], conic: { kind: "ellipse", radiusX: Math.sqrt(denominatorX), radiusY: Math.sqrt(denominatorY) } }
}

/** 双曲线的两个半轴（同样从分母开方）。`axis` 由**写法**决定：`x²/… − y²/… = 1` 的实轴沿 x。 */
function hyperbolaAxes(denominatorX: number, denominatorY: number, axis: "x" | "y"): Pick<DiagramObligation, "kind" | "targets" | "conic"> | null {
  if (!Number.isFinite(denominatorX) || !Number.isFinite(denominatorY) || denominatorX <= 0 || denominatorY <= 0) return null
  return { kind: "conicAxes", targets: [], conic: { kind: "hyperbola", radiusX: Math.sqrt(denominatorX), radiusY: Math.sqrt(denominatorY), axis } }
}

/**
 * 抛物线：题面写的是 `y² = 4x`，那个 `4` 是 **`2p`** —— 焦准距 `p = 4/2 = 2`。
 * **直接拿系数当 `p` 是错的**，而且错得很像对的（`y² = 4x` 的 `p` 看上去就是 4）。
 */
function parabolaAxis(coefficient: number, axis: "x" | "y"): Pick<DiagramObligation, "kind" | "targets" | "conic"> | null {
  if (!Number.isFinite(coefficient) || coefficient === 0) return null
  return { kind: "conicAxes", targets: [], conic: { kind: "parabola", focalParameter: coefficient / 2, axis } }
}

/**
 * **圆的一般方程**：`x²+y²+Dx+Ey+F=0`（也可写成 `x²+y²=4` 这种右端非零的形式）。
 *
 * 只收**严格的这一种顺序**（x²、y² 相邻，然后可选的 `x` 项、可选的 `y` 项、可选的常数项）：
 * 换顺序的写法（`x²−4x+y²+2y−4=0`）让"系数到底属于谁"变成第二个判断，宁可留给未核验。
 *
 * `rightHand` 是等号右边的数：`x²+y²=4` ⇔ `x²+y²−4=0`，所以常数项是 `0 − 4`。
 */
function circleFromGeneralEquation(rest: string, rightHand: number): Pick<DiagramObligation, "kind" | "targets" | "conic"> | null {
  const compact = rest.replace(/\s+/g, "").replace(/[−–]/g, "-")
  const form = /^(?:([+-])(\d+(?:\.\d+)?)?x)?(?:([+-])(\d+(?:\.\d+)?)?y)?(?:([+-])(\d+(?:\.\d+)?))?$/.exec(compact)
  if (form === null) return null
  const coefficient = (sign: string | undefined, magnitude: string | undefined): number => {
    if (sign === undefined) return 0
    const size = magnitude === undefined ? 1 : Number(magnitude)
    return sign === "-" ? -size : size
  }
  const d = coefficient(form[1], form[2])
  const e = coefficient(form[3], form[4])
  const constant = coefficient(form[5], form[6])
  const f = constant - rightHand
  const squaredRadius = (d * d + e * e) / 4 - f
  if (!Number.isFinite(squaredRadius) || squaredRadius <= 0) return null
  // `-0` 会让"圆心在原点"与 `0` 比较失败（`Object.is(-0, 0) === false`），统一成 `0`。
  const centerX = d === 0 ? 0 : -d / 2
  const centerY = e === 0 ? 0 : -e / 2
  return {
    kind: "conicAxes",
    targets: [],
    conic: { kind: "circle", centerX, centerY, radius: Math.sqrt(squaredRadius) }
  }
}

/**
 * **「焦点 + 离心率 ⇒ 曲线」的三段模式**（2026-10-20，联考「无核验项」审计的 B 类）。
 *
 * 它们不是"又一条读取器表项"，而是**同一句里的三块数据**：曲线名 + 焦点坐标 + 离心率，
 * 缺一块就解不出唯一的曲线。所以读取写在 `resolveFocusEccentricity` 里（放在整句解析之后），
 * 而不是写成一条正则 —— 一条正则要么漏掉语序差异，要么把隔壁从句一起吃进去。
 *
 * 三个模式都**从标签词开始**（`离心率`、`右焦点`）：命中之后整段会被标成"已用"，
 * 否则残留扫描器会把 `离心率 e=√5` 里的 `=` 当成一条没读出来的条件，同一句报两遍。
 */
const CURVE_NAME_PATTERN = /(椭圆|双曲线|抛物线)/g
const ANY_CURVE_NAME = /椭圆|双曲线|抛物线/g
const FOCUS_COORDINATE = /(?:左|右|上|下)?焦点(?:的?坐标)?(?:为|是|=)\s*(?:[A-Z]\s*)?[（(]\s*(-?[0-9.√]+)\s*[,，]\s*(-?[0-9.√]+)\s*[）)]/
const ECCENTRICITY_VALUE = /离心率\s*e?\s*(?:为|是|=)\s*([0-9.√]+(?:\s*\/\s*[0-9.]+)?)/
const ORIGIN_CENTER = /(?:中心|顶点)[^。；;，,\n]{0,6}?原点/

/**
 * **离心率的值**：`√5` / `2√5` / `1` / `1/2` / `√3/2` / `0.5`。
 *
 * 分式的两端各自求值（分子可以是根号），**整条必须被吃干净** —— `√3/2/2` 这种
 * 不是离心率，宁可返回 `null` 让它落进未核验。
 */
function eccentricityValue(raw: string): number | null {
  const compact = raw.replace(/\s+/g, "")
  const fraction = /^([0-9.√]+)\/([0-9.]+)$/.exec(compact)
  const value = fraction === null
    ? radicalValue(compact)
    : (() => {
      const numerator = radicalValue(fraction[1]!)
      const denominator = Number(fraction[2])
      return numerator === null || !Number.isFinite(denominator) || denominator <= 0 ? null : numerator / denominator
    })()
  return value !== null && Number.isFinite(value) && value > 0 ? value : null
}

/** 焦点的那个**非零坐标**（到中心的距离）。`(-2√5, 0)` 与 `(2√5, 0)` 说的是同一个距离。 */
function focusDistance(raw: string): number | null {
  const magnitude = raw.replace(/^[+-]/, "")
  return radicalValue(magnitude)
}

/**
 * **「中心（顶点）在原点 + 焦点坐标 + 离心率」⇒ 一条 `conicAxes`**（2026-10-20，联考 `joint-23`）。
 *
 * 为什么必须认它：高考圆锥曲线大题**几乎不直接给方程**，给的是这三个参数，方程要自己解出来。
 * 今天只会从**方程**认曲线，于是 `joint-23` 那类题一条义务都产不出来 —— 图能画，但没有东西被核验。
 *
 * **为什么这不违背"不猜"**：中心在原点 + 焦点在一条坐标轴上 + 离心率，把标准位置的椭圆 / 双曲线
 * **唯一确定**（`a = c/e`，`b² = a² − c²` 或 `c² − a²`；抛物线只需焦点，`p = 2c`），
 * 推出来的是**等式的结果**，不是从语序里补出来的假设。判据层因此**不需要新东西** ——
 * 推出来的 `a`、`b`、轴正好是既有 `conicAxes` 判据要量的那三样。
 *
 * **四条边界，一条都不许松**（松了就是替题面猜曲线）：
 * 1. 没说中心（顶点）在原点 ⇒ 曲线摆哪儿定不下来，不推；
 * 2. 只有离心率 ⇒ 它只管**形状**（a 与 b 的比例），定不出大小，不推；
 * 3. 只有焦点坐标 ⇒ 椭圆 / 双曲线的 `a` 未知，不推（抛物线不需要离心率，是**唯一**例外）；
 * 4. 离心率与曲线种类矛盾（椭圆要 `0 < e < 1`、双曲线要 `e > 1`、抛物线要 `e = 1`）⇒ 不推。
 *
 * 以上每一条都**落进未核验并给理由**，因为"读不出"必须看得见（本项目的第一条纪律）。
 * 已经有方程时不再从参数推一遍：窗口里已经有 `conicAxes` 就打住，只留方程那一条。
 */
function resolveFocusEccentricity(
  givens: DiagramObligation[],
  unverified: DiagramObligationSet["unverified"],
  givenText: string,
  used: Set<number>
): void {
  /** 同一个从句里只处理第一次出现的曲线名（`椭圆与双曲线交于…` 这种今天不硬解）。 */
  const handledEnds: number[] = []
  for (const match of givenText.matchAll(CURVE_NAME_PATTERN)) {
    const start = match.index
    const name = match[1]!
    if (handledEnds.some((end) => start < end)) continue
    const tail = givenText.slice(start)
    const delimiter = /[。；;\n]/.exec(tail)
    const nextName = [...tail.slice(1).matchAll(ANY_CURVE_NAME)][0]
    const end = start + Math.min(delimiter?.index ?? tail.length, nextName === undefined ? tail.length : (nextName.index ?? tail.length) + 1, 120)
    handledEnds.push(end)
    const window = givenText.slice(start, end)
    /**
     * 已经有方程覆盖这条曲线时**不重复读**：`双曲线C：x²/4−y²/16=1，其右焦点为(2√5,0)…`
     * 那句里参数是方程的注脚，再从参数推一遍会得到**第二条**同义义务。
     */
    if (givens.some((entry) => entry.kind === "conicAxes" && (entry.start ?? -1) >= start && (entry.start ?? -1) < end)) continue
    const focus = FOCUS_COORDINATE.exec(window)
    const eccentricity = ECCENTRICITY_VALUE.exec(window)
    if (focus === null && eccentricity === null) continue
    const report = (reason: string): void => {
      unverified.push({ sourceText: window.trim(), reason })
    }
    if (ORIGIN_CENTER.exec(window) === null) {
      report("题面给了焦点 / 离心率，但**没有说中心（顶点）在原点** —— 曲线摆在哪儿定不下来，不推方程，未核验。")
      continue
    }
    if (focus === null) {
      report("只给了离心率：离心率只管**形状**（两个半轴的比例），定不出大小 —— 还需要一个焦点坐标才解得出 `a`、`b`，未核验。")
      continue
    }
    const horizontal = focusDistance(focus[1]!)
    const vertical = focusDistance(focus[2]!)
    if ((horizontal === null && vertical === null) || (horizontal !== null && vertical !== null)) {
      report("这个焦点坐标读不出「到中心的距离」，未核验。")
      continue
    }
    const axis: "x" | "y" = horizontal === null ? "y" : "x"
    const distance = (horizontal ?? vertical)!
    if (distance <= 0) {
      report("焦点与中心重合（距离为 0），这不是一个能画出来的椭圆 / 双曲线 / 抛物线，未核验。")
      continue
    }
    const eccentricityNumber = eccentricity === null ? null : eccentricityValue(eccentricity[1]!)
    if (eccentricity !== null && eccentricityNumber === null) {
      report("这个离心率的数值读不出来，未核验。")
      continue
    }
    const draft = ((): Pick<DiagramObligation, "kind" | "targets" | "conic"> | null => {
      if (name === "抛物线") {
        if (eccentricityNumber !== null && Math.abs(eccentricityNumber - 1) > 1e-9) return null
        // `parabolaAxis` 收的是 `2p`，而焦点到顶点是 `p/2` ⇒ 系数 = 4c（见 `parabolaAxis` 的注释）。
        return parabolaAxis(4 * distance, axis)
      }
      if (eccentricityNumber === null) return null
      if (name === "椭圆") {
        if (!(eccentricityNumber > 0 && eccentricityNumber < 1)) return null
        const semiMajor = distance / eccentricityNumber
        const semiMinorSquared = semiMajor * semiMajor - distance * distance
        if (!(semiMinorSquared > 0)) return null
        const semiMajorSquared = semiMajor * semiMajor
        return axis === "x" ? ellipseAxes(semiMajorSquared, semiMinorSquared) : ellipseAxes(semiMinorSquared, semiMajorSquared)
      }
      if (!(eccentricityNumber > 1)) return null
      const semiTransverse = distance / eccentricityNumber
      const semiConjugateSquared = distance * distance - semiTransverse * semiTransverse
      if (!(semiConjugateSquared > 0)) return null
      return hyperbolaAxes(semiTransverse * semiTransverse, semiConjugateSquared, axis)
    })()
    if (draft === null) {
      report(eccentricityNumber === null
        ? `只给了焦点坐标：${name}的半轴还差离心率才能定下来，未核验。`
        : `这组焦点与离心率解不出一个${name}（离心率与曲线种类矛盾，或半轴不成实轴），不猜，未核验。`)
      continue
    }
    givens.push({ ...draft, sourceText: window.trim(), start, end })
    /**
     * 把读过的两段标成"已用"：`离心率 e=√5` 里那个 `=` 否则会被残留扫描器当成
     * 一条没读出来的条件，同一句在报告里出现两次。
     */
    for (const span of [focus, eccentricity]) {
      if (span === null) continue
      for (let offset = span.index; offset < span.index + span[0].length; offset += 1) used.add(start + offset)
    }
  }
}

/**
 * **实体的标量尺寸**（2026-10-20，联考「无核验项」审计的 A 类）。
 *
 * 这一族在卷面上就是一句话：`圆锥的底面半径为2，母线长为3`、`圆柱的底面半径为1，高为2`、
 * `圆锥的底面积为π，侧面积为2π`。它们此前**一个义务都产不出来** —— 而且主因不在读取器：
 * `planCompiler.planHasVerifiableFigure` 只认"能让题面点名拿到坐标"的动作，圆锥 / 圆柱
 * 用的是 `solid.create_template`（顶点只有模板编号），因此连解析都没发生。
 *
 * ## 归属：谁先说谁管
 *
 * 度量名（`底面半径` / `母线` / `高` / `底面积` / `侧面积`）自己**不带实体名**，所以归属靠
 * "**前面最近的那个 `圆锥` / `圆柱`**"，而且：① 距离不超过 80 字（跨段落就不再是同一句）；
 * ② 两者之间**不许再出现另一个形状名**（`圆柱和圆锥的底面半径分别为…` 这种今天不硬解）。
 *
 * ## 两条守卫
 *
 * - **只收 `底面半径`，不收裸 `半径`**：`圆锥的侧面展开图是半径为3的半圆` 里的半径属于**展开图**
 *   （扇形），读成圆锥的半径就是替题面改题。裸 `半径` 一律留给未核验。
 * - **展开图 / 内切球 / 外接球 出现在两者之间时也不收**：那些对象有自己的半径与高。
 *
 * ## 为什么这不算"拿模型自报的数给自己盖章"
 *
 * 半径确实是模型填进 `radius` 的那个数，但**母线 / 底面积 / 侧面积不是** —— 它们由 `radius` 与
 * `height` 共同决定。模型随手填个高度，母线就对不上（`joint-01` 的"半径 2、母线 3"要求 `h = √5`）。
 */
const SOLID_SHAPE_TERM = /圆锥|圆柱/g
/** 尺寸的字面量：`2`、`√5`、`2√5`、`π`、`2π`（面积类会带 π，裸 π 也是合法的数）。 */
const SOLID_SIZE_LITERAL = String.raw`(\d+(?:\.\d+)?\s*[π√]\s*\d*(?:\.\d+)?|√\s*\d+(?:\.\d+)?|π|\d+(?:\.\d+)?)`
const SOLID_METRIC_READERS: readonly { metric: NonNullable<DiagramObligation["solid"]>["metric"]; pattern: RegExp }[] = [
  { metric: "radius", pattern: new RegExp(String.raw`底面(?:圆)?的?半径\s*(?:为|是|=)?\s*${SOLID_SIZE_LITERAL}`, "g") },
  { metric: "slantHeight", pattern: new RegExp(String.raw`母线(?:长)?\s*(?:为|是|=)?\s*${SOLID_SIZE_LITERAL}`, "g") },
  /**
   * **`底面积` 与 `底面面积` 都收**（2026-10-20 实测）：联考 `joint-07` 的原文是
   * "正六棱锥的**底面面积**为 6√3"，只写 `底面积` 会整句读不出 —— 而这不是罕见写法，
   * 卷面上两种都在用。
   */
  { metric: "baseArea", pattern: new RegExp(String.raw`底(?:面)?面积\s*(?:为|是|=)?\s*${SOLID_SIZE_LITERAL}`, "g") },
  { metric: "lateralArea", pattern: new RegExp(String.raw`侧(?:面)?面积\s*(?:为|是|=)?\s*${SOLID_SIZE_LITERAL}`, "g") },
  { metric: "lateralEdge", pattern: new RegExp(String.raw`侧棱(?:长)?\s*(?:为|是|=)?\s*${SOLID_SIZE_LITERAL}`, "g") },
  { metric: "basePerimeter", pattern: new RegExp(String.raw`底面周长\s*(?:为|是|=)?\s*${SOLID_SIZE_LITERAL}`, "g") },
  { metric: "height", pattern: new RegExp(String.raw`高\s*(?:为|是|=)\s*${SOLID_SIZE_LITERAL}`, "g") }
]

/** 哪种实体有哪个度量（圆柱没有「半径以外的底面量」，棱锥没有母线 / 半径）。 */
const SOLID_METRICS: Record<NonNullable<DiagramObligation["solid"]>["shape"], ReadonlySet<NonNullable<DiagramObligation["solid"]>["metric"]>> = {
  cone: new Set(["radius", "height", "slantHeight", "baseArea", "lateralArea"]),
  cylinder: new Set(["radius", "height", "slantHeight", "baseArea", "lateralArea"]),
  pyramid: new Set(["height", "baseArea", "basePerimeter", "lateralEdge"])
}

/** 中文数字的底面边数（`正六棱锥` ⇒ 6）。 */
const CHINESE_SIDES: Record<string, number> = { 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }

interface SolidAnchor {
  start: number
  shape: NonNullable<DiagramObligation["solid"]>["shape"]
  /** 正 N 棱锥的 N（题面写出来的那个数）。 */
  sides?: number
}

/** 题面里出现过的实体**形状名**（"谁先说谁管"的锚点）。 */
function solidAnchors(text: string): SolidAnchor[] {
  const anchors: SolidAnchor[] = []
  for (const match of text.matchAll(SOLID_SHAPE_TERM)) anchors.push({ start: match.index, shape: match[0] === "圆锥" ? "cone" : "cylinder" })
  for (const match of text.matchAll(/正\s*([三四五六七八九十]|\d+)\s*棱锥/g)) {
    const sides = CHINESE_SIDES[match[1]!] ?? Number(match[1])
    // 只收**正**棱锥：`solid.create_regular_pyramid` 造的就是这一种，别的棱锥没有可量的正则底。
    if (Number.isFinite(sides) && sides >= 3) anchors.push({ start: match.index, shape: "pyramid", sides })
  }
  return anchors.sort((left, right) => left.start - right.start)
}

/** 这些词出现在形状名与度量名之间时，说的**是另一个对象的半径 / 高**。 */
const NOT_THIS_SOLID_TERM = /展开图|内切球|外接球/

/** 尺寸的数值：`2`、`√5`、`2√5`、`π`、`2π`（面积类会带 π）。 */
function solidSizeValue(raw: string): number | null {
  const compact = raw.replace(/\s+/g, "")
  const pi = /^(\d+(?:\.\d+)?)?π$/.exec(compact)
  if (pi !== null) {
    const coefficient = pi[1] === undefined ? 1 : Number(pi[1])
    return Number.isFinite(coefficient) && coefficient > 0 ? coefficient * Math.PI : null
  }
  return radicalValue(compact)
}

function resolveSolidDimensions(
  givens: DiagramObligation[],
  givenText: string,
  used: Set<number>
): void {
  const anchors = solidAnchors(givenText)
  if (anchors.length === 0) return
  for (const { metric, pattern } of SOLID_METRIC_READERS) {
    for (const match of givenText.matchAll(pattern)) {
      const start = match.index
      if ([...match[0]].some((_, offset) => used.has(start + offset))) continue
      const anchor = [...anchors].reverse().find((entry) => entry.start < start && start - entry.start <= 80)
      if (anchor === undefined) continue
      // 中间又出现了**另一个**形状名 ⇒ 不知道这句说的是哪一个，不猜。
      if (anchors.some((entry) => entry.start > anchor.start && entry.start < start)) continue
      if (!SOLID_METRICS[anchor.shape].has(metric)) continue
      const between = givenText.slice(anchor.start + 2, start)
      /**
       * **正三 / 正四棱锥的「底面边长 + 侧棱长」归解析救援**：那一组数已经把坐标构造出来了
       * （`rescueWithRegularTriangularPyramid` / `rescueWithRegularSquarePyramid`），同一句再发
       * 一条标量义务只会把救援挡掉（救援要求复核 `passed`）。有底面边长时**不重复读**。
       */
      if (anchor.shape === "pyramid" && (anchor.sides === 3 || anchor.sides === 4) && /底面边长/.test(givenText.slice(anchor.start, anchor.start + 120))) continue
      if (NOT_THIS_SOLID_TERM.test(between)) continue
      const value = solidSizeValue(match[1]!)
      if (value === null) continue
      givens.push({ kind: "solidDimension", targets: [], value, solid: { shape: anchor.shape, metric }, sourceText: match[0], start, end: start + match[0].length })
      for (let at = start; at < start + match[0].length; at += 1) used.add(at)
    }
  }
}

/**
 * **把题面写的表达式整理成表达式解析器认得的写法**（V0d）。
 *
 * 教科书里写 `x³ − 3x`，而解析器只认 `x^3-3*x`。这一步只做**纯字形替换**，
 * 不做任何数学变形 —— 因为一旦开始"化简"，判据就不再是"图是不是题面那条曲线"，
 * 而是"我的化简对不对"了。
 *
 * 隐式乘号**只补 `数字×x` 这一种**（`3x` → `3*x`）。不补宽：`log10(x)` 里那个 `0(`
 * 一旦被当成乘法，表达式就悄悄变了意思 —— 宁可让不认识的写法落回"未核验"。
 */
function normalizeStatedExpression(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  const normalized = trimmed
    .replace(/²/g, "^2").replace(/³/g, "^3").replace(/⁴/g, "^4")
    .replace(/[−–—]/g, "-")
    .replace(/[×·⋅]/g, "*")
    .replace(/(\d)\s*x/g, "$1*x")
  return normalized.length === 0 ? null : normalized
}

/**
 * 更具体的模式排在普通等号/垂直之前，避免截取比例式或面-面句式的一部分。
 *
 * **导出而不是私有**：Phase N1 的 IR 要用**同一张表**给"求证段"里的目标句定种类
 *（`求证 OA⊥CD` → `perpendicular`）。让 IR 自己再写一套匹配规则，两份规则必然分叉，
 * 而分叉的症状是"题设认平行、目标认垂直"这种最难查的错。
 */
/**
 * `conicChord` 用的两段模式（Task 14）。
 *
 * 点名那一段**复用内核的字母表**（`POINT_NAME_SOURCE`，含撇与下标），不另抄一份 ——
 * 抄一份的后果在本仓出现过：关系抽取的"点名块"字母表漏了 `′`，`AA′` 被读成退化的 A–A 线段。
 */
const CHORD_NAMES = `(?:${POINT_NAME_SOURCE}(?:\\s*[、,，]\\s*${POINT_NAME_SOURCE})*)`
const CHORD_CLAIM = `(相切[^，,。；;\\n]{0,6}|相交于\\s*(${CHORD_NAMES})\\s*两点|交于\\s*(${CHORD_NAMES})\\s*两点|相交于一点|交于一点|没有交点|无交点)`

/**
 * **直线在先时的桥**（2026-10-20，联考 `joint-21` 的另一半）：
 * `直线 … 与椭圆 … 相交于 A、B`。
 *
 * 此前"直线 + 情形"必须**紧挨着**，所以这种语序整条落进未核验 —— 当时是有意的"不猜"：
 * 中间夹着什么完全不知道，猜"说的就是图上那条曲线"没有依据。现在允许夹一个
 * **必须带曲线名**（椭圆 / 双曲线 / 抛物线 / 圆）的从句：曲线名不在场就不匹配，
 * 所以 `与三角形 ABC 相交` 不会被误读成"与圆锥曲线相交"。
 *
 * 用到它的匹配器要开 `allowOverlap`：从句里那一段方程已经被曲线读取器用掉了。
 */
const LINE_FIRST_BRIDGE = `(?:\\s*(?:与|和)\\s*(?:椭圆|双曲线|抛物线|圆)[^，,。；;]{0,60}?)?`

/**
 * 斜截式里的斜率：`y = kx + m` 的 `k` 可以**整个省略**（`y = x` ⇒ 1），也可以只写一个符号
 *（`y = −x` ⇒ −1）。`Number("")` 是 0 —— 直接用它会把 `y = x` 读成水平线。
 */
function statedSlope(raw: string | undefined): number | null {
  const text = (raw ?? "").replace(/\s+/g, "")
  if (text === "" || text === "+") return 1
  if (text === "-") return -1
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * **直线的一般式** `Ax + By + C = 0` ⇒ 斜截式或竖直线。
 *
 * 卷面上一般式与斜截式一样常见（`直线l：3x+4y+15=0`），而读取器此前只收斜截式与 `x = c`。
 * `B = 0` 时它本来就是竖直线 `x = −C/A`；`A`、`B` 同时为 0 不是直线，返回 `null`。
 * 系数由按字符占位的正则给，这里只做"一般式 → 判据用的那一组数"的换算，不另写一条判据。
 */
function lineFromGeneralForm(a: number, b: number, c: number): DiagramStatedLine | null {
  if (![a, b, c].every(Number.isFinite) || (a === 0 && b === 0)) return null
  if (b === 0) return { kind: "vertical", x: -c / a }
  return { kind: "slope", slope: -a / b, intercept: -c / b }
}

/** 题面里的减号有三种字形（ASCII `-`、U+2212 `−`、en dash `–`）—— 一般式里都会出现。 */
function isMinus(sign: string | undefined): boolean {
  return sign === "-" || sign === "−" || sign === "–"
}

/**
 * `functionLineIntersections` 用的"有几个交点"那一段（Task 15 边界，2026-10-14）。
 *
 * 个数**中文与阿拉伯数字都收**（卷面与前缀两种写法都常见：`有三个交点` / `恰有 2 个交点`），
 * 前缀（恰有 / 共有 / 有）可有可无。**它必须是最后一个捕获组** ——
 * 三条线形模式的 `read` 按固定下标取这个数。
 */
const INTERSECTION_COUNT_CLAIM = `(?:恰有|共有|有)?\\s*([一二三四五六七八九十两\\d]+)\\s*个(?:不同的)?交点`

/** 中文数字与前缀写法都收的**交点个数**；认不出来返回 `null`（那一条不当作义务）。 */
function statedIntersectionCount(raw: string): number | null {
  const value = Number(raw)
  if (Number.isInteger(value) && value > 0) return value
  const chinese: Record<string, number> = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  return chinese[raw] ?? null
}

/** 把「直线 + 个数」两段读成一条 `functionLineIntersections` 义务；个数认不出来就返回 `null`。 */
function intersectionCountDraft(line: DiagramStatedLine, rawCount: string): Pick<DiagramObligation, "kind" | "targets" | "line" | "value"> | null {
  const count = statedIntersectionCount(rawCount)
  return count === null ? null : { kind: "functionLineIntersections", targets: [], line, value: count }
}

/** 把「直线 + 情形」两段读成一条 `conicChord` 义务；情形认不出来就返回 `null`（那条直线不当作义务）。 */
function chordDraft(
  line: DiagramStatedLine,
  claim: string,
  names: string | undefined
): Pick<DiagramObligation, "kind" | "targets" | "line" | "expectation"> | null {
  const targets = names === undefined ? [] : [...names.matchAll(new RegExp(POINT_NAME_SOURCE, "g"))].map((entry) => entry[0])
  if (names !== undefined && targets.length === 0) return null
  const expectation: NonNullable<DiagramObligation["expectation"]> = claim.includes("相切")
    ? "tangent"
    : claim.includes("两点")
      ? "secant"
      : claim.includes("一点")
        ? "single"
        : "none"
  return { kind: "conicChord", targets, line, expectation }
}

export const DIAGRAM_OBLIGATION_MATCHERS: readonly Matcher[] = [
  /**
   * **椭圆的方程**：`x²/9 + y²/4 = 1`（`x^2` 那种写法也收）。
   *
   * 为什么必须认它、而不是留给"未核验"：方程里带 `=`，而下面的残留扫描把**带 `=` 的整句**
   * 一律标成未核验 —— 不认它，用户每次都会看到一句"尚未被可靠解析"。认了它，判据才有东西可量。
   *
   * 两条分开写、而不是一条带分支：`x²/a² + y²/b² = 1` 与 `y²/b² + x²/a² = 1` 说的是**同一条曲线**，
   * 但半轴分别落在哪个轴上不同。合成一条会让"读哪一组"变成第二个判断。
   */
  {
    pattern: /x\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*\+\s*y\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*=\s*1/g,
    allowAfterLabelColon: true,
    read: (m) => ellipseAxes(Number(m[1]), Number(m[2]))
  },
  {
    pattern: /y\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*\+\s*x\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*=\s*1/g,
    allowAfterLabelColon: true,
    read: (m) => ellipseAxes(Number(m[2]), Number(m[1]))
  },
  /**
   * **双曲线**：`x²/9 − y²/4 = 1`（减号与 y 在前的写法都收）。
   *
   * 与椭圆分开写、而不是把它并进一个"±"的通配里：那样"读到的到底是椭圆还是双曲线"
   * 会变成登记之外的第二个判断，而这两条曲线的判据**本来就不一样**（双曲线要额外比轴）。
   */
  {
    pattern: /x\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*[-−–]\s*y\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*=\s*1/g,
    allowAfterLabelColon: true,
    read: (m) => hyperbolaAxes(Number(m[1]), Number(m[2]), "x")
  },
  {
    pattern: /y\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*[-−–]\s*x\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)\s*=\s*1/g,
    allowAfterLabelColon: true,
    read: (m) => hyperbolaAxes(Number(m[2]), Number(m[1]), "y")
  },
  /**
   * **抛物线**：`y² = 4x`（对称轴 x）与 `x² = 4y`（对称轴 y）。
   *
   * 系数是 `2p`，不是 `p` —— 见 `parabolaAxis` 的注释。
   */
  {
    pattern: /y\s*(?:\^2|²)\s*=\s*(-?\d+(?:\.\d+)?)\s*x(?![a-zA-Z])/g,
    allowAfterLabelColon: true,
    read: (m) => parabolaAxis(Number(m[1]), "x")
  },
  {
    pattern: /x\s*(?:\^2|²)\s*=\s*(-?\d+(?:\.\d+)?)\s*y(?![a-zA-Z])/g,
    allowAfterLabelColon: true,
    read: (m) => parabolaAxis(Number(m[1]), "y")
  },
  /**
   * **函数式写法的抛物线**：`y = x²/4` 与 `y = 2x²`（2026-10-19 联考 `joint-28` 那一类）。
   *
   * 标准式是 `x² = 2py`，题面常把 y 解出来写成 `y = kx²` 或 `y = x²/k`：
   * - `y = x²/4` ⇔ `x² = 4y` ⇒ `2p = 4` ⇒ `p = 2`；
   * - `y = 2x²` ⇔ `x² = y/2` ⇒ `2p = 0.5` ⇒ `p = 0.25`。
   *
   * **只收顶点在原点、对称轴是坐标轴的那一类**：`y = x²/4 + 1` / `− 1` 是被平移过的，
   * 焦点与准线都变了 —— 按标准式核验会得到一条错的判据，所以那两种写法一律不认
   *（尾部 `(?!\s*[-+−])` 就是干这个的），留给未核验。
   */
  {
    pattern: /y\s*=\s*x\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)(?!\s*[-+−])(?![\dxX])/g,
    allowAfterLabelColon: true,
    read: (m) => parabolaAxis(Number(m[1]), "y")
  },
  {
    pattern: /y\s*=\s*(\d+(?:\.\d+)?)\s*\*?\s*x\s*(?:\^2|²)(?!\s*[-+−])(?![\dxX])/g,
    allowAfterLabelColon: true,
    read: (m) => parabolaAxis(1 / Number(m[1]), "y")
  },
  {
    pattern: /x\s*=\s*y\s*(?:\^2|²)\s*\/\s*(\d+(?:\.\d+)?)(?!\s*[-+−])(?![\dxY])/g,
    allowAfterLabelColon: true,
    read: (m) => parabolaAxis(Number(m[1]), "x")
  },
  {
    pattern: /x\s*=\s*(\d+(?:\.\d+)?)\s*\*?\s*y\s*(?:\^2|²)(?!\s*[-+−])(?![\dxY])/g,
    allowAfterLabelColon: true,
    read: (m) => parabolaAxis(1 / Number(m[1]), "x")
  },
  /**
   * **圆的一般方程**：`圆M：x²+y²−4x+2y−4=0`（2026-10-19 联考 `joint-27`）。
   *
   * 与"三类标准圆锥曲线"分开，是因为它多一维**圆心**（那三档都以原点为中心）。
   * 右端写成 `=4` 也收（`x²+y²=4` 就是半径 2 的圆），常数项按 `多出来的数` 扣掉。
   */
  {
    pattern: /x\s*(?:\^2|²)\s*\+\s*y\s*(?:\^2|²)\s*([^=]*)=\s*(-?\d+(?:\.\d+)?)(?![\d.])/g,
    allowAfterLabelColon: true,
    read: (m) => circleFromGeneralEquation(m[1] ?? "", Number(m[2]))
  },
  {
    /**
     * **曲线过点**（2026-10-19 联考 `joint-30`：`双曲线过点 A、B`）。
     *
     * 这不是曲线**方程**的写法，而是一条**条件**：那几个点必须落在这条曲线上。判据层
     * 已经有"点到圆锥曲线的残差"（`pointOnConic`，内核 `conicResidualAt`），所以这里只需要
     * 一个读取器，**不为它新造判据**。
     *
     * 一条义务对一个点：`pointOnConic` 的判据只处理 `targets[0]`（读一半比读不出更坏），
     * 所以两个点名就产出两条义务 —— 哪一点不在曲线上，报告里就红哪一条。
     *
     * **不收**"过点 A 作直线"：那句的主语是直线，不是曲线。正则要求**曲线名在前**，
     * 所以没有主语的祈使句不会被误读成"曲线过点"。
     */
    pattern: new RegExp(`(椭圆|双曲线|抛物线|圆)\\s*(?:[A-Z]\\s*)?(?:[^，。；,;]{0,40}?[=＝][^，。；,;]{0,12}?)?(?:经过|过)\\s*(?:点\\s*)?(${POINT_NAME})(?:\\s*[、,，和与]\\s*(?:点\\s*)?(${POINT_NAME}))?`, "g"),
    allowOverlap: true,
    read: (m) => {
      const first = names(m[2] ?? "")
      const second = m[3] === undefined ? [] : names(m[3])
      if (first.length !== 1 || second.length > 1) return null
      const kind: "ellipse" | "hyperbola" | "parabola" | "circle" =
        m[1] === "椭圆" ? "ellipse" : m[1] === "双曲线" ? "hyperbola" : m[1] === "抛物线" ? "parabola" : "circle"
      return [...first, ...second].map((name) => ({ kind: "pointOnConic" as const, targets: [name], conicKind: kind }))
    }
  },
  {
    /**
     * **点在圆锥曲线上**（施工单①，2026-10-15）：`P 是椭圆上任意一点` / `P 在双曲线上` / `M 为椭圆上一点`。
     *
     * ## 为什么它必须是一条**读取器**，而不是"再往触发词表里加个词"
     *
     * 加词只能让这句落进"未核验"（用户看得见，但没人判）；而它是一条**读得懂、也量得动**的
     * 条件：点在不在曲线上，内核有现成的残差判据（`conicResidualAt`，复用 `conic-line.ts`
     * 那套局部隐式形式，**不另写一份方程**）。读成真义务之后，"图上那个 P 到底在不在椭圆上"
     * 才第一次有人问 —— 此前把 P 画在椭圆里面，报告照样全绿。
     *
     * ## 三种说法、三类曲线
     *
     * `是 / 为 / 在` 三种系词都收（卷面上都常见，与"弦 AB 的长为 n"那条同一族的连接词），
     * 曲线只收**点名的三种**：`椭圆 / 双曲线 / 抛物线` —— 写"圆锥曲线"时**读不出来**
     *（"是哪一条"没有答案，而判据要拿它问"图上那条曲线是不是题面说的那一种"，猜不得）。
     *
     * ## 刻意**不**收的：`P 是椭圆外一点`
     *
     * "在外面"与"在曲线上"是**相反**的两件事，读成这条就是替题面改题。它由残留扫描器接住
     *（触发词表里有 `椭圆外` 这一类）⇒ 落"未核验"，不静默消失。
     *
     * ## 尾部只收**封闭的几种说法**
     *
     * `任意一点 / 任意点 / 一点 / 的点 / 动点` 五种尾巴里的一种，**不做"往后吃几个字"**：
     * 那样会把后面紧挨着的真条件（`P 是椭圆上一点且AB=2`）一起吞进 `sourceText`，
     * 而按字符占位的去重会让被吞掉的那条**再也不被扫描**——那正是"静默丢掉一条题设"。
     * 尾巴必须收进来的理由只有一个：`sourceText` 是面板上给用户看的那句话，
     * 而"任意"两个字正是"这只是一次实例核验"的**唯一线索**（判据文案会指着它披露）。
     */
    pattern: new RegExp(`(${POINT_NAME})\\s*(?:是|为|在)\\s*(椭圆|双曲线|抛物线)\\s*上(?:\\s*(?:任意|任取)\\s*一点|\\s*任意点|\\s*一点|\\s*的点|\\s*动点)?`, "g"),
    read: (m) => {
      const targets = names(m[1])
      // 恰好一个点名：`PA 是椭圆上…` 那种连写读不出（读一半比读不出更坏）。
      if (targets.length !== 1) return null
      return { kind: "pointOnConic", targets, conicKind: m[2] === "椭圆" ? "ellipse" : m[2] === "双曲线" ? "hyperbola" : "parabola" }
    }
  },
  {
    /**
     * **点在一条线段上**（2026-10-15 用户现场，Rt△ABC 折起那道题）：`D 为 AC 上一点`。
     *
     * 它与上面那条 `pointOnConic`（`P 是椭圆上一点`）**只差一个字**：`上` 后面是**两个点名**
     * （一条线段）而不是曲线名。此前它**只有触发词、没有判据** ⇒ 落"未核验"，用户看到的是
     * "今天还没有判据"。而这条条件是**读得懂、也量得动**的：① 与这条直线共线、
     * ② 落在线段内（参数 `t ∈ [0,1]`）—— 于是"D 到底在不在 AC 上"第一次有人问。
     *
     * ## 三种系词、一条尾巴纪律
     *
     * `是 / 为 / 在` 都收（与 `pointOnConic` 同一族的连接词）。尾巴**只收封闭的几种说法**
     * （`一点 / 的点 / 任意一点 / 的一点 / 动点`），**不往后吃字**：那样会把紧挨着的真条件
     * 一起吞进 `sourceText`，而按字符占位的去重会让被吞掉的那条**再也不被扫描**。
     *
     * **光写"在 AC 上"不收**：那既可能是线段、也可能是直线，猜不得（残留扫描器照旧接住它，
     * 而且它的理由里会明说"没点名到位"）。
     *
     * **`AC 上一点 E`（点写在线段后面）2026-10-20 起也能读了** —— 见下面那条读取器。
     */
    pattern: new RegExp(`(${POINT_NAME})\\s*(?:是|为|在)\\s*(${SEGMENT_NAME})\\s*上\\s*(?:任意一点|的一点|一点|的点|动点)`, "g"),
    read: (m) => {
      const point = names(m[1])
      const segment = names(m[2])
      // 恰好"一个点 + 一条线段"才收（读一半比读不出更坏）。
      if (point.length !== 1 || segment.length !== 2) return null
      return { kind: "pointOnSegment", targets: [...point, ...segment] }
    }
  },
  {
    /**
     * **点写在线段后面**（2026-10-20）：`AC 上一点 D` / `在线段 AC 上取一点 D` / `在 AC 上取点 D`。
     *
     * 判据早就有（`pointOnSegment`），缺的一直是**语序**：上面那条要求"点 + 是/为/在 + 线段 + 上 + 尾巴"，
     * 点写在线段**后面**的写法只能落未核验（这一族在卷面上很常见）。补它比新造判据便宜得多 ——
     * `targets` 的约定完全一样（点在先、线段两端在后）。
     *
     * **三条守卫，一条都不能少**（读成 `pointOnSegment` 就是为一句题面里没有的条件报"不满足"）：
     * - `直线 AC 上一点 D`：说的是**整条直线**，D 可以在延长线上；
     * - `射线 AC 上一点 D`：同理；
     * - `AC 的延长线上一点 D`：明说了在延长线上（这条靠"线段后面必须紧跟 `上`"自然挡住）。
     *
     * 守卫用**定宽后顾**写在段名之前：`直线` / `射线`（各带一个可选的空格）恰好都是 2~3 个字，
     * 所以不需要把前缀吃进匹配范围（吃进匹配范围会把前一个字符也标成"已用"）。
     */
    pattern: new RegExp(`(?:在\\s*)?(?:线段\\s*)?(?<!直线)(?<!直线\\s)(?<!射线)(?<!射线\\s)(${SEGMENT_NAME})\\s*上\\s*(?:任取|取|作)?\\s*(?:任意一点|的一点|一点|的点|动点|点)\\s*(${POINT_NAME})`, "g"),
    read: (m) => {
      const segment = names(m[1])
      const point = names(m[2])
      if (point.length !== 1 || segment.length !== 2) return null
      return { kind: "pointOnSegment", targets: [...point, ...segment] }
    }
  },
  {
    /**
     * **`点 E 在棱 AB 上`**（2026-10-20 立体系探针）。
     *
     * 与上一条的差别只有一个词：这里的「棱 / 边」**已经排除了"直线"的歧义** ——
     * 棱是线段，所以这一句**不必**靠"一点"那截尾巴也能读。没有量词的 `E 在 AB 上`
     * 仍然交给未核验（那可能是线段、也可能是直线，猜不得）。
     *
     * **「线段」也算同一个量词**（2026-10-20 续）：`点 D 在线段 AC 上` 与 `点 E 在棱 AB 上`
     * 是同一件事 —— 量词已经把"直线"排除了，所以不需要再靠尾巴消歧。
     */
    pattern: new RegExp(`(?:点\\s*)?(${POINT_NAME})\\s*(?:在|是|为)\\s*(?:棱|边|线段)\\s*(${SEGMENT_NAME})\\s*上`, "g"),
    read: (m) => {
      const point = names(m[1])
      const segment = names(m[2])
      if (point.length !== 1 || segment.length !== 2) return null
      return { kind: "pointOnSegment", targets: [...point, ...segment] }
    }
  },
  /**
   * **直线与圆锥曲线的交点**（Task 14）：`…与直线 y = x + 1 相交于 A、B 两点` / `…与直线 x = 3 相切`。
   *
   * 两条讲究：
   *
   * 1. **匹配范围只到"直线 + 情形"那一段，绝不把曲线方程圈进来**。解析器是按**字符占位**去重的
   *   （`used`），把方程也圈进来的话，曲线自己那条义务（`conicAxes`，比半轴/轴的那条）会被整条吃掉。
   *    所以支持的题面写法是**曲线在前、直线在后**：`椭圆 x²/9+y²/4=1 与直线 y=x 相交于 A、B 两点`。
   *    直线写在前面时这一条认不出来，会照旧落进"未核验"的残留里（**不猜**）。
   * 2. **竖直线（`x = c`）与水平线（`y = m`）各自一条模式**：斜截式那一条表达不了它们，
   *    而"竖直切线"在真题里是常态（双曲线顶点处的切线就是竖直的）。
   *
   * 它记的是**代数重数**那一套档位（`secant` / `tangent` / `single` / `none`），
   * 与内核 `intersectLineWithConic` 的返回同名 —— 判据才有东西可对。
   */
  {
    pattern: new RegExp(`直线\\s*y\\s*=\\s*([+-]?\\s*\\d*(?:\\.\\d+)?)\\s*\\*?\\s*x\\s*(?:([+-])\\s*(\\d+(?:\\.\\d+)?))?${LINE_FIRST_BRIDGE}\\s*${CHORD_CLAIM}`, "g"),
    allowOverlap: true,
    read: (m) => {
      const slope = statedSlope(m[1])
      if (slope === null) return null
      const intercept = m[3] === undefined ? 0 : Number(m[3]) * (m[2] === "-" ? -1 : 1)
      return chordDraft({ kind: "slope", slope, intercept }, m[4] ?? "", m[5] ?? m[6])
    }
  },
  {
    // 水平线：数字后面**不能**再跟 `x`（否则 `y = 2x + 1` 会被读成 `y = 2`）。
    pattern: new RegExp(`直线\\s*y\\s*=\\s*([+-]?\\d+(?:\\.\\d+)?)(?!\\s*\\*?\\s*x)${LINE_FIRST_BRIDGE}\\s*${CHORD_CLAIM}`, "g"),
    allowOverlap: true,
    read: (m) => {
      const intercept = Number(m[1])
      if (!Number.isFinite(intercept)) return null
      return chordDraft({ kind: "slope", slope: 0, intercept }, m[2] ?? "", m[3] ?? m[4])
    }
  },
  {
    pattern: new RegExp(`直线\\s*x\\s*=\\s*([+-]?\\d+(?:\\.\\d+)?)${LINE_FIRST_BRIDGE}\\s*${CHORD_CLAIM}`, "g"),
    allowOverlap: true,
    read: (m) => {
      const x = Number(m[1])
      if (!Number.isFinite(x)) return null
      return chordDraft({ kind: "vertical", x }, m[2] ?? "", m[3] ?? m[4])
    }
  },
  {
    /**
     * **直线的一般式**（2026-10-19 联考 `joint-21`：`直线l：3x+4y+15=0`）。
     *
     * 只收 `= 0` 这一种写法：`3x+4y+15=1` 当然是另一条直线，但它不是一般式的形态，
     * 读取器**不替题面移项**（移错一项就是另一条线，而模型只有一次修复机会）。
     * 标签（`直线l：` / `直线 L:`）可有可无。
     */
    pattern: new RegExp(`直线\\s*(?:[a-z]\\s*[:：]\\s*)?([-−–+]?)\\s*(\\d+(?:\\.\\d+)?)?\\s*\\*?\\s*x\\s*([-−–+])\\s*(\\d+(?:\\.\\d+)?)?\\s*\\*?\\s*y\\s*(?:([-−–+])\\s*(\\d+(?:\\.\\d+)?))?\\s*=\\s*0${LINE_FIRST_BRIDGE}\\s*${CHORD_CLAIM}`, "g"),
    allowOverlap: true,
    read: (m) => {
      const a = (isMinus(m[1]) ? -1 : 1) * (m[2] === undefined ? 1 : Number(m[2]))
      const b = (isMinus(m[3]) ? -1 : 1) * (m[4] === undefined ? 1 : Number(m[4]))
      const c = m[5] === undefined ? 0 : (isMinus(m[5]) ? -1 : 1) * Number(m[6])
      const line = lineFromGeneralForm(a, b, c)
      return line === null ? null : chordDraft(line, m[7] ?? "", m[8] ?? m[9])
    }
  },
  /**
   * **两条函数的公切线**：`f(x)=x² 与 g(x)=−(x−2)²+1 的两条公切线`。
   *
   * 必须先消费整段两个函数定义，再让普通 `functionGraph` matcher 处理单条函数；
   * 否则第二条表达式会变成未核验残留，题面数量也会丢失。
   */
  {
    pattern: /[fgh]\s*\(\s*x\s*\)\s*=\s*([^，,。；;\u4e00-\u9fff]+?)\s*(?:与|和)\s*[fgh]\s*\(\s*x\s*\)\s*=\s*([^，,。；;\u4e00-\u9fff]+?)\s*(?:的)?\s*(?:([一二三四五六七八九十两\d]+)\s*条)?公切线/g,
    read: (m) => {
      const first = normalizeStatedExpression(m[1])
      const second = normalizeStatedExpression(m[2])
      if (first === null || second === null) return null
      const count = m[3] === undefined ? 1 : statedIntersectionCount(m[3])
      return count !== null && Number.isInteger(count) && count > 0
        ? { kind: "commonTangent", targets: [], expressions: [first, second], value: count }
        : null
    }
  },
  /**
   * **在某点处的切线**：`在 x=1 处的切线`。
   *
   * 这条 obligation 只记**横坐标**，斜率一个字都不记 —— 因为它不由题面给出，而由函数决定。
   * 判据也不读图元里存的那个 `slope`（那是内核自己填的，拿它当判据就是拿系统自证），
   * 而是由核验器**自己对该函数数值求导**再比。详见 `diagramVerification` 的 `tangentAt` 分支。
   */
  {
    pattern: /x\s*=\s*(-?\d+(?:\.\d+)?)\s*处[^，,。；;\n]{0,4}的?切线/g,
    read: (m) => {
      const x = Number(m[1])
      return Number.isFinite(x) ? { kind: "tangentAt", targets: [], value: x } : null
    }
  },
  /**
   * **函数定义**：`f(x)=x³−3x`。
   *
   * 为什么必须认它，而不是留给"未核验"：题面里这一句带 `=`，而残留扫描把**带 `=` 的整句**
   * 一律标成未核验 —— 不认它，用户每次都会看到一句"尚未被可靠解析"，
   * 而他真正想知道的是"画出来的曲线是不是这条函数"。
   *
   * 捕获到的是**非中文、非标点**的一段，再交给 `normalizeStatedExpression` 整理字形。
   * 这样 `f(x) = x^3 - 3x`（带空格）与 `f(x)=x³−3x`（上标紧凑）都能收。
   */
  {
    // 末位要求"非空白**且非中文**"：`\S` 不够 —— 中文的"的"也不是空白，会被它吃掉。
    // 否则 `match[0]`（也就是报告里的 `sourceText`）会变成 `f(x)=x³−3x 的`，
    // 而题面引文多一个字，用户在报告里看不出来，只会让断言莫名其妙地失败。
    pattern: /f\s*\(\s*x\s*\)\s*=\s*([^，,。；;\u4e00-\u9fff]*[^，,。；;\u4e00-\u9fff\s])/g,
    read: (m) => {
      const expression = normalizeStatedExpression(m[1])
      return expression === null ? null : { kind: "functionGraph", targets: [], expression }
    }
  },  {
    pattern: /△?\s*([A-Z])([A-Z])([A-Z])\s*(?:是|为)\s*锐角三角形/g,
    read: (m) => ({ kind: "acuteTriangle", targets: names(`${m[1]}${m[2]}${m[3]}`) })
  },
  {
    pattern: /△?\s*([A-Z])([A-Z])([A-Z])\s*(?:是|为)\s*直角三角形/g,
    read: (m) => ({ kind: "rightTriangle", targets: names(`${m[1]}${m[2]}${m[3]}`) })
  },
  {
    pattern: /△?\s*([A-Z])([A-Z])([A-Z])\s*(?:是|为)\s*钝角三角形/g,
    read: (m) => ({ kind: "obtuseTriangle", targets: names(`${m[1]}${m[2]}${m[3]}`) })
  },
  {
    pattern: /点?\s*([A-Z])\s*在\s*△?\s*([A-Z])([A-Z])([A-Z])\s*(?:内部|内)/g,
    read: (m) => ({ kind: "pointInsideTriangle", targets: [m[1]!, m[2]!, m[3]!, m[4]!] })
  },
  {
    /**
     * **角平分线**（2026-10-20，探针里"没有判据的家族"中常见的一族）。
     *
     * 三种写法共用的约定：`targets = [点, 顶点, 一边端点, 另一边端点]`（与 `midpoint` /
     * `pointOnSegment` 一样"被约束的对象在先"）。判据见 `diagramVerification` 的
     * `angleBisector` 分支：**两个角相等**且**点在角内部**。
     *
     * 只收**带角名**的写法：`AD 是角平分线` 没说哪个角，`D` 可能在任何一条平分线上 ⇒ 不猜
     *（残留扫描器照旧接住它，理由里点名"角平分线"）。
     *
     * `AD 是 ∠BAC 的平分线`：线段 AD 的**首字母必须是角的顶点**（`A`），否则它说的就不是
     * 同一个角 —— 那是另一件事，读一半比读不出更坏。
     */
    pattern: /([A-Z])([A-Z])\s*(?:是|为)\s*∠\s*([A-Z])([A-Z])([A-Z])\s*的?\s*(?:角)?平分线/g,
    read: (m) => (m[1] !== m[4] ? null : { kind: "angleBisector", targets: [m[2]!, m[4]!, m[3]!, m[5]!] })
  },
  {
    /** `AD 平分 ∠BAC`（与上一条同一个判据，只是词序不同）。 */
    pattern: /([A-Z])([A-Z])\s*平分\s*∠\s*([A-Z])([A-Z])([A-Z])/g,
    read: (m) => (m[1] !== m[4] ? null : { kind: "angleBisector", targets: [m[2]!, m[4]!, m[3]!, m[5]!] })
  },
  {
    /** `∠BAC 的平分线交 BC 于点 D`（点写在后面）：同一条义务。 */
    pattern: /∠\s*([A-Z])([A-Z])([A-Z])\s*的\s*(?:角)?平分线\s*交\s*([A-Z])([A-Z])\s*于点\s*([A-Z])/g,
    read: (m) => ({ kind: "angleBisector", targets: [m[6]!, m[2]!, m[1]!, m[3]!] })
  },
  {
    pattern: /(\d+(?:\.\d+)?)\s*([A-Z]{2})\s*[·*]\s*([A-Z]{2})\s*=\s*\|([A-Z]{2})\|²/g,
    read: (m) => {
      const scalar = finitePositive(m[1])
      if (scalar === null) return null
      return { kind: "vectorDot", targets: [...names(m[2]), ...names(m[3]), ...names(m[4])], value: scalar }
    }
  },
  {
    pattern: /二面角\s*([A-Z])\s*[-−]\s*([A-Z])([A-Z])\s*[-−]\s*([A-Z])\s*(?:=|[为為])\s*(\d+(?:\.\d+)?)\s*°/g,
    read: (m) => { const value = finitePositive(m[5]); return value === null || value >= 180 ? null : { kind: "dihedral", targets: m.slice(1, 5), value } }
  },
  {
    /**
     * **平面上的数值角**：`∠ABC=60°`（§3-F）。
     *
     * 三点名必须**互异**（`∠ABA` 不是角）；度数按度收，`0` 与 `≥180` **读不出来** ⇒ 落 `unverified`
     * （"认不出就如实说未核验"这条纪律不因为多认了一种写法而松动 —— 句法对、几何退化的那些，
     * 由核验器与构造器各自拒绝）。
     *
     * **它必须排在 `UNREAD_CONDITION` 能够到它之前**（读取器表本来就在前面按序试），
     * 否则这句会同时进 `givens` 与 `unverified` 两处。
     */
    pattern: /∠\s*([A-Z][A-Z0-9′'₁₂₃₄₅₆₇₈₉]*)\s*([A-Z][A-Z0-9′'₁₂₃₄₅₆₇₈₉]*)\s*([A-Z][A-Z0-9′'₁₂₃₄₅₆₇₈₉]*)\s*=\s*(\d+(?:\.\d+)?)\s*°/g,
    read: (m) => {
      const value = finitePositive(m[4])
      if (value === null || value >= 180) return null
      const targets = [m[1], m[2], m[3]]
      if (new Set(targets).size !== 3) return null
      return { kind: "planarAngle", targets, value }
    }
  },
  {
    /**
     * **单字母角**（Task 11 的边界「`∠A` 单字母角不认」，2026-10-14）：`∠A=60°`。
     *
     * 它必须排在**三个点名那条之后**：`∠ABC=60°` 里 `∠A` 后面跟的是 `B` 而不是 `=`，
     * 所以三条读取器不会互相半吃 —— 但顺序仍然固定，免得以后有人把这条挪到前面。
     *
     * 顶点用**一个点名**记下来，两条边由 `resolveStatedVertexAngle` 在整句解析完之后
     * 按**形状从句的环**取邻点（环的解析只有 `parseShapeClause` 一处，不另写一套）。
     */
    pattern: /∠\s*([A-Z])\s*=\s*(\d+(?:\.\d+)?)\s*°/g,
    read: (m) => {
      const value = finitePositive(m[2])
      // 与三点名那条同一把尺子：`0°` 不是角、`≥180°` 不是内角。
      if (value === null || value >= 180) return null
      return { kind: "planarAngle", targets: [m[1], STATED_VERTEX_ANGLE], value }
    }
  },
  {
    /**
     * **线面角**（Task 13 边界，2026-10-14）：`AA′与底面所成角为45°` / `AA′与平面ABC所成角为60°`。
     *
     * 两种写法都收：**平面点名**直接写出来的（`平面ABC`），以及只写"**底面**"的 ——
     * 后者的底环由**形状从句**给出，而形状从句的解析只有一处（`parseShapeClause`），
     * 所以这一条先原样留下"底面"这个占位，由 `resolveStatedBasePlane` 在整句解析完**之后**
     * 落成具体点名（认不出底环就如实落未核验，**不猜一个平面**）。
     *
     * 范围是 **(0°, 90°)**：`0°` 不是角（`finitePositive` 已经挡掉），`90°` 是"侧棱躺进底面"。
     */
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*与\\s*(?:平面\\s*)?(${PLANE_NAME}|底面)\\s*所成(?:的)?角\\s*(?:为|=|是)\\s*(\\d+(?:\\.\\d+)?)\\s*°`, "g"),
    read: (m) => {
      const value = finitePositive(m[3])
      if (value === null || value >= 90) return null
      const line = names(m[1])
      if (line.length !== 2) return null
      const stated = m[2]
      if (stated === "底面") return { kind: "linePlaneAngle", targets: [...line, STATED_BASE], value, planeLengths: [2, 1] }
      const plane = names(stated)
      if (plane.length < 3 || new Set(plane).size !== plane.length) return null
      return { kind: "linePlaneAngle", targets: [...line, ...plane], value, planeLengths: [2, plane.length] }
    }
  },
  /**
   * **函数与直线的交点个数**（Task 15 边界）：三条读取器与圆锥曲线那一族**同一套线形写法**
   *（斜截式 / 水平线 / 竖直线，连"水平线后面不许再跟 `x`"那条守卫都一样），差别只在
   * 末端收的是"有几个交点"而不是"相交于 A、B"。
   *
   * ## 为什么"个数"写在**前瞻**里，而不是吃掉中间那段
   *
   * 题面里那段曲线描述带着 `f(x)=…`，而它**已经**被函数定义那条读取器按字符占位收走了
   *（解析器按字符去重：任何重叠都会让后一条读取器整条跳过）。所以这三条只**占用**
   *「直线 …」那一段，个数用一个有界前瞻（`{0,30}?`，不跨标点）去看 ——
   * 两边都不抢对方的地盘。曲线写在前面、直线写在前面，两种语序都收。
   *
   * 数字后面那句 `(?![eE][+-]?\d)` 是**防半读**：`y = 1e-12` 若被读成 `y = 1`，
   * 得到的是一个**看着成立、其实换了条件**的义务 —— 宁可读不出（落未核验）。
   */
  {
    pattern: new RegExp(`直线\\s*y\\s*=\\s*([+-]?\\s*\\d*(?:\\.\\d+)?)(?![eE][+-]?\\d)\\s*\\*?\\s*x\\s*(?:([+-])\\s*(\\d+(?:\\.\\d+)?)(?![eE][+-]?\\d))?(?=[^，,。；;]{0,30}?${INTERSECTION_COUNT_CLAIM})`, "g"),
    read: (m) => {
      const slope = statedSlope(m[1])
      if (slope === null) return null
      const intercept = m[3] === undefined ? 0 : Number(m[3]) * (m[2] === "-" ? -1 : 1)
      return intersectionCountDraft({ kind: "slope", slope, intercept }, m[4] ?? "")
    }
  },
  {
    pattern: new RegExp(`直线\\s*y\\s*=\\s*([+-]?\\d+(?:\\.\\d+)?)(?![eE][+-]?\\d)(?!\\s*\\*?\\s*x)(?=[^，,。；;]{0,30}?${INTERSECTION_COUNT_CLAIM})`, "g"),
    read: (m) => {
      const intercept = Number(m[1])
      if (!Number.isFinite(intercept)) return null
      return intersectionCountDraft({ kind: "slope", slope: 0, intercept }, m[2] ?? "")
    }
  },
  {
    pattern: new RegExp(`直线\\s*x\\s*=\\s*([+-]?\\d+(?:\\.\\d+)?)(?![eE][+-]?\\d)(?=[^，,。；;]{0,30}?${INTERSECTION_COUNT_CLAIM})`, "g"),
    read: (m) => {
      const x = Number(m[1])
      if (!Number.isFinite(x)) return null
      return intersectionCountDraft({ kind: "vertical", x }, m[2] ?? "")
    }
  },
  {
    /**
     * **直线一般式**（与 `conicChord` 那一支同一个换算：`lineFromGeneralForm`）。
     * 交点个数这一支此前只认斜截式与竖直线，`2x−y+1=0` 会整条丢掉。
     */
    pattern: new RegExp(`直线\\s*(?:[a-z]\\s*[:：]\\s*)?([-−–+]?)\\s*(\\d+(?:\\.\\d+)?)?\\s*\\*?\\s*x\\s*([-−–+])\\s*(\\d+(?:\\.\\d+)?)?\\s*\\*?\\s*y\\s*(?:([-−–+])\\s*(\\d+(?:\\.\\d+)?))?\\s*=\\s*0(?=[^，,。；;]{0,30}?${INTERSECTION_COUNT_CLAIM})`, "g"),
    read: (m) => {
      const a = (isMinus(m[1]) ? -1 : 1) * (m[2] === undefined ? 1 : Number(m[2]))
      const b = (isMinus(m[3]) ? -1 : 1) * (m[4] === undefined ? 1 : Number(m[4]))
      const c = m[5] === undefined ? 0 : (isMinus(m[5]) ? -1 : 1) * Number(m[6])
      const line = lineFromGeneralForm(a, b, c)
      return line === null ? null : intersectionCountDraft(line, m[7] ?? "")
    }
  },
  {
    /**
     * **`侧面 AA₁B₁B 为正方形`**（2026-10-15 用户现场，直三棱柱那道题）。
     *
     * 现场：这句**读得出、验不了**（`relation_not_checkable`），于是整轮停在"题设还没核验，
     * 本次不会提交" —— 图其实已经建好了。根因是没有任何读取器认"…为正方形"，
     * 它被"面 XX"那条通用模式吞掉，落成一个核验不了的关系。
     *
     * 判据**复用**已有的两种，不新造 `square` 义务（新造就意味着核验器里再写一套，
     * 同一件事两个真源）：四边形 `ABCD` 是正方形 ⟺ **四条边等长** + **相邻两边垂直**。
     * 一句话读出**四条**题设（读取器契约本来就允许返回数组）。
     *
     * **必须排在那条"面 XX"通用模式之前**：先具体的、再笼统的。
     */
    pattern: new RegExp(`(?:侧面|面)\\s*((?:${POINT_NAME}){4})\\s*(?:为|是)\\s*(正方形|矩形|长方形|菱形)`, "g"),
    read: (m) => {
      const [a, b, c, d] = names(m[1])
      if (a === undefined || b === undefined || c === undefined || d === undefined) return null
      /**
       * **同一句话的三种形状，判据全是已有的两种**（2026-10-15）：只按词分派，各写一条读取器
       * 就等于把"四边形是什么形状"这件事抄三遍。
       *
       * - **矩形 / 长方形**：三个相邻直角（三个直角才定死一个四边形）；
       * - **菱形**：四条边等长（取三对相邻边即可）；
       * - **正方形**：两者都要。
       */
      const equalEdges = [
        { kind: "equalLength" as const, targets: [a, b, b, c] },
        { kind: "equalLength" as const, targets: [b, c, c, d] },
        { kind: "equalLength" as const, targets: [c, d, d, a] }
      ]
      const rightAngles = [
        { kind: "perpendicular" as const, targets: [a, b, b, c] },
        { kind: "perpendicular" as const, targets: [b, c, c, d] },
        { kind: "perpendicular" as const, targets: [c, d, d, a] }
      ]
      if (m[2] === "菱形") return equalEdges
      if (m[2] !== "正方形") return rightAngles
      return [...equalEdges, ...rightAngles]
    }
  },
  {
    pattern: new RegExp(`(?:平面|底面|面)\\s*(${PLANE_NAME})\\s*(?:⊥|垂直于?)\\s*(?:平面|底面|面)\\s*(${PLANE_NAME})`, "g"),
    // `planeLengths` 必须是**点名个数**，不是字串长度：`A₁B₁C₁D₁` 是 4 个点、字串长 8。
    read: (m) => ({ kind: "planePerpendicular", targets: [...names(m[1]), ...names(m[2])], planeLengths: [names(m[1]).length, names(m[2]).length] })
  },
  {
    pattern: new RegExp(`(?:△|三角形)\\s*(${TRIANGLE_NAME})\\s*(?:为|是)?\\s*(?:边长为([0-9.]+)的)?\\s*(?:等边|正)三角形`, "g"),
    read: (m) => {
      const targets = names(m[1])
      const side = m[2] === undefined ? null : finitePositive(m[2])
      if (targets.length !== 3 || side === null) return { kind: "equilateral", targets }
      return [
        { kind: "equilateral", targets },
        { kind: "fixedLength", targets: [targets[0]!, targets[1]!], value: side },
        { kind: "fixedLength", targets: [targets[0]!, targets[2]!], value: side },
        { kind: "fixedLength", targets: [targets[1]!, targets[2]!], value: side }
      ]
    }
  },
  {
    /**
     * **并列写法**：`E、F 分别为 AC 和 CC₁ 的中点`（2026-10-14 用户现场，直三棱柱那道题）。
     *
     * 卷面上这是**最常见**的写法之一，而原先只认单写法（下一条）⇒ 整句落进
     * "原题出现了尚未被可靠解析的几何条件"，于是 E、F 两个点谁也没被点名，
     * 最后卡在"点名缺失：F"那道门上（用户当场读数）。
     *
     * 一句话读出**两条**题设：本文件的读取器契约本来就允许返回数组
     *（`ObligationDraft | ObligationDraft[]`），所以这里不需要为"并列"另造判据 ——
     * 两条 `midpoint`，与单写法走**同一个**判据。
     *
     * **必须排在下一条单写法之前**：先长的、再短的（与 `segmentRatio` 那两条同一个道理）。
     *
     * **`棱` / `边` 是可选的量词**（2026-10-15 用户现场，四棱锥那道题）：卷面写的是
     * `E、F 分别为**棱** AB、PB 的中点`，而上面这条原先只认紧跟着线段名的写法 ⇒ 整句落进
     * "尚未被可靠解析" ⇒ E、F 两个点谁也没被点名 ⇒ 补点的入口直接断掉。两种量词都收，
     * 但**只收这两个**（`面 AB` / `对角线 AC` 之类的说法要各自有判据才收，不顺手放行）。
     */
    pattern: new RegExp(`(${POINT_NAME})\\s*[、,，和与]\\s*(${POINT_NAME})\\s*(?:分别)?\\s*(?:为|是)\\s*(?:棱|边|线段)?\\s*(${SEGMENT_NAME})\\s*[和与、,，]\\s*(${SEGMENT_NAME})\\s*的?\\s*中点`, "g"),
    read: (m) => [
      { kind: "midpoint", targets: [m[1], ...names(m[3])] },
      { kind: "midpoint", targets: [m[2], ...names(m[4])] }
    ]
  },
  {
    pattern: new RegExp(`(${POINT_NAME})\\s*(?:为|是)\\s*(?:棱|边|线段)?\\s*(${SEGMENT_NAME})\\s*的?\\s*中点`, "g"),
    read: (m) => ({ kind: "midpoint", targets: [m[1], ...names(m[2])] })
  },
  {
    /**
     * **点写在后面**：`AB 的中点为 M`（2026-10-20 探针，联考 `joint-19` 那一类）。
     *
     * 前置量词同样收「线段 / 边 / 棱」。段名前面加 `(?<![A-Z])`：否则
     * `△ABC 的中点为 M` 会被读成「BC 的中点 M」—— 那是把一个三角形的重心说成一条边的中点。
     */
    pattern: new RegExp(`(?<![A-Z])(?:线段|边|棱)?\\s*(${SEGMENT_NAME})\\s*的?\\s*中点\\s*(?:为|是)\\s*(${POINT_NAME})`, "g"),
    read: (m) => {
      const segment = names(m[1])
      if (segment.length !== 2) return null
      return { kind: "midpoint", targets: [m[2]!, segment[0]!, segment[1]!] }
    }
  },
  {
    /**
     * **`AE:AD=2:5`：冒号写法的线段比**（2026-10-11 用户现场）。
     *
     * 残留扫描器（`UNREAD_CONDITION`）**早就把 `AE:AD=2` 这种形状当条件看** ——
     * 也就是说"这是一条条件"这件事一直是知道的，缺的只是接它的读取器，于是它必然变成
     * 一条"未核验的条件"，门禁因此不放行。
     *
     * 判据沿用已有的 `segmentRatio`：四个点名 = 两条线段，值 = **前比后**
     *（与 `AD=2AB` 判 `|AD|/|AB|` 同一条约定，见 `diagramVerification` 那一支）。
     *
     * **必须排在下一条"倍数"句型之前**：两者都以 `SEGMENT` 开头，先长的、再短的。
     *
     * 末尾的负向断言**还要挡一个 `:`**：`AB:AD=1:2:3` 这种三段比不许被半吃成 `1:2` 再留一截
     * `:3` —— 那截残留里没有 `=`，残留扫描器看不见它，就成了"静默丢掉一个条件"。
     */
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*[:：]\\s*(${SEGMENT_NAME})\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*[:：]\\s*(\\d+(?:\\.\\d+)?)(?![\\d.:：])`, "g"),
    read: (m) => {
      const numerator = finitePositive(m[3])
      const denominator = finitePositive(m[4])
      if (numerator === null || denominator === null) return null
      return { kind: "segmentRatio", targets: [...names(m[1]), ...names(m[2])], value: numerator / denominator }
    }
  },
  {
    /**
     * **面积**（Task 11，2026-10-12）：`△ABC的面积为6` / `三角形ABC的面积是6`。
     *
     * 只收**中文"面积"**那两种写法（`△` 与 `三角形` 前缀可省）。
     * **不收**代数式 `S△ABC=6` —— 那是另一种记号，硬塞进同一个正则会把
     * "读不懂"变成"读错"，而读错比读不懂更贵（用户看不到自己被误解了）。
     */
    pattern: /(?:△\s*)?(?:三角形\s*)?([A-Z]{3})\s*的面积\s*(?:为|是|=|：|:)\s*(-?\d+(?:\.\d+)?)/g,
    read: (m) => {
      const value = finitePositive(m[2])
      if (value === null) return null
      return { kind: "area", targets: names(m[1]), value }
    }
  },
  {
    /**
     * **链式等号**（2026-10-19 联考 `joint-04` / `joint-05`：`∥FE`、`=AA₁` 那种碎片）。
     *
     * 此前只读第一对（`AB=AC`），剩下的 `=AA₁` 在残留里变成一条"未核验的条件"；
     * 带尾巴时更糟 —— `AB=AC=AA₁=2` 会先被**单段长度读取器**吃掉 `AA₁=2`，留一个孤立的 `=`。
     * 所以这一条必须排在单段读取器**之前**（与"先长的、再短的"同一条纪律）。
     *
     * 语义：相邻两段各一条 `equalLength`；链上带数值时，**每一段**都记一条 `fixedLength`
     * —— `AB=AC=AA₁=2` 说的是三段都等于 2，不是只有最后一段。
     */
    pattern: new RegExp(`(${SEGMENT_NAME}(?:\\s*=\\s*${SEGMENT_NAME})+)(?:\\s*=\\s*${RADICAL_NUMBER_SOURCE})?`, "g"),
    read: (m) => {
      const segments = [...m[1].matchAll(new RegExp(SEGMENT_NAME, "g"))]
        .map((entry) => names(entry[0]))
        .filter((pair) => pair.length === 2)
      if (segments.length < 2) return null
      const drafts: ObligationDraft[] = []
      for (let index = 0; index + 1 < segments.length; index += 1) {
        drafts.push({ kind: "equalLength", targets: [...segments[index]!, ...segments[index + 1]!] })
      }
      const value = m[2] === undefined ? null : radicalValue(m[2])
      if (value !== null) for (const segment of segments) drafts.push({ kind: "fixedLength", targets: segment, value })
      return drafts
    }
  },
  {
    /**
     * **`AD=2AB=2`：倍数 + 后置长度，一次给两条判据**（2026-10-10 用户现场）。
     *
     * 用户把同一件事写全时会带上长度（`设 AD=2AB=2（即 AB=BC=1, AD=2）`）。原先只认前半截的
     * 倍数，剩下的 `=2` 在残留里变成一条"未核验的条件" ⇒ 门禁不放行。这里把它读成**AD 的长度**。
     * 必须排在下一条"纯倍数"句型**之前**：先长的、再短的，否则 `=2` 永远吃不到。
     */
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*(${SEGMENT_NAME})\\s*=\\s*(\\d+(?:\\.\\d+)?)(?![\\d.A-Z])`, "g"),
    read: (m) => {
      const ratio = finitePositive(m[2])
      const stated = finitePositive(m[4])
      if (ratio === null || stated === null) return null
      return [
        { kind: "segmentRatio", targets: [...names(m[1]), ...names(m[3])], value: ratio },
        { kind: "fixedLength", targets: names(m[1]), value: stated }
      ]
    }
  },
  {
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*(${SEGMENT_NAME})(?![A-Z])`, "g"),
    read: (m) => { const value = finitePositive(m[2]); return value === null ? null : { kind: "segmentRatio", targets: [...names(m[1]), ...names(m[3])], value } }
  },
  {
    /**
     * **`AE=2/5 AD`：分数写法的定比分点**（2026-10-15 用户现场，翻折那道题）。
     *
     * 卷面上这是最常见的写法之一，而原先只认 `AE:AD=2:5`（冒号）与 `AD=2AB`（倍数）两种 ⇒
     * 整句落进"尚未被可靠解析" ⇒ E、F 两条题设**谁也没被核**（现场读账就是那两条）。
     *
     * 判据与冒号那条是**同一个** `segmentRatio`：值 = **前比后**（`|AE| / |AD|`）。
     *
     * **必须排在长度读取器之前**：`AE=2/5 AD` 会被长度那条半吃成 `AE=2`
     *（`2` 后面是 `/`，不在它的负向断言集合里）⇒ 留下 ` /5 AD` 那半截**没有 `=`**、
     * 残留扫描器也看不见它 —— 那又成了"静默丢掉一个条件"。
     */
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*=\\s*(\\d+(?:\\.\\d+)?)\\s*\\/\\s*(\\d+(?:\\.\\d+)?)\\s*(${SEGMENT_NAME})(?![A-Z])`, "g"),
    read: (m) => {
      const numerator = finitePositive(m[2])
      const denominator = finitePositive(m[3])
      if (numerator === null || denominator === null) return null
      return { kind: "segmentRatio", targets: [...names(m[1]), ...names(m[4])], value: numerator / denominator }
    }
  },
  {
    /**
     * **`线段 AB 的长度为 3` / `AB 的长为 3`**（2026-10-20 第三批，探针照出的静默丢失）。
     *
     * 此前只有**带「弦」字**的那种写法能读（`弦 AB 的长为 3`），而"某条线段的长度为 n"是
     * 卷面上最常见的长度说法之一 —— 它既不影响图怎么画、也不落未核验，属于最难发现的一类：
     * **条件没被读完，报告却是干净的**。
     *
     * **两个守卫**：
     * - `(?<!弧)`：`弧 AB 的长为 3` 说的是**弧长**，不是弦长 AB —— 差一个字就是另一件事；
     * - 数值后面的负向断言多带 `|`：`|AB|=2|AC|` 右边还跟着东西，那不是"AB 的长度"。
     */
    pattern: new RegExp(`(?<!弧)(${SEGMENT_NAME})\\s*的\\s*长(?:度)?\\s*(?:为|是|等于)\\s*${RADICAL_NUMBER_SOURCE}(?![\\d.A-Z√|])`, "g"),
    read: (m) => { const value = radicalValue(m[2]); return value === null ? null : { kind: "fixedLength", targets: names(m[1]), value } }
  },
  {
    /**
     * **中线到哪条边 ⇒ 那个点就是该边的中点**（2026-10-20 第三批）。
     *
     * `AD 是 BC 边上的中线` 把 `D` **唯一确定**成 `BC` 的中点（中线定义：顶点与对边中点的连线），
     * 所以直接落 `midpoint` —— 判据早就有，缺的是这一个读取器。
     *
     * **只收带边名的写法**：`AD 是 △ABC 的中线` 没说哪条边，`D` 可能是 BC、CA、AB 的中点，
     * 猜一个就是替题面改题 ⇒ 那种落未核验并说清（见 `UNSUPPORTED_FAMILIES` 的「中线」那条）。
     */
    pattern: /([A-Z])([A-Z])\s*(?:是|为)\s*([A-Z])([A-Z])\s*边上的\s*中线/g,
    read: (m) => ({ kind: "midpoint", targets: [m[2]!, m[3]!, m[4]!] })
  },
  {
    /**
     * **长度**：`AB=8`、`AD=5√3`、`AD=√3`（根号写法 2026-10-11 用户现场）。
     *
     * 末尾的负向断言比原来多带一个 `√`：`AD=5√3√2` 这种畸形写法**不许被半吃掉** ——
     * 吃成 `5√3` 再留一截 `√2`，会让残留扫描器看不见它，那就成了"静默丢掉一个条件"。
     */
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*=\\s*${RADICAL_NUMBER_SOURCE}(?![\\d.A-Z√|])`, "g"),
    read: (m) => { const value = radicalValue(m[2]); return value === null ? null : { kind: "fixedLength", targets: names(m[1]), value } }
  },
  {
    /**
     * **弦长**（Task 14 的边界「弦长/面积未接」，2026-10-14 实测后补）：`弦 AB 的长为 3`。
     *
     * ## 为什么这条比"读不出来"更值得修
     *
     * 卷面上这句**没有 `=`**，所以两条既有读取器（`AB=3` 与面积）都不认它，
     * 而残留扫描器的触发词也够不到它 ⇒ 结果是**静默丢掉一条题设**：
     * 它既不进 `givens`、也不进 `unverified`，用户与判据都看不见它存在过。
     * 本仓把"静默丢掉一个条件"当最贵的一类错 —— 所以这一档补的是**读取器**，
     * 判据照旧复用 `fixedLength`（两个点名之间的距离，核验器那一侧已经有判据，不新造）。
     *
     * **`长度` 也要收**（2026-10-15，由 `examClauseCoverage.test.ts` 的审计照出来）：
     * 「弦 AB 的**长度**是 3」与「的长为 3」是同一件事的两种写法，而前者同样**没有 `=`**
     * ⇒ 只收"长为"时它照样**静默消失**（审计那一条就是因此才存在的）。
     */
    pattern: new RegExp(`弦\\s*(${SEGMENT_NAME})\\s*的?长(?:度)?\\s*(?:为|是|＝|=|：|:)\\s*${RADICAL_NUMBER_SOURCE}`, "g"),
    read: (m) => { const value = radicalValue(m[2]); return value === null ? null : { kind: "fixedLength", targets: names(m[1]), value } }
  },
  {
    /**
     * **`|AB|=3`**：线段长的另一种常见记法（绝对值号）。与上面那条同一条理由 ——
     * 判据复用 `fixedLength`，不新造；根号写法（`|AB|=3√2`）照收。
     *
     * **反向判据（2026-10-20）**：`|AB|=2|AC|` 说的是"AB 是 AC 的两倍"，**不是**"AB 长 2"。
     * 尾部负向断言因此多带一个 `|`：右边还跟着东西就不算一个长度 —— 读成后者会为一句题面里
     * 没有的条件报"不满足"，那比读不出更糟。
     */
    pattern: new RegExp(`\\|\\s*(${SEGMENT_NAME})\\s*\\|\\s*(?:＝|=)\\s*${RADICAL_NUMBER_SOURCE}(?![\\d.A-Z√|])`, "g"),
    read: (m) => { const value = radicalValue(m[2]); return value === null ? null : { kind: "fixedLength", targets: names(m[1]), value } }
  },
  {
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*(?:与|和)\\s*(${SEGMENT_NAME})\\s*(?:长度相等|线段相等|边相等|等长)`, "g"),
    read: (m) => ({ kind: "equalLength", targets: [...names(m[1]), ...names(m[2])] })
  },  {
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*=\\s*(${SEGMENT_NAME})(?![A-Z])`, "g"),
    read: (m) => ({ kind: "equalLength", targets: [...names(m[1]), ...names(m[2])] })
  },
  {
    /**
     * **「底面 ABCD 是菱形」**（S3）：菱形 = 四条边两两相等。
     *
     * 为什么拆成三条**已有的** `equalLength`，而不是新造一个 `rhombus` 判据：
     * "等长"的数学与判定全仓只有一处（`relations.ts` 的残差 + `diagramVerification` 的
     * `equalLength` 分支），新造一个就是把同一件事写第二遍。而"菱形 ⇒ 四边相等"这一步
     * 是**定义**，不是新的几何 —— 题面直接写 `AB=BC=CD=DA` 时走的是**同一套**核验。
     *
     * 三条链起来（`AB=BC`、`BC=CD`、`CD=DA`）就覆盖了四条边（传递性）。
     *
     * **只认恰好四个点名**：`菱形` 是四边形专有说法，`底面ABCDE是菱形` 是自相矛盾的题面；
     * 那种句子由下面那道"未被消费的强几何信号 ⇒ `unverified`"扫描**显形**，不静默丢掉。
     */
    pattern: new RegExp(`底面\\s*(${POINT_NAME}${POINT_NAME}${POINT_NAME}${POINT_NAME})\\s*(?:是|为)\\s*菱形`, "g"),
    read: (m) => {
      const ring = names(m[1])
      if (ring.length !== 4) return null
      const [a, b, c, d] = ring as [string, string, string, string]
      return [
        { kind: "equalLength" as const, targets: [a, b, b, c] },
        { kind: "equalLength" as const, targets: [b, c, c, d] },
        { kind: "equalLength" as const, targets: [c, d, d, a] }
      ]
    }
  },
  {
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*(⊥|∥|垂直于?|平行于?)\\s*(?:平面|底面|面)\\s*(${PLANE_NAME})`, "g"),
    read: (m) => ({ kind: m[2].includes("平行") || m[2] === "∥" ? "parallel" : "perpendicular", targets: [...names(m[1]), ...names(m[3])] })
  },
  {
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*(⊥|∥|垂直于?|平行于?)\\s*(${SEGMENT_NAME})(?![A-Z])`, "g"),
    read: (m) => ({ kind: m[2].includes("平行") || m[2] === "∥" ? "parallel" : "perpendicular", targets: [...names(m[1]), ...names(m[3])] })
  },
  {
    /**
     * **`AC 与 BC 垂直` / `AB 与 CD 平行`**（2026-10-20 探针，联考 `joint-19` 那一类）：
     * 文字写法把"与"放在两个线段之间、判断词放在最后。与 `AC⊥BC` 是**同一条判据**，
     * 只是词序不同 —— 不另造判据，只补读取器。
     */
    pattern: new RegExp(`(${SEGMENT_NAME})\\s*(?:与|和)\\s*(${SEGMENT_NAME})\\s*(?:互相)?(垂直|平行)`, "g"),
    read: (m) => ({ kind: m[3] === "平行" ? "parallel" : "perpendicular", targets: [...names(m[1]), ...names(m[2])] })
  }
]

/** 把 `5√3` / `√3` / `5` 求值；畸形写法返回 `null`（**不猜**）。 */
function radicalValue(text: string): number | null {
  const normalized = text.replace(/\s+/g, "")
  const match = /^(?:(\d+(?:\.\d+)?)√(\d+(?:\.\d+)?)|√(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?))$/.exec(normalized)
  if (match === null) return null
  const value = match[1] !== undefined
    ? Number(match[1]) * Math.sqrt(Number(match[2]))
    : match[3] !== undefined ? Math.sqrt(Number(match[3])) : Number(match[4])
  // 与 `finitePositive` 同一条口径：必须是有限正数，否则这条条件不成立。
  return Number.isFinite(value) && value > 0 ? value : null
}

const UNREAD_CONDITION = /∠\s*[A-Z]{3}\s*=\s*\d+(?:\.\d+)?\s*°|[A-Z]{2}\s*[:：]\s*[A-Z]{2}\s*=\s*\d+(?:\.\d+)?|[A-Z]{2}\s*=\s*-?\d+(?:\.\d+)?|(?:锐角|直角|钝角)三角形|[A-Z]{2}\s*[>＜<≠≥≤]\s*[A-Z]{2}|直径|[≌∽]|重心|垂心|矩形|交于点|所成角(?:为|是)?\s*[√\d]|体积(?:为|是)\s*[√\d]|距离(?:为|是)\s*[√\d]/g

/**
 * **曲线方程的形状**：**小写** `x` / `y` 后面跟平方（`x²` / `x^2` / `y²`）。
 *
 * 为什么拿**小写**当判据：本仓的点名一律大写，所以 `AB²=4` 是**线段的平方**，
 * 不是坐标变量的平方。少了这一条，`AB²=4` 会被贴上"非标准曲线"的标签 ——
 * 那是**过度解释**，比不解释更糟。
 */
const CURVE_EQUATION_TERM = /(?:^|[^A-Za-z])[xy]\s*(?:\^\s*2|²)/

/**
 * **「在曲线外」的形状**（施工单①的另一半，2026-10-15）：`椭圆外 / 双曲线外 / 抛物线外 / 圆外`。
 *
 * 为什么它要单独一句话：它与刚接上的那条 `pointOnConic`（`P 是椭圆上一点`）**只差一个字**，
 * 说的却是**相反**的事。落进通用文案（"尚未被可靠解析"）时，用户会以为"换个写法就能被认出来"，
 * 于是把"在外面"改写成"在曲线上"—— 那是**替题面改题**。所以这里明说：判据今天只管"在曲线上"。
 */
const OUTSIDE_CURVE_TERM = /(?:椭圆|双曲线|抛物线|圆)\s*外/

/**
 * **「点在一条线段上」的形状**（2026-10-15 用户现场，Rt△ABC 折起那道题）：`AC 上一点`。
 *
 * 判据**要求前面是两个点名**（`[A-Z]{2}`）：`D 为 AC 上一点` 命中，而
 * `P 是椭圆上任意一点` 那种说法**不命中**（它归圆锥曲线那一支，理由各自不同）——
 * 一条宽触发词（不许静默消失）+ 一条窄理由（说清是哪一类），两件事分开。
 *
 * **2026-10-15：判据已经有了**（`pointOnSegment`，读取器就在上面）。这个触发词现在接的是
 * 那些**读取器读不出**的同族说法 —— 例如 `AC 上一点 E`（点写在线段后面，语序读不出）。
 * 所以理由文案跟着改了：不再是"今天还没有判据"，而是"**这一句的点名没排成能读的顺序**"。
 */
const ON_SEGMENT_TERM = /[A-Z]{2}\s*上\s*(?:一点|的点|任意一点|的一点|动点)/

/**
 * **一条残留条件的理由**（Task 14 的边界：「非标准曲线的明确不归类」，2026-10-14）。
 *
 * 调研 §C 原文：`2024 新课标Ⅰ卷第 11 题`是**非标准曲线**，"暂记范围外/跨家族候选，
 * **不伪装成椭圆/双曲线/抛物线**"。而此前的实情是：这类方程落进**通用**的未核验文案
 * —— 那句话把**范围外**说成了**没写清楚**，用户会以为换个写法就能被认出来，
 * 于是反复改题面。所以曲线方程这一档要**单独说清它是范围外**。
 *
 * 两处残留路径（逐句那条与整句 leftover 那条）**共用这一个函数**：理由只有一处文案，
 * 否则同一句话会随它落在哪条路径而给出两种说法。
 */
function unverifiedReasonFor(leftover: string): string {
  if (CURVE_EQUATION_TERM.test(leftover)) {
    return "这条曲线方程没有被归入本仓支持的三类标准圆锥曲线（椭圆 / 双曲线 / 抛物线的标准方程）或 `f(x)=…` 那一类函数式 —— 记为**明确不归类**：不伪装成椭圆 / 双曲线 / 抛物线，也不硬塞成函数图像。它是**范围外**，不是「没写清楚」。"
  }
  if (OUTSIDE_CURVE_TERM.test(leftover)) {
    return "「点在曲线**外**」与「点在曲线上」是两件相反的事，而今天的判据只有后一条（`pointOnConic`）—— 这一句不会被读成「在曲线上」，也没有「在外面」的判据，如实未核验。"
  }
  if (ON_SEGMENT_TERM.test(leftover)) {
    return "「某点在一条线段上」**已经有判据了**（与该线段共线、且落在线段内），但这一句的**点名没排成能读的顺序** —— 判据读的是`点 + 是/为/在 + 线段 + 上一点`（例如 `D 为 AC 上一点`）与`线段 + 上一点 + 点`（例如 `AC 上一点 D`）这两种语序；这一句两种都不是（例如 `D 在 AC 上` —— 少了「一点」那截尾巴，既可能是线段也可能是直线，猜不得）。如实未核验，**不静默丢掉**。"
  }
  for (const [pattern, reason] of UNSUPPORTED_FAMILIES) {
    if (pattern.test(leftover)) return reason
  }
  return "原题出现了尚未被可靠解析的几何条件，未核验。"
}

/**
 * **没有判据的条件家族**（2026-10-20 第三批，41 个常见写法探针照出来的 19 条静默）。
 *
 * 每一族给一句**具体**理由，而不是那句什么都可能、也什么都说不清的兜底 —— 用户看到
 * "原题出现了尚未被可靠解析的几何条件"时，无法判断"是我写错了，还是系统根本没这个判据"。
 *
 * 顺序有意义：越具体的放前面（`弧…的长` 要先于更泛的匹配；`球的表面积` 要先于 `球`）。
 */
const UNSUPPORTED_FAMILIES: readonly [RegExp, string][] = [
  [/弧.{0,3}的长|弧长/, "「弧长」今天没有判据 —— 弧的度量与「线段的长度」不是一回事（它要先有圆心与半径）。如实未核验。"],
  [/角平分线|平分线/, "「角平分线」今天没有判据（要新造一条：角的内部一条射线，两边到这个点的距离相等）。这句不会被读成任何一条义务，如实未核验。"],
  [/中位线/, "「三角形的中位线」今天没有判据（它同时意味着两个中点、平行于第三边、长度是第三边的一半 —— 那是一条**复合**义务）。如实未核验。"],
  [/中线/, "「中线」只说了 AD 是中线、**没说是哪条边**上的 ⇒ 定不出这个点是哪个线段的中点，不猜，如实未核验。"],
  [/内心|旁心/, "「内心 / 旁心」今天没有判据（要新造「到三边距离相等」的圆心求解）。如实未核验。"],
  [/弦心距|弦心/, "「弦心距」今天没有判据。如实未核验。"],
  [/轴截面|展开图/, "「轴截面 / 侧面展开图」是**另一个对象**（截面多边形 / 扇形），不是这个实体本身 —— 它上面那些尺寸今天没有判据。如实未核验。"],
  [/球的?(?:半径|表面积|面积)|(?:内切|外接)球/, "球的半径 / 表面积今天没有判据（要按球的图元量，而不是按某个截面）。如实未核验。"],
  [/棱数|棱的条数|顶点数|面的个数/, "「棱数 / 顶点数 / 面的个数」是组合量，今天没有判据。如实未核验。"],
  [/仰角|俯角|坡度|坡角/, "「仰角 / 俯角 / 坡度」是**视线（或斜面）与水平面的夹角** —— 今天没有判据：它要求先有「水平面」这个对象。如实未核验。"]
]

/**
 * **非标准曲线**（同一个判据的另一半）：逐句残留那条路径原本用的是一句更短的话，
 * 现在也走 `unverifiedReasonFor` —— 两处说法一致。
 */
function unverifiedClauseReason(leftover: string): string {
  return CURVE_EQUATION_TERM.test(leftover)
    ? unverifiedReasonFor(leftover)
    : "这个条件没有被可靠解析或数值非法，未核验。"
}

/**
 * **把"底面"这个占位落成具体点名**（Task 13 边界：斜棱柱的明说倾角）。
 *
 * 为什么放在整句解析**之后**、而不是读取器里：读取器只看得到自己那一小段匹配，
 * 而"哪几个点是底面"写在**形状从句**里（`在斜三棱柱ABC-A′B′C′中`）。底环的解析只有一处
 *（`parseShapeClause`），所以这里问它 —— 不另写一套"哪几个点是底面"的判据。
 *
 * **认不出底环就如实落未核验**（没有形状从句、或从句里没有点名表）：那时不知道量哪个平面，
 * 猜一个平面比说"没核验"糟得多。
 */
function resolveStatedBasePlane(givens: DiagramObligation[], unverified: DiagramObligationSet["unverified"], prompt: string): void {
  for (let index = givens.length - 1; index >= 0; index -= 1) {
    const obligation = givens[index]!
    if (obligation.kind !== "linePlaneAngle" || obligation.targets[2] !== STATED_BASE) continue
    const base = parseShapeClause(prompt)?.base ?? null
    if (base === null || base.length < 3) {
      givens.splice(index, 1)
      unverified.push({
        sourceText: obligation.sourceText,
        reason: "这条线面角写的是「底面」，而题面里没有可识别的形状从句（底环点名）—— 不知道要量哪张平面，未核验。"
      })
      continue
    }
    obligation.targets = [...obligation.targets.slice(0, 2), ...base]
    obligation.planeLengths = [2, base.length]
  }
}

/**
 * **把单字母角 `∠A` 落成三个点名**（Task 11 的边界，2026-10-14）。
 *
 * `∠A` 只说了一个点名，两条边（`AB`、`AC`）**必须从形状从句的环上取邻点** ——
 * 而这个环的解析只有一处（`parseShapeClause`），所以这里问它，不另写一套"谁是邻点"。
 *
 * **问不出来就不猜**（没有形状从句、环少于三点、顶点不在环上）：那三个情形都说明
 * "题面里没有可识别的图形"，那时如实落未核验 —— 猜两条边就是替题面改题。
 */
function resolveStatedVertexAngle(givens: DiagramObligation[], unverified: DiagramObligationSet["unverified"], prompt: string): void {
  for (let index = givens.length - 1; index >= 0; index -= 1) {
    const obligation = givens[index]!
    if (obligation.kind !== "planarAngle" || obligation.targets[1] !== STATED_VERTEX_ANGLE) continue
    const vertex = obligation.targets[0]!
    const ring = parseShapeClause(prompt)?.base ?? null
    const at = ring === null ? -1 : ring.indexOf(vertex)
    if (ring === null || ring.length < 3 || at < 0) {
      givens.splice(index, 1)
      unverified.push({
        sourceText: obligation.sourceText,
        reason: "这条角只写了一个点名（如 `∠A`），而题面里没有可识别的形状从句（点名环）、或这个顶点不在环上 —— 不知道是哪两条边，未核验。"
      })
      continue
    }
    const previous = ring[(at - 1 + ring.length) % ring.length]!
    const next = ring[(at + 1) % ring.length]!
    obligation.targets = [previous, vertex, next]
  }
}

export function parseDiagramObligations(prompt: string, options: DiagramParseOptions = {}): DiagramObligationSet {
  const boundary = /(?:求证|证明)/.exec(prompt)
  const givenText = boundary === null ? prompt : prompt.slice(0, boundary.index)
  const goalRawStart = boundary === null ? -1 : boundary.index + boundary[0].length
  const goalRaw = goalRawStart < 0 ? "" : prompt.slice(goalRawStart)
  const prefixLength = /^[：:，,\s]*/.exec(goalRaw)?.[0].length ?? 0
  const goalText = goalRaw.slice(prefixLength).trim()
  const goals = goalText ? [goalText] : []
  const goalSources: DiagramSourceSpan[] = goalText ? [{ sourceText: goalText, start: goalRawStart + prefixLength, end: goalRawStart + prefixLength + goalText.length }] : []
  const freeChoiceSources: (DiagramSourceSpan & { name: string })[] = []
  const namedChoices = new Set<string>()
  for (const match of givenText.matchAll(/(?:任取|任意|自由)(?:一?个)?\s*点\s*([A-Z])/g)) {
    const name = match[1]
    if (namedChoices.has(name)) continue
    namedChoices.add(name)
    freeChoiceSources.push({ name, sourceText: match[0], start: match.index, end: match.index + match[0].length })
  }
  const freeChoices = freeChoiceSources.map(({ name }) => name)
  const givens: DiagramObligation[] = []
  const unverified: DiagramObligationSet["unverified"] = []
  const used = new Set<number>()

  const matchers = options.spatialPointConditions === true ? [POINT_COORDINATE_MATCHER, ...DIAGRAM_OBLIGATION_MATCHERS] : DIAGRAM_OBLIGATION_MATCHERS
  for (const { pattern, read, allowAfterLabelColon, allowOverlap } of matchers) {
    for (const match of givenText.matchAll(pattern)) {
      const start = match.index
      const end = start + match[0].length
      // A suffix of ∠ABC=60° is not the segment condition BC=60.
      if (start > 0 && /[A-Z∠:：]/.test(givenText[start - 1])) {
        const afterLabelColon = allowAfterLabelColon === true && /[：:]/.test(givenText[start - 1])
        if (!afterLabelColon) continue
      }
      const next = /^\s*(\S)/.exec(givenText.slice(end))?.[1]
      if (next && /[A-Z°+*/√π^%]/.test(next)) continue
      if (!allowOverlap && Array.from({ length: end - start }, (_, offset) => start + offset).some((at) => used.has(at))) continue
      const result = read(match)
      // 一个句型可以蕴含多条判据（`底面ABCD是菱形` ⇒ 三条等长），所以读取器允许返回数组。
      const drafts = result === null ? [] : Array.isArray(result) ? result : [result]
      // 圆锥曲线、切线、函数定义与点坐标都**不带点名**：它们自己就是被核验的对象，不能拿"至少两个名字"去卡。
      // `pointOnConic`（施工单①）是**只有一个点名**的那一类：它问的是"这一个点在不在那条曲线上"，
      // 拿"至少两个名字"去卡会把它整条丢掉 —— 那正是它此前静默消失的机制之一。
      const accepted = drafts.filter((result) => result.kind === "pointCoordinate" || result.kind === "conicAxes" || result.kind === "conicChord" || result.kind === "tangentAt" || result.kind === "functionGraph" || result.kind === "commonTangent" || result.kind === "functionLineIntersections" || result.kind === "pointOnConic" || new Set(result.targets).size >= 2)
      for (const draft of accepted) givens.push({ ...draft, sourceText: match[0], start, end })
      if (accepted.length === 0) continue
      for (let at = start; at < end; at++) used.add(at)
    }
  }

  /**
   * **"底面"落成点名**：线面角那一条收的是占位，形状从句才知道底环是哪几个点。
   * 放在残留扫描**之前**：落不出底环时它要能如实变成一条"未核验"。
   */
  resolveStatedBasePlane(givens, unverified, givenText)
  /** 单字母角同理：顶点有了、两条边要从形状从句的环上取。 */
  resolveStatedVertexAngle(givens, unverified, givenText)
  /**
   * **「焦点 + 离心率」⇒ 曲线**（2026-10-20）：放在残留扫描**之前** —— 数据不全时它要能
   * 如实变成一条"未核验"（而不是消失），读到的那两段也要先标成"已用"。
   */
  resolveFocusEccentricity(givens, unverified, givenText, used)
  /**
   * **实体的标量尺寸**（2026-10-20）：`圆锥的底面半径为2，母线长为3`。
   * 同样排在残留扫描之前 —— 读到的那几段要标成"已用"，否则 `母线` 这个触发词会让
   * 同一句在报告里出现两次（一次核过、一次"未核验"）。
   */
  resolveSolidDimensions(givens, givenText, used)

  for (const match of givenText.matchAll(UNREAD_CONDITION)) {
    if ([...match[0]].some((_, offset) => used.has(match.index + offset))) continue
    /**
       * **引「整句」，不引「第一个词」**（2026-10-05 修）。
       *
       * 原来是 `/^[^，,。；;\s]+/` —— 只取到第一个空白为止。于是 `∠ABC=60°`（**无空格**）拿到整条，
       * 而 `∠PAB = 60°`（**有空格**）只拿到 `∠PAB`、`sin∠PAB = 0.5` 只拿到 `AB`、`AB:AD = 1:2`
       * 只拿到 `AB:AD` —— **值全被截掉**。
       *
       * 为什么这是**用户可见的缺陷**而不是内部细节：`diagramVerification.ts` 把 residue 的
       * `sourceText` **原样**变成核验 check 的文案，而那条 check 会出现在用户的"题设尚未核验"列表里。
       * 用户看到的是"**∠PAB 没核验**" —— 条件本身没显示出来。
       *
       * 为什么此前没被发现：既有用例用的是 `∠ABC=60°`（**无空格**）那位，它一直是对的；
       * **缺陷正好藏在"带空格的写法"那一侧**，而那是用户随手就会打出来的形状。
       */
      const clause = [...givenText.matchAll(/[^，,。；;\n]+/g)]
        .find((entry) => (entry.index ?? 0) <= match.index && match.index < (entry.index ?? 0) + entry[0].length)
      const sourceText = clause?.[0].trim() ?? match[0]
    unverified.push({ sourceText, reason: unverifiedClauseReason(sourceText) })
  }

  if (options.spatialPointConditions === true) {
    // A bare A(0,0,0) has no equals sign; clause scanning splits on commas,
    // so capture the whole tuple before it can silently disappear in three pieces.
    for (const match of givenText.matchAll(/[A-Z]\s*\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g)) {
      if ([...match[0]].some((_, offset) => used.has(match.index + offset))) continue
      unverified.push({ sourceText: match[0], reason: "这个点的坐标写法尚未可靠解析，未核验。" })
    }
  }

  /**
   * **「（即 …）」是重述，不是一条新条件**（2026-10-10 用户现场）。
   *
   * 用户常把同一批条件再写一遍：`设 AD=2AB=2（即 AB=BC=1, AD=2）`。里面的等式照旧由上面的句型认
   *（认得出就进 `givens`），但**这个外壳本身**不该在残留里变成一条"未核验的条件" ——
   * 于是把整段括号标成"已用"，残留自然就干净了。
   *
   * **只认带重述标记的括号**（`即 / 也就是 / 亦即`）：普通括号里可能是真条件，不许一律豁免。
   */
  for (const match of givenText.matchAll(/[（(]\s*(?:即|也就是|亦即)[^）)]*[）)]/g)) {
    for (let offset = 0; offset < match[0].length; offset += 1) used.add((match.index ?? 0) + offset)
  }

  // Scan the portions no reliable matcher consumed. A new textbook notation must
  // become visible as unverified, not silently turn a non-empty problem into an empty pass.
  for (const clause of givenText.matchAll(/[^，,。；;\n]+/g)) {
    if (unverified.some((entry) => clause[0].includes(entry.sourceText))) continue
    const leftover = [...clause[0]].map((character, offset) => used.has(clause.index + offset) ? " " : character).join("").trim()
    const unknownPointCondition = options.spatialPointConditions === true
      && (/[A-Z]\s*\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/.test(leftover)
        || /[A-Z]\s*(?:在|位于)[^，,。；;\n]{0,30}(?:上方|下方)/.test(leftover))
    /**
     * **触发词表**（残留扫描器：这些词出现了，说明"这里有一条题设没被读出来"）。
     *
     * `(?<!椭)圆上` 那个负向后顾是**实测逼出来的**（2026-10-15）：直接写 `圆上` 会命中
     * 「椭**圆上**」—— 于是设计夹具里那句 `P 是椭圆上任意一点` 从"被忽略"变成
     * "落进未核验"，进而把那条设计用例从 `awaiting_confirmation` 打成 `failed`。
     * 也就是说：**这个误伤顺带暴露了另一处真缺口**（`椭圆上` 这类今天同样读不出来，
     * 见 `curvePointClauses.test.ts` 里钉住的那一条），但两件事要分开处理 ——
     * 这一行只负责"真正的圆"。
     *
     * **`上一点 / 上的点 / 上任意一点`（2026-10-15 用户现场，Rt△ABC 折起那道题）**：
     * `D 为 AC 上一点` 此前**既不在给定里、也不在未核验里 —— 静默消失**（与当年
     * `弦 AB 的长为 3`、`P 是椭圆上任意一点` 同一种病）。这一条今天还**没有读取器**
     *（"点在线段上"要一条新义务 + 一条判据：共线且落在线段内），但**至少不许消失**。
     */
    const goalQuestion = /^(?:则|求)[^，,。;；]*=\s*[.。]?$/.test(leftover.trim())
    if (!goalQuestion && (/[=⊥∥]|二面角|等边|等长|长度相等|线段相等|边相等|相等|中点|垂直|平行|共面|之比|比值|比例|共线|菱形|圆周|(?<!椭)圆上|母线|底面圆|(?:椭圆|双曲线|抛物线|圆)外|上一点|上的点|上任意一点|(?:点?[A-Z]\s*在\s*平面)|角平分线|中位线|中线|内心|旁心|弦心距|弧长|弧.{0,3}的长|轴截面|展开图|仰角|俯角|坡度|坡角|棱数|(?:内切|外接)球的?(?:半径|表面积|面积)|球的(?:半径|表面积|面积)/.test(leftover) || unknownPointCondition)) {
      unverified.push({ sourceText: leftover, reason: unverifiedReasonFor(leftover) })
    }
  }
  givens.sort((left, right) => left.start - right.start)
  return { givens, goals, ...(goalSources.length ? { goalSources } : {}), freeChoices, ...(freeChoiceSources.length ? { freeChoiceSources } : {}), unverified }
}
