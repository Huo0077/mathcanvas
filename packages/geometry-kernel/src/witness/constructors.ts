/**
 * **解析见证构造**（N2 子任务 2a；计划 N2 的 `Files` / Ownership / R18）。
 *
 * 输入是**题面点名的顶点**加**题面陈述的关系**，输出一组候选坐标。代表情形就是
 * `apps/web/src/agent/representativeFixtures.ts` 的 `PYRAMID_PROMPT`：一个数字都没有，
 * 只有 `PA ⊥ 平面 ABCD`、`BC ∥ AD`、`AB ⊥ AD`。
 *
 * ## 只做解析构造，不做通用非线性求解（R18）
 *
 * 首批覆盖（棱锥 / 棱柱，底面 n = 3 或 4）：
 *
 * - 底面的**点名的直角**把底面构造成矩形（仅四边形环首）或直角三角形（三角形任一唯一明确点名的顶点），只余两个自由长度；
 * - 顶点在**点名的垂足**正上方，高来自四种来源：自由示例值、题面给定的高、
 *   由**点名的侧棱长度**解析求出（`h = √(L² − d²)`）、由**点名的二面角**在**有界区间内求根**求出
 *   （**不是闭式 `h = d·tanθ`** —— 见 `solveDihedralHeight`：那个闭式对常见取法给出的是补角）；
 * - 棱柱 = 底面多边形 + 拉伸向量（显式给出，或由一对点名顶点给出）。
 *
 * **平面图形**（乙案 Task 3A，2026-10-11）是第四族，也是唯一**没有立体**的一族：
 * 环 + 题面的定长与点名的角 → `z = 0` 上的坐标（`constructPlanarWitness`）。
 * 它排在最后是因为它与上面那三族**没有共用词汇**：没有顶点、没有拉伸向量、没有高，
 * 多解也由"不许自交"取舍，而不是由"取代表值"取舍。
 *
 * 覆盖不到的形状（斜平行四边形底面、直角不在环首的四边形…）**明确拒绝**并给出
 * `reason.code`，而不是悄悄换一个题目没说的形状 —— 那正是"特值化悄悄改题"的老毛病。
 *
 * ## 三条纪律
 *
 * 1. **确定性**：没有 RNG、没有时间、没有 Map/Set 迭代顺序依赖；同输入永远同输出
 *    （`constructors.test.ts` 的确定性用例连跑 25 次逐字节比较）。
 * 2. **拒绝是值不是异常**：返回 `{ status: "rejected", code, message }`，`code` 机器可读；
 *    入口对"类型合法但字段缺失"的请求（2b 从原话适配时最常见）也走这条路。
 * 3. **自证不算数**（R15）：这里只**生成候选**并做纯形状 / 尺度自检（`residuals.ts`）；
 *    是否满足题设由 2b 的 `verifyDiagramObligations` + 内核 `buildFromPoints` 判定。
 *    `faces` 只按**规则**生成（底面 + 每个底棱一个侧面），不手推绕向。
 */

import { crossVector3, distanceVector3, dotVector3, lengthVector3, normalizeVector3, subtractVector3, type Vector3 } from "../geometry3d"
import { dihedralAngleDetail3 } from "../markers3d"
import { canonicalPointName, POINT_NAME_SUFFIXES, pointNameSuffixCount } from "../pointNames"
import { hasSelfIntersectingPolygon } from "../solid-builders"
import type { ShapeScalarChoice, SolidShapeSpec } from "./solidShapeSpec"
import { candidateResiduals, polygonResiduals, type WitnessResidualDiagnostic } from "./residuals"

/** 题目已给出的数值：`value` 是数值本身，`raw` 保留题面写法（进 freeValues / trace）。 */
export interface WitnessStatedValue {
  value: number
  raw?: string
}

/** 角度关系中的平面：三个**点名的**顶点（`[P, A, B]` 读作平面 PAB）。 */
export type WitnessPlaneTarget = readonly string[]

/**
 * 题面陈述的关系。
 *
 * `perpendicular` / `parallel` / `segment-length` 一律用 `segments`：每一段是**一对点名顶点**。
 * `dihedral` 用两个三点平面（它们必须共享一条棱）。
 */
export type WitnessRelation =
  | { kind: "perpendicular"; segments: readonly (readonly string[])[] }
  | { kind: "parallel"; segments: readonly (readonly string[])[] }
  /**
   * **两段等长**（S3）：由题面的 `AB=BC` / 「底面 ABCD 是菱形」拆出来的三条链式关系进来。
   *
   * 语义与 `segment-length` 的分工：`segment-length` 说"这一段有多长"（**值**），
   * 本档说"这两段一样长"（**关系**，没有值）—— 菱形的四条边只有"相等"这一个约束，
   * 边长本身仍是自由的（由 `freeBaseEdges` 给一个示例值）。
   */
  | { kind: "equal-length"; segments: readonly (readonly string[])[] }
  | { kind: "segment-length"; segments: readonly (readonly string[])[]; value?: number | WitnessStatedValue }
  /**
   * **点名的数值角**（§3-F，2026-10-10）：`∠ABC=60°`。
   *
   * `targets` **恰好三个点名**，中间那个是顶点（`["A","B","C"]` 读作 `∠ABC`）。
   * 语义是**内部角**、取值 `(0°, 180°)` —— 与"两条直线的夹角"（取 `[0°,90°]`）**不是一回事**，
   * 所以它是独立的一档，不借 `perpendicular` / `parallel` 的名字（判据写混了不会红）。
   *
   * **本批只支持三角形底面**把它闭式造出来（见 `deriveAngledTriangleBase`）；
   * 四边形底部与涉及环外点的角一律拒绝，理由由那些分支的文案说清。
   */
  | { kind: "planarAngle"; targets: readonly string[]; value?: number | WitnessStatedValue; unit?: string }
  /**
   * **面积**（Task 11，2026-10-12）：`△ABC的面积为6` ⇒ `targets` 三个点名、`value` 是面积。
   *
   * 它在平面构造里的作用是**把一条自由的臂定下来**：`面积 = ½·底·臂·sin(夹角)`
   * ⇒ 已知底、夹角与面积时臂长唯一（见 `planarRuleFromArea`）。
   */
  | { kind: "area"; targets: readonly string[]; value?: number | WitnessStatedValue }
  | { kind: "dihedral"; segments: readonly WitnessPlaneTarget[]; value?: number | WitnessStatedValue; unit?: string }

/** 高（棱锥）的来源。 */
export type WitnessHeightSpec =
  /** 题面没有给尺寸：按通用比例取一个示例值（写进 `freeValues`）。 */
  | { kind: "free"; value?: number }
  | { kind: "fixed"; value: number }
  /** 由点名的侧棱长度解析求出：`h = √(L² − d²)`，`d` 是垂足到该侧棱另一个端点的距离。 */
  | { kind: "lateral-edge"; edge: readonly [string, string]; length: number | WitnessStatedValue }
  /**
   * 由点名的二面角在**有界范围**内求出：对内核自己的二面角度量求根（不是写死的 `d·tanθ`，
   * 见 `solveDihedralHeight` 的说明）。`angleRelation` 是题面给那个角的写法（`"P-C-D"`）。
   */
  | { kind: "dihedral"; angleRelation: string; value?: number | WitnessStatedValue; unit?: string }

/** 顶点的位置。首批只做"点名的垂足正上方"。 */
export interface WitnessApexSpec {
  at: string
  foot?: string
  height?: WitnessHeightSpec
}

/** 拉伸向量（棱柱）的来源。 */
export type WitnessExtrusionSpec =
  | { kind: "vector"; vector: Vector3 }
  /**
   * 由一对点名顶点给出（`to − from`）。
   *
   * **首批边界（2b 必读）**：两个端点都必须是**底面环上的**点名顶点，而 `deriveBasePolygon`
   * 把底面顶点一律建在 z = 0 平面上 —— 所以这条分支产出的向量**永远落在底面内**，
   * 必然被零体积判据拒成 `degenerate-extrusion`。要用它真正拉出实体，得先有"环外点名顶点"
   * 的概念（那是后续批次的事）。当前保留这条分支只为如实拒绝，不是为了能用。
   */
  | { kind: "points"; from: string; to: string }
  /** 题面未给：由编排层（2b 的有限网格）决定，本层不猜。 */
  | { kind: "unknown" }

export interface PyramidConstructRequest {
  shape: "pyramid"
  /** 底面环，按题面顺序（`["A","B","C","D"]`）。 */
  base: readonly string[]
  apex: WitnessApexSpec | null
  relations: readonly WitnessRelation[]
}

export interface PrismConstructRequest {
  shape: "prism"
  base: readonly string[]
  relations: readonly WitnessRelation[]
  extrusion: WitnessExtrusionSpec
}

/**
 * **台体**（S4）：底面环 + 与底面**平行**的顶面环，顶面是底面的相似缩小。
 *
 * 台的几何定义就是"用平行于底面的平面截棱锥，取截面与底面之间那一段"，
 * 所以它只比棱柱多**一个**自由标量：相似比 `scale`（`0 < scale < 1`）。
 * `scale → 1` 就退化回棱柱，`scale → 0` 退化成棱锥顶点 —— 两个端点都**不是**台体，必须拒绝。
 *
 * 顶面环的点名不在这里给：与棱柱一样由 `withPrimes` 从底面名派生，
 * 于是"顶面叫 `A′` 还是别的"只有一处规则（题面用的也是同一套字形）。
 */
export interface FrustumConstructRequest {
  shape: "frustum"
  base: readonly string[]
  relations: readonly WitnessRelation[]
  extrusion: WitnessExtrusionSpec
  /** 顶面相对底面的相似比，`0 < scale < 1`。 */
  scale: number
}

/**
 * **平面图形**（乙案 Task 3A / 设计 §4）：一只环 + **钉住它的度量条件**。
 *
 * 与上面那三族的分工：这里没有顶点、没有拉伸向量、没有高 —— 坐标一律落在 `z = 0` 平面上，
 * 由题面的**定长**与**点名的角**逐点定出来。环本身就是那只多边形，所以 `faces` 只有一只环，
 * 物化走的是 `solid.create_face` 那条（平面片），不是多面体。
 *
 * **它为什么是一个独立成员**：Task 3 第一步的探针实测，平面规格喂进内核时落到
 * `constructPyramidWitness`，被 `missing-apex` 拒掉 —— 那说明候选构造这一层缺的不是一个函数，
 * 而是一条**按 family 分派**的分支。
 */
export interface PlanarFigureConstructRequest {
  shape: "planar-figure"
  /** 环，按题面点名顺序（`["A","B","C","D"]`）。 */
  base: readonly string[]
  relations: readonly WitnessRelation[]
}

export type WitnessConstructRequest = PyramidConstructRequest | PrismConstructRequest | FrustumConstructRequest | PlanarFigureConstructRequest

/** 构造出的候选形状。**不含"是否满足题设"的结论**（R15）。 */
export interface WitnessShapeCandidate {
  /** 顶点坐标，与 `names` 同序。 */
  points: Vector3[]
  names: string[]
  /**
   * 建模顺序。当前恒为**恒等映射**（`[0, 1, … n-1]`）：`points` 的顺序就是
   * 「底面环 `n` 个（按题面点名顺序）+ 顶点 1 个（棱锥）/ 顶面环 `n` 个（棱柱）」，
   * 与 `faces` 用的是同一套下标空间。字段保留是为了让 2b 显式看到"坐标从哪来"，
   * 而不是隐含假设它等于下标顺序。
   */
  buildOrder: number[]
  /** 面环（`names` 下标）。按**规则**生成（底面 + 顶面 / 侧面），绕向按"朝外"归一化。 */
  faces: number[][]
  /** 系统**自选**的值（题面没给的），必须原样进 `assumptions` 给用户看。 */
  freeValues: string[]
  assumptions: string[]
}

/** 拒绝码：机器可读，供 2b 分类与排序。 */
export type WitnessConstructRejectionCode =
  | "missing-apex"
  | "duplicate-name"
  | "base-ring-too-small"
  | "unsupported-base-shape"
  | "degenerate-base"
  | "degenerate-height"
  | "missing-height-reference"
  /**
   * **平面数值角那一族**（§3-F 阶段 B）：角里出现了**顶点**（环外点）。
   *
   * - `contradictory-angle`：**算出来的**矛盾 —— 那个角与顶点的高**无关**（实测在两个不同的高上读数相同），
   *   而那个恒定值不等于题面要的值。它与"没找到"是两回事，所以单独一个码。
   * - `unsupported-angle-shape`：这一层不做或找不到 —— 角的**点名形状**出了本层的范围
   *   （顶点本身是角的顶点、两个角条件同时在场），或者**允许范围内没有满足它的高**。
   *   文案里说清是哪一种，**绝不**给近似值。
   */
  | "contradictory-angle"
  | "unsupported-angle-shape"
  /**
   * **平面图形那一族的三分**（乙案 Task 4 / 设计 §5）。三种成因**各自一个码**，
   * 因为它们的处置完全不同 —— 混成一个码就等于把"下一步怎么办"也一起丢掉：
   *
   * - `underdetermined-planar`：条件不足以定形 ⇒ 说清**还缺哪一类**条件（缺定长 / 缺角）；
   * - `contradictory-planar`：条件互相不可能同时成立 ⇒ 说清**是哪两条、差多少**（含实测值）；
   * - `unsupported-planar-condition`：这一族还没有对应条件的构造器 ⇒ 如实说，并**列出认得哪几类**。
   *
   * **不许**把"构造不出"降级成"未核验"（那是两件事）；**不许**把"没找到"升级成"矛盾"。
   */
  | "underdetermined-planar"
  | "contradictory-planar"
  | "unsupported-planar-condition"
  | "missing-extrusion"
  | "degenerate-extrusion"
  | "non-finite-value"
  | "extreme-scale"
  | "invalid-input"

export interface WitnessConstructRejection {
  status: "rejected"
  code: WitnessConstructRejectionCode
  message: string
  /** 相关点名顶点（便于 trace / 面向用户定位）。 */
  detail?: { points?: string[]; diagnostics?: WitnessResidualDiagnostic[] }
}

export type WitnessConstructResult =
  | { status: "candidate"; witness: WitnessShapeCandidate }
  | WitnessConstructRejection

/** 底部默认比例：题面没有给尺寸时给"小整数、两条边**不相等**"的示例值。 */
const DEFAULT_FREE_BASE_WIDTH = 2
const DEFAULT_FREE_BASE_DEPTH = 3

/** 由侧棱求高时的下限：`L` 必须明显大于水平距离，否则高为零 / 无解。 */
const DEGENERATE_TOLERANCE = 1e-9

/**
 * 解析构造的入口：按 `shape` 分派。
 *
 * **不抛异常**（输入再离谱也只返回 `rejected`），**不改写输入**（只读 `request`）。
 * 入口先守住 `relations` 是数组（复核 round 1 Important 2）：2b 从题面适配时，
 * "关系还没抽出来"最可能的表现就是 `undefined`，而下游会无守卫地解引用它。
 */
export function constructWitnessShape(request: WitnessConstructRequest): WitnessConstructResult {
  if (!request || typeof request !== "object") return reject("invalid-input", "构造请求必须是一个对象。")
  if (!Array.isArray((request as { relations?: unknown }).relations)) {
    return reject("invalid-input", "构造请求的 relations 必须是数组。")
  }
  if (request.shape === "pyramid") return constructPyramidWitness(request)
  if (request.shape === "prism") return constructPrismWitness(request)
  if (request.shape === "frustum") return constructFrustumWitness(request)
  if (request.shape === "planar-figure") return constructPlanarWitness(request)
  return reject("invalid-input", `未知的图形族：${String((request as { shape?: unknown }).shape)}`)
}

/**
 * 高的来源**从 spec 自己的 relations 读回来**：题面点名 `PA=10` 这类定长侧棱时，
 * 编排层已经把它翻成 `segment-length`。于是**一份 spec 就够了** ——
 * 不必在 spec 之外再夹带一个 `WitnessHeightSpec`（那正是"同一个判断写两遍"的开端）。
 */
function heightSpecFromSpec(spec: SolidShapeSpec): WitnessHeightSpec {
  const apex = spec.apex?.at
  if (apex === undefined) return { kind: "free" }
  for (const relation of spec.relations) {
    if (relation.kind !== "segment-length" || typeof relation.value !== "number") continue
    const segment = relation.segments[0]
    if (segment === undefined || segment.length !== 2 || !segment.includes(apex)) continue
    const other = segment[0] === apex ? segment[1]! : segment[0]!
    return { kind: "lateral-edge", edge: [apex, other], length: relation.value }
  }
  /**
   * **二面角**（Task 13，2026-10-12）：题面给了二面角 ⇒ 高由它**求**，不是一个自由量。
   *
   * 这里原先只认"定长侧棱"，别的一律落到 `free` —— 于是**内核自己**那一支
   * `deriveApexHeight` 的 `dihedral` 分支（连它的单测都在）在整条产品路径上**够不着**：
   * 编排层就算把二面角翻成了 `dihedral` 关系，这里也读不出来，高照样自由取。
   * 实测症状：题面写 45° 与写 60°，候选量出来**都是 45.000**（高是那条自由标量给的）。
   */
  for (const relation of spec.relations) {
    if (relation.kind !== "dihedral") continue
    const plane = relation.segments.find((segment) => segment.includes(apex))
    if (plane === undefined) continue
    return { kind: "dihedral", angleRelation: plane.join("") }
  }
  return { kind: "free" }
}

/** 棱柱：题面点名的那条侧棱长度（`AA′=5`），`null` = 自由。 */
function statedLateralHeight(spec: SolidShapeSpec): number | null {
  const top = spec.top?.[0]
  if (top === undefined) return null
  for (const relation of spec.relations) {
    if (relation.kind !== "segment-length" || typeof relation.value !== "number") continue
    if ((relation.segments[0] ?? []).includes(top)) return relation.value
  }
  return null
}

/**
 * **题面有没有定住"高"**（棱锥看顶点那条定长侧棱，棱柱看侧棱长度）。
 *
 * 导出它是为了让**编排层**能问同一个问题（决定要不要把 `height` 列成自由标量），
 * 而不是各自再写一遍"`relations` 里有没有包含顶点的 `segment-length`" ——
 * 那正是本仓最忌讳的"同一个判断写两遍，然后两处慢慢分叉"。
 */
export function shapeHeightIsFree(spec: SolidShapeSpec): boolean {
  return spec.top !== undefined ? statedLateralHeight(spec) === null : heightSpecFromSpec(spec).kind === "free"
}

/**
 * **按 `SolidShapeSpec` 构造**（S2.1 内核侧）。
 *
 * 编排层从此只交两样东西：**形状描述**（spec）与**它替自由标量选定的值**（`ShapeScalarChoice`）。
 *
 * 为什么"取值 → 内核请求"这张翻译表**放在内核**：它整张都是内核自己的词汇
 * （`segment-length` 关系、`WitnessHeightSpec`、`WitnessExtrusionSpec` 的两种拉伸来源）。
 * 留在编排层等于让每个调用方各维护一份内核词汇表 —— 加一族形状就要改一遍，
 * 而设计 §3.2 的表里写着"加新形状时：**不改**"。
 *
 * 未知的标量 id **明确拒绝**（`invalid-input`），不凭空取值。
 */
