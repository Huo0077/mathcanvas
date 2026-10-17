import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useKeyboardShortcuts, type KeyboardShortcutDeps } from "./useKeyboardShortcuts"

/**
 * **Ctrl/Cmd+A = 全选**（2026-10-17）。
 *
 * 删除的并集校验要求互相引用的对象一起选中；Agent 画的一张图里有面、绑定点、线段，
 * 点中一张面再按 Delete 会被 `AF` 这类引用挡住。全选之后一次删干净。
 * 输入框里不抢这个组合（那里是文本框自己的全选）。
 */

function deps(onSelectAll: () => void): KeyboardShortcutDeps {
  return {
    creationStep: null,
    activeCommand: null,
    guidance: null,
    selectedIds: [],
    undo: vi.fn(),
    redo: vi.fn(),
    deleteSelected: vi.fn(),
    setCreationStep: vi.fn(),
    setActiveCommand: vi.fn(),
    setGuidance: vi.fn(),
    setSelectedIds: vi.fn(),
    onSelectAll
  }
}

function press(target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

describe("Ctrl/Cmd+A 全选", () => {
  it("calls the select-all callback and prevents the browser default", () => {
    const onSelectAll = vi.fn()
    renderHook(() => useKeyboardShortcuts(deps(onSelectAll)))

    const event = press()

    expect(onSelectAll).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it("accepts the platform modifier as well", () => {
    const onSelectAll = vi.fn()
    renderHook(() => useKeyboardShortcuts(deps(onSelectAll)))

    press(window, { ctrlKey: false, metaKey: true })

    expect(onSelectAll).toHaveBeenCalledTimes(1)
  })

  it("does not steal the shortcut from a text field", () => {
    const onSelectAll = vi.fn()
    renderHook(() => useKeyboardShortcuts(deps(onSelectAll)))
    const input = document.createElement("input")
    document.body.append(input)

    press(input)

    expect(onSelectAll).not.toHaveBeenCalled()
    input.remove()
  })
})
