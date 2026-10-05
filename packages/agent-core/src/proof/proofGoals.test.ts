import { describe, expect, it } from "vitest"

import { declaredProofGoal, declaredProofGoalForConstraint, firstBatchGoalsWithoutAnyCarrier, firstBatchGoalsWithoutObligationCarrier, PROOF_GOAL_KINDS, PROOF_GOAL_SUPPORT } from "./proofGoals"

/**
 * **形式证明出口声称支持哪些短目标**（N5）。
 *
 * 这张表存在的意义是**fail-closed**：只有落在表里的目标才允许升到 `formally_proved`。
 * 所以这里既要钉"表里有的能映射"，也要钉"表外的、以及**现在还表达不出来**的，
 * 不许被悄悄算成支持"。
 */
describe("形式证明的短目标词表（N5）", () => {
  it("词表与矩阵是同一份键集合（加了词表却忘了矩阵会被这条挡住）", () => {
    expect(PROOF_GOAL_SUPPORT.map((entry) => entry.kind).sort()).toEqual([...PROOF_GOAL_KINDS].sort())
    expect(new Set(PROOF_GOAL_SUPPORT.map((entry) => entry.kind)).size).toBe(PROOF_GOAL_KINDS.length)
  })

  it("首批里能表达的目标：题设种类映射到目标（含等边 → 等长）", () => {
    expect(declaredProofGoal("parallel")?.goal).toBe("parallel")
    expect(declaredProofGoal("perpendicular")?.goal).toBe("perpendicular")
    expect(declaredProofGoal("planePerpendicular")?.goal).toBe("planePerpendicular")
    expect(declaredProofGoal("equilateral")?.goal).toBe("equalLength")
    expect(declaredProofGoal("equalLength")?.goal).toBe("equalLength")
    expect(declaredProofGoal("midpoint")?.goal).toBe("midpoint")
    expect(declaredProofGoal("segmentRatio")?.goal).toBe("segmentRatio")
  })

  it("**不在首批**的目标即使能表达也不放行（二面角）", () => {
    expect(declaredProofGoal("dihedral")).toBeNull()
  })

  it("不映射到任何证明目标的题设种类要返回 null，而不是猜一个最近的", () => {
    expect(declaredProofGoal("fixedLength")).toBeNull()
    expect(declaredProofGoal("乱写的")).toBeNull()
  })

  it("**两种载体要分开报**：解析层读不出的 ≠ 一处载体都没有的", () => {
    // 第一版把这两件事混成一个函数，于是把"只有约束层载体"的共线/共面也算成了"表达不出来"。
    expect(firstBatchGoalsWithoutObligationCarrier()).toEqual(["collinear", "coplanar", "pythagorean"])
    // 而**真的**一处载体都没有的，今天只有勾股一个。
    expect(firstBatchGoalsWithoutAnyCarrier()).toEqual(["pythagorean"])
    for (const kind of firstBatchGoalsWithoutAnyCarrier()) {
      const support = PROOF_GOAL_SUPPORT.find((entry) => entry.kind === kind)
      expect(support?.inFirstBatch).toBe(true)
      expect(support?.obligationKinds).toEqual([])
      expect(support?.constraintTypes).toEqual([])
    }
  })

  it("**约束层也是载体**：共线 / 共面从约束层问得出来（从解析层问不出来）", () => {
    // 解析层：读不出这种题设。
    expect(declaredProofGoal("collinear")).toBeNull()
    // 约束层：`ConstraintType` 本来就有它们，而内核既判又投影。
    expect(declaredProofGoalForConstraint("collinear")?.goal).toBe("collinear")
    expect(declaredProofGoalForConstraint("coplanar")?.goal).toBe("coplanar")
    // 两层都有的目标，两边都能问到同一个答案。
    expect(declaredProofGoal("parallel")?.goal).toBe("parallel")
    expect(declaredProofGoalForConstraint("parallel")?.goal).toBe("parallel")
    // 约束层没有的，约束层入口也要如实返回 null（不许猜）。
    expect(declaredProofGoalForConstraint("fixedDistance")).toBeNull()
    expect(declaredProofGoalForConstraint("乱写的")).toBeNull()
  })
})
