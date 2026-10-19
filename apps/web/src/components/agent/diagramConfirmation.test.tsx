import { render, screen } from "@testing-library/react"
import { proofScopeOf } from "@draw/agent-core"
import { describe, expect, it, vi } from "vitest"

import type { AgentDraftView } from "../../agentStore"
import { ConfirmationPanel } from "./ConfirmationPanel"

const baseline: AgentDraftView = { draftId: "d-1", draftVersion: 2, previewHash: "a".repeat(64), stageCount: 1, undoesInOneStep: true }

function renderReport(status: "passed" | "unverified" | "failed") {
  const draft: AgentDraftView = { ...baseline, diagramVerification: { status, sampleValues: ["自由点 A 采用本图示例坐标 (0, 0, 1)"], checks: [
    { kind: "dihedral", sourceText: "二面角E-BC-D=45°", status, reason: status === "passed" ? "实测 45°" : "未得到可靠角度", expected: 45, actual: status === "passed" ? 45 : undefined }
  ], ...proofScopeOf({}) } }
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
 * **没有核验报告也是"一种结果"，不是"一片空白"**（2026-10-20，联考 30 题里"无核验项"那 7 道的审计）。
 *
 * `diagramVerification === undefined` 有两条来路，而**两条都意味着"没有任何一条题设被核验过"**：
 *
 * 1. 这份计划里**没有一笔动作能让题面点名的顶点拿到坐标** —— `solid.create_template`（模板 /
 *    圆柱 / 圆锥）与 `solid.create_regular_pyramid`（正 N 棱锥）的顶点只有**模板自己的顺序编号**，
 *    题面的 A、B、C 一个都对不上（判据只有一处：`planCompiler.planHasVerifiableFigure`）；
 * 2. 题面本来就没有可核的条件（例如"画一个正方体"）。
 *
 * 此前界面对这一档**什么都不显示**，而 `确认并提交` 照旧出现（`ConfirmationPanel` 的判据是
 * `undefined || passed`）—— 于是"系统没有核"被读成"系统核过了"。联考那 7 道里 4 道正好落在这里
 * （圆锥半径/母线、棱锥底面积/侧棱、圆锥底面积/侧面积、双曲线的焦点与离心率）。
 */
describe("没有核验报告时要说清'这一轮没有核验'", () => {
  it("把「没有任何一条题设被核验过」摆在用户面前，而不是什么都不显示", () => {
    render(<ConfirmationPanel draft={baseline} onConfirm={() => {}} />)

    const section = screen.getByRole("region", { name: "题设核验" })
    expect(section.getAttribute("data-status")).toBe("not-run")
    expect(section.textContent).toContain("没有任何一条题设被核验")
    // 说清是哪一类实体造成的，否则用户没法判断"是不是我写漏了什么"。
    expect(section.textContent).toContain("模板")
  })

  it("仍然允许确认，但在同一段里说清'系统没有替你核'", () => {
    render(<ConfirmationPanel draft={baseline} onConfirm={() => {}} />)

    expect(screen.getByRole("button", { name: "确认并提交" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "题设核验" }).textContent).toContain("没有替你核")
  })

  it.each(["passed", "unverified", "failed"] as const)("有报告时这一段不出现（%s 那份照旧）", (status) => {
    render(<ConfirmationPanel draft={{
      ...baseline,
      diagramVerification: { status, sampleValues: [], checks: [], ...proofScopeOf({}) }
    }} />)

    expect(screen.queryByText(/没有任何一条题设被核验/)).toBeNull()
    expect(screen.getByRole("region", { name: "题设核验" }).getAttribute("data-status")).toBe(status)
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
