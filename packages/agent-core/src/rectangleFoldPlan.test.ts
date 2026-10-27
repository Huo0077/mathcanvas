import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { compilePlan } from "./planCompiler"
import { readRectangleFoldGoals, solveRectangleFold } from "./rectangleFoldPlan"

/**
 * **A3 接线第一步（2026-10-26）：题面 → 动作链 / 澄清**。
 *
 * 这一组钉的是**动作链真的能编出正确的图**（坐标由内核旋转算），以及两类**不出计划**的终态：
 * 折角未知、目标被确定性否定。它**不**声称题设条件已经在候选文档上回代
 * —— 折前/折后的状态感知核验尚未接进 `verifyDiagramObligations`（见模块头）。
 */
const USER_CASE = "矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使平面 ABC ⊥ 平面 ACD。"
const LENGTH_ONLY = `${USER_CASE}求折后 BD 的长。`

function compile(plan: Parameters<typeof compilePlan>[0]) {
  return compilePlan(plan, { document: createEmptyDocument("geometry3d"), conversationId: "a3-rectangle", documentGeneration: 0 })
}

function pointAt(document: { primitives: readonly unknown[] } | null | undefined, label: string): { x: number; y: number; z: number } | undefined {
  const found = document?.primitives.find(
    (primitive) => (primitive as { type?: string }).type === "point3" && (primitive as { label?: string }).label === label
  )
  return (found as { position?: { x: number; y: number; z: number } } | undefined)?.position
}

