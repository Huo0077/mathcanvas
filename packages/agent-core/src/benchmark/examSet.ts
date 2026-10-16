import type { DiagramSourceSpan } from "../diagramObligations"

/**
 * **真题离线评测工件**（Task 9，2026-10-12）。
 *
 * ## 这一层**不**做的事，先写在最前面
 *
 * 它**不**把调研变成"金标"。调研
 *（[`2026-10-11-four-family-exam-diagram-survey.md`](../../../docs/research/2026-10-11-four-family-exam-diagram-survey.md)）
 * 的 §3.5 原文："上述来源完成了**题型需求调研**，目前并没有逐题建立有独立答案复核、
 * 使用许可、录入哈希、预期图证据的正式高考金标准。因此仓库既有 `verifiedGoldCaseIds: []`
 * 的事实不变。"
 *
 * 所以这里把"**够不够格当金标**"写成**可执行的判据**，而不是一句态度：
 *
 * 1. **转载方给的答案不能充 oracle**（调研 §1 对 2021 新高考Ⅰ卷的原话是"含解答但发布方为转载；
 *    按 A 的题面证据使用，**不当作独立答案来源**"）。判据：`oracle` 只在
 *    `answerIndependentlyReviewed === true` 时才允许存在。
 * 2. **同一道原题（卷别 + 题号）不许同时出现在开发集与留出集**（调研 §3.4
 *    "真题开发样本与留出样本要隔离"）。**换名字、换常数、换说法都还是同一题** ——
 *    判据认的是来源锚点，不是题面文本。
 *
 * 两条都不会让程序崩：它们只会让评测**看起来合格**。这正是本仓最忌的那种失效。
 *
 * ## 题面目前是**调研摘要**，不是逐字原题
 *
 * §1 把来源按 A/B/C 分级，而本轮**没有**把任何一份卷面文本录入仓库。
 * 所以每条用例都带 `promptKind`：`"verbatim"` 表示逐字原题（**当前一条都没有**），
 * `"survey-summary"` 表示这是调研归纳出来的作图需求描述。**不拿摘要冒充原题** ——
 * 拿它当原题会让"按题号回指"这句话变成谎话，而这句话正是 A 级证据的全部价值。
 */

/** 证据等级（调研 §1）：A＝原卷/原题可回指；B＝多来源转录须标不确定处；C＝考试机构评析。 */
export const EXAM_SOURCE_LEVELS = ["A", "B", "C"] as const
export type ExamSourceLevel = (typeof EXAM_SOURCE_LEVELS)[number]

/** 题面在仓库里的形态：`verbatim` 是逐字原题，`survey-summary` 是调研归纳的需求描述。 */
export const EXAM_PROMPT_KINDS = ["verbatim", "survey-summary"] as const
export type ExamPromptKind = (typeof EXAM_PROMPT_KINDS)[number]

export const EXAM_FAMILIES = ["triangle", "conic", "function", "solid"] as const
export type ExamFamily = (typeof EXAM_FAMILIES)[number]

/**
 * **来源锚点**：这道题凭什么进仓库。
 *
 * `inputLicence` 记的是**调研 §1 那张表给出的用途与可信边界**（谁发布的、能不能按题面用、能不能当答案）。
 * 它不是法律意见书，而是"这一条我们按什么口径用它"的可查记录。
 */
export interface ExamProvenance {
  /** 卷别（"2021 新高考Ⅰ卷"）。 */
  paper: string
  /** 题号（"19"）。 */
  number: string
  sourceLevel: ExamSourceLevel
  inputLicence: string
  /**
   * 答案**有没有经过独立复核**（不是转载方给的那一份答案）。
   *
   * 这是 `oracle` 的**唯一**开关：调研 §3.5 说目前一条都没有，所以随仓的用例里
   * 这个字段全是 `false`，也就全都**没有 oracle**。
   */
  answerIndependentlyReviewed: boolean
}

export interface ExamCase {
  id: string
  family: ExamFamily
  /** 见 `ExamPromptKind`：**不拿摘要冒充原题**。 */
  promptKind: ExamPromptKind
  /** 题面（`survey-summary` 时是调研归纳出来的作图需求描述）。 */
  prompt: string
  /** 调研 §1 那张表里给出的来源页（可回指）。 */
  sourceRef: string
  provenance: ExamProvenance
  /** 这道题在作图上的难点 / 需要哪些图形能力（调研 §2 的原文归纳，人读，不参与判分）。 */
  requiredFigure: string
  /**
   * **机器的独立回代**：从最终图量出来的、可核验的原题条件。
   *
   * 它**不是**"预期答案"。它只在 `answerIndependentlyReviewed` 为真时才允许存在 ——
   * 否则就是把转载方的答案当成了金标（见文件头）。
   */
  oracle?: readonly string[]
}

