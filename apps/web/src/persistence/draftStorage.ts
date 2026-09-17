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
  // 配额溢出 / 隐私模式会让 `setItem` 直接抛错。这些写入发生在点击处理里，抛出去就是一个
  // "界面已变、控制台报错"的半截状态；视图偏好存不下是可以接受的降级，绝不能让点击崩掉。
  try {
    localStorage.setItem(workbenchPreferencesKey, JSON.stringify(preferences))
  } catch {
    // 存不下就放弃这次持久化：当前会话里的视图状态仍然生效。
  }
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
  // 同上：写不进去（配额 / 隐私模式）不能让调用方在半途抛错。
  try {
    localStorage.setItem(draftKey(document.workspace), encodeMgeo(document))
    localStorage.setItem(activeWorkspaceKey, document.workspace)
  } catch {
    // 草稿存不下时调用方已经通过 `load` 的提示告知用户；这里不重复抛。
  }
}

/**
 * 读回上次的草稿。
 *
 * 三种情况必须区分开：不是 JSON（垃圾数据，删掉）、是 JSON 但不是本文档（用户的工作，
 * **保留**在旁路键上并抛出，绝不当垃圾清理掉）、正常解出（返回文档）。
 * 旧实现把后两种一起 `removeItem` 了 —— 一个字段不合规的旧草稿会让用户的工作凭空消失。
 */
export function loadDraft(workspace: Workspace): GeometryDocument | null {
  if (typeof localStorage === "undefined") return null
  const serialized = localStorage.getItem(draftKey(workspace))
  if (!serialized) return null
  try {
    // 只判断"是不是 JSON"：是的话就是用户的工作（哪怕本版本读不出来），不是才算垃圾数据。
    JSON.parse(serialized)
  } catch {
    localStorage.removeItem(draftKey(workspace))
    return null
  }
  try {
    return decodeMgeo(serialized)
  } catch (error) {
    // 挪到旁路键：自动保存不会覆盖它，用户的工作还在，可以被后续版本或手工修复取回。
    try {
      localStorage.setItem(unreadableDraftKey(workspace), serialized)
      localStorage.removeItem(draftKey(workspace))
    } catch {
      // 旁路键也写不进去（配额）时就**原地保留**：宁可让自动保存覆盖，也不能主动删掉工作。
    }
    throw new Error(`无法恢复上次的草稿（已备份保留）：${error instanceof Error ? error.message : String(error)}`, { cause: error })
  }
}

/** 读不出来的草稿挪到这里，既不会被自动保存覆盖，也不参与启动恢复。 */
export function unreadableDraftKey(workspace: Workspace): string {
  return `${draftKey(workspace)}:unreadable`
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
  try {
    localStorage.setItem(viewPreference3dKey, JSON.stringify({ autoFit: preference.autoFit }))
  } catch {
    // 见 `saveWorkbenchPreferences`：视图偏好存不下属于可接受降级。
  }
}
