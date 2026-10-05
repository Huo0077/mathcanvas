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
 * ## `pythagorean`（勾股）：没有**直接**载体，但有一个**与之等价的近邻**（2026-10-05 查清）
 *
 * 它确实不在任何一种现成词表里：`fixedDistance` 固定的是"**某一条边**的长度"，不是"a²+b²=c²"。
 * 但"没有直接载体"**不等于**"表达不出来"：对三个点 X / Y / Z，
 * **`XY ⊥ YZ` 与 `|XY|² + |YZ|² = |XZ|²` 是等价的**（勾股定理及其逆定理）。
 * 而 `perpendicular` **是** `ConstraintType` 的一员，内核既判又投影；角度本身也有测量载体
 *（`derivedNodes.ts` 的 `MeasurementMetric` 含 `angle`，`dsl/types.ts` 的 `MEASUREMENT_METRICS` 含 `angle` / `dihedral`）。
 *
 * **所以这一条不是"缺能力"，而是一个取舍**：要不要让证明出口走
 * "**把勾股目标判成 ⊥ 目标、再用勾股定理那一步把结论接回来**"这条路。
 * 关键区别必须写清楚：**那是"证明里的一步"，不是"同一个目标"** ——
 * 把两者**别名**（alias）就等于把一条**推断**藏进分类函数里，而推断应该出现在证明里、被看得见。
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

/**
 * **没有直接载体时，允许走一步显式推断**（用户 2026-10-05 的裁决：勾股就是这么处理的）。
 *
 * 关键区别：**这不是"别名"**。别名会把一条推断藏进分类函数里（"问 ⊥ 也返回勾股"），
 * 而这里要求那一步**出现在证明里、有名字、搜得到**。
 */
export interface ProofGoalInference {
  /** 先要证出来的那个目标。 */
  from: ProofGoalKind
  /** 那一步叫什么。**必须点名**（可搜索），不许写成一句"等价"。 */
  theorem: string
  /** 为什么它不是"同一个目标" —— 写给将来接后端的人看。 */
  note: string
}

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
  /**
   * **没有直接载体时的推断路线**（`pythagorean` 是唯一一个）。
   * 与上面两个载体字段的区别：载体是"文档/原话里能不能承载它"，这里是"**怎么把它证出来**"。
   */
  inference?: ProofGoalInference
  /** 是否在计划点名的**首批**短目标里。 */
  inFirstBatch: boolean
}

/**
 * 支持矩阵。
 *
 * `equilateral`（等边三角形）映射到 `equalLength`：等边就是三条边两两等长，
 * 作为证明目标与"两边等长"是同一类断言 —— 但**判据仍在内核**，这里只做分类，不做证明。
 */
/**
 * **消解路线**。留 `none` 这一档不是装饰：它是 fail-closed 的默认值 ——
 * 将来加了一个既没载体、也没推断路线的目标时，它会**如实返回 none**，而不是被当成"直接能判"。
 */
export type ProofGoalDischargeRoute =
  | { kind: "direct" }
  | { kind: "via-inference"; from: ProofGoalKind; theorem: string; note: string }
  | { kind: "none" }

export const PROOF_GOAL_SUPPORT: readonly ProofGoalSupport[] = [
  { kind: "parallel", description: "两条线平行", obligationKinds: ["parallel"], constraintTypes: ["parallel"], inFirstBatch: true },
  { kind: "perpendicular", description: "两条线垂直", obligationKinds: ["perpendicular"], constraintTypes: ["perpendicular"], inFirstBatch: true },
  { kind: "planePerpendicular", description: "线垂直于平面", obligationKinds: ["planePerpendicular"], constraintTypes: [], inFirstBatch: true },
  { kind: "equalLength", description: "两条线段等长（含等边三角形）", obligationKinds: ["equalLength", "equilateral"], constraintTypes: [], inFirstBatch: true },
  { kind: "midpoint", description: "某点是某线段的中点", obligationKinds: ["midpoint"], constraintTypes: [], inFirstBatch: true },
  { kind: "segmentRatio", description: "两条线段的比", obligationKinds: ["segmentRatio"], constraintTypes: [], inFirstBatch: true },
  { kind: "collinear", description: "若干点共线", obligationKinds: [], constraintTypes: ["collinear"], inFirstBatch: true },
  { kind: "coplanar", description: "若干点共面", obligationKinds: [], constraintTypes: ["coplanar"], inFirstBatch: true },
  {
    kind: "pythagorean",
    description: "勾股关系（两条直角边与斜边）",
    obligationKinds: [],
    constraintTypes: [],
    inFirstBatch: true,
    /**
     * **裁决（2026-10-05，用户决定）**：走"判成 ⊥ 目标 + 用**勾股定理那一步**把结论接回来"。
     *
     * 对三个点 X / Y / Z，`XY ⊥ YZ` 与 `|XY|² + |YZ|² = |XZ|²` 等价 —— 但**等价不等于同一个目标**：
     * 中间那一步是一条**定理**，它必须出现在证明里。所以这里给的是**推断路线**，
     * 而不是往 `constraintTypes` 里塞一个 `"perpendicular"`（那就是别名，会把推断藏起来）。
     */
    inference: {
      from: "perpendicular",
      theorem: "勾股定理及其逆定理",
      note: "对三点 X/Y/Z：`XY ⊥ YZ` ⟺ `|XY|² + |YZ|² = |XZ|²`。证明里必须先有 ⊥ 的结论，再用这一步接过去。**不许把勾股直接判成 ⊥** —— 那等于把这条推断藏进分类函数。"
    }
  },
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
/**
 * **这个目标怎么被消解**：直接判，还是要多走一步显式推断？
 *
 * 接后端的人需要它回答两个不同的问题：**要不要为它准备一个判定器**（`direct`），
 * **还是要在证明里多写一步**（`via-inference`）。
 */
export function proofGoalDischargeRoute(kind: ProofGoalKind): ProofGoalDischargeRoute {
  const support = PROOF_GOAL_SUPPORT.find((entry) => entry.kind === kind)
  if (support === undefined) return { kind: "none" }
  if (support.obligationKinds.length > 0 || support.constraintTypes.length > 0) return { kind: "direct" }
  if (support.inference !== undefined) {
    return { kind: "via-inference", from: support.inference.from, theorem: support.inference.theorem, note: support.inference.note }
  }
  return { kind: "none" }
}

/** 在首批里、**一条路线都没有**的目标（既没有直接载体，也没有推断路线）。今天**是空的**。 */
export function firstBatchGoalsWithoutAnyRoute(): ProofGoalKind[] {
  return PROOF_GOAL_SUPPORT
    .filter((support) => support.inFirstBatch && proofGoalDischargeRoute(support.kind).kind === "none")
    .map((support) => support.kind)
}

export function firstBatchGoalsWithoutAnyCarrier(): ProofGoalKind[] {
  return PROOF_GOAL_SUPPORT
    .filter((support) => support.inFirstBatch && support.obligationKinds.length === 0 && support.constraintTypes.length === 0)
    .map((support) => support.kind)
}
