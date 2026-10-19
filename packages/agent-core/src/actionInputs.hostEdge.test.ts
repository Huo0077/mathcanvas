import { describe, expect, it } from "vitest"

import { parseDraftAction } from "./schemas"

/**
 * **hostEdge 的数组写法**（2026-10-19，稳定性复跑现场）：模型把“哪两个顶点之间的棱”
 * 写成 `["A","D"]`；语义与 `{from,to}` 相同。传输层收下并归一，找不到棱时仍由编译器报错。
 */
describe("bound point hostEdge array", () => {
  it("normalises [from, to] to an object", () => {
    const result = parseDraftAction({
      actionId: "dynamic.create_bound_point",
      actionKey: "pt-e",
      factIds: [],
      inputs: { alias: "E", label: "E", host: { scope: "draft", alias: "quad" }, hostEdge: ["A", "D"], parameter: 0.4 }
    })

    expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true)
    if (result.ok) expect(result.value.inputs).toMatchObject({ hostEdge: { from: "A", to: "D" } })
  })
})
