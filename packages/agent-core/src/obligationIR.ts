import {
  DIAGRAM_OBLIGATION_MATCHERS,
  parseDiagramObligations,
  type DiagramObligation,
  type DiagramObligationKind,
  type DiagramObligationSet,
  type DiagramParseOptions,
  type DiagramSourceDiagnostic,
  type DiagramSourceSpan
} from "./diagramObligations"
import type { ClaimRole, GeometryObligation, Judgeability, ObligationTolerance } from "./claimEvidence"
import { addConstraintNode, createConstraintGraph, type ConstraintGraph, type ConstraintKind } from "./constraintGraph"
import { normalizeGeometryPrompt } from "./latexNormalisation"
import { SHARED_SCOPE_ID, parseSubquestionScopeId, subquestionScopeId } from "./numberedProblem"

/**
 * **统一数学状态 IR**（设计 2026-10-04 §3；Phase N1）。
 *
 * ## 为什么要有这一层，而不是继续用 `DiagramObligationSet`
 *
 * 现有的 `DiagramObligationSet` 把三件不同的东西混在一只信封里：**题设**（`givens`）、
 * **目标**（`goals`，一串裸字符串）、**自由选择**（`freeChoices`，一串点名），
 * 外加一份 `unverified`。三者在产品上是三种角色，而裸字符串的 goals 连自己在原文哪里
 * 都说不出来 —— 于是"这条目标是模型编的还是原题写的"无从核验。
 *
 * 这一层**不新写解析器**：原话清单仍然只由 `parseDiagramObligations` 产出
 *（"模型自报 relations 不得取代原话清单"是这个项目的红线）。IR 做的是把它的产出
 * **升格**成每条都有角色、可判性和容差的 claim，并保留一个**双向兼容适配**：
 * `toLegacyObligationSet` 能把 IR 还原成逐字段相等的旧结构，所以两个既有调用点
 * （`planCompiler.ts:299-301`、`draftStore.ts:358-360`）的语义一个字节都没变（R4）。
 *
 * ## 判定力（judgeability）怎么定，为什么不"看起来像几何就算 supported"
 *
 * `supported` 的含义**很窄**：现有 verifier 能在这份 IR 上给出一个有意义的数
 *（`diagramVerification.ts` 的 `calculate`）。所以：
 * - **有现成判据的题设种类**（`diagramVerification.ts` 的 `calculate` 覆盖的那些）→ `supported`；
 *   这份名单就是代码里的 `JUDGED_KINDS` —— **不要在注释里另抄一份**（抄过一次，抄漏了 `pointCoordinate`）。
 * - 解析器将来看得懂、但还没有判据的种类 → `ambiguous`（现在一条都没有）；
 * - **目标和自由选择一律 `unsupported`** —— 现有核验**从不判定目标**（目标的核验是
 *   N2/N5 的事），把目标标成 `supported` 会让界面以为"系统验证了这道题"。
 *
 * 判错这一格的代价很具体：用户看到"已支持"就会以为系统证明了它。所以宁可窄一点。
 *
 * ## 为什么**模型声明的 `relations` 不进这份 IR**（裁决 R7：有记录的偏离）
 *
 * 计划的 Files 清单里点了 `contracts.ts` 与 `relations.ts`，N1 的目标描述也点了 `PlanRelation`。
 * 本任务**有意不改那两个文件**，IR 里也没有 `PlanRelation` 的一等公民。理由三条：
 *
 * 1. **设计定的口径**：模型自报的 `relations` **不是**统一状态的来源，只能当**附加线索**
 *    （设计 §5.2 与"Obligation IR 只由原话清单产出"那条红线）。把它塞进 IR 会让
 *    "模型说它垂直"变成一条与题设同级的 claim —— 那正是"模型自报取代原话清单"的入口。
 * 2. **relation 类判据已经在了，只是换了形态**：线线垂直/平行在 IR 里就是
 *    `kind: "perpendicular" | "parallel"` 的 obligation（由原话驱动），而**判定**仍然走
 *    既有那条唯一路径 —— `diagramVerification.calculate` → `relations.relationResidual`
 *    （`relations.ts` 的模块注释写明它是"关系判据的唯一真源"，坐标版与内核逐式同源）。
 *    所以"relation 没有进 IR"不等于"relation 没人判"，而是**判据不搬家**。
 * 3. **硬塞属 YAGNI**：`PlanRelation` 的形状（`id` / `kind` / `targets[].vertex` / `value`）是
 *    给"编辑期声明表"用的，与 IR 需要的"角色 + 原话区间 + 判性"不是一回事。等真有某个阶段
 *    需要"把模型声明与题设 claim 对齐"（N4 的开放题编译才可能），那时按那个阶段的判据再加，
 *    而不是现在按清单凑一个字段。
 *
 * 一句话：**IR 的可追溯性来自原话，relation 只是佐证；佐证不进账本，判据不搬第二处。**
 */

