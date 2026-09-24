import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { deriveCanvasStatusPrompt, type CanvasStatusPromptInput } from "./canvasStatusPrompt"
import { resolveIntersectionPreviewPrompt, resolvePreviewInventoryPrompt, resolveStatusPrompt } from "./statusPrompts"

/**
 * **状态栏那句话的推导可以直接测了**（评审方案 2 的副产品）。
 *
 * 这段逻辑原先埋在 `App.tsx` 的组件体里，而它下面是纯解析器（`./statusPrompts`，自己有一组用例）。
 * 于是这一层要测的只有一件事：**画布现在的样子有没有被正确地折算成解析器的入参**。
 * 所以下面的断言**直接拿解析器的输出当期望值** —— 这里钉的是接线，不是文案
 *（文案归 `statusPrompts.test.ts`，两处各管一段，复制一遍文案只会让改文案变成改两处）。
 */

const base = (over: Partial<CanvasStatusPromptInput> = {}): CanvasStatusPromptInput => ({
  document: createEmptyDocument("geometry3d"),
  selectedIds: [],
  selectedPrimitive: null,
  creationMode: null,
  creationStep: null,
  sceneControl: null,
  previewStatus: null,
  hovering: false,
  scenePreviews: [],
  previewSweep: null,
  canAnchorRotation: false,
  ...over
})

const withPrimitives = (workspace: "cad" | "geometry3d", primitives: PrimitiveSpec[]) => {
  const document = createEmptyDocument(workspace)
  document.primitives = primitives
  return document
}

const point = { id: "point-1", type: "point", x: 1, y: 1, label: "A" } as PrimitiveSpec

describe("canvas status prompt", () => {
  it("falls back to the plain selection prompt when there is nothing to preview", () => {
    const input = base()
    expect(deriveCanvasStatusPrompt(input)).toBe(resolveStatusPrompt({ mode: null, selectedCount: 0, selectedLabel: null, hasCenter: false, hasStart: false, pointCount: 0, sceneControl: null }))
  })

  it("lets a hovered preview win over the inventory line", () => {
    const previewStatus = { kind: "intersection", label: "交线" }
    const input = base({ previewStatus, hovering: true, scenePreviews: [{ kind: "intersection" }, { kind: "face" }] })
    // 悬停在某一份预览上时说的是"这一份是什么、点下去创建什么"，不是"画布上有些什么"。
    expect(deriveCanvasStatusPrompt(input)).toBe(resolveIntersectionPreviewPrompt(previewStatus, true))
  })

  it("describes what is on the canvas when nothing is hovered", () => {
    const input = base({
      scenePreviews: [{ kind: "intersection" }, { kind: "intersection" }, { kind: "point" }],
      previewSweep: { truncatedPairs: 1, droppedPairs: 2 }
    })
    expect(deriveCanvasStatusPrompt(input)).toBe(resolvePreviewInventoryPrompt({ lines: 2, points: 1, faces: 0, truncated: 1, dropped: 2 }))
  })

  it("keeps the display-switch prompt in front of the previews", () => {
    // 显示开关是用户**刚刚按下按钮**触发的：被"选择带来的预览"盖掉会让人以为按钮没反应。
    const previewStatus = { kind: "intersection", label: "交线" }
    const input = base({ sceneControl: "normals", previewStatus, hovering: true, scenePreviews: [{ kind: "intersection" }] })
    expect(deriveCanvasStatusPrompt(input)).toBe(resolveStatusPrompt({ mode: null, selectedCount: 0, selectedLabel: null, hasCenter: false, hasStart: false, pointCount: 0, sceneControl: "normals" }))
  })

  it("never uses preview prompts outside the 3D workspace", () => {
    const previewStatus = { kind: "intersection", label: "交线" }
    const input = base({ document: createEmptyDocument("cad"), previewStatus, hovering: true, scenePreviews: [{ kind: "intersection" }] })
    expect(deriveCanvasStatusPrompt(input)).toBe(resolveStatusPrompt({ mode: null, selectedCount: 0, selectedLabel: null, hasCenter: false, hasStart: false, pointCount: 0, sceneControl: null }))
  })

  it("hands the in-progress creation step to the resolver", () => {
    // `creationStep` 只声明这里真正读到的字段（`center` / `start` / `points`）—— 模式由 `creationMode` 单独给。
    const input = base({ creationMode: "circle", creationStep: { center: { x: 1, y: 1 } } })
    expect(deriveCanvasStatusPrompt(input)).toBe(resolveStatusPrompt({ mode: "circle", selectedCount: 0, selectedLabel: null, hasCenter: true, hasStart: false, pointCount: 0, sceneControl: null }))
  })

  it("tells the resolver how many polyline points are already placed", () => {
    const input = base({ creationMode: "polyline", creationStep: { center: null, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })
    expect(deriveCanvasStatusPrompt(input)).toBe(resolveStatusPrompt({ mode: "polyline", selectedCount: 0, selectedLabel: null, hasCenter: false, hasStart: false, pointCount: 2, sceneControl: null }))
  })

  it("passes the bound-path facts for a single selected point, and only then", () => {
    const bound = { ...point, binding: { kind: "onPath", pathId: "circle-1" } } as PrimitiveSpec
    const path = { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 } as PrimitiveSpec
    // 绑定信息只在**非 CAD** 工作区给（CAD 里"这个点绑在哪条曲线上"不是用户关心的事）。
    const document = withPrimitives("geometry3d", [bound, path])

    const one = base({ document, selectedIds: ["point-1"], selectedPrimitive: bound })
    expect(deriveCanvasStatusPrompt(one)).toBe(resolveStatusPrompt({ mode: null, selectedCount: 1, selectedLabel: "A", hasCenter: false, hasStart: false, pointCount: 0, sceneControl: null, pointBinding: { bound: true, hasPaths: true, pathLabel: path.label ?? null } }))

    // 多选时说"这个点绑在哪条曲线上"没有意义：折算结果必须回到不带绑定的那一句。
    const many = base({ document, selectedIds: ["point-1", "circle-1"], selectedPrimitive: point })
    expect(deriveCanvasStatusPrompt(many)).toBe(resolveStatusPrompt({ mode: null, selectedCount: 2, selectedLabel: "A", hasCenter: false, hasStart: false, pointCount: 0, sceneControl: null }))

    // CAD 工作区里即使是单个点也不给绑定信息。
    const cad = base({ document: withPrimitives("cad", [bound, path]), selectedIds: ["point-1"], selectedPrimitive: bound })
    expect(deriveCanvasStatusPrompt(cad)).toBe(resolveStatusPrompt({ mode: null, selectedCount: 1, selectedLabel: "A", hasCenter: false, hasStart: false, pointCount: 0, sceneControl: null }))
  })
})
