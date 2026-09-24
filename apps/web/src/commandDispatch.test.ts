import { describe, expect, it, vi } from "vitest"

import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { createCommandDispatch, type CommandDispatchDeps } from "./commandDispatch"

/**
 * **命令分发**（`./commandDispatch`）—— 从 `App.tsx` 搬出来的两张 switch 表。
 *
 * 它过去与二十来个闭包 handler 挤在组件体里，只有点界面才能验"这一步该谁做"。
 * 现在它是一张纯表（不认识 store、也不认识 React），所以这里全部用替身 handler 验：
 * 喂一个 commandId，看**谁被调到、谁必须没被调到**。
 */

function harness(overrides: Partial<CommandDispatchDeps> = {}) {
  const spies = {
    apply: vi.fn(),
    setActiveCommand: vi.fn(),
    setLayerNotice: vi.fn(),
    setCreationStep: vi.fn(),
    setSelectedIds: vi.fn(),
    setShowProjectionDiagnostics: vi.fn(),
    setCadMode: vi.fn(),
    addPoint3: vi.fn(),
    addLine3: vi.fn(),
    addPlane3: vi.fn(),
    addFace3: vi.fn(),
    addCircle3Track: vi.fn(),
    addPoint: vi.fn(),
    startCreation: vi.fn(),
    deleteSelected: vi.fn(),
    toggleLock: vi.fn(),
    createGroup: vi.fn(),
    addEngineeringAnnotation: vi.fn(),
    addDefaultPrimitive: vi.fn(),
    addDefaultCube: vi.fn(),
    addDefaultSolid: vi.fn(),
    addTetrahedron: vi.fn(),
    addSection: vi.fn(),
    anchorRotation: vi.fn(),
    exportSvgFile: vi.fn(),
    exportCsvFile: vi.fn(),
    exportPngFile: vi.fn(),
    save: vi.fn()
  }
  const deps: CommandDispatchDeps = {
    document: createEmptyDocument("conics"),
    selectedIds: [],
    cadMode: "projection",
    cadActiveLayerBlockedReason: null,
    engineeringDrawings: [],
    ...spies,
    ...overrides
  }
  return { ...createCommandDispatch(deps), spies }
}

/** 两个图元就够了：这一组用例问的都是"命令把哪些 id / 哪个 handler 送了出去"。 */
const primitives: PrimitiveSpec[] = [
  { id: "point-1", type: "point", x: 0, y: 0 },
  { id: "point-2", type: "point", x: 1, y: 1 }
]

const cadDocument = () => ({ ...createEmptyDocument("cad"), primitives })

