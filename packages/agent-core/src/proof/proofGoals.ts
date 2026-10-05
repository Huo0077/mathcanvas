import type { DiagramObligationKind } from "../diagramObligations"

/**
 * **形式证明出口声称支持哪些短目标**（实施计划 N5："先支持 5–10 个短目标"；
 * 同一份矩阵要进 proof support matrix 与发布门禁）。
 *
 * ## 为什么需要一份"声称支持什么"的清单
 *
 * 证明出口最危险的失效方式不是"证不出来"，而是**把没证的东西说成证过了**。所以判据要先有
 * 一个**封闭词表**：只有落在表里的目标，才允许升到 `formally_proved`；表外的一律停在
 * 原来那个证据状态（`verified_instance` / `sampled`）。
 *
 * ## 三种状态必须分开写，不许混成"支持 / 不支持"两档
 *
 * 计划点名的短目标是"共线/共面、平行/垂直、等长、勾股"，但**解析层现在产生不出共线与共面**
 * —— `DiagramObligationKind` 里根本没有这两种（见下）。如果照着计划的话把它们列进"支持"，
 * 这张表就会变成一句**没有载体的话**：永远不会有任何一条 goal 被分类成它。
 * 所以每种目标都注明它是哪一种：
 *
 * - **已声明且可表达**：有对应的题设种类，现在就能被分类出来（后端还没接，所以跑起来只会
 *   得到 `unsupported` —— 那是**后端**的状态，与"目标能不能被表达"是两件事）；
 * - **计划点名、但现在表达不出来**：`collinear` / `coplanar` / `pythagorean`。要么先扩解析层，
 *   要么从计划的首批里划掉 —— **这一条要一个裁决**，本文件只如实标注；
 * - **不在首批**：`dihedral`（二面角）—— 计划的首批清单里没有它。
 *
 * ## 为什么按**题设种类**映射，而不是按文本匹配
 *
 * 本项目在关键词表上吃过亏（`relationExtraction` 的覆盖度校对曾因为关键词太宽把两个既有夹具
 * 误判成"漏声明"）。而 `GeometryObligation.kind` 是**结构化**的、已经过 schema 校验的字段，
 * 从它映射是确定性的；从原话里再猜一遍关键词只会多一处会漂移的判据。
 */

/** 证明出口的短目标种类（**封闭词表**）。 */
export type ProofGoalKind =
  | "parallel"
  | "perpendicular"
  | "planePerpendicular"
  | "equalLength"
  | "midpoint"
  | "segmentRatio"
  | "collinear"
  | "coplanar"
  | "pythagorean"
  | "dihedral"

export const PROOF_GOAL_KINDS: readonly ProofGoalKind[] = [
  "parallel", "perpendicular", "planePerpendicular", "equalLength", "midpoint", "segmentRatio",
  "collinear", "coplanar", "pythagorean", "dihedral"
]

export interface ProofGoalSupport {
  kind: ProofGoalKind
  /** 给人（与界面）看的一句话。 */
  description: string
  /**
   * 哪些**已经存在**的题设种类可以承载这个目标。
   * **空数组 = 解析层现在还产生不出来** —— 那么它就不可能进入首批。
   */
  obligationKinds: readonly DiagramObligationKind[]
  /** 是否在计划点名的**首批**短目标里。 */
  inFirstBatch: boolean
}

/**
 * 支持矩阵。
 *
 * `equilateral`（等边三角形）映射到 `equalLength`：等边就是三条边两两等长，
 * 作为证明目标与"两边等长"是同一类断言 —— 但**判据仍在内核**，这里只做分类，不做证明。
 */
export const PROOF_GOAL_SUPPORT: readonly ProofGoalSupport[] = [
  { kind: "parallel", description: "两条线平行", obligationKinds: ["parallel"], inFirstBatch: true },
  { kind: "perpendicular", description: "两条线垂直", obligationKinds: ["perpendicular"], inFirstBatch: true },
  { kind: "planePerpendicular", description: "线垂直于平面", obligationKinds: ["planePerpendicular"], inFirstBatch: true },
  { kind: "equalLength", description: "两条线段等长（含等边三角形）", obligationKinds: ["equalLength", "equilateral"], inFirstBatch: true },
  { kind: "midpoint", description: "某点是某线段的中点", obligationKinds: ["midpoint"], inFirstBatch: true },
  { kind: "segmentRatio", description: "两条线段的比", obligationKinds: ["segmentRatio"], inFirstBatch: true },
  { kind: "collinear", description: "若干点共线", obligationKinds: [], inFirstBatch: true },
  { kind: "coplanar", description: "若干点共面", obligationKinds: [], inFirstBatch: true },
  { kind: "pythagorean", description: "勾股关系（两条直角边与斜边）", obligationKinds: [], inFirstBatch: true },
  { kind: "dihedral", description: "二面角", obligationKinds: ["dihedral"], inFirstBatch: false }
]

/**
 * **这条题设种类算不算一个"已声明的短目标"** —— 证明出口升级证据状态前**必须**过的门。
 *
 * 返回 `null` 的三种情形分开说（都返回 `null`，但 `reason` 不同，便于诊断）：
 * ① 这种题设根本不映射到任何证明目标；② 映射到了，但那个目标**现在还表达不出来**
 *（`collinear` / `coplanar` / `pythagorean`：解析层没有对应的题设种类）；
 * ③ 映射到了、也表达得出来，但**不在首批**（`dihedral`）。
 */
export function declaredProofGoal(obligationKind: string): { goal: ProofGoalKind; support: ProofGoalSupport } | null {
  for (const support of PROOF_GOAL_SUPPORT) {
    if (!support.obligationKinds.includes(obligationKind as DiagramObligationKind)) continue
    if (!support.inFirstBatch) return null
    return { goal: support.kind, support }
  }
  return null
}

/** 计划点名、但**现在还表达不出来**的目标（空 `obligationKinds` 且在首批里）。 */
export function unexpressibleFirstBatchGoals(): ProofGoalKind[] {
  return PROOF_GOAL_SUPPORT
    .filter((support) => support.inFirstBatch && support.obligationKinds.length === 0)
    .map((support) => support.kind)
}
