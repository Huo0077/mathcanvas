import { describe, expect, it } from "vitest"

import { describeCompileRepairPrompt } from "./planCompiler"

/**
 * **面环坏了**（2026-10-19 联考 `joint-11` / `joint-13`）。
 *
 * 两道题都是 0 图元的硬失败，但**内核拒得对**：
 * - `joint-11`：`face ring [0,1,5,4] self-intersects` —— 顶点绕行顺序交叉了；
 * - `joint-13`：`face ring [0,1,4,3] is not coplanar: deviation 1.73` —— 四个顶点不在同一平面里。
 *
 * 问题在**修复提示**：只把几何诊断回给模型，下一轮它大概率按同样的坐标再拼一次（模型只有一次修复机会）。
 * 所以这两支提示要说清**怎么改**，而不是复述读数。
 *
 * 反向判据：`face ring … has zero area`（共线/面积为零）已有自己的那一支，不该被这两支抢走 ——
 * 三种病的改法不同：塌面要换点，自交要改**顺序**，不共面要改**平面归属**。
 */
const hintFor = (detail: string): string =>
  describeCompileRepairPrompt({
    reason: "schema_invalid",
    errors: [{ code: "degenerate_polyhedron", path: "envelope.actions[0]", detail }],
    allowedChanges: [],
    attempt: 1
  })

describe("face ring advice", () => {
  it("**不共面** ⇒ 说清每个面环必须共面、组合体不要把两只立体的点混进同一圈", () => {
    const hint = hintFor("face ring [0,1,4,3] is not coplanar: deviation 1.73")
    expect(hint).toContain("共面")
    expect(hint).toContain("同一圈")
    expect(hint).toContain("solid.create_face")
  })

  it("**自交** ⇒ 说清这是**绕行顺序**问题，要沿边界顺序绕一圈", () => {
    const hint = hintFor("face ring [0,1,5,4] self-intersects")
    expect(hint).toContain("顺序")
    expect(hint).toContain("相邻")
  })

  it("**面积为零**走自己的那支，不被不共面/自交两支抢走", () => {
    const hint = hintFor("face ring [0,1,5] has zero area (largest triangle 0.00e+0): these vertices are collinear")
    expect(hint).not.toContain("同一圈")
    expect(hint).not.toContain("绕行顺序")
  })
})