export function constructShapeFromSpec(spec: SolidShapeSpec, choices: readonly ShapeScalarChoice[] = []): WitnessConstructResult {
  const relations: WitnessRelation[] = [...spec.relations]
  const chosen = new Map<string, number>()
  for (const choice of choices) {
    const scalar = spec.freeScalars.find((entry) => entry.id === choice.id)
    if (scalar === undefined) return reject("invalid-input", `自由标量 ${choice.id} 不在形状描述里，不能凭空取值。`, [...spec.base])
    chosen.set(scalar.id, choice.value)
    if (scalar.kind !== "base-edge") continue
    const [first, second] = scalar.targets
    if (first === undefined || second === undefined) {
      return reject("invalid-input", `底面边自由标量 ${scalar.id} 没有两个端点。`, [...spec.base])
    }
    relations.push({ kind: "segment-length", segments: [[first, second]], value: choice.value })
  }
  const heightScalar = spec.freeScalars.find((scalar) => scalar.kind === "height")
  const heightValue = heightScalar === undefined ? null : (chosen.get(heightScalar.id) ?? null)
  /**
   * **平面图形**（乙案 Task 3A）：这一族的坐标不在"底面 + 顶点 / 拉伸"那套词汇里，
   * 所以按 `family` 分派到自己的构造器。此前它落到下面那条棱锥支，
   * 被 `missing-apex` 拒掉（Task 3 第一步的探针读数，逐字如此）。
   */
  if (spec.family === "planar-figure") {
    return constructWitnessShape({ shape: "planar-figure", base: [...spec.base], relations })
  }
  if (spec.family === "prism") {
    /**
     * **直棱柱的拉伸是竖直向量**：题面写 `AA′⊥底面`，那正是"侧棱垂直于底面"的定义。
     * 内核的 `{kind:"points"}` 分支**按设计不可用**（底面顶点全在 z = 0，`to − from` 必落在底面内），
     * 所以这里只能给向量；高既没给定值又没扫到值时给 `{kind:"unknown"}` ——
     * 由本层**如实拒**成缺拉伸，而不是替题面猜一个高度。
     */
    const height = heightValue ?? statedLateralHeight(spec)
    if (height === null) {
      return constructWitnessShape({ shape: "prism", base: [...spec.base], relations, extrusion: { kind: "unknown" } })
    }
    /**
     * **斜棱柱**（S3）：题面说"斜"，斜向由入口层给（`spec.lateralTiltDegrees`，代表值）。
     *
     * 侧棱长度 = 拉伸向量的**模长**（与直棱柱同一个"高"的口径），方向 = 竖直方向朝 **+x** 倾
     * 该角度 —— 朝哪边斜本身也是题面没说的自由度，取 +x 作代表。`undefined` = 直棱柱（原路径逐字不变）。
     */
    const tilt = spec.lateralTiltDegrees
    const vector = tilt === undefined
      ? { x: 0, y: 0, z: height }
      : { x: height * Math.sin((tilt * Math.PI) / 180), y: 0, z: height * Math.cos((tilt * Math.PI) / 180) }
    const constructed = constructWitnessShape({ shape: "prism", base: [...spec.base], relations, extrusion: { kind: "vector", vector } })
    if (constructed.status !== "candidate" || tilt === undefined) return constructed
    /**
     * **代表斜向必须让用户看见**（与"系统自选"同一条纪律）：题面只说了"斜"，
     * 斜多少是系统定的 —— 写进 `freeValues`（那一列就是"系统替你定了什么"），不藏在代码里。
     *
     * **题面明说的倾角不算系统自选**（Task 13 边界，2026-10-14）：`lateralTiltSource === "stated"`
     * 时这一行**不写** —— 否则会把题面写明的条件谎报成"系统替你定的值"。
     */
    if (spec.lateralTiltSource === "stated") return constructed
    return {
      ...constructed,
      witness: {
        ...constructed.witness,
        freeValues: [`侧棱方向：题面只说「斜棱柱」，系统取代表斜向 —— 侧棱与底面法向成 ${formatNumber(tilt)}°、朝底面 +x 一侧倾斜。`, ...constructed.witness.freeValues]
      }
    }
  }
  if (spec.family === "frustum") {
    /**
     * **上下底的对应关系必须说得清**（S4.2）：题面给的顶环要能**逐一对应**到底环。
     *
     * 判据就是命名约定（`A′` 对应 `A`），与内核 `withPrimes` 派生顶面名的那条规则**同源**：
     * - 点数不同 ⇒ 说不清；
     * - 任一位对不上 ⇒ 说不清 —— **不按顺序硬配**。硬配正是"默认按顺序对应"那个老毛病：
     *   它会把 `ABCD-A′C′B′D′` 这种题面画成一张顶环错配的图，而且看起来还挺像那么回事。
     *
     * 说不清就**明确拒绝**，让用户看清是"名字对不上"，而不是给一张错图。
     */
    const declaredTop = spec.top
    if (declaredTop !== undefined) {
      if (declaredTop.length !== spec.base.length) {
        return reject(
          "unsupported-base-shape",
          `台体的顶环 ${declaredTop.join("、")} 与底环 ${spec.base.join("、")} 点数不同，上下底对应关系说不清。`,
          [...spec.base, ...declaredTop]
        )
      }
      for (const [index, name] of declaredTop.entries()) {
        const foot = spec.base[index]
        if (foot === undefined || canonicalPointName(name) !== `${canonicalPointName(foot)}′`) {
          return reject(
            "unsupported-base-shape",
            `台体顶面点名 ${name} 与底面点名 ${String(foot)} 对不上（约定是 ${String(foot)}′ 对应 ${String(foot)}）：本层不按顺序硬配。`,
            [...spec.base, ...declaredTop]
          )
        }
      }
    }
    /**
     * 台体的**高只从自由标量取**。题面若点名侧棱长度（`AA′=5`），那个长度**不等于高** ——
     * 侧棱还带水平分量（`√(h² + (1−k)²r²)`），要与相似比联立才能解出高。
     * 本批不做这个联立，于是**如实拒绝**，绝不把侧棱长当成高用（那会画出一个错的台体还自称通过）。
     */
    if (statedLateralHeight(spec) !== null) {
      return reject("unsupported-base-shape", "台体这一批不收「给定侧棱长度」的题面：侧棱长与高、相似比是联立关系，本层不做这个求解。", [...spec.base])
    }
    const ratioScalar = spec.freeScalars.find((scalar) => scalar.kind === "top-scale")
    const ratio = ratioScalar === undefined ? null : (chosen.get(ratioScalar.id) ?? null)
    if (ratio === null) return reject("missing-extrusion", "台体的相似比未由编排层给出：首批不做通用猜测。", [...spec.base])
    if (heightValue === null) return reject("missing-extrusion", "台体的高未由编排层给出：首批不做通用猜测。", [...spec.base])
    return constructFrustumWitness({
      shape: "frustum",
      base: [...spec.base],
      relations,
      extrusion: { kind: "vector", vector: { x: 0, y: 0, z: heightValue } },
      scale: ratio
    })
  }
  const apex = spec.apex
  if (apex === undefined) return reject("missing-apex", "棱锥的形状描述里没有顶点。", [...spec.base])
  const stated = heightSpecFromSpec(spec)
  const height: WitnessHeightSpec = heightValue === null || stated.kind !== "free" ? stated : { kind: "free", value: heightValue }
  return constructWitnessShape({
    shape: "pyramid",
    base: [...spec.base],
    apex: { at: apex.at, foot: apex.foot ?? spec.base[0] ?? apex.at, height },
    relations
  })
}

export function constructPyramidWitness(request: PyramidConstructRequest): WitnessConstructResult {
  const base = validateNames(request.base, "底面")
  if (base.status === "rejected") return base
  if (!Array.isArray(request.relations)) {
    return reject("invalid-input", "棱锥请求的 relations 必须是数组。", base.names)
  }
  if (!request.apex || typeof request.apex.at !== "string" || request.apex.at.length === 0) {
    return reject("missing-apex", "棱锥题面点名了顶点，但请求里没有给出顶点名。")
  }
  const apexName = request.apex.at
  if (base.names.includes(apexName)) {
    return reject("duplicate-name", `顶点 ${apexName} 与底面顶点重名，无法区分。`, [apexName])
  }
  const foot = request.apex.foot ?? base.names[0]
  if (!base.names.includes(foot)) {
    return reject("missing-height-reference", `垂足 ${foot} 不是底面环上的点名顶点。`, [foot])
  }

  const derived = deriveBasePolygon(base.names, request.relations)
  if (derived.status === "rejected") return derived
  const baseResiduals = polygonResiduals(derived.polygon)
  if (baseResiduals.diagnostics.length > 0) return rejectFromDiagnostics(baseResiduals.diagnostics, base.names)

  const height = deriveApexHeight({
    apexName,
    foot,
    heightSpec: request.apex.height ?? { kind: "free" },
    relations: request.relations,
    base: derived.polygon,
    baseNames: base.names
  })
  if (height.status === "rejected") return height
  const { value: heightValue, note: heightNote, assumed: heightAssumed, derived: heightDerived } = height

  const footIndex = base.names.indexOf(foot)
  const footPoint = derived.polygon[footIndex]
  const apexPoint: Vector3 = { x: footPoint.x, y: footPoint.y, z: footPoint.z + heightValue }

  /**
   * 用户可见文案必须**如实**说明高是怎么来的（复核 round 1 Important 1 + round 2 Minor D）。
   *
   * 三路各说各的：
   * - `free`：系统自选示例值；
   * - `fixed`：**题面直接给定**（没有任何求解 —— 早先它被归进"由题面条件解析求出"，不实）；
   * - `dihedral`：**有界求根**，不是解析闭式（早先这里一律写"解析求出"，把数值求根说成解析求解）。
   * - `lateral-edge`：解析闭式 `h = √(L² − d²)`。
   */
  const heightOrigin = heightAssumed
    ? "（系统自选示例值）"
    : heightDerived === "dihedral"
      ? `（按题面二面角对内核的二面角度量做有界求根求出，非解析闭式${heightNote ? `；${heightNote}` : ""}）`
      : heightDerived === "planar-angle"
        ? `（按题面点名的角对内核自己的角度量做有界求根求出，非解析闭式${heightNote ? `；${heightNote}` : ""}）`
        : heightDerived === "lateral-edge"
          ? "（由题面的侧棱长度解析求出）"
          : "（题面直接给定）"

  return assembleCandidate({
    baseNames: base.names,
    basePoints: derived.polygon,
    extraNames: [apexName],
    extraPoints: [apexPoint],
    apex: true,
    freeValues: [...derived.freeValues, ...(heightNote ? [heightNote] : [])],
    assumptions: [
      ...derived.assumptions,
      `顶点 ${apexName} 取在垂足 ${foot} 正上方、高 ${formatNumber(heightValue)}${heightOrigin}。`
    ]
  })
}
export function constructPrismWitness(request: PrismConstructRequest): WitnessConstructResult {
  const base = validateNames(request.base, "底面")
  if (base.status === "rejected") return base
  if (!Array.isArray(request.relations)) {
    return reject("invalid-input", "棱柱请求的 relations 必须是数组。", base.names)
  }

  /**
   * 拉伸向量的守卫**先于**底面解析：题面根本没给拉伸向量时，"底面是什么形状"还不是问题，
   * 先报 `missing-extrusion` 才是准确的理由（否则一条无关的 `unsupported-base-shape` 会把它盖掉）。
   */
  const extrusionSpec = request.extrusion
  if (!extrusionSpec || extrusionSpec.kind === "unknown") {
    return reject(
      "missing-extrusion",
      "棱柱的拉伸向量未由题面给出：首批不做通用猜测，交给编排层的有界网格决定。",
      base.names
    )
  }
  /**
   * 字段守卫（复核 round 1 Important 2）：类型合法但 `vector` 缺失 / 不是向量时，
   * 直接交给 `isFiniteVector` 会抛 `TypeError` —— 而本模块的契约是"拒绝是值不是异常"。
   */
  if (extrusionSpec.kind === "vector") {
    const maybeVector = (extrusionSpec as { vector?: unknown }).vector
    if (!maybeVector || typeof maybeVector !== "object" || !isFiniteVector(maybeVector as Vector3)) {
      return reject("invalid-input", "拉伸向量 spec 缺少有限的 vector 字段。", base.names)
    }
  }

  const derived = deriveBasePolygon(base.names, request.relations)
  if (derived.status === "rejected") return derived
  const baseResiduals = polygonResiduals(derived.polygon)
  if (baseResiduals.diagnostics.length > 0) return rejectFromDiagnostics(baseResiduals.diagnostics, base.names)

  let vector: Vector3
  if (extrusionSpec.kind === "vector") {
    vector = extrusionSpec.vector
  } else {
    if (!base.names.includes(extrusionSpec.from) || !base.names.includes(extrusionSpec.to)) {
      return reject("missing-height-reference", `拉伸向量的端点 ${extrusionSpec.from} / ${extrusionSpec.to} 不是底面环上的点名顶点。`, [extrusionSpec.from, extrusionSpec.to])
    }
    vector = subtractVector3(derived.polygon[base.names.indexOf(extrusionSpec.to)], derived.polygon[base.names.indexOf(extrusionSpec.from)])
  }
  if (!isFiniteVector(vector)) return reject("non-finite-value", "拉伸向量的分量必须是有限数值。", base.names)

  const normal = polygonNormal(derived.polygon)
  if (!normal) return reject("degenerate-base", "底面没有非零面积的平面法向，拉不出实体。", base.names)
  const vectorLength = lengthVector3(vector)
  const scale = Math.max(polygonDiameter(derived.polygon), vectorLength)
  if (vectorLength <= scale * DEGENERATE_TOLERANCE) {
    return reject("degenerate-extrusion", `拉伸向量长度为 ${vectorLength}，拉不出实体。`, base.names)
  }
  if (Math.abs(dotVector3(vector, normal)) <= DEGENERATE_TOLERANCE * vectorLength * lengthVector3(normal)) {
    return reject("degenerate-extrusion", "拉伸向量平行于底面，得到的是零体积平片而不是棱柱。", base.names)
  }

  /**
   * 顶面**严格**是底面的平移：`T_i = B_i + v`。不加任何"错开"偏移 ——
   * 棱柱的定义就是全等平移，偏移会同时破坏 `T_i = B_i + v` 与"底棱 ∥ 顶棱且等长"。
   * "顶面顶点恰好与别处重合"这种退化由 `residuals.ts` 的边长 / 长宽比判据兜住。
   */
  const topPoints = derived.polygon.map((point) => ({
    x: point.x + vector.x,
    y: point.y + vector.y,
    z: point.z + vector.z
  }))

  /**
   * **造不出顶面点名就明确拒绝**（不是硬拼一个词表外的名字）。
   *
   * 走到这里意味着底面点名把该字母的一层与两层后缀**全占满了** —— 罕见，但一旦发生，
   * 硬拼 `A′2` 这种名字的后果是核验器判整张表不可靠、用户拿到一张永远核验不了的图。
   * 明确拒绝好过那样。
   */
  const extraNames = withPrimes(base.names)
  if (extraNames === null) {
    return reject(
      "unsupported-base-shape",
      `底面点名 ${base.names.join("、")} 占满了可用的后缀组合（一个字母 + 至多两个后缀），顶面无法在不重名的前提下命名。`,
      [...base.names]
    )
  }

  return assembleCandidate({
    baseNames: base.names,
    basePoints: derived.polygon,
    extraNames,
    extraPoints: topPoints,
    apex: false,
    freeValues: derived.freeValues,
    assumptions: [
      ...derived.assumptions,
      `顶面由底面沿向量 (${formatNumber(vector.x)}, ${formatNumber(vector.y)}, ${formatNumber(vector.z)}) 平移得到（棱柱定义）。`
    ]
  })
}

/**
 * **台体**（S4）：把棱柱的"纯平移"换成"**按质心相似缩小 + 平移**"。
 *
 * 与棱柱共用同一套守卫（拉伸向量先于底面判、退化判据、顶面命名的词表纪律），只多一条台体自己的：
 * **相似比必须严格落在 `(0, 1)` 内** —— `1` 是棱柱、`0` 是棱锥顶点，两个端点都**不是**台体。
 *
 * 相似中心取**质心**而不是环首点：换一个环首不应该改变这张图（同一个台体）。
 */
export function constructFrustumWitness(request: FrustumConstructRequest): WitnessConstructResult {
  const base = validateNames(request.base, "底面")
  if (base.status === "rejected") return base
  if (!Array.isArray(request.relations)) {
    return reject("invalid-input", "台体请求的 relations 必须是数组。", base.names)
  }
  const ratio = request.scale
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || !(ratio > 0) || !(ratio < 1)) {
    return reject(
      "invalid-input",
      `台体的相似比必须严格在 (0, 1) 内（收到 ${String(ratio)}）：1 是棱柱、0 是棱锥顶点，两个端点都不是台体。`,
      base.names
    )
  }
  const extrusionSpec = request.extrusion
  if (!extrusionSpec || extrusionSpec.kind === "unknown") {
    return reject("missing-extrusion", "台体的高未由题面给出：首批不做通用猜测，交给编排层的有界网格决定。", base.names)
  }
  if (extrusionSpec.kind === "vector") {
    const maybeVector = (extrusionSpec as { vector?: unknown }).vector
    if (!maybeVector || typeof maybeVector !== "object" || !isFiniteVector(maybeVector as Vector3)) {
      return reject("invalid-input", "拉伸向量 spec 缺少有限的 vector 字段。", base.names)
    }
  }

  const derived = deriveBasePolygon(base.names, request.relations)
  if (derived.status === "rejected") return derived
  const baseResiduals = polygonResiduals(derived.polygon)
  if (baseResiduals.diagnostics.length > 0) return rejectFromDiagnostics(baseResiduals.diagnostics, base.names)

  if (extrusionSpec.kind !== "vector") {
    /**
     * 台体**不收** `{kind:"points"}`：那两个端点都在底面环上，而内核把底面一律建在 z = 0，
     * 差向量必落在底面内 —— 与棱柱那条"首批边界"同源。如实拒绝，不猜一个高。
     */
    return reject("unsupported-base-shape", "台体的高需要编排层给出向量：`{kind:\"points\"}` 的两个端点都在底面环上，差向量落在底面内。", base.names)
  }
  const vector = extrusionSpec.vector
  if (!isFiniteVector(vector)) return reject("non-finite-value", "拉伸向量的分量必须是有限数值。", base.names)
  const normal = polygonNormal(derived.polygon)
  if (!normal) return reject("degenerate-base", "底面没有非零面积的平面法向，拉不出实体。", base.names)
  const vectorLength = lengthVector3(vector)
  const diameter = Math.max(polygonDiameter(derived.polygon), vectorLength)
  if (vectorLength <= diameter * DEGENERATE_TOLERANCE) {
    return reject("degenerate-extrusion", `台体的高为 ${vectorLength}：两底重合，不是台体。`, base.names)
  }
  if (Math.abs(dotVector3(vector, normal)) <= DEGENERATE_TOLERANCE * vectorLength * lengthVector3(normal)) {
    return reject("degenerate-extrusion", "拉伸向量平行于底面：台体的两底必须平行且不共面。", base.names)
  }

  const count = derived.polygon.length
  const sums = derived.polygon.reduce<Vector3>((total, point) => ({ x: total.x + point.x, y: total.y + point.y, z: total.z + point.z }), { x: 0, y: 0, z: 0 })
  const centroid: Vector3 = { x: sums.x / count, y: sums.y / count, z: sums.z / count }
  const extraPoints = derived.polygon.map((point) => ({
    x: centroid.x + (point.x - centroid.x) * ratio + vector.x,
    y: centroid.y + (point.y - centroid.y) * ratio + vector.y,
    z: centroid.z + (point.z - centroid.z) * ratio + vector.z
  }))

  const extraNames = withPrimes(base.names)
  if (extraNames === null) {
    return reject(
      "unsupported-base-shape",
      `底面点名 ${base.names.join("、")} 占满了可用的后缀组合（一个字母 + 至多两个后缀），顶面无法在不重名的前提下命名。`,
      [...base.names]
    )
  }

  return assembleCandidate({
    baseNames: base.names,
    basePoints: derived.polygon,
    extraNames,
    extraPoints,
    apex: false,
    freeValues: derived.freeValues,
    assumptions: [
      ...derived.assumptions,
      `顶面是底面按**质心**相似缩小 ${formatNumber(ratio)} 倍、再沿向量 (${formatNumber(vector.x)}, ${formatNumber(vector.y)}, ${formatNumber(vector.z)}) 平移得到的平行截面（台体定义）。`
    ]
  })
}

/**
 * 平面构造的**度量容差**：与 `residuals.ts` 的相对容差同一个数量级（那里是 `1e-9`）。
 *
 * 它是"构造器自己回代"这一关的判据，**不是**题设验收（那一关只有统一核验器）。
 * 取 1e-9 是因为闭式构造算出来的量与题面值之间只差浮点噪声（1e-15 量级），
 * 而任何真的"对不上"都远大于它。
 */
const PLANAR_METRIC_TOLERANCE = 1e-9

/**
 * 平面构造里**角的容差**（度）。
 *
 * 核验器用的是 `1e-3` 度（`diagramVerification` 的 `ANGLE_TOLERANCE_DEGREES`）。
 * 构造器这一关取 `1e-6` —— 比核验器更严：**回代通过 ⇒ 核验器也会通过**，
 * 而不是反过来让构造器放行一个核验器要拒的坐标。
 */
const PLANAR_ANGLE_TOLERANCE_DEGREES = 1e-6

/** 多解组合的上限：`±` 两支逐点展开，环再长也不该出现组合爆炸；到顶即停，不静默截断。 */
const PLANAR_MAX_PLACEMENTS = 64

/** 一个点名在 `z = 0` 上的位置。平面构造全程只用两个分量，第三个恒为 `0`。 */
interface PlanarPosition {
  x: number
  y: number
}

/**
 * **一次"落位"的规则**：把某个还没定出位置的点名定出来。两种来源（设计 §4 的"能闭式解的就闭式解"）：
 *
 * 1. `angle`：顶点处**点名的角** + 一条定长边 —— 把 `point` 放在与 `reference` 成 `degrees` 的方向上；
 * 2. `distances`：到两个**已落位**点的定长 —— 两圆交点。
 *
 * 角的两支给出的是**同一个无向角**（`∠` 是 `(0°,180°)` 的内部角），所以"取哪一支"不能靠角本身判，
 * 只能靠**逐条回代 + 不许自交**判 —— 见 `constructPlanarWitness`。
 */
type PlanarPlacementRule =
  | { kind: "angle"; point: string; vertex: string; reference: string; degrees: number; distance: number }
  | { kind: "distances"; point: string; first: string; firstDistance: number; second: string; secondDistance: number }
  /**
   * **SSA：角给方向、另一条到已定点的定长给距离**（Task 11，2026-10-12）。
   *
   * `AB=8，∠BAC=30°，BC=4` 这种"两边一对角、角不在两边之间"的题面：
   * 角只给出一条**射线**，而 `BC` 给一个**圆** —— 射线与圆相交**最多两解**。
   * 这正是调研 §3.2 那句"多解与边界是常态"在构造侧的落点。
   *
   * 在这条规则之前，这一层只会"角 + **那条臂**的定长"或"两条到已定点的定长"，
   * 于是 SSA 被报成 `underdetermined-planar`（"缺一条定长 AC"）——
   * **那句话是假话**：AC 由另外三条算得出来。
   */
  | { kind: "ray-circle"; point: string; vertex: string; reference: string; degrees: number; center: string; radius: number }

/** 定长边的键（与 `statedLength` 的 `sameSegment` 同一口径：顺序无关）。 */
function planarSegmentKey(first: string, second: string): string {
  return [first, second].sort().join("|")
}

