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
  canCreateLinearAnnotation: false,
  canCreateAngularAnnotation: false,
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
})
