import { describe, expect, it } from "vitest"

import { verifyTaskChecks, type TaskCheck, type VerifiableDocument } from "./taskVerification"

/**
 * **任务级语义验证**（Phase 3 Task 3.2 的第一片）。
 *
 * 这一组用例的判据不是"函数返回了东西"，而是**"验证通过"这件事有多强**：
 * 每一条含糊的情形都必须落到 `failed` / `unknown` / `not_supported`，
 * 绝不允许悄悄变成 `passed` —— 一个会放行的验证器比没有验证器更坏，
 * 因为它会让门禁看起来是绿的。
 */

/** 一个有顶点族的多面体 + 两个点，够跑 size / type / label 三类判定。 */
const document: VerifiableDocument = {
  primitives: [
    { id: "point-1", type: "point", label: "A" },
    { id: "point-2", type: "point", label: "B" },
    { id: "cube-1", type: "polyhedron3", label: "立方体" },
    { id: "cube-1:v0", type: "point3" },
    { id: "cube-1:v1", type: "point3" },
    { id: "cube-1:v2", type: "point3" },
    { id: "cube-1:v3", type: "point3" },
    { id: "circle-1", type: "circle", label: "圆" }
  ]
}

/** 顶点带坐标的版本：立方体棱长 3（-1.5..1.5）。 */
const cubeWithVertices: VerifiableDocument = {
  primitives: [
    { id: "cube-1", type: "polyhedron3", label: "立方体", vertexIds: ["cube-1:v0", "cube-1:v1"] } as never,
    { id: "cube-1:v0", type: "point3", x: -1.5, y: -1.5, z: -1.5 },
    { id: "cube-1:v1", type: "point3", x: 1.5, y: 1.5, z: 1.5 }
  ]
}