/**
 * **由度量条件构造平面图形**（乙案 Task 3A / 设计 §4）。
 *
 * 读数在先（Task 0 的探针实测）：那句题面的五条条件按"先放 `A` 在原点、`AB` 沿 `x` 轴，
 * 再定 `D`、再定 `C`"的顺序闭式解出，逐条回代全过；`C` 由 `∠ADC=90°` 与 `CD=3` 定出**两个**解，
 * 只有 `(9, √3)` 不自交。所以这一支的规则是：
 *
 * 1. **先定形、再落位**：`A` 在原点、`AB` 沿 `+x`（坐标系的规范取法，不改变图形）；
 * 2. 之后**逐点**用 `PlanarPlacementRule` 的两条规则定出来，每条多解就**分支**；
 * 3. 每一条走到底的组合都要**按最终坐标逐条回代**（题面条件一条都不许漏）——
 *    "构造出来了" ≠ "满足题设"，构造器这一关只做自检，权威判据仍是统一核验器；
 * 4. 回代通过的组合里**只有不自交的**才可用（除相邻边外不许有边相交）—— 这正是那句题面里
 *    `C` 两个解的取舍判据（设计 §4 实测：恰好留下一个）；
 * 5. 仍有多组时取**第一组**，并把"有几组"写进 `assumptions`，不静默挑一个。
 *
 * **明确不做**（设计 §9 的红线）：不引入通用非线性求解器；闭式拿不到的条件一律**如实拒绝**，
 * 不猜一个形状出来。
 */
export function constructPlanarWitness(request: PlanarFigureConstructRequest): WitnessConstructResult {
  const ring = validateNames(request.base, "图形")
  if (ring.status === "rejected") return ring
  if (!Array.isArray(request.relations)) return reject("invalid-input", "平面图形请求的 relations 必须是数组。", ring.names)
  const names = ring.names

  /**
   * **只收三类条件**（定长边、点名的角、面积）。其余（平行 / 垂直 / 等长 / 二面角…）
   * 本层**还没有对应的构造** —— 如实说"这一族还没有构造器"、**列出它认得哪几类**，
   * 而不是收下之后当它不存在（设计 §5 的第三种成因）。
   *
   * **面积是 Task 11 加进来的第三类**（2026-10-12）：它在构造里的作用是
   * "把一条自由的臂定下来"（见 `planarRuleFromArea`），所以它**有**构造器，不该再被这一关拒掉。
   */
  const unsupported = request.relations.find((relation) => relation.kind !== "segment-length" && relation.kind !== "planarAngle" && relation.kind !== "area")
  if (unsupported !== undefined) {
    return reject(
      "unsupported-planar-condition",
      `平面图形：条件「${planarConditionName(unsupported)}」这一族还没有构造器 —— 它目前只认得三类条件：定长（形如 AB=8）、点名的角（形如 ∠BAD=30°）与面积（形如 △ABC 的面积为 6）。请改用这几类条件，或换一条能表达它的路径。`,
      [...names]
    )
  }
  /** 环外的点名不进这一族：环是这一族的形状本身，环外的点属于别的阶段（例如折）。 */
  for (const relation of request.relations) {
    const targets: readonly string[] = relation.kind === "segment-length" ? relation.segments.flat() : relation.kind === "planarAngle" ? [...relation.targets] : []
    const outside = targets.find((name) => !names.includes(name))
    if (outside !== undefined) {
      return reject("unsupported-angle-shape", `平面图形的条件里点名了环外的点 ${outside}：环外的点不属于这一族。`, [...names])
    }
  }
  /** 角的度数守卫：内部角必须落在 `(0°, 180°)`（两个端点都是退化）。 */
  for (const relation of request.relations) {
    if (relation.kind !== "planarAngle") continue
    const stated = interpretValue(relation.value, null)
    if (stated === null) return reject("unsupported-angle-shape", `点名的角 ${relation.targets.join("")} 没有可用的度数。`, [...names])
    if (!(stated.value > 0) || stated.value >= 180) {
      return reject("degenerate-base", `点名的角 ${relation.targets.join("")} 是 ${formatNumber(stated.value)}°：内部角必须在 0° 与 180° 之间（0 与 180 都是退化）。`, [...names])
    }
  }

  /**
   * **环首边必须由题面给定**：它是"先定形"那一步的尺度来源。没给就**不猜一个尺度** ——
   * 那会让"题面没说"悄悄变成一个系统自选的数，而用户看不见（与 `freeScalars` 为空的理由同源）。
   */
  const start = names[0]!
  const second = names[1]!
  const firstEdge = statedLength(request.relations, [start, second])
  if (firstEdge.kind === "invalid") return firstEdge.rejection
  if (firstEdge.kind !== "value" || !(firstEdge.stated.value > 0)) {
    return reject("unsupported-base-shape", `平面图形的环首边 ${start}${second} 没有给定长度：这一支不猜尺度。`, [...names])
  }
  const initial = new Map<string, PlanarPosition>([
    [start, { x: 0, y: 0 }],
    [second, { x: firstEdge.stated.value, y: 0 }]
  ])

  /**
   * **分支枚举**：逐点用 `planarNextStep` 找一条能把下一个点定出来的规则，多解就展开。
   * 先序展开、选项按"正转在前"排，所以**同一份输入永远得到同一个顺序**（确定性）。
   *
   * 两种走不下去的形态**分开记**（Task 4 的失败三分靠它）：
   * - 这个点**一条规则都用不上** ⇒ 条件不足以定形（欠定）；
   * - 有规则但**一个解都没有**（两条定长的两个圆不相交）⇒ 这几条条件不可能同时成立（矛盾）。
   */
  const placements: Array<Map<string, PlanarPosition>> = []
  const stalled: Array<Map<string, PlanarPosition>> = []
  let blockedWithoutSolution = 0
  const walk = (positions: Map<string, PlanarPosition>): void => {
    if (placements.length >= PLANAR_MAX_PLACEMENTS) return
    const step = planarNextStep(positions, names, request.relations)
    if (step === null) {
      placements.push(new Map(positions))
      return
    }
    if (step.kind === "blocked") {
      if (step.hadRule) blockedWithoutSolution += 1
      if (stalled.length < 8) stalled.push(new Map(positions))
      return
    }
    for (const option of step.options) {
      const next = new Map(positions)
      next.set(step.rule.point, option)
      walk(next)
    }
  }
  walk(initial)

  if (placements.length === 0) {
    const conflict = planarDirectConflict(request.relations)
    if (conflict !== null) return reject("contradictory-planar", planarConflictMessage(conflict), [...names])
    if (blockedWithoutSolution > 0) {
      return reject(
        "contradictory-planar",
        `平面图形：按题面已点名的条件（两条定长、或一个角加一条定长）去解，顶点 ${names.filter((name) => !(stalled[0] ?? initial).has(name)).join("、")} 的位置解不出来 —— 这几条条件互相不可能同时成立。`,
        [...names]
      )
    }
    return reject("underdetermined-planar", planarUnderdeterminedMessage(stalled[0] ?? initial, names, request.relations), [...names])
  }

  /** **逐条回代**：用最终坐标逐条量一遍题面条件，一条对不上就不要这一组。 */
  const consistent = placements.filter((positions) => planarRelationsHold(positions, names, request.relations))
  if (consistent.length === 0) {
    const conflict = planarDirectConflict(request.relations)
    if (conflict !== null) return reject("contradictory-planar", planarConflictMessage(conflict, placements[0]), [...names])
    return reject("contradictory-planar", planarResidualMessage(placements[0]!, names, request.relations), [...names])
  }

  /**
   * **不许自交**（设计 §4）：`C` 的两个解里只有一个不自交，而两个解都满足那五条条件 ——
   * 所以这一条判据是真在起作用的那一条，不是装饰。判据与 `buildFromPoints` 对每个面环用的
   * 是**同一个** `hasSelfIntersectingPolygon`：各写一份就会"构造器说不自交、拓扑检查说自交"。
   */
  const simple = consistent.filter((positions) => !hasSelfIntersectingPolygon(names.map((name) => planarPoint3(positions, name))))
  if (simple.length === 0) {
    return reject("degenerate-base", `平面图形：满足全部条件的 ${consistent.length} 组坐标都是自交的多边形（除相邻边外还有边相交），这一支取不到可用的图形。`, [...names])
  }

  const chosen = simple[0]!
  const points = names.map((name) => planarPoint3(chosen, name))
  const assumptions = [
    `平面图形 ${names.join("")} 的坐标由题面条件构造：${start} 取在原点、${start}${second} 沿 +x 轴（这两条是坐标系的规范取法，不改变图形）。`,
    `第一个由角定出的顶点取**正转**那一侧；镜像的那一支与它全等，取哪一侧是坐标约定。`
  ]
  if (simple.length > 1) assumptions.push(`满足全部条件的坐标有 ${simple.length} 组，系统取第一组（各组都满足题面，差别只在镜像 / 另一支）。`)
  if (consistent.length > simple.length) assumptions.push(`另有 ${consistent.length - simple.length} 组坐标也满足全部条件，但它们是自交多边形，已按「不许自交」排除。`)
  return assemblePlanarCandidate({ ringNames: names, points, freeValues: [], assumptions })
}

/** 平面位置 → 空间点（`z = 0`）。平面这一族全程在同一个平面上，所以只有一个入口做这件事。 */
function planarPoint3(positions: ReadonlyMap<string, PlanarPosition>, name: string): Vector3 {
  const position = positions.get(name)
  return { x: position?.x ?? Number.NaN, y: position?.y ?? Number.NaN, z: 0 }
}

/**
 * **下一步怎么走**：环顺序找第一个"能用规则定出来"的点。
 *
 * 三种结局：
 * - `step`：定得出来（可能多解）；
 * - `blocked` 且 `hadRule`：**有规则但一个解都没有**（两条定长的两个圆不相交）⇒ 这几条条件不可能同时成立；
 * - `blocked` 且没有规则：这个点没有任何条件能定出来 ⇒ 条件不足以定形。
 *
 * 顺序是刻意的：**环顺序**决定先定哪个点，规则顺序（角优先、再到两段定长）决定用哪条 ——
 * 两处都固定，所以同一份条件永远得到同一个解。
 */
function planarNextStep(
  positions: ReadonlyMap<string, PlanarPosition>,
  names: readonly string[],
  relations: readonly WitnessRelation[]
): { kind: "step"; rule: PlanarPlacementRule; options: PlanarPosition[] } | { kind: "blocked"; hadRule: boolean } | null {
  /** `hadRule` 收在整个环上：只要**有一个**没定出的点"有规则但解不出来"，就是条件互相矛盾。 */
  let blockedHadRule = false
  for (const point of names) {
    if (positions.has(point)) continue
    let hadRule = false
    for (const rule of planarRulesFor(point, positions, relations)) {
      hadRule = true
      const options = planarRuleOptions(rule, positions)
      /** 一条规则无解**不挡**别的规则：由"有没有任何一条规则给得出解"决定能不能定出来。 */
      if (options.length > 0) return { kind: "step", rule, options }
    }
    /** 这个点定不出来**也不停**：环里别的点可能还能定（`D` 定完 `C` 才有条件，反之亦然）。 */
    if (hadRule) blockedHadRule = true
  }
  /** 全都落位了 ⇒ 这一步走完了（环里没有重复点名，所以"落位数 = 环长"就是全落位）。 */
  if (positions.size === names.length) return null
  return { kind: "blocked", hadRule: blockedHadRule }
}

/** 一个还没落位的点**能用的全部规则**（顺序固定：角优先，再到两段定长）。 */
function planarRulesFor(
  point: string,
  positions: ReadonlyMap<string, PlanarPosition>,
  relations: readonly WitnessRelation[]
): PlanarPlacementRule[] {
  const rules: PlanarPlacementRule[] = []
  const fromAngle = planarRuleFromAngle(point, positions, relations)
  if (fromAngle !== null) rules.push(fromAngle)
  /**
   * **面积排在角之后、两段定长之前**（Task 11）。顺序固定 ⇒ 同一份条件永远同一个解；
   * 而"面积那条给出的正是角那条缺的那个长度"，所以它在角之后恰好补上。
   */
  const fromArea = planarRuleFromArea(point, positions, relations)
  if (fromArea !== null) rules.push(fromArea)
  /**
   * **SSA 排在最后**（Task 11）：它是"角 + 别的点给的距离"，比前几条**弱** ——
   * 前几条能用时不该轮到它（顺序固定 ⇒ 同一份条件永远同一个解）。
   */
  const fromAngleAndDistance = planarRuleFromAngleAndDistance(point, positions, relations)
  if (fromAngleAndDistance !== null) rules.push(fromAngleAndDistance)
  const fromDistances = planarRuleFromDistances(point, positions, relations)
  if (fromDistances !== null) rules.push(fromDistances)
  return rules
}

/** 规则之一：顶点处**点名的角**（另一条臂已落位）+ 一条**定长**边。两支解，见 `planarRuleOptions`。 */
function planarRuleFromAngle(
  point: string,
  positions: ReadonlyMap<string, PlanarPosition>,
  relations: readonly WitnessRelation[]
): PlanarPlacementRule | null {
  for (const relation of relations) {
    if (relation.kind !== "planarAngle" || relation.targets.length !== 3) continue
    const [first, vertex, third] = relation.targets as [string, string, string]
    if (!positions.has(vertex)) continue
    const reference = first === point ? third : third === point ? first : null
    if (reference === null || !positions.has(reference)) continue
    const stated = interpretValue(relation.value, null)
    if (stated === null) continue
    const distance = statedLength(relations, [vertex, point])
    if (distance.kind !== "value" || !(distance.stated.value > 0)) continue
    return { kind: "angle", point, vertex, reference, degrees: stated.value, distance: distance.stated.value }
  }
  return null
}

/**
 * **规则之三：面积**（Task 11，2026-10-12）。
 *
 * `面积 = ½ · |底| · |臂| · sin(夹角)` ⇒ 已知底、已知夹角、已知面积时，**臂长唯一**：
 * `|臂| = 2·面积 / (|底| · sin(夹角))`。算出来的臂长与那个角正好是"角那一支规则"要的两样东西，
 * 所以这里**返回一条角规则**（`kind: "angle"`），而不是另造一种规则形状 ——
 * 形状只有一种，判据才不会分叉（本仓反复吃亏的那件事）。
 *
 * **为什么需要它**：题面常写"两边一角 + 面积"，而面积那一条其实**把第三条边定死了**；
 * 没有这条规则时那个点会被判成 `underdetermined-planar`（欠定），而题面给的信息明明够。
 *
 * 三处一致性检查都不省：面积与角必须说**同一只三角形**、顶点必须已落位、底不能是零长。
 */
function planarRuleFromArea(
  point: string,
  positions: ReadonlyMap<string, PlanarPosition>,
  relations: readonly WitnessRelation[]
): PlanarPlacementRule | null {
  for (const area of relations) {
    if (area.kind !== "area" || area.targets.length !== 3 || !area.targets.includes(point)) continue
    const statedArea = interpretValue(area.value, null)
    if (statedArea === null || !(statedArea.value > 0)) continue
    const others = area.targets.filter((name) => name !== point)
    if (others.length !== 2 || !others.every((name) => positions.has(name))) continue
    for (const angle of relations) {
      if (angle.kind !== "planarAngle" || angle.targets.length !== 3) continue
      const [armA, vertex, armB] = angle.targets as [string, string, string]
      // 顶点必须**已落位**（才谈得上以它量臂），而且不能就是待求的那个点。
      if (!positions.has(vertex) || vertex === point) continue
      const arms = [armA, armB]
      if (!arms.includes(point)) continue
      const reference = arms[0] === point ? arms[1]! : arms[0]!
      if (!positions.has(reference)) continue
      if (![point, vertex, reference].every((name) => area.targets.includes(name))) continue
      const statedAngle = interpretValue(angle.value, null)
      if (statedAngle === null) continue
      const base = Math.hypot(positions.get(vertex)!.x - positions.get(reference)!.x, positions.get(vertex)!.y - positions.get(reference)!.y)
      const sine = Math.abs(Math.sin((statedAngle.value * Math.PI) / 180))
      if (!(base > 1e-12) || !(sine > 1e-12)) continue
      const distance = (2 * statedArea.value) / (base * sine)
      if (!(distance > 0) || !Number.isFinite(distance)) continue
      return { kind: "angle", point, vertex, reference, degrees: statedAngle.value, distance }
    }
  }
  return null
}

/**
 * **规则之四：SSA（角 + 另一条到已定点的定长）**（Task 11，2026-10-12）。
 *
 * 两条前提都不省：
 * - 角那条臂的**定长必须没有** —— 有的话规则二已经给出唯一解，轮不到这一条（顺序即判据）；
 * - 距离必须来自**另一个已落位点**（不是角的顶点，那又变成规则二）。
 *
 * 满足时就交给 `ray-circle`：射线与圆相交 ⇒ 0 / 1 / 2 个解，多解**照实分支**
 *（核验器随后会逐条量，选中的那一支必须自己满足全部题设）。
 */
function planarRuleFromAngleAndDistance(
  point: string,
  positions: ReadonlyMap<string, PlanarPosition>,
  relations: readonly WitnessRelation[]
): PlanarPlacementRule | null {
  for (const angle of relations) {
    if (angle.kind !== "planarAngle" || angle.targets.length !== 3) continue
    const [armA, vertex, armB] = angle.targets as [string, string, string]
    if (!positions.has(vertex) || vertex === point) continue
    const arms = [armA, armB]
    if (!arms.includes(point)) continue
    const reference = arms[0] === point ? arms[1]! : arms[0]!
    if (!positions.has(reference)) continue
    // 角那条臂已经有定长 ⇒ 规则二管，这一条不抢。
    if (statedLength(relations, [vertex, point]).kind === "value") continue
    const statedAngle = interpretValue(angle.value, null)
    if (statedAngle === null) continue
    for (const other of relations) {
      if (other.kind !== "segment-length") continue
      for (const segment of other.segments) {
        const pair = segmentOf(segment)
        if (pair === null) continue
        const center = pair[0] === point ? pair[1] : pair[1] === point ? pair[0] : null
        // 端点就是角的顶点 ⇒ 那是规则二（角 + 那条臂），不是 SSA。
        if (center === null || center === vertex || !positions.has(center)) continue
        const stated = interpretValue(other.value, null)
        if (stated === null || !(stated.value > 0)) continue
        return { kind: "ray-circle", point, vertex, reference, degrees: statedAngle.value, center, radius: stated.value }
      }
    }
  }
  return null
}

/** 规则之二：到两个**已落位**点的定长（两圆交点）。 */function planarRuleFromDistances(
  point: string,
  positions: ReadonlyMap<string, PlanarPosition>,
  relations: readonly WitnessRelation[]
): PlanarPlacementRule | null {
  const anchored: Array<{ name: string; distance: number }> = []
  for (const relation of relations) {
    if (relation.kind !== "segment-length") continue
    for (const segment of relation.segments) {
      const pair = segmentOf(segment)
      if (pair === null) continue
      const other = pair[0] === point ? pair[1] : pair[1] === point ? pair[0] : null
      if (other === null || !positions.has(other)) continue
      if (anchored.some((entry) => entry.name === other)) continue
      const stated = interpretValue(relation.value, null)
      if (stated === null || !(stated.value > 0)) continue
      anchored.push({ name: other, distance: stated.value })
      if (anchored.length === 2) {
        return {
          kind: "distances",
          point,
          first: anchored[0]!.name,
          firstDistance: anchored[0]!.distance,
          second: anchored[1]!.name,
          secondDistance: anchored[1]!.distance
        }
      }
    }
  }
  return null
}

/**
 * 一条规则的**解**：0 个（解不出）、1 个（相切 / 唯一）、2 个（两支）。
 *
 * 角那一支的两解是**同一个无向角**的两侧；定长那一支的两解是两个圆的交点。
 * 顺序固定（正转在前 / 正向在前），确定性由它保证。
 */
function planarRuleOptions(rule: PlanarPlacementRule, positions: ReadonlyMap<string, PlanarPosition>): PlanarPosition[] {
  if (rule.kind === "distances") {
    return circleIntersections(positions.get(rule.first)!, rule.firstDistance, positions.get(rule.second)!, rule.secondDistance)
  }
  /**
   * **SSA：射线 ∩ 圆**（Task 11）。方向与角那一支**同一套取法**（`±degrees`，正转在前），
   * 所以两条规则的"两支"顺序口径一致，确定性不会被这条破坏。
   *
   * 圆与射线的交点：把圆心投到射线上得 `projection`，垂距平方 `perp²`，
   * 则 `t = projection ± √(r² − perp²)`，只取 `t > 0`（**射线**，不是整条直线）。
   */
  if (rule.kind === "ray-circle") {
    const vertex = positions.get(rule.vertex)!
    const reference = positions.get(rule.reference)!
    const center = positions.get(rule.center)!
    const along = { x: reference.x - vertex.x, y: reference.y - vertex.y }
    const span = Math.hypot(along.x, along.y)
    if (!(span > 0)) return []
    const base = { x: along.x / span, y: along.y / span }
    const radians = (rule.degrees * Math.PI) / 180
    const scale = Math.max(1, rule.radius)
    const solutions: PlanarPosition[] = []
    for (const sign of [1, -1]) {
      const cosine = Math.cos(sign * radians)
      const sine = Math.sin(sign * radians)
      const unit = { x: base.x * cosine - base.y * sine, y: base.x * sine + base.y * cosine }
      const toCenter = { x: center.x - vertex.x, y: center.y - vertex.y }
      const projection = toCenter.x * unit.x + toCenter.y * unit.y
      const perpendicularSquared = toCenter.x * toCenter.x + toCenter.y * toCenter.y - projection * projection
      const remaining = rule.radius * rule.radius - perpendicularSquared
      if (remaining < -PLANAR_METRIC_TOLERANCE * scale * scale) continue
      const offset = Math.sqrt(Math.max(0, remaining))
      for (const distance of [projection - offset, projection + offset]) {
        if (!(distance > PLANAR_METRIC_TOLERANCE * scale)) continue
        const candidate = { x: vertex.x + distance * unit.x, y: vertex.y + distance * unit.y }
        // 两个方向可能落到同一点（角为 0 的退化情形）—— 去重，免得报出"两解"其实是同一个。
        if (solutions.some((entry) => Math.hypot(entry.x - candidate.x, entry.y - candidate.y) <= 1e-9 * scale)) continue
        solutions.push(candidate)
      }
    }
    return solutions
  }
  const vertex = positions.get(rule.vertex)!
  const reference = positions.get(rule.reference)!
  const along = { x: reference.x - vertex.x, y: reference.y - vertex.y }
  const span = Math.hypot(along.x, along.y)
  if (!(span > 0)) return []
  const unit = { x: along.x / span, y: along.y / span }
  const radians = (rule.degrees * Math.PI) / 180
  return [1, -1].map((sign) => {
    const cosine = Math.cos(sign * radians)
    const sine = Math.sin(sign * radians)
    return {
      x: vertex.x + rule.distance * (unit.x * cosine - unit.y * sine),
      y: vertex.y + rule.distance * (unit.x * sine + unit.y * cosine)
    }
  })
}

