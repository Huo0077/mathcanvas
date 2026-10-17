/**
 * **文档持久化适配器**（Task 1.6：把 `documentService` 接到项目仓储上）。
 *
 * ## 职责与边界
 *
 * 它只做三件事：**恢复**（从仓储读回上次的文档）、**保存**（把文档写进仓储）、
 * **按需重试**。它**不**改文档、不决定何时保存 —— 那是 `App` 的事。
 *
 * ## 为什么"每次改动都写一次"不行（这是本片最重要的判断）
 *
 * `saveDraft` 现在挂在 `[document]` 上，**每次改动都会触发**。如果直接把它接到仓储上：
 * - 仓储每提交一次就 `generation + 1` 并写一份快照 —— 拖一下点会留下几百个 generation；
 * - `replace_epoch` 每次都会推进 generation，于是**刚拿到的句柄立刻过期**，
 *   下一次保存必然 `stale_head`；
 * - 撤销栈是**内存里**的（100 步上限），仓储的历史本该是"比内存更久"的那一层，
 *   被高频写入冲成几百份之后它就完全没有价值了。
 *
 * 所以这个适配器**按"同一份文档内容"幂等**：内容没变就直接返回上一次的回执，
 * 一次 IPC 都不发。仓储那边本来也有 `Unchanged` 分支；这里**在前面再挡一次**，
 * 是为了省掉那次 IPC 与那次事务 —— 高频路径上的往返本身也是成本。
 *
 * ## 两种保存时机是**不同**的操作，不能共用一个回调
 *
 * - **自动保存**：内容变了就写（防丢），失败**必须重试**。
 * - **导入 / 打开文件**：换的是"这一世"（epoch 变），在途的旧保存必须被作废 ——
 *   否则用户刚打开的文档会被上一次编辑的自动保存覆盖掉。
 *
 * 第一版把两者合成一个 `save`，于是"打开文件之后旧内容又冒出来"这条路径没有任何东西挡得住。
 * 现在分成 `save`（内容变了）与 `reset`（换了一世）。
 */

import { createEmptyDocument, type Workspace, type GeometryDocument } from "@draw/dsl"
import { contentFingerprint, type DocumentHandle } from "@draw/scene-graph"

import type { DocumentRepository, DocumentSnapshot, RepositoryFailure } from "./documentRepository"
import { classifyRepositoryError, documentFromSnapshot } from "./documentRepository"

export interface RestoreOutcome {
  document: GeometryDocument
  /** 这一次是不是**新建**的（仓储里原本没有）。界面上"恢复上次的文档"与"新建了一份"要说不同的话。 */
  created: boolean
  /** 失败时**仍然给出**一份可用的文档（空文档），并把原因带出来。 */
  failure?: RepositoryFailure
}

export interface DocumentPersistence {
  /** 打开时调一次：恢复上次的文档，或新建一份。**总会给出一份可用文档。** */
  restore(): Promise<RestoreOutcome>
  /** Read-only recovery of a workspace; never creates an empty row during hydration. */
  restoreWorkspace(workspace: Workspace, documentId?: string): Promise<RestoreOutcome>
  /**
   * 保存当前的 head。
   *
   * `idempotencyKey` 让"同一份内容重试"落到同一条提交记录上；
   * 内容与上次成功保存的**逐字相同**时直接复用上一次的回执（连 IPC 都不发）。
   */
  save(document: GeometryDocument, actions: number): Promise<{ ok: true; generation: number } | RepositoryFailure>
  /** 换了一世（导入 / 打开文件）：作废在途保存、把新内容建为新的一版。 */
  reset(document: GeometryDocument): Promise<{ ok: true; generation: number } | RepositoryFailure>
  /** 供诊断：当前以为的 head 句柄（没有成功保存过时为 `null`）。 */
  handle(): DocumentHandle | null
}

export interface PersistenceDependencies {
  repository: DocumentRepository
  projectId: string
  /** 恢复失败时用的空文档（由 `@draw/dsl` 造，避免这里依赖它的内部形状）。 */
  emptyDocument(): GeometryDocument
  /**
   * **这一世真正会用的那个 `documentId`**（2026-09-22 修 / 外部审查 X1）。
   *
   * 恢复必须用它去探测仓储。原先这里没有这一项，`restore()` 拿 `emptyDocument()`
   * **刚生成的新随机 id** 去 `readHead` —— 而 Rust 侧按 `(project_id, document_id)` 过滤，
   * 于是**每次启动都必然 `not_found`**：`create` 一路插一行新的空文档，
   * 仓储里那份真正的内容永远读不回来（设计里"仓储才是真源"这句话因此是空的），
   * 且每次启动多一条垃圾行。同一个根因还有个用户可见后果：重启后除"上次活动"以外的
   * 工作区拿到新文档 id，而 `list_conversations` 按 document 过滤 ⇒ **会话侧栏是空的**。
   */
  documentId(): string
  now?(): number
}

