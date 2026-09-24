import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createStructureCommands } from "./structureCommands"

/**
 * **拆出来的"结构"命令要留住原来的行为**（评审方案 2）。
 *
 * 删除与图层原来定义在 `App.tsx` 的组件体里。搬到 `./structureCommands` 之后，八项依赖
 * 都能换成假货，于是"删一笔到底提交了什么、什么时候拒绝"可以直接问。
 *
 * 这里最要紧的一条是**删除真的走了动作编译器**（与 Agent 同一份），而不是"自己拼一个删除补丁"：
 * 前者一旦退化成后者，手工删除与 Agent 删除就会对"哪些对象连带受影响"给出不同答案。
 */

const seed = (primitives: PrimitiveSpec[] = []) => {
  const document = createEmptyDocument("cad")
  document.primitives = primitives
  return document
}

const harness = (document = seed(), selectedIds: string[] = [], expandedIds: string[] = []) => {
  const applied: DomainOperation[] = []
  const batched: DomainOperation[][] = []
  const selections: string[][] = []
  const errors: string[] = []
  const expanded: string[][] = []
  const commands = createStructureCommands({
    document,
    selectedIds,
    apply: (operation) => applied.push(operation),
    applyBatch: (operations) => batched.push(operations),
    setSelectedIds: (ids) => selections.push(ids),
    setFileError: (message) => { if (message !== null) errors.push(message) },
    expandedIds,
    setExpandedIds: (ids) => expanded.push(ids)
  })
  return { commands, applied, batched, selections, errors, expanded }
}

const point = { id: "point-1", type: "point", x: 1, y: 2, label: "A" } as PrimitiveSpec

describe("structure commands", () => {
  it("does nothing when there is nothing selected", () => {
    const { commands, batched, errors } = harness(seed([point]))
    commands.deleteSelected()
    expect(batched).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })

  it("deletes through the shared action compiler and clears the selection", () => {
    const { commands, batched, selections } = harness(seed([point]), ["point-1"])
    commands.deleteSelected()

    // 一笔批量提交（不是逐个 apply）：整批只占一步撤销。
    expect(batched).toHaveLength(1)
    expect(batched[0].length).toBeGreaterThan(0)
    expect(selections).toEqual([[]])
  })

  it("reports why a deletion was refused instead of deleting anyway", () => {
    const { commands, batched, errors } = harness(seed([point]), ["point-404"])
    commands.deleteSelected()
    expect(batched).toHaveLength(0)
    // `validateDeletion` 给的是用户可读的理由（"不存在"也是一种），而不是静默什么都不做。
    expect(errors.length).toBeGreaterThan(0)
  })

  it("names new layers by the first free slot", () => {
    const document = seed()
    document.layers = [{ id: "layer-1", name: "图层 1", kind: "geometry", visible: true, locked: false, printable: true }]
    const { commands, applied } = harness(document)
    commands.addLayer()
    expect(applied[0]).toMatchObject({ op: "addLayer", layer: { id: "layer-2", kind: "geometry", visible: true } })
  })

  it("expands the parent when a child layer is created", () => {
    const document = seed()
    document.layers = [{ id: "layer-1", name: "图层 1", kind: "geometry", visible: true, locked: false, printable: true }]
    const { commands, expanded } = harness(document)
    commands.addLayer("layer-1")
    // 折叠着新建子层，用户会以为"点了没反应"。
    expect(expanded).toEqual([["layer-1"]])

    // 已经展开过就不必再展开一次。
    const open = harness(document, [], ["layer-1"])
    open.commands.addLayer("layer-1")
    expect(open.expanded).toHaveLength(0)
  })

  it("hands a deleted layer's objects to a surviving geometry layer", () => {
    const document = seed()
    document.layers = [
      { id: "layer-1", name: "图层 1", kind: "geometry", visible: true, locked: false, printable: true },
      { id: "layer-2", name: "图层 2", kind: "geometry", visible: true, locked: false, printable: true }
    ]
    const { commands, applied } = harness(document)
    commands.deleteLayer("layer-1")
    // 不能把图元留在一个不存在的层上：交给另一只**几何**层。
    expect(applied[0]).toMatchObject({ op: "deleteLayer", id: "layer-1", reassignTo: "layer-2" })
  })

  it("deletes the last geometry layer without inventing a reassignment target", () => {
    const document = seed()
    document.layers = [{ id: "layer-1", name: "图层 1", kind: "geometry", visible: true, locked: false, printable: true }]
    const { commands, applied } = harness(document)
    commands.deleteLayer("layer-1")
    // 没有别的几何层可接：如实删（**不**编一个不存在的 `reassignTo` 出来）。
    expect(applied[0]).toEqual({ op: "deleteLayer", id: "layer-1" })
  })
})