/** 两圆交点（`z = 0` 平面内）：相离 / 内含 ⇒ 0 个，相切 ⇒ 1 个，相交 ⇒ 2 个。 */
function circleIntersections(first: PlanarPosition, firstDistance: number, second: PlanarPosition, secondDistance: number): PlanarPosition[] {
  const along = { x: second.x - first.x, y: second.y - first.y }
  const span = Math.hypot(along.x, along.y)
  if (!(span > 0)) return []
  const coordinate = (firstDistance * firstDistance - secondDistance * secondDistance + span * span) / (2 * span)
  const heightSquared = firstDistance * firstDistance - coordinate * coordinate
  const tolerance = PLANAR_METRIC_TOLERANCE * Math.max(1, firstDistance * firstDistance)
  if (heightSquared < -tolerance) return []
  const height = Math.sqrt(Math.max(0, heightSquared))
  const unit = { x: along.x / span, y: along.y / span }
  const foot = { x: first.x + coordinate * unit.x, y: first.y + coordinate * unit.y }
  if (height <= PLANAR_METRIC_TOLERANCE * Math.max(1, firstDistance)) return [foot]
  const perpendicular = { x: -unit.y, y: unit.x }
  return [
    { x: foot.x + height * perpendicular.x, y: foot.y + height * perpendicular.y },
    { x: foot.x - height * perpendicular.x, y: foot.y - height * perpendicular.y }
  ]
}

/**
 * **逐条回代**：题面条件一条都不许漏地量一遍（用**最终坐标**，不是构造过程中的中间量）。
 *
 * 角用的是 `interiorAngleDegrees` —— 与统一核验器的 `planarAngle` 判据**同一条规则**
 * （同一个 `acos` 口径）。各写一份就会出现"构造器说成立、核验器说不是"。
 */
function planarRelationsHold(
  positions: ReadonlyMap<string, PlanarPosition>,
  names: readonly string[],
  relations: readonly WitnessRelation[]
): boolean {
  const scale = Math.max(1, ...names.map((name) => Math.hypot(positions.get(name)?.x ?? 0, positions.get(name)?.y ?? 0)))
  for (const relation of relations) {
    if (relation.kind === "segment-length") {
      const stated = interpretValue(relation.value, null)
      if (stated === null) continue
      for (const segment of relation.segments) {
        const pair = segmentOf(segment)
        if (pair === null) continue
        const actual = distanceVector3(planarPoint3(positions, pair[0]), planarPoint3(positions, pair[1]))
        if (Math.abs(actual - stated.value) > PLANAR_METRIC_TOLERANCE * Math.max(1, stated.value, scale)) return false
      }
      continue
    }
    if (relation.kind === "planarAngle" && relation.targets.length === 3) {
      const stated = interpretValue(relation.value, null)
      if (stated === null) continue
      const [first, vertex, third] = relation.targets as [string, string, string]
      const actual = interiorAngleDegrees(planarPoint3(positions, vertex), planarPoint3(positions, first), planarPoint3(positions, third))
      if (actual === null || Math.abs(actual - stated.value) > PLANAR_ANGLE_TOLERANCE_DEGREES) return false
    }
  }
  return true
}

/**
 * **条件的人话名字**：`unsupported` 那条文案要给用户看的是「二面角」，不是 `dihedral`。
 *
 * 机器词留给 `code`（调用方按码分流），面向用户的那一句必须是题面里认得出的说法 ——
 * 把 `dihedral` 原样印给用户，等于让他去猜我们的词表。
 *
 * 写成 `Record<WitnessRelation["kind"], string>` 是刻意的：**加一种条件就必须在这里给个名字**，
 * 漏掉编译期就红（`if` 链的尾巴只能写一句永远到不了的兜底，那种漏是查不出来的）。
 */
const PLANAR_CONDITION_NAMES: Record<WitnessRelation["kind"], string> = {
  "segment-length": "定长",
  planarAngle: "点名的角",
  perpendicular: "垂直",
  parallel: "平行",
  "equal-length": "等长",
  dihedral: "二面角",
  /** Task 11：面积的"写出来的样子"是「△ABC 的面积」—— 与题面同一套字形。 */
  area: "面积"
}

function planarConditionName(relation: WitnessRelation): string {
  return PLANAR_CONDITION_NAMES[relation.kind]
}

/** 一条条件**写出来的样子**（与题面同一套字形）：`AB`、`∠ADC`。给用户看的文案用它。 */
function planarWrittenForm(relation: WitnessRelation): string {
  if (relation.kind === "planarAngle") return `∠${relation.targets.join("")}`
  if (relation.kind === "dihedral") return "二面角"
  if (relation.kind === "area") return `△${relation.targets.join("")} 的面积`
  return relation.segments.map((segment) => (segment.length >= 2 ? `${segment[0]}${segment[1]}` : segment.join(""))).join("、")
}

/** 两条条件的**直接冲突**（同一件事被给了两个值）：找到第一对就返回，附上可复测的那一条。 */
interface PlanarDirectConflict {
  message: string
  /** 可用来给出"实测"的那一条角（哪两条冲突时才有）。 */
  angle?: { first: string; vertex: string; third: string }
}

/**
 * **不用构造就能断定的冲突**：同一个角 / 同一条边被题面给了两个不同的值。
 *
 * 与 `witnessSearch.ts` 的 `findContradiction` 同一条纪律：**只说得出证据的那些** ——
 * 说不清的留给"逐条回代"，绝不把"我没解出来"升级成"题面自相矛盾"。
 */
function planarDirectConflict(relations: readonly WitnessRelation[]): PlanarDirectConflict | null {
  const angles = new Map<string, { written: string; value: number }>()
  for (const relation of relations) {
    if (relation.kind !== "planarAngle" || relation.targets.length !== 3) continue
    const stated = interpretValue(relation.value, null)
    if (stated === null) continue
    const [first, vertex, third] = relation.targets as [string, string, string]
    const seen = angles.get(`${vertex}|${[first, third].sort().join("|")}`)
    if (seen === undefined) {
      angles.set(`${vertex}|${[first, third].sort().join("|")}`, { written: planarWrittenForm(relation), value: stated.value })
      continue
    }
    if (Math.abs(seen.value - stated.value) > PLANAR_ANGLE_TOLERANCE_DEGREES) {
      const delta = Math.abs(seen.value - stated.value)
      return {
        message: `平面图形：题面同时点名了 ${seen.written} = ${formatNumber(seen.value)}° 与 ${planarWrittenForm(relation)} = ${formatNumber(stated.value)}°（差 ${formatNumber(delta)}°）—— 同一个角不可能同时等于两个值，这两条自相矛盾。`,
        angle: { first, vertex, third }
      }
    }
  }
  const lengths = new Map<string, { written: string; value: number }>()
  for (const relation of relations) {
    if (relation.kind !== "segment-length") continue
    const stated = interpretValue(relation.value, null)
    if (stated === null) continue
    for (const segment of relation.segments) {
      const pair = segmentOf(segment)
      if (pair === null) continue
      const key = planarSegmentKey(pair[0], pair[1])
      const seen = lengths.get(key)
      if (seen === undefined) {
        lengths.set(key, { written: planarWrittenForm(relation), value: stated.value })
        continue
      }
      if (Math.abs(seen.value - stated.value) > PLANAR_METRIC_TOLERANCE * Math.max(1, stated.value)) {
        const delta = Math.abs(seen.value - stated.value)
        return { message: `平面图形：题面同时点名了 ${seen.written} = ${formatNumber(seen.value)} 与 ${planarWrittenForm(relation)} = ${formatNumber(stated.value)}（差 ${formatNumber(delta)}）—— 同一条线段不可能同时等于两个长度，这两条自相矛盾。` }
      }
    }
  }
  return null
}

/**
 * 冲突文案的**收尾**：能实测就补上实测值（设计 §5 那句"实测 90°，题面要求 60°"）。
 *
 * 实测值只在真的构造出了坐标时才给 —— 给不出就说给不出，不编一个。
 */
function planarConflictMessage(conflict: PlanarDirectConflict, sample?: ReadonlyMap<string, PlanarPosition>): string {
  if (conflict.angle === undefined || sample === undefined) return conflict.message
  const measured = interiorAngleDegrees(
    planarPoint3(sample, conflict.angle.vertex),
    planarPoint3(sample, conflict.angle.first),
    planarPoint3(sample, conflict.angle.third)
  )
  if (measured === null) return conflict.message
  return `${conflict.message}按其中一条构造出来的坐标上，∠${conflict.angle.first}${conflict.angle.vertex}${conflict.angle.third} 实测 ${formatNumber(measured)}°。`
}

/**
 * **欠定**的文案：说清**还缺哪一类条件**（缺定长 / 缺角），而不是"没找到"。
 *
 * 逐点给理由：这个点要么"有角但缺那条边长"，要么"只给了一条定长、缺第二个已定点或一个角"，
 * 要么"压根没有任何条件提到它"。三种都写成人话，用户照着补条件就能往下走。
 */
function planarUnderdeterminedMessage(
  positions: ReadonlyMap<string, PlanarPosition>,
  names: readonly string[],
  relations: readonly WitnessRelation[]
): string {
  const parts = names.filter((name) => !positions.has(name)).map((name) => `${name}：${planarMissingReason(name, positions, relations)}`)
  return `平面图形：条件不足以定形 —— ${parts.join("；")}。本层只做每条边、每个角都由题面钉死的情形。`
}

/** 一个还没定出来的点**缺什么**。 */
function planarMissingReason(point: string, positions: ReadonlyMap<string, PlanarPosition>, relations: readonly WitnessRelation[]): string {
  const missingLengths: string[] = []
  const unplaced: string[] = []
  for (const relation of relations) {
    if (relation.kind !== "planarAngle" || relation.targets.length !== 3) continue
    const [first, vertex, third] = relation.targets as [string, string, string]
    if (first !== point && third !== point) continue
    if (!positions.has(vertex)) {
      unplaced.push(vertex)
      continue
    }
    const other = first === point ? third : first
    if (!positions.has(other)) {
      unplaced.push(other)
      continue
    }
    if (statedLength(relations, [vertex, point]).kind !== "value") missingLengths.push(`${vertex}${point}`)
  }
  const anchored = relations.filter((relation) => relation.kind === "segment-length" && relation.segments.some((segment) => {
    const pair = segmentOf(segment)
    if (pair === null) return false
    return pair[0] === point ? positions.has(pair[1]) : pair[1] === point ? positions.has(pair[0]) : false
  })).length
  if (missingLengths.length > 0) return `角已经点名，但缺一条定长 ${missingLengths.join("、")}（定位它要么靠这条定长，要么靠另外一条到已定点的定长）`
  if (anchored === 1) return "只给了一条定长（到已经定出来的那个点），缺第二个已经定出来的点，或缺一个点名的角"
  if (anchored === 0 && unplaced.length > 0) return `相关点的位置本身还没有定出来（${[...new Set(unplaced)].join("、")}）`
  return "没有任何条件把它定出来（缺定长，或缺一个点名的角）"
}

/**
 * **逐条回代之后仍对不上**的文案：说出是**哪一条**、**实测多少**、**差多少**。
 *
 * 走到这里说明构造是**做完了**的（`placements` 非空），所以这不是"没找到" ——
 * 是这几条条件在平面上不可能同时成立。文案按这个口径写。
 */
function planarResidualMessage(positions: ReadonlyMap<string, PlanarPosition>, names: readonly string[], relations: readonly WitnessRelation[]): string {
  const lines: string[] = []
  for (const relation of relations) {
    if (relation.kind === "segment-length") {
      const stated = interpretValue(relation.value, null)
      if (stated === null) continue
      for (const segment of relation.segments) {
        const pair = segmentOf(segment)
        if (pair === null) continue
        const actual = distanceVector3(planarPoint3(positions, pair[0]), planarPoint3(positions, pair[1]))
        if (Math.abs(actual - stated.value) <= PLANAR_METRIC_TOLERANCE * Math.max(1, stated.value)) continue
        lines.push(`线段 ${pair[0]}${pair[1]} 实测 ${formatNumber(actual)}，题面要求 ${formatNumber(stated.value)}（差 ${formatNumber(Math.abs(actual - stated.value))}）`)
      }
      continue
    }
    if (relation.kind !== "planarAngle" || relation.targets.length !== 3) continue
    const stated = interpretValue(relation.value, null)
    if (stated === null) continue
    const [first, vertex, third] = relation.targets as [string, string, string]
    const actual = interiorAngleDegrees(planarPoint3(positions, vertex), planarPoint3(positions, first), planarPoint3(positions, third))
    if (actual === null || Math.abs(actual - stated.value) <= PLANAR_ANGLE_TOLERANCE_DEGREES) continue
    lines.push(`角 ∠${first}${vertex}${third} 实测 ${formatNumber(actual)}°，题面要求 ${formatNumber(stated.value)}°（差 ${formatNumber(Math.abs(actual - stated.value))}°）`)
  }
  const detail = lines.length > 0 ? `逐条回代的结果是：${lines.join("；")}。` : ""
  const leftover = names.filter((name) => !positions.has(name))
  const unfinished = leftover.length > 0 ? `另有顶点 ${leftover.join("、")} 没有被任何条件定出来。` : ""
  return `平面图形：这份条件在平面上不可能同时成立 —— ${detail}${unfinished}`
}

/**
 * **平面候选的组装与自检**（与 `assembleCandidate` 同一套纪律，只有一处不同）：
 * 面环**就是那只环本身**，只有一只 —— 平面图形是一只**开放**的多边形，不是多面体。
 *
 * 绕向不做归一化：平面片没有"朝外"这回事（`solid.create_face` 也不收绕向），
 * 手推一个只会凭空多出一个约定。形状 / 尺度自检走的仍是 `residuals.ts` 那一份。
 */
function assemblePlanarCandidate(input: {
  ringNames: readonly string[]
  points: readonly Vector3[]
  freeValues: string[]
  assumptions: string[]
}): WitnessConstructResult {
  const names = [...input.ringNames]
  const points = input.points.map((point) => ({ ...point }))
  if (names.length !== points.length) return reject("invalid-input", "构造出的顶点名与坐标数量不一致。", names)
  for (const point of points) {
    if (!isFiniteVector(point)) return reject("non-finite-value", "构造出的候选坐标里出现非有限数值。", names)
  }
  const faces = [names.map((_, index) => index)]
  const report = candidateResiduals({
    points,
    faces: faces.map((ring) => ({ indexes: ring })),
    source: input.freeValues.length > 0 ? "free-choice" : "stated"
  })
  if (!report.acceptable) return rejectFromDiagnostics(report.diagnostics, names)
  return {
    status: "candidate",
    witness: {
      points,
      names,
      /** 与 `assembleCandidate` 同一条：`points` / `faces` / `buildOrder` 永远共用同一套下标。 */
      buildOrder: names.map((_, index) => index),
      faces,
      freeValues: [...input.freeValues],
      assumptions: [...input.assumptions]
    }
  }
}

/** 顶点名列表的守卫：至少三个、名字非空、互不重复。 */
function validateNames(names: readonly string[], label: string): { status: "ok"; names: string[] } | WitnessConstructRejection {
  if (!Array.isArray(names) || names.length < 3) {
    return reject("base-ring-too-small", `${label}环至少需要三个点名顶点，收到 ${Array.isArray(names) ? names.length : 0} 个。`)
  }
  if (names.some((name) => typeof name !== "string" || name.length === 0)) return reject("invalid-input", `${label}环里有空顶点名。`)
  if (new Set(names).size !== names.length) return reject("duplicate-name", `${label}环里有重名顶点。`, [...names])
  return { status: "ok", names: [...names] }
}

/**
 * **候选的组装与自检**（棱锥 / 棱柱共用）：点集守卫 → 面环规则生成 → 绕向归一化 →
 * 全量残差（点 + 面）→ 输出。任何一步失败都返回结构化拒绝，绝不返回"悄悄坏掉"的候选。
 */
function assembleCandidate(input: {
  baseNames: readonly string[]
  basePoints: readonly Vector3[]
  extraNames: readonly string[]
  extraPoints: readonly Vector3[]
  apex: boolean
  freeValues: string[]
  assumptions: string[]
}) {
  const names = [...input.baseNames, ...input.extraNames]
  const points = [...input.basePoints, ...input.extraPoints]
  if (names.length !== points.length) {
    return reject("invalid-input", "构造出的顶点名与坐标数量不一致。", [...names])
  }
  for (const point of points) {
    if (!isFiniteVector(point)) return reject("non-finite-value", "构造出的候选坐标里出现非有限数值。", [...names])
  }

  const baseCount = input.baseNames.length
  const rawFaces = input.apex ? pyramidRings(baseCount) : prismRings(baseCount)
  /**
   * 面环的绕向**由规则归一化**，不在这里手推。
   *
   * 第一版按"底面 + 每个底棱一个侧面"直接给环，`buildFromPoints` 判出
   * `inconsistent-winding`（相邻面沿共享棱同向）与 `non-planar-base`，实测全红。
   * 代表题夹具早就写着这条教训（"绕向是暴力搜出来的合法组合…拓扑别手推"）。
   *
   * 判据与 `prism.ts` 的 `facesOutwards` 同源：环的 Newell 法向是否背离实体形心。
   * 它只用几何自身（面心相对形心），所以**不会**丢掉"B0 是谁"，也**不依赖**输入的环绕方向。
   */
  const faces = orientFacesOutward(rawFaces, points)

  const report = candidateResiduals({
    points,
    faces: faces.map((ring) => ({ indexes: ring })),
    source: input.freeValues.length > 0 ? "free-choice" : "stated"
  })
  if (!report.acceptable) return rejectFromDiagnostics(report.diagnostics, names)

  const candidate: WitnessConstructResult = {
    status: "candidate",
    witness: {
      points,
      names,
      /**
       * 建模顺序 = `points` 的**原生下标顺序**，也就是 `faces` 用的同一套下标空间。
       *
       * `points` 的顺序是「底面环 `n` 个（按题面点名顺序）+ 顶点 1 个（棱锥）/ 顶面环 `n` 个（棱柱）」，
       * 而棱锥把顶点放在**最后**（`[A…D, P]`），刻意与代表题夹具 `PYRAMID_VERTICES = [P, A…D]` 区分开：
       * 夹具那边顶点在前会让"下标"与"原生下标"差一位 —— 2b 若按 `buildOrder` 重排坐标、
       * 却把 `faces` 当原生下标用，就会把 `P` 当成底面第一个点（第一版实测：内核报 `non-planar-base`）。
       * 所以这里用恒等映射明说这一点：**`points` / `faces` / `buildOrder` 永远同一套下标**。
       */
      buildOrder: Array.from({ length: names.length }, (_, index) => index),
      faces,
      freeValues: [...input.freeValues],
      assumptions: [...input.assumptions]
    }
  }
  return candidate
}

/** 棱锥的面环（**未归一化绕向**）：底面 + 每个底棱一个侧面。 */
function pyramidRings(baseCount: number): number[][] {
  return [
    Array.from({ length: baseCount }, (_, index) => index),
    ...Array.from({ length: baseCount }, (_, index) => [baseCount, index, (index + 1) % baseCount])
  ]
}

/** 棱柱的面环（**未归一化绕向**）：底面 + 顶面（反向）+ 每个底棱一个侧面。 */
function prismRings(baseCount: number): number[][] {
  return [
    Array.from({ length: baseCount }, (_, index) => index),
    Array.from({ length: baseCount }, (_, index) => 2 * baseCount - 1 - index),
    ...Array.from({ length: baseCount }, (_, index) => [index, (index + 1) % baseCount, baseCount + ((index + 1) % baseCount), baseCount + index])
  ]
}

/**
 * 把面环的绕向统一成**朝外**（`(p1−p0)×(p2−p0)` 指向实体外部）。
 *
 * 与 `prism.ts` 的 `facesOutwards` 同判据（面心相对形心的朝向），只是这里按用户点名的
 * 下标顺序给环 —— 判据只看几何，所以不会把两个不同的输入混成同一个结果。
 *
 * 法向取**整个环的 Newell**（不看头三个点）：`solid-builders.ts` 的 `areCoplanar` 是拿环的
 * 头三点定平面的，如果只反转"以头三点算出的法向朝内"的那些环，`[3,2,1,0]` 这种环会变成
 * `[3,2,1,…]` 与 `[…,1,0]` 混排，头三点落不到同一个平面上，内核直接判 `non-planar-base`。
 * 整环求和只有环真的零面积时才是零向量，而那已被残差判据拒掉。
 */
