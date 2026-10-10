import Mathlib.Analysis.InnerProductSpace.Orthogonal
import Mathlib.Analysis.Calculus.Deriv.Slope

open Filter
open scoped Topology

/-!
# `DrawProof` —— 形式证明出口用的那**三条**一般命题（N5b）

这个文件是**仓内**仅有的 Lean 命题，也是适配器模板（`packages/agent-core/src/proof/lean4Adapter.ts`）
生成命题时用的那三种形状。它单独存在有两个理由：

1. **可复算**：它的 axioms 报告就是各目标类"证明到底依赖什么"的基线读数。
   适配器生成的文件与它**逐字同形**（只换点名、换定理名），所以这里的读数可以外推。
2. **它就是"模板是否可信"的对照物**：读这个文件的人可以拿它和适配器生成的源码对比，
   判断"IR → 命题"那一步有没有多出或少掉什么（那是本任务最大的诚实边界，见适配器文件头）。

## ⚠️ 这个文件现在是**三条命题的并集**（2026-10-10 加第三类时改的）

前两条住在**内积空间**里（共用一条窄 import），第三条住在**实分析**里（另一条 import + 两行 `open`）。
所以这个文件带着**并集**（两条 import、两行 open），而**适配器生成的文件是按类取子集**的 ——
"逐字同形"这句话从此要按**每一类各自**去比，不能拿这个文件的头几行去比第三类生成的文件。
（生成文件长什么样，看 `lean4Adapter.ts` 的 `assembleSource`：骨架一处，import 与 prelude 由调用方给。）

## 命题一：性质定理（`perpendicular` 目标类）

命题内容（`E` 是**任意**实内积空间，`D` 是**任意**子空间 —— 没有坐标、没有具体实例）：

> `u ∈ Dᗮ` 且 `v ∈ D` ⇒ `inner ℝ u v = 0`

几何读法：`u` 是"垂直于平面 π 的那条线"的方向向量，`D` 是 π 的方向子空间，
`v` 是 π 里另一条线的方向向量；于是结论就是"线 ⊥ 平面 ⇒ 线 ⊥ 线"那一步。
**注意方向**：命题把"那个平面的点落在 π 上"用的是 `v ∈ D` 这条**假设** ——
那是模板给的，不是这里证出来的（适配器文件头写明了这条边界）。

## 命题二：判定定理（`linePlanePerpendicular` 目标类，2026-10-10 加）

**名字说明**：这个目标类一开始叫 `planePerpendicular`，后来**改名**成 `linePlanePerpendicular` ——
因为解析层里 `planePerpendicular` 这个**题设种类**指的是**面 ⊥ 面**（比的是两个法向量），
与"线 ⊥ 面"同名会把两种题设混成一件（详见 `packages/agent-core/src/proof/proofGoals.ts`）。
Lean 侧的定理名 `plane_perpendicular_general` 保留（它说的是"线⊥面"这件事，不含歧义）。

> 线 ⊥ 平面内两条**相交**直线 ⇒ 线 ⊥ 该平面

即 `(A - P) ⊥ (B - A)` 且 `(A - P) ⊥ (C - A)` ⇒ `(A - P) ∈ (span {B - A, C - A})ᗮ`。

它与命题一**方向相反**：命题一是"已知 ⊥ 面 ⇒ ⊥ 面内任意线"，这一条是"⊥ 面内两条相交线 ⇒ ⊥ 面"。
两条合起来才是立体几何里关于线面垂直的那两步。

**"相交"体现在哪里**：`B - A` 与 `C - A` **共用一个基点 `A`** —— 那就是"两条相交直线"在命题里的痕迹
（两条平行线张不出平面，那时结论里的子空间根本不是平面；模板因此要求输入的两条线恰好共点）。

**与适配器的关系**：适配器生成的文件与它**逐字同形**。两个前提**正好是题面里那两条垂直**
（"PA ⊥ AB"、"PA ⊥ AC"）—— 比命题一更接近原题前提；但**原题别的题设不在命题里**，
完整前提桥（V2 缺口②）仍未做，不许把这条读成"前提桥已完成"。

三个定理：
- `perpendicular_general`：命题一的真证明（`Submodule.mem_orthogonal'`）。- `plane_perpendicular_general`：命题二的真证明（对生成子空间做归纳）。
- `perpendicular_cheat`：命题一 + `sorry`。它**存在**是为了让"只看退出码"这件事
  在这个仓里有一条**可复跑的反例**：两条都 exit 0，只有 `#print axioms` 能把它们分开。

`lake env lean DrawProof.lean` 的输出（实测）：
```
.../DrawProof.lean:...:...: warning: declaration uses `sorry`
'perpendicular_general' depends on axioms: [propext, Classical.choice, Quot.sound]
'plane_perpendicular_general' depends on axioms: [propext, Classical.choice, Quot.sound]
'perpendicular_cheat' depends on axioms: [propext, sorryAx, Classical.choice, Quot.sound]
```
-/

/-- **命题一（性质定理）**：线垂直于平面（`u ∈ Dᗮ`）⇒ 它垂直于平面里任意一条线（`v ∈ D`）。 -/
theorem perpendicular_general {E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]
    (D : Submodule ℝ E) (u v : E) (hu : u ∈ Dᗮ) (hv : v ∈ D) :
    inner ℝ u v = 0 := by
  rw [Submodule.mem_orthogonal'] at hu
  exact hu v hv

/-- **命题二（判定定理）**：线 ⊥ 平面内两条相交直线（`h1` / `h2`）⇒ 线 ⊥ 该平面。 -/
theorem plane_perpendicular_general {E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]
    (A B C P : E)
    (h1 : inner ℝ (A - P) (B - A) = 0) (h2 : inner ℝ (A - P) (C - A) = 0) :
    (A - P) ∈ (Submodule.span ℝ ({B - A, C - A} : Set E))ᗮ := by
  rw [Submodule.mem_orthogonal']
  intro y hy
  -- **`p` 必须显式给**：`refine … ?_ ?_ ?_ ?_` 会让 Lean 把目标猜成 `∀ x ∈ ?m, …`（实测报 Type mismatch）。
  -- 这个 mathlib revision 的 `span_induction` 的 `p` 作用在**成员证明**上，所以用 induction 那种写法。
  induction hy using Submodule.span_induction with
  | mem z hz =>
      rcases hz with rfl | rfl
      · simpa using h1
      · simpa using h2
  | zero => simp
  | add x y hx hy ihx ihy => rw [inner_add_right, ihx, ihy, add_zero]
  | smul a x hx ih => rw [inner_smul_right, ih, mul_zero]

/-- **命题三（切线/导数的定义性质，2026-10-10 加）**：可导 ⇒ 割线斜率趋于导数。 -/
theorem tangent_slope_general {f : ℝ → ℝ} {m x : ℝ} (h : HasDerivAt f m x) :
    Tendsto (slope f x) (nhdsWithin x {x}ᶜ) (𝓝 m) :=
  hasDerivAt_iff_tendsto_slope.mp h

/-- **命题一 + `sorry`**：`sorryAx` 会出现在它的 axioms 报告里，而退出码仍是 0。 -/
theorem perpendicular_cheat {E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]
    (D : Submodule ℝ E) (u v : E) (hu : u ∈ Dᗮ) (hv : v ∈ D) :
    inner ℝ u v = 0 := by
  sorry

#print axioms perpendicular_general
#print axioms plane_perpendicular_general
#print axioms tangent_slope_general
#print axioms perpendicular_cheat
