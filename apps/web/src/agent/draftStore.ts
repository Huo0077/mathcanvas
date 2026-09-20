import type { GeometryDocument } from "@draw/dsl"
import { canonicalContentHash } from "@draw/agent-core"
import {
  applyOperation,
  compileActions,
  createIdAllocator,
  validatePatch,
  type DocumentHandle,
  type DomainOperation
} from "@draw/scene-graph"

import type { DraftAction, IdAllocator } from "@draw/scene-graph"

/**
 * **隔离草稿**（Task 0.7 Step 4）。
 *
 * 计划要守的性质：
 * - 候选文档在**内存里**克隆与校验，草稿只保留 draft id + 预览产物；
 * - **任何草稿操作都不更新 `useSceneStore`** —— 谁都不能在草稿阶段改到真文档；
 * - `stage` 必须带**期望草稿版本**：拿旧版本号再暂存会被拒（否则会静默覆盖更新的暂存）；
 * - 预览哈希随内容变化，它是后续 consent 的绑定对象（Task 0.8）。
 *
 * ## `previewHash` 用哪一个哈希（2026-09-21 修正）
 *
 * 原先这里是 `contentFingerprint(候选文档)` —— 那个函数返回的是**规范化 JSON 字符串**，
 * 不是哈希。它被当成哈希用之后有两条后果：契约（`ConsentRecord.previewHash`）与实际不符；
 * 以及确认面板第一版把它渲染出来时**整份候选文档被打在界面上**（见 `ConfirmationPanel.tsx`）。
 * 现在改用 `@draw/agent-core` 的 `canonicalContentHash`（SHA-256，64 位十六进制）。
 *
 * **与 `contentFingerprint` 的分工仍然保留**，两者不是重复实现：
 * - `contentFingerprint` 是 scene-graph 内部的**语义等价**判据（递归剔掉 `revision` / `updatedAt`、
 *   把 `visible: true` 视同缺省），用于 `SourceContext` 的"来源是否过期"与 CAS 比较；
 *   它住在 scene-graph 里是因为 agent-core 依赖 scene-graph，反向导入会成环。
 * - `canonicalContentHash` 是给**对外契约**用的真哈希（排序键 + 剔除视图/时间字段 + SHA-256），
 *   任何要"写进凭据、写进记录、或必须固定长度"的地方都用它。
 */

export interface DraftRecord {
  draftId: string
  /** 每次成功 `stage` 递增；下一次 `stage` 必须带这个值。 */
  draftVersion: number
  /** 克隆自基础文档的候选：**隔离副本**，调用方拿不到基础文档的引用。 */
  candidate: GeometryDocument
  /** 已暂存的动作（面向用户/重试的原始形式）。 */
  operations: DraftAction[]
  /** `stage` 时编译出来的**领域操作**：提交时重放的是它，而不是原始动作。 */
  compiledOperations: DomainOperation[]
  /**
   * **草稿级** id 分配器。
   *
   * 必须跨 `stage` 持久：每次 `stage` 新建一个分配器会让 id 从 1 重新开始，
   * 于是同一草稿的第二次暂存分配出 `point-1`（候选里已经有了）→ 被 `validatePatch`
   * 判为重复 id → `compile_failed`，用户看到的却是"暂存成功但内容没变"。
   * （这个缺陷是被 `stale_preview` 那条用例逼出来的：它需要第二次暂存真的生效。）
   */
  allocator: IdAllocator
  /** 创建草稿时的基础句柄；用于 `assertFresh` 判断"基础是否已被改过"。 */
  baseHandle?: DocumentHandle
}

export interface DraftPreview {
  draftId: string
  draftVersion: number
  candidate: GeometryDocument
  /** 预览内容哈希：`stage` 与失效都会改变它。 */
  previewHash: string
  stageCount: number
  /**
   * `stage` 时编译出来的**领域操作**。提交方在当前活跃文档上重放的是它 ——
   * 不是 `DraftAction`（那是动作层的形状，`commitTransaction` 会判它 `unknown operation`）。
   */
  operations: DomainOperation[]
}

export type StageReason = "unknown_draft" | "stale_draft_version" | "compile_failed"

export type StageResult =
  | { ok: true; preview: DraftPreview }
  | { ok: false; reason: StageReason; diagnostics?: { code: string; message: string }[]; detail?: string }

export type FreshnessResult = { ok: true } | { ok: false; reason: "stale_source"; detail: string }

export interface DraftStore {
  create(base: GeometryDocument, baseHandle?: DocumentHandle): DraftRecord
  stage(draftId: string, actions: DraftAction[], expectedDraftVersion: number): StageResult
  /** 基础文档变了（手工编辑、撤销、切工作区）→ 草稿过期，不能再提交。 */
  assertFresh(draftId: string, liveHandle: DocumentHandle): FreshnessResult
  invalidate(draftId: string, reason: string): void
  getPreview(draftId: string): DraftPreview | null
}