function orientFacesOutward(rings: readonly (readonly number[])[], points: readonly Vector3[]): number[][] {
  const centroid = points.reduce((sum, point) => ({
    x: sum.x + point.x / points.length,
    y: sum.y + point.y / points.length,
    z: sum.z + point.z / points.length
  }), { x: 0, y: 0, z: 0 })
  return rings.map((ring) => {
    const center = ring.reduce((sum, index) => ({
      x: sum.x + points[index].x / ring.length,
      y: sum.y + points[index].y / ring.length,
      z: sum.z + points[index].z / ring.length
    }), { x: 0, y: 0, z: 0 })
    const normal = newellNormal(ring, points)
    if (lengthVector3(normal) === 0) return [...ring]
    const outward = subtractVector3(center, centroid)
    return dotVector3(normal, outward) >= 0 ? [...ring] : [...ring].reverse()
  })
}

/** 面环的 Newell 法向（未单位化，模长 = 2×面积，方向随绕向）。与 `prism.ts` 同一个公式。 */
function newellNormal(ring: readonly number[], points: readonly Vector3[]): Vector3 {
  let x = 0
  let y = 0
  let z = 0
  for (let index = 0; index < ring.length; index += 1) {
    const current = points[ring[index]]
    const next = points[ring[(index + 1) % ring.length]]
    x += (current.y - next.y) * (current.z + next.z)
    y += (current.z - next.z) * (current.x + next.x)
    z += (current.x - next.x) * (current.y + next.y)
  }
  return { x, y, z }
}

/** 残差判据码 → 构造拒绝码：只在这里做映射，`residuals.ts` 不认识构造语义。 */
const REJECTION_CODE_BY_RESIDUAL: Record<WitnessResidualDiagnostic["code"], WitnessConstructRejectionCode> = {
  "non-finite-value": "non-finite-value",
  "magnitude-unrepresentable": "extreme-scale",
  "ring-too-small": "degenerate-base",
  "degenerate-edge": "degenerate-base",
  "degenerate-collinear": "degenerate-base",
  "non-coplanar-base": "degenerate-base",
  "extreme-aspect-ratio": "extreme-scale"
}

/** 由残差诊断映射成拒绝理由（保留全部诊断细节进 `detail.diagnostics`）。 */
function rejectFromDiagnostics(diagnostics: readonly WitnessResidualDiagnostic[], names: readonly string[]): WitnessConstructRejection {
  const first = diagnostics[0]
  return {
    status: "rejected",
    code: REJECTION_CODE_BY_RESIDUAL[first.code],
    message: diagnostics.map((entry) => entry.message).join(" "),
    detail: { points: [...names], diagnostics: diagnostics.map((entry) => ({ ...entry })) }
  }
}

function reject(code: WitnessConstructRejectionCode, message: string, points?: readonly string[]): WitnessConstructRejection {
  return { status: "rejected", code, message, ...(points ? { detail: { points: [...points] } } : {}) }
}

function isFiniteVector(point: Vector3): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)
}

function polygonNormal(points: readonly Vector3[]): Vector3 | null {
  if (points.length < 3) return null
  for (let second = 1; second < points.length; second += 1) {
    for (let third = second + 1; third < points.length; third += 1) {
      const normal = crossVector3(subtractVector3(points[second], points[0]), subtractVector3(points[third], points[0]))
      if (lengthVector3(normal) > 0) return normalizeVector3(normal)
    }
  }
  return null
}

function polygonDiameter(points: readonly Vector3[]): number {
  let diameter = 0
  for (let first = 0; first < points.length; first += 1) {
    for (let second = first + 1; second < points.length; second += 1) diameter = Math.max(diameter, distanceVector3(points[first], points[second]))
  }
  return diameter
}

/**
 * **一个底面名可以派生出的顶面名**（按优先顺序）。
 *
 * 名字的形状与共享词表一致：**字母 + 至多两个后缀**。所以：
 * - 底面无后缀（`A`）：先试一层（`A′`、`A₁`、…），再试两层（`A′′`、`A′₁`、…）；
 * - 底面已带一层（`A′`，即题面自己写了撇的那种）：**只剩一层可加** ⇒ `A′′`、`A′₁`、… 。
 *
 * 这正是用户 2026-10-07 裁决的那条：底面已用 `A′` 时顶面叫 **`A′′`**（扩语法），
 * 而不是把整道题拒掉。三层及以上**不在词表里**，所以这里不去造。
 */
function derivedNameCandidates(name: string): string[] {
  const used = pointNameSuffixCount(name)
  if (used < 0 || used >= 2) return []
  const single = POINT_NAME_SUFFIXES.map((suffix) => `${name}${suffix}`)
  if (used === 1) return single
  const double: string[] = []
  for (const first of POINT_NAME_SUFFIXES) for (const second of POINT_NAME_SUFFIXES) double.push(`${name}${first}${second}`)
  return [...single, ...double]
}

/**
 * 顶面顶点的**名字**：底面名派生（`A′`、`B′`…）。
 *
 * 只用名字区分底面与顶面顶点 —— 坐标本身是严格平移，不靠"位置略不同"来区分。
 *
 * **两条纪律**：
 * - **比较按规范字形**（`canonicalPointName`）：`A'` 与 `A′` 是同一个名字的两种字形，
 *   不归一就会出现"同一个点以两种写法同时进点名表"。
 * - **造不出来就返回 `null`**（而不是硬拼一个词表外的名字）：候选耗尽时由调用方**明确拒绝**。
 *   此前这里会退化成 `A′2` 这种名字 —— 它不在共享词表里，核验器于是把整张表判为不可靠，
 *   用户拿到的是一张**永远核验不了**的图。用户裁决扩语法之后，`A′′` 这类名字合法了，
 *   而词表外的名字仍然一个都不许造。
 */
function withPrimes(names: readonly string[]): string[] | null {
  const used = new Set(names.map(canonicalPointName))
  const out: string[] = []
  for (const name of names) {
    const picked = derivedNameCandidates(name).find((candidate) => !used.has(canonicalPointName(candidate)))
    if (picked === undefined) return null
    used.add(canonicalPointName(picked))
    out.push(picked)
  }
  return out
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(12).replace(/0+$/, "").replace(/\.$/, "")
}

/**
 * 题面是否为这段长度给了值。三分支是刻意的：
 * `missing`（题面没提 → 自由值）、`value`（题面给了有限值）、`invalid`（题面给了非有限值 → 拒绝）。
 */
type StatedLengthLookup =
  | { kind: "missing" }
  | { kind: "value"; stated: WitnessStatedValue }
  | { kind: "invalid"; rejection: WitnessConstructRejection }

/**
 * 从关系表里取"段的长度"：`segment-length` 直接给值；`perpendicular` / `parallel` 声明的是
 * **方向**，不约束长度。没提到就是自由值（由 `freeLength` 决定）。
 *
 * **"题面没提"与"题面给了个非有限值"必须分开**（复核 round 1 Important 3）：早先两者都返回
 * `null`，于是 `NaN` / `±Infinity` 会被 `freeLength` 静默换成 2 或 3 —— 题面给的数字消失，
 * 正是文件头承诺不做的事。非有限值在这里就是 `invalid`，与兄弟路径（`fixed` 高、`lateral-edge`）一致。
 */
function statedLength(relations: readonly WitnessRelation[], segment: readonly [string, string]): StatedLengthLookup {
  for (const relation of relations) {
    if (relation.kind !== "segment-length") continue
    for (const candidate of relation.segments) {
      const pair = segmentOf(candidate)
      if (!pair) continue
      if (!sameSegment(pair, segment)) continue
      if (relation.value !== undefined && interpretValue(relation.value, null) === null) {
        return {
          kind: "invalid",
          rejection: reject("non-finite-value", `题面给的边长 ${segment.join("")} 不是有限数值（${String(relation.value)}）。`, [segment[0], segment[1]])
        }
      }
      const stated = interpretValue(relation.value, null)
      return stated ? { kind: "value", stated } : { kind: "missing" }
    }
  }
  return { kind: "missing" }
}

function sameSegment(first: readonly string[], second: readonly [string, string]): boolean {
  return (first[0] === second[0] && first[1] === second[1]) || (first[0] === second[1] && first[1] === second[0])
}

/** 一段关系项：一对点名顶点；多于两个名称时只用前两个（例如 `P-A-B` 这种三点写法）。 */
function segmentOf(target: readonly string[]): [string, string] | null {
  if (!Array.isArray(target) || target.length < 2) return null
  return [target[0], target[1]]
}

/**
 * **只看底面的**垂直判据（复核 round 2 / R21）：跨所有 `perpendicular` 关系找"这两条边互相垂直"，
 * 但**忽略任何点名了底面环以外顶点（如顶点 `P`）的关系**。
 *
 * 为什么必须排除环外顶点：`PB ⊥ AB` 与 `PB ⊥ BC` 是"侧棱垂直于底面"（`PB ⊥ 平面 ABCD`）的
 * 自然写法，它们说的是**线面垂直**，不是"B 处有一个底角直角"。第一版（round 1 的修法）
 * 全局探测这两条底边、不要求它们互为一对，于是把这个**完全合法的输入**误拒成"直角梯形"。
 * 方向必须是 **fail-closed 而不是 fail-open**：finding 9 的问题是"静默建成矩形"（方向错了），
 * 但正确方向是"拒"，不是"把合法输入也拒掉"。
 *
 * 两种等价编码都收：① 一条关系同时给出两条边；② 两条关系各给一条底边。
 */
function baseEdgePerpendicular(relations: readonly WitnessRelation[], baseNames: readonly string[], edge: readonly [string, string]): boolean {
  return relations.some((relation) => {
    if (relation.kind !== "perpendicular") return false
    const segments = relation.segments.map(segmentOf).filter((pair): pair is [string, string] => pair !== null)
    // 关系里的**每一条边**都必须落在底面环内；只要点名了环外顶点，这条关系对"底角"就不作数。
    const allInBase = segments.length > 0 && segments.every(([from, to]) => baseNames.includes(from) && baseNames.includes(to))
    if (!allInBase) return false
    return segments.some((pair) => sameSegment(pair, edge))
  })
}

/**
 * **只看底面的**平行判据（与 `baseEdgePerpendicular` 同一口径）：跨所有 `parallel` 关系找
 * "这两条边互相平行"，而且**要求两条边都被同一条关系点到**、**忽略任何点名了环外顶点的关系**。
 *
 * 为什么要求"同一条关系点到两条"：`parallel` 的语义就是一对，而"两条独立的关系各说一条边平行"
 * 在题面里没有意义（没有平行对象）。方向不限（`BC ∥ AD` 与 `AD ∥ BC` 同义），所以用 `sameSegment`。
 */
function baseEdgeParallel(
  relations: readonly WitnessRelation[],
  baseNames: readonly string[],
  first: readonly [string, string],
  second: readonly [string, string]
): boolean {
  return relations.some((relation) => {
    if (relation.kind !== "parallel") return false
    const segments = relation.segments.map(segmentOf).filter((pair): pair is [string, string] => pair !== null)
    const allInBase = segments.length > 0 && segments.every(([from, to]) => baseNames.includes(from) && baseNames.includes(to))
    if (!allInBase) return false
    return segments.some((pair) => sameSegment(pair, first)) && segments.some((pair) => sameSegment(pair, second))
  })
}

/**
 * **边上分点：四条点名 → 一个无量纲参数**（Task 10，2026-10-12）。
 *
 * ## 为什么要有这一处
 *
 * `segmentRatio` 的四条点名 `[p1,p2,p3,p4]` 配一个 `value = |p1p2| / |p3p4|`，
 * 而**同一个点**可以有好几种写法：
 *
 * | 题面 | targets | 锚（出现两次的名字） |
 * | --- | --- | --- |
 * | `AE:AD = 2:5` | `[A,E,A,D]` | `A`（已知点）⇒ 部分/整体 ⇒ `t = r` |
 * | `AE:ED = 2:3` | `[A,E,E,D]` | `E`（就是未知点）⇒ 部分/部分 ⇒ `t = r/(1+r)` |
 * | `EA:DA = 2:5` | `[E,A,D,A]` | `A`（已知点）⇒ 与第一行**同一个点** |
 *
 * 原先 `planCompiler.constructiblePoint` **只认第二行**（它要求未知点恰好落在第 1、2 位），
 * 于是最常见的 `AE:AD=2:5` 根本补不出来 —— 而"判据写两遍必然分叉"正是本仓反复吃亏的地方。
 * 所以这里收成**一处**：先认出"哪条点名把两条线段钉在同一条直线上"（**恰好一条名字出现两次**），
 * 再由它决定方向与分母。
 *
 * ## 四条纪律
 *
 * 1. **方向不许乱**：`EA`/`DA` 与 `AE`/`AD` 必须落到**同一个点**（锚决定方向，不是书写顺序）；
 * 2. **没有公共端点就拒绝**：两条线段不相交时，"这个点在哪条线上"说不清 ⇒ 不猜；
 * 3. **端点是同一个点就拒绝**：那样的线段没有方向；
 * 4. **比例越界就拒绝**：`t` 必须严格落在 `(0,1)` 内 —— `t = 1` 意味着这个点与端点重合，
 *    而"分点恰好落在端点上"不是分点。
 *
 * 参数是**无量纲**的：这一层不知道任何坐标，所以宿主怎么变，`t` 都不用改
 *（运行时的投影由既有的 `onHost` / `onPath` 绑定负责，见 `packages/dsl/src/types.ts`）。
 */
export type RatioParameterRefusalCode =
  | "not_four_targets"
  | "not_a_ratio"
  | "missing_point_not_in_ratio"
  | "no_shared_endpoint"
  | "ambiguous_anchor"
  | "degenerate_endpoints"
  | "point_outside_segment"

export type RatioParameterResult =
  | { ok: true; from: string; to: string; parameter: number }
  | { ok: false; code: RatioParameterRefusalCode; detail: string }

function refuseRatio(code: RatioParameterRefusalCode, detail: string): RatioParameterResult {
  return { ok: false, code, detail }
}

export function ratioParameterFor(targets: readonly string[], missing: string, value: number | undefined): RatioParameterResult {
  if (targets.length !== 4) return refuseRatio("not_four_targets", `按比例分点要两条线段（四条点名），这里给了 ${targets.length} 条。`)
  if (value === undefined || !Number.isFinite(value) || value <= 0) {
    return refuseRatio("not_a_ratio", `比值必须是正的有限数（给的是 ${String(value)}）—— 编一个比值等于替题面改数。`)
  }
  if (!targets.includes(missing)) {
    return refuseRatio("missing_point_not_in_ratio", `要补的点 ${missing} 不在这条比例里（${targets.join("、")}）。`)
  }

  const [s1a, s1b, s2a, s2b] = targets as [string, string, string, string]
  if (s1a === s1b || s2a === s2b) {
    return refuseRatio("degenerate_endpoints", `线段的两端是同一个点（${s1a === s1b ? s1a : s2a}）—— 这样的线段没有方向。`)
  }

  const counts = new Map<string, number>()
  for (const name of targets) counts.set(name, (counts.get(name) ?? 0) + 1)
  const repeated = [...counts.entries()].filter(([, times]) => times === 2).map(([name]) => name)
  if (repeated.length !== 1) {
    return refuseRatio("no_shared_endpoint", `四条点名（${targets.join("、")}）里出现两次的名字有 ${repeated.length} 个 —— 认不出"哪条点名把两条线段钉在同一条直线上"，方向说不清，不补。`)
  }
  const anchor = repeated[0]!
  /** 下标 `i` 与 `i ^ 1` 是同一条线段的两个端点（0↔1、2↔3）。 */
  const indices = targets.map((name, index) => (name === anchor ? index : -1)).filter((index) => index >= 0)
  if (indices.length !== 2 || indices[0]! >> 1 === indices[1]! >> 1) {
    return refuseRatio("ambiguous_anchor", `点名 ${anchor} 的两次出现没有分落在两条线段上 —— 这样的写法没有可用的锚。`)
  }

  let from: string
  let to: string
  let parameter: number
  if (anchor === missing) {
    // 锚**就是**那个未知点 ⇒ 两条线段各给出一个已知端点，逐段分成 r : 1 ⇒ `t = r/(1+r)`。
    const other = (index: number): string => targets[index ^ 1]!
    from = other(indices[0]!)
    to = other(indices[1]!)
    parameter = value / (1 + value)
  } else {
    /**
     * 锚是**已知点** ⇒ 部分/整体：未知点必须是与锚同段的那一个（否则"从哪量起"说不清），
     * 而另一段的非锚端点就是分母那一段的终点。
     */
    const missingIndex = targets.indexOf(missing)
    if (targets[missingIndex ^ 1] !== anchor) {
      return refuseRatio("ambiguous_anchor", `未知点 ${missing} 与锚 ${anchor} 不在同一条线段上 —— "从哪量起"说不清，不补。`)
    }
    /**
     * 锚的另一处必须落在**另一条线段**上（`index >> 1` 就是线段号）——
     * 取"下标不同的那一处"是不够的：`[A,E,A,D]` 里锚 `A` 的两处是 0 与 2，
     * 而与未知点同段的那一处正是 0，取错了会把 `to` 指回未知点自己。
     */
    const anchorOtherIndex = indices.find((index) => (index >> 1) !== (missingIndex >> 1))!
    from = anchor
    to = targets[anchorOtherIndex ^ 1]!
    parameter = value
  }

  if (from === to) return refuseRatio("degenerate_endpoints", `分点的两个端点都是 ${from} —— 没有可分的线段。`)
  if (!(parameter > 0 && parameter < 1)) {
    return refuseRatio("point_outside_segment", `按这个比值算出来的分点落在 ${from}${to} 的**外面或端点上**（参数 ${parameter}）—— 那不是这条线段上的分点。`)
  }
  return { ok: true, from, to, parameter }
}

/** Rotate only a triangular base with one explicitly named right corner. A cyclic * rotation preserves its face orientation; two claimed corners are ambiguous
 * and must stay unsupported rather than silently picking one. */
export function namedRightTriangleBase(names: readonly string[], relations: readonly WitnessRelation[]): string[] {
  if (names.length !== 3) return [...names]
  const corners = names.filter((name, index) => {
    const before = names[(index + 2) % 3]
    const after = names[(index + 1) % 3]
    return baseEdgePerpendicular(relations, names, [before, name]) && baseEdgePerpendicular(relations, names, [name, after])
  })
  if (corners.length !== 1) return [...names]
  const index = names.indexOf(corners[0])
  return [...names.slice(index), ...names.slice(0, index)]
}
function interpretValue(value: number | WitnessStatedValue | undefined, fallback: number | null): WitnessStatedValue | null {
  if (value === undefined || value === null) return fallback === null ? null : { value: fallback }
  if (typeof value === "number") return Number.isFinite(value) ? { value } : null
  return Number.isFinite(value.value) ? { value: value.value, ...(value.raw !== undefined ? { raw: value.raw } : {}) } : null
}

/**
 * 自由的长度：题面给就用题面；没给就取**与另一个长度不相等**的小整数示例值。
 *
 * 为什么必须不相等：`ABCD` 是矩形，两个方向都自由时取 (2, 2) 会顺带把四条边做成等长 ——
 * 那是题面没说的"额外特殊性"（代表题夹具为此专门把底面取成 2×3，见它自己的注释）。
 */
function freeLength(stated: WitnessStatedValue | null, other: WitnessStatedValue | null, axis: 0 | 1): WitnessStatedValue | null {
  if (stated) return stated
  if (!other) return { value: axis === 0 ? DEFAULT_FREE_BASE_WIDTH : DEFAULT_FREE_BASE_DEPTH }
  const candidate = other.value * (axis === 0 ? 1.5 : 2)
  return { value: Number.isFinite(candidate) ? candidate : other.value + 1 }
}

/**
 * **菱形的代表角**（S3）：题面只说"菱形"，没说角是多少 —— 取 60° 并写进 assumptions。
 *
 * 与 n ≥ 5 的"正 n 边形代表"同一条口径（`deriveRepresentativePolygon`）：题面没限定的自由度，
 * 由系统取一个**代表值**并**如实声明**，而不是假装题面说了。**不许取 90°**：
 * 四边相等 + 直角 = 正方形，那是题面没说的额外特殊性（与候选池里"两条自由底边不许取相等"同一条账）。
 */
const RHOMBUS_REPRESENTATIVE_ANGLE = Math.PI / 3

/**
 * **四边形的四条边两两相等**（题面的「底面 ABCD 是菱形」拆出来的三条链式 `equal-length`）。
 *
 * 三条链式（`AB=BC`、`BC=CD`、`CD=DA`）经传递性就覆盖了四条边；**少一条不算**：
 * 只声明"两组对边分别相等"的四边形可能是别的形状，按菱形构造就是一句比题面更强的假设。
 */
export function hasEqualSideChain(names: readonly string[], relations: readonly WitnessRelation[]): boolean {
  const pairs = new Set<string>()
  for (const relation of relations) {
    if (relation.kind !== "equal-length") continue
    const segments = relation.segments.map(segmentOf).filter((pair): pair is [string, string] => pair !== null)
    if (segments.length !== 2) continue
    const [left, right] = segments as [[string, string], [string, string]]
    pairs.add(`${[...left].sort().join("|")}=${[...right].sort().join("|")}`)
  }
  const linked = (left: readonly string[], right: readonly string[]): boolean => {
    const first = [...left].sort().join("|")
    const second = [...right].sort().join("|")
    return pairs.has(`${first}=${second}`) || pairs.has(`${second}=${first}`)
  }
  const sides = names.map((name, index) => [name, names[(index + 1) % names.length]!] as [string, string])
  return sides.slice(0, sides.length - 1).every((side, index) => linked(side, sides[index + 1]!))
}

/**
 * **菱形底面**（S3）：边长自由（或题面给定）+ 代表角 60°，四边相等由构造保证。
 *
 * 三条拒绝都是 fail-closed，理由各不相同（用户看到的句子必须对得上）：
 * - 同时点名直角 ⇒ 那是**正方形**，题面说的是菱形，不画一个更强的形状；
 * - 题面给了两个不同的边长 ⇒ 与"四边相等"自相矛盾；
 * - 边长零或负 ⇒ 围不出面积。
 */
