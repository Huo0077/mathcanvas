import { describe, expect, it } from "vitest"

import { createRibbonGroups, type RibbonCommandContext } from "./ribbonCommands"

const emptyContext: RibbonCommandContext = {
  workspace: "conics",
  cadMode: "draft",
  selectedCount: 0,
  allSelectedLocked: false,
  canCreateSection: false,
  canCreateLine3: false,
  canCreatePlane3: false,
  canCreateFace3: false,
  canCreateCircle3: false,
  canCreateLinearAnnotation: false,
  canCreateAngularAnnotation: false,
  canAnchorRotation: false,
  diagnosticVisible: false
}

describe("ribbon command configuration", () => {
  it("keeps the requested base commands in a stable order for planar workspaces", () => {
    const commands = createRibbonGroups(emptyContext).find((group) => group.id === "base")?.commands.map((command) => command.id)

    expect(commands).toEqual(["select-tool", "create-point", "create-line", "create-segment", "create-ray", "create-polyline", "create-circle", "create-arc", "create-parabola", "create-ellipse", "create-hyperbola", "create-function"])
  })

  it("exposes CAD export commands and disables selection-dependent actions with reasons", () => {
    const groups = createRibbonGroups({ ...emptyContext, workspace: "cad", cadMode: "projection" })
    const exports = groups.find((group) => group.id === "export")?.commands.map((command) => command.id)
    const deleteCommand = groups.find((group) => group.id === "edit")?.commands.find((command) => command.id === "modify-delete")

    expect(exports).toEqual(["export-svg", "export-dxf", "export-pdf", "export-csv", "export-mgeo"])
    expect(deleteCommand?.disabled).toBe(true)
    expect(deleteCommand?.disabledReason).toContain("选择")
  })

  it("keeps spatial construction commands available in the 3D workspace", () => {
    const groups = createRibbonGroups({ ...emptyContext, workspace: "geometry3d" })
    const labels = groups.flatMap((group) => group.commands.map((command) => command.label))

    expect(labels).toEqual(expect.arrayContaining(["添加空间点", "添加立方体", "创建截面"]))
  })

  /**
   * 立体几何的 18 个空间命令拆成 `draw` / `solids` / `construct` 三组。
   *
   * 拆的理由是**宽度**：这 18 个命令挤在一组时实测宽 1466px，比 1280px 窗口下的整个功能区
   * （1208px）还宽，`多模态输入` / `作业操作` / `文件输出` 三组因此全被挤出屏幕
   * （26 个命令里 12 个完全看不见）。拆开之后每一组能单独折叠，"收起用不到的那类"才可用。
   *
   * 这条同时钉住两件事：**顺序按使用频次**（先画 → 再放现成实体 → 最后才是依赖选中对象的构造），
   * 以及**平面几何仍然是单独一组 `base`**（不受这次拆分影响）。
   */
  it("splits the 3D commands into draw / solids / construct, in that order", () => {
    const groups = createRibbonGroups({ ...emptyContext, workspace: "geometry3d" })
    const prefix = groups.slice(0, 3)

    expect(prefix.map((group) => group.id)).toEqual(["draw", "solids", "construct"])
    expect(prefix.map((group) => group.label)).toEqual(["绘制", "立体与截面", "由选中点构造"])
    expect(groups.some((group) => group.id === "base")).toBe(false)

    expect(prefix[0].commands.map((command) => command.id)).toEqual(["select-tool", "draw-point3", "draw-segment3", "draw-line3", "draw-ray3", "draw-plane3", "draw-face3"])
    expect(prefix[1].commands.map((command) => command.id)).toEqual(["create-point3", "create-cube", "create-pyramid", "create-tetrahedron", "create-cylinder", "create-cone", "create-section"])
    expect(prefix[2].commands.map((command) => command.id)).toEqual(["create-line3", "create-plane3", "create-face3", "create-circle3-track"])
  })

  it("keeps direct spatial drawing available and gates construction on a selection", () => {
    const groups = createRibbonGroups({ ...emptyContext, workspace: "geometry3d" })
    const draw = groups.find((group) => group.id === "draw")!
    const construct = groups.find((group) => group.id === "construct")!

    // 直接在画布上作画不需要先选中任何东西。
    expect(draw.commands.filter((command) => command.id.startsWith("draw-")).every((command) => !command.disabled)).toBe(true)
    // "由选中点构造"必须先有选中对象，并且要说清怎么办 —— 不能让用户点了没反应。
    expect(construct.commands.every((command) => command.disabled === true)).toBe(true)
    expect(construct.commands.find((command) => command.id === "create-line3")?.disabledReason).toContain("Shift")
  })
  it("offers exactly the two multimodal conversions, both unavailable with a reason", () => {
    const multimodal = createRibbonGroups(emptyContext).find((group) => group.id === "multimodal")

    expect(multimodal?.commands.map((command) => command.id)).toEqual(["input-text-conversion", "input-image-conversion"])
    expect(multimodal?.commands.map((command) => command.label)).toEqual(["文字转换", "图片转换"])
    expect(multimodal?.commands.every((command) => command.disabled === true)).toBe(true)
    expect(multimodal?.commands.map((command) => command.disabledReason)).toEqual(["文字转换服务尚未接入，暂不可用", "图片转换服务尚未接入，暂不可用"])
  })
})
