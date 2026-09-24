import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { createDocumentHandle } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createDraftStore, type DraftStore } from "./draftStore"
import { createHostBridge } from "./hostBridge"

/**
 * Task 0.8：**HostBridge 与一次性同意**。
 *
 * 计划的要求：`HostBridge.preview` / `requestConsent` / `commit`；
 * `ConsentRecord { runId, draftId, draftVersion, previewHash, expectedHandles, allowedEffects, expiresAt, nonce }`。
 * 关键性质（设计规格 §9.2）：
 * - 同意是**一次性**的（消费即失效，不能拿同一个 nonce 提两次）；
 * - 同意**绑定预览哈希**（预览之后草稿又变了 → 旧同意作废）；
 * - 同意**会过期**；
 * - `commit` **不是模型可见的工具**（只有宿主/UI 能创建同意）。
 */
function makeBridge(options: { now?: () => number; runId?: string; ttlMs?: number; conversationId?: string } = {}) {
  const drafts: DraftStore = createDraftStore()
  let document: GeometryDocument = createEmptyDocument("conics")
  let conversationId: string | null = options.conversationId ?? null
  const replaced: GeometryDocument[] = []
  const bridge = createHostBridge({
    drafts,
    live: () => ({ handle: createDocumentHandle(document, "project-1"), document }),
    replace: (candidate) => {
      replaced.push(candidate)
      document = candidate
    },
    runId: options.runId ?? "run-1",
    conversationId: options.conversationId,
    readConversationId: () => conversationId,
    now: options.now ?? (() => 1_000),
    consentTtlMs: options.ttlMs ?? 60_000
  })
  return { bridge, drafts, replaced, getDocument: () => document, setConversation: (next: string | null) => { conversationId = next } }
}

/**
 * 暂存一个点。`alias` 是**幂等分配器的记账键**：同 alias 再来一次等于"重试同一笔"，会得到同一个
 * id、并被"重复 id"拒绝 —— 这是刻意的（重试不该产生两个对象）。
 * 所以要暂存**另一笔**操作时必须换 alias。第一版测试没换，于是"预览变了"根本没发生。
 */
async function stagePoint(drafts: DraftStore, draftId: string, version: number, x = 1, alias = "p") {
  return await drafts.stage(draftId, [{ actionId: "planar.create_point", actionKey: alias, factIds: [], inputs: { alias, points: [{ x, y: 0 }] } }], version)
}

