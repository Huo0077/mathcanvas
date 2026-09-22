import { describe, expect, it } from "vitest"

import { createEmptyDocument, decodeMgeo, encodeMgeo, validateDocument } from "./index"

/** 3D 动点的宿主绑定（onHost / onFace / onSurface）必须过 schema，且不能留下悬空引用。 */
describe("3D point host bindings", () => {
  function hostDocument() {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [
      { id: "a", type: "point3", position: { x: 0, y: 0, z: 0 } },
      { id: "b", type: "point3", position: { x: 2, y: 0, z: 0 } },
      { id: "c", type: "point3", position: { x: 0, y: 2, z: 0 } },
      { id: "segment-ab", type: "segment3", pointIds: ["a", "b"] },
      { id: "face-abc", type: "face3", pointIds: ["a", "b", "c"] },
      { id: "cylinder-1", type: "cylinder", center: { x: 0, y: 0, z: 0 }, radius: 2, height: 4, segments: 8 },
      { id: "on-host", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onHost", hostId: "segment-ab", parameter: 0.25 } },
      { id: "on-face", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onFace", faceId: "face-abc", uv: [1, 1] } },
      { id: "on-surface", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "onSurface", solidId: "cylinder-1", uv: [0, 0.5] } }
    ]
    return document
  }

  const bindingOf = (document: ReturnType<typeof hostDocument>, id: string) =>
    (document.primitives.find((primitive) => primitive.id === id) as { binding: Record<string, unknown> }).binding

  it("accepts host, face and surface bindings", () => {
    expect(validateDocument(hostDocument())).toEqual({ valid: true })
  })

  it("rejects a host that is missing, of the wrong type, or has a non-finite parameter", () => {
    const missing = hostDocument()
    bindingOf(missing, "on-host").hostId = "nope"
    expect(validateDocument(missing).valid).toBe(false)

    const wrongType = hostDocument()
    bindingOf(wrongType, "on-host").hostId = "a"
    expect(validateDocument(wrongType).valid).toBe(false)

    const notFinite = hostDocument()
    bindingOf(notFinite, "on-host").parameter = Number.NaN
    expect(validateDocument(notFinite).valid).toBe(false)
  })

  it("accepts a circle track as a host, like any other one-dimensional host", () => {
    /**
     * 空间圆轨道（`circle3`）是一维宿主（参数就是圆周角），用户会把动点绑到它上面。
     *
     * 这条不是"锦上添花"：schema 漏了 `circle3` 之后，绑上去的点会让**整份文档**校验失败，
     * 而 `addPrimitive`（加点、建线、建面……）是先校验整份文档再写入的——于是"轨道上的动点"
     * 会导致后续**什么新对象都加不进来**（实测报 `point3 host binding is invalid`），
     * 用户看到的就是"圆轨道上的动点无法与定点建立直线连接"。
     */
    const document = hostDocument()
    document.primitives.push(
      { id: "orbit-1", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 },
      { id: "on-orbit", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "onHost", hostId: "orbit-1", parameter: 0 } }
    )

    expect(validateDocument(document)).toEqual({ valid: true })

    // 反过来仍要挡住真正的错引用：绑到一个**点**上不是合法宿主。
    const wrongHost = hostDocument()
    wrongHost.primitives.push(
      { id: "orbit-1", type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 2 },
      { id: "on-orbit", type: "point3", position: { x: 2, y: 0, z: 0 }, binding: { kind: "onHost", hostId: "a", parameter: 0 } }
    )
    expect(validateDocument(wrongHost).valid).toBe(false)
  })

  it("rejects a surface binding that points at something that is not a round solid", () => {
    const wrongSolid = hostDocument()
    bindingOf(wrongSolid, "on-surface").solidId = "face-abc"
    expect(validateDocument(wrongSolid).valid).toBe(false)

    const badUv = hostDocument()
    bindingOf(badUv, "on-face").uv = [1, Number.POSITIVE_INFINITY]
    expect(validateDocument(badUv).valid).toBe(false)
  })

  /**
   * 3D 宿主参数也可以由**文档参数**驱动（Reactive DAG 切片 Task 2；设计规格 §4.1
   * "参数是独立真源，点坐标由 parameter -> constraint evaluator -> position 得到"）。
   * 与 2D 的 `onPath.parameterId` 是同一套语义：悬空引用会让点静默冻住，必须在校验期挡住。
   */
  it("accepts parameter-driven host bindings and rejects dangling parameter references", () => {
    const document = hostDocument()
    document.parameters = {
      "t-u": { id: "t-u", value: 1, ownerId: "on-face" },
      "t-v": { id: "t-v", value: 1, ownerId: "on-face" },
      "t-w": { id: "t-w", value: 0.5, ownerId: "on-host" }
    }
    bindingOf(document, "on-host").parameterId = "t-w"
    bindingOf(document, "on-face").parameterIds = ["t-u", "t-v"]
    expect(validateDocument(document)).toEqual({ valid: true })

    // 往返（codec 是 JSON 克隆 + 校验）：驱动参数的引用必须原样保留。
    const roundTripped = decodeMgeo(encodeMgeo(document))
    const bindingOfRoundTrip = (id: string) => (roundTripped.primitives.find((primitive) => primitive.id === id) as unknown as { binding: unknown }).binding
    expect(bindingOfRoundTrip("on-host")).toEqual({ kind: "onHost", hostId: "segment-ab", parameter: 0.25, parameterId: "t-w" })
    expect(bindingOfRoundTrip("on-face")).toEqual({ kind: "onFace", faceId: "face-abc", uv: [1, 1], parameterIds: ["t-u", "t-v"] })

    const dangling = structuredClone(document)
    bindingOf(dangling, "on-face").parameterIds = ["t-u", "ghost"]
    expect(validateDocument(dangling).valid).toBe(false)

    const wrongShape = structuredClone(document)
    bindingOf(wrongShape, "on-face").parameterIds = ["t-u"]
    expect(validateDocument(wrongShape).valid).toBe(false)

    const notAnId = structuredClone(document)
    bindingOf(notAnId, "on-host").parameterId = 7
    expect(validateDocument(notAnId).valid).toBe(false)
  })
})
