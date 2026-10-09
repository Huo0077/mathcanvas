import { buildFromPoints, constructShapeFromSpec, createBuilderContext, hasEqualSideChain, namedRightTriangleBase, shapeHeightIsFree, type FreeScalar, type ShapeScalarChoice, type SolidShapeSpec, type Vector3, type WitnessRelation, type WitnessShapeCandidate } from "@draw/geometry-kernel"

import { parseShapeClause, type RecognisedShape } from "./shapeGrammar"
import { createEmptyDocument } from "@draw/dsl"

import { evidenceStatusForWitness, type ClaimEvidence, type ClaimEvidenceStatus, type GeometryObligation, type SolverStatus, type WitnessResultStatus } from "../claimEvidence"
import { PLAN_SCHEMA_VERSION, type PlanEnvelope } from "../contracts"
import type { DiagramObligationSet } from "../diagramObligations"
import { verifyDiagramObligations, type DiagramVerificationReport } from "../diagramVerification"
import { toLegacyObligationSet, type ObligationIR } from "../obligationIR"
import { compilePlan } from "../planCompiler"
import { verifyRelations, type RelationLookup } from "../relations"
import {
  WITNESS_SEARCH_CODES,
  type PolyhedronWitness,
  type PolyhedronWitnessSelection,
  type PolyhedronWitnessSelectionInput,
  type WitnessSearchInput,
  type WitnessSearchResult
} from "./solverContracts"

/**
 * **见证搜索的编排层**（N2 子任务 2b；计划 N2 的 Ownership / R13 / R15 / R16 / R25 / R26 / R32 / R34）。
 *
 * ## 这一层拥有的东西，与它**不许**拥有的东西
 *
 * 拥有：候选池、seed、上限与预算、排序、失败分类、`ClaimEvidence`，以及**既有 polyhedron
 * 候选的筛选与排序**（R13：这段逻辑从 `underdetermined.ts` 搬到这里，只留一份）。
 *
 * 不拥有：任何几何判据。坐标由内核 `witness/` 的解析构造器产出，形状自检由内核的
 * `residuals.ts` 负责，**题设是否成立**只由 `verifyDiagramObligations` +
 * `buildFromPoints` 判定（R15：不允许求解器自证）。这一层连一次点积都不算。
 *
 * ## 候选的一生（也是判据的唯一路径）
 *
 * ```text
 * ObligationIR（题设 + 解析残留 + 自由选择）    ← N1 的 IR，与产品路径同一份（R32）
 *   → toLegacyObligationSet(ir)               ← N1 的兼容适配：桥到核验器要的旧结构
 *   → constructWitnessShape(request)          ← 内核 2a：解析构造 / 结构化拒绝
 *   → buildFromPoints(...)                    ← 内核：拓扑构造（绕向 / 共面 / 零体积）
 *   → 一封单动作信封（solid.create_polyhedron，带 vertexNames）
 *   → compilePlan(envelope, ...)              ← **产品用的那条**物化路径，不另造文档
 *   → verifyDiagramObligations(legacy, envelope, draftDocument)   ← 唯一的判定
 * ```
 *
 * 所以"候选合格了吗"这个问题的答案只有一处，不存在第二套残差或第二个判据。
 * 注意第一行：入参是 **IR 而不是裸数组**（R32）—— 早先这里只把 `role === "given"` 的
 * claim 交出去、还写死"没有残留"，那等于关掉核验器里"读不出的子句必须显形"那道强制守卫，
 * 于是搜索器能对一个产品路径会判 `unverified` 的题面报 `verified_instance`。
 *
 * ## 解析构造优先，有限网格只扫构造器已暴露的自由标量（R26）
 *
 * 解析候选（题面关系 → 2a 的默认特值）永远排第一；它没能通过核验时，才在**自由标量**
 * 上做有限网格：底面两条自由边长与自由高。**不做通用约束求解**（R18）：
 * 取值表是固定的小整数、无连续优化、无 RNG（只有一个由 seed 决定的排列）。
 *
 * ## 分类口径（R25）
 *
 * 三值 `status` 不变；原因落到 `ClaimEvidence.status`：
 * 预算耗尽 → `timeout`；题设自相矛盾且能给出冲突证据 → `inconsistent`；
 * 找到候选但验不过 / 无法判定 → `unknown`。每条 `failures` / `reasons` 都以机器可读码开头。
 * **文案纪律**：超时一律写成"在预算内没有找到"，绝不写成"不存在见证"。
 *
 * ## 一个仍然开放的出口：自由度（R33）
 *
 * Global Constraints 要求保留自由度，而本层**这一轮仍然不填**（`degreesOfFreedom: null`）：
 * N1 的 `reportFreeDegrees` 收的是 DSL 的 `ConstraintSpec[]`，那套词表装不下线 ⊥ 面与二面角
 * （详见 `evidenceFor` 的注释与报告 §11.3）。按裁决"诚实努力后仍无法在不编造的前提下填出 ⇒
 * 停下报告"，这一项归 N3。**不是"忘了算"**：`null` 在这套词表里的含义正是"没有算过"。
 */

/** 自由底面边长的候选值：小整数（规格 §6.3 的优先级），2 是 2a 的默认值。 */
const FREE_BASE_VALUES: readonly number[] = [2, 3, 4]
/** 自由高的候选值：1 是 2a 的默认值，所以网格从 2 起（默认那组由解析候选负责）。 */
const FREE_HEIGHT_VALUES: readonly number[] = [2, 3]

/**
 * "耐看"的下限：`readabilityOf < 1/4` 的候选在画布上已经读成一根杆子。
 *
 * 这是**偏好**，不是约束：题面强制要求（例如点名 `PA=10` 而底面尺寸也由题面钉死）时，
 * 仍然会返回它 —— 内核真正的拒绝判据是 `residuals.ts` 的长宽比上限（1e6 量级），
 * 两者一个是"难看"，一个是"不可信"，不能互相代替。
 */
const READABILITY_FLOOR = 0.25

/** 单次搜索的输入回显（进 assumptions / failures），**不含耗时** —— 结果必须可重现。 */
function configLine(input: WitnessSearchInput, considered: number): string {
  return `witness-search: seed=${String(input.seed)} candidates=${considered} maxCandidates=${String(input.maxCandidates)} timeoutMs=${String(input.timeoutMs)}`
}

/**
 * 候选的"耐看程度"：三个轴向尺度里最小 / 最大。平移与旋转不影响它。
 *
 * 这是**偏好**，不是判据：它只决定"同样合格的两个候选先看哪个"。
 */
export function readabilityOf(vertices: readonly Vector3[]): number {
  if (vertices.length === 0) return 0
  const spans = (["x", "y", "z"] as const).map((axis) => {
    const values = vertices.map((vertex) => vertex[axis])
    return Math.max(...values) - Math.min(...values)
  })
  const largest = Math.max(...spans)
  return largest > 0 ? Math.min(...spans) / largest : 0
}

/**
 * **既有 polyhedron 候选的筛选与排序**（R13 的唯一实现）。
 *
 * 顺序就是规格 §6.3 的优先级，两步都不可省：
 * ① 先验题目显式关系（不满足的跳过，理由进 `considered`）；
 * ② 再验几何合法性 —— 判据来自内核 `buildFromPoints`（共面 / 自交 / 零体积 / 绕向 /
 *    连通性），与真正落盘时用的是同一个构造器。
 *
 * 排序用 `readabilityOf`，**只是偏好**：同样合格的两个候选里挑更耐看的那个；
 * 完全同等可读时保持输入顺序（稳定 tie-break），所以调用方的候选顺序仍然有意义。
 */
