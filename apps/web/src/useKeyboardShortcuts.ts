import { useEffect, type Dispatch, type SetStateAction } from "react"

import { historyShortcut, isTextEditingTarget } from "./documentIds"
import type { CreationStep } from "./draftingCommands"

/**
 * **画布的键盘快捷键**（从 `App.tsx` 搬出来的那个 `keydown` 监听，评审方案 2）。
 *
 * ## 搬动时顺手修掉的两处依赖问题（都是搬之前就在的）
 *
 * 1. **依赖数组里有 `document` 与 `apply`，但函数体一个都没读**。后果不是"多订阅一次"这么轻：
 *    `document` 每次编辑都会换身份 —— 也就是说**每提交一笔操作，这个监听都要摘下来再挂回去**。
 *    搬到这里之后依赖只剩真正读到的那些。
 * 2. **`deleteSelected` 没写进依赖**，而函数体真的调它（原来的 lint 警告就是这一条）。
 *    它是撤销/删除这条路上唯一会变的 handler，漏掉它意味着"某次改动之后 Delete 走的还是旧的闭包"。
 *
 * ## 三条口径（逐字搬过来的）
 *
 * 1. **Esc 是分级的**：先取消进行中的创建（含 CAD 命令），再关掉指引，最后才清空选择 ——
 *    反过来会让"正在画线时按 Esc"直接把已选中的对象也清掉。
 * 2. **撤销/重做要挡住输入框**：这条判据在 `historyShortcut` 里（连同 `altKey`），
 *    否则用户在数值输入框里按 Ctrl+Z 会撤销**整篇文档**的改动，而不是刚打进去的那几个字符。
 * 3. **Delete / Backspace 只在焦点不在文本输入里时删对象**，并且会 `preventDefault`
 *    （Backspace 在浏览器里还有"后退"的历史含义）。
 */
export interface KeyboardShortcutDeps {
  creationStep: CreationStep | null
  activeCommand: string | null
  guidance: string | null
  selectedIds: string[]
  undo: () => void
  redo: () => void
  deleteSelected: () => void
  setCreationStep: Dispatch<SetStateAction<CreationStep | null>>
  setActiveCommand: Dispatch<SetStateAction<string | null>>
  setGuidance: Dispatch<SetStateAction<string | null>>
  setSelectedIds: Dispatch<SetStateAction<string[]>>
}

export function useKeyboardShortcuts({ creationStep, activeCommand, guidance, selectedIds, undo, redo, deleteSelected, setCreationStep, setActiveCommand, setGuidance, setSelectedIds }: KeyboardShortcutDeps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = historyShortcut(event)
      if (shortcut) {
        event.preventDefault()
        if (shortcut === "undo") undo()
        else redo()
        return
      }
      if (event.key === "Escape") {
        // Esc 分级：先取消进行中的创建（含 CAD 命令），再关掉指引，最后才清空选择。
        if (creationStep || activeCommand) { setCreationStep(null); setActiveCommand(null); setGuidance(null); return }
        if (guidance) { setGuidance(null); return }
        if (selectedIds.length > 0) { setSelectedIds([]); return }
        return
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedIds.length > 0 && !isTextEditingTarget(event.target)) {
        event.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [creationStep, activeCommand, guidance, selectedIds, undo, redo, deleteSelected, setCreationStep, setActiveCommand, setGuidance, setSelectedIds])
}