describe("host bridge consent", () => {
  it("previews an isolated draft and commits it once with a valid consent", async () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    expect((await stagePoint(harness.drafts, record.draftId, record.draftVersion)).ok).toBe(true)

    const preview = harness.bridge.preview(record.draftId)
    expect(preview.ok).toBe(true)
    if (!preview.ok) throw new Error("expected a preview")
    expect(preview.artifact.candidate.primitives).toHaveLength(1)
    // 预览阶段真文档没被动过。
    expect(harness.getDocument().primitives).toHaveLength(0)

    const consent = harness.bridge.requestConsent(record.draftId)
    expect(consent.ok).toBe(true)
    if (!consent.ok) throw new Error("expected consent")

    const receipt = harness.bridge.commit(record.draftId, consent.record)
    expect(receipt.ok).toBe(true)
    expect(harness.replaced).toHaveLength(1)
    expect(harness.getDocument().primitives).toHaveLength(1)
  })

  it("refuses a commit without consent, and never touches the live document", async () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    await stagePoint(harness.drafts, record.draftId, record.draftVersion)

    const receipt = harness.bridge.commit(record.draftId, null)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("missing_consent")
    expect(harness.replaced).toHaveLength(0)
  })

  it("consumes consent: the same nonce cannot commit twice", async () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    await stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    expect(harness.bridge.commit(record.draftId, consent.record).ok).toBe(true)
    const second = harness.bridge.commit(record.draftId, consent.record)

    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe("consumed_consent")
    expect(harness.replaced).toHaveLength(1)
  })

  it("expires consent instead of honouring it later", async () => {
    let now = 1_000
    const harness = makeBridge({ now: () => now, ttlMs: 5_000 })
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    await stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    now = 1_000 + 5_001
    const receipt = harness.bridge.commit(record.draftId, consent.record)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("expired_consent")
    expect(harness.replaced).toHaveLength(0)
  })

  /**
   * **同意也绑定会话**（Fix round 1 / C2；规格 §5.4："确认提交时检查会话、文档、generation
   * 和 preview hash，任意不匹配返回 stale 错误"）。
   *
   * 少了这一条，一份**属于会话 A** 的同意可以在用户切到 B 之后被消费 —— 而界面上那块面板
   * 明明说的是 A 的草稿。文档会按 B 的会话被改掉，事后谁也说不清是哪一个会话提交的。
   */
  it("refuses a consent that belongs to another conversation", async () => {
    const harness = makeBridge({ conversationId: "conv-a" })
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    await stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")
    expect(consent.record.conversationId).toBe("conv-a")

    // 用户切到了另一条会话（面板却还挂在界面上）。
    harness.setConversation("conv-b")
    const receipt = harness.bridge.commit(record.draftId, consent.record)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("stale_conversation")
    // 一个字节都没写：拒绝路径不动物档。
    expect(harness.replaced).toHaveLength(0)
    expect(harness.getDocument().primitives).toHaveLength(0)
  })

  /**
   * **预览之后草稿又变过 → 旧同意作废**。
   *
   * （这里原先挂着一段"待查、显式跳过"的注释，说这条用例当时失败；它现在**是通过的**，
   * 注释与事实不符，已经删掉 —— 留着会让下一个人以为这里有一道已知的坏闸。）
   */
  it("invalidates consent when the draft changed after the preview", async () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    await stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    // 预览之后又暂存了一笔 —— 用户看到的东西已经变了，旧同意必须作废。
    const secondStage = await stagePoint(harness.drafts, record.draftId, record.draftVersion + 1, 9, "q")
    expect(secondStage.ok, "第二笔暂存应当成功，否则这条用例验不到 stale_preview").toBe(true)
    const receipt = harness.bridge.commit(record.draftId, consent.record)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("stale_preview")
    expect(harness.replaced).toHaveLength(0)
  })

  it("refuses consent minted for another run", async () => {
    const harness = makeBridge({ runId: "run-1" })
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    await stagePoint(harness.drafts, record.draftId, record.draftVersion)

    /**
     * 同意必须来自**另一个桥**，而不是手写一份字符串。
     *
     * 手写的那一份现在会被 `unminted_consent` 拦下（那正是下一条用例要钉的，
     * 而且拦得更早）—— 于是这条用例就验不到 `wrong_run` 了。让它真的铸造一份，
     * 才是在测"别的运行的授权能不能用在这里"。
     */
    const other = createHostBridge({
      drafts: harness.drafts,
      live: () => ({ handle: createDocumentHandle(harness.getDocument(), "project-1"), document: harness.getDocument() }),
      replace: () => {},
      runId: "run-2",
      now: () => 1_000
    })
    const consent = other.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")
    const receipt = harness.bridge.commit(record.draftId, consent.record)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("unminted_consent")
    // 跨桥的授权一样不许写文档。
    expect(harness.replaced).toHaveLength(0)
  })

  /**
   * **"无需改动"是一次成功的提交**（外部审查 A1）。
   *
   * 它原先走 `{ ok: false, reason: "no_change" }` —— 失败通道。于是适配器只在 `ok: true`
   * 分支里读 `receipt.changed`（那里永远拿不到 `false`），`no_change` 掉进通用拒绝 ⇒
   * 协调器里 `no_change → completed` **成了死代码**，用户看到"运行失败"。
   *
   * 无操作在这里用"**一份什么都没暂存的草稿**"表达：它的操作集是空的，
   * 于是 `commitTransaction` 的语义哈希不变（`changed: false`）—— 与生产里
   * "真文档已经等于候选"走的是同一条分支。**授权照常被消费**（这一轮确实结束了），
   * 而文档**一个字节都不写**。
   */
  it("reports a commit that changes nothing as a success, not a failure", async () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    // 刻意**不**暂存任何动作：这就是"无需改动"。

    const consent = harness.bridge.requestConsent(record.draftId)
    expect(consent.ok).toBe(true)
    if (!consent.ok) throw new Error("expected consent")

    const receipt = harness.bridge.commit(record.draftId, consent.record)

    // 修复前这里是 `{ ok: false, reason: "no_change" }`。
    expect(receipt.ok).toBe(true)
    if (receipt.ok) expect(receipt.receipt).toEqual({ changed: false, draftId: record.draftId })
    // 文档没有被"替换"：无需改动就不写。
    expect(harness.replaced).toHaveLength(0)

    // 授权仍然是一次性的：同一个 nonce 不能再提交一次。
    const second = harness.bridge.commit(record.draftId, consent.record)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe("consumed_consent")
  })
})

