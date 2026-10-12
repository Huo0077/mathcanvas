import type { DiagramObligationSet } from "../diagramObligations"
import type { GeometryObligation } from "../claimEvidence"
import { buildObligationIR } from "../obligationIR"

import type { ReadProofGoalResult } from "./proofGoalReader"
import type { PremiseBridgeResult } from "./proofPremiseBridge"

/**
 * **这一次到底证了什么**（计划 `Task 17｜Lean 原题前提与受限引理分级`）。
 *
 * ## 为什么必须有这一层
 *
 * 适配器里那四条模板证的都是**受限引理**：一个结论 + 它自己那两条前提。而一道题还有
 * 别的必要条件（底面形状、点在边上、`P` 在面外、给定的角与长度…），那些条件**一个字都没进命题**。
 * 于是"后端验过了"只说明**模板定理成立** —— 它离"这道题证完了"还差一整段。
 * 只靠文案自觉是挡不住的（写文案的人会顺手写一句"已验证"），所以这里把它变成**结构化字段**。
 *
 * ## 四档分类（每一条原题条件都要落在其中一档）
 *
 * - `formalized`：它是**命题的假设**（模板真的用了它）；
 * - `dischargedByNamedDerivation`：命题不用它当假设，因为一条**点名定理**从它一步推了出来
 *  （例如由「线 ⊥ 面」用性质定理推出「线 ⊥ 面内那条线」）—— 那一步的名字必须写出来，
 *   与 `pythagorean` 同一条纪律：推断要看得见，不许别名掉；
 * - `figureAssumption`：它**不是**命题的一部分，只是**图上这一个实例**恰好满足
 *  （核验器能在候选图上量它）。**实例成立不等于普遍成立** —— 它属于"这一版的图"，
 *   不属于"这道题的命题"；
 * - `notRepresented`：连题设都没读出来（句型表没有它 / 落进了 `unverified`）⇒ 它对命题零贡献。
 *
 * ## 结局只有三个，而且**默认是受限引理**
 *
 * `whole_problem` 需要调用方**显式交出一份"这就是整道题"的命题产物声明**
 *（`wholeProblemProposition`）**并且**逐条条件都进了命题、没有未解析的题面、没有凭空前提、
 * 后端**真的验过**。今天**没有任何产品调用方给得出这份声明** —— 本仓还没有一份完整原题的
 * Lean 命题产物，所以产品路径上这一档不可达（这正是计划那句"没有新的完整原题 Lean 命题产物，
 * 不勾 whole_problem"的代码形态）。
 *
 * `unsupported` 给两种情形：**这一类没有模板**（读目标时就拒绝）与**前提指不出出处**
 *（前提桥说 `invented` 非空）。两种都**不跑**后端。
 *
 * ## 不把函数采样、实例图或 `sorry` 当证明
 *
 * 判据只看 `backendVerified`（它由适配器的判据给出：`sorryAx`、表外公理、缺报告都会被拒）。
 * 这一层**不自己判**证明成没成，也不接受任何"看起来像"的证据。
 */

export type OriginalConditionScope = "formalized" | "dischargedByNamedDerivation" | "figureAssumption" | "notRepresented"

export interface ScopedOriginalCondition {
  /** `obligationIR` 那一份解析结果的 id（未解析的题面自己带 `unparsed-` 前缀）。 */
  id: string
  kind: string
  /** 题面原话（指回原文用）。 */
  sourceText: string
  /** 原文区间。**取不到时为 `0,0`**（与 `obligationIR` 对无源条目的口径一致）。 */
  span: { start: number; end: number }
  scope: OriginalConditionScope
  /** 为什么归到这一档（人读的一句话）。 */
  reason: string
}

export type ProofScopeOutcome = "limited_lemma" | "whole_problem" | "unsupported"

export interface ProofScopeReport {
  /** 目标句在 IR 里的 id（读不出目标时为 `null`）。 */
  goalSourceId: string | null
  goalSourceText: string
  /** 目标句的原话区间（读不出时为 `null`）。 */
  goalSpan: { start: number; end: number } | null
  conditions: ScopedOriginalCondition[]
  /** 系统替用户选的图实例 / 自由参数（R51：这些选择要看得见）。 */
  figureChoices: string[]
  outcome: ProofScopeOutcome
  detail: string
}

