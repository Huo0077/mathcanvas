import type { GeometryDocument } from "@draw/dsl"
import { countDraftObjects, type DraftObjectCounts } from "@draw/agent-core"
import { commitTransaction, type DocumentHandle } from "@draw/scene-graph"

import type { DraftStore } from "./draftStore"

/**
 * **HostBridge 与一次性同意**（Task 0.8）。
 *
 * 设计规格 §9.2 把"确认授权"定义成一条**不可伪造、一次性、绑定内容**的记录：
 * - 同意由**宿主/UI**创建，`commit` **不是模型可见的工具**（模型只能产出草稿动作）；
 * - 同意绑定 `previewHash`：预览之后草稿再变，旧同意立刻作废；
 * - 同意绑定 `runId`：别的运行拿不到这次授权；
 * - 同意**一次性**（nonce 消费即失效）且**会过期**。
 *
 * 这四条各有一条用例，且每条都断言"真文档没有被替换"——**过期授权绝不能写入**。
 *
 * ## "不可伪造"原先只是注释（2026-09-21 修）
 *
 * 上面那句"由宿主创建"原先是**靠没人调别的路径**成立的，而不是靠代码：`commit` 只看
 * nonce 是否已消费、`runId` 是否相同、是否过期、`previewHash` 是否与当前草稿一致 ——
 * 这四条**调用方自己就能凑齐**（`preview()` 是公开的，`previewHash` 随手可读，
 * `expiresAt` 填一个未来时间即可）。也就是说：任何能调到 `commit` 的代码都能**自带一份"同意"**，
 * 而 `ConsentToken` 的注释却写着"协调器既不能伪造它，也不能从模型输出里读出一个来"。
 *
 * 现在桥里记着**自己铸造过的 nonce**（`minted`），`commit` 拒绝任何没铸造过的 nonce，
 * 消费时同时从 `minted` 里删掉 —— 注释里那句话这才真的成立。
 */

export interface ConsentRecord {
  runId: string
  draftId: string
  draftVersion: number
  previewHash: string
  /** 同意时的那一份文档句柄；提交流程会用它做 Compare-and-Swap。 */
  expectedHandles: { target: DocumentHandle; sources: DocumentHandle[] }
  /** 这次同意允许产生的效果（供 UI 说明"将要发生什么"）。 */
  allowedEffects: string[]
  /**
   * **这一轮钉住的那条会话**（Fix round 1 / C2；规格 §5.4："确认提交时检查会话…"）。
   *
   * 同意是"用户在**这条会话**里点了确认"，而用户完全可能在点之前切走 ——
   * 少了这一项，一份属于 A 的同意会在 B 的会话里被消费掉，文档按 B 的草稿被改，
   * 事后谁也说不清是哪一个会话提交的。可选：没有会话概念的调用方（纯草稿层测试）不受影响。
   */
  conversationId?: string
  expiresAt: number
  nonce: string
}

export type PreviewArtifact = {
  draftId: string
  draftVersion: number
  previewHash: string
  candidate: GeometryDocument
  stageCount: number
  /**
   * 候选文档里各类对象的**精确计数**（用户可编辑 / 隐藏 / 派生 / 内部近似）。
   *
   * 计划 Step 4 要求确认面板给出 "exact changed IDs/counts"。数字**必须来自真实候选文档**，
   * 而不是界面自己估的 —— 界面估出来的数字与真正要落盘的东西一旦不一致，
   * 用户就是在确认一件他没看见的事。
   */
  counts: DraftObjectCounts
  /** 基础文档的对象数，供面板说清"这次会多出/少掉多少"。 */
  baseCounts: DraftObjectCounts
}

export type PreviewResult = { ok: true; artifact: PreviewArtifact } | { ok: false; reason: "unknown_draft" }

export type ConsentResult = { ok: true; record: ConsentRecord } | { ok: false; reason: "unknown_draft" }

export type CommitReason = "missing_consent" | "consumed_consent" | "unminted_consent" | "wrong_run" | "expired_consent" | "stale_preview" | "stale_conversation" | "unknown_draft" | "stale_source" | "commit_rejected" | "no_change"

export type CommitReceiptResult = { ok: true; receipt: { changed: boolean; draftId: string } } | { ok: false; reason: CommitReason; detail?: string }

export interface HostBridgeDependencies {
  drafts: DraftStore
  /**
   * 当前活跃文档的**句柄 + 文档本体**。
   *
   * 两者都要：句柄用于 Compare-and-Swap（epoch/generation/内容哈希），
   * 文档本体是 `commitTransaction` 的 base —— 把句柄当文档传会直接炸在 `primitiveIds(undefined)`。
   * （这个错我在实现时就犯过，测试把它抓了出来。）
   */
  live(): { handle: DocumentHandle; document: GeometryDocument } | null
  replace(candidate: GeometryDocument): void
  runId: string
  /** 这一轮**钉住**的会话；同意绑定它（规格 §5.4）。 */
  conversationId?: string
  /** **当前**会话（用户可能已经切走）。同意里的会话与它不一致时，提交按 stale 拒绝。 */
  readConversationId?: () => string | null
  now?: () => number
  consentTtlMs?: number
}

export interface HostBridge {
  /** 当前活跃文档的句柄 + 本体；没有活跃文档时为 null。 */
  live(): { handle: DocumentHandle; document: GeometryDocument } | null
  preview(draftId: string): PreviewResult
  requestConsent(draftId: string): ConsentResult
  commit(draftId: string, consent: ConsentRecord | null): CommitReceiptResult
}

let nonceCounter = 0

