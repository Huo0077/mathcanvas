import { describe, expect, it } from "vitest"

import { describeCompileRepairPrompt } from "./planCompiler"

/**
 * **2–3 面开放壳**（2026-10-19，P2-4）：内核只收 1 面（平面片）或 ≥4 面（闭合体）。
 * 修复提示要说清“开放壳拆成多笔 solid.create_face”，而不是再换一种闭合体。
 */
describe("open shell advice", () => {
  it("tells the model to build each face separately", () => {
    const hint = describeCompileRepairPrompt({
      reason: "schema_invalid",
      errors: [{ code: "unsupported_face_count", path: "envelope.actions[0]", detail: "多面体只有两种合法形态：1 个面或至少 4 个面；收到 2 个面。" }],
      allowedChanges: [],
      attempt: 1
    })

    expect(hint).toContain("solid.create_face")
    expect(hint).toContain("开放")
    expect(hint).toContain("2")
  })
})
