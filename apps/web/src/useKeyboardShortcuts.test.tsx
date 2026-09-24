import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useKeyboardShortcuts, type KeyboardShortcutDeps } from "./useKeyboardShortcuts"

/**
 * **画布的键盘快捷键**（`./useKeyboardShortcuts`）。
 *
 * 这个监听过去写在 `App.tsx` 的组件体里，只有整页跑起来才能按一下试试。搬成 hook 之后
 * 这里直接往 `window` 上发 `KeyboardEvent`，问"这一次按键该谁动、谁必须没动" ——
 * 三条口径都是**用户会丢工作**的那一类：Esc 分级、输入框里的 Ctrl+Z、输入框里的 Delete。
 */

function harness(overrides: Partial<KeyboardShortcutDeps> = {}) {
  const spies = {
    undo: vi.fn(),
    redo: vi.fn(),
    deleteSelected: vi.fn(),
    setCreationStep: vi.fn(),
    setActiveCommand: vi.fn(),
    setGuidance: vi.fn(),
    setSelectedIds: vi.fn()
  }
  const deps: KeyboardShortcutDeps = {
    creationStep: null,
    activeCommand: null,
    guidance: null,
    selectedIds: [],
    ...spies,
    ...overrides
  }
  const view = renderHook(() => useKeyboardShortcuts(deps))
  return { ...spies, unmount: view.unmount }
}

/** 发一次真实按键（`cancelable` 才能在 `preventDefault` 之后读到 `defaultPrevented`）。 */
function press(init: KeyboardEventInit & { key: string }, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe("keyboard shortcuts", () => {
  it("undoes and redoes with the platform modifier", () => {
    const spies = harness()

    const undoEvent = press({ key: "z", ctrlKey: true })
    expect(spies.undo).toHaveBeenCalledTimes(1)
    expect(undoEvent.defaultPrevented).toBe(true)

    press({ key: "z", ctrlKey: true, shiftKey: true })
    expect(spies.redo).toHaveBeenCalledTimes(1)

    press({ key: "y", metaKey: true })
    expect(spies.redo).toHaveBeenCalledTimes(2)
  })

  /**
   * 在输入框里按 Ctrl+Z，用户想撤销的是**刚打进去的那几个字符**，不是整篇文档的改动。
   * 所以这条判据必须在 `historyShortcut` 里挡住，而不是"浏览器自己会处理"。
   */
  it("leaves the history alone while a text field has focus", () => {
    const spies = harness()
    const input = document.createElement("input")
    document.body.append(input)

    press({ key: "z", ctrlKey: true }, input)

    expect(spies.undo).not.toHaveBeenCalled()
    input.remove()
  })

  it("ignores the modifier combination that input methods also use", () => {
    const spies = harness()

    press({ key: "z", ctrlKey: true, altKey: true })

    expect(spies.undo).not.toHaveBeenCalled()
  })

  /** Esc 分级：先取消创建（含 CAD 命令），再关指引，最后才清空选择 —— 顺序反过来会误清选中。 */
  it("cancels the in-progress creation before touching the selection", () => {
    const spies = harness({ creationStep: { mode: "line", center: null }, activeCommand: "create-line", selectedIds: ["point-1"] })

    press({ key: "Escape" })

    expect(spies.setCreationStep).toHaveBeenCalledWith(null)
    expect(spies.setActiveCommand).toHaveBeenCalledWith(null)
    expect(spies.setGuidance).toHaveBeenCalledWith(null)
    expect(spies.setSelectedIds).not.toHaveBeenCalled()
  })

  it("closes the guidance next, and only then clears the selection", () => {
    const guidanceOnly = harness({ guidance: "按住 Shift 依次点选空间点" })
    press({ key: "Escape" })
    expect(guidanceOnly.setGuidance).toHaveBeenCalledWith(null)
    expect(guidanceOnly.setSelectedIds).not.toHaveBeenCalled()

    const selectionOnly = harness({ selectedIds: ["point-1"] })
    press({ key: "Escape" })
    expect(selectionOnly.setSelectedIds).toHaveBeenCalledWith([])
  })

  it("does nothing on Escape when there is nothing to cancel", () => {
    const spies = harness()

    press({ key: "Escape" })

    expect(spies.setCreationStep).not.toHaveBeenCalled()
    expect(spies.setGuidance).not.toHaveBeenCalled()
    expect(spies.setSelectedIds).not.toHaveBeenCalled()
  })

  it("deletes the selection with Delete or Backspace, and swallows the browser's own meaning", () => {
    const spies = harness({ selectedIds: ["point-1"] })

    const del = press({ key: "Delete" })
    const backspace = press({ key: "Backspace" })

    expect(spies.deleteSelected).toHaveBeenCalledTimes(2)
    // Backspace 在浏览器里还有"后退"的含义，不挡住就会离开画布；Delete 同样不该留给浏览器。
    expect(del.defaultPrevented).toBe(true)
    expect(backspace.defaultPrevented).toBe(true)
  })

  it("does not delete while the user is editing text, nor with an empty selection", () => {
    const typing = harness({ selectedIds: ["point-1"] })
    const input = document.createElement("input")
    document.body.append(input)
    press({ key: "Delete" }, input)
    expect(typing.deleteSelected).not.toHaveBeenCalled()
    input.remove()

    const nothingSelected = harness()
    press({ key: "Delete" })
    expect(nothingSelected.deleteSelected).not.toHaveBeenCalled()
  })

  it("stops listening once it unmounts", () => {
    const spies = harness({ selectedIds: ["point-1"] })

    spies.unmount()
    press({ key: "Delete" })

    /** 卸载之后那一份监听必须真的摘掉，否则同一页会有两份在响应。 */
    expect(spies.deleteSelected).not.toHaveBeenCalled()
  })
})
