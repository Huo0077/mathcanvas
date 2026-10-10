import type { PremiseBridgeGoal } from "./proofPremiseBridge"

/**
 * **系统按类给出的证明正文**（canonical proof body）。
 *
 * ## 为什么需要它
 *
 * 适配器的 `proof` 一栏原本写的是"后端给出的正文（草稿）"—— 也就是**模型写的**。
 * 但产品侧那条自动调用**不一定有模型在场**：读目标 → 前提桥 → 跑 Lean 这条路可以完全由系统走完。
 * 那时空正文就等于"不跑"，而这三个类的正文**本来就是一行的数学步骤**，系统完全给得出。
 *
 * ## 三条边界（写在返回值里，也写在文档里）
 *
 * 1. **正文是系统给的，要标出来**：内核验的是正文本身，与谁写它无关（`judgeLean4Run` 甚至刻意
 *    不看正文），但"这条证明是模型想出来的还是系统照抄的"是用户有权知道的事 ——
 *    所以 `AutomaticProofResult.proofSource` 会如实写 `system-canonical`。
 * 2. **不是"万能正文"**：每一份正文只对它自己那一类的命题成立。跨类用会被内核拒
 *    （命题形状与定理名都对不上），而且 `#print axioms` 的报告名字也会对不上（判据那一层拒）。
 * 3. **`perpendicular` 的正文与题面点名有关**（必须写出**目标线那一段的具体表达式**），
 *    所以它是**按目标生成**的；另两类的正文才是常量。
 *
 * ## 这些正文是**验过的**，不是想出来的
 *
 * 三份正文都在本机真跑过（`scripts/proof-spike/lean4EndToEnd.test.ts` 的 gated 用例与
 * `proof/lean4/DrawProof.lean`）：`formally_proved` / `three whitelisted axioms`。
 * 其中 `perpendicular` 那份的两处讲究（要带 `inner_eq_zero_symm`、必须写对表达式）
 * 是**实测撞出来**的，记在适配器的 `LEAN4_BINDER_NAMES` 注释里。
 */

export interface CanonicalProof {
  /** 直接进生成文件 `:= by` 那一段的正文（**原样照抄**）。 */
  body: string
  /** 给人看的一句话：这份正文是怎么来的、它凭什么成立。 */
  note: string
}

const LINE_PLANE_BODY = [
  "rw [Submodule.mem_orthogonal']",
  "intro y hy",
  "induction hy using Submodule.span_induction with",
  "| mem z hz =>",
  "    rcases hz with rfl | rfl",
  "    · simpa using h1",
  "    · simpa using h2",
  "| zero => simp",
  "| add x y hx hy ihx ihy => rw [inner_add_right, ihx, ihy, add_zero]",
  "| smul a x hx ih => rw [inner_smul_right, ih, mul_zero]"
].join("\n")

const TANGENT_BODY = "exact hasDerivAt_iff_tendsto_slope.mp h"

/**
 * **按目标给出正文**；这一类没有系统正文时返回 `null`（调用方据此如实报"没有正文"，**不猜**）。
 */
export function canonicalProofBody(goal: PremiseBridgeGoal): CanonicalProof | null {
  if (goal.goalKind === "linePlanePerpendicular") {
    return {
      body: LINE_PLANE_BODY,
      note: "判定定理那一类的正文由**系统**给出（对生成子空间做归纳；`h1` / `h2` 就是生成文件里那两个前提名），不是模型写的。"
    }
  }
  if (goal.goalKind === "perpendicular") {
    return {
      body: `simpa [inner_eq_zero_symm] using hu (${goal.lineB.second} - ${goal.lineB.first}) hv`,
      note: "性质定理那一类的正文由**系统**给出（`ᗮ` 给的方向与结论相反，所以要带 `inner_eq_zero_symm`；目标线那一段要写成生成文件里真有的表达式），不是模型写的。"
    }
  }
  if (goal.goalKind === "lineInPlane") {
    return {
      body: `have h : ${goal.line.second} - ${goal.line.first} = (${goal.line.second} - ${goal.planePoints[0]}) - (${goal.line.first} - ${goal.planePoints[0]}) := by abel
rw [h]
exact Submodule.sub_mem _ h2 h1`,
      note: "线在平面内那一类的正文由**系统**给出（把连线方向拆成「两个端点各自减去基点」再交给子空间的 `sub_mem`；**每一行都不带内部缩进**（适配器会给每行统一加两个空格；第一行带 0、后几行带 2 会让后几行被算进 `have` 的证明块里，实测真跑报 `unsolved goals` + 语法错）），不是模型写的。"
    }
  }  if (goal.goalKind === "tangentSlope") {
    return {
      body: TANGENT_BODY,
      note: "切线/导数那一类的正文由**系统**给出（mathlib 里现成的那一步：`hasDerivAt_iff_tendsto_slope`），不是模型写的。"
    }
  }
  return null
}