/** 有现成判据的题设种类（`diagramVerification.ts` 的 `calculate` 覆盖这些）。 */
const JUDGED_KINDS: ReadonlySet<DiagramObligationKind> = new Set<DiagramObligationKind>([
  "fixedLength", "equilateral", "equalLength", "segmentRatio", "midpoint",
  "planePerpendicular", "dihedral", "dihedralSine", "planarAngle", "equalAngle", "perpendicular", "parallel", "pointCoordinate",
  "conicAxes", "conicChord", "tangentAt", "functionGraph", "commonTangent",
  "angleBisector", "chordCenterDistance", "arcLength",
  "incenter", "centroid", "orthocenter", "excenter", "circumcenter", "midline",
  /** Task 11：面积由核验器**从最终坐标自己算**（`diagramVerification.calculate` 的 `area` 支）。 */
  "area",
  /** Task 13 边界（2026-10-14）：线面角由核验器从最终坐标自己算（`linePlaneAngle` 支）。 */
  "linePlaneAngle",
  /** Task 15 边界（2026-10-14）：交点个数由核验器从**图上那条曲线**自己数（`functionLineIntersections` 支）。 */
  "functionLineIntersections",
  "lineEquation",
  /** 施工单①（2026-10-15）：点在不在曲线上，由核验器拿内核的残差从**图上那一点**自己算（`pointOnConic` 支）。 */
  "pointOnConic",
  /** 2026-10-15：点在线段上（共线 + 落在线段内），由核验器从最终坐标自己算（`pointOnSegment` 支）。 */
  "pointOnSegment",
  /** A3（2026-10-26）：矩形（非退化 + 闭合 + 共面 + 四个直角），由核验器自己算。 */
  "rectangle",
  /** 2026-11-01：实体标量尺寸、球心与棱柱形状，由核验器从最终图元自己算。 */
  "solidDimension", "solidCenter", "solidPrismShape",
  /** T04（2026-11-16）：圆锥曲线参数定义域约束（如 `a>b>0` / `m>0`），对照drawn圆锥曲线半轴大小检验。 */
  "parameterDomain",
  "collinear",
  "pointLineCoord",
  "solidVolume"
])

/** 与 `diagramVerification.ts` 的常量同值（容差不能有两套；两处一起改）。 */
const UNITLESS_TOLERANCE = 1e-6
const ANGLE_TOLERANCE_DEGREES = 1e-3
const distanceTolerance = (value: number): number => Math.max(1e-6, 1e-6 * Math.max(1, value))

/** 逐条 claim 的容差：与核验器同一套判据（长度用绝对、关系用无量纲、角度用度）。 */
function toleranceFor(kind: DiagramObligationKind, value: number | undefined): ObligationTolerance | undefined {
  if (kind === "dihedral") return { kind: "angular", value: ANGLE_TOLERANCE_DEGREES }
  if (kind === "dihedralSine") return { kind: "relative", value: UNITLESS_TOLERANCE }
  // 平面角与二面角同一把尺子（都是"度"，容差不能有两套）；线面角是同一族的第三个数。
  if (kind === "planarAngle" || kind === "equalAngle" || kind === "linePlaneAngle") return { kind: "angular", value: ANGLE_TOLERANCE_DEGREES }
  /**
   * **角平分线量的也是"度"**（2026-10-20）：残余是"两个角之差"与"内外之和差"，两把都是角度尺，
   * 与平面角同一把 —— 不写这一行它会掉进下面的 `undefined`，而核验器那边给的是角度容差，
   * 同一件事就出现了两种说法。
   */
  if (kind === "angleBisector") return { kind: "angular", value: ANGLE_TOLERANCE_DEGREES }
  /** **弦心距与弧长都是长度量**（2026-10-20）：与 `fixedLength` 同一把尺子。 */
  if (kind === "chordCenterDistance" || kind === "arcLength") return { kind: "absolute", value: distanceTolerance(value ?? 1) }
  /** **内心比的是"到三条边的距离差"**（2026-10-20）：也是长度量，同一把尺子。 */
  if (kind === "incenter") return { kind: "absolute", value: distanceTolerance(value ?? 1) }
  /** **重心 / 垂心 / 旁心比的都是"点差多少"**（2026-10-20）：长度量，同一把尺子。 */
  if (kind === "centroid" || kind === "orthocenter" || kind === "excenter") return { kind: "absolute", value: distanceTolerance(1) }
  /** **外心比的是"到三个顶点的距离差"**（2026-10-20）：长度量，同一把尺子。 */
  if (kind === "circumcenter") return { kind: "absolute", value: distanceTolerance(1) }
  /** **中位线比的是"端点到中点的偏差"**（2026-10-20）：长度量，按边长缩放。 */
  if (kind === "midline") return { kind: "absolute", value: distanceTolerance(1) }
  /** 矩形残差是长度（闭合/共面），量级随边长走；角那一步用的是无量纲点积，见核验器。 */
  if (kind === "rectangle") return { kind: "absolute", value: distanceTolerance(1) }
  /**
   * **实体标量尺寸**（2026-10-20 补）：半径 / 高 / 母线 / 底边长这些是长度，面积与体积随量级走 ——
   * 核验器那边用的是同一把 `distanceTolerance(量级)`，这里按题面写的那个数取量级。
   * **漏了这一行它就会掉进 `undefined`**（这一条与角平分线那次是同一类漏：判据给尺子、IR 不给）。
   */
  if (kind === "solidDimension") return { kind: "absolute", value: distanceTolerance(value ?? 1) }
  if (kind === "solidCenter") return { kind: "absolute", value: distanceTolerance(1) }
  if (kind === "solidPrismShape") return { kind: "absolute", value: 1e-9 }
  if (kind === "fixedLength") return { kind: "absolute", value: distanceTolerance(value ?? 1) }
  if (kind === "pointCoordinate" || kind === "collinear" || kind === "pointLineCoord") return { kind: "absolute", value: distanceTolerance(1) }
  // 半轴是长度量 ⇒ 与点坐标同一条绝对容差；用相对容差会让"半轴差 0.3"这种明显错误通过。
  if (kind === "conicAxes") return { kind: "absolute", value: distanceTolerance(1) }
  // 切线的判据落在"横坐标差"与"斜率差"上，两个都是绝对量。
  if (kind === "tangentAt") return { kind: "absolute", value: distanceTolerance(1) }
  // 函数曲线比的是"两条曲线在采样点上的**函数值差**"，也是绝对量。
  if (kind === "functionGraph") return { kind: "absolute", value: distanceTolerance(1) }
  // 「点在曲线上」比的是**残差**（内核 `conicResidualAt`，长度量纲的**一阶**距离估计）
  // ⇒ 与点坐标、半轴同一把绝对尺子。用相对容差会把"偏离 0.3"这种明显错误按比例放过去。
  if (kind === "pointOnConic") return { kind: "absolute", value: distanceTolerance(1) }
  if (kind === "segmentRatio" || kind === "planePerpendicular" || kind === "perpendicular" || kind === "parallel" || kind === "parameterDomain") {
    return { kind: "relative", value: UNITLESS_TOLERANCE }
  }
  // 面积是 L²：与核验器同一把相对尺子（构造满足到数值精度）。
  if (kind === "area" || kind === "solidVolume") return { kind: "relative", value: UNITLESS_TOLERANCE }
  // **个数是整数**：容差只能是 0 —— "3 个"与"4 个"之间没有"差不多"可讲。
  if (kind === "functionLineIntersections") return { kind: "absolute", value: 0 }
  if (kind === "lineEquation") return { kind: "absolute", value: distanceTolerance(1) }
  // 等长/等边/中点/**点在线段上**：核验器按"那条线段的长度"缩放，绝对容差随实例变化 —— 这里如实不给。
  return undefined
}