/**
 * **够格当金标的用例 id**。调研 §3.5 的结论是"目前没有逐题建立独立答案复核"，
 * 所以这里是**空的**，而且这一条**不是"暂时留空"**：谁要往里加 id，
 * 得先拿出独立复核过的答案与预期图证据。
 */
export const verifiedGoldCaseIds: readonly string[] = []

export type ExamSetProblemCode = "missing_provenance" | "oracle_without_review" | "held_out_leakage" | "duplicate_id"

export interface ExamSetProblem {
  code: ExamSetProblemCode
  detail: string
}

/**
 * 检查一份（开发集，留出集）配对。**纯函数**：同样的输入说同样的话。
 *
 * 返回**全部**问题（不是第一个）—— 与 `dataset.ts` 同一条纪律：题集是喂给评测的输入，
 * "跑一半、悄悄少几道题"比直接失败更糟。
 */
export function checkExamSet(dev: readonly ExamCase[], heldOut: readonly ExamCase[]): ExamSetProblem[] {
  const problems: ExamSetProblem[] = []

  for (const [label, cases] of [["开发集", dev], ["留出集", heldOut]] as const) {
    const seen = new Set<string>()
    for (const entry of cases) {
      if (seen.has(entry.id)) problems.push({ code: "duplicate_id", detail: `${label}里 id 重复：${entry.id}` })
      seen.add(entry.id)

      const provenance = entry.provenance
      const wellFormed = provenance !== undefined
        && typeof provenance.paper === "string" && provenance.paper.trim().length > 0
        && typeof provenance.number === "string" && provenance.number.trim().length > 0
        && (EXAM_SOURCE_LEVELS as readonly unknown[]).includes(provenance.sourceLevel)
        && typeof provenance.inputLicence === "string" && provenance.inputLicence.trim().length > 0
      if (!wellFormed) {
        problems.push({ code: "missing_provenance", detail: `${label}的 ${entry.id} 缺少可回指的来源锚点（卷别 / 题号 / 等级 / 许可）。` })
      }

      /**
       * **转载方的答案不能充 oracle**。这条是文件头第 1 条，也是调研 §1 对转载来源的明文口径。
       */
      if (entry.oracle !== undefined && entry.provenance.answerIndependentlyReviewed !== true) {
        problems.push({
          code: "oracle_without_review",
          detail: `${label}的 ${entry.id} 带了 oracle，但它的答案没有经过独立复核（${entry.provenance.paper} 第 ${entry.provenance.number} 题的发布方是转载）—— 转载方给的答案不算金标。`
        })
      }
    }
  }

  /**
   * **留出集不许是开发集里某道题的变式**。
   *
   * 判据认的是**来源锚点**（卷别 + 题号），不是题面文本：同一道原题换名字、换常数、
   * 换说法都还是同一题（调研 §3.4 那句"同一原题改点名/改常数/改真假/改图面方向应作变形回归"
   * 说的是**回归**要覆盖这些变形，而**留出集**要的是**没见过的原题**）。
   */
  const devAnchors = new Map(dev.map((entry) => [`${entry.provenance?.paper}\u0000${entry.provenance?.number}`, entry.id]))
  for (const entry of heldOut) {
    const anchor = `${entry.provenance?.paper}\u0000${entry.provenance?.number}`
    const inDev = devAnchors.get(anchor)
    if (inDev !== undefined) {
      problems.push({
        code: "held_out_leakage",
        detail: `留出集的 ${entry.id} 与开发集的 ${inDev} 是同一道原题（${entry.provenance?.paper} 第 ${entry.provenance?.number} 题）—— 换题面不算换题，留出集必须留没见过的原题。`
      })
    }
  }

  return problems
}

