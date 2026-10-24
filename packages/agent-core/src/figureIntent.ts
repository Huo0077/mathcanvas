import type { DiagramSourceSpan } from "./diagramObligations"
import type { ObligationIR } from "./obligationIR"

/**
 * **来源可追溯的四族图形意图**（Task 6，2026-10-12）。
 *
 * ## 这一层回答什么、不回答什么
 *
 * 它把"这道题要画什么"写成一份**不含坐标**的结构：有哪些命名对象、有哪些条件、
 * 条件是**从原话的哪一段**读出来的。**坐标不在里面** —— 计划 Global Constraints 写着
 * "坐标由构造器决定"，而构造（Task 7 的物化、Task 10 的派生点、Task 12 的反求折角）
 * 各有各的算法与各自的失败分类。把坐标塞进意图层，等于让"意图"替构造器做决定。
 *
 * ## 为什么可追溯性写成 `span` 而不是一句话
 *
 * `claimEvidence.ts` 已经写明本仓对"可追溯"的唯一**可被程序核验**的形式：
 * `sourceText` 必须等于 `prompt.slice(start, end)`。所以这里复用既有的
 * [`DiagramSourceSpan`](./diagramObligations.ts)（**不手抄第三套**），
 * 并由 `figureIntent.test.ts` 逐条按 `prompt.slice` 断言。
 *
 * ## 为什么 `family` 是**传入**而不是推断出来的
 *
 * 族（三角形 / 圆锥 / 函数 / 立体）不能从条件清单里诚实推出来：
 * 同一组"两边一角"在平面三角与立体底面里都成立，而"非标准曲线"硬塞进圆锥曲线是本仓
 * 明令禁止的（计划 Global Constraints）。族由**认得出形状从句的那一层**给出
 *（`planCompiler` 的 `specForPrompt` / 本地规划器的意图），这一层只忠实记录它。
 */

/** 意图结构的版本。加字段就要加版本 —— 下游据此决定读不读得懂。 */
export const FIGURE_INTENT_VERSION = 1 as const

export const FIGURE_FAMILIES = ["triangle", "conic", "function", "solid"] as const
export type FigureFamily = (typeof FIGURE_FAMILIES)[number]

/**
 * **命名对象**。类型必须能容纳不同拓扑 —— 一组没有语义的顶点列表不行：
 * "四边形 ABCD"是**开放的面**，"立方体"是**闭合实体**，两者的物化与删除语义完全不同
 *（2026-10-10 用户现场：用散点拼实体 ⇒ 文档里没有实体本身，删除与读数都失去依据）。
 *
 * **这一层只填得出来的那一类**：Task 6 只到点名（`point`）。其余几支是给
 * Task 7 的物化留的位置 —— 现在没有任何代码会产出它们，所以也不会有"看着像有、其实是编的"的风险。
 */
export type NamedObject =
  | { kind: "point"; name: string }
  /** 线段 / 折痕：由两个点名给出。 */
  | { kind: "segment"; name: string; from: string; to: string }
  /** 平面多边形：`closed: false` 就是**开放的面**（翻折片、四边形片）。 */
  | { kind: "face"; name: string; vertices: string[]; closed: boolean }
  /** 闭合实体（多面体 / 圆柱 / 圆锥 …）。 */
  | { kind: "solid"; name: string }
  /** 曲线：圆锥曲线与函数图像共用这一支，具体种类由 `curve` 说。 */
  | { kind: "curve"; name: string; curve: "circle" | "ellipse" | "hyperbola" | "parabola" | "function" }
  /** 轨迹（动点的像）。 */
  | { kind: "locus"; name: string; host: string }

/** **一条能追回原句的条件**。`clauseId` 与 `GeometryObligation.id` 是同一个东西。 */
export interface FigureClause {
  clauseId: string
  kind: string
  /** 这条条件点名了哪些对象（核验器与物化都按它找对象）。 */
  refs: string[]
  span: DiagramSourceSpan
}

/**
 * **一条关系**（模型自愿补充的那一份）。
 *
 * `sourceClauseId` 必须能追回一条**原题**条件；追不回时调用方要如实标出来 ——
 * 本仓的判据是"**对没有可靠来源的关系不得假装来自原题**"（计划 §2 的最小数据合同）。
 * 这一层只**如实记录**它拿到的来源，不替它编一个。
 */
export interface FigureRelation {
  sourceClauseId: string
  kind: string
  refs: string[]
  value?: number | string
}

