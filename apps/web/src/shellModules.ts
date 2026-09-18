import type { Workspace } from "@draw/dsl"

/**
 * 两个**顶级模块**的标识。它们与 `Workspace`（`conics` / `geometry3d` / `cad`）是两层不同的概念：
 * 模块决定整个应用的骨架（有没有 Ribbon、有没有对话区），工作区只决定传统工作区里放哪一块画布。
 */
export type AppModuleId = "traditional" | "agent"

export const DEFAULT_APP_MODULE: AppModuleId = "traditional"

export interface AppModuleDefinition {
  id: AppModuleId
  label: string
  hint: string
  icon: "drafting" | "agent"
}

export const APP_MODULES: AppModuleDefinition[] = [
  { id: "traditional", label: "传统工作区", hint: "画布与制图", icon: "drafting" },
  { id: "agent", label: "Agent 工作区", hint: "对话式作图", icon: "agent" }
]

export type WorkspaceId = Extract<Workspace, "conics" | "geometry3d" | "cad">

export interface WorkspaceDefinition {
  id: WorkspaceId
  /** 界面上的名字。内部 ID 保持不变（见 `WorkspaceTabs` 的同名注释）。 */
  label: string
}

export const WORKSPACE_DEFINITIONS: WorkspaceDefinition[] = [
  { id: "conics", label: "平面几何" },
  { id: "geometry3d", label: "立体几何" },
  { id: "cad", label: "工程制图" }
]

export function workspaceLabel(id: Workspace): string {
  return WORKSPACE_DEFINITIONS.find((workspace) => workspace.id === id)?.label ?? "平面几何"
}

/** 左侧栏当前该高亮哪一个工作区入口。 */
export function isWorkspaceId(value: Workspace): value is WorkspaceId {
  return WORKSPACE_DEFINITIONS.some((workspace) => workspace.id === value)
}
