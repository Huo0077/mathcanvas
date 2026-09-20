import { describe, expect, it, vi } from "vitest"

import { createInteractionTools, MAX_PROPOSED_LOSSES, type ExportPreflightPort, type ExportPreflightSummary } from "./interactionTools"

/**
 * Task 2.4 的 `interaction.*` 三个工具。
 *
 * 核心性质：**它们只提议，不执行**。没有任何一条路径返回假的 `changed: true`，
 * 也没有任何一条会自己去改文档或产出文件。
 */
function summary(overrides: Partial<ExportPreflightSummary> = {}): ExportPreflightSummary {
  return { format: "svg", supported: true, requiresUserAcceptance: false, omitted: [], fontLoss: [], approximationNotes: [], blockedReasons: [], projectedEntityCount: 4, ...overrides }
}

function port(result: ExportPreflightSummary | { error: string }): ExportPreflightPort {
  return { preflight: vi.fn(() => result) }
}

describe("propose_export", () => {
  it("passes a clean preflight through as a plain proposal", () => {
    const tools = createInteractionTools(port(summary()))

    const result = tools.proposeExport("svg")

    expect(result.status).toBe("success")
    expect(result.payload).toMatchObject({ format: "svg", supported: true, requiresUserAcceptance: false, objectCount: 4 })
    expect(result.next_actions).toEqual([])
  })

  it("asks for acceptance when the preflight reports a loss", () => {
    // 用户按 Agent 的说法确认，就必须知道会丢什么。
    // 注意 `supported: true` —— 有损失但**没被阻止**，这才是"需要接受"的情形；
    // 我把这条夹具第一版写成 `supported: false`（那是"被阻止"），断言自然对不上。
    const tools = createInteractionTools(port(summary({
      supported: true,
      requiresUserAcceptance: true,
      omitted: [{ sourceId: "conn-1", kind: "connection", reason: "connection cannot be projected" }]
    })))

    const result = tools.proposeExport("svg")

    expect(result.status).toBe("warning")
    expect(result.diagnostics.some((entry) => entry.code === "needs_acceptance")).toBe(true)
    expect(result.next_actions.join(" ")).toContain("acceptance")
    expect(result.payload?.losses.omitted).toHaveLength(1)
  })

  it("reports font loss so the user knows which characters will be destroyed", () => {
    const tools = createInteractionTools(port(summary({ requiresUserAcceptance: true, fontLoss: [{ original: "点 A", substituted: "? A", reason: "DXF text is encoded as WinAnsi" }] })))

    const result = tools.proposeExport("dxf")

    expect(result.payload?.losses.fontLoss[0]).toMatchObject({ original: "点 A", substituted: "? A" })
  })

  it("surfaces blocked reasons as errors with a next action", () => {
    const tools = createInteractionTools(port(summary({ supported: false, requiresUserAcceptance: true, blockedReasons: ["a 3D scene is not exported directly as PNG"] })))

    const result = tools.proposeExport("png")

    expect(result.status).toBe("error")
    expect(result.diagnostics.some((entry) => entry.code === "export_blocked")).toBe(true)
    expect(result.next_actions.join(" ")).toContain("supported")
  })

  it("reports a preflight failure instead of inventing a proposal", () => {
    const tools = createInteractionTools(port({ error: "the target document has nothing to export" }))

    const result = tools.proposeExport("svg")

    expect(result.status).toBe("error")
    expect(result.payload).toBeNull()
    expect(result.diagnostics[0].code).toBe("export_preflight_failed")
    // 失败要有可执行的恢复建议（与 `ToolResult.recovery` 同一套语义）。
    expect(result.recovery?.safeRetry).toBe("refresh_context")
  })

  it("bounds how much of the preflight enters the context", () => {
    const many = Array.from({ length: MAX_PROPOSED_LOSSES + 4 }, (_, index) => ({ sourceId: `s-${index}`, kind: "connection", reason: "cannot be projected" }))
    const tools = createInteractionTools(port(summary({ supported: false, requiresUserAcceptance: true, omitted: many })))

    const result = tools.proposeExport("svg")

    expect(result.payload?.losses.omitted).toHaveLength(MAX_PROPOSED_LOSSES)
    // 截断要说出来，否则模型会以为"就这些损失"。
    expect(result.diagnostics.some((entry) => entry.code === "truncated_losses")).toBe(true)
  })

  it("does not claim the document changed", () => {
    const tools = createInteractionTools(port(summary()))

    expect(JSON.stringify(tools.proposeExport("svg"))).not.toContain('"changed"')
  })
})

describe("ask_clarification", () => {
  it("hands the run over to the user with the question", () => {
    const tools = createInteractionTools(port(summary()))

    const result = tools.askClarification("半径是多少？")

    expect(result.status).toBe("success")
    expect(result.payload).toEqual({ question: "半径是多少？" })
    // 明确下一步是"等用户回答"，而不是自己猜一个数值。
    expect(result.next_actions.join(" ")).toContain("wait")
  })

  it("refuses an empty question instead of entering a pointless wait", () => {
    const tools = createInteractionTools(port(summary()))

    const result = tools.askClarification("   ")

    expect(result.status).toBe("error")
    expect(result.payload).toBeNull()
  })
})

describe("propose_view", () => {
  it("proposes a view without changing anything", () => {
    const tools = createInteractionTools(port(summary()))

    const result = tools.proposeView("正面")

    expect(result.status).toBe("success")
    expect(result.payload).toEqual({ view: "正面" })
    // 采纳与否由 UI 策略决定。
    expect(result.next_actions.join(" ")).toContain("accept")
    expect(result.artifacts).toEqual([])
  })

  it("refuses an empty view proposal", () => {
    const tools = createInteractionTools(port(summary()))

    expect(tools.proposeView("").status).toBe("error")
  })
})