function claimOf(
  item: DiagramObligation,
  id: string,
  role: ClaimRole,
  judgeability: Judgeability,
  scopeId?: string
): GeometryObligation {
  const tolerance = toleranceFor(item.kind, item.value)
  const geometry = {
    ...(item.planeLengths === undefined ? {} : { planeLengths: [...item.planeLengths] as [number, number] }),
    ...(item.coordinate === undefined ? {} : { coordinate: { ...item.coordinate } }),
    ...(item.conic === undefined ? {} : { conic: { ...item.conic } }),
    ...(item.conicKind === undefined ? {} : { conicKind: item.conicKind }),
    ...(item.line === undefined ? {} : { line: { ...item.line } }),
    ...(item.axisAlignment === undefined ? {} : { axisAlignment: item.axisAlignment }),
    ...(item.expectation === undefined ? {} : { expectation: item.expectation }),
    ...(item.splitPoint === undefined ? {} : { splitPoint: item.splitPoint }),
    ...(item.chainIndex === undefined ? {} : { chainIndex: item.chainIndex }),
    ...(item.expression === undefined ? {} : { expression: item.expression }),
    ...(item.expressions === undefined ? {} : { expressions: [...item.expressions] as [string, string] }),
    ...(item.solid === undefined ? {} : { solid: { ...item.solid } }),
    ...(item.prismShape === undefined ? {} : { prismShape: { ...item.prismShape } }),
    ...(item.domain === undefined ? {} : { domain: { ...item.domain, operators: [...item.domain.operators], variables: [...item.domain.variables] } }),
    ...(item.symbolicConic === undefined ? {} : {
      symbolicConic: {
        ...item.symbolicConic,
        domains: [...item.symbolicConic.domains],
        ...(item.symbolicConic.parameters ? { parameters: { ...item.symbolicConic.parameters } } : {}),
        ...(item.symbolicConic.asymptotes ? { asymptotes: [...item.symbolicConic.asymptotes] } : {}),
        ...(item.symbolicConic.tangencyPoints ? { tangencyPoints: item.symbolicConic.tangencyPoints.map((pt) => ({ ...pt })) } : {})
      }
    }),
    ...(item.entityLabel === undefined ? {} : { entityLabel: item.entityLabel })
  }
  return {
    id,
    role,
    kind: item.kind,
    sourceText: item.sourceText,
    start: item.start,
    end: item.end,
    targets: [...item.targets],
    // **只有题面真的给了数才写 expected**：`N为BC的中点` 没有数值，
    // 编一个 0 会让"实测 0 / 题设 0"看起来像验过一条数值条件。
    ...(item.value === undefined ? {} : { expected: item.value }),
    judgeability,
    ...(scopeId === undefined ? {} : { scopeId }),
    ...(tolerance === undefined ? {} : { tolerance }),
    // 兼容适配（R4）要的已解析结构：见 `ObligationGeometry` 的注释。
    ...(Object.keys(geometry).length === 0 ? {} : { geometry })
  }
}

type RecognizedObligation = Pick<DiagramObligation, "kind" | "targets" | "value" | "planeLengths">