function mintNonce(runId: string): string {
  nonceCounter += 1
  return `${runId}:nonce-${nonceCounter}`
}

export function createHostBridge(dependencies: HostBridgeDependencies): HostBridge {
  const { drafts, runId } = dependencies
  const now = dependencies.now ?? (() => Date.now())
  const ttl = dependencies.consentTtlMs ?? 60_000
  /** 已消费的 nonce：一次性语义就靠它。 */
  const consumed = new Set<string>()
  /**
   * **本桥铸造过的 nonce**："不可伪造"靠它。
   *
   * 只在 `requestConsent` 里加、只在 `commit` 成功时删（消费即失效），
   * 因此 `minted` 与 `consumed` 是两个不同的问题：前者是"你有没有这份授权"，
   * 后者是"这份授权用过没有"。
   */
  const minted = new Set<string>()

  return {
    live: dependencies.live,

    preview(draftId) {
      const artifact = drafts.getPreview(draftId)
      if (!artifact) return { ok: false, reason: "unknown_draft" }
      // 基础文档的对象数**现取**：面板要说清"这次会多出/少掉多少"，用旧快照会算错。
      const current = dependencies.live()
      const emptyCounts = { user: 0, hidden: 0, derived: 0, internal: 0, total: 0 }
      return {
        ok: true,
        artifact: {
          draftId: artifact.draftId,
          draftVersion: artifact.draftVersion,
          previewHash: artifact.previewHash,
          candidate: artifact.candidate,
          stageCount: artifact.stageCount,
          counts: countDraftObjects(artifact.candidate),
          baseCounts: current ? countDraftObjects(current.document) : emptyCounts
        }
      }
    },

    requestConsent(draftId) {
      const artifact = drafts.getPreview(draftId)
      const current = dependencies.live()
      if (!artifact || !current) return { ok: false, reason: "unknown_draft" }
      const handle = current.handle
      const nonce = mintNonce(runId)
      // 记下来：只有这里铸造过的 nonce 才会被 `commit` 认。
      minted.add(nonce)
      return {
        ok: true,
        record: {
          runId,
          draftId,
          draftVersion: artifact.draftVersion,
          previewHash: artifact.previewHash,
          expectedHandles: { target: handle, sources: [] },
          allowedEffects: [`${artifact.stageCount} action(s) applied to ${handle.documentId}`],
          ...(dependencies.conversationId === undefined ? {} : { conversationId: dependencies.conversationId }),
          expiresAt: now() + ttl,
          nonce
        }
      }
    },

    commit(draftId, consent) {
      // 顺序即"拒绝理由的优先级"：先看有没有授权，再看它是不是**我们发的**，然后才看还能不能用。
      if (!consent) return { ok: false, reason: "missing_consent" }
      if (consumed.has(consent.nonce)) return { ok: false, reason: "consumed_consent" }
      // 没铸造过 = 伪造的（或者别的桥发的）。这一条原先缺失，那时"不可伪造"只是注释。
      if (!minted.has(consent.nonce)) return { ok: false, reason: "unminted_consent" }
      if (consent.runId !== runId) return { ok: false, reason: "wrong_run" }
      if (consent.expiresAt <= now()) return { ok: false, reason: "expired_consent" }
      /**
       * **会话也要对得上**（Fix round 1 / C2；规格 §5.4）。
       *
       * 这一条排在预览与文档 CAS 之前：如果用户在拿到同意之后切到了别条会话，
       * "这份同意属于哪条会话"就已经不成立了 —— 继续走下去会按另一条会话的草稿改文档。
       */
      const liveConversation = dependencies.readConversationId?.() ?? null
      if (consent.conversationId !== undefined && liveConversation !== null && consent.conversationId !== liveConversation) {
        return { ok: false, reason: "stale_conversation", detail: `this consent belongs to conversation ${consent.conversationId}, but the active conversation is ${liveConversation}` }
      }

      const artifact = drafts.getPreview(draftId)
      if (!artifact) return { ok: false, reason: "unknown_draft" }
      // 预览之后草稿又变过 → 用户看到的不是将要提交的东西。
      if (artifact.previewHash !== consent.previewHash || artifact.draftVersion !== consent.draftVersion) {
        return { ok: false, reason: "stale_preview" }
      }

      // 仍要走 Compare-and-Swap：授权是"用户同意过"，不等于"文档没被动过"。
      const current = dependencies.live()
      const expected = consent.expectedHandles.target
      if (!current || current.handle.epoch !== expected.epoch || current.handle.generation !== expected.generation || current.handle.contentHash !== expected.contentHash) {
        return { ok: false, reason: "stale_source" }
      }

      /**
       * 在**当前活跃文档**上重放草稿已暂存的操作，而不是把候选文档直接塞进去。
       *
       * 两个理由：① 重放走的是 `commitTransaction`（`validatePatch` + `applyOperation` + 语义比较）
       * 这条**唯一**的写入路径，校验链完整；② revision / 哈希由它正确推进，
       * 直接写候选会把草稿里的 revision 带进来，破坏"版本号反映内容变化次数"。
       */
      const result = commitTransaction({ base: current.document, operations: artifact.operations })
      if (result.errors.length > 0) return { ok: false, reason: "commit_rejected", detail: result.errors.join(", ") }
      if (!result.changed) return { ok: false, reason: "no_change" }

      // 消费 nonce 之后才替换真文档：失败路径一个字节都不写。
      consumed.add(consent.nonce)
      minted.delete(consent.nonce)
      dependencies.replace(result.document)
      return { ok: true, receipt: { changed: true, draftId } }
    }
  }
}