/**
 * 把空文档模板的 id 换成**这一世真正会用的那个**。
 *
 * `create` 写下的那一行必须与文档自己的 id 一致 —— 否则第一次自动保存就带着
 * "文档 id ≠ 行 id"去提交，Rust 侧只会回一句 `no document …`。
 */
function withDocumentId(document: GeometryDocument, documentId: string): GeometryDocument {
  return { ...document, metadata: { ...document.metadata, id: documentId } }
}

/** 由仓储的 head 造一个句柄。**epoch 与会话内默认值不同**，所以必须显式带上。 */
export function handleFromSnapshot(snapshot: DocumentSnapshot): DocumentHandle {
  return {
    projectId: snapshot.projectId,
    documentId: snapshot.documentId,
    workspace: (JSON.parse(snapshot.content) as GeometryDocument).workspace as DocumentHandle["workspace"],
    epoch: snapshot.epoch,
    generation: snapshot.generation,
    contentHash: snapshot.contentHash
  }
}

export function createDocumentPersistence(dependencies: PersistenceDependencies): DocumentPersistence {
  const { repository, projectId } = dependencies
  let head: DocumentHandle | null = null
  // Each workspace owns a different document. Never borrow another document's CAS head.
  const heads = new Map<string, DocumentHandle>()
  type SaveResult = { ok: true; generation: number } | RepositoryFailure
  const saveQueues = new Map<string, Promise<SaveResult>>()
  function remember(snapshot: DocumentSnapshot): DocumentHandle {
    head = handleFromSnapshot(snapshot)
    heads.set(head.documentId, head)
    return head
  }
  /** Each document has its own import era; unrelated workspace saves remain valid. */
  const eras = new Map<string, number>()
  const eraOf = (documentId: string) => eras.get(documentId) ?? 0

  async function restore(): Promise<RestoreOutcome> {
    /**
     * **探测用的是"这一世真正会用的 id"**，不是刚生成的新随机 id（见 `documentId` 的注释）。
     * 空文档也用同一个 id 造出来，于是"库里没有"时的 `create` 写下的行与文档对得上。
     */
    const fresh = withDocumentId(dependencies.emptyDocument(), dependencies.documentId())
    // Startup and lazy hydration share the same workspace-scoped lookup. A lost
    // browser id must never adopt another workspace's globally newest document.
    const restored = await restoreWorkspace(fresh.workspace, fresh.metadata.id)
    if (!restored.created) return restored
    if (restored.failure) return restored
    const created = await repository.create(projectId, restored.document)
    if (!created.ok) return { ...restored, failure: created }
    remember(created.value)
    return restored
  }

  async function restoreWorkspace(workspace: Workspace, documentId?: string): Promise<RestoreOutcome> {
    let fresh = createEmptyDocument(workspace)
    if (documentId) fresh = withDocumentId(fresh, documentId)
    const decode = (snapshot: DocumentSnapshot): RestoreOutcome => {
      const document = documentFromSnapshot(snapshot)
      if (!document || document.workspace !== workspace) {
        return { document: fresh, created: true, failure: { ok: false, code: "io", detail: "stored workspace document could not be parsed" } }
      }
      remember(snapshot)
      return { document, created: false }
    }
    if (documentId) {
      const found = await repository.readHead(projectId, documentId)
      if (found.ok) {
        const document = documentFromSnapshot(found.value)
        if (!document) return decode(found.value)
        if (document.workspace === workspace) return decode(found.value)
        // The remembered id is already owned by a different workspace. Never
        // create or subsequently autosave a fresh document under that identity.
        fresh = createEmptyDocument(workspace)
      } else if (found.code !== "not_found") return { document: fresh, created: true, failure: found }
    }
    const latest = await repository.readLatestHead(projectId, workspace)
    if (!latest.ok) return { document: fresh, created: true, failure: latest }
    return latest.value ? decode(latest.value) : { document: fresh, created: true }
  }

  function superseded(documentId: string): SaveResult {
    return { ok: true, generation: heads.get(documentId)?.generation ?? 0 }
  }

  async function saveNow(document: GeometryDocument, actions: number, epochAtStart: number): Promise<SaveResult> {
    if (epochAtStart !== eraOf(document.metadata.id)) return superseded(document.metadata.id)
    const fingerprint = contentFingerprint(document)
    let expected = heads.get(document.metadata.id)
    if (!expected) {
      // A new workspace may be new to this adapter but already present on disk.
      const found = await repository.readHead(projectId, document.metadata.id)
      if (epochAtStart !== eraOf(document.metadata.id)) return superseded(document.metadata.id)
      if (found.ok) {
        const stored = documentFromSnapshot(found.value)
        if (!stored || stored.workspace !== document.workspace) return workspaceConflict()
        expected = remember(found.value)
      } else if (found.code === "not_found") {
        const created = await repository.create(projectId, document)
        if (epochAtStart !== eraOf(document.metadata.id)) return superseded(document.metadata.id)
        if (!created.ok) return created
        remember(created.value)
        return { ok: true, generation: created.value.generation }
      } else return found
    }
    if (expected.workspace !== document.workspace) return workspaceConflict()
    if (fingerprint === expected.contentHash) {
      head = expected
      return { ok: true, generation: expected.generation }
    }

    const receipt = await repository.commit(projectId, document, expected, actions)
    // Import/reset invalidates successes AND failures from the preceding era.
    if (epochAtStart !== eraOf(document.metadata.id)) return superseded(document.metadata.id)
    if (!receipt.ok) {
      if (receipt.code === "stale_head") {
        const latest = await repository.readHead(projectId, document.metadata.id)
        if (epochAtStart !== eraOf(document.metadata.id)) return superseded(document.metadata.id)
        if (latest.ok && latest.value.contentHash === fingerprint) {
          remember(latest.value)
          return { ok: true, generation: latest.value.generation }
        }
        // A different external head remains an unresolved conflict, including for queued edits.
      }
      return receipt
    }

    head = { ...expected, generation: receipt.value.outcome.generation, contentHash: fingerprint }
    heads.set(head.documentId, head)
    return { ok: true, generation: receipt.value.outcome.generation }
  }

  function save(document: GeometryDocument, actions: number): Promise<SaveResult> {
    const epochAtStart = eraOf(document.metadata.id)
    const previous = saveQueues.get(document.metadata.id)
    // Rapid edits must not race the first create or reuse the same CAS generation.
    // A different workspace remains independent; reset never waits for a stuck save.
    const run = () => saveNow(document, actions, epochAtStart)
    const pending = previous ? previous.then(run, run) : run()
    trackSave(document.metadata.id, pending)
    return pending
  }

  function trackSave(documentId: string, pending: Promise<SaveResult>): void {
    saveQueues.set(documentId, pending)
    void pending.finally(() => {
      if (saveQueues.get(documentId) === pending) saveQueues.delete(documentId)
    }).catch(() => {})
  }

  function reset(document: GeometryDocument): Promise<SaveResult> {
    // Supersede only this document, without waiting for its old in-flight saves.
    const era = eraOf(document.metadata.id) + 1
    eras.set(document.metadata.id, era)
    saveQueues.delete(document.metadata.id)
    const pending = resetNow(document, era)
    // New edits wait for this import, not for superseded old saves.
    trackSave(document.metadata.id, pending)
    return pending
  }

  function workspaceConflict(): RepositoryFailure {
    return { ok: false, code: "stale_head", detail: "document id belongs to another workspace; refusing to overwrite it" }
  }

  async function resetNow(document: GeometryDocument, epochAtStart: number): Promise<SaveResult> {
    const existing = await repository.readHead(projectId, document.metadata.id)
    if (epochAtStart !== eraOf(document.metadata.id)) return superseded(document.metadata.id)
    if (existing.ok) {
      const stored = documentFromSnapshot(existing.value)
      if (!stored || stored.workspace !== document.workspace) return workspaceConflict()
    } else if (existing.code !== "not_found") return existing
    /**
     * **走 `replaceEpoch` 而不是"删掉再建"或"当成一次普通提交"。**
     *
     * 第一版把它实现成"先试 `create`，撞到已存在就退化成普通提交" —— 结果是：
     * ①已存在时**改不了 epoch**，于是换世之后在途的旧保存仍然能写进来（那条状态被测试抓到了，
     * 表现为用例挂死：`reset` 内部退化成了一次普通的 `commit`）；
     * ②"打开文件"这条路径在语义上根本不是"创建"，用 `create` 去表达它必然要处理一堆反例。
     */
    const replaced = await repository.replaceEpoch(projectId, document)
    if (epochAtStart !== eraOf(document.metadata.id)) return superseded(document.metadata.id)
    if (replaced.ok) {
      remember(replaced.value)
      return { ok: true, generation: replaced.value.generation }
    }
    // 库里还没有这份文档（用户打开的文件是全新的）：那就建出来。
    if (replaced.code === "not_found") {
      const created = await repository.create(projectId, document)
      if (epochAtStart !== eraOf(document.metadata.id)) return superseded(document.metadata.id)
      if (!created.ok) return created
      remember(created.value)
      return { ok: true, generation: created.value.generation }
    }
    return replaced
  }

  return {
    restore,
    restoreWorkspace,
    save,
    reset,
    handle: () => head
  }
}

export { classifyRepositoryError }

