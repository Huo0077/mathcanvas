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

export type WitnessConstructRequest = PyramidConstructRequest | PrismConstructRequest | FrustumConstructRequest

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
     */
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
  if (names.length !== 3) return null
  const angle = relations.find((relation) => relation.kind === "planarAngle" && relation.targets.length === 3 && relation.targets.every((name) => names.includes(name)))
  if (angle === undefined || angle.kind !== "planarAngle") return null
  const [first, vertex, third] = angle.targets as [string, string, string]
  /**
   * **别的底面条件在场时这一支不管**：把角摆好之后，平行/垂直/等长还得同时成立，
   * 那是联立问题（本层不做）—— 交给既有的拒绝分支，文案由它们给。
   */
  const otherBaseCondition = relations.some((relation) => {
    if (relation === angle) return false
    if (relation.kind === "segment-length") return false
    // 第二个角也是联立问题（两个角一起把底面钉住），本支不管。
    if (relation.kind === "planarAngle") return true
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
  const freeValues: string[] = []
  if (!firstStated) freeValues.push(`底面边长 ${vertex}${first} = ${formatNumber(alongFirst.value)}（系统自选）`)
  if (!thirdStated) freeValues.push(`底面边长 ${vertex}${third} = ${formatNumber(alongThird.value)}（系统自选）`)
  return {
    status: "ok",
    polygon: names.map((name) => positions.get(name)!),
    freeValues,
    assumptions: [`底面 ${names.join("")} 按题面点名的角 ${angle.targets.join("")} = ${formatNumber(stated.value)}° 放出来（顶点 ${vertex} 处、两条邻边按该角摆开；${freeValues.length === 0 ? "两条邻边的长度都来自题面" : "未给定的边长取系统自选的代表值"}）。`]
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
    return reject(
      "unsupported-base-shape",
      `底面缺少「点名在 ${first} 处的直角」（${first}${second} ⊥ ${first}${third}）：首批不做通用非线性求解，无法唯一确定底面。`,
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
}): { status: "ok"; value: number; note: string | null; assumed: boolean; derived: "none" | "lateral-edge" | "dihedral" } | WitnessConstructRejection {
  const { apexName, foot, base, baseNames } = input
  const at = (name: string): Vector3 | null => {
    const index = baseNames.indexOf(name)
    return index >= 0 ? base[index] : null
  }

  switch (input.heightSpec.kind) {
    case "free": {
      const fallback = interpretValue(input.heightSpec.value, 1)
      if (!fallback || !(fallback.value > 0)) return reject("degenerate-height", "自由高必须是一个正数。", [apexName, foot])
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
