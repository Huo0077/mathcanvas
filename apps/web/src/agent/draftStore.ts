import type { GeometryDocument } from "@draw/dsl"
import { canonicalContentHash, compilePlan, PLAN_SCHEMA_VERSION, type PlanEnvelope, type StructuredAssumption } from "@draw/agent-core"
import { createIdAllocator, type DocumentHandle } from "@draw/scene-graph"

import type { DraftAction, DomainOperation, IdAllocator } from "@draw/scene-graph"

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
  /** 编译期补全出来的假设（跨 `stage` 累积，随预览回带）。 */
  completionAssumptions: StructuredAssumption[]
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
  /**
   * **这一批补全出来的假设**（缺省字段的默认值、欠定特值）。
   *
   * 为什么要由草稿带着它：补全发生在**编译期**，而用户是在看到确认面板时才知道
   * "系统替他定了什么"。运行时的 `assumptions()` 只有规划器声明的那几条，
   * 少掉编译期补出来的这些，用户就会确认一件他没看过的事。
   */
  completionAssumptions: StructuredAssumption[]
}

export type StageReason = "unknown_draft" | "stale_draft_version" | "compile_failed"

export type StageResult =
  | { ok: true; preview: DraftPreview }
  | { ok: false; reason: StageReason; diagnostics?: { code: string; message: string }[]; detail?: string }

export type FreshnessResult = { ok: true } | { ok: false; reason: "stale_source"; detail: string }

export interface DraftStore {
  create(base: GeometryDocument, baseHandle?: DocumentHandle): DraftRecord
  /**
   * 暂存（= 编译）。第四个参数是**用户原话**（Fix round 1 / C3）：参数审计要看用户说了什么
   *（"任意/恒定/定值"必须保留符号参数、没说全的尺寸从原话里读、"采样不是证明"的披露）。
   * 可选：工具调用那条路径没有"用户原话"这种东西。
   */
  stage(draftId: string, actions: DraftAction[], expectedDraftVersion: number, userMessage?: string): StageResult
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

export function createDraftStore(allocatorFactory: (taken?: Iterable<string>) => IdAllocator = createIdAllocator): DraftStore {
  const drafts = new Map<string, DraftRecord>()
  const invalidated = new Map<string, string>()

  const previewOf = (record: DraftRecord): DraftPreview => ({
    draftId: record.draftId,
    draftVersion: record.draftVersion,
    candidate: cloneDocument(record.candidate),
    previewHash: canonicalContentHash(record.candidate),
    stageCount: record.operations.length,
    operations: [...record.compiledOperations],
    completionAssumptions: [...record.completionAssumptions]
  })

  return {
    create(base, baseHandle) {
      draftCounter += 1
      const draftId = `draft_${draftCounter}`
      const candidate = cloneDocument(base)
      /**
       * 分配器**必须知道基础文档里已有哪些 id**（2026-09-21 修）。
       *
       * 以前这里是无参的 `createIdAllocator()`：计数器从 1 开始数，于是在一个已经有
       * 手工建的 `solid-1` 的画布上，Agent 新建的第一个立体又被发成 `solid-1` →
       * `duplicate object id` → 整轮 `compile_failed`（账本 `run-6-mubf109e`）。
       * 候选里的对象要么来自基础文档（这里传进去），要么由这个分配器自己发号 —— 两者合起来
       * 就是"候选文档的 id 全集"，所以播种一次就够。
       */
      const record: DraftRecord = { draftId, draftVersion: 1, candidate, operations: [], compiledOperations: [], completionAssumptions: [], allocator: allocatorFactory(base.primitives.map((primitive) => primitive.id)), baseHandle }
      drafts.set(draftId, record)
      return { ...record, candidate: cloneDocument(record.candidate) }
    },

    stage(draftId, actions, expectedDraftVersion, userMessage) {
      const record = drafts.get(draftId)
      if (!record) return { ok: false, reason: "unknown_draft", detail: `no draft ${draftId}` }
      if (record.draftVersion !== expectedDraftVersion) {
        return { ok: false, reason: "stale_draft_version", detail: `draft is at version ${record.draftVersion}, not ${expectedDraftVersion}` }
      }

      /**
       * **编译走六层管线**（Agent DSL 切片 Task 4）。
       *
       * 以前这里是 `compileActions(working, actions)`：动作编译器逐笔对着**同一份**
       * 工作文档编，所以同一批里"先建棱柱、再在中点建点、最后作截面"这种计划
       * 在第二步就会报 `host_not_found`（它看不到同一批里前面的动作）。
       * `compilePlan` 逐笔推进工作文档，并在编译前补全缺省字段（补出来的默认值
       * 以**假设**的形式回带，见 `completionAssumptions`）。
       *
       * 分配器用的是**这份草稿自己的**那一只：跨 `stage` 幂等（同一个 alias 永远同一个 id），
       * 这正是"重试同一笔不产生两个对象"的依据。
       */
      const plan: PlanEnvelope = { schemaVersion: PLAN_SCHEMA_VERSION, kind: "plan", goal: "staged batch", factIds: [], actions }
      const compiled = compilePlan(plan, {
        document: record.candidate,
        workspace: record.candidate.workspace,
        capabilityRevision: "draft",
        conversationId: record.draftId,
        documentGeneration: record.candidate.revision,
        idAllocator: record.allocator,
        // 用户原话（Fix round 1 / C3）：符号参数判定、从原话读尺寸、采样≠证明的披露都看它。
        ...(userMessage === undefined ? {} : { prompt: userMessage })
      })
      if (!compiled.ok || compiled.draftDocument === null) {
        // 编译失败时草稿保持原样 —— 不留"半成品"。
        const diagnostics = compiled.diagnostics
          .filter((entry) => entry.severity === "error")
          // **层 + 路径 + 原因**：`stage` 以前在这里被丢掉，"卡在哪一层"就查不到了（Fix round 1 / M22）。
          .map((entry) => ({ code: entry.code, message: `${entry.stage}: ${entry.path}: ${entry.detail}` }))
        const questions = compiled.questions.map((question) => question.text)
        if (diagnostics.length === 0 && questions.length > 0) {
          return { ok: false, reason: "compile_failed", diagnostics: questions.map((text) => ({ code: "needs_more_information", message: text })) }
        }
        return { ok: false, reason: "compile_failed", ...(diagnostics.length > 0 ? { diagnostics } : {}), detail: diagnostics.length > 0 ? undefined : "the plan produced no compilable action" }
      }

      record.candidate = compiled.draftDocument
      record.operations = [...record.operations, ...actions]
      record.compiledOperations = [...record.compiledOperations, ...compiled.operations]
      /**
       * **假设要按 `id` 去重**（Fix round 1）：重复暂存同一份计划（重试 / 用户重发）会在
       * 列表里堆出多条一模一样的"我替你定了…"，而用户看到的是一列假设，重复条目只会让他
       * 以为系统定了两次。同一条假设（同 `id`）后写的那份覆盖前一份。
       */
      const merged = new Map(record.completionAssumptions.map((assumption) => [assumption.id, assumption]))
      for (const assumption of compiled.assumptions) merged.set(assumption.id, assumption)
      record.completionAssumptions = [...merged.values()]
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