/**
 * 用**题设那一张句型表**去认一段话（当前用于"求证"段里的目标句，以及证明出口读目标那一层）。
 *
 * 与 `parseDiagramObligations` 的差别只有一个：这里**不做**"前后字符是不是别的记号的一部分"
 * 那些边界判断 —— 目标句是独立切片出来的（`求证` 之后到句末），没有 `BD=2` 那种
 * "某个条件的后缀"风险。其余（模式顺序、`read` 的语义）完全共用。
 *
 * `pattern` 是**共享的带 `g` 正则**（`lastIndex` 是可变状态），所以借完必须还原：
 * 留着非零的 `lastIndex` 会让下一次调用从字符串中间开始找，症状是"同一句话第二次认不出来"。
 *
 * **导出是为了让证明出口读目标那一层复用它**（`proof/proofGoalReader.ts`）——
 * 一张句型表认两处，正是这个仓反复强调的那条纪律（"同一句话不许有两个解析器"）。
 */
export function recognizeObligationText(text: string): RecognizedObligation | null {
  for (const { pattern, read } of DIAGRAM_OBLIGATION_MATCHERS) {
    const saved = pattern.lastIndex
    const match = pattern.exec(text)
    pattern.lastIndex = saved
    if (match === null) continue
    const result = read(match)
    /**
     * **一个句型蕴含多条判据时，这里返回 `null`（= 认不出），不取第一条。**
     *
     * 这一层认的是**求证段里的目标句**，而目标句是**单条主张**。"底面 ABCD 是菱形"拆开是三条等长，
     * 拿第一条当目标就等于把"证明它是菱形"**降级**成"证明 AB=BC" —— 那正是本仓禁止的悄悄弱化
     * （与"静默丢句""特值化改题"同一类）。认不出就走既有的未支持路径，如实显示。
     */
    if (Array.isArray(result)) return null
    if (result !== null) return result
  }
  return null
}

function buildFlatClaims(set: DiagramObligationSet, idPrefix: string, scopeId?: string): GeometryObligation[] {
  const givens = set.givens.map((item, index) =>
    claimOf(item, `${idPrefix}${index}`, "given", JUDGED_KINDS.has(item.kind) ? "supported" : "ambiguous", scopeId)
  )
  const freeChoices = set.freeChoices.map((name, index): GeometryObligation => ({
    id: `${idPrefix}free-${index}`,
    role: "free_choice",
    kind: "freeChoice",
    sourceText: set.freeChoiceSources?.[index]?.name === name ? set.freeChoiceSources[index].sourceText : name,
    // Manually supplied legacy sets have no provenance; never invent offsets for them.
    start: set.freeChoiceSources?.[index]?.name === name ? set.freeChoiceSources[index].start : 0,
    end: set.freeChoiceSources?.[index]?.name === name ? set.freeChoiceSources[index].end : 0,
    targets: [name],
    // 自由点的**名字**是原话给的，"取在哪"不是 —— 所以没有 expected。
    judgeability: "unsupported",
    ...(scopeId === undefined ? {} : { scopeId })
  }))
  const goals = set.goals.map((goal, index): GeometryObligation => {
    /**
     * **目标用同一张句型表认种类**（`求证 OA⊥CD` → `perpendicular` + 点名 A/O/C/D）。
     *
     * 为什么不在 IR 里把目标一律写成 `proposition`：那样 N2 要为每条目标再解析一次自然语言，
     * 而"同一句话有两个解析器"正是本项目反复踩的坑。表只有一份（`DIAGRAM_OBLIGATION_MATCHERS`），
     * 所以题设与目标认出来的种类一定一致。
     *
     * 但**判定力仍然是 `unsupported`**：现有核验器从不判定目标（它只核 `givens`），
     * 认出种类不等于有判据。这两件事必须分开，否则界面会把"认出来了"显示成"验过了"。
     *
     * 目标原文区间由解析器携带；手工构造的旧集合没有来源，保持 0/0。
     */
    const recognized = recognizeObligationText(goal)
    return {
      id: `${idPrefix}goal-${index}`,
      role: "goal",
      kind: recognized?.kind ?? "proposition",
      sourceText: goal,
      start: set.goalSources?.[index]?.sourceText === goal ? set.goalSources[index].start : 0,
      end: set.goalSources?.[index]?.sourceText === goal ? set.goalSources[index].end : 0,
      targets: recognized?.targets ?? [],
      judgeability: "unsupported",
      ...(scopeId === undefined ? {} : { scopeId })
    }
  })
  return [...givens, ...freeChoices, ...goals]
}

/**
 * 由**已解析的原话清单**建 IR（纯函数，不看模型声明）。
 *
 * 顺序与 `parseDiagramObligations().givens` 一致，`id` 按序号分配 —— 于是
 * "同一个题面 → 同一份 IR"是可重复的，UI 与 trace 才能拿 `id` 对齐。
 */
function copyUnverifiedDiagnostic(entry: DiagramSourceDiagnostic, scopeId?: string): ObligationUnverified {
  return {
    sourceText: entry.sourceText,
    reason: entry.reason,
    ...(entry.reasonCode === undefined ? {} : { reasonCode: entry.reasonCode }),
    ...(entry.unrecognizedSpans === undefined ? {} : { unrecognizedSpans: entry.unrecognizedSpans.map((span) => ({ ...span })) }),
    ...(entry.recognizedEntities === undefined ? {} : { recognizedEntities: [...entry.recognizedEntities] }),
    ...(scopeId === undefined ? {} : { scopeId })
  }
}

