import { renderHook } from "@testing-library/react"
import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { useSceneStore } from "../store"
import { useInspectorModel, type InspectorModelInput } from "./inspectorModel"

/**
 * **检查器模型可以直接测了**（评审方案 2 的副产品，也是这一步的主要收益之一）。
 *
 * 这段逻辑原先埋在 `PropertiesBar` 的组件体里：要问"选中的是一条带斜率参数的直线时
 * 会多出什么"，得把整棵面板渲染出来、再去界面上找控件。抽成 `useInspectorModel` 之后
 * 它只依赖三项（`InspectorModelInput`），所以下面这些断言问的是**模型本身**。
 */

const seed = (primitives: PrimitiveSpec[]) => {
  const document = createEmptyDocument("cad")
  document.primitives = primitives
  useSceneStore.setState({ document, workspaceDocuments: { cad: document }, history: [], future: [], error: null })
  return document
}

const run = (selectedPrimitive: PrimitiveSpec | null, selectedIds: string[] = [], onUpdatePrimitive = vi.fn()) => {
  const props: InspectorModelInput = { selectedPrimitive, selectedIds, onUpdatePrimitive }
  return { model: renderHook(() => useInspectorModel(props)).result.current, onUpdatePrimitive }
}

const point = { id: "point-1", type: "point", x: 1, y: 2, label: "A" } as PrimitiveSpec

beforeEach(() => {
  seed([])
})

describe("inspector model", () => {
  it("narrows the selection to the one type the panel is about to edit", () => {
    seed([point])
    const { model } = run(point, ["point-1"])
    expect(model.selectedPoint).toMatchObject({ id: "point-1" })
    // 同一个图元不会被认成别的类型 —— 收窄错了，面板就会显示另一个类型的字段。
    expect(model.selectedPoint3).toBeNull()
    expect(model.selectedLinear).toBeNull()
  })

  it("does not offer the slope parameter for a plain line", () => {
    const plain = { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } } as PrimitiveSpec
    seed([plain])
    expect(run(plain, ["line-1"]).model.showSlopeParameter).toBe(false)
  })

  it("offers the slope parameter for a line that has one", () => {
    const parametrised = { id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, slopeParameter: { id: "k", value: 1, min: -5, max: 5, step: 0.1, label: "k" } } as unknown as PrimitiveSpec
    seed([parametrised])
    expect(run(parametrised, ["line-1"]).model.showSlopeParameter).toBe(true)
  })

  it("edits a point through the panel's single update callback", () => {
    seed([point])
    const { model, onUpdatePrimitive } = run(point, ["point-1"])
    model.updatePoint("x", 3)
    expect(onUpdatePrimitive).toHaveBeenCalledWith({ x: 3 })
  })

  it("refuses to edit a locked primitive", () => {
    // 锁定是"别再改它了"的唯一判据：模型必须把编辑全部挡在这里，而不是逐个控件去判。
    const locked = { ...point, locked: true } as PrimitiveSpec
    seed([locked])
    const { model, onUpdatePrimitive } = run(locked, ["point-1"])
    expect(model.editable).toBe(false)
    model.updatePoint("x", 3)
    expect(onUpdatePrimitive).not.toHaveBeenCalled()
  })

  it("carries no derived readings when nothing is selected", () => {
    const { model } = run(null)
    // 空文档 + 没选中：不抛异常、也没有读数块（面板因此不显示那一节）。
    expect(model.derivedReadings).toEqual([])
    expect(model.selectedAnnotations).toEqual([])
  })

  it("resolves a source label by id and falls back to the id", () => {
    seed([point])
    const { model } = run(point, ["point-1"])
    expect(model.sourceLabel("point-1")).toBe("A")
    // 找不到时退回 id：界面宁可显示一个 id，也不能显示 undefined。
    expect(model.sourceLabel("missing")).toBe("missing")
  })
})
