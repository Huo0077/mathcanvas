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

/**
 * **题面改写必须看得见**（2026-10-10 第二件）。
 *
 * 模型只换说法、不许改条件（判据是 `promptNormalization.ts` 的四道阀），但"系统把你的话读成了什么"
 * 必须摆在用户面前 —— 不显示就不许悄悄改写。被拒的条目也要摆（连原因），否则用户看不出
 * "有一条我们本来想改、但没敢改"。
 */
describe("题面改写摆给用户看", () => {
  it("既有「原件 → 我这样读」，也有被拒的条目与原因", () => {
    const draft: AgentDraftView = {
      ...baseline,
      promptNormalisation: {
        accepted: [{ original: "PA⊥底面 ABCD", normalized: "PA⊥平面 ABCD", givens: 1 }],
        rejected: [{ original: "AD:AB=1", normalized: "AX=AB", reason: "改写引入了原文没有的点名：X。" }]
      }
    }
    render(<ConfirmationPanel draft={draft} />)

    expect(screen.getByText(/系统把你的题面读成了这样/)).toBeTruthy()
    expect(screen.getByText("PA⊥底面 ABCD")).toBeTruthy()
    expect(screen.getByText("PA⊥平面 ABCD")).toBeTruthy()
    expect(screen.getByText(/这条改写被拒了/)).toBeTruthy()
  })

  it("**没有改写时这一段根本不出现**（默认路径逐字不变）", () => {
    render(<ConfirmationPanel draft={baseline} />)

    expect(screen.queryByText(/系统把你的题面读成了这样/)).toBeNull()
  })
})
