import { describe, expect, it } from "vitest"

import { APP_MODULES, DEFAULT_APP_MODULE, WORKSPACE_DEFINITIONS, isWorkspaceId, workspaceLabel } from "./shellModules"

describe("application modules", () => {
  it("keeps the top-level modules explicit, with the traditional workbench as the default", () => {
    /**
     * 模块清单**逐字列出**而不是数一个数：加一个模块（例如 G1 Task 1.3 的「模型服务」）时，
     * 这条用例会逼你在这里写下它的名字与标签 —— 那一刻就是一次有意的决定。
     */
    expect(APP_MODULES.map((module) => module.id)).toEqual(["traditional", "agent", "settings"])
    expect(APP_MODULES.map((module) => module.label)).toEqual(["传统工作区", "Agent 工作区", "模型服务"])
    expect(DEFAULT_APP_MODULE).toBe("traditional")
  })

  it("keeps the three existing workspaces reachable from the module A sidebar", () => {
    expect(WORKSPACE_DEFINITIONS.map((workspace) => workspace.label)).toEqual(["平面几何", "立体几何", "工程制图"])
    expect(isWorkspaceId("conics")).toBe(true)
    expect(isWorkspaceId("cad")).toBe(true)
    expect(workspaceLabel("geometry3d")).toBe("立体几何")
  })
})
