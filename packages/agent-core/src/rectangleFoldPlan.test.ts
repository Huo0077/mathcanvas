import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "./diagramObligations"
import { verifyDiagramObligations } from "./diagramVerification"
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

describe("fold goal correctness regressions", () => {
  it("answers equivalent perpendicular phrasing consistently", () => {
    for (const claim of ["BD⊥AC", "BD 垂直于 AC", "BD垂直AC"]) {
      const solved = solveRectangleFold(`${USER_CASE}求证${claim}；求折后 BD 的长。`)
      expect(solved.status).toBe("answer")
      if (solved.status !== "answer") throw new Error("expected answer")
      expect(solved.answer).toContain("不成立")
      expect(solved.answer).toContain("2√85/5")
      expect(solved.answer).toContain("投影")
      expect(solved.answer).toContain("勾股定理")
    }
  })

  it("retains both pre-fold and post-fold length questions", () => {
    const solved = solveRectangleFold(`${USER_CASE}求折前 BD 的长；求折后 BD 的长。`)
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") throw new Error("expected plan")
    expect(solved.findings.map((finding) => finding.kind === "length" ? finding.value : null)).toEqual([expect.closeTo(Math.sqrt(20), 10), expect.closeTo(Math.sqrt(13.6), 10)])
    expect(solved.plan.answer).toContain("折前 BD=2√5")
    expect(solved.plan.answer).toContain("折后 BD=2√85/5")
  })

  it("does not refute a claim when a defined foot has not been constructed", () => {
    const solved = solveRectangleFold(`${USER_CASE}设 E 为 B 在 AC 上的垂足。求证 BE⊥AC。`)
    expect(solved.status).toBe("answer")
    if (solved.status !== "answer") throw new Error("expected answer")
    expect(solved.answer).toContain("尚未核验")
    expect(solved.answer).not.toContain("不成立")
    expect(solved.findings[0]).toMatchObject({ status: "unverified", holds: undefined })
  })

  it.each(["AB=4，AB=5，BC=2", "AB=4，CD=5，BC=2", "AB=4，BC=2，AB:BC=3:1"])("checks inconsistent givens before refuting the goal: %s", (sides) => {
    const solved = solveRectangleFold(`${USER_CASE.replace("AB=4，BC=2", sides)}求证 BD⊥AC。`)
    expect(solved).toMatchObject({ status: "unsupported", code: "inconsistent_conditions" })
    expect("findings" in solved).toBe(false)
  })

  it("recognizes perpendicular diagonals at large scale", () => {
    const solved = solveRectangleFold(`${USER_CASE.replace("AB=4，BC=2", "AB=1000000，BC=1000000")}求证 BD⊥AC。`)
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") throw new Error("expected plan")
    expect(solved.findings[0]).toMatchObject({ status: "holds", holds: true })
  })
})

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

  it("用户案例：BD⊥AC 被否定 ⇒ 只读回答而不是澄清，并给出距离", () => {
    const solved = solveRectangleFold(`${USER_CASE}（1）求证 BD⊥AC；（2）求折后 BD 的长。`)
    expect(solved.status).toBe("answer")
    if (solved.status !== "answer") return
    expect(solved.findings).toHaveLength(2)

    const perpendicular = solved.findings.find((finding) => finding.kind === "perpendicular")
    expect(perpendicular?.kind === "perpendicular" ? perpendicular.holds : undefined).toBe(false)
    expect(perpendicular?.kind === "perpendicular" ? perpendicular.residual : undefined).toBeCloseTo(12, 12)

    const length = solved.findings.find((finding) => finding.kind === "length")
    expect(length?.kind === "length" ? length.value : undefined).toBeCloseTo((2 * Math.sqrt(85)) / 5, 12)

    expect(solved.answer).toContain("不成立")
    expect(solved.answer).toContain("BD")
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

  /**
   * **连续两次折起**（2026-10-27，§9 第 4 条后半）。
   *
   * 第二笔折的是**第一笔折后的面**（`△AB′C`），所以它的点名可以是折后名 `B′`。
   * 判据全部从**编译出来的坐标**自己算：折痕上的点不动、折片是刚体、第二笔真的转了 30°，
   * 而且第一笔的折后点 `B′` 仍然在它该在的位置（两笔不是"二选一"）。
   */
  const CHAIN = "矩形 ABCD 中，AB=4，BC=2，先沿对角线 AC 把 △ABC 折起 90° 至 △AB′C，再沿 B′C 把 △AB′C 折起 30° 至 △A′B′C。"

  it("连续两次折起：两笔动作都落地，坐标满足两笔各自的刚性与折痕不动", () => {
    const solved = solveRectangleFold(CHAIN)
    expect(solved.status, solved.status === "unsupported" ? solved.reason : solved.status === "clarification" ? solved.questions.join(" / ") : "").toBe("plan")
    if (solved.status !== "plan") return

    const folds = solved.plan.actions.filter((action) => action.actionId === "solid.fold")
    expect(folds, "两笔折起必须是**两笔**动作，不许只画一笔").toHaveLength(2)
    expect(folds[1]!.inputs).toMatchObject({ hinge: { from: "B′", to: "C" }, apex: "A", apexAs: "A′", angle: 30 })

    const compiled = compile(solved.plan)
    expect(compiled.ok, compiled.ok ? "" : JSON.stringify(compiled.diagnostics)).toBe(true)
    const document = compiled.draftDocument
    const A = pointAt(document, "A")!
    const B = pointAt(document, "B′")!
    const Ap = pointAt(document, "A′")!
    const C = pointAt(document, "C")!
    const D = pointAt(document, "D")!
    expect([A, B, Ap, C, D].every((point) => point !== undefined)).toBe(true)

    const distance = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z)
    // 第一笔：折痕 AC 不动（A、C 与题面的矩形一致），B′ 到 AC 两端保持原长。
    expect(distance(A, C)).toBeCloseTo(Math.hypot(4, 2), 9)
    expect(distance(B, A)).toBeCloseTo(4, 9)
    expect(distance(B, C)).toBeCloseTo(2, 9)
    // 第二笔：折痕 B′C 不动，A′ 到 B′、C 的距离与 A 原本到它们的距离一致（刚体）。
    expect(distance(Ap, B)).toBeCloseTo(distance(A, B), 9)
    expect(distance(Ap, C)).toBeCloseTo(distance(A, C), 9)
    // A′ 真的动了，而且不在 z=0（两笔都折起来了）。
    expect(distance(Ap, A)).toBeGreaterThan(0.1)
  })

  it("第二笔没给折角 ⇒ 澄清，不猜（连续折叠不会自动求解折角）", () => {
    const solved = solveRectangleFold("矩形 ABCD 中，AB=4，BC=2，先沿对角线 AC 把 △ABC 折起 90° 至 △AB′C，再沿 B′C 把 △AB′C 折起 至 △A′B′C。")
    expect(solved.status).toBe("clarification")
    if (solved.status !== "clarification") return
    expect(solved.reason).toBe("needs_fold_angle")
    expect(solved.questions.join("\n")).toContain("第二笔")
  })

  it("第二笔点到第一笔折后不存在的点 ⇒ unsupported，并说清缺谁", () => {
    const solved = solveRectangleFold("矩形 ABCD 中，AB=4，BC=2，先沿对角线 AC 把 △ABC 折起 90° 至 △AB′C，再沿 QC 把 △AQC 折起 30° 至 △A′QC。")
    expect(solved.status).toBe("unsupported")
    if (solved.status !== "unsupported") return
    expect(solved.reason).toContain("第一笔折后都不存在")
    expect(solved.reason).toContain("Q")
  })

  /**
   * **连续折起也要能过状态感知核验**（2026-10-27）。
   *
   * 折前条件（`矩形 ABCD`、`AB=4`、`BC=2`）说的是**初始**矩形，而折后文档里 `B` 已经叫 `B′`
   * —— 以前 `preFoldStateOf` 要求**恰好一笔**折起，两笔时直接返回 `null`，于是这三条
   * 全部落到"点名缺失"（实测端到端 `not_supported`）。现在折前状态由**第一笔**重建，
   * 这三条必须 `passed`，而折后的 `A′B′=4`（两笔之后的距离）也要 `passed`。
   */
  it("连续两次折起：折前条件按第一笔重建的点表核验，折后条件按最终点表核验", () => {
    const prompt = `${CHAIN}求折后 A′D 的长。`
    const solved = solveRectangleFold(prompt)
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") return
    const compiled = compile(solved.plan)
    expect(compiled.ok, compiled.ok ? "" : JSON.stringify(compiled.diagnostics)).toBe(true)
    const report = verifyDiagramObligations(parseDiagramObligations(prompt), solved.plan, compiled.draftDocument!)
    const byText = (fragment: string) => report.checks.find((check) => check.sourceText.includes(fragment))
    expect(byText("矩形")?.status, JSON.stringify(report.checks).slice(0, 600)).toBe("passed")
    expect(byText("AB=4")?.status).toBe("passed")
    expect(byText("BC=2")?.status).toBe("passed")
    expect(report.status).toBe("passed")
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

  it("求证段里的两平面垂直不会被误判为题设里的非折痕两侧平面垂直", () => {
    const prompt = "矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起 90° 至 △AB′C。求证：平面 AB′D ⊥ 平面 B′CD。"
    const solved = solveRectangleFold(prompt)
    expect(solved.status, solved.status === "unsupported" ? solved.reason : "").toBe("plan")
  })

  it("连续两次折起：第一笔未显式命名折后三角形时，自动分配唯一显示名并完成第二笔", () => {
    const prompt = "矩形 ABCD 中，AB=4，BC=2，先沿对角线 AC 把 △ABC 折起 90°，再沿 BC 把 △ABC 折起 30° 至 △A′BC。"
    const solved = solveRectangleFold(prompt)
    expect(solved.status, solved.status === "unsupported" ? solved.reason : "").toBe("plan")
    if (solved.status !== "plan") return
    const compiled = compilePlan(solved.plan, { document: createEmptyDocument("geometry3d"), conversationId: "a3-chain-implicit", documentGeneration: 0, prompt })
    expect(compiled.ok, compiled.ok ? "" : JSON.stringify(compiled.diagnostics)).toBe(true)
  })

  it("连续两次折起：第二笔折的不是第一笔折后的两个三角形之一时拒绝", () => {
    const prompt = "矩形 ABCD 中，AB=4，BC=2，先沿对角线 AC 把 △ABC 折起 90° 至 △AB′C，再沿 B′D 把 △AB′D 折起 30° 至 △A′B′D。"
    const solved = solveRectangleFold(prompt)
    expect(solved.status).toBe("unsupported")
  })

  it("ASCII 撇号 B'D=3 与连等式 A'B=2B'C=4 均规范化为标准撇号 ′", () => {
    const prompt = "矩形 ABCD 中，AB=4，BC=2，沿对角线 AC 把 △ABC 折起，使 B'D=3。求折后 B'D 的长。"
    const solved = solveRectangleFold(prompt)
    expect(solved.status).toBe("plan")
    if (solved.status !== "plan") return
    expect(solved.geometry.apexPostName).toBe("B′")
    const chainParsed = parseDiagramObligations("A'B=2B'C=4")
    expect(chainParsed.givens.map((g) => g.targets)).toEqual([
      ["A′", "B"],
      ["A′", "B", "B′", "C"],
      ["B′", "C"]
    ])
  })
})