/** 与 `dataset.ts` 同一条纪律：坏输入**一次列齐**然后抛，绝不返回半份合法题集。 */
export function assertExamSet(dev: readonly ExamCase[], heldOut: readonly ExamCase[]): void {
  const problems = checkExamSet(dev, heldOut)
  if (problems.length > 0) {
    throw new Error(`真题评测集不合法（${problems.length} 处）：\n- ${problems.map((entry) => `[${entry.code}] ${entry.detail}`).join("\n- ")}`)
  }
}

/** 调研 §1 那张表里的来源页（每条用例都从这里挑一个，可回指）。 */
const R = {
  newGaokaoI2021: "https://17094505.s21i.faiusr.com/61/ABUIABA9GAAgxLzahwYokrzxgAY.pdf",
  zhejiang2021: "https://gaokao.eol.cn/shiti/zhenti/202107/W020220527412661352065.pdf",
  newGaokaoI2022: "https://gaokao.eol.cn/shiti/zhenti/202206/W020220616371842899183.pdf",
  newCurriculumI2023: "https://m.jszs.com/uploads/file/202312/05/1701770434952811.pdf",
  newCurriculumI2024: "https://static-gkcx.gaokao.cn/upload/zhenti/20240611/1718078152_5550.pdf",
  newGaokaoII2025: "https://zy.21cnjy.com/23149165"
} as const

/**
 * **开发集**：从调研 §2 的四张表里各取条目。
 *
 * 三条纪律写在这里，免得下一个人顺手改坏：
 * ① `promptKind` 全是 `survey-summary` —— 仓库里**没有**任何一份逐字卷面文本；
 * ② `answerIndependentlyReviewed` 全是 `false` ⇒ **一条 oracle 都没有**（§3.5）；
 * ③ `requiredFigure` 抄的是调研自己的归纳，**不加工成"预期图形"**。
 */
export const EXAM_CASES: readonly ExamCase[] = [
  {
    id: "exam-triangle-2021-new-gaokao-i-19",
    family: "triangle",
    promptKind: "survey-summary",
    prompt: "解三角形：边角关系联立，边上一点 D 按比例分边，且 D 的位置必须与整图同源。",
    sourceRef: R.newGaokaoI2021,
    provenance: { paper: "2021 新高考Ⅰ卷", number: "19", sourceLevel: "A", inputLicence: "按 A 的题面证据使用；发布方为转载，含解答但不作为独立答案来源", answerIndependentlyReviewed: false },
    requiredFigure: "三角边角关系联立；边上点 D 的比例与整图关系同源，分点不能由模型独立手写成另一组不相容的坐标。"
  },
  {
    id: "exam-triangle-2024-new-curriculum-i-15",
    family: "triangle",
    promptKind: "survey-summary",
    prompt: "解三角形：边角条件与面积条件联立。",
    sourceRef: R.newCurriculumI2024,
    provenance: { paper: "2024 新课标Ⅰ卷", number: "15", sourceLevel: "A", inputLicence: "卷面转载可回指；含原图的题须以后续自动化实拍/渲染复核标签", answerIndependentlyReviewed: false },
    requiredFigure: "解三角形条件与面积条件联立；只满足正弦定理而不核面积的图是错误图。"
  },
  {
    id: "exam-conic-2022-new-gaokao-i-21",
    family: "conic",
    promptKind: "survey-summary",
    prompt: "双曲线的弦与直线斜率条件、以及由它们决定的面积。",
    sourceRef: R.newGaokaoI2022,
    provenance: { paper: "2022 新高考Ⅰ卷", number: "21", sourceLevel: "A", inputLicence: "卷面和题号可回指；含原图的题须以后续自动化实拍/渲染复核标签", answerIndependentlyReviewed: false },
    requiredFigure: "双曲线弦、直线斜率条件与面积；要分别处理竖直直线、相切、零/一/二交点。"
  },
  {
    id: "exam-conic-2024-new-curriculum-i-16",
    family: "conic",
    promptKind: "survey-summary",
    prompt: "椭圆过定点，过定点的动弦与三角面积。",
    sourceRef: R.newCurriculumI2024,
    provenance: { paper: "2024 新课标Ⅰ卷", number: "16", sourceLevel: "A", inputLicence: "逐题核对原题与图形；第 11 题不是标准圆锥曲线，分类时不强塞", answerIndependentlyReviewed: false },
    requiredFigure: "双曲线参数、椭圆过点以及过定点的动弦和三角面积；不能只支持一个轴固定的椭圆模板。"
  },
  {
    id: "exam-function-2021-new-gaokao-i-7",
    family: "function",
    promptKind: "survey-summary",
    prompt: "从曲线外一点向指数函数作多条切线。",
    sourceRef: R.newGaokaoI2021,
    provenance: { paper: "2021 新高考Ⅰ卷", number: "7", sourceLevel: "A", inputLicence: "按 A 的题面证据使用；发布方为转载，含解答但不作为独立答案来源", answerIndependentlyReviewed: false },
    requiredFigure: "从曲线外一点向指数函数作多条切线：只会「给定 x 处切线」无法完成。"
  },
  {
    id: "exam-function-2024-new-curriculum-i-13",
    family: "function",
    promptKind: "survey-summary",
    prompt: "两条曲线的公切线。",
    sourceRef: R.newCurriculumI2024,
    provenance: { paper: "2024 新课标Ⅰ卷", number: "13", sourceLevel: "A", inputLicence: "逐题核对原题与图形；公式 OCR 不能当独立证据", answerIndependentlyReviewed: false },
    requiredFigure: "两曲线公切线；需要可靠定义域、交点和切点关联。"
  },
  {
    id: "exam-solid-2023-new-curriculum-i-18",
    family: "solid",
    promptKind: "survey-summary",
    prompt: "正四棱柱中多条棱上的点构成的空间关系。",
    sourceRef: R.newCurriculumI2023,
    provenance: { paper: "2023 新课标Ⅰ卷", number: "18", sourceLevel: "A", inputLicence: "卷面为图片 PDF；题号/结构来自逐页目检，公式 OCR 不能当独立证据", answerIndependentlyReviewed: false },
    requiredFigure: "正四棱柱中多棱上点的空间关系；不能用假定立方体遮蔽原题条件。"
  },
  {
    id: "exam-solid-2025-new-gaokao-ii-17",
    family: "solid",
    promptKind: "survey-summary",
    prompt: "四边形沿折痕翻起形成空间构型，并追问面面关系。",
    sourceRef: R.newGaokaoII2025,
    provenance: { paper: "2025 新高考Ⅱ卷", number: "17", sourceLevel: "A", inputLicence: "原题转载及配图；转载的答案与公式还需独立复核，只抽作图需求", answerIndependentlyReviewed: false },
    requiredFigure: "四边形沿折痕翻起形成空间构型并追问面面关系；与用户现场的「AEF→PEF、PC 给长求折角」是同族不同题，不写字面特判。"
  }
]

