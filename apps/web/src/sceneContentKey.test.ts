import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { sceneContentKey, type SceneContentInputs } from "./sceneContentKey"

const base = (overrides: Partial<SceneContentInputs> = {}): SceneContentInputs => ({
  document: createEmptyDocument("geometry3d"),
  selectedIds: [],
  showHiddenEdges: false,
  showNormals: false,
  transparentFaces: false,
  unfoldProgress: 0,
  previewKeys: "",
  ...overrides
})

describe("scene content key", () => {
  it("is stable for the same document and options", () => {
    // 同一份文档、两组内容相等的选项：签名必须一致，否则每次渲染都会白白同步一次内容。
    const document = createEmptyDocument("geometry3d")
    expect(sceneContentKey(base({ document }))).toBe(sceneContentKey(base({ document })))
  })

  it("changes when the document revision changes", () => {
    const document = createEmptyDocument("geometry3d")
    const bumped = { ...document, revision: document.revision + 1 }
    expect(sceneContentKey(base({ document: bumped }))).not.toBe(sceneContentKey(base()))
  })

  it("changes when the selection changes", () => {
    expect(sceneContentKey(base({ selectedIds: ["point3-1"] }))).not.toBe(sceneContentKey(base()))
  })

  it("changes when a display flag changes", () => {
    expect(sceneContentKey(base({ showNormals: true }))).not.toBe(sceneContentKey(base()))
    expect(sceneContentKey(base({ transparentFaces: true }))).not.toBe(sceneContentKey(base()))
    expect(sceneContentKey(base({ showHiddenEdges: true }))).not.toBe(sceneContentKey(base()))
  })

  it("distinguishes a running unfold from a static one, and the preview set", () => {
    expect(sceneContentKey(base({ unfoldProgress: 0.5 }))).not.toBe(sceneContentKey(base()))
    expect(sceneContentKey(base({ previewKeys: "pair:a|b:线:intersection" }))).not.toBe(sceneContentKey(base()))
    expect(sceneContentKey(base({ previewKeys: "pair:a|b:线:intersection" }))).not.toBe(sceneContentKey(base({ previewKeys: "pair:a|b:面:solid" })))
  })
})
