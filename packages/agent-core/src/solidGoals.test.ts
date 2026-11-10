import { describe, expect, it } from "vitest"

import { CASE_1, CASE_2, CASE_3, CASE_4_REVISED } from "./fixtures/solidGeometryFourCases"
import { evaluateSolidGoals, formatSolidGoalAnswer } from "./solidGoals"
import { tryBuildParametricSolidPlan } from "./parametricSolidPlan"
import { tryBuildPolygonFoldPlan } from "./polygonFoldPlan"

/**
 * **T7：目标结果与题设核验分离**（2026-11-05 四题修复）。
 *
 * 四道题里 **Case 1 / Case 2 的第一个待证结论是假的**，而题设本身完全成立 ——
 * 这一组要同时钉住两件事：
 *
 * 1. **题设通过**（`tryBuildParametricSolidPlan` 出计划）**与**"目标不成立"可以并存；
 * 2. 数值目标按设计 §3 的解析值给出（`1/√2`、`0`、`√3`、`acos(1/√3)`），
 *    且**三种角分开量**（线面角 / 二面角 / 平面夹角不共用一个数）。
 */

/** 用候选点表求目标（与产品路径同一份量测）。 */
function findingsFor(prompt: string) {
  const built = tryBuildParametricSolidPlan({ prompt })
  expect(built.status, JSON.stringify(built)).toBe("ok")
  if (built.status !== "ok") throw new Error("没有出计划")
  const points = new Map<string, { x: number; y: number; z: number }>()
  for (const [index, name] of built.candidate.names.entries()) points.set(name, built.candidate.vertices[index]!)
  for (const auxiliary of built.candidate.auxiliaryPoints ?? []) points.set(auxiliary.name, auxiliary.point)
  return { built, findings: evaluateSolidGoals(prompt, points) }
}

describe("T7 目标层：题设通过与目标真假分开", () => {
  it("Case 1：题设通过，但 `AE⊥平面PBC` **不成立**（残差非零）；线面角正弦 = 1/√2", () => {
    const { built, findings } = findingsFor(CASE_1.prompt)
    /** **题设通过**：计划照出（草稿可提交）。 */
    expect(built.plan.kind).toBe("plan")
    const perpendicular = findings.find((finding) => finding.kind === "line-plane-perpendicular")!
    expect(perpendicular.status).toBe("disproved")
    expect(perpendicular.residual).not.toBeNull()
    expect(perpendicular.residual!).toBeGreaterThan(1e-6)

    const angle = findings.find((finding) => finding.kind === "line-plane-angle")!
    expect(angle.status).toBe("measured")
    expect(angle.measured!).toBeCloseTo(Math.SQRT1_2, 9)
  })

  it("Case 2：`A₁C∥平面B₁DE` **不成立**；二面角 A-DE-B₁ 的余弦 = 0", () => {
    const { findings } = findingsFor(CASE_2.prompt)
    const parallel = findings.find((finding) => finding.kind === "line-plane-parallel")!
    expect(parallel.status).toBe("disproved")
    expect(parallel.residual!).toBeGreaterThan(1e-6)
    const dihedral = findings.find((finding) => finding.kind === "dihedral")!
    expect(dihedral.status).toBe("measured")
    expect(dihedral.measured!).toBeCloseTo(0, 9)
  })

  it("Case 3：`PA∥平面BDM` **成立**；点 A 到平面 PBD 的距离 = √3", () => {
    const { findings } = findingsFor(CASE_3.prompt)
    const parallel = findings.find((finding) => finding.kind === "line-plane-parallel")!
    expect(parallel.status).toBe("holds")
    const distance = findings.find((finding) => finding.kind === "point-plane-distance")!
    expect(distance.status).toBe("measured")
    expect(distance.measured!).toBeCloseTo(Math.sqrt(3), 9)
  })

  it("Case 4 修订版：`AP⊥CD`（CD 指折前）**不成立**；二面角 P-AB-C 的余弦 = 1/√3", () => {
    const built = tryBuildPolygonFoldPlan({ prompt: CASE_4_REVISED.prompt })
    expect(built.status).toBe("ok")
    if (built.status !== "ok") return
    const points = new Map(Object.entries({ ...built.geometry.pre, ...built.geometry.post }))
    const findings = evaluateSolidGoals(CASE_4_REVISED.prompt, points)
    const perpendicular = findings.find((finding) => finding.kind === "segment-perpendicular")!
    expect(perpendicular.status).toBe("disproved")
    expect(perpendicular.residual!).toBeGreaterThan(1e-6)
    const dihedral = findings.find((finding) => finding.kind === "dihedral")!
    expect(dihedral.status).toBe("measured")
    expect(dihedral.measured!).toBeCloseTo(1 / Math.sqrt(3), 9)
    expect(formatSolidGoalAnswer(findings)).toContain("54.7356")
  })

  it("文案：不成立要说「不成立 + 题设仍然通过」，成立也只是**实例证据**（不说整题已证明）", () => {
    const { findings } = findingsFor(CASE_1.prompt)
    const answer = formatSolidGoalAnswer(findings)!
    expect(answer).toContain("不成立")
    expect(answer).toContain("题设本身仍然通过核验")
    expect(answer).not.toContain("整题已证明")
    expect(answer).not.toContain("formally_proved")

    const case3 = formatSolidGoalAnswer(findingsFor(CASE_3.prompt).findings)!
    expect(case3).toContain("成立")
    expect(case3).toContain("不等于形式化证明")
  })

  it("计划里的 `answer` 字段就是这份目标文案（题设核验与目标结果各占一处）", () => {
    const built = tryBuildParametricSolidPlan({ prompt: CASE_1.prompt })
    expect(built.status).toBe("ok")
    if (built.status !== "ok") return
    const answer = (built.plan as unknown as { answer?: string }).answer
    expect(answer, "计划里必须带上目标文案").toBeTruthy()
    expect(answer).toContain("目标结果（与题设核验分开）")
    /** 题设的假设与目标的结论在同一份计划里**分两栏**，不互相覆盖。 */
    expect(built.plan.kind === "plan" && Array.isArray(built.plan.assumptions)).toBe(true)
  })
})