describe("A3 题面 → 计划 / 澄清", () => {
  /**
   * **折角未知、但由一条长度条件唯一确定**（2026-10-27，§9 第 4 条的前半）。
   *
   * `沿 AC 把 △ABC 折起，使 BD=3` —— 折角没写，但折后 `B′D` 的长随折角单调变化：
   * 4×2 矩形里 `|B′D|² = 13.6 + 6.4·cos θ`，所以 `|B′D| = 3` 唯一确定
   * `cos θ = −0.71875`。这一族题以前一律回"请补充折角"（探针实测），现在要**解出来**。
   *
   * 三件事一起钉：解出的角、计划里的 `angle`、以及**解不出来时仍然拒绝**（下一个用例）。
   */
  const SOLVED_ANGLE = (Math.acos(-0.71875) * 180) / Math.PI

  it("solves the fold angle from a length condition on the folded apex", () => {
    const solved = solveRectangleFold("矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使 B′D=3。求折角。")
    expect(solved.status, JSON.stringify(solved).slice(0, 400)).toBe("plan")
    if (solved.status !== "plan") return
    expect(solved.geometry.angleDegrees).toBeCloseTo(SOLVED_ANGLE, 6)
    const fold = solved.plan.actions.find((action) => action.actionId === "solid.fold")
    expect(fold?.inputs).toMatchObject({ angle: expect.closeTo(SOLVED_ANGLE, 6) })
  })

  it("reads the same condition when the题面 writes the un-primed name", () => {
    // `使 BD=3` 在折起句之后，指的是**折后** B 与 D 的距离（折前 |BD| = √20 ≈ 4.472 与题设矛盾）。
    const solved = solveRectangleFold("矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使 BD=3。求折角。")
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") return
    expect(solved.geometry.angleDegrees).toBeCloseTo(SOLVED_ANGLE, 6)
  })

  it("refuses when the length condition cannot be met, and says what range is reachable", () => {
    const solved = solveRectangleFold("矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使 B′D=6。求折角。")
    expect(solved.status).toBe("clarification")
    if (solved.status !== "clarification") return
    expect(solved.reason).toBe("needs_fold_angle")
    const question = solved.questions.join("\n")
    expect(question).toContain("解不出")
    // 能到达的范围要摆出来：|B′D| ∈ [2.683, 4.472]（θ ∈ [0°, 180°]）。
    expect(question).toContain("2.68")
    expect(question).toContain("4.47")
  })

  it("still asks for the angle when there is no condition to solve from", () => {
    const solved = solveRectangleFold("矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起。")
    expect(solved.status).toBe("clarification")
    if (solved.status !== "clarification") return
    expect(solved.reason).toBe("needs_fold_angle")
    expect(solved.questions.join("\n")).toContain("没有给折角")
  })

  it("目标只从问句区读：`平面 ABC ⊥ 平面 ACD` 不是目标，`求证 BD⊥AC` 与 `求 … 的长` 是", () => {
    const goals = readRectangleFoldGoals(`${USER_CASE}（1）求证 BD⊥AC；（2）求折后 BD 的长。`)
    expect(goals.map((goal) => [goal.kind, goal.sourceText])).toEqual([
      ["perpendicular", "BD⊥AC"],
      ["length", "BD 的长"]
    ])
    // 没有问句区 ⇒ 没有目标（题设里的垂直不会被当成待证结论）。
    expect(readRectangleFoldGoals(USER_CASE)).toEqual([])
  })

  it("用户案例：BD⊥AC 被否定 ⇒ 澄清而不是可提交计划，并给出距离", () => {
    const solved = solveRectangleFold(`${USER_CASE}（1）求证 BD⊥AC；（2）求折后 BD 的长。`)
    expect(solved.status).toBe("clarification")
    if (solved.status !== "clarification") return
    expect(solved.reason).toBe("goal_does_not_hold")
    expect(solved.findings).toHaveLength(2)

    const perpendicular = solved.findings.find((finding) => finding.kind === "perpendicular")
    expect(perpendicular?.kind === "perpendicular" ? perpendicular.holds : undefined).toBe(false)
    expect(perpendicular?.kind === "perpendicular" ? perpendicular.residual : undefined).toBeCloseTo(12, 12)

    const length = solved.findings.find((finding) => finding.kind === "length")
    expect(length?.kind === "length" ? length.value : undefined).toBeCloseTo((2 * Math.sqrt(85)) / 5, 12)

    expect(solved.questions[0]).toContain("不成立")
    expect(solved.questions[0]).toContain("BD")
  })

  it("只有长度目标 ⇒ 出计划；动作链编出的折后 B′ 与模块算的坐标一致", () => {
    const solved = solveRectangleFold(LENGTH_ONLY)
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") return

    const compiled = compile(solved.plan)
    expect(compiled.ok, compiled.ok ? "" : JSON.stringify(compiled.diagnostics)).toBe(true)
    const folded = pointAt(compiled.draftDocument, "B′")
    expect(folded).toBeDefined()
    expect(folded!.x).toBeCloseTo(16 / 5, 9)
    expect(folded!.y).toBeCloseTo(8 / 5, 9)
    expect(folded!.z).toBeCloseTo(-4 / Math.sqrt(5), 9)
    // 固定片 + 折片 = 两只面。
    expect(compiled.draftDocument?.primitives.filter((primitive) => primitive.type === "face3")).toHaveLength(2)
  })

  it("改名 + 改尺寸：同一套动作链，折后点按新名字落位", () => {
    const prompt = "矩形 PQRS 中，PQ=6，QR=3，沿对角线 PR 把 △PQR 折起，使平面 PQR ⊥ 平面 PRS。求折后 QS 的长。"
    const solved = solveRectangleFold(prompt)
    expect(solved.status, solved.status === "unsupported" ? solved.reason : "").toBe("plan")
    if (solved.status !== "plan") return
    const compiled = compile(solved.plan)
    expect(compiled.ok, compiled.ok ? "" : JSON.stringify(compiled.diagnostics)).toBe(true)
    const q = pointAt(compiled.draftDocument, "Q′")
    expect(q).toBeDefined()
    expect(q!.x).toBeCloseTo(24 / 5, 9)
    expect(q!.y).toBeCloseTo(12 / 5, 9)
    expect(Math.abs(q!.z)).toBeCloseTo(6 / Math.sqrt(5), 9)
  })

  it("另一条对角线：折的是 △BCD，动作链同样成立", () => {
    const prompt = "矩形 ABCD 中，AB=4，BC=2，沿对角线 BD 把 △BCD 折起，使平面 BCD ⊥ 平面 ABD。求折后 AC 的长。"
    const solved = solveRectangleFold(prompt)
    expect(solved.status, solved.status === "unsupported" ? solved.reason : "").toBe("plan")
    if (solved.status !== "plan") return
    const compiled = compile(solved.plan)
    expect(compiled.ok, compiled.ok ? "" : JSON.stringify(compiled.diagnostics)).toBe(true)
    const c = pointAt(compiled.draftDocument, "C′")
    expect(c).toBeDefined()
    // 折后 C′ 必须真的离开 z=0（否则"折"没有发生）。
    expect(Math.abs(c!.z)).toBeGreaterThan(0.1)
    const hingeDistance = Math.hypot(c!.x - 4, c!.y - 0, c!.z - 0)
    expect(hingeDistance).toBeCloseTo(2, 9)
  })

  it("没有折角、也没有两平面垂直 ⇒ 问折角，不出计划（不默认 90°）", () => {
    const solved = solveRectangleFold("矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起。求折后 BD 的长。")
    expect(solved.status).toBe("clarification")
    if (solved.status !== "clarification") return
    expect(solved.reason).toBe("needs_fold_angle")
    expect(solved.questions[0]).toContain("折角")
    expect("plan" in solved).toBe(false)
  })

  it("没有目标的题面仍可出计划（不会被「没有问句」卡住）", () => {
    const solved = solveRectangleFold(USER_CASE)
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") return
    expect(solved.findings).toEqual([])
    expect(solved.plan.actions).toHaveLength(2)
  })
})