function deriveRhombusBase(
  names: readonly string[],
  relations: readonly WitnessRelation[]
): { status: "ok"; polygon: Vector3[]; freeValues: string[]; assumptions: string[] } | WitnessConstructRejection {
  const first = names[0]!
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!
    const before = names[(index + names.length - 1) % names.length]!
    const after = names[(index + 1) % names.length]!
    if (baseEdgePerpendicular(relations, names, [before, name]) && baseEdgePerpendicular(relations, names, [name, after])) {
      return reject(
        "unsupported-base-shape",
        `底面四边相等、又在 ${name} 处点名了直角：那要求把它做成**正方形**，而题面说的是菱形 —— 首批不造正方形，不把比题面更强的形状画出来。`,
        [...names]
      )
    }
  }

  const sides = names.map((name, index) => [name, names[(index + 1) % names.length]!] as [string, string])
  const stated = sides.map((side) => ({ side, lookup: statedLength(relations, side) }))
  for (const entry of stated) if (entry.lookup.kind === "invalid") return entry.lookup.rejection
  const values = stated.flatMap((entry) => (entry.lookup.kind === "value" ? [entry.lookup.stated] : []))
  const distinct = [...new Set(values.map((value) => value.value))]
  if (distinct.length > 1) {
    return reject(
      "unsupported-base-shape",
      `底面是菱形，但题面给了不同的边长（${distinct.map((value) => formatNumber(value)).join(" / ")}）：四边必须一样长，这两条对不上。`,
      [...names]
    )
  }
  const side = values.length > 0 ? values[0]! : freeLength(null, null, 0)
  if (side === null || !(side.value > 0)) return reject("degenerate-base", "底面点名了零或负的边长，围不出面积。", [...names])

  const angle = RHOMBUS_REPRESENTATIVE_ANGLE
  const freeValues: string[] = []
  const assumptions: string[] = []
  if (values.length === 0) freeValues.push(`底面边长 ${sides[0]![0]}${sides[0]![1]} = ${formatNumber(side.value)}（系统自选）`)
  assumptions.push(`底面 ${names.join("")} 取菱形：四边相等，取 ${first} 处 ${formatNumber((angle * 180) / Math.PI)}°（系统自选的代表角 —— 题面只说"菱形"，没说角）。`)

  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return {
    status: "ok",
    polygon: [
      { x: 0, y: 0, z: 0 },
      { x: side.value, y: 0, z: 0 },
      { x: side.value + side.value * cos, y: side.value * sin, z: 0 },
      { x: side.value * cos, y: side.value * sin, z: 0 }
    ],
    freeValues,
    assumptions
  }
}

/**
 * **底面的解析构造**。
 *
 * 首批支持三种底面：
 * 1. 四边形的**环首直角**（`AB ⊥ AD`）⇒ 矩形：`A` 在原点，`AB` 沿 +x、`AD` 沿 +y；
 *    对边的平行声明（`BC ∥ AD` 或 `AB ∥ DC`，方向不限）与这个构造一致，因此接受并**写在 assumptions 里**。
 *    只声明一组对边平行时构造出来的是矩形而不是一般梯形 —— 那是一条**比题面更强**的假设，
 *    所以拒绝（`unsupported-base-shape`），不把"额外特殊性"悄悄塞进图里。
 * 2. 三角形的唯一点名直角（可不在原环首）⇒ 循环旋转到该角，先沿 +x/+y 构造，再按原顶点顺序映回。
 * 3. **正 n 边形代表**（S2，n = 5、6；见 `deriveRepresentativePolygon`）：题面没限定底面形状时
 *    给一组正 n 边形，并在 assumptions 里写明"这是代表形状"；题面点名了底面上的角度/平行
 *    或给了两个不同边长时拒绝 —— 正 n 边形满足不了它。
 *
 * 覆盖不到的（斜平行四边形底、直角不在环首的四边形、七边形以上）返回 `unsupported-base-shape`
 * —— 明确拒绝好过悄悄换一个题面没说的形状。
 */
/** A plain triangular base with free side lengths needs a representative, not a
 * fabricated right angle. Any stated base relation we cannot honor stays rejected. */
function deriveRepresentativeTriangle(
  names: readonly string[],
  relations: readonly WitnessRelation[]
): { status: "ok"; polygon: Vector3[]; freeValues: string[]; assumptions: string[] } | WitnessConstructRejection {
  const [first, second, third] = names as [string, string, string]
  const unsupportedAngle = relations.some((relation) => (relation.kind === "perpendicular" || relation.kind === "parallel")
    && relation.segments.length > 0 && relation.segments.every((segment) => segment.every((name) => names.includes(name))))
  if (unsupportedAngle) return reject("unsupported-base-shape", "底面另有点名的角度或平行条件，不能凭普通三角形示例取代。", [...names])
  const ab = statedLength(relations, [first, second])
  const ac = statedLength(relations, [first, third])
  const bc = statedLength(relations, [second, third])
  for (const side of [ab, ac, bc]) if (side.kind === "invalid") return side.rejection
  if (bc.kind === "value") return reject("unsupported-base-shape", `${second}${third} 给定长度时需要与其它边联合构造，普通示意值不能替代题设。`, [...names])
  const abStated = ab.kind === "value" ? ab.stated : null
  const acStated = ac.kind === "value" ? ac.stated : null
  const width = freeLength(abStated, acStated, 0)
  const depth = freeLength(acStated, abStated, 1)
  if (!width || !depth || !(width.value > 0) || !(depth.value > 0)) return reject("degenerate-base", "底面自由边长必须为有限正数。", [...names])
  // cos(angle A) = 2/5: deliberately neither right nor an elementary special angle.
  const cosine = 0.4
  const polygon: Vector3[] = [
    { x: 0, y: 0, z: 0 },
    { x: width.value, y: 0, z: 0 },
    { x: depth.value * cosine, y: depth.value * Math.sqrt(1 - cosine * cosine), z: 0 }
  ]
  const freeValues = [
    ...(!abStated ? [`底面边长 ${first}${second} = ${formatNumber(width.value)}（系统自选）`] : []),
    ...(!acStated ? [`底面边长 ${first}${third} = ${formatNumber(depth.value)}（系统自选）`] : [])
  ]
  return { status: "ok", polygon, freeValues, assumptions: [`底面 ${names.join("")} 取一组非直角、非退化的普通三角形示例（题面未限定底角）。`] }
}

/**
 * **正 n 边形代表底面**（S2；n = 5、6）。
 *
 * 用户裁决的首批范围是**任意 3–6 边底面**。题面没有限定底面形状时，取一组正 n 边形 ——
 * 与三角形的"普通三角形示例"同一个口径：欠定时给一张**符合直觉且满足全部可核条件**的图，
 * 而不是因为"不唯一"就拒收。
 *
 * **满足不了就拒绝，绝不换形状**（设计 §5 第 2 条）：
 * - 底面上点名了**角度或平行条件** ⇒ 正 n 边形满足不了它（正五边形的边既不平行也不垂直），拒绝；
 * - 环上给了**两个不同**的边长 ⇒ 正 n 边形所有边等长，也满足不了，拒绝；
 * - 只给一个边长 ⇒ 按它取正 n 边形（那条长度不是系统自选，因此不写进 `freeValues`）。
 *
 * 与 3/4 边那套的关系：那条路靠"点名的直角"把底面**解出来**；这里没有可解的约束，
 * 于是明说"这是一张代表图"——假设文案里写清楚，用户不会把它当成题面唯一确定的图形。
 */
/**
 * 把浮点噪声按回 0。
 *
 * `cos(π/2)` / `sin(π)` 算出来是 6.1e-17 / 1.2e-16 这种量级。正六边形若留着它，内核的
 * "候选坐标量级跨度过大"守卫会**如实拒绝**这张图 —— 那条守卫是对的（双精度下拿 1e-16 与 1
 * 去比距离和角度不可靠），所以修在**构造侧**：把噪声按回 0，而不是去放宽守卫。
 */
function snapToZero(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value
}

function deriveRepresentativePolygon(
  names: readonly string[],
  relations: readonly WitnessRelation[]
): { status: "ok"; polygon: Vector3[]; freeValues: string[]; assumptions: string[] } | WitnessConstructRejection {
  const unsupportedAngle = relations.some((relation) => (relation.kind === "perpendicular" || relation.kind === "parallel")
    && relation.segments.length > 0 && relation.segments.every((segment) => segment.every((name) => names.includes(name))))
  if (unsupportedAngle) {
    return reject("unsupported-base-shape", `底面点名了角度或平行条件，正 ${names.length} 边形代表满足不了它，不换一个题面没说的形状。`, [...names])
  }
  const stated: WitnessStatedValue[] = []
  for (let index = 0; index < names.length; index += 1) {
    const length = statedLength(relations, [names[index]!, names[(index + 1) % names.length]!])
    if (length.kind === "invalid") return length.rejection
    if (length.kind === "value") stated.push(length.stated)
  }
  // 按**数值**去重，但保留题面写法（`raw`）用于文案：同一个数写法不同不算两个长度。
  const distinct = [...new Map(stated.map((entry) => [entry.value, entry])).values()]
  if (distinct.length > 1) {
    const shown = distinct.map((entry) => entry.raw ?? formatNumber(entry.value)).join("、")
    return reject("unsupported-base-shape", `题面给了不同的底面边长（${shown}），正 ${names.length} 边形底面满足不了它们。`, [...names])
  }
  const sideStated = distinct.length === 1 ? distinct[0]! : null
  const side = sideStated?.value ?? 1
  if (!Number.isFinite(side) || !(side > 0)) return reject("degenerate-base", "底面自由边长必须为有限正数。", [...names])
  const polygon: Vector3[] = names.map((_, index) => {
    const angle = (2 * Math.PI * index) / names.length
    return { x: snapToZero(side * Math.cos(angle)), y: snapToZero(side * Math.sin(angle)), z: 0 }
  })
  return {
    status: "ok",
    polygon,
    freeValues: sideStated === null ? [`底面边长（正 ${names.length} 边形） = ${formatNumber(side)}（系统自选）`] : [],
    assumptions: [`底面 ${names.join("")} 取一组**正 ${names.length} 边形**示例（题面未限定底面形状）；这是系统自选的代表形状，不是题面唯一确定的图形。`]
  }
}

/**
 * **底面点名了一个数值角的三角形**（§3-F，2026-10-10）：`∠ABC=60°` ⇒ 闭式放出来。
 *
 * 为什么这一支能现在做：三角形底面的三条边**本来就有两个自由度**（两条边取代表值），
 * 而"一个角"恰好把它们之外的那件事钉住 —— 把两条邻边按题面那个角摆开就行，
 * **不需要解题器**（与"环首直角 ⇒ 矩形""菱形取代表角"同一条口径）。
 *
 * 放置方式（全部在 `z = 0` 上）：顶点 `B` 落在原点、`BA` 沿 `+x`、`BC` 与它成 θ；
 * 两个边长取题面给的，没给就取**两个不等**的代表值（等长是等腰三角形 —— 题面没说）。
 *
 * **返回 `null` 表示"这一支不管"**：没有角关系、角不在 `(0°,180°)`、点名的三个点不在底面环上、
 * 或者题面还点了别的底面条件（平行/垂直/等长）—— 那些情况交给既有的分支去拒绝，
 * 而不是在这里猜一个形状出来。
 */
function deriveAngledTriangleBase(
  names: readonly string[],
  relations: readonly WitnessRelation[]
): { status: "ok"; polygon: Vector3[]; freeValues: string[]; assumptions: string[] } | WitnessConstructRejection | null {
  if (names.length !== 3 && names.length !== 4) return null
  const angle = relations.find((relation) => relation.kind === "planarAngle" && relation.targets.length === 3 && relation.targets.every((name) => names.includes(name)))
  if (angle === undefined || angle.kind !== "planarAngle") return null
  const [first, vertex, third] = angle.targets as [string, string, string]
  /**
   * **四边形只认"角在环上第二位"**（`∠ABC` 那种最常见的写法）：第四条边是按"从 `A` 出发、
   * 与 `BC` 成一个代表夹角"放出来的，顶点在别的位置时这条规则不再成立 —— 那时交给既有分支拒绝，
   * 而不是硬套一个形状。
   */
  if (names.length === 4 && vertex !== names[1]) return null
  /**
   * **别的底面条件在场时这一支不管**：把角摆好之后，平行/垂直/等长还得同时成立，
   * 那是联立问题（本层不做）—— 交给既有的拒绝分支，文案由它们给。
   */
  const otherBaseCondition = relations.some((relation) => {
    if (relation === angle) return false
    if (relation.kind === "segment-length") return false
    // 第二个角也是联立问题（两个角一起把底面钉住），本支不管。
    if (relation.kind === "planarAngle") return true
    // 面积同样点名了底环上的三个点 ⇒ 也是联立问题，本支不管（它属于平面图形那一支）。
    if (relation.kind === "area") return true
    return relation.segments.some((segment) => segment.every((name) => names.includes(name)))
  })
  if (otherBaseCondition) return null
  const stated = interpretValue(angle.value, null)
  if (stated === null) return reject("unsupported-base-shape", `底面点名的角 ${angle.targets.join("")} 没有可用的度数。`, [...names])
  if (!(stated.value > 0) || stated.value >= 180) {
    return reject("degenerate-base", `底面点名的角是 ${formatNumber(stated.value)}°：角的内部角必须在 0° 与 180° 之间（0 与 180 都是退化）。`, [...names])
  }
  const radians = (stated.value * Math.PI) / 180
  /**
   * 两条邻边的长度：题面给就用题面，没给取**不相等**的代表值 ——
   * 等长就是等腰三角形，那是题面没说的额外特殊性（与候选池"两条自由底边不许取相等"同一条账）。
   */
  const firstLength = statedLength(relations, [vertex, first])
  const thirdLength = statedLength(relations, [vertex, third])
  for (const side of [firstLength, thirdLength]) if (side.kind === "invalid") return side.rejection
  const firstStated = firstLength.kind === "value" ? firstLength.stated : null
  const thirdStated = thirdLength.kind === "value" ? thirdLength.stated : null
  const alongFirst = freeLength(firstStated, thirdStated, 0)
  const alongThird = freeLength(thirdStated, firstStated, 1)
  if (!alongFirst || !alongThird || !(alongFirst.value > 0) || !(alongThird.value > 0)) {
    return reject("degenerate-base", "底面自由边长必须为有限正数。", [...names])
  }
  /**
   * **第三条边（`${first}${third}`）不能是题面给的**：它由两条邻边与那个角决定，
   * 给了就得联立核对，本层不做 —— 如实拒绝而不是挑一个形状。
   */
  const acrossStated = statedLength(relations, [first, third])
  if (acrossStated.kind === "invalid") return acrossStated.rejection
  if (acrossStated.kind === "value") {
    return reject("unsupported-base-shape", `底面同时给了 ${first}${third} 的长度与 ${angle.targets.join("")} 的度数：第三条边由两条邻边与那个角决定（联立关系），本层不做这个求解。`, [...names])
  }
  const positions = new Map<string, Vector3>([
    [vertex, { x: 0, y: 0, z: 0 }],
    [first, { x: alongFirst.value, y: 0, z: 0 }],
    [third, { x: snapToZero(alongThird.value * Math.cos(radians)), y: snapToZero(alongThird.value * Math.sin(radians)), z: 0 }]
  ])
  /**
   * **四边形底面**（2026-10-10 补）：第四条边由一条**代表方向**给出 —— 从 `A` 出发、
   * 与 `BC` 的方向再转 **35°**、长度取 `AB` 的 **0.8**。
   *
   * 为什么是这个规则：四边形比三角形多一个自由度，而题面**只说了那个角**，
   * 所以剩下的必须取代表值；关键在于**不能顺手做出别的特殊关系**。这一组取值
   * （35° / 0.8）刻意避开三件事，并且**由判据逐条自算钉住**：
   * - **不与任何已有边平行**（`AD ∦ BC`、`AB ∦ DC`）—— 否则会悄悄把它变成梯形/平行四边形；
   * - **不出现直角**（四个顶点都不），也不出现两条相邻边等长（等腰/菱形那类）；
   * - 环仍然**凸**且不退化（四个叉积同号、面积非零）。
   *
   * 一个具体的反例说明为什么不能图省事：`D = A + k·C`（让第四条边顺着 `C` 的方向）
   * 会顺带做出 `AD ∥ BC` —— 那是题面没说的事（本仓对"悄悄加特殊性"一贯按缺陷处理）。
   */
  if (names.length === 4) {
    const leftover = names.find((name) => !positions.has(name))
    if (leftover === undefined) return reject("unsupported-base-shape", `底面点名表 ${names.join("")} 与角 ${angle.targets.join("")} 对不上。`, [...names])
    const representative = radians + (35 * Math.PI) / 180
    const reach = 0.8 * alongFirst.value
    positions.set(leftover, {
      x: snapToZero(positions.get(first)!.x + reach * Math.cos(representative)),
      y: snapToZero(positions.get(first)!.y + reach * Math.sin(representative)),
      z: 0
    })
  }
  const freeValues: string[] = []
  if (!firstStated) freeValues.push(`底面边长 ${vertex}${first} = ${formatNumber(alongFirst.value)}（系统自选）`)
  if (!thirdStated) freeValues.push(`底面边长 ${vertex}${third} = ${formatNumber(alongThird.value)}（系统自选）`)
  return {
    status: "ok",
    polygon: names.map((name) => positions.get(name)!),
    freeValues,
    assumptions: [`底面 ${names.join("")} 按题面点名的角 ${angle.targets.join("")} = ${formatNumber(stated.value)}° 放出来（顶点 ${vertex} 处、两条邻边按该角摆开；${freeValues.length === 0 ? "两条邻边的长度都来自题面" : "未给定的边长取系统自选的代表值"}）。${names.length === 4 ? "第四条边取代表方向（与另一条邻边再转 35°、长度取 0.8 倍），刻意不与任何已有边平行、也不做出直角 —— 那些都是题面没说的。" : ""}`]
  }
}

