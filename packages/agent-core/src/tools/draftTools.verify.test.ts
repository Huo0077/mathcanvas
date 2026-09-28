import { describe, expect, it } from "vitest"

import { draftVerify } from "./draftTools"

/**
 * **`draft.verify` 的判据**（Phase 2 / Task 2.2，选项 A）。
 *
 * 这一组用例的判据是**模型不能自己挑验证对象**：
 * 候选文档由草稿那一侧决定，不是模型递进来的。让模型传一份文档，
 * 它就能递一份"更好看的"来换取 `passed` —— 而用户确认的却是另一份。
 */

const document = {
  primitives: [
    { id: "solid-1", type: "polyhedron3", vertexIds: ["solid-1:v0"] },
    { id: "solid-1:v0", type: "point3", position: { x: 0, y: 0, z: 0 } }
  ]
}

describe("draft.verify", () => {
  it("passes when the candidate satisfies the declared criteria", () => {
    const outcome = draftVerify(document, [{ kind: "has_primitive", type: "polyhedron3" }])

    expect(outcome.ok).toBe(true)
    expect(outcome.report.status).toBe("passed")
    expect(outcome.nextActions).toEqual([])
  })

  it("fails and names the check that did not hold", () => {
    const outcome = draftVerify(document, [{ kind: "has_primitive", type: "circle3" }])

    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toContain("verification_failed")
    expect(outcome.nextActions[0]).toContain("has_primitive:0")
  })

  it("refuses to call an empty criteria list a pass", () => {
    /**
     * "声明了但没有条件"的正确解读是**没有证据** —— 不是"通过"。
     * 这一格是模型最容易踩的：它想确认"我做得对不对"，却什么都没说要验什么。
     */
    const outcome = draftVerify(document, [])

    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toContain("verification_incomplete")
    expect(outcome.report.status).toBe("not_supported")
  })

  it("reports not_supported for a criterion with no judge, instead of passing it", () => {
    const outcome = draftVerify(document, [
      { kind: "has_primitive", type: "polyhedron3" },
      { kind: "unsupported", reason: "deletion checks are not implemented" }
    ])

    expect(outcome.ok).toBe(false)
    expect(outcome.detail).toContain("verification_incomplete")
  })

  it("cannot be talked into passing by a candidate the caller did not stage", () => {
    /**
     * 判据的性质：**`draftVerify` 的结论只取决于传进来的那一份文档**。
     * 这条用例钉的是"没有第二份文档能改变结论"——
     * 同一个条件对着两份不同的文档必须给出相反的答案，
     * 否则"验证通过"就可以被一份更漂亮的文档换来。
     */
    const good = draftVerify(document, [{ kind: "has_primitive", type: "polyhedron3" }])
    const empty = draftVerify({ primitives: [] }, [{ kind: "has_primitive", type: "polyhedron3" }])

    expect(good.ok).toBe(true)
    expect(empty.ok).toBe(false)
  })

  it("reports unknown rather than failed when there is no candidate at all", () => {
    // 没有候选文档 ≠ 文档不对。说成 `failed` 会冤枉一次还没暂存的运行。
    const outcome = draftVerify(null, [{ kind: "has_primitive", type: "polyhedron3" }])

    expect(outcome.ok).toBe(false)
    expect(outcome.report.status).toBe("unknown")
  })

  it("uses the one gate definition instead of judging pass/fail itself", () => {
    /**
     * 判据只有一处（`completionGate`）。这条用例钉的是**一致性**：
     * 一份自称 `passed` 却含 `failed` check 的报告，`draftVerify` 必须与门禁给出同一个答案。
     * 两处判据分叉的后果是"工具说通过了，协调器却拦住确认"。
     */
    const outcome = draftVerify(document, [{ kind: "unsupported", reason: "x" }])

    // 门禁对 `not_supported` 的判据是"不放行"，工具也必须是"不通过"。
    expect(outcome.ok).toBe(false)
  })
})