/**
 * **留出集**：**不同的原题**（卷别 + 题号与开发集不相交）。
 *
 * 与开发集同一条纪律（无 oracle、题面是调研摘要），唯一的区别是**原题不同** ——
 * 这正是"留出"两个字的意思：评测看到的必须是**没见过的那道题**。
 */
export const HELD_OUT_CASES: readonly ExamCase[] = [
  {
    id: "held-triangle-2022-new-gaokao-i-18",
    family: "triangle",
    promptKind: "survey-summary",
    prompt: "从三角函数值反求角，再以边与角联动构图。",
    sourceRef: R.newGaokaoI2022,
    provenance: { paper: "2022 新高考Ⅰ卷", number: "18", sourceLevel: "A", inputLicence: "卷面和题号可回指；含原图的题须以后续自动化实拍/渲染复核标签", answerIndependentlyReviewed: false },
    requiredFigure: "从三角函数值反求角，再以边与角联动构图；三角函数多值和角度范围必须过滤。"
  },
  {
    id: "held-conic-2025-new-gaokao-ii-16",
    family: "conic",
    promptKind: "survey-summary",
    prompt: "椭圆动弦。",
    sourceRef: R.newGaokaoII2025,
    provenance: { paper: "2025 新高考Ⅱ卷", number: "16", sourceLevel: "A", inputLicence: "原题转载及配图；转载的答案与公式还需独立复核，只抽作图需求", answerIndependentlyReviewed: false },
    requiredFigure: "双曲线与圆/渐近线、椭圆动弦；组合图和切/割/退化分支必须能显示并回代。"
  },
  {
    id: "held-function-2025-new-gaokao-ii-18",
    family: "function",
    promptKind: "survey-summary",
    prompt: "含参数函数的极值与唯一性情形。",
    sourceRef: R.newGaokaoII2025,
    provenance: { paper: "2025 新高考Ⅱ卷", number: "18", sourceLevel: "A", inputLicence: "原题转载及配图；转载的答案与公式还需独立复核，只抽作图需求", answerIndependentlyReviewed: false },
    requiredFigure: "含参数函数的极值/唯一性情形；展示具体参数图可辅助，但「所有参数」须另外给数学证据。"
  },
  {
    id: "held-solid-2021-zhejiang-19",
    family: "solid",
    promptKind: "survey-summary",
    prompt: "一般棱锥与棱上点、线面角。",
    sourceRef: R.zhejiang2021,
    provenance: { paper: "2021 浙江卷", number: "19", sourceLevel: "A", inputLicence: "卷面、图与题号可回指；保留浙江当年卷别与当年课程边界", answerIndependentlyReviewed: false },
    requiredFigure: "一般棱锥与棱上点、线面角；不能把一般顶点强行换成「底面中心上方」。"
  }
]

