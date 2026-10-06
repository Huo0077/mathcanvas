/**
 * **统一数学状态 IR 的证据词表**（设计 2026-10-04 §3；Phase N1）。
 *
 * 这个文件只放"一句话的证据状态怎么说"——**不放任何一个判定实现**。
 * 理由：N2 的求解器、N5 的证明后端、以及现在的静态核验都必须用**同一套词**，
 * 而词表一旦跟着某个实现走，第二个实现就会发明自己的近义词（"基本通过"之类），
 * 于是"这条 claim 到底证明了没有"再也无法在界面上比较。
 *
 * ## 控制器裁决 R1：证据状态与搜索结果是两件事
 *
 * 计划头部 Global Constraints 与 spec §4C / N5 都把 `verified_instance` 当作**证据状态**
 * 使用（"没有 proof artifact 时只能显示 verified_instance 或 sampled"），
 * 但 spec §3 的 `ClaimEvidenceStatus` 枚举里没有它。裁决：
 *
 * - `ClaimEvidenceStatus` **补上 `"verified_instance"`**，与 `sampled` / `formally_proved`
 *   并列 —— 这三态**互斥**，也正好是 Global Constraints 要求的三态；
 * - `WitnessResultStatus` 仍然是**候选搜索的结果**（找到了一个通过核验的实例 / 找到了
 *   但没通过 / 一个都没找到），它不是证据等级；
 * - 两者的桥就是本文件导出的 `evidenceStatusForWitness` —— 显式一张表，
 *   而不是让每个调用点自己 `switch`（那种"每个调用点各写一次"的翻译正是本项目反复踩的坑）。
 *
 * 为什么不能把它们合成一个枚举：`no_witness`（没找到见证）与 `failed`（证据表明不成立）
 * 在产品上是两句话 —— 前者是"我还不知道"，后者是"我知道它不是"。合成一个只会让
 * N2 的失败被显示成"题设不成立"。
 */

/**
 * **三类证据状态互斥**（Global Constraints 第一条）：
 * `verified_instance`（有一个通过核验的实例）／`sampled`（只做了数值采样）／
 * `formally_proved`（有可独立校验的证明产物）。其余四态是"还没有证据"的各种原因。
 *
 * `inconsistent` 与 `failed` 的分别：`inconsistent` = 约束系统自相矛盾（过约束/无解），
 * `failed` = 系统自洽但候选实例不满足。两者在界面上给出的下一步完全不同。
 */
export type ClaimEvidenceStatus =
  | "not_run"
  | "verified_instance"
  | "sampled"
  | "formally_proved"
  | "failed"
  | "unknown"
  | "inconsistent"
  | "timeout"

/** 三态互斥的证据等级（其余状态都不代表"已有证据"）。 */
export const EVIDENCE_STATUSES: readonly ClaimEvidenceStatus[] = [
  "not_run", "verified_instance", "sampled", "formally_proved", "failed", "unknown", "inconsistent", "timeout"
]

/** **候选搜索**的结果（与证据等级无关；见 R1）。 */
export type WitnessResultStatus = "verified_instance" | "unverified_instance" | "no_witness"

export const WITNESS_RESULT_STATUSES: readonly WitnessResultStatus[] = ["verified_instance", "unverified_instance", "no_witness"]

/**
 * 约束求解器的结果。**必须区分 `unsat` 与 `unknown` / `timeout` / `diverged`**
 * （设计 §2.1）：把它们压成一个布尔值，就会把"没算出来"显示成"无解"。
 */
export type SolverStatus = "not_run" | "model" | "unsat" | "unknown" | "timeout" | "diverged"

export const SOLVER_STATUSES: readonly SolverStatus[] = ["not_run", "model", "unsat", "unknown", "timeout", "diverged"]

/** claim 在原题里的角色（设计 §3）。 */
export type ClaimRole = "given" | "construction" | "goal" | "free_choice"

/** 这条 claim 现在**能不能被判**（`ambiguous` = 解析出来但判据不唯一/不可靠）。 */
export type Judgeability = "supported" | "unsupported" | "ambiguous"

/** 一条几何 claim 的判定容差；`angular` 用度、`relative` 用比例。 */
export interface ObligationTolerance {
  kind: "absolute" | "relative" | "angular"
  value: number
}

/**
 * **通用字段装不下的已解析几何事实**。
 *
 * 现在只有一项，但它必须留：`平面ABD⊥平面BCD` 的解析结果里，两个平面各由**几个点名**
 * 组成（`planeLengths`）是原话的结构信息 —— 现有核验器**用它**把 targets 切成两个平面
 * （`diagramVerification.ts` 的 `item.planeLengths?.[0] ?? targets.length / 2`），
 * 而 targets 是扁平的。IR 若把它丢掉，兼容适配就只能**猜**切点；
 * 猜对题目、猜错另一个题面，正是 R4 要防的那种"为了让 IR 好看而改动调用点语义"。
 */
