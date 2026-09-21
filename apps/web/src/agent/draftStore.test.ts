import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { createDocumentHandle } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { migrateLegacySolids } from "../solidTemplates"
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

/** 画布上已经有一个手工/上一轮建好的立方体 `solid-1`（现场里就是这个形状）。 */
function baseWithCube(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [{ id: "solid-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 2, z: 2 }, label: "立方体" }] as never
  return document
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

  /**
   * **真实现场**（2026-09-21）：画布上已经有一个手工建的立方体 `solid-1`，
   * 随后用户让 Agent 建一个直四棱柱，模型出了一个 `solid.create_template` 动作 ——
   * 分配器从 1 开始数，又发了 `solid-1`，`validatePatch` 判 `duplicate object id`，
   * 运行以 `compile_failed: duplicate object id` 结束（账本 `run-6-mubf109e`）。
   *
   * 手工路径（`App.tsx` 的 `nextPrimitiveId`）**一直是**扫已有 id 取下一个空位的；
   * 只有动作层的分配器不知道文档里有什么 —— 两份实现漂移，Agent 侧就成了必然失败。
   */
  it("stages onto a document that already holds an object of the same kind", () => {
    const store = createDraftStore()
    const base = baseWithCube()
    const record = store.create(base)

    const staged = store.stage(record.draftId, [{ actionId: "solid.create_template", actionKey: "prism", factIds: [], inputs: { alias: "prism", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } } }], record.draftVersion)

    expect(staged.ok).toBe(true)
    const ids = store.getPreview(record.draftId)?.candidate.primitives.map((primitive) => primitive.id)
    // 新对象必须另起一个没被占用的 id，而且**已有对象还在**。
    expect(ids).toEqual(["solid-1", "solid-2"])
  })

  /**
   * **恢复之后的文档也必须能起草**（2026-09-21 的第二个真实故障）。
   *
   * 应用启动时会 `migrateLegacySolids`（打开文件 / 恢复草稿都走它），物化出来的子对象带着
   * `style: undefined` / `label: undefined`。此前的规范化哈希把 `undefined` 当垃圾抛出去，
   * 于是"画布上有一个立方体"就成了 Agent 的**必然失败**：
   * `Error: canonicalContentHash: unsupported value of type undefined`（账本里是 `run_failed`）。
   */
  it("stages onto a document that came back from a restore (materialized children)", () => {
    const store = createDraftStore()
    const restored = migrateLegacySolids(baseWithCube())
    const record = store.create(restored)

    const staged = store.stage(record.draftId, [{ actionId: "solid.create_template", actionKey: "second", factIds: [], inputs: { alias: "second", template: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 3, y: 3, z: 3 } } }], record.draftVersion)

    expect(staged.ok).toBe(true)
    // 已有的立方体（以及它的子对象）一个都不能丢，新对象另起一个 id。
    const ids = store.getPreview(record.draftId)?.candidate.primitives.map((primitive) => primitive.id) ?? []
    expect(ids).toContain("solid-1")
    expect(ids).toContain("solid-2")
  })

  it("binds a preview hash to the exact staged content", () => {    const store = createDraftStore()
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