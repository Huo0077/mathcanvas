import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { historyShortcut, isTextEditingTarget, nextAnnotationId, nextEngineeringAnnotationId, nextGroupId, nextMeasurementId, nextPoint3Label, nextPointLabel, nextPrimitiveId } from "./documentIds"

/**
 * **id 与自动标签的分配**。
 *
 * 这一族此前是 `App.tsx` 里的模块级函数，**一条测试都没有** —— 它们决定"用户按下新建时这个对象
 * 叫什么"，而"叫什么"是有后果的：id 撞号会让写入被拒（界面表现为"点了没反应"），
 * 标签撞名会让用户分不清两个点。搬出来之后第一次可以直接喂一份文档问它下一个 id 是什么。
 *
 * 与 Agent 路径的关系：动作层用的是 `@draw/scene-graph` 的 `createIdAllocator`，
 * 语义必须是同一条（"从 1 开始找第一个没被占用的号"）。历史上这两套漂移过 ——
 * 分配器不知道文档里已有什么，于是画布上已有 `solid-1` 时新建的第一个立体又被发成 `solid-1`，
 * 整轮 Agent 运行以 `compile_failed: duplicate object id` 结束（现场：账本 `run-6-mubf109e`）。
 * 所以下面钉的是"占用集真的被看见了"，而不只是"返回一个字符串"。
 */
function doc(partial: Partial<GeometryDocument>): GeometryDocument {
  return { ...createEmptyDocument("conics"), ...partial } as GeometryDocument
}

describe("document id allocation", () => {
  it("returns the first free slot rather than the next count", () => {
    // 密集占用：1、2 被占，3 空着。
    const document = doc({ primitives: [{ id: "point-1", type: "point", x: 0, y: 0 }, { id: "point-2", type: "point", x: 1, y: 1 }] })
    expect(nextPrimitiveId(document, "point")).toBe("point-3")

    // **稀疏**占用才是关键：1 和 3 被占、2 空着 —— 只看"有多少个"会发 3，撞上已有的 3。
    const sparse = doc({ primitives: [{ id: "point-1", type: "point", x: 0, y: 0 }, { id: "point-3", type: "point", x: 1, y: 1 }] })
    expect(nextPrimitiveId(sparse, "point")).toBe("point-2")
  })

  it("starts at 1 on an empty document", () => {
    expect(nextPrimitiveId(createEmptyDocument("conics"), "point")).toBe("point-1")
  })

  it("keeps each collection's own numbering independent", () => {
    // 五类各自扫自己的集合：一个 `group-1` 不该把 `annotation` 推到 2。
    const document = doc({
      groups: [{ id: "group-1", name: "g", memberIds: [] } as never],
      measurements: [{ id: "measurement3-1" } as never],
      engineeringAnnotations: [{ id: "engineering-annotation-1" } as never]
    })
    expect(nextGroupId(document)).toBe("group-2")
    expect(nextAnnotationId(document)).toBe("annotation-1")
    expect(nextMeasurementId(document)).toBe("measurement3-2")
    expect(nextEngineeringAnnotationId(document)).toBe("engineering-annotation-2")
  })

  it("handles a document without the optional engineering annotations list", () => {
    // `engineeringAnnotations` 是可选的：旧文档里没有这个键，不能因此抛错。
    const document = createEmptyDocument("conics")
    delete (document as { engineeringAnnotations?: unknown }).engineeringAnnotations
    expect(nextEngineeringAnnotationId(document)).toBe("engineering-annotation-1")
  })
})

describe("automatic point labels", () => {
  const points = (labels: (string | undefined)[], type: "point" | "point3" = "point"): GeometryDocument => doc({
    primitives: labels.map((label, index) => ({ id: `${type}-${index + 1}`, type, ...(type === "point" ? { x: 0, y: 0 } : { position: { x: 0, y: 0, z: 0 } }), ...(label === undefined ? {} : { label }) }) as never)
  })

  it("hands out A, B, C… skipping the ones already used", () => {
    expect(nextPointLabel(points([]))).toBe("A")
    expect(nextPointLabel(points(["A"]))).toBe("B")
    // 用户删掉了 A：下一个又该是 A（不是 C —— 标签问的是"哪个还空着"）。
    expect(nextPointLabel(points(["B"]))).toBe("A")
  })

  it("falls back to a running number after Z", () => {
    const all = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))
    expect(nextPointLabel(points(all))).toBe("P27")
  })

  it("keeps planar and spatial points on the same rule", () => {
    // 两份实现漂移的下场是"平面点在 Z 之后叫 P27、空间点叫别的"，而用户看不出为什么。
    const all = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index))
    expect(nextPoint3Label(points(all, "point3"))).toBe("P27")
    expect(nextPoint3Label(points(["A"], "point3"))).toBe("B")
  })
})

describe("keyboard predicates", () => {
  const key = (init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent => ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, ...init }) as KeyboardEvent

  it("maps undo and redo, including the Cmd and Ctrl+Y variants", () => {
    expect(historyShortcut(key({ key: "z", ctrlKey: true }))).toBe("undo")
    expect(historyShortcut(key({ key: "z", metaKey: true }))).toBe("undo")
    expect(historyShortcut(key({ key: "Z", ctrlKey: true, shiftKey: true }))).toBe("redo")
    expect(historyShortcut(key({ key: "y", ctrlKey: true }))).toBe("redo")
  })

  it("ignores the shortcut when a text field owns the keystroke", () => {
    /**
     * 这条是**会让人丢工作**的那种 bug：用户在数值输入框里按 Ctrl+Z，本意是撤销刚打进去的几个字符，
     * 结果撤销了整篇文档的改动。所以 `isTextEditingTarget` 必须挡在前面。
     */
    const input = globalThis.document.createElement("input")
    expect(historyShortcut(key({ key: "z", ctrlKey: true, target: input }))).toBeNull()
    expect(isTextEditingTarget(input)).toBe(true)
    expect(isTextEditingTarget(globalThis.document.createElement("textarea"))).toBe(true)
    expect(isTextEditingTarget(globalThis.document.createElement("select"))).toBe(true)
    expect(isTextEditingTarget(globalThis.document.createElement("div"))).toBe(false)
    expect(isTextEditingTarget(null)).toBe(false)
  })

  it("ignores plain keys and Alt combinations", () => {
    expect(historyShortcut(key({ key: "z" }))).toBeNull()
    // Alt 组合在某些键盘布局上是输入法的一部分，不该被当成撤销。
    expect(historyShortcut(key({ key: "z", ctrlKey: true, altKey: true }))).toBeNull()
    expect(historyShortcut(key({ key: "a", ctrlKey: true }))).toBeNull()
  })
})