export interface ProofScopeInput {
  /** `readProofGoal` 的结果（读不出就是读不出，这里不重试）。 */
  reading: ReadProofGoalResult
  set: DiagramObligationSet
  /** 前提桥的结论；没跑到那一步就传 `null`。 */
  bridge: PremiseBridgeResult | null
  /** **后端真的验过了**（适配器的判据给的，不是"跑完了"）。 */
  backendVerified: boolean
  /** 调用方声明"这份命题覆盖整道题"。今天没有产品调用方给得出它（见文件头）。 */
  wholeProblemProposition?: { goalSourceId: string; note: string }
  /** 图上**真的物化**了的点名（用来判 `fromFigure` 的前提有没有落到图上）。 */
  materialisedNames?: readonly string[]
}

/** 目标句在 IR 里是哪一条（按原文相等 → 包含 → 第一条目标）。 */
function goalItemOf(ir: readonly GeometryObligation[], goalText: string): GeometryObligation | null {
  const goals = ir.filter((item) => item.role === "goal")
  return goals.find((item) => item.sourceText === goalText) ?? goals.find((item) => goalText.includes(item.sourceText) || item.sourceText.includes(goalText)) ?? goals[0] ?? null
}

function spanOf(item: { start: number; end: number }): { start: number; end: number } {
  return { start: item.start, end: item.end }
}

/**
 * 逐条给原题条件分档。顺序即优先级（同一条条件只能落一档）。
 */
function classify(
  item: { id: string; kind: string; sourceText: string; start: number; end: number; judgeability: GeometryObligation["judgeability"] },
  bridge: PremiseBridgeResult | null
): ScopedOriginalCondition {
  const fromText = bridge?.fromText.find((entry) => entry.sourceText === item.sourceText)
  if (fromText !== undefined) {
    return { id: item.id, kind: item.kind, sourceText: item.sourceText, span: spanOf(item), scope: "formalized", reason: `这条题设是这条命题的**假设**（命题里的前提「${fromText.premise}」就是它）。` }
  }
  const derived = bridge?.fromDerivation.find((entry) => entry.viaSourceText === item.sourceText)
  if (derived !== undefined) {
    return {
      id: item.id,
      kind: item.kind,
      sourceText: item.sourceText,
      span: spanOf(item),
      scope: "dischargedByNamedDerivation",
      reason: `命题不直接用它当假设：由**${derived.theorem}**一步推出「${derived.premise}」——这一步的起点就是这条题设，名字写在这里，不许被别名掉。`
    }
  }
  if (item.judgeability === "supported") {
    return {
      id: item.id,
      kind: item.kind,
      sourceText: item.sourceText,
      span: spanOf(item),
      scope: "figureAssumption",
      reason: "这条题设**没有进命题**，只是**图上这一个实例**恰好满足它（核验器能在候选图上量它）——实例成立不等于普遍成立。"
    }
  }
  return {
    id: item.id,
    kind: item.kind,
    sourceText: item.sourceText,
    span: spanOf(item),
    scope: "notRepresented",
    reason: `这条题设既没进命题，也不属于"图上量得出来的实例条件"（判性：${item.judgeability}）—— 它对命题零贡献。`
  }
}