export function selectPolyhedronWitness(input: PolyhedronWitnessSelectionInput): PolyhedronWitnessSelection {
  const considered: string[] = []
  const candidates = input.candidates ?? []
  const relations = input.relations ?? []
  const accepted: { witness: PolyhedronWitness; index: number; readability: number }[] = []

  for (const [index, candidate] of candidates.entries()) {
    if (candidate.names.length !== candidate.vertices.length || new Set(candidate.names).size !== candidate.names.length) {
      considered.push(`names: 候选 ${index} 顶点名与坐标没有一一对应，不能核验。`)
      continue
    }
    const byName = new Map(candidate.names.map((name, position) => [name, candidate.vertices[position]]))
    const lookup: RelationLookup = (target) => byName.get(target.vertex) ?? null
    const check = verifyRelations(relations, lookup)
    if (!check.ok) {
      considered.push(`relations: 候选 ${index} 未满足 ${check.failures.map((failure) => failure.id).join("、")} —— ${check.failures[0].detail}`)
      continue
    }

    // The same kernel constructor used for the final solid rejects degenerate topology.
    const built = buildFromPoints({ vertices: candidate.vertices, faces: candidate.faces }, createBuilderContext())
    if (built.diagnostics.length > 0) {
      considered.push(`degenerate: 候选 ${index} 几何不合法 —— ${built.diagnostics.map((entry) => entry.message).join("；")}`)
      continue
    }

    accepted.push({ witness: candidate, index, readability: readabilityOf(candidate.vertices) })
    considered.push(`accepted: 候选 ${index} 关系逐条成立、几何合法。`)
  }

  if (accepted.length === 0) return { status: "none", considered }
  // Stable tie-breaking: an equally readable candidate keeps its input order.
  const chosen = accepted.reduce((best, current) => current.readability > best.readability ? current : best)
  considered.push(`chosen: 候选 ${chosen.index} 在合格图中比例更适合观察。`)
  return { status: "selected", candidate: chosen.witness, index: chosen.index, considered }
}

// ---------------------------------------------------------------- 题设 → 结构（只有一种读法）

interface LineAndPlane {
  line: [string, string]
  plane: string[]
  sourceText: string
}

/**
 * 认出一条"线段 ⊥ 平面"的题设。
 *
 * **为什么按 targets 的长度还原切点**：解析器给这类写法的 targets 是扁平的
 * `[线段两端点, 平面上的每个点名]`（`PA ⊥ 平面 ABCD` → 6 个），而且**没有** `planeLengths`
 * —— 那是 `平面X⊥平面Y` 才有的字段。线段固定两个字母、平面固定三或四个，所以
 * 长度 5 / 6 只能来自"2 + 3"与"2 + 4"；长度 4 一律是"线段 ⊥ 线段"。
 * 若将来解析器补上 `planeLengths`，这里优先采信它（并在不一致时宁可不当成线面垂直）。
 */
function lineAndPlane(obligation: GeometryObligation): LineAndPlane | null {
  if (obligation.kind !== "perpendicular") return null
  const targets = obligation.targets
  // 线段 2 个点名 + 平面 3–6 个点名 ⇒ 5–8 个；长度 4 一律是"线段 ⊥ 线段"。
  if (targets.length < 5 || targets.length > 8) return null
  const plane = targets.slice(2)
  if (plane.length < 3 || plane.length > 6) return null
  if (new Set(plane).size !== plane.length) return null
  const lengths = obligation.geometry?.planeLengths
  if (lengths && (lengths[0] !== 2 || lengths[1] !== plane.length)) return null
  return { line: [targets[0], targets[1]], plane, sourceText: obligation.sourceText }
}

/**
 * **题设自相矛盾**（R25 要求搜索器能给出冲突证据）。
 *
 * 只查两条**不需要算几何**就能断定的冲突，因为它们给出的是"题设本身无解"这个结论，
 * 而不是"我没试出来"：
 * ① 同一条线段被给了两个不同的长度；
 * ② 一条线段的两个端点都在它自称垂直的那个点名平面内（线在面内不可能垂直于该面）。
 *
 * 其余"看起来矛盾"的输入（例如同时 ⊥ 与 ∥）不在这里断言 —— 那需要几何推理，
 * 由统一核验器按残差说话，结论只会是"没找到"，不会被升级成"矛盾"。
 */
function findContradiction(givens: readonly GeometryObligation[]): { code: string; message: string } | null {
  const lengths = new Map<string, { value: number; sourceText: string }>()
  for (const obligation of givens) {
    if (obligation.kind !== "fixedLength" || obligation.targets.length !== 2 || typeof obligation.expected !== "number") continue
    const key = [...obligation.targets].sort().join("|")
    const seen = lengths.get(key)
    if (seen === undefined) {
      lengths.set(key, { value: obligation.expected, sourceText: obligation.sourceText })
      continue
    }
    if (Math.abs(seen.value - obligation.expected) > 1e-9) {
      return {
        code: WITNESS_SEARCH_CODES.contradictoryGiven,
        message: `${seen.sourceText} 与 ${obligation.sourceText} 对同一条线段给出了不同的长度（${String(seen.value)} 与 ${String(obligation.expected)}），题设自相矛盾。`
      }
    }
  }
  for (const obligation of givens) {
    const entry = lineAndPlane(obligation)
    if (!entry) continue
    if (entry.plane.includes(entry.line[0]) && entry.plane.includes(entry.line[1])) {
      return {
        code: WITNESS_SEARCH_CODES.contradictoryLinePlane,
        message: `${entry.sourceText} 里的线段 ${entry.line.join("")} 两个端点都在所点名的平面内，线在面内不可能垂直于该平面。`
      }
    }
  }
  return null
}

/** 交给内核构造器的两两写法。 */
function kernelRelations(givens: readonly GeometryObligation[]): WitnessRelation[] {
  const relations: WitnessRelation[] = []
  for (const obligation of givens) {
    const targets = obligation.targets
    if (obligation.kind === "perpendicular" && targets.length === 4) {
      relations.push({ kind: "perpendicular", segments: [[targets[0], targets[1]], [targets[2], targets[3]]] })
      continue
    }
    if (obligation.kind === "parallel" && targets.length === 4) {
      relations.push({ kind: "parallel", segments: [[targets[0], targets[1]], [targets[2], targets[3]]] })
      continue
    }
    if (obligation.kind === "equalLength" && targets.length === 4) {
      relations.push({ kind: "equal-length", segments: [[targets[0], targets[1]], [targets[2], targets[3]]] })
      continue
    }
    if (obligation.kind === "fixedLength" && targets.length === 2 && typeof obligation.expected === "number") {
      relations.push({ kind: "segment-length", segments: [[targets[0], targets[1]]], value: obligation.expected })
    }
    /**
     * "线段 ⊥ 平面"**不翻译**：内核构造器的 `WitnessRelation` 只有两两写法，
     * 硬拆成"线段 ⊥ 平面上的某条边"会把一个更强的命题降级成一条更弱的、可能不成立的命题。
     * 它由判定侧逐字核验（`verifyDiagramObligations` 的线面垂直残差），构造侧只需要
     * 顶点与垂足这个位置关系 —— 而那已经由 `derivePyramidStructure` 读出来了。
     */
  }
  return relations
}

interface PyramidStructure {
  base: string[]
  apex: string
  foot: string
  relations: WitnessRelation[]
  /** 题面**没有**给长度的底面两条边（`AB` 与 `AD`）：它们才是网格可以扫的自由标量。 */
  freeBaseEdges: [string, string][]
}

type StructureResult = { status: "ok"; structure: PyramidStructure } | { status: "rejected"; code: string; message: string }

type StructureResultOf<T> = { status: "ok"; structure: T } | { status: "rejected"; code: string; message: string }

interface PrismStructure {
  base: string[]
  /** 题面点名的那个**顶面**顶点（`AA′` 里的 `A′`）。其余顶面点名由内核按同一规则生成，spec 不预判。 */
  top: string
  foot: string
  relations: WitnessRelation[]
  freeBaseEdges: [string, string][]
}

