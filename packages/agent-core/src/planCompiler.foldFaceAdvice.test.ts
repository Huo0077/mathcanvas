import { describe, expect, it } from "vitest"

import { describeCompileRepairPrompt } from "./planCompiler"

/**
 * **共线的 AEF 折片**（2026-10-19，稳定性复跑现场）。
 *
 * 模型有时把“折起来的三角形”又写成一张平放的面片，三点共线；修复轮如果只听到
 * “空间面的顶点不能共线”，它会继续微调坐标。这里要求提示直接说：**删掉这张面片，
 * 用 E/F bound point + solid.fold**。
 */
describe("collinear fold face advice", () => {
  it("tells the model to remove the face and use bound points plus fold", () => {
    const hint = describeCompileRepairPrompt({
      reason: "schema_invalid",
      errors: [{ code: "degenerate_face", path: "envelope.actions[1]", detail: "空间面的顶点不能共线。" }],
      allowedChanges: [],
      attempt: 1
    })

    expect(hint).toContain("折")
    expect(hint).toContain("bound")
    expect(hint).toContain("solid.fold")
  })
})