describe("command dispatch", () => {
  it("selects and clears the whole document from the CAD table", () => {
    const { runCadCommand, spies } = harness({ document: cadDocument(), selectedIds: ["point-1"] })

    runCadCommand("select-all")
    expect(spies.setSelectedIds).toHaveBeenCalledWith(["point-1", "point-2"])

    runCadCommand("select-clear")
    expect(spies.setSelectedIds).toHaveBeenLastCalledWith([])
  })

  it("starts a two-step creation for the drafting commands", () => {
    const { runCadCommand, spies } = harness({ document: createEmptyDocument("cad") })

    runCadCommand("create-line")
    runCadCommand("create-arc")
    runCadCommand("select-tool")

    expect(spies.startCreation).toHaveBeenNthCalledWith(1, "line")
    expect(spies.startCreation).toHaveBeenNthCalledWith(2, "arc")
    // `select-tool` 是"退出创建"：它必须把创建步骤清掉，而不是再开一个模式。
    expect(spies.setCreationStep).toHaveBeenCalledWith(null)
  })

  /**
   * **活动图层挡住时只提示、不创建。** 提示走状态栏（`setLayerNotice`），
   * 不是弹一条不知道怎么做的报错 —— 这一条是 CAD 模式最容易悄悄坏掉的地方。
   */
  it("only explains when the active layer blocks a creation command", () => {
    const { runCadCommand, spies } = harness({
      document: createEmptyDocument("cad"),
      cadMode: "draft",
      cadActiveLayerBlockedReason: "图层「L-2」已隐藏，无法创建对象"
    })

    runCadCommand("create-point3")

    expect(spies.addPoint3).not.toHaveBeenCalled()
    expect(spies.setActiveCommand).toHaveBeenCalledWith("create-point3")
    expect(spies.setLayerNotice).toHaveBeenCalledWith("图层「L-2」已隐藏，无法创建对象")
  })

  it("still runs the non-creating commands while the layer is blocked", () => {
    const { runCadCommand, spies } = harness({
      document: createEmptyDocument("cad"),
      cadMode: "draft",
      cadActiveLayerBlockedReason: "图层「L-2」已隐藏，无法创建对象"
    })

    // "选中全部"不是创建，所以它照常工作，而且会先把上一条图层提示清掉。
    runCadCommand("select-all")

    expect(spies.setSelectedIds).toHaveBeenCalled()
    expect(spies.setLayerNotice).toHaveBeenCalledWith(null)
  })

  it("toggles visibility and lock through the store operation", () => {
    const { runCadCommand, spies } = harness({ document: createEmptyDocument("cad"), selectedIds: ["point-1", "line-1"] })

    runCadCommand("modify-hide")
    expect(spies.apply).toHaveBeenCalledWith({ op: "setPrimitivesVisible", ids: ["point-1", "line-1"], visible: false })

    runCadCommand("modify-show")
    expect(spies.apply).toHaveBeenLastCalledWith({ op: "setPrimitivesVisible", ids: ["point-1", "line-1"], visible: true })

    runCadCommand("modify-lock")
    expect(spies.toggleLock).toHaveBeenCalledTimes(1)
  })

  /** "选中所有投影来源"：把四个视图里出现过的 `sourceId` 去重后选上。 */
  it("selects every projection source, each one once", () => {
    const { runCadCommand, spies } = harness({
      document: createEmptyDocument("cad"),
      engineeringDrawings: [
        { primitives: [{ sourceId: "cube-1" }, { sourceId: "point-9" }] },
        { primitives: [{ sourceId: "cube-1" }] }
      ] as unknown as CommandDispatchDeps["engineeringDrawings"]
    })

    runCadCommand("inspect-sources")

    const selected = spies.setSelectedIds.mock.calls[0][0] as string[]
    expect([...selected].sort()).toEqual(["cube-1", "point-9"])
  })

  it("toggles the projection diagnostics with a functional update", () => {
    const { runCadCommand, spies } = harness({ document: createEmptyDocument("cad") })

    runCadCommand("inspect-diagnostics")

    // 拿到的是"更新函数"而不是布尔值：连点两次必须真的来回切，而不是都写同一个值。
    const update = spies.setShowProjectionDiagnostics.mock.calls[0][0] as (visible: boolean) => boolean
    expect(update(true)).toBe(false)
    expect(update(false)).toBe(true)
  })

  it("exports through the matching format", () => {
    const { runCadCommand, spies } = harness({ document: createEmptyDocument("cad") })

    runCadCommand("export-svg")
    runCadCommand("export-dxf")
    runCadCommand("export-pdf")
    runCadCommand("export-csv")
    runCadCommand("export-mgeo")

    expect(spies.exportSvgFile.mock.calls).toEqual([["svg"], ["dxf"], ["pdf"]])
    expect(spies.exportCsvFile).toHaveBeenCalledTimes(1)
    expect(spies.save).toHaveBeenCalledTimes(1)
  })

  it("does nothing at all for a command id it does not know", () => {
    const { runCadCommand, spies } = harness({ document: createEmptyDocument("cad") })

    runCadCommand("no-such-command")

    /**
     * 未知 id 只做"进入命令"这一组动作：`setActiveCommand` + 把上一条图层提示清掉（那是 switch 之前
     * 无条件跑的），**不许顺手做别的事**。
     */
    expect(spies.setActiveCommand).toHaveBeenCalledWith("no-such-command")
    expect(spies.setLayerNotice).toHaveBeenCalledWith(null)
    for (const [name, spy] of Object.entries(spies)) {
      if (name === "setActiveCommand" || name === "setLayerNotice") continue
      expect(spy, `${name} should not have been called`).not.toHaveBeenCalled()
    }
  })
})

describe("ribbon dispatch", () => {
  it("creates the default solids and curves in the planar workspaces", () => {
    const { runRibbonCommand, spies } = harness()

    runRibbonCommand("create-cube")
    runRibbonCommand("create-cylinder")
    runRibbonCommand("create-parabola")
    runRibbonCommand("create-section")
    runRibbonCommand("modify-anchor-rotation")

    expect(spies.addDefaultCube).toHaveBeenCalledTimes(1)
    expect(spies.addDefaultSolid).toHaveBeenCalledWith("cylinder")
    expect(spies.addDefaultPrimitive).toHaveBeenCalledWith("parabola")
    expect(spies.addSection).toHaveBeenCalledTimes(1)
    expect(spies.anchorRotation).toHaveBeenCalledTimes(1)
  })

  /**
   * **两张表有意共用一套命令 id**：CAD 工作区里 `runRibbonCommand` 整条转给 `runCadCommand`。
   * 后果是"只在功能区表里的 id"（例如 `create-cube`）在 CAD 工作区**什么都不会发生** ——
   * 这条看着像 bug，其实是当前口径，所以在这里钉住：改动它的人会先看到这条断言。
   */
  it("hands everything to the CAD table inside the CAD workspace", () => {
    const { runRibbonCommand, spies } = harness({ document: createEmptyDocument("cad") })

    runRibbonCommand("create-cube")
    runRibbonCommand("create-point3")

    expect(spies.addDefaultCube).not.toHaveBeenCalled()
    expect(spies.addPoint3).toHaveBeenCalledTimes(1)
    /** 每条命令 `setActiveCommand` 会走两遍：功能区这一层先设，转给 CAD 表之后又设一次同一个 id。 */
    expect(spies.setActiveCommand).toHaveBeenCalledTimes(4)
    expect(spies.setActiveCommand).toHaveBeenNthCalledWith(1, "create-cube")
    expect(spies.setActiveCommand).toHaveBeenNthCalledWith(2, "create-cube")
  })
})

describe("CAD mode switch", () => {
  it("clears the half-finished state of the previous mode", () => {
    const { handleCadModeChange, spies } = harness()

    handleCadModeChange("draft")

    expect(spies.setCadMode).toHaveBeenCalledWith("draft")
    expect(spies.setCreationStep).toHaveBeenCalledWith(null)
    expect(spies.setActiveCommand).toHaveBeenCalledWith(null)
    expect(spies.setLayerNotice).toHaveBeenCalledWith(null)
  })
})
