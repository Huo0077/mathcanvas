import { createEmptyDocument, type PrimitiveSpec } from "@draw/dsl"
import type { DomainOperation } from "@draw/scene-graph"
import { describe, expect, it } from "vitest"

import { createPoint3ToolCommands, type Point3ToolDeps } from "./point3ToolCommands"

/**
 * **拆出来的三维工具命令要留住原来的行为**（评审方案 2）。
 *
 * 这几条命令原来定义在 `App.tsx` 的组件体里。搬到 `./point3ToolCommands` 之后，入参里的
 * 布尔量、文档、`apply` 都能换成假货 —— 于是"点摆在哪、什么时候拒绝"可以直接问。
 *
 * 这里钉住的是三条**几何口径**（原来只写在注释里）：格点摆放（前三点不共线）、
 * 三点共线时如实拒绝、圆轨道取一次坐标就脱钩。
 */

const scene = (primitives: PrimitiveSpec[]) => {
  const document = createEmptyDocument("geometry3d")
  document.primitives = primitives
  return document
}

const defaults: Pick<Point3ToolDeps, "canCreateLine3" | "canCreatePlane3" | "canCreateFace3" | "canCreateCircle3" | "selectedPoint3Ids"> = {
  canCreateLine3: false,
  canCreatePlane3: false,
  canCreateFace3: false,
  canCreateCircle3: false,
  selectedPoint3Ids: []
}

const harness = (primitives: PrimitiveSpec[] = [], overrides: Partial<Point3ToolDeps> = {}) => {
  const document = scene(primitives)
  const applied: DomainOperation[] = []
  const selections: string[][] = []
  const guidances: (string | null)[] = []
  const errors: string[] = []
  const layerFieldCalls: number[] = []
  const commands = createPoint3ToolCommands({
    document,
    ...defaults,
    apply: (operation) => applied.push(operation),
    setSelectedIds: (ids) => selections.push(ids),
    setGuidance: (value) => guidances.push(value),
    setFileError: (message) => { if (message !== null) errors.push(message) },
    cadLayerFields: () => { layerFieldCalls.push(1); return {} },
    ...overrides
  })
  return { commands, applied, selections, guidances, errors, layerFieldCalls }
}

/** 取"新增图元"那一笔的图元体 —— 先按 `op` 收窄，而不是把联合硬断言成别的形状。 */
const addedPrimitive = (applied: DomainOperation[]) => {
  const operation = applied[0]
  if (operation.op !== "addPrimitive") throw new Error(`expected addPrimitive, received ${operation.op}`)
  return operation.primitive
}

const point3 = (id: string, x: number, y: number, z: number) => ({ id, type: "point3", position: { x, y, z } }) as PrimitiveSpec

describe("point3 tool commands", () => {
  it("walks a lattice so the first three space points are never collinear", () => {
    // 行优先（A、B、C 排成一条线）会让"加三个点 → 建平面"必然失败 —— 这条用例钉的就是那个修复。
    const first = harness([])
    first.commands.addPoint3()
    const second = harness([point3("point3-1", 0, 0, 0)])
    second.commands.addPoint3()
    const third = harness([point3("point3-1", 0, 0, 0), point3("point3-2", 3, 0, 0)])
    third.commands.addPoint3()

    /** 按类型收窄之后再取坐标：`PrimitiveSpec` 是判别联合，不是所有成员都有 `position`。 */
    const positionOf = (result: ReturnType<typeof harness>) => {
      const primitive = addedPrimitive(result.applied)
      if (primitive.type !== "point3") throw new Error(`expected point3, received ${primitive.type}`)
      return primitive.position
    }
    const a = positionOf(first)
    const b = positionOf(second)
    const c = positionOf(third)
    expect([a, b, c]).toEqual([{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 0, y: 3, z: 0 }])
    // 叉积非零 = 不共线（正是"平面需要三个不共线的点"那条要求）。三个分量都要算：
    // 这批点都在 z = 0 平面上，只取 x 分量会恒为 0，那种断言是假通过。
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
    const cross = {
      x: ab.y * ac.z - ab.z * ac.y,
      y: ab.z * ac.x - ab.x * ac.z,
      z: ab.x * ac.y - ab.y * ac.x
    }
    expect(Math.hypot(cross.x, cross.y, cross.z)).toBeGreaterThan(0)
  })

  it("refuses the tools the selection does not support", () => {
    const { commands, applied } = harness([])
    commands.addLine3()
    commands.addPlane3()
    commands.addFace3()
    commands.addCircle3Track()
    expect(applied).toHaveLength(0)
  })

  it("keeps the circle track's radius equal to the selected distance, then lets the points go", () => {
    const points = [point3("point3-1", 0, 0, 0), point3("point3-2", 3, 0, 0)]
    const { commands, applied } = harness(points, { canCreateCircle3: true, selectedPoint3Ids: ["point3-1", "point3-2"] })
    commands.addCircle3Track()

    const primitive = addedPrimitive(applied)
    if (primitive.type !== "circle3") throw new Error(`expected circle3, received ${primitive.type}`)
    expect(primitive).toMatchObject({ type: "circle3", center: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 }, radius: 3 })
    // **脱钩**：轨道圆不引用那两个点（用户口径："点在圆上，而不是圆跟着点走"）。
    expect(JSON.stringify(primitive)).not.toContain("point3-1")
  })

  it("refuses a circle track through three collinear points", () => {
    // 三点共线 → 平面法向没有定义：如实拒绝并说明，而不是退回 +Z 假装成功。
    const points = [point3("point3-1", 0, 0, 0), point3("point3-2", 1, 0, 0), point3("point3-3", 2, 0, 0)]
    const { commands, applied, errors } = harness(points, { canCreateCircle3: true, selectedPoint3Ids: ["point3-1", "point3-2", "point3-3"] })
    commands.addCircle3Track()

    expect(applied).toHaveLength(0)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("共线")
  })

  it("rejects a zero radius instead of writing a degenerate track", () => {
    const points = [point3("point3-1", 0, 0, 0), point3("point3-2", 0, 0, 0)]
    const { commands, applied, errors } = harness(points, { canCreateCircle3: true, selectedPoint3Ids: ["point3-1", "point3-2"] })
    commands.addCircle3Track()
    expect(applied).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })

  it("lands a planar point in the active layer", () => {
    const applied: DomainOperation[] = []
    const commands = createPoint3ToolCommands({
      document: createEmptyDocument("cad"),
      ...defaults,
      apply: (operation) => applied.push(operation),
      setSelectedIds: () => undefined,
      setGuidance: () => undefined,
      setFileError: () => undefined,
      cadLayerFields: () => ({ layerId: "layer-1" })
    })
    commands.addPoint()
    expect(applied[0]).toMatchObject({ op: "addPrimitive", primitive: { type: "point", layerId: "layer-1" } })
  })
})
