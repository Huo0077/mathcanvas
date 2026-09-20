import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { createDocumentHandle } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createDraftStore } from "./draftStore"

/**
 * Task 0.7 Step 4：**草稿隔离**。
 *
 * 计划要守的：候选文档在内存里克隆与校验，草稿只保留 draft id + 预览产物，
 * **任何草稿操作都不更新 `useSceneStore`**；consent 与预览哈希绑定、且一次性。
 */
function baseDocument(): GeometryDocument {
  return createEmptyDocument("conics")
}

describe("isolated drafts", () => {
  it("keeps a draft candidate in memory and never touches the live document", () => {
    const store = createDraftStore()
    const base = baseDocument()
    const record = store.create(base)

    const staged = store.stage(record.draftId, [{ actionId: "planar.create_point", actionKey: "a", factIds: [], inputs: { alias: "p", points: [{ x: 1, y: 2 }] } }], record.draftVersion)

    expect(staged.ok).toBe(true)
    // 关键隔离断言：候选文档里有新点，**基础文档一个字节都没变**。
    const preview = store.getPreview(record.draftId)
    expect(preview?.candidate.primitives).toHaveLength(1)
    expect(base.primitives).toHaveLength(0)
  })

  it("reports a stale draft version instead of overwriting newer staged work", () => {
    const store = createDraftStore()
    const record = store.create(baseDocument())
    store.stage(record.draftId, [{ actionId: "planar.create_point", actionKey: "a", factIds: [], inputs: { alias: "p", points: [{ x: 0, y: 0 }] } }], record.draftVersion)

    // 用**旧版本号**再暂存一次：必须被拒，否则会把新staged 的内容覆盖掉。
    const stale = store.stage(record.draftId, [{ actionId: "planar.create_point", actionKey: "b", factIds: [], inputs: { alias: "q", points: [{ x: 5, y: 5 }] } }], record.draftVersion)

    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe("stale_draft_version")
    expect(store.getPreview(record.draftId)?.candidate.primitives).toHaveLength(1)
  })

  it("invalidates a draft when its base handle no longer matches the live document", () => {
    const store = createDraftStore()
    const base = baseDocument()
    const record = store.create(base, createDocumentHandle(base, "project-1"))

    const stale = store.assertFresh(record.draftId, createDocumentHandle({ ...base, revision: base.revision + 1 }, "project-1"))
    expect(stale.ok).toBe(false)

    store.invalidate(record.draftId, "manual edit")
    expect(store.getPreview(record.draftId)).toBeNull()
  })

  it("refuses to stage an action the compiler rejects, and keeps the draft untouched", () => {
    const store = createDraftStore()
    const record = store.create(baseDocument())

    // 退化线：编译器给诊断 → 草稿不该被改成"半成品"。
    const staged = store.stage(record.draftId, [{ actionId: "planar.create_line", actionKey: "l", factIds: [], inputs: { alias: "l", points: [{ x: 1, y: 1 }, { x: 1, y: 1 }] } }], record.draftVersion)

    expect(staged.ok).toBe(false)
    if (!staged.ok) expect(staged.diagnostics?.[0]?.code).toBe("degenerate_line")
    expect(store.getPreview(record.draftId)?.candidate.primitives).toHaveLength(0)
  })

  it("binds a preview hash to the exact staged content", () => {
    const store = createDraftStore()
    const record = store.create(baseDocument())
    const before = store.getPreview(record.draftId)!.previewHash

    store.stage(record.draftId, [{ actionId: "planar.create_point", actionKey: "a", factIds: [], inputs: { alias: "p", points: [{ x: 3, y: 4 }] } }], record.draftVersion)
    const after = store.getPreview(record.draftId)!.previewHash

    // 预览哈希必须随内容变化 —— 它是 consent 的绑定对象。
    expect(after).not.toBe(before)
  })

  /**
   * 2026-09-21 修掉的真实缺陷：`previewHash` 曾经填的是 `contentFingerprint(候选文档)`，
   * 而那个函数返回的是**整份候选文档的规范化 JSON 字符串**，不是哈希。
   *
   * 后果有两条，第二条才是真正被用户看到的：
   * 1. 契约里写的是"哈希"（`ConsentRecord.previewHash`、`DraftPreview.previewHash`），
   *    实现给的是一份全文；
   * 2. 确认面板第一版把这个字段直接渲染出来，于是**整份候选文档被打在界面上**
   *    （`ConfirmationPanel.tsx` 里记着这次发现），而这违反"草稿在界面里只是视图"。
   *
   * 这里钉住的是**形状**：64 位十六进制 SHA-256（`canonicalContentHash`），
   * 且**不含**大括号 —— 只要有人把它换回某种"文档字符串"，这两条断言就会红。
   */
  it("binds the preview to a real SHA-256 hash, not to the document's JSON text", () => {
    const store = createDraftStore()
    const record = store.create(baseDocument())
    store.stage(record.draftId, [{ actionId: "planar.create_point", actionKey: "a", factIds: [], inputs: { alias: "p", points: [{ x: 3, y: 4 }] } }], record.draftVersion)

    const previewHash = store.getPreview(record.draftId)!.previewHash

    expect(previewHash).toMatch(/^[0-9a-f]{64}$/)
    expect(previewHash).not.toContain("{")
  })
})