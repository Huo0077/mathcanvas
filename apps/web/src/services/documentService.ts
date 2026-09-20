import type { GeometryDocument, Workspace } from "@draw/dsl"
import { contentFingerprint, createDocumentHandle, type DocumentHandle } from "@draw/scene-graph"

/**
 * **文档写入服务**（Task 0.7）：所有写入都必须走 Compare-and-Swap。
 *
 * 四道闸，顺序固定（先易后难、先便宜后昂贵）：
 * 1. `document_mismatch` —— 候选与句柄不是同一份文档；
 * 2. `stale_epoch` —— 期间发生过导入/替换（epoch 变了，授权作废）；
 * 3. `stale_generation` —— 期间用户又改过（含撤销/重做，它们也产生新 generation）；
 * 4. `stale_content` —— 内容已经不是句柄那一版（**ABA**：撤销让内容看起来"回来了"，
 *    但那一版授权不该复活，所以再用内容哈希校一次）。
 *
 * 关键性质：**过期候选永远不调用 `port.replace`** —— 这是计划 Step 1 明确要断言的那一条。
 */

export interface DocumentPort {
  /** 当前活跃文档；`null` 表示当前工作区没有文档。 */
  current(): { workspace: Workspace; document: GeometryDocument } | null
  /**
   * 当前 epoch；返回 `undefined` 表示"由文档 id 派生"（默认情形）。
   * **由端口给出**而不是从文档推导：导入/替换可能保持同一个 `metadata.id`
   * 而整体换掉内容，只有上层服务知道"这一世"变了。
   */
  epoch?(): string | undefined
  /** 真实替换（zustand store 的 `replace`）。只有过了全部校验才会被调用。 */
  replace(candidate: GeometryDocument): void
}

export interface CommitReceipt {
  ok: boolean
  reason?: "document_mismatch" | "stale_epoch" | "stale_generation" | "stale_content" | "no_current_document"
  detail?: string
}

export interface DocumentService {
  /** 为**当前**活跃文档取一份句柄；没有活跃文档时返回 null。 */
  readHandle(projectId: string): DocumentHandle | null
  /** 以句柄为预期值提交候选文档。 */
  commit(candidate: GeometryDocument, expected: DocumentHandle): CommitReceipt
}

export function createDocumentService(port: DocumentPort): DocumentService {
  return {
    readHandle(projectId) {
      const current = port.current()
      return current ? createDocumentHandle(current.document, projectId, port.epoch?.()) : null
    },
    commit(candidate, expected) {
      const current = port.current()
      if (!current) return { ok: false, reason: "no_current_document", detail: "there is no active document to commit into" }

      // 1. 候选必须属于句柄所指的那份文档。
      if (candidate.metadata.id !== expected.documentId) {
        return { ok: false, reason: "document_mismatch", detail: `candidate belongs to ${candidate.metadata.id}, not ${expected.documentId}` }
      }

      const live = createDocumentHandle(current.document, expected.projectId, port.epoch?.())
      // 2. epoch：导入/替换之后，旧句柄的授权一律作废（内容一样也不行）。
      if (live.epoch !== expected.epoch) {
        return { ok: false, reason: "stale_epoch", detail: `epoch moved from ${expected.epoch} to ${live.epoch}` }
      }
      // 3. generation：撤销/重做也算新 generation，所以这里能挡住"退回旧版本再提交"。
      if (live.generation !== expected.generation) {
        return { ok: false, reason: "stale_generation", detail: `generation moved from ${expected.generation} to ${live.generation}` }
      }
      // 4. 内容哈希：ABA 的最后一道闸 —— 内容必须是句柄当时那一版。
      if (contentFingerprint(current.document) !== expected.contentHash) {
        return { ok: false, reason: "stale_content", detail: "the document content no longer matches the handle" }
      }

      port.replace(candidate)
      return { ok: true }
    }
  }
}
