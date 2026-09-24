import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { createSelectionCommands } from "./selectionCommands"

/**
 * **拆出来的选择命令要留住原来的行为**（评审方案 2）。
 *
 * 这几条原来定义在 `App.tsx` 的组件体里。搬到 `./selectionCommands` 之后，七项依赖都能换成
 * 假货 —— 于是"点一下选中什么、框选往哪个方向选什么、锁定按钮做什么"可以直接问。
 *
 * 这里钉住的是三条**容易被当成细节改掉**的口径：加选是**切换**（再点一次取消）、
 * 框选**方向有语义**（左→右只选完全包含）、点选会**清掉创建步骤**。
 */

const scene = (primitives: PrimitiveSpec[] = []) => {
  const document = createEmptyDocument("cad")
  document.primitives = primitives
  return document
}

const harness = (document = scene(), selectedIds: string[] = [], allSelectedLocked = false) => {
  const applied: DomainOperation[] = []
  const selectionSets: string[][] = []
  const creationSteps: null[] = []
  const guidances: (string | null)[] = []
  const commands = createSelectionCommands({
    document,
    selectedIds,
    allSelectedLocked,
    apply: (operation) => applied.push(operation),
    // 组件里是 `useState` 的 setter（支持函数式更新）：这里照它的语义复现，才能测"切换"。
    setSelectedIds: (ids) => { selectionSets.push(typeof ids === "function" ? ids(selectedIds) : ids) },
    setCreationStep: (step) => creationSteps.push(step),
    setGuidance: (value) => guidances.push(value)
  })
  return { commands, applied, selectionSets, creationSteps, guidances }
}

const point = { id: "point-1", type: "point", x: 1, y: 1 } as PrimitiveSpec
const cube = { id: "cube-1", type: "cube", origin: { x: 0, y: 0, z: 0 }, size: { x: 1, y: 1, z: 1 } } as PrimitiveSpec

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("selection commands", () => {
  it("replaces the selection on a plain click and clears the creation step", () => {
    const { commands, selectionSets, creationSteps } = harness(scene([point]), ["other"])
    commands.updateSelection("point-1")

    expect(selectionSets).toEqual([["point-1"]])
    // 正在画线的中途去点一个对象 = 用户不画了。
    expect(creationSteps).toEqual([null])
  })

  it("toggles an id on an additive click", () => {
    const already = harness(scene([point]), ["point-1"])
    already.commands.updateSelection("point-1", true)
    expect(already.selectionSets).toEqual([[]]) // 再点一次取消

    const fresh = harness(scene([point]), [])
    fresh.commands.updateSelection("point-1", true)
    expect(fresh.selectionSets).toEqual([["point-1"]])
  })

  it("clears everything when nothing was clicked", () => {
    const { commands, selectionSets } = harness(scene([point]), ["point-1"])
    commands.updateSelection(null)
    expect(selectionSets).toEqual([[]])
  })

  it("hints the Alt modifier when a template solid is picked", () => {
    const solid = harness(scene([cube]))
    solid.commands.updateSelection("cube-1")
    // 不说这句，用户永远找不到"单独选中一个面"的入口（二面角、剖切都靠它）。
    expect(solid.guidances).toHaveLength(1)

    const plain = harness(scene([point]))
    plain.commands.updateSelection("point-1")
    expect(plain.guidances).toHaveLength(0)
  })

  it("keeps a curve that is only fully inside the box, and drops it otherwise", () => {
    // 函数没有解析的框相交几何：只按"完全包含"判 —— 两个方向都一样。
    const inside = { id: "function-1", type: "function", expression: "x*x", domain: [-1, 1], samples: 16 } as PrimitiveSpec
    const outside = { id: "function-2", type: "function", expression: "x*x", domain: [-9, 9], samples: 16 } as PrimitiveSpec

    const window = harness(scene([inside, outside]))
    window.commands.selectBox({ minX: -2, minY: -2, maxX: 2, maxY: 2 }, "window")
    expect(window.selectionSets[0]).toEqual(["function-1"])

    const crossing = harness(scene([inside, outside]))
    crossing.commands.selectBox({ minX: -2, minY: -2, maxX: 2, maxY: 2 }, "crossing")
    expect(crossing.selectionSets[0]).toEqual(["function-1"])
  })

  it("toggles the lock of everything selected, in one operation", () => {
    const unlocking = harness(scene([point]), ["point-1"], true)
    unlocking.commands.toggleLock()
    expect(unlocking.applied).toEqual([{ op: "setPrimitivesLocked", ids: ["point-1"], locked: false }])

    const locking = harness(scene([point]), ["point-1"], false)
    locking.commands.toggleLock()
    expect(locking.applied).toEqual([{ op: "setPrimitivesLocked", ids: ["point-1"], locked: true }])
  })

  it("groups the selection and drops the group that is currently selected", () => {
    const document = scene([point])
    const group = harness(document, ["point-1"])
    group.commands.createGroup()
    expect(group.applied[0]).toMatchObject({ op: "createGroup", group: { label: "分组 1", members: ["point-1"] } })

    // 选中的正好是一个已有的组 → 解组；否则什么都不做（不能凭空删一个组）。
    const grouped = scene([point])
    grouped.groups = [{ id: "group-1", label: "分组 1", members: ["point-1"] }]
    const removing = harness(grouped, ["point-1"])
    removing.commands.deleteGroup()
    expect(removing.applied[0]).toEqual({ op: "deleteGroup", id: "group-1" })

    const none = harness(scene([point]), ["point-1"])
    none.commands.deleteGroup()
    expect(none.applied).toHaveLength(0)
  })

  it("aligns the selection with the requested alignment", () => {
    const { commands, applied } = harness(scene([point]), ["point-1"])
    commands.alignSelection("left")
    expect(applied).toEqual([{ op: "alignPrimitives", ids: ["point-1"], alignment: "left" }])
  })
})
