import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { sceneContentKey, type SceneContentInputs } from "./sceneContentKey"

/**
 * 每条断言都**共用同一份文档**。
 *
 * 踩过的坑：`createEmptyDocument()` 每次都生成一个新的 `metadata.id`（`createId("doc")` → `randomUUID`），
 * 所以"两份空文档"的签名本来就不一样 —— 拿 `base({ showNormals: true })` 去比 `base()`，
 * 断言**必然通过**，但通过的理由是"文档 id 不同"，与那个开关毫无关系。
 * 这些用例的用意是"这个输入变了，签名必须跟着变"，所以文档必须是同一个。
 */
const withDocument = (document = createEmptyDocument("geometry3d"), overrides: Partial<SceneContentInputs> = {}): SceneContentInputs => ({
  document,
  selectedIds: [],
  showHiddenEdges: false,
  showNormals: false,
  transparentFaces: false,
  showRotationHandles: false,
  unfoldProgress: 0,
  previewKeys: "",
  ...overrides
})

describe("scene content key", () => {
  it("is stable for the same document and options", () => {
    // 同一份文档、两组内容相等的选项：签名必须一致，否则每次渲染都会白白同步一次内容。
    const document = createEmptyDocument("geometry3d")
    expect(sceneContentKey(withDocument(document))).toBe(sceneContentKey(withDocument(document)))
  })

  it("changes when the document revision changes", () => {
    const document = createEmptyDocument("geometry3d")
    const bumped = { ...document, revision: document.revision + 1 }
    expect(sceneContentKey(withDocument(bumped))).not.toBe(sceneContentKey(withDocument(document)))
  })

  it("changes when the selection changes", () => {
    const document = createEmptyDocument("geometry3d")
    expect(sceneContentKey(withDocument(document, { selectedIds: ["point3-1"] }))).not.toBe(sceneContentKey(withDocument(document)))
  })

  it("changes when a display flag changes", () => {
    const document = createEmptyDocument("geometry3d")
    const base = sceneContentKey(withDocument(document))
    expect(sceneContentKey(withDocument(document, { showNormals: true }))).not.toBe(base)
    expect(sceneContentKey(withDocument(document, { transparentFaces: true }))).not.toBe(base)
    expect(sceneContentKey(withDocument(document, { showHiddenEdges: true }))).not.toBe(base)
    /**
     * 旋转环的视图开关也必须进签名：不加这一条，点「旋转环」按钮只会改一个 state，
     * 内容同步因为"签名没变"而直接返回 —— 画面上什么都不会发生。
     */
    expect(sceneContentKey(withDocument(document, { showRotationHandles: true }))).not.toBe(base)
  })

  it("distinguishes a running unfold from a static one, and the preview set", () => {
    const document = createEmptyDocument("geometry3d")
    const base = sceneContentKey(withDocument(document))
    expect(sceneContentKey(withDocument(document, { unfoldProgress: 0.5 }))).not.toBe(base)
    expect(sceneContentKey(withDocument(document, { previewKeys: "pair:a|b:线:intersection" }))).not.toBe(base)
    expect(sceneContentKey(withDocument(document, { previewKeys: "pair:a|b:线:intersection" }))).not.toBe(sceneContentKey(withDocument(document, { previewKeys: "pair:a|b:面:solid" })))
  })
})
