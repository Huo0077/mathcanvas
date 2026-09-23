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

import type { GeometryDocument } from "@draw/dsl"
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
  /** 上一次**成功**保存的内容指纹。相同的内容不再发 IPC。 */
  let lastSavedFingerprint: string | null = null
  /** 换了一世之后自增：在途的保存用**发起时**的值比对，不符就丢弃结果。 */
  let generation = 0

  async function restore(): Promise<RestoreOutcome> {
    /**
     * **探测用的是"这一世真正会用的 id"**，不是刚生成的新随机 id（见 `documentId` 的注释）。
     * 空文档也用同一个 id 造出来，于是"库里没有"时的 `create` 写下的行与文档对得上。
     */
    const fresh = withDocumentId(dependencies.emptyDocument(), dependencies.documentId())
    const found = await repository.readHead(projectId, fresh.metadata.id)
    if (found.ok) {
      const document = documentFromSnapshot(found.value)
      if (document) {
        head = handleFromSnapshot(found.value)
        lastSavedFingerprint = found.value.contentHash
        return { document, created: false }
      }
      // 快照里存的不是文档：**如实说**，但给出一份可用的空文档（不能让用户卡在启动上）。
      return { document: fresh, created: true, failure: { ok: false, code: "io", detail: "the stored document could not be parsed; starting from an empty one" } }
    }
    /**
     * **没有桌面外壳时不再尝试 `create`**。
     *
     * 第一版把 `not_a_desktop_shell` 与 `not_found` 合并处理，于是浏览器里会再发一次
     * `create_document` —— 一次注定失败的 IPC。更糟的是：真实实现里那次调用会走到
     * "文档已存在"或"没有原生侧"两条不同的错误上，**报出来的原因会变成另一个**，
     * 用户看到的就不再是"需要桌面版"。
     *
     * 这一条必须排在下面两个分支**之前**：网页版的行为要与加这个功能之前完全一样
     * （不能因为新增了"读最新一份"的回退，就在浏览器里多发一次注定失败的 IPC）。
     */
    if (found.code === "not_a_desktop_shell") {
      return { document: fresh, created: true, failure: found }
    }
    if (found.code === "not_found") {
      /**
       * **本地记不住 id ≠ 库里没有这份文档**（2026-09-22 修 / 外部审查 X1 的第二半）。
       *
       * localStorage 被清掉、换了台机器、或者旧版本已经把 id 弄丢过 —— 这些都只说明
       * "本地没记住用哪份文档"，而仓储里那份内容还在。设计里"仓储是权威那一层"
       * 要求这里回退到**项目里最新的那一份**，而不是立刻当作用户第一次运行。
       *
       * 只有项目里真的一份文档都没有时，`not_found` 才是"首次启动"。
       */
      const latest = await repository.readLatestHead(projectId)
      if (latest.ok && latest.value !== null) {
        const document = documentFromSnapshot(latest.value)
        if (document) {
          head = handleFromSnapshot(latest.value)
          lastSavedFingerprint = latest.value.contentHash
          return { document, created: false }
        }
      }
      // `not_found` 且项目里空无一物：**首次启动的正常状态**，还没保存过任何东西。
      const created = await repository.create(projectId, fresh)
      if (created.ok) {
        head = handleFromSnapshot(created.value)
        lastSavedFingerprint = created.value.contentHash
        return { document: fresh, created: true }
      }
      return { document: fresh, created: true, failure: created }
    }
    // 别的失败（IO / 权限）：仍然给出一份可用的文档，并如实带出原因。
    return { document: fresh, created: true, failure: found }
  }

  async function save(document: GeometryDocument, actions: number): Promise<{ ok: true; generation: number } | RepositoryFailure> {
    const fingerprint = contentFingerprint(document)
    // 内容没变：**连 IPC 都不发**。这是高频路径上最省的一次挡。
    if (lastSavedFingerprint !== null && fingerprint === lastSavedFingerprint && head) {
      return { ok: true, generation: head.generation }
    }
    if (!head) {
      const created = await repository.create(projectId, document)
      if (!created.ok) return created
      head = handleFromSnapshot(created.value)
      lastSavedFingerprint = created.value.contentHash
      return { ok: true, generation: created.value.generation }
    }

    const epochAtStart = generation
    const expected = head
    const receipt = await repository.commit(projectId, document, expected, actions)
    if (!receipt.ok) {
      /**
       * `stale_head` 分两种，处理**不同**：
       * - 内容其实没变（别人只是又存了一遍）→ 重新读 head 并当成成功（用户的改动已经在库里了）；
       * - 内容变了 → 如实把冲突交给调用方（它要决定是"重新读一遍再保存"还是"让用户选"）。
       */
      if (receipt.code === "stale_head") {
        const latest = await repository.readHead(projectId, document.metadata.id)
        if (latest.ok) {
          if (latest.value.contentHash === fingerprint) {
            head = handleFromSnapshot(latest.value)
            lastSavedFingerprint = fingerprint
            return { ok: true, generation: latest.value.generation }
          }
          head = handleFromSnapshot(latest.value)
        }
      }
      return receipt
    }

    // 换了一世之后回来的结果一律丢弃：那是"上一次编辑"的保存，不该决定现在的 head。
    if (epochAtStart !== generation) return { ok: true, generation: head?.generation ?? expected.generation }

    if (receipt.value.outcome.kind === "committed" || receipt.value.outcome.kind === "replayed") {
      head = { ...expected, generation: receipt.value.outcome.generation, contentHash: receipt.value.outcome.contentHash }
    }
    lastSavedFingerprint = fingerprint
    return { ok: true, generation: receipt.value.outcome.generation }
  }

  async function reset(document: GeometryDocument): Promise<{ ok: true; generation: number } | RepositoryFailure> {
    // 换了一世：在途的保存从这一刻起全部作废。
    generation += 1
    /**
     * **走 `replaceEpoch` 而不是"删掉再建"或"当成一次普通提交"。**
     *
     * 第一版把它实现成"先试 `create`，撞到已存在就退化成普通提交" —— 结果是：
     * ①已存在时**改不了 epoch**，于是换世之后在途的旧保存仍然能写进来（那条状态被测试抓到了，
     * 表现为用例挂死：`reset` 内部退化成了一次普通的 `commit`）；
     * ②"打开文件"这条路径在语义上根本不是"创建"，用 `create` 去表达它必然要处理一堆反例。
     */
    const replaced = await repository.replaceEpoch(projectId, document)
    if (replaced.ok) {
      head = handleFromSnapshot(replaced.value)
      lastSavedFingerprint = replaced.value.contentHash
      return { ok: true, generation: replaced.value.generation }
    }
    // 库里还没有这份文档（用户打开的文件是全新的）：那就建出来。
    if (replaced.code === "not_found") {
      const created = await repository.create(projectId, document)
      if (!created.ok) return created
      head = handleFromSnapshot(created.value)
      lastSavedFingerprint = created.value.contentHash
      return { ok: true, generation: created.value.generation }
    }
    return replaced
  }

  return {
    restore,
    save,
    reset,
    handle: () => head
  }
}

export { classifyRepositoryError }

