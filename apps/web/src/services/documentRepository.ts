/**
 * **项目仓储客户端**（Task 1.6 的前端那一半）。
 *
 * 计划原文要求 `documentService` 接到仓储上。这一层就是那座桥：
 * 把 Rust 侧的事务性存储（SQLite + CAS + 幂等）包装成前端能用的形状。
 *
 * ## 三条纪律
 *
 * 1. **内容哈希在前端算**。规则在 `scene-graph` 的 `contentFingerprint` 里
 *    （剔掉 `revision` / `updatedAt`、`visible: true` 视同缺省）。在 Rust 里再实现一遍
 *    必然分叉，而分叉的后果是**同一份文档有两个哈希** —— CAS 会永远失败，
 *    且看起来像"并发冲突"，排查方向完全被带偏。
 * 2. **幂等键由调用方给，且必须稳定**。`idempotencyKey(runId, contentHash)` 是纯函数：
 *    同一件事重算得到同一把键。这样"网络重试"与"用户点了两次"都落到同一条记录上，
 *    而不会推进两次 generation。
 * 3. **失败要分成能照做的类别**。`not_a_desktop_shell` 是"这是浏览器，去装桌面版"；
 *    `stale_head` 是"别人改过了，重新读一遍再保存"；两者混成一句"保存失败"
 *    会让用户去重试一件永远不会成功的事。
 */

import type { GeometryDocument } from "@draw/dsl"
import { contentFingerprint, createDocumentHandle, type DocumentHandle } from "@draw/scene-graph"

export interface DocumentSnapshot {
  projectId: string
  documentId: string
  epoch: string
  generation: number
  contentHash: string
  content: string
  updatedAt: number
}

export type CommitOutcome =
  | { kind: "committed"; generation: number; contentHash: string }
  | { kind: "unchanged"; generation: number }
  | { kind: "replayed"; generation: number; contentHash: string }

export interface CommitReceipt {
  idempotencyKey: string
  outcome: CommitOutcome
  committedAt: number
}

export type RepositoryFailure =
  /** 在浏览器里跑：没有原生侧。**正常状态**，不是错误。 */
  | { ok: false; code: "not_a_desktop_shell"; detail: string }
  /** 库里没有这份文档（第一次保存走这里）。 */
  | { ok: false; code: "not_found"; detail: string }
  /** 别人改过了（或 epoch 变了）：重新读一遍再保存。 */
  | { ok: false; code: "stale_head"; detail: string }
  /** 同一把幂等键配了不同的候选：那是两次不同的提交用了同一把键。 */
  | { ok: false; code: "idempotency_conflict"; detail: string }
  | { ok: false; code: "io"; detail: string }

export type RepositoryResult<T> = { ok: true; value: T } | RepositoryFailure

/**
 * **幂等键**：同一件事重算得到同一把键。
 *
 * 判据是"**这次提交是什么**"（文档 + 内容哈希），不是"什么时候发的"——
 * 带时间戳的键会让重试变成一次新提交，而幂等键的全部价值就在于让重试**不是**新提交。
 */
export function idempotencyKey(documentId: string, contentHash: string): string {
  return `${documentId}@${contentHash}`
}

/** 把 IPC 抛出来的错误按**能照做的类别**切开。 */
export function classifyRepositoryError(error: unknown): RepositoryFailure {
  const detail = error instanceof Error ? error.message : String(error)
  if (error instanceof Error && error.name === "NoDesktopShellError") {
    return { ok: false, code: "not_a_desktop_shell", detail: "文档持久化需要桌面版（Windows 应用）；当前在浏览器里运行，改动只保留在会话内。" }
  }
  // Rust 侧的错误是 `Display` 出来的英文句子；按关键词分类（而不是按字符串全等，
  // 因为句子里带上了具体的版本号与 id）。
  if (/no document |no snapshot /i.test(detail)) return { ok: false, code: "not_found", detail }
  if (/already exists|generation|epoch|content changed underneath/i.test(detail)) return { ok: false, code: "stale_head", detail }
  if (/idempotency key/i.test(detail)) return { ok: false, code: "idempotency_conflict", detail }
  return { ok: false, code: "io", detail }
}

