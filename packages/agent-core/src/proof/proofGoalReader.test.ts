import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "../diagramObligations"
import { attemptAutomaticProof } from "./automaticProof"
import { readProofGoal } from "./proofGoalReader"
import { bridgeProofPremises } from "./proofPremiseBridge"

/**
 * **题面的目标句 → 结构化的证明目标**（V2 GREEN 缺口③ 的最后一块拼图：没有它，"产品自动调用"
 * 就不知道**要证什么**）。
 *
 * ## 这里**不新写解析器**
 *
 * `obligationIR.ts` 早就把"求证"那一句送进**题设那张句型表**（`recognizeObligationText`）——
 * 一张表认题设与目标两处，本来就有的性质。这一层只做那之后的三件事：
 * ① 用**按点名形状**的消解（`declaredProofGoalForObligation`）判这目标属于哪一类；
 * ② 把类需要的字段**从这句话与题设里读出来**（哪条线、哪个平面、函数叫什么）；
 * ③ **把系统替用户做的选择列出来**（R51）—— 例如"平面内两条相交直线，系统取了 AB 与 AC"。
 *
 * ## fail-closed 的那一条
 *
 * 读不出结构（认不出句型、缺前提、目标类今天没有模板）⇒ **`ok:false` + 一句人能读的理由**。
 * **绝不允许**"猜一个最近的类"：那会让系统去证一条**别的**命题。
 */
describe("目标句 → 结构化证明目标", () => {
  it("「线 ⊥ 面」目标：从这句话里读出那条线与那个平面，并**列出系统选的两条相交线**", () => {
    const set = parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC")
    const read = readProofGoal("PA ⊥ 平面 ABC", set)

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.reading.goal).toEqual({
      goalKind: "linePlanePerpendicular",
      line: { first: "P", second: "A" },
      planeLines: [
        { first: "A", second: "B" },
        { first: "A", second: "C" }
      ]
    })
    // **系统替用户做的选择必须列出来**（先共用第一个点，再取另外两个点）。
    expect(read.reading.choices.join(" ")).toContain("AB")
    expect(read.reading.choices.join(" ")).toContain("AC")
  })

  it("「线 ⊥ 线」目标：起点是性质定理 —— 平面从**题面那条线⊥面**的题设里取", () => {
    const set = parseDiagramObligations("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，求证 PA ⊥ BD")
    const read = readProofGoal("PA ⊥ BD", set)

    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.reading.goal.goalKind).toBe("perpendicular")
    if (read.reading.goal.goalKind !== "perpendicular") return
    expect(read.reading.goal.lineA).toEqual({ first: "P", second: "A" })
    expect(read.reading.goal.lineB).toEqual({ first: "B", second: "D" })
    // 平面来自题设 `PA ⊥ 平面 ABCD`（目标句里根本没有这个平面）。
    expect(read.reading.goal.planePoints).toEqual(["A", "B", "C", "D"])
    expect(read.reading.choices.join(" ")).toContain("题面")
  })

  it("「线 ⊥ 线」目标**写反了**（`BD ⊥ PA`）：系统按题设把方向摆正，并如实说这是它做的", () => {
    const set = parseDiagramObligations("在四棱锥 P-ABCD 中，PA ⊥ 平面 ABCD，求证 BD ⊥ PA")
    const read = readProofGoal("BD ⊥ PA", set)

    expect(read.ok).toBe(true)
    if (!read.ok || read.reading.goal.goalKind !== "perpendicular") return
    // 结论对称，但**前提必须挂在"⊥面"的那条线上** —— 所以 lineA 是 PA。
    expect(read.reading.goal.lineA).toEqual({ first: "P", second: "A" })
    expect(read.reading.goal.lineB).toEqual({ first: "B", second: "D" })
    expect(read.reading.choices.join(" ")).toContain("对调")
  })

  it("**缺前提 ⇒ 读不出**：目标要用「线⊥面 ⇒ 线⊥线」，而题面没给任何「线⊥面」", () => {
    const set = parseDiagramObligations("在四棱锥 P-ABCD 中，底面 ABCD 是正方形，求证 PA ⊥ BD")
    const read = readProofGoal("PA ⊥ BD", set)

    expect(read.ok).toBe(false)
    if (read.ok) return
    // 理由要说清**缺什么**，而不是一句"不支持"。
    expect(read.reason).toContain("平面")
  })

  it("**「面 ⊥ 面」目标读得出、但没有模板 ⇒ 如实拒绝**（与目标消解同一口径）", () => {
    const set = parseDiagramObligations("在正方体中，求证 平面A₁B₁C₁D₁ ⊥ 平面ABCD")
    const read = readProofGoal("平面A₁B₁C₁D₁ ⊥ 平面ABCD", set)

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.reason).toContain("面")
    expect(read.reason).toContain("模板")
  })

  it("切线目标：函数名从题面那条**函数定义**里取（不是猜一个 f）", () => {
    const set = parseDiagramObligations("已知函数 g(x)=x³−3x，求曲线在 x=1 处的切线")
    const read = readProofGoal("在 x=1 处的切线", set)

    expect(read.ok).toBe(true)
    if (!read.ok || read.reading.goal.goalKind !== "tangentSlope") return
    expect(read.reading.goal.tangentSlope.functionName).toBe("g")
    expect(read.reading.choices.join(" ")).toContain("g")
  })

  it("**认不出句型 ⇒ 读不出**（不猜一个最近的类）", () => {
    const set = parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ AB")
    const read = readProofGoal("求这个图形的面积", set)

    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.reason).toContain("认不出")
  })

  it("**读出来的东西真的能一路走下去**：前提桥通过 ⇒ 自动调用把对的源码送进通道", async () => {
    const set = parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC")
    const read = readProofGoal("PA ⊥ 平面 ABC", set)
    expect(read.ok).toBe(true)
    if (!read.ok) return

    // 前提桥：题面那两条垂直都在 ⇒ 桥通过（这一条把"读目标"与"消解前提"接起来）。
    const bridge = bridgeProofPremises(read.reading.goal, set)
    expect(bridge.ok).toBe(true)
    expect(bridge.fromText.map((entry) => entry.premise).sort()).toEqual(["PA ⊥ AB", "PA ⊥ AC"])

    // 再往下：自动调用把**这一类**的模板源码送进通道（不是别的类的）。
    const sent: string[] = []
    const result = await attemptAutomaticProof({
      base: "verified_instance",
      claimId: "claim-reader",
      prompt: "在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC",
      claimSourceText: read.reading.sourceText,
      assumptions: read.reading.choices,
      goal: read.reading.goal,
      obligations: set,
      proof: "rw [Submodule.mem_orthogonal']\n  intro y hy\n  sorry",
      flagEnabled: true,
      backendVersion: "Lean 4.34.1（测试）",
      channel: async (request) => {
        sent.push(request.source)
        return { outcome: "exited", exitCode: 0, stdout: "", stderr: "", durationMs: 5, detail: "" }
      }
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain("#print axioms draw_line_plane_perpendicular_goal")
    // 空输出 ⇒ 判据不接受（这一条只证明"源码送出去了、而且是对的那一类"）。
    expect(result.outcome).toBe("rejected")
  })
})