export function buildObligationIR(set: DiagramObligationSet): ObligationIR {
  const parts = set.parts
  if (parts === undefined || parts.length === 0) {
    return {
      obligations: buildFlatClaims(set, "obligation-"),
      unverified: set.unverified.map((entry) => copyUnverifiedDiagnostic(entry))
    }
  }

  const minPartStart = Math.min(...parts.map((part) => part.start))
  const isStemItem = (start: number, end: number): boolean => end <= minPartStart || start < minPartStart
  const hasGuard = set.unverified.some((entry) => entry.sourceText === "各小问的条件" || entry.sourceText === "指定小问")
  const mode: ObligationScopeMode = set.selectedScopeId !== undefined
    ? "selected"
    : hasGuard
      ? "unscoped_guarded"
      : "unscoped_combined"

  const baseGivens = set.selectedScopeId === SHARED_SCOPE_ID || mode === "unscoped_guarded"
    ? set.givens
    : set.givens.filter((item) => isStemItem(item.start, item.end))
  const sharedFreeChoices: { name: string; source?: DiagramSourceSpan & { name: string } }[] = []
  for (let index = 0; index < set.freeChoices.length; index += 1) {
    const name = set.freeChoices[index]!
    const src = set.freeChoiceSources?.[index]
    const inPart = parts.some((part) => src !== undefined && src.start >= part.start && src.end <= part.end)
    if (!inPart) sharedFreeChoices.push({ name, source: src })
  }
  const sharedSet: DiagramObligationSet = {
    givens: baseGivens,
    goals: [],
    freeChoices: sharedFreeChoices.map((entry) => entry.name),
    ...(sharedFreeChoices.some((entry) => entry.source !== undefined)
      ? { freeChoiceSources: sharedFreeChoices.map((entry) => entry.source!).filter(Boolean) }
      : {}),
    unverified: []
  }

  const obligations: GeometryObligation[] = buildFlatClaims(sharedSet, "obligation-", SHARED_SCOPE_ID)
  const unverified: ObligationUnverified[] = []
  const scopes: ObligationScope[] = [{
    id: SHARED_SCOPE_ID,
    kind: "shared",
    mode,
    ...(mode === "unscoped_combined" && set.goals.length > 0 ? { combinedGoals: [...set.goals] } : {}),
    ...(mode === "unscoped_combined" && set.goalSources !== undefined ? { combinedGoalSources: set.goalSources.map((s) => ({ ...s })) } : {})
  }]

  const seenSharedUnverified = new Set<string>()
  if (mode === "unscoped_guarded" || set.selectedScopeId === SHARED_SCOPE_ID) {
    for (const entry of set.unverified) {
      if (entry.sourceText === "各小问的条件" || entry.sourceText === "指定小问") continue
      const inAnyPartOnly = parts.some((part) => part.obligations.unverified.some((u) => u.sourceText === entry.sourceText && u.reason === entry.reason)
        && !sharedInPartUnverified(parts, entry.sourceText, entry.reason))
      if (!inAnyPartOnly) {
        const key = `${entry.sourceText}\u0000${entry.reason}`
        if (!seenSharedUnverified.has(key)) {
          seenSharedUnverified.add(key)
          unverified.push({ sourceText: entry.sourceText, reason: entry.reason, scopeId: SHARED_SCOPE_ID })
        }
      }
    }
  } else {
    // In selected/combined mode, keep any shared-origin unverified items from the selected part's unverified that appear before parts or in all parts.
    for (const entry of set.unverified) {
      if (entry.sourceText === "各小问的条件" || entry.sourceText === "指定小问") continue
      const isPartSpecific = parts.some((part) => part.start !== undefined && part.text.includes(entry.sourceText))
      if (!isPartSpecific) {
        const key = `${entry.sourceText}\u0000${entry.reason}`
        if (!seenSharedUnverified.has(key)) {
          seenSharedUnverified.add(key)
          unverified.push({ sourceText: entry.sourceText, reason: entry.reason, scopeId: SHARED_SCOPE_ID })
        }
      }
    }
  }

  for (const part of parts) {
    const scopeId = subquestionScopeId(part.number)
    const partOwnGivens = part.obligations.givens.filter((item) => !isStemItem(item.start, item.end))
    const partFreeIndices: number[] = []
    for (let index = 0; index < part.obligations.freeChoices.length; index += 1) {
      const src = part.obligations.freeChoiceSources?.[index]
      if (src === undefined || (src.start >= part.start && src.end <= part.end)) {
        partFreeIndices.push(index)
      }
    }
    const partOwnSet: DiagramObligationSet = {
      givens: partOwnGivens,
      goals: part.obligations.goals,
      ...(part.obligations.goalSources ? { goalSources: part.obligations.goalSources } : {}),
      freeChoices: partFreeIndices.map((index) => part.obligations.freeChoices[index]!),
      ...(part.obligations.freeChoiceSources
        ? { freeChoiceSources: partFreeIndices.map((index) => part.obligations.freeChoiceSources![index]!).filter(Boolean) }
        : {}),
      unverified: []
    }
    obligations.push(...buildFlatClaims(partOwnSet, `obligation-sub${part.number}-`, scopeId))

    for (const entry of part.obligations.unverified) {
      const key = `${entry.sourceText}\u0000${entry.reason}`
      if (seenSharedUnverified.has(key)) continue
      unverified.push({ sourceText: entry.sourceText, reason: entry.reason, scopeId })
    }

    const sharedOverrides: { index: number; splitPoint?: boolean; targets?: string[] }[] = []
    const partStemGivens = part.obligations.givens.filter((item) => isStemItem(item.start, item.end))
    for (let sharedIdx = 0; sharedIdx < baseGivens.length; sharedIdx += 1) {
      const base = baseGivens[sharedIdx]!
      const inPart = partStemGivens[sharedIdx]
      if (inPart === undefined) continue
      const patch: { index: number; splitPoint?: boolean; targets?: string[] } = { index: sharedIdx }
      let modified = false
      if (inPart.splitPoint !== base.splitPoint) {
        patch.splitPoint = inPart.splitPoint
        modified = true
      }
      if (inPart.targets.join("|") !== base.targets.join("|")) {
        patch.targets = [...inPart.targets]
        modified = true
      }
      if (modified) sharedOverrides.push(patch)
    }

    scopes.push({
      id: scopeId,
      parentId: SHARED_SCOPE_ID,
      kind: "subquestion",
      number: part.number,
      start: part.start,
      end: part.end,
      text: part.text,
      ...(sharedOverrides.length > 0 ? { sharedOverrides } : {})
    })
  }

  for (const entry of set.unverified) {
    if (entry.sourceText === "各小问的条件" || entry.sourceText === "指定小问") {
      unverified.push({ sourceText: entry.sourceText, reason: entry.reason, scopeId: "scope_blocker" })
    }
  }

  return {
    obligations,
    unverified,
    scopes,
    ...(set.selectedScopeId === undefined ? {} : { selectedScopeId: set.selectedScopeId })
  }
}