function deriveBasePolygon(
  names: readonly string[],
  relations: readonly WitnessRelation[]
): { status: "ok"; polygon: Vector3[]; freeValues: string[]; assumptions: string[] } | WitnessConstructRejection {
  const [first, second] = names
  if (names.length === 3) {
    const rotated = namedRightTriangleBase(names, relations)
    if (rotated[0] !== first) {
      const constructed = deriveBasePolygon(rotated, relations)
      if (constructed.status === "rejected") return constructed
      return { ...constructed, polygon: names.map((name) => constructed.polygon[rotated.indexOf(name)]) }
    }
  }
  if (names.length < 3 || names.length > 6) {
    return reject("unsupported-base-shape", `底面顶点数只支持 3–6（用户裁决的首批范围），收到 ${names.length} 个。`, [...names])
  }
  /**
   * **n = 5 / 6 先分流到"正 n 边形代表"**（S2）。
   *
   * 下面那套"环首直角 + 两条边 ⇒ 矩形"只对 3 / 4 边成立：四边形取 `names[3]` 当第二条边是对的
   * （它是 `AB` 的对边端点），而五边形以上 `names[2]` / `names[3]` **不再是环首的两条邻边**，
   * 沿用会把底面构造成一个题面没说的形状。所以在这里分流，n ≥ 5 不进入只适用 3/4 的分支。
   */
  if (names.length >= 5) return deriveRepresentativePolygon(names, relations)
  /**
   * **菱形**（S3）：四边两两相等时**先**走这一支。
   *
   * 必须排在"环首直角 ⇒ 矩形"**之前**：`菱形 + 直角` 落进矩形那一支会构造出**四边不等**的图形
   * —— 题面明说的"菱形"被静默画成矩形（本批的 RED 里实测过：那条反例当时是 `candidate`）。
   */
  if (names.length === 4 && hasEqualSideChain(names, relations)) return deriveRhombusBase(names, relations)
  /**
   * **归一化后环首直角的两条边**：三角形可先循环旋转到该角；四边形仍只收原环首。
   *
   * 四边形的第 3 个点 `C` 是 `AB` 的对边端点，不是直角的另一条边 —— 用它去要求 `AB ⊥ AC`
   * 会把这个最常见矩形的直角判错（第一版就是这么错的，RED 里 5 条构造用例一起失败）。
   *
   * 判据与底角探测同源（`baseEdgePerpendicular`）：**只认两端点都在底面环内的关系**，
   * 否则 `PB ⊥ AB` 这种"侧棱垂直于底面"的写法会被读成"底面在 A 处有直角"。
   */
  const third = names.length === 4 ? names[3] : names[2]
  const rightAngleAtFirst = baseEdgePerpendicular(relations, names, [first, second]) && baseEdgePerpendicular(relations, names, [first, third])
  if (!rightAngleAtFirst) {
    /**
     * **点名了数值角**（§3-F）：三角形底面闭式可做 —— 放在"普通三角形示例"**之前**，
     * 否则题面写的那个角会被一组代表值顶掉（那正是"悄悄换一个题面没说的形状"）。
     */
    const angled = deriveAngledTriangleBase(names, relations)
    if (angled !== null) return angled
    if (names.length === 3) return deriveRepresentativeTriangle(names, relations)
    /**
     * **两件事分开报**（§3-F 阶段 B 设计 §5.3）：底面缺什么，和"题面那个角为什么帮不上忙"。
     *
     * 原先只说"底面缺少点名在 A 处的直角" —— 当题面确实点名了一个角、只是那个角**不在环上**
     * （顶点／环外点参与）时，这句话会让用户去补一个错的条件。探针实测过这种误读
     *（`PA⊥平面ABCD，∠PBA=60°` 报的就是这一句，见阶段 B 设计 §0）。
     */
    const outOfRing = relations.find(
      (relation) => relation.kind === "planarAngle" && relation.targets.length === 3 && relation.targets.some((name) => !names.includes(name))
    )
    return reject(
      "unsupported-base-shape",
      `底面缺少「点名在 ${first} 处的直角」（${first}${second} ⊥ ${first}${third}）：首批不做通用非线性求解，无法唯一确定底面。${
        outOfRing === undefined || outOfRing.kind !== "planarAngle"
          ? ""
          : `题面点名的角 ${outOfRing.targets.join("")} 帮不上忙：它含底面环外的点（${outOfRing.targets.filter((name) => !names.includes(name)).join("、")}），所以它不能当底面的定形条件。`
      }`,
      [...names]
    )
  }

  const statedWidth = statedLength(relations, [first, second])
  if (statedWidth.kind === "invalid") return statedWidth.rejection
  const statedDepth = statedLength(relations, [first, third])
  if (statedDepth.kind === "invalid") return statedDepth.rejection
  const widthStated = statedWidth.kind === "value" ? statedWidth.stated : null
  const depthStated = statedDepth.kind === "value" ? statedDepth.stated : null
  const width = freeLength(widthStated, depthStated, 0)
  const depth = freeLength(depthStated, widthStated, 1)
  if (!width || !depth || !(width.value > 0) || !(depth.value > 0)) {
    return reject("degenerate-base", "底面点名了零或负的边长，围不出面积。", [first, second, third])
  }

  const freeValues: string[] = []
  const assumptions: string[] = []
  if (!widthStated) freeValues.push(`底面边长 ${first}${second} = ${formatNumber(width.value)}（系统自选）`)
  if (!depthStated) freeValues.push(`底面边长 ${first}${third} = ${formatNumber(depth.value)}（系统自选）`)

  const points: Vector3[] = []
  if (names.length === 4) {
    /**
     * 底面只要**在环首以外的顶点**还有直角，它就不是矩形而是直角梯形 ——
     * 构造出来的矩形是比题面更强的假设，所以拒绝，不把"额外特殊性"悄悄塞进图里。
     *
     * 判据用 `baseEdgePerpendicular`（复核 round 1 Minor 9 + round 2 R21）：
     * ① 跨所有 `perpendicular` 关系（"在 B 处垂直"可以拆成两条单段关系，要求"一条关系同时含两条边"
     *    就会 fail-open，把题面明说的直角梯形静默建成矩形）；
     * ② 但**只看两端点都在底面环内的关系** —— `PB ⊥ AB` / `PB ⊥ BC` 是"侧棱 ⊥ 底面"的自然写法，
     *    把它们当成底角会把完全合法的输入误拒（round 2 Important A 实测）。
     * 反过来，文案也不该断言"这就是梯形"：冗余点名第二个内角直角的矩形也会走到这里。
     */
    let internalRightAngle = -1
    for (let index = 1; index < names.length; index += 1) {
      const name = names[index]
      const before = names[(index + names.length - 1) % names.length]
      const after = names[(index + 1) % names.length]
      const hasInternalRightAngle = baseEdgePerpendicular(relations, names, [before, name]) && baseEdgePerpendicular(relations, names, [name, after])
      if (hasInternalRightAngle) {
        internalRightAngle = index
        break
      }
    }
    if (internalRightAngle > 0) {
      /**
       * **直角梯形底面**（2026-10-10 §3-F）：题面点名了**两个**底面上的直角，
       * 其中第二个在 **B** 处（`AB ⊥ BC`）。环首那条（`AB ⊥ AD`）已经由上面的判据要求过，
       * 于是 `AB` 被钉成 `AD` 与 `BC` 的**公垂线**，底面**闭式可构造**：
       * `A=(0,0)`、`B=(w,0)`、`C=(w,c)`、`D=(0,d)`（`c ≠ d` 才不是矩形）。
       *
       * 所以原先那句"首批不做通用非线性求解"在这一支上**不成立** —— 拒绝的理由
       *（"矩形是比题面更强的假设"）本身没错，错的是把它当成了只能拒的情形：
       * 这里能造出一个**只满足题面、不额外加直角**的图形，而且核验器查得了它
       *（`perpendicular` / `parallel` 都在既有判据里）。
       *
       * 三种输入各有各的正确答案：
       * - 只点这两条垂直 ⇒ 直角梯形（`AD ∥ BC` 是**推论**，不是我们额外加的假设）；
       * - 另外点名了 `BC ∥ AD` ⇒ 同上（与推论一致）；
       * - 另外点名了 `AB ∥ DC` ⇒ 四个角都是直角，**那就是矩形**，按矩形造（`c = d`）。
       *
       * **其余内部直角（在 C 或 D 处）仍旧拒绝**：配上环首直角，它们推出来的就是矩形，
       * 而题面没说那件事。
       */
      if (internalRightAngle === 1) {
        const third = names[2]!
        const fourth = names[3]!
        const statedOtherPair = baseEdgeParallel(relations, names, [first, second], [third, fourth])
        const statedDiagonal = statedLength(relations, [third, fourth])
        if (statedDiagonal.kind === "value") {
          return reject(
            "unsupported-base-shape",
            `底面点名了 ${third}${fourth} 的长度：它在直角梯形里由 ${first}${second}、${fourth}${first}、${second}${third} 决定（联立关系），本层不做这个求解。`,
            [...names]
          )
        }
        const statedOther = statedLength(relations, [second, third])
        if (statedOther.kind === "invalid") return statedOther.rejection
        const otherStated = statedOther.kind === "value" ? statedOther.stated : null
        /**
         * 与 `AD` 平行的 `BC` 取多长：
         * - 题面另外点名了 `AB ∥ DC` ⇒ 底面是矩形 ⇒ `c = d`（此时 `AD` 与 `BC` 必须一致，
         *   题面给了两个不同的长度就是**自相矛盾**，如实拒绝而不是挑一个）；
         * - 否则取**与 `AD` 不等**的代表值 —— 相等就不是梯形而是矩形，那是题面没说的额外特殊性
         *  （与候选池"两条自由底边不许取相等"同一条账）。
         */
        const other = statedOtherPair
          ? (otherStated && Math.abs(otherStated.value - depth.value) > 1e-12
            ? null // 落在下面统一拒绝：题面说自己矛盾了
            : { value: depth.value })
          : freeLength(otherStated, depth, 1)
        if (other === null) {
          return reject(
            "unsupported-base-shape",
            `底面同时点名了「${first}${second} ⊥ ${first}${third}」与「${second}${third} ⊥ ${first}${second}」，又说 ${first}${second} ∥ ${third}${fourth}` +
            `（那把底面推成矩形），可 ${names[3]}${first} 与 ${second}${third} 的长度给得不一样 —— 题面自相矛盾，不替它挑一个。`,
            [...names]
          )
        }
        if (!(other.value > 0)) return reject("degenerate-base", "底面自由边长必须为有限正数。", [...names])
        const freeValues: string[] = []
        if (!widthStated) freeValues.push(`底面边长 ${first}${second} = ${formatNumber(width.value)}（系统自选）`)
        if (!depthStated) freeValues.push(`底面边长 ${fourth}${first} = ${formatNumber(depth.value)}（系统自选）`)
        if (!otherStated) freeValues.push(`底面边长 ${second}${third} = ${formatNumber(other.value)}（系统自选）`)
        const shape = statedOtherPair ? "矩形" : "直角梯形"
        const because = statedOtherPair
          ? `题面点名了 ${first}${second} ∥ ${third}${fourth}，与两条垂直合起来就是矩形。`
          : `${first}${second} ⊥ ${first}${third} 且 ${first}${second} ⊥ ${second}${third} ⇒ ${fourth}${first} ∥ ${second}${third}（题面的推论，不是额外假设）；` +
            `${fourth}${first} 与 ${second}${third} 的长度不同（相等就成了矩形 —— 题面没说）。`
        return {
          status: "ok",
          polygon: [
            { x: 0, y: 0, z: 0 },
            { x: width.value, y: 0, z: 0 },
            { x: width.value, y: other.value, z: 0 },
            { x: 0, y: depth.value, z: 0 }
          ],
          freeValues,
          assumptions: [`底面 ${names.join("")} 取**${shape}**：${because}`]
        }
      }
      return reject(
        "unsupported-base-shape",
        `底面在 ${names[internalRightAngle]} 处另有一个点名直角：只有「${second} 处直角」那一支（直角梯形／矩形）能闭式构造，` +
        `在 ${names[2]} / ${names[3]} 处点直角配上环首直角会把底面推成矩形 —— 那是题面没说的特殊性，首批按更强的假设处理：拒绝。`,
        [...names]
      )
    }
    assumptions.push(`底面 ${names.join("")} 取矩形：${first}${second} ⊥ ${first}${third}，对边平行（第一批支持的标准底面）。`)
    points.push(
      { x: 0, y: 0, z: 0 },
      { x: width.value, y: 0, z: 0 },
      { x: width.value, y: depth.value, z: 0 },
      { x: 0, y: depth.value, z: 0 }
    )
  } else {
    assumptions.push(`底面 ${names.join("")} 取直角三角形：${first}${second} ⊥ ${first}${third}（第一批支持的标准底面）。`)
    points.push({ x: 0, y: 0, z: 0 }, { x: width.value, y: 0, z: 0 }, { x: 0, y: depth.value, z: 0 })
  }
  return { status: "ok", polygon: points, freeValues, assumptions }
}

/**
 * **顶点的解析构造**：只做"点名的垂足正上方"，高来自四种来源。
 *
 * 两种"由题面推出"的来源**性质不同**，别混为一谈（复核 round 1 更正）：
 * - 侧棱长度 `L`：**闭式**。垂足到该侧棱另一端点的水平距离 `d`（内核 `distanceVector3` 算），
 *   `h = √(L² − d²)`；
 * - 二面角 `θ`：**有界数值求根**，没有可用闭式。曾经的 `h = d·tanθ`（`d` = 垂足到铰链的垂距，
 *   "60° 时 `h = d√3`"）对常见的取法是**错的**：实测 `∠P-CD-A` 在 `d = 3` 的底面上
 *   要到 `h = 3√3` 才量出 60°，闭式在那个几何上给出的是补角的读法。
 *   现在交给 `solveDihedralHeight` 对内核自己的度量求根。
 */
function deriveApexHeight(input: {
  apexName: string
  foot: string
  heightSpec: WitnessHeightSpec
  relations: readonly WitnessRelation[]
  base: readonly Vector3[]
  baseNames: readonly string[]
}): { status: "ok"; value: number; note: string | null; assumed: boolean; derived: "none" | "lateral-edge" | "dihedral" | "planar-angle" } | WitnessConstructRejection {
  const { apexName, foot, base, baseNames } = input
  const at = (name: string): Vector3 | null => {
    const index = baseNames.indexOf(name)
    return index >= 0 ? base[index] : null
  }

  switch (input.heightSpec.kind) {
    case "free": {
      /**
       * **§3-F 阶段 B（B1）：题面点名了一个"顶点在环上、恰一条腿的另一个端点是本题顶点"的平面角**
       * （`∠PBA=60°`）时，先按那个角**有界求根**定高。
       *
       * 为什么放在 `free` 这一支：题面没给高时高本来就是个自由量，而这条角恰好**只含一个未知量**
       * （顶点在垂足正上方 ⇒ 位置由一个标量 `h` 决定）。题面**给了**高的时候不在这里动它 ——
       * 那时角是否成立由核验器如实判（构造期不做联立，见设计 §9）。
       */
      const fallback = interpretValue(input.heightSpec.value, 1)
      if (!fallback || !(fallback.value > 0)) return reject("degenerate-height", "自由高必须是一个正数。", [apexName, foot])
      const angled = solveApexAngleHeight({ apexName, foot, base, baseNames, relations: input.relations, freeHeight: fallback.value })
      if (angled !== null) return angled
      return { status: "ok", value: fallback.value, note: `${apexName} 的高 = ${formatNumber(fallback.value)}（系统自选）`, assumed: true, derived: "none" }
    }
    case "fixed": {
      const fixed = interpretValue(input.heightSpec.value, null)
      if (!fixed) {
        return reject("non-finite-value", `高 ${String(input.heightSpec.value)} 不是有限数值。`, [apexName, foot])
      }
      if (!(fixed.value > 0)) {
        return reject("degenerate-height", `高 ${formatNumber(fixed.value)} 不是正数：柱体会退化成平片。`, [apexName, foot])
      }
      return { status: "ok", value: fixed.value, note: null, assumed: false, derived: "none" }
    }
    case "lateral-edge": {
      const [first, second] = input.heightSpec.edge
      const given = interpretValue(input.heightSpec.length, null)
      if (!given || !(given.value > 0)) return reject("missing-height-reference", `侧棱 ${first}${second} 的长度不是有限正数。`, [first, second])
      const explicitLookup = statedLength(input.relations, [first, second])
      if (explicitLookup.kind === "invalid") return explicitLookup.rejection
      const explicit = explicitLookup.kind === "value" ? explicitLookup.stated : null
      const length = explicit && Math.abs(explicit.value - given.value) > DEGENERATE_TOLERANCE ? explicit : given
      /**
       * 侧棱的两个端点里，**一个是底面环上的点名顶点，另一个是顶点 `P`**。
       * 所以"水平距离"永远从**垂足**量起：垂足到另一个底面端点的距离。
       *（第一版写成"两个端点都在底面环上"，于是两个端点都取到垂足、水平距离恒为 0、`h` 直接等于棱长 —— 实测就是错的。）
       */
      const firstOnBase = baseNames.includes(first)
      const secondOnBase = baseNames.includes(second)
      if (firstOnBase === secondOnBase) {
        return reject(
          "missing-height-reference",
          `侧棱 ${first}${second} 的两个端点里应恰有一个在底面环上（另一个是顶点 ${apexName}）。`,
          [first, second]
        )
      }
      /**
       * 异侧的那个端点**必须是本题点名的顶点**（复核 round 1 Minor 10）：早先只断言
       * "恰有一个端点在底面上"，于是 `edge: ["Q","B"]` 配 `apex: "P"` 会拿一条题面里
       * 并不存在的 `QB` 去算 `P` 的高 —— 文案提了顶点名，却没有一处检查它。
       */
      const apexEndpoint = firstOnBase ? second : first
      if (apexEndpoint !== apexName) {
        return reject(
          "missing-height-reference",
          `侧棱 ${first}${second} 的异侧端点是 ${apexEndpoint}，但本题的顶点是 ${apexName}：无法用它确定顶点的高。`,
          [first, second, apexName]
        )
      }
      const horizontal = distanceVector3(at(foot) as Vector3, at(firstOnBase ? first : second) as Vector3)
      const squared = length.value * length.value - horizontal * horizontal
      if (!(squared > 0)) {
        return reject(
          "degenerate-height",
          `侧棱 ${first}${second} 长 ${formatNumber(length.value)} 不大于它的水平投影 ${formatNumber(horizontal)}，顶点无处可放。`,
          [first, second]
        )
      }
      const value = Math.sqrt(squared)
      return { status: "ok", value, note: `高由侧棱 ${first}${second} = ${formatNumber(length.value)} 解析求出：h = √(L² − ${first}${second}_水平²) = ${formatNumber(value)}`, assumed: false, derived: "lateral-edge" }
    }
    case "dihedral": {
      // 先把 spec 取到 const：TS 在 `find` 的回调里不会保留 `input.heightSpec` 的判别收窄。
      const spec = input.heightSpec
      const relation = input.relations.find((candidate) => candidate.kind === "dihedral" && matchesAngleRelation(candidate, spec.angleRelation))
      if (!relation || relation.kind !== "dihedral") {
        return reject("missing-height-reference", `没有找到题面点名的二面角关系 ${spec.angleRelation}。`, [apexName, foot])
      }
      const degrees = interpretValue(spec.value ?? relation.value, null)
      if (!degrees || !(degrees.value > 0) || !(degrees.value < 180)) {
        return reject("degenerate-height", `二面角 ${spec.angleRelation} 不是 (0°, 180°) 内的有限值。`, [apexName, foot])
      }
      const planes = relation.segments.filter((plane) => Array.isArray(plane) && plane.length >= 3)
      if (planes.length < 2) return reject("missing-height-reference", `二面角 ${spec.angleRelation} 需要两个点名的三点平面。`, [apexName, foot])
      const hinge = sharedEdge(planes[0], planes[1]) ?? sharedEdge(planes[1], planes[0])
      const hingePoints = hinge?.map(at)
      if (!hinge || !hingePoints || hingePoints.some((point) => !point)) {
        return reject("missing-height-reference", `二面角 ${spec.angleRelation} 的两个平面没有共享的点名棱。`, [apexName, foot])
      }
      const footPoint = at(foot)
      if (!footPoint) return reject("missing-height-reference", `垂足 ${foot} 不是底面环上的点名顶点。`, [foot])
      /**
       * 垂距只写进说明文字（让用户看懂"高是怎么来的"），**不再是判据**。
       *
       * 第一版拿它当解析式 `h = d·tanθ` 的输入，于是"垂距为 0 ⇒ 无解"被写成了硬守卫；
       * 但那个解析式本身就不对（见下面的求根说明），而且"垂足落在铰链上"并不意味着角度与高无关
       * —— 只要**顶点不在铰链上**（例如垂足取 B、铰链取 BD、另一个平面是 PBD），角度照样随高变化。
       * 现在由求根器判断有没有解：有解就接受，没有就结构化拒绝。
       */
      const distance = perpendicularDistanceToLine(footPoint, hingePoints[0] as Vector3, hingePoints[1] as Vector3)
      /**
       * **高度的求解方式：在 `h ∈ (0, H]` 上对内核自己的二面角度量做有界确定性扫描 + 二分。**
       *
       * 为什么不写死一个解析式：`h` 与"题面点名的两个平面之间的二面角"之间的关系不是
       * `h = d·tanθ` 那么简单 —— 它取决于顶点与底面各点落在铰链哪一侧、以及**用哪三个点点名那个面**
       *（同一几何、同一个平面，换一种记法就能量出补角）。第一版按 `h = d·tanθ` 直接给值，
       * 实测连"垂足不在铰链上"的简单例子都对不上（量出来是补角），于是"构造成功"与
       * "题面关系成立"被悄悄拆开了 —— 那正是本阶段最不能出的错。
       *
       * 所以这里改成：以**最终坐标**为目标函数，用内核同一个 `dihedralAngleDetail3` 求根，
       * 两种平面记法各试一次。**（2026-10-05 按实现改正：这句话是残留 —— 实际是**一次**度量。
       * `measureDihedralDegrees` 只调一次 `dihedralAngleDetail3`，而它的面内角由 `centroid(face)` 推出、
       * **与环序 / 参数顺序无关**，所以"把两种平面记法各试一次"那个守卫在 N2 就被判定为 **no-op 并删掉了**；
       * 注释里留着一句已不存在的行为，比没有注释更坏。）它仍然不是"通用非线性求解"（R18）：只有一个未知量、有界、
       * 固定步数、无 RNG，而且求的是**内核自己会承认的那个角**。求出来的高照样要由 2b 独立复核。
       */
      const height = solveDihedralHeight({
        baseNames,
        basePoints: base,
        apexName,
        footPoint,
        planes: [planes[0], planes[1]],
        targetDegrees: degrees.value,
        scale: base.reduce((largest, point) => Math.max(largest, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)), 1)
      })
      if (height === null) {
        return reject(
          "degenerate-height",
          `二面角 ${spec.angleRelation} = ${formatNumber(degrees.value)}° 在「顶点在 ${foot} 正上方」这一族里没有解（在该范围内求根失败）。`,
          [apexName, foot, ...hinge]
        )
      }
      return {
        status: "ok",
        value: height,
        note: `高由二面角 ${spec.angleRelation} = ${formatNumber(degrees.value)}° 求出：在垂足 ${foot} 正上方对内核的二面角度量求根，得 h = ${formatNumber(height)}（垂足到铰链 ${hinge.join("")} 的垂距 ${formatNumber(distance)}）`,
        assumed: false,
        derived: "dihedral"
      }
    }
    default:
      return reject("missing-height-reference", "未知的高来源。", [apexName, foot])
  }
}

/**
 * 角度关系的名字：`P-A-B`、`PAB`、`p a b` 都指同一个平面。
 *
 * 判据是**平面的顶点集合**（排序后比较），不是字符串相等 —— 题面写 `∠P-AB-C` 还是 `PABC`
 * 取决于抄写习惯，而它们说的是同一个二面角。分隔符与大小写一并归一化。
 */
function planeKey(plane: readonly string[]): string {
  return plane.map((name) => name.trim().toUpperCase()).sort().join("·")
}

function angleRelationKey(angleRelation: string): string {
  const letters = angleRelation.replace(/[^0-9A-Za-z\u4e00-\u9fff]+/g, " ").trim()
  if (letters.length === 0) return ""
  // `P-A-B` / `PAB`：按分隔符切不出三段时，退化成逐字符（题面里点名都是单字符）。
  const parts = letters.split(/\s+/).filter((part) => part.length > 0)
  if (parts.length >= 3) return planeKey(parts.slice(0, 3))
  const characters = [...letters.replace(/\s+/g, "")]
  return characters.length >= 3 ? planeKey(characters.slice(0, 3)) : ""
}

function matchesAngleRelation(relation: WitnessRelation, angleRelation: string): boolean {
  if (relation.kind !== "dihedral") return false
  const wanted = angleRelationKey(angleRelation)
  if (wanted.length === 0) return false
  return relation.segments.some((plane) => Array.isArray(plane) && plane.length >= 3 && planeKey(plane) === wanted)
}

function sharedEdge(first: readonly string[], second: readonly string[]): [string, string] | null {
  for (let index = 0; index < first.length; index += 1) {
    const start = first[index]
    const end = first[(index + 1) % first.length]
    if (second.includes(start) && second.includes(end)) return [start, end]
  }
  return null
}