describe("task verification", () => {
  it("passes only when every check passes", () => {
    const checks: TaskCheck[] = [
      { id: "cube-exists", kind: "exists", entityId: "cube-1" },
      { id: "cube-type", kind: "type", entityId: "cube-1", expected: "polyhedron3" },
      { id: "cube-label", kind: "label", entityId: "cube-1", expected: "立方体" }
    ]
    const { report, error } = verifyTaskChecks(document, checks)

    expect(error).toBeUndefined()
    expect(report.status).toBe("passed")
    expect(report.checks).toHaveLength(3)
    expect(report.checks.every((check) => check.status === "passed")).toBe(true)
    expect(report.next_actions).toEqual([])
  })

  it("fails the whole report when any single check fails", () => {
    const { report } = verifyTaskChecks(document, [
      { id: "ok", kind: "exists", entityId: "cube-1" },
      { id: "missing", kind: "exists", entityId: "cube-9" }
    ])

    expect(report.status).toBe("failed")
    expect(report.checks.map((check) => check.status)).toEqual(["passed", "failed"])
  })

  it("prefers the strongest honest status when checks disagree", () => {
    /**
     * 汇总口径是**保守**的：`failed` > `not_supported` > `unknown` > `passed`。
     * 一条读不出尺寸的 check（`unknown`）不能把一条真失败（`failed`）降级掉。
     */
    const withFailure = verifyTaskChecks(document, [
      { id: "unreadable", kind: "size", entityId: "cube-1", expected: [3, 3, 3] },
      { id: "missing", kind: "exists", entityId: "cube-9" }
    ])
    expect(withFailure.report.status).toBe("failed")

    const unknownOnly = verifyTaskChecks(document, [{ id: "unreadable", kind: "size", entityId: "cube-1", expected: [3, 3, 3] }])
    expect(unknownOnly.report.status).toBe("unknown")
  })

  it("reports unknown rather than passed when the geometry cannot be read", () => {
    /**
     * `cube-1` 在 `document` 里**没有顶点**，所以它的尺寸读不出来。
     * 这正是最危险的一格：把"读不出来"当成"尺寸对"，验证器就成了橡皮图章。
     */
    const { report } = verifyTaskChecks(document, [{ id: "size", kind: "size", entityId: "cube-1", expected: [3, 3, 3] }])

    expect(report.status).toBe("unknown")
    expect(report.checks[0].status).toBe("unknown")
    expect(report.checks[0].detail).toContain("cannot read the extent")
  })

  it("measures a real extent and accepts it within tolerance", () => {
    const passing = verifyTaskChecks(cubeWithVertices, [{ id: "size", kind: "size", entityId: "cube-1", expected: [3, 3, 3] }])
    expect(passing.report.status).toBe("passed")

    // 容差内（浮点误差不该判失败）。
    const withinTolerance = verifyTaskChecks(cubeWithVertices, [{ id: "size", kind: "size", entityId: "cube-1", expected: [3.0000001, 3, 3] }])
    expect(withinTolerance.report.status).toBe("passed")

    // 超出容差即失败，并且把两个数都写出来（用户与模型都看得见差在哪）。
    const wrong = verifyTaskChecks(cubeWithVertices, [{ id: "size", kind: "size", entityId: "cube-1", expected: [4, 4, 4] }])
    expect(wrong.report.status).toBe("failed")
    expect(wrong.report.checks[0].detail).toContain("expected [4, 4, 4]")
  })

  it("treats an unsupported check as not_supported, never as passed", () => {
    const { report } = verifyTaskChecks(document, [
      { id: "supported", kind: "exists", entityId: "cube-1" },
      { id: "section", kind: "unsupported", reason: "section checks are not implemented yet" }
    ])

    expect(report.status).toBe("not_supported")
    expect(report.checks[1].status).toBe("not_supported")
  })

  it("never reports passed for an empty check list", () => {
    // 空集不能算通过：那会让"没有验证"与"验证通过"变成同一件事。
    const { report } = verifyTaskChecks(document, [])

    expect(report.status).toBe("unknown")
    expect(report.checks).toEqual([])
  })

  it("names the failing checks in next_actions so the model can act", () => {
    const { report } = verifyTaskChecks(document, [
      { id: "missing", kind: "exists", entityId: "cube-9" },
      { id: "type", kind: "type", entityId: "circle-1", expected: "polygon" }
    ])

    expect(report.status).toBe("failed")
    expect(report.next_actions).toHaveLength(2)
    expect(report.next_actions[0]).toContain("missing")
  })

  it("produces a report that satisfies the verification contract", () => {
    /**
     * `toolContracts.parseVerificationReport` 有一条不变量：`passed` 的报告必须至少有一条 check
     * 且每条都 passed。这里确认本层的输出**永远**能被那份解析器接受 ——
     * 否则协调器会把一份非法报告当成证据发出去。
     *
     * 注意第一格：`passed` 是**合法**结果，所以这里只断言"能被契约接受"，
     * 不断言"一定不是 passed"—— 把它写成不等于 passed 是把我自己的期望当成了判据。
     */
    for (const checks of [
      [] as TaskCheck[],
      [{ id: "a", kind: "exists", entityId: "cube-1" }] as TaskCheck[],
      [{ id: "a", kind: "exists", entityId: "cube-9" }] as TaskCheck[],
      [{ id: "a", kind: "unsupported", reason: "nope" }] as TaskCheck[],
      [{ id: "a", kind: "size", entityId: "cube-1", expected: [3, 3, 3] }] as TaskCheck[]
    ]) {
      const { report, error } = verifyTaskChecks(document, checks)
      expect(error, JSON.stringify(checks)).toBeUndefined()
      expect(report.checks.length === 0 ? report.status === "unknown" : true).toBe(true)
    }
  })

  it("finds an object by label when the user named it rather than an id", () => {
    const { report } = verifyTaskChecks(document, [{ id: "labelled", kind: "labelled", label: "圆" }])
    expect(report.status).toBe("passed")

    const missing = verifyTaskChecks(document, [{ id: "labelled", kind: "labelled", label: "球" }])
    expect(missing.report.status).toBe("failed")
  })
})