/**
 * **直棱柱的结构**（S3 第一刀）。
 *
 * 只收"侧棱 ⊥ 底面"这一种写法（`AA′⊥平面ABC`）—— 那**就是直棱柱的定义**，也正好对上内核
 * 现有的拉伸接口：`WitnessExtrusionSpec` 的 `{kind:"points"}` 分支**按设计就是不可用的**
 * （底面顶点一律建在 z = 0，`to − from` 永远落在底面内，必被零体积判据拒成 `degenerate-extrusion`；
 * 见 `constructors.ts` 里那段"首批边界"）。所以**斜棱柱这一批不做**，理由写在拒绝文案里，
 * 不硬凑一个题面没说的形状。
 */
function derivePrismStructure(givens: readonly GeometryObligation[]): StructureResultOf<PrismStructure> {
  const entries = givens.map(lineAndPlane).filter((entry): entry is LineAndPlane => entry !== null)
  const usable = entries.find((entry) => entry.plane.includes(entry.line[0]) !== entry.plane.includes(entry.line[1]))
  if (!usable) {
    return {
      status: "rejected",
      code: WITNESS_SEARCH_CODES.unsupportedShape,
      message: entries.length === 0
        ? "题面没有给出「某条侧棱 ⊥ 底面」的写法（例如 `AA′⊥平面ABC`），无法确定底面环与拉伸方向。"
        : "题面里那条「侧棱 ⊥ 平面」的两个端点都不在所点名的平面内，无法确定底面环与拉伸方向。"
    }
  }
  const base = usable.plane
  const foot = base.includes(usable.line[0]) ? usable.line[0] : usable.line[1]
  const top = foot === usable.line[0] ? usable.line[1] : usable.line[0]
  /**
   * 顶面点名必须是底面那个点的**带撇写法**：内核的顶面命名由 `withPrimes` 生成（`A` → `A′`），
   * 与 `AA′` 这种题面一致。写成 `AA₁` 时内核仍生成 `A′` —— 同一个点、两套写法，
   * **本批不擅自改名**（改名等于把题面写的名字换掉），如实拒绝并说清怎么改题面。
   * ASCII 撇 `'` 与 `′` 是同一种后缀的两种字形（`pointNames` 已如此定义），比较前归一。
   */
  const normalized = top.replace(/'/g, "′")
  if (normalized !== `${foot}′`) {
    return {
      status: "rejected",
      code: WITNESS_SEARCH_CODES.unsupportedShape,
      message: `顶面点名 ${top} 与内核的顶面命名约定（${foot}′）不一致；本批不做名字映射，请按 ${foot}′ 出题。`
    }
  }
  const relations = kernelRelations(givens)
  const { freeBaseEdges } = orderedBaseWithFreeEdges(base, relations)
  // 侧棱长度**不在这一层判**：它就在 `relations` 里，由内核的 `shapeHeightIsFree` 读（一份判断，一处写）。
  return { status: "ok", structure: { base: [...base], top: normalized, foot, relations, freeBaseEdges } }
}

/**
 * **从题设读出底面环与顶点**（首批唯一的读法）。
 *
 * 底面环来自"线段 ⊥ 平面"那句里点名的平面（题面写 `平面 ABCD` 就是环 `A→B→C→D`）；
 * 线段两端点里**落在环内**的那个是垂足，另一个是顶点。这三件事一旦确定，其余全是 2a 的事。
 *
 * 读不出来就明确拒绝（`unsupported-shape`）：首批不做通用非线性求解，
 * 也不会去猜一个题面没说的底面 —— 那正是"特值化悄悄改题"的老毛病。
 */
function derivePyramidStructure(givens: readonly GeometryObligation[]): StructureResult {
  const entries = givens.map(lineAndPlane).filter((entry): entry is LineAndPlane => entry !== null)
  const usable = entries.find((entry) => entry.plane.includes(entry.line[0]) !== entry.plane.includes(entry.line[1]))
  if (!usable) {
    return {
      status: "rejected",
      code: WITNESS_SEARCH_CODES.unsupportedShape,
      message: entries.length === 0
        ? "题面没有给出「某条线段 ⊥ 某个点名平面」的写法，首批无法确定底面环、垂足与顶点。"
        : "题面里那条「线段 ⊥ 平面」的两个端点都不在所点名的平面内，无法确定垂足与顶点。"
    }
  }

  const base = usable.plane
  const foot = base.includes(usable.line[0]) ? usable.line[0] : usable.line[1]
  const apex = foot === usable.line[0] ? usable.line[1] : usable.line[0]
  const relations = kernelRelations(givens)
  const { orderedBase, freeBaseEdges } = orderedBaseWithFreeEdges(base, relations)

  return {
    status: "ok",
    structure: { base: [...orderedBase], apex, foot, relations, freeBaseEdges }
  }
}

/**
 * 底面环（按内核口径旋转到"点名直角在环首"）+ 环上**题面没给长度**的那两条边。
 *
 * 棱锥与棱柱**共用这一份判断**：底面的解析构造本来就只有一条规则（内核的 `deriveBasePolygon`），
 * 两族各写一遍必然分叉。
 */
function orderedBaseWithFreeEdges(base: readonly string[], relations: readonly WitnessRelation[]): { orderedBase: string[]; freeBaseEdges: [string, string][] } {
  // A unique explicitly named triangular right corner may differ from the ring start.
  // Use the kernel rule so free-edge choices and materialised coordinates agree.
  const orderedBase = namedRightTriangleBase(base, relations)
  /**
   * **n ≥ 5 的底面没有"可选的底边"**：内核走**正 n 边形代表**（一条边长定全部），
   * 那条边长由内核自己写进 `freeValues`。旧的 `[3] : [2]` 规则在 n = 5 时会把**对角线** `AC`
   * 当成自由底边 —— 正五边形里 `AC` 由边长决定，把它说成"系统自选"是**假的自由**。
   */
  if (orderedBase.length >= 5) return { orderedBase, freeBaseEdges: [] }
  const stated = new Set(relations.filter((relation) => relation.kind === "segment-length").flatMap((relation) => relation.segments.map((segment) => [...segment].sort().join("|"))))
  const first = orderedBase[0]
  const second = orderedBase[1]
  const third = orderedBase.length === 4 ? orderedBase[3] : orderedBase[2]
  if (first === undefined || second === undefined || third === undefined) return { orderedBase, freeBaseEdges: [] }
  /**
   * **菱形只有一条自由底边**（S3）：四边相等，`AD` 由 `AB` 决定 —— 把 `AD` 也说成"系统自选"
   * 是**假的自由**，而且候选池那条"两条自由底边不许取相等"会保证 `AB ≠ AD`，
   * 于是每个候选都在构造期与"四边相等"打架（RED 里实测：整池被拒、搜索报 `no_witness`）。
   * 与上面 n ≥ 5 那条"没有可选底边"同源：自由标量必须真的自由。
   */
  const rhombus = orderedBase.length === 4 && hasEqualSideChain(orderedBase, relations)
  const candidates = (rhombus ? [[first, second]] : [[first, second], [first, third]]) as [string, string][]
  const freeBaseEdges = candidates.filter((edge) => !stated.has([...edge].sort().join("|")))
  return { orderedBase, freeBaseEdges }
}

// ---------------------------------------------------------------- 候选池（解析优先 + 有限网格）

interface CandidatePlan {
  /**
   * **形状描述 + 这一候选选定的自由标量** —— 内核 `constructShapeFromSpec` 的全部输入。
   *
   * 这里**不再**由本层拼 `WitnessConstructRequest`：那张翻译表整张都是内核词汇
   * （`segment-length` / `WitnessHeightSpec` / `WitnessExtrusionSpec`），放在这里
   * 等于让每个调用方各维护一份 —— 与设计 §3.2"加新形状时不改编排层"直接冲突。
   */
  spec: SolidShapeSpec
  choices: ShapeScalarChoice[]
  /** 排序键：只累加我们选定的自由标量；题面已定的部分对所有候选都一样，比它没有意义。 */
  sizeKey: number
}

/**
 * 由 seed 决定的确定性排列（LCG + Fisher–Yates，无 `Math.random`、无时间）。
 *
 * 它**只**用来给"优先级完全相同"（同样的 `sizeKey`）的候选排先后，
 * 所以同一 seed 必然同一顺序、同一结果（R26）；不同 seed 只在这类并列上才有差别。
 */
function seededOrder<T>(values: readonly T[], seed: number): T[] {
  const items = [...values]
  let state = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = next() % (index + 1)
    const held = items[index]
    items[index] = items[swap]
    items[swap] = held
  }
  return items
}