function sharedInPartUnverified(
  parts: NonNullable<DiagramObligationSet["parts"]>,
  sourceText: string,
  reason: string
): boolean {
  return parts.every((part) => part.obligations.unverified.some((entry) => entry.sourceText === sourceText && entry.reason === reason))
}

function toLegacyObligation(item: GeometryObligation): DiagramObligation {
  return {
    kind: item.kind as DiagramObligationKind,
    sourceText: item.sourceText,
    start: item.start,
    end: item.end,
    targets: [...item.targets],
    ...(typeof item.expected === "number" ? { value: item.expected } : {}),
    ...(item.geometry?.planeLengths === undefined ? {} : { planeLengths: [...item.geometry.planeLengths] as [number, number] }),
    ...(item.geometry?.coordinate === undefined ? {} : { coordinate: { ...item.geometry.coordinate } }),
    ...(item.geometry?.conic === undefined ? {} : { conic: { ...item.geometry.conic } }),
    ...(item.geometry?.conicKind === undefined ? {} : { conicKind: item.geometry.conicKind }),
    ...(item.geometry?.line === undefined ? {} : { line: { ...item.geometry.line } }),
    ...(item.geometry?.axisAlignment === undefined ? {} : { axisAlignment: item.geometry.axisAlignment }),
    ...(item.geometry?.expectation === undefined ? {} : { expectation: item.geometry.expectation }),
    ...(item.geometry?.splitPoint === undefined ? {} : { splitPoint: item.geometry.splitPoint }),
    ...(item.geometry?.chainIndex === undefined ? {} : { chainIndex: item.geometry.chainIndex }),
    ...(item.geometry?.expression === undefined ? {} : { expression: item.geometry.expression }),
    ...(item.geometry?.expressions === undefined ? {} : { expressions: [...item.geometry.expressions] as [string, string] }),
    ...(item.geometry?.solid === undefined ? {} : { solid: { ...item.geometry.solid } }),
    ...(item.geometry?.prismShape === undefined ? {} : { prismShape: { ...item.geometry.prismShape } }),
    ...(item.geometry?.domain === undefined ? {} : { domain: { ...item.geometry.domain, operators: [...item.geometry.domain.operators], variables: [...item.geometry.domain.variables] } }),
    ...(item.geometry?.symbolicConic === undefined ? {} : {
      symbolicConic: {
        ...item.geometry.symbolicConic,
        domains: [...item.geometry.symbolicConic.domains],
        ...(item.geometry.symbolicConic.parameters ? { parameters: { ...item.geometry.symbolicConic.parameters } } : {}),
        ...(item.geometry.symbolicConic.asymptotes ? { asymptotes: [...item.geometry.symbolicConic.asymptotes] } : {}),
        ...(item.geometry.symbolicConic.tangencyPoints ? { tangencyPoints: item.geometry.symbolicConic.tangencyPoints.map((pt) => ({ ...pt })) } : {})
      }
    }),
    ...(item.geometry?.entityLabel === undefined ? {} : { entityLabel: item.geometry.entityLabel })
  }
}

function toLegacyScopeSlice(
  items: readonly GeometryObligation[],
  unverified: readonly ObligationUnverified[]
): DiagramObligationSet {
  const givens = items.filter((item) => item.role === "given").map(toLegacyObligation).sort((a, b) => a.start - b.start)
  const goalItems = items.filter((item) => item.role === "goal")
  const freeItems = items.filter((item) => item.role === "free_choice")
  return {
    givens,
    goals: goalItems.map((item) => item.sourceText),
    ...(goalItems.some((item) => item.end > item.start)
      ? { goalSources: goalItems.map(({ sourceText, start, end }) => ({ sourceText, start, end })) }
      : {}),
    freeChoices: freeItems.flatMap((item) => item.targets),
    ...(freeItems.some((item) => item.end > item.start)
      ? { freeChoiceSources: freeItems.map(({ targets, sourceText, start, end }) => ({ name: targets[0]!, sourceText, start, end })) }
      : {}),
    unverified: unverified.map(({ sourceText, reason, reasonCode, unrecognizedSpans, recognizedEntities }) => ({
      sourceText,
      reason,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      ...(unrecognizedSpans === undefined ? {} : { unrecognizedSpans: unrecognizedSpans.map((span) => ({ ...span })) }),
      ...(recognizedEntities === undefined ? {} : { recognizedEntities: [...recognizedEntities] })
    }))
  }
}

