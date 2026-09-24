import { createEmptyDocument } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createSolidCommands, solidTypes } from "./solidCommands"

/**
 * **拆出来的"截面与宿主绑定"命令要留住原来的行为**（评审方案 2）。
 *
 * 这批命令原来定义在 `App.tsx` 的组件体里，只有整棵 App 的交互才能测到。搬到
 * `./solidCommands` 之后，依赖面那七项都能换成假货，"命令往文档里写什么"可以直接问。
 *
 * 这里挑的是**不需要真几何**就能钉住的那几条 —— 也就是最容易在搬动中被"顺手改好"的部分：
 * 守卫（选中的不是该类型就什么都不做）、解绑写的是哪一支、参数更新落在哪个字段上。
 * 真正要算几何的（建截面、物化截面）由 `App.test.tsx` 与 e2e 覆盖。
 */

const scene = (primitives: unknown[]) => {
  const document = createEmptyDocument("geometry3d")
  document.primitives = primitives as typeof document.primitives
  return document
}

const harness = (primitives: unknown[], selectedId: string | null) => {
  const document = scene(primitives)
  const selectedPrimitive = selectedId === null ? null : document.primitives.find((primitive) => primitive.id === selectedId) ?? null
  const applied: DomainOperation[] = []
  const selections: string[][] = []
  const guidances: (string | null)[] = []
  const errors: string[] = []
  const commands = createSolidCommands({
    document,
    selectedPrimitive,
    selectedId,
    apply: (operation) => applied.push(operation),
    setSelectedIds: (ids) => selections.push(ids),
    setGuidance: (value) => guidances.push(value),
    setFileError: (message) => { if (message !== null) errors.push(message) }
  })
  return { commands, applied, selections, guidances, errors }
}

const point3 = { id: "point3-1", type: "point3", position: { x: 1, y: 2, z: 3 }, binding: { kind: "onHost", hostId: "line3-1", parameter: 0.5 } }

describe("solid commands", () => {
  it("keeps the shared list of section-capable types in one place", () => {
    // `solidTypes` 原先在 `App.tsx`，而 `addSection` 与 `canCreateSection` 都在用它 ——
    // 跟着命令搬到本模块后，App 改成从这里 import，仍然只有**一份**定义。
    expect([...solidTypes]).toEqual(["cube", "pyramid", "cylinder", "cone", "polyhedron3"])
  })

  it("rotates the selected object, and does nothing without a selection", () => {
    const withSelection = harness([point3], "point3-1")
    withSelection.commands.rotateSelected3("y", 90)
    expect(withSelection.applied).toEqual([{ op: "rotatePrimitive3", id: "point3-1", axis: "y", degrees: 90 }])

    const withoutSelection = harness([point3], null)
    withoutSelection.commands.rotateSelected3("y", 90)
    expect(withoutSelection.applied).toHaveLength(0)
  })

  it("unbinds a selected space point back to a free point", () => {
    const { commands, applied, guidances } = harness([point3], "point3-1")
    commands.bindPointToHost(null)

    expect(applied).toHaveLength(1)
    expect(applied[0]).toMatchObject({ op: "updatePrimitive", id: "point3-1", patch: { binding3: { kind: "free" } } })
    // 解绑也要有回话，否则用户点完不知道发生了什么。
    expect(guidances).toHaveLength(1)
  })

  it("ignores host binding when the selection is not a space point", () => {
    const circle = { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 1 }
    const { commands, applied, guidances } = harness([circle], "circle-1")
    commands.bindPointToHost("host:line3-1")
    expect(applied).toHaveLength(0)
    expect(guidances).toHaveLength(0)
  })

  it("moves the host parameter only when the point really is bound", () => {
    const bound = harness([point3], "point3-1")
    bound.commands.setPointHostParameter(0.75)
    expect(bound.applied[0]).toMatchObject({ op: "updatePrimitive", id: "point3-1", patch: { binding3: { kind: "onHost", hostId: "line3-1", parameter: 0.75 } } })

    // 自由点没有"宿主参数"这回事：必须什么都不做（不是写一个没有来源的数字进去）。
    const free = harness([{ id: "point3-1", type: "point3", position: { x: 0, y: 0, z: 0 }, binding: { kind: "free" } }], "point3-1")
    free.commands.setPointHostParameter(0.75)
    expect(free.applied).toHaveLength(0)

    // 非有限数同样拒绝：输入框清空时 `NaN` 会走到这里。
    const nan = harness([point3], "point3-1")
    nan.commands.setPointHostParameter(Number.NaN)
    expect(nan.applied).toHaveLength(0)
  })

  it("does not materialize anything unless a section is selected", () => {
    const { commands, applied, guidances } = harness([point3], "point3-1")
    commands.materializeSelectedSection()
    expect(applied).toHaveLength(0)
    expect(guidances).toHaveLength(0)
  })
})
