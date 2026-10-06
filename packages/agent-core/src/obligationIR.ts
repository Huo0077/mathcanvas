import {
  DIAGRAM_OBLIGATION_MATCHERS,
  parseDiagramObligations,
  type DiagramObligation,
  type DiagramObligationKind,
  type DiagramObligationSet
} from "./diagramObligations"
import type { ClaimRole, GeometryObligation, Judgeability, ObligationTolerance } from "./claimEvidence"

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
 * - 9 种有现成判据的题设种类（定长/等边/等长/中点/比例/面⊥面/二面角/线线垂直/线线平行）→ `supported`；
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
  "fixedLength", "equilateral", "equalLength", "midpoint", "segmentRatio",
  "planePerpendicular", "dihedral", "perpendicular", "parallel"
])

/** 与 `diagramVerification.ts` 的常量同值（容差不能有两套；两处一起改）。 */
const UNITLESS_TOLERANCE = 1e-6
const ANGLE_TOLERANCE_DEGREES = 1e-3
const distanceTolerance = (value: number): number => Math.max(1e-6, 1e-6 * Math.max(1, value))

/** 逐条 claim 的容差：与核验器同一套判据（长度用绝对、关系用无量纲、角度用度）。 */
function toleranceFor(kind: DiagramObligationKind, value: number | undefined): ObligationTolerance | undefined {
  if (kind === "dihedral") return { kind: "angular", value: ANGLE_TOLERANCE_DEGREES }
  if (kind === "fixedLength") return { kind: "absolute", value: distanceTolerance(value ?? 1) }
  if (kind === "segmentRatio" || kind === "planePerpendicular" || kind === "perpendicular" || kind === "parallel") {
    return { kind: "relative", value: UNITLESS_TOLERANCE }
  }
  // 等长/等边/中点：核验器按"第一个线段长度"缩放，绝对容差随实例变化 —— 这里如实不给。
  return undefined
}

function claimOf(item: DiagramObligation, index: number, role: ClaimRole, judgeability: Judgeability): GeometryObligation {
  const tolerance = toleranceFor(item.kind, item.value)
  return {
    id: `obligation-${index}`,
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
    ...(tolerance === undefined ? {} : { tolerance }),
    // 兼容适配（R4）要的已解析结构：见 `ObligationGeometry` 的注释。
    ...(item.planeLengths === undefined ? {} : { geometry: { planeLengths: [...item.planeLengths] as [number, number] } })
  }
}

type RecognizedObligation = Pick<DiagramObligation, "kind" | "targets" | "value" | "planeLengths">

/**
 * 用**题设那一张句型表**去认一段话（当前只用于"求证"段里的目标句）。
 *
 * 与 `parseDiagramObligations` 的差别只有一个：这里**不做**"前后字符是不是别的记号的一部分"
 * 那些边界判断 —— 目标句是独立切片出来的（`求证` 之后到句末），没有 `BD=2` 那种
 * "某个条件的后缀"风险。其余（模式顺序、`read` 的语义）完全共用。
 *
 * `pattern` 是**共享的带 `g` 正则**（`lastIndex` 是可变状态），所以借完必须还原：
 * 留着非零的 `lastIndex` 会让下一次调用从字符串中间开始找，症状是"同一句话第二次认不出来"。
 */
function recognizeObligationText(text: string): RecognizedObligation | null {
  for (const { pattern, read } of DIAGRAM_OBLIGATION_MATCHERS) {
    const saved = pattern.lastIndex
    const match = pattern.exec(text)
    pattern.lastIndex = saved
    if (match === null) continue
    const result = read(match)
    if (result !== null) return result
  }
  return null
}

/**
 * 由**已解析的原话清单**建 IR（纯函数，不看模型声明）。
 *
 * 顺序与 `parseDiagramObligations().givens` 一致，`id` 按序号分配 —— 于是
 * "同一个题面 → 同一份 IR"是可重复的，UI 与 trace 才能拿 `id` 对齐。
 */
