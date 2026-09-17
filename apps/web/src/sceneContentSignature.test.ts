import { describe, expect, it } from "vitest"

import { createEmptyDocument, type CurvePiece3, type GeometryDocument } from "@draw/dsl"
import { circleConic3 } from "@draw/geometry-kernel"

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

  /**
   * A1 第 8 片：解析字段（`section.exact` / `intersectionFace.exactLoops`）必须进签名。
   *
   * 这条**不需要改代码**——签名用的是 `JSON.stringify(primitive)`，解析字段本来就在里面；
   * 需要的是把它**钉住**：以后若有人为了省字符串而"优化"成只列几何字段，真曲线就会画成过期的那一条。
   * （钉住它的价值用变异检查证明过：把 `exact` 从签名里摘掉，这条用例立刻失败。）
   */
  it("carries the analytic fields, so an exact boundary change rebuilds the curve", () => {
    const circle = circleConic3({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, 2)!
    const sectionOf = (kind: "circle" | "ellipse", semiMajor: number) => ({
      id: "section-1", type: "section" as const, sourceId: "cylinder-1",
      plane: { normal: { x: 0, y: 0, z: 1 }, constant: -1 },
      points: [], classification: "polygon" as const, status: "exact" as const,
      exact: { kind, loops: [[{ kind: "conic" as const, conic: { ...circle, kind, semiMajor }, parameterRange: [0, Math.PI * 2] as [number, number] }]] }
    })
    const withSection = (section: ReturnType<typeof sectionOf>) => {
      const document = createEmptyDocument("geometry3d")
      document.primitives = [section]
      return document
    }
    const circleSigner = createContentSigner(withSection(sectionOf("circle", 2)))
    const ellipseSigner = createContentSigner(withSection(sectionOf("ellipse", 2.5)))

    // 只有解析结论变了（多边形字段一模一样）⇒ 签名必须变，否则画布会留着旧的真曲线。
    expect(ellipseSigner.of("section-1")).not.toBe(circleSigner.of("section-1"))

    // 交面边界同理。
    const faceWith = (loops: CurvePiece3[][]) => {
      const document = createEmptyDocument("geometry3d")
      document.primitives = [{
        id: "face-1", type: "intersectionFace", sourceIds: ["cube-a", "cube-b"],
        points: [{ x: 0, y: 0, z: 0 }], normal: { x: 0, y: 0, z: 1 }, area: 1,
        hint: { x: 0, y: 0, z: 0 }, status: "valid", exactLoops: loops
      }]
      return document
    }
    const withLoops = createContentSigner(faceWith([[{ kind: "segment", a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 0, z: 0 } }]]))
    const withoutLoops = createContentSigner(faceWith([]))
    expect(withLoops.of("face-1")).not.toBe(withoutLoops.of("face-1"))
  })
})
