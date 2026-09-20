import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import type { AgentDraftView } from "../../agentStore"
import { ConfirmationPanel } from "./ConfirmationPanel"
import { countDeltas } from "./confirmationCounts"

/**
 * Task 2.5 Step 4 点名的六样东西，逐条在这里：精确计数、假设、来源与目标、近似、
 * 删除/锁定警告、一步撤销声明。
 */
function draft(overrides: Partial<AgentDraftView> = {}): AgentDraftView {
  return {
    draftId: "draft_1",
    draftVersion: 2,
    previewHash: "hash-abc",
    stageCount: 1,
    undoesInOneStep: true,
    baseCounts: { user: 0, hidden: 0, derived: 0, internal: 0, total: 0 },
    counts: { user: 1, hidden: 0, derived: 0, internal: 0, total: 1 },
    ...overrides
  }
}

describe("exact counts", () => {
  it("shows only the categories that actually change", () => {
    // 一份没有变化的清单会把真正需要注意的那一行埋掉。
    const rows = countDeltas(draft())

    expect(rows.map((row) => row.label)).toEqual(["可编辑对象"])
  })

  it("renders the before and after numbers for a change", () => {
    render(<ConfirmationPanel draft={draft()} />)

    const row = globalThis.document.querySelector('tr[data-changed="added"]')!
    expect(row.textContent).toContain("可编辑对象")
    expect(row.textContent).toContain("0")
    expect(row.textContent).toContain("1")
  })

  it("says how many objects the change adds or removes in total", () => {
    render(<ConfirmationPanel draft={draft()} />)
    expect(screen.getByText(/会新增 1 个对象/)).toBeTruthy()
  })

  it("distinguishes internal detail from editable objects", () => {
    // 内部近似细节在文档里但画布上不画；混进"可编辑"会让用户以为确认后画布上多出几十个点。
    render(<ConfirmationPanel draft={draft({
      baseCounts: { user: 1, hidden: 0, derived: 0, internal: 0, total: 1 },
      counts: { user: 1, hidden: 0, derived: 0, internal: 48, total: 49 }
    })} />)

    const body = globalThis.document.querySelector(".agent-confirmation-counts")!.textContent ?? ""
    expect(body).toContain("内部细节")
    expect(body).toContain("画布与对象列表都不显示")
    expect(body).toContain("48")
  })

  it("counts hidden objects separately so the user knows they will not appear", () => {
    render(<ConfirmationPanel draft={draft({
      counts: { user: 1, hidden: 2, derived: 0, internal: 0, total: 3 }
    })} />)

    expect(globalThis.document.querySelector(".agent-confirmation-counts")!.textContent).toContain("画布上看不见")
  })

  it("admits when the counts are missing instead of inventing a scale", () => {
    render(<ConfirmationPanel draft={draft({ counts: undefined, baseCounts: undefined })} />)

    expect(screen.getByText(/无法核对/)).toBeTruthy()
  })
})

describe("deletion warning", () => {
  it("warns loudly when the change removes existing objects", () => {
    render(<ConfirmationPanel draft={draft({
      baseCounts: { user: 3, hidden: 0, derived: 0, internal: 0, total: 3 },
      counts: { user: 1, hidden: 0, derived: 0, internal: 0, total: 1 }
    })} />)

    const alert = screen.getByRole("alert")
    expect(alert.textContent).toContain("删除 2 个")
    // 要说明恢复手段，否则用户不知道代价。
    expect(alert.textContent).toContain("撤销")
  })

  it("does not cry wolf when nothing is removed", () => {
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("target, sources and the preview fingerprint", () => {
  it("names the document being changed so the user can check it", () => {
    render(<ConfirmationPanel draft={draft()} targetDocumentId="doc-layout" sourceDocumentIds={["doc-geometry"]} />)

    expect(screen.getByText("doc-layout")).toBeTruthy()
    expect(screen.getByText("doc-geometry")).toBeTruthy()
  })

  it("does not print the preview hash, because today it is the whole document", () => {
    /**
     * 第一个版本把 `draft.previewHash` 直接打在界面上，而那个字段当前是**整份候选文档的
     * 规范 JSON**（`draftStore` 用 `contentFingerprint`，它返回 JSON 字符串而不是哈希）。
     * 于是确认面板里出现一长串文档内容，界面上还多出一份用户几何数据的副本 ——
     * 是 e2e 把它读出来才发现的。
     *
     * **显示一份"看起来像指纹、其实是全文"的东西比不显示更糟**，所以在 `draftStore`
     * 改用真正的哈希（`canonicalContentHash`）之前，这里不显示它。
     */
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.queryByText("hash-abc")).toBeNull()
    expect(screen.queryByText("预览指纹")).toBeNull()
  })
})

describe("assumptions, approximation and export omissions", () => {
  it("lists the assumptions the system made", () => {
    render(<ConfirmationPanel draft={draft()} assumptions={["半径取你给的 2"]} />)

    expect(screen.getByText("系统替你做的假设")).toBeTruthy()
    expect(screen.getByText("半径取你给的 2")).toBeTruthy()
  })

  it("lists approximation notes and export omissions", () => {
    render(<ConfirmationPanel draft={draft()} approximationNotes={["圆锥曲线用折线近似"]} omittedExports={["connection 不会出现在导出文件里"]} />)

    expect(screen.getByText("近似说明")).toBeTruthy()
    expect(screen.getByText("导出会丢掉的内容")).toBeTruthy()
  })

  it("hides those sections when there is nothing to say", () => {
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.queryByText("系统替你做的假设")).toBeNull()
    expect(screen.queryByText("近似说明")).toBeNull()
    expect(screen.queryByText("导出会丢掉的内容")).toBeNull()
  })
})

describe("one-undo statement and actions", () => {
  it("states the exact one-undo promise", () => {
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.getByText(/只占一步撤销/)).toBeTruthy()
  })

  it("says so when a change would take more than one undo step", () => {
    render(<ConfirmationPanel draft={draft({ undoesInOneStep: false })} />)

    expect(screen.getByText(/多步撤销/)).toBeTruthy()
  })

  it("reports confirm and discard without doing them itself", () => {
    const onConfirm = vi.fn()
    const onDiscard = vi.fn()
    render(<ConfirmationPanel draft={draft()} onConfirm={onConfirm} onDiscard={onDiscard} />)

    screen.getByRole("button", { name: "确认并提交" }).click()
    screen.getByRole("button", { name: "丢弃草稿" }).click()

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onDiscard).toHaveBeenCalledTimes(1)
  })

  it("renders no buttons when the host did not supply handlers", () => {
    // 没有回调时不该给出按不动的按钮。
    render(<ConfirmationPanel draft={draft()} />)

    expect(screen.queryByRole("button", { name: "确认并提交" })).toBeNull()
    expect(screen.queryByRole("button", { name: "丢弃草稿" })).toBeNull()
  })
})