/**
 * **R4 / T02 的无损兼容适配**：IR → 旧结构，包含 `parts` 与当前选择 `selectedScopeId`，
 * 必须与 `parseDiagramObligations` 的产出**逐字段相等**。
 */
export function toLegacyObligationSet(ir: ObligationIR): DiagramObligationSet {
  const subScopes = (ir.scopes ?? []).filter((scope) => scope.kind === "subquestion" && scope.number !== undefined)
  if (subScopes.length === 0) {
    return toLegacyScopeSlice(ir.obligations, ir.unverified)
  }

  const sharedScope = (ir.scopes ?? []).find((scope) => scope.kind === "shared")
  const sharedItems = ir.obligations.filter((item) => (item.scopeId ?? SHARED_SCOPE_ID) === SHARED_SCOPE_ID)
  const sharedUnverified = ir.unverified.filter((entry) => (entry.scopeId ?? SHARED_SCOPE_ID) === SHARED_SCOPE_ID)
  const blockerUnverified = ir.unverified.filter((entry) => entry.scopeId === "scope_blocker")

  const parts: NonNullable<DiagramObligationSet["parts"]> = subScopes.map((scope) => {
    const scopeGivensBase = sharedItems.map((item) => ({ ...item, geometry: item.geometry ? { ...item.geometry } : undefined, targets: [...item.targets] }))
    if (scope.sharedOverrides) {
      let givenCursor = 0
      for (const item of scopeGivensBase) {
        if (item.role !== "given") continue
        const patch = scope.sharedOverrides.find((entry) => entry.index === givenCursor)
        if (patch !== undefined) {
          if (patch.splitPoint !== undefined) item.geometry = { ...item.geometry, splitPoint: patch.splitPoint }
          if (patch.targets !== undefined) item.targets = [...patch.targets]
        }
        givenCursor += 1
      }
    }
    const ownItems = ir.obligations.filter((item) => item.scopeId === scope.id)
    const ownUnverified = ir.unverified.filter((entry) => entry.scopeId === scope.id)
    return {
      number: scope.number!,
      text: scope.text ?? "",
      start: scope.start ?? 0,
      end: scope.end ?? 0,
      obligations: toLegacyScopeSlice([...scopeGivensBase, ...ownItems], [...sharedUnverified, ...ownUnverified])
    }
  })

  const requestedPart = parseSubquestionScopeId(ir.selectedScopeId)
  if (requestedPart !== null) {
    const matched = parts.find((part) => part.number === requestedPart)
    if (matched !== undefined) {
      return {
        ...matched.obligations,
        parts,
        selectedScopeId: ir.selectedScopeId
      }
    }
    const sharedSlice = toLegacyScopeSlice(sharedItems, [...sharedUnverified, ...blockerUnverified])
    return {
      ...sharedSlice,
      parts,
      selectedScopeId: ir.selectedScopeId
    }
  }

  if (ir.selectedScopeId === SHARED_SCOPE_ID) {
    const sharedSlice = toLegacyScopeSlice(sharedItems, [...sharedUnverified, ...blockerUnverified])
    return {
      ...sharedSlice,
      parts,
      goals: parts.flatMap((part) => part.obligations.goals),
      goalSources: parts.flatMap((part) => part.obligations.goalSources ?? []),
      selectedScopeId: SHARED_SCOPE_ID
    }
  }

  if (sharedScope?.mode === "unscoped_combined") {
    const allItems = [...sharedItems, ...subScopes.flatMap((scope) => ir.obligations.filter((item) => item.scopeId === scope.id && item.role !== "goal"))]
    const combinedSlice = toLegacyScopeSlice(allItems, ir.unverified)
    return {
      ...combinedSlice,
      goals: sharedScope.combinedGoals ? [...sharedScope.combinedGoals] : parts.flatMap((part) => part.obligations.goals),
      ...(sharedScope.combinedGoalSources ? { goalSources: sharedScope.combinedGoalSources.map((s) => ({ ...s })) } : {}),
      parts
    }
  }

  const sharedSlice = toLegacyScopeSlice(sharedItems, [])
  return {
    ...sharedSlice,
    parts,
    goals: parts.flatMap((part) => part.obligations.goals),
    goalSources: parts.flatMap((part) => part.obligations.goalSources ?? []),
    unverified: [
      ...sharedUnverified.map(({ sourceText, reason, reasonCode, unrecognizedSpans, recognizedEntities }) => ({
        sourceText,
        reason,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        ...(unrecognizedSpans === undefined ? {} : { unrecognizedSpans: unrecognizedSpans.map((span) => ({ ...span })) }),
        ...(recognizedEntities === undefined ? {} : { recognizedEntities: [...recognizedEntities] })
      })),
      ...subScopes.flatMap((scope) =>
        ir.unverified.filter((entry) => entry.scopeId === scope.id).map(({ sourceText, reason, reasonCode, unrecognizedSpans, recognizedEntities }) => ({
          sourceText,
          reason,
          ...(reasonCode === undefined ? {} : { reasonCode }),
          ...(unrecognizedSpans === undefined ? {} : { unrecognizedSpans: unrecognizedSpans.map((span) => ({ ...span })) }),
          ...(recognizedEntities === undefined ? {} : { recognizedEntities: [...recognizedEntities] })
        }))
      ),
      ...blockerUnverified.map(({ sourceText, reason, reasonCode, unrecognizedSpans, recognizedEntities }) => ({
        sourceText,
        reason,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        ...(unrecognizedSpans === undefined ? {} : { unrecognizedSpans: unrecognizedSpans.map((span) => ({ ...span })) }),
        ...(recognizedEntities === undefined ? {} : { recognizedEntities: [...recognizedEntities] })
      }))
    ]
  }
}

