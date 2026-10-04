import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { AgentDraftView } from "../../agentStore"
import { ConfirmationPanel } from "./ConfirmationPanel"

const baseline: AgentDraftView = { draftId: "d-1", draftVersion: 2, previewHash: "a".repeat(64), stageCount: 1, undoesInOneStep: true }

function renderReport(status: "passed" | "unverified" | "failed") {
  const draft: AgentDraftView = { ...baseline, diagramVerification: { status, sampleValues: ["自由点 A 采用本图示例坐标 (0, 0, 1)"], checks: [
    { kind: "dihedral", sourceText: "二面角E-BC-D=45°", status, reason: status === "passed" ? "实测 45°" : "未得到可靠角度", expected: 45, actual: status === "passed" ? 45 : undefined }
  ] } }
  const onConfirm = vi.fn()
  render(<ConfirmationPanel draft={draft} onConfirm={onConfirm} onDiscard={() => {}} />)
  return onConfirm
}

describe("diagram verification shown at the real confirmation boundary", () => {
  it("shows a condition-verified illustrative diagram and its example free point", () => {
    renderReport("passed")
    expect(screen.getByText(/通过 1/)).toBeTruthy()
    expect(screen.getByText(/自由点 A 采用本图示例坐标/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "确认并提交" })).toBeTruthy()
    expect(screen.queryByText(/已证明/)).toBeNull()
  })

  it.each(["unverified", "failed"] as const)("does not show normal confirmation for %s", (status) => {
    const onConfirm = renderReport(status)
    expect(screen.getByText("二面角E-BC-D=45°")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "确认并提交" })).toBeNull()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
