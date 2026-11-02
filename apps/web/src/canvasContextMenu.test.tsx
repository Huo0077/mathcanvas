import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { cleanup, render, screen, fireEvent } from "@testing-library/react"
import { createEmptyDocument } from "@draw/dsl"
import { ContextMenu } from "./components/ContextMenu"
import { InlineRenameInput } from "./components/InlineRenameInput"
import { App } from "./App"
import { useSceneStore } from "./store"

describe("Block 5: ContextMenu component", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("renders primitive context menu with actions and preset colors", () => {
    const onRename = vi.fn()
    const onToggleVisibility = vi.fn()
    const onToggleLock = vi.fn()
    const onDelete = vi.fn()
    const onInspectDependencies = vi.fn()
    const onColorChange = vi.fn()
    const onClose = vi.fn()

    render(
      <ContextMenu
        position={{ x: 100, y: 150 }}
        targetPrimitive={{
          id: "point-1",
          label: "点 A",
          type: "point",
          visible: true,
          locked: false,
          style: { stroke: "#2c3e50" },
        }}
        onClose={onClose}
        onRename={onRename}
        onToggleVisibility={onToggleVisibility}
        onToggleLock={onToggleLock}
        onDelete={onDelete}
        onInspectDependencies={onInspectDependencies}
        onColorChange={onColorChange}
      />
    )

    // Header & badge
    expect(screen.getByText("点 A")).toBeTruthy()
    expect(screen.getByText("点")).toBeTruthy()

    // Color swatch click
    const blueSwatch = screen.getByLabelText("经典蓝")
    fireEvent.click(blueSwatch)
    expect(onColorChange).toHaveBeenCalledWith("#2563eb")
    expect(onClose).toHaveBeenCalled()

    // Action buttons
    expect(screen.getByRole("menuitem", { name: /重命名/ })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /隐藏对象/ })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /锁定几何位置/ })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /查看从属依赖拓扑/ })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: /级联删除/ })).toBeTruthy()

    fireEvent.click(screen.getByRole("menuitem", { name: /重命名/ }))
    expect(onRename).toHaveBeenCalled()
  })

  it("renders canvas background context menu with undo/redo, tool shortcuts and select all", () => {
    const onUndo = vi.fn()
    const onRedo = vi.fn()
    const onSelectAll = vi.fn()
    const onSelectTool = vi.fn()
    const onClose = vi.fn()

    render(
      <ContextMenu
        position={{ x: 200, y: 250 }}
        targetPrimitive={null}
        onClose={onClose}
        canUndo={true}
        canRedo={true}
        onUndo={onUndo}
        onRedo={onRedo}
        onSelectAll={onSelectAll}
        onSelectTool={onSelectTool}
      />
    )

    expect(screen.getByText("几何画布")).toBeTruthy()
    expect(screen.getByText("全局")).toBeTruthy()

    const undoBtn = screen.getByRole("menuitem", { name: /撤销/ })
    fireEvent.click(undoBtn)
    expect(onUndo).toHaveBeenCalled()

    const pointToolBtn = screen.getByRole("menuitem", { name: /绘制点/ })
    fireEvent.click(pointToolBtn)
    expect(onSelectTool).toHaveBeenCalledWith("point")

    const selectAllBtn = screen.getByRole("menuitem", { name: /全选图元/ })
    fireEvent.click(selectAllBtn)
    expect(onSelectAll).toHaveBeenCalled()
  })
})