export interface DocumentRepository {
  /** 读一份文档的 head；不存在时回 `not_found`。 */
  readHead(projectId: string, documentId: string): Promise<RepositoryResult<DocumentSnapshot>>
  /** 首次写入。 */
  create(projectId: string, document: GeometryDocument): Promise<RepositoryResult<DocumentSnapshot>>
  /**
   * 提交一次改动。
   *
   * `expected` 是调用方以为的 head（CAS 的三个判据都在里面）——
   * 交给这个函数而不是由它自己读，是为了让"读—改—写"这条链上的**竞态**能被上层看见。
   */
  commit(projectId: string, document: GeometryDocument, expected: DocumentHandle, actions: number): Promise<RepositoryResult<CommitReceipt>>
  /** 按幂等键查提交状态（"已提交但响应丢了"）。 */
  lookup(idempotencyKey: string): Promise<RepositoryResult<CommitReceipt | null>>
  /**
   * **换一世**：导入 / 打开文件之后换掉 epoch 并写入新内容。
   *
   * 这是一个**独立**的原语，不是"删掉再建"也不是"当成一次普通提交"：
   * 删掉再建会丢历史（而"打开文件之后还能撤销回去"是这条路径的应有之义）；
   * 当成普通提交则改不了 epoch，于是在途的旧保存仍然能写进来 ——
   * 用户刚打开的文档会被上一次编辑覆盖。epoch 一变，在途请求的 CAS 立刻失败。
   */
  replaceEpoch(projectId: string, document: GeometryDocument): Promise<RepositoryResult<DocumentSnapshot>>
  /** 读历史里某一版。 */
  readSnapshot(projectId: string, documentId: string, generation: number): Promise<RepositoryResult<DocumentSnapshot>>
  historyLength(projectId: string, documentId: string): Promise<RepositoryResult<number>>
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

export function createDocumentRepository(invoke: Invoke): DocumentRepository {
  async function call<T>(command: string, args: Record<string, unknown>): Promise<RepositoryResult<T>> {
    try {
      return { ok: true, value: (await invoke(command, args)) as T }
    } catch (error) {
      return classifyRepositoryError(error)
    }
  }

  return {
    readHead: (projectId, documentId) => call<DocumentSnapshot>("read_document_head", { projectId, documentId }),

    create: (projectId, document) =>
      call<DocumentSnapshot>("create_document", {
        projectId,
        documentId: document.metadata.id,
        epoch: `epoch:${document.metadata.id}`,
        content: JSON.stringify(document),
        contentHash: contentFingerprint(document)
      }),

    commit: (projectId, document, expected, actions) =>
      call<CommitReceipt>("commit_document", {
        idempotencyKey: idempotencyKey(document.metadata.id, contentFingerprint(document)),
        projectId,
        documentId: document.metadata.id,
        expectedEpoch: expected.epoch,
        expectedGeneration: expected.generation,
        expectedContentHash: expected.contentHash,
        content: JSON.stringify(document),
        contentHash: contentFingerprint(document),
        actions
      }),

    lookup: (key) => call<CommitReceipt | null>("lookup_commit", { idempotencyKey: key }),

    replaceEpoch: (projectId, document) =>
      call<DocumentSnapshot>("replace_document_epoch", {
        projectId,
        documentId: document.metadata.id,
        // 新的一世用**内容哈希**当 epoch 的一部分：同一份文件再次打开时 epoch 会相同，
        // 于是"重复打开同一份文件"不会白白作废在途请求。
        epoch: `epoch:${document.metadata.id}:${contentFingerprint(document)}`,
        content: JSON.stringify(document),
        contentHash: contentFingerprint(document)
      }),

    readSnapshot: (projectId, documentId, generation) => call<DocumentSnapshot>("read_document_snapshot", { projectId, documentId, generation }),
    historyLength: (projectId, documentId) => call<number>("document_history_length", { projectId, documentId })
  }
}

/**
 * **把一份快照还原成文档**。
 *
 * 单独一个函数而不是在调用点 `JSON.parse`：快照里的 `generation` 是**仓储的**
 * 版本号，而文档里的 `revision` 是**文档自己的**。两者不该被混为一谈 ——
 * 这里明确"文档就用快照里存下来的那一份"，仓储的 generation 只用来做 CAS。
 */
export function documentFromSnapshot(snapshot: DocumentSnapshot): GeometryDocument | null {
  try {
    const parsed = JSON.parse(snapshot.content) as GeometryDocument
    if (!parsed || typeof parsed !== "object" || !parsed.metadata) return null
    return parsed
  } catch {
    return null
  }
}

/** 为一份文档造句柄（**现取**：句柄里的哈希就是 CAS 的依据）。 */
export function handleFor(projectId: string, document: GeometryDocument, epoch?: string): DocumentHandle {
  return createDocumentHandle(document, projectId, epoch)
}