/**
 * **把今天的棱锥结构表述成 `SolidShapeSpec`**（S2.1 的第一步迁移）。
 *
 * 这一步是**换载体、不是换行为**：底面、顶点/垂足、关系原样搬过去；自由标量按搜索层今天
 * 真正会扫的那几个来 —— 题面没给长度的底边（`base-edge`）与题面没定的高（`height`，
 * 只在 `heightSpec.kind === "free"` 时存在）。
 *
 * 候选值表存的是**固定值表**（`FREE_BASE_VALUES` / `FREE_HEIGHT_VALUES`）；
 * "这一次按什么顺序试"仍留在搜索层的 `seededOrder` 里 —— 放进 spec 会让同一份形状描述随 seed 变形。
 */
function specFor(structure: PyramidStructure | PrismStructure): SolidShapeSpec {
  const freeScalars: FreeScalar[] = structure.freeBaseEdges.map((edge, index) => ({
    id: `base-edge-${index + 1}`,
    kind: "base-edge" as const,
    targets: [...edge],
    candidates: [...FREE_BASE_VALUES]
  }))
  const isPrism = "top" in structure
  const skeleton: SolidShapeSpec = isPrism
    ? { family: "prism", base: [...structure.base], top: [structure.top], relations: [...structure.relations], freeScalars }
    : { family: "pyramid", base: [...structure.base], apex: { at: structure.apex, foot: structure.foot }, relations: [...structure.relations], freeScalars }
  /**
   * "高是不是自由的"**问内核**（`shapeHeightIsFree`）：它才是"`relations` → `WitnessHeightSpec`"
   * 那份判断的持有者。编排层再写一遍就是同一个判断写两遍，而两处迟早会分叉。
   */
  if (shapeHeightIsFree(skeleton)) {
    freeScalars.push({ id: "height", kind: "height", targets: isPrism ? [structure.top] : [structure.apex], candidates: [...FREE_HEIGHT_VALUES] })
  }
  return skeleton
}

/**
 * **台体的相似比取值表**：表里全是"明显不是 1、也不接近 0"的比例。
 * `1` 是棱柱、`0` 是棱锥顶点，两个端点都**不是**台体（内核会拒），所以一个都不放。
 */
const FREE_TOP_SCALE_VALUES: readonly number[] = [0.5, 0.6, 0.75]

/**
 * **台体：由入口语法给的底环 / 顶环 + 解析器给的关系组出 spec**（S6 的接线）。
 *
 * 台体的几何**不是从某一句题设读出来的**（棱锥 / 棱柱靠"侧棱 ⊥ 底面"那句定底环与拉伸），
 * 所以它的两个环只能来自**入口语法**（`在四棱台ABCD-A′B′C′D′中`）。
 * 自由标量与其他族同一个口径：题面没定长的底边、未定的高，外加台体自己的相似比。
 */
function specForFrustum(rings: RecognisedShape, relations: readonly WitnessRelation[]): SolidShapeSpec {
  const { orderedBase, freeBaseEdges } = orderedBaseWithFreeEdges(rings.base, relations)
  const top = [...(rings.top ?? [])]
  const freeScalars: FreeScalar[] = freeBaseEdges.map((edge, index) => ({
    id: `base-edge-${index + 1}`,
    kind: "base-edge" as const,
    targets: [...edge],
    candidates: [...FREE_BASE_VALUES]
  }))
  const skeleton: SolidShapeSpec = { family: "frustum", base: orderedBase, top, relations: [...relations], freeScalars }
  // "高是不是自由的"**问内核**（与棱锥 / 棱柱同一个判据），不在这一层再判一遍。
  if (shapeHeightIsFree(skeleton)) {
    freeScalars.push({ id: "height", kind: "height", targets: [top[0] ?? orderedBase[0]!], candidates: [...FREE_HEIGHT_VALUES] })
  }
  freeScalars.push({ id: "top-scale", kind: "top-scale", targets: top, candidates: [...FREE_TOP_SCALE_VALUES] })
  return skeleton
}

/**
 * **斜棱柱的代表斜向**（S3）：侧棱与底面法向的夹角。
 *
 * 题面只说"斜"、没说斜多少 ⇒ 取一个**代表值**并写进假设（系统自选），与"正 n 边形代表"
 * （n ≥ 5 的底面）、"菱形代表角 60°"同一条口径。**不取 0**（那是直棱柱，与题面矛盾），
 * 也不取 90°（侧棱躺进底面，围不出体积）。
 */
const OBLIQUE_TILT_DEGREES = 60

/**
 * **斜棱柱：由入口语法给的底环 / 顶环 + 解析器给的关系组出 spec**（S3）。
 *
 * 与台体同一条理由：斜棱柱的拉伸方向**不是从某句题设读出来的**（题面只说"斜"），
 * 所以两个环只能来自**入口语法**（`在斜三棱柱ABC-A′B′C′中`）。斜向由 `lateralTiltDegrees`
 * 交给内核（那里的拉伸向量按它算），其余自由标量与其他族同一个口径。
 */
function specForObliquePrism(rings: RecognisedShape, relations: readonly WitnessRelation[]): SolidShapeSpec {
  const { orderedBase, freeBaseEdges } = orderedBaseWithFreeEdges(rings.base, relations)
  const top = [...(rings.top ?? [])]
  const freeScalars: FreeScalar[] = freeBaseEdges.map((edge, index) => ({
    id: `base-edge-${index + 1}`,
    kind: "base-edge" as const,
    targets: [...edge],
    candidates: [...FREE_BASE_VALUES]
  }))
  /**
   * `top` 沿用直棱柱那一支的形状（**单个**顶面点名，即拉伸的落点）：内核的棱柱分支只吃
   * `base` + 拉伸向量，顶面其余点名由 `withPrimes` 按同一规则生成 —— spec 不预判。
   */
  const skeleton: SolidShapeSpec = {
    family: "prism",
    base: orderedBase,
    top: [top[0] ?? `${orderedBase[0]!}′`],
    relations: [...relations],
    freeScalars,
    lateralTiltDegrees: OBLIQUE_TILT_DEGREES
  }
  // "高是不是自由的"**问内核**（与棱锥 / 棱柱 / 台体同一个判据），不在这一层再判一遍。
  if (shapeHeightIsFree(skeleton)) {
    freeScalars.push({ id: "height", kind: "height", targets: [top[0] ?? orderedBase[0]!], candidates: [...FREE_HEIGHT_VALUES] })
  }
  return skeleton
}

/** `specForPrompt` 的结果：要么一份可用的 spec，要么**问路**的理由。 */export type PromptShapeResult =
  | { status: "ok"; spec: SolidShapeSpec; recognised: RecognisedShape }
  | { status: "unrecognised"; reason: string }