/** 变换（首批只有"沿折痕翻折"）。折后坐标由内核算，意图层只说"折谁、绕谁、折成谁"。 */
export type FigureTransformation = {
  kind: "fold"
  /**
   * **运动类型**（T4.3，2026-10-24）。
   *
   * `fold` 与 `rotate` 共用同一套旋转机制（绕一条边把一张面转一个角度），但语义不同：
   * "翻折/折叠"默认是**沿折痕翻到另一侧**，"绕边旋转到"则是明确的旋转并且目标面给了名字。
   * 保留区别是为了让构造器能按语义选分支，而不是把所有绕边运动都当成翻折。
   * 缺省 = `fold`（旧条目与调用方不需要改）。
   */
  motion?: "fold" | "rotate"
  face: string
  hinge: { from: string; to: string }
  apex: string
  apexAs: string
  /** **原文证据**（T4）：这句话在原题里的逐字片段。读出来的条目才有。 */
  sourceText?: string
}

export interface FigureIntent {
  version: typeof FIGURE_INTENT_VERSION
  family: FigureFamily
  objects: NamedObject[]
  clauses: FigureClause[]
  relations: FigureRelation[]
  transformations: FigureTransformation[]
  /**
   * **读不懂但必须留着**的条件。`span` 为 `null` 表示那段文字**在原话里定位不到**
   *（解析器给的 `sourceText` 不是原话的逐字片段）—— 那就如实说"指不出位置"，
   * 绝不编一个区间：编出来的区间会让下游以为它真的追回了原句。
   */
  unverified: { sourceText: string; reason: string; span: DiagramSourceSpan | null }[]
}

export interface BuildFigureIntentInput {
  prompt: string
  ir: ObligationIR
  /** 由**认得出形状从句的那一层**给出；这一层不推断（见文件头）。 */
  family: FigureFamily
  /** 模型自愿补充的关系。**只进 `relations`，一个字都不许改 `clauses`。** */
  relations?: readonly FigureRelation[]
  transformations?: readonly FigureTransformation[]
}

/** 在原文里定位一段文字。定位不到返回 `null`（**不编位置**）。 */
function locate(prompt: string, sourceText: string): DiagramSourceSpan | null {
  if (sourceText.length === 0) return null
  const start = prompt.indexOf(sourceText)
  return start < 0 ? null : { sourceText, start, end: start + sourceText.length }
}

/**
 * 把解析出来的条件集**原样**翻译成图形意图。
 *
 * 三件事**刻意不做**：
 * - 不改条数（解析器给几条就是几条 —— 少一条等于静默丢一句题设）；
 * - 不改 `kind`（构造器按它选几何）；
 * - 不推断族与拓扑（见文件头）。
 */
/**
 * **读出"沿折痕翻折"这句话**（Task 13，2026-10-12）。
 *
 * 在此之前 `FigureTransformation` 只是个**类型**：`buildFigureIntent` 只把调用方给的
 * `input.transformations` 原样带过，**没有任何东西去读题面里那句"翻折"** —— 于是
 * "题面说的是折"这件事在机器里没有形状，下游（例如"折不折得起来"的判据）也就无从下手。
 *
 * 收三种实测过的写法（用户原句 / 计划摘要里的简写 / **卷面最常见的 `△`**）：
 * - `将三角形AEF沿EF翻折至三角形PEF`
 * - `AEF 沿 EF 翻至 PEF`
 * - **`将 △AEF 沿 EF 翻折至 △PEF`**（2026-10-15 用户现场 —— 用户原话用的就是 `△`，
 *   而这儿原先只认"三角形"与裸名 ⇒ **读不出** ⇒ 下游那条"按题面补折"的救援整条落空）
 *
 * 判据：折痕那两个名字**必须同时出现在折前与折后**（那是"这两点不动"的定义），
 * `apex` / `apexAs` 就是各自剩下的那一个。任何一处对不上就**不产出**这条变换 ——
 * 宁可说"没读懂"，也不产出一条半对的。
 */