export interface ObligationGeometry {
  planeLengths?: [number, number]
  /** Explicit coordinates from the user's words, not from the model's plan. */
  coordinate?: { x: number; y: number; z: number }
  /**
   * 题面写下的圆锥曲线参数（`x²/9+y²/4=1` ⇒ 半轴 3 与 2）。
   *
   * 与 `coordinate` 同一条理由：它是**原话里的结构信息**。generic 字段装不下两个数，
   * 而只留 `value` 一个数就得把"哪条半轴在哪个轴上"丢掉 —— 那正好是判"焦点在不在 x 轴"
   * 所需要的信息，丢了它，半轴对调的图会被判成通过。
   */
  conic?: { kind: "ellipse"; radiusX: number; radiusY: number }
}

/**
 * **统一后的几何 claim**（spec §3 的 `GeometryObligation`）。
 *
 * `start` / `end` 是它在**用户原话**里的区间，`sourceText` 必须等于
 * `prompt.slice(start, end)` —— 这是"可追溯"唯一可被程序核验的形式，也是
 * `obligationIR.test.ts` 逐条断言的东西。模型自报的 relations **不能**取代这份原话清单。
 */
export interface GeometryObligation {
  id: string
  role: ClaimRole
  kind: string
  sourceText: string
  start: number
  end: number
  targets: string[]
  expected?: number | string
  judgeability: Judgeability
  tolerance?: ObligationTolerance
  /** 见 `ObligationGeometry`：R4 兼容适配需要的、通用字段装不下的已解析事实。 */
  geometry?: ObligationGeometry
}

/**
 * 一条 claim 的**证据**（spec §3 的 `ClaimEvidence`）。
 *
 * `solver` 与 `status` 分开：状态说"我们凭什么说它成立"，solver 说"算过没有、
 * 算出了什么"。`degreesOfFreedom` 为 `null` 表示**没有算过**，不是"零自由度"——
 * 这正是 `reportFreeDegrees` 的返回值要填进来的字段。
 */
export interface ClaimEvidence {
  status: ClaimEvidenceStatus
  solver: SolverStatus
  residuals: Record<string, number | null>
  degreesOfFreedom: number | null
  nextActions: string[]
}

/**
 * R1 的显式映射：**候选搜索结果 → 证据状态**（N2 / N5 共用这一张表）。
 *
 * - `verified_instance` → `verified_instance`：有一个通过核验的实例，证据就是那个实例；
 * - `unverified_instance` → `unknown`：找到了候选但**没能核验**（点名缺失、退化、超预算）——
 *   "不知道"必须保持是"不知道"，不能升格成通过；
 * - `no_witness` → `unknown`（**裁决 R8 改的**）：搜索**确实跑过**（所以不是 `not_run`），
 *   但它没有跑出否定结论 —— "没找到见证"是「我还不知道」，不是「我知道它不是」。
 *   本文件对 `failed` 的定义是"系统自洽而候选实例不满足"，那要求**有反例证据**；
 *   把"没找到"写成 `failed` 会让界面把"没算出来"显示成"题设不成立"。
 *
 * **若 N2 的搜索器真能给出冲突证据**（例如约束系统被证明无解），那时由**搜索器**自己报
 * `inconsistent` —— 那是求解器状态（`SolverStatus.unsat`）该说的话，不在这张静态映射表里
 * 预先断言。这张表只说"搜索结果本身"意味着什么。
 */
export function evidenceStatusForWitness(result: WitnessResultStatus): ClaimEvidenceStatus {
  if (result === "verified_instance") return "verified_instance"
  return "unknown"
}

/** 现有静态核验的三态（`DiagramCheckStatus`）；这里刻意用字面量联合，避免依赖那张报告。 */
export type LegacyCheckStatus = "passed" | "failed" | "unverified"

export interface LegacyCheckDetails {
  /** 逐条实测残差（键 = 题设原文，与 `DiagramCheck.sourceText` 同一套键）。 */
  residuals?: Record<string, number | null>
  /** 已算出的自由度（`reportFreeDegrees` 的 `residualDof`）。没算过就别填。 */
  degreesOfFreedom?: number
}

/**
 * **兼容适配（R4）**：把现有 `DiagramVerificationReport` 的逐条结论翻成统一证据。
 *
 * `passed` 只能翻成 `verified_instance` —— 现有核验做的是"在**这一份候选图**的坐标上
 * 逐条量过"，它既不是采样（`sampled` 是"抽查若干点都成立"），更不是形式证明
 *（spec §4C.5：没有 proof artifact 时只能显示 verified_instance 或 sampled）。
 * 这条映射如果写成 `formally_proved`，就等于让静态核验冒充证明出口。
 */
export function evidenceFromLegacyCheck(status: LegacyCheckStatus, details: LegacyCheckDetails = {}): ClaimEvidence {
  const mapped: ClaimEvidenceStatus = status === "passed" ? "verified_instance" : status === "failed" ? "failed" : "unknown"
  return {
    status: mapped,
    // 静态核验不经过求解器；说 `model` 会谎报"算过一个模型"。
    solver: "not_run",
    residuals: details.residuals ?? {},
    degreesOfFreedom: details.degreesOfFreedom ?? null,
    nextActions: status === "passed"
      ? ["可以用这张实例图；要升级成“对所有情形成立”仍需 N5 的证明产物。"]
      : status === "failed"
        ? ["让模型按实测残差改坐标，或在 N2 的求解器里重新求一个满足约束的实例。"]
        : ["补齐点名映射或把这条条件交给 N2 的求解器/判据，不要按“已通过”处理。"]
  }
}
