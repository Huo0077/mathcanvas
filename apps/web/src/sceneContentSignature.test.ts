import { describe, expect, it } from "vitest"

import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"

import { createContentSigner } from "./sceneContentSignature"

/**
 * 内容签名：决定"这个场景对象要不要重建"。
 *
 * 判据必须是**这个对象真正读到的东西**：它自己的数据、它依赖的图元（传递闭包）、
 * 以及调用方给的视图状态（选中、显示开关、展开进度……）。
 * 少一项就会画出过期几何，多一项（比如把整份文档塞进去）就等于没做增量。
 */

function documentWithLine(): GeometryDocument {
  const document = createEmptyDocument("geometry3d")
  document.primitives = [
    { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 }, label: "A" },
    { id: "b", type: "point3", position: { x: 2, y: 0, z: 0 }, label: "B" },
    { id: "far", type: "point3", position: { x: 9, y: 9, z: 9 }, label: "C" },
    { id: "seg", type: "segment3", pointIds: ["a", "b"] }
  ]
  return document
}

const moved = (document: GeometryDocument, id: string, axis: "x" | "y" | "z", value: number): GeometryDocument => {
  const next = structuredClone(document)
  const point = next.primitives.find((primitive) => primitive.id === id)
  if (point?.type === "point3") point.position[axis] = value
  return next
}

describe("createContentSigner", () => {
  it("changes when the primitive's own data changes", () => {
    const document = documentWithLine()
    expect(createContentSigner(moved(document, "a", "z", 3)).of("a")).not.toBe(createContentSigner(document).of("a"))
  })

  it("changes when a dependency it is drawn from moves", () => {
    const document = documentWithLine()
    const signer = createContentSigner(document)
    const movedSigner = createContentSigner(moved(document, "b", "y", 4))

    expect(movedSigner.of("seg")).not.toBe(signer.of("seg"))
  })

  it("does not change when an unrelated primitive moves", () => {
    const document = documentWithLine()
    const signer = createContentSigner(document)

    expect(createContentSigner(moved(document, "far", "x", 1)).of("seg")).toBe(signer.of("seg"))
  })

  it("carries the view state the caller passes in", () => {
    const signer = createContentSigner(documentWithLine())

    expect(signer.of("seg", "selected")).not.toBe(signer.of("seg", "not-selected"))
    expect(signer.of("seg", "selected")).toBe(signer.of("seg", "selected"))
  })

  it("follows every reference a measured object is drawn from", () => {
    const document = documentWithLine()
    const signer = createContentSigner(document)
    const movedSigner = createContentSigner(moved(document, "a", "z", 5))

    expect(movedSigner.ofReferences(["a", "b"], "dihedral")).not.toBe(signer.ofReferences(["a", "b"], "dihedral"))
    expect(movedSigner.ofReferences(["b"], "dihedral")).toBe(signer.ofReferences(["b"], "dihedral"))
  })

  it("describes the materialised topology a section patch is sized from", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 } },
      { id: "solid-1", type: "polyhedron3", vertexIds: ["v0"], edgeIds: [], faceIds: [], construction: { kind: "template", templateId: "cube", sourceIds: ["cube-1"] } }
    ]
    const signer = createContentSigner(document)

    expect(signer.topologyOf("cube-1")).toContain("solid-1")
    expect(createContentSigner(createEmptyDocument("geometry3d")).topologyOf("cube-1")).toBe("")
  })
})
