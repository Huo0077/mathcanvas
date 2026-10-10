import { describe, expect, it } from "vitest"

import { parseDiagramObligations } from "../diagramObligations"
import { attemptAutomaticProof } from "./automaticProof"
import { canonicalProofBody } from "./canonicalProof"

/**
 * **系统按类给出的证明正文**（canonical）。
 *
 * ## 为什么需要它
 *
 * 适配器的 `proof` 一栏原本写的是"后端给出的正文（草稿）"—— 也就是**模型写的**。
 * 但产品侧那条自动调用**不一定有模型在场**（读目标 → 前提桥 → 跑 Lean 这条路可以完全由系统走完）。
 * 那时空正文就等于"不跑"，而这三个类的正文**本来就是一行的数学步骤**，系统完全给得出。
 *
 * ## 三条必须写清的边界
 *
 * 1. **正文是系统给的，这一点要标出来**（`proofSource`）：内核验的是正文本身，与谁写它无关，
 *    但"这条证明是模型想出来的还是系统照抄的"是用户有权知道的事；
 * 2. **不是"给个万能正文"**：每一类的正文都只对它自己那一类的命题成立，跨类会被内核拒
 *    （定理名与命题形状都对不上）；
 * 3. **`perpendicular` 那一类的正文与题面点名有关**（要写出目标线那一段的具体表达式），
 *    所以它是**按目标生成**的，不是常量 —— 另两类的正文才是常量。
 */
describe("canonical 证明正文（系统按类给）", () => {
  it("判定定理那一类：正文是常量（对生成子空间做归纳），与题面点名无关", () => {
    const body = canonicalProofBody({
      goalKind: "linePlanePerpendicular",
      line: { first: "P", second: "A" },
      planeLines: [
        { first: "A", second: "B" },
        { first: "A", second: "C" }
      ]
    })

    expect(body).not.toBeNull()
    expect(body!.body).toContain("Submodule.mem_orthogonal'")
    expect(body!.body).toContain("Submodule.span_induction")
    // 两个前提名就是生成文件里的那两个（`h1` / `h2`）。
    expect(body!.body).toContain("using h1")
    expect(body!.body).toContain("using h2")
    expect(body!.note).toContain("系统")
  })

  it("性质定理那一类：正文**按目标生成**（要写出目标线那一段的具体表达式）", () => {
    const body = canonicalProofBody({
      goalKind: "perpendicular",
      lineA: { first: "P", second: "A" },
      planePoints: ["A", "B", "C"],
      lineB: { first: "B", second: "D" }
    })

    expect(body).not.toBeNull()
    // `hu` 那一支的方向是反的 ⇒ 必须带对称引理（这一条是实测逼出来的，见适配器注释）。
    expect(body!.body).toContain("inner_eq_zero_symm")
    expect(body!.body).toContain("(D - B)")
    expect(body!.body).toContain("using hu")

    // 换一条目标线 ⇒ 正文跟着变（它**不是**常量）。
    const other = canonicalProofBody({ goalKind: "perpendicular", lineA: { first: "P", second: "A" }, planePoints: ["A", "B", "C"], lineB: { first: "C", second: "D" } })
    expect(other!.body).not.toBe(body!.body)
    expect(other!.body).toContain("(D - C)")
  })

  it("切线/导数那一类：正文是 mathlib 里现成的那一步", () => {
    const body = canonicalProofBody({ goalKind: "tangentSlope", tangentSlope: { functionName: "f" } })

    expect(body!.body).toContain("hasDerivAt_iff_tendsto_slope")
  })
})

describe("自动调用：正文来自系统时，链路一样跑得通（而且标明来源）", () => {
  const obligations = parseDiagramObligations("在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC")
  const base = {
    base: "verified_instance" as const,
    claimId: "claim-canonical",
    prompt: "在三棱锥 P-ABC 中，PA ⊥ AB，PA ⊥ AC，求证 PA ⊥ 平面 ABC",
    claimSourceText: "PA ⊥ 平面 ABC",
    assumptions: [],
    goal: {
      goalKind: "linePlanePerpendicular" as const,
      line: { first: "P", second: "A" },
      planeLines: [
        { first: "A", second: "B" },
        { first: "A", second: "C" }
      ] as [{ first: string; second: string }, { first: string; second: string }]
    },
    obligations,
    flagEnabled: true,
    backendVersion: "Lean 4.34.1（测试）"
  }

  it("**明说要用系统正文时**：链路一样跑得通，而且标明来源", async () => {
    const sent: string[] = []
    const result = await attemptAutomaticProof({
      ...base,
      proofSource: "system-canonical",
      channel: async (request) => {
        sent.push(request.source)
        return {
          outcome: "exited",
          exitCode: 0,
          stdout: "'draw_line_plane_perpendicular_goal' depends on axioms: [propext, Classical.choice, Quot.sound]\n",
          stderr: "",
          durationMs: 68_000,
          detail: ""
        }
      }
    })

    expect(result.outcome).toBe("verified")
    expect(result.proofSource).toBe("system-canonical")
    // 送出去的正文就是那张表里的那一份（不是空的、也不是模型写的）。
    expect(sent[0]).toContain("Submodule.span_induction")
    // 而且**如实写在说明里**。
    expect(result.detail).toContain("系统")
  })

  it("模型给了正文 ⇒ 标明来源是模型（既有调用方的行为不变）", async () => {
    const result = await attemptAutomaticProof({
      ...base,
      proof: "rw [Submodule.mem_orthogonal']\n  intro y hy\n  sorry",
      channel: async () => ({ outcome: "exited", exitCode: 0, stdout: "", stderr: "", durationMs: 5, detail: "" })
    })

    expect(result.proofSource).toBe("model")
  })

  it("**这一类没有系统正文时如实说**（今天是不可达的兜底：三类都有）", async () => {
    const result = await attemptAutomaticProof({
      ...base,
      goal: { goalKind: "equalLength" } as unknown as typeof base.goal,
      channel: async () => ({ outcome: "exited", exitCode: 0, stdout: "", stderr: "", durationMs: 5, detail: "" })
    })

    // 表外目标类先被挡住（不许走到通道上），这才是它该有的结局。
    expect(result.outcome).toBe("goal_unsupported")
  })
})