describe("consent record shape", () => {
  it("carries the fields the plan names, including the expected handles", async () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    await stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    const fields: Array<keyof typeof consent.record> = ["runId", "draftId", "draftVersion", "previewHash", "expectedHandles", "allowedEffects", "expiresAt", "nonce"]
    for (const field of fields) expect(consent.record[field], `consent is missing ${field}`).toBeDefined()
    expect(consent.record.draftId).toBe(record.draftId)
    expect(consent.record.expiresAt).toBeGreaterThan(1_000)
    // 非空 nonce：一次性语义靠它。
    expect(String(consent.record.nonce).length).toBeGreaterThan(0)
  })
})

/**
 * **凭据必须是宿主铸造的**（2026-09-21）。
 *
 * `ConsentToken` 的注释一直声称"协调器既不能伪造它，也不能从模型输出里读出一个来"，
 * 而 `HostBridge.commit` 原先**只看 nonce 是否已消费、runId 是否相同、是否过期、
 * previewHash 是否与当前草稿一致** —— 这四条全都由调用方自己就能凑出来
 * （`preview()` 是公开的，`previewHash` 随手可读，`expiresAt` 自己填一个未来时间）。
 * 也就是说：**任何能调到 `commit` 的代码都能自带一份"同意"**，那句注释当时比代码强。
 *
 * 现在桥里记着**自己铸造过的 nonce**，没铸造过的一律拒绝。这条用例钉的就是它。
 */
describe("consent must be minted by this bridge", () => {
  it("refuses a hand-built consent record that was never requested", async () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    await stagePoint(harness.drafts, record.draftId, record.draftVersion)

    // 伪造：nonce 是编的，其余字段全部照抄真值（previewHash 从公开的 preview 就能拿到）。
    const preview = harness.bridge.preview(record.draftId)
    if (!preview.ok) throw new Error("expected a preview")
    const forged = {
      runId: "run-1",
      draftId: record.draftId,
      draftVersion: preview.artifact.draftVersion,
      previewHash: preview.artifact.previewHash,
      expectedHandles: { target: harness.bridge.live()!.handle, sources: [] },
      allowedEffects: ["forged"],
      expiresAt: 1_000 + 60_000,
      nonce: "nonce-i-made-up"
    }

    const receipt = harness.bridge.commit(record.draftId, forged)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("unminted_consent")
    // 关键：被拒时**一个字节都不许写**。
    expect(harness.replaced).toHaveLength(0)
  })

  it("still accepts a consent record the bridge itself minted", async () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    await stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    const receipt = harness.bridge.commit(record.draftId, consent.record)

    expect(receipt.ok).toBe(true)
    expect(harness.replaced).toHaveLength(1)
  })
})

/** 同意里存的是**真句柄**，不是字符串 id —— 后续才能检测 epoch/generation 变化。 */
describe("consent handles", () => {
  it("keeps a real handle so a later epoch/generation change can be detected", async () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    await stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    expect(consent.record.expectedHandles.target.documentId).toBeTruthy()
    expect(consent.record.expectedHandles.target.contentHash).toBeTruthy()
    expect(consent.record.expectedHandles.target.generation).toBe(harness.getDocument().revision)
  })
})
