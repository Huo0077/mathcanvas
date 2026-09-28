import { describe, expect, it } from "vitest"

import { verificationGate } from "./completionGate"
import { runAcceptance, type AcceptanceCheck, type AcceptanceDocument } from "./taskAcceptance"

/**
 * **验收条件跑成验证报告**（Phase 3 接线）。
 *
 * 这一组用例的判据是**端到端的那一步**：一份验收条件 + 一份候选文档
 * → 一份报告 → 门禁放行或拦截。单独测每一段都通过、连起来却拦不住，
 * 是这类工作最容易出的错，所以这里直接从条件跑到 `verificationGate`。
 */

const document: AcceptanceDocument = {
  primitives: [
    { id: "solid-1", type: "polyhedron3", label: "立方体", vertexIds: ["solid-1:v0", "solid-1:v1"] },
    { id: "solid-1:v0", type: "point3", position: { x: -1.5, y: -1.5, z: -1.5 } },
    { id: "solid-1:v1", type: "point3", position: { x: 1.5, y: 1.5, z: 1.5 } }
  ]
}

describe("acceptance conditions become a verification report", () => {
  it("passes when every condition holds, and the gate lets that through", () => {
    const acceptance: AcceptanceCheck[] = [
      { kind: "has_primitive", type: "polyhedron3" },
      { kind: "has_entity", id: "solid-1" },
      { kind: "has_label", label: "立方体" },
      { kind: "edge_length", id: "solid-1", expected: 3 }
    ]
    const report = runAcceptance(document, acceptance)

    expect(report.status).toBe("passed")
    expect(report.checks).toHaveLength(4)
    expect(verificationGate(report).proceed).toBe(true)
  })

  it("fails a condition that does not hold, and the gate blocks it", () => {
    const report = runAcceptance(document, [{ kind: "has_primitive", type: "circle3" }])

    expect(report.status).toBe("failed")
    expect(verificationGate(report).proceed).toBe(false)
  })

  it("refuses to call a run complete when it declared no acceptance criteria", () => {
    /**
     * **这是最要紧的一格。** `acceptance: []` 不是"没有条件"，而是"没有证据"。
     * 把它当通过，就等于把"模型说完成了"重新变成唯一的成功判据 ——
     * 那正是 Task 3.3 要禁掉的东西。
     */
    const report = runAcceptance(document, [])

    expect(report.status).toBe("not_supported")
    const gate = verificationGate(report)
    expect(gate.proceed).toBe(false)
    if (!gate.proceed) expect(gate.code).toBe("verification_incomplete")
  })

  it("reports unknown rather than failed when the geometry cannot be read", () => {
    // 读不出顶点 ≠ 尺寸不对。算 failed 会冤枉一份正确文档，算 passed 是撒谎。
    const unreadable: AcceptanceDocument = { primitives: [{ id: "solid-1", type: "polyhedron3" }] }
    const report = runAcceptance(unreadable, [{ kind: "edge_length", id: "solid-1", expected: 3 }])

    expect(report.status).toBe("unknown")
    expect(report.checks[0].status).toBe("unknown")
    expect(verificationGate(report).proceed).toBe(false)
  })

  it("accepts a measurement inside the tolerance", () => {
    const report = runAcceptance(document, [{ kind: "edge_length", id: "solid-1", expected: 3.0000001 }])
    expect(report.status).toBe("passed")
  })

  it("carries an unsupported condition through as not_supported instead of ignoring it", () => {
    // 静默忽略会让"我们没验"读起来像"验过了"。
    const report = runAcceptance(document, [
      { kind: "has_primitive", type: "polyhedron3" },
      { kind: "unsupported", reason: "section relations are not judged at runtime yet" }
    ])

    expect(report.status).toBe("not_supported")
    const gate = verificationGate(report)
    expect(gate.proceed).toBe(false)
    if (!gate.proceed) expect(gate.code).toBe("verification_incomplete")
  })

  it("reports unknown for every condition when there is no candidate document", () => {
    const report = runAcceptance(null, [{ kind: "has_primitive", type: "polyhedron3" }])

    expect(report.checks[0].status).toBe("unknown")
    expect(verificationGate(report).proceed).toBe(false)
  })

  it("names the failing conditions so the next step is actionable", () => {
    const report = runAcceptance(document, [
      { kind: "has_entity", id: "missing-1" },
      { kind: "has_primitive", type: "circle3" }
    ])

    expect(report.next_actions).toHaveLength(2)
    expect(report.next_actions[0]).toContain("has_entity:0")
  })

  it("produces a report the verification contract accepts", () => {
    // 门禁读的是这份报告；一份自己都不合法的报告不能被当成证据。
    // 这三格都**不应该**放行：没有条件 / 条件不成立 / 条件本身不支持。
    for (const acceptance of [
      [] as AcceptanceCheck[],
      [{ kind: "unsupported", reason: "x" }] as AcceptanceCheck[],
      [{ kind: "has_primitive", type: "circle3" }] as AcceptanceCheck[]
    ]) {
      const gate = verificationGate(runAcceptance(document, acceptance))
      expect(gate.proceed, JSON.stringify(acceptance)).toBe(false)
    }
    // 而这一格是**合法通过**：写死成"永远不放行"就把门禁变成了一道墙，
    // 而不是一道判据。
    const passing = verificationGate(runAcceptance(document, [{ kind: "has_primitive", type: "polyhedron3" }]))
    expect(passing.proceed).toBe(true)
  })
})
