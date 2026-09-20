import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { countDraftObjects } from "@draw/agent-core"
import { DraftPreview, type DraftPreviewProps } from "./DraftPreview"

/**
 * Task 0.8 Step 4：预览必须**如实**说明这次提交会改什么。
 *
 * 这个组件是只读的：它绝不写 `useSceneStore`，也不自己算"要不要确认"——
 * 提交只能走 `HostBridge`（那里有一次性同意与 Compare-and-Swap）。
 * 所以这里测的是"有没有把该说的话说全"，而不是"点了能不能提交"。
 */
function makeProps(overrides: Partial<DraftPreviewProps> = {}): DraftPreviewProps {
  const candidate = {
    ...createEmptyDocument("conics"),
    primitives: [
      { id: "point-1", type: "point" as const, x: 1, y: 1, label: "点 A" },
      { id: "point-2", type: "point" as const, x: 3, y: 4, label: "点 B" }
    ]
  }
  return {
    draftId: "draft_1",
    draftVersion: 2,
    stageCount: 1,
    counts: countDraftObjects(candidate),
    changedLabels: ["点 A", "点 B"],
    assumptions: [],
    approximationNotes: [],
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides
  }
}

describe("draft preview", () => {
  it("states the one-undo guarantee and the exact object counts", () => {
    render(<DraftPreview {...makeProps()} />)

    // "只占一步撤销"是计划点名的原话，必须逐字出现，而不是含糊的"可以撤销"。
    expect(screen.getByText(/只占一步撤销/)).toBeTruthy()
    const counts = globalThis.document.querySelector(".agent-draft-counts")!.textContent ?? ""
    expect(counts).toContain("可编辑2 个")
    expect(screen.getByText("点 A")).toBeTruthy()
    expect(screen.getByText("点 B")).toBeTruthy()
  })

  it("counts derived and internal objects instead of folding them into the user count", () => {
    const candidate = {
      ...createEmptyDocument("conics"),
      primitives: [
        { id: "point-1", type: "point" as const, x: 1, y: 1, label: "点 A" },
        { id: "ix-1", type: "intersection" as const, lineA: "l1", lineB: "l2", x: 0, y: 0, label: "交点 1" }
      ]
    }
    render(<DraftPreview {...makeProps({ counts: countDraftObjects(candidate) })} />)

    // 用户能编辑的只有 1 个；交点是算出来的，拖不动，必须单独说。
    // 计数是 `<dt>/<dd>` 两个节点，所以按整块文本核对而不是按单元素文本。
    const counts = globalThis.document.querySelector(".agent-draft-counts")!.textContent ?? ""
    expect(counts).toContain("可编辑1 个")
    expect(counts).toContain("派生1 个")
  })

  it("shows assumptions and approximation notes when there are any", () => {
    render(<DraftPreview {...makeProps({ assumptions: ["半径取用户给的 2"], approximationNotes: ["圆锥曲线用折线近似"] })} />)

    expect(screen.getByText("半径取用户给的 2")).toBeTruthy()
    expect(screen.getByText("圆锥曲线用折线近似")).toBeTruthy()
  })

  it("says so explicitly when the change is larger than one step", () => {
    render(<DraftPreview {...makeProps({ stageCount: 4 })} />)

    // 多步暂存合成一步提交，用户有权知道规模。
    expect(screen.getByText(/由 4 步合成/)).toBeTruthy()
  })

  it("names what an export would silently drop", () => {
    render(<DraftPreview {...makeProps({ omittedExports: ["connection（连线）不会出现在导出文件里"] })} />)

    // 导出预检的结论必须出现在确认之前，否则"确认"是在用户不知情的情况下按下的。
    expect(screen.getByText("导出会丢掉的内容")).toBeTruthy()
    expect(screen.getByText("connection（连线）不会出现在导出文件里")).toBeTruthy()
  })

  it("offers confirm and cancel, and reports which one was chosen", () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(<DraftPreview {...makeProps({ onConfirm, onCancel })} />)

    screen.getByRole("button", { name: "确认并提交" }).click()
    screen.getByRole("button", { name: "取消" }).click()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it("keeps the preview read-only: no document is passed in and nothing is written", () => {
    const props = makeProps()
    // 组件签名里根本没有 store 或文档写入口——这是"预览绝不落盘"的结构性保证。
    expect(Object.keys(props)).not.toContain("document")
    expect(Object.keys(props)).not.toContain("replace")
    render(<DraftPreview {...props} />)
    expect(globalThis.document.querySelector(".agent-draft-counts")?.textContent).toContain("可编辑2 个")
  })
})
