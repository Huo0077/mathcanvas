import { describe, expect, it } from "vitest"

import { evaluateAgentTask, type AgentTaskObservation } from "./agentTaskJudge"
import type { AgentTaskFixture } from "./agentTaskFixtures"

/**
 * **Phase 3 剩余：截面 / 关系 / 删除 / 参数化的确定性判据**。
 *
 * 这一组用例的判据是"**这些 check 现在真的会看文档**"：
 * 每一条都要证明它**既能通过、也能失败**。只证明"能通过"是没有意义的 ——
 * 一个永远返回 `passed` 的判据与 `not_supported` 一样不提供信息，
 * 而且更坏（它看起来是绿的）。
 */

function fixture(acceptance: AgentTaskFixture["expected"]["acceptance"]): AgentTaskFixture {
  return { id: "probe", category: "dependency", prompt: "p", expected: { toolIntent: [], acceptance } }
}

const solid = (id: string) => ({ id, type: "polyhedron3", vertexIds: [`${id}-v0`], edgeIds: [], faceIds: [] })
const vertex = (id: string) => ({ id, type: "point3", position: { x: 0, y: 0, z: 0 } })

const document = {
  primitives: [
    solid("solid-1"),
    vertex("solid-1-v0"),
    { id: "section-1", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 }, points: [] }
  ]
} as unknown as AgentTaskObservation["candidate"]

const observation = (overrides: Partial<AgentTaskObservation> = {}): AgentTaskObservation => ({ phase: "awaiting_confirmation", candidate: document, ...overrides })

describe("dependency_order", () => {
  it("passes when the section's source is a real solid in the document", () => {
    const report = evaluateAgentTask(fixture([{ type: "dependency_order", expected: "solid-before-section" }]), observation())

    expect(report.status).toBe("passed")
    expect(report.checks[0].detail).toContain("solid-1")
  })

  it("fails when the section points at a source that is not in the document", () => {
    const dangling = { primitives: [{ id: "section-1", type: "section", sourceId: "gone", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 } }] } as unknown as AgentTaskObservation["candidate"]
    const report = evaluateAgentTask(fixture([{ type: "dependency_order", expected: "solid-before-section" }]), observation({ candidate: dangling }))

    expect(report.status).toBe("failed")
    expect(report.checks[0].detail).toContain("not in the document")
  })

  it("fails when the section depends on something that is not a solid", () => {
    // 截面引用另一个截面 = 依赖没有落在实体上。
    const chained = { primitives: [
      { id: "section-1", type: "section", sourceId: "section-2", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 } },
      { id: "section-2", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 1 }, constant: 0 } }
    ] } as unknown as AgentTaskObservation["candidate"]
    const report = evaluateAgentTask(fixture([{ type: "dependency_order", expected: "solid-before-section" }]), observation({ candidate: chained }))

    expect(report.status).toBe("failed")
    expect(report.checks[0].detail).toContain("not a solid")
  })

  it("says not_supported for an expectation it has no judge for", () => {
    // 不猜它想说什么 —— 猜出来的判据比没有判据更危险。
    const report = evaluateAgentTask(fixture([{ type: "dependency_order", expected: "something-else" }]), observation())
    expect(report.status).toBe("not_supported")
  })
})

describe("section_source", () => {
  it("passes when the section slices a solid", () => {
    const report = evaluateAgentTask(fixture([{ type: "section_source", expected: "solid" }]), observation())
    expect(report.status).toBe("passed")
  })

  it("fails when no section was created", () => {
    const report = evaluateAgentTask(fixture([{ type: "section_source", expected: "solid" }]), observation({ candidate: { primitives: [solid("solid-1")] } as unknown as AgentTaskObservation["candidate"] }))
    expect(report.status).toBe("failed")
    expect(report.checks[0].detail).toContain("no section")
  })
})

describe("solid_unchanged", () => {
  it("passes when every solid still resolves the vertices it claims", () => {
    const report = evaluateAgentTask(fixture([{ type: "solid_unchanged", expected: true }]), observation())
    expect(report.status).toBe("passed")
  })

  it("fails when a solid lost a vertex it still claims", () => {
    /**
     * 这就是真实的退化现场：改截面把实体的顶点删掉了，而 `vertexIds` 还指着它。
     * 判据必须能红 —— 否则"实体没被动过"是一句没有判据的话。
     */
    const broken = { primitives: [solid("solid-1")] } as unknown as AgentTaskObservation["candidate"]
    const report = evaluateAgentTask(fixture([{ type: "solid_unchanged", expected: true }]), observation({ candidate: broken }))

    expect(report.status).toBe("failed")
    expect(report.checks[0].detail).toContain("lost vertices")
  })

  it("fails when there is no solid at all", () => {
    const report = evaluateAgentTask(fixture([{ type: "solid_unchanged", expected: true }]), observation({ candidate: { primitives: [] } as unknown as AgentTaskObservation["candidate"] }))
    expect(report.status).toBe("failed")
    expect(report.checks[0].detail).toContain("no solid exists")
  })
})

describe("section_updated", () => {
  it("passes when the section carries a usable plane", () => {
    const report = evaluateAgentTask(fixture([{ type: "section_updated", expected: true }]), observation())
    expect(report.status).toBe("passed")
  })

  it("fails when the section's plane is degenerate", () => {
    // 零法向切不出任何东西；那正是"平面被写成全零"之后的样子。
    const degenerate = { primitives: [
      solid("solid-1"),
      vertex("solid-1-v0"),
      { id: "section-1", type: "section", sourceId: "solid-1", plane: { normal: { x: 0, y: 0, z: 0 }, constant: 0 } }
    ] } as unknown as AgentTaskObservation["candidate"]
    const report = evaluateAgentTask(fixture([{ type: "section_updated", expected: true }]), observation({ candidate: degenerate }))

    expect(report.status).toBe("failed")
    expect(report.checks[0].detail).toContain("degenerate plane")
  })

  it("fails when the plane is missing or not finite", () => {
    const missing = { primitives: [{ id: "section-1", type: "section", sourceId: "solid-1" }] } as unknown as AgentTaskObservation["candidate"]
    expect(evaluateAgentTask(fixture([{ type: "section_updated", expected: true }]), observation({ candidate: missing })).status).toBe("failed")

    const notFinite = { primitives: [{ id: "section-1", type: "section", sourceId: "solid-1", plane: { normal: { x: Number.NaN, y: 0, z: 1 }, constant: 0 } }] } as unknown as AgentTaskObservation["candidate"]
    expect(evaluateAgentTask(fixture([{ type: "section_updated", expected: true }]), observation({ candidate: notFinite })).status).toBe("failed")
  })
})

describe("existing judges are unaffected", () => {
  it("still reports status from the phase, not from a tool receipt", () => {
    const report = evaluateAgentTask(fixture([{ type: "status", expected: "rejected" }]), { phase: "failed", candidate: null })
    expect(report.status).toBe("passed")
  })

  it("still says not_supported for a check type nobody implemented", () => {
    const report = evaluateAgentTask(fixture([{ type: "no_such_check", expected: true }]), observation())
    expect(report.status).toBe("not_supported")
  })
})
