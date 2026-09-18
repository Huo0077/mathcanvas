import { describe, expect, it } from "vitest"

import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"

import { computeIntersectionPreviews, getIntersectionPreviews } from "./intersectionPreview"

describe("live intersection previews", () => {
  /**
   * 用户口径："由动点引申出来的图元（如切线，动圆）也需要能够反映和其他图元的交点"。
   * 切线在预览里一个图元对都不参与（实测 0 个），这条用例钉住它真的参与。
   */
  it("enumerates the pair when one source is a tangent", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-src", type: "circle", center: { x: 0, y: 6 }, radius: 2 },
      { id: "line-1", type: "line", a: { x: -6, y: 4 }, b: { x: 10, y: 4 } },
      { id: "tangent-1", type: "tangent", sourceId: "circle-src", x: 4, point: { x: 0, y: 4 }, slope: 0, a: { x: -3, y: 4 }, b: { x: 3, y: 4 }, status: "approximate", anchor: { kind: "parameter", parameter: 0 } }
    ]

    const previews = getIntersectionPreviews(document)

    expect(previews.some((preview) => preview.objectA === "tangent-1" || preview.objectB === "tangent-1")).toBe(true)
  })

  it("finds a line intersection without creating a primitive", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 } },
      { id: "line-b", type: "line", a: { x: 0, y: -2 }, b: { x: 0, y: 2 } }
    ]

    const previews = getIntersectionPreviews(document)

    expect(previews).toHaveLength(1)
    expect(previews[0]).toMatchObject({ objectA: "line-a", objectB: "line-b", point: { x: 0, y: 0 }, solutionIndex: 0 })
    expect(document.primitives).toHaveLength(2)
  })

  it("keeps both circle intersections as separate clickable previews", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "circle-a", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
      { id: "circle-b", type: "circle", center: { x: 2, y: 0 }, radius: 2 }
    ]

    const previews = getIntersectionPreviews(document)

    expect(previews).toHaveLength(2)
    expect(previews.every((preview) => preview.objectA === "circle-a" && preview.objectB === "circle-b")).toBe(true)
    expect(previews.map((preview) => preview.solutionIndex)).toEqual([0, 1])
  })

  it("ignores hidden and derived intersection primitives", () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "line-a", type: "line", a: { x: -2, y: 0 }, b: { x: 2, y: 0 }, visible: false },
      { id: "line-b", type: "line", a: { x: 0, y: -2 }, b: { x: 0, y: 2 } },
      { id: "intersection-1", type: "intersection", lineA: "line-a", lineB: "line-b", x: 0, y: 0 }
    ] as PrimitiveSpec[]

    expect(getIntersectionPreviews(document)).toEqual([])
  })
})

/**
 * 拖动预览的增量交点评算。
 *
 * 用户反馈"动点的流畅度还需要优化"：一次 pointermove 里最贵的就是**全文档两两求交**
 * （实测 52 个图元、6 条采样曲线时要 48.8ms，其余步骤加起来不到 0.5ms）。
 * 拖动时只有一个图元（以及它的下游闭包）会变，其余图元对的交点是**可以沿用**的。
 */
describe("incremental intersection previews", () => {
  const scene = () => {
    const document = createEmptyDocument("calculus")
    document.primitives = [
      { id: "circle-a", type: "circle", center: { x: 0, y: 0 }, radius: 2 },
      { id: "circle-b", type: "circle", center: { x: 2, y: 0 }, radius: 2 },
      { id: "line-c", type: "line", a: { x: -4, y: 0 }, b: { x: 4, y: 0 } }
    ]
    return document
  }

  const movedCircleA = (document: ReturnType<typeof scene>, centerX: number) => {
    const next = structuredClone(document)
    const circle = next.primitives.find((primitive) => primitive.id === "circle-a")
    if (circle?.type === "circle") circle.center.x = centerX
    return next
  }

  it("reuses the previews of pairs it was told not to touch", () => {
    const document = scene()
    const before = computeIntersectionPreviews(document)
    expect(before.previews.length).toBeGreaterThan(2)

    // 只声明 circle-a 变了：与它无关的那一对（circle-b × line-c）必须原样沿用
    const incremental = computeIntersectionPreviews(movedCircleA(document, 6), { recomputeFor: new Set(["circle-a"]), previous: before.previews })
    const touchesMoved = (preview: { objectA: string; objectB: string }) => preview.objectA === "circle-a" || preview.objectB === "circle-a"

    expect(incremental.reusedPreviews).toBeGreaterThan(0)
    expect(incremental.previews.filter((preview) => !touchesMoved(preview))).toEqual(before.previews.filter((preview) => !touchesMoved(preview)))
    expect(incremental.previews.filter(touchesMoved)).not.toEqual(before.previews.filter(touchesMoved))
  })

  it("recomputes the pairs that involve a changed primitive", () => {
    const document = scene()
    const before = computeIntersectionPreviews(document)

    const incremental = computeIntersectionPreviews(movedCircleA(document, 6), { recomputeFor: new Set(["circle-a"]), previous: before.previews })

    const rebuilt = computeIntersectionPreviews(movedCircleA(document, 6))
    expect(incremental.previews).toEqual(rebuilt.previews)
    expect(incremental.previews).not.toEqual(before.previews)
  })

  it("reports how many pairs it recomputed and how many previews it reused", () => {
    const document = scene()
    const before = computeIntersectionPreviews(document)

    // 三个图元一共 3 对；只改了圆 A → 与它相关的 2 对要重算，剩下的 1 对整段沿用。
    const incremental = computeIntersectionPreviews(movedCircleA(document, 6), { recomputeFor: new Set(["circle-a"]), previous: before.previews })

    expect(before.recomputedPairs).toBe(3)
    expect(incremental.recomputedPairs).toBe(2)
    expect(incremental.reusedPreviews).toBeGreaterThan(0)
  })

  it("matches a full recomputation when every primitive is marked dirty", () => {
    const document = movedCircleA(scene(), 1)
    const all = computeIntersectionPreviews(document)
    const ids = new Set(document.primitives.map((primitive) => primitive.id))

    expect(computeIntersectionPreviews(document, { recomputeFor: ids, previous: [] })).toEqual(all)
  })
})