/**
 * **题面 → 形状描述**（S6 接线的入口）：把入口语法、形状推导、自由标量表三样接起来。
 *
 * 规划器与离线 benchmark 都从这里拿 spec，再交给 `searchWitness({ shape, spec })` ——
 * **一份解析两处用**，两个读数才可比（设计 §3.2）。
 *
 * 两条纪律：
 * - 认不出形状从句 ⇒ `unrecognised`（问路），**不猜**；
 * - 形状从句与"侧棱 ⊥ 底面"那句**各读一遍**，读出来的底环**不是同一组顶点** ⇒ 也问路。
 *   顺序可以不同（环首由内核规则定），**集合不同**说明有一边读错了，那时不挑一个信。
 */
export function specForPrompt(prompt: string, givens: readonly GeometryObligation[]): PromptShapeResult {
  const recognised = parseShapeClause(prompt)
  if (recognised === null) {
    return { status: "unrecognised", reason: "题面里没有可识别的『在…中』形状从句（或缺点名表 / 数词与环长对不上）。" }
  }
  /**
   * **「斜」与「侧棱 ⊥ 底面」互相矛盾**（S3 斜棱柱第一刀）。
   *
   * "斜棱柱"的定义就是**侧棱不垂直于底面**；同一句里再写 `AA′⊥平面ABC` 是自相矛盾的题面。
   * 修饰词此前在正则里被非捕获组吃掉，于是这种句子会被**当成直棱柱画出来**并一路绿到提交
   * （题面说斜、系统画直）—— 正是本仓最忌的"悄悄换一个题面没说的形状"。
   * 判据：**入口层问路**（`unrecognised`）并说清矛盾在哪，与"认不出就问路"同一条纪律。
   */
  if (recognised.family === "prism" && recognised.modifier === "斜") {
    const linePlane = givens.map(lineAndPlane).filter((entry): entry is LineAndPlane => entry !== null)
    if (linePlane.length > 0) {
      return {
        status: "unrecognised",
        reason: "题面写的是「斜…棱柱」，同时又给出了「线段 ⊥ 平面」（这里读成了侧棱 ⊥ 底面）—— 斜棱柱的侧棱不垂直于底面，这两句互相矛盾，请确认要哪一种。"
      }
    }
    /**
     * **斜棱柱的正例**（用户裁决：**代表斜向 + 假设**，不引入"环外点名顶点"概念）。
     *
     * 没有"侧棱 ⊥ 底面"那句可读时，两个环只能来自**入口语法**（与台体同一条理由）：
     * `在斜三棱柱ABC-A′B′C′中` 已经把底环与顶环都写清楚了；"斜多少"题面没说，
     * 由 `OBLIQUE_TILT_DEGREES` 取一个**代表值**并写进 assumptions（系统自选，不是题面说的）。
     */
    return { status: "ok", spec: specForObliquePrism(recognised, kernelRelations(givens)), recognised }
  }
  const relations = kernelRelations(givens)
  if (recognised.family === "frustum") return { status: "ok", spec: specForFrustum(recognised, relations), recognised }
  const derived = recognised.family === "prism" ? derivePrismStructure(givens) : derivePyramidStructure(givens)
  if (derived.status === "rejected") return { status: "unrecognised", reason: `${derived.code}: ${derived.message}` }
  const spec = specFor(derived.structure)
  const key = (names: readonly string[]): string => [...names].sort().join("|")
  if (key(spec.base) !== key(recognised.base)) {
    return {
      status: "unrecognised",
      reason: `形状从句的底环 ${recognised.base.join("")} 与「侧棱 ⊥ 底面」那句读出来的底环 ${spec.base.join("")} 不是同一组顶点：两处各读一遍，读不一样就问路。`
    }
  }
  return { status: "ok", spec, recognised }
}

/**
 * 候选池：**解析候选第一**，然后是有限网格。
 *
 * 网格的轴**从 spec 的自由标量读**（R26）：题面没给长度的那两条底面边、以及题面没定的高。
 * 两轴同时自由时取笛卡尔积（这正是"题面只给关系"时唯一说得通的兜底），
 * 但取值表是固定的小整数（各 3 / 2 个），所以池子的规模有上界，`maxCandidates` 只会在尾部截断。
 */
function candidatePool(spec: SolidShapeSpec, input: WitnessSearchInput): CandidatePlan[] {
  const pool: CandidatePlan[] = [{ spec, choices: [], sizeKey: 0 }]
  /**
   * **对 spec 里的每个自由标量做笛卡尔积**（按它们在 spec 里的顺序），取值顺序由 seed 决定。
   *
   * 写在 spec 的自由标量上、而不是写死"两条底边 + 高"，是为了让**加一族形状时这一层不用改** ——
   * 台体的 `top-scale`（相似比）就是靠这条进来的。这正是"形状数据化"要换来的东西。
   *
   * **一条特例保留**：两条底面边同时自由时不许取相等 —— 那会顺带把底面做成正方形，
   * 是题面没说的额外特殊性。判据只看 `base-edge` 这一类，别的标量可以相等。
   */
  const kindById = new Map(spec.freeScalars.map((scalar) => [scalar.id, scalar.kind]))
  const axes = spec.freeScalars.map((scalar, index) => seededOrder(scalar.candidates, input.seed + index))
  let combos: ShapeScalarChoice[][] = [[]]
  spec.freeScalars.forEach((scalar, index) => {
    const next: ShapeScalarChoice[][] = []
    for (const combo of combos) {
      for (const value of axes[index]!) {
        const clashesWithFreeEdge = scalar.kind === "base-edge"
          && combo.some((choice) => kindById.get(choice.id) === "base-edge" && choice.value === value)
        if (clashesWithFreeEdge) continue
        next.push([...combo, { id: scalar.id, value }])
      }
    }
    combos = next
  })

  const grid: CandidatePlan[] = []
  for (const choices of combos) {
    /**
     * **没有自由标量时不要产候选**（R34 / M4）：空组合与解析候选**逐字节相同** ——
     * 它会白吃一个 `maxCandidates` 名额，还会把 `candidates=N` 报大，让"我试了几种"这句话失真。
     */
    if (choices.length === 0) continue
    // 排序键只累加我们选定的自由标量；题面已定的部分对所有候选都一样。
    const sizeKey = choices.reduce((total, choice) => total + choice.value * choice.value, 0)
    grid.push({ spec, choices, sizeKey })
  }
  // 小整数优先（规格 §6.3 的优先级）：同键的先后由 seed 决定（上面那几次排列 + 这里的稳定排序）。
  grid.sort((left, right) => left.sizeKey - right.sizeKey)
  pool.push(...grid)
  return pool
}

// ---------------------------------------------------------------- 判定（唯一路径）

type CandidateJudgement =
  /** 连坐标都没拿到（内核解析构造拒绝 / 拓扑拒绝 / 物化失败）：`code` 是机器可读的原因。 */
  | { kind: "rejected"; code: string; message: string }
  /** 拿到了坐标并且**真的量过**：`outcome` 是统一核验器的三值结论。 */
  | {
    kind: "judged"
    outcome: "verified" | "failed" | "unverified"
    witness: WitnessShapeCandidate
    report: DiagramVerificationReport
    residuals: Record<string, number | null>
    lines: string[]
  }

function envelopeFor(names: readonly string[], vertices: readonly Vector3[], faces: readonly (readonly number[])[]): PlanEnvelope {
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind: "plan",
    goal: "按题设关系构造一组候选坐标（见证搜索）",
    factIds: [],
    actions: [{
      actionId: "solid.create_polyhedron",
      actionKey: "witness-search",
      factIds: [],
      inputs: {
        alias: "witness-search",
        vertexNames: [...names],
        vertices: vertices.map((point) => ({ ...point })),
        faces: faces.map((ring) => [...ring])
      }
    }]
  }
}

