import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { CommandBar, type CommandCategory, type CommandCategoryId } from "./CommandBar"

const categories: CommandCategory[] = [
  { id: "select", label: "选择", commands: [{ id: "select-tool", label: "选择工具" }] },
  {
    id: "create",
    label: "创建",
    commands: [
      { id: "create-point", label: "添加点" },
      { id: "create-line", label: "添加直线", disabled: true, disabledReason: "请先激活一个未锁定的图层" }
    ]
  },
  { id: "modify", label: "修改", commands: [{ id: "modify-delete", label: "删除对象" }] },
  { id: "annotate", label: "标注", commands: [{ id: "annotate-linear", label: "线性尺寸" }] },
  { id: "inspect", label: "检查", commands: [{ id: "inspect-diagnostics", label: "投影诊断" }] },
  { id: "export", label: "导出", commands: [{ id: "export-svg", label: "导出 SVG" }] }
]

interface HarnessOptions {
  initialCategory?: CommandCategoryId | null
}

/** The command bar is controlled, so the test drives it through a real stateful parent. */
function Harness({ initialCategory = null }: HarnessOptions) {
  const [category, setCategory] = useState<CommandCategoryId | null>(initialCategory)
  const [command, setCommand] = useState<string | null>(null)
  return <CommandBar
    categories={categories}
    activeCategory={category}
    activeCommand={command}
    onCategoryChange={(next) => { handlers.onCategoryChange(next); setCategory(next) }}
    onCommandChange={(next) => { handlers.onCommandChange(next); setCommand(next) }}
    onBack={() => { handlers.onBack(); setCategory(null); setCommand(null) }}
    onCancel={handlers.onCancel}
  />
}

const handlers = {
  onCategoryChange: vi.fn(),
  onCommandChange: vi.fn(),
  onBack: vi.fn(),
  onCancel: vi.fn()
}

function renderCommandBar(options: HarnessOptions = {}) {
  for (const handler of Object.values(handlers)) handler.mockClear()
  render(<Harness {...options} />)
  return handlers
}

describe("engineering command bar", () => {
  it("shows only the top level task categories on first render", () => {
    renderCommandBar()

    for (const category of categories) expect(screen.getByRole("button", { name: category.label })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "添加点" })).toBeNull()
    expect(screen.queryByRole("button", { name: "返回" })).toBeNull()
  })

  it("reveals the creation commands after choosing 创建 and restores the categories with 返回", () => {
    const bound = renderCommandBar()

    fireEvent.click(screen.getByRole("button", { name: "创建" }))
    expect(bound.onCategoryChange).toHaveBeenCalledWith("create")
    expect(screen.getByRole("region", { name: "创建命令" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "添加点" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "返回" }))
    expect(bound.onBack).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("button", { name: "添加点" })).toBeNull()
    expect(screen.getByRole("button", { name: "创建" })).toBeTruthy()
  })

  it("reports the chosen command and marks it active", () => {
    const bound = renderCommandBar({ initialCategory: "select" })

    fireEvent.click(screen.getByRole("button", { name: "选择工具" }))

    expect(bound.onCommandChange).toHaveBeenCalledWith("select-tool")
    expect(screen.getByRole("button", { name: "选择工具" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("disables unavailable commands and explains why", () => {
    renderCommandBar({ initialCategory: "create" })

    const disabled = screen.getByRole("button", { name: "添加直线" }) as HTMLButtonElement
    expect(disabled.disabled).toBe(true)
    expect(disabled.title).toBe("请先激活一个未锁定的图层")
  })

  it("cancels the running command when Escape is pressed", () => {
    const bound = renderCommandBar({ initialCategory: "create" })

    fireEvent.keyDown(window, { key: "Escape" })

    expect(bound.onCancel).toHaveBeenCalledTimes(1)
  })

  it("never intercepts Escape while a text field has focus", () => {
    const bound = renderCommandBar({ initialCategory: "create" })
    const field = globalThis.document.createElement("input")
    globalThis.document.body.append(field)

    fireEvent.keyDown(field, { key: "Escape" })

    expect(bound.onCancel).not.toHaveBeenCalled()
    field.remove()
  })
})
