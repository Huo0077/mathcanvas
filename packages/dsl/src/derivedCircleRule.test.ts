import { describe, expect, it } from "vitest"

import { createEmptyDocument, validateDocument } from "./index"

/**
 * **由三角形派生的半径规则**（Reactive DAG 切片 Task 3；设计规格 §4.3）。
 *
 * `CircleRadiusRule` 原来只能"半径 = 某个点到圆心的距离 × 倍率"。内切圆 / 外接圆是同一类
 * "半径由别的东西算出来"的圆，只是来源换成一个**三角形**：
 *
 * ```json
 * { "kind": "triangle", "triangleIds": ["A", "B", "C"], "metric": "inradius" }
 * ```
 *
 * 圆心也由那个三角形决定（内切圆 → 内心、外接圆 → 外心），于是文档里没有一个数字是手抄的。
 * 老写法（带 `pointId` / `factor`，`kind` 可省）必须继续合法 —— 已有文档不能因为这次扩展而失效。
 */
describe("triangle-derived circle radius rules", () => {
  function incircleDocument() {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "point-a", type: "point", x: 0, y: 0, label: "A" },
      { id: "point-b", type: "point", x: 4, y: 0, label: "B" },
      { id: "point-c", type: "point", x: 0, y: 3, label: "C" },
      {
        id: "circle-in",
        type: "circle",
        center: { x: 1, y: 1 },
        radius: 1,
        radiusFrom: { kind: "triangle", triangleIds: ["point-a", "point-b", "point-c"], metric: "inradius" }
      }
    ]
    return document
  }

  it("accepts a triangle-derived radius rule", () => {
    expect(validateDocument(incircleDocument())).toEqual({ valid: true })
  })

  it("rejects dangling vertices, unknown metrics and wrong arity", () => {
    const dangling = incircleDocument()
    ;(dangling.primitives[3] as { radiusFrom: { triangleIds: string[] } }).radiusFrom.triangleIds = ["point-a", "point-b", "ghost"]
    expect(validateDocument(dangling).valid).toBe(false)

    const wrongArity = incircleDocument()
    ;(wrongArity.primitives[3] as { radiusFrom: { triangleIds: string[] } }).radiusFrom.triangleIds = ["point-a", "point-b"]
    expect(validateDocument(wrongArity).valid).toBe(false)

    const unknownMetric = incircleDocument()
    ;(unknownMetric.primitives[3] as { radiusFrom: { metric: string } }).radiusFrom.metric = "exradius"
    expect(validateDocument(unknownMetric).valid).toBe(false)

    // 顶点必须真的是点：绑到一条线段上不是三角形。
    const wrongType = incircleDocument()
    wrongType.primitives.push({ id: "segment-ab", type: "segment", a: { x: 0, y: 0 }, b: { x: 4, y: 0 } })
    ;(wrongType.primitives[3] as { radiusFrom: { triangleIds: string[] } }).radiusFrom.triangleIds = ["point-a", "segment-ab", "point-c"]
    expect(validateDocument(wrongType).valid).toBe(false)
  })

  it("keeps the legacy distance rule valid with and without an explicit kind", () => {
    const document = incircleDocument()
    ;(document.primitives[3] as { radiusFrom: unknown }).radiusFrom = { pointId: "point-a", factor: 2 }
    expect(validateDocument(document)).toEqual({ valid: true })
    ;(document.primitives[3] as { radiusFrom: unknown }).radiusFrom = { kind: "distance", pointId: "point-b", factor: 1 }
    expect(validateDocument(document)).toEqual({ valid: true })
  })
})