function residualsOf(report: DiagramVerificationReport): Record<string, number | null> {
  const residuals: Record<string, number | null> = {}
  for (const check of report.checks) {
    residuals[check.sourceText] = typeof check.actual === "number" && typeof check.expected === "number"
      ? check.actual - check.expected
      : null
  }
  return residuals
}

function toWitness(witness: WitnessShapeCandidate): PolyhedronWitness {
  return {
    // `names` / `points` / `faces` / `buildOrder` 共用**同一套下标空间**（2a 的接口注释）：
    // 按 buildOrder 同时重排坐标与名字，面环原样交给内核 —— 只搬其中一边会把顶点认错。
    vertices: witness.buildOrder.map((index) => ({ ...witness.points[index] })),
    names: witness.buildOrder.map((index) => witness.names[index]),
    faces: witness.faces.map((ring) => [...ring])
  }
}

/**
 * **`buildOrder` 恒等吗**（R34 / M7）。
 *
 * `faces` 与 `points` 共用同一套下标空间 —— 这正是"按 `buildOrder` 重排坐标、面环原样交给内核"
 * 这条写法成立的前提（2a 的接口注释写着它当前恒为恒等映射）。前提破了以后，面环与重排后的顶点
 * 会**错位**，而那未必立刻非法：可能只是换成另一只有效多面体，于是错得静悄悄。
 * 所以这里把它变成一条可执行的前提检查（导出是为了能单独验它）。
 */
export function isIdentityBuildOrder(buildOrder: readonly number[], vertexCount: number): boolean {
  return buildOrder.length === vertexCount && buildOrder.every((index, position) => index === position)
}

/**
 * 一个候选的完整判定。三步都不能省，顺序也不能换：
 * 构造（2a）→ 拓扑（内核 `buildFromPoints`）→ 物化（既有编译路径）→ 判定（唯一核验器）。
 */
function judgeCandidate(plan: CandidatePlan, legacy: DiagramObligationSet): CandidateJudgement {
  const constructed = constructShapeFromSpec(plan.spec, plan.choices)
  if (constructed.status === "rejected") {
    return { kind: "rejected", code: constructed.code, message: constructed.message }
  }
  const witness = constructed.witness
  if (!isIdentityBuildOrder(witness.buildOrder, witness.points.length)) {
    return {
      kind: "rejected",
      code: WITNESS_SEARCH_CODES.buildOrderNotIdentity,
      message: `2a 给出的 buildOrder 不是恒等映射（${witness.buildOrder.join(", ")}）：faces 与 points 的下标空间前提不成立，本层不猜。`
    }
  }
  const vertices = witness.buildOrder.map((index) => witness.points[index])
  const topology = buildFromPoints({ vertices: vertices.map((point) => ({ ...point })), faces: witness.faces.map((ring) => [...ring]) }, createBuilderContext())
  if (topology.diagnostics.length > 0) {
    const [first] = topology.diagnostics
    return { kind: "rejected", code: WITNESS_SEARCH_CODES.topologyRejected, message: `${first.code}：${first.message}` }
  }

  const envelope = envelopeFor(witness.buildOrder.map((index) => witness.names[index]), vertices, witness.faces)
  const compiled = compilePlan(envelope, { document: createEmptyDocument("geometry3d"), conversationId: "witness-search" })
  if (compiled.draftDocument === null) {
    const detail = compiled.diagnostics.map((entry) => `${entry.code}@${entry.path}: ${entry.detail}`).join("；")
    return { kind: "rejected", code: WITNESS_SEARCH_CODES.materialisationFailed, message: detail.length > 0 ? detail : "既有编译路径没有产出候选文档。" }
  }

  const report = verifyDiagramObligations(legacy, envelope, compiled.draftDocument)
  const residuals = residualsOf(report)
  const outcome = report.status === "passed" ? "verified" : report.status === "failed" ? "failed" : "unverified"
  const lines = report.checks
    .filter((check) => check.status !== "passed")
    .map((check) => check.status === "failed"
      ? `${WITNESS_SEARCH_CODES.failedGiven}: ${check.sourceText}：${check.reason}`
      : `${WITNESS_SEARCH_CODES.unverified}: ${check.sourceText}：${check.reason}`)
  return { kind: "judged", outcome, witness, report, residuals, lines }
}

// ---------------------------------------------------------------- 证据（R16 + R25）

function nextActionsFor(status: ClaimEvidenceStatus): string[] {
  if (status === "verified_instance") return ["可以用这组坐标继续落盘；要升级成“对所有情形成立”仍需 N5 的证明产物。"]
  if (status === "inconsistent") return ["题设自相矛盾：先与用户确认这几条条件本身，再谈作图。"]
  if (status === "timeout") return ["提高 timeoutMs 或放宽 maxCandidates 后重试 —— 这是“没算完”，不是“无解”。"]
  return ["补齐点名映射，或把这条条件交给后续阶段的判据；不要按“已通过”处理。"]
}

/**
 * **搜索结果 → 证据**（R16：只走 N1 那张表 `evidenceStatusForWitness`）。
 *
 * R25 允许搜索器覆盖两处，且只有这两处：预算耗尽 → `timeout`；题设自相矛盾 →
 * `inconsistent`（`claimEvidence.ts` 的注释写明"若 N2 的搜索器真能给出冲突证据，
 * 那时由搜索器自己报"）。其余一律由那张表翻译。
 *
 * **`SolverStatus` 的五个值里，这一层只产出四个**（R34 / M6 的口径写在这里，不写在报告里）：
 * `model` / `unknown` / `unsat` / `timeout`。`diverged` 与 `not_run` **不可达**，理由是结构性的：
 * 候选坐标全部来自内核的**有界解析构造**（2a 会先拒掉非有限值与不可表示的尺度，
 * 见 `non-finite-value` / `extreme-scale`），网格本身又是固定小整数、无迭代 ——
 * 没有"迭代发散"这条路径；而走到"出证据"这一步就说明搜索已经跑过，所以也不是 `not_run`。
 * 为了让枚举看起来用满而编一个永不发生的状态，正是本项目最忌讳的那种"看起来算过"。
 */
function evidenceFor(
  result: WitnessResultStatus,
  residuals: Record<string, number | null>,
  override?: { status: ClaimEvidenceStatus; solver: SolverStatus }
): ClaimEvidence {
  return {
    status: override?.status ?? evidenceStatusForWitness(result),
    solver: override?.solver ?? (result === "verified_instance" ? "model" : "unknown"),
    residuals,
    /**
     * **自由度这一轮仍然诚实地留空**（R33 的结论；裁决授权"停下报告，不要伪造"）。
     *
     * Global Constraints 要"solver 结果保留自由度"，N1 的唯一实现是
     * `reportFreeDegrees(document, constraints)`，而它收的是 **DSL 的 `ConstraintSpec[]`**
     *（`packages/dsl/src/types.ts` 的 `ConstraintType` 只有
     * parallel / perpendicular / coincident / pointOnLine / pointOnPlane / collinear /
     * coplanar / fixedDistance，且 `parallel`/`perpendicular` 要的是**线状图元 id**）。
     *
     * 这套词表**装不下**本题设里最关键的几条：线 ⊥ 平面（`planePerpendicular` 与 6 点 targets 的
     * `perpendicular`）与二面角（`dihedral`）根本没有对应类型；`equilateral` / `equalLength` /
     * `segmentRatio` / `midpoint` 只能用"把**当前实测**长度写死成 `fixedDistance.value`"来表达 ——
     * 那是拿候选自证，而且会顺手把题面留着的公共尺度自由度算掉。
     * 部分映射会给出一个**看不出少算了**的数，比 `null` 更误导；`null` 在这套词表里的含义
     * 正是"没有算过"。所以这里保持 `null`，把 dof 归到 N3（拖动自由度本来就是它的主题），
     * 等约束词表能表达线 ⊥ 面与角度时再算。
     */
    degreesOfFreedom: null,
    nextActions: nextActionsFor(override?.status ?? evidenceStatusForWitness(result))
  }
}