describe("Block 5: InlineRenameInput component", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("commits valid new name on Enter", () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()

    render(
      <InlineRenameInput
        position={{ x: 100, y: 100 }}
        initialValue="A"
        primitiveId="point-1"
        existingLabels={["B", "C"]}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    )

    const input = screen.getByRole("textbox", { name: "图元新名称" }) as HTMLInputElement
    expect(input.value).toBe("A")

    fireEvent.change(input, { target: { value: "A_prime" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(onCommit).toHaveBeenCalledWith("A_prime")
    expect(onCancel).not.toHaveBeenCalled()
  })

  it("cancels renaming on Escape", () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()

    render(
      <InlineRenameInput
        position={{ x: 100, y: 100 }}
        initialValue="A"
        primitiveId="point-1"
        onCommit={onCommit}
        onCancel={onCancel}
      />
    )

    const input = screen.getByRole("textbox", { name: "图元新名称" })
    fireEvent.keyDown(input, { key: "Escape" })

    expect(onCancel).toHaveBeenCalled()
    expect(onCommit).not.toHaveBeenCalled()
  })

  it("displays validation error on empty or duplicate name", () => {
    const onCommit = vi.fn()
    const onCancel = vi.fn()

    render(
      <InlineRenameInput
        position={{ x: 100, y: 100 }}
        initialValue="A"
        primitiveId="point-1"
        existingLabels={["B", "C"]}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    )

    const input = screen.getByRole("textbox", { name: "图元新名称" })

    // Duplicate name test
    fireEvent.change(input, { target: { value: "B" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(screen.getByRole("alert").textContent).toContain("已存在名称为「B」的图元")
    expect(onCommit).not.toHaveBeenCalled()

    // Empty name test
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(screen.getByRole("alert").textContent).toContain("名称不能为空")
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe("Block 5: Canvas Context Menu & Hotkey Integration in App", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("opens context menu on canvas right click and closes on Escape", async () => {
    render(<App />)

    const svg = screen.getByRole("img", { name: "几何画布" })

    // Right-click empty canvas
    fireEvent.contextMenu(svg, { clientX: 300, clientY: 200 })

    const canvasMenu = await screen.findByRole("menu", { name: "画布上下文菜单" })
    expect(canvasMenu).toBeTruthy()
    expect(screen.getByText("几何画布")).toBeTruthy()

    // Close menu by pressing Escape
    fireEvent.keyDown(window, { key: "Escape" })
    expect(screen.queryByRole("menu", { name: "画布上下文菜单" })).toBeNull()
  })

  it("opens primitive context menu on primitive right-click and supports rename", async () => {
    const document = createEmptyDocument("conics")
    document.primitives = [{ id: "point-1", type: "point", x: 2, y: 1, label: "原点 P" }]
    useSceneStore.setState({
      document,
      workspaceDocuments: { [document.workspace]: document },
      history: [],
      future: [],
      error: null,
    })

    const { container } = render(<App />)

    const pointTarget = container.querySelector('[data-primitive-id="point-1"]')
    expect(pointTarget).toBeTruthy()

    // Right click on primitive
    fireEvent.contextMenu(pointTarget!, { clientX: 250, clientY: 180 })

    const menu = await screen.findByRole("menu", { name: "画布上下文菜单" })
    expect(menu).toBeTruthy()
    expect(menu.querySelector(".context-menu-title")?.textContent).toBe("原点 P")

    // Click rename
    const renameBtn = screen.getByRole("menuitem", { name: /重命名/ })
    fireEvent.click(renameBtn)

    // InlineRenameInput appears
    const renameInput = (await screen.findByRole("textbox", { name: "图元新名称" })) as HTMLInputElement
    expect(renameInput).toBeTruthy()
    expect(renameInput.value).toBe("原点 P")

    // Commit new name
    fireEvent.change(renameInput, { target: { value: "新点 Q" } })
    fireEvent.keyDown(renameInput, { key: "Enter" })

    // Document state updated
    const updated = useSceneStore.getState().document.primitives.find((p) => p.id === "point-1")
    expect(updated?.label).toBe("新点 Q")
  })

  it("triggers inline rename on F2 hotkey for selected primitive", async () => {
    const document = createEmptyDocument("conics")
    document.primitives = [{ id: "point-1", type: "point", x: 2, y: 1, label: "点 A" }]
    useSceneStore.setState({
      document,
      workspaceDocuments: { [document.workspace]: document },
      history: [],
      future: [],
      error: null,
    })

    const { container } = render(<App />)

    const pointHit = container.querySelector('[data-point-hit="top"]')
    expect(pointHit).toBeTruthy()

    // Select the point
    fireEvent.click(pointHit!)

    // Press F2
    fireEvent.keyDown(window, { key: "F2" })

    const renameInput = (await screen.findByRole("textbox", { name: "图元新名称" })) as HTMLInputElement
    expect(renameInput).toBeTruthy()
    expect(renameInput.value).toBe("点 A")

    // Rename to A_new and commit
    fireEvent.change(renameInput, { target: { value: "A_new" } })
    fireEvent.keyDown(renameInput, { key: "Enter" })

    const updated = useSceneStore.getState().document.primitives.find((p) => p.id === "point-1")
    expect(updated?.label).toBe("A_new")
  })
})
