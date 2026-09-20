import { createEmptyDocument } from "@draw/dsl"
import { createDocumentHandle } from "@draw/scene-graph"
import { beforeEach, describe, expect, it } from "vitest"

import { createSceneDocumentPort } from "../services/sceneDocumentPort"
import { useSceneStore } from "../store"
import { createDraftStore, type DraftStore } from "./draftStore"
import { createHostBridge, type HostBridge } from "./hostBridge"

/**
 * **G0.5 三条 Gate 的端到端证明**（Task 0.7 + 0.8 串起来）。
 *
 * 前面的 `draftStore.test.ts` / `hostBridge.test.ts` / `documentService.test.ts` /
 * `sceneDocumentPort.test.ts` 各自用**替身**验证自己那一层。这里一个替身都不用：
 * 真 `useSceneStore` + 真 `DocumentPort` + 真 `DocumentService` + 真 `HostBridge` + 真 `DraftStore`。
 *
 * 计划要求的三条（Gate 原文）：
 * 1. "A model-shaped action can only create an isolated draft."
 * 2. "A manual edit after preview makes the draft stale; it cannot overwrite the newer head."
 * 3. "Consent is one-time, hash-bound, expires, and cannot be generated from assistant text."
 *   —— 这里覆盖"一次性"与"绑定预览哈希"；"不能由助手文本生成"是结构性的：
 *   `createHostBridge` 只把 `preview/commit` 暴露给宿主代码，`requestConsent` 需要一个真实的
 *   `HostBridge` 实例，模型侧拿不到它（模型只能产出 `DraftAction`，这一点由动作层类型钉住）。
 */

/** 每个替身都被显式标注出来——这个文件的价值就在于"哪些是真的"一眼可查。 */
function makeHarness(options: { now?: () => number; ttlMs?: number } = {}) {
  localStorage.clear()
  const base = createEmptyDocument("conics")
  useSceneStore.setState({ document: base, workspaceDocuments: { [base.workspace]: base }, history: [], future: [], error: null })

  /** 真端口：读的就是 store 当前状态（不是快照；这条由 `sceneDocumentPort.test.ts` 专门守着）。 */
  const port = createSceneDocumentPort(useSceneStore.getState)
  const drafts: DraftStore = createDraftStore()
  const bridge: HostBridge = createHostBridge({
    drafts,
    live: () => {
      const current = port.current()
      // 句柄用与 `DocumentService` 同一套规则产出（内容哈希 + 精确到 revision 的 generation）。
      return current ? { handle: createDocumentHandle(current.document, "project-1"), document: current.document } : null
    },
    replace: (candidate) => port.replace(candidate),
    runId: "run-1",
    now: options.now ?? (() => 1_000),
    consentTtlMs: options.ttlMs ?? 60_000
  })
  return { bridge, drafts, port }
}

function stagePoint(drafts: DraftStore, draftId: string, version: number, x = 1, alias = "p") {
  return drafts.stage(draftId, [{ actionId: "planar.create_point", actionKey: alias, factIds: [], inputs: { alias, points: [{ x, y: 0 }] } }], version)
}

/** 真文档上的一笔手工编辑（用户操作走的就是 `applyBatch`）。 */
function manualEdit() {
  useSceneStore.getState().applyBatch([{ op: "addPrimitive", primitive: { id: "point-manual", type: "point", x: 5, y: 5 } }])
}

