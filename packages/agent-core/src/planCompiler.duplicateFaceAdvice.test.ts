import { describe, expect, it } from "vitest"

import { describeCompileRepairPrompt } from "./planCompiler"

/**
 * **面片顶点重复**（2026-10-19，折片三连跑现场）：模型把宿主面写成重复顶点，
 * 内核报“空间面的顶点必须互异”。修复提示要说清 `vertexNames` 与 `vertices`
 * 必须按下标一一对应且互不相同，而不是继续试坐标。
 */
describe("duplicate face vertex advice", () => {
  it("tells the model to make the face vertices distinct", () => {
    const hint = describeCompileRepairPrompt({
      reason: "schema_invalid",
      errors: [{ code: "degenerate_face", path: "envelope.actions[0]", detail: "空间面的顶点必须互异。" }],
      allowedChanges: [],
      attempt: 1
    })

    expect(hint).toContain("重复")
    expect(hint).toContain("vertexNames")
    expect(hint).toContain("一一对应")
  })
})