// ---------------------------------------------------------------- 入口

/**
 * 入参守卫（R32）：`WitnessSearchInput.obligations` 是 N1 的 `ObligationIR`。
 *
 * 输入来自不可信的一侧（模型草稿 → Worker → 库），所以**只**做形状守卫：
 * 坏形状退化成"没有题设 / 没有残留"，绝不抛异常跨边界（这是本包一贯的口径）。
 * 注意残留字段缺省成空数组**不是**在"洗白题设"：调用方本来就没有给出残留，
 * 而只要它给了（`parseObligationWithLegacy(prompt).ir` 一定给），就会被原样送到核验器。
 */
function normaliseObligationIR(ir: ObligationIR | undefined | null): ObligationIR {
  const obligations = Array.isArray(ir?.obligations) ? ir.obligations : []
  const unverified = Array.isArray(ir?.unverified) ? ir.unverified : []
  return {
    obligations: [...obligations],
    unverified: unverified.map((entry) => ({ sourceText: entry.sourceText, reason: entry.reason }))
  }
}

/**
 * **搜索一个通过核验的候选**（计划 N2 的 `WitnessSearchInput` / `WitnessSearchResult`）。
 *
 * 保证：
 * - 同一个 seed + 同样的题面 + 同样的预算 ⇒ 同样的结果（没有时钟进入排序，只有 `timeoutMs` 会终止搜索）；
 * - `verified_instance` 只可能来自统一核验器的 `passed`；
 * - 不给不出的时候，一定说清是哪一种给不出（超时 / 矛盾 / 不支持 / 没验过）。
 */
export function searchWitness(input: WitnessSearchInput): WitnessSearchResult {
  /** R32：入参是 N1 的 `ObligationIR`（题设 + 解析残留）。守卫按"库边界"对待，坏形状退化成空。 */
  const ir = normaliseObligationIR(input.obligations)
  const givens = ir.obligations.filter((obligation) => obligation.role === "given")

  /**
   * **棱柱那两条旧依赖都已解开**（2026-10-07）：这段原先写着两句话 ——
   * ① "原话解析只保留单个大写字母点名（`A′` 会被截成 `A`）" ⇒ **S1.2 起解析器认 `A′` / `A₁`**；
   * ② "核验器的点名映射只接受 `/^[A-Z]$/`" ⇒ **S1.3 起两边共用 `pointNames` 的同一份定义**。
   * 两条都不再成立，所以 `prism` 现在走 `derivePrismStructure`，不再从这里提前返回。
   */
  const providedSpec = input.spec
  if (providedSpec !== undefined && providedSpec.family !== input.shape) {
    return {
      status: "unverified_instance",
      evidence: evidenceFor("unverified_instance", {}),
      reasons: [`${WITNESS_SEARCH_CODES.unsupportedShape}: 调用方给的形状描述是 ${providedSpec.family}，与 shape=${input.shape} 不一致；不猜。`, configLine(input, 0)]
    }
  }
  if (input.shape === "polyhedron") {
    /**
     * "任意多面体"这一族如实报"系统尚不支持"：它的候选坐标只能由调用方给出
     * （`selectPolyhedronWitness` 负责筛选），搜索器不凭空造坐标。
     */
    return {
      status: "unverified_instance",
      evidence: evidenceFor("unverified_instance", {}),
      reasons: [`${WITNESS_SEARCH_CODES.requiresCandidates}: 任意多面体的候选坐标必须由调用方给出（见 selectPolyhedronWitness），搜索器不自造坐标。`, configLine(input, 0)]
    }
  }
  if (providedSpec === undefined && input.shape === "frustum") {
    /**
     * **台体只能由调用方给出形状描述**：它的几何不是从某一句题设读出来的
     * （棱锥/棱柱靠"侧棱 ⊥ 底面"那句定底环与拉伸，台体没有对应的一句）。
     * 题面语法进 spec 是 S6 的活，本层不替它猜底环、顶环与相似比。
     */
    return {
      status: "unverified_instance",
      evidence: evidenceFor("unverified_instance", {}),
      reasons: [`${WITNESS_SEARCH_CODES.unsupportedShape}: 台体需要调用方给出形状描述（底环 / 顶环 / 相似比）：本层不替题面语法猜这三个。`, configLine(input, 0)]
    }
  }
  if (providedSpec === undefined && input.shape !== "pyramid" && input.shape !== "prism") {
    return {
      status: "unverified_instance",
      evidence: evidenceFor("unverified_instance", {}),
      reasons: [`${WITNESS_SEARCH_CODES.requiresCandidates}: 这一族既没有内置推导、也没有调用方给的形状描述，搜索器不自造坐标。`, configLine(input, 0)]
    }
  }

  const contradiction = findContradiction(givens)
  if (contradiction) {
    return {
      status: "no_witness",
      evidence: evidenceFor("no_witness", {}, { status: "inconsistent", solver: "unsat" }),
      failures: [`${contradiction.code}: ${contradiction.message}`, configLine(input, 0)]
    }
  }

  /**
   * **形状描述的两个来源，优先级明确**：调用方给了 spec 就用它（入口语法 S6 与台体走这条），
   * 否则从题面推（棱锥/棱柱今天的产品路径）。
   */
  let spec: SolidShapeSpec
  if (providedSpec !== undefined) {
    spec = providedSpec
  } else {
    const derived = input.shape === "prism" ? derivePrismStructure(givens) : derivePyramidStructure(givens)
    if (derived.status === "rejected") {
      return {
        status: "unverified_instance",
        evidence: evidenceFor("unverified_instance", {}),
        reasons: [`${derived.code}: ${derived.message}`, configLine(input, 0)]
      }
    }
    spec = specFor(derived.structure)
  }

  /**
   * **R15 / R32：核验器拿到的必须与产品路径同一份题设。**
   *
   * 所以这里不再自己拼一个"只有 givens"的旧结构，而是把**整个 IR** 兼容适配过去：
   * 解析残留（`unverified`）与自由选择（`free_choice`）都跟着走 —— 前者是核验器里那道
   * "读不出的子句必须显形"的强制守卫，后者是自由点示例值证据（点名对不上时也会变成 unverified）。
   * 若调用方给的是 `parseObligationWithLegacy(prompt).ir`，那么这一份与
   * `parseDiagramObligations(prompt)` 逐字段相等（N1 的 `obligationIR.test.ts` 钉着）。
   */
  const legacy = toLegacyObligationSet(ir)
  /**
   * 判性不是 `supported` 的题设必须在**接受条件**里（R34 / M3）：核验器对不认识的 kind 会退化成
   * "按 parallel 量"（`diagramVerification.ts` 的 `calculate` 尾部），于是那样一条 claim 会被
   * 量出来并 `passed` —— 但"系统理解了它"并不成立。在循环之前算出来，它才管得住
   * "提前返回"与"兜底候选"两条出口（早先它只在循环**之后**的分类里，拦不住已经认定的通过）。
   */
  const unjudgeable = givens.filter((obligation) => obligation.judgeability !== "supported")
  const certifiable = unjudgeable.length === 0
  // 上限在**生成之后、判定之前**截断：`maxCandidates` 是"最多判几个"，不是"最多想几个"。
  const fullPool = candidatePool(spec, input)
  const pool = fullPool.slice(0, Math.max(0, Math.trunc(input.maxCandidates)))
  const judged: Extract<CandidateJudgement, { kind: "judged" }>[] = []
  const rejections = new Map<string, { count: number; message: string }>()
  const started = Date.now()
  let considered = 0
  let budgetExhausted = false
  let fallback: { judgement: Extract<CandidateJudgement, { kind: "judged" }>; plan: CandidatePlan } | null = null

  for (const plan of pool) {
    // 预算在**每个**候选之前检查：`timeoutMs` 必须真的生效，而不是只写在类型里。
    if (Date.now() - started >= input.timeoutMs) {
      budgetExhausted = true
      break
    }
    considered += 1
    const judgement = judgeCandidate(plan, legacy)
    if (judgement.kind === "rejected") {
      const seen = rejections.get(judgement.code)
      rejections.set(judgement.code, { count: (seen?.count ?? 0) + 1, message: judgement.message })
      continue
    }
    if (judgement.outcome === "verified") {
      // 有判性不明的题设时，这一份"通过"不构成认证 —— 既不返回，也不留作兜底。
      if (!certifiable) continue
      const candidate = toWitness(judgement.witness)
      const readability = readabilityOf(candidate.vertices)
      if (Number.isFinite(readability) && readability >= READABILITY_FLOOR) {
        return verifiedResult(input, plan, judgement, candidate, considered)
      }
      // 合格但难看：留作兜底，继续找更耐看的（R26：极大长宽比候选不优先）。
      if (fallback === null) fallback = { judgement, plan }
      continue
    }
    judged.push(judgement)
  }

  if (certifiable && fallback !== null) {
    return verifiedResult(input, fallback.plan, fallback.judgement, toWitness(fallback.judgement.witness), considered)
  }

  const config = configLine(input, considered)
  const unverifiedLines = judged.flatMap((judgement) => judgement.lines.filter((line) => line.startsWith(`${WITNESS_SEARCH_CODES.unverified}:`)))
  const failedLines = judged.flatMap((judgement) => judgement.lines.filter((line) => line.startsWith(`${WITNESS_SEARCH_CODES.failedGiven}:`)))

  if (budgetExhausted) {
    // R25 的文案纪律：预算耗尽只能说"在预算内没有找到"。
    return {
      status: "unverified_instance",
      evidence: evidenceFor("unverified_instance", residualsOfJudged(judged), { status: "timeout", solver: "timeout" }),
      reasons: [
        `${WITNESS_SEARCH_CODES.budgetTimeout}: 在预算内没有找到通过核验的候选（预算 ${String(input.timeoutMs)}ms，已考虑 ${String(considered)} 个）。这是"还没找到"，不能读成题设不成立。`,
        ...unverifiedLines,
        ...mostFailedLines(failedLines),
        config
      ]
    }
  }
  if (unjudgeable.length > 0) {
    return {
      status: "unverified_instance",
      evidence: evidenceFor("unverified_instance", residualsOfJudged(judged)),
      reasons: [
        ...unjudgeable.map((obligation) => `${WITNESS_SEARCH_CODES.unjudgeable}: ${obligation.sourceText} 的判性不是 supported，不能按"已核验"处理。`),
        ...unverifiedLines,
        config
      ]
    }
  }
  if (unverifiedLines.length > 0) {
    return {
      status: "unverified_instance",
      evidence: evidenceFor("unverified_instance", residualsOfJudged(judged)),
      reasons: [...unverifiedLines, config]
    }
  }
  if (considered < fullPool.length) {
    // 上限截断了池子：后面还有候选没试，不许把"没试完"说成"题设不成立"。
    return {
      status: "unverified_instance",
      evidence: evidenceFor("unverified_instance", residualsOfJudged(judged)),
      reasons: [
        `${WITNESS_SEARCH_CODES.candidateCapExhausted}: 候选上限 ${String(input.maxCandidates)} 已经用完（已考虑 ${String(considered)} 个），后面还有候选没试 —— 这是"没试完"，不能读成题设不成立。`,
        ...mostFailedLines(failedLines),
        config
      ]
    }
  }
  if (judged.length > 0) {
    return {
      status: "no_witness",
      evidence: evidenceFor("no_witness", residualsOfJudged(judged)),
      failures: [`${WITNESS_SEARCH_CODES.noCandidateVerified}: ${String(judged.length)} 个候选通过了几何构造，但没有一个满足全部可判题设。`, ...mostFailedLines(failedLines), config]
    }
  }
  const rejectionLines = [...rejections.entries()].map(([code, entry]) => `${code}: ${entry.message}（${String(entry.count)} 个候选）`)
  return {
    status: "unverified_instance",
    evidence: evidenceFor("unverified_instance", {}),
    reasons: [`${WITNESS_SEARCH_CODES.noCandidateConstructed}: ${String(considered)} 个候选都在构造期被拒，没有得到任何可核验的坐标。`, ...rejectionLines, config]
  }
}

