import { createEmptyDocument } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createCreationCommands } from "./creationCommands"

/**
 * **拆出来的那一族创建命令要留住它原来的行为**（评审方案 2）。
 *
 * 这些命令原来定义在 `App.tsx` 的组件体里，只有通过整棵 App 的交互才能测到
 * （`App.test.tsx` / e2e 覆盖了端到端那一段）。搬到 `./creationCommands` 之后，
 * "命令本身写进文档的是什么"可以**直接**问一遍 —— 这正是"依赖面干净"这个接口的红利：
 * 四样依赖（文档 / apply / 两个 setter）都能一眼看成假货。
 *
 * 这里钉住三件容易在搬动中走样的事：
 * ①`apply` 的那一笔**内容**（含 `centerPointId` 这类"引用而不是快照"的写法）；
 * ②选择跟着切到新图元；
 * ③**该是空操作的时候确实是空操作**（选中了不是曲线的对象、动点没绑轨道）——
 *   少了这条，"搬过去之后不小心开始乱造图元"不会有任何信号。
 */

const documentWith = (primitives: unknown[]) => {
  const document = createEmptyDocument("cad")
  document.primitives = primitives as typeof document.primitives
  return document
}

const harness = (primitives: unknown[]) => {
  const applied: DomainOperation[] = []
  const selections: string[][] = []
  const guidances: (string | null)[] = []
  const errors: string[] = []
  const commands = createCreationCommands({
    document: documentWith(primitives),
    apply: (operation) => applied.push(operation),
    setSelectedIds: (ids) => selections.push(ids),
    setGuidance: (value) => guidances.push(value),
    setFileError: (message) => { if (message !== null) errors.push(message) }
  })
  return { commands, applied, selections, guidances, errors }
}

const point = { id: "point-1", type: "point", x: 1, y: 2, label: "A" }
const circle = { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 2 }

describe("creation commands", () => {
  it("puts a circle on the selected point and selects it", () => {
    const { commands, applied, selections, guidances } = harness([point])
    commands.createCircleAtPoint("point-1")

    expect(applied).toHaveLength(1)
    // **引用而不是快照**：圆心跟着那个点走，所以写的是 `centerPointId`。
    expect(applied[0]).toMatchObject({ op: "addPrimitive", primitive: { id: "circle-1", type: "circle", centerPointId: "point-1", radius: 1.5 } })
    expect(selections).toEqual([["circle-1"]])
    expect(guidances).toHaveLength(1)
  })

  it("does nothing when the target is not a point", () => {
    const { commands, applied, selections } = harness([circle])
    commands.createCircleAtPoint("circle-1")
    expect(applied).toHaveLength(0)
    expect(selections).toHaveLength(0)
  })

  it("creates a curve tangent on a tangent source and refuses anything else", () => {
    const onCurve = harness([circle])
    onCurve.commands.addCurveTangent("circle-1")
    expect(onCurve.applied[0]).toMatchObject({ op: "addPrimitive", primitive: { id: "tangent-1", type: "tangent", sourceId: "circle-1" } })

    // 直线不是"曲线"：作切线这件事没有意义，必须是空操作（不是造一条坏切线）。
    const onLine = harness([{ id: "line-1", type: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }])
    onLine.commands.addCurveTangent("line-1")
    expect(onLine.applied).toHaveLength(0)
  })

  it("creates a point tangent only for a point that is bound to a curve track", () => {
    const unbound = harness([point, circle])
    unbound.commands.addPointTangent("point-1")
    expect(unbound.applied).toHaveLength(0) // 没绑轨道
    expect(unbound.guidances).toHaveLength(0)

    // 绑在圆上：切线定位写成**对那个点的引用**（`anchor.pointId`），不是把当前坐标抄下来 ——
    // 抄下来的是一次性快照，点再动切线就不跟了（这条是用户口径的原话要求）。
    const bound = harness([{ ...point, binding: { kind: "onPath", pathId: "circle-1" } }, circle])
    bound.commands.addPointTangent("point-1")
    expect(bound.applied[0]).toMatchObject({ op: "addPrimitive", primitive: { type: "tangent", sourceId: "circle-1", anchor: { kind: "point", pointId: "point-1" } } })
  })

  it("writes a function analysis object with a placeholder geometry for the kernel to fill", () => {
    const fn = { id: "function-1", type: "function", expression: "x*x", domain: [-2, 2], samples: 64 }
    const { commands, applied, selections } = harness([fn])
    commands.addFunctionAnalysis("function-1", "derivative")

    expect(applied[0]).toMatchObject({ op: "addPrimitive", primitive: { type: "derivative", sourceId: "function-1", order: 1, points: [] } })
    expect(selections).toEqual([["derivative-1"]])
    // 不是函数就没有可分析的：空操作。
    const notFunction = harness([point])
    notFunction.commands.addFunctionAnalysis("point-1", "derivative")
    expect(notFunction.applied).toHaveLength(0)
  })

  it("lands the default cube on the table, in its own quadrant", () => {
    const { commands, applied, selections, errors } = harness([])
    commands.addDefaultCube()

    expect(applied).toHaveLength(1)
    const batch = applied[0] as { op: string; primitives: { id: string; type: string; origin?: { z: number } }[] }
    expect(batch.op).toBe("addPrimitives")
    expect(batch.primitives[0]).toMatchObject({ id: "cube-1", type: "cube", origin: { x: -7, y: 3, z: 0 }, size: { x: 4, y: 4, z: 2 } })
    // 底面落在 z = 0 上（"实体放在桌上"那套口径）：不是中心在原点、更不是一半埋在地面下。
    expect(batch.primitives[0].origin?.z).toBe(0)
    // **拓扑与参数化图元同一次提交**（方案 1 的验收口径）：少了它，渲染会落到不读 `rotation` 的那条分支。
    expect(batch.primitives.some((primitive) => primitive.id === "cube-1-point-1")).toBe(true)
    expect(selections).toEqual([["cube-1"]])
    expect(errors).toHaveLength(0)
  })

  it("materializes a tetrahedron's whole family in one batch", () => {
    const { commands, applied, selections, errors } = harness([])
    commands.addTetrahedron()

    expect(errors).toHaveLength(0)
    expect(applied).toHaveLength(1)
    // **一次落盘整族**：正四面体没有参数化图元，文档里的样子就是一只 `polyhedron3` 加上它的点 / 棱 / 面
    // —— 这一步要是丢了，画面上就只剩一个多面体、没有可编辑的顶点。
    const primitives = (applied[0] as { primitives: { id: string; type: string }[] }).primitives
    expect(primitives.length).toBeGreaterThan(10)
    expect(primitives.some((primitive) => primitive.type === "polyhedron3")).toBe(true)
    expect(primitives.some((primitive) => primitive.type === "point3")).toBe(true)
    // 选中的是那只多面体本身（不是它族的第一个顶点）。
    expect(selections).toHaveLength(1)
    expect(primitives.some((primitive) => primitive.id === selections[0][0])).toBe(true)
  })
})
