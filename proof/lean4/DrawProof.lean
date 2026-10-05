import Mathlib.Analysis.InnerProductSpace.Orthogonal

/-!
# `DrawProof` —— 形式证明出口用的那个**一般命题**（N5b）

这个文件是**仓内**唯一一条 Lean 命题，也是适配器模板（`packages/agent-core/src/proof/lean4Adapter.ts`）
生成命题时用的那条形状。它单独存在有两个理由：

1. **可复算**：它的 axioms 报告就是 `perpendicular` 目标类"证明到底依赖什么"的基线读数。
   适配器生成的文件与它**逐字同形**（只换个名字、换一组点名），所以这里的读数可以外推。
2. **它就是"模板是否可信"的对照物**：读这个文件的人可以拿它和适配器生成的源码对比，
   判断"IR → 命题"那一步有没有多出或少掉什么（那是本任务最大的诚实边界，见适配器文件头）。

命题内容（`E` 是**任意**实内积空间，`D` 是**任意**子空间 —— 没有坐标、没有具体实例）：

> `u ∈ Dᗮ` 且 `v ∈ D` ⇒ `inner ℝ u v = 0`

几何读法：`u` 是"垂直于平面 π 的那条线"的方向向量，`D` 是 π 的方向子空间，
`v` 是 π 里另一条线的方向向量；于是结论就是"线 ⊥ 平面 ⇒ 线 ⊥ 线"那一步。
**注意方向**：命题把"那个平面的点落在 π 上"用的是 `v ∈ D` 这条**假设** ——
那是模板给的，不是这里证出来的（适配器文件头写明了这条边界）。

两个定理：
- `perpendicular_general`：真证明（`Submodule.mem_orthogonal'`）。
- `perpendicular_cheat`：同命题 + `sorry`。它**存在**是为了让"只看退出码"这件事
  在这个仓里有一条**可复跑的反例**：两条都 exit 0，只有 `#print axioms` 能把它们分开。

`lake env lean DrawProof.lean` 的输出（实测）：
```
.../DrawProof.lean:31:8: warning: declaration uses `sorry`
'perpendicular_general' depends on axioms: [propext, Classical.choice, Quot.sound]
'perpendicular_cheat' depends on axioms: [propext, sorryAx, Classical.choice, Quot.sound]
```
-/

/-- **一般命题**：线垂直于平面（`u ∈ Dᗮ`）⇒ 它垂直于平面里任意一条线（`v ∈ D`）。 -/
theorem perpendicular_general {E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]
    (D : Submodule ℝ E) (u v : E) (hu : u ∈ Dᗮ) (hv : v ∈ D) :
    inner ℝ u v = 0 := by
  rw [Submodule.mem_orthogonal'] at hu
  exact hu v hv

/-- **同命题 + `sorry`**：`sorryAx` 会出现在它的 axioms 报告里，而退出码仍是 0。 -/
theorem perpendicular_cheat {E : Type*} [NormedAddCommGroup E] [InnerProductSpace ℝ E]
    (D : Submodule ℝ E) (u v : E) (hu : u ∈ Dᗮ) (hv : v ∈ D) :
    inner ℝ u v = 0 := by
  sorry

#print axioms perpendicular_general
#print axioms perpendicular_cheat
