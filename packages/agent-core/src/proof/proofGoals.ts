import type { ConstraintType } from "@draw/dsl"

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
 * ## 一个目标可以有**两种载体**，这一版必须把两种都写出来（2026-10-05 更正）
 *
 * 第一版只按 `DiagramObligationKind`（**解析层**的题设种类）映射，于是把"共线 / 共面"写成了
 * **表达不出来**。**那个结论是错的**：这个仓库里**能承载一个几何判断的地方不止一处** ——
 *
 * - **解析层**：`DiagramObligationKind`，原话被读出来的题设；
 * - **约束层**：`ConstraintType`（`packages/dsl`），文档里持久化的约束 ——
 *   它**本来就有** `collinear` / `coplanar`，而且内核**既判**（`constraints3d.ts` 的
 *   `collinearResidual` / `coplanarResidual`）**又投影**（`constraints3dProjection.ts` 的
 *   `PROJECTABLE`）。
 *
 * 所以我原来那句"共线 / 共面表达不出来"只在**解析层**成立，在**约束层**不成立。
 * 教训与第 46 轮那次同源：**先问"这件事在这个仓库里是不是已经有别的机制在做"**，
 * 再去下"缺能力"的结论。**低估和夸大一样是错。**
 *
 * ## 三种状态必须分开写，不许混成"支持 / 不支持"两档
 *
 * - **有解析层载体**：原话里出现就能被读出来；
 * - **只有约束层载体**：文档里能持久化这个约束（由模型或手工建立），但**原话读不出来**；
 * - **一处载体都没有**：今天没有任何东西能表达它（今天只有 `pythagorean` 一个）。
 *
 * `pythagorean`（勾股）为什么仍然没有载体：它是**三条边的代数关系**，既不是题设种类，也不是
 * 任何一种 `ConstraintType`（`fixedDistance` 固定的是"某一条边的长度"，不是"a²+b²=c²"）。
 * **这一条才是真的需要裁决的**（扩约束词表？扩解析层？还是从首批里划掉）。
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
   * **解析层**的载体：哪些 `DiagramObligationKind` 能承载这个目标。
   * **空数组 = 原话里读不出这种目标**（不代表整个仓库都表达不了它 —— 看下面那个字段）。
   */
  obligationKinds: readonly DiagramObligationKind[]
  /**
   * **约束层**的载体：哪些 `ConstraintType` 能承载这个目标。
   * 内核对它们既**判**又**投影**，所以它们是**真实存在的载体**，不是名义上的。
   */
  constraintTypes: readonly ConstraintType[]
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
  { kind: "parallel", description: "两条线平行", obligationKinds: ["parallel"], constraintTypes: ["parallel"], inFirstBatch: true },
  { kind: "perpendicular", description: "两条线垂直", obligationKinds: ["perpendicular"], constraintTypes: ["perpendicular"], inFirstBatch: true },
  { kind: "planePerpendicular", description: "线垂直于平面", obligationKinds: ["planePerpendicular"], constraintTypes: [], inFirstBatch: true },
  { kind: "equalLength", description: "两条线段等长（含等边三角形）", obligationKinds: ["equalLength", "equilateral"], constraintTypes: [], inFirstBatch: true },
  { kind: "midpoint", description: "某点是某线段的中点", obligationKinds: ["midpoint"], constraintTypes: [], inFirstBatch: true },
  { kind: "segmentRatio", description: "两条线段的比", obligationKinds: ["segmentRatio"], constraintTypes: [], inFirstBatch: true },
  { kind: "collinear", description: "若干点共线", obligationKinds: [], constraintTypes: ["collinear"], inFirstBatch: true },
  { kind: "coplanar", description: "若干点共面", obligationKinds: [], constraintTypes: ["coplanar"], inFirstBatch: true },
  { kind: "pythagorean", description: "勾股关系（两条直角边与斜边）", obligationKinds: [], constraintTypes: [], inFirstBatch: true },
  { kind: "dihedral", description: "二面角", obligationKinds: ["dihedral"], constraintTypes: [], inFirstBatch: false }
]

/**
 * **这条题设种类算不算一个"已声明的短目标"** —— 证明出口升级证据状态前**必须**过的门。
 *
 * 返回 `null` 的三种情形分开说（都返回 `null`，但原因不同，便于诊断）：
 * ① 这种题设根本不映射到任何证明目标；② 映射到了但**不在首批**（`dihedral`）；
 * ③ 映射到了、也在首批，但**解析层读不出它** —— 那时用 `declaredProofGoalForConstraint`
 * 从**约束层**再问一次（例如"共线"只能由文档里的约束承载，不能由原话承载）。
 */
export function declaredProofGoal(obligationKind: string): { goal: ProofGoalKind; support: ProofGoalSupport } | null {
  for (const support of PROOF_GOAL_SUPPORT) {
    if (!support.obligationKinds.includes(obligationKind as DiagramObligationKind)) continue
    if (!support.inFirstBatch) return null
    return { goal: support.kind, support }
  }
  return null
}

/**
 * **同一条门，从约束层问一遍**（`ConstraintType`）。
 *
 * 需要它是因为"共线 / 共面"这两个目标**只有约束层载体**：原话读不出来，但文档里可以持久化
 * 这两条约束，而内核既判又投影。少了这个入口，那两个目标会被错判成"表达不出来"。
 */
export function declaredProofGoalForConstraint(constraintType: string): { goal: ProofGoalKind; support: ProofGoalSupport } | null {
  for (const support of PROOF_GOAL_SUPPORT) {
    if (!support.constraintTypes.includes(constraintType as ConstraintType)) continue
    if (!support.inFirstBatch) return null
    return { goal: support.kind, support }
  }
  return null
}

/** 在首批里、但**解析层读不出来**的目标（要靠约束层或扩解析层，**不等于**整个仓库表达不了）。 */
export function firstBatchGoalsWithoutObligationCarrier(): ProofGoalKind[] {
  return PROOF_GOAL_SUPPORT
    .filter((support) => support.inFirstBatch && support.obligationKinds.length === 0)
    .map((support) => support.kind)
}

/**
 * 在首批里、**一处载体都没有**的目标 —— 这才是"真的需要裁决"的那一份。
 *
 * 第一版把它和上面那个混成了一个函数，于是把"只有约束层载体"的共线/共面也算成了"表达不出来"。
 */
export function firstBatchGoalsWithoutAnyCarrier(): ProofGoalKind[] {
  return PROOF_GOAL_SUPPORT
    .filter((support) => support.inFirstBatch && support.obligationKinds.length === 0 && support.constraintTypes.length === 0)
    .map((support) => support.kind)
}