export function buildProofScopeReport(input: ProofScopeInput): ProofScopeReport {
  const reading = input.reading
  const goalSourceText = reading.ok ? reading.reading.sourceText : ""
  const ir = buildObligationIR(input.set).obligations
  const goalItem = goalItemOf(ir, goalSourceText)
  const materialised = new Set(input.materialisedNames ?? [])

  const conditions: ScopedOriginalCondition[] = []
  for (const item of ir) {
    if (item.role !== "given") continue
    conditions.push(classify(item, input.bridge))
  }
  /**
   * **图上蕴含的前提也要列出来**（`fromFigure`）：它们不是题面某句话，而是点名结构蕴含的
   * （"这条线的两个端点在那个平面上"）。它们**同样只是假设** —— 但要说清那些点名
   * **在图上有没有真的物化**：没物化就是一条写下来的假设，更弱。
   */
  for (const [index, entry] of (input.bridge?.fromFigure ?? []).entries()) {
    const names = entry.premise.match(/[A-Z][A-Z0-9′'₁₂₃₄₅₆]*/g) ?? []
    const missing = names.filter((name) => !materialised.has(name))
    const materialisedNote = input.materialisedNames === undefined
      ? "（这一次没有传图上物化的点名，无法核对。）"
      : missing.length === 0
        ? "图上确有这些点名（已物化）。"
        : `图上**没有物化**这些点名：${missing.join("、")} —— 它只是一条写下来的假设。`
    conditions.push({
      id: `figure-${index}`,
      kind: "figureAssumption",
      sourceText: entry.premise,
      span: { start: 0, end: 0 },
      scope: "figureAssumption",
      reason: `${entry.reason}${materialisedNote}`
    })
  }
  /** 题面里**没被解析成题设**的句子：它们对命题零贡献，而且**挡住整题级结论**。 */
  for (const [index, entry] of input.set.unverified.entries()) {
    conditions.push({
      id: `unparsed-${index}`,
      kind: "unparsed",
      sourceText: entry.sourceText,
      span: { start: 0, end: 0 },
      scope: "notRepresented",
      reason: `这句题面没有被解析成可核验的题设（${entry.reason}），更不会进命题。`
    })
  }

  const figureChoices = reading.ok ? [...reading.reading.choices] : []

  const unsupported = (detail: string): ProofScopeReport => ({
    goalSourceId: goalItem?.id ?? null,
    goalSourceText,
    goalSpan: goalItem !== null && goalItem.end > goalItem.start ? spanOf(goalItem) : null,
    conditions,
    figureChoices,
    outcome: "unsupported",
    detail
  })

  if (!reading.ok) return unsupported(`这道题的目标今天没有可用的证明模板：${reading.reason}`)
  if (input.bridge === null) return unsupported("前提桥这一步没有跑（没有结论可依据）—— 没有前提就没法生成命题。")
  if (!input.bridge.ok) {
    const missing = input.bridge.invented.map((entry) => entry.premise).join("、")
    return unsupported(`题面里找不齐这条命题要的前提（缺：${missing}）—— 系统不许替题面补一条它没说的，所以**连命题都不生成**。`)
  }

  const outside = conditions.filter((entry) => entry.scope !== "formalized" && entry.scope !== "dischargedByNamedDerivation")
  const declared = input.wholeProblemProposition
  const canBeWholeProblem = outside.length === 0 && declared !== undefined && input.backendVerified
    && (goalItem === null || declared.goalSourceId === goalItem.id)

  if (canBeWholeProblem) {
    return {
      goalSourceId: goalItem?.id ?? null,
      goalSourceText,
      goalSpan: goalItem !== null && goalItem.end > goalItem.start ? spanOf(goalItem) : null,
      conditions,
      figureChoices,
      outcome: "whole_problem",
      detail: `全题每一条必要条件都进了这份命题（或被一条点名定理一步推出来），没有未解析的题面，且后端验过（${declared.note}）—— 这才叫整题级。`
    }
  }

  const why = [
    outside.length === 0 ? null : `有 ${outside.length} 条题面条件没有进命题（例如「${outside[0]!.sourceText}」）`,
    declared === undefined ? "调用方没有交出「这份命题覆盖整道题」的产物声明" : null,
    input.backendVerified ? null : "后端没有验过"
  ].filter((entry): entry is string => entry !== null)
  return {
    goalSourceId: goalItem?.id ?? null,
    goalSourceText,
    goalSpan: goalItem !== null && goalItem.end > goalItem.start ? spanOf(goalItem) : null,
    conditions,
    figureChoices,
    outcome: "limited_lemma",
    detail: `这一次证的是**受限引理**（模板定理：一个结论 + 它自己那两条前提），不是整道题：${why.join("；")}。`
  }
}
