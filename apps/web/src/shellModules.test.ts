import { describe, expect, it } from "vitest"

import { APP_MODULES, DEFAULT_APP_MODULE, WORKSPACE_DEFINITIONS, isWorkspaceId, workspaceLabel } from "./shellModules"

describe("application modules", () => {
  it("offers exactly the two top-level modules, with the traditional workbench as the default", () => {
    expect(APP_MODULES.map((module) => module.id)).toEqual(["traditional", "agent"])
    expect(APP_MODULES.map((module) => module.label)).toEqual(["传统工作区", "Agent 工作区"])
    expect(DEFAULT_APP_MODULE).toBe("traditional")
  })

  it("keeps the three existing workspaces reachable from the module A sidebar", () => {
    expect(WORKSPACE_DEFINITIONS.map((workspace) => workspace.label)).toEqual(["平面几何", "立体几何", "工程制图"])
    expect(isWorkspaceId("conics")).toBe(true)
    expect(isWorkspaceId("cad")).toBe(true)
    expect(workspaceLabel("geometry3d")).toBe("立体几何")
  })
})
