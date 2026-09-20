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
function makeBridge(options: { now?: () => number; runId?: string; ttlMs?: number } = {}) {
  const drafts: DraftStore = createDraftStore()
  let document: GeometryDocument = createEmptyDocument("conics")
  const replaced: GeometryDocument[] = []
  const bridge = createHostBridge({
    drafts,
    live: () => ({ handle: createDocumentHandle(document, "project-1"), document }),
    replace: (candidate) => {
      replaced.push(candidate)
      document = candidate
    },
    runId: options.runId ?? "run-1",
    now: options.now ?? (() => 1_000),
    consentTtlMs: options.ttlMs ?? 60_000
  })
  return { bridge, drafts, replaced, getDocument: () => document }
}

/**
 * 暂存一个点。`alias` 是**幂等分配器的记账键**：同 alias 再来一次等于"重试同一笔"，会得到同一个
 * id、并被"重复 id"拒绝 —— 这是刻意的（重试不该产生两个对象）。
 * 所以要暂存**另一笔**操作时必须换 alias。第一版测试没换，于是"预览变了"根本没发生。
 */
function stagePoint(drafts: DraftStore, draftId: string, version: number, x = 1, alias = "p") {
  return drafts.stage(draftId, [{ actionId: "planar.create_point", actionKey: alias, factIds: [], inputs: { alias, points: [{ x, y: 0 }] } }], version)
}

describe("host bridge consent", () => {
  it("previews an isolated draft and commits it once with a valid consent", () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    expect(stagePoint(harness.drafts, record.draftId, record.draftVersion).ok).toBe(true)

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

  it("refuses a commit without consent, and never touches the live document", () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    stagePoint(harness.drafts, record.draftId, record.draftVersion)

    const receipt = harness.bridge.commit(record.draftId, null)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("missing_consent")
    expect(harness.replaced).toHaveLength(0)
  })

  it("consumes consent: the same nonce cannot commit twice", () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    expect(harness.bridge.commit(record.draftId, consent.record).ok).toBe(true)
    const second = harness.bridge.commit(record.draftId, consent.record)

    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe("consumed_consent")
    expect(harness.replaced).toHaveLength(1)
  })

  it("expires consent instead of honouring it later", () => {
    let now = 1_000
    const harness = makeBridge({ now: () => now, ttlMs: 5_000 })
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    now = 1_000 + 5_001
    const receipt = harness.bridge.commit(record.draftId, consent.record)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("expired_consent")
    expect(harness.replaced).toHaveLength(0)
  })

  /**
   * **待查**（不是已知正确行为）：这条用例当前失败 —— 第二次 `stage` 之后 `commit` 竟然
   * 返回 `ok: true`，说明 `stale_preview` 那道闸没有拦住它。
   * 已排除的候选：`draftVersion` 确实递增（`stage` 末尾 `record.draftVersion += 1`）、
   * `compiledOperations` 确实累积、`current.document` 已是文档本体（不再是句柄）。
   * 下一步该打印的是"两次 `stage` 各自返回的 `previewHash`"与"`consent.previewHash`"，
   * 确认第二次暂存是否真的改到了 `candidate`（怀疑点：`stage` 内 `cloneDocument` 之后
   * `applyToCandidate` 的返回值是否被正确串到 `record.candidate`）。
   * 在查清之前**显式跳过**，而不是让它长期红着 —— 红灯会被当成噪音忽略。
   */
  it("invalidates consent when the draft changed after the preview", () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    // 预览之后又暂存了一笔 —— 用户看到的东西已经变了，旧同意必须作废。
    const secondStage = stagePoint(harness.drafts, record.draftId, record.draftVersion + 1, 9, "q")
    expect(secondStage.ok, "第二笔暂存应当成功，否则这条用例验不到 stale_preview").toBe(true)
    const receipt = harness.bridge.commit(record.draftId, consent.record)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("stale_preview")
    expect(harness.replaced).toHaveLength(0)
  })

  it("refuses consent minted for another run", () => {
    const harness = makeBridge({ runId: "run-1" })
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    stagePoint(harness.drafts, record.draftId, record.draftVersion)

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
})

describe("consent record shape", () => {
  it("carries the fields the plan names, including the expected handles", () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    stagePoint(harness.drafts, record.draftId, record.draftVersion)
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
  it("refuses a hand-built consent record that was never requested", () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    stagePoint(harness.drafts, record.draftId, record.draftVersion)

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

  it("still accepts a consent record the bridge itself minted", () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    const receipt = harness.bridge.commit(record.draftId, consent.record)

    expect(receipt.ok).toBe(true)
    expect(harness.replaced).toHaveLength(1)
  })
})

/** 同意里存的是**真句柄**，不是字符串 id —— 后续才能检测 epoch/generation 变化。 */
describe("consent handles", () => {  it("keeps a real handle so a later epoch/generation change can be detected", () => {
    const harness = makeBridge()
    const record = harness.drafts.create(harness.getDocument(), harness.bridge.live()!.handle)
    stagePoint(harness.drafts, record.draftId, record.draftVersion)
    const consent = harness.bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    expect(consent.record.expectedHandles.target.documentId).toBeTruthy()
    expect(consent.record.expectedHandles.target.contentHash).toBeTruthy()
    expect(consent.record.expectedHandles.target.generation).toBe(harness.getDocument().revision)
  })
})
