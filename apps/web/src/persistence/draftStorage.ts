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
  return workspace === "calculus" || workspace === "conics" || workspace === "cad" || workspace === "geometry3d" ? workspace : null
}