export function readFoldTransformations(prompt: string): FigureTransformation[] {
  /**
   * ## 点名语法（T4.1，2026-10-24）
   *
   * 旧实现用 `[A-Z]{3}` 当代名：它认不出 `△A′BC`（卷面最常见的"折后点"写法）、
   * 也认不出 `A₁` 这类下标。现在先把一段**字母串**抓下来，再按点名切成一个个名字：
   * 一个大写字母 + 任意个撇号 / 下标。`[A-Z]{3}` 从此不再是点名的定义。
   */
  const RUN = "[A-Z][A-Z′'’ʼ₀₁₂₃₄₅₆₇₈₉]*"
  const TRIANGLE = "(?:三角形|△|Δ)?"
  const ACTION = "(?:翻折|折叠|折起|翻起)"
  /** 折角可以紧跟动作词（`翻折90°`）；它是**折角**而不是"折到哪"，T6 从 `readFoldAngles` 读它。 */
  const ACTION_WITH_ANGLE = `${ACTION}(?:\\s*[0-9]+(?:\\.[0-9]+)?\\s*(?:°|度))?`

  /** 折前 → 折后（`翻折至 / 折叠成 / 翻折到`）。 */
  const foldTo = new RegExp(`(?:将)?\\s*${TRIANGLE}\\s*(${RUN})\\s*沿\\s*(${RUN})\\s*${ACTION_WITH_ANGLE}\\s*(?:至|成|到|为)?\\s*${TRIANGLE}\\s*(${RUN})`, "g")
  /** 绕边旋转到（与翻折共用旋转机制，但语义单独记）。 */
  const rotateTo = new RegExp(`(?:将)?\\s*${TRIANGLE}\\s*(${RUN})\\s*绕\\s*(${RUN})\\s*旋转\\s*(?:[0-9]+(?:\\.[0-9]+)?\\s*(?:°|度))?\\s*(?:至|成|到|为)?\\s*${TRIANGLE}\\s*(${RUN})`, "g")
  /** 只给"点 A 到达点 P"的写法（T4.2）。 */
  const apexTo = new RegExp(`(?:将)?\\s*${TRIANGLE}\\s*(${RUN})\\s*沿\\s*(${RUN})\\s*${ACTION_WITH_ANGLE}\\s*[，,]?\\s*使\\s*点?\\s*(${RUN})\\s*(?:到达|落到|落在|重合于|与)\\s*(?:点\\s*)?(${RUN})`, "g")

  const pointNames = (raw: string): string[] => raw.match(/[A-Z](?:[′'’ʼ]+|[₀-₉]+)*/g) ?? []

  const out: FigureTransformation[] = []
  const seen = new Set<string>()
  const push = (faceRaw: string, hingeRaw: string, targetRaw: string, motion: "fold" | "rotate", sourceText: string, apexRaw?: string) => {
    const face = pointNames(faceRaw)
    const hinge = pointNames(hingeRaw)
    let target = pointNames(targetRaw)
    /**
     * **"使点 A 到达点 P"只给了折后那一个点**：折后的三角形就是"折前把 A 换成 P"。
     * 这一步是把两种句式**归一成同一份结构**，而不是编一个目标三角形 ——
     * 换名规则由折痕固定（E、F 不动），所以它是确定的。
     */
    if (apexRaw !== undefined) {
      const apex = pointNames(apexRaw)[0]
      const apexAs = pointNames(targetRaw)[0]
      if (apex === undefined || apexAs === undefined) return
      target = face.map((name) => (name === apex ? apexAs : name))
    }
    // 折痕两端**必须同时出现在折前与折后**（那是"这两点不动"的定义）；任一处对不上就不产出。
    if (face.length !== 3 || hinge.length !== 2 || target.length !== 3) return
    if (!hinge.every((name) => face.includes(name) && target.includes(name))) return
    const apex = apexRaw === undefined ? face.find((name) => !hinge.includes(name)) : pointNames(apexRaw)[0]
    const apexAs = target.find((name) => !hinge.includes(name))
    if (apex === undefined || apexAs === undefined || apex === apexAs) return
    if (!face.includes(apex)) return
    const key = `${face.join("")}|${hinge.join("")}|${apex}|${apexAs}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({
      kind: "fold",
      ...(motion === "rotate" ? { motion } : {}),
      face: face.join(""),
      hinge: { from: hinge[0]!, to: hinge[1]! },
      apex,
      apexAs,
      sourceText
    })
  }

  for (const match of prompt.matchAll(foldTo)) push(match[1]!, match[2]!, match[3]!, "fold", match[0])
  for (const match of prompt.matchAll(rotateTo)) push(match[1]!, match[2]!, match[3]!, "rotate", match[0])
  for (const match of prompt.matchAll(apexTo)) push(match[1]!, match[2]!, match[4]!, "fold", match[0], match[3])
  return out
}

export function buildFigureIntent(input: BuildFigureIntentInput): FigureIntent {
  const clauses: FigureClause[] = input.ir.obligations.map((obligation) => ({
    clauseId: obligation.id,
    kind: obligation.kind,
    refs: [...obligation.targets],
    span: { sourceText: obligation.sourceText, start: obligation.start, end: obligation.end }
  }))

  /**
   * 命名对象只到**点名**这一层：条件的 `targets` 就是这条题面点到的那些名字。
   * 按**首次出现**的顺序去重 —— 顺序稳定，下游做差集时不会因为集合序而抖动。
   */
  const objects: NamedObject[] = []
  const seenNames = new Set<string>()
  for (const clause of clauses) {
    for (const ref of clause.refs) {
      if (seenNames.has(ref)) continue
      seenNames.add(ref)
      objects.push({ kind: "point", name: ref })
    }
  }

  return {
    version: FIGURE_INTENT_VERSION,
    family: input.family,
    objects,
    clauses,
    relations: [...(input.relations ?? [])],
    transformations: [...readFoldTransformations(input.prompt), ...(input.transformations ?? [])],
    unverified: input.ir.unverified.map((entry) => ({
      sourceText: entry.sourceText,
      reason: entry.reason,
      span: locate(input.prompt, entry.sourceText)
    }))
  }
}