/** 这条导出只为让 `DiagramSourceSpan` 的复用被编译器确认（题面区间将来按它记）。 */
export type ExamCaseSourceSpan = DiagramSourceSpan

// ---------------------------------------------------------------- oracle

/**
 * **一条实测读数**：从**最终图**上量出来的量，与题面要求的值。
 *
 * `expected` 由**独立复核过**的 oracle 给出（不是转载方的答案，也不是模型的声明）——
 * 这条分工与 `diagramVerification` 同一口径：量的是落盘之后的坐标，不是构造器说它算对了。
 */
export interface OracleCheck {
  condition: string
  measured: number
  expected: number
  tolerance: number
  /** Missing/unexpected readings are explicit failures, never successful measurements. */
  status?: "measured" | "missing" | "unexpected"
}

export type OracleFailure = OracleCheck | { condition: string; status: "missing" }

export type OracleVerdict =
  | { accepted: true; failed: readonly never[]; reason: "satisfied" }
  | { accepted: false; failed: readonly OracleFailure[]; reason: "not_a_gold_case" | "condition_failed" }

/**
 * **拿一道题的 oracle 判一份实测读数。**
 *
 * 两件事**同时**成立才算通过，缺一不可：
 *
 * 1. 这道题的答案**经过独立复核**（`answerIndependentlyReviewed === true`）。
 *    否则直接 `not_a_gold_case` —— **连判都不判**。这一条比"不许带 oracle"更彻底：
 *    没复核过的题不该发出任何一个"通过"（调研 §3.5：目前一条都没有）。
 * 2. 每个必需条件有且仅有一条实测读数，且所有读数均为有限值、在有限非负容差内。**错图必须被拒** —— 这是 oracle 有牙的唯一证据。
 *
 * 不满足的那几条**逐条返回**（不是一句"不通过"）：判据要能告诉人**差在哪**。
 */
function oracleConditionLabel(oracle: string): string {
  const equals = oracle.indexOf("=")
  return (equals >= 0 ? oracle.slice(0, equals) : oracle).trim()
}

export function judgeAgainstOracle(case_: ExamCase, checks: readonly OracleCheck[]): OracleVerdict {
  if (case_.provenance.answerIndependentlyReviewed !== true || (case_.oracle === undefined || case_.oracle.length === 0)) {
    return { accepted: false, failed: [], reason: "not_a_gold_case" }
  }

  // Match measurements to the reviewed conditions one-to-one. An empty or partial
  // measurement list must never be able to pass a reviewed oracle.
  const required = case_.oracle.map(oracleConditionLabel)
  const consumed = new Set<number>()
  const failed: OracleFailure[] = []

  for (const check of checks) {
    const match = required.findIndex((condition, index) => !consumed.has(index) && condition === check.condition.trim())
    if (match < 0) {
      failed.push({ ...check, status: "unexpected" })
      continue
    }
    consumed.add(match)
    if ((check.status !== undefined && check.status !== "measured") ||
        !Number.isFinite(check.measured) || !Number.isFinite(check.expected) ||
        !Number.isFinite(check.tolerance) || check.tolerance < 0 ||
        !(Math.abs(check.measured - check.expected) <= check.tolerance)) {
      failed.push({ ...check, status: check.status ?? "measured" })
    }
  }

  for (const [index, condition] of required.entries()) {
    if (!consumed.has(index)) {
      failed.push({
        condition,
        status: "missing"
      })
    }
  }

  return failed.length === 0
    ? { accepted: true, failed: [], reason: "satisfied" }
    : { accepted: false, failed, reason: "condition_failed" }
}
