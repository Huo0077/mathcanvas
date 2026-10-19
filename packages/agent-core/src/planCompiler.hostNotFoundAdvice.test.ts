import { describe, expect, it } from "vitest"

import { describeCompileRepairPrompt } from "./planCompiler"

/**
 * **宿主引用指向不存在的实体**（2026-10-19 联考 `joint-06`）。
 *
 * 现场读数：计划后两笔引用了 `solid-1:e0` —— 一个**不存在的别名**，编译期报 `host_not_found`，
 * 整题 0 图元。这是**计划侧**的错误（模型凭空拼了一个 id），不是几何能力不足；修复提示要说清
 * "别名必须是前面某一笔真的给出过的名字"，否则下一轮它还会拼一个新的。
 *
 * 反向判据：提示里**不能**出现"随便给个已有点顶着"这种诱导 —— 找不到宿主时该补的是
 * **建那个宿主的那一笔**，或者换成已有点名走 `solid.create_segment` / `solid.create_point`。
 */
describe("host not found advice", () => {
  it("tells the model the host must be built by an earlier action, not invented", () => {
    const hint = describeCompileRepairPrompt({
      reason: "schema_invalid",
      errors: [{ code: "host_not_found", path: "envelope.actions[1]", detail: "no host solid-1:e0" }],
      allowedChanges: [],
      attempt: 1
    })

    expect(hint).toContain("真的存在")
    expect(hint).toContain("scope")
    expect(hint).toContain("前面")
    expect(hint).toContain("solid.create_segment")
  })
})