let draftCounter = 0

function cloneDocument(document: GeometryDocument): GeometryDocument {
  // 结构化克隆：草稿与真文档之间不能共享任何可变对象。
  return structuredClone(document) as GeometryDocument
}

export function createDraftStore(allocatorFactory: () => IdAllocator = createIdAllocator): DraftStore {
  const drafts = new Map<string, DraftRecord>()
  const invalidated = new Map<string, string>()

  const previewOf = (record: DraftRecord): DraftPreview => ({
    draftId: record.draftId,
    draftVersion: record.draftVersion,
    candidate: cloneDocument(record.candidate),
    previewHash: canonicalContentHash(record.candidate),
    stageCount: record.operations.length,
    operations: [...record.compiledOperations]
  })

  return {
    create(base, baseHandle) {
      draftCounter += 1
      const draftId = `draft_${draftCounter}`
      const candidate = cloneDocument(base)
      const record: DraftRecord = { draftId, draftVersion: 1, candidate, operations: [], compiledOperations: [], allocator: allocatorFactory(), baseHandle }
      drafts.set(draftId, record)
      return { ...record, candidate: cloneDocument(record.candidate) }
    },

    stage(draftId, actions, expectedDraftVersion) {
      const record = drafts.get(draftId)
      if (!record) return { ok: false, reason: "unknown_draft", detail: `no draft ${draftId}` }
      if (record.draftVersion !== expectedDraftVersion) {
        return { ok: false, reason: "stale_draft_version", detail: `draft is at version ${record.draftVersion}, not ${expectedDraftVersion}` }
      }

      // 在**候选副本**上编译与执行：草稿阶段绝不写真文档。
      const working = cloneDocument(record.candidate)
      const compiled = compileActions(working, actions, {
        targetDocument: working,
        targetWorkspace: working.workspace,
        orderedSelection: [],
        capabilityRevision: "draft",
        idAllocator: record.allocator
      })
      if (compiled.diagnostics.length > 0) {
        // 编译失败时草稿保持原样 —— 不留"半成品"。
        return { ok: false, reason: "compile_failed", diagnostics: compiled.diagnostics.map((entry) => ({ code: entry.code, message: entry.message })) }
      }

      // 逐笔执行，用返回值替换当前候选（`applyOperation` 是不可变更新）。
      let cursor: GeometryDocument = working
      for (const operation of compiled.operations) {
        const applied = applyToCandidate(cursor, operation)
        if (applied.error) return { ok: false, reason: "compile_failed", detail: applied.error }
        cursor = applied.next ?? cursor
      }

      record.candidate = cursor
      record.operations = [...record.operations, ...actions]
      record.compiledOperations = [...record.compiledOperations, ...compiled.operations]
      record.draftVersion += 1
      return { ok: true, preview: previewOf(record) }
    },

    assertFresh(draftId, liveHandle) {
      const record = drafts.get(draftId)
      if (!record) return { ok: false, reason: "stale_source", detail: `no draft ${draftId}` }
      if (invalidated.has(draftId)) return { ok: false, reason: "stale_source", detail: `draft was invalidated: ${invalidated.get(draftId)}` }
      if (!record.baseHandle) return { ok: true }
      if (record.baseHandle.epoch !== liveHandle.epoch) return { ok: false, reason: "stale_source", detail: "the document was replaced since the draft was created" }
      if (record.baseHandle.generation !== liveHandle.generation) return { ok: false, reason: "stale_source", detail: "the document changed since the draft was created" }
      if (record.baseHandle.contentHash !== liveHandle.contentHash) return { ok: false, reason: "stale_source", detail: "the document content changed since the draft was created" }
      return { ok: true }
    },

    invalidate(draftId, reason) {
      invalidated.set(draftId, reason)
      drafts.delete(draftId)
    },

    getPreview(draftId) {
      const record = drafts.get(draftId)
      return record ? previewOf(record) : null
    }
  }
}

/**
 * 在候选文档上执行一笔操作。
 *
 * 刻意走**与 `commitTransaction` 同一套**校验与执行路径（`validatePatch` + `applyOperation`），
 * 而不是自己写一遍"草稿版执行"——两份实现必然漂移。
 * `applyOperation` 返回新文档（不可变更新），所以把结果对象直接换给调用方。
 */
function applyToCandidate(candidate: GeometryDocument, operation: DomainOperation): { next?: GeometryDocument; error?: string } {
  const validation = validatePatch(candidate, operation)
  if (!validation.valid) return { error: validation.errors.join(", ") }
  const applied = applyOperation(candidate, operation)
  if (applied.error) return { error: applied.error }
  return { next: applied.document }
}
