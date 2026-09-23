import { decodeMgeo, encodeMgeo } from "@draw/dsl"
import type { GeometryDocument, Workspace } from "@draw/dsl"

const activeWorkspaceKey = "mathcanvas:active-workspace"
const workbenchPreferencesKey = "mathcanvas:workbench-preferences"
const lastDocumentIdKey = "mathcanvas:last-document-id"
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
  /**
   * **先编码，再写盘**（Fix round 1，Reactive DAG worker 报的缺陷）。
   *
   * `encodeMgeo` 会校验文档：文档已经非法时它抛错。以前编码与写盘共用一个 `catch {}`，
   * 于是"文档非法"被当成"存不下（配额 / 隐私模式）"静默吞掉 —— 画布上是新内容、
   * 磁盘上还是旧的，用户看不到任何提示（`App.tsx` 那层 `try/catch` 永远收不到这个错误）。
   *
   * 两者的处置**不同**：配额是"这次存不下"（可接受降级），文档非法是"你画的东西本身不合法"
   *（必须让用户知道）。所以编码放在 try 外面，写盘失败照旧吞掉。
   */
  const serialized = encodeMgeo(document)
  try {
    localStorage.setItem(draftKey(document.workspace), serialized)
    localStorage.setItem(activeWorkspaceKey, document.workspace)
    /**
     * **记住"这一世用的是哪份文档"**（2026-09-22 修 / 外部审查 X1）。
     *
     * 启动时的仓储探测必须用**这个** id：Rust 侧 `read_head` 按 `(project_id, document_id)`
     * 过滤，而 `createEmptyDocument()` 每次都给一个新随机 id —— 没有这份记忆，
     * 每次启动都必然未命中，仓储里那份真正的内容永远读不回来。
     * 与草稿写在同一个 `try` 里：两者都是"记住本地状态"，配额满了就一起降级。
     */
    localStorage.setItem(lastDocumentIdKey, document.metadata.id)
  } catch {
    // 草稿存不下时调用方已经通过 `load` 的提示告知用户；这里不重复抛。
  }
}

/**
 * 上一次活动文档的 id（没有任何记录时为 `null`）。
 *
 * 与 `loadDraft` **刻意分开**：读它不需要解码 `.mgeo`，因此没有副作用
 * （不会删除垃圾草稿、也不会把读不出来的草稿挪到旁路键），可以在启动探测之前安全调用。
 */
export function loadLastDocumentId(): string | null {
  if (typeof localStorage === "undefined") return null
  const documentId = localStorage.getItem(lastDocumentIdKey)
  return documentId !== null && documentId.length > 0 ? documentId : null
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