describe("agent commit pipeline against the real store", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("Gate 1 — a model-shaped action only ever creates an isolated draft", () => {
    const { bridge, drafts } = makeHarness()
    const record = drafts.create(useSceneStore.getState().document, bridge.live()!.handle)

    expect(stagePoint(drafts, record.draftId, record.draftVersion).ok).toBe(true)

    const preview = bridge.preview(record.draftId)
    expect(preview.ok).toBe(true)
    if (!preview.ok) throw new Error("expected a preview")

    // 候选里有对象，真文档里一个都没有，历史也没多一步。
    expect(preview.artifact.candidate.primitives).toHaveLength(1)
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
    expect(useSceneStore.getState().history).toHaveLength(0)
  })

  it("Gate 2 — a manual edit after the preview makes the draft stale and the newer head survives", () => {
    const { bridge, drafts } = makeHarness()
    const record = drafts.create(useSceneStore.getState().document, bridge.live()!.handle)
    expect(stagePoint(drafts, record.draftId, record.draftVersion).ok).toBe(true)

    const consent = bridge.requestConsent(record.draftId)
    expect(consent.ok).toBe(true)
    if (!consent.ok) throw new Error("expected consent")

    // 用户在确认之前又动了一下文档（这正是"预览之后手工编辑"）。
    manualEdit()
    const afterEdit = useSceneStore.getState().document
    expect(afterEdit.primitives.map((primitive) => primitive.id)).toEqual(["point-manual"])

    const receipt = bridge.commit(record.draftId, consent.record)

    expect(receipt.ok).toBe(false)
    // 授权本身没过期、也没被用过：挡下它的是"文档已经不是那一版了"。
    if (!receipt.ok) expect(receipt.reason).toBe("stale_source")
    // 关键：更新的那一版没有被覆盖，草稿里的点也没有落进来。
    const live = useSceneStore.getState().document
    expect(live.primitives.map((primitive) => primitive.id)).toEqual(["point-manual"])
    expect(live.revision).toBe(afterEdit.revision)
    expect(useSceneStore.getState().history).toHaveLength(1)
  })

  it("Gate 3 — consent is one-time: the same record cannot commit twice", () => {
    const { bridge, drafts } = makeHarness()
    const record = drafts.create(useSceneStore.getState().document, bridge.live()!.handle)
    expect(stagePoint(drafts, record.draftId, record.draftVersion).ok).toBe(true)

    const consent = bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")

    const first = bridge.commit(record.draftId, consent.record)
    expect(first.ok).toBe(true)
    expect(useSceneStore.getState().document.primitives).toHaveLength(1)
    // 提交只占一步撤销（与手工操作同一口径）。
    expect(useSceneStore.getState().history).toHaveLength(1)

    const second = bridge.commit(record.draftId, consent.record)
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe("consumed_consent")
    // 第二次没有产生任何写入：还是一个对象、还是一步历史。
    expect(useSceneStore.getState().document.primitives).toHaveLength(1)
    expect(useSceneStore.getState().history).toHaveLength(1)
  })

  /**
   * `DraftStore.assertFresh` 与 HostBridge 的 CAS 是**两道独立**的闸：前者问"草稿的基准还在不在"，
   * 后者问"授权时那份文档还是不是当前这一版"。`commit` 走的是后者的理由（`stale_source`），
   * 所以上面那条用例其实**碰不到** `assertFresh`；这里单独把它钉住，
   * 否则"草稿基准失效"这条判断可以整体删掉而测试全绿。
   */
  it("Gate 2 — assertFresh reports the draft's base document as stale after a manual edit", () => {
    const { bridge, drafts } = makeHarness()
    const record = drafts.create(useSceneStore.getState().document, bridge.live()!.handle)
    expect(stagePoint(drafts, record.draftId, record.draftVersion).ok).toBe(true)

    // 先确认"没被动过"时它是通过的——否则下面的失败可能只是因为别的原因。
    expect(drafts.assertFresh(record.draftId, bridge.live()!.handle).ok).toBe(true)

    manualEdit()

    const freshness = drafts.assertFresh(record.draftId, bridge.live()!.handle)
    expect(freshness.ok).toBe(false)
    if (!freshness.ok) expect(freshness.reason).toBe("stale_source")
  })

  it("Gate 3 — consent is hash-bound: staging more after the preview invalidates the earlier consent", () => {
    const { bridge, drafts } = makeHarness()
    const record = drafts.create(useSceneStore.getState().document, bridge.live()!.handle)
    expect(stagePoint(drafts, record.draftId, record.draftVersion, 1, "p1").ok).toBe(true)

    const consent = bridge.requestConsent(record.draftId)
    if (!consent.ok) throw new Error("expected consent")
    const previewHash = consent.record.previewHash

    // 预览之后草稿又变了一次（**换 alias**：幂等分配器让"同 alias"等于重试同一笔）。
    expect(stagePoint(drafts, record.draftId, 2, 2, "p2").ok).toBe(true)

    const receipt = bridge.commit(record.draftId, consent.record)

    expect(receipt.ok).toBe(false)
    if (!receipt.ok) expect(receipt.reason).toBe("stale_preview")
    // 用户看到的那一版哈希与草稿现状确实不同——这条断言让"为什么拒绝"可核对。
    expect(drafts.getPreview(record.draftId)!.previewHash).not.toBe(previewHash)
    expect(useSceneStore.getState().document.primitives).toHaveLength(0)
  })
})