/** 一次解析，同时拿到旧结构（核验器要吃它）与新 IR（trace / UI / 后续阶段要吃它）。 */
export function parseObligationWithLegacy(prompt: string, options: DiagramParseOptions = {}): { legacy: DiagramObligationSet; ir: ObligationIR } {
  const legacy = parseDiagramObligations(normalizeGeometryPrompt(prompt), options)
  return { legacy, ir: buildObligationIR(legacy) }
}

/** 只要 IR 的便捷入口（语义与 `buildObligationIR(parseDiagramObligations(prompt))` 完全相同）。 */
export function parseObligationIR(prompt: string, options: DiagramParseOptions = {}): ObligationIR {
  return buildObligationIR(parseDiagramObligations(normalizeGeometryPrompt(prompt), options))
}

export type ObligationScopeMode = "unscoped_combined" | "unscoped_guarded" | "selected"

export interface ObligationScope {
  id: string
  parentId?: string
  kind: "shared" | "subquestion"
  number?: number
  start?: number
  end?: number
  text?: string
  mode?: ObligationScopeMode
  combinedGoals?: string[]
  combinedGoalSources?: DiagramSourceSpan[]
  sharedOverrides?: { index: number; splitPoint?: boolean; targets?: string[] }[]
}

export interface ObligationUnverified {
  sourceText: string
  reason: string
  reasonCode?: string
  unrecognizedSpans?: { text: string; start: number; end: number }[]
  recognizedEntities?: string[]
  scopeId?: string
}

/**
 * 统一状态本身。`obligations.unverified` 之外的解析残留也留在这里 ——
 * 「解析失败必须可见」与 `DiagramObligationSet.unverified` 是同一条产品要求。
 */
export interface ObligationIR {
  obligations: GeometryObligation[]
  unverified: ObligationUnverified[]
  scopes?: ObligationScope[]
  selectedScopeId?: string
}

export interface IrPromptClauseSummary {
  scopeIds: string[]
  selectedScopeId: string
  obligationCount: number
  unverifiedCount: number
  unverifiedTexts: string[]
}

/** Extracts structural clause/scope coverage from raw prompt without consulting gold test fixtures. */
export function irClauseSummaryForPrompt(prompt: string, selectedScopeId?: string): IrPromptClauseSummary {
  const ir = parseObligationIR(prompt, selectedScopeId === undefined ? {} : { selectedScopeId })
  const scopes = new Set<string>([SHARED_SCOPE_ID])
  for (const scope of ir.scopes ?? []) scopes.add(scope.id)
  for (const ob of ir.obligations) {
    if (ob.scopeId) scopes.add(ob.scopeId)
  }
  return {
    scopeIds: [...scopes],
    selectedScopeId: selectedScopeId ?? SHARED_SCOPE_ID,
    obligationCount: ir.obligations.length,
    unverifiedCount: ir.unverified.length,
    unverifiedTexts: ir.unverified.map((u) => u.sourceText)
  }
}

function mapObligationKindToConstraintKind(kind: string): ConstraintKind {
  switch (kind) {
    case "length":
    case "solidEdgeLength":
    case "distance":
      return "distance"
    case "ratio":
      return "ratio"
    case "perpendicular":
    case "foldPerp":
      return "perpendicular"
    case "parallel":
      return "parallel"
    case "angle":
    case "dihedral":
      return "angle"
    case "collinear":
      return "collinear"
    case "coplanar":
    case "baseCoplanar":
      return "coplanar"
    case "tangent":
    case "commonTangent":
      return "tangent"
    case "topology":
    case "openTopology":
      return "topology"
    case "foldTransform":
      return "fold_transform"
    default:
      return "incidence"
  }
}

export function buildConstraintGraphFromObligationIR(ir: ObligationIR): ConstraintGraph {
  let graph = createConstraintGraph()
  for (const ob of ir.obligations) {
    graph = addConstraintNode(graph, {
      id: ob.id,
      kind: mapObligationKindToConstraintKind(ob.kind),
      targets: ob.targets,
      scopeId: ob.scopeId ?? SHARED_SCOPE_ID,
      stateId: ob.stateId ?? ob.scopeId ?? SHARED_SCOPE_ID,
      sourceRefs: [{ sourceText: ob.sourceText, start: ob.start, end: ob.end }],
      status: ob.judgeability === "supported" ? "unknown" : "underdetermined"
    })
  }
  return graph
}