function verifiedResult(
  input: WitnessSearchInput,
  plan: CandidatePlan,
  judgement: Extract<CandidateJudgement, { kind: "judged" }>,
  candidate: PolyhedronWitness,
  considered: number
): WitnessSearchResult {
  const witness = judgement.witness
  const assumptions = [
    ...witness.assumptions,
    ...witness.freeValues,
    // 网格候选注入的自由值在 2a 眼里是"题面给的"（我们就是用长度告诉它的），
    // 所以那几行**必须**由这一层补上，否则用户看不到系统替他定了什么。
    // 文案里的点名从 spec 的自由标量取（choice 只带 id + 值）。
    ...plan.choices.map((choice) => {
      const scalar = plan.spec.freeScalars.find((entry) => entry.id === choice.id)
      /**
       * **文案要读得懂**：底面边写点名（`AB = 2`）没问题，但另外两类不行 ——
       * 高与相似比**不是某个顶点或某条线的名字**。早先这里一律写 `targets.join("")`，
       * 于是面板上出现 `A′ = 2`（其实是**高**）与 `A′B′C′D′ = 0.5`（其实是**相似比**）：
       * 两句话都把用户往错的方向引。这是浏览器证据里查实的（`e2e/agent-solid-family-path.spec.ts`）。
       */
      const label = scalar === undefined
        ? choice.id
        : scalar.kind === "height"
          ? "高"
          : scalar.kind === "top-scale"
            ? "顶面相似比"
            : scalar.targets.join("")
      return `${label} = ${String(choice.value)}（搜索器自选，题面未给）`
    }),
    configLine(input, considered)
  ]
  return {
    status: "verified_instance",
    candidate,
    evidence: evidenceFor("verified_instance", judgement.residuals),
    assumptions: [...new Set(assumptions)]
  }
}

/** 最接近通过的那次判定的残差：证据里的残差必须是"真的量过"的那一份。 */
function residualsOfJudged(judged: readonly Extract<CandidateJudgement, { kind: "judged" }>[]): Record<string, number | null> {
  let best: Record<string, number | null> = {}
  let bestWorst = Number.POSITIVE_INFINITY
  for (const judgement of judged) {
    const worst = Math.max(0, ...Object.values(judgement.residuals).map((value) => (typeof value === "number" && Number.isFinite(value) ? Math.abs(value) : 0)))
    if (worst < bestWorst) {
      bestWorst = worst
      best = judgement.residuals
    }
  }
  return best
}

/**
 * `no_witness` 的逐条说明（设计 §4.4：候选数、失败最多的题设、最大残差）。
 *
 * 只报**失败次数最多**的那几条题设（并列时按原话排序，保证可重现）：一份几十行的
 * "每条都在每个候选上失败"的清单对排查没有帮助，而"卡在某一条上"才是下一步的入口。
 */
function mostFailedLines(lines: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1)
  /**
   * 并列时按**码位**排序，而不是 `localeCompare`：后者的结果随 ICU 数据与运行环境的
   * 语言设置变化，而这一层的输出必须"同一 seed 同一结果"（R26），连报告行的顺序也一样。
   */
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
  const top = ranked.length > 0 ? ranked[0][1] : 0
  return ranked.filter(([, count]) => count === top).map(([line, count]) => `${line}（在 ${String(count)} 个候选上）`)
}