export function buildObligationIR(set: DiagramObligationSet): ObligationIR {
  const givens = set.givens.map((item, index) => claimOf(item, index, "given", JUDGED_KINDS.has(item.kind) ? "supported" : "ambiguous"))
  const freeChoices = set.freeChoices.map((name, index): GeometryObligation => ({
    id: `obligation-free-${index}`,
    role: "free_choice",
    kind: "freeChoice",
    sourceText: set.freeChoiceSources?.[index]?.name === name ? set.freeChoiceSources[index].sourceText : name,
    // Manually supplied legacy sets have no provenance; never invent offsets for them.
    start: set.freeChoiceSources?.[index]?.name === name ? set.freeChoiceSources[index].start : 0,
    end: set.freeChoiceSources?.[index]?.name === name ? set.freeChoiceSources[index].end : 0,
    targets: [name],
    // 自由点的**名字**是原话给的，"取在哪"不是 —— 所以没有 expected。
    judgeability: "unsupported"
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
      id: `obligation-goal-${index}`,
      role: "goal",
      kind: recognized?.kind ?? "proposition",
      sourceText: goal,
      start: set.goalSources?.[index]?.sourceText === goal ? set.goalSources[index].start : 0,
      end: set.goalSources?.[index]?.sourceText === goal ? set.goalSources[index].end : 0,
      targets: recognized?.targets ?? [],
      judgeability: "unsupported"
    }
  })
  return {
    obligations: [...givens, ...freeChoices, ...goals],
    unverified: set.unverified.map((entry) => ({ sourceText: entry.sourceText, reason: entry.reason }))
  }
}

/**
 * **R4 的兼容适配**：IR → 旧结构，必须与 `parseDiagramObligations` 的产出**逐字段相等**
 * （`obligationIR.test.ts` 用 `toEqual(legacy)` 钉住它）。
 *
 * 这是"两个调用点语义不变"的可执行证据：只要这条相等成立，`planCompiler` 与
 * `draftStore` 即使改走 `parseObligationIR` 这条路，行为也与改动之前完全一致。
 */
export function toLegacyObligationSet(ir: ObligationIR): DiagramObligationSet {
  const givens: DiagramObligation[] = ir.obligations.filter((item) => item.role === "given").map((item) => ({
    kind: item.kind as DiagramObligationKind,
    sourceText: item.sourceText,
    start: item.start,
    end: item.end,
    targets: [...item.targets],
    ...(typeof item.expected === "number" ? { value: item.expected } : {}),
    ...(item.geometry?.planeLengths === undefined ? {} : { planeLengths: [...item.geometry.planeLengths] as [number, number] })
  }))
  return {
    givens,
    goals: ir.obligations.filter((item) => item.role === "goal").map((item) => item.sourceText),
    ...(ir.obligations.some((item) => item.role === "goal" && item.end > item.start) ? {
      goalSources: ir.obligations.filter((item) => item.role === "goal").map(({ sourceText, start, end }) => ({ sourceText, start, end }))
    } : {}),
    freeChoices: ir.obligations.filter((item) => item.role === "free_choice").flatMap((item) => item.targets),
    ...(ir.obligations.some((item) => item.role === "free_choice" && item.end > item.start) ? {
      freeChoiceSources: ir.obligations.filter((item) => item.role === "free_choice").map(({ targets, sourceText, start, end }) => ({ name: targets[0], sourceText, start, end }))
    } : {}),
    unverified: ir.unverified.map((entry) => ({ sourceText: entry.sourceText, reason: entry.reason }))
  }
}

/** 一次解析，同时拿到旧结构（核验器要吃它）与新 IR（trace / UI / 后续阶段要吃它）。 */
export function parseObligationWithLegacy(prompt: string): { legacy: DiagramObligationSet; ir: ObligationIR } {
  const legacy = parseDiagramObligations(prompt)
  return { legacy, ir: buildObligationIR(legacy) }
}

/** 只要 IR 的便捷入口（语义与 `buildObligationIR(parseDiagramObligations(prompt))` 完全相同）。 */
export function parseObligationIR(prompt: string): ObligationIR {
  return buildObligationIR(parseDiagramObligations(prompt))
}

/**
 * 统一状态本身。`obligations.unverified` 之外的解析残留也留在这里 ——
 * 「解析失败必须可见」与 `DiagramObligationSet.unverified` 是同一条产品要求。
 */
export interface ObligationIR {
  obligations: GeometryObligation[]
  unverified: { sourceText: string; reason: string }[]
}