/** 二面角自检的容差（度）。解析构造的浮点误差远小于它，而"内角 / 外角选错"的差是几十度。 */
const ANGLE_TOLERANCE_DEGREES = 1e-9

/**
 * 求根用的高度上限相对尺度（与底面尺度同量级，超出这个范围的高在画面上已经不成立）。
 * 加上固定采样段数 = 有界、确定性、无 RNG 的求根预算。
 */
const DIHEDRAL_HEIGHT_LIMIT = 1e3
const DIHEDRAL_SCAN_STEPS = 2048
const DIHEDRAL_BISECTION_STEPS = 200

/**
 * 在 `h ∈ (0, scale × DIHEDRAL_HEIGHT_LIMIT]` 上，对**内核自己的**二面角度量做确定性二分求根。
 *
 * 求的是"顶点在垂足正上方"这一族里能满足题面陈述二面角的**最小正高**：先按固定步数扫出
 * 第一个符号变化区间，再固定次数二分收敛。**不是闭式解**，也不做通用非线性求解（R18）：
 * 一个未知量、有界区间、固定步数、无 RNG，失败返回 `null`（由调用方转成结构化拒绝，不抛异常）。
 *
 * 平面**只按题面点名的三个点**取：对固定三点命名，读数与环绕向、参数顺序都无关
 * （见 `measureDihedralDegrees`），所以这里不做"换一种记法再试"——构造器不能自己发明
 * 题面没写的平面命名（复核 round 2 / R22）。
 *
 * 量的是**最终坐标**、用的是 2b 会用的同一个 `dihedralAngleDetail3`；构造器没有自证"满足题设"，
 * 只是不把"题面关系其实不成立"的候选交给下游。
 */
function solveDihedralHeight(request: {
  baseNames: readonly string[]
  basePoints: readonly Vector3[]
  apexName: string
  footPoint: Vector3
  planes: readonly (readonly string[])[]
  targetDegrees: number
  scale: number
}): number | null {
  const limit = Math.max(request.scale, 1) * DIHEDRAL_HEIGHT_LIMIT
  if (!Number.isFinite(limit) || limit <= 0) return null
  const residualAt = (height: number): number | null => {
    const apexPoint: Vector3 = { x: request.footPoint.x, y: request.footPoint.y, z: request.footPoint.z + height }
    const measured = measureDihedralDegrees(
      { baseNames: request.baseNames, basePoints: request.basePoints, apexName: request.apexName, apexPoint },
      request.planes
    )
    return measured === null ? null : measured - request.targetDegrees
  }

  let previousHeight = 0
  let previousResidual = residualAt(0)
  if (previousResidual !== null && Math.abs(previousResidual) <= ANGLE_TOLERANCE_DEGREES) return 0
  for (let step = 1; step <= DIHEDRAL_SCAN_STEPS; step += 1) {
    const height = (limit * step) / DIHEDRAL_SCAN_STEPS
    const residual = residualAt(height)
    if (residual === null) return null
    if (Math.abs(residual) <= ANGLE_TOLERANCE_DEGREES) return height
    if (previousResidual !== null && Math.sign(previousResidual) !== Math.sign(residual)) {
      let low = previousHeight
      let high = height
      let lowResidual = previousResidual
      for (let iteration = 0; iteration < DIHEDRAL_BISECTION_STEPS; iteration += 1) {
        const middle = (low + high) / 2
        const middleResidual = residualAt(middle)
        if (middleResidual === null) return null
        if (Math.abs(middleResidual) <= ANGLE_TOLERANCE_DEGREES) return middle
        if (Math.sign(middleResidual) === Math.sign(lowResidual)) {
          low = middle
          lowResidual = middleResidual
        } else {
          high = middle
        }
      }
      return (low + high) / 2
    }
    previousHeight = height
    previousResidual = residual
  }
  return null
}

/**
 * **§3-F 阶段 B 的求根预算**：与二面角同一套口径 —— 固定步数、无 RNG、失败返回 `null`
 *（由调用方转成结构化拒绝，不给近似值）。
 */
const APEX_ANGLE_SCAN_STEPS = 2048
const APEX_ANGLE_BISECTION_STEPS = 200
const APEX_ANGLE_HEIGHT_LIMIT = 1e3
/**
 * **常性判据的容差**（度）与两个采样高（相对底面尺度）。
 *
 * 为什么要有常性判据：`∠DAB` 这种角的腿可能**恰好沿底面法向**（`A` 是垂足），
 * 于是那个角**与高无关**、恒为 90°。这时"扫描没找到根"是**必然**的，而真正的信息是
 * "题面那条与其它条件不可能同时成立"（或"它本来就必然成立"）—— 两句话对用户完全不同。
 * 判据是**算出来的**：在两个明显不同的高上量同一个角，读数相同才算恒定。
 */
const APEX_ANGLE_CONSTANCY_TOLERANCE = 1e-6
const APEX_ANGLE_CONSTANCY_LOW = 1
const APEX_ANGLE_CONSTANCY_HIGH = 16

/** 一条含顶点（环外点）的平面角，按**点名形状**分类的结果。 */
type ApexAngleShape =
  | { kind: "solve"; vertex: string; apexEndpoint: string; ringEndpoint: string; degrees: number; label: string }
  /** 不是这一族（例如三个点名都在环上 = 阶段 A 的事），调用方照旧走自己的分支。 */
  | { kind: "skip" }
  /** 形状出了本层范围 / 联立 / 度数不可用：如实拒绝（把结构化拒绝原样带出去）。 */
  | { kind: "rejected"; rejection: WitnessConstructRejection }

/**
 * **认一认这条角属不属于 B1**：顶点在底面环上、**恰一条腿的另一个端点是本题顶点**（`∠PBA`）。
 *
 * 为什么分类放在这一层而不是解析层：**读**（`planarAngle`）不区分点名在不在环上，
 * 而"谁在环外"要看**底面环** —— 那是构造期才知道的事（设计 §1）。
 *
 * 三件事在这里一次说清（各自一个码/文案，不混成一句）：
 * - 两条以上的含顶点角同时在场 ⇒ **联立**（两个方程一个未知量），本层不做；
 * - 顶点本身是角的顶点、或两条腿的端点都在环外 ⇒ 要**两个以上未知量**，本层不做；
 * - 度数不可用 / 不在 `(0°, 180°)` ⇒ 如实拒绝（与阶段 A 同一条口径）。
 */
function classifyApexAngle(input: {
  apexName: string
  baseNames: readonly string[]
  relations: readonly WitnessRelation[]
}): ApexAngleShape {
  const angled = input.relations.filter(
    (relation): relation is Extract<WitnessRelation, { kind: "planarAngle" }> =>
      relation.kind === "planarAngle" && relation.targets.length === 3
  )
  const touching = angled.filter((relation) => relation.targets.some((name) => !input.baseNames.includes(name)))
  /** 这一层的拒绝都走同一个码（机器可读：形状出了范围）；具体是哪一种由文案说清。 */
  const refuse = (message: string, points: readonly string[]): ApexAngleShape => ({
    kind: "rejected",
    rejection: reject("unsupported-angle-shape", message, [...points])
  })
  if (touching.length === 0) return { kind: "skip" }
  if (touching.length > 1) {
    return refuse(
      `题面同时点名了 ${String(touching.length)} 个含顶点的角（${touching.map((relation) => relation.targets.join("")).join("、")}）：两个方程一个未知量是联立，本层不做。`,
      [...input.baseNames, input.apexName]
    )
  }
  const relation = touching[0]!
  const [first, vertex, third] = relation.targets as [string, string, string]
  const apexEndpoint = first === input.apexName ? first : third === input.apexName ? third : null
  const ringEndpoint = apexEndpoint === first ? third : first
  if (apexEndpoint === null || !input.baseNames.includes(vertex) || !input.baseNames.includes(ringEndpoint)) {
    return refuse(
      `点名角 ${relation.targets.join("")} 的形状出了本层范围：本层只做"角的顶点在底面环上、恰一条腿的另一个端点是本题顶点 ${input.apexName}"的角（如 ∠${input.apexName}AB）。顶点本身是角的顶点、或两条腿的端点都在环外时，位置要两个以上未知量才能定。`,
      [...relation.targets, input.apexName]
    )
  }
  if (new Set(relation.targets).size !== 3) {
    return refuse(`点名角 ${relation.targets.join("")} 的点名有重复，本层不猜它指哪个角。`, relation.targets)
  }
  const stated = interpretValue(relation.value, null)
  if (stated === null) {
    return refuse(`点名角 ${relation.targets.join("")} 没有可用的度数。`, relation.targets)
  }
  if (!(stated.value > 0) || stated.value >= 180) {
    return refuse(`点名角 ${relation.targets.join("")} 是 ${formatNumber(stated.value)}°：角的内部角必须在 0° 与 180° 之间。`, relation.targets)
  }
  return { kind: "solve", vertex, apexEndpoint, ringEndpoint, degrees: stated.value, label: relation.targets.join("") }
}

/**
 * 求根与常性判定的读数：`root` 是扫到的**最小正根**（没有就是 `null`），
 * `lowDegrees` / `highDegrees` 是**两个不同的高**上量到的同一个角（用来判"这个角与高无关"）。
 */
interface ApexAngleProbe {
  root: number | null
  lowDegrees: number | null
  highDegrees: number | null
}

/**
 * 在"顶点在垂足正上方"这一族里，对**内核自己的角度量**做有界求根，并顺带量两个高上的读数。
 *
 * 与 `solveDihedralHeight` 同一条口径：先固定步数扫描找第一个符号变化区间，再固定步数二分；
 * **单调性不假设**（只认符号变化），**取最小正根**（可复现）。量的是**候选的最终坐标**，
 * 不读构造过程的中间量。
 *
 * **两个读数为什么要一起给**：`∠DAB` 那种角的腿可能沿底面法向（`A` 是垂足），于**任何**高都满足它
 * —— 那时扫描会"立刻找到一个根"，而真相是"**这个角定不了高**"。调用方拿这两个读数就能把
 * "角把高定住了"与"角本来必然成立"分开说，而不是把后者说成前者（本块第一版就是那么说的，实测被自己的判据抓住）。
 */
function probeApexAngleHeight(request: {
  vertexPoint: Vector3
  ringPoint: Vector3
  footPoint: Vector3
  targetDegrees: number
  scale: number
}): ApexAngleProbe {
  const apexAt = (height: number): Vector3 => ({ x: request.footPoint.x, y: request.footPoint.y, z: request.footPoint.z + height })
  const measuredAt = (height: number): number | null => interiorAngleDegrees(request.vertexPoint, apexAt(height), request.ringPoint)
  const residualAt = (height: number): number | null => {
    const measured = measuredAt(height)
    return measured === null ? null : measured - request.targetDegrees
  }
  const sampleScale = Math.max(request.scale, 1)
  const lowDegrees = measuredAt(sampleScale * APEX_ANGLE_CONSTANCY_LOW)
  const highDegrees = measuredAt(sampleScale * APEX_ANGLE_CONSTANCY_HIGH)

  const limit = sampleScale * APEX_ANGLE_HEIGHT_LIMIT
  if (!Number.isFinite(limit) || limit <= 0) return { root: null, lowDegrees, highDegrees }
  let previousHeight = 0
  let previousResidual = residualAt(0)
  if (previousResidual !== null && Math.abs(previousResidual) <= ANGLE_TOLERANCE_DEGREES) {
    return { root: 0, lowDegrees, highDegrees }
  }
  for (let step = 1; step <= APEX_ANGLE_SCAN_STEPS; step += 1) {
    const height = (limit * step) / APEX_ANGLE_SCAN_STEPS
    const residual = residualAt(height)
    if (residual === null) break
    if (Math.abs(residual) <= ANGLE_TOLERANCE_DEGREES) return { root: height, lowDegrees, highDegrees }
    if (previousResidual !== null && Math.sign(previousResidual) !== Math.sign(residual)) {
      let low = previousHeight
      let high = height
      let lowResidual = previousResidual
      for (let iteration = 0; iteration < APEX_ANGLE_BISECTION_STEPS; iteration += 1) {
        const middle = (low + high) / 2
        const middleResidual = residualAt(middle)
        if (middleResidual === null) break
        if (Math.abs(middleResidual) <= ANGLE_TOLERANCE_DEGREES) return { root: middle, lowDegrees, highDegrees }
        if (Math.sign(middleResidual) === Math.sign(lowResidual)) {
          low = middle
          lowResidual = middleResidual
        } else {
          high = middle
        }
      }
      return { root: (low + high) / 2, lowDegrees, highDegrees }
    }
    previousHeight = height
    previousResidual = residual
  }
  return { root: null, lowDegrees, highDegrees }
}

/**
 * **空间里三点的内角**（度）：角在 `vertex` 处，两条边分别指向 `first` 与 `second`。
 *
 * **为什么不用 `dynamic-measurements` 的 `angleBetween`**：那个原语吃的是**二维** `Coordinate`
 * （只读 `x` / `y`）。顶点沿 `z` 抬高时，它在投影上与原方向**完全重合**，于是把那个角**恒量成 0°** ——
 * 本块第一版就是这么写的，四条判据当场红（"角与高无关、恒为 0°"）。教训照旧：
 * **一个原语在它自己的那条路上验过，不等于它在另一条路上也成立**。
 *
 * 这里与统一核验器的 `planarAngle` 判据**同一条规则**（归一化点积取 `acos`、夹到 `[-1, 1]`、出度），
 * 量的也是**最终坐标** —— 构造器与核验器算的是同一个角，才不会出现"构造说成立、核验说不是"。
 */
function interiorAngleDegrees(vertex: Vector3, first: Vector3, second: Vector3): number | null {
  const alongFirst = subtractVector3(first, vertex)
  const alongSecond = subtractVector3(second, vertex)
  const magnitudes = lengthVector3(alongFirst) * lengthVector3(alongSecond)
  if (!(magnitudes > 1e-12)) return null
  const cosine = dotVector3(alongFirst, alongSecond) / magnitudes
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
}

/**
 * **§3-F 阶段 B（B1）的入口**：题面点名了一条含顶点的平面角时，按它定高。
 *
 * 返回 `null` 表示"这一支不管这件事"（没有这种角，或角全在底面环上 = 阶段 A 的事），
 * 调用方照旧取自己的代表值 —— **不是**静默通过。
 *
 * 三种结局（设计 §4）：
 * - **角与高有关** ⇒ 用扫到的最小正根定高（最确定的那个）；
 * - **角与高无关且等于题面值** ⇒ **冗余成立**：高照旧取系统自选值，文案说明"它本来必然成立"；
 * - **角与高无关且不等于题面值** ⇒ **如实报矛盾**（说出恒为多少度），**不是**"没找到"。
 *   还有第四种：角随高变、但允许范围内取不到题面要的值 ⇒ 如实拒绝并报出**实测的变化范围**。
 */
function solveApexAngleHeight(input: {
  apexName: string
  foot: string
  base: readonly Vector3[]
  baseNames: readonly string[]
  relations: readonly WitnessRelation[]
  freeHeight: number
}): { status: "ok"; value: number; note: string | null; assumed: boolean; derived: "planar-angle" | "none" } | WitnessConstructRejection | null {
  const shape = classifyApexAngle({ apexName: input.apexName, baseNames: input.baseNames, relations: input.relations })
  if (shape.kind === "skip") return null
  if (shape.kind === "rejected") return shape.rejection

  const indexOfBase = (name: string): number => input.baseNames.indexOf(name)
  const vertexPoint = input.base[indexOfBase(shape.vertex)]
  const ringPoint = input.base[indexOfBase(shape.ringEndpoint)]
  const footPoint = input.base[indexOfBase(input.foot)]
  if (!vertexPoint || !ringPoint || !footPoint) {
    return reject("missing-height-reference", `点名角 ${shape.label} 的顶点 ${shape.vertex}、${shape.ringEndpoint} 或垂足 ${input.foot} 不在底面环上。`, [...shape.label.split("")])
  }
  const scale = Math.max(input.base.reduce((largest, point) => Math.max(largest, Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)), 1), 1)
  const probe = probeApexAngleHeight({ vertexPoint, ringPoint, footPoint, targetDegrees: shape.degrees, scale })

  /**
   * **先看"这个角是不是与高无关"**（两点实测），因为它决定**话怎么说**，而根决定**图画不画得出来**：
   * 角恒定时扫描必然"立刻找到根"（任何高都满足），如果照根那套文案说，就会把
   * "这个角定不了高"说成"高由这个角求出" —— 本块第一版正是这么说的，被自己的判据当场抓住。
   */
  const constant =
    probe.lowDegrees !== null && probe.highDegrees !== null && Math.abs(probe.lowDegrees - probe.highDegrees) <= APEX_ANGLE_CONSTANCY_TOLERANCE
      ? probe.lowDegrees
      : null
  if (constant !== null) {
    if (Math.abs(constant - shape.degrees) <= APEX_ANGLE_CONSTANCY_TOLERANCE) {
      return {
        status: "ok",
        value: input.freeHeight,
        note: `题面点名的角 ${shape.label} = ${formatNumber(shape.degrees)}° 由其它题设必然成立（实测它与顶点的高无关，恒为 ${formatNumber(constant)}°），高照旧取系统自选的 ${formatNumber(input.freeHeight)}`,
        assumed: true,
        derived: "none"
      }
    }
    return reject(
      "contradictory-angle",
      `点名角 ${shape.label} = ${formatNumber(shape.degrees)}° 与其它题设不可能同时成立：那个角与顶点的高无关（实测在两个不同的高上恒为 ${formatNumber(constant)}°），而它不等于题面要的值。`,
      [shape.vertex, shape.ringEndpoint, input.apexName]
    )
  }
  if (probe.root !== null) {
    return {
      status: "ok",
      value: probe.root,
      note: `高由题面点名的角 ${shape.label} = ${formatNumber(shape.degrees)}° 求出：在垂足 ${input.foot} 正上方对内核自己的角度量做有界求根，得 h = ${formatNumber(probe.root)}（非解析闭式）`,
      assumed: false,
      derived: "planar-angle"
    }
  }
  return reject(
    "unsupported-angle-shape",
    `点名角 ${shape.label} = ${formatNumber(shape.degrees)}° 在"顶点在 ${input.foot} 正上方"这一族里没有找到解：把高从 ${formatNumber(scale * APEX_ANGLE_CONSTANCY_LOW)} 扫到 ${formatNumber(scale * APEX_ANGLE_HEIGHT_LIMIT)}，实测这个角只在 ${formatNumber(probe.lowDegrees ?? 0)}° 到 ${formatNumber(probe.highDegrees ?? 0)}° 之间变化，取不到题面要的值。`,
    [shape.vertex, shape.ringEndpoint, input.apexName]
  )
}

/**
 * 用**内核自己的**二面角度量核对候选高，量的是"两个点名三点平面之间的内二面角"。
 *
 * ## 这个原语对什么敏感（复核 round 1 + round 2 更正）
 *
 * `dihedralAngleDetail3` 取"面内垂直于公共棱的方向"（`markers3d.ts` 的 `inwardPerpendicular`），
 * 而那是 `centroid(face) − hingeStart` 的垂线分量 —— `centroid` 是与顺序无关的平均，
 * 所以读数与参数顺序、与环的绕向**都无关**：`(a,b)`、`(b,a)` 与两种反转返回同一个
 * `interiorDegrees`（实测四个读数逐位相同）。
 *
 * **决定读数的是用哪三个点命名那个面**（形心随之改变，同一几何可以量出 `θ` 与其补角）。
 * 但那是**题面语义**：平面由题面点名的三个点给定，2b 通过 relation 的 `segments` 传进来，
 * 构造器**不能自己发明另一种命名**（复核 round 2 / R22 否决了"把环反转再试一次"的做法 ——
 * 对固定三点命名，反转是恒等的空操作，只会让失败路径多跑一遍 2048 步扫描）。
 * 所以这里就是**一次如实测量**：平面按题面点名的三个点取。
 *
 * 这是"构造器不许自证"的例外而非违反：它量的不是构造过程的中间量，而是**最终坐标**
 * 的几何，而且用的就是 2b 会用的那个函数（`dihedralAngleDetail3`）。
 */
function measureDihedralDegrees(
  shape: { baseNames: readonly string[]; basePoints: readonly Vector3[]; apexName: string; apexPoint: Vector3 },
  rings: readonly (readonly string[])[]
): number | null {
  const pointFor = (name: string): Vector3 | null => {
    if (name === shape.apexName) return shape.apexPoint
    const index = shape.baseNames.indexOf(name)
    return index >= 0 ? shape.basePoints[index] : null
  }
  const [firstRing, secondRing] = rings
  const hinge = sharedEdge(firstRing, secondRing) ?? sharedEdge(secondRing, firstRing)
  if (!hinge) return null
  const start = pointFor(hinge[0])
  const end = pointFor(hinge[1])
  if (!start || !end) return null
  const first = firstRing.map(pointFor)
  const second = secondRing.map(pointFor)
  if (first.some((point) => !point) || second.some((point) => !point)) return null
  const detail = dihedralAngleDetail3(first as Vector3[], second as Vector3[], start, end)
  return detail ? detail.interiorDegrees : null
}

/** 点到**直线**（`start`–`end`）的垂距：`|v − (v·û)û|`。内核自己没有这个函数，但只用既有向量原语。 */
function perpendicularDistanceToLine(point: Vector3, start: Vector3, end: Vector3): number {
  const direction = subtractVector3(end, start)
  const length = lengthVector3(direction)
  if (!(length > 0)) return distanceVector3(point, start)
  const unit = normalizeVector3(direction)
  const offset = subtractVector3(point, start)
  const projection = dotVector3(offset, unit)
  const perpendicular = subtractVector3(offset, { x: unit.x * projection, y: unit.y * projection, z: unit.z * projection })
  return lengthVector3(perpendicular)
}
