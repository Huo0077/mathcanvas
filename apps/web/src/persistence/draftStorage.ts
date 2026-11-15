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

export type DraftRecoveryOutcome =
  | { status: "empty" }
  | { status: "discarded_malformed" }
  | { status: "restored"; document: GeometryDocument }
  | { status: "backup_saved"; message: string; backupKey: string }
  | { status: "backup_failed_readonly"; message: string; raw: string }

/**
 * 读回上次草稿并返回明确的恢复状态。
 *
 * 1. 不是 JSON（垃圾数据，删掉）→ `discarded_malformed`；
 * 2. 正常解出 → `restored`；
 * 3. 是 JSON 但当前版本读不出：先写旁路键并回读校验一致后才移除原键（`backup_saved`）；
 *    若旁路键写入或回读失败，则保留原键原地不动并返回 `backup_failed_readonly`，由调用方阻断自动覆盖。
 */
export function loadDraftRecovery(workspace: Workspace): DraftRecoveryOutcome {
  if (typeof localStorage === "undefined") return { status: "empty" }
  const key = draftKey(workspace)
  const serialized = localStorage.getItem(key)
  if (!serialized) return { status: "empty" }
  try {
    // 只判断"是不是 JSON"：是的话就是用户的工作（哪怕本版本读不出来），不是才算垃圾数据。
    JSON.parse(serialized)
  } catch {
    localStorage.removeItem(key)
    return { status: "discarded_malformed" }
  }
  try {
    return { status: "restored", document: decodeMgeo(serialized) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    const backupKey = unreadableDraftKey(workspace)
    try {
      localStorage.setItem(backupKey, serialized)
      if (localStorage.getItem(backupKey) === serialized) {
        localStorage.removeItem(key)
        return {
          status: "backup_saved",
          message: `无法恢复上次的草稿（已备份保留）：${detail}`,
          backupKey
        }
      }
    } catch {
      // 旁路键写不进去或回读不一致时原地保留原键，进入只读保护。
    }
    return {
      status: "backup_failed_readonly",
      message: `无法恢复上次的草稿（未能备份到旁路键，原草稿已开启只读保护，请下载备份或确认舍弃后再自动保存）：${detail}`,
      raw: serialized
    }
  }
}

/** 显式舍弃当前工作区原键上的草稿（仅在用户确认后调用）。 */
export function discardDraft(workspace: Workspace): void {
  if (typeof localStorage === "undefined") return
  localStorage.removeItem(draftKey(workspace))
}

/**
 * 读回上次的草稿。
 *
 * 三种情况必须区分开：不是 JSON（垃圾数据，删掉）、是 JSON 但不是本文档（用户的工作，
 * **保留**在旁路键或原地只读保护并抛出，绝不当垃圾清理掉）、正常解出（返回文档）。
 */
export function loadDraft(workspace: Workspace): GeometryDocument | null {
  const outcome = loadDraftRecovery(workspace)
  if (outcome.status === "restored") return outcome.document
  if (outcome.status === "empty" || outcome.status === "discarded_malformed") return null
  throw new Error(outcome.message)
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

/**
 * 3D 视口的显示偏好：`autoFit`（关掉之后相机永不被自动重置）与
 * `showRotationHandles`（三色旋转环的视图开关，**默认关**：不转的时候它只挡图面）。
 */
export interface ViewPreference3d {
  autoFit: boolean
  showRotationHandles: boolean
}

export function loadViewPreference3d(): ViewPreference3d {
  if (typeof localStorage === "undefined") return { autoFit: true, showRotationHandles: false }
  const serialized = localStorage.getItem(viewPreference3dKey)
  if (!serialized) return { autoFit: true, showRotationHandles: false }
  try {
    const parsed = JSON.parse(serialized) as Partial<ViewPreference3d>
    /**
     * 只有显式存成 false / true 才算数：旧数据、缺字段、写坏的值一律回默认。
     *
     * 两个默认值的方向**刻意相反**：`autoFit` 默认开（不自动取景的话打开文件常常看不到图），
     * `showRotationHandles` 默认关（不转的时候三个环只挡图面 —— 用户口径："把这个太空环删掉"）。
     */
    return { autoFit: parsed.autoFit !== false, showRotationHandles: parsed.showRotationHandles === true }
  } catch {
    localStorage.removeItem(viewPreference3dKey)
    return { autoFit: true, showRotationHandles: false }
  }
}

export function saveViewPreference3d(preference: ViewPreference3d): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(viewPreference3dKey, JSON.stringify({ autoFit: preference.autoFit, showRotationHandles: preference.showRotationHandles }))
  } catch {
    // 见 `saveWorkbenchPreferences`：视图偏好存不下属于可接受降级。
  }
}
