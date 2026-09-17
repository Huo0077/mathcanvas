import { decodeMgeo, encodeMgeo } from "@draw/dsl"
import type { GeometryDocument, Workspace } from "@draw/dsl"

const activeWorkspaceKey = "mathcanvas:active-workspace"
const workbenchPreferencesKey = "mathcanvas:workbench-preferences"
const draftKey = (workspace: Workspace) => `mathcanvas:draft:${workspace}`

export type TreeTabPreference = "model" | "layers" | "drawings"

export interface WorkbenchPreferences {
  treeTab: TreeTabPreference
  expandedIds: string[]
}

/** Only view-only workbench state is stored here; the document itself stays in the per-workspace draft. */
export function saveWorkbenchPreferences(preferences: WorkbenchPreferences): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(workbenchPreferencesKey, JSON.stringify(preferences))
}

export function loadWorkbenchPreferences(): WorkbenchPreferences | null {
  if (typeof localStorage === "undefined") return null
  const serialized = localStorage.getItem(workbenchPreferencesKey)
  if (!serialized) return null
  try {
    const parsed = JSON.parse(serialized) as Partial<WorkbenchPreferences>
    const treeTab = parsed.treeTab === "layers" || parsed.treeTab === "drawings" || parsed.treeTab === "model" ? parsed.treeTab : "model"
    const expandedIds = Array.isArray(parsed.expandedIds) ? parsed.expandedIds.filter((id): id is string => typeof id === "string") : []
    return { treeTab, expandedIds }
  } catch {
    localStorage.removeItem(workbenchPreferencesKey)
    return null
  }
}

export function saveDraft(document: GeometryDocument): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(draftKey(document.workspace), encodeMgeo(document))
  localStorage.setItem(activeWorkspaceKey, document.workspace)
}

export function loadDraft(workspace: Workspace): GeometryDocument | null {
  if (typeof localStorage === "undefined") return null
  const serialized = localStorage.getItem(draftKey(workspace))
  if (!serialized) return null
  try {
    return decodeMgeo(serialized)
  } catch {
    localStorage.removeItem(draftKey(workspace))
    return null
  }
}

export function loadActiveWorkspace(): Workspace | null {
  if (typeof localStorage === "undefined") return null
  const workspace = localStorage.getItem(activeWorkspaceKey)
  // "calculus" is deliberately absent: the workspace is retired, so an old draft must not reopen it.
  return workspace === "conics" || workspace === "cad" || workspace === "geometry3d" ? workspace : null
}

const viewPreference3dKey = "mathcanvas:3d-view"

/** 3D 视口的显示偏好。目前只有"自动取景"：关掉之后相机永不被自动重置。 */
export interface ViewPreference3d {
  autoFit: boolean
}

export function loadViewPreference3d(): ViewPreference3d {
  if (typeof localStorage === "undefined") return { autoFit: true }
  const serialized = localStorage.getItem(viewPreference3dKey)
  if (!serialized) return { autoFit: true }
  try {
    const parsed = JSON.parse(serialized) as Partial<ViewPreference3d>
    // 只有显式存成 false 才算关掉：旧数据 / 缺字段都按默认（开）处理。
    return { autoFit: parsed.autoFit !== false }
  } catch {
    localStorage.removeItem(viewPreference3dKey)
    return { autoFit: true }
  }
}

export function saveViewPreference3d(preference: ViewPreference3d): void {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(viewPreference3dKey, JSON.stringify({ autoFit: preference.autoFit }))
}
