import { describe, expect, it } from "vitest"

import { deriveAcceptance } from "./acceptance"

/**
 * **从原话推验收条件**（Phase 3 最后一步）。
 *
 * 这一组用例的判据不是"能推出东西"，而是**推错会拦住一次正确的作图**。
 * 所以一半的用例都在证明"它**不**推什么"。
 */
describe("derived acceptance criteria", () => {
  it("asks for the shape the user named", () => {
    expect(deriveAcceptance("画一个边长为 3、中心在原点的立方体")).toEqual([{ kind: "has_primitive", type: "polyhedron3" }])
    expect(deriveAcceptance("画一个棱长为 3 的正四面体")).toEqual([{ kind: "has_primitive", type: "polyhedron3" }])
    expect(deriveAcceptance("draw a tetrahedron with edge 3")).toEqual([{ kind: "has_primitive", type: "polyhedron3" }])
  })

  it("does not invent a size check from a number in the prompt", () => {
    /**
     * **这是本层最要紧的一条判据。** 原话里的数字**不等于**包围盒边长：
     * 一个棱长 3 的正四面体，包围盒是 (3, 3·√2/2, 3·√2/2 ≈ 2.12)。
     * 拿 3 去比会判错一份**完全正确**的文档 —— 而用户看到的是失败。
     *
     * 尺寸判据需要按图元类型换算，那份知识在几何内核里，不在这层。
     */
    const checks = deriveAcceptance("画一个棱长为 3 的正四面体")

    expect(checks.some((check) => check.kind === "edge_length")).toBe(false)
  })

  it("does not turn a noun in the prompt into a required label", () => {
    // 用户说"立方体"是**意图**，不是"那个对象要叫『立方体』"。
    expect(deriveAcceptance("画一个立方体").some((check) => check.kind === "has_label")).toBe(false)
  })

  it("derives nothing for a request that is not about creating geometry", () => {
    // 没有可推的条件 → 调用方**不声明**（门禁保持惰性），而不是声明空数组（那会被拦下）。
    expect(deriveAcceptance("把刚才的截面平面改一下")).toEqual([])
    expect(deriveAcceptance("有多少个对象？")).toEqual([])
    expect(deriveAcceptance("")).toEqual([])
  })

  it("does not demand a draggable point for a read-only answer about points", () => {
    /**
     * `localPlanner` 对任意含"点"的原话都倾向于给一份建点计划，但
     * **"这个计划会建一个点"不等于"这次运行的验收条件包含一个点"**：
     * 只读回答（"有几个点"）的正确结果是 `completed` 而不是一份草稿。
     * 这两件事混起来会让本地规划器的一次倾向变成一条硬性要求。
     */
    expect(deriveAcceptance("画布上有几个点？")).toEqual([])
    // 但真的要求建点时，判据就应该在。
    expect(deriveAcceptance("画一个点")).toEqual([{ kind: "has_primitive", type: "point" }])
  })

  it("asks for a section when the user named one", () => {
    expect(deriveAcceptance("先创建一个立方体，再用指定平面创建它的截面")).toEqual([
      { kind: "has_primitive", type: "polyhedron3" },
      { kind: "has_primitive", type: "section" }
    ])
  })

  it("never returns the same primitive twice", () => {
    // 重复条件不会改变结论，但会让报告里出现两条一模一样的 check，读数变噪声。
    const checks = deriveAcceptance("画一个立方体，正方体就行")

    expect(checks).toHaveLength(1)
  })

  it("is deterministic", () => {
    const prompt = "画一个立方体，再创建它的截面"
    expect(deriveAcceptance(prompt)).toEqual(deriveAcceptance(prompt))
  })
})
